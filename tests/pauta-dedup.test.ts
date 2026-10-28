// Estúdio v2 — Leva 0.4 (ADR-034): guards de `content_embeddings`, a memória
// vetorial da dedup temática. Infra do ROBÔ: humano não lê nem escreve
// (revoke total para authenticated/anon); service_role insere/atualiza;
// ninguém apaga — o embedding de tema DESCARTADO é exatamente o que impede o
// tema de renascer, então apagar seria abrir a porta de novo (Lei 8 por
// analogia). Nasceram VERMELHOS antes da migration (regra 7).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect } from './helpers/db'

let sql: Sql
let admin: SupabaseClient
let robo: SupabaseClient

const DIM = 768

function vetor(seed: number): number[] {
  // vetor determinístico qualquer — o conteúdo não importa para os guards
  return Array.from({ length: DIM }, (_, i) => Math.sin(seed * 1000 + i))
}

function linha(refId: string, seed = 1): Record<string, unknown> {
  return {
    escopo: 'ideia',
    ref_id: refId,
    embedding: JSON.stringify(vetor(seed)),
    modelo: 'gemini-embedding-001',
  }
}

beforeAll(async () => {
  sql = connect(2)
  const adminId = await createAuthUser(sql, 'admin', 'Admin dedup')
  admin = await clientAs(adminId, 'admin')
  robo = serviceClient()
})
afterAll(async () => {
  await sql.end()
})

describe('content_embeddings — quem escreve é o robô, e ninguém apaga', () => {
  it('service_role insere; o UPSERT do MESMO (escopo, ref_id) atualiza sem duplicar', async () => {
    const ref = crypto.randomUUID()
    const primeira = await robo.from('content_embeddings').insert(linha(ref, 1))
    expect(primeira.error).toBeNull()

    const upsert = await robo
      .from('content_embeddings')
      .upsert(linha(ref, 2), { onConflict: 'escopo,ref_id' })
    expect(upsert.error).toBeNull()

    const [{ n }] = await sql`
      select count(*)::int as n from content_embeddings
       where escopo = 'ideia' and ref_id = ${ref}`
    expect(n).toBe(1)
  })

  it('authenticated (mesmo admin) não escreve; leitura devolve VAZIO (padrão da casa: RLS sem policy)', async () => {
    const ref = crypto.randomUUID()
    await robo.from('content_embeddings').insert(linha(ref))
    const escreve = await admin.from('content_embeddings').insert(linha(crypto.randomUUID()))
    expect(escreve.error?.message).toMatch(/permission denied/i)
    // SELECT tem grant (invariante do rls.test: toda tabela devolve vazio, não
    // permission denied) — mas a RLS sem policy nega TODAS as linhas.
    const le = await admin.from('content_embeddings').select('ref_id').eq('ref_id', ref)
    expect(le.error).toBeNull()
    expect(le.data).toEqual([])
  })

  it('escopo fora do CHECK explode', async () => {
    const { error } = await robo
      .from('content_embeddings')
      .insert({ ...linha(crypto.randomUUID()), escopo: 'roteiro' })
    expect(error?.message).toMatch(/escopo/)
  })

  it('dimensão errada explode (vector(768) não aceita vetor de 3)', async () => {
    const { error } = await robo
      .from('content_embeddings')
      .insert({ ...linha(crypto.randomUUID()), embedding: JSON.stringify([1, 2, 3]) })
    expect(error?.message).toMatch(/dimensions|768/i)
  })

  it('DELETE não existe para ninguém — nem para o dono da tabela', async () => {
    const ref = crypto.randomUUID()
    await robo.from('content_embeddings').insert(linha(ref))

    const pelaApi = await robo.from('content_embeddings').delete().eq('ref_id', ref)
    expect(pelaApi.error?.message).toMatch(/permission denied/i)

    await expect(
      sql`delete from content_embeddings where ref_id = ${ref}`,
    ).rejects.toThrow(/não se apaga/)
  })

  it('a identidade é imutável: escopo, ref_id, id e criado_em não se reescrevem', async () => {
    const ref = crypto.randomUUID()
    await robo.from('content_embeddings').insert(linha(ref))

    const trocaRef = await robo
      .from('content_embeddings')
      .update({ ref_id: crypto.randomUUID() })
      .eq('ref_id', ref)
    expect(trocaRef.error?.message).toMatch(/imutável/)

    const trocaEscopo = await robo
      .from('content_embeddings')
      .update({ escopo: 'trend' })
      .eq('ref_id', ref)
    expect(trocaEscopo.error?.message).toMatch(/imutável/)

    await expect(
      sql`update content_embeddings set criado_em = now() - interval '1 year' where ref_id = ${ref}`,
    ).rejects.toThrow(/imutável/)
  })

  it('TRUNCATE é proibido — memória da dedup não se esvazia', async () => {
    await expect(sql`truncate content_embeddings`).rejects.toThrow(/TRUNCATE proibido/)
  })
})
