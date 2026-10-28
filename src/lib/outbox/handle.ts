import type { SupabaseClient } from '@supabase/supabase-js'
import { safeTokenEqual } from '@/lib/auth/token'
import type { ChannelRegistry } from '@/lib/notify/channel'
import { dispatchOutbox } from './dispatch'

// Núcleo da rota /api/jobs/dispatch-outbox (F3-D4/M3) — extraído no padrão do
// handleAsaasWebhook (src/lib/webhooks/asaas.ts): client/canais INJETADOS e SEM
// `import 'server-only'`, para o Vitest provar o 401 fail-closed do caso 25
// ("rota sem token → 401 e nada enviado, nada marcado"). A rota HTTP é um
// wrapper fino que só lê o header 'outbox-dispatch-token' e a env.

export interface DispatchHandlerResult {
  status: number
  body: Record<string, unknown>
}

export async function handleDispatchOutbox(
  admin: SupabaseClient,
  opts: {
    token: string | null
    expectedToken: string | undefined
    channels: ChannelRegistry
    // Só o Vitest passa: limita o despacho às linhas do próprio teste, para não
    // enviar avisos que outros arquivos da suíte semearam. A rota nunca usa.
    keyLike?: string
  },
): Promise<DispatchHandlerResult> {
  // Fail-closed IGUAL ao webhook Asaas (caso 18): sem token configurado, a rota é
  // INOPERANTE; token errado nunca despacha nem marca nada. Comparação em tempo
  // constante (painel final F3 — padrão único em src/lib/auth/token.ts).
  if (!opts.expectedToken || !opts.token || !safeTokenEqual(opts.token, opts.expectedToken)) {
    return { status: 401, body: { ok: false, detail: 'token inválido' } }
  }
  // Item 16 do e2e (veredito): enfileirar e despachar no MESMO minuto — o
  // despachante roda o enqueue dos toques antes de esvaziar a fila, e a
  // defasagem entre os crons (:05 × :30) deixa de existir. O pg_cron do :05
  // vira redundância inofensiva (dedupe_key segura). Falha aqui não bloqueia
  // o despacho (o cron do banco continua cobrindo).
  const { error: enqueueErr } = await admin.rpc('enqueue_class_touches')
  const result = await dispatchOutbox(admin, opts.channels, { keyLike: opts.keyLike })
  return {
    status: 200,
    body: { ok: true, ...result, ...(enqueueErr ? { enqueue_error: enqueueErr.message } : {}) },
  }
}
