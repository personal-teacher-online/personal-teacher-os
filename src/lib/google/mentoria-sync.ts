import type { SupabaseClient } from '@supabase/supabase-js'
import { googleAuthForRefresh, googleOAuthConfigFromEnv } from '@/lib/google/oauth'
import { gcalPortFromAuth } from '@/lib/google/gcal-port'
import { decryptToken, tokenKeyFromEnv } from '@/lib/google/token-crypto'
import type { GcalPort } from '@/lib/google/calendar'

// F11/M6-6 + M13-1 (P3) — sessão de mentoria ↔ evento Google com Meet pela
// conexão-ÂNCORA (a conta da dona, dona da escola). Best-effort e VISÍVEL:
// falha vira 'mentoria: …' em last_sync_error da conta-âncora (o prefixo
// distingue do sync de aulas — M13-(a)); a colagem MANUAL de link continua
// sendo o fallback de sempre.

const SESSION_KEY_PREFIX = 'mentoria:'

async function anchorAccount(admin: SupabaseClient): Promise<{ teacherId: string; cipher: string } | null> {
  const { data } = await admin
    .from('teachers')
    .select('id, teacher_google_accounts(refresh_token_cipher)')
    .eq('is_owner', true)
    .limit(1)
    .maybeSingle()
  const acct = Array.isArray(data?.teacher_google_accounts)
    ? data?.teacher_google_accounts[0]
    : data?.teacher_google_accounts
  if (!data?.id || !acct?.refresh_token_cipher) return null
  return { teacherId: data.id, cipher: acct.refresh_token_cipher }
}

/** Espelha UMA sessão (criação/edição/cancelamento) no Google da âncora. */
export async function syncMentorshipSessionToGoogle(
  admin: SupabaseClient,
  sessionId: string,
  portFor?: (refreshToken: string) => GcalPort,
): Promise<void> {
  const cfg = googleOAuthConfigFromEnv()
  const key = tokenKeyFromEnv()
  if (!cfg || !key) return // integração desligada — fallback manual segue valendo

  const anchor = await anchorAccount(admin)
  if (!anchor) return // sem âncora conectada — o guarda-corpo da UI acusa

  try {
    const { data: sess } = await admin
      .from('mentorship_sessions')
      .select('id, scheduled_at, duration_min, status, google_event_id, gmeet_url')
      .eq('id', sessionId)
      .maybeSingle()
    if (!sess) return

    const token = decryptToken(anchor.cipher, key)
    const port = portFor ? portFor(token) : gcalPortFromAuth(googleAuthForRefresh(cfg, token))

    if (sess.status === 'cancelled') {
      if (sess.google_event_id) await port.remove(sess.google_event_id)
      return
    }

    const ev = {
      key: `${SESSION_KEY_PREFIX}${sess.id}`,
      startUtc: sess.scheduled_at,
      endUtc: new Date(Date.parse(sess.scheduled_at) + (sess.duration_min ?? 60) * 60_000).toISOString(),
      summary: 'Mentoria Personal Travel (grupo)',
      transparent: false,
      meet: true,
    }
    if (sess.google_event_id) {
      await port.patch(sess.google_event_id, ev)
    } else {
      const created = await port.insert(ev)
      await admin
        .from('mentorship_sessions')
        .update({
          google_event_id: created.id,
          // link LIVRE (M6-5): um link já colado à mão NUNCA é sobrescrito
          ...(sess.gmeet_url ? {} : created.meetUrl ? { gmeet_url: created.meetUrl } : {}),
        })
        .eq('id', sess.id)
    }
    // sucesso da mentoria não apaga erro de 'sync:' — origens separadas
  } catch (err) {
    const msg = 'mentoria: ' + (err instanceof Error ? err.message : String(err)).slice(0, 280)
    await admin
      .from('teacher_google_accounts')
      .update({ last_sync_error: msg })
      .eq('teacher_id', anchor.teacherId)
  }
}
