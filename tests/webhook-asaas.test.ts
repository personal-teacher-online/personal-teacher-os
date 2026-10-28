// Fase 2 / M5 — Webhook Asaas idempotente (Lei 6 + D4/D7). Casos 11, 12, 13, 18, 19.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { handleAsaasWebhook } from '../src/lib/webhooks/asaas'
import { serviceClient } from './helpers/auth'
import { connect, createPrivateContract } from './helpers/db'

const TOKEN = 'tok-teste-webhook'
let sql: Sql
const service = serviceClient()

beforeAll(() => {
  sql = connect(3)
})
afterAll(async () => {
  await sql.end()
})

function evt(overrides: Record<string, unknown> = {}, payment: Record<string, unknown> = {}) {
  return {
    id: 'evt_' + crypto.randomUUID().slice(0, 12),
    event: 'PAYMENT_RECEIVED',
    payment: {
      id: 'pay_' + crypto.randomUUID().slice(0, 12),
      value: 600.0,
      status: 'RECEIVED',
      dueDate: '2026-09-05',
      billingType: 'PIX',
      ...payment,
    },
    ...overrides,
  }
}

async function call(payload: unknown, token: string | null = TOKEN) {
  return handleAsaasWebhook(service, { token, expectedToken: TOKEN, payload })
}

describe('caso 18: token', () => {
  it('sem token / token errado → 401 e NADA gravado (nem inbox, nem payments)', async () => {
    const e = evt()
    for (const bad of [null, 'errado']) {
      const r = await call(e, bad)
      expect(r.status).toBe(401)
    }
    // Endpoint sem token configurado é fail-closed.
    const r = await handleAsaasWebhook(service, { token: 'x', expectedToken: undefined, payload: e })
    expect(r.status).toBe(401)

    const [{ count: inbox }] = await sql`
      select count(*)::int as count from webhook_inbox where event_id = ${e.id}`
    expect(inbox).toBe(0)
    const [{ count: pays }] = await sql`
      select count(*)::int as count from payments where asaas_payment_id = ${e.payment.id}`
    expect(pays).toBe(0)
  })
})

describe('casos 11/19: idempotência first-write-wins', () => {
  it('caso 11: mesmo event_id entregue 2x → 1 efeito, inbox 1 linha', async () => {
    const c = await createPrivateContract(sql)
    const e = evt({}, { externalReference: c.contractId })

    expect((await call(e)).status).toBe(200)
    expect((await call(e)).status).toBe(200)

    const [{ count: inbox }] = await sql`
      select count(*)::int as count from webhook_inbox where event_id = ${e.id}`
    expect(inbox).toBe(1)
    const [{ count: pays }] = await sql`
      select count(*)::int as count from payments where asaas_payment_id = ${e.payment.id}`
    expect(pays).toBe(1)
  })

  it('caso 19: replay com payload DIFERENTE → payload ORIGINAL preservado, nenhum efeito extra', async () => {
    const c = await createPrivateContract(sql)
    const e = evt({}, { externalReference: c.contractId, value: 600.0 })
    await call(e)

    const forged = { ...e, payment: { ...e.payment, value: 1.0 } }
    const r = await call(forged)
    expect(r.status).toBe(200)

    const [row] = await sql`
      select payload -> 'payment' ->> 'value' as value from webhook_inbox where event_id = ${e.id}`
    expect(Number(row.value)).toBe(600)
    const [pay] = await sql`
      select amount_cents from payments where asaas_payment_id = ${e.payment.id}`
    expect(pay.amount_cents).toBe(60000) // Lei 9: centavos, do payload original
  })
})

describe('caso 12: externalReference desconhecido', () => {
  it('200 rápido, inbox com error, nada corrompido', async () => {
    const e = evt({}, { externalReference: crypto.randomUUID() })
    const r = await call(e)
    expect(r.status).toBe(200)

    const [row] = await sql`
      select error, processed_at from webhook_inbox where event_id = ${e.id}`
    expect(row.error).toContain('desconhecido')
    expect(row.processed_at).not.toBeNull()
    const [{ count }] = await sql`
      select count(*)::int as count from payments where asaas_payment_id = ${e.payment.id}`
    expect(count).toBe(0)
  })

  it('sem externalReference (vazio) idem', async () => {
    const e = evt({}, { externalReference: null })
    expect((await call(e)).status).toBe(200)
    const [row] = await sql`select error from webhook_inbox where event_id = ${e.id}`
    expect(row.error).toContain('vazio')
  })
})

describe('caso 13: competência derivada do dueDate (D4)', () => {
  it('2 cobranças do MESMO contrato com dueDates distintos → reference_ym 2026-09 e 2026-10', async () => {
    const c = await createPrivateContract(sql)
    const e1 = evt({}, { externalReference: c.contractId, dueDate: '2026-09-05' })
    const e2 = evt({}, { externalReference: c.contractId, dueDate: '2026-10-05' })
    await call(e1)
    await call(e2)

    const rows = await sql`
      select reference_ym, contract_id from payments
      where asaas_payment_id in (${e1.payment.id}, ${e2.payment.id})
      order by reference_ym`
    expect(rows.map((r) => r.reference_ym)).toEqual(['2026-09', '2026-10'])
    expect(rows.every((r) => r.contract_id === c.contractId)).toBe(true)
  })

  it('atualização de status (PENDING → RECEIVED) via evento novo atualiza o espelho', async () => {
    const c = await createPrivateContract(sql)
    const payId = 'pay_' + crypto.randomUUID().slice(0, 10)
    await call(evt({ event: 'PAYMENT_CREATED' }, { id: payId, externalReference: c.contractId, status: 'PENDING' }))
    await call(evt({}, { id: payId, externalReference: c.contractId, status: 'RECEIVED', paymentDate: '2026-09-04' }))

    const [pay] = await sql`select status, paid_at from payments where asaas_payment_id = ${payId}`
    expect(pay.status).toBe('RECEIVED')
    expect(pay.paid_at).not.toBeNull()
    const [{ count }] = await sql`
      select count(*)::int as count from payments where asaas_payment_id = ${payId}`
    expect(count).toBe(1)
  })
})

describe('evento PRESO (crash entre inbox e espelho) — retry reprocessa', () => {
  it('inbox com processed_at NULL: o replay do Asaas completa o espelho com o payload ORIGINAL', async () => {
    const c = await createPrivateContract(sql)
    const e = evt({}, { externalReference: c.contractId, value: 450.0 })
    // Simula o crash: inbox gravada, processamento nunca aconteceu.
    await sql`
      insert into webhook_inbox (source, event_id, payload)
      values ('asaas', ${e.id}, ${sql.json(e)})`

    // Retry chega com payload FORJADO — o reprocessamento usa o ORIGINAL (first-write-wins).
    const forged = { ...e, payment: { ...e.payment, value: 1.0 } }
    const r = await call(forged)
    expect(r.status).toBe(200)

    const [pay] = await sql`
      select amount_cents from payments where asaas_payment_id = ${e.payment.id}`
    expect(pay.amount_cents).toBe(45000)
    const [inbox] = await sql`
      select processed_at from webhook_inbox where event_id = ${e.id}`
    expect(inbox.processed_at).not.toBeNull()
  })
})

describe('paid_at vem do contrato REAL do Asaas (paymentDate)', () => {
  it('meio-dia de São Paulo — nunca vira o dia anterior em Cuiabá (Lei 1)', async () => {
    const c = await createPrivateContract(sql)
    const e = evt({}, { externalReference: c.contractId, paymentDate: '2026-09-04' })
    await call(e)
    const [pay] = await sql`
      select (paid_at at time zone 'America/Cuiaba')::date::text as local_date
      from payments where asaas_payment_id = ${e.payment.id}`
    expect(pay.local_date).toBe('2026-09-04')
  })

  it('data não parseável não derruba o handler: paid_at NULL e evento processado', async () => {
    const c = await createPrivateContract(sql)
    const e = evt({}, { externalReference: c.contractId, paymentDate: 'lixo' })
    expect((await call(e)).status).toBe(200)
    const [pay] = await sql`
      select paid_at from payments where asaas_payment_id = ${e.payment.id}`
    expect(pay.paid_at).toBeNull()
  })
})

describe('robustez', () => {
  it('payload sem id de evento → 400; evento não-PAYMENT vai à inbox e para lá', async () => {
    expect((await call({ event: 'PAYMENT_RECEIVED' })).status).toBe(400)

    const e = evt({ event: 'SUBSCRIPTION_UPDATED' })
    expect((await call(e)).status).toBe(200)
    const [row] = await sql`select error from webhook_inbox where event_id = ${e.id}`
    expect(row.error).toContain('ignorado')
  })
})

// F8/M11-3 — fallback do externalReference para AULA avulsa (ponto único):
// a extra cobrada evolui para "paga" quando o dinheiro cai.
describe('F8/M11-3: externalReference de AULA avulsa', () => {
  it('pagamento confirmado quita a avulsa (single_paid_at); evento sem quitação só registra', async () => {
    const c = await createPrivateContract(sql)
    const [aula] = await sql`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot,
         state, single_kind, single_price_cents)
      values (${c.contractId}, ${c.teacherId}, now() + interval '72 hours',
              now() + interval '73 hours', 'avulsa F8', 'scheduled', 'extra_paid', 15000)
      returning id`

    // evento SEM pagamento confirmado → nada de quitação
    const pendente = evt({ event: 'PAYMENT_CREATED' }, { externalReference: aula.id, status: 'PENDING' })
    expect((await call(pendente)).status).toBe(200)
    let [row] = await sql`select single_paid_at from class_instances where id = ${aula.id}`
    expect(row.single_paid_at).toBeNull()

    // confirmou → paga
    const pago = evt({}, { externalReference: aula.id, status: 'RECEIVED', paymentDate: '2026-09-04' })
    expect((await call(pago)).status).toBe(200)
    ;[row] = await sql`select single_paid_at from class_instances where id = ${aula.id}`
    expect(row.single_paid_at).not.toBeNull()

    // aula NÃO-avulsa referenciada → nada muda e o rastro explica
    const normal = await createInstanceRef(c)
    const errado = evt({}, { externalReference: normal, status: 'RECEIVED', paymentDate: '2026-09-04' })
    expect((await call(errado)).status).toBe(200)
    const [n] = await sql`select single_paid_at from class_instances where id = ${normal}`
    expect(n.single_paid_at).toBeNull()
  })
})

async function createInstanceRef(c: { contractId: string; teacherId: string }): Promise<string> {
  const [r] = await sql`
    insert into class_instances
      (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
    values (${c.contractId}, ${c.teacherId}, now() + interval '90 hours',
            now() + interval '91 hours', 'normal F8')
    returning id`
  return r.id as string
}
