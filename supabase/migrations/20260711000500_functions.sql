-- M2 — Funções e triggers de negócio.
-- Lei 3: TODA regra vive aqui (Postgres); o app Next.js apenas antecipa erros para UX.
-- Mutações críticas só via estas funções RPC (SECURITY DEFINER, owner = dono das tabelas,
-- que ignora RLS; a autorização de quem PODE chamar cada função é objeto do M5/Fase 2 —
-- por ora, EXECUTE é revogado de anon/authenticated).

-- ---------------------------------------------------------------------------
-- Base
-- ---------------------------------------------------------------------------

-- Fuso de referência do negócio (ADR-008 item 12): fim-de-dia de expires_on e
-- aritmética de datas civis de crédito/vigência.
create or replace function public.business_tz()
returns text
language sql
immutable
as $$ select 'America/Cuiaba' $$;

create or replace function public.business_today()
returns date
language sql
stable
as $$ select (now() at time zone public.business_tz())::date $$;

create or replace function public.log_audit(
  p_actor uuid, p_action text, p_entity text, p_entity_id text, p_diff jsonb
) returns void
language sql
as $$
  insert into audit_log (actor, action, entity, entity_id, diff)
  values (p_actor, p_action, p_entity, p_entity_id, p_diff);
$$;

-- Auditoria universal (Lei 8): trigger genérico de linha nas tabelas críticas.
-- Registra também escritas feitas por fora das funções RPC (seed, admin direto, bug).
create or replace function public.audit_row_change()
returns trigger
language plpgsql
as $$
declare
  v_diff jsonb;
  v_entity_id text;
begin
  if tg_op = 'INSERT' then
    v_diff := jsonb_build_object('new', to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    v_diff := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
  else
    v_diff := jsonb_build_object('old', to_jsonb(old));
  end if;
  v_entity_id := coalesce(to_jsonb(coalesce(new, old)) ->> 'id',
                          to_jsonb(coalesce(new, old)) ->> 'contract_id');
  insert into audit_log (actor, action, entity, entity_id, diff)
  values (auth.uid(), lower(tg_op), tg_table_name, v_entity_id, v_diff);
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'students', 'teachers', 'contracts', 'recurring_slots', 'class_instances',
    'makeup_ledger', 'reschedule_usage', 'teacher_statements',
    'mentorship_contracts', 'mentorship_window_rules', 'course_progress',
    'mentorship_credit_ledger', 'mentorship_sessions', 'mentorship_bookings'
  ] loop
    execute format(
      'create trigger %I_audit after insert or update or delete on %I
         for each row execute function public.audit_row_change()', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Particulares: saldo de reposição (derivado — Lei 2)
-- ---------------------------------------------------------------------------

-- Semântica FIFO CRONOLÓGICA (ADR-009/ADR-011): reproduz a linha do tempo do ledger.
-- Cada gasto consome, FIFO por expiração, um crédito ainda VÁLIDO na data (negócio)
-- do gasto. Duas armadilhas que isso fecha: (a) "ganha 1 (expira dia X), gasta 1,
-- passa o dia X" não deixa o saldo em −1; (b) crédito que expira SEM uso morre de
-- vez — não "ressuscita" para absorver um gasto posterior.
create or replace function public.makeup_balance(p_contract uuid)
returns int
language plpgsql
stable
as $$
declare
  r record;
  v_expiries date[] := array[]::date[];
  v_spend_date date;
  v_pick int;
  v_count int;
  i int;
begin
  for r in
    select delta, expires_on, created_at
    from makeup_ledger
    where contract_id = p_contract
    order by created_at, id
  loop
    if r.delta > 0 then
      for i in 1 .. r.delta loop
        v_expiries := v_expiries || coalesce(r.expires_on, 'infinity'::date);
      end loop;
    else
      v_spend_date := (r.created_at at time zone public.business_tz())::date;
      for i in 1 .. -r.delta loop
        v_pick := null;
        select idx into v_pick
        from unnest(v_expiries) with ordinality as t (exp, idx)
        where t.exp >= v_spend_date
        order by t.exp, t.idx
        limit 1;
        if v_pick is not null then
          v_expiries := v_expiries[1:v_pick - 1] || v_expiries[v_pick + 1:];
        end if;
        -- Sem crédito válido na época (anomalia via manual_adjust): saldo não
        -- fica negativo — o gasto excedente cai no vazio.
      end loop;
    end if;
  end loop;
  select count(*) into v_count from unnest(v_expiries) e where e >= public.business_today();
  return v_count;
end;
$$;

create or replace function public.earn_makeup(
  p_contract uuid,
  p_reason ledger_reason,
  p_expires_on date,
  p_student uuid default null,
  p_class_instance uuid default null,
  p_actor uuid default null
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id bigint;
begin
  if p_reason not in ('earn_cancellation', 'initial_backlog', 'manual_adjust') then
    raise exception 'earn_makeup não aceita reason %', p_reason;
  end if;
  insert into makeup_ledger (contract_id, student_id, delta, reason, class_instance_id, expires_on, created_by)
  values (p_contract, p_student, 1, p_reason, p_class_instance, p_expires_on, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.spend_makeup(
  p_contract uuid,
  p_reason ledger_reason default 'spend_reschedule',
  p_student uuid default null,
  p_class_instance uuid default null,
  p_actor uuid default null
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id bigint;
begin
  if p_reason not in ('spend_reschedule', 'manual_adjust') then
    raise exception 'spend_makeup não aceita reason %', p_reason;
  end if;
  -- Contrato pausado/encerrado não movimenta crédito (ADR-011).
  if not exists (select 1 from contracts c where c.id = p_contract and c.status = 'active') then
    raise exception 'contrato % não está ativo — gasto de crédito bloqueado', p_contract;
  end if;
  -- Serializa gastos concorrentes do MESMO contrato (caso de teste 5): a verificação
  -- de saldo acontece DENTRO da transação, depois do lock (Lei 2).
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || p_contract::text, 0));
  if public.makeup_balance(p_contract) < 1 then
    raise exception 'saldo de créditos de reposição insuficiente no contrato %', p_contract;
  end if;
  insert into makeup_ledger (contract_id, student_id, delta, reason, class_instance_id, expires_on, created_by)
  values (p_contract, p_student, -1, p_reason, p_class_instance, null, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Particulares: remarcação (orquestra TUDO no banco — Lei 3)
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_class(
  p_instance uuid,
  p_new_local_date date,
  p_new_local_time time,
  p_actor uuid default null
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
  v_new_starts timestamptz;
  v_orig_local_date date;
  v_period text;
  v_used int;
  v_via text;
  v_new_id uuid;
begin
  select * into v_old from class_instances where id = p_instance for update;
  if not found then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_old.state <> 'scheduled' then
    raise exception 'instância % não está agendada (estado atual: %)', p_instance, v_old.state;
  end if;

  -- Lock do contrato: serializa alçada + saldo por contrato.
  select * into v_contract from contracts where id = v_old.contract_id for update;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'reschedule_class só se aplica a contratos private_1on1';
  end if;
  if v_contract.status <> 'active' then
    raise exception 'contrato % não está ativo — remarcação bloqueada', v_contract.id;
  end if;

  -- Aviso mínimo (caso de teste 7).
  if now() > v_old.starts_at_utc - make_interval(hours => v_contract.min_notice_hours) then
    raise exception 'remarcação exige % h de aviso mínimo (aula começa em %)',
      v_contract.min_notice_hours, v_old.starts_at_utc;
  end if;

  -- Zona da nova aula: a do slot de origem (seguindo a cadeia de remarcações);
  -- fallback: zona do aluno do contrato.
  with recursive chain as (
    select ci.* from class_instances ci where ci.id = p_instance
    union all
    select ci.* from class_instances ci join chain on chain.reschedule_of = ci.id
  )
  select rs.iana_tz into v_tz
  from chain join recurring_slots rs on rs.id = chain.slot_id
  limit 1;
  if v_tz is null then
    select s.iana_tz into v_tz from students s where s.id = v_contract.student_id;
  end if;
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA da remarcação do contrato %', v_contract.id;
  end if;

  -- Lei 1: o offset é o DAQUELE dia — o Postgres resolve DST via tzdata.
  v_duration := v_old.ends_at_utc - v_old.starts_at_utc;
  v_new_starts := (p_new_local_date + p_new_local_time) at time zone v_tz;
  if v_new_starts <= now() then
    raise exception 'nova data/hora da remarcação já passou (% em %)', v_new_starts, v_tz;
  end if;

  -- Alçada mensal (ADR-003 lazy; ADR-008: period = mês da data LOCAL da aula original).
  v_orig_local_date := coalesce(v_old.occurrence_date, (v_old.starts_at_utc at time zone v_tz)::date);
  v_period := to_char(v_orig_local_date, 'YYYY-MM');
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
    -- Alçada esgotada → consome crédito de reposição (exceção se saldo zero — caso 8).
    perform public.spend_makeup(v_contract.id, 'spend_reschedule', v_contract.student_id, p_instance, p_actor);
    v_via := 'makeup_credit';
  end if;

  update class_instances set state = 'rescheduled' where id = p_instance;

  -- Nova instância é avulsa (slot_id NULL — ADR-008): conflito de agenda do professor
  -- estoura aqui pela constraint de exclusão e reverte a transação inteira.
  insert into class_instances
    (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
     local_time_snapshot, state, reschedule_of)
  values
    (v_contract.id, v_old.teacher_id, null, null, v_new_starts, v_new_starts + v_duration,
     to_char(p_new_local_date, 'YYYY-MM-DD') || ' ' || to_char(p_new_local_time, 'HH24:MI') || ' ' || v_tz,
     'scheduled', p_instance)
  returning id into v_new_id;

  perform public.log_audit(p_actor, 'reschedule_class', 'class_instances', v_new_id::text,
    jsonb_build_object(
      'rescheduled_from', p_instance,
      'old_starts_at_utc', v_old.starts_at_utc,
      'new_starts_at_utc', v_new_starts,
      'iana_tz', v_tz,
      'via', v_via,
      'period_ym', v_period));

  return v_new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mentoria: destravamento computado (Lei 2 / D3) e escada (D2)
-- ---------------------------------------------------------------------------

-- ÚNICA fonte da fórmula de destravamento (critério de aceite):
-- min(total_credits, floor(meses desde course_start_date / window_months) + 1).
create or replace function public.mentorship_windows_unlocked(p_contract uuid)
returns int
language sql
stable
as $$
  select case
    when mc.course_start_date is null then 0
    when public.business_today() < mc.course_start_date then 0
    else least(
      mc.total_credits,
      (extract(year from age(public.business_today(), mc.course_start_date))::int * 12
       + extract(month from age(public.business_today(), mc.course_start_date))::int)
      / mc.window_months + 1)
  end
  from mentorship_contracts mc
  where mc.contract_id = p_contract;
$$;

-- Próxima etapa a consumir = gastos registrados + 1 (gasto em ordem — D2).
create or replace function public.mentorship_next_window(p_contract uuid)
returns int
language sql
stable
as $$
  select (count(*) + 1)::int
  from mentorship_credit_ledger
  where contract_id = p_contract and reason = 'booking_spend';
$$;

-- Fim da vigência: fim do curso + carência (doc 04 §5).
create or replace function public.mentorship_validity_end(p_contract uuid)
returns date
language sql
stable
as $$
  select (mc.course_start_date
          + make_interval(months => mc.term_months, days => mc.expiry_grace_days))::date
  from mentorship_contracts mc
  where mc.contract_id = p_contract and mc.course_start_date is not null;
$$;

-- TODAS as condições de elegibilidade (D2/D3). Retorna false quando não elegível;
-- a ÚNICA exceção é etapa sem threshold configurado (D2: nunca liberar em silêncio,
-- nunca mascarar como "não elegível" um estado de configuração pendente).
create or replace function public.mentorship_can_book(p_contract uuid)
returns boolean
language plpgsql
stable
as $$
declare
  mc mentorship_contracts%rowtype;
  v_next int;
  v_threshold numeric;
  v_rule_found boolean;
  v_pct numeric;
begin
  select * into mc from mentorship_contracts where contract_id = p_contract;
  if not found then
    raise exception 'contrato de mentoria % não existe', p_contract;
  end if;

  -- Contrato pausado/encerrado não reserva (ADR-011).
  if not exists (select 1 from contracts c where c.id = p_contract and c.status = 'active') then
    return false;
  end if;

  -- (caso 15) curso nunca acessado
  if mc.course_start_date is null then
    return false;
  end if;

  -- (caso 21) fora da vigência: créditos remanescentes ficam inertes
  if public.business_today() > public.mentorship_validity_end(p_contract)
     or public.business_today() < mc.course_start_date then
    return false;
  end if;

  -- (casos 19/20) há crédito destravado para a próxima etapa?
  v_next := public.mentorship_next_window(p_contract);
  if v_next > public.mentorship_windows_unlocked(p_contract) then
    return false;
  end if;

  -- (casos 16/17/18) gate de progresso da etapa v_next
  select r.threshold_pct, true into v_threshold, v_rule_found
  from mentorship_window_rules r
  where r.contract_id = p_contract and r.window_index = v_next;
  if v_rule_found is distinct from true or v_threshold is null then
    raise exception 'regras de progresso não configuradas para a etapa % do contrato %', v_next, p_contract;
  end if;

  select cp.completion_pct into v_pct from course_progress cp where cp.contract_id = p_contract;
  if coalesce(v_pct, 0) < v_threshold then
    return false;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mentoria: reserva (transação única, atômica — caso 25)
-- ---------------------------------------------------------------------------
create or replace function public.book_mentorship_session(
  p_session uuid,
  p_contract uuid,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sess mentorship_sessions%rowtype;
  v_student uuid;
  v_window int;
  v_ledger bigint;
  v_booking uuid;
begin
  -- Serializa reservas do MESMO contrato (mesmo em sessões diferentes): o unique
  -- parcial (contract_id, window_index) é o cinto de segurança; o lock evita o abort.
  perform pg_advisory_xact_lock(hashtextextended('mentorship_book:' || p_contract::text, 0));

  -- Lock da sessão: serializa a disputa pela última vaga (caso 23).
  select * into v_sess from mentorship_sessions where id = p_session for update;
  if not found then
    raise exception 'sessão % não existe', p_session;
  end if;
  if v_sess.status <> 'open' then
    raise exception 'sessão % não está aberta para reserva (status: %)', p_session, v_sess.status;
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
$$;

-- ---------------------------------------------------------------------------
-- Exposição: mutações críticas não são chamáveis por clientes até o M5/Fase 2
-- definir a autorização fina (Lei 3/4).
-- ---------------------------------------------------------------------------
revoke execute on function
  public.earn_makeup(uuid, ledger_reason, date, uuid, uuid, uuid),
  public.spend_makeup(uuid, ledger_reason, uuid, uuid, uuid),
  public.reschedule_class(uuid, date, time, uuid),
  public.book_mentorship_session(uuid, uuid, uuid),
  public.log_audit(uuid, text, text, text, jsonb)
from public, anon, authenticated;
