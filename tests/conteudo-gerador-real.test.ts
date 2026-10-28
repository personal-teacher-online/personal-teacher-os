// PROVA REAL do gerador de roteiro (M2) — a "corrida de verdade" que a regra 3
// da frente de conteúdo exige. PULADO por padrão: gasta crédito da API.
//
//   PROVA_REAL=1 npx vitest run tests/conteudo-gerador-real.test.ts
//
// Exige, além do supabase local: `node --env-file=.env.local
// scripts/publish-prompts.ts` (o prompt content-reel-script tem de estar ATIVO)
// e ANTHROPIC_API_KEY no ambiente.
//
// Aqui NÃO se mocka nada: é o mesmo caminho que a action "Gerar agora" percorre,
// com o client da sessão admin, contra a API de verdade. O que se prova é que a
// cadeia inteira fecha — prompt ativo → voz → claim → Claude → validação
// estrita → rascunho legível —, não a qualidade editorial (essa é do dono).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { generateReelScript } from '@/lib/content/generate'
import { getActiveBrandVoice } from '@/lib/content/voice'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect } from './helpers/db'

const ligado = Boolean(process.env.PROVA_REAL && process.env.ANTHROPIC_API_KEY)

let sql: Sql
let service: SupabaseClient
let painel: SupabaseClient
let adminId: string

beforeAll(async () => {
  if (!ligado) return
  sql = connect(2)
  service = serviceClient()
  adminId = await createAuthUser(sql, 'admin', 'Admin prova real M2')
  painel = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  if (ligado) await sql.end()
})

describe.skipIf(!ligado)('PROVA REAL — ideia aprovada → rascunho, contra a API', () => {
  it('gera um roteiro legível pelo mesmo caminho do botão do painel', async () => {
    // Voz ativa é pré-requisito do gerador; publica a v1 do repo se faltar.
    if (!(await getActiveBrandVoice(service))) {
      const voz = readFileSync('brand/voice/voz-v1.md', 'utf8')
      const { error } = await painel.rpc('publish_brand_voice', {
        p_content_md: voz,
        p_notes: 'prova real do M2',
      })
      expect(error).toBeNull()
    }

    // Uma das 9 premissas que o dono aprovou na calibração.
    const ref = `prova-real-${crypto.randomUUID().slice(0, 8)}`
    const [post] = await sql`
      insert into content_posts (external_ref, kind, tema, gancho, idea)
      values (
        ${ref}, 'roteiro_reel',
        '4 frases pra não passar vergonha no restaurante',
        'Essas 4 frases vão salvar sua próxima viagem aos Estados Unidos.',
        ${sql.json({
          premissa:
            'Lista numerada de 4 situações de restaurante, cada bloco no padrão 🇧🇷 frase em português → ❌ erro comum → ✅ frase certa em inglês repetida duas vezes. Fecha com CTA de link na bio para a aula experimental.',
          de_onde_veio:
            "cópia fiel do formato '04 frases pra usar nos restaurantes nos EUA' da Ask Jackie",
        })}
      ) returning id`
    await sql`
      update content_posts
         set status = 'ideia_aprovada', idea_approved_by = ${adminId}, idea_approved_at = now()
       where id = ${post.id}`

    const comecou = Date.now()
    const res = await generateReelScript(painel, post.id as string)
    const segundos = (Date.now() - comecou) / 1000

    const [row] = await sql`
      select status, roteiro, legenda, brand_voice_version, generation_meta
        from content_posts where id = ${post.id}`

    if (!res.ok) {
      throw new Error(`geração falhou (${res.reason}): ${res.detalhe} — post em ${row.status}`)
    }

    expect(row.status).toBe('rascunho')
    expect(row.roteiro).toMatch(/^GANCHO: \S/m)
    expect(row.roteiro).toMatch(/^CENA 1$/m)
    expect(row.roteiro).toMatch(/^CTA$/m)
    expect(row.roteiro).toMatch(/^LEGENDA$/m)
    expect(row.legenda?.length).toBeGreaterThan(10)
    expect(row.generation_meta.modelo).toBe('claude-sonnet-5')
    expect(row.brand_voice_version).toBeGreaterThanOrEqual(1)

    // Sai no terminal para leitura humana — o valor desta prova é VER o rascunho.
    console.log(`\n✔ rascunho em ${segundos.toFixed(1)}s (voz v${row.brand_voice_version})\n`)
    console.log(row.roteiro)
    console.log(`\n── LEGENDA ──\n${row.legenda}\n`)
  }, 180_000)
})
