// Estado do rascunho por IA ASSÍNCRONO (after()) — lógica pura e testável,
// compartilhada entre a action (guarda anti-reentrada) e a página (botão e
// mensagem de erro). Não importa nada de servidor de propósito.

/** Teto de vida de um rascunho em voo. O after() não tem retomada em v1: se o
 *  processo cair no meio, draft_started_at fica preso; passado este teto a
 *  reivindicação atômica (e a UI) tratam como queda e LIBERAM nova tentativa.
 *  15min > pior caso de 1 tentativa + retry inicial do SDK Anthropic (timeout
 *  10min). Com a POSSE POR TOKEN, liberar cedo deixou de ser corrupção: um job
 *  velho que perdeu o token afeta 0 linhas e não consegue mais escrever. */
export const DRAFT_TTL_MS = 15 * 60_000

/**
 * true se um rascunho iniciado em `startedAt` ainda está dentro da janela de
 * execução — bloqueia a reentrada na action e mantém o botão em "Rascunhando…".
 * Tolerante a null/valor inválido (nesses casos: NÃO está em voo).
 */
export function rascunhoEmVoo(
  startedAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!startedAt) return false
  const t = new Date(startedAt).getTime()
  return Number.isFinite(t) && now - t < DRAFT_TTL_MS
}
