/**
 * IM-0 — PROVA DE ACESSO à API de imagens.
 *
 * ⚠️ Esta prova já errou uma vez, e o erro está registrado aqui de propósito.
 * A primeira versão chamava `/v1/text2image/soul` com headers
 * `hf-api-key`/`hf-secret` e corpo em `params` — uma superfície LEGADA que
 * aceita a requisição, DEBITA crédito e nunca processa. Eu cheguei nela por
 * tentativa e erro, tratando as mensagens do servidor como bússola: quando ela
 * respondeu "body.params: Field required" eu li como progresso, quando era o
 * aviso de que eu estava na porta errada. Custou 4,68 créditos e uma conclusão
 * errada ("o provedor está quebrado") que o mantenedor, com razão, não engoliu.
 *
 * O contrato certo estava na documentação o tempo todo (docs.higgsfield.ai):
 *   POST https://platform.higgsfield.ai/{model_id}
 *     header Authorization: Key {key_id}:{key_secret}
 *     body   { prompt, aspect_ratio, resolution }
 *   GET  https://platform.higgsfield.ai/requests/{request_id}/status
 *
 * Uso:
 *   npx tsx scripts/images/probe.ts      (lê HF_CREDENTIALS do .env.local)
 */
import fs from 'node:fs'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '../..')
const BASE = 'https://platform.higgsfield.ai'
const MODELO = 'higgsfield-ai/soul/standard'
/** teto de espera: sem isto o vigia só cobre o caminho feliz e trava para sempre */
const TETO_SEGUNDOS = 600

/** .env.local é git-ignored — a credencial nunca entra no repo. */
function credenciais(): string | null {
  if (process.env.HF_CREDENTIALS) return process.env.HF_CREDENTIALS
  if (process.env.HF_API_KEY && process.env.HF_API_SECRET) {
    return `${process.env.HF_API_KEY}:${process.env.HF_API_SECRET}`
  }
  const f = path.join(raiz, '.env.local')
  if (!fs.existsSync(f)) return null
  const linha = fs
    .readFileSync(f, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('HF_CREDENTIALS='))
  if (!linha) return null
  return linha.slice('HF_CREDENTIALS='.length).trim().replace(/^["']|["']$/g, '')
}

const PROMPT =
  'Documentary photography, natural daylight, realistic colors, no color grading. ' +
  'A traveler asking a station attendant for directions in a bright train station. ' +
  'Candid, editorial stock photo look, 35mm. No text anywhere in the image. No close-up of hands.'

async function main(): Promise<void> {
  const cred = credenciais()
  if (!cred?.includes(':')) {
    console.error('Sem HF_CREDENTIALS="KEY_ID:KEY_SECRET" no .env.local (chave em cloud.higgsfield.ai).')
    process.exit(2)
  }
  const headers = {
    Authorization: `Key ${cred}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  console.log(`credencial lida (key id ${cred.split(':')[0].slice(0, 6)}…) — POST ${MODELO}`)
  const r = await fetch(`${BASE}/${MODELO}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt: PROMPT, aspect_ratio: '3:2', resolution: '1080p' }),
  })
  const criado = (await r.json()) as { request_id?: string; detail?: string }
  if (!r.ok || !criado.request_id) {
    console.error(`✗ recusou: HTTP ${r.status} ${criado.detail ?? ''}`)
    process.exit(1)
  }
  console.log(`aceito: ${criado.request_id}`)

  const t0 = Date.now()
  for (;;) {
    const s = Math.round((Date.now() - t0) / 1000)
    if (s > TETO_SEGUNDOS) {
      console.error(`\n✗ SEGUE PENDENTE após ${TETO_SEGUNDOS}s — a API aceitou mas não entregou.`)
      console.error('  Isso NÃO é o mesmo que "a API não funciona": veja o painel de Usage antes de concluir.')
      process.exit(1)
    }
    const j = (await (await fetch(`${BASE}/requests/${criado.request_id}/status`, { headers })).json()) as {
      status?: string
      images?: Array<{ url?: string }>
    }
    if (j.status === 'completed') {
      console.log(`\n✓ PROVA PASSOU em ${s}s — imagem por HTTP, sem MCP:\n  ${j.images?.[0]?.url}\n`)
      return
    }
    if (j.status && !['queued', 'in_progress'].includes(j.status)) {
      console.error(`\n✗ terminou como ${j.status}`)
      process.exit(1)
    }
    console.log(`  ${s}s ${j.status}`)
    await new Promise((res) => setTimeout(res, 10000))
  }
}

main()
