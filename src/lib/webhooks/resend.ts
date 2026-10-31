import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// Webhook do Resend (assinado via Svix). Lei 6: inbox idempotente por
// (source, event_id) + payload cru; 200 rápido.
//  - `email.delivered` (#47): recibo de entrega. Chave na inbox
//    `<email_id>:delivered` (o mesmo evento reentregue com outro svix-id não
//    vira linha nova); `apply_delivery_receipt` casa `data.email_id` com o
//    `provider_message_id` que o despachante gravou pelo `outbox_mark_sent`
//    (o `id` do 200 do `POST /emails`). Aplicado → a linha da inbox fica
//    processada; id ainda desconhecido → fica pendente (processed_at nulo) e o
//    webhook responde 200, como o recibo antecipado da #42.
//  - `email.bounced` / `email.complained` (F7/M4-2): chave = svix-id, efeito
//    único marcar "e-mail devolvido" no perfil (mark_email_bounced); nada é
//    reenviado automaticamente.
// Verificação Svix manual (sem lib): HMAC-SHA256 de "{id}.{timestamp}.{body}"
// com o secret base64 depois do prefixo whsec_; compara com v1,<assinatura>.

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

function verifySvix(secret: string, id: string, timestamp: string, body: string, signatures: string): boolean {
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
  if (payload.type === 'email.delivered' && typeof emailId === 'string' && emailId) {
    return aplicarEntrega(admin, emailId, payload)
  }

  await admin.from('webhook_inbox').upsert(
    { source: 'resend', event_id: svixId, payload: payload as never },
    { onConflict: 'source,event_id', ignoreDuplicates: true },
  )

  if (payload.type === 'email.bounced' || payload.type === 'email.complained') {
    const reason = payload.data?.bounce?.message ?? payload.type
    for (const to of payload.data?.to ?? []) {
      const { error } = await admin.rpc('mark_email_bounced', { p_email: to, p_reason: reason })
      if (error) console.error('[resend bounce] mark falhou:', error.message)
    }
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
  const { error: erroDaInbox } = await admin
    .from('webhook_inbox')
    .upsert(
      { source: 'resend', event_id: eventId, payload: payload as never },
      { onConflict: 'source,event_id', ignoreDuplicates: true },
    )
  if (erroDaInbox) {
    return { status: 500, body: { ok: false, detail: `inbox: ${erroDaInbox.message}` } }
  }

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
    // reentrega anterior em que a RPC falhou)
    await admin
      .from('webhook_inbox')
      .update({ error: null })
      .eq('source', 'resend')
      .eq('event_id', eventId)
      .is('processed_at', null)
      .not('error', 'is', null)
    return { status: 200, body: { ok: true, detail: 'recibo pendente: id ainda não está no outbox' } }
  }
  // `.is('processed_at', null)`: o replay não regrava o horário do processamento
  const { error: erroDaMarca } = await admin
    .from('webhook_inbox')
    .update({ processed_at: new Date().toISOString(), error: null })
    .eq('source', 'resend')
    .eq('event_id', eventId)
    .is('processed_at', null)
  if (erroDaMarca) console.error(`[resend] recibo ${eventId} aplicado, inbox não marcada: ${erroDaMarca.message}`)
  return { status: 200, body: { ok: true, detail: 'recibo aplicado' } }
}
