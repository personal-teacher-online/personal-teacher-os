import { BRAND_BTN_STYLE, brandEmail } from './brand'
import { escapeHtml } from './credit-expiry'

// Onda da Agenda · LOTE FINAL — aviso INTERNO para a professora: o aluno trocou
// o WhatsApp dele no portal.
//
// POR QUE ELE EXISTE: desde 28/07 o WhatsApp é canal de CONTRATO — é por ele
// que a escola avisa das aulas. O aluno troca o número sozinho, e sem este
// e-mail a professora seguia com o número antigo no celular dela; a primeira
// notícia da troca seria um recado que não chegou.
//
// SÓ E-MAIL, e é decisão: mandar isto por WhatsApp seria usar justamente o
// canal que acabou de mudar para avisar que ele mudou. Por isso o registro do
// despachante não tem `text` para este template — quem enfileirar uma linha de
// WhatsApp com ele leva "template … sem versão WhatsApp" e a linha fica presa,
// visível em Mensagens, em vez de sair pelo canal errado.
//
// TOM: destinatária é da casa (a mesma régua do `content-review`) — direto, sem
// rodapé de atendimento. E sem cobrança: trocar de número é coisa normal, o
// e-mail existe para ela não ficar por fora.

const APP_URL_DEFAULT = 'https://app.personal-teacher.com'

export interface StudentWhatsappChangedFacts {
  /** primeiro nome de quem RECEBE (a professora) — o despachante o resolve */
  firstName: string
  /** o aluno que trocou */
  studentName: string
  /** o número NOVO, em E.164 (o antigo não viaja: ver a migration) */
  whatsappE164: string
  appUrl?: string
}

export function studentWhatsappChangedEmail(f: StudentWhatsappChangedFacts): {
  subject: string
  html: string
} {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  return {
    subject: `${f.studentName} trocou o WhatsApp de contato`,
    html: brandEmail(`
<p>Oi, ${escapeHtml(f.firstName)}!</p>
<p><strong>${escapeHtml(f.studentName)}</strong> atualizou o WhatsApp no portal. O número novo é
<strong>${escapeHtml(f.whatsappE164)}</strong> — é para ele que os avisos da escola passam a ir.</p>
<p>Se você tem o contato antigo salvo no celular, vale corrigir por aí também.</p>
<p>
  <a href="${escapeHtml(appUrl)}/teacher" style="${BRAND_BTN_STYLE}">Abrir o painel</a>
</p>`),
  }
}
