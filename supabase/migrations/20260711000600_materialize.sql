-- M3 — Materialização de instâncias (o coração do timezone).
-- Lei 1: a regra vive em hora local + zona IANA; cada instância é expandida para UTC
-- calculando o offset DAQUELE dia: (date + local_time) AT TIME ZONE iana_tz — o
-- Postgres resolve DST via tzdata. Idempotente pela chave (slot_id, occurrence_date)
-- (ADR-008 item 3). Sessões de mentoria NÃO passam por aqui (datas avulsas).

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

revoke execute on function public.materialize_instances(int) from public, anon, authenticated;

-- Job semanal (Lei 5: pg_cron). Domingo 06:00 UTC, horizonte padrão de 8 semanas.
-- (cron.schedule com o mesmo nome atualiza o job — idempotente entre resets.)
select cron.schedule(
  'materialize-instances-weekly',
  '0 6 * * 0',
  $$select public.materialize_instances(8)$$
);
