// Fase 2 / M4 — Fluxo de remarcação no portal: elegibilidade (padrão TutorBird),
// lista de janelas do aluno e templates de e-mail aprovados (D14).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { friendlyTz, partnerEmail, studentEmail, teacherEmail } from '../src/lib/email/reschedule'
import { availableWindows, rescheduleEligibility } from '../src/lib/portal/reschedule'
import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createInstance,
  createPrivateContract,
  daysFromToday,
  instanteEm,
} from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin M4'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

async function studentLogin(opts: Parameters<typeof createPrivateContract>[1] = {}) {
  const c = await createPrivateContract(sql, opts)
  const userId = await createAuthUser(sql, 'student', 'Aluno M4')
  await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
  return { ...c, userId, client: await clientAs(userId, 'student') }
}

/** `tz` é a zona em que `time` vale — a de quem PUBLICA. Desde o A6/a a RPC
 *  recebe o instante pronto, então a conversão é de quem chama (aqui, como na
 *  action). Default: Cuiabá, a zona do negócio. */
async function publish(
  teacherId: string,
  daysAhead: number,
  time: string,
  tz = 'America/Cuiaba',
) {
  const { data, error } = await admin.rpc('publish_reschedule_window', {
    p_teacher: teacherId,
    p_starts_at_utc: instanteEm(daysFromToday(daysAhead), time, tz),
  })
  expect(error).toBeNull()
  return data as string
}

describe('availableWindows — o que o aluno vê para escolher', () => {
  it('só janelas publicadas DA professora, futuras e ≤ 2 semanas', async () => {
    const s = await studentLogin()
    const mine = await publish(s.teacherId, 5, '10:00')
    await publish(s.teacherId, 20, '10:00') // latente (> 2 semanas)
    const outro = await createPrivateContract(sql)
    await publish(outro.teacherId, 5, '10:00') // professora alheia

    const windows = await availableWindows(s.client, s.teacherId)
    expect(windows.map((w) => w.id)).toEqual([mine])
  })

  it('janela consumida some da lista', async () => {
    const s = await studentLogin()
    const inst = await createInstance(sql, { contractId: s.contractId, teacherId: s.teacherId }, { startsInHours: 72 })
    const win = await publish(s.teacherId, 6, '11:00')
    await s.client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    const windows = await availableWindows(s.client, s.teacherId)
    expect(windows.map((w) => w.id)).not.toContain(win)
  })
})

describe('rescheduleEligibility — botão some sem alçada e sem crédito', () => {
  it('franquia consome por mês da aula; crédito reabilita', async () => {
    const s = await studentLogin({ allowance: 1 })
    const inst = await createInstance(sql, { contractId: s.contractId, teacherId: s.teacherId }, { startsInHours: 72 })
    const [row] = await sql`select starts_at_utc from class_instances where id = ${inst}`
    const startsIso = row.starts_at_utc.toISOString()

    const before = await rescheduleEligibility(s.client, s.contractId, startsIso, 'America/Cuiaba')
    expect(before).toEqual({ allowanceLeft: 1, creditBalance: 0, canReschedule: true })

    const win = await publish(s.teacherId, 6, '09:00')
    const { data: newInst, error } = await s.client.rpc('book_reschedule_window', {
      p_window: win,
      p_instance: inst,
    })
    expect(error).toBeNull()

    const after = await rescheduleEligibility(s.client, s.contractId, startsIso, 'America/Cuiaba')
    expect(after.allowanceLeft).toBe(0)
    expect(after.canReschedule).toBe(false)

    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    const withCredit = await rescheduleEligibility(s.client, s.contractId, startsIso, 'America/Cuiaba')
    expect(withCredit.creditBalance).toBe(1)
    expect(withCredit.canReschedule).toBe(true)
    expect(typeof newInst).toBe('string')
  })
})

describe('caso 9: casal remarca — o OUTRO membro recebe o e-mail 3b', () => {
  it('Natália remarca pelo portal; Yago recebe o 3b com os nomes certos; professora sem login é pulada', async () => {
    const { serviceClient } = await import('./helpers/auth')
    const { sendRescheduleEmails } = await import('../src/lib/email/notify')
    const service = serviceClient()

    const [n] = await sql`insert into students (display_name, iana_tz, tz_confirmed) values ('Natália M4', 'America/Cuiaba', true) returning id`
    const [y] = await sql`insert into students (display_name, iana_tz, tz_confirmed) values ('Yago M4', 'America/Cuiaba', true) returning id`
    const [g] = await sql`insert into student_groups (label) values ('Casal M4') returning id`
    await sql`insert into student_group_members (group_id, student_id) values (${g.id}, ${n.id}), (${g.id}, ${y.id})`
    const [t] = await sql`insert into teachers (hourly_rate_cents, display_name) values (10000, 'Prof M4') returning id`
    const [c] = await sql`
      insert into contracts (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
                             monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${g.id}, ${t.id}, 'casal M4', 15000, 2, 24, 90, current_date)
      returning id`
    // Ambos com login (o e-mail vem do auth.users).
    const nataliaUser = await createAuthUser(sql, 'student', 'Natália M4')
    const yagoUser = await createAuthUser(sql, 'student', 'Yago M4')
    await sql`update students set profile_id = ${nataliaUser} where id = ${n.id}`
    await sql`update students set profile_id = ${yagoUser} where id = ${y.id}`

    const inst = await createInstance(sql, { contractId: c.id, teacherId: t.id }, { startsInHours: 72 })
    const win = await publish(t.id, 6, '14:00')
    const natalia = await clientAs(nataliaUser, 'student')
    const { data: newInst, error } = await natalia.rpc('book_reschedule_window', {
      p_window: win,
      p_instance: inst,
    })
    expect(error).toBeNull()

    const sent: { to: string; subject: string; html: string }[] = []
    await sendRescheduleEmails(
      service,
      { newInstanceId: String(newInst), actorUserId: nataliaUser },
      async (e) => { sent.push(e) },
    )

    // 2 e-mails: o 3 para a Natália e o 3b para o Yago; e-mail 4 pulado (professora sem login).
    expect(sent).toHaveLength(2)
    const toYago = sent.find((e) => e.subject.includes('remarcou a aula de vocês'))
    expect(toYago?.html).toContain('Oi, Yago!')
    expect(toYago?.subject).toContain('Natália')
    const toNatalia = sent.find((e) => e.subject.startsWith('Aula remarcada'))
    expect(toNatalia?.html).toContain('Oi, Natália!')
    expect(toNatalia?.html).toContain('das suas remarcações do mês (você ainda pode remarcar 1)')
    expect(toNatalia?.to).not.toBe(toYago?.to)
  })
})

// ---------------------------------------------------------------------------
// Painel final da Fase 3 — casos 2 (ponta final) e 14 (primeira metade): o ramo
// ENVIADO do e-mail 4 (professora COM login) atravessando sendRescheduleEmails
// de verdade — fiação teacherTz = teachers.iana_tz + emailOf(teacher.profile_id).
// ---------------------------------------------------------------------------
describe('casos 2 e 14: e-mail 4 ENVIADO — professora com login, hora no fuso DELA', () => {
  it('casal remarca; professora vinculada (São Paulo) recebe o 4 com hora SP e link /teacher', async () => {
    const { serviceClient } = await import('./helpers/auth')
    const { sendRescheduleEmails } = await import('../src/lib/email/notify')
    const service = serviceClient()

    // Fixture de CASAL (molde do caso 9), agora com a professora VINCULADA e em SP.
    const [n] = await sql`insert into students (display_name, iana_tz, tz_confirmed) values ('Nara F3', 'America/Cuiaba', true) returning id`
    const [y] = await sql`insert into students (display_name, iana_tz, tz_confirmed) values ('Yan F3', 'America/Cuiaba', true) returning id`
    const [g] = await sql`insert into student_groups (label) values ('Casal F3 e4') returning id`
    await sql`insert into student_group_members (group_id, student_id) values (${g.id}, ${n.id}), (${g.id}, ${y.id})`
    const [t] = await sql`
      insert into teachers (hourly_rate_cents, display_name, iana_tz)
      values (10000, 'Prof F3 e4', 'America/Sao_Paulo') returning id`
    const teacherUser = await createAuthUser(sql, 'teacher', 'Prof F3 e4')
    await sql`update teachers set profile_id = ${teacherUser} where id = ${t.id}`
    const [c] = await sql`
      insert into contracts (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
                             monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${g.id}, ${t.id}, 'casal F3 e4', 15000, 2, 24, 90, current_date)
      returning id`
    const naraUser = await createAuthUser(sql, 'student', 'Nara F3')
    const yanUser = await createAuthUser(sql, 'student', 'Yan F3')
    await sql`update students set profile_id = ${naraUser} where id = ${n.id}`
    await sql`update students set profile_id = ${yanUser} where id = ${y.id}`

    const inst = await createInstance(sql, { contractId: c.id, teacherId: t.id }, { startsInHours: 72 })
    // F3-D2: publish SEM p_iana_tz usa teachers.iana_tz → 14:00 DE SÃO PAULO.
    const win = await publish(t.id, 6, '14:00', 'America/Sao_Paulo')
    const nara = await clientAs(naraUser, 'student')
    const { data: newInst, error } = await nara.rpc('book_reschedule_window', {
      p_window: win,
      p_instance: inst,
    })
    expect(error).toBeNull()

    const sent: { to: string; subject: string; html: string }[] = []
    await sendRescheduleEmails(
      service,
      { newInstanceId: String(newInst), actorUserId: naraUser },
      async (e) => { sent.push(e) },
    )

    // AGORA são 3 e-mails: 3 (Nara), 3b (Yan) e 4 (professora — antes era pulado).
    expect(sent).toHaveLength(3)
    const [{ email: teacherEmail }] = await sql`select email from auth.users where id = ${teacherUser}`
    const to4 = sent.find((e) => e.to === teacherEmail)
    expect(to4).toBeDefined()
    expect(to4!.subject).toContain('remarcou')
    // Hora no fuso DELA: 14:00 em São Paulo (só a hora NOVA entra no assunto).
    // A mutação teacherTz→studentTz ou →BUSINESS_TZ mostraria 'às 13:00' (Cuiabá).
    expect(to4!.subject).toContain('às 14:00')
    expect(to4!.html).toContain('às 14:00')
    expect(to4!.html).toContain('horário de Sao Paulo')
    expect(to4!.html).toContain('/teacher')
  })

  it('caso 2 (ponta final): professora vinculada a conta ADMIN → e-mail 4 no e-mail admin', async () => {
    const { serviceClient } = await import('./helpers/auth')
    const { sendRescheduleEmails } = await import('../src/lib/email/notify')
    const service = serviceClient()

    // Cenário a dona (F3-D1b): teacher-row aponta para um profile de papel ADMIN.
    const s = await studentLogin()
    const donaUser = await createAuthUser(sql, 'admin', 'Dona F3 e4')
    await sql`update teachers set profile_id = ${donaUser}, display_name = 'Dona F3 e4'
              where id = ${s.teacherId}`

    const inst = await createInstance(sql, { contractId: s.contractId, teacherId: s.teacherId }, { startsInHours: 72 })
    const win = await publish(s.teacherId, 6, '15:00')
    const { data: newInst, error } = await s.client.rpc('book_reschedule_window', {
      p_window: win,
      p_instance: inst,
    })
    expect(error).toBeNull()

    const sent: { to: string; subject: string }[] = []
    await sendRescheduleEmails(
      service,
      { newInstanceId: String(newInst), actorUserId: s.userId },
      async (e) => { sent.push(e) },
    )
    const [{ email: donaEmail }] = await sql`select email from auth.users where id = ${donaUser}`
    const to4 = sent.find((e) => e.to === donaEmail)
    expect(to4).toBeDefined() // o destino é o e-mail da conta ADMIN vinculada
    expect(to4!.subject).toContain('remarcou')
  })
})

describe('templates de e-mail aprovados (D14) — funções puras', () => {
  const facts = {
    firstName: 'Bianca',
    studentTz: 'America/New_York',
    // Após a virada de DST de NY (nov/2026): 16:00Z = 11:00 EST.
    oldStartsUtc: '2026-10-30T15:00:00Z', // antes da virada: 11:00 EDT
    newStartsUtc: '2026-11-06T16:00:00Z', // depois: 11:00 EST
    teacherName: 'Teacher Vicky',
    howCharged: 'das suas remarcações do mês (você ainda pode remarcar 3)',
  }

  it('e-mail 3: assunto e corpo com horas LOCAIS corretas dos dois lados do DST', () => {
    const { subject, html } = studentEmail(facts)
    expect(subject).toBe('Aula remarcada ✅ 06/11 às 11:00')
    expect(html).toContain('Oi, Bianca!')
    expect(html).toContain('30/10 às 11:00') // original em EDT
    expect(html).toContain('06/11 às 11:00') // nova em EST
    expect(html).toContain('horário de New York')
    expect(html).toContain('você ainda pode remarcar 3')
    expect(html).toContain('Equipe Personal Teacher')
  })

  it('e-mail 3b: casal — quem remarcou aparece; destinatário é o outro membro', () => {
    const { subject, html } = partnerEmail({
      ...facts,
      studentTz: 'America/Cuiaba',
      oldStartsUtc: '2026-07-15T22:00:00Z', // 18:00 Cuiabá
      newStartsUtc: '2026-07-23T22:00:00Z',
      partnerFirstName: 'Yago',
      whoRescheduled: 'Natália',
    })
    expect(subject).toContain('Natália remarcou a aula de vocês')
    expect(html).toContain('Oi, Yago!')
    expect(html).toContain('23/07 às 18:00')
    expect(html).toContain('horário de Cuiaba')
  })

  it('e-mail 4: professora vê os horários NA ZONA DELA + link para /teacher (F3-D5)', () => {
    // a professora em São Paulo (UTC-3): os MESMOS instantes viram 12:00/13:00 — 1h
    // além de Cuiabá; o hard-code antigo de BUSINESS_TZ mostraria a hora errada.
    const { subject, html } = teacherEmail({
      studentName: 'Bianca Bastos',
      teacherName: 'Renata',
      teacherTz: 'America/Sao_Paulo',
      studentTz: 'America/New_York',
      oldStartsUtc: '2026-11-06T15:00:00Z', // 12:00 SP
      newStartsUtc: '2026-11-06T16:00:00Z', // 13:00 SP
    })
    expect(subject).toBe('Bianca Bastos remarcou: 06/11 às 13:00')
    expect(html).toContain('06/11 às 12:00')
    expect(html).toContain('https://app.personal-teacher.com/teacher') // nota 3b
    expect(html).toContain('Nenhuma ação necessária')

    // a dona/Cuiabá continua exata (regressão do pino antigo).
    const dona = teacherEmail({
      studentName: 'Bianca Bastos',
      teacherName: 'Teacher Vicky',
      teacherTz: 'America/Cuiaba',
      studentTz: 'America/New_York',
      oldStartsUtc: '2026-11-06T15:00:00Z',
      newStartsUtc: '2026-11-06T16:00:00Z',
    })
    expect(dona.subject).toBe('Bianca Bastos remarcou: 06/11 às 12:00')
    expect(dona.html).toContain('06/11 às 11:00')
  })

  it('friendlyTz humaniza a zona', () => {
    expect(friendlyTz('America/New_York')).toBe('horário de New York')
    expect(friendlyTz('America/Campo_Grande')).toBe('horário de Campo Grande')
    expect(friendlyTz('Europe/Lisbon')).toBe('horário de Lisbon')
  })
})
