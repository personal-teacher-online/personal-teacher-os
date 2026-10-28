import { google } from 'googleapis'

// OAuth da conta PESSOAL da professora (ADR-017). Fatos conferidos na doc
// oficial do Google em 14/07/2026 (agente de verificação):
//  - escopo ÚNICO sensível `calendar.events` cobre events.list/insert/patch/
//    delete em qualquer agenda dela (inclusive a principal) — a leitura dos
//    afazeres usa events.list, então NÃO precisamos de calendar.readonly nem
//    de freebusy.query (que exigiriam escopo extra);
//  - openid+email só para exibir QUAL conta foi conectada (não-sensíveis);
//  - refresh_token: só vem com access_type=offline e SÓ na primeira troca —
//    prompt=consent força reemissão (professora reconectando não pode receber
//    resposta sem refresh_token);
//  - app "Em produção" sem verificação: tela de aviso "app não verificado"
//    (professora clica em avançar UMA vez), teto de 100 usuários — ok para
//    2–5 professoras; em status "Testing" o refresh token EXPIRA em 7 dias,
//    então o app OAuth deve ficar publicado "In production" (runbook M0).

export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
]

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUrl: string
}

export function googleOAuthConfigFromEnv(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return {
    clientId,
    clientSecret,
    // O callback é a ROTA REAL src/app/teacher/google/callback — tem de bater
    // com o URI registrado no Google Cloud. O default abaixo foi a causa do
    // redirect_uri_mismatch (15/07): apontava para /api/google/oauth/callback,
    // que nem é rota do app. Só use GOOGLE_OAUTH_REDIRECT_URL para o dev local.
    redirectUrl:
      process.env.GOOGLE_OAUTH_REDIRECT_URL ??
      'https://app.personal-teacher.com/teacher/google/callback',
  }
}

// Tipo do cliente REALMENTE construído por google.auth.OAuth2 (o repo carrega
// duas versões de google-auth-library via googleapis/googleapis-common; usar o
// InstanceType evita casar classes nominais distintas).
export type GoogleOAuthClient = InstanceType<typeof google.auth.OAuth2>

function oauthClient(cfg: GoogleOAuthConfig): GoogleOAuthClient {
  return new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUrl)
}

/** URL de consentimento; state carrega o CSRF (a rota valida contra o cookie). */
export function googleAuthUrl(cfg: GoogleOAuthConfig, state: string): string {
  return oauthClient(cfg).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_OAUTH_SCOPES,
    state,
  })
}

export interface GoogleTokens {
  refreshToken: string
  email: string
}

/**
 * Troca o code por tokens. O e-mail sai do id_token SEM verificação de
 * assinatura — aceitável aqui porque o JWT veio direto do endpoint de token
 * do Google via TLS (não é input de terceiro) e só serve para EXIBIÇÃO.
 */
export async function exchangeGoogleCode(
  cfg: GoogleOAuthConfig,
  code: string,
): Promise<GoogleTokens | { error: string }> {
  const { tokens } = await oauthClient(cfg).getToken(code)
  if (!tokens.refresh_token) {
    return { error: 'Google não devolveu refresh_token (repita a conexão — o consentimento é forçado).' }
  }
  let email = ''
  if (tokens.id_token) {
    try {
      const payload = JSON.parse(
        Buffer.from(tokens.id_token.split('.')[1] ?? '', 'base64url').toString('utf8'),
      ) as { email?: string }
      email = payload.email ?? ''
    } catch {
      email = ''
    }
  }
  return { refreshToken: tokens.refresh_token, email }
}

/** Cliente autorizado para as chamadas de Calendar (refresh automático). */
export function googleAuthForRefresh(cfg: GoogleOAuthConfig, refreshToken: string): GoogleOAuthClient {
  const client = oauthClient(cfg)
  client.setCredentials({ refresh_token: refreshToken })
  return client
}
