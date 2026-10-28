-- ###########################################################################
-- LOTE c14 · AS CORREÇÕES DE BANCO DA RODADA 4 DO SOL (M4 + M5)
-- ###########################################################################
--
-- Migration NOVA (Lei 7): nada aqui edita a `20260727001300` nem nenhuma outra.
-- O que muda de forma (`alter table`) vem em `alter` novo; o que muda de corpo
-- vem em `create or replace` com a MESMA assinatura (os grants sobrevivem).
--
-- OS QUATRO ACHADOS DE BANCO QUE ESTE ARQUIVO FECHA (numeração do relatório do
-- Sol, rodada 4):
--
--  2.1 + 2.2 (GRAVE) · O ENVIO PARA ASSINATURA VIRA "RESERVA ANTES DE CHAMAR".
--       O c13 pôs um pré-check no `sendContractForSignatureAction`: pergunta ao
--       espelho se já há documento em andamento e só então chama o Autentique.
--       É check-then-act — dois cliques simultâneos passam os DOIS pela
--       pergunta (nenhum vê a linha do outro, que ainda não existe) e nascem
--       DOIS documentos externos, cada um com um e-mail para o aluno assinar. E
--       a leitura ainda descartava o `error`: PostgREST fora do ar devolvia
--       `data = null`, que o código lia como "não há nada em andamento" — falha
--       de leitura virando permissão de duplicar.
--       A CORREÇÃO É DE DESENHO, não de ordem de `if`: o espelho local nasce
--       ANTES da chamada externa, e a unicidade do banco é quem arbitra a
--       corrida. Ver a seção 1.
--
--  4.1 (GRAVE) · O TOCTOU DO NOME NÃO MORREU NO c13, SÓ ENCOLHEU. A confirmação
--       passou para dentro da transação (c13 · nº 5), mas a LEITURA do nome
--       acontece sem lock: entre ela e o `commit` a função ainda espera por
--       outros locks (as aulas, os horários, o advisory do gasto), e nessa
--       espera cabe um `update students set display_name` que commita. A
--       decisão continuava sendo sobre um retrato. Agora a leitura entra na
--       jaula: a linha do aluno (ou do grupo) é travada com `for update` ANTES
--       da linha de `contracts`. Ver a seção 2.
--
--  4.2 (MÉDIO) · NORMALIZAÇÃO UNICODE. `lower(btrim(…))` compara bytes: "Mário"
--       digitado com acento COMPOSTO (NFD: `a` + U+0301) é visualmente idêntico
--       ao "Mário" do cadastro (NFC: U+00E1) e era RECUSADO. Teclado de Mac,
--       colar de PDF e alguns IMEs produzem NFD sem avisar ninguém. Os dois
--       lados passam a ser normalizados para NFC antes da comparação — e o
--       acento continua importando (María ≠ Maria). Ver a seção 2.
--
--  5 (MÉDIO) · A PORTA DIRETA DE `student_group_members`. O c13 pôs o gatilho de
--       pré-trava justamente porque a policy de admin admite `insert` direto na
--       tabela — mas admitir esse insert é, em si, o defeito: a única porta que
--       a casa usa é `admin_create_contract`, e uma porta que ninguém usa é uma
--       porta que ninguém testa. `authenticated` perde o INSERT. Ver a seção 3.
--
--  7.1 (MÉDIO) · TETO DO NOME DO PLANO VIRA INVARIANTE. `maxLength={80}` no
--       HTML é conveniência de digitação, não regra: POST montado à mão entra
--       com 50 KB de plano e a coluna aceita. Vira CHECK (Lei 3). Ver a seção 4.
--
-- Leis tocadas: 3 (as três regras novas moram no Postgres), 6 (o espírito da
-- idempotência: a criação externa passa a ter uma chave local que a arbitra),
-- 7 (migration NOVA), 8 (as duas RPCs novas auditam; a trilha de linha da
-- tabela já existia). Nada de dinheiro muda (Lei 9), nada de fuso (Lei 1).


-- ###########################################################################
-- 1 · AUTENTIQUE: O ESPELHO NASCE ANTES DO DOCUMENTO (Sol 2.1 + 2.2)
-- ###########################################################################
--
-- O DESENHO, em três atos:
--
--   (a) `admin_begin_signature(contrato)` INSERE a reserva em `pending`. Um
--       índice ÚNICO PARCIAL por contrato-em-estado-não-terminal faz a corrida
--       ter um vencedor só: o segundo concorrente colide, e a colisão vira uma
--       recusa NOMEADA ("já existe pedido em andamento"), não um 23505 cru.
--   (b) a action chama o Autentique — e nesse instante já existe rastro local
--       do que ela foi fazer;
--   (c) `admin_finish_signature(reserva, documento|erro)` fecha a reserva: com
--       documento ela vira `sent` (o estado que o webhook/consulta conhece);
--       sem documento ela vira `failed`, terminal, o que LIBERA a próxima
--       tentativa sem liberar duplicata (a tentativa que falhou não criou
--       documento nenhum).
--
-- "O ESPELHO FALHOU DEPOIS DO EXTERNO" DEIXA DE EXISTIR POR CONSTRUÇÃO. Era a
-- janela que o c13 declarou em voz alta e não fechou: documento criado lá fora
-- e nenhum registro aqui. Agora o registro é o PRIMEIRO ato; o que pode falhar
-- depois dele é o ANEXO do id, e uma reserva sem id anexado é justamente o
-- estado que trava o próximo envio às cegas — a resposta certa para "não sei o
-- que aconteceu lá fora".
--
-- A REGRA F2 ("transição de status SÓ pela RPC do webhook") GANHA DUAS EXCEÇÕES
-- ESTREITAS, e elas estão inteiras aqui: `pending → sent` e `pending → failed`,
-- as duas dentro de `admin_finish_signature`, as duas auditadas, nenhuma
-- alcançando um documento que já existe no provedor (a reserva ainda não é um
-- documento). Nada mais muda status fora de `apply_autentique_event`: a admin
-- perde até o INSERT direto que tinha (o `grant insert` sai no fim desta seção),
-- e o único caminho de escrita passa a ser estas funções `security definer`.
--
-- POR QUE A RECLAMAÇÃO DE RESERVA ABANDONADA (o `update … 30 minutes` abaixo).
-- Uma reserva que nasce e nunca fecha — o processo Node morreu entre o begin e o
-- Autentique — bloquearia a assinatura DAQUELE contrato para sempre, e não há
-- tela para desbloquear. Trinta minutos é ordens de grandeza acima de qualquer
-- envio real (um PDF de 8 MB e o timeout do server action vivem em segundos), e
-- ordens de grandeza abaixo de "a dona tenta de novo amanhã". A reclamação é
-- auditada como qualquer desfecho.

alter table contract_signatures
  -- `pending` = reserva feita, documento ainda não existe lá fora.
  -- `failed`  = a criação externa não aconteceu; terminal, e por isso libera o
  --             próximo envio (não há documento pendurado em lugar nenhum).
  drop constraint contract_signatures_status_check,
  add constraint contract_signatures_status_check
    check (status in ('pending', 'sent', 'viewed', 'signed', 'refused',
                      'expired', 'cancelled', 'failed')),
  -- A reserva nasce SEM id de documento — é essa a diferença entre ela e um
  -- envio. A coluna deixa de ser `not null`…
  alter column provider_document_id drop not null,
  -- …e o CHECK diz exatamente QUEM pode ficar sem id: só a reserva viva e a que
  -- morreu antes de virar documento. Todo o resto (sent, viewed, e os terminais
  -- do provedor) tem de apontar para um documento de verdade.
  add constraint contract_signatures_document_shape
    check ((provider_document_id is null) = (status in ('pending', 'failed')));

comment on constraint contract_signatures_document_shape on contract_signatures is
  'c14 · Sol 2.1: espelho sem id de documento é reserva (pending) ou reserva '
  'morta (failed) — qualquer outro estado aponta para um documento que existe '
  'no provedor.';

/**
 * A UNICIDADE QUE MATA A CORRIDA.
 *
 * Parcial de propósito: o histórico de assinaturas de um contrato é longo
 * (re-envio de contrato corrigido, documento recusado e refeito), e a tabela é
 * filha justamente para preservá-lo (comment da 20260715000400). O que não pode
 * haver é DOIS pedidos VIVOS ao mesmo tempo — e vivo é `pending` (reserva),
 * `sent` (documento no ar) e `viewed` (o aluno abriu). `signed`, `refused`,
 * `expired`, `cancelled` e `failed` são fim de linha e não travam nada.
 */
create unique index contract_signatures_um_pedido_vivo
  on contract_signatures (contract_id)
  where status in ('pending', 'sent', 'viewed');

comment on index contract_signatures_um_pedido_vivo is
  'c14 · Sol 2.1: um pedido VIVO por contrato. É esta unicidade — e não um `if` '
  'na action — que decide a corrida entre dois cliques simultâneos: um insere, o '
  'outro colide e recebe a recusa nomeada de `admin_begin_signature`.';

create or replace function public.admin_begin_signature(
  p_contract uuid,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor uuid;
  v_id uuid;
  v_vivo contract_signatures%rowtype;
  v_reclamadas int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_begin_signature é restrita à admin';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  if not exists (select 1 from contracts c where c.id = p_contract) then
    raise exception 'contrato % não existe', p_contract;
  end if;

  -- Reserva ABANDONADA (ver o cabeçalho): o processo morreu entre o begin e o
  -- desfecho. Ela vira `failed` e sai do índice parcial, liberando a vaga.
  update contract_signatures
     set status = 'failed',
         last_event = jsonb_build_object(
           'source', 'begin_reclaim', 'at', now(),
           'motivo', 'reserva sem desfecho há mais de 30 minutos')
   where contract_id = p_contract
     and status = 'pending'
     and sent_at < now() - interval '30 minutes';
  get diagnostics v_reclamadas = row_count;

  begin
    insert into contract_signatures (contract_id, provider_document_id, status, created_by)
    values (p_contract, null, 'pending', v_actor)
    returning id into v_id;
  exception when unique_violation then
    -- READ COMMITTED: este SELECT abre snapshot novo e ENXERGA a linha que o
    -- vencedor acabou de commitar (foi ela que nos derrubou). A recusa diz o id
    -- do documento quando ele já existe — sem isso, "consulte a situação" é
    -- conselho sem endereço.
    select * into v_vivo from contract_signatures
     where contract_id = p_contract
       and status in ('pending', 'sent', 'viewed')
     limit 1;
    raise exception
      'este contrato já tem um pedido de assinatura em andamento (%) — consulte a situação dele antes de enviar de novo (dois envios = dois contratos para o aluno assinar)',
      coalesce(v_vivo.provider_document_id, 'documento ainda não criado');
  end;

  perform public.log_audit(v_actor, 'begin_signature', 'contract_signatures', v_id::text,
    jsonb_build_object('contract_id', p_contract, 'reservas_reclamadas', v_reclamadas));
  return v_id;
end;
$fn$;

comment on function public.admin_begin_signature(uuid, uuid) is
  'c14 · Sol 2.1: RESERVA o envio para assinatura ANTES da chamada externa. '
  'Insere a linha `pending` (sem id de documento); a unicidade parcial por '
  'contrato faz o segundo concorrente falhar limpo, com recusa nomeada. Exceção '
  'ESTREITA e auditada à regra F2 (só a RPC do webhook muda status): aqui não há '
  'transição, há o nascimento do espelho.';

revoke execute on function public.admin_begin_signature(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.admin_begin_signature(uuid, uuid) to authenticated;

create or replace function public.admin_finish_signature(
  p_signature uuid,
  p_document_id text default null,
  p_error text default null,
  p_actor uuid default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor uuid;
  v_sig contract_signatures%rowtype;
  v_doc text := nullif(btrim(coalesce(p_document_id, '')), '');
  v_novo text;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_finish_signature é restrita à admin';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_sig from contract_signatures where id = p_signature for update;
  if not found then
    raise exception 'reserva de assinatura % não existe', p_signature;
  end if;
  -- A exceção à regra F2 é ESTREITA: só a reserva ainda aberta. Documento que
  -- já foi enviado muda de estado pela consulta/webhook, e por mais nada.
  if v_sig.status <> 'pending' then
    raise exception
      'esta reserva já teve desfecho (%) — o estado de um documento enviado só muda pela consulta ao Autentique',
      v_sig.status;
  end if;

  v_novo := case when v_doc is null then 'failed' else 'sent' end;
  update contract_signatures
     set status = v_novo,
         provider_document_id = v_doc,
         -- `sent_at` passa a marcar o ENVIO, e não a reserva: é ele que a tela
         -- mostra ("enviado em") e que ordena o histórico.
         sent_at = now(),
         last_event = case
           when v_doc is null then jsonb_build_object(
             'source', 'send_failed', 'at', now(), 'erro', p_error)
           else last_event end
   where id = p_signature;

  perform public.log_audit(v_actor, 'finish_signature', 'contract_signatures',
    p_signature::text,
    jsonb_build_object('contract_id', v_sig.contract_id, 'from', 'pending',
                       'to', v_novo, 'provider_document_id', v_doc,
                       'erro', p_error));
  return v_novo;
end;
$fn$;

comment on function public.admin_finish_signature(uuid, text, text, uuid) is
  'c14 · Sol 2.1: DESFECHO da reserva criada por `admin_begin_signature`. Com id '
  'de documento vira `sent`; sem id vira `failed` (terminal, libera a próxima '
  'tentativa — a que falhou não criou documento nenhum). Só age sobre `pending`: '
  'documento enviado continua mudando de estado exclusivamente por '
  '`apply_autentique_event`.';

revoke execute on function public.admin_finish_signature(uuid, text, text, uuid)
  from public, anon, service_role;
grant execute on function public.admin_finish_signature(uuid, text, text, uuid) to authenticated;

-- A PORTA DIRETA FECHA. Enquanto `authenticated` puder inserir na tabela, a
-- reserva é opcional — e regra opcional não é regra (é o mesmo argumento da
-- seção 3). O INSERT sai do grant e a policy que o autorizava sai junto: policy
-- que nenhum privilégio alcança é promessa falsa para quem lê o schema. As duas
-- RPCs acima são `security definer` (dona da tabela) e não dependem de nada
-- disto.
revoke insert on contract_signatures from authenticated;
drop policy contract_signatures_admin_insert on contract_signatures;

comment on table contract_signatures is
  'Espelho de assinaturas (Autentique v2). Estado é TABELA-FILHA (re-envios/versões '
  'preservam histórico — Lei 8). c14: o espelho NASCE antes do documento — INSERT '
  'só por `admin_begin_signature` (reserva `pending`), desfecho por '
  '`admin_finish_signature` (`sent` com documento, `failed` sem), e as demais '
  'TRANSIÇÕES exclusivamente por `apply_autentique_event` (service_role, webhook/'
  'consulta). Um pedido VIVO por contrato (índice parcial).';


-- ###########################################################################
-- 2 · `admin_end_contract`: A LEITURA DO NOME ENTRA NA JAULA (Sol 4.1) E
--     COMPARA UNICODE NORMALIZADO (Sol 4.2)
-- ###########################################################################
--
-- Corpo COPIADO da versão viva (c13 · nº 5, migration 20260727001300) com DOIS
-- blocos marcados no lugar. Assinatura idêntica — `create or replace` mantém os
-- grants (`authenticated`) e não deixa duas funções de pé.
--
-- O QUE FALTAVA (Sol 4.1). O c13 acertou o lugar da comparação (dentro da
-- transação) e errou o objeto dela: comparava com uma linha que NÃO estava
-- travada. A sequência que ainda passava:
--   T1 chama o encerramento, lê "Elisa Faria" (sem lock), aprova;
--   T1 fica esperando o advisory do gasto de crédito, que T2 segura;
--   T2 renomeia para "Elisa Nakamura" e commita;
--   T1 acorda e encerra — com um nome que ninguém mais tem.
-- O portão da destrutiva grande decidia sobre um retrato de novo, só que com um
-- retrato mais fresco. Agora a linha do aluno (ou a do grupo) é travada com
-- `for update` ANTES da linha de `contracts`, e a renomeação concorrente fica
-- na porta até o encerramento acabar — se ela chegar primeiro, é o nome NOVO que
-- a confirmação tem de bater.
--
-- ONDE ISSO ENTRA NA ESCADA (a ordem canônica de 20260727000700 + c13):
--   andar 0a  `students`        ← já era o topo desde o c13 (gatilhos + renovação)
--   andar 0b  `student_groups`  ← DECLARADO AQUI: fica logo abaixo de `students`
--                                 e ACIMA de `contracts`. Não há função que
--                                 segure `contracts` e depois peça `student_groups`
--                                 (a única que escreve grupo é
--                                 `admin_create_contract`, que o CRIA antes do
--                                 contrato), então o andar novo não inverte nada.
--   andar 1   `contracts`
--   andares 2/4 `class_instances`, `recurring_slots`
--   andar 5   advisory (`makeup_spend:`)
-- Um contrato tem aluno OU turma, nunca os dois: na prática só um dos dois
-- `perform` trava alguma coisa. A ordem entre eles está escrita mesmo assim,
-- porque escada só vale quando não depende de qual argumento chegou.
--
-- A LEITURA QUE DECIDE QUEM TRAVAR é sem lock, de propósito, e é a mesma escolha
-- (com a mesma justificativa) de `admin_renew_contract` no c13: ela só pergunta
-- QUAL linha travar, e o vínculo aluno×contrato / turma×contrato não muda na
-- vida do contrato — não existe porta que o mude.
--
-- A NORMALIZAÇÃO (Sol 4.2). `normalize(x, nfc)` dos dois lados, antes de
-- `btrim`/`lower`. É PG ≥ 13 (a bancada e a VPS estão bem acima). O que muda: o
-- mesmo nome escrito com acento decomposto passa a confirmar. O que NÃO muda:
-- acento continua sendo letra ("Mario" não encerra o contrato da "Mário"), caixa
-- e espaço em volta continuam sendo ruído de digitação.

create or replace function public.admin_end_contract(
  p_contract uuid,
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

  -- =========================================================================
  -- c14 · Sol 4.1 · ANDAR 0: O DONO DO NOME É TRAVADO ANTES DE TUDO
  -- =========================================================================
  -- Sem isto, a linha de onde sai o nome da confirmação podia mudar embaixo
  -- desta transação enquanto ela espera pelos locks de baixo (o advisory do
  -- gasto é o mais provável). Com isto, ou a renomeação entra antes e é o nome
  -- NOVO que precisa ser digitado, ou ela espera o encerramento terminar.
  perform 1
    from students s
   where s.id = (select c.student_id from contracts c where c.id = p_contract)
   order by s.id
     for update;
  perform 1
    from student_groups g
   where g.id = (select c.student_group_id from contracts c where c.id = p_contract)
   order by g.id
     for update;

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
  -- O nome vem de AGORA, e não do retrato que a tela carregou — e desde o c14 a
  -- linha de onde ele sai está TRAVADA (andar 0, acima), então "agora" vale até
  -- o commit.
  select coalesce(s.display_name, g.label) into v_nome
    from contracts c
    left join students s on s.id = c.student_id
    left join student_groups g on g.id = c.student_group_id
   where c.id = p_contract;

  if coalesce(btrim(v_nome), '') = '' then
    raise exception
      'este contrato não tem nome de confirmação (nem aluno, nem turma) — corrija o cadastro antes de encerrar';
  end if;
  -- c14 · Sol 4.2: NFC dos dois lados. O acento composto (NFD) que teclado de
  -- Mac e "colar de PDF" produzem é o MESMO nome para os olhos — e era recusa.
  if lower(btrim(normalize(coalesce(p_confirm_name, ''), nfc)))
     <> lower(btrim(normalize(v_nome, nfc))) then
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
  'M5-3/M3-4 + c13 · nº 5 + c14 · Sol 4.1/4.2: encerramento estendido com '
  'type-to-confirm dentro da transação E com a linha do NOME travada (`students` '
  '/ `student_groups`, andar 0, antes de `contracts`) — renomear em paralelo '
  'espera ou obriga a digitar o nome novo. A comparação normaliza Unicode para '
  'NFC dos dois lados (acento composto é o mesmo nome; acento continua sendo '
  'letra).';


-- ###########################################################################
-- 3 · `student_group_members`: A PORTA DIRETA FECHA (Sol 5)
-- ###########################################################################
--
-- O c13 pôs um gatilho `before insert` nesta tabela para que o `insert` direto
-- não deadlockasse — e o Sol tem razão em dizer que consertar a porta não era o
-- bastante: a porta não devia existir. Entrar numa turma não é um fato solto; é
-- parte de um ato maior (criar contrato de grupo), e esse ato é `admin_create_
-- contract`, que trava os alunos em ordem total, promove leads, audita e faz
-- tudo numa transação. Um `insert` avulso pela API pula tudo isso e ainda mora
-- no único caminho onde só o gatilho protege.
--
-- O QUE SAI: `insert` de `authenticated` (o papel de qualquer sessão logada,
-- inclusive a da admin — a policy `student_group_members_admin_all` deixa de
-- alcançar o INSERT porque não há mais privilégio para a policy filtrar).
-- O QUE FICA: `select` (o portal e a ficha leem membros), `update`/`delete` (não
-- são o caminho do deadlock e há telas que dependem deles), e o insert do DONO
-- da tabela — que é quem `admin_create_contract` usa (`security definer`) e
-- quem as fixtures da suíte usam (conexão direta como `postgres`).
-- `service_role` nunca teve INSERT aqui (medido: só SELECT), então nada de
-- webhook/worker é afetado.
--
-- O GATILHO DO c13 CONTINUA DE PÉ, e é ele que segura o caminho que sobrou: o
-- insert do dono da tabela (fixture, script de migração de dados, correção
-- manual). É por isso que a prova de membro×membro do c14 insere COMO DONO — é
-- o único lugar onde o gatilho é a defesa inteira.
revoke insert on student_group_members from authenticated;


-- ###########################################################################
-- 4 · O TETO DO NOME DO PLANO VIRA INVARIANTE (Sol 7.1)
-- ###########################################################################
--
-- `maxLength={80}` existe nas três telas desde o c13 e é o que deve existir:
-- ele avisa ANTES de a pessoa digitar demais. O que faltava é o outro lado — a
-- regra (Lei 3). Sem ela, o campo é de tamanho livre para qualquer POST montado
-- à mão, e um nome de plano de 50 KB entra na coluna, viaja no rascunho da
-- admissão, estoura o endereço da etapa 2 e aparece inteiro em toda listagem.
--
-- 80 é o número das telas, e a bancada confere: o maior `plan_name` existente
-- tem 26 caracteres (medido antes desta migration, em 678 contratos), e os
-- nomes de produção são mais curtos ainda ("Aulas particulares", "Personal
-- Travel"). O CHECK nasce VALIDADO — não há linha para converter.
alter table contracts
  add constraint contracts_plan_name_len
    check (char_length(plan_name) <= 80);

comment on constraint contracts_plan_name_len on contracts is
  'c14 · Sol 7.1: o teto que as três telas já mostravam (`maxLength={80}`) vira '
  'regra do banco — campo de tamanho livre é convite a POST montado à mão.';
