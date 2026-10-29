// Onda Agenda e Mensagens · M2 (01/09/2026) — a professora cancela e remarca a
// PRÓPRIA aula (migration 20260901000100). Banco real, fixtures próprias
// (re-executável sem reset). Molde: fase3-teacher-windows + cancel-matrix.
//
// O que se prova aqui, na ordem do goal: posse (A não mexe na aula de B; aluno
// não entra pela porta da professora); motivo obrigatório; cancelar gera o
// crédito da matriz (ADR-018), avisa o aluno e a administração — nunca a
// própria professora —, audita o motivo; a professora É avisada quando OUTRO
// cancela (aluno pelo portal, administração); remarcar cria a instância nova
// SEM tocar a alçada do aluno, com via = 'teacher' no audit, e recusa janela
// publicada, indisponibilidade, antecedência curta e sobreposição; as funções
// internas seguem fechadas ao logado.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createInstance, createPrivateContract, createStudent } from './helpers/db'
import { corpoDaFuncao } from './helpers/definicao-da-funcao'

let sql: Sql
beforeAll(() => {
  sql = connect(2)
})
afterAll(async () => {
  await sql.end()
})

/** Professora COM login: teachers.profile_id → auth user com papel teacher. */
async function professoraComLogin(nome: string, tz = 'America/Cuiaba'): Promise<{ teacherId: string; userId: string }> {
  const userId = await createAuthUser(sql, 'teacher', nome)
  const [t] = await sql`
    insert into teachers (hourly_rate_cents, display_name, iana_tz, profile_id)
    values (5000, ${nome + ' ' + crypto.randomUUID().slice(0, 6)}, ${tz}, ${userId})
    returning id`
  return { teacherId: t.id as string, userId }
}

/** Aluno COM login (é o vínculo que `my_contract_ids()` lê). */
async function alunoComLogin(): Promise<{ studentId: string; userId: string }> {
  const studentId = await createStudent(sql)
  const userId = await createAuthUser(sql, 'student', 'Aluno M2')
  await sql`update students set profile_id = ${userId} where id = ${studentId}`
  return { studentId, userId }
}

/** Abertura pontual na agenda dela: `_teacher_available_for` aceita o destino. */
async function abrir(teacherId: string, deHoras: number, ateHoras: number): Promise<void> {
  await sql`
    insert into teacher_availability_exceptions (teacher_id, kind, starts_at_utc, ends_at_utc, local_snapshot)
    values (${teacherId}, 'open',
            now() + make_interval(hours => ${deHoras}),
            now() + make_interval(hours => ${ateHoras}),
            'fixture m2')`
}

/** Instante ISO daqui a N horas, no minuto cheio (o slot-picker manda assim). */
function daquiA(horas: number): string {
  const d = new Date(Date.now() + horas * 3_600_000)
  d.setUTCSeconds(0, 0)
  return d.toISOString()
}

async function balance(contractId: string): Promise<number> {
  const [r] = await sql`select public.makeup_balance(${contractId}) as b`
  return Number(r.b)
}
async function estado(id: string): Promise<string> {
  const [r] = await sql`select state from class_instances where id = ${id}`
  return r.state as string
}
async function avisos(template: string, recipient: string): Promise<Array<{ channel: string; payload: Record<string, unknown> }>> {
  return (await sql`
    select channel, payload from notification_outbox
     where template = ${template} and recipient_profile_id = ${recipient}`) as unknown as Array<{
    channel: string
    payload: Record<string, unknown>
  }>
}

describe('M2 · posse e motivo (D10)', () => {
  it('professora B não cancela nem remarca a aula de A; aluno não entra pela porta da professora', async () => {
    const A = await professoraComLogin('Prof A')
    const B = await professoraComLogin('Prof B')
    const aluno = await alunoComLogin()
    const c = await createPrivateContract(sql, { studentId: aluno.studentId, teacherId: A.teacherId, minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 72 })

    const comoB = await clientAs(B.userId, 'teacher')
    const r1 = await comoB.rpc('teacher_cancel_own_class', { p_instance: inst, p_reason: 'tentativa' })
    expect(r1.error?.message).toContain('não é sua')
    const r2 = await comoB.rpc('teacher_reschedule_own_class', {
      p_instance: inst,
      p_starts_at_utc: daquiA(96),
      p_reason: 'tentativa',
    })
    expect(r2.error?.message).toContain('não é sua')

    const comoAluno = await clientAs(aluno.userId, 'student')
    const r3 = await comoAluno.rpc('teacher_cancel_own_class', { p_instance: inst, p_reason: 'tentativa' })
    // gate Sol (26/10): o papel é conferido antes do vínculo
    expect(r3.error?.message).toContain('só a professora ou a administração')

    expect(await estado(inst)).toBe('scheduled')
    expect(await balance(c.contractId)).toBe(0)
  })

  it('gate Sol · conta de ALUNO ligada por engano a teachers.profile_id não entra pelas portas da professora', async () => {
    const A = await professoraComLogin('Prof A')
    const aluno = await alunoComLogin()
    const c = await createPrivateContract(sql, { studentId: aluno.studentId, teacherId: A.teacherId })
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    // o cadastro cruzado: a MESMA conta de aluno vira dona da professora A
    await sql`update teachers set profile_id = ${aluno.userId} where id = ${A.teacherId}`
    await abrir(A.teacherId, 95, 98)

    const comoAluno = await clientAs(aluno.userId, 'student')
    const r1 = await comoAluno.rpc('teacher_cancel_own_class', { p_instance: inst, p_reason: 'tentativa' })
    expect(r1.error?.message).toContain('só a professora ou a administração')
    const r2 = await comoAluno.rpc('teacher_reschedule_own_class', {
      p_instance: inst,
      p_starts_at_utc: daquiA(96),
      p_reason: 'tentativa',
    })
    expect(r2.error?.message).toContain('só a professora ou a administração')

    expect(await estado(inst)).toBe('scheduled')
    expect(await balance(c.contractId)).toBe(0)
  })

  it('motivo é obrigatório nas duas portas — vazio e só espaços recusam, nada muda', async () => {
    const A = await professoraComLogin('Prof A')
    const aluno = await alunoComLogin()
    const c = await createPrivateContract(sql, { studentId: aluno.studentId, teacherId: A.teacherId })
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    const comoA = await clientAs(A.userId, 'teacher')

    const r1 = await comoA.rpc('teacher_cancel_own_class', { p_instance: inst, p_reason: '   ' })
    expect(r1.error?.message).toContain('exige motivo')
    const r2 = await comoA.rpc('teacher_reschedule_own_class', { p_instance: inst, p_starts_at_utc: daquiA(96), p_reason: '' })
    expect(r2.error?.message).toContain('exige motivo')
    expect(await estado(inst)).toBe('scheduled')
  })
})

describe('M2 · cancelar a própria aula', () => {
  it('gera o crédito da matriz (falha da escola), avisa o aluno e a administração — nunca a si mesma — e audita o motivo', async () => {
    const A = await professoraComLogin('Prof A')
    const aluno = await alunoComLogin()
    const adminUser = await createAuthUser(sql, 'admin', 'Admin M2')
    const c = await createPrivateContract(sql, { studentId: aluno.studentId, teacherId: A.teacherId, minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 5 }) // dentro do aviso: crédito mesmo assim (ADR-018)
    const comoA = await clientAs(A.userId, 'teacher')

    const { data, error } = await comoA.rpc('teacher_cancel_own_class', { p_instance: inst, p_reason: 'consulta médica' })
    expect(error).toBeNull()
    expect((data as { credited?: boolean }).credited).toBe(true)
    expect(await estado(inst)).toBe('cancelled')
    expect(await balance(c.contractId)).toBe(1)

    // aluno avisado (e-mail; WhatsApp depende do opt-in, que a fixture não tem)
    const aoAluno = await avisos('class-cancelled', aluno.userId)
    expect(aoAluno.length).toBeGreaterThanOrEqual(1)

    // administração avisada, com o motivo — e a própria professora NÃO
    const aAdmin = await avisos('teacher-class-changed', adminUser)
    expect(aAdmin).toHaveLength(1)
    expect(aAdmin[0].channel).toBe('email')
    expect(aAdmin[0].payload.kind).toBe('cancelled')
    expect(aAdmin[0].payload.reason).toBe('consulta médica')
    expect(aAdmin[0].payload.instance_id).toBe(inst)
    // gate Sol: o e-mail leva o desfecho MEDIDO pelo miolo, não o presume
    expect(aAdmin[0].payload.credited).toBe(true)
    expect(aAdmin[0].payload.refund_blocked).toBeNull()
    expect(aAdmin[0].payload.expires_on).toBe((data as { expires_on?: string }).expires_on)
    expect(await avisos('teacher-class-changed', A.userId)).toHaveLength(0)
    expect(await avisos('class-cancelled-teacher', A.userId)).toHaveLength(0)

    // trilha: o miolo audita cancel_class com via = 'teacher'; a porta audita o motivo
    const [core] = await sql`
      select diff from audit_log where action = 'cancel_class' and entity_id = ${inst} order by id desc limit 1`
    expect(core.diff.cancelled_by).toBe('teacher')
    expect(core.diff.via).toBe('teacher')
    const [porta] = await sql`
      select diff from audit_log where action = 'teacher_cancel_own_class' and entity_id = ${inst} order by id desc limit 1`
    expect(porta.diff.reason).toBe('consulta médica')
    expect(porta.diff.credited).toBe(true)
  })
})

describe('M2 · a professora é avisada quando OUTRA pessoa cancela', () => {
  it('aluno cancela pelo portal → e-mail à professora, com quem cancelou', async () => {
    const A = await professoraComLogin('Prof A')
    const aluno = await alunoComLogin()
    const c = await createPrivateContract(sql, { studentId: aluno.studentId, teacherId: A.teacherId, minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    const comoAluno = await clientAs(aluno.userId, 'student')

    const { error } = await comoAluno.rpc('cancel_my_class', { p_instance: inst })
    expect(error).toBeNull()
    const rows = await avisos('class-cancelled-teacher', A.userId)
    expect(rows).toHaveLength(1)
    expect(rows[0].channel).toBe('email')
    expect(rows[0].payload.cancelled_by).toBe('student')
    expect(rows[0].payload.instance_id).toBe(inst)
  })

  it('administração cancela em nome da escola → e-mail à professora, dito como falha da escola', async () => {
    const A = await professoraComLogin('Prof A')
    const aluno = await alunoComLogin()
    const adminUser = await createAuthUser(sql, 'admin', 'Admin M2')
    const c = await createPrivateContract(sql, { studentId: aluno.studentId, teacherId: A.teacherId, minNotice: 24 })
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    const comoAdmin = await clientAs(adminUser, 'admin')

    const { error } = await comoAdmin.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'teacher' })
    expect(error).toBeNull()
    const rows = await avisos('class-cancelled-teacher', A.userId)
    expect(rows).toHaveLength(1)
    expect(rows[0].payload.cancelled_by).toBe('teacher')
    expect(rows[0].payload.via).toBe('admin')
  })
})

describe('M2 · remarcar a própria aula', () => {
  it('cria a instância nova no destino, SEM tocar a alçada do aluno, com via = teacher no audit, e avisa a administração', async () => {
    const A = await professoraComLogin('Prof A')
    const aluno = await alunoComLogin()
    const adminUser = await createAuthUser(sql, 'admin', 'Admin M2')
    const c = await createPrivateContract(sql, { studentId: aluno.studentId, teacherId: A.teacherId, minNotice: 24, allowance: 2 })
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    await abrir(A.teacherId, 95, 98)
    const destino = daquiA(96)
    const comoA = await clientAs(A.userId, 'teacher')

    const { data: novaId, error } = await comoA.rpc('teacher_reschedule_own_class', {
      p_instance: inst,
      p_starts_at_utc: destino,
      p_reason: 'troca com outro aluno',
    })
    expect(error).toBeNull()
    expect(typeof novaId).toBe('string')

    const [nova] = await sql`
      select state, starts_at_utc, reschedule_of, teacher_id from class_instances where id = ${novaId as string}`
    expect(nova.state).toBe('scheduled')
    expect(new Date(nova.starts_at_utc).toISOString()).toBe(destino)
    expect(nova.reschedule_of).toBe(inst)
    expect(nova.teacher_id).toBe(A.teacherId)
    expect(await estado(inst)).toBe('rescheduled')

    // alçada do aluno INTOCADA e nenhum crédito gasto
    const [uso] = await sql`
      select coalesce(sum(used_count), 0)::int as n from reschedule_usage where contract_id = ${c.contractId}`
    expect(uso.n).toBe(0)
    expect(await balance(c.contractId)).toBe(0)

    // o miolo audita com a voz da professora
    const [aud] = await sql`
      select diff from audit_log where action = 'reschedule_class' and entity_id = ${novaId as string} order by id desc limit 1`
    expect(aud.diff.via).toBe('teacher')
    expect(aud.diff.school_move).toBe(true)
    expect(aud.diff.courtesy_note).toBe('troca com outro aluno')

    // administração avisada com o destino; a professora não avisa a si mesma
    const aAdmin = await avisos('teacher-class-changed', adminUser)
    expect(aAdmin).toHaveLength(1)
    expect(aAdmin[0].payload.kind).toBe('rescheduled')
    expect(new Date(String(aAdmin[0].payload.new_starts_at_utc)).toISOString()).toBe(destino)
    expect(await avisos('teacher-class-changed', A.userId)).toHaveLength(0)
  })

  it('recusa destino que ENCOSTA em horário de reposição PUBLICADO dela (despublicar antes) e aceita o que não encosta', async () => {
    // Gate da 118 (29/10/2026, migration 20261029000100): antes só o começo
    // igual era recusado; aula movida para 10:30 com janela às 10:00 passava e
    // o aluno que tentava reservar a janela batia no índice de exclusão.
    const A = await professoraComLogin('Prof A')
    const aluno = await alunoComLogin()
    const c = await createPrivateContract(sql, { studentId: aluno.studentId, teacherId: A.teacherId })
    const inst = await createInstance(sql, c, { startsInHours: 72 }) // 45 min
    await abrir(A.teacherId, 118, 123)
    const janela = daquiA(120)
    const comoA = await clientAs(A.userId, 'teacher')
    const pub = await comoA.rpc('publish_reschedule_window', { p_teacher: A.teacherId, p_starts_at_utc: janela })
    expect(pub.error).toBeNull()

    // A janela não guarda duração: é medida com a da aula movida (120:00–120:45).
    // Recusados: mesmo minuto; aula nova 119:30–120:15 (engole o começo da
    // janela); aula nova 120:30–121:15 (começa dentro da janela medida).
    for (const destino of [janela, daquiA(119.5), daquiA(120.5)]) {
      const { error } = await comoA.rpc('teacher_reschedule_own_class', { p_instance: inst, p_starts_at_utc: destino, p_reason: 'x' })
      expect(error?.message, destino).toContain('publicado para reposição')
      expect(await estado(inst)).toBe('scheduled')
    }

    // 121:00–121:45 não encosta na janela medida: passa, e a janela segue publicada.
    const ok = await comoA.rpc('teacher_reschedule_own_class', { p_instance: inst, p_starts_at_utc: daquiA(121), p_reason: 'x' })
    expect(ok.error).toBeNull()
    expect(await estado(inst)).toBe('rescheduled')
    const [w] = await sql`select state from reschedule_windows where id = ${pub.data as string}`
    expect(w.state).toBe('publicada')
  })

  it('recusa horário fora da disponibilidade dela e destino com antecedência curta', async () => {
    const A = await professoraComLogin('Prof A')
    const aluno = await alunoComLogin()
    const c = await createPrivateContract(sql, { studentId: aluno.studentId, teacherId: A.teacherId })
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    const comoA = await clientAs(A.userId, 'teacher')

    // sem agenda semanal nem abertura: indisponível
    const r1 = await comoA.rpc('teacher_reschedule_own_class', { p_instance: inst, p_starts_at_utc: daquiA(200), p_reason: 'x' })
    expect(r1.error?.message).toContain('não está disponível')

    // aberto, mas a menos de 12 h (min_booking_lead_hours padrão) do destino
    await abrir(A.teacherId, 5, 8)
    const r2 = await comoA.rpc('teacher_reschedule_own_class', { p_instance: inst, p_starts_at_utc: daquiA(6), p_reason: 'x' })
    expect(r2.error?.message).toContain('antecedência')
    expect(await estado(inst)).toBe('scheduled')
  })

  it('gate Sol · recusa destino além das 2 semanas da grade, mesmo livre — chamada direta à RPC', async () => {
    const A = await professoraComLogin('Prof A')
    const aluno = await alunoComLogin()
    const c = await createPrivateContract(sql, { studentId: aluno.studentId, teacherId: A.teacherId })
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    await abrir(A.teacherId, 15 * 24 - 1, 15 * 24 + 3) // aberta em +15 dias: só o teto barra
    const comoA = await clientAs(A.userId, 'teacher')

    const { error } = await comoA.rpc('teacher_reschedule_own_class', {
      p_instance: inst,
      p_starts_at_utc: daquiA(15 * 24),
      p_reason: 'x',
    })
    expect(error?.message).toContain('próximas 2 semanas')
    expect(await estado(inst)).toBe('scheduled')
  })

  it('gate Sol · o teto vale para o FIM da aula: começar antes do teto e terminar depois dele recusa', async () => {
    const A = await professoraComLogin('Prof A')
    const aluno = await alunoComLogin()
    const c = await createPrivateContract(sql, { studentId: aluno.studentId, teacherId: A.teacherId })
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    // a duração vem da fixture (não presumida): o destino começa MEIA aula antes
    // do teto, então só o fim passa dele
    const [d] = await sql`select extract(epoch from ends_at_utc - starts_at_utc)::int as s from class_instances where id = ${inst}`
    const meiaAulaHoras = Number(d.s) / 3600 / 2
    expect(meiaAulaHoras).toBeGreaterThan(0)
    await abrir(A.teacherId, 14 * 24 - 2, 14 * 24 + 2)
    const comoA = await clientAs(A.userId, 'teacher')

    const { error } = await comoA.rpc('teacher_reschedule_own_class', {
      p_instance: inst,
      p_starts_at_utc: daquiA(14 * 24 - meiaAulaHoras),
      p_reason: 'x',
    })
    expect(error?.message).toContain('próximas 2 semanas')
    expect(await estado(inst)).toBe('scheduled')
  })

  it('gate Sol · as leituras de janela e disponibilidade vêm DEPOIS das travas, na ordem canônica', () => {
    // Lidas antes do advisory, um bloqueio criado no mesmo segundo passava
    // (o gatilho do insert revalida pausa, não bloqueio nem janela).
    const corpo = corpoDaFuncao('teacher_reschedule_own_class')
    const contrato = corpo.indexOf('from contracts where id = v_contract_id for update')
    const instancia = corpo.indexOf('from class_instances where id = p_instance for update')
    const agenda = corpo.indexOf("pg_advisory_xact_lock(hashtextextended('teacher_agenda:' || v_teacher::text, 0))")
    expect(contrato).toBeGreaterThan(-1)
    expect(contrato).toBeLessThan(instancia)
    expect(instancia).toBeLessThan(agenda)
    expect(agenda).toBeLessThan(corpo.indexOf('from reschedule_windows w'))
    expect(agenda).toBeLessThan(corpo.indexOf('_teacher_available_for('))
  })

  it('gate Sol · bloqueio criado por quem segura a agenda dela é RESPEITADO pela remarcação que esperava', async () => {
    // Esperar sozinho não prova nada: o gatilho do insert já pedia o mesmo
    // advisory. O que só a correção garante é ler a disponibilidade DEPOIS da
    // trava — então o bloqueio que nasce enquanto ela espera tem de barrar.
    const A = await professoraComLogin('Prof A')
    const aluno = await alunoComLogin()
    const c = await createPrivateContract(sql, { studentId: aluno.studentId, teacherId: A.teacherId })
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    await abrir(A.teacherId, 95, 98)
    const comoA = await clientAs(A.userId, 'teacher')
    const outra = connect(1)
    let remarcar!: Promise<{ error: { message: string } | null }>
    try {
      await outra.begin(async (tx) => {
        // a MESMA chave de add_teacher_block / publish_reschedule_window
        await tx`select pg_advisory_xact_lock(hashtextextended(${'teacher_agenda:' + A.teacherId}, 0))`
        remarcar = (async () =>
          comoA.rpc('teacher_reschedule_own_class', {
            p_instance: inst,
            p_starts_at_utc: daquiA(96),
            p_reason: 'serialização M2',
          }))()
        const quem = await Promise.race([
          remarcar.then(() => 'respondeu'),
          new Promise((r) => setTimeout(() => r('esperou'), 1200)),
        ])
        expect(quem).toBe('esperou')
        // o bloqueio nasce DENTRO da transação que segura a agenda
        await tx`
          insert into teacher_availability_exceptions (teacher_id, kind, starts_at_utc, ends_at_utc, local_snapshot)
          values (${A.teacherId}, 'block',
                  now() + make_interval(hours => 95),
                  now() + make_interval(hours => 98),
                  'fixture m2 · corrida')`
      })
      // advisory solto com o bloqueio já commitado: a remarcação lê e recusa
      expect((await remarcar).error?.message).toContain('não está disponível')
      expect(await estado(inst)).toBe('scheduled')
    } finally {
      await outra.end()
    }
  })

  it('gate Sol · a professora não enfileira "reposição agendada" para uma aula que não foi remarcada', async () => {
    const A = await professoraComLogin('Prof A')
    const aluno = await alunoComLogin()
    await sql`update profiles set whatsapp_e164 = '+5565999990000' where id = ${aluno.userId}`
    const c = await createPrivateContract(sql, { studentId: aluno.studentId, teacherId: A.teacherId })
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    const comoA = await clientAs(A.userId, 'teacher')

    const { error } = await comoA.rpc('enqueue_reschedule_confirmation', { p_instance: inst })
    expect(error?.message).toContain('D10')
    expect(await avisos('reschedule-confirm', aluno.userId)).toHaveLength(0)
  })

  it('recusa sobreposição com outra aula dela (índice de exclusão) — a aula original fica de pé', async () => {
    const A = await professoraComLogin('Prof A')
    const aluno1 = await alunoComLogin()
    const aluno2 = await alunoComLogin()
    const c1 = await createPrivateContract(sql, { studentId: aluno1.studentId, teacherId: A.teacherId })
    const c2 = await createPrivateContract(sql, { studentId: aluno2.studentId, teacherId: A.teacherId })
    const inst = await createInstance(sql, c1, { startsInHours: 72 })
    await createInstance(sql, c2, { startsInHours: 144 })
    await abrir(A.teacherId, 143, 146)
    const comoA = await clientAs(A.userId, 'teacher')

    const { error } = await comoA.rpc('teacher_reschedule_own_class', { p_instance: inst, p_starts_at_utc: daquiA(144), p_reason: 'x' })
    expect(error).not.toBeNull()
    expect(await estado(inst)).toBe('scheduled')
  })
})

describe('M2 · ACL: as internas seguem fechadas ao logado', () => {
  it('_enqueue_teacher_class_changed e _enqueue_class_cancelled_teacher → 42501 para teacher', async () => {
    const A = await professoraComLogin('Prof A')
    const comoA = await clientAs(A.userId, 'teacher')
    const r1 = await comoA.rpc('_enqueue_teacher_class_changed', {
      p_instance: crypto.randomUUID(),
      p_kind: 'cancelled',
      p_reason: 'x',
      p_new_instance: null,
      p_actor: null,
    })
    expect(r1.error?.code).toBe('42501')
    const r2 = await comoA.rpc('_enqueue_class_cancelled_teacher', {
      p_instance: crypto.randomUUID(),
      p_cancelled_by: 'student',
      p_via: 'self',
      p_actor: null,
    })
    expect(r2.error?.code).toBe('42501')
  })
})
