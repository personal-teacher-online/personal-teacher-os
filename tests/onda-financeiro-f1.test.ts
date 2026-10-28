// F1 (Onda Financeiro, PLAN-APPROVED) — a view `payments_admin`:
//   1. PARIDADE: a coluna `situacao` da view = `payment_situacao(...)` linha a
//      linha, incluindo os casos que a régua TS da tela velha ERRAVA
//      (`RECEIVED_IN_CASH_UNDONE` com paid_at preenchido saía "paga");
//   2. BADGE imune à paginação: o count de vencidas conta na VIEW, acima de
//      qualquer limit de lista (seed de 120 > limite de 100 da tela);
//   3. ACL: aluno e professora leem ZERO linhas (security_invoker + RLS de
//      payments, que só tem policy de admin) — mesmo o aluno DONO do contrato
//      da cobrança; anon não tem grant e recebe erro.
//      ⚠️ ACL local é falso-verde para o default privilege de produção — a
//      prova final é a sonda na janela de deploy (comentário da migration).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { anonClient, clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract, daysFromToday } from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(4)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F1 Financeiro'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

async function inserirCobranca(
  contractId: string,
  opts: { status: string; due: string; paidAt?: string | null; prefixo?: string },
) {
  const [row] = await sql`
    insert into payments (asaas_payment_id, contract_id, amount_cents, status, due_date, paid_at, reference_ym, raw)
    values (${(opts.prefixo ?? 'f1-pay-') + crypto.randomUUID()}, ${contractId}, 15000,
            ${opts.status}, ${opts.due}, ${opts.paidAt ?? null}, ${opts.due.slice(0, 7)}, '{}')
    returning id`
  return row.id as string
}

describe('F1 — payments_admin: paridade com a régua do banco', () => {
  it('situacao/em_atraso da view = payment_situacao, caso a caso — inclusive os que a tela velha errava', async () => {
    const c = await createPrivateContract(sql)
    const casos: { status: string; due: string; paidAt?: string | null }[] = [
      // O DEFEITO DE ORIGEM: baixa manual desfeita, paid_at ainda preenchido.
      // A tela velha (`!!paid_at → paga`) mentia "paga"; o banco diz em_atraso.
      { status: 'RECEIVED_IN_CASH_UNDONE', due: daysFromToday(-10), paidAt: new Date().toISOString() },
      // Estornada com paid_at: a tela velha também dizia "paga".
      { status: 'REFUNDED', due: daysFromToday(-30), paidAt: new Date().toISOString() },
      { status: 'PENDING', due: daysFromToday(10) },
      { status: 'OVERDUE', due: daysFromToday(-3) },
      // Negativação NÃO é recebimento (rodada 2 da 20260728000800).
      { status: 'DUNNING_RECEIVED', due: daysFromToday(-5) },
      { status: 'CHARGEBACK_DISPUTE', due: daysFromToday(-2) },
      { status: 'RECEIVED', due: daysFromToday(-1), paidAt: new Date().toISOString() },
    ]
    const ids: string[] = []
    for (const caso of casos) ids.push(await inserirCobranca(c.contractId, caso))

    const { data, error } = await admin
      .from('payments_admin')
      .select('id, status, situacao, em_aberto, em_atraso, nao_cobravel, pagante')
      .in('id', ids)
    expect(error).toBeNull()
    expect(data).toHaveLength(casos.length)

    for (const linha of data!) {
      const [esperado] = await sql`
        select public.payment_situacao(p.status, p.paid_at, p.due_date) as situacao,
               public.payment_em_aberto(p.status, p.paid_at) as em_aberto,
               public.payment_nao_cobravel(p.status) as nao_cobravel
        from payments p where id = ${linha.id}`
      expect(linha.situacao).toBe(esperado.situacao)
      expect(linha.em_aberto).toBe(esperado.em_aberto)
      expect(linha.nao_cobravel).toBe(esperado.nao_cobravel)
    }

    const porStatus = new Map(data!.map((l) => [l.status as string, l]))
    // As duas mentiras da tela velha, mortas nominalmente:
    expect(porStatus.get('RECEIVED_IN_CASH_UNDONE')!.situacao).toBe('em_atraso')
    expect(porStatus.get('REFUNDED')!.situacao).toBe('estornada')
    expect(porStatus.get('DUNNING_RECEIVED')!.situacao).toBe('em_atraso')
    expect(porStatus.get('RECEIVED')!.situacao).toBe('paga')
    // em_atraso só nas vozes de pé com vencimento passado:
    expect(porStatus.get('OVERDUE')!.em_atraso).toBe(true)
    expect(porStatus.get('PENDING')!.em_atraso).toBe(false)
    expect(porStatus.get('CHARGEBACK_DISPUTE')!.em_atraso).toBe(false)
    // quem paga = o aluno do contrato individual
    expect(porStatus.get('RECEIVED')!.pagante).toBeTruthy()
  })

  it('badge de vencidas conta na VIEW — 120 vencidas > o limite de 100 da lista', async () => {
    const c = await createPrivateContract(sql)
    // Prefixo ÚNICO por rodada (Sol, rodada 1): sem ele, rodar a suíte de novo
    // sem reset acumularia 240 e o toBe(120) flakearia.
    const prefixo = `f1-badge-${crypto.randomUUID().slice(0, 8)}-`
    for (let i = 0; i < 120; i++) {
      await inserirCobranca(c.contractId, {
        status: 'PENDING',
        due: daysFromToday(-2),
        prefixo,
      })
    }
    const { count, error } = await admin
      .from('payments_admin')
      .select('id', { count: 'exact', head: true })
      .eq('em_atraso', true)
      .like('asaas_payment_id', `${prefixo}%`)
    expect(error).toBeNull()
    expect(count).toBe(120)

    // A LISTA corta em 100 (comportamento da tela); o badge não pode herdar o corte.
    const lista = await admin
      .from('payments_admin')
      .select('id')
      .eq('em_atraso', true)
      .like('asaas_payment_id', `${prefixo}%`)
      .limit(100)
    expect(lista.data).toHaveLength(100)
  })
})

describe('F1 — ACL da view (security_invoker + RLS de payments)', () => {
  it('aluno NÃO lê a view — nem a cobrança do PRÓPRIO contrato', async () => {
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', 'Aluno F1 ACL')
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    const pagamentoId = await inserirCobranca(c.contractId, {
      status: 'PENDING',
      due: daysFromToday(5),
    })

    const aluno = await clientAs(userId, 'student')
    const daView = await aluno.from('payments_admin').select('id').eq('id', pagamentoId)
    expect(daView.error).toBeNull()
    expect(daView.data).toHaveLength(0)

    // O contraste que prova que o zero é ACL, não ausência de dado: a MESMA
    // cobrança chega ao aluno pela view DELE (payments_student).
    const daSua = await aluno.from('payments_student').select('id').eq('id', pagamentoId)
    expect(daSua.error).toBeNull()
    expect(daSua.data).toHaveLength(1)
  })

  it('professora lê zero linhas; anon não tem nem grant', async () => {
    const professora = await clientAs(await createAuthUser(sql, 'teacher', 'Prof F1 ACL'), 'teacher')
    const daProf = await professora.from('payments_admin').select('id').limit(1)
    expect(daProf.error).toBeNull()
    expect(daProf.data).toHaveLength(0)

    const anon = anonClient()
    const doAnon = await anon.from('payments_admin').select('id').limit(1)
    expect(doAnon.error).not.toBeNull()
  })
})
