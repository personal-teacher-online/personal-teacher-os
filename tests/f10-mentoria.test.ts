// F10 — Mentoria completa (plano integrado v2, 18/07/2026): régua padrão com
// semeadura (M6-1), trava de sessão futura (M6-2), avisos de encontro (M6-3/
// P16), autocancelamento 24h (M6-4), edição de encontro (M6-5) e vínculo
// Hotmart visível (M7-8).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createMentorshipContract,
  createSession,
  daysFromToday,
  sweepStaleMentorshipFixtures,
} from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  // M7-8 lê admin_mentorship_overview inteira (.find pelo contract_id) — mesma
  // varredura da reforma-motor: sem ela o teto de 1000 linhas do PostgREST
  // esconde o contrato recém-criado.
  await sweepStaleMentorshipFixtures(sql)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F10'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/** contrato elegível (curso há 3 meses, etapa 1 com threshold batido). */
async function eligibleContract() {
  return createMentorshipContract(sql, {
    courseStartMonthsAgo: 3,
    thresholds: { 1: 10, 2: 30 },
    completionPct: 50,
  })
}

describe('M6-1 — régua padrão + semeadura', () => {
  it('defaults semeiam contrato NOVO e o "aplicar aos existentes" preenche sem sobrescrever', async () => {
    await admin.rpc('admin_set_default_threshold', { p_window: 1, p_pct: 15 })
    await admin.rpc('admin_set_default_threshold', { p_window: 2, p_pct: 35 })

    // novo contrato herda os defaults pelo trigger
    const novo = await createMentorshipContract(sql, { courseStartMonthsAgo: 1 })
    const seeded = await sql`
      select window_index, threshold_pct from mentorship_window_rules
      where contract_id = ${novo.contractId} order by window_index`
    expect(seeded.map((r) => [r.window_index, Number(r.threshold_pct)])).toEqual([
      [1, 15],
      [2, 35],
    ])

    // existente com regra CUSTOM na etapa 1: aplicar preenche SÓ o que falta
    const antigo = await createMentorshipContract(sql, {
      courseStartMonthsAgo: 1,
      thresholds: { 1: 99 },
    })
    // o trigger de semeadura pode ter preenchido 2 — limpa para simular pré-F10
    await sql`delete from mentorship_window_rules
              where contract_id = ${antigo.contractId} and window_index <> 1`
    const { error } = await admin.rpc('admin_apply_default_thresholds', {
      p_contract: antigo.contractId,
    })
    expect(error).toBeNull()
    const depois = await sql`
      select window_index, threshold_pct from mentorship_window_rules
      where contract_id = ${antigo.contractId} order by window_index`
    expect(depois.map((r) => [r.window_index, Number(r.threshold_pct)])).toEqual([
      [1, 99], // custom preservado
      [2, 35],
    ])
  })
})

describe('M6-2 — trava de sessão futura', () => {
  it('sessão que já começou não aceita reserva', async () => {
    const c = await eligibleContract()
    const past = await createSession(sql, { inDays: -1, status: 'open' })
    const err = await sql`select public.book_mentorship_session(${past}, ${c.contractId})`.catch((e) => e)
    expect(String(err)).toContain('já começou')
  })
})

describe('M6-4 — autocancelamento do mentorado (24h + estorno + aviso)', () => {
  async function bookedFixture(inHours: number) {
    const c = await eligibleContract()
    const userId = await createAuthUser(sql, 'student', 'Mentorado F10')
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    const [srow] = await sql`
      insert into mentorship_sessions (scheduled_at, local_time_snapshot, capacity, status)
      values (now() + make_interval(hours => ${inHours}), 'fixture F10', 6, 'open')
      returning id`
    const sess = srow.id as string
    // book é interna (revogada de clientes) — fixture via owner, como na Fase 1
    const [b] = await sql`select public.book_mentorship_session(${sess}, ${c.contractId}) as id`
    return { ...c, userId, sess, bookingId: String(b.id), client: await clientAs(userId, 'student') }
  }

  it('>24h: cancela, estorna, avisa; alheia é recusada', async () => {
    const f = await bookedFixture(10 * 24)
    const { error } = await f.client.rpc('cancel_my_mentorship_booking', { p_booking: f.bookingId })
    expect(error).toBeNull()
    const [b] = await sql`select cancelled_at from mentorship_bookings where id = ${f.bookingId}`
    expect(b.cancelled_at).not.toBeNull()
    const refund = await sql`
      select 1 from mentorship_credit_ledger
      where contract_id = ${f.contractId} and reason = 'refund'`
    expect(refund).toHaveLength(1)
    const aviso = await sql`
      select 1 from notification_outbox
      where dedupe_key = ${'meeting-cancelled:self:' + f.sess + ':' + f.studentId}`
    expect(aviso).toHaveLength(1)
    await sql`update notification_outbox set sent_at = now()
               where sent_at is null and template = 'meeting-cancelled' and payload->>'session_id' = ${f.sess}::text`

    const outro = await bookedFixture(9 * 24)
    const negado = await f.client.rpc('cancel_my_mentorship_booking', { p_booking: outro.bookingId })
    expect(negado.error?.message).toContain('acesso')
  })

  it('<24h: recusado com direção ao atendimento', async () => {
    const f = await bookedFixture(12) // encontro daqui a 12h
    const { error } = await f.client.rpc('cancel_my_mentorship_booking', { p_booking: f.bookingId })
    expect(error?.message).toContain('24h')
  })
})

describe('M6-3/P16 — cancelamento de encontro avisa TODOS', () => {
  it('cancel_mentorship_session enfileira aviso por mentorado afetado', async () => {
    const a = await eligibleContract()
    const userA = await createAuthUser(sql, 'student', 'Afetado A')
    await sql`update students set profile_id = ${userA} where id = ${a.studentId}`
    const sess = await createSession(sql, { inDays: 12, status: 'open' })
    await sql`select public.book_mentorship_session(${sess}, ${a.contractId})`

    const { error } = await admin.rpc('cancel_mentorship_session', { p_session: sess })
    expect(error).toBeNull()
    const aviso = await sql`
      select 1 from notification_outbox
      where dedupe_key = ${'meeting-cancelled:' + sess + ':' + a.studentId}`
    expect(aviso).toHaveLength(1)
    await sql`update notification_outbox set sent_at = now()
               where sent_at is null and template = 'meeting-cancelled' and payload->>'session_id' = ${sess}::text`
  })
})

describe('M6-5 — edição de encontro', () => {
  it('link livre sempre; vagas com piso; hora só sem reservas', async () => {
    const c = await eligibleContract()
    const novoDia = daysFromToday(30) // relativo a hoje: a RPC recusa horário no passado
    const sess = await createSession(sql, { inDays: 15, capacity: 6, status: 'open' })
    await sql`select public.book_mentorship_session(${sess}, ${c.contractId})`

    const { error: linkOk } = await admin.rpc('admin_update_mentorship_session', {
      p_session: sess, p_gmeet_url: 'https://meet.google.com/xyz',
    })
    expect(linkOk).toBeNull()

    const piso = await admin.rpc('admin_update_mentorship_session', {
      p_session: sess, p_capacity: 0,
    })
    expect(piso.error?.message).toContain('abaixo das')
    const { error: capOk } = await admin.rpc('admin_update_mentorship_session', {
      p_session: sess, p_capacity: 1,
    })
    expect(capOk).toBeNull()
    const [full] = await sql`select status from mentorship_sessions where id = ${sess}`
    expect(full.status).toBe('full') // 1 reserva = capacidade → lotada

    const hora = await admin.rpc('admin_update_mentorship_session', {
      p_session: sess, p_local_date: novoDia, p_local_time: '19:00',
    })
    expect(hora.error?.message).toContain('não muda de horário')

    const vazia = await createSession(sql, { inDays: 20, status: 'open' })
    const { error: horaOk } = await admin.rpc('admin_update_mentorship_session', {
      p_session: vazia, p_local_date: novoDia, p_local_time: '19:00',
    })
    expect(horaOk).toBeNull()
    const [nova] = await sql`select local_time_snapshot from mentorship_sessions where id = ${vazia}`
    expect(nova.local_time_snapshot).toContain(`${novoDia} 19:00`)
  })
})

describe('M7-8 — vínculo Hotmart visível', () => {
  it('overview expõe matched/divergence', async () => {
    const c = await createMentorshipContract(sql, { courseStartMonthsAgo: 1 })
    await sql`update mentorship_contracts
              set external_user_ref = 'x@exemplo.com', hotmart_divergence = 'e-mail x@exemplo.com não encontrado na Hotmart'
              where contract_id = ${c.contractId}`
    const { data, error } = await admin.rpc('admin_mentorship_overview')
    expect(error).toBeNull()
    const row = (data as { contract_id: string; hotmart_divergence: string | null }[]).find(
      (r) => r.contract_id === c.contractId,
    )
    expect(row?.hotmart_divergence).toContain('não encontrado')
  })
})
