// Núcleo 4/5 / N1 — record_class_audit (N45-D1): casos 1–5 do goal.
// A escrita em class_audits é SÓ via RPC (privilégios revogados na 20260714000200);
// as policies de LEITURA são as da F1 (class_audits_teacher + admin_all) —
// os casos 2/3 são guarda de REGRESSÃO, não policy nova.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createPrivateContract, createInstance } from './helpers/db'

let sql: Sql
let admin: SupabaseClient
let service: SupabaseClient

beforeAll(async () => {
  sql = connect(3)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin auditoria'), 'admin')
  service = serviceClient()
})
afterAll(async () => {
  await sql.end()
})

/** Instância no PASSADO (auditável): começou há 3h, durou 45min. */
async function pastInstance(c: { contractId: string; teacherId: string }): Promise<string> {
  return createInstance(sql, c, { startsInHours: -3 })
}

describe('record_class_audit (caso 1, 4, 5)', () => {
  it('caso 1: grava e RE-grava (upsert) — resultado anterior no audit_log, UNIQUE respeitado', async () => {
    const c = await createPrivateContract(sql)
    const inst = await pastInstance(c)

    const first = await admin.rpc('record_class_audit', {
      p_class_instance: inst,
      p_checklist: { greeting: true, homework: false },
      p_passed: false,
      p_model: 'claude-haiku-4-5',
    })
    expect(first.error).toBeNull()

    const second = await admin.rpc('record_class_audit', {
      p_class_instance: inst,
      p_checklist: { greeting: true, homework: true },
      p_passed: true,
      p_audited_duration_min: 44,
      p_model: 'claude-haiku-4-5',
    })
    expect(second.error).toBeNull()
    // upsert: mesma linha substituída, nunca uma segunda
    expect(second.data).toBe(first.data)

    const rows = await sql`
      select passed, audited_duration_min from class_audits where class_instance_id = ${inst}`
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ passed: true, audited_duration_min: 44 })

    // Lei 8: a re-auditoria carrega o resultado substituído
    const audits = await sql`
      select diff from audit_log
      where action = 'record_class_audit' and entity_id = ${first.data}::text
      order by id`
    expect(audits).toHaveLength(2)
    expect(audits[0].diff.previous).toBeNull()
    expect(audits[1].diff.previous.passed).toBe(false)
  })

  it('caso 4: instância cancelled, rescheduled ou futura → exceção', async () => {
    const c = await createPrivateContract(sql)

    const cancelled = await pastInstance(c)
    await sql`update class_instances set state = 'cancelled' where id = ${cancelled}`
    const r1 = await admin.rpc('record_class_audit', {
      p_class_instance: cancelled, p_checklist: {}, p_passed: true,
    })
    expect(r1.error?.message).toMatch(/não auditável/)

    const rescheduled = await pastInstance(c)
    await sql`update class_instances set state = 'rescheduled' where id = ${rescheduled}`
    const r2 = await admin.rpc('record_class_audit', {
      p_class_instance: rescheduled, p_checklist: {}, p_passed: true,
    })
    expect(r2.error?.message).toMatch(/não auditável/)

    const future = await createInstance(sql, c, { startsInHours: 48 })
    const r3 = await admin.rpc('record_class_audit', {
      p_class_instance: future, p_checklist: {}, p_passed: true,
    })
    expect(r3.error?.message).toMatch(/ainda não terminou/)
  })

  it('C5: aula com falta da PROFESSORA (no_show_teacher) é auditável', async () => {
    const c = await createPrivateContract(sql)
    const inst = await pastInstance(c)
    await sql`update class_instances set state = 'no_show_teacher' where id = ${inst}`
    const { error } = await admin.rpc('record_class_audit', {
      p_class_instance: inst,
      p_checklist: { teacher_present: false },
      p_passed: false,
    })
    expect(error).toBeNull()
  })

  it('caso 5: teacher/student não gravam; service_role e admin gravam', async () => {
    const c = await createPrivateContract(sql)
    const inst = await pastInstance(c)
    const payload = { p_class_instance: inst, p_checklist: {}, p_passed: true }

    const teacher = await clientAs(await createAuthUser(sql, 'teacher', 'Prof audita'), 'teacher')
    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno audita'), 'student')
    expect((await teacher.rpc('record_class_audit', payload)).error?.message).toMatch(/restrita/)
    expect((await student.rpc('record_class_audit', payload)).error?.message).toMatch(/restrita/)

    expect((await service.rpc('record_class_audit', payload)).error).toBeNull()
    expect((await admin.rpc('record_class_audit', payload)).error).toBeNull()
  })
})

describe('leitura de class_audits — regressão do RLS da F1 (casos 2 e 3)', () => {
  it('caso 2: professora lê auditoria da PRÓPRIA aula; da de outra, zero', async () => {
    const cA = await createPrivateContract(sql)
    const cB = await createPrivateContract(sql)
    const instA = await pastInstance(cA)
    const instB = await pastInstance(cB)
    await service.rpc('record_class_audit', { p_class_instance: instA, p_checklist: {}, p_passed: true })
    await service.rpc('record_class_audit', { p_class_instance: instB, p_checklist: {}, p_passed: true })

    const profileA = await createAuthUser(sql, 'teacher', 'Professora A')
    await sql`update teachers set profile_id = ${profileA} where id = ${cA.teacherId}`
    const teacherA = await clientAs(profileA, 'teacher')

    const { data, error } = await teacherA
      .from('class_audits')
      .select('class_instance_id')
      .in('class_instance_id', [instA, instB])
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].class_instance_id).toBe(instA)
  })

  it('caso 3: aluno e sales veem zero linhas', async () => {
    const c = await createPrivateContract(sql)
    const inst = await pastInstance(c)
    await service.rpc('record_class_audit', { p_class_instance: inst, p_checklist: {}, p_passed: true })

    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno RLS'), 'student')
    const sales = await clientAs(await createAuthUser(sql, 'sales', 'Sales RLS'), 'sales')
    for (const client of [student, sales]) {
      const { data, error } = await client
        .from('class_audits')
        .select('id')
        .eq('class_instance_id', inst)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    }
  })

  it('escrita direta por JWT (mesmo admin) é barrada em privilégio — só a RPC escreve', async () => {
    const c = await createPrivateContract(sql)
    const inst = await pastInstance(c)
    const { error } = await admin
      .from('class_audits')
      .insert({ class_instance_id: inst, checklist: {}, passed: true })
    expect(error?.message).toMatch(/permission denied/)
  })
})
