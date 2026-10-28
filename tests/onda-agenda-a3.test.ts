// @vitest-environment jsdom
//
// ONDA DA AGENDA · A3 — camada de disponibilidade e bloqueios no admin.
//
// Espinha COMPORTAMENTAL no padrão do a1: cliente Supabase falso que GRAVA
// cada chamada, relógio congelado, e o que se cobra é o que `getAgenda`
// DEVOLVE (nada de varredura vácua de fonte). Na ordem do risco:
//   1. LEI 1 com prova de mutação: a janela semanal mora na ZONA DA LINHA
//      (professora em NY) e a grade exibe em Cuiabá — na virada de DST de NY
//      (01/11/2026) a MESMA janela muda de hora em Cuiabá. Offset fixo em
//      qualquer ponto da expansão reprova aqui.
//   2. Mapeamento de weekday (banco 0=domingo × Luxon 7=domingo): a janela de
//      domingo cai no DOMINGO da semana exibida, não na segunda.
//   3. Recorte: fora do intervalo visível não entra; bloco que atravessa a
//      semana entra POR DIA CIVIL de exibição (7 pedaços, bordas 00:00 Cuiabá).
//   4/5. As chaves da camada: sem filtro de professora → null; visão mês →
//      listas do painel vêm, eventos de grade não.
//   6. O contrato da CONSULTA (chamadas gravadas): `kind='block'` e só o que
//      ainda não terminou — `kind='open'` é reservado desde a F5 e NÃO é lido.
//   7. Rótulos do painel prontos no servidor, sem ISO cru.
//   8. As 4 actions: recusa sem tocar a RPC, shape exato da chamada (SEM
//      `p_iana_tz` — a janela nasce no fuso DA PROFESSORA), `{error}` nunca
//      vira sucesso, e cada frase de sucesso é ENUMERADA no tom-do-aviso.
//   9. Guardas do fork (padrão do a2): `blocked` é camada de fundo — fora dos
//      chips do mês, do DayStrip e das lanes; identidade própria (hachura
//      neutra ≠ ghost chapado), rótulo no piso de DADO; geometria PRESA à
//      faixa de horas; pintura por prioridade; muting entre iguais.
//  10. O painel `?novo=disponibilidade` pela ÁRVORE REAL da página (rodada de
//      correção, item 16): binding form→action por estrutura + render do
//      conteúdo (quem, headings, nomes acessíveis, piso dos botões) — nada de
//      varredura de strings soltas na fonte.
import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PoteDeCookies } from './pote-de-cookies'
import { cookieDoRecado } from '@/lib/kit/recado'
import { DateTime } from 'luxon'

import { Calendario, type CalEvent } from '@/components/kit/calendario'
import { tomDoAviso } from '@/lib/kit/tom-do-aviso'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* ========================================================================== */
/* Cliente Supabase falso (padrão do a1: grava método + args por tabela)       */
/* ========================================================================== */

interface Resposta {
  data?: unknown
  error?: { message: string } | null
}

class ConsultaFalsa {
  constructor(
    private readonly resposta: Resposta,
    private readonly registrar: (chamada: [string, ...unknown[]]) => void,
  ) {}
  private marca(nome: string, args: unknown[]) {
    this.registrar([nome, ...args])
    return this
  }
  select(...a: unknown[]) { return this.marca('select', a) }
  eq(...a: unknown[]) { return this.marca('eq', a) }
  is(...a: unknown[]) { return this.marca('is', a) }
  gt(...a: unknown[]) { return this.marca('gt', a) }
  gte(...a: unknown[]) { return this.marca('gte', a) }
  lt(...a: unknown[]) { return this.marca('lt', a) }
  lte(...a: unknown[]) { return this.marca('lte', a) }
  or(...a: unknown[]) { return this.marca('or', a) }
  order(...a: unknown[]) { return this.marca('order', a) }
  maybeSingle() { return this.marca('maybeSingle', []) }
  then<A, B>(ok: (v: { data: unknown; error: unknown }) => A, falha?: (e: unknown) => B) {
    return Promise.resolve({
      data: this.resposta.data ?? [],
      error: this.resposta.error ?? null,
    }).then(ok, falha)
  }
}

const mock = vi.hoisted(() => ({
  respostas: {} as Record<string, Resposta>,
  chamadas: {} as Record<string, Array<[string, ...unknown[]]>>,
  rpcs: [] as Array<[string, unknown]>,
  respostaRpc: { data: null, error: null } as Resposta,
}))

/** O `redirect` do Next lança; aqui ele lança ISTO, e o teste lê a URL. */
const { Redirecionou } = vi.hoisted(() => {
  class Redirecionou extends Error {
    constructor(public readonly url: string) {
      super(`redirect: ${url}`)
    }
  }
  return { Redirecionou }
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabela: string) => {
      mock.chamadas[tabela] ??= []
      return new ConsultaFalsa(mock.respostas[tabela] ?? { data: [] }, (c) =>
        mock.chamadas[tabela].push(c),
      )
    },
    rpc: async (fn: string, args: unknown) => {
      mock.rpcs.push([fn, args])
      return { data: mock.respostaRpc.data ?? null, error: mock.respostaRpc.error ?? null }
    },
  }),
}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirecionou(url)
  },
}))
vi.mock('@/lib/auth/admin', () => ({ requireAdminId: async () => 'admin-de-teste' }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/email/notify', () => ({ sendRescheduleEmails: async () => {} }))
vi.mock('@/lib/email/send', () => ({ sendEmail: async () => {}, sendEmailWithOutcome: async () => {} }))
vi.mock('@/lib/google/sync', () => ({
  syncTeacherCalendarSoon: () => {},
  // a página consulta o "ocupada" do Google quando há professora filtrada;
  // indisponível é o caminho fail-open — vira aviso, nunca bloqueio
  googleBusyForTeacher: async () => ({ status: 'indisponivel' as const }),
}))
vi.mock('@/lib/notify/evolution', () => ({
  evolutionChannel: () => ({}),
  evolutionConfigFromEnv: () => ({}),
}))
vi.mock('@/lib/outbox/dispatch', () => ({ dispatchOutbox: async () => {} }))

const { cookies } = await import('next/headers')

/** O pote de cookies dublê: as telas da agenda leem o RASCUNHO de um cookie
 *  `httpOnly` (A4/grave 5 — o que a dona digita não passa mais pela URL). */
let pote: PoteDeCookies
beforeEach(() => {
  pote = new PoteDeCookies()
  vi.mocked(cookies).mockResolvedValue(pote as never)
})

const { getAgenda } = await import('@/data/admin/agenda')
const {
  addTeacherBlockAction,
  addWeeklyAvailabilityAction,
  removeTeacherBlockAction,
  removeWeeklyAvailabilityAction,
} = await import('@/app/admin/agenda/actions')
const { default: AgendaPage } = await import('@/app/admin/agenda/page')

const PROFESSORA = '11111111-1111-1111-1111-111111111111'
const DONA = { id: PROFESSORA, display_name: 'Teacher Vicky', is_owner: true, iana_tz: 'America/Cuiaba' }
// segunda professora com fuso PRÓPRIO (F3-D2): idx 1 na cor, cidade ≠ negócio
const ANA_ID = '22222222-2222-2222-2222-222222222222'
const ANA = { id: ANA_ID, display_name: 'Teacher Ana', is_owner: false, iana_tz: 'America/New_York' }
const CUIABA = 'America/Cuiaba'

/** Uma linha crua de `teacher_weekly_availability`, na projeção da consulta. */
function janelaCrua(campos: {
  id?: string
  weekday: number
  start?: string
  end?: string
  tz?: string
}) {
  return {
    id: campos.id ?? 'w1',
    weekday: campos.weekday,
    start_local: campos.start ?? '08:00:00',
    end_local: campos.end ?? '12:00:00',
    iana_tz: campos.tz ?? CUIABA,
  }
}

/** Uma linha crua de `teacher_availability_exceptions` (kind='block'). */
function blocoCru(campos: {
  id?: string
  inicioUtc: string
  fimUtc: string
  snapshot: string
  note?: string | null
}) {
  return {
    id: campos.id ?? 'b1',
    starts_at_utc: campos.inicioUtc,
    ends_at_utc: campos.fimUtc,
    local_snapshot: campos.snapshot,
    note: campos.note ?? null,
  }
}

function semear(extras: Record<string, Resposta> = {}) {
  mock.respostas = {
    class_instances: { data: [] },
    teachers: { data: [DONA] },
    reschedule_windows: { data: [] },
    contracts: { data: [] },
    ...extras,
  }
}

/** Semana + professora filtrada + camada de janelas desligada: o mínimo que
 *  acende a camada de disponibilidade. */
const base = { visao: 'semana' as const, comJanelas: false, professora: PROFESSORA }

beforeEach(() => {
  // Congela SÓ o Date (padrão do a2): o `act` do React precisa dos
  // timers/microtasks reais para os casos de render.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-28T18:00:00Z')) // 14:00 em Cuiabá (UTC−4)
  mock.respostas = {}
  mock.chamadas = {}
  mock.rpcs = []
  mock.respostaRpc = { data: null, error: null }
})
afterEach(() => {
  vi.useRealTimers()
})

/* ========================================================================== */
/* 1. LEI 1 — expansão por dia civil na ZONA DA JANELA (prova de mutação DST)  */
/* ========================================================================== */

describe('A3 · Lei 1: a janela de NY muda de hora em Cuiabá na virada de DST', () => {
  // Professora em America/New_York, janela terça (banco: weekday=2)
  // 18:00–20:00 NO RELÓGIO DELA. NY sai do horário de verão em 01/11/2026
  // (EDT −4 → EST −5); Cuiabá não muda nunca (−4 o ano inteiro).
  const NY = janelaCrua({ id: 'w-ny', weekday: 2, start: '18:00:00', end: '20:00:00', tz: 'America/New_York' })

  it('semana ANTES da virada: terça 27/10, 18:00 EDT = 18:00 em Cuiabá', async () => {
    semear({ teacher_weekly_availability: { data: [NY] } })
    const agenda = await getAgenda({ ...base, ancora: '2026-10-26' })
    const eventos = agenda.disponibilidade!.eventosAvail
    expect(eventos).toHaveLength(1)
    // 18:00 EDT (−4) = 22:00Z — o INSTANTE certo daquele dia
    expect(DateTime.fromISO(eventos[0].inicioUtc).toUTC().toISO()).toBe('2026-10-27T22:00:00.000Z')
    expect(DateTime.fromISO(eventos[0].inicioUtc).setZone(CUIABA).toFormat('HH:mm')).toBe('18:00')
  })

  it('semana DEPOIS da virada: terça 03/11, 18:00 EST = 19:00 em Cuiabá', async () => {
    // A prova de mutação: um offset fixo daria 18:00 em Cuiabá nas DUAS
    // semanas — este caso exige a HORA DIFERENTE do outro lado da virada.
    semear({ teacher_weekly_availability: { data: [NY] } })
    const agenda = await getAgenda({ ...base, ancora: '2026-11-03' })
    const eventos = agenda.disponibilidade!.eventosAvail
    expect(eventos).toHaveLength(1)
    // 18:00 EST (−5) = 23:00Z
    expect(DateTime.fromISO(eventos[0].inicioUtc).toUTC().toISO()).toBe('2026-11-03T23:00:00.000Z')
    expect(DateTime.fromISO(eventos[0].inicioUtc).setZone(CUIABA).toFormat('HH:mm')).toBe('19:00')
  })
})

/* ========================================================================== */
/* 1b. DST além do caso fácil (rodada de correção, itens 1 e 15)               */
/* ========================================================================== */

describe('A3 · a ocorrência que cruza a meia-noite de Cuiabá sai RECORTADA por dia de exibição', () => {
  it('Lisboa dom 02:00–06:00 no inverno vira DOIS pedaços: sáb 22:00–24:00 e dom 00:00–02:00', async () => {
    // Sol · rodada 1 do A3, item 1 (grave): o TimeGrid indexa evento pelo DIA
    // do início — sem o recorte isto sai como evento ÚNICO no sábado e o
    // domingo SOME da grade. Prova de mutação: a expansão sem recorte devolve
    // 1 evento e este caso fica vermelho.
    const LIS = janelaCrua({ id: 'w-lis', weekday: 0, start: '02:00:00', end: '06:00:00', tz: 'Europe/Lisbon' })
    semear({ teacher_weekly_availability: { data: [LIS] } })
    // semana de 11–17/01/2027: inverno de Lisboa (UTC+0); Cuiabá é −4
    const agenda = await getAgenda({ ...base, ancora: '2027-01-11' })
    const eventos = agenda.disponibilidade!.eventosAvail
    expect(eventos).toHaveLength(2)
    const [sab, dom] = eventos
    const f = (utc: string) => DateTime.fromISO(utc).setZone(CUIABA).toFormat('yyyy-LL-dd HH:mm')
    expect(f(sab.inicioUtc)).toBe('2027-01-16 22:00')
    expect(f(sab.fimUtc)).toBe('2027-01-17 00:00') // borda exata do dia civil
    expect(f(dom.inicioUtc)).toBe('2027-01-17 00:00')
    expect(f(dom.fimUtc)).toBe('2027-01-17 02:00')
    // o id carrega o dia de EXIBIÇÃO — é por ele que o motor da grade indexa
    expect(sab.id).toBe('w-lis:2027-01-16')
    expect(dom.id).toBe('w-lis:2027-01-17')
  })
})

describe('A3 · hora local inexistente e ambígua: o comportamento DECLARADO (residual aceito)', () => {
  // Precedente: `src/lib/agenda/ocupacao-fuso.ts` — Luxon e Postgres podem
  // divergir nos 2 dias/ano de transição. Esta camada é ANTECIPAÇÃO visual;
  // quem decide reserva de verdade é `_teacher_available_for`, no banco
  // (Lei 3). Os casos abaixo CRISTALIZAM a escolha do Luxon para o defeito
  // não mudar de forma em silêncio numa atualização.

  it('hora INEXISTENTE (spring-forward de NY, 14/03/2027): o início é empurrado gap adiante', async () => {
    // 02:30 não existe em NY nesse domingo (02:00→03:00). Luxon lê como 03:30
    // EDT — a janela daquele dia ENCOLHE em vez de sumir ou estourar.
    const NY = janelaCrua({ id: 'w-gap', weekday: 0, start: '02:30:00', end: '06:00:00', tz: 'America/New_York' })
    semear({ teacher_weekly_availability: { data: [NY] } })
    const agenda = await getAgenda({ ...base, ancora: '2027-03-08' })
    const eventos = agenda.disponibilidade!.eventosAvail
    expect(eventos).toHaveLength(1)
    expect(DateTime.fromISO(eventos[0].inicioUtc).toUTC().toISO()).toBe('2027-03-14T07:30:00.000Z') // 03:30 EDT
    expect(DateTime.fromISO(eventos[0].fimUtc).toUTC().toISO()).toBe('2027-03-14T10:00:00.000Z') // 06:00 EDT
    expect(DateTime.fromISO(eventos[0].inicioUtc).setZone(CUIABA).toFormat('HH:mm')).toBe('03:30')
  })

  it('janela INTEIRA dentro do gap (02:30→03:30, spring-forward de NY 14/03/2027): COLAPSA e a ocorrência daquele dia some', async () => {
    // Sol · rodada 2, item 7: Luxon normaliza AMBOS os limites para 03:30 EDT,
    // o intervalo vira vazio e é DESCARTADO pelo `a >= b` da expansão — a
    // ocorrência daquele domingo NÃO é desenhada. Comportamento ACEITO
    // (residual declarado no cabeçalho de `expandirJanelasSemanais`); este
    // caso cristaliza a escolha para o defeito não mudar de forma em silêncio.
    const NY = janelaCrua({ id: 'w-colapso', weekday: 0, start: '02:30:00', end: '03:30:00', tz: 'America/New_York' })
    semear({ teacher_weekly_availability: { data: [NY] } })
    const agenda = await getAgenda({ ...base, ancora: '2027-03-08' })
    expect(agenda.disponibilidade!.eventosAvail).toHaveLength(0)
  })

  it('hora AMBÍGUA (fall-back de NY, 07/11/2027): Luxon fica com a PRIMEIRA leitura do relógio', async () => {
    // 01:30 acontece DUAS vezes nesse domingo (02:00→01:00). Luxon escolhe o
    // offset de VERÃO (−4, a primeira passagem); o `AT TIME ZONE` do Postgres
    // preferiria a segunda (−5) — residual de 1h ACEITO e declarado no
    // cabeçalho de `expandirJanelasSemanais`. O fim (02:30) já é inambíguo
    // (−5): a janela desenhada dura 2h de relógio UTC para 1h de rótulo local.
    const NY = janelaCrua({ id: 'w-amb', weekday: 0, start: '01:30:00', end: '02:30:00', tz: 'America/New_York' })
    semear({ teacher_weekly_availability: { data: [NY] } })
    const agenda = await getAgenda({ ...base, ancora: '2027-11-01' })
    const eventos = agenda.disponibilidade!.eventosAvail
    expect(eventos).toHaveLength(1)
    expect(DateTime.fromISO(eventos[0].inicioUtc).toUTC().toISO()).toBe('2027-11-07T05:30:00.000Z') // 01:30 EDT (−4)
    expect(DateTime.fromISO(eventos[0].fimUtc).toUTC().toISO()).toBe('2027-11-07T07:30:00.000Z') // 02:30 EST (−5)
  })
})

/* ========================================================================== */
/* 2. Mapeamento de weekday (banco 0=domingo × Luxon 7=domingo)                */
/* ========================================================================== */

describe('A3 · weekday=0 cai no DOMINGO da semana exibida', () => {
  it('semana de 27/07–02/08: a janela de domingo aparece em 02/08, não na segunda', async () => {
    semear({
      teacher_weekly_availability: {
        data: [janelaCrua({ id: 'w-dom', weekday: 0, start: '09:00:00', end: '10:00:00' })],
      },
    })
    const agenda = await getAgenda({ ...base, ancora: '2026-07-27' })
    const eventos = agenda.disponibilidade!.eventosAvail
    expect(eventos).toHaveLength(1)
    const inicio = DateTime.fromISO(eventos[0].inicioUtc).setZone(CUIABA)
    expect(inicio.toISODate()).toBe('2026-08-02') // o domingo da semana
    expect(inicio.weekday).toBe(7) // domingo no Luxon
    expect(inicio.toFormat('HH:mm')).toBe('09:00')
  })
})

/* ========================================================================== */
/* 3. Recorte ao intervalo visível                                             */
/* ========================================================================== */

describe('A3 · recorte', () => {
  it('visão DIA: a janela de outro dia da semana não entra', async () => {
    semear({
      teacher_weekly_availability: {
        data: [
          janelaCrua({ id: 'w-ter', weekday: 2 }), // terça — fora do dia exibido
          janelaCrua({ id: 'w-qua', weekday: 3, start: '08:00:00', end: '12:00:00' }),
        ],
      },
    })
    // quarta 29/07
    const agenda = await getAgenda({ ...base, visao: 'dia', ancora: '2026-07-29' })
    const eventos = agenda.disponibilidade!.eventosAvail
    expect(eventos).toHaveLength(1)
    expect(eventos[0].id).toContain('w-qua')
    expect(DateTime.fromISO(eventos[0].inicioUtc).setZone(CUIABA).toISODate()).toBe('2026-07-29')
  })

  it('bloco que atravessa a semana entra recortado POR DIA: 7 pedaços, bordas 00:00 Cuiabá', async () => {
    // Férias de 20/07 a 09/08 (bloco em UTC: 00:00 Cuiabá = 04:00Z). A semana
    // exibida (27/07–02/08) está INTEIRA dentro do bloco.
    semear({
      teacher_availability_exceptions: {
        data: [
          blocoCru({
            inicioUtc: '2026-07-20T04:00:00Z',
            fimUtc: '2026-08-10T04:00:00Z',
            snapshot: `2026-07-20 → 2026-08-09 ${CUIABA}`,
            note: 'férias',
          }),
        ],
      },
    })
    const agenda = await getAgenda({ ...base, ancora: '2026-07-28' })
    const pedacos = agenda.disponibilidade!.eventosBloqueio
    expect(pedacos).toHaveLength(7)
    for (const p of pedacos) {
      const ini = DateTime.fromISO(p.inicioUtc).setZone(CUIABA)
      const fim = DateTime.fromISO(p.fimUtc).setZone(CUIABA)
      expect(ini.toFormat('HH:mm')).toBe('00:00') // borda do dia civil de exibição
      expect(fim.diff(ini, 'hours').hours).toBe(24)
      expect(p.titulo).toBe('bloqueada — férias')
    }
    // o primeiro pedaço é a segunda 27/07, o último o domingo 02/08 —
    // nada vaza para fora do intervalo visível
    expect(DateTime.fromISO(pedacos[0].inicioUtc).setZone(CUIABA).toISODate()).toBe('2026-07-27')
    expect(DateTime.fromISO(pedacos[6].inicioUtc).setZone(CUIABA).toISODate()).toBe('2026-08-02')
    // 7 pedaços = 7 ids distintos (o motor da grade posiciona por id)
    expect(new Set(pedacos.map((p) => p.id)).size).toBe(7)
  })

  it('bloco que só encosta na semana entra recortado ao pedaço visível', async () => {
    // Bloqueio de UM dia e meio terminando na terça 28/07 ao meio-dia: só os
    // pedaços de segunda e terça existem, e o de terça acaba 12:00, não 24:00.
    semear({
      teacher_availability_exceptions: {
        data: [
          blocoCru({
            inicioUtc: '2026-07-27T04:00:00Z',
            fimUtc: '2026-07-28T16:00:00Z', // 12:00 em Cuiabá
            snapshot: `2026-07-27 → 2026-07-28 ${CUIABA}`,
          }),
        ],
      },
    })
    const agenda = await getAgenda({ ...base, ancora: '2026-07-28' })
    const pedacos = agenda.disponibilidade!.eventosBloqueio
    expect(pedacos).toHaveLength(2)
    expect(DateTime.fromISO(pedacos[1].fimUtc).setZone(CUIABA).toFormat('HH:mm')).toBe('12:00')
    expect(pedacos[1].titulo).toBe('bloqueada') // sem nota, sem sufixo
  })
})

/* ========================================================================== */
/* 4/5. As chaves da camada: filtro de professora e visão                      */
/* ========================================================================== */

describe('A3 · sem filtro de professora não há camada — nem consulta', () => {
  it('disponibilidade é null e as duas tabelas nem são consultadas', async () => {
    semear({
      teacher_weekly_availability: { data: [janelaCrua({ weekday: 1 })] },
    })
    const agenda = await getAgenda({ visao: 'semana', comJanelas: false })
    expect(agenda.disponibilidade).toBeNull()
    // "não perguntei" ≠ "perguntei e não achei": a consulta não acontece
    expect(mock.chamadas['teacher_weekly_availability']).toBeUndefined()
    expect(mock.chamadas['teacher_availability_exceptions']).toBeUndefined()
  })
})

describe('A3 · visão MÊS: o painel recebe as listas, a grade não recebe camada', () => {
  it('janelas/bloqueios vêm; eventosAvail/eventosBloqueio vazios', async () => {
    semear({
      teacher_weekly_availability: { data: [janelaCrua({ weekday: 1 })] },
      teacher_availability_exceptions: {
        data: [
          blocoCru({
            inicioUtc: '2026-07-30T04:00:00Z',
            fimUtc: '2026-07-31T04:00:00Z',
            snapshot: `2026-07-30 → 2026-07-30 ${CUIABA}`,
          }),
        ],
      },
    })
    const agenda = await getAgenda({ ...base, visao: 'mes', ancora: '2026-07-28' })
    expect(agenda.disponibilidade!.janelas).toHaveLength(1)
    expect(agenda.disponibilidade!.bloqueios).toHaveLength(1)
    expect(agenda.disponibilidade!.eventosAvail).toEqual([])
    expect(agenda.disponibilidade!.eventosBloqueio).toEqual([])
  })
})

/* ========================================================================== */
/* 6. O contrato da CONSULTA (chamadas gravadas)                               */
/* ========================================================================== */

describe('A3 · a consulta lê SÓ kind=block e só o que ainda não terminou', () => {
  it('a query das exceções filtra kind e ends_at_utc no BANCO (open é reservado)', async () => {
    // O fake devolve o que se semear — quem prova o filtro é a chamada
    // gravada, não o resultado (lição da rodada 2 do Sol no a1).
    semear()
    await getAgenda({ ...base })
    const chamadas = mock.chamadas['teacher_availability_exceptions'] ?? []
    expect(chamadas).toContainEqual(['eq', 'kind', 'block'])
    expect(chamadas).toContainEqual(['eq', 'teacher_id', PROFESSORA])
    // corte no AGORA congelado com fim EXCLUSIVO (Sol · rodada 2): um bloqueio
    // cujo `ends_at_utc` é EXATAMENTE o relógio congelado já acabou e não pode
    // ser listado — a prova, no padrão do harness (o fake não filtra), é a
    // chamada gravada: `gt`, nunca `gte`
    expect(chamadas).toContainEqual(['gt', 'ends_at_utc', '2026-07-28T18:00:00.000Z'])
    expect(chamadas.some(([m, campo]) => m === 'gte' && campo === 'ends_at_utc')).toBe(false)
    // ordem cronológica pedida AO BANCO (rodada de correção, item 8) com
    // desempate estável por id (rodada 2): dois bloqueios de mesmo início não
    // podem trocar de rótulo visível entre leituras
    expect(chamadas).toContainEqual(['order', 'starts_at_utc'])
    expect(chamadas).toContainEqual(['order', 'id'])
    const ordens = chamadas.filter(([m]) => m === 'order').map(([, campo]) => campo)
    expect(ordens).toEqual(['starts_at_utc', 'id']) // o desempate vem DEPOIS
    // e a agenda semanal declara a PROJEÇÃO dela (com o fuso POR LINHA)
    expect(mock.chamadas['teacher_weekly_availability']).toContainEqual([
      'select',
      'id, weekday, start_local, end_local, iana_tz',
    ])
  })
})

describe('A3 · start_local/end_local malformados ESTOURAM no Zod (rodada 3: fim do continue silencioso)', () => {
  // A promessa do cabeçalho de agenda.ts é "o que vem do banco passa por
  // Zod" — antes, "xx" atravessava o schema (z.string() puro) e caía num
  // `continue` silencioso da expansão: a janela SUMIA da grade sem ninguém
  // decidir isso. Agora a forma é do schema e linha malformada reprova o
  // parse — a leitura estoura, coerente com "fuso inválido estoura".
  it('linha com start_local "xx" → getAgenda rejeita', async () => {
    semear({
      teacher_weekly_availability: {
        data: [{ id: 'w-x', weekday: 1, start_local: 'xx', end_local: '12:00:00', iana_tz: CUIABA }],
      },
    })
    await expect(getAgenda({ ...base })).rejects.toThrow()
  })

  it('end_local malformado idem — a régua vale para os DOIS campos', async () => {
    semear({
      teacher_weekly_availability: {
        data: [{ id: 'w-y', weekday: 1, start_local: '08:00:00', end_local: 'meio-dia', iana_tz: CUIABA }],
      },
    })
    await expect(getAgenda({ ...base })).rejects.toThrow()
  })
})

describe('A3 · a forma REAL do `time` do banco (Sol · rodada 4): fração entra, 24:00 é fim de dia, 25:00 estoura', () => {
  it('fração de segundo é dado LEGÍTIMO: 08:00:00.500000 expande e nasce meio segundo depois da hora cheia', async () => {
    // As colunas start_local/end_local são `time` SEM precisão declarada
    // (migration 20260718000700) — microssegundos — e o PostgREST devolve
    // "08:00:00.5" quando há fração. Prova de mutação: o regex antigo
    // (sem fração) REPROVA a linha no Zod e a Agenda inteira estoura por
    // dado 100% válido do banco — este caso fica vermelho.
    semear({
      teacher_weekly_availability: {
        data: [janelaCrua({ id: 'w-frac', weekday: 3, start: '08:00:00.500000', end: '12:00:00' })],
      },
    })
    const agenda = await getAgenda({ ...base, visao: 'dia', ancora: '2026-07-29' })
    const eventos = agenda.disponibilidade!.eventosAvail
    expect(eventos).toHaveLength(1)
    // 08:00:00.5 em Cuiabá (−4) = 12:00:00.5Z — a fração SOBREVIVE ao instante
    expect(DateTime.fromISO(eventos[0].inicioUtc).toUTC().toISO()).toBe('2026-07-29T12:00:00.500Z')
  })

  it("end_local '24:00' NÃO estoura: desenha até a meia-noite (do dia seguinte) — semântica certa de fim de dia", async () => {
    // Medido no Luxon 3.7.2: `T24:00` é VÁLIDO e normaliza para a meia-noite
    // do dia SEGUINTE — a guarda isValid não dispara, e não deve disparar.
    semear({
      teacher_weekly_availability: {
        data: [janelaCrua({ id: 'w-fim-do-dia', weekday: 3, start: '20:00:00', end: '24:00' })],
      },
    })
    const agenda = await getAgenda({ ...base, visao: 'dia', ancora: '2026-07-29' })
    const eventos = agenda.disponibilidade!.eventosAvail
    expect(eventos).toHaveLength(1)
    const f = (utc: string) => DateTime.fromISO(utc).setZone(CUIABA).toFormat('yyyy-LL-dd HH:mm')
    expect(f(eventos[0].inicioUtc)).toBe('2026-07-29 20:00')
    expect(f(eventos[0].fimUtc)).toBe('2026-07-30 00:00') // a meia-noite, borda do dia civil
  })

  it("start_local '25:00' (fora da faixa DE VERDADE) ESTOURA com a frase da guarda", async () => {
    // A forma passa no Zod (\d{2}:\d{2}), mas o INSTANTE não existe — é este
    // o caso que a guarda isValid vigia, não o 24:00 legítimo.
    semear({
      teacher_weekly_availability: {
        data: [janelaCrua({ id: 'w-25', weekday: 3, start: '25:00', end: '12:00:00' })],
      },
    })
    await expect(getAgenda({ ...base, visao: 'dia', ancora: '2026-07-29' })).rejects.toThrow(
      /hora local inválida na janela semanal/,
    )
  })
})

/* ========================================================================== */
/* 7. Rótulos do painel — prontos no servidor, sem ISO cru                     */
/* ========================================================================== */

describe('A3 · rótulos do painel', () => {
  it('janela: "segunda · 08:00–12:00"; sufixo de fuso SÓ quando difere do negócio', async () => {
    semear({
      teacher_weekly_availability: {
        data: [
          janelaCrua({ id: 'w-dom', weekday: 0, start: '09:00:00', end: '10:00:00' }),
          janelaCrua({ id: 'w-seg', weekday: 1, start: '08:00:00', end: '12:00:00' }),
          janelaCrua({ id: 'w-ny', weekday: 2, start: '18:00:00', end: '20:00:00', tz: 'America/New_York' }),
        ],
      },
    })
    const agenda = await getAgenda({ ...base })
    const janelas = agenda.disponibilidade!.janelas
    // ordem weekday→hora com a semana da casa começando na SEGUNDA
    // (item 14.2): domingo, que no banco é 0, fecha a lista
    // fuso no vocabulário de CIDADE da casa (`tzLabel` — o mesmo do
    // CityPicker); IANA cru numa frase para a dona é defeito (item 7)
    expect(janelas.map((j) => j.rotulo)).toEqual([
      'segunda · 08:00–12:00',
      'terça · 18:00–20:00 (fuso da professora: Nova York)',
      'domingo · 09:00–10:00',
    ])
  })

  it('bloqueio: resumo humano derivado do snapshot, nunca ISO cru; a nota viaja', async () => {
    semear({
      teacher_availability_exceptions: {
        data: [
          blocoCru({
            inicioUtc: '2026-08-01T04:00:00Z',
            fimUtc: '2026-08-11T04:00:00Z',
            snapshot: `2026-08-01 → 2026-08-10 ${CUIABA}`,
            note: 'férias',
          }),
        ],
      },
    })
    const agenda = await getAgenda({ ...base })
    const [b] = agenda.disponibilidade!.bloqueios
    expect(b.resumo).toBe('01/08/2026 → 10/08/2026')
    expect(b.resumo).not.toMatch(/\d{4}-\d{2}-\d{2}/) // ISO cru é defeito, não detalhe
    expect(b.note).toBe('férias')
  })
})

/* ========================================================================== */
/* 8. As 4 actions — recusa, shape exato, erro honesto, frase enumerada        */
/* ========================================================================== */

function formDe(campos: Record<string, string>) {
  const fd = new FormData()
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor)
  return fd
}

/** Roda a action e devolve a URL do redirect (que no Next é um throw). */
async function rodar(action: (fd: FormData) => Promise<void>, campos: Record<string, string>): Promise<string> {
  try {
    await action(formDe(campos))
  } catch (e) {
    if (e instanceof Redirecionou) return e.url
    throw e
  }
  throw new Error('a action deveria ter redirecionado')
}

/**
 * A frase que chegou à tela (o que o `AvisoLegado` pinta).
 *
 * A7: ela deixou de viajar na URL e passou ao cookie da seção — o transporte
 * único da Agenda. O helper mudou de FONTE, não de propósito: continua sendo "o
 * que a dona lê depois do ato". `url` fica no parâmetro porque os casos abaixo
 * também cobram o DESTINO, e ler os dois de uma linha só era o que este helper
 * fazia.
 */
function fraseDe(url: string): string {
  expect(url, 'a frase voltou para a barra de endereços (A7)').not.toContain('msg=')
  const cru = pote.get(cookieDoRecado('agenda'))?.value
  if (!cru) throw new Error('a action não gravou recado nenhum no cookie da seção')
  return (JSON.parse(cru) as { mensagem: string }).mensagem
}

describe('A3 · addWeeklyAvailabilityAction', () => {
  it('campo obrigatório ausente → recusa clara SEM chamar a RPC', async () => {
    const url = await rodar(addWeeklyAvailabilityAction, {
      teacher_id: PROFESSORA,
      start_local: '08:00',
      end_local: '12:00',
      back: '/admin/agenda',
    })
    expect(mock.rpcs).toHaveLength(0)
    expect(fraseDe(url)).toContain('Falha: preencha professora, dia da semana')
  })

  it('janela invertida → recusa antecipada SEM chamar a RPC', async () => {
    const url = await rodar(addWeeklyAvailabilityAction, {
      teacher_id: PROFESSORA,
      weekday: '1',
      start_local: '12:00',
      end_local: '08:00',
      back: '/admin/agenda',
    })
    expect(mock.rpcs).toHaveLength(0)
    expect(fraseDe(url)).toContain('o fim da janela precisa ser depois do início')
  })

  it("weekday forjado não chega à RPC: ' ' (que `Number` lê como 0) e '7' (fora da faixa)", async () => {
    // Rodada de correção, item 13: a action é endpoint público — `Number(' ')`
    // vale 0 e um envio forjado com espaço viraria "domingo" em silêncio.
    const campos = { teacher_id: PROFESSORA, start_local: '08:00', end_local: '12:00', back: '/admin/agenda' }
    const espaco = await rodar(addWeeklyAvailabilityAction, { ...campos, weekday: ' ' })
    expect(mock.rpcs).toHaveLength(0)
    expect(tomDoAviso(fraseDe(espaco))).toBe('erro')

    const sete = await rodar(addWeeklyAvailabilityAction, { ...campos, weekday: '7' })
    expect(mock.rpcs).toHaveLength(0)
    expect(fraseDe(sete)).toBe('Falha: dia da semana inválido — escolha um dia da lista.')

    const quebrado = await rodar(addWeeklyAvailabilityAction, { ...campos, weekday: '2.5' })
    expect(mock.rpcs).toHaveLength(0)
    expect(tomDoAviso(fraseDe(quebrado))).toBe('erro')
  })

  it('chama a RPC com o shape exato e SEM p_iana_tz (a janela nasce no fuso DELA) — weekday 0 aceito', async () => {
    // weekday '0' (domingo) de propósito: uma checagem falsy engoliria o zero
    // e recusaria a janela de domingo.
    const url = await rodar(addWeeklyAvailabilityAction, {
      teacher_id: PROFESSORA,
      weekday: '0',
      start_local: '09:00',
      end_local: '10:00',
      back: `/admin/agenda?prof=${PROFESSORA}`,
    })
    expect(mock.rpcs).toEqual([
      ['set_weekly_availability', { p_teacher: PROFESSORA, p_weekday: 0, p_start: '09:00', p_end: '10:00' }],
    ])
    // afirmação explícita: p_iana_tz NÃO viaja — a RPC cai no fuso da professora
    expect(Object.keys(mock.rpcs[0][1] as object)).not.toContain('p_iana_tz')
    // A dona volta para a MESMA professora filtrada. A7: o `prof` do `back` é
    // validado por TIPO — um valor que não é uuid (envio forjado, aba velha) é
    // DESCARTADO, e ela cai na visão sem filtro em vez de perder o desfecho.
    expect(url).toBe(`/admin/agenda?prof=${PROFESSORA}`)
    expect(
      await rodar(addWeeklyAvailabilityAction, {
        teacher_id: PROFESSORA,
        weekday: '0',
        start_local: '09:00',
        end_local: '10:00',
        back: '/admin/agenda?prof=x',
      }),
    ).toBe('/admin/agenda')
    const frase = fraseDe(url)
    expect(frase).toContain('Janela semanal criada')
    expect(tomDoAviso(frase)).toBe('sucesso') // frase ENUMERADA — fora da lista sairia vermelha
  })

  it('{error} da RPC → mensagem de falha, nunca sucesso', async () => {
    mock.respostaRpc = { error: { message: 'agenda semanal é da própria professora ou da admin (D10)' } }
    const url = await rodar(addWeeklyAvailabilityAction, {
      teacher_id: PROFESSORA,
      weekday: '1',
      start_local: '08:00',
      end_local: '12:00',
      back: '/admin/agenda',
    })
    const frase = fraseDe(url)
    expect(frase).toContain('Falha:')
    expect(tomDoAviso(frase)).toBe('erro')
  })
})

describe('A3 · removeWeeklyAvailabilityAction', () => {
  it('sem id → recusa sem RPC; com id → shape { p_id } e frase enumerada', async () => {
    const recusa = await rodar(removeWeeklyAvailabilityAction, { back: '/admin/agenda' })
    expect(mock.rpcs).toHaveLength(0)
    expect(tomDoAviso(fraseDe(recusa))).toBe('erro')

    const url = await rodar(removeWeeklyAvailabilityAction, { id: 'w1', back: '/admin/agenda' })
    expect(mock.rpcs).toEqual([['remove_weekly_availability', { p_id: 'w1' }]])
    const frase = fraseDe(url)
    expect(frase).toBe('Janela semanal removida.')
    expect(tomDoAviso(frase)).toBe('sucesso')
  })

  it('{error} da RPC vira falha', async () => {
    mock.respostaRpc = { error: { message: 'janela semanal x não existe' } }
    const url = await rodar(removeWeeklyAvailabilityAction, { id: 'w1', back: '/admin/agenda' })
    expect(tomDoAviso(fraseDe(url))).toBe('erro')
  })
})

describe('A3 · addTeacherBlockAction', () => {
  it('sem período → recusa sem RPC; período invertido idem', async () => {
    const semCampos = await rodar(addTeacherBlockAction, { teacher_id: PROFESSORA, back: '/admin/agenda' })
    expect(mock.rpcs).toHaveLength(0)
    expect(fraseDe(semCampos)).toContain('preencha professora e o período')

    const invertido = await rodar(addTeacherBlockAction, {
      teacher_id: PROFESSORA,
      from: '2026-08-10',
      to: '2026-08-01',
      back: '/admin/agenda',
    })
    expect(mock.rpcs).toHaveLength(0)
    expect(fraseDe(invertido)).toContain('período está invertido')
  })

  it('chama a RPC com o shape exato (nota vazia vira null) e frase enumerada', async () => {
    const url = await rodar(addTeacherBlockAction, {
      teacher_id: PROFESSORA,
      from: '2026-08-01',
      to: '2026-08-10',
      note: '  ',
      back: '/admin/agenda',
    })
    expect(mock.rpcs).toEqual([
      ['add_teacher_block', { p_teacher: PROFESSORA, p_from: '2026-08-01', p_to: '2026-08-10', p_note: null }],
    ])
    const frase = fraseDe(url)
    expect(frase).toContain('Bloqueio criado')
    expect(frase).toContain('Aulas já marcadas continuam') // a consequência declarada
    expect(tomDoAviso(frase)).toBe('sucesso')
  })

  it('a nota viaja quando existe; {error} vira falha', async () => {
    await rodar(addTeacherBlockAction, {
      teacher_id: PROFESSORA,
      from: '2026-08-01',
      to: '2026-08-01',
      note: 'férias',
      back: '/admin/agenda',
    })
    expect((mock.rpcs[0][1] as { p_note: string | null }).p_note).toBe('férias')

    mock.rpcs = []
    mock.respostaRpc = { error: { message: 'professora x não existe' } }
    const url = await rodar(addTeacherBlockAction, {
      teacher_id: PROFESSORA,
      from: '2026-08-01',
      to: '2026-08-01',
      back: '/admin/agenda',
    })
    expect(tomDoAviso(fraseDe(url))).toBe('erro')
  })
})

describe('A3 · removeTeacherBlockAction', () => {
  // Rodada de correção, item 4 (grave): a RPC `remove_teacher_block` da F5
  // apaga QUALQUER exceção pelo id, sem conferir `kind` (dívida pré-existente
  // do banco). A action agora LÊ a exceção antes — e o fake abaixo alimenta
  // essa leitura de conferência.
  const excecaoNoBanco = (kind: string) => ({ teacher_availability_exceptions: { data: { kind } } })

  it('sem id → recusa sem RPC; com id de BLOQUEIO → { p_id } e frase enumerada', async () => {
    const recusa = await rodar(removeTeacherBlockAction, { back: '/admin/agenda' })
    expect(mock.rpcs).toHaveLength(0)
    expect(tomDoAviso(fraseDe(recusa))).toBe('erro')

    mock.respostas = excecaoNoBanco('block')
    const url = await rodar(removeTeacherBlockAction, { id: 'b1', back: '/admin/agenda' })
    expect(mock.rpcs).toEqual([['remove_teacher_block', { p_id: 'b1' }]])
    // …e a conferência leu a exceção pelo id ANTES de remover
    expect(mock.chamadas['teacher_availability_exceptions']).toContainEqual(['eq', 'id', 'b1'])
    const frase = fraseDe(url)
    expect(frase).toBe('Bloqueio removido — a oferta do período voltou ao normal.')
    expect(tomDoAviso(frase)).toBe('sucesso')
  })

  it("uuid de kind='open' → recusa SEM chamar a RPC (que apagaria e diria a frase verde)", async () => {
    mock.respostas = excecaoNoBanco('open')
    const url = await rodar(removeTeacherBlockAction, { id: 'x-open', back: '/admin/agenda' })
    expect(mock.rpcs).toHaveLength(0)
    const frase = fraseDe(url)
    expect(frase).toBe('Esse registro não é um bloqueio — nada foi removido.')
    expect(tomDoAviso(frase)).toBe('erro')
  })

  it('leitura de conferência com {error} → recusa honesta (fail-closed), sem RPC', async () => {
    mock.respostas = { teacher_availability_exceptions: { error: { message: 'timeout' } } }
    const url = await rodar(removeTeacherBlockAction, { id: 'b1', back: '/admin/agenda' })
    expect(mock.rpcs).toHaveLength(0)
    const frase = fraseDe(url)
    expect(frase).toContain('nada foi removido')
    expect(tomDoAviso(frase)).toBe('erro')
  })

  it('{error} da própria RPC → mensagem de falha, nunca a frase verde', async () => {
    mock.respostas = excecaoNoBanco('block')
    mock.respostaRpc = { error: { message: 'permission denied' } }
    const url = await rodar(removeTeacherBlockAction, { id: 'b1', back: '/admin/agenda' })
    expect(mock.rpcs).toHaveLength(1) // a RPC foi tentada…
    const frase = fraseDe(url)
    expect(frase).toContain('Falha:')
    expect(frase).not.toContain('Bloqueio removido')
    expect(tomDoAviso(frase)).toBe('erro')
  })
})

/* ========================================================================== */
/* 8b. S7 (varredura final) — a porta SEM GAVETA não varre a gaveta dos irmãos */
/* ========================================================================== */

describe('varredura final · S7: remover não apaga o que a dona digitou ao lado', () => {
  // O PAINEL `?novo=disponibilidade` tem QUATRO formulários (criar janela,
  // remover janela, criar bloqueio, remover bloqueio) e UMA gaveta —
  // `painel:disponibilidade`, a chave derivada do `back_erro` que todos os
  // quatro mandam. As duas REMOÇÕES são portas `'nenhum'`: elas não têm nada a
  // guardar, e por isso não podem tocar no cookie de quem tem.
  const PAINEL = '/admin/agenda?novo=disponibilidade'
  const ENVIO = { back: '/admin/agenda', back_erro: PAINEL }

  /** A gaveta do painel, como ela fica depois de o banco recusar um bloqueio. */
  async function gavetaDoPainel() {
    const { gravarRascunho, lerRascunho } = await import('@/lib/admin/rascunho-do-formulario')
    const { chaveDoPainel } = await import('@/lib/admin/chaves-de-rascunho')
    return {
      chave: chaveDoPainel('disponibilidade'),
      gravar: (campos: Record<string, string>) => gravarRascunho(chaveDoPainel('disponibilidade'), campos),
      ler: () => lerRascunho(chaveDoPainel('disponibilidade')),
    }
  }

  it('O CENÁRIO DA DONA: erro no bloqueio → remove uma janela → o MOTIVO sobrevive', async () => {
    // 1. o banco recusa o bloqueio e o que ela digitou vai para a gaveta
    mock.respostaRpc = { error: { message: 'professora x não existe' } }
    await rodar(addTeacherBlockAction, {
      teacher_id: PROFESSORA,
      from: '2026-08-01',
      to: '2026-08-10',
      note: 'consulta médica',
      ...ENVIO,
    })
    const gaveta = await gavetaDoPainel()
    expect((await gaveta.ler()).note, 'a gaveta do painel nasceu vazia').toBe('consulta médica')

    // 2. no MESMO painel, ela remove uma janela semanal que sobrou da lista
    mock.respostaRpc = { data: null, error: null }
    await rodar(removeWeeklyAvailabilityAction, { id: 'w1', ...ENVIO })

    // 3. o motivo do bloqueio continua lá — antes do S7 o sucesso da remoção
    //    derivava `painel:disponibilidade` do `back_erro` e varria a gaveta de
    //    um formulário que não era o dele.
    expect((await gaveta.ler()).note, 'remover a janela apagou o que ela digitou no bloqueio').toBe(
      'consulta médica',
    )
  })

  it('…e a remoção que FALHA também não varre (o erro dela não é gaveta de ninguém)', async () => {
    const gaveta = await gavetaDoPainel()
    await gaveta.gravar({ note: 'férias da professora', from: '2026-09-01' })
    mock.respostas = { teacher_availability_exceptions: { data: { kind: 'block' } } }
    mock.respostaRpc = { error: { message: 'permission denied' } }
    await rodar(removeTeacherBlockAction, { id: 'b1', ...ENVIO })
    expect((await gaveta.ler()).note).toBe('férias da professora')
  })

  it('POR CONSTRUÇÃO: toda porta sem gaveta declara a chave vazia, não só estas duas', async () => {
    // A regra não pode valer por acaso do formulário: `cancelWindowAction` e
    // `completeAllPendingAction` são as outras duas portas `'nenhum'` de hoje, e
    // a quinta que alguém escrever amanhã nasce certa porque quem declara a
    // chave é a FÁBRICA `porta()`.
    const { cancelWindowAction, completeAllPendingAction } = await import(
      '@/app/admin/agenda/actions'
    )
    const gaveta = await gavetaDoPainel()
    for (const [nome, acao, campos] of [
      ['despublicar', cancelWindowAction, { window_id: 'w-1' }],
      ['lote', completeAllPendingAction, { teacher_id: PROFESSORA, instance_ids: 'i-1,i-2' }],
    ] as const) {
      await gaveta.gravar({ note: `intocada pelo ${nome}` })
      mock.respostaRpc = { data: 2, error: null }
      await rodar(acao, { ...campos, ...ENVIO })
      expect((await gaveta.ler()).note, nome).toBe(`intocada pelo ${nome}`)
    }
  })
})

/* ========================================================================== */
/* 9. Guardas do fork — `blocked` é camada de fundo com identidade própria     */
/* ========================================================================== */

let container: HTMLDivElement | undefined
let root: Root | undefined

/** Renderiza QUALQUER nó React no jsdom (o fork e, adiante, o painel da página). */
async function montarNo(no: ReactNode): Promise<HTMLDivElement> {
  const el = document.createElement('div')
  container = el
  document.body.appendChild(el)
  await act(async () => {
    root = createRoot(el)
    root.render(no)
  })
  return el
}

async function montar(props: {
  events: CalEvent[]
  view: 'mes' | 'semana' | 'dia'
  anchor: string
  slotPopup?: (dateISO: string, timeHHmm: string) => ReactNode
}): Promise<HTMLDivElement> {
  return montarNo(
    h(Calendario, {
      tz: CUIABA,
      todayISO: '2026-07-28',
      dayHref: (iso: string) => `/admin/agenda?v=dia&d=${iso}`,
      ...props,
    }),
  )
}

afterEach(async () => {
  // só os casos de RENDER montam; nos demais não há o que desmontar
  if (root) {
    const r = root
    root = undefined
    await act(async () => r.unmount())
  }
  container?.remove()
  container = undefined
  document.body.innerHTML = ''
})

function aula(campos: { id: string; inicioUtc: string; fimUtc?: string; title?: string }): CalEvent {
  return {
    id: campos.id,
    startsAtUtc: campos.inicioUtc,
    endsAtUtc: campos.fimUtc ?? null,
    title: campos.title ?? campos.id,
    color: 0,
  }
}

/** Um pedaço de bloqueio como a página o monta (dia civil 29/07 em Cuiabá). */
const BLOQUEIO: CalEvent = {
  id: 'bl-1',
  startsAtUtc: '2026-07-29T04:00:00Z',
  endsAtUtc: '2026-07-30T04:00:00Z',
  title: 'bloqueada — férias',
  color: 0,
  blocked: true,
}

describe('A3 · blocked na grade de horas: fundo com identidade própria', () => {
  it('pointer-events-none (o slot embaixo segue vivo), hachura neutra ≠ ghost, rótulo no piso de DADO', async () => {
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [BLOQUEIO] })
    const bloco = c.querySelector<HTMLElement>('[title="bloqueada — férias"]')!
    expect(bloco, 'o bloqueio sumiu da grade').not.toBeNull()
    expect(bloco.className).toContain('pointer-events-none')
    // identidade própria: hachura em tokens neutros — nem o chapado do ghost,
    // nem cor de professora, nem roupa de aula sólida
    expect(bloco.className).toContain('repeating-linear-gradient')
    expect(bloco.className).not.toContain('bg-paper-100/90')
    expect(bloco.className).not.toContain('-tint)')
    expect(bloco.className).not.toContain('-fill)')
    expect(bloco.className).not.toContain('shadow')
    // rótulo visível no piso LITERAL de DADO (Sol · rodadas 4 e 5): a note
    // dele no painel já está em ink-900 — o mesmo dado não fica em dois
    // pisos na mesma tela. (O ghost subiu para o MESMO piso na rodada 5 —
    // asserts no a2; o que distingue os dois fundos é a FORMA, hachura ×
    // lavagem, não o peso do texto.)
    expect(bloco.textContent).toBe('bloqueada — férias')
    const rotulo = bloco.querySelector('span')!
    expect(rotulo.className).toContain('text-sm')
    expect(rotulo.className).toContain('font-medium')
    expect(rotulo.className).toContain('text-ink-900')
    expect(rotulo.className).not.toContain('text-ink-600')
  })

  it('blocked não disputa lane: a aula por cima fica com a coluna inteira', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [BLOQUEIO, aula({ id: 'a', inicioUtc: '2026-07-29T18:00:00Z', title: 'Aula A' })],
    })
    expect(c.querySelector<HTMLElement>('[title="Aula A"]')!.style.width).toBe('calc(100% - 4px)')
  })
})

describe('A3 · blocked fora do mês e do DayStrip (disciplina das camadas de fundo)', () => {
  it('mês: blocked não vira chip nem infla o "+N mais"', async () => {
    const dia = (n: number) => aula({ id: `e${n}`, inicioUtc: `2026-07-29T1${n}:00:00Z`, title: `Aula ${n}` })
    const c = await montar({
      view: 'mes',
      anchor: '2026-07-28',
      events: [BLOQUEIO, dia(4), dia(5), dia(6), dia(7)],
    })
    expect(c.textContent).not.toContain('bloqueada')
    const mais = [...c.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent?.endsWith('mais'))
    expect(mais?.textContent).toBe('+1 mais')
  })

  it('DayStrip: blocked não vira bolinha de professora', async () => {
    const c = await montar({ view: 'semana', anchor: '2026-07-28', events: [{ ...BLOQUEIO, color: 2 }] })
    const faixa = c.querySelector<HTMLElement>('[class*="items-stretch"]')!
    const bolinhas = [...faixa.querySelectorAll<HTMLElement>('[class*="w-1.5"]')].filter((b) =>
      b.className.includes('rounded-full'),
    )
    expect(bolinhas).toHaveLength(0)
  })
})

describe('A3 · fundo que TERMINA À MEIA-NOITE não some da grade (Sol · rodada 2, defeito 1)', () => {
  it('Lisboa dom 02:00–06:00 no inverno, RENDERIZADO: os DOIS pedaços no DOM — sáb 22:00–24:00 até o pé da coluna E dom 00:00–02:00', async () => {
    // Os dois pedaços como o data layer os entrega (recorte por dia civil de
    // exibição — caso do bloco 1b acima). A rodada 1 só olhava `eventosAvail`;
    // aqui a prova é o RENDER. Prova de mutação: com `end.hour` a meia-noite
    // final lê como hora 0, a faixa para às 22h e o clamp descarta o pedaço do
    // sábado (`fim <= início`) — o conserto da travessia devolvia o domingo e
    // ENGOLIA o sábado.
    const sab: CalEvent = {
      id: 'av-sab',
      startsAtUtc: '2027-01-17T02:00:00Z', // sáb 16/01 22:00 em Cuiabá
      endsAtUtc: '2027-01-17T04:00:00Z', // dom 17/01 00:00 em Cuiabá — meia-noite do dia SEGUINTE
      title: 'disponível (sáb)',
      color: 0,
      avail: true,
    }
    const dom: CalEvent = {
      id: 'av-dom',
      startsAtUtc: '2027-01-17T04:00:00Z', // dom 00:00
      endsAtUtc: '2027-01-17T06:00:00Z', // dom 02:00
      title: 'disponível (dom)',
      color: 0,
      avail: true,
    }
    const c = await montar({ view: 'semana', anchor: '2027-01-11', events: [sab, dom] })
    const blocoSab = c.querySelector<HTMLElement>('[title="disponível (sáb)"]')
    const blocoDom = c.querySelector<HTMLElement>('[title="disponível (dom)"]')
    expect(blocoSab, 'o pedaço do sábado (fim à meia-noite) sumiu da grade').not.toBeNull()
    expect(blocoDom, 'o pedaço do domingo sumiu da grade').not.toBeNull()
    // sáb 22:00→24:00 = fundo até o PÉ da coluna (meia-noite seguinte = 1440
    // min, nunca "hora 0")
    const coluna = blocoSab!.parentElement as HTMLElement
    const alturaDaColuna = parseFloat(coluna.style.height)
    expect(alturaDaColuna).toBeGreaterThan(0)
    const pe = parseFloat(blocoSab!.style.top) + parseFloat(blocoSab!.style.height)
    expect(pe).toBeGreaterThanOrEqual(alturaDaColuna - 2) // até o pé (−2 do respiro)
    expect(pe).toBeLessThanOrEqual(alturaDaColuna) // sem vazar
    // dom começa no TOPO do dia (00:00) e mede as 2h dele
    expect(parseFloat(blocoDom!.style.top)).toBe(0)
    expect(parseFloat(blocoDom!.style.height)).toBeCloseTo(2 * 64 - 2, 5)
  })
})

describe('A3 · fundo no pé da faixa: geometria VERDADEIRA (Sol · rodadas 2 e 3)', () => {
  it('bloqueio 20:50→21:00: top civil PRESERVADO e altura real — tirinha honesta, sem mínimo de 18px', async () => {
    // Rodada 2: o mínimo de 18px vazava da coluna; rodada 3: o re-prender que
    // consertava o vazamento deslocava o top e colidia fundos curtos. Para
    // FUNDO o mínimo MORREU: o retângulo desenha a geometria do recorte.
    // Prova de mutação: qualquer mínimo/deslocamento reaplicado ao fundo
    // quebra o top e a altura exatos cobrados abaixo.
    const tira: CalEvent = {
      id: 'bl-tira',
      startsAtUtc: '2026-07-30T00:50:00Z', // 29/07 20:50 em Cuiabá
      endsAtUtc: '2026-07-30T01:00:00Z', // 21:00
      title: 'bloqueada — reunião',
      color: 0,
      blocked: true,
    }
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [tira] })
    const bloco = c.querySelector<HTMLElement>('[title="bloqueada — reunião"]')
    expect(bloco, 'o pedaço de minutos sumiu da grade').not.toBeNull()
    const coluna = bloco!.parentElement as HTMLElement
    const alturaDaColuna = parseFloat(coluna.style.height)
    const top = parseFloat(bloco!.style.top)
    const altura = parseFloat(bloco!.style.height)
    // posição civil VERDADEIRA: 20:50 numa faixa 7–21 = (1250−420)/60 × 64
    expect(top).toBeCloseTo(((20 * 60 + 50 - 7 * 60) / 60) * 64, 5)
    expect(altura).toBeCloseTo((10 / 60) * 64 - 2, 5) // os 10 min reais, com o respiro
    expect(top + altura).toBeLessThanOrEqual(alturaDaColuna) // e nada vaza
  })

  it('dois fundos curtos separados no pé da faixa: tops DIFERENTES, sem sobreposição de retângulo (rodada 3, achado d)', async () => {
    // Prova de mutação: com o mínimo de 18px + re-prender por deslocamento,
    // 20:44–20:49 e 20:50–21:00 acabavam AMBOS em top = colH−18 e altura 18 —
    // o mesmo retângulo, um cobrindo o rótulo do outro.
    const tiraA: CalEvent = {
      id: 'bl-a',
      startsAtUtc: '2026-07-30T00:44:00Z', // 20:44 em Cuiabá
      endsAtUtc: '2026-07-30T00:49:00Z', // 20:49
      title: 'bloqueada — reunião',
      color: 0,
      blocked: true,
    }
    const tiraB: CalEvent = {
      id: 'bl-b',
      startsAtUtc: '2026-07-30T00:50:00Z', // 20:50
      endsAtUtc: '2026-07-30T01:00:00Z', // 21:00
      title: 'bloqueada — plantão',
      color: 0,
      blocked: true,
    }
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [tiraA, tiraB] })
    const a = c.querySelector<HTMLElement>('[title="bloqueada — reunião"]')
    const b = c.querySelector<HTMLElement>('[title="bloqueada — plantão"]')
    expect(a, 'o primeiro fundo curto sumiu da grade').not.toBeNull()
    expect(b, 'o segundo fundo curto sumiu da grade').not.toBeNull()
    const topA = parseFloat(a!.style.top)
    const altA = parseFloat(a!.style.height)
    const topB = parseFloat(b!.style.top)
    const altB = parseFloat(b!.style.height)
    expect(topA).not.toBe(topB)
    expect(topA + altA).toBeLessThanOrEqual(topB) // retângulos disjuntos
    const alturaDaColuna = parseFloat((a!.parentElement as HTMLElement).style.height)
    expect(topB + altB).toBeLessThanOrEqual(alturaDaColuna) // presos à coluna
  })

  it('o contêiner do fundo NÃO tem padding vertical; o respiro mora no rótulo (Sol · rodada 4)', async () => {
    // jsdom não computa caixa, então a prova é ESTRUTURAL: com box-sizing
    // border-box (preflight do Tailwind v4), `py-0.5` no contêiner punha um
    // PISO de 4px no box renderizado — abaixo de ~5,6 min o fundo media mais
    // que o height declarado e fundos contíguos curtíssimos voltavam a se
    // sobrepor, furando a "geometria verdadeira" acima. Prova de mutação:
    // devolver o py-0.5 ao contêiner deixa este caso vermelho.
    // bloqueio e ghost em horários DISJUNTOS: sobrepostos, o muting calaria o
    // rótulo de um deles e não haveria <span> para inspecionar
    const tira: CalEvent = {
      id: 'bl-resp',
      startsAtUtc: '2026-07-29T14:00:00Z', // 10:00 em Cuiabá
      endsAtUtc: '2026-07-29T15:00:00Z',
      title: 'bloqueada — férias',
      color: 0,
      blocked: true,
    }
    const ghost: CalEvent = {
      id: 'gh-fundo',
      startsAtUtc: '2026-07-29T19:00:00Z', // 15:00 em Cuiabá
      endsAtUtc: '2026-07-29T20:00:00Z',
      title: 'Compromisso',
      color: 0,
      ghost: true,
    }
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [tira, ghost] })
    const vertical = /\bp[ytb]-[\d.]+/ // py-/pt-/pb- — o px-1.5 horizontal FICA
    for (const titulo of ['bloqueada — férias', 'Compromisso']) {
      const bloco = c.querySelector<HTMLElement>(`[title="${titulo}"]`)!
      expect(bloco, `o fundo "${titulo}" sumiu da grade`).not.toBeNull()
      expect(bloco.className, titulo).not.toMatch(vertical)
      expect(bloco.className, titulo).toContain('px-1.5')
      // o respiro migrou para o rótulo, que vive no overflow-hidden e não
      // infla o box do contêiner
      const rotulo = bloco.querySelector('span')!
      expect(rotulo.className, titulo).toContain('py-0.5')
    }
  })
})

describe('A3 · geometria do fundo presa à faixa de horas (rodadas de correção 1–3)', () => {
  it('bloqueio de dia inteiro (00:00→24:00) desenha DENTRO da coluna, na POSIÇÃO verdadeira', async () => {
    // Rodada 3: o span IGNORA `blocked`, então sozinho o bloqueio deixa a
    // faixa no default 7–21 (896px) e o pedaço sai RECORTADO a ela. A
    // propriedade agora é de POSIÇÃO, não só contenção: recorte que começa
    // antes da faixa cola no topo (top = 0) e cobre a coluna inteira.
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [BLOQUEIO] })
    const bloco = c.querySelector<HTMLElement>('[title="bloqueada — férias"]')!
    expect(bloco, 'o bloqueio sumiu da grade').not.toBeNull()
    const coluna = bloco.parentElement as HTMLElement
    const alturaDaColuna = parseFloat(coluna.style.height)
    expect(alturaDaColuna).toBe((21 - 7) * 64) // a faixa NÃO abriu para as 24h
    const top = parseFloat(bloco.style.top)
    const altura = parseFloat(bloco.style.height)
    expect(top).toBe(0) // posição preservada: o recorte começa no topo da faixa
    expect(altura).toBeCloseTo(alturaDaColuna - 2, 5) // e cobre a coluna inteira
  })
})

describe('A3 · span de horas IGNORA blocked (Sol · rodada 3 — reprovado o span de 24h)', () => {
  it('semana com aula 14:00–15:00 + bloqueio de dia inteiro: a coluna fica nas 14h default, com a hachura recortada presente', async () => {
    // Prova de mutação: `blocked` de volta na conta de horas abre a faixa
    // 0–24 e a coluna vira 1536px — a altura exata abaixo reprova.
    const c = await montar({
      view: 'semana',
      anchor: '2026-07-29',
      events: [
        BLOQUEIO,
        aula({ id: 'a-tarde', inicioUtc: '2026-07-29T18:00:00Z', fimUtc: '2026-07-29T19:00:00Z', title: 'Aula da tarde' }),
      ],
    })
    const bloco = c.querySelector<HTMLElement>('[title="bloqueada — férias"]')!
    expect(bloco, 'a hachura do bloqueio sumiu da grade').not.toBeNull()
    const coluna = bloco.parentElement as HTMLElement
    expect(coluna.style.height).toBe(`${(21 - 7) * 64}px`) // 896px — o span dos OUTROS eventos
    const alturas = [...c.querySelectorAll<HTMLElement>('div[style*="height"]')].map((el) => el.style.height)
    expect(alturas).not.toContain('1536px') // nenhuma grade abriu as 24h do bloqueio
    // e a hachura está lá, recortada à faixa visível INTEIRA (00:00→24:00 ⇒ 07–21)
    expect(parseFloat(bloco.style.top)).toBe(0)
    expect(parseFloat(bloco.style.height)).toBeCloseTo((21 - 7) * 64 - 2, 5)
  })
})

describe('A3 · slot sob as camadas (rodada 3 — presença/fiação; a interação real é o e2e do A9)', () => {
  // ⚠️ REESCRITO NO PORTÃO DE DEPLOY DE 29/07 (bloqueador 3). A versão anterior
  // cobrava "28 gatilhos continuam no DOM" com `avail` E `blocked` ligados — e
  // era justamente o defeito: sob a faixa que diz "bloqueada — férias" o botão
  // de publicar seguia vivo (as camadas são pointer-events-none) e o toque no
  // iPhone abria "Publicar horário" no horário que a tela declarava
  // indisponível. A régua agora separa as duas categorias: DISPONIBILIDADE é
  // fundo informativo e o slot embaixo continua vivo; PROIBIÇÃO mata a oferta.
  // A prova de hit-testing (qual elemento recebe o toque) está em
  // `tests/portao-deploy-agenda.test.ts`.
  const AVAIL_DIA: CalEvent = {
    id: 'av-dia',
    startsAtUtc: '2026-07-29T12:00:00Z', // 08:00 em Cuiabá
    endsAtUtc: '2026-07-29T22:00:00Z', // 18:00
    title: 'disponível',
    color: 0,
    avail: true,
  }

  it('sob DISPONIBILIDADE os 28 gatilhos seguem no DOM, e a camada não rouba o ponteiro', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [AVAIL_DIA],
      slotPopup: (iso, hhmm) => h('p', null, `mini-form ${iso} ${hhmm}`),
    })
    expect(c.querySelectorAll('button[title^="Criar às"]')).toHaveLength(28)
    expect(c.querySelector<HTMLElement>('[title="disponível"]')!.className).toContain('pointer-events-none')
  })

  it('sob PROIBIÇÃO (bloqueio do dia inteiro) NÃO sobra gatilho de publicação nenhum', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [AVAIL_DIA, BLOQUEIO],
      slotPopup: (iso, hhmm) => h('p', null, `mini-form ${iso} ${hhmm}`),
    })
    expect(c.querySelectorAll('button[title^="Criar às"]')).toHaveLength(0)
    expect(c.querySelector<HTMLElement>('[title="bloqueada — férias"]')!.className).toContain('pointer-events-none')
  })
})

describe('A3 · ordem de pintura dos fundos por bgPriority (rodada de correção, item 3)', () => {
  // Janela tracejada às 00:00 (mesma zona de rótulo do bloqueio de dia
  // inteiro). Vai ANTES do bloqueio no array de propósito: a ordem de chegada
  // é a mutação que este teste vigia — sem o sort, o bloqueio pintaria por
  // último e cobriria a janela clicável (botão invisível).
  const DASHED_MEIA_NOITE: CalEvent = {
    id: 'w-aberta',
    startsAtUtc: '2026-07-29T04:00:00Z', // 00:00 em Cuiabá
    endsAtUtc: '2026-07-29T05:00:00Z',
    title: 'horário aberto',
    color: 0,
    dashed: true,
  }

  it('a dashed (prioridade 3) pinta DEPOIS/acima do blocked (2); o rótulo do coberto cala', async () => {
    const c = await montar({
      view: 'dia',
      anchor: '2026-07-29',
      events: [DASHED_MEIA_NOITE, BLOQUEIO],
    })
    const aberta = c.querySelector<HTMLElement>('[title="horário aberto"]')!
    const bloqueada = c.querySelector<HTMLElement>('[title="bloqueada — férias"]')!
    expect(aberta).not.toBeNull()
    expect(bloqueada).not.toBeNull()
    // posicionados absolutos no mesmo contexto: quem vem DEPOIS no DOM fica
    // por cima — a janela tracejada tem de seguir o bloqueio
    expect(
      Boolean(bloqueada.compareDocumentPosition(aberta) & Node.DOCUMENT_POSITION_FOLLOWING),
      'a janela tracejada precisa ser pintada depois (acima) do bloqueio',
    ).toBe(true)
    // o muting confere com a nova ordem: o bloqueio coberto na zona do rótulo
    // fica mudo (dado completo segue no title); a janela mantém o dela
    expect(bloqueada.textContent).toBe('')
    expect(bloqueada.title).toBe('bloqueada — férias')
    expect(aberta.textContent).toContain('horário aberto')
  })
})

describe('A3 · dois bloqueios no mesmo horário: um rótulo só (rodada de correção, item 6)', () => {
  it('entre iguais, o pintado depois cala o rótulo do de baixo — o ATRIBUTO title carrega as duas notas (a fonte alcançável é o PAINEL)', async () => {
    const ferias: CalEvent = { ...BLOQUEIO, id: 'bl-f', title: 'bloqueada — férias' }
    const congresso: CalEvent = { ...BLOQUEIO, id: 'bl-c', title: 'bloqueada — congresso' }
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [ferias, congresso] })
    const deBaixo = c.querySelector<HTMLElement>('[title="bloqueada — férias"]')!
    const deCima = c.querySelector<HTMLElement>('[title="bloqueada — congresso"]')!
    // prova de mutação: sem o desempate entre iguais, os DOIS rótulos saem
    // sobrepostos e ilegíveis — aqui o primeiro tem de estar mudo
    expect(deBaixo.textContent).toBe('')
    expect(deCima.textContent).toBe('bloqueada — congresso')
    // Os asserts abaixo provam SÓ que o ATRIBUTO title carrega as duas notas
    // — não que alguém as alcança na grade: com pointer-events-none não há
    // hover de mouse que chegue nele, e no celular hover nativo não existe.
    // A fonte ALCANÇÁVEL das notas é o PAINEL de disponibilidade, não a
    // grade (dívida do rótulo calado declarada e aceita — Sol · rodadas 2 e
    // 5 do A3).
    expect(deBaixo.title).toBe('bloqueada — férias')
    expect(deCima.title).toBe('bloqueada — congresso')
  })
})

describe('A3 · NADA INVISÍVEL CONTINUA CLICÁVEL (rodada 5 — 3ª aparição da família: blocked×dashed, .linha-ancora do iOS, blocked×ghost)', () => {
  // O ghost COM popup entra nas camadas de fundo mas é um gatilho de popover
  // de verdade; a hachura do bloqueio (prioridade maior, pointer-events-none)
  // pinta por cima e o esconde SEM barrar o toque. Cenário real: durante
  // férias bloqueadas, a dona toca na área que diz "bloqueada" e abre, do
  // nada, o popover de um compromisso do Google invisível.
  const ghostComPopup = (): CalEvent => ({
    id: 'gh-pop',
    startsAtUtc: '2026-07-29T19:00:00Z', // 15:00 em Cuiabá
    endsAtUtc: '2026-07-29T20:00:00Z',
    title: 'Compromisso',
    color: 0,
    ghost: true,
    popup: h('p', null, 'detalhe'),
  })

  it('coberto pela hachura: o gatilho MORRE — sem botão no DOM, fundo inerte com pointer-events-none', async () => {
    // Prova de mutação (executada ao vivo, nas DUAS direções): sem o
    // rebaixamento (`coberto` fora do `fundo` do EventBlock) o botão volta e
    // este caso reprova; rebaixando TODO ghost-com-popup, o caso descoberto
    // abaixo reprova.
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [ghostComPopup(), BLOQUEIO] })
    expect(
      c.querySelector('button[title="Compromisso"]'),
      'gatilho clicável sob a hachura do bloqueio — botão invisível',
    ).toBeNull()
    const bloco = c.querySelector<HTMLElement>('[title="Compromisso"]')!
    expect(bloco, 'o ghost sumiu do DOM (o dado do title tem de sobreviver)').not.toBeNull()
    expect(bloco.tagName).toBe('DIV')
    expect(bloco.className).toContain('pointer-events-none')
    // e coberto ⇒ mudo (a cobertura do gatilho usa a MESMA conta do muting)
    expect(bloco.textContent).toBe('')
  })

  it('ghost-com-popup NÃO coberto continua um gatilho de verdade (o conserto não mata o caso legítimo)', async () => {
    // bloqueio DISJUNTO no mesmo dia (10:00–11:00 em Cuiabá): a mera presença
    // de um bloqueio não pode rebaixar o ghost fora da cobertura
    const tira: CalEvent = {
      id: 'bl-manha',
      startsAtUtc: '2026-07-29T14:00:00Z',
      endsAtUtc: '2026-07-29T15:00:00Z',
      title: 'bloqueada — reunião',
      color: 0,
      blocked: true,
    }
    const c = await montar({ view: 'dia', anchor: '2026-07-29', events: [ghostComPopup(), tira] })
    const gatilho = c.querySelector<HTMLElement>('button[title="Compromisso"]')
    expect(gatilho, 'o gatilho legítimo do ghost morreu junto').not.toBeNull()
    expect(gatilho!.className).not.toContain('pointer-events-none')
    expect(gatilho!.textContent).toContain('Compromisso')
  })
})

/* ========================================================================== */
/* 10. O painel ?novo=disponibilidade pela ÁRVORE REAL da página               */
/*     (rodada de correção, item 16: binding por ESTRUTURA, não string solta)  */
/* ========================================================================== */

interface ElementoDaArvore {
  type: unknown
  props: { children?: unknown } & Record<string, unknown>
}

function ehElemento(no: unknown): no is ElementoDaArvore {
  return typeof no === 'object' && no !== null && 'props' in no && 'type' in no
}

/** Todo elemento da árvore, em profundidade (server components ficam como
 *  elementos com `props.children` — dá para inspecionar sem renderizar). */
function* percorrer(no: unknown): Generator<ElementoDaArvore> {
  if (no == null || typeof no !== 'object') return
  if (Array.isArray(no)) {
    for (const filho of no) yield* percorrer(filho)
    return
  }
  if (!ehElemento(no)) return
  yield no
  yield* percorrer(no.props.children)
}

function textoDe(no: unknown): string {
  if (no == null || typeof no === 'boolean') return ''
  if (typeof no === 'string' || typeof no === 'number') return String(no)
  if (Array.isArray(no)) return no.map(textoDe).join('')
  return ehElemento(no) ? textoDe(no.props.children) : ''
}

const JANELA_SEG = janelaCrua({ id: 'w1', weekday: 1, start: '08:00:00', end: '12:00:00' })
const BLOQUEIO_AGO = blocoCru({
  id: 'b1',
  inicioUtc: '2026-08-01T04:00:00Z',
  fimUtc: '2026-08-11T04:00:00Z',
  snapshot: `2026-08-01 → 2026-08-10 ${CUIABA}`,
  note: 'férias',
})

function semearPainel() {
  semear({
    teachers: { data: [DONA, ANA] }, // Ana = idx 1 na cor, fuso de Nova York
    teacher_weekly_availability: { data: [JANELA_SEG] },
    teacher_availability_exceptions: { data: [BLOQUEIO_AGO] },
  })
}

/** A árvore que a página DEVOLVE (Server Component invocado direto) e, dela,
 *  o painel de disponibilidade — achado pela prop `titulo`, não por string na
 *  fonte. */
async function painelDaPagina(prof?: string) {
  const arvore: unknown = await AgendaPage({
    searchParams: Promise.resolve({ novo: 'disponibilidade', ...(prof ? { prof } : {}) }),
  })
  const painel = [...percorrer(arvore)].find(
    (el) => el.props.titulo === 'Disponibilidade e bloqueios',
  )
  if (!painel) throw new Error('o painel ?novo=disponibilidade sumiu da página')
  return { arvore, painel }
}

describe('A3 · binding form→action por estrutura', () => {
  it('cada um dos 4 forms do painel recebe a SUA action (trocar duas fica vermelho)', async () => {
    semearPainel()
    const { painel } = await painelDaPagina(ANA_ID)
    const forms = [...percorrer(painel.props.children)].filter((el) => el.type === 'form')
    expect(forms).toHaveLength(4)
    const formCom = (pred: (el: ElementoDaArvore) => boolean) =>
      forms.find((f) => [...percorrer(f)].some(pred))
    // remover JANELA: o form que carrega o hidden id da janela listada
    expect(formCom((el) => el.props.name === 'id' && el.props.value === 'w1')?.props.action).toBe(
      removeWeeklyAvailabilityAction,
    )
    // criar janela: o form do select de weekday
    expect(
      formCom((el) => el.type === 'select' && el.props.name === 'weekday')?.props.action,
    ).toBe(addWeeklyAvailabilityAction)
    // remover BLOQUEIO: o form com o hidden id do bloqueio listado
    expect(formCom((el) => el.props.name === 'id' && el.props.value === 'b1')?.props.action).toBe(
      removeTeacherBlockAction,
    )
    // criar bloqueio: o form do período (DateField name="from")
    expect(formCom((el) => el.props.name === 'from')?.props.action).toBe(addTeacherBlockAction)
  })

  it('a MESMA chave da camada: teacher_id viaja escondido da FILTRADA; nenhum select próprio', async () => {
    semearPainel()
    const { painel } = await painelDaPagina(ANA_ID)
    const els = [...percorrer(painel.props.children)]
    expect(els.some((el) => el.type === 'select' && el.props.name === 'teacher_id')).toBe(false)
    const escondidos = els.filter((el) => el.props.name === 'teacher_id')
    expect(escondidos).toHaveLength(2) // um por form de criação
    for (const h of escondidos) expect(h.props.value).toBe(ANA_ID)
  })

  it('o select de dia oferece os VALUES do banco: 1=segunda abre, 0=domingo fecha', async () => {
    semearPainel()
    const { painel } = await painelDaPagina(ANA_ID)
    const select = [...percorrer(painel.props.children)].find(
      (el) => el.type === 'select' && el.props.name === 'weekday',
    )!
    const opcoes = [...percorrer(select.props.children)].filter((el) => el.type === 'option')
    expect(opcoes.map((o) => [o.props.value, textoDe(o)])).toEqual([
      ['', 'Escolha…'],
      ['1', 'segunda'],
      ['2', 'terça'],
      ['3', 'quarta'],
      ['4', 'quinta'],
      ['5', 'sexta'],
      ['6', 'sábado'],
      ['0', 'domingo'],
    ])
  })

  it('sem professora filtrada: parágrafo no padrão do lote, sem nenhum form', async () => {
    semearPainel()
    const { painel } = await painelDaPagina()
    expect(textoDe(painel)).toContain('filtre por professora')
    expect([...percorrer(painel.props.children)].filter((el) => el.type === 'form')).toHaveLength(0)
  })

  it('a legenda tem as duas entradas da camada, e o swatch veste a cor da FILTRADA (item 9)', async () => {
    semearPainel()
    const { arvore } = await painelDaPagina(ANA_ID)
    const texto = textoDe(arvore)
    expect(texto).toContain('disponibilidade da professora')
    expect(texto).toContain('bloqueio — sem oferta')
    // Ana é idx 1: o swatch da disponibilidade usa o tint DELA — o --t0 fixo
    // mentia a cor da camada para qualquer professora de índice ≠ 0
    const swatch = [...percorrer(arvore)].find(
      (el) =>
        typeof el.props.className === 'string' &&
        el.props.className.includes('opacity-50') &&
        el.props.className.includes('-tint)'),
    )
    expect(swatch, 'o swatch da disponibilidade sumiu da legenda').toBeTruthy()
    expect(swatch!.props.className).toContain('--t1-tint')
    expect(swatch!.props.className).not.toContain('--t0-tint')
  })
})

describe('A3 · painel RENDERIZADO: quem, headings, nomes acessíveis e piso dos botões', () => {
  it('o cabeçalho diz QUEM está sendo editada — nome em destaque e fuso em CIDADE (itens 5 e 7)', async () => {
    semearPainel()
    const { painel } = await painelDaPagina(ANA_ID)
    const c = await montarNo(painel.props.children as ReactNode)
    expect(c.textContent).toContain('Teacher Ana')
    expect(c.textContent).toContain('Nova York')
    expect(c.textContent).not.toContain('America/New_York') // IANA cru é defeito
    const cabecalho = [...c.querySelectorAll('p')].find((p) => p.textContent?.includes('Teacher Ana'))!
    expect(cabecalho, 'o nome da professora sumiu do painel').toBeTruthy()
    // nome no piso de DADO: text-sm+ e tinta forte (não apoio apagado)
    expect(cabecalho.className).toContain('text-sm')
    expect(cabecalho.className).toContain('text-ink-900')
  })

  it('headings das seções descem UM degrau do título do painel: h3, sem h4 (item 12)', async () => {
    // o título do PainelDeUrl é o SheetTitle do kit — <h2> do Radix; h4 nas
    // seções pulava um nível dentro do diálogo
    semearPainel()
    const { painel } = await painelDaPagina(ANA_ID)
    const c = await montarNo(painel.props.children as ReactNode)
    expect([...c.querySelectorAll('h3')].map((t) => t.textContent)).toEqual([
      'Janelas semanais',
      'Bloqueios',
    ])
    expect(c.querySelectorAll('h4')).toHaveLength(0)
  })

  it('"Remover" tem nome acessível DISTINTIVO por linha (item 11 — role+name)', async () => {
    semearPainel()
    const { painel } = await painelDaPagina(ANA_ID)
    const c = await montarNo(painel.props.children as ReactNode)
    const nomes = [...c.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
    expect(nomes).toContain('Remover janela de segunda · 08:00–12:00')
    // a note entra no nome acessível (Sol · rodada 2): sem ela, dois bloqueios
    // de mesmas datas viravam o MESMO nome
    expect(nomes).toContain('Remover bloqueio 01/08/2026 → 10/08/2026 — férias')
  })

  it('dois bloqueios de MESMAS datas e notes distintas → dois nomes acessíveis DISTINTOS (rodada 2, item 3)', async () => {
    semear({
      teachers: { data: [DONA, ANA] },
      teacher_weekly_availability: { data: [JANELA_SEG] },
      teacher_availability_exceptions: {
        data: [
          BLOQUEIO_AGO, // note 'férias'
          blocoCru({
            id: 'b2',
            inicioUtc: '2026-08-01T04:00:00Z',
            fimUtc: '2026-08-11T04:00:00Z',
            snapshot: `2026-08-01 → 2026-08-10 ${CUIABA}`,
            note: 'congresso',
          }),
        ],
      },
    })
    const { painel } = await painelDaPagina(ANA_ID)
    const c = await montarNo(painel.props.children as ReactNode)
    const remover = [...c.querySelectorAll('button')]
      .map((b) => b.getAttribute('aria-label'))
      .filter((n): n is string => Boolean(n?.startsWith('Remover bloqueio')))
    expect(remover).toHaveLength(2)
    expect(remover).toContain('Remover bloqueio 01/08/2026 → 10/08/2026 — férias')
    expect(remover).toContain('Remover bloqueio 01/08/2026 → 10/08/2026 — congresso')
    expect(new Set(remover).size).toBe(2) // distintos de fato (role+name)
  })

  it('a note do bloqueio é DADO no piso LITERAL da régua: text-sm font-medium text-ink-900 (rodadas 2 e 3)', async () => {
    // é a note que distingue qual bloqueio remover quando as datas coincidem —
    // a rodada 3 reprovou o ink-600 (piso de RÓTULO) que a rodada 2 deixou
    semearPainel()
    const { painel } = await painelDaPagina(ANA_ID)
    const c = await montarNo(painel.props.children as ReactNode)
    const nota = [...c.querySelectorAll('p')].find((p) => p.textContent === 'férias')
    expect(nota, 'a note do bloqueio sumiu do painel').toBeTruthy()
    expect(nota!.className).toContain('text-sm')
    expect(nota!.className).toContain('font-medium')
    expect(nota!.className).toContain('text-ink-900')
    expect(nota!.className).not.toContain('text-ink-600')
    expect(nota!.className).not.toContain('text-xs')
    expect(nota!.className).not.toContain('text-ink-400')
  })

  it('os botões de criação da superfície A3 ficam no piso text-sm — nunca o !text-xs do btnInkSm (item 10)', async () => {
    semearPainel()
    const { painel } = await painelDaPagina(ANA_ID)
    const c = await montarNo(painel.props.children as ReactNode)
    const criar = [...c.querySelectorAll('button')].filter((b) =>
      /^Criar (janela semanal|bloqueio)$/.test(b.textContent ?? ''),
    )
    expect(criar).toHaveLength(2)
    for (const b of criar) {
      expect(b.className, b.textContent ?? '').toContain('text-sm')
      expect(b.className, b.textContent ?? '').not.toContain('text-xs')
    }
  })
})
