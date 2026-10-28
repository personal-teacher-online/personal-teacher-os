import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { handleEvolutionWebhook } from '@/lib/webhooks/evolution'

// Handoff-whatsapp item 4 (v1): recepção storage-only → webhook_inbox.
// Prefixo /api/webhooks já é público no gate; token próprio no header
// (configurado na instância Evolution — runbook §N).
export async function POST(request: NextRequest) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, detail: 'JSON inválido' }, { status: 400 })
  }
  const result = await handleEvolutionWebhook(createAdminClient(), {
    token: request.headers.get('evolution-webhook-token'),
    expectedToken: process.env.EVOLUTION_WEBHOOK_TOKEN,
    payload,
  })
  return NextResponse.json(result.body, { status: result.status })
}
