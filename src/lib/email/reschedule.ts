import { DateTime } from 'luxon'
import { brandEmail } from './brand'

// Templates 3/3b/4 APROVADOS pela dona (docs/goals/fase2-emails-rascunho.md,
// 11/07/2026 — assinatura unificada "Equipe Personal Teacher"). Funções PURAS
// (unit-testadas); Luxon SÓ formata (Lei 1).

export interface RescheduleFacts {
  firstName: string
  studentTz: string
  oldStartsUtc: string
  newStartsUtc: string
  teacherName: string
  /** 'da sua franquia mensal (restam N)' ou 'de 1 crédito de reposição (saldo: N)' */
  howCharged: string
}

/** "horário de Cuiabá" a partir da zona IANA. */
export function friendlyTz(ianaTz: string): string {
  const city = (ianaTz.split('/').pop() ?? ianaTz).replace(/_/g, ' ')
  return `horário de ${city}`
}

function d(isoUtc: string, zone: string): string {
  return DateTime.fromISO(isoUtc).setZone(zone).setLocale('pt-BR').toFormat('dd/LL')
}
function h(isoUtc: string, zone: string): string {
  return DateTime.fromISO(isoUtc).setZone(zone).toFormat('HH:mm')
}

const SIGNATURE = '<p>Equipe Personal Teacher</p>'

/** E-mail 3 — para o aluno que remarcou. */
export function studentEmail(f: RescheduleFacts): { subject: string; html: string } {
  const nd = d(f.newStartsUtc, f.studentTz)
  const nh = h(f.newStartsUtc, f.studentTz)
  return {
    subject: `Aula remarcada ✅ ${nd} às ${nh}`,
    html: brandEmail(`
<p>Oi, ${f.firstName}!</p>
<p>Prontinho, sua remarcação foi confirmada:</p>
<ul>
  <li><strong>Aula original:</strong> ${d(f.oldStartsUtc, f.studentTz)} às ${h(f.oldStartsUtc, f.studentTz)}</li>
  <li><strong>Nova aula:</strong> <strong>${nd} às ${nh}</strong> (${friendlyTz(f.studentTz)})</li>
  <li><strong>Professora:</strong> ${f.teacherName}</li>
  <li><strong>Como foi descontado:</strong> ${f.howCharged}</li>
</ul>
<p>Se algo não estiver certo, fale com a gente antes do horário da aula.</p>
<p>Até lá! 👋</p>
${SIGNATURE}`),
  }
}

/** E-mail 3t (M2, 01/09/2026) — para o aluno, quando a PROFESSORA remarcou.
 *  A mudança partiu da escola: nada é descontado, e o motivo dela NÃO viaja
 *  (é para a administração). Um por membro do casal, no fuso de cada um. */
export function teacherMovedEmail(f: Omit<RescheduleFacts, 'howCharged'>): { subject: string; html: string } {
  const nd = d(f.newStartsUtc, f.studentTz)
  const nh = h(f.newStartsUtc, f.studentTz)
  return {
    subject: `Sua aula mudou de horário: ${nd} às ${nh}`,
    html: brandEmail(`
<p>Oi, ${f.firstName}!</p>
<p>A ${f.teacherName} precisou remarcar a sua aula:</p>
<ul>
  <li><strong>Aula original:</strong> ${d(f.oldStartsUtc, f.studentTz)} às ${h(f.oldStartsUtc, f.studentTz)}</li>
  <li><strong>Nova aula:</strong> <strong>${nd} às ${nh}</strong> (${friendlyTz(f.studentTz)})</li>
  <li><strong>Como foi descontado:</strong> nada — a mudança partiu da escola e não usa suas remarcações do mês nem crédito.</li>
</ul>
<p>Se o novo horário não funcionar para você, fale com a gente antes da aula e a gente encontra outro.</p>
<p>Até lá! 👋</p>
${SIGNATURE}`),
  }
}

/** E-mail 3b — para o OUTRO membro do casal (D3). */
export function partnerEmail(
  f: RescheduleFacts & { partnerFirstName: string; whoRescheduled: string },
): { subject: string; html: string } {
  const nd = d(f.newStartsUtc, f.studentTz)
  const nh = h(f.newStartsUtc, f.studentTz)
  return {
    subject: `${f.whoRescheduled} remarcou a aula de vocês ✅ ${nd} às ${nh}`,
    html: brandEmail(`
<p>Oi, ${f.partnerFirstName}!</p>
<p>${f.whoRescheduled} remarcou a aula de vocês pelo portal:</p>
<ul>
  <li><strong>Saiu:</strong> ${d(f.oldStartsUtc, f.studentTz)} às ${h(f.oldStartsUtc, f.studentTz)}</li>
  <li><strong>Entrou:</strong> <strong>${nd} às ${nh}</strong> (${friendlyTz(f.studentTz)})</li>
  <li><strong>Professora:</strong> ${f.teacherName}</li>
  <li><strong>Como foi descontado:</strong> ${f.howCharged}</li>
</ul>
<p>Se esse horário não funcionar para você, fale com a gente antes da aula.</p>
${SIGNATURE}`),
  }
}

/** E-mail 4 — para a professora, na zona DELA (teachers.iana_tz — F3-D2/F3-D5).
 *  Link para /teacher (nota 3b do rascunho aprovado); appUrl injetável p/ teste. */
export function teacherEmail(
  f: Omit<RescheduleFacts, 'howCharged' | 'firstName'> & {
    studentName: string
    teacherTz: string
    appUrl?: string
  },
): { subject: string; html: string } {
  const appUrl = f.appUrl ?? 'https://app.personal-teacher.com'
  const nd = d(f.newStartsUtc, f.teacherTz)
  const nh = h(f.newStartsUtc, f.teacherTz)
  return {
    subject: `${f.studentName} remarcou: ${nd} às ${nh}`,
    html: brandEmail(`
<p>Oi, ${f.teacherName}!</p>
<p>O(a) aluno(a) <strong>${f.studentName}</strong> remarcou uma aula pelo portal:</p>
<ul>
  <li><strong>Saiu:</strong> ${d(f.oldStartsUtc, f.teacherTz)} às ${h(f.oldStartsUtc, f.teacherTz)}</li>
  <li><strong>Entrou:</strong> <strong>${nd} às ${nh}</strong> (${friendlyTz(f.teacherTz)})</li>
</ul>
<p>Nenhuma ação necessária — este e-mail já é o seu registro da mudança. Se quiser,
veja sua agenda no <a href="${appUrl}/teacher">seu painel</a>.</p>
${SIGNATURE}`),
  }
}
