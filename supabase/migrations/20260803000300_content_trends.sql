-- =============================================================================
-- Estúdio v2 — Leva 2.1 (ADR-032 + ADR-037): `content_trends`, a camada de
-- CURADORIA do radar, e a ponte trend→roteiro em `content_posts`.
--
-- A medição (`content_research`, migration 20260801000200) segue INTACTA como
-- log imutável. Cada trend deriva de UMA linha ATIVA de `analise_reel` (FK
-- `research_id` + `source_key` idênticos — proveniência sem fresta) e é o
-- objeto que a dona decide no radar:
--
--   nova → roteirizada | descartada        (descarte exige motivo + ator)
--
-- Duas mãos por GRANT DE COLUNA (molde do M4/content_creators):
--   robô (service_role)  INSERE a captura (research_id, source_key, plataforma,
--                        url, autor, views, velocidade, velocidade_sem_conta,
--                        semana, travel_score, travel_meta, variacao_de — e,
--                        na exceção da herança, status/discard/decidida);
--                        ATUALIZA só travel_score/travel_meta (a nota fail-open
--                        do ADR-033 se cura na corrida seguinte, enquanto NOVA).
--   admin (authenticated) DECIDE: status, discard_reason, travel_score_ajustado,
--                        tema_cluster, decidida_por, decidida_em. Nunca insere.
--
-- Variação de tema (ADR-034, era das trends) é LINHA PRÓPRIA: `variacao_de`
-- aponta SEMPRE para a raiz (profundidade 1, validada no guard); o descarte da
-- mãe CASCATEIA às variações novas herdando motivo e ator; e a colisão com tema
-- JÁ DESCARTADO nasce `descartada` herdada — a supressão silenciosa da era das
-- ideias morre aqui (dívida 1 da Leva 0.4), com marca persistente e audit.
--
-- Notas de desenho (detalhe no ADR-037):
-- 1. `source_key` UNIQUE é a idempotência entre corridas: `--force` superseda a
--    linha de research e criaria trend duplicada se a chave fosse research_id.
--    A FK é RETRATO da captura — não re-aponta quando o run é superado.
-- 2. `semana` = rodada (semana ISO da captura, `AAAA-Wss`) — mesma janela do
--    cache da pesquisa; sem tabela de corridas (ADR-032 decisão 2).
-- 3. `roteirizada` também é TERMINAL de linha: a 2ª geração (outro contexto)
--    cria outro POST, não mexe na trend.
-- 4. `content_posts.trend_id`/`contexto` nascem nullable (roteiro avulso,
--    ADR-032 decisão 6); uma vez escritos, congelam (o vínculo não se troca).
--
-- Regra 7: tests/conteudo-trends.test.ts nasceu VERMELHO antes deste arquivo.
-- Sol pré-apply ANTES do apply (protocolo da onda; precedente M5/104/105/106).
-- =============================================================================

create table content_trends (
  id                    uuid primary key default gen_random_uuid(),
  -- Sem UNIQUE próprio de propósito: o 1:1 com a linha de research já é
  -- consequência de source_key UNIQUE + o guard que iguala os dois source_keys
  -- — e um segundo índice único quebraria o upsert do worker (ON CONFLICT com
  -- árbitro em source_key não suprime conflito de outro índice).
  research_id           uuid not null references content_research (id),
  source_key            text not null unique,
  plataforma            text not null
    constraint content_trends_plataforma_check
    check (plataforma in ('youtube', 'instagram', 'tiktok', 'x', 'reddit')),
  url                   text,
  autor                 text,
  views                 bigint
    constraint content_trends_views_check check (views is null or views >= 0),
  velocidade            numeric
    constraint content_trends_velocidade_check
    check (velocidade is null or velocidade >= 0),
  velocidade_sem_conta  boolean not null default false,
  capturada_em          timestamptz not null default now(),
  -- W01–W53: forma E faixa (achado nº 9 do Sol — '2026-W99' não é rodada).
  semana                text not null
    constraint content_trends_semana_check
    check (semana ~ '^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$'),
  travel_score          int
    constraint content_trends_travel_score_check
    check (travel_score is null or travel_score between 0 and 100),
  travel_meta           jsonb not null default '{}'::jsonb,
  travel_score_ajustado int
    constraint content_trends_travel_ajustado_check
    check (travel_score_ajustado is null or travel_score_ajustado between 0 and 100),
  status                text not null default 'nova'
    constraint content_trends_status_check
    check (status in ('nova', 'roteirizada', 'descartada')),
  discard_reason        text,
  tema_cluster          text,
  variacao_de           uuid references content_trends (id),
  decidida_por          uuid references profiles (id),
  decidida_em           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Decisão tem ator: carimbo é biCONDICIONAL de propósito (nova ⇔ sem carimbo).
  constraint content_trends_decidida_shape check (
    (status = 'nova' and decidida_por is null and decidida_em is null)
    or (status <> 'nova' and decidida_por is not null and decidida_em is not null)),

  -- Descarte exige motivo de verdade (btrim com tab/quebra — achado nº 6 do Sol
  -- na 104; \f\v entram pelo achado nº 8 do Sol nesta leva); fora de descartada
  -- o motivo NÃO existe (nem anotação solta).
  constraint content_trends_descartada_shape check (
    (status = 'descartada'
      and discard_reason is not null and btrim(discard_reason, E' \t\r\n\f\v') <> '')
    or (status <> 'descartada' and discard_reason is null))
);

create index content_trends_radar_idx on content_trends (status, semana);
create index content_trends_variacao_idx on content_trends (variacao_de)
  where variacao_de is not null;

-- ---------------------------------------------------------------------------
-- Guard: nascimento, transições, medição congelada, raiz e DELETE.
-- ---------------------------------------------------------------------------
create or replace function public.content_trends_guard()
returns trigger
language plpgsql
as $$
declare
  v_research_key text;
  v_mae_variacao uuid;
  v_mae_status text;
  v_mae_motivo text;
  v_mae_ator uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'trend % não se apaga (Lei 8) — descartar é estado', old.id;
  end if;

  if tg_op = 'INSERT' then
    -- Proveniência sem fresta: a trend fala da MESMA fonte que a linha de
    -- research aponta, e essa linha é a ATIVA no momento da captura (achado
    -- nº 1 do Sol — linha superada não vira trend; a FK segue retrato DEPOIS,
    -- quando runs futuros superarem esta linha).
    select cr.source_key into v_research_key
      from public.content_research cr
     where cr.id = new.research_id and cr.superseded_by is null;
    if v_research_key is null then
      raise exception
        'trend exige a linha ATIVA de research — % inexistente ou superada',
        new.research_id;
    end if;
    if v_research_key is distinct from new.source_key then
      raise exception
        'source_key da trend (%) diverge da linha de research (%)',
        new.source_key, v_research_key;
    end if;

    if new.variacao_de is not null then
      -- FOR SHARE trava a mãe até o COMMIT desta filha (achado nº 5 do Sol):
      -- um descarte concorrente da mãe espera, e a cascata dele já enxerga a
      -- filha. Mãe invisível (não confirmada, inexistente ou AUTORREFERÊNCIA —
      -- achados nº 6/7) é recusada aqui, não herdada da sorte do snapshot.
      select t.variacao_de, t.status, t.discard_reason, t.decidida_por
        into v_mae_variacao, v_mae_status, v_mae_motivo, v_mae_ator
        from public.content_trends t where t.id = new.variacao_de for share;
      if v_mae_status is null then
        raise exception
          'mãe % inexistente ou não confirmada — variação sem raiz visível',
          new.variacao_de;
      end if;
      -- Profundidade 1: variação aponta para a RAIZ do tema, nunca para outra
      -- variação (a cadeia transitiva A~B~C fica coberta — dívida 2 da 0.4).
      if v_mae_variacao is not null then
        raise exception
          'variação aponta para a RAIZ do tema — % já é variação', new.variacao_de;
      end if;
      -- Mãe descartada não ganha filha NOVA (achado nº 3 do Sol): a cascata já
      -- passou; o tema morreu — a filha nasce descartada herdando, ou não nasce.
      if new.status = 'nova' and v_mae_status = 'descartada' then
        raise exception
          'tema já descartado na mãe % — variação nasce descartada herdando motivo e ator',
          new.variacao_de;
      end if;
    end if;

    if new.status = 'nova' then
      return new;
    end if;

    -- Única exceção ao "nasce nova": colisão com tema DESCARTADO nasce
    -- descartada HERDANDO motivo e ator (fim da supressão silenciosa). A
    -- herança é EXATA (achado nº 4 do Sol): motivo prefixado da mãe e o MESMO
    -- ator — inventar autoria/motivo aqui seria audit de fachada.
    if new.status = 'descartada' and new.variacao_de is not null then
      if v_mae_status is distinct from 'descartada' then
        raise exception
          'variação só nasce descartada quando a mãe está descartada (mãe % está %)',
          new.variacao_de, coalesce(v_mae_status, 'inexistente');
      end if;
      if new.discard_reason is distinct from ('tema descartado na mãe: ' || v_mae_motivo)
         or new.decidida_por is distinct from v_mae_ator then
        raise exception
          'variação descartada HERDA da mãe % — motivo prefixado e mesmo ator',
          new.variacao_de;
      end if;
      return new;
    end if;

    raise exception 'trend nasce como NOVA — decidir é transição';
  end if;

  -- UPDATE: decidida é terminal de linha (nota 3 do cabeçalho).
  if old.status in ('roteirizada', 'descartada') then
    raise exception 'trend % está % — imutável (Lei 8)', old.id, old.status;
  end if;

  if new.status <> old.status and new.status not in ('roteirizada', 'descartada') then
    raise exception 'transição inválida de % para % na trend %',
      old.status, new.status, old.id;
  end if;

  -- Fora da decisão e da nota que se cura, TUDO é retrato da captura — nem o
  -- owner reescreve medição, proveniência ou o vínculo de variação.
  if to_jsonb(new) - array['status', 'discard_reason', 'travel_score', 'travel_meta',
                           'travel_score_ajustado', 'tema_cluster',
                           'decidida_por', 'decidida_em', 'updated_at']
     <> to_jsonb(old) - array['status', 'discard_reason', 'travel_score', 'travel_meta',
                              'travel_score_ajustado', 'tema_cluster',
                              'decidida_por', 'decidida_em', 'updated_at'] then
    raise exception 'medição da trend % é retrato da captura — congelada', old.id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger content_trends_guard
  before insert or update or delete on content_trends
  for each row execute function public.content_trends_guard();

-- ---------------------------------------------------------------------------
-- Cascata do descarte (ADR-032 decisão 3): descartar a mãe descarta as
-- variações que ainda são NOVAS, herdando motivo (prefixado) e ator. Variação
-- já decidida não é tocada. Profundidade 1 garante que a cascata não recorre.
-- ---------------------------------------------------------------------------
create or replace function public.content_trends_cascata_descarte()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'nova' and new.status = 'descartada' then
    update public.content_trends
       set status = 'descartada',
           discard_reason = 'tema descartado na mãe: ' || new.discard_reason,
           decidida_por = new.decidida_por,
           decidida_em = now()
     where variacao_de = new.id and status = 'nova';
  end if;
  return null;
end;
$$;

create trigger content_trends_cascata_descarte
  after update on content_trends
  for each row execute function public.content_trends_cascata_descarte();

-- TRUNCATE à parte: trigger de LINHA não dispara em truncate (lição do M4).
create or replace function public.content_trends_sem_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'TRUNCATE proibido em content_trends — curadoria do radar (Lei 8)';
end;
$$;

create trigger content_trends_sem_truncate
  before truncate on content_trends
  for each statement execute function public.content_trends_sem_truncate();

-- Lei 8: trilha completa (ator/diff) — padrão F1.
create trigger content_trends_audit
  after insert or update or delete on content_trends
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- RLS + GRANTS (duas mãos por coluna — ver cabeçalho).
-- ---------------------------------------------------------------------------
alter table content_trends enable row level security;

create policy content_trends_admin_all on content_trends
  for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

-- Lição 20260714000600: revoke explícito (inclusive PUBLIC) antes dos grants
-- cirúrgicos — privilégio de tabela anularia o selo de coluna.
revoke all on content_trends from public, anon, authenticated, service_role;

grant select on content_trends to anon, authenticated;  -- RLS decide as linhas

-- A MÃO HUMANA: decidir e ajustar — nunca inserir, nunca mexer na medição.
grant update (status, discard_reason, travel_score_ajustado, tema_cluster,
              decidida_por, decidida_em)
  on content_trends to authenticated;

-- A MÃO DO ROBÔ: captura no INSERT (com as colunas da herança); no UPDATE, só
-- a nota que se cura. id/capturada_em/created_at/updated_at ficam com o banco;
-- tema_cluster/travel_score_ajustado são da admin.
grant select on content_trends to service_role;
grant insert (research_id, source_key, plataforma, url, autor, views, velocidade,
              velocidade_sem_conta, semana, travel_score, travel_meta, status,
              discard_reason, decidida_por, decidida_em, variacao_de)
  on content_trends to service_role;
grant update (travel_score, travel_meta) on content_trends to service_role;

comment on table content_trends is
  'Camada de CURADORIA do radar (ADR-032/037). Cada trend deriva de uma linha '
  'ATIVA de analise_reel em content_research (FK research_id + source_key '
  'idênticos; retrato da captura — não re-aponta em supersessão). Estados: '
  'nova → roteirizada | descartada (motivo + ator obrigatórios; ambas '
  'terminais). Duas mãos por grant de coluna: robô insere a captura e cura '
  'travel_score/travel_meta enquanto nova; admin decide (status, motivo, '
  'ajuste, cluster). Variação = linha própria (variacao_de → raiz, prof. 1); '
  'descarte da mãe cascateia às variações novas; colisão com tema descartado '
  'nasce descartada herdada. DELETE/TRUNCATE proibidos.';

comment on column content_trends.velocidade is
  'views/dia ÷ mediana de views da conta cadastrada (content_creators.metricas '
  '"views medianas"). Sem conta/mediana: views/dia puro + velocidade_sem_conta '
  '(ADR-032 decisão 2).';
comment on column content_trends.semana is
  'A RODADA: semana ISO da captura (AAAA-Wss), mesma janela do cache da '
  'pesquisa — sem tabela de corridas.';
comment on column content_trends.travel_score is
  'Nota 0-100 do prompt content-travel-score (ADR-033, pergunta AMPLA). NULL = '
  'falha fail-open — fica fora da aba PT com aviso e a corrida seguinte cura.';
comment on column content_trends.travel_meta is
  'Justificativa + proveniência da nota (prompt_versao, modelo, avaliado_em).';
comment on column content_trends.travel_score_ajustado is
  'A válvula da dona (ADR-033 decisão 4): quando presente, vence SEMPRE.';
comment on column content_trends.variacao_de is
  'Trend-mãe do MESMO tema (dedup ADR-034). Aponta sempre para a raiz; o '
  'descarte da mãe vale para as variações.';

-- ---------------------------------------------------------------------------
-- content_posts: a ponte trend → roteiro (ADR-032 decisão 6).
-- ---------------------------------------------------------------------------
alter table content_posts add column trend_id uuid references content_trends (id);
alter table content_posts add column contexto text
  constraint content_posts_contexto_check check (contexto in ('geral', 'travel'));

create index content_posts_trend_idx on content_posts (trend_id)
  where trend_id is not null;

comment on column content_posts.trend_id is
  'Trend de origem (NULL = roteiro avulso). Entra no nascimento (RPC da Leva 5) '
  'ou na migração 2.3; uma vez escrito, não se troca nem se apaga.';
comment on column content_posts.contexto is
  'Contexto de destino do roteiro (geral | travel — ADR-035). 1 trend → N '
  'posts, um por contexto/geração. Congela como trend_id.';

-- Guard: CREATE OR REPLACE da função da 104 (trigger fica). ÚNICA mudança: o
-- vínculo trend_id/contexto congela depois de escrito. As colunas novas ficam
-- FORA da whitelist pós-aprovação de propósito — pós-aprovado, nem NULL→valor.
create or replace function public.content_posts_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'ideia' then
      raise exception 'post de conteúdo nasce como IDEIA — aprovações são transições';
    end if;
    -- Motivo de arquivamento não nasce com o post (achado nº 5 do Sol): a
    -- coluna só se escreve NA transição para arquivado.
    if new.archived_reason is not null then
      raise exception 'archived_reason só se escreve ao arquivar — post nasce sem motivo';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'post de conteúdo % não se apaga (Lei 8) — use o estado descartado', old.id;
  end if;

  if old.status in ('publicado', 'descartado', 'ciclo_futuro', 'arquivado') then
    raise exception 'post % está % — imutável (Lei 8)', old.id, old.status;
  end if;

  if new.status <> old.status then
    if not (
      (old.status = 'ideia'          and new.status in ('ideia_aprovada', 'rejeitado', 'descartado', 'ciclo_futuro', 'arquivado')) or
      (old.status = 'ideia_aprovada' and new.status in ('gerando', 'descartado', 'ciclo_futuro', 'arquivado')) or
      (old.status = 'gerando'        and new.status in ('rascunho', 'ideia_aprovada', 'descartado', 'ciclo_futuro', 'arquivado')) or
      (old.status = 'rascunho'       and new.status in ('aprovado', 'rejeitado', 'descartado', 'ciclo_futuro', 'arquivado')) or
      (old.status = 'rejeitado'      and new.status in ('ideia_aprovada', 'descartado', 'ciclo_futuro', 'arquivado')) or
      (old.status = 'aprovado'       and new.status in ('publicado', 'ciclo_futuro', 'arquivado'))
    ) then
      raise exception 'transição inválida de % para % no post %', old.status, new.status, old.id;
    end if;
  end if;

  -- archived_reason só muda entrando em arquivado (achado nº 5 do Sol) — em
  -- qualquer outro destino a coluna é imutável, inclusive limpar.
  if new.archived_reason is distinct from old.archived_reason
     and new.status <> 'arquivado' then
    raise exception 'archived_reason só se escreve na transição para arquivado (post %)', old.id;
  end if;

  -- A ponte com o radar entra vazia e se escreve UMA vez (Leva 2.1): trocar ou
  -- limpar o vínculo re-escreveria a história de onde o roteiro veio.
  if old.trend_id is not null and new.trend_id is distinct from old.trend_id then
    raise exception 'o vínculo do post % com a trend não se troca nem se apaga', old.id;
  end if;
  if old.contexto is not null and new.contexto is distinct from old.contexto then
    raise exception 'o contexto do post % não se troca nem se apaga', old.id;
  end if;

  if old.status = 'aprovado' then
    -- WHITELIST pós-aprovação (achado 26 de progress_reports): só publicação
    -- anda — e, desde a Leva 0.2, o motivo do arquivamento.
    if to_jsonb(new) - array['status', 'post_url', 'published_by', 'published_at', 'scheduled_for', 'archived_reason', 'updated_at']
       <> to_jsonb(old) - array['status', 'post_url', 'published_by', 'published_at', 'scheduled_for', 'archived_reason', 'updated_at'] then
      raise exception 'post % aprovado tem conteúdo congelado — só publicação/agenda/arquivamento mudam', old.id;
    end if;
  end if;

  -- Saída de rejeitado para TERMINAL novo não abre janela de edição (achado
  -- nº 2 do Sol): o registro congelado do portão vai para o arquivo COMO ESTÁ.
  if old.status = 'rejeitado' and new.status in ('ciclo_futuro', 'arquivado') then
    if to_jsonb(new) - array['status', 'archived_reason', 'updated_at']
       <> to_jsonb(old) - array['status', 'archived_reason', 'updated_at'] then
      raise exception 'post % rejeitado vai para % como está — conteúdo congelado', old.id, new.status;
    end if;
  end if;

  -- Conteúdo de post rejeitado fica congelado como registro do portão: o motivo
  -- é o feedback; "tentar de novo" é transição, não edição.
  if old.status = 'rejeitado' and new.status = 'rejeitado' then
    raise exception 'post % rejeitado não se edita — tente de novo ou descarte', old.id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on table content_posts is
  'Posts sociais da fábrica de conteúdo (ADR-021; Estúdio v2 em ADR-032). '
  'Nasce SEMPRE ideia; transições só pelo mapa do content_posts_guard; DELETE '
  'proibido (descartado é estado). Estados terminais: publicado, descartado, '
  'ciclo_futuro (formato parqueado p/ ciclo futuro) e arquivado (pré-esteira, '
  'motivo em archived_reason). Ponte com o radar: trend_id/contexto (Leva 2.1; '
  'congelam depois de escritos). Imagens no Drive (Lei 10); texto fora da '
  'imagem (Lei 11).';

-- Reload do schema cache do PostgREST (precedente da 106): redundante onde o
-- watcher de DDL existe, inofensivo onde não existe.
notify pgrst, 'reload schema';
