import crypto from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// F7/M4-2 — webhook de BOUNCE do Resend (assinado via Svix). Lei 6: inbox
// idempotente por (source, event_id) + payload cru; 200 rápido. Efeito único:
// marcar "e-mail devolvido" no perfil (mark_email_bounced) — painel e ficha
// acusam; nada é reenviado automaticamente.
// Verificação Svix manual (sem lib): HMAC-SHA256 de "{id}.{timestamp}.{body}"
// com o secret base64 depois do prefixo whsec_; compara com v1,<assinatura>.

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

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  const id = request.headers.get('svix-id')
  const timestamp = request.headers.get('svix-timestamp')
  const signature = request.headers.get('svix-signature')
  const body = await request.text()

  // fail-closed: sem secret configurado a rota é inoperante (padrão Asaas)
  if (!secret || !id || !timestamp || !signature || !verifySvix(secret, id, timestamp, body, signature)) {
    return NextResponse.json({ ok: false, detail: 'assinatura inválida' }, { status: 401 })
  }

  let payload: { type?: string; data?: { to?: string[]; bounce?: { message?: string } } }
  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ ok: false, detail: 'JSON inválido' }, { status: 400 })
  }

  const admin = createAdminClient()
  await admin.from('webhook_inbox').upsert(
    { source: 'resend', event_id: id, payload: JSON.parse(body) },
    { onConflict: 'source,event_id', ignoreDuplicates: true },
  )

  if (payload.type === 'email.bounced' || payload.type === 'email.complained') {
    const reason = payload.data?.bounce?.message ?? payload.type
    for (const to of payload.data?.to ?? []) {
      const { error } = await admin.rpc('mark_email_bounced', { p_email: to, p_reason: reason })
      if (error) console.error('[resend bounce] mark falhou:', error.message)
    }
  }
  return NextResponse.json({ ok: true })
}
