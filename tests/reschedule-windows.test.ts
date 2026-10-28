// Fase 2 / M1 — Janelas de remarcação (D1/D10/D12/D13/D15).
// Casos do goal cobertos aqui: 5, 6, 7 (essência), 8 (corrida), 15 (cross-fuso),
// 16 (professora errada), 17 (posse), 20 (re-remarcação) + resgate D12 + D15.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createInstance,
  createPrivateContract,
  createSlot,
  daysFromToday,
  instanteEm,
  proximoRecuo,
} from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin janelas'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/** Contrato + aluno AUTENTICADO (profile vinculado — my_contract_ids enxerga). */
async function contractWithLogin(opts: Parameters<typeof createPrivateContract>[1] = {}) {
  const c = await createPrivateContract(sql, opts)
  const userId = await createAuthUser(sql, 'student', 'Aluno janela')
  await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
  const client = await clientAs(userId, 'student')
  return { ...c, userId, client }
}

async function publish(teacherId: string, daysAhead: number, time = '15:00') {
  const { data, error } = await admin.rpc('publish_reschedule_window', {
    p_teacher: teacherId,
    p_starts_at_utc: instanteEm(daysFromToday(daysAhead), time),
  })
  expect(error).toBeNull()
  return data as string
}

async function windowRow(id: string) {
  const [w] = await sql`select * from reschedule_windows where id = ${id}`
  return w
}

describe('publicação (admin-only)', () => {
  it('admin publica; starts_at_utc derivado com o offset do dia (Lei 1)', async () => {
    const c = await createPrivateContract(sql)
    const id = await publish(c.teacherId, 7, '14:30')
    const w = await windowRow(id)
    expect(w.state).toBe('publicada')
    const [chk] = await sql`
      select ((${w.local_date}::date + ${w.local_time}::time) at time zone ${w.iana_tz}) = ${w.starts_at_utc}::timestamptz as ok`
    expect(chk.ok).toBe(true)
  })

  it('aluno NÃO publica (D10)', async () => {
    const { client, teacherId } = await contractWithLogin()
    const { error } = await client.rpc('publish_reschedule_window', {
      p_teacher: teacherId,
      p_starts_at_utc: instanteEm(daysFromToday(7), '10:00'),
    })
    expect(error?.message).toContain('D10')
  })

  it('mesma professora + mesmo instante publicado 2x → única (índice parcial)', async () => {
    const c = await createPrivateContract(sql)
    await publish(c.teacherId, 6, '09:00')
    const { error } = await admin.rpc('publish_reschedule_window', {
      p_teacher: c.teacherId,
      p_starts_at_utc: instanteEm(daysFromToday(6), '09:00'),
    })
    expect(error).not.toBeNull()
  })
})

describe('caso 5/6/7: consumo com regras no banco', () => {
  it('caso 5: remarcação via janela — instante copiado, janela consumida com rastro', async () => {
    const { client, contractId, teacherId } = await contractWithLogin()
    const inst = await createInstance(sql, { contractId, teacherId }, { startsInHours: 72 })
    const win = await publish(teacherId, 7)

    const { data: newId, error } = await client.rpc('book_reschedule_window', {
      p_window: win,
      p_instance: inst,
    })
    expect(error).toBeNull()

    const w = await windowRow(win)
    expect(w.state).toBe('consumida')
    expect(w.consumed_by_instance_id).toBe(newId)
    const [ni] = await sql`select starts_at_utc, state, reschedule_of from class_instances where id = ${newId}`
    expect(ni.starts_at_utc.toISOString()).toBe(w.starts_at_utc.toISOString())
    expect(ni.state).toBe('scheduled')
    expect(ni.reschedule_of).toBe(inst)
    const [orig] = await sql`select state from class_instances where id = ${inst}`
    expect(orig.state).toBe('rescheduled')
    const [audit] = await sql`
      select diff from audit_log where action = 'book_reschedule_window' and entity_id = ${win}`
    expect(audit.diff.mode).toBe('reschedule')
  })

  it('caso 6: sem alçada e sem crédito → recusa amigável; janela segue publicada', async () => {
    const { client, contractId, teacherId } = await contractWithLogin({ allowance: 0 })
    const inst = await createInstance(sql, { contractId, teacherId }, { startsInHours: 72 })
    const win = await publish(teacherId, 7)

    const { error } = await client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    expect(error?.message).toContain('saldo')
    expect((await windowRow(win)).state).toBe('publicada')
    const [orig] = await sql`select state from class_instances where id = ${inst}`
    expect(orig.state).toBe('scheduled')
  })

  it('F2/M2-1: janela dentro da antecedência mínima da professora → recusada; janela segue publicada', async () => {
    const { client, contractId, teacherId } = await contractWithLogin()
    // lead enorme para o teste ser determinístico: janela de amanhã fica "perto demais"
    await sql`update teachers set min_booking_lead_hours = 100 where id = ${teacherId}`
    const inst = await createInstance(sql, { contractId, teacherId }, { startsInHours: 10 * 24 })
    const win = await publish(teacherId, 1)

    const { error } = await client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    expect(error?.message).toContain('antecedência')
    expect((await windowRow(win)).state).toBe('publicada')
    const [orig] = await sql`select state from class_instances where id = ${inst}`
    expect(orig.state).toBe('scheduled')
  })

  it('F2/M2-1: ANTECIPAR agora é permitido (o "não adiantar" saiu — racional novo por cima)', async () => {
    const { client, contractId, teacherId } = await contractWithLogin()
    // Aula daqui a 8 dias; janela daqui a 7 (fora da antecedência de 12h) → ACEITA.
    const inst = await createInstance(sql, { contractId, teacherId }, { startsInHours: 8 * 24 })
    const win = await publish(teacherId, 7)

    const { error } = await client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    expect(error).toBeNull()
    expect((await windowRow(win)).state).toBe('consumida')
  })

  it('caso 7 (essência): janela a mais de 2 semanas → recusada PELO BANCO', async () => {
    const { client, contractId, teacherId } = await contractWithLogin()
    const inst = await createInstance(sql, { contractId, teacherId }, { startsInHours: 72 })
    const win = await publish(teacherId, 20)

    const { error } = await client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    expect(error?.message).toContain('2 semanas')
  })

  it('janela cancelada não é consumível; consumida não é cancelável (D15)', async () => {
    const { client, contractId, teacherId } = await contractWithLogin()
    const inst = await createInstance(sql, { contractId, teacherId }, { startsInHours: 72 })

    const winCancel = await publish(teacherId, 5)
    await admin.rpc('cancel_reschedule_window', { p_window: winCancel })
    const { error: e1 } = await client.rpc('book_reschedule_window', { p_window: winCancel, p_instance: inst })
    expect(e1?.message).toContain('não está disponível')

    const winBook = await publish(teacherId, 6)
    await client.rpc('book_reschedule_window', { p_window: winBook, p_instance: inst })
    const { error: e2 } = await admin.rpc('cancel_reschedule_window', { p_window: winBook })
    expect(e2?.message).toContain('não está publicada')
    expect((await windowRow(winBook)).state).toBe('consumida')
  })
})

describe('caso 8: corrida — dois alunos, uma janela', () => {
  it('exatamente um vence; a janela nunca duplica', async () => {
    const a = await contractWithLogin()
    // Aluno B com a MESMA professora (contrato próprio).
    const b = await (async () => {
      // c15 · Sol 6: o contrato NASCE com a professora certa. Era um `update
      // contracts set teacher_id`, e trocar a professora de um contrato virou
      // recusa do gatilho `contracts_vinculo_imutavel` (o extrato dela e o
      // conflito de agenda saem do contrato: trocar por UPDATE reescreveria
      // retroativamente de quem foi a aula).
      const c = await createPrivateContract(sql, { teacherId: a.teacherId })
      const userId = await createAuthUser(sql, 'student', 'Aluno corrida B')
      await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
      return { ...c, teacherId: a.teacherId, client: await clientAs(userId, 'student') }
    })()
    const instA = await createInstance(sql, { contractId: a.contractId, teacherId: a.teacherId }, { startsInHours: 72 })
    const instB = await createInstance(sql, { contractId: b.contractId, teacherId: a.teacherId }, { startsInHours: 96 })
    const win = await publish(a.teacherId, 7)

    const [ra, rb] = await Promise.all([
      a.client.rpc('book_reschedule_window', { p_window: win, p_instance: instA }),
      b.client.rpc('book_reschedule_window', { p_window: win, p_instance: instB }),
    ])
    const oks = [ra, rb].filter((r) => r.error === null)
    expect(oks).toHaveLength(1)
    const w = await windowRow(win)
    expect(w.state).toBe('consumida')
    const [{ count }] = await sql`
      select count(*)::int as count from class_instances
      where starts_at_utc = ${w.starts_at_utc} and teacher_id = ${a.teacherId} and state = 'scheduled'`
    expect(count).toBe(1)
  })
})

describe('caso 15: invariante cross-fuso — instante byte a byte', () => {
  it('aluna de Lisboa consome janela de Cuiabá: starts_at_utc idêntico ao publicado', async () => {
    const { client, contractId, teacherId } = await contractWithLogin({ tz: 'Europe/Lisbon' })
    const inst = await createInstance(sql, { contractId, teacherId }, { startsInHours: 72 })
    const win = await publish(teacherId, 10, '11:00')
    const w = await windowRow(win)

    const { data: newId, error } = await client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    expect(error).toBeNull()
    const [ni] = await sql`select starts_at_utc from class_instances where id = ${newId}`
    expect(ni.starts_at_utc.toISOString()).toBe(w.starts_at_utc.toISOString())
  })

  it('mecanismo (overload por instante) atravessa a virada de DST de Lisboa sem reconverter', async () => {
    // A PRÓXIMA noite de recuo de Lisboa (fim do DST), nunca cravada: a RPC
    // recusa remarcação para o passado, e o caso cravado em 25/10/2026 ficou
    // vermelho no CI em 26/10/2026. O instante alvo é fixado em UTC e NÃO pode
    // ser alterado por ida-e-volta pela hora local (hora ambígua na virada).
    const dia = proximoRecuo('Europe/Lisbon').toISODate()!
    const c = await createPrivateContract(sql, { tz: 'Europe/Lisbon' })
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    const target = `${dia}T01:30:00.000Z` // 01:30 UTC da madrugada ambígua em Lisboa
    // a prova de que o alvo cai na hora repetida: 00:30Z e 01:30Z são, os dois,
    // 01:30 no relógio de Lisboa
    const [{ primeira, segunda }] = await sql<{ primeira: string; segunda: string }[]>`
      select to_char((${target}::timestamptz - interval '1 hour') at time zone 'Europe/Lisbon', 'HH24:MI') as primeira,
             to_char(${target}::timestamptz at time zone 'Europe/Lisbon', 'HH24:MI') as segunda`
    expect([primeira, segunda]).toEqual(['01:30', '01:30'])
    const [r] = await sql`
      select public.reschedule_class_at(${inst}::uuid, ${target}::timestamptz, 'teste dst', null) as id`
    const [ni] = await sql`select starts_at_utc from class_instances where id = ${r.id}`
    expect(ni.starts_at_utc.toISOString()).toBe(target)
  })
})

describe('caso 16: janela de outra professora', () => {
  it('recusado pelo banco; janela permanece publicada', async () => {
    const { client, contractId, teacherId } = await contractWithLogin()
    const outra = await createPrivateContract(sql) // outra professora
    const inst = await createInstance(sql, { contractId, teacherId }, { startsInHours: 72 })
    const win = await publish(outra.teacherId, 7)

    const { error } = await client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    expect(error?.message).toContain('outra professora')
    expect((await windowRow(win)).state).toBe('publicada')
  })
})

describe('caso 17: posse (D10) — cross-tenant não passa', () => {
  it('aluno B (e sales) não consome janela com aula do aluno A; nada muda', async () => {
    const a = await contractWithLogin()
    const instA = await createInstance(sql, { contractId: a.contractId, teacherId: a.teacherId }, { startsInHours: 72 })
    const win = await publish(a.teacherId, 7)

    const b = await contractWithLogin()
    const sales = await clientAs(await createAuthUser(sql, 'sales', 'Sales posse'), 'sales')

    for (const attacker of [b.client, sales]) {
      const { error } = await attacker.rpc('book_reschedule_window', { p_window: win, p_instance: instA })
      expect(error?.message).toContain('D10')
    }
    expect((await windowRow(win)).state).toBe('publicada')
    const [{ count }] = await sql`
      select count(*)::int as count from reschedule_usage where contract_id = ${a.contractId}`
    expect(count).toBe(0)
  })
})

describe('caso 20: re-remarcação (D13) — permitida, alçada no mês da aula remarcada', () => {
  it('remarcar a aula já remarcada funciona; períodos da alçada seguem a data local de cada aula movida', async () => {
    const { client, contractId, teacherId } = await contractWithLogin()
    const inst = await createInstance(sql, { contractId, teacherId }, { startsInHours: 72 })
    const win1 = await publish(teacherId, 6, '10:00')
    const { data: mid } = await client.rpc('book_reschedule_window', { p_window: win1, p_instance: inst })

    const win2 = await publish(teacherId, 12, '10:00')
    const { data: fin, error } = await client.rpc('book_reschedule_window', { p_window: win2, p_instance: mid })
    expect(error).toBeNull()

    const [mi] = await sql`select state from class_instances where id = ${mid}`
    expect(mi.state).toBe('rescheduled')
    const [fi] = await sql`select state, reschedule_of from class_instances where id = ${fin}`
    expect(fi.state).toBe('scheduled')
    expect(fi.reschedule_of).toBe(mid)

    // Alçada: 1 uso no mês da data local da aula ORIGINAL + 1 no mês da INTERMEDIÁRIA.
    const [expected] = await sql`
      select to_char((i.starts_at_utc at time zone s.iana_tz)::date, 'YYYY-MM') as p1,
             to_char((m.starts_at_utc at time zone s.iana_tz)::date, 'YYYY-MM') as p2
      from class_instances i, class_instances m, contracts c
      join students s on s.id = c.student_id
      where i.id = ${inst} and m.id = ${mid} and c.id = ${contractId}`
    const usage = await sql`
      select period_ym, used_count from reschedule_usage where contract_id = ${contractId} order by period_ym`
    const total = usage.reduce((acc: number, u) => acc + Number(u.used_count), 0)
    expect(total).toBe(2)
    const periods = usage.map((u) => u.period_ym)
    expect(periods).toContain(expected.p1)
    expect(periods).toContain(expected.p2)
  })
})

describe('D12: resgate de crédito como aula avulsa', () => {
  it('consome crédito, cria instância com a duração do slot, consome a janela', async () => {
    const { client, contractId, teacherId, studentId } = await contractWithLogin()
    // Slot às 06:00 de propósito: a materialização GLOBAL de materialize.test.ts
    // roda em paralelo e cria instâncias deste slot; se o horário do slot
    // coincidir com o da janela (e daysFromToday(8) cair no weekday do slot —
    // acontece às segundas), o resgate colide com a instância materializada.
    await createSlot(sql, { contractId, teacherId }, { weekday: 2, localTime: '06:00', tz: 'America/Cuiaba', durationMin: 60 })
    await sql`select public.earn_makeup(${contractId}, 'initial_backlog', ${daysFromToday(60)}, ${studentId})`
    const win = await publish(teacherId, 8, '18:00')
    const w = await windowRow(win)

    const { data: newId, error } = await client.rpc('book_reschedule_window', {
      p_window: win,
      p_contract: contractId,
    })
    expect(error).toBeNull()

    const [ni] = await sql`
      select starts_at_utc, ends_at_utc, reschedule_of, slot_id from class_instances where id = ${newId}`
    expect(ni.starts_at_utc.toISOString()).toBe(w.starts_at_utc.toISOString())
    expect((ni.ends_at_utc.getTime() - ni.starts_at_utc.getTime()) / 60000).toBe(60)
    expect(ni.reschedule_of).toBeNull()
    expect(ni.slot_id).toBeNull()
    const [bal] = await sql`select public.makeup_balance(${contractId}) as b`
    expect(Number(bal.b)).toBe(0)
    expect((await windowRow(win)).state).toBe('consumida')
  })

  it('sem saldo → recusa e a janela volta intacta (rollback total)', async () => {
    const { client, contractId, teacherId } = await contractWithLogin()
    // 06:00: não pode sobrepor a janela (a instância nasce ANTES do gasto no RPC
    // e a materialização global paralela criaria overlap — ver teste acima).
    await createSlot(sql, { contractId, teacherId }, { weekday: 3, localTime: '06:00', tz: 'America/Cuiaba' })
    const win = await publish(teacherId, 8, '09:30')

    const { error } = await client.rpc('book_reschedule_window', { p_window: win, p_contract: contractId })
    expect(error?.message).toContain('saldo')
    expect((await windowRow(win)).state).toBe('publicada')
    const [{ count }] = await sql`
      select count(*)::int as count from class_instances
      where contract_id = ${contractId} and slot_id is null`
    expect(count).toBe(0)
  })

  it('contrato sem slot ativo → erro claro (duração indefinida)', async () => {
    const { client, contractId, teacherId } = await contractWithLogin()
    await sql`select public.earn_makeup(${contractId}, 'initial_backlog', ${daysFromToday(60)})`
    const win = await publish(teacherId, 8, '10:30')
    const { error } = await client.rpc('book_reschedule_window', { p_window: win, p_contract: contractId })
    expect(error?.message).toContain('slot ativo')
  })

  it('informar instância E contrato (ou nenhum) → erro de uso', async () => {
    const { client, contractId, teacherId } = await contractWithLogin()
    const inst = await createInstance(sql, { contractId, teacherId }, { startsInHours: 72 })
    const win = await publish(teacherId, 8, '11:30')
    const both = await client.rpc('book_reschedule_window', {
      p_window: win, p_instance: inst, p_contract: contractId,
    })
    expect(both.error?.message).toContain('OU')
    const neither = await client.rpc('book_reschedule_window', { p_window: win })
    expect(neither.error?.message).toContain('OU')
  })
})

describe('D12 + D3: resgate do CASAL (contrato de grupo) — o caso dominante do lançamento', () => {
  async function groupContract() {
    const [n] = await sql`insert into students (display_name, iana_tz, tz_confirmed) values ('Natália T', 'America/Cuiaba', true) returning id`
    const [y] = await sql`insert into students (display_name, iana_tz, tz_confirmed) values ('Yago T', 'America/Cuiaba', true) returning id`
    const [g] = await sql`insert into student_groups (label) values ('Casal teste') returning id`
    await sql`insert into student_group_members (group_id, student_id) values (${g.id}, ${n.id}), (${g.id}, ${y.id})`
    const [t] = await sql`insert into teachers (hourly_rate_cents, display_name) values (10000, 'Prof casal') returning id`
    const [c] = await sql`
      insert into contracts (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
                             monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${g.id}, ${t.id}, 'casal teste', 15000, 2, 24, 90, current_date)
      returning id`
    // 06:00: desacoplado da janela de 21:15 (materialização global paralela —
    // ver comentário no teste do resgate D12).
    await createSlot(sql, { contractId: c.id, teacherId: t.id }, { weekday: 4, localTime: '06:00', tz: 'America/Cuiaba' })
    const userId = await createAuthUser(sql, 'student', 'Natália login')
    await sql`update students set profile_id = ${userId} where id = ${n.id}`
    return { contractId: c.id as string, teacherId: t.id as string, client: await clientAs(userId, 'student') }
  }

  it('casal resgata → professora cancela a aula resgatada → crédito D2 nasce com D11 pela zona dos membros', async () => {
    const { contractId, teacherId, client } = await groupContract()
    await sql`select public.earn_makeup(${contractId}, 'initial_backlog', ${daysFromToday(60)})`
    const win = await publish(teacherId, 8, '21:15')

    const { data: newId, error } = await client.rpc('book_reschedule_window', {
      p_window: win,
      p_contract: contractId,
    })
    expect(error).toBeNull()
    const [b1] = await sql`select public.makeup_balance(${contractId}) as b`
    expect(Number(b1.b)).toBe(0)

    // A professora cancela a aula resgatada (linha 1 da matriz D2) — antes quebrava
    // com "zona IANA" NULL em contrato de grupo (achado do painel do gate).
    const adminC = await clientAs(await createAuthUser(sql, 'admin', 'Admin casal'), 'admin')
    const { error: cErr } = await adminC.rpc('cancel_class', {
      p_instance: newId,
      p_cancelled_by: 'teacher',
    })
    expect(cErr).toBeNull()
    const [b2] = await sql`select public.makeup_balance(${contractId}) as b`
    expect(Number(b2.b)).toBe(1)
    // F1/M3-3: cancelar uma aula NASCIDA de crédito devolve por ESTORNO formal
    // (reason 'refund', regra ii: professora → validade-escola da data da
    // reposição, pela zona dos membros) — não mais um earn_cancellation genérico.
    const [exp] = await sql`
      select (l.expires_on = ((i.starts_at_utc at time zone 'America/Cuiaba')::date
                              + c.school_fault_credit_expiry_days)) as ok,
             l.refund_of is not null as linked
      from makeup_ledger l, class_instances i, contracts c
      where l.contract_id = ${contractId} and l.reason = 'refund'
        and i.id = ${newId} and c.id = ${contractId}`
    expect(exp.ok).toBe(true)
    expect(exp.linked).toBe(true)
  })

  it('casal re-remarca a aula resgatada (D13) sem erro de zona', async () => {
    const { contractId, teacherId, client } = await groupContract()
    await sql`select public.earn_makeup(${contractId}, 'initial_backlog', ${daysFromToday(60)})`
    const win1 = await publish(teacherId, 8, '10:00')
    const { data: inst } = await client.rpc('book_reschedule_window', { p_window: win1, p_contract: contractId })

    const win2 = await publish(teacherId, 12, '10:00')
    const { data: newId, error } = await client.rpc('book_reschedule_window', { p_window: win2, p_instance: inst })
    expect(error).toBeNull()
    const [ni] = await sql`select state from class_instances where id = ${newId}`
    expect(ni.state).toBe('scheduled')
  })
})

describe('RLS: quem vê janelas', () => {
  it('aluno vê SÓ publicadas das professoras dos contratos dele', async () => {
    const a = await contractWithLogin()
    const winMine = await publish(a.teacherId, 5, '13:00')
    const outro = await createPrivateContract(sql)
    const winOther = await publish(outro.teacherId, 5, '13:00')

    const { data } = await a.client.from('reschedule_windows').select('id')
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(winMine)
    expect(ids).not.toContain(winOther)
  })

  it('escrita direta de cliente na tabela é negada (só RPC)', async () => {
    const a = await contractWithLogin()
    const win = await publish(a.teacherId, 5, '16:00')
    const upd = await a.client
      .from('reschedule_windows')
      .update({ state: 'cancelada' })
      .eq('id', win)
      .select()
    expect(upd.error?.code === '42501' || (upd.data ?? []).length === 0).toBe(true)
    expect((await windowRow(win)).state).toBe('publicada')
  })
})
