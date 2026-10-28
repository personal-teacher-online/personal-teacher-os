-- ===========================================================================
-- HIGIENE DE ACL — a porta do `anon` fechada
--
-- Decisão do dono depois do achado da janela §AJ (Leva 5): leva própria de
-- higiene ANTES de convidar os alunos reais.
--
-- ── O RETRATO MEDIDO EM PRODUÇÃO ANTES DE ESCREVER ISTO ────────────────────
--   542 funções no schema `public`, das quais 306 são de EXTENSÃO
--   (btree_gist 188 · vector 118) e 236 são NOSSAS. Dessas, 74 executáveis por
--   `anon`: 28 gatilhos, 23 `invoker` (nenhuma escreve), 18 `definer` que
--   checam quem chama, e 5 `definer` SEM checagem — todas de leitura. As cinco
--   (`_teacher_payable_cents`, `_teacher_rate_on`, `my_contract_ids`,
--   `my_group_ids`, `teacher_student_ids`) vazam taxa horária de professora e
--   ids de contrato/turma para quem adivinhar um uuid. Nenhuma escrita exposta.
--
-- ── POR QUE FECHAR É SEGURO (medido, não suposto) ──────────────────────────
--   · NENHUMA das 97 policies de RLS se aplica a `anon` — todas nomeiam papel
--     explícito. Anon nunca dispara avaliação de função por policy.
--   · Não existe cliente de NAVEGADOR no projeto: todo RPC é server-side, com
--     sessão (`authenticated`) ou service_role.
--   · ZERO funções que `authenticated` ou `service_role` executam dependem do
--     `PUBLIC` — todas têm grant explícito, então revogar o PUBLIC não as toca.
--
-- ⚠️ REVOGAR DO `PUBLIC` É O QUE FECHA. `anon` HERDA o EXECUTE do PUBLIC:
--    `revoke … from anon` sozinho não fecha nada. É o espelho da lição da 109,
--    onde `revoke … from public` não tirava o grant do papel NOMEADO — as duas
--    pontas precisam ser ditas.
--
-- ── O QUE ESTA MIGRATION NÃO FAZ ───────────────────────────────────────────
--   · Não toca em função de EXTENSÃO (o laço exclui quem tem `pg_depend`
--     do tipo 'e'): revogar `vector`/`btree_gist` quebraria os embeddings da
--     dedup e as constraints de exclusão da agenda.
--   · Não mexe em `authenticated` (173 das nossas). A exposição dele é pequena
--     — as `definer` checam quem chama, as `invoker` a RLS protege — e o risco
--     de quebrar é grande por causa da cadeia transitiva de função `invoker`
--     (o EXECUTE das internas é checado contra o papel de QUEM CHAMA).
--     Fica como dívida escrita, com a lista branca já levantada.
--   · Não mexe no default privilege do `supabase_admin`: é da gestão do
--     próprio Supabase. O buraco que sobra é coberto por teste permanente
--     (`tests/acl-higiene.test.ts` reprova se qualquer função nossa aparecer
--     executável por anon).
-- ── SONDAS DE PRODUÇÃO PEDIDAS PELO PASSE ADVERSARIAL (todas rodadas hoje) ──
--   · nenhuma função falsamente excluída pelo predicado de extensão;
--   · `anon` não é membro de papel nenhum (não há EXECUTE por herança);
--   · os 9 jobs do pg_cron rodam como `postgres` (dono) — nada depende do PUBLIC;
--   · todas as 236 funções nossas são de owner `postgres` (o laço não aborta);
--   · o default privilege de função é POR SCHEMA (`in schema public` acerta a
--     linha certa; não existe linha global);
--   · as 3 views que `anon` pode ler foram medidas COMO anon: `payments_student`
--     e `teacher_agenda` devolvem 0 linhas (o filtro delas usa as funções de
--     identidade, vazias para anon) e `teacher_public` devolve 1 por desenho.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. O laço: fecha PUBLIC e anon em todas as NOSSAS funções.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_fechadas int := 0;
begin
  for r in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       -- Achado 1 do Sol: `objid` sozinho NÃO identifica o catálogo — a
       -- identidade em pg_depend é (classid, objid, objsubid). Sem `classid`,
       -- uma função nossa cujo OID coincida com o de outro objeto de extensão
       -- seria falsamente poupada do revoke (e o teste, com o mesmo predicado,
       -- ficaria verde por cima). Medido em produção hoje: nenhuma nesse caso —
       -- mas o predicado certo é o predicado certo.
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_proc'::regclass
            and d.objid = p.oid
            and d.refclassid = 'pg_extension'::regclass
            and d.deptype = 'e'
       )
  loop
    execute format('revoke execute on function %s from public, anon', r.assinatura);
    v_fechadas := v_fechadas + 1;
  end loop;
  raise notice 'higiene de ACL: % funções nossas fechadas para public e anon', v_fechadas;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. O ÚNICO caminho que quebraria: o MCP.
--
-- `ptos_mcp_ro` (mcp/server.ts, migration 20260715000700) tinha 8 grants
-- explícitos, mas a cadeia de `makeup_balance` desce até
-- `_makeup_remaining_credits`, que até aqui só funcionava pelo PUBLIC — e
-- `makeup_balance` é `security invoker`, então o EXECUTE da interna é checado
-- contra o papel que chama. O fecho transitivo das três funções que o MCP usa
-- (`makeup_balance`, `mentorship_windows_unlocked`, `mentorship_can_book`) é
-- exatamente os 8 de sempre + esta.
-- ---------------------------------------------------------------------------
grant execute on function public._makeup_remaining_credits(uuid) to ptos_mcp_ro;

-- ⚠️ NÃO se concede `ptos_mcp_ro` ao `postgres` para facilitar prova (achado 10
-- do Sol): membership criada por conveniência de teste é mudança permanente e
-- cluster-wide, e `set role` nela ativaria o BYPASSRLS do papel. A prova do
-- fecho é por PRIVILÉGIO, função a função — no teste e na sonda da janela.
-- (Medido depois: `postgres` JÁ é membro do papel, porque foi quem o criou —
-- o Postgres dá membership ao criador. Mais uma razão para não escrever um
-- grant que não muda nada e ainda sugere que mudou.)

-- ---------------------------------------------------------------------------
-- 3. Os dois helpers internos saem também do `authenticated`.
--
-- São `definer` SEM checagem de quem chama e vazam a taxa horária da
-- professora. Os únicos chamadores (`generate_teacher_statement`,
-- `close_teacher_statement`, `admin_add_rate_period`, `admin_remove_rate_period`)
-- são `security definer` e rodam como o dono — revogar não os afeta.
-- ---------------------------------------------------------------------------
revoke execute on function public._teacher_payable_cents(uuid, date, date) from authenticated;
revoke execute on function public._teacher_rate_on(uuid, date) from authenticated;

-- ---------------------------------------------------------------------------
-- 3b. O QUE OS GUARDS ACHARAM: 16 funções que o app chama por SESSÃO e que não
-- tinham grant explícito em migration nenhuma — funcionavam por herança do
-- PUBLIC. Em produção elas também têm `authenticated=X` do default privilege,
-- então lá estes grants são no-op; no banco LOCAL (que não tem esse default)
-- elas caíam junto com o PUBLIC e derrubaram 82 casos da suíte. Tornar o
-- privilégio EXPLÍCITO é o ponto inteiro desta leva: nada de acesso herdado.
--
-- Como cada uma é usada: `cancel_class`/`complete_class` são as ações da
-- agenda; a família `slide_image_*` é a fábrica de imagens; `payment_*` está
-- dentro da view `payments_student` que o portal lê; `contract_active_slot_duration`
-- é a tela de resgate; e os dois `_briefing_*` são CHECK de coluna — avaliados
-- como quem faz o INSERT, então o papel do aluno precisa deles.
-- ---------------------------------------------------------------------------
grant execute on function public._briefing_em_branco(p_txt text) to authenticated;
grant execute on function public._briefing_update_secoes_ok(p_answers jsonb) to authenticated;
grant execute on function public.cancel_class(p_instance uuid, p_cancelled_by text, p_notified_at timestamp with time zone, p_actor uuid, p_notify_email boolean, p_notify_whatsapp boolean) to authenticated;
grant execute on function public.complete_class(p_instance uuid, p_actor uuid, p_batch uuid, p_plan_item uuid, p_off_kind text, p_off_note text) to authenticated;
grant execute on function public.contract_active_slot_duration(p_contract uuid) to authenticated;
grant execute on function public.payment_em_aberto(p_status text, p_paid_at timestamp with time zone) to authenticated;
grant execute on function public.payment_nao_cobravel(p_status text) to authenticated;
grant execute on function public.payment_situacao(p_status text, p_paid_at timestamp with time zone, p_due_date date) to authenticated;
grant execute on function public.slide_image_approve(p_id uuid, p_drive_file_id text, p_drive_url text) to authenticated;
grant execute on function public.slide_image_approve_and_link(p_lesson_id uuid, p_image_id uuid, p_anchor_id text, p_candidate_index integer) to authenticated;
grant execute on function public.slide_image_failed(p_id uuid, p_error text) to authenticated;
grant execute on function public.slide_image_ready(p_id uuid, p_candidates jsonb) to authenticated;
grant execute on function public.slide_image_reject(p_id uuid) to authenticated;
grant execute on function public.slide_image_request(p_course text, p_folder text, p_name text, p_prompt text, p_framing text, p_provider text, p_count integer) to authenticated;
grant execute on function public.slide_image_started(p_id uuid, p_handle text) to authenticated;
grant execute on function public.slide_image_supersede(p_id uuid, p_drive_file_id text, p_drive_url text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Uma CAMADA a menos na fonte — e o que ela NÃO resolve.
--
-- Isto remove o `anon=X` que o default privilege do papel `postgres` carimba
-- em toda função nova deste schema (em produção ele existe; no banco local,
-- não — a mesma assimetria da lição da 109).
--
-- ⚠️ MEDIDO, e é o que importa saber: isto NÃO faz função nova nascer fechada.
-- O EXECUTE para `PUBLIC` vem do default EMBUTIDO do Postgres, que
-- `alter default privileges … in schema public revoke … from public` não
-- remove — testado nas duas formas (com e sem `for role`), e nos dois casos a
-- função nova nasce com `proacl` vazio e `anon` com EXECUTE.
--
-- Saídas que EXISTEM e por que nenhuma serve hoje (achado 5 do Sol, que corrigiu
-- um absolutismo meu): (a) `alter default privileges` GLOBAL, sem `in schema`,
-- alcançaria o PUBLIC — mas atingiria também as funções futuras de EXTENSÃO
-- criadas pelo `postgres`, num banco que tem 306 delas; (b) EVENT TRIGGER
-- resolveria na raiz, mas `create event trigger` pede SUPERUSUÁRIO, e o papel
-- `postgres` não é superusuário neste Supabase (`rolsuper = f`).
--
-- Então a fonte continua aberta por desenho do Postgres, e quem a segura é:
--   (a) a disciplina de revogar NOMINALMENTE em cada migration que cria função
--       (o que a casa já faz desde a 109); e
--   (b) o guard de `tests/acl-higiene.test.ts`, que reprova a suíte no dia em
--       que QUALQUER função nossa aparecer executável por anon.
-- ---------------------------------------------------------------------------
alter default privileges
  for role postgres
  in schema public
  revoke execute on functions
  from public, anon;

-- ---------------------------------------------------------------------------
-- 5. Reversão declarada: `briefing_v2_finalidade_profissional()` tinha o ÚNICO
-- `grant … to anon` do repo (migration 20260728000100). Ela não é chamada por
-- RPC de lugar nenhum — só de dentro de SQL —, então o laço acima a fecha de
-- propósito. Se um dia um fluxo público precisar dela, o grant volta NOMINAL e
-- com o motivo escrito, nunca por herança do PUBLIC.
-- ---------------------------------------------------------------------------
