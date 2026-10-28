// Fase 3 / M1 — provisionamento parametrizado (F3-D1) + vínculo da dona (F3-D1b).
// Casos 1–4 do goal. Mesmo padrão do auth.test.ts: client service injetado, fluxo real.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { HOME_BY_ROLE, roleFromUser } from '../src/lib/auth/gate'
import {
  linkTeacherToExistingProfile,
  provisionStudent,
  provisionTeacher,
} from '../src/lib/auth/provision'
import { anonClient, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createStudent } from './helpers/db'

const service = serviceClient()

let sql: Sql
/** Ator do convite de ALUNO: a RPC do nascimento exige (ver o cabeçalho do
 *  mesmo campo em `auth.test.ts`). A professora não passa por ela. */
let atorDoConvite: string
beforeAll(async () => {
  sql = connect(2)
  atorDoConvite = await createAuthUser(sql, 'admin', 'Admin F3M1')
})
afterAll(async () => {
  await sql.end()
})

function randomEmail(): string {
  return `f3m1-${crypto.randomUUID().slice(0, 12)}@bancada.dev`
}

async function createTeacherRow(tz = 'America/Sao_Paulo'): Promise<string> {
  const [t] = await sql`
    insert into teachers (hourly_rate_cents, display_name, iana_tz)
    values (5000, ${'Prof M1 ' + crypto.randomUUID().slice(0, 6)}, ${tz})
    returning id`
  return t.id as string
}

describe('caso 1: convite de professora existente (F3-D1)', () => {
  it('cria auth user teacher + profile (iana_tz de TEACHERS) + vincula + audita', async () => {
    const teacherId = await createTeacherRow('America/Sao_Paulo')
    const email = randomEmail()

    const outcome = await provisionTeacher(service, teacherId, email, null)
    expect(outcome.status).toBe('invited')
    const userId = (outcome as { userId: string }).userId

    const { data: got } = await service.auth.admin.getUserById(userId)
    expect(got?.user?.app_metadata?.role).toBe('teacher')
    expect(got?.user?.email_confirmed_at ?? null).toBeNull() // ativa só no clique

    const [profile] = await sql`
      select role, iana_tz from profiles where id = ${userId}`
    expect(profile.role).toBe('teacher')
    expect(profile.iana_tz).toBe('America/Sao_Paulo') // F3-D2b: copiado de teachers

    const [teacher] = await sql`select profile_id from teachers where id = ${teacherId}`
    expect(teacher.profile_id).toBe(userId)

    const [auditRow] = await sql`
      select diff from audit_log
      where action = 'invite_teacher' and entity_id = ${teacherId}`
    expect(auditRow).toBeDefined()

    // Ativação pelo link do convite → papel teacher → home /teacher (página real).
    const [{ confirmation_token }] = await sql`
      select confirmation_token from auth.users where id = ${userId}`
    const client = anonClient()
    const { data, error } = await client.auth.verifyOtp({
      type: 'invite',
      token_hash: confirmation_token,
    })
    expect(error).toBeNull()
    expect(roleFromUser(data.user)).toBe('teacher')
    expect(HOME_BY_ROLE[roleFromUser(data.user)!]).toBe('/teacher')
  })

  it('re-convite reenvia sem duplicar; e-mail diferente → erro claro', async () => {
    const teacherId = await createTeacherRow()
    const email = randomEmail()
    expect((await provisionTeacher(service, teacherId, email, null)).status).toBe('invited')
    expect((await provisionTeacher(service, teacherId, email, null)).status).toBe('re_invited')
    const other = await provisionTeacher(service, teacherId, randomEmail(), null)
    expect(other.status).toBe('error')
    expect((other as { message: string }).message).toContain('outro e-mail')
  })
})

describe('caso 3: órfão cross-flow adotado com auditoria do papel anterior (F3-D1b)', () => {
  it('órfão de convite de ALUNO + convite de PROFESSORA → estado final 100% teacher', async () => {
    const email = randomEmail()
    // Órfão: auth user role student SEM profile (crash simulado entre createUser e vínculo).
    await service.auth.admin.createUser({ email, app_metadata: { role: 'student' } })

    const teacherId = await createTeacherRow()
    const outcome = await provisionTeacher(service, teacherId, email, null)
    expect(outcome.status).toBe('invited')
    const userId = (outcome as { userId: string }).userId

    const { data: got } = await service.auth.admin.getUserById(userId)
    expect(got?.user?.app_metadata?.role).toBe('teacher')
    const [profile] = await sql`select role from profiles where id = ${userId}`
    expect(profile.role).toBe('teacher')
    const [{ count }] = await sql`
      select count(*)::int as count from students where profile_id = ${userId}`
    expect(count).toBe(0) // nenhum aluno o referencia

    // Lei 8: a troca de papel ficou gravada.
    const [auditRow] = await sql`
      select diff from audit_log
      where action = 'invite_teacher' and entity_id = ${teacherId}`
    expect(auditRow.diff.adotado).toBe(true)
    expect(auditRow.diff.papel_anterior).toBe('student')
  })
})

describe('caso 4: usuário COM profile nunca é tomado nem rebaixado', () => {
  it('aluno completo + convite de professora com o mesmo e-mail → erro; nada muda', async () => {
    const email = randomEmail()
    const studentId = await createStudent(sql)
    const first = await provisionStudent(service, studentId, email, atorDoConvite, '+5565900000001')
    const studentUserId = (first as { userId: string }).userId

    const teacherId = await createTeacherRow()
    const outcome = await provisionTeacher(service, teacherId, email, null)
    expect(outcome.status).toBe('error')
    expect((outcome as { message: string }).message).toContain('já pertence')

    const { data: got } = await service.auth.admin.getUserById(studentUserId)
    expect(got?.user?.app_metadata?.role).toBe('student') // jamais rebaixado
    const [teacher] = await sql`select profile_id from teachers where id = ${teacherId}`
    expect(teacher.profile_id).toBeNull()
  })
})

describe('caso 2: vínculo da dona (F3-D1b, decisão P1)', () => {
  it('vincula teacher-row a conta admin EXISTENTE sem createUser e sem tocar no papel', async () => {
    const email = randomEmail()
    const { data: created } = await service.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { role: 'admin' },
    })
    const adminUserId = created!.user!.id
    await sql`insert into profiles (id, role, full_name, iana_tz)
              values (${adminUserId}, 'admin', 'Dona M1', 'America/Cuiaba')`

    const teacherId = await createTeacherRow('America/Cuiaba')

    const outcome = await linkTeacherToExistingProfile(service, teacherId, email, null)
    expect(outcome.status).toBe('linked')

    // SEM createUser: continua existindo UMA conta com este e-mail (a original).
    const [{ n }] = await sql`
      select count(*)::int as n from auth.users where email = ${email}`
    expect(n).toBe(1)

    const { data: got } = await service.auth.admin.getUserById(adminUserId)
    expect(got?.user?.app_metadata?.role).toBe('admin') // papel INTOCADO
    const [profile] = await sql`select role from profiles where id = ${adminUserId}`
    expect(profile.role).toBe('admin')
    const [teacher] = await sql`select profile_id from teachers where id = ${teacherId}`
    expect(teacher.profile_id).toBe(adminUserId)

    const [auditRow] = await sql`
      select diff from audit_log
      where action = 'link_teacher_profile' and entity_id = ${teacherId}`
    expect(auditRow.diff.papel_do_perfil).toBe('admin')

    // Idempotência/erros do vínculo:
    const again = await linkTeacherToExistingProfile(service, teacherId, email, null)
    expect(again.status).toBe('error') // já vinculada
    const ghost = await linkTeacherToExistingProfile(
      service, await createTeacherRow(), randomEmail(), null)
    expect(ghost.status).toBe('error') // conta inexistente → use o convite
  })

  it('conta órfã (sem profile) no vínculo → erro apontando para o CONVITE', async () => {
    const email = randomEmail()
    await service.auth.admin.createUser({ email, app_metadata: { role: 'teacher' } })
    const outcome = await linkTeacherToExistingProfile(
      service, await createTeacherRow(), email, null)
    expect(outcome.status).toBe('error')
    expect((outcome as { message: string }).message).toContain('CONVITE')
  })

  it('painel final: conta de ALUNO existente no vínculo → erro; profile_id fica NULL', async () => {
    // Vincular conta student daria à pessoa teacher_agenda + teachers_self
    // (hourly_rate_cents) via my_teacher_id() — recusado ANTES do UPDATE.
    const email = randomEmail()
    const studentId = await createStudent(sql)
    const provisioned = await provisionStudent(service, studentId, email, atorDoConvite, '+5565900000001')
    expect(provisioned.status).toBe('invited') // conta student COMPLETA (com profile)

    const teacherId = await createTeacherRow()
    const outcome = await linkTeacherToExistingProfile(service, teacherId, email, null)
    expect(outcome.status).toBe('error')
    expect((outcome as { message: string }).message).toContain("papel 'student'")
    const [teacher] = await sql`select profile_id from teachers where id = ${teacherId}`
    expect(teacher.profile_id).toBeNull()
  })
})

describe('F3-D1a: papel é literal server-side', () => {
  it("pino de fonte: só 'student' | 'teacher'; 'admin' jamais provisionável", async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/lib/auth/provision.ts', 'utf8'),
    )
    expect(src).toMatch(/role !== 'student' && role !== 'teacher'/) // guarda runtime
    expect(src).not.toMatch(/app_metadata:\s*\{\s*role:\s*['"]admin/)
  })
})
