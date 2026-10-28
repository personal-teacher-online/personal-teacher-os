import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { safeTokenEqual } from '@/lib/auth/token'

// Recepção de eventos da Evolution (handoff-whatsapp item 4 — v1 STORAGE-ONLY):
// guarda o payload cru na inbox genérica (source='evolution', first-write-wins,
// molde do Asaas) e responde 200 rápido. NENHUM fluxo interativo nasce aqui —
// listas/botões (limites do CLAUDE.md) são fase futura; a inbox é o insumo.
// Autenticidade: token PRÓPRIO nosso (header evolution-webhook-token) — a
// Evolution manda o valor configurado em webhook.headers da instância (§N).

interface EvolutionEvent {
  event?: string
  instance?: string
  data?: { key?: { id?: string } } & Record<string, unknown>
}

export interface WebhookResult {
  status: number
  body: { ok: boolean; detail?: string }
}

export async function handleEvolutionWebhook(
  admin: SupabaseClient,
  opts: { token: string | null; expectedToken: string | undefined; payload: unknown },
): Promise<WebhookResult> {
  if (!opts.expectedToken || !opts.token || !safeTokenEqual(opts.token, opts.expectedToken)) {
    return { status: 401, body: { ok: false, detail: 'token inválido' } }
  }

  const evt = (opts.payload ?? {}) as EvolutionEvent
  // id natural quando houver (mensagens têm data.key.id); senão hash do corpo —
  // determinístico para retries, distinto entre eventos.
  const naturalId = evt.data?.key?.id
  const eventId =
    typeof naturalId === 'string' && naturalId
      ? `${evt.event ?? 'evt'}:${naturalId}`
      : createHash('sha256').update(JSON.stringify(evt)).digest('hex')

  const { data: inserted, error } = await admin
    .from('webhook_inbox')
    .upsert(
      // Storage-only: nasce PROCESSADA (nada consome a fila da Evolution ainda —
      // processed_at NULL sinalizaria "evento preso", o que aqui seria falso).
      {
        source: 'evolution',
        event_id: eventId,
        payload: evt as never,
        processed_at: new Date().toISOString(),
      },
      { onConflict: 'source,event_id', ignoreDuplicates: true },
    )
    .select('id')
  if (error) {
    return { status: 500, body: { ok: false, detail: `inbox: ${error.message}` } }
  }
  return {
    status: 200,
    body: { ok: true, detail: inserted?.length ? 'armazenado' : 'replay ignorado' },
  }
}
