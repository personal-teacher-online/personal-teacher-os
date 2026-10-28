import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { handleAutentiqueWebhook } from '@/lib/webhooks/autentique'

// B8: rota fina — HMAC exige o CORPO CRU (request.text(), nunca .json() antes
// de verificar). Prefixo /api/webhooks já é público no gate.
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const result = await handleAutentiqueWebhook(createAdminClient(), {
    rawBody,
    signature: request.headers.get('x-autentique-signature'),
    secret: process.env.AUTENTIQUE_WEBHOOK_SECRET,
  })
  return NextResponse.json(result.body, { status: result.status })
}
