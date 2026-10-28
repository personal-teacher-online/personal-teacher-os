-- ---------------------------------------------------------------------------
-- O DESFECHO DA COBRANÇA, DITO POR NOME (Onda do Portal · P5).
--
-- O DEFEITO. A tela de pagamentos do aluno tem duas pills — "vencida" e "em
-- aberto" — e trata TODO o resto como "paga". `em_aberto` já vem do banco
-- (payment_em_aberto, migration 20260728000500), e ele responde `false` para
-- duas famílias muito diferentes: a cobrança QUITADA e a cobrança que deixou de
-- existir (estornada, com chargeback, cancelada, apagada). As duas saíam com o
-- mesmo verde "paga" — e dizer "paga" de um valor que foi DEVOLVIDO ao aluno é
-- errar sobre dinheiro na direção mais confusa possível: ele procura no extrato
-- um pagamento que a escola afirma ter recebido e não devolvido.
--
-- Os KPIs da admin já sabiam a diferença desde 26/07 (`payment_nao_cobravel`).
-- Faltava a mesma verdade chegar ao aluno.
--
-- POR QUE A SITUAÇÃO INTEIRA VEM DO BANCO, e não só o `nao_cobravel`. Com o
-- booleano sozinho, a tela ainda teria de decidir em TypeScript se aquela linha
-- se chama "estornada" ou "cancelada" — e essa decisão só se toma lendo o
-- `status` cru do Asaas, que é exatamente a régua local que o P3 matou nesta
-- tela. `payment_situacao` devolve o NOME do desfecho (um vocabulário fechado) e
-- a tela só traduz nome → frase. O `nao_cobravel` entra junto porque é o
-- predicado primitivo, útil a quem precisa filtrar sem interpretar o rótulo (e é
-- a régua compartilhada com os KPIs).
--
-- Lei 7: `create or replace view` ACRESCENTA colunas no fim; as antigas ficam no
-- mesmo lugar, com o mesmo tipo. A view de 12/07 e a de 28/07 seguem intactas.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. payment_situacao — o desfecho da cobrança em UMA palavra.
--
--    MATRIZ EXPLÍCITA, NUNCA SUBSTRING (correção da rodada P5). A primeira
--    versão desta função decidia "estornada × cancelada" por
--    `status ~ '(cancel|delet)'` sobre o balde de `payment_nao_cobravel` — e
--    substring, em cima de um vocabulário externo, erra em cima de DINHEIRO:
--
--      · PARTIALLY_REFUNDED casa com `refund` e saía como "estornada", isto é,
--        a tela afirmando "o valor voltou para você" de um estorno PARCIAL;
--      · AWAITING_CHARGEBACK_REVERSAL é o oposto de devolução — é a disputa
--        sendo REVERTIDA a favor da escola — e casava com `chargeback`, virando
--        "o valor voltou para você";
--      · REFUND_DENIED (o estorno foi RECUSADO: o dinheiro ficou) casava com
--        `refund` e saía como devolvido;
--      · REFUND_IN_PROGRESS ainda não devolveu nada, e já dizia que sim;
--      · BANK_SLIP_CANCELLED / SPLIT_CANCELLED / DUNNING_* são nomes de EVENTO
--        do webhook (o espelho grava `evt.event` quando o payload não traz
--        `status` — ver src/lib/webhooks/asaas.ts). Não são desfecho de
--        cobrança: um boleto cancelado e regerado deixa a cobrança EM ABERTO, e
--        a substring `cancel` a declarava morta.
--
--    Agora cada status é NOMEADO. O que não estiver na lista cai no default
--    conservador (paid_at/due_date), que é a única coisa verdadeira que o banco
--    sabe de um nome que não conhece — e nunca a palavra "estornada".
--
--    Vocabulário fechado, 8 valores:
--      paga · em_aberto · em_atraso
--      estornada · estorno_parcial · estorno_em_andamento · em_disputa · cancelada
--
--    STABLE, não IMMUTABLE: `business_today()` depende do relógio.
-- ---------------------------------------------------------------------------
create or replace function public.payment_situacao(
  p_status text,
  p_paid_at timestamptz,
  p_due_date date
) returns text
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  with v as (
    -- `upper` + `btrim`: o espelho grava o status CRU do Asaas, e a régua velha
    -- (substring sobre `lower`) tolerava caixa e sobra de espaço por acidente.
    -- A matriz é por igualdade, então a normalização passa a ser explícita.
    select upper(btrim(coalesce(p_status, ''))) as st,
           -- O DEFAULT CONSERVADOR, usado por todo ramo que não é desfecho
           -- nomeado: quitada se há data de pagamento, senão aberta/atrasada
           -- pelo dia civil do NEGÓCIO.
           case
             when p_paid_at is not null then 'paga'
             when p_due_date is not null and p_due_date < public.business_today()
               then 'em_atraso'
             else 'em_aberto'
           end as porData
  )
  select case
    -- ---------------------------------------------------- dinheiro devolvido
    -- Só AQUI a tela pode dizer "o valor voltou para você".
    when v.st = 'REFUNDED' then 'estornada'
    -- Parte voltou. Voz própria: afirmar o total seria mentir para menos.
    when v.st = 'PARTIALLY_REFUNDED' then 'estorno_parcial'
    -- Pedido/processando: NADA voltou ainda.
    when v.st in ('REFUND_REQUESTED', 'REFUND_IN_PROGRESS') then 'estorno_em_andamento'

    -- ------------------------------------------------------------- disputa
    -- Chargeback aberto, em contestação, ou aguardando REVERSÃO (esta última é
    -- a disputa voltando a favor da escola). Em nenhum dos três o aluno recebeu
    -- de volta, e em nenhum ele tem o que fazer.
    when v.st in ('CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE',
                  'AWAITING_CHARGEBACK_REVERSAL', 'AWAITING_CHARGEBACK_DEBIT') then 'em_disputa'

    -- ----------------------------------------------------------- cancelada
    -- Cobrança apagada/cancelada NA ORIGEM (não o boleto dela).
    when v.st in ('CANCELED', 'CANCELLED', 'DELETED', 'PAYMENT_DELETED') then 'cancelada'

    -- --------------------------------------------------------------- paga
    -- Só os três status de RECEBIMENTO. `DUNNING_RECEIVED` esteve nesta lista e
    -- SAIU (rodada 2 da revisão): "dunning" é NEGATIVAÇÃO, e o evento
    -- `DUNNING_RECEIVED` diz que o pedido de negativação foi RECEBIDO pelo
    -- serviço — ele só existe em cima de cobrança VENCIDA. Lê-lo como "paga"
    -- carimbava de quitada exatamente a dívida que a escola mandou negativar, e
    -- ainda contradizia os KPIs, que já a somavam no em-atraso. Ele cai no
    -- default, que com `paid_at` nulo e vencimento passado responde em_atraso.
    when v.st in ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH') then 'paga'

    -- A BAIXA MANUAL DESFEITA. `paid_at` continua preenchido do recebimento que
    -- foi anulado, então o default o leria como "paga" — e a dívida voltou a
    -- existir. Este ramo IGNORA paid_at de propósito.
    when v.st = 'RECEIVED_IN_CASH_UNDONE' then
      case when p_due_date is not null and p_due_date < public.business_today()
           then 'em_atraso' else 'em_aberto' end

    -- Estorno RECUSADO: o dinheiro ficou com a escola. Volta à voz por
    -- paid_at/due_date — que, para uma cobrança paga, é "paga".
    when v.st in ('REFUND_DENIED', 'PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS',
                  'APPROVED_BY_RISK_ANALYSIS', 'REPROVED_BY_RISK_ANALYSIS',
                  -- A família DUNNING inteira é EVENTO de negativação, nunca
                  -- desfecho de cobrança: os dois nomes ficam JUNTOS aqui para
                  -- que ninguém volte a promover um deles a "paga".
                  'DUNNING_REQUESTED', 'DUNNING_RECEIVED')
      then v.porData

    -- Nome de EVENTO gravado como status, ou status que o Asaas criou depois
    -- desta migration: default conservador, voz neutra.
    else v.porData
  end
  from v
$$;

comment on function public.payment_situacao(text, timestamptz, date) is
  'O desfecho de uma cobrança em vocabulário fechado — paga | em_aberto | '
  'em_atraso | estornada | estorno_parcial | estorno_em_andamento | em_disputa '
  '| cancelada. MATRIZ por status ENUMERADO, nunca substring: PARTIALLY_REFUNDED, '
  'AWAITING_CHARGEBACK_REVERSAL, REFUND_DENIED e BANK_SLIP_CANCELLED casam com '
  'refund/chargeback/cancel e NÃO significam devolução. Status fora da lista cai '
  'no default por paid_at/due_date — nunca em "estornada" (P5).';

-- Sem REVOKE, pela MESMA razão anotada na varredura de 27/07 sobre
-- `payment_nao_cobravel` (20260727000500): esta é predicado de LEITURA, roda
-- como o chamador (não é SECURITY DEFINER) e é avaliada dentro da expressão de
-- uma view. Revogá-la de PUBLIC quebraria quem a usa em expressão de tabela sem
-- ganhar segurança nenhuma — o que ela responde já é derivável de colunas que a
-- RLS entregou. `payment_em_aberto` (20260728000500) seguiu a mesma régua.

-- ---------------------------------------------------------------------------
-- 1b. AS DUAS RÉGUAS VELHAS PASSAM A NASCER DA MATRIZ.
--
--    O DEFEITO (ordem complementar desta rodada). Com `payment_situacao` nova e
--    `payment_nao_cobravel`/`payment_em_aberto` ainda por substring, o MESMO
--    pagamento recebia dois vereditos:
--
--      · `BANK_SLIP_CANCELLED` (boleto cancelado e regerado — a cobrança segue
--        de pé): `situacao` = em_aberto, `nao_cobravel` = true, `em_aberto` =
--        false. A lista de /portal/pagamentos mostrava "em aberto" e o cartão de
--        pendência do Início — que filtra pela COLUNA — não via a dívida;
--      · `RECEIVED_IN_CASH_UNDONE` (baixa manual desfeita): `situacao` =
--        em_atraso (ignora o `paid_at` do recebimento anulado) e `em_aberto` =
--        false (justamente por causa do `paid_at`). Mesma cobrança, mesma tela,
--        duas verdades.
--
--    Agora as duas derivam da matriz e não podem mais divergir por construção.
--    As duas ficam STABLE (antes IMMUTABLE): quem responde por elas passa a
--    depender de `business_today()`. Nenhum índice, coluna gerada ou CHECK usa
--    estas funções (varredura feita nesta rodada), então a troca de volatilidade
--    não invalida nada.
--
--    DESVIO DA ORDEM, e o porquê. A ordem pedia
--    `nao_cobravel = situacao in ('cancelada','estornada')`. Isso ESTREITA a
--    régua: `PARTIALLY_REFUNDED`, `REFUND_IN_PROGRESS` e a família CHARGEBACK_*
--    sairiam do balde não-cobrável e passariam a contar como caixa nos KPIs da
--    admin — `_admin_kpis_compute` CHAMA esta função (ela não tem cópia inline
--    dela; o que ela tem inline é a lista de "pago"). Dinheiro em disputa e
--    estorno a caminho entrando em "recebido" é erro de dinheiro, e o teste que
--    fixa isso (`tests/fundacoes-de-dados.test.ts`, "payment_nao_cobravel é a
--    régua única") ficaria vermelho em `refund_requested` e `CHARGEBACK_DISPUTE`.
--
--    A régua escrita aqui é o COMPLEMENTO da viva, que é o que o nome sempre
--    quis dizer: não-cobrável = o desfecho NÃO é uma das três vozes de cobrança
--    de pé (paga · em aberto · em atraso). Ela preserva todas as classificações
--    corretas da régua velha e vira só as que estavam ERRADAS:
--
--      BANK_SLIP_CANCELLED  true → false   (evento de boleto, não da cobrança)
--      SPLIT_CANCELLED      true → false   (idem, split)
--      REFUND_DENIED        true → false   (estorno RECUSADO: o dinheiro ficou)
--
--    Os três são fixes na mesma direção — dinheiro vivo que a substring dava por
--    morto — e é exatamente a convergência que a ordem pede.
-- ---------------------------------------------------------------------------
create or replace function public.payment_nao_cobravel(p_status text)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select public.payment_situacao(p_status, null, null)
         not in ('paga', 'em_aberto', 'em_atraso')
$$;

comment on function public.payment_nao_cobravel is
  'Cobrança que não é dinheiro de pé: fica fora do recebido, do previsto e do '
  'em-atraso. Desde 28/07 ela NASCE de payment_situacao (o complemento das três '
  'vozes vivas) em vez de casar substring — BANK_SLIP_CANCELLED, SPLIT_CANCELLED '
  'e REFUND_DENIED eram classificados errado. Régua compartilhada com o portal '
  '(payments_student) e com os KPIs da admin (_admin_kpis_compute).';

-- `payment_em_aberto` mantém a ASSINATURA (text, timestamptz) de propósito: a
-- pergunta "está em aberto?" não precisa do vencimento, porque em_aberto e
-- em_atraso são o mesmo lado da matriz — o vencimento só decide QUAL dos dois. A
-- view continua derivando `em_atraso` por cima, com `business_today()`, como
-- desde 20260728000500. Trocar a assinatura obrigaria a mexer em chamador que
-- vive em migration imutável.
create or replace function public.payment_em_aberto(
  p_status text,
  p_paid_at timestamptz
) returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select public.payment_situacao(p_status, p_paid_at, null)
         in ('em_aberto', 'em_atraso')
$$;

comment on function public.payment_em_aberto(text, timestamptz) is
  'Cobrança que ainda pede algo do pagador. Desde 28/07 ela NASCE de '
  'payment_situacao: o mesmo pagamento não pode ser "em aberto" na lista e '
  '"resolvido" no cartão do Início. Vira em BANK_SLIP_CANCELLED (boleto '
  'regerado: a cobrança segue de pé) e em RECEIVED_IN_CASH_UNDONE (baixa manual '
  'desfeita: a dívida voltou, mesmo com paid_at preenchido).';

-- ---------------------------------------------------------------------------
-- 2. A view do aluno ganha as duas colunas no fim.
--
--    SEM `invoice_url`, e isso é DECISÃO, não esquecimento (correção da rodada
--    P5 · decisão do dono registrada em docs/goals/onda-portal.md). A versão
--    anterior derivava o link da fatura de `raw -> 'payment' ->> 'invoiceUrl'`.
--    O link abre, no Asaas, a fatura DO PAGADOR — com nome e documento de quem
--    recebe a cobrança. E o pagador de uma cobrança NÃO é vinculável ao aluno
--    neste schema:
--
--      · `payments.payer_id` existe na tabela, mas NENHUM caminho de escrita o
--        preenche — o webhook (src/lib/webhooks/asaas.ts) grava
--        asaas_payment_id/contract_id/valor/status/due_date/paid_at/raw e nada
--        mais. A coluna é sempre NULL;
--      · `payers.asaas_customer_id` (que ligaria o `customer` do payload ao
--        cadastro) também não é escrito por nenhum código — é campo manual, e a
--        criação de cliente no Asaas é do gate 🔑;
--      · `student_payers` liga pagador ↔ aluno, mas não distingue "o próprio
--        aluno" de "a mãe" ou "a empresa" — que é exatamente a distinção que
--        precisaria existir para o link ser seguro.
--
--    Ou seja: não há, HOJE, um caso em que o banco consiga afirmar que o pagador
--    daquela cobrança é o próprio aluno. Sem essa afirmação, o botão "Abrir a
--    fatura" no portal seria um vazamento de dado de terceiro em potencial. O
--    dono escolheu ficar sem o botão. Quando o Asaas for religado (gate 🔑) e
--    `payer_id` passar a ser preenchido, a coluna volta com as duas guardas:
--    origem (`^https://(www\.|sandbox\.)?asaas\.com/`) e posse do pagador.
--
--    O ARGUMENTO PARA `raw` FICAR DENTRO É MINIMIZAÇÃO, NÃO A ADR-010 §1. A
--    versão anterior desta migration citava a ADR-010 §1 como se ela proibisse
--    `raw`/`payer_id` em `payments_student`; ela não trata disso — o §1 é sobre
--    o aluno NÃO ter policy de leitura em `teachers` (o custo confidencial da
--    professora). O motivo real é o de sempre: `raw` é o payload cru do Asaas e
--    carrega o cadastro do pagador (nome, documento, e-mail de terceiro); a view
--    do aluno leva o mínimo necessário. O comentário da view foi corrigido junto.
-- ---------------------------------------------------------------------------
create or replace view payments_student as
  select p.id, p.contract_id, p.amount_cents, p.status, p.due_date, p.reference_ym,
         public.payment_em_aberto(p.status, p.paid_at) as em_aberto,
         (public.payment_em_aberto(p.status, p.paid_at)
          and p.due_date is not null
          and p.due_date < public.business_today()) as em_atraso,
         public.payment_nao_cobravel(p.status) as nao_cobravel,
         public.payment_situacao(p.status, p.paid_at, p.due_date) as situacao
    from payments p
   where p.contract_id in (select public.my_contract_ids());

comment on view payments_student is
  'Espelho enxuto por contrato do chamador (my_contract_ids usa auth.uid()). '
  'raw/payer_id NUNCA nesta view — não por ADR (a 010 §1 trata de teachers) e '
  'sim por minimização: raw é o payload cru do Asaas e carrega o cadastro do '
  'pagador (nome, documento, e-mail de terceiro). Sem invoice_url de propósito '
  '(P5): o pagador de uma cobrança não é vinculável ao aluno neste schema. '
  'em_aberto/em_atraso/nao_cobravel/situacao são a régua do banco '
  '(payment_em_aberto + payment_nao_cobravel + payment_situacao + '
  'business_today), não uma lista de status em TypeScript.';

-- ---------------------------------------------------------------------------
-- 3. contract_active_slot_duration — a MESMA seleção de horário fixo que a RPC
--    de resgate faz, agora legível pela tela.
--
--    O DEFEITO (P5, achado grave). `/portal/resgatar` escolhia o horário fixo
--    por `active_to is null` — "o slot que não terminou". A RPC que de fato
--    cria a aula (`book_reschedule_window`, 20260727000700:537) escolhe o
--    VIGENTE NO DIA:
--
--        where rs.contract_id = ...
--          and rs.active_from <= current_date
--          and (rs.active_to is null or rs.active_to >= current_date)
--        order by rs.active_from desc
--        limit 1
--
--    As duas discordam num caso real e comum: aluno que troca de horário no fim
--    do mês tem o slot de 60min encerrando HOJE (active_to = hoje) e o de 30min
--    começando amanhã (active_to null). A tela lia o de 30min (o único com
--    active_to null), montava a grade com 30 minutos e oferecia horários que a
--    RPC recusaria — ou aceitaria com outra duração. A tela NUNCA pode oferecer
--    o que a RPC recusa.
--
--    A leitura passa a ser esta função, com o WHERE COPIADO do canônico. Ela é
--    SECURITY INVOKER de propósito: a RLS de `recurring_slots`
--    (recurring_slots_student, 20260711000700) já limita ao contrato do próprio
--    aluno, e nenhuma linha nova fica visível por causa dela. `current_date` é o
--    MESMO relógio da RPC — replicar isso em TypeScript traria um segundo "hoje"
--    e a divergência voltaria por outra porta.
-- ---------------------------------------------------------------------------
create or replace function public.contract_active_slot_duration(p_contract uuid)
returns int
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select rs.duration_min
    from public.recurring_slots rs
   where rs.contract_id = p_contract
     and rs.active_from <= current_date
     and (rs.active_to is null or rs.active_to >= current_date)
   order by rs.active_from desc
   limit 1
$$;

comment on function public.contract_active_slot_duration(uuid) is
  'Duração do horário fixo VIGENTE HOJE — cópia literal do WHERE de '
  'book_reschedule_window (20260727000700:537), para a tela de resgate oferecer '
  'exatamente o que a RPC aceita. SECURITY INVOKER: a RLS de recurring_slots é '
  'quem limita as linhas. Mudou lá? Mude aqui na MESMA migration.';
