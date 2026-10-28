// LOTE c8 — a família inteira dos achados da revisão adversarial nº 9.
//
//  · R1 — ORDEM CANÔNICA GLOBAL DE LOCKS (contrato → instância → janela →
//    horário fixo → advisory). Dois pares fechavam ciclo de verdade: reserva
//    computada × janela, e encerramento × remarcação. O que se prova aqui não é
//    "não deu deadlock desta vez": é que a RPC, quando bloqueada no PRIMEIRO
//    andar (a linha do contrato), ainda NÃO segurava nenhum lock dos andares de
//    baixo — que é exatamente o que impede o ciclo;
//  · R2 — ficha ANONIMIZADA (e arquivada, e lead) nunca ganha login, no motor e
//    no banco; e a corrida provisão × anonimização termina sem vínculo;
//  · R3 — contrato em PAUSA continua dono do horário: `create_slot` recusa
//    (inclusive entre fusos diferentes) e a retomada materializa sem buraco;
//  · R4 — `admin_reserved_credits` deixou de parar a cadeia no passo 25: com 27
//    remarcações encadeadas o crédito reservado continua contado;
//  · R5 — `tz_confirmed` só se liga como EFEITO de gravar cidade/fuso.
import { DateTime } from 'luxon'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import {
  connect,
  createPrivateContract,
  createStudent,
  createTeacher,
  daysFromToday,
  nomeDeConfirmacao,
} from './helpers/db'
import { provisionStudent } from '@/lib/auth/provision'

let sql: Sql
let admin: SupabaseClient
let adminId: string

beforeAll(async () => {
  sql = connect(8)
  adminId = await createAuthUser(sql, 'admin', 'Admin revisão 9')
  admin = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  await sql.end()
})

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Abre a agenda da professora naquele instante (a porta que
 *  `_teacher_available_for` reconhece sem depender da grade semanal dela). */
async function abrirJanela(teacherId: string, quando: DateTime, horas = 3) {
  await sql`
    insert into teacher_availability_exceptions
      (teacher_id, kind, starts_at_utc, ends_at_utc, local_snapshot)
    values (${teacherId}, 'open', ${quando.toISO()}, ${quando.plus({ hours: horas }).toISO()},
            ${quando.setZone('America/Cuiaba').toFormat('yyyy-LL-dd HH:mm') + ' America/Cuiaba'})`
}

/** Uma janela PUBLICADA da professora naquele instante. */
async function publicarJanela(teacherId: string, quando: DateTime): Promise<string> {
  const local = quando.setZone('America/Cuiaba')
  const [row] = await sql`
    insert into reschedule_windows
      (teacher_id, local_date, local_time, iana_tz, starts_at_utc, local_time_snapshot, state)
    values (${teacherId}, ${local.toISODate()}, ${local.toFormat('HH:mm')}, 'America/Cuiaba',
            ${quando.toISO()}, ${local.toFormat('yyyy-LL-dd HH:mm') + ' America/Cuiaba'},
            'publicada')
    returning id`
  return row.id as string
}

/** Segura recursos numa conexão só, e devolve a chave para soltar. */
function seguraLinhaDoContrato(contratoId: string) {
  const conexao = connect(1)
  let soltar: () => void = () => {}
  const solta = new Promise<void>((r) => (soltar = r))
  const segurando = conexao.begin(async (tx) => {
    await tx`select 1 from contracts where id = ${contratoId} for update`
    await solta
  })
  return {
    async liberar() {
      soltar()
      await segurando
      await conexao.end()
    },
  }
}

/**
 * O PROBE da ordem de locks: `<recurso>` está livre AGORA?
 *
 * `for update nowait` numa transação própria, que termina em seguida. Se a RPC
 * que está bloqueada no 1º andar já tivesse pegado este recurso, o Postgres
 * devolveria 55P03 (`lock_not_available`) — é essa a diferença entre a ordem
 * canônica e o ciclo.
 */
async function estaLivre(tabela: 'reschedule_windows' | 'class_instances', id: string) {
  const conexao = connect(1)
  try {
    await conexao.begin(async (tx) => {
      await tx.unsafe(`select 1 from ${tabela} where id = $1 for update nowait`, [id])
    })
    return { livre: true, erro: '' }
  } catch (e) {
    return { livre: false, erro: (e as Error).message }
  } finally {
    await conexao.end()
  }
}

/* ========================================================================== */
/* R1 — ordem canônica global de locks                                         */
/* ========================================================================== */

describe('R1 · a ordem canônica é observável: bloqueado no contrato, nada abaixo travado', () => {
  it('book_reschedule_window não segura janela nem instância enquanto espera o contrato', async () => {
    const c = await createPrivateContract(sql, { minNotice: 0 })
    const quando = DateTime.utc().plus({ days: 9 }).startOf('hour')
    await abrirJanela(c.teacherId, quando)
    const janela = await publicarJanela(c.teacherId, quando)
    const [inst] = await sql`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${c.contractId}, ${c.teacherId},
              now() + interval '11 days', now() + interval '11 days 45 minutes', 'fixture R1')
      returning id`

    const porta = seguraLinhaDoContrato(c.contractId)
    await espera(300)

    // dispara e NÃO espera: a RPC vai ficar parada no 1º andar
    const reserva = admin
      .rpc('book_reschedule_window', { p_window: janela, p_instance: inst.id as string })
      .then((r) => r)
    await espera(700)

    // ANTES do c8 estas duas asserções falhavam: a função travava a janela
    // (e, por dentro da remarcação, a instância) ANTES de pedir o contrato.
    const jan = await estaLivre('reschedule_windows', janela)
    const aula = await estaLivre('class_instances', inst.id as string)

    await porta.liberar()
    const r = await reserva

    expect(jan.livre, `janela deveria estar livre (${jan.erro})`).toBe(true)
    expect(aula.livre, `instância deveria estar livre (${aula.erro})`).toBe(true)
    expect(r.error?.message ?? '').not.toMatch(/deadlock|40P01/i)
    expect(r.error).toBeNull()
  })
})

describe('R1 · reserva computada × janela publicada, em paralelo', () => {
  it('as duas no MESMO contrato e na MESMA janela: sem deadlock, uma passa', async () => {
    const c = await createPrivateContract(sql, { minNotice: 0 })
    await sql`
      insert into makeup_ledger (contract_id, student_id, delta, reason, expires_on, duration_min)
      values (${c.contractId}, ${c.studentId}, 2, 'manual_adjust', ${daysFromToday(60)}, 45)`
    const quando = DateTime.utc().plus({ days: 9, hours: 2 }).startOf('hour')
    await abrirJanela(c.teacherId, quando)
    const janela = await publicarJanela(c.teacherId, quando)

    const porta = seguraLinhaDoContrato(c.contractId)
    await espera(300)

    // `.then` explícito: o builder do supabase-js só dispara a requisição quando
    // alguém o consome — sem isto as duas só sairiam depois de a porta abrir.
    const computada = admin
      .rpc('book_computed_slot', {
        p_teacher: c.teacherId,
        p_starts_at_utc: quando.toISO(),
        p_contract: c.contractId,
      })
      .then((r) => r)
    const direta = admin
      .rpc('book_reschedule_window', { p_window: janela, p_contract: c.contractId })
      .then((r) => r)
    await espera(600)

    await porta.liberar()
    const [rComputada, rDireta] = await Promise.all([computada, direta])

    expect(rComputada.error?.message ?? '', 'computada').not.toMatch(/deadlock|40P01/i)
    expect(rDireta.error?.message ?? '', 'direta').not.toMatch(/deadlock|40P01/i)

    // a janela é UMA: exatamente uma reserva nasce dela, e o crédito gasto é um
    const ok = [rComputada, rDireta].filter((r) => r.error === null)
    expect(ok).toHaveLength(1)
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances
       where contract_id = ${c.contractId} and starts_at_utc = ${quando.toISO()}
         and state = 'scheduled'`
    expect(Number(n), 'uma aula no horário da janela').toBe(1)
    const [saldo] = await sql<{ n: number }[]>`
      select public.makeup_balance(${c.contractId})::int as n`
    expect(Number(saldo.n), 'dois créditos, um consumido').toBe(1)
  })
})

describe('R1 · encerramento × remarcação, em paralelo', () => {
  it('as duas no mesmo contrato: sem deadlock, e o contrato termina encerrado e limpo', async () => {
    const c = await createPrivateContract(sql, { minNotice: 0 })
    const quando = DateTime.utc().plus({ days: 9, hours: 4 }).startOf('hour')
    await abrirJanela(c.teacherId, quando)
    const janela = await publicarJanela(c.teacherId, quando)
    const [inst] = await sql`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${c.contractId}, ${c.teacherId},
              now() + interval '12 days', now() + interval '12 days 45 minutes', 'fixture R1b')
      returning id`

    const porta = seguraLinhaDoContrato(c.contractId)
    await espera(300)

    const encerra = admin
      .rpc('admin_end_contract', {
        p_contract: c.contractId,
        p_confirm_name: await nomeDeConfirmacao(sql, c.contractId),
      })
      .then((r) => r)
    const remarca = admin
      .rpc('book_reschedule_window', { p_window: janela, p_instance: inst.id as string })
      .then((r) => r)
    await espera(600)

    await porta.liberar()
    const [rFim, rRemarca] = await Promise.all([encerra, remarca])

    expect(rFim.error?.message ?? '', 'encerramento').not.toMatch(/deadlock|40P01/i)
    expect(rRemarca.error?.message ?? '', 'remarcação').not.toMatch(/deadlock|40P01/i)
    // o encerramento passa nas duas ordens possíveis (a aula é futura, então
    // não há pendência); a remarcação só passa se chegar antes
    expect(rFim.error).toBeNull()

    const [ct] = await sql<{ status: string }[]>`
      select status from contracts where id = ${c.contractId}`
    expect(ct.status).toBe('ended')
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances
       where contract_id = ${c.contractId} and state = 'scheduled' and starts_at_utc > now()`
    expect(Number(n), 'nenhuma aula futura sobrevive ao encerramento').toBe(0)
  })
})

describe('R1 · a ordem está escrita nos corpos vivos', () => {
  const semEspaco = (s: string) => s.replace(/\s+/g, ' ')

  async function fonte(nome: string): Promise<string> {
    const [f] = await sql<{ src: string }[]>`
      select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = ${nome}`
    return semEspaco(f.src)
  }

  it('contrato ANTES de instância nas quatro funções que travam as duas', async () => {
    for (const nome of ['_cancel_class_core', '_mark_no_show', 'reschedule_class_at']) {
      const src = await fonte(nome)
      const contrato = src.indexOf('from contracts where id = v_contract_id for update')
      const instancia = src.indexOf('from class_instances where id = p_instance for update')
      expect(contrato, `${nome}: trava a linha do contrato`).toBeGreaterThan(-1)
      expect(instancia, `${nome}: trava a linha da instância`).toBeGreaterThan(-1)
      expect(contrato, `${nome}: contrato antes da instância`).toBeLessThan(instancia)
    }
    const book = await fonte('book_reschedule_window')
    const contrato = book.indexOf('from contracts where id = v_contract_id for update')
    const instancia = book.indexOf('from class_instances where id = p_instance for update')
    const janela = book.indexOf('from reschedule_windows where id = p_window for update')
    const advisory = book.indexOf("makeup_spend:' || v_contract.id")
    expect(contrato).toBeGreaterThan(-1)
    expect(contrato, 'contrato antes da instância').toBeLessThan(instancia)
    expect(instancia, 'instância antes da janela').toBeLessThan(janela)
    expect(janela, 'janela antes do advisory').toBeLessThan(advisory)
  })

  it('janela ANTES do advisory na reserva computada', async () => {
    const src = await fonte('book_computed_slot')
    const contrato = src.indexOf('from contracts where id = v_contract_id for update')
    const janela = src.indexOf('from reschedule_windows w')
    const advisory = src.indexOf("makeup_spend:' || p_contract")
    expect(contrato).toBeGreaterThan(-1)
    expect(contrato, 'contrato antes da janela').toBeLessThan(janela)
    expect(janela, 'janela antes do advisory').toBeLessThan(advisory)
  })

  it('nenhum lock de LINHA sobra depois do advisory nas funções de contrato', async () => {
    for (const nome of ['admin_end_contract', 'admin_renew_contract']) {
      const src = await fonte(nome)
      const advisory = src.indexOf("pg_advisory_xact_lock(hashtextextended('makeup_spend:")
      expect(advisory, `${nome}: tem o advisory do gasto`).toBeGreaterThan(-1)
      expect(src.slice(advisory), `${nome}: nada de FOR UPDATE depois do advisory`).not.toMatch(
        /for update/i,
      )
    }
  })

  it('resume_contract trava linhas antes de estender crédito e de materializar', async () => {
    // aqui o advisory não aparece no corpo: ele mora dentro de `_reissue_credit`
    // (gasto) e de `materialize_slot`. O que se mede é a POSIÇÃO das chamadas.
    const src = await fonte('resume_contract')
    const instancias = src.indexOf('from class_instances where contract_id = p_contract')
    const slots = src.indexOf('from recurring_slots where contract_id = p_contract')
    const credito = src.indexOf('public._reissue_credit(')
    const materializa = src.indexOf('public.materialize_slot(')
    expect(instancias, 'trava as instâncias da pausa').toBeGreaterThan(-1)
    expect(slots, 'trava os horários fixos vigentes').toBeGreaterThan(-1)
    expect(instancias, 'instâncias antes dos slots').toBeLessThan(slots)
    expect(slots, 'slots antes da extensão de crédito').toBeLessThan(credito)
    expect(slots, 'slots antes da materialização').toBeLessThan(materializa)
  })

  it('close_and_create_slot passa pela porta do contrato antes de tudo', async () => {
    const src = await fonte('close_and_create_slot')
    const contrato = src.indexOf('from contracts where id = v_contract_id for update')
    const instancias = src.indexOf('from class_instances where slot_id = p_slot')
    const slot = src.indexOf('from recurring_slots where id = p_slot for update')
    expect(contrato, 'trava a linha do contrato').toBeGreaterThan(-1)
    expect(contrato, 'contrato antes das instâncias').toBeLessThan(instancias)
    expect(instancias, 'instâncias antes do slot').toBeLessThan(slot)
  })
})

/* ========================================================================== */
/* R2 — anonimizado nunca ganha login                                          */
/* ========================================================================== */

describe('R2 · só aluno ATIVO e não-anonimizado recebe portal', () => {
  const email = () => `r2-${crypto.randomUUID().slice(0, 8)}@exemplo.com`

  it('o motor recusa ANONIMIZADO, e nada nasce no Auth', async () => {
    const id = await createStudent(sql)
    await sql`update students set status = 'archived', anonymized_at = now() where id = ${id}`
    const service = serviceClient()
    const alvo = email()

    const r = await provisionStudent(service, id, alvo, adminId)
    expect(r.status).toBe('error')
    expect(r.status === 'error' && r.message).toMatch(/anonimizada/i)

    const { data } = await service.auth.admin.listUsers({ page: 1, perPage: 200 })
    expect(data.users.some((u) => u.email === alvo)).toBe(false)
  })

  it('o motor recusa ARQUIVADO (sem anonimizar)', async () => {
    const id = await createStudent(sql)
    await sql`update students set status = 'archived' where id = ${id}`
    const r = await provisionStudent(serviceClient(), id, email(), adminId)
    expect(r.status).toBe('error')
    expect(r.status === 'error' && r.message).toMatch(/archived|ATIVO/i)
  })

  it('o motor continua recusando LEAD, com a mensagem de sempre', async () => {
    const id = await createStudent(sql)
    await sql`update students set status = 'lead' where id = ${id}`
    const r = await provisionStudent(serviceClient(), id, email(), adminId)
    expect(r.status).toBe('error')
    expect(r.status === 'error' && r.message).toMatch(/LEAD/)
  })

  it('o CINTO do banco recusa os três (é ele que fecha o TOCTOU)', async () => {
    for (const [situacao, padrao] of [
      ['lead', /lead não tem portal/i],
      ['archived', /arquivado/i],
    ] as const) {
      const id = await createStudent(sql)
      await sql`update students set status = ${situacao} where id = ${id}`
      const perfil = await createAuthUser(sql, 'student', 'Perfil solto R2')
      await expect(
        sql`update students set profile_id = ${perfil} where id = ${id}`,
      ).rejects.toThrow(padrao)
    }

    const anon = await createStudent(sql)
    await sql`update students set status = 'archived', anonymized_at = now() where id = ${anon}`
    const perfil = await createAuthUser(sql, 'student', 'Perfil solto R2 anon')
    await expect(
      sql`update students set profile_id = ${perfil} where id = ${anon}`,
    ).rejects.toThrow(/anonimizada/i)
  })

  it('corrida provisão × anonimização: termina SEM vínculo', async () => {
    const nome = 'Aluna da corrida R2'
    const [row] = await sql`
      insert into students (display_name, iana_tz) values (${nome}, 'America/Cuiaba')
      returning id`
    const id = row.id as string

    // Uma terceira conexão segura a LINHA do aluno. Com ela presa, o motor do
    // convite já LEU o status (que ainda era 'active') e vai bater na trava só
    // na hora de gravar o vínculo — a janela exata do TOCTOU.
    const conexao = connect(1)
    let soltar: () => void = () => {}
    const solta = new Promise<void>((r) => (soltar = r))
    const segurando = conexao.begin(async (tx) => {
      await tx`select 1 from students where id = ${id} for update`
      await solta
    })
    await espera(300)

    const convite = provisionStudent(serviceClient(), id, `r2race-${Date.now()}@exemplo.com`, adminId, '+5565900000002')
    await espera(500)
    const anonimiza = admin
      .rpc('admin_anonymize_student', { p_student: id, p_confirm: nome })
      .then((r) => r)
    await espera(400)

    soltar()
    await segurando
    const [rConvite, rAnon] = await Promise.all([convite, anonimiza])
    await conexao.end()

    expect(String(rConvite.status === 'error' ? rConvite.message : '')).not.toMatch(/deadlock/i)
    expect(rAnon.error?.message ?? '').not.toMatch(/deadlock/i)

    // O desfecho que importa, em QUALQUER ordem: a ficha não fica com login.
    // (convite primeiro → a anonimização desvincula; anonimização primeiro → o
    // gatilho recusa o vínculo e o motor desfaz o usuário que criou.)
    const [depois] = await sql<{ profile_id: string | null; anonymized_at: Date | null }[]>`
      select profile_id, anonymized_at from students where id = ${id}`
    expect(depois.profile_id, 'ficha anonimizada não fica com login').toBeNull()
    if (rAnon.error === null) expect(depois.anonymized_at).not.toBeNull()
  })
})

/* ========================================================================== */
/* R3 — pausa longa continua dona do horário                                   */
/* ========================================================================== */

describe('R3 · contrato em PAUSA continua dono do horário fixo', () => {
  /** Contrato ativo com aluno em `tz`, pronto para receber horário fixo. */
  async function contratoCom(tz: string, teacherId?: string) {
    const studentId = await createStudent(sql, tz)
    await sql`update students set city = 'Cidade R3', country = 'BR' where id = ${studentId}`
    const teacher = teacherId ?? (await createTeacher(sql))
    const [c] = await sql`
      insert into contracts
        (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${studentId}, ${teacher}, 'R3', 15000, 4, 24, 90,
              public.business_today())
      returning id`
    return { contractId: c.id as string, teacherId: teacher, studentId }
  }

  /** A pausa LONGA simulada.
   *
   *  Pausar e APAGAR as futuras já materializadas é o retrato fiel do que 8+
   *  semanas fazem sozinhas: as ocorrências que existiam viram passado, e o
   *  materializador não cria nenhuma nova enquanto o contrato estiver pausado.
   *  (Cancelar em vez de apagar não serviria: a linha cancelada continua
   *  ocupando `(slot_id, occurrence_date)`, então ela ainda "existe" para o
   *  materializador — e para nada mais.) */
  async function pausaLonga(contratoId: string) {
    const { error } = await admin.rpc('pause_contract', { p_contract: contratoId })
    expect(error).toBeNull()
    await sql`
      delete from class_instances
       where contract_id = ${contratoId} and state = 'scheduled'`
  }

  it('depois da pausa longa, o horário NÃO é oferecido a uma admissão nova', async () => {
    const pausado = await contratoCom('America/Cuiaba')
    const criar = await admin.rpc('create_slot', {
      p_contract: pausado.contractId,
      p_weekday: 2,
      p_local_time: '10:00',
      p_duration_min: 45,
    })
    expect(criar.error).toBeNull()
    const [{ n: antes }] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances
       where contract_id = ${pausado.contractId} and state = 'scheduled'`
    expect(Number(antes), 'a criação materializou as 8 semanas').toBeGreaterThan(4)

    await pausaLonga(pausado.contractId)
    const [{ n: vazio }] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances
       where contract_id = ${pausado.contractId} and state = 'scheduled'`
    expect(Number(vazio), 'sem instância nenhuma, a exclusão GiST não vê nada').toBe(0)

    // MESMA professora, MESMO instante — agora dito em OUTRO fuso (São Paulo é
    // UTC−3 o ano inteiro, Cuiabá é UTC−4: 10:00 lá = 11:00 aqui, sempre).
    const novo = await contratoCom('America/Sao_Paulo', pausado.teacherId)
    const colide = await admin.rpc('create_slot', {
      p_contract: novo.contractId,
      p_weekday: 2,
      p_local_time: '11:00',
      p_duration_min: 45,
    })
    expect(colide.error?.message).toMatch(/EM PAUSA/)
    const [{ n: nada }] = await sql<{ n: number }[]>`
      select count(*)::int as n from recurring_slots where contract_id = ${novo.contractId}`
    expect(Number(nada), 'nada de horário fixo criado').toBe(0)

    // e a guarda não é cega: uma hora antes (sem sobreposição) passa
    const livre = await admin.rpc('create_slot', {
      p_contract: novo.contractId,
      p_weekday: 2,
      p_local_time: '10:00',
      p_duration_min: 45,
    })
    expect(livre.error).toBeNull()
  })

  it('a RETOMADA materializa sem buraco (o horário estava guardado)', async () => {
    const pausado = await contratoCom('America/Cuiaba')
    const criar = await admin.rpc('create_slot', {
      p_contract: pausado.contractId,
      p_weekday: 4,
      p_local_time: '14:00',
      p_duration_min: 45,
    })
    expect(criar.error).toBeNull()
    await pausaLonga(pausado.contractId)

    const retoma = await admin.rpc('resume_contract', { p_contract: pausado.contractId })
    expect(retoma.error).toBeNull()

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances
       where contract_id = ${pausado.contractId} and state = 'scheduled'`
    expect(Number(n), 'as 8 semanas voltam inteiras').toBeGreaterThan(4)
    const [{ n: conflitos }] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where action = 'materialize_conflict'
         and entity_id in (select id::text from recurring_slots
                            where contract_id = ${pausado.contractId})`
    expect(Number(conflitos), 'nenhuma ocorrência pulada por conflito').toBe(0)
  })

  it('a antecipação da tela mostra o horário pausado com rótulo próprio', async () => {
    const { janelasDoSlotPausado } = await import('@/lib/agenda/ocupacao-fuso')
    const agora = DateTime.utc()
    const janelas = janelasDoSlotPausado(
      {
        id: 'slot-teste',
        teacher_id: 'prof-teste',
        contract_id: 'contrato-teste',
        weekday: 2,
        local_time: '10:00:00',
        iana_tz: 'America/Cuiaba',
        duration_min: 45,
        active_from: '2020-01-01',
        active_to: null,
      },
      'America/Sao_Paulo',
      agora,
      agora.plus({ weeks: 8, days: 1 }),
    )
    expect(janelas.length).toBeGreaterThan(0)
    // 10:00 em Cuiabá é 11:00 em São Paulo, o ano inteiro
    expect(janelas[0].weekday).toBe(2)
    expect(janelas[0].inicio).toBe(11 * 60)
    expect(janelas[0].quem).toBe('reservado — contrato em pausa')
    expect(janelas[0].texto).toContain('11:00')
  })
})

/* ========================================================================== */
/* R4 — recursão sem teto funcional                                            */
/* ========================================================================== */

describe('R4 · a cadeia de remarcações não morre no passo 25', () => {
  it('27 remarcações encadeadas: o crédito reservado continua contado', async () => {
    // franquia ZERO na primeira remarcação (é ela que gasta o crédito e prende
    // o débito à aula ORIGINAL); depois a franquia sobe e as demais são de graça
    const c = await createPrivateContract(sql, { allowance: 0, minNotice: 0 })
    await sql`
      insert into makeup_ledger (contract_id, student_id, delta, reason, expires_on, duration_min)
      values (${c.contractId}, ${c.studentId}, 1, 'manual_adjust', ${daysFromToday(200)}, 45)`

    const base = DateTime.utc().plus({ days: 40 }).startOf('hour')
    const [inst] = await sql`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${c.contractId}, ${c.teacherId}, ${base.toISO()},
              ${base.plus({ minutes: 45 }).toISO()}, 'fixture R4')
      returning id`

    let atual = inst.id as string
    const PASSOS = 27
    for (let i = 1; i <= PASSOS; i++) {
      // 5 dias por salto: a franquia é contada por MÊS CIVIL da aula de origem,
      // e o teto do banco é 10 — espalhar a cadeia por ~4 meses mantém cada mês
      // bem abaixo do teto sem inventar contrato irreal.
      const quando = base.plus({ days: i * 5 })
      const [nova] = await sql<{ id: string }[]>`
        select public.reschedule_class_at(
          ${atual}::uuid, ${quando.toISO()}::timestamptz, ${'R4 passo ' + i},
          ${adminId}::uuid, false, null, true) as id`
      atual = nova.id
      if (i === 1) {
        // a partir daqui a franquia paga — só o PRIMEIRO salto gasta crédito
        await sql`
          update contracts set monthly_reschedule_allowance = 10 where id = ${c.contractId}`
      }
    }

    // a cadeia tem 28 elos (a original + 27 remarcações) — bem além do teto de 25
    const [{ n: elos }] = await sql<{ n: number }[]>`
      with recursive cadeia as (
        select id from class_instances where id = ${inst.id as string}
        union all
        select f.id from cadeia c join class_instances f on f.reschedule_of = c.id
      ) select count(*)::int as n from cadeia`
    expect(Number(elos)).toBe(PASSOS + 1)

    const debitos = await sql<{ n: number }[]>`
      select count(*)::int as n from makeup_ledger
       where contract_id = ${c.contractId} and delta < 0`
    expect(Number(debitos[0].n), 'um único gasto de crédito na cadeia').toBe(1)

    const { data, error } = await admin.rpc('admin_reserved_credits', {
      p_contract_ids: [c.contractId],
    })
    expect(error).toBeNull()
    expect(Number(data), 'o crédito segue reservado na ponta viva da cadeia').toBe(1)

    // e some quando a aula da ponta deixa de existir
    await sql`update class_instances set state = 'cancelled' where id = ${atual}`
    const depois = await admin.rpc('admin_reserved_credits', { p_contract_ids: [c.contractId] })
    expect(Number(depois.data)).toBe(0)
  })

  it('o teto mágico saiu do corpo vivo e virou detecção de ciclo', async () => {
    const [f] = await sql<{ src: string }[]>`
      select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'admin_reserved_credits'`
    expect(f.src).not.toMatch(/passo\s*<\s*25/)
    expect(f.src.replace(/\s+/g, ' ')).toContain('cycle id set eh_ciclo using caminho')
  })
})

/* ========================================================================== */
/* R5 — tz_confirmed só pelo caminho legítimo                                  */
/* ========================================================================== */

describe('R5 · a confirmação do fuso é EFEITO de gravar cidade/fuso', () => {
  async function leadSemCidade(nome: string): Promise<string> {
    const { data, error } = await admin.rpc('admin_create_lead', { p_name: nome })
    expect(error).toBeNull()
    return data as string
  }

  it('ligar o flag sozinho é recusado — no SQL cru e pelo PostgREST', async () => {
    const id = await leadSemCidade('Lead do flag R5')
    await expect(
      sql`update students set tz_confirmed = true where id = ${id}`,
    ).rejects.toThrow(/não se liga sozinho/i)

    const { error } = await admin.from('students').update({ tz_confirmed: true }).eq('id', id)
    expect(error?.message).toMatch(/não se liga sozinho/i)

    const [row] = await sql<{ tz_confirmed: boolean }[]>`
      select tz_confirmed from students where id = ${id}`
    expect(row.tz_confirmed, 'segue palpite').toBe(false)
  })

  // SUPERSEDIDOS pelo c9 · S3 (revisão nº 10). O R5 fez `tz_confirmed` deixar de
  // se ligar sozinho, mas manteve a confirmação como EFEITO de gravar cidade OU
  // fuso — e aí gravar só a cidade (com o fuso ainda no palpite herdado da
  // escola) confirmava um relógio que ninguém olhou. Confirmar virou ATO:
  // `confirm_student_location`. Os dois casos abaixo passaram a provar o
  // contrário do que provavam; a bateria completa do ato novo está em
  // `m3-c9-revisao-10.test.ts`.
  it('o `update` de cadastro NÃO confirma mais (a confirmação é ato à parte)', async () => {
    const id = await leadSemCidade('Lead que completa R5')
    const { error } = await admin
      .from('students')
      .update({ city: 'Lisboa', country: 'PT', iana_tz: 'Europe/Lisbon' })
      .eq('id', id)
    expect(error).toBeNull()
    const [row] = await sql<{ tz_confirmed: boolean }[]>`
      select tz_confirmed from students where id = ${id}`
    expect(row.tz_confirmed).toBe(false)
  })

  it('gravar cidade/fuso JUNTO com o flag também é recusado (não há disfarce)', async () => {
    const id = await leadSemCidade('Lead do combo R5')
    await expect(
      sql`
        update students set city = 'Cuiabá', iana_tz = 'America/Cuiaba', tz_confirmed = true
         where id = ${id}`,
    ).rejects.toThrow(/não se liga sozinho/i)
    const [row] = await sql<{ tz_confirmed: boolean }[]>`
      select tz_confirmed from students where id = ${id}`
    expect(row.tz_confirmed).toBe(false)
  })

  it('DESLIGAR continua livre (é assim que se marca um cadastro para revisão)', async () => {
    const id = await createStudent(sql)
    await sql`update students set tz_confirmed = false where id = ${id}`
    const [row] = await sql<{ tz_confirmed: boolean }[]>`
      select tz_confirmed from students where id = ${id}`
    expect(row.tz_confirmed).toBe(false)
  })

  it('escrita que não toca cidade/fuso/flag passa sem ruído', async () => {
    const id = await leadSemCidade('Lead intocado R5')
    await sql`update students set level = 'A2' where id = ${id}`
    const [row] = await sql<{ tz_confirmed: boolean; level: string }[]>`
      select tz_confirmed, level from students where id = ${id}`
    expect(row.level).toBe('A2')
    expect(row.tz_confirmed).toBe(false)
  })
})
