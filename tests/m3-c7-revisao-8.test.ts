// M3-c7 — os dez achados da revisão adversarial nº 8 (Sol, 27/07/2026), mais o
// follow-up de contraste (F1) que o lote anterior deixou anotado.
//
// O que cada bloco prova:
//  · P1 — `_promote_lead` era SECURITY DEFINER com EXECUTE para PUBLIC: qualquer
//    um promovia qualquer cadastro e forjava a auditoria. Revogado — e o gatilho
//    continua funcionando (é ele que precisa da função, não o chamador);
//  · P2 — a ordem dos locks do resgate de crédito (contrato FOR UPDATE →
//    advisory do gasto) é a mesma da extensão: as duas em paralelo não fecham
//    ciclo de deadlock;
//  · P3 — "agendados" segue a cadeia de remarcação (o débito fica na aula
//    ORIGINAL, que vira `rescheduled`);
//  · P4 — contrato de turma × entrada de membro, em transações simultâneas, não
//    deixam lead com contrato de verdade;
//  · P5 — lead perdido que VOLTA é reativado com auditoria própria; ficha
//    ANONIMIZADA nunca volta;
//  · P6 — fuso do cadastro mínimo é PALPITE e trava contrato/horário até alguém
//    completar o cadastro;
//  · P7 — convidar um LEAD é recusado no motor, antes de qualquer efeito no
//    Auth (e o banco tem o mesmo cinto);
//  · P8 — contrato que nasce `ended` não promove ninguém;
//  · P9 — a antecipação de agenda lê as aulas MATERIALIZADAS: hora ambígua de
//    DST, limite exato dos 56 dias e vigência de horário;
//  · P10 — o funil mudou de chave (`?situacao=`), e `?f=` voltou a ser só ACESSO;
//  · F1 — o par da pílula `ok` passa AA de verdade, medido sobre a cor que a
//    pessoa vê (nada de alpha, que depende da superfície de baixo).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DateTime, Settings } from 'luxon'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { anonClient, clientAs, createAuthUser, serviceClient } from './helpers/auth'
import {
  connect,
  createPrivateContract,
  createSlot,
  createStudent,
  createTeacher,
  daysFromToday,
  proximoRecuo,
} from './helpers/db'
import {
  fimDaAntecipacao,
  janelasDaAgenda,
  janelasDoHorarioFixo,
  type AulaMaterializada,
} from '@/lib/agenda/ocupacao-fuso'
import { lerAulasDaAgenda } from '@/data/admin/ocupacao-consulta'
import { contarCreditosReservados } from '@/data/admin/ficha-consultas'
import { provisionStudent } from '@/lib/auth/provision'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

let sql: Sql
let admin: SupabaseClient
let adminId: string
let teacherUser: string
let studentUser: string

beforeAll(async () => {
  sql = connect(4)
  adminId = await createAuthUser(sql, 'admin', 'Admin revisão 8')
  admin = await clientAs(adminId, 'admin')
  teacherUser = await createAuthUser(sql, 'teacher', 'Professora revisão 8')
  studentUser = await createAuthUser(sql, 'student', 'Aluno revisão 8')
})
afterAll(async () => {
  await sql.end()
})

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Abre a agenda da professora naquele instante (exceção `open`, a porta que
 *  `_teacher_available_for` reconhece sem depender da grade semanal dela). */
async function abrirJanela(teacherId: string, quando: DateTime, horas = 2) {
  await sql`
    insert into teacher_availability_exceptions
      (teacher_id, kind, starts_at_utc, ends_at_utc, local_snapshot)
    values (${teacherId}, 'open', ${quando.toISO()}, ${quando.plus({ hours: horas }).toISO()},
            ${quando.setZone('America/Cuiaba').toFormat('yyyy-LL-dd HH:mm') + ' America/Cuiaba'})`
}

/** Lead com cidade e fuso de verdade — o caminho normal do CityPicker. */
async function criarLead(nome: string, tz = 'America/Cuiaba', city = 'Cuiabá'): Promise<string> {
  const { data, error } = await admin.rpc('admin_create_lead', {
    p_name: nome,
    p_iana_tz: tz,
    p_city: city,
    p_country: 'BR',
  })
  expect(error).toBeNull()
  return data as string
}

async function statusDe(studentId: string): Promise<string> {
  const [row] = await sql<{ status: string }[]>`
    select status from students where id = ${studentId}`
  return row.status
}

async function contratoPara(studentId: string, teacherId: string, extra = '') {
  const [row] = await sql`
    insert into contracts
      (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
       monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
    values ('private_1on1', ${studentId}, ${teacherId}, ${'revisão 8 ' + extra}, 15000, 4, 24, 90,
            public.business_today() - 40)
    returning id`
  return row.id as string
}

/* ========================================================================== */
/* P1 — o crítico: SECURITY DEFINER sem gate e sem REVOKE                      */
/* ========================================================================== */

describe('P1 · _promote_lead não é executável por ninguém de fora', () => {
  it('anon, aluno e professora levam permission denied', async () => {
    const lead = await criarLead('Lead do ataque P1')
    const prof = await clientAs(teacherUser, 'teacher')
    const aluno = await clientAs(studentUser, 'student')

    for (const [quem, cliente] of [
      ['anônimo', anonClient()],
      ['aluno', aluno],
      ['professora', prof],
    ] as const) {
      const { error } = await cliente.rpc('_promote_lead', {
        p_student: lead,
        p_via: 'forjado',
        p_contract: null,
      })
      expect(error, quem).not.toBeNull()
      expect(`${error?.message} ${error?.code ?? ''}`, quem).toMatch(/permission denied|42883|PGRST/i)
    }
    // e o cadastro continua sendo lead: nada foi promovido, nada foi auditado
    expect(await statusDe(lead)).toBe('lead')
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity = 'students' and entity_id = ${lead} and action = 'lead_promoted'`
    expect(Number(n)).toBe(0)
  })

  it('nenhuma das três funções do ciclo de vida tem EXECUTE para PUBLIC', async () => {
    const linhas = await sql<{ proname: string; acl: string | null }[]>`
      select p.proname, array_to_string(p.proacl, ' ; ') as acl
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('_promote_lead', 'promote_lead_on_contract',
                           'promote_lead_on_group_member', '_require_confirmed_tz',
                           'contracts_require_confirmed_tz', 'students_confirm_tz',
                           'students_lead_sem_login')`
    expect(linhas.length).toBe(7)
    for (const l of linhas) {
      // `proacl` NULO é o default do Postgres = EXECUTE para PUBLIC — foi
      // exatamente esse o buraco. Depois do REVOKE a coluna existe e não cita
      // nem `=X/` (PUBLIC), nem anon, nem authenticated.
      expect(l.acl, l.proname).not.toBeNull()
      expect(l.acl!, l.proname).not.toMatch(/(^|;)\s*=X/)
      expect(l.acl!, l.proname).not.toContain('anon=')
      expect(l.acl!, l.proname).not.toContain('authenticated=')
    }
  })

  it('o GATILHO continua promovendo (quem precisa do EXECUTE é ele, não o chamador)', async () => {
    const lead = await criarLead('Lead que fecha depois do revoke')
    const teacher = await createTeacher(sql)
    const { error } = await admin.from('contracts').insert({
      contract_type: 'private_1on1',
      student_id: lead,
      teacher_id: teacher,
      plan_name: 'P1 pelo PostgREST',
      hourly_rate_cents: 15000,
      monthly_reschedule_allowance: 4,
      min_notice_hours: 24,
      makeup_credit_expiry_days: 90,
      started_on: daysFromToday(-40),
    })
    expect(error).toBeNull()
    expect(await statusDe(lead)).toBe('active')
  })
})

/* ========================================================================== */
/* P2 — ordem de locks: extensão × resgate não deadlockam                      */
/* ========================================================================== */

describe('P2 · resgate e extensão de crédito na MESMA ordem de locks', () => {
  it('as duas em paralelo terminam sem deadlock e com o resultado certo', async () => {
    const c = await createPrivateContract(sql)
    // Dois créditos, com alvos SEPARADOS de propósito: o resgate consome sempre
    // o de validade mais curta (o replay FIFO por `expires_on`), então a
    // extensão mira o outro. Assim o que se mede aqui é a ordem dos locks, e
    // não quem chegou primeiro na fila do crédito.
    await sql`
      insert into makeup_ledger (contract_id, student_id, delta, reason, expires_on, duration_min)
      values (${c.contractId}, ${c.studentId}, 1, 'manual_adjust', ${daysFromToday(30)}, 45)`
    const [alvoDaExtensao] = await sql`
      insert into makeup_ledger (contract_id, student_id, delta, reason, expires_on, duration_min)
      values (${c.contractId}, ${c.studentId}, 1, 'manual_adjust', ${daysFromToday(60)}, 45)
      returning id`

    // Janela de disponibilidade da professora no instante do resgate. DEZ dias
    // à frente de propósito: a semana corrente é contada globalmente pelos KPIs
    // (`aulas_da_semana`) e a suíte roda arquivos em paralelo — fixture desta
    // casa dentro da semana entra na conta do vizinho. O teto do banco para
    // reserva é 14 dias, então 10 é o meio do caminho.
    const quando = DateTime.utc().plus({ days: 10 }).startOf('hour')
    await abrirJanela(c.teacherId, quando)

    // Uma terceira conexão segura a LINHA do contrato. As duas RPCs entram na
    // fila DESSA linha — que é o primeiro lock das duas desde o P2. Antes,
    // `book_computed_slot` pegava o advisory do gasto ANTES da linha: bastava a
    // extensão ganhar a linha para as duas ficarem esperando uma pela outra.
    const seguradora = connect(1)
    let soltar: () => void = () => {}
    const solta = new Promise<void>((r) => (soltar = r))
    const segurando = seguradora.begin(async (tx) => {
      await tx`select 1 from contracts where id = ${c.contractId} for update`
      await solta
    })

    await espera(300)
    const extensao = admin.rpc('admin_extend_credit', {
      p_ledger: Number(alvoDaExtensao.id),
      p_new_expires_on: daysFromToday(90),
      p_note: 'P2 · extensão concorrente',
    })
    await espera(300)
    const resgate = admin.rpc('book_computed_slot', {
      p_teacher: c.teacherId,
      p_starts_at_utc: quando.toISO(),
      p_contract: c.contractId,
    })
    await espera(300)

    soltar()
    await segurando
    const [rExt, rBook] = await Promise.all([extensao, resgate])
    await seguradora.end()

    expect(rExt.error?.message ?? '', 'extensão').not.toMatch(/deadlock/i)
    expect(rBook.error?.message ?? '', 'resgate').not.toMatch(/deadlock/i)
    expect(rExt.error).toBeNull()
    expect(rBook.error).toBeNull()

    // resultado correto: a extensão empurrou a validade (par −1/+1, saldo
    // inalterado) e o resgate consumiu UM crédito criando a aula.
    const [saldo] = await sql<{ n: number }[]>`
      select public.makeup_balance(${c.contractId})::int as n`
    expect(Number(saldo.n), 'dois créditos, um gasto no resgate').toBe(1)
    const [{ n: estendidos }] = await sql<{ n: number }[]>`
      select count(*)::int as n from makeup_ledger
       where contract_id = ${c.contractId} and delta = 1 and expires_on = ${daysFromToday(90)}`
    expect(Number(estendidos)).toBe(1)
    const [aula] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances
       where contract_id = ${c.contractId} and starts_at_utc = ${quando.toISO()}`
    expect(Number(aula.n)).toBe(1)
  })

  it('a ordem está escrita no corpo vivo da função (linha, depois advisory)', async () => {
    const [f] = await sql<{ src: string }[]>`
      select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'book_computed_slot'`
    // O c8 (revisão nº 9) generalizou a ordem: a linha do contrato passou a ser
    // travada nos DOIS caminhos (remarcação e resgate), por isso o alvo do lock
    // virou `v_contract_id`. A invariante medida aqui é a mesma de sempre —
    // linha de contrato ANTES do advisory do gasto.
    const linha = f.src.indexOf('from contracts where id = v_contract_id for update')
    const advisory = f.src.indexOf("makeup_spend:' || p_contract")
    expect(linha, 'o for update do contrato existe').toBeGreaterThan(-1)
    expect(advisory).toBeGreaterThan(-1)
    expect(linha, 'contrato FOR UPDATE vem ANTES do advisory').toBeLessThan(advisory)
  })
})

/* ========================================================================== */
/* P3 — "agendados" segue a cadeia de remarcação                               */
/* ========================================================================== */

describe('P3 · crédito reservado numa reposição REMARCADA continua reservado', () => {
  it('conta pela cadeia de reschedule_of — e some quando a aula é cancelada', async () => {
    // franquia ZERO: a remarcação consome crédito (é o caso que importa aqui)
    const c = await createPrivateContract(sql, { allowance: 0 })
    await sql`
      insert into makeup_ledger (contract_id, student_id, delta, reason, expires_on, duration_min)
      values (${c.contractId}, ${c.studentId}, 1, 'manual_adjust', ${daysFromToday(120)}, 45)`

    const [inst] = await sql`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${c.contractId}, ${c.teacherId},
              now() + interval '8 days', now() + interval '8 days 45 minutes',
              'fixture P3')
      returning id`

    // REMARCAÇÃO DE VERDADE — a porta que o app usa (`book_computed_slot` com a
    // aula), não lançamento fabricado: é ela que põe o débito na aula ORIGINAL
    // e cria a nova apontando para trás por `reschedule_of`.
    const destino1 = DateTime.utc().plus({ days: 10 }).startOf('hour')
    await abrirJanela(c.teacherId, destino1)
    const r1 = await admin.rpc('book_computed_slot', {
      p_teacher: c.teacherId,
      p_starts_at_utc: destino1.toISO(),
      p_instance: inst.id as string,
    })
    expect(r1.error).toBeNull()
    const nova1 = r1.data as string

    // o débito ficou preso à ORIGINAL, que agora está 'rescheduled'
    const [orig] = await sql<{ state: string }[]>`
      select state::text from class_instances where id = ${inst.id as string}`
    expect(orig.state).toBe('rescheduled')
    const [lanc] = await sql<{ class_instance_id: string }[]>`
      select class_instance_id from makeup_ledger
       where contract_id = ${c.contractId} and delta = -1`
    expect(lanc.class_instance_id).toBe(inst.id as string)

    const r = await contarCreditosReservados(admin, [c.contractId])
    expect(r.error).toBeNull()
    expect(r.data, 'a reposição existe e vai acontecer — o crédito segue reservado').toBe(1)

    // Remarcar A REMARCADA encadeia mais um degrau, e a conta tem de chegar na
    // ponta. A franquia sobe antes desta segunda remarcação de propósito: assim
    // ela NÃO gasta um segundo crédito, e o número continua medindo a cadeia (um
    // crédito só, três instâncias) em vez de somar dois débitos.
    await sql`update contracts set monthly_reschedule_allowance = 5 where id = ${c.contractId}`
    const destino2 = DateTime.utc().plus({ days: 13 }).startOf('hour')
    await abrirJanela(c.teacherId, destino2)
    const r2 = await admin.rpc('book_computed_slot', {
      p_teacher: c.teacherId,
      p_starts_at_utc: destino2.toISO(),
      p_instance: nova1,
    })
    expect(r2.error).toBeNull()
    expect((await contarCreditosReservados(admin, [c.contractId])).data).toBe(1)

    // e some quando a ponta deixa de ser aula que vai acontecer
    await sql`update class_instances set state = 'cancelled' where id = ${r2.data as string}`
    expect((await contarCreditosReservados(admin, [c.contractId])).data).toBe(0)
  })

  it('a conta é do banco, e a leitura da ficha não recebe mais relógio por fora', () => {
    const consultas = codigo('src/data/admin/ficha-consultas.ts')
    expect(consultas).toContain("supabase.rpc('admin_reserved_credits'")
    expect(consultas).not.toContain("eq('class_instances.state', 'scheduled')")
    const ficha = codigo('src/data/admin/ficha.ts')
    expect(ficha).toContain('contarCreditosReservados(supabase, ids)')
  })

  it('a RPC é da administração', async () => {
    const prof = await clientAs(teacherUser, 'teacher')
    const { error } = await prof.rpc('admin_reserved_credits', { p_contract_ids: [] })
    expect(error?.message).toMatch(/administração/)
  })
})

/* ========================================================================== */
/* P4 — corrida contrato × membro de turma                                     */
/* ========================================================================== */

describe('P4 · turma: contrato e membro nascendo ao mesmo tempo', () => {
  /** As duas transações abrem juntas; a porta comum é o advisory lock do GRUPO. */
  async function corrida(ordem: 'contrato-primeiro' | 'membro-primeiro') {
    const teacher = await createTeacher(sql)
    const jaNaTurma = await criarLead(`Lead na turma (${ordem})`)
    const queEntra = await criarLead(`Lead que entra (${ordem})`)
    const [g] = await sql`insert into student_groups (label) values (${'Turma ' + ordem}) returning id`
    await sql`insert into student_group_members (group_id, student_id)
              values (${g.id}, ${jaNaTurma})`

    const c1 = connect(1)
    const c2 = connect(1)
    let liberar: () => void = () => {}
    const largada = new Promise<void>((r) => (liberar = r))

    const doContrato = c1.begin(async (tx) => {
      await largada
      await tx`
        insert into contracts
          (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
           monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
        values ('private_1on1', ${g.id}, ${teacher}, 'turma da corrida', 15000, 2, 24, 90,
                public.business_today() - 40)`
    })
    const doMembro = c2.begin(async (tx) => {
      await largada
      await tx`insert into student_group_members (group_id, student_id)
               values (${g.id}, ${queEntra})`
    })

    // pequena defasagem para a ordem pedida ser a ordem real da fila
    if (ordem === 'contrato-primeiro') {
      liberar()
      await espera(150)
    } else {
      liberar()
      await espera(150)
    }
    await Promise.all([doContrato, doMembro])
    await Promise.all([c1.end(), c2.end()])

    return { jaNaTurma, queEntra }
  }

  it('ninguém fica lead com contrato de turma vivo (contrato primeiro)', async () => {
    const { jaNaTurma, queEntra } = await corrida('contrato-primeiro')
    expect(await statusDe(jaNaTurma)).toBe('active')
    expect(await statusDe(queEntra), 'o membro que entrou na corrida').toBe('active')
  })

  it('ninguém fica lead com contrato de turma vivo (membro primeiro)', async () => {
    const { jaNaTurma, queEntra } = await corrida('membro-primeiro')
    expect(await statusDe(jaNaTurma)).toBe('active')
    expect(await statusDe(queEntra)).toBe('active')
  })

  it('os DOIS gatilhos pegam a mesma porta antes de consultar a outra tabela', async () => {
    const fontes = await sql<{ proname: string; src: string }[]>`
      select p.proname, p.prosrc as src
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('promote_lead_on_contract', 'promote_lead_on_group_member')`
    expect(fontes.length).toBe(2)
    for (const f of fontes) {
      expect(f.src, f.proname).toContain("pg_advisory_xact_lock")
      expect(f.src, f.proname).toContain("'student_group:'")
    }
    const doMembro = fontes.find((f) => f.proname === 'promote_lead_on_group_member')!
    expect(
      doMembro.src.indexOf('student_group:'),
      'o lock vem ANTES da consulta a contracts',
    ).toBeLessThan(doMembro.src.indexOf('from contracts c'))
  })
})

/* ========================================================================== */
/* P5 — quem volta sai do arquivo morto; quem foi anonimizado, não             */
/* ========================================================================== */

describe('P5 · lead perdido que volta', () => {
  it('contrato novo REATIVA o cadastro arquivado, com auditoria própria', async () => {
    const lead = await criarLead('Lead que sumiu e voltou')
    await admin.rpc('admin_lose_lead', { p_student: lead, p_reason: 'achou caro' })
    expect(await statusDe(lead)).toBe('archived')

    const teacher = await createTeacher(sql)
    await contratoPara(lead, teacher, 'volta')

    expect(await statusDe(lead)).toBe('active')
    const audit = await sql<{ action: string; diff: Record<string, unknown> }[]>`
      select action, diff from audit_log
       where entity = 'students' and entity_id = ${lead}
         and action in ('lead_promoted', 'lead_reactivated')`
    expect(audit.map((a) => a.action)).toEqual(['lead_reactivated'])
    expect(audit[0].diff).toMatchObject({ old: 'archived', new: 'active', via: 'contract' })
  })

  it('ficha ANONIMIZADA nunca volta: o contrato é recusado com erro claro', async () => {
    const studentId = await createStudent(sql)
    const [nome] = await sql<{ display_name: string }[]>`
      select display_name from students where id = ${studentId}`
    const anon = await admin.rpc('admin_anonymize_student', {
      p_student: studentId,
      p_confirm: nome.display_name,
    })
    expect(anon.error).toBeNull()

    const [depois] = await sql<{ status: string; anonymized_at: Date | null }[]>`
      select status, anonymized_at from students where id = ${studentId}`
    expect(depois.status).toBe('archived')
    expect(depois.anonymized_at, 'o carimbo durável do P5').not.toBeNull()

    const teacher = await createTeacher(sql)
    await expect(contratoPara(studentId, teacher, 'ressurreição')).rejects.toThrow(
      /anonimizada|cadastre a pessoa de novo/i,
    )
    expect(await statusDe(studentId), 'segue arquivada').toBe('archived')
  })
})

/* ========================================================================== */
/* P6 — fuso provisório não vira definitivo                                    */
/* ========================================================================== */

describe('P6 · o fuso do cadastro mínimo é palpite até alguém confirmar', () => {
  async function leadSemCidade(nome: string): Promise<string> {
    const { data, error } = await admin.rpc('admin_create_lead', { p_name: nome })
    expect(error).toBeNull()
    return data as string
  }

  it('lead sem cidade nasce com o fuso do negócio E marcado a confirmar', async () => {
    const id = await leadSemCidade('Lead sem cidade P6')
    const [row] = await sql<{ iana_tz: string; tz_confirmed: boolean }[]>`
      select iana_tz, tz_confirmed from students where id = ${id}`
    expect(row.iana_tz).toBe('America/Cuiaba')
    expect(row.tz_confirmed).toBe(false)
  })

  it('lead COM cidade nasce confirmado (o CityPicker manda os três juntos)', async () => {
    const id = await criarLead('Lead com cidade P6', 'Europe/Lisbon', 'Lisboa')
    const [row] = await sql<{ tz_confirmed: boolean }[]>`
      select tz_confirmed from students where id = ${id}`
    expect(row.tz_confirmed).toBe(true)
  })

  it('contrato de verdade é RECUSADO enquanto o fuso for palpite', async () => {
    const id = await leadSemCidade('Lead que quase fechou')
    const teacher = await createTeacher(sql)
    await expect(contratoPara(id, teacher, 'sem fuso')).rejects.toThrow(/fuso de .* palpite/i)
    expect(await statusDe(id), 'e nada foi promovido').toBe('lead')
  })

  it('a aula EXPERIMENTAL continua passando (é onde a cidade costuma aparecer)', async () => {
    const id = await leadSemCidade('Lead da experimental P6')
    const teacher = await createTeacher(sql)
    const [row] = await sql`
      insert into contracts
        (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days,
         started_on, is_trial)
      values ('private_1on1', ${id}, ${teacher}, 'Aula experimental', 0, 0, 24, 90,
              public.business_today() - 1, true)
      returning id`
    expect(row.id).toBeTruthy()
  })

  // SUPERSEDIDO pelo c9 · S3 (revisão nº 10): completar a cidade por `update`
  // de tabela deixou de confirmar — gravar o dado e atestar que ele foi
  // conferido são atos diferentes. Quem confirma é `confirm_student_location`,
  // que grava cidade, país, zona e flag na MESMA transação. O que este caso
  // continua provando é o DESTRAVE: depois da confirmação, o contrato passa.
  it('confirmar a localização destrava o contrato', async () => {
    const id = await leadSemCidade('Lead que completou o cadastro')
    const soCidade = await admin
      .from('students')
      .update({ city: 'Lisboa', country: 'PT', iana_tz: 'Europe/Lisbon' })
      .eq('id', id)
    expect(soCidade.error).toBeNull()
    const [antes] = await sql<{ tz_confirmed: boolean }[]>`
      select tz_confirmed from students where id = ${id}`
    expect(antes.tz_confirmed, 'o `update` cru não confirma nada (c9 · S3)').toBe(false)

    const { error } = await admin.rpc('confirm_student_location', {
      p_student: id, p_city: 'Lisboa', p_country: 'PT', p_iana_tz: 'Europe/Lisbon',
    })
    expect(error).toBeNull()
    const [row] = await sql<{ tz_confirmed: boolean }[]>`
      select tz_confirmed from students where id = ${id}`
    expect(row.tz_confirmed).toBe(true)

    const teacher = await createTeacher(sql)
    const contrato = await contratoPara(id, teacher, 'depois da cidade')
    expect(contrato).toBeTruthy()
    expect(await statusDe(id)).toBe('active')
  })

  it('create_slot também recusa: é ali que o palpite viraria 8 semanas de aula', async () => {
    const id = await leadSemCidade('Lead com horário fixo')
    const teacher = await createTeacher(sql)
    // o contrato entra por baixo do gatilho (fixture direta) para provar que a
    // guarda do horário fixo é INDEPENDENTE da guarda do contrato
    const [c] = await sql`
      insert into contracts
        (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days,
         started_on, is_trial)
      values ('private_1on1', ${id}, ${teacher}, 'contrato por baixo', 15000, 4, 24, 90,
              public.business_today() - 1, true)
      returning id`
    await sql`update contracts set is_trial = false where id = ${c.id}`

    const { error } = await admin.rpc('create_slot', {
      p_contract: c.id as string,
      p_weekday: 2,
      p_local_time: '10:00',
      p_duration_min: 45,
    })
    expect(error?.message).toMatch(/fuso de .* palpite/i)
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from recurring_slots where contract_id = ${c.id as string}`
    expect(Number(n), 'nada de horário fixo criado').toBe(0)
  })

  it('a ficha anuncia o pendente e o CTA leva a completar o cadastro', () => {
    const identidade = codigo('src/components/admin/alunos/ficha/ColunaDeIdentidade.tsx')
    expect(identidade).toContain('ficha.fusoAConfirmar')
    expect(identidade).toContain('fuso a confirmar')
    expect(identidade).toContain('Completar cadastro')
    const dados = codigo('src/data/admin/ficha.ts')
    expect(dados).toContain('fusoAConfirmar')
    expect(dados).toContain('tz_confirmed')
  })
})

/* ========================================================================== */
/* P7 — convite de lead barrado no motor (e no banco)                          */
/* ========================================================================== */

describe('P7 · lead não recebe convite', () => {
  it('provisionStudent recusa ANTES de tocar no Auth', async () => {
    const lead = await criarLead('Lead que quase virou usuário')
    const service = serviceClient()
    const email = `lead-p7-${Date.now()}@exemplo.com`

    const r = await provisionStudent(service, lead, email, adminId)
    expect(r.status).toBe('error')
    expect(r.status === 'error' && r.message).toMatch(/LEAD/)

    // nada nasceu no Auth, e o cadastro segue sem vínculo
    const { data } = await service.auth.admin.listUsers({ page: 1, perPage: 200 })
    expect(data.users.some((u) => u.email === email)).toBe(false)
    const [row] = await sql<{ profile_id: string | null }[]>`
      select profile_id from students where id = ${lead}`
    expect(row.profile_id).toBeNull()
  })

  it('o banco tem o mesmo cinto: vincular profile a um lead é recusado', async () => {
    const lead = await criarLead('Lead do cinto do banco')
    const outro = await createAuthUser(sql, 'student', 'Perfil solto P7')
    await expect(
      sql`update students set profile_id = ${outro} where id = ${lead}`,
    ).rejects.toThrow(/lead não tem portal/i)
  })
})

/* ========================================================================== */
/* P8 — contrato que já nasce encerrado                                        */
/* ========================================================================== */

describe('P8 · import histórico não ressuscita ninguém', () => {
  it('contrato inserido com status ended NÃO promove o lead', async () => {
    const lead = await criarLead('Lead do import histórico')
    const teacher = await createTeacher(sql)
    await sql`
      insert into contracts
        (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days,
         started_on, ended_on, status)
      values ('private_1on1', ${lead}, ${teacher}, 'contrato de 2024', 15000, 4, 24, 90,
              public.business_today() - 400, public.business_today() - 200, 'ended')`
    expect(await statusDe(lead)).toBe('lead')
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity = 'students' and entity_id = ${lead}
         and action in ('lead_promoted', 'lead_reactivated')`
    expect(Number(n)).toBe(0)
  })

  it('e o gatilho de MEMBRO já exigia o mesmo do contrato da turma', async () => {
    const lead = await criarLead('Lead de turma encerrada')
    const teacher = await createTeacher(sql)
    const [g] = await sql`insert into student_groups (label) values ('Turma encerrada') returning id`
    await sql`
      insert into contracts
        (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days,
         started_on, ended_on, status)
      values ('private_1on1', ${g.id}, ${teacher}, 'turma velha', 15000, 2, 24, 90,
              public.business_today() - 400, public.business_today() - 200, 'ended')`
    await sql`insert into student_group_members (group_id, student_id) values (${g.id}, ${lead})`
    expect(await statusDe(lead)).toBe('lead')
  })
})

/* ========================================================================== */
/* P9 — a antecipação lê a agenda MATERIALIZADA                                */
/* ========================================================================== */

describe('P9 · hora ambígua de DST: quem manda é o instante do banco', () => {
  it('a noite de recuo de Lisboa — a expansão em Luxon muda de lado conforme a data em que roda; o banco, não', async () => {
    // O horário fixo é 01:30 de domingo em Lisboa. Na noite de recuo o relógio
    // local REPETE a hora 01:00 (WEST → WET), então "01:30 local" é DOIS
    // instantes. A data é a PRÓXIMA noite de recuo, nunca cravada.
    const recuo = proximoRecuo('Europe/Lisbon')
    const dia = recuo.toISODate()!
    const [row] = await sql<{ t: string }[]>`
      select ((${dia}::date + '01:30'::time) at time zone 'Europe/Lisbon')::text as t`
    const doBanco = DateTime.fromSQL(row.t, { zone: 'utc' }).toUTC()

    // O Luxon resolve a hora repetida partindo do offset de AGORA (o palpite
    // inicial de `fixOffset`): rodando no verão de Lisboa fica com a primeira
    // passagem; rodando no inverno, com a segunda. Foi por isso que o caso
    // cravado em 25/10/2026 ficou vermelho em 26/10/2026: passado o recuo, o
    // relógio do CI virou inverno e o Luxon passou a concordar com o banco.
    // Se uma atualização do Luxon mudar este comportamento e o caso ficar
    // vermelho, o sinal é revisar o código de produção que converte hora local
    // em UTC com Luxon (ex.: `src/lib/windows.ts`), nunca ajustar o esperado.
    const expansaoRodandoEm = (agora: DateTime): DateTime => {
      const relogio = Settings.now
      Settings.now = () => agora.toMillis()
      try {
        return DateTime.fromISO(`${dia}T01:30`, { zone: 'Europe/Lisbon' }).toUTC()
      } finally {
        Settings.now = relogio
      }
    }
    const meioDia = { hour: 12, minute: 0 }
    const doLuxon = expansaoRodandoEm(recuo.minus({ days: 1 }).set(meioDia)) // véspera, WEST
    const doLuxonNoInverno = expansaoRodandoEm(recuo.plus({ days: 1 }).set(meioDia)) // dia seguinte, WET

    // é este o buraco que o P9 fecha: no verão a expansão em Luxon escolhia o
    // OUTRO lado…
    expect(doBanco.toISO()).not.toBe(doLuxon.toISO())
    expect(doBanco.diff(doLuxon, 'hours').hours).toBe(1)
    // …e no inverno escolhe o mesmo: a resposta da expansão depende do dia em
    // que o código roda, a do banco não (fica sempre com a segunda passagem).
    expect(doLuxonNoInverno.toISO()).toBe(doBanco.toISO())
    expect(doBanco.setZone('Europe/Lisbon').toFormat('yyyy-LL-dd HH:mm')).toBe(`${dia} 01:30`)
    expect(doLuxon.setZone('Europe/Lisbon').toFormat('yyyy-LL-dd HH:mm')).toBe(`${dia} 01:30`)

    // a antecipação, agora, fala do instante que a agenda TEM
    const janelas = janelasDoHorarioFixo(
      [
        {
          teacher_id: 'dona',
          contract_id: 'c1',
          slot_id: 's1',
          starts_at_utc: doBanco.toISO()!,
          ends_at_utc: doBanco.plus({ minutes: 45 }).toISO()!,
        },
      ],
      'America/Cuiaba',
      'Joana',
    )
    const noRelogioDoAluno = doBanco.setZone('America/Cuiaba')
    expect(janelas[0].inicio).toBe(noRelogioDoAluno.hour * 60 + noRelogioDoAluno.minute)
    // e NÃO do que a expansão diria (uma hora antes, 20:30 em vez de 21:30)
    const pelaExpansao = doLuxon.setZone('America/Cuiaba')
    expect(janelas[0].inicio).not.toBe(pelaExpansao.hour * 60 + pelaExpansao.minute)
  })

  it('o mesmo horário fixo em horas locais diferentes vira FAIXA, com a nota', () => {
    // quarta 11:00 de Nova York, antes e depois de 01/11/2026 (volta ao EST)
    const antes = DateTime.fromISO('2026-10-28T11:00', { zone: 'America/New_York' })
    const depois = DateTime.fromISO('2026-11-04T11:00', { zone: 'America/New_York' })
    const aula = (d: DateTime): AulaMaterializada => ({
      teacher_id: 'dona',
      contract_id: 'c1',
      slot_id: 's1',
      starts_at_utc: d.toUTC().toISO()!,
      ends_at_utc: d.plus({ minutes: 45 }).toUTC().toISO()!,
    })

    const j = janelasDoHorarioFixo([aula(antes), aula(depois)], 'America/Cuiaba', 'Bianca')
    const inicios = [...new Set(j.map((x) => x.inicio))].sort((a, b) => a - b)
    expect(inicios).toEqual([11 * 60, 12 * 60])
    expect(j[0].texto).toBe('11:00–11:45 ou 12:00–12:45 (muda com o horário de verão)')
    expect(j.every((x) => x.weekday === 3)).toBe(true)
  })

  it('sem variação, UMA faixa só e nenhuma nota inventada', () => {
    const d = DateTime.fromISO('2026-08-05T16:45', { zone: 'America/Cuiaba' })
    const j = janelasDoHorarioFixo(
      [
        {
          teacher_id: 'dona',
          contract_id: 'c1',
          slot_id: 's1',
          starts_at_utc: d.toUTC().toISO()!,
          ends_at_utc: d.plus({ minutes: 45 }).toUTC().toISO()!,
        },
      ],
      'America/Cuiaba',
      'Gabriel',
    )
    expect(j).toHaveLength(1)
    expect(j[0].texto).toBe('16:45–17:30')
  })

  it('janelasDaAgenda separa horário fixo (agrupado) de avulsa (com data)', () => {
    const base = DateTime.fromISO('2026-08-05T09:00', { zone: 'America/Cuiaba' })
    const j = janelasDaAgenda(
      [
        {
          teacher_id: 'dona',
          contract_id: 'c1',
          slot_id: 's1',
          starts_at_utc: base.toUTC().toISO()!,
          ends_at_utc: base.plus({ minutes: 45 }).toUTC().toISO()!,
        },
        {
          teacher_id: 'dona',
          contract_id: 'c1',
          slot_id: null,
          starts_at_utc: base.plus({ days: 1, hours: 2 }).toUTC().toISO()!,
          ends_at_utc: base.plus({ days: 1, hours: 2, minutes: 45 }).toUTC().toISO()!,
        },
      ],
      'America/Cuiaba',
      () => 'Ana',
    )
    expect(j.filter((x) => x.quem === 'Ana')).toHaveLength(1)
    expect(j.filter((x) => x.quem.includes('aula avulsa em'))).toHaveLength(1)
  })
})

describe('P9 · o horizonte e a vigência vêm do banco', () => {
  it('o materializador cria a ocorrência do limite (hoje + 56) e a leitura a alcança', async () => {
    const c = await createPrivateContract(sql)
    const [alvo] = await sql<{ d: string; dow: number }[]>`
      select (public.business_today() + 56)::text as d,
             extract(dow from (public.business_today() + 56))::int as dow`
    const slot = await createSlot(sql, c, {
      weekday: Number(alvo.dow),
      localTime: '08:15',
      tz: 'America/Cuiaba',
      // vigência a partir do 21º dia: as ocorrências caem em +21, +28 … +56 e
      // nenhuma entra na semana corrente, que os KPIs contam globalmente
      activeFrom: daysFromToday(21),
    })
    const [m] = await sql`select public.materialize_slot(${slot}, 8) as n`
    expect(Number(m.n), 'o horizonte é INCLUSIVO: a ocorrência do dia 56 nasce').toBeGreaterThan(0)
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances
       where slot_id = ${slot} and occurrence_date = ${alvo.d}::date`
    expect(Number(n)).toBe(1)

    const agora = DateTime.now()
    const lidas = await lerAulasDaAgenda(admin, agora, fimDaAntecipacao(agora), [c.contractId])
    const datas = lidas.map((a) => DateTime.fromISO(a.starts_at_utc).setZone('America/Cuiaba').toISODate())
    expect(datas, 'a última ocorrência não pode ser decepada pelo corte').toContain(alvo.d)
  })

  it('o corte de EXATAMENTE 8 semanas em UTC decepava a última aula; +1 dia não', async () => {
    const c = await createPrivateContract(sql)
    const agora = DateTime.now()
    // uma hora DEPOIS do corte antigo, dentro do horizonte civil do banco
    const noLimite = agora.plus({ weeks: 8, hours: 1 })
    await sql`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${c.contractId}, ${c.teacherId}, ${noLimite.toUTC().toISO()},
              ${noLimite.plus({ minutes: 45 }).toUTC().toISO()}, 'fixture P9 limite')`

    const peloCorteVelho = await lerAulasDaAgenda(
      admin, agora, agora.plus({ weeks: 8 }), [c.contractId])
    expect(peloCorteVelho, 'o corte antigo perdia esta aula').toHaveLength(0)
    const pelaMargem = await lerAulasDaAgenda(admin, agora, fimDaAntecipacao(agora), [c.contractId])
    expect(pelaMargem).toHaveLength(1)
  })

  it('vigência: horário fechado para de ocupar, e o que só começa depois não ocupa antes', async () => {
    const c = await createPrivateContract(sql)
    // A: vigente do 21º ao 35º dia · B: começa no 36º · C: só daqui a 90 dias.
    // Tudo fora da semana corrente: ela é contada globalmente pelos KPIs e a
    // suíte roda arquivos em paralelo.
    const a = await createSlot(sql, c, {
      weekday: 2, localTime: '07:00', tz: 'America/Cuiaba', activeFrom: daysFromToday(21),
    })
    await sql`update recurring_slots set active_to = ${daysFromToday(35)}::date where id = ${a}`
    const b = await createSlot(sql, c, {
      weekday: 2, localTime: '09:00', tz: 'America/Cuiaba', activeFrom: daysFromToday(36),
    })
    const cSlot = await createSlot(sql, c, {
      weekday: 4, localTime: '11:00', tz: 'America/Cuiaba', activeFrom: daysFromToday(90),
    })
    for (const s of [a, b, cSlot]) await sql`select public.materialize_slot(${s}, 8)`

    const agora = DateTime.now()
    const lidas = await lerAulasDaAgenda(admin, agora, fimDaAntecipacao(agora), [c.contractId])
    const dataDe = (x: AulaMaterializada) =>
      DateTime.fromISO(x.starts_at_utc).setZone('America/Cuiaba').toISODate()!

    const daA = lidas.filter((x) => x.slot_id === a)
    const daB = lidas.filter((x) => x.slot_id === b)
    const daC = lidas.filter((x) => x.slot_id === cSlot)
    expect(daA.length, 'o horário que fecha ainda tem aulas até fechar').toBeGreaterThan(0)
    expect(daA.every((x) => dataDe(x) <= daysFromToday(35))).toBe(true)
    expect(daB.length, 'o horário novo já tem aulas dentro do horizonte').toBeGreaterThan(0)
    expect(daB.every((x) => dataDe(x) >= daysFromToday(36))).toBe(true)
    expect(daC, 'horário que só começa fora do horizonte não ocupa nada').toHaveLength(0)

    // e nas janelas do aluno: 07:00 e 09:00 aparecem, 11:00 não
    const janelas = janelasDaAgenda(lidas, 'America/Cuiaba', () => 'Aluna da vigência')
    const inicios = new Set(janelas.map((x) => x.inicio))
    expect(inicios.has(7 * 60)).toBe(true)
    expect(inicios.has(9 * 60)).toBe(true)
    expect(inicios.has(11 * 60)).toBe(false)
  })
})

/* ========================================================================== */
/* P10 — o funil tem chave própria                                             */
/* ========================================================================== */

describe('P10 · `?situacao=` é o ciclo de vida; `?f=` voltou a ser ACESSO', () => {
  it('o hub lê o recorte de `situacao` e encaminha os dois `?f=` antigos', () => {
    const page = codigo('src/app/admin/alunos/page.tsx')
    expect(page).toContain('ehSituacao(sp.situacao)')
    expect(page).toContain("if (ehAcesso(sp.f)) redirect(`/admin/alunos/convites?f=${sp.f}`)")
    expect(page).toContain("if (ehSituacao(sp.f)) redirect(`/admin/alunos?situacao=${sp.f}`)")
    // a leitura ambígua morreu: `?f=` nesta rota não decide mais situação
    expect(page).not.toContain('ehSituacao(sp.f) ? sp.f : null')
  })

  it('a fileira de badges e a action do lead escrevem a chave nova', () => {
    const filtro = codigo('src/components/admin/alunos/FiltroDeSituacao.tsx')
    expect(filtro).toContain('?situacao=${i.valor}')
    expect(filtro).not.toContain('?f=${i.valor}')
    const actions = codigo('src/app/admin/alunos/actions.ts')
    expect(actions).toContain('/admin/alunos?situacao=lead')
    expect(actions).not.toContain('/admin/alunos?f=lead')
  })

  it('a aba Convites continua com o `?f=` dela, intocada', () => {
    const convites = codigo('src/app/admin/alunos/convites/page.tsx')
    expect(convites).toContain('/admin/alunos/convites?f=')
  })
})

/* ========================================================================== */
/* F1 — o par da pílula `ok` passa AA de verdade                               */
/* ========================================================================== */

describe('F1 · contraste do tom `ok`', () => {
  const CSS = corpo('src/app/globals.css')

  function token(nome: string): string {
    const m = CSS.match(new RegExp(`${nome}:\\s*(#[0-9a-fA-F]{6})`))
    if (!m) throw new Error(`token ${nome} não encontrado no globals.css`)
    return m[1].toLowerCase()
  }
  function luminancia(hex: string): number {
    const c = hex.replace('#', '')
    const v = [0, 2, 4]
      .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
  }
  function contraste(a: string, b: string): number {
    const x = luminancia(a)
    const y = luminancia(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }

  it('texto sobre a própria lavagem passa AA — e a lavagem é HEX, não alpha', () => {
    const fg = token('--ok-700')
    const bg = token('--ok-wash')
    expect(contraste(fg, bg)).toBeGreaterThanOrEqual(4.5)
    // A pílula usa a lavagem achatada nos DOIS kits. Com alpha
    // (`bg-ok-700/10`) o contraste real dependia da superfície de baixo — era
    // 4,43:1 sobre cartão branco e pior ainda sobre o fundo de página.
    for (const arquivo of ['src/components/kit/pill.tsx', 'src/components/ui.tsx']) {
      const fonte = codigo(arquivo)
      expect(fonte, arquivo).toContain('bg-ok-wash font-semibold text-ok-700')
      expect(fonte, arquivo).not.toContain('bg-ok-700/10')
    }
    expect(CSS).toContain('--color-ok-wash: var(--ok-wash)')
  })

  it('o verde passa AA sobre as três superfícies de papel', () => {
    const fg = token('--ok-700')
    for (const papel of ['--paper-0', '--paper-50', '--paper-100']) {
      expect(contraste(fg, token(papel)), `ok sobre ${papel}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('a badge "ativo" do ciclo de vida herda a MESMA lavagem (uma verdade só)', () => {
    expect(CSS).toContain('--situacao-ativo-bg: var(--ok-wash)')
    expect(CSS).toContain('--situacao-ativo-fg: var(--ok-700)')
    expect(contraste(token('--ok-700'), token('--ok-wash'))).toBeGreaterThanOrEqual(4.5)
  })
})
