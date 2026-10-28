// LOTE c10 — os RESIDUAIS da revisão adversarial nº 11.
//
//  · T1 — o cadastro NÃO nasce confirmado: `tz_confirmed = false` explícito no
//    `insert` das actions, e a confirmação vem só da RPC (falha da RPC = aluno
//    honestamente não-confirmado, contrato barrado). `admin_create_lead`, que
//    insere direto, vira o EQUIVALENTE ATÔMICO da RPC — cidade + zona válida,
//    com auditoria de mesmo nome;
//  · T2 — pausa × reserva SERIALIZADAS pelo advisory `teacher_agenda:<prof>`:
//    fora do horizonte materializado (onde a exclusão GiST não tem o que ver),
//    nunca os dois passam;
//  · T3 — o gatilho do horário pausado também vê o `UPDATE`: mover uma aula
//    para cima de horário em pausa é recusado;
//  · T4 — o dono de um horário fixo é imutável (gatilho) e o materializador
//    aborta se a releitura vir dono diferente (cinto duplo);
//  · T5 — trocar o fuso por fora da RPC DERRUBA `tz_confirmed`;
//  · T6 — `lerOcupacao` (a composição final) provada por COMPORTAMENTO: as
//    janelas do contrato ativo vêm das instâncias, a do pausado vem da
//    expansão, e as duas aparecem na mesma resposta.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DateTime } from 'luxon'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { clientAs, createAuthUser } from './helpers/auth'
import { connect, createStudent, createTeacher, julgadaDepois } from './helpers/db'
import { confirmarLocalizacao } from '@/lib/admin/confirmar-localizacao'
import { lerOcupacao } from '@/data/admin/ocupacao-consulta'
import { QUEM_PAUSADO } from '@/lib/agenda/ocupacao-fuso'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const CLAIMS_ADMIN = JSON.stringify({ app_metadata: { role: 'admin' } })
const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

let sql: Sql
let admin: SupabaseClient
let adminId: string

beforeAll(async () => {
  sql = connect(6)
  adminId = await createAuthUser(sql, 'admin', 'Admin revisão 11')
  admin = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  await sql.end()
})

/** O corpo VIVO de uma função do banco (o que está no ar, não o do arquivo). */
async function fonte(nome: string): Promise<string> {
  const [row] = await sql<{ src: string }[]>`
    select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = ${nome}`
  return row.src
}

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
    values ('private_1on1', ${studentId}, ${teacher}, 'c10', 15000, 4, 24, 90,
            public.business_today())
    returning id`
  return { contractId: c.id as string, teacherId: teacher, studentId }
}

/**
 * O instante da N-ésima ocorrência FUTURA de um horário local, calculado pelo
 * BANCO (`(date + local_time) at time zone tz`, Lei 1) — nunca por aritmética
 * de horas no TS.
 *
 * `semanas` grande de propósito nos casos do T2/T3: fora do horizonte de 8
 * semanas do materializador não existe instância nenhuma, então a exclusão GiST
 * da professora não tem o que ver — é exatamente ali que a serialização é a
 * única coisa entre a pausa e a reserva.
 */
async function instanteDe(weekday: number, hora: string, semanas: number, tz = 'America/Cuiaba') {
  const [row] = await sql<{ inicio: Date }[]>`
    select ((public.business_today()
             + ((${weekday} - extract(dow from public.business_today())::int + 7) % 7)
             + ${semanas * 7}::int)::date + ${hora}::time) at time zone ${tz} as inicio`
  return row.inicio
}

/* ========================================================================== */
/* T1 — o cadastro não nasce confirmado                                        */
/* ========================================================================== */

describe('T1 · confirmar é ato, e cadastro novo nasce a confirmar', () => {
  /** O `insert` das actions, com o mesmo cliente (sessão da admin) e os mesmos
   *  campos — o que muda entre elas é só o destino do redirect. */
  async function cadastrar(nome: string, cidade: string, tz = 'America/Cuiaba') {
    const { data, error } = await admin
      .from('students')
      .insert({ display_name: nome, iana_tz: tz, city: cidade || null, tz_confirmed: false })
      .select('id')
      .single()
    expect(error).toBeNull()
    return (data as { id: string }).id
  }

  const flagDe = async (id: string) => {
    const [row] = await sql<{ tz_confirmed: boolean }[]>`
      select tz_confirmed from students where id = ${id}`
    return row.tz_confirmed
  }

  const contrato = async (studentId: string, teacherId: string) => sql`
    insert into contracts
      (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
       monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
    values ('private_1on1', ${studentId}, ${teacherId}, 'T1', 15000, 4, 24, 90,
            public.business_today())
    returning id`

  it('RPC falhando (cidade vazia): o aluno EXISTE, não-confirmado, e o contrato é recusado', async () => {
    const id = await cadastrar('Aluna sem cidade T1', '')
    // a sequência da action: insert → confirmação. Aqui a confirmação falha.
    const { error } = await confirmarLocalizacao(admin, id, '', '', 'America/Cuiaba')
    expect(error, 'a RPC exige a cidade').toMatch(/exige a CIDADE/i)

    const [linha] = await sql<{ display_name: string }[]>`
      select display_name from students where id = ${id}`
    expect(linha.display_name, 'o cadastro ficou de pé').toBe('Aluna sem cidade T1')
    expect(await flagDe(id), 'e ficou honestamente a confirmar').toBe(false)

    const teacher = await createTeacher(sql)
    await expect(contrato(id, teacher)).rejects.toThrow(/palpite/i)

    // e o fluxo se conserta sozinho: completar a cidade destrava o contrato
    expect((await confirmarLocalizacao(admin, id, 'Cuiabá', 'BR', 'America/Cuiaba')).error).toBeNull()
    expect(await flagDe(id)).toBe(true)
    const [feito] = await contrato(id, teacher)
    expect(feito.id).toBeTruthy()
  })

  it('as DUAS actions gravam o flag explícito e confirmam DEPOIS', async () => {
    for (const arquivo of ['src/app/admin/alunos/actions.ts', 'src/app/admin/alunos/novo/actions.ts']) {
      const src = codigo(arquivo)
      const insere = src.indexOf('tz_confirmed: false')
      const confirma = src.indexOf('confirmarLocalizacao(supabase, ')
      expect(insere, `${arquivo}: o insert diz false com todas as letras`).toBeGreaterThan(-1)
      expect(confirma, `${arquivo}: a confirmação é a RPC`).toBeGreaterThan(insere)
    }
  })

  it('admin_create_lead com cidade: confirma na MESMA transação e audita com o nome da RPC', async () => {
    const { data, error } = await admin.rpc('admin_create_lead', {
      p_name: 'Lead completo T1',
      p_iana_tz: 'Europe/Lisbon',
      p_city: 'Lisboa',
      p_country: 'PT',
    })
    expect(error).toBeNull()
    const id = data as string
    expect(await flagDe(id)).toBe(true)

    const [audit] = await sql<{ diff: Record<string, Record<string, unknown>> }[]>`
      select diff from audit_log
       where action = 'confirm_student_location' and entity_id = ${id}`
    expect(audit, 'o ato de confirmar ficou registrado com o mesmo nome da RPC').toBeDefined()
    expect(audit.diff.para).toMatchObject({ city: 'Lisboa', iana_tz: 'Europe/Lisbon', tz_confirmed: true })
    expect(audit.diff.via).toBe('admin_create_lead')
  })

  it('admin_create_lead SEM cidade (só a zona) nasce palpite — a cidade é que sustenta a zona', async () => {
    const { data, error } = await admin.rpc('admin_create_lead', {
      p_name: 'Lead só com zona T1',
      p_iana_tz: 'Europe/Lisbon',
    })
    expect(error).toBeNull()
    const id = data as string
    expect(await flagDe(id)).toBe(false)
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where action = 'confirm_student_location' and entity_id = ${id}`
    expect(Number(n), 'nada foi confirmado, nada foi auditado como confirmação').toBe(0)
  })

  it('admin_create_lead recusa zona inventada com nome próprio, sem gravar nada', async () => {
    const { error } = await admin.rpc('admin_create_lead', {
      p_name: 'Lead de Nárnia T1',
      p_iana_tz: 'America/Narnia',
      p_city: 'Nárnia',
    })
    expect(error?.message).toMatch(/zona IANA inválida/i)
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from students where display_name = 'Lead de Nárnia T1'`
    expect(Number(n)).toBe(0)
  })
})

/* ========================================================================== */
/* T2 — pausa × reserva serializadas                                           */
/* ========================================================================== */

describe('T2 · pausa e reserva da mesma professora nunca passam as duas', () => {
  it('fora do horizonte materializado: a inserção ESPERA a pausa e depois é recusada', async () => {
    const teacher = await createTeacher(sql)
    const dono = await contratoCom('America/Cuiaba', 'Cuiabá do dono T2', teacher)
    const outro = await contratoCom('America/Cuiaba', 'Cuiabá do outro T2', teacher)

    // horário fixo do contrato que VAI ser pausado
    const criar = await admin.rpc('create_slot', {
      p_contract: dono.contractId,
      p_weekday: 2,
      p_local_time: '10:00',
      p_duration_min: 45,
    })
    expect(criar.error).toBeNull()

    // 12 semanas à frente: além das 8 do materializador, então NÃO existe
    // instância ali e a exclusão GiST não tem o que ver.
    const longe = await instanteDe(2, '10:00', 12)

    const conn1 = connect(1)
    const conn2 = connect(1)
    let soltar: () => void = () => {}
    const solta = new Promise<void>((r) => (soltar = r))
    let pausou: () => void = () => {}
    const jaPausou = new Promise<void>((r) => (pausou = r))

    try {
      // T1: pausa o contrato dono do horário e SEGURA a transação aberta.
      const t1 = conn1.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${CLAIMS_ADMIN}, true)`
        await tx`select public.pause_contract(${dono.contractId}, ${adminId})`
        pausou()
        await solta
      })
      await jaPausou

      // T2: a aula nova da MESMA professora, no horário que a pausa acabou de
      // reservar. Sem o advisory por professora ela leria `status = 'active'`
      // (a pausa ainda não commitou), não veria conflito nenhum e passaria —
      // e a retomada encontraria a agenda dada para outra pessoa.
      let terminou = false
      const reserva = julgadaDepois(
        conn2`
        insert into class_instances
          (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
        values (${outro.contractId}, ${teacher}, ${longe},
                ${longe}::timestamptz + interval '45 minutes', 'c10 T2')
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
      expect(terminou, 'a inserção passou por cima da pausa a meio caminho').toBe(false)

      soltar()
      await t1
      await expect(reserva).rejects.toThrow(/EM PAUSA/)
      await expect(reserva).rejects.not.toThrow(/deadlock/i)

      // o desfecho que importa: a pausa passou, a aula não nasceu
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from class_instances where contract_id = ${outro.contractId}`
      expect(Number(n)).toBe(0)
      const [c] = await sql<{ status: string }[]>`
        select status from contracts where id = ${dono.contractId}`
      expect(c.status).toBe('paused')
    } finally {
      soltar()
      await conn1.end()
      await conn2.end()
    }
  })

  it('o recurso em comum existe dos dois lados (pausa e gatilho pedem a MESMA chave)', async () => {
    expect(await fonte('pause_contract')).toContain("'teacher_agenda:' || v_contract.teacher_id")
    const helper = await fonte('_assert_no_paused_overlap')
    const lock = helper.indexOf("'teacher_agenda:' || p_teacher")
    const leitura = helper.indexOf("c.status = 'paused'")
    expect(lock, 'o helper pede o advisory').toBeGreaterThan(-1)
    expect(lock, 'e pede ANTES de ler status (inclusive antes da porta barata)').toBeLessThan(leitura)
  })

  it('o lote diário trava contratos e horários ANTES de qualquer advisory de professora', async () => {
    const src = await fonte('materialize_instances')
    const trava = src.indexOf('for update of c, rs')
    const laco = src.indexOf('foreach v_slot in array v_slot_ids')
    expect(trava, 'andares 1 e 4 do lote inteiro, numa consulta só').toBeGreaterThan(-1)
    expect(src, 'ordem total por uuid').toContain('order by c.id, rs.id')
    expect(trava, 'e antes do laço que materializa').toBeLessThan(laco)
    expect(src, 'a lista travada é a MESMA que o laço percorre').toContain('into v_slot_ids')
  })
})

/* ========================================================================== */
/* T3 — o gatilho também vê o UPDATE                                           */
/* ========================================================================== */

describe('T3 · mover uma aula para cima de horário em pausa é recusado', () => {
  it('UPDATE direto no instante da aula esbarra na mesma fronteira do INSERT', async () => {
    const teacher = await createTeacher(sql)
    const pausado = await contratoCom('America/Cuiaba', 'Cuiabá do pausado T3', teacher)
    const ativo = await contratoCom('America/Cuiaba', 'Cuiabá do ativo T3', teacher)

    const criar = await admin.rpc('create_slot', {
      p_contract: pausado.contractId,
      p_weekday: 4,
      p_local_time: '08:00',
      p_duration_min: 45,
    })
    expect(criar.error).toBeNull()
    // pausa LONGA: as futuras já materializadas somem, como acontece sozinho
    // depois de 8 semanas paradas.
    expect((await admin.rpc('pause_contract', { p_contract: pausado.contractId })).error).toBeNull()
    await sql`delete from class_instances where contract_id = ${pausado.contractId}`

    // uma aula do contrato ATIVO, em horário livre e fora do horizonte
    const livre = await instanteDe(4, '16:00', 12)
    const [inst] = await sql<{ id: string }[]>`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${ativo.contractId}, ${teacher}, ${livre},
              ${livre}::timestamptz + interval '45 minutes', 'c10 T3')
      returning id`

    const emCima = await instanteDe(4, '08:00', 12)
    await expect(
      sql`update class_instances
             set starts_at_utc = ${emCima},
                 ends_at_utc = ${emCima}::timestamptz + interval '45 minutes'
           where id = ${inst.id}`,
    ).rejects.toThrow(/EM PAUSA/)

    // e mover para um horário livre continua passando
    const outroLivre = await instanteDe(4, '17:00', 12)
    await sql`update class_instances
                 set starts_at_utc = ${outroLivre},
                     ends_at_utc = ${outroLivre}::timestamptz + interval '45 minutes'
               where id = ${inst.id}`
    const [depois] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances
       where id = ${inst.id} and starts_at_utc = ${outroLivre}`
    expect(Number(depois.n)).toBe(1)
  })

  it('o gatilho está declarado para INSERT e para o UPDATE das colunas de posse', async () => {
    const [t] = await sql<{ def: string }[]>`
      select pg_get_triggerdef(t.oid) as def from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
      where c.relname = 'class_instances' and t.tgname = 'class_instances_horario_em_pausa'`
    expect(t.def).toMatch(/BEFORE INSERT OR UPDATE OF/i)
    for (const col of ['teacher_id', 'slot_id', 'starts_at_utc', 'ends_at_utc', 'state']) {
      expect(t.def, `a coluna ${col} entra na guarda`).toContain(col)
    }
  })
})

/* ========================================================================== */
/* T4 — o dono do horário fixo é imutável                                      */
/* ========================================================================== */

describe('T4 · horário fixo não muda de contrato', () => {
  it('o UPDATE do dono é recusado com o caminho legítimo na mensagem', async () => {
    const a = await contratoCom('America/Cuiaba', 'Cuiabá A T4')
    const b = await contratoCom('America/Cuiaba', 'Cuiabá B T4', a.teacherId)
    const criar = await admin.rpc('create_slot', {
      p_contract: a.contractId,
      p_weekday: 6,
      p_local_time: '07:00',
      p_duration_min: 45,
    })
    expect(criar.error).toBeNull()
    const [slot] = await sql<{ id: string }[]>`
      select id from recurring_slots where contract_id = ${a.contractId}`

    await expect(
      sql`update recurring_slots set contract_id = ${b.contractId} where id = ${slot.id}`,
    ).rejects.toThrow(/não muda de contrato/i)

    // e o que não é o dono continua editável (fechar o horário é o gesto certo)
    await sql`update recurring_slots set active_to = public.business_today() + 30 where id = ${slot.id}`
    const [row] = await sql<{ contract_id: string }[]>`
      select contract_id from recurring_slots where id = ${slot.id}`
    expect(row.contract_id).toBe(a.contractId)
  })

  it('CINTO DUPLO: dono trocado entre a pré-leitura e o lock aborta a materialização', async () => {
    const a = await contratoCom('America/Cuiaba', 'Cuiabá A cinto T4')
    const b = await contratoCom('America/Cuiaba', 'Cuiabá B cinto T4', a.teacherId)
    const [slot] = await sql<{ id: string }[]>`
      insert into recurring_slots
        (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from)
      values (${a.contractId}, ${a.teacherId}, 0, '06:00', 'America/Cuiaba', 45,
              public.business_today())
      returning id`

    const conn1 = connect(1) // segura a linha do contrato dono
    const conn2 = connect(1) // materializa (vai bloquear no 1º andar)
    const conn3 = connect(1) // troca o dono por baixo do pano
    let soltar: () => void = () => {}
    const solta = new Promise<void>((r) => (soltar = r))
    let segurou: () => void = () => {}
    const jaSegurou = new Promise<void>((r) => (segurou = r))

    try {
      const t1 = conn1.begin(async (tx) => {
        await tx`select 1 from contracts where id = ${a.contractId} for update`
        segurou()
        await solta
      })
      await jaSegurou

      // a materialização já leu "o dono é A" e agora espera a linha de A
      let terminou = false
      const materializa = julgadaDepois(
        conn2`select public.materialize_slot(${slot.id}, 8, true)`.then(
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
      await espera(500)
      expect(terminou, 'ela precisa estar parada no lock do contrato').toBe(false)

      // `session_replication_role = replica` desliga os gatilhos DESTA sessão:
      // é o único jeito de encenar o estado que o gatilho do T4 tornou
      // impossível — e é justamente ele que o cinto duplo existe para pegar.
      await conn3`set session_replication_role = replica`
      await conn3`update recurring_slots set contract_id = ${b.contractId} where id = ${slot.id}`
      await conn3`set session_replication_role = origin`

      soltar()
      await t1
      await expect(materializa).rejects.toThrow(/trocou de contrato/i)

      // A pergunta é "nasceu aula no contrato ERRADO?" — e é só ela. Contar
      // TODAS as instâncias do slot media outra coisa: o lote global de outro
      // arquivo de teste (`materialize.test.ts` roda `materialize_instances(20)`)
      // pode ter materializado este horário para o dono LEGÍTIMO antes da troca,
      // e isso não é o defeito que este caso procura.
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from class_instances
         where slot_id = ${slot.id} and contract_id = ${b.contractId}`
      expect(Number(n), 'nenhuma aula nasceu no contrato errado').toBe(0)
    } finally {
      soltar()
      // O caso encena um estado IMPOSSÍVEL (dono trocado com a integridade
      // referencial desligada). Deixá-lo no banco envenena o lote global dos
      // outros arquivos — desde o c11 · U3 o materializador PULA horário fixo com
      // aula presa em outro contrato, e o resíduo daqui viraria ruído lá.
      await conn3`set session_replication_role = replica`
      await conn3`update recurring_slots set contract_id = ${a.contractId} where id = ${slot.id}`
      await conn3`set session_replication_role = origin`
      await conn1.end()
      await conn2.end()
      await conn3.end()
    }
  })
})

/* ========================================================================== */
/* T5 — edição sem estado inconsistente                                        */
/* ========================================================================== */

describe('T5 · fuso novo por fora do ato derruba a confirmação', () => {
  const flagDe = async (id: string) => {
    const [row] = await sql<{ tz_confirmed: boolean }[]>`
      select tz_confirmed from students where id = ${id}`
    return row.tz_confirmed
  }

  it('editar SÓ o fuso: o flag cai e o contrato volta a ser recusado', async () => {
    const id = await createStudent(sql, 'America/Cuiaba')
    expect((await confirmarLocalizacao(admin, id, 'Cuiabá', 'BR', 'America/Cuiaba')).error).toBeNull()
    expect(await flagDe(id)).toBe(true)

    // o ramo "sem cidade" de `updateStudentAction`
    const { error } = await admin.from('students').update({ iana_tz: 'Europe/Lisbon' }).eq('id', id)
    expect(error, 'a edição continua permitida').toBeNull()
    expect(await flagDe(id), 'zona nova sem cidade auditada é palpite de novo').toBe(false)

    const teacher = await createTeacher(sql)
    await expect(
      sql`insert into contracts
            (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
             monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
          values ('private_1on1', ${id}, ${teacher}, 'T5', 15000, 4, 24, 90,
                  public.business_today())`,
    ).rejects.toThrow(/palpite/i)

    // e o ato de confirmação levanta tudo de novo, com a zona nova
    expect((await confirmarLocalizacao(admin, id, 'Lisboa', 'PT', 'Europe/Lisbon')).error).toBeNull()
    expect(await flagDe(id)).toBe(true)
    const [row] = await sql<{ iana_tz: string }[]>`select iana_tz from students where id = ${id}`
    expect(row.iana_tz).toBe('Europe/Lisbon')
  })

  it('escrita que NÃO toca a zona não mexe no flag', async () => {
    const id = await createStudent(sql, 'America/Cuiaba')
    expect((await confirmarLocalizacao(admin, id, 'Cuiabá', 'BR', 'America/Cuiaba')).error).toBeNull()
    await sql`update students set level = 'A2' where id = ${id}`
    expect(await flagDe(id)).toBe(true)
  })

  it('a action confirma ANTES de atualizar o resto (inverter desfaria a confirmação)', () => {
    const src = codigo('src/app/admin/alunos/actions.ts')
    const update = src.indexOf('updateStudentAction')
    const rpc = src.indexOf('confirmarLocalizacao(supabase, id,', update)
    const resto = src.indexOf("from('students')\n      .update({", rpc)
    expect(rpc, 'a RPC vem primeiro').toBeGreaterThan(update)
    expect(resto, 'e o update do resto vem depois').toBeGreaterThan(rpc)
    // e o update de baixo NÃO toca o fuso (tocaria = derrubaria o flag)
    const fimDoUpdate = src.indexOf("})\n      .eq('id', id)", resto)
    expect(fimDoUpdate, 'o update do resto está inteiro aqui').toBeGreaterThan(resto)
    expect(src.slice(resto, fimDoUpdate)).not.toContain('iana_tz')
  })
})

/* ========================================================================== */
/* T6 — a ocupação COMPLETA, provada por comportamento                         */
/* ========================================================================== */

describe('T6 · lerOcupacao junta as duas fontes — e só elas', () => {
  it('ativo (pelas instâncias) + pausado (pela expansão) na mesma resposta', async () => {
    const teacher = await createTeacher(sql)
    const ativo = await contratoCom('America/Cuiaba', 'Cuiabá do ativo T6', teacher)
    await sql`update students set display_name = 'Aluna Ativa T6' where id = ${ativo.studentId}`
    const pausado = await contratoCom('America/Cuiaba', 'Cuiabá do pausado T6', teacher)

    // ativo: segunda 19:00 — vira instância materializada
    expect(
      (
        await admin.rpc('create_slot', {
          p_contract: ativo.contractId,
          p_weekday: 1,
          p_local_time: '19:00',
          p_duration_min: 45,
        })
      ).error,
    ).toBeNull()
    // pausado: sexta 15:00 — sem instância nenhuma depois da pausa longa
    expect(
      (
        await admin.rpc('create_slot', {
          p_contract: pausado.contractId,
          p_weekday: 5,
          p_local_time: '15:00',
          p_duration_min: 45,
        })
      ).error,
    ).toBeNull()
    expect((await admin.rpc('pause_contract', { p_contract: pausado.contractId })).error).toBeNull()
    await sql`delete from class_instances where contract_id = ${pausado.contractId}`

    // a composição final, no relógio do aluno novo (a mesma zona, para que a
    // conta de minutos seja lida a olho)
    const janelas = (await lerOcupacao(admin, 'America/Cuiaba', DateTime.now())).filter(
      (j) => j.professoraId === teacher,
    )

    const chave = (j: { weekday: number; inicio: number; fim: number; quem: string }) =>
      `${j.weekday} ${j.inicio}-${j.fim} ${j.quem}`
    const vistas = [...new Set(janelas.map(chave))].sort()
    expect(vistas, 'exatamente as duas fontes, uma janela cada').toEqual(
      [`1 1140-1185 Aluna Ativa T6`, `5 900-945 ${QUEM_PAUSADO}`].sort(),
    )

    // e o rótulo pronto para a tela vem junto, nos dois
    const doAtivo = janelas.find((j) => j.quem === 'Aluna Ativa T6')
    const doPausado = janelas.find((j) => j.quem === QUEM_PAUSADO)
    expect(doAtivo?.texto).toBe('19:00–19:45')
    expect(doPausado?.texto).toBe('15:00–15:45')
  })
})
