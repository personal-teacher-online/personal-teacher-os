// Issue #44 — webhook da Meta em /api/webhooks/meta (ADR-038, "Consequências ›
// No webhook" e "Decisões do dono", itens 3, 4 e 5). Rota + banco real.
//
// O que se prova, na ordem dos critérios da issue:
//   1. verificação GET: 200 com o challenge cru; 403 com token errado; 403
//      sem META_WEBHOOK_VERIFY_TOKEN no ambiente, mesmo com token vazio;
//   2. assinatura: sem META_APP_SECRET, 401 sem gravar; sem cabeçalho ou com
//      assinatura de outro segredo, 401 sem gravar;
//   3. recibos: delivered, read e failed aplicados pela RPC da #42; replay não
//      muda nada; a linha guarda o objeto do recibo + metadata, sem `entry` e
//      sem `contacts`; vários recibos num POST viram várias linhas;
//   4. recibo antecipado fica pendente e é aplicado pelo outbox_mark_sent; RPC
//      falhando deixa a linha com erro, o outbox intacto e responde 200;
//   5. mensagens de aluno: guardadas inteiras e processadas, sem tocar perfil;
//      duas numa chamada; replay; mídia só com ids; nada é enfileirado, nem
//      com palavra de parada (o aviso à admin é a #127);
//   6. account_update: guardado e processado, e é o sinal que o cartão de
//      Ajustes lê (origem meta, processado, sem erro);
//   7. inbox indisponível → 5xx.
//
// Régua da casa: arquivos rodam em PARALELO no mesmo banco. Todo wamid daqui
// leva o sufixo da rodada; toda linha de outbox nasce com `m3w:<rodada>:`.
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, serviceClient } from './helpers/auth'
import { connect } from './helpers/db'
import { handleMetaWebhook } from '@/lib/webhooks/meta'

vi.mock('server-only', () => ({}))

const RODADA = crypto.randomUUID().slice(0, 8)
const PREFIXO = `m3w:${RODADA}:`
const SEGREDO = `segredo-de-teste-${RODADA}`
const PHONE_NUMBER_ID = '100000000000001'

let sql: Sql
let servico: SupabaseClient
const wamids: string[] = []

beforeAll(async () => {
  sql = connect(2)
  servico = serviceClient()
})
afterEach(() => {
  vi.unstubAllEnvs()
})
afterAll(async () => {
  // só o que este arquivo criou
  for (const w of wamids) {
    await sql`delete from webhook_inbox where source = 'meta' and event_id like ${`${w}:%`}`
  }
  await sql`delete from notification_outbox where dedupe_key like ${`${PREFIXO}%`}`
  await sql.end()
})

/** wamid sintético desta rodada (a Meta usa base64; nunca ':'). */
function wamid(): string {
  const w = `wamid.TESTE${RODADA}${crypto.randomUUID().replace(/-/g, '')}`
  wamids.push(w)
  return w
}

/** Número fictício (+55 65 9000X-XXXX) único por chamada, só dígitos. */
function numero(): string {
  return `55659000${String(Math.floor(Math.random() * 100_000)).padStart(5, '0')}`
}

function fixture(nome: string, troca: Record<string, string> = {}): string {
  let cru = readFileSync(join(__dirname, 'fixtures', 'meta', nome), 'utf8')
  for (const [de, para] of Object.entries(troca)) cru = cru.split(de).join(para)
  return cru
}

function assinar(body: string, segredo = SEGREDO): string {
  return `sha256=${createHmac('sha256', segredo).update(body, 'utf8').digest('hex')}`
}

async function post(body: string, opts: { cliente?: SupabaseClient; assinatura?: string | null } = {}) {
  return handleMetaWebhook(() => opts.cliente ?? servico, {
    secret: SEGREDO,
    signature: opts.assinatura === undefined ? assinar(body) : opts.assinatura,
    body,
  })
}

interface LinhaDaInbox {
  event_id: string
  payload: Record<string, unknown>
  processed_at: Date | null
  error: string | null
}
async function inboxDe(w: string): Promise<LinhaDaInbox[]> {
  const rows = await sql`
    select event_id, payload, processed_at, error
      from webhook_inbox
     where source = 'meta' and event_id like ${`${w}:%`}
     order by id`
  return rows as unknown as LinhaDaInbox[]
}

let seq = 0
/** Uma linha de WhatsApp desta rodada, já enviada pela Meta com o wamid dado. */
async function enviadaComWamid(w: string): Promise<string> {
  const id = await pendente()
  const { error } = await servico.rpc('outbox_mark_sent', {
    p_outbox_id: id,
    p_provider: 'meta',
    p_provider_message_id: w,
  })
  expect(error, `outbox_mark_sent recusou: ${error?.message}`).toBeNull()
  return id
}
/** Uma linha de WhatsApp desta rodada, ainda sem envio. */
async function pendente(): Promise<string> {
  seq += 1
  const [r] = await sql`
    insert into notification_outbox (channel, template, payload, dedupe_key)
    values ('whatsapp', 'class-reminder', ${sql.json({ fixture: 'm3w', seq })}, ${`${PREFIXO}${seq}`})
    returning id`
  return r.id as string
}

interface Saida {
  sent_at: Date | null
  delivered_at: Date | null
  read_at: Date | null
  error: string | null
  situacao: string
}
async function saida(id: string): Promise<Saida> {
  const [r] = await sql`
    select sent_at, delivered_at, read_at, error, situacao from outbox_admin where id = ${id}`
  return r as unknown as Saida
}

/** Cliente que delega ao serviço, com a troca pedida. */
function clienteCom(troca: Partial<Record<'rpc' | 'from', unknown>>): SupabaseClient {
  return new Proxy(servico, {
    get(alvo, prop) {
      if (typeof prop === 'string' && prop in troca) return troca[prop as 'rpc' | 'from']
      const v = Reflect.get(alvo, prop)
      return typeof v === 'function' ? v.bind(alvo) : v
    },
  })
}

/* ========================================================================== */
describe('#44 · 1. verificação (GET) pela rota', () => {
  const pedido = (token: string) =>
    new NextRequest(
      `http://127.0.0.1:3000/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=abc`,
    )

  it('token certo: 200 com o challenge cru; token errado: 403', async () => {
    vi.stubEnv('META_WEBHOOK_VERIFY_TOKEN', 'token-certo')
    const { GET } = await import('@/app/api/webhooks/meta/route')
    const certo = await GET(pedido('token-certo'))
    expect(certo.status).toBe(200)
    expect(await certo.text()).toBe('abc')

    const errado = await GET(pedido('token-errado'))
    expect(errado.status).toBe(403)
    expect(await errado.text()).not.toContain('abc')
  })

  it('sem META_WEBHOOK_VERIFY_TOKEN no ambiente: 403, mesmo com hub.verify_token vazio', async () => {
    vi.stubEnv('META_WEBHOOK_VERIFY_TOKEN', '')
    const { GET } = await import('@/app/api/webhooks/meta/route')
    const vazio = await GET(pedido(''))
    expect(vazio.status).toBe(403)
    expect(await vazio.text()).not.toContain('abc')
  })
})

/* ========================================================================== */
describe('#44 · 2. assinatura (POST)', () => {
  it('sem META_APP_SECRET no ambiente: 401 pela rota, e nada é gravado', async () => {
    vi.stubEnv('META_APP_SECRET', '')
    const { POST } = await import('@/app/api/webhooks/meta/route')
    const w = wamid()
    const body = fixture('status-delivered.json', { '<wamid>': w, '<recipient_id>': numero() })
    const r = await POST(
      new NextRequest('http://127.0.0.1:3000/api/webhooks/meta', {
        method: 'POST',
        body,
        // assinado com o segredo vazio: nem isso passa
        headers: { 'x-hub-signature-256': assinar(body, '') },
      }),
    )
    expect(r.status).toBe(401)
    expect(await inboxDe(w)).toHaveLength(0)
  })

  it('pela rota, com o segredo no ambiente, o POST assinado entra (o corpo cru é o assinado)', async () => {
    vi.stubEnv('META_APP_SECRET', SEGREDO)
    const { POST } = await import('@/app/api/webhooks/meta/route')
    const w = wamid()
    const body = fixture('status-delivered.json', { '<wamid>': w, '<recipient_id>': numero() })
    const r = await POST(
      new NextRequest('http://127.0.0.1:3000/api/webhooks/meta', {
        method: 'POST',
        body,
        headers: { 'x-hub-signature-256': assinar(body) },
      }),
    )
    expect(r.status).toBe(200)
    expect(await inboxDe(w)).toHaveLength(1)
  })

  it('sem X-Hub-Signature-256: 401 e nenhuma linha nova', async () => {
    const w = wamid()
    const body = fixture('status-delivered.json', { '<wamid>': w, '<recipient_id>': numero() })
    const r = await post(body, { assinatura: null })
    expect(r.status).toBe(401)
    expect(await inboxDe(w)).toHaveLength(0)
  })

  it('assinatura de outro segredo: 401 e nenhuma linha nova', async () => {
    const w = wamid()
    const body = fixture('status-delivered.json', { '<wamid>': w, '<recipient_id>': numero() })
    const r = await post(body, { assinatura: assinar(body, 'outro-segredo') })
    expect(r.status).toBe(401)
    expect(await inboxDe(w)).toHaveLength(0)
  })

  it('assinatura certa de OUTRO corpo: 401 (o corpo foi trocado no caminho)', async () => {
    const w = wamid()
    const body = fixture('status-delivered.json', { '<wamid>': w, '<recipient_id>': numero() })
    const r = await post(body.replace('delivered', 'read'), { assinatura: assinar(body) })
    expect(r.status).toBe(401)
    expect(await inboxDe(w)).toHaveLength(0)
  })
})

/* ========================================================================== */
describe('#44 · 3. recibos', () => {
  it('delivered: outbox com delivered_at, inbox processada com o recibo + metadata (sem entry, sem contacts); replay não muda nada', async () => {
    const w = wamid()
    const id = await enviadaComWamid(w)
    const destinatario = numero()
    const body = fixture('status-delivered.json', { '<wamid>': w, '<recipient_id>': destinatario })

    const r = await post(body)
    expect(r.status).toBe(200)
    const depois = await saida(id)
    expect(depois.delivered_at).not.toBeNull()
    expect(depois.read_at).toBeNull()
    expect(depois.situacao).toBe('entregue')

    const [linha, ...resto] = await inboxDe(w)
    expect(resto).toHaveLength(0)
    expect(linha.event_id).toBe(`${w}:delivered`)
    expect(linha.processed_at).not.toBeNull()
    expect(linha.error).toBeNull()
    const p = linha.payload as { status: Record<string, unknown>; metadata: Record<string, unknown> }
    expect(p.status).toMatchObject({ id: w, status: 'delivered', recipient_id: destinatario, timestamp: '1761990000' })
    expect(p.metadata.phone_number_id).toBe(PHONE_NUMBER_ID)
    const cru = JSON.stringify(linha.payload)
    expect(cru).not.toContain('"entry"')
    expect(cru).not.toContain('"contacts"')
    expect(cru).not.toContain('whatsapp_business_account')

    // replay: 200, e nada muda (nem a linha, nem o horário de entrega)
    const replay = await post(body)
    expect(replay.status).toBe(200)
    expect(await saida(id)).toEqual(depois)
    expect(await inboxDe(w)).toEqual([linha])
  })

  it('read para linha sem delivered_at: preenche os dois', async () => {
    const w = wamid()
    const id = await enviadaComWamid(w)
    const r = await post(fixture('status-read.json', { '<wamid>': w, '<recipient_id>': numero() }))
    expect(r.status).toBe(200)
    const s = await saida(id)
    expect(s.delivered_at).not.toBeNull()
    expect(s.read_at).not.toBeNull()
    const [linha] = await inboxDe(w)
    expect(linha.event_id).toBe(`${w}:read`)
    expect(linha.processed_at).not.toBeNull()
  })

  it('failed com errors[]: a linha fica presa com o title do erro no motivo', async () => {
    const w = wamid()
    const id = await enviadaComWamid(w)
    const r = await post(fixture('status-failed.json', { '<wamid>': w, '<recipient_id>': numero() }))
    expect(r.status).toBe(200)
    const s = await saida(id)
    expect(s.delivered_at).toBeNull()
    expect(s.sent_at).not.toBeNull()
    expect(s.error).toContain('Message undeliverable')
    expect(s.error).toContain('131026')
    expect(s.situacao).toBe('preso')
    const [linha] = await inboxDe(w)
    expect(linha.event_id).toBe(`${w}:failed`)
    expect(linha.processed_at).not.toBeNull()
  })

  it('vários recibos num POST viram várias linhas, e todos se aplicam', async () => {
    const w1 = wamid()
    const w2 = wamid()
    const id1 = await enviadaComWamid(w1)
    const id2 = await enviadaComWamid(w2)
    const env = JSON.parse(fixture('status-delivered.json', { '<recipient_id>': numero() }))
    const recibo = env.entry[0].changes[0].value.statuses[0]
    env.entry[0].changes[0].value.statuses = [
      { ...recibo, id: w1, status: 'delivered' },
      { ...recibo, id: w2, status: 'delivered' },
      { ...recibo, id: w2, status: 'read' },
    ]
    const r = await post(JSON.stringify(env))
    expect(r.status).toBe(200)
    expect((await inboxDe(w1)).map((l) => l.event_id)).toEqual([`${w1}:delivered`])
    expect((await inboxDe(w2)).map((l) => l.event_id)).toEqual([`${w2}:delivered`, `${w2}:read`])
    expect((await saida(id1)).delivered_at).not.toBeNull()
    expect((await saida(id2)).read_at).not.toBeNull()
  })
})

/* ========================================================================== */
describe('#44 · 4. recibo antecipado e RPC falhando', () => {
  it('wamid que ainda não está no outbox: 200 e pendente; outbox_mark_sent aplica e fecha a linha da inbox', async () => {
    const w = wamid()
    const r = await post(fixture('status-delivered.json', { '<wamid>': w, '<recipient_id>': numero() }))
    expect(r.status).toBe(200)
    const [antes] = await inboxDe(w)
    expect(antes.processed_at).toBeNull()
    expect(antes.error).toBeNull()

    const id = await enviadaComWamid(w)
    expect((await saida(id)).delivered_at).not.toBeNull()
    const [depois] = await inboxDe(w)
    expect(depois.processed_at).not.toBeNull()
  })

  it('RPC falhando: 200, a linha da inbox fica pendente COM o erro, e o outbox não muda', async () => {
    const w = wamid()
    const id = await enviadaComWamid(w)
    const antes = await saida(id)
    const quebrado = clienteCom({ rpc: async () => ({ data: null, error: { message: 'banco fora do ar' } }) })
    const r = await post(fixture('status-delivered.json', { '<wamid>': w, '<recipient_id>': numero() }), {
      cliente: quebrado,
    })
    expect(r.status).toBe(200)
    expect(await saida(id)).toEqual(antes)
    const [linha] = await inboxDe(w)
    expect(linha.processed_at).toBeNull()
    expect(linha.error).toContain('banco fora do ar')

    // a reentrega da Meta, com o banco de volta, aplica e limpa o erro
    const de_novo = await post(fixture('status-delivered.json', { '<wamid>': w, '<recipient_id>': numero() }))
    expect(de_novo.status).toBe(200)
    expect((await saida(id)).delivered_at).not.toBeNull()
    const [fechada] = await inboxDe(w)
    expect(fechada.processed_at).not.toBeNull()
    expect(fechada.error).toBeNull()
  })
})

/* ========================================================================== */
describe('#44 · 5. mensagens de aluno ao número de envio', () => {
  /** Linhas de outbox que citam a mensagem ou o número (nenhuma deve existir). */
  async function outboxQueCita(w: string, de: string): Promise<number> {
    const [{ n }] = await sql`
      select count(*)::int as n from notification_outbox
       where dedupe_key like ${`%${w}%`} or payload::text like ${`%${w}%`} or payload::text like ${`%${de}%`}`
    return n as number
  }

  it('texto: 200 e uma linha <wamid>:message processada, com a mensagem inteira + metadata (sem entry, sem contacts); replay não muda nada; nenhum aviso', async () => {
    const w = wamid()
    const de = numero()
    const body = fixture('message-text.json', { '<wamid>': w, '<from>': de })
    const r = await post(body)
    expect(r.status).toBe(200)

    const linhas = await inboxDe(w)
    expect(linhas).toHaveLength(1)
    const [linha] = linhas
    expect(linha.event_id).toBe(`${w}:message`)
    expect(linha.processed_at).not.toBeNull()
    expect(linha.error).toBeNull()
    const p = linha.payload as { message: Record<string, unknown>; metadata: Record<string, unknown> }
    expect(p.message).toMatchObject({
      id: w,
      from: de,
      timestamp: '1761990180',
      type: 'text',
      text: { body: 'Oi! Posso trocar a aula de quinta?' },
    })
    expect(p.metadata.phone_number_id).toBe(PHONE_NUMBER_ID)
    const cru = JSON.stringify(linha.payload)
    expect(cru).not.toContain('"entry"')
    expect(cru).not.toContain('"contacts"')
    expect(cru, 'o nome do perfil do contato não entra').not.toContain('Aluna Inventada')

    expect(await outboxQueCita(w, de), 'mensagem de aluno não enfileira nada').toBe(0)

    const replay = await post(body)
    expect(replay.status).toBe(200)
    expect(await inboxDe(w)).toEqual(linhas)
  })

  it('duas mensagens numa chamada viram duas linhas', async () => {
    const w1 = wamid()
    const w2 = wamid()
    const env = JSON.parse(fixture('message-text.json', { '<from>': numero() }))
    const m = env.entry[0].changes[0].value.messages[0]
    env.entry[0].changes[0].value.messages = [
      { ...m, id: w1 },
      { ...m, id: w2, text: { body: 'E a de sexta também.' } },
    ]
    const r = await post(JSON.stringify(env))
    expect(r.status).toBe(200)
    const [l1] = await inboxDe(w1)
    const [l2] = await inboxDe(w2)
    expect(l1.event_id).toBe(`${w1}:message`)
    expect(l2.event_id).toBe(`${w2}:message`)
    expect(l1.processed_at).not.toBeNull()
    expect(l2.processed_at).not.toBeNull()
  })

  it('mídia: guarda o objeto como veio (ids), sem baixar nada', async () => {
    const w = wamid()
    const r = await post(fixture('message-audio.json', { '<wamid>': w, '<from>': numero() }))
    expect(r.status).toBe(200)
    const [linha] = await inboxDe(w)
    expect(linha.processed_at).not.toBeNull()
    expect((linha.payload as { message: Record<string, unknown> }).message).toMatchObject({
      type: 'audio',
      audio: { id: '300000000000001', mime_type: 'audio/ogg; codecs=opus' },
    })
  })

  it('PARAR (message-stop.json): só a linha da inbox, processada; nenhuma linha em notification_outbox, e o perfil não muda', async () => {
    // o aviso à admin pela palavra de parada é a #127 (decisão do dono, 01/11/2026)
    const de = numero()
    const perfil = await createAuthUser(sql, 'student', 'Aluno que mandou PARAR', { whatsapp: `+${de}` })
    const [perfilAntes] = await sql`select * from profiles where id = ${perfil}`

    const w = wamid()
    const body = fixture('message-stop.json', { '<wamid>': w, '<from>': de })
    const r = await post(body)
    expect(r.status).toBe(200)

    const linhas = await inboxDe(w)
    expect(linhas).toHaveLength(1)
    expect(linhas[0].event_id).toBe(`${w}:message`)
    expect(linhas[0].processed_at).not.toBeNull()
    expect(linhas[0].error).toBeNull()
    expect((linhas[0].payload as { message: Record<string, unknown> }).message).toMatchObject({
      text: { body: 'PARAR' },
      from: de,
    })

    expect(await outboxQueCita(w, de), 'a mensagem de parada enfileirou aviso').toBe(0)
    expect((await sql`select * from profiles where id = ${perfil}`)[0]).toEqual(perfilAntes)

    const replay = await post(body)
    expect(replay.status).toBe(200)
    expect(await inboxDe(w)).toEqual(linhas)
  })
})

/* ========================================================================== */
describe('#44 · 6. account_update', () => {
  it('200 e uma linha meta processada, sem erro: é o sinal que o cartão de Ajustes lê; replay não duplica', async () => {
    // número da conta único por rodada: a linha é achada por ele
    const daConta = numero()
    const body = fixture('account-update.json', {
      '"<time>"': String(Math.floor(Date.now() / 1000)),
      '<phone_number>': daConta,
    })
    const r = await post(body)
    expect(r.status).toBe(200)

    const linhas = await sql`
      select event_id, payload, processed_at, error
        from webhook_inbox
       where source = 'meta' and payload -> 'value' ->> 'phone_number' = ${daConta}`
    expect(linhas, 'account_update não gravado (ou gravado mais de uma vez)').toHaveLength(1)
    const [linha] = linhas
    expect(linha.payload).toEqual({
      field: 'account_update',
      value: { phone_number: daConta, event: 'DISPLAY_NAME_REJECTED' },
    })
    expect(linha.event_id).toMatch(/^account_update:[0-9a-f]{64}$/)
    // o filtro exato do sinalDe('meta') de src/data/admin/ajustes.ts
    expect(linha.processed_at).not.toBeNull()
    expect(linha.error).toBeNull()

    const replay = await post(body)
    expect(replay.status).toBe(200)
    const [{ n }] = await sql`
      select count(*)::int as n from webhook_inbox where source = 'meta' and event_id = ${linha.event_id}`
    expect(n).toBe(1)
    await sql`delete from webhook_inbox where source = 'meta' and event_id = ${linha.event_id}`
  })
})

/* ========================================================================== */
describe('#44 · 7. inbox indisponível', () => {
  it('a gravação na inbox falha: 5xx (a Meta reenvia), e nenhum efeito acontece', async () => {
    const w = wamid()
    const id = await enviadaComWamid(w)
    const antes = await saida(id)
    let chamouRpc = false
    const semInbox = clienteCom({
      from: (tabela: string) =>
        tabela === 'webhook_inbox'
          ? { upsert: async () => ({ error: { message: 'inbox fora do ar' } }) }
          : servico.from(tabela),
      rpc: async () => {
        chamouRpc = true
        return { data: null, error: null }
      },
    })
    const r = await post(fixture('status-delivered.json', { '<wamid>': w, '<recipient_id>': numero() }), {
      cliente: semInbox,
    })
    expect(r.status).toBeGreaterThanOrEqual(500)
    expect(chamouRpc, 'o efeito rodou sem a linha na inbox').toBe(false)
    expect(await saida(id)).toEqual(antes)
    expect(r.body.detail ?? '').not.toContain('inbox fora do ar')
  })
})
