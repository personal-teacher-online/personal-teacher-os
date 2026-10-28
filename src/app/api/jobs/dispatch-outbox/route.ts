import { NextResponse, type NextRequest } from 'next/server'
import { sendEmailWithOutcome } from '@/lib/email/send'
import type { ChannelRegistry } from '@/lib/notify/channel'
import { evolutionChannel, evolutionConfigFromEnv } from '@/lib/notify/evolution'
import { handleDispatchOutbox } from '@/lib/outbox/handle'
import { createAdminClient } from '@/lib/supabase/admin'

// F3-D4/M3: rota fina do despachante do outbox, chamada pelo agendador externo
// (Scheduled Task do Coolify — decisão P3; desvio da Lei 5 registrado no ADR-015).
// O núcleo (401 fail-closed + despacho) vive em src/lib/outbox/handle.ts, testado
// no Vitest (caso 25); aqui fica SÓ a leitura do header/env — nome do header e da
// env cobertos pelo teste-pino de fonte + smoke §L (mesmo trade-off do Asaas).
// Token via HEADER (nunca query string — vazaria em logs). Caminho EXATO no
// PUBLIC_PATHS do gate (src/lib/auth/gate.ts) — fora do cache do Cloudflare (§E).
export async function POST(request: NextRequest) {
  // Registro de canais (F3-D8): e-mail via Resend; WhatsApp via Evolution
  // (ADR-016 — driver neutro: trocar de provedor = trocar esta linha).
  const channels: ChannelRegistry = {
    email: { send: sendEmailWithOutcome },
    whatsapp: evolutionChannel(evolutionConfigFromEnv()),
  }
  const { status, body } = await handleDispatchOutbox(createAdminClient(), {
    token: request.headers.get('outbox-dispatch-token'),
    expectedToken: process.env.OUTBOX_DISPATCH_TOKEN,
    channels,
  })
  return NextResponse.json(body, { status })
}
