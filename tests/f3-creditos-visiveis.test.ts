// F3 — Créditos visíveis (plano integrado v2, 18/07/2026): painel de
// vencimentos (M3-2), extensão com motivo via _reissue (P6) e a leitura do
// FIFO pelo aluno (M3-6/M2-2).
//
// 27/07/2026 (revisão adversarial nº 6, migration 20260727000100): o
// "reavivamento de vencidos" que este arquivo provava SAIU — ele inseria +1 sem
// consumir o vencido, que continua no replay do FIFO, e repetir a ação
// multiplicava o saldo. Extensão agora é só de crédito VIVO e só para FRENTE;
// devolver crédito já morto é ajuste manual, que é explícito.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract, daysFromToday } from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(4)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F3'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

async function addCredit(contractId: string, expiresOn: string, dur: number | null = 45) {
  const [r] = await sql`
    insert into makeup_ledger (contract_id, delta, reason, expires_on, duration_min)
    values (${contractId}, 1, 'manual_adjust', ${expiresOn}, ${dur})
    returning id`
  return Number(r.id)
}

describe('M3-2 — painel de vencimentos', () => {
  it('classifica vencendo (≤30) e vencido (últimos 30); fora da janela e pausado ficam de fora', async () => {
    const c = await createPrivateContract(sql)
    const vencendo = await addCredit(c.contractId, daysFromToday(10), 60)
    const vencido = await addCredit(c.contractId, daysFromToday(-5), 30)
    await addCredit(c.contractId, daysFromToday(60)) // fora da janela de 30
    const pausado = await createPrivateContract(sql)
    await addCredit(pausado.contractId, daysFromToday(10))
    await sql`update contracts set status = 'paused' where id = ${pausado.contractId}`

    const { data, error } = await admin.rpc('admin_credit_expiry_overview')
    expect(error).toBeNull()
    const rows = (data as { contract_id: string; ledger_id: number; situation: string; duration_min: number | null }[]).filter(
      (r) => r.contract_id === c.contractId || r.contract_id === pausado.contractId,
    )
    expect(rows).toHaveLength(2)
    const byLedger = new Map(rows.map((r) => [Number(r.ledger_id), r]))
    expect(byLedger.get(vencendo)?.situation).toBe('vencendo')
    expect(byLedger.get(vencendo)?.duration_min).toBe(60)
    expect(byLedger.get(vencido)?.situation).toBe('vencido')
  })

  it('D10: aluno não lê o painel', async () => {
    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno painel'), 'student')
    const { error } = await student.rpc('admin_credit_expiry_overview')
    expect(error?.message).toContain('D10')
  })
})

describe('M3-2 — estender validade (só crédito VIVO, e só para FRENTE)', () => {
  it('crédito vivo: par −1/+1 preserva duração; sem motivo recusa', async () => {
    const c = await createPrivateContract(sql)
    const id = await addCredit(c.contractId, daysFromToday(10), 60)
    const semMotivo = await admin.rpc('admin_extend_credit', {
      p_ledger: id, p_new_expires_on: daysFromToday(40),
    })
    expect(semMotivo.error?.message).toContain('motivo')

    const { data: novo, error } = await admin.rpc('admin_extend_credit', {
      p_ledger: id, p_new_expires_on: daysFromToday(40), p_note: 'viagem do aluno',
    })
    expect(error).toBeNull()
    const [row] = await sql`select duration_min, expires_on::text as e from makeup_ledger where id = ${novo}`
    expect(row.duration_min).toBe(60)
    expect(row.e).toBe(daysFromToday(40))
    const [bal] = await sql`select public.makeup_balance(${c.contractId}) as b`
    expect(Number(bal.b)).toBe(1)

    // Lei 8: a AÇÃO da tela tem linha própria na auditoria (não só o
    // 'reissue_credit' do helper), com a validade velha e a nova.
    const [auditoria] = await sql`
      select diff from audit_log
      where action = 'admin_extend_credit' and entity_id = ${String(novo)}`
    expect(auditoria).toBeTruthy()
    expect(auditoria.diff.old_expires_on).toBe(daysFromToday(10))
    expect(auditoria.diff.new_expires_on).toBe(daysFromToday(40))
  })

  // S1 da revisão adversarial nº 6 (grave, dinheiro): o ramo "vencido renasce
  // sem débito" inseria +1 SEM consumir o original — e o original vencido
  // continua no replay do FIFO. Repetir a ação somava crédito a cada clique.
  it('S1: crédito VENCIDO é RECUSADO, e repetir não move o saldo nem o ledger', async () => {
    const c = await createPrivateContract(sql)
    const id = await addCredit(c.contractId, daysFromToday(-5), 30)
    const [antes] = await sql`select public.makeup_balance(${c.contractId}) as b`
    expect(Number(antes.b)).toBe(0)

    for (const tentativa of [1, 2]) {
      const { error } = await admin.rpc('admin_extend_credit', {
        p_ledger: id, p_new_expires_on: daysFromToday(20), p_note: `acordo com a família ${tentativa}`,
      })
      expect(error?.message, `tentativa ${tentativa}`).toContain('crédito vencido não se estende')
    }

    const [depois] = await sql`select public.makeup_balance(${c.contractId}) as b`
    expect(Number(depois.b)).toBe(0)
    const [{ count }] = await sql`
      select count(*)::int as count from makeup_ledger where contract_id = ${c.contractId}`
    expect(count).toBe(1) // só a fixture: nenhuma linha nasceu das duas tentativas
  })

  // S2: "estender" que encurta não é estender.
  it('S2: validade nova anterior OU IGUAL à atual é recusada (monotônica)', async () => {
    const c = await createPrivateContract(sql)
    const id = await addCredit(c.contractId, daysFromToday(30), 45)

    for (const nova of [daysFromToday(20), daysFromToday(30)]) {
      const { error } = await admin.rpc('admin_extend_credit', {
        p_ledger: id, p_new_expires_on: nova, p_note: 'encurtar disfarçado',
      })
      expect(error?.message, nova).toContain('para FRENTE')
    }
    const [{ e }] = await sql`select expires_on::text as e from makeup_ledger where id = ${id}`
    expect(e).toBe(daysFromToday(30))
    const [{ count }] = await sql`
      select count(*)::int as count from makeup_ledger where contract_id = ${c.contractId}`
    expect(count).toBe(1)

    // e para FRENTE continua funcionando: par −1/+1, saldo intacto
    const { error } = await admin.rpc('admin_extend_credit', {
      p_ledger: id, p_new_expires_on: daysFromToday(31), p_note: 'um dia a mais',
    })
    expect(error).toBeNull()
    const [bal] = await sql`select public.makeup_balance(${c.contractId}) as b`
    expect(Number(bal.b)).toBe(1)
  })

  it('crédito já GASTO não é estensível', async () => {
    const c = await createPrivateContract(sql)
    const id = await addCredit(c.contractId, daysFromToday(10))
    await admin.rpc('admin_makeup_adjust', { p_contract: c.contractId, p_delta: -1, p_note: 'gasta' })
    const { error } = await admin.rpc('admin_extend_credit', {
      p_ledger: id, p_new_expires_on: daysFromToday(40), p_note: 'não deve dar',
    })
    expect(error?.message).toContain('já foi gasto')
  })
})

describe('M3-6/M2-2 — leitura do FIFO pelo aluno (RLS)', () => {
  it('aluno enxerga as entradas do PRÓPRIO contrato; contrato alheio devolve vazio', async () => {
    const c = await createPrivateContract(sql)
    await addCredit(c.contractId, daysFromToday(10), 60)
    const userId = await createAuthUser(sql, 'student', 'Aluno FIFO')
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    const student = await clientAs(userId, 'student')

    const meu = await student.rpc('_makeup_remaining_credits', { p_contract: c.contractId })
    expect(meu.error).toBeNull()
    expect((meu.data as unknown[]).length).toBe(1)

    const outro = await createPrivateContract(sql)
    await addCredit(outro.contractId, daysFromToday(10))
    const alheio = await student.rpc('_makeup_remaining_credits', { p_contract: outro.contractId })
    expect((alheio.data as unknown[]) ?? []).toHaveLength(0)
  })
})
