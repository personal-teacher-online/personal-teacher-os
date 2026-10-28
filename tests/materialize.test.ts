import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import type { Sql } from 'postgres'
import { connect, createPrivateContract, createSlot, proximaVirada } from './helpers/db'

// Casos DST do goal (Nova York e Lisboa mudam de regime em datas diferentes;
// Brasil não muda). As datas são RELATIVAS: a semana antes e a semana depois de
// cada uma das DUAS próximas viradas de cada zona (uma de recuo e uma de avanço,
// em qualquer época do ano). O caso cravado em 20/10/2026 (Lisboa) ficou
// vermelho no CI em 26/10/2026, quando a semana saiu do horizonte. Se o tzdata
// do Postgres divergir do Luxon, o teste FALHA e a divergência deve ser
// reportada — nunca ajustar o esperado.

let sql: Sql

beforeAll(() => {
  sql = connect(3)
})
afterAll(async () => {
  await sql.end()
})

/**
 * O dia da semana `weekday` (Luxon: 1 = segunda … 7 = domingo) dos dois lados
 * de cada uma das DUAS próximas viradas de `tz` — uma é de recuo e a outra de
 * avanço, então os dois sentidos ficam cobertos o ano inteiro. Para cada
 * virada: a última ocorrência antes do dia dela e a primeira depois. Devolve
 * também quantas semanas a materialização precisa para chegar à última. A
 * sonda parte de daqui a 8 dias, então nenhum dia cai em hoje nem no passado
 * (a materialização começa no dia de hoje da zona).
 */
function emVoltaDasViradas(tz: string, weekday: number) {
  const hoje = DateTime.now().setZone(tz).startOf('day')
  const primeira = proximaVirada(hoje.plus({ days: 8 }).set({ hour: 12 }))
  const segunda = proximaVirada(primeira.set({ hour: 12 }))
  const pares = [primeira, segunda].map((virada) => {
    const antes = virada.minus({ days: (virada.weekday - weekday + 7) % 7 || 7 })
    return { antes: antes.toISODate()!, depois: antes.plus({ days: 7 }).toISODate()! }
  })
  const ultima = DateTime.fromISO(pares[1].depois, { zone: tz })
  const semanas = Math.ceil(ultima.diff(hoje, 'days').days / 7) + 1
  return { pares, semanas }
}

/**
 * Materializa SÓ este horário fixo (o miolo de `materialize_instances`, que
 * chama `materialize_slot` horário a horário). A segunda virada pode estar a
 * um ano daqui: materializar o banco inteiro até lá encheria a agenda de todos
 * os outros testes que rodam em paralelo.
 */
async function materializeSlot(slotId: string, weeks: number): Promise<void> {
  await sql`select public.materialize_slot(${slotId}::uuid, ${weeks})`
}

/** O instante UTC de `hora` civil em `tz` naquele dia, no formato de `utcOf`. */
function utcEsperado(dia: string, hora: string, tz: string): string {
  return DateTime.fromISO(`${dia}T${hora}`, { zone: tz }).toUTC().toFormat('yyyy-LL-dd HH:mm')
}

async function materialize(weeks = 20): Promise<number> {
  const [row] = await sql`select public.materialize_instances(${weeks}) as n`
  return row.n as number
}

async function utcOf(slotId: string, occurrenceDate: string): Promise<string> {
  const [row] = await sql`
    select to_char(starts_at_utc at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as utc
    from class_instances
    where slot_id = ${slotId} and occurrence_date = ${occurrenceDate}`
  expect(row, `instância de ${occurrenceDate} não foi materializada`).toBeDefined()
  return row.utc as string
}

describe('materialize_instances — DST (casos 1–3)', () => {
  it('caso 1: Bianca qua 11:00 America/New_York — EDT e EST, dos dois lados das duas próximas viradas, local sempre 11:00', async () => {
    const c = await createPrivateContract(sql, { tz: 'America/New_York' })
    const slot = await createSlot(sql, c, { weekday: 3, localTime: '11:00', tz: 'America/New_York' })
    const { pares, semanas } = emVoltaDasViradas('America/New_York', 3)
    await materializeSlot(slot, semanas)
    const horas: string[][] = []
    for (const { antes, depois } of pares) {
      const utc = [await utcOf(slot, antes), await utcOf(slot, depois)]
      expect(utc).toEqual([antes, depois].map((d) => utcEsperado(d, '11:00', 'America/New_York')))
      horas.push(utc.map((u) => u.slice(11)))

      const snapshots = await sql`
        select local_time_snapshot from class_instances
        where slot_id = ${slot} and occurrence_date in (${antes}, ${depois})
        order by occurrence_date`
      expect(snapshots[0].local_time_snapshot).toBe(`${antes} 11:00 America/New_York`)
      expect(snapshots[1].local_time_snapshot).toBe(`${depois} 11:00 America/New_York`)
    }
    // a prova de que as duas viradas estão no meio, uma em cada sentido: 11:00
    // civis saem de 15:00Z (EDT, UTC−4) para 16:00Z (EST, UTC−5) no recuo e
    // fazem o caminho inverso no avanço
    expect(new Set(horas.map((h) => h.join('→')))).toEqual(new Set(['15:00→16:00', '16:00→15:00']))
  })

  it('caso 2: Joana ter 20:00 Europe/Lisbon — WEST e WET, dos dois lados das duas próximas viradas, local sempre 20:00', async () => {
    const c = await createPrivateContract(sql, { tz: 'Europe/Lisbon' })
    const slot = await createSlot(sql, c, { weekday: 2, localTime: '20:00', tz: 'Europe/Lisbon', durationMin: 60 })
    const { pares, semanas } = emVoltaDasViradas('Europe/Lisbon', 2)
    await materializeSlot(slot, semanas)
    const horas: string[] = []
    for (const { antes, depois } of pares) {
      const utc = [await utcOf(slot, antes), await utcOf(slot, depois)]
      expect(utc).toEqual([antes, depois].map((d) => utcEsperado(d, '20:00', 'Europe/Lisbon')))
      horas.push(utc.map((u) => u.slice(11)).join('→'))
    }
    // 20:00 civis saem de 19:00Z (WEST, UTC+1) para 20:00Z (WET, UTC+0) no
    // recuo e fazem o caminho inverso no avanço
    expect(new Set(horas)).toEqual(new Set(['19:00→20:00', '20:00→19:00']))
  })

  it('caso 3: Gabriel 16:45 America/Cuiaba — 20:45Z invariante (sem DST)', async () => {
    const c = await createPrivateContract(sql, { tz: 'America/Cuiaba' })
    const slot = await createSlot(sql, c, { weekday: 3, localTime: '16:45', tz: 'America/Cuiaba' })
    await materialize()
    const rows = await sql`
      select distinct to_char(starts_at_utc at time zone 'UTC', 'HH24:MI') as hm
      from class_instances where slot_id = ${slot}`
    expect(rows).toHaveLength(1)
    expect(rows[0].hm).toBe('20:45')
  })
})

describe('caso 4: exibição cruzada (camada TS/Luxon)', () => {
  it('aula da Bianca vista da zona da dona desloca 11:00 → 12:00 após a transição', () => {
    // Instantes UTC de 2026 (cálculo puro, sem banco: data no passado não pesa;
    // o caso 1 prova a mesma regra no banco, com datas relativas)
    const before = DateTime.fromISO('2026-10-28T15:00:00Z').setZone('America/Cuiaba')
    const after = DateTime.fromISO('2026-11-04T16:00:00Z').setZone('America/Cuiaba')
    // Para a Bianca, sempre 11:00 local
    expect(DateTime.fromISO('2026-10-28T15:00:00Z').setZone('America/New_York').toFormat('HH:mm')).toBe('11:00')
    expect(DateTime.fromISO('2026-11-04T16:00:00Z').setZone('America/New_York').toFormat('HH:mm')).toBe('11:00')
    // Para a dona em Cuiabá, o deslocamento é correto e esperado
    expect(before.toFormat('HH:mm')).toBe('11:00')
    expect(after.toFormat('HH:mm')).toBe('12:00')
  })
})

describe('idempotência e horizonte', () => {
  it('rodar duas vezes não duplica nada', async () => {
    const c = await createPrivateContract(sql, { tz: 'America/Cuiaba' })
    const slot = await createSlot(sql, c, { weekday: 1, localTime: '09:00', tz: 'America/Cuiaba' })
    await materialize(8)
    const [first] = await sql`
      select count(*)::int as n from class_instances where slot_id = ${slot}`
    expect(first.n).toBeGreaterThanOrEqual(7) // ~8 semanas de segundas-feiras

    await materialize(8)
    const [second] = await sql`
      select count(*)::int as n from class_instances where slot_id = ${slot}`
    expect(second.n).toBe(first.n)
  })

  it('instância remarcada não é recriada pelo job', async () => {
    const c = await createPrivateContract(sql, { tz: 'America/Cuiaba' })
    const slot = await createSlot(sql, c, { weekday: 4, localTime: '10:00', tz: 'America/Cuiaba' })
    await materialize(4)
    const [inst] = await sql`
      select id, occurrence_date from class_instances
      where slot_id = ${slot} order by starts_at_utc desc limit 1`
    await sql`update class_instances set state = 'rescheduled' where id = ${inst.id}`

    await materialize(4)
    const rows = await sql`
      select count(*)::int as n from class_instances
      where slot_id = ${slot} and occurrence_date = ${inst.occurrence_date}`
    expect(rows[0].n).toBe(1) // a chave continua ocupada pela remarcada
  })

  it('respeita active_to (slot fechado não gera além do fim)', async () => {
    const c = await createPrivateContract(sql, { tz: 'America/Cuiaba' })
    const [row] = await sql`
      insert into recurring_slots
        (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from, active_to)
      values (${c.contractId}, ${c.teacherId}, 5, '11:00', 'America/Cuiaba', 45,
              '2026-01-01', current_date + 10)
      returning id`
    await materialize(8)
    const bad = await sql`
      select count(*)::int as n from class_instances
      where slot_id = ${row.id} and occurrence_date > current_date + 10`
    expect(bad[0].n).toBe(0)
  })
})

describe('agendamento pg_cron', () => {
  it('job semanal registrado', async () => {
    const rows = await sql`
      select schedule, command from cron.job where jobname = 'materialize-instances-weekly'`
    expect(rows).toHaveLength(1)
    expect(rows[0].schedule).toBe('0 6 * * 0')
    expect(rows[0].command).toContain('materialize_instances')
  })
})
