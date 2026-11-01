// #115 — a porta do link que entra logado (ADR-019) com o destino no CAMINHO.
//
// O botão de URL da Meta tem UMA variável, no fim da URL, e a Meta não garante
// `?` dentro dela: o link do lembrete passa a ser `/wa/<hash>/aula/<id>`. A
// forma antiga (`/wa/<hash>?ir=/portal/aula/<id>`) continua valendo para o que
// já saiu, e destino fora de `/portal` continua recusado (não vira open
// redirect). #116: o aviso de crédito vencendo entra pela mesma porta, em
// `/wa/<hash>/creditos`, e cai em `/portal/creditos`. O GoTrue é o da bancada: o magic link é gerado de verdade e
// trocado por sessão pela rota; só o cliente de cookies do Next é trocado por
// um cliente sem cookies (a rota não lê nada dele além do `verifyOtp`).
import { NextRequest } from 'next/server'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('./helpers/auth')
  return {
    createClient: async () =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }),
  }
})

import { resolveAccess } from '@/lib/auth/gate'
import { GET as comDestinoNaQuery } from '@/app/wa/[token]/route'
import { GET as comDestinoNoCaminho } from '@/app/wa/[token]/aula/[id]/route'
import { GET as paraOsCreditos } from '@/app/wa/[token]/creditos/route'
import { createAuthUser, serviceClient } from './helpers/auth'
import { connect } from './helpers/db'

let sql: Sql
let servico: SupabaseClient
let email: string

beforeAll(async () => {
  sql = connect(1)
  servico = serviceClient()
  const id = await createAuthUser(sql, 'student', 'Aluna link logado')
  const [u] = await sql`select email from auth.users where id = ${id}`
  email = u.email as string
})
afterAll(async () => {
  await sql.end()
})

/** Um magic link novo (uso único), como o despachante gera por mensagem. */
async function novoToken(): Promise<string> {
  const { data, error } = await servico.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data.properties?.hashed_token) throw new Error(`magic link não gerado: ${error?.message}`)
  return data.properties.hashed_token
}

const AULA = '00000000-0000-0000-0000-0000000000aa'
const BASE = 'https://app.pteacheracademy.com'

async function pelaRotaDoCaminho(token: string, id: string): Promise<Response> {
  return comDestinoNoCaminho(new NextRequest(`${BASE}/wa/${token}/aula/${id}`), {
    params: Promise.resolve({ token, id }),
  })
}

async function pelaRotaDaQuery(token: string, ir: string): Promise<Response> {
  return comDestinoNaQuery(new NextRequest(`${BASE}/wa/${token}?ir=${encodeURIComponent(ir)}`), {
    params: Promise.resolve({ token }),
  })
}

describe('#115 · /wa/<hash>/aula/<id>', () => {
  it('o gate deixa a rota decidir, sem sessão (como a forma antiga)', () => {
    expect(resolveAccess(null, `/wa/abc/aula/${AULA}`)).toEqual({ kind: 'allow' })
    expect(resolveAccess(null, '/wa/abc')).toEqual({ kind: 'allow' })
  })

  it('entra logado e cai na página da aula', async () => {
    const r = await pelaRotaDoCaminho(await novoToken(), AULA)
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe(`/portal/aula/${AULA}`)
  })

  it('o mesmo link de novo (uso único): vai para o login com a aula como destino', async () => {
    const token = await novoToken()
    await pelaRotaDoCaminho(token, AULA)
    const r = await pelaRotaDoCaminho(token, AULA)
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe(`/login?erro=link-invalido&next=${encodeURIComponent(`/portal/aula/${AULA}`)}`)
  })

  it('id que não é de aula não monta caminho: cai no início do portal', async () => {
    for (const id of ['..%2F..%2Fadmin', 'abc', `${AULA}/extra`]) {
      const r = await pelaRotaDoCaminho(await novoToken(), id)
      expect(r.headers.get('location'), id).toBe('/portal')
    }
  })
})

describe('#115 · a forma antiga continua valendo (ADR-019)', () => {
  it('/wa/<hash>?ir=/portal/aula/<id> entra logado e cai na aula', async () => {
    const r = await pelaRotaDaQuery(await novoToken(), `/portal/aula/${AULA}`)
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe(`/portal/aula/${AULA}`)
  })

  it('destino fora de /portal continua recusado', async () => {
    for (const ir of ['https://exemplo.com/', '/admin', '//exemplo.com', '/portalx']) {
      const r = await pelaRotaDaQuery(await novoToken(), ir)
      expect(r.headers.get('location'), ir).toBe('/portal')
    }
  })
})

describe('#116 · /wa/<hash>/creditos', () => {
  async function pelaRotaDosCreditos(token: string): Promise<Response> {
    return paraOsCreditos(new NextRequest(`${BASE}/wa/${token}/creditos`), { params: Promise.resolve({ token }) })
  }

  it('o gate deixa a rota decidir, sem sessão', () => {
    expect(resolveAccess(null, '/wa/abc/creditos')).toEqual({ kind: 'allow' })
  })

  it('entra logado e cai na tela de créditos', async () => {
    const r = await pelaRotaDosCreditos(await novoToken())
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/portal/creditos')
  })

  it('o mesmo link de novo (uso único): vai para o login com os créditos como destino', async () => {
    const token = await novoToken()
    await pelaRotaDosCreditos(token)
    const r = await pelaRotaDosCreditos(token)
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe(`/login?erro=link-invalido&next=${encodeURIComponent('/portal/creditos')}`)
  })
})
