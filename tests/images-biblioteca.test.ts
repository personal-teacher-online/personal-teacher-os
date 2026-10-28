// IM-1 (migration 20260722000100) — invariantes da biblioteca de imagens no
// BANCO. Lei 3: a regra vive no Postgres; o painel só antecipa o erro na UX.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect } from './helpers/db'

let sql: Sql
let admin: SupabaseClient
let teacher: SupabaseClient
let adminId: string

const COURSE = `im1-${crypto.randomUUID().slice(0, 8)}`
const PASTA = 'testes'

async function pede(nome: string): Promise<string> {
  const { data, error } = await admin.rpc('slide_image_request', {
    p_course: COURSE,
    p_folder: PASTA,
    p_name: nome,
    p_prompt: 'Documentary photography, natural daylight. Uma cena qualquer.',
    p_framing: 'paisagem',
    p_provider: 'higgsfield',
  })
  expect(error).toBeNull()
  return data as string
}

const pronta = async (id: string) =>
  admin.rpc('slide_image_ready', { p_id: id, p_candidates: [{ url: 'https://x/1.png' }] })

beforeAll(async () => {
  sql = connect(3)
  adminId = await createAuthUser(sql, 'admin', 'Admin biblioteca-imagens')
  const teacherId = await createAuthUser(sql, 'teacher', 'Teacher biblioteca-imagens')
  admin = await clientAs(adminId, 'admin')
  teacher = await clientAs(teacherId, 'teacher')
})
afterAll(async () => {
  await sql.end()
})

describe('biblioteca de imagens — máquina de estados', () => {
  it('imagem nasce PENDENTE, com quem pediu registrado', async () => {
    const id = await pede('nasce')
    const [row] = await sql`select status, requested_by, provider from slide_images where id = ${id}`
    expect(row.status).toBe('pendente')
    expect(row.requested_by).toBe(adminId)
    expect(row.provider).toBe('higgsfield')
  })

  it('não dá para inserir já aprovada — aprovação é transição', async () => {
    const [{ id: perfil }] = await sql`select id from profiles limit 1`
    const erro = await sql`
      insert into slide_images (course, folder, name, prompt, framing, provider, status,
        drive_file_id, approved_by, approved_at)
      values (${COURSE}, ${PASTA}, 'ja-aprovada', 'x', 'paisagem', 'higgsfield', 'aprovada',
        'f1', ${perfil}, now())
    `.catch((e: Error) => e)
    expect(String(erro)).toMatch(/nasce PENDENTE/i)
  })

  it('DELETE é proibido (Lei 8)', async () => {
    const id = await pede('nao-apaga')
    const erro = await sql`delete from slide_images where id = ${id}`.catch((e: Error) => e)
    expect(String(erro)).toMatch(/não se apaga/i)
  })

  it('o prompt é procedência: não se reescreve depois de pronta', async () => {
    const id = await pede('procedencia')
    await pronta(id)
    const erro = await sql`update slide_images set prompt = 'outro' where id = ${id}`.catch(
      (e: Error) => e,
    )
    expect(String(erro)).toMatch(/procedência/i)
  })

  it('pendente NÃO pula direto para aprovada', async () => {
    const id = await pede('pula-etapa')
    const { error } = await admin.rpc('slide_image_approve', {
      p_id: id,
      p_drive_file_id: 'file-1',
      p_drive_url: 'https://drive/1',
    })
    expect(error?.message).toMatch(/não está pronta/i)
  })

  it('aprovar EXIGE o arquivo no Drive', async () => {
    const id = await pede('sem-arquivo')
    await pronta(id)
    const { error } = await admin.rpc('slide_image_approve', {
      p_id: id,
      p_drive_file_id: '  ',
      p_drive_url: null,
    })
    expect(error?.message).toMatch(/exige o arquivo já no Drive/i)
  })

  it('caminho feliz: pendente → pronta → aprovada, com carimbo', async () => {
    const id = await pede('feliz')
    await admin.rpc('slide_image_started', { p_id: id, p_handle: 'set-abc' })
    await pronta(id)
    const { error } = await admin.rpc('slide_image_approve', {
      p_id: id,
      p_drive_file_id: 'file-9',
      p_drive_url: 'https://drive/9',
    })
    expect(error).toBeNull()
    const [row] = await sql`
      select status, approved_by, approved_at, provider_handle from slide_images where id = ${id}`
    expect(row.status).toBe('aprovada')
    expect(row.approved_by).toBe(adminId)
    expect(row.approved_at).not.toBeNull()
    expect(row.provider_handle).toBe('set-abc')
  })

  it('aprovada é estado final E imutável (M-H2: nem campo, nem estado)', async () => {
    const id = await pede('final')
    await pronta(id)
    await admin.rpc('slide_image_approve', { p_id: id, p_drive_file_id: 'f', p_drive_url: null })
    // mudar o estado
    const errStatus = await sql`update slide_images set status = 'pronta' where id = ${id}`.catch(
      (e: Error) => e,
    )
    expect(String(errStatus)).toMatch(/imutável|estado final/i)
    // M-H2 (item 2): mudar um CAMPO de uma aprovada também é barrado
    const errCampo = await sql`update slide_images set drive_file_id = 'outro' where id = ${id}`.catch(
      (e: Error) => e,
    )
    expect(String(errCampo)).toMatch(/imutável/i)
  })

  it('um endereço vivo por vez — e reprovar LIBERA o nome para nova tentativa', async () => {
    await pede('endereco')
    const { error } = await admin.rpc('slide_image_request', {
      p_course: COURSE, p_folder: PASTA, p_name: 'endereco',
      p_prompt: 'x', p_framing: 'paisagem', p_provider: 'higgsfield',
    })
    expect(error?.message).toMatch(/duplicate key|um_endereco_vivo/i)

    // foi exatamente isto que fiz na mão ao regerar o cardápio e a maquininha:
    // reprovar e tentar de novo com o MESMO nome, sem inventar sufixo
    const [viva] = await sql`
      select id from slide_images where course = ${COURSE} and name = 'endereco'
        and status = 'pendente'`
    await admin.rpc('slide_image_reject', { p_id: viva.id })
    const segunda = await pede('endereco')
    expect(segunda).toBeTruthy()
  })

  it('teacher não pede nem enxerga (RPC nega + RLS)', async () => {
    const { error } = await teacher.rpc('slide_image_request', {
      p_course: COURSE, p_folder: PASTA, p_name: 'invasao',
      p_prompt: 'x', p_framing: 'paisagem', p_provider: 'higgsfield',
    })
    expect(error?.message).toMatch(/apenas admin/i)
    const { data } = await teacher.from('slide_images').select('id')
    expect(data).toEqual([])
  })
})
