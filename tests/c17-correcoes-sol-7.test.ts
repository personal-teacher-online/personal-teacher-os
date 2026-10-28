// LOTE c17 — a resposta à RODADA 7 do Sol, na parte que se prova pela AÇÃO.
//
// O fio que amarra os três achados deste arquivo é o mesmo: o c16 provou a
// superfície de assinatura pela TELA (a seção some, os painéis redirecionam) e
// pelo CÓDIGO (grep de `redirect(self)`), e isso descreve o que a pessoa vê —
// não o que a fronteira aceita. Server Action é endpoint POST direto: quem monta
// o formulário à mão, ou quem tinha a aba aberta quando a env caiu, nunca passou
// por tela nenhuma. Então:
//
//  · r7 nº 1 (GRAVE) — `attachSignatureDocumentAction` e
//    `cancelSignatureReservationAction` iam direto para a RPC sem perguntar pela
//    chave. Agora as QUATRO ações de assinatura recusam sem a env;
//  · r7 nº 2 (MÉDIO) — o aceite passa a INVOCAR as quatro, com FormData válido e
//    a env ausente, e a prova é comportamental: nenhuma RPC, nenhum `from`,
//    nenhum `fetch`. Um cliente-dublê que EXPLODE se tocado é o que transforma
//    "não deveria tocar o banco" em teste, e não em promessa de comentário;
//  · r7 nº 4 (LEVE) — o "502 ponta a ponta" do c16 provava as duas pontas em
//    separado (o cliente devolve ambíguo; uma reserva solta fica `pending`).
//    Aqui é a AÇÃO inteira que roda, com o cliente Autentique dublê lançando o
//    ambíguo, contra o banco de verdade: a reserva que ela mesma abriu continua
//    `pending` e `admin_finish_signature` não foi chamada nenhuma vez.
//
// COMO A FRONTEIRA É EXERCITADA SEM NEXT. As ações dependem de três coisas do
// runtime: `redirect` (que no Next interrompe o fluxo lançando), o cliente
// Supabase da sessão e o cliente HTTP do Autentique. As três são substituídas
// aqui — `redirect` por uma exceção que carrega a URL (mesmo contrato: quem
// chama `done` não continua), o Supabase por um dublê e o Autentique por
// espiões. Tudo o mais é o código de produção: a guarda, a ordem das chamadas, o
// `requireAdminId` de verdade e, no r7 nº 4, as RPCs de verdade.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

const ponte = vi.hoisted(() => {
  /** O que `redirect()` faz no Next: interrompe lançando. O dublê guarda a URL. */
  class Redirecionou extends Error {
    readonly url: string
    constructor(url: string) {
      super(`NEXT_REDIRECT ${url}`)
      this.name = 'Redirecionou'
      this.url = url
    }
  }
  return {
    Redirecionou,
    /** O cliente que `createClient()` devolve na chamada corrente do teste. */
    cliente: null as SupabaseClient | null,
    criarDocumento: vi.fn(),
    consultarDocumento: vi.fn(),
  }
})

// `server-only` lança quando importado fora do bundle de servidor do Next — e a
// cadeia `actions.ts → lib/auth/admin.ts` o importa. Aqui ele é um no-op: o que
// esse marcador protege (a chave service_role não vazar para o cliente) é papel
// do bundler, não deste processo.
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new ponte.Redirecionou(url)
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ponte.cliente,
}))
vi.mock('@/lib/autentique/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/autentique/client')>()
  // Só a IDA à rede é dublê. `autentiqueConfigFromEnv` (que lê a env),
  // `envioNaoCriouDocumento` e a classe do erro continuam sendo as de produção —
  // são elas que decidem o caminho dentro da action.
  return {
    ...real,
    createDocumentForSignature: ponte.criarDocumento,
    getDocumentSignatures: ponte.consultarDocumento,
  }
})

import {
  attachSignatureDocumentAction,
  cancelSignatureReservationAction,
  refreshSignatureStatusAction,
  sendContractForSignatureAction,
} from '@/app/admin/contratos/actions'
import { AutentiqueEnvioError } from '@/lib/autentique/client'
import { AVISO_DA_ASSINATURA_DESLIGADA } from '@/data/admin/contratos-gramatica'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract } from './helpers/db'

let sql: Sql
let adminId: string
let adminReal: SupabaseClient
let espiaoDoFetch: ReturnType<typeof vi.spyOn>

beforeAll(async () => {
  sql = connect(4)
  adminId = await createAuthUser(sql, 'admin', 'Admin c17')
  adminReal = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  await sql.end()
})

beforeEach(() => {
  ponte.criarDocumento.mockReset()
  ponte.consultarDocumento.mockReset()
  espiaoDoFetch = vi.spyOn(globalThis, 'fetch')
})
afterEach(() => {
  espiaoDoFetch.mockRestore()
  vi.unstubAllEnvs()
  ponte.cliente = null
})

/* -------------------------------------------------------------------------- */
/* Os dois clientes-dublê                                                      */
/* -------------------------------------------------------------------------- */

/**
 * O cliente SECO: autentica e EXPLODE em qualquer leitura ou escrita.
 *
 * `requireAdminId` é o de produção, e ele pergunta ao cliente quem está logado —
 * por isso `auth.getUser` responde (com `app_metadata.role`, Lei 4). O resto não
 * responde: uma ação que passar da guarda não vai "só devolver vazio", vai
 * quebrar o teste com o nome exato do que ela tocou.
 */
function clienteSeco(): { cliente: SupabaseClient; tocou: string[] } {
  const tocou: string[] = []
  const explodir = (o: string): never => {
    tocou.push(o)
    throw new Error(`a ação tocou o banco sem a chave do Autentique: ${o}`)
  }
  const cliente = {
    auth: {
      getUser: async () => ({
        data: { user: { id: adminId, app_metadata: { role: 'admin' } } },
        error: null,
      }),
    },
    rpc: (nome: string) => explodir(`rpc:${nome}`),
    from: (tabela: string) => explodir(`from:${tabela}`),
  } as unknown as SupabaseClient
  return { cliente, tocou }
}

/** O cliente ESPIÃO: fala com o banco de verdade e anota a ordem das chamadas. */
function clienteEspiao(): { cliente: SupabaseClient; tocou: string[] } {
  const tocou: string[] = []
  const cliente = {
    auth: {
      getUser: async () => ({
        data: { user: { id: adminId, app_metadata: { role: 'admin' } } },
        error: null,
      }),
    },
    rpc: (nome: string, args?: Record<string, unknown>) => {
      tocou.push(`rpc:${nome}`)
      return adminReal.rpc(nome, args)
    },
    from: (tabela: string) => {
      tocou.push(`from:${tabela}`)
      return adminReal.from(tabela)
    },
  } as unknown as SupabaseClient
  return { cliente, tocou }
}

/* -------------------------------------------------------------------------- */
/* O leitor do recado                                                          */
/* -------------------------------------------------------------------------- */

/** Roda a ação e devolve o recado que ela pendurou na URL do `redirect`. */
async function recadoDe(acao: () => Promise<unknown>): Promise<{ destino: string; msg: string }> {
  try {
    await acao()
  } catch (e) {
    if (e instanceof ponte.Redirecionou) {
      const u = new URL(e.url, 'http://bancada.local')
      return { destino: u.pathname, msg: u.searchParams.get('msg') ?? '' }
    }
    throw e
  }
  throw new Error('a ação terminou sem redirecionar — ela deveria ter respondido algo')
}

const form = (campos: Record<string, string | File>): FormData => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

const pdfDeMentira = () =>
  new File([Buffer.from('%PDF-1.4 c17')], 'contrato.pdf', { type: 'application/pdf' })

/* ========================================================================== */
/* r7 nº 1 + nº 2 · as QUATRO ações recusam sem a env, pela fronteira          */
/* ========================================================================== */

describe('r7 nº 1/2 · sem AUTENTIQUE_TOKEN nenhuma das 4 ações chega ao banco', () => {
  const CONTRATO = '11111111-2222-3333-4444-555555555555'
  const RESERVA = '66666666-7777-8888-9999-000000000000'

  /** As quatro portas, com FormData que passaria por qualquer validação de campo. */
  const PORTAS: { nome: string; rodar: () => Promise<unknown> }[] = [
    {
      nome: 'sendContractForSignatureAction',
      rodar: () =>
        sendContractForSignatureAction(
          form({
            contract_id: CONTRATO,
            signer_email: 'aluna@exemplo.com',
            doc_name: 'Contrato c17',
            pdf: pdfDeMentira(),
            back: `/admin/contratos/${CONTRATO}`,
          }),
        ),
    },
    {
      nome: 'refreshSignatureStatusAction',
      rodar: () =>
        refreshSignatureStatusAction(
          form({ provider_document_id: 'doc-c17', back: `/admin/contratos/${CONTRATO}` }),
        ),
    },
    {
      nome: 'attachSignatureDocumentAction',
      rodar: () =>
        attachSignatureDocumentAction(
          form({
            signature_id: RESERVA,
            provider_document_id: 'doc-c17',
            back: `/admin/contratos/${CONTRATO}`,
          }),
        ),
    },
    {
      nome: 'cancelSignatureReservationAction',
      rodar: () =>
        cancelSignatureReservationAction(
          form({
            signature_id: RESERVA,
            confirm_phrase: 'confira antes no painel do Autentique se o documento existe',
            reason: 'o documento não existe lá fora',
            back: `/admin/contratos/${CONTRATO}`,
          }),
        ),
    },
  ]

  for (const porta of PORTAS) {
    it(`${porta.nome} recusa e não toca banco nem rede`, async () => {
      vi.stubEnv('AUTENTIQUE_TOKEN', '')
      const { cliente, tocou } = clienteSeco()
      ponte.cliente = cliente

      const { msg } = await recadoDe(porta.rodar)

      expect(msg, 'a recusa tem de dizer alguma coisa').not.toBe('')
      expect(msg.toLowerCase()).toMatch(/autentique/)
      expect(tocou, 'nenhuma RPC, nenhuma tabela').toEqual([])
      expect(ponte.criarDocumento, 'nada saiu para o Autentique').not.toHaveBeenCalled()
      expect(ponte.consultarDocumento).not.toHaveBeenCalled()
      expect(espiaoDoFetch, 'e nenhuma requisição HTTP saiu daqui').not.toHaveBeenCalled()
    })
  }

  it('as duas ações do r7 nº 1 devolvem o MESMO recado do painel desligado', async () => {
    vi.stubEnv('AUTENTIQUE_TOKEN', '')
    for (const porta of PORTAS.slice(2)) {
      const { cliente } = clienteSeco()
      ponte.cliente = cliente
      const { msg } = await recadoDe(porta.rodar)
      expect(msg, porta.nome).toBe(`Falha: ${AVISO_DA_ASSINATURA_DESLIGADA}`)
      expect(msg, 'e diz de que gate depende').toContain('🔑')
    }
  })

  it('COM a env, a guarda sai da frente (o teste acima não é um `false` fixo)', async () => {
    // A prova de que a recusa é da ENV e não de outra coisa: com a chave posta, a
    // mesma chamada passa da guarda e vai bater na RPC — que é onde ela deve
    // morrer, com o erro do BANCO (a reserva `RESERVA` não existe), não com o
    // aviso do gate.
    vi.stubEnv('AUTENTIQUE_TOKEN', 'token-de-teste')
    const { cliente, tocou } = clienteEspiao()
    ponte.cliente = cliente
    const { msg } = await recadoDe(() =>
      attachSignatureDocumentAction(
        form({
          signature_id: RESERVA,
          provider_document_id: 'doc-c17',
          back: `/admin/contratos/${CONTRATO}`,
        }),
      ),
    )
    expect(tocou, 'agora sim ela chega à RPC').toEqual(['rpc:admin_finish_signature'])
    expect(msg).not.toBe(`Falha: ${AVISO_DA_ASSINATURA_DESLIGADA}`)
    expect(msg).toMatch(/^Falha: /)
  })
})

/* ========================================================================== */
/* r7 nº 4 · o 502 ambíguo, agora pela AÇÃO inteira e contra o banco           */
/* ========================================================================== */

describe('r7 nº 4 · erro ambíguo no envio: a reserva fica ABERTA e ninguém a fecha', () => {
  it('a ação inteira roda, a reserva continua `pending` e `admin_finish_signature` não é chamada', async () => {
    vi.stubEnv('AUTENTIQUE_TOKEN', 'token-de-teste')
    // O ambíguo é o fato que importa: a API pode ter criado o documento e
    // quebrado depois. `envioNaoCriouDocumento` (real) responde `false` para ele.
    ponte.criarDocumento.mockRejectedValue(
      new AutentiqueEnvioError('502 do Autentique (corpo HTML)', 'ambiguo'),
    )

    const c = await createPrivateContract(sql)
    const { cliente, tocou } = clienteEspiao()
    ponte.cliente = cliente

    const { msg } = await recadoDe(() =>
      sendContractForSignatureAction(
        form({
          contract_id: c.contractId,
          signer_email: 'aluna@exemplo.com',
          doc_name: 'Contrato c17',
          pdf: pdfDeMentira(),
          back: `/admin/contratos/${c.contractId}`,
          back_erro: `/admin/contratos/${c.contractId}?painel=assinatura`,
        }),
      ),
    )

    // 1. a ação passou pela guarda e chegou até a PONTE do Autentique (dublê —
    //    a classificação HTTP real é provada em c15/c16; aqui o que se prova é
    //    o comportamento da ACTION diante do ambíguo; Sol r8 nº 3)
    expect(ponte.criarDocumento).toHaveBeenCalledTimes(1)
    // 2. o recado é o do ambíguo — reserva aberta DE PROPÓSITO
    expect(msg).toMatch(/Não deu para saber o que aconteceu no Autentique/)
    expect(msg).toMatch(/reserva deste contrato ficou ABERTA/)
    // 3. o ESPIÃO: a reserva foi aberta e NINGUÉM a fechou
    expect(tocou).toEqual(['from:contracts', 'rpc:admin_begin_signature'])
    expect(tocou, 'fechar a reserva aqui é o bug que o c15 matou').not.toContain(
      'rpc:admin_finish_signature',
    )
    // 4. e o BANCO concorda: a linha existe, aberta, sem carimbo de envio
    const linhas = await sql<{ status: string; sent_at: string | null }[]>`
      select status, sent_at from contract_signatures where contract_id = ${c.contractId}`
    expect(linhas).toHaveLength(1)
    expect(linhas[0].status, 'a reserva continua ABERTA').toBe('pending')
    expect(linhas[0].sent_at).toBeNull()

    // 5. o efeito que a reserva aberta existe para ter: o próximo envio recusa
    const retry = await adminReal.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(retry.error?.message).toMatch(/reserva de assinatura ABERTA/)
  })
})
