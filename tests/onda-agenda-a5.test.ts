// ONDA DA AGENDA · A5 — lotes L1 (recado por cookie vira peça do kit) e L2
// (camada de dados: histórico da aula + `contractId`).
//
// Na ordem do risco:
//
//   1. A PEÇA DO KIT parametrizada por seção. O que se cobra é que a SEÇÃO
//      decida o nome do cookie E o `path` estreito — errar isso produz um
//      cookie que a página nunca recebe, e a dona fica sem recado em silêncio.
//      Mais: cookie ilegível vira `null` (nunca exceção), `id` novo por recado,
//      e o porteiro do `back` (que chega de endpoint público) devolvendo a casa
//      da seção quando o destino é forjado.
//   2. A HIGIENIZAÇÃO do `back`. Na Agenda o `back` de hoje carrega `?msg=&n=`
//      (a ponte de convivência das telas velhas): sem tirar os dois, a tela
//      pintaria DOIS recados — o do cookie e o da ponte. E query já limpa volta
//      BYTE A BYTE como veio, porque reescrever endereço certo é regressão.
//   3. O RAMO `diff->>rescheduled_from`, AO VIVO contra o Postgres local. O
//      registro da remarcação mora no id NOVO, então a aula de ORIGEM não tem
//      log do próprio remanejo — sem esse ramo o histórico dela abre vazio.
//      Aqui a remarcação acontece pela RPC de verdade e o histórico é lido pela
//      função de produção.
//   4. A WHITELIST. `diff` nunca vai cru para a tela: `courtesy_note` (texto
//      livre sobre a vida de alguém) e `min_notice_hours` (contexto que a RPC
//      NÃO usa para decidir crédito — a frase falsa que o A5 veio consertar)
//      ficam fora, e a varredura cobra isso no valor DEVOLVIDO, não na fonte.
//   5. O DINHEIRO lido da trilha, nunca deduzido: falta da professora com
//      `refund_blocked` não afirma crédito.
//   6. O LOTE: 100 ids (o pior caso da fila de pendências) viram 3 consultas,
//      não 100 — e atravessam o PostgREST de verdade.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { Sql } from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createInstance, createPrivateContract } from './helpers/db'
import {
  corpoDaFuncao,
  definicaoDaFuncao,
  migrations,
  quemDefine,
  sqlDaMigration,
} from './helpers/definicao-da-funcao'
import { PoteDeCookies } from './pote-de-cookies'

/* ========================================================================== */
/* Cliente Supabase falso (padrão do a1/a3: grava método + args por tabela)     */
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
  not(...a: unknown[]) { return this.marca('not', a) }
  in(...a: unknown[]) { return this.marca('in', a) }
  gt(...a: unknown[]) { return this.marca('gt', a) }
  gte(...a: unknown[]) { return this.marca('gte', a) }
  lt(...a: unknown[]) { return this.marca('lt', a) }
  lte(...a: unknown[]) { return this.marca('lte', a) }
  or(...a: unknown[]) { return this.marca('or', a) }
  order(...a: unknown[]) { return this.marca('order', a) }
  // L3: a leitura da trilha depois do ato termina em `.limit(1).single()`
  limit(...a: unknown[]) { return this.marca('limit', a) }
  single(...a: unknown[]) { return this.marca('single', a) }
  then<A, B>(ok: (v: { data: unknown; error: unknown }) => A, falha?: (e: unknown) => B) {
    return Promise.resolve({
      data: this.resposta.data ?? [],
      error: this.resposta.error ?? null,
    }).then(ok, falha)
  }
}

const mock = vi.hoisted(() => ({
  respostas: {} as Record<string, Resposta>,
  /** fila de respostas POR CHAMADA de uma tabela (o histórico consulta em lote) */
  fila: {} as Record<string, Resposta[]>,
  chamadas: {} as Record<string, Array<[string, ...unknown[]]>>,
  /** L3: as RPCs chamadas, na ordem, com os argumentos exatos */
  rpcs: [] as Array<[string, unknown]>,
  /** resposta por nome de RPC (ausente = sucesso silencioso) */
  respostasRpc: {} as Record<string, Resposta>,
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
      const daFila = mock.fila[tabela]?.shift()
      return new ConsultaFalsa(daFila ?? mock.respostas[tabela] ?? { data: [] }, (c) =>
        mock.chamadas[tabela].push(c),
      )
    },
    rpc: async (fn: string, args: unknown) => {
      mock.rpcs.push([fn, args])
      const r = mock.respostasRpc[fn] ?? {}
      return { data: r.data ?? null, error: r.error ?? null }
    },
  }),
}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirecionou(url)
  },
}))
// Os módulos que `agenda/actions.ts` puxa e que não são o assunto deste lote.
vi.mock('@/lib/auth/admin', () => ({ requireAdminId: async () => 'admin-de-teste' }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/email/notify', () => ({ sendRescheduleEmails: async () => {} }))
vi.mock('@/lib/email/send', () => ({
  sendEmail: async () => {},
  sendEmailWithOutcome: async () => {},
}))
vi.mock('@/lib/google/sync', () => ({
  syncTeacherCalendarSoon: () => {},
  googleBusyForTeacher: async () => ({ status: 'indisponivel' as const }),
}))
vi.mock('@/lib/notify/evolution', () => ({
  evolutionChannel: () => ({}),
  evolutionConfigFromEnv: () => ({}),
}))
vi.mock('@/lib/outbox/dispatch', () => ({ dispatchOutbox: async () => {} }))

const { cookies } = await import('next/headers')

const {
  PONTE_LEGADA,
  RECADO_MAX_AGE_S,
  casaDaSecao,
  cookieDoRecado,
  destinoDaSecao,
  destinoDoRecado,
  gravarRecado,
  lerRecado,
} = await import('@/lib/kit/recado')

const { getAgenda, historicoDaAula } = await import('@/data/admin/agenda')

const { registrarDesfechoDaAulaAction } = await import('@/app/admin/agenda/actions')
const {
  AVISO_DA_HORA,
  CONFIRMAR,
  CONSEQUENCIA,
  DECLARACAO_DO_ESTADO,
  DESFECHOS,
  REGRA_DA_CASA_DO_FIM,
  ROTULO,
  ehCancelamento,
  ehDesfecho,
  opcoesDaSituacao,
  pedidoPor,
} = await import('@/lib/admin/desfecho-da-aula')
const { chaveDoDesfecho, RASCUNHO_COOKIE } = await import('@/lib/admin/chaves-de-rascunho')
const { tomDoAviso } = await import('@/lib/kit/tom-do-aviso')

let pote: PoteDeCookies
beforeEach(() => {
  pote = new PoteDeCookies()
  vi.mocked(cookies).mockResolvedValue(pote as never)
  mock.respostas = {}
  mock.fila = {}
  mock.chamadas = {}
  mock.rpcs = []
  mock.respostasRpc = {}
})

/* ========================================================================== */
/* 1. L1 · a peça do kit, parametrizada por SEÇÃO                              */
/* ========================================================================== */

describe('A5/L1 · o recado é por SEÇÃO: nome do cookie e path estreito', () => {
  it('cada seção tem cookie e caminho próprios', () => {
    expect(cookieDoRecado('ajustes')).toBe('recado_ajustes')
    expect(cookieDoRecado('agenda')).toBe('recado_agenda')
    expect(casaDaSecao('ajustes')).toBe('/admin/ajustes')
    expect(casaDaSecao('agenda')).toBe('/admin/agenda')
  })

  it('gravar em Ajustes escreve exatamente o cookie de HOJE (nome, path, vida, flags)', async () => {
    await gravarRecado('ajustes', 'Política da professora atualizada.')
    const e = pote.escritas.findLast((x) => x.nome === 'recado_ajustes')!
    expect(e.opcoes.path).toBe('/admin/ajustes')
    expect(e.opcoes.maxAge).toBe(15)
    expect(RECADO_MAX_AGE_S).toBe(15)
    expect(e.opcoes.httpOnly).toBe(true)
    expect(e.opcoes.sameSite).toBe('lax')
    // `Secure` por env EXPLÍCITA, nunca por NODE_ENV
    expect(e.opcoes.secure).toBe(process.env.COOKIE_SECURE === 'true')
  })

  it('o recado de uma seção NÃO é lido pela outra — os potes são separados', async () => {
    await gravarRecado('agenda', 'Aula cancelada.')
    const daAgenda = pote.escritas.findLast((x) => x.nome === 'recado_agenda')!
    expect(daAgenda.opcoes.path).toBe('/admin/agenda')
    expect(await lerRecado('agenda')).toMatchObject({ mensagem: 'Aula cancelada.' })
    // O navegador nem enviaria o cookie da Agenda em /admin/ajustes; aqui a
    // prova é de CHAVE: a leitura de Ajustes não encontra o pote da Agenda.
    expect(await lerRecado('ajustes')).toBeNull()
  })

  it('cada recado leva um `id` próprio — duas frases iguais são dois avisos', async () => {
    await gravarRecado('agenda', 'Aula cancelada.')
    const primeiro = (await lerRecado('agenda'))!.id
    await gravarRecado('agenda', 'Aula cancelada.')
    const segundo = (await lerRecado('agenda'))!.id
    expect(primeiro).not.toBe(segundo)
    expect(primeiro).toBeTruthy()
  })

  it('ler NÃO consome: a mesma escrita lida duas vezes continua sendo um só aviso', async () => {
    await gravarRecado('ajustes', 'Política da professora atualizada.')
    const a = await lerRecado('ajustes')
    const b = await lerRecado('ajustes')
    expect(a).toEqual(b)
    expect(pote.apagados).toHaveLength(0)
  })
})

describe('A5/L1 · cookie ilegível vira null, nunca exceção', () => {
  // Um cookie truncado ou forjado não pode derrubar a tela inteira.
  const lixos: Array<[string, string]> = [
    ['JSON truncado', '{"mensagem":"Aula can'],
    ['não é JSON', 'nada disso'],
    ['JSON escalar', '"só uma string"'],
    ['JSON nulo', 'null'],
    ['array em vez de objeto', '[]'],
    ['sem `id`', '{"mensagem":"Aula cancelada."}'],
    ['sem `mensagem`', '{"id":"abc"}'],
    ['mensagem vazia', '{"mensagem":"","id":"abc"}'],
    ['id vazio', '{"mensagem":"Aula cancelada.","id":""}'],
    ['mensagem não-texto', '{"mensagem":42,"id":"abc"}'],
  ]
  for (const [nome, cru] of lixos) {
    it(`${nome} → null`, async () => {
      pote.set('recado_agenda', cru)
      await expect(lerRecado('agenda')).resolves.toBeNull()
    })
  }

  it('cookie ausente → null', async () => {
    await expect(lerRecado('agenda')).resolves.toBeNull()
  })
})

describe('A5/L1 · o porteiro do `back` (que chega de endpoint público)', () => {
  const forjados = [
    '/portal',
    'https://evil.example/admin/agenda',
    '//evil.example',
    '/admin/ajustes', // outra seção: fora do path do cookie da Agenda
    '/admin/agenda-antiga', // começa com a casa e MESMO ASSIM está fora dela
    '/admin/agendax?visao=semana',
    '',
  ]
  for (const cru of forjados) {
    it(`destino forjado ${JSON.stringify(cru)} cai na casa da seção`, () => {
      expect(destinoDaSecao('agenda', cru)).toBe('/admin/agenda')
      expect(destinoDoRecado('agenda', cru)).toBe('/admin/agenda')
    })
  }

  it('destino DENTRO da seção passa intacto', () => {
    expect(destinoDaSecao('agenda', '/admin/agenda')).toBe('/admin/agenda')
    expect(destinoDaSecao('agenda', '/admin/agenda?visao=semana')).toBe('/admin/agenda?visao=semana')
    expect(destinoDaSecao('agenda', '/admin/agenda/periodo')).toBe('/admin/agenda/periodo')
    expect(destinoDaSecao('ajustes', '/admin/ajustes?bloco=politica')).toBe(
      '/admin/ajustes?bloco=politica',
    )
  })
})

describe('A5/L1 · higienização do `back`: a ponte legada sai, a geometria fica', () => {
  it('`msg` e `n` saem; os demais parâmetros ficam, na ordem em que estavam', () => {
    expect(
      destinoDoRecado(
        'agenda',
        '/admin/agenda?visao=semana&msg=Aula%20cancelada.&ancora=2026-08-03&n=1753838400000&professora=abc',
      ),
    ).toBe('/admin/agenda?visao=semana&ancora=2026-08-03&professora=abc')
  })

  it('a ponte inteira sai e o endereço fica SEM query', () => {
    expect(destinoDoRecado('agenda', '/admin/agenda?msg=oi&n=1')).toBe('/admin/agenda')
  })

  it('só `msg`, só `n` — cada um sai sozinho', () => {
    expect(destinoDoRecado('agenda', '/admin/agenda?msg=oi&visao=dia')).toBe(
      '/admin/agenda?visao=dia',
    )
    expect(destinoDoRecado('agenda', '/admin/agenda?n=9&visao=dia')).toBe('/admin/agenda?visao=dia')
  })

  it('SEM ponte, o endereço volta BYTE A BYTE — nada de reescrever URL certa', () => {
    // É o caso de Ajustes hoje, e é o que garante que a higienização não muda
    // nenhuma URL que aquela tela já produz.
    const intactos = [
      '/admin/ajustes',
      '/admin/ajustes?bloco=politica',
      '/admin/agenda?visao=semana&ancora=2026-08-03',
      // valores que um `URLSearchParams` reescreveria se passassem por ele
      '/admin/agenda?busca=a+b',
      '/admin/agenda?q=%C3%A1gua',
      '/admin/agenda?vazio=',
      '/admin/agenda?flag',
    ]
    for (const url of intactos) {
      const secao = url.startsWith('/admin/ajustes') ? 'ajustes' : 'agenda'
      expect(destinoDoRecado(secao, url), url).toBe(url)
    }
  })

  it('a ponte legada é EXATAMENTE `msg` e `n` — a lista é da peça, não copiada', () => {
    expect([...PONTE_LEGADA]).toEqual(['msg', 'n'])
  })

  it('endereço forjado COM ponte: o porteiro vem antes da higiene', () => {
    expect(destinoDoRecado('agenda', 'https://evil.example/admin/agenda?msg=oi')).toBe(
      '/admin/agenda',
    )
  })
})

/* ========================================================================== */
/* 2. L2 · a forma da CONSULTA do histórico (cliente falso)                    */
/* ========================================================================== */

/** Uma linha crua de `audit_log`, na projeção da consulta. */
function linhaCrua(campos: {
  id: number
  action: string
  entity_id?: string | null
  diff?: Record<string, unknown> | null
  at?: string
}) {
  return {
    id: campos.id,
    action: campos.action,
    entity_id: campos.entity_id ?? null,
    diff: campos.diff ?? null,
    at: campos.at ?? '2026-07-29T18:32:00+00:00',
  }
}

const AULA = 'aaaaaaaa-0000-0000-0000-000000000001'
const NOVA = 'aaaaaaaa-0000-0000-0000-000000000002'

const chamadasDoAudit = () => mock.chamadas.audit_log ?? []
const argsDe = (metodo: string) =>
  chamadasDoAudit()
    .filter((c) => c[0] === metodo)
    .map((c) => c.slice(1))

describe('A5/L2 · a consulta do histórico: uma por LOTE, nunca uma por aula', () => {
  it('a forma exata: entity fixo, trigger genérico FORA, os dois ramos no `or`, ordem por id', async () => {
    mock.respostas.audit_log = { data: [] }
    await historicoDaAula([AULA, NOVA])

    expect(argsDe('eq')).toEqual([['entity', 'class_instances']])
    // ALLOWLIST na CONSULTA (Sol · rodada 1 do A5, médio 2): entra só o que este
    // módulo sabe nomear — o trigger genérico (que grava a LINHA INTEIRA em
    // `diff.new`) fica fora por não estar na lista, e uma RPC nova que passe a
    // gravar na trilha também. A lista negra de antes deixava tudo entrar por
    // omissão.
    expect(argsDe('not')).toEqual([])
    const [[coluna, acoes]] = argsDe('in') as [[string, string[]]]
    expect(coluna).toBe('action')
    expect([...acoes].sort()).toEqual(
      [
        'admin_create_single_class',
        'admin_create_trial_class',
        'cancel_class',
        'complete_class',
        'confirm_class',
        'no_show_student',
        'no_show_teacher',
        'reschedule_class',
      ].sort(),
    )
    for (const generica of ['insert', 'update', 'delete']) expect(acoes).not.toContain(generica)
    // Os dois ramos: o log da remarcação mora no id NOVO, então a aula de
    // origem só é alcançada por `diff->>rescheduled_from`.
    expect(argsDe('or')).toEqual([
      [`entity_id.in.(${AULA},${NOVA}),diff->>rescheduled_from.in.(${AULA},${NOVA})`],
    ])
    expect(argsDe('order')).toEqual([['id']])
    // e o `diff` cru NÃO é pedido por inteiro sem projeção declarada
    expect(argsDe('select')).toEqual([['id, action, entity_id, diff, at']])
  })

  it('lista vazia não consulta o banco', async () => {
    await expect(historicoDaAula([])).resolves.toEqual({})
    expect(chamadasDoAudit()).toHaveLength(0)
  })

  it('ids repetidos e em branco são descartados antes da consulta', async () => {
    mock.respostas.audit_log = { data: [] }
    await historicoDaAula([AULA, AULA, '', '   ', NOVA])
    expect(argsDe('or')).toEqual([
      [`entity_id.in.(${AULA},${NOVA}),diff->>rescheduled_from.in.(${AULA},${NOVA})`],
    ])
  })

  it('100 aulas (pior caso da fila de pendências) → 3 consultas de no máximo 40', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `id-${String(i).padStart(3, '0')}`)
    mock.fila.audit_log = [{ data: [] }, { data: [] }, { data: [] }]
    await historicoDaAula(ids)

    const ors = argsDe('or').map((a) => String(a[0]))
    expect(ors).toHaveLength(3)
    const tamanhos = ors.map((s) => (s.match(/id-\d{3}/g) ?? []).length / 2)
    expect(tamanhos).toEqual([40, 40, 20])
    // nenhum bloco encosta no teto da linha de requisição
    for (const s of ors) expect(s.length).toBeLessThan(4000)
  })

  it('falha da consulta ESTOURA — nunca vira histórico vazio', async () => {
    mock.respostas.audit_log = { error: { message: 'boom' } }
    await expect(historicoDaAula([AULA])).rejects.toThrow(/histórico das aulas/)
  })
})

/* ========================================================================== */
/* 3. L2 · a WHITELIST e as frases (o valor DEVOLVIDO, não a fonte)            */
/* ========================================================================== */

describe('A5/L2 · `diff` nunca vai cru: whitelist de campo', () => {
  it('`courtesy_note` NÃO aparece em nenhuma frase — é texto livre sobre a vida de alguém', async () => {
    mock.respostas.audit_log = {
      data: [
        linhaCrua({
          id: 10,
          action: 'reschedule_class',
          entity_id: NOVA,
          diff: {
            rescheduled_from: AULA,
            courtesy_note: 'mãe internada no hospital',
            via: 'courtesy',
            old_starts_at_utc: '2026-07-31T23:00:00+00:00',
            new_starts_at_utc: '2026-08-07T22:00:00+00:00',
            contract_id: 'c-1',
            iana_tz: 'America/Cuiaba',
            period_ym: '2026-07',
            bypass_lead: false,
          },
        }),
      ],
    }
    const h = await historicoDaAula([AULA, NOVA])
    const tudo = JSON.stringify(h)
    expect(tudo).not.toContain('internada')
    expect(tudo).not.toContain('courtesy_note')
    // e nem o uuid do contrato, nem o fuso cru, nem o período do banco
    expect(tudo).not.toContain('c-1')
    expect(tudo).not.toContain('America/Cuiaba')
    expect(tudo).not.toContain('2026-07"')
  })

  it('`min_notice_hours` NÃO aparece: no `diff` ele é CONTEXTO, não a regra do crédito', async () => {
    // A frase falsa que o A5 veio consertar. `_cancel_class_core` não olha
    // antecedência nenhuma para decidir crédito — quem decide é `cancelled_by`
    // (ADR-018). Imprimir "24 h" ao lado de "sem crédito" recria a mentira.
    mock.respostas.audit_log = {
      data: [
        linhaCrua({
          id: 11,
          action: 'cancel_class',
          entity_id: AULA,
          diff: {
            cancelled_by: 'student',
            min_notice_hours: 24,
            credited: false,
            credit_born: false,
            refund_blocked: null,
            expires_on: null,
            via: 'self',
            starts_at_utc: '2026-08-01T23:00:00+00:00',
            notified_at: '2026-07-29T23:00:00+00:00',
          },
        }),
      ],
    }
    const h = await historicoDaAula([AULA])
    const frases = h[AULA].flatMap((e) => [e.titulo, e.porQuem ?? '', ...e.detalhes]).join(' | ')
    expect(frases).not.toMatch(/24/)
    expect(frases).not.toMatch(/antecedênc/i)
    expect(frases).not.toMatch(/prazo/i)
    // o que ele DIZ: quem pediu (a regra de verdade) e o desfecho do dinheiro
    expect(frases).toContain('quem pediu o cancelamento: o aluno')
    expect(frases).toContain('sem crédito de reposição')
    expect(h[AULA][0].porQuem).toBe('pelo próprio aluno, no portal')
    expect(h[AULA][0].titulo).toBe('Aula cancelada')
  })

  it('nenhum nome de ator é inventado: o histórico declara a PORTA e a hora', async () => {
    mock.respostas.audit_log = {
      data: [
        linhaCrua({ id: 12, action: 'cancel_class', entity_id: AULA, diff: { via: 'admin' } }),
        linhaCrua({ id: 13, action: 'complete_class', entity_id: AULA, diff: { from: 'scheduled', to: 'completed', batch: null } }),
      ],
    }
    const h = await historicoDaAula([AULA])
    expect(h[AULA].map((e) => e.porQuem)).toEqual(['pela escola', null])
    // `actor` nem é pedido na projeção — não há uuid de pessoa para virar nome
    expect(argsDe('select')[0][0]).not.toContain('actor')
  })

  it('o `via` da remarcação é OUTRO vocabulário — não vira porta', async () => {
    // `via` carrega dois vocabulários no banco: porta (admin/self/period) no
    // cancelamento e CUSTO (allowance/courtesy/makeup_credit) na remarcação.
    // Ler os dois como um só escreveria "cancelada pela alçada do mês".
    mock.respostas.audit_log = {
      data: [
        linhaCrua({
          id: 14,
          action: 'reschedule_class',
          entity_id: AULA,
          diff: { via: 'allowance', old_starts_at_utc: '2026-07-31T23:00:00+00:00' },
        }),
      ],
    }
    const h = await historicoDaAula([AULA])
    expect(h[AULA][0].porQuem).toBeNull()
    expect(h[AULA][0].detalhes).toContain('consumiu uma remarcação da alçada do mês')
  })

  it('remarcação pela própria professora (via teacher) diz que a escola moveu e nada saiu do aluno', async () => {
    // M2: `via = 'teacher'` é o school_move — sem alçada e sem crédito. Sem o
    // rótulo, a linha aparecia muda sobre o custo (gate da 118, 29/10/2026).
    mock.respostas.audit_log = {
      data: [
        linhaCrua({
          id: 16,
          action: 'reschedule_class',
          entity_id: AULA,
          diff: { via: 'teacher', school_move: true, old_starts_at_utc: '2026-07-31T23:00:00+00:00' },
        }),
      ],
    }
    const h = await historicoDaAula([AULA])
    expect(h[AULA][0].porQuem).toBeNull()
    expect(h[AULA][0].detalhes).toContain('a escola moveu a aula — nada consumido do aluno')
  })

  it('ação desconhecida não estoura a agenda e não inventa vocabulário', async () => {
    mock.respostas.audit_log = {
      data: [
        linhaCrua({ id: 15, action: 'rpc_que_ainda_nao_existe', entity_id: AULA, diff: { segredo: 'x' } }),
      ],
    }
    const h = await historicoDaAula([AULA])
    expect(h[AULA]).toHaveLength(1)
    expect(h[AULA][0].titulo).toBe('Outro registro na trilha de auditoria')
    expect(h[AULA][0].detalhes).toEqual([])
    expect(JSON.stringify(h)).not.toContain('rpc_que_ainda_nao_existe')
    expect(JSON.stringify(h)).not.toContain('segredo')
  })

  it('`diff` escalar REPROVA o parse — linha que não dá para ler não some em silêncio', async () => {
    mock.respostas.audit_log = { data: [{ id: 16, action: 'cancel_class', entity_id: AULA, diff: 'oops', at: '2026-07-29T18:32:00+00:00' }] }
    await expect(historicoDaAula([AULA])).rejects.toThrow()
  })
})

describe('A5/L2 · o dinheiro é LIDO da trilha, nunca deduzido da situação', () => {
  it('falta da professora com devolução BLOQUEADA não afirma que o aluno ganhou crédito', async () => {
    // `_mark_no_show` chama `_refund_for_credit_born_class`, que RETORNA SEM
    // CREDITAR quando o gasto não tem identidade. "O aluno ganhou um crédito"
    // aqui seria falso — e é erro de dinheiro.
    mock.respostas.audit_log = {
      data: [
        linhaCrua({
          id: 20,
          action: 'no_show_teacher',
          entity_id: AULA,
          diff: {
            credited: false,
            expires_on: null,
            refund_blocked: 'gasto sem identidade (anterior à F1) — crédito só via ajuste manual',
            starts_at_utc: '2026-07-29T18:00:00+00:00',
          },
        }),
      ],
    }
    const h = await historicoDaAula([AULA])
    const e = h[AULA][0]
    expect(e.titulo).toBe('Registrada como falta da professora')
    expect(e.detalhes).toContain('sem crédito de reposição')
    expect(e.detalhes.join(' ')).toContain('crédito não devolvido automaticamente')
    expect(e.detalhes.join(' ')).not.toContain('ganhou um crédito')
  })

  it('falta da professora que CREDITOU diz o crédito e a validade, em data de gente', async () => {
    mock.respostas.audit_log = {
      data: [
        linhaCrua({
          id: 21,
          action: 'no_show_teacher',
          entity_id: AULA,
          diff: { credited: true, expires_on: '2027-01-25', refund_blocked: null },
        }),
      ],
    }
    const h = await historicoDaAula([AULA])
    expect(h[AULA][0].detalhes).toEqual([
      'o aluno ganhou um crédito de reposição',
      'crédito válido até 25/01/2027',
    ])
    // data CIVIL não é deslocada de fuso (deslocar viraria o dia)
    expect(JSON.stringify(h)).not.toContain('2027-01-25')
  })
})

describe('A5/L2 · a remarcação vista dos DOIS lados', () => {
  const linhaDaRemarcacao = linhaCrua({
    id: 30,
    action: 'reschedule_class',
    entity_id: NOVA,
    diff: {
      rescheduled_from: AULA,
      via: 'makeup_credit',
      old_starts_at_utc: '2026-07-31T23:00:00+00:00',
      new_starts_at_utc: '2026-08-07T22:00:00+00:00',
      courtesy_note: null,
    },
  })

  it('a MESMA linha vira dois eventos com frases diferentes (origem × nova)', async () => {
    mock.respostas.audit_log = { data: [linhaDaRemarcacao] }
    const h = await historicoDaAula([AULA, NOVA])

    expect(h[AULA]).toHaveLength(1)
    expect(h[AULA][0].titulo).toBe('Remarcada para outro horário')
    expect(h[AULA][0].detalhes[0]).toMatch(/^novo horário: /)

    expect(h[NOVA]).toHaveLength(1)
    expect(h[NOVA][0].titulo).toBe('Nasceu de uma remarcação')
    expect(h[NOVA][0].detalhes[0]).toMatch(/^horário anterior: /)

    // chaves de lista distintas (mesmo id da trilha, papéis diferentes)
    expect(h[AULA][0].chave).not.toBe(h[NOVA][0].chave)
  })

  it('só a aula de ORIGEM visível: o histórico dela existe mesmo sem log próprio', async () => {
    mock.respostas.audit_log = { data: [linhaDaRemarcacao] }
    const h = await historicoDaAula([AULA])
    expect(Object.keys(h)).toEqual([AULA])
    expect(h[AULA][0].titulo).toBe('Remarcada para outro horário')
  })

  it('o horário sai no fuso do NEGÓCIO, pronto (Lei 1 — a tela não formata data)', async () => {
    mock.respostas.audit_log = { data: [linhaDaRemarcacao] }
    const h = await historicoDaAula([AULA])
    // 2026-08-07T22:00Z = 18:00 em Cuiabá (UTC−4)
    // `sex.` com ponto é o `ccc` do pt-BR no Luxon — a MESMA grafia que o
    // `instanteDe` deste módulo já entrega ao resto da agenda.
    expect(h[AULA][0].detalhes[0]).toBe('novo horário: sex., 07/08 às 18:00')
    expect(h[AULA][0].quando).toBe('29/07/2026 às 14:32')
    expect(h[AULA][0].quandoIso).toBe('2026-07-29T18:32:00+00:00')
    // nada de ISO cru numa frase
    for (const d of h[AULA][0].detalhes) expect(d).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('ordem cronológica única entre blocos: pelo `id` da trilha', async () => {
    mock.fila.audit_log = [
      { data: [linhaCrua({ id: 50, action: 'cancel_class', entity_id: AULA, diff: { via: 'admin' } })] },
      { data: [linhaCrua({ id: 40, action: 'confirm_class', entity_id: AULA, diff: {} })] },
    ]
    const ids = Array.from({ length: 41 }, (_, i) => (i === 0 ? AULA : `id-${i}`))
    const h = await historicoDaAula(ids)
    expect(h[AULA].map((e) => e.titulo)).toEqual(['Presença confirmada pelo aluno', 'Aula cancelada'])
  })
})

/* ========================================================================== */
/* 4. L2 · `contractId` na aula da agenda                                      */
/* ========================================================================== */

describe('A5/L2 · `contractId` vem da MESMA consulta das aulas', () => {
  const DONA = { id: 't-1', display_name: 'Teacher Vicky', is_owner: true, iana_tz: 'America/Cuiaba' }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-28T18:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const semear = (aulas: unknown[]) => {
    mock.respostas = {
      class_instances: { data: aulas },
      teachers: { data: [DONA] },
      reschedule_windows: { data: [] },
      contracts: { data: [] },
    }
  }

  const aulaCrua = (contrato: unknown) => ({
    id: 'i-1',
    starts_at_utc: '2026-07-29T18:00:00+00:00',
    ends_at_utc: '2026-07-29T18:45:00+00:00',
    state: 'scheduled',
    teacher_id: 't-1',
    confirmed_at: null,
    // F5: o trio da avulsa entrou na projeção do dia (fixture de aula de contrato)
    single_kind: null,
    single_price_cents: null,
    single_paid_at: null,
    contracts: contrato,
    class_content_reports: [],
  })

  it('a projeção pede o `id` do contrato no embed — não a coluna da instância', async () => {
    semear([])
    await getAgenda({ visao: 'semana', comJanelas: false })
    const select = String((mock.chamadas.class_instances ?? []).find((c) => c[0] === 'select')![1])
    expect(select).toContain('contracts(id, plan_name')
    // uma consulta só de aulas: nada de round-trip extra para o contrato
    expect((mock.chamadas.class_instances ?? []).filter((c) => c[0] === 'select')).toHaveLength(1)
  })

  it('embed presente → o id do contrato chega à tela', async () => {
    semear([
      aulaCrua({
        id: 'c-77',
        plan_name: 'Personal One',
        students: [{ id: 's-1', display_name: 'Aluna', iana_tz: 'America/Cuiaba' }],
        student_groups: null,
      }),
    ])
    const agenda = await getAgenda({ visao: 'semana', comJanelas: false, ancora: '2026-07-27' })
    expect(agenda.aulas).toHaveLength(1)
    expect(agenda.aulas[0].contractId).toBe('c-77')
  })

  it('embed ausente → `null`, e a tela não finge que dá para duplicar', async () => {
    semear([aulaCrua(null)])
    const agenda = await getAgenda({ visao: 'semana', comJanelas: false, ancora: '2026-07-27' })
    expect(agenda.aulas[0].contractId).toBeNull()
  })
})

/* ========================================================================== */
/* 5. L2 · AO VIVO: o ramo `diff->>rescheduled_from` contra o Postgres local    */
/* ========================================================================== */

describe('A5/L2 · o histórico ao vivo (PostgREST + RLS de admin)', () => {
  let sql: Sql
  let admin: string

  beforeAll(async () => {
    sql = connect(5)
    admin = await createAuthUser(sql, 'admin', 'Admin A5')
  })
  afterAll(async () => {
    await sql.end()
  })

  /**
   * O `historicoDaAula` de produção, mas com o cliente do admin de verdade —
   * é o caminho que prova o filtro no PostgREST (e a policy de `audit_log`),
   * não só que o TypeScript compila.
   */
  async function historicoAoVivo(ids: string[]) {
    const cliente = await clientAs(admin, 'admin')
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => cliente }))
    vi.resetModules()
    const mod = await import('@/data/admin/agenda')
    try {
      return await mod.historicoDaAula(ids)
    } finally {
      vi.doUnmock('@/lib/supabase/server')
      vi.resetModules()
    }
  }

  it('a aula de ORIGEM tem histórico, e o log dela mora no id NOVO', async () => {
    const c = await createPrivateContract(sql, { allowance: 4, minNotice: 1 })
    const origem = await createInstance(sql, c, { startsInHours: 72 })
    const [{ nova }] = await sql<{ nova: string }[]>`
      select public.reschedule_class_at(
        ${origem}, now() + interval '96 hours', 'fixture A5', ${admin}, false, null, true
      ) as nova`

    const h = await historicoAoVivo([origem, nova])

    // ESTA é a prova do ramo: a origem NÃO tem linha própria de remarcação —
    // ela só é alcançada por `diff->>rescheduled_from`.
    const daOrigem = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity = 'class_instances' and action = 'reschedule_class'
         and entity_id = ${origem}`
    expect(daOrigem[0].n).toBe(0)

    expect(h[origem]?.map((e) => e.titulo)).toContain('Remarcada para outro horário')
    expect(h[nova]?.map((e) => e.titulo)).toContain('Nasceu de uma remarcação')
    expect(h[origem][0].detalhes.join(' ')).toMatch(/^novo horário: /)
    // o `courtesy_note` do banco nunca chega à tela nem quando é null
    expect(JSON.stringify(h)).not.toContain('courtesy_note')
  })

  it('cancelamento pela professora: o crédito vem da TRILHA, com validade', async () => {
    const c = await createPrivateContract(sql, { minNotice: 1 })
    const aula = await createInstance(sql, c, { startsInHours: 72 })
    await sql`select public._cancel_class_core(${aula}, 'teacher', now(), ${admin}, 'admin')`

    const h = await historicoAoVivo([aula])
    const cancel = h[aula].find((e) => e.titulo === 'Aula cancelada')!
    expect(cancel.porQuem).toBe('pela escola')
    expect(cancel.detalhes).toContain('quem pediu o cancelamento: a professora')
    expect(cancel.detalhes).toContain('o aluno ganhou um crédito de reposição')
    expect(cancel.detalhes.some((d) => /^crédito válido até \d{2}\/\d{2}\/\d{4}$/.test(d))).toBe(true)
    // a antecedência do contrato está no `diff` e NÃO na tela
    const frases = h[aula].flatMap((e) => e.detalhes).join(' ')
    expect(frases).not.toMatch(/antecedênc|prazo/i)
  })

  it('o trigger genérico NÃO entra: nada de `diff.new` com a linha inteira', async () => {
    const c = await createPrivateContract(sql)
    const aula = await createInstance(sql, c, { startsInHours: 72 })
    // a instância nasceu por INSERT direto → o trigger genérico registrou
    const genericas = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity = 'class_instances' and entity_id = ${aula}
         and action in ('insert','update','delete')`
    expect(genericas[0].n).toBeGreaterThan(0)

    const h = await historicoAoVivo([aula])
    const texto = JSON.stringify(h[aula] ?? [])
    expect(texto).not.toContain('local_time_snapshot')
    expect(texto).not.toContain('scheduled')
    expect(h[aula] ?? []).toEqual([])
  })

  it('100 aulas atravessam o PostgREST em 3 lotes — a fila inteira de pendências', async () => {
    const c = await createPrivateContract(sql, { minNotice: 1 })
    const reais: string[] = []
    for (let i = 0; i < 3; i++) {
      const aula = await createInstance(sql, c, { startsInHours: 200 + i * 3 })
      await sql`select public._cancel_class_core(${aula}, 'student', now(), ${admin}, 'admin')`
      reais.push(aula)
    }
    // 97 uuids que não existem + as 3 reais, espalhadas nos três blocos
    const enchimento = Array.from({ length: 97 }, () => crypto.randomUUID())
    const ids = [reais[0], ...enchimento.slice(0, 45), reais[1], ...enchimento.slice(45), reais[2]]
    expect(ids).toHaveLength(100)

    const h = await historicoAoVivo(ids)
    for (const aula of reais) {
      expect(h[aula]?.map((e) => e.titulo), aula).toContain('Aula cancelada')
    }
  })
})

/* ========================================================================== */
/* 7. L3 · O GATE POR SITUAÇÃO — oferecer o que o banco recusaria é mentira     */
/* ========================================================================== */

describe('A5/L3 · a matriz oferece só o que a RPC aceitaria', () => {
  it('aula FUTURA (`agendada`) oferece SÓ os dois cancelamentos', () => {
    // `complete_class` exige `starts_at <= now` e `_mark_no_show` exige
    // `now > starts_at`: as três primeiras linhas seriam recusadas pelo banco.
    expect(opcoesDaSituacao('agendada')).toEqual(['cancelada_professora', 'cancelada_aluno'])
  })

  it('aula que TERMINOU e não tem desfecho oferece as CINCO', () => {
    expect(opcoesDaSituacao('sem_registro')).toEqual([
      'realizada',
      'falta_aluno',
      'falta_professora',
      'cancelada_professora',
      'cancelada_aluno',
    ])
    expect(opcoesDaSituacao('sem_registro')).toEqual(DESFECHOS)
  })

  it('aula COM desfecho não oferece nada — as cinco exigem `state = scheduled`', () => {
    for (const s of ['realizada', 'falta_aluno', 'falta_professora', 'cancelada', 'remarcada'] as const)
      expect(opcoesDaSituacao(s), s).toEqual([])
  })

  it('toda linha oferecida tem rótulo E frase de consequência (nenhuma muda)', () => {
    for (const d of DESFECHOS) {
      expect(ROTULO[d]?.length ?? 0, d).toBeGreaterThan(3)
      expect(CONSEQUENCIA[d]?.length ?? 0, d).toBeGreaterThan(40)
    }
  })

  it('o vocabulário é FECHADO: envio forjado não vira desfecho nenhum', () => {
    expect(ehDesfecho('realizada')).toBe(true)
    for (const v of ['', ' ', 'cancelada', 'no_show_teacher', 'aconteceu', undefined])
      expect(ehDesfecho(v), String(v)).toBe(false)
  })

  it('o que separa DINHEIRO é quem pediu o cancelamento (ADR-018)', () => {
    expect(pedidoPor('cancelada_professora')).toBe('teacher')
    expect(pedidoPor('cancelada_aluno')).toBe('student')
    // os três desfechos que não são cancelamento não têm `p_cancelled_by`
    expect(pedidoPor('realizada')).toBeNull()
    expect(pedidoPor('falta_aluno')).toBeNull()
    expect(pedidoPor('falta_professora')).toBeNull()
    expect(ehCancelamento('cancelada_aluno')).toBe(true)
    expect(ehCancelamento('falta_professora')).toBe(false)
  })
})

/* ========================================================================== */
/* 8. L3 · A ACTION UNIFICADA: uma escolha → a RPC certa, o recado medido       */
/* ========================================================================== */

const AULA_DO_DESFECHO = 'cccccccc-0000-0000-0000-000000000001'
/** O `back` que a tela manda: ele CARREGA a ponte legada, que precisa cair. */
const BACK = '/admin/agenda?v=dia&d=2026-08-04&msg=coisa%20velha&n=123'

function formDoDesfecho(campos: Record<string, string>): FormData {
  const f = new FormData()
  f.set('instance_id', AULA_DO_DESFECHO)
  f.set('back', BACK)
  f.set('back_erro', `/admin/agenda?v=dia&d=2026-08-04&ev=${AULA_DO_DESFECHO}`)
  f.set('manter', 'desfecho,off_kind,off_note,notified_at')
  f.set('rascunho', chaveDoDesfecho(AULA_DO_DESFECHO))
  for (const [k, v] of Object.entries(campos)) f.set(k, v)
  return f
}

/** Executa a action e devolve o destino + o recado que sobrou no cookie. */
async function registrarCom(f: FormData) {
  let url = ''
  try {
    await registrarDesfechoDaAulaAction(f)
    throw new Error('a action não redirecionou')
  } catch (e) {
    if (!(e instanceof Redirecionou)) throw e
    url = e.url
  }
  return { url, recado: await lerRecado('agenda') }
}

async function registrar(campos: Record<string, string>) {
  return registrarCom(formDoDesfecho(campos))
}

/** A resposta da leitura da trilha (`.limit(1).single()` → objeto, não lista). */
function trilha(diff: Record<string, unknown>) {
  mock.respostas.audit_log = { data: { diff } }
}

describe('A5/L3 · cada escolha chama UMA função, com os argumentos dela', () => {
  it('realizada → `complete_class` com o apontamento, e NÃO lê a trilha', async () => {
    const { url, recado } = await registrar({
      desfecho: 'realizada',
      off_kind: 'prova',
      off_note: 'B2',
    })
    expect(mock.rpcs).toEqual([
      ['complete_class', { p_instance: AULA_DO_DESFECHO, p_off_kind: 'prova', p_off_note: 'B2' }],
    ])
    // `complete_class` não toca `makeup_ledger`: não há dinheiro a medir, e uma
    // ida a mais ao banco só criaria um modo de falha novo.
    expect(mock.chamadas.audit_log).toBeUndefined()
    // o desfecho volta no COOKIE, e a ponte legada do `back` CAIU
    expect(recado?.mensagem).toContain('Aula registrada como realizada')
    expect(url).toBe('/admin/agenda?v=dia&d=2026-08-04')
    expect(url).not.toContain('msg=')
  })

  it('a sentinela do tema viaja como `null`, nunca como string vazia', async () => {
    await registrar({ desfecho: 'realizada', off_kind: '', off_note: '' })
    expect(mock.rpcs[0][1]).toEqual({
      p_instance: AULA_DO_DESFECHO,
      p_off_kind: null,
      p_off_note: null,
    })
  })

  it('falta do ALUNO → `no_show_student`, e também não lê a trilha', async () => {
    const { recado } = await registrar({ desfecho: 'falta_aluno' })
    expect(mock.rpcs).toEqual([['no_show_student', { p_instance: AULA_DO_DESFECHO }]])
    // o ramo de crédito de `_mark_no_show` só abre para a professora
    expect(mock.chamadas.audit_log).toBeUndefined()
    expect(recado?.mensagem).toContain('Falta do aluno registrada')
    expect(tomDoAviso(recado!.mensagem)).toBe('sucesso')
  })

  it('falta da PROFESSORA → `no_show_teacher` + a trilha DAQUELE ato', async () => {
    trilha({ credited: true, expires_on: '2027-01-28', refund_blocked: null })
    const { recado } = await registrar({ desfecho: 'falta_professora' })
    expect(mock.rpcs).toEqual([['no_show_teacher', { p_instance: AULA_DO_DESFECHO }]])
    // a leitura é do ato certo, da aula certa, a mais recente
    const c = mock.chamadas.audit_log
    expect(c).toEqual([
      ['select', 'diff'],
      ['eq', 'action', 'no_show_teacher'],
      ['eq', 'entity_id', AULA_DO_DESFECHO],
      ['order', 'id', { ascending: false }],
      ['limit', 1],
      ['single'],
    ])
    // validade em data de GENTE, nunca ISO cru
    expect(recado?.mensagem).toContain('vale até 28/01/2027')
    expect(tomDoAviso(recado!.mensagem)).toBe('sucesso')
  })

  it('falta da professora com devolução BLOQUEADA não anuncia crédito — e sai VERMELHA', async () => {
    // `_refund_for_credit_born_class` volta SEM creditar quando o gasto não tem
    // identidade (`consumes_ledger_id is null`). Afirmar o crédito aqui seria a
    // frase falsa nº 2 da medição do A5.
    trilha({
      credited: false,
      expires_on: null,
      refund_blocked: 'gasto sem identidade (anterior à F1) — crédito só via ajuste manual',
    })
    const { recado } = await registrar({ desfecho: 'falta_professora' })
    expect(recado?.mensagem).toContain('NÃO foi devolvido automaticamente')
    expect(recado?.mensagem).toContain('gasto sem identidade')
    expect(recado?.mensagem).not.toContain('GANHOU')
    expect(tomDoAviso(recado!.mensagem)).toBe('erro')
  })

  it('trilha ILEGÍVEL não vira "sem crédito": o recado admite a dúvida', async () => {
    mock.respostas.audit_log = { error: { message: 'permission denied' } }
    const { recado } = await registrar({ desfecho: 'falta_professora' })
    // o ato está commitado e não se desfaz — o que muda é a frase
    expect(mock.rpcs).toHaveLength(1)
    expect(recado?.mensagem).toContain('não deu para ler se o crédito foi gerado')
    expect(tomDoAviso(recado!.mensagem)).toBe('erro')
  })

  it('cancelamento: `p_cancelled_by` é o campo que decide o dinheiro', async () => {
    trilha({ credited: true, expires_on: '2026-09-01' })
    await registrar({ desfecho: 'cancelada_professora' })
    // A6/Lote 2: a escolha de avisar entrou na assinatura — sem o marcador
    // `canais=1` no form, os DOIS canais viajam ligados (o comportamento de
    // sempre). O campo de dinheiro continua sendo `p_cancelled_by`.
    expect(mock.rpcs).toEqual([
      ['cancel_class', {
        p_instance: AULA_DO_DESFECHO,
        p_cancelled_by: 'teacher',
        p_notify_email: true,
        p_notify_whatsapp: true,
      }],
    ])
    mock.rpcs = []
    mock.chamadas = {}
    const { recado } = await registrar({ desfecho: 'cancelada_aluno' })
    expect(mock.rpcs).toEqual([
      ['cancel_class', {
        p_instance: AULA_DO_DESFECHO,
        p_cancelled_by: 'student',
        p_notify_email: true,
        p_notify_whatsapp: true,
      }],
    ])
    // pedido do ALUNO nunca credita (ADR-018): não há trilha a consultar
    expect(mock.chamadas.audit_log).toBeUndefined()
    expect(recado?.mensagem).toContain('sem crédito de reposição')
    expect(tomDoAviso(recado!.mensagem)).toBe('sucesso')
  })

  // ══════════════════════════════════════════════════════════════════════════
  // A6 · rodada 2 do Sol — MARCAR A CAIXA NÃO É AVISAR
  // ══════════════════════════════════════════════════════════════════════════
  // A frase de sucesso lia só a ESCOLHA. Como a caixa não é desabilitada
  // (régua da casa), marcar um canal sem destinatário é gesto possível — e o
  // que ele produz é diferente por canal: e-mail sem login nasce ÓRFÃO (linha
  // presa em Mensagens) e WhatsApp sem número NEM NASCE. A tela dizia "fica
  // REGISTRADO para envio por WhatsApp" para um aluno sem número.
  it('canal marcado SEM entregabilidade não vira frase de entrega', async () => {
    trilha({ credited: true, expires_on: '2026-09-01' })
    const { recado } = await registrar({
      desfecho: 'cancelada_professora',
      canais: '1',
      avisar_email: '1',
      avisar_whatsapp: '1',
      entrega_email: '1',
      entrega_whatsapp: '0', // ela marcou; não há número no cadastro
    })
    expect(recado?.mensagem).toContain('nada foi registrado por lá')
    expect(recado?.mensagem).not.toContain('e-mail sempre')
    // sucesso PARCIAL não é sucesso: o recado sai vermelho
    expect(tomDoAviso(recado!.mensagem)).toBe('erro')
  })

  it('PROVA DE MUTAÇÃO: com a entrega de pé, a MESMA escolha volta a prometer envio', async () => {
    trilha({ credited: true, expires_on: '2026-09-01' })
    const { recado } = await registrar({
      desfecho: 'cancelada_professora',
      canais: '1',
      avisar_email: '1',
      avisar_whatsapp: '1',
      entrega_email: '1',
      entrega_whatsapp: '1',
    })
    expect(recado?.mensagem).toContain('fica REGISTRADO para envio')
    expect(recado?.mensagem).not.toContain('nada foi registrado por lá')
    expect(tomDoAviso(recado!.mensagem)).toBe('sucesso')
  })

  it('aula de GRUPO: "não sei" não vira "não" — a frase mantém a hedge de sempre', async () => {
    trilha({ credited: true, expires_on: '2026-09-01' })
    const { recado } = await registrar({
      desfecho: 'cancelada_professora',
      canais: '1',
      avisar_email: '1',
      avisar_whatsapp: '1',
      entrega_email: '',
      entrega_whatsapp: '',
    })
    expect(recado?.mensagem).toContain('WhatsApp quando há número no cadastro dele')
    expect(tomDoAviso(recado!.mensagem)).toBe('sucesso')
  })

  it('sem login E sem número, o recado diz que NADA chega ao aluno', async () => {
    trilha({ credited: true, expires_on: '2026-09-01' })
    const { recado } = await registrar({
      desfecho: 'cancelada_aluno',
      canais: '1',
      avisar_email: '1',
      avisar_whatsapp: '1',
      entrega_email: '0',
      entrega_whatsapp: '0',
    })
    expect(recado?.mensagem).toContain('Nada chega ao aluno por aqui')
    expect(recado?.mensagem).toContain('Combine a conversa com ele.')
    expect(tomDoAviso(recado!.mensagem)).toBe('erro')
  })

  it('estorno BLOQUEADO + canal marcado sem destino: nem "já saiu", nem "você não avisou"', async () => {
    trilha({ credited: false, refund_blocked: 'gasto sem identidade (anterior à F1)' })
    const { recado } = await registrar({
      desfecho: 'cancelada_professora',
      canais: '1',
      avisar_email: '1',
      avisar_whatsapp: '0',
      entrega_email: '0',
      entrega_whatsapp: '0',
    })
    expect(recado?.mensagem).toContain('não tem como chegar a este aluno')
    expect(recado?.mensagem).not.toContain('o aviso que saiu para o aluno diz')
    expect(recado?.mensagem).not.toContain('você escolheu não avisar o aluno')
    expect(tomDoAviso(recado!.mensagem)).toBe('erro')
  })

  it('a hora do aviso é lida em CUIABÁ e viaja em UTC (Lei 1)', async () => {
    trilha({ credited: true, expires_on: '2026-09-01' })
    await registrar({ desfecho: 'cancelada_professora', notified_at: '2026-08-04T13:00' })
    // America/Cuiaba é UTC−4 o ano inteiro: 13:00 local = 17:00Z
    expect(mock.rpcs[0][1]).toMatchObject({ p_notified_at: '2026-08-04T17:00:00.000Z' })
  })

  it('hora do aviso quebrada ABORTA — nada é cancelado, e o campo volta', async () => {
    const { url, recado } = await registrar({
      desfecho: 'cancelada_aluno',
      notified_at: 'ontem à tarde',
    })
    expect(mock.rpcs).toEqual([])
    // A RECUSA TAMBÉM VIAJA NO COOKIE (correção do orquestrador): o ramo de erro
    // é justamente onde o texto pode ser cru, e `?msg=` publicaria a frase na
    // barra de endereços, no histórico e no log — o grave 3 do A8.
    expect(recado?.mensagem).toContain('data/hora do aviso inválida')
    expect(url).not.toContain('msg=')
    expect(url).not.toContain('n=')
    // …e o destino continua sendo o que o formulário pediu: o balão DAQUELA aula
    expect(url).toContain(`ev=${AULA_DO_DESFECHO}`)
    // o que ela escolheu sobrevive, no COOKIE de rascunho (nunca na URL)
    const rascunho = JSON.parse(pote.get(RASCUNHO_COOKIE)!.value)
    expect(rascunho.chave).toBe(chaveDoDesfecho(AULA_DO_DESFECHO))
    expect(rascunho.campos).toEqual({ desfecho: 'cancelada_aluno', notified_at: 'ontem à tarde' })
    expect(url).not.toContain('notified_at')
  })

  it('a volta de erro HIGIENIZA a ponte legada e recusa destino de FORA da seção', async () => {
    // A ponte no `back_erro` chega de aba velha, link salvo ou envio forjado —
    // e sobreviveria à recusa nova: pela precedência da página (a ponte vence o
    // cookie, porque indica o ato mais recente), o `msg` velho engoliria o erro
    // que a action acabou de escrever.
    const f = formDoDesfecho({ desfecho: '' })
    f.set('back_erro', `/admin/agenda?v=dia&ev=${AULA_DO_DESFECHO}&msg=coisa%20velha&n=99`)
    const comPonte = await registrarCom(f)
    expect(comPonte.url).toBe(`/admin/agenda?v=dia&ev=${AULA_DO_DESFECHO}`)
    expect(comPonte.recado?.mensagem).toContain('escolha o que aconteceu')

    // …e o destino NÃO É COPIADO do formulário (bloqueador do Sol · rodada 1):
    // o caminho é sempre a casa da seção — um `back_erro` de outra seção (ou com
    // travessia) não tem para onde levar a dona, e o cookie de `path` estreito
    // continua chegando. O `ev` vem do `instance_id` que a action recebeu.
    const g = formDoDesfecho({ desfecho: '' })
    g.set('back_erro', '/admin/alunos?x=1')
    const forjado = await registrarCom(g)
    expect(forjado.url).toBe(`/admin/agenda?ev=${AULA_DO_DESFECHO}`)
    expect(forjado.recado?.mensagem).toContain('escolha o que aconteceu')
  })

  it('BLOQUEADOR: `manter`/`na_url` do formulário NÃO reinserem nada na URL', async () => {
    // O envio forjado pedia para o `msg` sobreviver à higienização (`manter=msg`
    // + `na_url=msg`) e pendurava texto livre na query do `back_erro`. Com a
    // allowlist de geometria do SERVIDOR, nenhuma das duas portas existe: o que
    // não é `v`/`d`/`prof`/`j`/`q` (+ `ev`, do servidor) simplesmente não entra.
    const f = formDoDesfecho({ desfecho: '' })
    f.set('back_erro', '/admin/agenda?v=dia&d=2026-08-04&off_note=m%C3%A3e%20internada&msg=verde')
    f.set('manter', 'msg,off_note,desfecho')
    f.set('na_url', 'msg,off_note')
    f.set('msg', 'Aula cancelada — o aluno GANHOU um crédito de reposição.')
    f.set('off_note', 'mãe internada')
    const { url, recado } = await registrarCom(f)
    expect(url).toBe(`/admin/agenda?v=dia&d=2026-08-04&ev=${AULA_DO_DESFECHO}`)
    for (const proibido of ['msg', 'off_note', 'internada', 'GANHOU'])
      expect(decodeURIComponent(url), proibido).not.toContain(proibido)
    // …e o que a dona digitou continua sobrevivendo, no cookie
    expect(recado?.mensagem).toContain('escolha o que aconteceu')
    const rascunho = JSON.parse(pote.get(RASCUNHO_COOKIE)!.value)
    expect(rascunho.chave).toBe(chaveDoDesfecho(AULA_DO_DESFECHO))
    expect(rascunho.campos.off_note).toBe('mãe internada')
    // `msg` não é campo do desfecho: a lista de campos é do SERVIDOR
    expect(rascunho.campos.msg).toBeUndefined()
  })

  // ══════════════════════════════════════════════════════════════════════════
  // A6 · rodada 2 do Sol — P2: A ESCOLHA DE CANAIS SOBREVIVE À RECUSA
  // ══════════════════════════════════════════════════════════════════════════
  // Os três campos da escolha nasceram no lote 2 e ficaram FORA da lista de
  // campos que voltam no rascunho. Consequência: o servidor recusa, o balão
  // reabre, e o canal que ela desmarcou renasce ligado — o aluno recebe o
  // recado que ela decidiu não mandar.
  it('P2: os campos de canal voltam no RASCUNHO depois de uma recusa', async () => {
    const { recado } = await registrar({
      desfecho: 'cancelada_aluno',
      notified_at: 'ontem à tarde', // recusa antes de qualquer RPC
      canais: '1',
      avisar_email: '1',
      avisar_whatsapp: '0',
    })
    expect(mock.rpcs).toEqual([])
    expect(recado?.mensagem).toContain('data/hora do aviso inválida')
    const rascunho = JSON.parse(pote.get(RASCUNHO_COOKIE)!.value)
    expect(rascunho.campos).toMatchObject({
      desfecho: 'cancelada_aluno',
      canais: '1',
      avisar_email: '1',
      // é este `'0'` que a tela precisa de volta — sem ele a caixa renasce
      // marcada pela entregabilidade
      avisar_whatsapp: '0',
    })
  })

  it('BLOQUEADOR: a chave do rascunho é derivada no SERVIDOR, não lida do form', async () => {
    const f = formDoDesfecho({ desfecho: '', off_note: 'texto da dona' })
    f.set('rascunho', 'painel:avulsa')
    await registrarCom(f)
    const rascunho = JSON.parse(pote.get(RASCUNHO_COOKIE)!.value)
    // sem isto, um envio forjado gravaria o rascunho sob a identidade de OUTRO
    // formulário — e o painel da aula avulsa nasceria com o texto do desfecho
    expect(rascunho.chave).toBe(chaveDoDesfecho(AULA_DO_DESFECHO))
    expect(rascunho.chave).not.toBe('painel:avulsa')
  })

  it('NENHUM caminho de recusa da action nova deixa frase na URL', async () => {
    // A varredura fecha o ramo que a primeira versão deste lote errou: o
    // `fraseDaRecusaDoDesfecho` cai no texto CRU do banco quando nada casa, e
    // `?msg=` publicaria nome de constraint, de função e trecho de SQL na barra
    // de endereços, no histórico e no log de acesso. Com a frase no cookie
    // `httpOnly`, o texto cru é aceitável — o crivo é o VEÍCULO.
    const crua = 'new row for relation "class_instances" violates check constraint "ci_state_ck"'
    const caminhos: Record<string, string>[] = [
      { desfecho: '' },
      { desfecho: 'nada_disso' },
      { desfecho: 'cancelada_aluno', notified_at: 'não é data' },
      { desfecho: 'realizada' },
      { desfecho: 'falta_professora' },
      { desfecho: 'cancelada_professora' },
    ]
    for (const campos of caminhos) {
      mock.respostasRpc = {
        complete_class: { error: { message: crua } },
        no_show_teacher: { error: { message: crua } },
        cancel_class: { error: { message: crua } },
      }
      const { url, recado } = await registrar(campos)
      const legivel = decodeURIComponent(url)
      for (const proibido of ['msg', 'constraint', 'class_instances', 'Falha']) {
        expect(legivel, `${JSON.stringify(campos)} · ${proibido}`).not.toContain(proibido)
      }
      // a frase EXISTE — ela só não está na URL
      expect(recado?.mensagem, JSON.stringify(campos)).toBeTruthy()
    }
  })

  it('nenhuma linha marcada (ou forjada) não chama RPC nenhuma', async () => {
    for (const desfecho of ['', 'no_show_teacher']) {
      mock.rpcs = []
      const { url, recado } = await registrar({ desfecho })
      expect(mock.rpcs, desfecho).toEqual([])
      expect(recado?.mensagem, desfecho).toContain('escolha o que aconteceu com esta aula')
      expect(url, desfecho).not.toContain('msg=')
    }
  })

  it('aula não identificada é recusada antes de tocar o banco', async () => {
    const f = formDoDesfecho({ desfecho: 'realizada' })
    f.set('instance_id', '  ')
    const { url, recado } = await registrarCom(f)
    expect(mock.rpcs).toEqual([])
    expect(recado?.mensagem).toContain('aula não identificada')
    expect(url).not.toContain('msg=')
  })

  it('recusa do banco vira frase de GENTE, e o rascunho sobrevive', async () => {
    mock.respostasRpc.complete_class = {
      error: { message: 'aula sem apontamento de conteúdo — informe o módulo do plano' },
    }
    const { url, recado } = await registrar({
      desfecho: 'realizada',
      off_kind: '',
      off_note: 'prova de ontem',
    })
    expect(recado?.mensagem).toContain('diga o que foi trabalhado')
    // o texto cru do Postgres não chega à dona…
    expect(recado?.mensagem).not.toContain('apontamento de conteúdo —')
    // …e nem a frase traduzida encosta na URL
    expect(decodeURIComponent(url)).not.toContain('diga o que foi trabalhado')
    const rascunho = JSON.parse(pote.get(RASCUNHO_COOKIE)!.value)
    expect(rascunho.campos.off_note).toBe('prova de ontem')
  })

  it('as guardas de ESTADO das RPCs viram frase, cada uma com o seu conserto', async () => {
    const casos: [string, string, string][] = [
      [
        'aula 123 já começou e o aviso não a precedeu — use no_show_student/no_show_teacher',
        'cancelada_professora',
        'exige um aviso ANTERIOR ao início',
      ],
      ['notified_at no futuro (2026-09-09) — o aviso já deve ter acontecido', 'cancelada_aluno', 'está no futuro'],
      // A guarda do BANCO é "ainda não começou"; a régua da TELA espera o FIM. A
      // frase diz as duas, sem trocar a autoria de uma pela da outra.
      [
        'aula 123 ainda não começou (2026-09-09) — no-show é retrospectivo',
        'falta_aluno',
        'ainda não começou',
      ],
      ['a aula já tem desfecho (completed)', 'falta_professora', 'já tem desfecho registrado'],
      ['instância 123 não está agendada (estado: cancelled)', 'falta_aluno', 'já tem desfecho registrado'],
    ]
    for (const [doBanco, desfecho, esperado] of casos) {
      mock.rpcs = []
      mock.respostasRpc = {
        complete_class: { error: { message: doBanco } },
        no_show_student: { error: { message: doBanco } },
        no_show_teacher: { error: { message: doBanco } },
        cancel_class: { error: { message: doBanco } },
      }
      const { url, recado } = await registrar({ desfecho })
      expect(recado?.mensagem, doBanco).toContain(esperado)
      expect(url, doBanco).not.toContain('msg=')
    }
  })
})

/* ========================================================================== */
/* 9. L3/L4 · a identidade do rascunho é DAQUELA aula, e só dela               */
/* ========================================================================== */

describe('A5 · o rascunho do desfecho não vaza para outro formulário', () => {
  it('chave por AULA, e distinta da do Remarcar (a mesma aula tem os dois)', async () => {
    const { chaveDoRemarcar } = await import('@/lib/admin/chaves-de-rascunho')
    const a = 'cccccccc-0000-0000-0000-00000000000a'
    const b = 'cccccccc-0000-0000-0000-00000000000b'
    expect(chaveDoDesfecho(a)).not.toBe(chaveDoDesfecho(b))
    // se as duas famílias compartilhassem chave, o `notified_at` de um
    // cancelamento recusado apareceria no formulário de remarcação da MESMA aula
    expect(chaveDoDesfecho(a)).not.toBe(chaveDoRemarcar(a))
  })

  it('rascunho gravado numa aula devolve VAZIO para a chave de outra', async () => {
    const { gravarRascunho, lerRascunho } = await import('@/lib/admin/rascunho-do-formulario')
    const a = 'cccccccc-0000-0000-0000-00000000000a'
    const b = 'cccccccc-0000-0000-0000-00000000000b'
    await gravarRascunho(chaveDoDesfecho(a), { desfecho: 'cancelada_aluno', off_note: 'segredo' })
    expect(await lerRascunho(chaveDoDesfecho(a))).toEqual({
      desfecho: 'cancelada_aluno',
      off_note: 'segredo',
    })
    expect(await lerRascunho(chaveDoDesfecho(b))).toEqual({})
  })
})

/* ========================================================================== */
/* 10. L5 · FRASE × CORPO EFETIVO — a prova central do A5                      */
/* ========================================================================== */

/**
 * A REGRA DESTE BLOCO: nenhuma afirmação abaixo veio de tabela pronta, de nome de
 * função nem de memória. Cada uma foi DERIVADA do corpo efetivo lido pelo helper
 * `tests/helpers/definicao-da-funcao.ts` (o CORRIGIDO — o antigo era
 * case-sensitive e lia função MORTA; o teste-guarda que o derruba mora no A4).
 *
 * Por que isso é o centro do milestone: a tela do desfecho faz cinco afirmações
 * sobre DINHEIRO (hora da professora, crédito do aluno, aviso). Frase de tela não
 * é documentação — é o que a dona usa para decidir. Uma frase falsa aqui custa
 * hora paga a mais, crédito não devolvido, ou um aluno avisado que ela achava que
 * não seria.
 *
 * O que cada função ESCREVE, medido (é a base de tudo o que vem depois):
 *   · `complete_class`            → `state = 'completed'`
 *   · `no_show_student`  → `_mark_no_show(…, 'student')` → `no_show_student`
 *   · `no_show_teacher`  → `_mark_no_show(…, 'teacher')` → `no_show_teacher`
 *   · `cancel_class`     → `_cancel_class_core(…)`       → `cancelled`
 */

/** A função que REALMENTE guarda o estado e move o dinheiro: o wrapper público
 *  delega ao núcleo, e é o núcleo que carrega os `raise`. DERIVADO do corpo. */
function nucleoDe(rpc: string): { nome: string; corpo: string } {
  const corpo = corpoDaFuncao(rpc)
  const m = /perform\s+public\.(_[a-z_]+)\s*\(/i.exec(corpo)
  return m ? { nome: m[1], corpo: corpoDaFuncao(m[1]) } : { nome: rpc, corpo }
}

/** Espaço em branco não é assunto: o SQL da casa mistura indentação do `pg_dump`
 *  com a escrita à mão. */
const norm = (s: string) => s.replace(/\s+/g, ' ')

describe('A5/L5 · o helper promovido lê a MESMA definição efetiva nos dois arquivos', () => {
  it('as duas funções de dinheiro deste milestone vêm da definição efetiva atual', () => {
    // Se o helper aqui divergisse do do A4, uma das duas provas mediria a versão
    // MORTA de `20260718000400`/`20260718000300` e ficaria verde à toa.
    // A6/Lote 2: `_cancel_class_core` foi reemitida (flags de canal + retorno
    // jsonb) — a origem efetiva avançou para a migration 99.
    // M2 da onda Agenda e Mensagens (01/09/2026): `_cancel_class_core` foi
    // recriada (aviso à professora quando outra pessoa cancela) — a origem
    // efetiva avançou de novo.
    expect(definicaoDaFuncao('_cancel_class_core').origem).toBe(
      '20260901000100_m2_professora_cancela_e_remarca.sql',
    )
    expect(definicaoDaFuncao('_mark_no_show').origem).toBe(
      '20260727000700_ordem_global_de_locks.sql',
    )
    // O que este bloco guarda: o helper lê AMBAS as grafias da casa. A do
    // `pg_dump` (MAIÚSCULAS + `$function$`) — a forma que o helper antigo não
    // via — continua provada pela `_mark_no_show`; a `_cancel_class_core`
    // agora vem da migration 99, escrita à mão (minúsculas, pós-DROP).
    const dump = corpoDaFuncao('_mark_no_show')
    expect(dump.startsWith('CREATE OR REPLACE FUNCTION'), '_mark_no_show').toBe(true)
    expect(dump, '_mark_no_show').toContain('$function$')
    const manual = corpoDaFuncao('_cancel_class_core')
    // M2 (01/09/2026): a recriação é `create or replace` (mesma assinatura, sem
    // DROP) — continua escrita à mão, em minúsculas, que é o que se prova aqui.
    expect(/^create (or replace )?function/.test(manual), '_cancel_class_core').toBe(true)
  })

  it('cada desfecho escreve o estado que as frases pressupõem', () => {
    expect(corpoDaFuncao('complete_class')).toContain(
      "update class_instances set state = 'completed'",
    )
    const mn = nucleoDe('no_show_student')
    expect(mn.nome).toBe('_mark_no_show')
    expect(corpoDaFuncao('no_show_student')).toContain("_mark_no_show(p_instance, 'student'")
    expect(corpoDaFuncao('no_show_teacher')).toContain("_mark_no_show(p_instance, 'teacher'")
    expect(mn.corpo).toContain("update class_instances set state = 'no_show_student'")
    expect(mn.corpo).toContain("update class_instances set state = 'no_show_teacher'")
    expect(nucleoDe('cancel_class').nome).toBe('_cancel_class_core')
    expect(nucleoDe('cancel_class').corpo).toContain(
      "update class_instances set state = 'cancelled'",
    )
  })
})

describe('A5/L5 · A HORA DA PROFESSORA — o predicado do extrato, e nada além dele', () => {
  const extrato = corpoDaFuncao('_teacher_payable_hours')

  it('o predicado que PAGA: dois estados incondicionais + `scheduled` com contrato não pausado', () => {
    // Esta é a medição que derrubou "libera a hora da professora no extrato": a
    // aula PASSADA e ainda `scheduled` JÁ entra na soma.
    expect(norm(extrato)).toContain("i.state in ('completed', 'no_show_student')")
    expect(norm(extrato)).toContain("or ( i.state = 'scheduled' and not exists (")
    expect(extrato).toContain('from contract_pauses cp')
    expect(extrato).toContain('i.starts_at_utc < now()')
  })

  it('os três estados que NÃO aparecem em ramo nenhum da soma', () => {
    // `no_show_teacher`, `cancelled` e `rescheduled` não estão na função: é por
    // isso que a frase deles é "a hora NÃO conta", e não "sai do extrato".
    for (const estado of ['no_show_teacher', 'cancelled', 'rescheduled'])
      expect(extrato, estado).not.toContain(estado)
  })

  it('o extrato NÃO olha apontamento de conteúdo — nem uma vez', () => {
    // Consequência direta: "aula sem apontamento não conta no extrato" é FALSO.
    // A soma não conhece `class_content_reports`; quem exige apontamento é
    // `complete_class`, que decide se a aula pode virar `completed` — outra
    // pergunta. (Ver o varredor da régua, §12.)
    expect(extrato).not.toContain('class_content_reports')
    expect(corpoDaFuncao('complete_class')).toContain('class_content_reports')
  })

  it('o gêmeo em centavos usa o MESMO predicado (a paridade que a migration promete)', () => {
    // `_teacher_payable_cents` (20260718001100) é a soma em DINHEIRO. Se os dois
    // divergirem, a frase "a hora conta no extrato" fica verdadeira em horas e
    // falsa em reais — Lei 6 (dinheiro em centavos) num predicado só.
    const cents = corpoDaFuncao('_teacher_payable_cents')
    expect(norm(cents)).toContain("i.state in ('completed', 'no_show_student')")
    expect(norm(cents)).toContain("or ( i.state = 'scheduled' and not exists (")
    expect(cents).toContain('from contract_pauses cp')
    expect(cents).toContain('i.starts_at_utc < now()')
    for (const estado of ['no_show_teacher', 'cancelled', 'rescheduled'])
      expect(cents, estado).not.toContain(estado)
  })

  it('as CINCO frases dizem da hora exatamente o que o predicado sustenta', () => {
    // MANTÉM (o estado final está na soma):
    expect(CONSEQUENCIA.realizada).toContain('A hora CONTA no extrato da professora')
    expect(CONSEQUENCIA.falta_aluno).toContain('A hora CONTA no extrato da professora')
    // RETIRAM (o estado final não está em ramo nenhum):
    for (const d of ['falta_professora', 'cancelada_professora', 'cancelada_aluno'] as const)
      expect(CONSEQUENCIA[d], d).toContain('A hora NÃO conta no extrato da professora')
  })

  it('NENHUMA frase do vocabulário diz que o desfecho "libera" a hora', () => {
    // O verbo é o defeito: "libera" afirma que a hora não contava antes, e ela
    // contava (aula passada + `scheduled` + contrato ativo). A frase viva no
    // `RegistrarDesfecho` do Início ainda diz isso — ver §12.
    const frases = [
      ...Object.values(CONSEQUENCIA),
      ...Object.values(DECLARACAO_DO_ESTADO),
      ...Object.values(CONFIRMAR),
      AVISO_DA_HORA,
    ]
    for (const f of frases) expect(f, f).not.toMatch(/liber/i)
  })

  it('a RESSALVA do contrato pausado é dita — e só ela precisa ser', () => {
    // O ramo `scheduled` tem uma condição que os outros dois não têm. Sem a
    // ressalva, "JÁ conta" seria afirmação falsa em contrato pausado.
    expect(AVISO_DA_HORA).toMatch(/JÁ conta no extrato/)
    expect(AVISO_DA_HORA).toMatch(/contrato não está pausado/)
    // …e a declaração de cada estado FINAL não precisa dela (os ramos
    // `completed`/`no_show_student` não consultam `contract_pauses`).
    expect(DECLARACAO_DO_ESTADO.realizada).toContain('A hora conta no extrato da professora')
    for (const s of ['falta_professora', 'cancelada', 'remarcada'] as const)
      expect(DECLARACAO_DO_ESTADO[s], s).toMatch(/não conta no extrato da professora/i)
  })
})

describe('A5/L5 · O CRÉDITO — quem decide é `p_cancelled_by`, nunca a antecedência', () => {
  const core = corpoDaFuncao('_cancel_class_core')

  it('o `if` que abre o crédito compara QUEM PEDIU, e mais nada', () => {
    expect(core).toContain("if p_cancelled_by = 'teacher' then")
    // o ramo do crédito vem DEPOIS desse `if` (e não de nenhuma comparação de hora)
    expect(core.indexOf("if p_cancelled_by = 'teacher' then")).toBeLessThan(
      core.indexOf('_earn_for_lost_class'),
    )
  })

  it('`min_notice_hours` aparece UMA vez, dentro do `diff` do audit — nunca num `if`', () => {
    const linhas = core.split('\n').filter((l) => l.includes('min_notice_hours'))
    expect(linhas).toHaveLength(1)
    // é a linha do `jsonb_build_object` do `log_audit`: chave e valor juntos
    expect(linhas[0].trim()).toBe("'min_notice_hours', v_contract.min_notice_hours,")
    expect(core.indexOf('log_audit')).toBeLessThan(core.indexOf('min_notice_hours'))
    // e nenhuma comparação: se algum dia ela virar regra, este caso reprova
    expect(linhas[0]).not.toMatch(/\bif\b|[<>]=?|between|interval/i)
  })

  it('a antecedência só existe como GUARDA DE ESTADO, e o que ela faz é `raise`', () => {
    const guarda =
      'if now() >= v_inst.starts_at_utc and p_notified_at >= v_inst.starts_at_utc then'
    expect(core).toContain(guarda)
    const depois = core.slice(core.indexOf(guarda) + guarda.length, core.indexOf(guarda) + 260)
    expect(depois).toContain('raise exception')
    expect(depois).toContain('use no_show_student/no_show_teacher')
    // …e não um ramo de crédito escondido
    expect(depois).not.toContain('_earn_for_lost_class')
    expect(depois).not.toContain('makeup_ledger')
  })

  it('cancelamento pelo ALUNO não credita em NENHUM caminho da função', () => {
    // o `else` do `if p_cancelled_by = 'teacher'` não existe: fora do ramo da
    // professora, `v_credited` fica no valor de inicialização.
    expect(core).toContain('v_credited boolean := false')
    const ramo = core.slice(core.indexOf("if p_cancelled_by = 'teacher' then"))
    expect(norm(ramo.slice(0, ramo.indexOf('perform public._enqueue')))).not.toContain('else if')
    // e a frase da linha diz isso, com a razão certa
    expect(CONSEQUENCIA.cancelada_aluno).toContain('em nenhuma antecedência')
    expect(CONSEQUENCIA.cancelada_aluno).toContain('quem decide é quem pediu o cancelamento')
    expect(CONSEQUENCIA.cancelada_aluno).not.toMatch(/prazo/i)
  })

  it('a frase da action LEGADA parou de culpar o prazo (afirmação nº 1 da medição)', () => {
    // `cancelClassAction` continua servindo a ficha do aluno (fora do território
    // do A5) e continua na ponte `?msg=` — o que não podia continuar é a mentira.
    const fonte = readFileSync(join(process.cwd(), 'src/app/admin/agenda/actions.ts'), 'utf8')
    const frase = /'Aula cancelada — sem crédito de reposição\.[^']*'/.exec(fonte)?.[0] ?? ''
    expect(frase, 'a frase do ramo sem crédito desapareceu — remedir').not.toBe('')
    expect(frase).toContain('quem pediu o cancelamento')
    expect(frase).not.toMatch(/fora do prazo|prazo mínimo|antecedência do aviso[^:]*decide/i)
  })
})

describe('A5/L5 · A EXCEÇÃO DO ESTORNO — crédito na falta da professora NÃO é garantido', () => {
  const refund = corpoDaFuncao('_refund_for_credit_born_class')

  it('gasto sem identidade RETORNA sem inserir nada no ledger', () => {
    const guarda = 'if v_spend.consumes_ledger_id is null then'
    expect(refund).toContain(guarda)
    // o `return` acontece ANTES do único insert da função (Lei 2: nada de
    // inventar crédito quando a identidade do gasto não existe)
    expect(refund.indexOf(guarda)).toBeLessThan(refund.indexOf('insert into makeup_ledger'))
    const bloco = refund.slice(refund.indexOf(guarda), refund.indexOf('insert into makeup_ledger'))
    expect(bloco).toContain('o_blocked := ')
    expect(bloco).toMatch(/\breturn;/)
    expect(bloco).toContain('crédito só via ajuste manual')
  })

  it('os dois caminhos da professora passam pelo MESMO par de funções', () => {
    for (const fn of ['_mark_no_show', '_cancel_class_core']) {
      const corpo = corpoDaFuncao(fn)
      expect(corpo, fn).toContain("_refund_for_credit_born_class(p_instance, 'school'")
      expect(corpo, fn).toContain("_earn_for_lost_class(p_instance, p_actor, 'school')")
      // e `credited` do audit vem da VALIDADE devolvida, não de um `true` fixo
      expect(corpo, fn).toContain('v_credited := v_expires is not null')
    }
  })

  it('as duas frases da professora ADMITEM a exceção (não afirmam o crédito)', () => {
    for (const d of ['falta_professora', 'cancelada_professora'] as const) {
      expect(CONSEQUENCIA[d], d).toContain('Em regra o aluno ganha um crédito de reposição')
      expect(CONSEQUENCIA[d], d).toContain('exceção')
      expect(CONSEQUENCIA[d], d).toMatch(/crédito antigo sem identidade/)
    }
    // e a declaração do estado não DEDUZ crédito da situação: manda ler a trilha
    expect(DECLARACAO_DO_ESTADO.falta_professora).toContain('aba Histórico')
    expect(DECLARACAO_DO_ESTADO.cancelada).toContain('aba Histórico')
  })

  it('a trilha lida pela action é a que cada função ESCREVE', () => {
    // `_mark_no_show` grava `'no_show_' || p_who`; `_cancel_class_core` grava
    // `'cancel_class'` — são os dois nomes que a action consulta.
    expect(corpoDaFuncao('_mark_no_show')).toContain("'no_show_' || p_who")
    expect(corpoDaFuncao('_cancel_class_core')).toContain("'cancel_class', 'class_instances'")
    // …e os três campos que o recado lê existem no `diff` das duas
    for (const fn of ['_mark_no_show', '_cancel_class_core']) {
      const corpo = corpoDaFuncao(fn)
      for (const campo of ['credited', 'expires_on', 'refund_blocked'])
        expect(corpo, `${fn} · ${campo}`).toContain(`'${campo}'`)
    }
  })
})

describe('A5/L5 · O AVISO AO ALUNO — cancelar ENFILEIRA sempre; os outros três, nunca', () => {
  // ⚠️ ESTE PINO MUDOU DE AFIRMAÇÃO NO A6/lote 2 (migration 99), e a mudança é
  // de PREMISSA, não de detalhe: até a 98 o aviso era INCONDICIONAL nos dois
  // canais, e era isso que sustentava o "e-mail sempre" da frase da tela. Agora
  // a dona ESCOLHE os canais — e o que continua incondicional é a CHAMADA do
  // enfileiramento (fora de qualquer `if`, com os defaults ligados). Quem lê a
  // frase da tela precisa saber a diferença: "sempre avisa" morreu; "sempre
  // passa pelo enfileiramento, com a escolha dela" é o que existe.
  it('`_enqueue_class_cancelled` é chamada FORA de qualquer `if`, com os canais escolhidos', () => {
    const core = corpoDaFuncao('_cancel_class_core')
    const linha = core.split('\n').find((l) => l.includes('_enqueue_class_cancelled'))
    expect(linha, 'a chamada do aviso desapareceu — remedir a frase').toBeDefined()
    // indentação de 2 espaços = nível de topo do corpo da função (dentro de um
    // `if` seriam 4). É esta medida que sustenta o "SEMPRE PASSA POR AQUI".
    expect(linha).toMatch(/^ {2}perform public\._enqueue_class_cancelled\(/)
    // …e ela carrega a ESCOLHA, em vez de decidir por conta própria
    expect(linha).toContain('p_notify_email')
    expect(linha).toContain('p_notify_whatsapp')
    // …e ela vem DEPOIS do ramo do crédito: o último `end if;` antes dela fecha
    // aquele ramo, então não há `if` aberto sobre a chamada. Prova de mutação
    // barata: mover a chamada para dentro do `if p_cancelled_by = 'teacher'`
    // deixaria a indentação em 4 espaços e este caso vermelho.
    const linhas = core.split('\n').map((l) => l.trim())
    const onde = linhas.findIndex((l) => l.includes('_enqueue_class_cancelled'))
    const anterior = linhas
      .slice(0, onde)
      .filter((l) => l !== '' && !l.startsWith('--'))
      .at(-1)
    expect(anterior).toBe('end if;')
  })

  it('os DOIS canais nascem LIGADOS — o default preserva o comportamento de sempre', () => {
    // A prova que impede o A6 de virar um cancelamento silencioso por descuido:
    // quem chamar sem dizer nada (o aluno, pela `cancel_my_class`; o tratamento
    // de período; qualquer migration futura) continua avisando pelos dois.
    for (const fn of ['_cancel_class_core', '_enqueue_class_cancelled', 'cancel_class']) {
      const corpo = corpoDaFuncao(fn)
      expect(corpo, fn).toContain('p_notify_email boolean default true')
      expect(corpo, fn).toContain('p_notify_whatsapp boolean default true')
    }
    // …e `cancel_my_class` NÃO passa canal nenhum: o aluno não escolhe deixar
    // de se avisar, e é o default que responde por ele.
    const meu = corpoDaFuncao('cancel_my_class')
    expect(meu).toContain("public._cancel_class_core(p_instance, 'student', now(), auth.uid(), 'self')")
    expect(meu).not.toContain('p_notify_')
  })

  it('dentro dela: e-mail sob o flag, WhatsApp sob o flag E o `whatsapp_e164`', () => {
    const eq = corpoDaFuncao('_enqueue_class_cancelled')
    const ifEmail = eq.indexOf('if p_notify_email then')
    const email = eq.indexOf("'class-cancelled', v_row.profile_id")
    const ifWa = eq.indexOf('if p_notify_whatsapp and coalesce(v_wa, false) then')
    const wa = eq.indexOf("'whatsapp', 'class-cancelled'")
    expect(ifEmail).toBeGreaterThan(-1)
    expect(email).toBeGreaterThan(-1)
    expect(ifWa).toBeGreaterThan(-1)
    expect(wa).toBeGreaterThan(-1)
    // o e-mail é inserido sob o SEU flag, e antes do bloco do WhatsApp
    expect(ifEmail).toBeLessThan(email)
    expect(email).toBeLessThan(ifWa)
    // …e o WhatsApp DENTRO do dele, com a condição do número PRESERVADA: o flag
    // é um segundo portão, nunca um jeito de furar o primeiro (marcar a caixa
    // não inventa número no cadastro).
    expect(ifWa).toBeLessThan(wa)
    expect(eq).toContain('p.whatsapp_e164 is not null')
  })

  it('as duas frases de cancelamento declaram os dois canais, com a condição certa', () => {
    for (const d of ['cancelada_professora', 'cancelada_aluno'] as const) {
      expect(CONSEQUENCIA[d], d).toContain('fica REGISTRADO para envio')
      expect(CONSEQUENCIA[d], d).toContain('e-mail')
      expect(CONSEQUENCIA[d], d).toMatch(/quando há WhatsApp no cadastro/)
    }
  })

  it('REGISTRAR NÃO É ENVIAR, E ENVIAR NÃO É ENTREGAR: as frases não prometem', () => {
    // O que os dois casos acima provam é INSERÇÃO na outbox — e nada além disso.
    // Nem "dispara" servia (Sol · rodada 2 do A5): a action não chama
    // `dispatchOutbox`; quem despacha é o worker/cron, e o despacho
    // (`src/lib/outbox/dispatch.ts`) pode ficar pendente por falta de e-mail no
    // perfil, falta de número, driver desligado ou rede — o insert ainda é
    // `on conflict (dedupe_key) do nothing`. A frase promete o REGISTRO e a
    // remissão é a tela de AVISOS, onde se vê se o aviso SAIU.
    const promessas = [
      /o aluno é avisado/i,
      /o aluno recebe/i,
      /foi avisado/i,
      /vai receber/i,
      /\bdispara\b/i,
      /o aviso chegou/i,
    ]
    const superficies = [
      ...Object.values(CONSEQUENCIA),
      ...Object.values(DECLARACAO_DO_ESTADO).filter((v): v is string => typeof v === 'string'),
    ]
    for (const frase of superficies)
      for (const p of promessas) expect(frase, frase.slice(0, 40)).not.toMatch(p)
    // …e a frase manda conferir na tela certa: AVISOS é o nome da TELA
    // (`/admin/avisos`); "Mensagens" é o rótulo do MENU, e mandar a dona procurar
    // uma tela com outro nome é mandá-la para lugar nenhum.
    // A REMISSÃO USA O RÓTULO DO MENU (revisão independente do A5, médio 3): a
    // barra lateral chama a rota `/admin/avisos` de "Mensagens"
    // (`src/components/admin/nav.ts`). Mandar a dona procurar "Avisos" é mandá-la
    // procurar um item que não existe na navegação dela.
    for (const d of ['cancelada_professora', 'cancelada_aluno'] as const) {
      expect(CONSEQUENCIA[d], d).toContain('Mensagens')
      expect(CONSEQUENCIA[d], d).not.toMatch(/confere em Avisos/)
    }
  })

  it('realizada e as duas faltas NÃO avisam ninguém — e as frases dizem isso', () => {
    // Nenhum `_enqueue_*` e nenhum `notification_outbox` nos dois corpos (nem no
    // `report_class_content`, que `complete_class` chama para o apontamento).
    for (const fn of ['complete_class', '_mark_no_show', 'report_class_content']) {
      const corpo = corpoDaFuncao(fn)
      expect(corpo, fn).not.toContain('_enqueue')
      expect(corpo, fn).not.toContain('notification_outbox')
    }
    for (const d of ['realizada', 'falta_aluno', 'falta_professora'] as const)
      expect(CONSEQUENCIA[d], d).toMatch(/[Nn]enhum aviso é enviado/)
  })
})

describe('A5/L5 · O GATE POR SITUAÇÃO — nos DOIS sentidos', () => {
  /** O desfecho → a RPC que a action chama, MEDIDO (não declarado). */
  async function rpcDe(desfecho: string): Promise<string> {
    mock.rpcs = []
    mock.respostas.audit_log = { data: { diff: {} } }
    await registrar({ desfecho })
    return String(mock.rpcs[0]?.[0] ?? '')
  }

  it('aula FUTURA: a tela oferece EXATAMENTE os desfechos cuja RPC não recusa o futuro', async () => {
    // O lado apertado também é defeito: esconder um desfecho que o banco aceita
    // tira trabalho legítimo da dona. Por isso os dois conjuntos são comparados.
    const recusaFuturo: string[] = []
    for (const d of DESFECHOS) {
      const rpc = await rpcDe(d)
      const corpo = corpoDaFuncao(rpc) + '\n' + nucleoDe(rpc).corpo
      if (/raise exception '(a )?aula[^']*ainda não começou/.test(corpo)) recusaFuturo.push(d)
    }
    // medido: realizada (`complete_class`) e as duas faltas (`_mark_no_show`)
    expect(recusaFuturo).toEqual(['realizada', 'falta_aluno', 'falta_professora'])
    const oferecidos = [...opcoesDaSituacao('agendada')]
    expect(oferecidos.sort()).toEqual(
      DESFECHOS.filter((d) => !recusaFuturo.includes(d)).slice().sort(),
    )
  })

  it('as três guardas de estado das RPCs, lidas: `scheduled` + a janela de tempo', () => {
    const cl = corpoDaFuncao('complete_class')
    expect(cl).toContain("if v_state <> 'scheduled' then")
    expect(cl).toContain('if v_starts > now() then')
    const mn = corpoDaFuncao('_mark_no_show')
    expect(mn).toContain("if v_inst.state <> 'scheduled' then")
    expect(mn).toContain('if now() <= v_inst.starts_at_utc then')
    const cc = corpoDaFuncao('_cancel_class_core')
    expect(cc).toContain("if v_inst.state <> 'scheduled' then")
    // …e é por exigirem `scheduled` que aula COM desfecho não oferece nada
    for (const s of ['realizada', 'falta_aluno', 'falta_professora', 'cancelada', 'remarcada'] as const)
      expect(opcoesDaSituacao(s), s).toEqual([])
  })

  it('aula que TERMINOU: cancelar continua oferecido porque a recusa é CONDICIONAL', () => {
    // `_cancel_class_core` só recusa aula começada quando o aviso NÃO a precedeu:
    // a guarda é uma conjunção com `p_notified_at`. Logo o cancelamento é
    // legítimo em `sem_registro` — e é por isso que o formulário tem o campo da
    // hora do aviso (a prova de DOM está em `onda-agenda-a5-dom.test.ts`).
    const cc = corpoDaFuncao('_cancel_class_core')
    expect(cc).toContain('and p_notified_at >= v_inst.starts_at_utc')
    expect(opcoesDaSituacao('sem_registro')).toEqual(DESFECHOS)
    // e a recusa TEM tradução própria, com o conserto na frase
    const fonte = readFileSync(join(process.cwd(), 'src/app/admin/agenda/actions.ts'), 'utf8')
    expect(fonte).toContain('já começou e o aviso não a precedeu')
  })

  it('o default de `p_notified_at` é `now()` — em branco, a guarda vale de verdade', () => {
    // A action só manda `p_notified_at` quando a dona informa a hora. Sem ele o
    // banco usa `now()`, que em aula passada dispara a guarda: o "em branco =
    // agora" do campo é fiel ao que a função faz.
    expect(corpoDaFuncao('cancel_class')).toContain('p_notified_at timestamptz default now()')
  })
})

/* ========================================================================== */
/* 11. L5 · VARREDORES DA RÉGUA — a frase falsa não volta                      */
/* ========================================================================== */

/**
 * As superfícies onde uma frase de crédito pode chegar a uma PESSOA.
 *
 * ── POR QUE A LISTA CRESCEU (Sol · rodada 1 do A5, médio 8) ─────────────────
 * A primeira versão varria só os seis arquivos do A5, e por isso deu VERDE em
 * cima da sexta frase falsa — que vivia no PORTAL DO ALUNO. Varredor central que
 * não varre o centro é pior que varredor nenhum: ele produz a sensação de
 * cobertura. Agora entram, além do A5:
 *   · `src/data/admin/actions.ts` — a action do Início/ficha, cujo TOAST de
 *     desfecho afirma crédito;
 *   · `src/data/admin/ficha-gramatica.ts` e `src/lib/kit/tom-do-aviso.ts` — as
 *     duas listas de frase que atravessam a tela da dona;
 *   · o PORTAL inteiro (varrido por diretório, não por lista à mão: tela nova do
 *     aluno entra na rede sem ninguém lembrar de adicioná-la).
 */
const SUPERFICIES_DO_A5 = [
  'src/app/admin/agenda/page.tsx',
  'src/app/admin/agenda/actions.ts',
  'src/components/admin/agenda/DesfechoDaAula.tsx',
  // A6/lote 2: a confirmação destrutiva fala de aviso e de crédito, então entra
  // no varredor no MESMO commit em que nasce — superfície nova que fala de
  // dinheiro sem varredura é como as frases falsas do A5 sobreviveram.
  'src/components/admin/agenda/ConfirmarDesfecho.tsx',
  // A7: a moldura do lote nasce varrida, pela MESMA razão do lote 2 do A6 —
  // superfície nova que fala de aula registrada e de extrato sem varredura é
  // como as frases falsas do A5 sobreviveram.
  'src/components/admin/agenda/ConfirmarLote.tsx',
  'src/components/admin/agenda/BalaoDaAula.tsx',
  'src/components/admin/agenda/AbasDaAula.tsx',
  'src/lib/admin/desfecho-da-aula.ts',
  'src/data/admin/actions.ts',
  'src/data/admin/ficha-gramatica.ts',
  'src/lib/kit/tom-do-aviso.ts',
]

/**
 * Todo `.tsx`/`.ts` de uma árvore — por DIRETÓRIO, para tela nova já nascer
 * varrida em vez de esperar alguém lembrar de adicioná-la a uma lista.
 */
function telasDe(dir: string): string[] {
  const saida: string[] = []
  for (const entrada of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = `${dir}/${entrada.name}`
    if (entrada.isDirectory()) saida.push(...telasDe(rel))
    else if (entrada.name.endsWith('.tsx') || entrada.name.endsWith('.ts')) saida.push(rel)
  }
  return saida.sort()
}

const telasDoPortal = () => telasDe('src/app/portal')

/**
 * As superfícies do ADMIN que ESTE lote passou a tocar, varridas por diretório:
 * o Início inteiro (o cartão de pendências afirmava pagamento condicionado a
 * apontamento), a ficha do aluno inteira (as origens do crédito e o hint de "quem
 * cancelou") e a remarcação. Mais a camada de dados da ficha, que escreve as
 * frases do extrato de créditos.
 *
 * ⚠️ LACUNA DECLARADA (vai escrita no goal): e-mails/templates,
 * `src/lib/notify/` e o painel da professora NÃO entram — este lote não os toca, e
 * varrer o que ninguém revisou produziria vermelho sem dono.
 */
const SUPERFICIES_VIZINHAS = [
  ...telasDe('src/components/admin/inicio'),
  ...telasDe('src/components/admin/alunos/ficha'),
  ...telasDe('src/app/admin/agenda/remarcar'),
  // A7: o TRATAMENTO DE PERÍODO entra na varredura. Ele cancela aulas em LOTE e
  // fala de crédito de reposição em três lugares (o rótulo do modo, o título do
  // chip do feriado e a frase de alcance da prévia) — e não estava em lista
  // nenhuma. Milestone que reescreve a cópia de uma tela de dinheiro põe a tela
  // na rede no mesmo commit.
  'src/app/admin/agenda/periodo/page.tsx',
  'src/data/admin/ficha.ts',
]

/**
 * A MESMA matriz do desfecho vive noutra tela: o `RegistrarDesfecho` do Início
 * (também usado na ficha do aluno, M3-2). A spec do A5 nomeia a frase dele como
 * a afirmação falsa nº 3, e o cabeçalho de `DesfechoDaAula.tsx` diz que as frases
 * novas foram medidas "inclusive para corrigir a que vive no Início".
 */
const SUPERFICIE_GEMEA = ['src/components/admin/inicio/RegistrarDesfecho.tsx']

/**
 * O texto QUE A DONA LÊ.
 *
 * Comentário fora, de propósito: estes arquivos DISCUTEM as frases falsas nos
 * comentários (é lá que a medição está registrada). O crivo é o que chega à tela.
 * Substituição preservando as quebras de linha, para o varredor não confundir
 * fronteira de frase.
 */
function textoDaTela(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1)
    .replace(/\s+/g, ' ')
}

/**
 * As afirmações PROIBIDAS, cada uma com o predicado que a derruba.
 *
 * Não é lista de palavras feias: cada padrão descreve uma atribuição causal que o
 * corpo efetivo das funções contradiz (as medições do §10).
 */
const AFIRMACOES_FALSAS: ReadonlyArray<readonly [string, RegExp]> = [
  [
    'o crédito é decidido pela REGRA DO CONTRATO — `_cancel_class_core` decide por `p_cancelled_by`; nada no contrato decide crédito × perda (as colunas de expiry só definem a VALIDADE)',
    /(crédito|perda)[^.]{0,60}regra do contrato|regra do contrato[^.]{0,60}(crédito|perda)/gi,
  ],
  [
    // APERTADO na rodada 2: `/fora do prazo/` cru reprovaria texto legítimo sobre
    // OUTRO prazo (o de vencimento do crédito, o de assinatura do contrato). O que
    // é falso é ligar prazo/antecedência à decisão do CRÉDITO.
    'o crédito é decidido pela ANTECEDÊNCIA do aviso — `min_notice_hours` entra só no `diff` do audit, como contexto',
    // Só as formas que LIGAM prazo/aviso mínimo à decisão. A frase CORRETA fala
    // de antecedência para NEGAR o vínculo ("não a antecedência", "em nenhuma
    // antecedência"), e um padrão causal cru reprovaria justamente o conserto.
    /fora do prazo (mínimo|de aviso)|prazo mínimo do contrato|aviso mínimo do contrato|decidid[oa] pela regra/gi,
  ],
  [
    'o desfecho LIBERA a hora da professora — `_teacher_payable_hours` já paga `scheduled` de aula passada (contrato não pausado): realizada MANTÉM, não libera',
    /liber(a|ar|ada)[^.]{0,25}hora|hora[^.]{0,25}liberad/gi,
  ],
  [
    'o APONTAMENTO decide a hora do extrato — `_teacher_payable_hours` não consulta `class_content_reports` em lugar nenhum',
    /sem apontamento[^.]{0,90}n[ãa]o (conta|pode contar) no extrato|n[ãa]o (conta|pode contar) no extrato[^.]{0,90}sem apontamento/gi,
  ],
  [
    'o crédito na falta da professora é AFIRMADO sem a exceção — `_refund_for_credit_born_class` volta SEM creditar quando `consumes_ledger_id is null`',
    /aluno ganh(a|ou) um crédito de reposição\./gi,
  ],
  [
    // FAMÍLIA NOVA (Sol · rodada 2): PROMESSA DE ENTREGA. O sistema INSERE na
    // `notification_outbox`; quem despacha é o worker, e a entrega depende de
    // e-mail no perfil, número no cadastro, driver e rede. Nenhuma tela pode
    // afirmar que a pessoa foi avisada, recebeu ou que o aviso chegou.
    'a tela promete ENTREGA de aviso — o que o sistema garante é o REGISTRO para envio (`_enqueue_*` insere na outbox com `on conflict do nothing`); a entrega depende do despacho, do canal e do cadastro',
    // As formas OUTBOUND, e só elas: "quando o aviso chegou" é o rótulo do campo
    // em que a dona informa que o ALUNO avisou a escola — sentido inverso, texto
    // legítimo.
    // ⚠️ SEM `\b` antes de vogal acentuada: `\b` é ASCII, e `\bé` nunca casa depois
    // de espaço (`é` não é word char) — o padrão daria 0 achados para "é avisado",
    // o caso mais óbvio da família. Foi assim que a prova de mutação o pegou.
    /(é|foi|será|serão|são)\s+avisad[oa]s?\b|\brecebe(m|u|rá)?\s+(os?\s+|as?\s+)?(aviso|avisos|lembrete|lembretes|confirmação)\b|tem número\s*→\s*recebe|\b(aviso|avisos|lembrete|lembretes|confirmação)[^.]{0,20}\bchega(m)?[^.]{0,12}\b(por|no|pelo|pela|em)\b/gi,
  ],
  [
    // FAMÍLIA NOVA (Sol · rodada 2): PAGAMENTO CONDICIONADO A APONTAMENTO.
    // `_teacher_payable_hours` não consulta `class_content_reports` em lugar
    // nenhum — aula passada `scheduled` (contrato não pausado) JÁ está na soma.
    'a tela condiciona o PAGAMENTO da professora ao apontamento — `_teacher_payable_hours` não consulta `class_content_reports`: a hora da aula passada já conta, e o apontamento fecha o registro pedagógico (é o que `complete_class` exige)',
    /(receb|pag\w*|hora)[^.]{0,60}(depois|após)\s+d[oa]\s+apontamento|apontamento[^.]{0,60}(libera|destrava|autoriza)[^.]{0,25}(pagamento|hora|extrato)|só receb\w+[^.]{0,60}apontamento/gi,
  ],
  [
    'a origem do crédito é declarada EXCLUSIVA ("só aparece por…") — ele nasce de TRÊS lugares: cancelamento pela escola (`_cancel_class_core` com `p_cancelled_by=teacher`), falta da professora (`_mark_no_show` com `p_who=teacher`) e ajuste manual (`admin_makeup_adjust` com `p_delta > 0`)',
    /(crédito|reposiç\w+)[^.]{0,40}só (aparece|nasce|existe|vem|surge)|só (aparece|nasce|existe|vem|surge)[^.]{0,40}(crédito|reposiç\w+)/gi,
  ],
  [
    // O tempo do verbo NÃO é detalhe de estilo aqui: "GANHOU (vale até …)" é FATO
    // lido da trilha (`credited === true` no `audit_log`) e continua verdadeiro
    // por construção; "ganha/gera/vira" é REGRA prometida, e regra sem a exceção
    // é a frase falsa nº 4. Por isso este padrão só olha o presente.
    'o crédito é prometido como REGRA, sem a exceção por perto — `_refund_for_credit_born_class` volta SEM creditar quando a aula perdida nasceu de um gasto sem identidade, e toda frase que promete crédito tem de admitir isso na vizinhança (casos raros / em regra / exceção / não volta sozinho)',
    // A NEGATIVA não é promessa: "o aluno NÃO ganha crédito" e "cancelar de vez
    // não vira crédito" são o contrário do que este padrão persegue.
    /(?<!\bnão\s)(?<!\bnem\s)(ganha|ganham|gera|geram|vira|viram|dá|dão)\s+(um\s+)?crédito(?![\s\S]{0,250}?(casos? raros?|em regra|exceç|não volta sozinho|não devolve sozinho))/gi,
  ],
]

/** Os achados de afirmação falsa nos arquivos dados, prontos para colar no goal. */
/**
 * A varredura. `familias` permite rodar um SUBCONJUNTO dos padrões — e há uma só
 * razão para isso, escrita aqui para não virar folga: a família ENTREGA é conserto
 * deste lote nas superfícies que ele TOCA (agenda, Início, ficha, remarcação), e o
 * PORTAL tem frases de entrega em telas que este lote não abriu
 * (`portal/actions.ts`, `portal/perfil`). Varrê-las agora produziria vermelho sem
 * dono; a lacuna vai ESCRITA no goal, com os arquivos nomeados. As famílias de
 * CRÉDITO valem em todas as superfícies, sem exceção.
 */
function varrerAfirmacoes(
  arquivos: readonly string[],
  familias: ReadonlyArray<readonly [string, RegExp]> = AFIRMACOES_FALSAS,
): string[] {
  const achados: string[] = []
  for (const rel of arquivos) {
    const texto = textoDaTela(rel)
    for (const [oQue, regex] of familias)
      for (const m of texto.matchAll(regex)) achados.push(`${rel} → «${m[0]}»\n     porque: ${oQue}`)
  }
  return achados
}

/** As famílias de CRÉDITO (tudo menos a de entrega) — ver `varrerAfirmacoes`. */
const FAMILIAS_DE_CREDITO = AFIRMACOES_FALSAS.filter(
  ([oQue]) => !oQue.startsWith('a tela promete ENTREGA'),
)

describe('A5/L5 · varredor: nenhuma afirmação falsa de dinheiro nas telas do A5', () => {
  it('ANTI-CEGUEIRA: a limpeza de comentário não engole o texto da tela', () => {
    // Um varredor que apagasse demais ficaria verde para sempre. Cada arquivo
    // precisa continuar mostrando uma frase VIVA depois da limpeza.
    const testemunhas: Record<string, string> = {
      'src/app/admin/agenda/page.tsx': 'Nenhuma aula passada está sem registro',
      'src/app/admin/agenda/actions.ts': 'Aula cancelada — sem crédito de reposição',
      'src/components/admin/agenda/DesfechoDaAula.tsx': 'A professora ainda não apontou',
      'src/components/admin/agenda/BalaoDaAula.tsx': 'Abrir ficha do aluno',
      'src/components/admin/agenda/AbasDaAula.tsx': 'O que fazer com esta aula',
      'src/lib/admin/desfecho-da-aula.ts': 'A hora CONTA no extrato da professora',
      'src/components/admin/inicio/RegistrarDesfecho.tsx': 'Conta como dada',
    }
    for (const [rel, frase] of Object.entries(testemunhas))
      expect(textoDaTela(rel), rel).toContain(frase)
  })

  it('as superfícies do A5 (mais as vizinhas) não atribuem crédito ao prazo nem hora ao apontamento', () => {
    expect(varrerAfirmacoes(SUPERFICIES_DO_A5)).toEqual([])
  })

  it('as superfícies VIZINHAS que este lote tocou (Início, ficha, remarcação)', () => {
    // Guarda de cegueira: a varredura por diretório tem de encontrar as telas.
    expect(SUPERFICIES_VIZINHAS).toContain('src/components/admin/inicio/AndarHoje.tsx')
    expect(SUPERFICIES_VIZINHAS).toContain('src/components/admin/alunos/ficha/paineis.tsx')
    expect(SUPERFICIES_VIZINHAS.length).toBeGreaterThan(10)
    expect(varrerAfirmacoes(SUPERFICIES_VIZINHAS)).toEqual([])
  })

  it('o PORTAL DO ALUNO também — foi onde a sexta frase falsa morava (médio 8)', () => {
    const telas = telasDoPortal()
    // guarda de cegueira: a varredura por diretório tem de ENCONTRAR as telas
    expect(telas).toContain('src/app/portal/creditos/page.tsx')
    expect(telas.length).toBeGreaterThan(8)
    // No portal, as famílias de CRÉDITO (a de entrega tem lacuna declarada).
    expect(varrerAfirmacoes(telas, FAMILIAS_DE_CREDITO)).toEqual([])
  })

  it('a lacuna da família ENTREGA no portal é ESTREITA e nomeada', () => {
    // Guarda da dívida: se a lista crescer, alguém escreveu promessa de entrega
    // nova no portal e precisa consertá-la (ou justificá-la no goal).
    const comEntrega = varrerAfirmacoes(
      telasDoPortal(),
      AFIRMACOES_FALSAS.filter(([oQue]) => oQue.startsWith('a tela promete ENTREGA')),
    ).map((linha) => linha.split(' → ')[0])
    expect([...new Set(comEntrega)].sort()).toEqual([
      'src/app/portal/actions.ts',
      'src/app/portal/perfil/page.tsx',
    ])
  })

  it('a tela GÊMEA (RegistrarDesfecho do Início/ficha) fala a mesma verdade', () => {
    // Duas telas com a MESMA matriz não podem dizer coisas diferentes sobre o
    // mesmo dinheiro: a dona registra desfecho nas duas.
    expect(varrerAfirmacoes(SUPERFICIE_GEMEA)).toEqual([])
  })

  it('PROVA DE MUTAÇÃO do varredor: ele acha a frase antiga quando ela existe', () => {
    // Sem isto, um varredor que não casa com nada ficaria verde para sempre.
    const antiga =
      'sem crédito de reposição (o aviso veio fora do prazo mínimo do contrato) — o sistema aplica a regra do contrato (crédito ou perda) e libera a hora da professora'
    const achados = AFIRMACOES_FALSAS.filter(([, re]) => {
      re.lastIndex = 0
      return re.test(antiga)
    })
    expect(achados.map(([oQue]) => oQue.slice(0, 30))).toHaveLength(3)
  })

  it('PROVA DE MUTAÇÃO · as DUAS frases do portal que passaram verdes antes', () => {
    // Exclusividade e universalidade — as duas que o varredor de seis arquivos
    // não pegava porque não olhava o portal, e que os padrões antigos não
    // reconheciam nem se olhassem.
    const pega = (frase: string) =>
      AFIRMACOES_FALSAS.filter(([, re]) => {
        re.lastIndex = 0
        return re.test(frase)
      }).length
    expect(pega('Crédito só aparece quando a escola precisa desmarcar uma aula sua.')).toBeGreaterThan(0)
    expect(pega('Você ganha um crédito quando a escola precisa desmarcar uma aula sua.')).toBeGreaterThan(0)
    expect(pega('Todo cancelamento da escola gera crédito para você.')).toBeGreaterThan(0)
    // …as DUAS famílias novas da rodada 2
    expect(pega('O aluno é avisado do cancelamento por e-mail.')).toBeGreaterThan(0)
    expect(pega('Tem número → recebe.')).toBeGreaterThan(0)
    expect(pega('O aluno recebe a confirmação por e-mail/WhatsApp.')).toBeGreaterThan(0)
    expect(pega('a professora só recebe pela aula depois do apontamento')).toBeGreaterThan(0)
    expect(pega('o apontamento libera a hora no extrato dela')).toBeGreaterThan(0)
    // …e o aperto do `fora do prazo`: prazo de OUTRA coisa é texto legítimo
    expect(pega('Seu crédito está fora do prazo de validade e não vira mais aula.')).toBe(0)
    expect(pega('O aviso do cancelamento fica REGISTRADO para envio: e-mail sempre.')).toBe(0)
    // …e o texto NOVO, com origens no plural e a exceção por perto, passa limpo
    expect(
      pega(
        'Você ganha um crédito quando a escola desmarca uma aula sua ou quando a professora falta. Em casos raros — quando a aula perdida já era, ela mesma, uma reposição antiga — o crédito não volta sozinho.',
      ),
    ).toBe(0)
  })
})

/* ========================================================================== */
/* 12. RODADA 1 DO SOL — os consertos que precisavam de prova própria          */
/* ========================================================================== */

describe('A5 · histórico: a MESMA linha da trilha não vira dois eventos (médio 1)', () => {
  it('remarcação com origem e nova em BLOCOS diferentes volta uma vez de cada lado', async () => {
    // A fatia de 40 é dos IDS VISÍVEIS, não dos registros: com a origem no bloco
    // 1 e a aula nova no bloco 2, a MESMA linha do `audit_log` casa nos dois
    // `or` e volta duas vezes. Sem dedupe por `audit_log.id`, cada papel era
    // criado em dobro — dois eventos idênticos na aba e duas `key` iguais na
    // lista do React (a chave é `<id>:<papel>`).
    const enchimento = Array.from(
      { length: 39 },
      (_, i) => `bbbbbbbb-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`,
    )
    const linha = linhaCrua({
      id: 500,
      action: 'reschedule_class',
      entity_id: NOVA,
      diff: { rescheduled_from: AULA, old_starts_at_utc: '2026-08-04T17:00:00+00:00' },
    })
    // os dois blocos devolvem a mesma linha — é o que o PostgREST faz
    mock.fila.audit_log = [{ data: [linha] }, { data: [linha] }]

    const h = await historicoDaAula([AULA, ...enchimento, NOVA])
    expect((mock.chamadas.audit_log ?? []).filter((c) => c[0] === 'select')).toHaveLength(2)
    expect(h[AULA], 'a aula de ORIGEM').toHaveLength(1)
    expect(h[NOVA], 'a aula NOVA').toHaveLength(1)
    expect(h[AULA][0].titulo).toBe('Remarcada para outro horário')
    expect(h[NOVA][0].titulo).toBe('Nasceu de uma remarcação')
    // e as chaves de lista são únicas dentro de cada aula
    for (const id of [AULA, NOVA]) {
      const chaves = h[id].map((e) => e.chave)
      expect(new Set(chaves).size, id).toBe(chaves.length)
    }
  })

  it('`via` só é PORTA em `cancel_class` (médio 2)', async () => {
    mock.respostas.audit_log = {
      data: [
        linhaCrua({ id: 1, action: 'cancel_class', entity_id: AULA, diff: { via: 'admin' } }),
        // uma ação que TAMBÉM grava `via`, com outro sentido: não pode virar porta
        linhaCrua({ id: 2, action: 'complete_class', entity_id: AULA, diff: { via: 'admin' } }),
      ],
    }
    const h = await historicoDaAula([AULA])
    expect(h[AULA][0].porQuem).toBe('pela escola')
    expect(h[AULA][1].porQuem).toBeNull()
  })
})

describe('A5/L1 · o porteiro canonicaliza o caminho (médio 3)', () => {
  const travessias = [
    '/admin/agenda/../ajustes',
    '/admin/agenda/./../alunos',
    '/admin/agenda/%2e%2e/ajustes',
    // `%2f` NÃO é separador de caminho para o parser nem para o navegador: isto
    // seria UM segmento (inexistente) dentro da seção. A versão anterior deste
    // teste ABENÇOAVA isso como "404 honesto, com o cookie chegando" — e estava
    // errada: no 404 ninguém pinta o recado, então o desfecho acontece e
    // desaparece. Agora o porteiro exige subrota EXISTENTE e isto cai na casa
    // (Sol · rodada 2 do A5).
    '/admin/agenda/..%2fajustes',
    '/admin/agenda/subpasta/../../ajustes',
  ]
  for (const cru of travessias) {
    it(`travessia ${JSON.stringify(cru)} não escapa da seção`, () => {
      const alvo = destinoDaSecao('agenda', cru)
      // O que importa é o `path` do COOKIE **e** a rota EXISTIR: fora da seção o
      // navegador não envia `recado_agenda`; numa subrota inexistente a dona cai
      // num 404, onde ninguém pinta o recado. Nos dois casos o desfecho
      // desaparece em silêncio, então o porteiro devolve a CASA.
      expect(alvo === '/admin/agenda' || alvo === '/admin/agenda/periodo').toBe(true)
      expect(alvo.startsWith('/admin/ajustes')).toBe(false)
      expect(alvo.startsWith('/admin/alunos')).toBe(false)
      // e nenhum SEGMENTO de ponto sobrevive para o navegador normalizar depois
      // (segmento, não substring: `..%2fajustes` é um nome de pasta que o
      // navegador não desmonta — ver a nota na lista acima)
      const segmentos = alvo.split('?')[0].split('/')
      expect(segmentos).not.toContain('..')
      expect(segmentos).not.toContain('.')
    })
  }

  it('`.` e `..` que NÃO escapam voltam normalizados, não crus', () => {
    expect(destinoDaSecao('agenda', '/admin/agenda/./periodo')).toBe('/admin/agenda/periodo')
    expect(destinoDaSecao('agenda', '/admin/agenda/x/../periodo?v=dia')).toBe(
      '/admin/agenda/periodo?v=dia',
    )
  })

  it('subrota que NÃO existe cai na casa — 404 engole o recado (médio)', () => {
    // As três rotas reais da seção passam…
    expect(destinoDaSecao('agenda', '/admin/agenda/periodo')).toBe('/admin/agenda/periodo')
    expect(destinoDaSecao('agenda', '/admin/agenda/remarcar/abc-123')).toBe(
      '/admin/agenda/remarcar/abc-123',
    )
    // …e o que não existe volta para a casa, em vez de virar um 404 sem recado.
    for (const inventada of [
      '/admin/agenda/qualquercoisa',
      '/admin/agenda/periodo/extra',
      '/admin/agenda/remarcar',
      '/admin/agenda/remarcar/a/b',
    ])
      expect(destinoDaSecao('agenda', inventada), inventada).toBe('/admin/agenda')
    // Ajustes é página ÚNICA: qualquer subcaminho cai na casa.
    expect(destinoDaSecao('ajustes', '/admin/ajustes/qualquer')).toBe('/admin/ajustes')
  })
})

describe('A5 · o gate mede os QUATRO momentos da aula (médio 10)', () => {
  const DONA = { id: 't-1', display_name: 'Teacher Vicky', is_owner: true, iana_tz: 'America/Cuiaba' }
  // 14:00–14:45 em Cuiabá (UTC−4) = 18:00–18:45Z
  const AULA_CRUA = {
    id: 'i-momentos',
    starts_at_utc: '2026-07-29T18:00:00+00:00',
    ends_at_utc: '2026-07-29T18:45:00+00:00',
    state: 'scheduled',
    teacher_id: 't-1',
    confirmed_at: null,
    // F5: o trio da avulsa entrou na projeção do dia (fixture de aula de contrato)
    single_kind: null,
    single_price_cents: null,
    single_paid_at: null,
    contracts: {
      id: 'c-1',
      plan_name: 'Personal One',
      students: [{ id: 's-1', display_name: 'Aluna', iana_tz: 'America/Cuiaba' }],
      student_groups: null,
    },
    class_content_reports: [],
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  const situacaoEm = async (agora: string) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(agora))
    mock.respostas = {
      class_instances: { data: [AULA_CRUA] },
      teachers: { data: [DONA] },
      reschedule_windows: { data: [] },
      contracts: { data: [] },
    }
    mock.chamadas = {}
    const agenda = await getAgenda({ visao: 'semana', comJanelas: false, ancora: '2026-07-27' })
    return agenda.aulas[0].situacao
  }

  it('antes do início, NO início e DURANTE a aula: só os dois cancelamentos', async () => {
    for (const agora of [
      '2026-07-29T17:00:00Z', // antes
      '2026-07-29T18:00:00Z', // no instante do início
      '2026-07-29T18:30:00Z', // no meio da aula
    ]) {
      const situacao = await situacaoEm(agora)
      expect(situacao, agora).toBe('agendada')
      expect(opcoesDaSituacao(situacao), agora).toEqual([
        'cancelada_professora',
        'cancelada_aluno',
      ])
    }
  })

  it('depois do FIM: as cinco', async () => {
    const situacao = await situacaoEm('2026-07-29T18:46:00Z')
    expect(situacao).toBe('sem_registro')
    expect(opcoesDaSituacao(situacao)).toEqual(DESFECHOS)
  })

  it('é ESTREITAMENTO DA CASA, não limite do banco — e a tela diz isso', () => {
    // As RPCs aceitariam a partir do INÍCIO: quem espera o fim é esta casa (o
    // achado 3 do A3 — a dona atestava realizada às 14:01 de uma aula que ia até
    // 14:45). A frase da tela tem de atribuir a regra a quem ela é.
    expect(corpoDaFuncao('complete_class')).toContain('v_starts > now()')
    expect(corpoDaFuncao('_mark_no_show')).toContain('now() <= v_inst.starts_at_utc')
    expect(REGRA_DA_CASA_DO_FIM).toContain('regra desta casa')
    // A IGUALDADE separa as duas RPCs (Sol · rodada 2, menor): `complete_class`
    // recusa com `v_starts > now()` (aceita NO instante do início) e
    // `_mark_no_show` com `now() <= starts_at` (recusa NA igualdade). "A partir do
    // horário de início" valia para uma e não para a outra.
    expect(REGRA_DA_CASA_DO_FIM).toMatch(/realizada desde o horário de início/i)
    expect(REGRA_DA_CASA_DO_FIM).toMatch(/falta a partir do minuto seguinte/i)
    // …e não atribui o limite ao Postgres
    expect(REGRA_DA_CASA_DO_FIM).not.toMatch(/o banco (recusa|exige|só aceita)/i)
  })
})

// Bancada Windows (01/09/2026): o replay de TODAS as funções sobre 118
// migrations mede ~18 s aqui (CPU puro, sem banco) contra <5 s no Mac. O teto
// sobe só neste bloco; o que ele prova não mudou.
describe('A5 · o helper das provas de dinheiro (médio 11)', { timeout: 60_000 }, () => {
  it('DROP FUNCTION conta: função dropada e não recriada ESTOURA em vez de mentir', () => {
    // `enqueue_class_reminders` é criada na F6 e DROPada na F7 (`drop function if
    // exists public.enqueue_class_reminders();`) sem recriação. A versão antiga
    // do helper devolvia o corpo dela como se estivesse vivo — e uma prova de
    // dinheiro em cima de função morta é verde falso.
    expect(() => corpoDaFuncao('enqueue_class_reminders')).toThrow(/não encontrada/)
  })

  it('a definição EFETIVA de `complete_class` é a do apontamento (D2), não a de 3 args', () => {
    const efetiva = definicaoDaFuncao('complete_class')
    expect(efetiva.origem).toBe('20260720000300_study_plans_e_apontamento.sql')
    expect(efetiva.corpo).toContain('aula sem apontamento de conteúdo')
    // a de `20260718000400` (três argumentos) foi DROPada por esta migration
    expect(quemDefine('complete_class')).toContain('20260718000400_f2_acoes_de_aula.sql')
  })

  it('o replay do helper concorda com o BANCO em TODAS as 223 funções', () => {
    // A guarda de largura da fundação (Sol · rodada 2 do A5): não basta as 15
    // funções que este lote mede. Se o replay classificar QUALQUER função errado,
    // a prova de dinheiro do lote está em cima de areia — foi assim que se
    // descobriu que o parser engolia comentário SQL dentro da lista de argumentos
    // (`p_via text -- 'admin' | 'self'`) e inventava overload em três funções.
    //
    // As DUAS exceções são reais e conferidas no `pg_proc` do banco local: as duas
    // foram dropadas e nunca recriadas, e por isso NÃO existem. Recriar uma delas
    // exige tirá-la desta lista — que é o aviso que se quer.
    const MORTAS = ['_paused_slot_conflict', 'enqueue_class_reminders']
    const nomes = new Set<string>()
    for (const arquivo of migrations())
      for (const m of sqlDaMigration(arquivo).matchAll(
        /^[ \t]*create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gim,
      ))
        nomes.add(m[1])
    expect(nomes.size).toBeGreaterThan(200)
    const problemas: string[] = []
    for (const n of [...nomes].sort()) {
      try {
        definicaoDaFuncao(n)
        if (MORTAS.includes(n)) problemas.push(`${n}: deveria estar MORTA e resolveu`)
      } catch (e) {
        if (!MORTAS.includes(n)) problemas.push(`${n}: ${(e as Error).message}`)
      }
    }
    expect(problemas).toEqual([])
  })

  it('todas as funções que este lote mede sobrevivem ao replay, sem overload', () => {
    // Se qualquer uma tivesse DUAS assinaturas vivas, o helper estouraria com a
    // lista — é o que impede a prova de cair na função errada em silêncio.
    for (const fn of [
      '_cancel_class_core',
      '_mark_no_show',
      '_refund_for_credit_born_class',
      '_earn_for_lost_class',
      '_teacher_payable_hours',
      '_enqueue_class_cancelled',
      'complete_class',
      'cancel_class',
      'no_show_student',
      'no_show_teacher',
      'report_class_content',
      'admin_makeup_adjust',
      'reschedule_class_at',
    ])
      expect(() => definicaoDaFuncao(fn), fn).not.toThrow()
  })
})

/* ========================================================================== */
/* 13. REVISÃO INDEPENDENTE FRESCA — os consertos finais do A5                 */
/* ========================================================================== */

describe('A5 · o recado do estorno bloqueado manda para a tela que TEM o botão', () => {
  const bloqueio = 'gasto sem identidade (anterior à F1) — crédito só via ajuste manual'

  it('o destino é Contratos → Ajustar, NUNCA a ficha do aluno (grave 1)', async () => {
    // Na ficha o Extrato é append-only e somente leitura (o único gesto de lá é
    // "Estender validade"); quem lança crédito à mão é `admin_makeup_adjust`, e a
    // porta dela é o "Ajustar" do bloco de Créditos do CONTRATO.
    trilha({ credited: false, expires_on: null, refund_blocked: bloqueio })
    const { recado } = await registrar({ desfecho: 'falta_professora' })
    expect(recado?.mensagem).toContain('vá em Contratos')
    expect(recado?.mensagem).toContain('"Ajustar" no bloco de Créditos')
    expect(recado?.mensagem).not.toMatch(/na ficha do aluno/)
    expect(tomDoAviso(recado!.mensagem)).toBe('erro')
  })

  it('no CANCELAMENTO o recado avisa que o aluno já foi informado de "sem crédito"', async () => {
    // `_cancel_class_core` chama `_enqueue_class_cancelled(p_instance, v_credited,
    // v_expires)` DEPOIS do ramo do crédito, e no caminho bloqueado `v_credited` é
    // false: o aviso saiu dizendo que não houve crédito. A dona precisa saber que
    // consertar o saldo não desfaz o que o aluno leu.
    const core = corpoDaFuncao('_cancel_class_core')
    // A6/Lote 2: a chamada ganhou os dois flags de canal — continua UMA linha,
    // no nível de topo, para este pino seguir medindo o que sempre mediu.
    expect(core).toContain('perform public._enqueue_class_cancelled(p_instance, v_credited, v_expires, p_notify_email, p_notify_whatsapp)')
    expect(corpoDaFuncao('_enqueue_class_cancelled')).toContain("'credited', p_credited")

    trilha({ credited: false, expires_on: null, refund_blocked: bloqueio })
    const { recado } = await registrar({ desfecho: 'cancelada_professora' })
    expect(recado?.mensagem).toMatch(/o aviso que saiu para o aluno diz que NÃO houve crédito/)
  })

  it('…e na FALTA não avisa nada disso, porque nenhum aviso saiu', async () => {
    // `_mark_no_show` não enfileira nada: inventar "o aviso já saiu" ali seria a
    // mesma classe de frase falsa, do outro lado.
    expect(corpoDaFuncao('_mark_no_show')).not.toContain('_enqueue')
    trilha({ credited: false, expires_on: null, refund_blocked: bloqueio })
    const { recado } = await registrar({ desfecho: 'falta_professora' })
    expect(recado?.mensagem).not.toMatch(/o aviso que saiu/)
  })
})

describe('A5 · o desfecho é IRREVERSÍVEL, e a tela diz isso (grave 2)', () => {
  it('NENHUMA migration devolve uma aula para `scheduled`', () => {
    // A base da frase: se existisse uma porta de volta, a declaração seria falsa.
    // `insert` com 'scheduled' (criar aula) não conta — o que se procura é o
    // UPDATE que reabriria uma aula que já tem desfecho.
    const reabre = migrations().filter((f) =>
      /update\s+class_instances\s+set\s+state\s*=\s*'scheduled'/i.test(sqlDaMigration(f)),
    )
    expect(reabre).toEqual([])
  })

  it('as quatro situações terminais declaram que não se desfaz, e para onde ir', () => {
    for (const s of ['realizada', 'falta_aluno', 'falta_professora', 'cancelada'] as const) {
      expect(DECLARACAO_DO_ESTADO[s], s).toContain('não se desfaz')
      expect(DECLARACAO_DO_ESTADO[s], s).toContain('"Ajustar" no bloco de Créditos')
    }
    // `remarcada` fica de fora de propósito: ali a aula NÃO teve desfecho — ela foi
    // trocada de horário, e a aula nova é que carrega a vida dela.
    expect(DECLARACAO_DO_ESTADO.remarcada).not.toContain('não se desfaz')
  })
})

describe('A5 · a tela de Mensagens não NEGA o aviso que a Agenda promete (médio 3)', () => {
  // M3-3a (11/10/2026): a tela foi reescrita no kit novo. A tradução dos
  // templates mudou para a gramática da tela e a frase do vazio virou "As
  // mensagens nascem sozinhas" (aba Todos) — as duas promessas seguem medidas.
  const avisos = readFileSync(join(process.cwd(), 'src/app/admin/avisos/page.tsx'), 'utf8')
  const gramatica = readFileSync(join(process.cwd(), 'src/data/admin/mensagens-gramatica.ts'), 'utf8')

  it('`class-cancelled` tem tradução — a linha não aparece com o nome cru', () => {
    expect(gramatica).toContain("'class-cancelled': 'Cancelamento de aula'")
  })

  it('o empty state ENUMERA o cancelamento entre os avisos que o sistema manda', () => {
    // Sem isso, a tela de destino contradizia a promessa da Agenda: num filtro
    // vazio a dona leria a lista e concluiria que aquele aviso não existe.
    const hint = /As mensagens nascem sozinhas:([^']+)'/.exec(avisos)
    expect(hint, 'a frase do empty state mudou de forma — remedir').not.toBeNull()
    expect(hint![1]).toMatch(/cancelamento de aula/i)
  })

  it('a remissão das frases usa o rótulo do MENU ("Mensagens")', () => {
    expect(readFileSync(join(process.cwd(), 'src/components/admin/nav.ts'), 'utf8')).toContain(
      "label: 'Mensagens'",
    )
  })
})

describe('A5 · a ressalva da PAUSA acompanha toda afirmação de extrato (médio 4)', () => {
  const comExtrato = [
    'src/app/admin/agenda/page.tsx',
    'src/components/admin/inicio/AndarHoje.tsx',
  ]
  it('nenhuma tela afirma "já conta no extrato" sem dizer da pausa', () => {
    // `_teacher_payable_hours` só soma a aula `scheduled` quando NÃO há
    // `contract_pauses` cobrindo o dia — e nem a fila da Agenda nem a do Início
    // filtram por status de contrato, então a aula de contrato pausado está lá.
    expect(corpoDaFuncao('_teacher_payable_hours')).toContain('from contract_pauses cp')
    for (const rel of comExtrato) {
      const texto = textoDaTela(rel)
      for (const m of texto.matchAll(/já conta no extrato[^.;]{0,80}/gi))
        expect(m[0], `${rel} → ${m[0]}`).toMatch(/pausad/i)
    }
  })
})
