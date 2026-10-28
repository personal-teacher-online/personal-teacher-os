-- =============================================================================
-- Estúdio v2 — Leva 0.4 (ADR-034): `content_embeddings`, a memória vetorial da
-- dedup temática.
--
-- O problema medido (acervo de 02/08): o mesmo TEMA entrando por fontes
-- diferentes — "substituir o WHAT?" 3×, "pedir café sem I want" 5×, "role-play
-- de imigração" 8× — porque a dedup era por fonte (link), não por tema, e as
-- famílias são bilíngues (léxico não pega "pedir café" × "ordering coffee").
--
-- O desenho: cada ideia (e, na Leva 2+, cada trend) ganha um embedding
-- (Gemini `gemini-embedding-001`, 768 dims) gravado aqui pelo WORKER. Antes de
-- criar ideia nova, o worker compara por cosseno contra TODAS as já embedadas
-- — vivas, descartadas e arquivadas — e colisão vira variação anexada à mãe
-- (ou supressão, quando a mãe é tema que a dona descartou). O limiar vive no
-- código, decidido por medição com fixtures REAIS (tests/conteudo-dedup).
--
-- Decisões de desenho:
-- 1. Infra do ROBÔ, não tela: authenticated/anon sem NENHUM grant (nem
--    SELECT). Escreve service_role; upsert por (escopo, ref_id).
-- 2. NINGUÉM apaga (nem o dono, por trigger): o embedding do tema DESCARTADO
--    é exatamente o que impede o tema de renascer na próxima corrida — apagar
--    seria reabrir a porta. TRUNCATE idem (molde content_research).
-- 3. SEM audit_row_change: embedding é cache derivado do texto, não decisão
--    de negócio — a decisão auditável (variação anexada / ideia criada) vive
--    em content_posts, que já tem audit.
-- 4. SEM índice ANN de propósito (dezenas de linhas; scan sequencial é
--    exato e instantâneo). Gatilho anotado: passou de ~2.000 linhas vivas,
--    criar índice HNSW em migration aditiva.
-- =============================================================================

create extension if not exists vector;

create table content_embeddings (
  id uuid primary key default gen_random_uuid(),
  escopo text not null check (escopo in ('ideia', 'trend')),
  ref_id uuid not null,
  embedding vector(768) not null,
  modelo text not null check (btrim(modelo) <> ''),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (escopo, ref_id)
);

comment on table content_embeddings is
  'Memória vetorial da dedup temática do Estúdio (ADR-034). Uma linha por '
  'ideia/trend embedada (Gemini 768d); comparação por cosseno no worker antes '
  'do INSERT. Escrita só do robô (service_role); DELETE/TRUNCATE proibidos — '
  'o vetor do tema descartado é o que impede o tema de renascer.';
comment on column content_embeddings.ref_id is
  'id do objeto embedado: content_posts.id (escopo=ideia) ou content_trends.id '
  '(escopo=trend, Leva 2+). Sem FK de propósito: as tabelas-alvo variam por '
  'escopo, e o vetor sobrevive ao ciclo de vida do alvo.';

create or replace function public.content_embeddings_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'embedding não se apaga — é a memória que impede tema descartado de renascer';
  end if;
  if new.escopo <> old.escopo or new.ref_id <> old.ref_id
     or new.id <> old.id or new.criado_em <> old.criado_em then
    raise exception 'identidade do embedding (id, escopo, ref_id, criado_em) é imutável — crie outra linha';
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;

create trigger content_embeddings_guard
  before update or delete on content_embeddings
  for each row execute function public.content_embeddings_guard();

create or replace function public.content_embeddings_sem_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'TRUNCATE proibido em content_embeddings — memória da dedup (ADR-034)';
end;
$$;

create trigger content_embeddings_sem_truncate
  before truncate on content_embeddings
  for each statement execute function public.content_embeddings_sem_truncate();

alter table content_embeddings enable row level security;

-- Padrão da casa (invariante do rls.test): SELECT concedido e RLS SEM policy
-- devolve VAZIO para anon/authenticated — negar-por-padrão pela Lei 4, não por
-- permission denied. Escrita segue só do robô: service_role (BYPASSRLS) opera
-- pelos grants; ninguém mais insere/edita, e DELETE não existe para ninguém.
revoke all on content_embeddings from anon, authenticated, service_role;
grant select on content_embeddings to anon, authenticated;
grant select, insert, update on content_embeddings to service_role;
