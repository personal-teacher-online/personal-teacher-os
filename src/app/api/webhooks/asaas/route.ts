import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { handleAsaasWebhook } from '@/lib/webhooks/asaas'

// D7: rota fora do cache do Cloudflare (runbook §E) e fora do gate de sessão do proxy
// (PUBLIC_PATHS) — a autenticação é o token de autenticidade do Asaas.
export async function POST(request: NextRequest) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, detail: 'JSON inválido' }, { status: 400 })
  }

  const result = await handleAsaasWebhook(createAdminClient(), {
    token: request.headers.get('asaas-access-token'),
    expectedToken: process.env.ASAAS_WEBHOOK_TOKEN,
    payload,
  })
  return NextResponse.json(result.body, { status: result.status })
}
