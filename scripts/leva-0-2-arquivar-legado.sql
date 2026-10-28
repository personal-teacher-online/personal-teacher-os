-- =============================================================================
-- Estúdio v2 — Leva 0.2: script de DADOS (produção). NÃO é migration.
--
-- Rodar via psql no container do banco, DEPOIS da migration
-- 20260802000100_estudio_estados_legados.sql, com dump prévio de content_posts:
--
--   sudo docker exec -i <db> psql -U postgres -d postgres \
--     -v ator=<uuid-do-admin-operacional> -f /tmp/leva-0-2-arquivar-legado.sql
--
-- O que faz (decisões de produto §2.13 + decisão 6 do dono, 02/08):
--   1) carrossel/story em estado PENDENTE (ideia|ideia_aprovada|gerando|
--      rejeitado) → ciclo_futuro. Rascunhos FICAM (decisão 6); aprovados/
--      publicados não são pendência e não são tocados.
--   2) reels em `ideia` sem etiqueta `pauta:` → arquivado("pré-esteira").
--
-- Fail-loud ANTES de mexer: se o alvo do arquivamento tiver linha com
-- created_by NÃO-nulo (ideia manual, não fornada de robô), ABORTA — decisão
-- é do dono, não do script. Transação única: qualquer exceção desfaz tudo.
-- O ator entra no audit via request.jwt.claims (auth.uid() lê o sub).
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?ator}
\else
\echo 'ERRO: rode com -v ator=<uuid-do-admin-operacional>'
\q
\endif

begin;

-- Corrida zero (achado nº 3 do Sol): trava escrita concorrente enquanto o
-- script classifica e move — leitura segue livre; a janela dura segundos.
lock table content_posts in share row exclusive mode;

-- O ator tem de ser um admin REAL (achado nº 7 do Sol) — audit não recebe
-- autoria de fachada. Nota psql: variável NÃO interpola dentro de $$…$$,
-- então o valor viaja por GUC.
select set_config('leva02.ator', :'ator', true);
do $$
declare v_ator uuid; v_role text;
begin
  v_ator := current_setting('leva02.ator')::uuid;
  select raw_app_meta_data ->> 'role' into v_role
    from auth.users where id = v_ator;
  if v_role is distinct from 'admin' then
    raise exception 'ABORTADO: ator % não é admin (role=%)', v_ator, coalesce(v_role, 'inexistente');
  end if;
end $$;

-- Ator do audit (auth.uid() = claims->>'sub') — padrão §AB.1.
select set_config('request.jwt.claims',
  json_build_object('sub', :'ator', 'role', 'authenticated')::text, true);

-- ---------------------------------------------------------------------------
-- Retrato ANTES (colar no runbook §AD).
-- ---------------------------------------------------------------------------
select kind, status, count(*)::int as n
  from content_posts group by 1, 2 order by 1, 2;

-- ---------------------------------------------------------------------------
-- Guarda: alvo do arquivamento não pode conter criação manual.
-- ---------------------------------------------------------------------------
do $$
declare v int;
begin
  select count(*) into v from content_posts
   where kind = 'roteiro_reel' and status = 'ideia'
     and (external_ref is null or external_ref not like 'pauta:%')
     and created_by is not null;
  if v > 0 then
    raise exception 'ABORTADO: % reel(s) MANUAIS no alvo do arquivamento — levar ao dono', v;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) carrossel/story pendentes → ciclo_futuro.
-- ---------------------------------------------------------------------------
with movidos as (
  update content_posts set status = 'ciclo_futuro'
   where kind in ('carrossel', 'story')
     and status in ('ideia', 'ideia_aprovada', 'gerando', 'rejeitado')
  returning 1)
select count(*)::int as carrossel_story_para_ciclo_futuro from movidos;

-- ---------------------------------------------------------------------------
-- 2) reels pré-esteira → arquivado("pré-esteira").
-- ---------------------------------------------------------------------------
with movidos as (
  update content_posts set status = 'arquivado', archived_reason = 'pré-esteira'
   where kind = 'roteiro_reel' and status = 'ideia'
     and (external_ref is null or external_ref not like 'pauta:%')
  returning 1)
select count(*)::int as reels_para_arquivado from movidos;

-- ---------------------------------------------------------------------------
-- Retrato DEPOIS + sanidade fail-loud.
-- ---------------------------------------------------------------------------
select kind, status, count(*)::int as n
  from content_posts group by 1, 2 order by 1, 2;

-- "Para você" (ideia|rascunho) depois da limpeza: só ideias da pauta e os
-- rascunhos que a decisão 6 preserva. Sobrou ideia sem pauta = algo escapou.
do $$
declare v int;
begin
  select count(*) into v from content_posts
   where status = 'ideia'
     and (external_ref is null or external_ref not like 'pauta:%');
  if v > 0 then
    raise exception 'ABORTADO: % ideia(s) sem etiqueta pauta ainda pendentes após a limpeza', v;
  end if;
end $$;

-- O que ficou pendente (esperado: rascunhos legados + ideias pauta:).
select id, kind, status, external_ref, created_by is null as robo
  from content_posts where status in ('ideia', 'rascunho') order by created_at;

commit;
