#!/usr/bin/env node
/* eslint-disable */
// SONDA DA EVOLUTION — gate de contrato do M3 (Onda Agenda e Mensagens, 01/09/2026).
//
// Por que existe: o cano de WhatsApp descarta o id da mensagem no envio e o
// webhook de recepção só arquiva o payload cru. Para nascer o estado "entregue",
// os campos têm de ser CONFERIDOS na prática (regra de ouro do handoff-whatsapp:
// campo de payload se confere, nunca se supõe). Esta sonda imprime tudo CRU.
//
// Zero dependências (só `fetch` do Node ≥ 18): a Evolution NÃO tem domínio
// público (runbook §M), então os subcomandos que falam com ela rodam DENTRO do
// container do app na VPS, onde EVOLUTION_URL/API_KEY/INSTANCE já estão na env:
//
//   docker exec -i <container-do-app> node - --webhook  < scripts/evolution-sonda.cjs
//   docker exec -i <container-do-app> node - --enviar +5565999990000 < scripts/evolution-sonda.cjs
//   docker exec -i <container-do-app> node - --webhook --apply < scripts/evolution-sonda.cjs
//
// O `--amostra` lê a inbox pelo PostgREST público e roda de QUALQUER máquina com
// `.env.production` (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
//
//   npm run evolution:amostra:prod -- 20
//
// Subcomandos:
//   --webhook            GET /webhook/find/{instance}: a configuração ATUAL, crua.
//   --webhook --apply    POST /webhook/set/{instance}: grava a URL de produção, o
//                        header `evolution-webhook-token` (= EVOLUTION_WEBHOOK_TOKEN,
//                        obrigatório) e os eventos SEND_MESSAGE + MESSAGES_UPDATE.
//                        Configuração PERSISTENTE numa integração — só com OK do dono.
//                        `--legado` usa os nomes de campo das versões 2.0–2.2
//                        (webhookByEvents/webhookBase64). NÃO decida pelo GET: na 2.3.7
//                        ele SEMPRE mostra esses nomes (lê a tabela), e o POST só aceita
//                        byEvents/base64 (medido em 26/10/2026) — na 2.3.x, sem --legado.
//   --enviar <E.164>     POST /message/sendText: manda "sonda M3" para o número e
//                        imprime a resposta crua (é onde o id da mensagem aparece).
//   --amostra [N]        últimos N eventos (padrão 10) de webhook_inbox com
//                        source = 'evolution', por tipo, com o payload cru.
//
// Nada aqui grava no banco. Só `--webhook --apply` muda alguma coisa (na Evolution).

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const after = (f) => {
  const i = args.indexOf(f)
  return i >= 0 ? args[i + 1] : undefined
}

const APP_WEBHOOK_URL = 'https://app.personal-teacher.com/api/webhooks/evolution'
const EVENTOS = ['SEND_MESSAGE', 'MESSAGES_UPDATE']

function evolutionConfig() {
  const url = (process.env.EVOLUTION_URL || '').replace(/\/$/, '')
  const apiKey = process.env.EVOLUTION_API_KEY
  const instance = process.env.EVOLUTION_INSTANCE
  if (!url || !apiKey || !instance) {
    fail('EVOLUTION_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE ausentes — rode dentro do container do app (runbook §M).')
  }
  return { url, apiKey, instance }
}

function fail(msg) {
  console.error('✗ ' + msg)
  process.exit(1)
}

async function evo(method, path, body) {
  const { url, apiKey, instance } = evolutionConfig()
  const res = await fetch(`${url}${path.replace('{instance}', encodeURIComponent(instance))}`, {
    method,
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, ok: res.ok, json, text }
}

/** Segredos e conteúdo de conversa NUNCA saem no terminal: a Evolution manda a
 *  própria `apikey` dentro de TODO payload de webhook (medido em 01/09/2026 na
 *  inbox de produção), e o header do nosso webhook carrega o token. Máscara
 *  por nome de chave + corpo da mensagem reduzido às CHAVES (o gate precisa da
 *  FORMA do payload, não do texto que alguém escreveu). */
function redigir(v, chave = '') {
  if (Array.isArray(v)) return v.map((x) => redigir(x))
  if (v && typeof v === 'object') {
    const out = {}
    for (const [k, x] of Object.entries(v)) {
      if (/apikey|api_key|token|authorization|secret|password/i.test(k)) out[k] = '<oculto>'
      else if (k === 'message' && x && typeof x === 'object') out[k] = { '<chaves>': Object.keys(x) }
      else if (/^(pushName|text|conversation|caption)$/.test(k)) out[k] = '<texto oculto>'
      else out[k] = redigir(x, k)
    }
    return out
  }
  return v
}

function imprimir(rotulo, r) {
  console.log(`\n=== ${rotulo} → HTTP ${r.status} ===`)
  console.log(r.json ? JSON.stringify(redigir(r.json), null, 2) : r.text)
}

async function webhook() {
  const atual = await evo('GET', '/webhook/find/{instance}')
  imprimir('webhook atual (GET /webhook/find)', atual)
  if (!has('--apply')) {
    console.log('\n(para gravar: --webhook --apply [--legado]; exige EVOLUTION_WEBHOOK_TOKEN na env)')
    return
  }
  const token = process.env.EVOLUTION_WEBHOOK_TOKEN
  if (!token) fail('EVOLUTION_WEBHOOK_TOKEN ausente — gere (32+ chars, Bitwarden), ponha na env do app e Redeploy ANTES de gravar o webhook.')
  const headers = { 'evolution-webhook-token': token }
  const corpo = has('--legado')
    ? { webhook: { enabled: true, url: APP_WEBHOOK_URL, headers, webhookByEvents: false, webhookBase64: false, events: EVENTOS } }
    : { webhook: { enabled: true, url: APP_WEBHOOK_URL, headers, byEvents: false, base64: false, events: EVENTOS } }
  console.log('\n→ gravando:', JSON.stringify({ ...corpo, webhook: { ...corpo.webhook, headers: { 'evolution-webhook-token': '<oculto>' } } }, null, 2))
  const set = await evo('POST', '/webhook/set/{instance}', corpo)
  imprimir('webhook gravado (POST /webhook/set)', set)
  if (!set.ok) fail('a Evolution recusou — confira o formato no GET acima e tente --legado (ou o contrário).')
  const depois = await evo('GET', '/webhook/find/{instance}')
  imprimir('webhook depois (GET /webhook/find)', depois)
}

async function enviar() {
  const numero = after('--enviar')
  if (!numero || !/^\+?\d{10,15}$/.test(numero)) fail('use --enviar +55DDDNUMERO (E.164)')
  const r = await evo('POST', '/message/sendText/{instance}', {
    number: numero.replace(/\D/g, ''),
    text: `sonda M3 · ${new Date().toISOString()} · pode ignorar`,
    linkPreview: false,
  })
  imprimir('resposta do envio (POST /message/sendText)', r)
  console.log('\nO que conferir: onde está o ID da mensagem (esperado em key.id) e o status inicial.')
  console.log('Depois, no celular: receber e ABRIR a mensagem — isso gera os eventos de entrega e leitura;')
  console.log('em seguida, de qualquer máquina com .env.production: npm run evolution:amostra:prod')
}

async function amostra() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) fail('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY ausentes (.env.production)')
  if (url.includes('127.0.0.1') || url.includes('localhost')) {
    console.log('⚠ alvo é o Supabase LOCAL — para produção use o script :prod')
  }
  const n = Number(after('--amostra')) || 10
  const res = await fetch(
    `${url}/rest/v1/webhook_inbox?source=eq.evolution&select=id,event_id,received_at,processed_at,error,payload&order=received_at.desc&limit=${n}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) fail(`PostgREST ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const rows = await res.json()
  console.log(`\n=== ${rows.length} evento(s) mais recentes de source = evolution ===`)
  const porTipo = {}
  for (const r of rows) {
    const ev = (r.payload && r.payload.event) || '?'
    porTipo[ev] = (porTipo[ev] || 0) + 1
  }
  console.log('por tipo:', JSON.stringify(porTipo))
  for (const r of rows) {
    console.log(`\n--- #${r.id} · ${r.received_at} · event=${(r.payload && r.payload.event) || '?'} · event_id=${r.event_id}`)
    console.log(JSON.stringify(redigir(r.payload), null, 2))
  }
  console.log('\nO que conferir no messages.update: a chave da mensagem (keyId? key.id?), o campo de status')
  console.log('(DELIVERY_ACK / READ / …) e o fromMe. Os payloads viram fixtures em tests/fixtures/evolution/.')
}

/** A instância está conectada ao WhatsApp? (medido em 01/09: a inbox de produção
 *  parou de receber eventos em 11/08 — pode ser silêncio real ou Baileys caído.) */
async function estado() {
  imprimir('estado da conexão (GET /instance/connectionState)', await evo('GET', '/instance/connectionState/{instance}'))
  console.log('\nEsperado: state = "open". "close"/"connecting" = reparear pelo QR (runbook §M.7).')
}

;(async () => {
  if (has('--estado')) return estado()
  if (has('--webhook')) return webhook()
  if (has('--enviar')) return enviar()
  if (has('--amostra')) return amostra()
  console.log('uso: --estado | --webhook [--apply [--legado]] | --enviar <E.164> | --amostra [N]  (ver cabeçalho)')
})().catch((err) => fail(String(err && err.stack ? err.stack : err)))
