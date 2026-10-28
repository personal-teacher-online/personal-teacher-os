// M-H2 (migration 20260724000100) — supersede de foto por termo no BANCO.
// Lei 2/7/8: append puro. Trocar uma foto aprovada cria versão NOVA (cabeça por
// max(version)) e NUNCA edita/apaga a antiga; a substituição é auditada.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect } from './helpers/db'

let sql: Sql
let admin: SupabaseClient
let adminId: string

const COURSE = `mh2-${crypto.randomUUID().slice(0, 8)}`
const FOLDER = 'm6'

async function pede(name: string): Promise<string> {
  const { data, error } = await admin.rpc('slide_image_request', {
    p_course: COURSE,
    p_folder: FOLDER,
    p_name: name,
    p_prompt: 'Documentary photography, natural daylight. A single clear photo of a train station.',
    p_framing: 'quadrado',
    p_provider: 'gemini',
  })
  expect(error).toBeNull()
  return data as string
}

const pronta = (id: string) =>
  admin.rpc('slide_image_ready', { p_id: id, p_candidates: [{ url: 'https://x/1.png' }] })

beforeAll(async () => {
  sql = connect(3)
  adminId = await createAuthUser(sql, 'admin', 'Admin supersede')
  admin = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  await sql.end()
})

describe('supersede de vocab — cabeça por versão, antiga imutável', () => {
  it('a versão sobe a cada pedido no mesmo endereço', async () => {
    const name = 'a1-vocab-11110000'
    const id1 = await pede(name)
    await pronta(id1)
    await admin.rpc('slide_image_approve', { p_id: id1, p_drive_file_id: 'd1', p_drive_url: 'u1' })
    const id2 = await pede(name)
    const [[r1], [r2]] = await Promise.all([
      sql`select version from slide_images where id = ${id1}`,
      sql`select version from slide_images where id = ${id2}`,
    ])
    expect(r1.version).toBe(1)
    expect(r2.version).toBe(2)
  })

  it('substituir cria versão nova (cabeça) e a antiga fica INTOCADA', async () => {
    const name = 'a2-vocab-22220000'
    // primeira aprovação: fluxo atual
    const id1 = await pede(name)
    await pronta(id1)
    await admin.rpc('slide_image_approve', { p_id: id1, p_drive_file_id: 'd1', p_drive_url: 'u1' })

    // nova candidata para o MESMO endereço → supersede
    const id2 = await pede(name)
    await pronta(id2)
    const { data: novoId, error } = await admin.rpc('slide_image_supersede', {
      p_id: id2,
      p_drive_file_id: 'd2',
      p_drive_url: 'u2',
    })
    expect(error).toBeNull()
    expect(novoId).toBe(id2)

    // a ANTIGA: ainda aprovada, versão 1, drive original, sem supersedes — não mudou
    const [antiga] = await sql`
      select status, version, drive_file_id, supersedes_id from slide_images where id = ${id1}`
    expect(antiga.status).toBe('aprovada')
    expect(antiga.version).toBe(1)
    expect(antiga.drive_file_id).toBe('d1')
    expect(antiga.supersedes_id).toBeNull()

    // a NOVA: aprovada, versão 2, aponta para a antiga
    const [nova] = await sql`
      select status, version, drive_file_id, supersedes_id from slide_images where id = ${id2}`
    expect(nova.status).toBe('aprovada')
    expect(nova.version).toBe(2)
    expect(nova.drive_file_id).toBe('d2')
    expect(nova.supersedes_id).toBe(id1)

    // CABEÇA derivada = maior version aprovada = a nova
    const [cabeca] = await sql`
      select id from slide_images
       where course = ${COURSE} and folder = ${FOLDER} and name = ${name} and status = 'aprovada'
       order by version desc limit 1`
    expect(cabeca.id).toBe(id2)

    // a antiga NÃO foi apagada: as duas linhas coexistem
    const [{ n }] = await sql`
      select count(*)::int as n from slide_images
       where course = ${COURSE} and folder = ${FOLDER} and name = ${name} and status = 'aprovada'`
    expect(n).toBe(2)

    // auditoria da substituição (Lei 8)
    const [aud] = await sql`
      select diff from audit_log
       where action = 'supersede_slide_image' and entity_id = ${id2} order by at desc limit 1`
    expect(aud).toBeTruthy()
    expect(aud.diff.supersedes_id).toBe(id1)
    expect(aud.diff.old_version).toBe(1)
    expect(aud.diff.new_version).toBe(2)
  })

  it('supersede SEM aprovada existente é recusado (manda usar approve)', async () => {
    const name = 'a3-vocab-33330000'
    const id = await pede(name)
    await pronta(id)
    const { error } = await admin.rpc('slide_image_supersede', {
      p_id: id,
      p_drive_file_id: 'd',
      p_drive_url: 'u',
    })
    expect(error?.message).toMatch(/slide_image_approve/i)
  })

  it('supersede exige o arquivo no Drive', async () => {
    const name = 'a4-vocab-44440000'
    const id1 = await pede(name)
    await pronta(id1)
    await admin.rpc('slide_image_approve', { p_id: id1, p_drive_file_id: 'd1', p_drive_url: 'u1' })
    const id2 = await pede(name)
    await pronta(id2)
    const { error } = await admin.rpc('slide_image_supersede', {
      p_id: id2,
      p_drive_file_id: '  ',
      p_drive_url: null,
    })
    expect(error?.message).toMatch(/exige o arquivo já no Drive/i)
  })

  it('uma geração EM VOO por endereço — o 2º pedido concorrente falha', async () => {
    const name = 'a5-vocab-55550000'
    await pede(name) // pendente
    const { error } = await admin.rpc('slide_image_request', {
      p_course: COURSE, p_folder: FOLDER, p_name: name,
      p_prompt: 'x', p_framing: 'quadrado', p_provider: 'gemini',
    })
    expect(error?.message).toMatch(/duplicate key|uma_geracao_no_ar/i)
  })

  it('a aprovada NÃO pode ser apagada nem editada (Lei 8, portão do IM-1 segue)', async () => {
    const name = 'a6-vocab-66660000'
    const id1 = await pede(name)
    await pronta(id1)
    await admin.rpc('slide_image_approve', { p_id: id1, p_drive_file_id: 'd1', p_drive_url: 'u1' })
    const del = await sql`delete from slide_images where id = ${id1}`.catch((e: Error) => e)
    expect(String(del)).toMatch(/não se apaga/i)
  })

  it('item 1: a 2ª aprovação por slide_image_approve é RECUSADA (manda usar supersede)', async () => {
    const name = 'a8-vocab-88880000'
    const id1 = await pede(name)
    await pronta(id1)
    await admin.rpc('slide_image_approve', { p_id: id1, p_drive_file_id: 'd1', p_drive_url: 'u1' })
    const id2 = await pede(name)
    await pronta(id2)
    const { error } = await admin.rpc('slide_image_approve', {
      p_id: id2, p_drive_file_id: 'd2', p_drive_url: 'u2',
    })
    expect(error?.message).toMatch(/já tem foto aprovada|slide_image_supersede/i)
  })

  it('item 2: campos de uma aprovada (version/supersedes_id) são imutáveis', async () => {
    const name = 'a9-vocab-99990000'
    const id1 = await pede(name)
    await pronta(id1)
    await admin.rpc('slide_image_approve', { p_id: id1, p_drive_file_id: 'd1', p_drive_url: 'u1' })
    const eVer = await sql`update slide_images set version = 99 where id = ${id1}`.catch((e: Error) => e)
    expect(String(eVer)).toMatch(/imutável/i)
    const eSup = await sql`update slide_images set supersedes_id = ${id1} where id = ${id1}`.catch(
      (e: Error) => e,
    )
    expect(String(eSup)).toMatch(/imutável/i)
  })

  it('item 3: o teto por AULA conta PEDIDOS (requested_count), não chamadas', async () => {
    const pedeN = async (name: string, n: number) => {
      const { data, error } = await admin.rpc('slide_image_request', {
        p_course: COURSE, p_folder: FOLDER, p_name: name,
        p_prompt: 'x', p_framing: 'quadrado', p_provider: 'gemini', p_count: n,
      })
      return { data, error }
    }
    // mesma AULA (prefixo a10-vocab-), termos distintos: 4 + 4 = 8 (ok), +1 estoura
    const r1 = await pedeN('a10-vocab-aaaa0001', 4)
    expect(r1.error).toBeNull()
    const r2 = await pedeN('a10-vocab-aaaa0002', 4)
    expect(r2.error).toBeNull()
    const r3 = await pedeN('a10-vocab-aaaa0003', 1)
    expect(r3.error?.message).toMatch(/teto de 8/i)
  })

  it('item 3: p_count fora de 1..4 é recusado', async () => {
    const { error } = await admin.rpc('slide_image_request', {
      p_course: COURSE, p_folder: FOLDER, p_name: 'a11-vocab-bbbb0001',
      p_prompt: 'x', p_framing: 'quadrado', p_provider: 'gemini', p_count: 5,
    })
    expect(error?.message).toMatch(/fora de 1\.\.4/i)
  })

  it('item 3: nome patológico "a1-vocab-x" (não-hex) cai na regra de CENA (um vivo)', async () => {
    // classificado como CENA (não casa ^a[0-9]+-vocab-[0-9a-f]{8}$): aprovar e
    // pedir de novo é BLOQUEADO (cena_um_vivo conta a aprovada), ao contrário do
    // vocab real que permite supersede.
    const name = 'a1-vocab-x'
    const id1 = await pede(name)
    await pronta(id1)
    await admin.rpc('slide_image_approve', { p_id: id1, p_drive_file_id: 'd1', p_drive_url: 'u1' })
    const { error } = await admin.rpc('slide_image_request', {
      p_course: COURSE, p_folder: FOLDER, p_name: name,
      p_prompt: 'x', p_framing: 'quadrado', p_provider: 'gemini',
    })
    expect(error?.message).toMatch(/duplicate key|cena_um_vivo/i)
  })
})
