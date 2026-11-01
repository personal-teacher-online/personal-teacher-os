import { BRAND_BTN_STYLE, brandEmail } from './brand'
import { escapeHtml } from './credit-expiry'

// Issue #127 (ADR-038, item 4, decisão do dono de 31/10/2026) — aviso INTERNO
// para a admin: alguém respondeu ao número de envio da escola com uma palavra
// de parada ("PARAR", "SAIR", "STOP", "não quero mais"). Quem enfileira é a
// função SQL `enqueue_student_stop_request`, chamada pelo webhook da Meta;
// nada mais acontece sozinho: o aviso pelo WhatsApp é canal de contrato (M4-3)
// e quem decide é a admin, pela ficha do aluno.
//
// SÓ E-MAIL: os avisos internos saem por e-mail desde 27/10/2026 (ADR-038), e
// não há template na Meta para isto. O registro do despachante não tem `text`.
// TOM: destinatária é da casa (régua do `content-review`), direto, sem rodapé.

const APP_URL_DEFAULT = 'https://app.pteacheracademy.com'

export interface StudentStopRequestFacts {
  /** primeiro nome de quem RECEBE (a admin) — o despachante o resolve */
  firstName: string
  /** o aluno cujo número mandou a mensagem; null quando o número não está em
   *  nenhuma ficha ou está em mais de uma */
  studentId: string | null
  studentName: string | null
  /** em quantas fichas de aluno o número está (0, 1 ou mais) */
  alunosComONumero: number
  /** os nomes das fichas, quando o número está em mais de uma */
  alunosNomes: readonly string[]
  /** de nenhum aluno, mas de alguém da casa: professora (com o nome) ou equipe */
  equipe: 'professora' | 'equipe' | null
  equipeNome: string | null
  /** o número que mandou, em E.164; vazio depois do expurgo */
  whatsappE164: string
  /** o texto da mensagem, como chegou; vazio depois do expurgo */
  texto: string
  appUrl?: string
}

export function studentStopRequestEmail(f: StudentStopRequestFacts): { subject: string; html: string } {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  const numero = f.whatsappE164 ? escapeHtml(f.whatsappE164) : '(número apagado)'
  if (f.studentId && f.studentName) {
    return {
      subject: `${f.studentName} pediu para parar de receber mensagens`,
      html: corpo(
        f,
        `<strong>${escapeHtml(f.studentName)}</strong> (${numero}) respondeu ao WhatsApp da escola:`,
        `${appUrl}/admin/alunos/${f.studentId}`,
        'Abrir a ficha',
      ),
    }
  }
  const subject = `Pedido para parar de receber mensagens (${f.whatsappE164 || 'número apagado'})`
  if (f.alunosComONumero > 1) {
    const nomes = f.alunosNomes.map((n) => `<strong>${escapeHtml(n)}</strong>`).join(', ')
    return {
      subject,
      html: corpo(
        f,
        `O número <strong>${numero}</strong> está em mais de uma ficha${nomes ? ` (${nomes})` : ''}. Ele respondeu ao WhatsApp da escola:`,
        `${appUrl}/admin/alunos`,
        'Abrir a lista de alunos',
      ),
    }
  }
  if (f.equipe === 'professora') {
    const nome = f.equipeNome ? `<strong>${escapeHtml(f.equipeNome)}</strong> ` : ''
    return {
      subject,
      html: corpo(
        f,
        `Número de professora: ${nome}(${numero}). Ele respondeu ao WhatsApp da escola:`,
        `${appUrl}/admin/professoras`,
        'Abrir as professoras',
      ),
    }
  }
  const quem =
    f.equipe === 'equipe'
      ? `Número da equipe: <strong>${numero}</strong>. Ele respondeu ao WhatsApp da escola:`
      : `Número não cadastrado: <strong>${numero}</strong>. Ele respondeu ao WhatsApp da escola:`
  return { subject, html: corpo(f, quem, `${appUrl}/admin/alunos`, 'Abrir a lista de alunos') }
}

// ADR-038, item 4(c): a admin age NO MESMO DIA ÚTIL, esclarecendo pelo
// atendimento ou apagando o número; manter o número depois de um pedido claro
// não é opção (a Política de Mensagens da Meta exige respeitar o pedido).
function corpo(f: StudentStopRequestFacts, quem: string, destino: string, rotulo: string): string {
  const texto = f.texto ? `“${escapeHtml(f.texto)}”` : '(mensagem apagada)'
  return brandEmail(`
<p>Oi, ${escapeHtml(f.firstName)}!</p>
<p>${quem}</p>
<p><strong>${texto}</strong></p>
<p>Os avisos da escola continuam saindo para este número até você agir. Ainda hoje, fale com a pessoa pelo atendimento para entender o pedido, ou apague o número na ficha. Continuar mandando mensagens depois de um pedido claro para parar não é permitido pelo WhatsApp.</p>
<p>
  <a href="${escapeHtml(destino)}" style="${BRAND_BTN_STYLE}">${rotulo}</a>
</p>`)
}
