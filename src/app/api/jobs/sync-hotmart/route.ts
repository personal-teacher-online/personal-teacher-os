import { NextResponse, type NextRequest } from 'next/server'
import { hotmartConfigFromEnv, listAllProgress } from '@/lib/hotmart/client'
import { handleSyncHotmart } from '@/lib/jobs/sync-hotmart'
import { createAdminClient } from '@/lib/supabase/admin'

// Fase 5: polling autoritativo do progresso Hotmart (1–2×/dia via Scheduled
// Task do Coolify — padrão ADR-015). Token próprio via HEADER (nunca query —
// vazaria em log). Caminho EXATO entra no PUBLIC_PATHS do gate.
export async function POST(request: NextRequest) {
  const cfg = hotmartConfigFromEnv()
  const { status, body } = await handleSyncHotmart(createAdminClient(), {
    token: request.headers.get('hotmart-sync-token'),
    expectedToken: process.env.HOTMART_SYNC_TOKEN,
    listProgress: cfg ? () => listAllProgress(cfg) : null,
  })
  return NextResponse.json(body, { status })
}
