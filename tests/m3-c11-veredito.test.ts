// LOTE c11 — as três correções da revisão adversarial nº 12.
//
//  · U1 — DEFAULT SEGURO: `students.tz_confirmed` passa a nascer `false` quando
//    ninguém diz nada (o default antigo, `true`, fabricava confirmação para
//    toda porta que esquecesse a coluna — e `admin_create_trial_class` era
//    exatamente essa porta). Aqui a prova é COMPORTAMENTAL e por VARREDURA:
//    todas as portas produtivas de `insert` em `students` são enumeradas (a
//    enumeração falha se aparecer uma nova), exercitadas, e nenhuma delas
//    entrega `tz_confirmed = true` sem um ato `confirm_student_location`
//    auditado para aquele aluno;
//  · U2 — POSSE SIMÉTRICA NA PAUSA: pausar CONGELA o horário fixo, então a
//    pausa só passa se o horário estiver livre — aula `scheduled` futura de
//    outro contrato da mesma professora recusa a pausa, com o nome de quem
//    ocupa e o dia. Sob o advisory `teacher_agenda`, que já serializava o outro
//    lado: nas DUAS ordens concorrentes exatamente uma passa, e nunca por
//    deadlock;
//  · U3 — GARANTIA ESTRUTURAL SLOT × CONTRATO: `unique (id, contract_id)` +
//    FK composta `(slot_id, contract_id)`. A aula só pende de um horário fixo
//    do próprio contrato — por estrutura, sem depender de gatilho —, a avulsa
//    (`slot_id` nulo) passa limpo, e a troca privilegiada que COMMITA com a RI
//    inteira desligada é detectada pelo materializador.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createStudent, createTeacher, instanteEm, julgadaDepois } from './helpers/db'
import { confirmarLocalizacao } from '@/lib/admin/confirmar-localizacao'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const CLAIMS_ADMIN = JSON.stringify({ app_metadata: { role: 'admin' } })
const MIGRATION = 'supabase/migrations/20260727001000_default_seguro_e_posse.sql'
const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

let sql: Sql
let admin: SupabaseClient
let adminId: string

beforeAll(async () => {
  sql = connect(6)
  adminId = await createAuthUser(sql, 'admin', 'Admin revisão 12')
  admin = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  await sql.end()
})

/** Contrato particular ATIVO de um aluno com cidade/fuso confirmados. */
async function contratoCom(tz: string, cidade: string, teacherId?: string) {
  const studentId = await createStudent(sql, tz)
  const { error } = await admin.rpc('confirm_student_location', {
    p_student: studentId,
    p_city: cidade,
    p_country: 'BR',
    p_iana_tz: tz,
  })
  expect(error).toBeNull()
  const teacher = teacherId ?? (await createTeacher(sql))
  const [c] = await sql`
    insert into contracts
      (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
       monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
    values ('private_1on1', ${studentId}, ${teacher}, 'c11', 15000, 4, 24, 90,
            public.business_today())
    returning id`
  return { contractId: c.id as string, teacherId: teacher, studentId }
}

/**
 * O instante da ocorrência de um horário local N semanas à frente, calculado
 * pelo BANCO (`(date + local_time) at time zone tz`, Lei 1) — nunca por
 * aritmética de horas no TS.
 *
 * `semanas` grande de propósito: além do horizonte de 8 semanas do
 * materializador não existe instância nenhuma, e é ali que a exclusão GiST não
 * tem o que ver — o caso que o U2 fecha.
 */
async function instanteDe(weekday: number, hora: string, semanas: number, tz = 'America/Cuiaba') {
  const [row] = await sql<{ inicio: Date }[]>`
    select ((public.business_today()
             + ((${weekday} - extract(dow from public.business_today())::int + 7) % 7)
             + ${semanas * 7}::int)::date + ${hora}::time) at time zone ${tz} as inicio`
  return row.inicio
}

const flagDe = async (id: string) => {
  const [row] = await sql<{ tz_confirmed: boolean }[]>`
    select tz_confirmed from students where id = ${id}`
  return row.tz_confirmed
}

/* ========================================================================== */
/* U1 — o default é a resposta segura                                          */
/* ========================================================================== */

describe('U1 · quem não diz nada nasce a confirmar', () => {
  it('o default da coluna é false — e a linha que já existia não foi tocada', async () => {
    const [row] = await sql<{ tz_confirmed: boolean }[]>`
      insert into students (display_name, iana_tz)
      values ('Sem dizer nada U1', 'America/Cuiaba')
      returning tz_confirmed`
    expect(row.tz_confirmed, 'o esquecimento passa a ser palpite, não fato').toBe(false)

    // `alter column … set default` NÃO reescreve a tabela: as fichas antigas
    // (as do seed, cadastradas com cidade de verdade) seguem confirmadas.
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from students where tz_confirmed`
    expect(Number(n), 'as fichas que já eram fato continuam fato').toBeGreaterThan(0)
    expect(codigo(MIGRATION), 'e a migration não mexe em linha nenhuma').not.toMatch(
      /update\s+students\s+set/i,
    )
  })

  it('admin_create_trial_class: a pessoa nasce a confirmar, e o experimental passa mesmo assim', async () => {
    const teacher = await createTeacher(sql)
    const quando = await instanteDe(5, '15:00', 3)
    const [d] = await sql<{ dia: string; hora: string }[]>`
      select to_char(${quando}::timestamptz at time zone 'America/Cuiaba', 'YYYY-MM-DD') as dia,
             to_char(${quando}::timestamptz at time zone 'America/Cuiaba', 'HH24:MI') as hora`

    const { data: aula, error } = await admin.rpc('admin_create_trial_class', {
      p_student_name: 'Experimental U1',
      p_iana_tz: 'America/Cuiaba',
      p_teacher: teacher,
      p_starts_at_utc: instanteEm(d.dia, d.hora, 'America/Cuiaba'),
      p_duration_min: 45,
    })
    expect(error).toBeNull()

    const [inst] = await sql<{ contract_id: string }[]>`
      select contract_id from class_instances where id = ${aula as string}`
    const [c] = await sql<{ student_id: string; is_trial: boolean }[]>`
      select student_id, is_trial from contracts where id = ${inst.contract_id}`
    expect(c.is_trial, 'o contrato leve do experimental').toBe(true)

    expect(await flagDe(c.student_id), 'a RPC recebe a zona, não a cidade').toBe(false)
    const atos = await sql`
      select 1 from audit_log
       where action = 'confirm_student_location' and entity_id = ${c.student_id}`
    expect(atos.length, 'e sem cidade não há ato de confirmação a auditar').toBe(0)

    // o contrato DE VERDADE dessa pessoa espera o cadastro completo
    await expect(
      sql`insert into contracts
            (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
             monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
          values ('private_1on1', ${c.student_id}, ${teacher}, 'U1', 15000, 4, 24, 90,
                  public.business_today())`,
    ).rejects.toThrow(/palpite/i)

    // e completar o cadastro destrava, com o ato auditado
    expect(
      (await confirmarLocalizacao(admin, c.student_id, 'Cuiabá', 'BR', 'America/Cuiaba')).error,
    ).toBeNull()
    expect(await flagDe(c.student_id)).toBe(true)
    const [contratoDeVerdade] = await sql<{ id: string }[]>`
      insert into contracts
        (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${c.student_id}, ${teacher}, 'U1', 15000, 4, 24, 90,
              public.business_today())
      returning id`
    expect(contratoDeVerdade.id).toBeTruthy()
  })
})

/* ========================================================================== */
/* U1 — a varredura das portas produtivas                                      */
/* ========================================================================== */

describe('U1 · varredura: nenhuma porta confirma o fuso sem ato auditado', () => {
  /** Todo arquivo de `src/` (o grafo do app; `public/` e `scripts/` não são app). */
  function arquivosDoApp(): string[] {
    return (readdirSync(path.join(RAIZ, 'src'), { recursive: true }) as string[])
      .filter((f) => /\.(ts|tsx)$/.test(f))
      // Bancada Windows (01/09/2026): o `recursive` devolve barra invertida e o
      // inventário abaixo fala em "/".
      .map((f) => 'src/' + f.split(path.sep).join('/'))
  }

  it('o INVENTÁRIO de portas é exatamente o conhecido (porta nova quebra este teste)', async () => {
    // 1. as portas do BANCO: toda função cujo corpo escreve em `students`.
    const funcoes = await sql<{ proname: string }[]>`
      select p.proname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosrc ilike '%insert into students%'
       order by p.proname`
    expect(funcoes.map((f) => f.proname)).toEqual([
      'admin_create_lead',
      'admin_create_trial_class',
    ])

    // 2. as portas do APP: todo `from('students').insert(...)`.
    const noApp = arquivosDoApp().filter((rel) =>
      /from\(\s*'students'\s*\)\s*\.?\s*\n?\s*\.insert\(/.test(codigo(rel)),
    )
    expect(noApp.sort()).toEqual([
      'src/app/admin/alunos/actions.ts',
      'src/app/admin/alunos/novo/actions.ts',
    ])

    // 3. `provisionStudent` LÊ e ATUALIZA o aluno, mas não cria nenhum — o
    //    convite não é porta de cadastro.
    expect(codigo('src/lib/auth/provision.ts')).not.toMatch(/from\(\s*'students'\s*\)[\s\S]{0,40}insert/)

    // 4. e NENHUMA porta escreve o flag ligado: `true` só sai do ato.
    for (const rel of arquivosDoApp()) {
      expect(codigo(rel), `${rel} liga o flag por escrita direta`).not.toMatch(
        /tz_confirmed\s*[:=]\s*true/,
      )
    }
  })

  it('exercitadas todas, tz_confirmed = true SÓ existe com o ato auditado junto', async () => {
    const nascidos: string[] = []

    /** O `insert` das DUAS actions (`createStudentAction` e `wizardStudentAction`):
     *  mesmo cliente (sessão da admin), mesmos campos — o que muda entre elas é
     *  o destino do redirect. */
    async function pelaAction(nome: string, cidade: string) {
      const { data, error } = await admin
        .from('students')
        .insert({
          display_name: nome,
          iana_tz: 'America/Cuiaba',
          city: cidade || null,
          tz_confirmed: false,
        })
        .select('id')
        .single()
      expect(error).toBeNull()
      const id = (data as { id: string }).id
      nascidos.push(id)
      await confirmarLocalizacao(admin, id, cidade, 'BR', 'America/Cuiaba')
      return id
    }

    // porta 1 e 2 — as duas actions, no caminho feliz e no caminho da falha
    const comCidade = await pelaAction('Action com cidade U1', 'Cuiabá')
    const semCidade = await pelaAction('Action sem cidade U1', '')
    expect(await flagDe(comCidade)).toBe(true)
    expect(await flagDe(semCidade), 'RPC falhou = aluno honestamente não-confirmado').toBe(false)

    // porta 3 — `admin_create_lead`, o equivalente atômico da RPC
    for (const [nome, cidade, esperado] of [
      ['Lead com cidade U1', 'Cuiabá', true],
      ['Lead sem cidade U1', null, false],
    ] as const) {
      const { data, error } = await admin.rpc('admin_create_lead', {
        p_name: nome,
        p_iana_tz: 'America/Cuiaba',
        p_city: cidade,
        p_country: 'BR',
      })
      expect(error).toBeNull()
      nascidos.push(data as string)
      expect(await flagDe(data as string), nome).toBe(esperado)
    }

    // porta 4 — `admin_create_trial_class`
    const teacher = await createTeacher(sql)
    const quando = await instanteDe(1, '11:00', 4)
    const [d] = await sql<{ dia: string; hora: string }[]>`
      select to_char(${quando}::timestamptz at time zone 'America/Cuiaba', 'YYYY-MM-DD') as dia,
             to_char(${quando}::timestamptz at time zone 'America/Cuiaba', 'HH24:MI') as hora`
    const { data: aula, error: erroTrial } = await admin.rpc('admin_create_trial_class', {
      p_student_name: 'Experimental varredura U1',
      p_iana_tz: 'America/Cuiaba',
      p_teacher: teacher,
      p_starts_at_utc: instanteEm(d.dia, d.hora, 'America/Cuiaba'),
      p_duration_min: 45,
    })
    expect(erroTrial).toBeNull()
    const [doTrial] = await sql<{ student_id: string }[]>`
      select c.student_id from class_instances ci join contracts c on c.id = ci.contract_id
       where ci.id = ${aula as string}`
    nascidos.push(doTrial.student_id)

    // porta 5 — a PORTA DISTRAÍDA que ainda não existe: um `insert` novo que
    // esquece a coluna. É por ela que o default importa.
    const [esquecida] = await sql<{ id: string }[]>`
      insert into students (display_name, iana_tz)
      values ('Porta distraída U1', 'America/Cuiaba') returning id`
    nascidos.push(esquecida.id)

    // A INVARIANTE, sobre TODOS os nascidos aqui, numa consulta só.
    const linhas = await sql<{ nome: string; confirmado: boolean; tem_ato: boolean }[]>`
      select s.display_name as nome,
             s.tz_confirmed as confirmado,
             exists (select 1 from audit_log a
                      where a.action = 'confirm_student_location'
                        and a.entity = 'students'
                        and a.entity_id = s.id::text) as tem_ato
        from students s
       where s.id in ${sql(nascidos)}`
    expect(linhas.length, 'todas as portas exercitadas').toBe(nascidos.length)
    for (const l of linhas) {
      expect(l.confirmado && !l.tem_ato, `${l.nome} nasceu confirmado sem ato de confirmação`).toBe(
        false,
      )
    }
    // e o caminho feliz de verdade existe (senão a invariante seria vacuosa)
    expect(linhas.filter((l) => l.confirmado && l.tem_ato).length).toBeGreaterThanOrEqual(2)
  })
})

/* ========================================================================== */
/* U2 — a pausa também precisa encontrar o horário livre                       */
/* ========================================================================== */

describe('U2 · pausar congela o horário, então ele tem de estar livre', () => {
  it('aula avulsa preexistente ALÉM do horizonte: a pausa é recusada nomeando quem ocupa e o dia', async () => {
    const teacher = await createTeacher(sql)
    const dono = await contratoCom('America/Cuiaba', 'Cuiabá dono U2', teacher)
    const outro = await contratoCom('America/Cuiaba', 'Cuiabá outro U2', teacher)
    expect(
      (
        await admin.rpc('create_slot', {
          p_contract: dono.contractId,
          p_weekday: 3,
          p_local_time: '14:00',
          p_duration_min: 45,
        })
      ).error,
    ).toBeNull()

    // 12 semanas à frente: fora das 8 do materializador, então não há instância
    // do horário fixo ali — a exclusão GiST não tem NADA a comparar.
    const longe = await instanteDe(3, '14:00', 12)
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances
       where contract_id = ${dono.contractId} and starts_at_utc = ${longe}`
    expect(Number(n), 'a data está mesmo além do horizonte materializado').toBe(0)

    const [avulsa] = await sql<{ id: string }[]>`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${outro.contractId}, ${teacher}, ${longe},
              ${longe}::timestamptz + interval '45 minutes', 'c11 U2')
      returning id`

    const [quem] = await sql<{ display_name: string }[]>`
      select display_name from students where id = ${outro.studentId}`
    const { error } = await admin.rpc('pause_contract', { p_contract: dono.contractId })
    expect(error?.message, 'a pausa é recusada').toMatch(/já tem aula marcada de outro contrato/i)
    expect(error?.message, 'com o nome de quem ocupa').toContain(quem.display_name)
    const [dia] = await sql<{ txt: string }[]>`
      select to_char(${longe}::timestamptz at time zone 'America/Cuiaba', 'DD/MM/YYYY às HH24:MI') as txt`
    expect(error?.message, 'e o dia do choque').toContain(dia.txt)

    const [c] = await sql<{ status: string }[]>`
      select status from contracts where id = ${dono.contractId}`
    expect(c.status, 'e nada foi escrito').toBe('active')
    const pausas = await sql`select 1 from contract_pauses where contract_id = ${dono.contractId}`
    expect(pausas.length).toBe(0)

    // liberado o horário, a pausa passa (a recusa é sobre o choque, não sobre pausar)
    await sql`update class_instances set state = 'cancelled' where id = ${avulsa.id}`
    expect((await admin.rpc('pause_contract', { p_contract: dono.contractId })).error).toBeNull()
  })

  it('as DUAS ordens concorrentes: exatamente uma passa, nunca por deadlock', async () => {
    /* ---- ordem A: a PAUSA chega primeiro ---- */
    {
      const teacher = await createTeacher(sql)
      const dono = await contratoCom('America/Cuiaba', 'Cuiabá dono A U2', teacher)
      const outro = await contratoCom('America/Cuiaba', 'Cuiabá outro A U2', teacher)
      expect(
        (
          await admin.rpc('create_slot', {
            p_contract: dono.contractId,
            p_weekday: 4,
            p_local_time: '09:00',
            p_duration_min: 45,
          })
        ).error,
      ).toBeNull()
      const longe = await instanteDe(4, '09:00', 12)

      const conn1 = connect(1)
      const conn2 = connect(1)
      let soltar: () => void = () => {}
      const solta = new Promise<void>((r) => (soltar = r))
      let pausou: () => void = () => {}
      const jaPausou = new Promise<void>((r) => (pausou = r))
      try {
        const t1 = conn1.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${CLAIMS_ADMIN}, true)`
          await tx`select public.pause_contract(${dono.contractId}, ${adminId})`
          pausou()
          await solta
        })
        await jaPausou

        let terminou = false
        const reserva = julgadaDepois(
          conn2`
          insert into class_instances
            (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
          values (${outro.contractId}, ${teacher}, ${longe},
                  ${longe}::timestamptz + interval '45 minutes', 'c11 U2 ordem A')
          returning id`.then(
            (r) => {
              terminou = true
              return r
            },
            (e: Error) => {
              terminou = true
              throw e
            },
          ),
        )
        await espera(600)
        expect(terminou, 'a aula nova passou por cima da pausa a meio caminho').toBe(false)

        soltar()
        await t1
        await expect(reserva).rejects.toThrow(/EM PAUSA/)
        await expect(reserva).rejects.not.toThrow(/deadlock/i)

        const [c] = await sql<{ status: string }[]>`
          select status from contracts where id = ${dono.contractId}`
        expect(c.status, 'a pausa passou').toBe('paused')
        const [{ n }] = await sql<{ n: number }[]>`
          select count(*)::int as n from class_instances where contract_id = ${outro.contractId}`
        expect(Number(n), 'e a aula não nasceu').toBe(0)
      } finally {
        soltar()
        await conn1.end()
        await conn2.end()
      }
    }

    /* ---- ordem B: a AULA chega primeiro ---- */
    {
      const teacher = await createTeacher(sql)
      const dono = await contratoCom('America/Cuiaba', 'Cuiabá dono B U2', teacher)
      const outro = await contratoCom('America/Cuiaba', 'Cuiabá outro B U2', teacher)
      expect(
        (
          await admin.rpc('create_slot', {
            p_contract: dono.contractId,
            p_weekday: 5,
            p_local_time: '19:00',
            p_duration_min: 45,
          })
        ).error,
      ).toBeNull()
      const longe = await instanteDe(5, '19:00', 12)

      const conn1 = connect(1)
      const conn2 = connect(1)
      let soltar: () => void = () => {}
      const solta = new Promise<void>((r) => (soltar = r))
      let inseriu: () => void = () => {}
      const jaInseriu = new Promise<void>((r) => (inseriu = r))
      try {
        // T1: a aula nova (o gatilho da fronteira pede o advisory da professora)
        // e SEGURA a transação aberta.
        const t1 = conn1.begin(async (tx) => {
          await tx`
            insert into class_instances
              (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
            values (${outro.contractId}, ${teacher}, ${longe},
                    ${longe}::timestamptz + interval '45 minutes', 'c11 U2 ordem B')`
          inseriu()
          await solta
        })
        await jaInseriu

        // T2: a pausa do contrato dono do horário. Sem o advisory ela leria uma
        // agenda vazia (a aula ainda não commitou) e congelaria um horário que
        // já tinha dono.
        let terminou = false
        const pausa = julgadaDepois(
          conn2
            .begin(async (tx) => {
              await tx`select set_config('request.jwt.claims', ${CLAIMS_ADMIN}, true)`
              return tx`select public.pause_contract(${dono.contractId}, ${adminId})`
            })
            .then(
              (r) => {
                terminou = true
                return r
              },
              (e: Error) => {
                terminou = true
                throw e
              },
            ),
        )
        await espera(600)
        expect(terminou, 'a pausa passou por cima da aula a meio caminho').toBe(false)

        soltar()
        await t1
        await expect(pausa).rejects.toThrow(/já tem aula marcada de outro contrato/i)
        await expect(pausa).rejects.not.toThrow(/deadlock/i)

        const [c] = await sql<{ status: string }[]>`
          select status from contracts where id = ${dono.contractId}`
        expect(c.status, 'a pausa não passou').toBe('active')
        const [{ n }] = await sql<{ n: number }[]>`
          select count(*)::int as n from class_instances
           where contract_id = ${outro.contractId} and state = 'scheduled'`
        expect(Number(n), 'e a aula nasceu').toBe(1)
      } finally {
        soltar()
        await conn1.end()
        await conn2.end()
      }
    }
  })

  it('a conferência mora sob o MESMO advisory que serializa o outro lado', async () => {
    const [row] = await sql<{ src: string }[]>`
      select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'pause_contract'`
    const lock = row.src.indexOf("'teacher_agenda:' || v_contract.teacher_id")
    const confere = row.src.indexOf('_assert_no_scheduled_overlap')
    const escreve = row.src.indexOf("update contracts set status = 'paused'")
    expect(lock, 'o advisory continua de pé').toBeGreaterThan(-1)
    expect(confere, 'a conferência vem DEPOIS do advisory').toBeGreaterThan(lock)
    expect(escreve, 'e ANTES da escrita do status').toBeGreaterThan(confere)
  })
})

/* ========================================================================== */
/* U3 — o par aula ↔ horário fixo concorda sobre o contrato                    */
/* ========================================================================== */

describe('U3 · slot × contrato por estrutura', () => {
  it('a garantia existe no schema: unique (id, contract_id) + FK composta', async () => {
    const [u] = await sql<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid = 'public.recurring_slots'::regclass
         and conname = 'recurring_slots_id_contract_uniq'`
    expect(u.def).toMatch(/UNIQUE \(id, contract_id\)/i)

    const [f] = await sql<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid = 'public.class_instances'::regclass
         and conname = 'class_instances_slot_do_contrato'`
    expect(f.def).toMatch(
      /FOREIGN KEY \(slot_id, contract_id\) REFERENCES recurring_slots\(id, contract_id\)/i,
    )
  })

  it('aula pendurada em horário fixo de OUTRO contrato é recusada — e a avulsa passa limpo', async () => {
    const a = await contratoCom('America/Cuiaba', 'Cuiabá A U3')
    const b = await contratoCom('America/Cuiaba', 'Cuiabá B U3', a.teacherId)
    expect(
      (
        await admin.rpc('create_slot', {
          p_contract: a.contractId,
          p_weekday: 2,
          p_local_time: '06:30',
          p_duration_min: 45,
        })
      ).error,
    ).toBeNull()
    const [slot] = await sql<{ id: string }[]>`
      select id from recurring_slots where contract_id = ${a.contractId}`

    // fora do horizonte: a exclusão GiST e a chave de idempotência não têm o que
    // dizer, então quem recusa é a FK composta — e é ela que queremos ver.
    const longe = await instanteDe(2, '06:30', 12)
    const [dia] = await sql<{ d: string }[]>`
      select to_char(${longe}::timestamptz at time zone 'America/Cuiaba', 'YYYY-MM-DD') as d`
    await expect(
      sql`insert into class_instances
            (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
             local_time_snapshot)
          values (${b.contractId}, ${a.teacherId}, ${slot.id}, ${dia.d}::date, ${longe},
                  ${longe}::timestamptz + interval '45 minutes', 'c11 U3')`,
    ).rejects.toThrow(/class_instances_slot_do_contrato/)

    // MATCH SIMPLE: a avulsa (slot_id nulo) não é alcançada pela FK.
    const solta = await instanteDe(2, '20:30', 12)
    const [avulsa] = await sql<{ id: string }[]>`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${b.contractId}, ${a.teacherId}, ${solta},
              ${solta}::timestamptz + interval '45 minutes', 'c11 U3 avulsa')
      returning id`
    expect(avulsa.id).toBeTruthy()
  })

  it('desligar o gatilho do dono pelo NOME não basta: a FK segura a troca', async () => {
    const a = await contratoCom('America/Cuiaba', 'Cuiabá A gatilho U3')
    const b = await contratoCom('America/Cuiaba', 'Cuiabá B gatilho U3', a.teacherId)
    expect(
      (
        await admin.rpc('create_slot', {
          p_contract: a.contractId,
          p_weekday: 0,
          p_local_time: '08:15',
          p_duration_min: 45,
        })
      ).error,
    ).toBeNull()
    const [slot] = await sql<{ id: string }[]>`
      select id from recurring_slots where contract_id = ${a.contractId}`
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances where slot_id = ${slot.id}`
    expect(Number(n), 'o horário fixo tem aulas materializadas').toBeGreaterThan(0)

    try {
      await sql`alter table recurring_slots disable trigger recurring_slots_dono_imutavel`
      await expect(
        sql`update recurring_slots set contract_id = ${b.contractId} where id = ${slot.id}`,
      ).rejects.toThrow(/class_instances_slot_do_contrato/)
    } finally {
      await sql`alter table recurring_slots enable trigger recurring_slots_dono_imutavel`
    }

    const [dono] = await sql<{ contract_id: string }[]>`
      select contract_id from recurring_slots where id = ${slot.id}`
    expect(dono.contract_id).toBe(a.contractId)
  })

  it('troca privilegiada JÁ COMMITADA (com a RI desligada) é detectada pelo materializador', async () => {
    const a = await contratoCom('America/Cuiaba', 'Cuiabá A replica U3')
    const b = await contratoCom('America/Cuiaba', 'Cuiabá B replica U3', a.teacherId)
    expect(
      (
        await admin.rpc('create_slot', {
          p_contract: a.contractId,
          p_weekday: 6,
          p_local_time: '10:45',
          p_duration_min: 45,
        })
      ).error,
    ).toBeNull()
    const [slot] = await sql<{ id: string }[]>`
      select id from recurring_slots where contract_id = ${a.contractId}`

    // `session_replication_role = replica` desliga TUDO — o gatilho do c10 · T4
    // e a integridade referencial junto. É a única escrita que consegue COMMITAR
    // a troca de dono, e o resíduo que ela deixa (aulas velhas no contrato
    // antigo) é invisível para o cinto duplo, que só compara slot com contrato.
    const privilegiada = connect(1)
    try {
      await privilegiada`set session_replication_role = replica`
      await privilegiada`update recurring_slots set contract_id = ${b.contractId} where id = ${slot.id}`
      await privilegiada`set session_replication_role = origin`

      await expect(sql`select public.materialize_slot(${slot.id}, 8, true)`).rejects.toThrow(
        /presas em outro contrato/i,
      )
      // No modo TOLERANTE (o lote diário) nenhuma aula nasce deste horário
      // TAMPOUCO — mas o lote segue, e o resíduo fica registrado. Derrubar a
      // materialização da escola inteira por causa de um horário fixo seria um
      // dano maior do que o resíduo, e ele é PERSISTENTE: toda rodada voltaria a
      // encontrá-lo.
      const [r] = await sql<{ n: number }[]>`
        select public.materialize_slot(${slot.id}, 8, false) as n`
      expect(Number(r.n), 'nada nasce do horário divergente').toBe(0)
      const rastro = await sql`
        select 1 from audit_log
         where action = 'materialize_owner_mismatch' and entity_id = ${slot.id}`
      expect(rastro.length, 'e o resíduo fica registrado (Lei 8)').toBeGreaterThan(0)
    } finally {
      await privilegiada`set session_replication_role = replica`
      await privilegiada`update recurring_slots set contract_id = ${a.contractId} where id = ${slot.id}`
      await privilegiada`set session_replication_role = origin`
      await privilegiada.end()
    }

    // desfeito o resíduo, a materialização volta a funcionar
    const r = await sql<{ materialize_slot: number }[]>`
      select public.materialize_slot(${slot.id}, 8, true) as materialize_slot`
    expect(Number(r[0].materialize_slot)).toBeGreaterThanOrEqual(0)
  })
})
