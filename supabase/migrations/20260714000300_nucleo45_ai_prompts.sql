-- Núcleo 4/5 / N1 — ai_prompts: prompts versionados em tabela + repo (N45-D2;
-- CLAUDE.md §Stack: "prompts versionados em tabela + repo"). A tabela é a fonte
-- em EXECUÇÃO das rotinas Claude da Fase 4; o conteúdo canônico também vive no
-- repo (formato decidido na Fase 4).
--
-- model NOT NULL: prompt ativo sem model é estado inválido (as rotinas F4
-- escolhem Haiku/Sonnet POR ROTINA — CLAUDE.md). params NOT NULL default '{}'.

create table ai_prompts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  version int not null check (version >= 1),
  content text not null,
  model text not null check (btrim(model) <> ''),
  params jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  unique (name, version)
);

-- No MÁXIMO um ativo por name (N45-D2).
create unique index ai_prompts_one_active_per_name on ai_prompts (name) where active;

comment on table ai_prompts is 'Prompts das rotinas Claude (Fase 4), versionados. Publicação SÓ via publish_ai_prompt (admin, D10); append-only por trigger próprio — a única mutação permitida é o flip active true→false feito pela própria RPC. Rollback = republicar a versão antiga com número novo (não existe RPC de desativação sem substituta no v1; zero-ativas só ocorre antes da primeira publicação de um name).';

-- ---------------------------------------------------------------------------
-- Append-only por trigger PRÓPRIO (padrão forbid_closed_statement_mutation,
-- 20260713000600 — NÃO o forbid_mutation genérico, que rejeitaria o próprio
-- publish): a ÚNICA mutação permitida é o UPDATE que flipa active true→false
-- com TODAS as demais colunas idênticas — exatamente como publish_ai_prompt
-- desativa a versão anterior.
-- ---------------------------------------------------------------------------
create or replace function public.forbid_ai_prompt_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'ai_prompts é append-only — TRUNCATE proibido (N45-D2)';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'ai_prompts é append-only — DELETE proibido; rollback = republicar versão antiga (N45-D2)';
  end if;
  if old.active = true and new.active = false
     and (to_jsonb(old) - 'active') = (to_jsonb(new) - 'active') then
    return new;
  end if;
  raise exception 'ai_prompts é append-only — única mutação permitida é a desativação feita por publish_ai_prompt (N45-D2)';
end;
$$;

create trigger ai_prompts_append_only
  before update or delete on ai_prompts
  for each row execute function public.forbid_ai_prompt_mutation();
create trigger ai_prompts_no_truncate
  before truncate on ai_prompts
  for each statement execute function public.forbid_ai_prompt_mutation();

-- Lei 8: auditoria universal também aqui (mesmo trigger genérico do M2).
create trigger ai_prompts_audit
  after insert or update or delete on ai_prompts
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- RLS + grants: leitura admin (+service_role para as rotinas). Escrita: NENHUM
-- grant de INSERT/UPDATE/DELETE (mecanismo ADR-012/D10 — escrita só pela RPC
-- SECURITY DEFINER do owner). anon/authenticated sem policy veem zero linhas.
-- ---------------------------------------------------------------------------
alter table ai_prompts enable row level security;

create policy ai_prompts_admin_read on ai_prompts
  for select to authenticated
  using ((select public.app_role()) = 'admin');

grant select on ai_prompts to anon, authenticated;
grant select on ai_prompts to service_role;

-- Painel do gate N1 (13/07/2026): tabelas novas nascem com TRUNCATE via
-- ALTER DEFAULT PRIVILEGES do ambiente (RLS não governa TRUNCATE) — o
-- "NENHUM grant de escrita" exige o revoke explícito, como em class_audits e
-- nos ledgers. O trigger ai_prompts_no_truncate segue como 2ª linha de defesa.
revoke truncate on ai_prompts from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- publish_ai_prompt — publica a próxima versão de um name e a ativa,
-- desativando a anterior (transacional, auditado). Admin-only (D10).
-- Corrida de dois publishes do mesmo name: serializada pelo idioma da casa —
-- advisory lock nomeado (padrão book_mentorship_session) — com UNIQUE(name,
-- version) e o índice parcial de active como cintos de segurança.
-- ---------------------------------------------------------------------------
create or replace function public.publish_ai_prompt(
  p_name text,
  p_content text,
  p_model text,
  p_params jsonb default '{}'::jsonb
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
    raise exception 'publish_ai_prompt é restrita à admin (D10)';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'p_name é obrigatório';
  end if;
  if p_content is null or btrim(p_content) = '' then
    raise exception 'p_content é obrigatório';
  end if;
  if p_model is null or btrim(p_model) = '' then
    raise exception 'p_model é obrigatório (prompt ativo sem model é estado inválido — N45-D2)';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('publish_prompt:' || p_name, 0));

  -- Único UPDATE que o trigger append-only permite: flip active true→false.
  update ai_prompts set active = false where name = p_name and active;

  select coalesce(max(version), 0) + 1 into v_version
  from ai_prompts where name = p_name;

  insert into ai_prompts (name, version, content, model, params, active, created_by)
  values (p_name, v_version, p_content, p_model, coalesce(p_params, '{}'::jsonb), true, auth.uid())
  returning id into v_id;

  perform public.log_audit(auth.uid(), 'publish_ai_prompt', 'ai_prompts', v_id::text,
    jsonb_build_object('name', p_name, 'version', v_version, 'model', p_model));

  return v_version;
end;
$$;

revoke execute on function public.publish_ai_prompt(text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.publish_ai_prompt(text, text, text, jsonb)
to authenticated;
