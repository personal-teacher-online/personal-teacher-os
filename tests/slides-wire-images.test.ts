// A FIAÇÃO DE FOTOS do lote estrutural (v1) — e a trava que a impede de apagar
// o trabalho do v2.
//
// O `wire-images.ts` tem um `PRACTICE = 'shared/practice-time.jpg'` cravado: no
// v1 a divisória era a mesma no curso inteiro. No v2 cada aula tem a sua
// (`m5/practice-a1.jpg`…), 48 fotos únicas geradas e conferidas uma a uma —
// rodar o script sobre esse conteúdo trocaria as 48 pela mesma foto, em
// silêncio, e o defeito só apareceria no deck renderizado.
//
// A regra que estes testes fixam: o script PREENCHE endereço ausente e NUNCA
// sobrescreve endereço já declarado.
import { describe, expect, it } from 'vitest'
import type { LessonDoc } from '../src/lib/slides/lesson-schema.ts'
import { carregarSePresente, presente } from './_privado'

// `wire-images.ts` resolve a pasta de marca na carga: sem o insumo privado, os casos pulam (tests/_privado.ts).
const { wireImages } = await carregarSePresente(() => import('../scripts/slides/wire-images.ts'))

const docCom = (slides: unknown[]): LessonDoc => ({ slides }) as unknown as LessonDoc

describe.skipIf(!presente)('wireImages não sobrescreve foto já declarada', () => {
  it('a divisória do v2 sobrevive — o PRACTICE cravado não entra por cima', () => {
    const doc = docCom([{ type: 'section', title: 'PRACTICE TIME', image: { file: 'm5/practice-a1.jpg' } }])
    const r = wireImages(doc, '5-1')

    expect((doc.slides[0] as { image: { file: string } }).image.file).toBe('m5/practice-a1.jpg')
    expect(r.preservadas).toContain('m5/practice-a1.jpg')
    expect(r.fotos).toBe(0)
  })

  it('capa/warmup/tip já endereçados também ficam como estão', () => {
    const doc = docCom([
      { type: 'cover', image: { file: 'm5-v2/suitcase-window.jpg' } },
      { type: 'tip', image: { file: 'm5-v2/city-map.jpg' } },
    ])
    const r = wireImages(doc, '5-1')

    expect((doc.slides[0] as { image: { file: string } }).image.file).toBe('m5-v2/suitcase-window.jpg')
    expect((doc.slides[1] as { image: { file: string } }).image.file).toBe('m5-v2/city-map.jpg')
    expect(r.fotos).toBe(0)
  })

  it('linha de vocabulário já com foto é preservada INTEIRA (tudo-ou-nada)', () => {
    const cards = [
      { term: 'bus', pt: 'ônibus', image: 'vocab/bus-v2.jpg' },
      { term: 'train', pt: 'trem' },
      { term: 'taxi', pt: 'táxi' },
      { term: 'ferry', pt: 'balsa' },
    ]
    const doc = docCom([{ type: 'vocab', title: 'Getting around', cards }])
    const r = wireImages(doc, '5-1')

    expect(cards.map((c) => c.image)).toEqual(['vocab/bus-v2.jpg', undefined, undefined, undefined])
    expect(r.preservadas).toContain('vocab/bus-v2.jpg')
    expect(r.fotos).toBe(0)
  })

  it('o que NÃO tem endereço continua sendo preenchido (a trava não desliga o script)', () => {
    const doc = docCom([{ type: 'section', title: 'PRACTICE TIME' }])
    const r = wireImages(doc, '5-1')

    expect((doc.slides[0] as { image?: { file: string } }).image?.file).toBe('shared/practice-time.jpg')
    expect(r.fotos).toBe(1)
    expect(r.preservadas).toEqual([])
  })
})
