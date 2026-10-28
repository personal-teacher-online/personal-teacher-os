// FS-M3: aplicação do vídeo aprovado no listening (função pura) e o contrato
// da proposta de trecho (Structured Outputs).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { presente, privado } from './_privado'
import { z } from 'zod'
import { ExcerptProposalSchema, applyVideoToLesson } from '../src/lib/slides/excerpt'
import { LessonSchema } from '../src/lib/slides/lesson-schema'

const PROPOSAL = {
  excerpt: { start: '1:40', end: '5:23', why: 'bloco de pedidos educados' },
  task: '**Watch the video** and check the phrases you **hear**:',
  items: [
    { text: 'Could you…?', correct: true },
    { text: 'Would you mind…?', correct: true },
    { text: 'I missed the bus' },
    { text: 'The wrong train' },
  ],
  answers: 'Gabarito (1:40-5:23): Could you (2:04), Would you mind (2:19).',
  notes: 'Tocar 1:40-5:23. Toque 2x; na 2a a aluna marca.',
}

describe('FS-M3 — trecho e aplicação do vídeo', () => {
  it('schema da proposta converte para JSON Schema e valida', () => {
    expect(ExcerptProposalSchema.parse(PROPOSAL)).toBeTruthy()
    const js = z.toJSONSchema(ExcerptProposalSchema) as { properties?: object }
    expect(js.properties).toBeDefined()
  })

  it.skipIf(!presente)('aplica no listening do M5A1 real e o LessonDoc continua válido', () => {
    const content = JSON.parse(readFileSync(join(privado.content, 'personal-travel', 'm5a1.json'), 'utf8'))
    const merged = applyVideoToLesson(content, 'abc123XYZ_-', ExcerptProposalSchema.parse(PROPOSAL))
    const doc = LessonSchema.parse(merged)
    const listening = doc.slides.find((s) => s.type === 'listening')!
    if (listening.type !== 'listening') throw new Error('tipo')
    expect(listening.videoUrl).toBe('https://www.youtube.com/watch?v=abc123XYZ_-')
    expect(listening.excerpt?.start).toBe('1:40')
    expect(listening.items?.filter((i) => i.correct).length).toBe(2)
    expect(listening.videoHint).toBeUndefined()
  })

  it('sem slide de listening: erro claro', () => {
    expect(() =>
      applyVideoToLesson({ slides: [{ type: 'cover' }] }, 'x', ExcerptProposalSchema.parse(PROPOSAL)),
    ).toThrow(/listening/)
  })
})

describe('trecho e gabarito marcados na tela (opção A)', () => {
  it('valida mm:ss', async () => {
    const { isTimeMark } = await import('../src/lib/slides/excerpt')
    for (const ok of ['0:00', '1:40', '12:07', '105:59']) expect(isTimeMark(ok), ok).toBe(true)
    for (const bad of ['1:60', '140', '1:4', 'abc', '', '1:', ':30']) expect(isTimeMark(bad), bad).toBe(false)
  })

  it.skipIf(!presente)('monta a proposta e aplica no listening do M5A1', async () => {
    const { buildManualProposal, applyVideoToLesson } = await import('../src/lib/slides/excerpt')
    const content = JSON.parse(readFileSync(join(privado.content, 'personal-travel', 'm5a1.json'), 'utf8'))
    const proposal = buildManualProposal({
      start: '0:10',
      end: '2:30',
      items: [
        { text: 'I would like the chicken', correct: true },
        { text: 'Can I see the menu?', correct: true },
        { text: 'The bill, please', correct: true },
        { text: 'I missed the bus', correct: false },
      ],
    })
    expect(proposal.answers).toContain('marcado pela professora')
    expect(proposal.notes).toContain('0:10-2:30')
    const doc = LessonSchema.parse(applyVideoToLesson(content, 'vid123', proposal))
    const l = doc.slides.find((s) => s.type === 'listening')!
    if (l.type !== 'listening') throw new Error('tipo')
    expect(l.excerpt).toEqual({ start: '0:10', end: '2:30', why: 'Trecho escolhido pela professora.' })
    expect(l.items?.filter((i) => i.correct)).toHaveLength(3)
    expect(l.videoUrl).toBe('https://www.youtube.com/watch?v=vid123')
  })

  it('sem nada marcado: gabarito diz que a professora corrige ao vivo', async () => {
    const { buildManualProposal } = await import('../src/lib/slides/excerpt')
    const p = buildManualProposal({
      start: '0:00', end: '1:00',
      items: [{ text: 'a', correct: false }, { text: 'b', correct: false }, { text: 'c', correct: false }, { text: 'd', correct: false }],
    })
    expect(p.answers).toContain('corrige ao vivo')
    expect(p.items.every((i) => i.correct === undefined)).toBe(true)
  })
})
