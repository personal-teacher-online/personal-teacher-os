// F0 (onda Financeiro, PLAN-APPROVED 07/08/2026) — LGPD como TESTE, não como
// nota: a anonimização do aluno atravessa `payers`/`student_payers` com um
// PAYMENT espelhado no meio (payer_id + raw com cadastro de terceiro), que é o
// estado que o F3 vai criar de verdade. O que se prova aqui:
//   1. pagador exclusivo COM cobrança (asaas_customer_id) → preservado 5 anos
//      (M11-4), e o espelho (payments + raw + FK payer_id) fica intacto;
//   2. pagador COMPARTILHADO com outro aluno → intocado (nem fiscal, nem scrub);
//   3. scrub (pagador sem Asaas) NÃO quebra FK nem apaga o espelho — e `raw`
//      NÃO é limpo (resíduo mapeado no goal doc: inalcançável pelos caminhos
//      de escrita reais, onde payer espelhado sempre tem asaas_customer_id);
//   4. a view do aluno (payments_student) segue sem raw/payer_id (minimização).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract, daysFromToday } from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(4)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F0 Financeiro'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/** Ex-aluno anonimizável: contrato encerrado + nome conhecido para a confirmação. */
async function exStudent(nome: string) {
  const c = await createPrivateContract(sql)
  await sql`update students set display_name = ${nome} where id = ${c.studentId}`
  await sql`update contracts set status = 'ended', ended_on = current_date where id = ${c.contractId}`
  return c
}

/** Espelho como o webhook grava (e como o F3 passará a gravar payer_id):
 *  raw carrega o cadastro do PAGADOR — exatamente o dado cuja retenção se prova. */
async function espelharPagamento(contractId: string, payerId: string | null) {
  const asaasId = 'pay_f0_' + crypto.randomUUID()
  const raw = {
    event: 'PAYMENT_RECEIVED',
    payment: {
      id: asaasId,
      customer: 'cus_f0_teste',
      customerName: 'Terceiro Da Silva',
      customerCpfCnpj: '12345678900',
      invoiceUrl: 'https://www.asaas.com/i/f0teste',
    },
  }
  const [p] = await sql`
    insert into payments (asaas_payment_id, payer_id, contract_id, amount_cents,
                          status, due_date, paid_at, raw)
    values (${asaasId}, ${payerId}, ${contractId}, 15000, 'RECEIVED',
            ${daysFromToday(-5)}, now(), ${sql.json(raw)})
    returning id`
  return p.id as string
}

describe('F0 — anonimização × pagador com cobrança espelhada', () => {
  it('pagador exclusivo COM Asaas: preservado 5 anos; payment, raw e vínculo intactos', async () => {
    const f = await exStudent('Aluno F0 Fiscal')
    const [payer] = await sql`
      insert into payers (name, email, cpf_cnpj, asaas_customer_id)
      values ('Terceiro Da Silva', 'terceiro@x.com', '12345678900', 'cus_f0_' || gen_random_uuid())
      returning id`
    await sql`insert into student_payers (student_id, payer_id) values (${f.studentId}, ${payer.id})`
    const paymentId = await espelharPagamento(f.contractId, payer.id)

    const { data, error } = await admin.rpc('admin_anonymize_student', {
      p_student: f.studentId, p_confirm: 'Aluno F0 Fiscal',
    })
    expect(error).toBeNull()
    expect((data as { payers_fiscal: number }).payers_fiscal).toBe(1)

    // Retenção fiscal (M11-4): cadastro do pagador E espelho ficam por 5 anos.
    const [py] = await sql`select name, email, cpf_cnpj from payers where id = ${payer.id}`
    expect(py.name).toBe('Terceiro Da Silva')
    expect(py.cpf_cnpj).toBe('12345678900')
    const [pm] = await sql`
      select payer_id, raw -> 'payment' ->> 'customerName' as nome_no_raw
      from payments where id = ${paymentId}`
    expect(pm.payer_id).toBe(payer.id)
    expect(pm.nome_no_raw).toBe('Terceiro Da Silva')
    const vinculo = await sql`
      select 1 from student_payers where student_id = ${f.studentId} and payer_id = ${payer.id}`
    expect(vinculo).toHaveLength(1)
  })

  it('pagador COMPARTILHADO com outro aluno: intocado (nem fiscal, nem scrub)', async () => {
    const f = await exStudent('Aluno F0 Casal')
    const outro = await createPrivateContract(sql)
    const [payer] = await sql`
      insert into payers (name, email) values ('Pagador Do Casal', 'casal@x.com')
      returning id`
    await sql`insert into student_payers (student_id, payer_id)
              values (${f.studentId}, ${payer.id}), (${outro.studentId}, ${payer.id})`

    const { data, error } = await admin.rpc('admin_anonymize_student', {
      p_student: f.studentId, p_confirm: 'Aluno F0 Casal',
    })
    expect(error).toBeNull()
    const r = data as { payers_fiscal: number; payers_scrubbed: number }
    expect(r.payers_fiscal).toBe(0)
    expect(r.payers_scrubbed).toBe(0)
    const [py] = await sql`select name, email from payers where id = ${payer.id}`
    expect(py.name).toBe('Pagador Do Casal')
    expect(py.email).toBe('casal@x.com')
  })

  it('scrub (sem Asaas) não quebra FK nem apaga o espelho; raw não é limpo (resíduo mapeado)', async () => {
    const f = await exStudent('Aluno F0 Scrub')
    const [payer] = await sql`
      insert into payers (name, email, cpf_cnpj)
      values ('Pagadora Sem Asaas', 'sem@x.com', '12345678900')
      returning id`
    await sql`insert into student_payers (student_id, payer_id) values (${f.studentId}, ${payer.id})`
    const paymentId = await espelharPagamento(f.contractId, payer.id)

    const { data, error } = await admin.rpc('admin_anonymize_student', {
      p_student: f.studentId, p_confirm: 'Aluno F0 Scrub',
    })
    expect(error).toBeNull()
    expect((data as { payers_scrubbed: number }).payers_scrubbed).toBe(1)

    const [py] = await sql`select name, email, cpf_cnpj from payers where id = ${payer.id}`
    expect(py.name).toBe('Pagador removido')
    expect(py.email).toBeNull()
    expect(py.cpf_cnpj).toBeNull()
    // A linha do espelho sobrevive com a FK de pé — e o raw NÃO é tocado.
    const [pm] = await sql`
      select payer_id, raw -> 'payment' ->> 'customerName' as nome_no_raw
      from payments where id = ${paymentId}`
    expect(pm.payer_id).toBe(payer.id)
    expect(pm.nome_no_raw).toBe('Terceiro Da Silva')
  })

  it('payments_student segue sem raw e sem payer_id (minimização — F3 só pode somar invoice_url)', async () => {
    const cols = await sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'payments_student'`
    const nomes = cols.map((c) => c.column_name as string)
    expect(nomes).not.toContain('raw')
    expect(nomes).not.toContain('payer_id')
  })
})
