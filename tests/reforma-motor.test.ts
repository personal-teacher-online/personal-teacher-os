// Reforma "do zero" (17/07/2026) — motor novo da migration 20260717000100:
// complete_class (desfecho positivo em 1 clique) + leituras consolidadas
// (contract_credit_summary, admin_student_directory, admin_mentorship_overview)
// + campos novos (students.level, teachers.cpf/contract_kind).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createInstance,
  createPrivateContract,
  daysFromToday,
  sweepStaleMentorshipFixtures,
} from './helpers/db'

let sql: Sql
let admin: SupabaseClient
let student: SupabaseClient

beforeAll(async () => {
  sql = connect(3)
  // admin_mentorship_overview é lida INTEIRA aqui (.find pelo contract_id): sem a
  // varredura, as fixtures acumuladas estouram o teto de 1000 linhas do PostgREST.
  await sweepStaleMentorshipFixtures(sql)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin reforma'), 'admin')
  student = await clientAs(await createAuthUser(sql, 'student', 'Aluno reforma'), 'student')
})
afterAll(async () => {
  await sql.end()
})

describe('complete_class', () => {
  it('marca aula passada scheduled como completed e audita', async () => {
    const c = await createPrivateContract(sql)
    const inst = await createInstance(sql, c, { startsInHours: -2 })
    // D2 (20/07): registro de realizada exige apontamento — tema avulso aqui
    const { error } = await admin.rpc('complete_class', { p_instance: inst, p_off_kind: 'outro', p_off_note: 'teste' })
    expect(error).toBeNull()
    const [row] = await sql`select state from class_instances where id = ${inst}`
    expect(row.state).toBe('completed')
    const [audit] = await sql`
      select diff from audit_log
      where action = 'complete_class' and entity_id = ${inst}::text`
    expect(audit.diff.to).toBe('completed')
  })

  it('recusa aula futura e aula que já tem desfecho', async () => {
    const c = await createPrivateContract(sql)
    const futura = await createInstance(sql, c, { startsInHours: 48 })
    const fut = await admin.rpc('complete_class', { p_instance: futura })
    expect(fut.error?.message).toContain('ainda não começou')

    const passada = await createInstance(sql, c, { startsInHours: -3 })
    await admin.rpc('no_show_student', { p_instance: passada })
    const dup = await admin.rpc('complete_class', { p_instance: passada })
    expect(dup.error?.message).toContain('já tem desfecho')
  })

  it('só admin registra (aluno é recusado)', async () => {
    const c = await createPrivateContract(sql)
    const inst = await createInstance(sql, c, { startsInHours: -1 })
    const { error } = await student.rpc('complete_class', { p_instance: inst })
    expect(error?.message).toContain('administração')
    const [row] = await sql`select state from class_instances where id = ${inst}`
    expect(row.state).toBe('scheduled')
  })
})

describe('contract_credit_summary', () => {
  it('devolve saldo derivado + próxima validade por contrato (invoker/RLS)', async () => {
    const c = await createPrivateContract(sql)
    await admin.rpc('admin_makeup_adjust', {
      p_contract: c.contractId,
      p_delta: 2,
      p_expires_on: daysFromToday(30),
      p_note: 'fixture do teste',
    })
    // filtro no PostgREST: sem ele, >1000 contratos acumulados truncam a lista
    const { data, error } = await admin.rpc('contract_credit_summary').eq('contract_id', c.contractId)
    expect(error).toBeNull()
    const row = (data as { contract_id: string; balance: number; next_expiry: string | null }[]).find(
      (r) => r.contract_id === c.contractId,
    )
    expect(row?.balance).toBe(2)
    expect(row?.next_expiry).toBe(daysFromToday(30))
  })
})

describe('admin_student_directory', () => {
  it('devolve o aluno com contratos agregados; aluno comum é recusado', async () => {
    const c = await createPrivateContract(sql)
    await sql`update students set level = 'B2', city = 'Cuiabá' where id = ${c.studentId}`
    const { data, error } = await admin.rpc('admin_student_directory', { p_student: c.studentId })
    expect(error).toBeNull()
    const row = (data as { id: string; level: string | null; contracts: { contract_id: string; contract_type: string }[] }[])[0]
    expect(row.level).toBe('B2')
    expect(row.contracts.some((k) => k.contract_id === c.contractId && k.contract_type === 'private_1on1')).toBe(true)

    const negado = await student.rpc('admin_student_directory')
    expect(negado.error?.message).toContain('administração')
  })
})

describe('admin_mentorship_overview', () => {
  it('sinaliza threshold_missing sem engolir a exceção em silêncio', async () => {
    // contrato de mentoria SEM régua configurada → can_book nulo + flag acesa
    const c = await createPrivateContract(sql)
    const [row] = await sql`
      insert into contracts (contract_type, student_id, plan_name, hourly_rate_cents, started_on)
      values ('mentorship', ${c.studentId}, 'PT teste', 7000, current_date)
      returning id`
    await sql`
      insert into mentorship_contracts (contract_id, course_start_date)
      values (${row.id}, current_date - interval '3 months')`
    // F10/M6-1: o trigger de semeadura pode ter herdado defaults globais de
    // testes paralelos — este caso exige régua VAZIA (threshold_missing)
    await sql`delete from mentorship_window_rules where contract_id = ${row.id}`
    const { data, error } = await admin.rpc('admin_mentorship_overview')
    expect(error).toBeNull()
    const ov = (data as { contract_id: string; unlocked: number; can_book: boolean | null; threshold_missing: boolean }[]).find(
      (r) => r.contract_id === row.id,
    )
    expect(ov?.threshold_missing).toBe(true)
    expect(ov?.can_book).toBeNull()
    expect(ov?.unlocked).toBeGreaterThanOrEqual(1)
  })
})

describe('campos novos de cadastro', () => {
  it('students.level valida CEFR; teachers ganha cpf/contract_kind', async () => {
    const c = await createPrivateContract(sql)
    await expect(sql`update students set level = 'Z9' where id = ${c.studentId}`).rejects.toThrow()
    await sql`update teachers set cpf = '123', contract_kind = 'PJ' where id = ${c.teacherId}`
    const [t] = await sql`select cpf, contract_kind from teachers where id = ${c.teacherId}`
    expect(t.cpf).toBe('123')
    expect(t.contract_kind).toBe('PJ')
  })
})
