-- Briefing v2 — RE-BRIEFING SEMESTRAL (sub-lote 4 da onda do Portal, 28/07/2026;
-- spec em docs/goals/briefing-v2.md §Arquitetura 3 e §Implementação 4).
--
-- O briefing base é colhido UMA vez, antes da primeira aula, e é imutável para o
-- aluno. Mas objetivo e interesse mudam: quem entrou querendo "viajar" está, seis
-- meses depois, montando reunião em inglês. Esta migration põe de pé o ciclo:
--
--   (a) `briefing_updates` — a atualização de UM semestre de UM contrato, com as
--       DUAS seções que envelhecem (objetivos + interesses) e mais nada. Espelha
--       `study_plans (contract_id, semester_no)` porque é para o plano daquele
--       semestre que ela serve: um plano, uma atualização.
--   (b) `briefing_effective(aluno, contrato, semestre)` — o briefing que vale
--       NAQUELE ciclo: o base com as duas seções SUBSTITUÍDAS POR SEÇÃO INTEIRA
--       pela atualização enviada. É por aqui que a sugestão de plano da IA passa
--       a ler (src/lib/ai/study-plan.ts).
--   (d) `briefing_update_pendente(aluno)` — a REGRA ÚNICA de "há atualização a
--       fazer, e de qual (contrato, semestre)?". Card do Início, rota de
--       atualização, botão da ficha da admin e lembrete leem daqui, e só daqui.
--   (c) `_briefing_validate_v2_secoes` — a mesma régua de obrigatoriedade do
--       envio v2, aplicável a um SUBCONJUNTO de seções. A validação do briefing
--       inteiro (`_briefing_validate_v2`) passa a delegar nela: a regra de "o que
--       objetivos e interesses precisam ter" existe UMA vez (Lei 3), e o envio da
--       atualização cobra exatamente o mesmo que o envio do briefing cobraria.
--
-- Semestre ≥ 2 NÃO exige atualização: ela é leve e opcional, e nada no portal
-- bloqueia por causa dela (o card do Início convida, não impede).
--
-- Leis: 3 (obrigatoriedade e posse no banco; a UI só antecipa), 7 (migration
-- nova — 20260728000100/200 não foram tocadas), 8 (log_audit no envio).

-- ===========================================================================
-- (c) A RÉGUA DO v2, POR SUBCONJUNTO DE SEÇÕES
-- ===========================================================================
-- Corpo idêntico ao de _briefing_validate_v2 (migration 20260728000100), com
-- cada etapa atrás de um "esta seção está em jogo?". Nada de regra nova aqui: o
-- que muda é QUANTAS seções o chamador manda validar.
create or replace function public._briefing_validate_v2_secoes(
  p_student uuid,
  p_answers jsonb,
  p_secoes text[]
)
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
  if 'historia' = any (p_secoes) then
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
  end if;

  -- --- Etapa 2: objetivos (RAMIFICADA) ---------------------------------------
  if 'objetivos' = any (p_secoes) then
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
  end if;

  -- --- Etapa 3: interesses ---------------------------------------------------
  if 'interesses' = any (p_secoes) then
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
  end if;

  -- --- Etapa 4: rotina -------------------------------------------------------
  if 'rotina' = any (p_secoes) then
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
  end if;

  -- Etapa 6 ("livre": obs + apoio) é OPCIONAL por desenho.
end;
$$;
revoke execute on function public._briefing_validate_v2_secoes(uuid, jsonb, text[])
  from public, anon, authenticated;

comment on function public._briefing_validate_v2_secoes(uuid, jsonb, text[]) is
  'Obrigatórias do briefing v2 por ramo (criança × adulto), restritas às seções pedidas. Fonte ÚNICA da regra: o envio do briefing valida as 4 seções por aqui, e o envio do re-briefing semestral valida só objetivos+interesses.';

-- O envio do briefing inteiro passa a DELEGAR — a régua não é reescrita duas vezes.
create or replace function public._briefing_validate_v2(p_student uuid, p_answers jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._briefing_validate_v2_secoes(
    p_student, p_answers, array['historia', 'objetivos', 'interesses', 'rotina']);
end;
$$;
revoke execute on function public._briefing_validate_v2(uuid, jsonb) from public, anon, authenticated;

-- ===========================================================================
-- (a) A TABELA
-- ===========================================================================

-- CHECK de topo restrito: a atualização semestral é das DUAS seções que
-- envelhecem. História não muda, rotina/Kolb têm porta própria, e "livre" é
-- recado pontual — deixar qualquer uma delas entrar por aqui criaria um segundo
-- briefing paralelo, com validação pela metade. Como CHECK não aceita subquery,
-- a pergunta vira aritmética de jsonb: tirando as duas seções, sobra vazio?
create or replace function public._briefing_update_secoes_ok(p_answers jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p_answers) = 'object'
     and (p_answers - 'objetivos' - 'interesses') = '{}'::jsonb
$$;

comment on function public._briefing_update_secoes_ok(jsonb) is
  'true quando o jsonb só tem as seções objetivos e/ou interesses (as do re-briefing semestral). Sem revoke: é avaliada pelo CHECK, com o privilégio de quem insere.';

create table briefing_updates (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students (id),
  contract_id uuid not null references contracts (id),
  -- espelho de study_plans (contract_id, semester_no): um plano, uma atualização
  semester_no int not null check (semester_no >= 1),
  answers jsonb not null default '{}'::jsonb
    constraint briefing_updates_secoes_check check (public._briefing_update_secoes_ok(answers)),
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  -- A atualização só existe no mundo v2 (as chaves e a régua são as do v2); a
  -- coluna fica para que a leitura futura saiba sob que dicionário ela nasceu,
  -- do mesmo jeito que briefings.schema_version.
  schema_version smallint not null default 2 check (schema_version = 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, semester_no)
);

comment on table briefing_updates is
  'Re-briefing semestral: objetivos e interesses atualizados para UM semestre de UM contrato (espelho de study_plans). Rascunho até o envio; depois do envio é imutável, porque é ele que o plano daquele semestre leu. Escrita SÓ via RPC (save_briefing_update_draft/submit_briefing_update).';

create index briefing_updates_student_idx on briefing_updates (student_id);

-- Imutável DEPOIS do envio (rascunho continua editável): a atualização enviada é
-- o registro do que o aluno pediu naquele ciclo, e o plano de estudos do
-- semestre foi montado em cima dela. Reescrevê-la mudaria o passado.
create or replace function public._briefing_update_imutavel()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'submitted' then
    raise exception 'atualização de briefing já enviada — ela é o registro daquele semestre e não muda';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger briefing_updates_imutavel_pos_envio
  before update or delete on briefing_updates
  for each row execute function public._briefing_update_imutavel();

-- TRUNCATE não passa por trigger de linha — é a porta que o REVOKE não fecha
-- para a dona da tabela.
create trigger briefing_updates_no_truncate
  before truncate on briefing_updates
  for each statement execute function public.forbid_mutation();

alter table briefing_updates enable row level security;

-- Leitura por papel: o aluno vê a dele, a professora vê a DO CONTRATO DELA, a
-- admin vê tudo.
create policy briefing_updates_student_self on briefing_updates
  for select to authenticated
  using (student_id in (select id from students where profile_id = (select auth.uid())));

-- POR CONTRATO, não por aluno (revisão de integração, achado 9). A linha é de um
-- (contrato, semestre): autorizar por `teacher_student_ids()` daria à professora
-- de QUALQUER contrato do aluno — inclusive uma professora antiga, de contrato
-- que já não é dela — a atualização feita para o plano da outra. O padrão da
-- casa para tabela-por-contrato é `teacher_contract_ids()` (mesma escolha de
-- `study_plans_teacher`), e é ele que vale aqui.
create policy briefing_updates_teacher on briefing_updates
  for select to authenticated
  using (
    (select public.app_role()) = 'teacher'
    and contract_id in (select public.teacher_contract_ids())
  );

create policy briefing_updates_admin on briefing_updates
  for select to authenticated
  using ((select public.app_role()) = 'admin');

-- Escrita: nenhuma policy e nenhum grant — só as RPCs security definer entram
-- (inclusive para o servidor: não há caminho de service_role que escreva aqui).
-- O grant de select abre a porta; a policy decide a linha (anon incluso pela
-- convenção da casa: devolve vazio silencioso).
grant select on briefing_updates to anon, authenticated, service_role;
revoke insert, update, delete, truncate on briefing_updates
  from anon, authenticated, service_role;

-- ===========================================================================
-- O SEMESTRE VIGENTE DO CONTRATO
-- ===========================================================================
-- A atualização é do ciclo do PLANO, não de um calendário próprio: o semestre é
-- o do `study_plans` cuja janela cobre hoje (maior `semester_no`, para o caso de
-- janelas que se sobreponham por correção de data). Sem plano vigente não há
-- ciclo — e a RPC recusa com frase de gente, em vez de inventar semestre.
create or replace function public._briefing_update_semestre(p_contract uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select semester_no
    from study_plans
   where contract_id = p_contract
     and public.business_today() between starts_on and ends_on
   order by semester_no desc
   limit 1
$$;
revoke execute on function public._briefing_update_semestre(uuid) from public, anon, authenticated;

-- ===========================================================================
-- A BASE PRECISA EXISTIR — e no dicionário certo
-- ===========================================================================
-- A atualização REESCREVE duas seções do briefing base. Sem base enviada não há
-- o que reescrever (o que o aluno mandaria seria meio briefing, entrando pela
-- porta errada); e base colhida no v1 é feita de chaves que o formulário v2 nem
-- pergunta — substituir "objetivos" inteiro ali apagaria as respostas antigas e
-- poria no lugar respostas de outro dicionário. As duas recusas moram aqui, uma
-- vez, e as três portas (rascunho, envio, lembrete) passam por elas.
create or replace function public._briefing_update_base_ok(p_student uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_versao smallint;
begin
  select status, schema_version into v_status, v_versao
    from briefings where student_id = p_student;
  if v_status is distinct from 'submitted' then
    raise exception 'o briefing completo vem primeiro — envie o seu briefing antes de atualizar o semestre';
  end if;
  if coalesce(v_versao, 1) < 2 then
    raise exception 'este aluno ainda usa o briefing antigo — atualização não se aplica';
  end if;
end;
$$;
revoke execute on function public._briefing_update_base_ok(uuid) from public, anon, authenticated;

comment on function public._briefing_update_base_ok(uuid) is
  'Recusa a atualização semestral de quem não enviou o briefing base, ou o enviou sob o dicionário v1. Fonte ÚNICA das duas frases: rascunho, envio e a pendência (briefing_update_pendente) passam por aqui.';

-- ===========================================================================
-- A PENDÊNCIA — A REGRA ÚNICA DO RE-BRIEFING
-- ===========================================================================
-- "Este aluno tem atualização semestral a fazer? De qual contrato, de qual
-- semestre?" Uma pergunta, uma resposta, um lugar. Antes ela era respondida em
-- TRÊS derivações independentes — a query do card do Início (TypeScript), a
-- escolha de contrato do lembrete (SQL) e o par contrato/semestre das RPCs de
-- escrita —, e elas já discordavam entre si (revisão de integração, achados 4
-- e 5): a do lembrete aceitava contrato de grupo, e nenhuma delas sabia o que
-- fazer com DOIS contratos ativos do mesmo aluno.
--
-- Pendente é o (contrato, semestre) que satisfaz TUDO isto:
--   · contrato INDIVIDUAL (contracts.student_id = o aluno) e ATIVO — casal/
--     grupo fica de fora nesta onda (ver a nota de escopo abaixo);
--   · plano de estudos cuja janela cobre `business_today()` — o ciclo é o do
--     plano, não de um calendário próprio. Quando há mais de um plano vigente
--     no mesmo contrato (correção de datas), vale o de maior semestre, a mesma
--     escolha de `_briefing_update_semestre`;
--   · semestre >= 2 — o primeiro ciclo é o do briefing completo;
--   · briefing base enviado e v2 (`_briefing_update_base_ok`);
--   · sem atualização ENVIADA daquele (contrato, semestre).
--
-- Vários pendentes (o aluno tem dois contratos individuais ativos): devolve UM,
-- por `semester_no desc, contract_id` — determinístico, e o mais adiantado
-- primeiro. Nenhum: ZERO linhas (não é erro — a maioria dos alunos está aqui).
--
-- ESCOPO DESTA ONDA (decisão do dono, 28/07): re-briefing é de contrato
-- INDIVIDUAL. Contrato de casal/grupo não entra — a UNIQUE (contract_id,
-- semester_no) nem comportaria dois membros atualizando o mesmo ciclo, e quem
-- responde por quem é pergunta de negócio, não de schema.
-- casal/grupo: decisão futura do dono — ver goal onda-portal.
--
-- SECURITY DEFINER com porteiro próprio: a resposta atravessa quatro tabelas
-- (contracts, study_plans, briefings, briefing_updates) e não se quer que a
-- pendência mude de valor conforme a RLS de quem pergunta — um `null` por falta
-- de permissão é indistinguível de "não há nada pendente". Quem pode perguntar
-- é o próprio aluno, a admin, e a professora do aluno; qualquer outro leva
-- exceção, não silêncio.
create or replace function public.briefing_update_pendente(p_student uuid)
returns table (contract_id uuid, semester_no int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_papel text := public.app_role();
begin
  if not (
    v_papel = 'admin'
    or exists (select 1 from students s where s.id = p_student and s.profile_id = auth.uid())
    or (v_papel = 'teacher' and p_student in (select public.teacher_student_ids()))
  ) then
    raise exception 'sem acesso à atualização de briefing deste aluno';
  end if;

  -- Base ausente/v1 = nada pendente (e não exceção: a pergunta é legítima, a
  -- resposta é "não"). As RPCs de escrita é que explicam o porquê em voz alta.
  begin
    perform public._briefing_update_base_ok(p_student);
  exception when others then
    return;
  end;

  return query
  with vigente as (
    select distinct on (sp.contract_id) sp.contract_id, sp.semester_no
      from study_plans sp
      join contracts c on c.id = sp.contract_id
     where c.student_id = p_student
       and c.status = 'active'
       and public.business_today() between sp.starts_on and sp.ends_on
     order by sp.contract_id, sp.semester_no desc
  )
  select v.contract_id, v.semester_no
    from vigente v
   where v.semester_no >= 2
     and not exists (
       select 1 from briefing_updates u
        where u.contract_id = v.contract_id
          and u.semester_no = v.semester_no
          and u.status = 'submitted'
     )
   order by v.semester_no desc, v.contract_id
   limit 1;
end;
$$;
-- Sem service_role de propósito: quem pergunta é sempre uma SESSÃO (o aluno no
-- portal, a admin na ficha, a professora no painel) — e o porteiro acima é
-- escrito na língua dos papéis, não na de uma chave que não tem papel.
revoke execute on function public.briefing_update_pendente(uuid) from public, anon, service_role;
grant execute on function public.briefing_update_pendente(uuid) to authenticated;

comment on function public.briefing_update_pendente(uuid) is
  'O (contrato, semestre) do re-briefing semestral que este aluno ainda deve — regra ÚNICA do card do Início, da rota /portal/briefing/atualizar, do botão da ficha e do lembrete. Zero linhas = nada pendente. Contrato INDIVIDUAL e ativo apenas (casal/grupo: decisão futura do dono — ver goal onda-portal).';

-- ===========================================================================
-- RPC: rascunho da atualização (o PRÓPRIO aluno)
-- ===========================================================================
create or replace function public.save_briefing_update_draft(
  p_contract uuid,
  p_answers jsonb default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid;
  v_status text;
  v_semestre int;
  v_secao text;
  v_answers jsonb := coalesce(p_answers, '{}'::jsonb);
begin
  -- PORTEIRO DE PAPEL, ANTES DE QUALQUER ESCOPO (mesma correção que o P3 fez no
  -- extrato de créditos). `_briefing_session_student()` só pergunta "esta conta
  -- tem linha em students?" — e a professora que também estuda na escola, ou a
  -- conta de vendas com cadastro duplo, TEM. Sem esta guarda, uma sessão
  -- `teacher`/`sales` escrevia o re-briefing pelo papel errado: o escopo por
  -- `auth.uid()` diz QUAIS linhas, o papel diz QUEM tem direito a escrever.
  -- Rascunho é do ALUNO e só dele (a retaguarda da admin mora no submit).
  if (select public.app_role()) <> 'student' then
    raise exception 'sem acesso à atualização de briefing';
  end if;
  v_student := public._briefing_session_student();

  -- `student_id = v_student` já restringe a contrato INDIVIDUAL: no contrato de
  -- casal/grupo a coluna é NULL e a comparação nunca casa. É a mesma fronteira
  -- que `briefing_update_pendente` desenha — o convite e a escrita concordam.
  select status into v_status from contracts
   where id = p_contract and student_id = v_student;
  if not found then
    raise exception 'este contrato não é seu';
  end if;
  if v_status <> 'active' then
    raise exception 'este contrato não está ativo';
  end if;

  v_semestre := public._briefing_update_semestre(p_contract);
  if v_semestre is null then
    raise exception 'ainda não há plano de estudos vigente neste contrato — fale com a gente';
  end if;

  -- Há ciclo; há briefing base para reescrever? (na ordem em que a vida
  -- acontece: contrato → ciclo → briefing.)
  perform public._briefing_update_base_ok(v_student);

  if jsonb_typeof(v_answers) <> 'object' then
    raise exception 'respostas fora do formato';
  end if;
  -- A mesma régua do CHECK, com a frase que a pessoa entende (e ANTES de tocar a
  -- tabela): a atualização é só de objetivos e interesses.
  for v_secao in select jsonb_object_keys(v_answers) loop
    if v_secao not in ('objetivos', 'interesses') then
      raise exception 'a atualização semestral é só das etapas objetivos e interesses (recebi "%")', v_secao;
    end if;
    if jsonb_typeof(v_answers -> v_secao) <> 'object' then
      raise exception 'a etapa "%" precisa vir como {chave: valor}', v_secao;
    end if;
  end loop;

  -- Merge no TOPO (`||`), como o rascunho do briefing: a tela sempre reenvia a
  -- etapa inteira, então a seção nova substitui a seção antiga por completo.
  insert into briefing_updates (student_id, contract_id, semester_no, answers)
  values (v_student, p_contract, v_semestre, v_answers)
  on conflict (contract_id, semester_no) do update
    set answers = briefing_updates.answers || excluded.answers,
        updated_at = now()
    where briefing_updates.status = 'draft';

  if exists (
    select 1 from briefing_updates
     where contract_id = p_contract and semester_no = v_semestre and status = 'submitted'
  ) then
    raise exception 'a atualização deste semestre já foi enviada — fale com a gente para corrigir';
  end if;
end;
$$;
revoke execute on function public.save_briefing_update_draft(uuid, jsonb) from public, anon;
grant execute on function public.save_briefing_update_draft(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC: envio da atualização (o aluno, ou a admin em nome dele)
-- ===========================================================================
create or replace function public.submit_briefing_update(p_contract uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid;
  v_semestre int;
  v_row briefing_updates%rowtype;
begin
  -- PORTEIRO DE PAPEL (irmão do que guarda o rascunho acima): só o ALUNO e a
  -- ADMIN enviam. Sem esta linha, o ramo `else` abaixo aceitava qualquer
  -- `authenticated` com linha em `students` — teacher/sales com cadastro duplo
  -- enviavam o re-briefing pelo papel errado.
  if (select public.app_role()) not in ('student', 'admin') then
    raise exception 'sem acesso à atualização de briefing';
  end if;

  -- A admin envia EM NOME do aluno (é ela quem colhe por telefone quando o aluno
  -- não entra no portal) — a mesma retaguarda que o briefing tem.
  if (select public.app_role()) = 'admin' then
    select student_id into v_student from contracts where id = p_contract;
    if not found then
      raise exception 'contrato inexistente';
    end if;
    -- Contrato de casal/grupo tem `student_id` NULL: a atualização semestral é
    -- de contrato INDIVIDUAL nesta onda (mesma fronteira do rascunho e da
    -- pendência). Dizer isso em voz alta é melhor do que "contrato inexistente".
    if v_student is null then
      raise exception 'este contrato é de casal/grupo — a atualização semestral é de contrato individual';
    end if;
  else
    v_student := public._briefing_session_student();
    if not exists (select 1 from contracts where id = p_contract and student_id = v_student) then
      raise exception 'este contrato não é seu';
    end if;
  end if;

  -- A mesma fronteira do rascunho: contrato pausado/encerrado não envia
  -- atualização (o rascunho já exigia ativo; sem esta guarda, um contrato que
  -- pausasse entre o rascunho e o envio submeteria mesmo assim).
  if not exists (select 1 from contracts where id = p_contract and status = 'active') then
    raise exception 'este contrato não está ativo';
  end if;

  v_semestre := public._briefing_update_semestre(p_contract);
  if v_semestre is null then
    raise exception 'ainda não há plano de estudos vigente neste contrato — fale com a gente';
  end if;

  perform public._briefing_update_base_ok(v_student);

  select * into v_row from briefing_updates
   where contract_id = p_contract and semester_no = v_semestre
   for update;
  if not found then
    raise exception 'não há atualização começada para este semestre';
  end if;
  if v_row.status = 'submitted' then
    raise exception 'a atualização deste semestre já foi enviada — fale com a gente para corrigir';
  end if;

  -- As DUAS seções valem pela MESMA régua do envio do briefing (Lei 3).
  perform public._briefing_validate_v2_secoes(
    v_row.student_id, coalesce(v_row.answers, '{}'::jsonb), array['objetivos', 'interesses']);

  update briefing_updates
     set status = 'submitted',
         submitted_at = now(),
         updated_at = now()
   where id = v_row.id;

  perform public.log_audit(auth.uid(), 'submit_briefing_update', 'briefing_updates',
    v_row.id::text,
    jsonb_build_object('contract_id', p_contract, 'semester_no', v_semestre,
      'student_id', v_row.student_id));
end;
$$;
revoke execute on function public.submit_briefing_update(uuid) from public, anon;
grant execute on function public.submit_briefing_update(uuid) to authenticated;

-- ===========================================================================
-- (b) O BRIEFING EFETIVO DE UM CICLO
-- ===========================================================================
-- SECURITY INVOKER de propósito: quem pode ver o briefing de quem já está
-- decidido pela RLS de `briefings` e `briefing_updates` (aluno o seu, professora
-- os dela, admin todos, service_role tudo). Um definer aqui teria de reescrever
-- essas três respostas à mão — e é assim que duas cópias da mesma regra passam a
-- discordar.
--
-- SUBSTITUIÇÃO POR SEÇÃO INTEIRA (`||` no topo): a seção "objetivos" do update
-- entra no lugar da "objetivos" do base, chave a chave inclusive as que sumiram.
-- É o comportamento que a spec pede — a atualização é a resposta NOVA do aluno,
-- não um remendo sobre a antiga.
--
-- Semestre 1 devolve o base puro: o primeiro ciclo é o do briefing original.
create or replace function public.briefing_effective(
  p_student uuid,
  p_contract uuid,
  p_semester int
) returns jsonb
language sql
stable
as $$
  select coalesce(b.answers, '{}'::jsonb) || coalesce(
    (select u.answers
       from briefing_updates u
      where u.student_id = p_student
        and u.contract_id = p_contract
        and u.semester_no = p_semester
        and u.status = 'submitted'
        and coalesce(p_semester, 1) >= 2),
    '{}'::jsonb)
  from briefings b
  where b.student_id = p_student
$$;
revoke execute on function public.briefing_effective(uuid, uuid, int) from public, anon;
grant execute on function public.briefing_effective(uuid, uuid, int) to authenticated, service_role;

comment on function public.briefing_effective(uuid, uuid, int) is
  'O briefing que vale num ciclo: briefings.answers com objetivos/interesses substituídos POR SEÇÃO INTEIRA pela atualização ENVIADA daquele (contrato, semestre). Sem atualização (ou semestre 1) devolve o base. NULL quando o aluno não tem briefing — ou quando quem chama não pode vê-lo (a função é SECURITY INVOKER: vale a RLS das tabelas).';
