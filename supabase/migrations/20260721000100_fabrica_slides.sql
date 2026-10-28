-- Fábrica de Slides (FS-M0, 21/07/2026 — plano aprovado pelo mantenedor) — as
-- aulas do curso Personal Travel produzidas DENTRO do site (ADR-020: pipeline
-- de slides; ADR-022: curadoria de vídeos com trecho recomendado). O conteúdo
-- estruturado da aula (LessonDoc — mesmo contrato zod do renderer em
-- src/lib/slides/) vive em jsonb; o deck .pptx é derivado dele sob demanda.
--
-- SEM fila pgmq no v1 (desvio consciente do esboço do Estágio 1 no ADR-022,
-- registrado no adendo do FS-M2): gerar um deck leva ~3s e é ação de admin
-- disparada por rota — o padrão da casa (Fábrica de conteúdo/outbox) é ação
-- por rota + Scheduled Task, e a escala-alvo é 50 alunos (Lei "sem
-- gold-plating"), não um farm de geração.
--
-- Estados (molde content_posts_guard, 20260720000400):
--   rascunho → aprovada → gerada
--   aprovada|gerada → rascunho (reabrir para editar; deck fica obsoleto)
--   rascunho → descartada (imutável)
--   Conteúdo congelado fora de rascunho (whitelist: só deck/da transição).

create table slide_lessons (
  id uuid primary key default gen_random_uuid(),
  course text not null default 'personal-travel' check (btrim(course) <> ''),
  module int not null check (module between 1 and 12),
  lesson int not null check (lesson between 1 and 9),
  title text not null check (btrim(title) <> ''),
  -- LessonDoc completo (validado pelo zod da lib no app; o banco guarda o shape
  -- mínimo para não nascer lixo estrutural).
  content jsonb not null default '{}'::jsonb,
  status text not null default 'rascunho' check (status in
    ('rascunho', 'aprovada', 'gerada', 'descartada')),
  approved_by uuid references profiles (id),
  approved_at timestamptz,
  -- Deck derivado (preenchido na transição aprovada→gerada pela rota do app).
  deck_generated_at timestamptz,
  deck_drive_file_id text,
  deck_url text,
  deck_error text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course, module, lesson),
  -- Portão com carimbo (molde content_posts_gate1_shape): aprovada/gerada
  -- exigem quem aprovou; reabrir (→rascunho) limpa o carimbo.
  constraint slide_lessons_gate_shape check (
    status not in ('aprovada', 'gerada')
    or (approved_by is not null and approved_at is not null))
);

comment on table slide_lessons is
  'Aulas do Personal Travel produzidas no /admin/slides (FS-M0). content = '
  'LessonDoc jsonb (contrato zod de src/lib/slides/lesson-schema). Mutações '
  'críticas via RPC; transições vigiadas por slide_lessons_guard; conteúdo '
  'congelado fora de rascunho. Deck .pptx é derivado, nunca fonte.';

create or replace function public.slide_lessons_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'rascunho' then
      raise exception 'aula de slides nasce como RASCUNHO — aprovação é transição';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'aula de slides % não se apaga (Lei 8) — use o estado descartada', old.id;
  end if;

  if old.status = 'descartada' then
    raise exception 'aula % está descartada — imutável (Lei 8)', old.id;
  end if;

  if new.status <> old.status then
    if not (
      (old.status = 'rascunho' and new.status in ('aprovada', 'descartada')) or
      (old.status = 'aprovada' and new.status in ('gerada', 'rascunho')) or
      (old.status = 'gerada'   and new.status = 'rascunho')
    ) then
      raise exception 'transição inválida de % para % na aula %', old.status, new.status, old.id;
    end if;
  end if;

  -- Fora de rascunho o CONTEÚDO congela (whitelist: campos de deck e os que a
  -- própria transição escreve). Reabrir limpa o carimbo de aprovação.
  if old.status in ('aprovada', 'gerada') then
    if to_jsonb(new) - array['status', 'approved_by', 'approved_at',
         'deck_generated_at', 'deck_drive_file_id', 'deck_url', 'deck_error',
         'updated_at']
       <> to_jsonb(old) - array['status', 'approved_by', 'approved_at',
         'deck_generated_at', 'deck_drive_file_id', 'deck_url', 'deck_error',
         'updated_at'] then
      raise exception 'aula % está % — conteúdo congelado; reabra para editar', old.id, old.status;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger slide_lessons_guard
  before insert or update or delete on slide_lessons
  for each row execute function public.slide_lessons_guard();

-- Lei 8: trilha completa (ator/diff) — trigger genérico F1.
create trigger slide_lessons_audit
  after insert or update or delete on slide_lessons
  for each row execute function public.audit_row_change();

alter table slide_lessons enable row level security;

create policy slide_lessons_admin_all on slide_lessons
  for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

-- Lição 20260714000600: revoke explícito antes dos grants cirúrgicos.
revoke insert, update, delete, truncate on slide_lessons
from anon, authenticated, service_role;

grant select on slide_lessons to anon, authenticated;   -- RLS decide as linhas
grant insert, update on slide_lessons to authenticated; -- policy exige admin
-- A rota de geração do deck (servidor) escreve via service_role; o guard é a
-- 2ª linha de defesa. DELETE: ninguém.
grant select, insert, update on slide_lessons to service_role;

-- ---------------------------------------------------------------------------
-- slide_video_candidates — curadoria de vídeo por aula (ADR-022 + adendo
-- 20/07): candidatos SEM filtros numéricos, com thumbnail para a checagem
-- humana ("gente de verdade, não animação") e trecho recomendado {start, end,
-- why} proposto por transcript. No máximo UM aprovado por aula.
-- ---------------------------------------------------------------------------
create table slide_video_candidates (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references slide_lessons (id),
  video_id text not null check (btrim(video_id) <> ''),
  title text not null,
  channel text not null,
  published_at timestamptz,
  views bigint,
  excerpt jsonb,                       -- {start, end, why} (mm:ss)
  ordem int not null default 1,
  status text not null default 'sugerido' check (status in
    ('sugerido', 'aprovado', 'rejeitado')),
  decided_by uuid references profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lesson_id, video_id)
);

create unique index slide_video_one_approved_per_lesson
  on slide_video_candidates (lesson_id) where status = 'aprovado';

comment on table slide_video_candidates is
  'Candidatos de vídeo do listening (ADR-022, Estágio 1). Sugestões são '
  'substituíveis pela RPC de nova busca (apaga só os sugeridos — decididos são '
  'história); decisão via slide_video_decide. Thumbnail = '
  'i.ytimg.com/vi/<video_id>/hqdefault.jpg (derivada, não armazenada).';

create trigger slide_video_candidates_audit
  after insert or update or delete on slide_video_candidates
  for each row execute function public.audit_row_change();

alter table slide_video_candidates enable row level security;

create policy slide_video_candidates_admin_all on slide_video_candidates
  for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

revoke insert, update, delete, truncate on slide_video_candidates
from anon, authenticated, service_role;

grant select on slide_video_candidates to anon, authenticated;
-- Escrita SÓ pelas RPCs (owner). A rota de busca (servidor) usa service_role.
grant select, insert on slide_video_candidates to service_role;

-- ---------------------------------------------------------------------------
-- RPCs (Lei 3: mutação crítica só por função; ADR-012: SECURITY DEFINER do
-- owner + checagem de papel dentro da função).
-- ---------------------------------------------------------------------------

create or replace function public.slide_lesson_create(
  p_course text,
  p_module int,
  p_lesson int,
  p_title text,
  p_content jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin cria aulas de slides';
  end if;
  insert into slide_lessons (course, module, lesson, title, content, created_by)
  values (p_course, p_module, p_lesson, p_title, p_content, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.slide_lesson_save_content(
  p_id uuid,
  p_content jsonb,
  p_title text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin edita aulas de slides';
  end if;
  select status into v_status from slide_lessons where id = p_id for update;
  if v_status is null then
    raise exception 'aula % não existe', p_id;
  end if;
  if v_status <> 'rascunho' then
    raise exception 'aula % está % — reabra para editar', p_id, v_status;
  end if;
  update slide_lessons
     set content = p_content,
         title = coalesce(p_title, title)
   where id = p_id;
end;
$$;

create or replace function public.slide_lesson_approve(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin aprova aulas de slides';
  end if;
  update slide_lessons
     set status = 'aprovada', approved_by = auth.uid(), approved_at = now()
   where id = p_id and status = 'rascunho';
  if not found then
    raise exception 'aula % não está em rascunho (ou não existe)', p_id;
  end if;
end;
$$;

create or replace function public.slide_lesson_reopen(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin reabre aulas de slides';
  end if;
  update slide_lessons
     set status = 'rascunho', approved_by = null, approved_at = null
   where id = p_id and status in ('aprovada', 'gerada');
  if not found then
    raise exception 'aula % não está aprovada/gerada (ou não existe)', p_id;
  end if;
end;
$$;

create or replace function public.slide_lesson_discard(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin descarta aulas de slides';
  end if;
  update slide_lessons set status = 'descartada'
   where id = p_id and status = 'rascunho';
  if not found then
    raise exception 'aula % não está em rascunho (ou não existe)', p_id;
  end if;
end;
$$;

-- Nova busca substitui as SUGESTÕES; candidatos já decididos (aprovado ou
-- rejeitado) são história e ficam. p_candidates: array de {video_id, title,
-- channel, published_at, views, excerpt, ordem}.
create or replace function public.slide_video_suggest_replace(
  p_lesson uuid,
  p_candidates jsonb
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin sugere vídeos';
  end if;
  if not exists (select 1 from slide_lessons where id = p_lesson) then
    raise exception 'aula % não existe', p_lesson;
  end if;
  delete from slide_video_candidates
   where lesson_id = p_lesson and status = 'sugerido';
  insert into slide_video_candidates
    (lesson_id, video_id, title, channel, published_at, views, excerpt, ordem)
  select p_lesson,
         c ->> 'video_id',
         coalesce(c ->> 'title', ''),
         coalesce(c ->> 'channel', ''),
         (c ->> 'published_at')::timestamptz,
         (c ->> 'views')::bigint,
         c -> 'excerpt',
         coalesce((c ->> 'ordem')::int, row_number() over ()::int)
    from jsonb_array_elements(p_candidates) as c
      on conflict (lesson_id, video_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.slide_video_decide(
  p_id uuid,
  p_status text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson uuid;
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin decide vídeos';
  end if;
  if p_status not in ('aprovado', 'rejeitado') then
    raise exception 'decisão inválida: % (use aprovado ou rejeitado)', p_status;
  end if;
  select lesson_id into v_lesson from slide_video_candidates where id = p_id for update;
  if v_lesson is null then
    raise exception 'candidato % não existe', p_id;
  end if;
  -- Aprovar um candidato rebaixa o aprovado anterior da MESMA aula (troca de
  -- escolha é rejeição do anterior — história preservada).
  if p_status = 'aprovado' then
    update slide_video_candidates
       set status = 'rejeitado', decided_by = auth.uid(), decided_at = now()
     where lesson_id = v_lesson and status = 'aprovado' and id <> p_id;
  end if;
  update slide_video_candidates
     set status = p_status, decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$$;

revoke execute on function
  public.slide_lesson_create(text, int, int, text, jsonb),
  public.slide_lesson_save_content(uuid, jsonb, text),
  public.slide_lesson_approve(uuid),
  public.slide_lesson_reopen(uuid),
  public.slide_lesson_discard(uuid),
  public.slide_video_suggest_replace(uuid, jsonb),
  public.slide_video_decide(uuid, text)
from public, anon;

grant execute on function
  public.slide_lesson_create(text, int, int, text, jsonb),
  public.slide_lesson_save_content(uuid, jsonb, text),
  public.slide_lesson_approve(uuid),
  public.slide_lesson_reopen(uuid),
  public.slide_lesson_discard(uuid),
  public.slide_video_suggest_replace(uuid, jsonb),
  public.slide_video_decide(uuid, text)
to authenticated, service_role;
