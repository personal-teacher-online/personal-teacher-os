-- Fase 2 / M2 — materialize_instances serializada por advisory lock.
-- Na Fase 1 só o cron de domingo a chamava; com create_slot/close_and_create_slot (D8)
-- ela passou a rodar SOB DEMANDA — duas execuções concorrentes (admin criando slot
-- enquanto o cron roda, ou dois admins) inserem instâncias em ordens diferentes e podem
-- DEADLOCKAR na constraint de exclusão do professor (o handler da função captura
-- unique/exclusion, mas deadlock aborta a chamada). O lock transacional serializa:
-- a segunda chamada espera a primeira e então roda (idempotente — nada se perde).
-- Corpo idêntico ao da Fase 1 (20260711000600) + o lock; Lei 7 preservada (arquivo
-- antigo intocado; replace em migration nova).

create or replace function public.materialize_instances(p_weeks int default 8)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_date date;
  v_end_date date;
  v_starts timestamptz;
  v_created int := 0;
begin
  -- Uma materialização por vez (liberado no fim da transação).
  perform pg_advisory_xact_lock(hashtextextended('materialize_instances', 0));

  for r in
    select rs.*
    from recurring_slots rs
    join contracts c on c.id = rs.contract_id
    where c.status = 'active'
  loop
    -- Horizonte ancorado no "hoje" civil DA ZONA DO SLOT (não em UTC).
    v_date := (now() at time zone r.iana_tz)::date;
    v_end_date := v_date + (p_weeks * 7);
    -- Avança até o primeiro dia com o weekday do slot (0=domingo ... 6=sábado).
    v_date := v_date + ((r.weekday - extract(dow from v_date)::int + 7) % 7);

    while v_date <= v_end_date loop
      if v_date >= r.active_from and (r.active_to is null or v_date <= r.active_to) then
        v_starts := (v_date + r.local_time) at time zone r.iana_tz;
        if v_starts > now() then -- nunca materializa ocorrência já passada
          begin
            insert into class_instances
              (contract_id, teacher_id, slot_id, occurrence_date,
               starts_at_utc, ends_at_utc, local_time_snapshot)
            values
              (r.contract_id, r.teacher_id, r.id, v_date,
               v_starts, v_starts + make_interval(mins => r.duration_min),
               to_char(v_date, 'YYYY-MM-DD') || ' ' || to_char(r.local_time, 'HH24:MI') || ' ' || r.iana_tz)
            on conflict (slot_id, occurrence_date) where slot_id is not null
            do nothing; -- idempotência: ocorrência já existe (inclusive remarcada/cancelada)
            if found then
              v_created := v_created + 1;
            end if;
          exception
            when exclusion_violation or unique_violation then
              -- Conflito de agenda do professor: pula ESTA ocorrência, segue o lote,
              -- e deixa o problema visível (Lei 8).
              raise warning 'conflito de agenda ao materializar slot % em %: %', r.id, v_date, sqlerrm;
              insert into audit_log (action, entity, entity_id, diff)
              values ('materialize_conflict', 'recurring_slots', r.id::text,
                      jsonb_build_object('occurrence_date', v_date, 'error', sqlerrm));
          end;
        end if;
      end if;
      v_date := v_date + 7;
    end loop;
  end loop;

  return v_created;
end;
$$;

-- Replace preserva grants/revokes existentes (EXECUTE segue revogado de clientes).

-- ---------------------------------------------------------------------------
-- Materialização de UM slot (para create_slot/close_and_create_slot): criar um slot
-- não deve varrer a agenda inteira — e a varredura global sob demanda deadlockava com
-- transações que já seguravam locks de linhas de OUTROS slots. Mesma lógica interna,
-- escopo de um slot, lock por slot.
-- ---------------------------------------------------------------------------
create or replace function public.materialize_slot(p_slot uuid, p_weeks int default 8)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_date date;
  v_end_date date;
  v_starts timestamptz;
  v_created int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('materialize_slot:' || p_slot::text, 0));

  select rs.* into r
  from recurring_slots rs
  join contracts c on c.id = rs.contract_id
  where rs.id = p_slot and c.status = 'active';
  if not found then
    return 0;
  end if;

  v_date := (now() at time zone r.iana_tz)::date;
  v_end_date := v_date + (p_weeks * 7);
  v_date := v_date + ((r.weekday - extract(dow from v_date)::int + 7) % 7);

  while v_date <= v_end_date loop
    if v_date >= r.active_from and (r.active_to is null or v_date <= r.active_to) then
      v_starts := (v_date + r.local_time) at time zone r.iana_tz;
      if v_starts > now() then
        begin
          insert into class_instances
            (contract_id, teacher_id, slot_id, occurrence_date,
             starts_at_utc, ends_at_utc, local_time_snapshot)
          values
            (r.contract_id, r.teacher_id, r.id, v_date,
             v_starts, v_starts + make_interval(mins => r.duration_min),
             to_char(v_date, 'YYYY-MM-DD') || ' ' || to_char(r.local_time, 'HH24:MI') || ' ' || r.iana_tz)
          on conflict (slot_id, occurrence_date) where slot_id is not null
          do nothing;
          if found then
            v_created := v_created + 1;
          end if;
        exception
          when exclusion_violation or unique_violation then
            raise warning 'conflito de agenda ao materializar slot % em %: %', r.id, v_date, sqlerrm;
            insert into audit_log (action, entity, entity_id, diff)
            values ('materialize_conflict', 'recurring_slots', r.id::text,
                    jsonb_build_object('occurrence_date', v_date, 'error', sqlerrm));
        end;
      end if;
    end if;
    v_date := v_date + 7;
  end loop;

  return v_created;
end;
$$;

revoke execute on function public.materialize_slot(uuid, int) from public, anon, authenticated;
