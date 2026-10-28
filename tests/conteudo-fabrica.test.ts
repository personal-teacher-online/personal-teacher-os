// Fábrica de conteúdo (ADR-021) — máquina de estados, RLS e brand_voice_docs.
// Regra da casa: arquivos rodam em paralelo — fixtures próprias (external_ref
// único), NUNCA contagem global.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { anonClient, clientAs, createAuthUser } from './helpers/auth'
import { connect } from './helpers/db'

let sql: Sql
let admin: SupabaseClient
let adminId: string

beforeAll(async () => {
  sql = connect(3)
  adminId = await createAuthUser(sql, 'admin', 'Admin fábrica')
  admin = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  await sql.end()
})

function ref(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

async function createIdeia(externalRef: string): Promise<string> {
  const { data, error } = await admin
    .from('content_posts')
    .insert({ external_ref: externalRef, kind: 'carrossel', tema: 'Tema ' + externalRef })
    .select('id')
    .single()
  expect(error).toBeNull()
  return data!.id as string
}

async function approveIdeia(id: string): Promise<void> {
  const { error } = await admin
    .from('content_posts')
    .update({
      status: 'ideia_aprovada',
      idea_approved_by: adminId,
      idea_approved_at: new Date().toISOString(),
    })
    .eq('id', id)
  expect(error).toBeNull()
}

describe('máquina de estados (content_posts_guard)', () => {
  it('nasce SEMPRE ideia — INSERT já aprovado explode (mesmo via owner)', async () => {
    const { error } = await admin
      .from('content_posts')
      .insert({ external_ref: ref('nasce'), kind: 'story', tema: 'x', status: 'aprovado' })
    expect(error?.message).toMatch(/nasce como IDEIA/)
    await expect(
      sql`insert into content_posts (external_ref, kind, tema, status)
          values (${ref('nasce-sql')}, 'story', 'x', 'rascunho')`,
    ).rejects.toThrow(/nasce como IDEIA/)
  })

  it('caminho feliz: ideia → aprovada → gerando → rascunho → aprovado → publicado', async () => {
    const id = await createIdeia(ref('feliz'))
    await approveIdeia(id)
    for (const patch of [
      { status: 'gerando', generation_started_at: new Date().toISOString(), generation_attempts: 1 },
      { status: 'rascunho', legenda: 'Legenda', slides: [{ ordem: 1, texto: 'Hello' }] },
      { status: 'aprovado', approved_by: adminId, approved_at: new Date().toISOString() },
      { status: 'publicado', published_by: adminId, published_at: new Date().toISOString() },
    ]) {
      const { error } = await admin.from('content_posts').update(patch).eq('id', id)
      expect(error).toBeNull()
    }
    const [row] = await sql`select status from content_posts where id = ${id}`
    expect(row.status).toBe('publicado')
  })

  it('transição fora do mapa explode (ideia → rascunho)', async () => {
    const id = await createIdeia(ref('pula'))
    const { error } = await admin.from('content_posts').update({ status: 'rascunho' }).eq('id', id)
    expect(error?.message).toMatch(/transição inválida/)
  })

  it('portão 1 exige carimbo (CHECK gate1_shape)', async () => {
    const id = await createIdeia(ref('gate1'))
    const { error } = await admin
      .from('content_posts')
      .update({ status: 'ideia_aprovada' })
      .eq('id', id)
    expect(error?.message).toMatch(/gate1_shape/)
  })

  it('rejeitar sem motivo explode; com motivo funciona e "tentar de novo" volta à fila', async () => {
    const id = await createIdeia(ref('rejeita'))
    const semMotivo = await admin.from('content_posts').update({ status: 'rejeitado' }).eq('id', id)
    expect(semMotivo.error?.message).toMatch(/rejected_shape/)
    const comMotivo = await admin
      .from('content_posts')
      .update({ status: 'rejeitado', rejection_reason: 'muito formal' })
      .eq('id', id)
    expect(comMotivo.error).toBeNull()
    // rejeitado não se edita — o motivo é o registro do portão
    const edita = await admin.from('content_posts').update({ tema: 'outro' }).eq('id', id)
    expect(edita.error?.message).toMatch(/não se edita/)
    // rejeitado ANTES do portão 1 não tem carimbo: retry sem carimbar explode…
    const semCarimbo = await admin.from('content_posts').update({ status: 'ideia_aprovada' }).eq('id', id)
    expect(semCarimbo.error?.message).toMatch(/gate1_shape/)
    // …e o "tentar de novo" do painel carimba junto (retryAction) — funciona.
    const retry = await admin
      .from('content_posts')
      .update({
        status: 'ideia_aprovada',
        idea_approved_by: adminId,
        idea_approved_at: new Date().toISOString(),
      })
      .eq('id', id)
    expect(retry.error).toBeNull()
  })

  it('pós-aprovado: conteúdo congelado por whitelist; publicado é imutável', async () => {
    const id = await createIdeia(ref('congela'))
    await approveIdeia(id)
    await admin.from('content_posts').update({ status: 'gerando' }).eq('id', id)
    await admin.from('content_posts').update({ status: 'rascunho', legenda: 'v1' }).eq('id', id)
    await admin
      .from('content_posts')
      .update({ status: 'aprovado', approved_by: adminId, approved_at: new Date().toISOString() })
      .eq('id', id)

    const muda = await admin.from('content_posts').update({ legenda: 'v2' }).eq('id', id)
    expect(muda.error?.message).toMatch(/congelado/)
    const agenda = await admin.from('content_posts').update({ scheduled_for: '2026-08-01' }).eq('id', id)
    expect(agenda.error).toBeNull()

    await admin
      .from('content_posts')
      .update({ status: 'publicado', published_by: adminId, published_at: new Date().toISOString(), post_url: 'https://instagram.com/p/x' })
      .eq('id', id)
    const depois = await admin.from('content_posts').update({ post_url: 'https://outro' }).eq('id', id)
    expect(depois.error?.message).toMatch(/imutável/)
  })

  it('DELETE é proibido (guard no owner; sem grant para authenticated)', async () => {
    const id = await createIdeia(ref('delete'))
    await expect(sql`delete from content_posts where id = ${id}`).rejects.toThrow(/não se apaga/)
    const { error } = await admin.from('content_posts').delete().eq('id', id)
    expect(error).not.toBeNull()
  })

  it('auditoria universal registra as mutações (Lei 8)', async () => {
    const r = ref('audit')
    const id = await createIdeia(r)
    await approveIdeia(id)
    const audits = await sql`
      select count(*)::int as n from audit_log where entity = 'content_posts' and entity_id = ${id}`
    expect(audits[0].n).toBeGreaterThanOrEqual(2) // insert + update
  })
})

describe('RLS (padrão caso 12/F1)', () => {
  it('anon e não-admin leem ZERO linhas sem erro; não-admin não escreve', async () => {
    const r = ref('rls')
    await createIdeia(r)
    const teacher = await clientAs(await createAuthUser(sql, 'teacher', 'Prof fábrica'), 'teacher')
    const anon = anonClient()

    for (const client of [teacher, anon]) {
      const { data, error } = await client
        .from('content_posts')
        .select('id')
        .eq('external_ref', r)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    }
    const { error: insErr } = await teacher
      .from('content_posts')
      .insert({ external_ref: ref('rls-teacher'), kind: 'story', tema: 'x' })
    expect(insErr).not.toBeNull()
  })

  it('admin lê e escreve normalmente', async () => {
    const r = ref('rls-admin')
    await createIdeia(r)
    const { data } = await admin.from('content_posts').select('id').eq('external_ref', r)
    expect(data).toHaveLength(1)
  })
})

describe('brand_voice_docs (padrão ai_prompts)', () => {
  it('publish v1→v2: só a 2 ativa; audit registrado', async () => {
    // Lineage é única (sem name): serializa com os publishes de outros testes
    // pelo advisory lock — versões são crescentes, não determinísticas aqui.
    const v1 = await admin.rpc('publish_brand_voice', { p_content_md: '# Voz A', p_notes: 'a' })
    expect(v1.error).toBeNull()
    const v2 = await admin.rpc('publish_brand_voice', { p_content_md: '# Voz B', p_notes: 'b' })
    expect(v2.error).toBeNull()
    expect(Number(v2.data)).toBe(Number(v1.data) + 1)

    const ativas = await sql`select version from brand_voice_docs where active`
    expect(ativas).toHaveLength(1)
    expect(Number(ativas[0].version)).toBeGreaterThanOrEqual(Number(v2.data))

    const audits = await sql`
      select count(*)::int as n from audit_log where action = 'publish_brand_voice'`
    expect(audits[0].n).toBeGreaterThanOrEqual(2)
  })

  it('append-only: UPDATE de conteúdo e DELETE explodem (owner); não-admin não publica', async () => {
    await admin.rpc('publish_brand_voice', { p_content_md: '# Voz imutável' })
    await expect(
      sql`update brand_voice_docs set content_md = 'hack' where active`,
    ).rejects.toThrow(/append-only/)
    await expect(sql`delete from brand_voice_docs where active`).rejects.toThrow(/append-only/)

    const teacher = await clientAs(await createAuthUser(sql, 'teacher', 'Prof voz'), 'teacher')
    const { error } = await teacher.rpc('publish_brand_voice', { p_content_md: '# hack' })
    expect(error?.message).toMatch(/restrita à admin/)
  })
})
