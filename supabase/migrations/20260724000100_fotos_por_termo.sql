-- M-H2 — foto POR TERMO nos cards de vocabulário (ADR-023/024, item 9 do lote).
--
-- O IM-1 (20260722000100) deu à biblioteca UM endereço vivo por (course,
-- folder, name): aprovar é terminal e trocar exigia supersede/migration — gap
-- registrado como follow-up. Este é o follow-up, restrito ao NAMESPACE de
-- vocabulário (cena por âncora fica para o lote futuro, ADR-024 §4).
--
-- O endereço lógico do vocab é `m{module}/a{lesson}-vocab-{anchorId}` — o
-- anchorId é a identidade OPACA e persistida do card (src/lib/slides/anchors.ts),
-- NUNCA derivada do texto do termo. No banco vira folder='m{module}',
-- name='a{lesson}-vocab-{anchorId}' (o CHECK de name, `^[a-z0-9-]+$`, aceita: o
-- anchorId são 8 hex do uuid, sem hífen).
--
-- DESENHO DE VERSÃO/CABEÇA:
--   • Aprovar uma candidata NOVA para um endereço que JÁ tem aprovada cria uma
--     linha NOVA (version = anterior + 1) e liga supersedes_id à cabeça antiga.
--   • A linha antiga NUNCA é editada nem apagada — Lei 2/7/8: append puro. A
--     CABEÇA é DERIVADA por max(version) entre as aprovadas do endereço. Sem
--     coluna is_head, sem UPDATE de estado; a imutabilidade da aprovada é travada
--     no PORTÃO (guard rejeita QUALQUER update em linha aprovada), e a
--     substituição é auditada (log_audit no supersede/approve_and_link).
--
-- Estende a 20260722000100 SEM quebrá-la (migration nova, Lei 7): colunas
-- aditivas, RPCs do IM-1 seguem valendo, RLS admin-only intacta.

alter table slide_images
  add column version int not null default 1,
  add column supersedes_id uuid references slide_images (id),
  -- teto financeiro: quantas candidatas ESTE pedido pediu (1..4). A soma dos
  -- pedidos em voo por aula é o teto real (Rodada de correção, item 3).
  add column requested_count int not null default 1 check (requested_count between 1 and 4);

comment on column slide_images.version is
  'M-H2: versão da foto NESTE endereço (course/folder/name). A cabeça ativa é a '
  'aprovada de maior version — derivada, nunca materializada.';
comment on column slide_images.supersedes_id is
  'M-H2: a foto aprovada que esta substituiu (cadeia de auditoria da troca). '
  'NULL na primeira aprovação de um endereço.';
comment on column slide_images.requested_count is
  'M-H2: candidatas pedidas neste pedido (1..4). O teto por aula soma isto entre '
  'os pedidos EM VOO — conta pedidos, não chamadas de RPC.';

-- ÍNDICES. O `um endereço vivo` global do IM-1 impedia DUAS aprovadas no mesmo
-- endereço. Com versão isso muda SÓ para vocab; a CENA precisa manter o
-- invariante antigo (senão a corrida "aba A aprova v1 / aba B com form velho
-- aprova v2 sem supersede nem auditoria" cria uma cabeça órfã — item 1):
--   (cena) UM vivo por endereço, exatamente como antes, restrito a nomes que NÃO
--     são do namespace de vocab. O classificador é o padrão COMPLETO
--     `^a[0-9]+-vocab-[0-9a-f]{8}$` (não um `like '%-vocab-%'` largo, que soltaria
--     a proteção da cena para qualquer nome legado contendo '-vocab-');
--   (todos) UMA geração em voo por endereço (pendente/pronta) — freio anti duplo
--     clique e anti-pedido-concorrente;
--   (todos) versões APROVADAS distintas por endereço — max(version) inequívoco.
--     Parcial (where aprovada) de propósito: o legado tem ≤1 aprovada por
--     endereço, seguro sobre os dados já no banco compartilhado.
drop index slide_images_um_endereco_vivo;

create unique index slide_images_cena_um_vivo
  on slide_images (course, folder, name)
  where status in ('pendente', 'pronta', 'aprovada')
    and name !~ '^a[0-9]+-vocab-[0-9a-f]{8}$';

create unique index slide_images_uma_geracao_no_ar
  on slide_images (course, folder, name)
  where status in ('pendente', 'pronta');

create unique index slide_images_versao_aprovada_unica
  on slide_images (course, folder, name, version)
  where status = 'aprovada';

-- ---------------------------------------------------------------------------
-- PORTÃO: linha aprovada é IMUTÁVEL (item 2). A versão do IM-1 concedia UPDATE e
-- só barrava DELETE e transições de estado — logo `drive_file_id`/`version`/
-- `supersedes_id` de uma aprovada eram editáveis. Aqui: nenhum UPDATE toca uma
-- linha já aprovada. A supersede atua na linha NOVA (pronta→aprovada); a antiga
-- não recebe update nenhum, então travar tudo é seguro.
-- ---------------------------------------------------------------------------
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

  -- M-H2: aprovada é IMUTÁVEL — nem estado, nem campo. A cabeça derivada nunca
  -- precisa de update (a supersede escreve na linha nova).
  if old.status = 'aprovada' then
    raise exception 'imagem % está aprovada — linha imutável (Lei 8)', old.id;
  end if;

  if old.status = 'reprovada' and new.status <> old.status then
    raise exception 'imagem % já está reprovada — estado final', old.id;
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

  -- O PROMPT é procedência: não se reescreve depois que a imagem existe.
  if old.status <> 'pendente' and new.prompt <> old.prompt then
    raise exception 'o prompt da imagem % é procedência — não se reescreve', old.id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- slide_image_request: ganha p_count (1..4) e calcula a version (max+1 do
-- endereço) sob lock advisório. Para VOCAB o lock é por AULA (course+folder+
-- prefixo a{lesson}-vocab-) e valida ATOMICAMENTE o teto de 8 pedidos EM VOO
-- (soma de requested_count), item 3. Para CENA o lock é por endereço (sem teto).
-- Assinatura muda (novo parâmetro) → DROP + CREATE (o overload de 6 args ficaria
-- ambíguo), no molde da 20260723000100.
-- ---------------------------------------------------------------------------
drop function public.slide_image_request(text, text, text, text, text, text);

create function public.slide_image_request(
  p_course text,
  p_folder text,
  p_name text,
  p_prompt text,
  p_framing text,
  p_provider text,
  p_count int default 1
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_version int;
  v_prefix text;
  v_emvoo int;
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin pede imagem';
  end if;
  if p_count < 1 or p_count > 4 then
    raise exception 'candidatas por pedido fora de 1..4 (recebido %)', p_count;
  end if;

  if p_name ~ '^a[0-9]+-vocab-[0-9a-f]{8}$' then
    -- escopo da AULA = course + folder + prefixo 'a{lesson}-vocab-'. Só o
    -- namespace REAL de vocab (padrão completo) entra aqui; qualquer outro nome
    -- (inclusive um patológico 'a1-vocab-x' não-hex) é tratado como cena.
    v_prefix := substring(p_name from '^(a[0-9]+-vocab-)');
    perform pg_advisory_xact_lock(
      hashtextextended('slide_image_aula:' || p_course || '/' || p_folder || '/' ||
        coalesce(v_prefix, p_name), 0));
    select coalesce(sum(requested_count), 0) into v_emvoo
      from slide_images
     where course = p_course and folder = p_folder and name like v_prefix || '%'
       and status in ('pendente', 'pronta');
    if v_emvoo + p_count > 8 then
      raise exception 'teto de 8 gerações em voo por aula (em voo: %, pedido: %)', v_emvoo, p_count;
    end if;
  else
    perform pg_advisory_xact_lock(
      hashtextextended('slide_image_addr:' || p_course || '/' || p_folder || '/' || p_name, 0));
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from slide_images
   where course = p_course and folder = p_folder and name = p_name;

  insert into slide_images
    (course, folder, name, prompt, framing, provider, requested_by, version, requested_count)
  values
    (p_course, p_folder, p_name, p_prompt, p_framing, p_provider, auth.uid(), v_version, p_count)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- slide_image_approve (IM-1): agora sob lock advisório e RECUSA endereço que já
-- tenha aprovada — a segunda aprovação PRECISA ser supersede (item 1). Fecha a
-- corrida das duas abas: mesmo o form velho da cena não cria cabeça órfã.
-- ---------------------------------------------------------------------------
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
declare
  v_img slide_images%rowtype;
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin aprova imagem';
  end if;
  if coalesce(btrim(p_drive_file_id), '') = '' then
    raise exception 'aprovação exige o arquivo já no Drive';
  end if;

  select * into v_img from slide_images where id = p_id;
  if not found then
    raise exception 'imagem % não existe', p_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('slide_image_addr:' || v_img.course || '/' || v_img.folder || '/' || v_img.name, 0));

  if exists (
    select 1 from slide_images
     where course = v_img.course and folder = v_img.folder and name = v_img.name
       and status = 'aprovada'
  ) then
    raise exception 'endereço %/% já tem foto aprovada — use slide_image_supersede para trocar',
      v_img.folder, v_img.name;
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

-- ---------------------------------------------------------------------------
-- slide_image_supersede: aprova uma candidata PRONTA como nova CABEÇA de um
-- endereço que já tem aprovada. NUNCA toca a antiga (o guard proíbe). Sob lock
-- advisório do endereço (item 1), para serializar contra approve/approve_and_link.
-- ---------------------------------------------------------------------------
create or replace function public.slide_image_supersede(
  p_id uuid,
  p_drive_file_id text,
  p_drive_url text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nova slide_images%rowtype;
  v_cabeca slide_images%rowtype;
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin aprova imagem';
  end if;
  if coalesce(btrim(p_drive_file_id), '') = '' then
    raise exception 'aprovação exige o arquivo já no Drive';
  end if;

  select * into v_nova from slide_images where id = p_id;
  if not found then
    raise exception 'imagem % não existe', p_id;
  end if;
  if v_nova.status <> 'pronta' then
    raise exception 'imagem % não está pronta para aprovação', p_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('slide_image_addr:' || v_nova.course || '/' || v_nova.folder || '/' || v_nova.name, 0));

  select * into v_cabeca
    from slide_images
   where course = v_nova.course and folder = v_nova.folder and name = v_nova.name
     and status = 'aprovada'
   order by version desc
   limit 1;
  if not found then
    raise exception 'endereço %/%/% não tem foto aprovada — use slide_image_approve para a primeira',
      v_nova.course, v_nova.folder, v_nova.name;
  end if;

  update slide_images
     set status = 'aprovada', drive_file_id = p_drive_file_id, drive_url = p_drive_url,
         approved_by = auth.uid(), approved_at = now(), supersedes_id = v_cabeca.id
   where id = p_id and status = 'pronta';
  if not found then
    raise exception 'imagem % não está pronta para aprovação', p_id;
  end if;

  perform public.log_audit(auth.uid(), 'supersede_slide_image', 'slide_images', p_id::text,
    jsonb_build_object(
      'address', v_nova.folder || '/' || v_nova.name, 'course', v_nova.course,
      'supersedes_id', v_cabeca.id, 'old_version', v_cabeca.version, 'new_version', v_nova.version));

  return p_id;
end;
$$;

comment on function public.slide_image_supersede is
  'M-H2: aprova uma candidata pronta como nova CABEÇA de um endereço que já tem '
  'aprovada. Append puro (Lei 8): a antiga permanece intocada; cabeça por '
  'max(version). Para a PRIMEIRA aprovação, use slide_image_approve.';

-- ---------------------------------------------------------------------------
-- slide_image_approve_and_link (item 6): aprovação de VOCAB ATÔMICA. Numa única
-- transação: valida o vínculo imagem×aula×âncora contra o CONTEÚDO FRESCO,
-- aprova (ou supersede se já há cabeça) e grava o endereço no card via jsonb_set.
-- Só imageId + anchorId + candidate_index vêm do chamador; o endereço e o card
-- são DERIVADOS e conferidos no servidor. Sem 2 transações → sem cabeça órfã.
-- ---------------------------------------------------------------------------
create or replace function public.slide_image_approve_and_link(
  p_lesson_id uuid,
  p_image_id uuid,
  p_anchor_id text,
  p_candidate_index int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_les_status text;
  v_content jsonb;
  v_course text;
  v_module int;
  v_lesson int;
  v_img slide_images%rowtype;
  v_folder text;
  v_name text;
  v_cand jsonb;
  v_drive text;
  v_url text;
  v_ext text;
  v_slides jsonb;
  v_slide jsonb;
  v_cards jsonb;
  v_si int;
  v_ci int;
  v_found_si int := -1;
  v_found_ci int := -1;
  v_matches int := 0;
  v_cabeca slide_images%rowtype;
  v_address text;
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin aprova imagem';
  end if;
  if p_anchor_id !~ '^[0-9a-f]{8}$' then
    raise exception 'anchorId inválido (%)', p_anchor_id;
  end if;

  -- AULA (fresca, travada): tem de estar em rascunho.
  select status, content, course, module, lesson
    into v_les_status, v_content, v_course, v_module, v_lesson
    from slide_lessons where id = p_lesson_id for update;
  if v_les_status is null then
    raise exception 'aula % não existe', p_lesson_id;
  end if;
  if v_les_status <> 'rascunho' then
    raise exception 'aula % está % — reabra para editar', p_lesson_id, v_les_status;
  end if;

  -- IMAGEM: pronta, do mesmo curso, no endereço DERIVADO da aula+âncora.
  select * into v_img from slide_images where id = p_image_id;
  if not found then
    raise exception 'imagem % não existe', p_image_id;
  end if;
  if v_img.status <> 'pronta' then
    raise exception 'imagem % não está pronta para aprovação', p_image_id;
  end if;
  if v_img.course <> v_course then
    raise exception 'imagem % é de outro curso', p_image_id;
  end if;
  v_folder := 'm' || v_module;
  v_name := 'a' || v_lesson || '-vocab-' || p_anchor_id;
  if v_img.folder <> v_folder or v_img.name <> v_name then
    raise exception 'imagem % não pertence a este card (endereço %/% <> %/%)',
      p_image_id, v_img.folder, v_img.name, v_folder, v_name;
  end if;

  -- CARD: acha o slide/card com este anchorId no conteúdo fresco. Âncora
  -- DUPLICADA no doc (legado corrompido) é AMBÍGUA — aborta em vez de ligar
  -- silenciosamente o último card (item 1). O save já saneia (ensureVocabAnchors
  -- + refine do LessonSchema), então isto é a rede final.
  v_slides := v_content->'slides';
  for v_si in 0 .. coalesce(jsonb_array_length(v_slides), 0) - 1 loop
    v_slide := v_slides->v_si;
    if v_slide->>'type' = 'vocab' then
      v_cards := v_slide->'cards';
      for v_ci in 0 .. coalesce(jsonb_array_length(v_cards), 0) - 1 loop
        if v_cards->v_ci->>'anchorId' = p_anchor_id then
          v_found_si := v_si; v_found_ci := v_ci; v_matches := v_matches + 1;
        end if;
      end loop;
    end if;
  end loop;
  if v_matches = 0 then
    raise exception 'card com anchorId % não está no conteúdo da aula %', p_anchor_id, p_lesson_id;
  end if;
  if v_matches > 1 then
    raise exception 'anchorId % está DUPLICADO no conteúdo da aula % (% ocorrências) — salve a aula para sanear',
      p_anchor_id, p_lesson_id, v_matches;
  end if;

  -- CANDIDATA escolhida → drive/url/ext (derivados, não confiados ao form).
  v_cand := (v_img.candidates)->p_candidate_index;
  if v_cand is null then
    raise exception 'candidata % não existe', p_candidate_index;
  end if;
  v_drive := v_cand->>'driveFileId';
  v_url := v_cand->>'url';
  v_ext := lower(split_part(coalesce(v_cand->>'mimeType', 'image/jpg'), '/', 2));
  if v_ext = '' then v_ext := 'jpg'; end if;
  if coalesce(btrim(v_drive), '') = '' then
    raise exception 'candidata % sem arquivo no Drive', p_candidate_index;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('slide_image_addr:' || v_img.course || '/' || v_folder || '/' || v_name, 0));

  -- já há cabeça? então é SUPERSEDE; senão, PRIMEIRA aprovação.
  select * into v_cabeca
    from slide_images
   where course = v_img.course and folder = v_folder and name = v_name and status = 'aprovada'
   order by version desc limit 1;

  if found then
    -- cabeça existe → SUPERSEDE (linha nova; a antiga fica intocada)
    update slide_images
       set status = 'aprovada', drive_file_id = v_drive, drive_url = v_url,
           approved_by = auth.uid(), approved_at = now(), supersedes_id = v_cabeca.id
     where id = p_image_id and status = 'pronta';
    if not found then
      raise exception 'imagem % não está pronta para aprovação', p_image_id;
    end if;
    perform public.log_audit(auth.uid(), 'supersede_slide_image', 'slide_images', p_image_id::text,
      jsonb_build_object('address', v_folder || '/' || v_name, 'course', v_img.course,
        'supersedes_id', v_cabeca.id, 'old_version', v_cabeca.version, 'new_version', v_img.version));
  else
    -- primeira aprovação do endereço
    update slide_images
       set status = 'aprovada', drive_file_id = v_drive, drive_url = v_url,
           approved_by = auth.uid(), approved_at = now()
     where id = p_image_id and status = 'pronta';
    if not found then
      raise exception 'imagem % não está pronta para aprovação', p_image_id;
    end if;
  end if;

  -- grava o endereço COM extensão no card (resolve.ts exige pasta/nome.ext),
  -- na MESMA transação — se isto falhar, a aprovação inteira reverte.
  v_address := v_folder || '/' || v_name || '.' || v_ext;
  v_content := jsonb_set(v_content,
    array['slides', v_found_si::text, 'cards', v_found_ci::text, 'image'],
    to_jsonb(v_address), true);
  update slide_lessons set content = v_content where id = p_lesson_id;

  return v_address;
end;
$$;

comment on function public.slide_image_approve_and_link is
  'M-H2 (item 6): aprovação de vocab ATOMICA — valida vinculo imagem x aula x '
  'ancora no conteudo fresco, aprova/supersede e grava o endereco no card num so passo.';
