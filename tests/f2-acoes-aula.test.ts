// F2 — Ações de aula (plano integrado v2, 18/07/2026): avulsa com tipo (M1-1),
// lote "aconteceram" (M1-3), cortesia (M1-6), antecedência no destino (M2-1),
// autocancelamento com aviso (M2-3/P4) e régua das avulsas no extrato (P22).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createInstance,
  createPrivateContract,
  daysFromToday,
  instanteEm,
} from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F2'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

describe('M1-1 — aula avulsa e experimental', () => {
  it('extra cobrada nasce com tipo/valor/duração; cortesia dispensa valor; extra sem valor recusa', async () => {
    const c = await createPrivateContract(sql)
    const { data: id, error } = await admin.rpc('admin_create_single_class', {
      p_contract: c.contractId,
      p_starts_at_utc: instanteEm(daysFromToday(3), '14:00'),
      p_duration_min: 60,
      p_kind: 'extra_paid',
      p_price_cents: 15000,
    })
    expect(error).toBeNull()
    const [row] = await sql`
      select single_kind, single_price_cents,
             round(extract(epoch from (ends_at_utc - starts_at_utc)) / 60)::int as dur
      from class_instances where id = ${id}`
    expect(row.single_kind).toBe('extra_paid')
    expect(row.single_price_cents).toBe(15000)
    expect(row.dur).toBe(60)

    const semValor = await admin.rpc('admin_create_single_class', {
      p_contract: c.contractId,
      p_starts_at_utc: instanteEm(daysFromToday(4), '14:00'),
      p_duration_min: 45,
      p_kind: 'extra_paid',
    })
    expect(semValor.error?.message).toContain('valor')

    const cortesia = await admin.rpc('admin_create_single_class', {
      p_contract: c.contractId,
      p_starts_at_utc: instanteEm(daysFromToday(5), '14:00'),
      p_duration_min: 30,
      p_kind: 'courtesy',
    })
    expect(cortesia.error).toBeNull()
  })

  it('conflito de agenda da professora é traduzido (exclusion constraint)', async () => {
    const c = await createPrivateContract(sql)
    const mk = () =>
      admin.rpc('admin_create_single_class', {
        p_contract: c.contractId,
        p_starts_at_utc: instanteEm(daysFromToday(6), '10:00'),
        p_duration_min: 45,
        p_kind: 'courtesy',
      })
    expect((await mk()).error).toBeNull()
    const dup = await mk()
    expect(dup.error?.message).toContain('conflito de agenda')
  })

  it('OBRIGATÓRIO: experimental NÃO dispara geração de 8 semanas — provado', async () => {
    const [{ count: teachersBefore }] = await sql`select count(*)::int as count from teachers`
    const [t] = await sql`insert into teachers (hourly_rate_cents) values (9000) returning id`
    const { data: instId, error } = await admin.rpc('admin_create_trial_class', {
      p_student_name: 'Pessoa Experimental',
      p_iana_tz: 'America/Sao_Paulo',
      p_teacher: t.id,
      p_starts_at_utc: instanteEm(daysFromToday(3), '09:00', 'America/Sao_Paulo'),
      p_duration_min: 45,
      p_price_cents: 8000,
    })
    expect(error).toBeNull()
    expect(teachersBefore).toBeGreaterThan(0)

    const [inst] = await sql`
      select contract_id, single_kind from class_instances where id = ${instId}`
    expect(inst.single_kind).toBe('trial')
    const [contract] = await sql`
      select is_trial, plan_name from contracts where id = ${inst.contract_id}`
    expect(contract.is_trial).toBe(true)

    const count = async () => {
      const [r] = await sql`
        select count(*)::int as n from class_instances where contract_id = ${inst.contract_id}`
      return r.n as number
    }
    expect(await count()).toBe(1)
    // a materialização GLOBAL roda e NADA nasce para o contrato experimental
    await sql`select public.materialize_instances(8)`
    expect(await count()).toBe(1)
  })
})

describe('M1-3 — lote "todas aconteceram" (rodada 3: IDs explícitos da fila)', () => {
  // A RPC deixou de selecionar por tempo (`now()` no submit ≠ o "agora" que a
  // tela congelou no render — a corrida atestava aula que terminasse no meio).
  // Agora ela recebe os IDs EXATOS que a tela confirmou e valida um a um.
  it('atesta os IDs confirmados: conta só quem tem apontamento; aula fora da lista fica intacta', async () => {
    const c = await createPrivateContract(sql)
    const p1 = await createInstance(sql, c, { startsInHours: -30 })
    const p2 = await createInstance(sql, c, { startsInHours: -5 })
    // D2 (20/07): dentro da lista mas SEM apontamento → pulada, não estoura
    const semApontamento = await createInstance(sql, c, { startsInHours: -3 })
    // passada, apontada, mas FORA da lista confirmada → o lote não a toca
    const foraDaLista = await createInstance(sql, c, { startsInHours: -2 })
    await admin.rpc('report_class_content', { p_instance: p1, p_off_kind: 'outro', p_off_note: 'teste' })
    await admin.rpc('report_class_content', { p_instance: p2, p_off_kind: 'outro', p_off_note: 'teste' })
    await admin.rpc('report_class_content', { p_instance: foraDaLista, p_off_kind: 'outro', p_off_note: 'teste' })

    const { data: n, error } = await admin.rpc('admin_complete_past_batch', {
      p_teacher: c.teacherId,
      p_instances: [p1, p2, semApontamento],
    })
    expect(error).toBeNull()
    expect(n).toBe(2)

    const states = await sql`
      select id, state from class_instances where id in (${p1}, ${p2}, ${semApontamento}, ${foraDaLista})`
    const byId = new Map(states.map((r) => [r.id, r.state]))
    expect(byId.get(p1)).toBe('completed')
    expect(byId.get(p2)).toBe('completed')
    expect(byId.get(semApontamento)).toBe('scheduled')
    expect(byId.get(foraDaLista)).toBe('scheduled')

    const perClass = await sql`
      select diff from audit_log
      where action = 'complete_class' and entity_id in (${p1}::text, ${p2}::text)`
    expect(perClass).toHaveLength(2)
    for (const r of perClass) expect(r.diff.batch).toBeTruthy()
    const batchRows = await sql`
      select diff from audit_log
      where action = 'complete_class_batch' and diff->>'teacher_id' = ${c.teacherId}`
    expect(Number(batchRows[0].diff.count)).toBe(2)
    expect(batchRows[0].diff.skipped_sem_apontamento).toContain(semApontamento)
  })

  it('ID duplicado no lote vale UM (dedup no banco): atesta uma vez, audita uma vez', async () => {
    // Sol · rodada 4: a tela nunca manda repetido, mas a função é endpoint.
    // Sem o dedup, a duplicata ora abortava com o recado errado (a 2ª conclusão
    // estoura dentro de complete_class), ora entrava dobrada na auditoria.
    const c = await createPrivateContract(sql)
    const p1 = await createInstance(sql, c, { startsInHours: -5 })
    await admin.rpc('report_class_content', { p_instance: p1, p_off_kind: 'outro', p_off_note: 'teste' })

    const { data: n, error } = await admin.rpc('admin_complete_past_batch', {
      p_teacher: c.teacherId,
      p_instances: [p1, p1],
    })
    expect(error).toBeNull()
    expect(n).toBe(1)
    const [st] = await sql`select state from class_instances where id = ${p1}`
    expect(st.state).toBe('completed')
    const batchRows = await sql`
      select diff from audit_log
      where action = 'complete_class_batch' and diff->>'teacher_id' = ${c.teacherId}`
    expect(batchRows[0].diff.instances).toHaveLength(1)
  })

  it('LEI: aula ainda não terminada aborta o lote INTEIRO — nada é concluído', async () => {
    // All-or-nothing: a confirmação da dona valia para aquele conjunto exato.
    // Se um ID não passa (aqui: aula futura), nem os válidos são atestados.
    const c = await createPrivateContract(sql)
    const passada = await createInstance(sql, c, { startsInHours: -5 })
    const futura = await createInstance(sql, c, { startsInHours: 48 })
    await admin.rpc('report_class_content', { p_instance: passada, p_off_kind: 'outro', p_off_note: 'teste' })

    const r = await admin.rpc('admin_complete_past_batch', {
      p_teacher: c.teacherId,
      p_instances: [passada, futura],
    })
    expect(r.error?.message).toContain('a fila de pendências mudou')
    const [st] = await sql`select state from class_instances where id = ${passada}`
    expect(st.state).toBe('scheduled')
  })

  it('LEI: aula de OUTRA professora na lista recusa o lote', async () => {
    const c = await createPrivateContract(sql)
    const alheio = await createPrivateContract(sql) // professora própria
    const aulaAlheia = await createInstance(sql, alheio, { startsInHours: -5 })
    await admin.rpc('report_class_content', { p_instance: aulaAlheia, p_off_kind: 'outro', p_off_note: 'teste' })

    const r = await admin.rpc('admin_complete_past_batch', {
      p_teacher: c.teacherId,
      p_instances: [aulaAlheia],
    })
    expect(r.error?.message).toContain('a fila de pendências mudou')
  })

  it('LEI: sem professora recusa — S2-7 agora é regra do banco (Lei 3)', async () => {
    const c = await createPrivateContract(sql)
    const p = await createInstance(sql, c, { startsInHours: -5 })
    const r = await admin.rpc('admin_complete_past_batch', {
      p_teacher: null,
      p_instances: [p],
    })
    expect(r.error?.message).toContain('por professora')
  })

  it('LEI: lote sem nenhuma aula recusa', async () => {
    const c = await createPrivateContract(sql)
    const r = await admin.rpc('admin_complete_past_batch', {
      p_teacher: c.teacherId,
      p_instances: [],
    })
    expect(r.error?.message).toContain('sem nenhuma aula')
  })
})

describe('M1-6 — cortesia na remarcação', () => {
  it('cortesia não consome franquia nem crédito; audit via=courtesy; sem motivo recusa', async () => {
    const c = await createPrivateContract(sql, { allowance: 2, minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 96 })
    const { data: win } = await admin.rpc('publish_reschedule_window', {
      p_teacher: c.teacherId,
      p_starts_at_utc: instanteEm(daysFromToday(6), '15:00'),
    })
    const semMotivo = await admin.rpc('book_reschedule_window', {
      p_window: win, p_instance: inst, p_courtesy: true,
    })
    expect(semMotivo.error?.message).toContain('motivo')

    const { data: novoId, error } = await admin.rpc('book_reschedule_window', {
      p_window: win, p_instance: inst, p_courtesy: true, p_courtesy_note: 'imprevisto nosso',
    })
    expect(error).toBeNull()
    const [usage] = await sql`
      select coalesce(sum(used_count), 0)::int as used from reschedule_usage where contract_id = ${c.contractId}`
    expect(usage.used).toBe(0)
    const spends = await sql`
      select 1 from makeup_ledger where contract_id = ${c.contractId} and delta < 0`
    expect(spends).toHaveLength(0)
    const [audit] = await sql`
      select diff from audit_log
      where action = 'reschedule_class' and entity_id = ${novoId}::text`
    expect(audit.diff.via).toBe('courtesy')
    expect(audit.diff.courtesy_note).toBe('imprevisto nosso')
  })

  it('cortesia por aluno é recusada (D10)', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    const userId = await createAuthUser(sql, 'student', 'Aluno cortesia')
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    const student = await clientAs(userId, 'student')
    const inst = await createInstance(sql, c, { startsInHours: 96 })
    const { data: win } = await admin.rpc('publish_reschedule_window', {
      p_teacher: c.teacherId,
      p_starts_at_utc: instanteEm(daysFromToday(8), '15:00'),
    })
    const { error } = await student.rpc('book_reschedule_window', {
      p_window: win, p_instance: inst, p_courtesy: true, p_courtesy_note: 'tentativa',
    })
    expect(error?.message).toContain('administração')
  })
})

describe('M2-1 — antecedência com bypass admin auditado', () => {
  it('admin fura a antecedência com o toggle; o audit registra', async () => {
    const c = await createPrivateContract(sql, { minNotice: 1 })
    await sql`update teachers set min_booking_lead_hours = 100 where id = ${c.teacherId}`
    const inst = await createInstance(sql, c, { startsInHours: 200 })
    const { data: win } = await admin.rpc('publish_reschedule_window', {
      p_teacher: c.teacherId,
      p_starts_at_utc: instanteEm(daysFromToday(1), '15:00'),
    })
    const negado = await admin.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    expect(negado.error?.message).toContain('antecedência')

    const { error } = await admin.rpc('book_reschedule_window', {
      p_window: win, p_instance: inst, p_bypass_lead: true,
    })
    expect(error).toBeNull()
    const [audit] = await sql`
      select diff from audit_log
      where action = 'book_reschedule_window' and entity_id = ${win}::text`
    expect(audit.diff.bypass_lead).toBe(true)
  })
})

describe('M2-4 — teste-guarda: franquia debita o mês da aula ORIGINAL', () => {
  it('remarcar aula com occurrence_date de outro mês debita AQUELE mês', async () => {
    const c = await createPrivateContract(sql, { minNotice: 1 })
    const inst = await createInstance(sql, c, { startsInHours: 96 })
    await sql`update class_instances set occurrence_date = '2026-05-15' where id = ${inst}`
    await sql`select public.reschedule_class(${inst}, ${daysFromToday(6)}::date, '16:00'::time)`
    const [usage] = await sql`
      select period_ym, used_count from reschedule_usage where contract_id = ${c.contractId}`
    expect(usage.period_ym).toBe('2026-05')
    expect(usage.used_count).toBe(1)
  })
})

describe('M2-3/P4 — autocancelamento com aviso', () => {
  async function contractWithLogin(minNotice = 24) {
    const c = await createPrivateContract(sql, { minNotice })
    const userId = await createAuthUser(sql, 'student', 'Aluno autocancel')
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    return { ...c, userId, client: await clientAs(userId, 'student') }
  }

  it('aluno cancela a própria aula COM aviso → SEM crédito (ADR-018) + outbox + audit via=self', async () => {
    const { client, contractId, teacherId, studentId } = await contractWithLogin(24)
    const inst = await createInstance(sql, { contractId, teacherId }, { startsInHours: 96 })
    const { error } = await client.rpc('cancel_my_class', { p_instance: inst })
    expect(error).toBeNull()
    const [st] = await sql`select state from class_instances where id = ${inst}`
    expect(st.state).toBe('cancelled')
    const [bal] = await sql`select public.makeup_balance(${contractId}) as b`
    expect(Number(bal.b)).toBe(0)
    const outbox = await sql`
      select payload from notification_outbox
      where dedupe_key = ${'class-cancelled:' + inst + ':' + studentId}`
    expect(outbox).toHaveLength(1)
    expect(outbox[0].payload.credited).toBe(false)
    await sql`update notification_outbox set sent_at = now()
               where sent_at is null and template = 'class-cancelled' and payload->>'instance_id' = ${inst}::text`
    const [audit] = await sql`
      select diff from audit_log where action = 'cancel_class' and entity_id = ${inst}::text`
    expect(audit.diff.via).toBe('self')
  })

  it('aula alheia → recusada; consequência SEM aviso → perda registrada no payload', async () => {
    const { client } = await contractWithLogin(24)
    const outro = await createPrivateContract(sql)
    const alheia = await createInstance(sql, outro, { startsInHours: 96 })
    const negado = await client.rpc('cancel_my_class', { p_instance: alheia })
    expect(negado.error?.message).toContain('acesso')

    // sem aviso suficiente (aviso mínimo 200h, aula a 96h) → perde, e o aviso diz isso
    const perto = await contractWithLogin(200)
    const inst2 = await createInstance(
      sql, { contractId: perto.contractId, teacherId: perto.teacherId }, { startsInHours: 96 })
    const { error } = await perto.client.rpc('cancel_my_class', { p_instance: inst2 })
    expect(error).toBeNull()
    const [bal] = await sql`select public.makeup_balance(${perto.contractId}) as b`
    expect(Number(bal.b)).toBe(0)
    const outbox = await sql`
      select payload from notification_outbox
      where dedupe_key = ${'class-cancelled:' + inst2 + ':' + perto.studentId}`
    expect(outbox[0].payload.credited).toBe(false)
    await sql`update notification_outbox set sent_at = now()
               where sent_at is null and template = 'class-cancelled' and payload->>'instance_id' = ${inst2}::text`
  })

  it('P4: cancelamento unitário da ADMIN também enfileira o aviso', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 96 })
    await admin.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'teacher' })
    const outbox = await sql`
      select 1 from notification_outbox
      where dedupe_key = ${'class-cancelled:' + inst + ':' + c.studentId}`
    expect(outbox).toHaveLength(1)
    await sql`update notification_outbox set sent_at = now()
               where sent_at is null and template = 'class-cancelled' and payload->>'instance_id' = ${inst}::text`
  })
})

describe('P22 — régua das avulsas no extrato (pagam pela duração)', () => {
  it('extra/cortesia/experimental completadas entram nas horas pagáveis', async () => {
    const c = await createPrivateContract(sql)
    const mkPast = async (kind: string, durMin: number) => {
      const [r] = await sql`
        insert into class_instances
          (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot,
           state, single_kind)
        values
          (${c.contractId}, ${c.teacherId},
           now() - interval '30 hours',
           now() - interval '30 hours' + make_interval(mins => ${durMin}),
           'fixture avulsa', 'completed', ${kind})
        returning id`
      return r.id
    }
    await mkPast('extra_paid', 60)
    // horários distintos para não colidir (exclusion): desloca 2h e 4h
    await sql`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot, state, single_kind)
      values
        (${c.contractId}, ${c.teacherId}, now() - interval '28 hours',
         now() - interval '28 hours' + make_interval(mins => 30), 'fixture avulsa', 'completed', 'courtesy'),
        (${c.contractId}, ${c.teacherId}, now() - interval '26 hours',
         now() - interval '26 hours' + make_interval(mins => 45), 'fixture avulsa', 'completed', 'trial')`
    const [h] = await sql`
      select public._teacher_payable_hours(
        ${c.teacherId}, (current_date - 10)::date, current_date) as hours`
    // 60 + 30 + 45 = 135 min = 2.25 h
    expect(Number(h.hours)).toBeCloseTo(2.25, 2)
  })
})
