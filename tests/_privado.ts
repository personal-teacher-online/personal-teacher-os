// Insumo privado dos testes de slides: as pastas `brand/` e `content/`.
//
// No repositório público elas não existem (plano do repositório público, §4:
// moram em `personal-teacher-os-privado`). Os testes que as leem pulam, com UM
// aviso, em vez de quebrar; onde as pastas existem (bancada do dono, CI do
// privado) rodam todos os casos. A resolução é a MESMA do motor de slides
// (`src/lib/pastas.ts`: env, pasta do repositório, privado vizinho), nunca um
// `existsSync('content')` solto em cada teste.
//
// Uso:  const { presente, content, brand } = privado
//       describe.skipIf(!presente)('...', () => { ... join(content, 'personal-travel', 'x.json') ... })
// Módulos que resolvem a pasta na carga (template.ts, build.ts, resolve.ts)
// entram por `carregarSePresente(() => import(...))`, para não derrubar o arquivo.
import { it } from 'vitest'
import { pastaDeConteudo, pastaDeMarca } from '../src/lib/pastas'

type Env = Record<string, string | undefined>
type Privado = { presente: boolean; content: string; brand: string; avisos: string[] }

export function resolverPrivado(raiz: string = process.cwd(), env: Env = process.env): Privado {
  const avisos: string[] = []
  const tenta = (pasta: () => string, variavel: string, nome: string): string => {
    try {
      return pasta()
    } catch {
      avisos.push(`pasta ${nome} ausente (defina ${variavel} com o caminho dela)`)
      return ''
    }
  }
  const content = tenta(() => pastaDeConteudo(raiz, env), 'PT_CONTENT_DIR', 'content/')
  const brand = tenta(() => pastaDeMarca(raiz, env), 'PT_BRAND_DIR', 'brand/')
  return { presente: avisos.length === 0, content, brand, avisos }
}

export const privado = resolverPrivado()
export const { presente, content, brand } = privado

/** Avisador de "pulado" que escreve no máximo UMA vez (cada arquivo de teste é um módulo isolado no vitest). */
export function criarAvisador(escrever: (msg: string) => void = (m) => console.warn(m)) {
  let avisou = false
  return (r: Privado): boolean => {
    if (r.presente || avisou) return false
    avisou = true
    escrever(`[testes de slides pulados] ${r.avisos.join('; ')}`)
    return true
  }
}
const emitirAviso = criarAvisador()

// O reporter padrão do vitest NÃO mostra console de arquivo inteiro pulado, só o
// de teste que RODOU: por isso o aviso sai de um `it` sempre ativo.
if (!presente) {
  it('insumo privado ausente: casos de slides pulados (veja o aviso acima)', () => {
    emitirAviso(privado)
  })
}

/** Importa o módulo só quando o insumo privado está presente; ausente, devolve `{}` (os casos estão pulados). */
export async function carregarSePresente<T>(importar: () => Promise<T>): Promise<T> {
  return presente ? await importar() : ({} as T)
}
