import { LINHA_DE_ATENDIMENTO } from '@/lib/contact'
import { BRAND_BTN_STYLE, brandEmail } from './brand'
import { escapeHtml } from './credit-expiry'

// M0c do cronograma (20/07/2026) — lembrete de BRIEFING (template
// 'briefing-reminder', disparado pela dona na ficha do aluno). Régua de tom:
// transacional positiva, se apresenta, 1 emoji no máximo, zero jargão.

const APP_URL_DEFAULT = 'https://app.pteacheracademy.com'

export interface BriefingReminderFacts {
  firstName: string
  appUrl?: string
}

export function briefingReminderEmail(f: BriefingReminderFacts): { subject: string; html: string } {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  return {
    subject: 'Antes da sua primeira aula: nos conte sobre você 📝',
    html: brandEmail(`
<p>Olá, ${escapeHtml(f.firstName)}!</p>
<p>Falta um passo para as suas aulas começarem do seu jeito: o seu
<strong>briefing</strong> — cerca de 10 minutos sobre seus interesses, seus
objetivos com o inglês e como você aprende melhor. É com ele que a sua
professora monta um plano só seu.</p>
<p>
  <a href="${escapeHtml(appUrl)}/portal/briefing" style="${BRAND_BTN_STYLE}">Responder meu briefing</a>
</p>
<p>Um abraço,<br />Equipe Personal Teacher Academy</p>`),
  }
}

/** O corpo do template (#115: o briefing virou botão; #119: o atendimento é a linha com o número). */
export function briefingReminderText(f: BriefingReminderFacts): string {
  return (
    `Olá, ${f.firstName}! Falta um passo para as suas aulas começarem do seu jeito: o seu briefing (~10 min) — seus interesses, seus objetivos e como você aprende melhor. 📝\n\n` +
    LINHA_DE_ATENDIMENTO +
    `Equipe Personal Teacher Academy`
  )
}
