// Fase 3 / M0 — enqueue_credit_expiry_notices (F3-D4): janela 30/15 auto-recuperável,
// dedupe POR DESTINATÁRIO, P2 (um e-mail no marco duplo), FIFO = régua do
// makeup_balance, business_today injetável. Casos 15–24 do goal (parte de banco).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createStudent, createTeacher, daysFromToday } from './helpers/db'

const service = serviceClient()

let sql: Sql
beforeAll(() => {
  sql = connect(2)
})
afterAll(async () => {
  await sql.end()
})

// Retomada 01/09/2026 — a data cravada em julho APODRECEU: o `p_today` injetado
// controla a aritmética do enfileiramento, mas a FIFO por baixo
// (`makeup_remaining_expiries`) lê `business_today()` de verdade. Com o relógio
// real em setembro, um crédito "que vence em 20 dias" a partir de 20/07 já
// estava vencido para a FIFO e o gasto não o consumia — o caso 16 passou a
// ver um aviso. A data agora acompanha o dia do NEGÓCIO (Cuiabá, o mesmo do
// banco) — a armadilha das 20h–24h de Cuiabá é a de `daysFromToday`.
const TODAY = daysFromToday(0) // p_today injetado, ancorado no dia do negócio

function plusDays(base: string, days: number): string {
  const d = new Date(base + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function createContractWithCredit(opts: {
  expiresInDays: number | null
  today?: string
}): Promise<{ contractId: string; studentId: string }> {
  const studentId = await createStudent(sql)
  const teacherId = await createTeacher(sql)
  const [c] = await sql`
    insert into contracts
      (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents, status,
       monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
    values ('private_1on1', ${studentId}, ${teacherId}, 'F3 outbox', 10000, 'active',
            4, 24, 90, '2026-01-05')
    returning id`
  if (opts.expiresInDays !== null) {
    await sql`
      insert into makeup_ledger (contract_id, delta, reason, expires_on)
      values (${c.id}, 1, 'manual_adjust', ${plusDays(opts.today ?? TODAY, opts.expiresInDays)})`
  }
  return { contractId: c.id as string, studentId }
}

async function outboxRows(contractId: string) {
  return sql`
    select dedupe_key, sent_at, error, recipient_profile_id,
           (payload->>'marco')::int as marco, payload->>'expires_on' as expires_on
    from notification_outbox
    where payload->>'contract_id' = ${contractId}
    order by (payload->>'marco')::int`
}

async function enqueue(today = TODAY): Promise<number> {
  const [r] = await sql`select public.enqueue_credit_expiry_notices(${today}) as n`
  return r.n as number
}

describe('F3-D4: janela 30/15 auto-recuperável', () => {
  it('crédito a 29 dias → UM aviso real (marco 30); reexecução não duplica (casos 15/21)', async () => {
    const { contractId } = await createContractWithCredit({ expiresInDays: 29 })
    await enqueue()
    let rows = await outboxRows(contractId)
    expect(rows).toHaveLength(1)
    expect(rows[0].marco).toBe(30)
    expect(rows[0].sent_at).toBeNull()

    await enqueue() // mesma data: dedupe segura
    rows = await outboxRows(contractId)
    expect(rows).toHaveLength(1)
  })

  it('crédito a 10 dias → marco 15 real + marco 30 já COBERTO (P2: um e-mail só)', async () => {
    const { contractId } = await createContractWithCredit({ expiresInDays: 10 })
    await enqueue()
    const rows = await outboxRows(contractId)
    expect(rows).toHaveLength(2)
    const m15 = rows.find((r) => r.marco === 15)!
    const m30 = rows.find((r) => r.marco === 30)!
    expect(m15.sent_at).toBeNull() // a enviar
    expect(m30.sent_at).not.toBeNull() // coberto — o despachante nunca o pega
  })

  it('progressão 29d → 14d: o marco 15 nasce depois sem repetir o 30 (caso 21/23)', async () => {
    const { contractId } = await createContractWithCredit({ expiresInDays: 29 })
    await enqueue() // marco 30
    await enqueue(plusDays(TODAY, 15)) // agora faltam 14 dias → marco 15
    const rows = await outboxRows(contractId)
    expect(rows.map((r) => r.marco).sort()).toEqual([15, 30])
    expect(rows.filter((r) => r.sent_at === null)).toHaveLength(2) // ambos reais
  })

  it('run perdido se recupera: marco cruzado há 2 dias ainda gera o aviso (caso 23)', async () => {
    const { contractId } = await createContractWithCredit({ expiresInDays: 28 })
    // ninguém rodou no dia 30-28... roda só "hoje+2" (crédito a 26 dias do fim)
    await enqueue(plusDays(TODAY, 2))
    const rows = await outboxRows(contractId)
    expect(rows).toHaveLength(1)
    expect(rows[0].marco).toBe(30)
  })

  it('fora da janela (31 dias), expirado e sem validade (infinity): nada (caso 16 parcial)', async () => {
    const fora = await createContractWithCredit({ expiresInDays: 31 })
    const expirado = await createContractWithCredit({ expiresInDays: -1 })
    const semValidade = await createContractWithCredit({ expiresInDays: null })
    await sql`insert into makeup_ledger (contract_id, delta, reason)
              values (${semValidade.contractId}, 1, 'manual_adjust')`
    await enqueue()
    expect(await outboxRows(fora.contractId)).toHaveLength(0)
    expect(await outboxRows(expirado.contractId)).toHaveLength(0)
    expect(await outboxRows(semValidade.contractId)).toHaveLength(0)
  })
})

describe('F3-D4: FIFO = régua exata do makeup_balance', () => {
  it('crédito já GASTO não avisa (caso 16)', async () => {
    const { contractId } = await createContractWithCredit({ expiresInDays: 20 })
    await sql`insert into makeup_ledger (contract_id, delta, reason)
              values (${contractId}, -1, 'spend_reschedule')`
    await enqueue()
    expect(await outboxRows(contractId)).toHaveLength(0)
  })

  it('A expira sem uso; gasto posterior consome B — sem aviso falso sobre B (caso 17)', async () => {
    const { contractId } = await createContractWithCredit({ expiresInDays: null })
    // A: expirou em 10/07 (antes de TODAY=20/07). B: expira a 25 dias de TODAY.
    await sql`insert into makeup_ledger (contract_id, delta, reason, expires_on, created_at)
              values (${contractId}, 1, 'manual_adjust', '2026-07-10', '2026-06-01T12:00:00Z')`
    await sql`insert into makeup_ledger (contract_id, delta, reason, expires_on, created_at)
              values (${contractId}, 1, 'manual_adjust', ${plusDays(TODAY, 25)}, '2026-06-02T12:00:00Z')`
    // Gasto em 12/07: A já estava expirada → makeup_balance consome B.
    await sql`insert into makeup_ledger (contract_id, delta, reason, created_at)
              values (${contractId}, -1, 'spend_reschedule', '2026-07-12T12:00:00Z')`

    const [{ balance }] = await sql`
      select public.makeup_balance(${contractId}) as balance`
    expect(Number(balance)).toBe(0) // pino: a régua oficial diz zero

    await enqueue()
    expect(await outboxRows(contractId)).toHaveLength(0) // replay ingênuo avisaria B
  })
})

describe('F3-D4: destinatários', () => {
  it('casal: exatamente UMA linha por MEMBRO; membro sem login = recipient NULL (casos 18–20)', async () => {
    const teacherId = await createTeacher(sql)
    const s1 = await createStudent(sql)
    const s2 = await createStudent(sql)
    const [g] = await sql`insert into student_groups (label) values ('Casal F3') returning id`
    await sql`insert into student_group_members (group_id, student_id)
              values (${g.id}, ${s1}), (${g.id}, ${s2})`
    // s1 COM login; s2 sem (profile_id NULL). Usuário via admin API (nunca INSERT
    // cru em auth.users — quebra o listUsers do GoTrue para os demais testes).
    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email: `f3-casal-${crypto.randomUUID().slice(0, 8)}@bancada.dev`,
      email_confirm: true,
      app_metadata: { role: 'student' },
    })
    expect(createErr).toBeNull()
    const uid = created!.user!.id
    // A6/i: nasce com número, vincula, e limpa — o estado ACEITO (legado/limpeza
    // do admin), que é o que esta fixture representa.
    await sql`insert into profiles (id, role, full_name, whatsapp_e164)
              values (${uid}, 'student', 'Membro F3', '+5565900080028')`
    await sql`update students set profile_id = ${uid} where id = ${s1}`
    await sql`update profiles set whatsapp_e164 = null where id = ${uid}`

    const [c] = await sql`
      insert into contracts
        (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents, status,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${g.id}, ${teacherId}, 'F3 casal', 10000, 'active',
              4, 24, 90, '2026-01-05')
      returning id`
    await sql`insert into makeup_ledger (contract_id, delta, reason, expires_on)
              values (${c.id}, 1, 'manual_adjust', ${plusDays(TODAY, 20)})`

    await enqueue()
    const rows = await outboxRows(c.id)
    expect(rows).toHaveLength(2) // um por membro (dedupe POR DESTINATÁRIO)
    const withLogin = rows.filter((r) => r.recipient_profile_id !== null)
    const withoutLogin = rows.filter((r) => r.recipient_profile_id === null)
    expect(withLogin).toHaveLength(1)
    expect(withoutLogin).toHaveLength(1) // linha existe MESMO sem login (rastro)

    await enqueue()
    expect(await outboxRows(c.id)).toHaveLength(2) // idempotente por membro
  })

  it('contrato inativo não gera aviso', async () => {
    const { contractId } = await createContractWithCredit({ expiresInDays: 10 })
    await sql`update contracts set status = 'ended' where id = ${contractId}`
    await enqueue()
    expect(await outboxRows(contractId)).toHaveLength(0)
  })
})

describe('F3-D4: job pg_cron', () => {
  it('pino do agendamento diário (padrão de materialize.test.ts): nome, horário e comando', async () => {
    // Um typo no cron.schedule deixaria o e-mail 5 morto em produção com a suíte verde.
    const jobs = await sql`
      select schedule, command from cron.job where jobname = 'enqueue-credit-expiry-daily'`
    expect(jobs).toHaveLength(1)
    expect(jobs[0].schedule).toBe('0 10 * * *')
    expect(jobs[0].command).toContain('enqueue_credit_expiry_notices')
  })
})

describe('F3-D4: aritmética de dia', () => {
  it('pino: default do argumento = business_today(); corpo sem current_date (caso 24)', async () => {
    // O corpo usa p_today em TODA a aritmética; business_today() vive no DEFAULT
    // do argumento (é assim que os testes injetam a data sem simular relógio).
    const [{ args, src }] = await sql`
      select pg_get_function_arguments(oid) as args, prosrc as src
      from pg_proc where proname = 'enqueue_credit_expiry_notices'`
    expect(args).toMatch(/business_today/)
    expect(src).not.toMatch(/current_date/)
    expect(src).not.toMatch(/now\(\)::date/)
  })
})


describe('adendo 4 do gate M0: RLS de notification_outbox (pino positivo E negativo)', () => {
  it('admin LÊ (a /admin/avisos depende disso); demais papéis veem zero; escrita de cliente negada', async () => {
    // Fixture via enqueue (nenhum cliente PostgREST consegue inserir).
    const { contractId } = await createContractWithCredit({ expiresInDays: 22 })
    await enqueue()
    const [seeded] = await sql`
      select dedupe_key from notification_outbox
      where payload->>'contract_id' = ${contractId} limit 1`
    expect(seeded).toBeDefined()

    const adminUser = await createAuthUser(sql, 'admin', 'Admin RLS outbox')
    const admin = await clientAs(adminUser, 'admin')
    // Positivo: policy quebrada = /admin/avisos vazia em silêncio.
    const mine = await admin
      .from('notification_outbox')
      .select('id, dedupe_key, error')
      .eq('dedupe_key', seeded.dedupe_key as string)
    expect(mine.error).toBeNull()
    expect(mine.data).toHaveLength(1)

    // Negativo: o payload carrega dados de crédito de OUTROS alunos.
    for (const role of ['student', 'teacher', 'sales'] as const) {
      const client = await clientAs(adminUser, role)
      const { data, error } = await client.from('notification_outbox').select('*').limit(5)
      expect(error).toBeNull()
      expect(data).toEqual([])
    }

    // Escrita: read-only até para admin ("escrita NUNCA" do adendo 4) — sem GRANT.
    const write = await admin.from('notification_outbox').insert({
      template: 'credit-expiry',
      payload: {},
      dedupe_key: 'rls-pin:' + crypto.randomUUID(),
    })
    expect(write.error?.code).toBe('42501')
  })
})

describe('F3-D8/ADR-016 + F7/M4-3: enqueue gera linha de WhatsApp para quem TEM NÚMERO', () => {
  it('com número → linhas email E whatsapp (dedupe por canal); sem login/número → só email', async () => {
    const optin = await createContractWithCredit({ expiresInDays: 20 })
    const { data: u } = await service.auth.admin.createUser({
      email: `f3wa-${crypto.randomUUID().slice(0, 8)}@bancada.dev`,
      email_confirm: true,
      app_metadata: { role: 'student' },
    })
    await sql`insert into profiles (id, role, full_name, whatsapp_e164)
              values (${u!.user!.id}, 'student', 'WA F3', '+5565900090029')`
    await sql`update students set profile_id = ${u!.user!.id} where id = ${optin.studentId}`

    const semOptin = await createContractWithCredit({ expiresInDays: 20 })

    await enqueue()
    const optinRows = await sql`
      select channel from notification_outbox
      where payload->>'contract_id' = ${optin.contractId} order by channel`
    expect(optinRows.map((r) => r.channel)).toEqual(['email', 'whatsapp'])
    const semRows = await sql`
      select channel from notification_outbox
      where payload->>'contract_id' = ${semOptin.contractId}`
    expect(semRows.map((r) => r.channel)).toEqual(['email'])

    await enqueue() // idempotente por canal
    const again = await sql`
      select count(*)::int as n from notification_outbox
      where payload->>'contract_id' = ${optin.contractId}`
    expect(again[0].n).toBe(2)
  })
})
