-- Briefing v2 — NÚCLEO (spec aprovada em docs/goals/briefing-v2.md, 28/07/2026).
-- Sub-lote 1 da onda do Portal: só BANCO. A coleta v2 (dicionário, telas) vem no
-- sub-lote 2; esta migration põe de pé as três peças que a UI vai precisar:
--
--   (a) `briefings.schema_version` — a linha carrega a regra sob a qual nasceu.
--       Linha carimbada 1 submete pela regra v1 INTOCADA; carimbada 2, pela
--       regra ramificada. O DEFAULT continua 1 nesta migration de propósito
--       (ver a nota no bloco (a)).
--   (b) `briefing_revisions` — correção pós-envio append-only. Antes desta
--       migration a imutabilidade do briefing era "ninguém corrige"; agora é
--       "todo estado anterior é reconstruível" (motivo + de/para + snapshot).
--   (c) `_briefing_submit` ramificado por schema_version e, no v2, por
--       `students.student_type` (criança não responde pergunta de adulto).
--
-- Regra que atravessa o arquivo: obrigatório é obrigatório em CONTEÚDO, não em
-- presença de chave. Um campo só conta como respondido se for do tipo certo
-- (seção d) e tiver caractere de verdade (seção 0); e a correção pós-envio
-- (seção c) valida o RESULTADO pela régua da própria linha antes de gravar —
-- é a única porta que escreve em `answers` fora do fluxo de envio.
--
-- Leis: 3 (a obrigatoriedade por ramo é do BANCO — a UI só antecipa o erro),
-- 7 (migration nova; 20260720000100_briefing.sql NÃO foi tocada), 8 (log_audit
-- em toda revisão).

-- ===========================================================================
-- (0) RÉGUA ÚNICA DE "EM BRANCO"
-- ===========================================================================
-- `btrim()` apara só uma lista fixa de caracteres nas pontas: uma resposta feita
-- de tabulação e quebra de linha ("\t\n") atravessava esse filtro como texto
-- real e o envio aceitava campo obrigatório vazio. A régua desta migration é
-- outra: se sobrar ZERO caractere depois de remover TODO whitespace, o campo
-- está em branco. Mora numa função só para não haver duas réguas — é usada por
-- _briefing_txt, _briefing_itens, pelo CHECK de briefing_revisions.reason e pelo
-- motivo exigido na RPC de revisão.
-- SEM revoke de propósito (as irmãs _briefing_txt/_briefing_itens também não têm):
-- o CHECK é avaliado com o privilégio de quem insere, então revogar execute aqui
-- quebraria o INSERT em vez de proteger algo — a função não lê nada, só conta
-- caracteres.
create or replace function public._briefing_em_branco(p_txt text)
returns boolean
language sql
immutable
as $$ select p_txt is null or regexp_replace(p_txt, '\s', '', 'g') = '' $$;

comment on function public._briefing_em_branco(text) is
  'true quando o texto é NULL ou só whitespace (qualquer um, não só o que o btrim apara). Régua única de campo em branco do briefing.';

-- ===========================================================================
-- (a) VERSÃO DE ESQUEMA DA LINHA
-- ===========================================================================
-- O default fica em 1 NESTA migration, de propósito. O banco chega antes da UI:
-- entre este deploy e o do sub-lote 2 quem responde o briefing ainda vê as telas
-- v1, e o briefing é BLOQUEANTE no primeiro acesso — carimbar 2 aqui deixaria o
-- aluno novo preso numa tela que não consegue satisfazer a validação v2.
alter table public.briefings
  add column schema_version smallint not null default 1;

alter table public.briefings
  add constraint briefings_schema_version_check check (schema_version in (1, 2));

comment on column public.briefings.schema_version is
  'Versão do questionário sob a qual a linha foi COLETADA. 1 = briefing original '
  '(19/07); 2 = briefing v2 (ramo criança/adulto, 8 perguntas novas). A regra de '
  'obrigatoriedade do envio é escolhida por esta coluna — rascunho começado no v1 '
  'termina no v1. DEFAULT ainda é 1: o flip para 2 acompanha a UI v2, na migration '
  'do sub-lote 2 (ver goal onda-portal P2).';

-- ===========================================================================
-- (b) CORREÇÃO PÓS-ENVIO — briefing_revisions (append-only)
-- ===========================================================================
create table briefing_revisions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students (id),
  -- quem corrigiu (admin); não referencia profiles por simetria com
  -- briefings.filled_by, que também é uuid solto.
  actor uuid not null,
  -- mesma régua da RPC (seção 0): "\t\n" não é motivo.
  reason text not null check (not public._briefing_em_branco(reason)),
  -- {"secao.chave": {"de": <valor antigo>, "para": <valor novo>}, ...}
  changes jsonb not null,
  -- o `answers` INTEIRO como estava antes da correção
  snapshot_before jsonb not null,
  created_at timestamptz not null default now()
);

comment on table briefing_revisions is
  'Correções feitas no briefing DEPOIS do envio, uma linha por correção. '
  'Append-only: o histórico é o que permite reconstruir qualquer estado anterior '
  'das respostas. Escrita SÓ pela RPC admin_revise_briefing.';

create index briefing_revisions_student_idx
  on briefing_revisions (student_id, created_at desc);

create trigger briefing_revisions_append_only
  before update or delete on briefing_revisions
  for each row execute function public.forbid_mutation();

create trigger briefing_revisions_no_truncate
  before truncate on briefing_revisions
  for each statement execute function public.forbid_mutation();

alter table briefing_revisions enable row level security;

-- Só a admin lê o histórico de correção (aluno e professora leem o briefing
-- corrigido, não a trilha de quem errou o quê).
create policy briefing_revisions_admin on briefing_revisions
  for select to authenticated
  using ((select public.app_role()) = 'admin');

-- Escrita: nenhuma policy e nenhum grant — só a RPC security definer entra.
-- O grant de select abre a porta; a policy acima decide a linha (anon incluso
-- pela convenção da casa: devolve vazio silencioso).
grant select on briefing_revisions to anon, authenticated, service_role;
revoke insert, update, delete, truncate on briefing_revisions
  from anon, authenticated, service_role;

-- ===========================================================================
-- (c) RPC DE REVISÃO
-- ===========================================================================
create or replace function public.admin_revise_briefing(
  p_student uuid,
  p_patch jsonb,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row briefings%rowtype;
  v_secao text;
  v_chave text;
  v_changes jsonb := '{}'::jsonb;
  v_answers jsonb;
  v_valor jsonb;
  v_de jsonb;
  v_para jsonb;
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin';
  end if;
  if public._briefing_em_branco(p_reason) then
    raise exception 'a correção precisa de um motivo (fica no histórico do aluno)';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'nada para corrigir: informe ao menos um campo';
  end if;

  select * into v_row from briefings where student_id = p_student for update;
  if not found then
    raise exception 'briefing ainda não iniciado';
  end if;
  -- Revisão é para o que já foi ENVIADO. Rascunho se edita direto — corrigir um
  -- rascunho geraria trilha de correção de algo que ninguém entregou.
  if v_row.status <> 'submitted' then
    raise exception 'briefing ainda é rascunho — edite direto (admin_fill_briefing); revisão só depois do envio';
  end if;

  -- Kolb é intocável (instrumento calibrado: mudar resposta muda o estilo
  -- calculado). Qualquer chave de topo fora das 5 seções cai aqui junto.
  for v_secao in select jsonb_object_keys(p_patch) loop
    if v_secao not in ('historia', 'objetivos', 'interesses', 'rotina', 'livre') then
      raise exception 'revisão não altera "%": só as seções historia, objetivos, interesses, rotina e livre (o teste de estilo é intocável)', v_secao;
    end if;
    if jsonb_typeof(p_patch -> v_secao) <> 'object' then
      raise exception 'a correção da seção "%" precisa ser um objeto {chave: valor}', v_secao;
    end if;
    -- FORMA do valor, antes de qualquer merge: a RPC roda como dona da tabela e
    -- escreve direto em `answers`, então um patch malformado seria gravado sem
    -- passar por validação nenhuma. As respostas do briefing são rótulos de
    -- texto (string), múltipla escolha (array de strings) ou sub-objeto
    -- (rotina.blocos) — número e booleano crus não são resposta.
    for v_chave in select jsonb_object_keys(p_patch -> v_secao) loop
      v_valor := p_patch -> v_secao -> v_chave;
      if jsonb_typeof(v_valor) = 'null' then
        raise exception 'a correção de "%.%" não apaga a resposta: envie o valor novo', v_secao, v_chave;
      end if;
      if jsonb_typeof(v_valor) not in ('string', 'array', 'object') then
        raise exception 'a correção de "%.%" precisa ser texto, lista ou objeto (recebi %)', v_secao, v_chave, jsonb_typeof(v_valor);
      end if;
    end loop;
  end loop;

  v_answers := coalesce(v_row.answers, '{}'::jsonb);

  -- Passo 1: o de/para. Chave cujo valor novo é IGUAL ao atual não entra —
  -- reenviar a mesma resposta não é correção, e uma linha de revisão sem
  -- mudança nenhuma polui o histórico que a admin lê na ficha.
  for v_secao in select jsonb_object_keys(p_patch) loop
    for v_chave in select jsonb_object_keys(p_patch -> v_secao) loop
      v_de   := coalesce(v_answers -> v_secao -> v_chave, 'null'::jsonb);
      v_para := p_patch -> v_secao -> v_chave;
      if v_de is distinct from v_para then
        v_changes := v_changes || jsonb_build_object(
          v_secao || '.' || v_chave,
          jsonb_build_object('de', v_de, 'para', v_para));
      end if;
    end loop;
  end loop;

  if v_changes = '{}'::jsonb then
    raise exception 'nada para corrigir — os valores enviados são iguais aos atuais';
  end if;

  -- Passo 2: merge POR CHAVE dentro da seção — ao contrário do rascunho
  -- (save_briefing_draft), que substitui a seção inteira porque a tela sempre
  -- reenvia a etapa completa. Revisão corrige campo pontual.
  for v_secao in select jsonb_object_keys(p_patch) loop
    continue when p_patch -> v_secao = '{}'::jsonb;
    v_answers := jsonb_set(
      v_answers,
      array[v_secao],
      case when jsonb_typeof(v_answers -> v_secao) = 'object'
           then v_answers -> v_secao else '{}'::jsonb end || (p_patch -> v_secao),
      true);
  end loop;

  -- Passo 3: o RESULTADO tem de continuar valendo pela régua da própria linha.
  -- Sem isto, a correção era a única porta que escrevia em `answers` sem passar
  -- por validação: bastava um patch com forma certa e conteúdo errado (array
  -- virando objeto, obrigatório virando espaço) para deixar submetido um
  -- briefing que o envio jamais teria aceitado.
  if v_row.schema_version >= 2 then
    begin
      perform public._briefing_validate_v2(p_student, v_answers);
    exception when others then
      raise exception 'a correção deixaria o briefing inválido: %', sqlerrm;
    end;
  else
    -- v1 nunca teve validação de campo, só de etapa: seção presente é objeto
    -- não-vazio (é o que _briefing_submit cobra no ramo v1).
    foreach v_secao in array array['historia', 'objetivos', 'interesses', 'rotina'] loop
      if v_answers ? v_secao
         and (jsonb_typeof(v_answers -> v_secao) <> 'object'
              or v_answers -> v_secao = '{}'::jsonb) then
        raise exception 'a correção deixaria o briefing inválido: a etapa "%" ficaria sem resposta', v_secao;
      end if;
    end loop;
  end if;

  insert into briefing_revisions (student_id, actor, reason, changes, snapshot_before)
  values (p_student, auth.uid(), btrim(p_reason), v_changes,
          coalesce(v_row.answers, '{}'::jsonb));

  update briefings
     set answers = v_answers,
         -- a coluna significa "quem escreveu por último" (é o que o comentário
         -- da 20260720000100 diz e o que save_briefing_draft/_briefing_submit
         -- fazem): depois da correção, quem escreveu por último foi a admin.
         filled_by = auth.uid(),
         updated_at = now()
   where student_id = p_student;

  perform public.log_audit(auth.uid(), 'admin_revise_briefing', 'briefings',
    p_student::text,
    jsonb_build_object('reason', btrim(p_reason), 'changes', v_changes));

  return v_changes;
end;
$$;
revoke execute on function public.admin_revise_briefing(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_revise_briefing(uuid, jsonb, text) to authenticated;

-- ===========================================================================
-- (d) SUBMIT RAMIFICADO
-- ===========================================================================

-- Rótulo LITERAL da opção "profissional" em objetivos.finalidades. Mora aqui
-- porque é o banco que decide quando os tópicos profissionais passam a ser
-- obrigatórios; o dicionário do sub-lote 2 (src/lib/briefing/schema.ts) espelha
-- este texto e o teste lê a função para o drift ficar vermelho.
create or replace function public.briefing_v2_finalidade_profissional()
returns text
language sql
immutable
as $$ select 'Trabalho / carreira'::text $$;
grant execute on function public.briefing_v2_finalidade_profissional() to anon, authenticated, service_role;

-- Texto de uma chave, já aparado. Conta como AUSENTE: chave faltando, valor em
-- branco (régua da seção 0) e — isto é o ponto — valor que NÃO É STRING.
-- `->>` serializa qualquer coisa em texto: sem o teste de tipo, `cidade_vida: 123`
-- virava a cidade "123" e `contato: {"a":1}` virava o texto '{"a": 1}'. Campo
-- malformado tem de recusar o envio nomeando a etapa, não ser aceito como resposta.
create or replace function public._briefing_txt(p_secao jsonb, p_chave text)
returns text
language sql
immutable
as $$
  select case
    when jsonb_typeof(p_secao -> p_chave) = 'string'
     and not public._briefing_em_branco(p_secao ->> p_chave)
    then btrim(p_secao ->> p_chave)
  end
$$;

-- Itens DISTINTOS e não-vazios de uma chave de array (qualquer outra coisa vira
-- lista vazia). Duas decisões que valem os mínimos do v2 (≥6 hobbies, ≥3 tópicos
-- profissionais, ≥1 contato/finalidade/onde_trava/para_que_ingles):
--   • só elemento STRING conta — `hobbies: [1,2,3,4,5,6]` não é resposta, é lixo
--     de formulário; `jsonb_array_elements_text` transformava cada número em
--     texto e o mínimo passava;
--   • DISTINCT sobre o texto aparado — repetir "Ler" seis vezes não são seis
--     hobbies. Como o mínimo é a única coisa que o banco cobra da lista, contar
--     duplicata era a forma barata de burlar a régua.
-- Os dois usos não-contáveis do resultado (pertinência de finalidade_principal e
-- da finalidade profissional) não se importam com ordem nem com repetição.
create or replace function public._briefing_itens(p_secao jsonb, p_chave text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct btrim(e.v #>> '{}')), '{}'::text[])
  from jsonb_array_elements(
    case when jsonb_typeof(p_secao -> p_chave) = 'array'
         then p_secao -> p_chave
         else '[]'::jsonb end) as e(v)
  where jsonb_typeof(e.v) = 'string'
    and not public._briefing_em_branco(e.v #>> '{}')
$$;

-- Obrigatórias do briefing v2, por ramo (Lei 3). As mensagens nomeiam a ETAPA
-- para a admin saber onde voltar quando o envio recusar.
create or replace function public._briefing_validate_v2(p_student uuid, p_answers jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo text;
  v_historia   jsonb := coalesce(p_answers -> 'historia', '{}'::jsonb);
  v_objetivos  jsonb := coalesce(p_answers -> 'objetivos', '{}'::jsonb);
  v_interesses jsonb := coalesce(p_answers -> 'interesses', '{}'::jsonb);
  v_rotina     jsonb := coalesce(p_answers -> 'rotina', '{}'::jsonb);
  v_finalidades text[];
  v_principal text;
  v_profissional constant text := public.briefing_v2_finalidade_profissional();
  v_campo text;
  v_blocos int := 0;
  v_dia text;
begin
  select student_type into v_tipo from students where id = p_student;

  -- --- Etapa 1: sua história -------------------------------------------------
  if public._briefing_txt(v_historia, 'cidade_vida') is null then
    raise exception 'etapa 1 (sua história): diga em que cidade você vive';
  end if;
  if public._briefing_txt(v_historia, 'facil') is null then
    raise exception 'etapa 1 (sua história): diga o que é mais FÁCIL para você no inglês';
  end if;
  if public._briefing_txt(v_historia, 'dificil') is null then
    raise exception 'etapa 1 (sua história): diga o que é mais DIFÍCIL para você no inglês';
  end if;
  if cardinality(public._briefing_itens(v_historia, 'contato')) = 0 then
    raise exception 'etapa 1 (sua história): marque ao menos uma forma de contato que você já teve com o inglês';
  end if;

  -- --- Etapa 2: objetivos (RAMIFICADA) ---------------------------------------
  if v_tipo = 'child' then
    if cardinality(public._briefing_itens(v_objetivos, 'para_que_ingles')) = 0 then
      raise exception 'etapa 2 (objetivos): marque ao menos uma resposta para "para que o inglês na vida dele(a)"';
    end if;
    if public._briefing_txt(v_objetivos, 'temas_escola') is null then
      raise exception 'etapa 2 (objetivos): diga os temas favoritos dele(a) na escola';
    end if;
    if public._briefing_txt(v_objetivos, 'favoritos_midia') is null then
      raise exception 'etapa 2 (objetivos): diga os desenhos, jogos ou youtubers favoritos dele(a)';
    end if;
    if public._briefing_txt(v_objetivos, 'quem_acompanha') is null then
      raise exception 'etapa 2 (objetivos): diga quem acompanha as tarefas em casa';
    end if;
    if public._briefing_txt(v_objetivos, 'temperamento') is null then
      raise exception 'etapa 2 (objetivos): diga como ele(a) é com pessoas novas';
    end if;
  else
    v_finalidades := public._briefing_itens(v_objetivos, 'finalidades');
    if cardinality(v_finalidades) = 0 then
      raise exception 'etapa 2 (objetivos): marque ao menos uma finalidade para praticar inglês';
    end if;
    v_principal := public._briefing_txt(v_objetivos, 'finalidade_principal');
    if v_principal is null then
      raise exception 'etapa 2 (objetivos): diga qual finalidade é a MAIS importante';
    end if;
    if not (v_principal = any (v_finalidades)) then
      raise exception 'etapa 2 (objetivos): a finalidade mais importante ("%") precisa estar entre as finalidades marcadas', v_principal;
    end if;
    if public._briefing_txt(v_objetivos, 'alvo_6_meses') is null then
      raise exception 'etapa 2 (objetivos): diga o que você quer conseguir FAZER em 6 meses';
    end if;
    if cardinality(public._briefing_itens(v_objetivos, 'onde_trava')) = 0 then
      raise exception 'etapa 2 (objetivos): marque ao menos um ponto onde você mais trava';
    end if;
    if public._briefing_txt(v_objetivos, 'correcao_preferida') is null then
      raise exception 'etapa 2 (objetivos): diga como você prefere ser corrigido(a)';
    end if;
    if public._briefing_txt(v_objetivos, 'tempo_diario') is null then
      raise exception 'etapa 2 (objetivos): diga quanto tempo por dia você tem para estudar';
    end if;
    -- Tópicos profissionais só fazem sentido para quem marcou a finalidade de
    -- trabalho — pedir 3 tópicos de carreira a quem estuda para viajar é ruído.
    if v_profissional = any (v_finalidades)
       and cardinality(public._briefing_itens(v_objetivos, 'topicos_profissionais')) < 3 then
      raise exception 'etapa 2 (objetivos): você marcou "%" — descreva ao menos 3 tópicos da sua vida profissional', v_profissional;
    end if;
  end if;

  -- --- Etapa 3: interesses ---------------------------------------------------
  if cardinality(public._briefing_itens(v_interesses, 'hobbies')) < 6 then
    raise exception 'etapa 3 (interesses): marque ao menos 6 hobbies';
  end if;
  foreach v_campo in array array['leitura', 'filmes_series', 'musicas'] loop
    if public._briefing_txt(v_interesses, v_campo) is null
       or public._briefing_txt(v_interesses, v_campo) not in ('sim', 'não') then
      raise exception 'etapa 3 (interesses): responda "sim" ou "não" em %', v_campo;
    end if;
    if public._briefing_txt(v_interesses, v_campo) = 'sim'
       and public._briefing_txt(v_interesses, v_campo || '_detalhe') is null then
      raise exception 'etapa 3 (interesses): você respondeu "sim" em % — conte quais', v_campo;
    end if;
  end loop;

  -- --- Etapa 4: rotina (intocada em conteúdo; obrigatoriedade explicitada) ----
  if jsonb_typeof(v_rotina -> 'blocos') = 'object' then
    for v_dia in select jsonb_object_keys(v_rotina -> 'blocos') loop
      v_blocos := v_blocos + cardinality(public._briefing_itens(v_rotina -> 'blocos', v_dia));
    end loop;
  end if;
  if v_blocos = 0 then
    raise exception 'etapa 4 (sua rotina): marque ao menos um horário livre na semana';
  end if;
  if public._briefing_txt(v_rotina, 'imersao') is null then
    raise exception 'etapa 4 (sua rotina): escolha uma ação de imersão para a semana';
  end if;

  -- Etapa 6 ("livre": obs + apoio) é OPCIONAL por desenho.
end;
$$;
revoke execute on function public._briefing_validate_v2(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- _briefing_submit: v1 IDÊNTICA (gabarito, empate, auditoria) + ramo v2 na
-- validação das respostas. O teste de Kolb é o MESMO nos dois ramos.
-- CREATE OR REPLACE (a migration antiga não é tocada — Lei 7).
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

  if v_row.schema_version >= 2 then
    -- v2: obrigatórias por ramo (criança × adulto)
    perform public._briefing_validate_v2(p_student, coalesce(v_row.answers, '{}'::jsonb));
  else
    -- v1: etapas obrigatórias presentes e não vazias (a "livre" é opcional)
    foreach v_section in array array['historia','objetivos','interesses','rotina'] loop
      if coalesce(v_row.answers -> v_section, '{}'::jsonb) = '{}'::jsonb then
        raise exception 'etapa obrigatória sem resposta: %', v_section;
      end if;
    end loop;
  end if;

  -- Kolb completo (q1..q12, letra A–D) e tabulação — idêntico nos dois ramos
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
