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
//          e 4), mídia só com os ids, sem baixar arquivo;
//        - qualquer outro campo (`account_update`, que é por onde a Meta
//          avisa número caído e nome recusado) → `<campo>:<hash>`, processado
//          na hora;
//   3. TODOS os itens são gravados antes de qualquer efeito; se a inbox
//      falhar, a resposta é 500 (a Meta reenvia; é o único caso em que não
//      responder 200 é correto). A reentrega é inofensiva: a chave natural
//      segura a linha e cada efeito é idempotente;
//   4. só então os efeitos, e falha de efeito vira `error` na linha (com
//      `processed_at` nulo) e 200 mesmo assim:
//        - recibo: `apply_delivery_receipt` (#42), que casa a linha do outbox
//          sob o advisory do wamid. 'aplicado'/'ignorado' fecham a linha da
//          inbox; 'sem_linha' a deixa pendente, e quem grava o id
//          (`outbox_mark_sent`) ou o job de 5 min aplicam depois;
//        - mensagem com palavra de parada: enfileira UM e-mail interno por
//          admin (dedupe pelo wamid). Nada mais: o aviso pelo WhatsApp é canal
//          de contrato (M4-3), quem decide é a admin, pela ficha.

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

interface ItemBase {
  eventId: string
  payload: Objeto
  /** a linha nasce processada (não há o que aplicar) */
  processadaNaHora: boolean
}
interface Recibo extends ItemBase {
  tipo: 'recibo'
  wamid: string
  status: string
  motivo: string | null
  tentativa: string | null
}
interface Mensagem extends ItemBase {
  tipo: 'mensagem'
  wamid: string
  from: string
  texto: string | null
}
interface Outro extends ItemBase {
  tipo: 'outro'
}
type Item = Recibo | Mensagem | Outro

const INBOX_FORA: WebhookResult = { status: 500, body: { ok: false, detail: 'inbox indisponível' } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ehObjeto = (v: unknown): v is Objeto => typeof v === 'object' && v !== null && !Array.isArray(v)
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex')

/** O motivo da falha como o banco o escreve no caminho dos pendentes (#42). */
function motivoDe(recibo: Objeto): string | null {
  const [primeiro] = lista(recibo.errors)
  if (!ehObjeto(primeiro)) return null
  const titulo = texto(primeiro.title) ?? texto(primeiro.message)
  const codigo = primeiro.code ?? null
  const partes = [titulo, codigo !== null ? `(código ${String(codigo)})` : null].filter(Boolean)
  return partes.length ? partes.join(' ') : null
}

/** Desmonta o envelope em itens da inbox. Nada do envelope fica de fora. */
function desmontar(envelope: Objeto): Item[] {
  const itens: Item[] = []
  for (const entry of lista(envelope.entry)) {
    if (!ehObjeto(entry)) continue
    for (const change of lista(entry.changes)) {
      if (!ehObjeto(change)) continue
      const campo = texto(change.field) ?? 'desconhecido'
      const value = ehObjeto(change.value) ? change.value : {}
      const metadata = ehObjeto(value.metadata) ? value.metadata : null
      let reconhecidos = 0

      if (campo === 'messages') {
        for (const s of lista(value.statuses)) {
          if (!ehObjeto(s)) continue
          const wamid = texto(s.id)
          const status = texto(s.status)
          if (!wamid || !status) continue
          reconhecidos += 1
          const opaco = texto(s.biz_opaque_callback_data)
          itens.push({
            tipo: 'recibo',
            eventId: `${wamid}:${status}`,
            payload: { status: s, metadata },
            processadaNaHora: false,
            wamid,
            status,
            motivo: motivoDe(s),
            tentativa: opaco && UUID.test(opaco) ? opaco : null,
          })
        }
        for (const m of lista(value.messages)) {
          if (!ehObjeto(m)) continue
          const wamid = texto(m.id)
          if (!wamid) continue
          reconhecidos += 1
          const corpo = m.type === 'text' && ehObjeto(m.text) ? texto(m.text.body) : null
          itens.push({
            tipo: 'mensagem',
            eventId: `${wamid}:message`,
            payload: { message: m, metadata },
            // sem palavra de parada não há o que fazer: nasce processada
            processadaNaHora: !pedeParaParar(corpo),
            wamid,
            from: texto(m.from) ?? '',
            texto: corpo,
          })
        }
      }

      // `account_update` (e qualquer aviso que não seja recibo nem mensagem):
      // guardado inteiro, processado na hora. A chave é o hash do objeto com o
      // `time` da entrada: a reentrega da Meta repete os dois.
      if (reconhecidos === 0) {
        itens.push({
          tipo: 'outro',
          eventId: `${campo}:${hash({ time: entry.time ?? null, value })}`,
          payload: { field: campo, value },
          processadaNaHora: true,
        })
      }
    }
  }
  return itens
}

/**
 * Guarda o item (first-write-wins) e devolve se a linha já está processada,
 * ou `null` quando a inbox falhou (o erro cru vai para o log, não para fora).
 */
async function guardar(admin: SupabaseClient, item: Item): Promise<{ processada: boolean } | null> {
  const { error: erroDoUpsert } = await admin.from('webhook_inbox').upsert(
    {
      source: 'meta',
      event_id: item.eventId,
      payload: item.payload as never,
      ...(item.processadaNaHora ? { processed_at: new Date().toISOString() } : {}),
    },
    { onConflict: 'source,event_id', ignoreDuplicates: true },
  )
  if (erroDoUpsert) {
    console.error(`[meta] evento ${item.eventId} não gravado na inbox: ${erroDoUpsert.message}`)
    return null
  }
  const { data, error: erroDaLeitura } = await admin
    .from('webhook_inbox')
    .select('processed_at')
    .eq('source', 'meta')
    .eq('event_id', item.eventId)
    .maybeSingle()
  if (erroDaLeitura || !data) {
    console.error(`[meta] evento ${item.eventId} não relido da inbox: ${erroDaLeitura?.message ?? 'linha ausente'}`)
    return null
  }
  return { processada: (data as { processed_at: string | null }).processed_at !== null }
}

/** Fecha a linha da inbox (o replay não regrava o horário). */
async function marcarProcessada(admin: SupabaseClient, eventId: string): Promise<void> {
  const { error } = await admin
    .from('webhook_inbox')
    .update({ processed_at: new Date().toISOString(), error: null })
    .eq('source', 'meta')
    .eq('event_id', eventId)
    .is('processed_at', null)
  if (error) console.error(`[meta] evento ${eventId} não marcado como processado: ${error.message}`)
}

/** Deixa a linha pendente com o motivo (ou sem motivo, com `null`). */
async function anotar(admin: SupabaseClient, eventId: string, motivo: string | null): Promise<void> {
  const { error } = await admin
    .from('webhook_inbox')
    .update({ error: motivo })
    .eq('source', 'meta')
    .eq('event_id', eventId)
    .is('processed_at', null)
  if (error) console.error(`[meta] evento ${eventId}: motivo não anotado: ${error.message}`)
}

async function aplicarRecibo(admin: SupabaseClient, r: Recibo): Promise<void> {
  const { data, error } = await admin.rpc('apply_delivery_receipt', {
    p_provider: 'meta',
    p_provider_message_id: r.wamid,
    p_status: r.status,
    p_error: r.motivo,
    p_attempt_id: r.tentativa,
  })
  if (error) {
    await anotar(admin, r.eventId, `recibo não aplicado: ${error.message}`)
    return
  }
  // o wamid ainda não está no outbox: fica pendente, sem erro (sai o de uma
  // reentrega anterior em que a RPC falhou); outbox_mark_sent aplica depois
  if (data === 'sem_linha') {
    await anotar(admin, r.eventId, null)
    return
  }
  await marcarProcessada(admin, r.eventId)
}

/**
 * As formas do número no WhatsApp: o id de um celular antigo do Brasil chega
 * sem o 9 da frente do assinante (a mesma régua do expurgo por telefone, #42).
 */
function formasDoNumero(digitos: string): string[] {
  const formas = [digitos]
  if (/^55\d{2}9\d{8}$/.test(digitos)) formas.push(digitos.slice(0, 4) + digitos.slice(5))
  if (/^55\d{2}\d{8}$/.test(digitos)) formas.push(`${digitos.slice(0, 4)}9${digitos.slice(4)}`)
  return formas
}

/**
 * Palavra de parada: um e-mail interno por admin, com o aluno (quando o número
 * está na ficha de um aluno só) e o texto. A chave de dedupe é o wamid: a
 * reentrega, ou dois POSTs iguais ao mesmo tempo, não repetem o aviso.
 * Devolve o motivo da falha, ou null.
 */
async function avisarParada(admin: SupabaseClient, m: Mensagem): Promise<string | null> {
  const digitos = m.from.replace(/\D/g, '')
  if (!digitos) return 'mensagem sem o número de quem mandou'

  const { data: perfis, error: erroDosPerfis } = await admin
    .from('profiles')
    .select('id')
    .in(
      'whatsapp_e164',
      formasDoNumero(digitos).map((d) => `+${d}`),
    )
  if (erroDosPerfis) return `perfil do número não lido: ${erroDosPerfis.message}`

  let aluno: { id: string; display_name: string } | null = null
  const ids = (perfis ?? []).map((p) => (p as { id: string }).id)
  if (ids.length) {
    const { data: alunos, error: erroDosAlunos } = await admin
      .from('students')
      .select('id, display_name')
      .in('profile_id', ids)
    if (erroDosAlunos) return `aluno do número não lido: ${erroDosAlunos.message}`
    // número em mais de uma ficha: não se escolhe um aluno por palpite
    if (alunos?.length === 1) aluno = alunos[0] as { id: string; display_name: string }
  }

  const { data: admins, error: erroDosAdmins } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .order('id')
  if (erroDosAdmins) return `admins não lidos: ${erroDosAdmins.message}`
  if (!admins?.length) return 'nenhuma admin para avisar do pedido de parada'

  const linhas = admins.map((a) => ({
    channel: 'email',
    template: 'student-stop-request',
    recipient_profile_id: (a as { id: string }).id,
    payload: {
      student_id: aluno?.id ?? null,
      student_name: aluno?.display_name ?? null,
      whatsapp_e164: `+${digitos}`,
      texto: m.texto ?? '',
      wamid: m.wamid,
    },
    dedupe_key: `student-stop-request:${m.wamid}:${(a as { id: string }).id}`,
  }))
  const { error } = await admin
    .from('notification_outbox')
    .upsert(linhas, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  return error ? `aviso de parada não enfileirado: ${error.message}` : null
}

async function aplicar(admin: SupabaseClient, item: Item): Promise<void> {
  if (item.tipo === 'recibo') return aplicarRecibo(admin, item)
  if (item.tipo === 'mensagem') {
    const falha = await avisarParada(admin, item)
    if (falha) {
      console.error(`[meta] mensagem ${item.eventId}: ${falha}`)
      await anotar(admin, item.eventId, falha)
      return
    }
    await marcarProcessada(admin, item.eventId)
  }
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
  const itens = desmontar(envelope)

  // 1. gravar TUDO antes de qualquer efeito
  const pendentes: Item[] = []
  for (const item of itens) {
    const guardado = await guardar(admin, item)
    if (!guardado) return INBOX_FORA
    if (!guardado.processada) pendentes.push(item)
  }

  // 2. os efeitos; falha vira `error` na linha, e a resposta segue 200
  for (const item of pendentes) await aplicar(admin, item)

  return { status: 200, body: { ok: true, detail: `${itens.length} aviso(s) recebido(s)` } }
}
