-- Construção total (14/07/2026) — novos avisos pelo cano do outbox (handoff-
-- whatsapp item 3): lembrete de aula + confirmação de remarcação. Padrão exato
-- de enqueue_credit_expiry_notices (20260713000200): dedupe idempotente, linha
-- por CANAL (e-mail com login; WhatsApp só com opt-in re-checado no ENVIO).
--
-- PAINEL da construção total: (21) só contrato ATIVO recebe aviso; (29) janela
-- ROLANTE de 24h em vez de "data civil = hoje" (aluno em fuso à frente tinha
-- aula local que caía entre os filtros e nunca recebia); (28) o payload carrega
-- o iana_tz do DESTINATÁRIO — o template formata a hora na zona dele (grupo
-- com fusos distintos vê cada um a própria hora); (3/11/19/30) o check de
-- posse da confirmação tem escape de service_role (padrão record_class_audit —
-- nunca grant morto).

-- ---------------------------------------------------------------------------
-- 1) Lembrete de aula (pesquisa UX achado 10): roda 10:00 UTC diário; pega as
--    aulas agendadas das PRÓXIMAS 24h ainda futuras. Dedupe por instância+
--    aluno ⇒ 1 lembrete por aula por pessoa, sempre.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_class_reminders()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_inserted int := 0;
  v_rows int;
  v_wa boolean;
begin
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
    where ci.state = 'scheduled'
      and c.status = 'active'                       -- painel 21: pausado não recebe
      and ci.starts_at_utc > now()
      and ci.starts_at_utc <= now() + interval '24 hours'
  loop
    insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
    values (
      'class-reminder',
      v_row.profile_id,
      jsonb_build_object(
        'instance_id', v_row.instance_id,
        'student_id', v_row.student_id,
        'starts_at_utc', v_row.starts_at_utc,
        'local_time_snapshot', v_row.local_time_snapshot,
        'iana_tz', v_row.iana_tz,
        'teacher_name', v_row.teacher_name
      ),
      format('class-reminder:%s:%s', v_row.instance_id, v_row.student_id)
    )
    on conflict (dedupe_key) do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;

    v_wa := false;
    if v_row.profile_id is not null then
      select p.whatsapp_opt_in and p.whatsapp_e164 is not null into v_wa
      from profiles p where p.id = v_row.profile_id;
    end if;
    if coalesce(v_wa, false) then
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values (
        'whatsapp', 'class-reminder', v_row.profile_id,
        jsonb_build_object(
          'instance_id', v_row.instance_id,
          'student_id', v_row.student_id,
          'starts_at_utc', v_row.starts_at_utc,
          'local_time_snapshot', v_row.local_time_snapshot,
          'iana_tz', v_row.iana_tz,
          'teacher_name', v_row.teacher_name
        ),
        format('class-reminder:%s:%s:wa', v_row.instance_id, v_row.student_id)
      )
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end if;
  end loop;
  return v_inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Confirmação de remarcação por WhatsApp (espelho do e-mail 3, que continua
--    saindo direto pela action). Posse D10 com escape de service_role (padrão
--    record_class_audit 20260714000200 — o grant abaixo NÃO é morto).
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_reschedule_confirmation(
  p_instance uuid
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
      select p.whatsapp_opt_in and p.whatsapp_e164 is not null into v_wa
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
$$;

revoke execute on function
  public.enqueue_class_reminders(),
  public.enqueue_reschedule_confirmation(uuid)
from public, anon, authenticated;
grant execute on function public.enqueue_class_reminders() to service_role;
grant execute on function public.enqueue_reschedule_confirmation(uuid) to authenticated, service_role;

-- Mesmo horário-âncora do credit-expiry (10:00 UTC = 06:00 Cuiabá; fora da
-- janela 00:00–03:59 UTC do off-by-one).
select cron.schedule(
  'enqueue-class-reminders-daily',
  '0 10 * * *',
  $$select public.enqueue_class_reminders()$$
);
