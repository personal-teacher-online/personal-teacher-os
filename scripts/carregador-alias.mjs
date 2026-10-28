// Carregador mínimo para scripts que importam código do app (Onda Agenda e
// Mensagens · M3-4).
//
// Os scripts da casa rodam no `node` puro (type stripping) e importam `src/`
// por caminho relativo com `.ts` explícito. O código do app não segue essa
// regra: usa o alias `@/` (tsconfig/Next) e imports relativos sem extensão.
// Este hook resolve as duas coisas e nada além delas — `@/x` vira `src/x`, e
// um caminho sem extensão ganha `.ts` (ou `/index.ts`) quando o arquivo existe.
//
// Uso: node --import ./scripts/carregador-alias.mjs scripts/<script>.ts

import { existsSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const SRC = new URL('../src/', import.meta.url)

/** O arquivo de verdade por trás de um caminho sem extensão (ou null). */
function comExtensao(url) {
  for (const sufixo of ['', '.ts', '.tsx', '/index.ts']) {
    const candidato = new URL(url.href + sufixo)
    const caminho = fileURLToPath(candidato)
    if (existsSync(caminho) && statSync(caminho).isFile()) return candidato.href
  }
  return null
}

registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador.startsWith('@/')) {
      const alvo = comExtensao(new URL(especificador.slice(2), SRC))
      if (alvo) return proximo(alvo, contexto)
    }
    // Só o código da casa: pacote de node_modules resolve do jeito dele.
    const daCasa = contexto.parentURL && !contexto.parentURL.includes('/node_modules/')
    if ((especificador.startsWith('./') || especificador.startsWith('../')) && daCasa) {
      const alvo = comExtensao(new URL(especificador, contexto.parentURL))
      if (alvo) return proximo(alvo, contexto)
    }
    return proximo(especificador, contexto)
  },
})
