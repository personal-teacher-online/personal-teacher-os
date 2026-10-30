// Construção total (14/07/2026) — templates NOVOS do despachante do outbox
// (registro TEMPLATES em src/lib/outbox/dispatch.ts): class-reminder (e-mail +
// WhatsApp, hora LOCAL do destinatário via iana_tz do payload — painel 28),
// reschedule-confirm (só WhatsApp; e-mail = guarda de template), mentorship-
// eligible (etapa reservável — painel 22) e regressão do credit-expiry APROVADO
// (o refactor para registry não pode ter mudado o template §5).
// Molde: tests/fase3-dispatch.test.ts (client + canais fake injetados).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DateTime } from 'luxon'

// #43: o WhatsApp sai como template da Meta, e os templates com rodapé pedem o
// número de atendimento como parâmetro (sem ele a linha fica presa com o
// motivo). Número fictício fixado ANTES dos imports (lido na carga do módulo).
vi.hoisted(() => {
  process.env.WHATSAPP_ATENDIMENTO_E164 = '+5565900000001'
})
import type { Sql } from 'postgres'
import type { Email, SendOutcome } from '../src/lib/email/send'
import type { OutboundMessage } from '../src/lib/notify/channel'
import { dispatchOutbox } from '../src/lib/outbox/dispatch'
import { serviceClient } from './helpers/auth'
import { connect, createStudent } from './helpers/db'

const service = serviceClient()

let sql: Sql
beforeAll(() => {
  sql = connect(2)
})
afterAll(async () => {
  await sql.end()
})

const TODAY = '2026-07-20'
const FIRST_NAME = 'Bela'
const LISBON = 'Europe/Lisbon'
const TEACHER = 'Professora Dona CT'

function collectingSend(outcome: SendOutcome = { ok: true }) {
  const sent: Email[] = []
  return {
    sent,
    send: async (email: Email): Promise<SendOutcome> => {
      sent.push(email)
      return outcome
    },
  }
}

function collectingWa() {
  const sent: OutboundMessage[] = []
  return {
    sent,
    channel: {
      send: async (m: OutboundMessage) => {
        sent.push(m)
        return { ok: true as const }
      },
    },
  }
}

async function createStudentWithLogin(): Promise<{
  studentId: string
  profileId: string
  email: string
}> {
  const studentId = await createStudent(sql)
  const email = `ct-tpl-${crypto.randomUUID().slice(0, 10)}@bancada.dev`
  const { data } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { role: 'student' },
    user_metadata: { first_name: FIRST_NAME },
  })
  const profileId = data!.user!.id
  // A6/i: o vínculo do acesso exige número no perfil (gatilho
  // `students_lead_sem_login`). Esta fixture representa o aluno SEM WhatsApp, que
  // continua existindo de propósito — legado, ou limpeza deliberada pelo admin —,
  // então ela nasce com número, vincula, e limpa depois: é o estado ACEITO, não o
  // proibido (que é o acesso NASCER sem número).
  await sql`insert into profiles (id, role, full_name, whatsapp_e164)
            values (${profileId}, 'student', 'Bela CT', '+5565900020012')`
  await sql`update students set profile_id = ${profileId} where id = ${studentId}`
  await sql`update profiles set whatsapp_e164 = null where id = ${profileId}`
  return { studentId, profileId, email }
}

/** Opt-in de WhatsApp com número único por teste (evita colisão com linhas
 *  pendentes de rodadas anteriores da suíte). */
async function optInWhatsapp(profileId: string): Promise<string> {
  const e164 = '+351900' + String(100000 + Math.floor(Math.random() * 900000))
  await sql`update profiles set whatsapp_e164 = ${e164}
            where id = ${profileId}`
  return e164
}

async function seedRow(opts: {
  template: string
  channel?: 'email' | 'whatsapp'
  profileId: string | null
  payload: Record<string, unknown>
}): Promise<string> {
  const [row] = await sql`
    insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
    values (${opts.channel ?? 'email'}, ${opts.template}, ${opts.profileId},
            ${sql.json(opts.payload as never)}, ${'ct-tpl:' + crypto.randomUUID()})
    returning id`
  return row.id as string
}

/** Payload no formato EXATO do enqueue_class_reminders (20260715000500):
 *  o iana_tz é o do DESTINATÁRIO — o template formata a hora na zona dele. */
function classPayload(studentId: string, startsAt: DateTime): Record<string, unknown> {
  return {
    instance_id: crypto.randomUUID(),
    student_id: studentId,
    starts_at_utc: startsAt.toISO(),
    local_time_snapshot: `${startsAt.setZone(LISBON).toFormat('HH:mm')} ${LISBON} (fixture)`,
    iana_tz: LISBON,
    teacher_name: TEACHER,
  }
}

/** Hora local de Lisboa esperada, calculada AQUI com Luxon (mesma Lei 1 do
 *  template: instante UTC + zona IANA; nunca offset fixo). */
const lisbonTime = (dt: DateTime): string => dt.setZone(LISBON).toFormat('HH:mm')

describe("template 'class-reminder' (lembrete de aula — janela rolante 24h)", () => {
  it('(a) e-mail: subject com a hora LOCAL DE LISBOA e html com o nome da professora', async () => {
    const { studentId, profileId, email } = await createStudentWithLogin()
    const startsAt = DateTime.utc().plus({ hours: 3 })
    const rowId = await seedRow({
      template: 'class-reminder',
      profileId,
      payload: classPayload(studentId, startsAt),
    })

    const box = collectingSend()
    await dispatchOutbox(service, { email: { send: box.send } }, { today: TODAY, limit: 5000, keyLike: 'ct-tpl:%' })

    const mine = box.sent.filter((e) => e.to === email)
    expect(mine).toHaveLength(1)
    const expected = lisbonTime(startsAt) // hora de Lisboa, não a UTC do instante
    expect(mine[0].subject).toContain(`às ${expected}`)
    expect(mine[0].html).toContain(TEACHER)
    expect(mine[0].html).toContain(`Olá, ${FIRST_NAME}!`)
    expect(mine[0].html).toContain('/portal')

    const [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).not.toBeNull()
    expect(row.error).toBeNull()
  })

  it('(b) WhatsApp com opt-in + telefone: texto com a hora de Lisboa, enviado ao e164', async () => {
    const { studentId, profileId } = await createStudentWithLogin()
    const e164 = await optInWhatsapp(profileId)
    const startsAt = DateTime.utc().plus({ hours: 3 })
    const rowId = await seedRow({
      template: 'class-reminder',
      channel: 'whatsapp',
      profileId,
      payload: classPayload(studentId, startsAt),
    })

    const wa = collectingWa()
    // class-reminder é quiet:true — 'agora' diurno para o teste valer à noite
    await dispatchOutbox(service, { whatsapp: wa.channel }, {
      today: TODAY, limit: 5000, keyLike: 'ct-tpl:%',
      now: new Date(new Date().setUTCHours(15, 0, 0, 0)),
    })

    const mine = wa.sent.filter((m) => m.to === e164)
    expect(mine).toHaveLength(1)
    expect(mine[0].text).toContain(`às ${lisbonTime(startsAt)}`)
    expect(mine[0].text).toContain(TEACHER)

    const [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).not.toBeNull()
    expect(row.error).toBeNull()
  })

  it("(c) starts_at_utc no PASSADO → resolvida SEM envio, error 'aula já começou antes do envio'", async () => {
    const { studentId, profileId, email } = await createStudentWithLogin()
    const startsAt = DateTime.utc().minus({ hours: 2 })
    const rowId = await seedRow({
      template: 'class-reminder',
      profileId,
      payload: classPayload(studentId, startsAt),
    })

    const box = collectingSend()
    await dispatchOutbox(service, { email: { send: box.send } }, { today: TODAY, limit: 5000, keyLike: 'ct-tpl:%' })

    expect(box.sent.filter((e) => e.to === email)).toHaveLength(0)
    const [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).not.toBeNull() // resolvida — sai da fila, nunca spam atrasado
    expect(row.error).toBe('aula já começou antes do envio')
  })
})

describe("template 'reschedule-confirm' (só WhatsApp — espelho do e-mail 3)", () => {
  it("(d) canal e-mail → fica PENDENTE com 'sem versão e-mail' (guarda de template)", async () => {
    const { studentId, profileId, email } = await createStudentWithLogin()
    const startsAt = DateTime.utc().plus({ hours: 30 })
    const rowId = await seedRow({
      template: 'reschedule-confirm',
      profileId, // canal default = email — combinação que o enqueue NUNCA gera
      payload: classPayload(studentId, startsAt),
    })

    const box = collectingSend()
    await dispatchOutbox(service, { email: { send: box.send } }, { today: TODAY, limit: 5000, keyLike: 'ct-tpl:%' })

    expect(box.sent.filter((e) => e.to === email)).toHaveLength(0)
    const [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).toBeNull() // pendente — nunca "resolvida" em silêncio
    expect(row.error).toMatch(/sem versão e-mail/)
    // higiene: resolve para as demais rodadas deste arquivo não a reprocessarem
    await sql`update notification_outbox set sent_at = now() where id = ${rowId}`
  })

  it("(e) canal WhatsApp válido → texto com 'remarcação está confirmada'", async () => {
    const { studentId, profileId } = await createStudentWithLogin()
    const e164 = await optInWhatsapp(profileId)
    const startsAt = DateTime.utc().plus({ hours: 30 })
    const rowId = await seedRow({
      template: 'reschedule-confirm',
      channel: 'whatsapp',
      profileId,
      payload: classPayload(studentId, startsAt),
    })

    const wa = collectingWa()
    await dispatchOutbox(service, { whatsapp: wa.channel }, { today: TODAY, limit: 5000, keyLike: 'ct-tpl:%' })

    const mine = wa.sent.filter((m) => m.to === e164)
    expect(mine).toHaveLength(1)
    expect(mine[0].text).toContain('remarcação está confirmada')
    expect(mine[0].text).toContain(`às ${lisbonTime(startsAt)}`) // hora LOCAL do aluno

    const [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).not.toBeNull()
  })
})

describe("template 'mentorship-eligible' (etapa reservável — painel 22)", () => {
  it("(f) e-mail com {next_window: 2, total_credits: 6} → subject com 'nº 2'", async () => {
    const { studentId, profileId, email } = await createStudentWithLogin()
    const rowId = await seedRow({
      template: 'mentorship-eligible',
      profileId,
      payload: {
        contract_id: crypto.randomUUID(),
        student_id: studentId,
        next_window: 2,
        total_credits: 6,
      },
    })

    const box = collectingSend()
    await dispatchOutbox(service, { email: { send: box.send } }, { today: TODAY, limit: 5000, keyLike: 'ct-tpl:%' })

    const mine = box.sent.filter((e) => e.to === email)
    expect(mine).toHaveLength(1)
    expect(mine[0].subject).toContain('nº 2') // a etapa RESERVÁVEL, não o total destravado
    expect(mine[0].html).toContain('de 6')
    expect(mine[0].html).toContain('/portal/mentoria')

    const [row] = await sql`select sent_at from notification_outbox where id = ${rowId}`
    expect(row.sent_at).not.toBeNull()
  })
})

describe('regressões do registry (painel final F3 + template aprovado §5)', () => {
  it("(g) template desconhecido → PENDENTE com 'sem handler' (auto-recuperável pós-deploy)", async () => {
    const { studentId, profileId } = await createStudentWithLogin()
    const rowId = await seedRow({
      template: 'ct-template-de-fase-futura',
      profileId,
      payload: { student_id: studentId },
    })

    const box = collectingSend()
    await dispatchOutbox(service, { email: { send: box.send } }, { today: TODAY, limit: 5000, keyLike: 'ct-tpl:%' })

    const [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).toBeNull()
    expect(row.error).toMatch(/sem handler/)
    // higiene: resolve para as demais rodadas não a reprocessarem
    await sql`update notification_outbox set sent_at = now() where id = ${rowId}`
  })

  it("(h) 'credit-expiry' caminho feliz: texto aprovado intacto — 'crédito' e a data", async () => {
    const { studentId, profileId, email } = await createStudentWithLogin()
    const rowId = await seedRow({
      template: 'credit-expiry',
      profileId,
      payload: {
        student_id: studentId,
        contract_id: crypto.randomUUID(),
        expires_on: '2026-08-10',
        marco: 30,
        n_credits: 1,
      },
    })

    const box = collectingSend()
    await dispatchOutbox(service, { email: { send: box.send } }, { today: TODAY, limit: 5000, keyLike: 'ct-tpl:%' })

    const mine = box.sent.filter((e) => e.to === email)
    expect(mine).toHaveLength(1)
    // Pino byte a byte do subject APROVADO (fase2-emails-rascunho.md §5): o
    // refactor para o registry de templates NÃO pode ter mudado este texto.
    expect(mine[0].subject).toBe('Você tem 1 aula de reposição vencendo em 10/08/2026')
    expect(mine[0].html).toContain('crédito')
    expect(mine[0].html).toContain('10/08/2026')

    const [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).not.toBeNull()
    expect(row.error).toBeNull()
  })
})
