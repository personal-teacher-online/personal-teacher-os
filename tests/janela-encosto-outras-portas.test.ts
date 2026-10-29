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

import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
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
import { windowPublishConflict } from '@/lib/windows'

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

describe('windowPublishConflict · a antecipação do painel usa a medida do banco, não 45 min fixos', () => {
  it('slot vigente de 90 min, aula às 10:50: publicar às 10:00 encosta (a régua antiga de 45 não via)', async () => {
    const dia = daysFromToday(7)
    const comSlot = await createPrivateContract(sql)
    const outro = await createPrivateContract(sql, { teacherId: comSlot.teacherId })
    await createSlot(sql, outro, { weekday: 1, localTime: '03:15', tz: 'America/Cuiaba', durationMin: 90 })
    const aula = instanteEm(dia, '10:50')
    await createInstanceAt(sql, comSlot, aula, 45)
    const clash = await windowPublishConflict(serviceClient(), comSlot.teacherId, dia, '10:00')
    expect(clash && new Date(clash).toISOString()).toBe(aula)

    // PROVA DE MUTAÇÃO: a mesma agenda sem o slot de 90 mede 45 (10:00–10:45) e não acusa.
    const semSlot = await createPrivateContract(sql)
    await createInstanceAt(sql, semSlot, aula, 45)
    expect(await windowPublishConflict(serviceClient(), semSlot.teacherId, dia, '10:00')).toBeNull()
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

  it('a ordem no corpo: janela do instante → makeup_spend → teacher_agenda → janela nova → leitura das vizinhas', () => {
    const corpo = corpoDaFuncao('book_computed_slot')
    const janelaTravada = corpo.indexOf("w.state = 'publicada'\n  for update")
    const gasto = corpo.indexOf("'makeup_spend:' || v_contract_id")
    const agenda = corpo.indexOf("pg_advisory_xact_lock(hashtextextended('teacher_agenda:' || p_teacher::text, 0))")
    const janelaNova = corpo.indexOf('returning id into v_win')
    const leitura = corpo.indexOf(ENCOSTA_NA_JANELA)
    expect(janelaTravada).toBeGreaterThan(-1)
    expect(gasto, 'janela (3º andar) antes do advisory (5º)').toBeGreaterThan(janelaTravada)
    expect(agenda, 'sub-ordem do 5º andar: makeup_spend antes de teacher_agenda').toBeGreaterThan(gasto)
    expect(janelaNova, 'a janela materializada nasce sob o advisory').toBeGreaterThan(agenda)
    expect(leitura, 'a recusa vem depois do advisory').toBeGreaterThan(janelaNova)
  })
})

/* ========================================================================== */
/* 2b. as corridas: publicar × reservar na agenda da mesma professora          */
/* ========================================================================== */

describe('book_computed_slot · corridas com a publicação (advisory teacher_agenda)', () => {
  /** Cenário com aluno, aula a remarcar e o dia aberto na agenda dela. */
  async function cenario(diasAFrente: number) {
    const teacherId = await createTeacher(sql)
    const { c, cliente } = await alunoDaProfessora(teacherId)
    const dia = daysFromToday(diasAFrente)
    await abrirDia(teacherId, dia)
    const aula = await createInstanceAt(sql, c, instanteEm(daysFromToday(9), '08:00'), 45)
    return { teacherId, cliente, dia, aula }
  }

  /** Uma transação que segura o advisory da agenda dela, como a publicação faz. */
  async function segurandoAAgenda(teacherId: string, enquanto: (tx: Sql) => Promise<void>) {
    const outra = connect(1)
    try {
      await outra.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${'teacher_agenda:' + teacherId}, 0))`
        await enquanto(tx as unknown as Sql)
      })
    } finally {
      await outra.end()
    }
  }

  /** Janela publicada inserida à mão dentro da transação que segura a agenda. */
  async function janelaNa(tx: Sql, teacherId: string, inicio: string) {
    await tx`
      insert into reschedule_windows (teacher_id, local_date, local_time, iana_tz, starts_at_utc, local_time_snapshot)
      select ${teacherId}, (t at time zone 'America/Cuiaba')::date, (t at time zone 'America/Cuiaba')::time,
             'America/Cuiaba', t, to_char(t at time zone 'America/Cuiaba', 'YYYY-MM-DD HH24:MI') || ' America/Cuiaba'
        from (select ${inicio}::timestamptz as t) x`
  }

  /** Espera a reserva parar no advisory DESTA professora (nada de sleep cego). */
  async function esperaPresoNoAdvisory(teacherId: string) {
    for (let i = 0; i < 100; i++) {
      const [r] = await sql`
        select count(*)::int as n
          from pg_locks l
         where l.locktype = 'advisory' and not l.granted
           and (l.classid::bigint << 32) | l.objid::bigint
               = hashtextextended(${'teacher_agenda:' + teacherId}, 0)`
      if (r.n > 0) return
      await new Promise((ok) => setTimeout(ok, 50))
    }
    throw new Error('a reserva nunca esperou o advisory')
  }

  it('a janela VIZINHA publicada enquanto a reserva esperava a agenda é vista, e a reserva recusa', async () => {
    const { teacherId, cliente, dia, aula } = await cenario(5)
    const destino = instanteEm(dia, '10:30')
    let reserva!: Promise<{ error: { message: string } | null }>
    await segurandoAAgenda(teacherId, async (tx) => {
      reserva = Promise.resolve(cliente.rpc('book_computed_slot', { p_teacher: teacherId, p_starts_at_utc: destino, p_instance: aula }))
      await esperaPresoNoAdvisory(teacherId)
      await janelaNa(tx, teacherId, instanteEm(dia, '10:00'))
    })
    const r = await reserva
    expect(r.error?.message).toContain(ENCOSTA_NA_JANELA)
    expect(await estado(aula)).toBe('scheduled')
  })

  it('a janela do MESMO instante publicada enquanto a reserva esperava: sem 40P01, recusa com frase', async () => {
    // Antes a reserva materializava a janela ANTES do advisory: ela segurava a
    // chave do índice único e esperava o advisory; a publicação segurava o
    // advisory e esperava a chave — deadlock.
    const { teacherId, cliente, dia, aula } = await cenario(6)
    const destino = instanteEm(dia, '10:00')
    let reserva!: Promise<{ error: { message: string } | null }>
    await segurandoAAgenda(teacherId, async (tx) => {
      reserva = Promise.resolve(cliente.rpc('book_computed_slot', { p_teacher: teacherId, p_starts_at_utc: destino, p_instance: aula }))
      await esperaPresoNoAdvisory(teacherId)
      await janelaNa(tx, teacherId, destino) // a publicação commita inteira
    })
    const r = await reserva
    expect(r.error?.message).toContain('acabou de ser publicado')
    expect(await estado(aula)).toBe('scheduled')
    const [w] = await sql`
      select count(*)::int as n from reschedule_windows where teacher_id = ${teacherId} and state = 'publicada'`
    expect(w.n).toBe(1)
  })

  it('o MESMO caso pela porta da administração (admin_reschedule_to_new_time): sem 40P01, recusa com frase', async () => {
    // A RPC nova cria a janela do instante sob o advisory, como a reserva
    // calculada; subir o `insert` para antes dele traria o deadlock de volta.
    const c = await createPrivateContract(sql)
    const dia = daysFromToday(6)
    const aula = await createInstanceAt(sql, c, instanteEm(daysFromToday(9), '08:00'), 45)
    const destino = instanteEm(dia, '10:00')
    let reserva!: Promise<{ error: { message: string } | null }>
    await segurandoAAgenda(c.teacherId, async (tx) => {
      reserva = Promise.resolve(
        admin.rpc('admin_reschedule_to_new_time', { p_instance: aula, p_starts_at_utc: destino }),
      )
      await esperaPresoNoAdvisory(c.teacherId)
      await janelaNa(tx, c.teacherId, destino)
    })
    const r = await reserva
    expect(r.error?.message).toContain('acabou de ser publicado')
    expect(await estado(aula)).toBe('scheduled')
  })
})

/* ========================================================================== */
/* 2c. posse antes da agenda (R1 do revisor da PR #91)                         */
/* ========================================================================== */

describe('book_computed_slot · posse conferida antes de travar e de ler janelas', () => {
  it('aluno da professora B, pedindo horário da A: recusa de posse, sem revelar a janela da A', async () => {
    const A = await createTeacher(sql)
    const B = await createTeacher(sql)
    const dia = daysFromToday(5)
    await abrirDia(A, dia)
    expect((await publicar(A, instanteEm(dia, '10:00'))).error).toBeNull()
    const { c, cliente } = await alunoDaProfessora(B)
    const aulaDeB = await createInstanceAt(sql, c, instanteEm(daysFromToday(9), '08:00'), 45)

    // o próprio contrato (de B) pedindo a professora A
    const r1 = await cliente.rpc('book_computed_slot', {
      p_teacher: A,
      p_starts_at_utc: instanteEm(dia, '10:30'),
      p_instance: aulaDeB,
    })
    expect(r1.error?.message).toContain('outra professora (D1)')
    expect(r1.error?.message).not.toMatch(/\d{2}:\d{2}/)

    // o contrato de OUTRO aluno, da professora A
    const alheio = await createPrivateContract(sql, { teacherId: A })
    const r2 = await cliente.rpc('book_computed_slot', {
      p_teacher: A,
      p_starts_at_utc: instanteEm(dia, '10:30'),
      p_contract: alheio.contractId,
    })
    expect(r2.error?.message).toContain('(D10)')
    expect(r2.error?.message).not.toContain(ENCOSTA_NA_JANELA)
    expect(await estado(aulaDeB)).toBe('scheduled')
  })
})

/* ========================================================================== */
/* 3. o "remarcar para horário novo" da administração, numa transação só       */
/* ========================================================================== */

describe('admin_reschedule_to_new_time · cria a janela e move a aula no mesmo ato', () => {
  async function remarcar(aula: string, inicio: string) {
    return admin.rpc('admin_reschedule_to_new_time', { p_instance: aula, p_starts_at_utc: inicio })
  }

  it('adiantar a aula 30 min: a publicação comum barraria; o remarcar move, e nenhuma janela fica publicada', async () => {
    const c = await createPrivateContract(sql)
    const dia = daysFromToday(5)
    const aula = await createInstanceAt(sql, c, instanteEm(dia, '10:00'), 45)
    const destino = instanteEm(dia, '09:30')
    expect((await publicar(c.teacherId, destino)).error?.message).toContain(ENCOSTA_NA_AULA)

    const r = await remarcar(aula, destino)
    expect(r.error).toBeNull()
    expect(await estado(aula)).toBe('rescheduled')
    const [nova] = await sql`select starts_at_utc from class_instances where id = ${r.data as string}`
    expect(new Date(nova.starts_at_utc as Date).toISOString()).toBe(destino)
    const ws = await sql`select state from reschedule_windows where teacher_id = ${c.teacherId}`
    expect(ws.map((w) => w.state)).toEqual(['consumida'])
    const [aud] = await sql`
      select diff from audit_log where action = 'admin_reschedule_to_new_time' and entity_id = ${r.data as string}`
    expect(aud.diff.rescheduled_from).toBe(aula)
  })

  it('reserva que falha não deixa janela nenhuma (a transação é uma só)', async () => {
    // Antecedência mínima dela: 12 h por padrão; daqui a 2 h é recusado pela porta de sempre.
    const c = await createPrivateContract(sql)
    const aula = await createInstanceAt(sql, c, instanteEm(daysFromToday(5), '10:00'), 45)
    const [agora] = await sql`select date_trunc('minute', now()) + interval '2 hours' as t`
    const r = await remarcar(aula, new Date(agora.t as Date).toISOString())
    expect(r.error?.message).toContain('antecedência')
    expect(await sql`select 1 from reschedule_windows where teacher_id = ${c.teacherId}`).toHaveLength(0)
    expect(await estado(aula)).toBe('scheduled')
  })

  it('a janela vale a duração da aula movida: 30 min às 10:00 ao lado da aula das 10:30 passa; 10:15 não', async () => {
    const c = await createPrivateContract(sql)
    const dia = daysFromToday(6)
    const movida = await createInstanceAt(sql, c, instanteEm(dia, '08:00'), 30)
    await createInstanceAt(sql, c, instanteEm(dia, '10:30'), 45)
    expect((await remarcar(movida, instanteEm(dia, '10:15'))).error?.message).toContain(ENCOSTA_NA_AULA)
    expect((await remarcar(movida, instanteEm(dia, '10:00'))).error).toBeNull()
  })

  it('o destino que encosta em janela publicada é recusado; a do mesmo instante é consumida', async () => {
    const c = await createPrivateContract(sql)
    const dia = daysFromToday(7)
    const janela = instanteEm(dia, '10:00')
    const pub = await publicar(c.teacherId, janela)
    expect(pub.error).toBeNull()
    const a1 = await createInstanceAt(sql, c, instanteEm(daysFromToday(9), '08:00'), 45)
    const a2 = await createInstanceAt(sql, c, instanteEm(daysFromToday(9), '09:00'), 45)

    const r = await remarcar(a1, mais(janela, 30))
    expect(r.error?.message).toContain(ENCOSTA_NA_JANELA)
    expect(r.error?.message).toMatch(new RegExp(`\\(${dia} 10:00 \\S+\\)`))
    // PROVA DE MUTAÇÃO: começando no fim medido da janela, passa
    expect((await remarcar(a1, mais(janela, 45))).error).toBeNull()
    // …e no mesmo instante a janela publicada é a consumida (sem índice único estourando)
    expect((await remarcar(a2, janela)).error).toBeNull()
    const [w] = await sql`select state from reschedule_windows where id = ${pub.data as string}`
    expect(w.state).toBe('consumida')
  })

  it('só a administração usa a porta', async () => {
    const tUser = await createAuthUser(sql, 'teacher', 'Prof encosto')
    const [t] = await sql`
      insert into teachers (hourly_rate_cents, display_name, iana_tz, profile_id)
      values (5000, ${'Prof ' + crypto.randomUUID().slice(0, 6)}, 'America/Cuiaba', ${tUser})
      returning id`
    const c = await createPrivateContract(sql, { teacherId: t.id as string })
    const dia = daysFromToday(8)
    const aula = await createInstanceAt(sql, c, instanteEm(dia, '10:00'), 45)
    const comoProfessora = await clientAs(tUser, 'teacher')
    const r = await comoProfessora.rpc('admin_reschedule_to_new_time', {
      p_instance: aula,
      p_starts_at_utc: instanteEm(dia, '09:30'),
    })
    expect(r.error?.message).toContain('da administração (D10)')
    expect(await estado(aula)).toBe('scheduled')
  })

  it('o PRÓPRIO horário da aula não é remarcação: recusa, e nada cai na franquia nem no ledger', async () => {
    const c = await createPrivateContract(sql)
    const dia = daysFromToday(5)
    const inicio = instanteEm(dia, '10:00')
    const aula = await createInstanceAt(sql, c, inicio, 45)
    const r = await remarcar(aula, inicio)
    expect(r.error?.message).toContain('já é o horário da aula')
    expect(await estado(aula)).toBe('scheduled')
    expect(await sql`select 1 from reschedule_usage where contract_id = ${c.contractId} and used_count > 0`).toHaveLength(0)
    expect(await sql`select 1 from makeup_ledger where contract_id = ${c.contractId}`).toHaveLength(0)
    expect(await sql`select 1 from reschedule_windows where teacher_id = ${c.teacherId}`).toHaveLength(0)
    // PROVA DE MUTAÇÃO: 15 min depois, a MESMA aula é remarcada
    expect((await remarcar(aula, mais(inicio, 15))).error).toBeNull()
  })

  it('aula que deixou de estar agendada: recusa sem o id cru', async () => {
    const c = await createPrivateContract(sql)
    const dia = daysFromToday(6)
    const aula = await createInstanceAt(sql, c, instanteEm(dia, '10:00'), 45)
    await sql`update class_instances set state = 'cancelled' where id = ${aula}`
    const r = await remarcar(aula, instanteEm(dia, '11:00'))
    expect(r.error?.message).toContain('não está mais agendada')
    expect(r.error?.message).not.toContain(aula)
  })

  it('a ordem no corpo da RPC nova: janela do instante → makeup_spend → teacher_agenda → janela nova', () => {
    const corpo = corpoDaFuncao('admin_reschedule_to_new_time')
    const janelaTravada = corpo.indexOf("w.state = 'publicada'\n     for update")
    const gasto = corpo.indexOf("'makeup_spend:' || v_contract_id")
    const agenda = corpo.indexOf("'teacher_agenda:' || v_teacher::text")
    const janelaNova = corpo.indexOf('returning id into v_win')
    expect(janelaTravada).toBeGreaterThan(-1)
    expect(gasto).toBeGreaterThan(janelaTravada)
    expect(agenda).toBeGreaterThan(gasto)
    expect(janelaNova, 'a janela nova nasce sob o advisory').toBeGreaterThan(agenda)
  })
})
