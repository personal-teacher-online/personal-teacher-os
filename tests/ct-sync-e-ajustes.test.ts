// Construção total (migrations 20260715*) — sync autoritativo de progresso
// (000100), ajuste manual do ledger de mentoria (000200) e wrapper de posse do
// auto-agendamento (000800). Fixtures PRÓPRIAS (paralelo entre arquivos);
// teste-pino de permissão: expect(error?.code).toBe('42501').
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { anonClient, clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createMentorshipContract, createSession } from './helpers/db'

let sql: Sql
let service: SupabaseClient

beforeAll(async () => {
  sql = connect(3)
  service = serviceClient()
})
afterAll(async () => {
  await sql.end()
})

describe('sync_course_progress (last-write-wins do polling Hotmart)', () => {
  it('sobe para 30 e depois REGRIDE para 10 — regressão APLICA e audita regressed=true', async () => {
    const m = await createMentorshipContract(sql, { courseStartMonthsAgo: 1 })

    const up = await service.rpc('sync_course_progress', {
      p_contract: m.contractId,
      p_pct: 30,
    })
    expect(up.error).toBeNull()
    expect(Number(up.data)).toBe(30)

    const down = await service.rpc('sync_course_progress', {
      p_contract: m.contractId,
      p_pct: 10, // fonte autoritativa regrediu (recontagem de páginas)
    })
    expect(down.error).toBeNull()
    expect(Number(down.data)).toBe(10) // last-write-wins: devolve o novo, não o maior

    const [row] = await sql`
      select completion_pct, student_id from course_progress
      where contract_id = ${m.contractId}`
    expect(Number(row.completion_pct)).toBe(10)
    expect(row.student_id).toBe(m.studentId) // derivado do contrato

    const audits = await sql`
      select diff from audit_log
      where action = 'sync_course_progress' and entity_id = ${m.contractId}::text
      order by id`
    expect(audits).toHaveLength(2)
    expect(audits[0].diff.regressed).toBe(false)
    expect(audits[1].diff).toMatchObject({
      regressed: true,
      new_pct: 10,
      previous_pct: 30,
    })
  })

  it('pino 42501: authenticated (aluno) e anon não executam — grants-only service_role', async () => {
    const m = await createMentorshipContract(sql, { courseStartMonthsAgo: 1 })
    const payload = { p_contract: m.contractId, p_pct: 50 }

    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno sync CT'), 'student')
    const viaStudent = await student.rpc('sync_course_progress', payload)
    expect(viaStudent.error?.code).toBe('42501')

    const viaAnon = await anonClient().rpc('sync_course_progress', payload)
    expect(viaAnon.error?.code).toBe('42501')
  })

  it('pct 101 → exceção de validação', async () => {
    const m = await createMentorshipContract(sql, { courseStartMonthsAgo: 1 })
    const over = await service.rpc('sync_course_progress', {
      p_contract: m.contractId,
      p_pct: 101,
    })
    expect(over.error?.message).toMatch(/entre 0 e 100/)
  })
})

describe('admin_mentorship_adjust (única via de ajuste manual do ledger)', () => {
  it('+2 → duas linhas manual_adjust delta=+1, retorno +2; depois −1 → retorno +1; elegibilidade INTACTA', async () => {
    // Fixture elegível (can_book true) para medir que o ajuste NÃO mexe na escada.
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 1,
      thresholds: { 1: 10 },
      completionPct: 50,
    })
    const admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin ajuste CT'), 'admin')

    const [before] = await sql`select public.mentorship_can_book(${m.contractId}) as ok`
    expect(before.ok).toBe(true)

    const plus2 = await admin.rpc('admin_mentorship_adjust', {
      p_contract: m.contractId,
      p_delta: 2,
      p_note: 'compensação de teste',
    })
    expect(plus2.error).toBeNull()
    expect(plus2.data).toBe(2)

    const rows = await sql`
      select delta, reason::text from mentorship_credit_ledger
      where contract_id = ${m.contractId}
      order by id`
    expect(rows).toHaveLength(2) // Lei 2: ±1 por linha, nunca uma linha de +2
    expect(rows.every((r) => r.delta === 1 && r.reason === 'manual_adjust')).toBe(true)

    const minus1 = await admin.rpc('admin_mentorship_adjust', {
      p_contract: m.contractId,
      p_delta: -1,
    })
    expect(minus1.error).toBeNull()
    expect(minus1.data).toBe(1) // líquido de manual_adjust: +2 −1

    // Semântica registrada na migration: manual_adjust NÃO altera a elegibilidade.
    const [after] = await sql`select public.mentorship_can_book(${m.contractId}) as ok`
    expect(after.ok).toBe(before.ok)
  })

  it('|delta| > 12 → limite de sanidade; delta 0 → exceção; aluno chamando → D10', async () => {
    const m = await createMentorshipContract(sql, { courseStartMonthsAgo: 1 })
    const admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin limites CT'), 'admin')

    const demais = await admin.rpc('admin_mentorship_adjust', {
      p_contract: m.contractId,
      p_delta: 13,
    })
    expect(demais.error?.message).toMatch(/sanidade: 12/)

    const zero = await admin.rpc('admin_mentorship_adjust', {
      p_contract: m.contractId,
      p_delta: 0,
    })
    expect(zero.error?.message).toMatch(/±N/)

    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno ajuste CT'), 'student')
    const viaStudent = await student.rpc('admin_mentorship_adjust', {
      p_contract: m.contractId,
      p_delta: 1,
    })
    expect(viaStudent.error?.message).toMatch(/restrita à admin \(D10\)/)

    // nada vazou para o ledger em nenhuma das recusas
    const [n] = await sql`
      select count(*)::int as n from mentorship_credit_ledger
      where contract_id = ${m.contractId}`
    expect(n.n).toBe(0)
  })
})

describe('book_my_mentorship_session (wrapper de posse do aluno)', () => {
  /** Aluno logado dono de um contrato de mentoria elegível para a etapa 1. */
  async function ownerFixture() {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 1, // 1 janela destravada (floor(1/2)+1)
      thresholds: { 1: 0 },
      completionPct: 0, // threshold 0: 0% já reserva
    })
    const userId = await createAuthUser(sql, 'student', 'Mentorado CT')
    await sql`update students set profile_id = ${userId} where id = ${m.studentId}`
    const client = await clientAs(userId, 'student')
    return { ...m, userId, client }
  }

  it('aluno DONO reserva → booking uuid + gasto da etapa 1 no ledger; 2ª reserva → não elegível', async () => {
    const f = await ownerFixture()
    const session = await createSession(sql, { capacity: 2 })

    const booked = await f.client.rpc('book_my_mentorship_session', { p_session: session })
    expect(booked.error).toBeNull()
    expect(booked.data).toMatch(/^[0-9a-f-]{36}$/)

    const [b] = await sql`
      select session_id, contract_id, student_id from mentorship_bookings
      where id = ${booked.data}`
    expect(b).toMatchObject({
      session_id: session,
      contract_id: f.contractId,
      student_id: f.studentId,
    })
    const ledger = await sql`
      select delta, reason::text, window_index from mentorship_credit_ledger
      where contract_id = ${f.contractId}`
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ delta: -1, reason: 'booking_spend', window_index: 1 })

    // Etapa 1 já gasta e só 1 janela destravada → o motor recusa a 2ª reserva.
    const again = await f.client.rpc('book_my_mentorship_session', { p_session: session })
    expect(again.error?.message).toMatch(/não elegível/)
  })

  it('logado SEM contrato de mentoria ativo → exceção clara; anon → 42501 (sem EXECUTE)', async () => {
    const session = await createSession(sql, { capacity: 2 })

    const semMentoria = await clientAs(
      await createAuthUser(sql, 'student', 'Sem mentoria CT'),
      'student',
    )
    const r = await semMentoria.rpc('book_my_mentorship_session', { p_session: session })
    expect(r.error?.message).toMatch(/não tem um programa de mentoria ativo/)

    // anon: EXECUTE revogado — a recusa vem ANTES do corpo (auth por privilégio)
    const viaAnon = await anonClient().rpc('book_my_mentorship_session', { p_session: session })
    expect(viaAnon.error?.code).toBe('42501')
  })
})
