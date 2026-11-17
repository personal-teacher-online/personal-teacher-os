// #191 — cancelamento de aula pela admin envia o aviso NA HORA.
//
// Medido em 02/11/2026: aula cancelada às 16:38 ficou com o aviso parado até a
// rodada das 17:10. As duas actions de cancelamento do admin (a matriz da
// Agenda e o painel "cancelar" da ficha do aluno) chamavam a RPC `cancel_class`
// e só redirecionavam. Agora despacham a fila logo depois de a RPC confirmar.
//
// Dois blocos:
// 1. A ORDEM, sem banco: o despacho só acontece depois de a RPC confirmar, usa
//    o registro de canais do ambiente sem opção nenhuma (a mesma rodada do job:
//    canais e horário de silêncio não mudam), e a falha dele não chega à tela.
// 2. A FILA, contra o banco: depois de cada action a linha do aviso deixa de
//    estar pendente sem esperar o job; com o canal falhando, o cancelamento
//    permanece, a linha segue pendente e a rodada seguinte a entrega uma vez só.
//
// HIGIENE (o bloco 2 roda em paralelo com o resto da suíte): a action despacha
// a fila INTEIRA, e com o canal falso deste arquivo isso fecharia linhas de
// outros testes. O despachante é o REAL, mas o dublê o prende às linhas da aula
// do caso (`keyLike`); o que a action pediu fica anotado nas chamadas do dublê,
// e é lá que se confere que ela não passou opção nenhuma.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'

import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createInstance, createPrivateContract, createStudent } from './helpers/db'
import { PoteDeCookies } from './pote-de-cookies'

type Despacho = typeof import('@/lib/outbox/dispatch').dispatchOutbox

const { Redirecionou, escopo, enviadosPeloCanal, canalFalso } = vi.hoisted(() => {
  /** O `redirect` do Next lança; aqui ele lança ISTO, e o teste lê a URL. */
  class Redirecionou extends Error {
    constructor(public readonly url: string) {
      super(`redirect: ${url}`)
    }
  }
  return {
    Redirecionou,
    escopo: {
      /** as linhas da aula do caso; sem isto o despachante real não roda */
      keyLike: null as string | null,
      /** o despachante real preso ao escopo (montado na fábrica do dublê) */
      real: null as Despacho | null,
    },
    enviadosPeloCanal: [] as Array<{ to: string }>,
    /** com erro preenchido, o canal falso recusa o envio com este texto */
    canalFalso: { erro: null as string | null },
  }
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirecionou(url)
  },
}))
// Os módulos que `agenda/actions.ts` puxa e que não são o assunto deste arquivo.
vi.mock('@/lib/auth/admin', () => ({ requireAdminId: async () => 'admin-de-teste' }))
vi.mock('@/lib/email/notify', () => ({ sendRescheduleEmails: async () => {} }))
vi.mock('@/lib/email/send', () => ({ sendEmail: async () => {}, sendEmailWithOutcome: async () => {} }))
vi.mock('@/lib/google/sync', () => ({
  syncTeacherCalendarSoon: () => {},
  googleBusyForTeacher: async () => ({ status: 'indisponivel' as const }),
}))
vi.mock('@/lib/outbox/dispatch', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/outbox/dispatch')>()
  escopo.real = (admin, canais, opts) => {
    if (!escopo.keyLike) throw new Error('teste sem escopo: o despachante real rodaria a fila inteira')
    return original.dispatchOutbox(admin, canais, { ...opts, keyLike: escopo.keyLike })
  }
  return { ...original, dispatchOutbox: vi.fn(escopo.real) }
})
vi.mock('@/lib/notify/registry', () => ({
  canaisDoAmbiente: vi.fn(() => ({
    email: {
      send: async (m: { to: string }) => {
        if (canalFalso.erro) return { ok: false as const, error: canalFalso.erro }
        enviadosPeloCanal.push(m)
        return { ok: true as const }
      },
    },
  })),
}))

const { cookies } = await import('next/headers')
const { createClient } = await import('@/lib/supabase/server')
const { createAdminClient } = await import('@/lib/supabase/admin')
const { dispatchOutbox } = await import('@/lib/outbox/dispatch')
const { canaisDoAmbiente } = await import('@/lib/notify/registry')
const { cookieDoRecado } = await import('@/lib/kit/recado')
const { cancelClassAction, registrarDesfechoDaAulaAction } = await import('@/app/admin/agenda/actions')

const rodada = crypto.randomUUID().slice(0, 8)
const SEM_ENVIO = { processed: 0, sent: 0, pendingError: 0, resolvedStale: 0, held: 0 }

/** O que nenhuma frase de sucesso pode afirmar: registrar não é entregar. */
const PROMESSA_DE_ENTREGA = /é avisad|foi avisad|já foi enviad|recebeu|vai receber|chegou/i

let pote: PoteDeCookies

beforeEach(() => {
  pote = new PoteDeCookies()
  vi.mocked(cookies).mockResolvedValue(pote as never)
  vi.mocked(createClient).mockReset()
  vi.mocked(createAdminClient).mockReset()
  vi.mocked(canaisDoAmbiente).mockClear()
  vi.mocked(dispatchOutbox).mockReset()
  vi.mocked(dispatchOutbox).mockImplementation(escopo.real!)
  escopo.keyLike = null
  canalFalso.erro = null
  enviadosPeloCanal.length = 0
})
afterEach(() => {
  // o `console.error` calado num caso não fica calado no seguinte
  vi.restoreAllMocks()
})

/** Roda uma action e devolve o destino do redirect. */
async function rodar(acao: (fd: FormData) => Promise<void>, fd: FormData): Promise<string> {
  try {
    await acao(fd)
  } catch (e) {
    if (e instanceof Redirecionou) return e.url
    throw e
  }
  throw new Error('a action deveria ter redirecionado')
}

function form(campos: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) f.set(k, v)
  return f
}

/** O aviso vai só por e-mail: o canal falso deste arquivo não tem WhatsApp. */
const SO_EMAIL = {
  canais: '1',
  avisar_email: '1',
  avisar_whatsapp: '0',
  entrega_email: '1',
  entrega_whatsapp: '1',
}

interface Porta {
  nome: string
  acao: (fd: FormData) => Promise<void>
  /** o formulário que a tela manda */
  envio: (instance: string, aluno: string) => FormData
  /** o recado que a dona lê depois, a partir do destino do redirect */
  recado: (url: string) => string
}

/** As duas portas de cancelamento do admin, com o envio que cada tela faz. */
const PORTAS: readonly [Porta, Porta] = [
  {
    nome: 'Agenda (desfecho de cancelamento)',
    acao: registrarDesfechoDaAulaAction,
    envio: (instance) =>
      form({ instance_id: instance, desfecho: 'cancelada_aluno', back: '/admin/agenda', ...SO_EMAIL }),
    // na Agenda o recado viaja no cookie da seção
    recado: () => {
      const cru = pote.get(cookieDoRecado('agenda'))?.value
      return cru ? String((JSON.parse(cru) as { mensagem: string }).mensagem) : ''
    },
  },
  {
    nome: 'ficha do aluno (painel "cancelar")',
    acao: cancelClassAction,
    envio: (instance, aluno) =>
      form({
        instance_id: instance,
        cancelled_by: 'teacher',
        back: `/admin/alunos/${aluno}?aba=historico`,
        ...SO_EMAIL,
      }),
    // …e na ficha ele ainda viaja na URL (`?msg=`)
    recado: (url) => new URL(url, 'http://local.dev').searchParams.get('msg') ?? '',
  },
]

/* ========================================================================== */
/* 1. A ordem, sem banco                                                       */
/* ========================================================================== */

describe('#191 · o despacho vem depois de a RPC confirmar, e só então', () => {
  const AULA = '0b6f6c1e-3d2a-4c5b-9e8f-1a2b3c4d5e6f'
  const ALUNO = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
  const ADMIN_FALSO = { marca: 'cliente service-role do teste' }

  let ordem: string[]

  /** Cliente de cookies falso: a RPC responde o que o caso mandar. */
  function clienteFalso(erroDaRpc: string | null) {
    const consulta = {
      select: () => consulta,
      eq: () => consulta,
      order: () => consulta,
      limit: () => consulta,
      single: async () => ({ data: { diff: { credited: false } }, error: null }),
    }
    return {
      rpc: async (fn: string) => {
        ordem.push(fn)
        return { data: null, error: erroDaRpc ? { message: erroDaRpc } : null }
      },
      from: () => consulta,
    }
  }

  beforeEach(() => {
    ordem = []
    vi.mocked(createAdminClient).mockReturnValue(ADMIN_FALSO as never)
  })

  for (const porta of PORTAS) {
    it(`${porta.nome}: cancela e DEPOIS despacha, com o registro de canais do ambiente e nenhuma opção`, async () => {
      vi.mocked(createClient).mockResolvedValue(clienteFalso(null) as never)
      vi.mocked(dispatchOutbox).mockImplementationOnce(async () => {
        ordem.push('despacho')
        return SEM_ENVIO
      })

      const url = await rodar(porta.acao, porta.envio(AULA, ALUNO))

      expect(ordem).toEqual(['cancel_class', 'despacho'])
      expect(dispatchOutbox).toHaveBeenCalledTimes(1)
      const [cliente, canais, ...resto] = vi.mocked(dispatchOutbox).mock.calls[0]
      expect(cliente).toBe(ADMIN_FALSO)
      // o registro único, inteiro, e a rodada comum: sem filtro, sem relógio injetado
      expect(canaisDoAmbiente).toHaveBeenCalledTimes(1)
      expect(canais).toBe(vi.mocked(canaisDoAmbiente).mock.results[0].value)
      expect(resto).toEqual([])
      expect(porta.recado(url)).toMatch(/^Aula cancelada/)
    })

    it(`${porta.nome}: RPC recusada não despacha nada`, async () => {
      vi.mocked(createClient).mockResolvedValue(clienteFalso('aula não está agendada') as never)

      const url = await rodar(porta.acao, porta.envio(AULA, ALUNO))

      expect(ordem).toEqual(['cancel_class'])
      expect(dispatchOutbox).not.toHaveBeenCalled()
      expect(porta.recado(url)).toMatch(/^Falha: esta aula já tem desfecho registrado/)
    })

    it(`${porta.nome}: despacho que estoura não vira erro na tela nem desfaz o recado de sucesso`, async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(createClient).mockResolvedValue(clienteFalso(null) as never)
      vi.mocked(dispatchOutbox).mockRejectedValueOnce(new Error('outbox: reserva falhou: connection refused'))

      const url = await rodar(porta.acao, porta.envio(AULA, ALUNO))

      const recado = porta.recado(url)
      expect(recado).toMatch(/^Aula cancelada/)
      expect(recado).not.toMatch(/Falha|reserva falhou|connection refused|outbox/i)
      // a falha fica no log do servidor, que é onde ela serve
      expect(log).toHaveBeenCalledTimes(1)
    })

    it(`${porta.nome}: a frase de sucesso continua sem prometer entrega`, async () => {
      vi.mocked(createClient).mockResolvedValue(clienteFalso(null) as never)
      vi.mocked(dispatchOutbox).mockResolvedValueOnce({ ...SEM_ENVIO, processed: 1, sent: 1 })

      const recado = porta.recado(await rodar(porta.acao, porta.envio(AULA, ALUNO)))

      expect(recado).not.toMatch(PROMESSA_DE_ENTREGA)
    })
  }

  it('Agenda: o recado segue dizendo "REGISTRADO para envio", mesmo com o despacho feito', async () => {
    vi.mocked(createClient).mockResolvedValue(clienteFalso(null) as never)
    vi.mocked(dispatchOutbox).mockResolvedValueOnce({ ...SEM_ENVIO, processed: 1, sent: 1 })

    const [agenda] = PORTAS
    const recado = agenda.recado(await rodar(agenda.acao, agenda.envio(AULA, ALUNO)))

    expect(recado).toContain('fica REGISTRADO para envio por e-mail')
    expect(recado).toContain('Se ele saiu, você confere em Mensagens.')
  })
})

/* ========================================================================== */
/* 2. A fila, contra o banco                                                   */
/* ========================================================================== */

describe('#191 · a linha do aviso sai da fila sem esperar o job', () => {
  let sql: Sql
  let admin: SupabaseClient
  let servico: SupabaseClient

  beforeAll(async () => {
    sql = connect(3)
    admin = await clientAs(await createAuthUser(sql, 'admin', `Admin aviso na hora ${rodada}`), 'admin')
    servico = serviceClient()
  })
  afterAll(async () => {
    await sql.end()
  })

  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue(admin as never)
    vi.mocked(createAdminClient).mockReturnValue(servico as never)
  })

  /** Aluna com login (o aviso tem para onde ir) e uma aula particular daqui a 2 dias. */
  async function aulaMarcada() {
    const perfil = await createAuthUser(sql, 'student', `Aluna aviso na hora ${rodada}`)
    const aluno = await createStudent(sql)
    await sql`update students set profile_id = ${perfil} where id = ${aluno}`
    const contrato = await createPrivateContract(sql, { studentId: aluno })
    const instance = await createInstance(sql, contrato, { startsInHours: 48 })
    const [{ email }] = await sql`select email from auth.users where id = ${perfil}`
    // o despachante real fica preso às linhas DESTA aula
    escopo.keyLike = `class-cancelled:${instance}:%`
    return { aluno, instance, email: email as string }
  }

  const estadoDaAula = async (instance: string) =>
    (await sql`select state from class_instances where id = ${instance}`)[0].state as string

  /** As linhas do aviso desta aula (a chave é a que `_enqueue_class_cancelled` grava). */
  const avisosDaAula = (instance: string, aluno: string) =>
    sql`select channel, sent_at, error from notification_outbox
         where dedupe_key like ${`class-cancelled:${instance}:${aluno}%`}`

  /** A rodada seguinte do job, presa às linhas desta aula. */
  const rodadaSeguinte = () => escopo.real!(servico, canaisDoAmbiente())

  for (const porta of PORTAS) {
    it(`${porta.nome}: o aviso sai na mesma ação, e repetir o envio não manda de novo`, async () => {
      const { aluno, instance, email } = await aulaMarcada()

      const url = await rodar(porta.acao, porta.envio(instance, aluno))

      expect(await estadoDaAula(instance)).toBe('cancelled')
      expect(porta.recado(url)).toMatch(/^Aula cancelada/)
      expect(porta.recado(url)).not.toMatch(PROMESSA_DE_ENTREGA)

      // a action chamou o despachante uma vez, e ele achou a linha recém-criada
      expect(dispatchOutbox).toHaveBeenCalledTimes(1)
      const linhas = await avisosDaAula(instance, aluno)
      expect(linhas).toHaveLength(1)
      expect(linhas[0].channel).toBe('email')
      expect(linhas[0].sent_at, 'o aviso ficou esperando a rodada horária').not.toBeNull()
      expect(linhas[0].error).toBeNull()
      expect(enviadosPeloCanal.map((m) => m.to)).toEqual([email])

      // a rodada do job que vem depois não acha nada para mandar
      await rodadaSeguinte()
      expect(enviadosPeloCanal).toHaveLength(1)
      expect(await avisosDaAula(instance, aluno)).toHaveLength(1)
    }, 20_000)

    it(`${porta.nome}: com o canal falhando, a aula segue cancelada e o aviso segue na fila para a rodada seguinte`, async () => {
      const { aluno, instance, email } = await aulaMarcada()
      canalFalso.erro = 'caixa cheia'

      const url = await rodar(porta.acao, porta.envio(instance, aluno))

      expect(await estadoDaAula(instance)).toBe('cancelled')
      const recado = porta.recado(url)
      expect(recado).toMatch(/^Aula cancelada/)
      expect(recado).not.toMatch(/Falha|caixa cheia/)
      expect(dispatchOutbox).toHaveBeenCalledTimes(1)
      const [pendente] = await avisosDaAula(instance, aluno)
      expect(pendente.sent_at).toBeNull()
      expect(enviadosPeloCanal).toHaveLength(0)

      // o canal volta: a rodada seguinte entrega, e a outra depois dela não repete
      canalFalso.erro = null
      await rodadaSeguinte()
      await rodadaSeguinte()
      const [depois] = await avisosDaAula(instance, aluno)
      expect(depois.sent_at).not.toBeNull()
      expect(enviadosPeloCanal.map((m) => m.to)).toEqual([email])
    }, 20_000)
  }
})
