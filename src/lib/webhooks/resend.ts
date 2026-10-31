import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// Webhook do Resend (assinado via Svix). Lei 6: inbox idempotente por
// (source, event_id) + payload cru; 200 rápido. Toda escrita na inbox é
// conferida: se ela falha, a resposta é 500 e o Resend reentrega (o efeito só
// roda depois de a chave idempotente existir, e as RPCs são idempotentes).
//  - `email.delivered` (#47): recibo de entrega. Chave na inbox
//    `<email_id>:delivered` (o mesmo evento reentregue com outro svix-id não
//    vira linha nova); `apply_delivery_receipt` casa `data.email_id` com o
//    `provider_message_id` que o despachante gravou pelo `outbox_mark_sent`
//    (o `id` do 200 do `POST /emails`). Aplicado → a linha da inbox fica
//    processada; id ainda desconhecido → fica pendente (processed_at nulo) e o
//    webhook responde 200. ATENÇÃO: diferente da Meta, nada aplica esse
//    pendente depois (outbox_mark_sent e o job do cron só olham a origem
//    `meta`); fechar isso pede migration (issue #110).
//    `email.delivered` sem `data.email_id` fica na inbox COM erro (o sinal
//    do Resend em Ajustes fica vermelho), nunca aceito em silêncio.
//  - `email.bounced` / `email.complained` (F7/M4-2): chave = svix-id, efeito
//    único marcar "e-mail devolvido" no perfil (mark_email_bounced), UMA vez:
//    a linha da inbox fica processada e o replay não remarca; nada é
//    reenviado automaticamente.
// Verificação Svix manual (sem lib): HMAC-SHA256 de "{id}.{timestamp}.{body}"
// com o secret base64 depois do prefixo whsec_; compara com v1,<assinatura>;
// timestamp a mais de 5 min do relógio recusa (requisição capturada não vale
// para sempre; docs.svix.com/receiving/verifying-payloads/why).

export interface ResendWebhookInput {
  secret: string | undefined
  svixId: string | null
  svixTimestamp: string | null
  svixSignature: string | null
  /** O corpo CRU: a assinatura é sobre os bytes recebidos, não sobre o JSON relido. */
  body: string
}

export interface WebhookResult {
  status: number
  body: { ok: boolean; detail?: string }
}

interface ResendEvent {
  type?: string
  data?: { email_id?: unknown; to?: string[]; bounce?: { message?: string } }
}

/** Tolerância do `svix-timestamp` em relação ao relógio do servidor (padrão Svix). */
const TOLERANCIA_MS = 5 * 60 * 1000

function verifySvix(secret: string, id: string, timestamp: string, body: string, signatures: string): boolean {
  const segundos = Number(timestamp)
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - segundos * 1000) > TOLERANCIA_MS) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
  return signatures.split(' ').some((part) => {
    const [, sig] = part.split(',')
    if (!sig) return false
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    } catch {
      return false
    }
  })
}

const INBOX_FORA = { status: 500, body: { ok: false, detail: 'inbox indisponível' } } as const

/**
 * Guarda o evento (first-write-wins) e devolve se a linha já foi processada,
 * ou `null` quando a inbox falhou (o erro cru vai para o log, não para fora).
 */
async function guardar(
  admin: SupabaseClient,
  eventId: string,
  payload: ResendEvent,
  error: string | null = null,
): Promise<{ processada: boolean } | null> {
  const { error: erroDoUpsert } = await admin
    .from('webhook_inbox')
    .upsert(
      { source: 'resend', event_id: eventId, payload: payload as never, ...(error ? { error } : {}) },
      { onConflict: 'source,event_id', ignoreDuplicates: true },
    )
  if (erroDoUpsert) {
    console.error(`[resend] evento ${eventId} não gravado na inbox: ${erroDoUpsert.message}`)
    return null
  }
  const { data, error: erroDaLeitura } = await admin
    .from('webhook_inbox')
    .select('processed_at')
    .eq('source', 'resend')
    .eq('event_id', eventId)
    .maybeSingle()
  if (erroDaLeitura || !data) {
    console.error(`[resend] evento ${eventId} não relido da inbox: ${erroDaLeitura?.message ?? 'linha ausente'}`)
    return null
  }
  return { processada: (data as { processed_at: string | null }).processed_at !== null }
}

/** Fecha a linha da inbox (o replay não regrava o horário). `false` = falhou. */
async function marcarProcessada(admin: SupabaseClient, eventId: string): Promise<boolean> {
  const { error } = await admin
    .from('webhook_inbox')
    .update({ processed_at: new Date().toISOString(), error: null })
    .eq('source', 'resend')
    .eq('event_id', eventId)
    .is('processed_at', null)
  if (error) console.error(`[resend] evento ${eventId} não marcado como processado: ${error.message}`)
  return !error
}

export async function handleResendWebhook(admin: SupabaseClient, input: ResendWebhookInput): Promise<WebhookResult> {
  const { secret, svixId, svixTimestamp, svixSignature, body } = input
  // fail-closed: sem secret configurado a rota é inoperante (padrão Asaas)
  if (!secret || !svixId || !svixTimestamp || !svixSignature || !verifySvix(secret, svixId, svixTimestamp, body, svixSignature)) {
    return { status: 401, body: { ok: false, detail: 'assinatura inválida' } }
  }

  let payload: ResendEvent
  try {
    payload = JSON.parse(body) as ResendEvent
  } catch {
    return { status: 400, body: { ok: false, detail: 'JSON inválido' } }
  }

  const emailId = payload.data?.email_id
  if (payload.type === 'email.delivered') {
    if (typeof emailId === 'string' && emailId) return aplicarEntrega(admin, emailId, payload)
    if (!(await guardar(admin, svixId, payload, 'recibo de entrega sem data.email_id'))) return INBOX_FORA
    return { status: 200, body: { ok: true, detail: 'recibo sem email_id: guardado com erro' } }
  }

  const guardado = await guardar(admin, svixId, payload)
  if (!guardado) return INBOX_FORA

  if ((payload.type === 'email.bounced' || payload.type === 'email.complained') && !guardado.processada) {
    const reason = payload.data?.bounce?.message ?? payload.type
    for (const to of payload.data?.to ?? []) {
      const { error } = await admin.rpc('mark_email_bounced', { p_email: to, p_reason: reason })
      if (error) {
        // a linha fica pendente com o motivo; o Resend reentrega e a marca roda de novo
        console.error('[resend bounce] mark falhou:', error.message)
        await admin
          .from('webhook_inbox')
          .update({ error: `devolução não marcada: ${error.message}` })
          .eq('source', 'resend')
          .eq('event_id', svixId)
          .is('processed_at', null)
        return { status: 500, body: { ok: false, detail: 'devolução não marcada' } }
      }
    }
    if (!(await marcarProcessada(admin, svixId))) return INBOX_FORA
  }
  return { status: 200, body: { ok: true } }
}

/**
 * O recibo de entrega: guarda, aplica pela RPC e marca a linha da inbox.
 * Falha da inbox ou da RPC responde 500 (o Resend reentrega; a chave natural e
 * a RPC idempotente fazem a reentrega não mudar nada que já tenha sido feito).
 */
async function aplicarEntrega(admin: SupabaseClient, emailId: string, payload: ResendEvent): Promise<WebhookResult> {
  const eventId = `${emailId}:delivered`
  if (!(await guardar(admin, eventId, payload))) return INBOX_FORA

  const { data: resultado, error } = await admin.rpc('apply_delivery_receipt', {
    p_provider: 'resend',
    p_provider_message_id: emailId,
    p_status: 'delivered',
  })
  if (error) {
    await admin
      .from('webhook_inbox')
      .update({ error: `recibo não aplicado: ${error.message}` })
      .eq('source', 'resend')
      .eq('event_id', eventId)
      .is('processed_at', null)
    return { status: 500, body: { ok: false, detail: 'recibo não aplicado' } }
  }

  if (resultado === 'sem_linha') {
    // o id ainda não está no outbox: fica pendente, sem erro (sai o de uma
    // reentrega anterior em que a RPC falhou). A aplicação posterior é a #110.
    const { error: erroDaLimpeza } = await admin
      .from('webhook_inbox')
      .update({ error: null })
      .eq('source', 'resend')
      .eq('event_id', eventId)
      .is('processed_at', null)
      .not('error', 'is', null)
    if (erroDaLimpeza) {
      console.error(`[resend] recibo ${eventId} pendente, erro antigo não limpo: ${erroDaLimpeza.message}`)
      return INBOX_FORA
    }
    return { status: 200, body: { ok: true, detail: 'recibo pendente: id ainda não está no outbox' } }
  }
  // 500 depois da RPC é seguro: a reentrega aplica de novo sem mudar delivered_at
  if (!(await marcarProcessada(admin, eventId))) return INBOX_FORA
  return { status: 200, body: { ok: true, detail: 'recibo aplicado' } }
}
