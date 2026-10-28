// Cliente Hotmart (Fase 5 — construção total 14/07/2026). Fatos CONFERIDOS na
// doc oficial em 14/07/2026 (developers.hotmart.com — agente de verificação,
// zero [VERIFICAR] remanescente):
//  - OAuth client_credentials: POST https://api-sec-vlc.hotmart.com/security/oauth/token
//    ?grant_type=client_credentials&client_id=...&client_secret=... com header
//    Authorization: Basic {HOTMART_BASIC} (o 3º valor das Developer Credentials);
//    resposta { access_token, expires_in ~172799s (~48h) }.
//  - Progresso: GET https://developers.hotmart.com/club/api/v1/users?subdomain=X
//    [&email=Y] com Bearer; items[].progress.completed_percentage (double) +
//    user "email"; paginação por page_token/max_results.
//  - Rate limit 500 req/min (nossa escala: 6 mentorados — irrelevante, mas o
//    polling pagina com parcimônia mesmo assim).
// Fail-closed sem envs (padrão evolution.ts): erro claro, nunca chamada anônima.

export interface HotmartConfig {
  clientId: string
  clientSecret: string
  basic: string
  subdomain: string
}

export function hotmartConfigFromEnv(): HotmartConfig | null {
  const clientId = process.env.HOTMART_CLIENT_ID
  const clientSecret = process.env.HOTMART_CLIENT_SECRET
  const basic = process.env.HOTMART_BASIC
  const subdomain = process.env.HOTMART_SUBDOMAIN
  if (!clientId || !clientSecret || !basic || !subdomain) return null
  return { clientId, clientSecret, basic, subdomain }
}

const TOKEN_URL = 'https://api-sec-vlc.hotmart.com/security/oauth/token'
const CLUB_USERS_URL = 'https://developers.hotmart.com/club/api/v1/users'

// Cache de token em memória do processo (expira ~48h; margem de 60s).
let cached: { token: string; expiresAt: number } | null = null

export async function hotmartToken(cfg: HotmartConfig): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token
  const url = `${TOKEN_URL}?grant_type=client_credentials&client_id=${encodeURIComponent(cfg.clientId)}&client_secret=${encodeURIComponent(cfg.clientSecret)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${cfg.basic}` },
  })
  if (!res.ok) {
    throw new Error(`hotmart oauth falhou: HTTP ${res.status}`)
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) throw new Error('hotmart oauth sem access_token na resposta')
  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (Number(body.expires_in ?? 3600) - 60) * 1000,
  }
  return cached.token
}

interface ClubUser {
  user_id?: string
  email?: string
  progress?: { completed_percentage?: number; total?: number; completed?: number }
}

interface ClubUsersPage {
  items?: ClubUser[]
  page_info?: { next_page_token?: string }
}

/** Progresso (%) de UM aluno pelo e-mail — gatilho do webhook CLUB_MODULE_COMPLETED
 *  (o evento não traz percentual; o fetch traz — decisão do handoff-fase5 §passo 0.2). */
export async function fetchProgressByEmail(cfg: HotmartConfig, email: string): Promise<number | null> {
  const token = await hotmartToken(cfg)
  const url = `${CLUB_USERS_URL}?subdomain=${encodeURIComponent(cfg.subdomain)}&email=${encodeURIComponent(email)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`hotmart get-users falhou: HTTP ${res.status}`)
  const page = (await res.json()) as ClubUsersPage
  // O filtro por email aceita e-mail PARCIAL (doc) — casar exato aqui.
  const hit = (page.items ?? []).find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase())
  const pct = hit?.progress?.completed_percentage
  return typeof pct === 'number' ? pct : null
}

/** Todos os alunos do Club com progresso (polling diário autoritativo). */
export async function listAllProgress(cfg: HotmartConfig): Promise<Map<string, number>> {
  const token = await hotmartToken(cfg)
  const out = new Map<string, number>()
  let pageToken: string | undefined
  // Teto defensivo de páginas: 6 mentorados hoje, 50 páginas cobre qualquer futuro.
  for (let i = 0; i < 50; i++) {
    const url =
      `${CLUB_USERS_URL}?subdomain=${encodeURIComponent(cfg.subdomain)}&max_results=100` +
      (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '')
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`hotmart get-users falhou: HTTP ${res.status}`)
    const page = (await res.json()) as ClubUsersPage
    for (const u of page.items ?? []) {
      const pct = u.progress?.completed_percentage
      if (u.email && typeof pct === 'number') out.set(u.email.toLowerCase(), pct)
    }
    pageToken = page.page_info?.next_page_token
    if (!pageToken) break
  }
  return out
}
