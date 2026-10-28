-- Fábrica de Conteúdo (ADR-021, 20/07/2026) — posts sociais gerados por agentes
-- de IA (pipeline n8n em VPS própria) com DOIS portões de aprovação humana da
-- dona no painel /admin/conteudo. Padrão do template n8n #8700 validado por
-- pesquisa; máquina de estados no BANCO (Lei 3), molde progress_reports_guard.
--
-- Via única com dois portões (nasce SEMPRE ideia; DELETE proibido — descarte é
-- estado, Lei 8):
--   ideia → ideia_aprovada → gerando → rascunho → aprovado → publicado
--     ideia      → ideia_aprovada | rejeitado | descartado
--     ideia_aprovada → gerando | descartado
--     gerando    → rascunho | ideia_aprovada (erro/destravar) | descartado
--     rascunho   → aprovado | rejeitado | descartado
--     rejeitado  → ideia_aprovada ("tentar de novo"; motivo vira feedback) | descartado
--     aprovado   → publicado (conteúdo congelado por WHITELIST — achado 26)
--     publicado, descartado → imutáveis
--
-- Imagens: Google Drive (Lei 10 — nada de Supabase Storage); images jsonb guarda
-- IDs/paths do Drive. Texto NUNCA dentro da imagem gerada (Lei 11): slides[].texto
-- vive aqui e é composto por cima de forma determinística.

create table content_posts (
  id uuid primary key default gen_random_uuid(),
  -- Idempotência do pipeline (Lei 6): retry do n8n nunca duplica ideia.
  external_ref text unique,
  kind text not null check (kind in ('carrossel', 'story', 'roteiro_reel')),
  status text not null default 'ideia' check (status in
    ('ideia', 'ideia_aprovada', 'gerando', 'rascunho',
     'aprovado', 'publicado', 'rejeitado', 'descartado')),
  tema text not null check (btrim(tema) <> ''),
  gancho text,
  -- Detalhes livres da ideia (descricao, publico, formato fino) — shape do agente.
  idea jsonb not null default '{}'::jsonb,
  legenda text,
  roteiro text,
  -- [{ordem, titulo, texto, prompt_imagem}] — texto do slide NUNCA vai na imagem (Lei 11).
  slides jsonb not null default '[]'::jsonb,
  -- [{slide, drive_file_id, provider}] — arquivos vivem no Drive (Lei 10).
  images jsonb not null default '[]'::jsonb,
  image_provider text,
  brand_voice_version int,
  generation_meta jsonb not null default '{}'::jsonb,
  generation_started_at timestamptz,
  generation_attempts int not null default 0,
  generation_error text,
  rejection_reason text,
  -- Data-alvo de publicação (data civil, não instante — Lei 1 não se aplica).
  scheduled_for date,
  post_url text,
  idea_approved_by uuid references profiles (id),
  idea_approved_at timestamptz,
  approved_by uuid references profiles (id),
  approved_at timestamptz,
  published_by uuid references profiles (id),
  published_at timestamptz,
  created_by uuid references profiles (id),      -- NULL = criado pelo pipeline
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_posts_gate1_shape check (
    status in ('ideia', 'rejeitado', 'descartado')
    or (idea_approved_by is not null and idea_approved_at is not null)),
  constraint content_posts_gate2_shape check (
    status not in ('aprovado', 'publicado')
    or (approved_by is not null and approved_at is not null)),
  constraint content_posts_published_shape check (
    status <> 'publicado' or published_at is not null),
  constraint content_posts_rejected_shape check (
    status <> 'rejeitado'
    or (rejection_reason is not null and btrim(rejection_reason) <> ''))
);
create index content_posts_status_idx on content_posts (status, created_at desc);

comment on table content_posts is
  'Posts sociais da fábrica de conteúdo (ADR-021). Agentes (n8n) criam IDEIAS; '
  'a admin aprova (portão 1); o pipeline gera roteiro/legenda/imagens e entrega '
  'RASCUNHO; a admin revisa/edita e aprova (portão 2); publicação manual no v1. '
  'Nasce SEMPRE ideia; transições só pelo mapa do content_posts_guard; DELETE '
  'proibido (descartado é estado). Imagens no Drive (Lei 10); texto fora da '
  'imagem (Lei 11).';

create or replace function public.content_posts_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'ideia' then
      raise exception 'post de conteúdo nasce como IDEIA — aprovações são transições';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'post de conteúdo % não se apaga (Lei 8) — use o estado descartado', old.id;
  end if;

  if old.status in ('publicado', 'descartado') then
    raise exception 'post % está % — imutável (Lei 8)', old.id, old.status;
  end if;

  if new.status <> old.status then
    if not (
      (old.status = 'ideia'          and new.status in ('ideia_aprovada', 'rejeitado', 'descartado')) or
      (old.status = 'ideia_aprovada' and new.status in ('gerando', 'descartado')) or
      (old.status = 'gerando'        and new.status in ('rascunho', 'ideia_aprovada', 'descartado')) or
      (old.status = 'rascunho'       and new.status in ('aprovado', 'rejeitado', 'descartado')) or
      (old.status = 'rejeitado'      and new.status in ('ideia_aprovada', 'descartado')) or
      (old.status = 'aprovado'       and new.status = 'publicado')
    ) then
      raise exception 'transição inválida de % para % no post %', old.status, new.status, old.id;
    end if;
  end if;

  if old.status = 'aprovado' then
    -- WHITELIST pós-aprovação (achado 26 de progress_reports): só publicação anda.
    if to_jsonb(new) - array['status', 'post_url', 'published_by', 'published_at', 'scheduled_for', 'updated_at']
       <> to_jsonb(old) - array['status', 'post_url', 'published_by', 'published_at', 'scheduled_for', 'updated_at'] then
      raise exception 'post % aprovado tem conteúdo congelado — só publicação/agenda mudam', old.id;
    end if;
  end if;

  -- Conteúdo de post rejeitado fica congelado como registro do portão: o motivo
  -- é o feedback; "tentar de novo" é transição, não edição.
  if old.status = 'rejeitado' and new.status = 'rejeitado' then
    raise exception 'post % rejeitado não se edita — tente de novo ou descarte', old.id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger content_posts_guard
  before insert or update or delete on content_posts
  for each row execute function public.content_posts_guard();

-- Lei 8: trilha completa (ator/diff) — padrão F1.
create trigger content_posts_audit
  after insert or update or delete on content_posts
  for each row execute function public.audit_row_change();

alter table content_posts enable row level security;

create policy content_posts_admin_all on content_posts
  for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

-- Lição 20260714000600: revoke explícito antes dos grants cirúrgicos.
revoke insert, update, delete, truncate on content_posts
from anon, authenticated, service_role;

grant select on content_posts to anon, authenticated;   -- RLS decide as linhas
grant insert, update on content_posts to authenticated; -- policy exige admin
-- Rotas /api/content/* (token próprio, ADR-021) escrevem via service_role.
-- DELETE: ninguém (o guard é a 2ª linha de defesa).
grant select, insert, update on content_posts to service_role;

-- ---------------------------------------------------------------------------
-- brand_voice_docs — documento de voz da marca, extraído 1× e cacheado (padrão
-- do template n8n #2648), versionado como ai_prompts (N45-D2): append-only,
-- no máximo 1 ativo, publicação SÓ via publish_brand_voice (admin).
-- ---------------------------------------------------------------------------
create table brand_voice_docs (
  id uuid primary key default gen_random_uuid(),
  version int not null unique check (version >= 1),
  content_md text not null check (btrim(content_md) <> ''),
  notes text,
  active boolean not null default false,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

-- No MÁXIMO um doc ativo (lineage única — sem name).
create unique index brand_voice_docs_one_active on brand_voice_docs ((1)) where active;

comment on table brand_voice_docs is
  'Voz da marca Personal Teacher (ADR-021), extraída 1× de conteúdos reais e '
  'cacheada para os agentes (padrão n8n #2648). Publicação SÓ via '
  'publish_brand_voice (admin); append-only por trigger próprio — única mutação '
  'permitida é o flip active true→false da própria RPC. Rollback = republicar '
  'conteúdo antigo com versão nova.';

create or replace function public.forbid_brand_voice_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'brand_voice_docs é append-only — TRUNCATE proibido (ADR-021)';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'brand_voice_docs é append-only — DELETE proibido; rollback = republicar versão antiga (ADR-021)';
  end if;
  if old.active = true and new.active = false
     and (to_jsonb(old) - 'active') = (to_jsonb(new) - 'active') then
    return new;
  end if;
  raise exception 'brand_voice_docs é append-only — única mutação permitida é a desativação feita por publish_brand_voice (ADR-021)';
end;
$$;

create trigger brand_voice_docs_append_only
  before update or delete on brand_voice_docs
  for each row execute function public.forbid_brand_voice_mutation();
create trigger brand_voice_docs_no_truncate
  before truncate on brand_voice_docs
  for each statement execute function public.forbid_brand_voice_mutation();

create trigger brand_voice_docs_audit
  after insert or update or delete on brand_voice_docs
  for each row execute function public.audit_row_change();

alter table brand_voice_docs enable row level security;

create policy brand_voice_docs_admin_read on brand_voice_docs
  for select to authenticated
  using ((select public.app_role()) = 'admin');

grant select on brand_voice_docs to anon, authenticated;
grant select on brand_voice_docs to service_role;       -- rota /api/content/fila
revoke truncate on brand_voice_docs from anon, authenticated, service_role;

create or replace function public.publish_brand_voice(
  p_content_md text,
  p_notes text default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version int;
  v_id uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'publish_brand_voice é restrita à admin (ADR-021)';
  end if;
  if p_content_md is null or btrim(p_content_md) = '' then
    raise exception 'p_content_md é obrigatório';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('publish_brand_voice', 0));

  -- Único UPDATE que o trigger append-only permite: flip active true→false.
  update brand_voice_docs set active = false where active;

  select coalesce(max(version), 0) + 1 into v_version from brand_voice_docs;

  insert into brand_voice_docs (version, content_md, notes, active, created_by)
  values (v_version, p_content_md, p_notes, true, auth.uid())
  returning id into v_id;

  perform public.log_audit(auth.uid(), 'publish_brand_voice', 'brand_voice_docs',
    v_id::text, jsonb_build_object('version', v_version));

  return v_version;
end;
$$;

revoke execute on function public.publish_brand_voice(text, text)
from public, anon, authenticated;
grant execute on function public.publish_brand_voice(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Notificação da admin (Lei 3: quem decide quem recebe é SQL) — digest de no
-- máximo 1 aviso por ETAPA por admin por DIA CIVIL, via dedupe_key com
-- business_today(). Canal: régua M4-3 pós-F7 ("tem número → recebe") — WhatsApp
-- quando whatsapp_e164 não-nulo, senão e-mail. SECURITY DEFINER obrigatório:
-- notification_outbox não tem grant de INSERT — só funções do owner enfileiram.
-- ---------------------------------------------------------------------------
create or replace function public.notify_content_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stage text;
  v_admin record;
  v_channel text;
begin
  if tg_op = 'INSERT' and new.status = 'ideia' then
    v_stage := 'ideias';
  elsif tg_op = 'UPDATE' and new.status = 'rascunho' and old.status = 'gerando' then
    v_stage := 'rascunhos';
  else
    return new;
  end if;

  for v_admin in
    select p.id, p.whatsapp_e164
    from profiles p
    where p.role = 'admin'
  loop
    v_channel := case
      when v_admin.whatsapp_e164 is not null then 'whatsapp'
      else 'email'
    end;
    insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
    values (
      v_channel,
      'content-review',
      v_admin.id,
      jsonb_build_object('stage', v_stage),
      format('content-review:%s:%s:%s', v_stage, v_admin.id, public.business_today())
    )
    on conflict (dedupe_key) do nothing;
  end loop;

  return new;
end;
$$;

create trigger content_posts_notify
  after insert or update of status on content_posts
  for each row execute function public.notify_content_review();
