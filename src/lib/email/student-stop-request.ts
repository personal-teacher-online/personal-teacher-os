import { BRAND_BTN_STYLE, brandEmail } from './brand'
import { escapeHtml } from './credit-expiry'

// Issue #44 (ADR-038, item 4, ajuste de 31/10/2026) — aviso INTERNO para a
// admin: um aluno mandou uma palavra de parada ("PARAR", "SAIR", "STOP", "não
// quero mais") ao número de envio da escola. O webhook da Meta enfileira este
// e-mail; nada mais acontece sozinho: o aviso pelo WhatsApp é canal de
// contrato (M4-3) e quem decide é a admin, pela ficha do aluno.
//
// SÓ E-MAIL: os avisos internos saem por e-mail desde 27/10/2026 (ADR-038), e
// não há template na Meta para isto. O registro do despachante não tem `text`.
// TOM: destinatária é da casa (régua do `content-review`), direto, sem rodapé.

const APP_URL_DEFAULT = 'https://app.personal-teacher.com'

export interface StudentStopRequestFacts {
  /** primeiro nome de quem RECEBE (a admin) — o despachante o resolve */
  firstName: string
  /** o aluno cujo número mandou a mensagem; null quando o número não está em
   *  nenhuma ficha (ou está em mais de uma) */
  studentId: string | null
  studentName: string | null
  /** o número que mandou, em E.164 */
  whatsappE164: string
  /** o texto da mensagem, como chegou */
  texto: string
  appUrl?: string
}

export function studentStopRequestEmail(f: StudentStopRequestFacts): { subject: string; html: string } {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  const quem = f.studentName ?? 'Um aluno'
  const destino = f.studentId ? `${appUrl}/admin/alunos/${f.studentId}` : `${appUrl}/admin/alunos`
  const rotulo = f.studentId ? 'Abrir a ficha' : 'Abrir a lista de alunos'
  const deQuem = f.studentId
    ? `<strong>${escapeHtml(quem)}</strong> (${escapeHtml(f.whatsappE164)})`
    : `O número <strong>${escapeHtml(f.whatsappE164)}</strong>, que não está na ficha de um aluno só,`
  return {
    subject: `${quem} pediu para parar de receber mensagens`,
    html: brandEmail(`
<p>Oi, ${escapeHtml(f.firstName)}!</p>
<p>${deQuem} respondeu ao WhatsApp da escola:</p>
<p><strong>“${escapeHtml(f.texto)}”</strong></p>
<p>Nada foi desligado: os avisos da escola continuam saindo para este número. O que fazer é decisão sua.</p>
<p>
  <a href="${escapeHtml(destino)}" style="${BRAND_BTN_STYLE}">${rotulo}</a>
</p>`),
  }
}
