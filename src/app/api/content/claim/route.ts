import { NextResponse, type NextRequest } from 'next/server'
import { handleContentClaim } from '@/lib/content/handle'
import { createAdminClient } from '@/lib/supabase/admin'

// ADR-021: cadeado do gerador (ideia_aprovada → gerando, condicional).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const { status, body: out } = await handleContentClaim(
    createAdminClient(),
    {
      token: request.headers.get('content-api-token'),
      expectedToken: process.env.CONTENT_API_TOKEN,
    },
    body,
  )
  return NextResponse.json(out, { status })
}
