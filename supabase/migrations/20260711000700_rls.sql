-- M5 — RLS: policies por papel (Lei 4).
-- RLS já está habilitado deny-all em todas as tabelas desde o M1; esta migration
-- adiciona as policies de LEITURA por papel. Escrita crítica permanece exclusiva das
-- funções SECURITY DEFINER do M2/M3 (Lei 3); CRUD administrativo via UI é Fase 2 e
-- será aberto por policies de escrita específicas quando existir.
--
-- Autorização SEMPRE por app_metadata.role no JWT — NUNCA user_metadata (editável
-- pelo usuário). Funções helper embrulhadas em (select ...) nas policies para o
-- otimizador executar uma vez por query (initPlan), não por linha.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.app_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none')
$$;

-- SECURITY DEFINER: helpers consultam tabelas com RLS sem recursão de policy.
create or replace function public.my_teacher_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id from teachers t where t.profile_id = auth.uid()
$$;

create or replace function public.my_student_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id from students s where s.profile_id = auth.uid()
$$;

-- Grupos dos quais o usuário logado faz parte (evita recursão: a policy de
-- student_group_members não pode consultar a própria tabela sob RLS).
create or replace function public.my_group_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.group_id from student_group_members m
  where m.student_id in (select public.my_student_ids())
$$;

-- Contratos do usuário logado como ALUNO: individuais e via grupo (casal — ADR-002).
create or replace function public.my_contract_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id
  from contracts c
  where c.student_id in (select public.my_student_ids())
  union
  select c.id
  from contracts c
  join student_group_members m on m.group_id = c.student_group_id
  where m.student_id in (select public.my_student_ids())
$$;

-- Negar por padrão também em EXECUTE: o default do Postgres concede a PUBLIC.
revoke execute on function public.app_role(), public.my_teacher_id(),
  public.my_student_ids(), public.my_group_ids(), public.my_contract_ids()
  from public;
grant execute on function public.app_role(), public.my_teacher_id(),
  public.my_student_ids(), public.my_group_ids(), public.my_contract_ids()
  to authenticated;

-- Funções de LEITURA (saldo/elegibilidade) ficam chamáveis por authenticated para
-- a UX do portal antecipar erros (Lei 3); rodam como invoker, então o RLS limita
-- o que cada papel enxerga nelas.
revoke execute on function public.business_tz(), public.business_today(),
  public.makeup_balance(uuid), public.mentorship_windows_unlocked(uuid),
  public.mentorship_next_window(uuid), public.mentorship_validity_end(uuid),
  public.mentorship_can_book(uuid)
  from public;
grant execute on function public.business_tz(), public.business_today(),
  public.makeup_balance(uuid), public.mentorship_windows_unlocked(uuid),
  public.mentorship_next_window(uuid), public.mentorship_validity_end(uuid),
  public.mentorship_can_book(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin: acesso total a todas as tabelas.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'students', 'payers', 'student_payers', 'student_groups',
    'student_group_members', 'teachers', 'contracts', 'recurring_slots',
    'class_instances', 'audit_log', 'class_audits', 'teacher_statements',
    'payments', 'leads', 'makeup_ledger', 'reschedule_usage',
    'mentorship_contracts', 'mentorship_window_rules', 'course_progress',
    'mentorship_sessions', 'mentorship_credit_ledger', 'mentorship_bookings'
  ] loop
    execute format(
      $p$create policy %I_admin_all on %I
           for all to authenticated
           using ((select public.app_role()) = 'admin')
           with check ((select public.app_role()) = 'admin')$p$, t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Perfis e pessoas
-- ---------------------------------------------------------------------------
create policy profiles_self on profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy students_self on students
  for select to authenticated
  using (id in (select public.my_student_ids()));

-- Alunos da professora logada: individuais E membros de grupo dos contratos dela.
-- SECURITY DEFINER: o subselect em student_group_members não pode rodar sob o RLS
-- da professora (ela não tem policy lá) — senão o ramo de grupo silenciosamente falha.
create or replace function public.teacher_student_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.student_id from contracts c
  where c.teacher_id = public.my_teacher_id() and c.student_id is not null
  union
  select m.student_id
  from contracts c
  join student_group_members m on m.group_id = c.student_group_id
  where c.teacher_id = public.my_teacher_id()
$$;
revoke execute on function public.teacher_student_ids() from public;
grant execute on function public.teacher_student_ids() to authenticated;

create policy students_teacher on students
  for select to authenticated
  using (
    (select public.app_role()) = 'teacher'
    and id in (select public.teacher_student_ids())
  );

create policy teachers_self on teachers
  for select to authenticated
  using (profile_id = (select auth.uid()));

-- NÃO há policy de teachers para aluno: a linha carrega hourly_rate_cents e
-- payment_terms (custo confidencial do negócio) e RLS não filtra colunas. O portal
-- (Fase 2) exporá a professora via view enxuta (id, nome) — ver ADR-010.

create policy student_groups_member on student_groups
  for select to authenticated
  using (id in (select public.my_group_ids()));

create policy student_group_members_self on student_group_members
  for select to authenticated
  using (group_id in (select public.my_group_ids()));

-- ---------------------------------------------------------------------------
-- Contratos, agenda, créditos (particulares)
-- ---------------------------------------------------------------------------
create policy contracts_student on contracts
  for select to authenticated
  using (id in (select public.my_contract_ids()));

create policy contracts_teacher on contracts
  for select to authenticated
  using ((select public.app_role()) = 'teacher' and teacher_id = (select public.my_teacher_id()));

create policy recurring_slots_student on recurring_slots
  for select to authenticated
  using (contract_id in (select public.my_contract_ids()));

create policy recurring_slots_teacher on recurring_slots
  for select to authenticated
  using ((select public.app_role()) = 'teacher' and teacher_id = (select public.my_teacher_id()));

create policy class_instances_student on class_instances
  for select to authenticated
  using (contract_id in (select public.my_contract_ids()));

create policy class_instances_teacher on class_instances
  for select to authenticated
  using ((select public.app_role()) = 'teacher' and teacher_id = (select public.my_teacher_id()));

create policy makeup_ledger_student on makeup_ledger
  for select to authenticated
  using (contract_id in (select public.my_contract_ids()));

create policy makeup_ledger_teacher on makeup_ledger
  for select to authenticated
  using (
    (select public.app_role()) = 'teacher'
    and contract_id in (select c.id from contracts c where c.teacher_id = (select public.my_teacher_id()))
  );

create policy reschedule_usage_student on reschedule_usage
  for select to authenticated
  using (contract_id in (select public.my_contract_ids()));

create policy reschedule_usage_teacher on reschedule_usage
  for select to authenticated
  using (
    (select public.app_role()) = 'teacher'
    and contract_id in (select c.id from contracts c where c.teacher_id = (select public.my_teacher_id()))
  );

-- ---------------------------------------------------------------------------
-- Professora: áudits e statements próprios
-- ---------------------------------------------------------------------------
create policy class_audits_teacher on class_audits
  for select to authenticated
  using (
    (select public.app_role()) = 'teacher'
    and class_instance_id in (
      select ci.id from class_instances ci where ci.teacher_id = (select public.my_teacher_id())
    )
  );

create policy teacher_statements_teacher on teacher_statements
  for select to authenticated
  using ((select public.app_role()) = 'teacher' and teacher_id = (select public.my_teacher_id()));

-- ---------------------------------------------------------------------------
-- Sales: apenas leads
-- ---------------------------------------------------------------------------
create policy leads_sales on leads
  for select to authenticated
  using ((select public.app_role()) = 'sales');

-- payers, student_payers, payments, audit_log, profiles(de terceiros):
-- nenhuma policy além de admin — deny por padrão (Lei 4).

-- ---------------------------------------------------------------------------
-- Mentoria: mentorado vê só o que é dele; sessões abertas visíveis para reserva
-- ---------------------------------------------------------------------------
create policy mentorship_contracts_student on mentorship_contracts
  for select to authenticated
  using (contract_id in (select public.my_contract_ids()));

create policy mentorship_window_rules_student on mentorship_window_rules
  for select to authenticated
  using (contract_id in (select public.my_contract_ids()));

create policy course_progress_student on course_progress
  for select to authenticated
  using (contract_id in (select public.my_contract_ids()));

create policy mentorship_credit_ledger_student on mentorship_credit_ledger
  for select to authenticated
  using (contract_id in (select public.my_contract_ids()));

create policy mentorship_bookings_student on mentorship_bookings
  for select to authenticated
  using (contract_id in (select public.my_contract_ids()));

-- Sessões abertas são visíveis a qualquer MENTORADO (para escolher e reservar);
-- sessões em outros status só para admin.
create policy mentorship_sessions_open_to_mentees on mentorship_sessions
  for select to authenticated
  using (
    status = 'open'
    and exists (
      select 1 from mentorship_contracts mc
      where mc.contract_id in (select public.my_contract_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- Grants de tabela: o PostgREST exige privilégio; as POLICIES decidem as linhas.
-- (O CLI local não concede mais SELECT/DML amplos por default privilege.)
-- anon recebe só SELECT: sem policy, vê zero linhas (caso 12) em vez de 403.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Reafirma a Lei 2/Lei 8 por cima dos grants amplos: ledgers e audit_log continuam
-- sem UPDATE/DELETE/TRUNCATE em nível de privilégio (e com triggers de guarda).
revoke update, delete, truncate on makeup_ledger from anon, authenticated, service_role;
revoke update, delete, truncate on mentorship_credit_ledger from anon, authenticated, service_role;
revoke update, delete, truncate on audit_log from anon, authenticated, service_role;
