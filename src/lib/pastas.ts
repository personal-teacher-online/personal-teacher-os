// Onde moram as pastas de marca (`brand/`) e de conteúdo (`content/`) que o
// motor de slides lê por CLI. Plano do repositório público (§4): elas podem sair
// do repositório e morar ao lado, no privado, então o caminho vem de configuração.
// Só o motor de slides por CLI e os testes importam este módulo (nada de
// `src/app` nem `src/data`; ADR-027), por isso falhar na carga é seguro.
//
// Precedência:
//   1. env (`PT_BRAND_DIR` / `PT_CONTENT_DIR`);
//   2. a pasta dentro do repositório, enquanto ela existir (hoje: tudo como era);
//   3. a pasta do repositório privado vizinho (`../personal-teacher-os-privado`),
//      contado a partir do repositório PRINCIPAL: numa worktree (`.git` é
//      arquivo, não pasta) sobe até o repositório de verdade.
// Em qualquer caso a pasta precisa ter o marcador dela (`logos/`, `personal-travel/`):
// pasta vazia que existe dá erro claro aqui, e não "Unable to read media" no meio
// da montagem do deck. Sem achar nada, falha dizendo onde procurou.
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

type Pasta = 'brand' | 'content'
type Env = Record<string, string | undefined>

const ROTULO: Record<Pasta, { env: string; nome: string; marcador: string }> = {
  brand: { env: 'PT_BRAND_DIR', nome: 'marca', marcador: 'logos' },
  content: { env: 'PT_CONTENT_DIR', nome: 'conteúdo', marcador: 'personal-travel' },
}

const REPO_PRIVADO = 'personal-teacher-os-privado'

const temMarcador = (caminho: string, marcador: string) => existsSync(join(caminho, marcador))

/** Raiz do repositório principal: sobe até achar um `.git` que seja PASTA (numa worktree ele é arquivo). */
function raizDoRepositorioPrincipal(raiz: string): string {
  let atual = resolve(raiz)
  for (;;) {
    const git = join(atual, '.git')
    if (existsSync(git) && statSync(git).isDirectory()) return atual
    const pai = dirname(atual)
    if (pai === atual) return resolve(raiz)
    atual = pai
  }
}

function resolverPasta(pasta: Pasta, raiz: string, env: Env): string {
  const { env: variavel, nome, marcador } = ROTULO[pasta]
  const dita = env[variavel]?.trim()
  if (dita) {
    const caminho = resolve(dita)
    if (!temMarcador(caminho, marcador)) {
      throw new Error(
        `pasta de ${nome} não encontrada em ${caminho} (veja ${variavel}; ela precisa ter "${marcador}/" dentro)`,
      )
    }
    return caminho
  }
  const dentro = join(raiz, pasta)
  if (temMarcador(dentro, marcador)) return dentro
  const vizinha = join(raizDoRepositorioPrincipal(raiz), '..', REPO_PRIVADO, pasta)
  if (temMarcador(vizinha, marcador)) return resolve(vizinha)
  throw new Error(
    `pasta de ${nome} não encontrada em ${dentro} nem em ${resolve(vizinha)} ` +
      `(defina ${variavel} com a pasta que tem "${marcador}/" dentro)`,
  )
}

/** `brand/` (logos, fontes, biblioteca de fotos dos decks). */
export function pastaDeMarca(raiz: string = process.cwd(), env: Env = process.env): string {
  return resolverPasta('brand', raiz, env)
}

/** `content/` (as aulas JSON do curso). */
export function pastaDeConteudo(raiz: string = process.cwd(), env: Env = process.env): string {
  return resolverPasta('content', raiz, env)
}
