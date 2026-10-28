import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Comparação de token em tempo constante (hardening do painel final da Fase 3):
 * `!==` tem early-exit byte a byte e, em teoria, vaza o prefixo por timing.
 * Hash SHA-256 dos dois lados iguala os comprimentos (timingSafeEqual exige
 * buffers do mesmo tamanho) sem vazar o tamanho do segredo.
 *
 * PADRÃO ÚNICO da casa (P3/ADR-015): todo endpoint máquina-a-máquina com token
 * próprio (webhook Asaas, dispatch-outbox, futuros) compara por AQUI. O guard
 * fail-closed (`!expected || !token`) fica no CHAMADOR, ANTES desta função.
 */
export function safeTokenEqual(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}
