import { describe, it, expect } from 'vitest'
import { rascunhoEmVoo, DRAFT_TTL_MS } from '@/lib/slides/draft-state'

// Guarda anti-reentrada do rascunho por IA assíncrono (after()). Puro: a action
// bloqueia um novo rascunho enquanto true; a página desabilita o botão.
describe('rascunhoEmVoo — guarda anti-reentrada do rascunho por IA', () => {
  const now = Date.UTC(2026, 6, 24, 12, 0, 0)
  const iso = (msAtras: number) => new Date(now - msAtras).toISOString()

  it('null/undefined/vazio = NÃO está em voo (ocioso)', () => {
    expect(rascunhoEmVoo(null, now)).toBe(false)
    expect(rascunhoEmVoo(undefined, now)).toBe(false)
    expect(rascunhoEmVoo('', now)).toBe(false)
  })

  it('iniciado agora / há poucos minutos = EM VOO (bloqueia)', () => {
    expect(rascunhoEmVoo(iso(0), now)).toBe(true)
    expect(rascunhoEmVoo(iso(60_000), now)).toBe(true) // 1 min
    expect(rascunhoEmVoo(iso(9 * 60_000), now)).toBe(true) // 9 min
  })

  it('mais velho que o teto (queda do processo) = LIBERA nova tentativa', () => {
    expect(rascunhoEmVoo(iso(DRAFT_TTL_MS + 1), now)).toBe(false)
    expect(rascunhoEmVoo(iso(30 * 60_000), now)).toBe(false)
  })

  it('borda EXATA do teto = liberado (< estrito)', () => {
    expect(rascunhoEmVoo(iso(DRAFT_TTL_MS), now)).toBe(false)
    expect(rascunhoEmVoo(iso(DRAFT_TTL_MS - 1), now)).toBe(true)
  })

  it('timestamp inválido = NÃO trava o operador (fail-open p/ tentativa)', () => {
    expect(rascunhoEmVoo('não-é-data', now)).toBe(false)
  })

  it('o teto é 15 minutos (> pior caso de 1 tentativa + retry do SDK)', () => {
    expect(DRAFT_TTL_MS).toBe(15 * 60_000)
  })
})
