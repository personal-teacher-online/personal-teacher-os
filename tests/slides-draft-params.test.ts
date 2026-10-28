// M-F — parâmetros separados do "✨ Rascunhar com IA": normalização de nível
// (A0 legado → Pre A1, via preprocess do zod) e montagem do prompt por SLOTS
// nomeados (campo vazio = seção omitida, não placeholder solto).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  FLEXGE_LEVELS,
  LevelSchema,
  LessonSchema,
  normalizeFlexgeLevel,
} from '../src/lib/slides/lesson-schema'
import { fillPromptSlots } from '../src/lib/slides/draft'

describe('nível Flexge — preprocess A0 (ADR-024 §5)', () => {
  it('aceita e normaliza A0 legado para Pre A1 em memória', () => {
    expect(LevelSchema.parse('A0')).toBe('Pre A1')
    expect(normalizeFlexgeLevel('A0')).toBe('Pre A1')
  })

  it('aceita os 11 níveis do catálogo, cada um como ele mesmo', () => {
    for (const lvl of FLEXGE_LEVELS) {
      expect(LevelSchema.parse(lvl)).toBe(lvl)
      expect(normalizeFlexgeLevel(lvl)).toBe(lvl)
    }
  })

  it('recusa nível fora do catálogo (nada de conjunto inventado)', () => {
    expect(LevelSchema.safeParse('A3').success).toBe(false)
    expect(LevelSchema.safeParse('Z9').success).toBe(false)
    expect(normalizeFlexgeLevel('A3')).toBeUndefined()
    expect(normalizeFlexgeLevel(42)).toBeUndefined()
  })

  it('o JSON Schema de referência (Structured Outputs) traz os 11 níveis e NÃO A0', () => {
    const js = z.toJSONSchema(LessonSchema) as unknown as {
      properties: { level: { enum?: string[] } }
    }
    const en = js.properties.level.enum ?? []
    expect(en).toHaveLength(11)
    expect(en).toContain('Pre A1')
    expect(en).toContain('B2+')
    expect(en).not.toContain('A0')
  })
})

// Template sintético e determinístico com todos os slots e uma seção-guarda
// PARAMS envolvendo tudo — espelha a estrutura do prompt real.
const TPL = [
  'INTRO fixa.',
  '',
  '{{#PARAMS}}',
  'PARAMS:',
  '{{#LEVEL}}- nivel: {{LEVEL}}{{/LEVEL}}',
  '{{#THEME}}- tema: {{THEME}}{{/THEME}}',
  '{{#TOPICS}}- topicos: {{TOPICS}}{{/TOPICS}}',
  '{{#STYLE}}- estilo: {{STYLE}}{{/STYLE}}',
  '{{#SLIDE_COUNT}}- n: {{SLIDE_COUNT}}{{/SLIDE_COUNT}}',
  '{{#STRUCTURE}}- estrutura: {{STRUCTURE}}{{/STRUCTURE}}',
  '{{/PARAMS}}',
  '',
  'Marcadores rich: **negrito**, {{roxo-marca}}, [[teal]].',
].join('\n')

describe('fillPromptSlots — montagem por slots nomeados', () => {
  it('tudo preenchido: cada slot vira valor; nenhum {{SLOT}} conhecido sobra', () => {
    const out = fillPromptSlots(TPL, {
      level: 'B1',
      theme: 'comprar passagens',
      topics: 'one-way / round trip',
      style: 'tom leve',
      slideCount: 14,
      structure: 'aquecimento -> vocab -> missao',
    })
    expect(out).toContain('- nivel: B1')
    expect(out).toContain('- tema: comprar passagens')
    expect(out).toContain('- topicos: one-way / round trip')
    expect(out).toContain('- estilo: tom leve')
    expect(out).toContain('- n: 14')
    expect(out).toContain('- estrutura: aquecimento -> vocab -> missao')
    expect(out).toContain('PARAMS:')
    // nenhum slot conhecido (caixa alta) sobra; markers de conteúdo ficam.
    for (const s of ['LEVEL', 'THEME', 'TOPICS', 'STYLE', 'SLIDE_COUNT', 'STRUCTURE', 'PARAMS']) {
      expect(out).not.toContain(`{{#${s}}}`)
      expect(out).not.toContain(`{{${s}}}`)
    }
    expect(out).toContain('{{roxo-marca}}')
  })

  it('só nível: as demais seções somem, sem placeholder solto', () => {
    const out = fillPromptSlots(TPL, { level: 'A1' })
    expect(out).toContain('PARAMS:')
    expect(out).toContain('- nivel: A1')
    expect(out).not.toContain('- tema:')
    expect(out).not.toContain('- topicos:')
    expect(out).not.toContain('- estilo:')
    expect(out).not.toContain('- n:')
    expect(out).not.toContain('- estrutura:')
    // nenhum slot conhecido sobra, mas o marcador de conteúdo sobrevive intacto
    for (const s of ['LEVEL', 'THEME', 'TOPICS', 'STYLE', 'SLIDE_COUNT', 'STRUCTURE', 'PARAMS']) {
      expect(out).not.toContain(`{{#${s}}}`)
      expect(out).not.toContain(`{{${s}}}`)
    }
    expect(out).toContain('{{roxo-marca}}')
  })

  it('vazio total: a seção PARAMS inteira some e o INTRO/markers ficam', () => {
    const out = fillPromptSlots(TPL, {})
    expect(out).toContain('INTRO fixa.')
    expect(out).not.toContain('PARAMS:')
    expect(out).not.toContain('- nivel:')
    for (const s of ['LEVEL', 'THEME', 'TOPICS', 'STYLE', 'SLIDE_COUNT', 'STRUCTURE', 'PARAMS']) {
      expect(out).not.toContain(`{{#${s}}}`)
    }
    expect(out).toContain('{{roxo-marca}}')
  })

  it('slideCount não-positivo/NaN é tratado como ausente', () => {
    expect(fillPromptSlots(TPL, { slideCount: 0 })).not.toContain('- n:')
    expect(fillPromptSlots(TPL, { slideCount: NaN })).not.toContain('- n:')
    expect(fillPromptSlots(TPL, { slideCount: 12 })).toContain('- n: 12')
  })

  it('valor com $ do operador não é interpretado como grupo de regex', () => {
    const out = fillPromptSlots(TPL, { theme: 'custo $5 & $10' })
    expect(out).toContain('- tema: custo $5 & $10')
  })

  it('single-pass: valor com marcadores de slot NÃO sofre expansão cruzada (item 4)', () => {
    // theme referencia TODOS os slots + delimitador de seção + padrões $ do
    // replace + multiline. Nada disso pode ser reinterpretado: o texto inserido
    // não é reescaneado, então cada token fica LITERAL no resultado.
    const bomba = [
      '{{LEVEL}} {{THEME}} {{TOPICS}} {{STYLE}} {{SLIDE_COUNT}} {{STRUCTURE}}',
      '{{#TOPICS}}x{{/TOPICS}} {{/PARAMS}}',
      'dinheiro $& e $\' e $1 e $$',
      'segunda linha',
    ].join('\n')
    const out = fillPromptSlots(TPL, {
      level: 'A1',
      theme: bomba,
      topics: 'hotel',
      style: 'curto',
      slideCount: 9,
      structure: 'inicio->fim',
    })
    // o tema saiu com o texto-bomba INTACTO (nenhum {{...}} do valor virou outro valor)
    expect(out).toContain(`- tema: ${bomba}`)
    // prova direta da não-expansão: 'hotel' (valor de TOPICS) aparece SÓ na
    // linha de tópicos, nunca dentro do tema.
    expect(out).toContain('- topicos: hotel')
    expect(out).not.toContain('- tema: A1 hotel curto')
    // os padrões $ e o delimitador de seção sobreviveram literais no tema
    expect(out).toContain("dinheiro $& e $' e $1 e $$")
    expect(out).toContain('{{/PARAMS}}')
    expect(out).toContain('segunda linha')
    // os marcadores de SEÇÃO dentro do valor sobrevivem literais (a passada de
    // seção rodou antes, só no template — não reprocessa texto inserido).
    expect(out).toContain('{{#TOPICS}}x{{/TOPICS}}')
    // e a seção REAL do template foi resolvida (a linha de tópicos existe).
    expect(out).toContain('- topicos: hotel')
  })
})

describe('fillPromptSlots contra o prompt REAL do repo', () => {
  const real = readFileSync(new URL('../prompts/slides-lesson-draft.md', import.meta.url), 'utf8')

  it('preenche os slots reais e preserva os marcadores de conteúdo', () => {
    const out = fillPromptSlots(real, {
      level: 'A2',
      theme: 'restaurante',
      topics: 'pedir a conta',
      slideCount: 15,
    })
    expect(out).toContain('Nível-alvo: A2')
    expect(out).toContain('Tema / diretrizes da aula: restaurante')
    expect(out).toContain('Tópicos a cobrir (da planilha da professora): pedir a conta')
    expect(out).toContain('aproximadamente 15 specs')
    // estilo/estrutura vazios: seções omitidas
    expect(out).not.toContain('Estilo do slide:')
    expect(out).not.toContain('Estrutura do conteúdo, do início ao fim:')
    // marcadores rich do prompt intactos
    expect(out).toContain('{{roxo-marca}}')
    // nenhum slot de parâmetro conhecido sobra
    for (const s of ['LEVEL', 'THEME', 'TOPICS', 'STYLE', 'SLIDE_COUNT', 'STRUCTURE', 'PARAMS']) {
      expect(out).not.toContain(`{{#${s}}}`)
      expect(out).not.toContain(`{{/${s}}}`)
      expect(out).not.toContain(`{{${s}}}`)
    }
  })

  it('vazio total no prompt real: bloco PARÂMETROS some, corpo pedagógico fica', () => {
    const out = fillPromptSlots(real, {})
    expect(out).not.toContain('PARÂMETROS DESTE RASCUNHO')
    expect(out).not.toContain('Nível-alvo:')
    expect(out).toContain('Regras pedagógicas (invioláveis):')
    expect(out).toContain('{{roxo-marca}}')
  })
})
