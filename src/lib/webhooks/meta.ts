import { createHash, createHmac } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { safeTokenEqual } from '@/lib/auth/token'
import { pedeParaParar } from '@/lib/notify/palavras-de-parada'

// Webhook da Cloud API da Meta (issue #44; ADR-038, "Consequências › No
// webhook" e "Decisões do dono", itens 3, 4 e 5).
//
// GET = verificação da assinatura do webhook na Meta (hub.challenge).
// POST = avisos assinados (X-Hub-Signature-256 = HMAC-SHA256 do corpo CRU com
// o segredo do app). Ordem, e ela importa:
//   1. assinatura conferida ANTES de tudo; sem segredo no ambiente, todo POST
//      é recusado (fail-closed: safeTokenEqual não protege contra vazio);
//   2. o envelope é desmontado em ITENS, cada um uma linha de webhook_inbox
//      com chave natural (Lei 6, UNIQUE(source, event_id)):
//        - recibo   `statuses[i]` → `<wamid>:<status>`, payload = o objeto do
//          recibo + `value.metadata` (nunca o corpo inteiro nem `contacts`:
//          exceção à Lei 6 do ADR-038, decisão 5; a assinatura já foi
//          conferida e não precisa ser reconferida depois);
//        - mensagem `messages[i]` → `<wamid>:message`, payload = o objeto da
//          mensagem inteiro + `value.metadata` (decisão de 31/10/2026, itens 3
//          e 4), mídia só com os ids, sem baixar arquivo. Processada na hora,
//          salvo a de PALAVRA DE PARADA (#127, detector em
//          src/lib/notify/palavras-de-parada.ts), que nasce pendente, com
//          `parada: true` no payload, e passa pelo passo 5;
//        - qualquer outro campo (`account_update`, que é por onde a Meta
//          avisa número caído e nome recusado) → `<campo>:<hash>`, processado
//          na hora. Aviso NEGATIVO da conta entra com `error` (ver
//          `alertaDaConta`): é o que pinta de vermelho o cartão de Ajustes;
//        - envelope fora da forma documentada → `envelope:<hash do corpo>`,
//          inteiro (sem `contacts`), processado: nada assinado se perde;
//   3. TODOS os itens são gravados antes de qualquer efeito. Qualquer escrita
//      na inbox que falhe responde 500 (a Meta reenvia; a reentrega é
//      inofensiva: a chave natural segura a linha e cada efeito é idempotente);
//   4. só então os recibos, reconstruídos do payload GRAVADO (first-write-wins:
//      uma reentrega com outro conteúdo não leva valores novos à RPC):
//      `apply_delivery_receipt` (#42), que casa a linha do outbox sob o
//      advisory do wamid. 'aplicado'/'ignorado' fecham a linha da inbox;
//      'sem_linha' a deixa pendente, e quem grava o id (`outbox_mark_sent`) ou
//      o job de 5 min aplicam depois. RPC que falha vira `error` na linha e
//      200 (a linha pendente é a rede); se nem o erro puder ser anotado, 500;
//   5. as mensagens de parada gravadas, também pelo payload da inbox:
//      `enqueue_student_stop_request` (#127; ADR-038, item 4) enfileira UM
//      e-mail interno por admin, uma vez por wamid. Nada mais: o perfil não
//      muda, quem decide é a admin, pela ficha. Sucesso fecha a linha; falha
//      vira `error` na linha pendente e 200, como nos recibos, e a rede é o
//      pg_cron de 5 min (`meta_retry_pending_stop_requests`, mesma migration),
//      que chama a função de novo pelo payload gravado.

export interface WebhookResult {
  status: number
  body: { ok: boolean; detail?: string }
}

/* ========================================================================== */
/* GET — verificação                                                           */
/* ========================================================================== */

export interface VerificacaoInput {
  mode: string | null
  token: string | null
  challenge: string | null
  /** META_WEBHOOK_VERIFY_TOKEN */
  expectedToken: string | undefined
}

/** 200 com o `hub.challenge` cru, ou 403. Sem token no ambiente, 403 sempre. */
export function handleMetaVerification(input: VerificacaoInput): { status: number; body: string } {
  const { mode, token, challenge, expectedToken } = input
  if (!expectedToken || !token || mode !== 'subscribe' || challenge === null) {
    return { status: 403, body: 'verificação recusada' }
  }
  if (!safeTokenEqual(token, expectedToken)) return { status: 403, body: 'verificação recusada' }
  return { status: 200, body: challenge }
}

/* ========================================================================== */
/* POST — avisos                                                               */
/* ========================================================================== */

export interface MetaWebhookInput {
  /** META_APP_SECRET */
  secret: string | undefined
  /** o cabeçalho X-Hub-Signature-256 */
  signature: string | null
  /** o corpo CRU: a assinatura é sobre os bytes recebidos, não sobre o JSON relido */
  body: string
}

/** `sha256=<hex>` do HMAC-SHA256 do corpo cru com o segredo do app. */
export function assinaturaConfere(secret: string, signature: string | null, body: string): boolean {
  if (!signature || !signature.startsWith('sha256=')) return false
  const esperada = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  return safeTokenEqual(signature.slice('sha256='.length).toLowerCase(), esperada)
}

type Objeto = Record<string, unknown>

/** O que a linha aciona depois de gravada: ela nasce pendente e passa pela RPC. */
type Efeito = 'recibo' | 'parada'

interface Item {
  eventId: string
  payload: Objeto
  /** null = nada a acionar: a linha nasce processada */
  efeito: Efeito | null
  /** aviso negativo da conta: a linha nasce com este erro */
  erro: string | null
}

const INBOX_FORA: WebhookResult = { status: 500, body: { ok: false, detail: 'inbox indisponível' } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ehObjeto = (v: unknown): v is Objeto => typeof v === 'object' && v !== null && !Array.isArray(v)
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex')

/* ---- motivo da falha, em português, para a linha do outbox --------------- */

// Fonte: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
// (códigos conhecidos em 01/11/2026). O texto cru da Meta (title, message,
// error_data) fica inteiro na inbox; o outbox, que a tela de Mensagens mostra,
// recebe a frase da casa com o código entre parênteses (a lista o traduz de
// novo por `motivoDaFalhaNaLista`). Código fora da tabela não se adivinha.
const FRASE_DO_CODIGO: Readonly<Record<string, string>> = Object.freeze({
  '131026': 'mensagem não entregue: o número pode não estar no WhatsApp',
  '131047': 'fora da janela de 24 horas da última mensagem do aluno',
  '131049': 'a Meta segurou para não mandar mensagens demais ao aluno',
  '131050': 'o aluno pediu para não receber mensagens de marketing',
  '132000': 'o número de dados não bate com o modelo aprovado',
  '132001': 'o modelo não existe na Meta nesse idioma',
  '130429': 'limite de envio por segundo da Meta atingido',
  '131000': 'erro interno da Meta',
})

/** A frase do motivo de um recibo `failed` (o primeiro item de `errors`). */
function motivoDe(recibo: Objeto): string | null {
  const [primeiro] = lista(recibo.errors)
  if (!ehObjeto(primeiro)) return null
  const codigo = primeiro.code === undefined || primeiro.code === null ? null : String(primeiro.code)
  if (!codigo) return 'falha na entrega pela Meta (sem código)'
  return `${FRASE_DO_CODIGO[codigo] ?? 'falha na entrega pela Meta'} (código ${codigo})`
}

/* ---- avisos negativos da conta ------------------------------------------- */

// Fonte: https://developers.facebook.com/docs/graph-api/webhooks/reference/whatsapp-business-account/
// (campos `account_update`, `phone_number_name_update`,
// `phone_number_quality_update` e `message_template_status_update`, conferidos
// em 01/11/2026). Só o que diz "o envio vai falhar ou já falha" vira erro; os
// positivos (VERIFIED_ACCOUNT, nome APPROVED, modelo APPROVED, UNFLAGGED…) e
// os neutros seguem como prova de vida.
const EVENTO_NEGATIVO_DA_CONTA: Readonly<Record<string, string>> = Object.freeze({
  DISABLED_UPDATE: 'número ou conta desativados pela Meta',
  ACCOUNT_VIOLATION: 'conta com violação de política na Meta',
  ACCOUNT_RESTRICTION: 'conta restringida pela Meta',
  ACCOUNT_DELETED: 'conta apagada na Meta',
  ACCOUNT_OFFBOARDED: 'conta desligada da Meta',
  PARTNER_REMOVED: 'acesso do app à conta removido na Meta',
})
const QUALIDADE_NEGATIVA: Readonly<Record<string, string>> = Object.freeze({
  FLAGGED: 'qualidade do número em alerta na Meta',
  DOWNGRADE: 'limite de mensagens do número rebaixado pela Meta',
})
const MODELO_NEGATIVO: Readonly<Record<string, string>> = Object.freeze({
  REJECTED: 'recusado',
  PAUSED: 'pausado',
  DISABLED: 'desativado',
})

/** O erro de um aviso negativo da conta, ou null quando o aviso é bom ou neutro. */
function alertaDaConta(campo: string, value: Objeto): string | null {
  const evento = texto(value.event)
  if (campo === 'account_update' && evento && EVENTO_NEGATIVO_DA_CONTA[evento]) {
    return `${EVENTO_NEGATIVO_DA_CONTA[evento]} (${evento})`
  }
  if (campo === 'phone_number_name_update' && texto(value.decision) === 'REJECTED') {
    return 'nome de exibição recusado pela Meta (REJECTED)'
  }
  if (campo === 'phone_number_quality_update' && evento && QUALIDADE_NEGATIVA[evento]) {
    return `${QUALIDADE_NEGATIVA[evento]} (${evento})`
  }
  if (campo === 'message_template_status_update' && evento && MODELO_NEGATIVO[evento]) {
    const nome = texto(value.message_template_name)
    return `modelo de mensagem${nome ? ` ${nome}` : ''} ${MODELO_NEGATIVO[evento]} pela Meta (${evento})`
  }
  return null
}

/* ---- desmonte do envelope ------------------------------------------------- */

/** O vocabulário que `apply_delivery_receipt` (#42) aplica. */
const STATUS_APLICAVEIS: readonly string[] = Object.freeze(['sent', 'delivered', 'read', 'failed'])

/** Tira `contacts` em qualquer nível (ADR-038, decisão 5: o nome de perfil não entra). */
function semContatos(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(semContatos)
  if (!ehObjeto(v)) return v
  const limpo: Objeto = {}
  for (const [k, valor] of Object.entries(v)) if (k !== 'contacts') limpo[k] = semContatos(valor)
  return limpo
}

/**
 * Desmonta o envelope em itens da inbox. Nada do envelope fica de fora: o que
 * não tem a forma documentada vai inteiro (sem `contacts`) numa linha
 * `envelope:<hash do corpo>`.
 */
function desmontar(envelope: Objeto, hashDoCorpo: string): Item[] {
  const itens: Item[] = []
  let foraDaForma = !Array.isArray(envelope.entry)

  for (const entry of lista(envelope.entry)) {
    if (!ehObjeto(entry) || !Array.isArray(entry.changes)) {
      foraDaForma = true
      continue
    }
    for (const change of entry.changes) {
      if (!ehObjeto(change) || !ehObjeto(change.value)) {
        foraDaForma = true
        continue
      }
      const campo = texto(change.field) ?? 'desconhecido'
      const value = change.value
      const metadata = ehObjeto(value.metadata) ? value.metadata : null
      let reconhecidos = 0
      let sobras = 0

      if (campo === 'messages') {
        for (const s of lista(value.statuses)) {
          const wamid = ehObjeto(s) ? texto(s.id) : null
          const status = ehObjeto(s) ? texto(s.status) : null
          if (!ehObjeto(s) || !wamid || !status) {
            sobras += 1
            continue
          }
          reconhecidos += 1
          // status fora do vocabulário (a Meta pode criar um): guardado para
          // auditoria, processado na hora, sem RPC. Nunca casa com o outbox
          // e sai no expurgo de 90 dias (contrato da #42).
          itens.push({
            eventId: `${wamid}:${status}`,
            payload: { status: s, metadata },
            efeito: STATUS_APLICAVEIS.includes(status) ? 'recibo' : null,
            erro: null,
          })
        }
        for (const m of lista(value.messages)) {
          const wamid = ehObjeto(m) ? texto(m.id) : null
          if (!ehObjeto(m) || !wamid) {
            sobras += 1
            continue
          }
          reconhecidos += 1
          // a marca `parada` no payload é o que a rede do pg_cron
          // (`meta_retry_pending_stop_requests`) confere antes de avisar
          const parada = pedeParaParar(textoDaMensagem(m))
          itens.push({
            eventId: `${wamid}:message`,
            payload: parada ? { message: m, metadata, parada: true } : { message: m, metadata },
            efeito: parada ? 'parada' : null,
            erro: null,
          })
        }
        // erro de sistema da Meta vem em `value.errors`, fora dos recibos
        if (lista(value.errors).length) sobras += 1
      }

      // `account_update` (e qualquer aviso que não seja recibo nem mensagem,
      // ou o que sobrou de um `messages` com entrada malformada ou erro de
      // sistema): guardado inteiro, menos `contacts`, processado na hora.
      // Chave: o hash do objeto com o `time` da entrada, que a reentrega
      // repete. Sem `time` (o campo `messages` não o traz), o hash do corpo
      // assinado: a reentrega repete os mesmos bytes, e o mesmo erro de
      // sistema em outro dia (outro corpo) é outra linha.
      if (reconhecidos === 0 || sobras > 0) {
        const guardado = semContatos(value) as Objeto
        const ancora = entry.time !== undefined && entry.time !== null ? { time: entry.time } : { corpo: hashDoCorpo }
        itens.push({
          eventId: `${campo}:${hash({ ...ancora, value: guardado })}`,
          payload: { field: campo, value: guardado },
          efeito: null,
          erro: alertaDaConta(campo, value),
        })
      }
    }
  }

  if (foraDaForma || itens.length === 0) {
    itens.push({
      eventId: `envelope:${hashDoCorpo}`,
      payload: { envelope: semContatos(envelope) },
      efeito: null,
      erro: null,
    })
  }
  return itens
}

/* ---- inbox ---------------------------------------------------------------- */

/**
 * Guarda o item (first-write-wins) e devolve o que ficou GRAVADO (se já está
 * processada e o payload da primeira entrega), ou `null` quando a inbox falhou
 * (o erro cru vai para o log, não para fora).
 */
async function guardar(
  admin: SupabaseClient,
  item: Item,
): Promise<{ processada: boolean; payload: unknown } | null> {
  const { error: erroDoUpsert } = await admin.from('webhook_inbox').upsert(
    {
      source: 'meta',
      event_id: item.eventId,
      payload: item.payload as never,
      ...(item.efeito ? {} : { processed_at: new Date().toISOString() }),
      ...(item.erro ? { error: item.erro } : {}),
    },
    { onConflict: 'source,event_id', ignoreDuplicates: true },
  )
  if (erroDoUpsert) {
    console.error(`[meta] evento ${item.eventId} não gravado na inbox: ${erroDoUpsert.message}`)
    return null
  }
  const { data, error: erroDaLeitura } = await admin
    .from('webhook_inbox')
    .select('processed_at, payload')
    .eq('source', 'meta')
    .eq('event_id', item.eventId)
    .maybeSingle()
  if (erroDaLeitura || !data) {
    console.error(`[meta] evento ${item.eventId} não relido da inbox: ${erroDaLeitura?.message ?? 'linha ausente'}`)
    return null
  }
  const linha = data as { processed_at: string | null; payload: unknown }
  return { processada: linha.processed_at !== null, payload: linha.payload }
}

/** Um UPDATE na linha pendente (recibo ou parada). `false` = a inbox falhou. */
async function atualizarPendente(
  admin: SupabaseClient,
  eventId: string,
  campos: { processed_at?: string; error: string | null },
  soComErro = false,
): Promise<boolean> {
  let q = admin
    .from('webhook_inbox')
    .update(campos)
    .eq('source', 'meta')
    .eq('event_id', eventId)
    .is('processed_at', null)
  if (soComErro) q = q.not('error', 'is', null)
  const { error } = await q
  if (error) console.error(`[meta] evento ${eventId}: linha da inbox não atualizada: ${error.message}`)
  return !error
}

/* ---- recibo --------------------------------------------------------------- */

interface Recibo {
  eventId: string
  wamid: string
  status: string
  motivo: string | null
  tentativa: string | null
}

/** O recibo reconstruído do payload GRAVADO na inbox (nunca da reentrega). */
function reciboGravado(eventId: string, payload: unknown): Recibo | null {
  const s = ehObjeto(payload) && ehObjeto(payload.status) ? payload.status : null
  const wamid = s ? texto(s.id) : null
  const status = s ? texto(s.status) : null
  if (!s || !wamid || !status) return null
  const opaco = texto(s.biz_opaque_callback_data)
  return {
    eventId,
    wamid,
    status,
    motivo: status === 'failed' ? motivoDe(s) : null,
    tentativa: opaco && UUID.test(opaco) ? opaco : null,
  }
}

/** Aplica o recibo. `false` = uma escrita na inbox falhou (a resposta é 500). */
async function aplicarRecibo(admin: SupabaseClient, eventId: string, payload: unknown): Promise<boolean> {
  const r = reciboGravado(eventId, payload)
  if (!r) return atualizarPendente(admin, eventId, { error: 'recibo gravado sem id ou sem status' })
  const { data, error } = await admin.rpc('apply_delivery_receipt', {
    p_provider: 'meta',
    p_provider_message_id: r.wamid,
    p_status: r.status,
    p_error: r.motivo,
    p_attempt_id: r.tentativa,
  })
  // RPC falhou: o motivo fica na linha pendente (a rede) e a resposta segue
  // 200; só se nem o motivo puder ser anotado a Meta precisa reenviar
  if (error) return atualizarPendente(admin, eventId, { error: `recibo não aplicado: ${error.message}` })
  // o wamid ainda não está no outbox: fica pendente, sem erro (sai o de uma
  // reentrega anterior em que a RPC falhou); outbox_mark_sent aplica depois
  if (data === 'sem_linha') return atualizarPendente(admin, eventId, { error: null }, true)
  return atualizarPendente(admin, eventId, { processed_at: new Date().toISOString(), error: null })
}

/* ---- palavra de parada (#127) ------------------------------------------- */

/** O corpo de uma mensagem de texto; mídia e botão não têm texto. */
function textoDaMensagem(m: Objeto): string | null {
  return ehObjeto(m.text) ? texto(m.text.body) : null
}

/**
 * Avisa a admin pela função SQL, com a mensagem reconstruída do payload
 * GRAVADO (first-write-wins). `false` = uma escrita na inbox falhou.
 */
async function avisarParada(admin: SupabaseClient, eventId: string, payload: unknown): Promise<boolean> {
  const m = ehObjeto(payload) && ehObjeto(payload.message) ? payload.message : null
  const wamid = m ? texto(m.id) : null
  if (!m || !wamid) return atualizarPendente(admin, eventId, { error: 'mensagem gravada sem id' })
  const { error } = await admin.rpc('enqueue_student_stop_request', {
    p_wamid: wamid,
    p_from: texto(m.from) ?? '',
    p_texto: textoDaMensagem(m) ?? '',
  })
  if (error) return atualizarPendente(admin, eventId, { error: `aviso de parada não enfileirado: ${error.message}` })
  return atualizarPendente(admin, eventId, { processed_at: new Date().toISOString(), error: null })
}

export async function handleMetaWebhook(
  obterCliente: () => SupabaseClient,
  input: MetaWebhookInput,
): Promise<WebhookResult> {
  const { secret, signature, body } = input
  // fail-closed: sem segredo configurado a rota é inoperante
  if (!secret || !assinaturaConfere(secret, signature, body)) {
    return { status: 401, body: { ok: false, detail: 'assinatura inválida' } }
  }

  let envelope: unknown
  try {
    envelope = JSON.parse(body)
  } catch {
    return { status: 400, body: { ok: false, detail: 'JSON inválido' } }
  }
  if (!ehObjeto(envelope)) return { status: 400, body: { ok: false, detail: 'envelope inválido' } }

  const admin = obterCliente()
  const itens = desmontar(envelope, createHash('sha256').update(body, 'utf8').digest('hex'))

  // 1. gravar TUDO antes de qualquer efeito. Um item que a inbox recusa não
  // impede os outros de entrarem (a reentrega da Meta não fica presa num
  // item só), mas a resposta é 500 para a Meta reenviar o que faltou.
  const pendentes: Array<{ eventId: string; payload: unknown; efeito: Efeito }> = []
  let faltou = false
  for (const item of itens) {
    const guardado = await guardar(admin, item)
    if (!guardado) {
      faltou = true
      continue
    }
    if (item.efeito && !guardado.processada) {
      pendentes.push({ eventId: item.eventId, payload: guardado.payload, efeito: item.efeito })
    }
  }

  // 2. os recibos e as paradas gravados, pelo payload da inbox
  for (const p of pendentes) {
    const efeito = p.efeito === 'recibo' ? aplicarRecibo : avisarParada
    if (!(await efeito(admin, p.eventId, p.payload))) faltou = true
  }

  if (faltou) return INBOX_FORA
  return { status: 200, body: { ok: true, detail: `${itens.length} aviso(s) recebido(s)` } }
}
