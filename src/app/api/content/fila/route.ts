import { NextResponse, type NextRequest } from 'next/server'
import { handleContentFila } from '@/lib/content/handle'
import { createAdminClient } from '@/lib/supabase/admin'

// ADR-021: fila do gerador (posts ideia_aprovada + voz da marca ativa).
export async function GET(request: NextRequest) {
  const { status, body } = await handleContentFila(createAdminClient(), {
    token: request.headers.get('content-api-token'),
    expectedToken: process.env.CONTENT_API_TOKEN,
  })
  return NextResponse.json(body, { status })
}
