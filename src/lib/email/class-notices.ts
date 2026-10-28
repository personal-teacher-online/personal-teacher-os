import { DateTime } from 'luxon'
import { BRAND_BTN_STYLE, brandEmail } from './brand'
import { escapeHtml } from './credit-expiry'
import { WHATSAPP_ATENDIMENTO_URL } from '@/lib/contact'

// e2e 19/07 (fato apurado com o mantenedor): NINGUÉM monitora o número da
// AGENDA que dispara estas mensagens — "é só responder" convidava o aluno a
// falar com o vazio. Até o WhatsApp bidirecional (item 30), o rodapé aponta
// o número de ATENDIMENTO, que é humano e monitorado. Sem o número na config
// (WHATSAPP_ATENDIMENTO_E164) o rodapé some inteiro: inclui o parágrafo em
// branco que o separa da assinatura, por isso os textos o concatenam direto.
export const WA_FOOTER = WHATSAPP_ATENDIMENTO_URL
  ? `Dúvidas? Fale com a gente: ${WHATSAPP_ATENDIMENTO_URL}\n\n`
  : ''

// Construção total (14/07/2026) — textos dos avisos novos do outbox:
// lembrete de aula do dia, confirmação de remarcação (WhatsApp) e elegibilidade
// de mentoria. ⚠️ TEXTOS EM RASCUNHO: seguem o tom aprovado da Fase 2
// (fase2-emails-rascunho.md — caloroso, frases curtas, assinatura "Equipe
// Personal Teacher", emojis moderados) e aguardam aprovação em LOTE da dona
// (docs/goals/textos-novos-para-aprovacao.md). Funções PURAS: o despachante
// injeta os fatos; Luxon SÓ formata (Lei 1).

const SIGNATURE = `<p>Um abraço,<br />Equipe Personal Teacher</p>`
const APP_URL_DEFAULT = 'https://app.personal-teacher.com'

/** Tom do mantenedor (14/07): "com a Teacher {{professora}}" — sem duplicar
 *  quando o display_name já vem como 'Teacher Vicky'. */
function teacherLabel(name: string): string {
  const n = name.trim()
  return /^teacher\s/i.test(n) ? n : `Teacher ${n}`
}

/** Hora/dia LOCAIS do destinatário (painel 14/07: grupo com fusos distintos —
 *  cada um vê a própria hora): instante UTC + iana_tz do payload; Luxon SÓ
 *  formata (Lei 1). Zona inválida/instante ruim → cai no snapshot cru
 *  (nunca derruba o despachante). */
function localParts(startsAtUtc: string, ianaTz: string, snapshotFallback: string): { time: string; longDate: string } {
  const dt = DateTime.fromISO(startsAtUtc).setZone(ianaTz).setLocale('pt-BR')
  if (!dt.isValid) return { time: snapshotFallback, longDate: snapshotFallback }
  return {
    time: dt.toFormat('HH:mm'),
    longDate: dt.toFormat("cccc, dd/LL 'às' HH:mm"),
  }
}

/** Item 21 (veredito): o lembrete se apresenta e diz "HOJE"/"AMANHÃ" quando é
 *  o caso — comparação de DATAS CIVIS no fuso do destinatário; Luxon só
 *  formata/compara, nada é armazenado (Lei 1). Fora disso, null → data longa. */
function dayLabel(startsAtUtc: string, ianaTz: string): 'HOJE' | 'AMANHÃ' | null {
  const dt = DateTime.fromISO(startsAtUtc).setZone(ianaTz)
  if (!dt.isValid) return null
  const days = dt.startOf('day').diff(DateTime.now().setZone(ianaTz).startOf('day'), 'days').days
  return days === 0 ? 'HOJE' : days === 1 ? 'AMANHÃ' : null
}

// ---------------------------------------------------------------------------
// Lembrete de aula (template 'class-reminder' — janela rolante de 24h)
// ---------------------------------------------------------------------------
export interface ClassReminderFacts {
  firstName: string
  startsAtUtc: string
  ianaTz: string
  localTimeSnapshot: string
  teacherName: string
  /** F6/M8-2: '48h' = toque ACIONÁVEL (página da aula); '2h' = memória (+Meet).
   *  Ausente = lembrete legado (linhas enfileiradas antes da F6). */
  marco?: '48h' | '2h' | null
  instanceId?: string | null
  meetUrl?: string | null
  /** ADR-019: link que já ENTRA LOGADO (magic link do WhatsApp) — quando
   *  presente, substitui o link normal da página da aula no texto WA. */
  magicUrl?: string | null
  appUrl?: string
}

export function classReminderEmail(f: ClassReminderFacts): { subject: string; html: string } {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  const { time, longDate } = localParts(f.startsAtUtc, f.ianaTz, f.localTimeSnapshot)
  if (f.marco === '48h' && f.instanceId) {
    // e2e 19/07: aula nascida em cima da hora sai por este marco — "domingo,
    // 19/07" no próprio domingo lê frio; HOJE/AMANHÃ quando for o caso.
    const lbl = dayLabel(f.startsAtUtc, f.ianaTz)
    const quando = lbl ? `${lbl} às ${time}` : longDate
    const aula = `${appUrl}/portal/aula/${f.instanceId}`
    return {
      subject: `Sua aula está chegando — ${time} 📚`,
      html: brandEmail(`
<p>Olá, ${escapeHtml(f.firstName)}!</p>
<p>Lembrete: sua aula com a ${escapeHtml(teacherLabel(f.teacherName))} é
<strong>${escapeHtml(quando)}</strong>.</p>
<p>
  <a href="${escapeHtml(aula)}" style="${BRAND_BTN_STYLE}">Confirmar presença</a>
</p>
<p style="font-size:13px">
  Precisa mudar? <a href="${escapeHtml(aula)}">Remarcar ou cancelar</a> — quanto antes, melhor.
</p>
${SIGNATURE}`),
    }
  }
  if (f.marco === '2h') {
    const lbl = dayLabel(f.startsAtUtc, f.ianaTz)
    const quando = lbl ? `${lbl} às ${time}` : longDate
    const aula = f.instanceId ? `${appUrl}/portal/aula/${f.instanceId}` : `${appUrl}/portal`
    return {
      subject: `É daqui a pouco: aula às ${time} ⏰`,
      html: brandEmail(`
<p>Olá, ${escapeHtml(f.firstName)}!</p>
<p>Lembrete: sua aula com a ${escapeHtml(teacherLabel(f.teacherName))} é
<strong>${escapeHtml(quando)}</strong>.</p>
${f.meetUrl ? `<p><a href="${escapeHtml(f.meetUrl)}" style="${BRAND_BTN_STYLE}">Entrar na aula</a></p>` : ''}
<p style="font-size:13px">
  <a href="${escapeHtml(aula)}">Confirmar presença, remarcar ou cancelar</a>
</p>
<p>Até já!</p>
${SIGNATURE}`),
    }
  }
  return {
    subject: `Lembrete: sua aula às ${time} 📚`,
    html: brandEmail(`
<p>Olá, ${escapeHtml(f.firstName)}!</p>
<p>Lembrete: você tem aula <strong>${escapeHtml(longDate)}</strong>
com a ${escapeHtml(teacherLabel(f.teacherName))}.</p>
<p>
  <a href="${escapeHtml(appUrl)}/portal" style="${BRAND_BTN_STYLE}">Ver minhas aulas</a>
</p>
<p>Até já!</p>
${SIGNATURE}`),
  }
}

/** Versão TEXTO (WhatsApp — ADR-016). */
export function classReminderText(f: ClassReminderFacts): string {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  const { longDate } = localParts(f.startsAtUtc, f.ianaTz, f.localTimeSnapshot)
  if (f.marco === '48h' && f.instanceId) {
    const lbl = dayLabel(f.startsAtUtc, f.ianaTz)
    const { time } = localParts(f.startsAtUtc, f.ianaTz, f.localTimeSnapshot)
    const quando = lbl ? `${lbl} às ${time}` : longDate
    return (
      `Olá, ${f.firstName}! Lembrete: sua aula com a ${teacherLabel(f.teacherName)} é *${quando}*.\n\n` +
      `Confirmar presença, remarcar ou cancelar:\n${f.magicUrl ?? `${appUrl}/portal/aula/${f.instanceId}`}\n\n` +
      WA_FOOTER +
      `Equipe Personal Teacher`
    )
  }
  if (f.marco === '2h') {
    const lbl = dayLabel(f.startsAtUtc, f.ianaTz)
    const { time } = localParts(f.startsAtUtc, f.ianaTz, f.localTimeSnapshot)
    const quando = lbl ? `${lbl} às ${time}` : `*${longDate}*`
    const aula = f.magicUrl ?? (f.instanceId ? `${appUrl}/portal/aula/${f.instanceId}` : `${appUrl}/portal`)
    return (
      `Olá, ${f.firstName}! Lembrete: sua aula com a ${teacherLabel(f.teacherName)} é ${quando}. ⏰\n` +
      (f.meetUrl ? `\nEntrar na aula: ${f.meetUrl}\n` : '') +
      `\nConfirmar presença, remarcar ou cancelar:\n${aula}\n\n` +
      `Equipe Personal Teacher`
    )
  }
  return (
    `Olá, ${f.firstName}! Lembrete: você tem aula *${longDate}* com a ${teacherLabel(f.teacherName)}. Até já!\n\n` +
    WA_FOOTER +
    `Equipe Personal Teacher`
  )
}

// ---------------------------------------------------------------------------
// Confirmação de remarcação (template 'reschedule-confirm' — só WhatsApp; o
// e-mail 3 aprovado já sai direto pela action do portal)
// ---------------------------------------------------------------------------
export interface RescheduleConfirmFacts {
  firstName: string
  startsAtUtc: string
  ianaTz: string
  localTimeSnapshot: string
  teacherName: string
  /** Item 26: 'redeem' = aula NASCIDA de crédito (resgate) — texto próprio.
   *  O despachante decide olhando class_instances.reschedule_of (sem SQL novo). */
  kind?: 'reschedule' | 'redeem'
}

export function rescheduleConfirmText(f: RescheduleConfirmFacts): string {
  const { longDate } = localParts(f.startsAtUtc, f.ianaTz, f.localTimeSnapshot)
  const corpo =
    f.kind === 'redeem'
      ? `Sua aula de reposição está agendada: *${longDate}* com a ${teacherLabel(f.teacherName)}. ✅`
      : `Sua remarcação está confirmada: *${longDate}* com a ${teacherLabel(f.teacherName)}. ✅`
  return (
    `Olá, ${f.firstName}! ${corpo}\n\n` +
    WA_FOOTER +
    `Equipe Personal Teacher`
  )
}

// ---------------------------------------------------------------------------
// Cancelamento de aula (template 'class-cancelled' — F2/M2-3/P4). Vale para o
// autocancelamento do aluno E o cancelamento unitário da admin; o payload diz
// se nasceu crédito (e a validade) para o texto não prometer errado.
// ---------------------------------------------------------------------------
export interface ClassCancelledFacts {
  firstName: string
  startsAtUtc: string
  ianaTz: string
  localTimeSnapshot: string
  teacherName: string
  credited: boolean
  expiresOn?: string | null
  appUrl?: string
}

function creditLine(f: ClassCancelledFacts): string {
  // ADR-018: aula cancelada pelo aluno não gera crédito em NENHUMA antecedência
  // — o texto não pode atribuir a ausência de crédito ao "aviso em cima da hora".
  if (!f.credited) return 'Essa aula não gera crédito de reposição.'
  const ate = f.expiresOn ? ` — vale até ${DateTime.fromISO(f.expiresOn).setLocale('pt-BR').toFormat('dd/LL/yyyy')}` : ''
  return `Você ganhou 1 crédito de reposição por ela${ate}. É só agendar pelo portal quando quiser.`
}

export function classCancelledEmail(f: ClassCancelledFacts): { subject: string; html: string } {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  const { longDate } = localParts(f.startsAtUtc, f.ianaTz, f.localTimeSnapshot)
  return {
    subject: 'Sua aula foi cancelada',
    html: brandEmail(`
<p>Olá, ${escapeHtml(f.firstName)}!</p>
<p>Confirmando: a sua aula de <strong>${escapeHtml(longDate)}</strong> com a
${escapeHtml(teacherLabel(f.teacherName))} foi <strong>cancelada</strong>.</p>
<p>${escapeHtml(creditLine(f))}</p>
<p>
  <a href="${escapeHtml(appUrl)}/portal" style="${BRAND_BTN_STYLE}">Ver minhas aulas</a>
</p>
${SIGNATURE}`),
  }
}

/** Versão TEXTO (WhatsApp — ADR-016). */
export function classCancelledText(f: ClassCancelledFacts): string {
  const { longDate } = localParts(f.startsAtUtc, f.ianaTz, f.localTimeSnapshot)
  return (
    `Olá, ${f.firstName}! Confirmando: a sua aula de *${longDate}* ` +
    `com a ${teacherLabel(f.teacherName)} foi *cancelada*.\n\n` +
    `${creditLine(f)}\n\n` +
    WA_FOOTER +
    `Equipe Personal Teacher`
  )
}

// ---------------------------------------------------------------------------
// Convite de remarcação por período (template 'period-reschedule-invite' —
// F5/P5): a professora ficará indisponível; a aula PERMANECE agendada e o
// aluno é convidado a remarcar pelo fluxo normal (nada de franquia tocada).
// ---------------------------------------------------------------------------
export interface PeriodInviteFacts {
  firstName: string
  instanceId: string
  startsAtUtc: string
  ianaTz: string
  localTimeSnapshot: string
  teacherName: string
  note?: string | null
  appUrl?: string
}

export function periodInviteEmail(f: PeriodInviteFacts): { subject: string; html: string } {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  const { longDate } = localParts(f.startsAtUtc, f.ianaTz, f.localTimeSnapshot)
  return {
    subject: 'Que tal remarcar sua aula? 📅',
    html: brandEmail(`
<p>Olá, ${escapeHtml(f.firstName)}!</p>
<p>A ${escapeHtml(teacherLabel(f.teacherName))} estará indisponível no período da sua aula de
<strong>${escapeHtml(longDate)}</strong>${f.note ? ` — ${escapeHtml(f.note)}` : ''}.</p>
<p>Se puder, escolha um novo horário pelo portal (sua aula continua marcada até você decidir):</p>
<p>
  <a href="${escapeHtml(appUrl)}/portal/remarcar/${escapeHtml(f.instanceId)}" style="${BRAND_BTN_STYLE}">Remarcar minha aula</a>
</p>
${SIGNATURE}`),
  }
}

/** Versão TEXTO (WhatsApp — ADR-016). */
export function periodInviteText(f: PeriodInviteFacts): string {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  const { longDate } = localParts(f.startsAtUtc, f.ianaTz, f.localTimeSnapshot)
  return (
    `Olá, ${f.firstName}! A ${teacherLabel(f.teacherName)} estará indisponível no período da sua ` +
    `aula de *${longDate}*${f.note ? ` — ${f.note}` : ''}.\n\n` +
    `Se puder, escolha um novo horário pelo portal (sua aula continua marcada até você decidir):\n` +
    `${appUrl}/portal/remarcar/${f.instanceId}\n\n` +
    WA_FOOTER +
    `Equipe Personal Teacher`
  )
}

// ---------------------------------------------------------------------------
// Encontros de mentoria (F10/M6-3): lembrete 24h (molde do toque 1) e
// cancelamento (estorno já feito — o crédito voltou).
// ---------------------------------------------------------------------------
export interface MeetingFacts {
  firstName: string
  startsAtUtc: string
  ianaTz: string
  localTimeSnapshot: string
  meetUrl?: string | null
  self?: boolean
  appUrl?: string
}

export function meetingReminderEmail(f: MeetingFacts): { subject: string; html: string } {
  const { time, longDate } = localParts(f.startsAtUtc, f.ianaTz, f.localTimeSnapshot)
  return {
    subject: `Sua mentoria é amanhã — ${time} ✈️`,
    html: brandEmail(`
<p>Olá, ${escapeHtml(f.firstName)}!</p>
<p>Lembrete: seu encontro de mentoria do Personal Travel é
<strong>${escapeHtml(longDate)}</strong>.</p>
${f.meetUrl ? `<p><a href="${escapeHtml(f.meetUrl)}" style="${BRAND_BTN_STYLE}">Entrar no encontro</a></p>` : ''}
<p>Nos vemos lá! 😊</p>
${SIGNATURE}`),
  }
}

export function meetingReminderText(f: MeetingFacts): string {
  const { longDate } = localParts(f.startsAtUtc, f.ianaTz, f.localTimeSnapshot)
  return (
    `Olá, ${f.firstName}! Lembrete: seu encontro de mentoria do Personal Travel é ` +
    `*${longDate}*. ✈️\n` +
    (f.meetUrl ? `\nEntrar no encontro: ${f.meetUrl}\n` : '') +
    `\nNos vemos lá! 😊\n\n` +
    `Equipe Personal Teacher`
  )
}

export function meetingCancelledEmail(f: MeetingFacts): { subject: string; html: string } {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  const { longDate } = localParts(f.startsAtUtc, f.ianaTz, f.localTimeSnapshot)
  return {
    subject: f.self ? 'Sua reserva de mentoria foi cancelada' : 'Encontro de mentoria cancelado',
    html: brandEmail(`
<p>Olá, ${escapeHtml(f.firstName)}!</p>
<p>${
      f.self
        ? `Confirmando: sua reserva do encontro de <strong>${escapeHtml(longDate)}</strong> foi cancelada.`
        : `O encontro de mentoria de <strong>${escapeHtml(longDate)}</strong> precisou ser cancelado — desculpa o transtorno.`
    }</p>
<p><strong>Seu crédito de mentoria já voltou</strong> — é só escolher outra data no portal.</p>
<p>
  <a href="${escapeHtml(appUrl)}/portal/mentoria" style="${BRAND_BTN_STYLE}">Escolher outra data</a>
</p>
${SIGNATURE}`),
  }
}

export function meetingCancelledText(f: MeetingFacts): string {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  const { longDate } = localParts(f.startsAtUtc, f.ianaTz, f.localTimeSnapshot)
  return (
    `Olá, ${f.firstName}! ` +
    (f.self
      ? `Confirmando: sua reserva do encontro de *${longDate}* foi cancelada.`
      : `O encontro de mentoria de *${longDate}* precisou ser cancelado — desculpa o transtorno.`) +
    `\n\n*Seu crédito de mentoria já voltou* — escolha outra data:\n${appUrl}/portal/mentoria\n\n` +
    WA_FOOTER +
    `Equipe Personal Teacher`
  )
}

// ---------------------------------------------------------------------------
// Elegibilidade de mentoria (template 'mentorship-eligible')
// ---------------------------------------------------------------------------
export interface MentorshipEligibleFacts {
  firstName: string
  /** etapa RESERVÁVEL (mentorship_next_window — painel achado 22) */
  nextWindow: number
  totalCredits: number
  appUrl?: string
}

export function mentorshipEligibleEmail(f: MentorshipEligibleFacts): { subject: string; html: string } {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  return {
    subject: `Sua mentoria nº ${f.nextWindow} está liberada! 🎉`,
    html: brandEmail(`
<p>Olá, ${escapeHtml(f.firstName)}!</p>
<p>Boa notícia: a sua <strong>mentoria nº ${f.nextWindow}</strong> (de ${f.totalCredits} do
programa Personal Travel) já está liberada para agendamento.</p>
<p>É só entrar no portal e escolher uma das datas disponíveis:</p>
<p>
  <a href="${escapeHtml(appUrl)}/portal/mentoria" style="${BRAND_BTN_STYLE}">Agendar minha mentoria</a>
</p>
<p>Nos vemos lá! ✈️</p>
${SIGNATURE}`),
  }
}

/** Versão TEXTO (WhatsApp — ADR-016). */
export function mentorshipEligibleText(f: MentorshipEligibleFacts): string {
  const appUrl = f.appUrl ?? APP_URL_DEFAULT
  return (
    `Olá, ${f.firstName}! Boa notícia: a sua *mentoria nº ${f.nextWindow}* (de ${f.totalCredits} ` +
    `do programa Personal Travel) já está liberada para agendamento. 🎉\n\n` +
    `É só entrar no portal e escolher uma das datas disponíveis:\n${appUrl}/portal/mentoria\n\n` +
    WA_FOOTER +
    `Equipe Personal Teacher`
  )
}
