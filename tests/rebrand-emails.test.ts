// Rebrand (issue #61): todo e-mail transacional sai com o nome "Personal Teacher
// Academy" no rodapé e na assinatura; nenhum resto de "Personal Teacher Online".
// #131 (ADR-042): o domínio passa a `pteacheracademy.com` (remetente, links dos
// e-mails e retorno do OAuth do Google); só os botões dos templates de WhatsApp
// já submetidos à Meta ficam no domínio antigo, que redireciona (issue #130).
// Funções puras e arquivos de texto: não precisa do banco.
import { spawnSync } from 'node:child_process'
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
import { googleAuthUrl, googleOAuthConfigFromEnv } from '../src/lib/google/oauth'
import { GET as conectarGoogle } from '../src/app/teacher/google/conectar/route'
import { GET as voltaDoGoogle } from '../src/app/teacher/google/callback/route'
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

  it('sem EMAIL_FROM, o fallback do código é "Personal Teacher Academy <contato@pteacheracademy.com>" (#131)', async () => {
    delete process.env.EMAIL_FROM
    process.env.RESEND_API_KEY = 'chave-de-teste'
    const corpos: string[] = []
    vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: string }) => {
      corpos.push(String(init?.body ?? ''))
      return new Response('{}', { status: 200 })
    })
    await sendEmailWithOutcome({ to: 'aluna@exemplo.com', subject: 's', html: '<p>oi</p>' })
    expect(JSON.parse(corpos[0]).from).toBe('Personal Teacher Academy <contato@pteacheracademy.com>')
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
  it.each(['recovery', 'magic-link'])('%s: promete 24 horas de validade (decisão do dono, 01/11/2026), nunca 60 minutos', (n) => {
    const html = readFileSync(join(__dirname, '..', `public/emails/${n}.html`), 'utf8')
    expect(html).toContain('O link vale por 24 horas e só funciona uma vez')
    expect(html).not.toMatch(/60 minutos|uma hora|1 hora/)
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
  const env = readFileSync(join(__dirname, '..', '.env.example'), 'utf8')

  it('EMAIL_FROM de exemplo usa o nome novo', () => {
    expect(env).toMatch(/^EMAIL_FROM="Personal Teacher Academy </m)
  })

  it('#131: remetente e retorno do OAuth do Google no domínio novo', () => {
    expect(env).toMatch(/^EMAIL_FROM="Personal Teacher Academy <contato@pteacheracademy\.com>"$/m)
    expect(env).toMatch(/^GOOGLE_OAUTH_REDIRECT_URL=https:\/\/app\.pteacheracademy\.com\/teacher\/google\/callback$/m)
  })
})

/* ========================================================================== */
/* #131 · domínio pteacheracademy.com (ADR-042)                                 */
const APP = 'https://app.pteacheracademy.com'

describe('#131 · links montados nos e-mails e textos saem no domínio novo', () => {
  // um link de cada família de módulo de e-mail, com o endereço padrão do código
  const umPorFamilia: Array<[string, string, string]> = [
    [
      'aviso à aluna (class-notices)',
      classCancelledEmail({ ...aula, credited: true, expiresOn: '2030-06-01' }).html,
      `href="${APP}/portal/creditos"`,
    ],
    [
      'crédito vencendo (credit-expiry)',
      creditExpiryEmail({ firstName: 'Ana', nCredits: 2, expiresOn: '2030-06-01' }).html,
      `href="${APP}/portal/creditos"`,
    ],
    ['briefing (briefing-reminder)', briefingReminderEmail({ firstName: 'Ana' }).html, `href="${APP}/portal/briefing"`],
    [
      'briefing (briefing-update-reminder)',
      briefingUpdateReminderEmail({ firstName: 'Ana' }).html,
      `href="${APP}/portal/briefing/atualizar"`,
    ],
    ['remarcação, à professora (reschedule)', internos[0][1], `href="${APP}/teacher"`],
    ['aviso à professora (teacher-notices)', internos[1][1], `href="${APP}/teacher?aba=aulas"`],
    ['aviso à dona (teacher-notices)', internos[2][1], `href="${APP}/admin/agenda"`],
    ['radar de conteúdo (content-digest)', internos[3][1], `href="${APP}/admin/conteudo"`],
    ['revisão de conteúdo (content-review)', internos[4][1], `href="${APP}/admin/conteudo/posts?st=pendentes"`],
    ['WhatsApp da aluna mudou (student-whatsapp-changed)', internos[5][1], `href="${APP}/teacher"`],
    [
      'texto de WhatsApp (convite do período)',
      periodInviteText({ ...aula, instanceId: 'x', note: null }),
      `${APP}/portal/remarcar/x`,
    ],
  ]

  it.each(umPorFamilia)('%s', (_familia, saida, link) => {
    expect(saida).toContain(link)
  })

  it.each([...paraAluno, ...internos, ...textosParaAluno])('%s: nenhum link no domínio antigo', (_nome, saida) => {
    expect(saida).not.toContain('personal-teacher.com')
  })
})

describe('#131 · retorno do OAuth do Google no domínio novo', () => {
  const envAntes = {
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URL: process.env.GOOGLE_OAUTH_REDIRECT_URL,
  }
  afterEach(() => {
    for (const [nome, valor] of Object.entries(envAntes)) {
      if (valor === undefined) delete process.env[nome]
      else process.env[nome] = valor
    }
    vi.unstubAllEnvs()
  })

  it('sem GOOGLE_OAUTH_REDIRECT_URL, o retorno padrão é a rota real no domínio novo', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'id-de-teste'
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'segredo-de-teste'
    delete process.env.GOOGLE_OAUTH_REDIRECT_URL
    const cfg = googleOAuthConfigFromEnv()
    expect(cfg?.redirectUrl).toBe(`${APP}/teacher/google/callback`)
    const consentimento = new URL(googleAuthUrl(cfg!, 'estado'))
    expect(consentimento.searchParams.get('redirect_uri')).toBe(`${APP}/teacher/google/callback`)
  })

  it.each([
    ['conectar', () => conectarGoogle(new Request('http://0.0.0.0:3000/teacher/google/conectar'))],
    ['callback', () => voltaDoGoogle(new Request('http://0.0.0.0:3000/teacher/google/callback'))],
  ])('%s sem a integração configurada, em produção: volta ao painel no domínio novo', async (_rota, chamar) => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
    vi.stubEnv('NODE_ENV', 'production')
    const r = await chamar()
    expect(r.headers.get('location')).toBe(`${APP}/teacher`)
  })
})

describe('#131 · nenhum endereço no domínio antigo fora das exceções', () => {
  // As exceções (critério da issue #131):
  //  - a base dos botões dos templates de WhatsApp já submetidos à Meta: mudar
  //    exige reaprovação, e o domínio antigo redireciona para sempre (#130).
  //    Exceção por LINHA: só a constante `NO_APP` e o comentário que a explica;
  //  - o registro do que a Meta aceitou e o JSON de submissão versionado;
  //  - a história: ADRs e o plano já executado do repositório público;
  //  - o teste que prende a base dos botões, e este próprio vigia;
  //  - a lista do scanner, que segue aceitando o endereço antigo enquanto ele
  //    aparece na história.
  const ARQUIVOS_ISENTOS = new Set([
    'tests/fixtures/meta/templates-aceitos-2026-11-01.json',
    'docs/whatsapp-templates.json',
    'docs/plano-repositorio-publico-2026-10.md',
    'tests/whatsapp-templates.test.ts',
    'tests/rebrand-emails.test.ts',
    'scripts/vazamento-excecoes.txt',
  ])
  const ehComentario = (linha: string) => linha.trimStart().startsWith('//')
  const LINHAS_ISENTAS: Readonly<Record<string, (linha: string) => boolean>> = {
    'src/lib/notify/whatsapp-templates.ts': (l) => l === "const NO_APP = 'https://app.personal-teacher.com/{{1}}'",
    'src/lib/outbox/whatsapp-do-aviso.ts': ehComentario,
  }

  /** As citações (`arquivo:linha`) do domínio antigo que nenhuma exceção cobre. */
  function foraDasExcecoes(achados: Array<{ arquivo: string; numero: string; linha: string }>): string[] {
    return achados
      .filter(({ arquivo, linha }) => {
        if (ARQUIVOS_ISENTOS.has(arquivo) || arquivo.startsWith('docs/decisions/')) return false
        return !LINHAS_ISENTAS[arquivo]?.(linha)
      })
      .map(({ arquivo, numero }) => `${arquivo}:${numero}`)
  }

  it('src, tests, scripts e docs só citam personal-teacher.com nas exceções', () => {
    // git grep: só arquivos versionados, na cópia de trabalho; sai 1 quando nada casa.
    // -z separa arquivo, número e linha por NUL (o conteúdo pode ter dois-pontos).
    const busca = spawnSync(
      'git',
      ['grep', '-n', '-z', '-F', 'personal-teacher.com', '--', 'src', 'tests', 'scripts', 'docs'],
      { cwd: join(__dirname, '..'), encoding: 'utf8' },
    )
    expect([0, 1], busca.stderr).toContain(busca.status)
    const achados = busca.stdout
      .split('\n')
      .filter(Boolean)
      .map((registro) => {
        const [arquivo, numero, ...resto] = registro.split('\0')
        return { arquivo, numero, linha: resto.join('\0') }
      })
    expect(achados.length).toBeGreaterThan(0) // a base dos botões sempre aparece
    expect(foraDasExcecoes(achados)).toEqual([])
  })

  it('nos arquivos dos botões, só a constante e o comentário escapam: outro literal é acusado', () => {
    const achados = [
      { arquivo: 'src/lib/notify/whatsapp-templates.ts', numero: '1', linha: "const NO_APP = 'https://app.personal-teacher.com/{{1}}'" },
      { arquivo: 'src/lib/outbox/whatsapp-do-aviso.ts', numero: '2', linha: '// (`https://app.personal-teacher.com/{{1}}`): base' },
      { arquivo: 'src/lib/outbox/whatsapp-do-aviso.ts', numero: '3', linha: "  const link = 'https://app.personal-teacher.com/portal/creditos'" },
      { arquivo: 'src/lib/notify/whatsapp-templates.ts', numero: '4', linha: "  url: 'https://app.personal-teacher.com/portal/{{1}}'," },
      { arquivo: 'src/lib/email/send.ts', numero: '5', linha: '// contato antigo: personal-teacher.com' },
    ]
    expect(foraDasExcecoes(achados)).toEqual([
      'src/lib/outbox/whatsapp-do-aviso.ts:3',
      'src/lib/notify/whatsapp-templates.ts:4',
      'src/lib/email/send.ts:5',
    ])
  })
})
