-- Leva 1 do veredito adversarial (qa/veredito-adversarial-e2e.md) — ADR-018.
-- Regra ratificada pelo mantenedor em 18/07/2026 (Leva 0):
--   • Autocancelamento do aluno NUNCA gera crédito nem estorno, em qualquer
--     antecedência. Com aviso, o caminho do aluno é REMARCAR (franquia).
--   • Crédito nasce só quando a ESCOLA falha (cancelled_by = 'teacher') ou por
--     lançamento manual auditado (admin_makeup_adjust); o estorno formal
--     (par −1/+1 com refund_of) permanece como ferramenta do atendimento.
--   • Ledger existente intocado (Lei 2) — a regra vale daqui para frente.
-- Também: 31c — aula criada a <48h do início ganha o toque acionável imediato,
-- com guarda contra instâncias nascidas de ação do próprio aluno.
-- Funções recriadas a partir do dump VIVO (pg_get_functiondef) — sem drift.

CREATE OR REPLACE FUNCTION public._cancel_class_core(p_instance uuid, p_cancelled_by text, p_notified_at timestamp with time zone, p_actor uuid, p_via text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_inst class_instances%rowtype;
  v_contract contracts%rowtype;
  v_credited boolean := false;
  v_expires date;
  v_credit_born boolean;
  v_refund record;
  v_blocked text;
begin
  if p_cancelled_by not in ('student', 'teacher') then
    raise exception 'p_cancelled_by deve ser student ou teacher (recebido: %)', p_cancelled_by;
  end if;
  if p_notified_at > now() then
    raise exception 'notified_at no futuro (%) — o aviso já deve ter acontecido', p_notified_at;
  end if;

  select * into v_inst from class_instances where id = p_instance for update;
  if not found then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_inst.state <> 'scheduled' then
    raise exception 'instância % não está agendada (estado: %)', p_instance, v_inst.state;
  end if;
  if now() >= v_inst.starts_at_utc and p_notified_at >= v_inst.starts_at_utc then
    raise exception 'aula % já começou e o aviso não a precedeu — use no_show_student/no_show_teacher', p_instance;
  end if;

  select * into v_contract from contracts where id = v_inst.contract_id for update;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'cancel_class só se aplica a contratos private_1on1';
  end if;

  update class_instances set state = 'cancelled' where id = p_instance;

  v_credit_born := exists (
    select 1 from makeup_ledger l
    where l.delta < 0 and l.reason = 'spend_reschedule'
      and (l.class_instance_id = p_instance
           or (v_inst.reschedule_of is not null and l.class_instance_id = v_inst.reschedule_of)));

  -- ADR-018 (regra ratificada em 18/07/2026): crédito e estorno automáticos SÓ
  -- quando a ESCOLA falha (cancelled_by = 'teacher'). Cancelamento pelo aluno
  -- nunca credita nem estorna sozinho, em QUALQUER antecedência — o caminho com
  -- aviso é REMARCAR (franquia); caso especial é decisão humana auditada
  -- (admin_makeup_adjust / estorno formal acionado pelo atendimento).
  if p_cancelled_by = 'teacher' then
    if v_credit_born then
      v_refund := public._refund_for_credit_born_class(p_instance, 'school', p_actor);
      v_expires := v_refund.o_expires;
      v_blocked := v_refund.o_blocked;
      v_credited := v_expires is not null;
    else
      v_expires := public._earn_for_lost_class(p_instance, p_actor, 'school');
      v_credited := true;
    end if;
  end if;

  -- P4: cancelamento unitário AVISA (admin e self); cortesia da aula avulsa não
  -- passa por aqui. Encerramento/pausa/troca de horário cancelam por caminho
  -- direto e seguem silenciosos por construção (deliberado).
  perform public._enqueue_class_cancelled(p_instance, v_credited, v_expires);

  perform public.log_audit(p_actor, 'cancel_class', 'class_instances', p_instance::text,
    jsonb_build_object(
      'cancelled_by', p_cancelled_by,
      'notified_at', p_notified_at,
      'starts_at_utc', v_inst.starts_at_utc,
      'min_notice_hours', v_contract.min_notice_hours,
      'credited', v_credited,
      'credit_born', v_credit_born,
      'refund_blocked', v_blocked,
      'expires_on', v_expires,
      'via', p_via));
end;
$function$;

revoke execute on function public._cancel_class_core(uuid, text, timestamptz, uuid, text)
from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_class_touches()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
           (ci.reschedule_of is not null
            or exists (select 1 from makeup_ledger l
                       where l.class_instance_id = ci.id and l.delta < 0))
             as born_of_student_action,
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
    elsif not v_row.born_of_student_action then
      -- 31c (veredito adversarial): aula que NASCE já dentro da janela de 48h
      -- (ex.: horário fixo criado em cima da hora) recebe o toque ACIONÁVEL na
      -- primeira rodada — EXCETO quando a instância nasceu de ação do próprio
      -- aluno (remarcação/resgate), que já recebe confirmação própria na hora;
      -- sem a guarda, o conserto recriaria o ruído de mensagem dupla (item 21).
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
$function$;

revoke execute on function public.enqueue_class_touches() from public, anon, authenticated;
grant execute on function public.enqueue_class_touches() to service_role;

-- ---------------------------------------------------------------------------
-- ACHADO COLATERAL da rodada noturna da suíte (18/07 ~23h Cuiabá): create_slot
-- usava CURRENT_DATE (data UTC — 1 dia à FRENTE do negócio entre 20h e 24h de
-- Cuiabá) enquanto admin_end_contract fecha slots com business_today() — um
-- contrato criado e encerrado nessa janela violava recurring_slots_check
-- (active_to < active_from). Fonte única de data civil = business_today()
-- (adendo 7/Lei 1); greatest() como cinto no fechamento.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_slot(p_contract uuid, p_weekday integer, p_local_time time without time zone, p_iana_tz text DEFAULT NULL::text, p_duration_min integer DEFAULT 45, p_active_from date DEFAULT public.business_today(), p_actor uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_contract contracts%rowtype;
  v_tz text;
  v_id uuid;
  v_actor uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'create_slot é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_contract from contracts where id = p_contract;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'slots são de contratos private_1on1';
  end if;

  -- P1: individual cai no fuso do aluno; GRUPO exige âncora explícita — o
  -- min(iana_tz) alfabético saiu (a UI oferece o fuso do membro-âncora).
  v_tz := coalesce(
    p_iana_tz,
    (select s.iana_tz from students s where s.id = v_contract.student_id));
  if v_tz is null and v_contract.student_group_id is not null then
    raise exception 'contrato de GRUPO exige a âncora de fuso explícita (p_iana_tz) — P1/M4-1';
  end if;
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA do slot — informe p_iana_tz';
  end if;

  insert into recurring_slots
    (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from)
  values
    (p_contract, v_contract.teacher_id, p_weekday, p_local_time, v_tz, p_duration_min, p_active_from)
  returning id into v_id;

  perform public.materialize_slot(v_id, 8);

  perform public.log_audit(v_actor, 'create_slot', 'recurring_slots', v_id::text,
    jsonb_build_object('contract_id', p_contract, 'weekday', p_weekday,
                       'local_time', p_local_time, 'iana_tz', v_tz,
                       'active_from', p_active_from));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_end_contract(p_contract uuid, p_dest_contract uuid DEFAULT NULL::uuid, p_writeoff_note text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_old contracts%rowtype;
  v_dest contracts%rowtype;
  v_actor uuid;
  v_pending int;
  v_cancelled uuid[] := array[]::uuid[];
  v_slots int := 0;
  v_live record;
  v_transferred int := 0;
  v_writeoff int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_end_contract é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_old from contracts where id = p_contract for update;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_old.contract_type <> 'private_1on1' then
    raise exception 'encerramento estendido é de contratos particulares';
  end if;
  if v_old.status = 'ended' then
    raise exception 'contrato % já está encerrado', p_contract;
  end if;

  -- GATE DURO (M5-3): pendências exigem desfecho antes (o lote M1-3 é o atalho).
  v_pending := public._contract_pending_count(p_contract);
  if v_pending > 0 then
    raise exception 'há % aula(s) passada(s) sem desfecho neste contrato — registre antes (o botão "todas aconteceram" resolve as positivas)', v_pending;
  end if;

  -- destinação obrigatória quando há saldo vivo (escolha EXPLÍCITA)
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || p_contract::text, 0));
  if exists (
    select 1 from public._makeup_remaining_credits(p_contract) rc
    where rc.expires_on >= public.business_today()
  ) then
    if p_dest_contract is null and btrim(coalesce(p_writeoff_note, '')) = '' then
      raise exception 'este contrato tem créditos vivos — transfira para outro contrato do aluno OU dê baixa com motivo';
    end if;
  end if;
  if p_dest_contract is not null then
    select * into v_dest from contracts where id = p_dest_contract for update;
    if not found or v_dest.contract_type <> 'private_1on1' or v_dest.status <> 'active' then
      raise exception 'contrato destino inválido (precisa ser particular ATIVO)';
    end if;
    if p_dest_contract = p_contract then
      raise exception 'destino não pode ser o próprio contrato';
    end if;
    if not public._contracts_same_people(v_old, v_dest) then
      raise exception 'o destino precisa ser do MESMO aluno/grupo (M3-4)';
    end if;
  end if;

  -- futuras saem SEM crédito e SEM aviso (P4: deliberado — conversa humana).
  select coalesce(array_agg(ci.id), array[]::uuid[]) into v_cancelled
  from class_instances ci
  where ci.contract_id = p_contract and ci.state = 'scheduled' and ci.starts_at_utc > now();
  if coalesce(array_length(v_cancelled, 1), 0) > 0 then
    update class_instances set state = 'cancelled' where id = any(v_cancelled);
  end if;

  update recurring_slots
     set active_to = greatest(active_from, public.business_today())
   where contract_id = p_contract
     and (active_to is null or active_to > public.business_today());
  get diagnostics v_slots = row_count;

  -- destinação dos créditos vivos (validade e duração PRESERVADAS — M3-4/P6)
  for v_live in
    select rc.ledger_id, rc.expires_on from public._makeup_remaining_credits(p_contract) rc
    where rc.expires_on >= public.business_today()
    order by rc.ord
  loop
    if p_dest_contract is not null then
      perform public._reissue_credit(v_live.ledger_id, v_live.expires_on, v_actor,
        'encerramento: crédito transferido', p_dest_contract);
      v_transferred := v_transferred + 1;
    else
      insert into makeup_ledger
        (contract_id, student_id, delta, reason, consumes_ledger_id, note, created_by)
      values
        (p_contract, v_old.student_id, -1, 'manual_adjust', v_live.ledger_id,
         'encerramento: baixa — ' || p_writeoff_note, v_actor);
      v_writeoff := v_writeoff + 1;
    end if;
  end loop;

  -- greatest: contrato com started_on futuro nunca viola o CHECK ended>=started
  update contracts
     set status = 'ended', ended_on = greatest(public.business_today(), started_on)
   where id = p_contract;

  perform public.log_audit(v_actor, 'end_contract', 'contracts', p_contract::text,
    jsonb_build_object(
      'razao', 'encerramento',
      'cancelled_instances', to_jsonb(v_cancelled),
      'slots_closed', v_slots,
      'credits_transferred', v_transferred,
      'credits_written_off', v_writeoff,
      'dest_contract', p_dest_contract,
      'writeoff_note', p_writeoff_note));

  return jsonb_build_object('cancelled', coalesce(array_length(v_cancelled, 1), 0),
                            'slots_closed', v_slots,
                            'transferred', v_transferred, 'written_off', v_writeoff);
end;
$function$;
revoke execute on function public.admin_end_contract(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.admin_end_contract(uuid, uuid, text, uuid) to authenticated;
