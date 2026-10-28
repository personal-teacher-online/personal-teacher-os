import { NextResponse, type NextRequest } from 'next/server'
import { handleGcalSync } from '@/lib/google/sync'
import { createAdminClient } from '@/lib/supabase/admin'

// ADR-017/M4: rota fina do sync Google Agenda, chamada pelo Scheduled Task do
// Coolify (mesmo padrão/trade-off do dispatch-outbox — ADR-015). Núcleo
// testado no Vitest (handleGcalSync, 401 fail-closed); aqui só header + env.
// Token via HEADER (nunca query string); caminho EXATO no PUBLIC_PATHS do gate.
export async function POST(request: NextRequest) {
  const { status, body } = await handleGcalSync(createAdminClient(), {
    token: request.headers.get('gcal-sync-token'),
    expectedToken: process.env.GCAL_SYNC_TOKEN,
  })
  return NextResponse.json(body, { status })
}
