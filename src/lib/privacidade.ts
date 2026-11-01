// Dados fixos da política de privacidade pública (`/privacidade`).
//
// A DATA É ESCRITA NO CÓDIGO, não vem de `now()`: "última atualização" só pode
// mudar quando o texto muda. Quem edita o texto da política atualiza esta
// constante no mesmo commit.
export const PRIVACIDADE_ATUALIZADA_EM = '01/11/2026'

/** Canal de atendimento para pedidos de titular (acesso, correção, exclusão). */
export const PRIVACIDADE_EMAIL = 'contato@pteacheracademy.com'

export interface Controladora {
  razaoSocial: string | null
  cnpj: string | null
}

/** Valor de env utilizável: não vazio e nunca um marcador de "preencher depois". */
function valorUtil(bruto: string | undefined): string | null {
  const valor = (bruto ?? '').trim()
  if (!valor || valor.includes('[[')) return null
  return valor
}

/**
 * Razão social e CNPJ da controladora, lidos de `PRIVACIDADE_RAZAO_SOCIAL` e
 * `PRIVACIDADE_CNPJ`. Dado real não entra no repositório público: a dona
 * preenche pelo ambiente do servidor. Sem a env (ou com um marcador no lugar),
 * o campo vem `null` e a página mostra só o nome fantasia.
 */
export function controladoraDe(env: Record<string, string | undefined>): Controladora {
  return {
    razaoSocial: valorUtil(env.PRIVACIDADE_RAZAO_SOCIAL),
    cnpj: valorUtil(env.PRIVACIDADE_CNPJ),
  }
}
