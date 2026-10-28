// Núcleo 4/5 / N1 — ai_prompts + publish_ai_prompt (N45-D2): casos 6–8 do goal.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect } from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(3)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin prompts'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/** name único por teste — os arquivos rodam em paralelo (gotcha da casa). */
function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

describe('publish_ai_prompt (casos 6 e 7)', () => {
  it('caso 6: publicar 2× → versões 1 e 2, só a 2 ativa, audit', async () => {
    const name = uniqueName('auditoria-aula')
    const v1 = await admin.rpc('publish_ai_prompt', {
      p_name: name, p_content: 'Avalie a aula...', p_model: 'claude-haiku-4-5',
    })
    expect(v1.error).toBeNull()
    expect(v1.data).toBe(1)

    const v2 = await admin.rpc('publish_ai_prompt', {
      p_name: name,
      p_content: 'Avalie a aula (v2)...',
      p_model: 'claude-sonnet-5',
      p_params: { max_tokens: 2048 },
    })
    expect(v2.error).toBeNull()
    expect(v2.data).toBe(2)

    const rows = await sql`
      select version, active, model, params from ai_prompts where name = ${name} order by version`
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ version: 1, active: false })
    expect(rows[1]).toMatchObject({ version: 2, active: true, model: 'claude-sonnet-5' })
    expect(rows[1].params).toEqual({ max_tokens: 2048 })

    const audits = await sql`
      select diff from audit_log
      where action = 'publish_ai_prompt' and diff ->> 'name' = ${name}
      order by id`
    expect(audits).toHaveLength(2)
    expect(audits[1].diff.version).toBe(2)
  })

  it('model vazio é recusado (prompt ativo sem model é estado inválido)', async () => {
    const { error } = await admin.rpc('publish_ai_prompt', {
      p_name: uniqueName('sem-model'), p_content: 'x', p_model: '  ',
    })
    expect(error?.message).toMatch(/p_model/)
  })

  it('caso 7: teacher/student não publicam (D10)', async () => {
    const teacher = await clientAs(await createAuthUser(sql, 'teacher', 'Prof prompts'), 'teacher')
    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno prompts'), 'student')
    for (const client of [teacher, student]) {
      const { error } = await client.rpc('publish_ai_prompt', {
        p_name: uniqueName('nao-admin'), p_content: 'x', p_model: 'claude-haiku-4-5',
      })
      expect(error?.message).toContain('D10')
    }
  })
})

describe('append-only por trigger próprio (caso 8)', () => {
  it('UPDATE de conteúdo, reativação e DELETE são rejeitados; publish segue funcionando', async () => {
    const name = uniqueName('imutavel')
    await admin.rpc('publish_ai_prompt', { p_name: name, p_content: 'v1', p_model: 'm' })
    await admin.rpc('publish_ai_prompt', { p_name: name, p_content: 'v2', p_model: 'm' })

    // como OWNER (conexão direta): o trigger é a última linha de defesa
    await expect(
      sql`update ai_prompts set content = 'hackeado' where name = ${name} and version = 2`,
    ).rejects.toThrow(/append-only/)
    await expect(
      sql`update ai_prompts set model = 'outro' where name = ${name} and version = 2`,
    ).rejects.toThrow(/append-only/)
    // flip active false→true (reativação por fora da RPC) é mutação proibida
    await expect(
      sql`update ai_prompts set active = true where name = ${name} and version = 1`,
    ).rejects.toThrow(/append-only/)
    // flip true→false COM outra coluna alterada também
    await expect(
      sql`update ai_prompts set active = false, content = 'x' where name = ${name} and version = 2`,
    ).rejects.toThrow(/append-only/)
    await expect(sql`delete from ai_prompts where name = ${name}`).rejects.toThrow(/append-only/)

    // por PAPEL via PostgREST: barrado antes, em privilégio (nenhum grant de escrita)
    const direct = await admin.from('ai_prompts').update({ active: false }).eq('name', name)
    expect(direct.error?.message).toMatch(/permission denied/)
    const insert = await admin
      .from('ai_prompts')
      .insert({ name: uniqueName('via-postgrest'), version: 1, content: 'x', model: 'm' })
    expect(insert.error?.message).toMatch(/permission denied/)

    // o fluxo legítimo continua vivo (caso 6)
    const v3 = await admin.rpc('publish_ai_prompt', { p_name: name, p_content: 'v3', p_model: 'm' })
    expect(v3.error).toBeNull()
    expect(v3.data).toBe(3)
    const [active] = await sql`
      select version from ai_prompts where name = ${name} and active`
    expect(active.version).toBe(3)
  })

  it('leitura: admin vê; aluno vê zero linhas (RLS)', async () => {
    const name = uniqueName('leitura')
    await admin.rpc('publish_ai_prompt', { p_name: name, p_content: 'x', p_model: 'm' })

    const viaAdmin = await admin.from('ai_prompts').select('version').eq('name', name)
    expect(viaAdmin.data).toHaveLength(1)

    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno lê prompts'), 'student')
    const viaStudent = await student.from('ai_prompts').select('version').eq('name', name)
    expect(viaStudent.error).toBeNull()
    expect(viaStudent.data).toHaveLength(0)
  })
})
