import { google, type calendar_v3 } from 'googleapis'
import type { DesiredEvent, GcalEventLite, GcalPort } from './calendar'
import type { GoogleOAuthClient } from './oauth'

// Adaptador googleapis → GcalPort (ADR-017). SÓ tradução de formato — a lógica
// (diff/idempotência/privacidade) vive em calendar.ts, coberta pelo Vitest.
// Fatos da doc oficial (14/07/2026): events.list aceita privateExtendedProperty
// "chave=valor" (só propriedades privadas); extendedProperties.private grava no
// insert/patch; transparency 'transparent' não bloqueia ocupado/livre.
// Backoff 429/403 de quota: mesmo padrão truncado de slides.ts.

const PTOS_FLAG = 'ptos'
const PTOS_KEY = 'ptos_key'

async function withBackoff<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown
  for (let n = 0; n < tries; n++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const status = err as { code?: number; response?: { status?: number } }
      const code = status.code ?? status.response?.status
      if (code !== 429 && code !== 403) throw err
      await new Promise((r) => setTimeout(r, Math.min(2 ** n * 1000 + Math.random() * 250, 8000)))
    }
  }
  throw lastErr
}

function toLite(ev: calendar_v3.Schema$Event): GcalEventLite {
  return {
    id: ev.id ?? '',
    key: ev.extendedProperties?.private?.[PTOS_KEY] ?? null,
    startUtc: ev.start?.dateTime ?? null, // evento de dia inteiro (afazer) vem sem dateTime
    endUtc: ev.end?.dateTime ?? null,
    summary: ev.summary ?? null,
    transparent: ev.transparency === 'transparent',
    meetUrl: ev.hangoutLink ?? null, // F11: gravado na aula pelo sync
  }
}

function toBody(ev: DesiredEvent): calendar_v3.Schema$Event {
  return {
    summary: ev.summary,
    start: { dateTime: ev.startUtc, timeZone: 'UTC' }, // instante UTC; o Google exibe no fuso DELA
    end: { dateTime: ev.endUtc, timeZone: 'UTC' },
    transparency: ev.transparent ? 'transparent' : 'opaque',
    extendedProperties: { private: { [PTOS_FLAG]: '1', [PTOS_KEY]: ev.key } },
  }
}

/** Porta sobre a agenda PRINCIPAL ('primary') da conta conectada. */
export function gcalPortFromAuth(auth: GoogleOAuthClient): GcalPort {
  const cal = google.calendar({ version: 'v3', auth })

  async function listEvents(params: calendar_v3.Params$Resource$Events$List): Promise<GcalEventLite[]> {
    const out: GcalEventLite[] = []
    let pageToken: string | undefined
    do {
      const { data } = await withBackoff(() =>
        // timeout: página/action nunca pendura esperando o Google (fail-open lá).
        cal.events.list(
          {
            calendarId: 'primary',
            singleEvents: true, // expande recorrentes (afazer semanal dela vira instâncias)
            maxResults: 2500,
            pageToken,
            ...params,
          },
          { timeout: 8000 },
        ),
      )
      for (const ev of data.items ?? []) {
        if (ev.status !== 'cancelled') out.push(toLite(ev))
      }
      pageToken = data.nextPageToken ?? undefined
    } while (pageToken)
    return out
  }

  return {
    listOurs: (fromUtcISO, toUtcISO) =>
      listEvents({
        timeMin: fromUtcISO,
        timeMax: toUtcISO,
        privateExtendedProperty: [`${PTOS_FLAG}=1`],
      }),
    listAll: (fromUtcISO, toUtcISO) => listEvents({ timeMin: fromUtcISO, timeMax: toUtcISO }),
    insert: async (ev) => {
      // F11/M13: aula ganha Meet no PRÓPRIO evento (conferenceData); o id/link
      // voltam para o sync gravar na aula (o robô do M15 casa por ele).
      const body = toBody(ev)
      if (ev.meet) {
        body.conferenceData = {
          createRequest: { requestId: ev.key, conferenceSolutionKey: { type: 'hangoutsMeet' } },
        }
      }
      const { data } = await withBackoff(() =>
        cal.events.insert(
          { calendarId: 'primary', requestBody: body, conferenceDataVersion: ev.meet ? 1 : 0 },
          { timeout: 8000 },
        ),
      )
      return { id: data.id ?? '', meetUrl: data.hangoutLink ?? null }
    },
    patch: async (id, ev) => {
      await withBackoff(() => cal.events.patch({ calendarId: 'primary', eventId: id, requestBody: toBody(ev) }, { timeout: 8000 }))
    },
    remove: async (id) => {
      await withBackoff(() => cal.events.delete({ calendarId: 'primary', eventId: id }, { timeout: 8000 }))
    },
  }
}
