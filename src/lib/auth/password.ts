// Regras de senha — puras, sem Next/Supabase (mesmo padrão do gate.ts).
// Espelham o GOTRUE_PASSWORD_MIN_LENGTH: validação de UX; quem barra de verdade é o
// GoTrue (mesmo racional do shouldCreateUser no convite D6).

export const MIN_PASSWORD_LENGTH = 8

/** Item 6 do e2e (política CLÁSSICA ratificada na Leva 0, 18/07/2026):
 *  mínimo 8 + maiúscula + minúscula + número + símbolo. Espelhada no GoTrue
 *  (password_requirements = lower_upper_letters_digits_symbols) — a UI, o
 *  servidor da action e o Auth contam a MESMA história. */
export const PASSWORD_RULES = [
  { key: 'len', label: `${MIN_PASSWORD_LENGTH}+ caracteres`, test: (p: string) => p.length >= MIN_PASSWORD_LENGTH },
  { key: 'lower', label: 'letra minúscula', test: (p: string) => /[a-zà-öø-ÿ]/.test(p) },
  { key: 'upper', label: 'letra MAIÚSCULA', test: (p: string) => /[A-ZÀ-ÖØ-Þ]/.test(p) },
  { key: 'digit', label: 'número', test: (p: string) => /\d/.test(p) },
  // conjunto EXPLÍCITO = o mesmo da env GOTRUE_PASSWORD_REQUIRED_CHARACTERS em
  // produção (sem ' " \ ` : — quebravam o .env do Coolify); camadas idênticas.
  { key: 'symbol', label: 'caractere especial (!@#…)', test: (p: string) => /[!@#$%^&*()_+\-=[\]{};|<>?,./~]/.test(p) },
] as const

export function passwordMissing(password: string): string[] {
  return PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label)
}

export type PasswordPairError = 'curta' | 'fraca' | 'nao-confere'

export function validatePasswordPair(
  password: string,
  confirm: string,
): PasswordPairError | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'curta'
  if (passwordMissing(password).length > 0) return 'fraca'
  if (password !== confirm) return 'nao-confere'
  return null
}
