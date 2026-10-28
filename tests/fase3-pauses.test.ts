// Fase 3 / M0 — F3-D10: crédito PAUSA junto com o contrato (decisão do mantenedor no
// gate M0, 12/07/2026). pause_contract/resume_contract + congelamento da validade.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createSlot, createStudent, createTeacher, daysFromToday } from './helpers/db'

let sql: Sql
let adminUser: string

beforeAll(async () => {
  sql = connect(2)
  adminUser = await createAuthUser(sql, 'admin', 'Admin F3 pausas')
})
afterAll(async () => {
  await sql.end()
})

// TODAY dinâmico (data civil do NEGÓCIO, Cuiabá). Era '2026-07-20' cravado e
// virou bomba-relógio em 02/08/2026: no caso FIFO, o crédito A estendido vence
// em TODAY+12 = 01/08, e `makeup_balance()` — a única leitura do arquivo que
// usa o relógio REAL (`business_today()`) — passou a vê-lo morto. Todos os
// demais usos são relativos (p_today explícito; `remaining()` filtra pelo
// próprio TODAY), então a data dinâmica preserva exatamente as contas. Mesma
// classe do flake de borda de mês do makeup.test, morto no A1.
const TODAY = daysFromToday(0)

function plusDays(base: string, days: number): string {
  const d = new Date(base + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function newContract(): Promise<string> {
  const studentId = await createStudent(sql)
  const teacherId = await createTeacher(sql)
  const [c] = await sql`
    insert into contracts
      (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents, status,
       monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
    values ('private_1on1', ${studentId}, ${teacherId}, 'F3 pausa', 10000, 'active',
            4, 24, 90, '2026-01-05')
    returning id`
  return c.id as string
}

async function addCredit(contractId: string, expiresOn: string | null) {
  await sql`insert into makeup_ledger (contract_id, delta, reason, expires_on)
            values (${contractId}, 1, 'manual_adjust', ${expiresOn})`
}

/**
 * Crédito concedido numa DATA CIVIL escolhida (A6 · lote 3, 30/07/2026).
 *
 * Por que este helper passou a existir: a extensão do congelamento é
 * `p_today − greatest(paused_on, dia civil da concessão)`. Quem quer dizer
 * "crédito que já existia quando a pausa começou" precisa de um `created_at`
 * ANTERIOR a `paused_on` — antes bastava a ordem de INSERÇÃO das linhas, porque
 * a régua velha comparava `makeup_ledger.created_at` com
 * `contract_pauses.created_at` (dois carimbos de "agora", nesta ordem), e não
 * com `paused_on`. Com a pausa retroagida por fixture, os dois jeitos deixaram
 * de coincidir — e quem tem razão é a data civil: crédito criado depois do
 * início da pausa é, por definição, crédito nascido na pausa.
 *
 * INSERT com `created_at` explícito é legítimo: o ledger é append-only
 * (`makeup_ledger_append_only` proíbe UPDATE/DELETE), não insert-restrito.
 */
async function addCreditOn(contractId: string, expiresOn: string | null, concedidoEm: string) {
  await sql`insert into makeup_ledger (contract_id, delta, reason, expires_on, created_at)
            values (${contractId}, 1, 'manual_adjust', ${expiresOn},
                    ${concedidoEm + 'T12:00:00Z'}::timestamptz)`
}

/** Pausa com data retroativa (injeção de relógio via tabela, não via now()). */
async function pauseBackdated(contractId: string, pausedOn: string) {
  await sql`update contracts set status = 'paused' where id = ${contractId}`
  await sql`insert into contract_pauses (contract_id, paused_on) values (${contractId}, ${pausedOn})`
}

async function remaining(contractId: string): Promise<string[]> {
  const rows = await sql`
    select e::text as e from public.makeup_remaining_expiries(${contractId}) e
    where e >= ${TODAY}::date order by e`
  return rows.map((r) => r.e as string)
}

describe('F3-D10: pause_contract / resume_contract (posse e transições)', () => {
  it('admin pausa (status + registro + auditoria); pausar de novo → exceção', async () => {
    const contractId = await newContract()
    const admin = await clientAs(adminUser, 'admin')

    const { error } = await admin.rpc('pause_contract', { p_contract: contractId })
    expect(error).toBeNull()
    const [c] = await sql`select status from contracts where id = ${contractId}`
    expect(c.status).toBe('paused')
    const [{ count }] = await sql`
      select count(*)::int as count from contract_pauses
      where contract_id = ${contractId} and resumed_on is null`
    expect(count).toBe(1)
    const [audit] = await sql`
      select 1 from audit_log where action = 'pause_contract' and entity_id = ${contractId}`
    expect(audit).toBeDefined()

    const again = await admin.rpc('pause_contract', { p_contract: contractId })
    expect(again.error?.message).toMatch(/não está ativo/)
  })

  it('teacher/student/sales não pausam nem retomam (D10)', async () => {
    const contractId = await newContract()
    for (const role of ['teacher', 'student', 'sales'] as const) {
      const client = await clientAs(adminUser, role) // papel no JWT decide, não o user
      const p = await client.rpc('pause_contract', { p_contract: contractId })
      expect(p.error?.message).toMatch(/restrita à admin/)
      const r = await client.rpc('resume_contract', { p_contract: contractId })
      expect(r.error?.message).toMatch(/restrita à admin/)
    }
  })

  it('retomar contrato ativo → exceção; pausado sem registro → exceção clara', async () => {
    const contractId = await newContract()
    const admin = await clientAs(adminUser, 'admin')
    const active = await admin.rpc('resume_contract', { p_contract: contractId })
    expect(active.error?.message).toMatch(/não está pausado/)

    await sql`update contracts set status = 'paused' where id = ${contractId}`
    const orphan = await admin.rpc('resume_contract', { p_contract: contractId })
    expect(orphan.error?.message).toMatch(/sem registro de pausa/)
  })
})

// A6 · LOTE 3 (decisão do dono, 30/07/2026): o congelamento deixou de ter
// buraco. A extensão da retomada virou UMA fórmula —
// `p_today − greatest(paused_on, dia civil da concessão)` — aplicada a TODO
// crédito parado, e não mais só ao que nasceu antes da pausa.
//
// O que isso fez com os casos abaixo: eles continuam afirmando exatamente os
// mesmos NÚMEROS, porque para crédito pré-pausa a fórmula devolve `p_today −
// paused_on`, que é a conta histórica. O que mudou foram as FIXTURES: dizer
// "crédito que já existia quando a pausa começou" agora exige `created_at`
// anterior a `paused_on` (helper `addCreditOn`), e não mais a mera ordem de
// inserção das linhas. Fixture que inseria o crédito "agora" com a pausa
// retroagida descrevia, sem querer, um crédito nascido DENTRO da pausa.
describe('F3-D10: congelamento da validade', () => {
  it('crédito vivo na pausa e hoje → estendido pelos dias pausados (par −/+ FIFO)', async () => {
    const contractId = await newContract()
    await addCreditOn(contractId, plusDays(TODAY, 5), plusDays(TODAY, -20)) // vivo na pausa E hoje
    await pauseBackdated(contractId, plusDays(TODAY, -10)) // 10 dias pausado

    const admin = await clientAs(adminUser, 'admin')
    const { data: extended, error } = await admin.rpc('resume_contract', {
      p_contract: contractId,
      p_today: TODAY,
    })
    expect(error).toBeNull()
    expect(extended).toBe(1)

    expect(await remaining(contractId)).toEqual([plusDays(TODAY, 15)]) // +10 dias
    const [c] = await sql`select status from contracts where id = ${contractId}`
    expect(c.status).toBe('active')
    const [p] = await sql`
      select resumed_on::text from contract_pauses where contract_id = ${contractId}`
    expect(p.resumed_on).toBe(TODAY)
  })

  it('crédito que EXPIROU durante a pausa renasce estendido (o sentido do congelamento)', async () => {
    const contractId = await newContract()
    // concedido ANTES da pausa; morreu há 3 dias, com o contrato já parado
    await addCreditOn(contractId, plusDays(TODAY, -3), plusDays(TODAY, -20))
    await pauseBackdated(contractId, plusDays(TODAY, -10))

    expect(await remaining(contractId)).toEqual([]) // morto aos olhos da régua em TODAY

    const admin = await clientAs(adminUser, 'admin')
    await admin.rpc('resume_contract', { p_contract: contractId, p_today: TODAY })

    expect(await remaining(contractId)).toEqual([plusDays(TODAY, 7)]) // -3 +10 = +7
  })

  it('FIFO preservado com DOIS créditos (A cedo, B tarde): ambos deslocados, nada consumido errado', async () => {
    const contractId = await newContract()
    await addCreditOn(contractId, plusDays(TODAY, 2), plusDays(TODAY, -20)) // A
    await addCreditOn(contractId, plusDays(TODAY, 20), plusDays(TODAY, -20)) // B
    await pauseBackdated(contractId, plusDays(TODAY, -10))

    const admin = await clientAs(adminUser, 'admin')
    const { data: extended } = await admin.rpc('resume_contract', {
      p_contract: contractId,
      p_today: TODAY,
    })
    expect(extended).toBe(2)
    expect(await remaining(contractId)).toEqual([plusDays(TODAY, 12), plusDays(TODAY, 30)])
    const [{ balance }] = await sql`select public.makeup_balance(${contractId}) as balance`
    expect(Number(balance)).toBe(2)
  })

  it('crédito nascido ANTES da pausa e já morto no início dela NÃO renasce', async () => {
    const contractId = await newContract()
    await addCreditOn(contractId, plusDays(TODAY, -15), plusDays(TODAY, -30)) // morreu ANTES da pausa
    await pauseBackdated(contractId, plusDays(TODAY, -10))

    const admin = await clientAs(adminUser, 'admin')
    const { data: extended } = await admin.rpc('resume_contract', {
      p_contract: contractId,
      p_today: TODAY,
    })
    expect(extended).toBe(0)
    expect(await remaining(contractId)).toEqual([])
  })

  it('retomada no MESMO dia: sem lançamentos, só o flip de status', async () => {
    const contractId = await newContract()
    await addCreditOn(contractId, plusDays(TODAY, 5), plusDays(TODAY, -5))
    await pauseBackdated(contractId, TODAY)

    const admin = await clientAs(adminUser, 'admin')
    const { data: extended } = await admin.rpc('resume_contract', {
      p_contract: contractId,
      p_today: TODAY,
    })
    expect(extended).toBe(0)
    const [{ count }] = await sql`
      select count(*)::int as count from makeup_ledger
      where contract_id = ${contractId}`
    expect(count).toBe(1) // só o crédito original
  })

  // -------------------------------------------------------------------------
  // A6 · LOTE 3 — O IRMÃO QUE FALTAVA: crédito NASCIDO durante a pausa.
  //
  // Até 30/07/2026 este crédito era o furo declarado do congelamento: o filtro
  // `ml.created_at < v_pause.created_at` o excluía da compensação, e ele não
  // podia ser gasto (`spend_makeup` recusa contrato não-ativo), nem estendido à
  // mão (`admin_extend_credit` recusa pausado), nem avisado
  // (`enqueue_credit_expiry_notices` filtra 'active'). Vencia calado.
  //
  // Decisão do dono (30/07): a validade CONGELA na pausa, sem exceção. A conta
  // dele não é `p_today − paused_on` (isso seria devolver dias em que o crédito
  // nem existia): é `p_today − dia da concessão`.
  // -------------------------------------------------------------------------
  it('crédito NASCIDO na pausa é estendido pelos dias desde a CONCESSÃO, não desde a pausa', async () => {
    const contractId = await newContract()
    await pauseBackdated(contractId, plusDays(TODAY, -10))
    // a escola compensa uma aula devida a quem está parado, 4 dias atrás
    await addCreditOn(contractId, plusDays(TODAY, 2), plusDays(TODAY, -4))

    const admin = await clientAs(adminUser, 'admin')
    const { data: extended, error } = await admin.rpc('resume_contract', {
      p_contract: contractId,
      p_today: TODAY,
    })
    expect(error).toBeNull()
    expect(extended).toBe(1)
    // 4 dias parados DESDE A CONCESSÃO — não 10. Devolver 10 daria ao aluno
    // seis dias em que o crédito ainda não existia.
    expect(await remaining(contractId)).toEqual([plusDays(TODAY, 6)])
  })

  it('crédito NASCIDO na pausa que já venceu renasce estendido (sem débito, como o pré-pausa)', async () => {
    const contractId = await newContract()
    await pauseBackdated(contractId, plusDays(TODAY, -10))
    await addCreditOn(contractId, plusDays(TODAY, -1), plusDays(TODAY, -8))

    expect(await remaining(contractId)).toEqual([]) // morto aos olhos da régua em TODAY

    const admin = await clientAs(adminUser, 'admin')
    const { data: extended } = await admin.rpc('resume_contract', {
      p_contract: contractId,
      p_today: TODAY,
    })
    expect(extended).toBe(1)
    expect(await remaining(contractId)).toEqual([plusDays(TODAY, 7)]) // −1 + 8 = +7
  })

  it('pré-pausa e nascido-na-pausa na MESMA retomada: cada um com a sua conta', async () => {
    const contractId = await newContract()
    await addCreditOn(contractId, plusDays(TODAY, 5), plusDays(TODAY, -20)) // pré-pausa
    await pauseBackdated(contractId, plusDays(TODAY, -10))
    await addCreditOn(contractId, plusDays(TODAY, 30), plusDays(TODAY, -6)) // na pausa

    const admin = await clientAs(adminUser, 'admin')
    const { data: extended } = await admin.rpc('resume_contract', {
      p_contract: contractId,
      p_today: TODAY,
    })
    expect(extended).toBe(2)
    // +5 ganha 10 (dias parados) → +15 · +30 ganha 6 (dias desde a concessão) → +36
    expect(await remaining(contractId)).toEqual([plusDays(TODAY, 15), plusDays(TODAY, 36)])
  })

  it('crédito concedido no DIA da retomada não gera lançamento nenhum (extensão zero)', async () => {
    const contractId = await newContract()
    await pauseBackdated(contractId, plusDays(TODAY, -10))
    await addCreditOn(contractId, plusDays(TODAY, 20), TODAY)

    const admin = await clientAs(adminUser, 'admin')
    const { data: extended } = await admin.rpc('resume_contract', {
      p_contract: contractId,
      p_today: TODAY,
    })
    // Ele não perdeu dia nenhum — e o ledger não recebe par −1/+1 que não muda
    // nada. É também a trava aritmética contra a extensão DUPLA: o crédito que
    // a própria retomada emite nasce hoje, e hoje vale zero.
    expect(extended).toBe(0)
    const [{ count }] = await sql`
      select count(*)::int as count from makeup_ledger where contract_id = ${contractId}`
    expect(count).toBe(1)
    expect(await remaining(contractId)).toEqual([plusDays(TODAY, 20)])
  })
})

describe('F3-D10: enqueue silencia pausado (a decisão do e-mail 5)', () => {
  it('pausado com crédito na janela dos 30 dias → ZERO avisos; ended idem', async () => {
    const paused = await newContract()
    await addCredit(paused, plusDays(TODAY, 10))
    await pauseBackdated(paused, plusDays(TODAY, -1))

    const ended = await newContract()
    await addCredit(ended, plusDays(TODAY, 10))
    await sql`update contracts set status = 'ended' where id = ${ended}`

    await sql`select public.enqueue_credit_expiry_notices(${TODAY})`
    for (const id of [paused, ended]) {
      const rows = await sql`
        select 1 from notification_outbox where payload->>'contract_id' = ${id}`
      expect(rows).toHaveLength(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Painel final da Fase 3 — a retomada corrige a AGENDA (não só o ledger):
// cancela sem crédito as 'scheduled' da janela da pausa e re-materializa os
// slots vivos (pausa maior que o horizonte deixaria a agenda vazia até domingo).
// ---------------------------------------------------------------------------
describe('painel final: retomada corrige a agenda', () => {
  it('resume cancela SEM crédito as scheduled da janela; futuras ficam; ledger intocado', async () => {
    const contractId = await newContract()
    const [c] = await sql`select teacher_id from contracts where id = ${contractId}`
    const mkInstance = async (dayOffset: number): Promise<string> => {
      const date = plusDays(TODAY, dayOffset)
      const [r] = await sql`
        insert into class_instances (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
        values (${contractId}, ${c.teacher_id}, ${date + 'T16:00:00Z'}, ${date + 'T17:00:00Z'}, 'pausa f3')
        returning id`
      return r.id as string
    }
    const inWindow = await mkInstance(-3) // data civil dentro de [TODAY-10, TODAY)
    const afterResume = await mkInstance(3) // depois da retomada: intocada
    await pauseBackdated(contractId, plusDays(TODAY, -10))

    const admin = await clientAs(adminUser, 'admin')
    const { error } = await admin.rpc('resume_contract', { p_contract: contractId, p_today: TODAY })
    expect(error).toBeNull()

    const [inW] = await sql`select state from class_instances where id = ${inWindow}`
    expect(inW.state).toBe('cancelled')
    const [after] = await sql`select state from class_instances where id = ${afterResume}`
    expect(after.state).toBe('scheduled')

    // SEM crédito: cancelamento administrativo (padrão close_and_create_slot),
    // nunca a matriz D2 — o ledger permanece vazio.
    const [{ n }] = await sql`
      select count(*)::int as n from makeup_ledger where contract_id = ${contractId}`
    expect(n).toBe(0)

    // Lei 8: o audit da retomada vincula pausa → instâncias canceladas.
    const [audit] = await sql`
      select diff from audit_log
      where action = 'resume_contract' and entity_id = ${contractId}
      order by at desc limit 1`
    expect(audit.diff.aulas_canceladas_na_pausa).toContain(inWindow)
    expect(audit.diff.aulas_canceladas_na_pausa).not.toContain(afterResume)
  })

  it('pausa maior que o horizonte: resume re-materializa a agenda na MESMA chamada', async () => {
    const contractId = await newContract()
    const [c] = await sql`select teacher_id from contracts where id = ${contractId}`
    await createSlot(sql, { contractId, teacherId: c.teacher_id as string }, {
      weekday: 2, localTime: '10:00', tz: 'America/Cuiaba',
    })
    // Nenhuma instância existe (slot inserido direto; materialize pulou o contrato
    // pausado o tempo todo — o cenário real da viagem de 2–3 meses).
    await pauseBackdated(contractId, plusDays(TODAY, -100))

    const admin = await clientAs(adminUser, 'admin')
    const { error } = await admin.rpc('resume_contract', { p_contract: contractId, p_today: TODAY })
    expect(error).toBeNull()
    const [{ n }] = await sql`
      select count(*)::int as n from class_instances
      where contract_id = ${contractId} and state = 'scheduled' and starts_at_utc > now()`
    expect(n).toBeGreaterThan(0) // agenda voltou SEM esperar o cron de domingo
    const [audit] = await sql`
      select diff from audit_log
      where action = 'resume_contract' and entity_id = ${contractId}
      order by at desc limit 1`
    expect(Number(audit.diff.aulas_materializadas)).toBeGreaterThan(0)
  })
})

describe('F3-D10: RLS de contract_pauses', () => {
  it('não-admin lê zero linhas, sem erro', async () => {
    const contractId = await newContract()
    await pauseBackdated(contractId, TODAY)
    for (const role of ['student', 'teacher', 'sales'] as const) {
      const client = await clientAs(adminUser, role)
      const { data, error } = await client.from('contract_pauses').select('*').limit(5)
      expect(error).toBeNull()
      expect(data).toEqual([])
    }
  })
})
