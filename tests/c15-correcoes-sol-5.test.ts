// LOTE c15 — as correções da RODADA 5 do Sol sobre o c14 (M4 + M5).
//
// A numeração dos `describe` é a do relatório dele, para a revisão seguinte
// achar cada achado sem garimpo. Duas seções não têm número porque não são
// achado e sim DECISÃO DE DESENHO do dono da arquitetura, tomada em cima dos
// achados 1, 2 e 3:
//
//  (A) erro AMBÍGUO nunca vira `failed`. A reserva só morre quando o Autentique
//      respondeu, com corpo interpretado, que NÃO criou documento. Timeout,
//      conexão que cai, corpo truncado e resposta sem id deixam a reserva
//      ABERTA — o estado honesto de "não sei o que houve lá fora".
//  (B) o reclaim automático de 30 minutos MORREU. Ele não distinguia reserva
//      abandonada de reserva viva: um envio lento perdia a vaga e o clique
//      seguinte criava o SEGUNDO documento. No lugar dele, dois atos humanos
//      auditados — anexar o id do documento que se conferiu existir, ou
//      cancelar a reserva com frase de confirmação e motivo.
//
// O QUE ESTE ARQUIVO PROVA CONTRA O BANCO (bancada local):
//  · a escada de certeza do cliente do Autentique, resposta por resposta,
//    inclusive o caso que dá nome à decisão A: o externo QUEBRA DEPOIS de
//    criar (200 com corpo truncado);
//  · reserva ambígua fica aberta e o retry NÃO duplica;
//  · o webhook que chega ANTES do anexo fica preso na inbox e é REAPLICADO, em
//    ordem, quando o documento é anexado;
//  · o vínculo do contrato (aluno/turma/tipo/professora) não muda por UPDATE,
//    nem para o dono da tabela — e a variante do TOCTOU em que T1 pega o nome
//    primeiro e T2 espera;
//  · os dois atos humanos, por comportamento (frase errada recusa, motivo
//    obrigatório, rastro no `audit_log`, vaga liberada só depois do ato);
//  · `sent_at` só existe quando existe documento;
//  · o teto do plano medido em CODE POINTS, com 80 emojis, dos dois lados.
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { handleAutentiqueWebhook } from '../src/lib/webhooks/autentique'
import {
  AutentiqueEnvioError,
  createDocumentForSignature,
  envioNaoCriouDocumento,
} from '../src/lib/autentique/client'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createPrivateContract, createStudent, createTeacher } from './helpers/db'
import {
  ASSINATURA_ROTULO,
  ESTADOS_TERMINAIS,
  FRASE_DE_CANCELAR_RESERVA,
} from '@/data/admin/contratos-gramatica'
import { NovoContratoSchema, TETO_DO_PLANO } from '@/data/admin/contrato-novo'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const unico = (prefixo: string) => `${prefixo} ${crypto.randomUUID().slice(0, 8)}`
const docNovo = () => 'c15doc' + crypto.randomUUID().replace(/-/g, '')

/** O que importa de uma resposta do PostgREST nestas provas. */
type Resposta = { data: unknown; error: { message: string; code?: string } | null }

let sql: Sql
let admin: SupabaseClient
const service = serviceClient()

beforeAll(async () => {
  sql = connect(8)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin c15'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/**
 * Espera até que ALGUMA transação esteja bloqueada num lock enquanto roda algo
 * que casa com `alvo`. É o que torna as provas de concorrência determinísticas.
 */
async function esperarBloqueio(alvo: string, ms = 15_000): Promise<boolean> {
  const ate = Date.now() + ms
  while (Date.now() < ate) {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n
        from pg_stat_activity
       where datname = current_database()
         and state = 'active'
         and wait_event_type = 'Lock'
         and query ilike ${'%' + alvo + '%'}`
    if (Number(n) > 0) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

/* ========================================================================== */
/* (A) · erro AMBÍGUO não mata a reserva                                       */
/* ========================================================================== */

describe('A · a escada de certeza do cliente do Autentique', () => {
  const cfg = { token: 'token-de-teste', sandbox: true }
  const envio = () =>
    createDocumentForSignature(cfg, {
      name: 'Contrato de teste c15',
      pdf: Buffer.from('%PDF-1.4 teste'),
      signerEmail: 'aluno@exemplo.com',
    })

  /** Troca o `fetch` global por um dublê e devolve o que a chamada lançou. */
  async function comFetch(duble: () => Promise<Response> | never): Promise<unknown> {
    const original = globalThis.fetch
    globalThis.fetch = duble as typeof fetch
    try {
      await envio()
      return null
    } catch (err) {
      return err
    } finally {
      globalThis.fetch = original
    }
  }

  const resposta = (status: number, corpoTexto: string) =>
    new Response(corpoTexto, { status, headers: { 'content-type': 'application/json' } })

  it('a rede que cai é AMBÍGUA — a requisição pode ter chegado inteira', async () => {
    const err = await comFetch(() => Promise.reject(new Error('ECONNRESET')))
    expect(err).toBeInstanceOf(AutentiqueEnvioError)
    expect((err as AutentiqueEnvioError).certeza).toBe('ambiguo')
    expect(envioNaoCriouDocumento(err), 'e a action NÃO pode fechar a reserva').toBe(false)
  })

  it('O CASO QUE DÁ NOME À DECISÃO: 200, documento criado, corpo TRUNCADO na volta', async () => {
    // É este o cenário que o c14 tratava como "o Autentique recusou": a criação
    // ACONTECEU (o provedor devolveu 200) e a resposta chegou pela metade. Com o
    // desenho velho, a reserva virava `failed`, o retry ficava liberado e o
    // segundo envio criava o SEGUNDO contrato para o aluno assinar.
    const err = await comFetch(() =>
      Promise.resolve(resposta(200, '{"data":{"createDocument":{"id":"abc123def456"')),
    )
    expect((err as AutentiqueEnvioError).certeza).toBe('ambiguo')
    expect(envioNaoCriouDocumento(err)).toBe(false)
  })

  it('200 com `errors[]` é recusa INEQUÍVOCA — a mutation rodou e não criou nada', async () => {
    const err = await comFetch(() =>
      Promise.resolve(resposta(200, JSON.stringify({ errors: [{ message: 'file too large' }] }))),
    )
    expect((err as AutentiqueEnvioError).certeza).toBe('nao-criou')
    expect(envioNaoCriouDocumento(err)).toBe(true)
    expect((err as Error).message).toContain('file too large')
  })

  it('5xx COM corpo de errors[] segue AMBÍGUO — errors não prova rollback (Sol r6 nº 2)', async () => {
    // O GraphQL admite `errors[]` com execução parcial; num 5xx o servidor pode
    // ter quebrado DEPOIS de criar o documento. Antes desta guarda, o ramo dos
    // errors rodava primeiro e fechava a reserva como 'nao-criou'.
    const err = await comFetch(() =>
      Promise.resolve(resposta(500, JSON.stringify({ errors: [{ message: 'internal error' }] }))),
    )
    expect((err as AutentiqueEnvioError).certeza).toBe('ambiguo')
    expect(envioNaoCriouDocumento(err)).toBe(false)
  })

  it('4xx com corpo lido é recusa (o pedido nem virou documento); 5xx é ambíguo', async () => {
    const quatro = await comFetch(() =>
      Promise.resolve(resposta(401, JSON.stringify({ message: 'Unauthenticated.' }))),
    )
    expect((quatro as AutentiqueEnvioError).certeza).toBe('nao-criou')

    const cinco = await comFetch(() => Promise.resolve(resposta(502, '<html>bad gateway</html>')))
    expect((cinco as AutentiqueEnvioError).certeza, 'o servidor pode ter quebrado DEPOIS de criar').toBe(
      'ambiguo',
    )
  })

  it('200 sem id e sem erro declarado: respondeu e não entendemos → ambíguo', async () => {
    const err = await comFetch(() => Promise.resolve(resposta(200, JSON.stringify({ data: {} }))))
    expect((err as AutentiqueEnvioError).certeza).toBe('ambiguo')
  })

  it('e o caminho feliz continua devolvendo o id', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (() =>
      Promise.resolve(
        resposta(
          200,
          JSON.stringify({
            data: { createDocument: { id: 'doc-feliz-c15', signatures: [{ link: { short_link: 'x' } }] } },
          }),
        ),
      )) as typeof fetch
    try {
      await expect(envio()).resolves.toMatchObject({ documentId: 'doc-feliz-c15' })
    } finally {
      globalThis.fetch = original
    }
  })

  it('erro de OUTRO tipo (bug nosso) cai no ambíguo — não saber o que quebrou é não saber', () => {
    expect(envioNaoCriouDocumento(new TypeError('undefined is not a function'))).toBe(false)
    expect(envioNaoCriouDocumento('string solta')).toBe(false)
  })
})

describe('A · a action só fecha a reserva quando a recusa é inequívoca', () => {
  it('o `catch` do envio pergunta antes de matar', () => {
    const a = codigo('src/app/admin/contratos/actions.ts')
    const guarda = a.indexOf('if (!envioNaoCriouDocumento(err))')
    const fecha = a.indexOf('p_error: String(err)')
    expect(guarda, 'a pergunta existe').toBeGreaterThan(-1)
    expect(fecha, 'e o desfecho da reserva vem DEPOIS dela').toBeGreaterThan(guarda)
    // o recado do ambíguo manda a pessoa para as duas portas humanas
    expect(a).toContain('anexe o id dele à reserva')
    expect(a).toContain('cancele a reserva')
  })

  it('a reserva ambígua fica ABERTA no banco, e o retry NÃO duplica', async () => {
    // O ambíguo, do lado do banco, é a AUSÊNCIA de desfecho: ninguém chama
    // `admin_finish_signature`. É esse estado que trava o próximo envio.
    const c = await createPrivateContract(sql)
    const reserva = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(reserva.error).toBeNull()

    const retry = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(retry.error, 'o segundo envio às cegas é recusado').not.toBeNull()
    expect(retry.error!.message).toMatch(/reserva de assinatura ABERTA/)

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from contract_signatures where contract_id = ${c.contractId}`
    expect(Number(n), 'uma linha só — nenhum documento fantasma').toBe(1)
    const [linha] = await sql<{ status: string; sent_at: string | null }[]>`
      select status, sent_at from contract_signatures where contract_id = ${c.contractId}`
    expect(linha.status).toBe('pending')
    expect(linha.sent_at, 'e ela não diz que foi enviada').toBeNull()
  })
})

/* ========================================================================== */
/* (B) · o relógio sai, a gente entra — os dois atos humanos                   */
/* ========================================================================== */

describe('B · o reclaim automático de 30 minutos não existe mais', () => {
  it('a função de reserva não tem relógio nenhum no corpo', async () => {
    const [{ src }] = await sql<{ src: string }[]>`
      select prosrc as src from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'admin_begin_signature'`
    expect(src, 'nada de "30 minutes"').not.toMatch(/30 minutes/)
    expect(src, 'e nada de reclamar reserva por idade').not.toMatch(/reclaim|reclamad/i)
    // o que ficou no lugar: a recusa que ENSINA as duas saídas
    expect(src).toMatch(/anexe o id/)
    expect(src).toMatch(/cancele a reserva/)
  })
})

describe('B · ato humano 1: cancelar a reserva', () => {
  async function reservaAberta() {
    const c = await createPrivateContract(sql)
    const r = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    expect(r.error).toBeNull()
    return { contractId: c.contractId, id: r.data as string }
  }

  it('frase errada NÃO cancela — o portão é a instrução, não o nome', async () => {
    const { id } = await reservaAberta()
    const errada = await admin.rpc('admin_cancel_signature', {
      p_signature: id,
      p_confirm: 'cancelar',
      p_reason: 'não criou',
    })
    expect(errada.error).not.toBeNull()
    expect(errada.error!.message).toMatch(/confirmação não confere/)
    expect(errada.error!.message).toContain(FRASE_DE_CANCELAR_RESERVA)

    const [linha] = await sql<{ status: string }[]>`
      select status from contract_signatures where id = ${id}`
    expect(linha.status, 'a reserva continua viva').toBe('pending')
  })

  it('sem motivo também não — o histórico precisa saber por que a reserva morreu', async () => {
    const { id } = await reservaAberta()
    const semMotivo = await admin.rpc('admin_cancel_signature', {
      p_signature: id,
      p_confirm: FRASE_DE_CANCELAR_RESERVA,
      p_reason: '   ',
    })
    expect(semMotivo.error!.message).toMatch(/motivo do cancelamento/)
  })

  it('com a frase e o motivo: a reserva morre, a vaga abre e o rastro fica (Lei 8)', async () => {
    const { contractId, id } = await reservaAberta()
    const motivo = unico('conferi no Autentique, não existe documento c15')
    const ok = await admin.rpc('admin_cancel_signature', {
      p_signature: id,
      // a frase digitada com CAIXA e ESPAÇO de gente de verdade (c15 · Sol 12)
      p_confirm: `  Confira ANTES no painel do   Autentique se o documento existe `,
      p_reason: motivo,
    })
    expect(ok.error).toBeNull()
    expect(ok.data).toBe('failed')

    const [linha] = await sql<{ status: string; sent_at: string | null }[]>`
      select status, sent_at from contract_signatures where id = ${id}`
    expect(linha.status).toBe('failed')
    expect(linha.sent_at, 'reserva cancelada nunca foi enviada').toBeNull()

    // a vaga abriu: o próximo envio nasce limpo
    const nova = await admin.rpc('admin_begin_signature', { p_contract: contractId })
    expect(nova.error).toBeNull()

    const [{ diff }] = await sql<{ diff: { motivo: string; to: string } }[]>`
      select diff from audit_log where action = 'cancel_signature' and entity_id = ${id}
       order by id desc limit 1`
    expect(diff.motivo).toBe(motivo)
    expect(diff.to).toBe('failed')
  })

  it('e reserva que já teve desfecho não se cancela duas vezes', async () => {
    const { id } = await reservaAberta()
    await admin.rpc('admin_cancel_signature', {
      p_signature: id,
      p_confirm: FRASE_DE_CANCELAR_RESERVA,
      p_reason: 'primeira vez',
    })
    const denovo = await admin.rpc('admin_cancel_signature', {
      p_signature: id,
      p_confirm: FRASE_DE_CANCELAR_RESERVA,
      p_reason: 'segunda vez',
    })
    expect(denovo.error!.message).toMatch(/não está aberta \(failed\)/)
  })

  it('a frase da tela e a frase do banco são a MESMA (cópia sem aceite diverge)', async () => {
    const [{ src }] = await sql<{ src: string }[]>`
      select prosrc as src from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'admin_cancel_signature'`
    expect(src).toContain(FRASE_DE_CANCELAR_RESERVA)
    expect(codigo('src/components/admin/contratos/paineis.tsx')).toContain(
      'FRASE_DE_CANCELAR_RESERVA',
    )
  })
})

describe('B · ato humano 2: anexar o id do documento', () => {
  it('formato torto é recusado com frase de gente, e o certo casa o documento', async () => {
    const c = await createPrivateContract(sql)
    const reserva = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    const id = reserva.data as string

    for (const torto of ['curto', 'com espaço no meio', 'https://autentique.com.br/documentos/abc']) {
      const r = await admin.rpc('admin_finish_signature', { p_signature: id, p_document_id: torto })
      expect(r.error, torto).not.toBeNull()
      expect(r.error!.message, torto).toMatch(/id de documento do Autentique inválido/)
    }
    // e nada mudou na reserva
    const [antes] = await sql<{ status: string }[]>`
      select status from contract_signatures where id = ${id}`
    expect(antes.status).toBe('pending')

    const doc = docNovo()
    const ok = await admin.rpc('admin_finish_signature', { p_signature: id, p_document_id: doc })
    expect(ok.error).toBeNull()
    expect(ok.data).toBe('sent')

    const [linha] = await sql<{
      status: string
      provider_document_id: string
      reserved_at: string
      sent_at: string
    }[]>`select status, provider_document_id, reserved_at, sent_at
           from contract_signatures where id = ${id}`
    expect(linha.provider_document_id).toBe(doc)
    // c15 · Sol 8: o carimbo de envio nasce AGORA, e nunca antes da reserva
    expect(new Date(linha.sent_at).getTime()).toBeGreaterThanOrEqual(
      new Date(linha.reserved_at).getTime(),
    )
  })
})

/* ========================================================================== */
/* Sol 4 · webhook que chega ANTES do anexo não se perde                       */
/* ========================================================================== */

describe('Sol 4 · o evento que chega antes do espelho fica preso e é reaplicado', () => {
  const SECRET = 'autentique-secret-c15'
  const evento = (type: string, documentId: string) => ({
    id: 'wbk_' + crypto.randomUUID().slice(0, 12),
    object: 'webhook',
    event: {
      id: 'aut_' + crypto.randomUUID().slice(0, 12),
      type,
      data: { object: { id: 'sig_' + crypto.randomUUID().slice(0, 8), document: { id: documentId } } },
    },
  })
  async function entregar(evt: ReturnType<typeof evento>) {
    const rawBody = JSON.stringify(evt)
    return handleAutentiqueWebhook(service, {
      rawBody,
      signature: createHmac('sha256', SECRET).update(rawBody).digest('hex'),
      secret: SECRET,
    })
  }

  it('evento antes do anexo → inbox PRESA (200 mesmo assim) → anexa → estado final reflete o evento', async () => {
    const c = await createPrivateContract(sql)
    const reserva = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    const doc = docNovo()

    // O documento existe no Autentique e o aluno já mexeu nele — mas o espelho
    // local ainda é uma reserva sem id (a janela entre criar e anexar).
    //
    // c16 · r6 nº 3: o segundo evento é `document.finished`, e não
    // `signature.accepted`. O aceite é de UM signatário e agora vale `viewed`
    // (andamento) — quem encerra o documento é o evento que fala do documento.
    const visto = evento('signature.viewed', doc)
    const assinado = evento('document.finished', doc)
    for (const evt of [visto, assinado]) {
      const r = await entregar(evt)
      // Lei 6: o provedor NUNCA vê falha nossa — ele desativa a URL.
      expect(r.status, 'o webhook responde 200').toBe(200)
    }

    const presos = await sql<{ event_id: string; processed_at: string | null; error: string }[]>`
      select event_id, processed_at, error from webhook_inbox
       where source = 'autentique' and event_id in (${visto.event.id}, ${assinado.event.id})
       order by id`
    expect(presos).toHaveLength(2)
    for (const p of presos) {
      expect(p.processed_at, 'evento sem espelho NÃO é dado por processado').toBeNull()
      expect(p.error).toMatch(/ainda sem registro/)
    }

    // ATO HUMANO (ou o anexo automático do envio): o documento casa com a reserva
    const anexo = await admin.rpc('admin_finish_signature', {
      p_signature: reserva.data as string,
      p_document_id: doc,
    })
    expect(anexo.error).toBeNull()

    const [linha] = await sql<{ status: string; signed_at: string | null }[]>`
      select status, signed_at from contract_signatures where provider_document_id = ${doc}`
    expect(linha.status, 'o estado final reflete o evento que tinha chegado antes').toBe('signed')
    expect(linha.signed_at).not.toBeNull()

    const depois = await sql<{ processed_at: string | null }[]>`
      select processed_at from webhook_inbox
       where source = 'autentique' and event_id in (${visto.event.id}, ${assinado.event.id})`
    for (const d of depois) expect(d.processed_at, 'e agora sim, processados').not.toBeNull()

    // A ORDEM: aplicados na sequência em que chegaram (viewed e depois signed).
    // Fora de ordem, a matriz monotônica engoliria o `viewed` e o `audit_log`
    // teria UMA transição só — é por isso que a prova olha a trilha, e não o
    // estado final.
    const [{ sig }] = await sql<{ sig: string }[]>`
      select id as sig from contract_signatures where provider_document_id = ${doc}`
    const trilha = await sql<{ diff: { from: string; to: string } }[]>`
      select diff from audit_log
       where action = 'apply_autentique_event' and entity_id = ${sig} order by id`
    expect(trilha.map((t) => `${t.diff.from}→${t.diff.to}`)).toEqual([
      'sent→viewed',
      'viewed→signed',
    ])

    // e o anexo conta quantos resgatou (Lei 8)
    const [{ diff }] = await sql<{ diff: { eventos_reaplicados: number } }[]>`
      select diff from audit_log where action = 'finish_signature'
        and entity_id = ${reserva.data as string} order by id desc limit 1`
    expect(diff.eventos_reaplicados).toBe(2)
  })

  it('a matriz evento→status do TypeScript e a do SQL são a mesma, tipo a tipo', async () => {
    // As duas cópias existem porque o banco precisa dela sem round-trip (a
    // reaplicação acontece dentro da transação do anexo). Cópia sem aceite é
    // cópia que diverge.
    const ts = codigo('src/lib/webhooks/autentique.ts')
    const pares = [...ts.matchAll(/'((?:signature|document)\.[a-z]+)':\s*'(\w+)'/g)].map(
      (m) => [m[1], m[2]] as const,
    )
    expect(pares.length, 'a varredura tem o que varrer').toBe(5)
    for (const [tipo, status] of pares) {
      const [{ sql_status }] = await sql<{ sql_status: string | null }[]>`
        select public.autentique_status_do_evento(${tipo}) as sql_status`
      expect(sql_status, tipo).toBe(status)
    }
    // e o SQL não conhece nenhum tipo A MAIS que o TS
    const [{ src }] = await sql<{ src: string }[]>`
      select prosrc as src from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'autentique_status_do_evento'`
    const tiposNoSql = [...src.matchAll(/when '((?:signature|document)\.[a-z]+)'/g)].map((m) => m[1])
    expect(tiposNoSql.sort()).toEqual(pares.map(([t]) => t).sort())
    const [{ desconhecido }] = await sql<{ desconhecido: string | null }[]>`
      select public.autentique_status_do_evento('document.updated') as desconhecido`
    expect(desconhecido).toBeNull()
  })
})

/* ========================================================================== */
/* Sol 6 · o vínculo do contrato é imutável                                    */
/* ========================================================================== */

describe('Sol 6 · aluno, turma, tipo e professora de um contrato não mudam por UPDATE', () => {
  it('as quatro colunas recusam — e nem o DONO da tabela escapa', async () => {
    const c = await createPrivateContract(sql)
    const outro = await createStudent(sql)
    const outraProf = await createTeacher(sql)
    const [g] = await sql<{ id: string }[]>`
      insert into student_groups (label) values (${unico('Turma c15')}) returning id`

    const tentar = (frag: Promise<unknown>) =>
      frag.then(
        () => null,
        (e: Error) => e.message,
      )

    expect(
      await tentar(sql`update contracts set student_id = ${outro} where id = ${c.contractId}`),
      'trocar o aluno',
    ).toMatch(/vínculo de um contrato não muda/)
    expect(
      await tentar(sql`update contracts set student_group_id = ${g.id} where id = ${c.contractId}`),
      'pendurar numa turma',
    ).toMatch(/vínculo de um contrato não muda/)
    expect(
      await tentar(sql`update contracts set teacher_id = ${outraProf} where id = ${c.contractId}`),
      'trocar a professora',
    ).toMatch(/vínculo de um contrato não muda/)
    // `forbid_contract_type_flip` (20260711000400) já guardava esta coluna, mas
    // SÓ quando o contrato já tinha extensão de mentoria ou histórico em ledger
    // — um contrato recém-criado virava mentoria sem que ninguém reclamasse. É
    // este gatilho que fecha o buraco.
    expect(
      await tentar(
        sql`update contracts set contract_type = 'mentorship' where id = ${c.contractId}`,
      ),
      'virar mentoria',
    ).toMatch(/vínculo de um contrato não muda/)

    // a recusa DIZ o caminho legítimo
    const msg = await tentar(sql`update contracts set student_id = ${outro} where id = ${c.contractId}`)
    expect(msg).toMatch(/renovação|renove/i)

    // e o que É editável continua editável (a guarda não virou muro)
    await sql`update contracts set plan_name = 'plano novo c15' where id = ${c.contractId}`
    const [linha] = await sql<{ plan_name: string; student_id: string }[]>`
      select plan_name, student_id from contracts where id = ${c.contractId}`
    expect(linha.plan_name).toBe('plano novo c15')
    expect(linha.student_id).toBe(c.studentId)
  })

  it('mencionar a coluna sem mudar o valor não é troca de dono', async () => {
    // `before update of coluna` dispara quando a coluna está no SET, mesmo com o
    // mesmo valor — e um `update … set student_id = <o mesmo>` é o que uma
    // ferramenta de administração faz ao salvar a linha inteira.
    const c = await createPrivateContract(sql)
    await sql`update contracts set student_id = ${c.studentId} where id = ${c.contractId}`
    const [linha] = await sql<{ student_id: string }[]>`
      select student_id from contracts where id = ${c.contractId}`
    expect(linha.student_id).toBe(c.studentId)
  })
})

describe('Sol 10 · TOCTOU do nome, a variante em que T1 chega primeiro', () => {
  it('T1 trava o aluno e T2 ESPERA: a renomeação só entra depois do encerramento', async () => {
    const c = await createPrivateContract(sql)
    const nome = unico('Elisa Primeiro c15')
    await sql`update students set display_name = ${nome} where id = ${c.studentId}`
    const depois = unico('Elisa Depois c15')

    // T0 segura a linha do CONTRATO. Serve só para parar T1 DEPOIS que ela já
    // travou o aluno (andar 0 da escada) — sem isso, o encerramento acabaria
    // antes de dar tempo de medir qualquer coisa.
    const t0 = connect(1)
    const t2conn = connect(1)
    let t1: PromiseLike<Resposta> | null = null
    let t2: PromiseLike<string | null> | null = null
    let t1Esperou = false
    let t2Esperou = false
    try {
      await t0.begin(async (tx) => {
        await tx`select id from contracts where id = ${c.contractId} for update`

        t1 = admin
          .rpc('admin_end_contract', { p_contract: c.contractId, p_confirm_name: nome })
          .then((r): Resposta => r)
        t1Esperou = await esperarBloqueio('admin_end_contract')

        // Agora T2 tenta renomear. T1 já é dona da linha do aluno.
        t2 = t2conn`update students set display_name = ${depois} where id = ${c.studentId}`.then(
          () => null,
          (e: Error) => e.message,
        )
        t2Esperou = await esperarBloqueio('update students set display_name')
      })
      // saiu do `begin` → COMMIT de T0: T1 acorda e termina; T2 acorda depois
    } finally {
      await t0.end()
      await t2conn.end()
    }

    expect(t1Esperou, 'T1 tem de estar esperando pelo contrato').toBe(true)
    expect(t2Esperou, 'e T2 tem de esperar por T1 — a linha do nome está travada').toBe(true)

    const r1 = await t1!
    expect(r1.error, 'o nome que T1 digitou era o vigente quando ela travou').toBeNull()
    expect(await t2!, 'e a renomeação acontece, só que DEPOIS').toBeNull()

    const [contrato] = await sql<{ status: string }[]>`
      select status from contracts where id = ${c.contractId}`
    expect(contrato.status).toBe('ended')
    const [aluno] = await sql<{ display_name: string }[]>`
      select display_name from students where id = ${c.studentId}`
    expect(aluno.display_name).toBe(depois)
  }, 60_000)
})

/* ========================================================================== */
/* Sol 5 · `student_group_members` perde também o UPDATE                       */
/* ========================================================================== */

describe('Sol 5 · membro de turma não se EDITA pela API', () => {
  it('o UPDATE direto da admin cai no pino 42501', async () => {
    const alunos = [await createStudent(sql), await createStudent(sql)]
    const { data, error } = await admin.rpc('admin_create_contract', {
      p_kind: 'group',
      p_students: alunos,
      p_group_label: unico('Turma c15'),
      p_tz_anchor: alunos[0],
      p_plan_name: 'Aulas do casal',
      p_hourly_rate_cents: 18000,
      p_teacher: await createTeacher(sql),
    })
    expect(error).toBeNull()
    const grupo = (data as { group_id: string }).group_id

    const r = await admin
      .from('student_group_members')
      .update({ student_id: await createStudent(sql) })
      .eq('group_id', grupo)
    expect(r.error?.code, 'trocar o aluno de uma turma por UPDATE não é porta').toBe('42501')

    const membros = await sql<{ student_id: string }[]>`
      select student_id from student_group_members where group_id = ${grupo}`
    expect(membros.map((m) => m.student_id).sort()).toEqual([...alunos].sort())
  })

  it('e o privilégio saiu do papel `authenticated` (não é só a policy)', async () => {
    const [{ tem }] = await sql<{ tem: boolean }[]>`
      select has_table_privilege('authenticated', 'student_group_members', 'UPDATE') as tem`
    expect(tem).toBe(false)
    const [{ del }] = await sql<{ del: boolean }[]>`
      select has_table_privilege('authenticated', 'student_group_members', 'DELETE') as del`
    expect(del, 'sair da turma continua sendo ato legítimo').toBe(true)
  })
})

/* ========================================================================== */
/* Sol 7 · o preflight do índice único                                         */
/* ========================================================================== */

describe('Sol 7 · a unicidade do pedido vivo não entra em dado sujo em silêncio', () => {
  it('a migration começa por um preflight que FALHA com diagnóstico', () => {
    const m = corpo('supabase/migrations/20260727001500_correcoes_sol_rodada_5.sql')
    const preflight = m.indexOf('do $preflight$')
    expect(preflight, 'o bloco existe').toBeGreaterThan(-1)
    expect(preflight, 'e é a PRIMEIRA coisa executada do arquivo').toBeLessThan(
      m.indexOf('alter table contract_signatures'),
    )
    expect(m).toContain('having count(*) > 1')
    // nunca sanear: o bloco levanta exceção, não escreve nada
    const bloco = m.slice(preflight, m.indexOf('$preflight$;'))
    expect(bloco).toContain('raise exception')
    expect(bloco).not.toMatch(/\b(update|delete|insert)\b/i)
  })

  it('e o estado ATUAL da bancada passa por ele', async () => {
    const sujos = await sql<{ contract_id: string; n: number }[]>`
      select contract_id, count(*)::int as n from contract_signatures
       where status in ('pending', 'sent', 'viewed')
       group by contract_id having count(*) > 1`
    expect(sujos, 'nenhum contrato com dois pedidos vivos').toHaveLength(0)
  })
})

/* ========================================================================== */
/* Sol 8 · `sent_at` deixa de mentir                                           */
/* ========================================================================== */

describe('Sol 8 · carimbo de envio e id de documento nascem juntos', () => {
  it('a coluna perdeu o default, e o CHECK amarra os dois', async () => {
    const [{ padrao, obrigatoria }] = await sql<{ padrao: string | null; obrigatoria: boolean }[]>`
      select column_default as padrao, (is_nullable = 'NO') as obrigatoria
        from information_schema.columns
       where table_name = 'contract_signatures' and column_name = 'sent_at'`
    expect(padrao, 'sem default: quem escreve envio DIZ que houve envio').toBeNull()
    expect(obrigatoria).toBe(false)

    const c = await createPrivateContract(sql)
    const cru = (status: string, doc: string | null, enviado: boolean) =>
      sql`insert into contract_signatures (contract_id, status, provider_document_id, sent_at)
          values (${c.contractId}, ${status}, ${doc}, ${enviado ? sql`now()` : null})`.then(
        () => null,
        (e: Error) => e.message,
      )
    expect(await cru('pending', null, true), 'reserva com hora de envio é mentira').toMatch(
      /contract_signatures_sent_shape/,
    )
    expect(await cru('sent', docNovo(), false), 'enviado sem hora de envio também').toMatch(
      /contract_signatures_sent_shape/,
    )
    expect(await cru('sent', docNovo(), true), 'e o par coerente entra').toBeNull()
  })

  it('a tela NUNCA carimba hora em reserva aberta nem em envio não concluído', () => {
    const d = codigo('src/components/admin/contratos/detalhe.tsx')
    /*
     * c16 · r6 nº 8 — A PALAVRA MUDOU, A REGRA DO c15 CONTINUA.
     *
     * O carimbo segue CONDICIONAL ao documento existir, e o lado falso segue
     * falando de PEDIDO. O que saiu foi a palavra "enviado": `sent_at` é escrito
     * por `admin_finish_signature`, que serve tanto o envio automático quanto o
     * ANEXO humano do id — e no anexo aquela hora não é a do envio.
     */
    expect(d).toMatch(/a\.vinculadaEm\s*\?\s*`vinculado em \$\{a\.vinculadaEm\}`/)
    expect(d).toContain('`pedido aberto em ${a.reservadaEm}`')
    expect(d.match(/enviado em/g), 'a tela não afirma envio em data nenhuma').toBeNull()
    // e a camada de dados só preenche o carimbo quando há `sent_at`
    expect(codigo('src/data/admin/contrato-detalhe.ts')).toContain(
      'vinculadaEm: a.sent_at ? fmtLocal(a.sent_at, BUSINESS_TZ) : null',
    )
  })

  it('e o histórico é ordenado por `reserved_at` nas DUAS leituras', () => {
    for (const arquivo of ['src/data/admin/contratos.ts', 'src/data/admin/contrato-detalhe.ts']) {
      const a = codigo(arquivo)
      expect(a, arquivo).toContain(".order('reserved_at', { ascending: false })")
      expect(a, arquivo).not.toContain(".order('sent_at'")
    }
  })
})

/* ========================================================================== */
/* Sol 9 · terminal é terminal na régua da tela também                         */
/* ========================================================================== */

describe('Sol 9 · "Ver status" não aparece em estado que não muda mais', () => {
  it('expirado e cancelado entraram na lista de terminais', () => {
    for (const s of ['signed', 'refused', 'expired', 'cancelled', 'failed']) {
      expect(ESTADOS_TERMINAIS.has(s), s).toBe(true)
    }
    for (const s of ['sent', 'viewed', 'pending']) {
      expect(ESTADOS_TERMINAIS.has(s), s).toBe(false)
    }
  })

  it('a lista da tela é a MESMA da matriz do banco', async () => {
    // `apply_autentique_event` recusa sair de qualquer terminal: o rank dele é 3
    // para tudo que não é `sent`/`viewed`, e a comparação é `<=`. A régua da
    // tela não pode ser mais frouxa que essa.
    const c = await createPrivateContract(sql)
    const reserva = await admin.rpc('admin_begin_signature', { p_contract: c.contractId })
    const doc = docNovo()
    await admin.rpc('admin_finish_signature', {
      p_signature: reserva.data as string,
      p_document_id: doc,
    })
    for (const terminal of ['expired', 'cancelled']) {
      const ida = await service.rpc('apply_autentique_event', {
        p_provider_document_id: doc,
        p_new_status: terminal,
      })
      expect(ida.error).toBeNull()
      // e de lá não se sai
      const volta = await service.rpc('apply_autentique_event', {
        p_provider_document_id: doc,
        p_new_status: 'signed',
      })
      expect(volta.data, `${terminal} é fim de linha`).toBe(terminal)
      // devolve o estado ao ponto de partida para o próximo laço não mentir
      await sql`update contract_signatures set status = 'sent' where provider_document_id = ${doc}`
    }
  })

  it('e o painel de consulta só abre para documento NÃO terminal', () => {
    expect(codigo('src/components/admin/contratos/paineis.tsx')).toContain(
      'contrato.assinaturas.find((a) => a.documento === alvo && !a.terminal)',
    )
  })
})

/* ========================================================================== */
/* Sol 14 · `failed` pede decisão, e a cor diz isso                            */
/* ========================================================================== */

describe('Sol 14 · o estado que pede decisão não é neutro no índice', () => {
  it('`failed` e `pending` vestem o tom de ATENÇÃO', () => {
    const l = codigo('src/components/admin/alunos/ListaDeContratos.tsx')
    const mapa = l.slice(l.indexOf('const ASSINATURA_TOM'), l.indexOf('}', l.indexOf('const ASSINATURA_TOM')))
    expect(mapa).toMatch(/failed:\s*'warn'/)
    expect(mapa).toMatch(/pending:\s*'warn'/)
    expect(mapa, 'e o assinado continua sendo o verde').toMatch(/signed:\s*'ok'/)
  })

  it('e os rótulos dos dois dizem o que são, sem convidar a esperar', () => {
    expect(ASSINATURA_ROTULO.pending).toBe('reserva aberta')
    expect(ASSINATURA_ROTULO.failed).toBe('envio não concluído')
  })
})

/* ========================================================================== */
/* Sol 12 · a confirmação de nome dobra o espaço interno                       */
/* ========================================================================== */

describe('Sol 12 · espaço repetido no meio do nome é ruído, não outro nome', () => {
  async function contratoChamado(nome: string) {
    const c = await createPrivateContract(sql)
    await sql`update students set display_name = ${nome} where id = ${c.studentId}`
    return c
  }

  it('cadastro com espaço DUPLO, digitação com espaço simples: confirma', async () => {
    const base = unico('Maria Clara c15')
    const c = await contratoChamado(base.replace(' ', '  '))
    const { error } = await admin.rpc('admin_end_contract', {
      p_contract: c.contractId,
      p_confirm_name: base,
    })
    expect(error, 'ninguém enxerga o espaço a mais — e ele recusava').toBeNull()
  })

  it('e o contrário também (os DOIS lados dobram), junto com tab e quebra de linha', async () => {
    const base = unico('Ana Paula c15')
    const c = await contratoChamado(base)
    const { error } = await admin.rpc('admin_end_contract', {
      p_contract: c.contractId,
      p_confirm_name: base.replace(' ', '\t \n'),
    })
    expect(error).toBeNull()
  })

  it('acento continua sendo LETRA (a régua não afrouxou)', async () => {
    const c = await contratoChamado('Mário Sérgio c15')
    const { error } = await admin.rpc('admin_end_contract', {
      p_contract: c.contractId,
      p_confirm_name: 'Mario Sergio c15',
    })
    expect(error!.message).toMatch(/confirmação não confere/)
  })

  it('o case-folding COMPLETO do Unicode fica declarado FORA DE ALCANCE', async () => {
    // Não é bug escondido: é limite escrito. `lower()` do Postgres é dobra
    // simples, então "ß" não vira "ss". A casa cadastra nomes pt-BR; o dia que
    // isso importar, o caminho é collation ICU, e não remendo na função.
    const [{ igual }] = await sql<{ igual: boolean }[]>`
      select public._confirmacao_bate('Straße', 'STRASSE') as igual`
    expect(igual).toBe(false)
    const [{ src }] = await sql<{ src: string }[]>`
      select obj_description(p.oid, 'pg_proc') as src from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = '_confirmacao_normal'`
    expect(src, 'e o comentário da função diz isso em voz alta').toMatch(/ICU/)
  })
})

/* ========================================================================== */
/* Sol 13 · o teto do plano conta CODE POINTS dos dois lados                   */
/* ========================================================================== */

describe('Sol 13 · 80 emojis cabem no banco e cabem no Zod', () => {
  const emojis = (n: number) => '🎓'.repeat(n)
  const base = {
    ramo: 'individual' as const,
    alunos: [crypto.randomUUID()],
    ancora: null,
    rotuloDoGrupo: '',
    professora: crypto.randomUUID(),
    valorCentavos: 15000,
    remarcacoes: 4,
    inicio: '2026-08-03',
    horarios: [],
  }

  it('o teste só vale se as duas contagens divergirem', () => {
    expect(emojis(TETO_DO_PLANO).length, 'UTF-16 conta 2 por emoji').toBe(TETO_DO_PLANO * 2)
    expect([...emojis(TETO_DO_PLANO)].length, 'code points contam 1').toBe(TETO_DO_PLANO)
  })

  it('o BANCO aceita 80 emojis (char_length conta caracteres)', async () => {
    const r = await admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [await createStudent(sql)],
      p_plan_name: emojis(TETO_DO_PLANO),
      p_hourly_rate_cents: 15000,
      p_teacher: await createTeacher(sql),
    })
    expect(r.error).toBeNull()
  })

  it('e o Zod aceita os mesmos 80 — a régua da tela não é mais apertada que a do banco', () => {
    const ok = NovoContratoSchema.safeParse({ ...base, plano: emojis(TETO_DO_PLANO) })
    expect(ok.success, 'era `.max(80)` em unidades UTF-16: recusava com 40 emojis').toBe(true)
  })

  it('81 continua não cabendo — nos dois lados, com a MESMA frase', async () => {
    const r = NovoContratoSchema.safeParse({ ...base, plano: emojis(TETO_DO_PLANO + 1) })
    expect(r.success).toBe(false)
    expect(r.error!.issues.map((i) => i.message)).toContain(
      `o nome do plano cabe em ${TETO_DO_PLANO} caracteres`,
    )
    const noBanco = await admin.rpc('admin_create_contract', {
      p_kind: 'individual',
      p_students: [await createStudent(sql)],
      p_plan_name: emojis(TETO_DO_PLANO + 1),
      p_hourly_rate_cents: 15000,
      p_teacher: await createTeacher(sql),
    })
    expect(noBanco.error!.message).toMatch(/contracts_plan_name_len/)
  })
})
