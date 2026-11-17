// #191 — cancelamento de aula pela admin envia o aviso NA HORA.
//
// Medido em 02/11/2026: aula cancelada às 16:38 ficou com o aviso parado até a
// rodada das 17:10. As duas actions de cancelamento do admin (a matriz da
// Agenda e o painel "cancelar" da ficha do aluno) chamavam a RPC `cancel_class`
// e só redirecionavam. Agora disparam o despacho dos avisos DAQUELA aula logo
// depois de a RPC confirmar, em duas rodadas de prefixo exato (aluna e
// professora), e respondem à dona sem esperar o envio terminar.
//
// Dois blocos:
// 1. A ORDEM, sem banco: o despacho só acontece depois de a RPC confirmar, usa
//    o registro de canais do ambiente, vai preso às linhas da aula cancelada,
//    não segura a resposta, e a falha dele não chega à tela.
// 2. A FILA, contra o banco: depois de cada action as linhas do aviso (aluna e
//    professora) deixam de estar pendentes sem esperar o job, a linha de
//    WhatsApp também é alcançada, e aviso de outra aula não sai junto; com o
//    canal falhando, o cancelamento permanece, a linha segue pendente e a
//    rodada seguinte a entrega uma vez só.
//
// HIGIENE (o bloco 2 roda em paralelo com o resto da suíte): o despachante é o
// REAL e o dublê só o observa. Ele NÃO muda os argumentos da action; o que ele
// faz é RECUSAR rodada sem `keyLike`, porque fila inteira com o canal falso
// deste arquivo fecharia linhas de outros testes. Action que voltar a despachar
// sem filtro aparece aqui como teste vermelho, não como estrago na bancada.
//
// O canal falso de e-mail se declara `provider: 'resend'`: o despachante passa
// pelo caminho de produção (abre a tentativa, fecha com o id do provedor ou
// registra a falha), não pelo atalho do canal sem provedor. As linhas são lidas
// pelo `payload.instance_id`, não pelo filtro que a action usa: o que está sob
// teste não confere a si mesmo.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Sql } from 'postgres'

import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createInstance, createPrivateContract, createStudent } from './helpers/db'
import { PoteDeCookies } from './pote-de-cookies'

type Despacho = typeof import('@/lib/outbox/dispatch').dispatchOutbox

const { Redirecionou, real, enviadosPeloCanal, canalFalso } = vi.hoisted(() => {
  /** O `redirect` do Next lança; aqui ele lança ISTO, e o teste lê a URL. */
  class Redirecionou extends Error {
    constructor(public readonly url: string) {
      super(`redirect: ${url}`)
    }
  }
  return {
    Redirecionou,
    /** o despachante real, que só aceita rodada com filtro (montado na fábrica do dublê) */
    real: { despacho: null as Despacho | null },
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
  real.despacho = (admin, canais, opts) => {
    if (!opts?.keyLike) throw new Error('teste recusa a rodada sem filtro: ela despacharia a fila inteira')
    return original.dispatchOutbox(admin, canais, opts)
  }
  return { ...original, dispatchOutbox: vi.fn(real.despacho) }
})
vi.mock('@/lib/notify/registry', () => ({
  // só e-mail: linha de WhatsApp encontra "canal sem driver" e fica pendente com o motivo
  canaisDoAmbiente: vi.fn(() => ({
    email: {
      provider: 'resend' as const,
      send: async (m: { to: string }) => {
        if (canalFalso.erro) return { ok: false as const, error: canalFalso.erro }
        enviadosPeloCanal.push(m)
        return { ok: true as const, providerMessageId: `re_teste_${crypto.randomUUID()}` }
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

/** Os dois filtros que prendem o despacho às linhas de UMA aula, na ordem em
 *  que a action os roda: os avisos aos alunos (e-mail e WhatsApp) pelo prefixo
 *  exato, e o aviso à professora pela chave inteira. */
const filtrosDa = (instance: string) => [
  `class-cancelled:${instance}:%`,
  `class-cancelled-teacher:${instance}`,
]

/** A action não espera o envio; o teste espera, para ler a fila depois dele. */
const despachosTerminarem = () =>
  Promise.allSettled(vi.mocked(dispatchOutbox).mock.results.map((r) => r.value as Promise<unknown>))

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
  vi.mocked(dispatchOutbox).mockImplementation(real.despacho!)
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

/** O aviso à aluna vai só por e-mail: o canal falso deste arquivo não tem WhatsApp. */
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
  /** os filtros `.eq(coluna, valor)` das leituras que a action fez */
  let filtrosDaLeitura: Array<[string, unknown]>

  /** Cliente de cookies falso: a RPC responde o que o caso mandar. */
  function clienteFalso(erroDaRpc: string | null) {
    const consulta = {
      select: () => consulta,
      eq: (coluna: string, valor: unknown) => {
        filtrosDaLeitura.push([coluna, valor])
        return consulta
      },
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
    filtrosDaLeitura = []
    vi.mocked(createAdminClient).mockReturnValue(ADMIN_FALSO as never)
    // sem banco: o despachante é só anotado
    vi.mocked(dispatchOutbox).mockImplementation(async () => {
      ordem.push('despacho')
      return SEM_ENVIO
    })
  })

  for (const porta of PORTAS) {
    it(`${porta.nome}: cancela e DEPOIS despacha, com o registro de canais do ambiente e só os avisos da aula`, async () => {
      vi.mocked(createClient).mockResolvedValue(clienteFalso(null) as never)

      const url = await rodar(porta.acao, porta.envio(AULA, ALUNO))

      // uma rodada por família de chave: alunos e professora
      expect(ordem).toEqual(['cancel_class', 'despacho', 'despacho'])
      const chamadas = vi.mocked(dispatchOutbox).mock.calls
      const registros = vi.mocked(canaisDoAmbiente).mock.results.map((r) => r.value)
      expect(chamadas).toHaveLength(2)
      chamadas.forEach(([cliente, canais, opcoes, ...resto], i) => {
        expect(cliente).toBe(ADMIN_FALSO)
        // o registro único, inteiro: os canais do ambiente não mudam
        expect(canais).toBe(registros[i])
        // só as linhas desta aula, e nada além do filtro: sem relógio injetado e
        // sem limite próprio, as regras do despacho (silêncio, obsoleto) são as da rodada
        expect(opcoes).toEqual({ keyLike: filtrosDa(AULA)[i] })
        expect(resto).toEqual([])
      })
      expect(porta.recado(url)).toMatch(/^Aula cancelada/)
    })

    it(`${porta.nome}: a resposta não espera o envio, e as duas rodadas correm ao mesmo tempo`, async () => {
      vi.mocked(createClient).mockResolvedValue(clienteFalso(null) as never)
      // nenhuma rodada termina até o teste soltar (provedor travado)
      const soltar: Array<() => void> = []
      vi.mocked(dispatchOutbox).mockImplementation(
        () => new Promise((resolve) => soltar.push(() => resolve(SEM_ENVIO))),
      )

      // a action responde com as duas rodadas ainda em curso: quem esperasse o
      // envio ficaria presa aqui até o tempo limite do teste…
      const url = await rodar(porta.acao, porta.envio(AULA, ALUNO))

      expect(porta.recado(url)).toMatch(/^Aula cancelada/)
      // …e as duas já tinham começado: em fila, a segunda só nasceria depois da primeira
      expect(dispatchOutbox).toHaveBeenCalledTimes(2)
      expect(soltar).toHaveLength(2)
      for (const s of soltar) s()
      await despachosTerminarem()
    })

    it(`${porta.nome}: id da aula em outra forma que o banco aceita (maiúsculas, chaves) vira o filtro canônico`, async () => {
      vi.mocked(createClient).mockResolvedValue(clienteFalso(null) as never)

      // as chaves da fila levam o id como o banco o escreve; sem normalizar, o
      // filtro não casaria nada e o aviso ficaria para a rodada horária
      await rodar(porta.acao, porta.envio(`{${AULA.toUpperCase()}}`, ALUNO))

      expect(vi.mocked(dispatchOutbox).mock.calls.map((c) => c[2])).toEqual(
        filtrosDa(AULA).map((keyLike) => ({ keyLike })),
      )
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
      // a falha fica no log do servidor, que é onde ela serve…
      await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1))
      // …e a rodada dos alunos que estourou não impede a da professora
      expect(dispatchOutbox).toHaveBeenCalledTimes(2)
      expect(vi.mocked(dispatchOutbox).mock.calls[1][2]).toEqual({ keyLike: filtrosDa(AULA)[1] })
    })

    it(`${porta.nome}: sem a chave do servidor (o cliente nem chega a ser criado), o cancelamento segue com sucesso`, async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(createClient).mockResolvedValue(clienteFalso(null) as never)
      // `createAdminClient` lança NA HORA, antes de existir promessa para tratar
      vi.mocked(createAdminClient).mockImplementation(() => {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY ausentes no ambiente')
      })

      const recado = porta.recado(await rodar(porta.acao, porta.envio(AULA, ALUNO)))

      expect(recado).toMatch(/^Aula cancelada/)
      expect(recado).not.toMatch(/Falha|SERVICE_ROLE|ausentes/i)
      expect(dispatchOutbox).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(2))
    })

    it(`${porta.nome}: a frase de sucesso continua sem prometer entrega`, async () => {
      vi.mocked(createClient).mockResolvedValue(clienteFalso(null) as never)
      vi.mocked(dispatchOutbox).mockResolvedValue({ ...SEM_ENVIO, processed: 1, sent: 1 })

      const recado = porta.recado(await rodar(porta.acao, porta.envio(AULA, ALUNO)))

      expect(recado).not.toMatch(PROMESSA_DE_ENTREGA)
    })
  }

  it('id da aula em outra forma: a trilha do crédito é lida pelo id canônico, nas duas portas', async () => {
    // a trilha grava `entity_id` como texto, na forma do banco; lida com o id
    // cru, a action não acharia a linha e diria "não deu para ler se gerou crédito"
    const [, ficha] = PORTAS
    vi.mocked(createClient).mockResolvedValue(clienteFalso(null) as never)
    const recadoDaFicha = ficha.recado(await rodar(ficha.acao, ficha.envio(`{${AULA.toUpperCase()}}`, ALUNO)))
    expect(filtrosDaLeitura).toContainEqual(['entity_id', AULA])
    expect(recadoDaFicha).not.toMatch(/não deu para ler/)

    // na Agenda quem lê a trilha é o cancelamento a pedido da professora
    filtrosDaLeitura = []
    const envio = form({ instance_id: AULA.toUpperCase(), desfecho: 'cancelada_professora', ...SO_EMAIL })
    await rodar(registrarDesfechoDaAulaAction, envio)
    expect(filtrosDaLeitura).toContainEqual(['entity_id', AULA])
  })

  it('Agenda: o recado segue dizendo "REGISTRADO para envio", mesmo com o despacho feito', async () => {
    vi.mocked(createClient).mockResolvedValue(clienteFalso(null) as never)
    vi.mocked(dispatchOutbox).mockResolvedValue({ ...SEM_ENVIO, processed: 1, sent: 1 })

    const [agenda] = PORTAS
    const recado = agenda.recado(await rodar(agenda.acao, agenda.envio(AULA, ALUNO)))

    expect(recado).toContain('fica REGISTRADO para envio por e-mail')
    expect(recado).toContain('Se ele saiu, você confere em Mensagens.')
  })
})

/* ========================================================================== */
/* 2. A fila, contra o banco                                                   */
/* ========================================================================== */

describe('#191 · os avisos da aula saem da fila sem esperar o job', () => {
  let sql: Sql
  let admin: SupabaseClient
  let servico: SupabaseClient
  /** as aulas que este arquivo cancelou e as chaves que ele plantou: a limpeza
   *  do fim fecha só isso */
  const aulasDoArquivo: string[] = []
  const chavesPlantadas: string[] = []

  beforeAll(async () => {
    sql = connect(3)
    admin = await clientAs(await createAuthUser(sql, 'admin', `Admin aviso na hora ${rodada}`), 'admin')
    servico = serviceClient()
  })
  afterAll(async () => {
    // higiene: aviso que ficou pendente sai da fila resolvido, nunca apagado (Lei 8)
    const fechar = (onde: ReturnType<Sql>) => sql`
      update notification_outbox
         set sent_at = now(), error = coalesce(error, 'fim do teste cancelamento-admin-avisa-na-hora')
       where sent_at is null and attempt_id is null and ${onde}`
    for (const instance of aulasDoArquivo) await fechar(sql`payload->>'instance_id' = ${instance}`)
    for (const chave of chavesPlantadas) await fechar(sql`dedupe_key = ${chave}`)
    await sql.end()
  })

  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue(admin as never)
    vi.mocked(createAdminClient).mockReturnValue(servico as never)
  })

  const emailDe = async (perfil: string) =>
    (await sql`select email from auth.users where id = ${perfil}`)[0].email as string

  /** Aluna e professora com login (os avisos têm para onde ir) e uma aula
   *  particular daqui a 2 dias. */
  async function aulaMarcada() {
    const perfilDaAluna = await createAuthUser(sql, 'student', `Aluna aviso na hora ${rodada}`)
    const aluno = await createStudent(sql)
    await sql`update students set profile_id = ${perfilDaAluna} where id = ${aluno}`
    const contrato = await createPrivateContract(sql, { studentId: aluno })
    const perfilDaProfessora = await createAuthUser(sql, 'teacher', `Professora aviso na hora ${rodada}`)
    await sql`update teachers set profile_id = ${perfilDaProfessora} where id = ${contrato.teacherId}`
    const instance = await createInstance(sql, contrato, { startsInHours: 48 })
    aulasDoArquivo.push(instance)
    return {
      aluno,
      instance,
      perfilDaAluna,
      emailDaAluna: await emailDe(perfilDaAluna),
      emailDaProfessora: await emailDe(perfilDaProfessora),
    }
  }

  const estadoDaAula = async (instance: string) =>
    (await sql`select state from class_instances where id = ${instance}`)[0].state as string

  /** As linhas de aviso desta aula, lidas pelo que elas CARREGAM (a aula no
   *  payload), não pelo filtro de chave que a action usa. */
  const avisosDaAula = (instance: string) =>
    sql`select template, channel, sent_at, error, provider, provider_message_id, attempt_id
          from notification_outbox
         where payload->>'instance_id' = ${instance}
           and template in ('class-cancelled', 'class-cancelled-teacher')
         order by template, channel`

  /** A rodada seguinte do job, vista só nas linhas desta aula. */
  async function rodadaSeguinte(instance: string) {
    for (const keyLike of filtrosDa(instance)) await real.despacho!(servico, canaisDoAmbiente(), { keyLike })
  }

  for (const porta of PORTAS) {
    it(`${porta.nome}: aluna e professora são avisadas na mesma ação; nem a rodada seguinte nem o segundo clique mandam de novo`, async () => {
      const { aluno, instance, emailDaAluna, emailDaProfessora } = await aulaMarcada()

      const url = await rodar(porta.acao, porta.envio(instance, aluno))
      await despachosTerminarem()

      expect(await estadoDaAula(instance)).toBe('cancelled')
      expect(porta.recado(url)).toMatch(/^Aula cancelada/)
      expect(porta.recado(url)).not.toMatch(PROMESSA_DE_ENTREGA)

      // a action rodou o despachante com os dois filtros desta aula, e só eles…
      expect(vi.mocked(dispatchOutbox).mock.calls.map((c) => c[2])).toEqual(
        filtrosDa(instance).map((keyLike) => ({ keyLike })),
      )
      // …e ele achou as duas linhas recém-criadas: a da aluna e a da professora,
      // fechadas pelo caminho do provedor (tentativa aberta e encerrada com o id)
      const linhas = await avisosDaAula(instance)
      expect(linhas.map((l) => [l.template, l.channel])).toEqual([
        ['class-cancelled', 'email'],
        ['class-cancelled-teacher', 'email'],
      ])
      for (const l of linhas) {
        expect(l.sent_at, `${l.template} ficou esperando a rodada horária`).not.toBeNull()
        expect(l.error).toBeNull()
        expect(l.provider).toBe('resend')
        expect(l.provider_message_id).toMatch(/^re_teste_/)
        expect(l.attempt_id).toBeNull()
      }
      expect(enviadosPeloCanal.map((m) => m.to).sort()).toEqual([emailDaAluna, emailDaProfessora].sort())

      // a rodada do job que vem depois não acha nada para mandar
      await rodadaSeguinte(instance)
      expect(enviadosPeloCanal).toHaveLength(2)
      expect(await avisosDaAula(instance)).toHaveLength(2)

      // o segundo clique na mesma aula: o banco recusa, e recusa não despacha
      vi.mocked(dispatchOutbox).mockClear()
      const repetida = await rodar(porta.acao, porta.envio(instance, aluno))
      expect(porta.recado(repetida)).toMatch(/^Falha/)
      expect(dispatchOutbox).not.toHaveBeenCalled()
      expect(enviadosPeloCanal).toHaveLength(2)
      expect(await avisosDaAula(instance)).toHaveLength(2)
    }, 30_000)

    it(`${porta.nome}: com o canal falhando, a aula segue cancelada e o aviso segue na fila para a rodada seguinte`, async () => {
      const { aluno, instance, emailDaAluna, emailDaProfessora } = await aulaMarcada()
      canalFalso.erro = 'caixa cheia'

      const url = await rodar(porta.acao, porta.envio(instance, aluno))
      await despachosTerminarem()

      expect(await estadoDaAula(instance)).toBe('cancelled')
      const recado = porta.recado(url)
      expect(recado).toMatch(/^Aula cancelada/)
      expect(recado).not.toMatch(/Falha|caixa cheia/)
      // recusa definitiva do provedor: a tentativa fecha e a linha volta para a fila
      const pendentes = await avisosDaAula(instance)
      expect(pendentes).toHaveLength(2)
      for (const l of pendentes) {
        expect(l.sent_at, l.template).toBeNull()
        expect(l.attempt_id, l.template).toBeNull()
        expect(l.error, l.template).toContain('caixa cheia')
      }
      expect(enviadosPeloCanal).toHaveLength(0)

      // o canal volta: a rodada seguinte entrega, e a outra depois dela não repete
      canalFalso.erro = null
      await rodadaSeguinte(instance)
      await rodadaSeguinte(instance)
      for (const l of await avisosDaAula(instance)) expect(l.sent_at, l.template).not.toBeNull()
      expect(enviadosPeloCanal.map((m) => m.to).sort()).toEqual([emailDaAluna, emailDaProfessora].sort())
    }, 30_000)
  }

  it('com o WhatsApp marcado, a linha de WhatsApp também é alcançada na mesma ação', async () => {
    const { aluno, instance } = await aulaMarcada()
    const [agenda] = PORTAS
    const envio = agenda.envio(instance, aluno)
    envio.set('avisar_whatsapp', '1')

    await rodar(agenda.acao, envio)
    await despachosTerminarem()

    const linhas = await avisosDaAula(instance)
    expect(linhas.map((l) => [l.template, l.channel])).toEqual([
      ['class-cancelled', 'email'],
      ['class-cancelled', 'whatsapp'],
      ['class-cancelled-teacher', 'email'],
    ])
    // o registro deste arquivo não tem canal de WhatsApp: a linha fica pendente
    // COM o motivo, e o motivo só existe porque o despacho passou por ela
    const whatsapp = linhas[1]
    expect(whatsapp.sent_at).toBeNull()
    expect(whatsapp.error).toBe('canal whatsapp sem driver configurado')
    // …sem atrapalhar os dois e-mails
    expect(linhas[0].sent_at).not.toBeNull()
    expect(linhas[2].sent_at).not.toBeNull()
  }, 30_000)

  it('aviso pendente de OUTRA aula não sai junto, nem o que traz o id desta aula no fim da chave', async () => {
    // a vizinha: outra aluna, aula cancelada direto na RPC, aviso parado na fila
    const vizinha = await aulaMarcada()
    const r = await admin.rpc('cancel_class', {
      p_instance: vizinha.instance,
      p_cancelled_by: 'student',
      p_notify_email: true,
      p_notify_whatsapp: false,
    })
    expect(r.error).toBeNull()
    expect((await avisosDaAula(vizinha.instance)).length).toBeGreaterThan(0)

    const { aluno, instance, emailDaAluna, emailDaProfessora } = await aulaMarcada()

    // a armadilha: um aviso da aula VIZINHA cuja chave termina com o id DESTA
    // aula (o lugar do aluno na chave). Um filtro com curinga antes do id da
    // aula (`class-cancelled%:<aula>%`) casaria esta linha e a mandaria agora.
    const armadilha = `class-cancelled:${vizinha.instance}:${instance}`
    chavesPlantadas.push(armadilha)
    await sql`
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values ('email', 'class-cancelled', ${vizinha.perfilDaAluna},
              ${sql.json({ instance_id: vizinha.instance, starts_at_utc: new Date(Date.now() + 48 * 3_600_000).toISOString(), iana_tz: 'America/Cuiaba', local_time_snapshot: 'fixture de teste', credited: false })},
              ${armadilha})`

    const [agenda] = PORTAS
    await rodar(agenda.acao, agenda.envio(instance, aluno))
    await despachosTerminarem()

    // o que o canal deste arquivo mandou é só o desta aula. (Não se confere o
    // `sent_at` das linhas da vizinha: outro arquivo da suíte pode fechá-las em
    // paralelo; o que este arquivo MANDOU é dele.)
    const destinos = enviadosPeloCanal.map((m) => m.to)
    expect([...destinos].sort()).toEqual([emailDaAluna, emailDaProfessora].sort())
    expect(destinos).not.toContain(vizinha.emailDaAluna)
    expect(destinos).not.toContain(vizinha.emailDaProfessora)
  }, 30_000)
})
