-- ###########################################################################
-- LOTE c13 · AS CORREÇÕES DE BANCO DA RODADA 3 DO SOL (M4 + M5)
-- ###########################################################################
--
-- Migration NOVA (Lei 7): nada aqui edita a `20260727001200` nem nenhuma outra.
-- Tudo entra por `create or replace`, `create trigger` e um `drop function` +
-- `create` (a única assinatura que muda — ver nº 5).
--
-- OS TRÊS ACHADOS DE BANCO QUE ESTE ARQUIVO FECHA (numeração do relatório):
--
--  nº 1 e nº 2 (GRAVES) · A MESMA ESCALADA DE LOCK, POR DUAS PORTAS QUE O c12
--       NÃO COBRIU. O c12 matou a escalada `FOR KEY SHARE` → `FOR UPDATE` em
--       `admin_create_contract`, travando as linhas de `students`
--       EXCLUSIVAMENTE e em ordem total antes de escrever. A correção estava
--       certa e era INCOMPLETA: ela mora no CHAMADOR, e quem escala é o
--       GATILHO. Sobraram duas portas, e as duas foram MEDIDAS na bancada
--       (20 rodadas cada, antes desta migration):
--         · `admin_renew_contract` — 18 deadlocks em 20 rodadas de
--           renovação×renovação do MESMO aluno (dois contratos, duas
--           transações);
--         · `insert into student_group_members` direto (a policy de admin
--           admite, e o M4 não fechou essa porta) — 18 deadlocks em 20 rodadas
--           de membro×membro (o mesmo aluno entrando em duas turmas).
--       Depois desta migration: 0 e 0, nas mesmas 20 rodadas.
--
--       A CORREÇÃO É NA RAIZ, e não porta a porta: a pré-trava exclusiva desce
--       para o CAMINHO DO GATILHO. Dois gatilhos `before insert` — um em
--       `contracts`, outro em `student_group_members` — pedem as linhas de
--       `students` com `for update` ANTES de a chave estrangeira pegar o
--       `for key share`. Assim toda porta fica coberta sem que cada chamador
--       novo tenha de lembrar do andar.
--
--       ⚠️ A HIPÓTESE DO SEQUENCIAMENTO FOI CONFERIDA NA PRÁTICA, e não
--       assumida: a checagem de FK do Postgres é um gatilho AFTER ROW interno
--       (`RI_FKey_check_ins`), que roda no fim do statement; o gatilho BEFORE
--       roda antes da tupla existir. A prova não é o parágrafo — é a medição
--       acima (18/20 → 0/20 nas duas portas, com ESTES gatilhos e nada mais).
--
--  nº 5 · TOCTOU DO TYPE-TO-CONFIRM. O c12 (nº 9) tirou o nome esperado do
--       formulário e o foi buscar no banco — mas FORA da transação que encerra.
--       Entre a leitura do nome e o `admin_end_contract` cabe um `update
--       students set display_name`, e o portão da destrutiva grande passa a
--       aprovar um nome que já não é o nome. `admin_end_contract` ganha
--       `p_confirm_name`, conferido DENTRO da transação contra o nome ATUAL
--       (aluno ou turma) — a mesma forma que `admin_anonymize_student` já usa
--       desde a F2. A regra desce para o Postgres (Lei 3) e o app para de
--       comparar.
--
--  nº 9 · CUSTO DA GUARDA ATIVA×ATIVA. `_assert_no_active_overlap` (c12 · nº 1)
--       expande 366 dias × TODOS os horários vivos da professora. Ganha um
--       pré-filtro barato por dia-da-semana, com a fronteira PROVADA (abaixo) —
--       nada de "na prática não acontece".
--
-- Leis tocadas: 1 (a matemática de fuso da guarda não muda: continua o offset
-- do dia específico), 3 (a confirmação do encerramento desce para o banco), 7
-- (migration NOVA), 8 (a auditoria das funções tocadas segue intacta, e o
-- encerramento passa a auditar o nome digitado), 9 (nada de dinheiro muda).


-- ###########################################################################
-- nº 1 + nº 2 · A PRÉ-TRAVA EXCLUSIVA MUDA DE LUGAR: DO CHAMADOR PARA O GATILHO
-- ###########################################################################
--
-- O MECANISMO DO DEADLOCK, em três linhas (o c12 já o descreveu; aqui só o que
-- muda): a FK que aponta para `students` pega `FOR KEY SHARE` — lock
-- COMPARTILHADO, que duas transações obtêm ao mesmo tempo na mesma linha. Logo
-- depois, o gatilho de promoção (`_promote_lead`) faz `select … for update` NA
-- MESMA LINHA — lock EXCLUSIVO. Cada transação precisa que a outra solte o
-- compartilhado que já tem na mão: `deadlock detected`. Ordenar não resolve;
-- o que resolve é NÃO ESCALAR — pegar o exclusivo primeiro.
--
-- POR QUE NO GATILHO, E NÃO EM CADA RPC. A pré-trava do c12 vive em
-- `admin_create_contract`, que é a porta ABENÇOADA de criar contrato. Só que a
-- escalada não é da porta: é da FK mais o gatilho, e eles disparam para QUALQUER
-- INSERT — a renovação, o `insert` direto de membro que a policy de admin
-- admite, o import, a correção manual, e a porta que ainda não existe. Uma regra
-- que depende de cada chamador lembrar dela já falhou uma vez (é este achado).
-- No gatilho, ela é do DADO — a mesma escolha que a casa fez para a promoção de
-- lead, para a auditoria de linha e para o fuso confirmado (Lei 3).
--
-- A PRÉ-TRAVA DO c12 FICA ONDE ESTÁ. Ela virou redundância — o gatilho pega as
-- mesmas linhas alguns microssegundos depois —, mas é uma redundância que PAGA:
-- `admin_create_contract` escreve VÁRIOS alunos (a turma) em statements
-- diferentes, e é o `order by id` dela que dá a ordem TOTAL entre eles. O
-- gatilho, por ser `for each row`, ordena dentro de uma linha só; a ordem entre
-- as linhas de um `insert … select` é a ordem em que elas chegam. Tirar a
-- pré-trava reabriria o caso "duas turmas com os mesmos dois alunos, criadas em
-- paralelo, com os alunos em ordens opostas no array".
--
-- ORDEM CANÔNICA (20260727000700 + adendo do c12): `students` é o ANDAR 0 — o
-- topo, acima de `contracts`. Estes gatilhos o pedem antes de qualquer escrita
-- da linha que os disparou. A única função que pedia `contracts` ANTES de
-- `students` era `admin_renew_contract` (ela trava o contrato velho e só então
-- insere o novo); ela passa a pedir `students` primeiro, lá embaixo, e com isso
-- a escada volta a valer inteira, sem exceção que dependa de argumento.

/**
 * `students` travado ANTES do INSERT do contrato — o aluno direto e, no
 * contrato de turma, todos os membros que já estão nela.
 *
 * SECURITY DEFINER de propósito: `students` tem RLS, e um `select … for update`
 * que não ENXERGA a linha também não a TRAVA. Uma guarda de lock que depende do
 * papel de quem escreve é uma guarda que não existe metade das vezes.
 *
 * `order by s.id` porque um contrato de turma trava várias linhas de uma vez: é
 * a ordem total que faz duas transações concorrentes concordarem sobre quem vem
 * primeiro (uuid tem ordem total no Postgres).
 */
create or replace function public.contracts_lock_students()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform 1
    from students s
   where s.id = new.student_id
      or (new.student_group_id is not null
          and exists (select 1
                        from student_group_members m
                       where m.group_id = new.student_group_id
                         and m.student_id = s.id))
   order by s.id
     for update;
  return new;
end;
$fn$;

comment on function public.contracts_lock_students() is
  'c13 · nº 1: trava EXCLUSIVAMENTE (e em ordem de uuid) as linhas de `students` '
  'que o INSERT de contrato vai tocar, ANTES de a chave estrangeira pegar o '
  '`for key share` e de o gatilho de promoção tentar subir para o `for update` — '
  'a escalada de lock que fazia duas renovações do mesmo aluno deadlockarem '
  '(medido: 18 em 20 rodadas antes, 0 em 20 depois).';

revoke execute on function public.contracts_lock_students()
  from public, anon, authenticated, service_role;

create trigger contracts_lock_students
  before insert on contracts
  for each row execute function public.contracts_lock_students();

/**
 * O mesmo para a outra porta: entrar numa turma trava a linha do aluno antes de
 * a FK de `student_group_members` pegar o compartilhado.
 *
 * UMA LINHA SÓ, e é o suficiente para o caso medido (o mesmo aluno entrando em
 * duas turmas ao mesmo tempo). O que este gatilho NÃO pode dar é ordem entre
 * VÁRIAS linhas de um mesmo `insert` de muitos membros: elas são travadas na
 * ordem em que chegam. Quem dá essa ordem é a pré-trava de
 * `admin_create_contract` (`order by id`), que é a porta abençoada para criar
 * turma — e é por isso que ela fica de pé.
 */
create or replace function public.group_members_lock_student()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform 1 from students where id = new.student_id for update;
  return new;
end;
$fn$;

comment on function public.group_members_lock_student() is
  'c13 · nº 2: trava EXCLUSIVAMENTE a linha do aluno antes de a FK de '
  '`student_group_members` pegar o `for key share` — sem isto, o mesmo aluno '
  'entrando em duas turmas em paralelo deadlockava (medido: 18 em 20 rodadas).';

revoke execute on function public.group_members_lock_student()
  from public, anon, authenticated, service_role;

create trigger student_group_members_lock_student
  before insert on student_group_members
  for each row execute function public.group_members_lock_student();


-- ###########################################################################
-- nº 1 (parte 2) · `admin_renew_contract` pede `students` ANTES de `contracts`
-- ###########################################################################
--
-- Corpo COPIADO da versão viva (c12 · 20260727001200, que já traz o nº 10 e o
-- nº 11 daquela rodada) com UM bloco a mais, marcado no lugar. Lei 7: a
-- migration do c12 não foi tocada.
--
-- POR QUE ISTO, se o gatilho já resolve a escalada: resolve mesmo — a prova de
-- 20 rodadas foi feita com o gatilho e SEM este bloco, e deu zero. O bloco não
-- é sobre escalada, é sobre ORDEM: sem ele, esta função pediria `contracts`
-- (andar 1) e só depois `students` (andar 0), invertendo a escada para todo
-- mundo que vier depois. Hoje ninguém fecha ciclo com essa inversão (nenhuma
-- função segura `students` e depois espera por uma linha de `contracts` de
-- outra transação), mas essa é exatamente a espécie de argumento que a rodada
-- passada derrubou. Seis linhas para a escada valer sem argumento.

create or replace function public.admin_renew_contract(
  p_old uuid,
  p_switch_on date,
  p_plan_name text,
  p_hourly_rate_cents integer,
  p_allowance integer,
  p_min_notice integer,
  p_expiry_days integer,
  p_school_fault_days integer,
  p_actor uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old contracts%rowtype;
  v_actor uuid;
  v_pending int;
  v_new uuid;
  v_slot record;
  v_slots_copied int := 0;
  v_cancelled uuid[] := array[]::uuid[];
  v_live record;
  v_transferred int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_renew_contract é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- NOVO (c13 · nº 1): ANDAR 0 — as linhas de `students` deste contrato,
  -- exclusivamente e em ordem de uuid, antes da linha de `contracts`. A leitura
  -- do dono é SEM lock de propósito: ela só decide QUEM travar, e o vínculo
  -- aluno×contrato não muda na vida do contrato (não há porta que o mude). Se
  -- um dia mudar, o gatilho `contracts_lock_students` trava o dono certo no
  -- insert de qualquer jeito — este bloco é a ordem, não a garantia.
  perform 1
    from students s
   where s.id = (select c.student_id from contracts c where c.id = p_old)
      or exists (select 1
                   from contracts c
                   join student_group_members m on m.group_id = c.student_group_id
                  where c.id = p_old and m.student_id = s.id)
   order by s.id
     for update;

  select * into v_old from contracts where id = p_old for update;
  if not found then
    raise exception 'contrato % não existe', p_old;
  end if;
  if v_old.contract_type <> 'private_1on1' or v_old.status <> 'active' then
    raise exception 'renovação exige contrato particular ATIVO (pausado: retome antes)';
  end if;
  if p_switch_on < public.business_today() then
    raise exception 'a virada (%) não pode ficar no passado', p_switch_on;
  end if;
  -- P13: o limite documentado vira comportamento PROVADO.
  if p_switch_on > public.business_today() + 56 then
    raise exception 'a virada precisa estar a no máximo 8 semanas (recebido %)', p_switch_on;
  end if;
  -- c12 · nº 10: a virada também não pode ficar antes do INÍCIO do contrato que
  -- está sendo renovado (linhagem invertida).
  if p_switch_on < v_old.started_on then
    raise exception
      'a virada (%) não pode ser anterior ao início do contrato atual (%)',
      p_switch_on, v_old.started_on;
  end if;
  -- c12 · nº 11: ZERO é CORTESIA (S2-15); só o negativo recusa.
  if p_hourly_rate_cents is null or p_hourly_rate_cents < 0 then
    raise exception 'valor da aula inválido';
  end if;

  v_pending := public._contract_pending_count(p_old);
  if v_pending > 0 then
    raise exception 'há % aula(s) passada(s) sem desfecho — registre antes de renovar', v_pending;
  end if;

  -- c8 · R1: andares 2 e 4, ordenados por uuid, antes do advisory.
  perform 1 from class_instances
   where contract_id = p_old and state = 'scheduled'
     and (starts_at_utc at time zone public.business_tz())::date >= p_switch_on
   order by id
     for update;
  perform 1 from recurring_slots
   where contract_id = p_old and (active_to is null or active_to >= p_switch_on)
   order by id
     for update;

  -- (a) cancelar futuras do velho a partir da virada — SEM crédito, SEM aviso
  select coalesce(array_agg(ci.id), array[]::uuid[]) into v_cancelled
  from class_instances ci
  where ci.contract_id = p_old and ci.state = 'scheduled'
    and (ci.starts_at_utc at time zone public.business_tz())::date >= p_switch_on;
  if coalesce(array_length(v_cancelled, 1), 0) > 0 then
    update class_instances set state = 'cancelled' where id = any(v_cancelled);
  end if;

  -- (b) criar o novo (antes de fechar os slots, para copiá-los da foto viva)
  insert into contracts
    (contract_type, student_id, student_group_id, teacher_id, plan_name,
     hourly_rate_cents, monthly_reschedule_allowance, min_notice_hours,
     makeup_credit_expiry_days, school_fault_credit_expiry_days,
     started_on, status, renewed_from, group_tz_anchor_student)
  values
    ('private_1on1', v_old.student_id, v_old.student_group_id, v_old.teacher_id,
     p_plan_name, p_hourly_rate_cents, p_allowance, p_min_notice,
     p_expiry_days, p_school_fault_days, p_switch_on, 'active', p_old,
     v_old.group_tz_anchor_student)
  returning id into v_new;

  -- (c) fechar horários do velho na véspera e recriá-los no novo desde a virada
  for v_slot in
    select rs.* from recurring_slots rs
    where rs.contract_id = p_old
      and (rs.active_to is null or rs.active_to >= p_switch_on)
  loop
    update recurring_slots set active_to = p_switch_on - 1 where id = v_slot.id;
    perform public.create_slot(
      v_new, v_slot.weekday, v_slot.local_time, v_slot.iana_tz,
      v_slot.duration_min, p_switch_on, v_actor);
    v_slots_copied := v_slots_copied + 1;
  end loop;

  -- (d) encerrar o velho na véspera da virada (greatest: virada no dia do
  -- próprio started_on não viola o CHECK ended>=started)
  update contracts
     set status = 'ended', ended_on = greatest(p_switch_on - 1, v_old.started_on)
   where id = p_old;

  -- c8 · R1: o advisory do gasto no último andar.
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || p_old::text, 0));

  -- (e) créditos vivos migram preservando validade + duração (M3-4/P6)
  for v_live in
    select rc.ledger_id, rc.expires_on from public._makeup_remaining_credits(p_old) rc
    where rc.expires_on >= public.business_today()
    order by rc.ord
  loop
    perform public._reissue_credit(v_live.ledger_id, v_live.expires_on, v_actor,
      'renovação: crédito transferido', v_new);
    v_transferred := v_transferred + 1;
  end loop;

  perform public.log_audit(v_actor, 'renew_contract', 'contracts', v_new::text,
    jsonb_build_object(
      'renewed_from', p_old, 'switch_on', p_switch_on,
      'cancelled_instances', to_jsonb(v_cancelled),
      'slots_copied', v_slots_copied,
      'credits_transferred', v_transferred,
      'hourly_rate_cents', p_hourly_rate_cents));

  return v_new;
end;
$function$;

comment on function public.admin_renew_contract(uuid, date, text, integer, integer, integer, integer, integer, uuid) is
  'F4/M5-1 + c12 + c13: renovação guiada, toda no banco. A virada tem TRÊS pontas '
  '(nem no passado, nem além de 8 semanas, nem antes do `started_on` do contrato '
  'renovado). Valor ZERO é cortesia. Pede as linhas de `students` (andar 0) ANTES '
  'da linha de `contracts` — c13 · nº 1.';


-- ###########################################################################
-- nº 5 · O TYPE-TO-CONFIRM DO ENCERRAMENTO DESCE PARA A TRANSAÇÃO
-- ###########################################################################
--
-- O BURACO (TOCTOU): o c12 tirou o nome esperado do formulário — era um
-- `<input type="hidden">`, isto é, os DOIS lados da comparação nas mãos de quem
-- monta o POST — e o foi buscar no banco, em `endContractAction`. Mas a leitura
-- é uma consulta, e o encerramento é outra: entre as duas cabe qualquer coisa,
-- inclusive um `update students set display_name`. Quem digitou o nome de ontem
-- passa pelo portão hoje; quem digitou o nome de hoje é recusado se a ficha foi
-- renomeada logo depois da tela carregar. O portão da destrutiva grande não pode
-- decidir sobre um retrato — tem de decidir sobre a linha que ele mesmo travou.
--
-- A FORMA JÁ EXISTIA NA CASA: `admin_anonymize_student(p_student, p_confirm, …)`
-- confere o nome DENTRO da transação, contra a linha travada com `for update`. O
-- encerramento passa a ser o irmão dela.
--
-- POR QUE `drop` + `create`, e não `create or replace`: o parâmetro novo é
-- OBRIGATÓRIO (não tem default) e precisa vir antes dos opcionais, o que muda a
-- assinatura. Deixar a antiga de pé ao lado da nova criaria duas funções com o
-- mesmo nome, e uma chamada de quatro argumentos ficaria ambígua ("function is
-- not unique") — ou, pior, cairia calada na versão SEM confirmação. Lei 7 segue
-- valendo: o que não se edita é a migration antiga; o objeto no banco é
-- substituído por migration NOVA, como qualquer `create or replace`.
--
-- A RÉGUA DA COMPARAÇÃO: `lower(btrim(…))` dos dois lados. É a mesma que o app
-- usava (`nomeConfirmado`, com `sensitivity: 'accent'`): caixa não importa,
-- acento importa — "María" não é "Maria", e um nome trocado por outro não pode
-- passar por descuido de teclado. O app PARA de comparar (Lei 3: a regra mora
-- num lugar só, e esse lugar é a transação).

drop function public.admin_end_contract(uuid, uuid, text, uuid);

create or replace function public.admin_end_contract(
  p_contract uuid,
  -- c13 · nº 5: o nome que a pessoa DIGITOU. Obrigatório: encerrar contrato é
  -- destrutiva grande, e a confirmação é parte do ato, não enfeite da tela.
  p_confirm_name text,
  p_dest_contract uuid default null::uuid,
  p_writeoff_note text default null::text,
  p_actor uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old contracts%rowtype;
  v_dest contracts%rowtype;
  v_actor uuid;
  v_pending int;
  v_cancelled uuid[] := array[]::uuid[];
  v_slots int := 0;
  v_live record;
  v_transferred int := 0;
  v_writeoff int := 0;
  v_nome text;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_end_contract é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- (c7b · Q2): TODAS as linhas de contrato deste encerramento são travadas
  -- aqui, de uma vez e em ordem determinística por uuid, ANTES de qualquer
  -- advisory. `in (p_contract, p_dest_contract)` é null-safe.
  perform 1 from contracts
   where id in (p_contract, p_dest_contract)
   order by id
     for update;

  select * into v_old from contracts where id = p_contract;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;

  -- =========================================================================
  -- c13 · nº 5 · A CONFIRMAÇÃO, DENTRO DA TRANSAÇÃO
  -- =========================================================================
  --
  -- O nome vem de AGORA, e não do retrato que a tela carregou: a linha de
  -- `contracts` já está travada acima, e o nome é lido do aluno (ou do rótulo da
  -- turma) neste mesmo instante. Renomear entre a tela e o envio passa a ser o
  -- que sempre foi na cabeça de quem escreveu o portão: uma recusa.
  select coalesce(s.display_name, g.label) into v_nome
    from contracts c
    left join students s on s.id = c.student_id
    left join student_groups g on g.id = c.student_group_id
   where c.id = p_contract;

  if coalesce(btrim(v_nome), '') = '' then
    raise exception
      'este contrato não tem nome de confirmação (nem aluno, nem turma) — corrija o cadastro antes de encerrar';
  end if;
  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(v_nome)) then
    raise exception
      'confirmação não confere — digite o nome exato (%) para encerrar', v_nome;
  end if;

  if v_old.contract_type <> 'private_1on1' then
    raise exception 'encerramento estendido é de contratos particulares';
  end if;
  if v_old.status = 'ended' then
    raise exception 'contrato % já está encerrado', p_contract;
  end if;

  -- GATE DURO (M5-3): pendências exigem desfecho antes (o lote M1-3 é o atalho).
  v_pending := public._contract_pending_count(p_contract);
  if v_pending > 0 then
    raise exception 'há % aula(s) passada(s) sem desfecho neste contrato — registre antes (o botão "todas aconteceram" resolve as positivas)', v_pending;
  end if;

  -- c8 · R1: andares 2 e 4 da ordem canônica, ordenados por uuid, ainda ANTES
  -- do advisory.
  perform 1 from class_instances
   where contract_id = p_contract and state = 'scheduled' and starts_at_utc > now()
   order by id
     for update;
  perform 1 from recurring_slots
   where contract_id = p_contract
     and (active_to is null or active_to > public.business_today())
   order by id
     for update;

  -- destinação obrigatória quando há saldo vivo (escolha EXPLÍCITA)
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || p_contract::text, 0));
  if exists (
    select 1 from public._makeup_remaining_credits(p_contract) rc
    where rc.expires_on >= public.business_today()
  ) then
    if p_dest_contract is null and btrim(coalesce(p_writeoff_note, '')) = '' then
      raise exception 'este contrato tem créditos vivos — transfira para outro contrato do aluno OU dê baixa com motivo';
    end if;
  end if;
  if p_dest_contract is not null then
    select * into v_dest from contracts where id = p_dest_contract;
    if not found or v_dest.contract_type <> 'private_1on1' or v_dest.status <> 'active' then
      raise exception 'contrato destino inválido (precisa ser particular ATIVO)';
    end if;
    if p_dest_contract = p_contract then
      raise exception 'destino não pode ser o próprio contrato';
    end if;
    if not public._contracts_same_people(v_old, v_dest) then
      raise exception 'o destino precisa ser do MESMO aluno/grupo (M3-4)';
    end if;
  end if;

  -- futuras saem SEM crédito e SEM aviso (P4: deliberado — conversa humana).
  select coalesce(array_agg(ci.id), array[]::uuid[]) into v_cancelled
  from class_instances ci
  where ci.contract_id = p_contract and ci.state = 'scheduled' and ci.starts_at_utc > now();
  if coalesce(array_length(v_cancelled, 1), 0) > 0 then
    update class_instances set state = 'cancelled' where id = any(v_cancelled);
  end if;

  update recurring_slots
     set active_to = greatest(active_from, public.business_today())
   where contract_id = p_contract
     and (active_to is null or active_to > public.business_today());
  get diagnostics v_slots = row_count;

  -- destinação dos créditos vivos (validade e duração PRESERVADAS — M3-4/P6)
  for v_live in
    select rc.ledger_id, rc.expires_on from public._makeup_remaining_credits(p_contract) rc
    where rc.expires_on >= public.business_today()
    order by rc.ord
  loop
    if p_dest_contract is not null then
      perform public._reissue_credit(v_live.ledger_id, v_live.expires_on, v_actor,
        'encerramento: crédito transferido', p_dest_contract);
      v_transferred := v_transferred + 1;
    else
      insert into makeup_ledger
        (contract_id, student_id, delta, reason, consumes_ledger_id, note, created_by)
      values
        (p_contract, v_old.student_id, -1, 'manual_adjust', v_live.ledger_id,
         'encerramento: baixa — ' || p_writeoff_note, v_actor);
      v_writeoff := v_writeoff + 1;
    end if;
  end loop;

  -- greatest: contrato com started_on futuro nunca viola o CHECK ended>=started
  update contracts
     set status = 'ended', ended_on = greatest(public.business_today(), started_on)
   where id = p_contract;

  perform public.log_audit(v_actor, 'end_contract', 'contracts', p_contract::text,
    jsonb_build_object(
      'razao', 'encerramento',
      'cancelled_instances', to_jsonb(v_cancelled),
      'slots_closed', v_slots,
      'credits_transferred', v_transferred,
      'credits_written_off', v_writeoff,
      'dest_contract', p_dest_contract,
      'writeoff_note', p_writeoff_note,
      -- Lei 8: o portão da destrutiva grande deixa rastro do que foi conferido.
      'confirm_name', v_nome));

  return jsonb_build_object('cancelled', coalesce(array_length(v_cancelled, 1), 0),
                            'slots_closed', v_slots,
                            'transferred', v_transferred, 'written_off', v_writeoff);
end;
$function$;

comment on function public.admin_end_contract(uuid, text, uuid, text, uuid) is
  'M5-3/M3-4 + c13 · nº 5: encerramento estendido com type-to-confirm DENTRO da '
  'transação — `p_confirm_name` é conferido contra o nome ATUAL do aluno/turma, '
  'com a linha do contrato já travada. Renomear entre a tela e o envio recusa '
  '(era TOCTOU: o app comparava com um nome lido fora da transação).';

revoke execute on function public.admin_end_contract(uuid, text, uuid, text, uuid)
  from public, anon, service_role;
grant execute on function public.admin_end_contract(uuid, text, uuid, text, uuid)
  to authenticated;


-- ###########################################################################
-- nº 9 · O PRÉ-FILTRO DA GUARDA ATIVA×ATIVA (e o teto de comparações)
-- ###########################################################################
--
-- Corpo COPIADO da versão viva (c12 · nº 1) com DUAS cláusulas a mais, as duas
-- marcadas no lugar. A correção do c12 não muda de comportamento: o que muda é
-- quanto trabalho ela faz para chegar na mesma resposta.
--
-- A FRONTEIRA, PROVADA (e não "na prática não acontece"):
--   · um horário local no dia D, na zona Z, vira o instante `D + hora − offset(Z)`;
--     os offsets IANA vivem em [−12 h, +14 h];
--   · logo a faixa de um horário do dia D cabe, em UTC, dentro de
--     [D·24 h − 14 h, D·24 h + 24 h + 12 h + duração];
--   · a duração é no máximo 8 h desde o c12 · nº 3 (CHECK
--     `recurring_slots_duration_sane`, 15..480 min);
--   · duas faixas de dias D e D′ só podem se tocar se
--     (D′ − D)·24 h < 14 h + 24 h + 12 h + 8 h = 58 h, isto é, |D′ − D| ≤ 2.
-- Com |Δ| = 3 a distância mínima entre as faixas é 72 h − 58 h = 14 h: não há
-- fuso nem duração legais que as encostem. O filtro é `≤ 2` (circular), e não
-- `≤ 1`: com os fusos que a escola tem hoje (UTC−4 … UTC+1) um dia bastaria,
-- mas o filtro não pode depender de quais cidades a escola tem HOJE — aluno em
-- Auckland (UTC+13) é cadastro, não reescrita de invariante.
--
-- O TETO, na escala-alvo (50 alunos, 5 professoras, ~10 horários vivos cada):
-- o candidato tem ≤ 53 ocorrências em 366 dias; dos ~10 horários da professora,
-- 5/7 passam o pré-filtro (≈ 7), cada um com ≤ 53 ocorrências ⇒ ≤ 53 × 7 × 53 ≈
-- 20 mil comparações de faixa por chamada, no pior caso e sem índice nenhum.
-- Antes do pré-filtro eram ~28 mil; a economia real é de 2/7 do custo, e o que
-- ela compra de verdade é o CRESCIMENTO: o número não sobe com o calendário,
-- sobe com os horários da professora, e o filtro corta esse fator. `create_slot`
-- é ato interativo e raro (criar contrato, trocar horário) — não é caminho de
-- lote.

create or replace function public._assert_no_active_overlap(
  p_teacher uuid,
  p_slot uuid)
returns void
language plpgsql
volatile              -- pede lock; lock é efeito (mesma correção do c10 · T2)
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_novo recurring_slots%rowtype;
  v_de   date;
  v_ate  date;
  v_hit  record;
begin
  if p_teacher is null or p_slot is null then
    return;
  end if;

  -- 5º andar da ordem canônica, e o MESMO recurso que `_assert_no_paused_overlap`
  -- e `pause_contract` disputam: a agenda daquela professora. Reentrante.
  perform pg_advisory_xact_lock(hashtextextended('teacher_agenda:' || p_teacher::text, 0));

  select * into v_novo from recurring_slots where id = p_slot;
  if not found then
    return;
  end if;

  -- Horário de contrato que NÃO está ativo não disputa agenda nenhuma.
  if not exists (
    select 1 from contracts c where c.id = v_novo.contract_id and c.status = 'active'
  ) then
    return;
  end if;

  -- PORTA BARATA: sem outro horário vivo desta professora NO DIA VIZINHO não há
  -- o que comparar. O `(dia − dia + 7) % 7 in (0,1,2,5,6)` é o pré-filtro do
  -- c13 · nº 9 — a fronteira provada no cabeçalho (|Δ dia| ≤ 2).
  if not exists (
    select 1
      from recurring_slots rs
      join contracts c on c.id = rs.contract_id and c.status = 'active'
     where rs.teacher_id = p_teacher
       and rs.id <> p_slot
       and ((rs.weekday - v_novo.weekday + 7) % 7) in (0, 1, 2, 5, 6)
       and (rs.active_to is null or rs.active_to >= public.business_today())
  ) then
    return;
  end if;

  v_de := greatest(v_novo.active_from, public.business_today());
  v_ate := least(coalesce(v_novo.active_to, 'infinity'::date), v_de + 365);
  if v_de > v_ate then
    return;
  end if;

  with dias as (
    select g::date as dia
      from generate_series(v_de::timestamp, v_ate::timestamp, interval '1 day') g
  ),
  novo as (
    -- o horário que está nascendo, ocorrência a ocorrência, com o offset
    -- DAQUELE dia específico (Lei 1 — nada de offset fixo)
    select tstzrange(
             (d.dia + v_novo.local_time) at time zone v_novo.iana_tz,
             ((d.dia + v_novo.local_time) at time zone v_novo.iana_tz)
               + make_interval(mins => v_novo.duration_min)) as faixa
      from dias d
     where extract(dow from d.dia)::int = v_novo.weekday
  ),
  vivos as (
    select rs.contract_id,
           coalesce(s.display_name, g.label,
                    'contrato ' || left(rs.contract_id::text, 8)) as quem,
           d.dia,
           tstzrange(
             (d.dia + rs.local_time) at time zone rs.iana_tz,
             ((d.dia + rs.local_time) at time zone rs.iana_tz)
               + make_interval(mins => rs.duration_min)) as faixa
      from recurring_slots rs
      join contracts c on c.id = rs.contract_id and c.status = 'active'
      left join students s on s.id = c.student_id
      left join student_groups g on g.id = c.student_group_id
      cross join dias d
     where rs.teacher_id = p_teacher
       and rs.id <> p_slot
       -- c13 · nº 9: o mesmo pré-filtro, agora onde ele economiza a expansão.
       -- Dia da semana que dista mais de DOIS do candidato não pode encostar
       -- nele em fuso nenhum (prova no cabeçalho) — e cortar antes do
       -- `cross join dias` é o que evita materializar 53 faixas por horário.
       and ((rs.weekday - v_novo.weekday + 7) % 7) in (0, 1, 2, 5, 6)
       and extract(dow from d.dia)::int = rs.weekday
       and d.dia >= rs.active_from
       and (rs.active_to is null or d.dia <= rs.active_to)
       -- A FRONTEIRA do c12: só o dia que a exclusão GiST ainda não pôde julgar,
       -- porque não há aula daquele horário fixo naquele dia.
       and not exists (
             select 1 from class_instances ci
              where ci.slot_id = rs.id and ci.occurrence_date = d.dia)
  )
  -- Sem `n.dia = v.dia` de propósito: quem decide sobreposição é a FAIXA em UTC,
  -- nunca a data civil (é justamente por isso que o pré-filtro acima precisa de
  -- DOIS dias de folga, e não zero).
  select v.contract_id, v.quem, v.dia into v_hit
    from vivos v
    join novo n on n.faixa && v.faixa
   order by v.dia
   limit 1;

  if v_hit.contract_id is not null then
    raise exception
      'a professora já tem este horário em outro contrato ATIVO (%) — primeiro dia de choque: %. A agenda só é materializada 8 semanas à frente, então a aula ainda não existe, mas o horário está vendido',
      v_hit.quem, to_char(v_hit.dia, 'DD/MM/YYYY')
      using errcode = 'exclusion_violation', hint = 'horario-alem-do-horizonte';
  end if;
end;
$fn$;

comment on function public._assert_no_active_overlap(uuid, uuid) is
  'c12 · nº 1 + c13 · nº 9: recusa horário fixo que choca com o de outro contrato '
  'ATIVO da mesma professora nos dias que a exclusão GiST não alcança (os que '
  'ainda não têm aula materializada). Expande 365 dias com o offset do dia '
  'específico (Lei 1) e só compara horários cujo dia-da-semana dista ≤ 2 do '
  'candidato — fronteira provada por offset máximo (±14 h) e duração máxima (8 h, '
  'CHECK do c12 · nº 3).';

revoke execute on function public._assert_no_active_overlap(uuid, uuid)
  from public, anon, authenticated, service_role;
