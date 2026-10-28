import { DateTime } from 'luxon'
import { BRAND_BTN_STYLE, brandEmail } from './brand'
import { escapeHtml } from './credit-expiry'
import { fmtCivilDate } from '@/lib/format'
import { friendlyTz } from './reschedule'

// Onda Agenda e Mensagens · M2 (01/09/2026) — dois avisos INTERNOS, só e-mail.
//
// 1. `class-cancelled-teacher`: a PROFESSORA fica sabendo que uma aula dela foi
//    cancelada por outra pessoa (o aluno pelo portal, a administração). Antes,
//    a primeira notícia era a aula sumindo da agenda. Quando ela mesma cancela,
//    o aviso não nasce (a RPC decide pelo `via`).
// 2. `teacher-class-changed`: a ADMINISTRAÇÃO fica sabendo que a professora
//    cancelou ou remarcou a própria aula, com o motivo que ela escreveu. Quem
//    fez a mudança não recebe.
//
// SÓ E-MAIL, como o `student-whatsapp-changed`: o despachante não tem versão
// WhatsApp destes templates — uma linha de WhatsApp com eles fica PRESA e
// visível em Avisos em vez de sair. Tom de casa: direto, sem rodapé de
// atendimento. Funções PURAS: Luxon SÓ formata, no fuso da destinatária (Lei 1).

const APP_URL_DEFAULT = 'https://app.personal-teacher.com'

/** "quinta-feira, 10/09 às 14:00" no fuso dado; instante inválido cai no cru. */
function quando(isoUtc: string, tz: string): string {
  const dt = DateTime.fromISO(isoUtc).setZone(tz).setLocale('pt-BR')
  return dt.isValid ? dt.toFormat("cccc, dd/LL 'às' HH:mm") : isoUtc
}

export interface ClassCancelledTeacherFacts {
  /** primeiro nome de quem RECEBE (a professora) — o despachante o resolve */
  firstName: string
  studentName: string
  startsAtUtc: string
  /** fuso DELA (teachers.iana_tz) — os horários saem no relógio dela */
  teacherTz: string
  /** 'student' = o aluno cancelou pelo portal; 'teacher' = a administração
   *  cancelou em nome da escola (falha da escola: o aluno ganha crédito) */
  cancelledBy: 'student' | 'teacher'
  appUrl?: string
}

export function classCancelledTeacherEmail(f: ClassCancelledTeacherFacts): {
  subject: string
  html: string
} {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  const q = quando(f.startsAtUtc, f.teacherTz)
  const quem =
    f.cancelledBy === 'student'
      ? `<strong>${escapeHtml(f.studentName)}</strong> cancelou a aula pelo portal.`
      : `A administração cancelou a aula de <strong>${escapeHtml(f.studentName)}</strong> em nome da escola — pela regra da casa, o aluno ganha um crédito de reposição.`
  return {
    subject: `Aula com ${f.studentName} cancelada: ${q}`,
    html: brandEmail(`
<p>Oi, ${escapeHtml(f.firstName)}!</p>
<p>${quem}</p>
<ul>
  <li><strong>Aula:</strong> ${escapeHtml(q)} (${escapeHtml(friendlyTz(f.teacherTz))})</li>
</ul>
<p>Nenhuma ação necessária: a aula já saiu da sua agenda e do seu Google Agenda.</p>
<p>
  <a href="${escapeHtml(appUrl)}/teacher?aba=aulas" style="${BRAND_BTN_STYLE}">Abrir o painel</a>
</p>`),
  }
}

export interface TeacherClassChangedFacts {
  /** primeiro nome de quem RECEBE (a administração) */
  firstName: string
  teacherName: string
  studentName: string
  kind: 'cancelled' | 'rescheduled'
  oldStartsAtUtc: string
  /** só na remarcação */
  newStartsAtUtc?: string | null
  /** o motivo escrito pela professora — vai para a administração, nunca ao aluno */
  reason: string
  /** fuso da PROFESSORA: a administração lê os horários no relógio dela, dito */
  teacherTz: string
  /** só no cancelamento: o desfecho MEDIDO pelo banco (false = o crédito não voltou sozinho) */
  credited?: boolean | null
  /** validade do crédito lançado (data civil `YYYY-MM-DD`), quando houve */
  expiresOn?: string | null
  appUrl?: string
}

export function teacherClassChangedEmail(f: TeacherClassChangedFacts): {
  subject: string
  html: string
} {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  const antiga = quando(f.oldStartsAtUtc, f.teacherTz)
  const nova = f.newStartsAtUtc ? quando(f.newStartsAtUtc, f.teacherTz) : null
  const fuso = escapeHtml(friendlyTz(f.teacherTz))
  const remarcou = f.kind === 'rescheduled' && nova
  const subject = remarcou
    ? `${f.teacherName} remarcou a aula de ${f.studentName}: ${nova}`
    : `${f.teacherName} cancelou a aula de ${f.studentName} (${antiga})`
  const linhas = remarcou
    ? `<li><strong>Saiu:</strong> ${escapeHtml(antiga)}</li>
  <li><strong>Entrou:</strong> <strong>${escapeHtml(nova!)}</strong> (${fuso}, horário da professora)</li>`
    : `<li><strong>Aula:</strong> ${escapeHtml(antiga)} (${fuso}, horário da professora)</li>`
  // Gate Sol (26/10): o crédito é o que o banco DEVOLVEU, nunca presumido —
  // sem desfecho no aviso, a frase manda conferir. E o aviso ao aluno é dito
  // como registrado, não como entregue: aluno sem login não recebe nada.
  const avisoAoAluno = 'O aviso ao aluno foi registrado: confira em Mensagens se ele chegou.'
  const credito =
    f.credited === true
      ? `Pela regra da casa é falta da escola: o aluno ganhou um crédito de reposição${
          f.expiresOn ? ` válido até ${escapeHtml(fmtCivilDate(f.expiresOn))}` : ''
        }.`
      : f.credited === false
        ? 'Pela regra da casa é falta da escola, mas o crédito de reposição <strong>não voltou sozinho</strong> para o aluno. Confira o saldo dele e lance o ajuste.'
        : 'Pela regra da casa é falta da escola. Confira no saldo do aluno se o crédito de reposição entrou.'
  const consequencia = remarcou
    ? `Nada foi descontado do aluno: a mudança partiu da escola. ${avisoAoAluno}`
    : `${credito} ${avisoAoAluno}`
  return {
    subject,
    html: brandEmail(`
<p>Oi, ${escapeHtml(f.firstName)}!</p>
<p><strong>${escapeHtml(f.teacherName)}</strong> ${remarcou ? 'remarcou' : 'cancelou'} a aula de
<strong>${escapeHtml(f.studentName)}</strong> pelo painel dela.</p>
<ul>
  ${linhas}
  <li><strong>Motivo dela:</strong> ${escapeHtml(f.reason)}</li>
</ul>
<p>${consequencia}</p>
<p>
  <a href="${escapeHtml(appUrl)}/admin/agenda" style="${BRAND_BTN_STYLE}">Abrir a agenda</a>
</p>`),
  }
}
