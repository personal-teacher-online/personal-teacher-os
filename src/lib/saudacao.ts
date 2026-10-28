/**
 * Saudação pela hora LOCAL de quem está lendo.
 *
 * A versão anterior era `hour < 12 ? 'Bom dia' : …`, que cumprimenta com
 * "Bom dia" à meia-noite e dez — pego na varredura de 22/07/2026. Em pt-BR a
 * madrugada ainda é noite: "Bom dia" começa por volta das 5h.
 */
export function saudacaoPara(hour: number): 'Bom dia' | 'Boa tarde' | 'Boa noite' {
  if (hour < 5) return 'Boa noite'
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

/**
 * Primeiro nome para "Bom dia, <nome>" no início do admin. Sem `full_name` no
 * perfil, usa o nome da dona vindo da configuração (`SCHOOL_OWNER_NAME`); sem a
 * env, o padrão neutro "Professora" (o repositório não carrega nome de pessoa).
 */
export function nomeParaSaudacao(
  fullName: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  const doPerfil = (fullName ?? '').trim().split(' ')[0]
  if (doPerfil) return doPerfil
  return env.SCHOOL_OWNER_NAME?.trim() || 'Professora'
}
