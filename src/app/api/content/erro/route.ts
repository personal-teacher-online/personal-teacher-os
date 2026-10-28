import { NextResponse, type NextRequest } from 'next/server'
import { handleContentErro } from '@/lib/content/handle'
import { createAdminClient } from '@/lib/supabase/admin'

// ADR-021: geração falhou — devolve o post à fila com o erro visível no painel.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const { status, body: out } = await handleContentErro(
    createAdminClient(),
    {
      token: request.headers.get('content-api-token'),
      expectedToken: process.env.CONTENT_API_TOKEN,
    },
    body,
  )
  return NextResponse.json(out, { status })
}
