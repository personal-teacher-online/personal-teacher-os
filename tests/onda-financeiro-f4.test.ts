// F4 — client Asaas + matching da semeadura. TUDO sem rede: o client é
// exercitado com dublê de fetch (padrão da casa — c15/c16) e o matching é
// função pura. Sandbox real NUNCA entra na suíte (risco 1 do goal doc).

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createPrivateContract } from './helpers/db'
import {
  asaasConfigFromEnv,
  atualizarAssinatura,
  buscarCliente,
  centavosParaReais,
  criarCobranca,
  listarAssinaturas,
  listarCobrancasPorReferencia,
  reaisParaCentavos,
  type AsaasConfig,
} from '../src/lib/asaas/client'
import {
  classificarAssinatura,
  type AlunoLocal,
  type ContratoLocal,
  type IndiceLocal,
} from '../src/lib/asaas/semeadura'

/* ------------------------------------------------------------------ config */

describe('asaasConfigFromEnv — fail-closed', () => {
  const originais = { key: process.env.ASAAS_API_KEY, env: process.env.ASAAS_ENV }
  afterEach(() => {
    if (originais.key === undefined) delete process.env.ASAAS_API_KEY
    else process.env.ASAAS_API_KEY = originais.key
    if (originais.env === undefined) delete process.env.ASAAS_ENV
    else process.env.ASAAS_ENV = originais.env
  })

  it('sem ASAAS_API_KEY → null (nunca chamada anônima)', () => {
    delete process.env.ASAAS_API_KEY
    process.env.ASAAS_ENV = 'sandbox'
    expect(asaasConfigFromEnv()).toBeNull()
  })

  it('ASAAS_ENV fora de sandbox/producao → null (nunca adivinhar ambiente)', () => {
    process.env.ASAAS_API_KEY = 'k'
    for (const ruim of ['', 'production', 'prod', 'SANDBOX', 'dev']) {
      process.env.ASAAS_ENV = ruim
      expect(asaasConfigFromEnv()).toBeNull()
    }
  })

  it('sandbox e producao apontam para as bases PROVADAS no gate F0', () => {
    process.env.ASAAS_API_KEY = 'k'
    process.env.ASAAS_ENV = 'sandbox'
    expect(asaasConfigFromEnv()?.baseUrl).toBe('https://api-sandbox.asaas.com/v3')
    process.env.ASAAS_ENV = 'producao'
    expect(asaasConfigFromEnv()?.baseUrl).toBe('https://api.asaas.com/v3')
  })
})

/* ---------------------------------------------------------------- dinheiro */

describe('fronteira única cents↔reais (Lei 9)', () => {
  it('reais → centavos com Math.round (69.99*100 = 6998.999… no float)', () => {
    expect(reaisParaCentavos(70)).toBe(7000)
    expect(reaisParaCentavos(69.99)).toBe(6999)
    expect(reaisParaCentavos(35.35)).toBe(3535)
    expect(reaisParaCentavos(0.1 + 0.2)).toBe(30)
  })

  it('centavos → reais e volta é identidade', () => {
    for (const cents of [0, 1, 6999, 7000, 123456789]) {
      expect(reaisParaCentavos(centavosParaReais(cents))).toBe(cents)
    }
  })
})

/* ------------------------------------------------------------------ client */

const CFG: AsaasConfig = { apiKey: 'chave-teste', ambiente: 'sandbox', baseUrl: 'https://api-sandbox.asaas.com/v3' }

interface Chamada {
  url: string
  init?: RequestInit
}

/** Dublê de fetch: grava a chamada e devolve o corpo dado. */
function comFetch<T>(corpo: unknown, fn: () => Promise<T>): Promise<{ resultado: T; chamadas: Chamada[] }> {
  const original = globalThis.fetch
  const chamadas: Chamada[] = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init })
    return new Response(JSON.stringify(corpo), { status: 200 })
  }) as typeof fetch
  return fn()
    .then((resultado) => ({ resultado, chamadas }))
    .finally(() => {
      globalThis.fetch = original
    })
}

describe('client Asaas — contrato das chamadas (dublê de fetch)', () => {
  it('toda chamada leva o header access_token (auth provada no F0)', async () => {
    const { chamadas } = await comFetch({ id: 'cus_1' }, () => buscarCliente(CFG, 'cus_1'))
    const headers = chamadas[0].init?.headers as Record<string, string>
    expect(headers.access_token).toBe('chave-teste')
  })

  it('criarCobranca: POST /payments com value em REAIS vindo de centavos', async () => {
    const { chamadas } = await comFetch({ id: 'pay_1' }, () =>
      criarCobranca(CFG, {
        customer: 'cus_1',
        billingType: 'BOLETO',
        valueCents: 6999,
        dueDate: '2026-09-10',
        externalReference: 'uuid-da-aula',
      })
    )
    expect(chamadas[0].url).toBe('https://api-sandbox.asaas.com/v3/payments')
    expect(chamadas[0].init?.method).toBe('POST')
    const body = JSON.parse(String(chamadas[0].init?.body))
    expect(body.value).toBe(69.99)
    expect(body.externalReference).toBe('uuid-da-aula')
  })

  it('listarCobrancasPorReferencia: GET ?externalReference= com URL-encode', async () => {
    const { resultado, chamadas } = await comFetch({ data: [{ id: 'pay_1' }] }, () =>
      listarCobrancasPorReferencia(CFG, 'a b')
    )
    expect(chamadas[0].url).toContain('/payments?externalReference=a%20b')
    expect(resultado).toEqual([{ id: 'pay_1' }])
  })

  it('atualizarAssinatura: PUT com corpo MÍNIMO (só externalReference — PUT é MERGE)', async () => {
    const { chamadas } = await comFetch({ id: 'sub_1', externalReference: 'c1' }, () =>
      atualizarAssinatura(CFG, 'sub_1', { externalReference: 'c1' })
    )
    expect(chamadas[0].url).toBe('https://api-sandbox.asaas.com/v3/subscriptions/sub_1')
    expect(chamadas[0].init?.method).toBe('PUT')
    expect(JSON.parse(String(chamadas[0].init?.body))).toEqual({ externalReference: 'c1' })
  })

  it('listarAssinaturas pagina por offset até hasMore=false', async () => {
    const paginas = [
      { hasMore: true, data: [{ id: 'sub_1' }] },
      { hasMore: false, data: [{ id: 'sub_2' }] },
    ]
    const original = globalThis.fetch
    const urls: string[] = []
    let i = 0
    globalThis.fetch = (async (url: string | URL | Request) => {
      urls.push(String(url))
      return new Response(JSON.stringify(paginas[i++]), { status: 200 })
    }) as typeof fetch
    try {
      const todas = await listarAssinaturas(CFG)
      expect(todas.map((s) => s.id)).toEqual(['sub_1', 'sub_2'])
      expect(urls[0]).toContain('offset=0')
      expect(urls[1]).toContain('offset=100')
    } finally {
      globalThis.fetch = original
    }
  })

  it('HTTP não-2xx vira erro claro com status (sem vazar a key)', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response('{"errors":[{"code":"invalid"}]}', { status: 400 })) as typeof fetch
    try {
      await expect(buscarCliente(CFG, 'cus_x')).rejects.toThrow(/HTTP 400/)
      await expect(buscarCliente(CFG, 'cus_x')).rejects.not.toThrow(/chave-teste/)
    } finally {
      globalThis.fetch = original
    }
  })
})

/* ---------------------------------------------------------------- matching */

const sabrina: AlunoLocal = { studentId: 's1', nome: 'Sabrina', email: 'sabrina@x.com' }
const natalia: AlunoLocal = { studentId: 's2', nome: 'Natália', email: 'natalia@x.com' }
const individual: ContratoLocal = { id: 'c-ind', tipo: 'individual', planName: 'Plano 2x', studentIds: ['s1'] }
const grupo: ContratoLocal = { id: 'c-grp', tipo: 'grupo', planName: 'Casal', studentIds: ['s2', 's3'] }
const extra: ContratoLocal = { id: 'c-extra', tipo: 'individual', planName: 'Avulso', studentIds: ['s2'] }

function indice(entradas: { aluno: AlunoLocal; contratos: ContratoLocal[] }[]): IndiceLocal {
  const alunosPorEmail = new Map(entradas.map((e) => [e.aluno.email, e.aluno]))
  const contratosPorStudent = new Map(entradas.map((e) => [e.aluno.studentId, e.contratos]))
  const contratosPorId = new Map(entradas.flatMap((e) => e.contratos.map((c) => [c.id, c] as const)))
  return { alunosPorEmail, contratosPorStudent, contratosPorId }
}

describe('classificarAssinatura — só a inequívoca recebe --apply', () => {
  const idx = indice([
    { aluno: sabrina, contratos: [individual] },
    { aluno: natalia, contratos: [grupo, extra] },
  ])

  it('e-mail bate + 1 contrato vigente → inequívoca', () => {
    const r = classificarAssinatura({}, { email: 'Sabrina@X.com' }, idx)
    expect(r).toEqual({ tipo: 'inequivoca', aluno: sabrina, contrato: individual })
  })

  it('2 contratos vigentes (casal + avulso) → ambígua, NUNCA aplicada', () => {
    const r = classificarAssinatura({}, { email: 'natalia@x.com' }, idx)
    expect(r.tipo).toBe('ambigua')
    if (r.tipo === 'ambigua') expect(r.contratos).toHaveLength(2)
  })

  it('externalReference já apontando para contrato local → ja-semeada (idempotente)', () => {
    const r = classificarAssinatura({ externalReference: 'c-ind' }, { email: 'sabrina@x.com' }, idx)
    expect(r).toEqual({ tipo: 'ja-semeada', contrato: individual })
  })

  it('externalReference preenchida com valor desconhecido → referencia-estranha (não tocar)', () => {
    const r = classificarAssinatura({ externalReference: 'outra-coisa' }, { email: 'sabrina@x.com' }, idx)
    expect(r).toEqual({ tipo: 'referencia-estranha', referencia: 'outra-coisa' })
  })

  it('e-mail de aluno sem contrato vigente → sem-contrato-vigente', () => {
    const idx2 = indice([{ aluno: sabrina, contratos: [] }])
    expect(classificarAssinatura({}, { email: 'sabrina@x.com' }, idx2).tipo).toBe('sem-contrato-vigente')
  })

  it('e-mail desconhecido ou vazio → sem-aluno (sobra manual)', () => {
    expect(classificarAssinatura({}, { email: 'ninguem@x.com' }, idx)).toEqual({
      tipo: 'sem-aluno',
      email: 'ninguem@x.com',
    })
    expect(classificarAssinatura({}, {}, idx)).toEqual({ tipo: 'sem-aluno', email: null })
    expect(classificarAssinatura({}, { email: '  ' }, idx)).toEqual({ tipo: 'sem-aluno', email: null })
  })
})

/* ------------------------------------------------- RPC asaas_bootstrap_pagador */

describe('F4 — asaas_bootstrap_pagador (a porta de escrita dos scripts)', () => {
  let sql: Sql
  const service = serviceClient()

  beforeAll(() => {
    sql = connect(2)
  })
  afterAll(async () => {
    await sql.end()
  })

  function cus() {
    return 'cus_f4_' + crypto.randomUUID().slice(0, 8)
  }

  it('cria payer com dados reais + vínculo TERCEIRO (individual) + audit, numa transação', async () => {
    const c = await createPrivateContract(sql)
    const id = cus()
    const { data, error } = await service.rpc('asaas_bootstrap_pagador', {
      p_asaas_customer_id: id,
      p_name: 'Dona Maria F4',
      p_email: 'maria.f4@x.com',
      p_cpf_cnpj: '12345678900',
      p_student_id: c.studentId,
      p_contexto: { origem: 'teste-f4' },
    })
    expect(error).toBeNull()

    const [payer] = await sql`select id, name, email, cpf_cnpj from payers where asaas_customer_id = ${id}`
    expect(payer.id).toBe(data)
    expect(payer.name).toBe('Dona Maria F4')
    expect(payer.email).toBe('maria.f4@x.com')

    const [vinculo] = await sql`
      select relationship from student_payers
       where student_id = ${c.studentId} and payer_id = ${payer.id}`
    expect(vinculo.relationship).toBe('terceiro') // NUNCA self automático (F3)

    const [aud] = await sql`
      select diff from audit_log
       where action = 'asaas.bootstrap_pagador' and entity_id = ${payer.id}`
    expect(aud.diff.acao).toBe('criado')
    expect(aud.diff.origem).toBe('teste-f4')

    // idempotente: repetir não duplica vínculo nem muda o cadastro
    const de_novo = await service.rpc('asaas_bootstrap_pagador', {
      p_asaas_customer_id: id, p_name: 'Outro Nome', p_email: null,
      p_cpf_cnpj: null, p_student_id: c.studentId, p_contexto: {},
    })
    expect(de_novo.error).toBeNull()
    const [{ n }] = await sql`
      select count(*)::int as n from student_payers
       where student_id = ${c.studentId} and payer_id = ${payer.id}`
    expect(n).toBe(1)
    const [depois] = await sql`select name from payers where id = ${payer.id}`
    expect(depois.name).toBe('Dona Maria F4') // enriquecido/manual é PRESERVADO
  })

  it('stub do webhook (name = asaas_customer_id) é enriquecido; some da lista de stubs', async () => {
    const id = cus()
    await sql`insert into payers (name, asaas_customer_id) values (${id}, ${id})`

    const antes = await service.rpc('asaas_pagadores_stub')
    expect(antes.error).toBeNull()
    expect((antes.data as Array<{ asaas_customer_id: string }>).map((s) => s.asaas_customer_id)).toContain(id)

    const { error } = await service.rpc('asaas_bootstrap_pagador', {
      p_asaas_customer_id: id, p_name: 'Seu José F4', p_email: 'jose.f4@x.com',
      p_cpf_cnpj: null, p_student_id: null, p_contexto: {},
    })
    expect(error).toBeNull()

    const [payer] = await sql`select name, email from payers where asaas_customer_id = ${id}`
    expect(payer.name).toBe('Seu José F4')
    expect(payer.email).toBe('jose.f4@x.com')

    const depois = await service.rpc('asaas_pagadores_stub')
    expect((depois.data as Array<{ asaas_customer_id: string }>).map((s) => s.asaas_customer_id)).not.toContain(id)
  })

  it('ACL: aluno autenticado NÃO executa as funções de script (revoke nominal)', async () => {
    const aluno = await clientAs(await createAuthUser(sql, 'student', 'Aluno F4 ACL'), 'student')
    const boot = await aluno.rpc('asaas_bootstrap_pagador', {
      p_asaas_customer_id: 'cus_negado', p_name: null, p_email: null,
      p_cpf_cnpj: null, p_student_id: null, p_contexto: {},
    })
    expect(boot.error).not.toBeNull()
    const stubs = await aluno.rpc('asaas_pagadores_stub')
    expect(stubs.error).not.toBeNull()
  })
})
