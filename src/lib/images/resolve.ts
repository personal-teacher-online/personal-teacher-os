// IM-2/M1 — o elo entre a biblioteca e o motor de slides.
//
// O renderer monta o deck lendo a foto do DISCO (`brand/slides/library/m7/…`),
// mas a imagem aprovada pelo IM-1 mora no Drive (Lei 10). Sem esta ponte a
// Teacher Vicky aprova uma foto e o deck sai sem ela.
//
// A migration do IM-1 já desenhou a saída: "o conteúdo da aula continua
// apontando para o mesmo caminho de sempre e o renderer ganha uma origem nova
// sem trocar de contrato". Então o ENDEREÇO (`m7/cashier.jpg`) é o que manda, e
// aqui se decide de onde vem o arquivo daquele endereço.
//
// PRECEDÊNCIA: disco primeiro. As 33 fotos já commitadas dos módulos 5–7
// continuam valendo sem depender de rede, de Drive ou de banco.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pastaDeMarca } from '../pastas.ts'
import type { LessonDoc } from '../slides/lesson-schema.ts'

/** raiz da biblioteca commitada, a mesma que o template.ts usa */
export const RAIZ_DISCO = join(pastaDeMarca(), 'slides', 'library')

/** endereço da biblioteca: `pasta/nome.ext` */
export interface Endereco {
  file: string
  folder: string
  name: string
  ext: string
}

/**
 * Onde as imagens baixadas do Drive ficam entre renders. A chave é o id do
 * arquivo no Drive, e imagem aprovada é estado FINAL no banco (o portão do
 * IM-1 não deixa sair de 'aprovada'), então o conteúdo não muda debaixo do
 * cache.
 */
export const CACHE_PADRAO = join(tmpdir(), 'ptos-imagens')

/** de onde sai o arquivo daquele endereço, para o banco responder */
export interface FonteDeImagem {
  /** imagem APROVADA na biblioteca, ou null se não houver */
  aprovada(folder: string, name: string): Promise<{ driveFileId: string } | null>
  /** baixa o conteúdo do arquivo no Drive */
  baixar(driveFileId: string): Promise<Buffer>
}

export class ImagensFaltando extends Error {
  constructor(readonly enderecos: string[]) {
    super(
      `sem imagem para ${enderecos.length === 1 ? 'o endereço' : 'os endereços'}: ${enderecos.join(', ')}. ` +
        'Gere e aprove no painel, ou corrija o endereço no conteúdo da aula.',
    )
    this.name = 'ImagensFaltando'
  }
}

/**
 * Quebra `m7/cashier.jpg` em pasta/nome/extensão. Devolve null quando o formato
 * não é `pasta/nome.ext` — endereço torto vira erro visível, não foto sumida.
 */
export function parseEndereco(file: string): Endereco | null {
  const m = /^([a-z0-9-]+)\/([a-z0-9-]+)(\.[a-z0-9]+)$/.exec(file.trim())
  if (!m) return null
  return { file: file.trim(), folder: m[1], name: m[2], ext: m[3] }
}

/**
 * Todos os endereços de imagem de uma aula.
 *
 * A varredura é GENÉRICA de propósito. Hoje o contrato tem imagem em sete
 * lugares (capa, warmup, dialogue, tip, section, o card de vocabulário e a
 * coluna da direita), e uma lista fixa aqui significaria que o oitavo campo
 * nasceria mudo: o deck sairia sem aquela foto e ninguém saberia. Varrer a
 * árvore inteira custa nada e falha alto.
 */
export function enderecosDoDoc(doc: LessonDoc): string[] {
  const achados = new Set<string>()

  const anda = (no: unknown): void => {
    if (Array.isArray(no)) {
      for (const item of no) anda(item)
      return
    }
    if (!no || typeof no !== 'object') return
    for (const [chave, valor] of Object.entries(no as Record<string, unknown>)) {
      if (chave === 'image') {
        // duas formas no contrato: string crua (card de vocabulário) e
        // { file, caption } (os demais)
        if (typeof valor === 'string') achados.add(valor)
        else if (valor && typeof valor === 'object' && typeof (valor as { file?: unknown }).file === 'string') {
          achados.add((valor as { file: string }).file)
        }
      }
      anda(valor)
    }
  }

  anda(doc.slides)
  return [...achados]
}

/**
 * Resolve TODOS os endereços da aula para caminhos locais.
 *
 * Devolve um mapa endereço → caminho absoluto. Se qualquer endereço não tiver
 * origem (nem disco, nem imagem aprovada), estoura `ImagensFaltando` com a
 * lista completa — nunca resolve pela metade e deixa o deck sair com buraco.
 */
export async function resolverImagens(
  doc: LessonDoc,
  fonte: FonteDeImagem,
  opts: { raizDisco?: string; cacheDir?: string } = {},
): Promise<Map<string, string>> {
  const raizDisco = opts.raizDisco ?? RAIZ_DISCO
  const cacheDir = opts.cacheDir ?? CACHE_PADRAO
  const mapa = new Map<string, string>()
  const faltando: string[] = []

  for (const file of enderecosDoDoc(doc)) {
    const endereco = parseEndereco(file)
    if (!endereco) {
      faltando.push(file)
      continue
    }

    const noDisco = join(raizDisco, endereco.folder, `${endereco.name}${endereco.ext}`)
    if (existsSync(noDisco)) {
      mapa.set(file, noDisco)
      continue
    }

    const aprovada = await fonte.aprovada(endereco.folder, endereco.name)
    if (!aprovada) {
      faltando.push(file)
      continue
    }

    mapa.set(file, await emCache(fonte, aprovada.driveFileId, endereco.ext, cacheDir))
  }

  if (faltando.length) throw new ImagensFaltando(faltando)
  return mapa
}

/** baixa uma vez e reaproveita; o id do Drive é a chave */
async function emCache(
  fonte: FonteDeImagem,
  driveFileId: string,
  ext: string,
  cacheDir: string,
): Promise<string> {
  // o id do Drive é opaco e pode trazer caracteres de caminho — hash resolve
  const chave = createHash('sha1').update(driveFileId).digest('hex')
  const destino = join(cacheDir, `${chave}${ext}`)
  if (existsSync(destino)) return destino
  await mkdir(dirname(destino), { recursive: true })
  await writeFile(destino, await fonte.baixar(driveFileId))
  return destino
}
