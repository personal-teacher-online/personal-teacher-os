-- F4 — Contratos (plano integrado v2, 18/07/2026; decisões M5-1, M5-2, M5-3,
-- M5-5, M5-7, M3-4 + P1/P4/P13 do passe adversarial).
--   1. Editar regras do contrato (prospectivo, auditado).
--   2. Encerramento estendido ATÔMICO: gate duro de pendências → cancela futuras
--      (razão 'encerramento', SEM crédito, SILENCIOSO por construção — P4
--      deliberado: a saída/renovação é conversa humana) → fecha horários →
--      destina os créditos (transferência via _reissue_credit preservando
--      validade+duração, OU baixa com motivo) → ended_on.
--   3. Renovação guiada na ORDEM TRANSACIONAL VALIDADA (M5-a): cancelar futuras
--      do velho ≥ virada → fechar horários (virada−1) → criar novo + horários
--      (virada) → materializar → encerrar velho → transferir créditos. Virada
--      > 8 semanas é RECUSADA (P13).
--   4. Âncora de fuso EXPLÍCITA para grupo (P1/M4-1): o quirk alfabético
--      (min(iana_tz)) morre — criação E troca de horário de grupo exigem a zona.

-- ended_on já existe desde o core (20260711000200, com CHECK >= started_on) —
-- o encerramento/renovação passam a preenchê-la.
alter table contracts add column renewed_from uuid references contracts (id);
comment on column contracts.renewed_from is 'Contrato anterior desta renovação (M5-1) — o encadeamento é rastreável.';

alter table contracts add column group_tz_anchor_student uuid references students (id);
comment on column contracts.group_tz_anchor_student is
  'Grupo (M4-1/P1): membro cujo RELÓGIO rege os horários fixos — escolhido '
  'EXPLICITAMENTE na criação. Os forms de horário usam o fuso dele como default; '
  'o fuso gravado no slot continua explícito sempre.';

-- ---------------------------------------------------------------------------
-- 1. Editar regras (M5-2): prospectivo por construção — quem lê essas colunas
--    são as funções, na hora de cada ato. Preço e professora ficam FORA (decisão).
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_contract_rules(
  p_contract uuid,
  p_plan_name text,
  p_allowance int,
  p_min_notice int,
  p_expiry_days int,
  p_school_fault_days int,
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old contracts%rowtype;
  v_actor uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_update_contract_rules é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_old from contracts where id = p_contract for update;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_old.status = 'ended' then
    raise exception 'contrato encerrado não muda de regras';
  end if;
  if btrim(coalesce(p_plan_name, '')) = '' or p_allowance < 0 or p_min_notice < 0
     or p_expiry_days <= 0 or p_school_fault_days <= 0 then
    raise exception 'regras inválidas (plano/franquia/aviso/validades)';
  end if;

  update contracts
     set plan_name = p_plan_name,
         monthly_reschedule_allowance = p_allowance,
         min_notice_hours = p_min_notice,
         makeup_credit_expiry_days = p_expiry_days,
         school_fault_credit_expiry_days = p_school_fault_days
   where id = p_contract;

  perform public.log_audit(v_actor, 'update_contract_rules', 'contracts', p_contract::text,
    jsonb_build_object(
      'old', jsonb_build_object('plan_name', v_old.plan_name,
        'allowance', v_old.monthly_reschedule_allowance,
        'min_notice_hours', v_old.min_notice_hours,
        'expiry_days', v_old.makeup_credit_expiry_days,
        'school_fault_days', v_old.school_fault_credit_expiry_days),
      'new', jsonb_build_object('plan_name', p_plan_name, 'allowance', p_allowance,
        'min_notice_hours', p_min_notice, 'expiry_days', p_expiry_days,
        'school_fault_days', p_school_fault_days)));
end;
$$;
revoke execute on function public.admin_update_contract_rules(uuid, text, int, int, int, int, uuid)
from public, anon;
grant execute on function public.admin_update_contract_rules(uuid, text, int, int, int, int, uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Âncora explícita (P1): create_slot perde o fallback alfabético de grupo;
--    close_and_create_slot exige a zona explícita quando o contrato é de grupo.
--    Assinaturas idênticas ⇒ CREATE OR REPLACE preserva ACLs.
-- ---------------------------------------------------------------------------
create or replace function public.create_slot(
  p_contract uuid,
  p_weekday int,
  p_local_time time,
  p_iana_tz text default null,
  p_duration_min int default 45,
  p_active_from date default current_date,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract contracts%rowtype;
  v_tz text;
  v_id uuid;
  v_actor uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'create_slot é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_contract from contracts where id = p_contract;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'slots são de contratos private_1on1';
  end if;

  -- P1: individual cai no fuso do aluno; GRUPO exige âncora explícita — o
  -- min(iana_tz) alfabético saiu (a UI oferece o fuso do membro-âncora).
  v_tz := coalesce(
    p_iana_tz,
    (select s.iana_tz from students s where s.id = v_contract.student_id));
  if v_tz is null and v_contract.student_group_id is not null then
    raise exception 'contrato de GRUPO exige a âncora de fuso explícita (p_iana_tz) — P1/M4-1';
  end if;
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA do slot — informe p_iana_tz';
  end if;

  insert into recurring_slots
    (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from)
  values
    (p_contract, v_contract.teacher_id, p_weekday, p_local_time, v_tz, p_duration_min, p_active_from)
  returning id into v_id;

  perform public.materialize_slot(v_id, 8);

  perform public.log_audit(v_actor, 'create_slot', 'recurring_slots', v_id::text,
    jsonb_build_object('contract_id', p_contract, 'weekday', p_weekday,
                       'local_time', p_local_time, 'iana_tz', v_tz,
                       'active_from', p_active_from));
  return v_id;
end;
$$;

create or replace function public.close_and_create_slot(
  p_slot uuid,
  p_new_weekday int,
  p_new_local_time time,
  p_active_to date default current_date,
  p_new_iana_tz text default null,
  p_new_duration_min int default null,
  p_new_active_from date default null,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slot recurring_slots%rowtype;
  v_group uuid;
  v_cancelled int;
  v_new_id uuid;
  v_actor uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'close_and_create_slot é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_slot from recurring_slots where id = p_slot for update;
  if not found then
    raise exception 'slot % não existe', p_slot;
  end if;
  if v_slot.active_to is not null and v_slot.active_to <= p_active_to then
    raise exception 'slot % já está fechado em %', p_slot, v_slot.active_to;
  end if;
  if p_active_to < v_slot.active_from then
    raise exception 'active_to (%) anterior ao início do slot (%)', p_active_to, v_slot.active_from;
  end if;

  -- P1: troca de horário de GRUPO exige a âncora explícita (nunca herda calada).
  select c.student_group_id into v_group from contracts c where c.id = v_slot.contract_id;
  if v_group is not null and p_new_iana_tz is null then
    raise exception 'contrato de GRUPO: informe a âncora de fuso do novo horário (P1/M4-1)';
  end if;

  update recurring_slots set active_to = p_active_to where id = p_slot;

  update class_instances
     set state = 'cancelled'
   where slot_id = p_slot
     and state = 'scheduled'
     and occurrence_date > p_active_to;
  get diagnostics v_cancelled = row_count;

  v_new_id := public.create_slot(
    v_slot.contract_id,
    p_new_weekday,
    p_new_local_time,
    coalesce(p_new_iana_tz, v_slot.iana_tz),
    coalesce(p_new_duration_min, v_slot.duration_min),
    coalesce(p_new_active_from, p_active_to + 1),
    v_actor);

  perform public.log_audit(v_actor, 'close_and_create_slot', 'recurring_slots', p_slot::text,
    jsonb_build_object('closed_at', p_active_to, 'cancelled_future_instances', v_cancelled,
                       'new_slot', v_new_id, 'new_iana_tz', p_new_iana_tz));
  return v_new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Pendências (gate duro do encerramento/renovação — M5-3, com o lote M1-3
--    como atalho na UI).
-- ---------------------------------------------------------------------------
create or replace function public._contract_pending_count(p_contract uuid)
returns int
language sql
stable
as $$
  select count(*)::int from class_instances ci
  where ci.contract_id = p_contract
    and ci.state = 'scheduled'
    and ci.starts_at_utc < now()
$$;

-- destino compatível: mesmas pessoas (aluno = aluno, grupo = grupo, ou membro ↔ grupo)
create or replace function public._contracts_same_people(a contracts, b contracts)
returns boolean
language sql
stable
as $$
  select (a.student_id is not null and a.student_id = b.student_id)
      or (a.student_group_id is not null and a.student_group_id = b.student_group_id)
      or (a.student_group_id is not null and b.student_id in (
            select m.student_id from student_group_members m where m.group_id = a.student_group_id))
      or (b.student_group_id is not null and a.student_id in (
            select m.student_id from student_group_members m where m.group_id = b.student_group_id))
$$;

-- ---------------------------------------------------------------------------
-- 4. Encerramento estendido (M5-3 + M3-4).
-- ---------------------------------------------------------------------------
create or replace function public.admin_end_contract(
  p_contract uuid,
  p_dest_contract uuid default null,
  p_writeoff_note text default null,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old contracts%rowtype;
  v_dest contracts%rowtype;
  v_actor uuid;
  v_pending int;
  v_cancelled uuid[] := array[]::uuid[];
  v_slots int := 0;
  v_live record;
  v_transferred int := 0;
  v_writeoff int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_end_contract é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_old from contracts where id = p_contract for update;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_old.contract_type <> 'private_1on1' then
    raise exception 'encerramento estendido é de contratos particulares';
  end if;
  if v_old.status = 'ended' then
    raise exception 'contrato % já está encerrado', p_contract;
  end if;

  -- GATE DURO (M5-3): pendências exigem desfecho antes (o lote M1-3 é o atalho).
  v_pending := public._contract_pending_count(p_contract);
  if v_pending > 0 then
    raise exception 'há % aula(s) passada(s) sem desfecho neste contrato — registre antes (o botão "todas aconteceram" resolve as positivas)', v_pending;
  end if;

  -- destinação obrigatória quando há saldo vivo (escolha EXPLÍCITA)
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || p_contract::text, 0));
  if exists (
    select 1 from public._makeup_remaining_credits(p_contract) rc
    where rc.expires_on >= public.business_today()
  ) then
    if p_dest_contract is null and btrim(coalesce(p_writeoff_note, '')) = '' then
      raise exception 'este contrato tem créditos vivos — transfira para outro contrato do aluno OU dê baixa com motivo';
    end if;
  end if;
  if p_dest_contract is not null then
    select * into v_dest from contracts where id = p_dest_contract for update;
    if not found or v_dest.contract_type <> 'private_1on1' or v_dest.status <> 'active' then
      raise exception 'contrato destino inválido (precisa ser particular ATIVO)';
    end if;
    if p_dest_contract = p_contract then
      raise exception 'destino não pode ser o próprio contrato';
    end if;
    if not public._contracts_same_people(v_old, v_dest) then
      raise exception 'o destino precisa ser do MESMO aluno/grupo (M3-4)';
    end if;
  end if;

  -- futuras saem SEM crédito e SEM aviso (P4: deliberado — conversa humana).
  select coalesce(array_agg(ci.id), array[]::uuid[]) into v_cancelled
  from class_instances ci
  where ci.contract_id = p_contract and ci.state = 'scheduled' and ci.starts_at_utc > now();
  if coalesce(array_length(v_cancelled, 1), 0) > 0 then
    update class_instances set state = 'cancelled' where id = any(v_cancelled);
  end if;

  update recurring_slots
     set active_to = public.business_today()
   where contract_id = p_contract
     and (active_to is null or active_to > public.business_today());
  get diagnostics v_slots = row_count;

  -- destinação dos créditos vivos (validade e duração PRESERVADAS — M3-4/P6)
  for v_live in
    select rc.ledger_id, rc.expires_on from public._makeup_remaining_credits(p_contract) rc
    where rc.expires_on >= public.business_today()
    order by rc.ord
  loop
    if p_dest_contract is not null then
      perform public._reissue_credit(v_live.ledger_id, v_live.expires_on, v_actor,
        'encerramento: crédito transferido', p_dest_contract);
      v_transferred := v_transferred + 1;
    else
      insert into makeup_ledger
        (contract_id, student_id, delta, reason, consumes_ledger_id, note, created_by)
      values
        (p_contract, v_old.student_id, -1, 'manual_adjust', v_live.ledger_id,
         'encerramento: baixa — ' || p_writeoff_note, v_actor);
      v_writeoff := v_writeoff + 1;
    end if;
  end loop;

  -- greatest: contrato com started_on futuro nunca viola o CHECK ended>=started
  update contracts
     set status = 'ended', ended_on = greatest(public.business_today(), started_on)
   where id = p_contract;

  perform public.log_audit(v_actor, 'end_contract', 'contracts', p_contract::text,
    jsonb_build_object(
      'razao', 'encerramento',
      'cancelled_instances', to_jsonb(v_cancelled),
      'slots_closed', v_slots,
      'credits_transferred', v_transferred,
      'credits_written_off', v_writeoff,
      'dest_contract', p_dest_contract,
      'writeoff_note', p_writeoff_note));

  return jsonb_build_object('cancelled', coalesce(array_length(v_cancelled, 1), 0),
                            'slots_closed', v_slots,
                            'transferred', v_transferred, 'written_off', v_writeoff);
end;
$$;
revoke execute on function public.admin_end_contract(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.admin_end_contract(uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Renovação guiada (M5-1) — a costura na ordem validada; tudo numa transação.
-- ---------------------------------------------------------------------------
create or replace function public.admin_renew_contract(
  p_old uuid,
  p_switch_on date,
  p_plan_name text,
  p_hourly_rate_cents int,
  p_allowance int,
  p_min_notice int,
  p_expiry_days int,
  p_school_fault_days int,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old contracts%rowtype;
  v_actor uuid;
  v_pending int;
  v_new uuid;
  v_slot record;
  v_slots_copied int := 0;
  v_cancelled uuid[] := array[]::uuid[];
  v_live record;
  v_transferred int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_renew_contract é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_old from contracts where id = p_old for update;
  if not found then
    raise exception 'contrato % não existe', p_old;
  end if;
  if v_old.contract_type <> 'private_1on1' or v_old.status <> 'active' then
    raise exception 'renovação exige contrato particular ATIVO (pausado: retome antes)';
  end if;
  if p_switch_on < public.business_today() then
    raise exception 'a virada (%) não pode ficar no passado', p_switch_on;
  end if;
  -- P13: o limite documentado vira comportamento PROVADO.
  if p_switch_on > public.business_today() + 56 then
    raise exception 'a virada precisa estar a no máximo 8 semanas (recebido %)', p_switch_on;
  end if;
  if p_hourly_rate_cents is null or p_hourly_rate_cents <= 0 then
    raise exception 'valor da aula inválido';
  end if;

  v_pending := public._contract_pending_count(p_old);
  if v_pending > 0 then
    raise exception 'há % aula(s) passada(s) sem desfecho — registre antes de renovar', v_pending;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || p_old::text, 0));

  -- (a) cancelar futuras do velho a partir da virada (data civil do negócio,
  -- mesma régua da pausa) — SEM crédito, SEM aviso (P4 deliberado)
  select coalesce(array_agg(ci.id), array[]::uuid[]) into v_cancelled
  from class_instances ci
  where ci.contract_id = p_old and ci.state = 'scheduled'
    and (ci.starts_at_utc at time zone public.business_tz())::date >= p_switch_on;
  if coalesce(array_length(v_cancelled, 1), 0) > 0 then
    update class_instances set state = 'cancelled' where id = any(v_cancelled);
  end if;

  -- (b) criar o novo (antes de fechar os slots, para copiá-los da foto viva)
  insert into contracts
    (contract_type, student_id, student_group_id, teacher_id, plan_name,
     hourly_rate_cents, monthly_reschedule_allowance, min_notice_hours,
     makeup_credit_expiry_days, school_fault_credit_expiry_days,
     started_on, status, renewed_from, group_tz_anchor_student)
  values
    ('private_1on1', v_old.student_id, v_old.student_group_id, v_old.teacher_id,
     p_plan_name, p_hourly_rate_cents, p_allowance, p_min_notice,
     p_expiry_days, p_school_fault_days, p_switch_on, 'active', p_old,
     v_old.group_tz_anchor_student)
  returning id into v_new;

  -- (c) fechar horários do velho na véspera e recriá-los no novo desde a virada
  -- (fuso EXPLÍCITO copiado de cada slot — emenda sem buraco nem duplicata)
  for v_slot in
    select rs.* from recurring_slots rs
    where rs.contract_id = p_old
      and (rs.active_to is null or rs.active_to >= p_switch_on)
  loop
    update recurring_slots set active_to = p_switch_on - 1 where id = v_slot.id;
    perform public.create_slot(
      v_new, v_slot.weekday, v_slot.local_time, v_slot.iana_tz,
      v_slot.duration_min, p_switch_on, v_actor);
    v_slots_copied := v_slots_copied + 1;
  end loop;

  -- (d) encerrar o velho na véspera da virada (greatest: virada no dia do
  -- próprio started_on não viola o CHECK ended>=started)
  update contracts
     set status = 'ended', ended_on = greatest(p_switch_on - 1, v_old.started_on)
   where id = p_old;

  -- (e) créditos vivos migram preservando validade + duração (M3-4/P6)
  for v_live in
    select rc.ledger_id, rc.expires_on from public._makeup_remaining_credits(p_old) rc
    where rc.expires_on >= public.business_today()
    order by rc.ord
  loop
    perform public._reissue_credit(v_live.ledger_id, v_live.expires_on, v_actor,
      'renovação: crédito transferido', v_new);
    v_transferred := v_transferred + 1;
  end loop;

  perform public.log_audit(v_actor, 'renew_contract', 'contracts', v_new::text,
    jsonb_build_object(
      'renewed_from', p_old, 'switch_on', p_switch_on,
      'cancelled_instances', to_jsonb(v_cancelled),
      'slots_copied', v_slots_copied,
      'credits_transferred', v_transferred,
      'hourly_rate_cents', p_hourly_rate_cents));

  return v_new;
end;
$$;
revoke execute on function
  public.admin_renew_contract(uuid, date, text, int, int, int, int, int, uuid)
from public, anon;
grant execute on function
  public.admin_renew_contract(uuid, date, text, int, int, int, int, int, uuid)
to authenticated;
