// Lista local de nomes de pessoas reais (`scripts/vazamento-nomes.txt`, fora do git),
// com a MESMA convenção do scanner `scripts/vazamento.py`: um termo por linha, `#`
// comenta, comparação sem acento, sem caixa e com espaço, `.`, `_` ou `-` entre as
// palavras. Numa worktree o arquivo só existe na pasta principal, por isso também se
// procura ao lado do `.git` comum. Na CI o arquivo não existe e a lista vem da variável
// `PT_NOMES_PROIBIDOS`; sem nenhum dos dois volta `null`, o chamador avisa uma vez e fica
// só com a checagem dos nomes fictícios.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOME = 'vazamento-nomes.txt'

function caminhos(): string[] {
  const lista = [path.join(RAIZ, 'scripts', NOME)]
  try {
    const comum = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: RAIZ })
      .toString()
      .trim()
    lista.push(path.join(path.dirname(comum), 'scripts', NOME))
  } catch {
    // sem git: só o caminho ao lado do teste
  }
  return lista
}

export function semAcento(texto: string): string {
  return texto.normalize('NFKD').replace(/\p{M}/gu, '')
}

/** Termos da lista local somados aos da variável `PT_NOMES_PROIBIDOS` (mesmo formato; é como a
 *  lista chega na CI); `null` quando não há arquivo nem variável com termo. */
export function termosProibidos(): string[] | null {
  const fontes = caminhos()
    .filter((c) => existsSync(c))
    .map((c) => readFileSync(c, 'utf8'))
  const ambiente = process.env.PT_NOMES_PROIBIDOS ?? ''
  const achados = fontes.length
  fontes.push(ambiente)
  const termos: string[] = []
  for (const texto of fontes) {
    for (const bruta of texto.split('\n')) {
      const termo = bruta.split('#', 1)[0].trim()
      if (/\w/.test(termo) && !termos.includes(termo)) termos.push(termo)
    }
  }
  return termos.length === 0 && achados === 0 ? null : termos
}

/** Literais liberados pelo scanner (ex.: "Teacher Vicky"): somem do texto antes da busca. */
function liberados(): string[] {
  const arq = path.join(RAIZ, 'scripts', 'vazamento-excecoes.txt')
  if (!existsSync(arq)) return []
  return readFileSync(arq, 'utf8')
    .split('\n')
    .map((l) => l.split('#', 1)[0].trim())
    .filter((l) => l && !l.includes('@') && /[A-Za-z]/.test(l))
}

/** Regex do termo na convenção do scanner: palavras sem acento, sem caixa, unidas por espaço, `.`, `_` ou `-`. */
function regexDoTermo(termo: string, flags: string): RegExp | null {
  const palavras = semAcento(termo)
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (palavras.length === 0) return null
  return new RegExp(`(?<![A-Za-z0-9])${palavras.join('[\\s._-]+')}(?![A-Za-z0-9])`, flags)
}

/** Termos da lista que aparecem no texto, na convenção do scanner (os literais liberados, como
 *  "Teacher Vicky", saem antes com a mesma regra: sem caixa e com qualquer separador). */
export function nomesNoTexto(texto: string, termos: string[]): string[] {
  let limpo = semAcento(texto)
  for (const l of liberados()) {
    const re = regexDoTermo(l, 'gi')
    if (re) limpo = limpo.replace(re, ' ')
  }
  return termos.filter((termo) => regexDoTermo(termo, 'i')?.test(limpo) ?? false)
}

let avisado = false
/** Avisa uma vez por processo que a lista local não existe. */
export function avisarSemLista(onde: string): void {
  if (avisado) return
  avisado = true
  console.warn(`[${onde}] scripts/${NOME} ausente e PT_NOMES_PROIBIDOS vazia: a checagem de nomes reais só roda com a lista`)
}
