// Fase 3 / M3 — despachante do outbox (F3-D4): at-least-once, resolução tardia do
// destinatário, aviso obsoleto resolvido sem envio, retry sem duplicata. Casos 25–26
// do goal (parte de aplicação) + adendo 7 do gate M0.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { Email, SendOutcome } from '../src/lib/email/send'
import { creditExpiryEmail } from '../src/lib/email/credit-expiry'
import { isPublicPath, resolveAccess } from '../src/lib/auth/gate'
import type { OutboundMessage } from '../src/lib/notify/channel'
import { evolutionChannel } from '../src/lib/notify/evolution'
import { dispatchOutbox } from '../src/lib/outbox/dispatch'
import { handleDispatchOutbox } from '../src/lib/outbox/handle'
import { serviceClient } from './helpers/auth'
import { connect, createStudent, daysFromToday } from './helpers/db'

const service = serviceClient()

let sql: Sql
beforeAll(async () => {
  sql = connect(2)
  // Higiene do banco compartilhado (a suíte roda sem reset). Pendência de execução
  // ANTERIOR fica elegível para SEMPRE (sent_at NULL, com ou sem error) e, como o
  // despachante ordena por created_at, as órfãs velhas ocupam a frente do lote.
  // O teto real do lote NÃO é o limit pedido: o PostgREST corta em
  // PGRST_DB_MAX_ROWS (=1000 no supabase local), então o limit: 5000 dos testes
  // vira 1000 em silêncio. Em 21/07 havia 1,7 mil credit-expiry órfãs — as linhas
  // recém-semeadas caíam FORA da janela e a rodada devolvia sent=0 com sent_at e
  // error intactos (5 casos vermelhos, sem relação com a fábrica de conteúdo).
  // DELETE é proibido (Lei 8) — a varredura usa a transição legítima do PRÓPRIO
  // despachante ("resolvida sem envio": sent_at + motivo em error, rastro
  // auditável). Marcar só o error NÃO adianta: a elegibilidade é sent_at IS NULL.
  // O corte de 1h nunca alcança fixture da execução corrente (o arquivo inteiro
  // roda em ~20s), nem a dos arquivos que rodam em paralelo.
  await sql`
    update notification_outbox
       set sent_at = now(),
           error = 'varredura: fixture de outra execução (banco compartilhado sem reset)'
     where sent_at is null and created_at < now() - interval '1 hour'`
})
afterAll(async () => {
  await sql.end()
})

// Retomada 01/09/2026 — a data cravada em julho APODRECEU no caso 25: a rota
// real (`handleDispatchOutbox`) usa o `business_today()` do banco, e uma linha
// semeada com validade contada de 20/07 chegava lá já vencida — resolvida sem
// envio, zero enviados. A data acompanha o dia do NEGÓCIO (Cuiabá).
const TODAY = daysFromToday(0)
/** '2026-10-01' → '01/10/2026' — a mesma grafia que o template escreve. */
const BR = (iso: string) => iso.split('-').reverse().join('/')

/**
 * Filtro do despacho que alcança só os avisos `credit-expiry` do aluno do caso.
 * A suíte roda arquivos em paralelo no mesmo banco (fase3-outbox enfileira avisos
 * `credit-expiry` de outros alunos); sem este estreitamento, a rodada despacharia
 * e contaria esses avisos alheios. A chave é `credit-expiry:<contrato>:<aluno>:...`.
 */
const keyDoAluno = (studentId: string) => `credit-expiry:%:${studentId}:%`

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

async function seedOutboxRow(opts: {
  studentId: string
  profileId?: string | null
  expiresOn?: string
  contractId?: string
}): Promise<string> {
  // Validade padrão RELATIVA ao dia do negócio (a literal de agosto apodreceu
  // com o calendário: virava aviso obsoleto e nada era enviado).
  const expiresOn = opts.expiresOn ?? daysFromToday(30)
  const key = `credit-expiry:${opts.contractId ?? crypto.randomUUID()}:${opts.studentId}:${expiresOn}:30`
  const [row] = await sql`
    insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
    values ('credit-expiry', ${opts.profileId ?? null},
            ${sql.json({
              student_id: opts.studentId,
              contract_id: opts.contractId ?? crypto.randomUUID(),
              expires_on: expiresOn,
              marco: 30,
              n_credits: 2,
            })},
            ${key})
    returning id`
  return row.id as string
}

async function createStudentWithLogin(): Promise<{ studentId: string; profileId: string; email: string }> {
  const studentId = await createStudent(sql)
  const email = `m3-${crypto.randomUUID().slice(0, 10)}@bancada.dev`
  const { data } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { role: 'student' },
    user_metadata: { first_name: 'Fábio' },
  })
  const profileId = data!.user!.id
  // A6/i: o vínculo do acesso exige número no perfil (gatilho
  // `students_lead_sem_login`). Esta fixture representa o aluno SEM WhatsApp, que
  // continua existindo de propósito — legado, ou limpeza deliberada pelo admin —,
  // então ela nasce com número, vincula, e limpa depois: é o estado ACEITO, não o
  // proibido (que é o acesso NASCER sem número).
  await sql`insert into profiles (id, role, full_name, whatsapp_e164)
            values (${profileId}, 'student', 'Fábio M3', '+5565900081002')`
  await sql`update students set profile_id = ${profileId} where id = ${studentId}`
  await sql`update profiles set whatsapp_e164 = null where id = ${profileId}`
  return { studentId, profileId, email }
}

describe('M3: despachante — caminho feliz e at-least-once', () => {
  it('envia pendente com destinatário resolvido, marca sent_at; reexecução NÃO reenvia (caso 26)', async () => {
    const { studentId, profileId, email } = await createStudentWithLogin()
    const rowId = await seedOutboxRow({ studentId, profileId })

    const box = collectingSend()
    const r1 = await dispatchOutbox(service, { email: { send: box.send } }, { today: TODAY, limit: 5000, keyLike: keyDoAluno(studentId) })
    expect(r1.sent).toBeGreaterThanOrEqual(1)
    const mine = box.sent.filter((e) => e.to === email)
    expect(mine).toHaveLength(1)
    expect(mine[0].subject).toContain(`2 aulas de reposição vencendo em ${BR(daysFromToday(30))}`)
    expect(mine[0].html).toContain('Oi, Fábio!')
    expect(mine[0].html).toContain('/portal')
    expect(mine[0].idempotencyKey).toBeTruthy() // hardening — Resend Idempotency-Key

    const [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).not.toBeNull()
    expect(row.error).toBeNull()

    // Linha com sent_at NUNCA é reenviada (letra testável do caso 26).
    const box2 = collectingSend()
    await dispatchOutbox(service, { email: { send: box2.send } }, { today: TODAY, limit: 5000, keyLike: keyDoAluno(studentId) })
    expect(box2.sent.filter((e) => e.to === email)).toHaveLength(0)
    // 20s: o pool COMPARTILHADO do outbox cresceu com as fases F2/F5/F6 (testes
    // paralelos enfileiram enquanto este despacha) — infra, não spec.
  }, 20_000)

  it('falha de envio (Resend fora) → error gravado, sent_at NULL, retentado depois', async () => {
    const { studentId, profileId, email } = await createStudentWithLogin()
    const rowId = await seedOutboxRow({ studentId, profileId })

    const down = collectingSend({ ok: false, error: 'Resend 503: indisponível' })
    await dispatchOutbox(service, { email: { send: down.send } }, { today: TODAY, limit: 5000, keyLike: keyDoAluno(studentId) })
    let [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).toBeNull()
    expect(row.error).toContain('Resend 503')

    // Provedor voltou: a MESMA linha é retentada e enviada.
    const up = collectingSend()
    await dispatchOutbox(service, { email: { send: up.send } }, { today: TODAY, limit: 5000, keyLike: keyDoAluno(studentId) })
    expect(up.sent.filter((e) => e.to === email)).toHaveLength(1)
    ;[row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).not.toBeNull()
    expect(row.error).toBeNull()
  })

  it('filtro pelo aluno do caso: aviso de OUTRO aluno não é enviado nem contado', async () => {
    const mine = await createStudentWithLogin()
    const other = await createStudentWithLogin()
    const mineRow = await seedOutboxRow({ studentId: mine.studentId, profileId: mine.profileId })
    const otherRow = await seedOutboxRow({ studentId: other.studentId, profileId: other.profileId })

    try {
      const box = collectingSend()
      const r = await dispatchOutbox(service, { email: { send: box.send } }, { today: TODAY, limit: 5000, keyLike: keyDoAluno(mine.studentId) })
      expect(r.processed).toBe(1)
      expect(r.sent).toBe(1)
      expect(box.sent.map((e) => e.to)).toEqual([mine.email])

      const [mineAfter] = await sql`select sent_at from notification_outbox where id = ${mineRow}`
      expect(mineAfter.sent_at).not.toBeNull()
      const [otherAfter] = await sql`select sent_at, error from notification_outbox where id = ${otherRow}`
      expect(otherAfter.sent_at).toBeNull() // intocada pela rodada do outro aluno
      expect(otherAfter.error).toBeNull()
    } finally {
      // higiene (mesmo se uma asserção falhar): a linha semeada aqui sai da fila
      // para as DEMAIS rodadas da suíte, como "resolvida sem envio" (sent_at +
      // motivo em error, a mesma convenção da varredura do beforeAll)
      await sql`update notification_outbox
                   set sent_at = now(),
                       error = 'higiene: fixture do teste de filtro, não enviada'
                 where id = ${otherRow}`
    }
  })
})

describe('M3: resolução tardia e aviso obsoleto (adendos do gate M0)', () => {
  it('aluno sem login → error, nada enviado; vincular profile depois → enviado 1× (caso 20)', async () => {
    const studentId = await createStudent(sql)
    const rowId = await seedOutboxRow({ studentId, profileId: null })

    const box = collectingSend()
    await dispatchOutbox(service, { email: { send: box.send } }, { today: TODAY, limit: 5000, keyLike: keyDoAluno(studentId) })
    let [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).toBeNull()
    expect(row.error).toBe('aluno sem login')
    // (sem asserção global de box.sent: rodadas paralelas de outros arquivos podem
    // ter linhas elegíveis — o pino é o ESTADO da NOSSA linha)

    // Convite sai (D6/F2): o profile nasce e a PRÓXIMA rodada resolve sozinha.
    const email = `m3-late-${crypto.randomUUID().slice(0, 8)}@bancada.dev`
    const { data } = await service.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { role: 'student' },
      user_metadata: { first_name: 'Tardia' },
    })
    // A6/i: nasce com número, vincula, e limpa (o estado aceito — ver o helper acima).
    await sql`insert into profiles (id, role, full_name, whatsapp_e164)
              values (${data!.user!.id}, 'student', 'Tardia M3', '+5565900081003')`
    await sql`update students set profile_id = ${data!.user!.id} where id = ${studentId}`
    await sql`update profiles set whatsapp_e164 = null where id = ${data!.user!.id}`

    const box2 = collectingSend()
    await dispatchOutbox(service, { email: { send: box2.send } }, { today: TODAY, limit: 5000, keyLike: keyDoAluno(studentId) })
    expect(box2.sent.filter((e) => e.to === email)).toHaveLength(1)
    ;[row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).not.toBeNull()
  })

  it('crédito expirado ANTES do envio → resolvido com error, NUNCA enviado (adendo 7)', async () => {
    const { studentId, profileId, email } = await createStudentWithLogin()
    const rowId = await seedOutboxRow({ studentId, profileId, expiresOn: daysFromToday(-1) }) // < TODAY

    const box = collectingSend()
    await dispatchOutbox(service, { email: { send: box.send } }, { today: TODAY, limit: 5000, keyLike: keyDoAluno(studentId) })
    const [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).not.toBeNull() // resolvida — sai da fila
    expect(row.error).toBe('crédito expirado antes do envio')
    expect(box.sent.filter((e) => e.to === email)).toHaveLength(0)

    // No PRÓPRIO dia do vencimento ainda vale (regra do <, não <=).
    const { studentId: s2, profileId: p2, email: email2 } = await createStudentWithLogin()
    await seedOutboxRow({ studentId: s2, profileId: p2, expiresOn: TODAY })
    const box2 = collectingSend()
    await dispatchOutbox(service, { email: { send: box2.send } }, { today: TODAY, limit: 5000, keyLike: keyDoAluno(s2) })
    expect(box2.sent.filter((e) => e.to === email2)).toHaveLength(1)
  })
})

describe('M3: gate do proxy (caso 25 — pino do caminho EXATO)', () => {
  it('/api/jobs/dispatch-outbox é público; qualquer outra rota de job NÃO é', () => {
    expect(resolveAccess(null, '/api/jobs/dispatch-outbox')).toEqual({ kind: 'allow' })
    expect(resolveAccess(null, '/api/jobs/generate-content')).toEqual({ kind: 'allow' })
    expect(resolveAccess(null, '/api/jobs/qualquer-outra')).toEqual({
      kind: 'redirect',
      to: '/login',
    })
    expect(isPublicPath('/api/jobs')).toBe(false)
  })
})

describe('caso 25 (metade da rota): 401 fail-closed do handleDispatchOutbox', () => {
  it('token nulo / errado / env ausente → 401; nada enviado, nada marcado', async () => {
    const { studentId, profileId } = await createStudentWithLogin()
    const rowId = await seedOutboxRow({ studentId, profileId })

    const box = collectingSend()
    const channels = { email: { send: box.send } }
    const cases: Array<[string | null, string | undefined]> = [
      [null, 'segredo-32-chars-de-teste-do-caso-25'], // sem token
      ['errado', 'segredo-32-chars-de-teste-do-caso-25'], // token errado
      ['segredo-32-chars-de-teste-do-caso-25', undefined], // sem env → INOPERANTE (fail-closed)
    ]
    for (const [token, expectedToken] of cases) {
      const res = await handleDispatchOutbox(service, { token, expectedToken, channels })
      expect(res.status).toBe(401)
      expect(res.body).toEqual({ ok: false, detail: 'token inválido' })
    }
    expect(box.sent).toHaveLength(0) // nada enviado
    const [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).toBeNull() // nada marcado
    expect(row.error).toBeNull()
  })

  it('token correto → 200 com contagens e despacho ocorrendo', async () => {
    const { studentId, profileId, email } = await createStudentWithLogin()
    const rowId = await seedOutboxRow({ studentId, profileId })

    // Sem o filtro, o handler despacharia a fila inteira — inclusive os avisos
    // que outros arquivos da suíte semeiam em paralelo, que ficariam marcados
    // como enviados antes de o próprio dono conferir. A chave carrega o aluno
    // deste teste, então o filtro alcança só a linha semeada aqui.
    const box = collectingSend()
    const res = await handleDispatchOutbox(service, {
      token: 'segredo-32-chars-de-teste-do-caso-25',
      expectedToken: 'segredo-32-chars-de-teste-do-caso-25',
      channels: { email: { send: box.send } },
      keyLike: `credit-expiry:%:${studentId}:%`,
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.processed).toBe(1)
    expect(box.sent).toHaveLength(1)
    expect(box.sent[0].to).toBe(email)
    const [row] = await sql`select sent_at from notification_outbox where id = ${rowId}`
    expect(row.sent_at).not.toBeNull()
  })

  it('pino de fonte: a rota fina usa o header/env exatos e o núcleo extraído', async () => {
    // O NOME do header e da env vivem só no wrapper (não atravessam o Vitest);
    // este pino fecha a fresta sem servidor HTTP (molde do pino do caso 24).
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/app/api/jobs/dispatch-outbox/route.ts', 'utf8'),
    )
    expect(src).toContain("request.headers.get('outbox-dispatch-token')")
    expect(src).toContain('process.env.OUTBOX_DISPATCH_TOKEN')
    expect(src).toContain('handleDispatchOutbox')
  })
})

describe('M3: template do e-mail 5 (texto aprovado §5)', () => {
  it('singular/plural, data formatada e link do portal', () => {
    const one = creditExpiryEmail({ firstName: 'Joana', nCredits: 1, expiresOn: '2026-10-31' })
    expect(one.subject).toBe('Você tem 1 aula de reposição vencendo em 31/10/2026')
    expect(one.html).toContain('vence em <strong>31/10/2026</strong>')
    const many = creditExpiryEmail({ firstName: 'Joana', nCredits: 3, expiresOn: '2026-10-31' })
    expect(many.subject).toContain('3 aulas')
    expect(many.html).toContain('vencem')
    expect(many.html).toContain('https://app.personal-teacher.com/portal')
    expect(many.html).toContain('Equipe Personal Teacher')
  })

  it('firstName (user_metadata, editável pelo aluno) sai ESCAPADO no HTML (painel final)', () => {
    const evil = creditExpiryEmail({
      firstName: '<a href="https://mal.example">Oi</a>',
      nCredits: 1,
      expiresOn: '2026-10-31',
    })
    expect(evil.html).not.toContain('<a href="https://mal.example"')
    expect(evil.html).toContain('&lt;a href=&quot;https://mal.example&quot;&gt;Oi&lt;/a&gt;')
    // O link legítimo do template continua intacto.
    expect(evil.html).toContain('href="https://app.personal-teacher.com/portal"')
  })
})


// Silêncio 21h–8h LOCAL (F6/M8-1): estes testes validam ENVIO, não a janela —
// injetam um 'agora' diurno (15h UTC = 11h Cuiabá) para rodarem a qualquer hora.
const DAYTIME = new Date(new Date().setUTCHours(15, 0, 0, 0))

describe('M5: canal WhatsApp (ADR-016) no despachante', () => {
  async function seedWaRow(studentId: string, profileId: string): Promise<string> {
    const [row] = await sql`
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values ('whatsapp', 'credit-expiry', ${profileId},
              ${sql.json({ student_id: studentId, expires_on: daysFromToday(30), marco: 30, n_credits: 1 })},
              ${'wa-test:' + crypto.randomUUID()})
      returning id`
    return row.id as string
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

  it('opt-in + telefone → envia TEXTO para o número; marca sent_at', async () => {
    const { studentId, profileId } = await createStudentWithLogin()
    await sql`update profiles set whatsapp_e164 = '+5565900090111'
              where id = ${profileId}`
    const rowId = await seedWaRow(studentId, profileId)

    const wa = collectingWa()
    await dispatchOutbox(service, { whatsapp: wa.channel }, { today: TODAY, limit: 5000, keyLike: 'wa-test:%', now: DAYTIME })
    const mine = wa.sent.filter((m) => m.to === '+5565900090111')
    expect(mine).toHaveLength(1)
    expect(mine[0].text).toContain('*1 crédito de reposição*')
    expect(mine[0].text).toContain(BR(daysFromToday(30)))
    expect(mine[0].text).toContain('/portal')

    const [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).not.toBeNull()
  })

  // F6/P9 (decisão M4-3 vigora): TEM NÚMERO → recebe — o opt-in booleano saiu
  // do caminho de envio (a F7 dropa a coluna e o consentimento vira contratual).
  it('M4-3/P9: com número cadastrado o aviso SAI, mesmo com o antigo opt-in falso', async () => {
    const { studentId, profileId } = await createStudentWithLogin()
    await sql`update profiles set whatsapp_e164 = '+5565900090222'
              where id = ${profileId}`
    const rowId = await seedWaRow(studentId, profileId)

    const wa = collectingWa()
    await dispatchOutbox(service, { whatsapp: wa.channel }, { today: TODAY, limit: 5000, keyLike: 'wa-test:%', now: DAYTIME })
    expect(wa.sent.filter((m) => m.to === '+5565900090222')).toHaveLength(1)
    const [row] = await sql`select sent_at from notification_outbox where id = ${rowId}`
    expect(row.sent_at).not.toBeNull()
  })

  it('SEM número → pendente com erro (número entra no cadastro; retry natural)', async () => {
    const { studentId, profileId } = await createStudentWithLogin()
    await sql`update profiles set whatsapp_e164 = null
              where id = ${profileId}`
    const rowId = await seedWaRow(studentId, profileId)

    const wa = collectingWa()
    await dispatchOutbox(service, { whatsapp: wa.channel }, { today: TODAY, limit: 5000, keyLike: 'wa-test:%', now: DAYTIME })
    const [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).toBeNull()
    expect(row.error).toMatch(/sem número/)
  })

  it('canal sem driver configurado → pendente com erro claro (nunca perda silenciosa)', async () => {
    const { studentId, profileId } = await createStudentWithLogin()
    const rowId = await seedWaRow(studentId, profileId)
    await dispatchOutbox(service, { email: { send: async () => ({ ok: true as const }) } }, { today: TODAY, limit: 5000, keyLike: 'wa-test:%' })
    const [row] = await sql`select sent_at, error from notification_outbox where id = ${rowId}`
    expect(row.sent_at).toBeNull()
    expect(row.error).toMatch(/sem driver/)
  })

  it("driver Evolution normaliza '+5565...' para dígitos no envio (defesa em profundidade)", async () => {
    // Formato canônico de ARMAZENAMENTO = E.164 com '+' (profiles.whatsapp_e164);
    // a Evolution espera dígitos com DDI — o driver faz o strip no envio.
    const calls: unknown[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)).number)
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    try {
      const channel = evolutionChannel({ url: 'http://evo.local', apiKey: 'k', instance: 'personal-teacher' })
      const outcome = await channel.send({ to: '+5565900090111', text: 'oi' })
      expect(outcome.ok).toBe(true)
      expect(calls).toEqual(['5565900090111'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('painel final: template sem handler e driver que lança', () => {
  it('template sem handler → PENDENTE com erro claro; a rodada pós-deploy recupera sozinha', async () => {
    // Espelho do teste "canal sem driver": um enqueue de template novo deployado
    // antes do app com o case NUNCA é perdido (antes: resolvido para sempre).
    const { studentId, profileId } = await createStudentWithLogin()
    const [seeded] = await sql`
      insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
      values ('template-de-fase-futura', ${profileId},
              ${sql.json({ student_id: studentId })}, ${'tpl-novo:' + crypto.randomUUID()})
      returning id`
    const box = collectingSend()
    await dispatchOutbox(service, { email: { send: box.send } }, { today: TODAY, limit: 5000, keyLike: 'tpl-novo:%' })
    const [row] = await sql`select sent_at, error from notification_outbox where id = ${seeded.id}`
    expect(row.sent_at).toBeNull() // pendente — nunca "resolvida" em silêncio
    expect(row.error).toMatch(/sem handler/)
    // higiene: resolve a linha para as DEMAIS rodadas da suíte não a reprocessarem
    await sql`update notification_outbox set sent_at = now() where id = ${seeded.id}`
  })

  it('driver que LANÇA (timeout/ECONNREFUSED) → error gravado, sent_at NULL, rodada segue', async () => {
    // Dois avisos do MESMO aluno, cada um com o próprio contrato: fixture possível
    // no domínio, e o filtro pelo aluno alcança as duas linhas do caso e nenhuma
    // de outro arquivo da suíte.
    const a = await createStudentWithLogin()
    const rowA = await seedOutboxRow({ studentId: a.studentId, profileId: a.profileId })
    const rowB = await seedOutboxRow({ studentId: a.studentId, profileId: a.profileId })

    const throwing = {
      send: async (): Promise<SendOutcome> => {
        throw new Error('ECONNREFUSED simulado')
      },
    }
    const result = await dispatchOutbox(service, { email: throwing }, { today: TODAY, limit: 5000, keyLike: keyDoAluno(a.studentId) })
    expect(result.processed).toBeGreaterThanOrEqual(2) // a exceção não derrubou a rodada
    for (const id of [rowA, rowB]) {
      const [row] = await sql`select sent_at, error from notification_outbox where id = ${id}`
      expect(row.sent_at).toBeNull() // retry natural na próxima rodada
      expect(row.error).toContain('ECONNREFUSED simulado')
    }
  })
})
