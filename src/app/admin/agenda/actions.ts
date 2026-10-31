'use server'

import { DateTime } from 'luxon'
import { redirect } from 'next/navigation'
import { sendRescheduleEmails } from '@/lib/email/notify'
import { sendEmail } from '@/lib/email/send'
import { syncTeacherCalendarSoon } from '@/lib/google/sync'
import { canaisDoAmbiente } from '@/lib/notify/registry'
import { dispatchOutbox } from '@/lib/outbox/dispatch'
import { asaasConfigFromEnv } from '@/lib/asaas/client'
import { emitirCobrancaDaAvulsa } from '@/lib/asaas/emissao'
import { requireAdminId } from '@/lib/auth/admin'
import {
  conferirHoraCivil,
  recusaDaHoraCivil,
  type VeredictoDoCivil,
} from '@/lib/admin/hora-civil'
import {
  CAMPOS_DO_DESFECHO,
  CAMPO_DA_ENTREGA,
  ehCancelamento,
  ehDesfecho,
  pedidoPor,
  type Desfecho,
} from '@/lib/admin/desfecho-da-aula'
import { casaDaSecao, gravarRecado } from '@/lib/kit/recado'
import { resumoDoBloqueio } from '@/data/admin/agenda'
import {
  chaveDoCancelamentoDaFicha,
  chaveDoDesfecho,
  chaveDoRemarcar,
  esquecerRascunho,
  gravarRascunho,
  lerRascunho,
} from '@/lib/admin/rascunho-do-formulario'
import { enderecoDaFicha } from '@/data/admin/ficha-gramatica'
import {
  CAMPOS_DA_PORTA,
  chaveDoDestino,
  enderecoDaTela,
  geometriaCanonica,
  geometriaValida,
  ID_NO_CAMINHO,
  lerDaQuery,
  type PortaDaAgenda,
  type TelaDaAgenda,
} from '@/lib/admin/transporte-da-agenda'
import { tzLabel } from '@/lib/format'
import { quandoNaRecusa } from '@/lib/windows'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const BUSINESS_TZ = 'America/Cuiaba'

/* ==========================================================================
 * O TRANSPORTE DA SEÇÃO — UM SÓ, PARA AS TRÊS TELAS (A7)
 * ==========================================================================
 *
 * Até aqui conviviam DOIS: o `falhou()`/`backTo()` das actions legadas, que
 * obedecia ao `manter`/`na_url`/`back_erro`/`rascunho` do FORMULÁRIO e publicava
 * a frase em `?msg=`, e o par blindado que o A5 escreveu para a matriz do
 * desfecho. A dívida estava escrita com todas as letras neste arquivo:
 *
 *   «⚠️ DÍVIDA NOMEADA DO A7: o `falhou()` compartilhado pelas outras onze
 *    actions deste arquivo CONTINUA confiando em `manter`/`na_url`/`back_erro`
 *    do cliente, com as duas portas acima abertas.»
 *
 * As duas portas eram: (1) `manter=msg&na_url=msg` REINSERIA a ponte legada na
 * query depois da higienização — a limpeza era contornável pelo formulário que
 * ela protege; (2) `back_erro=/admin/agenda?off_note=<texto da vida de alguém>`
 * voltava intacto, republicando na barra de endereços exatamente o que o cookie
 * de rascunho existe para tirar de lá.
 *
 * Agora há UM transporte, e ele não negocia nada com o cliente:
 *   · os campos que sobrevivem ao erro saem de `CAMPOS_DA_PORTA` — tabela do
 *     SERVIDOR, em `@/lib/admin/transporte-da-agenda`;
 *   · a chave do rascunho é DERIVADA do destino (`chaveDoDestino`);
 *   · o destino é RECONSTRUÍDO: caminho fixo da tela + allowlist de geometria
 *     validada por tipo. `msg`/`n` não estão na allowlist, então a ponte não é
 *     "limpa depois" — ela não tem por onde entrar;
 *   · a FRASE volta no cookie `httpOnly` da seção, nunca no endereço.
 *
 * O que os formulários ainda mandam, e por quê: `back` (a geometria da tela em
 * que ela estava — o servidor não tem como saber a semana que ela olhava) e
 * `back_erro` (QUAL formulário reabre). Os dois passam pela allowlist, então o
 * pior que um envio forjado consegue é escolher outra VISTA da mesma seção.
 * `manter`, `na_url` e `rascunho` deixaram de existir como campo.
 *
 * ⚠️ ÚNICA EXCEÇÃO, DECLARADA: `cancelClassAction` — ver a lápide dela.
 */

/**
 * Uma PORTA da seção: para onde ela volta, e o que ela guarda quando o banco
 * recusa. É o único parâmetro que os porteiros compartilhados (`exigirDuracao`,
 * `exigirHoraQueExiste`, `exigirHorarioForaDeBloqueio`, `exigirMotivoDaCortesia`)
 * precisam para recusar no lugar certo.
 */
interface Porta {
  tela: TelaDaAgenda
  /** a lista do SERVIDOR — nunca o `manter` do formulário */
  campos: readonly string[]
  /**
   * A geometria que ESTA action impõe ao destino de erro, por saber dela mais
   * que o formulário: o `ev` do desfecho (a aula que ela recebeu), os dois
   * booleanos do Remarcar, o período do tratamento. Valor VAZIO apaga a chave —
   * é assim que um desfecho sem aula identificada não reabre balão nenhum.
   */
  geometria?: Record<string, string>
  /**
   * A chave do rascunho, quando a action a conhece melhor que o destino. Sem
   * ela, a chave é DERIVADA do endereço de erro — ver `chaveDoEnvio`.
   */
  chave?: string
}

/**
 * A PORTA `'nenhum'` NÃO TOCA GAVETA NENHUMA — por CONSTRUÇÃO (S7 da varredura
 * final da onda da Agenda).
 *
 * O contrato do transporte está escrito em `chaveDoDestino`: «`''` significa
 * "este formulário não tem rascunho" (o lote, as remoções, o despublicar) — e
 * quem recebe `''` NÃO TOCA no cookie». Só que a chave era DERIVADA do endereço
 * de erro, e as remoções mandam `back_erro=/admin/agenda?novo=disponibilidade`
 * (é o painel que reabre, para a dona ver o que sobrou da lista). O `novo=`
 * fazia `chaveDoDestino` devolver `painel:disponibilidade` — a chave do
 * formulário de CRIAR janela/bloqueio. Resultado: remover uma janela apagava o
 * que ela tinha digitado no formulário de criar o bloqueio ao lado, no sucesso
 * E no erro. O contrato existia; quem o cumpria era o acaso do formulário.
 *
 * Agora a porta sem gaveta declara `chave: ''` na FÁBRICA, e não em cada
 * chamada: as quatro de hoje (`cancelWindowAction`,
 * `removeWeeklyAvailabilityAction`, `removeTeacherBlockAction`,
 * `completeAllPendingAction`) e a quinta que alguém escrever amanhã nascem
 * certas. `''` não é nulo, então ele vence o `p.chave ?? …` de `chaveDoEnvio`.
 */
const porta = (tela: TelaDaAgenda, qual: PortaDaAgenda): Porta => ({
  tela,
  campos: CAMPOS_DA_PORTA[qual],
  ...(qual === 'nenhum' ? { chave: '' } : {}),
})

/** A casa da seção — o destino da maioria das portas. */
const CASA: TelaDaAgenda = { tela: 'casa' }

/** O leitor do endereço de volta que o formulário mandou (ERRO → `back_erro`). */
function crua(formData: FormData, comErro: boolean): string {
  const erro = String(formData.get('back_erro') ?? '')
  return comErro && erro ? erro : String(formData.get('back') ?? '')
}

/**
 * De quem é o rascunho DESTE envio — derivado do endereço de ERRO, mesmo no
 * caminho de sucesso.
 *
 * Parece contraintuitivo e não é: o rascunho pertence ao FORMULÁRIO que foi
 * enviado, e é o `back_erro` que identifica esse formulário (qual painel, qual
 * slot, qual aula). O destino de SUCESSO fecha o painel e por isso não o
 * identifica mais — usá-lo faria o sucesso do painel da avulsa deixar para trás
 * o rascunho dele, que reapareceria por cima do próximo formulário nos 60 s
 * seguintes.
 */
function chaveDoEnvio(p: Porta, formData: FormData): string {
  return p.chave ?? chaveDoDestino(p.tela, geometriaDoErro(p, formData))
}

/** A geometria do destino de ERRO: a do formulário, com a da action por cima. */
function geometriaDoErro(p: Porta, formData: FormData): URLSearchParams {
  const q = geometriaCanonica(p.tela, true, lerDaQuery(crua(formData, true)))
  for (const [k, v] of Object.entries(p.geometria ?? {})) {
    if (v && geometriaValida(k, v)) q.set(k, v)
    else q.delete(k)
  }
  return q
}

/**
 * VOLTA DE SUCESSO — a frase no cookie da seção, o painel FECHADO.
 *
 * `opcoes.extra` existe para a tela que sabe do próprio endereço melhor que o
 * formulário: o tratamento de período volta para a professora e o intervalo que
 * ESTA action recebeu, não para os que vieram pendurados num `back`.
 *
 * `opcoes.destino` separa DE ONDE veio o envio de PARA ONDE ela vai — quem
 * decide de quem é o rascunho a apagar continua sendo a porta de origem. O único
 * caso hoje é a remarcação bem-sucedida, que sai da tela da aula porque aquela
 * aula deixou de existir como estava.
 */
async function voltar(
  p: Porta,
  formData: FormData,
  msg: string,
  opcoes?: { destino?: TelaDaAgenda; extra?: Record<string, string> },
): Promise<never> {
  // Ato CONCLUÍDO não deixa rascunho para trás — e apaga só o DELE (dívida (a)
  // do A7: o sucesso de uma aba varria o que estava digitado na outra).
  await esquecerRascunho(chaveDoEnvio(p, formData))
  const t = opcoes?.destino ?? p.tela
  // SUCESSO carrega só a geometria da TELA: nada de `novo`/`slot`/`ev`, que
  // reabririam o formulário do ato que acabou de acontecer.
  const q = geometriaCanonica(t, false, lerDaQuery(crua(formData, false)))
  for (const [k, v] of Object.entries(opcoes?.extra ?? {})) {
    if (v && geometriaValida(k, v)) q.set(k, v)
  }
  const destino = enderecoDaTela(t, q)
  await gravarRecado('agenda', msg, destino)
  redirect(destino)
}

/**
 * VOLTA DE ERRO — o formulário continua ABERTO e com o que ela escolheu.
 *
 * PORTÃO DE DEPLOY 29/07 (bloqueadores 4 e 6), que é o motivo de este caminho
 * existir. Nada mudava no banco, mas a tela voltava DIFERENTE do que a dona
 * tinha decidido:
 *   · os painéis de criação usavam o MESMO endereço no sucesso e no erro — o
 *     painel fechava e tudo o que ela digitou sumia;
 *   · o Remarcar voltava com a CORTESIA DESLIGADA, e o segundo envio podia
 *     consumir franquia ou crédito de um aluno que a dona tinha isentado;
 *   · o Período voltava com o seletor na PRIMEIRA opção ("Cancelar com
 *     crédito"), e um novo toque em "Aplicar" executava outra operação, e
 *     destrutiva.
 *
 * ONDE OS CAMPOS VIAJAM (Sol · rodada 1 do A4, grave 5 — LGPD): num COOKIE
 * `httpOnly` de vida curta. `student_name`, `iana_tz`, `price`, a `note` do
 * bloqueio ("consulta médica"), o `motivo` da cortesia ("cirurgia", "luto") e o
 * `note` do período ("férias da professora") não podem ficar no histórico do
 * navegador, no log de acesso do servidor e do Cloudflare, numa captura de tela
 * nem no link que ela copia pedindo ajuda. Na URL fica só GEOMETRIA.
 *
 * Campo esvaziado é OMITIDO — senão um valor velho ressuscitaria por cima da
 * correção dela.
 */
async function falhar(p: Porta, formData: FormData, msg: string): Promise<never> {
  const q = geometriaDoErro(p, formData)
  const guardados: Record<string, string> = {}
  for (const campo of p.campos) {
    const v = formData.get(campo)
    if (typeof v === 'string' && v.trim() !== '') guardados[campo] = v
  }
  const destino = enderecoDaTela(p.tela, q)
  // Sempre escreve: a chamada com `{}` apaga o rascunho DESTA chave (e só dela).
  await gravarRascunho(chaveDoEnvio(p, formData), guardados)
  await gravarRecado('agenda', msg, destino)
  redirect(destino)
}

/* ==========================================================================
 * A PONTE LEGADA, REDUZIDA A UMA PORTA (e por que ela não morre aqui)
 * ========================================================================== */

/**
 * `cancelClassAction` é a única action deste arquivo que NÃO volta para a
 * Agenda: o único chamador dela é o painel "cancelar" da FICHA DO ALUNO
 * (`src/components/admin/alunos/ficha/paineis.tsx`), que manda
 * `back=/admin/alunos/<id>?aba=historico`.
 *
 * Migrá-la para o transporte acima QUEBRARIA a ficha, e em silêncio: o cookie do
 * recado tem `path` estreito (`/admin/agenda`), então a frase seria gravada num
 * cookie que o navegador nunca envia para `/admin/alunos` — a dona cancelaria a
 * aula e não veria recado nenhum. Ela migra na ONDA DA FICHA, junto com a tela
 * dela; o que sobra aqui é uma ponte de UMA porta, com o mínimo de superfície:
 *
 *   · `manter`, `na_url`, `back_erro` e `rascunho` NÃO são lidos (a ficha nunca
 *     os mandou, e a action deixa de aceitá-los mesmo forjados — as duas portas
 *     do bloqueador do A5 ficam fechadas também aqui);
 *   · nada do que a dona digitou entra na query: o único parâmetro é a frase,
 *     que é a razão de a ponte existir;
 *   · o rascunho que ela toca é SÓ o dela — a gaveta própria do painel da ficha
 *     (`chaveDoCancelamentoDaFicha`), nunca a de outro formulário: varrer a dos
 *     outros é a dívida (a) que o A7 fechou.
 *
 * ⚠️ Quem for acrescentar action nova a este arquivo: NÃO use estas duas. Elas
 * existem para uma tela que não é desta seção, e o teste da §transporte reprova
 * qualquer outro uso.
 */
async function backParaAFicha(
  formData: FormData,
  msg: string,
  /** o destino que a ACTION montou (a volta de erro reabre o painel) — sem ele
   *  vale o `back` do formulário, que é a volta de sucesso de sempre */
  destino?: string,
): Promise<never> {
  const cru = destino ?? String(formData.get('back') ?? '')
  const back = cru.startsWith('/admin') ? cru : casaDaSecao('agenda')
  const sep = back.includes('?') ? '&' : '?'
  redirect(`${back}${sep}msg=${encodeURIComponent(msg)}&n=${Date.now()}`)
}

/* ---------------- desfechos (Lei 3: quem decide crédito × perda é o banco) ---
 *
 * A MATRIZ DO ADR-018 TEM UMA ACTION SÓ (A5/L3): `registrarDesfechoDaAulaAction`,
 * no fim deste arquivo. O trio de antes — `completeClassAction`, `noShowAction` e
 * o `CancelForm` do `pieces.tsx` — MORREU junto com o `pieces.tsx`, que era o
 * único chamador dos dois primeiros (varrido em `src` e `tests` antes de apagar:
 * action sem chamador e botão sem backend são as duas metades do mesmo defeito).
 *
 * `cancelClassAction` FICA, e não é esquecimento: ela também serve o painel
 * "cancelar" da FICHA DO ALUNO (`src/components/admin/alunos/ficha/paineis.tsx`,
 * cobrado em `tests/m3-ficha.test.ts`), que está fora do território do A5 e migra
 * na onda dela. Consequência declarada: a ficha continua na ponte `?msg=` e a
 * agenda passa ao cookie — dois transportes convivendo, com precedência escrita
 * na página (ver o cabeçalho de `page.tsx`).
 */

/**
 * O FORMATO CIVIL EXATO do campo "quando o aviso chegou" — e por que ele é
 * verificado ANTES do Luxon (Sol · rodada 1 do A5, grave).
 *
 * `DateTime.fromISO('2026-08-04T13:00Z', { zone: 'America/Cuiaba' })` é VÁLIDO e
 * vale 13:00 UTC: a opção `zone` é o fuso de INTERPRETAÇÃO de uma hora civil, e
 * uma entrada que já carrega fuso (`Z`, `+00:00`, `-03:00`) manda nela. Isso são
 * QUATRO horas de diferença num campo que decide se o aviso precedeu o início da
 * aula — e portanto se o cancelamento passa ou é recusado. `<input
 * type="datetime-local">` nunca produz esses sufixos; um envio forjado, uma aba
 * antiga ou um colar de texto produzem. É Lei 1 e é dinheiro: o que não é hora
 * civil pura não vira instante.
 *
 * Segundos são opcionais porque alguns navegadores os incluem (`step` menor);
 * milissegundos, fuso e espaço em vez de `T` ficam FORA.
 */
const HORA_CIVIL_DO_AVISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

/** Frase única das duas actions (a legada e a da matriz) — uma só grafia. */
const AVISO_ILEGIVEL =
  'Falha: data/hora do aviso inválida — use o seletor do campo, que vale no horário de Cuiabá; hora com fuso escrito à mão (Z, +00:00) não é aceita. Nada foi cancelado.'

/**
 * A hora civil do aviso → INSTANTE, com a Lei 1 inteira (Sol · rodada 2 do A5).
 *
 * O regex de formato fechou o `Z`/offset e deixou o DST passar:
 * `DateTime.fromISO('2018-11-04T00:30', { zone: 'America/Cuiaba' })` é VÁLIDO e
 * vira 01:30 em silêncio (o relógio de Cuiabá pulava essa hora quando havia
 * horário de verão), e no RETORNO do DST uma das duas ocorrências é escolhida
 * sem consentimento. Gravar outro instante aqui pode inverter a guarda "o aviso
 * precedeu o início" — é dinheiro.
 *
 * A casa já tinha a ferramenta: `conferirHoraCivil` (`src/lib/admin/hora-civil.ts`,
 * a mesma que `exigirHoraQueExiste` usa nas quatro portas de criação) prova os
 * dois offsets vizinhos e devolve `inexistente`/`ambigua` em vez de adivinhar. O
 * regex fica como PRIMEIRA barreira, de formato.
 *
 * Segundos são TRUNCADOS (`conferirHoraCivil` recebe `HH:mm`): a guarda do banco
 * compara com `starts_at_utc` e um minuto é a precisão que a dona digita. O
 * arredondamento é para BAIXO, e no caso de empate a guarda continua recusando
 * (`p_notified_at >= starts_at_utc`), então nenhum cancelamento passa por causa
 * dele.
 */
function veredictoDoAviso(cru: string): VeredictoDoCivil {
  if (!HORA_CIVIL_DO_AVISO.test(cru)) return { ok: false, motivo: 'formato' }
  const [data, resto] = cru.split('T')
  return conferirHoraCivil(data, resto.slice(0, 5), BUSINESS_TZ)
}

/**
 * A recusa do aviso, em frase de gente.
 *
 * Por que não reusa `recusaDaHoraCivil`: aquela frase termina em "Nada foi
 * criado" e ensina a escolher OUTRO horário para a aula — aqui não se cria nada e
 * a dona está informando QUANDO um aviso chegou; o conserto dela é outro
 * (minuto vizinho, ou deixar em branco = agora). O diagnóstico é o mesmo, a
 * orientação não.
 */
function recusaDoAviso(v: VeredictoDoCivil): string {
  const cidade = tzLabel(BUSINESS_TZ)
  if (!v.ok && v.motivo === 'inexistente')
    return `Falha: nesse dia o horário de verão COMEÇA em ${cidade} e o relógio de lá pula essa hora — o aviso não pode ter chegado nesse minuto. Informe um minuto vizinho, ou deixe o campo em branco para registrar "agora". Nada foi cancelado.`
  if (!v.ok && v.motivo === 'ambigua')
    return `Falha: em ${cidade} essa hora acontece DUAS vezes nesse dia (o horário de verão termina) e não dá para saber qual delas você quis. Informe um minuto vizinho, ou deixe o campo em branco para registrar "agora". Nada foi cancelado.`
  return AVISO_ILEGIVEL
}

/**
 * A ESCOLHA DE CANAIS, lida do formulário — e o default que ela NÃO pode virar.
 *
 * Caixa desmarcada não viaja no envio: `formData.get('avisar_email')` é `null`
 * tanto quando a dona desmarcou quanto quando o formulário nem oferece a
 * escolha. Tratar os dois iguais transformaria todo envio antigo (aba velha,
 * formulário de outra tela, chamada forjada) num cancelamento SILENCIOSO — o
 * aluno deixaria de ser avisado sem ninguém ter decidido isso.
 *
 * Por isso o formulário que oferece a escolha carrega a marca `canais=1`. Sem
 * ela, os dois canais ficam LIGADOS, que é o comportamento de sempre e o
 * default da RPC.
 */
function canaisEscolhidos(formData: FormData): { email: boolean; whatsapp: boolean } {
  if (String(formData.get('canais') ?? '') !== '1') return { email: true, whatsapp: true }
  return {
    email: String(formData.get('avisar_email') ?? '') === '1',
    whatsapp: String(formData.get('avisar_whatsapp') ?? '') === '1',
  }
}

export async function cancelClassAction(formData: FormData) {
  await requireAdminId()
  const instance = String(formData.get('instance_id') ?? '')
  const cancelledBy = String(formData.get('cancelled_by') ?? '')
  const notifiedAt = String(formData.get('notified_at') ?? '').trim()
  const canais = canaisEscolhidos(formData)
  // A linha da matriz que este painel é — o seletor grava `cancelled_by`, e a
  // tradução da recusa precisa saber se o ato era um cancelamento (é o que
  // acrescenta "Nada foi cancelado" ao fecho da frase).
  const escolha: Desfecho = cancelledBy === 'teacher' ? 'cancelada_professora' : 'cancelada_aluno'

  // Lei 1: o horário digitado pela admin é hora LOCAL do negócio — conversão
  // explícita. Valor que não parseia ABORTA (cair no now() do banco inverteria
  // a decisão crédito × perda em silêncio), e valor que traz FUSO também: ver
  // `instanteDoAviso`.
  let notifiedUtc: string | null = null
  if (notifiedAt) {
    const v = veredictoDoAviso(notifiedAt)
    if (!v.ok) await falhaNaFicha(formData, instance, recusaDoAviso(v))
    notifiedUtc = v.ok ? v.instanteUtc : null
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_class', {
    p_instance: instance,
    p_cancelled_by: cancelledBy,
    ...(notifiedUtc ? { p_notified_at: notifiedUtc } : {}),
    // A6/lote 2: a escolha vai EXPLÍCITA nas duas pontas, mesmo quando é igual
    // ao default da RPC — assim o que a tela mostrou e o que o banco recebeu
    // são a mesma coisa, e a leitura do audit não depende de saber qual era o
    // default no dia.
    p_notify_email: canais.email,
    p_notify_whatsapp: canais.whatsapp,
  })
  // A MESMA TRADUÇÃO DA AGENDA (revisão independente do A6, M2). Aqui saía
  // `Falha: ${error.message}` cru — "aula % já começou e o aviso não a
  // precedeu — use no_show…" e "private_1on1" chegavam à dona em vocabulário
  // de banco, na tela onde ela mais cancela. As frases já existem e foram
  // medidas no corpo das RPCs; o que faltava era esta porta usá-las.
  // ⚠️ RESIDUAL DECLARADO: o fall-through desta função cai no texto CRU do
  // banco, e nesta ponte a frase viaja na URL (`?msg=`) — não no cookie
  // httpOnly da Agenda. Isso já era assim (a frase crua ia inteira para lá), e
  // o que muda agora é que as recusas CONHECIDAS deixam de ir. O veículo é a
  // dívida da ficha, e morre com ela na onda dela.
  if (error) await falhaNaFicha(formData, instance, fraseDaRecusaDoDesfecho(error.message, escolha))

  // ATO CONCLUÍDO NÃO DEIXA RASCUNHO PARA TRÁS — e apaga só o DESTA gaveta
  // (dívida (a) do A7: varrer o cookie inteiro apagava o que a outra aba tinha
  // digitado). Daqui para baixo tudo é sucesso: a aula já está cancelada e não
  // se desfaz, então nenhum caminho reabre este painel.
  if (instance) await esquecerRascunho(chaveDoCancelamentoDaFicha(instance))

  // Mostra o que o banco decidiu (a decisão é dele; a UI só relata).
  //
  // A1 da onda da Agenda — o `error` desta leitura era DESCARTADO, e o silêncio
  // aqui mentia: falha ao ler a auditoria caía no ramo "sem crédito", que é uma
  // AFIRMAÇÃO sobre dinheiro. O cancelamento já foi commitado e não se desfaz;
  // o que muda é o recado, que passa a admitir a dúvida em vez de inventar a
  // resposta errada.
  const { data: audit, error: auditErr } = await supabase
    .from('audit_log')
    .select('diff')
    .eq('action', 'cancel_class')
    .eq('entity_id', instance)
    .order('id', { ascending: false })
    .limit(1)
    .single()
  if (auditErr) {
    await backParaAFicha(
      formData,
      'Aula cancelada, mas não deu para ler se gerou crédito — confira o saldo do aluno na ficha dele.',
    )
  }
  const credited = audit?.diff?.credited
  const expires = audit?.diff?.expires_on
  // A FRASE DO RAMO SEM CRÉDITO ERA FALSA (A5, afirmação nº 1 da medição).
  // Ela dizia "sem crédito (o aviso veio fora do prazo mínimo do contrato)", e
  // `_cancel_class_core` NÃO olha antecedência nenhuma para decidir crédito:
  // quem decide é `p_cancelled_by` (ADR-018) — `min_notice_hours` está no `diff`
  // como CONTEXTO. Além disso o ramo `credited = false` tem DOIS habitantes: o
  // cancelamento pelo aluno (que por regra não credita) e a devolução BLOQUEADA
  // de uma aula nascida de crédito sem identidade
  // (`_refund_for_credit_born_class` volta com `o_blocked`). A frase nova cobre
  // os dois sem afirmar o que não sabe.
  //
  // Esta action continua servindo a FICHA DO ALUNO (fora do território do A5), e
  // por isso continua na ponte `?msg=`; o que não podia continuar é a mentira
  // sobre dinheiro, que é o próprio motivo deste milestone.
  await backParaAFicha(
    formData,
    credited
      ? `Aula cancelada — o aluno GANHOU um crédito de reposição (vale até ${expires ? DateTime.fromISO(String(expires)).setLocale('pt-BR').toFormat('dd/LL/yyyy') : '—'}).`
      : 'Aula cancelada — sem crédito de reposição. Quem decide o crédito é quem pediu o cancelamento, não a antecedência do aviso: pedido do aluno nunca credita. Se foi a professora, confira o extrato de créditos do aluno na ficha dele.',
  )
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A VOLTA DE ERRO DO PAINEL DA FICHA (revisão independente do A6, M2)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── O DEFEITO, medido ───────────────────────────────────────────────────────
 * A recusa do servidor mandava a dona para `?aba=historico` — o painel FECHAVA
 * e tudo o que ela tinha escolhido morria com ele. Reabrindo "Cancelar aula", o
 * formulário nascia de novo com "o aluno" no seletor e com as caixas de aviso
 * RELIGADAS pela entregabilidade. Ou seja: ela desmarcava o WhatsApp de
 * propósito, o banco recusava por outro motivo (hora do aviso no futuro, aula
 * que já tem desfecho), ela confirmava de novo — e o aluno recebia o recado que
 * ela tinha decidido não mandar. É o P2 que a Agenda fechou no A6, vivo no
 * outro ramo da MESMA action.
 *
 * ── A MECÂNICA É A DO TRANSPORTE NOVO, adaptada ao que esta ponte é ─────────
 * Do A7 vem o que importa: o destino é RECONSTRUÍDO (caminho fixo + geometria
 * conhecida, nada do `back` do cliente além do id do aluno, que é conferido por
 * formato) e a CHAVE do rascunho é DERIVADA desse destino — escritor e leitor
 * não têm como divergir, que é a invariante que o A4 pagou caro para aprender.
 *
 * O que NÃO vem, e é declarado: esta porta continua sem `Porta`/`falhar()`,
 * porque o destino não é uma tela da seção Agenda e o cookie do recado da seção
 * não chega a `/admin/alunos` (ver a lápide de `backParaAFicha`). A frase segue
 * na ponte `?msg=`; os CAMPOS, não — eles viajam no cookie `httpOnly`, como em
 * toda a casa desde o grave 5 do A4 (a hora do aviso é hora de um fato da vida
 * de alguém, e endereço vai para histórico, log e captura de tela).
 *
 * `back` sem id de aluno legível (envio forjado, chamada de fora da ficha) cai
 * na ponte de sempre e NÃO grava rascunho: sem painel para reabrir, guardar o
 * que ela digitou seria deixar um cookie que ninguém vai ler.
 */
async function falhaNaFicha(
  formData: FormData,
  instance: string,
  msg: string,
): Promise<never> {
  const aluno = alunoDoBack(String(formData.get('back') ?? ''))
  if (!aluno || !ID_NO_CAMINHO.test(instance)) await backParaAFicha(formData, msg)
  // A lista é do SERVIDOR, como em toda porta da seção: são os quatro campos em
  // que ela DECIDIU alguma coisa. `avisar_email`/`avisar_whatsapp` valem '0' —
  // e '0' é valor, não vazio (a diferença entre "ela desmarcou" e "não veio").
  const guardados: Record<string, string> = {}
  for (const campo of ['cancelled_by', 'notified_at', 'avisar_email', 'avisar_whatsapp']) {
    const v = formData.get(campo)
    if (typeof v === 'string' && v.trim() !== '') guardados[campo] = v
  }
  await gravarRascunho(chaveDoCancelamentoDaFicha(instance), guardados)
  // O destino REABRE o painel daquela aula, na aba dele. Montado por
  // `enderecoDaFicha` — nada do `back` do formulário sobrevive além do id.
  // `return` e não `await`: é ele que faz o TypeScript entender que esta função
  // não tem fim alcançável (a mesma nota do `return voltar(...)` da matriz).
  return backParaAFicha(
    formData,
    msg,
    enderecoDaFicha(aluno!, { aba: 'historico', painel: 'cancelar', alvo: instance }),
  )
}

/** O id do aluno dentro do `back` da ficha — só o formato de id no caminho. */
function alunoDoBack(cru: string): string | null {
  const m = /^\/admin\/alunos\/([A-Za-z0-9._-]{1,64})(?:[?#]|$)/.exec(cru)
  return m ? m[1] : null
}

/* ---------------- porteiros de fuso e de bloqueio ---------------------------
 * Os dois são ANTECIPAÇÃO no sentido da Lei 3 — quem decide é o Postgres.
 *
 * ── LÁPIDE DAS DUAS DÍVIDAS QUE ISTO CARREGAVA (fechadas na migration 98) ────
 * Até o A6 estes porteiros cobriam buracos do BANCO, e não só a UX:
 *   1. a RPC recebia `p_local_date` + `p_local_time` e refazia a conversão
 *      civil→instante — nos dois dias do ano em que o relógio da cidade pula ou
 *      repete a hora, a informação de QUAL ocorrência a dona quis já se perdia
 *      antes de chegar lá. **CURADO:** `admin_create_single_class`,
 *      `admin_create_trial_class` e `publish_reschedule_window` recebem
 *      `p_starts_at_utc timestamptz` (A6/a), a conversão acontece UMA vez —
 *      aqui, com Luxon — e o `local_time_snapshot` é derivado dentro da RPC.
 *      Morreu junto a divergência de tzdata Node×host medida no A4: não há
 *      segunda conversão para divergir.
 *   2. nenhuma das três consultava `teacher_availability_exceptions`.
 *      **CURADO:** as duas de criação recusam aula que SOBREPÕE bloqueio (A6/h)
 *      e a de publicação recusa horário dentro de bloqueio e em cima de aula
 *      agendada (A6/d). `book_reschedule_window` ganhou o mesmo cinto (A6/e).
 *
 * O que estes porteiros continuam fazendo, e por que continuam existindo:
 * `exigirHoraQueExiste` é quem RECUSA hora inexistente/ambígua — a conversão
 * agora mora aqui, então ela é obrigatória, não opcional; e
 * `exigirHorarioForaDeBloqueio` dá a frase em português (com o período do
 * bloqueio) antes da ida ao banco, em vez de deixar a dona ler o `raise`.
 */

type ClienteDoServidor = Awaited<ReturnType<typeof createClient>>

/**
 * Confere a data/hora civis contra o relógio REAL da cidade e devolve o
 * instante. Recusa (com a tela inteira preservada) quando a hora não existe ou
 * acontece duas vezes — ver `src/lib/admin/hora-civil.ts`.
 */
async function exigirHoraQueExiste(
  p: Porta,
  formData: FormData,
  data: string,
  hora: string,
  iana: string,
): Promise<string> {
  const v = conferirHoraCivil(data, hora, iana)
  // `return falhar(...)` e não `await`: ele devolve `Promise<never>`, então o
  // TypeScript entende que daqui para baixo o veredicto é o positivo.
  if (!v.ok) return falhar(p, formData, `Falha: ${recusaDaHoraCivil(v, tzLabel(iana), hora)}`)
  return v.instanteUtc
}

/**
 * O que a avulsa precisa saber do contrato ANTES de chamar a RPC:
 *
 *  · `iana` — o fuso em que `admin_create_single_class` VAI ler a data e a
 *    hora: a mesma escada da função (slot recorrente vigente hoje, senão o
 *    cadastro do aluno). `null` = não deu para saber; nesse caso a conferência
 *    de fuso é pulada e quem recusa é a RPC, que estoura com 'não foi possível
 *    determinar a zona IANA'.
 *  · `teacherId` — de quem é a agenda que a aula vai ocupar. A RPC tira a
 *    professora do CONTRATO (`v_contract.teacher_id`), não do formulário; é
 *    dela o bloqueio que o porteiro precisa conferir.
 *
 * ── O "HOJE" DA ESCADA VEM DO BANCO, E NÃO DE UMA CONTA EM NODE ─────────────
 * (revisão independente do A4, 29/07 — grave 3.) A RPC compara
 * `active_from`/`active_to` com `current_date`, que vale no `TimeZone` DA
 * SESSÃO Postgres — não no relógio do host e não no processo Node. A versão
 * anterior espelhava isso com um "dia do banco" calculado em NODE (o dia UTC do
 * processo), o que só está certo enquanto a sessão do banco estiver em UTC — e
 * divergia em SILÊNCIO se o
 * invariante operacional quebrasse: app resolvendo Lisboa, RPC resolvendo
 * Orlando, e a aula nascendo cinco horas fora do lugar.
 *
 * A suposição foi ELIMINADA em vez de reforçada: os dois lados da vigência vão
 * para a consulta como filtro de embed, com o literal `today` do Postgres — que
 * É `current_date` por definição, na mesma sessão (medido no banco local: com
 * `set timezone` a `Pacific/Kiritimati` e a `Etc/GMT+12`, `current_date` e
 * `'today'::date` continuam iguais). Custo: ZERO ida a mais ao banco — o filtro
 * viaja na consulta que já existia.
 *
 * Sobra em TS só o desempate (`order by active_from desc limit 1` da RPC), que
 * não compara data nenhuma com "hoje".
 */
async function contextoDoContrato(
  supabase: ClienteDoServidor,
  contractId: string,
): Promise<{ iana: string | null; teacherId: string | null } | { erro: string }> {
  const { data, error } = await supabase
    .from('contracts')
    .select(
      'teacher_id, students!contracts_student_id_fkey(iana_tz), recurring_slots(iana_tz, active_from)',
    )
    .eq('id', contractId)
    .lte('recurring_slots.active_from', 'today')
    .or('active_to.is.null,active_to.gte.today', { referencedTable: 'recurring_slots' })
    .maybeSingle()
  if (error) return { erro: error.message }
  if (!data) return { iana: null, teacherId: null }
  const linha = data as {
    teacher_id?: string | null
    students?: { iana_tz?: string | null } | { iana_tz?: string | null }[] | null
    recurring_slots?: { iana_tz?: string | null; active_from?: string | null }[] | null
  }
  const slot = [...(linha.recurring_slots ?? [])]
    .filter((s) => s.iana_tz)
    .sort((a, b) => (b.active_from ?? '').localeCompare(a.active_from ?? ''))[0]
  const aluno = Array.isArray(linha.students) ? linha.students[0] : linha.students
  return {
    iana: slot?.iana_tz ?? aluno?.iana_tz ?? null,
    teacherId: linha.teacher_id ?? null,
  }
}

/**
 * O horário cai DENTRO de um bloqueio da professora? (Sol · rodada 2 do A4,
 * grave 4; ampliado na revisão independente do A4 — bloqueador 1.)
 *
 * A rodada 1 corrigiu as frases para dizer que janela JÁ PUBLICADA continua
 * reservável dentro do bloqueio — e isso é verdade. O que ficou de pé é o outro
 * lado: a dona ainda ABRIA compromisso NOVO dentro do próprio bloqueio, e o
 * porteiro só cobria a porta que PUBLICA janela — as duas que criam AULA
 * (avulsa e experimental) passavam direto, com data e hora editáveis e a
 * proteção da grade sendo apenas visual. Bloqueio que não impede a criação de
 * compromisso novo não bloqueia nada. As quatro portas usam este porteiro.
 *
 * INTERVALO, não instante (bloqueador 1): a aula de 60 min que começa 10 min
 * antes do bloqueio INVADE o bloqueio. Com `fimUtc`, a pergunta é de
 * sobreposição — `starts_at_utc < fim` E `ends_at_utc > inicio`, a mesma
 * convenção de borda EXCLUSIVA da seção (no instante exato de `ends_at_utc` o
 * bloqueio já acabou). Sem `fimUtc` (publicação de janela, que é um PONTO na
 * grade — a duração real só se decide quando alguém a consome; ver a dívida da
 * travessia de meia-noite, roteada ao A9), a pergunta segue sendo do instante.
 *
 * O QUE ELE DEVOLVE NÃO INCLUI A NOTA (revisão independente do A4, grave 2): a
 * `note` é o campo onde se escreve "consulta médica da dona", e a frase de
 * recusa termina na barra de endereços. O bloqueio é nomeado pelo PERÍODO, com
 * a mesma grafia do painel (`resumoDoBloqueio`); a nota continua existindo — em
 * "Disponibilidade e bloqueios", que é tela, não URL.
 *
 * Fail-closed: leitura que falha RECUSA (a mesma régua do `removeTeacherBlock`).
 */
async function bloqueioNoHorario(
  supabase: ClienteDoServidor,
  teacherId: string,
  inicioUtc: string,
  fimUtc?: string,
): Promise<{ erro: string } | { bloqueado: false } | { bloqueado: true; periodo: string }> {
  const base = supabase
    .from('teacher_availability_exceptions')
    // `note` NÃO é selecionada de propósito: o que não se lê não vaza.
    .select('local_snapshot, starts_at_utc, ends_at_utc')
    .eq('teacher_id', teacherId)
    .eq('kind', 'block')
  const { data, error } = await (fimUtc
    ? base.lt('starts_at_utc', fimUtc).gt('ends_at_utc', inicioUtc)
    : base.lte('starts_at_utc', inicioUtc).gt('ends_at_utc', inicioUtc)
  ).limit(1)
  if (error) return { erro: error.message }
  const linha = (data as
    | { local_snapshot?: string | null; starts_at_utc?: string | null; ends_at_utc?: string | null }[]
    | null)?.[0]
  return linha ? { bloqueado: true, periodo: resumoDoBloqueio(linha) } : { bloqueado: false }
}

/** Recusa quando o horário cai num bloqueio (ou quando não deu para conferir).
 *  Devolve normalmente quando o caminho está livre. `oQue` fecha a frase com o
 *  que a dona precisa saber: nada foi publicado / criado / remarcado — palavra
 *  MINÚSCULA de propósito, para a frase completa continuar sendo UMA só no
 *  varredor de tom (`tests/portal-nav.test.ts`) em vez de virar três fragmentos
 *  soltos, que entrariam lá sem "Falha" na frente. */
async function exigirHorarioForaDeBloqueio(
  p: Porta,
  formData: FormData,
  supabase: ClienteDoServidor,
  teacherId: string,
  inicioUtc: string,
  opcoes: { fimUtc?: string; oQue: 'publicado' | 'criado' | 'remarcado' },
): Promise<void> {
  const r = await bloqueioNoHorario(supabase, teacherId, inicioUtc, opcoes.fimUtc)
  if ('erro' in r)
    return falhar(
      p,
      formData,
      `Falha ao conferir os bloqueios da professora: ${r.erro} — nada foi ${opcoes.oQue}.`,
    )
  if (r.bloqueado)
    await falhar(
      p,
      formData,
      `Falha: esse horário está dentro de um bloqueio da professora${r.periodo ? ` (${r.periodo})` : ''} — ela não atende no período. O motivo do bloqueio está em "Disponibilidade e bloqueios"; remova-o lá se ela for atender mesmo assim. Nada foi ${opcoes.oQue}.`,
    )
}

/* ---------------- duração da aula ------------------------------------------ */

/** Piso e teto: os MESMOS que o banco já impõe ao horário FIXO
 *  (`recurring_slots_duration_sane`, CHECK entre 15 e 480) e que o wizard de
 *  contrato usa (`data/admin/contrato-novo.ts`). Uma régua só na casa.
 *
 *  ESTREITAMENTO DE PRODUTO **RATIFICADO PELO DONO** (29/07/2026): a coluna do
 *  banco aceitaria 1..∞ minutos, então a agenda passa a recusar o que o banco
 *  permite — aula de 5 ou 10 minutos deixou de ser possível por esta tela. Foi
 *  escolha consciente por consistência com a régua que já existia, e não efeito
 *  colateral de validação. Quem quiser reabrir mexe AQUI e no CHECK, juntos. */
const DURACAO_MIN_MINUTOS = 15
const DURACAO_MAX_MINUTOS = 480

/**
 * A DURAÇÃO DA AULA — que é hora paga no extrato da professora.
 *
 * ── O DEFEITO QUE ISTO CONSERTA (revisão independente do A4, grave 1) ───────
 * As duas actions faziam `Number(formData.get('duration_min')) || 45`. A dona
 * digitava 0 (ou apagava o campo para corrigir), a tela mandava zero sem
 * reclamar e `0 || 45` gravava uma aula de 45 MINUTOS — que depois conta 45
 * minutos no extrato. O `||` some: em branco, zero, texto e valor quebrado são
 * RECUSADOS com frase, e o número nunca é inventado pelo caminho.
 *
 * `Number('')` é 0 e `Number(' ')` também: o campo em branco é testado ANTES da
 * conversão, senão ele cairia no ramo "zero" e a frase mentiria sobre o que
 * aconteceu.
 */
async function exigirDuracao(p: Porta, formData: FormData): Promise<number> {
  const cru = String(formData.get('duration_min') ?? '').trim()
  const n = Number(cru)
  if (!cru || !Number.isInteger(n) || n < DURACAO_MIN_MINUTOS || n > DURACAO_MAX_MINUTOS)
    return falhar(
      p,
      formData,
      `Falha: a duração da aula precisa ser um número inteiro de minutos entre ${DURACAO_MIN_MINUTOS} e ${DURACAO_MAX_MINUTOS} — campo em branco e zero não viram 45 minutos em silêncio, porque a duração é hora paga no extrato da professora. Nada foi criado.`,
    )
  return n
}

/* ---------------- janelas (agora moram na agenda) --------------------------- */

export async function publishWindowAction(formData: FormData) {
  await requireAdminId()
  const p = porta(CASA, 'publicar')
  const teacherId = String(formData.get('teacher_id') ?? '')
  const localDate = String(formData.get('local_date') ?? '')
  const localTime = String(formData.get('local_time') ?? '')
  if (!teacherId || !localDate || !localTime)
    await falhar(p, formData, 'Falha: preencha professora, data e hora.')

  // A grade do admin é exibida no fuso do negócio — a hora clicada/digitada
  // vale em Cuiabá (p_iana_tz explícito; Lei 1: nada de conversão implícita).
  // A conferência devolve o INSTANTE, que é o que o porteiro do bloqueio usa.
  const instante = await exigirHoraQueExiste(p, formData, localDate, localTime, BUSINESS_TZ)
  const supabase = await createClient()
  await exigirHorarioForaDeBloqueio(p, formData, supabase, teacherId, instante, {
    oQue: 'publicado',
  })
  // A6/a: a RPC recebe o INSTANTE — `local_date`/`local_time`/snapshot da tabela
  // são derivados lá dentro, na zona de quem publica. `p_iana_tz` continua
  // porque a admin publica em Cuiabá mesmo quando a professora é de outro fuso.
  const { error } = await supabase.rpc('publish_reschedule_window', {
    p_teacher: teacherId,
    p_starts_at_utc: instante,
    p_iana_tz: BUSINESS_TZ,
  })
  if (error) await falhar(p, formData, `Falha: ${fraseDoEncosto(error.message) ?? error.message}`)
  await voltar(p, formData, 'Horário publicado — os alunos da professora já podem remarcar para ele.')
}

export async function cancelWindowAction(formData: FormData) {
  await requireAdminId()
  // Sem gaveta: o balão da janela tem um botão só e nada digitado.
  const p = porta(CASA, 'nenhum')
  const windowId = String(formData.get('window_id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_reschedule_window', { p_window: windowId })
  if (error) await falhar(p, formData, `Falha: ${error.message}`)
  await voltar(p, formData, 'Horário despublicado.')
}

/* ---------------- A3: disponibilidade e bloqueios da professora ------------- */

// Lei 3: quem valida de verdade (posse via `_can_manage_teacher`, ordem da
// janela, existência da professora) e quem audita é o banco — as RPCs da F5
// (`set_weekly_availability` e afins). Aqui só se antecipa o óbvio para UX e
// se traduz o erro; `{ error }` do PostgREST NUNCA é descartado. As frases de
// SUCESSO estão enumeradas em `tom-do-aviso.ts` (a varredura do
// `portal-nav.test.ts` cobra a classificação de cada frase nova).

export async function addWeeklyAvailabilityAction(formData: FormData) {
  await requireAdminId()
  const p = porta(CASA, 'janelaSemanal')
  const teacherId = String(formData.get('teacher_id') ?? '')
  const weekday = String(formData.get('weekday') ?? '')
  const start = String(formData.get('start_local') ?? '')
  const end = String(formData.get('end_local') ?? '')
  if (!teacherId || weekday.trim() === '' || !start || !end)
    await falhar(p, formData, 'Falha: preencha professora, dia da semana e os horários de início e fim.')
  // antecipação do constraint `tw_avail_order` — o erro cru do Postgres em
  // inglês não é recado para a dona ('HH:mm' compara certo como texto)
  if (end <= start) await falhar(p, formData, 'Falha: o fim da janela precisa ser depois do início.')
  // weekday é INTEIRO 0–6 (Sol · rodada 1 do A3, item 13): a action é endpoint
  // público, e `Number(' ')` vale 0 — um envio forjado com espaço viraria
  // "domingo" em silêncio; '7' ou '2.5' também não podem chegar à RPC.
  const weekdayNum = Number(weekday)
  if (!Number.isInteger(weekdayNum) || weekdayNum < 0 || weekdayNum > 6)
    await falhar(p, formData, 'Falha: dia da semana inválido — escolha um dia da lista.')

  // SEM `p_iana_tz`, de propósito: a RPC cai no fuso DA PROFESSORA — a janela
  // semanal nasce no relógio dela (diferente da janela de remarcação, que a
  // admin publica em Cuiabá).
  const supabase = await createClient()
  const { error } = await supabase.rpc('set_weekly_availability', {
    p_teacher: teacherId,
    p_weekday: weekdayNum,
    p_start: start,
    p_end: end,
  })
  if (error) await falhar(p, formData, `Falha: ${error.message}`)
  await voltar(p, formData, 'Janela semanal criada — a grade e os horários ofertáveis já a consideram. ✓')
}

export async function removeWeeklyAvailabilityAction(formData: FormData) {
  await requireAdminId()
  // Sem gaveta: remover é um botão, não um formulário preenchido.
  const p = porta(CASA, 'nenhum')
  const id = String(formData.get('id') ?? '')
  if (!id)
    await falhar(p, formData, 'Falha: a janela a remover não foi identificada — recarregue a página.')
  const supabase = await createClient()
  const { error } = await supabase.rpc('remove_weekly_availability', { p_id: id })
  if (error) await falhar(p, formData, `Falha: ${error.message}`)
  await voltar(p, formData, 'Janela semanal removida.')
}

export async function addTeacherBlockAction(formData: FormData) {
  await requireAdminId()
  const p = porta(CASA, 'bloqueio')
  const teacherId = String(formData.get('teacher_id') ?? '')
  const from = String(formData.get('from') ?? '')
  const to = String(formData.get('to') ?? '')
  const note = String(formData.get('note') ?? '').trim() || null
  if (!teacherId || !from || !to)
    await falhar(p, formData, 'Falha: preencha professora e o período (de/até) do bloqueio.')
  // antecipação do "período invertido" da RPC ('yyyy-LL-dd' compara certo como texto)
  if (to < from)
    await falhar(p, formData, 'Falha: o período está invertido — a data final vem antes da inicial.')

  const supabase = await createClient()
  const { error } = await supabase.rpc('add_teacher_block', {
    p_teacher: teacherId,
    p_from: from,
    p_to: to,
    p_note: note,
  })
  if (error) await falhar(p, formData, `Falha: ${error.message}`)
  await voltar(
    p,
    formData,
    // A FRASE DIZ O QUE A FUNÇÃO FAZ, e só (Sol · rodada 1 do A4, grave 2).
    //
    // ── O QUE MUDOU NELA NO A6 (a frase anterior ficou FALSA, e era verdade) ──
    // Até a migration 97, `add_teacher_block` gravava a exceção e mais nada: a
    // janela de remarcação já publicada continuava reservável dentro do dia
    // bloqueado, e a frase mandava a dona despublicá-la à mão. A migration 98
    // fecha as duas pontas na MESMA transação — o bloqueio cancela as janelas
    // PUBLICADAS do período (A6/f) e a reserva ganhou o cinto do bloqueio
    // criado depois da publicação (A6/e). Continuar ensinando o gesto manual
    // seria mandar a dona trabalhar num buraco que não existe mais.
    //
    // O que a frase continua NÃO prometendo, porque continua sendo verdade:
    // aula já MARCADA não é tocada pelo bloqueio (o destino dela é o tratamento
    // de período), e janela `consumida` já virou aula.
    'Bloqueio criado — a professora para de receber horários NOVOS no período, e os horários de remarcação já publicados nele saíram da oferta. Aulas já marcadas continuam de pé: trate-as em Período ou férias.',
  )
}

export async function removeTeacherBlockAction(formData: FormData) {
  await requireAdminId()
  // Sem gaveta (mesma razão da remoção da janela semanal).
  const p = porta(CASA, 'nenhum')
  const id = String(formData.get('id') ?? '')
  if (!id)
    await falhar(p, formData, 'Falha: o bloqueio a remover não foi identificado — recarregue a página.')
  const supabase = await createClient()
  // ANTECIPAÇÃO, não autorização (Lei 3 preservada — quem autoriza é a RPC).
  //
  // A DÍVIDA DO BANCO QUE ISTO COBRIA FOI FECHADA (A6/g, migration 98): a
  // `remove_teacher_block` passou a recusar `kind <> 'block'` no corpo, então
  // um uuid de `kind='open'` já não é apagado por esta porta nem quando alguém
  // a chama sem passar por aqui (era o furo do painel da professora). Esta
  // leitura FICA porque é ela que dá a frase em português — o `raise` do banco
  // não é recado para a dona — e porque continua sendo fail-closed: leitura que
  // falha RECUSA, nunca segue às cegas.
  const { data: excecao, error: leituraErr } = await supabase
    .from('teacher_availability_exceptions')
    .select('kind')
    .eq('id', id)
    .maybeSingle()
  if (leituraErr)
    await falhar(p, formData, `Falha ao conferir o bloqueio: ${leituraErr.message} — nada foi removido.`)
  if (!excecao || (excecao as { kind?: string }).kind !== 'block')
    await falhar(p, formData, 'Esse registro não é um bloqueio — nada foi removido.')
  const { error } = await supabase.rpc('remove_teacher_block', { p_id: id })
  if (error) await falhar(p, formData, `Falha: ${error.message}`)
  await voltar(p, formData, 'Bloqueio removido — a oferta do período voltou ao normal.')
}

/* ---------------- remarcação a partir da grade ------------------------------ */

/**
 * Issue #85: as recusas de ENCOSTO nomeiam a aula ou a janela no relógio de
 * quem publica (aqui, o do negócio: a admin publica em Cuiabá). A frase sai
 * com a data humana; o resto das recusas segue o caminho de antes.
 */
function fraseDoEncosto(m: string): string | null {
  if (m.includes('encosta na aula marcada'))
    return `esse horário encosta na aula marcada da professora${quandoNaRecusa(m)} — nenhum aluno conseguiria reservar esse horário. Escolha outro.`
  if (m.includes('horário de reposição já publicado'))
    return `esse horário encosta no horário de reposição publicado${quandoNaRecusa(m)} — despublique antes ou escolha outro.`
  return null
}

function friendlyBookError(m: string): string {
  // Issue #85: no remarcar para horário novo a janela é consumida no mesmo ato,
  // então a recusa de aula vizinha fala da AULA, não de reserva de aluno.
  if (m.includes('encosta na aula marcada'))
    return `Esse horário encosta na aula marcada da professora${quandoNaRecusa(m)} — escolha outro.`
  const encosto = fraseDoEncosto(m)
  if (encosto) return encosto.charAt(0).toUpperCase() + encosto.slice(1)
  if (m.includes('acabou de ser publicado'))
    return 'Esse horário acabou de ser publicado para reposição — escolha de novo na lista.'
  if (m.includes('já é o horário da aula')) return 'Esse já é o horário da aula — escolha outro.'
  if (m.includes('não está mais agendada')) return 'Essa aula não está mais agendada — recarregue a página.'
  // Deploy fora de ordem (app novo antes da migration 20261029000200): a RPC
  // ainda não existe no banco, e o PostgREST responde em inglês.
  if (m.toLowerCase().includes('could not find the function'))
    return 'O sistema está terminando uma atualização — tente de novo em alguns minutos. Nada foi alterado.'
  if (m.includes('saldo')) return 'O aluno não tem crédito suficiente para esta remarcação.'
  if (m.includes('não está disponível')) return 'Esse horário acabou de ser tomado — escolha outro.'
  if (m.includes('aviso mínimo')) return 'A aula está perto demais do início para remarcar pelo sistema.'
  if (m.includes('no_overlap') || m.includes('exclusion')) return 'Esse horário conflita com outra aula da professora.'
  if (m.includes('antecedência')) return 'Esse horário está dentro da antecedência mínima da professora — use o "furar antecedência" se for combinado.'
  if (m.includes('14 dias') || m.includes('duas semanas')) return 'O novo horário precisa estar dentro das próximas 2 semanas.'
  return `Não foi possível concluir: ${m}`
}

/** F2 (M1-6/M2-1): lê os toggles de cortesia/bypass dos forms da remarcação. */
function bookExtras(formData: FormData) {
  const courtesy = String(formData.get('cortesia') ?? '') === '1'
  const note = String(formData.get('motivo') ?? '').trim()
  const bypass = String(formData.get('furar') ?? '') === '1'
  return {
    ...(courtesy ? { p_courtesy: true, p_courtesy_note: note || null } : {}),
    ...(bypass ? { p_bypass_lead: true } : {}),
  }
}

/**
 * A PORTA DO REMARCAR — o caminho leva o id da aula, a query leva os dois
 * booleanos.
 *
 * Aqui o destino não vem do formulário nem em parte: o caminho sai do
 * `instance_id` que ESTA action recebeu (conferido contra `ID_NO_CAMINHO`, para
 * um id torto não virar rota), e `cortesia`/`furar` saem dos próprios campos do
 * envio. É por isso que o `na_url` do A4 pôde morrer: quem decide o que fica
 * visível na barra de endereços passou a ser o servidor, e os únicos candidatos
 * são dois booleanos que a página relê para se remontar.
 *
 * Aula não identificada volta para a CASA da seção: sem id não há página de
 * remarcação para onde voltar, e mandar a dona para um endereço inventado
 * engoliria o recado.
 */
function portaDoRemarcar(instance: string, qual: PortaDaAgenda, formData: FormData): Porta {
  const valido = ID_NO_CAMINHO.test(instance)
  return {
    tela: valido ? { tela: 'remarcar', instance } : CASA,
    campos: CAMPOS_DA_PORTA[qual],
    geometria: escolhasDoRemarcar(formData),
    chave: valido ? chaveDoRemarcar(instance) : '',
  }
}

/**
 * A geometria do Remarcar, tirada do PRÓPRIO envio: os dois booleanos das opções
 * e o horário que estava em revisão. Vazio APAGA a chave (ver `falhar`).
 *
 * O `escolha` viaja para a volta de erro cair no passo de revisão daquele
 * horário, e não na lista — é lá que o saldo está re-exposto ao lado do botão
 * que gasta, e mandar a dona reencontrar o horário depois de uma recusa é
 * convidá-la a escolher outro sem querer.
 */
function escolhasDoRemarcar(formData: FormData): Record<string, string> {
  return {
    cortesia: String(formData.get('cortesia') ?? '') === '1' ? '1' : '',
    furar: String(formData.get('furar') ?? '') === '1' ? '1' : '',
    escolha: String(formData.get('escolha') ?? '').trim(),
  }
}

/**
 * ANTECIPAÇÃO do `raise 'cortesia exige motivo (M1-6)'` de `reschedule_class_at`
 * — a invariante é do BANCO e continua sendo dele; aqui só se traduz.
 *
 * Ela ganha importância com o grave 6: o motivo deixou de morar na URL e passou
 * a atravessar o cookie de rascunho, que tem vida curta. Se a dona recarregar a
 * tela depois de o cookie expirar, o campo volta vazio — e é melhor uma recusa
 * que diz isso do que uma cortesia registrada sem justificativa no audit.
 */
async function exigirMotivoDaCortesia(p: Porta, formData: FormData): Promise<void> {
  const courtesy = String(formData.get('cortesia') ?? '') === '1'
  const note = String(formData.get('motivo') ?? '').trim()
  if (courtesy && !note)
    await falhar(
      p,
      formData,
      'Falha: a cortesia exige o motivo — escreva-o em "Opções da administração" e aplique de novo. Nada foi remarcado.',
    )
}

/** Efeitos pós-commit (iguais aos do portal): e-mails, WhatsApp e Google
 * Agenda — best-effort, falha nunca desfaz a remarcação.
 *
 * DEVOLVE se o aviso foi REGISTRADO para envio — não se o aluno foi avisado
 * (Sol · rodada 2 do A5): o que a RPC faz é inserir na `notification_outbox`, e a
 * entrega depende do despacho, do canal e do cadastro. O nome da variável mentia
 * e a frase de sucesso repetia a mentira; os dois foram corrigidos.
 */
async function afterReschedule(
  newInstanceId: string,
  actorUserId: string,
): Promise<{ registrado: boolean }> {
  const admin = createAdminClient()
  try {
    await sendRescheduleEmails(admin, { newInstanceId, actorUserId }, sendEmail)
  } catch (err) {
    console.error('[emails de remarcação falharam]', err)
  }
  // SOL · A1 achado 4 (grave): o `{ error }` desta RPC era descartado. O
  // PostgREST RESOLVE a promessa com erro em vez de lançar, então o `catch`
  // abaixo nunca cobriu esse caso — a fila ficava sem o aviso e a tela dizia,
  // logo em seguida, que o aluno receberia e-mail/WhatsApp. Agora a falha é
  // devolvida a quem chamou, que ajusta a frase (a remarcação em si já está
  // commitada e não se desfaz por causa do aviso).
  let avisoEnfileirado = true
  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('enqueue_reschedule_confirmation', {
      p_instance: newInstanceId,
    })
    if (error) {
      avisoEnfileirado = false
      console.error('[confirmação não enfileirada]', error.message)
    }
    await dispatchOutbox(admin, canaisDoAmbiente())
  } catch (err) {
    avisoEnfileirado = false
    console.error('[confirmação WhatsApp não enfileirada]', err)
  }
  try {
    // A1 — o `error` era descartado. Aqui o silêncio é BENIGNO (a remarcação já
    // está commitada e o sync do Google é best-effort), mas silêncio total
    // apaga a única pista de por que o calendário dela não atualizou. Vai para
    // o log, como os outros dois efeitos pós-commit desta função.
    const { data: inst, error } = await admin
      .from('class_instances')
      .select('teacher_id')
      .eq('id', newInstanceId)
      .maybeSingle()
    if (error) console.error('[gcal sync: falha ao ler a aula nova]', error.message)
    if (inst) syncTeacherCalendarSoon(admin, inst.teacher_id)
  } catch (err) {
    console.error('[gcal sync pós-remarcação]', err)
  }
  return { registrado: avisoEnfileirado }
}

/** A frase da remarcação bem-sucedida — que promete o REGISTRO do aviso, nunca a
 *  entrega (Sol · achado 4 do A1 para o `{error}` descartado; rodada 2 do A5 para
 *  o verbo). O ramo negativo continua vermelho pelo marcador "— mas".
 *
 *  A REMISSÃO É "MENSAGENS" (prova independente L2 do A6): é a palavra que a
 *  dona VÊ na barra lateral (`src/components/admin/nav.ts`) para a rota
 *  `/admin/avisos`. "Confira em Avisos" mandava procurar um item de menu que
 *  não existe — a mesma correção que o A5 já tinha feito nas frases do
 *  desfecho, e que estas duas não tinham recebido. */
function recadoDaRemarcacao(registrado: boolean): string {
  return registrado
    ? 'Aula remarcada. A confirmação para o aluno fica registrada para envio por e-mail (e WhatsApp, quando há número no cadastro dele); se ela saiu, você confere em Mensagens.'
    : 'Aula remarcada — mas o aviso ao aluno NÃO foi registrado para envio. Avise por WhatsApp e confira em Mensagens.'
}

/**
 * "APLICAR" DAS OPÇÕES DA ADMINISTRAÇÃO (cortesia · furar · motivo).
 *
 * ── O DEFEITO QUE ISTO CONSERTA (Sol · rodada 2 do A4, grave 6 — LGPD) ──────
 * O bloco de opções do Remarcar era um `<form method="get">`: tocar em "Aplicar"
 * escrevia os três campos na barra de endereços, e o `motivo` é texto LIVRE —
 * "cirurgia", "luto", "imprevisto familiar". Isso fica no histórico do
 * navegador, no log de acesso do servidor e do Cloudflare, em qualquer captura
 * de tela e no link que ela copia para pedir ajuda. É a mesma classe do grave 5
 * da rodada 1, noutra porta; "é estado da página" defende os BOOLEANOS, não o
 * texto que a dona escreve sobre a vida de alguém.
 *
 * Agora o Aplicar é Server Action: o motivo vai para o cookie de rascunho (sob
 * a chave DAQUELA aula) e a URL leva só `cortesia`/`furar`, que são os dois
 * estados que a página precisa reler para se remontar depois de um F5.
 *
 * MERGE, não substituição: um erro anterior pode ter guardado a data/hora do
 * horário novo no mesmo rascunho (M4) — reaplicar as opções não pode apagá-las.
 */
export async function aplicarOpcoesDaRemarcacaoAction(formData: FormData) {
  await requireAdminId()
  const instance = String(formData.get('instance_id') ?? '').trim()
  // A7: a recusa deixou de ser o último `?msg=` fora da ficha. Sem id não há
  // página de remarcação, então a volta é para a casa da seção, com a frase no
  // cookie — como qualquer outra recusa desta seção.
  const p = portaDoRemarcar(instance, 'remarcarOfertado', formData)
  if (!ID_NO_CAMINHO.test(instance))
    await falhar(
      p,
      formData,
      'Falha: aula não identificada — abra a remarcação de novo pela agenda.',
    )
  const motivo = String(formData.get('motivo') ?? '').trim()

  // MERGE, não substituição (ver o cabeçalho).
  const chave = chaveDoRemarcar(instance)
  const atual = await lerRascunho(chave)
  await gravarRascunho(chave, { ...atual, motivo })

  // Aplicar NÃO é ato concluído: ele existe para GUARDAR a escolha, então não
  // grava recado nenhum e não apaga o rascunho que acabou de escrever.
  redirect(enderecoDaTela(p.tela, geometriaCanonica(p.tela, false, (k) => escolhasDoRemarcar(formData)[k])))
}

/** Remarcar usando uma janela JÁ publicada. */
export async function adminBookWindowAction(formData: FormData) {
  const adminId = await requireAdminId()
  const windowId = String(formData.get('window_id') ?? '')
  const instanceId = String(formData.get('instance_id') ?? '')
  const p = portaDoRemarcar(instanceId, 'remarcarOfertado', formData)
  await exigirMotivoDaCortesia(p, formData)

  const supabase = await createClient()
  const { data: newInstanceId, error } = await supabase.rpc('book_reschedule_window', {
    p_window: windowId,
    p_instance: instanceId,
    ...bookExtras(formData),
  })
  if (error)
    await falhar(p, formData, `Falha: ${friendlyBookError(error.message)}`)

  const { registrado } = await afterReschedule(String(newInstanceId), adminId)
  // O SUCESSO SAI DA TELA DA AULA: ela não existe mais como estava (a remarcação
  // cria uma instância nova), então voltar para `/admin/agenda/remarcar/<id>`
  // seria voltar para uma página que diria "esta aula não está mais agendada".
  await voltar(p, formData, recadoDaRemarcacao(registrado), { destino: CASA })
}

/* ---------------- F2: lote "todas aconteceram" + aulas avulsas -------------- */

// M1-3: só o desfecho POSITIVO em lote — falta/cancelamento continuam unitários.
//
// SOL · A1 achado 16 (grave, dinheiro): o "exige filtro de professora" (S2-7)
// existia SÓ no JSX. Server Action é endpoint público: um envio forjado,
// repetido ou vindo de uma aba velha chegava aqui sem `teacher_id`, virava
// `null`, e a RPC era chamada SEM `p_teacher` — atestando em lote um conjunto
// maior do que a tela confirmou, com efeito em extrato e auditoria.
// A trava agora é do SERVIDOR; o JSX só antecipa.
export async function completeAllPendingAction(formData: FormData) {
  await requireAdminId()
  // Sem gaveta: o lote é uma confirmação, não um formulário preenchido — o que
  // ele leva (professora e IDs) a tela recalcula a cada render.
  const p = porta(CASA, 'nenhum')
  const teacher = String(formData.get('teacher_id') ?? '').trim()
  if (!teacher)
    await falhar(
      p,
      formData,
      'Falha: escolha a professora antes de registrar em lote — o atestado em massa entra no extrato dela e é sempre por professora.',
    )
  // SOL · rodada 3 (grave, dinheiro): a fila congela o "agora" no render, mas
  // a RPC recalculava `now()` no submit — aula que terminasse nesse intervalo
  // entrava no lote sem nunca ter aparecido na tela confirmada. O lote agora
  // viaja com os IDs EXATOS que a tela mostrou; o banco valida um a um e
  // aborta TUDO se a fila mudou (all-or-nothing DA VALIDAÇÃO — o pulo da aula
  // sem apontamento continua existindo depois dela; ver o desfecho abaixo).
  // Set: envio forjado/repetido com ID duplicado não pode deformar a auditoria
  // (o banco também dedupa — Sol · rodada 4; aqui é só a antecipação).
  const ids = [
    ...new Set(
      String(formData.get('instance_ids') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ]
  if (ids.length === 0)
    await falhar(
      p,
      formData,
      'Falha: o lote chegou sem nenhuma aula — recarregue as pendências e confirme de novo.',
    )
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_complete_past_batch', {
    p_teacher: teacher,
    p_instances: ids,
  })
  if (error) await falhar(p, formData, `Falha: ${error.message}`)
  // O DESFECHO REAL, não o pedido (portão de deploy 29/07, bloqueador 1): a
  // função devolve quantas foram REALMENTE concluídas, e a tela já manda só as
  // que têm apontamento. Se ainda assim sobrar diferença — alguém apagou o
  // apontamento entre o render e o submit —, o recado NÃO sai verde: ele conta
  // as duas metades, e o marcador de falha parcial do `tom-do-aviso` (o "— mas")
  // o pinta de vermelho. Verde só quando o número prometido é o número feito.
  const feitas = Number(data)
  const ficaram = ids.length - feitas
  const s = feitas === 1 ? '' : 's'
  if (ficaram > 0)
    await voltar(
      p,
      formData,
      `${feitas} aula${s} registrada${s} como realizada${s} — mas ${ficaram} continua${ficaram === 1 ? '' : 'm'} sem registro, por estar sem apontamento do que foi trabalhado. Registre o apontamento e confirme de novo.`,
    )
  await voltar(p, formData, `${feitas} aula${s} registrada${s} como realizada${s}. ✓`)
}

/** O fim da aula, para o porteiro do bloqueio: a aula ocupa `[início, fim)`. */
function fimDaAula(inicioUtc: string, duracaoMin: number): string {
  return DateTime.fromISO(inicioUtc).plus({ minutes: duracaoMin }).toUTC().toISO()!
}

// M1-1: aula avulsa em contrato existente (extra cobrada / cortesia).
export async function createSingleClassAction(formData: FormData) {
  await requireAdminId()
  const p = porta(CASA, 'avulsa')
  const kind = String(formData.get('kind') ?? '')
  const priceRaw = String(formData.get('price') ?? '').replace(',', '.')
  // A6/b: A CORTESIA NÃO CARREGA PREÇO NEM POR ACIDENTE. Antes esta action
  // mandava o que viesse do formulário, e o banco aceitava — a promessa
  // "cortesia é gratuita" era trava de TELA (o campo de preço é desmontado
  // quando o tipo é cortesia). Agora o banco tem CHECK e recusa na RPC, e um
  // envio forjado com `kind=courtesy&price=150` viraria ERRO em vez de aula
  // gratuita. Zerar aqui é o que faz o erro não chegar à dona por um valor que
  // a tela dela nunca ofereceu.
  const price = kind === 'courtesy' ? null : priceRaw ? Math.round(Number(priceRaw) * 100) : null
  const contrato = String(formData.get('contract_id') ?? '')
  const localDate = String(formData.get('local_date') ?? '')
  const localTime = String(formData.get('local_time') ?? '')
  // GRAVE 1 da revisão independente: a duração é conferida ANTES de qualquer
  // coisa — é ela que decide o intervalo que o porteiro do bloqueio examina, e
  // é ela que vira hora paga.
  const duracao = await exigirDuracao(p, formData)
  const supabase = await createClient()
  // A6/a: A CONVERSÃO É AQUI, E É OBRIGATÓRIA. A RPC recebe o INSTANTE, então a
  // zona do aluno deixou de ser "nice to have para a conferência" e passou a ser
  // insumo do ato: sem ela não há instante para mandar. A escada é a MESMA que a
  // RPC usa para o snapshot (slot vigente → cadastro), resolvida com o "hoje" DO
  // BANCO (ver `contextoDoContrato`).
  const ctx = await contextoDoContrato(supabase, contrato)
  if ('erro' in ctx)
    return falhar(p, formData, `Falha ao conferir o fuso do contrato: ${ctx.erro} — nada foi criado.`)
  if (!ctx.iana)
    return falhar(
      p,
      formData,
      'Falha: não deu para saber em que fuso esta aula acontece — confira se o contrato é particular, está ativo e tem aluno com cidade cadastrada. Nada foi criado.',
    )
  // A hora civil precisa EXISTIR uma vez só no relógio do aluno; o que vai para
  // o banco é o instante que ela devolve.
  const inicio = await exigirHoraQueExiste(p, formData, localDate, localTime, ctx.iana)
  // BLOQUEADOR 1 da revisão independente: a aula nascia EM CIMA do bloqueio. A
  // proteção da grade é só visual e os campos são editáveis — um link salvo
  // `?novo=avulsa&nd=…&nt=…` (ou a data trocada à mão) punha a aula dentro do
  // dia bloqueado. Desde o A6/h a RPC também recusa; isto aqui é a frase em
  // português (com o período do bloqueio) que o `raise` não dá.
  if (ctx.teacherId)
    await exigirHorarioForaDeBloqueio(p, formData, supabase, ctx.teacherId, inicio, {
      fimUtc: fimDaAula(inicio, duracao),
      oQue: 'criado',
    })
  const { error } = await supabase.rpc('admin_create_single_class', {
    p_contract: contrato,
    p_starts_at_utc: inicio,
    p_duration_min: duracao,
    p_kind: kind,
    p_price_cents: price,
  })
  if (error) await falhar(p, formData, `Falha: ${error.message}`)
  await voltar(p, formData, 'Aula avulsa criada — ela entra sozinha nos lembretes e no extrato. ✓')
}

// M1-1: experimental = pessoa nova + contrato leve + aula, num ato só.
export async function createTrialClassAction(formData: FormData) {
  await requireAdminId()
  const p = porta(CASA, 'experimental')
  const priceRaw = String(formData.get('price') ?? '').replace(',', '.')
  const price = priceRaw ? Math.round(Number(priceRaw) * 100) : null
  const iana = String(formData.get('iana_tz') ?? '') || BUSINESS_TZ
  const localDate = String(formData.get('local_date') ?? '')
  const localTime = String(formData.get('local_time') ?? '')
  const teacherId = String(formData.get('teacher_id') ?? '')
  const duracao = await exigirDuracao(p, formData)
  const supabase = await createClient()
  // GRAVE 1: aqui a zona é a MESMA que a RPC recebe (`p_iana_tz` — ela é o
  // CADASTRO da pessoa nova, não um jeito de reconverter o horário), então a
  // conferência é literal: se a hora não existe (ou existe duas vezes) no
  // relógio dela, nada é criado. A6/a: o que vai para o banco é o instante.
  // E a experimental tinha o MESMO buraco da avulsa (bloqueador 1): a professora
  // vem do formulário, e o bloqueio dela não era consultado por ninguém — desde
  // o A6/h a RPC também recusa.
  const inicio = await exigirHoraQueExiste(p, formData, localDate, localTime, iana)
  if (teacherId)
    await exigirHorarioForaDeBloqueio(p, formData, supabase, teacherId, inicio, {
      fimUtc: fimDaAula(inicio, duracao),
      oQue: 'criado',
    })
  const { error } = await supabase.rpc('admin_create_trial_class', {
    p_student_name: String(formData.get('student_name') ?? ''),
    p_iana_tz: iana,
    p_teacher: teacherId,
    p_starts_at_utc: inicio,
    p_duration_min: duracao,
    p_price_cents: price,
  })
  if (error) await falhar(p, formData, `Falha: ${error.message}`)
  await voltar(p, formData, 'Aula experimental criada (com contrato experimental leve). ✓')
}

// F5/M1-4: tratamento de período — bloqueia a oferta e trata as aulas afetadas
// (cancelar com crédito-escola E aviso / convidar a remarcar / só bloquear).
export async function periodTreatmentAction(formData: FormData) {
  await requireAdminId()
  const teacher = String(formData.get('teacher_id') ?? '')
  const de = String(formData.get('from') ?? '')
  const ate = String(formData.get('to') ?? '')
  // A7: o endereço de volta é montado do que ESTA action recebeu — professora e
  // intervalo —, não do `back` que o formulário carregava. A prévia que a dona
  // vê depois é, por construção, a do período que ela acabou de tratar.
  const ondeEstava = { prof: teacher, de, ate }
  const p: Porta = { ...porta({ tela: 'periodo' }, 'periodo'), geometria: ondeEstava }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_period_treatment', {
    p_teacher: teacher,
    p_from: de,
    p_to: ate,
    p_mode: String(formData.get('mode') ?? ''),
    p_note: String(formData.get('note') ?? '').trim() || null,
  })
  if (error) await falhar(p, formData, `Falha: ${error.message}`)
  // avisos saem já (cancelamentos/convites enfileirados pela função)
  try {
    await dispatchOutbox(createAdminClient(), canaisDoAmbiente())
  } catch (err) {
    console.error('[avisos do tratamento de período]', err)
  }
  const r = data as {
    cancelled: number
    invited: number
    credited: number
    refund_blocked: number
  }
  // ── LÁPIDE DA DÍVIDA DO A5 (fechada na migration 99) ─────────────────────
  //
  // Aqui morava esta anotação: «a função devolve só `cancelled` e `invited` —
  // fazer o banco devolver `credited`/`refund_blocked` é migration, e está
  // escrita como dívida do A6». A migration 99 fez exatamente isso, e a frase
  // parou de generalizar.
  //
  // Por que a generalização era MENTIRA DE DINHEIRO, e não imprecisão de
  // estilo: `admin_period_treatment` soma qualquer cancelamento em
  // `v_cancelled`, inclusive a aula que nasceu de crédito antigo sem identidade
  // — nessa, `_refund_for_credit_born_class` volta BLOQUEADA, sem inserir nada
  // no ledger. "3 aulas canceladas com crédito" quando duas creditaram e uma
  // não é, para a dona, três alunos com saldo — e um deles ficou sem, sem
  // ninguém saber qual. Agora o banco conta as duas metades na mesma
  // transação, e os uuids de cada grupo ficam no `audit_log`.
  //
  // O que a frase CONTINUA não prometendo: entrega. Os avisos são registro na
  // outbox; quem despacha é o worker.
  const semCredito = r.refund_blocked > 0
  await voltar(
    p,
    formData,
    semCredito
      ? `Período tratado: oferta bloqueada, ${r.cancelled} aula(s) cancelada(s) e ${r.invited} convite(s) de remarcação — mas ${r.refund_blocked} dela(s) NÃO gerou crédito de reposição (aula que já tinha nascido de um crédito antigo sem identidade); ${r.credited} gerou(aram). Veja quais no histórico de cada aluno e ajuste o crédito em Contratos, no bloco de Créditos. Os avisos ficam registrados para envio; se saíram, você confere em Mensagens.`
      : `Período tratado: oferta bloqueada, ${r.cancelled} aula(s) cancelada(s) — ${r.credited} com crédito de reposição para o aluno — e ${r.invited} convite(s) de remarcação. Os avisos ficam registrados para envio; se saíram, você confere em Mensagens.`,
    { extra: ondeEstava },
  )
}

/** Remarcar para um horário NOVO: a janela do instante nasce (ou é
 * reaproveitada) e é consumida pela aula numa transação só, no banco. */
export async function adminRescheduleNewTimeAction(formData: FormData) {
  const adminId = await requireAdminId()
  const instanceId = String(formData.get('instance_id') ?? '')
  const teacherId = String(formData.get('teacher_id') ?? '')
  const localDate = String(formData.get('local_date') ?? '')
  const localTime = String(formData.get('local_time') ?? '')
  const p = portaDoRemarcar(instanceId, 'remarcarNovo', formData)
  if (!instanceId || !teacherId || !localDate || !localTime)
    await falhar(p, formData, 'Falha: preencha data e hora do novo horário.')
  await exigirMotivoDaCortesia(p, formData)

  // Este caminho PUBLICA uma janela como etapa (e a consome em seguida), então
  // passa pelos mesmos dois porteiros da publicação: hora que existe uma vez só
  // (grave 1) e horário fora de bloqueio (grave 4). Guardar só a porta do painel
  // deixaria a outra aberta — foi assim que o grave 3 nasceu.
  const instante = await exigirHoraQueExiste(p, formData, localDate, localTime, BUSINESS_TZ)
  const supabase = await createClient()
  await exigirHorarioForaDeBloqueio(p, formData, supabase, teacherId, instante, {
    oQue: 'remarcado',
  })
  // Issue #85 (gate Sol da PR #91): antes eram duas chamadas — publicar e
  // depois reservar, com um desfazimento se a reserva falhasse —, e entre elas
  // existia uma oferta publicada que podia ficar órfã. Agora o banco valida,
  // cria (ou reaproveita) a janela do instante, move a aula e audita na MESMA
  // transação: recusa em qualquer passo não deixa janela nenhuma. A aula
  // movida não conta como encosto, e o destino não pode encostar em outra
  // janela publicada.
  const { data: newInstanceId, error } = await supabase.rpc('admin_reschedule_to_new_time', {
    p_instance: instanceId,
    p_starts_at_utc: instante, // A6/a: instante, nunca data+hora civis
    p_iana_tz: BUSINESS_TZ,
    ...bookExtras(formData),
  })
  if (error) await falhar(p, formData, `Falha: ${friendlyBookError(error.message)}`)

  const { registrado } = await afterReschedule(String(newInstanceId), adminId)
  // Mesma razão do outro caminho: a aula remarcada não existe mais como estava.
  await voltar(p, formData, recadoDaRemarcacao(registrado), { destino: CASA })
}

/* ========================================================================== */
/* A5/L3 — A MATRIZ DO DESFECHO (ADR-018) NUMA ACTION SÓ                       */
/* ========================================================================== */

/**
 * Uma escolha da dona, cinco caminhos no banco, e o recado MEDIDO na trilha.
 *
 * ── POR QUE UMA E NÃO TRÊS ──────────────────────────────────────────────────
 * Antes eram três formulários independentes no mesmo balão (`completeClassAction`,
 * `noShowAction`, `CancelForm`), e o desfecho era escolhido pelo botão que ela
 * apertava. Isso escondia a decisão que MOVE DINHEIRO — quem cancelou — dentro de
 * um `<select>` de um `<details>`, e deixava a consequência de cada caminho fora
 * da tela. A matriz do ADR-018 é UMA escolha explícita com a consequência escrita
 * (as frases e a proveniência delas estão em `@/lib/admin/desfecho-da-aula`).
 *
 * ── O GATE DE ESTADO CONTINUA SENDO DO BANCO (Lei 3) ────────────────────────
 * Esta action NÃO relê a situação da aula para decidir se a opção é possível: as
 * guardas são das próprias funções (`complete_class` exige `starts_at <= now` e
 * apontamento; `_mark_no_show` exige `now > starts_at`; as duas exigem
 * `state = 'scheduled'`), e reimplementá-las aqui seria a segunda gramática que a
 * casa proíbe. O que a TELA faz é não oferecer o que o banco recusaria
 * (`opcoesDaSituacao`) — antecipação, não autorização —, e o que esta action faz é
 * TRADUZIR a recusa para frase de gente.
 *
 * ── O RECADO DE SUCESSO É LIDO, NÃO AFIRMADO ────────────────────────────────
 * Nos dois caminhos em que o dinheiro VARIA — falta da professora e cancelamento
 * — o `audit_log` é lido antes de escrever a frase (`credited`, `expires_on`,
 * `refund_blocked`), porque `_refund_for_credit_born_class` volta SEM creditar
 * quando o gasto não tem identidade. Nos outros dois (realizada e falta do
 * aluno) não há o que medir: `complete_class` não toca `makeup_ledger` e o ramo
 * de crédito de `_mark_no_show` só abre para a professora — ali a frase é
 * consequência do corpo da função, e uma ida a mais ao banco só criaria um modo
 * de falha novo ("não deu para ler") sem responder pergunta nenhuma.
 *
 * ── O DESFECHO VOLTA NO COOKIE DA SEÇÃO, NOS DOIS RAMOS ─────────────────────
 * A5: esta action nasceu com um par PRÓPRIO de transporte (`backComRecado` /
 * `falhouComRecado`) porque o `falhou()` compartilhado publicava a frase em
 * `?msg=` — e `fraseDaRecusaDoDesfecho` cai, por desenho, no texto CRU do banco
 * quando nada casa (nome de constraint, nome de função, trecho de SQL). Aquilo
 * acabaria na barra de endereços, no histórico e no log de acesso, num endereço
 * que a dona pode colar num WhatsApp pedindo ajuda.
 *
 * A7: o par próprio MORREU, e não por economia de linhas — o que ele fazia
 * (lista de campos do servidor, chave derivada, destino reconstruído) virou o
 * transporte de TODAS as portas desta seção, no topo do arquivo. A porta do
 * desfecho é a única que passa `ev` explicitamente: o balão que reabre é o da
 * aula que ESTA action recebeu, nunca o que o formulário pediu.
 *
 * ⚠️ E O FALL-THROUGH AO TEXTO CRU DO BANCO PODE FICAR: com a frase num cookie
 * `httpOnly`, "feio mas honesto" não vaza para endereço, histórico nem log. Quem
 * for "consertar" isso mandando a frase de volta para a URL está reabrindo o
 * grave 3 do A8 — o crivo é o VEÍCULO, não o texto.
 */

/**
 * A porta do desfecho: os campos são `CAMPOS_DO_DESFECHO` (lista do módulo de
 * vocabulário, a mesma de que o `manter` era derivado — o varredor de campos
 * fora da lista fica verde por CONSTRUÇÃO), e o destino é a casa da seção.
 */
const portaDoDesfecho = (instance: string): Porta => ({
  tela: CASA,
  campos: CAMPOS_DO_DESFECHO,
  // O `ev` do destino sai do `instance` que ESTA action recebeu — e quando ela
  // não conseguiu identificar a aula, o valor VAZIO apaga a chave: nenhum balão
  // reabre, e nada é gravado sob a identidade de outra aula.
  geometria: { ev: instance },
  chave: instance ? chaveDoDesfecho(instance) : '',
})

/**
 * As recusas conhecidas das três RPCs, em frase de gente.
 *
 * Cada `raise` traduzido foi lido no corpo efetivo da função (ver a tabela em
 * `@/lib/admin/desfecho-da-aula`); o que não casa cai no texto do banco, que é
 * feio mas honesto.
 */
function fraseDaRecusaDoDesfecho(m: string, escolha: Desfecho): string {
  if (m.includes('sem apontamento'))
    return 'Falha: diga o que foi trabalhado — escolha um tema na lista (ou a professora aponta o módulo do plano no painel dela).'
  // A RECUSA SÓ OFERECE O QUE ESTA TELA PERMITE AGORA (revisão independente do
  // A5, médio 5). Ela dizia "registre a falta", e a matriz só mostra falta DEPOIS
  // que a aula termina (regra da casa) — numa aula em andamento a dona ficava
  // presa entre duas frases do mesmo lote. Os dois caminhos reais são: informar a
  // hora do aviso (se ele precedeu o início) ou esperar o fim.
  if (m.includes('já começou e o aviso não a precedeu'))
    return 'Falha: esta aula já começou, e cancelar exige um aviso ANTERIOR ao início. Se o aviso chegou antes, informe a hora dele no campo. Se ninguém apareceu, espere a aula terminar: aí a matriz oferece falta do aluno e falta da professora. Nada foi cancelado.'
  if (m.includes('notified_at no futuro'))
    return 'Falha: a hora do aviso está no futuro — informe quando o aviso realmente chegou. Nada foi cancelado.'
  // A guarda do BANCO é "ainda não começou" (`_mark_no_show`: `now() <=
  // starts_at`); a régua da TELA é mais estreita e espera o FIM. A frase diz as
  // duas coisas sem trocar a autoria de uma pela da outra.
  if (m.includes('ainda não começou'))
    return 'Falha: esta aula ainda não começou — realizada e falta são retrospectivas, e nesta tela elas aparecem só depois que a aula TERMINA (regra da casa, para ninguém atestar aula em andamento). Até lá, o que dá para fazer é cancelar.'
  if (m.includes('não está agendada') || m.includes('já tem desfecho'))
    return 'Falha: esta aula já tem desfecho registrado — recarregue a agenda para ver o estado atual dela.'
  if (m.includes('não nasceu de crédito'))
    return 'Falha: o estorno do crédito desta aula não pôde ser calculado — confira o extrato de créditos do aluno na ficha dele. Nada foi registrado.'
  // As DUAS RPCs exigem `contract_type = 'private_1on1'`
  // (`cancel_class só se aplica a contratos private_1on1` em
  // `_cancel_class_core`; `no-show só se aplica a contratos private_1on1` em
  // `_mark_no_show`). Sem tradução isto caía no texto cru: "private_1on1" é
  // vocabulário de coluna, não de gente — e é uma recusa que a dona pode
  // encostar de verdade, porque a mesma grade mostra aula de mentoria.
  if (m.includes('private_1on1'))
    return 'Falha: esta matriz registra desfecho só de aula particular 1:1. Sessão de mentoria em grupo se trata na tela de Mentoria, que tem as regras de vaga e de crédito dela. Nada foi alterado nesta aula.'
  // Frase INTEIRA em cada ramo, nunca montada por pedaço: é a frase completa que
  // o `tomDoAviso` classifica, e pedaço solto no varredor de frases
  // (`tests/portal-nav.test.ts`) esconde justamente o que precisa ser conferido.
  if (ehCancelamento(escolha)) return `Falha: ${m} Nada foi cancelado.`
  return `Falha: ${m}`
}

/**
 * O QUE O SISTEMA GARANTE SOBRE O AVISO — e nada além disso (Sol · rodada 2).
 *
 * A rodada 1 corrigiu `CONSEQUENCIA` (a frase da matriz, ANTES do ato) e esqueceu
 * os três recados de sucesso (DEPOIS do ato), que continuavam dizendo "o aluno é
 * avisado". Pior: esta action NÃO chama `dispatchOutbox` — ela chama a RPC, que
 * INSERE em `notification_outbox` (`_enqueue_class_cancelled`, com
 * `on conflict do nothing`), e redireciona. Quem despacha é o worker/o cron.
 * Então nem "dispara" servia: o que aconteceu, de verdade, é que o aviso ficou
 * REGISTRADO para envio.
 *
 * Proibido nas frases desta família: "é avisado", "recebe", "recebeu", "chegou" —
 * e também "outbox"/"fila", que são jargão nosso, não vocabulário da dona.
 *
 * A remissão é a tela de AVISOS (`/admin/avisos`, rotulada "Mensagens" no menu —
 * o nome da TELA é Avisos), e ela mostra se o aviso SAIU (`sent_at` é aceite do
 * provedor), não se chegou. A frase promete exatamente isso.
 */
const ENTREGA_DO_AVISO =
  'O aviso do cancelamento fica REGISTRADO para envio: e-mail sempre, e WhatsApp quando há número no cadastro dele. Se ele saiu, você confere em Mensagens.'

/**
 * …E DESDE O A6 A DONA ESCOLHE OS CANAIS — então a frase de sucesso não pode
 * continuar dizendo "e-mail sempre" (A5 outra vez, do outro lado: a promessa
 * que era verdade até a migration 99 vira mentira no minuto em que ela
 * desmarca a caixa).
 *
 * Cada ramo é UMA frase inteira, nunca pedaço somado a outro — a mesma razão
 * dos recados de crédito logo abaixo: quem classifica a cor é `tomDoAviso`
 * sobre a frase completa, e o varredor de `tests/portal-nav.test.ts` lê os
 * literais deste módulo um a um.
 *
 * O ramo "nenhum" é ACERTO, e é de propósito: o ato aconteceu exatamente como
 * ela pediu. O que ele não pode é ficar mudo — a aula sumiu da agenda de um
 * aluno que não foi avisado, e é ela quem vai falar com ele.
 *
 * ⚠️ "NA AGENDA DELE" SÓ EXISTE PARA QUEM TEM AGENDA (revisão independente do
 * A6, menor 1). "Ele descobre a aula cancelada sozinho, na agenda dele" é falso
 * para o aluno SEM acesso ao portal — que é justamente o aluno de quem a tela
 * mais fala nesta família de frase. Cada ramo que dizia isso ganhou a variante
 * honesta, escolhida pelo mesmo `temLogin` que já viaja no envio.
 */
const ENTREGA_SO_EMAIL =
  'O aviso do cancelamento fica REGISTRADO para envio por e-mail; você escolheu não avisar por WhatsApp. Se ele saiu, você confere em Mensagens.'

const ENTREGA_SO_WHATSAPP =
  'O aviso do cancelamento fica REGISTRADO para envio por WhatsApp, quando há número no cadastro dele; você escolheu não avisar por e-mail. Se ele saiu, você confere em Mensagens.'

const ENTREGA_NENHUMA =
  'Nenhum aviso do cancelamento ficou registrado: você escolheu não avisar o aluno. Ele descobre a aula cancelada sozinho, na agenda dele — combine a conversa.'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * MARCAR A CAIXA NÃO É AVISAR (Sol · rodada 2 do A6 — a frase segue a ENTREGA)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * As quatro frases acima leem só a ESCOLHA. E a caixa não é desabilitada de
 * propósito (régua da casa: controle desabilitado não diz por quê), então
 * marcar um canal que não tem para onde ir é gesto possível — e o que ele
 * produz, medido em `_enqueue_class_cancelled`, é DIFERENTE em cada canal:
 *
 *   · E-MAIL sem login → a linha NASCE, com `recipient_profile_id` NULL
 *     (decisão de desenho mantida: o silêncio acontece no despacho). Ela fica
 *     em Mensagens esperando alguém — não é envio, é pendência;
 *   · WHATSAPP sem número → o insert está dentro de
 *     `if p_notify_whatsapp and coalesce(v_wa, false)`: NADA nasce. Dizer
 *     "fica REGISTRADO para envio por WhatsApp" ali é afirmar uma linha que
 *     não existe.
 *
 * Por isso a frase passou a ler a ESCOLHA × a ENTREGABILIDADE que a tela
 * conhecia (`CAMPO_DA_ENTREGA`), e cada combinação continua sendo UMA frase
 * inteira — nunca pedaço somado a outro: quem classifica a cor é `tomDoAviso`
 * sobre a frase completa, e o varredor de `tests/portal-nav.test.ts` lê os
 * literais deste módulo um a um.
 *
 * ── TOM, RECONTADO (revisão independente do A6, M1 — a classe do "verde sobre
 * aluno não avisado") ───────────────────────────────────────────────────────
 * A contagem escrita aqui dizia "os TRÊS ramos em que ela marcou e nada chega
 * saem VERMELHOS", e ela estava errada: os três que tinham marcador eram os
 * dois PARCIAIS (um canal chega, o outro não) mais o `NADA_CHEGA`. Os dois em
 * que ela marcou um canal e NADA chegou ao aluno — `ENTREGA_EMAIL_ORFAO_SO` e
 * `ENTREGA_SO_WHATSAPP_SEM_NUMERO` — não tinham marcador nenhum e saíam
 * VERDES, com o ✓ da casa, porque a frase que os carrega abre com "Aula
 * cancelada", que é prefixo de sucesso enumerado. Severidade invertida: os
 * únicos dois ramos em que o aluno fica sem saber eram os únicos dois que
 * pareciam ter dado certo.
 *
 * A conta certa, agora: dos DOZE estados possíveis (as 4 combinações de caixa
 * × os 3 de entregabilidade), CINCO saem vermelhos — todos aqueles em que ela
 * MARCOU pelo menos um canal e algum recado marcado não foi registrado. Os
 * outros sete são acerto: ou tudo o que ela pediu foi registrado, ou ela não
 * pediu nada (aí a frase não fica muda, mas o ato aconteceu como ela quis).
 * O marcador é sempre parte da frase inteira (`— mas `, `não foi`), nunca
 * pedaço somado — é a mesma régua do estorno bloqueado logo abaixo.
 *
 * ── E A ATRIBUIÇÃO É NEUTRA QUANDO NÃO FOI ESCOLHA DELA (menor 2) ───────────
 * "Você escolheu não avisar por WhatsApp" é FALSO quando a caixa nasceu
 * desmarcada porque não havia número (ou porque o aluno não tem portal): ela
 * não escolheu nada — a tela escolheu por ela, e com razão. A distinção é
 * mecânica: canal desligado COM entregabilidade de pé é escolha dela (a caixa
 * nasceu marcada e ela desmarcou); canal desligado SEM entregabilidade é a
 * tela, e aí a frase diz o FATO ("não há número no cadastro dele") em vez de
 * atribuir a ela uma decisão que não foi tomada.
 *
 * ── UMA COMBINAÇÃO MORREU: `ENTREGA_EMAIL_ORFAO_WHATSAPP_OK` (menor 5) ──────
 * Ela descrevia "e-mail órfão + WhatsApp entregue", que não existe: sem login
 * não há perfil, e sem perfil não há número — `entrega_email = '0'` IMPLICA
 * `entrega_whatsapp = '0'` (ver `CAMPO_DA_ENTREGA` e o cálculo do campo em
 * `ConfirmarDesfecho`). A frase ficava no módulo prometendo um estado que
 * nenhum cadastro alcança.
 */
const ENTREGA_EMAIL_OK_WHATSAPP_SEM_NUMERO =
  'O aviso do cancelamento fica REGISTRADO para envio por e-mail — mas o WhatsApp você marcou e não há número no cadastro dele, então nada foi registrado por lá. Se o e-mail saiu, você confere em Mensagens.'

/** e-mail marcado e entregue; WhatsApp desligado porque não há número (a caixa
 *  nasceu assim — nada a atribuir a ela). ACERTO: o que ela pediu, saiu. */
const ENTREGA_SO_EMAIL_SEM_NUMERO =
  'O aviso do cancelamento fica REGISTRADO para envio por e-mail. Por WhatsApp não há número no cadastro dele, então não havia o que registrar por lá. Se o e-mail saiu, você confere em Mensagens.'

const ENTREGA_EMAIL_ORFAO_SO =
  'Nada chega ao aluno por aqui — mas o cancelamento está registrado: o e-mail que você marcou ficou SEM destinatário, porque este aluno não tem acesso ao portal (a linha só espera conferência em Mensagens), e sem perfil não há número para o WhatsApp. Combine a conversa com ele.'

const ENTREGA_NADA_CHEGA =
  'Nada chega ao aluno por aqui — mas o cancelamento está registrado: sem acesso ao portal o e-mail fica sem destinatário (a linha só espera conferência em Mensagens), e sem número no cadastro o aviso por WhatsApp nem é registrado. Combine a conversa com ele.'

const ENTREGA_SO_WHATSAPP_SEM_NUMERO =
  'O aviso por WhatsApp não foi registrado — não há número no cadastro dele —, e por e-mail você escolheu não avisar: nada chega ao aluno por aqui, embora o cancelamento esteja registrado. Ele descobre a aula cancelada sozinho, na agenda dele — combine a conversa.'

/** …o mesmo ramo para o aluno SEM portal: ali o e-mail não foi escolha dela (a
 *  caixa nasceu desmarcada) e ele não tem agenda onde descobrir sozinho. */
const ENTREGA_SO_WHATSAPP_SEM_PORTAL =
  'O aviso por WhatsApp não foi registrado — este aluno não tem acesso ao portal, e sem perfil não há número no cadastro. Por e-mail também não havia destinatário. O cancelamento está registrado, mas nada chega até ele: o recado vai por você.'

/** nada marcado, sem número: o e-mail foi escolha dela, o WhatsApp não era
 *  possível. ACERTO (ela não pediu recado nenhum), mas nunca mudo. */
const ENTREGA_NENHUMA_SEM_NUMERO =
  'Nenhum aviso do cancelamento ficou registrado: por e-mail você escolheu não avisar, e não há número no cadastro dele para o WhatsApp. Ele descobre a aula cancelada sozinho, na agenda dele — combine a conversa.'

/** nada marcado, sem portal: as DUAS caixas nasceram desmarcadas, então não há
 *  escolha dela para narrar — e não há agenda onde ele descubra sozinho. */
const ENTREGA_NENHUMA_SEM_PORTAL =
  'Nenhum aviso do cancelamento ficou registrado: este aluno não tem acesso ao portal e não há número no cadastro dele, então não havia por onde avisar. Ele não vê a aula sair da agenda — o recado chega por você.'

/** O que a TELA sabia sobre a entrega — `null` = ela não sabe (aula de grupo). */
interface EntregaConhecida {
  email: boolean | null
  whatsapp: boolean | null
}

/**
 * A leitura dos dois campos escondidos. Valor fora de `'1'`/`'0'` (campo
 * ausente, formulário de outra tela, envio forjado) vira `null` — "não sei", que
 * é o mesmo tratamento da aula de grupo e mantém a frase com a hedge de sempre.
 */
function entregaDoFormulario(formData: FormData): EntregaConhecida {
  const ler = (campo: string): boolean | null => {
    const v = String(formData.get(campo) ?? '')
    return v === '1' ? true : v === '0' ? false : null
  }
  return { email: ler(CAMPO_DA_ENTREGA.email), whatsapp: ler(CAMPO_DA_ENTREGA.whatsapp) }
}

/**
 * A frase da entrega: a ESCOLHA dela × o que a tela sabia da ENTREGABILIDADE.
 *
 * A árvore é por ESCOLHA primeiro (marcou os dois / só e-mail / só WhatsApp /
 * nenhum) e, dentro de cada ramo, por entregabilidade — porque é a escolha que
 * decide de quem é a frase: canal desligado com entregabilidade de pé é decisão
 * DELA e a frase diz isso; canal desligado sem entregabilidade é a tela, e a
 * frase conta o fato.
 *
 * `semPortal` IMPLICA `semNumero` (sem login não há perfil, e o número mora no
 * perfil) — é o que faz o ramo do e-mail órfão nunca ter WhatsApp entregue.
 * "Não sei" (aula de grupo, `null`) NUNCA vira "não": só o `false` explícito
 * muda a frase, e nesse caso valem as frases com a hedge de sempre.
 */
function entregaDoAviso(
  canais: { email: boolean; whatsapp: boolean },
  entrega: EntregaConhecida = { email: null, whatsapp: null },
): string {
  const semPortal = entrega.email === false
  const semNumero = entrega.whatsapp === false

  if (canais.email && canais.whatsapp) {
    if (semPortal) return ENTREGA_NADA_CHEGA
    if (semNumero) return ENTREGA_EMAIL_OK_WHATSAPP_SEM_NUMERO
    return ENTREGA_DO_AVISO
  }
  if (canais.email) {
    if (semPortal) return ENTREGA_EMAIL_ORFAO_SO
    if (semNumero) return ENTREGA_SO_EMAIL_SEM_NUMERO
    return ENTREGA_SO_EMAIL
  }
  if (canais.whatsapp) {
    if (semPortal) return ENTREGA_SO_WHATSAPP_SEM_PORTAL
    if (semNumero) return ENTREGA_SO_WHATSAPP_SEM_NUMERO
    return ENTREGA_SO_WHATSAPP
  }
  if (semPortal) return ENTREGA_NENHUMA_SEM_PORTAL
  if (semNumero) return ENTREGA_NENHUMA_SEM_NUMERO
  return ENTREGA_NENHUMA
}

/**
 * ONDE SE FAZ O AJUSTE MANUAL DE CRÉDITO — e não é na ficha do aluno.
 *
 * ── O DEFEITO (revisão independente do A5, grave 1) ─────────────────────────
 * As duas frases de estorno bloqueado mandavam "faça o ajuste manual no extrato
 * de créditos, na ficha do aluno". Na ficha o Extrato é SOMENTE LEITURA
 * (append-only, Lei 2) e o único gesto de lá é "Estender validade". Quem lança
 * crédito à mão é `admin_makeup_adjust`, e a porta dela é o "Ajustar" do bloco
 * de Créditos do CONTRATO (`src/components/admin/contratos/detalhe.tsx`, painel
 * `?painel=credito`). A dona ficava caçando um botão que não existe, no minuto
 * em que o aluno está sem o crédito dele.
 *
 * Sem link: o recado é texto (o `AvisoLegado` pinta string, não HTML) e esta
 * action não tem o id do contrato em mãos — inventar rota seria trocar um
 * endereço errado por outro. O caminho vai em palavras, com os rótulos que ela
 * lê na tela.
 */
const ONDE_AJUSTAR_CREDITO =
  'Para devolver o crédito, vá em Contratos, abra o contrato do aluno e use "Ajustar" no bloco de Créditos (o motivo é obrigatório e fica auditado).'

/**
 * E O ALUNO JÁ FOI INFORMADO DE QUE NÃO HÁ CRÉDITO (mesma revisão, segunda
 * metade do grave 1).
 *
 * `_cancel_class_core` chama `_enqueue_class_cancelled(p_instance, v_credited,
 * v_expires)` DEPOIS do ramo do crédito, e no caminho bloqueado `v_credited` é
 * `false` — o aviso de cancelamento sai com `'credited', false` no payload. Ou
 * seja: a dona conserta o saldo e o aluno já leu que não ganhou crédito. Ela
 * precisa saber disso para falar com ele.
 *
 * Vale SÓ para o cancelamento: `_mark_no_show` não enfileira nada, então na
 * falta da professora não há aviso nenhum a corrigir.
 */
const AVISO_JA_DISSE_SEM_CREDITO =
  'Atenção: o aviso que saiu para o aluno diz que NÃO houve crédito — depois de ajustar, fale com ele.'

/**
 * …e o mesmo alerta na ponta OPOSTA (A6/lote 2): quando nenhum canal foi
 * marcado, NENHUM aviso foi registrado, e a frase acima estaria afirmando um
 * envio que não existe. O que continua verdadeiro é o dever de falar com ele —
 * agora sem intermediário nenhum.
 *
 * A ATRIBUIÇÃO SAIU DA FRASE (revisão independente do A6, menor 2): ela dizia
 * "você escolheu não avisar o aluno", e isso é falso no caso em que as duas
 * caixas NASCERAM desmarcadas — aluno sem acesso ao portal, em que a tela
 * decidiu por ela. A frase neutra cobre os dois casos sem trocar a decisão de
 * ninguém: o que importa aqui é que nada foi registrado, e não de quem foi a
 * escolha.
 */
const AVISO_NENHUM_SEM_CREDITO =
  'Atenção: nenhum aviso foi registrado para o aluno — o crédito e o cancelamento chegam por você.'

/**
 * …e o TERCEIRO estado, que a rodada 2 do Sol abriu: ela MARCOU o canal e ele
 * não tem para onde ir (e-mail sem login, WhatsApp sem número). Dizer "você
 * escolheu não avisar" seria trocar a decisão dela por outra; dizer "o aviso já
 * saiu dizendo que não houve crédito" seria afirmar um envio que não existe.
 */
const AVISO_NAO_CHEGA_SEM_CREDITO =
  'Atenção: o aviso que você marcou não tem como chegar a este aluno (sem acesso ao portal e/ou sem número no cadastro) — o crédito e o cancelamento chegam por você.'

function alertaDoAvisoSemCredito(
  canais: { email: boolean; whatsapp: boolean },
  entrega: EntregaConhecida = { email: null, whatsapp: null },
): string {
  const chega =
    (canais.email && entrega.email !== false) || (canais.whatsapp && entrega.whatsapp !== false)
  if (chega) return AVISO_JA_DISSE_SEM_CREDITO
  return canais.email || canais.whatsapp ? AVISO_NAO_CHEGA_SEM_CREDITO : AVISO_NENHUM_SEM_CREDITO
}

/** Data civil do banco → "28/01/2027" (nunca ISO cru numa frase para a dona). */
function validadeEmBr(v: unknown): string {
  const iso = String(v ?? '')
  const d = DateTime.fromISO(iso).setLocale('pt-BR')
  return d.isValid ? d.toFormat('dd/LL/yyyy') : '—'
}

/**
 * O que a TRILHA registrou do ato — a única fonte do que aconteceu com o
 * dinheiro. Erro de leitura NÃO vira "sem crédito": o ato já está commitado e
 * não se desfaz; o que muda é o recado, que admite a dúvida (a mesma lição do
 * A1 nesta função irmã, `cancelClassAction`).
 */
async function trilhaDoDesfecho(
  supabase: ClienteDoServidor,
  acao: string,
  instance: string,
): Promise<{ erro: true } | { erro: false; diff: Record<string, unknown> }> {
  const { data, error } = await supabase
    .from('audit_log')
    .select('diff')
    .eq('action', acao)
    .eq('entity_id', instance)
    .order('id', { ascending: false })
    .limit(1)
    .single()
  if (error) return { erro: true }
  const diff = (data as { diff?: unknown } | null)?.diff
  return { erro: false, diff: (diff ?? {}) as Record<string, unknown> }
}

/**
 * O que a trilha disse do crédito, em três ramos: bloqueado → creditado → nem um
 * nem outro.
 *
 * CADA RAMO É UMA FRASE INTEIRA, e não um pedaço somado a outro. Duas razões:
 *  · quem decide a COR do toast é `tomDoAviso(frase)`, sobre a frase completa —
 *    o ramo bloqueado precisa sair VERMELHO (ato registrado, dinheiro NÃO
 *    devolvido é sucesso parcial, e sucesso parcial não é sucesso), e o marcador
 *    que o garante (`— mas `) só existe se a frase for uma só;
 *  · o varredor de frases (`tests/portal-nav.test.ts`) lê os literais deste
 *    módulo: montagem por pedaço entra lá como fragmento, e fragmento não
 *    permite conferir tom nenhum.
 * O preço é repetir texto entre os dois atos; a alternativa era não poder provar
 * a cor de nenhum deles.
 */
function refundBloqueado(diff: Record<string, unknown>): string {
  return typeof diff.refund_blocked === 'string' ? diff.refund_blocked.trim() : ''
}

function recadoDaFaltaDaProfessora(diff: Record<string, unknown>): string {
  const bloqueio = refundBloqueado(diff)
  if (bloqueio)
    return `Falta da professora registrada — mas o crédito de reposição NÃO foi devolvido automaticamente: ${bloqueio}. ${ONDE_AJUSTAR_CREDITO} A hora não conta no extrato da professora.`
  if (diff.credited === true)
    return `Falta da professora registrada — o aluno GANHOU um crédito de reposição (vale até ${validadeEmBr(diff.expires_on)}). A hora não conta no extrato da professora.`
  return 'Falta da professora registrada — mas a trilha não registrou crédito de reposição para o aluno. Confira o saldo dele na ficha antes de avisar.'
}

function recadoDoCancelamentoPelaProfessora(
  diff: Record<string, unknown>,
  canais: { email: boolean; whatsapp: boolean },
  entrega: EntregaConhecida,
): string {
  const bloqueio = refundBloqueado(diff)
  if (bloqueio)
    return `Aula cancelada a pedido da professora — mas o crédito de reposição NÃO foi devolvido automaticamente: ${bloqueio}. ${ONDE_AJUSTAR_CREDITO} ${alertaDoAvisoSemCredito(canais, entrega)}`
  if (diff.credited === true)
    return `Aula cancelada a pedido da professora — o aluno GANHOU um crédito de reposição (vale até ${validadeEmBr(diff.expires_on)}). A hora não conta no extrato da professora. ${entregaDoAviso(canais, entrega)}`
  return 'Aula cancelada a pedido da professora — mas a trilha não registrou crédito de reposição para o aluno. Confira o saldo dele na ficha antes de avisar.'
}

export async function registrarDesfechoDaAulaAction(formData: FormData) {
  await requireAdminId()

  const instance = String(formData.get('instance_id') ?? '').trim()
  const pd = portaDoDesfecho(instance)
  if (!instance)
    await falhar(pd, formData, 'Falha: aula não identificada — recarregue a agenda e tente de novo.')

  const cru = String(formData.get('desfecho') ?? '').trim()
  // Envio forjado, aba velha ou nenhuma linha marcada caem no mesmo lugar: o
  // vocabulário é fechado, e "desfecho desconhecido" não vira RPC nenhuma.
  if (!ehDesfecho(cru))
    await falhar(pd, formData, 'Falha: escolha o que aconteceu com esta aula — cada opção tem consequência diferente no extrato da professora e no crédito do aluno.',
    )
  const escolha = cru as Desfecho

  const supabase = await createClient()

  /* --------------------------------------------------- realizada ----------- */
  if (escolha === 'realizada') {
    // D2 (20/07): realizada exige apontamento. O formulário oferece o tema
    // avulso; com apontamento prévio da professora o banco ignora os args.
    const { error } = await supabase.rpc('complete_class', {
      p_instance: instance,
      p_off_kind: String(formData.get('off_kind') ?? '') || null,
      p_off_note: String(formData.get('off_note') ?? '') || null,
    })
    if (error)
    await falhar(pd, formData, fraseDaRecusaDoDesfecho(error.message, escolha))
    await voltar(
      pd,
      formData,
      'Aula registrada como realizada. ✓ A hora conta no extrato da professora, e o aluno não ganha crédito.',
    )
  }

  /* --------------------------------------------------- as duas faltas ------ */
  if (escolha === 'falta_aluno' || escolha === 'falta_professora') {
    const daProfessora = escolha === 'falta_professora'
    const { error } = await supabase.rpc(
      daProfessora ? 'no_show_teacher' : 'no_show_student',
      { p_instance: instance },
    )
    if (error)
    await falhar(pd, formData, fraseDaRecusaDoDesfecho(error.message, escolha))
    if (!daProfessora)
      await voltar(
      pd,
        formData,
        'Falta do aluno registrada — a aula conta como dada: a hora conta no extrato da professora, e o aluno não ganha crédito.',
      )
    // A falta da PROFESSORA é a que pode ou não creditar: quem sabe é a trilha.
    const t = await trilhaDoDesfecho(supabase, 'no_show_teacher', instance)
    // `return` e não `await`: `backComRecado` devolve `Promise<never>`, e é o
    // `return` que faz o TypeScript entender que daqui para baixo a leitura da
    // trilha deu certo (a mesma nota do `return falhou(...)` acima).
    if (t.erro)
      return voltar(
      pd,
        formData,
        'Falta da professora registrada, mas não deu para ler se o crédito foi gerado — confira o extrato de créditos do aluno na ficha dele.',
      )
    await voltar(pd, formData, recadoDaFaltaDaProfessora(t.diff))
  }

  /* --------------------------------------------------- os dois cancelamentos */
  const quemPediu = pedidoPor(escolha)
  // Lei 1: a hora que a dona digita é hora LOCAL do negócio, e a conversão é
  // explícita. Valor que não parseia ABORTA — cair no `now()` do banco mudaria a
  // guarda de estado ("o aviso precedeu o início?") em silêncio.
  const avisoCru = String(formData.get('notified_at') ?? '').trim()
  let avisoUtc: string | null = null
  if (avisoCru) {
    const v = veredictoDoAviso(avisoCru)
    if (!v.ok) await falhar(pd, formData, recusaDoAviso(v))
    avisoUtc = v.ok ? v.instanteUtc : null
  }
  // A6/lote 2: a escolha de canais é da DONA, e vai explícita para a RPC. O
  // formulário da matriz sempre a carrega (`canais=1`); envio sem a marca
  // mantém os dois avisos, que é o default do banco.
  const canais = canaisEscolhidos(formData)
  // …e o que a TELA sabia sobre a entrega: é isso que separa "ficou registrado
  // para envio" de "ficou para conferência em Mensagens" (ver `entregaDoAviso`).
  const entrega = entregaDoFormulario(formData)
  const { error } = await supabase.rpc('cancel_class', {
    p_instance: instance,
    p_cancelled_by: quemPediu,
    ...(avisoUtc ? { p_notified_at: avisoUtc } : {}),
    p_notify_email: canais.email,
    p_notify_whatsapp: canais.whatsapp,
  })
  if (error)
    await falhar(pd, formData, fraseDaRecusaDoDesfecho(error.message, escolha))

  // O AVISO AO ALUNO É DECLARADO PELO QUE ELA ESCOLHEU:
  // `_cancel_class_core` termina em `perform _enqueue_class_cancelled(...)`, fora
  // de qualquer `if`, e essa função enfileira o e-mail quando `p_notify_email` e
  // o WhatsApp quando `p_notify_whatsapp` E `profiles.whatsapp_e164 is not null`.
  // Até a migration 99 os dois eram incondicionais e a frase dizia "e-mail
  // sempre"; com a escolha na mão da dona, dizer isso viraria promessa falsa —
  // `entregaDoAviso` conta o que de fato foi registrado.
  if (quemPediu === 'student')
    await voltar(
      pd,
      formData,
      `Aula cancelada a pedido do aluno — sem crédito de reposição: quem decide é quem pediu o cancelamento, em qualquer antecedência (para trocar de horário sem perder a aula, o caminho é remarcar). A hora não conta no extrato da professora. ${entregaDoAviso(canais, entrega)}`,
    )
  const t = await trilhaDoDesfecho(supabase, 'cancel_class', instance)
  if (t.erro)
    return voltar(
      pd,
      formData,
      'Aula cancelada, mas não deu para ler se gerou crédito — confira o saldo do aluno na ficha dele.',
    )
  await voltar(pd, formData, recadoDoCancelamentoPelaProfessora(t.diff, canais, entrega))
}

/* ---------------- F5 (Onda Financeiro): cobrar a aula avulsa no Asaas ------- */

/**
 * A rotina P21 morre aqui: em vez de a dona abrir o painel do Asaas e digitar
 * o UUID da aula à mão, o botão do balão emite a cobrança COM a referência
 * certa de nascença — e espelha na hora, sem esperar webhook.
 *
 * Quem decide é o banco + o núcleo injetável (`emitirCobrancaDaAvulsa`):
 * pagador pronto pela régua única, trava anti-corrida por INSERT, GET antes do
 * POST (a API do Asaas NÃO tem idempotência — fato medido no gate F0), espelho
 * pela MESMA RPC do webhook e audit. Aqui é só auth, formulário e transporte.
 */
export async function cobrarAvulsaAction(formData: FormData) {
  const actorId = await requireAdminId()
  const aulaId = String(formData.get('aula_id') ?? '')
  const dueDate = String(formData.get('due_date') ?? '').trim()
  // O erro reabre o balão DESTA aula (`ev`), com o vencimento digitado de volta.
  const p: Porta = {
    ...porta(CASA, 'cobrar'),
    geometria: { ev: ID_NO_CAMINHO.test(aulaId) ? aulaId : '' },
  }
  if (!ID_NO_CAMINHO.test(aulaId)) await falhar(p, formData, 'Falha: aula inválida.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !DateTime.fromISO(dueDate).isValid)
    await falhar(p, formData, 'Falha: informe o vencimento da cobrança (uma data válida).')
  if (dueDate < DateTime.now().setZone(BUSINESS_TZ).toISODate()!)
    await falhar(p, formData, 'Falha: o vencimento não pode ficar no passado.')

  // `??` porque `await falhar(...)` (Promise<never>) não estreita o tipo — o
  // fluxo nunca volta, mas o TS só enxerga isso na posição de expressão.
  const cfg =
    asaasConfigFromEnv() ??
    (await falhar(
      p,
      formData,
      'Falha: a integração com o Asaas está desligada neste ambiente — emita pelo painel do Asaas com o UUID da aula (rotina P21), ou ligue ASAAS_API_KEY/ASAAS_ENV.',
    ))

  const admin = createAdminClient()

  // Só para a DESCRIÇÃO da fatura (o pagador lê): aluno + dia da aula.
  const { data: aulaCrua } = await admin
    .from('class_instances')
    .select('starts_at_utc, contracts(students!contracts_student_id_fkey(display_name))')
    .eq('id', aulaId)
    .maybeSingle()
  const contrato = Array.isArray(aulaCrua?.contracts) ? aulaCrua?.contracts[0] : aulaCrua?.contracts
  const alunoCru = contrato?.students
  const aluno = (Array.isArray(alunoCru) ? alunoCru[0] : alunoCru)?.display_name ?? null
  const dia = aulaCrua?.starts_at_utc
    ? DateTime.fromISO(aulaCrua.starts_at_utc).setZone(BUSINESS_TZ).toFormat('dd/LL/yyyy')
    : null

  // A frase da FATURA (quem a lê é o pagador) é montada no núcleo — este
  // arquivo só diz recados de tela, e o varredor do tom cobra isso.
  const r = await emitirCobrancaDaAvulsa(admin, cfg, aulaId, { actorId, dueDate, aluno, dia })
  if (!r.ok) await falhar(p, formData, r.frase)
  await voltar(p, formData, r.frase)
}
