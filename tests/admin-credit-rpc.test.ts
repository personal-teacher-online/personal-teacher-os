// Fase 2 / M2 — admin_makeup_adjust (crédito manual via UI, D8/D10).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract, daysFromToday } from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(3)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin crédito'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

describe('admin_makeup_adjust', () => {
  it('+N com validade cria N entradas manual_adjust e devolve o saldo novo', async () => {
    const c = await createPrivateContract(sql)
    const { data, error } = await admin.rpc('admin_makeup_adjust', {
      p_contract: c.contractId,
      p_delta: 3,
      p_expires_on: daysFromToday(45),
      p_note: 'acordo com a família',
    })
    expect(error).toBeNull()
    expect(data).toBe(3)
    const [{ count }] = await sql`
      select count(*)::int as count from makeup_ledger
      where contract_id = ${c.contractId} and reason = 'manual_adjust' and delta = 1`
    expect(count).toBe(3)
    const [audit] = await sql`
      select diff from audit_log
      where action = 'admin_makeup_adjust' and entity_id = ${c.contractId}::text`
    expect(audit.diff.note).toBe('acordo com a família')
  })

  it('crédito positivo SEM expires_on é recusado; -N além do saldo estoura e nada persiste', async () => {
    const c = await createPrivateContract(sql)
    const noExp = await admin.rpc('admin_makeup_adjust', {
      p_contract: c.contractId, p_delta: 1, p_note: 'teste',
    })
    expect(noExp.error?.message).toContain('expires_on')

    await admin.rpc('admin_makeup_adjust', {
      p_contract: c.contractId, p_delta: 1, p_expires_on: daysFromToday(30), p_note: 'teste',
    })
    const over = await admin.rpc('admin_makeup_adjust', {
      p_contract: c.contractId, p_delta: -2, p_note: 'teste',
    })
    expect(over.error?.message).toContain('saldo')
    const [bal] = await sql`select public.makeup_balance(${c.contractId}) as b`
    expect(Number(bal.b)).toBe(1) // o -2 reverteu inteiro (transação única)
  })

  it('F1/M3-5: ajuste sem motivo é recusado; duração informada fica no ledger', async () => {
    const c = await createPrivateContract(sql)
    const semMotivo = await admin.rpc('admin_makeup_adjust', {
      p_contract: c.contractId, p_delta: 1, p_expires_on: daysFromToday(30),
    })
    expect(semMotivo.error?.message).toContain('motivo')

    const { error } = await admin.rpc('admin_makeup_adjust', {
      p_contract: c.contractId, p_delta: 1, p_expires_on: daysFromToday(30),
      p_note: 'aula de 60 min perdida', p_duration_min: 60,
    })
    expect(error).toBeNull()
    const [row] = await sql`
      select duration_min, note from makeup_ledger
      where contract_id = ${c.contractId} and delta = 1 order by id desc limit 1`
    expect(row.duration_min).toBe(60)
    expect(row.note).toBe('aula de 60 min perdida')
  })

  it('D10: aluno não ajusta crédito', async () => {
    const c = await createPrivateContract(sql)
    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno crédito'), 'student')
    const { error } = await student.rpc('admin_makeup_adjust', {
      p_contract: c.contractId, p_delta: 1, p_expires_on: daysFromToday(30),
    })
    expect(error?.message).toContain('D10')
  })
})
