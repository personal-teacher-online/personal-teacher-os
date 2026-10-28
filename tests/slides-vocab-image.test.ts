// M-H1: o editor de slides não pode APAGAR a foto ancorada (card.image) de um
// card de vocabulário no ciclo editar→salvar. As fotos não trafegam pelo editor
// 'pairs' (só term/pt/cue), então applyFields as preserva por ÍNDICE a partir do
// slide original. LIMITAÇÃO CONHECIDA e aceita no M-H1: reordenar/remover linha do
// meio desalinha as fotos (âncora = posição). Âncora estável (anchor_id) = M-H2.
import { describe, expect, it } from 'vitest'
import { applyFields, describeSlide } from '../src/lib/slides/fields'
import type { SlideSpec } from '../src/lib/slides/lesson-schema'

/** Slide de vocab com 4 cards; image ancorada em 2 deles (índices 0 e 2). */
function vocabSlide(): Extract<SlideSpec, { type: 'vocab' }> {
  return {
    type: 'vocab',
    title: 'Aeroporto',
    cards: [
      { term: 'gate', pt: 'portão', image: 'm5/a1-gate.png' },
      { term: 'boarding', pt: 'embarque', cue: 'BOAR-ding' },
      { term: 'luggage', pt: 'bagagem', image: 'm5/a1-luggage.png' },
      { term: 'delay', pt: 'atraso' },
    ],
  }
}

/**
 * Simula o FormData que o editor 'pairs' devolve para um vocab.
 * `rows` = as linhas [term, pt, cue] que a professora deixou no editor.
 * (image NÃO aparece no editor — é justamente o que precisa ser preservado.)
 */
function formOf(spec: SlideSpec, rows: string[][]) {
  const single = new Map<string, string>()
  const multi = new Map<string, string[]>()
  const push = (k: string, v: string) => multi.set(k, [...(multi.get(k) ?? []), v])
  // campos de texto simples (title/intro/notes) saem do describe, como no editor real
  for (const f of describeSlide(spec)) {
    if (f.kind === 'text' || f.kind === 'longtext') single.set(f.name, String(f.value ?? ''))
  }
  for (const r of rows) {
    push('cards__1', r[0] ?? '')
    push('cards__2', r[1] ?? '')
    push('cards__3', r[2] ?? '')
  }
  return {
    get: (n: string) => single.get(n) ?? null,
    getAll: (n: string) => multi.get(n) ?? [],
  }
}

/** Linhas [term, pt, cue] equivalentes ao que o editor mostraria (sem image). */
const rowsDe = (s: Extract<SlideSpec, { type: 'vocab' }>) =>
  s.cards.map((c) => [c.term, c.pt, c.cue ?? ''])

describe('M-H1 · editor de vocab preserva card.image', () => {
  it('1) round-trip: salvar com os mesmos valores preserva image nas mesmas posições', () => {
    const s = vocabSlide()
    const out = applyFields(s, formOf(s, rowsDe(s)))
    if (out.type !== 'vocab') throw new Error('tipo')
    expect(out.cards.map((c) => c.image)).toEqual([
      'm5/a1-gate.png',
      undefined,
      'm5/a1-luggage.png',
      undefined,
    ])
    // e o resto do card segue intacto
    expect(out.cards.map((c) => c.term)).toEqual(['gate', 'boarding', 'luggage', 'delay'])
    expect(out.cards[1].cue).toBe('BOAR-ding')
  })

  it('2) editar o pt de um card não perde a image dele', () => {
    const s = vocabSlide()
    const rows = rowsDe(s)
    rows[0][1] = 'portão de embarque' // muda o pt do card 0 (que tem image)
    const out = applyFields(s, formOf(s, rows))
    if (out.type !== 'vocab') throw new Error('tipo')
    expect(out.cards[0].pt).toBe('portão de embarque')
    expect(out.cards[0].image).toBe('m5/a1-gate.png')
  })

  it('3) linha adicionada nasce sem image; as antigas preservam', () => {
    const s = vocabSlide()
    const rows = [...rowsDe(s), ['passport', 'passaporte', '']]
    const out = applyFields(s, formOf(s, rows))
    if (out.type !== 'vocab') throw new Error('tipo')
    expect(out.cards.length).toBe(5)
    expect(out.cards.map((c) => c.image)).toEqual([
      'm5/a1-gate.png',
      undefined,
      'm5/a1-luggage.png',
      undefined,
      undefined, // card novo, sem image
    ])
    expect(out.cards[4].term).toBe('passport')
  })

  it('4) remover a última linha não embaralha as imagens dos restantes', () => {
    const s = vocabSlide()
    const rows = rowsDe(s).slice(0, 3) // remove o card 3 (delay, sem image)
    const out = applyFields(s, formOf(s, rows))
    if (out.type !== 'vocab') throw new Error('tipo')
    expect(out.cards.length).toBe(3)
    expect(out.cards.map((c) => c.image)).toEqual([
      'm5/a1-gate.png',
      undefined,
      'm5/a1-luggage.png',
    ])
  })
})
