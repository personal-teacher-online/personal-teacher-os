-- F7 — Cadastro, convite, pagador e LGPD (plano integrado v2, 18/07/2026;
-- decisões M4-1..M4-5, M11-4 + P7/P9 do passe adversarial). A fase do GO-LIVE
-- ALUNOS no lado do banco:
--   A) canal contratual (M4-3): o boolean whatsapp_opt_in É DROPADO — a regra
--      única vira "tem número → recebe" (o consentimento formal é contratual +
--      tela de ciência com timestamp). Os 4 enfileiramentos que liam o boolean
--      são recriados BYTE A BYTE a partir das definições vivas, mudando SÓ a
--      condição (dump via pg_get_functiondef — sem transcrição à mão).
--   B) convite: bounce do Resend marcado no perfil (painel/ficha exibem);
--      diretório do admin ganha ciência/bounce/invited_at.
--   C) LGPD (M4-5): anonimizar ex-aluno conforme o MAPA registrado (esqueleto
--      operacional preservado; relatórios ENVIADOS são exceção controlada;
--      pagador com cobrança real preserva 5 anos — M11-4) + expurgo da caixa
--      Evolution por telefone. O login é destruído na ACTION (ban + scramble
--      via API do Auth — deletar auth.users é bloqueado pelos FKs do esqueleto,
--      de propósito).

alter table profiles add column whatsapp_channel_ack_at timestamptz;
comment on column profiles.whatsapp_channel_ack_at is
  'M4-3: quando o aluno deu ciência do canal oficial (e-mail + WhatsApp) no 1º acesso.';
alter table profiles add column email_bounced_at timestamptz;
alter table profiles add column email_bounce_reason text;
comment on column profiles.email_bounced_at is
  'M4-2: último bounce reportado pelo Resend (webhook Svix) — painel/ficha acusam.';

-- ---------------------------------------------------------------------------
-- 1. Recriações (regra "tem número → recebe") — defs vivas, só a condição muda.
--    enqueue_class_reminders (lembrete único legado) é DROPADA: superseded pelos
--    toques da F6 e o cron antigo já foi desagendado.
-- ---------------------------------------------------------------------------
drop function if exists public.enqueue_class_reminders();
drop function public.admin_student_directory(uuid);

CREATE OR REPLACE FUNCTION public.enqueue_credit_expiry_notices(p_today date DEFAULT business_today())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_contract record;
  v_expiry record;
  v_student record;
  v_marco int;
  v_inserted int := 0;
  v_rows int;
  v_wa boolean;
begin
  for v_contract in
    select distinct ml.contract_id, c.student_id, c.student_group_id
    from makeup_ledger ml
    join contracts c on c.id = ml.contract_id
    where c.status = 'active'
  loop
    for v_expiry in
      select e as expires_on, count(*)::int as n_credits
      from public.makeup_remaining_expiries(v_contract.contract_id) e
      -- Comparação por soma (e <= p_today + N), nunca subtração: 'infinity'::date
      -- (crédito sem validade) compara normalmente mas EXPLODE em subtração.
      where e >= p_today                      -- não expirado
        and e <= p_today + 30                 -- dentro do maior marco (exclui infinity)
      group by e
    loop
      -- P2: um e-mail só — o marco efetivo é o mais apertado pendente.
      v_marco := case when v_expiry.expires_on <= p_today + 15 then 15 else 30 end;

      for v_student in
        select s.id as student_id, s.profile_id
        from students s
        where s.id = v_contract.student_id
        union
        select s.id, s.profile_id
        from student_group_members m
        join students s on s.id = m.student_id
        where m.group_id = v_contract.student_group_id
      loop
        -- Marco efetivo: linha real, a enviar.
        insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
        values (
          'credit-expiry',
          v_student.profile_id,
          jsonb_build_object(
            'contract_id', v_contract.contract_id,
            'student_id', v_student.student_id,
            'expires_on', v_expiry.expires_on,
            'marco', v_marco,
            'n_credits', v_expiry.n_credits
          ),
          format('credit-expiry:%s:%s:%s:%s',
                 v_contract.contract_id, v_student.student_id, v_expiry.expires_on, v_marco)
        )
        on conflict (dedupe_key) do nothing;
        get diagnostics v_rows = row_count;
        v_inserted := v_inserted + v_rows;

        -- F3-D8/ADR-016 (12/07/2026): aviso TAMBÉM por WhatsApp quando o aluno tem
        -- login + OPT-IN + telefone (consentimento é re-checado no ENVIO). Uma linha
        -- por CANAL por destinatário — dedupe com sufixo ':wa'.
        v_wa := false;
        if v_student.profile_id is not null then
          select p.whatsapp_e164 is not null into v_wa
          from profiles p where p.id = v_student.profile_id;
        end if;
        if coalesce(v_wa, false) then
          insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
          values (
            'whatsapp', 'credit-expiry', v_student.profile_id,
            jsonb_build_object(
              'contract_id', v_contract.contract_id,
              'student_id', v_student.student_id,
              'expires_on', v_expiry.expires_on,
              'marco', v_marco,
              'n_credits', v_expiry.n_credits
            ),
            format('credit-expiry:%s:%s:%s:%s:wa',
                   v_contract.contract_id, v_student.student_id, v_expiry.expires_on, v_marco)
          )
          on conflict (dedupe_key) do nothing;
          get diagnostics v_rows = row_count;
          v_inserted := v_inserted + v_rows;
          if v_marco = 15 then
            insert into notification_outbox
              (channel, template, recipient_profile_id, payload, dedupe_key, sent_at)
            values (
              'whatsapp', 'credit-expiry', v_student.profile_id,
              jsonb_build_object(
                'contract_id', v_contract.contract_id,
                'student_id', v_student.student_id,
                'expires_on', v_expiry.expires_on,
                'marco', 30,
                'covered_by', 15
              ),
              format('credit-expiry:%s:%s:%s:%s:wa',
                     v_contract.contract_id, v_student.student_id, v_expiry.expires_on, 30),
              now()
            )
            on conflict (dedupe_key) do nothing;
          end if;
        end if;

        -- P2: se o marco efetivo é o 15 e o 30 nunca foi avisado, registra o 30
        -- como COBERTO (sent_at preenchido) — idempotente pelo mesmo dedupe.
        if v_marco = 15 then
          insert into notification_outbox
            (template, recipient_profile_id, payload, dedupe_key, sent_at)
          values (
            'credit-expiry',
            v_student.profile_id,
            jsonb_build_object(
              'contract_id', v_contract.contract_id,
              'student_id', v_student.student_id,
              'expires_on', v_expiry.expires_on,
              'marco', 30,
              'covered_by', 15
            ),
            format('credit-expiry:%s:%s:%s:%s',
                   v_contract.contract_id, v_student.student_id, v_expiry.expires_on, 30),
            now()
          )
          on conflict (dedupe_key) do nothing;
        end if;
      end loop;
    end loop;
  end loop;
  return v_inserted;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_mentorship_eligibility_notices()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row record;
  v_unlocked int;
  v_next int;
  v_inserted int := 0;
  v_rows int;
  v_wa boolean;
begin
  for v_row in
    select mc.contract_id, mc.total_credits, c.student_id, s.profile_id
    from mentorship_contracts mc
    join contracts c on c.id = mc.contract_id
    join students s on s.id = c.student_id
    where c.status = 'active'
      and mc.course_start_date is not null
  loop
    begin
      v_unlocked := public.mentorship_windows_unlocked(v_row.contract_id);
      if v_unlocked < 1 then
        continue;
      end if;
      v_next := public.mentorship_next_window(v_row.contract_id);
      if v_next is null or v_next > v_unlocked or v_next > v_row.total_credits then
        continue; -- nada novo reservável
      end if;
      if not public.mentorship_can_book(v_row.contract_id) then
        continue;
      end if;
    exception when others then
      -- Threshold ausente (D2) ou afim: rastro auditável, batch segue vivo.
      perform public.log_audit(null, 'mentorship_eligibility_skip',
        'mentorship_contracts', v_row.contract_id::text,
        jsonb_build_object('error', sqlerrm));
      continue;
    end;

    insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
    values (
      'mentorship-eligible',
      v_row.profile_id,
      jsonb_build_object(
        'contract_id', v_row.contract_id,
        'student_id', v_row.student_id,
        'next_window', v_next,
        'total_credits', v_row.total_credits
      ),
      format('mentorship-eligible:%s:%s', v_row.contract_id, v_next)
    )
    on conflict (dedupe_key) do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;

    v_wa := false;
    if v_row.profile_id is not null then
      select p.whatsapp_e164 is not null into v_wa
      from profiles p where p.id = v_row.profile_id;
    end if;
    if coalesce(v_wa, false) then
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values (
        'whatsapp', 'mentorship-eligible', v_row.profile_id,
        jsonb_build_object(
          'contract_id', v_row.contract_id,
          'student_id', v_row.student_id,
          'next_window', v_next,
          'total_credits', v_row.total_credits
        ),
        format('mentorship-eligible:%s:%s:wa', v_row.contract_id, v_next)
      )
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end if;
  end loop;
  return v_inserted;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_reschedule_confirmation(p_instance uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_contract uuid;
  v_row record;
  v_inserted int := 0;
  v_rows int;
  v_wa boolean;
begin
  select ci.contract_id into v_contract
  from class_instances ci where ci.id = p_instance;
  if v_contract is null then
    raise exception 'instância % não existe', p_instance;
  end if;

  if not ((auth.jwt() ->> 'role') = 'service_role'
          or public.app_role() = 'admin'
          or v_contract in (select public.my_contract_ids())) then
    raise exception 'você não tem acesso a este contrato (D10)';
  end if;

  for v_row in
    select ci.id as instance_id,
           ci.starts_at_utc,
           ci.local_time_snapshot,
           s.id as student_id,
           s.profile_id,
           s.iana_tz,
           t.display_name as teacher_name
    from class_instances ci
    join contracts c on c.id = ci.contract_id
    join teachers t on t.id = ci.teacher_id
    join lateral (
      select st.id, st.profile_id, st.iana_tz
      from students st
      where st.id = c.student_id
      union
      select st.id, st.profile_id, st.iana_tz
      from student_group_members m
      join students st on st.id = m.student_id
      where m.group_id = c.student_group_id
    ) s on true
    where ci.id = p_instance
      and c.status = 'active'
  loop
    -- Só WhatsApp: o e-mail 3 (aprovado) sai pela action do portal.
    v_wa := false;
    if v_row.profile_id is not null then
      select p.whatsapp_e164 is not null into v_wa
      from profiles p where p.id = v_row.profile_id;
    end if;
    if coalesce(v_wa, false) then
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values (
        'whatsapp', 'reschedule-confirm', v_row.profile_id,
        jsonb_build_object(
          'instance_id', v_row.instance_id,
          'student_id', v_row.student_id,
          'starts_at_utc', v_row.starts_at_utc,
          'local_time_snapshot', v_row.local_time_snapshot,
          'iana_tz', v_row.iana_tz,
          'teacher_name', v_row.teacher_name
        ),
        format('reschedule-confirm:%s:%s:wa', v_row.instance_id, v_row.student_id)
      )
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end if;
  end loop;
  return v_inserted;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._enqueue_class_cancelled(p_instance uuid, p_credited boolean, p_expires date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      select p.whatsapp_e164 is not null into v_wa
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_student_directory(p_student uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, display_name text, iana_tz text, status text, city text, country text, level text, profile_id uuid, whatsapp_e164 text, whatsapp_channel_ack_at timestamp with time zone, email_bounced_at timestamp with time zone, invited_at timestamp with time zone, email text, email_confirmed boolean, last_sign_in_at timestamp with time zone, contracts jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if public.app_role() <> 'admin' then
    raise exception 'D10: diretório de alunos é só da administração';
  end if;

  return query
  select s.id, s.display_name, s.iana_tz, s.status, s.city, s.country, s.level,
         s.profile_id, p.whatsapp_e164, p.whatsapp_channel_ack_at, p.email_bounced_at, au.created_at,
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
$function$
;


revoke execute on function public.admin_student_directory(uuid) from public;
grant execute on function public.admin_student_directory(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. O DROP do boolean (depois de zerados os leitores — inventário: dispatcher
--    (F6), 4 enfileiramentos acima, diretório acima, UI refeita nesta fase).
-- ---------------------------------------------------------------------------
alter table profiles drop column whatsapp_opt_in;

-- ---------------------------------------------------------------------------
-- 3. Ciência do canal (M4-3) e edição do próprio número (M4-4)
-- ---------------------------------------------------------------------------
create or replace function public.ack_channel_notice()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'sessão necessária';
  end if;
  update profiles set whatsapp_channel_ack_at = coalesce(whatsapp_channel_ack_at, now())
   where id = auth.uid();
  perform public.log_audit(auth.uid(), 'ack_channel_notice', 'profiles', auth.uid()::text,
    jsonb_build_object('at', now()));
end;
$$;
revoke execute on function public.ack_channel_notice() from public, anon;
grant execute on function public.ack_channel_notice() to authenticated;

create or replace function public.update_my_whatsapp(p_e164 text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clean text;
begin
  if auth.uid() is null then
    raise exception 'sessão necessária';
  end if;
  v_clean := nullif(btrim(coalesce(p_e164, '')), '');
  if v_clean is not null and v_clean !~ '^\+?[0-9]{10,15}$' then
    raise exception 'número inválido — use o formato +5565999999999';
  end if;
  update profiles set whatsapp_e164 = v_clean where id = auth.uid();
  perform public.log_audit(auth.uid(), 'update_my_whatsapp', 'profiles', auth.uid()::text,
    jsonb_build_object('whatsapp_e164', v_clean));
end;
$$;
revoke execute on function public.update_my_whatsapp(text) from public, anon;
grant execute on function public.update_my_whatsapp(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Bounce do Resend (M4-2) — chamada pelo webhook (service_role) por e-mail.
-- ---------------------------------------------------------------------------
create or replace function public.mark_email_bounced(
  p_email text,
  p_reason text default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int := 0;
begin
  if not ((auth.jwt() ->> 'role') = 'service_role' or public.app_role() = 'admin') then
    raise exception 'mark_email_bounced é restrita a service_role ou admin (D10)';
  end if;
  update profiles p
     set email_bounced_at = now(), email_bounce_reason = p_reason
    from auth.users au
   where au.id = p.id and lower(au.email) = lower(p_email);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.mark_email_bounced(text, text) from public, anon;
grant execute on function public.mark_email_bounced(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. LGPD (M4-5 + M11-4): anonimização conforme o MAPA + expurgo por telefone.
-- ---------------------------------------------------------------------------
create or replace function public.admin_anonymize_student(
  p_student uuid,
  p_confirm text,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student students%rowtype;
  v_actor uuid;
  v_phone text;
  v_profile uuid;
  v_payer record;
  v_fiscal int := 0;
  v_scrubbed int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_anonymize_student é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_student from students where id = p_student for update;
  if not found then
    raise exception 'aluno % não existe', p_student;
  end if;
  -- dupla confirmação: digitar o NOME exato
  if btrim(coalesce(p_confirm, '')) <> v_student.display_name then
    raise exception 'confirmação não confere — digite o nome exato do aluno';
  end if;
  -- só ex-aluno: TODOS os contratos (diretos e de grupo) encerrados
  if exists (
    select 1 from contracts c
    where c.status <> 'ended'
      and (c.student_id = p_student
           or c.student_group_id in (
                select m.group_id from student_group_members m where m.student_id = p_student))
  ) then
    raise exception 'aluno ainda tem contrato não-encerrado — encerre antes de anonimizar';
  end if;

  v_profile := v_student.profile_id;
  if v_profile is not null then
    select whatsapp_e164 into v_phone from profiles where id = v_profile;
    update profiles
       set full_name = 'Ex-aluno(a)',
           whatsapp_e164 = null,
           email_bounced_at = null,
           email_bounce_reason = null
     where id = v_profile;
  end if;

  -- esqueleto operacional preservado (aulas, ledger, extratos, auditoria);
  -- relatórios ENVIADOS ficam (exceção controlada da decisão M4-5)
  update students
     set display_name = 'Ex-aluno(a) ' || left(p_student::text, 4),
         city = null,
         country = null,
         level = null,
         profile_id = null
   where id = p_student;

  -- M11-4: pagador EXCLUSIVO deste aluno — com cobrança real (Asaas) preserva
  -- 5 anos (obrigação fiscal, expurgo manual futuro registrado); sem, é limpo.
  for v_payer in
    select py.* from payers py
    join student_payers sp on sp.payer_id = py.id and sp.student_id = p_student
    where not exists (
      select 1 from student_payers sp2
      where sp2.payer_id = py.id and sp2.student_id <> p_student)
  loop
    if v_payer.asaas_customer_id is not null then
      v_fiscal := v_fiscal + 1;
    else
      update payers set name = 'Pagador removido', email = null, cpf_cnpj = null
       where id = v_payer.id;
      v_scrubbed := v_scrubbed + 1;
    end if;
  end loop;

  perform public.log_audit(v_actor, 'anonymize_student', 'students', p_student::text,
    jsonb_build_object('profile_id', v_profile, 'payers_fiscal_5anos', v_fiscal,
                       'payers_scrubbed', v_scrubbed));

  return jsonb_build_object('profile_id', v_profile, 'phone', v_phone,
                            'payers_fiscal', v_fiscal, 'payers_scrubbed', v_scrubbed);
end;
$$;
revoke execute on function public.admin_anonymize_student(uuid, text, uuid) from public, anon;
grant execute on function public.admin_anonymize_student(uuid, text, uuid) to authenticated;

create or replace function public.admin_purge_evolution_by_phone(p_phone text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_digits text;
  v_count int;
begin
  if not ((auth.jwt() ->> 'role') = 'service_role' or public.app_role() = 'admin') then
    raise exception 'admin_purge_evolution_by_phone é restrita a admin/service (D10)';
  end if;
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if length(v_digits) < 8 then
    raise exception 'telefone inválido para expurgo';
  end if;
  delete from webhook_inbox
  where source = 'evolution' and payload::text like '%' || v_digits || '%';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.admin_purge_evolution_by_phone(text) from public, anon;
grant execute on function public.admin_purge_evolution_by_phone(text) to authenticated, service_role;

-- Reenvio NEUTRO do convite (M4-2): resolve aluno-por-e-mail para a página
-- pública — service_role only; a action responde SEMPRE neutro.
create or replace function public._student_by_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception '_student_by_email é restrita a service_role';
  end if;
  select s.id into v_student
  from auth.users au
  join students s on s.profile_id = au.id
  where lower(au.email) = lower(p_email)
  limit 1;
  return v_student;
end;
$$;
revoke execute on function public._student_by_email(text) from public, anon, authenticated;
grant execute on function public._student_by_email(text) to service_role;
