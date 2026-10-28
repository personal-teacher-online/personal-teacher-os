// Estúdio v2 — Leva 0.2 (ADR-032 decisão 8): estados de PARQUEAMENTO do acervo.
// `ciclo_futuro` (carrossel/story saem do caminho sem virar lixo) e `arquivado`
// (reel pré-esteira, com motivo obrigatório) — terminais e imutáveis como
// `descartado`. Guards escritos VERMELHOS antes da migration (regra 7 do fluxo
// da frente). Regra da casa: fixtures próprias (external_ref único), nunca
// contagem global.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect } from './helpers/db'

let sql: Sql
let admin: SupabaseClient
let adminId: string

beforeAll(async () => {
  sql = connect(3)
  adminId = await createAuthUser(sql, 'admin', 'Admin parqueamento')
  admin = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  await sql.end()
})

function ref(prefix: string): string {
  return `parq-${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

async function createIdeia(prefix: string, kind = 'carrossel'): Promise<string> {
  const { data, error } = await admin
    .from('content_posts')
    .insert({ external_ref: ref(prefix), kind, tema: 'Tema ' + prefix })
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

describe('parqueamento — transições de entrada', () => {
  it('ideia → ciclo_futuro passa SEM carimbo do portão 1 (isenção no gate1_shape)', async () => {
    const id = await createIdeia('cf-ideia')
    const { error } = await admin
      .from('content_posts')
      .update({ status: 'ciclo_futuro' })
      .eq('id', id)
    expect(error).toBeNull()
    const [row] = await sql`select status, idea_approved_at from content_posts where id = ${id}`
    expect(row.status).toBe('ciclo_futuro')
    expect(row.idea_approved_at).toBeNull()
  })

  it('ideia → arquivado SEM motivo explode (archived_shape)', async () => {
    const id = await createIdeia('arq-sem-motivo', 'roteiro_reel')
    const { error } = await admin
      .from('content_posts')
      .update({ status: 'arquivado' })
      .eq('id', id)
    expect(error?.message).toMatch(/archived_shape/)
  })

  it('ideia → arquivado com motivo passa e guarda o motivo', async () => {
    const id = await createIdeia('arq-ok', 'roteiro_reel')
    const { error } = await admin
      .from('content_posts')
      .update({ status: 'arquivado', archived_reason: 'pré-esteira' })
      .eq('id', id)
    expect(error).toBeNull()
    const [row] = await sql`select status, archived_reason from content_posts where id = ${id}`
    expect(row.status).toBe('arquivado')
    expect(row.archived_reason).toBe('pré-esteira')
  })

  it('motivo em branco não conta como motivo (btrim) — nem tab/quebra de linha', async () => {
    const id = await createIdeia('arq-branco', 'roteiro_reel')
    const { error } = await admin
      .from('content_posts')
      .update({ status: 'arquivado', archived_reason: '   ' })
      .eq('id', id)
    expect(error?.message).toMatch(/archived_shape/)
    // achado nº 6 do Sol: btrim sem 2º argumento deixaria "\t\n" passar
    const invisivel = await admin
      .from('content_posts')
      .update({ status: 'arquivado', archived_reason: '\t\n' })
      .eq('id', id)
    expect(invisivel.error?.message).toMatch(/archived_shape/)
  })

  it('archived_reason SÓ se escreve na transição para arquivado (achado nº 5 do Sol)', async () => {
    // em update que não vai para arquivado, a coluna é imutável
    const id = await createIdeia('arq-fora', 'roteiro_reel')
    const fora = await admin
      .from('content_posts')
      .update({ archived_reason: 'anotação solta' })
      .eq('id', id)
    expect(fora.error?.message).toMatch(/só se escreve/)
    // e post não NASCE com motivo
    const nasce = await admin
      .from('content_posts')
      .insert({ external_ref: ref('nasce-motivo'), kind: 'story', tema: 'x', archived_reason: 'x' })
    expect(nasce.error?.message).toMatch(/nasce sem motivo/)
  })

  it('todo estado não-terminal entra: ideia_aprovada, gerando e rejeitado', async () => {
    // ideia_aprovada → arquivado
    const a = await createIdeia('mapa-aprovada', 'roteiro_reel')
    await approveIdeia(a)
    const ra = await admin
      .from('content_posts')
      .update({ status: 'arquivado', archived_reason: 'pré-esteira' })
      .eq('id', a)
    expect(ra.error).toBeNull()

    // gerando → ciclo_futuro
    const g = await createIdeia('mapa-gerando', 'story')
    await approveIdeia(g)
    const paraGerando = await admin
      .from('content_posts')
      .update({ status: 'gerando', generation_started_at: new Date().toISOString() })
      .eq('id', g)
    expect(paraGerando.error).toBeNull()
    const rg = await admin.from('content_posts').update({ status: 'ciclo_futuro' }).eq('id', g)
    expect(rg.error).toBeNull()

    // rejeitado → arquivado (a transição muda o status, então o congelamento do
    // rejeitado não se aplica; o rejection_reason fica como registro do portão)
    const r = await createIdeia('mapa-rejeitado', 'roteiro_reel')
    const rejeita = await admin
      .from('content_posts')
      .update({ status: 'rejeitado', rejection_reason: 'fora do tema' })
      .eq('id', r)
    expect(rejeita.error).toBeNull()
    const rr = await admin
      .from('content_posts')
      .update({ status: 'arquivado', archived_reason: 'pré-esteira' })
      .eq('id', r)
    expect(rr.error).toBeNull()
    const [row] = await sql`select rejection_reason from content_posts where id = ${r}`
    expect(row.rejection_reason).toBe('fora do tema')
  })

  it('sair de rejeitado para o arquivo NÃO abre janela de edição (achado nº 2 do Sol)', async () => {
    const id = await createIdeia('rej-congela', 'roteiro_reel')
    const rejeita = await admin
      .from('content_posts')
      .update({ status: 'rejeitado', rejection_reason: 'fora do tema' })
      .eq('id', id)
    expect(rejeita.error).toBeNull()
    const contrabando = await admin
      .from('content_posts')
      .update({ status: 'arquivado', archived_reason: 'pré-esteira', tema: 'tema reescrito' })
      .eq('id', id)
    expect(contrabando.error?.message).toMatch(/como está/)
  })

  it('rascunho → ciclo_futuro passa no GUARD (quem preserva os rascunhos legados é o script de dados, não o banco)', async () => {
    const id = await createIdeia('mapa-rascunho', 'carrossel')
    await approveIdeia(id)
    for (const patch of [
      { status: 'gerando', generation_started_at: new Date().toISOString() },
      { status: 'rascunho', legenda: 'Legenda' },
    ]) {
      const { error } = await admin.from('content_posts').update(patch).eq('id', id)
      expect(error).toBeNull()
    }
    const { error } = await admin.from('content_posts').update({ status: 'ciclo_futuro' }).eq('id', id)
    expect(error).toBeNull()
  })
})

describe('parqueamento — aprovado e a whitelist', () => {
  async function aprovadoFixture(): Promise<string> {
    const id = await createIdeia('wl', 'roteiro_reel')
    await approveIdeia(id)
    for (const patch of [
      { status: 'gerando', generation_started_at: new Date().toISOString() },
      { status: 'rascunho', legenda: 'Legenda', roteiro: 'GANCHO: x' },
      { status: 'aprovado', approved_by: adminId, approved_at: new Date().toISOString() },
    ]) {
      const { error } = await admin.from('content_posts').update(patch).eq('id', id)
      expect(error).toBeNull()
    }
    return id
  }

  it('aprovado → arquivado com motivo passa (status + motivo estão na whitelist)', async () => {
    const id = await aprovadoFixture()
    const { error } = await admin
      .from('content_posts')
      .update({ status: 'arquivado', archived_reason: 'pré-esteira' })
      .eq('id', id)
    expect(error).toBeNull()
  })

  it('aprovado → arquivado NÃO abre brecha para editar conteúdo junto (whitelist)', async () => {
    const id = await aprovadoFixture()
    const { error } = await admin
      .from('content_posts')
      .update({ status: 'arquivado', archived_reason: 'pré-esteira', legenda: 'reescrita' })
      .eq('id', id)
    expect(error?.message).toMatch(/congelado/)
  })
})

describe('parqueamento — os dois estados são TERMINAIS e imutáveis', () => {
  it('arquivado não se edita nem sai (nem para descartado)', async () => {
    const id = await createIdeia('term-arq', 'roteiro_reel')
    const { error } = await admin
      .from('content_posts')
      .update({ status: 'arquivado', archived_reason: 'pré-esteira' })
      .eq('id', id)
    expect(error).toBeNull()
    const edita = await admin.from('content_posts').update({ tema: 'outro' }).eq('id', id)
    expect(edita.error?.message).toMatch(/imutável/)
    const sai = await admin.from('content_posts').update({ status: 'ideia' }).eq('id', id)
    expect(sai.error?.message).toMatch(/imutável/)
    const descarta = await admin.from('content_posts').update({ status: 'descartado' }).eq('id', id)
    expect(descarta.error?.message).toMatch(/imutável/)
  })

  it('ciclo_futuro não se edita nem sai', async () => {
    const id = await createIdeia('term-cf', 'story')
    const { error } = await admin.from('content_posts').update({ status: 'ciclo_futuro' }).eq('id', id)
    expect(error).toBeNull()
    const edita = await admin.from('content_posts').update({ tema: 'outro' }).eq('id', id)
    expect(edita.error?.message).toMatch(/imutável/)
    const sai = await admin.from('content_posts').update({ status: 'ideia' }).eq('id', id)
    expect(sai.error?.message).toMatch(/imutável/)
  })

  it('publicado e descartado NÃO ganham porta nova (seguem imutáveis)', async () => {
    // descartado → ciclo_futuro explode
    const d = await createIdeia('term-desc', 'carrossel')
    const descarta = await admin.from('content_posts').update({ status: 'descartado' }).eq('id', d)
    expect(descarta.error).toBeNull()
    const rd = await admin.from('content_posts').update({ status: 'ciclo_futuro' }).eq('id', d)
    expect(rd.error?.message).toMatch(/imutável/)
  })

  it('post não NASCE parqueado (nasce como IDEIA)', async () => {
    const nasce = await admin
      .from('content_posts')
      .insert({ external_ref: ref('nasce-arq'), kind: 'story', tema: 'x', status: 'ciclo_futuro' })
    expect(nasce.error?.message).toMatch(/nasce como IDEIA/)
  })
})
