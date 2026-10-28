// Fase 3 / M4 — extrato da professora (F3-D3 + Q2). Casos 27–30 do goal.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createStudent, createTeacher } from './helpers/db'

let sql: Sql
let adminUser: string

beforeAll(async () => {
  sql = connect(2)
  adminUser = await createAuthUser(sql, 'admin', 'Admin M4 extrato')
})
afterAll(async () => {
  await sql.end()
})

// Período PASSADO fixo (business_today real ≈ jul/2026): junho/2026.
const JUN = { start: '2026-06-01', end: '2026-06-30' }
const JUL_START = '2026-07-01'

async function newTeacherWithContract(): Promise<{ teacherId: string; contractId: string }> {
  const teacherId = await createTeacher(sql) // hourly_rate_cents = 10000
  const studentId = await createStudent(sql)
  const [c] = await sql`
    insert into contracts
      (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents, status,
       monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
    values ('private_1on1', ${studentId}, ${teacherId}, 'M4 extrato', 15000, 'active',
            4, 24, 90, '2026-01-05')
    returning id`
  return { teacherId, contractId: c.id as string }
}

/** Aula de 1h em 2026-06-DD 12:00 Cuiabá (16:00Z) com estado dado. */
async function juneClass(contractId: string, teacherId: string, day: number, state: string): Promise<string> {
  const dd = String(day).padStart(2, '0')
  const [row] = await sql`
    insert into class_instances (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot, state)
    values (${contractId}, ${teacherId}, ${`2026-06-${dd}T16:00:00Z`}, ${`2026-06-${dd}T17:00:00Z`},
            ${'m4 ' + dd}, ${state})
    returning id`
  return row.id as string
}

describe('caso 27: período misto — horas e total exatos (régua da Q2)', () => {
  it('pagam scheduled-no-passado + completed + no_show_student; nunca os demais', async () => {
    const { teacherId, contractId } = await newTeacherWithContract()
    await juneClass(contractId, teacherId, 1, 'scheduled') // paga (passado)
    await juneClass(contractId, teacherId, 2, 'completed') // paga
    await juneClass(contractId, teacherId, 3, 'no_show_student') // paga (Q2!)
    await juneClass(contractId, teacherId, 4, 'no_show_teacher') // NÃO
    await juneClass(contractId, teacherId, 5, 'cancelled') // NÃO
    await juneClass(contractId, teacherId, 8, 'rescheduled') // NÃO

    const admin = await clientAs(adminUser, 'admin')
    const { data: stId, error } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId,
      p_period_start: JUN.start,
      p_period_end: JUN.end,
    })
    expect(error).toBeNull()

    const [st] = await sql`
      select audited_hours, rate_cents, adjustments_cents, total_cents, status
      from teacher_statements where id = ${stId}`
    expect(Number(st.audited_hours)).toBe(3.0) // 3 aulas de 1h
    expect(st.rate_cents).toBe(10000)
    expect(st.total_cents).toBe(30000)
    expect(st.status).toBe('draft')

    // Ajuste manual com motivo (auditado); sem motivo → exceção.
    const adj = await admin.rpc('adjust_teacher_statement', {
      p_statement: stId, p_delta_cents: -5000, p_reason: 'desconto combinado',
    })
    expect(adj.error).toBeNull()
    const noReason = await admin.rpc('adjust_teacher_statement', {
      p_statement: stId, p_delta_cents: 100, p_reason: '  ',
    })
    expect(noReason.error?.message).toMatch(/MOTIVO/)

    const [st2] = await sql`select total_cents from teacher_statements where id = ${stId}`
    expect(st2.total_cents).toBe(25000)
    const [audit] = await sql`
      select diff from audit_log
      where action = 'adjust_teacher_statement' and entity_id = ${stId}::text`
    expect(audit.diff.motivo).toBe('desconto combinado')

    // Painel final: REGENERAR o mesmo período preserva o ajuste manual auditado
    // (parcela manual_adjustments_cents própria — o recálculo só refaz a retro).
    const regen = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUN.start, p_period_end: JUN.end,
    })
    expect(regen.error).toBeNull()
    const [st3] = await sql`
      select adjustments_cents, manual_adjustments_cents, total_cents
      from teacher_statements where id = ${stId}`
    expect(st3.manual_adjustments_cents).toBe(-5000)
    expect(st3.adjustments_cents).toBe(0) // sem divergência retro neste cenário
    expect(st3.total_cents).toBe(25000) // o desconto NÃO sumiu no regenerate
  })
})

describe('caso 28: fechado é IMUTÁVEL (trigger barra até admin/postgres)', () => {
  it('close → UPDATE/DELETE falham; fechar não-draft falha; D10 nega professora', async () => {
    const { teacherId, contractId } = await newTeacherWithContract()
    await juneClass(contractId, teacherId, 10, 'completed')
    const admin = await clientAs(adminUser, 'admin')
    const { data: stId } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUN.start, p_period_end: JUN.end,
    })
    const closed = await admin.rpc('close_teacher_statement', { p_statement: stId })
    expect(closed.error).toBeNull()

    await expect(
      sql`update teacher_statements set total_cents = 1 where id = ${stId}`,
    ).rejects.toThrow(/imutável|FECHADO/)
    await expect(
      sql`delete from teacher_statements where id = ${stId}`,
    ).rejects.toThrow(/imutável|FECHADO/)

    const again = await admin.rpc('close_teacher_statement', { p_statement: stId })
    expect(again.error?.message).toMatch(/não é draft/)
    const adj = await admin.rpc('adjust_teacher_statement', {
      p_statement: stId, p_delta_cents: 100, p_reason: 'tarde demais',
    })
    expect(adj.error?.message).toMatch(/não é draft/)

    // D10: papel teacher não gera/fecha/ajusta.
    const teacherClient = await clientAs(adminUser, 'teacher')
    const denied = await teacherClient.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUL_START, p_period_end: '2026-07-31',
    })
    expect(denied.error?.message).toMatch(/restrita à admin/)
  })
})

describe('caso 29: guardas de período', () => {
  it('fechar período ainda aberto → exceção; lacuna/sobreposição → exceção; sequência contígua fecha certo', async () => {
    const { teacherId, contractId } = await newTeacherWithContract()
    await juneClass(contractId, teacherId, 29, 'completed') // fim do período
    const admin = await clientAs(adminUser, 'admin')

    // Período que ainda não terminou no fuso do negócio → não fecha.
    const { data: openSt } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUN.start, p_period_end: '2099-12-31',
    })
    const tooSoon = await admin.rpc('close_teacher_statement', { p_statement: openSt })
    expect(tooSoon.error?.message).toMatch(/ENCERRADO/)
    await sql`delete from teacher_statements where id = ${openSt}` // draft: pode

    // Junho fechado; julho deve começar em 01/07 — lacuna e sobreposição falham.
    const { data: junSt } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUN.start, p_period_end: JUN.end,
    })
    await admin.rpc('close_teacher_statement', { p_statement: junSt })
    const [got] = await sql`select audited_hours from teacher_statements where id = ${junSt}`
    expect(Number(got.audited_hours)).toBe(1.0) // aula de 29/06 CONTADA (fim do período)

    const gap = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: '2026-07-05', p_period_end: '2026-07-31',
    })
    expect(gap.error?.message).toMatch(/lacuna|sobreposição/)
    const overlap = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: '2026-06-15', p_period_end: '2026-07-31',
    })
    expect(overlap.error).not.toBeNull() // contiguidade OU exclude constraint

    const ok = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUL_START, p_period_end: '2026-07-09',
    })
    expect(ok.error).toBeNull()
  })
})

describe('caso 30: correção retroativa (ADR-013 §3 prevalece)', () => {
  it('cancel retroativo em período FECHADO → snapshot intacto; próximo draft propõe ajuste no rate congelado', async () => {
    const { teacherId, contractId } = await newTeacherWithContract()
    const paidClass = await juneClass(contractId, teacherId, 15, 'scheduled')
    const admin = await clientAs(adminUser, 'admin')

    const { data: junSt } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUN.start, p_period_end: JUN.end,
    })
    await admin.rpc('close_teacher_statement', { p_statement: junSt })
    const [before] = await sql`
      select audited_hours, total_cents, rate_cents from teacher_statements where id = ${junSt}`
    expect(Number(before.audited_hours)).toBe(1.0)

    // O rate ATUAL muda (200/h) — o ajuste retroativo deve usar o CONGELADO (100/h).
    await sql`update teachers set hourly_rate_cents = 20000 where id = ${teacherId}`

    // Registro retroativo: a dona soube DEPOIS que o aluno avisou ANTES da aula.
    const cancel = await admin.rpc('cancel_class', {
      p_instance: paidClass,
      p_cancelled_by: 'student',
      p_notified_at: '2026-06-10T12:00:00Z',
    })
    expect(cancel.error).toBeNull()

    // Snapshot fechado: intacto byte a byte.
    const [after] = await sql`
      select audited_hours, total_cents, rate_cents, status from teacher_statements where id = ${junSt}`
    expect(after).toEqual({ ...before, status: 'closed' })

    // Próximo draft propõe o ajuste NEGATIVO no rate congelado, com referência.
    const { data: julSt, error } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUL_START, p_period_end: '2026-07-09',
    })
    expect(error).toBeNull()
    const [jul] = await sql`
      select adjustments_cents, total_cents from teacher_statements where id = ${julSt}`
    expect(jul.adjustments_cents).toBe(-10000) // 1h × rate CONGELADO (10000), não 20000

    const [audit] = await sql`
      select diff from audit_log
      where action = 'generate_teacher_statement' and entity_id = ${julSt}::text
      order by at desc limit 1`
    const retro = audit.diff.ajustes_retroativos[0]
    expect(retro.statement_id).toBe(junSt)
    expect(retro.delta_cents).toBe(-10000)
    expect(retro.instancias_nao_pagaveis_no_periodo).toContain(paidClass)
  })
})

describe('RLS: professora vê os próprios statements (policy da Fase 1, pino)', () => {
  it('teacher lê o seu; o de outra professora, zero', async () => {
    const { teacherId, contractId } = await newTeacherWithContract()
    await juneClass(contractId, teacherId, 20, 'completed')
    const admin = await clientAs(adminUser, 'admin')
    const { data: stId } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUN.start, p_period_end: JUN.end,
    })

    const ownerUser = await createAuthUser(sql, 'teacher', 'Prof M4 extrato')
    await sql`update teachers set profile_id = ${ownerUser} where id = ${teacherId}`
    const owner = await clientAs(ownerUser, 'teacher')
    const mine = await owner.from('teacher_statements').select('id').eq('id', stId)
    expect(mine.data).toHaveLength(1)

    const otherUser = await createAuthUser(sql, 'teacher', 'Prof M4 outra')
    const other = await clientAs(otherUser, 'teacher')
    const theirs = await other.from('teacher_statements').select('id').eq('id', stId)
    expect(theirs.data).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Painel final da Fase 3 — netting da compensação retroativa (achado CRÍTICO):
// a divergência de um statement FECHADO só é proposta pelo delta AINDA NÃO
// compensado em statements CLOSED (statement_retro_adjustments); as linhas do
// próprio draft são substituídas a cada recálculo.
// ---------------------------------------------------------------------------
describe('painel final (crítico): netting da compensação retroativa', () => {
  /** Junho FECHADO com n aulas 'scheduled' pagas (1h cada, rate 10000). */
  async function closedJuneWith(nClasses: number) {
    const { teacherId, contractId } = await newTeacherWithContract()
    const classes: string[] = []
    for (let i = 0; i < nClasses; i++) {
      classes.push(await juneClass(contractId, teacherId, 15 + i, 'scheduled'))
    }
    const admin = await clientAs(adminUser, 'admin')
    const { data: junSt } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUN.start, p_period_end: JUN.end,
    })
    const closed = await admin.rpc('close_teacher_statement', { p_statement: junSt })
    expect(closed.error).toBeNull()
    return { teacherId, contractId, classes, junSt: junSt as string, admin }
  }
  /** Cancelamento RETROATIVO com aviso prévio (mesmo roteiro do caso 30). */
  async function cancelRetro(admin: Awaited<ReturnType<typeof clientAs>>, instance: string) {
    const { error } = await admin.rpc('cancel_class', {
      p_instance: instance, p_cancelled_by: 'student', p_notified_at: '2026-06-10T12:00:00Z',
    })
    expect(error).toBeNull()
  }

  it('(a) compensação FECHADA não re-propõe: o draft seguinte nasce com ajuste zero', async () => {
    const { teacherId, classes, admin } = await closedJuneWith(1)
    await cancelRetro(admin, classes[0])

    const { data: julSt } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUL_START, p_period_end: '2026-07-09',
    })
    const [jul] = await sql`select adjustments_cents from teacher_statements where id = ${julSt}`
    expect(jul.adjustments_cents).toBe(-10000)
    const closed = await admin.rpc('close_teacher_statement', { p_statement: julSt })
    expect(closed.error).toBeNull() // a compensação foi PAGA aqui

    const { data: augSt, error } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: '2026-07-10', p_period_end: '2026-07-31',
    })
    expect(error).toBeNull()
    const [aug] = await sql`
      select adjustments_cents, total_cents from teacher_statements where id = ${augSt}`
    expect(aug.adjustments_cents).toBe(0) // NUNCA a compensação em dobro
    const [audit] = await sql`
      select diff from audit_log
      where action = 'generate_teacher_statement' and entity_id = ${augSt}::text
      order by at desc limit 1`
    expect(audit.diff.ajustes_retroativos).toEqual([])
  })

  it('(b) regenerar o MESMO draft 2× substitui as linhas de netting (nunca acumula)', async () => {
    const { teacherId, classes, admin } = await closedJuneWith(1)
    await cancelRetro(admin, classes[0])
    const gen = () => admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUL_START, p_period_end: '2026-07-09',
    })
    const { data: julSt } = await gen()
    await gen()
    await gen()
    const [jul] = await sql`select adjustments_cents from teacher_statements where id = ${julSt}`
    expect(jul.adjustments_cents).toBe(-10000) // e não -30000
    const [{ n }] = await sql`
      select count(*)::int as n from statement_retro_adjustments
      where applied_in_statement_id = ${julSt}`
    expect(n).toBe(1)
  })

  it('(c) segunda divergência no MESMO período fechado → só o delta incremental', async () => {
    const { teacherId, classes, admin } = await closedJuneWith(2) // junho fechado com 2h
    await cancelRetro(admin, classes[0])
    const { data: julSt } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUL_START, p_period_end: '2026-07-09',
    })
    const [jul] = await sql`select adjustments_cents from teacher_statements where id = ${julSt}`
    expect(jul.adjustments_cents).toBe(-10000)
    await admin.rpc('close_teacher_statement', { p_statement: julSt })

    await cancelRetro(admin, classes[1]) // mais 1h cancelada retroativamente
    const { data: augSt } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: '2026-07-10', p_period_end: '2026-07-31',
    })
    const [aug] = await sql`select adjustments_cents from teacher_statements where id = ${augSt}`
    expect(aug.adjustments_cents).toBe(-10000) // incremental — não -20000 de novo
    // Lei 8: o motivo auditado registra o quanto JÁ estava compensado.
    const [audit] = await sql`
      select diff from audit_log
      where action = 'generate_teacher_statement' and entity_id = ${augSt}::text
      order by at desc limit 1`
    expect(audit.diff.ajustes_retroativos[0].delta_cents).toBe(-10000)
    expect(audit.diff.ajustes_retroativos[0].ja_compensado_cents).toBe(-10000)
  })
})

// ---------------------------------------------------------------------------
// Painel final — DML de teacher_statements revogado: nem um JWT ADMIN via
// PostgREST fecha/insere statement por fora das RPCs (guardas + audit — Lei 3/8).
// ---------------------------------------------------------------------------
describe('painel final: teacher_statements só muda pelas RPCs (revoke de DML)', () => {
  it('UPDATE draft→closed e INSERT direto de admin via PostgREST → 42501; draft intacto', async () => {
    const { teacherId, contractId } = await newTeacherWithContract()
    await juneClass(contractId, teacherId, 12, 'completed')
    const admin = await clientAs(adminUser, 'admin')
    const { data: stId } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUN.start, p_period_end: JUN.end,
    })

    const upd = await admin
      .from('teacher_statements')
      .update({ status: 'closed', audited_hours: 99, total_cents: 999999 })
      .eq('id', stId)
      .select()
    expect(upd.error?.code).toBe('42501')
    const [still] = await sql`
      select status, total_cents from teacher_statements where id = ${stId}`
    expect(still.status).toBe('draft')
    expect(still.total_cents).toBe(10000)

    const ins = await admin.from('teacher_statements').insert({
      teacher_id: teacherId, period_start: '2026-09-01', period_end: '2026-09-30',
      audited_hours: 1, rate_cents: 1, total_cents: 1, status: 'closed',
    })
    expect(ins.error?.code).toBe('42501')
  })
})

// ---------------------------------------------------------------------------
// Painel final — pausa de contrato × extrato: 'scheduled' em janela de pausa é
// aula FANTASMA e nunca vira hora paga (F3-D10 + régua da 20260713000600).
// ---------------------------------------------------------------------------
describe('painel final: aula fantasma em janela de pausa nunca é paga', () => {
  it('draft ignora scheduled dentro da pausa; completed segue pagando', async () => {
    const { teacherId, contractId } = await newTeacherWithContract()
    await juneClass(contractId, teacherId, 10, 'scheduled') // dentro da pausa: fantasma
    await juneClass(contractId, teacherId, 20, 'completed') // fora da pausa: paga
    // Pausa FECHADA cobrindo 05–15/06 (injeção de datas, padrão fase3-pauses).
    await sql`insert into contract_pauses (contract_id, paused_on, resumed_on)
              values (${contractId}, '2026-06-05', '2026-06-15')`

    const admin = await clientAs(adminUser, 'admin')
    const { data: junSt, error } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUN.start, p_period_end: JUN.end,
    })
    expect(error).toBeNull()
    const [st] = await sql`
      select audited_hours, total_cents from teacher_statements where id = ${junSt}`
    expect(Number(st.audited_hours)).toBe(1.0)
    expect(st.total_cents).toBe(10000)
  })

  it('período CLOSED que pagou fantasma se autocorrige via retro quando a pausa entra', async () => {
    const { teacherId, contractId } = await newTeacherWithContract()
    await juneClass(contractId, teacherId, 10, 'scheduled')
    const admin = await clientAs(adminUser, 'admin')
    const { data: junSt } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUN.start, p_period_end: JUN.end,
    })
    await admin.rpc('close_teacher_statement', { p_statement: junSt }) // pagou 1h fantasma

    await sql`insert into contract_pauses (contract_id, paused_on, resumed_on)
              values (${contractId}, '2026-06-05', '2026-06-15')`
    const { data: julSt } = await admin.rpc('generate_teacher_statement', {
      p_teacher: teacherId, p_period_start: JUL_START, p_period_end: '2026-07-09',
    })
    const [jul] = await sql`select adjustments_cents from teacher_statements where id = ${julSt}`
    expect(jul.adjustments_cents).toBe(-10000) // desconto proposto no rate congelado
  })
})
