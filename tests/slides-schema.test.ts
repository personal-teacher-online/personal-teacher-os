// M-Slides-1 — valida o contrato do conteúdo de aula e o renderer do deck.
// Teste de unidade puro (não exige supabase local).
import JSZip from 'jszip'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { carregarSePresente, presente, privado } from './_privado'
import { z } from 'zod'
import {
  LEN,
  LessonSchema,
  LessonSchemaBase,
  LessonSchemaBaseV2,
  LessonSchemaV2,
  lessonSchemaBaseFor,
  lessonSchemaFor,
} from '../src/lib/slides/lesson-schema.ts'
import { climateFor } from '../src/lib/slides/climate.ts'
const { plain, renderedSlideCount, runs, T } = await carregarSePresente(() => import('../src/lib/slides/template.ts'))
const { buildLesson, packDeck } = await carregarSePresente(() => import('../src/lib/slides/build'))

const m5a1 = () =>
  LessonSchema.parse(
    JSON.parse(readFileSync(join(privado.content, 'personal-travel', 'm5a1.json'), 'utf8'))
  )

describe.skipIf(!presente)('marcadores inline → runs', () => {
  it('divide negrito, roxo-marca, teal e texto puro', () => {
    const r = runs('Go {{by bus}} or **walk** — [[easy]]!')
    expect(r.map((x) => x.text)).toEqual(['Go ', 'by bus', ' or ', 'walk', ' — ', 'easy', '!'])
    expect(r[1]!.options).toMatchObject({ bold: true, color: T.brand700 })
    expect(r[3]!.options).toMatchObject({ bold: true })
    expect(r[5]!.options).toMatchObject({ bold: true, color: T.teal700 })
  })
  it('plain() remove os marcadores', () => {
    expect(plain('{{by bus}} · **walk** · [[ok]] · __sub__')).toBe('by bus · walk · ok · sub')
  })
})

describe.skipIf(!presente)('todas as aulas de content/personal-travel validam', () => {
  const dir = join(privado.content, 'personal-travel')
  for (const file of (presente ? readdirSync(dir) : []).filter((f) => f.endsWith('.json'))) {
    it(file, () => {
      const doc = LessonSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')))
      expect(doc.slides[0]!.type).toBe('cover')
      expect(doc.slides.at(-1)!.type).toBe('closing')
    })
  }
})

describe.skipIf(!presente)('conteúdo do piloto (m5a1.json)', () => {
  it('valida contra o schema, abre com capa e fecha com closing', () => {
    const doc = m5a1()
    expect(doc.slides[0]!.type).toBe('cover')
    expect(doc.slides.at(-1)!.type).toBe('closing')
    expect(doc.slides.length).toBeGreaterThanOrEqual(12)
  })
  it('cobre as 4 habilidades e os 4 estilos Kolb', () => {
    const doc = m5a1()
    const types = new Set(doc.slides.map((s) => s.type))
    for (const skill of ['listening', 'speaking', 'writing', 'dialogue'] as const) {
      expect(types, `habilidade ausente: ${skill}`).toContain(skill)
    }
    const kolb = new Set(doc.slides.flatMap((s) => s.kolb ?? []))
    expect([...kolb].sort()).toEqual(['abstract', 'active', 'concrete', 'reflective'])
  })
  it('todo exercício de writing tem gabarito (vai para as notas, nunca para o slide)', () => {
    const doc = m5a1()
    for (const s of doc.slides) {
      if (s.type !== 'writing') continue
      for (const ex of s.exercises) for (const item of ex.items) expect(item.answer).toBeTruthy()
    }
  })
  it('listening não inventa URL: null + instrução para a dona', () => {
    const doc = m5a1()
    const listening = doc.slides.find((s) => s.type === 'listening')
    expect(listening).toBeDefined()
    if (listening?.type === 'listening' && listening.videoUrl === null) {
      expect(listening.videoHint).toBeTruthy()
    }
  })
})

describe.skipIf(!presente)('renderer', () => {
  it('gera um .pptx válido com um slide por spec e sem partes fantasma', async () => {
    const doc = m5a1()
    const buf = await packDeck(buildLesson(doc))
    // assinatura ZIP ("PK") + tamanho plausível (inclui os fundos de fog)
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK')
    expect(buf.length).toBeGreaterThan(100_000)
    const zip = await JSZip.loadAsync(buf)
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    // specs + slides de gabarito gerados automaticamente (writing/quiz do piloto)
    expect(slides.length).toBe(renderedSlideCount(doc))
    expect(slides.length).toBeGreaterThan(doc.slides.length)
    // regressão do "PowerPoint precisa reparar": todo Override do
    // [Content_Types].xml precisa apontar para uma parte que EXISTE no pacote
    // (pptxgenjs 4.0.1 declarava um slideMaster fantasma por slide)
    const ct = await zip.file('[Content_Types].xml')!.async('string')
    const overrides = [...ct.matchAll(/<Override PartName="([^"]+)"/g)].map((m) => m[1]!)
    expect(overrides.length).toBeGreaterThan(0)
    for (const part of overrides) {
      expect(zip.file(part.slice(1)), `parte fantasma declarada: ${part}`).toBeTruthy()
    }
  })
})

// ------------------------------------------------------------ item 19 (Fase 0d)
/**
 * ESCOPO DOS TETOS DE COMPRIMENTO — os `.max()` de `LEN` são do template **v2**.
 *
 * Eles entraram na Fase 0c valendo para TODO documento, o que era risco de
 * produção: o conteúdo vivo das M6–M12 mora no banco de produção e não dá para
 * medir daqui; uma aula com um campo acima do teto pararia de validar no editor
 * da dona. Aqui o teste prova as duas metades: uma aula v1 com campo LONGO
 * continua válida, e a mesma aula é recusada no contrato v2.
 */
describe('tetos de comprimento valem SÓ no caminho v2 (item 19)', () => {
  /** aula mínima válida, com um campo de texto do tamanho que o chamador pedir */
  const aulaCom = (n: number) => ({
    course: 'personal-travel',
    module: { number: 6, title: 'Módulo' },
    lesson: { number: 2, title: 'Aula' },
    level: 'A1',
    grammarFocus: ['x'],
    slides: [
      { type: 'cover', title: 'Capa' },
      { type: 'objectives', items: ['um', 'dois'] },
      { type: 'tip', text: 'x'.repeat(n) },
      { type: 'recap', items: ['um', 'dois'] },
      { type: 'closing' },
    ],
  })

  it('aula v1 com `tip.text` MUITO acima do teto do v2 continua validando', () => {
    // 5.000 caracteres: ~8× o teto do v2 (LEN.tip = 600). É o cenário do
    // conteúdo de produção que não dá para medir daqui.
    const longa = aulaCom(5_000)
    expect(LessonSchema.safeParse(longa).success).toBe(true)
    expect(LessonSchemaBase.safeParse(longa).success).toBe(true)
    // e o JSON Schema que a IA recebe também não ganhou teto novo: o ÚNICO
    // `maxLength` do v1 é o de `grammar.rule`, anterior à Fase 0c
    const js = JSON.stringify(z.toJSONSchema(LessonSchemaBase))
    expect(js.match(/"maxLength"/g) ?? []).toHaveLength(1)
    expect(js).toContain('"maxLength":240')
  })

  it('a MESMA aula é recusada pelo contrato v2, no campo certo', () => {
    const r = LessonSchemaV2.safeParse(aulaCom(5_000))
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.').includes('text'))).toBe(true)
    }
    // no teto exato do contrato v2 ela passa
    expect(LessonSchemaV2.safeParse(aulaCom(LEN.tip)).success).toBe(true)
  })

  it('o contrato ANTERIOR à Fase 0c segue no v1: `grammar.rule` continua com 240', () => {
    const comRegra = (n: number) => ({
      ...aulaCom(10),
      slides: [
        { type: 'cover', title: 'Capa' },
        { type: 'objectives', items: ['um', 'dois'] },
        { type: 'grammar', title: 'Regra', rule: 'x'.repeat(n), examples: ['um'] },
        { type: 'recap', items: ['um', 'dois'] },
        { type: 'closing' },
      ],
    })
    expect(LessonSchema.safeParse(comRegra(240)).success).toBe(true)
    expect(LessonSchema.safeParse(comRegra(241)).success).toBe(false)
  })

  it('`lessonSchemaFor` escolhe o contrato pelo curso da linha', () => {
    expect(lessonSchemaFor('personal-travel')).toBe(LessonSchema)
    expect(lessonSchemaFor('personal-travel-estrutural')).toBe(LessonSchema)
    expect(lessonSchemaFor(null)).toBe(LessonSchema)
    expect(lessonSchemaFor('personal-travel-v2')).toBe(LessonSchemaV2)
    expect(lessonSchemaFor('personal-travel-v2-piloto')).toBe(LessonSchemaV2)
  })

  it('`lessonSchemaBaseFor` (o schema que a IA recebe) despacha igual', () => {
    expect(lessonSchemaBaseFor('personal-travel')).toBe(LessonSchemaBase)
    expect(lessonSchemaBaseFor(null)).toBe(LessonSchemaBase)
    expect(lessonSchemaBaseFor('personal-travel-v2')).toBe(LessonSchemaBaseV2)
    // e o JSON Schema do v2 leva os tetos junto — sem isso a IA escreveria um
    // documento que o parse do mesmo rascunho recusaria
    const js = JSON.stringify(z.toJSONSchema(lessonSchemaBaseFor('personal-travel-v2')))
    expect((js.match(/"maxLength"/g) ?? []).length).toBeGreaterThan(20)
    expect(js).toContain(`"maxLength":${LEN.tip}`)
  })
})

// ------------------------------------------------- GET READY (módulo 0) no v2
/**
 * O CURSO COMEÇA ANTES DO MÓDULO 1. `GET READY WITH ME!` é a introdução do
 * Personal Travel e não é módulo numerado (`docs/research/06` §1): o
 * `climate.ts` já a trata desde a Fase 0a, aceitando `0` e `'get-ready'` como a
 * mesma chave dentro da PARTE 1. Só o CONTRATO não sabia — `module.number`
 * exigia 1–12 e recusava os cinco arquivos do módulo.
 *
 * A liberação é do **v2 apenas**. O v1 fala com a tabela `slide_lessons` do
 * banco de produção, que tem `check (module between 1 and 12)`: aceitar 0 lá
 * seria trocar um erro de validação por um erro de INSERT.
 */
describe('módulo 0 (GET READY) vale no v2 e continua proibido no v1', () => {
  const aulaNoModulo = (n: number) => ({
    course: 'personal-travel',
    module: { number: n, title: 'GET READY WITH ME!' },
    lesson: { number: 1, title: 'Aula' },
    level: 'A1',
    grammarFocus: ['x'],
    slides: [
      { type: 'cover', title: 'Capa' },
      { type: 'objectives', items: ['um', 'dois'] },
      { type: 'tip', text: 'curta' },
      { type: 'recap', items: ['um', 'dois'] },
      { type: 'closing' },
    ],
  })

  it('v2 aceita `module.number: 0`', () => {
    expect(LessonSchemaV2.safeParse(aulaNoModulo(0)).success).toBe(true)
    expect(LessonSchemaBaseV2.safeParse(aulaNoModulo(0)).success).toBe(true)
  })

  it('v1 REJEITA `module.number: 0`, no campo certo', () => {
    const r = LessonSchema.safeParse(aulaNoModulo(0))
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.') === 'module.number')).toBe(true)
    }
    expect(LessonSchemaBase.safeParse(aulaNoModulo(0)).success).toBe(false)
  })

  it('o resto da faixa não mudou em nenhum dos dois: 1 e 12 valem, 13 e -1 não', () => {
    for (const schema of [LessonSchema, LessonSchemaV2]) {
      expect(schema.safeParse(aulaNoModulo(1)).success).toBe(true)
      expect(schema.safeParse(aulaNoModulo(12)).success).toBe(true)
      expect(schema.safeParse(aulaNoModulo(13)).success).toBe(false)
      expect(schema.safeParse(aulaNoModulo(-1)).success).toBe(false)
    }
  })

  /**
   * O cartaz da missão imprime `Mission {number}` na tela. A missão do GET READY
   * é a 0 — numerá-la 1 poria duas "MISSION 1" no mesmo curso (a dela e a do
   * M1). Mesma regra, mesma metade: liberado no v2, proibido no v1.
   */
  it('o `number` do cartaz de mission segue a mesma regra', () => {
    const comMissao = (n: number) => ({
      ...aulaNoModulo(0),
      slides: [
        { type: 'cover', title: 'Capa' },
        { type: 'recap', items: ['um', 'dois'] },
        { type: 'mission', number: n, title: 'Missão', briefing: 'Faça isto.' },
        { type: 'tip', text: 'curta' },
        { type: 'closing' },
      ],
    })
    expect(LessonSchemaV2.safeParse(comMissao(0)).success).toBe(true)
    expect(LessonSchemaV2.safeParse(comMissao(4)).success).toBe(true)
    expect(LessonSchemaV2.safeParse(comMissao(13)).success).toBe(false)
    // no v1 o 0 cai duas vezes: no módulo e no cartaz
    const r = LessonSchema.safeParse(comMissao(0))
    expect(r.success).toBe(false)
    if (!r.success) {
      const campos = r.error.issues.map((i) => i.path.join('.'))
      expect(campos).toContain('module.number')
      expect(campos).toContain('slides.2.number')
    }
  })

  it('`climateFor(0)` devolve a PARTE 1 — o mesmo que `get-ready`', () => {
    const zero = climateFor(0)
    expect(zero.part).toBe(1)
    expect(zero.partTitle).toBe('THE PILLARS OF FLUENCY')
    expect(zero).toEqual(climateFor('get-ready'))
  })
})

/**
 * ITEM 22 (spec §7-quater) — o despacho do schema estava INCOMPLETO: só a CLI e
 * a geração do deck consultavam `lessonSchemaFor`. O save do JSON, a aprovação,
 * o save por seção, o editor e o rascunho por IA usavam `LessonSchema` direto,
 * então uma aula `personal-travel-v2` com `tip.text` de 5.000 caracteres podia
 * ser salva, anunciada como VÁLIDA e **aprovada** — só quebrava ao gerar.
 *
 * A UI hoje só cria v1 e a mina não explodiu ainda; ela explode no dia em que o
 * v2 entrar em uso. Estes pontos de entrada não podem voltar a fixar o contrato.
 *
 * ADR-027 (26/07): os dois pontos de entrada da TELA (`src/app/admin/slides/
 * actions.ts` e `[id]/page.tsx`) saíram da lista porque os arquivos deixaram de
 * existir — a tela foi removida, não afrouxada. O invariante continua valendo
 * inteiro para os pontos de entrada que sobraram, que são hoje TODOS os que
 * escrevem/validam aula (CLI + motor). Se uma tela voltar, ela volta para cá.
 */
describe('todo ponto de entrada despacha o contrato pelo curso (item 22)', () => {
  const ENTRADAS = ['src/lib/slides/draft.ts', 'scripts/slides/render-lesson.ts', 'src/lib/slides/build.ts']

  it('nenhum deles nomeia um contrato FIXO (LessonSchema/…V2) em código', () => {
    const presos: string[] = []
    for (const arquivo of ENTRADAS) {
      readFileSync(arquivo, 'utf8')
        .split('\n')
        .forEach((linha, i) => {
          if (/^\s*(\*|\/\/)/.test(linha)) return // comentário pode citar o nome
          if (/\bLessonSchema(Base)?(V2)?\b/.test(linha)) {
            presos.push(`${arquivo}:${i + 1}: ${linha.trim()}`)
          }
        })
    }
    expect(presos, presos.join('\n')).toEqual([])
  })

  it('e todos consultam `lessonSchemaFor`/`lessonSchemaBaseFor` (ou o `isV2` que sai dele)', () => {
    for (const arquivo of ENTRADAS) {
      const fonte = readFileSync(arquivo, 'utf8')
      expect(/lessonSchemaFor|lessonSchemaBaseFor|COURSE_V2_PREFIX/.test(fonte), arquivo).toBe(true)
    }
  })
})
