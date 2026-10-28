-- Fase 3 / M0.3–M0.5 — Caminho teacher nas janelas (F3-D6) + correção das policies
-- herdadas da Fase 1 que o login da professora destrava (F3-D7).

-- ---------------------------------------------------------------------------
-- 1) Helper: contratos da PROFESSORA logada (padrão ADR-010 §3, espelho de
--    my_contract_ids). SECURITY DEFINER de propósito: as policies de
--    makeup_ledger/reschedule_usage abaixo deixam de depender do RLS de contracts
--    (cuja policy de linha inteira para teacher é REMOVIDA no item 3).
-- ---------------------------------------------------------------------------
create or replace function public.teacher_contract_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id
  from contracts c
  join teachers t on t.id = c.teacher_id
  where t.profile_id = auth.uid()
$$;

revoke execute on function public.teacher_contract_ids() from public;
grant execute on function public.teacher_contract_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) publish/cancel_reschedule_window: caminho para o papel teacher (F3-D6).
--    Posse validada DENTRO (D10/F2). Regras pinadas no goal:
--    - teacher com p_teacher ≠ a própria → exceção;
--    - teacher com p_iana_tz não-nulo → exceção (o fuso vem de teachers.iana_tz);
--    - admin continua podendo tudo; default do fuso para admin passa a ser o
--      iana_tz DA PROFESSORA (F3-D2: fonte única; para a dona = business_tz,
--      comportamento idêntico ao anterior — para a professora/SP, o correto).
-- ---------------------------------------------------------------------------
create or replace function public.publish_reschedule_window(
  p_teacher uuid,
  p_local_date date,
  p_local_time time,
  p_iana_tz text default null,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.app_role();
  v_teacher_tz text;
  v_tz text;
  v_starts timestamptz;
  v_id uuid;
  v_actor uuid;
begin
  if v_role = 'teacher' then
    if p_teacher is distinct from public.my_teacher_id() then
      raise exception 'professora só publica janela PARA SI (F3-D6)';
    end if;
    if p_iana_tz is not null then
      raise exception 'fuso da professora vem de teachers.iana_tz — não informe p_iana_tz (F3-D6)';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'publish_reschedule_window é restrita a admin/professora (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select t.iana_tz into v_teacher_tz from teachers t where t.id = p_teacher;
  if not found then
    raise exception 'professora % não existe', p_teacher;
  end if;

  -- Zona de quem publica (D1/F2 + F3-D2): fonte única = teachers.iana_tz;
  -- p_iana_tz é override explícito EXCLUSIVO da admin.
  v_tz := coalesce(p_iana_tz, v_teacher_tz);
  v_starts := (p_local_date + p_local_time) at time zone v_tz;
  if v_starts <= now() then
    raise exception 'janela % % (%) já passou', p_local_date, p_local_time, v_tz;
  end if;

  insert into reschedule_windows
    (teacher_id, local_date, local_time, iana_tz, starts_at_utc, local_time_snapshot, created_by)
  values
    (p_teacher, p_local_date, p_local_time, v_tz, v_starts,
     to_char(p_local_date, 'YYYY-MM-DD') || ' ' || to_char(p_local_time, 'HH24:MI') || ' ' || v_tz,
     v_actor)
  returning id into v_id;

  perform public.log_audit(v_actor, 'publish_reschedule_window', 'reschedule_windows', v_id::text,
    jsonb_build_object('teacher_id', p_teacher, 'starts_at_utc', v_starts, 'iana_tz', v_tz));
  return v_id;
end;
$$;

create or replace function public.cancel_reschedule_window(
  p_window uuid,
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_win reschedule_windows%rowtype;
  v_role text := public.app_role();
  v_actor uuid;
begin
  if v_role not in ('admin', 'teacher') then
    raise exception 'cancel_reschedule_window é restrita a admin/professora (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_win from reschedule_windows where id = p_window for update;
  if not found then
    raise exception 'janela % não existe', p_window;
  end if;
  -- Posse (F3-D6): professora só cancela as SUAS.
  if v_role = 'teacher' and v_win.teacher_id is distinct from public.my_teacher_id() then
    raise exception 'janela % não pertence a esta professora (F3-D6)', p_window;
  end if;
  -- D15/F2: consumida NÃO reabre nem cancela — a republicação é manual (janela nova).
  if v_win.state <> 'publicada' then
    raise exception 'janela % não está publicada (estado: %)', p_window, v_win.state;
  end if;

  update reschedule_windows set state = 'cancelada' where id = p_window;
  perform public.log_audit(v_actor, 'cancel_reschedule_window', 'reschedule_windows', p_window::text, null);
end;
$$;

-- Grants inalterados (authenticated já tinha EXECUTE; a validação vive DENTRO — D10/F2).

-- ---------------------------------------------------------------------------
-- 3) Correção do vazamento herdado (achado CRÍTICO do painel): contracts_teacher
--    dava à professora a LINHA INTEIRA de contracts — incluindo hourly_rate_cents
--    (o que o ALUNO paga) e plan_name. RLS não filtra coluna (ADR-010 §1).
--    As policies de ledger/usage dependiam do RLS de contracts via subselect —
--    recriadas sobre o helper DEFINER para não quebrarem com o DROP (caso 11).
-- ---------------------------------------------------------------------------
drop policy contracts_teacher on contracts;

drop policy makeup_ledger_teacher on makeup_ledger;
create policy makeup_ledger_teacher on makeup_ledger
  for select to authenticated
  using (
    (select public.app_role()) = 'teacher'
    and contract_id in (select public.teacher_contract_ids())
  );

drop policy reschedule_usage_teacher on reschedule_usage;
create policy reschedule_usage_teacher on reschedule_usage
  for select to authenticated
  using (
    (select public.app_role()) = 'teacher'
    and contract_id in (select public.teacher_contract_ids())
  );

-- O painel da professora (M2) não precisa de dados de contrato: agenda/janelas/
-- extrato vêm de class_instances/reschedule_windows/teacher_statements (policies
-- próprias). Se uma tela futura precisar de allowance/notice/status, a porta é uma
-- view enxuta do owner filtrada por my_teacher_id() (padrão teacher_public,
-- ADR-010 §1) — NUNCA reabrir a tabela.

-- ---------------------------------------------------------------------------
-- 4) A única policy teacher que FALTAVA (F3-D7): a professora lista as PRÓPRIAS
--    janelas em qualquer estado (20260712000400 só tem admin_all +
--    student_published). Escrita continua EXCLUSIVA das RPCs (sem DML de cliente).
--    As demais superfícies do painel já existem desde a Fase 1 (20260711000700):
--    teachers_self, students_teacher, class_instances_teacher,
--    recurring_slots_teacher, teacher_statements_teacher, class_audits_teacher —
--    NÃO recriar (42710); cobertas por testes-pino de posse.
-- ---------------------------------------------------------------------------
create policy reschedule_windows_teacher on reschedule_windows
  for select to authenticated
  using (
    (select public.app_role()) = 'teacher'
    and teacher_id = (select public.my_teacher_id())
  );

-- ---------------------------------------------------------------------------
-- 5) ADR-012 (grants cirúrgicos de service_role): o provisionamento da
--    professora (F3-D1, M1) vincula teachers.profile_id pelo servidor —
--    exatamente como o M0/F2 fez com students. profiles já tem update (M0/F2).
-- ---------------------------------------------------------------------------
grant update (profile_id) on teachers to service_role;
