// Ciclo de vida da professora (migration 20260715001200): apagar só sem
// história; arquivar o resto; posse admin (D10) e auditoria (Lei 8).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract, createTeacher } from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin lifecycle'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

async function nameTeacher(id: string, name: string) {
  await sql`update teachers set display_name = ${name} where id = ${id}`
}

describe('delete_teacher', () => {
  it('apaga professora SEM história e audita', async () => {
    const t = await createTeacher(sql)
    await nameTeacher(t, 'Teste Descartável')
    const { data, error } = await admin.rpc('delete_teacher', { p_teacher: t })
    expect(error).toBeNull()
    expect(data).toBeNull() // sem profile_id vinculado
    const [row] = await sql`select count(*)::int as n from teachers where id = ${t}`
    expect(row.n).toBe(0)
    const [aud] = await sql`select count(*)::int as n from audit_log where action = 'delete_teacher' and entity_id = ${t}`
    expect(aud.n).toBe(1)
  })

  it('RECUSA apagar professora COM história (contrato) — código estável', async () => {
    const c = await createPrivateContract(sql)
    await nameTeacher(c.teacherId, 'Com Contrato')
    const { error } = await admin.rpc('delete_teacher', { p_teacher: c.teacherId })
    expect(error?.message).toContain('PROFESSORA_COM_HISTORICO')
    const [row] = await sql`select count(*)::int as n from teachers where id = ${c.teacherId}`
    expect(row.n).toBe(1) // continua lá
  })

  it('RECUSA apagar a dona', async () => {
    const t = await createTeacher(sql)
    await sql`update teachers set display_name = 'Dona', is_owner = true where id = ${t}`
    const { error } = await admin.rpc('delete_teacher', { p_teacher: t })
    expect(error?.message).toContain('dona')
  })

  it('aluno NÃO apaga professora (D10)', async () => {
    const t = await createTeacher(sql)
    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno'), 'student')
    const { error } = await student.rpc('delete_teacher', { p_teacher: t })
    expect(error?.message).toContain('D10')
    const [row] = await sql`select count(*)::int as n from teachers where id = ${t}`
    expect(row.n).toBe(1)
  })

  it('retorna o profile_id do convite pendente (para a action limpar o Auth)', async () => {
    const t = await createTeacher(sql)
    const fakeProfile = await createAuthUser(sql, 'teacher', 'Pendente')
    await sql`update teachers set display_name = 'Pendente', profile_id = ${fakeProfile} where id = ${t}`
    const { data, error } = await admin.rpc('delete_teacher', { p_teacher: t })
    expect(error).toBeNull()
    expect(data).toBe(fakeProfile)
  })
})

describe('set_teacher_archived', () => {
  it('arquiva e reativa, sempre auditando', async () => {
    const c = await createPrivateContract(sql) // com história → arquivar é o caminho
    await nameTeacher(c.teacherId, 'Arquivável')

    const arch = await admin.rpc('set_teacher_archived', { p_teacher: c.teacherId, p_archived: true })
    expect(arch.error).toBeNull()
    const [a] = await sql`select archived_at from teachers where id = ${c.teacherId}`
    expect(a.archived_at).not.toBeNull()

    const un = await admin.rpc('set_teacher_archived', { p_teacher: c.teacherId, p_archived: false })
    expect(un.error).toBeNull()
    const [b] = await sql`select archived_at from teachers where id = ${c.teacherId}`
    expect(b.archived_at).toBeNull()

    const [aud] = await sql`
      select count(*)::int as n from audit_log
      where entity_id = ${c.teacherId} and action in ('archive_teacher', 'unarchive_teacher')`
    expect(aud.n).toBe(2)
  })

  it('RECUSA arquivar a dona', async () => {
    const t = await createTeacher(sql)
    await sql`update teachers set display_name = 'Dona2', is_owner = true where id = ${t}`
    const { error } = await admin.rpc('set_teacher_archived', { p_teacher: t, p_archived: true })
    expect(error?.message).toContain('dona')
  })
})
