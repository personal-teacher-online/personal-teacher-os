// F4 — Contratos (plano integrado v2, 18/07/2026): editar regras (M5-2),
// encerramento estendido com destinação (M5-3/M3-4), renovação guiada na ordem
// validada (M5-1, com P13) e âncora de fuso explícita de grupo (P1/M4-1).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createInstance,
  createPrivateContract,
  createStudent,
  createTeacher,
  daysFromToday,
  nomeDeConfirmacao,
} from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F4'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

async function balance(contractId: string): Promise<number> {
  const [row] = await sql`select public.makeup_balance(${contractId}) as b`
  return Number(row.b)
}

async function addCredit(contractId: string, expiresOn: string, dur: number | null = 60) {
  const [r] = await sql`
    insert into makeup_ledger (contract_id, delta, reason, expires_on, duration_min)
    values (${contractId}, 1, 'manual_adjust', ${expiresOn}, ${dur})
    returning id`
  return Number(r.id)
}

async function createGroupContract() {
  const a = await createStudent(sql, 'America/Sao_Paulo')
  const b = await createStudent(sql, 'America/Cuiaba')
  const t = await createTeacher(sql)
  const [g] = await sql`insert into student_groups (label) values ('Casal F4') returning id`
  await sql`insert into student_group_members (group_id, student_id) values (${g.id}, ${a}), (${g.id}, ${b})`
  const [c] = await sql`
    insert into contracts
      (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
       monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days,
       started_on, group_tz_anchor_student)
    values ('private_1on1', ${g.id}, ${t}, 'grupo F4', 15000, 4, 24, 90,
            current_date, ${a})
    returning id`
  return { contractId: c.id as string, teacherId: t, anchor: a }
}

describe('M5-2 — editar regras (prospectivo, auditado)', () => {
  it('atualiza regras e grava old/new no audit; aluno é recusado', async () => {
    const c = await createPrivateContract(sql)
    const { error } = await admin.rpc('admin_update_contract_rules', {
      p_contract: c.contractId,
      p_plan_name: 'Plano novo',
      p_allowance: 2,
      p_min_notice: 48,
      p_expiry_days: 120,
      p_school_fault_days: 200,
    })
    expect(error).toBeNull()
    const [row] = await sql`
      select plan_name, monthly_reschedule_allowance, min_notice_hours,
             makeup_credit_expiry_days, school_fault_credit_expiry_days
      from contracts where id = ${c.contractId}`
    expect(row.plan_name).toBe('Plano novo')
    expect(row.min_notice_hours).toBe(48)
    expect(row.school_fault_credit_expiry_days).toBe(200)
    const [audit] = await sql`
      select diff from audit_log
      where action = 'update_contract_rules' and entity_id = ${c.contractId}::text`
    expect(audit.diff.old.min_notice_hours).toBe(24)
    expect(audit.diff.new.min_notice_hours).toBe(48)

    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno regras'), 'student')
    const negado = await student.rpc('admin_update_contract_rules', {
      p_contract: c.contractId, p_plan_name: 'x', p_allowance: 1, p_min_notice: 1,
      p_expiry_days: 1, p_school_fault_days: 1,
    })
    expect(negado.error?.message).toContain('D10')
  })
})

describe('M5-3/M3-4 — encerramento estendido', () => {
  it('gate duro: pendência trava; destinação obrigatória com saldo vivo', async () => {
    const c = await createPrivateContract(sql)
    const pendente = await createInstance(sql, c, { startsInHours: -5 })
    const nome = await nomeDeConfirmacao(sql, c.contractId)
    const pend = await admin.rpc('admin_end_contract', {
      p_contract: c.contractId,
      p_confirm_name: nome,
    })
    expect(pend.error?.message).toContain('sem desfecho')

    // D2 (20/07): batch exige apontamento — aponta antes de completar
    await admin.rpc('report_class_content', { p_instance: pendente, p_off_kind: 'outro', p_off_note: 'teste' })
    // rodada 3: o lote recebe os IDs explícitos (a RPC não seleciona mais por tempo)
    await admin.rpc('admin_complete_past_batch', { p_teacher: c.teacherId, p_instances: [pendente] })
    await addCredit(c.contractId, daysFromToday(30))
    const semDest = await admin.rpc('admin_end_contract', {
      p_contract: c.contractId,
      p_confirm_name: nome,
    })
    expect(semDest.error?.message).toContain('créditos vivos')
  })

  it('transfere créditos preservando validade+duração; cancela futuras SEM aviso; fecha slots', async () => {
    const c = await createPrivateContract(sql)
    // destino do MESMO aluno. c15 · Sol 6: o contrato-destino NASCE do aluno
    // certo — trocar o dono por UPDATE virou recusa do gatilho
    // `contracts_vinculo_imutavel`, para toda porta.
    const dest = await createPrivateContract(sql, { studentId: c.studentId })
    await addCredit(c.contractId, daysFromToday(40), 60)
    const fut = await createInstance(sql, c, { startsInHours: 96 })
    await admin.rpc('create_slot', {
      p_contract: c.contractId, p_weekday: 2, p_local_time: '06:15',
    })

    const { data, error } = await admin.rpc('admin_end_contract', {
      p_contract: c.contractId,
      p_confirm_name: await nomeDeConfirmacao(sql, c.contractId),
      p_dest_contract: dest.contractId,
    })
    expect(error).toBeNull()
    expect((data as { transferred: number }).transferred).toBe(1)

    const [st] = await sql`select state from class_instances where id = ${fut}`
    expect(st.state).toBe('cancelled')
    const [contract] = await sql`select status, ended_on from contracts where id = ${c.contractId}`
    expect(contract.status).toBe('ended')
    expect(contract.ended_on).toBeTruthy()
    const openSlots = await sql`
      select 1 from recurring_slots where contract_id = ${c.contractId} and active_to is null`
    expect(openSlots).toHaveLength(0)

    expect(await balance(c.contractId)).toBe(0)
    expect(await balance(dest.contractId)).toBe(1)
    const [live] = await sql`
      select rc.expires_on::text as e, rc.duration_min
      from public._makeup_remaining_credits(${dest.contractId}) rc`
    expect(live.e).toBe(daysFromToday(40))
    expect(live.duration_min).toBe(60)

    // P4 deliberado: encerramento é SILENCIOSO — nenhum aviso enfileirado
    const outbox = await sql`
      select 1 from notification_outbox
      where template = 'class-cancelled' and payload->>'instance_id' = ${fut}::text`
    expect(outbox).toHaveLength(0)
  })

  it('baixa com motivo zera o saldo; destino de OUTRO aluno é recusado', async () => {
    const c = await createPrivateContract(sql)
    await addCredit(c.contractId, daysFromToday(30))
    const alheio = await createPrivateContract(sql)
    const nome = await nomeDeConfirmacao(sql, c.contractId)
    const errado = await admin.rpc('admin_end_contract', {
      p_contract: c.contractId, p_confirm_name: nome, p_dest_contract: alheio.contractId,
    })
    expect(errado.error?.message).toContain('MESMO aluno')

    const { error } = await admin.rpc('admin_end_contract', {
      p_contract: c.contractId, p_confirm_name: nome, p_writeoff_note: 'aluno mudou-se',
    })
    expect(error).toBeNull()
    expect(await balance(c.contractId)).toBe(0)
    const [debit] = await sql`
      select note from makeup_ledger
      where contract_id = ${c.contractId} and delta = -1 order by id desc limit 1`
    expect(debit.note).toContain('aluno mudou-se')
  })
})

describe('M5-1 — renovação guiada (ordem M5-a; P13)', () => {
  it('emenda sem buraco/duplicata: velho até a véspera, novo desde a virada; créditos migram', async () => {
    const c = await createPrivateContract(sql)
    // slot na MESMA semana: aula antes da virada fica; a partir dela, renasce no novo
    await admin.rpc('create_slot', {
      p_contract: c.contractId, p_weekday: new Date(daysFromToday(2) + 'T12:00:00Z').getUTCDay(),
      p_local_time: '12:00',
    })
    await addCredit(c.contractId, daysFromToday(40), 60)
    const switchOn = daysFromToday(7)

    const { data: novoId, error } = await admin.rpc('admin_renew_contract', {
      p_old: c.contractId,
      p_switch_on: switchOn,
      p_plan_name: 'Plano renovado',
      p_hourly_rate_cents: 18000,
      p_allowance: 4,
      p_min_notice: 24,
      p_expiry_days: 90,
      p_school_fault_days: 180,
    })
    expect(error).toBeNull()

    const [velho] = await sql`select status, ended_on::text as e from contracts where id = ${c.contractId}`
    expect(velho.status).toBe('ended')
    expect(velho.e < switchOn).toBe(true)
    const [novo] = await sql`
      select renewed_from, hourly_rate_cents, started_on::text as s from contracts where id = ${novoId}`
    expect(novo.renewed_from).toBe(c.contractId)
    expect(novo.hourly_rate_cents).toBe(18000)
    expect(novo.s).toBe(switchOn)

    // velho: nenhuma agendada com data civil >= virada; novo: só >= virada
    const [velhas] = await sql`
      select count(*)::int as n from class_instances
      where contract_id = ${c.contractId} and state = 'scheduled'
        and (starts_at_utc at time zone public.business_tz())::date >= ${switchOn}`
    expect(velhas.n).toBe(0)
    const [novas] = await sql`
      select count(*)::int as antes,
             (select count(*) from class_instances
              where contract_id = ${novoId} and state = 'scheduled'
                and (starts_at_utc at time zone public.business_tz())::date >= ${switchOn})::int as depois
      from class_instances
      where contract_id = ${novoId} and state = 'scheduled'
        and (starts_at_utc at time zone public.business_tz())::date < ${switchOn}`
    expect(novas.antes).toBe(0)
    expect(novas.depois).toBeGreaterThan(0)

    expect(await balance(c.contractId)).toBe(0)
    expect(await balance(String(novoId))).toBe(1)
    const [live] = await sql`
      select rc.expires_on::text as e, rc.duration_min
      from public._makeup_remaining_credits(${novoId}) rc
      where rc.expires_on >= public.business_today()`
    expect(live.e).toBe(daysFromToday(40))
    expect(live.duration_min).toBe(60)
  })

  it('P13: virada além de 8 semanas ou no passado é RECUSADA; pendência trava', async () => {
    const c = await createPrivateContract(sql)
    const base = {
      p_old: c.contractId, p_plan_name: 'x', p_hourly_rate_cents: 10000,
      p_allowance: 4, p_min_notice: 24, p_expiry_days: 90, p_school_fault_days: 180,
    }
    const longe = await admin.rpc('admin_renew_contract', { ...base, p_switch_on: daysFromToday(80) })
    expect(longe.error?.message).toContain('8 semanas')
    const passado = await admin.rpc('admin_renew_contract', { ...base, p_switch_on: daysFromToday(-2) })
    expect(passado.error?.message).toContain('passado')

    await createInstance(sql, c, { startsInHours: -4 })
    const pend = await admin.rpc('admin_renew_contract', { ...base, p_switch_on: daysFromToday(7) })
    expect(pend.error?.message).toContain('sem desfecho')
  })
})

describe('P1/M4-1 — âncora de fuso explícita para grupo', () => {
  it('criar horário de grupo SEM âncora é recusado; com âncora funciona', async () => {
    const g = await createGroupContract()
    const sem = await admin.rpc('create_slot', {
      p_contract: g.contractId, p_weekday: 3, p_local_time: '07:30',
    })
    expect(sem.error?.message).toContain('âncora')

    const { data: slotId, error } = await admin.rpc('create_slot', {
      p_contract: g.contractId, p_weekday: 3, p_local_time: '07:30',
      p_iana_tz: 'America/Sao_Paulo',
    })
    expect(error).toBeNull()
    const [slot] = await sql`select iana_tz from recurring_slots where id = ${slotId}`
    expect(slot.iana_tz).toBe('America/Sao_Paulo')

    // troca de horário de grupo também exige a âncora
    const troca = await admin.rpc('close_and_create_slot', {
      p_slot: slotId, p_new_weekday: 4, p_new_local_time: '08:00',
    })
    expect(troca.error?.message).toContain('âncora')
    const ok = await admin.rpc('close_and_create_slot', {
      p_slot: slotId, p_new_weekday: 4, p_new_local_time: '08:00',
      p_new_iana_tz: 'America/Cuiaba',
    })
    expect(ok.error).toBeNull()
  })
})
