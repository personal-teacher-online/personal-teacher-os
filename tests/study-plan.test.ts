// M2+M3 do cronograma (migration 20260720000300): plano semestral do aluno
// (D1: relógio do contrato) e apontamento OBRIGATÓRIO no registro (D2), com
// escape de tema avulso e batch que PULA aula sem apontamento.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createInstance, createPrivateContract } from './helpers/db'

let sql: Sql

beforeAll(async () => {
  sql = connect(5)
})
afterAll(async () => {
  await sql.end()
})

async function fixture(opts: { level?: string | null; startedMonthsAgo?: number } = {}) {
  const c = await createPrivateContract(sql)
  if (opts.level !== null)
    await sql`update students set level = ${opts.level ?? 'A1'} where id = ${c.studentId}`
  if (opts.startedMonthsAgo)
    await sql`update contracts set started_on = (current_date - ${opts.startedMonthsAgo + ' months'}::interval)::date where id = ${c.contractId}`
  const adminUser = await createAuthUser(sql, 'admin', 'Admin Plano')
  const admin = await clientAs(adminUser, 'admin')
  return { ...c, admin, adminUser }
}

describe('M2 — geração do plano semestral', () => {
  it('semestre 1: janela do started_on, itens copiados da trilha, idempotente', async () => {
    const { admin, contractId } = await fixture({ level: 'A1' })
    const { data: planId, error } = await admin.rpc('generate_study_plan', { p_contract: contractId })
    expect(error).toBeNull()

    const [p] = await sql`
      select semester_no, starts_on, ends_on, level_snapshot,
             (select started_on from contracts where id = ${contractId}) as started
      from study_plans where id = ${planId}`
    expect(p.semester_no).toBe(1)
    expect(String(p.starts_on)).toBe(String(p.started))
    expect(p.level_snapshot).toBe('A1')
    const itens = await sql`select position, title, topic_id from study_plan_items where plan_id = ${planId} order by position`
    expect(itens.length).toBe(7) // trilha A1 tem 7 módulos
    expect(itens[0].position).toBe(1)
    expect(itens[0].topic_id).not.toBeNull()

    const de_novo = await admin.rpc('generate_study_plan', { p_contract: contractId })
    expect(de_novo.data).toBe(planId) // idempotente no semestre corrente
  })

  it('contrato começado há 8 meses cai no semestre 2', async () => {
    const { admin, contractId } = await fixture({ level: 'B2', startedMonthsAgo: 8 })
    const { data: planId } = await admin.rpc('generate_study_plan', { p_contract: contractId })
    const [p] = await sql`select semester_no from study_plans where id = ${planId}`
    expect(p.semester_no).toBe(2)
  })

  it('sem nível na ficha → erro claro; nível vale os 11 da Flexge', async () => {
    const { admin, contractId } = await fixture({ level: null })
    const semNivel = await admin.rpc('generate_study_plan', { p_contract: contractId })
    expect(semNivel.error?.message).toContain('nível')

    const { admin: a2, contractId: c2 } = await fixture({ level: 'Pre A1' })
    const ok = await a2.rpc('generate_study_plan', { p_contract: c2 })
    expect(ok.error).toBeNull()
  })
})

describe('M2 — personalização pela professora', () => {
  it('professora do contrato personaliza (auditado); outra professora não; escrita direta negada', async () => {
    const { admin, contractId, teacherId } = await fixture({ level: 'A1' })
    const { data: planId } = await admin.rpc('generate_study_plan', { p_contract: contractId })
    const [item] = await sql`select id from study_plan_items where plan_id = ${planId} and position = 1`

    const profUser = await createAuthUser(sql, 'teacher', 'Prof Plano')
    await sql`update teachers set profile_id = ${profUser} where id = ${teacherId}`
    const prof = await clientAs(profUser, 'teacher')

    const { error } = await prof.rpc('update_study_plan_item', {
      p_item: item.id,
      p_theme: 'Viagem: pedir informação no aeroporto',
      p_approach: 'Acomodador — roleplay direto, sem teoria antes',
      p_flexge_lesson_id: '65de0e9a718649e112c1eb60',
      p_flexge_lesson_href: '/lessons/library/65de0e9a718649e112c1eb60/details',
    })
    expect(error).toBeNull()
    const [i] = await sql`select theme, flexge_lesson_href from study_plan_items where id = ${item.id}`
    expect(i.theme).toContain('aeroporto')
    const audit = await sql`select 1 from audit_log where action = 'update_study_plan_item' and entity_id = ${item.id}::text`
    expect(audit.length).toBe(1)

    const outraUser = await createAuthUser(sql, 'teacher', 'Outra Prof')
    const outra = await clientAs(outraUser, 'teacher')
    const negada = await outra.rpc('update_study_plan_item', { p_item: item.id, p_theme: 'x' })
    expect(negada.error?.message).toContain('apenas admin ou a professora')

    const direto = await prof.from('study_plan_items').update({ theme: 'y' }).eq('id', item.id)
    expect(direto.error?.code).toBe('42501')
  })
})

describe('M3 — apontamento obrigatório no registro', () => {
  it('realizada sem apontamento recusa; com módulo do plano ou tema avulso registra', async () => {
    const f = await fixture({ level: 'A1' })
    const { data: planId } = await f.admin.rpc('generate_study_plan', { p_contract: f.contractId })
    const [item] = await sql`select id from study_plan_items where plan_id = ${planId} and position = 1`

    const aula1 = await createInstance(sql, f, { startsInHours: -3 })
    const sem = await f.admin.rpc('complete_class', { p_instance: aula1 })
    expect(sem.error?.message).toContain('sem apontamento')

    const comItem = await f.admin.rpc('complete_class', { p_instance: aula1, p_plan_item: item.id })
    expect(comItem.error).toBeNull()
    const [r1] = await sql`select plan_item_id from class_content_reports where class_instance_id = ${aula1}`
    expect(r1.plan_item_id).toBe(item.id)

    const aula2 = await createInstance(sql, f, { startsInHours: -5 })
    const avulso = await f.admin.rpc('complete_class', {
      p_instance: aula2, p_off_kind: 'revisao', p_off_note: 'revisão para a prova de proficiência',
    })
    expect(avulso.error).toBeNull()
    const [r2] = await sql`select off_track_kind from class_content_reports where class_instance_id = ${aula2}`
    expect(r2.off_track_kind).toBe('revisao')
  })

  it('guardas: item de OUTRO contrato recusa; os dois ao mesmo tempo recusa; no-show não exige', async () => {
    const f = await fixture({ level: 'A1' })
    const outro = await fixture({ level: 'A2' })
    const { data: planAlheio } = await outro.admin.rpc('generate_study_plan', { p_contract: outro.contractId })
    const [itemAlheio] = await sql`select id from study_plan_items where plan_id = ${planAlheio} limit 1`

    const aula = await createInstance(sql, f, { startsInHours: -3 })
    const alheio = await f.admin.rpc('report_class_content', { p_instance: aula, p_plan_item: itemAlheio.id })
    expect(alheio.error?.message).toContain('outro aluno')

    const ambos = await f.admin.rpc('report_class_content', {
      p_instance: aula, p_plan_item: itemAlheio.id, p_off_kind: 'extra',
    })
    expect(ambos.error?.message).toContain('exatamente um')

    const falta = await f.admin.rpc('no_show_student', { p_instance: aula })
    expect(falta.error).toBeNull() // falta não tem conteúdo — segue sem apontamento
  })

  it('professora aponta ANTES (prévia) e o registro passa; batch pula quem não tem', async () => {
    const f = await fixture({ level: 'A1' })
    const profUser = await createAuthUser(sql, 'teacher', 'Prof Aponta')
    await sql`update teachers set profile_id = ${profUser} where id = ${f.teacherId}`
    const prof = await clientAs(profUser, 'teacher')

    const comReport = await createInstance(sql, f, { startsInHours: -4 })
    const semReport = await createInstance(sql, f, { startsInHours: -2 })
    const { error } = await prof.rpc('report_class_content', {
      p_instance: comReport, p_off_kind: 'conversacao', p_off_note: 'conversa livre sobre a viagem',
    })
    expect(error).toBeNull()

    // rodada 3: o lote recebe os IDs explícitos — o pulo D2 (sem apontamento)
    // continua sendo pulo, não exceção: a aula fica pendente, sem abortar o lote
    const { data: n } = await f.admin.rpc('admin_complete_past_batch', {
      p_teacher: f.teacherId,
      p_instances: [comReport, semReport],
    })
    expect(n).toBe(1) // só a apontada; a outra fica pendente
    const [a] = await sql`select state from class_instances where id = ${comReport}`
    const [b] = await sql`select state from class_instances where id = ${semReport}`
    expect(a.state).toBe('completed')
    expect(b.state).toBe('scheduled')
  })
})
