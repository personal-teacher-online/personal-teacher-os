-- F6 — Fila em tempo real (plano integrado v2, 18/07/2026; decisões M8-1, M8-2,
-- M8-3, M8-5, M9-8, M9-9 + P2/P9/P15/P24 do passe adversarial).
--   • Dois toques com MARCO na chave (`:48h:` / `:2h:`) — sem colisão com o
--     histórico do lembrete único; enfileiramento de HORA em hora (cron novo).
--   • Aula criada DEPOIS do marco de 48h recebe só o toque de 2h (P24).
--   • Confirmação de presença: flag INFORMATIVA (nunca trava), grupo registra
--     QUAL membro confirmou.
--   • P9/M4-3: os enfileiramentos NOVOS já nascem na regra "tem número →
--     recebe" (o opt-in booleano morre de vez na F7).
--   • Silêncio 21–08 local: decidido no DESPACHO (app), só para avisos de LOTE.
--   • Painel de avisos: "resolver sem enviar" com motivo, auditado (M8-5).
--   • Retenção 90 dias da caixa Evolution no app (mensagens; recibos ficam).

-- ---------------------------------------------------------------------------
-- 1. Colunas novas
-- ---------------------------------------------------------------------------
alter table class_instances add column confirmed_at timestamptz;
alter table class_instances add column confirmed_by uuid references profiles (id);
comment on column class_instances.confirmed_at is
  'M8-3: presença confirmada pelo aluno (INFORMATIVA — nunca trava fluxo).';
comment on column class_instances.confirmed_by is
  'M8-3: QUAL membro confirmou (grupo tem fusos e agendas próprios).';

alter table teachers add column fallback_meet_url text;
comment on column teachers.fallback_meet_url is
  'M1-extras: link fixo de Meet usado no toque de 2h e na página da aula '
  'enquanto o Meet por aula (F11) não sobe. Depois vira reserva.';

-- exposto ao aluno junto do resto da view pública
create or replace view teacher_public as
  select id, display_name, min_booking_lead_hours, fallback_meet_url from teachers;

-- painel da professora enxerga a confirmação (badge)
drop view teacher_agenda;
create view teacher_agenda as
  select i.id,
         i.starts_at_utc,
         i.ends_at_utc,
         i.state,
         i.local_time_snapshot,
         i.contract_id,
         i.confirmed_at,
         coalesce(s.display_name, g.label) as student_label
    from class_instances i
    join contracts c on c.id = i.contract_id
    left join students s on s.id = c.student_id
    left join student_groups g on g.id = c.student_group_id
   where i.teacher_id = (select public.my_teacher_id())
     and (select public.app_role()) in ('teacher', 'admin')
     and not (i.state = 'scheduled' and c.status = 'paused');
grant select on teacher_agenda to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Confirmação de presença (M8-3)
-- ---------------------------------------------------------------------------
create or replace function public.confirm_my_class(p_instance uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst class_instances%rowtype;
begin
  select * into v_inst from class_instances where id = p_instance for update;
  if not found then
    raise exception 'aula % não existe', p_instance;
  end if;
  if v_inst.contract_id not in (select public.my_contract_ids()) then
    raise exception 'você não tem acesso a esta aula (D10)';
  end if;
  if v_inst.state <> 'scheduled' then
    raise exception 'a aula não está mais agendada (%)', v_inst.state;
  end if;
  if v_inst.starts_at_utc <= now() then
    raise exception 'a aula já começou — confirmação não é mais necessária';
  end if;
  if v_inst.confirmed_at is not null then
    return; -- idempotente: primeira confirmação vence
  end if;

  update class_instances
     set confirmed_at = now(), confirmed_by = auth.uid()
   where id = p_instance;

  perform public.log_audit(auth.uid(), 'confirm_class', 'class_instances', p_instance::text,
    jsonb_build_object('confirmed_by', auth.uid()));
end;
$$;
revoke execute on function public.confirm_my_class(uuid) from public, anon;
grant execute on function public.confirm_my_class(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Dois toques (M8-2 + P24) — marcos na chave; regra "tem número" (P9).
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
           s.id as student_id, s.profile_id, s.iana_tz,
           t.display_name as teacher_name, t.fallback_meet_url
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
    -- P24: toque 1 só para aula que JÁ EXISTIA no marco das 48h e ainda está
    -- longe o bastante (>2h); toque 2 para todas dentro das 2h.
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
        'marco', v_marco, 'meet_url', v_row.fallback_meet_url),
      format('class-reminder:%s:%s:%s', v_marco, v_row.instance_id, v_row.student_id))
    on conflict (dedupe_key) do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;

    -- P9/M4-3: TEM NÚMERO → recebe (o consentimento formal vira cláusula na F7)
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
          'marco', v_marco, 'meet_url', v_row.fallback_meet_url),
        format('class-reminder:%s:%s:%s:wa', v_marco, v_row.instance_id, v_row.student_id))
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end if;
  end loop;
  return v_inserted;
end;
$$;
revoke execute on function public.enqueue_class_touches() from public, anon, authenticated;
grant execute on function public.enqueue_class_touches() to service_role;

-- cadência HORÁRIA (M8-1) — o lembrete único diário sai de cena
select cron.unschedule('enqueue-class-reminders-daily');
select cron.schedule(
  'enqueue-class-touches-hourly',
  '5 * * * *',
  $$select public.enqueue_class_touches()$$
);

-- ---------------------------------------------------------------------------
-- 4. "Resolver sem enviar" (M8-5): a ÚNICA ação manual do painel de avisos.
-- ---------------------------------------------------------------------------
create or replace function public.admin_resolve_outbox(
  p_id uuid,
  p_note text default null,  -- default só p/ resolução do PostgREST; a função RECUSA vazio
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row notification_outbox%rowtype;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_resolve_outbox é restrita à admin (D10)';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'resolver sem enviar exige motivo (M8-5)';
  end if;
  select * into v_row from notification_outbox where id = p_id for update;
  if not found then
    raise exception 'aviso % não existe', p_id;
  end if;
  if v_row.sent_at is not null then
    raise exception 'aviso % já está resolvido/enviado', p_id;
  end if;
  update notification_outbox
     set sent_at = now(), error = 'resolvido sem envio: ' || p_note
   where id = p_id;
  perform public.log_audit(coalesce(auth.uid(), p_actor), 'resolve_outbox',
    'notification_outbox', p_id::text,
    jsonb_build_object('template', v_row.template, 'channel', v_row.channel,
                       'dedupe_key', v_row.dedupe_key, 'note', p_note));
end;
$$;
revoke execute on function public.admin_resolve_outbox(uuid, text, uuid) from public, anon;
grant execute on function public.admin_resolve_outbox(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Retenção 90 dias da caixa Evolution NO APP (M9-8): expurga MENSAGENS
--    recebidas antigas; recibos de entrega (messages.update) ficam. O expurgo
--    do banco PRÓPRIO da Evolution é tarefa de deploy (backup + dry-run — P15).
-- ---------------------------------------------------------------------------
create or replace function public.purge_evolution_inbox(p_days int default 90)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  delete from webhook_inbox
  where source = 'evolution'
    and received_at < now() - make_interval(days => p_days)
    and coalesce(payload->>'event', '') <> 'messages.update';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.purge_evolution_inbox(int) from public, anon, authenticated;
grant execute on function public.purge_evolution_inbox(int) to service_role;

select cron.schedule(
  'purge-evolution-inbox-daily',
  '30 9 * * *',
  $$select public.purge_evolution_inbox()$$
);
