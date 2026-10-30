// Onda Agenda e Mensagens · M3-1, issue #42 — ENTREGA E REENVIO revisada para
// a Cloud API da Meta (migration 20261030000100). Banco real, fixtures
// próprias (re-executável sem reset).
//
// O que se prova, na ordem dos critérios da issue:
//   1. o recibo é idempotente e monotônico (quatro ordens), com horário do banco;
//   2. o recibo que chega ANTES do id é aplicado por outbox_mark_sent na mesma
//      transação (e nada muda quando a transação não fecha); o job do cron é a
//      rede para o recibo gravado depois;
//   3. a reserva do despacho: duas conexões ao mesmo tempo recebem conjuntos
//      disjuntos, a linha reservada não volta em menos de 10 min, e fechar ou
//      falhar solta a reserva;
//   4. aviso interno à admin (digest e revisão) sai só por e-mail;
//   5. o revoke nominal de cada função nova está no TEXTO da migration;
//   6. `failed` depois do envio deixa a linha presa e reenviável, com audit;
//   7. reenviar linha aguardando envio recusa com erro nomeado;
//   8. a view devolve a situação da tela de hoje, mais "entregue";
//   9. a confirmação de remarcação diz quem moveu;
//  10. o expurgo LGPD cobre a origem `meta` (por idade e por telefone);
//  11. anon e logado sem papel de admin não executam as funções novas (42501).
//
// Régua da casa: arquivos rodam em PARALELO no mesmo banco. Toda linha de
// outbox daqui nasce com a chave `m3e:<rodada>:…` e toda consulta filtra por
// ela; a reserva é recortada pelo mesmo prefixo (`p_key_like`).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql, TransactionSql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { anonClient, clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createInstance, createPrivateContract, createStudent } from './helpers/db'
import { situacaoDaLinha } from '@/data/admin/mensagens-gramatica'

const MIGRATION = '20261030000100_m3_entrega_e_reenvio.sql'
const RODADA = crypto.randomUUID().slice(0, 8)
const PREFIXO = `m3e:${RODADA}:`

let sql: Sql
let servico: SupabaseClient
let adminId: string
let comoAdmin: SupabaseClient

beforeAll(async () => {
  sql = connect(3)
  servico = serviceClient()
  adminId = await createAuthUser(sql, 'admin', 'Admin M3-1')
  comoAdmin = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  await sql.end()
})

let seq = 0
/** Uma linha de outbox desta rodada, direto no banco (como o enqueue faria). */
async function linha(
  over: { sent_at?: 'agora' | null; error?: string | null; channel?: string; recipient?: string | null } = {},
): Promise<{ id: string; dedupe_key: string }> {
  seq += 1
  const chave = `${PREFIXO}${seq}`
  const [r] = await sql`
    insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key, sent_at, error)
    values (${over.channel ?? 'whatsapp'}, 'class-reminder', ${over.recipient ?? null},
            ${sql.json({ fixture: 'm3e', seq })}, ${chave},
            ${over.sent_at === 'agora' ? sql`now()` : null}, ${over.error ?? null})
    returning id, dedupe_key`
  return { id: r.id as string, dedupe_key: r.dedupe_key as string }
}

/** wamid sintético (a Meta usa base64; sem ':' — a chave da inbox é `<wamid>:<status>`). */
function wamid(): string {
  return `wamid.TESTE${crypto.randomUUID().replace(/-/g, '')}`
}

async function marcarEnviada(id: string, id_do_provedor: string): Promise<number> {
  const { data, error } = await servico.rpc('outbox_mark_sent', {
    p_outbox_id: id,
    p_provider: 'meta',
    p_provider_message_id: id_do_provedor,
  })
  expect(error, `outbox_mark_sent recusou: ${error?.message}`).toBeNull()
  return Number(data)
}

async function recibo(id_do_provedor: string, status: string, motivo?: string): Promise<string> {
  const { data, error } = await servico.rpc('apply_delivery_receipt', {
    p_provider: 'meta',
    p_provider_message_id: id_do_provedor,
    p_status: status,
    p_error: motivo ?? null,
  })
  expect(error, `apply_delivery_receipt recusou: ${error?.message}`).toBeNull()
  return String(data)
}

interface Estado {
  sent_at: Date | null
  error: string | null
  provider: string | null
  provider_message_id: string | null
  delivered_at: Date | null
  read_at: Date | null
  claimed_at: Date | null
  resent_as: string | null
  situacao: string
}
async function estado(id: string): Promise<Estado> {
  const [r] = await sql`
    select sent_at, error, provider, provider_message_id, delivered_at, read_at, claimed_at, resent_as, situacao
      from outbox_admin where id = ${id}`
  return r as unknown as Estado
}

async function agoraDoBanco(): Promise<number> {
  const [r] = await sql`select now() as t`
  return new Date(r.t as string).getTime()
}

/** Recibo da Meta gravado na inbox como a #44 grava (ADR-038, decisão 5). */
async function naInbox(
  id_do_provedor: string,
  status: string,
  extra: { recipient_id?: string; erros?: Array<{ code: number; title: string }>; recebidoHaDias?: number } = {},
): Promise<number> {
  const payload = {
    status: {
      id: id_do_provedor,
      status,
      timestamp: '1700000000',
      recipient_id: extra.recipient_id ?? '5565900000001',
      ...(extra.erros ? { errors: extra.erros } : {}),
    },
    metadata: { phone_number_id: '100000000000001' },
  }
  const [r] = await sql`
    insert into webhook_inbox (source, event_id, payload, received_at)
    values ('meta', ${`${id_do_provedor}:${status}`}, ${sql.json(payload)},
            now() - make_interval(days => ${extra.recebidoHaDias ?? 0}))
    returning id`
  return Number(r.id)
}

/** A transação passa a falar como o servidor (PostgREST com a chave service_role). */
async function comoServidor(tx: TransactionSql): Promise<void> {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'service_role' })}, true)`
  await tx`set local role service_role`
}

// ---------------------------------------------------------------------------
describe('M3-1 · 1. recibo idempotente e monotônico', () => {
  it('o mesmo recibo duas vezes deixa delivered_at igual — e o horário é o do banco', async () => {
    const l = await linha()
    const w = wamid()
    await marcarEnviada(l.id, w)
    const antes = await agoraDoBanco()
    expect(await recibo(w, 'delivered')).toBe('aplicado')
    const depois = await agoraDoBanco()
    const e1 = await estado(l.id)
    expect(e1.delivered_at).not.toBeNull()
    expect(e1.delivered_at!.getTime()).toBeGreaterThanOrEqual(antes)
    expect(e1.delivered_at!.getTime()).toBeLessThanOrEqual(depois)
    expect(e1.read_at).toBeNull()

    expect(await recibo(w, 'delivered')).toBe('aplicado')
    const e2 = await estado(l.id)
    expect(e2.delivered_at!.getTime()).toBe(e1.delivered_at!.getTime())
    expect(e2.situacao).toBe('entregue')
  })

  it('read depois de delivered preenche read_at sem apagar delivered_at', async () => {
    const l = await linha()
    const w = wamid()
    await marcarEnviada(l.id, w)
    await recibo(w, 'delivered')
    const e1 = await estado(l.id)
    await recibo(w, 'read')
    const e2 = await estado(l.id)
    expect(e2.read_at).not.toBeNull()
    expect(e2.delivered_at!.getTime()).toBe(e1.delivered_at!.getTime())
  })

  it('delivered depois de read não apaga nada', async () => {
    const l = await linha()
    const w = wamid()
    await marcarEnviada(l.id, w)
    await recibo(w, 'read')
    const e1 = await estado(l.id)
    await recibo(w, 'delivered')
    const e2 = await estado(l.id)
    expect(e2.read_at!.getTime()).toBe(e1.read_at!.getTime())
    expect(e2.delivered_at!.getTime()).toBe(e1.delivered_at!.getTime())
  })

  it('read sem delivered antes preenche os dois; sent não mexe em nada', async () => {
    const l = await linha()
    const w = wamid()
    await marcarEnviada(l.id, w)
    expect(await recibo(w, 'sent')).toBe('ignorado')
    expect((await estado(l.id)).delivered_at).toBeNull()
    await recibo(w, 'read')
    const e = await estado(l.id)
    expect(e.read_at).not.toBeNull()
    expect(e.delivered_at).not.toBeNull()
    expect(e.situacao).toBe('entregue')
  })

  it('recibo de id que não está no outbox devolve sem_linha; status fora do vocabulário recusa', async () => {
    expect(await recibo(wamid(), 'delivered')).toBe('sem_linha')
    const { error } = await servico.rpc('apply_delivery_receipt', {
      p_provider: 'meta',
      p_provider_message_id: wamid(),
      p_status: 'DELIVERY_ACK',
    })
    expect(error?.message).toMatch(/status de recibo desconhecido/)
  })
})

// ---------------------------------------------------------------------------
describe('M3-1 · 2. recibo antecipado', () => {
  it('recibo na inbox ANTES do id: outbox_mark_sent grava o envio e aplica o recibo, marcando-o processado', async () => {
    const l = await linha()
    const w = wamid()
    const inbox = await naInbox(w, 'delivered')

    expect(await marcarEnviada(l.id, w)).toBe(1)

    const e = await estado(l.id)
    expect(e.sent_at).not.toBeNull()
    expect(e.provider).toBe('meta')
    expect(e.provider_message_id).toBe(w)
    expect(e.delivered_at).not.toBeNull()
    const [i] = await sql`select processed_at, error from webhook_inbox where id = ${inbox}`
    expect(i.processed_at).not.toBeNull()
    expect(i.error).toBeNull()
  })

  it('os dois mudam na MESMA transação: se ela não fecha, nem a linha nem a inbox mudam', async () => {
    const l = await linha()
    const w = wamid()
    const inbox = await naInbox(w, 'read')
    const conexao = connect(1)
    try {
      await expect(
        conexao.begin(async (tx) => {
          await comoServidor(tx)
          await tx`select public.outbox_mark_sent(${l.id}::uuid, 'meta', ${w})`
          // dentro da transação os dois já mudaram…
          const [o] = await tx`select sent_at, read_at from notification_outbox where id = ${l.id}`
          const [i] = await tx`select processed_at from webhook_inbox where id = ${inbox}`
          expect(o.sent_at).not.toBeNull()
          expect(o.read_at).not.toBeNull()
          expect(i.processed_at).not.toBeNull()
          // …e a transação morre depois
          throw new Error('falha provocada depois do fechamento')
        }),
      ).rejects.toThrow(/falha provocada/)
    } finally {
      await conexao.end()
    }
    const e = await estado(l.id)
    expect(e.sent_at).toBeNull()
    expect(e.provider_message_id).toBeNull()
    expect(e.delivered_at).toBeNull()
    const [i] = await sql`select processed_at from webhook_inbox where id = ${inbox}`
    expect(i.processed_at).toBeNull()
  })

  it('RPC que falha não muda nada: id já usado por outra linha recusa e o recibo segue pendente', async () => {
    const primeira = await linha()
    const segunda = await linha()
    const w = wamid()
    await marcarEnviada(primeira.id, w)
    const inbox = await naInbox(w, 'delivered')

    const { error } = await servico.rpc('outbox_mark_sent', {
      p_outbox_id: segunda.id,
      p_provider: 'meta',
      p_provider_message_id: w,
    })
    expect(error).not.toBeNull()
    const e = await estado(segunda.id)
    expect(e.sent_at).toBeNull()
    expect(e.provider_message_id).toBeNull()
    const [i] = await sql`select processed_at from webhook_inbox where id = ${inbox}`
    expect(i.processed_at).toBeNull()
    expect((await estado(primeira.id)).delivered_at).toBeNull()
  })

  it('linha da inbox com status fora do vocabulário não casa nem é tocada', async () => {
    const l = await linha()
    const w = wamid()
    const [estranha] = await sql`
      insert into webhook_inbox (source, event_id, payload)
      values ('meta', ${`${w}:deleted`}, '{"status":{"status":"deleted"}}'::jsonb)
      returning id`
    expect(await marcarEnviada(l.id, w)).toBe(0)
    await sql`select public.outbox_reapply_pending_receipts()`
    const [i] = await sql`select processed_at, error from webhook_inbox where id = ${estranha.id}`
    expect(i.processed_at).toBeNull()
    expect(i.error).toBeNull()
    expect((await estado(l.id)).situacao).toBe('enviado')
  })

  it('repetir outbox_mark_sent com o mesmo id é idempotente; com outro id, recusa', async () => {
    const l = await linha()
    const w = wamid()
    await marcarEnviada(l.id, w)
    const e1 = await estado(l.id)
    await marcarEnviada(l.id, w)
    expect((await estado(l.id)).sent_at!.getTime()).toBe(e1.sent_at!.getTime())
    const { error } = await servico.rpc('outbox_mark_sent', {
      p_outbox_id: l.id,
      p_provider: 'meta',
      p_provider_message_id: wamid(),
    })
    expect(error?.message).toMatch(/já está fechado/)
  })

  it('a rede do cron: recibo gravado depois do id é aplicado pelo job, e o job está agendado a cada 5 min', async () => {
    const l = await linha()
    const w = wamid()
    await marcarEnviada(l.id, w)
    const inbox = await naInbox(w, 'read')

    const [r] = await sql`select public.outbox_reapply_pending_receipts() as n`
    expect(Number(r.n)).toBeGreaterThanOrEqual(1)
    const e = await estado(l.id)
    expect(e.read_at).not.toBeNull()
    expect(e.delivered_at).not.toBeNull()
    const [i] = await sql`select processed_at from webhook_inbox where id = ${inbox}`
    expect(i.processed_at).not.toBeNull()

    const [job] = await sql`
      select schedule, command from cron.job where jobname = 'outbox-reapply-meta-receipts'`
    expect(job.schedule).toBe('*/5 * * * *')
    expect(job.command).toContain('outbox_reapply_pending_receipts')
  })
})

// ---------------------------------------------------------------------------
describe('M3-1 · 3. reserva do despacho', () => {
  it('duas conexões ao mesmo tempo recebem conjuntos disjuntos; a mesma linha não volta em 10 min; fechar e falhar soltam', async () => {
    const prefixo = `${PREFIXO}reserva:`
    const ids: string[] = []
    for (let i = 0; i < 30; i++) {
      const [r] = await sql`
        insert into notification_outbox (channel, template, payload, dedupe_key)
        values ('whatsapp', 'class-reminder', '{}'::jsonb, ${`${prefixo}${i}`})
        returning id`
      ids.push(r.id as string)
    }
    const filtro = `${prefixo}%`

    const a = connect(1)
    const b = connect(1)
    let doA: string[] = []
    let doB: string[] = []
    try {
      await a.begin(async (ta) => {
        await comoServidor(ta)
        doA = (await ta`select id from public.outbox_claim_pending(20, ${filtro})`).map((r) => r.id as string)
        // A segura as 20 linhas (transação aberta) enquanto B pede as suas
        await b.begin(async (tb) => {
          await comoServidor(tb)
          doB = (await tb`select id from public.outbox_claim_pending(20, ${filtro})`).map((r) => r.id as string)
        })
      })
    } finally {
      await a.end()
      await b.end()
    }
    expect(doA).toHaveLength(20)
    expect(doB).toHaveLength(10)
    expect(doA.filter((id) => doB.includes(id))).toEqual([])
    expect([...doA, ...doB].sort()).toEqual([...ids].sort())

    // reservadas há menos de 10 min: ninguém recebe de novo
    const { data: denovo, error } = await servico.rpc('outbox_claim_pending', { p_limit: 20, p_key_like: filtro })
    expect(error).toBeNull()
    expect(denovo).toEqual([])

    // passados 10 min, a reserva vence e a linha volta
    const vencidas = ids.slice(0, 3)
    await sql`update notification_outbox set claimed_at = now() - interval '11 minutes' where id = any(${vencidas})`
    const { data: voltaram } = await servico.rpc('outbox_claim_pending', { p_limit: 20, p_key_like: filtro })
    expect((voltaram as { id: string }[]).map((r) => r.id).sort()).toEqual([...vencidas].sort())

    // outbox_mark_sent limpa a reserva
    await marcarEnviada(ids[0], wamid())
    expect((await estado(ids[0])).claimed_at).toBeNull()

    // o `fail` do despachante (UPDATE de error) também solta
    expect((await estado(ids[1])).claimed_at).not.toBeNull()
    await sql`update notification_outbox set error = 'falha de teste' where id = ${ids[1]}`
    expect((await estado(ids[1])).claimed_at).toBeNull()
  })

  it('limite fora de 1–500 recusa', async () => {
    const { error } = await servico.rpc('outbox_claim_pending', { p_limit: 0, p_key_like: `${PREFIXO}%` })
    expect(error?.message).toMatch(/limite da reserva/)
  })
})

// ---------------------------------------------------------------------------
// Gate Sol da PR #102 (S1): a resposta do provedor se perdeu depois de o POST
// ser aceito. Resultado incerto não pode virar retry (a mesma mensagem duas
// vezes), e o recibo tem de achar a linha sem o wamid.
describe('M3-1 · 3b. tentativa de envio: resultado incerto não vira retry', () => {
  async function linhaReservada(): Promise<{ id: string; filtro: string }> {
    seq += 1
    const filtro = `${PREFIXO}tentativa:${seq}:%`
    const [r] = await sql`
      insert into notification_outbox (channel, template, payload, dedupe_key)
      values ('whatsapp', 'class-reminder', '{}'::jsonb, ${filtro.replace('%', 'x')})
      returning id`
    const { data } = await servico.rpc('outbox_claim_pending', { p_limit: 5, p_key_like: filtro })
    expect((data as { id: string }[]).map((x) => x.id)).toEqual([r.id])
    return { id: r.id as string, filtro }
  }
  async function abrir(id: string): Promise<string> {
    const { data, error } = await servico.rpc('outbox_begin_attempt', { p_outbox_id: id })
    expect(error, `begin_attempt recusou: ${error?.message}`).toBeNull()
    return String(data)
  }
  async function falhar(id: string, motivo: string, definitivo: boolean): Promise<void> {
    const { error } = await servico.rpc('outbox_fail_attempt', {
      p_outbox_id: id,
      p_error: motivo,
      p_definitivo: definitivo,
    })
    expect(error, `fail_attempt recusou: ${error?.message}`).toBeNull()
  }
  async function tentativaDe(id: string): Promise<string | null> {
    const [r] = await sql`select attempt_id from notification_outbox where id = ${id}`
    return (r.attempt_id as string | null) ?? null
  }

  it('falha incerta: a reserva fica, a linha fica presa e não volta para a fila nem depois de 10 min', async () => {
    const { id, filtro } = await linhaReservada()
    await abrir(id)
    await falhar(id, 'tempo esgotado esperando a Meta', false)
    const e = await estado(id)
    expect(e.claimed_at).not.toBeNull()
    expect(e.error).toMatch(/^resultado incerto: tempo esgotado/)
    expect(e.situacao).toBe('preso')
    expect(await tentativaDe(id)).not.toBeNull()

    await sql`update notification_outbox set claimed_at = now() - interval '11 minutes' where id = ${id}`
    const { data } = await servico.rpc('outbox_claim_pending', { p_limit: 5, p_key_like: filtro })
    expect(data).toEqual([])
    // e o UPDATE de error "à moda antiga" também não solta a tentativa
    await sql`update notification_outbox set error = 'outra falha', claimed_at = now() where id = ${id}`
    expect((await estado(id)).claimed_at).not.toBeNull()
  })

  it('o recibo com o id da tentativa fecha a linha sem o wamid; o mark_sent atrasado é idempotente', async () => {
    const { id } = await linhaReservada()
    const tentativa = await abrir(id)
    await falhar(id, 'resposta perdida', false)
    const w = wamid()

    const { data, error } = await servico.rpc('apply_delivery_receipt', {
      p_provider: 'meta',
      p_provider_message_id: w,
      p_status: 'delivered',
      p_attempt_id: tentativa,
    })
    expect(error).toBeNull()
    expect(data).toBe('aplicado')
    const e = await estado(id)
    expect(e.provider_message_id).toBe(w)
    expect(e.sent_at).not.toBeNull()
    expect(e.delivered_at).not.toBeNull()
    expect(e.error).toBeNull()
    expect(await tentativaDe(id)).toBeNull()
    expect(e.situacao).toBe('entregue')

    expect(await marcarEnviada(id, w)).toBe(0)
  })

  it('pela inbox: o job acha a tentativa pelo biz_opaque_callback_data do recibo', async () => {
    const { id } = await linhaReservada()
    const tentativa = await abrir(id)
    await falhar(id, 'resposta perdida', false)
    const w = wamid()
    const [i] = await sql`
      insert into webhook_inbox (source, event_id, payload)
      values ('meta', ${`${w}:read`},
              ${sql.json({ status: { id: w, status: 'read', biz_opaque_callback_data: tentativa } })})
      returning id`

    await sql`select public.outbox_reapply_pending_receipts()`
    const e = await estado(id)
    expect(e.provider_message_id).toBe(w)
    expect(e.read_at).not.toBeNull()
    expect(e.situacao).toBe('entregue')
    const [depois] = await sql`select processed_at from webhook_inbox where id = ${i.id}`
    expect(depois.processed_at).not.toBeNull()
  })

  it('falha definitiva fecha a tentativa e solta a reserva: a linha volta para a fila', async () => {
    const { id, filtro } = await linhaReservada()
    await abrir(id)
    await falhar(id, 'número recusado pela Meta (código 131026)', true)
    const e = await estado(id)
    expect(e.claimed_at).toBeNull()
    expect(e.error).toBe('número recusado pela Meta (código 131026)')
    expect(await tentativaDe(id)).toBeNull()
    const { data } = await servico.rpc('outbox_claim_pending', { p_limit: 5, p_key_like: filtro })
    expect((data as { id: string }[]).map((x) => x.id)).toEqual([id])
  })

  it('tentativa sem resposta em 10 min vira presa "resultado incerto" pelo job, sem voltar para a fila', async () => {
    const { id, filtro } = await linhaReservada()
    await abrir(id)
    await sql`update notification_outbox
                 set attempt_started_at = now() - interval '11 minutes',
                     claimed_at = now() - interval '11 minutes'
               where id = ${id}`
    await sql`select public.outbox_reapply_pending_receipts()`
    const e = await estado(id)
    expect(e.error).toMatch(/^resultado incerto: a tentativa de envio não teve resposta/)
    expect(e.situacao).toBe('preso')
    const { data } = await servico.rpc('outbox_claim_pending', { p_limit: 5, p_key_like: filtro })
    expect(data).toEqual([])
  })

  it('o portão do envio: tentativa já aberta e linha fechada recusam', async () => {
    const { id } = await linhaReservada()
    await abrir(id)
    const duas = await servico.rpc('outbox_begin_attempt', { p_outbox_id: id })
    expect(duas.error?.message).toMatch(/já tem tentativa em aberto/)
    const fechada = await linha({ sent_at: 'agora' })
    const r = await servico.rpc('outbox_begin_attempt', { p_outbox_id: fechada.id })
    expect(r.error?.message).toMatch(/já está fechado/)
  })
})

// ---------------------------------------------------------------------------
describe('M3-1 · 4. aviso interno à admin sai só por e-mail', () => {
  it('revisão de conteúdo (portão 2) para admin COM WhatsApp sai por e-mail', async () => {
    const adminZap = await createAuthUser(sql, 'admin', 'Admin M3-1 zap', {
      whatsapp: '+55659000' + String(Math.floor(Math.random() * 90000) + 10000),
    })
    const [{ id }] = await sql`
      insert into content_posts (external_ref, kind, tema) values (${`m3e-${RODADA}`}, 'story', 'Canal M3-1')
      returning id`
    await sql`update content_posts
              set status = 'ideia_aprovada', idea_approved_by = ${adminZap}, idea_approved_at = now()
              where id = ${id}`
    await sql`update content_posts set status = 'gerando' where id = ${id}`
    await sql`update content_posts set status = 'rascunho', legenda = 'ok' where id = ${id}`

    const linhas = await sql`
      select channel from notification_outbox
       where template = 'content-review' and recipient_profile_id = ${adminZap}`
    expect(linhas.map((l) => l.channel)).toEqual(['email'])
  })

  /** Uma trend da rodada pedida, pela mão do robô (como o conteudo-digest faz). */
  async function trendNaRodada(semana: string): Promise<void> {
    const sourceKey = `reel:youtube:m3e-${crypto.randomUUID().slice(0, 8)}`
    const { data: research, error: erroResearch } = await servico.rpc('record_content_research', {
      p_tipo: 'analise_reel',
      p_plataforma: 'youtube',
      p_source_key: sourceKey,
      p_payload: { transcricao: { texto: 'fixture', via: 'teste' }, analise: { gancho: { texto_falado: 'x' } } },
      p_metricas: { views: 1000 },
      p_titulo: 'Fixture M3-1',
      p_url: 'https://youtube.com/shorts/fixture',
    })
    expect(erroResearch).toBeNull()
    const { error: erroTrend } = await servico.from('content_trends').insert({
      research_id: (research as { id: string }[])[0].id,
      source_key: sourceKey,
      plataforma: 'youtube',
      url: 'https://youtube.com/shorts/fixture',
      autor: 'Canal de fixture',
      views: 1000,
      velocidade: 2.5,
      velocidade_sem_conta: false,
      semana,
      travel_score: 80,
      travel_meta: { justificativa: 'fixture', prompt_versao: 1 },
    })
    expect(erroTrend).toBeNull()
  }
  // semanas 50–53: fora das rodadas sequenciais (W01…) do conteudo-digest
  let semanaDoDigest = 49
  const rodadaDoDigest = () => `${1000 + Math.floor(Math.random() * 9000)}-W${++semanaDoDigest}`

  it('digest do lote para admin COM WhatsApp sai por e-mail', async () => {
    const adminZap = await createAuthUser(sql, 'admin', 'Admin M3-1 digest', {
      whatsapp: '+55659000' + String(Math.floor(Math.random() * 90000) + 10000),
    })
    const semana = rodadaDoDigest()
    await trendNaRodada(semana)

    const { error } = await servico.rpc('enqueue_content_digest', { p_semana: semana, p_limiar: 60 })
    expect(error).toBeNull()
    const linhas = await sql`
      select channel from notification_outbox
       where template = 'content-digest' and recipient_profile_id = ${adminZap}
         and payload ->> 'semana' = ${semana}`
    expect(linhas.map((l) => l.channel)).toEqual(['email'])
  })

  it('S4 · corrida repetida não reescreve o digest que o despachante reservou ou está enviando', async () => {
    const semana = rodadaDoDigest()
    await trendNaRodada(semana)
    expect((await servico.rpc('enqueue_content_digest', { p_semana: semana, p_limiar: 60 })).error).toBeNull()
    const chave = `content-digest:${semana}:${adminId}`
    await sql`update notification_outbox set claimed_at = now() where dedupe_key = ${chave}`

    await trendNaRodada(semana)
    expect((await servico.rpc('enqueue_content_digest', { p_semana: semana, p_limiar: 60 })).error).toBeNull()
    const [reservada] = await sql`select payload from notification_outbox where dedupe_key = ${chave}`
    expect(reservada.payload.novas).toBe(1) // o número que está saindo

    // com tentativa em aberto (reserva vencida), também não
    await sql`update notification_outbox
                 set claimed_at = now() - interval '11 minutes',
                     attempt_id = gen_random_uuid(), attempt_started_at = now()
               where dedupe_key = ${chave}`
    await trendNaRodada(semana)
    expect((await servico.rpc('enqueue_content_digest', { p_semana: semana, p_limiar: 60 })).error).toBeNull()
    const [emEnvio] = await sql`select payload from notification_outbox where dedupe_key = ${chave}`
    expect(emEnvio.payload.novas).toBe(1)

    // livre de novo: a correção volta a valer
    await sql`update notification_outbox set attempt_id = null, attempt_started_at = null
               where dedupe_key = ${chave}`
    expect((await servico.rpc('enqueue_content_digest', { p_semana: semana, p_limiar: 60 })).error).toBeNull()
    const [livre] = await sql`select payload from notification_outbox where dedupe_key = ${chave}`
    expect(livre.payload.novas).toBe(3)
  })
})

describe('M3-1 · 4b. as linhas desses avisos que aguardavam WhatsApp viram e-mail na migration', () => {
  it('só as que nunca foram tentadas (sem erro); as presas ficam (pino no TEXTO: a migration roda uma vez)', () => {
    const texto = readFileSync(join(process.cwd(), 'supabase/migrations', MIGRATION), 'utf8')
    const update = /update public\.notification_outbox\s+set channel = 'email'\s+where ([\s\S]*?);/.exec(texto)
    expect(update, 'o update de canal sumiu da migration').not.toBeNull()
    const onde = update![1]
    expect(onde).toMatch(/template in \('content-review', 'content-digest'\)/)
    expect(onde).toMatch(/channel = 'whatsapp'/)
    expect(onde).toMatch(/sent_at is null/)
    expect(onde).toMatch(/error is null/)
  })
})

// ---------------------------------------------------------------------------
describe('M3-1 · 5. revoke nominal no texto da migration', () => {
  const texto = readFileSync(join(process.cwd(), 'supabase/migrations', MIGRATION), 'utf8')
  const NOVAS = [
    '_outbox_solta_reserva()',
    '_outbox_apply_receipt(uuid, text, text)',
    '_outbox_apply_pending_receipts(text)',
    '_outbox_correlate_attempt(uuid, text, text)',
    'apply_delivery_receipt(text, text, text, text, uuid)',
    'outbox_mark_sent(uuid, text, text)',
    'outbox_claim_pending(int, text)',
    'outbox_begin_attempt(uuid)',
    'outbox_fail_attempt(uuid, text, boolean)',
    'outbox_reapply_pending_receipts()',
    'admin_resend_outbox(uuid)',
  ]
  it.each(NOVAS)('%s revoga EXECUTE de public, anon e authenticated pelo nome', (assinatura) => {
    const escapada = assinatura.replace(/[()]/g, '\\$&')
    expect(texto).toMatch(
      new RegExp(`revoke execute on function public\\.${escapada} from public, anon, authenticated`),
    )
  })
})

// ---------------------------------------------------------------------------
describe('M3-1 · 6. failed depois do envio: presa e reenviável', () => {
  it('motivo em error, sent_at intacto, situação presa; reenviar cria linha nova pendente com chave diferente e audita', async () => {
    const l = await linha()
    const w = wamid()
    await marcarEnviada(l.id, w)
    const enviada = await estado(l.id)

    expect(await recibo(w, 'failed', 'número sem WhatsApp (código 131026)')).toBe('aplicado')
    const presa = await estado(l.id)
    expect(presa.error).toContain('número sem WhatsApp')
    expect(presa.sent_at!.getTime()).toBe(enviada.sent_at!.getTime())
    expect(presa.situacao).toBe('preso')

    const { data: nova, error } = await comoAdmin.rpc('admin_resend_outbox', { p_id: l.id })
    expect(error, `reenviar recusou: ${error?.message}`).toBeNull()
    const [n] = await sql`
      select sent_at, error, dedupe_key, template, channel, payload from notification_outbox where id = ${nova as string}`
    expect(n.sent_at).toBeNull()
    expect(n.error).toBeNull()
    expect(n.dedupe_key).not.toBe(l.dedupe_key)
    expect(n.dedupe_key.startsWith(l.dedupe_key)).toBe(true)
    expect(n.template).toBe('class-reminder')
    expect(n.channel).toBe('whatsapp')
    expect((await estado(nova as string)).situacao).toBe('pendente')

    const auditoria = await sql`
      select actor, diff from audit_log where action = 'resend_outbox' and entity_id = ${l.id}::text`
    expect(auditoria).toHaveLength(1)
    expect(auditoria[0].actor).toBe(adminId)
    expect(auditoria[0].diff.nova_linha).toBe(nova)
    expect(auditoria[0].diff.situacao_anterior).toBe('preso')

    // a de origem sai dos presos e não é reenviada duas vezes
    const origem = await estado(l.id)
    expect(origem.resent_as).toBe(nova)
    expect(origem.situacao).toBe('resolvido')
    const { error: duas } = await comoAdmin.rpc('admin_resend_outbox', { p_id: l.id })
    expect(duas?.message).toMatch(/já foi reenviado/)
  })

  it('recibo failed pendente na inbox leva o motivo da Meta para a linha', async () => {
    const l = await linha()
    const w = wamid()
    await naInbox(w, 'failed', { erros: [{ code: 131026, title: 'Message undeliverable' }] })
    await marcarEnviada(l.id, w)
    const e = await estado(l.id)
    expect(e.error).toContain('Message undeliverable')
    expect(e.error).toContain('131026')
    expect(e.situacao).toBe('preso')
  })

  it('failed ANTES de delivered (fora de ordem) termina entregue, igual à ordem certa', async () => {
    const l = await linha()
    const w = wamid()
    await marcarEnviada(l.id, w)
    await recibo(w, 'failed', 'falha que chegou antes')
    expect((await estado(l.id)).situacao).toBe('preso')
    await recibo(w, 'delivered')
    const e = await estado(l.id)
    expect(e.error).toBeNull()
    expect(e.delivered_at).not.toBeNull()
    expect(e.situacao).toBe('entregue')
  })

  it('presa que falhou depois do envio se resolve sem reenviar: sent_at fica, motivo e nota ficam, audita', async () => {
    const l = await linha()
    const w = wamid()
    await marcarEnviada(l.id, w)
    const enviada = await estado(l.id)
    await recibo(w, 'failed', 'número sem WhatsApp')

    const { error } = await comoAdmin.rpc('admin_resolve_outbox', { p_id: l.id, p_note: 'aula já passou' })
    expect(error, `resolver recusou: ${error?.message}`).toBeNull()
    const e = await estado(l.id)
    expect(e.situacao).toBe('resolvido')
    expect(e.sent_at!.getTime()).toBe(enviada.sent_at!.getTime())
    expect(e.error).toContain('aula já passou')
    expect(e.error).toContain('número sem WhatsApp')
    const auditoria = await sql`
      select diff from audit_log where action = 'resolve_outbox' and entity_id = ${l.id}::text`
    expect(auditoria).toHaveLength(1)
    expect(String(auditoria[0].diff.error_anterior)).toContain('falhou depois do envio')

    // e a enviada que não falhou continua sem "resolver"
    const ok = await linha()
    await marcarEnviada(ok.id, wamid())
    const { error: recusa } = await comoAdmin.rpc('admin_resolve_outbox', { p_id: ok.id, p_note: 'x' })
    expect(recusa?.message).toMatch(/já está resolvido\/enviado/)
  })

  it('presa reservada pelo despachante (envio em voo) não se reenvia nem se resolve', async () => {
    const l = await linha({ error: 'falha anterior' })
    await sql`update notification_outbox set claimed_at = now() where id = ${l.id}`
    const { error: reenviar } = await comoAdmin.rpc('admin_resend_outbox', { p_id: l.id })
    expect(reenviar?.message).toMatch(/está sendo enviado agora/)
    const { error: resolver } = await comoAdmin.rpc('admin_resolve_outbox', { p_id: l.id, p_note: 'x' })
    expect(resolver?.message).toMatch(/está sendo enviado agora/)
    const e = await estado(l.id)
    expect(e.sent_at).toBeNull()
    expect(e.resent_as).toBeNull()

    // reserva vencida (10 min): volta a valer
    await sql`update notification_outbox set claimed_at = now() - interval '11 minutes' where id = ${l.id}`
    const { error: depois } = await comoAdmin.rpc('admin_resend_outbox', { p_id: l.id })
    expect(depois).toBeNull()
  })

  it('S2 · reenvio entre a falha e a entrega tardia: a cópia que não saiu é cancelada, com audit', async () => {
    const l = await linha()
    const w = wamid()
    await marcarEnviada(l.id, w)
    await recibo(w, 'failed', 'falha que a entrega vai desmentir')
    const { data: copia, error } = await comoAdmin.rpc('admin_resend_outbox', { p_id: l.id })
    expect(error).toBeNull()

    await recibo(w, 'delivered')
    expect((await estado(l.id)).situacao).toBe('entregue')
    const c = await estado(copia as string)
    expect(c.sent_at).not.toBeNull()
    expect(c.error).toMatch(/^cancelado sem envio: a mensagem original foi entregue/)
    expect(c.situacao).toBe('resolvido')
    const auditoria = await sql`
      select diff from audit_log where action = 'resend_cancelled_by_delivery' and entity_id = ${copia as string}`
    expect(auditoria).toHaveLength(1)
    expect(auditoria[0].diff.original).toBe(l.id)
    // e o despachante não a manda: o portão recusa
    const r = await servico.rpc('outbox_begin_attempt', { p_outbox_id: copia as string })
    expect(r.error?.message).toMatch(/já está fechado/)
  })

  it('S2 · cópia que já está saindo (tentativa aberta) não é cancelada', async () => {
    const l = await linha()
    const w = wamid()
    await marcarEnviada(l.id, w)
    await recibo(w, 'failed', 'falha')
    const { data: copia } = await comoAdmin.rpc('admin_resend_outbox', { p_id: l.id })
    await servico.rpc('outbox_begin_attempt', { p_outbox_id: copia as string })

    await recibo(w, 'read')
    const c = await estado(copia as string)
    expect(c.sent_at).toBeNull()
    expect(c.error).toBeNull()
  })

  it('S3 · falhou, a dona resolveu sem reenviar, e a entrega chegou depois: a situação é entregue', async () => {
    const l = await linha()
    const w = wamid()
    await marcarEnviada(l.id, w)
    await recibo(w, 'failed', 'falha')
    expect((await comoAdmin.rpc('admin_resolve_outbox', { p_id: l.id, p_note: 'não reenviar' })).error).toBeNull()
    expect((await estado(l.id)).situacao).toBe('resolvido')

    await recibo(w, 'delivered')
    const e = await estado(l.id)
    expect(e.delivered_at).not.toBeNull()
    expect(e.situacao).toBe('entregue')
  })

  it('R2 · reenviar aviso interno preso no WhatsApp cria a cópia no e-mail', async () => {
    for (const template of ['content-review', 'content-digest']) {
      seq += 1
      const [r] = await sql`
        insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key, error)
        values ('whatsapp', ${template}, ${adminId}, '{}'::jsonb, ${`${PREFIXO}${seq}`}, 'canal desligado')
        returning id`
      const { data: copia, error } = await comoAdmin.rpc('admin_resend_outbox', { p_id: r.id })
      expect(error, template).toBeNull()
      const [c] = await sql`select channel, template from notification_outbox where id = ${copia as string}`
      expect(c, template).toEqual({ channel: 'email', template })
    }
    // os outros templates mantêm o canal da original
    const l = await linha({ error: 'falha' })
    const { data: copia } = await comoAdmin.rpc('admin_resend_outbox', { p_id: l.id })
    const [c] = await sql`select channel from notification_outbox where id = ${copia as string}`
    expect(c.channel).toBe('whatsapp')
  })

  it('R1 · a cópia pendente pode ser apagada pela troca de número do aluno (a original não trava o delete)', async () => {
    const studentId = await createStudent(sql)
    const alunoUser = await createAuthUser(sql, 'student', 'Aluno M3-1 troca')
    await sql`update students set profile_id = ${alunoUser} where id = ${studentId}`
    const [antigo] = await sql`select whatsapp_e164 from profiles where id = ${alunoUser}`
    seq += 1
    const [preso] = await sql`
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key, error)
      values ('email', 'student-whatsapp-changed', ${adminId},
              ${sql.json({ student_id: studentId, whatsapp_e164: antigo.whatsapp_e164 as string })},
              ${`${PREFIXO}${seq}`}, 'falha de envio')
      returning id`
    const { data: copia, error } = await comoAdmin.rpc('admin_resend_outbox', { p_id: preso.id })
    expect(error).toBeNull()

    const novo = '+55659000' + String(Math.floor(Math.random() * 90000) + 10000)
    const comoAluno = await clientAs(alunoUser, 'student')
    const { error: troca } = await comoAluno.rpc('update_my_whatsapp', { p_e164: novo })
    expect(troca, `a troca de número travou: ${troca?.message}`).toBeNull()

    expect(await sql`select 1 from notification_outbox where id = ${copia as string}`).toHaveLength(0)
    const o = await estado(preso.id)
    expect(o.resent_as).toBeNull()
    expect(o.situacao).toBe('resolvido')
  })

  it('failed depois de entregue não desfaz a entrega', async () => {
    const l = await linha()
    const w = wamid()
    await marcarEnviada(l.id, w)
    await recibo(w, 'delivered')
    expect(await recibo(w, 'failed', 'tarde demais')).toBe('ignorado')
    const e = await estado(l.id)
    expect(e.error).toBeNull()
    expect(e.situacao).toBe('entregue')
  })

  it('presa antes de enviar: reenviar fecha a de origem (o despachante não manda as duas)', async () => {
    const l = await linha({ error: 'aluno sem login' })
    const { data: nova, error } = await comoAdmin.rpc('admin_resend_outbox', { p_id: l.id })
    expect(error).toBeNull()
    const origem = await estado(l.id)
    expect(origem.sent_at).not.toBeNull()
    expect(origem.resent_as).toBe(nova)
    expect(origem.situacao).toBe('resolvido')
    expect((await estado(nova as string)).situacao).toBe('pendente')
  })
})

// ---------------------------------------------------------------------------
describe('M3-1 · 7. reenviar linha aguardando envio recusa', () => {
  it('erro nomeado, nenhuma linha nova, nenhum audit', async () => {
    const l = await linha()
    const { error } = await comoAdmin.rpc('admin_resend_outbox', { p_id: l.id })
    expect(error?.message).toMatch(/reenviar recusado: .* ainda está aguardando envio/)
    const novas = await sql`select 1 from notification_outbox where dedupe_key like ${l.dedupe_key + ':reenvio:%'}`
    expect(novas).toHaveLength(0)
    const auditoria = await sql`select 1 from audit_log where action = 'resend_outbox' and entity_id = ${l.id}::text`
    expect(auditoria).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('M3-1 · 8. a situação na view é a da tela de hoje, mais "entregue"', () => {
  it('pendente, preso, enviado e resolvido batem com situacaoDaLinha; entregue é o estado novo', async () => {
    const casos = [
      await linha(),
      await linha({ error: 'aluno sem login' }),
      await linha({ sent_at: 'agora' }),
      await linha({ sent_at: 'agora', error: 'resolvido sem envio: teste' }),
    ]
    for (const c of casos) {
      const [r] = await sql`select sent_at, error from notification_outbox where id = ${c.id}`
      const daTela = situacaoDaLinha(r.sent_at ? String(r.sent_at) : null, r.error as string | null)
      expect((await estado(c.id)).situacao, c.dedupe_key).toBe(daTela)
    }
    expect((await Promise.all(casos.map((c) => estado(c.id)))).map((e) => e.situacao)).toEqual([
      'pendente',
      'preso',
      'enviado',
      'resolvido',
    ])

    const entregue = await linha()
    const w = wamid()
    await marcarEnviada(entregue.id, w)
    expect((await estado(entregue.id)).situacao).toBe('enviado')
    await recibo(w, 'delivered')
    expect((await estado(entregue.id)).situacao).toBe('entregue')
  })

  it('a admin lê a view; logado sem papel de admin lê zero linhas; anônimo não lê', async () => {
    const l = await linha()
    const { data: daAdmin, error } = await comoAdmin.from('outbox_admin').select('id, situacao').eq('id', l.id)
    expect(error).toBeNull()
    expect(daAdmin).toEqual([{ id: l.id, situacao: 'pendente' }])

    const aluno = await createAuthUser(sql, 'student', 'Aluno M3-1 view')
    const { data: doAluno } = await (await clientAs(aluno, 'student')).from('outbox_admin').select('id').eq('id', l.id)
    expect(doAluno).toEqual([])

    const { error: anon } = await anonClient().from('outbox_admin').select('id').eq('id', l.id)
    expect(anon).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('M3-1 · 9. a confirmação de remarcação diz quem moveu', () => {
  async function confirmacao(inst: string): Promise<Record<string, unknown>[]> {
    return (await sql`
      select payload from notification_outbox
       where template = 'reschedule-confirm' and payload ->> 'instance_id' = ${inst}`).map(
      (r) => r.payload as Record<string, unknown>,
    )
  }

  it('professora remarca a própria aula → moved_by = teacher', async () => {
    const profUser = await createAuthUser(sql, 'teacher', 'Prof M3-1')
    const [t] = await sql`
      insert into teachers (hourly_rate_cents, display_name, iana_tz, profile_id)
      values (5000, ${'Prof M3-1 ' + RODADA}, 'America/Cuiaba', ${profUser})
      returning id`
    const studentId = await createStudent(sql)
    const alunoUser = await createAuthUser(sql, 'student', 'Aluno M3-1')
    await sql`update students set profile_id = ${alunoUser} where id = ${studentId}`
    const c = await createPrivateContract(sql, { studentId, teacherId: t.id as string, minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    await sql`
      insert into teacher_availability_exceptions (teacher_id, kind, starts_at_utc, ends_at_utc, local_snapshot)
      values (${t.id as string}, 'open', now() + interval '95 hours', now() + interval '98 hours', 'fixture m3-1')`
    const destino = new Date(Date.now() + 96 * 3_600_000)
    destino.setUTCSeconds(0, 0)

    const comoProf = await clientAs(profUser, 'teacher')
    const { data: nova, error } = await comoProf.rpc('teacher_reschedule_own_class', {
      p_instance: inst,
      p_starts_at_utc: destino.toISOString(),
      p_reason: 'teste M3-1',
    })
    expect(error, `remarcar recusou: ${error?.message}`).toBeNull()
    const linhas = await confirmacao(nova as string)
    expect(linhas).toHaveLength(1)
    expect(linhas[0].moved_by).toBe('teacher')
  })

  it('aluno pelo portal → student; administração → admin', async () => {
    const studentId = await createStudent(sql)
    const alunoUser = await createAuthUser(sql, 'student', 'Aluno M3-1 portal')
    await sql`update students set profile_id = ${alunoUser} where id = ${studentId}`
    const c = await createPrivateContract(sql, { studentId })
    const doAluno = await createInstance(sql, c, { startsInHours: 80 })
    const daAdmin = await createInstance(sql, c, { startsInHours: 90 })

    const comoAluno = await clientAs(alunoUser, 'student')
    expect((await comoAluno.rpc('enqueue_reschedule_confirmation', { p_instance: doAluno })).error).toBeNull()
    expect((await comoAdmin.rpc('enqueue_reschedule_confirmation', { p_instance: daAdmin })).error).toBeNull()

    expect((await confirmacao(doAluno))[0].moved_by).toBe('student')
    expect((await confirmacao(daAdmin))[0].moved_by).toBe('admin')
  })
})

// ---------------------------------------------------------------------------
describe('M3-1 · 10. expurgo LGPD cobre a origem meta', () => {
  it('purge_evolution_inbox apaga recibo meta com mais de 90 dias e preserva o novo', async () => {
    const velho = await naInbox(wamid(), 'delivered', { recebidoHaDias: 120 })
    const velhoProcessado = await naInbox(wamid(), 'read', { recebidoHaDias: 95 })
    await sql`update webhook_inbox set processed_at = now() where id = ${velhoProcessado}`
    const novo = await naInbox(wamid(), 'delivered', { recebidoHaDias: 5 })

    const [r] = await sql`select public.purge_evolution_inbox(90) as n`
    expect(Number(r.n)).toBeGreaterThanOrEqual(2)
    const sobrou = await sql`select id from webhook_inbox where id in (${velho}, ${velhoProcessado}, ${novo})`
    expect(sobrou.map((x) => Number(x.id))).toEqual([novo])
  })

  it('R3 · a retenção de 90 dias apaga também o recibo da Evolution já processado; o não processado fica', async () => {
    const run = crypto.randomUUID().slice(0, 8)
    const [processado] = await sql`
      insert into webhook_inbox (source, event_id, payload, received_at, processed_at)
      values ('evolution', ${'m3e-' + run + '-upd-ok'},
              '{"event":"messages.update","data":{"remoteJid":"5565900070001@s.whatsapp.net"}}'::jsonb,
              now() - interval '120 days', now() - interval '119 days')
      returning id`
    const [pendente] = await sql`
      insert into webhook_inbox (source, event_id, payload, received_at)
      values ('evolution', ${'m3e-' + run + '-upd-pend'}, '{"event":"messages.update"}'::jsonb,
              now() - interval '120 days')
      returning id`
    const [novo] = await sql`
      insert into webhook_inbox (source, event_id, payload, received_at, processed_at)
      values ('evolution', ${'m3e-' + run + '-upd-novo'}, '{"event":"messages.update"}'::jsonb,
              now() - interval '5 days', now())
      returning id`
    await sql`select public.purge_evolution_inbox(90)`
    const sobrou = await sql`
      select id from webhook_inbox where id in (${processado.id}, ${pendente.id}, ${novo.id}) order by id`
    expect(sobrou.map((x) => Number(x.id))).toEqual([Number(pendente.id), Number(novo.id)])
  })

  it('admin_purge_evolution_by_phone apaga os recibos meta daquele telefone (com e sem o 9) e deixa os dos outros', async () => {
    // assinante na faixa fictícia 9000X-XXXX (regra de dado de teste)
    const final = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
    const digitos = `55659000${Math.floor(Math.random() * 5)}${final}` // 13 dígitos
    const semNove = digitos.slice(0, 4) + digitos.slice(5) // o id antigo do WhatsApp, sem o 9
    const outro = `55659000${5 + Math.floor(Math.random() * 5)}${final}`
    const doAluno = await naInbox(wamid(), 'delivered', { recipient_id: digitos })
    const doAlunoSemNove = await naInbox(wamid(), 'read', { recipient_id: semNove })
    const deOutro = await naInbox(wamid(), 'delivered', { recipient_id: outro })

    // mensagem recebida (se a #44 vier a guardá-la): o número vem em `from`
    const [recebida] = await sql`
      insert into webhook_inbox (source, event_id, payload)
      values ('meta', ${`msg.${wamid()}`}, ${sql.json({ message: { from: digitos, type: 'text' } })})
      returning id`

    const telefone = `+${digitos.slice(0, 2)} ${digitos.slice(2, 4)} ${digitos.slice(4, 9)}-${digitos.slice(9)}`
    const { data: n, error } = await comoAdmin.rpc('admin_purge_evolution_by_phone', { p_phone: telefone })
    expect(error).toBeNull()
    expect(Number(n)).toBeGreaterThanOrEqual(3)
    const sobrou = await sql`
      select id from webhook_inbox where id in (${doAluno}, ${doAlunoSemNove}, ${deOutro}, ${recebida.id})`
    expect(sobrou.map((x) => Number(x.id))).toEqual([deOutro])
  })
})

// ---------------------------------------------------------------------------
describe('M3-1 · 11. ACL: anon e logado sem admin não executam; o servidor sim', () => {
  const DO_SERVIDOR = [
    'public.apply_delivery_receipt(text, text, text, text, uuid)',
    'public.outbox_mark_sent(uuid, text, text)',
    'public.outbox_claim_pending(int, text)',
    'public.outbox_begin_attempt(uuid)',
    'public.outbox_fail_attempt(uuid, text, boolean)',
    'public.outbox_reapply_pending_receipts()',
  ]
  const INTERNAS = [
    'public._outbox_apply_receipt(uuid, text, text)',
    'public._outbox_apply_pending_receipts(text)',
    'public._outbox_correlate_attempt(uuid, text, text)',
    'public._outbox_solta_reserva()',
  ]

  it('grants: portas do servidor só para service_role; internas para ninguém; reenviar para o logado (o corpo pede admin)', async () => {
    for (const f of DO_SERVIDOR) {
      const [acl] = await sql`
        select has_function_privilege('anon', ${f}, 'execute') as anon,
               has_function_privilege('authenticated', ${f}, 'execute') as auth,
               has_function_privilege('service_role', ${f}, 'execute') as servico`
      expect(acl, f).toEqual({ anon: false, auth: false, servico: true })
    }
    for (const f of INTERNAS) {
      const [acl] = await sql`
        select has_function_privilege('anon', ${f}, 'execute') as anon,
               has_function_privilege('authenticated', ${f}, 'execute') as auth,
               has_function_privilege('service_role', ${f}, 'execute') as servico`
      expect(acl, f).toEqual({ anon: false, auth: false, servico: false })
    }
    const [reenviar] = await sql`
      select has_function_privilege('anon', 'public.admin_resend_outbox(uuid)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.admin_resend_outbox(uuid)', 'execute') as auth`
    expect(reenviar).toEqual({ anon: false, auth: true })

    // a view: só leitura, só para o logado (a RLS da tabela decide as linhas)
    const [view] = await sql`
      select has_table_privilege('authenticated', 'public.outbox_admin', 'select') as ler,
             has_table_privilege('authenticated', 'public.outbox_admin', 'insert') as inserir,
             has_table_privilege('authenticated', 'public.outbox_admin', 'update') as mudar,
             has_table_privilege('anon', 'public.outbox_admin', 'select') as anon`
    expect(view).toEqual({ ler: true, inserir: false, mudar: false, anon: false })
  })

  it('pelo PostgREST: anon e aluno recebem 42501 em todas as funções novas', async () => {
    const aluno = await clientAs(await createAuthUser(sql, 'student', 'Aluno M3-1 ACL'), 'student')
    const l = await linha({ error: 'presa para o teste de ACL' })
    const chamadas: Array<[string, Record<string, unknown>]> = [
      ['apply_delivery_receipt', { p_provider: 'meta', p_provider_message_id: wamid(), p_status: 'delivered' }],
      ['outbox_mark_sent', { p_outbox_id: l.id, p_provider: 'meta', p_provider_message_id: wamid() }],
      ['outbox_claim_pending', { p_limit: 1, p_key_like: `${PREFIXO}%` }],
      ['outbox_begin_attempt', { p_outbox_id: l.id }],
      ['outbox_fail_attempt', { p_outbox_id: l.id, p_error: 'x', p_definitivo: true }],
      ['outbox_reapply_pending_receipts', {}],
      ['admin_resend_outbox', { p_id: l.id }],
    ]
    for (const cliente of [anonClient(), aluno]) {
      for (const [fn, args] of chamadas) {
        const { error } = await cliente.rpc(fn, args)
        expect(error?.code, `${fn}: ${error?.message}`).toBe('42501')
      }
    }
    const e = await estado(l.id)
    expect(e.sent_at).toBeNull()
    expect(e.resent_as).toBeNull()
  })

  it('o CORPO recusa quem não é o servidor — a defesa não é só o grant (teste local de ACL é falso-verde)', async () => {
    const conexao = connect(1)
    try {
      for (const chamada of [
        (tx: TransactionSql) => tx`select public.apply_delivery_receipt('meta', ${wamid()}, 'delivered')`,
        (tx: TransactionSql) => tx`select public.outbox_mark_sent(gen_random_uuid(), 'meta', ${wamid()})`,
        (tx: TransactionSql) => tx`select * from public.outbox_claim_pending(1, ${`${PREFIXO}%`})`,
        (tx: TransactionSql) => tx`select public.outbox_begin_attempt(gen_random_uuid())`,
        (tx: TransactionSql) => tx`select public.outbox_fail_attempt(gen_random_uuid(), 'x', true)`,
        (tx: TransactionSql) => tx`select public.outbox_reapply_pending_receipts()`,
      ]) {
        await expect(
          conexao.begin(async (tx) => {
            // dono da função (EXECUTE garantido), mas falando como um logado comum
            await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'authenticated' })}, true)`
            await chamada(tx)
          }),
        ).rejects.toMatchObject({ code: '42501' })
      }
    } finally {
      await conexao.end()
    }
  })
})
