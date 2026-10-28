// A MATRIZ DO DESFECHO (ADR-018) — vocabulário PURO, para as três pontas.
//
// Quem consome: o componente `DesfechoDaAula` (cliente, pinta a matriz), a
// action `registrarDesfechoDaAulaAction` (servidor, executa) e os testes. Módulo
// puro de propósito: nada de `next/headers`, nada de `server-only` — a régua do
// `chaves-de-rascunho.ts` ("aqui só entra função pura") vale igual.
//
// ══════════════════════════════════════════════════════════════════════════════
// AS CINCO LINHAS, E POR QUE SÃO CINCO
// ══════════════════════════════════════════════════════════════════════════════
// O esboço antigo do A5 falava em "cancelada com aviso" × "cancelada fora do
// prazo". Essa regra NÃO EXISTE no banco: `_cancel_class_core` (definição
// EFETIVA em `20260727000700_ordem_global_de_locks.sql`, lida por
// `pg_get_functiondef` no Postgres local) decide crédito por
// `if p_cancelled_by = 'teacher' then …` e não olha antecedência nenhuma para
// isso. `min_notice_hours` entra no `diff` do audit como CONTEXTO. A
// antecedência só existe como GUARDA DE ESTADO:
//   `if now() >= v_inst.starts_at_utc and p_notified_at >= v_inst.starts_at_utc
//    then raise 'aula % já começou e o aviso não a precedeu — use no_show…'`
// Logo: o que separa dinheiro é QUEM cancelou. Cinco linhas, uma por RPC × ator.
//
// ══════════════════════════════════════════════════════════════════════════════
// A REGRA DE OURO DESTE ARQUIVO
// ══════════════════════════════════════════════════════════════════════════════
// Cada frase de `CONSEQUENCIA` foi CONFERIDA no corpo efetivo da função, nunca
// escrita de memória nem deduzida do nome. No A4, de 18 afirmações, DUAS eram
// falsas. Frase que não se sustenta na função NÃO ENTRA aqui.
//
// ── O QUE A MEDIÇÃO DERRUBOU (três frases que estavam na tela) ───────────────
//
// 1. "Libera a hora da professora no extrato" (frase viva no
//    `RegistrarDesfecho` do Início) é FALSA. `_teacher_payable_hours`
//    (`20260713000600_fase3_teacher_statements.sql`) paga:
//        i.state in ('completed', 'no_show_student')
//        or (i.state = 'scheduled' and not exists (contract_pauses cobrindo o dia))
//    …com `i.starts_at_utc < now()`. Ou seja: a aula passada SEM registro JÁ
//    conta. Registrar realizada ou falta do aluno MANTÉM a hora; falta da
//    professora (`no_show_teacher`) e cancelamento (`cancelled`) a RETIRAM,
//    porque esses dois estados não estão em nenhum ramo da soma.
//    Nuance conferida e respeitada nas frases: o ramo `scheduled` exige contrato
//    NÃO pausado, e os ramos `completed`/`no_show_student` não exigem nada —
//    então "conta no extrato" é verdade sempre depois do registro, e o "já
//    contava antes" fica dito com a ressalva do contrato pausado, uma vez, no
//    cabeçalho da matriz (`AVISO_DA_HORA`).
//
// 2. "O aluno ganhou um crédito de reposição" na falta da professora pode ser
//    FALSA. `_mark_no_show` (idem 20260727000700) chama
//    `_refund_for_credit_born_class` quando a aula NASCEU de crédito, e essa
//    função (`20260718000300_f1_ledger_memoria.sql`) faz:
//        if v_spend.consumes_ledger_id is null then
//          o_blocked := 'gasto sem identidade (anterior à F1) — crédito só via
//                        ajuste manual';
//          return;   -- sem inserir nada no makeup_ledger
//    Por isso a frase da matriz diz "em regra" e nomeia a exceção, e o RECADO
//    depois do ato é LIDO do `audit_log` (`credited`, `expires_on`,
//    `refund_blocked`), como o cancelamento já fazia.
//
// 3. Cancelar REGISTRA o aviso PARA ENVIO — e esse é o limite do que se
//    pode prometer (Sol · rodadas 1 e 2 do A5). `_cancel_class_core` termina com
//    `perform public._enqueue_class_cancelled(...)`, fora de qualquer `if`, e
//    essa função INSERE na `notification_outbox`, as duas linhas com
//    `on conflict (dedupe_key) do nothing`. Nem "dispara" servia: a action
//    NÃO chama `dispatchOutbox` — quem despacha é o worker/cron, e o despacho
//    (`src/lib/outbox/dispatch.ts`) pode ficar pendente por falta de e-mail no
//    perfil, falta de número, driver desligado ou rede.
//    A remissão é a tela de MENSAGENS — que é o rótulo da barra lateral
//    (`src/components/admin/nav.ts`) para a rota `/admin/avisos`. A frase diz
//    "Mensagens" porque é a palavra que a dona VÊ no menu; mandá-la procurar
//    "Avisos" é mandá-la procurar um item que não existe na navegação (revisão
//    independente do A5, médio 3). O que se vê lá é se o aviso SAIU — `sent_at` é
//    aceite do provedor, não recibo de leitura.
//    ⚠️ ATUALIZADO NO A6/lote 2 (migration 99): o "e-mail SEMPRE" morreu. A
//    dona ESCOLHE os canais na confirmação, e a função passou a receber
//    `p_notify_email` / `p_notify_whatsapp` (default TRUE nos dois, para quem
//    não escolhe — o aluno, pela `cancel_my_class`, e o tratamento de período).
//    A condição do NÚMERO continua de pé por baixo do flag: marcar a caixa não
//    inventa WhatsApp em cadastro que não tem. É por isso que a frase abaixo diz
//    "nos canais que você marcar na confirmação" em vez de "e-mail sempre" —
//    prometer o canal que ela acabou de desmarcar seria a mesma família de
//    frase falsa que o A5 passou o milestone matando, na direção oposta.
//    O que fazer com a linha órfã (sem destinatário entregável) segue decisão de
//    desenho MANTIDA — ela nasce, e a tela avisa disso na hora
//    (`SEM_LOGIN_NAO_ENTREGA`); a tela de Avisos sem recibo de entrega segue
//    dívida escrita.
//
// ── O GATE POR SITUAÇÃO (oferecer o que o banco recusaria é mentira de tela) ──
// · `complete_class` (definição EFETIVA em
//   `20260720000300_study_plans_e_apontamento.sql` — a de
//   `20260718000400_f2_acoes_de_aula.sql` é a versão de TRÊS argumentos, que
//   aquela migration DROPA antes de recriar com o apontamento; citação corrigida
//   na rodada 1 do Sol, junto com o conserto do helper que lê a definição):
//     `if v_starts > now() then raise 'a aula ainda não começou…'`
//   e, antes disso, exige apontamento de conteúdo:
//     `if not exists (select 1 from class_content_reports …) then
//        if p_plan_item is null and p_off_kind is null then raise 'aula sem
//        apontamento de conteúdo…'`
// · `_mark_no_show`: `if now() <= v_inst.starts_at_utc then raise 'aula % ainda
//   não começou (%) — no-show é retrospectivo'`
// · as duas exigem `v_inst.state = 'scheduled'`.
// Logo: aula que já terminou (`sem_registro`) aceita as cinco; aula com desfecho
// não aceita nada — a tela DECLARA o estado e a consequência financeira dele.
//
// ── E `agendada` É "AINDA NÃO TERMINOU", NÃO "AINDA NÃO COMEÇOU" ────────────
// (Sol · rodada 1 do A5.) `situacao='agendada'` cobre a aula futura E a aula EM
// ANDAMENTO: `situacaoDe` (`src/data/admin/agenda.ts`) só vira `sem_registro`
// quando o FIM passou. As RPCs seriam mais permissivas — `complete_class` exige
// `starts_at <= now` e `_mark_no_show` exige `now > starts_at`, ou seja, bastaria
// a aula ter COMEÇADO. Oferecer desfecho às 14:01 de uma aula que vai até 14:45 é
// justamente o defeito que o achado 3 do A3 derrubou como GRAVE: a dona atestava
// realizada uma aula que ainda estava acontecendo.
//
// Então o corte no FIM é ESTREITAMENTO DELIBERADO DA CASA — a mesma classe do
// piso de 15 min e do teto de 480 da duração (o banco aceita mais, esta casa
// aceita menos). A frase da tela tem de dizer isso com essas palavras: é regra
// nossa esperar a aula terminar, não limite do Postgres. Quem quiser reabrir
// mexe em `situacaoDe` e aqui, juntos.

import { DateTime } from 'luxon'

import { BUSINESS_TZ } from '@/lib/brand/constants'
import type { SituacaoDaAula } from '@/data/admin/home'

/** As cinco linhas da matriz. O sufixo do cancelamento é QUEM pediu — é ele que
 *  viaja em `p_cancelled_by` e é ele que decide o dinheiro (ADR-018). */
export type Desfecho =
  | 'realizada'
  | 'falta_aluno'
  | 'falta_professora'
  | 'cancelada_professora'
  | 'cancelada_aluno'

export const DESFECHOS: readonly Desfecho[] = [
  'realizada',
  'falta_aluno',
  'falta_professora',
  'cancelada_professora',
  'cancelada_aluno',
] as const

export function ehDesfecho(v: string | undefined | null): v is Desfecho {
  return DESFECHOS.includes((v ?? '') as Desfecho)
}

/** Os dois que passam por `cancel_class` (os outros três são desfecho de aula
 *  que ACONTECEU ou deixou de acontecer com alguém ausente). */
export function ehCancelamento(d: Desfecho): boolean {
  return d === 'cancelada_professora' || d === 'cancelada_aluno'
}

/** `p_cancelled_by` da RPC — o campo que separa dinheiro. */
export function pedidoPor(d: Desfecho): 'teacher' | 'student' | null {
  if (d === 'cancelada_professora') return 'teacher'
  if (d === 'cancelada_aluno') return 'student'
  return null
}

/** O nome da linha. Sem vocabulário de banco: "no_show_teacher" não é assunto
 *  da dona. */
export const ROTULO: Record<Desfecho, string> = {
  realizada: 'A aula aconteceu',
  falta_aluno: 'O aluno faltou',
  falta_professora: 'A professora faltou',
  cancelada_professora: 'Cancelada — quem pediu foi a professora',
  cancelada_aluno: 'Cancelada — quem pediu foi o aluno',
}

/**
 * O QUE ACONTECE SE ELA CONFIRMAR — a frase × a função que a sustenta.
 *
 * A tabela de proveniência está no cabeçalho deste arquivo; aqui cada frase
 * repete só o essencial. Ordem dentro da frase: hora da professora → crédito do
 * aluno → aviso, porque é a ordem em que a dona pergunta.
 */
export const CONSEQUENCIA: Record<Desfecho, string> = {
  // `complete_class` → state 'completed', que é o primeiro ramo de
  // `_teacher_payable_hours`; a função não toca `makeup_ledger`; nenhum
  // `_enqueue_*` no corpo.
  // ⚠️ "ABAIXO" MORREU AQUI (revisão independente do A6, menor 3): esta frase
  // aparece em DUAS superfícies — a linha da matriz, onde o campo Tema fica
  // logo abaixo, e o AlertDialog da confirmação, onde ele ficou ATRÁS do véu.
  // Mandar a dona escolher "abaixo" um campo que o próprio diálogo cobriu é
  // instrução impossível no exato momento em que ela precisa dela. A frase
  // passou a nomear o CAMPO, que existe nas duas telas e não depende de onde
  // ele está desenhado.
  realizada:
    'A hora CONTA no extrato da professora. O aluno não ganha crédito de reposição, e nenhum aviso é enviado a ele. Exige o apontamento do que foi trabalhado: sem o apontamento da professora, o registro só passa com um tema escolhido no campo "Tema" do formulário.',
  // `_mark_no_show(p_who='student')` → state 'no_show_student', o segundo ramo
  // da soma do extrato; o ramo de crédito é o `else` (só a professora entra
  // nele); nenhum `_enqueue_*`.
  falta_aluno:
    'A hora CONTA no extrato da professora — a aula conta como dada. O aluno não ganha crédito de reposição, e nenhum aviso é enviado a ele.',
  // `_mark_no_show(p_who='teacher')` → state 'no_show_teacher', que NÃO está em
  // nenhum ramo da soma; crédito por `_earn_for_lost_class` (fault 'school') ou
  // estorno por `_refund_for_credit_born_class`, que volta SEM creditar quando
  // `consumes_ledger_id is null`; nenhum `_enqueue_*`.
  falta_professora:
    'A hora NÃO conta no extrato da professora. Em regra o aluno ganha um crédito de reposição — a exceção é a aula que nasceu de um crédito antigo sem identidade, em que o sistema não devolve sozinho. O recado depois do registro diz o que de fato aconteceu, lido da trilha de auditoria. Nenhum aviso é enviado ao aluno.',
  // `cancel_class` → `_cancel_class_core` com p_cancelled_by='teacher': state
  // 'cancelled' (fora da soma do extrato), crédito/estorno pelo mesmo par de
  // funções da falta da professora, e `_enqueue_class_cancelled` SEMPRE.
  cancelada_professora:
    'A hora NÃO conta no extrato da professora. Em regra o aluno ganha um crédito de reposição — a exceção é a aula que nasceu de um crédito antigo sem identidade. O aviso do cancelamento fica REGISTRADO para envio nos canais que você marcar na confirmação: e-mail para quem tem acesso ao portal, e WhatsApp quando há WhatsApp no cadastro dele. Se ele saiu, você confere em Mensagens.',
  // idem com p_cancelled_by='student': o `if` do crédito não abre em NENHUMA
  // antecedência (ADR-018), e o aviso sai igual.
  cancelada_aluno:
    'A hora NÃO conta no extrato da professora. O aluno NÃO ganha crédito de reposição — em nenhuma antecedência: quem decide é quem pediu o cancelamento, não a hora do aviso. Para trocar de horário sem perder a aula, o caminho é remarcar. O aviso do cancelamento fica REGISTRADO para envio nos canais que você marcar na confirmação: e-mail para quem tem acesso ao portal, e WhatsApp quando há WhatsApp no cadastro dele. Se ele saiu, você confere em Mensagens.',
}

/**
 * A ressalva da hora, dita UMA vez no cabeçalho da matriz — e SÓ em aula que já
 * terminou (`sem_registro`).
 *
 * Duas razões, as duas medidas na mesma função:
 *  · o ramo `scheduled` de `_teacher_payable_hours` tem uma condição que os
 *    outros dois não têm (contrato não pausado), então "já contava" precisa da
 *    ressalva para não ser afirmação falsa em contrato pausado;
 *  · a soma exige `i.starts_at_utc < now()`, logo aula FUTURA não conta em
 *    nenhum estado — em `agendada` esta frase não se aplica, e é por isso que as
 *    consequências das cinco linhas falam do estado FINAL ("a hora NÃO conta"),
 *    nunca do movimento ("sai do extrato"), que só existe no passado.
 */
export const AVISO_DA_HORA =
  'Aula que já passou e continua sem registro JÁ conta no extrato da professora (quando o contrato não está pausado). Registrar realizada ou falta do aluno MANTÉM a hora; falta da professora e cancelamento a RETIRAM.'

/**
 * POR QUE A AULA QUE AINDA NÃO TERMINOU SÓ OFERECE CANCELAR.
 *
 * Dita na tela, e com a autoria certa (Sol · rodada 1 do A5): a espera pelo FIM é
 * regra DESTA CASA, não limite do banco. Calar isso deixava a dona sem entender
 * por que faltam três linhas; e atribuir o limite ao Postgres seria a mesma
 * classe de mentira que este lote veio matar, do outro lado.
 *
 * A precisão da IGUALDADE importa e está na frase (Sol · rodada 2, menor):
 * `complete_class` recusa com `if v_starts > now()`, então ela aceita NO INSTANTE
 * exato do início; `_mark_no_show` recusa com `if now() <= v_inst.starts_at_utc`,
 * então a falta só é aceita DEPOIS que o início passou. "A partir do horário de
 * início" valia para uma e não para a outra.
 */
export const REGRA_DA_CASA_DO_FIM =
  'Realizada e falta aparecem só depois que a aula TERMINA — é regra desta casa. O banco aceitaria antes: realizada desde o horário de início, falta a partir do minuto seguinte a ele; a escola espera o fim para ninguém atestar aula que ainda está acontecendo. Até lá, o que dá para fazer é cancelar.'

/** O texto do CTA — ele mesmo declara o ato, inclusive quem pediu o
 *  cancelamento (o campo que decide o dinheiro). */
export const CONFIRMAR: Record<Desfecho, string> = {
  realizada: 'Registrar como realizada',
  falta_aluno: 'Registrar falta do aluno',
  falta_professora: 'Registrar falta da professora',
  cancelada_professora: 'Cancelar a aula (pedido da professora)',
  cancelada_aluno: 'Cancelar a aula (pedido do aluno)',
}

/** Nada escolhido: o botão NUNCA nasce desabilitado (régua da casa), então ele
 *  diz o que falta e a action recusa com frase de gente. */
export const CONFIRMAR_SEM_ESCOLHA = 'Registrar desfecho'

/**
 * O GATE. Aula futura só pode ser cancelada; aula que terminou aceita as cinco;
 * aula com desfecho não aceita nada (ver o cabeçalho para as guardas exatas).
 */
export function opcoesDaSituacao(s: SituacaoDaAula): readonly Desfecho[] {
  if (s === 'sem_registro') return DESFECHOS
  if (s === 'agendada') return ['cancelada_professora', 'cancelada_aluno']
  return []
}

/**
 * O DESFECHO NÃO SE DESFAZ — e a tela precisa dizer isso (revisão independente do
 * A5, grave 2).
 *
 * Varrido nas migrations: NENHUMA função devolve uma aula a `scheduled`. As três
 * portas de desfecho exigem `state = 'scheduled'` para agir e gravam o estado
 * final; não existe `reabrir_aula`, nem `undo`, nem caminho de admin para isso. O
 * conserto possível é OUTRO ato, no ledger: o ajuste manual de crédito. Calar isso
 * fazia a dona descobrir a irreversibilidade depois de errar.
 */
export const REGISTRO_NAO_SE_DESFAZ =
  'Este registro não se desfaz: nenhuma função devolve a aula para "agendada". Se estiver errado, o acerto é pelo crédito — em Contratos, no contrato do aluno, use "Ajustar" no bloco de Créditos.'

/**
 * O que a tela DECLARA quando não há nada a escolher: o estado e a consequência
 * financeira DELE. Medida nas mesmas funções — o que muda é o tempo do verbo.
 *
 * O crédito não é AFIRMADO aqui: quem sabe se houve crédito é a trilha (o
 * `credited`/`refund_blocked` do `audit_log`), e ela está na aba Histórico, ao
 * lado. Deduzir crédito da situação é exatamente a frase falsa nº 2.
 */
export const DECLARACAO_DO_ESTADO: Partial<Record<SituacaoDaAula, string>> = {
  realizada:
    'A hora conta no extrato da professora. O aluno não recebeu crédito de reposição por esta aula. ' +
    REGISTRO_NAO_SE_DESFAZ,
  falta_aluno:
    'A aula contou como dada: a hora conta no extrato da professora, e o aluno não recebeu crédito. ' +
    REGISTRO_NAO_SE_DESFAZ,
  falta_professora:
    'A hora NÃO conta no extrato da professora. Se o crédito de reposição foi gerado, ele está na aba Histórico — é a trilha que diz, não a situação. ' +
    REGISTRO_NAO_SE_DESFAZ,
  cancelada:
    'A hora NÃO conta no extrato da professora. Se houve crédito de reposição, ele está na aba Histórico, com a validade. ' +
    REGISTRO_NAO_SE_DESFAZ,
  remarcada:
    'Esta aula foi trocada de horário: ela não conta no extrato da professora, e a aba Histórico mostra para quando foi.',
}

/**
 * Os campos que precisam sobreviver a um erro — UMA lista, lida pelos dois
 * lados. Eles viajam no COOKIE de rascunho (nada disto encosta na URL:
 * `off_note` é texto livre e `notified_at` é hora de um fato da vida de
 * alguém).
 *
 * ── POR QUE A LISTA MUDOU DE CASA (Sol · rodada 2 do A6, P2) ────────────────
 * Ela existia DUAS vezes: aqui como o `manter` do formulário, e em
 * `src/app/admin/agenda/actions.ts` como `CAMPOS_DO_DESFECHO`, a lista do
 * SERVIDOR (que é a autoridade — o `manter` do cliente é ignorado). Duas
 * listas com o mesmo nome de coisa é uma lista que diverge, e ela divergiu: os
 * três campos da ESCOLHA DE CANAIS entraram no formulário no lote 2 e não
 * entraram em nenhuma das duas. Consequência medida: o servidor recusa (hora
 * do aviso no futuro, aula que já tem desfecho), o balão reabre com o rascunho
 * — e as caixas de aviso renascem MARCADAS, religando o canal que a dona
 * tinha desmarcado de propósito. Ela confirma de novo, e o aluno recebe o
 * recado que ela decidiu não mandar.
 *
 * ⚠️ A7 FECHOU A HISTÓRIA PELA RAIZ: o `manter` do formulário não existe mais —
 * nem como campo. Não há mais duas listas para divergir porque há UMA, e ela é
 * do servidor. `canais` viaja junto porque é ele que distingue "ela decidiu não
 * avisar" de "este formulário nem pergunta" — sem a marca, a volta de erro
 * cairia no default da RPC (avisar pelos dois).
 */
export const CAMPOS_DO_DESFECHO = [
  'desfecho',
  'off_kind',
  'off_note',
  'notified_at',
  'canais',
  'avisar_email',
  'avisar_whatsapp',
] as const

/**
 * Os temas avulsos de `report_class_content` — a MESMA lista do
 * `RegistrarDesfecho` do Início e do `pieces.tsx` que morreu aqui.
 */
export const TEMAS: readonly { valor: string; rotulo: string }[] = [
  { valor: 'revisao', rotulo: 'revisão' },
  { valor: 'prova', rotulo: 'prova' },
  { valor: 'extra', rotulo: 'conteúdo extra' },
  { valor: 'conversacao', rotulo: 'conversação' },
  { valor: 'outro', rotulo: 'outro' },
]

/** Sentinela do Select (o Radix proíbe item de valor vazio): "a professora já
 *  apontou o módulo do plano" grava `off_kind = ''`, e aí quem manda é o
 *  apontamento que já existe no banco. */
export const TEMA_DO_PLANO = '__modulo_do_plano__'

/* ==========================================================================
 * A CONFIRMAÇÃO DESTRUTIVA (A6/lote 2) — o vocabulário do AlertDialog
 * ==========================================================================
 *
 * Os TRÊS que param para confirmar são `realizada` e os dois cancelamentos —
 * decisão da spec do A6, não invenção daqui. As duas FALTAS seguem em um
 * gesto: elas são igualmente irreversíveis, mas nascem de um fato que já
 * aconteceu ("ninguém apareceu"), enquanto os três de baixo movem a agenda ou
 * mandam recado para o aluno no mesmo ato. Quem quiser incluir as faltas mexe
 * nesta lista — e no teste que a cobra.
 */
export const PEDE_CONFIRMACAO: readonly Desfecho[] = [
  'realizada',
  'cancelada_professora',
  'cancelada_aluno',
] as const

export function pedeConfirmacao(d: Desfecho): boolean {
  return PEDE_CONFIRMACAO.includes(d)
}

/**
 * O QUE A TELA SABE SOBRE A ENTREGA DO AVISO, e o que ela NÃO sabe.
 *
 * `null` não é "não" — é "esta tela não tem essa resposta". É o caso da aula de
 * GRUPO: `_enqueue_class_cancelled` percorre os membros do grupo e decide canal
 * a canal, POR MEMBRO, e um par de caixas não consegue espelhar N cadastros
 * diferentes. Fingir um booleano ali seria inventar afirmação sobre a vida de
 * alguém — exatamente a família de defeito que o A5 passou o milestone matando.
 */
export interface EntregabilidadeDoAluno {
  /** o aluno tem `students.profile_id`? (`null` = aula de grupo) */
  temLogin: boolean | null
  /** …e `profiles.whatsapp_e164`? (`null` = aula de grupo) */
  temWhatsapp: boolean | null
}

/** Um canal do diálogo: se a caixa nasce marcada, e a frase que explica. */
export interface CanalDoAviso {
  /** nasce marcada? (é a entregabilidade real, não uma preferência) */
  nasceMarcado: boolean
  /** por que ela nasceu desmarcada — `null` quando o canal está de pé */
  porque: string | null
}

/**
 * SEM LOGIN, O E-MAIL NÃO TEM DESTINATÁRIO — e a frase diz o que acontece de
 * verdade, medido em `_enqueue_class_cancelled`: a linha nasce com
 * `recipient_profile_id` NULL (decisão de desenho MANTIDA no A6 — o comentário
 * de `notification_outbox` manda o silêncio acontecer no DESPACHO, nunca no
 * enfileiramento). Ou seja: marcar à força não manda e-mail nenhum; produz uma
 * linha presa em Mensagens, esperando alguém.
 */
export const SEM_LOGIN_NAO_ENTREGA =
  'Este aluno ainda não tem acesso ao portal. Sem login não há e-mail para onde mandar: a linha nasce presa em Mensagens, esperando você.'

/**
 * SEM NÚMERO, A LINHA DE WHATSAPP NEM NASCE. Medido no mesmo corpo: o insert do
 * WhatsApp está dentro de `if p_notify_whatsapp and coalesce(v_wa, false)`, e
 * `v_wa` é `profiles.whatsapp_e164 is not null`. Marcar a caixa não cria nada —
 * e a frase precisa dizer isso, senão a dona sai achando que avisou.
 */
export const SEM_WHATSAPP_NAO_ENTREGA =
  'Não há WhatsApp no cadastro dele. Marcar aqui não registra nada — o aviso por WhatsApp só nasce para quem tem número.'

/** Aula de grupo: a tela não sabe (e não pode fingir que sabe) por quem. */
export const GRUPO_ENTREGA_POR_MEMBRO =
  'Aula de grupo: o aviso é registrado por aluno, cada um conforme o cadastro dele — e-mail para quem tem login, WhatsApp para quem tem número.'

/**
 * As duas caixas do diálogo, espelhando a entregabilidade REAL.
 *
 * Regra: nenhuma caixa nasce marcada prometendo o que o banco não faria. E
 * nenhuma delas é DESABILITADA — botão desabilitado não diz por quê, e a régua
 * da casa manda explicar em vez de calar; quem marcar assim mesmo cria a linha
 * presa, que é o desenho declarado.
 */
export function canaisDoAviso(e: EntregabilidadeDoAluno): {
  email: CanalDoAviso
  whatsapp: CanalDoAviso
} {
  // Grupo (`null`): os dois canais nascem MARCADOS, que é o comportamento de
  // sempre, e a frase de grupo explica que a entrega é por membro.
  if (e.temLogin === null || e.temWhatsapp === null)
    return {
      email: { nasceMarcado: true, porque: GRUPO_ENTREGA_POR_MEMBRO },
      whatsapp: { nasceMarcado: true, porque: GRUPO_ENTREGA_POR_MEMBRO },
    }
  if (!e.temLogin)
    // Sem login não há perfil, e sem perfil não há número: o WhatsApp cai pela
    // MESMA razão, e repetir a razão certa é melhor que dar duas.
    return {
      email: { nasceMarcado: false, porque: SEM_LOGIN_NAO_ENTREGA },
      whatsapp: { nasceMarcado: false, porque: SEM_LOGIN_NAO_ENTREGA },
    }
  return {
    email: { nasceMarcado: true, porque: null },
    whatsapp: e.temWhatsapp
      ? { nasceMarcado: true, porque: null }
      : { nasceMarcado: false, porque: SEM_WHATSAPP_NAO_ENTREGA },
  }
}

/**
 * A ENTREGABILIDADE VIAJA COM O ENVIO (Sol · rodada 2 do A6, P2 · frase da
 * entrega).
 *
 * A action precisa saber o que a TELA sabia para não afirmar entrega onde não
 * há destinatário: canal marcado à força continua sendo um gesto possível (a
 * caixa não é desabilitada — régua da casa), e o que ele produz é uma linha
 * órfã (e-mail) ou nada (WhatsApp). Sem estes dois campos, a frase de sucesso
 * dizia "o aviso fica REGISTRADO para envio por WhatsApp" para um aluno sem
 * número, em que o insert nem acontece.
 *
 * Três valores, e o terceiro não é enfeite: `'1'` entregável, `'0'` não
 * entregável, `''` = a tela NÃO SABE (aula de grupo, em que o enfileiramento é
 * por membro). "Não sei" nunca vira "não" — a frase de grupo é a hedge que já
 * existe ("quando há número no cadastro dele").
 *
 * Isto é dado do CLIENTE, e por isso só escolhe PALAVRA: nada aqui decide
 * dinheiro, canal ou permissão — quem enfileira é a RPC, com a condição do
 * número por baixo do flag.
 */
export const CAMPO_DA_ENTREGA = {
  email: 'entrega_email',
  whatsapp: 'entrega_whatsapp',
} as const

/** `boolean | null` → o valor que viaja no campo escondido. */
export function marcaDaEntrega(v: boolean | null): string {
  return v === null ? '' : v ? '1' : '0'
}

/**
 * A HORA DO AVISO NO FUTURO, dita NO CAMPO (Sol · rodada 2 do A6, C10a).
 *
 * O `max` do campo é AGORA no fuso do negócio, e o banco recusa com o mesmo
 * critério (`if p_notified_at > now() then raise`). Antes, uma hora futura
 * fechava o diálogo e morria num balão nativo cinza: a dona confirmava e não
 * acontecia NADA — nem registro, nem recusa, nem frase. Agora a validade é
 * conferida ANTES de abrir a confirmação, e o erro acende no campo, com esta
 * frase (`setCustomValidity` → `frasePropria` do `mensagemDoCampo`, que tem
 * precedência sobre o genérico "fora do que este campo aceita").
 */
export const AVISO_NO_FUTURO =
  'A hora do aviso não pode estar no futuro — informe quando o aviso realmente chegou, ou deixe em branco para registrar "agora".'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O `max` DO CAMPO ENVELHECE COM A ABA ABERTA (revisão independente do A6, M3)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O DEFEITO, medido: `max={agoraNoNegocio}` é montado no SERVIDOR, no render.
 * A dona deixa a agenda aberta a manhã inteira (é o uso normal da tela), volta
 * às 16h, digita "hoje 15:40" no campo do aviso — e o navegador recusa por
 * `rangeOverflow`, porque o `max` daquele HTML ainda diz 09:12. A frase que
 * acende é `AVISO_NO_FUTURO` ("a hora do aviso não pode estar no futuro"), que
 * é FALSA: 15:40 é passado. E é beco — nada na tela sugere recarregar, e o
 * `ConfirmarDesfecho` nem abre o diálogo enquanto o formulário estiver
 * inválido.
 *
 * O CONSERTO: quem decide a hora-limite é o relógio no MOMENTO DO TOQUE, no
 * fuso do NEGÓCIO. O `max` do servidor continua no HTML como CINTO (a tela
 * nasce com uma régua correta mesmo antes de qualquer interação, e sem JS ela
 * é a única que existe).
 *
 * ⚠️ LEI 1, e o limite exato do que isto faz: nenhuma tela nova decide DIA
 * CIVIL sozinha. A zona vem do SERVIDOR (`BUSINESS_TZ`, a mesma constante que
 * a página usa), não do relógio do sistema operacional de quem está olhando —
 * o que o cliente contribui é só o INSTANTE. E isto é hora-limite de UI:
 * quem decide de verdade continua sendo o banco
 * (`if p_notified_at > now() then raise`, em `_cancel_class_core`), e a action
 * traduz a recusa. Relógio adiantado no computador da dona não compra
 * cancelamento nenhum — compra, no máximo, uma ida ao servidor.
 */
export function agoraNoNegocio(): string {
  return DateTime.now().setZone(BUSINESS_TZ).toFormat("yyyy-LL-dd'T'HH:mm")
}

/**
 * A régua do campo "quando o aviso chegou", nas DUAS telas que o têm (a matriz
 * da Agenda e o painel "cancelar" da ficha) — uma função só, porque duas cópias
 * de uma régua de hora é como uma delas fica para trás.
 *
 * Ela faz as duas coisas na ordem que importa: renova o `max` (ver acima) e SÓ
 * ENTÃO lê `rangeOverflow` para escolher a frase. Ler antes de renovar é
 * classificar pela régua velha, que é o defeito que ela vem consertar.
 *
 * Serve de `ref` (montagem: o rascunho pode voltar com hora futura), de
 * `onInput` (digitação) e do portão do CTA (o toque, horas depois).
 */
export function conferirHoraDoAviso(el: HTMLInputElement | null): void {
  if (!el) return
  el.max = agoraNoNegocio()
  el.setCustomValidity(el.validity.rangeOverflow ? AVISO_NO_FUTURO : '')
}

/** Os rótulos das duas caixas — vocabulário da dona, nunca "canal"/"outbox". */
export const ROTULO_DO_CANAL = {
  email: 'Avisar o aluno por e-mail',
  whatsapp: 'Avisar o aluno por WhatsApp',
} as const

/** O enunciado do bloco de caixas. Diz o TEMPO do ato ("agora", junto com o
 *  cancelamento) — é isso que separa esta decisão de um envio manual depois. */
export const LEGENDA_DOS_CANAIS = 'O que sai para o aluno junto com este cancelamento'

/** Voltar atrás no diálogo não é registrar nada — e o botão diz isso. */
export const VOLTAR_DA_CONFIRMACAO = 'Voltar sem registrar'
