-- ###########################################################################
-- LOTE c15 · AS CORREÇÕES DE BANCO DA RODADA 5 DO SOL (M4 + M5)
-- ###########################################################################
--
-- Migration NOVA (Lei 7): NADA aqui edita a `20260727001400` nem nenhuma outra.
-- O que muda de forma vem em `alter` novo; o que muda de corpo vem em
-- `create or replace` com a MESMA assinatura (os grants sobrevivem).
--
-- ESTE LOTE REVERTE DUAS COISAS DO c14, por decisão de desenho do dono da
-- arquitetura, e a reversão é o assunto principal do arquivo:
--
--  (A) ERRO AMBÍGUO NUNCA MAIS VIRA `failed`. O c14 fechou a reserva como
--      `failed` no `catch` do envio — QUALQUER exceção. Só que "o fetch caiu",
--      "estourou o timeout" e "a resposta veio truncada" NÃO dizem que o
--      documento não nasceu lá fora; dizem que não sabemos. Marcar `failed`
--      nesses casos LIBERA o próximo envio, e o próximo envio cria o SEGUNDO
--      contrato para o mesmo aluno assinar — exatamente o defeito que a reserva
--      existia para matar. Agora `failed` é desfecho de uma recusa
--      INEQUÍVOCA (a API respondeu, com corpo interpretado, que não criou); o
--      ambíguo deixa a reserva ABERTA, que é o estado honesto de "não sei o que
--      houve lá fora" e trava o envio às cegas. Quem decide o que fazer com ela
--      é gente, na seção 4.
--
--  (B) O RECLAIM AUTOMÁTICO DE 30 MINUTOS MORRE (Sol, achado 2). Ele era
--      invenção do c14 e roubava reserva VIVA: um envio lento (PDF grande, fila
--      do provedor, retry interno do fetch) que passasse de 30 minutos tinha a
--      vaga reclamada pelo clique seguinte — e aí sim nasciam dois documentos,
--      agora com a bênção do banco. Trocar "documento duplicado" por "reserva
--      presa" foi negócio ruim: reserva presa é visível, chata e reversível;
--      documento duplicado é invisível e chega no e-mail do aluno. No lugar do
--      relógio entram DOIS ATOS HUMANOS AUDITADOS (seção 4): cancelar a reserva
--      (com frase de confirmação que manda conferir o Autentique antes) e
--      anexar o id do documento que se descobriu existir. A escala é 20 alunos:
--      menos máquina, mais ato humano com nome e motivo no `audit_log`.
--
-- E FECHA OS DEMAIS ACHADOS DE BANCO DA RODADA:
--
--  · Sol 4  — webhook que chega ANTES do anexo não se perde: a inbox não marca
--             `processed_at` quando não há espelho, e o ANEXO reaplica os
--             eventos presos daquele documento, em ordem (seção 5).
--  · Sol 5  — `student_group_members` perde o UPDATE de `authenticated`
--             (seção 7).
--  · Sol 6  — o VÍNCULO do contrato (aluno/turma/tipo/professora) vira imutável
--             por gatilho (seção 6).
--  · Sol 7  — preflight do índice único, com diagnóstico (seção 0).
--  · Sol 8  — `sent_at` deixa de mentir: reserva tem `reserved_at`, e `sent_at`
--             só existe quando existe documento (seção 1).
--  · Sol 12 — a confirmação de nome normaliza também os espaços INTERNOS
--             (seção 2).
--
-- Leis tocadas: 3 (as regras novas moram no Postgres), 6 (a idempotência do
-- webhook deixa de depender de o espelho já existir), 7 (migration NOVA), 8 (os
-- dois atos humanos auditam ator e motivo). Nada de dinheiro (Lei 9), nada de
-- fuso (Lei 1).


-- ###########################################################################
-- 0 · PREFLIGHT: O ÍNDICE ÚNICO NÃO CABE EM DADO SUJO (Sol 7)
-- ###########################################################################
--
-- `contract_signatures_um_pedido_vivo` (c14) é único parcial em
-- `contract_id where status in ('pending','sent','viewed')`. Se algum contrato
-- já tiver DOIS pedidos vivos, a criação do índice falha com a mensagem crua do
-- Postgres — que diz o valor duplicado e mais nada: nem qual contrato de quem,
-- nem quantos, nem o que fazer.
--
-- O QUE ESTA VARREDURA ALCANÇA, e o que não. Ela roda DEPOIS da `001400` (as
-- migrations aplicam em ordem de nome, e a Lei 7 proíbe voltar lá para pôr o
-- diagnóstico antes do índice). Então:
--   · num ambiente onde a `001400` já passou, ela é barata e redundante — e
--     fica porque o índice pode ser derrubado à mão (manutenção, restore
--     parcial) e porque as funções desta migration DEPENDEM da unicidade;
--   · num ambiente que ainda vai receber as duas, quem falha primeiro é a
--     `001400`, com a mensagem crua. Para esse deploy, a conferência é ANTES,
--     com a mesma pergunta que está aqui (runbook §N):
--
--       select contract_id, count(*) from contract_signatures
--        where status in ('pending','sent','viewed') group by 1 having count(*) > 1;
--
-- O QUE ELA NUNCA FAZ: sanear. Escolher qual pedido vivo morre é decisão de
-- quem sabe se o documento existe no Autentique — e essa pessoa não é uma
-- migration.
do $preflight$
declare
  v_sujos text;
begin
  select string_agg(format('%s (%s pedidos vivos)', contract_id, n), ', ' order by contract_id)
    into v_sujos
  from (
    select contract_id, count(*) as n
      from contract_signatures
     where status in ('pending', 'sent', 'viewed')
     group by contract_id
    having count(*) > 1
  ) sujos;

  if v_sujos is not null then
    raise exception
      'c15 · preflight: há contrato com mais de um pedido de assinatura VIVO, e a unicidade de `contract_signatures_um_pedido_vivo` não cabe neste dado: %. Confira cada um no painel do Autentique e resolva à mão (cancele o pedido que não virou documento) ANTES de aplicar esta migration — nenhuma migration escolhe por você qual assinatura morre',
      v_sujos;
  end if;
end;
$preflight$;


-- ###########################################################################
-- 1 · `sent_at` DEIXA DE MENTIR (Sol 8)
-- ###########################################################################
--
-- No c14 a reserva nascia com `sent_at = now()` (o default da coluna, de 2026-
-- 07-15, quando toda linha era um envio de verdade). A tela lê essa coluna como
-- "enviado em" — então uma reserva que NUNCA virou documento exibia "enviado em
-- 27/07 14:32", e uma reserva morta (`failed`) exibia a mesma coisa. Data de
-- envio de um envio que não aconteceu é a pior espécie de dado: parece fato.
--
-- O DESENHO: duas colunas para dois fatos distintos.
--   `reserved_at` — quando a admin COMEÇOU o pedido. Toda linha tem, sempre; é
--                   ela que ordena o histórico (a tela lia `sent_at` para isso).
--   `sent_at`     — quando o documento passou a EXISTIR no provedor. Só existe
--                   junto com `provider_document_id`, e é o CHECK abaixo que
--                   amarra os dois: `pending` e `failed` não dizem "enviado em"
--                   porque não podem.
--
-- O default some de propósito: quem escreve `sent_at` passa a ter de DIZER que
-- houve envio (a RPC de anexo, e as fixtures que simulam um documento pronto).
alter table contract_signatures
  add column reserved_at timestamptz,
  alter column sent_at drop default,
  alter column sent_at drop not null;

-- Backfill exato: até aqui toda linha tinha `sent_at` not null, e o instante em
-- que o pedido começou era esse mesmo.
update contract_signatures set reserved_at = sent_at where reserved_at is null;

-- E a CONVERSÃO que dá sentido à coluna: uma linha sem documento nunca foi
-- enviada, então o carimbo de envio que ela carregava (o default do c14) some.
-- Não é saneamento de dado de negócio — o instante não se perde, ele acabou de
-- ser copiado para `reserved_at`, que é o nome verdadeiro dele. Sem esta linha,
-- toda reserva `pending` viva no momento do deploy derrubaria o CHECK abaixo.
update contract_signatures set sent_at = null where provider_document_id is null;

alter table contract_signatures
  alter column reserved_at set not null,
  alter column reserved_at set default now(),
  add constraint contract_signatures_sent_shape
    check ((sent_at is null) = (provider_document_id is null));

comment on column contract_signatures.reserved_at is
  'c15 · Sol 8: quando o PEDIDO começou (a reserva de `admin_begin_signature`). '
  'Toda linha tem — é esta coluna que ordena o histórico na tela.';
comment on column contract_signatures.sent_at is
  'c15 · Sol 8: quando o DOCUMENTO passou a existir no provedor. NULO enquanto '
  'não existe (reserva `pending`) e para sempre na reserva morta (`failed`) — '
  'sem isso a tela dizia "enviado em" para um envio que não aconteceu.';
comment on constraint contract_signatures_sent_shape on contract_signatures is
  'c15 · Sol 8: carimbo de envio e id de documento nascem juntos ou não nascem.';

-- O histórico é lido por contrato, do mais recente para o mais antigo — e a
-- ordem agora é `reserved_at`. O índice irmão de `contract_signatures_contract_idx`
-- (que ordena por `sent_at`, hoje nulo em duas situações) existe para a leitura
-- do detalhe não virar sort em memória quando a tabela crescer.
create index contract_signatures_contract_reserved_idx
  on contract_signatures (contract_id, reserved_at desc);


-- ###########################################################################
-- 2 · A CONFIRMAÇÃO DE NOME, EM UM LUGAR SÓ (Sol 12)
-- ###########################################################################
--
-- O c14 pôs NFC dos dois lados. Faltava o espaço INTERNO: "Maria  Clara" (dois
-- espaços, o clássico do copiar-colar de PDF e do nome digitado com pressa no
-- cadastro) era outro nome para a comparação, e a pessoa via a recusa sem ver a
-- diferença — porque não HÁ diferença visível. Agora toda sequência de espaço
-- em branco vira UM espaço, dos dois lados.
--
-- O QUE CONTINUA SENDO LETRA: acento (María ≠ Maria) e qualquer caractere que
-- não seja espaço. O que é ruído: caixa, espaço em volta, espaço repetido no
-- meio, e a diferença NFC/NFD do mesmo acento.
--
-- FORA DE ALCANCE, DECLARADO: case-folding COMPLETO do Unicode. `lower()` no
-- Postgres é dobra simples — "Straße" e "STRASSE" continuam sendo nomes
-- diferentes aqui, e "İ" (turco) não dobra para "i" como o falante espera. A
-- casa cadastra nomes pt-BR; quando um aluno alemão ou turco entrar, o caminho
-- é `lower(x collate "und-x-icu")` com a versão do ICU conferida, não um
-- remendo por cima desta função.
create or replace function public._confirmacao_normal(p_texto text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  -- A ordem importa: NFC primeiro (o acento composto vira o mesmo ponto de
  -- código do cadastro), depois a dobra de espaço, e só então `btrim` — que
  -- limpa o espaço das pontas que a dobra deixou.
  select btrim(regexp_replace(lower(normalize(coalesce(p_texto, ''), nfc)), '\s+', ' ', 'g'));
$fn$;

create or replace function public._confirmacao_bate(p_digitado text, p_esperado text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select public._confirmacao_normal(p_digitado) = public._confirmacao_normal(p_esperado);
$fn$;

comment on function public._confirmacao_normal(text) is
  'c15 · Sol 12: a forma canônica de um nome para type-to-confirm — NFC, caixa '
  'baixa, espaço em branco dobrado em UM espaço, pontas aparadas. Case-folding '
  'completo do Unicode (ß/İ) fica FORA: a casa cadastra nomes pt-BR, e o caminho '
  'certo seria collation ICU, não remendo aqui.';
comment on function public._confirmacao_bate(text, text) is
  'c15 · Sol 12: o portão das destrutivas grandes — o que a pessoa digitou é o '
  'nome esperado? Acento é letra; caixa e espaço são ruído.';

revoke execute on function public._confirmacao_normal(text) from public, anon;
revoke execute on function public._confirmacao_bate(text, text) from public, anon;


-- ###########################################################################
-- 3 · `admin_end_contract`: A COMPARAÇÃO PASSA A USAR A RÉGUA ÚNICA
-- ###########################################################################
--
-- Corpo COPIADO da versão viva (c14, migration 20260727001400) com UM bloco
-- trocado: a comparação de nome vira `_confirmacao_bate`. Tudo o mais — a jaula
-- do andar 0 (Sol 4.1), a escada de locks, o gate de pendências, a destinação
-- dos créditos — está aqui idêntico, porque `create or replace` substitui o
-- corpo inteiro.

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

  -- c14 · Sol 4.1 · ANDAR 0: o dono do NOME é travado antes de tudo, para que a
  -- linha de onde sai a confirmação não mude embaixo desta transação enquanto
  -- ela espera pelos locks de baixo.
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

  -- (c7b · Q2): TODAS as linhas de contrato deste encerramento, de uma vez e em
  -- ordem determinística por uuid, ANTES de qualquer advisory.
  perform 1 from contracts
   where id in (p_contract, p_dest_contract)
   order by id
     for update;

  select * into v_old from contracts where id = p_contract;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;

  -- c13 · nº 5: a confirmação acontece DENTRO da transação, contra a linha já
  -- travada — o nome é o de AGORA, e "agora" vale até o commit.
  select coalesce(s.display_name, g.label) into v_nome
    from contracts c
    left join students s on s.id = c.student_id
    left join student_groups g on g.id = c.student_group_id
   where c.id = p_contract;

  if coalesce(btrim(v_nome), '') = '' then
    raise exception
      'este contrato não tem nome de confirmação (nem aluno, nem turma) — corrija o cadastro antes de encerrar';
  end if;
  -- c15 · Sol 12: a régua saiu daqui e virou `_confirmacao_bate` (NFC + caixa +
  -- espaço interno dobrado). Um lugar só, para os dois portões que a usam.
  if not public._confirmacao_bate(p_confirm_name, v_nome) then
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
  'M5-3/M3-4 + c13 · nº 5 + c14 · Sol 4.1/4.2 + c15 · Sol 12: encerramento '
  'estendido com type-to-confirm dentro da transação, com a linha do NOME '
  'travada (andar 0) e com a comparação feita pela régua única '
  '`_confirmacao_bate` (NFC, caixa e espaço interno são ruído; acento é letra).';


-- ###########################################################################
-- 4 · A RESERVA DE ASSINATURA: O RELÓGIO SAI, A GENTE ENTRA (decisões A e B)
-- ###########################################################################

/**
 * `admin_begin_signature` SEM O RECLAIM.
 *
 * Corpo copiado do c14 menos o `update … 30 minutes` — e menos a variável que o
 * contava. A recusa passa a dizer O QUE FAZER, porque agora existe o que fazer:
 * ou o documento existe no Autentique (e o caminho é anexar o id) ou não existe
 * (e o caminho é cancelar a reserva). As duas portas são a seção 4.2/4.3.
 *
 * NÃO HÁ FUNÇÃO DE RECLAIM PARA DERRUBAR: no c14 ele era um `update` DENTRO
 * desta mesma função, não uma RPC própria. Este `create or replace` é, por si,
 * a morte dele — e a `001400` fica intocada (Lei 7), com o histórico dizendo em
 * voz alta o que foi tentado e por que não sobreviveu.
 */
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
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_begin_signature é restrita à admin';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  if not exists (select 1 from contracts c where c.id = p_contract) then
    raise exception 'contrato % não existe', p_contract;
  end if;

  begin
    insert into contract_signatures (contract_id, provider_document_id, status, created_by)
    values (p_contract, null, 'pending', v_actor)
    returning id into v_id;
  exception when unique_violation then
    -- READ COMMITTED: este SELECT abre snapshot novo e ENXERGA a linha que o
    -- vencedor acabou de commitar (foi ela que nos derrubou).
    select * into v_vivo from contract_signatures
     where contract_id = p_contract
       and status in ('pending', 'sent', 'viewed')
     limit 1;
    if v_vivo.provider_document_id is not null then
      raise exception
        'este contrato já tem um pedido de assinatura em andamento (documento %) — consulte a situação dele antes de enviar de novo (dois envios = dois contratos para o aluno assinar)',
        v_vivo.provider_document_id;
    end if;
    raise exception
      'este contrato tem uma reserva de assinatura ABERTA (documento ainda não criado, desde %) — confira no painel do Autentique se o documento existe: se existir, anexe o id dele à reserva; se não existir, cancele a reserva. As duas coisas se fazem no painel de assinatura deste contrato',
      to_char(v_vivo.reserved_at, 'DD/MM/YYYY HH24:MI');
  end;

  perform public.log_audit(v_actor, 'begin_signature', 'contract_signatures', v_id::text,
    jsonb_build_object('contract_id', p_contract));
  return v_id;
end;
$fn$;

comment on function public.admin_begin_signature(uuid, uuid) is
  'c14 · Sol 2.1 + c15 · decisão B: RESERVA o envio ANTES da chamada externa; a '
  'unicidade parcial arbitra a corrida. O reclaim automático de 30 minutos do '
  'c14 MORREU aqui — ele roubava reserva viva (envio lento vira documento '
  'duplicado). Reserva aberta se resolve por ato humano: anexar o id do '
  'documento (`admin_finish_signature`) ou cancelar (`admin_cancel_signature`).';

/**
 * `admin_finish_signature` — o DESFECHO da reserva, agora com três novidades:
 *
 *  1. `sent_at` só é escrito quando há documento (Sol 8). A reserva morta não
 *     ganha carimbo de envio, porque envio não houve.
 *  2. o id do documento passa por uma guarda de FORMA. Ela é deliberadamente
 *     folgada — hexadecimal longo, com ou sem hífen, é o que a doc do Autentique
 *     descreve, e o token de verdade ainda é gate externo pendente (🔑): apertar
 *     mais seria adivinhar o formato do provedor e recusar documento legítimo em
 *     produção. O que ela pega é o que o dedo humano erra: campo em branco,
 *     espaço no meio, uma URL colada inteira, o nome do arquivo.
 *  3. ANEXAR O DOCUMENTO REAPLICA OS EVENTOS PRESOS (Sol 4). Ver a seção 5.
 *
 * Ela serve DOIS chamadores, e é a mesma função de propósito: a action logo
 * depois de criar o documento, e a admin anexando à mão o id de um documento
 * que ela viu existir no painel do Autentique. O ato é o mesmo — casar a
 * reserva com o documento —, então a regra é uma só.
 */
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
  v_ev record;
  v_reaplicados int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_finish_signature é restrita à admin';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  if v_doc is not null and v_doc !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception
      'id de documento do Autentique inválido (%) — ele é uma sequência longa de letras e números, sem espaços. Copie o id da URL do documento no painel do Autentique',
      left(v_doc, 60);
  end if;

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
         -- c15 · Sol 8: o carimbo de ENVIO nasce com o documento. Reserva morta
         -- fica sem — ela nunca foi enviada, e a tela não vai dizer que foi.
         sent_at = case when v_doc is null then null else now() end,
         last_event = case
           when v_doc is null then jsonb_build_object(
             'source', 'send_failed', 'at', now(), 'erro', p_error)
           else last_event end
   where id = p_signature;

  -- c15 · Sol 4: os eventos que chegaram ANTES deste anexo são aplicados agora,
  -- na ordem em que a inbox os recebeu. Ver a seção 5.
  if v_doc is not null then
    v_reaplicados := public._reaplicar_eventos_autentique(v_doc);
  end if;

  perform public.log_audit(v_actor, 'finish_signature', 'contract_signatures',
    p_signature::text,
    jsonb_build_object('contract_id', v_sig.contract_id, 'from', 'pending',
                       'to', v_novo, 'provider_document_id', v_doc,
                       'erro', p_error,
                       'eventos_reaplicados', v_reaplicados));
  return v_novo;
end;
$fn$;

comment on function public.admin_finish_signature(uuid, text, text, uuid) is
  'c14 · Sol 2.1 + c15 · Sol 4/8: DESFECHO da reserva. Com id de documento vira '
  '`sent` (e é ESTE o ato de "anexar à mão" quando o envio ficou ambíguo), '
  'carimba `sent_at` e REAPLICA os eventos de webhook que chegaram antes do '
  'espelho existir; sem id vira `failed`, sem carimbo de envio. Só age sobre '
  '`pending`.';

/**
 * `admin_cancel_signature` — O PRIMEIRO ATO HUMANO (decisão B).
 *
 * Mata uma reserva ABERTA quando a pessoa conferiu e o documento NÃO existe lá
 * fora. É a porta que substitui o relógio de 30 minutos do c14, e ela é cara de
 * propósito: exige a frase de confirmação e um motivo escrito, e os dois vão
 * para o `audit_log` com o ator. Uma reserva que morre sem que ninguém tenha
 * olhado o Autentique é exatamente o acidente que o c14 automatizava.
 *
 * POR QUE UMA FRASE, e não o nome do aluno (o portão das outras destrutivas): o
 * risco aqui não é apagar a coisa errada, é apagar sem CONFERIR. A frase é a
 * instrução — quem a digita leu o que tinha de fazer antes.
 */
create or replace function public.admin_cancel_signature(
  p_signature uuid,
  p_confirm text,
  p_reason text,
  p_actor uuid default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor uuid;
  v_sig contract_signatures%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_cancel_signature é restrita à admin';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  if not public._confirmacao_bate(
       p_confirm, 'confira antes no painel do Autentique se o documento existe') then
    raise exception
      'confirmação não confere — para cancelar a reserva, digite: confira antes no painel do Autentique se o documento existe';
  end if;
  if v_motivo is null then
    raise exception
      'diga o motivo do cancelamento — é ele que explica, seis meses depois, por que esta reserva morreu sem documento';
  end if;

  select * into v_sig from contract_signatures where id = p_signature for update;
  if not found then
    raise exception 'reserva de assinatura % não existe', p_signature;
  end if;
  if v_sig.status <> 'pending' then
    raise exception
      'esta reserva não está aberta (%) — só a reserva sem documento se cancela por aqui; documento que existe no Autentique muda de estado pela consulta',
      v_sig.status;
  end if;

  update contract_signatures
     set status = 'failed',
         last_event = jsonb_build_object(
           'source', 'cancelamento_humano', 'at', now(),
           'ator', v_actor, 'motivo', v_motivo)
   where id = p_signature;

  perform public.log_audit(v_actor, 'cancel_signature', 'contract_signatures',
    p_signature::text,
    jsonb_build_object('contract_id', v_sig.contract_id, 'from', 'pending',
                       'to', 'failed', 'motivo', v_motivo,
                       'reservada_em', v_sig.reserved_at));
  return 'failed';
end;
$fn$;

comment on function public.admin_cancel_signature(uuid, text, text, uuid) is
  'c15 · decisão B: ato HUMANO que mata uma reserva de assinatura aberta — com '
  'frase de confirmação (que manda conferir o Autentique antes) e motivo '
  'escrito, os dois no `audit_log`. Substitui o reclaim automático de 30 '
  'minutos do c14, que roubava reserva viva.';

revoke execute on function public.admin_cancel_signature(uuid, text, text, uuid)
  from public, anon, service_role;
grant execute on function public.admin_cancel_signature(uuid, text, text, uuid) to authenticated;


-- ###########################################################################
-- 5 · WEBHOOK QUE CHEGA ANTES DO ESPELHO NÃO SE PERDE (Sol 4)
-- ###########################################################################
--
-- A JANELA. Entre criar o documento no Autentique e anexar o id à reserva há
-- milissegundos — e um webhook cabe neles (o `signature.viewed` de um aluno que
-- abre o e-mail na hora, ou o `document.finished` de um documento que já nasce
-- assinado em teste). Nessa janela `apply_autentique_event` devolve NULL
-- ("documento sem espelho local"), e o c14 marcava o evento como PROCESSADO na
-- inbox. Processado sem ter feito nada: o evento estava perdido, e o estado
-- local ficava parado em `sent` para sempre — até alguém clicar "consultar".
--
-- A CORREÇÃO TEM DOIS LADOS, e este arquivo é o de baixo:
--   · o webhook (TS) não marca `processed_at` quando a RPC devolve NULL — a
--     linha fica PRESA na inbox, com o erro escrito, e responde 200 do mesmo
--     jeito (Lei 6: o provedor não pode ver falha);
--   · o ANEXO do documento, aqui, reaplica o que estiver preso para AQUELE
--     documento, na ordem em que chegou.
--
-- A ordem é `webhook_inbox.id` (identidade, monotônica na recepção). Não
-- precisaria ser: `apply_autentique_event` é monotônica e ignora regressão —
-- mas aplicar fora de ordem faria o `last_event` guardar o penúltimo evento, e
-- `last_event` é o que a auditoria lê.
--
-- O QUE FICA PRESO PARA SEMPRE, de propósito: evento de documento que NUNCA
-- ganha espelho (documento criado direto no painel do Autentique, fora do app).
-- Ele fica na inbox, não processado, com o erro dizendo qual documento é. É
-- rastro honesto — o inverso de "processado, e nada aconteceu".

create or replace function public.autentique_status_do_evento(p_type text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  -- A MESMA matriz de `src/lib/webhooks/autentique.ts` (`EVENT_STATUS`). As duas
  -- cópias existem porque os dois lados precisam dela sem round-trip; o aceite
  -- do c15 confere, tipo a tipo, que elas não divergiram.
  select case p_type
    when 'signature.viewed'   then 'viewed'
    when 'signature.rejected' then 'refused'
    when 'signature.accepted' then 'signed'
    when 'document.finished'  then 'signed'
    when 'document.deleted'   then 'cancelled'
    else null
  end;
$fn$;

comment on function public.autentique_status_do_evento(text) is
  'c15 · Sol 4: evento do Autentique → status alvo. Espelho SQL da matriz de '
  '`src/lib/webhooks/autentique.ts`, para a reaplicação de eventos presos '
  'acontecer dentro da transação do anexo.';

create or replace function public._reaplicar_eventos_autentique(p_document_id text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ev record;
  v_n int := 0;
begin
  for v_ev in
    select wi.id,
           wi.payload,
           public.autentique_status_do_evento(wi.payload -> 'event' ->> 'type') as novo
      from webhook_inbox wi
     where wi.source = 'autentique'
       and wi.processed_at is null
       and coalesce(
             wi.payload -> 'event' -> 'data' -> 'object' -> 'document' ->> 'id',
             wi.payload -> 'event' -> 'data' -> 'object' ->> 'id') = p_document_id
     order by wi.id
  loop
    if v_ev.novo is null then
      continue; -- tipo fora da matriz: o webhook já o tinha marcado processado
    end if;
    perform public.apply_autentique_event(p_document_id, v_ev.novo, v_ev.payload);
    update webhook_inbox
       set processed_at = now(),
           error = 'aplicado no anexo do documento (chegou antes do espelho existir)'
     where id = v_ev.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;

comment on function public._reaplicar_eventos_autentique(text) is
  'c15 · Sol 4: aplica, em ordem de recepção, os eventos de webhook que ficaram '
  'presos na inbox por terem chegado antes de o documento ter espelho local. '
  'Chamada DENTRO da transação do anexo — ou tudo casa, ou nada casa.';

revoke execute on function public._reaplicar_eventos_autentique(text)
  from public, anon, authenticated, service_role;


-- ###########################################################################
-- 6 · O VÍNCULO DO CONTRATO É IMUTÁVEL (Sol 6)
-- ###########################################################################
--
-- O precedente é o dono-do-slot (c10 · T4): quem um contrato COBRE não é
-- atributo editável, é a identidade dele. Trocar `student_id` por UPDATE deixa
-- aulas, créditos, faturas e assinaturas já emitidas apontando para o contrato
-- de OUTRA pessoa — e, no caminho, fura a confirmação de nome do encerramento
-- (o TOCTOU que o c14 fechou pelo lado do `students`: adiantava travar a linha
-- do aluno se o contrato podia trocar de aluno).
--
-- `teacher_id` entra na lista pelo mesmo motivo prático: o extrato da professora
-- e o conflito de agenda são calculados a partir do contrato, e uma troca por
-- UPDATE reescreveria retroativamente de quem foi a aula.
--
-- O CAMINHO LEGÍTIMO CONTINUA EXISTINDO e tem nome: encerrar e criar de novo
-- (`admin_end_contract` + `admin_create_contract`) ou renovar
-- (`admin_renew_contract`, que INSERE um contrato novo). Nenhuma RPC da casa
-- muda estas quatro colunas — medido nas migrations: todo `update contracts`
-- vivo mexe em status/ended_on/plano/franquia/política.
--
-- `contract_type` JÁ tinha guarda própria desde a 20260711000400
-- (`forbid_contract_type_flip`), e ela continua de pé. Ele fica na lista deste
-- gatilho mesmo assim porque o vínculo é UMA regra, não quatro: quem ler este
-- arquivo procurando "o que não muda num contrato" tem de achar a resposta
-- inteira num lugar só. Os dois gatilhos recusam a mesma coisa; nenhum
-- contradiz o outro.
create or replace function public.contracts_vinculo_imutavel()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.student_id is distinct from old.student_id
     or new.student_group_id is distinct from old.student_group_id
     or new.contract_type is distinct from old.contract_type
     or new.teacher_id is distinct from old.teacher_id then
    raise exception
      'o vínculo de um contrato não muda por edição (aluno, turma, tipo e professora): aulas, créditos e assinaturas já emitidos ficariam pendurados em quem não é mais o dono. Encerre este contrato e crie o novo (ou renove) — é a renovação que registra a troca';
  end if;
  return new;
end;
$fn$;

comment on function public.contracts_vinculo_imutavel is
  'c15 · Sol 6: aluno, turma, tipo e professora de um contrato são identidade, '
  'não campo editável (precedente do dono-de-slot, c10 · T4). Fecha também o '
  'TOCTOU por troca de dono no portão do encerramento.';

revoke execute on function public.contracts_vinculo_imutavel()
  from public, anon, authenticated, service_role;

drop trigger if exists contracts_vinculo_imutavel on contracts;
create trigger contracts_vinculo_imutavel
  before update of student_id, student_group_id, contract_type, teacher_id on contracts
  for each row execute function public.contracts_vinculo_imutavel();


-- ###########################################################################
-- 7 · `student_group_members` PERDE TAMBÉM O UPDATE (Sol 5)
-- ###########################################################################
--
-- O c14 tirou o INSERT de `authenticated` porque entrar numa turma é parte de um
-- ato maior (`admin_create_contract`). O UPDATE ficou por trás — e o Sol
-- conferiu o que ele serve: nada. Nenhuma tela da casa edita uma linha de
-- membro; o que existe é entrar (RPC) e sair (delete, que a ficha usa). Uma
-- linha de membro só tem `group_id` e `student_id`: "editar" aqui é trocar o
-- aluno de turma sem passar por lugar nenhum — a versão membro-a-membro do
-- vínculo imutável da seção 6.
--
-- O DELETE fica: sair da turma é ato legítimo e reversível.
revoke update on student_group_members from authenticated;
