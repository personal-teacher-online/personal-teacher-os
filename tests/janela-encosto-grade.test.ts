// Issue #85 — as telas ANTECIPAM a recusa de encosto (Lei 3: quem decide é o
// banco, provado em `tests/janela-encosto-outras-portas.test.ts`):
//
//   · a grade calculada (`availableSlots`, portal e admin) não oferece horário
//     computado que encoste em janela publicada da professora, com a medida do
//     banco (`teacher_window_span_min`) e nunca menos que a aula;
//   · o painel da professora não oferece publicar janela que encoste em aula
//     marcada dela (`aulaQueEncosta`, a conta de `windowPublishConflict`).
import { DateTime } from 'luxon'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/google/sync', () => ({
  googleBusyForTeacher: async () => ({ status: 'indisponivel' as const }),
}))

const { availableSlots } = await import('@/lib/portal/computed-slots')
const { aulaQueEncosta, janelaEncosta, medidaDaJanelaMs, quandoNaRecusa } = await import('@/lib/windows')

const PROFESSORA = '11111111-1111-1111-1111-111111111111'
const CUIABA = 'America/Cuiaba'
/** 2026-07-28 é uma TERÇA; 18:00Z = 14:00 em Cuiabá (−4 o ano inteiro). */
const AGORA = '2026-07-28T18:00:00Z'
/** Quinta 30/07, 10:00 em Cuiabá. */
const JANELA = '2026-07-30T14:00:00Z'
const QUARENTA_E_CINCO = 45 * 60_000

interface Resposta {
  data?: unknown
  error?: { message: string } | null
}

/** Cliente falso: uma resposta por tabela (o formato do PostgREST). */
function clienteCom(respostas: Record<string, Resposta>): SupabaseClient {
  const consulta = (r: Resposta) => {
    const eu: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'gt', 'gte', 'lt', 'lte', 'order', 'limit']) eu[m] = () => eu
    eu.maybeSingle = () => eu
    eu.then = <A, B>(ok: (v: unknown) => A, falha?: (e: unknown) => B) =>
      Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(ok, falha)
    return eu
  }
  return { from: (tabela: string) => consulta(respostas[tabela] ?? { data: [] }) } as unknown as SupabaseClient
}

/** O cliente do servidor: só a medida da janela. Guarda quem a pediu. */
function servidorCom(medida: Resposta, chamadas: unknown[][] = []): SupabaseClient {
  return {
    rpc: async (...args: unknown[]) => {
      chamadas.push(args)
      return { data: medida.data ?? null, error: medida.error ?? null }
    },
  } as unknown as SupabaseClient
}

const AGENDA = {
  reschedule_windows: { data: [{ id: 'w-1', starts_at_utc: JANELA }] },
  class_instances: { data: [] },
  teacher_public: { data: { min_booking_lead_hours: 12 } },
  // quinta, 09:00–12:00 em Cuiabá
  teacher_weekly_availability: {
    data: [{ weekday: 4, start_local: '09:00:00', end_local: '12:00:00', iana_tz: CUIABA }],
  },
  teacher_availability_exceptions: { data: [] },
}

/** Os horários COMPUTADOS (sem janela) de 30/07, em civil de Cuiabá. */
function computadosDoDia(slots: { startsAtUtc: string; windowId: string | null }[]): string[] {
  return slots
    .filter((s) => s.windowId === null)
    .map((s) => DateTime.fromISO(s.startsAtUtc).setZone(CUIABA))
    .filter((d) => d.toFormat('dd/LL') === '30/07')
    .map((d) => d.toFormat('HH:mm'))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(AGORA))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('grade calculada · horário computado que encosta em janela publicada', () => {
  it('janela das 10:00 medida em 45: 09:30 e 10:30 saem; 09:00, 11:00 e a própria janela ficam', async () => {
    const chamadas: unknown[][] = []
    const r = await availableSlots(clienteCom(AGENDA), servidorCom({ data: 45 }, chamadas), PROFESSORA, {
      durationMs: QUARENTA_E_CINCO,
    })
    expect(r.erro).toBe(false)
    const horas = computadosDoDia(r.dado!.slots)
    expect(horas).not.toContain('09:30') // 09:30–10:15 engole o começo da janela
    expect(horas).not.toContain('10:30') // começa dentro de 10:00–10:45
    // PROVA DE MUTAÇÃO: as bordas meia-abertas continuam oferecidas
    expect(horas).toContain('09:00') // termina 09:45
    expect(horas).toContain('11:00')
    // a janela publicada continua oferecida (reservá-la é consumi-la)
    expect(r.dado!.slots.some((s) => s.windowId === 'w-1')).toBe(true)
    // a medida é lida pelo cliente do SERVIDOR (o aluno não tem a porta D10 dela)
    expect(chamadas).toEqual([['teacher_window_span_min', { p_teacher: PROFESSORA }]])
  })

  it('a medida é a MAIOR duração da agenda dela: com 90, 11:00 também encosta (10:00–11:30)', async () => {
    const r = await availableSlots(clienteCom(AGENDA), servidorCom({ data: 90 }), PROFESSORA, {
      durationMs: QUARENTA_E_CINCO,
    })
    const horas = computadosDoDia(r.dado!.slots)
    expect(horas).not.toContain('11:00')
    expect(horas).toContain('09:00')
  })

  it('nunca menos que a aula: medida NULL e aula de 45 ainda tiram 10:30', async () => {
    const r = await availableSlots(clienteCom(AGENDA), servidorCom({ data: null }), PROFESSORA, {
      durationMs: QUARENTA_E_CINCO,
    })
    expect(computadosDoDia(r.dado!.slots)).not.toContain('10:30')
  })

  it('a medida que FALHA vira erro da grade (régua do S4), nunca oferta sem conferir', async () => {
    const r = await availableSlots(
      clienteCom(AGENDA),
      servidorCom({ error: { message: 'timeout' } }),
      PROFESSORA,
      { durationMs: QUARENTA_E_CINCO },
    )
    expect(r.erro).toBe(true)
    expect(r.dado).toBeNull()
  })

  it('sem janela publicada a medida nem é lida, e a grade sai inteira', async () => {
    const chamadas: unknown[][] = []
    const r = await availableSlots(
      clienteCom({ ...AGENDA, reschedule_windows: { data: [] } }),
      servidorCom({ data: 45 }, chamadas),
      PROFESSORA,
      { durationMs: QUARENTA_E_CINCO },
    )
    expect(chamadas).toHaveLength(0)
    expect(computadosDoDia(r.dado!.slots)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00'])
  })
})

describe('painel da professora · a janela que encostaria em aula marcada', () => {
  const aula = { starts_at_utc: '2026-07-30T14:30:00Z', ends_at_utc: '2026-07-30T15:15:00Z' } // 10:30–11:15

  it('10:00 com medida 45 encosta na aula das 10:30; 09:45 e 11:15 não', () => {
    expect(aulaQueEncosta(Date.parse('2026-07-30T14:00:00Z'), 45, [aula])).toBe(aula)
    expect(aulaQueEncosta(Date.parse('2026-07-30T13:45:00Z'), 45, [aula])).toBeNull()
    expect(aulaQueEncosta(Date.parse('2026-07-30T15:15:00Z'), 45, [aula])).toBeNull()
  })

  it('aula às 11:00: 10:00 não encosta com 45, encosta com a medida de 61', () => {
    const onze = { starts_at_utc: '2026-07-30T15:00:00Z', ends_at_utc: '2026-07-30T15:45:00Z' }
    expect(aulaQueEncosta(Date.parse('2026-07-30T14:00:00Z'), 45, [onze])).toBeNull()
    expect(aulaQueEncosta(Date.parse('2026-07-30T14:00:00Z'), 61, [onze])).toBe(onze)
  })

  it('medida NULL: a própria aula que cruza mede a janela', () => {
    expect(medidaDaJanelaMs(null, QUARENTA_E_CINCO)).toBe(QUARENTA_E_CINCO)
    // 09:45 + 45 termina no começo da aula; 10:00 + 45 a cruza
    expect(aulaQueEncosta(Date.parse('2026-07-30T13:45:00Z'), null, [aula])).toBeNull()
    expect(aulaQueEncosta(Date.parse('2026-07-30T14:00:00Z'), null, [aula])).toBe(aula)
  })

  it('bordas meia-abertas e o instante da recusa em data humana', () => {
    expect(janelaEncosta(0, 10, 10, 20)).toBe(false)
    expect(janelaEncosta(10, 10, 0, 10)).toBe(false)
    expect(janelaEncosta(0, 10, 9, 20)).toBe(true)
    expect(quandoNaRecusa('… de 2026-11-03 10:30 America/Cuiaba — …')).toBe(' de 03/11 às 10:30')
    expect(quandoNaRecusa('sem instante')).toBe('')
  })
})
