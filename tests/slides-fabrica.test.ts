// Fábrica de Slides FS-M0 (migration 20260721000100) — máquina de estados,
// congelamento de conteúdo, RLS admin-only e curadoria de vídeo (1 aprovado
// por aula; nova busca preserva decididos).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect } from './helpers/db'

let sql: Sql
let service: SupabaseClient
let admin: SupabaseClient
let teacher: SupabaseClient
let adminId: string

// module fixo por execução (module 1..12; lesson varia por teste) — evita
// colisão com execuções anteriores no banco compartilhado sem reset.
let mod: number
let nextLesson = 1
function newLesson(): { module: number; lesson: number; title: string } {
  return { module: mod, lesson: nextLesson++, title: `Aula de teste ${nextLesson}` }
}
// Cada execução usa um course próprio (unique é (course, module, lesson)).
const COURSE = `pt-teste-${crypto.randomUUID().slice(0, 8)}`

async function createLesson(content: object = {}): Promise<string> {
  const l = newLesson()
  const { data, error } = await admin.rpc('slide_lesson_create', {
    p_course: COURSE,
    p_module: l.module,
    p_lesson: l.lesson,
    p_title: l.title,
    p_content: content,
  })
  expect(error).toBeNull()
  return data as string
}

beforeAll(async () => {
  sql = connect(3)
  service = serviceClient()
  adminId = await createAuthUser(sql, 'admin', 'Admin fábrica-slides')
  const teacherId = await createAuthUser(sql, 'teacher', 'Teacher fábrica-slides')
  admin = await clientAs(adminId, 'admin')
  teacher = await clientAs(teacherId, 'teacher')
  mod = 1 + Math.floor(Math.random() * 12)
})
afterAll(async () => {
  await sql.end()
})

describe('slide_lessons — máquina de estados', () => {
  it('admin cria aula; nasce rascunho', async () => {
    const id = await createLesson({ level: 'A1' })
    const [row] = await sql`select status, course, created_by from slide_lessons where id = ${id}`
    expect(row.status).toBe('rascunho')
    expect(row.course).toBe(COURSE)
    expect(row.created_by).toBe(adminId)
  })

  it('teacher não cria (RPC nega) e não vê linhas (RLS)', async () => {
    const { error } = await teacher.rpc('slide_lesson_create', {
      p_course: COURSE, p_module: mod, p_lesson: 9, p_title: 'invasão',
    })
    expect(error?.message).toMatch(/apenas admin/)
    const { data } = await teacher.from('slide_lessons').select('id')
    expect(data).toEqual([])
  })

  it('unique (course, module, lesson)', async () => {
    const l = newLesson()
    const first = await admin.rpc('slide_lesson_create', {
      p_course: COURSE, p_module: l.module, p_lesson: l.lesson, p_title: l.title,
    })
    expect(first.error).toBeNull()
    const dup = await admin.rpc('slide_lesson_create', {
      p_course: COURSE, p_module: l.module, p_lesson: l.lesson, p_title: 'duplicada',
    })
    expect(dup.error?.message).toMatch(/duplicate key|unique/)
  })

  it('save_content só em rascunho; aprovar congela; reabrir limpa carimbo', async () => {
    const id = await createLesson()
    const save = await admin.rpc('slide_lesson_save_content', {
      p_id: id, p_content: { grammarFocus: ['v1'] }, p_title: 'Título novo',
    })
    expect(save.error).toBeNull()

    const approve = await admin.rpc('slide_lesson_approve', { p_id: id })
    expect(approve.error).toBeNull()
    const [ap] = await sql`select status, approved_by, approved_at from slide_lessons where id = ${id}`
    expect(ap.status).toBe('aprovada')
    expect(ap.approved_by).toBe(adminId)
    expect(ap.approved_at).not.toBeNull()

    const frozen = await admin.rpc('slide_lesson_save_content', {
      p_id: id, p_content: { grammarFocus: ['v2'] },
    })
    expect(frozen.error?.message).toMatch(/reabra para editar/)

    // Nem por UPDATE direto (guard, 2ª linha de defesa — via owner):
    await expect(
      sql`update slide_lessons set title = 'hack' where id = ${id}`,
    ).rejects.toThrow(/congelado/)

    const reopen = await admin.rpc('slide_lesson_reopen', { p_id: id })
    expect(reopen.error).toBeNull()
    const [re] = await sql`select status, approved_by, approved_at from slide_lessons where id = ${id}`
    expect(re.status).toBe('rascunho')
    expect(re.approved_by).toBeNull()
    expect(re.approved_at).toBeNull()
  })

  it('gerada: service_role marca deck; conteúdo segue congelado; reabrir volta', async () => {
    const id = await createLesson()
    await admin.rpc('slide_lesson_approve', { p_id: id })
    const mark = await service
      .from('slide_lessons')
      .update({ status: 'gerada', deck_generated_at: new Date().toISOString(), deck_url: 'https://drive/x' })
      .eq('id', id)
    expect(mark.error).toBeNull()
    const [g] = await sql`select status, deck_url from slide_lessons where id = ${id}`
    expect(g.status).toBe('gerada')
    expect(g.deck_url).toBe('https://drive/x')

    await expect(
      sql`update slide_lessons set content = '{"x":1}'::jsonb where id = ${id}`,
    ).rejects.toThrow(/congelado/)

    const reopen = await admin.rpc('slide_lesson_reopen', { p_id: id })
    expect(reopen.error).toBeNull()
  })

  it('transições inválidas e descarte', async () => {
    const id = await createLesson()
    // rascunho → gerada (pulando aprovação) é inválida:
    await expect(
      sql`update slide_lessons set status = 'gerada' where id = ${id}`,
    ).rejects.toThrow(/inválida|gate_shape|approved/)

    const discard = await admin.rpc('slide_lesson_discard', { p_id: id })
    expect(discard.error).toBeNull()
    // descartada é imutável:
    await expect(
      sql`update slide_lessons set title = 'volta' where id = ${id}`,
    ).rejects.toThrow(/imutável/)
    // DELETE proibido (Lei 8):
    await expect(sql`delete from slide_lessons where id = ${id}`).rejects.toThrow(/não se apaga/)
  })
})

describe('slide_video_candidates — curadoria', () => {
  function cands(...ids: string[]) {
    return ids.map((videoId, i) => ({
      video_id: videoId,
      title: `Vídeo ${videoId}`,
      channel: 'Canal Teste',
      views: 1000 * (i + 1),
      excerpt: { start: '0:10', end: '1:30', why: 'trecho de teste' },
      ordem: i + 1,
    }))
  }

  it('suggest_replace insere; decidir aprova; aprovar outro rebaixa o anterior', async () => {
    const lessonId = await createLesson()
    const rep = await admin.rpc('slide_video_suggest_replace', {
      p_lesson: lessonId, p_candidates: cands('vidA', 'vidB', 'vidC'),
    })
    expect(rep.error).toBeNull()
    expect(rep.data).toBe(3)

    const [a] = await sql`
      select id from slide_video_candidates where lesson_id = ${lessonId} and video_id = 'vidA'`
    const dec = await admin.rpc('slide_video_decide', { p_id: a.id, p_status: 'aprovado' })
    expect(dec.error).toBeNull()

    const [b] = await sql`
      select id from slide_video_candidates where lesson_id = ${lessonId} and video_id = 'vidB'`
    const dec2 = await admin.rpc('slide_video_decide', { p_id: b.id, p_status: 'aprovado' })
    expect(dec2.error).toBeNull()

    const rows = await sql`
      select video_id, status from slide_video_candidates
       where lesson_id = ${lessonId} order by video_id`
    expect(rows.find((r) => r.video_id === 'vidA')?.status).toBe('rejeitado')
    expect(rows.find((r) => r.video_id === 'vidB')?.status).toBe('aprovado')
    expect(rows.find((r) => r.video_id === 'vidC')?.status).toBe('sugerido')
  })

  it('nova busca troca sugeridos e preserva decididos', async () => {
    const lessonId = await createLesson()
    await admin.rpc('slide_video_suggest_replace', {
      p_lesson: lessonId, p_candidates: cands('vid1', 'vid2'),
    })
    const [v1] = await sql`
      select id from slide_video_candidates where lesson_id = ${lessonId} and video_id = 'vid1'`
    await admin.rpc('slide_video_decide', { p_id: v1.id, p_status: 'aprovado' })

    const rep2 = await admin.rpc('slide_video_suggest_replace', {
      p_lesson: lessonId, p_candidates: cands('vid3'),
    })
    expect(rep2.error).toBeNull()
    const rows = await sql`
      select video_id, status from slide_video_candidates
       where lesson_id = ${lessonId} order by video_id`
    // vid1 (aprovado) fica; vid2 (sugerido) saiu; vid3 entrou.
    expect(rows.map((r) => r.video_id)).toEqual(['vid1', 'vid3'])
    expect(rows[0].status).toBe('aprovado')
    expect(rows[1].status).toBe('sugerido')
  })

  it('decisão inválida e RLS do teacher', async () => {
    const lessonId = await createLesson()
    await admin.rpc('slide_video_suggest_replace', {
      p_lesson: lessonId, p_candidates: cands('vidX'),
    })
    const [x] = await sql`
      select id from slide_video_candidates where lesson_id = ${lessonId} and video_id = 'vidX'`
    const bad = await admin.rpc('slide_video_decide', { p_id: x.id, p_status: 'talvez' })
    expect(bad.error?.message).toMatch(/decisão inválida/)

    const denied = await teacher.rpc('slide_video_decide', { p_id: x.id, p_status: 'aprovado' })
    expect(denied.error?.message).toMatch(/apenas admin/)
    const { data } = await teacher.from('slide_video_candidates').select('id')
    expect(data).toEqual([])
  })
})
