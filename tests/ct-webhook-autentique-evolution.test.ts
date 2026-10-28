// Construção total — webhooks Autentique (HMAC do corpo CRU + transição na RPC
// apply_autentique_event, monotônica) e Evolution (storage-only, token próprio).
// Molde de webhook-asaas.test.ts: client service injetado, 401 fail-closed sem
// gravar nada, inbox first-write-wins.
import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { handleAutentiqueWebhook } from '../src/lib/webhooks/autentique'
import { handleEvolutionWebhook } from '../src/lib/webhooks/evolution'
import { serviceClient } from './helpers/auth'
import { connect, createPrivateContract } from './helpers/db'

const SECRET = 'autentique-secret-ct'
const EVO_TOKEN = 'evo-token-ct'
let sql: Sql
const service = serviceClient()

beforeAll(() => {
  sql = connect(3)
})
afterAll(async () => {
  await sql.end()
})

// ---------------------------------------------------------------------------
// Autentique
// ---------------------------------------------------------------------------

function hmacHex(rawBody: string, secret = SECRET) {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

function autentiqueEvt(type: string, documentId: string) {
  return {
    id: 'wbk_' + crypto.randomUUID().slice(0, 12),
    object: 'webhook',
    event: {
      id: 'aut_' + crypto.randomUUID().slice(0, 12),
      type,
      data: { object: { id: 'sig_' + crypto.randomUUID().slice(0, 8), document: { id: documentId } } },
    },
  }
}

async function callAutentique(evt: unknown, opts: { signature?: string; secret?: string } = {}) {
  const rawBody = JSON.stringify(evt)
  return handleAutentiqueWebhook(service, {
    rawBody,
    signature: opts.signature ?? hmacHex(rawBody, opts.secret ?? SECRET),
    secret: SECRET,
  })
}

/** Contrato + espelho em contract_signatures (INSERT direto: escrita nessa
 *  tabela é admin/UI + RPC — o fixture entra como owner, igual aos demais).
 *  c15 · Sol 8: `sent_at` perdeu o default, e um espelho de documento ENVIADO
 *  precisa dele (o CHECK `contract_signatures_sent_shape` amarra carimbo de
 *  envio e id de documento). */
async function createSignatureFixture(): Promise<{ contractId: string; docId: string }> {
  const c = await createPrivateContract(sql)
  const docId = 'doc' + crypto.randomUUID().replace(/-/g, '')
  await sql`
    insert into contract_signatures (contract_id, provider_document_id, sent_at)
    values (${c.contractId}, ${docId}, now())`
  return { contractId: c.contractId, docId }
}

describe('autentique — caso a: assinatura HMAC fail-closed', () => {
  it('assinatura errada/ausente/secret não configurado → 401 e inbox VAZIA', async () => {
    const f = await createSignatureFixture()
    const evt = autentiqueEvt('signature.accepted', f.docId)
    const rawBody = JSON.stringify(evt)

    // assinada com OUTRO secret
    const wrongSecret = await callAutentique(evt, { secret: 'outro-secret' })
    expect(wrongSecret.status).toBe(401)
    // header ausente / lixo não-hex
    for (const bad of [null, 'zzzz-nao-hex', hmacHex(rawBody).slice(0, 32)]) {
      const r = await handleAutentiqueWebhook(service, {
        rawBody,
        signature: bad,
        secret: SECRET,
      })
      expect(r.status).toBe(401)
    }
    // secret não configurado → rota inoperante (fail-closed)
    const noSecret = await handleAutentiqueWebhook(service, {
      rawBody,
      signature: hmacHex(rawBody),
      secret: undefined,
    })
    expect(noSecret.status).toBe(401)

    const [{ count }] = await sql`
      select count(*)::int as count from webhook_inbox
      where source = 'autentique' and event_id = ${evt.event.id}`
    expect(count).toBe(0)
    const [sig] = await sql`
      select status, signed_at from contract_signatures where provider_document_id = ${f.docId}`
    expect(sig.status).toBe('sent') // nada mudou
    expect(sig.signed_at).toBeNull()
  })
})

describe('autentique — casos b/c: transição monotônica via RPC', () => {
  it('caso b: document.finished válido → 200, status=signed, signed_at preenchido', async () => {
    // c16 · r6 nº 3: o evento que ENCERRA é o do documento. O `signature.accepted`
    // deste caso era de UM signatário e não podia encerrar coisa nenhuma — a
    // prova do casal está em `c16-correcoes-sol-6.test.ts`.
    const f = await createSignatureFixture()
    const evt = autentiqueEvt('document.finished', f.docId)

    const r = await callAutentique(evt)
    expect(r.status).toBe(200)

    const [sig] = await sql`
      select status, signed_at from contract_signatures where provider_document_id = ${f.docId}`
    expect(sig.status).toBe('signed')
    expect(sig.signed_at).not.toBeNull()

    const [inbox] = await sql`
      select processed_at, error from webhook_inbox
      where source = 'autentique' and event_id = ${evt.event.id}`
    expect(inbox.processed_at).not.toBeNull()
    expect(inbox.error).toBeNull()
  })

  it('caso c: signature.viewed DEPOIS de signed → 200 e status CONTINUA signed (não regride)', async () => {
    const f = await createSignatureFixture()
    expect((await callAutentique(autentiqueEvt('document.finished', f.docId))).status).toBe(200)

    // Evento atrasado/out-of-order (id NOVO, mesmo documento).
    const viewed = autentiqueEvt('signature.viewed', f.docId)
    const r = await callAutentique(viewed)
    expect(r.status).toBe(200)

    const [sig] = await sql`
      select status, signed_at from contract_signatures where provider_document_id = ${f.docId}`
    expect(sig.status).toBe('signed')
    expect(sig.signed_at).not.toBeNull()

    const [inbox] = await sql`
      select processed_at from webhook_inbox
      where source = 'autentique' and event_id = ${viewed.event.id}`
    expect(inbox.processed_at).not.toBeNull() // evento consumido, sem efeito
  })
})

describe('autentique — casos d/e: rastro na inbox (nunca 500)', () => {
  it('caso d: documento sem espelho local → 200, erro na inbox e o evento NÃO é dado por processado', async () => {
    const evt = autentiqueEvt('document.finished', 'doc' + crypto.randomUUID().replace(/-/g, ''))
    const r = await callAutentique(evt)
    expect(r.status).toBe(200)

    const [row] = await sql`
      select error, processed_at from webhook_inbox
      where source = 'autentique' and event_id = ${evt.event.id}`
    expect(row.error).toContain('ainda sem registro')
    /*
     * c15 · Sol 4 — ESTE `toBeNull` É A CORREÇÃO.
     *
     * Até o c14 a linha nascia com `processed_at` preenchido: o evento constava
     * como consumido sem ter feito nada. Quando o documento é o de uma reserva
     * que ainda não recebeu o id (a janela entre criar no Autentique e anexar
     * aqui), esse evento é o único aviso que o provedor manda — e ele ia para o
     * lixo. Agora fica PRESO, e quem o resgata é o anexo do documento
     * (`admin_finish_signature` → `_reaplicar_eventos_autentique`), provado em
     * `c15-correcoes-sol-5.test.ts`.
     */
    expect(row.processed_at).toBeNull()
  })

  it('caso e: evento de tipo desconhecido → 200 "ignorado"', async () => {
    const f = await createSignatureFixture()
    const evt = autentiqueEvt('document.updated', f.docId) // tipo fora da matriz
    const r = await callAutentique(evt)
    expect(r.status).toBe(200)
    expect(r.body.detail).toContain('ignorado')

    const [row] = await sql`
      select error from webhook_inbox
      where source = 'autentique' and event_id = ${evt.event.id}`
    expect(row.error).toContain('ignorado')
    const [sig] = await sql`
      select status from contract_signatures where provider_document_id = ${f.docId}`
    expect(sig.status).toBe('sent') // nenhuma transição
  })
})

// ---------------------------------------------------------------------------
// Evolution (storage-only)
// ---------------------------------------------------------------------------

function evolutionEvt(keyId: string) {
  return {
    event: 'messages.upsert',
    instance: 'agenda-dona',
    data: {
      key: { id: keyId, remoteJid: '556599999999@s.whatsapp.net', fromMe: false },
      message: { conversation: 'olá' },
    },
  }
}

async function callEvolution(payload: unknown, token: string | null = EVO_TOKEN) {
  return handleEvolutionWebhook(service, { token, expectedToken: EVO_TOKEN, payload })
}

describe('evolution — caso a: token fail-closed', () => {
  it('token errado/ausente/não configurado → 401 e inbox VAZIA', async () => {
    const keyId = 'KEY' + crypto.randomUUID().slice(0, 8).toUpperCase()
    const e = evolutionEvt(keyId)
    for (const bad of [null, 'errado']) {
      expect((await callEvolution(e, bad)).status).toBe(401)
    }
    const r = await handleEvolutionWebhook(service, {
      token: EVO_TOKEN,
      expectedToken: undefined,
      payload: e,
    })
    expect(r.status).toBe(401)

    const [{ count }] = await sql`
      select count(*)::int as count from webhook_inbox
      where source = 'evolution' and event_id = ${'messages.upsert:' + keyId}`
    expect(count).toBe(0)
  })
})

describe('evolution — casos b/c: armazenamento idempotente', () => {
  it('caso b: válido com data.key.id → 200 "armazenado", linha nasce PROCESSADA', async () => {
    const keyId = 'KEY' + crypto.randomUUID().slice(0, 8).toUpperCase()
    const r = await callEvolution(evolutionEvt(keyId))
    expect(r.status).toBe(200)
    expect(r.body.detail).toBe('armazenado')

    const [row] = await sql`
      select payload, processed_at, error from webhook_inbox
      where source = 'evolution' and event_id = ${'messages.upsert:' + keyId}`
    expect(row.payload.data.key.id).toBe(keyId)
    // Storage-only: nasce processada (NULL sinalizaria "evento preso" falso).
    expect(row.processed_at).not.toBeNull()
    expect(row.error).toBeNull()
  })

  it('caso c: replay do mesmo data.key.id → 200 "replay ignorado", 1 linha só', async () => {
    const keyId = 'KEY' + crypto.randomUUID().slice(0, 8).toUpperCase()
    const e = evolutionEvt(keyId)
    expect((await callEvolution(e)).status).toBe(200)

    const replay = await callEvolution(e)
    expect(replay.status).toBe(200)
    expect(replay.body.detail).toBe('replay ignorado')

    const [{ count }] = await sql`
      select count(*)::int as count from webhook_inbox
      where source = 'evolution' and event_id = ${'messages.upsert:' + keyId}`
    expect(count).toBe(1)
  })
})
