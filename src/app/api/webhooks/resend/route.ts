import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { handleResendWebhook } from '@/lib/webhooks/resend'

// Webhook do Resend (assinado via Svix): bounce/reclamação (F7/M4-2) e o
// recibo de entrega `email.delivered` (#47). A regra mora no handler.
export async function POST(request: NextRequest) {
  const result = await handleResendWebhook(createAdminClient(), {
    secret: process.env.RESEND_WEBHOOK_SECRET,
    svixId: request.headers.get('svix-id'),
    svixTimestamp: request.headers.get('svix-timestamp'),
    svixSignature: request.headers.get('svix-signature'),
    body: await request.text(),
  })
  return NextResponse.json(result.body, { status: result.status })
}
