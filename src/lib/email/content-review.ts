import { BRAND_BTN_STYLE, brandEmail } from './brand'
import { escapeHtml } from './credit-expiry'

// ADR-021 — aviso INTERNO (para a própria admin) da fábrica de conteúdo:
// digest de 1 toque por etapa por dia (dedupe no trigger notify_content_review).
// Tom direto, sem rodapé de atendimento (a destinatária é da casa).

const APP_URL_DEFAULT = 'https://app.personal-teacher.com'

export interface ContentReviewFacts {
  stage: 'ideias' | 'rascunhos'
  firstName: string
  appUrl?: string
}

const COPY: Record<ContentReviewFacts['stage'], { subject: string; lead: string; cta: string }> = {
  ideias: {
    subject: 'Ideias novas de post esperando o seu OK 💡',
    lead: 'Os agentes trouxeram ideias novas de conteúdo — escolha as que valem virar post.',
    cta: 'Revisar as ideias',
  },
  rascunhos: {
    subject: 'Rascunho de post pronto para a sua revisão ✍️',
    lead: 'Tem rascunho novo com legenda e imagens montadas — revise, ajuste e aprove.',
    cta: 'Revisar os rascunhos',
  },
}

export function contentReviewEmail(f: ContentReviewFacts): { subject: string; html: string } {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  const c = COPY[f.stage]
  return {
    subject: c.subject,
    html: brandEmail(`
<p>Oi, ${escapeHtml(f.firstName)}!</p>
<p>${escapeHtml(c.lead)} Nada sai sem a sua aprovação.</p>
<p>
  <a href="${escapeHtml(appUrl)}/admin/conteudo/posts?st=pendentes" style="${BRAND_BTN_STYLE}">${escapeHtml(c.cta)}</a>
</p>`),
  }
}

export function contentReviewText(f: ContentReviewFacts): string {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  const c = COPY[f.stage]
  return `Oi, ${f.firstName}! ${c.lead}\n\n${c.cta}:\n${appUrl}/admin/conteudo/posts?st=pendentes`
}
