import { DateTime } from 'luxon'
import type { SupabaseClient } from '@supabase/supabase-js'
import { safeTokenEqual } from '@/lib/auth/token'
import {
  SYNC_HORIZON_DAYS,
  desiredEventsForTeacher,
  googleBusyBlocks,
  syncTeacherGoogleCalendar,
  type BusyBlock,
  type GcalPort,
} from './calendar'
import { gcalPortFromAuth } from './gcal-port'
import { googleAuthForRefresh, googleOAuthConfigFromEnv } from './oauth'
import { decryptToken, tokenKeyFromEnv } from './token-crypto'

// Orquestração do sync (ADR-017/M4): banco → Google Agenda de cada professora
// conectada. Auto-corretivo por construção (diff completo do horizonte); o
// resultado fica em last_sync_at/last_sync_error — sem fila, sem estado extra.
// portFor é INJETÁVEL (padrão channels do despachante) para o Vitest exercitar
// tudo sem rede; o default usa o adaptador googleapis real.

export interface SyncOutcome {
  teacherId: string
  ok: boolean
  inserted?: number
  patched?: number
  deleted?: number
  error?: string
}

interface SyncOpts {
  teacherId?: string
  portFor?: (refreshToken: string) => GcalPort
}

function syncRange(): { fromUtcISO: string; toUtcISO: string } {
  // relógio por chamada é intencional (job/action)
  const now = Date.now()
  return {
    fromUtcISO: new Date(now).toISOString(),
    toUtcISO: new Date(now + SYNC_HORIZON_DAYS * 864e5).toISOString(),
  }
}

export async function syncGoogleCalendars(
  admin: SupabaseClient,
  opts: SyncOpts = {},
): Promise<SyncOutcome[]> {
  const cfg = googleOAuthConfigFromEnv()
  const key = tokenKeyFromEnv()
  if (!cfg || !key) return [] // integração desligada — no-op (job responde ok vazio)

  let q = admin.from('teacher_google_accounts').select('teacher_id, refresh_token_cipher')
  if (opts.teacherId) q = q.eq('teacher_id', opts.teacherId)
  const { data: accounts, error } = await q
  if (error) throw new Error(`teacher_google_accounts: ${error.message}`)

  const range = syncRange()
  const out: SyncOutcome[] = []
  for (const acct of accounts ?? []) {
    try {
      const token = decryptToken(acct.refresh_token_cipher, key)
      const port = opts.portFor ? opts.portFor(token) : gcalPortFromAuth(googleAuthForRefresh(cfg, token))
      const desired = await desiredEventsForTeacher(admin, acct.teacher_id, range)
      // F11/M13: grava (event id, Meet real) na AULA — inserts E existentes
      const res = await syncTeacherGoogleCalendar(port, desired, range, async (instanceId, eventId, meetUrl) => {
        await admin
          .from('class_instances')
          .update({ google_event_id: eventId, ...(meetUrl ? { meet_url: meetUrl } : {}) })
          .eq('id', instanceId)
      })
      await admin
        .from('teacher_google_accounts')
        .update({ last_sync_at: new Date().toISOString(), last_sync_error: null })
        .eq('teacher_id', acct.teacher_id)
      out.push({ teacherId: acct.teacher_id, ok: true, ...res })
    } catch (err) {
      // Falha de UMA professora não derruba as demais; o erro fica visível no
      // painel dela e o próximo sync (diário ou gesto novo) tenta de novo.
      // F11/M13-(a): PREFIXO de origem — o mesmo campo também recebe falhas do
      // espelho da MENTORIA ('mentoria: …'); sem o prefixo, o painel confundiria.
      const msg = 'sync: ' + (err instanceof Error ? err.message : String(err)).slice(0, 290)
      await admin
        .from('teacher_google_accounts')
        .update({ last_sync_error: msg })
        .eq('teacher_id', acct.teacher_id)
      out.push({ teacherId: acct.teacher_id, ok: false, error: msg })
    }
  }
  return out
}

/**
 * Gancho das actions (remarcar/publicar/cancelar): fire-and-forget DELIBERADO —
 * o servidor é Node persistente (Coolify), a action não espera o Google e a
 * rodada diária conserta qualquer perda. Nunca lança.
 */
export function syncTeacherCalendarSoon(admin: SupabaseClient, teacherId: string): void {
  void syncGoogleCalendars(admin, { teacherId }).catch((err) => {
    console.error('[gcal sync imediato]', err)
  })
}

// ---------------------------------------------------------------------------
// Rota /api/jobs/sync-gcal — mesmo contrato do handleDispatchOutbox (F3-D4):
// fail-closed, comparação em tempo constante, INOPERANTE sem env.
// ---------------------------------------------------------------------------
export interface GcalSyncHandlerResult {
  status: number
  body: Record<string, unknown>
}

export async function handleGcalSync(
  admin: SupabaseClient,
  opts: { token: string | null; expectedToken: string | undefined; portFor?: SyncOpts['portFor'] },
): Promise<GcalSyncHandlerResult> {
  if (!opts.expectedToken || !opts.token || !safeTokenEqual(opts.token, opts.expectedToken)) {
    return { status: 401, body: { ok: false, detail: 'token inválido' } }
  }
  const results = await syncGoogleCalendars(admin, { portFor: opts.portFor })
  return { status: 200, body: { ok: true, teachers: results.length, results } }
}

// ---------------------------------------------------------------------------
// Leitura dos afazeres (ADR-017/M5) — grades e checagem de publicação.
// ---------------------------------------------------------------------------
export type GoogleBusy =
  | { status: 'ok'; blocks: BusyBlock[] }
  | { status: 'desconectada' }
  | { status: 'indisponivel' } // conectada, mas Google/config falhou AGORA — fail-open com aviso

export async function googleBusyForTeacher(
  admin: SupabaseClient,
  teacherId: string,
  range: { fromUtcISO: string; toUtcISO: string },
  portFor?: SyncOpts['portFor'],
): Promise<GoogleBusy> {
  const { data: acct } = await admin
    .from('teacher_google_accounts')
    .select('refresh_token_cipher')
    .eq('teacher_id', teacherId)
    .maybeSingle()
  if (!acct) return { status: 'desconectada' }

  const cfg = googleOAuthConfigFromEnv()
  const key = tokenKeyFromEnv()
  if (!cfg || !key) return { status: 'indisponivel' }
  try {
    const token = decryptToken(acct.refresh_token_cipher, key)
    const port = portFor ? portFor(token) : gcalPortFromAuth(googleAuthForRefresh(cfg, token))
    return { status: 'ok', blocks: await googleBusyBlocks(port, range) }
  } catch {
    return { status: 'indisponivel' }
  }
}

export type WindowGoogleCheck =
  | { status: 'livre' }
  | { status: 'ocupado'; clashStartUtc: string }
  | { status: 'desconectada' }
  | { status: 'indisponivel' }

/**
 * Checagem ao PUBLICAR janela: compromisso pessoal no Google no mesmo horário?
 * Mesma régua de windowPublishConflict (45min presumidos, offset DAQUELE dia —
 * Lei 1/Luxon). Antecipação de UX apenas: afazer não é regra de banco; se o
 * Google estiver fora do ar, quem chama publica com AVISO (fail-open) — a
 * agenda da professora não pode travar por indisponibilidade de terceiro.
 */
export async function googleWindowClash(
  admin: SupabaseClient,
  teacherId: string,
  localDate: string,
  localTime: string,
  portFor?: SyncOpts['portFor'],
): Promise<WindowGoogleCheck> {
  const { data: teacher } = await admin
    .from('teachers')
    .select('iana_tz')
    .eq('id', teacherId)
    .maybeSingle()
  if (!teacher?.iana_tz) return { status: 'indisponivel' }

  const start = DateTime.fromISO(`${localDate}T${localTime}`, { zone: teacher.iana_tz }).toUTC()
  if (!start.isValid) return { status: 'indisponivel' }
  const end = start.plus({ minutes: 45 })

  const busy = await googleBusyForTeacher(
    admin,
    teacherId,
    { fromUtcISO: start.toISO()!, toUtcISO: end.toISO()! },
    portFor,
  )
  if (busy.status !== 'ok') return busy
  const clash = busy.blocks.find(
    (b) => Date.parse(b.startUtc) < end.toMillis() && Date.parse(b.endUtc) > start.toMillis(),
  )
  return clash ? { status: 'ocupado', clashStartUtc: clash.startUtc } : { status: 'livre' }
}
