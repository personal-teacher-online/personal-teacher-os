-- PAUTA — criadores de referência (M4 do ciclo 1 de conteúdo, 01/08/2026).
--
-- O "de quem a gente aprende": os criadores BR e internacionais cujo conteúdo
-- PÚBLICO alimenta a pesquisa de pauta. Hoje essa lista vive fixa em código
-- (`scripts/spike-pauta/spike-pauta.ts`, 4 nomes escolhidos no M2.0); aqui ela
-- vira cadastro de produção, com tela, dono e trilha de auditoria. Quem lê esta
-- tabela é o worker de pesquisa do M5; quem escreve o cadastro é a admin.
--
-- ADR-031: a pauta JAMAIS consome dados de alunos, e bruto de terceiro (vídeo,
-- áudio) nunca é persistido — só derivados (transcrição, análise, métricas
-- públicas agregadas).
--
-- ── DUAS MÃOS, COLUNAS DISJUNTAS (a regra que o GRANT faz valer) ────────────
-- A admin escreve o CADASTRO (plataforma, handle, nome, pais, notas, ativo).
-- O worker escreve a MEDIÇÃO (metricas, medido_em) — e mais nada. Não é regra da
-- tela: são privilégios de COLUNA, então nenhuma outra porta de escrita a
-- contorna (Lei 3). `created_by` não tem grant de UPDATE para ninguém: quem
-- cadastrou não se troca.
--
-- ── CONTRATO DA MEDIÇÃO ─────────────────────────────────────────────────────
-- `metricas` é SNAPSHOT SUBSTITUÍDO (decisão declarada no goal do ciclo 1): a
-- corrida nova sobrescreve o jsonb inteiro e recarimba `medido_em`, na MESMA
-- instrução. Histórico, se um dia for preciso, entra por migration ADITIVA — e
-- o mesmo vale para a identidade externa da fonte (`platform_external_id`/URL
-- canônica), diferida ao M5 de propósito: quem resolve id de canal é o coletor,
-- e é ele que sabe a forma de cada rede.
-- O CHECK `medicao_shape` é IMPLICAÇÃO, não bicondicional: dado exige carimbo,
-- mas '{}' COM carimbo é legítimo e significa "mediu e não achou nada" — o caso
-- medido no spike M2.0 (Speak English With Vanessa: zero Shorts ≤90s em 100
-- uploads). Bicondicional tornaria esse estado irrepresentável e obrigaria o
-- worker a inventar convenção dentro do JSON.
--
-- Guards em `tests/pauta-fabrica.test.ts` (parte 1) — escritos e vistos falhar
-- antes deste arquivo existir (regra 7 do fluxo da frente de conteúdo).

create table content_creators (
  id uuid primary key default gen_random_uuid(),
  plataforma text not null check (plataforma in ('youtube', 'instagram', 'tiktok', 'x')),
  -- O FORMATO CANÔNICO, espelhado em `HANDLE_FORMATO` (src/data/admin/pauta-gramatica.ts):
  -- sem @, sem espaço, sem URL. O worker monta endereço de API a partir deste
  -- texto, e ' escola ' — que passaria num "não vazio" — nem colide com 'escola' no
  -- índice único (lower() de dois textos diferentes é diferente) nem resolve na
  -- API. URL colada é RECUSADA, não adivinhada: as quatro redes têm formas de
  -- endereço distintas e `channel/UC…` sequer é handle.
  handle text not null constraint content_creators_handle_formato
    check (handle ~ '^[A-Za-z0-9._-]+$'),
  nome text not null check (btrim(nome) <> ''),
  -- Recorte de MERCADO (o equilíbrio que a pauta persegue), não país de
  -- residência: BR = referência na mesma língua materna do público; INT = ritmo
  -- e formato do mercado de fora. O rótulo da tela diz isso em português.
  pais text not null check (pais in ('BR', 'INT')),
  notas text,
  -- Sair de cena é `ativo = false` — DELETE é proibido (Lei 8).
  ativo boolean not null default true,
  metricas jsonb not null default '{}'::jsonb,
  medido_em timestamptz,
  created_by uuid references profiles (id),      -- NULL = seed/bancada
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_creators_medicao_shape
    check (metricas = '{}'::jsonb or medido_em is not null)
);

-- Case-insensitive: 'AskJackie' e 'askjackie' são o MESMO canal (as redes não
-- distinguem caixa no handle). A caixa digitada fica preservada para exibição —
-- por isso o índice funcional, e não `citext` ou `lower()` na coluna.
create unique index content_creators_plataforma_handle_unique
  on content_creators (plataforma, lower(handle));

comment on table content_creators is
  'Criadores de referência da pauta de conteúdo (M4/ADR-031): de quem a pesquisa '
  'aprende. A admin cadastra e cura (plataforma, handle, nome, mercado BR/INT, '
  'notas, ativo); o worker de pesquisa escreve APENAS metricas+medido_em, por '
  'grant de coluna. metricas é snapshot SUBSTITUÍDO, com {} + carimbo '
  'significando "mediu e não achou nada". DELETE proibido (Lei 8): desative.';

create or replace function public.content_creators_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'criador de pauta % não se apaga (Lei 8) — desative-o (ativo = false)', old.id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Só UPDATE e DELETE: o nascimento não tem regra além dos CHECKs, e trigger
-- no-op por linha inserida é custo sem contrapartida.
create trigger content_creators_guard
  before update or delete on content_creators
  for each row execute function public.content_creators_guard();

-- Lei 8: trilha completa (ator/diff) — padrão F1.
create trigger content_creators_audit
  after insert or update or delete on content_creators
  for each row execute function public.audit_row_change();

alter table content_creators enable row level security;

create policy content_creators_admin_all on content_creators
  for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

-- Lição 20260714000600: revoke explícito antes dos grants cirúrgicos (o grant
-- amplo de 20260711000700 e os default privileges do owner alcançam tabela nova).
revoke insert, update, delete, truncate on content_creators
from anon, authenticated, service_role;

grant select on content_creators to anon, authenticated;  -- RLS decide as linhas (caso 12)

-- A MÃO HUMANA: só o cadastro. `created_by` entra no INSERT (a action carimba o
-- ator) e fica FORA do UPDATE — autoria não se reescreve. `metricas`/`medido_em`
-- não aparecem em nenhum dos dois: a admin não digita número de audiência.
grant insert (plataforma, handle, nome, pais, notas, ativo, created_by)
  on content_creators to authenticated;
grant update (plataforma, handle, nome, pais, notas, ativo)
  on content_creators to authenticated;

-- A MÃO DO ROBÔ: lê o cadastro para saber quem coletar, e só recarimba a
-- medição. Sem INSERT: quem entra na pauta é decisão editorial, não descoberta
-- automática.
grant select on content_creators to service_role;
grant update (metricas, medido_em) on content_creators to service_role;

-- DELETE: ninguém (o guard é a 2ª linha de defesa).
-- TRUNCATE: coberto pelo revoke — trigger de LINHA não dispara em truncate.
