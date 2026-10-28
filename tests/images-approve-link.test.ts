// M-H2 item 6 — aprovação de vocab ATÔMICA (slide_image_approve_and_link).
// Numa transação só: valida vínculo imagem×aula×âncora, aprova/supersede e grava
// o endereço no card. Sem 2 transações → sem cabeça aprovada órfã.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect } from './helpers/db'

let sql: Sql
let admin: SupabaseClient

const COURSE = `mh2link-${crypto.randomUUID().slice(0, 8)}`
const ANCHOR = 'abcd1234'

/** conteúdo mínimo com um card de vocab ancorado (save_content não valida schema). */
function conteudo() {
  return {
    slides: [
      { type: 'objectives', items: ['a', 'b'] },
      { type: 'vocab', title: 'V', cards: [{ term: 'train station', pt: 'estação', anchorId: ANCHOR }] },
    ],
  }
}

async function novaAula(module: number, lesson: number): Promise<string> {
  const { data, error } = await admin.rpc('slide_lesson_create', {
    p_course: COURSE, p_module: module, p_lesson: lesson, p_title: 'Teste link', p_content: conteudo(),
  })
  expect(error).toBeNull()
  return data as string
}

async function pedeImg(module: number, lesson: number): Promise<string> {
  const { data, error } = await admin.rpc('slide_image_request', {
    p_course: COURSE, p_folder: `m${module}`, p_name: `a${lesson}-vocab-${ANCHOR}`,
    p_prompt: 'x', p_framing: 'quadrado', p_provider: 'gemini',
  })
  expect(error).toBeNull()
  return data as string
}

const prontaCom = (id: string, mime: string) =>
  admin.rpc('slide_image_ready', {
    p_id: id, p_candidates: [{ driveFileId: `drv-${id.slice(0, 6)}`, url: 'https://x/1', mimeType: mime }],
  })

beforeAll(async () => {
  sql = connect(2)
  const adminId = await createAuthUser(sql, 'admin', 'Admin approve-link')
  admin = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  await sql.end()
})

describe('slide_image_approve_and_link — atômico', () => {
  it('1ª aprovação: grava o endereço COM extensão no card, por anchorId', async () => {
    const lessonId = await novaAula(1, 1)
    const imgId = await pedeImg(1, 1)
    await prontaCom(imgId, 'image/png')

    const { data: addr, error } = await admin.rpc('slide_image_approve_and_link', {
      p_lesson_id: lessonId, p_image_id: imgId, p_anchor_id: ANCHOR, p_candidate_index: 0,
    })
    expect(error).toBeNull()
    expect(addr).toBe(`m1/a1-vocab-${ANCHOR}.png`)

    // imagem aprovada
    const [img] = await sql`select status, version from slide_images where id = ${imgId}`
    expect(img.status).toBe('aprovada')
    // card ligado no conteúdo
    const [row] = await sql`select content from slide_lessons where id = ${lessonId}`
    expect(row.content.slides[1].cards[0].image).toBe(`m1/a1-vocab-${ANCHOR}.png`)
    expect(row.content.slides[1].cards[0].anchorId).toBe(ANCHOR)
  })

  it('substituição: supersede + novo endereço no card, tudo numa transação', async () => {
    const lessonId = await novaAula(2, 1)
    const img1 = await pedeImg(2, 1)
    await prontaCom(img1, 'image/png')
    await admin.rpc('slide_image_approve_and_link', {
      p_lesson_id: lessonId, p_image_id: img1, p_anchor_id: ANCHOR, p_candidate_index: 0,
    })
    const img2 = await pedeImg(2, 1)
    await prontaCom(img2, 'image/jpeg')
    const { data: addr, error } = await admin.rpc('slide_image_approve_and_link', {
      p_lesson_id: lessonId, p_image_id: img2, p_anchor_id: ANCHOR, p_candidate_index: 0,
    })
    expect(error).toBeNull()
    expect(addr).toBe(`m2/a1-vocab-${ANCHOR}.jpeg`)

    const [novo] = await sql`select status, version, supersedes_id from slide_images where id = ${img2}`
    expect(novo.status).toBe('aprovada')
    expect(novo.version).toBe(2)
    expect(novo.supersedes_id).toBe(img1)
    // a antiga intocada
    const [velho] = await sql`select status, version from slide_images where id = ${img1}`
    expect(velho.status).toBe('aprovada')
    expect(velho.version).toBe(1)
    // card aponta para a nova
    const [row] = await sql`select content from slide_lessons where id = ${lessonId}`
    expect(row.content.slides[1].cards[0].image).toBe(`m2/a1-vocab-${ANCHOR}.jpeg`)
  })

  it('anchor que NÃO está no conteúdo é recusado — nada aprovado (atômico)', async () => {
    const lessonId = await novaAula(3, 1)
    // imagem pedida num endereço de OUTRA âncora (não existe no conteúdo)
    const { data: imgId } = await admin.rpc('slide_image_request', {
      p_course: COURSE, p_folder: 'm3', p_name: 'a1-vocab-ffff9999',
      p_prompt: 'x', p_framing: 'quadrado', p_provider: 'gemini',
    })
    await prontaCom(imgId as string, 'image/png')
    const { error } = await admin.rpc('slide_image_approve_and_link', {
      p_lesson_id: lessonId, p_image_id: imgId, p_anchor_id: 'ffff9999', p_candidate_index: 0,
    })
    expect(error?.message).toMatch(/não está no conteúdo/i)
    // a imagem continua pronta (não foi aprovada) — nada meio-feito
    const [img] = await sql`select status from slide_images where id = ${imgId}`
    expect(img.status).toBe('pronta')
    // e o card segue sem foto
    const [row] = await sql`select content from slide_lessons where id = ${lessonId}`
    expect(row.content.slides[1].cards[0].image).toBeUndefined()
  })

  it('item 1: âncora DUPLICADA no conteúdo é AMBÍGUA — recusa (não liga o último)', async () => {
    // conteúdo legado corrompido: dois cards com o MESMO anchorId (o save_content
    // não valida schema, então dá para forçar o caso patológico direto no banco)
    const { data: lessonId } = await admin.rpc('slide_lesson_create', {
      p_course: COURSE, p_module: 5, p_lesson: 1, p_title: 'Dup',
      p_content: {
        slides: [
          { type: 'vocab', title: 'V', cards: [
            { term: 'a', pt: '1', anchorId: ANCHOR },
            { term: 'b', pt: '2', anchorId: ANCHOR }, // DUPLICADO
          ] },
        ],
      },
    })
    const imgId = await pedeImg(5, 1)
    await prontaCom(imgId, 'image/png')
    const { error } = await admin.rpc('slide_image_approve_and_link', {
      p_lesson_id: lessonId, p_image_id: imgId, p_anchor_id: ANCHOR, p_candidate_index: 0,
    })
    expect(error?.message).toMatch(/duplicado/i)
    // nada aprovado (atômico)
    const [img] = await sql`select status from slide_images where id = ${imgId}`
    expect(img.status).toBe('pronta')
  })

  it('imagem de endereço que não bate a aula+âncora é recusada (binding)', async () => {
    const lessonId = await novaAula(4, 1)
    // imagem no endereço CERTO de módulo mas anchor diferente do passado
    const imgId = await pedeImg(4, 1) // name a1-vocab-abcd1234
    await prontaCom(imgId, 'image/png')
    const { error } = await admin.rpc('slide_image_approve_and_link', {
      p_lesson_id: lessonId, p_image_id: imgId, p_anchor_id: 'dddd0000', p_candidate_index: 0,
    })
    // anchor dddd0000 → endereço esperado a1-vocab-dddd0000 ≠ imagem a1-vocab-abcd1234
    expect(error?.message).toMatch(/não pertence a este card/i)
  })
})
