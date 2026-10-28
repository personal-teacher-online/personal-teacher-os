// Item 14.6 — subtração ocupada×aulas: eco/manual some, compromisso real fica.
import { describe, expect, it } from 'vitest'
import { subtractBusy } from '@/lib/google/busy-subtract'

const iv = (s: string, e: string) => ({ startUtc: s, endUtc: e })

describe('subtractBusy', () => {
  it('busy idêntico à aula desaparece (o eco do print do e2e)', () => {
    const out = subtractBusy(
      [iv('2026-07-20T18:30:00Z', '2026-07-20T19:15:00Z')],
      [iv('2026-07-20T18:30:00Z', '2026-07-20T19:15:00Z')],
    )
    expect(out).toHaveLength(0)
  })

  it('compromisso maior que a aula deixa as SOBRAS (antes e depois)', () => {
    const out = subtractBusy(
      [iv('2026-07-20T18:00:00Z', '2026-07-20T20:00:00Z')],
      [iv('2026-07-20T18:30:00Z', '2026-07-20T19:15:00Z')],
    )
    expect(out).toEqual([
      iv('2026-07-20T18:00:00.000Z', '2026-07-20T18:30:00.000Z'),
      iv('2026-07-20T19:15:00.000Z', '2026-07-20T20:00:00.000Z'),
    ])
  })

  it('sobra menor que 10min é descartada (ruído visual)', () => {
    const out = subtractBusy(
      [iv('2026-07-20T18:25:00Z', '2026-07-20T19:20:00Z')],
      [iv('2026-07-20T18:30:00Z', '2026-07-20T19:15:00Z')],
    )
    expect(out).toHaveLength(0)
  })

  it('busy sem aula alguma fica intacto; duas aulas fatiam um busy longo', () => {
    expect(
      subtractBusy([iv('2026-07-20T10:00:00Z', '2026-07-20T11:00:00Z')], []),
    ).toHaveLength(1)
    const out = subtractBusy(
      [iv('2026-07-20T12:00:00Z', '2026-07-20T16:00:00Z')],
      [iv('2026-07-20T12:30:00Z', '2026-07-20T13:15:00Z'), iv('2026-07-20T14:00:00Z', '2026-07-20T14:45:00Z')],
    )
    expect(out).toHaveLength(3)
  })
})
