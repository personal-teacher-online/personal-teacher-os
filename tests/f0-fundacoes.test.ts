// F0 — fundações (plano integrado v2, 18/07/2026): auditoria em profiles/payers
// (migration 20260718000100), título privado do Google (M12-11) e allowlist do
// deep link pós-login (M8-3).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { resolveNextPath } from '@/lib/auth/gate'
import { privateName } from '@/lib/google/calendar'
import { createAuthUser } from './helpers/auth'
import { connect } from './helpers/db'

let sql: Sql

beforeAll(() => {
  sql = connect(2)
})
afterAll(async () => {
  await sql.end()
})

describe('auditoria em profiles e payers (Lei 8)', () => {
  it('mudança no profile gera linha de auditoria com o diff', async () => {
    const id = await createAuthUser(sql, 'student', 'Aluno auditado F0')
    await sql`update profiles set full_name = 'Aluno auditado F0 (editado)' where id = ${id}`
    const rows = await sql`
      select diff from audit_log
      where entity = 'profiles' and entity_id = ${id} and action = 'update'`
    expect(rows.length).toBe(1)
    expect(rows[0].diff.new.full_name).toBe('Aluno auditado F0 (editado)')
    expect(rows[0].diff.old.full_name).toBe('Aluno auditado F0')
  })

  it('insert/update/delete em payers ficam na trilha', async () => {
    const [p] = await sql`insert into payers (name) values ('Pagador F0') returning id`
    await sql`update payers set email = 'pagador-f0@bancada.dev' where id = ${p.id}`
    await sql`delete from payers where id = ${p.id}`
    const rows = await sql`
      select action from audit_log
      where entity = 'payers' and entity_id = ${p.id} order by id`
    expect(rows.map((r) => r.action)).toEqual(['insert', 'update', 'delete'])
  })
})

describe('privateName — título privado no Google (M12-11)', () => {
  it('primeiro nome + inicial do último sobrenome', () => {
    expect(privateName('Sabrina Almeida')).toBe('Sabrina A.')
    expect(privateName('Maria da Silva')).toBe('Maria S.')
  })
  it('nome único fica como está; rótulo de grupo encurta igual', () => {
    expect(privateName('aluno')).toBe('aluno')
    expect(privateName('Casal Silva')).toBe('Casal S.')
  })
})

describe('resolveNextPath — allowlist do deep link (M8-3)', () => {
  it('honra caminho interno permitido ao papel (query preservada)', () => {
    expect(resolveNextPath('student', '/portal/aulas')).toBe('/portal/aulas')
    expect(resolveNextPath('student', '/portal/aulas?x=1')).toBe('/portal/aulas?x=1')
    expect(resolveNextPath('admin', '/teacher')).toBe('/teacher') // admin acessa tudo
  })
  it('rejeita externo, degenerado, área alheia e rotas públicas → home do papel', () => {
    expect(resolveNextPath('student', 'https://evil.example')).toBe('/portal')
    expect(resolveNextPath('student', '//evil.example')).toBe('/portal')
    expect(resolveNextPath('student', '/\\evil.example')).toBe('/portal')
    expect(resolveNextPath('student', '/admin')).toBe('/portal')
    expect(resolveNextPath('student', '/login')).toBe('/portal')
    expect(resolveNextPath('teacher', null)).toBe('/teacher')
    expect(resolveNextPath('teacher', '')).toBe('/teacher')
  })
})
