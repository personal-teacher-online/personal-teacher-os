-- PESQUISA DE PAUTA — `content_research` (M5 do ciclo 1 de conteúdo, 01/08/2026).
--
-- O que o worker de pesquisa descobre vira REGISTRO: análises de reel
-- (transcrição + leitura estrutural de um vídeo público) e apanhados de trends
-- por rede. Quem escreve é só o robô; quem lê é a admin (e o M6, que transforma
-- pesquisa em ideia). Guards em `tests/pauta-fabrica.test.ts` (parte 2) —
-- escritos e commitados VERMELHOS antes deste arquivo existir (regra 7 do fluxo
-- da frente de conteúdo).
--
-- ── AS DUAS COLUNAS QUE NÃO SE MISTURAM ─────────────────────────────────────
-- `metricas`  = números PÚBLICOS medidos na plataforma (views, likes…).
-- `payload`   = DERIVADOS e INFERIDOS (transcrição, análise, hipóteses de
--               retenção, proveniência em payload.meta) — NUNCA métrica medida.
-- A separação é a lição do A5: análise não se disfarça de medição. O banco não
-- tem como validar a semântica de cada jsonb; o que ele garante é que existem
-- DOIS lugares, e o contrato de qual conteúdo mora em qual vive aqui e no
-- worker (`src/lib/research/*`).
--
-- ── ENDEREÇO E SUPERSESSÃO (o coração do desenho) ───────────────────────────
-- `source_key` é o endereço estável do achado; `run` é a versão dele.
--   · reel:  `reel:<rede>:<id-externo>`   (identidade = o próprio vídeo)
--   · trend: `trends:<rede>:<AAAA-Wss>`   (identidade = rede + SEMANA ISO da
--     corrida — semana nova cria fonte nova sozinha; refazer a MESMA janela é
--     que exige --force. Convenção do worker, documentada aqui de propósito:
--     com endereço fixo por rede a pesquisa congelava após a 1ª corrida.)
-- Re-corrida sem force devolve o ativo (0 linha nova). Force cria run novo e o
-- ativo antigo ganha `superseded_by` → run novo. NADA é apagado nem reescrito:
-- a cadeia de runs é o histórico integral da pesquisa. Três cercas extras do
-- ataque adversarial pré-apply (Sol, 01/08): a fonte não muda de identidade
-- entre runs (tipo/plataforma conferidos no force); o sucessor tem de ser run
-- POSTERIOR da MESMA fonte (constraint trigger DEFERRED — no instante do
-- UPDATE o run novo ainda não existe); e TRUNCATE explode em trigger próprio
-- (trigger de linha não dispara em truncate — lição registrada no M4).
--
-- ── NOTA OBRIGATÓRIA: A ORDEM DA SUPERSESSÃO É UPDATE → INSERT ──────────────
-- O invariante "1 ativo por fonte" é um índice ÚNICO PARCIAL
-- (`where superseded_by is null`) — e índice único parcial NÃO é deferrable.
-- Logo, dentro da transação da RPC, primeiro o run antigo ganha
-- `superseded_by` (deixa de ser ativo), DEPOIS o run novo é inserido. Para
-- essa ordem ser possível, a FK de `superseded_by` (que aponta para o id do
-- run novo, ainda não inserido no momento do UPDATE) é DEFERRABLE INITIALLY
-- DEFERRED — ela confere no commit, não no meio. Inverter a ordem viola o
-- índice parcial; tirar o deferrable viola a FK. As duas peças existem por
-- causa uma da outra.
--
-- ── POR QUE SEM `audit_row_change` (decisão declarada; ataque bem-vindo) ────
-- `audit_log` registra mutação de GENTE em dado do negócio. Aqui só escreve
-- máquina, por UMA porta, numa tabela append-only cujo histórico é ela mesma
-- (runs + supersessão + coletado_em). Auditar cada insert de pesquisa dobraria
-- o volume do audit_log sem acrescentar um fato que a própria tabela já não
-- guarde. Se um dia houver mão humana escrevendo aqui, este parágrafo cai e o
-- trigger de audit entra por migration aditiva.
--
-- ADR-031 (adendo 01/08): dados de terceiros são responsabilidade do dono —
-- nada é apagado; no banco persistem DERIVADOS; mídia e bruto de scrape ficam
-- em `_rascunhos/` (fora do git), sem rotina de limpeza.

create table content_research (
  id uuid primary key default gen_random_uuid(),
  tipo text not null
    constraint content_research_tipo check (tipo in ('analise_reel', 'trends')),
  plataforma text not null
    constraint content_research_plataforma
    check (plataforma in ('youtube', 'instagram', 'tiktok', 'x', 'reddit')),
  -- Análise de reel exige rede COM vídeo: X e Reddit entram só como trends.
  -- Invariante do BANCO, não gentileza do worker.
  constraint content_research_tipo_plataforma
    check (tipo <> 'analise_reel' or plataforma in ('youtube', 'instagram', 'tiktok')),
  source_key text not null
    constraint content_research_source_key_forma check (btrim(source_key) <> ''),
  run int not null
    constraint content_research_run check (run >= 1),
  -- Dono do achado quando ele veio de criador cadastrado; NULL = veio de trend.
  creator_id uuid references content_creators (id),
  titulo text,
  url text,
  publicado_em timestamptz,   -- do item de origem (reel); NULL em trends
  payload jsonb not null,
  metricas jsonb not null default '{}'::jsonb,
  superseded_by uuid
    constraint content_research_superseded_by_fkey
    references content_research (id) deferrable initially deferred,
  coletado_em timestamptz not null default now(),
  -- Backstop do INSERT (o trigger de self-supersessão só vê UPDATE): nenhuma
  -- linha nasce apontando para si mesma.
  constraint content_research_nao_supera_a_si_mesma check (superseded_by <> id)
);

comment on table content_research is
  'Pesquisa de pauta (M5/ADR-031): análises de reel e apanhados de trends, '
  'escritos SÓ pelo robô via record_content_research. source_key = endereço '
  'estável; run = versão; superseded_by = cadeia de supersessão (append-only, '
  'nada se apaga). payload = derivados/inferidos; metricas = números públicos '
  'medidos — as duas colunas não se misturam (lição do A5).';
comment on column content_research.payload is
  'DERIVADOS/INFERIDOS: transcrição, análise, proveniência (payload.meta: '
  'versão do prompt, modelo, transcricao_via, tokens). Nunca métrica medida.';
comment on column content_research.metricas is
  'Números PÚBLICOS medidos na plataforma (views, likes, contagens do filtro). '
  'Nunca inferência.';
comment on column content_research.source_key is
  'Endereço estável: reel:<rede>:<id-externo> ou trends:<rede>:<AAAA-Wss> '
  '(janela SEMANAL ISO — semana nova = fonte nova sem force).';

alter table content_research
  add constraint content_research_source_key_run unique (source_key, run);

-- O invariante "1 ativo por fonte". Parcial ⇒ não deferrable ⇒ a ordem
-- UPDATE→INSERT do cabeçalho.
create unique index content_research_um_ativo_por_fonte
  on content_research (source_key)
  where superseded_by is null;

-- ── O GUARD: fora a supersessão, NADA muda ──────────────────────────────────
create or replace function public.content_research_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'pesquisa % não se apaga — o histórico da pauta fica; supersessão é o caminho',
      old.id;
  end if;

  -- Whitelist por diff de to_jsonb (padrão 20260724000200): o ÚNICO campo que
  -- um UPDATE pode tocar é superseded_by.
  if to_jsonb(new) - 'superseded_by' <> to_jsonb(old) - 'superseded_by' then
    raise exception
      'pesquisa % é imutável — fora a supersessão (superseded_by), nada se reescreve',
      old.id;
  end if;

  if new.superseded_by is distinct from old.superseded_by then
    -- Só a transição null→uuid existe: quem já foi superado não muda de
    -- sucessor, e ninguém "des-supera" um run.
    if old.superseded_by is not null or new.superseded_by is null then
      raise exception
        'a cadeia de supersessão da pesquisa % não se reescreve', old.id;
    end if;
    if new.superseded_by = old.id then
      raise exception 'pesquisa % não pode superar a si mesma', old.id;
    end if;
  end if;

  return new;
end;
$$;

create trigger content_research_guard
  before update or delete on content_research
  for each row execute function public.content_research_guard();

-- TRUNCATE não dispara trigger de linha (lição escrita no rodapé do M4): a
-- promessa "o histórico não se esvazia" ganha o próprio trigger de statement.
create or replace function public.content_research_sem_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'content_research não se trunca — o histórico da pauta fica';
end;
$$;

create trigger content_research_sem_truncate
  before truncate on content_research
  for each statement execute function public.content_research_sem_truncate();

-- O SUCESSOR CERTO, conferido no COMMIT: no instante do UPDATE da supersessão
-- o run novo ainda não existe (ordem do cabeçalho), então a validação de que
-- ele é da MESMA fonte e de run POSTERIOR só pode acontecer deferred — como a
-- FK. Se o alvo não existir no commit, quem estoura é a própria FK.
create or replace function public.content_research_sucessor_valido()
returns trigger
language plpgsql
as $$
declare
  v_fonte text;
  v_run int;
begin
  select cr.source_key, cr.run into v_fonte, v_run
    from public.content_research cr
   where cr.id = new.superseded_by;
  if not found then
    return null; -- FK deferred fala por este caso no mesmo commit
  end if;
  if v_fonte <> new.source_key or v_run <= new.run then
    raise exception
      'supersessão inválida na pesquisa %: o sucessor precisa ser run posterior da MESMA fonte',
      new.id;
  end if;
  return null;
end;
$$;

create constraint trigger content_research_sucessor_valido
  after update on content_research
  deferrable initially deferred
  for each row
  when (new.superseded_by is not null)
  execute function public.content_research_sucessor_valido();

-- ── A PORTA ÚNICA DE ESCRITA ────────────────────────────────────────────────
-- security definer (dono postgres) + search_path fixo, padrão
-- slide_lesson_save_draft: é ela quem escreve numa tabela onde NINGUÉM tem DML
-- direto — nem service_role. O advisory lock por source_key serializa duas
-- corridas concorrentes da mesma fonte (dois --force simultâneos não computam
-- o mesmo max(run)+1).
create or replace function public.record_content_research(
  p_tipo text,
  p_plataforma text,
  p_source_key text,
  p_payload jsonb,
  p_metricas jsonb default '{}'::jsonb,
  p_creator_id uuid default null,
  p_titulo text default null,
  p_url text default null,
  p_publicado_em timestamptz default null,
  p_force boolean default false
) returns table (id uuid, run int, foi_criado boolean)
language plpgsql
security definer
-- pg_catalog primeiro e NADA de pg_temp (achado do Sol): security definer com
-- relação não qualificada podia ser sombreada por tabela temporária do
-- chamador. Cinto E suspensório: search_path curto + toda referência abaixo
-- qualificada com `public.`.
set search_path = pg_catalog, public
as $$
declare
  v_ativo_id uuid;
  v_ativo_run int;
  v_ativo_tipo text;
  v_ativo_plataforma text;
  v_tinha_ativo boolean;
  v_novo_id uuid := gen_random_uuid();
  v_run int;
begin
  if btrim(coalesce(p_source_key, '')) = '' then
    raise exception 'pesquisa sem endereço: source_key vazio';
  end if;

  perform pg_advisory_xact_lock(hashtext('content_research'), hashtext(p_source_key));

  select cr.id, cr.run, cr.tipo, cr.plataforma
    into v_ativo_id, v_ativo_run, v_ativo_tipo, v_ativo_plataforma
    from public.content_research cr
   where cr.source_key = p_source_key and cr.superseded_by is null;
  v_tinha_ativo := found;

  -- Sem force, o ativo é a resposta: 0 linha nova, idempotência de re-corrida.
  -- `is not true` de propósito (achado do Sol): p_force NULL vindo do JSON não
  -- pode virar supersessão acidental — três estados do SQL mordem aqui.
  if v_tinha_ativo and p_force is not true then
    return query select v_ativo_id, v_ativo_run, false;
    return;
  end if;

  -- A fonte não muda de identidade entre runs: o endereço diz o que ela é.
  if v_tinha_ativo
     and (p_tipo <> v_ativo_tipo or p_plataforma <> v_ativo_plataforma) then
    raise exception
      'a fonte % não muda de identidade entre runs (tipo/plataforma divergem do run ativo)',
      p_source_key;
  end if;

  select coalesce(max(cr.run), 0) + 1 into v_run
    from public.content_research cr
   where cr.source_key = p_source_key;

  -- A função não depende do ambiente do chamador: um SET CONSTRAINTS ...
  -- IMMEDIATE herdado da sessão quebraria a ordem do cabeçalho.
  set constraints public.content_research_superseded_by_fkey deferred;

  -- A ORDEM DO CABEÇALHO: primeiro o antigo deixa de ser ativo (a FK deferred
  -- aceita apontar para o id que só nasce no INSERT seguinte)…
  if v_tinha_ativo then
    update public.content_research cr
       set superseded_by = v_novo_id
     where cr.id = v_ativo_id;
  end if;

  -- …depois o run novo entra, já como o único ativo da fonte.
  insert into public.content_research
    (id, tipo, plataforma, source_key, run, creator_id, titulo, url,
     publicado_em, payload, metricas)
  values
    (v_novo_id, p_tipo, p_plataforma, p_source_key, v_run, p_creator_id,
     p_titulo, p_url, p_publicado_em, p_payload, coalesce(p_metricas, '{}'::jsonb));

  return query select v_novo_id, v_run, true;
end;
$$;

comment on function public.record_content_research is
  'Porta única de escrita da pesquisa de pauta (M5). Sem force devolve o run '
  'ativo da fonte (foi_criado=false, 0 linha nova); com force cria run novo e '
  'supera o antigo na MESMA transação (ordem UPDATE→INSERT — ver cabeçalho da '
  'migration). EXECUTE só para service_role.';

-- ── RLS + GRANTS ────────────────────────────────────────────────────────────
alter table content_research enable row level security;

-- Leitura pela API: admin (a tela "de onde veio" do M6 lê por aqui) — e o robô
-- via bypassrls, para a pré-checagem (dito com todas as letras: "só admin" vale
-- para papéis SOB RLS). Escrita: nenhuma policy — e nenhum grant de DML —
-- porque escrever é papel exclusivo da RPC.
create policy content_research_admin_read on content_research
  for select to authenticated
  using ((select public.app_role()) = 'admin');

-- Lição 20260714000600: revoke explícito antes dos grants cirúrgicos (default
-- privileges e grants amplos antigos alcançam tabela nova). PUBLIC entra na
-- lista (achado do Sol): grant herdado por PUBLIC contornaria os três roles.
revoke insert, update, delete, truncate on content_research
from public, anon, authenticated, service_role;

-- Caso 12/F1: select com RLS decidindo as linhas (anon/teacher leem 0 sem
-- erro). service_role lê para a pré-checagem de idempotência do worker
-- (bypassrls) — mas NÃO escreve: a porta é a RPC.
grant select on content_research to anon, authenticated, service_role;

-- EXECUTE default de função é PUBLIC — revogar antes de conceder ao robô.
revoke execute on function public.record_content_research(
  text, text, text, jsonb, jsonb, uuid, text, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.record_content_research(
  text, text, text, jsonb, jsonb, uuid, text, text, timestamptz, boolean
) to service_role;
