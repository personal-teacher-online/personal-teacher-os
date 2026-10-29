// Horário de reposição publicado é oferta real: nenhum ato da agenda pode
// deixá-lo sem como ser reservado (issue #85; goal da onda Agenda e Mensagens,
// M2; Lei 3). A migration 20261029000100 fechou a porta da professora que
// remarca a própria aula; esta prova as outras duas, contra o Postgres:
//
//   1. `publish_reschedule_window` recusa janela cujo intervalo MEDIDO
//      (`teacher_window_span_min`, nunca menos que a aula que cruza) encoste
//      em aula `scheduled` dela — antes só o COMEÇO dentro da aula recusava;
//   2. `book_computed_slot` recusa destino que encoste em janela publicada dela
//      (o mesmo instante continua sendo consumo da própria janela);
//   3. o "remarcar para horário novo" da administração (publica e consome,
//      `p_instance`) não se recusa contra a própria aula que está movendo, e
//      ganha a mesma recusa da grade calculada.
//
// Bordas meia-abertas: terminar exatamente no começo, ou começar exatamente no
// fim medido, não encosta.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createInstanceAt,
  createPrivateContract,
  createSlot,
  createStudent,
  createTeacher,
  daysFromToday,
  instanteEm,
} from './helpers/db'
import { corpoDaFuncao } from './helpers/definicao-da-funcao'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(3)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Dona encosto'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

const ENCOSTA_NA_AULA = 'encosta na aula marcada'
const ENCOSTA_NA_JANELA = 'horário de reposição já publicado'

/** Instante `minutos` depois de outro (as bordas saem do MESMO ponto). */
function mais(iso: string, minutos: number): string {
  return new Date(Date.parse(iso) + minutos * 60_000).toISOString()
}

async function publicar(teacherId: string, inicio: string, extra: Record<string, unknown> = {}) {
  return admin.rpc('publish_reschedule_window', { p_teacher: teacherId, p_starts_at_utc: inicio, ...extra })
}

async function estado(id: string): Promise<string> {
  const [r] = await sql`select state from class_instances where id = ${id}`
  return r.state as string
}

/** Abertura pontual: `_teacher_available_for` aceita o dia inteiro. */
async function abrirDia(teacherId: string, dia: string): Promise<void> {
  await sql`
    insert into teacher_availability_exceptions (teacher_id, kind, starts_at_utc, ends_at_utc, local_snapshot)
    values (${teacherId}, 'open', ${instanteEm(dia, '00:00')}, ${instanteEm(dia, '23:59')}, 'fixture encosto')`
}

/** Aluno com login (é o vínculo que `my_contract_ids()` lê) e contrato com a professora. */
async function alunoDaProfessora(teacherId: string) {
  const studentId = await createStudent(sql)
  const userId = await createAuthUser(sql, 'student', 'Aluno encosto')
  await sql`update students set profile_id = ${userId} where id = ${studentId}`
  const c = await createPrivateContract(sql, { studentId, teacherId })
  return { c, cliente: await clientAs(userId, 'student') }
}

/* ========================================================================== */
/* 1. publicar janela ao lado de aula marcada                                  */
/* ========================================================================== */

describe('publish_reschedule_window · janela medida que encosta em aula marcada', () => {
  it('aula 10:30–11:15: publicar às 10:00 recusa nomeando a aula; as bordas meia-abertas passam', async () => {
    const c = await createPrivateContract(sql)
    const dia = daysFromToday(5)
    const aula = instanteEm(dia, '10:30')
    await createInstanceAt(sql, c, aula, 45) // a única duração da agenda: medida = 45

    const r = await publicar(c.teacherId, instanteEm(dia, '10:00'))
    expect(r.error?.message).toContain(ENCOSTA_NA_AULA)
    // diz QUAL aula, no relógio de quem publica
    expect(r.error?.message).toMatch(new RegExp(`de ${dia} 10:30 \\S+`))

    // 09:46 cobre 09:46–10:31: encosta por 1 minuto
    expect((await publicar(c.teacherId, mais(aula, -44))).error?.message).toContain(ENCOSTA_NA_AULA)
    expect(await sql`select 1 from reschedule_windows where teacher_id = ${c.teacherId}`).toHaveLength(0)

    // PROVA DE MUTAÇÃO: 09:45 termina exatamente no começo da aula; 11:15 começa
    // exatamente no fim dela.
    expect((await publicar(c.teacherId, mais(aula, -45))).error).toBeNull()
    expect((await publicar(c.teacherId, mais(aula, 45))).error).toBeNull()
  })

  it('aula às 11:00: publicar às 10:00 passa (10:00–10:45 não encosta)', async () => {
    const c = await createPrivateContract(sql)
    const dia = daysFromToday(6)
    await createInstanceAt(sql, c, instanteEm(dia, '11:00'), 45)
    expect((await publicar(c.teacherId, instanteEm(dia, '10:00'))).error).toBeNull()
  })

  it('a janela é medida pela MAIOR duração da agenda dela: slot vigente de 60 min', async () => {
    const dia = daysFromToday(7)
    // Professora com slot de 60 min em outro contrato: a janela das 10:00 vale
    // 10:00–11:00 e encosta na aula das 10:50.
    const comSlot = await createPrivateContract(sql)
    const outro = await createPrivateContract(sql, { teacherId: comSlot.teacherId })
    await createSlot(sql, outro, { weekday: 1, localTime: '03:15', tz: 'America/Cuiaba', durationMin: 60 })
    await createInstanceAt(sql, comSlot, instanteEm(dia, '10:50'), 45)
    const r = await publicar(comSlot.teacherId, instanteEm(dia, '10:00'))
    expect(r.error?.message).toContain(ENCOSTA_NA_AULA)

    // PROVA DE MUTAÇÃO: a mesma agenda SEM o slot de 60 mede 45 (10:00–10:45) e publica.
    const semSlot = await createPrivateContract(sql)
    await createInstanceAt(sql, semSlot, instanteEm(dia, '10:50'), 45)
    expect((await publicar(semSlot.teacherId, instanteEm(dia, '10:00'))).error).toBeNull()
  })

  it('nunca menos que a aula que cruza: aula EM ANDAMENTO (fora da medida) continua barrando', async () => {
    // Sem slot e sem aula FUTURA, a medida do banco é NULL; a aula que começou
    // há 10 min e termina daqui a 35 ainda ocupa daqui a 20.
    const c = await createPrivateContract(sql)
    const [agora] = await sql`select date_trunc('minute', now()) as t`
    const inicio = new Date(agora.t as Date).toISOString()
    await createInstanceAt(sql, c, mais(inicio, -10), 45)
    const [m] = await sql`select public.teacher_window_span_min(${c.teacherId}) as min`
    expect(m.min).toBeNull()
    expect((await publicar(c.teacherId, mais(inicio, 20))).error?.message).toContain(ENCOSTA_NA_AULA)
    expect((await publicar(c.teacherId, mais(inicio, 36))).error).toBeNull()
  })
})

/* ========================================================================== */
/* 2. reservar pela grade calculada ao lado de janela publicada                */
/* ========================================================================== */

describe('book_computed_slot · destino que encosta em janela publicada', () => {
  it('o aluno não pega 10:30 ao lado da janela das 10:00; 10:45 e a própria janela passam', async () => {
    const teacherId = await createTeacher(sql)
    const { c, cliente } = await alunoDaProfessora(teacherId)
    const dia = daysFromToday(5)
    await abrirDia(teacherId, dia)
    const janela = instanteEm(dia, '10:00')
    const pub = await publicar(teacherId, janela)
    expect(pub.error).toBeNull()

    // três aulas do aluno, em outro dia, para remarcar
    const outroDia = daysFromToday(8)
    const a1 = await createInstanceAt(sql, c, instanteEm(outroDia, '08:00'), 45)
    const a2 = await createInstanceAt(sql, c, instanteEm(outroDia, '09:00'), 45)
    const a3 = await createInstanceAt(sql, c, instanteEm(outroDia, '10:00'), 45)

    // É o ALUNO que chama: a medida não pode depender da porta D10 da
    // professora (`teacher_window_span_min` recusa aluno).
    for (const destino of [mais(janela, 30), mais(janela, -30), mais(janela, 44)]) {
      const r = await cliente.rpc('book_computed_slot', {
        p_teacher: teacherId,
        p_starts_at_utc: destino,
        p_instance: a1,
      })
      expect(r.error?.message, destino).toContain(ENCOSTA_NA_JANELA)
      expect(r.error?.message, destino).toMatch(/\(\d{4}-\d{2}-\d{2} 10:00 \S+\)/)
      expect(await estado(a1)).toBe('scheduled')
    }
    const [w] = await sql`select state from reschedule_windows where id = ${pub.data as string}`
    expect(w.state).toBe('publicada')

    // PROVA DE MUTAÇÃO: 10:45 começa no fim medido da janela; 09:15 termina no começo.
    const ok1 = await cliente.rpc('book_computed_slot', { p_teacher: teacherId, p_starts_at_utc: mais(janela, 45), p_instance: a1 })
    expect(ok1.error).toBeNull()
    const ok2 = await cliente.rpc('book_computed_slot', { p_teacher: teacherId, p_starts_at_utc: mais(janela, -45), p_instance: a2 })
    expect(ok2.error).toBeNull()
    // …e o MESMO instante da janela é consumo dela, não encosto
    const ok3 = await cliente.rpc('book_computed_slot', { p_teacher: teacherId, p_starts_at_utc: janela, p_instance: a3 })
    expect(ok3.error).toBeNull()
    const [consumida] = await sql`select state from reschedule_windows where id = ${pub.data as string}`
    expect(consumida.state).toBe('consumida')
  })

  it('a janela é medida pela maior duração da agenda dela (slot de 60): 10:50 encosta', async () => {
    const teacherId = await createTeacher(sql)
    const { c, cliente } = await alunoDaProfessora(teacherId)
    const outro = await createPrivateContract(sql, { teacherId })
    await createSlot(sql, outro, { weekday: 1, localTime: '03:15', tz: 'America/Cuiaba', durationMin: 60 })
    const dia = daysFromToday(6)
    await abrirDia(teacherId, dia)
    const janela = instanteEm(dia, '10:00')
    expect((await publicar(teacherId, janela)).error).toBeNull()
    const aula = await createInstanceAt(sql, c, instanteEm(daysFromToday(9), '08:00'), 45)

    const r = await cliente.rpc('book_computed_slot', { p_teacher: teacherId, p_starts_at_utc: mais(janela, 50), p_instance: aula })
    expect(r.error?.message).toContain(ENCOSTA_NA_JANELA)
    const ok = await cliente.rpc('book_computed_slot', { p_teacher: teacherId, p_starts_at_utc: mais(janela, 60), p_instance: aula })
    expect(ok.error).toBeNull()
  })

  it('a leitura das janelas acontece DEPOIS do advisory da agenda dela, na ordem canônica', () => {
    // Sem o advisory, publicar (que o segura) e reservar se cruzavam: cada uma
    // lia o estado sem a escrita da outra e as duas commitavam.
    const corpo = corpoDaFuncao('book_computed_slot')
    // o fim do 3º andar: a janela do mesmo instante travada ou materializada
    const janelaTravada = corpo.indexOf('returning id into v_win')
    const gasto = corpo.indexOf("'makeup_spend:' || v_contract_id")
    const agenda = corpo.indexOf("pg_advisory_xact_lock(hashtextextended('teacher_agenda:' || p_teacher::text, 0))")
    const leitura = corpo.indexOf(ENCOSTA_NA_JANELA)
    expect(janelaTravada).toBeGreaterThan(-1)
    expect(gasto, 'janela (3º andar) antes do advisory (5º)').toBeGreaterThan(janelaTravada)
    expect(agenda, 'sub-ordem do 5º andar: makeup_spend antes de teacher_agenda').toBeGreaterThan(gasto)
    expect(leitura, 'a recusa vem depois do advisory').toBeGreaterThan(agenda)
  })
})

/* ========================================================================== */
/* 3. o "remarcar para horário novo" da administração (publica e consome)      */
/* ========================================================================== */

describe('publish_reschedule_window com p_instance · a janela que nasce para ser consumida', () => {
  it('adiantar a aula 30 min: sem p_instance a própria aula barra; com p_instance publica e consome', async () => {
    const c = await createPrivateContract(sql)
    const dia = daysFromToday(5)
    const aula = await createInstanceAt(sql, c, instanteEm(dia, '10:00'), 45)
    const destino = instanteEm(dia, '09:30')

    expect((await publicar(c.teacherId, destino)).error?.message).toContain(ENCOSTA_NA_AULA)

    const pub = await publicar(c.teacherId, destino, { p_instance: aula })
    expect(pub.error).toBeNull()
    const book = await admin.rpc('book_reschedule_window', { p_window: pub.data as string, p_instance: aula })
    expect(book.error).toBeNull()
    expect(await estado(aula)).toBe('rescheduled')
  })

  it('com p_instance, a janela vale a duração da aula movida: 30 min às 10:00 ao lado da aula das 10:30', async () => {
    // Medida pela agenda (45) ela encostaria; ela nasce para ESTA aula de 30.
    const c = await createPrivateContract(sql)
    const dia = daysFromToday(6)
    const movida = await createInstanceAt(sql, c, instanteEm(dia, '08:00'), 30)
    await createInstanceAt(sql, c, instanteEm(dia, '10:30'), 45)
    expect((await publicar(c.teacherId, instanteEm(dia, '10:00'))).error?.message).toContain(ENCOSTA_NA_AULA)
    expect((await publicar(c.teacherId, instanteEm(dia, '10:00'), { p_instance: movida })).error).toBeNull()
    // …mas não atravessa OUTRA aula: 10:15–10:45 cruza a das 10:30
    expect(
      (await publicar(c.teacherId, instanteEm(dia, '10:15'), { p_instance: movida })).error?.message,
    ).toContain(ENCOSTA_NA_AULA)
  })

  it('com p_instance, o destino que encosta em janela publicada é recusado (a mesma régua da grade calculada)', async () => {
    const c = await createPrivateContract(sql)
    const dia = daysFromToday(7)
    const janela = instanteEm(dia, '10:00')
    expect((await publicar(c.teacherId, janela)).error).toBeNull()
    const aula = await createInstanceAt(sql, c, instanteEm(daysFromToday(9), '08:00'), 45)

    const r = await publicar(c.teacherId, mais(janela, 30), { p_instance: aula })
    expect(r.error?.message).toContain(ENCOSTA_NA_JANELA)
    // PROVA DE MUTAÇÃO: começando no fim medido da janela, publica.
    expect((await publicar(c.teacherId, mais(janela, 45), { p_instance: aula })).error).toBeNull()
  })

  it('p_instance é só da administração, e só de aula agendada DA professora', async () => {
    const tUser = await createAuthUser(sql, 'teacher', 'Prof encosto')
    const [t] = await sql`
      insert into teachers (hourly_rate_cents, display_name, iana_tz, profile_id)
      values (5000, ${'Prof ' + crypto.randomUUID().slice(0, 6)}, 'America/Cuiaba', ${tUser})
      returning id`
    const c = await createPrivateContract(sql, { teacherId: t.id as string })
    const dia = daysFromToday(8)
    const aula = await createInstanceAt(sql, c, instanteEm(dia, '10:00'), 45)
    const comoProfessora = await clientAs(tUser, 'teacher')
    const r1 = await comoProfessora.rpc('publish_reschedule_window', {
      p_teacher: t.id,
      p_starts_at_utc: instanteEm(dia, '09:30'),
      p_instance: aula,
    })
    expect(r1.error?.message).toContain('só da administração')

    const alheia = await createPrivateContract(sql)
    const aulaAlheia = await createInstanceAt(sql, alheia, instanteEm(dia, '15:00'), 45)
    const r2 = await publicar(t.id as string, instanteEm(dia, '09:30'), { p_instance: aulaAlheia })
    expect(r2.error?.message).toContain('não é uma aula agendada dessa professora')
    await sql`update class_instances set state = 'cancelled' where id = ${aula}`
    const r3 = await publicar(t.id as string, instanteEm(dia, '09:30'), { p_instance: aula })
    expect(r3.error?.message).toContain('não é uma aula agendada dessa professora')
    expect(await sql`select 1 from reschedule_windows where teacher_id = ${t.id as string}`).toHaveLength(0)
  })
})
