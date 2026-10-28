-- M4 — Seeds reais (docs/goals/fase1-fundacao.md, "Dados reais").
-- Convenção weekday: 0=domingo ... 6=sábado. Horários na hora LOCAL do aluno (D1).
-- Mentoria (D4): nenhum contrato semeado — apenas a estrutura das migrations.
-- Roda como owner (postgres): triggers de auditoria registram tudo com actor NULL (seed).

-- Helper temporário: cria aluno + contrato particular + slots + backlog.
create function pg_temp.seed_private(
  p_teacher uuid,
  p_name text,
  p_tz text,
  p_allowance int,
  p_backlog int,
  p_slots jsonb -- [{"weekday": int, "time": "HH:MM", "duration": int}]
) returns uuid
language plpgsql
as $$
declare
  v_student uuid;
  v_contract uuid;
  s jsonb;
begin
  -- `tz_confirmed` explícito (c11 · U1): o default da coluna é `false` desde a
  -- 20260727001000, e o seed representa alunos REAIS, com cidade conferida —
  -- sem isso o contrato logo abaixo esbarraria na guarda `_require_confirmed_tz`.
  insert into students (display_name, iana_tz, tz_confirmed)
  values (p_name, p_tz, true)
  returning id into v_student;

  insert into contracts
    (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
     monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
  values
    ('private_1on1', v_student, p_teacher, 'Aulas particulares', 15000,
     p_allowance, 24, 90, '2026-06-01')
  returning id into v_contract;

  for s in select * from jsonb_array_elements(p_slots) loop
    insert into recurring_slots
      (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from)
    values
      (v_contract, p_teacher, (s ->> 'weekday')::int, (s ->> 'time')::time, p_tz,
       coalesce((s ->> 'duration')::int, 45), '2026-06-01');
  end loop;

  -- Backlog: cada aula pendente = 1 entrada initial_backlog expirando em 31/07/2026.
  for i in 1 .. p_backlog loop
    insert into makeup_ledger (contract_id, student_id, delta, reason, expires_on)
    values (v_contract, v_student, 1, 'initial_backlog', '2026-07-31');
  end loop;

  return v_contract;
end;
$$;

do $$
declare
  v_dona uuid;
  v_parceira uuid;
  v_contract uuid;
  v_group uuid;
  v_natalia uuid;
  v_yago uuid;
  v_sabrina_contract uuid;
  v_sabrina_slot uuid;
  v_orig1 uuid;
  v_orig2 uuid;
begin
  -- Professoras ------------------------------------------------------------
  insert into teachers (hourly_rate_cents, is_owner, payment_terms, display_name)
  values (0, true, 'Dona — não remunerada por hora', 'Teacher Vicky')
  returning id into v_dona;

  -- iana_tz explícito (F3-D2/Q1): em produção o backfill da migration 20260713000100
  -- ajusta a linha EXISTENTE; no seed local a linha nasce depois da migration.
  insert into teachers (hourly_rate_cents, is_owner, payment_terms, display_name, iana_tz)
  values (5000, false, 'Paga por hora AUDITADA — R$50/h confirmado pela dona', 'Renata', 'America/Sao_Paulo')
  returning id into v_parceira;

  -- Alunos da dona -------------------------------------------------------
  perform pg_temp.seed_private(v_dona, 'Amanda Karina Serra', 'America/Sao_Paulo', 4, 0,
    '[{"weekday":3,"time":"08:15"},{"weekday":5,"time":"08:15"}]');
  perform pg_temp.seed_private(v_dona, 'Bianca Bastos', 'America/New_York', 4, 0,
    '[{"weekday":1,"time":"11:00"},{"weekday":3,"time":"11:00"},{"weekday":5,"time":"11:00"}]');
  perform pg_temp.seed_private(v_dona, 'Elisa Faria', 'America/Cuiaba', 3, 1,
    '[{"weekday":2,"time":"13:15"}]');
  perform pg_temp.seed_private(v_dona, 'Gabriel Barros', 'America/Cuiaba', 4, 0,
    '[{"weekday":1,"time":"16:45"},{"weekday":3,"time":"16:45"}]');
  perform pg_temp.seed_private(v_dona, 'Luís Bento', 'America/Sao_Paulo', 4, 1,
    '[{"weekday":1,"time":"16:50"},{"weekday":3,"time":"16:50"}]');
  perform pg_temp.seed_private(v_dona, 'Tomás Estevão', 'America/Campo_Grande', 4, 8,
    '[{"weekday":2,"time":"18:30"},{"weekday":4,"time":"18:30"}]');
  perform pg_temp.seed_private(v_dona, 'Vinícius Lacerda', 'America/Sao_Paulo', 4, 2,
    '[{"weekday":1,"time":"19:00"},{"weekday":3,"time":"19:00"}]');

  -- Alunos da professora ------------------------------------------------------
  perform pg_temp.seed_private(v_parceira, 'Fábio Ramos', 'America/Sao_Paulo', 2, 0,
    '[{"weekday":5,"time":"06:30"}]');
  perform pg_temp.seed_private(v_parceira, 'Jéssica Sampaio', 'America/Fortaleza', 4, 1,
    '[{"weekday":3,"time":"18:00"},{"weekday":5,"time":"18:00"}]');
  perform pg_temp.seed_private(v_parceira, 'Joana Siqueira', 'Europe/Lisbon', 2, 0,
    '[{"weekday":2,"time":"20:00","duration":60}]');
  perform pg_temp.seed_private(v_parceira, 'Lara Moraes', 'America/Cuiaba', 2, 0,
    '[{"weekday":2,"time":"19:30"}]');
  perform pg_temp.seed_private(v_parceira, 'Murilo Fonseca', 'America/Cuiaba', 2, 4,
    '[{"weekday":6,"time":"09:00"}]');

  -- Casal Natália e Yago (ADR-001/ADR-002): grupo compartilha contrato e créditos.
  insert into students (display_name, iana_tz, tz_confirmed) values ('Natália', 'America/Cuiaba', true) returning id into v_natalia;
  insert into students (display_name, iana_tz, tz_confirmed) values ('Yago', 'America/Cuiaba', true) returning id into v_yago;
  insert into student_groups (label) values ('Natália e Yago (casal)') returning id into v_group;
  insert into student_group_members (group_id, student_id) values (v_group, v_natalia), (v_group, v_yago);
  insert into contracts
    (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
     monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
  values
    ('private_1on1', v_group, v_parceira, 'Aulas particulares (casal)', 15000, 2, 24, 90, '2026-06-01')
  returning id into v_contract;
  insert into recurring_slots (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from)
  values (v_contract, v_parceira, 3, '21:15', 'America/Cuiaba', 45, '2026-06-01');
  for i in 1 .. 4 loop -- backlog do CONTRATO (student_id NULL: crédito é do casal)
    insert into makeup_ledger (contract_id, delta, reason, expires_on)
    values (v_contract, 1, 'initial_backlog', '2026-07-31');
  end loop;

  -- Sabrina + caso real de remarcação de férias ------------------------------
  v_sabrina_contract := pg_temp.seed_private(v_parceira, 'Sabrina', 'America/Cuiaba', 2, 0,
    '[{"weekday":2,"time":"17:00"}]');
  select id into v_sabrina_slot from recurring_slots where contract_id = v_sabrina_contract;

  -- Originais de 07/07 e 14/07 (ter 17:00 Cuiabá), remarcadas. Mantêm slot_id +
  -- occurrence_date: a chave de idempotência impede o job de recriá-las.
  insert into class_instances
    (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc, local_time_snapshot, state)
  values
    (v_sabrina_contract, v_parceira, v_sabrina_slot, '2026-07-07',
     ('2026-07-07'::date + '17:00'::time) at time zone 'America/Cuiaba',
     ('2026-07-07'::date + '17:45'::time) at time zone 'America/Cuiaba',
     '2026-07-07 17:00 America/Cuiaba', 'rescheduled')
  returning id into v_orig1;
  insert into class_instances
    (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc, local_time_snapshot, state)
  values
    (v_sabrina_contract, v_parceira, v_sabrina_slot, '2026-07-14',
     ('2026-07-14'::date + '17:00'::time) at time zone 'America/Cuiaba',
     ('2026-07-14'::date + '17:45'::time) at time zone 'America/Cuiaba',
     '2026-07-14 17:00 America/Cuiaba', 'rescheduled')
  returning id into v_orig2;

  -- Novas: 23/07 (qui) e 30/07 (qui) às 18:00 Cuiabá, avulsas (ADR-008), apontando
  -- para as originais.
  insert into class_instances
    (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot, state, reschedule_of)
  values
    (v_sabrina_contract, v_parceira,
     ('2026-07-23'::date + '18:00'::time) at time zone 'America/Cuiaba',
     ('2026-07-23'::date + '18:45'::time) at time zone 'America/Cuiaba',
     '2026-07-23 18:00 America/Cuiaba', 'scheduled', v_orig1),
    (v_sabrina_contract, v_parceira,
     ('2026-07-30'::date + '18:00'::time) at time zone 'America/Cuiaba',
     ('2026-07-30'::date + '18:45'::time) at time zone 'America/Cuiaba',
     '2026-07-30 18:00 America/Cuiaba', 'scheduled', v_orig2);

  -- As 2 remarcações consumiram a alçada mensal de julho (aprovado no gate do M4).
  insert into reschedule_usage (contract_id, period_ym, used_count)
  values (v_sabrina_contract, '2026-07', 2);
end;
$$;

-- Materializa as próximas 8 semanas de todos os slots ativos.
select public.materialize_instances(8);
