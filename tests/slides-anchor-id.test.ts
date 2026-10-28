// M-H2: anchorId — identidade OPACA e estável do card de vocabulário. Quatro
// casos obrigatórios (save simples, reordenação, renome, novo id em
// duplicar/adicionar) + legado (schema opcional; ganha id no 1º save;
// card.image legado segue aceito). Puro: sem banco.
import { describe, expect, it } from 'vitest'
import { applyFields, describeSlide } from '../src/lib/slides/fields'
import { ensureVocabAnchors, anchorsUsados } from '../src/lib/slides/anchors'
import { LessonSchema, type SlideSpec } from '../src/lib/slides/lesson-schema'

/** vocab com 4 cards, TODOS com anchorId; image em 2 (índices 0 e 2). */
function vocab(): Extract<SlideSpec, { type: 'vocab' }> {
  return {
    type: 'vocab',
    title: 'Aeroporto',
    cards: [
      { term: 'gate', pt: 'portão', image: 'm5/a1-vocab-aaaa1111.png', anchorId: 'aaaa1111' },
      { term: 'boarding', pt: 'embarque', cue: 'BOAR-ding', anchorId: 'bbbb2222' },
      { term: 'luggage', pt: 'bagagem', image: 'm5/a1-vocab-cccc3333.png', anchorId: 'cccc3333' },
      { term: 'delay', pt: 'atraso', anchorId: 'dddd4444' },
    ],
  }
}

/**
 * FormData como o editor real emite: describeSlide dá [term, pt, cue, anchorId];
 * o SlideEditor manda cards__1/__2/__3 + cards__anchor (oculto) por linha.
 * `rows` = as linhas que a professora deixou, cada uma [term, pt, cue, anchor].
 */
function formOf(spec: SlideSpec, rows: string[][]) {
  const single = new Map<string, string>()
  const multi = new Map<string, string[]>()
  const push = (k: string, v: string) => multi.set(k, [...(multi.get(k) ?? []), v])
  for (const f of describeSlide(spec)) {
    if (f.kind === 'text' || f.kind === 'longtext') single.set(f.name, String(f.value ?? ''))
  }
  for (const r of rows) {
    push('cards__1', r[0] ?? '')
    push('cards__2', r[1] ?? '')
    push('cards__3', r[2] ?? '')
    push('cards__anchor', r[3] ?? '')
    push('cards__source', r[4] ?? '') // editor novo (item 4): índice de origem
  }
  return { get: (n: string) => single.get(n) ?? null, getAll: (n: string) => multi.get(n) ?? [] }
}

/** linhas [term, pt, cue, anchor] como o editor as mostraria. */
const rowsDe = (s: Extract<SlideSpec, { type: 'vocab' }>) =>
  s.cards.map((c) => [c.term, c.pt, c.cue ?? '', c.anchorId ?? ''])

function asVocab(s: SlideSpec): Extract<SlideSpec, { type: 'vocab' }> {
  if (s.type !== 'vocab') throw new Error('esperava vocab')
  return s
}

describe('M-H2 · anchorId estável nos cards de vocab', () => {
  it('1) SAVE SIMPLES: round-trip preserva anchorId e image de cada card', () => {
    const s = vocab()
    const out = asVocab(applyFields(s, formOf(s, rowsDe(s))))
    expect(out.cards.map((c) => c.anchorId)).toEqual(['aaaa1111', 'bbbb2222', 'cccc3333', 'dddd4444'])
    expect(out.cards.map((c) => c.image)).toEqual([
      'm5/a1-vocab-aaaa1111.png',
      undefined,
      'm5/a1-vocab-cccc3333.png',
      undefined,
    ])
    expect(out.cards.map((c) => c.term)).toEqual(['gate', 'boarding', 'luggage', 'delay'])
  })

  it('2) REORDENAÇÃO: a foto acompanha o card pela IDENTIDADE (corrige o M-H1)', () => {
    const s = vocab()
    const rows = rowsDe(s)
    // inverte a ordem inteira: gate↔delay, boarding↔luggage
    const invertido = [rows[3], rows[2], rows[1], rows[0]]
    const out = asVocab(applyFields(s, formOf(s, invertido)))
    // cada anchorId (e sua foto) migra com a linha; a posição mudou, a foto não
    expect(out.cards.map((c) => c.anchorId)).toEqual(['dddd4444', 'cccc3333', 'bbbb2222', 'aaaa1111'])
    expect(out.cards.map((c) => [c.term, c.image])).toEqual([
      ['delay', undefined],
      ['luggage', 'm5/a1-vocab-cccc3333.png'],
      ['boarding', undefined],
      ['gate', 'm5/a1-vocab-aaaa1111.png'],
    ])
  })

  it('3) RENOME do termo: muda o term, anchorId e image seguem intactos', () => {
    const s = vocab()
    const rows = rowsDe(s)
    rows[0][0] = 'departure gate' // renomeia o card 0 (que tem foto)
    const out = asVocab(applyFields(s, formOf(s, rows)))
    expect(out.cards[0].term).toBe('departure gate')
    expect(out.cards[0].anchorId).toBe('aaaa1111')
    expect(out.cards[0].image).toBe('m5/a1-vocab-aaaa1111.png')
  })

  it('4a) ADICIONAR: a linha nova nasce com id NOVO (distinto) e sem foto', () => {
    const s = vocab()
    const rows = [...rowsDe(s), ['passport', 'passaporte', '', '']] // anchor vazio = nova
    const out = asVocab(applyFields(s, formOf(s, rows)))
    expect(out.cards.length).toBe(5)
    const novo = out.cards[4]
    expect(novo.term).toBe('passport')
    expect(novo.image).toBeUndefined()
    expect(novo.anchorId).toBeTruthy()
    // id novo, diferente de todos os existentes
    expect(['aaaa1111', 'bbbb2222', 'cccc3333', 'dddd4444']).not.toContain(novo.anchorId)
    // os antigos preservados
    expect(out.cards.slice(0, 4).map((c) => c.anchorId)).toEqual([
      'aaaa1111', 'bbbb2222', 'cccc3333', 'dddd4444',
    ])
  })

  it('4b) DUPLICAR: copiar uma linha (mesmo anchor) dá id NOVO à cópia, sem herdar a foto', () => {
    const s = vocab()
    const rows = rowsDe(s)
    // duplica o card 0 (gate, com foto): a cópia carrega o MESMO anchor no form
    const dup = [...rows, [rows[0][0], rows[0][1], rows[0][2], rows[0][3]]]
    const out = asVocab(applyFields(s, formOf(s, dup)))
    expect(out.cards.length).toBe(5)
    // a 1ª ocorrência mantém o anchor+foto; a cópia ganha id novo e NÃO herda a foto
    expect(out.cards[0].anchorId).toBe('aaaa1111')
    expect(out.cards[0].image).toBe('m5/a1-vocab-aaaa1111.png')
    expect(out.cards[4].anchorId).not.toBe('aaaa1111')
    expect(out.cards[4].image).toBeUndefined()
  })
})

describe('M-H2 · item 4 — merge misto (ancorado + legado) sem roubo de foto', () => {
  // slide com um card ANCORADO (com foto) e um card LEGADO (com foto, SEM âncora)
  function misto(): Extract<SlideSpec, { type: 'vocab' }> {
    return {
      type: 'vocab',
      title: 'Misto',
      cards: [
        { term: 'gate', pt: 'portão', image: 'm5/a1-vocab-aaaa1111.png', anchorId: 'aaaa1111' }, // 0 ancorado
        { term: 'luggage', pt: 'bagagem', image: 'm5/luggage.png' }, // 1 legado, SEM âncora
      ],
    }
  }

  it('reordenar ancorado + legado NÃO migra a foto do legado para o vizinho ancorado', () => {
    const s = misto()
    // editor mostra [term, pt, cue, anchor, source]; source = índice de ORIGEM.
    // Invertendo a ordem: legado (origem 1) primeiro, ancorado (origem 0) depois.
    const rows = [
      ['luggage', 'bagagem', '', '', '1'], // legado, anchor vazio, origem 1
      ['gate', 'portão', '', 'aaaa1111', '0'], // ancorado
    ]
    const out = asVocab(applyFields(s, formOf(s, rows)))
    // o legado (agora na pos 0) fica com a SUA foto (m5/luggage.png), não a do gate
    expect(out.cards[0].term).toBe('luggage')
    expect(out.cards[0].image).toBe('m5/luggage.png')
    expect(out.cards[0].anchorId).toBeTruthy() // ganhou âncora agora
    expect(out.cards[0].anchorId).not.toBe('aaaa1111')
    // o ancorado mantém id e foto
    expect(out.cards[1].term).toBe('gate')
    expect(out.cards[1].anchorId).toBe('aaaa1111')
    expect(out.cards[1].image).toBe('m5/a1-vocab-aaaa1111.png')
  })
})

describe('M-H2 · legado e schema', () => {
  it('item 1: anchorId DUPLICADO no doc é INVÁLIDO no schema; MALFORMADO idem', () => {
    const base = {
      course: 'personal-travel',
      module: { number: 5, title: 'M' },
      lesson: { number: 1, title: 'L' },
      level: 'A1',
      grammarFocus: ['x'],
    }
    const semiSlides = (cards: unknown[]) => [
      { type: 'cover' },
      { type: 'objectives', items: ['a', 'b'] },
      { type: 'vocab', title: 'V', cards },
      { type: 'recap', items: ['a', 'b'] },
      { type: 'closing' },
    ]
    // duplicado
    const dup = { ...base, slides: semiSlides([
      { term: 'a', pt: '1', anchorId: 'abcd1234' },
      { term: 'b', pt: '2', anchorId: 'abcd1234' },
      { term: 'c', pt: '3' },
    ]) }
    expect(LessonSchema.safeParse(dup).success).toBe(false)
    // malformado (não-hex)
    const mal = { ...base, slides: semiSlides([
      { term: 'a', pt: '1', anchorId: 'NOTHEX99' },
      { term: 'b', pt: '2' },
      { term: 'c', pt: '3' },
    ]) }
    expect(LessonSchema.safeParse(mal).success).toBe(false)
    // válidos e únicos → ok
    const ok = { ...base, slides: semiSlides([
      { term: 'a', pt: '1', anchorId: 'abcd1234' },
      { term: 'b', pt: '2', anchorId: 'deadbeef' },
      { term: 'c', pt: '3' },
    ]) }
    expect(LessonSchema.safeParse(ok).success).toBe(true)
  })

  it('card legado SEM anchorId é válido no schema (opcional)', () => {
    const doc = {
      course: 'personal-travel',
      module: { number: 5, title: 'Aeroporto' },
      lesson: { number: 1, title: 'Check-in' },
      level: 'A1',
      grammarFocus: ['present simple'],
      slides: [
        { type: 'cover' },
        { type: 'objectives', items: ['a', 'b'] },
        { type: 'vocab', title: 'V', cards: [
          { term: 'gate', pt: 'portão', image: 'm5/a1-gate.png' }, // legado: image + sem anchorId
          { term: 'boarding', pt: 'embarque' },
          { term: 'delay', pt: 'atraso' },
        ] },
        { type: 'recap', items: ['a', 'b'] },
        { type: 'closing' },
      ],
    }
    expect(LessonSchema.safeParse(doc).success).toBe(true)
  })

  it('ensureVocabAnchors dá id aos cards legados no 1º save; preserva os existentes', () => {
    const content = {
      slides: [
        { type: 'vocab', cards: [
          { term: 'gate', pt: 'portão', image: 'm5/a1-gate.png' }, // sem anchor
          { term: 'boarding', pt: 'embarque', anchorId: 'beef0001' }, // já tem (hex válido)
        ] },
        { type: 'objectives', items: ['x'] },
      ],
    }
    const out = ensureVocabAnchors(content) as typeof content
    const cards = (out.slides[0] as { cards: Array<{ term: string; anchorId?: string; image?: string }> }).cards
    expect(cards[0].anchorId).toBeTruthy() // ganhou id
    expect(cards[0].image).toBe('m5/a1-gate.png') // image legado preservado
    expect(cards[1].anchorId).toBe('beef0001') // id existente válido preservado
    // ids únicos no documento
    expect(anchorsUsados(out).size).toBe(2)
  })

  it('ensureVocabAnchors é idempotente e tolerante a conteúdo cru', () => {
    const jaTem = { slides: [{ type: 'vocab', cards: [{ term: 'a', pt: 'b', anchorId: 'abcd1234' }] }] }
    expect(ensureVocabAnchors(jaTem)).toBe(jaTem) // nada muda → mesmo objeto
    expect(ensureVocabAnchors({})).toEqual({})
    expect(ensureVocabAnchors(null)).toBeNull()
  })

  it('item 5b: anchorId MALFORMADO ou DUPLICADO é reescrito; válido único é mantido', () => {
    const content = {
      slides: [
        { type: 'vocab', cards: [
          { term: 'a', pt: 'x', anchorId: 'ZZZZ9999' }, // maiúsculas → inválido (não é [0-9a-f])
          { term: 'b', pt: 'y', anchorId: 'abcd12' }, // curto → inválido
          { term: 'c', pt: 'z', anchorId: 'deadbeef' }, // válido
          { term: 'd', pt: 'w', anchorId: 'deadbeef' }, // DUPLICADO do anterior
        ] },
      ],
    }
    const out = ensureVocabAnchors(content) as typeof content
    const ids = (out.slides[0] as { cards: Array<{ anchorId: string }> }).cards.map((c) => c.anchorId)
    // todos válidos
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}$/)
    // o 1º válido é preservado; o duplicado foi trocado
    expect(ids[2]).toBe('deadbeef')
    expect(ids[3]).not.toBe('deadbeef')
    // todos únicos
    expect(new Set(ids).size).toBe(4)
  })
})
