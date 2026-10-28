// F9 — Vigências de valor/hora (plano integrado v2, 18/07/2026; M12-7 + P12):
// valoração POR AULA no fuso do NEGÓCIO; só-futuro; retro ao valor da época;
// regenerate estável; fronteira de meia-noite.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract, createTeacher, daysFromToday } from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(4)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F9'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/** Aula COMPLETED com início na hora LOCAL Cuiabá da data dada (Lei 1 no SQL). */
async function pastClass(c: { contractId: string; teacherId: string }, dateISO: string, timeLocal: string, durMin = 60) {
  const [r] = await sql`
    insert into class_instances
      (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot, state)
    values (${c.contractId}, ${c.teacherId},
            (${dateISO}::date + ${timeLocal}::time) at time zone 'America/Cuiaba',
            ((${dateISO}::date + ${timeLocal}::time) at time zone 'America/Cuiaba')
              + make_interval(mins => ${durMin}),
            'fixture F9', 'completed')
    returning id`
  return r.id as string
}

async function addRateFixture(teacherId: string, validFrom: string, rateCents: number) {
  await sql`
    insert into teacher_rate_periods (teacher_id, valid_from, rate_cents)
    values (${teacherId}, ${validFrom}, ${rateCents})`
}

describe('M12-7 — só-futuro estrito (P12)', () => {
  it('vigência hoje/passado é RECUSADA; futura entra; futura pode sair; vigente não sai', async () => {
    const t = await createTeacher(sql)
    const hoje = await admin.rpc('admin_add_rate_period', {
      p_teacher: t, p_valid_from: daysFromToday(0), p_rate_cents: 12000,
    })
    expect(hoje.error?.message).toContain('passado')
    const ontem = await admin.rpc('admin_add_rate_period', {
      p_teacher: t, p_valid_from: daysFromToday(-3), p_rate_cents: 12000,
    })
    expect(ontem.error?.message).toContain('passado')

    const { data: id, error } = await admin.rpc('admin_add_rate_period', {
      p_teacher: t, p_valid_from: daysFromToday(5), p_rate_cents: 12000,
    })
    expect(error).toBeNull()
    const { error: rmErr } = await admin.rpc('admin_remove_rate_period', { p_id: id })
    expect(rmErr).toBeNull()

    // vigente (fixture retroativa de teste) não sai
    await addRateFixture(t, daysFromToday(-30), 9000)
    const [row] = await sql`
      select id from teacher_rate_periods where teacher_id = ${t} and rate_cents = 9000`
    const vigente = await admin.rpc('admin_remove_rate_period', { p_id: row.id })
    expect(vigente.error?.message).toContain('já em vigor')
  })
})

describe('M12-7/P12 — valoração por aula e fronteira de meia-noite', () => {
  it('cada aula paga pelo valor da SUA data civil (Cuiabá); 23:30 da véspera fica no valor velho', async () => {
    const c = await createPrivateContract(sql)
    await sql`update teachers set hourly_rate_cents = 10000 where id = ${c.teacherId}`
    const diaVelho = daysFromToday(-9)
    const diaNovo = daysFromToday(-8)
    // vigência FIXTURE começando em diaNovo (retroativa só no teste)
    await addRateFixture(c.teacherId, diaNovo, 20000)

    // 23:30 local da VÉSPERA (cruza meia-noite em UTC) → valor VELHO
    await pastClass(c, diaVelho, '23:30', 60)
    // 09:00 do dia da vigência → valor NOVO
    await pastClass(c, diaNovo, '09:00', 60)

    const [{ cents }] = await sql`
      select public._teacher_payable_cents(${c.teacherId}, ${diaVelho}::date, ${diaNovo}::date) as cents`
    expect(Number(cents)).toBe(10000 + 20000)

    // extrato POR AULA: total = base; regenerate = estável
    const { data: st1, error } = await admin.rpc('generate_teacher_statement', {
      p_teacher: c.teacherId, p_period_start: diaVelho, p_period_end: diaNovo,
    })
    expect(error).toBeNull()
    const { data: st2 } = await admin.rpc('generate_teacher_statement', {
      p_teacher: c.teacherId, p_period_start: diaVelho, p_period_end: diaNovo,
    })
    expect(st2).toBe(st1)
    const [row] = await sql`
      select total_cents, base_cents, audited_hours from teacher_statements where id = ${st1}`
    expect(row.total_cents).toBe(30000)
    expect(row.base_cents).toBe(30000)
    expect(Number(row.audited_hours)).toBe(2)
  })

  it('retro de período FECHADO usa o valor DA ÉPOCA (congelamento por construção)', async () => {
    const c = await createPrivateContract(sql)
    await sql`update teachers set hourly_rate_cents = 10000 where id = ${c.teacherId}`
    const d1 = daysFromToday(-9)
    const d2 = daysFromToday(-8)
    await pastClass(c, d1, '10:00', 60)

    const { data: stId } = await admin.rpc('generate_teacher_statement', {
      p_teacher: c.teacherId, p_period_start: d1, p_period_end: d1,
    })
    await admin.rpc('close_teacher_statement', { p_statement: stId })

    // valor SUBIU depois (fixture em d2); e uma aula ESQUECIDA de d1 aparece
    await addRateFixture(c.teacherId, d2, 30000)
    await pastClass(c, d1, '15:00', 60)

    const { data: st2, error } = await admin.rpc('generate_teacher_statement', {
      p_teacher: c.teacherId, p_period_start: d2, p_period_end: d2,
    })
    expect(error).toBeNull()
    const [row] = await sql`
      select adjustments_cents, total_cents, base_cents from teacher_statements where id = ${st2}`
    // o retro entra pelo valor DE d1 (10000), nunca pelo novo (30000)
    expect(row.adjustments_cents).toBe(10000)
    expect(row.base_cents).toBe(0) // d2 sem aulas
    expect(row.total_cents).toBe(10000)
  })
})
