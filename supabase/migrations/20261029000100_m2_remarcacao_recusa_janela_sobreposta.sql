-- =============================================================================
-- Onda Agenda e Mensagens · M2, correção do gate local (29/10/2026) — a
-- remarcação pela professora recusa horário de reposição publicado que se
-- SOBREPÕE ao destino, não só o que começa no mesmo minuto.
--
-- Achado do gate de deploy da 118 (ADR-040, primeiro uso): a recusa "destino
-- com horário publicado dela" comparava `w.starts_at_utc = p_starts_at_utc`.
-- Aula movida para 10:30 com janela publicada às 10:00 passava; o aluno que
-- depois tentava reservar a janela batia no índice de exclusão da agenda e
-- recebia erro genérico. A regra do goal é "despublique antes": vale para
-- qualquer janela que a aula nova encoste.
--
-- A janela publicada não guarda duração (quem reserva traz a do próprio slot).
-- Para decidir o encosto, a janela é medida com a duração da aula que está
-- sendo movida (45–60 min, padrão da casa): recusa quando os dois intervalos se
-- cruzam. Recusar a mais é seguro (a professora despublica ou escolhe outro
-- horário); deixar passar é o defeito que esta migration fecha.
--
-- Lei 7: a 118 já está aplicada (CI, bancadas) e fica como está; esta
-- recria a função inteira, mudando SÓ a condição da janela. Assinatura igual,
-- ACL repetida nominalmente (tests/acl-higiene.test.ts).
-- =============================================================================

create or replace function public.teacher_reschedule_own_class(
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

  -- Destino que ENCOSTA em horário de reposição PUBLICADO dela: recusa
  -- explícita (goal: despublicar antes). ALTERADO (gate da 118, 29/10/2026):
  -- antes só o começo igual era recusado; agora qualquer janela cujo intervalo
  -- cruze o da aula nova. A janela não guarda duração — é medida com a da aula
  -- movida (v_dur), que é a duração padrão da casa; recusar a mais é seguro.
  if exists (
    select 1 from reschedule_windows w
     where w.teacher_id = v_teacher and w.state = 'publicada'
       and w.starts_at_utc < p_starts_at_utc + v_dur
       and w.starts_at_utc + v_dur > p_starts_at_utc
  ) then
    raise exception 'esse horário encosta num horário publicado para reposição — despublique antes ou escolha outro';
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
  'M2 (01/09/2026; janela sobreposta 29/10/2026): a professora remarca a PRÓPRIA aula para '
  'horário livre para os dois (disponibilidade dela, sem bloqueio, sem aula sobreposta, sem '
  'horário de reposição publicado que encoste), SEM consumir a alçada do aluno (school_move). '
  'Motivo obrigatório; aluno avisado; aviso interno à administração.';
