// @vitest-environment jsdom
//
// ONDA DA AGENDA · A2 — o motor do calendário no kit.
//
// O que este arquivo trava, na ordem do risco:
//   1. MOTOR (a parte provada que o fork NÃO podia mudar): lanes gulosas de
//      eventos sobrepostos; partição por dia no fuso de exibição (Lei 1 —
//      provada na virada de OUTONO de NY, dos dois lados E na hora repetida;
//      a hora INEXISTENTE da primavera fica declarada, não provada); evento de
//      outra semana não vaza; camadas de fundo sem roubo de clique e com
//      muting do rótulo coberto; linha do agora; span de horas calculado SÓ
//      sobre os dias renderizados (conserto da rodada 1 do Sol).
//   2. PELE (a régua MEDIDA do TutorBird que o fork DEVIA mudar): hoje =
//      círculo da MARCA (nunca mais `bg-ink-900`), célula do mês ~133px,
//      cabeçalho dos dias em 14px na tinta forte — e a régua de legibilidade
//      do AGENTS.md nos chips (DADO/AÇÃO ≥ text-sm; eixo de horas é APOIO).
//   3. PROIBIÇÃO do AGENTS.md: zero `<details data-popup>` no arquivo novo; os
//      popups são o Popover do kit — presença e fiação provadas por render.
//      ⚠️ DECLARADO: a INTERAÇÃO de abrir/fechar o Popover não roda no jsdom
//      (Radix depende de APIs de layout/pointer que o jsdom não implementa) —
//      ela fica para o harness e2e do A9. Aqui se prova que o gatilho existe,
//      é um botão de verdade e está ligado ao Radix; não se finge mais que isso.
//   4. GUARDA DO FORK: se alguém fora de `/teacher` voltar a importar o
//      `CalendarGrid` velho, este arquivo fica vermelho — o fork existe para o
//      admin nunca mais depender do gêmeo legado.
//
// Padrão do a1: relógio congelado (só o Date — os timers reais ficam vivos
// para o `act` do React), sem banco.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Calendario, type CalEvent } from '@/components/kit/calendario'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RAIZ = path.resolve(__dirname, '..')
const arquivo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** O fonte SEM comentários — a varredura mira código; o cabeçalho do arquivo
 *  novo tem todo o direito de NARRAR a morte do `<details data-popup>`. */
const codigo = (rel: string) =>
  arquivo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const CALENDARIO = 'src/components/kit/calendario.tsx'
const GEMEO_LEGADO = 'src/components/CalendarGrid.tsx'
const BALAO_DO_SLOT = 'src/components/kit/balao-do-slot.tsx'

/* ========================================================================== */
/* Render                                                                      */
/* ========================================================================== */

let container: HTMLDivElement
let root: Root

interface PropsDoRender {
  events: CalEvent[]
  view: 'mes' | 'semana' | 'dia'
  anchor: string
  tz?: string
  todayISO?: string
  slotHref?: (dateISO: string, timeHHmm: string) => string
  slotPopup?: (dateISO: string, timeHHmm: string) => React.ReactNode
}

async function montar(props: PropsDoRender): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      h(Calendario, {
        tz: 'America/Cuiaba',
        todayISO: '2026-07-28',
        dayHref: (iso: string) => `/admin/agenda?v=dia&d=${iso}`,
        ...props,
      }),
    )
  })
  return container
}

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

beforeEach(() => {
  // Congela SÓ o Date: o `act` do React precisa dos timers/microtasks reais.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-28T18:00:00Z')) // 14:00 em Cuiabá (UTC−4)
})

/** Uma aula simples, sem popup (vira <div> com title) — o caso puro do motor. */
function aula(campos: { id: string; inicioUtc: string; fimUtc?: string; title?: string }): CalEvent {
  return {
    id: campos.id,
    startsAtUtc: campos.inicioUtc,
    endsAtUtc: campos.fimUtc ?? null,
    title: campos.title ?? campos.id,
    color: 0,
  }
}

/* ========================================================================== */
/* 1. MOTOR — lanes                                                            */
/* ========================================================================== */

describe('A2 · motor: duas aulas sobrepostas dividem a largura (lanes)', () => {
  it('sobreposição de 2 → cada bloco com metade da coluna, lados distintos', async () => {
    // Cuiabá UTC−4: 14:00 local = 18:00Z. A segunda começa no meio da primeira.
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [
        aula({ id: 'a', inicioUtc: '2026-07-29T18:00:00Z', fimUtc: '2026-07-29T18:45:00Z', title: 'Aula A' }),
        aula({ id: 'b', inicioUtc: '2026-07-29T18:30:00Z', fimUtc: '2026-07-29T19:15:00Z', title: 'Aula B' }),
      ],
    })
    // lane dividida esconde o horário do chip e o move para o title (rodada 2
    // do Sol) — por isso o seletor por CONTÉM; a migração em si tem teste próprio
    const blocoA = c.querySelector<HTMLElement>('[title*="Aula A"]')!
    const blocoB = c.querySelector<HTMLElement>('[title*="Aula B"]')!
    expect(blocoA.style.width).toBe('calc(50% - 4px)')
    expect(blocoB.style.width).toBe('calc(50% - 4px)')
    // lados distintos — sem isso "metade da largura" poderia ser empilhamento
    expect(blocoA.style.left).toBe('calc(0% + 2px)')
    expect(blocoB.style.left).toBe('calc(50% + 2px)')
  })

  it('lane dividida: o horário calado vive no NOME ACESSÍVEL (sr-only) e no title com hoverExtra', async () => {
    // Rodada 3 do Sol (P1): toque e teclado não têm hover — o horário que o
    // chip cala tem de sobreviver no nome acessível do gatilho (sr-only), não
    // só no title do hover. E o hoverExtra não pode se perder na migração.
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [
        {
          ...aula({ id: 'a', inicioUtc: '2026-07-29T18:00:00Z', fimUtc: '2026-07-29T18:45:00Z', title: 'Aula A' }),
          hoverExtra: '11:00 do aluno',
        },
        aula({ id: 'b', inicioUtc: '2026-07-29T18:30:00Z', fimUtc: '2026-07-29T19:15:00Z', title: 'Aula B' }),
      ],
    })
    const blocoA = c.querySelector<HTMLElement>('[title*="Aula A"]')!
    expect(blocoA.getAttribute('title')).toBe('14:00 Aula A — 11:00 do aluno')
    expect(blocoA.querySelector('.sr-only')?.textContent).toContain('14:00')
  })

  it('lane dividida COM popup: o GATILHO fechado já se chama "HH:mm título"', async () => {
    // Rodada 4 do Sol: o caso sem popup não prova o gatilho real do Radix —
    // é o nome acessível do <button> fechado que toque/teclado recebem.
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [
        {
          ...aula({ id: 'a', inicioUtc: '2026-07-29T18:00:00Z', fimUtc: '2026-07-29T18:45:00Z', title: 'Aula A' }),
          hoverExtra: '11:00 do aluno',
          popup: h('p', null, 'detalhe'),
        },
        { ...aula({ id: 'b', inicioUtc: '2026-07-29T18:30:00Z', fimUtc: '2026-07-29T19:15:00Z', title: 'Aula B' }), popup: h('p', null, 'detalhe') },
      ],
    })
    const gatilho = c.querySelector<HTMLElement>('button[title*="Aula A"]')!
    expect(gatilho, 'o bloco com popup deveria ser um <button>').not.toBeNull()
    expect(gatilho.textContent).toContain('14:00')
    expect(gatilho.textContent).toContain('Aula A')
    expect(gatilho.getAttribute('title')).toBe('14:00 Aula A — 11:00 do aluno')
  })

  it('aula que NÃO sobrepõe fica com a coluna inteira', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [
        aula({ id: 'a', inicioUtc: '2026-07-29T18:00:00Z', fimUtc: '2026-07-29T18:45:00Z', title: 'Aula A' }),
        aula({ id: 'c', inicioUtc: '2026-07-29T20:00:00Z', fimUtc: '2026-07-29T20:45:00Z', title: 'Aula C' }),
      ],
    })
    expect(c.querySelector<HTMLElement>('[title="Aula C"]')!.style.width).toBe('calc(100% - 4px)')
  })
})

/* ========================================================================== */
/* 2. MOTOR — partição por dia e por semana                                    */
/* ========================================================================== */

describe('A2 · motor: aula de outra semana não vaza para a grade', () => {
  it('semana de 27/07–02/08 não mostra a aula de 05/08', async () => {
    const c = await montar({
      view: 'semana',
      anchor: '2026-07-28',
      events: [
        aula({ id: 'dentro', inicioUtc: '2026-07-29T18:00:00Z', title: 'Desta semana' }),
        aula({ id: 'fora', inicioUtc: '2026-08-05T18:00:00Z', title: 'Da outra semana' }),
      ],
    })
    expect(c.querySelector('[title="Desta semana"]')).not.toBeNull()
    expect(c.querySelector('[title="Da outra semana"]')).toBeNull()
  })
})

describe('A2 · Lei 1: a partição respeita o fuso de exibição na virada de DST', () => {
  // Nova York sai do horário de verão em 01/11/2026 (EDT −4 → EST −5). A aula
  // "das 10h da manhã" é armazenada como INSTANTE UTC diferente em cada lado da
  // virada — e a grade tem de mostrá-la às 10:00 nos dois. Offset fixo em
  // qualquer ponto do motor reprovaria aqui.
  // HONESTIDADE do que este bloco prova: a virada de OUTONO (fall-back), dos
  // dois lados e dentro da mesma semana, mais a HORA REPETIDA (01:30 acontece
  // duas vezes em 01/11). A hora INEXISTENTE da primavera (spring-forward) NÃO
  // está coberta — fica declarada, não prometida.
  const NY = 'America/New_York'
  const ANTES = aula({ id: 'edt', inicioUtc: '2026-10-30T14:00:00Z', fimUtc: '2026-10-30T14:45:00Z', title: 'Aula EDT' }) // 10:00 EDT
  const DEPOIS = aula({ id: 'est', inicioUtc: '2026-11-02T15:00:00Z', fimUtc: '2026-11-02T15:45:00Z', title: 'Aula EST' }) // 10:00 EST

  it('antes da virada: 14:00Z cai no dia 30/10 às 10:00 locais', async () => {
    const c = await montar({ view: 'dia', anchor: '2026-10-30', tz: NY, events: [ANTES, DEPOIS] })
    const bloco = c.querySelector<HTMLElement>('[title="Aula EDT"]')!
    expect(bloco.textContent).toContain('10:00')
    // a aula do outro lado da virada NÃO pertence a este dia
    expect(c.querySelector('[title="Aula EST"]')).toBeNull()
  })

  it('depois da virada: 15:00Z cai no dia 02/11 às MESMAS 10:00 locais', async () => {
    const c = await montar({ view: 'dia', anchor: '2026-11-02', tz: NY, events: [ANTES, DEPOIS] })
    const bloco = c.querySelector<HTMLElement>('[title="Aula EST"]')!
    expect(bloco.textContent).toContain('10:00')
    expect(c.querySelector('[title="Aula EDT"]')).toBeNull()
  })

  it('na MESMA semana da virada, os dois blocos ficam na mesma altura (10h)', async () => {
    // Semana de 26/10 (seg) a 01/11 (dom): a virada acontece dentro dela. A
    // aula de sáb 31/10 (EDT) e a de dom 01/11 pós-virada (EST) são instantes
    // UTC com offsets DIFERENTES — mas ambas às 10:00 locais, logo o `top` em
    // pixels tem de ser IDÊNTICO. Um offset fixo deslocaria uma delas em 64px.
    const SAB = aula({ id: 's', inicioUtc: '2026-10-31T14:00:00Z', fimUtc: '2026-10-31T14:45:00Z', title: 'Sábado' })
    const DOM = aula({ id: 'd', inicioUtc: '2026-11-01T15:00:00Z', fimUtc: '2026-11-01T15:45:00Z', title: 'Domingo' })
    const c = await montar({ view: 'semana', anchor: '2026-10-26', tz: NY, events: [SAB, DOM] })
    const topSab = c.querySelector<HTMLElement>('[title="Sábado"]')!.style.top
    const topDom = c.querySelector<HTMLElement>('[title="Domingo"]')!.style.top
    expect(topSab).toBe(topDom)
    expect(topSab).not.toBe('')
  })

  it('hora repetida do fall-back: os dois 01:30 de 01/11 são blocos distintos às 01:30', async () => {
    // Em 01/11/2026 o relógio de NY marca 01:30 DUAS vezes: 05:30Z (EDT) e
    // 06:30Z (EST). Os dois instantes são aulas DISTINTAS, ambas às 01:30
    // locais → mesma altura na grade; como as lanes operam sobre instantes UTC
    // (os dois não se sobrepõem de verdade), os blocos coincidem visualmente
    // na parede do relógio. Este caso NÃO OCORRE no fork do admin: a grade
    // exibe em America/Cuiaba, que não tem DST — fica documentado aqui para a
    // onda da professora (fuso próprio, F3-D2), onde o quirk pertence.
    const PRIMEIRA = aula({ id: 'p', inicioUtc: '2026-11-01T05:30:00Z', fimUtc: '2026-11-01T06:15:00Z', title: 'Primeira 01:30' })
    const SEGUNDA = aula({ id: 's', inicioUtc: '2026-11-01T06:30:00Z', fimUtc: '2026-11-01T07:15:00Z', title: 'Segunda 01:30' })
    const c = await montar({ view: 'dia', anchor: '2026-11-01', tz: NY, events: [PRIMEIRA, SEGUNDA] })
    const b1 = c.querySelector<HTMLElement>('[title="Primeira 01:30"]')!
    const b2 = c.querySelector<HTMLElement>('[title="Segunda 01:30"]')!
    expect(b1.textContent).toContain('01:30')
    expect(b2.textContent).toContain('01:30')
    expect(b1.style.top).toBe(b2.style.top)
    // sem sobreposição REAL (UTC), cada uma fica com a coluna inteira
    expect(b1.style.width).toBe('calc(100% - 4px)')
    expect(b2.style.width).toBe('calc(100% - 4px)')
  })
})

/* ========================================================================== */
/* 2b. MOTOR — camadas, muting, linha do agora, span, meias-horas              */
/* ========================================================================== */

describe('A2 · motor: camadas de fundo não roubam clique nem gritam sob a frente', () => {
  const GHOST: CalEvent = {
    ...aula({ id: 'gh', inicioUtc: '2026-07-29T19:00:00Z', fimUtc: '2026-07-29T20:00:00Z', title: 'Compromisso' }),
    ghost: true,
  }

  it('disponibilidade e ghost sem popup: pointer-events-none (o slot embaixo segue vivo)', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [
        { ...aula({ id: 'exp', inicioUtc: '2026-07-29T12:00:00Z', fimUtc: '2026-07-29T22:00:00Z', title: 'Expediente' }), avail: true },
        GHOST,
      ],
    })
    expect(c.querySelector<HTMLElement>('[title="Expediente"]')!.className).toContain('pointer-events-none')
    expect(c.querySelector<HTMLElement>('[title="Compromisso"]')!.className).toContain('pointer-events-none')
  })

  it('o rótulo do ghost fala quando está sozinho…', async () => {
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [GHOST] })
    expect(c.querySelector<HTMLElement>('[title="Compromisso"]')!.textContent).toContain('Compromisso')
  })

  it('ghost COM popup também está no piso de DADO (rodadas 3 e 5: font-medium + ink-900)', async () => {
    // O EventLabel podia regredir só no ramo do ghost-com-popup e os casos do
    // ghost de fundo continuariam verdes — este caso fecha o ramo que faltava.
    // Rodada 5: ghost é DADO e a régua §DADO é literal (ink-900); o ink-600
    // era piso de RÓTULO segurado por uma distinção "advisory" que morreu.
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [{ ...GHOST, popup: h('p', null, 'detalhe') }],
    })
    const bloco = c.querySelector<HTMLElement>('[title="Compromisso"]')!
    expect(bloco.innerHTML).toContain('font-medium')
    expect(bloco.innerHTML).not.toContain('font-normal')
    expect(bloco.innerHTML).toContain('text-ink-900')
    expect(bloco.innerHTML).not.toContain('text-ink-600')
  })

  it('expediente nunca veste roupa de aula sólida (isSolid comportamental)', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [
        { ...aula({ id: 'exp', inicioUtc: '2026-07-29T12:00:00Z', fimUtc: '2026-07-29T22:00:00Z', title: 'Expediente' }), avail: true },
      ],
    })
    const bloco = c.querySelector<HTMLElement>('[title="Expediente"]')!
    expect(bloco.className).toContain('opacity-50')
    expect(bloco.className).not.toContain('shadow')
    // rodada 4: a ROUPA importa — tint da professora, nunca o fill sólido
    // (fill+opacity-50 sem sombra ainda passaria só pelas duas de cima)
    expect(bloco.className).toContain('-tint)')
    expect(bloco.className).not.toContain('-fill)')
  })

  it('BarraDaAgenda também fala a cor da marca por token (fora do alcance da varredura global)', () => {
    // A varredura da Onda 1 cobre src/components/kit/, não admin/agenda/ —
    // sem este caso, um brand-700 futuro na toolbar passaria pelos dois guardas.
    const fonte = codigo('src/components/admin/agenda/BarraDaAgenda.tsx')
    expect(fonte).not.toMatch(/\bbrand-\d{3}\b/)
    expect(fonte).toContain('text-ac-deep')
  })

  it('…e cala quando um bloco de frente cobre a zona do texto (title preserva o dado)', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [GHOST, aula({ id: 'a', inicioUtc: '2026-07-29T19:00:00Z', fimUtc: '2026-07-29T19:45:00Z', title: 'Aula por cima' })],
    })
    const bloco = c.querySelector<HTMLElement>('[title="Compromisso"]')!
    expect(bloco.textContent).toBe('')
    expect(bloco.getAttribute('title')).toBe('Compromisso')
  })
})

describe('A2 · motor: linha do agora', () => {
  it('presente quando hoje está na grade (14:00 de Cuiabá dentro de 7–21h)', async () => {
    const c = await montar({ view: 'dia', anchor: '2026-07-28', events: [] })
    expect(c.querySelector('[class*="border-danger-700"]')).not.toBeNull()
  })

  it('ausente quando a grade mostra outro dia', async () => {
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [] })
    expect(c.querySelector('[class*="border-danger-700"]')).toBeNull()
  })
})

describe('A2 · motor: span de horas calculado SÓ sobre os dias renderizados', () => {
  it('semana no celular: aula das 06:00 de OUTRO dia não estica o dia mostrado', async () => {
    // Âncora na terça 28/07; a madrugadora é na QUINTA às 06:00 locais (10:00Z
    // em Cuiabá). A visão semana renderiza DOIS TimeGrids (jsdom não aplica
    // media query): o do celular mostra SÓ a terça → span default 7–21
    // (14h × 64px = 896px); o do desktop mostra a semana inteira e
    // legitimamente abre às 06:00 → span 6–21 (960px). Antes do conserto os
    // dois esticavam para 960px e o '896px' não existia no DOM.
    const c = await montar({
      view: 'semana',
      anchor: '2026-07-28',
      events: [
        aula({ id: 'cedo', inicioUtc: '2026-07-30T10:00:00Z', title: 'Madrugadora' }),
        aula({ id: 'normal', inicioUtc: '2026-07-28T18:00:00Z', title: 'Normal' }),
      ],
    })
    const alturas = [...c.querySelectorAll<HTMLElement>('div[style*="height"]')].map((el) => el.style.height)
    expect(alturas).toContain('896px')
    expect(alturas).toContain('960px')
  })
})

describe('A2 · motor: as meias-horas do quick-create', () => {
  it('28 gatilhos por dia no span default (7h–21h)', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [],
      slotPopup: (_iso, hhmm) => h('p', null, hhmm),
    })
    expect(c.querySelectorAll('button[title^="Criar às"]')).toHaveLength(28)
  })
})

/* ========================================================================== */
/* 3. PELE — a régua medida do TutorBird                                       */
/* ========================================================================== */

describe('A2 · pele: hoje é o círculo da MARCA, nunca mais tinta preta', () => {
  it('na grade de horas e na faixa do celular (view semana)', async () => {
    const c = await montar({ view: 'semana', anchor: '2026-07-28', todayISO: '2026-07-28', events: [] })
    // cabeçalho da TimeGrid + DayStrip: pelo menos dois círculos da marca
    expect(c.querySelectorAll('[class*="bg-ac-deep"]').length).toBeGreaterThanOrEqual(2)
    expect(c.innerHTML).not.toContain('bg-ink-900')
  })

  it('na grade do mês', async () => {
    const c = await montar({ view: 'mes', anchor: '2026-07-28', todayISO: '2026-07-28', events: [] })
    const hoje = [...c.querySelectorAll<HTMLAnchorElement>('a[title="Abrir o dia"]')].find(
      (a) => a.className.includes('bg-ac-deep'),
    )
    expect(hoje, 'o número de hoje perdeu o círculo da marca').toBeDefined()
    expect(hoje!.textContent).toBe('28')
    expect(c.innerHTML).not.toContain('bg-ink-900')
  })
})

describe('A2 · pele: célula do mês na altura da régua (~133px)', () => {
  it('as 42 células carregam min-h-[133px] (o min-h-28 de 112px morreu)', async () => {
    const c = await montar({ view: 'mes', anchor: '2026-07-28', events: [] })
    const celulas = [...c.querySelectorAll<HTMLElement>('div[class*="min-h-"]')]
    expect(celulas).toHaveLength(42)
    for (const cel of celulas) {
      expect(cel.className).toContain('min-h-[133px]')
      expect(cel.className).not.toContain('min-h-28')
    }
  })
})

describe('A2 · pele: cabeçalho dos dias em 14px na tinta forte', () => {
  it('weekdays do mês: text-sm + text-ink-900 (não mais 11px apagado)', async () => {
    const c = await montar({ view: 'mes', anchor: '2026-07-28', events: [] })
    const semana = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
    const spans = [...c.querySelectorAll('span')].filter((s) => semana.includes(s.textContent ?? ''))
    expect(spans).toHaveLength(7)
    for (const s of spans) {
      expect(s.className).toContain('text-sm')
      expect(s.className).toContain('text-ink-900')
      expect(s.className).not.toContain('text-[11px]')
      expect(s.className).not.toContain('text-ink-400')
    }
  })

  it('cabeçalho da semana: weekday e número na tinta forte, hoje em branco sobre a marca', async () => {
    const c = await montar({ view: 'semana', anchor: '2026-07-28', todayISO: '2026-07-28', events: [] })
    // Os links de cabeçalho carregam title="Abrir o dia" — os da faixa do
    // celular (DayStrip) não, então o filtro separa as duas.
    // São 8: a visão semana renderiza DOIS TimeGrids (o do celular, dia único,
    // com 1 cabeçalho; o do desktop com 7) — jsdom não aplica o `hidden sm:grid`.
    const cabecalhos = [...c.querySelectorAll<HTMLAnchorElement>('a[title="Abrir o dia"]')]
    expect(cabecalhos).toHaveLength(8)
    for (const link of cabecalhos) {
      const [weekday, numero] = [...link.querySelectorAll('span')]
      expect(weekday.className).toContain('text-sm')
      expect(weekday.className).toContain('text-ink-900')
      expect(weekday.className).not.toContain('text-[11px]')
      expect(numero.className).toContain('text-sm')
      expect(numero.className).toContain('font-semibold')
      // hoje: branco sobre o círculo da marca; os demais: tinta forte
      if (numero.className.includes('bg-ac-deep')) expect(numero.className).toContain('text-white')
      else expect(numero.className).toContain('text-ink-900')
    }
  })
})

/* ========================================================================== */
/* 3b. PELE — régua de legibilidade do AGENTS.md (achado da rodada 1 do Sol)   */
/* ========================================================================== */

describe('A2 · régua de legibilidade: DADO e AÇÃO no piso text-sm', () => {
  it('chip do evento: horário (mono) e nome em text-sm — 10/11px morreram', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [aula({ id: 'a', inicioUtc: '2026-07-29T18:00:00Z', title: 'Aula A' })],
    })
    const bloco = c.querySelector<HTMLElement>('[title="Aula A"]')!
    const [horario, nome] = [...bloco.querySelectorAll('span')]
    expect(horario.className).toContain('font-mono')
    expect(horario.className).toContain('text-sm')
    expect(nome.className).toContain('text-sm')
    expect(bloco.innerHTML).not.toContain('text-[10px]')
    expect(bloco.innerHTML).not.toContain('text-[11px]')
  })

  it('ação do slot "＋ HH:mm" em text-sm', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [],
      slotPopup: (_iso, hhmm) => h('p', null, hhmm),
    })
    const rotulo = c.querySelector<HTMLElement>('button[title^="Criar às"] > span')!
    expect(rotulo.className).toContain('text-sm')
    expect(rotulo.className).not.toContain('text-[11px]')
  })

  it('"+N mais" do mês é chip-AÇÃO: text-sm, alvo ≥24px e affordance de hover', async () => {
    // link textual puro é proibido em tela nova (rodada 2 do Sol): o "+N mais"
    // veste o chip do kit — min-h-6 fecha o alvo, hover:bg dá a affordance
    const dia = (n: number) => aula({ id: `e${n}`, inicioUtc: `2026-07-29T1${n}:00:00Z`, title: `Aula ${n}` })
    const c = await montar({ view: 'mes', anchor: '2026-07-28', events: [dia(4), dia(5), dia(6), dia(7)] })
    const mais = [...c.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent === '+1 mais')
    expect(mais, 'o mês perdeu o "+N mais"').toBeDefined()
    expect(mais!.className).toContain('text-sm')
    expect(mais!.className).toContain('min-h-6')
    expect(mais!.className).toContain('rounded-chip')
    expect(mais!.className).toContain('hover:bg-paper-100')
    expect(mais!.className).not.toContain('hover:underline')
    // rodada 3: a roupa INTEIRA de chip-ação, não só altura e raio
    expect(mais!.className).toContain('inline-flex')
    expect(mais!.className).toContain('font-semibold')
    expect(mais!.className).toContain('text-ac-deep')
    expect(mais!.className).toContain('px-1.5')
  })

  it('eixo de horas é APOIO: text-xs na tinta de apoio (todo evento carrega o próprio horário)', async () => {
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [] })
    const oito = [...c.querySelectorAll<HTMLElement>('span')].find((s) => s.textContent === '08:00')!
    expect(oito.className).toContain('text-xs')
    expect(oito.className).toContain('text-ink-400')
    expect(oito.className).not.toContain('text-[10px]')
  })

  it('riscada legível: identidade pela borda, texto ink-600, SEM opacity no contêiner', async () => {
    // rodada 2 do Sol: opacity-75 + ink-400 media ~2,9:1 — o esmaecimento
    // agora é do texto (ink-600 riscado, ≥4,5:1 sobre paper-100)
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [{ ...aula({ id: 'x', inicioUtc: '2026-07-29T18:00:00Z', title: 'Remarcada' }), color: 1, strike: true }],
    })
    const bloco = c.querySelector<HTMLElement>('[title="Remarcada"]')!
    expect(bloco.className).toContain('border-l-(--t1-fill)')
    expect(bloco.className).not.toContain('border-l-line')
    expect(bloco.className).toContain('bg-paper-100')
    expect(bloco.className).not.toContain('opacity-75')
    const [horario, nome] = [...bloco.querySelectorAll('span')]
    expect(horario.className).toContain('text-ink-600')
    expect(nome.className).toContain('text-ink-600')
    expect(nome.className).toContain('line-through')
    expect(nome.className).not.toContain('text-ink-400')
  })
})

/* ========================================================================== */
/* 3d. PELE — contraste MEDIDO (rodada 2 do Sol) e horário na lane dividida    */
/* ========================================================================== */

describe('A2 · contraste medido nos chips (rodada 2 do Sol)', () => {
  it('horário sobre bloco sólido: branco CHEIO + font-medium (white/75 morreu)', async () => {
    // white/75 reprovava AA em 3 das 5 cores de professora — e horário é DADO
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [aula({ id: 'a', inicioUtc: '2026-07-29T18:00:00Z', title: 'Aula A' })],
    })
    const [horario] = [...c.querySelector<HTMLElement>('[title="Aula A"]')!.querySelectorAll('span')]
    expect(horario.className).toContain('font-medium')
    expect(horario.className).toMatch(/\btext-white\b(?!\/)/)
    expect(horario.className).not.toContain('text-white/75')
  })

  it('ghost é DADO no piso LITERAL: text-sm/ink-900 (rodada 5 do A3 — a distinção "advisory" morreu); a lavagem fica', async () => {
    // o compromisso do Google muda a decisão sobre o slot — não é decoração.
    // Ghost e bloqueio são ambos DADO, ambos no piso de DADO (ink-900); o que
    // os distingue é a FORMA do fundo (lavagem × hachura), não o peso do texto.
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [{ ...aula({ id: 'gh', inicioUtc: '2026-07-29T19:00:00Z', fimUtc: '2026-07-29T20:00:00Z', title: 'Compromisso' }), ghost: true }],
    })
    const bloco = c.querySelector<HTMLElement>('[title="Compromisso"]')!
    expect(bloco.className).toContain('bg-paper-100/90') // a lavagem de fundo fica
    const rotulo = bloco.querySelector('span')!
    expect(rotulo.className).toContain('text-sm')
    expect(rotulo.className).toContain('text-ink-900')
    expect(rotulo.className).not.toContain('text-ink-600')
    expect(rotulo.className).not.toContain('text-[10px]')
    expect(rotulo.className).not.toContain('text-ink-400/80')
  })

  it('data fora do mês em ink-600; a diferenciação segue pelo PESO', async () => {
    // ink-400/60 media 2,4:1 — data é DADO. Dentro do mês: ink-900 semibold;
    // fora: ink-600 sem semibold. A grade de julho/2026 começa em 29/06 (seg),
    // então o PRIMEIRO link do mês é dia fora; o "15" só existe em julho.
    const c = await montar({ view: 'mes', anchor: '2026-07-28', events: [] })
    const links = [...c.querySelectorAll<HTMLAnchorElement>('a[title="Abrir o dia"]')]
    const fora = links[0]
    expect(fora.textContent).toBe('29')
    expect(fora.className).toContain('text-ink-600')
    expect(fora.className).not.toContain('text-ink-400/60')
    expect(fora.className).not.toContain('font-semibold')
    const dentro = links.find((a) => a.textContent === '15')!
    expect(dentro.className).toContain('text-ink-900')
    expect(dentro.className).toContain('font-semibold')
  })

  it('o ✓ da realizada tem nome para o leitor (aria-hidden + sr-only), como ✕ e ?', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [{ ...aula({ id: 'ok', inicioUtc: '2026-07-29T18:00:00Z', title: 'Realizada' }), dim: true }],
    })
    const marca = [...c.querySelectorAll('span')].find((s) => s.textContent === '✓')!
    expect(marca, 'a aula realizada perdeu o ✓').toBeDefined()
    expect(marca.getAttribute('aria-hidden')).toBe('true')
    expect(marca.parentElement!.querySelector('.sr-only')?.textContent).toBe('realizada')
  })
})

describe('A2 · lane dividida esconde o horário do chip (dado cortado não é dado)', () => {
  const A = aula({ id: 'a', inicioUtc: '2026-07-29T18:00:00Z', fimUtc: '2026-07-29T18:45:00Z', title: 'Aula A' })
  const B = aula({ id: 'b', inicioUtc: '2026-07-29T18:30:00Z', fimUtc: '2026-07-29T19:15:00Z', title: 'Aula B' })

  it('of>1: chip VISÍVEL só com o nome; horário no title e no sr-only', async () => {
    // 37px de meia coluna não mostram "HH:mm" inteiro — cortado não é dado.
    // Rodada 3 do Sol: o horário sai do texto VISÍVEL (nenhum span mono), mas
    // fica no nome acessível (sr-only) para toque/teclado e no title p/ hover.
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [A, B] })
    const blocoA = c.querySelector<HTMLElement>('[title="14:00 Aula A"]')
    expect(blocoA, 'o title do chip dividido perdeu o horário').not.toBeNull()
    expect(blocoA!.textContent).toContain('Aula A')
    expect(blocoA!.querySelector('span.font-mono'), 'horário visível deveria ter saído').toBeNull()
    expect(blocoA!.querySelector('.sr-only')?.textContent).toContain('14:00')
    const blocoB = c.querySelector<HTMLElement>('[title="14:30 Aula B"]')
    expect(blocoB).not.toBeNull()
    expect(blocoB!.querySelector('span.font-mono')).toBeNull()
    expect(blocoB!.querySelector('.sr-only')?.textContent).toContain('14:30')
  })

  it('lane única: o horário continua no chip (e o title fica só o nome)', async () => {
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [A] })
    const bloco = c.querySelector<HTMLElement>('[title="Aula A"]')!
    expect(bloco.textContent).toContain('14:00')
  })
})

describe('A2 · avail é SÓ camada de fundo (contrato: sem rótulo, sem clique)', () => {
  // conserto de MOTOR defensivo pré-A3 (a A3 alimenta a camada no admin) —
  // espelhamento anotado na lápide do gêmeo, regra do fork
  const EXPEDIENTE: CalEvent = {
    ...aula({ id: 'exp', inicioUtc: '2026-07-29T12:00:00Z', fimUtc: '2026-07-29T22:00:00Z', title: 'Expediente' }),
    avail: true,
  }

  it('mês: avail não vira chip nem infla o "+N mais"', async () => {
    // 4 aulas + expediente no mesmo dia: 3 chips e "+1 mais" (não "+2 mais")
    const dia = (n: number) => aula({ id: `e${n}`, inicioUtc: `2026-07-29T1${n}:00:00Z`, title: `Aula ${n}` })
    const c = await montar({ view: 'mes', anchor: '2026-07-28', events: [EXPEDIENTE, dia(4), dia(5), dia(6), dia(7)] })
    expect(c.textContent).not.toContain('Expediente')
    const mais = [...c.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent?.endsWith('mais'))
    expect(mais?.textContent).toBe('+1 mais')
  })

  it('DayStrip: avail não vira bolinha; o contêiner das bolinhas é decorativo', async () => {
    const c = await montar({ view: 'semana', anchor: '2026-07-28', events: [{ ...EXPEDIENTE, color: 2 }] })
    const faixa = c.querySelector<HTMLElement>('[class*="items-stretch"]')!
    const bolinhas = [...faixa.querySelectorAll<HTMLElement>('[class*="w-1.5"]')].filter((b) => b.className.includes('rounded-full'))
    expect(bolinhas).toHaveLength(0)
    // bolinhas decorativas (a informação completa está na grade do dia):
    // um contêiner aria-hidden por dia da faixa
    expect(faixa.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(7)
  })

  it('isSolid é defensivo: avail e blocked nunca são "cheias" (asserção de fonte)', () => {
    // avail sem outros sinais não pode vestir TEACHER_FILL sólido — a régua
    // dela é a lavagem opacity-50 do eventTone. O A3 somou `blocked` ao rol
    // das camadas de fundo: mesma disciplina.
    expect(codigo(CALENDARIO)).toMatch(/function isSolid[\s\S]{0,200}!ev\.avail[\s\S]{0,40}!ev\.blocked/)
  })
})

describe('A2 · prioridade do muting das camadas de fundo (dashed > ghost > avail)', () => {
  const EXPEDIENTE: CalEvent = {
    ...aula({ id: 'exp', inicioUtc: '2026-07-29T12:00:00Z', fimUtc: '2026-07-29T22:00:00Z', title: 'Expediente' }),
    avail: true,
  }
  const GHOST: CalEvent = {
    ...aula({ id: 'gh', inicioUtc: '2026-07-29T19:00:00Z', fimUtc: '2026-07-29T20:00:00Z', title: 'Compromisso' }),
    ghost: true,
  }
  const JANELA: CalEvent = {
    ...aula({ id: 'jan', inicioUtc: '2026-07-29T19:00:00Z', fimUtc: '2026-07-29T20:00:00Z', title: 'Janela' }),
    dashed: true,
  }

  it('a janela tracejada (2) cala o ghost (1) e ninguém cala a janela', async () => {
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [EXPEDIENTE, GHOST, JANELA] })
    expect(c.querySelector<HTMLElement>('[title="Compromisso"]')!.textContent).toBe('')
    expect(c.querySelector<HTMLElement>('[title="Janela"]')!.textContent).toContain('Janela')
  })

  it('a disponibilidade (0) embaixo NÃO cala o ghost', async () => {
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [EXPEDIENTE, GHOST] })
    expect(c.querySelector<HTMLElement>('[title="Compromisso"]')!.textContent).toContain('Compromisso')
  })
})

describe('A2 · DayStrip do celular', () => {
  it('7 dias navegáveis, weekday no piso de RÓTULO, bolinhas por professora', async () => {
    const c = await montar({
      view: 'semana',
      anchor: '2026-07-28',
      events: [
        aula({ id: 'v', inicioUtc: '2026-07-28T18:00:00Z', title: 'Dona' }),
        { ...aula({ id: 's', inicioUtc: '2026-07-28T20:00:00Z', title: 'Steh' }), color: 1 },
      ],
    })
    const faixa = c.querySelector<HTMLElement>('[class*="items-stretch"]')!
    const dias = [...faixa.querySelectorAll('a')]
    expect(dias).toHaveLength(7)
    for (const d of dias) {
      const rotulo = d.querySelector('span')!
      expect(rotulo.className).toContain('text-sm')
      expect(rotulo.className).toContain('text-ink-600')
      expect(rotulo.className).not.toContain('text-[10px]')
    }
    // a terça 28 tem DUAS professoras → duas bolinhas, cada uma na cor certa
    const ter = dias.find((d) => d.textContent?.includes('ter'))!
    const bolinhas = [...ter.querySelectorAll<HTMLElement>('[class*="w-1.5"]')].filter((b) => b.className.includes('rounded-full'))
    expect(bolinhas).toHaveLength(2)
    const classes = bolinhas.map((b) => b.className).join(' ')
    expect(classes).toContain('bg-(--t0-fill)')
    expect(classes).toContain('bg-(--t1-fill)')
  })
})

/* ========================================================================== */
/* 3c. ACESSIBILIDADE — fluxo de Tab e nome dos diálogos                       */
/* ========================================================================== */

describe('A2 · acessibilidade: Tab e nome dos diálogos', () => {
  it('meias-horas fora do fluxo de Tab; gatilho de EVENTO continua tabável', async () => {
    // Superfície de PONTEIRO (decisão no goal): o caminho de teclado para
    // criar/publicar é a toolbar `[+ Nova aula ▾]`; o e2e do A9 confere.
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [{ ...aula({ id: 'e', inicioUtc: '2026-07-29T18:00:00Z', title: 'Com popup' }), popup: h('p', null, 'x') }],
      slotPopup: (_iso, hhmm) => h('p', null, hhmm),
    })
    const slots = [...c.querySelectorAll<HTMLButtonElement>('button[title^="Criar às"]')]
    expect(slots.length).toBeGreaterThan(0)
    for (const s of slots) expect(s.tabIndex).toBe(-1)
    expect(c.querySelector<HTMLButtonElement>('button[title="Com popup"]')!.tabIndex).toBe(0)
  })

  it('o SEGUNDO gatilho de slot (slotHref, sem popup) também fica fora do Tab', async () => {
    // a rodada 2 do Sol pegou a cobertura torta: só o slotPopup era testado —
    // o caminho de Link (publicar janela por navegação) ficava sem prova
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [],
      slotHref: (iso, hhmm) => `/admin/agenda/janela?d=${iso}&t=${hhmm}`,
    })
    const slots = [...c.querySelectorAll<HTMLAnchorElement>('a[title^="Publicar janela"]')]
    expect(slots).toHaveLength(28) // span default 7–21h, 2 por hora
    for (const s of slots) expect(s.tabIndex).toBe(-1)
  })

  it('nenhum PopoverContent da grade nasce anônimo, e o nome carrega o horário', () => {
    // Asserção de FONTE, declarada: o jsdom não abre o balão do Radix (o
    // conteúdo só existe no portal quando aberto), então o anúncio real fica
    // para o harness e2e do A9. Aqui se trava que nenhum PopoverContent nasce
    // anônimo (WCAG 4.1.2) — e a régua apertou na rodada 2 do Sol: um
    // `aria-label=""` ou um rótulo sem o horário do evento/slot também reprova.
    //
    // A4: o balão da meia-hora mudou de endereço (`kit/balao-do-slot.tsx`, para
    // controlar a abertura no cliente), então a varredura passou a olhar os
    // DOIS arquivos — senão o terceiro popover sairia da rede sem ninguém ver.
    //
    // A5: os balões de EVENTO fizeram o MESMO caminho (abertura controlada por
    // `?ev=`, para a volta de erro da matriz do desfecho). Consequência para esta
    // rede: a grade não monta mais `PopoverContent` nenhum — o único da casa é o
    // do balão —, e o nome acessível dos TRÊS viaja em `rotulo=`. A régua não
    // afrouxou: continua sendo "ninguém nasce anônimo e o nome carrega o
    // horário", só mudou o lugar onde se prova.
    expect(
      arquivo(CALENDARIO).match(/<PopoverContent\b/g) ?? [],
      'a grade não monta mais PopoverContent próprio (todos passam pelo balão)',
    ).toHaveLength(0)

    // O `PopoverContent` da casa é UM, e recebe o nome pronto…
    const doBalao = (arquivo(BALAO_DO_SLOT).match(/<PopoverContent[\s\S]*?>/g) ?? [])
    expect(doBalao).toHaveLength(1)
    expect(doBalao[0]).toContain('aria-label={rotulo}')

    // …e quem o escreve é a grade: TRÊS rótulos, nenhum vazio — os dois de
    // EVENTO (grade de horas e mês) com o horário do evento, o do SLOT com a
    // meia-hora.
    const rotulos = arquivo(CALENDARIO).match(/rotulo=\{`[^`]*`\}/g) ?? []
    expect(rotulos, 'os rótulos dos balões da grade').toHaveLength(3)
    expect(
      rotulos.filter((r) => /toFormat\('HH:mm'\)/.test(r)),
      'os dois balões de EVENTO nomeados com o horário',
    ).toHaveLength(2)
    expect(arquivo(CALENDARIO)).toMatch(/rotulo=\{`[^`]*\$\{hh\}:\$\{mm\}[^`]*`\}/)
  })
})

/* ========================================================================== */
/* 4. PROIBIÇÃO — <details data-popup> morreu; o Popover do kit assumiu        */
/* ========================================================================== */

describe('A2 · o arquivo novo cumpre a proibição do AGENTS.md', () => {
  it('zero <details> e zero data-popup no código; o Popover do kit está lá', () => {
    const fonte = codigo(CALENDARIO)
    expect(fonte).not.toContain('<details')
    expect(fonte).not.toContain('data-popup')
    expect(fonte).toContain("from '@/components/kit/popover'")
  })

  it('render com popup de evento e de slot: gatilhos do Radix no DOM, nenhum <details>', async () => {
    // A INTERAÇÃO (abrir, focar, Esc) fica para o harness e2e do A9 — o jsdom
    // não faz layout e o Radix não abre de verdade aqui. O que se prova por
    // render: o popup viaja pelo Popover do kit (gatilho = botão real ligado ao
    // Radix), e não sobrou nenhum <details> no DOM.
    const c = await montar({
      view: 'semana',
      anchor: '2026-07-28',
      events: [
        {
          ...aula({ id: 'com-popup', inicioUtc: '2026-07-29T18:00:00Z', title: 'Com popup' }),
          popup: h('p', null, 'conteúdo do popup'),
        },
      ],
      slotPopup: (iso, hhmm) => h('p', null, `slot ${iso} ${hhmm}`),
    })
    expect(c.querySelector('details')).toBeNull()
    const gatilhos = [...c.querySelectorAll<HTMLButtonElement>('[data-slot="popover-trigger"]')]
    // 1 gatilho do evento + as meias-horas do slotPopup
    expect(gatilhos.length).toBeGreaterThan(1)
    const doEvento = gatilhos.find((g) => g.getAttribute('title') === 'Com popup')
    expect(doEvento, 'o bloco do evento deixou de ser gatilho do Popover').toBeDefined()
    expect(doEvento!.tagName).toBe('BUTTON')
    // fiação do Radix: gatilho fechado declara o estado e o tipo do balão
    expect(doEvento!.getAttribute('data-state')).toBe('closed')
    expect(doEvento!.getAttribute('aria-haspopup')).toBe('dialog')
    // o gatilho do slot também é do kit (era o segundo <details> do legado)
    const doSlot = gatilhos.find((g) => g.getAttribute('title')?.startsWith('Criar às'))
    expect(doSlot, 'a meia-hora vazia deixou de ser gatilho do Popover').toBeDefined()
  })

  it('sem esticar âncora nova: o padrão proibido do hotfix iOS não entrou aqui', () => {
    // O guarda-teste do hotfix já varre o repo inteiro; este é o espelho local
    // que nomeia o risco do A2 (blocos absolutos dentro de células).
    const fonte = arquivo(CALENDARIO)
    expect(fonte).not.toMatch(/after:absolute[\s\S]{0,40}after:inset-0/)
  })
})

/* ========================================================================== */
/* 5. GUARDA DO FORK — o CalendarGrid velho é só da professora                 */
/* ========================================================================== */

function tsxDoRepo(dir: string, achados: string[] = []): string[] {
  for (const e of readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) tsxDoRepo(rel, achados)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) achados.push(rel)
  }
  return achados
}

describe('A2 · guarda do fork', () => {
  it('nenhuma referência ao CalendarGrid legado fora de /teacher (fontes .ts/.tsx/.js/.jsx/.mjs)', () => {
    // O guarda antigo só via `import ... from` — `export ... from`, `require()`
    // e `import()` dinâmico passavam batido (achado da rodada 1 do Sol). Agora
    // QUALQUER menção a "CalendarGrid" em CÓDIGO (com ou sem extensão, string
    // de import dinâmico incluída) fora de `src/app/teacher/` e do próprio
    // arquivo é vermelha. Comentários não contam: a lápide do kit e as
    // narrativas de página citam o gêmeo de propósito.
    // COBERTURA HONESTA (rodada 2 do Sol): a varredura pega .ts/.tsx/.js/.jsx/
    // .mjs sob src/ — extensões que não existem no repo hoje (.cjs/.mts/.cts)
    // ficariam fora se alguém as inaugurar.
    const violadores = tsxDoRepo('src').filter(
      (rel) => rel !== GEMEO_LEGADO && !rel.startsWith('src/app/teacher/') && /CalendarGrid/.test(codigo(rel)),
    )
    expect(violadores).toEqual([])
  })

  it('/teacher continua importando o legado (o fork não o aposentou antes da hora)', () => {
    expect(arquivo('src/app/teacher/page.tsx')).toMatch(/from\s+['"][^'"]*components\/CalendarGrid['"]/)
  })

  it('a página do admin usa o gêmeo do kit', () => {
    expect(arquivo('src/app/admin/agenda/page.tsx')).toContain("from '@/components/kit/calendario'")
  })

  it('a lápide do legado aponta para o gêmeo e cobra o espelhamento de motor', () => {
    const fonte = arquivo(GEMEO_LEGADO)
    expect(fonte).toContain('kit/calendario.tsx')
    // o risco 3 do goal vive no cabeçalho: conserto de motor lá exige espelho cá
    expect(fonte).toMatch(/espelhad/i)
  })
})
