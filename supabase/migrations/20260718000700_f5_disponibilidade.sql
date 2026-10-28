-- F5 — Disponibilidade recorrente, exceções e tratamento de período (plano
-- integrado v2, 18/07/2026; decisões M1-4, M12-12 + P4/P5 do passe adversarial).
--
-- O motor de janelas publicadas (20260712000100) vira o ANDAR DE BAIXO — nada é
-- jogado fora: a reserva computada MATERIALIZA uma janela e a consome NA MESMA
-- transação via book_reschedule_window (todas as invariantes — antecedência,
-- 14 dias, conflito, saldo, aviso — continuam decididas pelo mesmo código).
-- "Migração dos slots publicados → sem perda": as janelas publicadas continuam
-- ofertáveis como sempre; a camada computada as UNE à agenda semanal (dedupe
-- por instante no app). Nenhum dado é movido — é a forma sem perda com zero
-- risco de duplicação.
--
-- Google ocupado é ANTECIPAÇÃO de UX no app (fail-open): quando o Google está
-- indisponível, a reserva segue e o audit ganha o MARCADOR google_degraded.

-- ---------------------------------------------------------------------------
-- 1. Agenda semanal da professora + exceções (±)
-- ---------------------------------------------------------------------------
create table teacher_weekly_availability (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers (id),
  weekday int not null check (weekday between 0 and 6),
  start_local time not null,
  end_local time not null,
  iana_tz text not null,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  constraint tw_avail_order check (end_local > start_local)
);
comment on table teacher_weekly_availability is
  'M1-4: janela SEMANAL de disponibilidade (hora local + zona IANA — Lei 1). '
  'Os horários ofertáveis são COMPUTADOS: janela − aulas − bloqueios − Google.';
create index tw_avail_teacher_idx on teacher_weekly_availability (teacher_id);
create trigger tw_avail_valid_tz
  before insert or update of iana_tz on teacher_weekly_availability
  for each row execute function public.assert_valid_iana_tz();

create table teacher_availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers (id),
  kind text not null check (kind in ('open', 'block')),
  starts_at_utc timestamptz not null,
  ends_at_utc timestamptz not null,
  local_snapshot text not null,
  note text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  constraint tw_exc_order check (ends_at_utc > starts_at_utc)
);
comment on table teacher_availability_exceptions is
  'M1-4: exceções pontuais (±) sobre a agenda semanal, materializadas em UTC com '
  'o offset DAQUELE dia (Lei 1). block fecha; open abre (reservado — hoje o '
  '"abrir avulso" continua sendo a janela publicada).';
create index tw_exc_teacher_time_idx on teacher_availability_exceptions (teacher_id, starts_at_utc);

alter table teacher_weekly_availability enable row level security;
alter table teacher_availability_exceptions enable row level security;
-- a oferta é pública para quem está logado (é o que o aluno reserva)
create policy tw_avail_read on teacher_weekly_availability
  for select to authenticated using (true);
create policy tw_exc_read on teacher_availability_exceptions
  for select to authenticated using (true);
grant select on teacher_weekly_availability, teacher_availability_exceptions
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Feriados BR + política por professora
-- ---------------------------------------------------------------------------
create table br_holidays (
  holiday date primary key,
  label text not null
);
comment on table br_holidays is 'M1-4: feriados nacionais (semeados por ano — manutenção anual leve).';
insert into br_holidays (holiday, label) values
  ('2026-01-01', 'Confraternização Universal'),
  ('2026-02-17', 'Carnaval (terça)'),
  ('2026-04-03', 'Sexta-feira Santa'),
  ('2026-04-21', 'Tiradentes'),
  ('2026-05-01', 'Dia do Trabalho'),
  ('2026-06-04', 'Corpus Christi'),
  ('2026-09-07', 'Independência'),
  ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'),
  ('2026-11-15', 'Proclamação da República'),
  ('2026-11-20', 'Consciência Negra'),
  ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Confraternização Universal'),
  ('2027-02-09', 'Carnaval (terça)'),
  ('2027-03-26', 'Sexta-feira Santa'),
  ('2027-04-21', 'Tiradentes'),
  ('2027-05-01', 'Dia do Trabalho'),
  ('2027-05-27', 'Corpus Christi'),
  ('2027-09-07', 'Independência'),
  ('2027-10-12', 'Nossa Senhora Aparecida'),
  ('2027-11-02', 'Finados'),
  ('2027-11-15', 'Proclamação da República'),
  ('2027-11-20', 'Consciência Negra'),
  ('2027-12-25', 'Natal');
alter table br_holidays enable row level security;
create policy br_holidays_read on br_holidays for select to authenticated using (true);
grant select on br_holidays to anon, authenticated;

alter table teachers add column holiday_policy text not null default 'flag'
  check (holiday_policy in ('cancel_credit', 'flag'));
comment on column teachers.holiday_policy is
  'M1-4: em feriado BR, cancel_credit = cancelar as aulas do dia com crédito '
  '(política da dona); flag = só sinalizar para decidir caso a caso (default).';

-- ---------------------------------------------------------------------------
-- 3. Gestão da agenda semanal e bloqueios (admin OU a própria professora)
-- ---------------------------------------------------------------------------
create or replace function public._can_manage_teacher(p_teacher uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- coalesce: aluno tem my_teacher_id() NULL → NULL enganaria um IF NOT (…)
  select coalesce(public.app_role() = 'admin' or public.my_teacher_id() = p_teacher, false)
$$;

create or replace function public.set_weekly_availability(
  p_teacher uuid,
  p_weekday int,
  p_start time,
  p_end time,
  p_iana_tz text default null,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_id uuid;
  v_actor uuid;
begin
  if not public._can_manage_teacher(p_teacher) then
    raise exception 'agenda semanal é da própria professora ou da admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  select coalesce(p_iana_tz, t.iana_tz, public.business_tz()) into v_tz
  from teachers t where t.id = p_teacher;
  if v_tz is null then
    raise exception 'professora % não existe', p_teacher;
  end if;

  insert into teacher_weekly_availability (teacher_id, weekday, start_local, end_local, iana_tz, created_by)
  values (p_teacher, p_weekday, p_start, p_end, v_tz, v_actor)
  returning id into v_id;

  perform public.log_audit(v_actor, 'set_weekly_availability', 'teacher_weekly_availability', v_id::text,
    jsonb_build_object('teacher_id', p_teacher, 'weekday', p_weekday,
                       'start', p_start, 'end', p_end, 'iana_tz', v_tz));
  return v_id;
end;
$$;
revoke execute on function public.set_weekly_availability(uuid, int, time, time, text, uuid)
from public, anon;
grant execute on function public.set_weekly_availability(uuid, int, time, time, text, uuid)
to authenticated;

create or replace function public.remove_weekly_availability(p_id uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row teacher_weekly_availability%rowtype;
begin
  select * into v_row from teacher_weekly_availability where id = p_id;
  if not found then
    raise exception 'janela semanal % não existe', p_id;
  end if;
  if not public._can_manage_teacher(v_row.teacher_id) then
    raise exception 'agenda semanal é da própria professora ou da admin (D10)';
  end if;
  delete from teacher_weekly_availability where id = p_id;
  perform public.log_audit(coalesce(auth.uid(), p_actor), 'remove_weekly_availability',
    'teacher_weekly_availability', p_id::text,
    jsonb_build_object('teacher_id', v_row.teacher_id, 'weekday', v_row.weekday,
                       'start', v_row.start_local, 'end', v_row.end_local));
end;
$$;
revoke execute on function public.remove_weekly_availability(uuid, uuid) from public, anon;
grant execute on function public.remove_weekly_availability(uuid, uuid) to authenticated;

-- Bloqueio de dias inteiros (na zona da professora; Lei 1 no cálculo do instante).
create or replace function public.add_teacher_block(
  p_teacher uuid,
  p_from date,
  p_to date,
  p_note text default null,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_id uuid;
  v_actor uuid;
begin
  if not public._can_manage_teacher(p_teacher) then
    raise exception 'bloqueio de agenda é da própria professora ou da admin (D10)';
  end if;
  if p_to < p_from then
    raise exception 'período invertido (% → %)', p_from, p_to;
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  select coalesce(t.iana_tz, public.business_tz()) into v_tz from teachers t where t.id = p_teacher;
  if v_tz is null then
    raise exception 'professora % não existe', p_teacher;
  end if;

  insert into teacher_availability_exceptions
    (teacher_id, kind, starts_at_utc, ends_at_utc, local_snapshot, note, created_by)
  values
    (p_teacher, 'block',
     (p_from + time '00:00') at time zone v_tz,
     ((p_to + 1) + time '00:00') at time zone v_tz,
     p_from || ' → ' || p_to || ' ' || v_tz, p_note, v_actor)
  returning id into v_id;

  perform public.log_audit(v_actor, 'add_teacher_block', 'teacher_availability_exceptions', v_id::text,
    jsonb_build_object('teacher_id', p_teacher, 'from', p_from, 'to', p_to, 'note', p_note));
  return v_id;
end;
$$;
revoke execute on function public.add_teacher_block(uuid, date, date, text, uuid) from public, anon;
grant execute on function public.add_teacher_block(uuid, date, date, text, uuid) to authenticated;

create or replace function public.remove_teacher_block(p_id uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row teacher_availability_exceptions%rowtype;
begin
  select * into v_row from teacher_availability_exceptions where id = p_id;
  if not found then
    raise exception 'exceção % não existe', p_id;
  end if;
  if not public._can_manage_teacher(v_row.teacher_id) then
    raise exception 'bloqueio de agenda é da própria professora ou da admin (D10)';
  end if;
  delete from teacher_availability_exceptions where id = p_id;
  perform public.log_audit(coalesce(auth.uid(), p_actor), 'remove_teacher_block',
    'teacher_availability_exceptions', p_id::text,
    jsonb_build_object('teacher_id', v_row.teacher_id, 'snapshot', v_row.local_snapshot));
end;
$$;
revoke execute on function public.remove_teacher_block(uuid, uuid) from public, anon;
grant execute on function public.remove_teacher_block(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A verdade da disponibilidade (camada do BANCO — Google fica no app):
--    dentro de janela semanal (na zona DELA) ou exceção open, e sem block.
-- ---------------------------------------------------------------------------
create or replace function public._teacher_available_for(
  p_teacher uuid,
  p_starts timestamptz,
  p_ends timestamptz
) returns boolean
language plpgsql
stable
as $$
declare
  v_in boolean;
begin
  if exists (
    select 1 from teacher_availability_exceptions e
    where e.teacher_id = p_teacher and e.kind = 'block'
      and e.starts_at_utc < p_ends and e.ends_at_utc > p_starts
  ) then
    return false;
  end if;

  select exists (
    select 1 from teacher_weekly_availability w
    where w.teacher_id = p_teacher
      and extract(dow from (p_starts at time zone w.iana_tz))::int = w.weekday
      and (p_starts at time zone w.iana_tz)::time >= w.start_local
      and (p_ends at time zone w.iana_tz)::time <= w.end_local
      and (p_starts at time zone w.iana_tz)::date = ((p_ends - interval '1 minute') at time zone w.iana_tz)::date
  ) or exists (
    select 1 from teacher_availability_exceptions e
    where e.teacher_id = p_teacher and e.kind = 'open'
      and e.starts_at_utc <= p_starts and e.ends_at_utc >= p_ends
  ) into v_in;
  return v_in;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reserva de horário COMPUTADO: materializa a janela e consome na MESMA
--    transação. Todas as invariantes (posse, antecedência, 14 dias, saldo,
--    aviso, conflito) continuam no book_reschedule_window (fonte única).
-- ---------------------------------------------------------------------------
create or replace function public.book_computed_slot(
  p_teacher uuid,
  p_starts_at_utc timestamptz,
  p_instance uuid default null,
  p_contract uuid default null,
  p_actor uuid default null,
  p_courtesy boolean default false,
  p_courtesy_note text default null,
  p_bypass_lead boolean default false,
  p_google_degraded boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_tz text;
  v_dur int;
  v_slot_dur int;
  v_contract_id uuid;
  v_win uuid;
  v_local timestamp;
  v_new uuid;
begin
  if (p_instance is null) = (p_contract is null) then
    raise exception 'informe a aula a remarcar (p_instance) OU o contrato do resgate (p_contract)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  select coalesce(t.iana_tz, public.business_tz()) into v_tz from teachers t where t.id = p_teacher;
  if v_tz is null then
    raise exception 'professora % não existe', p_teacher;
  end if;

  -- duração REAL (F1/M1-5): remarcação herda da aula; resgate usa o crédito da vez
  if p_instance is not null then
    select round(extract(epoch from (ci.ends_at_utc - ci.starts_at_utc)) / 60)::int, ci.contract_id
      into v_dur, v_contract_id
    from class_instances ci where ci.id = p_instance;
    if v_dur is null then
      raise exception 'instância % não existe', p_instance;
    end if;
  else
    v_contract_id := p_contract;
    perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || p_contract::text, 0));
    select rc.duration_min into v_dur
    from public._makeup_remaining_credits(p_contract) rc
    where rc.expires_on >= public.business_today()
    order by rc.expires_on, rc.ord limit 1;
    select rs.duration_min into v_slot_dur
      from recurring_slots rs
     where rs.contract_id = p_contract
       and rs.active_from <= current_date
       and (rs.active_to is null or rs.active_to >= current_date)
     order by rs.active_from desc limit 1;
    v_dur := coalesce(v_dur, v_slot_dur, 45);
  end if;

  -- a camada do banco decide a disponibilidade (Google é antecipação do app)
  if not public._teacher_available_for(p_teacher, p_starts_at_utc,
        p_starts_at_utc + make_interval(mins => v_dur)) then
    raise exception 'a professora não está disponível nesse horário — escolha outro';
  end if;

  -- reaproveita janela publicada no MESMO instante (união sem duplicata);
  -- senão materializa uma janela nova, e consome na mesma transação
  select w.id into v_win from reschedule_windows w
  where w.teacher_id = p_teacher and w.starts_at_utc = p_starts_at_utc and w.state = 'publicada'
  for update;
  if v_win is null then
    v_local := p_starts_at_utc at time zone v_tz;
    insert into reschedule_windows
      (teacher_id, local_date, local_time, iana_tz, starts_at_utc, local_time_snapshot, created_by)
    values
      (p_teacher, v_local::date, v_local::time, v_tz, p_starts_at_utc,
       to_char(v_local, 'YYYY-MM-DD HH24:MI') || ' ' || v_tz, v_actor)
    returning id into v_win;
  end if;

  v_new := public.book_reschedule_window(
    v_win, p_instance, p_contract, v_actor, p_courtesy, p_courtesy_note, p_bypass_lead);

  perform public.log_audit(v_actor, 'book_computed_slot', 'reschedule_windows', v_win::text,
    jsonb_build_object(
      'teacher_id', p_teacher, 'starts_at_utc', p_starts_at_utc,
      'duration_min', v_dur, 'contract', v_contract_id,
      'new_instance', v_new,
      -- marcador da reserva degradada (fail-open do Google — decisão M1-4)
      'google_degraded', p_google_degraded));
  return v_new;
end;
$$;
revoke execute on function
  public.book_computed_slot(uuid, timestamptz, uuid, uuid, uuid, boolean, text, boolean, boolean)
from public, anon;
grant execute on function
  public.book_computed_slot(uuid, timestamptz, uuid, uuid, uuid, boolean, text, boolean, boolean)
to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Tratamento de período (M1-4 + P4/P5): intervalo civil NA ZONA DA
--    PROFESSORA → aulas afetadas → um dos três destinos, sempre com bloqueio.
--    cancel_credit: matriz D2 com culpa da ESCOLA (validade-180 automática,
--      estorno-aware, AVISA por aula — P4);
--    invite_reschedule (P5): NADA muda nas aulas — só comunicação em lote com
--      link do fluxo de remarcar (franquia/crédito intocados);
--    block_only: só fecha a oferta.
-- ---------------------------------------------------------------------------
create or replace function public.admin_period_treatment(
  p_teacher uuid,
  p_from date,
  p_to date,
  p_mode text,
  p_note text default null,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_tz text;
  v_block uuid;
  v_row record;
  v_cancelled uuid[] := array[]::uuid[];
  v_invited uuid[] := array[]::uuid[];
  v_rows int;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_period_treatment é restrita à admin (D10)';
  end if;
  if p_mode not in ('cancel_credit', 'invite_reschedule', 'block_only') then
    raise exception 'modo % inválido (cancel_credit | invite_reschedule | block_only)', p_mode;
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  select coalesce(t.iana_tz, public.business_tz()) into v_tz from teachers t where t.id = p_teacher;
  if v_tz is null then
    raise exception 'professora % não existe', p_teacher;
  end if;

  -- fecha a oferta SEMPRE (o período é indisponível de qualquer modo)
  v_block := public.add_teacher_block(p_teacher, p_from, p_to,
    coalesce(p_note, 'tratamento de período'), v_actor);

  for v_row in
    select ci.id, ci.starts_at_utc, ci.local_time_snapshot, c.id as contract_id
    from class_instances ci
    join contracts c on c.id = ci.contract_id
    where ci.teacher_id = p_teacher
      and ci.state = 'scheduled'
      and ci.starts_at_utc > now()
      and (ci.starts_at_utc at time zone v_tz)::date between p_from and p_to
    order by ci.starts_at_utc
  loop
    if p_mode = 'cancel_credit' then
      -- culpa da escola: crédito com validade-180 (M3-1), estorno-aware, AVISA (P4)
      perform public._cancel_class_core(v_row.id, 'teacher', now(), v_actor, 'period');
      v_cancelled := v_cancelled || v_row.id;
    elsif p_mode = 'invite_reschedule' then
      -- P5: comunicação em lote com deep link — a aula PERMANECE; nada de
      -- franquia/crédito tocado; quem age é o aluno pelo fluxo normal.
      insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
      select 'period-reschedule-invite', s.profile_id,
             jsonb_build_object(
               'instance_id', v_row.id, 'student_id', s.id,
               'starts_at_utc', v_row.starts_at_utc,
               'local_time_snapshot', v_row.local_time_snapshot,
               'iana_tz', s.iana_tz,
               'teacher_name', (select t.display_name from teachers t where t.id = p_teacher),
               'note', p_note),
             format('period-invite:%s:%s', v_row.id, s.id)
      from (
        select st.id, st.profile_id, st.iana_tz
        from contracts c2
        left join students st on st.id = c2.student_id
        where c2.id = v_row.contract_id and c2.student_id is not null
        union
        select st.id, st.profile_id, st.iana_tz
        from contracts c2
        join student_group_members m on m.group_id = c2.student_group_id
        join students st on st.id = m.student_id
        where c2.id = v_row.contract_id
      ) s
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        v_invited := v_invited || v_row.id;
      end if;
    end if;
  end loop;

  perform public.log_audit(v_actor, 'period_treatment', 'teachers', p_teacher::text,
    jsonb_build_object('from', p_from, 'to', p_to, 'mode', p_mode, 'note', p_note,
                       'block_exception', v_block,
                       'cancelled_instances', to_jsonb(v_cancelled),
                       'invited_instances', to_jsonb(v_invited)));

  return jsonb_build_object('block', v_block,
                            'cancelled', coalesce(array_length(v_cancelled, 1), 0),
                            'invited', coalesce(array_length(v_invited, 1), 0));
end;
$$;
revoke execute on function public.admin_period_treatment(uuid, date, date, text, text, uuid)
from public, anon;
grant execute on function public.admin_period_treatment(uuid, date, date, text, text, uuid)
to authenticated;
