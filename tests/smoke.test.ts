import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'

describe('scaffold smoke', () => {
  it('roda com TZ=UTC forçado', () => {
    expect(process.env.TZ).toBe('UTC')
    expect(new Date().getTimezoneOffset()).toBe(0)
  })

  it('luxon resolve zonas IANA do domínio', () => {
    for (const zone of [
      'America/Cuiaba',
      'America/Campo_Grande',
      'America/Sao_Paulo',
      'America/Fortaleza',
      'America/New_York',
      'Europe/Lisbon',
    ]) {
      expect(DateTime.local({ zone }).isValid).toBe(true)
    }
  })
})
