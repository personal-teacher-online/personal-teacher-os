import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { connect, createMentorshipContract, createSession } from './helpers/db'

let sql: Sql

beforeAll(() => {
  sql = connect(5)
})
afterAll(async () => {
  await sql.end()
})

async function canBook(contractId: string): Promise<boolean> {
  const [row] = await sql`select public.mentorship_can_book(${contractId}) as ok`
  return row.ok as boolean
}
async function unlocked(contractId: string): Promise<number> {
  const [row] = await sql`select public.mentorship_windows_unlocked(${contractId}) as n`
  return row.n as number
}
async function nextWindow(contractId: string): Promise<number> {
  const [row] = await sql`select public.mentorship_next_window(${contractId}) as n`
  return row.n as number
}

describe('destravamento computado (D3, Lei 2)', () => {
  it('caso 15: course_start_date nulo → can_book false (0 janelas)', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: null,
      thresholds: { 1: 10 },
      completionPct: 100,
    })
    expect(await unlocked(m.contractId)).toBe(0)
    expect(await canBook(m.contractId)).toBe(false)
  })

  it('primeiro crédito destrava no início do curso (D3)', async () => {
    const m = await createMentorshipContract(sql, { courseStartMonthsAgo: 0 })
    expect(await unlocked(m.contractId)).toBe(1)
  })

  it('caso 19: início há 5 meses + 1 gasto → 3 janelas destravadas; próxima etapa = 2', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 5,
      thresholds: { 1: 10, 2: 40 },
      completionPct: 50,
    })
    const session = await createSession(sql)
    await sql`select public.book_mentorship_session(${session}, ${m.contractId})`
    expect(await unlocked(m.contractId)).toBe(3) // floor(5/2)+1
    expect(await nextWindow(m.contractId)).toBe(2)
  })

  it('caso 20: início há 13+ meses → cap em 6, nunca 7', async () => {
    const m = await createMentorshipContract(sql, { courseStartMonthsAgo: 13 })
    expect(await unlocked(m.contractId)).toBe(6)
  })
})

describe('escada de progresso (D2)', () => {
  it('caso 16: thresholds 10%/40%, progresso 30%, 0 gastos → pode reservar a 1ª', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 3,
      thresholds: { 1: 10, 2: 40 },
      completionPct: 30,
    })
    expect(await canBook(m.contractId)).toBe(true)
  })

  it('caso 17: após a 1ª reserva, etapa 2 exige 40% e progresso 30% → false', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 3, // 2 janelas destravadas
      thresholds: { 1: 10, 2: 40 },
      completionPct: 30,
    })
    const session = await createSession(sql)
    await sql`select public.book_mentorship_session(${session}, ${m.contractId})`
    expect(await canBook(m.contractId)).toBe(false)
  })

  it('caso 18: threshold da próxima etapa não configurado → exceção explícita, nunca libera', async () => {
    const semRegra = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 3,
      thresholds: {},
      completionPct: 100,
    })
    await expect(canBook(semRegra.contractId)).rejects.toThrow(
      /regras de progresso não configuradas/,
    )

    const regraNula = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 3,
      thresholds: { 1: null },
      completionPct: 100,
    })
    await expect(canBook(regraNula.contractId)).rejects.toThrow(
      /regras de progresso não configuradas/,
    )
  })

  it('contrato de mentoria pausado → can_book false (ADR-011)', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 3,
      thresholds: { 1: 10 },
      completionPct: 50,
    })
    expect(await canBook(m.contractId)).toBe(true)
    await sql`update contracts set status = 'paused' where id = ${m.contractId}`
    expect(await canBook(m.contractId)).toBe(false)
  })

  it('caso 21: fora da vigência (12m + carência vencida) → false, créditos inertes', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 16, // > 12m + 90d
      thresholds: { 1: 10 },
      completionPct: 100,
    })
    expect(await canBook(m.contractId)).toBe(false)
  })
})

describe('book_mentorship_session', () => {
  it('caso 22: sessão cheia recusa', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 3,
      thresholds: { 1: 10 },
      completionPct: 50,
    })
    const session = await createSession(sql, { capacity: 2, bookedCount: 2 })
    await expect(
      sql`select public.book_mentorship_session(${session}, ${m.contractId})`,
    ).rejects.toThrow(/lotada/)
  })

  it('sessão não-aberta recusa (scheduled/cancelled)', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 3,
      thresholds: { 1: 10 },
      completionPct: 50,
    })
    const session = await createSession(sql, { status: 'scheduled' })
    await expect(
      sql`select public.book_mentorship_session(${session}, ${m.contractId})`,
    ).rejects.toThrow(/não está aberta/)
  })

  it('caso 25: reserva atômica — ledger −1 com window_index, booked_count+1, booking, audit', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 3,
      thresholds: { 1: 10, 2: 40 },
      completionPct: 30,
    })
    const session = await createSession(sql, { capacity: 1 })
    const [res] = await sql`
      select public.book_mentorship_session(${session}, ${m.contractId}) as id`

    const ledger = await sql`
      select delta, reason, window_index, session_id
      from mentorship_credit_ledger where contract_id = ${m.contractId}`
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      delta: -1,
      reason: 'booking_spend',
      window_index: 1,
      session_id: session,
    })

    const [sess] = await sql`
      select booked_count, status from mentorship_sessions where id = ${session}`
    expect(sess.booked_count).toBe(1)
    expect(sess.status).toBe('full') // capacity 1 atingida

    const bookings = await sql`
      select student_id from mentorship_bookings where session_id = ${session}`
    expect(bookings).toHaveLength(1)
    expect(bookings[0].student_id).toBe(m.studentId)

    const audit = await sql`
      select * from audit_log
      where action = 'book_mentorship_session' and entity_id = ${res.id}::text`
    expect(audit).toHaveLength(1)
  })

  it('caso 24: mesmo aluno na mesma sessão 2x → violação de UNIQUE e rollback total', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 5, // 3 janelas: a 2ª reserva passa no gate de crédito
      thresholds: { 1: 10, 2: 40 },
      completionPct: 50,
    })
    const session = await createSession(sql, { capacity: 6 })
    await sql`select public.book_mentorship_session(${session}, ${m.contractId})`
    await expect(
      sql`select public.book_mentorship_session(${session}, ${m.contractId})`,
    ).rejects.toThrow(/duplicate key|unique/i)

    // atomicidade da falha: nada do 2º booking sobrou
    const spends = await sql`
      select count(*)::int as n from mentorship_credit_ledger
      where contract_id = ${m.contractId} and reason = 'booking_spend'`
    expect(spends[0].n).toBe(1)
    const [sess] = await sql`
      select booked_count from mentorship_sessions where id = ${session}`
    expect(sess.booked_count).toBe(1)
  })

  it('caso 23: concorrência — 2 contratos disputam a última vaga; exatamente um vence', async () => {
    const opts = {
      courseStartMonthsAgo: 3,
      thresholds: { 1: 10 },
      completionPct: 50,
    }
    const m1 = await createMentorshipContract(sql, opts)
    const m2 = await createMentorshipContract(sql, opts)
    const session = await createSession(sql, { capacity: 1 })

    const conn1 = connect(1)
    const conn2 = connect(1)
    try {
      const results = await Promise.allSettled([
        conn1`select public.book_mentorship_session(${session}, ${m1.contractId})`,
        conn2`select public.book_mentorship_session(${session}, ${m2.contractId})`,
      ])
      const ok = results.filter((r) => r.status === 'fulfilled')
      const failed = results.filter((r) => r.status === 'rejected')
      expect(ok).toHaveLength(1)
      expect(failed).toHaveLength(1)
      // O perdedor é recusado por lotação — pela contagem ('lotada') ou porque o
      // vencedor já flipou o status para 'full'; ambas são a mesma recusa.
      expect((failed[0] as PromiseRejectedResult).reason.message).toMatch(
        /lotada|status: full/,
      )

      const [sess] = await sql`
        select booked_count, capacity from mentorship_sessions where id = ${session}`
      expect(sess.booked_count).toBe(1) // nunca acima da capacidade
    } finally {
      await conn1.end()
      await conn2.end()
    }
  })

  it('ledger de mentoria é append-only', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 3,
      thresholds: { 1: 10 },
      completionPct: 50,
    })
    const session = await createSession(sql)
    await sql`select public.book_mentorship_session(${session}, ${m.contractId})`
    await expect(
      sql`delete from mentorship_credit_ledger where contract_id = ${m.contractId}`,
    ).rejects.toThrow(/append-only/)
    await expect(
      sql`insert into mentorship_credit_ledger (contract_id, student_id, delta, reason)
          values (${m.contractId}, ${m.studentId}, 1, 'accrual_window')`,
    ).rejects.toThrow(/check/i) // Lei 2: acúmulo nunca materializado
  })
})
