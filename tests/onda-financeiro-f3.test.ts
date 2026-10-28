// F3 (Onda Financeiro, PLAN-APPROVED) — o encanamento do pagador:
//   · webhook grava payer STUB (name = asaas_customer_id) + vínculo TERCEIRO
//     (só contrato individual) + payments.payer_id, tudo pela RPC transacional
//     única `espelhar_pagamento`;
//   · payer_id NUNCA regride a null (evento sem customer preserva);
//   · `invoice_url` volta à payments_student com as DUAS guardas na view:
//     origem asaas.com E posse do CHAMADOR com relationship=self — inclui o
//     caso do casal (A paga, B do mesmo contrato NÃO vê o link);
//   · promoção a self é RPC auditada, com no máximo UM self por aluno;
//   · replay converge sem SQL manual (a RPC é idempotente).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { handleAsaasWebhook } from '../src/lib/webhooks/asaas'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createPrivateContract, createTeacher } from './helpers/db'

const TOKEN = 'tok-teste-f3'
let sql: Sql
const service = serviceClient()

beforeAll(() => {
  sql = connect(4)
})
afterAll(async () => {
  await sql.end()
})

function evt(payment: Record<string, unknown> = {}) {
  return {
    id: 'evt_f3_' + crypto.randomUUID().slice(0, 12),
    event: 'PAYMENT_RECEIVED',
    payment: {
      id: 'pay_f3_' + crypto.randomUUID().slice(0, 12),
      value: 450.0,
      status: 'RECEIVED',
      dueDate: '2026-09-05',
      billingType: 'BOLETO',
      invoiceUrl: 'https://sandbox.asaas.com/i/f3teste',
      ...payment,
    },
  }
}

async function call(payload: unknown) {
  return handleAsaasWebhook(service, { token: TOKEN, expectedToken: TOKEN, payload })
}

describe('F3 — o webhook grava o pagador (stub + vínculo + espelho, uma transação)', () => {
  it('customer no payload → payer stub (name = cus id), payments.payer_id e vínculo TERCEIRO', async () => {
    const c = await createPrivateContract(sql)
    const cus = 'cus_f3_' + crypto.randomUUID().slice(0, 8)
    const e = evt({ externalReference: c.contractId, customer: cus })
    const r = await call(e)
    expect(r.status).toBe(200)
    expect(r.body.detail).toBeUndefined()

    const [payer] = await sql`select id, name from payers where asaas_customer_id = ${cus}`
    expect(payer).toBeDefined()
    expect(payer.name).toBe(cus) // stub auto-detectável (lote do F4 enriquece)

    const [pay] = await sql`
      select payer_id from payments where asaas_payment_id = ${e.payment.id}`
    expect(pay.payer_id).toBe(payer.id)

    const [vinc] = await sql`
      select relationship from student_payers
       where student_id = ${c.studentId} and payer_id = ${payer.id}`
    expect(vinc.relationship).toBe('terceiro') // NUNCA self por inferência
  })

  it('evento seguinte SEM customer preserva o payer_id (nunca regride a null)', async () => {
    const c = await createPrivateContract(sql)
    const cus = 'cus_f3_' + crypto.randomUUID().slice(0, 8)
    const payId = 'pay_f3_' + crypto.randomUUID().slice(0, 8)
    await call(evt({ id: payId, externalReference: c.contractId, customer: cus }))
    // o mesmo pagamento, atualizado por um evento sem o campo customer
    await call(evt({ id: payId, externalReference: c.contractId, status: 'REFUNDED' }))

    const [pay] = await sql`
      select p.status, py.asaas_customer_id
        from payments p join payers py on py.id = p.payer_id
       where p.asaas_payment_id = ${payId}`
    expect(pay.status).toBe('REFUNDED') // o update aconteceu…
    expect(pay.asaas_customer_id).toBe(cus) // …sem apagar o pagador
  })

  it('contrato de GRUPO: payer e payer_id sim, auto-vínculo NÃO (grupo não aponta UM aluno)', async () => {
    const teacherId = await createTeacher(sql)
    const [grupo] = await sql`insert into student_groups (label) values ('Casal F3') returning id`
    const [c] = await sql`
      insert into contracts
        (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${grupo.id}, ${teacherId}, 'Casal F3', 15000, 2, 24, 30, current_date)
      returning id`
    const cus = 'cus_f3_' + crypto.randomUUID().slice(0, 8)
    const e = evt({ externalReference: c.id, customer: cus })
    await call(e)

    const [payer] = await sql`select id from payers where asaas_customer_id = ${cus}`
    const [pay] = await sql`select payer_id from payments where asaas_payment_id = ${e.payment.id}`
    expect(pay.payer_id).toBe(payer.id)
    const vincs = await sql`select 1 from student_payers where payer_id = ${payer.id}`
    expect(vincs).toHaveLength(0)
  })

  it('replay converge: a RPC é idempotente (1 payer, 1 vínculo, espelho atualizado)', async () => {
    const c = await createPrivateContract(sql)
    const cus = 'cus_f3_' + crypto.randomUUID().slice(0, 8)
    const payId = 'pay_f3_' + crypto.randomUUID().slice(0, 8)
    const args = {
      p_asaas_payment_id: payId,
      p_contract_id: c.contractId,
      p_customer: cus,
      p_amount_cents: 45000,
      p_status: 'PENDING',
      p_due_date: '2026-09-05',
      p_paid_at: null,
      p_billing_type: 'BOLETO',
      p_reference_ym: '2026-09',
      p_raw: {},
    }
    for (let i = 0; i < 3; i++) {
      const { error } = await service.rpc('espelhar_pagamento', args)
      expect(error).toBeNull()
    }
    const payers = await sql`select 1 from payers where asaas_customer_id = ${cus}`
    expect(payers).toHaveLength(1)
    const vincs = await sql`
      select 1 from student_payers sp join payers py on py.id = sp.payer_id
       where py.asaas_customer_id = ${cus}`
    expect(vincs).toHaveLength(1)
    const pays = await sql`select 1 from payments where asaas_payment_id = ${payId}`
    expect(pays).toHaveLength(1)
  })
})

describe('F3 — self × terceiro (promoção auditada, 1 self por aluno)', () => {
  it('admin promove a self com trilha de→para; o SEGUNDO self do mesmo aluno é recusado', async () => {
    const admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F3'), 'admin')
    const c = await createPrivateContract(sql)
    const [p1] = await sql`insert into payers (name) values ('Pagador F3 A') returning id`
    const [p2] = await sql`insert into payers (name) values ('Pagador F3 B') returning id`
    await sql`insert into student_payers (student_id, payer_id)
              values (${c.studentId}, ${p1.id}), (${c.studentId}, ${p2.id})`

    const ok = await admin.rpc('admin_set_payer_relationship', {
      p_student: c.studentId, p_payer: p1.id, p_relationship: 'self',
    })
    expect(ok.error).toBeNull()
    const trilha = await sql`
      select 1 from audit_log where action = 'set_payer_relationship'
       and entity_id = ${c.studentId + ':' + p1.id}`
    expect(trilha).toHaveLength(1)

    const segundo = await admin.rpc('admin_set_payer_relationship', {
      p_student: c.studentId, p_payer: p2.id, p_relationship: 'self',
    })
    expect(segundo.error).not.toBeNull() // student_payers_one_self

    // vínculo inexistente é recusa nomeada, não upsert silencioso
    const fantasma = await admin.rpc('admin_set_payer_relationship', {
      p_student: c.studentId, p_payer: crypto.randomUUID(), p_relationship: 'self',
    })
    expect(fantasma.error?.message).toContain('não existe')
  })

  it('um PAGADOR é self de no máximo UM aluno (Sol P1: cadastro não é duas pessoas)', async () => {
    const admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F3 SelfUnico'), 'admin')
    const c1 = await createPrivateContract(sql)
    const c2 = await createPrivateContract(sql)
    const [payer] = await sql`insert into payers (name) values ('Pagador F3 Compartilhado') returning id`
    await sql`insert into student_payers (student_id, payer_id)
              values (${c1.studentId}, ${payer.id}), (${c2.studentId}, ${payer.id})`

    const primeiro = await admin.rpc('admin_set_payer_relationship', {
      p_student: c1.studentId, p_payer: payer.id, p_relationship: 'self',
    })
    expect(primeiro.error).toBeNull()
    const segundo = await admin.rpc('admin_set_payer_relationship', {
      p_student: c2.studentId, p_payer: payer.id, p_relationship: 'self',
    })
    expect(segundo.error).not.toBeNull() // student_payers_one_student_per_self_payer
  })

  it('desvincular passa pela RPC auditada — e registra QUAL relationship morreu', async () => {
    const admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F3 Unlink'), 'admin')
    const c = await createPrivateContract(sql)
    const [payer] = await sql`insert into payers (name) values ('Pagador F3 Unlink') returning id`
    await sql`insert into student_payers (student_id, payer_id, relationship)
              values (${c.studentId}, ${payer.id}, 'self')`

    const ok = await admin.rpc('admin_unlink_payer', {
      p_student: c.studentId, p_payer: payer.id,
    })
    expect(ok.error).toBeNull()
    const trilha = await sql`
      select diff from audit_log where action = 'unlink_payer'
       and entity_id = ${c.studentId + ':' + payer.id}`
    expect(trilha).toHaveLength(1)
    expect((trilha[0].diff as { relationship_removido: string }).relationship_removido).toBe('self')

    const fantasma = await admin.rpc('admin_unlink_payer', {
      p_student: c.studentId, p_payer: payer.id,
    })
    expect(fantasma.error?.message).toContain('não existe')
  })

  it('falha na ESCRITA do espelho deixa a inbox RE-TENTÁVEL (Sol P1: processed_at nulo)', async () => {
    const c = await createPrivateContract(sql)
    // amount estoura o int4 do banco → a RPC transacional falha e nada grava
    const e = evt({ externalReference: c.contractId, value: 99_999_999_999.99 })
    const r1 = await call(e)
    expect(r1.status).toBe(200) // Lei 6: erro de escrita nunca vira 4xx/5xx
    expect(r1.body.detail).toContain('espelho payments falhou')

    const [inbox] = await sql`
      select processed_at, error from webhook_inbox
       where source = 'asaas' and event_id = ${e.id}`
    expect(inbox.error).toContain('espelho payments falhou')
    expect(inbox.processed_at).toBeNull() // ← o retry vai reprocessar INTEIRA

    // a redelivery NÃO é ignorada como "replay": ela re-tenta o payload original
    const r2 = await call(e)
    expect(r2.body.detail).toContain('espelho payments falhou')
    expect(r2.body.detail).not.toContain('replay ignorado')
  })

  it('aluno não executa as portas do encanamento', async () => {
    const aluno = await clientAs(await createAuthUser(sql, 'student', 'Aluno F3 ACL'), 'student')
    const c = await createPrivateContract(sql)
    const rel = await aluno.rpc('admin_set_payer_relationship', {
      p_student: c.studentId, p_payer: crypto.randomUUID(), p_relationship: 'self',
    })
    expect(rel.error).not.toBeNull()
    const esp = await aluno.rpc('espelhar_pagamento', {
      p_asaas_payment_id: 'x', p_contract_id: c.contractId, p_customer: null,
      p_amount_cents: 1, p_status: 's', p_due_date: null, p_paid_at: null,
      p_billing_type: null, p_reference_ym: null, p_raw: {},
    })
    expect(esp.error).not.toBeNull()
  })
})

describe('F3 — o botão da fatura: as duas guardas DENTRO da view', () => {
  /** Contrato individual + payment espelhado com customer; devolve os ids. */
  async function cenario(invoiceUrl: string) {
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', 'Aluno F3 Fatura')
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    const cus = 'cus_f3_' + crypto.randomUUID().slice(0, 8)
    const e = evt({ externalReference: c.contractId, customer: cus, invoiceUrl })
    await call(e)
    return { ...c, userId, cus, paymentId: e.payment.id as string }
  }

  it('TERCEIRO (default) → sem link; promovido a SELF → o link aparece', async () => {
    const cen = await cenario('https://www.asaas.com/i/f3ok')
    const aluno = await clientAs(cen.userId, 'student')

    const antes = await aluno
      .from('payments_student').select('invoice_url').eq('id', await idLocal(cen.paymentId))
    expect(antes.data![0].invoice_url).toBeNull()

    await sql`update student_payers set relationship = 'self'
              where student_id = ${cen.studentId}`
    const depois = await aluno
      .from('payments_student').select('invoice_url').eq('id', await idLocal(cen.paymentId))
    expect(depois.data![0].invoice_url).toBe('https://www.asaas.com/i/f3ok')
  })

  it('origem fora do asaas.com → null, mesmo com self', async () => {
    const cen = await cenario('https://evil.example.com/i/f3')
    await sql`update student_payers set relationship = 'self'
              where student_id = ${cen.studentId}`
    const aluno = await clientAs(cen.userId, 'student')
    const r = await aluno
      .from('payments_student').select('invoice_url').eq('id', await idLocal(cen.paymentId))
    expect(r.data![0].invoice_url).toBeNull()
  })

  it('CASAL: A (self, pagador) vê o link; B, do MESMO contrato, não vê', async () => {
    const teacherId = await createTeacher(sql)
    const [grupo] = await sql`insert into student_groups (label) values ('Casal F3 Fatura') returning id`
    const userA = await createAuthUser(sql, 'student', 'F3 Casal A')
    const userB = await createAuthUser(sql, 'student', 'F3 Casal B')
    const [a] = await sql`insert into students (display_name, iana_tz, tz_confirmed, profile_id)
                          values ('F3 Casal A', 'America/Cuiaba', true, ${userA}) returning id`
    const [b] = await sql`insert into students (display_name, iana_tz, tz_confirmed, profile_id)
                          values ('F3 Casal B', 'America/Cuiaba', true, ${userB}) returning id`
    await sql`insert into student_group_members (group_id, student_id)
              values (${grupo.id}, ${a.id}), (${grupo.id}, ${b.id})`
    const [c] = await sql`
      insert into contracts
        (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${grupo.id}, ${teacherId}, 'Casal F3F', 15000, 2, 24, 30, current_date)
      returning id`
    const cus = 'cus_f3_' + crypto.randomUUID().slice(0, 8)
    const e = evt({ externalReference: c.id, customer: cus, invoiceUrl: 'https://www.asaas.com/i/casal' })
    await call(e)
    // A é quem paga: vínculo self de A com o pagador (ato manual simulado)
    const [payer] = await sql`select id from payers where asaas_customer_id = ${cus}`
    await sql`insert into student_payers (student_id, payer_id, relationship)
              values (${a.id}, ${payer.id}, 'self')`

    const idPag = await idLocal(e.payment.id as string)
    const daA = await clientAs(userA, 'student').then((cl) =>
      cl.from('payments_student').select('invoice_url').eq('id', idPag))
    expect(daA.data![0].invoice_url).toBe('https://www.asaas.com/i/casal')

    const daB = await clientAs(userB, 'student').then((cl) =>
      cl.from('payments_student').select('invoice_url').eq('id', idPag))
    expect(daB.data![0].invoice_url).toBeNull()
  })
})

/** id local (uuid) de um pagamento espelhado, pela chave natural do Asaas. */
async function idLocal(asaasPaymentId: string): Promise<string> {
  const [r] = await sql`select id from payments where asaas_payment_id = ${asaasPaymentId}`
  return r.id as string
}
