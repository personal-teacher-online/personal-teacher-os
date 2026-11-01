import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { handleMetaVerification, handleMetaWebhook } from '@/lib/webhooks/meta'

// Webhook da Cloud API da Meta (#44, ADR-038). Prefixo /api/webhooks já é
// público no gate; a autenticidade é o token da verificação (GET) e a
// assinatura do corpo (POST). Segredos só no servidor (Lei 4). A regra mora
// no handler.

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const r = handleMetaVerification({
    mode: q.get('hub.mode'),
    token: q.get('hub.verify_token'),
    challenge: q.get('hub.challenge'),
    expectedToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
  })
  return new NextResponse(r.body, {
    status: r.status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

export async function POST(request: NextRequest) {
  const result = await handleMetaWebhook(createAdminClient, {
    secret: process.env.META_APP_SECRET,
    signature: request.headers.get('x-hub-signature-256'),
    // o corpo CRU: a assinatura é sobre os bytes, e só depois vem o JSON.parse
    body: await request.text(),
  })
  return NextResponse.json(result.body, { status: result.status })
}
