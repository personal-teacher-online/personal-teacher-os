// FS-M5: o painel avisa ANTES de gerar. Casos reais que quebraram na produção
// do M6 (21/07) viram teste.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { carregarSePresente, presente, privado } from './_privado'
import { LessonSchema, LessonSchemaV2 } from '../src/lib/slides/lesson-schema'
const { checkFit } = await carregarSePresente(() => import('../src/lib/slides/fit-check'))
import { AGRUPAMENTO, type StepsPlan } from '../src/lib/slides/layout'

/**
 * Único ponto mockado da suíte, e por um motivo: a razão de agrupamento do
 * cartaz é INVARIANTE por construção no `planSteps` (o respiro é derivado da
 * entrelinha), então não existe conteúdo legal que a quebre — e um aviso que
 * ninguém consegue disparar é um aviso que ninguém sabe se funciona. Aqui o
 * plano é forçado para provar que o `fit-check` mede a razão certa e diz o
 * número. É a rede para o dia em que alguém voltar a escrever o vão à mão.
 */
const forcado = vi.hoisted(() => ({ plans: null as StepsPlan[] | null }))
vi.mock('../src/lib/slides/template-v2', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/slides/template-v2')>()
  return {
    ...real,
    missionSteps: (s: Parameters<typeof real.missionSteps>[0]) => forcado.plans ?? real.missionSteps(s),
  }
})

function doc(slides: unknown[]) {
  return LessonSchema.parse({
    course: 'personal-travel',
    module: { number: 6, title: 'Time to Eat & Drink' },
    lesson: { number: 9, title: 'Teste' },
    level: 'A1',
    grammarFocus: ['x'],
    slides: [
      { type: 'cover' },
      { type: 'objectives', items: ['a', 'b'] },
      ...slides,
      { type: 'recap', items: ['a', 'b'] },
      { type: 'closing' },
    ],
  })
}

describe.skipIf(!presente)('checkFit', () => {
  it('as aulas prontas do M5 e M6 passam limpas', () => {
    for (const f of ['m5a1', 'm5a2', 'm5a3', 'm5a4', 'm5-mission']) {
      const d = LessonSchema.parse(JSON.parse(readFileSync(join(privado.content, 'personal-travel', `${f}.json`), 'utf8')))
      expect(checkFit(d).filter((a) => a.severity === 'estouro'), f).toHaveLength(0)
    }
  })

  it('writing no limite do contrato (6 itens, 3 deles unscramble) avisa aperto', () => {
    const w = checkFit(
      doc([
        {
          type: 'writing',
          instruction: 'x',
          exercises: [
            { kind: 'complete', items: [1, 2, 3].map((n) => ({ prompt: `p${n}`, answer: 'a' })) },
            { kind: 'unscramble', items: [1, 2, 3].map((n) => ({ prompt: `a / b / c${n}`, answer: 'a' })) },
          ],
        },
      ]),
    )
    expect(w.some((a) => a.type === 'writing')).toBe(true)
  })

  it('quiz com 6 perguntas e speaking com 6 frases avisam', () => {
    const w = checkFit(
      doc([
        { type: 'quiz', questions: Array.from({ length: 6 }, (_, i) => ({ q: `q${i}`, answer: 'a' })) },
        { type: 'speaking', instruction: 'x', phrases: Array.from({ length: 6 }, (_, i) => `f${i}`) },
      ]),
    )
    expect(w.filter((a) => a.type === 'quiz')).toHaveLength(1)
    expect(w.filter((a) => a.type === 'speaking')).toHaveLength(1)
  })

  it('missão com passos longos (caso do M6A5) avisa', () => {
    const w = checkFit(
      doc([
        {
          type: 'mission',
          number: 6,
          title: 'M',
          briefing: 'Pick a real restaurant in your dream destination. Study the menu online in English, build a full order, and record it in a voice message for Teacher Vicky — like you are really there!',
          steps: [
            "Ask ChatGPT to suggest 3 restaurants in your dream city (try: 'suggest top-rated restaurants in [city] with an English menu').",
            'Check reviews on Google Maps or TripAdvisor and pick your favorite one.',
            'Find the menu online and read it in English — note down dishes, drinks, and prices.',
            'Write your full order: starter, main course, drink, and one question for the waiter.',
            'Record a voice message on WhatsApp, ordering everything in English for Teacher Vicky.',
          ],
        },
      ]),
    )
    expect(w.some((a) => a.type === 'mission')).toBe(true)
  })

  /**
   * DEFEITO 3 do lote de 14 aulas (24/07): a paginação do writing é geométrica
   * e CADA nível de revelação repete todas as páginas — os três autores viram o
   * deck inflar (22 → 29 slides com 4 exercícios de produção) sem aviso nenhum.
   * Paginar é legítimo (decisão da Fase 0e); ser silencioso é que não era.
   */
  describe('writing que PAGINA avisa o preço em slides (defeito 3)', () => {
    const producao = (n: number) =>
      doc([
        {
          type: 'writing',
          instruction: 'Escreva as frases completas.',
          exercises: [
            {
              kind: 'create',
              items: Array.from({ length: n }, (_, i) => ({
                prompt: `Write about your trip (${i + 1})`,
                answer: `Resposta ${i + 1}`,
              })),
            },
          ],
        },
      ])

    it('4 exercícios de produção: avisa que viram 2 telas e quanto isso custa', () => {
      const w = checkFit(producao(4), 'personal-travel-v2').filter((a) => a.severity === 'paginação')
      expect(w).toHaveLength(1)
      // 2 telas × (1 base + 4 gabaritos) = 10 slides, contra 5 numa tela só
      expect(w[0].what).toContain('2 telas')
      expect(w[0].what).toContain('+5 slides')
      expect(w[0].fix).toContain('10 slides')
      expect(w[0].slide).toBe(3)
    })

    it('3 itens cabem numa tela só: nenhum aviso de paginação', () => {
      expect(checkFit(producao(3), 'personal-travel-v2').filter((a) => a.severity === 'paginação')).toEqual([])
    })

    it('o aviso é do v2 (é o v2 que pagina): no v1 nada muda', () => {
      expect(checkFit(producao(4)).filter((a) => a.severity === 'paginação')).toEqual([])
    })

    it('o diálogo tem a MESMA régua: falas que não cabem viram outra tela, com aviso', () => {
      const longa = 'Frase muito longa de propósito para forçar a pastilha a crescer e a banda a acabar'
      const d = doc([
        {
          type: 'dialogue',
          title: 'Cena',
          context: 'Contexto da cena, para a banda começar mais embaixo.',
          lines: Array.from({ length: 8 }, (_, i) => ({
            speaker: i % 2 ? 'Guest' : 'Receptionist',
            text: `${longa} ${longa}`,
          })),
        },
      ])
      const w = checkFit(d, 'personal-travel-v2').filter((a) => a.severity === 'paginação')
      expect(w).toHaveLength(1)
      expect(w[0].type).toBe('dialogue')
      expect(w[0].what).toContain('telas')
    })

    it('paginação NÃO é estouro: o portão de "sem estouro" continua aberto', () => {
      expect(
        checkFit(producao(4), 'personal-travel-v2').filter((a) => a.severity === 'estouro'),
      ).toEqual([])
    })
  })

  /**
   * AGRUPAMENTO NO CARTAZ (24/07). O aviso antigo (`passos longos demais para o
   * cartaz`, medido no planejador do v1) marcava as QUATRO missões do curso com
   * ✗ e mandava encurtar os passos — diagnóstico errado: no PNG nada estourava e
   * nada colidia. O que quebrava era a razão entre o vão que separa dois passos
   * e o vão que separa as duas linhas do mesmo passo (1.85–1.92×, mínimo 2.5×).
   */
  describe('missão v2: a régua é a RAZÃO DE AGRUPAMENTO, não o comprimento do passo', () => {
    const missao = (m: string) =>
      LessonSchemaV2.parse(JSON.parse(readFileSync(join(privado.content, 'personal-travel-v2', `${m}-mission.json`), 'utf8')))

    it('as quatro missões do curso passam limpas (era ✗ nas quatro)', () => {
      for (const m of ['m2', 'm3', 'm4', 'm5']) {
        const w = checkFit(missao(m), 'personal-travel-v2').filter((a) => a.type === 'mission')
        expect(w, `${m}: ${w.map((a) => a.what).join(' | ')}`).toEqual([])
      }
    })

    it('quando a razão cai abaixo do mínimo, o aviso DIZ a razão medida', () => {
      const dentro = 0.108
      forcado.plans = [
        { font: 12.5, lines: [2, 2], lineH: 0.215, gap: 0.1, gapDentro: dentro, gapEntre: 0.1 + dentro, fits: 2 },
      ]
      try {
        const w = checkFit(missao('m3'), 'personal-travel-v2').filter((a) => a.type === 'mission')
        expect(w).toHaveLength(1)
        expect(w[0].severity).toBe('estouro')
        expect(w[0].what).toContain(((0.1 + dentro) / dentro).toFixed(2))
        expect(w[0].what).toContain(`${AGRUPAMENTO}×`)
      } finally {
        forcado.plans = null
      }
    })
  })

  it('aula no tamanho certo não gera aviso nenhum', () => {
    const w = checkFit(
      doc([
        { type: 'quiz', questions: [{ q: 'a', answer: '1' }, { q: 'b', answer: '2' }] },
        { type: 'speaking', instruction: 'x', phrases: ['a', 'b', 'c'] },
      ]),
    )
    expect(w).toHaveLength(0)
  })
})
