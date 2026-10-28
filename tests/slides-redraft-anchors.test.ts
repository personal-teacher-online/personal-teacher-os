// M-H2 item 5 — anchorId nunca vai para a IA; re-rascunho preserva anchorId+foto
// por posição+termo e aponta os órfãos. Puro.
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { stripOperationalFields } from '../src/lib/slides/draft'
import { preserveAnchorsOnRedraft, stripAnchorIds } from '../src/lib/slides/anchors'
import { LessonSchema } from '../src/lib/slides/lesson-schema'

describe('stripOperationalFields — a IA não vê anchorId', () => {
  it('remove anchorId de properties e required, recursivamente', () => {
    const schema = {
      type: 'object',
      properties: {
        term: { type: 'string' },
        anchorId: { type: 'string' },
        nested: {
          type: 'object',
          properties: { anchorId: { type: 'string' }, keep: { type: 'string' } },
          required: ['anchorId', 'keep'],
        },
      },
      required: ['term', 'anchorId'],
    }
    const out = stripOperationalFields(schema) as typeof schema
    expect(out.properties).not.toHaveProperty('anchorId')
    expect(out.properties).toHaveProperty('term')
    expect(out.required).toEqual(['term'])
    expect(out.properties.nested.properties).not.toHaveProperty('anchorId')
    expect(out.properties.nested.required).toEqual(['keep'])
  })

  it('no JSON Schema REAL do LessonSchema, anchorId some mas term/pt/image ficam', () => {
    const json = JSON.stringify(stripOperationalFields(z.toJSONSchema(LessonSchema)))
    expect(json).not.toContain('anchorId')
    expect(json).toContain('term')
    expect(json).toContain('pt')
  })
})

describe('preserveAnchorsOnRedraft — re-rascunho da mesma aula', () => {
  const old = {
    slides: [
      { type: 'objectives', items: ['a'] },
      {
        type: 'vocab',
        cards: [
          { term: 'gate', pt: 'portão', anchorId: 'aaaa1111', image: 'm5/a1-vocab-aaaa1111.png' },
          { term: 'delay', pt: 'atraso', anchorId: 'bbbb2222', image: 'm5/a1-vocab-bbbb2222.png' },
        ],
      },
    ],
  }

  it('preserva anchorId+foto por posição quando o termo bate (case-insensitive)', () => {
    const novo = {
      slides: [
        { type: 'objectives', items: ['z'] },
        {
          type: 'vocab',
          cards: [
            { term: 'Gate', pt: 'portão de embarque' }, // mesmo termo (case-insensitive)
            { term: 'boarding', pt: 'embarque' }, // termo NOVO na pos 1
          ],
        },
      ],
    }
    const { doc, orphanTerms } = preserveAnchorsOnRedraft(old, novo)
    const cards = (doc.slides[1] as { cards: Array<{ term: string; anchorId?: string; image?: string }> }).cards
    // pos 0: preservou id + foto (termo bateu)
    expect(cards[0].anchorId).toBe('aaaa1111')
    expect(cards[0].image).toBe('m5/a1-vocab-aaaa1111.png')
    // pos 1: termo novo, sem herança
    expect(cards[1].anchorId).toBeUndefined()
    expect(cards[1].image).toBeUndefined()
    // 'delay' tinha foto e sumiu → órfão sinalizado (não bloqueia)
    expect(orphanTerms).toEqual(['delay'])
  })

  it('sem conteúdo antigo (1º rascunho) não preserva nada nem inventa órfão', () => {
    const novo = { slides: [{ type: 'vocab', cards: [{ term: 'x', pt: 'y' }] }] }
    const { doc, orphanTerms } = preserveAnchorsOnRedraft(null, novo)
    expect(doc).toBe(novo)
    expect(orphanTerms).toEqual([])
  })

  it('item 2: anchorId ECOADO/TROCADO pela IA é descartado e re-preservado no servidor', () => {
    // resposta BRUTA da IA: o card 0 (mesmo termo do antigo) vem com um anchorId
    // ECOADO diferente; o card 1 (termo novo) vem com um anchorId INVENTADO.
    const raw = {
      slides: [
        { type: 'objectives', items: ['a'] },
        {
          type: 'vocab',
          cards: [
            { term: 'gate', pt: 'portão', anchorId: 'cccc3333' }, // ECOADO (troca de identidade)
            { term: 'boarding', pt: 'embarque', anchorId: 'eeee5555' }, // INVENTADO
          ],
        },
      ],
    }
    // 1) strip da resposta bruta: nenhum anchorId sobrevive
    const limpo = stripAnchorIds(raw) as typeof raw
    const cardsLimpos = (limpo.slides[1] as { cards: Array<{ anchorId?: string }> }).cards
    expect(cardsLimpos[0].anchorId).toBeUndefined()
    expect(cardsLimpos[1].anchorId).toBeUndefined()
    // 2) preservação server-side por posição+termo: card 0 recupera o id REAL do
    //    doc antigo; o eco 'cccc3333' NÃO entra.
    const { doc } = preserveAnchorsOnRedraft(old, limpo)
    const cards = (doc.slides[1] as { cards: Array<{ term: string; anchorId?: string }> }).cards
    expect(cards[0].anchorId).toBe('aaaa1111') // id REAL (posição+termo), não o eco
    expect(cards[1].anchorId).toBeUndefined() // termo novo → sem herança
  })
})
