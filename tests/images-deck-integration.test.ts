// IM-2/M1 — a prova de que ligar o resolvedor à geração de deck é ADITIVO:
// um deck cujas imagens estão todas no disco (M5A1, 16 fotos commitadas) sai
// pelo caminho novo sem tocar banco nem Drive, e o pptx continua válido.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { carregarSePresente, presente, privado } from './_privado'
import { LessonSchema } from '../src/lib/slides/lesson-schema'
const { buildLesson, packDeck } = await carregarSePresente(() => import('../src/lib/slides/build'))
import type { FonteDeImagem } from '../src/lib/images/resolve'
const { enderecosDoDoc, resolverImagens } = await carregarSePresente(() => import('../src/lib/images/resolve'))
const { usarImagensResolvidas } = await carregarSePresente(() => import('../src/lib/slides/template'))

const m5a1 = presente
  ? LessonSchema.parse(JSON.parse(readFileSync(join(privado.content, 'personal-travel', 'm5a1.json'), 'utf8')))
  : (undefined as never)

/** fonte que EXPLODE se for chamada — prova que o disco resolveu tudo sozinho */
const fonteProibida: FonteDeImagem = {
  aprovada: async (folder, name) => {
    throw new Error(`banco não devia ser consultado para ${folder}/${name}`)
  },
  baixar: async () => {
    throw new Error('Drive não devia ser tocado')
  },
}

describe.skipIf(!presente)('resolvedor ligado ao deck (aditivo)', () => {
  it('o M5A1 tem endereços de imagem — o teste vale a pena', () => {
    expect(enderecosDoDoc(m5a1).length).toBeGreaterThan(10)
  })

  it('imagens de disco resolvem SEM tocar banco nem Drive', async () => {
    const mapa = await resolverImagens(m5a1, fonteProibida)
    // todo endereço virou um caminho de disco dentro da biblioteca
    for (const [endereco, caminho] of mapa) {
      // Bancada Windows (01/09/2026): o resolvedor devolve o caminho do disco com
      // o separador do SO; o que se prova é a pasta, não o separador.
      expect(caminho.replace(/\\/g, '/')).toContain(join(privado.brand, 'slides', 'library').replace(/\\/g, '/'))
      expect(caminho.endsWith(endereco.split('/')[1])).toBe(true)
    }
    expect(mapa.size).toBe(enderecosDoDoc(m5a1).length)
  })

  it('o deck sai válido pelo caminho novo — mesmo pptx de sempre', async () => {
    usarImagensResolvidas(m5a1, await resolverImagens(m5a1, fonteProibida))
    const buf = await packDeck(buildLesson(m5a1))
    expect(buf.subarray(0, 2).toString()).toBe('PK') // zip válido
    expect(buf.byteLength).toBeGreaterThan(100_000)
  }, 30_000)
})
