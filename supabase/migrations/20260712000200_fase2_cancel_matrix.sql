-- Fase 2 / M1.2 — Matriz de cancelamento/no-show (D2, confirmada linha a linha).
-- Quem decide crédito × perda é O BANCO (Lei 3): a admin informa QUEM e QUANDO avisou;
-- a função compara notified_at × starts_at_utc × min_notice_hours. Crédito nasce com
-- expiração pela D11: data civil LOCAL da aula perdida + makeup_credit_expiry_days
-- (semântica fim-de-dia do ADR-008 §12 — makeup_balance ignora após a data, no fuso
-- do negócio). Invocação admin-only (D10); aluno pede pelo canal humano nesta fase.

-- Helper interno: efeito comum de "aluno ganha crédito pela aula perdida".
create or replace function public._earn_for_lost_class(
  p_instance uuid,
  p_actor uuid
) returns date
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst class_instances%rowtype;
  v_contract contracts%rowtype;
  v_tz text;
  v_local_date date;
  v_expires date;
begin
  select * into v_inst from class_instances where id = p_instance;
  select * into v_contract from contracts where id = v_inst.contract_id;

  v_tz := public.class_instance_tz(p_instance);
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA da instância %', p_instance;
  end if;
  -- D11: âncora = data civil LOCAL da aula perdida (occurrence_date; fallback: instante
  -- na zona do slot). Determinística — independe de atraso no registro.
  v_local_date := coalesce(v_inst.occurrence_date, (v_inst.starts_at_utc at time zone v_tz)::date);
  v_expires := v_local_date + v_contract.makeup_credit_expiry_days;

  perform public.earn_makeup(
    v_contract.id, 'earn_cancellation', v_expires, v_contract.student_id, p_instance, p_actor);
  return v_expires;
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_class: professora cancela → crédito SEMPRE (o aviso mínimo só condiciona o
-- cancelamento do ALUNO); aluno COM aviso → crédito; SEM aviso → perde a aula.
-- Fronteira exata do aviso = COM aviso (mesma comparação de reschedule_class).
-- Só sobre aula futura: aula já iniciada é território do no-show.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_class(
  p_instance uuid,
  p_cancelled_by text,
  p_notified_at timestamptz default now(),
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst class_instances%rowtype;
  v_contract contracts%rowtype;
  v_actor uuid;
  v_credited boolean := false;
  v_expires date;
begin
  if public.app_role() <> 'admin' then
    raise exception 'cancel_class é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

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
  -- Registro retroativo é permitido DESDE QUE o aviso tenha precedido a aula (D2: quem
  -- decide é notified_at × starts × min_notice, não o momento do registro — a dona
  -- pode registrar depois). Aviso inexistente/pós-início = território do no-show.
  if now() >= v_inst.starts_at_utc and p_notified_at >= v_inst.starts_at_utc then
    raise exception 'aula % já começou e o aviso não a precedeu — use no_show_student/no_show_teacher', p_instance;
  end if;

  select * into v_contract from contracts where id = v_inst.contract_id for update;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'cancel_class só se aplica a contratos private_1on1';
  end if;

  update class_instances set state = 'cancelled' where id = p_instance;

  if p_cancelled_by = 'teacher'
     or p_notified_at <= v_inst.starts_at_utc - make_interval(hours => v_contract.min_notice_hours)
  then
    v_expires := public._earn_for_lost_class(p_instance, v_actor);
    v_credited := true;
  end if;

  perform public.log_audit(v_actor, 'cancel_class', 'class_instances', p_instance::text,
    jsonb_build_object(
      'cancelled_by', p_cancelled_by,
      'notified_at', p_notified_at,
      'starts_at_utc', v_inst.starts_at_utc,
      'min_notice_hours', v_contract.min_notice_hours,
      'credited', v_credited,
      'expires_on', v_expires));
end;
$$;

-- ---------------------------------------------------------------------------
-- No-show: retrospectivo por definição — só sobre 'scheduled' e SÓ APÓS o início.
-- Aluno faltou → perde. Professora faltou → aluno ganha crédito.
-- ---------------------------------------------------------------------------
create or replace function public._mark_no_show(
  p_instance uuid,
  p_who text,  -- 'student' | 'teacher'
  p_actor uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst class_instances%rowtype;
  v_contract contracts%rowtype;
  v_credited boolean := false;
  v_expires date;
begin
  select * into v_inst from class_instances where id = p_instance for update;
  if not found then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_inst.state <> 'scheduled' then
    raise exception 'instância % não está agendada (estado: %)', p_instance, v_inst.state;
  end if;
  if now() <= v_inst.starts_at_utc then
    raise exception 'aula % ainda não começou (%) — no-show é retrospectivo', p_instance, v_inst.starts_at_utc;
  end if;

  select * into v_contract from contracts where id = v_inst.contract_id for update;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'no-show só se aplica a contratos private_1on1';
  end if;

  if p_who = 'student' then
    update class_instances set state = 'no_show_student' where id = p_instance;
  else
    update class_instances set state = 'no_show_teacher' where id = p_instance;
    v_expires := public._earn_for_lost_class(p_instance, p_actor);
    v_credited := true;
  end if;

  perform public.log_audit(p_actor, 'no_show_' || p_who, 'class_instances', p_instance::text,
    jsonb_build_object('credited', v_credited, 'expires_on', v_expires,
                       'starts_at_utc', v_inst.starts_at_utc));
end;
$$;

create or replace function public.no_show_student(p_instance uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.app_role() <> 'admin' then
    raise exception 'no_show_student é restrita à admin (D10)';
  end if;
  perform public._mark_no_show(p_instance, 'student', coalesce(auth.uid(), p_actor));
end;
$$;

create or replace function public.no_show_teacher(p_instance uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.app_role() <> 'admin' then
    raise exception 'no_show_teacher é restrita à admin (D10)';
  end if;
  perform public._mark_no_show(p_instance, 'teacher', coalesce(auth.uid(), p_actor));
end;
$$;

-- Exposição (ADR-010 §2): helpers internos revogados de todos; superfícies admin
-- chamáveis por authenticated (o check de papel vive DENTRO — D10).
revoke execute on function
  public._earn_for_lost_class(uuid, uuid),
  public._mark_no_show(uuid, text, uuid),
  public.cancel_class(uuid, text, timestamptz, uuid),
  public.no_show_student(uuid, uuid),
  public.no_show_teacher(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.cancel_class(uuid, text, timestamptz, uuid),
  public.no_show_student(uuid, uuid),
  public.no_show_teacher(uuid, uuid)
to authenticated;
