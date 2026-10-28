-- F2 — Ações de aula (plano integrado v2, 18/07/2026; decisões M1-1, M1-3, M1-6,
-- M2-1, M2-3, M2-8 + P4/P22 do passe adversarial).
--   1. Aula avulsa com tipo (extra cobrada / cortesia / experimental) + contrato
--      experimental leve — a avulsa entra em lembretes e extrato SOZINHA (ela é
--      uma class_instance normal de um contrato; a régua do extrato já paga por
--      duração — P22 vira teste-guarda).
--   2. Registro em lote "todas aconteceram" (1 auditoria por aula + marcador).
--   3. Cortesia explícita na remarcação (admin, motivo obrigatório; contador
--      mensal é DERIVADO do audit_log — nada materializado).
--   4. Antecedência mínima no DESTINO (por professora, default 12h) — o racional
--      novo substitui o "não adiantar" (20260715001000; histórico preservado no
--      git). Bypass explícito, só admin, auditado — fura SÓ a antecedência.
--   5. Autocancelamento do aluno (cancel_my_class) com o MESMO miolo da matriz
--      D2 + aviso de cancelamento pelo outbox (P4: o cancelamento admin unitário
--      TAMBÉM notifica; encerramento/pausa/troca de horário seguem silenciosos
--      por construção — decisão deliberada registrada).

-- ---------------------------------------------------------------------------
-- 1. Colunas novas
-- ---------------------------------------------------------------------------
alter table class_instances add column single_kind text
  check (single_kind is null or single_kind in ('extra_paid', 'courtesy', 'trial'));
comment on column class_instances.single_kind is
  'Aula avulsa (M1-1): extra_paid (cobrada à parte), courtesy (cortesia), trial '
  '(experimental). NULL = aula normal do contrato.';

alter table class_instances add column single_price_cents int
  check (single_price_cents is null or single_price_cents >= 0);
alter table class_instances add column single_paid_at timestamptz;
comment on column class_instances.single_paid_at is
  'Quando a avulsa cobrada foi paga (M11-3 evolui via webhook Asaas na F8; até '
  'lá, campo próprio marcado à mão).';

alter table contracts add column is_trial boolean not null default false;
comment on column contracts.is_trial is
  'Contrato experimental leve (M1-1): nasce junto da aula experimental, sem '
  'horário fixo — NUNCA dispara geração de 8 semanas (não tem recurring_slot; '
  'teste-guarda prova).';

alter table teachers add column min_booking_lead_hours int not null default 12
  check (min_booking_lead_hours >= 0);
comment on column teachers.min_booking_lead_hours is
  'M2-1: antecedência mínima (horas) para MARCAR horário novo com esta professora '
  '(remarcação E resgate). Substitui o "não adiantar". Bypass admin auditado.';

-- O portal antecipa o filtro de antecedência: a view pública ganha a coluna
-- (dado não sensível; custos seguem invisíveis — ADR-010 §1).
create or replace view teacher_public as
  select id, display_name, min_booking_lead_hours from teachers;

-- ---------------------------------------------------------------------------
-- 2. Aviso de cancelamento (P4) — enqueue no padrão exato dos lembretes
--    (20260715000500): fan-out por membro do grupo (M2-8), linha por canal,
--    dedupe idempotente, WhatsApp re-checado no envio.
-- ---------------------------------------------------------------------------
create or replace function public._enqueue_class_cancelled(
  p_instance uuid,
  p_credited boolean,
  p_expires date
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_inserted int := 0;
  v_rows int;
  v_wa boolean;
begin
  for v_row in
    select ci.id as instance_id, ci.starts_at_utc, ci.local_time_snapshot,
           s.id as student_id, s.profile_id, s.iana_tz,
           t.display_name as teacher_name
    from class_instances ci
    join contracts c on c.id = ci.contract_id
    join teachers t on t.id = ci.teacher_id
    join lateral (
      select st.id, st.profile_id, st.iana_tz
      from students st where st.id = c.student_id
      union
      select st.id, st.profile_id, st.iana_tz
      from student_group_members m
      join students st on st.id = m.student_id
      where m.group_id = c.student_group_id
    ) s on true
    where ci.id = p_instance
  loop
    insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
    values (
      'class-cancelled', v_row.profile_id,
      jsonb_build_object(
        'instance_id', v_row.instance_id, 'student_id', v_row.student_id,
        'starts_at_utc', v_row.starts_at_utc,
        'local_time_snapshot', v_row.local_time_snapshot,
        'iana_tz', v_row.iana_tz, 'teacher_name', v_row.teacher_name,
        'credited', p_credited, 'expires_on', p_expires),
      format('class-cancelled:%s:%s', v_row.instance_id, v_row.student_id))
    on conflict (dedupe_key) do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;

    v_wa := false;
    if v_row.profile_id is not null then
      select p.whatsapp_opt_in and p.whatsapp_e164 is not null into v_wa
      from profiles p where p.id = v_row.profile_id;
    end if;
    if coalesce(v_wa, false) then
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values (
        'whatsapp', 'class-cancelled', v_row.profile_id,
        jsonb_build_object(
          'instance_id', v_row.instance_id, 'student_id', v_row.student_id,
          'starts_at_utc', v_row.starts_at_utc,
          'local_time_snapshot', v_row.local_time_snapshot,
          'iana_tz', v_row.iana_tz, 'teacher_name', v_row.teacher_name,
          'credited', p_credited, 'expires_on', p_expires),
        format('class-cancelled:%s:%s:wa', v_row.instance_id, v_row.student_id))
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end if;
  end loop;
  return v_inserted;
end;
$$;
revoke execute on function public._enqueue_class_cancelled(uuid, boolean, date)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Matriz de cancelamento: miolo separado (M2-3) — a MESMA regra para admin
--    e aluno; só a autorização muda. O miolo é o cancel_class da F1 sem o check
--    de papel, + o enqueue do aviso (P4).
-- ---------------------------------------------------------------------------
create or replace function public._cancel_class_core(
  p_instance uuid,
  p_cancelled_by text,
  p_notified_at timestamptz,
  p_actor uuid,
  p_via text  -- 'admin' | 'self'
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst class_instances%rowtype;
  v_contract contracts%rowtype;
  v_credited boolean := false;
  v_expires date;
  v_credit_born boolean;
  v_refund record;
  v_blocked text;
begin
  if p_cancelled_by not in ('student', 'teacher') then
    raise exception 'p_cancelled_by deve ser student ou teacher (recebido: %)', p_cancelled_by;
  end if;
  if p_notified_at > now() then
    raise exception 'notified_at no futuro (%) — o aviso já deve ter acontecido', p_notified_at;
  end if;

  select * into v_inst from class_instances where id = p_instance for update;
  if not found then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_inst.state <> 'scheduled' then
    raise exception 'instância % não está agendada (estado: %)', p_instance, v_inst.state;
  end if;
  if now() >= v_inst.starts_at_utc and p_notified_at >= v_inst.starts_at_utc then
    raise exception 'aula % já começou e o aviso não a precedeu — use no_show_student/no_show_teacher', p_instance;
  end if;

  select * into v_contract from contracts where id = v_inst.contract_id for update;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'cancel_class só se aplica a contratos private_1on1';
  end if;

  update class_instances set state = 'cancelled' where id = p_instance;

  v_credit_born := exists (
    select 1 from makeup_ledger l
    where l.delta < 0 and l.reason = 'spend_reschedule'
      and (l.class_instance_id = p_instance
           or (v_inst.reschedule_of is not null and l.class_instance_id = v_inst.reschedule_of)));

  if p_cancelled_by = 'teacher'
     or p_notified_at <= v_inst.starts_at_utc - make_interval(hours => v_contract.min_notice_hours)
  then
    if v_credit_born then
      v_refund := public._refund_for_credit_born_class(
        p_instance, case when p_cancelled_by = 'teacher' then 'school' else 'student' end, p_actor);
      v_expires := v_refund.o_expires;
      v_blocked := v_refund.o_blocked;
      v_credited := v_expires is not null;
    else
      v_expires := public._earn_for_lost_class(
        p_instance, p_actor, case when p_cancelled_by = 'teacher' then 'school' else 'student' end);
      v_credited := true;
    end if;
  end if;

  -- P4: cancelamento unitário AVISA (admin e self); cortesia da aula avulsa não
  -- passa por aqui. Encerramento/pausa/troca de horário cancelam por caminho
  -- direto e seguem silenciosos por construção (deliberado).
  perform public._enqueue_class_cancelled(p_instance, v_credited, v_expires);

  perform public.log_audit(p_actor, 'cancel_class', 'class_instances', p_instance::text,
    jsonb_build_object(
      'cancelled_by', p_cancelled_by,
      'notified_at', p_notified_at,
      'starts_at_utc', v_inst.starts_at_utc,
      'min_notice_hours', v_contract.min_notice_hours,
      'credited', v_credited,
      'credit_born', v_credit_born,
      'refund_blocked', v_blocked,
      'expires_on', v_expires,
      'via', p_via));
end;
$$;
revoke execute on function public._cancel_class_core(uuid, text, timestamptz, uuid, text)
from public, anon, authenticated;

-- Superfície admin: assinatura idêntica à da F1 (ACLs preservadas).
create or replace function public.cancel_class(
  p_instance uuid,
  p_cancelled_by text,
  p_notified_at timestamptz default now(),
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.app_role() <> 'admin' then
    raise exception 'cancel_class é restrita à admin (D10)';
  end if;
  perform public._cancel_class_core(
    p_instance, p_cancelled_by, p_notified_at, coalesce(auth.uid(), p_actor), 'admin');
end;
$$;

-- M2-3: o aluno cancela a PRÓPRIA aula. O clique é o aviso (notified_at = now);
-- a matriz decide crédito × perda EXATAMENTE como sempre — dentro do prazo de
-- perda é permitido COM a consequência (a UI mostra o alerta antes).
create or replace function public.cancel_my_class(p_instance uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract_id uuid;
begin
  select ci.contract_id into v_contract_id from class_instances ci where ci.id = p_instance;
  if v_contract_id is null then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_contract_id not in (select public.my_contract_ids()) then
    raise exception 'você não tem acesso a esta aula (D10)';
  end if;
  perform public._cancel_class_core(p_instance, 'student', now(), auth.uid(), 'self');
end;
$$;
revoke execute on function public.cancel_my_class(uuid) from public, anon;
grant execute on function public.cancel_my_class(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Aula avulsa (M1-1): em contrato existente (extra cobrada / cortesia) e
--    experimental com contrato leve criado junto. Conflito de agenda traduzido.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_single_class(
  p_contract uuid,
  p_local_date date,
  p_local_time time,
  p_duration_min int,
  p_kind text,
  p_price_cents int default null,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract contracts%rowtype;
  v_actor uuid;
  v_tz text;
  v_starts timestamptz;
  v_new_id uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_create_single_class é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  if p_kind not in ('extra_paid', 'courtesy') then
    raise exception 'tipo de avulsa em contrato existente deve ser extra_paid ou courtesy (experimental usa admin_create_trial_class)';
  end if;
  if p_kind = 'extra_paid' and (p_price_cents is null or p_price_cents <= 0) then
    raise exception 'aula extra cobrada exige valor (p_price_cents)';
  end if;
  if p_duration_min is null or p_duration_min <= 0 then
    raise exception 'duração inválida (%)', p_duration_min;
  end if;

  select * into v_contract from contracts where id = p_contract for update;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_contract.contract_type <> 'private_1on1' or v_contract.status <> 'active' then
    raise exception 'aula avulsa exige contrato particular ATIVO';
  end if;

  -- zona: slot ativo do contrato → aluno do contrato (Lei 1: offset DAQUELE dia)
  select rs.iana_tz into v_tz
  from recurring_slots rs
  where rs.contract_id = p_contract
    and rs.active_from <= current_date
    and (rs.active_to is null or rs.active_to >= current_date)
  order by rs.active_from desc limit 1;
  if v_tz is null then
    select s.iana_tz into v_tz from students s where s.id = v_contract.student_id;
  end if;
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA da avulsa do contrato %', p_contract;
  end if;

  v_starts := (p_local_date + p_local_time) at time zone v_tz;
  if v_starts <= now() then
    raise exception 'a aula avulsa precisa ser no futuro (% em %)', v_starts, v_tz;
  end if;

  begin
    insert into class_instances
      (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
       local_time_snapshot, state, single_kind, single_price_cents)
    values
      (p_contract, v_contract.teacher_id, null, p_local_date, v_starts,
       v_starts + make_interval(mins => p_duration_min),
       to_char(p_local_date, 'YYYY-MM-DD') || ' ' || to_char(p_local_time, 'HH24:MI') || ' ' || v_tz,
       'scheduled', p_kind, p_price_cents)
    returning id into v_new_id;
  exception when exclusion_violation or unique_violation then
    -- a guarda anti-sobreposição do professor aparece como unique/exclusion
    raise exception 'conflito de agenda: a professora já tem compromisso nesse horário';
  end;

  perform public.log_audit(v_actor, 'admin_create_single_class', 'class_instances', v_new_id::text,
    jsonb_build_object('contract_id', p_contract, 'kind', p_kind,
                       'price_cents', p_price_cents, 'starts_at_utc', v_starts,
                       'duration_min', p_duration_min, 'iana_tz', v_tz));
  return v_new_id;
end;
$$;
revoke execute on function public.admin_create_single_class(uuid, date, time, int, text, int, uuid)
from public, anon, authenticated;
grant execute on function public.admin_create_single_class(uuid, date, time, int, text, int, uuid)
to authenticated;

-- Experimental: pessoa NOVA + contrato leve + aula, num ato só.
create or replace function public.admin_create_trial_class(
  p_student_name text,
  p_iana_tz text,
  p_teacher uuid,
  p_local_date date,
  p_local_time time,
  p_duration_min int,
  p_price_cents int default null,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_student uuid;
  v_contract uuid;
  v_starts timestamptz;
  v_new_id uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_create_trial_class é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  if btrim(coalesce(p_student_name, '')) = '' then
    raise exception 'nome da pessoa é obrigatório';
  end if;
  if p_duration_min is null or p_duration_min <= 0 then
    raise exception 'duração inválida (%)', p_duration_min;
  end if;
  if not exists (select 1 from teachers t where t.id = p_teacher and t.archived_at is null) then
    raise exception 'professora % não existe ou está arquivada', p_teacher;
  end if;

  v_starts := (p_local_date + p_local_time) at time zone p_iana_tz;
  if v_starts <= now() then
    raise exception 'a aula experimental precisa ser no futuro (% em %)', v_starts, p_iana_tz;
  end if;

  insert into students (display_name, iana_tz)
  values (btrim(p_student_name), p_iana_tz)
  returning id into v_student;

  insert into contracts
    (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
     monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days,
     started_on, is_trial)
  values
    ('private_1on1', v_student, p_teacher, 'Aula experimental',
     coalesce(p_price_cents, 0), 0, 24, 90, p_local_date, true)
  returning id into v_contract;

  begin
    insert into class_instances
      (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
       local_time_snapshot, state, single_kind, single_price_cents)
    values
      (v_contract, p_teacher, null, p_local_date, v_starts,
       v_starts + make_interval(mins => p_duration_min),
       to_char(p_local_date, 'YYYY-MM-DD') || ' ' || to_char(p_local_time, 'HH24:MI') || ' ' || p_iana_tz,
       'scheduled', 'trial', p_price_cents)
    returning id into v_new_id;
  exception when exclusion_violation or unique_violation then
    raise exception 'conflito de agenda: a professora já tem compromisso nesse horário';
  end;

  perform public.log_audit(v_actor, 'admin_create_trial_class', 'class_instances', v_new_id::text,
    jsonb_build_object('student_id', v_student, 'contract_id', v_contract,
                       'teacher_id', p_teacher, 'price_cents', p_price_cents,
                       'starts_at_utc', v_starts, 'duration_min', p_duration_min,
                       'iana_tz', p_iana_tz));
  return v_new_id;
end;
$$;
revoke execute on function public.admin_create_trial_class(text, text, uuid, date, time, int, int, uuid)
from public, anon, authenticated;
grant execute on function public.admin_create_trial_class(text, text, uuid, date, time, int, int, uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Lote "todas aconteceram" (M1-3): complete_class ganha o MARCADOR de lote
--    (recreate com parâmetro novo ⇒ DROP + CREATE) e o lote itera chamando a
--    função unitária — 1 auditoria por aula, mais 1 do lote com a lista.
-- ---------------------------------------------------------------------------
drop function public.complete_class(uuid, uuid);
create function public.complete_class(
  p_instance uuid,
  p_actor uuid default null,
  p_batch uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state class_state;
  v_starts timestamptz;
begin
  if public.app_role() <> 'admin' then
    raise exception 'D10: só a administração registra desfecho de aula';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('class:' || p_instance::text, 0));

  select state, starts_at_utc into v_state, v_starts
  from class_instances where id = p_instance;
  if not found then
    raise exception 'aula não encontrada';
  end if;
  if v_state <> 'scheduled' then
    raise exception 'a aula já tem desfecho (%)', v_state;
  end if;
  if v_starts > now() then
    raise exception 'a aula ainda não começou — desfecho só depois do horário';
  end if;

  update class_instances set state = 'completed' where id = p_instance;

  insert into audit_log (actor, action, entity, entity_id, diff)
  values (coalesce(p_actor, auth.uid()), 'complete_class', 'class_instances', p_instance,
          jsonb_build_object('from', 'scheduled', 'to', 'completed', 'batch', p_batch));
end;
$$;
revoke execute on function public.complete_class(uuid, uuid, uuid) from public;
grant execute on function public.complete_class(uuid, uuid, uuid) to authenticated;

create or replace function public.admin_complete_past_batch(
  p_teacher uuid default null,
  p_actor uuid default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_batch uuid := gen_random_uuid();
  v_ids uuid[] := array[]::uuid[];
  v_id uuid;
  v_done int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_complete_past_batch é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select coalesce(array_agg(ci.id order by ci.starts_at_utc), array[]::uuid[]) into v_ids
  from class_instances ci
  where ci.state = 'scheduled'
    and ci.starts_at_utc < now()
    and (p_teacher is null or ci.teacher_id = p_teacher);

  foreach v_id in array v_ids loop
    perform public.complete_class(v_id, v_actor, v_batch);
    v_done := v_done + 1;
  end loop;

  perform public.log_audit(v_actor, 'complete_class_batch', 'class_instances', v_batch::text,
    jsonb_build_object('teacher_id', p_teacher, 'count', v_done, 'instances', to_jsonb(v_ids)));
  return v_done;
end;
$$;
revoke execute on function public.admin_complete_past_batch(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_complete_past_batch(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Remarcação: cortesia (M1-6) + antecedência no destino (M2-1).
--    reschedule_class_at ganha (courtesy, courtesy_note, bypass_lead) ⇒ DROP +
--    CREATE; o resto é byte a byte a versão vigente (20260712000100 + F1).
-- ---------------------------------------------------------------------------
drop function public.reschedule_class_at(uuid, timestamptz, text, uuid);
create function public.reschedule_class_at(
  p_instance uuid,
  p_new_starts_utc timestamptz,
  p_new_snapshot text,
  p_actor uuid default null,
  p_courtesy boolean default false,
  p_courtesy_note text default null,
  p_bypass_lead boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old class_instances%rowtype;
  v_contract contracts%rowtype;
  v_tz text;
  v_duration interval;
  v_orig_local_date date;
  v_period text;
  v_used int;
  v_via text;
  v_new_id uuid;
  v_lead int;
begin
  -- Cortesia é privilégio (M1-6). O bypass_lead NÃO é checado aqui: esta função
  -- é interna (revogada de clientes) e book_reschedule_window passa true após
  -- checar a antecedência sobre a JANELA — o check de papel do bypass vive nas
  -- superfícies chamáveis.
  if p_courtesy and public.app_role() <> 'admin' then
    raise exception 'cortesia é só da administração (D10)';
  end if;
  if p_courtesy and btrim(coalesce(p_courtesy_note, '')) = '' then
    raise exception 'cortesia exige motivo (M1-6)';
  end if;

  select * into v_old from class_instances where id = p_instance for update;
  if not found then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_old.state <> 'scheduled' then
    raise exception 'instância % não está agendada (estado atual: %)', p_instance, v_old.state;
  end if;

  select * into v_contract from contracts where id = v_old.contract_id for update;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'reschedule_class só se aplica a contratos private_1on1';
  end if;
  if v_contract.status <> 'active' then
    raise exception 'contrato % não está ativo — remarcação bloqueada', v_contract.id;
  end if;

  -- Aviso mínimo sobre a aula ORIGINAL (intocado — o bypass fura SÓ a antecedência).
  if now() > v_old.starts_at_utc - make_interval(hours => v_contract.min_notice_hours) then
    raise exception 'remarcação exige % h de aviso mínimo (aula começa em %)',
      v_contract.min_notice_hours, v_old.starts_at_utc;
  end if;

  if p_new_starts_utc <= now() then
    raise exception 'nova data/hora da remarcação já passou (%)', p_new_starts_utc;
  end if;

  -- M2-1: antecedência mínima no DESTINO, por professora.
  select t.min_booking_lead_hours into v_lead from teachers t where t.id = v_old.teacher_id;
  if not p_bypass_lead
     and p_new_starts_utc < now() + make_interval(hours => coalesce(v_lead, 12)) then
    raise exception 'o novo horário exige % h de antecedência — escolha um horário mais à frente',
      coalesce(v_lead, 12);
  end if;

  v_tz := public.class_instance_tz(p_instance);
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA da remarcação do contrato %', v_contract.id;
  end if;

  v_duration := v_old.ends_at_utc - v_old.starts_at_utc;

  v_orig_local_date := coalesce(v_old.occurrence_date, (v_old.starts_at_utc at time zone v_tz)::date);
  v_period := to_char(v_orig_local_date, 'YYYY-MM');

  if p_courtesy then
    -- M1-6: cortesia NÃO consome franquia nem crédito; o contador mensal é
    -- derivado do audit (via = courtesy), nunca materializado.
    v_via := 'courtesy';
  else
    insert into reschedule_usage (contract_id, period_ym, used_count)
    values (v_contract.id, v_period, 0)
    on conflict (contract_id, period_ym) do nothing;
    update reschedule_usage
       set used_count = used_count + 1
     where contract_id = v_contract.id
       and period_ym = v_period
       and used_count < v_contract.monthly_reschedule_allowance
    returning used_count into v_used;

    if v_used is not null then
      v_via := 'allowance';
    else
      perform public.spend_makeup(v_contract.id, 'spend_reschedule', v_contract.student_id, p_instance, p_actor);
      v_via := 'makeup_credit';
    end if;
  end if;

  update class_instances set state = 'rescheduled' where id = p_instance;

  insert into class_instances
    (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
     local_time_snapshot, state, reschedule_of)
  values
    (v_contract.id, v_old.teacher_id, null, null, p_new_starts_utc, p_new_starts_utc + v_duration,
     p_new_snapshot, 'scheduled', p_instance)
  returning id into v_new_id;

  perform public.log_audit(p_actor, 'reschedule_class', 'class_instances', v_new_id::text,
    jsonb_build_object(
      'rescheduled_from', p_instance,
      'contract_id', v_contract.id,
      'old_starts_at_utc', v_old.starts_at_utc,
      'new_starts_at_utc', p_new_starts_utc,
      'iana_tz', v_tz,
      'via', v_via,
      'courtesy_note', p_courtesy_note,
      'bypass_lead', p_bypass_lead,
      'period_ym', v_period));

  return v_new_id;
end;
$$;
revoke execute on function
  public.reschedule_class_at(uuid, timestamptz, text, uuid, boolean, text, boolean)
from public, anon, authenticated;

-- Conversor data/hora local (assinatura da Fase 1 + repasses novos).
drop function public.reschedule_class(uuid, date, time, uuid);
create function public.reschedule_class(
  p_instance uuid,
  p_new_local_date date,
  p_new_local_time time,
  p_actor uuid default null,
  p_courtesy boolean default false,
  p_courtesy_note text default null,
  p_bypass_lead boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
begin
  v_tz := public.class_instance_tz(p_instance);
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA da instância %', p_instance;
  end if;
  return public.reschedule_class_at(
    p_instance,
    (p_new_local_date + p_new_local_time) at time zone v_tz,
    to_char(p_new_local_date, 'YYYY-MM-DD') || ' ' || to_char(p_new_local_time, 'HH24:MI') || ' ' || v_tz,
    p_actor, p_courtesy, p_courtesy_note, p_bypass_lead);
end;
$$;
revoke execute on function
  public.reschedule_class(uuid, date, time, uuid, boolean, text, boolean)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. book_reschedule_window: antecedência no destino nos DOIS modos; SAI o
--    "não adiantar" (M2-1 — racional novo por cima, histórico no git); cortesia
--    e bypass repassados. Recreate integral da versão F1 (20260718000300) ⇒
--    DROP + CREATE pela assinatura nova.
-- ---------------------------------------------------------------------------
drop function public.book_reschedule_window(uuid, uuid, uuid, uuid);
create function public.book_reschedule_window(
  p_window uuid,
  p_instance uuid default null,
  p_contract uuid default null,
  p_actor uuid default null,
  p_courtesy boolean default false,
  p_courtesy_note text default null,
  p_bypass_lead boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_win reschedule_windows%rowtype;
  v_contract contracts%rowtype;
  v_contract_id uuid;
  v_inst_teacher uuid;
  v_inst_starts timestamptz;
  v_actor uuid;
  v_credit_dur int;
  v_slot_dur int;
  v_duration_min int;
  v_new_id uuid;
  v_new_starts timestamptz;
  v_lead int;
begin
  if (p_instance is null) = (p_contract is null) then
    raise exception 'informe a aula a remarcar (p_instance) OU o contrato do resgate (p_contract)';
  end if;
  if (p_courtesy or p_bypass_lead) and public.app_role() <> 'admin' then
    raise exception 'cortesia e bypass de antecedência são só da administração (D10)';
  end if;
  if p_courtesy and p_instance is null then
    raise exception 'cortesia é da REMARCAÇÃO — resgate consome crédito por definição';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_win from reschedule_windows where id = p_window for update;
  if not found then
    raise exception 'janela % não existe', p_window;
  end if;
  if v_win.state <> 'publicada' then
    raise exception 'janela % não está disponível (estado: %)', p_window, v_win.state;
  end if;
  if v_win.starts_at_utc <= now() then
    raise exception 'janela % já passou', p_window;
  end if;
  if v_win.starts_at_utc > now() + interval '14 days' then
    raise exception 'janela % está a mais de 2 semanas (%)', p_window, v_win.starts_at_utc;
  end if;

  -- M2-1: antecedência mínima da PROFESSORA no destino (remarcação E resgate).
  select t.min_booking_lead_hours into v_lead from teachers t where t.id = v_win.teacher_id;
  if not p_bypass_lead
     and v_win.starts_at_utc < now() + make_interval(hours => coalesce(v_lead, 12)) then
    raise exception 'esse horário exige % h de antecedência — escolha um mais à frente',
      coalesce(v_lead, 12);
  end if;

  if p_instance is not null then
    select ci.contract_id, ci.teacher_id, ci.starts_at_utc
      into v_contract_id, v_inst_teacher, v_inst_starts
      from class_instances ci where ci.id = p_instance;
    if v_contract_id is null then
      raise exception 'instância % não existe', p_instance;
    end if;
  else
    v_contract_id := p_contract;
  end if;

  if public.app_role() <> 'admin'
     and v_contract_id not in (select public.my_contract_ids()) then
    raise exception 'você não tem acesso a este contrato (D10)';
  end if;

  select * into v_contract from contracts where id = v_contract_id;
  if v_contract.id is null then
    raise exception 'contrato % não existe', v_contract_id;
  end if;
  if p_instance is not null then
    if v_inst_teacher <> v_win.teacher_id then
      raise exception 'janela % pertence a outra professora (D1)', p_window;
    end if;
    if v_inst_teacher <> v_contract.teacher_id then
      raise exception 'instância % (professora %) diverge do contrato % (professora %) — corrigir antes de remarcar',
        p_instance, v_inst_teacher, v_contract.id, v_contract.teacher_id;
    end if;
  elsif v_contract.teacher_id <> v_win.teacher_id then
    raise exception 'janela % pertence a outra professora (D1)', p_window;
  end if;

  if p_instance is not null then
    v_new_id := public.reschedule_class_at(
      p_instance, v_win.starts_at_utc, v_win.local_time_snapshot, v_actor,
      p_courtesy, p_courtesy_note, true);  -- lead já checado sobre a janela
  else
    select * into v_contract from contracts where id = v_contract_id for update;
    if v_contract.contract_type <> 'private_1on1' then
      raise exception 'resgate de crédito só se aplica a contratos private_1on1';
    end if;
    if v_contract.status <> 'active' then
      raise exception 'contrato % não está ativo — resgate bloqueado', v_contract.id;
    end if;

    perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || v_contract.id::text, 0));
    select rc.duration_min into v_credit_dur
    from public._makeup_remaining_credits(v_contract.id) rc
    where rc.expires_on >= public.business_today()
    order by rc.expires_on, rc.ord
    limit 1;

    select rs.duration_min into v_slot_dur
      from recurring_slots rs
     where rs.contract_id = v_contract.id
       and rs.active_from <= current_date
       and (rs.active_to is null or rs.active_to >= current_date)
     order by rs.active_from desc
     limit 1;

    v_duration_min := coalesce(v_credit_dur, v_slot_dur);
    if v_duration_min is null then
      raise exception 'contrato % não tem duração para o resgate (crédito sem duração e sem slot ativo)', v_contract.id;
    end if;

    insert into class_instances
      (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
       local_time_snapshot, state, reschedule_of)
    values
      (v_contract.id, v_win.teacher_id, null, null, v_win.starts_at_utc,
       v_win.starts_at_utc + make_interval(mins => v_duration_min),
       v_win.local_time_snapshot, 'scheduled', null)
    returning id into v_new_id;

    perform public.spend_makeup(v_contract.id, 'spend_reschedule', v_contract.student_id, v_new_id, v_actor);
  end if;

  select starts_at_utc into v_new_starts from class_instances where id = v_new_id;
  if v_new_starts <> v_win.starts_at_utc then
    raise exception 'invariante violado: instância criada em % ≠ janela publicada em %',
      v_new_starts, v_win.starts_at_utc;
  end if;

  update reschedule_windows
     set state = 'consumida', consumed_by_instance_id = v_new_id
   where id = p_window;

  perform public.log_audit(v_actor, 'book_reschedule_window', 'reschedule_windows', p_window::text,
    jsonb_build_object(
      'mode', case when p_instance is not null then 'reschedule' else 'redeem' end,
      'instance', p_instance, 'contract', v_contract_id,
      'new_instance', v_new_id, 'starts_at_utc', v_win.starts_at_utc,
      'duration_min', v_duration_min,
      'courtesy', p_courtesy, 'bypass_lead', p_bypass_lead));

  return v_new_id;
end;
$$;
revoke execute on function
  public.book_reschedule_window(uuid, uuid, uuid, uuid, boolean, text, boolean)
from public, anon;
grant execute on function
  public.book_reschedule_window(uuid, uuid, uuid, uuid, boolean, text, boolean)
to authenticated;
