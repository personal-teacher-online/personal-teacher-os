// Sincroniza prompts/*.md → ai_prompts via publish_ai_prompt (handoff-fase4:
// "a TABELA é a fonte em EXECUÇÃO; o repo é o canônico para revisão de texto").
// Convenção fechada na Fase 4: um arquivo por name, frontmatter YAML mínimo
// (name/model/params), corpo = conteúdo do prompt. Republicar só quando o
// conteúdo/model/params diferem do ATIVO (idempotente).
//
// Uso local:  node --env-file=.env.local scripts/publish-prompts.ts
// Uso prod:   node --env-file=.env.production scripts/publish-prompts.ts
// Requer NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY... e ATENÇÃO:
// publish_ai_prompt é ADMIN-only (D10) — em produção o INSERT nasce da sessão
// da admin OU deste script com service key? NÃO: o check é app_role()='admin'.
// Por isso este script usa a RPC com um JWT de ADMIN gerado localmente pela
// service key (auth.admin.createSession não existe) — caminho suportado:
// signInWithPassword de uma conta admin passada por env (PROMPTS_ADMIN_EMAIL/
// PROMPTS_ADMIN_PASSWORD). Local: teste-senha@local.dev. Produção: a conta da
// dona NUNCA — usar a conta admin operacional do mantenedor.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const email = process.env.PROMPTS_ADMIN_EMAIL ?? 'teste-senha@local.dev'
const password = process.env.PROMPTS_ADMIN_PASSWORD ?? 'Senha-local-12345'
if (!url || !anon) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ausentes.')
  process.exit(1)
}

interface PromptFile {
  name: string
  model: string
  params: Record<string, unknown>
  content: string
}

function parsePromptFile(path: string): PromptFile {
  // Retomada 01/09/2026: checkout Windows (autocrlf) entrega CRLF e o regex do
  // frontmatter exige LF — normalizar aqui mantém o CONTEÚDO publicado idêntico
  // ao do Mac (senão cada bancada geraria uma versão nova do mesmo prompt).
  const raw = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
  if (!m) throw new Error(`${path}: sem frontmatter ---`)
  const front = m[1]
  const content = m[2].trim()
  const name = /name:\s*(\S+)/.exec(front)?.[1]
  const model = /model:\s*(\S+)/.exec(front)?.[1]
  const paramsRaw = /params:\s*(\{.*\})/.exec(front)?.[1]
  if (!name || !model) throw new Error(`${path}: frontmatter precisa de name e model`)
  return { name, model, params: paramsRaw ? JSON.parse(paramsRaw) : {}, content }
}

async function main() {
  const supabase = createClient(url!, anon!, { auth: { persistSession: false } })
  const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password })
  if (loginErr) {
    console.error(`login admin falhou (${email}): ${loginErr.message}`)
    process.exit(1)
  }

  const dir = join(process.cwd(), 'prompts')
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
  for (const f of files) {
    const p = parsePromptFile(join(dir, f))
    const { data: active } = await supabase
      .from('ai_prompts')
      .select('version, content, model, params')
      .eq('name', p.name)
      .eq('active', true)
      .maybeSingle()
    const same =
      active &&
      active.content === p.content &&
      active.model === p.model &&
      JSON.stringify(active.params ?? {}) === JSON.stringify(p.params)
    if (same) {
      console.log(`${p.name}: v${active.version} já ativa e idêntica — nada a fazer`)
      continue
    }
    const { data, error } = await supabase.rpc('publish_ai_prompt', {
      p_name: p.name,
      p_content: p.content,
      p_model: p.model,
      p_params: p.params as never,
    })
    if (error) {
      console.error(`${p.name}: publish falhou — ${error.message}`)
      process.exitCode = 1
    } else {
      console.log(`${p.name}: publicada nova versão (${JSON.stringify(data)})`)
    }
  }
}

main().catch((err) => {
  console.error('publish-prompts falhou:', err)
  process.exit(1)
})
