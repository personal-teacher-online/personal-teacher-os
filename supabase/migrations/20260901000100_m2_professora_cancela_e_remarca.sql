-- =============================================================================
-- Onda Agenda e Mensagens · M2 (01/09/2026) — a professora cancela e remarca a
-- PRÓPRIA aula pelo painel dela.
--
-- Decisões do dono (goal docs/goals/onda-agenda-e-mensagens.md):
--   1. cancelar: motivo obrigatório + aviso automático à administração; o
--      crédito ao aluno segue a regra do banco (cancelled_by = 'teacher' ⇒
--      falha da escola ⇒ crédito, ADR-018);
--   2. remarcar: só para horário livre para os dois (disponibilidade dela,
--      sem aula, sem bloqueio), SEM consumir a alçada mensal do aluno.
--
-- NADA aqui cria regra nova de dinheiro. _cancel_class_core já modela o
-- cancelamento pela professora e reschedule_class_at já tem o modo "nada
-- consumido" (cortesia). O que nasce é a PORTA para o papel teacher — com a
-- posse conferida por my_teacher_id() (a dona, admin vinculada, entra pela
-- mesma porta) — e dois avisos internos por e-mail.
--
-- Assumido e registrado no goal: (a) a professora é avisada sempre que a aula
-- dela é cancelada por outra pessoa (aluno ou administração); (b) destino que
-- tenha horário de reposição PUBLICADO dela é recusado (despublicar antes),
-- em vez de absorvido em silêncio.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. reschedule_class_at ganha p_school_move (assinatura nova ⇒ DROP + CREATE;
--    os chamadores passam 7 argumentos por posição e seguem válidos).
-- -----------------------------------------------------------------------------
drop function public.reschedule_class_at(uuid, timestamptz, text, uuid, boolean, text, boolean);
CREATE OR REPLACE FUNCTION public.reschedule_class_at(p_instance uuid, p_new_starts_utc timestamp with time zone, p_new_snapshot text, p_actor uuid DEFAULT NULL::uuid, p_courtesy boolean DEFAULT false, p_courtesy_note text DEFAULT NULL::text, p_bypass_lead boolean DEFAULT false, p_school_move boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_old class_instances%rowtype;
  v_contract contracts%rowtype;
  v_contract_id uuid;
  v_tz text;
  v_duration interval;
  v_orig_local_date date;
  v_period text;
  v_used int;
  v_via text;
  v_new_id uuid;
  v_lead int;
begin
  -- Cortesia é privilégio (M1-6). O bypass_lead NÃO é checado aqui: esta função
  -- é interna (revogada de clientes) e book_reschedule_window passa true após
  -- checar a antecedência sobre a JANELA — o check de papel do bypass vive nas
  -- superfícies chamáveis.
  if p_courtesy and public.app_role() <> 'admin' then
    raise exception 'cortesia é só da administração (D10)';
  end if;
  if (p_courtesy or p_school_move) and btrim(coalesce(p_courtesy_note, '')) = '' then
    raise exception 'cortesia exige motivo (M1-6)';
  end if;

  -- ALTERADO (c8 · R1): ordem canônica — contrato, depois instância. Quando
  -- `book_reschedule_window` chama, a linha do contrato JÁ está travada por ela
  -- (mesmo lock, mesma transação: repetir é barato e mantém esta função correta
  -- também quando chamada direto).
  select ci.contract_id into v_contract_id from class_instances ci where ci.id = p_instance;
  perform 1 from contracts where id = v_contract_id for update;
  select * into v_old from class_instances where id = p_instance for update;
  if not found then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_old.state <> 'scheduled' then
    raise exception 'instância % não está agendada (estado atual: %)', p_instance, v_old.state;
  end if;

  select * into v_contract from contracts where id = v_old.contract_id;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'reschedule_class só se aplica a contratos private_1on1';
  end if;
  if v_contract.status <> 'active' then
    raise exception 'contrato % não está ativo — remarcação bloqueada', v_contract.id;
  end if;

  -- Aviso mínimo sobre a aula ORIGINAL (intocado — o bypass fura SÓ a antecedência).
  if now() > v_old.starts_at_utc - make_interval(hours => v_contract.min_notice_hours) then
    raise exception 'remarcação exige % h de aviso mínimo (aula começa em %)',
      v_contract.min_notice_hours, v_old.starts_at_utc;
  end if;

  if p_new_starts_utc <= now() then
    raise exception 'nova data/hora da remarcação já passou (%)', p_new_starts_utc;
  end if;

  -- M2-1: antecedência mínima no DESTINO, por professora.
  select t.min_booking_lead_hours into v_lead from teachers t where t.id = v_old.teacher_id;
  if not p_bypass_lead
     and p_new_starts_utc < now() + make_interval(hours => coalesce(v_lead, 12)) then
    raise exception 'o novo horário exige % h de antecedência — escolha um horário mais à frente',
      coalesce(v_lead, 12);
  end if;

  v_tz := public.class_instance_tz(p_instance);
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA da remarcação do contrato %', v_contract.id;
  end if;

  v_duration := v_old.ends_at_utc - v_old.starts_at_utc;

  v_orig_local_date := coalesce(v_old.occurrence_date, (v_old.starts_at_utc at time zone v_tz)::date);
  v_period := to_char(v_orig_local_date, 'YYYY-MM');

  if p_school_move then
    -- M2: a escola moveu — mesma mecânica da cortesia (nada consumido), com a
    -- SUA voz no audit para o extrato e os e-mails distinguirem.
    v_via := 'teacher';
  elsif p_courtesy then
    -- M1-6: cortesia NÃO consome franquia nem crédito; o contador mensal é
    -- derivado do audit (via = courtesy), nunca materializado.
    v_via := 'courtesy';
  else
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
      perform public.spend_makeup(v_contract.id, 'spend_reschedule', v_contract.student_id, p_instance, p_actor);
      v_via := 'makeup_credit';
    end if;
  end if;

  update class_instances set state = 'rescheduled' where id = p_instance;

  insert into class_instances
    (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
     local_time_snapshot, state, reschedule_of)
  values
    (v_contract.id, v_old.teacher_id, null, null, p_new_starts_utc, p_new_starts_utc + v_duration,
     p_new_snapshot, 'scheduled', p_instance)
  returning id into v_new_id;

  perform public.log_audit(p_actor, 'reschedule_class', 'class_instances', v_new_id::text,
    jsonb_build_object(
      'rescheduled_from', p_instance,
      'contract_id', v_contract.id,
      'old_starts_at_utc', v_old.starts_at_utc,
      'new_starts_at_utc', p_new_starts_utc,
      'iana_tz', v_tz,
      'via', v_via,
      'courtesy_note', p_courtesy_note,
      'bypass_lead', p_bypass_lead,
      'school_move', p_school_move,
      'period_ym', v_period));

  return v_new_id;
end;
$function$;
-- M2 (01/09/2026): p_school_move — a ESCOLA move a aula (professora pelo painel
-- dela): sem alçada do aluno, sem crédito, via = 'teacher'. A posse é conferida
-- por quem chama (teacher_reschedule_own_class); esta função segue interna.
revoke execute on function
  public.reschedule_class_at(uuid, timestamptz, text, uuid, boolean, text, boolean, boolean)
from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Avisos internos (só e-mail; o despachante não tem versão WhatsApp destes
--    templates — linha de WhatsApp com eles fica PRESA e visível em Avisos).
-- -----------------------------------------------------------------------------

-- 2a. Para a PROFESSORA: a aula dela foi cancelada por outra pessoa.
create function public._enqueue_class_cancelled_teacher(
  p_instance uuid,
  p_cancelled_by text,
  p_via text,
  p_actor uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
  select 'email', 'class-cancelled-teacher', t.profile_id,
         jsonb_build_object(
           'instance_id', p_instance,
           'cancelled_by', p_cancelled_by,
           'via', p_via,
           'teacher_id', t.id,
           'teacher_tz', t.iana_tz,
           'student_name', coalesce(s.display_name, g.label, 'aluno'),
           'starts_at_utc', ci.starts_at_utc),
         format('class-cancelled-teacher:%s', p_instance)
    from class_instances ci
    join teachers t on t.id = ci.teacher_id
    join contracts c on c.id = ci.contract_id
    left join students s on s.id = c.student_id
    left join student_groups g on g.id = c.student_group_id
   where ci.id = p_instance
     and t.profile_id is not null
     and (p_actor is null or t.profile_id <> p_actor)
  on conflict (dedupe_key) do nothing;
end;
$fn$;
revoke execute on function public._enqueue_class_cancelled_teacher(uuid, text, text, uuid)
  from public, anon, authenticated;

-- 2b. Para a ADMINISTRAÇÃO: a professora cancelou ou remarcou a própria aula.
--     Destinatários = todo perfil admin, menos quem fez (a dona, quando age
--     como professora, não avisa a si mesma).
--     Gate Sol (26/10): o cancelamento leva o DESFECHO medido pelo miolo
--     (credited / refund_blocked / expires_on) — o e-mail diz o que aconteceu
--     com o crédito, nunca o presume.
create function public._enqueue_teacher_class_changed(
  p_instance uuid,
  p_kind text,
  p_reason text,
  p_new_instance uuid,
  p_actor uuid,
  p_outcome jsonb default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_kind not in ('cancelled', 'rescheduled') then
    raise exception 'p_kind deve ser cancelled ou rescheduled (recebido: %)', p_kind;
  end if;
  insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
  select 'email', 'teacher-class-changed', p.id,
         jsonb_build_object(
           'instance_id', p_instance,
           'kind', p_kind,
           'reason', p_reason,
           'teacher_id', t.id,
           'teacher_name', t.display_name,
           'teacher_tz', t.iana_tz,
           'student_name', coalesce(s.display_name, g.label, 'aluno'),
           'old_starts_at_utc', ci.starts_at_utc,
           'new_starts_at_utc', n.starts_at_utc,
           'credited', p_outcome -> 'credited',
           'refund_blocked', p_outcome -> 'refund_blocked',
           'expires_on', p_outcome -> 'expires_on'),
         format('teacher-class-changed:%s:%s:%s', p_kind, p_instance, p.id)
    from class_instances ci
    join teachers t on t.id = ci.teacher_id
    join contracts c on c.id = ci.contract_id
    left join students s on s.id = c.student_id
    left join student_groups g on g.id = c.student_group_id
    left join class_instances n on n.id = p_new_instance
    cross join profiles p
   where ci.id = p_instance
     and p.role = 'admin'
     and (p_actor is null or p.id <> p_actor)
  on conflict (dedupe_key) do nothing;
end;
$fn$;
revoke execute on function public._enqueue_teacher_class_changed(uuid, text, text, uuid, uuid, jsonb)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. _cancel_class_core recriado (mesma assinatura): uma chamada a mais, o
--    aviso à professora quando não foi ela quem cancelou. ACL reemitida.
-- -----------------------------------------------------------------------------
create or replace function public._cancel_class_core(
  p_instance uuid,
  p_cancelled_by text,
  p_notified_at timestamptz,
  p_actor uuid,
  p_via text,
  p_notify_email boolean default true,
  p_notify_whatsapp boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_inst class_instances%rowtype;
  v_contract contracts%rowtype;
  v_contract_id uuid;
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

  -- ALTERADO (c8 · R1): ordem canônica — 1º a linha do CONTRATO, 2º a da
  -- instância. `contract_id` de uma instância nunca muda, então a pré-leitura
  -- sem lock é só o endereço do lock; o estado que decide é o relido abaixo.
  select ci.contract_id into v_contract_id from class_instances ci where ci.id = p_instance;
  perform 1 from contracts where id = v_contract_id for update;
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

  select * into v_contract from contracts where id = v_inst.contract_id;
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
  -- ALTERADO (A6/lote 2): a chamada continua FORA de qualquer `if` — o que
  -- muda é que ela carrega a ESCOLHA de canais. Com os defaults (os dois
  -- ligados) o efeito é o de sempre; quem desliga um canal está dizendo isso
  -- explicitamente, e fica no audit logo abaixo.
  perform public._enqueue_class_cancelled(p_instance, v_credited, v_expires, p_notify_email, p_notify_whatsapp);
  -- M2 (01/09/2026): a PROFESSORA é avisada quando OUTRA pessoa cancela a aula
  -- dela (aluno pelo portal, administração). Quando ela mesma cancela
  -- (via = 'teacher'), não recebe. Só e-mail; não depende dos flags do aluno.
  if p_via <> 'teacher' then
    perform public._enqueue_class_cancelled_teacher(p_instance, p_cancelled_by, p_via, p_actor);
  end if;

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
      -- ACRESCENTADO (A6/lote 2 · Lei 8): a decisão de NÃO avisar o aluno é um
      -- ato sobre a relação com ele — daqui a seis meses, "por que ele não
      -- soube?" tem de ter resposta na trilha, e não na memória de alguém.
      'notify_email', p_notify_email,
      'notify_whatsapp', p_notify_whatsapp,
      'via', p_via));

  -- ACRESCENTADO (A6/lote 2): o desfecho volta para quem chamou, na mesma
  -- transação. São EXATAMENTE os três valores que o audit acabou de gravar —
  -- nenhuma conta nova, nenhuma fonte nova.
  return jsonb_build_object(
    'credited', v_credited,
    'refund_blocked', v_blocked,
    'expires_on', v_expires);
end;
$fn$;
revoke execute on function public._cancel_class_core(uuid, text, timestamptz, uuid, text, boolean, boolean)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. enqueue_reschedule_confirmation recriada: a professora da aula também
--    enfileira a confirmação por WhatsApp ao aluno. ACL reemitida.
-- -----------------------------------------------------------------------------
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
          or v_contract in (select public.my_contract_ids())
          -- M2 (01/09/2026): a PROFESSORA da aula também enfileira — é a RPC
          -- teacher_reschedule_own_class que chama, depois de conferir a posse.
          -- Gate Sol (26/10): só com papel de professora e só para aula que É
          -- uma remarcação — numa aula comum o WhatsApp diria "reposição
          -- agendada" sem nada ter mudado.
          or (coalesce(public.app_role(), '') in ('teacher', 'admin')
              and exists (select 1 from class_instances ci2
                           where ci2.id = p_instance
                             and ci2.reschedule_of is not null
                             and ci2.state = 'scheduled'
                             and ci2.starts_at_utc > now()
                             and ci2.teacher_id = public.my_teacher_id()))) then
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
revoke execute on function public.enqueue_reschedule_confirmation(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_reschedule_confirmation(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. As duas PORTAS da professora.
-- -----------------------------------------------------------------------------

-- 5a. Cancelar a própria aula. Devolve o mesmo jsonb da admin (credited /
--     refund_blocked / expires_on) para a frase da tela ser MEDIDA.
create function public.teacher_cancel_own_class(
  p_instance uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_teacher uuid;
  v_owner uuid;
  v_res jsonb;
begin
  -- Gate Sol (26/10): o PAPEL vem antes do vínculo, como em teacher_agenda —
  -- um aluno ligado por engano a teachers.profile_id não passa.
  if coalesce(public.app_role(), '') not in ('teacher', 'admin') then
    raise exception 'só a professora ou a administração usa esta porta (D10)';
  end if;
  v_teacher := public.my_teacher_id();
  if v_teacher is null then
    raise exception 'sua conta não está vinculada a uma professora (D10)';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'o cancelamento pela professora exige motivo';
  end if;
  if length(p_reason) > 500 then
    raise exception 'motivo longo demais (máximo 500 caracteres)';
  end if;
  select ci.teacher_id into v_owner from class_instances ci where ci.id = p_instance;
  if v_owner is null then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_owner <> v_teacher then
    raise exception 'essa aula não é sua (D10)';
  end if;

  -- O miolo decide dinheiro (ADR-018), avisa o aluno e audita 'cancel_class'
  -- com via = 'teacher'. O aviso à própria professora não nasce (via).
  v_res := public._cancel_class_core(p_instance, 'teacher', now(), auth.uid(), 'teacher', true, true);

  perform public._enqueue_teacher_class_changed(p_instance, 'cancelled', p_reason, null, auth.uid(), v_res);

  -- Lei 8: o MOTIVO fica na trilha, ao lado do desfecho que o miolo gravou.
  perform public.log_audit(auth.uid(), 'teacher_cancel_own_class', 'class_instances', p_instance::text,
    jsonb_build_object('reason', p_reason) || v_res);

  return v_res;
end;
$fn$;
revoke execute on function public.teacher_cancel_own_class(uuid, text) from public, anon;
grant execute on function public.teacher_cancel_own_class(uuid, text) to authenticated;
comment on function public.teacher_cancel_own_class(uuid, text) is
  'M2 (01/09/2026): a professora cancela a PRÓPRIA aula. Posse por my_teacher_id(); '
  'motivo obrigatório (vai para a administração, não para o aluno); crédito ao aluno '
  'pela regra do miolo (falha da escola); aviso interno à administração.';

-- 5b. Remarcar a própria aula para horário livre para os dois, sem alçada.
create function public.teacher_reschedule_own_class(
  p_instance uuid,
  p_starts_at_utc timestamptz,
  p_reason text,
  p_google_degraded boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_teacher uuid;
  v_inst class_instances%rowtype;
  v_dur interval;
  v_tz text;
  v_local timestamp;
  v_new uuid;
  v_contract_id uuid;
  v_owner uuid;
begin
  -- Gate Sol (26/10): papel antes do vínculo (ver teacher_cancel_own_class).
  if coalesce(public.app_role(), '') not in ('teacher', 'admin') then
    raise exception 'só a professora ou a administração usa esta porta (D10)';
  end if;
  v_teacher := public.my_teacher_id();
  if v_teacher is null then
    raise exception 'sua conta não está vinculada a uma professora (D10)';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'a remarcação pela professora exige motivo';
  end if;
  if length(p_reason) > 500 then
    raise exception 'motivo longo demais (máximo 500 caracteres)';
  end if;
  if p_starts_at_utc is null then
    raise exception 'informe o novo horário';
  end if;

  -- Gate Sol (26/10): ordem canônica global (cabeçalho de 20260727000700 e do
  -- A6) — 1º contrato, 2º instância, 5º o advisory `teacher_agenda` — e SÓ
  -- DEPOIS as leituras de janela publicada e disponibilidade. Lidas antes da
  -- trava, um bloqueio ou uma janela criados no mesmo segundo passavam. As
  -- travas são reentrantes: reschedule_class_at e o gatilho
  -- class_instances_horario_em_pausa pedem as mesmas, na mesma ordem. O
  -- school_move não chama spend_makeup, então `makeup_spend` não entra.
  -- A posse é conferida ANTES de travar (sem lock: só recusa — aula alheia
  -- nunca fica travada por quem não é dona) e de novo depois, sobre a linha
  -- travada, que é a que decide.
  select ci.contract_id, ci.teacher_id into v_contract_id, v_owner
    from class_instances ci where ci.id = p_instance;
  if v_contract_id is null then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_owner <> v_teacher then
    raise exception 'essa aula não é sua (D10)';
  end if;
  perform 1 from contracts where id = v_contract_id for update;
  select * into v_inst from class_instances where id = p_instance for update;
  if v_inst.teacher_id <> v_teacher then
    raise exception 'essa aula não é sua (D10)';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('teacher_agenda:' || v_teacher::text, 0));
  if v_inst.state <> 'scheduled' then
    raise exception 'instância % não está agendada (estado atual: %)', p_instance, v_inst.state;
  end if;
  v_dur := v_inst.ends_at_utc - v_inst.starts_at_utc;

  -- Gate Sol (26/10): o teto da grade é regra, não só tela (Lei 3). Mesma
  -- régua do slot-picker (`HORIZON_DAYS = 14` em computed-slots.ts): o FIM do
  -- destino cabe nas próximas 2 semanas.
  if p_starts_at_utc + v_dur > now() + interval '14 days' then
    raise exception 'o novo horário precisa caber nas próximas 2 semanas';
  end if;

  -- Destino com horário de reposição PUBLICADO dela: recusa explícita (goal).
  if exists (
    select 1 from reschedule_windows w
     where w.teacher_id = v_teacher and w.state = 'publicada'
       and w.starts_at_utc = p_starts_at_utc
  ) then
    raise exception 'esse horário está publicado para reposição — despublique antes ou escolha outro';
  end if;

  -- "Livre para os dois": a camada de disponibilidade do banco (agenda semanal
  -- + aberturas − bloqueios). Aula sobreposta é recusada pelo índice de
  -- exclusão da própria tabela ao inserir a instância nova.
  if not public._teacher_available_for(v_teacher, p_starts_at_utc, p_starts_at_utc + v_dur) then
    raise exception 'você não está disponível nesse horário — escolha outro';
  end if;

  -- O snapshot civil é o do ALUNO (zona da instância), como em reschedule_class.
  v_tz := public.class_instance_tz(p_instance);
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA da instância %', p_instance;
  end if;
  v_local := p_starts_at_utc at time zone v_tz;

  v_new := public.reschedule_class_at(
    p_instance, p_starts_at_utc,
    to_char(v_local, 'YYYY-MM-DD HH24:MI') || ' ' || v_tz,
    auth.uid(),
    false, p_reason,   -- não é cortesia da admin; o motivo viaja no mesmo campo
    false,             -- antecedência do destino vale para a escola também
    true);             -- school_move: nada consumido, via = 'teacher'

  perform public.enqueue_reschedule_confirmation(v_new);
  perform public._enqueue_teacher_class_changed(p_instance, 'rescheduled', p_reason, v_new, auth.uid());

  perform public.log_audit(auth.uid(), 'teacher_reschedule_own_class', 'class_instances', v_new::text,
    jsonb_build_object(
      'rescheduled_from', p_instance,
      'reason', p_reason,
      'google_degraded', p_google_degraded));

  return v_new;
end;
$fn$;
revoke execute on function public.teacher_reschedule_own_class(uuid, timestamptz, text, boolean) from public, anon;
grant execute on function public.teacher_reschedule_own_class(uuid, timestamptz, text, boolean) to authenticated;
comment on function public.teacher_reschedule_own_class(uuid, timestamptz, text, boolean) is
  'M2 (01/09/2026): a professora remarca a PRÓPRIA aula para horário livre para os dois '
  '(disponibilidade dela, sem bloqueio, sem aula sobreposta), SEM consumir a alçada do '
  'aluno (school_move). Motivo obrigatório; aluno avisado; aviso interno à administração.';
