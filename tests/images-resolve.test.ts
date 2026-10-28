// IM-2/M1 — o elo entre a biblioteca do IM-1 e o motor de slides.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FonteDeImagem } from '../src/lib/images/resolve.ts'
import type { LessonDoc } from '../src/lib/slides/lesson-schema.ts'
import { carregarSePresente, presente } from './_privado'

// `resolve.ts` e `template.ts` resolvem a pasta de marca na carga: sem o insumo privado, os casos pulam (tests/_privado.ts).
const { enderecosDoDoc, ImagensFaltando, parseEndereco, resolverImagens } = await carregarSePresente(
  () => import('../src/lib/images/resolve.ts'),
)
const { caminhoDaImagem, usarImagensResolvidas } = await carregarSePresente(() => import('../src/lib/slides/template.ts'))

/** o coletor só anda em doc.slides — não precisa de um LessonDoc completo */
const docCom = (slides: unknown[]): LessonDoc => ({ slides }) as unknown as LessonDoc

function pastaTemp(): string {
  return mkdtempSync(join(tmpdir(), 'ptos-teste-'))
}

let disco: string
let cache: string

beforeEach(() => {
  disco = pastaTemp()
  cache = pastaTemp()
})

function noDisco(endereco: string, conteudo = 'x'): void {
  const [pasta, arquivo] = endereco.split('/')
  mkdirSync(join(disco, pasta), { recursive: true })
  writeFileSync(join(disco, pasta, arquivo), conteudo)
}

const fonteVazia: FonteDeImagem = {
  aprovada: async () => null,
  baixar: async () => Buffer.from(''),
}

describe.skipIf(!presente)('endereços de imagem de uma aula', () => {
  it('colhe as DUAS formas do contrato: string crua e { file }', () => {
    const doc = docCom([
      { type: 'cover', image: { file: 'm7/capa.jpg', caption: 'ok' } },
      { type: 'vocab', cards: [{ en: 'a', pt: 'b', image: 'm7/cashier.jpg' }, { en: 'c', pt: 'd' }] },
    ])
    expect(enderecosDoDoc(doc).sort()).toEqual(['m7/capa.jpg', 'm7/cashier.jpg'])
  })

  it('não repete o mesmo endereço usado em dois slides', () => {
    const doc = docCom([
      { type: 'tip', image: { file: 'shared/practice-time.jpg' } },
      { type: 'section', image: { file: 'shared/practice-time.jpg' } },
    ])
    expect(enderecosDoDoc(doc)).toEqual(['shared/practice-time.jpg'])
  })

  it('a varredura é GENÉRICA — um campo de imagem novo no contrato não nasce mudo', () => {
    // se isto virasse uma lista fixa de caminhos, o oitavo campo sairia do
    // deck sem foto e sem aviso
    const doc = docCom([{ type: 'inventado', bloco: { interno: { image: { file: 'm9/nova.jpg' } } } }])
    expect(enderecosDoDoc(doc)).toEqual(['m9/nova.jpg'])
  })

  it('aula sem imagem nenhuma devolve lista vazia', () => {
    expect(enderecosDoDoc(docCom([{ type: 'objectives', items: ['a'] }]))).toEqual([])
  })
})

describe.skipIf(!presente)('formato do endereço', () => {
  it('aceita pasta/nome.ext', () => {
    expect(parseEndereco('m7/cashier.jpg')).toEqual({
      file: 'm7/cashier.jpg',
      folder: 'm7',
      name: 'cashier',
      ext: '.jpg',
    })
  })

  it.each(['cashier.jpg', 'm7/sub/pasta.jpg', 'M7/Cashier.JPG', 'm7/cashier', ''])(
    'recusa %o em vez de adivinhar',
    (torto) => {
      expect(parseEndereco(torto)).toBeNull()
    },
  )
})

describe.skipIf(!presente)('resolução', () => {
  it('DISCO tem precedência — as 33 fotos já commitadas não dependem de banco nem rede', async () => {
    noDisco('m7/cashier.jpg')
    const fonte = { aprovada: vi.fn(), baixar: vi.fn() }
    const mapa = await resolverImagens(
      docCom([{ type: 'vocab', cards: [{ image: 'm7/cashier.jpg' }] }]),
      fonte as unknown as FonteDeImagem,
      { raizDisco: disco, cacheDir: cache },
    )
    expect(mapa.get('m7/cashier.jpg')).toBe(join(disco, 'm7', 'cashier.jpg'))
    expect(fonte.aprovada).not.toHaveBeenCalled()
  })

  it('sem disco, usa a APROVADA da biblioteca e baixa do Drive', async () => {
    const fonte: FonteDeImagem = {
      aprovada: async (folder, name) => {
        expect([folder, name]).toEqual(['m9', 'mercado'])
        return { driveFileId: 'drive-1' }
      },
      baixar: async () => Buffer.from('conteudo-do-drive'),
    }
    const mapa = await resolverImagens(
      docCom([{ type: 'warmup', image: { file: 'm9/mercado.jpg' } }]),
      fonte,
      { raizDisco: disco, cacheDir: cache },
    )
    const caminho = mapa.get('m9/mercado.jpg')!
    expect(caminho.startsWith(cache)).toBe(true)
    expect(caminho.endsWith('.jpg')).toBe(true)
  })

  it('baixa UMA vez — a segunda renderização reaproveita o cache', async () => {
    const baixar = vi.fn(async () => Buffer.from('bytes'))
    const fonte: FonteDeImagem = { aprovada: async () => ({ driveFileId: 'drive-1' }), baixar }
    const doc = docCom([{ type: 'warmup', image: { file: 'm9/mercado.jpg' } }])
    await resolverImagens(doc, fonte, { raizDisco: disco, cacheDir: cache })
    await resolverImagens(doc, fonte, { raizDisco: disco, cacheDir: cache })
    expect(baixar).toHaveBeenCalledTimes(1)
  })

  it('endereço SEM origem estoura com a lista — o deck não sai com buraco', async () => {
    const doc = docCom([
      { type: 'warmup', image: { file: 'm9/some.jpg' } },
      { type: 'tip', image: { file: 'm9/outra.jpg' } },
    ])
    const erro = await resolverImagens(doc, fonteVazia, { raizDisco: disco, cacheDir: cache }).catch(
      (e) => e,
    )
    expect(erro).toBeInstanceOf(ImagensFaltando)
    expect((erro as InstanceType<typeof ImagensFaltando>).enderecos.sort()).toEqual(['m9/outra.jpg', 'm9/some.jpg'])
  })

  it('endereço torto também estoura — não é ignorado em silêncio', async () => {
    const doc = docCom([{ type: 'warmup', image: { file: 'ARQUIVO ERRADO' } }])
    await expect(
      resolverImagens(doc, fonteVazia, { raizDisco: disco, cacheDir: cache }),
    ).rejects.toBeInstanceOf(ImagensFaltando)
  })

  it('uma falta NÃO some no meio de vários acertos', async () => {
    noDisco('m7/ok.jpg')
    const doc = docCom([
      { type: 'vocab', cards: [{ image: 'm7/ok.jpg' }] },
      { type: 'tip', image: { file: 'm9/sumida.jpg' } },
    ])
    const erro = await resolverImagens(doc, fonteVazia, { raizDisco: disco, cacheDir: cache }).catch(
      (e) => e,
    )
    expect((erro as InstanceType<typeof ImagensFaltando>).enderecos).toEqual(['m9/sumida.jpg'])
  })
})

describe.skipIf(!presente)('o motor usa o que foi resolvido', () => {
  it('com mapa, a foto vem do caminho resolvido', () => {
    const doc = docCom([])
    usarImagensResolvidas(doc, new Map([['m9/mercado.jpg', '/tmp/cache/abc.jpg']]))
    expect(caminhoDaImagem(doc, 'm9/mercado.jpg')).toBe('/tmp/cache/abc.jpg')
  })

  it('SEM mapa, cai na biblioteca do disco — é o caminho da CLI', () => {
    const doc = docCom([])
    expect(caminhoDaImagem(doc, 'm7/cashier.jpg')).toContain(
      join('brand', 'slides', 'library', 'm7/cashier.jpg'),
    )
  })

  it('o mapa é preso ao doc — dois decks renderizando juntos não se misturam', () => {
    const a = docCom([])
    const b = docCom([])
    usarImagensResolvidas(a, new Map([['x/y.jpg', '/cache/a.jpg']]))
    usarImagensResolvidas(b, new Map([['x/y.jpg', '/cache/b.jpg']]))
    expect(caminhoDaImagem(a, 'x/y.jpg')).toBe('/cache/a.jpg')
    expect(caminhoDaImagem(b, 'x/y.jpg')).toBe('/cache/b.jpg')
  })
})
