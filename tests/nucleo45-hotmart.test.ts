// Núcleo 4/5 / N1 — efeitos Hotmart (N45-D4): casos 24 e 25 do goal.
// Só as RPCs de efeito: a rota /api/webhooks/hotmart inteira fica no
// handoff-fase5.md ([VERIFICAR] na doc oficial). Chamador: service_role
// grants-only, SEM check interno (a armadilha do grant morto está documentada
// na migration 20260714000500).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect, createMentorshipContract } from './helpers/db'

let sql: Sql
let service: SupabaseClient

beforeAll(async () => {
  sql = connect(3)
  service = serviceClient()
})
afterAll(async () => {
  await sql.end()
})

describe('apply_course_first_access (caso 24)', () => {
  it('deriva a data CIVIL no fuso do ALUNO — evento noturno cruza a meia-noite em Lisboa', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: null,
      tz: 'Europe/Lisbon',
    })
    // 23:30 UTC de 10/07 = 00:30 de 11/07 em Lisboa (verão, UTC+1):
    // a data civil do ALUNO é 11/07 — usar UTC daria 10/07 (dia errado).
    const { data, error } = await service.rpc('apply_course_first_access', {
      p_contract: m.contractId,
      p_event_at: '2026-07-10T23:30:00Z',
    })
    expect(error).toBeNull()
    expect(data).toBe('2026-07-11')

    const [row] = await sql`
      select course_start_date::text from mentorship_contracts where contract_id = ${m.contractId}`
    expect(row.course_start_date).toBe('2026-07-11')

    const [audit] = await sql`
      select diff from audit_log
      where action = 'apply_course_first_access' and entity_id = ${m.contractId}::text`
    expect(audit.diff.outcome).toBe('applied')
    expect(audit.diff.iana_tz).toBe('Europe/Lisbon')
  })

  it('2ª chamada com instante DIFERENTE → no-op idempotente auditável; data original fica', async () => {
    const m = await createMentorshipContract(sql, {
      courseStartMonthsAgo: null,
      tz: 'America/Cuiaba',
    })
    const first = await service.rpc('apply_course_first_access', {
      p_contract: m.contractId,
      p_event_at: '2026-07-01T12:00:00Z',
    })
    expect(first.error).toBeNull()

    const replay = await service.rpc('apply_course_first_access', {
      p_contract: m.contractId,
      p_event_at: '2026-07-05T12:00:00Z', // replay atrasado com outro instante
    })
    expect(replay.error).toBeNull()
    expect(replay.data).toBe(first.data) // devolve a data VIGENTE, não a nova

    const [row] = await sql`
      select course_start_date::text from mentorship_contracts where contract_id = ${m.contractId}`
    expect(row.course_start_date).toBe(first.data)

    const audits = await sql`
      select diff from audit_log
      where action = 'apply_course_first_access' and entity_id = ${m.contractId}::text
      order by id`
    expect(audits).toHaveLength(2)
    expect(audits[1].diff.outcome).toBe('skipped_already_set')
    expect(audits[1].diff.rejected_date).toBe('2026-07-05')
  })

  it('contrato inexistente → exceção; papel de cliente não executa (grants-only)', async () => {
    const ghost = crypto.randomUUID()
    const r = await service.rpc('apply_course_first_access', {
      p_contract: ghost,
      p_event_at: '2026-07-01T12:00:00Z',
    })
    expect(r.error?.message).toMatch(/não existe/)

    const m = await createMentorshipContract(sql, { courseStartMonthsAgo: null })
    const admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin hotmart'), 'admin')
    const viaAdmin = await admin.rpc('apply_course_first_access', {
      p_contract: m.contractId,
      p_event_at: '2026-07-01T12:00:00Z',
    })
    // EXECUTE revogado de authenticated: nem a admin chama por fora do servidor
    expect(viaAdmin.error?.message).toMatch(/permission denied|not find the function/i)
  })
})

describe('apply_module_progress (caso 25)', () => {
  it('contrato SEM linha → upsert cria (student derivado); regressão vira no-op auditado com last_synced_at avançando', async () => {
    const m = await createMentorshipContract(sql, { courseStartMonthsAgo: 1 }) // sem completionPct: sem linha
    const [before] = await sql`
      select count(*)::int as n from course_progress where contract_id = ${m.contractId}`
    expect(before.n).toBe(0)

    const apply60 = await service.rpc('apply_module_progress', {
      p_contract: m.contractId,
      p_pct: 60,
    })
    expect(apply60.error).toBeNull()
    expect(Number(apply60.data)).toBe(60)

    const [created] = await sql`
      select student_id, completion_pct, last_synced_at
      from course_progress where contract_id = ${m.contractId}`
    expect(created.student_id).toBe(m.studentId) // derivado de contracts.student_id
    expect(Number(created.completion_pct)).toBe(60)

    const apply40 = await service.rpc('apply_module_progress', {
      p_contract: m.contractId,
      p_pct: 40, // CLUB_MODULE_COMPLETED atrasado
    })
    expect(apply40.error).toBeNull()
    expect(Number(apply40.data)).toBe(60) // monotônico: fica 60

    const [after] = await sql`
      select completion_pct, last_synced_at from course_progress
      where contract_id = ${m.contractId}`
    expect(Number(after.completion_pct)).toBe(60)
    // o SYNC aconteceu: last_synced_at avança mesmo no no-op
    expect(new Date(after.last_synced_at).getTime()).toBeGreaterThan(
      new Date(created.last_synced_at).getTime(),
    )

    const audits = await sql`
      select diff from audit_log
      where action = 'apply_module_progress' and entity_id = ${m.contractId}::text
      order by id`
    expect(audits).toHaveLength(2)
    expect(audits[0].diff).toMatchObject({ outcome: 'applied', new_pct: 60 })
    expect(audits[1].diff).toMatchObject({ outcome: 'skipped_regression', rejected_pct: 40 })
  })

  it('pct fora de 0–100 e contrato inexistente → exceção', async () => {
    const m = await createMentorshipContract(sql, { courseStartMonthsAgo: 1 })
    const over = await service.rpc('apply_module_progress', { p_contract: m.contractId, p_pct: 101 })
    expect(over.error?.message).toMatch(/entre 0 e 100/)
    const ghost = await service.rpc('apply_module_progress', { p_contract: crypto.randomUUID(), p_pct: 10 })
    expect(ghost.error?.message).toMatch(/não existe/)
  })
})
