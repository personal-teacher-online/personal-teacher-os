// F5 — Disponibilidade computada e tratamento de período (plano integrado v2,
// 18/07/2026; M1-4, M12-12, P4/P5): a reserva computada materializa e consome
// na MESMA transação; o tratamento fecha a oferta e trata as aulas em lote.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createInstance,
  createPrivateContract,
  createTeacher,
  daysFromToday,
  instanteEm,
} from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F5'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

async function addCredit(contractId: string, expiresOn: string, dur: number | null = 45) {
  await sql`
    insert into makeup_ledger (contract_id, delta, reason, expires_on, duration_min)
    values (${contractId}, 1, 'manual_adjust', ${expiresOn}, ${dur})`
}

/** Janela semanal cobrindo o dia-alvo inteiro (fuso Cuiabá). */
async function openAllDay(teacherId: string, dateISO: string) {
  const dow = new Date(dateISO + 'T12:00:00-04:00').getUTCDay()
  // 12:00-04 = 16 UTC; getUTCDay do meio-dia local equivale ao dow local
  const { error } = await admin.rpc('set_weekly_availability', {
    p_teacher: teacherId, p_weekday: dow, p_start: '06:00', p_end: '22:00',
    p_iana_tz: 'America/Cuiaba',
  })
  expect(error).toBeNull()
}

/** Instante UTC de uma hora local Cuiabá numa data. */
function utcOf(dateISO: string, timeHH: string): string {
  return new Date(`${dateISO}T${timeHH}:00-04:00`).toISOString()
}

describe('M1-4 — reserva de horário computado', () => {
  it('materializa a janela e consome na MESMA transação; marcador degradado no audit', async () => {
    const c = await createPrivateContract(sql)
    await addCredit(c.contractId, daysFromToday(40), 60)
    const alvo = daysFromToday(5)
    await openAllDay(c.teacherId, alvo)

    const { data: instId, error } = await admin.rpc('book_computed_slot', {
      p_teacher: c.teacherId,
      p_starts_at_utc: utcOf(alvo, '10:00'),
      p_contract: c.contractId,
      p_google_degraded: true,
    })
    expect(error).toBeNull()
    const [inst] = await sql`
      select state, round(extract(epoch from (ends_at_utc - starts_at_utc)) / 60)::int as dur
      from class_instances where id = ${instId}`
    expect(inst.state).toBe('scheduled')
    expect(inst.dur).toBe(60) // duração do crédito (F1)
    const [win] = await sql`
      select state from reschedule_windows
      where teacher_id = ${c.teacherId} and starts_at_utc = ${utcOf(alvo, '10:00')}`
    expect(win.state).toBe('consumida')
    const [audit] = await sql`
      select diff from audit_log where action = 'book_computed_slot'
      and diff->>'contract' = ${c.contractId} order by id desc limit 1`
    expect(audit.diff.google_degraded).toBe(true)
  })

  it('fora da janela semanal ou sob bloqueio → recusado pelo BANCO', async () => {
    const c = await createPrivateContract(sql)
    await addCredit(c.contractId, daysFromToday(40))
    const alvo = daysFromToday(6)
    // sem janela nenhuma
    const fora = await admin.rpc('book_computed_slot', {
      p_teacher: c.teacherId, p_starts_at_utc: utcOf(alvo, '10:00'), p_contract: c.contractId,
    })
    expect(fora.error?.message).toContain('não está disponível')

    await openAllDay(c.teacherId, alvo)
    const { data: blockId } = await admin.rpc('add_teacher_block', {
      p_teacher: c.teacherId, p_from: alvo, p_to: alvo, p_note: 'bloqueio teste',
    })
    expect(blockId).toBeTruthy()
    const bloqueado = await admin.rpc('book_computed_slot', {
      p_teacher: c.teacherId, p_starts_at_utc: utcOf(alvo, '10:00'), p_contract: c.contractId,
    })
    expect(bloqueado.error?.message).toContain('não está disponível')
  })

  it('instante de janela JÁ publicada é reaproveitado (união sem duplicata)', async () => {
    const c = await createPrivateContract(sql, { minNotice: 1 })
    await addCredit(c.contractId, daysFromToday(40), 45)
    const alvo = daysFromToday(5)
    await openAllDay(c.teacherId, alvo)
    const { data: winId } = await admin.rpc('publish_reschedule_window', {
      p_teacher: c.teacherId, p_starts_at_utc: instanteEm(alvo, '11:00'),
    })
    const { error } = await admin.rpc('book_computed_slot', {
      p_teacher: c.teacherId, p_starts_at_utc: utcOf(alvo, '11:00'), p_contract: c.contractId,
    })
    expect(error).toBeNull()
    const wins = await sql`
      select id, state from reschedule_windows
      where teacher_id = ${c.teacherId} and starts_at_utc = ${utcOf(alvo, '11:00')}`
    expect(wins).toHaveLength(1) // reaproveitou a existente
    expect(wins[0].id).toBe(winId)
    expect(wins[0].state).toBe('consumida')
  })

  it('gestão da agenda semanal: professora mexe na própria; aluno é recusado', async () => {
    const t = await createTeacher(sql)
    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno agenda'), 'student')
    const negado = await student.rpc('set_weekly_availability', {
      p_teacher: t, p_weekday: 1, p_start: '08:00', p_end: '12:00',
    })
    expect(negado.error?.message).toContain('D10')
  })
})

describe('M1-4/P4/P5 — tratamento de período', () => {
  it('cancel_credit: cancela com validade-ESCOLA, avisa por aula e bloqueia a oferta', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    const alvo = daysFromToday(5)
    const inst = await createInstance(sql, c, { startsInHours: 5 * 24 })
    const { data, error } = await admin.rpc('admin_period_treatment', {
      p_teacher: c.teacherId, p_from: daysFromToday(4), p_to: daysFromToday(6),
      p_mode: 'cancel_credit', p_note: 'férias',
    })
    expect(error).toBeNull()
    // A6/lote 2: o retorno cresceu — a contagem de canceladas deixou de ser a
    // única resposta, porque cancelar não é sinônimo de creditar (a aula que
    // nasceu de crédito antigo sem identidade volta BLOQUEADA). Aqui a aula é
    // comum, então o esperado é 1 cancelada, 1 creditada e 0 bloqueadas.
    expect(data as Record<string, unknown>).toMatchObject({
      cancelled: 1,
      credited: 1,
      refund_blocked: 0,
      invited: 0,
    })

    const [st] = await sql`select state from class_instances where id = ${inst}`
    expect(st.state).toBe('cancelled')
    // crédito com validade-ESCOLA (M3-1 automático via causa 'teacher')
    const [credit] = await sql`
      select l.expires_on::text as exp,
             ((i.starts_at_utc at time zone s.iana_tz)::date + c2.school_fault_credit_expiry_days)::text as esperado
      from makeup_ledger l
      join class_instances i on i.id = l.class_instance_id
      join contracts c2 on c2.id = l.contract_id
      join students s on s.id = c2.student_id
      where l.contract_id = ${c.contractId} and l.delta = 1`
    expect(credit.exp).toBe(credit.esperado)
    // P4: aviso por aula
    const aviso = await sql`
      select 1 from notification_outbox
      where template = 'class-cancelled' and payload->>'instance_id' = ${inst}::text`
    expect(aviso).toHaveLength(1)
    await sql`update notification_outbox set sent_at = now()
               where sent_at is null and template in ('class-cancelled', 'period-reschedule-invite')
                 and payload->>'student_id' = ${c.studentId}::text`
    // bloqueio criado
    const block = await sql`
      select 1 from teacher_availability_exceptions
      where teacher_id = ${c.teacherId} and kind = 'block'`
    expect(block.length).toBeGreaterThan(0)
    expect(alvo).toBeTruthy()
  })

  it('invite_reschedule (P5): a aula PERMANECE; convite enfileirado; franquia intocada', async () => {
    const c = await createPrivateContract(sql)
    const inst = await createInstance(sql, c, { startsInHours: 5 * 24 })
    const { data, error } = await admin.rpc('admin_period_treatment', {
      p_teacher: c.teacherId, p_from: daysFromToday(4), p_to: daysFromToday(6),
      p_mode: 'invite_reschedule', p_note: 'congresso',
    })
    expect(error).toBeNull()
    // A6/lote 2: no convite ninguém cancela — logo nenhuma creditou e nenhuma
    // voltou bloqueada. O zero aqui é afirmação, não omissão.
    expect(data as Record<string, unknown>).toMatchObject({
      invited: 1,
      cancelled: 0,
      credited: 0,
      refund_blocked: 0,
    })
    const [st] = await sql`select state from class_instances where id = ${inst}`
    expect(st.state).toBe('scheduled') // nada mudou
    const convite = await sql`
      select payload from notification_outbox
      where template = 'period-reschedule-invite' and payload->>'instance_id' = ${inst}::text`
    expect(convite).toHaveLength(1)
    await sql`update notification_outbox set sent_at = now()
               where sent_at is null and template = 'period-reschedule-invite' and payload->>'instance_id' = ${inst}::text`
    const [usage] = await sql`
      select coalesce(sum(used_count), 0)::int as u from reschedule_usage where contract_id = ${c.contractId}`
    expect(usage.u).toBe(0)
  })

  it('feriados semeados; política default = flag', async () => {
    const [natal] = await sql`select label from br_holidays where holiday = '2026-12-25'`
    expect(natal.label).toBe('Natal')
    const t = await createTeacher(sql)
    const [row] = await sql`select holiday_policy from teachers where id = ${t}`
    expect(row.holiday_policy).toBe('flag')
  })
})
