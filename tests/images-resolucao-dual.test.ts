// M-H2: o resolvedor de deck resolve os TRÊS caminhos num mesmo documento:
//  (1) vocab NOVO por âncora (m{mod}/a{aula}-vocab-{anchorId}.ext) → biblioteca;
//  (2) cena LEGADA por aula/tipo (m{mod}/a{aula}-{tipo}.ext) → biblioteca;
//  (3) card.image LEGADO de arquivo direto (m5/a1-gate.png) → disco.
// Namespaces independentes (ADR-024 §4) convivendo na mesma aula.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FonteDeImagem } from '../src/lib/images/resolve.ts'
import type { LessonDoc } from '../src/lib/slides/lesson-schema.ts'
import { carregarSePresente, presente } from './_privado'

// `resolve.ts` resolve a pasta de marca na carga: sem o insumo privado, os casos pulam (tests/_privado.ts).
const { resolverImagens } = await carregarSePresente(() => import('../src/lib/images/resolve.ts'))

const docCom = (slides: unknown[]): LessonDoc => ({ slides }) as unknown as LessonDoc

let disco: string
let cache: string
beforeEach(() => {
  disco = mkdtempSync(join(tmpdir(), 'ptos-dual-'))
  cache = mkdtempSync(join(tmpdir(), 'ptos-dual-cache-'))
})

function noDisco(endereco: string): void {
  const [pasta, arquivo] = endereco.split('/')
  mkdirSync(join(disco, pasta), { recursive: true })
  writeFileSync(join(disco, pasta, arquivo), 'x')
}

describe.skipIf(!presente)('resolução DUAL — vocab por âncora + legados na mesma aula', () => {
  it('resolve os 3 caminhos e pergunta à biblioteca com pasta/nome certos', async () => {
    // caminho 3 no disco (arquivo direto legado)
    noDisco('m5/a1-gate.png')

    const perguntas: string[][] = []
    const fonte: FonteDeImagem = {
      aprovada: async (folder, name) => {
        perguntas.push([folder, name])
        // vocab novo e cena legada existem na biblioteca; devolve id do Drive
        if (name === 'a3-vocab-abcd1234') return { driveFileId: 'drive-vocab' }
        if (name === 'a1-cover') return { driveFileId: 'drive-cover' }
        return null
      },
      baixar: async (id) => Buffer.from(id),
    }

    const doc = docCom([
      // (2) cena legada por aula/tipo
      { type: 'cover', image: { file: 'm6/a1-cover.jpg' } },
      {
        type: 'vocab',
        cards: [
          // (1) vocab NOVO por âncora, com extensão da candidata aprovada
          { term: 'train station', pt: 'estação', image: 'm6/a3-vocab-abcd1234.jpg', anchorId: 'abcd1234' },
          // (3) card.image legado de arquivo direto (no disco)
          { term: 'gate', pt: 'portão', image: 'm5/a1-gate.png' },
        ],
      },
    ])

    const mapa = await resolverImagens(doc, fonte, { raizDisco: disco, cacheDir: cache })

    // caminho 3: disco tem precedência, nem pergunta à biblioteca
    expect(mapa.get('m5/a1-gate.png')).toBe(join(disco, 'm5', 'a1-gate.png'))
    // caminho 1: vocab por âncora veio do cache (baixado do Drive)
    expect(mapa.get('m6/a3-vocab-abcd1234.jpg')!.startsWith(cache)).toBe(true)
    // caminho 2: cena legada idem
    expect(mapa.get('m6/a1-cover.jpg')!.startsWith(cache)).toBe(true)
    // a pergunta à biblioteca usou pasta/nome SEM extensão (o CHECK do banco)
    expect(perguntas).toContainEqual(['m6', 'a3-vocab-abcd1234'])
    expect(perguntas).toContainEqual(['m6', 'a1-cover'])
    // o arquivo direto no disco NÃO foi perguntado à biblioteca
    expect(perguntas).not.toContainEqual(['m5', 'a1-gate'])
  })
})
