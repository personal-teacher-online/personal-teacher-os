import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import type { Sql } from 'postgres'
import {
  connect,
  createInstance,
  createPrivateContract,
  daysFromToday,
} from './helpers/db'

let sql: Sql

beforeAll(() => {
  sql = connect(5)
})
afterAll(async () => {
  await sql.end()
})

async function balance(contractId: string): Promise<number> {
  const [row] = await sql`select public.makeup_balance(${contractId}) as b`
  return row.b as number
}

describe('makeup_balance (Lei 2: saldo derivado)', () => {
  it('soma ganhos e gastos do contrato', async () => {
    const c = await createPrivateContract(sql)
    await sql`select public.earn_makeup(${c.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    await sql`select public.earn_makeup(${c.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    expect(await balance(c.contractId)).toBe(2)
    await sql`select public.spend_makeup(${c.contractId})`
    expect(await balance(c.contractId)).toBe(1)
  })

  it('caso 9: crédito com expires_on no passado é ignorado', async () => {
    const c = await createPrivateContract(sql)
    await sql`select public.earn_makeup(${c.contractId}, 'initial_backlog', ${daysFromToday(-2)})`
    expect(await balance(c.contractId)).toBe(0)
  })

  it('FIFO cronológico: gasto ANTES da expiração consome o crédito que expirou (saldo nunca −1)', async () => {
    const c = await createPrivateContract(sql)
    // Linha do tempo real: ganhou há 10 dias (validade até anteontem), gastou há 5
    // dias (crédito ainda era válido), e hoje o crédito já venceu.
    await sql`
      insert into makeup_ledger (contract_id, delta, reason, expires_on, created_at)
      values (${c.contractId}, 1, 'initial_backlog', ${daysFromToday(-2)}, now() - interval '10 days')`
    await sql`
      insert into makeup_ledger (contract_id, delta, reason, created_at)
      values (${c.contractId}, -1, 'spend_reschedule', now() - interval '5 days')`
    expect(await balance(c.contractId)).toBe(0)
  })

  it('crédito que expira SEM uso não ressuscita para absorver gasto posterior', async () => {
    const c = await createPrivateContract(sql)
    // Crédito vencido (nunca usado) + crédito válido; o gasto de hoje só pode
    // consumir o VÁLIDO — saldo final 0, e um segundo gasto é recusado.
    await sql`select public.earn_makeup(${c.contractId}, 'initial_backlog', ${daysFromToday(-2)})`
    await sql`select public.earn_makeup(${c.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    await sql`select public.spend_makeup(${c.contractId})`
    expect(await balance(c.contractId)).toBe(0)
    await expect(sql`select public.spend_makeup(${c.contractId})`).rejects.toThrow(/insuficiente/)
  })
})

describe('spend_makeup', () => {
  it('recusa gasto com saldo zero', async () => {
    const c = await createPrivateContract(sql)
    await expect(sql`select public.spend_makeup(${c.contractId})`).rejects.toThrow(
      /insuficiente/,
    )
  })

  it('caso 5: concorrência — 2 transações disputam o último crédito; exatamente uma vence', async () => {
    const c = await createPrivateContract(sql)
    await sql`select public.earn_makeup(${c.contractId}, 'initial_backlog', ${daysFromToday(30)})`

    const conn1 = connect(1)
    const conn2 = connect(1)
    try {
      const results = await Promise.allSettled([
        conn1`select public.spend_makeup(${c.contractId})`,
        conn2`select public.spend_makeup(${c.contractId})`,
      ])
      const ok = results.filter((r) => r.status === 'fulfilled')
      const failed = results.filter((r) => r.status === 'rejected')
      expect(ok).toHaveLength(1)
      expect(failed).toHaveLength(1)
      expect((failed[0] as PromiseRejectedResult).reason.message).toMatch(/insuficiente/)
      expect(await balance(c.contractId)).toBe(0) // nunca −1
    } finally {
      await conn1.end()
      await conn2.end()
    }
  })
})

describe('ledger append-only (caso 13)', () => {
  it('bloqueia UPDATE', async () => {
    const c = await createPrivateContract(sql)
    await sql`select public.earn_makeup(${c.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    await expect(
      sql`update makeup_ledger set delta = 5 where contract_id = ${c.contractId}`,
    ).rejects.toThrow(/append-only/)
  })

  it('bloqueia DELETE', async () => {
    const c = await createPrivateContract(sql)
    await sql`select public.earn_makeup(${c.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    await expect(
      sql`delete from makeup_ledger where contract_id = ${c.contractId}`,
    ).rejects.toThrow(/append-only/)
  })

  it('bloqueia TRUNCATE', async () => {
    await expect(sql`truncate makeup_ledger`).rejects.toThrow(/append-only/)
  })
})

describe('reschedule_class', () => {
  it('caso 7: recusa remarcação com menos que min_notice_hours de aviso', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    const instance = await createInstance(sql, c, { startsInHours: 10 })
    await expect(
      sql`select public.reschedule_class(${instance}, ${daysFromToday(7)}, '18:00')`,
    ).rejects.toThrow(/aviso mínimo/)
  })

  it('caso 8: alçada esgotada E saldo zero → recusa (e nada muda)', async () => {
    const c = await createPrivateContract(sql, { allowance: 0 })
    const instance = await createInstance(sql, c, { startsInHours: 48 })
    await expect(
      sql`select public.reschedule_class(${instance}, ${daysFromToday(7)}, '18:00')`,
    ).rejects.toThrow(/insuficiente/)
    const [row] = await sql`select state from class_instances where id = ${instance}`
    expect(row.state).toBe('scheduled') // transação inteira reverteu
  })

  it('consome alçada primeiro; com alçada esgotada, consome crédito', async () => {
    const c = await createPrivateContract(sql, { allowance: 1 })
    // FLAKE DE BORDA DE MÊS (aberto em 29/07, latente desde a F1): com
    // startsInHours 48/72, nos últimos dias do mês as duas originais caíam em
    // MESES locais diferentes — e o bucket da alçada é o mês da aula ORIGINAL
    // (ADR-008). A 2ª remarcação ganhava alçada nova em vez de consumir
    // crédito. Âncora determinística: dia 15 do mês SEGUINTE em Cuiabá —
    // mesmo bucket em qualquer data de execução, e sempre >48h no futuro.
    const agora = DateTime.now().setZone('America/Cuiaba')
    const alvo = agora.plus({ months: 1 }).set({ day: 15, hour: 12, minute: 0, second: 0, millisecond: 0 })
    const horasAteAncora = Math.round(alvo.diff(agora, 'hours').hours)
    const i1 = await createInstance(sql, c, { startsInHours: horasAteAncora })
    const i2 = await createInstance(sql, c, { startsInHours: horasAteAncora + 1 })
    await sql`select public.earn_makeup(${c.contractId}, 'initial_backlog', ${daysFromToday(60)})`

    // 1ª remarcação: via alçada (saldo intacto)
    await sql`select public.reschedule_class(${i1}, ${alvo.plus({ days: 5 }).toFormat('yyyy-LL-dd')}, '18:00')`
    expect(await balance(c.contractId)).toBe(1)
    const [usage] = await sql`
      select used_count from reschedule_usage where contract_id = ${c.contractId}`
    expect(usage.used_count).toBe(1)

    // 2ª remarcação com ORIGINAL no mesmo mês: alçada (1) esgotada → crédito
    await sql`select public.reschedule_class(${i2}, ${alvo.plus({ days: 6 }).toFormat('yyyy-LL-dd')}, '19:00')`
    expect(await balance(c.contractId)).toBe(0)
  })

  it('marca a original como rescheduled e cria a nova com reschedule_of e UTC correto', async () => {
    const c = await createPrivateContract(sql, { tz: 'America/Cuiaba' })
    const instance = await createInstance(sql, c, { startsInHours: 48, durationMin: 45 })
    const newDate = daysFromToday(10)
    const [res] = await sql`
      select public.reschedule_class(${instance}, ${newDate}, '18:00') as id`

    const [oldRow] = await sql`select state from class_instances where id = ${instance}`
    expect(oldRow.state).toBe('rescheduled')

    const [newRow] = await sql`
      select reschedule_of, state, local_time_snapshot,
             starts_at_utc at time zone 'UTC' as starts_utc,
             (ends_at_utc - starts_at_utc) as dur
      from class_instances where id = ${res.id}`
    expect(newRow.reschedule_of).toBe(instance)
    expect(newRow.state).toBe('scheduled')
    expect(newRow.local_time_snapshot).toBe(`${newDate} 18:00 America/Cuiaba`)
    // Cuiabá é UTC−4 fixo (sem DST): 18:00 local = 22:00Z, determinístico.
    expect(String(newRow.starts_utc)).toContain('22:00')
  })

  it('caso 14: remarcação gera linha em audit_log', async () => {
    const c = await createPrivateContract(sql)
    const instance = await createInstance(sql, c, { startsInHours: 48 })
    const [res] = await sql`
      select public.reschedule_class(${instance}, ${daysFromToday(9)}, '18:00') as id`
    const rows = await sql`
      select * from audit_log
      where action = 'reschedule_class' and entity_id = ${res.id}::text`
    expect(rows).toHaveLength(1)
    expect(rows[0].diff.rescheduled_from).toBe(instance)
  })

  it('recusa remarcação para data/hora no passado', async () => {
    const c = await createPrivateContract(sql)
    const instance = await createInstance(sql, c, { startsInHours: 48 })
    await expect(
      sql`select public.reschedule_class(${instance}, ${daysFromToday(-1)}, '18:00')`,
    ).rejects.toThrow(/já passou/)
  })

  it('contrato pausado não movimenta crédito nem remarca (ADR-011)', async () => {
    const c = await createPrivateContract(sql)
    const instance = await createInstance(sql, c, { startsInHours: 48 })
    await sql`select public.earn_makeup(${c.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    await sql`update contracts set status = 'paused' where id = ${c.contractId}`
    await expect(sql`select public.spend_makeup(${c.contractId})`).rejects.toThrow(/não está ativo/)
    await expect(
      sql`select public.reschedule_class(${instance}, ${daysFromToday(9)}, '18:00')`,
    ).rejects.toThrow(/não está ativo/)
  })

  it('recusa remarcar instância que não está scheduled', async () => {
    const c = await createPrivateContract(sql)
    const instance = await createInstance(sql, c, { startsInHours: 48 })
    await sql`select public.reschedule_class(${instance}, ${daysFromToday(9)}, '18:00')`
    await expect(
      sql`select public.reschedule_class(${instance}, ${daysFromToday(10)}, '18:00')`,
    ).rejects.toThrow(/não está agendada/)
  })
})

describe('conflito de agenda do professor (caso 6)', () => {
  it('rejeita 2ª instância do mesmo professor no mesmo horário', async () => {
    const c = await createPrivateContract(sql)
    const c2 = await createPrivateContract(sql)
    await sql`
      insert into class_instances (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${c.contractId}, ${c.teacherId}, '2027-03-01 20:00Z', '2027-03-01 20:45Z', 'a')`
    // mesmo início exato → índice único parcial (Lei 3)
    await expect(sql`
      insert into class_instances (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${c2.contractId}, ${c.teacherId}, '2027-03-01 20:00Z', '2027-03-01 20:45Z', 'b')`,
    ).rejects.toThrow()
    // sobreposição parcial → constraint de exclusão (ADR-008)
    await expect(sql`
      insert into class_instances (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${c2.contractId}, ${c.teacherId}, '2027-03-01 20:30Z', '2027-03-01 21:15Z', 'c')`,
    ).rejects.toThrow(/exclusion|conflict/i)
  })
})
