// Fase 2 / M1 — Matriz de cancelamento/no-show (D2) com expiração D11.
// Caso 10 do goal, linha a linha + sub-casos (fronteira exata, retrospectividade).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createInstance, createPrivateContract } from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin matriz'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

async function balance(contractId: string): Promise<number> {
  const [row] = await sql`select public.makeup_balance(${contractId}) as b`
  return Number(row.b)
}

async function instanceState(id: string): Promise<string> {
  const [r] = await sql`select state from class_instances where id = ${id}`
  return r.state as string
}

/** Expiração D11 esperada: data civil LOCAL da aula + prazo conforme a CAUSA
 *  (F1/M3-1: aluno-com-aviso → makeup_credit_expiry_days; escola falhou →
 *  school_fault_credit_expiry_days, default 180). */
async function expectedExpiry(
  instanceId: string,
  contractId: string,
  fault: 'student' | 'school' = 'student',
): Promise<string> {
  const [r] = await sql`
    select ((i.starts_at_utc at time zone s.iana_tz)::date
            + case when ${fault} = 'school' then c.school_fault_credit_expiry_days
                   else c.makeup_credit_expiry_days end)::text as exp
    from class_instances i
    join contracts c on c.id = ${contractId}
    join students s on s.id = c.student_id
    where i.id = ${instanceId}`
  return r.exp as string
}

async function ledgerExpiry(contractId: string): Promise<string | null> {
  const [r] = await sql`
    select expires_on::text as e from makeup_ledger
    where contract_id = ${contractId} and reason = 'earn_cancellation'
    order by id desc limit 1`
  return (r?.e as string) ?? null
}

describe('cancel_class — matriz D2 linha a linha', () => {
  it('professora cancela → aluno ganha crédito SEMPRE (mesmo dentro do aviso), com D11 exata', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 5 }) // dentro do aviso
    const { error } = await admin.rpc('cancel_class', {
      p_instance: inst,
      p_cancelled_by: 'teacher',
    })
    expect(error).toBeNull()
    expect(await instanceState(inst)).toBe('cancelled')
    expect(await balance(c.contractId)).toBe(1)
    // F1/M3-1: professora cancelou = culpa da escola → validade-180
    expect(await ledgerExpiry(c.contractId)).toBe(await expectedExpiry(inst, c.contractId, 'school'))
  })

  it('ADR-018: aluno cancela COM aviso → SEM crédito (o caminho com aviso é remarcar)', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    const { error } = await admin.rpc('cancel_class', {
      p_instance: inst,
      p_cancelled_by: 'student', // notified_at default now(): 72h > 24h de aviso
    })
    expect(error).toBeNull()
    expect(await instanceState(inst)).toBe('cancelled')
    expect(await balance(c.contractId)).toBe(0)
  })

  it('aluno cancela SEM aviso → perde a aula (sem crédito)', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 5 })
    const { error } = await admin.rpc('cancel_class', {
      p_instance: inst,
      p_cancelled_by: 'student',
    })
    expect(error).toBeNull()
    expect(await instanceState(inst)).toBe('cancelled')
    expect(await balance(c.contractId)).toBe(0)
  })

  it('ADR-018: nem a fronteira exata do aviso credita o aluno (antecedência é irrelevante)', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 24 })
    const [row] = await sql`
      select (starts_at_utc - interval '24 hours')::text as boundary
      from class_instances where id = ${inst}`
    const { error } = await admin.rpc('cancel_class', {
      p_instance: inst,
      p_cancelled_by: 'student',
      p_notified_at: row.boundary,
    })
    expect(error).toBeNull()
    expect(await instanceState(inst)).toBe('cancelled')
    expect(await balance(c.contractId)).toBe(0)
  })

  it('aula iniciada + aviso pós-início → manda usar no-show', async () => {
    const c = await createPrivateContract(sql)
    const inst = await createInstance(sql, c, { startsInHours: -2 })
    // notified_at default now() (depois do início): não é cancelamento, é falta.
    const { error } = await admin.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'teacher' })
    expect(error?.message).toContain('no_show')
    expect(await instanceState(inst)).toBe('scheduled')
  })

  it('registro RETROATIVO: aviso precedeu a aula → cancelamento vale mesmo após o início (D2), sem crédito (ADR-018)', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: -2 })
    const [row] = await sql`
      select (starts_at_utc - interval '48 hours')::text as notified
      from class_instances where id = ${inst}`
    const { error } = await admin.rpc('cancel_class', {
      p_instance: inst,
      p_cancelled_by: 'student',
      p_notified_at: row.notified, // avisou 48h antes; a dona registrou depois da aula
    })
    expect(error).toBeNull()
    expect(await instanceState(inst)).toBe('cancelled')
    expect(await balance(c.contractId)).toBe(0) // ADR-018: cancelamento do aluno nunca credita
  })

  it('notified_at no futuro é rejeitado; instância não-scheduled é rejeitada', async () => {
    const c = await createPrivateContract(sql)
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    const future = await admin.rpc('cancel_class', {
      p_instance: inst,
      p_cancelled_by: 'student',
      p_notified_at: new Date(Date.now() + 3600_000).toISOString(),
    })
    expect(future.error?.message).toContain('futuro')

    await admin.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'teacher' })
    const again = await admin.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'teacher' })
    expect(again.error?.message).toContain('não está agendada')
    expect(await balance(c.contractId)).toBe(1) // só o primeiro creditou
  })

  it('D10: aluno não invoca a matriz', async () => {
    const c = await createPrivateContract(sql)
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    const userId = await createAuthUser(sql, 'student', 'Aluno matriz')
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    const student = await clientAs(userId, 'student')

    for (const call of [
      student.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'teacher' }),
      student.rpc('no_show_teacher', { p_instance: inst }),
    ]) {
      const { error } = await call
      expect(error?.message).toContain('D10')
    }
    expect(await instanceState(inst)).toBe('scheduled')
    expect(await balance(c.contractId)).toBe(0)
  })
})

describe('no-show — retrospectivo por definição', () => {
  it('no_show_student: aluno perde; no_show_teacher: aluno ganha com D11 exata', async () => {
    const c = await createPrivateContract(sql)
    const instA = await createInstance(sql, c, { startsInHours: -3 })
    const { error: e1 } = await admin.rpc('no_show_student', { p_instance: instA })
    expect(e1).toBeNull()
    expect(await instanceState(instA)).toBe('no_show_student')
    expect(await balance(c.contractId)).toBe(0)

    const instB = await createInstance(sql, c, { startsInHours: -26 })
    const { error: e2 } = await admin.rpc('no_show_teacher', { p_instance: instB })
    expect(e2).toBeNull()
    expect(await instanceState(instB)).toBe('no_show_teacher')
    expect(await balance(c.contractId)).toBe(1)
    // F1/M3-1: professora faltou = culpa da escola → validade-180
    expect(await ledgerExpiry(c.contractId)).toBe(await expectedExpiry(instB, c.contractId, 'school'))
  })

  it('aula que ainda não começou não aceita no-show', async () => {
    const c = await createPrivateContract(sql)
    const inst = await createInstance(sql, c, { startsInHours: 48 })
    const { error } = await admin.rpc('no_show_student', { p_instance: inst })
    expect(error?.message).toContain('retrospectivo')
    expect(await instanceState(inst)).toBe('scheduled')
  })
})

describe('exposição (ADR-010 §2): internos revogados', () => {
  it('overload por instante e helpers internos → 42501 para authenticated', async () => {
    const c = await createPrivateContract(sql)
    const userId = await createAuthUser(sql, 'student', 'Aluno pino')
    const student = await clientAs(userId, 'student')

    const internal = await student.rpc('reschedule_class_at', {
      p_instance: c.contractId,
      p_new_starts_utc: new Date().toISOString(),
      p_new_snapshot: 'x',
    })
    expect(internal.error?.code).toBe('42501')

    const helper = await student.rpc('class_instance_tz', { p_instance: c.contractId })
    expect(helper.error?.code).toBe('42501')
  })
})
