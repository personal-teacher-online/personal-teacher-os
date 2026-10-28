-- F11 — Família das chaves (plano integrado v2, 18/07/2026; decisões M13, M14,
-- M15, M6-6, M1-extras + P3/P20 do passe adversarial).
--   • O sync do Google passa a GRAVAR o id do evento e o link do Meet na aula
--     (a coluna google_event_id dormia desde o blueprint — ADR-017 adendo).
--   • O toque de 2h usa o Meet REAL da aula (fallback fixo vira reserva).
--   • Relatório enviado grava QUEM enviou (M14-6 — sent_at já existia).
--   • Sessão de mentoria ↔ evento Google pela conexão-ÂNCORA (P3) — colunas já
--     existiam (google_event_id/gmeet_url); grant cirúrgico para o robô.

alter table class_instances add column meet_url text;
comment on column class_instances.meet_url is
  'F11/M13: link do Meet do EVENTO desta aula (gravado pelo sync). O toque de '
  '2h e a página da aula preferem este; o fallback fixo da professora é reserva.';

grant update (google_event_id, meet_url) on class_instances to service_role;
grant update (google_event_id, gmeet_url) on mentorship_sessions to service_role;

alter table progress_reports add column sent_by uuid references profiles (id);
comment on column progress_reports.sent_by is 'M14-6: QUEM marcou como enviado (sent_at já grava quando).';

-- ---------------------------------------------------------------------------
-- Toque de 2h com o Meet REAL (recreate de enqueue_class_touches da F6 — a
-- ÚNICA mudança é o coalesce do meet_url).
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_class_touches()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_marco text;
  v_inserted int := 0;
  v_rows int;
  v_has_wa boolean;
begin
  for v_row in
    select ci.id as instance_id, ci.starts_at_utc, ci.local_time_snapshot,
           ci.created_at as instance_created_at,
           coalesce(ci.meet_url, t.fallback_meet_url) as meet_url,
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
    where ci.state = 'scheduled'
      and c.status = 'active'
      and ci.starts_at_utc > now()
      and ci.starts_at_utc <= now() + interval '48 hours'
  loop
    if v_row.starts_at_utc <= now() + interval '2 hours' then
      v_marco := '2h';
    elsif v_row.instance_created_at <= v_row.starts_at_utc - interval '48 hours' then
      v_marco := '48h';
    else
      continue;
    end if;

    insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
    values (
      'class-reminder', v_row.profile_id,
      jsonb_build_object(
        'instance_id', v_row.instance_id, 'student_id', v_row.student_id,
        'starts_at_utc', v_row.starts_at_utc,
        'local_time_snapshot', v_row.local_time_snapshot,
        'iana_tz', v_row.iana_tz, 'teacher_name', v_row.teacher_name,
        'marco', v_marco, 'meet_url', v_row.meet_url),
      format('class-reminder:%s:%s:%s', v_marco, v_row.instance_id, v_row.student_id))
    on conflict (dedupe_key) do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;

    v_has_wa := false;
    if v_row.profile_id is not null then
      select p.whatsapp_e164 is not null into v_has_wa
      from profiles p where p.id = v_row.profile_id;
    end if;
    if coalesce(v_has_wa, false) then
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values (
        'whatsapp', 'class-reminder', v_row.profile_id,
        jsonb_build_object(
          'instance_id', v_row.instance_id, 'student_id', v_row.student_id,
          'starts_at_utc', v_row.starts_at_utc,
          'local_time_snapshot', v_row.local_time_snapshot,
          'iana_tz', v_row.iana_tz, 'teacher_name', v_row.teacher_name,
          'marco', v_marco, 'meet_url', v_row.meet_url),
        format('class-reminder:%s:%s:%s:wa', v_marco, v_row.instance_id, v_row.student_id))
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end if;
  end loop;
  return v_inserted;
end;
$$;
