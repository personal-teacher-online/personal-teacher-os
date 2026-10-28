-- Reforma de UI "do zero" (17/07/2026) — melhorias de motor que as telas novas
-- pedem. Quatro blocos, todos aditivos (nenhuma migration antiga tocada):
--   1. Campos de cadastro que faltavam: nível do aluno; CPF e tipo de contrato
--      da professora (dores 7/14/22/29 do qa/reforma.md).
--   2. complete_class: registrar "aula aconteceu" — o desfecho MAIS comum não
--      tinha caminho nenhum (a agenda só oferecia falta/cancelamento).
--   3. contract_credit_summary: saldo+validade de reposição em UMA chamada
--      (mata o N+1 de makeup_balance por contrato em 4 telas).
--   4. admin_student_directory / admin_mentorship_overview: leitura consolidada
--      das listas do admin (mata o N+1 de auth.getUserById por aluno e o de
--      RPCs de mentoria por contrato).
-- Núcleo de dinheiro/crédito/fuso: INTOCADO — os blocos 3/4 apenas AGREGAM
-- funções de leitura existentes; nada de regra nova de saldo.

-- ---------------------------------------------------------------------------
-- 1. Campos de cadastro
-- ---------------------------------------------------------------------------
alter table students add column level text
  check (level is null or level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2'));
comment on column students.level is
  'Nível CEFR do aluno (A1–C2), preenchido pela admin. NULL = ainda não avaliado.';

alter table teachers add column cpf text;
comment on column teachers.cpf is
  'CPF da professora (dado interno da escola; nunca exposto a aluno — a view '
  'teacher_public segue expondo só id + display_name).';

alter table teachers add column contract_kind text;
comment on column teachers.contract_kind is
  'Tipo de vínculo da professora em texto livre (ex.: "PJ — hora auditada"). '
  'Dado interno da escola, mesmo regime do cpf.';

-- ---------------------------------------------------------------------------
-- 2. complete_class — "aula aconteceu" (desfecho positivo em 1 clique)
-- ---------------------------------------------------------------------------
create or replace function public.complete_class(p_instance uuid, p_actor uuid default null)
returns void
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
          jsonb_build_object('from', 'scheduled', 'to', 'completed'));
end;
$$;

revoke execute on function public.complete_class(uuid, uuid) from public;
grant execute on function public.complete_class(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. contract_credit_summary — saldo derivado + próxima validade, em lote.
-- SECURITY INVOKER de propósito: a RLS do chamador decide QUAIS contratos
-- aparecem (admin = todos; aluno = os seus; professora = os dela). O saldo em
-- si continua vindo de makeup_balance/makeup_remaining_expiries — nenhuma
-- regra de crédito reimplementada.
-- ---------------------------------------------------------------------------
create or replace function public.contract_credit_summary()
returns table (contract_id uuid, balance int, next_expiry date)
language sql
stable
set search_path = public, pg_temp
as $$
  select c.id,
         public.makeup_balance(c.id),
         (select min(d) from public.makeup_remaining_expiries(c.id) d)
  from contracts c
  where c.contract_type = 'private_1on1'
    and c.status <> 'ended';
$$;

grant execute on function public.contract_credit_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- 4a. admin_student_directory — a lista de alunos (e a ficha) em UMA chamada:
-- cadastro + contato (profiles) + acesso (auth.users) + contratos com saldo.
-- SECURITY DEFINER (lê auth.users e profiles de terceiros) ⇒ papel checado
-- na primeira linha; nada exposto a aluno/professora.
-- ---------------------------------------------------------------------------
create or replace function public.admin_student_directory(p_student uuid default null)
returns table (
  id uuid,
  display_name text,
  iana_tz text,
  status text,
  city text,
  country text,
  level text,
  profile_id uuid,
  whatsapp_e164 text,
  whatsapp_opt_in boolean,
  email text,
  email_confirmed boolean,
  last_sign_in_at timestamptz,
  contracts jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.app_role() <> 'admin' then
    raise exception 'D10: diretório de alunos é só da administração';
  end if;

  return query
  select s.id, s.display_name, s.iana_tz, s.status, s.city, s.country, s.level,
         s.profile_id, p.whatsapp_e164, p.whatsapp_opt_in,
         au.email::text,
         (au.email_confirmed_at is not null),
         au.last_sign_in_at,
         coalesce(
           (
             select jsonb_agg(
                      jsonb_build_object(
                        'contract_id', c.id,
                        'contract_type', c.contract_type,
                        'plan_name', c.plan_name,
                        'status', c.status,
                        'teacher_id', c.teacher_id,
                        'teacher_name', t.display_name,
                        'group_label', g.label,
                        'monthly_reschedule_allowance', c.monthly_reschedule_allowance,
                        'min_notice_hours', c.min_notice_hours,
                        'makeup_credit_expiry_days', c.makeup_credit_expiry_days,
                        'started_on', c.started_on,
                        'balance', case when c.contract_type = 'private_1on1'
                                        then public.makeup_balance(c.id) end,
                        'next_expiry', case when c.contract_type = 'private_1on1'
                                            then (select min(d) from public.makeup_remaining_expiries(c.id) d) end
                      )
                      order by c.started_on
                    )
             from contracts c
             left join teachers t on t.id = c.teacher_id
             left join student_groups g on g.id = c.student_group_id
             where c.status <> 'ended'
               and (c.student_id = s.id
                    or c.student_group_id in (
                         select m.group_id from student_group_members m where m.student_id = s.id))
           ),
           '[]'::jsonb
         )
  from students s
  left join profiles p on p.id = s.profile_id
  left join auth.users au on au.id = s.profile_id
  where p_student is null or s.id = p_student
  order by s.display_name;
end;
$$;

revoke execute on function public.admin_student_directory(uuid) from public;
grant execute on function public.admin_student_directory(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4b. admin_mentorship_overview — visão da mentoria em UMA chamada por rodada.
-- Agrega SÓ funções de leitura existentes; can_book vira NULL (e a flag
-- threshold_missing acende) quando a janela não tem threshold configurado —
-- a exceção da função original é capturada, nunca engolida em silêncio.
-- ---------------------------------------------------------------------------
create or replace function public.admin_mentorship_overview()
returns table (
  contract_id uuid,
  student_id uuid,
  student_name text,
  contract_status text,
  course_start_date date,
  term_months int,
  total_credits int,
  window_months int,
  completion_pct numeric,
  last_synced_at timestamptz,
  external_user_ref text,
  unlocked int,
  ledger_net int,
  available int,
  next_window int,
  validity_end date,
  can_book boolean,
  threshold_missing boolean,
  thresholds jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
           mc.external_user_ref,
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
$$;

revoke execute on function public.admin_mentorship_overview() from public;
grant execute on function public.admin_mentorship_overview() to authenticated;
