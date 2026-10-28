-- Núcleo 4/5 / N1 — class_audits sai do esqueleto: escrita SÓ por RPC (N45-D1).
-- Goal: docs/goals/nucleo-fases-4-5.md. A tabela existe desde a F1
-- (20260711000200_core.sql:304-313, UNIQUE em class_instance_id); as policies de
-- LEITURA da F1 (class_audits_teacher + admin_all, 20260711000700_rls.sql) são
-- MANTIDAS — nenhuma policy nova (criar outra duplicaria class_audits_teacher).
--
-- O pipeline Whisper+Claude (Fase 4) roda FORA do app e entrega o resultado ao
-- servidor Next, que grava via esta RPC (service_role); a admin também pode
-- gravar/corrigir. Re-auditar substitui (upsert), com o resultado anterior
-- preservado no audit_log (Lei 8).

-- ---------------------------------------------------------------------------
-- Escrita direta barrada em nível de PRIVILÉGIO (mecanismo ADR-012/D10): a F1
-- concedeu insert/update/delete amplos a authenticated (rls.sql §grants) — sem
-- este revoke, um JWT admin poderia escrever por fora da RPC (sem histórico no
-- audit_log). Leitura (SELECT) permanece intacta.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on class_audits from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- record_class_audit — upsert por class_instance_id (N45-D1).
-- Estados aceitos: scheduled (aula dada FICA scheduled — nada marca completed;
-- a régua F3 paga past-scheduled), completed, no_show_student e no_show_teacher
-- (C5 confirmada 13/07/2026: a auditoria é a evidência do que houve; a régua
-- nunca paga no_show_teacher, então não há risco de dinheiro).
-- Rejeitados: cancelled e rescheduled (instância morta/substituída —
-- reschedule_class marca a original como rescheduled e a aula vive na instância
-- nova; auditá-la seria dupla contagem na futura "hora auditada") e instância
-- FUTURA (ends_at_utc > now(): o pipeline processa gravação, que só existe
-- pós-aula).
-- ---------------------------------------------------------------------------
create or replace function public.record_class_audit(
  p_class_instance uuid,
  p_checklist jsonb,
  p_passed boolean,
  p_audited_duration_min int default null,
  p_model text default null,
  p_raw_transcript_ref text default null,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst class_instances%rowtype;
  v_old class_audits%rowtype;
  v_actor uuid;
  v_id uuid;
begin
  -- Chamador misto (N45-D1/D5): service_role (pipeline via servidor) OU admin.
  if not ((auth.jwt() ->> 'role') = 'service_role' or public.app_role() = 'admin') then
    raise exception 'record_class_audit é restrita a service_role ou admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  if p_checklist is null then
    raise exception 'p_checklist é obrigatório (NOT NULL no schema)';
  end if;
  if p_passed is null then
    raise exception 'p_passed é obrigatório (NOT NULL no schema)';
  end if;
  if p_audited_duration_min is not null and p_audited_duration_min <= 0 then
    raise exception 'p_audited_duration_min deve ser positivo (recebido: %)', p_audited_duration_min;
  end if;

  select * into v_inst from class_instances where id = p_class_instance;
  if not found then
    raise exception 'instância % não existe', p_class_instance;
  end if;
  if v_inst.state in ('cancelled', 'rescheduled') then
    raise exception 'instância % está % — não auditável (aula morta/substituída; auditar duplicaria a hora)',
      p_class_instance, v_inst.state;
  end if;
  if v_inst.ends_at_utc > now() then
    raise exception 'instância % ainda não terminou (%) — auditoria só pós-aula',
      p_class_instance, v_inst.ends_at_utc;
  end if;

  -- Serializa re-auditorias concorrentes da MESMA instância: o upsert é atômico,
  -- mas o snapshot "resultado anterior" do audit_log precisa ser o verdadeiro.
  perform pg_advisory_xact_lock(hashtextextended('class_audit:' || p_class_instance::text, 0));

  select * into v_old from class_audits where class_instance_id = p_class_instance;

  insert into class_audits
    (class_instance_id, checklist, passed, audited_duration_min, model, raw_transcript_ref)
  values
    (p_class_instance, p_checklist, p_passed, p_audited_duration_min, p_model, p_raw_transcript_ref)
  on conflict (class_instance_id) do update
    set checklist = excluded.checklist,
        passed = excluded.passed,
        audited_duration_min = excluded.audited_duration_min,
        model = excluded.model,
        raw_transcript_ref = excluded.raw_transcript_ref,
        created_at = now()
  returning id into v_id;

  -- Lei 8: re-auditoria preserva o resultado substituído.
  perform public.log_audit(v_actor, 'record_class_audit', 'class_audits', v_id::text,
    jsonb_build_object(
      'class_instance_id', p_class_instance,
      'instance_state', v_inst.state,
      'passed', p_passed,
      'model', p_model,
      'previous', case when v_old.id is null then null else to_jsonb(v_old) end));

  return v_id;
end;
$$;

revoke execute on function
  public.record_class_audit(uuid, jsonb, boolean, int, text, text, uuid)
from public, anon, authenticated;
grant execute on function
  public.record_class_audit(uuid, jsonb, boolean, int, text, text, uuid)
to authenticated, service_role;
