// Structured Outputs: o JSON Schema enviado à Anthropic não pode carregar
// restrições numéricas/de tamanho (400 em produção 21/07). O sanitizador
// remove e DESCREVE o limite; a validação de verdade segue no zod.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { sanitizeForAnthropic, stripNulls } from '../src/lib/ai/json-schema'
import { LessonSchema } from '../src/lib/slides/lesson-schema'
import { ExcerptProposalSchema } from '../src/lib/slides/excerpt'

// C11c: `any` desliga o compilador justo onde o teste manipula JSON solto.
// `Json` descreve o que estas funções realmente devolvem e os acessos passam a
// ser NARROWING explícito — se a forma mudar, o teste falha na leitura, não
// depois de um `undefined` silencioso.
type Json = { [k: string]: unknown }

/** Acesso a uma sub-árvore do JSON, com o formato conferido no caminho. */
function obj(v: unknown, ...caminho: (string | number)[]): Json {
  let atual: unknown = v
  for (const passo of caminho) {
    if (Array.isArray(atual) && typeof passo === 'number') atual = atual[passo]
    else if (atual && typeof atual === 'object') atual = (atual as Json)[String(passo)]
    else throw new Error(`caminho inválido em ${caminho.join('.')}: ${String(passo)}`)
  }
  if (!atual || typeof atual !== 'object') {
    throw new Error(`esperava objeto em ${caminho.join('.')}, veio ${JSON.stringify(atual)}`)
  }
  return atual as Json
}

const PROIBIDAS = ['"minimum"', '"maximum"', '"exclusiveMinimum"', '"exclusiveMaximum"', '"multipleOf"', '"minLength"', '"maxLength"', '"maxItems"', '"oneOf"', '"pattern"']

describe('sanitizeForAnthropic', () => {
  it('LessonSchema sai sem nenhuma keyword proibida', () => {
    const s = JSON.stringify(sanitizeForAnthropic(z.toJSONSchema(LessonSchema)))
    for (const k of PROIBIDAS) expect(s, `keyword ${k}`).not.toContain(k)
    // o schema continua útil: tipos e propriedades preservados
    expect(s).toContain('"slides"')
    expect(s).toContain('"grammarFocus"')
  })

  it('ExcerptProposalSchema idem', () => {
    const s = JSON.stringify(sanitizeForAnthropic(z.toJSONSchema(ExcerptProposalSchema)))
    for (const k of PROIBIDAS) expect(s, `keyword ${k}`).not.toContain(k)
    expect(s).toContain('"excerpt"')
  })

  it('minItems>1 vira 1 e o limite vira descrição', () => {
    const out = sanitizeForAnthropic({
      type: 'object',
      required: ['n', 'arr'],
      properties: {
        n: { type: 'integer', minimum: 1, maximum: 12 },
        arr: { type: 'array', minItems: 3, maxItems: 8, items: { type: 'string', maxLength: 40 } },
      },
    })
    expect(obj(out, 'properties', 'n').minimum).toBeUndefined()
    expect(obj(out, 'properties', 'n').description).toContain('entre 1 e 12')
    expect(obj(out, 'properties', 'arr').minItems).toBe(1)
    expect(obj(out, 'properties', 'arr').maxItems).toBeUndefined()
    expect(obj(out, 'properties', 'arr').description).toContain('3 a 8 itens')
    expect(obj(out, 'properties', 'arr', 'items').description).toContain('40 caracteres')
  })

  it('campo opcional vira required aceitando null (limite de 24 opcionais)', () => {
    const out = sanitizeForAnthropic({
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string' }, b: { type: 'string', maxLength: 10 } },
    })
    expect(obj(out).required).toEqual(['a', 'b'])
    expect(obj(out, 'properties', 'a').type).toBe('string')
    expect(obj(out, 'properties', 'b').anyOf).toHaveLength(2)
    expect(obj(out, 'properties', 'b', 'anyOf', 1).type).toBe('null')
    expect(obj(out, 'properties', 'b', 'anyOf', 0).description).toContain('10 caracteres')
  })

  it('preserva enum, const e required intactos', () => {
    const out = sanitizeForAnthropic({
      type: 'object',
      required: ['a', 'b'],
      properties: { a: { const: 'personal-travel' }, b: { enum: ['A0', 'A1', 'A2'] } },
    })
    expect(obj(out).required).toEqual(['a', 'b'])
    expect(obj(out, 'properties', 'a').const).toBe('personal-travel')
    expect(obj(out, 'properties', 'b').enum).toEqual(['A0', 'A1', 'A2'])
  })
})

describe('allRequired + stripNulls (limite de 24 opcionais)', () => {
  it('LessonSchema sanitizado não tem NENHUM campo opcional', () => {
    const s = sanitizeForAnthropic(z.toJSONSchema(LessonSchema))
    let optionals = 0
    const visit = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(visit)
      if (!n || typeof n !== 'object') return
      const no = n as Json
      const props = no.properties
      if (props && typeof props === 'object') {
        const req = new Set(Array.isArray(no.required) ? no.required : [])
        for (const k of Object.keys(props)) if (!req.has(k)) optionals++
      }
      for (const [k, v] of Object.entries(no)) if (k !== 'required' && k !== 'enum') visit(v)
    }
    visit(s)
    expect(optionals).toBe(0)
  })

  it('stripNulls devolve o objeto ao contrato, preservando videoUrl null', () => {
    const raw = {
      course: 'personal-travel',
      subtitle: null,
      slides: [{ type: 'listening', videoUrl: null, videoHint: null, items: [{ text: 'x', correct: null }] }],
    }
    const out = obj(stripNulls(raw))
    expect('subtitle' in out).toBe(false)
    expect(obj(out, 'slides', 0).videoUrl).toBeNull()
    expect('videoHint' in obj(out, 'slides', 0)).toBe(false)
    expect('correct' in obj(out, 'slides', 0, 'items', 0)).toBe(false)
  })
})

describe('rascunho da aula (draft.ts)', () => {
  it('normalizeLessonDraft preenche videoUrl null que a IA omite', async () => {
    const { normalizeLessonDraft } = await import('../src/lib/slides/draft')
    const out = normalizeLessonDraft({
      slides: [
        { type: 'listening', task: 'x', items: [] },
        { type: 'cover', subtitle: null },
      ],
    })
    expect(obj(out, 'slides', 0).videoUrl).toBeNull()
    expect('subtitle' in obj(out, 'slides', 1)).toBe(false)
  })

  it('draftSystemPrompt carrega o contrato como referência (sem keywords proibidas)', async () => {
    const { draftSystemPrompt } = await import('../src/lib/slides/draft')
    const sys = draftSystemPrompt('REGRAS PEDAGÓGICAS')
    expect(sys).toContain('REGRAS PEDAGÓGICAS')
    expect(sys).toContain('videoUrl')
    for (const k of ['"minimum"', '"maxItems"', '"maxLength"']) expect(sys).not.toContain(k)
  })
})

describe('normalizeLessonDraft — variações do JSON guiado', () => {
  it('module/lesson como NÚMERO viram objeto (M6A4)', async () => {
    const { normalizeLessonDraft } = await import('../src/lib/slides/draft')
    const out = normalizeLessonDraft(
      { module: 6, lesson: 4, slides: [] },
      { moduleTitle: 'Time to Eat & Drink', lessonTitle: 'Diálogos Reais' },
    )
    expect(obj(out).module).toEqual({ number: 6, title: 'Time to Eat & Drink' })
    expect(obj(out).lesson).toEqual({ number: 4, title: 'Diálogos Reais' })
  })

  it('objeto correto passa intacto', async () => {
    const { normalizeLessonDraft } = await import('../src/lib/slides/draft')
    const out = normalizeLessonDraft({ module: { number: 6, title: 'X' }, slides: [] })
    expect(obj(out).module).toEqual({ number: 6, title: 'X' })
  })
})
