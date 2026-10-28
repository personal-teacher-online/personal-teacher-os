-- IM-1 — biblioteca de imagens da Fábrica de Slides (ADR-023).
--
-- Até aqui as fotos das aulas nasciam FORA do sistema: eu gerava pelo MCP na
-- minha sessão, auditava numa contact sheet e commitava em brand/slides/library/.
-- Isso funcionou para M5–M7, mas prende a produção de conteúdo a mim e exige um
-- deploy para cada foto nova. Esta tabela move a biblioteca para dentro: a
-- dona gera, compara e aprova pelo painel.
--
-- MODELAGEM: a tabela É a biblioteca, com PASTA + NOME — o mesmo endereçamento
-- do disco (`m6/menu-reading.jpg`). Assim o conteúdo da aula continua apontando
-- para o mesmo caminho de sempre e o renderer ganha uma origem nova sem trocar
-- de contrato; as imagens já commitadas seguem valendo.
--
-- Lei 10: o arquivo vive no Google Drive (mesmo drive compartilhado dos decks).
-- Aqui fica só o ponteiro e a procedência.

create table slide_images (
  id uuid primary key default gen_random_uuid(),
  course text not null default 'personal-travel' check (btrim(course) <> ''),
  -- pasta da biblioteca: 'm6', 'vocab', 'shared' — igual ao disco
  folder text not null check (folder ~ '^[a-z0-9-]+$'),
  -- nome sem extensão: 'menu-reading'
  name text not null check (name ~ '^[a-z0-9-]+$'),

  -- procedência (Lei 8: quem pediu, com que texto, em que provedor)
  prompt text not null check (btrim(prompt) <> ''),
  framing text not null check (framing in ('paisagem', 'retrato', 'quadrado')),
  provider text not null,
  provider_handle text,

  status text not null default 'pendente' check (status in
    ('pendente', 'pronta', 'aprovada', 'reprovada', 'falhou')),
  -- candidatas devolvidas pelo provedor, para a curadoria comparar
  candidates jsonb not null default '[]'::jsonb,
  -- a escolhida, já no Drive
  drive_file_id text,
  drive_url text,
  error text,

  requested_by uuid references profiles (id),
  approved_by uuid references profiles (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Um endereço só pode ter UMA imagem viva. Reprovada/falhou não ocupam o
  -- endereço — assim dá para tentar de novo com o mesmo nome sem inventar
  -- sufixo, que foi o que fiz na mão ao regerar o cardápio e a maquininha.
  constraint slide_images_aprovada_tem_arquivo check (
    status <> 'aprovada' or (drive_file_id is not null and approved_by is not null
      and approved_at is not null))
);

create unique index slide_images_um_endereco_vivo
  on slide_images (course, folder, name)
  where status in ('pendente', 'pronta', 'aprovada');

create index slide_images_por_pasta on slide_images (course, folder)
  where status = 'aprovada';

comment on table slide_images is
  'Biblioteca de fotos das aulas (IM-1/ADR-023). Endereço = pasta/nome, igual ao '
  'disco; arquivo no Drive (Lei 10). Curadoria HUMANA: o provedor propõe, a '
  'professora aprova — nunca aprovação automática.';

-- Portão, no mesmo molde do slide_lessons_guard.
create or replace function public.slide_images_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pendente' then
      raise exception 'imagem nasce PENDENTE — a aprovação é transição';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'imagem % não se apaga (Lei 8) — use reprovada', old.id;
  end if;

  if old.status in ('aprovada', 'reprovada') and new.status <> old.status then
    raise exception 'imagem % já está % — estado final', old.id, old.status;
  end if;

  if new.status <> old.status then
    if not (
      (old.status = 'pendente' and new.status in ('pronta', 'falhou', 'reprovada')) or
      (old.status = 'pronta'   and new.status in ('aprovada', 'reprovada')) or
      (old.status = 'falhou'   and new.status = 'reprovada')
    ) then
      raise exception 'transição inválida de % para % na imagem %', old.status, new.status, old.id;
    end if;
  end if;

  -- O PROMPT é procedência: não se reescreve depois que a imagem existe, senão
  -- a auditoria passa a mentir sobre o que gerou aquela foto.
  if old.status <> 'pendente' and new.prompt <> old.prompt then
    raise exception 'o prompt da imagem % é procedência — não se reescreve', old.id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger slide_images_guard
  before insert or update or delete on slide_images
  for each row execute function public.slide_images_guard();

create trigger slide_images_audit
  after insert or update or delete on slide_images
  for each row execute function public.audit_row_change();

alter table slide_images enable row level security;

create policy slide_images_admin on slide_images
  for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

-- Lição 20260714000600: revoke explícito antes dos grants cirúrgicos. E sem o
-- GRANT a política de RLS nem chega a rodar — o Postgres barra antes, no
-- privilégio da tabela, e o painel do admin quebra inteiro. (Passou batido no
-- primeiro rascunho desta migration porque as RPCs são SECURITY DEFINER e
-- mascaravam a falta; o teste de RLS do teacher é que expôs.)
revoke insert, update, delete, truncate on slide_images
from anon, authenticated, service_role;

-- `anon` também recebe SELECT, e a RLS é que devolve zero linhas. Não é
-- descuido: a convenção da casa (caso 12 do tests/rls.test.ts) exige que o
-- anônimo veja VAZIO, nunca "permission denied" — o erro vaza que a tabela
-- existe. A primeira versão desta migration concedia só a `authenticated` e
-- quebrou aquele teste.
grant select on slide_images to anon, authenticated;   -- RLS decide as linhas
grant insert, update on slide_images to authenticated; -- policy exige admin
-- O disparo ao provedor e o upload ao Drive rodam no servidor; DELETE: ninguém.
grant select, insert, update on slide_images to service_role;

-- ---------------------------------------------------------------- RPCs (Lei 3)

create or replace function public.slide_image_request(
  p_course text,
  p_folder text,
  p_name text,
  p_prompt text,
  p_framing text,
  p_provider text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin pede imagem';
  end if;
  insert into slide_images (course, folder, name, prompt, framing, provider, requested_by)
  values (p_course, p_folder, p_name, p_prompt, p_framing, p_provider, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.slide_image_request is
  'Abre o pedido de imagem (pendente). O disparo ao provedor é do app; o handle '
  'volta por slide_image_started.';

create or replace function public.slide_image_started(p_id uuid, p_handle text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin';
  end if;
  update slide_images set provider_handle = p_handle
   where id = p_id and status = 'pendente';
  if not found then
    raise exception 'imagem % não está pendente', p_id;
  end if;
end;
$$;

create or replace function public.slide_image_ready(p_id uuid, p_candidates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin';
  end if;
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) = 0 then
    raise exception 'imagem pronta exige pelo menos uma candidata';
  end if;
  update slide_images set status = 'pronta', candidates = p_candidates, error = null
   where id = p_id and status = 'pendente';
  if not found then
    raise exception 'imagem % não está pendente', p_id;
  end if;
end;
$$;

create or replace function public.slide_image_failed(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin';
  end if;
  update slide_images set status = 'falhou', error = p_error
   where id = p_id and status = 'pendente';
  if not found then
    raise exception 'imagem % não está pendente', p_id;
  end if;
end;
$$;

-- A APROVAÇÃO é humana e exige o arquivo já no Drive: sem file id não existe
-- imagem aprovada (o CHECK garante, isto dá a mensagem boa).
create or replace function public.slide_image_approve(
  p_id uuid,
  p_drive_file_id text,
  p_drive_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin aprova imagem';
  end if;
  if coalesce(btrim(p_drive_file_id), '') = '' then
    raise exception 'aprovação exige o arquivo já no Drive';
  end if;
  update slide_images
     set status = 'aprovada', drive_file_id = p_drive_file_id, drive_url = p_drive_url,
         approved_by = auth.uid(), approved_at = now()
   where id = p_id and status = 'pronta';
  if not found then
    raise exception 'imagem % não está pronta para aprovação', p_id;
  end if;
end;
$$;

create or replace function public.slide_image_reject(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin reprova imagem';
  end if;
  update slide_images set status = 'reprovada'
   where id = p_id and status in ('pendente', 'pronta', 'falhou');
  if not found then
    raise exception 'imagem % não pode ser reprovada agora', p_id;
  end if;
end;
$$;
