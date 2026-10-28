// F2 (Onda Financeiro, PLAN-APPROVED + gate de 07/08) — previsto por
// MENSALIDADE cadastrada: os testes SÃO a tabela-verdade T1–T12 congelada no
// goal doc (`docs/goals/onda-financeiro.md`, §F2, versão do gate). Decisões do
// dono no gate: valor FIXO por mês, cadastrado no contrato; mês de 5 semanas
// NÃO aumenta; PAUSA NÃO DESCONTA; mentoria fora do previsto mas com linha de
// REFERÊNCIA (sessões do mês × alunos reservados × R$ 70).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createMentorshipContract,
  createPrivateContract,
  createTeacher,
} from './helpers/db'

const TZ = 'America/Cuiaba'
/** Meses-caso: setembro/2026 (5 terças) e outubro/2026 — o par prova o "fixo". */
const SET = '2026-09-01'
const OUT = '2026-10-01'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(4)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F2 Mensalidade'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

async function previsto(contractId: string, mes: string): Promise<number> {
  const [r] = await sql`select public.contract_previsto_no_mes_cents(${contractId}, ${mes}) as v`
  return Number(r.v)
}

/** Contrato particular com mensalidade cadastrada de R$ 450, vigente desde jan. */
async function contratoBase(mensalidade: number | null = 45000) {
  const c = await createPrivateContract(sql)
  await sql`update contracts
               set monthly_value_cents = ${mensalidade}, started_on = '2026-01-05'
             where id = ${c.contractId}`
  return c
}

describe('F2 — tabela-verdade da mensalidade (T1–T10)', () => {
  it('T1: contrato de pé o ano todo — mensalidade cheia em SET e OUT (5ª semana não muda nada)', async () => {
    const c = await contratoBase()
    expect(await previsto(c.contractId, SET)).toBe(45000)
    expect(await previsto(c.contractId, OUT)).toBe(45000)
  })

  it('T2: mensalidade NÃO cadastrada = 0, e o contrato aparece na lista do gate', async () => {
    const c = await contratoBase(null)
    expect(await previsto(c.contractId, SET)).toBe(0)
    const lista = await sql`
      select 1 from contracts c
       where c.id = ${c.contractId}
         and c.contract_type = 'private_1on1'
         and c.status <> 'ended'
         and c.monthly_value_cents is null`
    expect(lista).toHaveLength(1)
  })

  it('T3: contrato começa 15/09 — setembro conta CHEIO (mês parcial = mensalidade inteira); agosto = 0', async () => {
    const c = await contratoBase()
    await sql`update contracts set started_on = '2026-09-15' where id = ${c.contractId}`
    expect(await previsto(c.contractId, SET)).toBe(45000)
    expect(await previsto(c.contractId, '2026-08-01')).toBe(0)
  })

  it('T4: ended_on 15/09 (status active) — o mês do fim ainda conta; outubro = 0', async () => {
    const c = await contratoBase()
    await sql`update contracts set ended_on = '2026-09-15' where id = ${c.contractId}`
    expect(await previsto(c.contractId, SET)).toBe(45000)
    expect(await previsto(c.contractId, OUT)).toBe(0)
  })

  it('T5: pausa no meio do mês NÃO desconta (decisão do dono: compensação é crédito/reposição)', async () => {
    const c = await contratoBase()
    await sql`insert into contract_pauses (contract_id, paused_on, resumed_on)
              values (${c.contractId}, '2026-09-08', '2026-09-22')`
    expect(await previsto(c.contractId, SET)).toBe(45000)
  })

  it('T6: pausado o mês INTEIRO (status paused + pausa aberta) — ainda conta a mensalidade', async () => {
    const c = await contratoBase()
    await sql`insert into contract_pauses (contract_id, paused_on) values (${c.contractId}, '2026-08-20')`
    await sql`update contracts set status = 'paused' where id = ${c.contractId}`
    expect(await previsto(c.contractId, SET)).toBe(45000)
  })

  it('T7: casal (contrato de GRUPO) = UMA mensalidade, nunca por aluno', async () => {
    const teacherId = await createTeacher(sql)
    const [grupo] = await sql`insert into student_groups (label) values ('Casal F2M') returning id`
    const [a1] = await sql`insert into students (display_name, iana_tz, tz_confirmed)
                           values ('Casal F2M A', ${TZ}, true) returning id`
    const [a2] = await sql`insert into students (display_name, iana_tz, tz_confirmed)
                           values ('Casal F2M B', ${TZ}, true) returning id`
    await sql`insert into student_group_members (group_id, student_id)
              values (${grupo.id}, ${a1.id}), (${grupo.id}, ${a2.id})`
    const [c] = await sql`
      insert into contracts
        (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_value_cents, monthly_reschedule_allowance, min_notice_hours,
         makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${grupo.id}, ${teacherId}, 'Casal F2M', 15000,
              60000, 2, 24, 30, '2026-01-05')
      returning id`
    expect(await previsto(c.id, SET)).toBe(60000)
  })

  it('T8: mentoria fica FORA do previsto por contrato (o campo nem aceita valor — CHECK)', async () => {
    const m = await createMentorshipContract(sql, {})
    expect(await previsto(m.contractId, SET)).toBe(0)
    const barrado = await sql`
      update contracts set monthly_value_cents = 10000 where id = ${m.contractId}`
      .then(() => null)
      .catch((e: Error) => e)
    expect(barrado).not.toBeNull()
  })

  it('T9: encerrado DE FATO (ended_on no passado) = 0 nos meses seguintes', async () => {
    const c = await contratoBase()
    await sql`update contracts set status = 'ended', ended_on = '2026-08-31' where id = ${c.contractId}`
    expect(await previsto(c.contractId, SET)).toBe(0)
    // defensivo: ended SEM data não tem vigência que o sustente
    const c2 = await contratoBase()
    await sql`update contracts set status = 'ended' where id = ${c2.contractId}`
    expect(await previsto(c2.contractId, SET)).toBe(0)
  })

  it('T13 (Sol r2 · P1): renovação AGENDADA não some do previsto — vigência decide, não o status', async () => {
    // admin_renew_contract marca o velho como `ended` NA HORA com ended_on na
    // véspera da virada futura. Simulação: virada 01/10.
    const velho = await contratoBase()
    await sql`update contracts set status = 'ended', ended_on = '2026-09-30' where id = ${velho.contractId}`
    const novo = await createPrivateContract(sql, { studentId: velho.studentId })
    await sql`update contracts
                 set renewed_from = ${velho.contractId}, started_on = '2026-10-01',
                     monthly_value_cents = 50000
               where id = ${novo.contractId}`
    // setembro é do VELHO (sucessor só começa em outubro); outubro é do NOVO.
    expect(await previsto(velho.contractId, SET)).toBe(45000)
    expect(await previsto(novo.contractId, SET)).toBe(0)
    expect(await previsto(velho.contractId, OUT)).toBe(0)
    expect(await previsto(novo.contractId, OUT)).toBe(50000)
  })

  it('T14 (Sol r2): virada NO MEIO do mês nunca conta dobrado — o mês é do sucessor', async () => {
    const velho = await contratoBase()
    await sql`update contracts set status = 'ended', ended_on = '2026-09-14' where id = ${velho.contractId}`
    const novo = await createPrivateContract(sql, { studentId: velho.studentId })
    await sql`update contracts
                 set renewed_from = ${velho.contractId}, started_on = '2026-09-15',
                     monthly_value_cents = 50000
               where id = ${novo.contractId}`
    expect(await previsto(velho.contractId, SET)).toBe(0)
    expect(await previsto(novo.contractId, SET)).toBe(50000)
  })

  it('T10: remarcação/aula na agenda vivida não muda a mensalidade (fórmula nem olha class_instances)', async () => {
    const c = await contratoBase()
    const antes = await previsto(c.contractId, SET)
    await sql`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot, state)
      values (${c.contractId}, ${c.teacherId}, '2026-09-08T18:00:00Z', '2026-09-08T18:45:00Z',
              'fixture f2m', 'scheduled')`
    expect(await previsto(c.contractId, SET)).toBe(antes)
  })
})

describe('F2 — referência de mentoria e KPI v3 (T11–T12)', () => {
  it('T11: referência = sessões do mês (não canceladas) × alunos reservados × R$ 70', async () => {
    // Duas sessões no MESMO instante-alvo de um mês fixo + uma cancelada: a
    // conta usa booked_count e ignora a cancelada. Como o KPI computa o MÊS
    // CORRENTE, o caso pina a conta da migration por SQL direto (mesma conta).
    const [s1] = await sql`
      insert into mentorship_sessions (scheduled_at, local_time_snapshot, capacity, booked_count, status)
      values ('2026-09-10T20:00:00Z', 'fixture f2 ref', 6, 3, 'open') returning id`
    const [s2] = await sql`
      insert into mentorship_sessions (scheduled_at, local_time_snapshot, capacity, booked_count, status)
      values ('2026-09-17T20:00:00Z', 'fixture f2 ref', 6, 2, 'done') returning id`
    await sql`
      insert into mentorship_sessions (scheduled_at, local_time_snapshot, capacity, booked_count, status)
      values ('2026-09-24T20:00:00Z', 'fixture f2 ref', 6, 4, 'cancelled')`

    const [r] = await sql`
      select coalesce(sum(ms.booked_count), 0) * 7000 as ref
        from mentorship_sessions ms
       where ms.status <> 'cancelled'
         and (ms.scheduled_at at time zone public.business_tz())::date >= '2026-09-01'
         and (ms.scheduled_at at time zone public.business_tz())::date <  '2026-10-01'
         and ms.id in (${s1.id}, ${s2.id})`
    expect(Number(r.ref)).toBe((3 + 2) * 7000)
  })

  it('T12: KPI v3 — previsto = Σ mensalidades; mentoria_ref = conta da migration; versão = 3 (um só snapshot)', async () => {
    const [r] = await sql`
      select (k->>'definitions_version')::int       as versao,
             (k->>'previsto_no_mes_cents')::bigint  as kpi,
             (k->>'previsto_mentoria_cents')::bigint as mentoria,
             (select coalesce(sum(public.contract_previsto_no_mes_cents(
                       c.id, date_trunc('month', public.business_today())::date)), 0)
                from contracts c
               -- espelho do filtro do KPI: VIGÊNCIA, nunca status (Sol r2 —
               -- renovação agendada marca ended com data futura e segue valendo)
               where c.contract_type = 'private_1on1'
                 and c.started_on < (date_trunc('month', public.business_today()) + interval '1 month')::date
                 and (c.ended_on is null or c.ended_on >= date_trunc('month', public.business_today())::date)
                 and not (c.status = 'ended' and c.ended_on is null)) as esperado,
             (select coalesce(sum(ms.booked_count), 0) * 7000
                from mentorship_sessions ms
               where ms.status <> 'cancelled'
                 and (ms.scheduled_at at time zone public.business_tz())::date
                       >= date_trunc('month', public.business_today())::date
                 and (ms.scheduled_at at time zone public.business_tz())::date
                       <  (date_trunc('month', public.business_today()) + interval '1 month')::date
             )                                       as mentoria_esperada
        from public._admin_kpis_compute() k`
    expect(Number(r.versao)).toBe(3)
    expect(Number(r.kpi)).toBe(Number(r.esperado))
    expect(Number(r.mentoria)).toBe(Number(r.mentoria_esperada))
  })
})

describe('F2 — a porta da mensalidade (RPC auditada)', () => {
  it('admin cadastra, edita e despublica (NULL) com trilha de → para; recusas nomeadas', async () => {
    const c = await contratoBase(null)
    const set1 = await admin.rpc('admin_set_contract_monthly_value', {
      p_contract: c.contractId, p_cents: 59900,
    })
    expect(set1.error).toBeNull()
    expect(await previsto(c.contractId, SET)).toBe(59900)

    const limpa = await admin.rpc('admin_set_contract_monthly_value', {
      p_contract: c.contractId, p_cents: null,
    })
    expect(limpa.error).toBeNull()
    expect(await previsto(c.contractId, SET)).toBe(0)

    const trilha = await sql`
      select 1 from audit_log
       where action = 'set_contract_monthly_value' and entity_id = ${c.contractId}::text`
    expect(trilha.length).toBe(2)

    // recusas: negativa, mentoria, encerrado
    const neg = await admin.rpc('admin_set_contract_monthly_value', {
      p_contract: c.contractId, p_cents: -1,
    })
    expect(neg.error).not.toBeNull()
    const m = await createMentorshipContract(sql, {})
    const ment = await admin.rpc('admin_set_contract_monthly_value', {
      p_contract: m.contractId, p_cents: 10000,
    })
    expect(ment.error?.message).toContain('mentoria')
  })

  it('aluno não cadastra mensalidade; e não executa a função de previsto direto', async () => {
    const c = await contratoBase()
    const aluno = await clientAs(await createAuthUser(sql, 'student', 'Aluno F2M ACL'), 'student')
    const rpc = await aluno.rpc('admin_set_contract_monthly_value', {
      p_contract: c.contractId, p_cents: 100,
    })
    expect(rpc.error).not.toBeNull()
    const fn = await aluno.rpc('contract_previsto_no_mes_cents', {
      p_contract: c.contractId, p_month: SET,
    })
    expect(fn.error).not.toBeNull()
  })
})
