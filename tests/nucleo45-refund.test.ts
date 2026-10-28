// Núcleo 4/5 / N1 — estorno de crédito de mentoria (N45-D3): casos 9–23 do goal.
// O índice mentorship_spend_window_uniq foi DERRUBADO: a unicidade da etapa é
// LÍQUIDA (spend − refund) e o advisory lock 'mentorship_book:'||contract é a
// ÚNICA defesa (adendo ADR-009) — os casos de concorrência atacam exatamente isso.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createMentorshipContract, createSession } from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin estorno'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/** Contrato elegível padrão: 2 janelas destravadas (3 meses), thresholds 10/40, pct 50. */
function eligibleOpts() {
  return { courseStartMonthsAgo: 3, thresholds: { 1: 10, 2: 40 }, completionPct: 50 }
}

async function book(sessionId: string, contractId: string): Promise<string> {
  const [row] = await sql`
    select public.book_mentorship_session(${sessionId}, ${contractId}) as id`
  return row.id as string
}

async function nextWindow(contractId: string): Promise<number> {
  const [row] = await sql`select public.mentorship_next_window(${contractId}) as n`
  return row.n as number
}

async function canBook(contractId: string): Promise<boolean> {
  const [row] = await sql`select public.mentorship_can_book(${contractId}) as ok`
  return row.ok as boolean
}

/** Gasto líquido por etapa (spend − refund), só etapas com movimento. */
async function netByWindow(contractId: string): Promise<Record<number, number>> {
  const rows = await sql`
    select window_index, sum(case when reason = 'booking_spend' then 1 else -1 end)::int as net
    from mentorship_credit_ledger
    where contract_id = ${contractId} and reason in ('booking_spend', 'refund')
    group by window_index`
  return Object.fromEntries(rows.map((r) => [r.window_index as number, r.net as number]))
}

async function refund(bookingId: string) {
  return admin.rpc('refund_mentorship_booking', { p_booking: bookingId })
}

async function cancelSession(sessionId: string) {
  return admin.rpc('cancel_mentorship_session', { p_session: sessionId })
}

describe('estorno avulso (casos 10, 11, 12, 17, 18)', () => {
  it('caso 10: reserva → estorno → RE-reserva da MESMA etapa (unicidade líquida)', async () => {
    const m = await createMentorshipContract(sql, eligibleOpts())
    const s1 = await createSession(sql)
    const s2 = await createSession(sql)

    const b1 = await book(s1, m.contractId)
    expect(await nextWindow(m.contractId)).toBe(2)

    const r = await refund(b1)
    expect(r.error).toBeNull()
    expect(await nextWindow(m.contractId)).toBe(1) // crédito voltou à etapa 1
    expect(await canBook(m.contractId)).toBe(true)

    await book(s2, m.contractId)
    expect(await netByWindow(m.contractId)).toEqual({ 1: 1 }) // 2 spends − 1 refund
    expect(await nextWindow(m.contractId)).toBe(2)
  })

  it('caso 11: estorno → mesmo aluno re-reserva a MESMA sessão; 2ª reserva ATIVA simultânea rejeitada', async () => {
    const m = await createMentorshipContract(sql, eligibleOpts())
    const s1 = await createSession(sql)

    const b1 = await book(s1, m.contractId)
    await refund(b1)
    const b2 = await book(s1, m.contractId) // mesma sessão, mesmo aluno — índice parcial permite

    // linha cancelada intacta, com FK composta válida (aponta o mesmo ledger de sempre)
    const [old] = await sql`
      select cancelled_at, ledger_id from mentorship_bookings where id = ${b1}`
    expect(old.cancelled_at).not.toBeNull()
    expect(old.ledger_id).not.toBeNull()

    // 2ª reserva ATIVA simultânea do mesmo aluno na mesma sessão → rejeitada.
    // (Elegibilidade não barra antes: etapa 2 destravada e progresso 50 ≥ 40.)
    await expect(book(s1, m.contractId)).rejects.toThrow(/duplicate key|unique/i)

    const [active] = await sql`
      select count(*)::int as n from mentorship_bookings
      where session_id = ${s1} and student_id = ${m.studentId} and cancelled_at is null`
    expect(active.n).toBe(1)
    expect(b2).not.toBe(b1)
  })

  it('caso 12: estorno 2× da mesma reserva → rejeitado', async () => {
    const m = await createMentorshipContract(sql, eligibleOpts())
    const s1 = await createSession(sql)
    const b1 = await book(s1, m.contractId)

    expect((await refund(b1)).error).toBeNull()
    const again = await refund(b1)
    expect(again.error?.message).toMatch(/já foi estornada/)
    expect(await netByWindow(m.contractId)).toEqual({ 1: 0 })
  })

  it('caso 17: sessão cheia (full) → estorno devolve a vaga (count E status) → outro aluno reserva', async () => {
    const m1 = await createMentorshipContract(sql, eligibleOpts())
    const m2 = await createMentorshipContract(sql, eligibleOpts())
    const s1 = await createSession(sql, { capacity: 1 })

    const b1 = await book(s1, m1.contractId)
    let [sess] = await sql`select status, booked_count from mentorship_sessions where id = ${s1}`
    expect(sess).toMatchObject({ status: 'full', booked_count: 1 })

    await refund(b1)
    ;[sess] = await sql`select status, booked_count from mentorship_sessions where id = ${s1}`
    expect(sess).toMatchObject({ status: 'open', booked_count: 0 })

    await book(s1, m2.contractId) // a vaga voltou de verdade
    ;[sess] = await sql`select status, booked_count from mentorship_sessions where id = ${s1}`
    expect(sess).toMatchObject({ status: 'full', booked_count: 1 })
  })

  it('caso 18: sessão done É estornável (C4, contador decrementa, status intacto); cancelled rejeita avulso', async () => {
    const m = await createMentorshipContract(sql, eligibleOpts())
    const done = await createSession(sql)
    const bDone = await book(done, m.contractId)
    await sql`update mentorship_sessions set status = 'done' where id = ${done}`

    expect((await refund(bDone)).error).toBeNull()
    const [after] = await sql`
      select status, booked_count from mentorship_sessions where id = ${done}`
    expect(after).toMatchObject({ status: 'done', booked_count: 0 })

    // "sessão cancelada com reserva ativa" é estado IMPOSSÍVEL por trigger
    // (painel N1); o caminho real é cancelar via RPC — o estorno avulso
    // posterior cai na recusa da sessão cancelada.
    const cancelled = await createSession(sql)
    const bCancelled = await book(cancelled, m.contractId)
    await cancelSession(cancelled)
    const r = await refund(bCancelled)
    expect(r.error?.message).toMatch(/cancelada/)
  })
})

describe('escada com buraco (casos 13, 14, 15)', () => {
  it('caso 13: cancel da sessão da etapa 1 → re-reserva preenche o buraco (exigindo o threshold da etapa 1); próxima = 3', async () => {
    const m = await createMentorshipContract(sql, eligibleOpts()) // 2 janelas destravadas
    const sA = await createSession(sql)
    const sB = await createSession(sql)
    await book(sA, m.contractId) // etapa 1
    await book(sB, m.contractId) // etapa 2

    expect((await cancelSession(sA)).error).toBeNull()
    expect(await nextWindow(m.contractId)).toBe(1) // buraco, NUNCA count+1 (=2, já gasta)

    // o buraco exige o threshold da ETAPA 1: com ele acima do progresso, bloqueia
    await sql`
      update mentorship_window_rules set threshold_pct = 60
      where contract_id = ${m.contractId} and window_index = 1`
    expect(await canBook(m.contractId)).toBe(false)
    await sql`
      update mentorship_window_rules set threshold_pct = 10
      where contract_id = ${m.contractId} and window_index = 1`

    const sC = await createSession(sql)
    await book(sC, m.contractId) // consome a etapa 1 (preenche o buraco)
    expect(await netByWindow(m.contractId)).toEqual({ 1: 1, 2: 1 })
    expect(await nextWindow(m.contractId)).toBe(3)

    // duplo gasto da etapa 2 segue rejeitado: próxima é a 3 e só há 2 destravadas
    const sD = await createSession(sql)
    await expect(book(sD, m.contractId)).rejects.toThrow(/não elegível/)
  })

  it('caso 14: variante com refund AVULSO numa reserva não-última', async () => {
    const m = await createMentorshipContract(sql, eligibleOpts())
    const sA = await createSession(sql)
    const sB = await createSession(sql)
    const bA = await book(sA, m.contractId) // etapa 1
    await book(sB, m.contractId) // etapa 2

    expect((await refund(bA)).error).toBeNull()
    expect(await nextWindow(m.contractId)).toBe(1)

    const sC = await createSession(sql)
    await book(sC, m.contractId)
    expect(await netByWindow(m.contractId)).toEqual({ 1: 1, 2: 1 })
    expect(await nextWindow(m.contractId)).toBe(3)
  })

  it('caso 15: threshold da etapa do buraco reconfigurado para NULL → exceção clara (D2)', async () => {
    const m = await createMentorshipContract(sql, eligibleOpts())
    const sA = await createSession(sql)
    const sB = await createSession(sql)
    const bA = await book(sA, m.contractId)
    await book(sB, m.contractId)
    await refund(bA)

    await sql`
      update mentorship_window_rules set threshold_pct = null
      where contract_id = ${m.contractId} and window_index = 1`
    await expect(canBook(m.contractId)).rejects.toThrow(/regras de progresso não configuradas/)
  })
})

describe('cancelamento de sessão (casos 19, 20)', () => {
  it('caso 19: estorna TODAS as ativas, audita cada uma e a sessão; status cancelled', async () => {
    const m1 = await createMentorshipContract(sql, eligibleOpts())
    const m2 = await createMentorshipContract(sql, eligibleOpts())
    const s1 = await createSession(sql, { capacity: 6 })
    const b1 = await book(s1, m1.contractId)
    const b2 = await book(s1, m2.contractId)
    // reserva JÁ estornada antes do cancel não deve ser estornada de novo
    const preRefunded = await createMentorshipContract(sql, eligibleOpts())
    const b3 = await book(s1, preRefunded.contractId)
    await refund(b3)

    const { data, error } = await cancelSession(s1)
    expect(error).toBeNull()
    expect(data).toBe(2) // só as ATIVAS

    const [sess] = await sql`select status from mentorship_sessions where id = ${s1}`
    expect(sess.status).toBe('cancelled')

    for (const c of [m1, m2]) {
      expect(await netByWindow(c.contractId)).toEqual({ 1: 0 })
    }
    const bookings = await sql`
      select cancelled_at from mentorship_bookings where session_id = ${s1}`
    expect(bookings).toHaveLength(3)
    expect(bookings.every((b) => b.cancelled_at !== null)).toBe(true)

    const refundAudits = await sql`
      select 1 from audit_log
      where action = 'refund_mentorship_booking' and entity_id in (${b1}::text, ${b2}::text)`
    expect(refundAudits).toHaveLength(2)
    const cancelAudit = await sql`
      select diff from audit_log
      where action = 'cancel_mentorship_session' and entity_id = ${s1}::text`
    expect(cancelAudit).toHaveLength(1)
    expect(cancelAudit[0].diff.refunded_bookings).toBe(2)
  })

  it('caso 20: cancel 2× → exceção "já cancelada"; nenhum refund duplicado', async () => {
    const m = await createMentorshipContract(sql, eligibleOpts())
    const s1 = await createSession(sql)
    await book(s1, m.contractId)

    expect((await cancelSession(s1)).error).toBeNull()
    const again = await cancelSession(s1)
    expect(again.error?.message).toMatch(/já cancelada/)

    const [refunds] = await sql`
      select count(*)::int as n from mentorship_credit_ledger
      where contract_id = ${m.contractId} and reason = 'refund'`
    expect(refunds.n).toBe(1)
  })
})

describe('integridade do lançamento refund (caso 16) e privilégio (caso 23)', () => {
  it('caso 16: refund-de-refund, alvo manual_adjust e estorno cruzado → rejeitados por trigger/FK', async () => {
    const m = await createMentorshipContract(sql, eligibleOpts())
    const other = await createMentorshipContract(sql, eligibleOpts())
    const s1 = await createSession(sql)
    const sOther = await createSession(sql)
    const b1 = await book(s1, m.contractId)
    await book(sOther, other.contractId)
    await refund(b1)

    const [refundRow] = await sql`
      select id, window_index from mentorship_credit_ledger
      where contract_id = ${m.contractId} and reason = 'refund'`
    const [spendOther] = await sql`
      select id, window_index, session_id from mentorship_credit_ledger
      where contract_id = ${other.contractId} and reason = 'booking_spend'`

    // refund-de-refund (cunharia crédito): trigger de alvo
    await expect(sql`
      insert into mentorship_credit_ledger
        (contract_id, student_id, delta, reason, window_index, session_id, refund_of)
      values (${m.contractId}, ${m.studentId}, 1, 'refund', ${refundRow.window_index},
              ${s1}, ${refundRow.id})`).rejects.toThrow(/deve apontar um booking_spend/)

    // estorno CRUZADO (refund do contrato A apontando gasto do B): FK composta
    await expect(sql`
      insert into mentorship_credit_ledger
        (contract_id, student_id, delta, reason, window_index, session_id, refund_of)
      values (${m.contractId}, ${m.studentId}, 1, 'refund', ${spendOther.window_index},
              ${spendOther.session_id}, ${spendOther.id})`).rejects.toThrow(
      /foreign key|não é do tipo/i,
    )

    // window_index divergente do gasto estornado: trigger de alvo
    const s2 = await createSession(sql)
    const b2 = await book(s2, m.contractId)
    const [spend2] = await sql`
      select ledger_id from mentorship_bookings where id = ${b2}`
    await expect(sql`
      insert into mentorship_credit_ledger
        (contract_id, student_id, delta, reason, window_index, session_id, refund_of)
      values (${m.contractId}, ${m.studentId}, 1, 'refund', 5, ${s2}, ${spend2.ledger_id})`,
    ).rejects.toThrow(/window_index do refund/)

    // manual_adjust com refund_of (consumiria o slot UNIQUE do estorno legítimo): CHECK
    await expect(sql`
      insert into mentorship_credit_ledger
        (contract_id, student_id, delta, reason, window_index, session_id, refund_of)
      values (${m.contractId}, ${m.studentId}, 1, 'manual_adjust', 1, ${s2}, ${spend2.ledger_id})`,
    ).rejects.toThrow(/check/i)
  })

  it('caso 23: INSERT direto de booking_spend por JWT admin via PostgREST → permission denied', async () => {
    const m = await createMentorshipContract(sql, eligibleOpts())
    const s1 = await createSession(sql)
    const { error } = await admin.from('mentorship_credit_ledger').insert({
      contract_id: m.contractId,
      student_id: m.studentId,
      delta: -1,
      reason: 'booking_spend',
      window_index: 1,
      session_id: s1,
    })
    expect(error?.message).toMatch(/permission denied/)
  })

  it('painel N1: DML direto em mentorship_bookings por JWT admin → permission denied; RPCs seguem vivas', async () => {
    const m = await createMentorshipContract(sql, eligibleOpts())
    const s1 = await createSession(sql)
    const b1 = await book(s1, m.contractId)

    const upd = await admin
      .from('mentorship_bookings')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('id', b1)
    expect(upd.error?.message).toMatch(/permission denied/)
    const del = await admin.from('mentorship_bookings').delete().eq('id', b1)
    expect(del.error?.message).toMatch(/permission denied/)
    const [spend] = await sql`
      select ledger_id from mentorship_bookings where id = ${b1}`
    const ins = await admin.from('mentorship_bookings').insert({
      session_id: s1,
      student_id: m.studentId,
      contract_id: m.contractId,
      ledger_id: spend.ledger_id,
    })
    expect(ins.error?.message).toMatch(/permission denied/)

    // regressão de grants: o caminho legítimo continua funcionando
    expect((await refund(b1)).error).toBeNull()
  })

  it('painel N1: sessão não vira cancelled com reserva ativa por fora da RPC; booked_count fora do alcance direto', async () => {
    const m = await createMentorshipContract(sql, eligibleOpts())
    const s1 = await createSession(sql)
    await book(s1, m.contractId)

    // até como OWNER, o trigger barra o estado "cancelada sem estorno" (C2)
    await expect(
      sql`update mentorship_sessions set status = 'cancelled' where id = ${s1}`,
    ).rejects.toThrow(/cancele via cancel_mentorship_session/)

    // booked_count só pelas RPCs: coluna fora do grant por coluna
    const cnt = await admin
      .from('mentorship_sessions')
      .update({ booked_count: 0 })
      .eq('id', s1)
    expect(cnt.error?.message).toMatch(/permission denied/)

    // a operação legítima da admin (bridge manual) segue viva: editar capacity
    const cap = await admin
      .from('mentorship_sessions')
      .update({ capacity: 8 })
      .eq('id', s1)
    expect(cap.error).toBeNull()

    // e a RPC cancela normalmente (seta o status por último, com zero ativas)
    expect((await cancelSession(s1)).error).toBeNull()
  })

  it('caso 22: estorno e cancel por papel não-admin → exceção (D10)', async () => {
    const m = await createMentorshipContract(sql, eligibleOpts())
    const s1 = await createSession(sql)
    const b1 = await book(s1, m.contractId)

    const teacher = await clientAs(await createAuthUser(sql, 'teacher', 'Prof estorno'), 'teacher')
    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno estorno'), 'student')
    for (const client of [teacher, student]) {
      const r = await client.rpc('refund_mentorship_booking', { p_booking: b1 })
      expect(r.error?.message).toContain('D10')
      const c = await client.rpc('cancel_mentorship_session', { p_session: s1 })
      expect(c.error?.message).toContain('D10')
    }
  })
})

describe('concorrência — advisory lock como única defesa (casos 9 e 21)', () => {
  it('caso 9: 2 reservas simultâneas da mesma etapa → exatamente 1 vence (inclusive pós-estorno)', async () => {
    // 1 janela destravada: quem perder o lock recalcula next=2 > destravadas → não elegível
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 0,
      thresholds: { 1: 10 },
      completionPct: 50,
    })
    const roundOne = [await createSession(sql), await createSession(sql)]
    const conn1 = connect(1)
    const conn2 = connect(1)
    try {
      const race = await Promise.allSettled([
        conn1`select public.book_mentorship_session(${roundOne[0]}, ${m.contractId})`,
        conn2`select public.book_mentorship_session(${roundOne[1]}, ${m.contractId})`,
      ])
      expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const loser = race.find((r) => r.status === 'rejected') as PromiseRejectedResult
      expect(loser.reason.message).toMatch(/não elegível/)
      expect(await netByWindow(m.contractId)).toEqual({ 1: 1 })

      // pós-estorno: devolve a etapa 1 e repete a disputa
      const [bk] = await sql`
        select id from mentorship_bookings
        where contract_id = ${m.contractId} and cancelled_at is null`
      await refund(bk.id as string)
      const roundTwo = [await createSession(sql), await createSession(sql)]
      const race2 = await Promise.allSettled([
        conn1`select public.book_mentorship_session(${roundTwo[0]}, ${m.contractId})`,
        conn2`select public.book_mentorship_session(${roundTwo[1]}, ${m.contractId})`,
      ])
      expect(race2.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(await netByWindow(m.contractId)).toEqual({ 1: 1 })
    } finally {
      await conn1.end()
      await conn2.end()
    }
  })

  it('caso 21: cancel×book da mesma sessão e book×refund do mesmo contrato — sem deadlock', async () => {
    // cancel×book: o book do contrato novo disputa com o cancel da sessão
    const m1 = await createMentorshipContract(sql, eligibleOpts())
    const m2 = await createMentorshipContract(sql, eligibleOpts())
    const s1 = await createSession(sql, { capacity: 6 })
    await book(s1, m1.contractId)

    const conn = connect(1)
    try {
      const [cancelRes, bookRes] = await Promise.allSettled([
        cancelSession(s1).then((r) => {
          if (r.error) throw new Error(r.error.message)
          return r.data
        }),
        conn`select public.book_mentorship_session(${s1}, ${m2.contractId})`,
      ])
      // nenhum lado pode morrer por deadlock (40P01) — ordem global sessão→contrato
      for (const r of [cancelRes, bookRes]) {
        if (r.status === 'rejected') {
          expect((r as PromiseRejectedResult).reason.message).not.toMatch(/deadlock/i)
        }
      }
      expect(cancelRes.status).toBe('fulfilled')
      // book venceu a corrida (foi estornado junto) OU perdeu (sessão já cancelada)
      if (bookRes.status === 'rejected') {
        expect((bookRes as PromiseRejectedResult).reason.message).toMatch(
          /não está aberta|cancelada/,
        )
      }
      const [sess] = await sql`select status from mentorship_sessions where id = ${s1}`
      expect(sess.status).toBe('cancelled')
      const [active] = await sql`
        select count(*)::int as n from mentorship_bookings
        where session_id = ${s1} and cancelled_at is null`
      expect(active.n).toBe(0) // C2: sessão cancelada NUNCA fica com reserva ativa
      // nenhum gasto líquido sobrou em nenhum dos contratos
      expect(await netByWindow(m1.contractId)).toEqual({ 1: 0 })
      if (bookRes.status === 'fulfilled') {
        expect(await netByWindow(m2.contractId)).toEqual({ 1: 0 })
      } else {
        expect(await netByWindow(m2.contractId)).toEqual({})
      }

      // book×refund do MESMO contrato, em sessões diferentes
      const m3 = await createMentorshipContract(sql, eligibleOpts())
      const sA = await createSession(sql)
      const sB = await createSession(sql)
      const bA = await book(sA, m3.contractId)
      const [refundRes, bookRes2] = await Promise.allSettled([
        refund(bA).then((r) => {
          if (r.error) throw new Error(r.error.message)
          return r.data
        }),
        conn`select public.book_mentorship_session(${sB}, ${m3.contractId})`,
      ])
      for (const r of [refundRes, bookRes2]) {
        if (r.status === 'rejected') {
          expect((r as PromiseRejectedResult).reason.message).not.toMatch(/deadlock/i)
        }
      }
      expect(refundRes.status).toBe('fulfilled')
      expect(bookRes2.status).toBe('fulfilled')
      // serialização pelo advisory lock: cada etapa com gasto líquido coerente
      // (refund antes → book pegou a etapa 1; book antes → pegou a 2 e a 1 zerou)
      const net = await netByWindow(m3.contractId)
      const total = Object.values(net).reduce((a, b) => a + b, 0)
      expect(total).toBe(1) // exatamente UM gasto líquido vivo
      expect(Object.values(net).every((n) => n === 0 || n === 1)).toBe(true)
    } finally {
      await conn.end()
    }
  })
})
