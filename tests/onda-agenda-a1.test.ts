// ONDA DA AGENDA · A1 — a fundação da seção.
//
// ⚠️ REESCRITO APÓS A RODADA 1 DO SOL. A primeira versão deste arquivo era
// quase toda VARREDURA DE CÓDIGO-FONTE, e o revisor apontou sete asserções
// vácuas — a pior delas contava ocorrências de `exigir(` e exigia ≥4, sem
// perceber que a própria DECLARAÇÃO da função conta: o teste passaria com uma
// leitura desprotegida, que é exatamente a regressão que ele deveria pegar.
//
// Agora a espinha é COMPORTAMENTAL: um cliente Supabase falso alimenta
// `getAgenda` com respostas escolhidas, o relógio é congelado, e o que se cobra
// é o que a função DEVOLVE. A varredura de fonte sobrou só onde ela é o
// instrumento certo (anatomia da tela, presença de primitivo), e sem fingir que
// prova comportamento.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PoteDeCookies } from './pote-de-cookies'
import { cookieDoRecado } from '@/lib/kit/recado'

import {
  VISAO_PADRAO,
  comMudanca,
  ehVisaoDaAgenda,
  enderecoDaAgenda,
  estadoDaQuery,
  primeiroValor,
  type EstadoDaAgenda,
} from '@/data/admin/agenda-endereco'

/* ========================================================================== */
/* Cliente Supabase falso                                                      */
/* ========================================================================== */

interface Resposta {
  data?: unknown
  error?: { message: string } | null
}

/**
 * Consulta encadeável que GRAVA cada chamada (método + args) por tabela.
 *
 * A gravação existe por causa da rodada 2 do Sol: sem ela, os testes de borda
 * provavam só o filtro EM MEMÓRIA — um `.lte()` reintroduzido na consulta ao
 * banco passaria em silêncio, porque o fake devolve tudo de qualquer jeito. Com
 * o registro, o contrato da consulta (fim exclusivo = `lt`) é verificável.
 */
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
  /** cada RPC chamada, com nome e args — o contrato da action do lote */
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

// `server-only` estoura fora de um bundle de servidor; nos testes ele é inerte.
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

// As dependências da action que o teste do lote NÃO exercita ficam inertes —
// o que se prova aqui é o contrato da chamada à RPC, não os efeitos vizinhos.
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
vi.mock('@/lib/google/sync', () => ({ syncTeacherCalendarSoon: () => {} }))
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
const { completeAllPendingAction } = await import('@/app/admin/agenda/actions')

const PROFESSORA = '11111111-1111-1111-1111-111111111111'
const DONA = { id: PROFESSORA, display_name: 'Teacher Vicky', is_owner: true, iana_tz: 'America/Cuiaba' }

/** Uma aula do banco, no formato cru que o PostgREST devolve. */
function aulaCrua(campos: {
  id: string
  inicio: string
  fim?: string | null
  state?: string
  aluno?: string
  tz?: string
}) {
  return {
    id: campos.id,
    starts_at_utc: campos.inicio,
    ends_at_utc: campos.fim ?? null,
    state: campos.state ?? 'scheduled',
    teacher_id: PROFESSORA,
    confirmed_at: null,
    // F5: o trio da avulsa entrou na projeção do dia (fixture de aula de contrato)
    single_kind: null,
    single_price_cents: null,
    single_paid_at: null,
    contracts: {
      // A5/L2: a projeção cresceu de novo — o `id` do contrato sobe para a tela
      // (é ele que o "duplicar" do popover usa). A régua da lição continua a
      // mesma: o fixture espelha a consulta REAL, campo a campo.
      id: 'c-fixture',
      plan_name: 'Mensal',
      students: { id: 'a1', display_name: campos.aluno ?? 'Elisa', iana_tz: campos.tz ?? 'America/Cuiaba' },
      student_groups: null,
    },
  }
}

function semear(aulas: unknown[], extras: Record<string, Resposta> = {}) {
  mock.respostas = {
    class_instances: { data: aulas },
    teachers: { data: [DONA] },
    reschedule_windows: { data: [] },
    contracts: { data: [] },
    ...extras,
  }
}

/** Cuiabá é UTC−4 o ano inteiro (Brasil não tem mais horário de verão), então
 *  14:00 local = 18:00Z. Os instantes dos testes usam essa conta explícita. */
const base = { visao: 'semana' as const, comJanelas: true }

beforeEach(() => {
  vi.useFakeTimers()
  mock.respostas = {}
  mock.chamadas = {}
  mock.rpcs = []
  mock.respostaRpc = { data: null, error: null }
})
afterEach(() => {
  vi.useRealTimers()
})

/* ========================================================================== */
/* 1. Leitura que falha ESTOURA — a promessa da camada                         */
/* ========================================================================== */

describe('A1 · falha de leitura nunca vira agenda vazia', () => {
  // O teste que o Sol pediu no lugar da contagem de `exigir(`: injetar erro em
  // CADA consulta e exigir rejeição. Uma leitura desprotegida a mais reprova
  // aqui, o que a contagem nunca faria.
  const consultas = ['class_instances', 'teachers', 'contracts'] as const

  it.each(consultas)('%s com erro faz getAgenda rejeitar', async (tabela) => {
    vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
    semear([], { [tabela]: { error: { message: 'connection refused' } } })
    await expect(getAgenda({ ...base })).rejects.toThrow(/Agenda: falha ao ler/)
  })

  // As DUAS consultas do A3 (Sol · rodada 1 do A3, item 14): elas só acontecem
  // com professora filtrada — e com erro injetado a camada não pode virar
  // "agenda sem janelas/bloqueios" em silêncio.
  const consultasDoA3 = ['teacher_weekly_availability', 'teacher_availability_exceptions'] as const

  it.each(consultasDoA3)('%s com erro faz getAgenda rejeitar (professora filtrada)', async (tabela) => {
    vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
    semear([], { [tabela]: { error: { message: 'connection refused' } } })
    await expect(getAgenda({ ...base, professora: PROFESSORA })).rejects.toThrow(
      /Agenda: falha ao ler/,
    )
  })

  it('a camada de horários com erro também rejeita (quando está LIGADA)', async () => {
    vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
    semear([], { reschedule_windows: { error: { message: 'timeout' } } })
    await expect(getAgenda({ ...base })).rejects.toThrow(/horários publicados/)
  })

  it('com a camada DESLIGADA a consulta nem acontece — e isso não é mentira', async () => {
    vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
    // Erro semeado na tabela, mas a camada está desligada: ninguém perguntou,
    // então não há falha a reportar e a tela abre normalmente.
    semear([], { reschedule_windows: { error: { message: 'timeout' } } })
    const agenda = await getAgenda({ ...base, comJanelas: false })
    expect(agenda.janelas).toEqual([])
  })

  it('estado de aula desconhecido ESTOURA em vez de virar "cancelada"', async () => {
    vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
    semear([aulaCrua({ id: 'x', inicio: '2026-07-28T18:00:00Z', state: 'pausada_por_contrato' })])
    // Degradar em silêncio mostraria a aula como CANCELADA na tela da dona.
    await expect(getAgenda({ ...base })).rejects.toThrow(/estado de aula desconhecido/)
  })
})

/* ========================================================================== */
/* 2. Tempo — o que o Sol chamou de "nenhum teste comportamental de tempo"     */
/* ========================================================================== */

describe('A1 · aula em andamento não é dívida', () => {
  it('às 14:01, a aula de 14:00–14:45 ainda está AGENDADA', async () => {
    // 14:01 em Cuiabá (UTC−4) = 18:01Z
    vi.setSystemTime(new Date('2026-07-28T18:01:00Z'))
    semear([
      aulaCrua({ id: 'em-curso', inicio: '2026-07-28T18:00:00Z', fim: '2026-07-28T18:45:00Z' }),
    ])
    const agenda = await getAgenda({ ...base, visao: 'dia', ancora: '2026-07-28' })
    expect(agenda.aulas[0].situacao).toBe('agendada')
    // …e por isso não oferece botão de desfecho na fila
    expect(agenda.pendencias).toHaveLength(0)
  })

  it('às 14:46, a mesma aula vira SEM REGISTRO', async () => {
    vi.setSystemTime(new Date('2026-07-28T18:46:00Z'))
    semear([
      aulaCrua({ id: 'terminou', inicio: '2026-07-28T18:00:00Z', fim: '2026-07-28T18:45:00Z' }),
    ])
    const agenda = await getAgenda({ ...base, visao: 'dia', ancora: '2026-07-28' })
    expect(agenda.aulas[0].situacao).toBe('sem_registro')
    expect(agenda.pendencias).toHaveLength(1)
    expect(agenda.pendencias[0].atraso).toBe('hoje')
  })

  it('sem `ends_at_utc` a casa assume 45 min — e respeita o mesmo corte', async () => {
    vi.setSystemTime(new Date('2026-07-28T18:30:00Z'))
    semear([aulaCrua({ id: 'sem-fim', inicio: '2026-07-28T18:00:00Z', fim: null })])
    const agenda = await getAgenda({ ...base, visao: 'dia', ancora: '2026-07-28' })
    expect(agenda.aulas[0].situacao).toBe('agendada')
  })

  it('no instante EXATO do fim (14:45:00) a aula já é dívida', async () => {
    // A borda do corte, pedida pelo Sol na rodada 2: `<=` significa que o
    // término em ponto já libera o registro — a professora acabou de fechar a
    // chamada e a dona pode atestar sem esperar um minuto arbitrário.
    vi.setSystemTime(new Date('2026-07-28T18:45:00Z'))
    semear([
      aulaCrua({ id: 'no-fim', inicio: '2026-07-28T18:00:00Z', fim: '2026-07-28T18:45:00Z' }),
    ])
    const agenda = await getAgenda({ ...base, visao: 'dia', ancora: '2026-07-28' })
    expect(agenda.aulas[0].situacao).toBe('sem_registro')
  })
})

describe('A1 · a fila de pendências não muda conforme para onde se olha', () => {
  it('o mesmo número na semana atual e navegando para um mês antigo', async () => {
    vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
    const aulas = [
      // dentro dos 60 dias: conta
      aulaCrua({ id: 'recente', inicio: '2026-07-20T18:00:00Z', fim: '2026-07-20T18:45:00Z' }),
      // 190 dias atrás: fora da janela da fila, mesmo estando no mês visitado
      aulaCrua({ id: 'antiga', inicio: '2026-01-20T18:00:00Z', fim: '2026-01-20T18:45:00Z' }),
    ]
    semear(aulas)
    const naSemana = await getAgenda({ ...base })
    semear(aulas)
    const emJaneiro = await getAgenda({ ...base, visao: 'mes', ancora: '2026-01-15' })

    // Era o achado 2: aqui dava 1 e 2. Um contador que muda conforme o mês que
    // ela está olhando não serve para operar.
    expect(naSemana.pendencias).toHaveLength(1)
    expect(emJaneiro.pendencias).toHaveLength(1)
    expect(emJaneiro.pendencias[0].id).toBe('recente')
  })
})

describe('A1 · bordas de intervalo', () => {
  it('a aula da meia-noite de segunda pertence a UMA semana só', async () => {
    vi.setSystemTime(new Date('2026-07-28T18:00:00Z')) // terça, 28/07
    // Segunda 03/08 às 00:00 Cuiabá = 04:00Z do dia 03
    const meiaNoite = aulaCrua({ id: 'virada', inicio: '2026-08-03T04:00:00Z', fim: '2026-08-03T04:45:00Z' })
    semear([meiaNoite])
    const semanaDela = await getAgenda({ ...base, ancora: '2026-08-03' })
    semear([meiaNoite])
    const semanaAnterior = await getAgenda({ ...base, ancora: '2026-07-28' })

    expect(semanaDela.aulas.map((a) => a.id)).toEqual(['virada'])
    // Com `lte` no fim exclusivo, ela aparecia nas DUAS — agenda parecendo
    // duplicada, e a dona operando no período errado.
    expect(semanaAnterior.aulas).toHaveLength(0)
  })

  it('"Próximos 14 dias" cobre 14 dias civis, não 15', async () => {
    vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
    // 15º dia civil a partir de hoje (28/07 + 14 = 11/08), às 10:00 Cuiabá
    semear([aulaCrua({ id: 'dia-15', inicio: '2026-08-11T14:00:00Z', fim: '2026-08-11T14:45:00Z' })])
    const agenda = await getAgenda({ ...base, visao: 'lista' })
    expect(agenda.porDia).toHaveLength(0)
  })

  it('a CONSULTA ao banco também usa fim exclusivo — não só o filtro em memória', async () => {
    // Rodada 2 do Sol: sem olhar as chamadas, um `.lte()` reintroduzido na
    // consulta passaria — o fake devolve tudo e o filtro em memória salvaria a
    // aparência. O contrato da consulta é parte do conserto do achado 7.
    vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
    semear([])
    await getAgenda({ ...base })
    const metodos = (mock.chamadas['class_instances'] ?? []).map(([nome]) => nome)
    expect(metodos).toContain('lt')
    expect(metodos).not.toContain('lte')
  })
})

describe('A1 · o fuso do aluno não se mistura com o do negócio', () => {
  it('a hora do aluno só aparece quando o fuso dele difere', async () => {
    vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
    semear([
      aulaCrua({ id: 'br', inicio: '2026-07-29T18:00:00Z', aluno: 'Elisa', tz: 'America/Cuiaba' }),
      aulaCrua({ id: 'pt', inicio: '2026-07-29T18:00:00Z', aluno: 'Gabriel', tz: 'Europe/Lisbon' }),
    ])
    const agenda = await getAgenda({ ...base, visao: 'dia', ancora: '2026-07-29' })
    const br = agenda.aulas.find((a) => a.id === 'br')!
    const pt = agenda.aulas.find((a) => a.id === 'pt')!
    expect(br.horaDoAluno).toBeNull()
    expect(pt.horaDoAluno).toBeTruthy()
    // a HORA da grade é sempre a do negócio (14:00 em Cuiabá), para os dois
    expect(br.hora).toBe('14:00')
    expect(pt.hora).toBe('14:00')
  })
})

describe('A1 · as opções de contrato aceitam a PROJEÇÃO da consulta', () => {
  it('contrato ativo com aluno só de display_name vira opção com rótulo', async () => {
    // Rodada 2, item 11 (grave), com o caso de regressão prometido: o
    // `ContratoSchema` reusava `AlunoDoEmbedSchema`, que exige `id` e
    // `iana_tz` — mas a consulta de opções seleciona SÓ `display_name`
    // (src/data/admin/agenda.ts). Com QUALQUER contrato particular ativo (ou
    // seja: sempre, em produção), o Zod reprovava e a Agenda inteira estourava
    // ao abrir. Este cenário alimenta a resposta com a projeção REAL da
    // consulta: se o schema voltar a exigir os campos que a consulta não
    // seleciona, o parse estoura e este caso fica vermelho.
    //
    // A4 (grave 3): a PROJEÇÃO cresceu — a consulta passou a pedir também o
    // `iana_tz` do aluno e os `recurring_slots` do contrato, porque é deles que
    // sai o fuso em que a RPC vai gravar a aula avulsa. A régua da lição
    // continua a mesma: o fixture espelha a consulta REAL, campo a campo.
    vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
    semear([], {
      contracts: {
        data: [
          {
            id: 'c1',
            plan_name: 'Mensal 8',
            students: { display_name: 'Elisa', iana_tz: 'America/Sao_Paulo' },
            student_groups: null,
            recurring_slots: [],
          },
        ],
      },
    })
    const agenda = await getAgenda({ ...base })
    expect(agenda.contratos).toEqual([
      {
        id: 'c1',
        rotulo: 'Elisa · Mensal 8 · São Paulo',
        ianaTz: 'America/Sao_Paulo',
        cidade: 'São Paulo',
      },
    ])
  })
})

describe('A1 · âncora inválida cai em hoje, como o contrato promete', () => {
  it('data civil inexistente não vira "Invalid DateTime"', async () => {
    vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
    semear([])
    // `2026-02-30` passa no regex de formato e é derrubada pelo Luxon.
    const agenda = await getAgenda({ ...base, visao: 'dia', ancora: '2026-02-30' })
    expect(agenda.ancora).toBe('2026-07-28')
    expect(agenda.rotulo).not.toContain('Invalid')
  })
})

/* ========================================================================== */
/* 3. Endereço (módulo puro)                                                   */
/* ========================================================================== */

const repouso: EstadoDaAgenda = { visao: VISAO_PADRAO, comJanelas: true }
const HOJE = '2026-07-28'

describe('A1 · endereço da agenda', () => {
  it('a tela em repouso é /admin/agenda limpo', () => {
    expect(enderecoDaAgenda(repouso, HOJE)).toBe('/admin/agenda')
    expect(enderecoDaAgenda({ ...repouso, ancora: HOJE }, HOJE)).toBe('/admin/agenda')
  })

  it('só viaja na URL o que difere do padrão', () => {
    expect(enderecoDaAgenda({ ...repouso, visao: 'mes' }, HOJE)).toBe('/admin/agenda?v=mes')
    expect(enderecoDaAgenda({ ...repouso, ancora: '2026-08-04' }, HOJE)).toBe('/admin/agenda?d=2026-08-04')
    expect(enderecoDaAgenda({ ...repouso, professora: 'p1' }, HOJE)).toBe('/admin/agenda?prof=p1')
    expect(enderecoDaAgenda({ ...repouso, comJanelas: false }, HOJE)).toBe('/admin/agenda?j=0')
  })

  it('o favorito da visão DIA guarda a data; o da semana continua móvel', () => {
    // Achado 15: `?v=dia` salvo hoje virava "amanhã" ao ser reaberto amanhã.
    expect(enderecoDaAgenda({ visao: 'dia', ancora: HOJE, comJanelas: true }, HOJE)).toBe(
      `/admin/agenda?v=dia&d=${HOJE}`,
    )
    // Na semana o comportamento móvel é o certo: "a agenda" abre na semana de
    // quem abriu.
    expect(enderecoDaAgenda({ visao: 'semana', ancora: HOJE, comJanelas: true }, HOJE)).toBe('/admin/agenda')
  })

  it('a camada de horários só existe nas visões de GRADE', () => {
    expect(enderecoDaAgenda({ visao: 'lista', comJanelas: false }, HOJE)).toBe('/admin/agenda?v=lista')
    expect(enderecoDaAgenda({ visao: 'pendencias', comJanelas: false }, HOJE)).toBe(
      '/admin/agenda?v=pendencias',
    )
    expect(enderecoDaAgenda({ visao: 'dia', comJanelas: false }, HOJE)).toContain('j=0')
  })

  it('a busca só acompanha a visão que a usa', () => {
    expect(enderecoDaAgenda({ visao: 'lista', comJanelas: true, busca: 'elisa' }, HOJE)).toBe(
      '/admin/agenda?v=lista&q=elisa',
    )
    expect(enderecoDaAgenda({ visao: 'semana', comJanelas: true, busca: 'elisa' }, HOJE)).toBe('/admin/agenda')
  })

  it('parâmetro REPETIDO não derruba a página', () => {
    // Achado 14: `?q=a&q=b` chega como array e `sp.q?.trim()` lançava TypeError;
    // `prof` repetido virava filtro-array e esvaziava a agenda.
    expect(primeiroValor(['a', 'b'])).toBe('a')
    expect(primeiroValor(undefined)).toBeUndefined()
    const e = estadoDaQuery({ q: ['elisa', 'gabriel'], prof: ['p1', 'p2'], v: ['lista'] })
    expect(e.busca).toBe('elisa')
    expect(e.professora).toBe('p1')
    expect(e.visao).toBe('lista')
  })

  it('a query volta ao estado, com os padrões da seção', () => {
    expect(estadoDaQuery({})).toEqual({
      visao: VISAO_PADRAO,
      ancora: undefined,
      professora: undefined,
      comJanelas: true,
      busca: undefined,
    })
    expect(estadoDaQuery({ j: '0' }).comJanelas).toBe(false)
    expect(estadoDaQuery({ j: '1' }).comJanelas).toBe(true)
    expect(estadoDaQuery({ v: 'galáxia' }).visao).toBe(VISAO_PADRAO)
    expect(estadoDaQuery({ d: '28/07/2026' }).ancora).toBeUndefined()
  })

  it('comMudanca troca UMA dimensão e preserva as outras', () => {
    const estado: EstadoDaAgenda = { visao: 'dia', ancora: '2026-08-10', professora: 'p1', comJanelas: false }
    const outra = comMudanca(estado, { visao: 'mes' }, HOJE)
    expect(outra).toContain('v=mes')
    expect(outra).toContain('prof=p1')
    expect(outra).toContain('d=2026-08-10')
    expect(outra).toContain('j=0')
  })

  it('ehVisaoDaAgenda aceita as quatro visões e pendências, e só elas', () => {
    for (const v of ['dia', 'semana', 'mes', 'lista', 'pendencias']) expect(ehVisaoDaAgenda(v)).toBe(true)
    for (const v of ['periodo', 'ano', '', undefined]) expect(ehVisaoDaAgenda(v)).toBe(false)
  })
})

/* ========================================================================== */
/* 4. Varredura de fonte — só onde ela é o instrumento certo                    */
/* ========================================================================== */

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const PAGINA = 'src/app/admin/agenda/page.tsx'
const BARRA = 'src/components/admin/agenda/BarraDaAgenda.tsx'

describe('A1 · anatomia da tela', () => {
  it('a tela nasce no card-contêiner com as três abas', () => {
    const fonte = codigo(PAGINA)
    expect(fonte).toContain('<CardPanel>')
    expect(fonte).toContain('<CardPanelTabs')
    for (const aba of ["label: 'Agenda'", "label: 'Pendências'", "label: 'Período'"]) {
      expect(fonte, aba).toContain(aba)
    }
    expect(fonte).toContain('count: agenda.pendencias.length')
  })

  it('a toolbar é bipartida: criar à esquerda, ver à direita', () => {
    const fonte = codigo(BARRA)
    const esquerda = fonte.indexOf('<SplitButton')
    const direita = fonte.indexOf('Filtrar por professora')
    expect(esquerda).toBeGreaterThan(0)
    expect(direita).toBeGreaterThan(esquerda)
    for (const opcao of [
      'Aula avulsa',
      'Aula experimental',
      'Horário aberto',
      'Período ou férias',
      'Disponibilidade e bloqueios', // A3
    ]) {
      expect(fonte, opcao).toContain(opcao)
    }
  })

  it('a página não faz query nenhuma', () => {
    // Fronteira, não comportamento: a única porta de leitura do nosso banco é
    // `getAgenda`. (`createAdminClient` sobrevive pelo "ocupada" do Google, que
    // é fail-open e não é leitura nossa.)
    const fonte = codigo(PAGINA)
    expect(fonte).toContain('getAgenda(')
    expect(fonte).not.toMatch(/\.from\(['"]/)
    expect(fonte).not.toContain('createClient()')
  })

  it('nenhuma data ISO crua chega à tela', () => {
    // Regressão que EU introduzi no A1 e o `formatarDiaCurto` desfez: o popup
    // do slot passou a escrever "2026-08-04 às 14:00" para a dona.
    const fonte = codigo(PAGINA)
    expect(fonte).not.toMatch(/Publicar horário — \{iso\}/)
    expect(fonte).toContain('formatarDiaCurto(iso)')
  })

  it('a tela manda para o lote os IDs que ela mesma mostrou', () => {
    // Rodada 3: sem os IDs na tela, a RPC voltaria a decidir o conjunto por
    // `now()` no submit — o comportamento da corrida. O contrato da action é
    // provado adiante; aqui se prova que a PÁGINA alimenta esse contrato com a
    // própria fila que renderizou.
    // Portão de deploy 29/07: os IDs continuam vindo da fila renderizada, mas
    // já FILTRADOS pelo que pode concluir (`doLote`) — a prova comportamental
    // dessa separação está em `tests/portao-deploy-agenda.test.ts`.
    const fonte = codigo(PAGINA)
    expect(fonte).toContain("instance_ids: doLote.map((r) => r.id).join(',')")
  })

  it('a remarcação só promete o aviso quando ele foi REGISTRADO para envio', () => {
    // Achado 4 (grave): a tela afirmava "o aluno recebe a confirmação" mesmo
    // com o enfileiramento falhando em silêncio.
    //
    // A5/L5 (Sol · rodada 2): a variável chamava `avisado` o que só foi
    // ENFILEIRADO, e a frase de sucesso repetia a promessa ("o aluno recebe a
    // confirmação"). Registrar não é enviar, e enviar não é entregar — o nome e a
    // frase passaram a dizer o que o sistema garante.
    const acoes = codigo('src/app/admin/agenda/actions.ts')
    expect(acoes).toContain('recadoDaRemarcacao(registrado)')
    expect(acoes).not.toContain('recadoDaRemarcacao(avisado)')
    expect(acoes).toContain('NÃO foi registrado para envio')
    expect(acoes).not.toContain('O aluno recebe a confirmação')
    expect(acoes).not.toMatch(/redirect\(`\/admin\/agenda\?msg=\$\{encodeURIComponent\('Aula remarcada\./)
  })

  it('os links salvos da tela velha continuam chegando COM o contexto', () => {
    // Achado 1: os redirects iam para URL constante e jogavam fora visão,
    // data, professora e prefill.
    const fonte = codigo(PAGINA)
    expect(fonte).toContain("p.set('novo', qualLegado)")
    for (const chave of ["['v'", "['d'", "['prof'", "['j'", "['q'", "['nd'", "['nt'"]) {
      expect(fonte, chave).toContain(chave)
    }
  })
})

/* ========================================================================== */
/* 5. A action do lote — o conjunto confirmado é o conjunto atestado           */
/* ========================================================================== */

function formDoLote(campos: Record<string, string>) {
  const fd = new FormData()
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor)
  return fd
}

/**
 * A frase do lote — no cookie da seção desde o A7 (transporte único da Agenda).
 * A URL leva só a geometria da tela.
 */
function fraseDoLote(url: string): string {
  expect(url, 'a frase voltou para a barra de endereços (A7)').not.toContain('msg=')
  const cru = pote.get(cookieDoRecado('agenda'))?.value
  if (!cru) throw new Error('o lote não gravou recado nenhum no cookie da seção')
  return (JSON.parse(cru) as { mensagem: string }).mensagem
}

/** Roda a action e devolve a URL do redirect (que no Next é um throw). */
async function rodarLote(fd: FormData): Promise<string> {
  try {
    await completeAllPendingAction(fd)
  } catch (e) {
    if (e instanceof Redirecionou) return e.url
    throw e
  }
  throw new Error('a action deveria ter redirecionado')
}

describe('A1 · o lote viaja com os IDs exatos que a tela confirmou', () => {
  // Rodada 3 do Sol (grave, dinheiro): a fila congela o "agora" no render, mas
  // a RPC recalculava `now()` no submit — aula que terminasse nesse intervalo
  // entrava no lote sem ter sido confirmada pela dona. Agora a action repassa
  // os IDs da fila e o banco valida um a um (all-or-nothing).
  it('chama a RPC com p_teacher E p_instances', async () => {
    mock.respostaRpc = { data: 2 }
    const url = await rodarLote(
      formDoLote({
        teacher_id: PROFESSORA,
        instance_ids: ' aula-1, aula-2 ,',
        back: '/admin/agenda?v=pendencias',
      }),
    )
    expect(mock.rpcs).toEqual([
      ['admin_complete_past_batch', { p_teacher: PROFESSORA, p_instances: ['aula-1', 'aula-2'] }],
    ])
    expect(url).toBe('/admin/agenda?v=pendencias')
    expect(fraseDoLote(url)).toContain('2 aulas registradas')
  })

  it('ID duplicado no envio chega à RPC como UM (Sol · rodada 4)', async () => {
    // A tela nunca manda repetido, mas a action é endpoint: envio forjado com
    // duplicata não pode deformar a auditoria do lote. O banco também dedupa;
    // aqui é a antecipação.
    mock.respostaRpc = { data: 1 }
    await rodarLote(
      formDoLote({
        teacher_id: PROFESSORA,
        instance_ids: 'aula-1,aula-1,aula-1',
        back: '/admin/agenda',
      }),
    )
    expect(mock.rpcs).toEqual([
      ['admin_complete_past_batch', { p_teacher: PROFESSORA, p_instances: ['aula-1'] }],
    ])
  })

  it('sem professora, a RPC NEM é chamada (achado 16 continua valendo)', async () => {
    const url = await rodarLote(formDoLote({ instance_ids: 'aula-1', back: '/admin/agenda' }))
    expect(mock.rpcs).toHaveLength(0)
    expect(fraseDoLote(url)).toContain('professora')
  })

  it('sem IDs, a RPC NEM é chamada — o recado manda recarregar a fila', async () => {
    const url = await rodarLote(
      formDoLote({ teacher_id: PROFESSORA, instance_ids: ' , ', back: '/admin/agenda' }),
    )
    expect(mock.rpcs).toHaveLength(0)
    expect(fraseDoLote(url)).toContain('recarregue as pendências')
  })
})

describe('A1 · o primitivo que torna a proibição cumprível', () => {
  it('o kit ganhou o popover do Radix', () => {
    const fonte = corpo('src/components/kit/popover.tsx')
    expect(fonte).toContain("'use client'")
    expect(fonte).toContain('@radix-ui/react-popover')
    expect(fonte).toContain('collisionPadding')
    expect(fonte).toContain('radix-popover-content-transform-origin')
  })

  it('o painel por URL virou peça do KIT', () => {
    expect(() => corpo('src/components/kit/painel-de-url.tsx')).not.toThrow()
    expect(codigo(PAGINA)).toContain("from '@/components/kit/painel-de-url'")
  })
})
