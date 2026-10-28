-- M2+M3 do cronograma (decisões do mantenedor, madrugada 19→20/07/2026):
--   D1: SEMESTRE do plano conta do started_on do CONTRATO (blocos de 6 meses).
--   D2: apontamento de conteúdo OBRIGATÓRIO no registro de aula realizada —
--       módulo do plano OU tema avulso (revisão/prova/extra/conversação).
--   Pagamento: régua provisória do extrato INALTERADA aqui — a troca é para a
--   hora AUDITADA (gravação/transcrição do Meet), quando o motor ligar (gate
--   CHAVES); confirmado com o mantenedor (desenho original, handoff-fase4 §4).
-- complete_class/admin_complete_past_batch recriadas por DUMP VIVO (regra da
-- casa) com a exigência nova; o batch PULA aula sem apontamento (nunca falha
-- a rodada inteira).

-- ---------------------------------------------------------------------------
-- students.level ganha os 11 níveis Flexge (check antigo só tinha 6)
-- ---------------------------------------------------------------------------
alter table students drop constraint students_level_check;
alter table students add constraint students_level_check
  check (level is null or level in
    ('Pre A1','A1','A1+','A2','A2+','B1','B1+','B2','B2+','C1','C2'));

-- ---------------------------------------------------------------------------
-- Plano do aluno (1 por contrato+semestre) e seus itens
-- ---------------------------------------------------------------------------
create table study_plans (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id),
  semester_no int not null check (semester_no >= 1),
  starts_on date not null,
  ends_on date not null,
  level_snapshot text not null,
  track_id uuid not null references curriculum_tracks(id),
  created_at timestamptz not null default now(),
  unique (contract_id, semester_no)
);
comment on table study_plans is
  'Plano semestral do aluno (D1: semestre = blocos de 6 meses do started_on do contrato). Nasce copiando a trilha do nível (curriculum_tracks) e é personalizado pela professora.';

create table study_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references study_plans(id),
  topic_id uuid references curriculum_topics(id),
  position int not null,
  title text not null,
  theme text,
  approach text,
  flexge_lesson_id text,
  flexge_lesson_href text,
  -- sugestão da IA (prompt study-plan-suggest): a professora aceita/edita —
  -- NUNCA vira theme/approach sozinha; escrita só do servidor (grant de coluna)
  suggested_theme text,
  suggested_approach text,
  updated_at timestamptz not null default now(),
  unique (plan_id, position)
);
comment on table study_plan_items is
  'Módulos do plano (cópia da trilha) + personalização da professora: theme (tema pelo interesse do aluno), approach (como aplicar, informado pelo briefing/Kolb), aula da Flexge escolhida (id/href do catálogo).';

-- ---------------------------------------------------------------------------
-- Apontamento de conteúdo por aula (M3 — a prestação de contas pedagógica)
-- ---------------------------------------------------------------------------
create table class_content_reports (
  class_instance_id uuid primary key references class_instances(id),
  plan_item_id uuid references study_plan_items(id),
  off_track_kind text check (off_track_kind in ('revisao','prova','extra','conversacao','outro')),
  off_track_note text,
  reported_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (plan_item_id is not null and off_track_kind is null)
    or (plan_item_id is null and off_track_kind is not null)
  )
);
comment on table class_content_reports is
  'D2: o que foi trabalhado na aula — item do plano OU tema avulso (exatamente um). Exigido por complete_class; editável via report_class_content (auditado).';

-- RLS + grants (convenção da casa: grant abre, RLS cala; anon vazio)
alter table study_plans enable row level security;
alter table study_plan_items enable row level security;
alter table class_content_reports enable row level security;

create policy study_plans_student on study_plans
  for select to authenticated
  using (contract_id in (
    select c.id from contracts c
    where c.student_id in (select id from students where profile_id = (select auth.uid()))
  ));
create policy study_plans_teacher on study_plans
  for select to authenticated
  using ((select public.app_role()) = 'teacher' and contract_id in (
    select c.id from contracts c
    join teachers t on t.id = c.teacher_id
    where t.profile_id = (select auth.uid())
  ));
create policy study_plans_admin on study_plans
  for select to authenticated
  using ((select public.app_role()) = 'admin');

create policy study_plan_items_read on study_plan_items
  for select to authenticated
  using (plan_id in (select id from study_plans));

create policy class_content_reports_read on class_content_reports
  for select to authenticated
  using (class_instance_id in (select id from class_instances));

grant select on study_plans, study_plan_items, class_content_reports
  to anon, authenticated, service_role;
revoke insert, update, delete, truncate on study_plans, study_plan_items, class_content_reports
  from anon, authenticated;
-- o SERVIDOR grava só as colunas de sugestão (bypass de RLS + grant estreito)
grant update (suggested_theme, suggested_approach) on study_plan_items to service_role;

-- ---------------------------------------------------------------------------
-- Interno: é professora DESTE contrato?
-- ---------------------------------------------------------------------------
create or replace function public._is_teacher_of_contract(p_contract uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from contracts c
    join teachers t on t.id = c.teacher_id
    where c.id = p_contract and t.profile_id = auth.uid()
  );
$$;
revoke execute on function public._is_teacher_of_contract(uuid) from public, anon;
-- exposto a logados: checagem de posse inofensiva (boolean), usada pela action
-- da sugestão de IA (que não é RPC) antes de tocar o banco
grant execute on function public._is_teacher_of_contract(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: gerar o plano do semestre CORRENTE do contrato (admin ou professora dele)
-- ---------------------------------------------------------------------------
create or replace function public.generate_study_plan(p_contract uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_started date;
  v_level text;
  v_today date := public.business_today();
  v_k int;
  v_sem int;
  v_starts date;
  v_ends date;
  v_track uuid;
  v_plan uuid;
begin
  if public.app_role() <> 'admin' and not public._is_teacher_of_contract(p_contract) then
    raise exception 'apenas admin ou a professora do contrato';
  end if;

  select c.started_on, s.level into v_started, v_level
  from contracts c
  join students s on s.id = c.student_id
  where c.id = p_contract and c.contract_type = 'private_1on1';
  if not found then
    raise exception 'contrato particular não encontrado';
  end if;
  if v_level is null then
    raise exception 'defina o nível do aluno na ficha antes de gerar o plano';
  end if;
  select id into v_track from curriculum_tracks where level = v_level;
  if v_track is null then
    raise exception 'não há trilha cadastrada para o nível %', v_level;
  end if;

  -- D1: bloco de 6 meses do relógio do CONTRATO que contém a data de hoje
  v_k := greatest(0,
    (extract(year from age(v_today, v_started))::int * 12
     + extract(month from age(v_today, v_started))::int) / 6);
  v_sem := v_k + 1;
  v_starts := (v_started + (v_k * interval '6 months'))::date;
  v_ends := (v_started + ((v_k + 1) * interval '6 months'))::date - 1;

  select id into v_plan from study_plans
  where contract_id = p_contract and semester_no = v_sem;
  if v_plan is not null then
    return v_plan; -- idempotente: o plano do semestre corrente já existe
  end if;

  insert into study_plans (contract_id, semester_no, starts_on, ends_on, level_snapshot, track_id)
  values (p_contract, v_sem, v_starts, v_ends, v_level, v_track)
  returning id into v_plan;

  insert into study_plan_items (plan_id, topic_id, position, title)
  select v_plan, id, position, title
  from curriculum_topics where track_id = v_track;

  perform public.log_audit(auth.uid(), 'generate_study_plan', 'study_plans', v_plan::text,
    jsonb_build_object('contract_id', p_contract, 'semester_no', v_sem,
      'level', v_level, 'starts_on', v_starts, 'ends_on', v_ends));
  return v_plan;
end;
$$;
revoke execute on function public.generate_study_plan(uuid) from public, anon;
grant execute on function public.generate_study_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: personalizar um item (professora do contrato ou admin) — auditado
-- ---------------------------------------------------------------------------
create or replace function public.update_study_plan_item(
  p_item uuid,
  p_theme text default null,
  p_approach text default null,
  p_flexge_lesson_id text default null,
  p_flexge_lesson_href text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract uuid;
  v_old jsonb;
begin
  select sp.contract_id,
         jsonb_build_object('theme', i.theme, 'approach', i.approach,
           'flexge_lesson_id', i.flexge_lesson_id, 'flexge_lesson_href', i.flexge_lesson_href)
    into v_contract, v_old
  from study_plan_items i
  join study_plans sp on sp.id = i.plan_id
  where i.id = p_item;
  if not found then
    raise exception 'item de plano não encontrado';
  end if;
  if public.app_role() <> 'admin' and not public._is_teacher_of_contract(v_contract) then
    raise exception 'apenas admin ou a professora do contrato';
  end if;

  update study_plan_items
     set theme = p_theme,
         approach = p_approach,
         flexge_lesson_id = p_flexge_lesson_id,
         flexge_lesson_href = p_flexge_lesson_href,
         -- decisão tomada: a sugestão pendente sai de cena (aceita ou não)
         suggested_theme = null,
         suggested_approach = null,
         updated_at = now()
   where id = p_item;

  perform public.log_audit(auth.uid(), 'update_study_plan_item', 'study_plan_items', p_item::text,
    jsonb_build_object('previous', v_old, 'theme', p_theme, 'approach', p_approach,
      'flexge_lesson_id', p_flexge_lesson_id));
end;
$$;
revoke execute on function public.update_study_plan_item(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_study_plan_item(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: apontar o conteúdo de uma aula (professora dona da aula ou admin)
-- ---------------------------------------------------------------------------
create or replace function public.report_class_content(
  p_instance uuid,
  p_plan_item uuid default null,
  p_off_kind text default null,
  p_off_note text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract uuid;
  v_item_contract uuid;
begin
  select ci.contract_id into v_contract
  from class_instances ci where ci.id = p_instance;
  if not found then
    raise exception 'aula não encontrada';
  end if;
  if public.app_role() <> 'admin' and not public._is_teacher_of_contract(v_contract) then
    raise exception 'apenas admin ou a professora da aula';
  end if;

  if (p_plan_item is null) = (p_off_kind is null) then
    raise exception 'informe OU um módulo do plano OU um tema avulso (exatamente um)';
  end if;
  if p_plan_item is not null then
    select sp.contract_id into v_item_contract
    from study_plan_items i join study_plans sp on sp.id = i.plan_id
    where i.id = p_plan_item;
    if v_item_contract is null then
      raise exception 'item de plano não encontrado';
    end if;
    if v_item_contract <> v_contract then
      raise exception 'o módulo apontado é de outro aluno/contrato';
    end if;
  end if;

  insert into class_content_reports
    (class_instance_id, plan_item_id, off_track_kind, off_track_note, reported_by)
  values (p_instance, p_plan_item, p_off_kind, p_off_note, auth.uid())
  on conflict (class_instance_id) do update
    set plan_item_id = excluded.plan_item_id,
        off_track_kind = excluded.off_track_kind,
        off_track_note = excluded.off_track_note,
        reported_by = excluded.reported_by,
        updated_at = now();

  perform public.log_audit(auth.uid(), 'report_class_content', 'class_content_reports', p_instance::text,
    jsonb_build_object('plan_item_id', p_plan_item, 'off_track_kind', p_off_kind,
      'off_track_note', p_off_note));
end;
$$;
revoke execute on function public.report_class_content(uuid, uuid, text, text) from public, anon;
grant execute on function public.report_class_content(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- complete_class — DUMP VIVO (20260717000100) + D2: registro de realizada
-- EXIGE apontamento (existente, ou informado nos parâmetros novos)
-- ---------------------------------------------------------------------------
drop function if exists public.complete_class(uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION public.complete_class(
  p_instance uuid, p_actor uuid DEFAULT NULL::uuid, p_batch uuid DEFAULT NULL::uuid,
  p_plan_item uuid DEFAULT NULL::uuid, p_off_kind text DEFAULT NULL::text,
  p_off_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- D2 (20/07/2026): realizada SEM apontamento não existe. Aceita o apontamento
  -- prévio da professora (class_content_reports) ou o informado agora.
  if not exists (select 1 from class_content_reports where class_instance_id = p_instance) then
    if p_plan_item is null and p_off_kind is null then
      raise exception 'aula sem apontamento de conteúdo — informe o módulo do plano ou um tema avulso';
    end if;
    perform public.report_class_content(p_instance, p_plan_item, p_off_kind, p_off_note);
  end if;

  update class_instances set state = 'completed' where id = p_instance;

  insert into audit_log (actor, action, entity, entity_id, diff)
  values (coalesce(p_actor, auth.uid()), 'complete_class', 'class_instances', p_instance,
          jsonb_build_object('from', 'scheduled', 'to', 'completed', 'batch', p_batch));
end;
$function$;

-- ---------------------------------------------------------------------------
-- admin_complete_past_batch — DUMP VIVO + D2: aula sem apontamento é PULADA
-- (vira pendência visível; a rodada nunca falha inteira)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_complete_past_batch(p_teacher uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid;
  v_batch uuid := gen_random_uuid();
  v_ids uuid[] := array[]::uuid[];
  v_skipped uuid[] := array[]::uuid[];
  v_id uuid;
  v_done int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_complete_past_batch é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select coalesce(array_agg(ci.id order by ci.starts_at_utc), array[]::uuid[]) into v_ids
  from class_instances ci
  where ci.state = 'scheduled'
    and ci.starts_at_utc < now()
    and (p_teacher is null or ci.teacher_id = p_teacher);

  foreach v_id in array v_ids loop
    if exists (select 1 from class_content_reports where class_instance_id = v_id) then
      perform public.complete_class(v_id, v_actor, v_batch);
      v_done := v_done + 1;
    else
      v_skipped := v_skipped || v_id;
    end if;
  end loop;

  perform public.log_audit(v_actor, 'complete_class_batch', 'class_instances', v_batch::text,
    jsonb_build_object('teacher_id', p_teacher, 'count', v_done,
      'instances', to_jsonb(v_ids), 'skipped_sem_apontamento', to_jsonb(v_skipped)));
  return v_done;
end;
$function$;

-- ---------------------------------------------------------------------------
-- M0c: lembrete de briefing (botão da dona na ficha) — 1 por dia por aluno
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_briefing_reminder(p_student uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_has_wa boolean;
  v_hoje date := public.business_today();
  v_n int := 0;
  v_rows int;
begin
  if public.app_role() <> 'admin' then
    raise exception 'apenas admin';
  end if;
  select profile_id into v_profile from students where id = p_student;
  if v_profile is null then
    raise exception 'o aluno ainda não tem login — envie o convite primeiro';
  end if;
  if exists (select 1 from briefings where student_id = p_student and status = 'submitted') then
    raise exception 'o briefing deste aluno já foi enviado';
  end if;

  insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
  values ('briefing-reminder', v_profile,
          jsonb_build_object('student_id', p_student),
          format('briefing-reminder:%s:%s', p_student, v_hoje))
  on conflict (dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_n := v_n + v_rows;

  select p.whatsapp_e164 is not null into v_has_wa from profiles p where p.id = v_profile;
  if coalesce(v_has_wa, false) then
    insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
    values ('whatsapp', 'briefing-reminder', v_profile,
            jsonb_build_object('student_id', p_student),
            format('briefing-reminder:wa:%s:%s', p_student, v_hoje))
    on conflict (dedupe_key) do nothing;
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
  end if;

  perform public.log_audit(auth.uid(), 'enqueue_briefing_reminder', 'briefings', p_student::text,
    jsonb_build_object('enfileirados', v_n));
  return v_n;
end;
$$;
revoke execute on function public.enqueue_briefing_reminder(uuid) from public, anon;
grant execute on function public.enqueue_briefing_reminder(uuid) to authenticated;
