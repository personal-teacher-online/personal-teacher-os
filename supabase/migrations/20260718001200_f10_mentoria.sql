-- F10 — Mentoria completa & Hotmart ligável (plano integrado v2, 18/07/2026;
-- decisões M6-1..M6-5, M7-8 + P8/P16 do passe adversarial).
--   • Régua: TABELA DE DEFAULTS (vazia até a dona definir os números — régua
--     vazia segue BLOQUEANDO, decisão D2) + semeadura em contratos NOVOS +
--     "aplicar aos existentes" (nunca sobrescreve regra custom).
--   • Trava de sessão futura no book (M6-2, ponto único).
--   • Autocancelamento do mentorado (M6-4): posse + corte de 24h + estorno
--     formal + aviso + auditoria.
--   • Edição de encontro (M6-5): link livre; vagas com piso nas reservas; hora
--     só sem reservas ativas.
--   • Cancelamento de encontro AVISA todos os afetados (M6-3/P16).
--   • Vínculo Hotmart com estado VISÍVEL (M7-8): matched_at + divergence.

-- ---------------------------------------------------------------------------
-- 1. Defaults da régua (M6-1)
-- ---------------------------------------------------------------------------
create table mentorship_default_thresholds (
  window_index int primary key check (window_index between 1 and 12),
  threshold_pct numeric not null check (threshold_pct >= 0 and threshold_pct <= 100),
  updated_at timestamptz not null default now()
);
comment on table mentorship_default_thresholds is
  'M6-1: régua PADRÃO de progresso por etapa. VAZIA até a dona definir '
  '(entregável externo do gate MENTORIA). Semeia contratos novos e o "aplicar '
  'aos existentes" — nunca sobrescreve regra custom de um contrato.';
alter table mentorship_default_thresholds enable row level security;
create policy mdt_admin_read on mentorship_default_thresholds
  for select to authenticated using ((select public.app_role()) = 'admin');
grant select on mentorship_default_thresholds to anon, authenticated;

create or replace function public.admin_set_default_threshold(
  p_window int,
  p_pct numeric,
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_set_default_threshold é restrita à admin (D10)';
  end if;
  insert into mentorship_default_thresholds (window_index, threshold_pct, updated_at)
  values (p_window, p_pct, now())
  on conflict (window_index) do update
    set threshold_pct = excluded.threshold_pct, updated_at = now();
  perform public.log_audit(coalesce(auth.uid(), p_actor), 'set_default_threshold',
    'mentorship_default_thresholds', p_window::text,
    jsonb_build_object('window_index', p_window, 'threshold_pct', p_pct));
end;
$$;
revoke execute on function public.admin_set_default_threshold(int, numeric, uuid) from public, anon;
grant execute on function public.admin_set_default_threshold(int, numeric, uuid) to authenticated;

-- semeadura: contrato de mentoria NOVO herda a régua padrão (regras próprias
-- podem ser editadas depois; INSERT direto sem migration continua valendo)
create or replace function public._seed_default_thresholds()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into mentorship_window_rules (contract_id, window_index, threshold_pct)
  select new.contract_id, d.window_index, d.threshold_pct
  from mentorship_default_thresholds d
  on conflict do nothing;
  return new;
end;
$$;
create trigger mentorship_contracts_seed_thresholds
  after insert on mentorship_contracts
  for each row execute function public._seed_default_thresholds();

create or replace function public.admin_apply_default_thresholds(
  p_contract uuid default null,
  p_actor uuid default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_apply_default_thresholds é restrita à admin (D10)';
  end if;
  insert into mentorship_window_rules (contract_id, window_index, threshold_pct)
  select mc.contract_id, d.window_index, d.threshold_pct
  from mentorship_contracts mc
  cross join mentorship_default_thresholds d
  where p_contract is null or mc.contract_id = p_contract
  on conflict do nothing;  -- regra custom NUNCA é sobrescrita
  get diagnostics v_count = row_count;
  perform public.log_audit(coalesce(auth.uid(), p_actor), 'apply_default_thresholds',
    'mentorship_window_rules', coalesce(p_contract::text, 'todos'),
    jsonb_build_object('rows_seeded', v_count));
  return v_count;
end;
$$;
revoke execute on function public.admin_apply_default_thresholds(uuid, uuid) from public, anon;
grant execute on function public.admin_apply_default_thresholds(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Vínculo Hotmart visível (M7-8) + grant cirúrgico p/ o polling
-- ---------------------------------------------------------------------------
alter table mentorship_contracts add column hotmart_matched_at timestamptz;
alter table mentorship_contracts add column hotmart_divergence text;
comment on column mentorship_contracts.hotmart_divergence is
  'M7-8: NULL = ok; texto = por que o polling não casou (e-mail divergente etc). '
  'O badge "sem vínculo" vem de external_user_ref NULL.';
grant update (hotmart_matched_at, hotmart_divergence) on mentorship_contracts to service_role;

-- ---------------------------------------------------------------------------
-- 3. Edição de encontro (M6-5)
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_mentorship_session(
  p_session uuid,
  p_gmeet_url text default null,
  p_capacity int default null,
  p_local_date date default null,
  p_local_time time default null,
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sess mentorship_sessions%rowtype;
  v_actor uuid;
  v_active int;
  v_starts timestamptz;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_update_mentorship_session é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  select * into v_sess from mentorship_sessions where id = p_session for update;
  if not found then
    raise exception 'sessão % não existe', p_session;
  end if;
  if v_sess.status in ('cancelled', 'done') then
    raise exception 'sessão % não é mais editável (%)', p_session, v_sess.status;
  end if;
  select count(*) into v_active
  from mentorship_bookings b where b.session_id = p_session and b.cancelled_at is null;

  -- link LIVRE, sempre
  if p_gmeet_url is not null then
    update mentorship_sessions set gmeet_url = nullif(btrim(p_gmeet_url), '') where id = p_session;
  end if;

  -- vagas: nunca abaixo das reservas ativas (piso; o CHECK cap_ok é o cinto)
  if p_capacity is not null then
    if p_capacity < v_active then
      raise exception 'capacidade % abaixo das % reservas ativas — estorne antes', p_capacity, v_active;
    end if;
    update mentorship_sessions
       set capacity = p_capacity,
           status = (case when v_active >= p_capacity then 'full' else 'open' end)::mentorship_session_status
     where id = p_session;
  end if;

  -- hora: SÓ sem reservas ativas (Lei 1: instante DAQUELE dia, Cuiabá)
  if p_local_date is not null or p_local_time is not null then
    if v_active > 0 then
      raise exception 'sessão com % reserva(s) ativa(s) não muda de horário — cancele/estorne antes', v_active;
    end if;
    if p_local_date is null or p_local_time is null then
      raise exception 'informe data E hora novas';
    end if;
    v_starts := (p_local_date + p_local_time) at time zone public.business_tz();
    if v_starts <= now() then
      raise exception 'novo horário (%) já passou', v_starts;
    end if;
    update mentorship_sessions
       set scheduled_at = v_starts,
           local_time_snapshot = to_char(p_local_date, 'YYYY-MM-DD') || ' ' ||
                                 to_char(p_local_time, 'HH24:MI') || ' ' || public.business_tz()
     where id = p_session;
  end if;

  perform public.log_audit(v_actor, 'update_mentorship_session', 'mentorship_sessions',
    p_session::text,
    jsonb_build_object('gmeet_url', p_gmeet_url, 'capacity', p_capacity,
                       'local_date', p_local_date, 'local_time', p_local_time));
end;
$$;
revoke execute on function
  public.admin_update_mentorship_session(uuid, text, int, date, time, uuid)
from public, anon;
grant execute on function
  public.admin_update_mentorship_session(uuid, text, int, date, time, uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Autocancelamento do mentorado (M6-4): posse + 24h + estorno formal + aviso
-- ---------------------------------------------------------------------------
create or replace function public.cancel_my_mentorship_booking(p_booking uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b mentorship_bookings%rowtype;
  v_sess mentorship_sessions%rowtype;
begin
  select * into v_b from mentorship_bookings where id = p_booking;
  if not found then
    raise exception 'reserva % não existe', p_booking;
  end if;
  if v_b.contract_id not in (select public.my_contract_ids()) then
    raise exception 'você não tem acesso a esta reserva (D10)';
  end if;
  if v_b.cancelled_at is not null then
    raise exception 'reserva já cancelada';
  end if;

  -- ORDEM GLOBAL: sessão FOR UPDATE → advisory do contrato (padrão do motor)
  select * into v_sess from mentorship_sessions where id = v_b.session_id for update;
  perform pg_advisory_xact_lock(hashtextextended('mentorship_book:' || v_b.contract_id::text, 0));
  if v_sess.status = 'cancelled' then
    raise exception 'o encontro foi cancelado — seu crédito já voltou';
  end if;
  -- M6-4: corte de 24h — depois disso, canal humano
  if v_sess.scheduled_at <= now() + interval '24 hours' then
    raise exception 'faltam menos de 24h para o encontro — fale com o atendimento';
  end if;

  perform public._refund_mentorship_booking_locked(p_booking, auth.uid());

  -- confirmação ao próprio mentorado (e-mail + WhatsApp por número)
  insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
  select ch.channel, 'meeting-cancelled', s.profile_id,
         jsonb_build_object(
           'session_id', v_sess.id, 'student_id', s.id,
           'scheduled_at', v_sess.scheduled_at,
           'local_time_snapshot', v_sess.local_time_snapshot,
           'iana_tz', s.iana_tz, 'self', true),
         format('meeting-cancelled:self:%s:%s', v_sess.id, s.id)
           || case when ch.channel = 'whatsapp' then ':wa' else '' end
  from students s
  cross join lateral (
    select 'email'::text as channel
    union all
    select 'whatsapp' where exists (
      select 1 from profiles p where p.id = s.profile_id and p.whatsapp_e164 is not null)
  ) ch
  where s.id = v_b.student_id
  on conflict (dedupe_key) do nothing;

  perform public.log_audit(auth.uid(), 'cancel_my_mentorship_booking', 'mentorship_bookings',
    p_booking::text,
    jsonb_build_object('session_id', v_b.session_id, 'contract_id', v_b.contract_id, 'via', 'self'));
end;
$$;
revoke execute on function public.cancel_my_mentorship_booking(uuid) from public, anon;
grant execute on function public.cancel_my_mentorship_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Lembrete de encontro 24h (M6-3 — molde do toque 1; silêncio herdado do
--    despachante da F6) + cron horário
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_meeting_reminders()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_inserted int := 0;
  v_rows int;
  v_has_wa boolean;
begin
  for v_row in
    select ms.id as session_id, ms.scheduled_at, ms.local_time_snapshot, ms.gmeet_url,
           s.id as student_id, s.profile_id, s.iana_tz
    from mentorship_sessions ms
    join mentorship_bookings b on b.session_id = ms.id and b.cancelled_at is null
    join students s on s.id = b.student_id
    where ms.status in ('open', 'full')
      and ms.scheduled_at > now()
      and ms.scheduled_at <= now() + interval '24 hours'
  loop
    insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
    values ('meeting-reminder', v_row.profile_id,
      jsonb_build_object('session_id', v_row.session_id, 'student_id', v_row.student_id,
        'starts_at_utc', v_row.scheduled_at, 'local_time_snapshot', v_row.local_time_snapshot,
        'iana_tz', v_row.iana_tz, 'meet_url', v_row.gmeet_url),
      format('meeting-reminder:%s:%s', v_row.session_id, v_row.student_id))
    on conflict (dedupe_key) do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;

    v_has_wa := false;
    if v_row.profile_id is not null then
      select p.whatsapp_e164 is not null into v_has_wa from profiles p where p.id = v_row.profile_id;
    end if;
    if coalesce(v_has_wa, false) then
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values ('whatsapp', 'meeting-reminder', v_row.profile_id,
        jsonb_build_object('session_id', v_row.session_id, 'student_id', v_row.student_id,
          'starts_at_utc', v_row.scheduled_at, 'local_time_snapshot', v_row.local_time_snapshot,
          'iana_tz', v_row.iana_tz, 'meet_url', v_row.gmeet_url),
        format('meeting-reminder:%s:%s:wa', v_row.session_id, v_row.student_id))
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end if;
  end loop;
  return v_inserted;
end;
$$;
revoke execute on function public.enqueue_meeting_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_meeting_reminders() to service_role;

select cron.schedule(
  'enqueue-meeting-reminders-hourly',
  '7 * * * *',
  $$select public.enqueue_meeting_reminders()$$
);

-- ---------------------------------------------------------------------------
-- 6. Recriações (defs vivas transformadas): trava futura no book; cancel de
--    sessão avisa todos; overview com o estado do vínculo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.book_mentorship_session(p_session uuid, p_contract uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_sess mentorship_sessions%rowtype;
  v_student uuid;
  v_window int;
  v_net int;
  v_ledger bigint;
  v_booking uuid;
begin
  -- ORDEM GLOBAL DE LOCKS: sessão (FOR UPDATE) PRIMEIRO...
  select * into v_sess from mentorship_sessions where id = p_session for update;
  if not found then
    raise exception 'sessão % não existe', p_session;
  end if;

  -- ...DEPOIS o advisory do contrato: serializa reservas/estornos do MESMO
  -- contrato (mesmo em sessões diferentes). Única defesa da unicidade líquida.
  perform pg_advisory_xact_lock(hashtextextended('mentorship_book:' || p_contract::text, 0));

  if v_sess.status <> 'open' then
    raise exception 'sessão % não está aberta para reserva (status: %)', p_session, v_sess.status;
  end if;
  -- F10/M6-2: sessão que já começou não aceita reserva (ponto único)
  if v_sess.scheduled_at <= now() then
    raise exception 'sessão % já começou/aconteceu — reserva impossível', p_session;
  end if;
  if v_sess.booked_count >= v_sess.capacity then
    raise exception 'sessão % lotada (capacidade %)', p_session, v_sess.capacity;
  end if;

  -- Revalida elegibilidade DENTRO da transação, depois dos locks.
  if not public.mentorship_can_book(p_contract) then
    raise exception 'contrato % não elegível para reserva de mentoria', p_contract;
  end if;

  select c.student_id into v_student
  from contracts c
  where c.id = p_contract;

  v_window := public.mentorship_next_window(p_contract);

  -- Assert redundante DENTRO do lock (compensação 2 do drop do índice): a etapa
  -- escolhida DEVE ter gasto líquido 0 — regressão da definição de N estoura
  -- aqui, não cunha gasto duplo.
  select coalesce(sum(case when reason = 'booking_spend' then 1 else -1 end), 0)
    into v_net
  from mentorship_credit_ledger
  where contract_id = p_contract
    and window_index = v_window
    and reason in ('booking_spend', 'refund');
  if v_net <> 0 then
    raise exception 'invariante violada: etapa % do contrato % tem gasto líquido % (esperado 0)',
      v_window, p_contract, v_net;
  end if;

  insert into mentorship_credit_ledger
    (contract_id, student_id, delta, reason, window_index, session_id, created_by)
  values
    (p_contract, v_student, -1, 'booking_spend', v_window, p_session, p_actor)
  returning id into v_ledger;

  update mentorship_sessions
     set booked_count = booked_count + 1,
         status = case when booked_count + 1 >= capacity then 'full' else status end
   where id = p_session;

  insert into mentorship_bookings (session_id, student_id, contract_id, ledger_id)
  values (p_session, v_student, p_contract, v_ledger)
  returning id into v_booking;

  perform public.log_audit(p_actor, 'book_mentorship_session', 'mentorship_bookings', v_booking::text,
    jsonb_build_object(
      'session_id', p_session,
      'contract_id', p_contract,
      'student_id', v_student,
      'window_index', v_window,
      'ledger_id', v_ledger));

  return v_booking;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_mentorship_session(p_session uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_sess mentorship_sessions%rowtype;
  v_actor uuid;
  v_contract uuid;
  v_booking uuid;
  v_count int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'cancel_mentorship_session é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- ORDEM GLOBAL: sessão FOR UPDATE primeiro — CONGELA o conjunto de reservas
  -- ativas (nenhum book/refund commita sem o lock desta linha)...
  select * into v_sess from mentorship_sessions where id = p_session for update;
  if not found then
    raise exception 'sessão % não existe', p_session;
  end if;
  if v_sess.status = 'cancelled' then
    raise exception 'sessão % já cancelada', p_session;
  end if;
  -- Decisão do executor (registrada para o gate): sessão done não aceita
  -- cancelamento em massa — ela ACONTECEU; reescrever o status apagaria esse
  -- fato. O caminho pós-fato é o estorno avulso por reserva (C4).
  if v_sess.status = 'done' then
    raise exception 'sessão % já aconteceu (done) — use refund_mentorship_booking por reserva (C4)', p_session;
  end if;

  -- ...DEPOIS os advisory locks dos contratos das reservas ativas, em ordem
  -- determinística (ORDER BY contract_id — contra cancel×cancel).
  for v_contract in
    select distinct contract_id
    from mentorship_bookings
    where session_id = p_session and cancelled_at is null
    order by contract_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('mentorship_book:' || v_contract::text, 0));
  end loop;

  for v_booking in
    select id
    from mentorship_bookings
    where session_id = p_session and cancelled_at is null
    order by created_at, id
  loop
    perform public._refund_mentorship_booking_locked(v_booking, v_actor);
    v_count := v_count + 1;
  end loop;

  -- F10/M6-3 (P16): TODOS os afetados são avisados (e-mail + WhatsApp por número)
  insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
  select ch.channel, 'meeting-cancelled', s.profile_id,
         jsonb_build_object(
           'session_id', v_sess.id, 'student_id', s.id,
           'scheduled_at', v_sess.scheduled_at,
           'local_time_snapshot', v_sess.local_time_snapshot,
           'iana_tz', s.iana_tz),
         format('meeting-cancelled:%s:%s', v_sess.id, s.id)
           || case when ch.channel = 'whatsapp' then ':wa' else '' end
  from mentorship_bookings b
  join students s on s.id = b.student_id
  cross join lateral (
    select 'email'::text as channel
    union all
    select 'whatsapp' where exists (
      select 1 from profiles p where p.id = s.profile_id and p.whatsapp_e164 is not null)
  ) ch
  where b.session_id = p_session
  on conflict (dedupe_key) do nothing;

  -- Status POR ÚLTIMO, na mesma transação (C2).
  update mentorship_sessions set status = 'cancelled' where id = p_session;

  perform public.log_audit(v_actor, 'cancel_mentorship_session', 'mentorship_sessions', p_session::text,
    jsonb_build_object('previous_status', v_sess.status, 'refunded_bookings', v_count));

  return v_count;
end;
$function$
;

drop function public.admin_mentorship_overview();
CREATE OR REPLACE FUNCTION public.admin_mentorship_overview()
 RETURNS TABLE(contract_id uuid, student_id uuid, student_name text, contract_status text, course_start_date date, term_months integer, total_credits integer, window_months integer, completion_pct numeric, last_synced_at timestamp with time zone, external_user_ref text,
 hotmart_matched_at timestamp with time zone,
 hotmart_divergence text, unlocked integer, ledger_net integer, available integer, next_window integer, validity_end date, can_book boolean, threshold_missing boolean, thresholds jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  v_can boolean;
  v_missing boolean;
begin
  if public.app_role() <> 'admin' then
    raise exception 'D10: visão de mentoria é só da administração';
  end if;

  for r in
    select mc.contract_id, c.student_id, s.display_name, c.status,
           mc.course_start_date, mc.term_months, mc.total_credits, mc.window_months,
           mc.external_user_ref, mc.hotmart_matched_at, mc.hotmart_divergence,
           cp.completion_pct, cp.last_synced_at
    from mentorship_contracts mc
    join contracts c on c.id = mc.contract_id
    join students s on s.id = c.student_id
    left join course_progress cp on cp.contract_id = mc.contract_id
    where c.status <> 'ended'
    order by s.display_name
  loop
    v_can := null;
    v_missing := false;
    begin
      v_can := public.mentorship_can_book(r.contract_id);
    exception when others then
      v_missing := true;
    end;

    contract_id := r.contract_id;
    student_id := r.student_id;
    student_name := r.display_name;
    contract_status := r.status;
    course_start_date := r.course_start_date;
    term_months := r.term_months;
    total_credits := r.total_credits;
    window_months := r.window_months;
    completion_pct := r.completion_pct;
    last_synced_at := r.last_synced_at;
    external_user_ref := r.external_user_ref;
    hotmart_matched_at := r.hotmart_matched_at;
    hotmart_divergence := r.hotmart_divergence;
    unlocked := public.mentorship_windows_unlocked(r.contract_id);
    ledger_net := coalesce(
      (select sum(l.delta)::int from mentorship_credit_ledger l where l.contract_id = r.contract_id), 0);
    available := unlocked + ledger_net;
    next_window := case when v_missing then null else public.mentorship_next_window(r.contract_id) end;
    validity_end := public.mentorship_validity_end(r.contract_id);
    can_book := v_can;
    threshold_missing := v_missing;
    thresholds := coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object('window_index', w.window_index, 'threshold_pct', w.threshold_pct)
                 order by w.window_index
               )
        from mentorship_window_rules w
        where w.contract_id = r.contract_id
      ),
      '[]'::jsonb
    );
    return next;
  end loop;
end;
$function$
;


revoke execute on function public.admin_mentorship_overview() from public;
grant execute on function public.admin_mentorship_overview() to authenticated;
