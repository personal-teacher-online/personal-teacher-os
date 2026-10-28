// F1 — Ledger com memória (plano integrado v2, 18/07/2026): duração no crédito
// (M1-5), validade por causa (M3-1), identidade do gasto + estorno formal
// (M3-3, com P10/P11/P14 do passe adversarial) e _reissue_credit (P6).
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
} from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin F1'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

async function balance(contractId: string): Promise<number> {
  const [row] = await sql`select public.makeup_balance(${contractId}) as b`
  return Number(row.b)
}

async function addCredit(
  contractId: string,
  expiresOn: string,
  durationMin: number | null = null,
): Promise<number> {
  const [row] = await sql`
    insert into makeup_ledger (contract_id, delta, reason, expires_on, duration_min)
    values (${contractId}, 1, 'manual_adjust', ${expiresOn}, ${durationMin})
    returning id`
  return Number(row.id)
}

async function publishWindow(teacherId: string, daysAhead: number, time = '15:00'): Promise<string> {
  const { data, error } = await admin.rpc('publish_reschedule_window', {
    p_teacher: teacherId,
    p_starts_at_utc: instanteEm(daysFromToday(daysAhead), time),
  })
  expect(error).toBeNull()
  return data as string
}

describe('M1-5 — duração no ledger e no resgate', () => {
  it('spend grava a IDENTIDADE do crédito consumido (FIFO por validade)', async () => {
    const c = await createPrivateContract(sql)
    const idA = await addCredit(c.contractId, daysFromToday(10), 45)
    await addCredit(c.contractId, daysFromToday(40), 60)
    const { error } = await admin.rpc('admin_makeup_adjust', {
      p_contract: c.contractId, p_delta: -1, p_note: 'teste identidade',
    })
    expect(error).toBeNull()
    const [spend] = await sql`
      select consumes_ledger_id from makeup_ledger
      where contract_id = ${c.contractId} and delta = -1 order by id desc limit 1`
    expect(Number(spend.consumes_ledger_id)).toBe(idA) // o que vence primeiro
    expect(await balance(c.contractId)).toBe(1)
  })

  it('resgate cria a aula com a duração do CRÉDITO (não a do slot)', async () => {
    const c = await createPrivateContract(sql)
    await createSlot(sql, c, { weekday: 2, localTime: '10:00', tz: 'America/Cuiaba', durationMin: 45 })
    const idCredit = await addCredit(c.contractId, daysFromToday(40), 60)
    const win = await publishWindow(c.teacherId, 5)
    const { data: newId, error } = await admin.rpc('book_reschedule_window', {
      p_window: win, p_contract: c.contractId,
    })
    expect(error).toBeNull()
    const [inst] = await sql`
      select round(extract(epoch from (ends_at_utc - starts_at_utc)) / 60)::int as dur
      from class_instances where id = ${newId}`
    expect(inst.dur).toBe(60)
    const [spend] = await sql`
      select consumes_ledger_id from makeup_ledger
      where contract_id = ${c.contractId} and delta = -1 order by id desc limit 1`
    expect(Number(spend.consumes_ledger_id)).toBe(idCredit)
  })

  it('crédito legado SEM duração: resgate cai no padrão do contrato (slot ativo)', async () => {
    const c = await createPrivateContract(sql)
    await createSlot(sql, c, { weekday: 3, localTime: '11:00', tz: 'America/Cuiaba', durationMin: 45 })
    await addCredit(c.contractId, daysFromToday(40), null)
    const win = await publishWindow(c.teacherId, 4)
    const { data: newId, error } = await admin.rpc('book_reschedule_window', {
      p_window: win, p_contract: c.contractId,
    })
    expect(error).toBeNull()
    const [inst] = await sql`
      select round(extract(epoch from (ends_at_utc - starts_at_utc)) / 60)::int as dur
      from class_instances where id = ${newId}`
    expect(inst.dur).toBe(45)
  })
})

describe('M3-1 — validade por causa (aluno 90 × escola 180)', () => {
  it('professora cancela aula de 60min → crédito com validade-escola E duração 60', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 5, durationMin: 60 })
    await admin.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'teacher' })
    const [row] = await sql`
      select l.duration_min, l.expires_on::text as exp,
             ((i.starts_at_utc at time zone s.iana_tz)::date + c2.school_fault_credit_expiry_days)::text as esperado
      from makeup_ledger l
      join class_instances i on i.id = l.class_instance_id
      join contracts c2 on c2.id = l.contract_id
      join students s on s.id = c2.student_id
      where l.contract_id = ${c.contractId} and l.reason = 'earn_cancellation'`
    expect(row.duration_min).toBe(60)
    expect(row.exp).toBe(row.esperado)
  })

  it('ADR-018: aluno cancela com aviso → NENHUM crédito nasce; a validade-90 fica na ferramenta manual', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    await admin.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'student' })
    const auto = await sql`
      select 1 from makeup_ledger where contract_id = ${c.contractId}`
    expect(auto).toHaveLength(0) // nada automático (ADR-018)
    // M3-1 preservada na ferramenta: earn com causa-aluno mantém a validade do contrato (90)
    await sql`select public._earn_for_lost_class(${inst}, null, 'student')`
    const [row] = await sql`
      select l.expires_on::text as exp,
             ((i.starts_at_utc at time zone s.iana_tz)::date + c2.makeup_credit_expiry_days)::text as esperado
      from makeup_ledger l
      join class_instances i on i.id = l.class_instance_id
      join contracts c2 on c2.id = l.contract_id
      join students s on s.id = c2.student_id
      where l.contract_id = ${c.contractId} and l.reason = 'earn_cancellation'`
    expect(row.exp).toBe(row.esperado)
  })
})

describe('M3-3 — estorno formal da reposição cancelada', () => {
  /** contrato + crédito + resgate numa janela futura; devolve a aula criada e o gasto. */
  async function redeemed(opts: { expiresInDays?: number; minNotice?: number; durationMin?: number } = {}) {
    const c = await createPrivateContract(sql, { minNotice: opts.minNotice ?? 24 })
    await createSlot(sql, c, { weekday: 1, localTime: '09:00', tz: 'America/Cuiaba', durationMin: 45 })
    const creditId = await addCredit(
      c.contractId, daysFromToday(opts.expiresInDays ?? 60), opts.durationMin ?? 60)
    const win = await publishWindow(c.teacherId, 5)
    const { data: instId, error } = await admin.rpc('book_reschedule_window', {
      p_window: win, p_contract: c.contractId,
    })
    expect(error).toBeNull()
    const [spend] = await sql`
      select id from makeup_ledger
      where contract_id = ${c.contractId} and delta = -1 order by id desc limit 1`
    return { ...c, creditId, instId: instId as string, spendId: Number(spend.id) }
  }

  it('ADR-018: aluno cancela a reposição com aviso → NADA volta sozinho (o estorno virou ferramenta do atendimento)', async () => {
    const r = await redeemed({ expiresInDays: 60, durationMin: 60 })
    expect(await balance(r.contractId)).toBe(0)
    const { error } = await admin.rpc('cancel_class', { p_instance: r.instId, p_cancelled_by: 'student' })
    expect(error).toBeNull()
    const [st] = await sql`select state from class_instances where id = ${r.instId}`
    expect(st.state).toBe('cancelled')
    const refunds = await sql`
      select 1 from makeup_ledger where contract_id = ${r.contractId} and reason = 'refund'`
    expect(refunds).toHaveLength(0)
    expect(await balance(r.contractId)).toBe(0)
  })

  it('(i) ferramenta do atendimento: estorno formal preserva validade ORIGINAL e duração copiada', async () => {
    // ADR-018: a origem 'student' saiu do caminho automático; o par −1/+1 com
    // refund_of continua no banco para o atendimento acionar (caso a caso).
    const r = await redeemed({ expiresInDays: 60, durationMin: 60 })
    await admin.rpc('cancel_class', { p_instance: r.instId, p_cancelled_by: 'student' })
    const [out] = await sql`
      select o_expires::text as exp from public._refund_for_credit_born_class(${r.instId}, 'student', null)`
    const [refund] = await sql`
      select reason, refund_of, duration_min, expires_on::text as exp,
             (select expires_on::text from makeup_ledger where id = ${r.creditId}) as orig
      from makeup_ledger
      where contract_id = ${r.contractId} and reason = 'refund'`
    expect(Number(refund.refund_of)).toBe(r.spendId)
    expect(refund.duration_min).toBe(60)
    expect(refund.exp).toBe(refund.orig) // validade original (>> piso de 7 dias)
    expect(out.exp).toBe(refund.orig)
    expect(await balance(r.contractId)).toBe(1)
  })

  it('(i) piso: crédito quase vencido volta com hoje+7 (nunca menos) — via ferramenta', async () => {
    const r = await redeemed({ expiresInDays: 2 })
    await admin.rpc('cancel_class', { p_instance: r.instId, p_cancelled_by: 'student' })
    await sql`select * from public._refund_for_credit_born_class(${r.instId}, 'student', null)`
    const [row] = await sql`
      select expires_on::text as exp, (public.business_today() + 7)::text as piso
      from makeup_ledger where contract_id = ${r.contractId} and reason = 'refund'`
    expect(row.exp).toBe(row.piso)
  })

  it('(ii) professora cancela a reposição → validade-escola DA REPOSIÇÃO (P14)', async () => {
    const r = await redeemed({ expiresInDays: 30 })
    await admin.rpc('cancel_class', { p_instance: r.instId, p_cancelled_by: 'teacher' })
    const [row] = await sql`
      select l.expires_on::text as exp,
             ((i.starts_at_utc at time zone s.iana_tz)::date + c2.school_fault_credit_expiry_days)::text as esperado
      from makeup_ledger l
      join class_instances i on i.id = ${r.instId}
      join contracts c2 on c2.id = l.contract_id
      join students s on s.id = c2.student_id
      where l.contract_id = ${r.contractId} and l.reason = 'refund'`
    expect(row.exp).toBe(row.esperado)
    expect(await balance(r.contractId)).toBe(1)
  })

  it('(iii) sem aviso → perdido: nada volta', async () => {
    // aviso mínimo de 200h e aula a ~120h → cancelamento SEM aviso suficiente
    const r = await redeemed({ minNotice: 200 })
    const { error } = await admin.rpc('cancel_class', { p_instance: r.instId, p_cancelled_by: 'student' })
    expect(error).toBeNull()
    expect(await balance(r.contractId)).toBe(0)
    const refunds = await sql`
      select 1 from makeup_ledger where contract_id = ${r.contractId} and reason = 'refund'`
    expect(refunds).toHaveLength(0)
  })

  it('P11: segundo estorno do MESMO gasto é impossível (refund_of único)', async () => {
    const r = await redeemed()
    // ADR-018: o refund automático agora só nasce quando a ESCOLA cancela.
    await admin.rpc('cancel_class', { p_instance: r.instId, p_cancelled_by: 'teacher' })
    await expect(sql`
      insert into makeup_ledger (contract_id, delta, reason, expires_on, refund_of)
      values (${r.contractId}, 1, 'refund', ${daysFromToday(30)}, ${r.spendId})
    `).rejects.toThrow(/makeup_ledger_refund_of_uniq|duplicate/)
  })

  it('P10: gasto legado SEM identidade → estorno recusado; cancelamento acontece; audit marca', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 120 })
    // gasto pré-F1 simulado: sem consumes_ledger_id
    await sql`
      insert into makeup_ledger (contract_id, delta, reason, class_instance_id)
      values (${c.contractId}, -1, 'spend_reschedule', ${inst})`
    // ADR-018: o caminho que ainda tenta o estorno automático é o da escola.
    const { error } = await admin.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'teacher' })
    expect(error).toBeNull()
    const [st] = await sql`select state from class_instances where id = ${inst}`
    expect(st.state).toBe('cancelled')
    const refunds = await sql`
      select 1 from makeup_ledger where contract_id = ${c.contractId} and delta = 1`
    expect(refunds).toHaveLength(0) // nada creditado automaticamente
    const [audit] = await sql`
      select diff from audit_log
      where action = 'cancel_class' and entity_id = ${inst}::text`
    expect(audit.diff.refund_blocked).toContain('sem identidade')
  })

  it('no_show_teacher sobre reposição → estorno com validade-escola', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    await createSlot(sql, c, { weekday: 4, localTime: '14:00', tz: 'America/Cuiaba', durationMin: 45 })
    const creditId = await addCredit(c.contractId, daysFromToday(60), 45)
    // reposição "no passado" para o no-show: cria direto, com o gasto apontando p/ ela
    const inst = await createInstance(sql, c, { startsInHours: -3, durationMin: 45 })
    await sql`
      insert into makeup_ledger (contract_id, delta, reason, class_instance_id, consumes_ledger_id)
      values (${c.contractId}, -1, 'spend_reschedule', ${inst}, ${creditId})`
    const { error } = await admin.rpc('no_show_teacher', { p_instance: inst })
    expect(error).toBeNull()
    const [refund] = await sql`
      select refund_of is not null as linked, duration_min from makeup_ledger
      where contract_id = ${c.contractId} and reason = 'refund'`
    expect(refund.linked).toBe(true)
    expect(refund.duration_min).toBe(45)
  })
})

describe('P6 — _reissue_credit (o relançamento único)', () => {
  it('par −1/+1 dirigido preserva duração + origem; saldo inalterado; validade nova', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 5, durationMin: 60 })
    await admin.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'teacher' })
    const [orig] = await sql`
      select id from makeup_ledger where contract_id = ${c.contractId} and reason = 'earn_cancellation'`
    const [reissued] = await sql`
      select public._reissue_credit(${orig.id}, ${daysFromToday(200)}, null, 'extensão de teste') as id`
    const [novo] = await sql`
      select duration_min, class_instance_id, expires_on::text as exp, note
      from makeup_ledger where id = ${reissued.id}`
    expect(novo.duration_min).toBe(60)
    expect(novo.class_instance_id).toBe(inst) // origem preservada
    expect(novo.exp).toBe(daysFromToday(200))
    expect(await balance(c.contractId)).toBe(1)
    // o débito é DIRIGIDO: consome exatamente o crédito original
    const [debit] = await sql`
      select consumes_ledger_id from makeup_ledger
      where contract_id = ${c.contractId} and delta = -1`
    expect(Number(debit.consumes_ledger_id)).toBe(Number(orig.id))
  })

  it('crédito já gasto ou vencido não é relançável', async () => {
    const c = await createPrivateContract(sql)
    const id = await addCredit(c.contractId, daysFromToday(10), 45)
    await admin.rpc('admin_makeup_adjust', { p_contract: c.contractId, p_delta: -1, p_note: 'gasta' })
    await expect(sql`
      select public._reissue_credit(${id}, ${daysFromToday(30)}, null, 'não deve dar')
    `).rejects.toThrow(/não está vivo/)
  })
})

describe('pausa preserva duração + origem (M3-7 via F1)', () => {
  it('crédito de aula 60min pausado e retomado continua 60min com a mesma origem', async () => {
    const c = await createPrivateContract(sql, { minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 5, durationMin: 60 })
    await admin.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'teacher' })
    await sql`update contracts set status = 'paused' where id = ${c.contractId}`
    await sql`insert into contract_pauses (contract_id, paused_on) values (${c.contractId}, ${daysFromToday(-10)})`
    // A6 · lote 3: `p_today` um dia à frente para que a extensão seja > 0 e o
    // par −1/+1 de fato aconteça — é ELE que este caso mede (duração + origem
    // sobrevivem ao relançamento). Com o crédito nascendo hoje (o `cancel_class`
    // acima) e a pausa retroagida, a fórmula nova daria extensão zero na
    // retomada de hoje, e o teste não exercitaria relançamento nenhum.
    const { error } = await admin.rpc('resume_contract', {
      p_contract: c.contractId,
      p_today: daysFromToday(1),
    })
    expect(error).toBeNull()
    const [vivo] = await sql`
      select rc.duration_min, ml.class_instance_id
      from public._makeup_remaining_credits(${c.contractId}) rc
      join makeup_ledger ml on ml.id = rc.ledger_id
      where rc.expires_on >= public.business_today()`
    expect(vivo.duration_min).toBe(60)
    expect(vivo.class_instance_id).toBe(inst)
  })

  // AFIRMAÇÃO NOVA (A6 · lote 3, 30/07/2026). O caso antigo se chamava "crédito
  // manual dado DURANTE a pausa não é estendido em dobro (M3-7)" e provava a
  // ausência de dobra por EXCLUSÃO: o filtro `ml.created_at < v_pause.created_at`
  // simplesmente deixava esse crédito de fora da compensação. Só que ficar de
  // fora não era neutro — era o furo do congelamento (ele vencia sem poder ser
  // gasto, estendido ou avisado), e o dono decidiu fechá-lo.
  //
  // A afirmação agora é POSITIVA e mais forte: cada crédito é estendido
  // EXATAMENTE pelos dias que passou parado, contados de
  // `greatest(paused_on, dia da concessão)`. Isso prova as duas coisas de uma
  // vez — o crédito da pausa é compensado, E ninguém é compensado em dobro.
  it('cada crédito é estendido EXATAMENTE pelos dias parados dele (era "sem dobra", M3-7)', async () => {
    const c = await createPrivateContract(sql)
    // PRÉ-PAUSA de verdade: `created_at` anterior a `paused_on`. (Antes bastava
    // inserir a linha antes da linha de pausa; a régua nova compara datas civis,
    // não a ordem de inserção.)
    await sql`
      insert into makeup_ledger (contract_id, delta, reason, expires_on, duration_min, created_at)
      values (${c.contractId}, 1, 'manual_adjust', ${daysFromToday(5)}, 45,
              ${daysFromToday(-20) + 'T12:00:00Z'}::timestamptz)`
    await sql`update contracts set status = 'paused' where id = ${c.contractId}`
    await sql`insert into contract_pauses (contract_id, paused_on) values (${c.contractId}, ${daysFromToday(-10)})`
    // manual dado DURANTE a pausa, 6 dias atrás
    await sql`
      insert into makeup_ledger (contract_id, delta, reason, expires_on, duration_min, created_at)
      values (${c.contractId}, 1, 'manual_adjust', ${daysFromToday(30)}, 45,
              ${daysFromToday(-6) + 'T12:00:00Z'}::timestamptz)`
    const { data: extended, error } = await admin.rpc('resume_contract', {
      p_contract: c.contractId,
      p_today: daysFromToday(0), // determinístico (UTC × Cuiabá na virada do dia)
    })
    expect(error).toBeNull()
    expect(extended).toBe(2) // os DOIS, cada um com a sua conta
    const rows = await sql`
      select expires_on::text as e from public._makeup_remaining_credits(${c.contractId})
      where expires_on >= public.business_today() order by e`
    // +5 parado 10 dias (desde paused_on) → +15
    // +30 parado 6 dias (desde a concessão, não desde a pausa) → +36
    expect(rows.map((r) => r.e)).toEqual([daysFromToday(15), daysFromToday(36)])
  })

  // A TRAVA DA DOBRA, agora medida onde ela mora: no relógio. O crédito que a
  // PRÓPRIA retomada emite nasce com `created_at = now()`, cujo dia civil é o
  // próprio `p_today` — extensão zero. (E o laço materializa o replay antes da
  // primeira escrita, então ele nem chega a ser revisto: são duas travas.)
  it('crédito concedido no dia da retomada não ganha nada — a dobra morre na aritmética', async () => {
    const c = await createPrivateContract(sql)
    await sql`update contracts set status = 'paused' where id = ${c.contractId}`
    await sql`insert into contract_pauses (contract_id, paused_on) values (${c.contractId}, ${daysFromToday(-10)})`
    await addCredit(c.contractId, daysFromToday(30), 45) // created_at = agora
    const { data: extended, error } = await admin.rpc('resume_contract', {
      p_contract: c.contractId,
      p_today: daysFromToday(0),
    })
    expect(error).toBeNull()
    expect(extended).toBe(0)
    const [{ n }] = await sql`
      select count(*)::int as n from makeup_ledger where contract_id = ${c.contractId}`
    expect(n).toBe(1) // nenhum par −1/+1 nasceu
  })
})
