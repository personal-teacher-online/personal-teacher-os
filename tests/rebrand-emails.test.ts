// Rebrand (issue #61): todo e-mail transacional sai com o nome "Personal Teacher
// Academy" no rodapé e na assinatura; nenhum resto de "Personal Teacher Online".
// Funções puras e arquivos de texto: não precisa do banco.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { briefingReminderEmail, briefingReminderText } from '../src/lib/email/briefing-reminder'
import { briefingUpdateReminderEmail, briefingUpdateReminderText } from '../src/lib/email/briefing-update-reminder'
import {
  classCancelledEmail,
  classCancelledText,
  classReminderEmail,
  classReminderText,
  meetingCancelledEmail,
  meetingCancelledText,
  meetingReminderEmail,
  meetingReminderText,
  mentorshipEligibleEmail,
  mentorshipEligibleText,
  periodInviteEmail,
  periodInviteText,
  rescheduleConfirmText,
} from '../src/lib/email/class-notices'
import { contentDigestEmail } from '../src/lib/email/content-digest'
import { contentReviewEmail } from '../src/lib/email/content-review'
import { creditExpiryEmail, creditExpiryText } from '../src/lib/email/credit-expiry'
import { partnerEmail, studentEmail, teacherEmail, teacherMovedEmail } from '../src/lib/email/reschedule'
import { sendEmailWithOutcome } from '../src/lib/email/send'
import { studentWhatsappChangedEmail } from '../src/lib/email/student-whatsapp-changed'
import { classCancelledTeacherEmail, teacherClassChangedEmail } from '../src/lib/email/teacher-notices'

// send.ts importa 'server-only', que lança fora do bundle do Next.
vi.mock('server-only', () => ({}))

const RODAPE = 'Personal Teacher Academy · aulas de inglês do seu jeito'
const ASSINATURA = 'Equipe Personal Teacher Academy'

const aula = {
  firstName: 'Ana',
  startsAtUtc: '2030-03-05T15:00:00Z',
  ianaTz: 'America/Cuiaba',
  localTimeSnapshot: '11:00',
  teacherName: 'Professora Teste',
}
const remarcacao = {
  firstName: 'Ana',
  studentTz: 'America/Cuiaba',
  oldStartsUtc: '2030-03-05T15:00:00Z',
  newStartsUtc: '2030-03-12T15:00:00Z',
  teacherName: 'Professora Teste',
  howCharged: 'da sua franquia mensal (restam 2)',
}
const encontro = { firstName: 'Ana', startsAtUtc: aula.startsAtUtc, ianaTz: aula.ianaTz, localTimeSnapshot: '11:00' }

// E-mails ao aluno: levam rodapé E assinatura.
const paraAluno: Array<[string, string]> = [
  ['classReminderEmail', classReminderEmail(aula).html],
  ['classReminderEmail 48h', classReminderEmail({ ...aula, marco: '48h', instanceId: 'x' }).html],
  ['classCancelledEmail', classCancelledEmail({ ...aula, credited: true, expiresOn: '2030-06-01' }).html],
  ['periodInviteEmail', periodInviteEmail({ ...aula, instanceId: 'x', note: null }).html],
  ['meetingReminderEmail', meetingReminderEmail(encontro).html],
  ['meetingCancelledEmail', meetingCancelledEmail(encontro).html],
  ['mentorshipEligibleEmail', mentorshipEligibleEmail({ firstName: 'Ana', nextWindow: 2, totalCredits: 2 }).html],
  ['creditExpiryEmail', creditExpiryEmail({ firstName: 'Ana', nCredits: 2, expiresOn: '2030-06-01' }).html],
  ['briefingReminderEmail', briefingReminderEmail({ firstName: 'Ana' }).html],
  ['briefingUpdateReminderEmail', briefingUpdateReminderEmail({ firstName: 'Ana' }).html],
  ['studentEmail', studentEmail(remarcacao).html],
  ['teacherMovedEmail', teacherMovedEmail(remarcacao).html],
  ['partnerEmail', partnerEmail({ ...remarcacao, partnerFirstName: 'Beto', whoRescheduled: 'Ana' }).html],
]
// Textos de WhatsApp (as funções *Text): a assinatura também leva o nome novo.
const textosParaAluno: Array<[string, string]> = [
  ['classReminderText', classReminderText(aula)],
  ['classReminderText 48h', classReminderText({ ...aula, marco: '48h', instanceId: 'x' })],
  ['rescheduleConfirmText', rescheduleConfirmText(aula)],
  ['classCancelledText', classCancelledText({ ...aula, credited: true, expiresOn: '2030-06-01' })],
  ['periodInviteText', periodInviteText({ ...aula, instanceId: 'x', note: null })],
  ['meetingReminderText', meetingReminderText(encontro)],
  ['meetingCancelledText', meetingCancelledText(encontro)],
  ['mentorshipEligibleText', mentorshipEligibleText({ firstName: 'Ana', nextWindow: 2, totalCredits: 2 })],
  ['creditExpiryText', creditExpiryText({ firstName: 'Ana', nCredits: 2, expiresOn: '2030-06-01' })],
  ['briefingReminderText', briefingReminderText({ firstName: 'Ana' })],
  ['briefingUpdateReminderText', briefingUpdateReminderText({ firstName: 'Ana' })],
]
// E-mails internos (professora/administração): sem assinatura por desenho, só rodapé.
const internos: Array<[string, string]> = [
  [
    'teacherEmail',
    teacherEmail({
      studentTz: remarcacao.studentTz,
      oldStartsUtc: remarcacao.oldStartsUtc,
      newStartsUtc: remarcacao.newStartsUtc,
      teacherName: 'Professora Teste',
      studentName: 'Aluno Teste',
      teacherTz: 'America/Sao_Paulo',
    }).html,
  ],
  [
    'classCancelledTeacherEmail',
    classCancelledTeacherEmail({
      firstName: 'Bia',
      studentName: 'Aluno Teste',
      startsAtUtc: aula.startsAtUtc,
      teacherTz: 'America/Sao_Paulo',
      cancelledBy: 'student',
    }).html,
  ],
  [
    'teacherClassChangedEmail',
    teacherClassChangedEmail({
      firstName: 'Bia',
      teacherName: 'Professora Teste',
      studentName: 'Aluno Teste',
      kind: 'cancelled',
      oldStartsAtUtc: aula.startsAtUtc,
      reason: 'imprevisto',
      teacherTz: 'America/Sao_Paulo',
    }).html,
  ],
  ['contentDigestEmail', contentDigestEmail({ semana: '2030-W10', novas: 3, destaque: 1, rascunhos: 0, firstName: 'Bia' }).html],
  ['contentReviewEmail', contentReviewEmail({ stage: 'ideias', firstName: 'Bia' }).html],
  [
    'studentWhatsappChangedEmail',
    studentWhatsappChangedEmail({ firstName: 'Bia', studentName: 'Aluno Teste', whatsappE164: '+5565900000001' }).html,
  ],
]

describe('rebrand dos e-mails montados em código', () => {
  it.each([...paraAluno, ...internos])('%s: rodapé novo, sem o nome antigo', (_nome, html) => {
    expect(html).toContain(RODAPE)
    expect(html).not.toContain('Personal Teacher Online')
    expect(html).not.toMatch(/Equipe Personal Teacher(?! Academy)/)
  })

  it.each(paraAluno)('%s: assinatura "Equipe Personal Teacher Academy"', (_nome, html) => {
    expect(html).toContain(ASSINATURA)
  })
})

describe('rebrand dos textos de WhatsApp', () => {
  it.each(textosParaAluno)('%s: assinatura "Equipe Personal Teacher Academy"', (_nome, texto) => {
    expect(texto).toContain(ASSINATURA)
    expect(texto).not.toContain('Personal Teacher Online')
    expect(texto).not.toMatch(/Equipe Personal Teacher(?! Academy)/)
  })
})

describe('remetente padrão', () => {
  const envAntes = { from: process.env.EMAIL_FROM, key: process.env.RESEND_API_KEY }
  afterEach(() => {
    if (envAntes.from === undefined) delete process.env.EMAIL_FROM
    else process.env.EMAIL_FROM = envAntes.from
    if (envAntes.key === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = envAntes.key
    vi.unstubAllGlobals()
  })

  it('sem EMAIL_FROM, o fallback do código é "Personal Teacher Academy <contato@personal-teacher.com>"', async () => {
    delete process.env.EMAIL_FROM
    process.env.RESEND_API_KEY = 'chave-de-teste'
    const corpos: string[] = []
    vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: string }) => {
      corpos.push(String(init?.body ?? ''))
      return new Response('{}', { status: 200 })
    })
    await sendEmailWithOutcome({ to: 'aluna@exemplo.com', subject: 's', html: '<p>oi</p>' })
    expect(JSON.parse(corpos[0]).from).toBe('Personal Teacher Academy <contato@personal-teacher.com>')
  })
})

describe('templates HTML do Auth (public/emails e supabase/templates)', () => {
  const arquivos = ['invite', 'recovery', 'magic-link'].flatMap((n) => [
    join('public/emails', `${n}.html`),
    join('supabase/templates', `${n}.html`),
  ])

  it.each(arquivos)('%s: assinatura e rodapé novos, sem "Personal Teacher Online"', (arquivo) => {
    // o comentário de procedência cita o nome da época da aprovação: fica de fora
    const html = readFileSync(join(__dirname, '..', arquivo), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    expect(html).toContain(ASSINATURA)
    expect(html).toContain(RODAPE)
    expect(html).not.toContain('Personal Teacher Online')
    expect(html).not.toMatch(/Equipe Personal Teacher(?! Academy)/)
  })

  it.each(['invite', 'recovery', 'magic-link'])('%s: cópia pública idêntica à fonte (exceto comentário)', (n) => {
    const semComentario = (p: string) =>
      readFileSync(join(__dirname, '..', p), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    expect(semComentario(`public/emails/${n}.html`)).toBe(semComentario(`supabase/templates/${n}.html`))
  })
})

describe('assuntos dos e-mails do Auth na bancada (supabase/config.toml)', () => {
  const toml = readFileSync(join(__dirname, '..', 'supabase/config.toml'), 'utf8')
  const assuntos = [...toml.matchAll(/^subject = "(.*Personal Teacher.*)"$/gm)].map((m) => m[1])

  it('os três assuntos citam "Personal Teacher Academy"', () => {
    expect(assuntos).toHaveLength(3)
    for (const a of assuntos) expect(a).toContain('Personal Teacher Academy')
  })
})

describe('.env.example', () => {
  it('EMAIL_FROM de exemplo usa o nome novo', () => {
    const env = readFileSync(join(__dirname, '..', '.env.example'), 'utf8')
    expect(env).toMatch(/^EMAIL_FROM="Personal Teacher Academy </m)
  })
})
