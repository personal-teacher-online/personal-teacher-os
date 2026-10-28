// Invariante do deck: NADA passa da borda inferior (BODY_BOTTOM). Regressão do
// 1º deck real do M6A1 (21/07): writing com 2 exercícios e grammar com regra
// longa + tabela caíam por cima do rodapé.
import { describe, expect, it } from 'vitest'
import { BODY_BOTTOM, BOTTOM_PAD, BODY_Y, charsPerLine, fitFont, fitStep, planCover, planGrammar, planMission, planWriting, wrapLines } from '../src/lib/slides/layout'

const chip1 = () => 1

describe('planWriting', () => {
  it('caso do M6A1 (3 complete + 2 unscramble) cabe no slide', () => {
    const plan = planWriting(
      [
        { kind: 'complete', items: [1, 2, 3] },
        { kind: 'unscramble', items: [1, 2] },
      ],
      chip1,
    )
    expect(plan.bottom).toBeLessThanOrEqual(BODY_BOTTOM + 0.001)
    const last = plan.blocks[plan.blocks.length - 1]
    expect(last.y + last.h).toBeLessThanOrEqual(BODY_BOTTOM + 0.001)
    expect(plan.k).toBeLessThan(1)
    expect(plan.fontSize).toBeGreaterThanOrEqual(10.6)
  })

  it('caso folgado não comprime nada', () => {
    const plan = planWriting([{ kind: 'complete', items: [1, 2, 3, 4] }], chip1)
    expect(plan.k).toBe(1)
    expect(plan.fontSize).toBe(13)
    expect(plan.bottom).toBeLessThanOrEqual(BODY_BOTTOM + 0.001)
  })

  it('caso do M6A2 (4 complete + 3 unscramble) CABE — regressão do 2º deck', () => {
    const plan = planWriting(
      [
        { kind: 'complete', items: [1, 2, 3, 4] },
        { kind: 'unscramble', items: [1, 2, 3] },
      ],
      chip1,
    )
    const last = plan.blocks[plan.blocks.length - 1]
    expect(last.y + last.h).toBeLessThanOrEqual(BODY_BOTTOM + 0.001)
    expect(plan.bottom).toBeLessThanOrEqual(BODY_BOTTOM + 0.001)
  })

  it('extremo do contrato (limite de 6 itens, chips em 2 linhas) cabe', () => {
    const plan = planWriting(
      [
        { kind: 'complete', items: [1, 2, 3] },
        { kind: 'unscramble', items: [1, 2, 3] },
      ],
      () => 2,
    )
    expect(plan.bottom).toBeLessThanOrEqual(BODY_BOTTOM + 0.001)
    expect(plan.blocks.every((b) => b.h > 0)).toBe(true)
  })

  it('todos os blocos ficam em ordem e sem sobreposição', () => {
    const plan = planWriting(
      [{ kind: 'complete', items: [1, 2] }, { kind: 'create', items: [1] }],
      chip1,
    )
    for (let i = 1; i < plan.blocks.length; i++) {
      const prev = plan.blocks[i - 1]
      expect(plan.blocks[i].y).toBeGreaterThanOrEqual(prev.y + prev.h - 0.001)
    }
    expect(plan.blocks[0].y).toBeGreaterThanOrEqual(BODY_Y)
  })
})

describe('fitStep', () => {
  it('6 frases de speaking cabem', () => {
    const step = fitStep(BODY_Y + 0.34, 6, 0.52, 0.46)
    expect(BODY_Y + 0.34 + 5 * step + 0.46).toBeLessThanOrEqual(BODY_BOTTOM + 0.001)
  })
  it('lista curta mantém o passo folgado', () => {
    expect(fitStep(BODY_Y + 0.12, 3, 0.56, 0.5)).toBe(0.56)
  })
})

describe('planGrammar', () => {
  it('regra longa + tabela de 4 linhas: tabela termina dentro do slide', () => {
    const p = planGrammar({
      rule: 'Use I like + comida para dizer o que você gosta, I don\'t like para o que não gosta, e I\'d like (= I would like) para pedir algo de forma educada. Para apontar algo no cardápio, use this (perto) ou that (longe) e pergunte What\'s this?',
      tableRows: 4,
      examples: ['a', 'b', 'c', 'd', 'e'],
      hasWatchOut: true,
    })
    expect(p.tableY + 5 * p.tableRowH).toBeLessThanOrEqual(BODY_BOTTOM + 0.001)
    expect(p.tableRowH).toBeGreaterThanOrEqual(0.18)
  })

  it('tabela do M6A2 (5 linhas com células que QUEBRAM) cabe — regressão do 2º deck', () => {
    const p = planGrammar({
      rule: 'Use essas estruturas prontas para pedir qualquer coisa. Can I have e mais neutro, Could I get e mais educado, I\'ll have e quando voce ja decidiu. Use some em frases afirmativas/pedidos e any em perguntas e negativas. Use How much para coisas incontaveis (dinheiro, agua) e How many para coisas contaveis (pessoas, itens).',
      tableHeaders: ['Structure', 'Example', 'Use'],
      tableCells: [
        ['Can I have...?', 'Can I have some water?', 'Pedido simples'],
        ["I'll have...", "I'll have the pasta, please.", 'Voce ja decidiu'],
        ['Could I get...?', 'Could I get the bill?', 'Mais educado'],
        ['Do you have any...?', 'Do you have any salads?', 'Perguntar disponibilidade'],
      ],
      examples: ['a', 'b', 'c', 'd', 'e', 'f'],
      hasWatchOut: true,
    })
    expect(p.tableY + 5 * p.tableRowH).toBeLessThanOrEqual(BODY_BOTTOM + 0.001)
    expect(p.tableFont).toBeLessThanOrEqual(11.5)
    expect(p.ruleH).toBeGreaterThan(0.7)
  })

  it('watch out fica ancorado acima da borda e os exemplos não invadem', () => {
    const p = planGrammar({ rule: 'curta', tableRows: 0, examples: ['a', 'b', 'c', 'd', 'e', 'f'], hasWatchOut: true })
    expect(p.watchOutY + p.watchOutH).toBeCloseTo(BODY_BOTTOM, 5)
    expect(BODY_Y + 0.06 + 6 * p.exampleStep).toBeLessThanOrEqual(p.watchOutY + 0.001)
  })

  it('sem tabela e sem watch out usa o espaço todo', () => {
    const p = planGrammar({ rule: 'curta', tableRows: 0, examples: ['a', 'b'], hasWatchOut: false })
    expect(p.tableRowH).toBe(0)
    expect(p.watchOutH).toBe(0)
    expect(BODY_Y + 0.06 + 2 * p.exampleStep).toBeLessThanOrEqual(BODY_BOTTOM + 0.001)
  })
})

describe('fitFont e respiro do rodapé (3ª rodada — M6A2)', () => {
  it('regra longa em cartão baixo ganha fonte menor (não vaza)', () => {
    const longa =
      'Use essas estruturas prontas para pedir qualquer coisa. Can I have e mais neutro, Could I get e mais educado, I\'ll have e quando voce ja decidiu. Use some em frases afirmativas e any em perguntas.'
    expect(fitFont(longa, 4.42, 0.9)).toBeLessThanOrEqual(10.5)
    expect(fitFont('Regra curta.', 4.42, 1.6)).toBe(13)
  })

  it('tabela nunca encosta no rodapé (margem de respiro)', () => {
    const p = planGrammar({
      rule: 'Use I like para gostos e I would like para pedidos. This aponta o que esta perto; that, o que esta longe.',
      tableHeaders: ['Structure', 'Example', 'Use'],
      tableCells: [
        ['Can I have...?', 'Can I have some water?', 'Pedido simples'],
        ["I'll have...", "I'll have the pasta, please.", 'Voce ja decidiu'],
        ['Could I get...?', 'Could I get the bill?', 'Mais educado'],
      ],
      examples: ['a', 'b', 'c', 'd'],
      hasWatchOut: true,
    })
    expect(p.tableY + 4 * p.tableRowH).toBeLessThanOrEqual(BODY_BOTTOM - BOTTOM_PAD + 0.001)
    // e a regra recebe fonte que cabe na altura que sobrou
    const linhas = Math.ceil(105 / Math.round(4.42 * (121 / p.ruleFont)))
    expect(linhas * p.ruleFont * 0.0158).toBeLessThanOrEqual(p.ruleH - 0.28 + 0.001)
  })
})

describe('planCover — o fio vem SEMPRE logo abaixo do título', () => {
  const GAP = 0.14

  function invariantes(t: string, hasImage = false) {
    const c = planCover(t, hasImage)
    // 1) o fio acompanha o título, com respiro constante
    expect(c.stripY, `fio de "${t}"`).toBeCloseTo(c.titleY + c.titleH + GAP, 5)
    // 2) subtítulo abaixo do fio e tudo acima do logotipo
    expect(c.subtitleY, t).toBeGreaterThan(c.stripY)
    expect(c.subtitleY + 0.6, t).toBeLessThanOrEqual(4.84)
    // 3) o título nunca invade o eyebrow
    expect(c.titleY, t).toBeGreaterThanOrEqual(1.6 - 0.001)
    return c
  }

  it('título de 1 linha: fio logo abaixo (M6A4 — estava solto no meio)', () => {
    const c = invariantes('Do Pedido à Conta Sem Travar')
    expect(c.lines).toBe(1)
    // O DEGRAU CAIU DE 38 PARA 34 EM 25/07 — decisão consciente, não deriva.
    // Este título mede 14,70 em de Bricolage bold; a 38pt são 7,760" e a caixa
    // útil (8,0" menos as margens internas de 0,1" do PowerPoint) tem 7,800":
    // cabe com 0,5% de folga. Foi assim que ele foi medido no Google Slides em
    // 21/07, e continua verdade LÁ. Só que o mesmo .pptx é aberto por quem NÃO
    // tem o Bricolage instalado, e a fonte substituta desenha até ~7% mais
    // largo (medido nas provas em PNG) — 0,5% de folga não sobrevive a isso, e
    // o preço do erro é o fio riscando a segunda linha. `DISPLAY_SAFE` reserva
    // 6%, e o título desce um degrau. A INVARIANTE (uma linha, fio colado
    // embaixo) é a mesma; o que mudou é quanto de robustez ela custa.
    expect(c.titleFont).toBe(34)
    expect(c.stripY).toBeLessThan(2.6)
  })

  it('título de 2 linhas mantém a capa clássica (fio ~3.1)', () => {
    const c = invariantes('Signs & Maps: Understand the City')
    expect(c.lines).toBe(2)
    expect(c.stripY).toBeGreaterThan(2.9)
    expect(c.stripY).toBeLessThan(3.3)
  })

  it('título longo reduz a fonte em vez de atropelar o fio (M6A3)', () => {
    const c = invariantes('Problemas no Restaurante? Resolva com Educação e Segurança')
    expect(c.titleFont).toBeLessThan(38)
  })

  it('vale para TODAS as capas do M5 e M6', () => {
    for (const t of [
      'Getting Around Without Fear',
      'Signs & Maps: Understand the City',
      'Asking for Directions',
      'When Things Go Wrong on the Way',
      'Mission 5: Smart Route',
      'Menu Sem Segredos: Vocabulário Essencial e Atual',
      'Estruturas Práticas para Pedir Comida Sem Pensar Demais',
      'Problemas no Restaurante? Resolva com Educação e Segurança',
      'Diálogos Reais: Do Pedido à Conta Sem Travar',
      'Mission 6: Menu Sem Mistérios',
    ]) invariantes(t)
  })

  it('vale com foto na capa (coluna mais estreita)', () => {
    invariantes('Problemas no Restaurante? Resolva com Educação e Segurança', true)
    invariantes('Asking for Directions', true)
  })

  it('título absurdo continua dentro das invariantes', () => {
    const c = invariantes('Um título absurdamente longo que jamais caberia com a fonte cheia da capa noturna porque tem palavras demais para o espaço disponível')
    expect(c.titleFont).toBeLessThanOrEqual(26)
  })
})

describe('wrapLines (quebra por palavra)', () => {
  it('conta linhas como o renderizador quebra', () => {
    expect(wrapLines('Do Pedido à Conta Sem Travar', 28)).toBe(1)
    expect(wrapLines('Problemas no Restaurante? Resolva com Educação e Segurança', 28)).toBe(3)
    expect(wrapLines('uma linha só', 40)).toBe(1)
    expect(wrapLines('', 20)).toBe(1)
  })
  it('palavra maior que a linha não trava a conta', () => {
    expect(wrapLines('supercalifragilisticexpialidocious', 10)).toBeGreaterThanOrEqual(4)
  })
})

describe('calibração da quebra do título (casos MEDIDOS no Slides)', () => {
  it('"Do Pedido à Conta Sem Travar" cabe em 1 linha com 38pt', () => {
    expect(wrapLines('Do Pedido à Conta Sem Travar', charsPerLine(8.0, 38, true))).toBe(1)
  })
  it('"Problemas no Restaurante? Resolva…" NÃO cabe em 2 linhas com 34pt', () => {
    expect(wrapLines('Problemas no Restaurante? Resolva com Educação e Segurança', charsPerLine(8.0, 34, true))).toBe(3)
  })
})

describe('planMission (M6A5 — passos longos estouravam a borda)', () => {
  const M6A5 = {
    briefing: "Pick a real restaurant in your dream destination. Study the menu online in English, build a full order, and record it in a voice message for Teacher Vicky — like you're really there!",
    steps: [
      "Ask ChatGPT to suggest 3 restaurants in your dream city (try: 'suggest top-rated restaurants in [city] with an English menu').",
      'Check reviews on Google Maps or TripAdvisor and pick your favorite one.',
      'Find the menu online and read it in English — note down dishes, drinks, and prices.',
      'Write your full order: starter, main course, drink, and one question for the waiter.',
      'Record a voice message on WhatsApp, ordering everything in English for Teacher Vicky.',
    ],
  }

  it('o bloco inteiro cabe acima da borda', () => {
    const p = planMission(M6A5)
    const fim = p.stepsY + p.stepLines.reduce((n, l) => n + l * p.stepStep, 0) + (M6A5.steps.length - 1) * 0.08
    expect(fim).toBeLessThanOrEqual(5.0 + 0.001)
    expect(p.stepsY).toBeGreaterThan(p.briefingY + p.briefingH - 0.001)
  })

  it('missão curta (M5) mantém a fonte cheia', () => {
    const p = planMission({
      briefing: 'Plan a real day of sightseeing in a city you dream of visiting — everything in English.',
      steps: ['Choose a city and 3 places', 'Plan the route', 'Decide the transport', 'Record a voice note', 'Send it to Kelly'],
    })
    expect(p.stepFont).toBe(12.5)
    expect(p.stepLines.every((l) => l === 1)).toBe(true)
  })
})
