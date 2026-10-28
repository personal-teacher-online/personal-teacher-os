import { NextResponse, type NextRequest } from 'next/server'
import { fetchProgressByEmail, hotmartConfigFromEnv } from '@/lib/hotmart/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { handleHotmartWebhook } from '@/lib/webhooks/hotmart'

// Fase 5 (handoff-fase5 §i): rota fina — o núcleo testável vive em
// src/lib/webhooks/hotmart.ts (molde do Asaas). Prefixo /api/webhooks já é
// público no gate; autenticação = X-HOTMART-HOTTOK (token fixo da conta,
// conferido na doc oficial em 14/07/2026 — não há HMAC).
export async function POST(request: NextRequest) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, detail: 'JSON inválido' }, { status: 400 })
  }

  const cfg = hotmartConfigFromEnv()
  const result = await handleHotmartWebhook(createAdminClient(), {
    hottok: request.headers.get('x-hotmart-hottok'),
    expectedHottok: process.env.HOTMART_HOTTOK,
    payload,
    // Gatilho de progresso (CLUB_MODULE_COMPLETED não traz pct): só com creds.
    fetchPct: cfg ? (email) => fetchProgressByEmail(cfg, email) : undefined,
  })
  return NextResponse.json(result.body, { status: result.status })
}
