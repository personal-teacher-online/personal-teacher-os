import { DateTime } from 'luxon'
import { BRAND_BTN_STYLE, brandEmail } from './brand'

// E-mail 5 — crédito de reposição perto de vencer (texto APROVADO pela dona,
// fase2-emails-rascunho.md §5; entra na Fase 3 junto com o outbox — F3-D4/M3).
// Função PURA: o despachante injeta os fatos; Luxon só FORMATA (Lei 1).

const SIGNATURE = `<p>Um abraço,<br />Equipe Personal Teacher</p>`

/**
 * Escape de HTML (painel final F3): `firstName` vem de `user_metadata.first_name`,
 * que o PRÓPRIO usuário pode editar (auth.updateUser) — valor UNTRUSTED na
 * renderização, mesmo quando o destinatário é o autor (o e-mail sai autenticado
 * SPF/DKIM do domínio da escola). REGRA: todo template HTML futuro que interpole
 * string externa (user_metadata, payload de webhook etc.) usa ESTE helper no sink.
 * Texto puro (WhatsApp) não precisa — sem semântica HTML.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export interface CreditExpiryFacts {
  firstName: string
  nCredits: number
  expiresOn: string // YYYY-MM-DD (data civil — F3-D4: o texto carrega a data REAL)
  appUrl?: string
}

export function creditExpiryEmail(f: CreditExpiryFacts): { subject: string; html: string } {
  const appUrl = f.appUrl ?? 'https://app.personal-teacher.com'
  const data = DateTime.fromISO(f.expiresOn).setLocale('pt-BR').toFormat('dd/LL/yyyy')
  const plural = f.nCredits > 1
  return {
    subject: `Você tem ${f.nCredits} aula${plural ? 's' : ''} de reposição vencendo em ${data}`,
    html: brandEmail(`
<p>Oi, ${escapeHtml(f.firstName)}!</p>
<p>Passando para lembrar: você tem <strong>${f.nCredits} crédito${plural ? 's' : ''} de
reposição</strong> que vence${plural ? 'm' : ''} em <strong>${data}</strong>.</p>
<p>Para usar, é só entrar no portal e escolher um dos horários disponíveis:</p>
<p>
  <a
    href="${escapeHtml(appUrl)}/portal"
    style="${BRAND_BTN_STYLE}"
    >Agendar minha reposição</a
  >
</p>
<p>Depois dessa data o crédito expira, e a gente não quer que você perca nenhuma aula. 😉</p>
${SIGNATURE}`),
  }
}


/** Versão TEXTO (WhatsApp — ADR-016). Mesmo conteúdo aprovado, sem HTML. */
export function creditExpiryText(f: CreditExpiryFacts): string {
  const appUrl = f.appUrl ?? 'https://app.personal-teacher.com'
  const data = DateTime.fromISO(f.expiresOn).setLocale('pt-BR').toFormat('dd/LL/yyyy')
  const plural = f.nCredits > 1
  return (
    `Oi, ${f.firstName}! Passando para lembrar: você tem *${f.nCredits} crédito${plural ? 's' : ''} ` +
    `de reposição* que vence${plural ? 'm' : ''} em *${data}*.\n\n` +
    `Para usar, é só entrar no portal e escolher um dos horários disponíveis:\n${appUrl}/portal\n\n` +
    `Depois dessa data o crédito expira, e a gente não quer que você perca nenhuma aula. 😉\n\n` +
    `Equipe Personal Teacher`
  )
}
