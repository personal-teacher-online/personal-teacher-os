// Fase 3 / M0 — caminho TEACHER nas janelas (F3-D6), fuso próprio (F3-D2) e a
// policy nova de reschedule_windows (F3-D7). Casos 5–9, 12 e 31 (parcial) do goal.
// Padrão da suíte: fixtures próprias — re-executável sem reset.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { resolveAccess, roleFromUser } from '../src/lib/auth/gate'
import { clientAs, serviceClient } from './helpers/auth'
import {
  connect,
  createInstance,
  createPrivateContract,
  createStudent,
  instanteEm,
} from './helpers/db'

const service = serviceClient()

let sql: Sql
beforeAll(() => {
  sql = connect(2)
})
afterAll(async () => {
  await sql.end()
})

/** Usuário de teste via admin API (NUNCA INSERT cru em auth.users: linhas com
 *  colunas NULL que o GoTrue não espera quebram o listUsers dos outros testes). */
async function createAuthUser(role: 'admin' | 'teacher' | 'student'): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `f3-${crypto.randomUUID().slice(0, 12)}@bancada.dev`,
    email_confirm: true,
    app_metadata: { role },
  })
  if (error) throw error
  return data.user!.id
}

/** Professora de teste COM login: teachers.profile_id → auth user com papel teacher. */
async function createTeacherWithLogin(
  tz = 'America/Cuiaba',
): Promise<{ teacherId: string; userId: string }> {
  const userId = await createAuthUser('teacher')
  await sql`insert into profiles (id, role, full_name, iana_tz)
            values (${userId}, 'teacher', 'Prof F3', ${tz})`
  const [t] = await sql`
    insert into teachers (hourly_rate_cents, display_name, iana_tz, profile_id)
    values (5000, ${'Prof F3 ' + crypto.randomUUID().slice(0, 6)}, ${tz}, ${userId})
    returning id`
  return { teacherId: t.id as string, userId }
}

function futureDate(days: number): string {
  const d = new Date(Date.now() + days * 86400000)
  return d.toISOString().slice(0, 10)
}

/** Aluno de teste COM login vinculado ao students.profile_id (padrão do arquivo). */
async function createStudentWithLogin(): Promise<{ studentId: string; profileId: string }> {
  const studentId = await createStudent(sql)
  const profileId = await createAuthUser('student')
  // O número é canal de CONTRATO (A6/i): o gatilho `students_lead_sem_login`
  // recusa vincular acesso a perfil sem `whatsapp_e164`. Fixture de aluno com
  // login representa a conta NORMAL, a que nasceu pelo convite — e o convite
  // exige o número.
  await sql`
    insert into profiles (id, role, full_name, whatsapp_e164)
    values (${profileId}, 'student', 'Aluno F3', '+5565900060006')`
  await sql`update students set profile_id = ${profileId} where id = ${studentId}`
  return { studentId, profileId }
}

describe('F3-D2: fuso próprio da professora', () => {
  it('pino do backfill/seed: A professora = America/Sao_Paulo; a dona = Cuiabá', async () => {
    const [parceira] = await sql`select iana_tz from teachers where display_name = 'Renata'`
    expect(parceira.iana_tz).toBe('America/Sao_Paulo')
    const [dona] = await sql`select iana_tz from teachers where display_name = 'Teacher Vicky'`
    expect(dona.iana_tz).toBe('America/Cuiaba')
  })

  it('zona inválida é rejeitada pelo trigger (ADR-004)', async () => {
    await expect(
      sql`insert into teachers (hourly_rate_cents, iana_tz) values (1000, 'EST')`,
    ).rejects.toThrow(/iana/i)
  })
})

describe('F3-D6: professora publica/cancela as PRÓPRIAS janelas', () => {
  it('publica para si SEM p_iana_tz → janela no fuso DELA (São Paulo)', async () => {
    const { teacherId, userId } = await createTeacherWithLogin('America/Sao_Paulo')
    const client = await clientAs(userId, 'teacher')
    const date = futureDate(7)

    // A6/a: o painel dela mostra o relógio DELA, então quem converte "10:00 de
    // São Paulo" em instante é o TypeScript da action (aqui, o helper) — a RPC
    // recebe o instante pronto.
    const { data: winId, error } = await client.rpc('publish_reschedule_window', {
      p_teacher: teacherId,
      p_starts_at_utc: instanteEm(date, '10:00', 'America/Sao_Paulo'),
    })
    expect(error).toBeNull()

    const [win] = await sql`
      select iana_tz, starts_at_utc, local_date::text as local_date,
             local_time::text as local_time, local_time_snapshot, teacher_id, state
      from reschedule_windows where id = ${winId}`
    expect(win.iana_tz).toBe('America/Sao_Paulo')
    expect(win.state).toBe('publicada')
    // O instante UTC corresponde a 10:00 DE SÃO PAULO daquele dia (Lei 1).
    const [conv] = await sql`
      select ((${date}::date + time '10:00') at time zone 'America/Sao_Paulo') as expected`
    expect(new Date(win.starts_at_utc).toISOString()).toBe(new Date(conv.expected).toISOString())
    // …e os campos CIVIS da janela são lidos na zona DELA, não em Cuiabá — é o
    // que "sem p_iana_tz = fuso da professora" significa depois do A6/a.
    expect(win.local_date).toBe(date)
    expect(win.local_time).toBe('10:00:00')
    expect(win.local_time_snapshot).toBe(`${date} 10:00 America/Sao_Paulo`)
  })

  it('publicar para OUTRA professora → exceção; nada criado', async () => {
    const a = await createTeacherWithLogin()
    const b = await createTeacherWithLogin()
    const client = await clientAs(a.userId, 'teacher')

    const { error } = await client.rpc('publish_reschedule_window', {
      p_teacher: b.teacherId,
      p_starts_at_utc: instanteEm(futureDate(7), '11:00'),
    })
    expect(error?.message).toMatch(/PARA SI/i)
    const [{ count }] = await sql`
      select count(*)::int as count from reschedule_windows where teacher_id = ${b.teacherId}`
    expect(count).toBe(0)
  })

  it('professora informando p_iana_tz → exceção (fuso vem de teachers.iana_tz)', async () => {
    const { teacherId, userId } = await createTeacherWithLogin()
    const client = await clientAs(userId, 'teacher')
    const { error } = await client.rpc('publish_reschedule_window', {
      p_teacher: teacherId,
      p_starts_at_utc: instanteEm(futureDate(7), '11:00', 'America/Cuiaba'),
      p_iana_tz: 'America/Cuiaba',
    })
    expect(error?.message).toMatch(/teachers\.iana_tz/i)
  })

  it('cancela a própria janela publicada; a de OUTRA professora → exceção', async () => {
    const a = await createTeacherWithLogin()
    const b = await createTeacherWithLogin()
    const clientA = await clientAs(a.userId, 'teacher')
    const clientB = await clientAs(b.userId, 'teacher')

    const { data: winA } = await clientA.rpc('publish_reschedule_window', {
      p_teacher: a.teacherId,
      p_starts_at_utc: instanteEm(futureDate(8), '09:00'),
    })

    // B tenta cancelar a janela de A → exceção de posse; janela intacta.
    const denied = await clientB.rpc('cancel_reschedule_window', { p_window: winA })
    expect(denied.error?.message).toMatch(/não pertence/i)
    const [still] = await sql`select state from reschedule_windows where id = ${winA}`
    expect(still.state).toBe('publicada')

    // A cancela a própria → cancelada + auditoria.
    const ok = await clientA.rpc('cancel_reschedule_window', { p_window: winA })
    expect(ok.error).toBeNull()
    const [after] = await sql`select state from reschedule_windows where id = ${winA}`
    expect(after.state).toBe('cancelada')
  })

  it('aluno e sales não publicam nem cancelam (D10/F2)', async () => {
    const { teacherId } = await createTeacherWithLogin()
    const { profileId } = await createStudentWithLogin()

    for (const role of ['student', 'sales'] as const) {
      const client = await clientAs(profileId, role)
      const { error } = await client.rpc('publish_reschedule_window', {
        p_teacher: teacherId,
        p_starts_at_utc: instanteEm(futureDate(7), '14:00'),
      })
      expect(error).not.toBeNull()
      // Cancel também é vedado (uuid qualquer: o gate de papel dispara antes do SELECT).
      const denied = await client.rpc('cancel_reschedule_window', { p_window: crypto.randomUUID() })
      expect(denied.error).not.toBeNull()
    }
  })

  it('caso 9: professora NÃO cancela a própria janela CONSUMIDA (D15/F2)', async () => {
    const a = await createTeacherWithLogin()
    const clientA = await clientAs(a.userId, 'teacher')
    // Contrato DE A + aluno com login. c15 · Sol 6: o helper passou a aceitar
    // `teacherId` porque trocar a professora depois virou recusa do gatilho
    // `contracts_vinculo_imutavel` — o vínculo é identidade do contrato.
    const c = await createPrivateContract(sql, { teacherId: a.teacherId })
    const profileId = await createAuthUser('student')
    // A6/i: acesso não nasce sem WhatsApp (o gatilho recusa o vínculo abaixo).
    await sql`insert into profiles (id, role, full_name, whatsapp_e164)
              values (${profileId}, 'student', 'Aluno F3', '+5565900070007')`
    await sql`update students set profile_id = ${profileId} where id = ${c.studentId}`
    const studentClient = await clientAs(profileId, 'student')
    const inst = await createInstance(
      sql,
      { contractId: c.contractId, teacherId: a.teacherId },
      { startsInHours: 72 },
    )

    const { data: winId, error: pubErr } = await clientA.rpc('publish_reschedule_window', {
      p_teacher: a.teacherId,
      p_starts_at_utc: instanteEm(futureDate(7), '16:00'),
    })
    expect(pubErr).toBeNull()
    const booked = await studentClient.rpc('book_reschedule_window', {
      p_window: winId,
      p_instance: inst,
    })
    expect(booked.error).toBeNull()

    // A professora DONA atravessa a checagem de posse e cai na de estado (D15):
    // consumida não cancela nem reabre.
    const denied = await clientA.rpc('cancel_reschedule_window', { p_window: winId })
    expect(denied.error?.message).toMatch(/não está publicada/)
    const [after] = await sql`select state from reschedule_windows where id = ${winId}`
    expect(after.state).toBe('consumida')
  })

  it('caso 7 (ponta final): aluno reserva pelo portal janela publicada PELA PROFESSORA', async () => {
    const { teacherId, userId } = await createTeacherWithLogin('America/Sao_Paulo')
    const teacherClient = await clientAs(userId, 'teacher')
    const c = await createPrivateContract(sql, { teacherId })
    const profileId = await createAuthUser('student')
    // A6/i: acesso não nasce sem WhatsApp (o gatilho recusa o vínculo abaixo).
    await sql`insert into profiles (id, role, full_name, whatsapp_e164)
              values (${profileId}, 'student', 'Aluno F3', '+5565900070007')`
    await sql`update students set profile_id = ${profileId} where id = ${c.studentId}`
    const studentClient = await clientAs(profileId, 'student')
    const inst = await createInstance(
      sql,
      { contractId: c.contractId, teacherId },
      { startsInHours: 72 },
    )

    const { data: winId, error: pubErr } = await teacherClient.rpc('publish_reschedule_window', {
      p_teacher: teacherId,
      p_starts_at_utc: instanteEm(futureDate(7), '10:00', 'America/Sao_Paulo'),
    })
    expect(pubErr).toBeNull()

    const { data: newId, error } = await studentClient.rpc('book_reschedule_window', {
      p_window: winId,
      p_instance: inst,
    })
    expect(error).toBeNull()
    const [w] = await sql`
      select state, consumed_by_instance_id, starts_at_utc from reschedule_windows where id = ${winId}`
    expect(w.state).toBe('consumida')
    expect(w.consumed_by_instance_id).toBe(newId)
    // Invariante D1/F2: o instante da instância criada É o publicado, byte a byte.
    const [ni] = await sql`select starts_at_utc from class_instances where id = ${newId}`
    expect(new Date(ni.starts_at_utc).toISOString()).toBe(new Date(w.starts_at_utc).toISOString())
    // Sem cenário DST aqui: professoras BR não têm DST; a conversão por dia já está
    // pinada no teste de publicação acima — nada a fazer até existir professora em
    // zona com DST.
  })
})

describe('F3-D7: policy nova de reschedule_windows (professora lista as próprias)', () => {
  it('A vê as próprias janelas em QUALQUER estado; as de B, nunca', async () => {
    const a = await createTeacherWithLogin()
    const b = await createTeacherWithLogin()
    const clientA = await clientAs(a.userId, 'teacher')

    const { data: w1 } = await clientA.rpc('publish_reschedule_window', {
      p_teacher: a.teacherId,
      p_starts_at_utc: instanteEm(futureDate(9), '10:00'),
    })
    await clientA.rpc('cancel_reschedule_window', { p_window: w1 })
    const { data: w2 } = await clientA.rpc('publish_reschedule_window', {
      p_teacher: a.teacherId,
      p_starts_at_utc: instanteEm(futureDate(9), '11:00'),
    })
    const clientB = await clientAs(b.userId, 'teacher')
    const { data: w3 } = await clientB.rpc('publish_reschedule_window', {
      p_teacher: b.teacherId,
      p_starts_at_utc: instanteEm(futureDate(9), '12:00'),
    })

    const mine = await clientA.from('reschedule_windows').select('id, state')
    const ids = mine.data?.map((r) => r.id) ?? []
    expect(ids).toContain(w1) // cancelada — qualquer estado
    expect(ids).toContain(w2) // publicada
    expect(ids).not.toContain(w3) // de B, jamais

    // Escrita direta continua bloqueada (sem DML de cliente — só RPCs).
    const upd = await clientA
      .from('reschedule_windows')
      .update({ state: 'cancelada' })
      .eq('id', w2)
      .select()
    expect(upd.data ?? []).toEqual([])
  })
})

describe('F3-D2: caminho ADMIN — default do fuso = teachers.iana_tz', () => {
  /** Admin de teste (auth user + profile) — padrão de rls.test.ts adaptado ao arquivo. */
  async function createAdminClient() {
    const adminId = await createAuthUser('admin')
    await sql`insert into profiles (id, role, full_name) values (${adminId}, 'admin', 'Admin F3')`
    return clientAs(adminId, 'admin')
  }

  it('admin SEM p_iana_tz: os campos CIVIS saem no fuso DA PROFESSORA (não em business_tz)', async () => {
    const admin = await createAdminClient()
    const [t] = await sql`
      insert into teachers (hourly_rate_cents, display_name, iana_tz)
      values (5000, ${'Prof F3 admin ' + crypto.randomUUID().slice(0, 6)}, 'America/Sao_Paulo')
      returning id`
    const date = futureDate(10)

    // A6/a: o INSTANTE não depende mais de zona nenhuma (ele chega decidido); o
    // que `p_iana_tz` ausente decide é a zona em que a janela grava data, hora e
    // snapshot — e ela é a da PROFESSORA. Publicando o instante das 10:00 de São
    // Paulo, os campos civis têm de dizer 10:00; se a RPC tivesse caído em
    // Cuiabá, diriam 09:00.
    const { data: winId, error } = await admin.rpc('publish_reschedule_window', {
      p_teacher: t.id,
      p_starts_at_utc: instanteEm(date, '10:00', 'America/Sao_Paulo'),
    })
    expect(error).toBeNull()
    const [win] = await sql`
      select iana_tz, starts_at_utc, local_date::text as local_date,
             local_time::text as local_time, local_time_snapshot
        from reschedule_windows where id = ${winId}`
    expect(win.iana_tz).toBe('America/Sao_Paulo')
    // Cálculo INDEPENDENTE (nunca contra a própria win.iana_tz — seria tautológico).
    const [conv] = await sql`
      select ((${date}::date + time '10:00') at time zone 'America/Sao_Paulo') as expected`
    expect(new Date(win.starts_at_utc).toISOString()).toBe(new Date(conv.expected).toISOString())
    expect(win.local_date).toBe(date)
    expect(win.local_time).toBe('10:00:00')
    expect(win.local_time_snapshot).toBe(`${date} 10:00 America/Sao_Paulo`)
  })

  it('override p_iana_tz explícito segue EXCLUSIVO da admin e funcionando', async () => {
    const admin = await createAdminClient()
    const [t] = await sql`
      insert into teachers (hourly_rate_cents, display_name, iana_tz)
      values (5000, ${'Prof F3 admin ' + crypto.randomUUID().slice(0, 6)}, 'America/Sao_Paulo')
      returning id`
    const date = futureDate(10)

    const { data: winId, error } = await admin.rpc('publish_reschedule_window', {
      p_teacher: t.id,
      p_starts_at_utc: instanteEm(date, '11:00', 'America/Cuiaba'),
      p_iana_tz: 'America/Cuiaba',
    })
    expect(error).toBeNull()
    const [win] = await sql`select iana_tz, starts_at_utc from reschedule_windows where id = ${winId}`
    expect(win.iana_tz).toBe('America/Cuiaba')
    const [conv] = await sql`
      select ((${date}::date + time '11:00') at time zone 'America/Cuiaba') as expected`
    expect(new Date(win.starts_at_utc).toISOString()).toBe(new Date(conv.expected).toISOString())
  })
})

describe('caso 13: papel forjado teacher em user_metadata não passa (Lei 4)', () => {
  it('gate E banco recusam o forjado (superfícies teacher da Fase 3)', async () => {
    const { teacherId } = await createTeacherWithLogin()
    const { profileId } = await createStudentWithLogin()
    // Aluno com 'teacher' forjado em user_metadata: app_role() lê SÓ app_metadata → 'none'.
    const forged = await clientAs(profileId, 'teacher', { forgeInUserMetadata: true })

    // (a) agenda de professora: zero linhas, sem erro.
    const agenda = await forged.from('teacher_agenda').select('id').limit(5)
    expect(agenda.error).toBeNull()
    expect(agenda.data).toEqual([])

    // (b) RPC de janela: recusada no banco (ramo D10 — nem admin nem professora).
    const denied = await forged.rpc('publish_reschedule_window', {
      p_teacher: teacherId,
      p_starts_at_utc: instanteEm(futureDate(7), '15:00'),
    })
    expect(denied.error).not.toBeNull()

    // (c) o gate do app também ignora user_metadata (espelho do caso 12: gate E banco).
    const forgedUser = { user_metadata: { role: 'teacher' }, app_metadata: {} }
    expect(roleFromUser(forgedUser)).toBeNull()
    expect(resolveAccess(null, '/teacher')).toEqual({ kind: 'redirect', to: '/login' })
  })
})

describe('painel final: /teacher da admin vinculada (F3-D1b) mostra SÓ o próprio teacher_id', () => {
  it('pino de fonte: janelas e extratos filtram por teacher.id (as policies admin_all veriam tudo)', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/app/teacher/page.tsx', 'utf8'),
    )
    const matches = src.match(/\.eq\('teacher_id', teacher\.id\)/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2) // reschedule_windows E teacher_statements
  })
})

describe('F3-D9: EXECUTE das funções novas (parcial — caso 31)', () => {
  it('enqueue_credit_expiry_notices não é chamável por authenticated', async () => {
    const { userId } = await createTeacherWithLogin()
    const client = await clientAs(userId, 'teacher')
    const { error } = await client.rpc('enqueue_credit_expiry_notices')
    expect(error).not.toBeNull()
    // Pino exato (padrão rls.test.ts): match frouxo passaria até se a função não existisse.
    expect(error!.code).toBe('42501')
  })
})

describe('F3-D7/M2: view teacher_agenda (nome do aluno SEM reabrir contracts)', () => {
  it('professora vê as próprias aulas com o nome do aluno; as de outra, nunca; aluno vê zero', async () => {
    const a = await createTeacherWithLogin()
    const b = await createTeacherWithLogin()
    const studentId = await createStudent(sql)
    const [c] = await sql`
      insert into contracts
        (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents, status,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${studentId}, ${a.teacherId}, 'M2 agenda', 12345, 'active',
              4, 24, 90, '2026-01-05')
      returning id`
    await sql`
      insert into class_instances (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${c.id}, ${a.teacherId}, now() + interval '2 day', now() + interval '2 day 45 min', 'm2 view')`

    const clientA = await clientAs(a.userId, 'teacher')
    const mine = await clientA
      .from('teacher_agenda')
      .select('student_label, local_time_snapshot')
      .eq('contract_id', c.id)
    expect(mine.error).toBeNull()
    expect(mine.data).toHaveLength(1)
    expect(mine.data![0].student_label).toMatch(/^Aluno /) // nome vem da view enxuta

    const clientB = await clientAs(b.userId, 'teacher')
    const theirs = await clientB.from('teacher_agenda').select('id').eq('contract_id', c.id)
    expect(theirs.data).toEqual([]) // de outra professora, jamais

    // A view NÃO expõe colunas de contrato (hourly_rate_cents/plan_name fora do shape).
    const shape = await clientA.from('teacher_agenda').select('*').limit(1)
    const cols = Object.keys(shape.data?.[0] ?? {})
    expect(cols).not.toContain('hourly_rate_cents')
    expect(cols).not.toContain('plan_name')

    // Aluno logado não lê a view de professora.
    const studentUser = await createAuthUser('student')
    await sql`insert into profiles (id, role, full_name) values (${studentUser}, 'student', 'Aluno M2')`
    const studentClient = await clientAs(studentUser, 'student')
    const asStudent = await studentClient.from('teacher_agenda').select('id')
    expect(asStudent.data ?? []).toEqual([])
  })
})
