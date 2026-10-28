-- Fase 2 / M1.5 — RPCs de slot (D8, item 6c do M1): "editar horário" NÃO é UPDATE
-- (trigger do ADR-008 §3 bloqueia) — é fechar-e-criar TRANSACIONAL com materialização
-- imediata (aula nova não espera o cron de domingo). Admin-only (D10).

-- Cria slot novo + materializa o PRÓPRIO slot na mesma transação (idempotente pela
-- chave slot+occurrence_date; materialize_slot definida em 20260712000700).
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

  -- Zona do slot = a do aluno (padrão do negócio); grupo usa a dos membros.
  v_tz := coalesce(
    p_iana_tz,
    (select s.iana_tz from students s where s.id = v_contract.student_id),
    (select min(s.iana_tz) from student_group_members m
       join students s on s.id = m.student_id
      where m.group_id = v_contract.student_group_id));
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA do slot — informe p_iana_tz';
  end if;

  insert into recurring_slots
    (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from)
  values
    (p_contract, v_contract.teacher_id, p_weekday, p_local_time, v_tz, p_duration_min, p_active_from)
  returning id into v_id;

  -- Materializa SÓ o slot criado (a varredura global é do cron; sob demanda ela
  -- deadlockava com transações concorrentes — ver 20260712000700).
  perform public.materialize_slot(v_id, 8);

  perform public.log_audit(v_actor, 'create_slot', 'recurring_slots', v_id::text,
    jsonb_build_object('contract_id', p_contract, 'weekday', p_weekday,
                       'local_time', p_local_time, 'iana_tz', v_tz,
                       'active_from', p_active_from));
  return v_id;
end;
$$;

-- Fechar-e-criar (D8): (a) fecha o slot com active_to; (b) cancela as instâncias
-- futuras 'scheduled' posteriores a active_to SEM crédito (mudança acordada não é
-- linha da matriz D2); (c) cria o slot novo; (d) materializa na MESMA transação.
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

  update recurring_slots set active_to = p_active_to where id = p_slot;

  -- (b) Futuras do slot fechado saem da agenda SEM crédito (não passa por cancel_class:
  -- a matriz D2 é para cancelamento de aula, não para mudança acordada de horário).
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
                       'new_slot', v_new_id));
  return v_new_id;
end;
$$;

-- Exposição (ADR-010 §2): revogar o default PUBLIC; abrir só a authenticated
-- (o check de admin vive dentro — D10).
revoke execute on function
  public.create_slot(uuid, int, time, text, int, date, uuid),
  public.close_and_create_slot(uuid, int, time, date, text, int, date, uuid)
from public, anon, authenticated;

grant execute on function
  public.create_slot(uuid, int, time, text, int, date, uuid),
  public.close_and_create_slot(uuid, int, time, date, text, int, date, uuid)
to authenticated;
