// Rotas /api/content/* (ADR-021) — núcleo injetável de src/lib/content/handle.ts:
// 401 fail-closed, idempotência de ideias, lock do claim, entrega com sink fake.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  handleContentClaim,
  handleContentEntrega,
  handleContentErro,
  handleContentFila,
  handleContentRefs,
  type ContentAuth,
  type ImageSink,
} from '@/lib/content/handle'
import { createAuthUser, serviceClient } from './helpers/auth'
import { connect } from './helpers/db'

let sql: Sql
let admin: SupabaseClient
let adminId: string

const TOKEN = 'token-de-teste-com-32-caracteres!!'
const okAuth: ContentAuth = { token: TOKEN, expectedToken: TOKEN }

beforeAll(async () => {
  sql = connect(3)
  admin = serviceClient()
  adminId = await createAuthUser(sql, 'admin', 'Admin content-api')
  // Higiene do banco compartilhado (suíte roda sem reset): fixtures de execuções
  // ANTERIORES presas em ideia_aprovada lotariam a janela de 3 posts do /fila.
  // DELETE é proibido (guard/Lei 8) — a varredura usa a transição legítima para
  // descartado. O corte de 1h nunca alcança fixtures da execução corrente.
  await sql`
    update content_posts set status = 'descartado'
    where status = 'ideia_aprovada' and idea_approved_at < now() - interval '1 hour'`
})
afterAll(async () => {
  await sql.end()
})

function ref(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

/**
 * A ideia de fixture nasce por INSERT direto (service_role), e não mais pela
 * rota: `POST /api/content/ideias` morreu na Leva 6.3 — era a porta que criava
 * ideia de robô para um Portão 1 que não existe mais. O que estes casos provam
 * (401 fail-closed, claim, entrega, erro, refs) não depende dela; só precisavam
 * de um post na fila.
 */
async function criarIdeiaDeFixture(externalRef: string): Promise<void> {
  const { error } = await admin
    .from('content_posts')
    .insert({ external_ref: externalRef, kind: 'carrossel', tema: 'Tema ' + externalRef })
  expect(error, `fixture recusada: ${error?.message}`).toBeNull()
}

/** Sink fake: registra as chamadas e devolve ids previsíveis. */
function fakeSink() {
  const persisted: Array<{ postId: string; slide: number | null; mime: string; bytes: number }> = []
  const sink: ImageSink = {
    async persist({ postId, slide, mime, data }) {
      persisted.push({ postId, slide, mime, bytes: data.byteLength })
      return { drive_file_id: `fake-${persisted.length}` }
    },
    async fetchUrl() {
      return { mime: 'image/png', data: new Uint8Array([1, 2, 3]) }
    },
  }
  return { sink, persisted }
}

async function approvedPost(prefix: string): Promise<string> {
  const r = ref(prefix)
  await criarIdeiaDeFixture(r)
  const [row] = await sql`
    update content_posts
       set status = 'ideia_aprovada', idea_approved_by = ${adminId}, idea_approved_at = now()
     where external_ref = ${r}
     returning id`
  return row.id as string
}

describe('401 fail-closed (padrão da casa)', () => {
  it.each([
    ['sem env', { token: TOKEN, expectedToken: undefined }],
    ['sem token', { token: null, expectedToken: TOKEN }],
    ['token errado', { token: 'errado', expectedToken: TOKEN }],
  ])('%s → 401 e NADA entregue', async (_nome, auth) => {
    const res = await handleContentFila(admin, auth as ContentAuth)
    expect(res.status).toBe(401)
    expect(res.body.ok).toBe(false)
    expect(res.body.posts).toBeUndefined()
  })
})

describe('a porta de escrita de ideias morreu (Leva 6.3)', () => {
  it('não existe mais rota nem miolo para criar ideia de robô por HTTP', async () => {
    // Tripwire: se alguém reintroduzir a porta, este caso acende. A ideia do
    // robô agora nasce SÓ de uma trend (gerar_roteiro_da_trend), e a avulsa
    // nasce da mão da dona na tela. A checagem é de ARQUIVO porque um
    // `import()` de módulo inexistente não compila — o que é, por si, metade da
    // prova.
    expect(existsSync(new URL('../src/app/api/content/ideias/route.ts', import.meta.url))).toBe(false)
    expect(existsSync(new URL('../src/lib/content/ideias.ts', import.meta.url))).toBe(false)
    const modulo = (await import('@/lib/content/handle')) as Record<string, unknown>
    expect(modulo.handleContentIdeias).toBeUndefined()
  })
})

describe('GET /fila', () => {
  it('devolve posts em ideia_aprovada (mais antigos primeiro) + voz ativa', async () => {
    const id = await approvedPost('fila')
    // garante lugar na janela de 3: aprovação lá atrás
    await sql`update content_posts set idea_approved_at = '2000-01-01' where id = ${id}`
    const res = await handleContentFila(admin, okAuth)
    expect(res.status).toBe(200)
    const posts = res.body.posts as Array<{ id: string }>
    expect(posts.some((p) => p.id === id)).toBe(true)
  })
})

describe('POST /claim (cadeado)', () => {
  it('reivindica 1×; segunda tentativa → 409; attempts incrementa', async () => {
    const id = await approvedPost('claim')
    const a = await handleContentClaim(admin, okAuth, { post_id: id })
    expect(a.status).toBe(200)
    const b = await handleContentClaim(admin, okAuth, { post_id: id })
    expect(b.status).toBe(409)
    const [row] = await sql`
      select status, generation_attempts from content_posts where id = ${id}`
    expect(row.status).toBe('gerando')
    expect(row.generation_attempts).toBe(1)
  })

  it('post inexistente → 404', async () => {
    const res = await handleContentClaim(admin, okAuth, { post_id: crypto.randomUUID() })
    expect(res.status).toBe(404)
  })
})

describe('POST /entrega', () => {
  it('gerando → rascunho com imagens persistidas (base64 e url)', async () => {
    const id = await approvedPost('entrega')
    await handleContentClaim(admin, okAuth, { post_id: id })
    const { sink, persisted } = fakeSink()
    const res = await handleContentEntrega(
      admin,
      okAuth,
      {
        post_id: id,
        legenda: 'Legenda pronta ✨',
        slides: [
          { ordem: 1, titulo: 'Set off', texto: 'partir de viagem' },
          { ordem: 2, texto: 'exemplo em frase' },
        ],
        images: [
          { slide: 1, provider: 'gemini', base64: Buffer.from('png-fake').toString('base64'), mime: 'image/png' },
          { slide: 2, provider: 'fal', url: 'https://fal.media/fake.png' },
        ],
        generation_meta: { modelo: 'gemini-3-pro-image' },
      },
      sink,
    )
    expect(res.status).toBe(200)
    expect(persisted).toHaveLength(2)
    const [row] = await sql`
      select status, legenda, images, image_provider from content_posts where id = ${id}`
    expect(row.status).toBe('rascunho')
    expect(row.legenda).toContain('Legenda')
    expect(row.images).toHaveLength(2)
    expect(row.images[0].drive_file_id).toBe('fake-1')
    expect(row.image_provider).toBe('gemini')
  })

  it('guarda as DUAS versões de cada cena, na ordem — a 1ª é a que vale', async () => {
    const id = await approvedPost('entrega-variantes')
    await handleContentClaim(admin, okAuth, { post_id: id })
    const { sink, persisted } = fakeSink()
    const b64 = Buffer.from('png-fake').toString('base64')
    const res = await handleContentEntrega(
      admin,
      okAuth,
      {
        post_id: id,
        legenda: 'Legenda com duas versões de cada cena',
        slides: [{ ordem: 1, texto: 'capa' }, { ordem: 2, texto: 'o termo é LAYOVER' }],
        images: [
          { slide: 1, variante: 1, provider: 'gemini', base64: b64, mime: 'image/png' },
          { slide: 1, variante: 2, provider: 'gemini', base64: b64, mime: 'image/png' },
          { slide: 2, variante: 1, provider: 'gemini', base64: b64, mime: 'image/png' },
          { slide: 2, variante: 2, provider: 'gemini', base64: b64, mime: 'image/png' },
        ],
      },
      sink,
    )
    expect(res.status).toBe(200)
    expect(persisted).toHaveLength(4)
    const [row] = await sql`select images from content_posts where id = ${id}`
    expect(row.images).toHaveLength(4)
    expect(row.images.map((i: { variante: number }) => i.variante)).toEqual([1, 2, 1, 2])
    // a que vale para o slide 2 é a PRIMEIRA registrada com aquele número
    const doSlide2 = row.images.filter((i: { slide: number }) => i.slide === 2)
    expect(doSlide2[0].variante).toBe(1)
  })

  it('imagem sem variante declarada assume a 1ª (compatível com posts antigos)', async () => {
    const id = await approvedPost('entrega-sem-variante')
    await handleContentClaim(admin, okAuth, { post_id: id })
    const { sink } = fakeSink()
    const res = await handleContentEntrega(
      admin,
      okAuth,
      {
        post_id: id,
        legenda: 'sem variante declarada',
        images: [{ slide: 1, provider: 'banco-fotos', base64: 'QUFB', mime: 'image/png' }],
      },
      sink,
    )
    expect(res.status).toBe(200)
    const [row] = await sql`select images from content_posts where id = ${id}`
    expect(row.images[0].variante).toBe(1)
  })

  it('post que não está gerando → 409 (nada persiste)', async () => {
    const id = await approvedPost('entrega-409')
    const { sink, persisted } = fakeSink()
    const res = await handleContentEntrega(
      admin,
      okAuth,
      { post_id: id, legenda: 'x', images: [] },
      sink,
    )
    expect(res.status).toBe(409)
    expect(persisted).toHaveLength(0)
  })

  it('falha do Drive → 502 e o post SEGUE em gerando', async () => {
    const id = await approvedPost('entrega-drive')
    await handleContentClaim(admin, okAuth, { post_id: id })
    const sink: ImageSink = {
      persist: async () => {
        throw new Error('Drive fora do ar')
      },
      fetchUrl: async () => ({ mime: 'image/png', data: new Uint8Array([1]) }),
    }
    const res = await handleContentEntrega(
      admin,
      okAuth,
      {
        post_id: id,
        legenda: 'x',
        images: [{ provider: 'gemini', base64: 'QUFB', mime: 'image/png' }],
      },
      sink,
    )
    expect(res.status).toBe(502)
    const [row] = await sql`select status from content_posts where id = ${id}`
    expect(row.status).toBe('gerando')
  })
})

describe('POST /erro', () => {
  it('devolve gerando → ideia_aprovada com o erro registrado', async () => {
    const id = await approvedPost('erro')
    await handleContentClaim(admin, okAuth, { post_id: id })
    const res = await handleContentErro(admin, okAuth, { post_id: id, error: 'timeout do provedor' })
    expect(res.status).toBe(200)
    const [row] = await sql`
      select status, generation_error from content_posts where id = ${id}`
    expect(row.status).toBe('ideia_aprovada')
    expect(row.generation_error).toBe('timeout do provedor')
  })

  it('post fora de gerando → 409', async () => {
    const id = await approvedPost('erro-409')
    const res = await handleContentErro(admin, okAuth, { post_id: id, error: 'x' })
    expect(res.status).toBe(409)
  })
})

describe('GET /refs', () => {
  it('401 sem token; com token devolve a lista da fonte', async () => {
    const refs = {
      list: async () => [{ mime: 'image/jpeg', base64: 'QUJD' }],
    }
    const sem = await handleContentRefs({ token: null, expectedToken: TOKEN }, refs)
    expect(sem.status).toBe(401)
    const com = await handleContentRefs(okAuth, refs)
    expect(com.status).toBe(200)
    expect(com.body.refs).toEqual([{ mime: 'image/jpeg', base64: 'QUJD' }])
  })

  it('fonte quebrada → 502 honesto', async () => {
    const refs = {
      list: async (): Promise<never> => {
        throw new Error('pasta não compartilhada com a SA')
      },
    }
    const res = await handleContentRefs(okAuth, refs)
    expect(res.status).toBe(502)
    expect(String(res.body.detail)).toContain('pasta')
  })
})
