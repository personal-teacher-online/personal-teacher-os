// POSSE POR TOKEN do rascunho por IA assíncrono (after()). Integração contra o
// Supabase local: prova que reivindicações concorrentes não se cruzam e que a
// gravação atômica (slide_lesson_save_draft) só grava com posse + baseline.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect } from './helpers/db'
import { DRAFT_TTL_MS } from '@/lib/slides/draft-state'

let sql: Sql
let admin: SupabaseClient
const COURSE = `draftown-${crypto.randomUUID().slice(0, 8)}`

const conteudo = (marker = 'v1') => ({ slides: [{ type: 'objectives', items: ['a', 'b'] }], marker })

async function novaAula(lesson: number): Promise<string> {
  const { data, error } = await admin.rpc('slide_lesson_create', {
    p_course: COURSE,
    p_module: 5,
    p_lesson: lesson,
    p_title: 'Draft own',
    p_content: conteudo(),
  })
  expect(error).toBeNull()
  return data as string
}

// Réplica EXATA da reivindicação atômica da draftWithAIAction.
async function claim(id: string) {
  const jobId = crypto.randomUUID()
  const cutoff = new Date(Date.now() - DRAFT_TTL_MS).toISOString()
  const { data } = await admin
    .from('slide_lessons')
    .update({ draft_started_at: new Date().toISOString(), draft_error: null, draft_job_id: jobId })
    .eq('id', id)
    .eq('status', 'rascunho')
    .or(`draft_started_at.is.null,draft_started_at.lt.${cutoff}`)
    .select('updated_at, draft_job_id')
    .maybeSingle()
  return { jobId, row: data as { updated_at: string; draft_job_id: string } | null }
}

beforeAll(async () => {
  sql = connect(2)
  const adminId = await createAuthUser(sql, 'admin', 'Admin draft-own')
  admin = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  await sql.end()
})

describe('rascunho por IA — posse por token', () => {
  it('duas reivindicações concorrentes: só UMA vence', async () => {
    const id = await novaAula(1)
    const a = await claim(id)
    const b = await claim(id) // enquanto a de "a" está em voo (recente)
    expect(a.row?.draft_job_id).toBe(a.jobId)
    expect(b.row).toBeNull() // 2ª afeta 0 linhas
  })

  it('desfecho de job SEM posse afeta 0 linhas (não sobrescreve o dono)', async () => {
    const id = await novaAula(2)
    const a = await claim(id)
    expect(a.row).not.toBeNull()
    const outroToken = crypto.randomUUID()
    const { data } = await admin
      .from('slide_lessons')
      .update({ draft_started_at: null, draft_error: 'x', draft_job_id: null })
      .eq('id', id)
      .eq('draft_job_id', outroToken)
      .select('id')
    expect((data ?? []).length).toBe(0)
    const [row] = await sql`select draft_job_id from slide_lessons where id = ${id}`
    expect(row.draft_job_id).toBe(a.jobId) // posse do dono intacta
  })

  it('save_draft happy path: grava o content e LIMPA o estado de trabalho', async () => {
    const id = await novaAula(3)
    const a = await claim(id)
    const { error } = await admin.rpc('slide_lesson_save_draft', {
      p_id: id,
      p_content: conteudo('v2'),
      p_title: 'T',
      p_baseline_updated_at: a.row!.updated_at,
      p_job_id: a.jobId,
    })
    expect(error).toBeNull()
    const [row] =
      await sql`select content, draft_started_at, draft_error, draft_job_id from slide_lessons where id = ${id}`
    expect(row.content.marker).toBe('v2')
    expect(row.draft_started_at).toBeNull()
    expect(row.draft_error).toBeNull()
    expect(row.draft_job_id).toBeNull()
  })

  it('save_draft baseline DIVERGENTE (edição no intervalo) → erro limpo, nada gravado', async () => {
    const id = await novaAula(4)
    const a = await claim(id)
    // outra escrita muda updated_at (bump pelo trigger) DEPOIS da reivindicação
    await sql`update slide_lessons set draft_error = 'mexi' where id = ${id}`
    const { error } = await admin.rpc('slide_lesson_save_draft', {
      p_id: id,
      p_content: conteudo('v3'),
      p_title: 'T',
      p_baseline_updated_at: a.row!.updated_at,
      p_job_id: a.jobId,
    })
    expect(error?.message).toMatch(/mudou durante o rascunho/)
    const [row] = await sql`select content from slide_lessons where id = ${id}`
    expect(row.content.marker).toBe('v1') // original intacto
  })

  it('save_draft com TOKEN ERRADO → erro de posse, nada gravado', async () => {
    const id = await novaAula(5)
    const a = await claim(id)
    const { error } = await admin.rpc('slide_lesson_save_draft', {
      p_id: id,
      p_content: conteudo('v9'),
      p_title: 'T',
      p_baseline_updated_at: a.row!.updated_at,
      p_job_id: crypto.randomUUID(),
    })
    expect(error?.message).toMatch(/sem posse/)
    const [row] = await sql`select content from slide_lessons where id = ${id}`
    expect(row.content.marker).toBe('v1')
  })
})
