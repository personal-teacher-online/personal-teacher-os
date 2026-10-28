import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { connect, createSession, monthsAgo } from './helpers/db'
import { anonClient, clientAs, createAuthUser } from './helpers/auth'

// Casos 10, 11, 12 e 26 do goal + verificações positivas (negar por padrão só vale
// se quem PODE ver continua vendo). Fixtures próprias com profiles/auth.users reais;
// os JWTs carregam app_metadata.role e passam pelo PostgREST (RLS de verdade).

let sql: Sql

// pessoas
let donaUser: string
let parceiraUser: string
let studentAUser: string
let studentBUser: string
let salesUser: string
let adminUser: string
let nataliaUser: string

// entidades
let donaTeacherId: string
let parceiraTeacherId: string
let studentAId: string
let studentBId: string
let contractA: string // particular de A com a dona
let contractB: string // particular de B com a Parceira
let coupleContract: string
let mentContractA: string
let mentContractB: string
let openSession: string
let closedSession: string
let nataliaStudentId: string

/* `tz_confirmed` explícito (c11 · U1): o default da coluna virou `false`, e o
   aluno de fixture é a ficha NORMAL — a que já tem cidade conferida e portanto
   aceita contrato. Mesma razão em `helpers/db.ts::createStudent`. */
async function newStudent(s: Sql, user: string, name: string): Promise<string> {
  const [row] = await s`
    insert into students (profile_id, display_name, iana_tz, tz_confirmed)
    values (${user}, ${name}, 'America/Cuiaba', true) returning id`
  return row.id as string
}

async function newPrivateContract(s: Sql, studentId: string, teacherId: string): Promise<string> {
  const [row] = await s`
    insert into contracts
      (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
       monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
    values ('private_1on1', ${studentId}, ${teacherId}, 'rls', 15000, 4, 24, 90, current_date)
    returning id`
  return row.id as string
}

beforeAll(async () => {
  sql = connect(3)

  adminUser = await createAuthUser(sql, 'admin', 'Dona (admin)')
  donaUser = await createAuthUser(sql, 'teacher', 'Dona (professora)')
  parceiraUser = await createAuthUser(sql, 'teacher', 'Renata')
  studentAUser = await createAuthUser(sql, 'student', 'Aluno A')
  studentBUser = await createAuthUser(sql, 'student', 'Aluno B')
  salesUser = await createAuthUser(sql, 'sales', 'Vendas')
  nataliaUser = await createAuthUser(sql, 'student', 'Natália RLS')

  const [t1] = await sql`
    insert into teachers (profile_id, hourly_rate_cents, is_owner)
    values (${donaUser}, 0, true) returning id`
  donaTeacherId = t1.id
  const [t2] = await sql`
    insert into teachers (profile_id, hourly_rate_cents)
    values (${parceiraUser}, 5000) returning id`
  parceiraTeacherId = t2.id

  studentAId = await newStudent(sql, studentAUser, 'Aluno A')
  studentBId = await newStudent(sql, studentBUser, 'Aluno B')
  contractA = await newPrivateContract(sql, studentAId, donaTeacherId)
  contractB = await newPrivateContract(sql, studentBId, parceiraTeacherId)
  await sql`
    insert into class_instances (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
    values (${contractA}, ${donaTeacherId}, now() + interval '3 day', now() + interval '3 day 45 min', 'rls A'),
           (${contractB}, ${parceiraTeacherId}, now() + interval '4 day', now() + interval '4 day 45 min', 'rls B')`
  await sql`
    insert into makeup_ledger (contract_id, student_id, delta, reason, expires_on)
    values (${contractA}, ${studentAId}, 1, 'initial_backlog', current_date + 30),
           (${contractB}, ${studentBId}, 1, 'initial_backlog', current_date + 30)`
  // Caso 11 (Fase 3): reschedule_usage é lazy — sem linha fabricada, o pino da
  // policy recriada reschedule_usage_teacher seria vácuo. period_ym fixo improvável
  // evita colisão com linhas lazy de reschedule_class; suíte re-executável sem reset.
  await sql`
    insert into reschedule_usage (contract_id, period_ym, used_count)
    values (${contractA}, '2099-01', 1), (${contractB}, '2099-01', 1)
    on conflict do nothing`

  // casal: Natália em grupo com contrato próprio
  const [g] = await sql`insert into student_groups (label) values ('Casal RLS') returning id`
  nataliaStudentId = await newStudent(sql, nataliaUser, 'Natália RLS')
  await sql`insert into student_group_members (group_id, student_id) values (${g.id}, ${nataliaStudentId})`
  const [cc] = await sql`
    insert into contracts
      (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
       monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
    values ('private_1on1', ${g.id}, ${parceiraTeacherId}, 'casal rls', 15000, 2, 24, 90, current_date)
    returning id`
  coupleContract = cc.id

  // mentoria: A e B com contrato + progresso; A tem uma reserva numa sessão aberta
  async function newMentorship(studentId: string): Promise<string> {
    const [c] = await sql`
      insert into contracts (contract_type, student_id, plan_name, hourly_rate_cents, started_on)
      values ('mentorship', ${studentId}, 'Personal Travel', 7000, current_date) returning id`
    await sql`
      insert into mentorship_contracts (contract_id, course_start_date)
      values (${c.id}, ${monthsAgo(3)})`
    await sql`
      insert into mentorship_window_rules (contract_id, window_index, threshold_pct)
      values (${c.id}, 1, 10), (${c.id}, 2, 40)
      on conflict (contract_id, window_index) do update set threshold_pct = excluded.threshold_pct`
    await sql`
      insert into course_progress (contract_id, student_id, completion_pct)
      values (${c.id}, ${studentId}, 50)`
    return c.id as string
  }
  mentContractA = await newMentorship(studentAId)
  mentContractB = await newMentorship(studentBId)
  openSession = await createSession(sql, { capacity: 6, status: 'open' })
  closedSession = await createSession(sql, { capacity: 6, status: 'scheduled' })
  // A E B reservam: sem linhas do B em bookings/ledger, o caso 26 seria vácuo.
  await sql`select public.book_mentorship_session(${openSession}, ${mentContractA})`
  await sql`select public.book_mentorship_session(${openSession}, ${mentContractB})`
})

afterAll(async () => {
  await sql.end()
})

describe('caso 12: anon vê zero em qualquer tabela', () => {
  it('TODAS as tabelas do schema public retornam vazio para anon', async () => {
    const tables = await sql`select tablename from pg_tables where schemaname = 'public'`
    expect(tables.length).toBeGreaterThanOrEqual(23)
    const anon = anonClient()
    for (const { tablename } of tables) {
      const { data, error } = await anon.from(tablename as string).select('*').limit(5)
      expect(error, `anon leu ${tablename}: ${error?.message}`).toBeNull()
      expect(data, `anon viu linhas de ${tablename}`).toEqual([])
    }
  })
})

describe('Lei 4: papel forjado em user_metadata não concede NADA', () => {
  it('JWT com user_metadata.role=admin (sem app_metadata) não vira admin', async () => {
    const forged = await clientAs(studentAUser, 'admin', { forgeInUserMetadata: true })
    // Tabelas só-admin: zero linhas.
    for (const table of ['payments', 'audit_log', 'leads', 'payers']) {
      const { data, error } = await forged.from(table).select('*').limit(5)
      expect(error).toBeNull()
      expect(data, `role forjado leu ${table}`).toEqual([])
    }
    // E não enxerga dados de OUTRO aluno (as policies de "self" continuam valendo
    // para o dono legítimo do token — isso não é escalação).
    const others = await forged.from('students').select('id').eq('id', studentBId)
    expect(others.data).toEqual([])
  })
})

describe('caso 10: aluno A não vê nada do aluno B', () => {
  it('students/contracts/instances/ledger do B: zero linhas; do próprio A: visíveis', async () => {
    const a = await clientAs(studentAUser, 'student')

    const own = await a.from('students').select('id')
    expect(own.data?.map((r) => r.id)).toEqual([studentAId])

    const otherContract = await a.from('contracts').select('id').eq('id', contractB)
    expect(otherContract.data).toEqual([])
    const ownContract = await a.from('contracts').select('id').eq('id', contractA)
    expect(ownContract.data).toHaveLength(1)

    const instances = await a.from('class_instances').select('contract_id')
    expect(instances.data?.every((r) => r.contract_id === contractA || r.contract_id === mentContractA)).toBe(true)
    expect(instances.data?.length).toBeGreaterThan(0)

    const ledger = await a.from('makeup_ledger').select('contract_id')
    expect(ledger.data).toHaveLength(1) // prova positiva: o próprio backlog aparece
    expect(ledger.data?.every((r) => r.contract_id === contractA)).toBe(true)

    // PII de outro aluno (profiles carrega whatsapp_e164): zero linhas.
    const otherProfile = await a.from('profiles').select('*').eq('id', studentBUser)
    expect(otherProfile.data).toEqual([])
  })
})

describe('caso 11: A professora não vê alunos da dona', () => {
  it('students/contracts/instances da dona: zero; os próprios: visíveis', async () => {
    const parceira = await clientAs(parceiraUser, 'teacher')

    const students = await parceira.from('students').select('id')
    const ids = students.data?.map((r) => r.id) ?? []
    expect(ids).not.toContain(studentAId) // aluno da dona
    expect(ids).toContain(studentBId) // aluno dela

    // F3-D7 (Fase 3, atualização DELIBERADA do pino): contracts_teacher foi
    // REMOVIDA — a linha de contracts carrega hourly_rate_cents (o que o ALUNO
    // paga) e plan_name, e RLS não filtra coluna (ADR-010 §1). A professora não
    // lê a TABELA; ledger/usage dela seguem visíveis via teacher_contract_ids()
    // (regressão positiva logo abaixo).
    const contracts = await parceira.from('contracts').select('id')
    expect(contracts.error).toBeNull()
    expect(contracts.data).toEqual([])

    const donaInstances = await parceira.from('class_instances').select('id').eq('contract_id', contractA)
    expect(donaInstances.data).toEqual([])

    const donaLedger = await parceira.from('makeup_ledger').select('id').eq('contract_id', contractA)
    expect(donaLedger.data).toEqual([])

    // Caso 11 da Fase 3: pós-DROP de contracts_teacher, a professora CONTINUA
    // vendo o ledger dos contratos DELA (helper teacher_contract_ids, DEFINER).
    // A prova POSITIVA (toContain) é obrigatória: [].every(...) === true — sem ela,
    // helper/policy quebrados devolvendo zero linhas passariam verdes (vacuidade).
    const ownLedger = await parceira.from('makeup_ledger').select('contract_id')
    expect(ownLedger.error).toBeNull()
    expect(ownLedger.data?.map((r) => r.contract_id)).toContain(contractB)
    expect(ownLedger.data?.every((r) => r.contract_id === contractB || r.contract_id === coupleContract)).toBe(true)

    // Caso 11, segunda tabela do goal: reschedule_usage — a policy recriada
    // reschedule_usage_teacher (sobre o helper) vista positivo E negativo.
    const donaUsage = await parceira.from('reschedule_usage').select('contract_id').eq('contract_id', contractA)
    expect(donaUsage.data).toEqual([])
    const ownUsage = await parceira.from('reschedule_usage').select('contract_id')
    expect(ownUsage.error).toBeNull()
    expect(ownUsage.data?.map((r) => r.contract_id)).toContain(contractB)
    expect(ownUsage.data?.some((r) => r.contract_id === contractA)).toBe(false)
  })

  it('professora do casal vê os MEMBROS do grupo (ramo de grupo da policy)', async () => {
    const parceira = await clientAs(parceiraUser, 'teacher')
    const rows = await parceira.from('students').select('id').eq('id', nataliaStudentId)
    expect(rows.data).toHaveLength(1)
  })
})

describe('caso 26: mentorado A não vê progresso/reservas do mentorado B', () => {
  it('course_progress e bookings do B: zero; os próprios: visíveis', async () => {
    const a = await clientAs(studentAUser, 'student')

    const progress = await a.from('course_progress').select('contract_id')
    expect(progress.data).toEqual([{ contract_id: mentContractA }])

    const otherProgress = await a.from('course_progress').select('*').eq('contract_id', mentContractB)
    expect(otherProgress.data).toEqual([])

    const bookings = await a.from('mentorship_bookings').select('contract_id')
    expect(bookings.data).toEqual([{ contract_id: mentContractA }])

    const ledger = await a.from('mentorship_credit_ledger').select('contract_id')
    expect(ledger.data).toEqual([{ contract_id: mentContractA }])

    const rules = await a.from('mentorship_window_rules').select('contract_id, window_index')
    expect(rules.data).toHaveLength(2) // prova positiva: a própria escada aparece
    expect(rules.data?.every((r) => r.contract_id === mentContractA)).toBe(true)
  })
})

describe('sessões de mentoria', () => {
  it('mentorado vê sessões open, não vê scheduled', async () => {
    const a = await clientAs(studentAUser, 'student')
    const open = await a.from('mentorship_sessions').select('id').eq('id', openSession)
    expect(open.data).toHaveLength(1)
    const closed = await a.from('mentorship_sessions').select('id').eq('id', closedSession)
    expect(closed.data).toEqual([])
  })

  it('aluno sem contrato de mentoria não vê sessão nenhuma', async () => {
    const natalia = await clientAs(nataliaUser, 'student')
    const rows = await natalia.from('mentorship_sessions').select('id')
    expect(rows.data).toEqual([])
  })
})

describe('casal via grupo (ADR-002)', () => {
  it('membro do grupo vê o contrato compartilhado', async () => {
    const natalia = await clientAs(nataliaUser, 'student')
    const rows = await natalia.from('contracts').select('id').eq('id', coupleContract)
    expect(rows.data).toHaveLength(1)
  })
})

describe('papéis restantes', () => {
  it('admin vê tudo; sales vê apenas leads; aluno não vê audit_log nem payments', async () => {
    const admin = await clientAs(adminUser, 'admin')
    const students = await admin.from('students').select('id')
    expect(students.data!.length).toBeGreaterThanOrEqual(4)
    const audit = await admin.from('audit_log').select('id').limit(1)
    expect(audit.data!.length).toBe(1)

    const sales = await clientAs(salesUser, 'sales')
    const leadName = 'Lead RLS ' + crypto.randomUUID() // único: suíte re-executável sem reset
    await sql`insert into leads (name, source) values (${leadName}, 'teste')`
    const leads = await sales.from('leads').select('name').eq('name', leadName)
    expect(leads.data).toHaveLength(1)
    const salesStudents = await sales.from('students').select('id')
    expect(salesStudents.data).toEqual([])

    const a = await clientAs(studentAUser, 'student')
    expect((await a.from('audit_log').select('id')).data).toEqual([])
    expect((await a.from('payments').select('id')).data).toEqual([])
    // teachers carrega remuneração (confidencial): aluno não vê NENHUMA linha
    // (o portal da Fase 2 exporá a professora via view enxuta — ADR-010).
    expect((await a.from('teachers').select('id')).data).toEqual([])
  })

  it('escrita direta de cliente é negada (mutação só via RPC — Lei 3)', async () => {
    const a = await clientAs(studentAUser, 'student')
    const ins = await a.from('makeup_ledger').insert({
      contract_id: contractA,
      delta: 10,
      reason: 'manual_adjust',
    })
    expect(ins.error).not.toBeNull()

    const upd = await a
      .from('mentorship_sessions')
      .update({ capacity: 99 })
      .eq('id', openSession)
      .select()
    expect(upd.data ?? []).toEqual([]) // zero linhas afetadas

    // O ataque mais rentável do domínio: mentorado inflar o PRÓPRIO completion_pct
    // para furar a escada (D2). A linha é visível por SELECT; escrita: zero.
    const cheat = await a
      .from('course_progress')
      .update({ completion_pct: 100 })
      .eq('contract_id', mentContractA)
      .select()
    expect(cheat.data ?? []).toEqual([])
    const [pct] = await sql`
      select completion_pct from course_progress where contract_id = ${mentContractA}`
    expect(Number(pct.completion_pct)).toBe(50)
  })

  it('EXECUTE das RPCs críticas negado a aluno e anon (barreira de escrita da Fase 1)', async () => {
    const a = await clientAs(studentAUser, 'student')
    const anon = anonClient()
    const attempts = [
      a.rpc('spend_makeup', { p_contract: contractA }),
      a.rpc('reschedule_class', {
        p_instance: contractA, // id qualquer: a permissão barra antes de validar
        p_new_local_date: '2027-01-05',
        p_new_local_time: '18:00',
      }),
      a.rpc('book_mentorship_session', { p_session: openSession, p_contract: mentContractA }),
      anon.rpc('spend_makeup', { p_contract: contractA }),
    ]
    for (const attempt of await Promise.all(attempts)) {
      expect(attempt.error).not.toBeNull()
      expect(attempt.error!.code).toBe('42501') // permission denied
    }
  })

  it('caso 31 (Fase 3): EXECUTE das funções novas — anon revogado; FIFO liberado a authenticated de propósito', async () => {
    const anon = anonClient()
    // Revogados de public/anon (F3-D9): enqueue (só cron/service_role), FIFO e helper.
    const denied = await Promise.all([
      anon.rpc('enqueue_credit_expiry_notices'),
      anon.rpc('makeup_remaining_expiries', { p_contract: crypto.randomUUID() }),
      anon.rpc('teacher_contract_ids'),
    ])
    for (const attempt of denied) {
      expect(attempt.error).not.toBeNull()
      expect(attempt.error!.code).toBe('42501')
    }

    // Desvio DELIBERADO do caso 31 (registrado no gate M0): makeup_remaining_expiries
    // tem GRANT a authenticated porque makeup_balance é SECURITY INVOKER e o EXECUTE
    // do helper é checado no CHAMADOR — sem o grant, o portal quebraria. A exposição
    // é idêntica ao SELECT que o RLS do chamador já concede (ADR-010).
    const a = await clientAs(studentAUser, 'student')
    const fifo = await a.rpc('makeup_remaining_expiries', { p_contract: contractA })
    expect(fifo.error).toBeNull()
    // E a razão de existir do grant: makeup_balance (que delega no FIFO) segue
    // funcionando para o aluno — a fixture garante 1 crédito válido no contrato A.
    const balance = await a.rpc('makeup_balance', { p_contract: contractA })
    expect(balance.error).toBeNull()
    expect(Number(balance.data)).toBe(1)
  })
})
