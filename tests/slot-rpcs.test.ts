// Fase 2 / M1 — RPCs de slot (D8, item 6c): fechar-e-criar transacional +
// materialização imediata. Editar horário NUNCA é UPDATE (ADR-008 §3).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createPrivateContract, createSlot } from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin slots'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

describe('create_slot', () => {
  it('cria com a zona do aluno e materializa IMEDIATAMENTE (não espera o cron)', async () => {
    const c = await createPrivateContract(sql, { tz: 'America/New_York' })
    const { data: slotId, error } = await admin.rpc('create_slot', {
      p_contract: c.contractId,
      p_weekday: 2,
      p_local_time: '11:00',
    })
    expect(error).toBeNull()

    const [slot] = await sql`select iana_tz, teacher_id from recurring_slots where id = ${slotId}`
    expect(slot.iana_tz).toBe('America/New_York')
    expect(slot.teacher_id).toBe(c.teacherId)
    const [{ count }] = await sql`
      select count(*)::int as count from class_instances
      where slot_id = ${slotId} and state = 'scheduled'`
    expect(count).toBeGreaterThan(0)
  })

  it('D10: aluno não cria slot', async () => {
    const c = await createPrivateContract(sql)
    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno slot'), 'student')
    const { error } = await student.rpc('create_slot', {
      p_contract: c.contractId,
      p_weekday: 1,
      p_local_time: '08:00',
    })
    expect(error?.message).toContain('D10')
  })
})

describe('close_and_create_slot (D8)', () => {
  it('fecha, cancela futuras SEM crédito, cria e materializa o novo — tudo numa transação', async () => {
    const c = await createPrivateContract(sql)
    const { data: oldSlot } = await admin.rpc('create_slot', {
      p_contract: c.contractId,
      p_weekday: 3,
      p_local_time: '16:45',
    })
    const [{ count: before }] = await sql`
      select count(*)::int as count from class_instances
      where slot_id = ${oldSlot} and state = 'scheduled'`
    expect(before).toBeGreaterThan(0)

    const { data: newSlot, error } = await admin.rpc('close_and_create_slot', {
      p_slot: oldSlot,
      p_new_weekday: 5,
      p_new_local_time: '09:30',
    })
    expect(error).toBeNull()

    const [old] = await sql`select active_to from recurring_slots where id = ${oldSlot}`
    expect(old.active_to).not.toBeNull()
    const [{ count: leftover }] = await sql`
      select count(*)::int as count from class_instances
      where slot_id = ${oldSlot} and state = 'scheduled' and occurrence_date > ${old.active_to}`
    expect(leftover).toBe(0)
    const [{ count: fresh }] = await sql`
      select count(*)::int as count from class_instances
      where slot_id = ${newSlot} and state = 'scheduled'`
    expect(fresh).toBeGreaterThan(0)

    // Mudança acordada NÃO é linha da matriz D2: nenhum crédito nasce.
    const [bal] = await sql`select public.makeup_balance(${c.contractId}) as b`
    expect(Number(bal.b)).toBe(0)
    const [audit] = await sql`
      select diff from audit_log where action = 'close_and_create_slot' and entity_id = ${oldSlot}::text`
    expect(audit.diff.new_slot).toBe(newSlot)
  })

  it('slot já fechado não fecha de novo', async () => {
    const c = await createPrivateContract(sql)
    const slotId = await createSlot(sql, c, { weekday: 1, localTime: '10:00', tz: 'America/Cuiaba' })
    await admin.rpc('close_and_create_slot', { p_slot: slotId, p_new_weekday: 2, p_new_local_time: '10:00' })
    const { error } = await admin.rpc('close_and_create_slot', {
      p_slot: slotId,
      p_new_weekday: 3,
      p_new_local_time: '10:00',
    })
    expect(error?.message).toContain('fechado')
  })
})
