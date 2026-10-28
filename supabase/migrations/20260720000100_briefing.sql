-- M0a do projeto cronograma (OK do mantenedor, 19/07/2026 à noite): BRIEFING
-- integrado ao portal — substitui o Google Forms (briefing) + Doc (teste Kolb).
-- Fontes fielmente replicadas: Form "Briefing – Personal Teacher" (13 perguntas)
-- e Doc Módulos 0/1 (mapa de rotina + teste Kolb de 12 questões com gabarito).
-- Decisões: bloqueante no portal (após a ciência); salvamento parcial por
-- etapa; Kolb CALCULADO NO BANCO no envio (Lei 3 — a UI nunca decide o estilo);
-- pós-envio o aluno não edita (retaguarda = admin_fill_briefing, auditado).

-- ---------------------------------------------------------------------------
-- Tabela
-- ---------------------------------------------------------------------------
create table briefings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references students(id),
  -- respostas por etapa: {historia:{...}, objetivos:{...}, interesses:{...},
  -- rotina:{...}, livre:{...}} — shapes validados no envio, rascunho é livre
  answers jsonb not null default '{}'::jsonb,
  -- {"q1":"A", ..., "q12":"D"} — letras respondidas do teste Kolb
  kolb_answers jsonb not null default '{}'::jsonb,
  -- preenchidos SÓ pelo submit (função — nunca de fora):
  kolb_scores jsonb,
  kolb_style text check (kolb_style in ('divergente','assimilador','convergente','acomodador')),
  status text not null default 'draft' check (status in ('draft','submitted')),
  submitted_at timestamptz,
  -- quem escreveu por último (aluno ou admin em nome dele) — trilha no audit_log
  filled_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table briefings is
  'Briefing pré-primeira-aula (1 por aluno): história/objetivos/interesses/rotina + teste Kolb. Escrita SÓ via RPCs (save_briefing_draft/submit_briefing/admin_fill_briefing); kolb_style calculado no banco.';

alter table briefings enable row level security;

-- deny-by-default: leitura por papel; escrita NENHUMA (só RPCs security definer)
create policy briefings_student_self on briefings
  for select to authenticated
  using (student_id in (select id from students where profile_id = (select auth.uid())));

create policy briefings_teacher on briefings
  for select to authenticated
  using (
    (select public.app_role()) = 'teacher'
    and student_id in (select public.teacher_student_ids())
  );

create policy briefings_admin on briefings
  for select to authenticated
  using ((select public.app_role()) = 'admin');

-- Leitura: RLS decide a linha; o grant abre a porta (tabelas pós-F1 não herdam
-- o grant-all da 20260711000700). service_role: leitura p/ ficha/rotinas do
-- servidor e escrita coberta pelas RPCs (security definer) — sem grant direto.
-- anon incluso pela convenção da casa (caso 12 do rls.test): toda tabela
-- devolve VAZIO silencioso ao anon — o grant abre, a RLS cala.
grant select on briefings to anon, authenticated, service_role;
revoke insert, update, delete, truncate on briefings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Interno: aluno da sessão
-- ---------------------------------------------------------------------------
create or replace function public._briefing_session_student()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid;
begin
  if auth.uid() is null then
    raise exception 'sessão necessária';
  end if;
  select id into v_student from students where profile_id = auth.uid() limit 1;
  if v_student is null then
    raise exception 'sem cadastro de aluno para esta conta';
  end if;
  return v_student;
end;
$$;
revoke execute on function public._briefing_session_student() from public, anon;

-- ---------------------------------------------------------------------------
-- Interno: valida + calcula Kolb + fecha (compartilhado aluno/admin)
-- Gabarito transcrito do Doc (Módulo 1) — o mapeamento letra→modo VARIA por
-- questão. Estilo = par dos 2 modos mais altos (regra do Doc), implementado
-- como PAR ADJACENTE DE MAIOR SOMA (equivalente quando não há empate;
-- determinístico sempre): CE+RO=divergente · AC+RO=assimilador ·
-- AC+AE=convergente · CE+AE=acomodador. Empate entre pares → desempate pelos
-- eixos do próprio Kolb (y=AC−CE, x=AE−RO; convenção documentada nos testes).
-- ---------------------------------------------------------------------------
create or replace function public._briefing_submit(p_student uuid, p_actor uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row briefings%rowtype;
  v_key constant jsonb := '{
    "q1":  {"A":"CE","B":"RO","C":"AC","D":"AE"},
    "q2":  {"A":"AC","B":"RO","C":"AE","D":"CE"},
    "q3":  {"A":"AC","B":"RO","C":"AE","D":"CE"},
    "q4":  {"A":"AE","B":"RO","C":"AC","D":"CE"},
    "q5":  {"A":"AE","B":"RO","C":"AC","D":"CE"},
    "q6":  {"A":"AE","B":"RO","C":"AC","D":"CE"},
    "q7":  {"A":"AC","B":"RO","C":"AE","D":"CE"},
    "q8":  {"A":"AE","B":"RO","C":"AC","D":"CE"},
    "q9":  {"A":"AC","B":"RO","C":"CE","D":"AE"},
    "q10": {"A":"CE","B":"AC","C":"RO","D":"AE"},
    "q11": {"A":"AC","B":"CE","C":"AE","D":"RO"},
    "q12": {"A":"AE","B":"AC","C":"RO","D":"CE"}
  }'::jsonb;
  v_i int;
  v_letter text;
  v_mode text;
  v_ce int := 0; v_ro int := 0; v_ac int := 0; v_ae int := 0;
  v_style text;
  v_best int;
  v_x int; v_y int;
  v_section text;
begin
  select * into v_row from briefings where student_id = p_student for update;
  if not found then
    raise exception 'briefing ainda não iniciado';
  end if;
  if v_row.status = 'submitted' then
    raise exception 'briefing já enviado — alterações só pelo atendimento';
  end if;

  -- etapas obrigatórias presentes e não vazias (a "livre" é opcional)
  foreach v_section in array array['historia','objetivos','interesses','rotina'] loop
    if coalesce(v_row.answers -> v_section, '{}'::jsonb) = '{}'::jsonb then
      raise exception 'etapa obrigatória sem resposta: %', v_section;
    end if;
  end loop;

  -- Kolb completo (q1..q12, letra A–D) e tabulação
  for v_i in 1..12 loop
    v_letter := v_row.kolb_answers ->> ('q' || v_i);
    if v_letter is null or v_letter not in ('A','B','C','D') then
      raise exception 'teste de estilo incompleto (questão %)', v_i;
    end if;
    v_mode := v_key -> ('q' || v_i) ->> v_letter;
    if v_mode = 'CE' then v_ce := v_ce + 1;
    elsif v_mode = 'RO' then v_ro := v_ro + 1;
    elsif v_mode = 'AC' then v_ac := v_ac + 1;
    else v_ae := v_ae + 1;
    end if;
  end loop;

  -- par adjacente de maior soma
  v_best := greatest(v_ce + v_ro, v_ac + v_ro, v_ac + v_ae, v_ce + v_ae);
  if (v_ce + v_ro = v_best)::int + (v_ac + v_ro = v_best)::int
     + (v_ac + v_ae = v_best)::int + (v_ce + v_ae = v_best)::int > 1 then
    -- empate → eixos do Kolb (y = AC−CE "pensar×sentir"; x = AE−RO "fazer×observar")
    v_y := v_ac - v_ce; v_x := v_ae - v_ro;
    if v_y > 0 and v_x > 0 then v_style := 'convergente';
    elsif v_y > 0 then v_style := 'assimilador';
    elsif v_x > 0 then v_style := 'acomodador';
    else v_style := 'divergente';
    end if;
  elsif v_ce + v_ro = v_best then v_style := 'divergente';
  elsif v_ac + v_ro = v_best then v_style := 'assimilador';
  elsif v_ac + v_ae = v_best then v_style := 'convergente';
  else v_style := 'acomodador';
  end if;

  update briefings
     set status = 'submitted',
         submitted_at = now(),
         kolb_scores = jsonb_build_object('CE', v_ce, 'RO', v_ro, 'AC', v_ac, 'AE', v_ae),
         kolb_style = v_style,
         filled_by = p_actor,
         updated_at = now()
   where student_id = p_student;

  perform public.log_audit(p_actor, 'submit_briefing', 'briefings', p_student::text,
    jsonb_build_object('kolb_style', v_style,
      'kolb_scores', jsonb_build_object('CE', v_ce, 'RO', v_ro, 'AC', v_ac, 'AE', v_ae)));
  return v_style;
end;
$$;
revoke execute on function public._briefing_submit(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: rascunho do PRÓPRIO aluno (merge por etapa; livre até o envio)
-- ---------------------------------------------------------------------------
create or replace function public.save_briefing_draft(
  p_answers jsonb default null,
  p_kolb_answers jsonb default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid := public._briefing_session_student();
begin
  insert into briefings (student_id, answers, kolb_answers, filled_by)
  values (v_student, coalesce(p_answers, '{}'::jsonb), coalesce(p_kolb_answers, '{}'::jsonb), auth.uid())
  on conflict (student_id) do update
    set answers = briefings.answers || coalesce(excluded.answers, '{}'::jsonb),
        kolb_answers = briefings.kolb_answers || coalesce(excluded.kolb_answers, '{}'::jsonb),
        filled_by = auth.uid(),
        updated_at = now()
    where briefings.status = 'draft';
  if exists (select 1 from briefings where student_id = v_student and status = 'submitted') then
    raise exception 'briefing já enviado — alterações só pelo atendimento';
  end if;
end;
$$;
revoke execute on function public.save_briefing_draft(jsonb, jsonb) from public, anon;
grant execute on function public.save_briefing_draft(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: envio do PRÓPRIO aluno (valida tudo, calcula Kolb, trava)
-- ---------------------------------------------------------------------------
create or replace function public.submit_briefing()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public._briefing_submit(public._briefing_session_student(), auth.uid());
end;
$$;
revoke execute on function public.submit_briefing() from public, anon;
grant execute on function public.submit_briefing() to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: retaguarda do ADMIN (colhido por chamada/telefone) — auditado como dele
-- ---------------------------------------------------------------------------
create or replace function public.admin_fill_briefing(
  p_student uuid,
  p_answers jsonb default null,
  p_kolb_answers jsonb default null,
  p_finalize boolean default false
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin';
  end if;
  if not exists (select 1 from students where id = p_student) then
    raise exception 'aluno inexistente';
  end if;

  insert into briefings (student_id, answers, kolb_answers, filled_by)
  values (p_student, coalesce(p_answers, '{}'::jsonb), coalesce(p_kolb_answers, '{}'::jsonb), auth.uid())
  on conflict (student_id) do update
    set answers = briefings.answers || coalesce(excluded.answers, '{}'::jsonb),
        kolb_answers = briefings.kolb_answers || coalesce(excluded.kolb_answers, '{}'::jsonb),
        filled_by = auth.uid(),
        updated_at = now()
    where briefings.status = 'draft';
  if exists (select 1 from briefings where student_id = p_student and status = 'submitted') then
    raise exception 'briefing já enviado — para corrigir, fale com o mantenedor (regra de imutabilidade)';
  end if;

  perform public.log_audit(auth.uid(), 'admin_fill_briefing', 'briefings', p_student::text,
    jsonb_build_object('finalize', p_finalize));

  if p_finalize then
    perform public._briefing_submit(p_student, auth.uid());
  end if;
end;
$$;
revoke execute on function public.admin_fill_briefing(uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.admin_fill_briefing(uuid, jsonb, jsonb, boolean) to authenticated;
