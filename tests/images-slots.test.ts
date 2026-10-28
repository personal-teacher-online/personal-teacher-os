import { describe, expect, it } from 'vitest'
import {
  comEnderecoDeImagem,
  partesDoEndereco,
  slotsDeImagem,
} from '../src/lib/images/slots.ts'
import type { LessonDoc } from '../src/lib/slides/lesson-schema.ts'

const doc = (slides: unknown[]): LessonDoc =>
  ({
    module: { number: 8, title: 'Getting Around' },
    lesson: { number: 3, title: 'x' },
    slides,
  }) as unknown as LessonDoc

describe('slots de imagem de uma aula', () => {
  it('deriva endereço m{módulo}/a{aula}-{tipo} para slide SEM foto', () => {
    const slots = slotsDeImagem(doc([{ type: 'cover', title: 'When Things Go Wrong' }]))
    expect(slots).toHaveLength(1)
    expect(slots[0].address).toBe('m8/a3-cover')
    expect(slots[0].jaNoConteudo).toBe(false)
    expect(slots[0].promptSugerido).toContain('When Things Go Wrong')
    expect(slots[0].framing).toBe('retrato')
  })

  it('respeita o endereço que o slide JÁ carrega (M5 escrito à mão)', () => {
    const slots = slotsDeImagem(
      doc([{ type: 'warmup', prompt: 'a station', image: { file: 'm5/rails-dusk.jpg' } }]),
    )
    expect(slots[0].address).toBe('m5/rails-dusk.jpg')
    expect(slots[0].jaNoConteudo).toBe(true)
  })

  it('ignora slides que não levam foto de cena (vocab, grammar…)', () => {
    const slots = slotsDeImagem(
      doc([
        { type: 'grammar', title: 'Modals', rule: 'x', examples: ['a'] },
        { type: 'vocab', cards: [{ en: 'a', pt: 'b' }] },
        { type: 'tip', title: 'Dica', text: 'confirme o preço' },
      ]),
    )
    expect(slots.map((s) => s.type)).toEqual(['tip'])
    expect(slots[0].slideIndex).toBe(2)
  })

  it('desambigua endereço derivado quando dois slides do mesmo tipo colidem', () => {
    const slots = slotsDeImagem(
      doc([
        { type: 'tip', title: 'A', text: 'x' },
        { type: 'tip', title: 'B', text: 'y' },
      ]),
    )
    expect(slots.map((s) => s.address)).toEqual(['m8/a3-tip', 'm8/a3-tip-2'])
  })
})

describe('partesDoEndereco', () => {
  it('parte com e sem extensão', () => {
    expect(partesDoEndereco('m8/a3-cover')).toEqual({ folder: 'm8', name: 'a3-cover' })
    expect(partesDoEndereco('m5/rails-dusk.jpg')).toEqual({ folder: 'm5', name: 'rails-dusk' })
  })
  it('recusa endereço torto', () => {
    expect(partesDoEndereco('SEM barra')).toBeNull()
    expect(partesDoEndereco('a/b/c.jpg')).toBeNull()
  })
})

describe('comEnderecoDeImagem', () => {
  it('escreve o endereço no slide certo sem tocar nos outros', () => {
    const content = { slides: [{ type: 'cover', title: 'A' }, { type: 'tip', text: 'B' }] }
    const novo = comEnderecoDeImagem(content, 0, 'm8/a3-cover') as typeof content
    expect((novo.slides[0] as { image?: { file?: string } }).image?.file).toBe('m8/a3-cover')
    expect(novo.slides[1]).toEqual({ type: 'tip', text: 'B' }) // intocado
  })

  it('preserva a caption que já existia no slide', () => {
    const content = { slides: [{ type: 'cover', image: { caption: 'antiga' } }] }
    const novo = comEnderecoDeImagem(content, 0, 'm8/a3-cover') as typeof content
    const img = (novo.slides[0] as { image?: { file?: string; caption?: string } }).image
    expect(img).toEqual({ caption: 'antiga', file: 'm8/a3-cover' })
  })

  it('índice fora da faixa devolve o conteúdo intacto (não quebra)', () => {
    const content = { slides: [{ type: 'cover' }] }
    expect(comEnderecoDeImagem(content, 9, 'm8/a3-cover')).toBe(content)
  })
})
