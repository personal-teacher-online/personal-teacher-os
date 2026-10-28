// LOTE c9 — o fechamento ESTRUTURAL dos achados da revisão adversarial nº 10.
//
//  · S1 — o MATERIALIZADOR entra pela ordem canônica (contrato → slot →
//    advisory) e RELÊ o estado depois dos locks: encerrar (ou pausar) o contrato
//    enquanto ele está entre a leitura e o `insert` não deixa nascer nenhuma
//    aula `scheduled`;
//  · S2 — a posse do horário de um contrato PAUSADO vira gatilho na fronteira
//    comum (`before insert` em `class_instances`) + varredura recorrente de 12
//    meses no `create_slot`: a avulsa, a reserva computada e a colisão que só
//    aparece depois da virada de DST são todas recusadas;
//  · S3 — confirmar o fuso é ATO (`confirm_student_location`), não efeito de um
//    `update`: cidade sozinha não confirma, fuso sozinho não confirma, flag
//    direto é recusado;
//  · S4 — `class_instance_tz` falha NOMEADA numa cadeia de remarcação com
//    ciclo, em vez de girar até o timeout;
//  · S5 — a leitura da ocupação prova por COMPORTAMENTO (não por grep) que só o
//    contrato pausado é expandido a partir de `recurring_slots`.
import { DateTime } from 'luxon'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createPrivateContract,
  createSlot,
  createStudent,
  createTeacher,
  daysFromToday,
  proximaVirada,
} from './helpers/db'
import { lerAulasDaAgenda, lerSlotsPausados } from '@/data/admin/ocupacao-consulta'
import { fimDaAntecipacao } from '@/lib/agenda/ocupacao-fuso'

let sql: Sql
let admin: SupabaseClient
let adminId: string

beforeAll(async () => {
  sql = connect(8)
  adminId = await createAuthUser(sql, 'admin', 'Admin revisão 10')
  admin = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  await sql.end()
})

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Um aluno de cadastro COMPLETO (cidade + fuso confirmados pela RPC do S3). */
async function alunoConfirmado(tz: string, cidade: string): Promise<string> {
  const id = await createStudent(sql, tz)
  const { error } = await admin.rpc('confirm_student_location', {
    p_student: id,
    p_city: cidade,
    p_country: 'BR',
    p_iana_tz: tz,
  })
  expect(error).toBeNull()
  return id
}

/** Contrato particular ATIVO de um aluno com fuso confirmado. */
async function contratoCom(tz: string, cidade: string, teacherId?: string) {
  const studentId = await alunoConfirmado(tz, cidade)
  const teacher = teacherId ?? (await createTeacher(sql))
  const [c] = await sql`
    insert into contracts
      (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
       monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
    values ('private_1on1', ${studentId}, ${teacher}, 'c9', 15000, 4, 24, 90,
            public.business_today())
    returning id`
  return { contractId: c.id as string, teacherId: teacher, studentId }
}

/**
 * A pausa LONGA simulada (mesma do c8): pausar e APAGAR as futuras já
 * materializadas é o retrato fiel do que 8+ semanas fazem sozinhas — as
 * ocorrências que existiam viram passado e o materializador não cria nenhuma
 * nova enquanto o contrato estiver pausado. Sem instância, a exclusão GiST da
 * professora não tem o que ver: é exatamente o buraco que o S2 fecha.
 */
async function pausaLonga(contratoId: string) {
  const { error } = await admin.rpc('pause_contract', { p_contract: contratoId })
  expect(error).toBeNull()
  await sql`delete from class_instances where contract_id = ${contratoId} and state = 'scheduled'`
}

/* ========================================================================== */
/* S1 — o materializador na ordem canônica                                     */
/* ========================================================================== */

/**
 * Segura a linha do contrato numa conexão só, JÁ com o novo status escrito, e
 * devolve a chave de commit/rollback.
 *
 * É o retrato do TOCTOU: a transação que encerra o contrato está aberta e o
 * materializador chega em cima dela. Se a materialização decidisse pela leitura
 * feita ANTES do lock (como fazia até o c8), commitar o encerramento aqui não
 * mudaria nada — as aulas nasceriam assim mesmo.
 */
function mudaStatusSegurando(contratoId: string, novo: 'ended' | 'paused') {
  const conexao = connect(1)
  let soltar: (commit: boolean) => void = () => {}
  const solta = new Promise<boolean>((r) => (soltar = r))
  const segurando = conexao
    .begin(async (tx) => {
      await tx`select 1 from contracts where id = ${contratoId} for update`
      await tx`update contracts set status = ${novo} where id = ${contratoId}`
      if (!(await solta)) throw new Error('rollback proposital')
    })
    .catch((e: Error) => {
      if (!e.message.includes('rollback proposital')) throw e
    })
  return {
    async liberar(commit: boolean) {
      soltar(commit)
      await segurando
      await conexao.end()
    },
  }
}

describe('S1 · encerrar o contrato durante a materialização não deixa nascer aula', () => {
  async function bancada() {
    const c = await contratoCom('America/Cuiaba', 'Cuiabá S1')
    const slot = await createSlot(sql, c, { weekday: 3, localTime: '09:00', tz: 'America/Cuiaba' })
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances where contract_id = ${c.contractId}`
    expect(Number(n), 'a bancada começa sem instância nenhuma').toBe(0)
    return { ...c, slot }
  }

  const agendadas = async (contratoId: string) => {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances
       where contract_id = ${contratoId} and state = 'scheduled'`
    return Number(n)
  }

  it('ENCERRADO no meio do caminho: zero aula criada, e sem erro no lote', async () => {
    const b = await bancada()
    const dono = mudaStatusSegurando(b.contractId, 'ended')
    await espera(150)

    // o materializador chega DEPOIS da pré-leitura e trava na porta (contrato)
    const materializando = sql`select public.materialize_slot(${b.slot}, 8) as n`
    const onde = await Promise.race([
      materializando.then(() => 'terminou'),
      espera(500).then(() => 'esperando na porta'),
    ])
    expect(onde, 'a materialização espera a linha do contrato').toBe('esperando na porta')

    await dono.liberar(true) // o encerramento COMMITA
    const [{ n }] = (await materializando) as unknown as { n: number }[]
    expect(Number(n), 'nada materializado para contrato encerrado').toBe(0)
    expect(await agendadas(b.contractId), 'nenhuma scheduled nasceu').toBe(0)
  })

  it('PAUSADO no meio do caminho: idem (e o horário fica guardado para a retomada)', async () => {
    const b = await bancada()
    const dono = mudaStatusSegurando(b.contractId, 'paused')
    await espera(150)
    const materializando = sql`select public.materialize_slot(${b.slot}, 8) as n`
    await espera(300)
    await dono.liberar(true)
    const [{ n }] = (await materializando) as unknown as { n: number }[]
    expect(Number(n)).toBe(0)
    expect(await agendadas(b.contractId)).toBe(0)
    const [{ vivo }] = await sql<{ vivo: number }[]>`
      select count(*)::int as vivo from recurring_slots where id = ${b.slot}`
    expect(Number(vivo), 'o horário fixo continua lá').toBe(1)
  })

  it('CONTROLE: se o encerramento desiste (rollback), a materialização acontece inteira', async () => {
    const b = await bancada()
    const dono = mudaStatusSegurando(b.contractId, 'ended')
    await espera(150)
    const materializando = sql`select public.materialize_slot(${b.slot}, 8) as n`
    await espera(300)
    await dono.liberar(false) // desistiu
    const [{ n }] = (await materializando) as unknown as { n: number }[]
    expect(Number(n), 'as 8 semanas nascem').toBeGreaterThan(4)
    expect(await agendadas(b.contractId)).toBeGreaterThan(4)
  })

  it('no modo ESTRITO o contrato encerrado é ERRO (o caminho interativo tem de saber)', async () => {
    const b = await bancada()
    await sql`update contracts set status = 'ended' where id = ${b.contractId}`
    await expect(
      sql`select public.materialize_slot(${b.slot}, 8, true) as n`,
    ).rejects.toThrow(/contrato foi encerrado/i)
    // e o horário fixo FECHADO também
    await sql`update contracts set status = 'active' where id = ${b.contractId}`
    await sql`update recurring_slots set active_to = public.business_today() - 30 where id = ${b.slot}`
    await expect(
      sql`select public.materialize_slot(${b.slot}, 8, true) as n`,
    ).rejects.toThrow(/foi fechado em/i)
    // no modo tolerante, os dois são silêncio
    const [{ n }] = await sql<{ n: number }[]>`select public.materialize_slot(${b.slot}, 8) as n`
    expect(Number(n)).toBe(0)
  })
})

describe('S1 · a ordem canônica está escrita no corpo vivo do materializador', () => {
  const semEspaco = (s: string) => s.replace(/\s+/g, ' ')
  async function fonte(nome: string): Promise<string> {
    const [f] = await sql<{ src: string }[]>`
      select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = ${nome}`
    return semEspaco(f.src)
  }

  it('materialize_slot: contrato → slot → advisory, e a releitura DEPOIS', async () => {
    const src = await fonte('materialize_slot')
    const contrato = src.indexOf('from contracts where id = v_contract_id for update')
    const slot = src.indexOf('from recurring_slots where id = p_slot for update')
    const advisory = src.indexOf("pg_advisory_xact_lock(hashtextextended('materialize_slot:")
    const decide = src.indexOf("if v_contract.status <> 'active'")
    expect(contrato, 'trava a linha do contrato').toBeGreaterThan(-1)
    expect(contrato, 'contrato antes do slot').toBeLessThan(slot)
    expect(slot, 'slot antes do advisory').toBeLessThan(advisory)
    expect(advisory, 'a decisão sobre o status vem DEPOIS dos locks').toBeLessThan(decide)
    // e a leitura que decidia antes (join com contracts) não existe mais
    expect(src).not.toContain("join contracts c on c.id = rs.contract_id where rs.id = p_slot")
  })

  // ATUALIZADO no c10 · T2: a delegação e a ordem por uuid seguem sendo o que
  // este teste cobra — o que mudou é QUANDO as linhas são travadas. O lote
  // passou a travar contratos e horários fixos de uma vez, antes do laço, para
  // não pedir linha nenhuma depois de já ter na mão um `teacher_agenda`
  // (o advisory por professora que o c10 criou). Por isso o laço deixou de ser
  // `for r in <consulta>` e virou `foreach` sobre a lista travada.
  it('materialize_instances delega ao materialize_slot e trava contratos por uuid', async () => {
    const src = await fonte('materialize_instances')
    expect(src).toContain('public.materialize_slot(v_slot, p_weeks, false)')
    expect(src, 'contratos em ordem de uuid').toContain('order by c.id, rs.id')
    expect(src, 'sem laço de insert próprio').not.toContain('insert into class_instances')
  })

  it('resume_contract materializa EXATAMENTE os slots que travou', async () => {
    const src = await fonte('resume_contract')
    const trava = src.indexOf('from recurring_slots where contract_id = p_contract')
    const guarda = src.indexOf('into v_slot_ids')
    const materializa = src.indexOf('foreach v_slot in array v_slot_ids')
    expect(trava, 'trava os horários fixos vigentes').toBeGreaterThan(-1)
    expect(trava, 'e guarda a lista travada').toBeLessThan(materializa)
    expect(guarda).toBeGreaterThan(-1)
    // a segunda consulta (a que podia divergir do conjunto travado) morreu
    expect(src.match(/from recurring_slots where contract_id = p_contract/g) ?? []).toHaveLength(1)
  })
})

/* ========================================================================== */
/* S2 — a posse do horário pausado na fronteira comum                          */
/* ========================================================================== */

describe('S2 · nenhuma aula nasce em cima do horário de um contrato em pausa', () => {
  /** Contrato pausado, com horário fixo vigente e SEM instância nenhuma. */
  async function pausadoComHorario(
    tz: string,
    cidade: string,
    weekday: number,
    hora: string,
    teacherId?: string,
  ) {
    const c = await contratoCom(tz, cidade, teacherId)
    const { error } = await admin.rpc('create_slot', {
      p_contract: c.contractId,
      p_weekday: weekday,
      p_local_time: hora,
      p_duration_min: 45,
    })
    expect(error).toBeNull()
    await pausaLonga(c.contractId)
    return c
  }

  it('a AVULSA (insert direto, a porta que o gatilho cobre) é recusada', async () => {
    const alvo = DateTime.now().setZone('America/Cuiaba').plus({ days: 9 }).startOf('day').set({ hour: 8 })
    const pausado = await pausadoComHorario(
      'America/Cuiaba',
      'Cuiabá S2 avulsa',
      alvo.weekday % 7,
      '08:00',
    )
    const outro = await contratoCom('America/Cuiaba', 'Cuiabá S2 vizinho', pausado.teacherId)

    await expect(
      sql`
        insert into class_instances
          (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
        values (${outro.contractId}, ${pausado.teacherId}, ${alvo.toUTC().toISO()},
                ${alvo.plus({ minutes: 45 }).toUTC().toISO()}, 'avulsa S2')`,
    ).rejects.toThrow(/EM PAUSA/)

    // e a guarda não é cega: duas horas depois passa
    const [ok] = await sql`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values (${outro.contractId}, ${pausado.teacherId}, ${alvo.plus({ hours: 2 }).toUTC().toISO()},
              ${alvo.plus({ hours: 2, minutes: 45 }).toUTC().toISO()}, 'avulsa S2 ok')
      returning id`
    expect(ok.id).toBeTruthy()
  })

  it('a reserva COMPUTADA (book_computed_slot) é recusada no mesmo instante', async () => {
    const dia = daysFromToday(6)
    const alvo = DateTime.fromISO(`${dia}T10:00`, { zone: 'America/Cuiaba' })
    const pausado = await pausadoComHorario(
      'America/Cuiaba',
      'Cuiabá S2 computada',
      alvo.weekday % 7,
      '10:00',
    )
    const c = await contratoCom('America/Cuiaba', 'Cuiabá S2 aluno', pausado.teacherId)
    await sql`
      insert into makeup_ledger (contract_id, student_id, delta, reason, expires_on, duration_min)
      values (${c.contractId}, ${c.studentId}, 1, 'manual_adjust', ${daysFromToday(40)}, 45)`
    const janela = await admin.rpc('set_weekly_availability', {
      p_teacher: pausado.teacherId,
      p_weekday: alvo.weekday % 7,
      p_start: '06:00',
      p_end: '22:00',
      p_iana_tz: 'America/Cuiaba',
    })
    expect(janela.error).toBeNull()

    const reserva = await admin.rpc('book_computed_slot', {
      p_teacher: pausado.teacherId,
      p_starts_at_utc: alvo.toUTC().toISO(),
      p_contract: c.contractId,
    })
    expect(reserva.error?.message).toMatch(/EM PAUSA/)

    // o crédito NÃO foi gasto (a transação inteira reverteu)
    const [{ saldo }] = await sql<{ saldo: number }[]>`
      select coalesce(sum(delta), 0)::int as saldo from makeup_ledger
       where contract_id = ${c.contractId}`
    expect(Number(saldo)).toBe(1)
  })

  it('a colisão que SÓ existe depois da virada de DST é recusada na criação', async () => {
    // Lisboa alterna UTC+1 (verão) e UTC+0 (inverno); Cuiabá é UTC-4 o ano
    // inteiro, então 06:00 lá é 10:00 UTC sempre. A hora de Lisboa é escolhida
    // pelo regime de HOJE para que NÃO colida agora e passe a colidir na
    // próxima virada: 10:00 no verão (vira 10:00 UTC no inverno) ou 11:00 no
    // inverno (vira 10:00 UTC no verão). Até 10/10/2026 a data da virada
    // (25/10/2026) estava cravada no teste: ele falhava nas 8 semanas antes
    // dela e, depois dela, deixava de provar o que diz. Agora a virada é
    // calculada a partir da base IANA (Lei 1), e o primeiro dia de choque é
    // conferido exatamente — a primeira quarta-feira a partir da virada.
    // A mensagem "primeiro dia de choque" só existe na varredura recorrente
    // de 12 meses (`_assert_no_paused_overlap` em modo recorrente), então o
    // `toMatch` abaixo já prova que a recusa veio dela — inclusive nas 8
    // semanas antes da virada, quando o choque cai dentro do horizonte
    // materializado.
    const agoraEmLisboa = DateTime.now().setZone('Europe/Lisbon')
    const virada = proximaVirada(agoraEmLisboa)
    const horaLisboa = agoraEmLisboa.isInDST ? '10:00' : '11:00'

    const pausado = await pausadoComHorario('Europe/Lisbon', 'Lisboa', 3, horaLisboa)
    const novo = await contratoCom('America/Cuiaba', 'Cuiabá do DST', pausado.teacherId)

    const colide = await admin.rpc('create_slot', {
      p_contract: novo.contractId,
      p_weekday: 3,
      p_local_time: '06:00',
      p_duration_min: 45,
    })
    expect(colide.error?.message).toMatch(/EM PAUSA/)

    const dia = /choque: (\d{2}\/\d{2}\/\d{4})/.exec(colide.error?.message ?? '')?.[1]
    expect(dia, 'a mensagem nomeia o primeiro dia de choque').toBeTruthy()
    const choque = DateTime.fromFormat(dia as string, 'dd/LL/yyyy', { zone: 'America/Cuiaba' })

    let primeiraQuarta = virada
    while (primeiraQuarta.weekday % 7 !== 3) primeiraQuarta = primeiraQuarta.plus({ days: 1 })
    expect(choque.toISODate(), 'o choque começa na primeira quarta a partir da virada').toBe(
      primeiraQuarta.toISODate(),
    )

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from recurring_slots where contract_id = ${novo.contractId}`
    expect(Number(n), 'nada de horário fixo criado').toBe(0)
  })

  it('o SEGUNDO horário do próprio contrato pausado também é recusado', async () => {
    // O c8 excluía o CONTRATO inteiro da comparação, e por isso um segundo
    // horário sobreposto ao primeiro, no mesmo contrato pausado, passava batido
    // — e voltava como conflito mudo na retomada. Agora exclui-se só o slot de
    // origem: o irmão disputa como qualquer outro.
    const pausado = await pausadoComHorario('America/Cuiaba', 'Cuiabá do irmão', 2, '15:00')

    const irmao = await admin.rpc('create_slot', {
      p_contract: pausado.contractId,
      p_weekday: 2,
      p_local_time: '15:30',
      p_duration_min: 45,
    })
    expect(irmao.error?.message).toMatch(/EM PAUSA/)

    // e um horário que NÃO sobrepõe continua podendo ser preparado para a volta
    const livre = await admin.rpc('create_slot', {
      p_contract: pausado.contractId,
      p_weekday: 2,
      p_local_time: '17:00',
      p_duration_min: 45,
    })
    expect(livre.error).toBeNull()
  })

  it('a RETOMADA materializa sem buraco (o horário guardado é o do próprio contrato)', async () => {
    const pausado = await pausadoComHorario('America/Cuiaba', 'Cuiabá da retomada', 4, '14:00')
    const retoma = await admin.rpc('resume_contract', { p_contract: pausado.contractId })
    expect(retoma.error).toBeNull()

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_instances
       where contract_id = ${pausado.contractId} and state = 'scheduled'`
    expect(Number(n), 'as 8 semanas voltam inteiras').toBeGreaterThan(4)
    const [{ conflitos }] = await sql<{ conflitos: number }[]>`
      select count(*)::int as conflitos from audit_log
       where action = 'materialize_conflict'
         and entity_id in (select id::text from recurring_slots
                            where contract_id = ${pausado.contractId})`
    expect(Number(conflitos), 'nenhuma ocorrência pulada').toBe(0)
  })

  it('a regra mora num lugar só: gatilho na fronteira + o helper único', async () => {
    const [t] = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
      where c.relname = 'class_instances' and t.tgname = 'class_instances_horario_em_pausa'`
    expect(Number(t.n), 'o gatilho existe na fronteira comum').toBe(1)
    const [{ n: velha }] = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = '_paused_slot_conflict'`
    expect(Number(velha), 'a função duplicada do c8 morreu').toBe(0)
  })
})

/* ========================================================================== */
/* S3 — confirmar o fuso é ATO                                                 */
/* ========================================================================== */

describe('S3 · a confirmação do fuso é atômica e só acontece pela RPC', () => {
  async function leadSemCidade(nome: string): Promise<string> {
    const { data, error } = await admin.rpc('admin_create_lead', { p_name: nome })
    expect(error).toBeNull()
    return data as string
  }
  const flagDe = async (id: string) => {
    const [row] = await sql<{ tz_confirmed: boolean }[]>`
      select tz_confirmed from students where id = ${id}`
    return row.tz_confirmed
  }

  it('a CIDADE sozinha não confirma (o fuso continua o palpite da escola)', async () => {
    const id = await leadSemCidade('Lead só cidade S3')
    const { error } = await admin.from('students').update({ city: 'Lisboa', country: 'PT' }).eq('id', id)
    expect(error).toBeNull()
    expect(await flagDe(id), 'gravar o dado não é atestar que ele foi conferido').toBe(false)
  })

  it('o FUSO sozinho não confirma', async () => {
    const id = await leadSemCidade('Lead só fuso S3')
    const { error } = await admin.from('students').update({ iana_tz: 'Europe/Lisbon' }).eq('id', id)
    expect(error).toBeNull()
    expect(await flagDe(id)).toBe(false)
  })

  it('ligar o flag direto é recusado — no SQL cru, pelo PostgREST e junto com a cidade', async () => {
    const id = await leadSemCidade('Lead do flag S3')
    await expect(
      sql`update students set tz_confirmed = true where id = ${id}`,
    ).rejects.toThrow(/não se liga sozinho/i)

    const pelaApi = await admin.from('students').update({ tz_confirmed: true }).eq('id', id)
    expect(pelaApi.error?.message).toMatch(/não se liga sozinho/i)

    // e nem "disfarçado" de escrita de cadastro
    await expect(
      sql`update students set city = 'Cuiabá', iana_tz = 'America/Cuiaba', tz_confirmed = true
           where id = ${id}`,
    ).rejects.toThrow(/não se liga sozinho/i)
    expect(await flagDe(id)).toBe(false)
  })

  it('a RPC recusa zona inválida e cidade vazia, sem gravar nada', async () => {
    const id = await leadSemCidade('Lead da zona inválida S3')
    const zona = await admin.rpc('confirm_student_location', {
      p_student: id, p_city: 'Nárnia', p_country: 'BR', p_iana_tz: 'America/Narnia',
    })
    expect(zona.error?.message).toMatch(/zona IANA inválida/i)

    const semCidade = await admin.rpc('confirm_student_location', {
      p_student: id, p_city: '  ', p_country: 'BR', p_iana_tz: 'Europe/Lisbon',
    })
    expect(semCidade.error?.message).toMatch(/exige a CIDADE/i)

    const [row] = await sql<{ city: string | null; iana_tz: string }[]>`
      select city, iana_tz from students where id = ${id}`
    expect(row.city, 'nada foi gravado').toBeNull()
    expect(row.iana_tz).toBe('America/Cuiaba')
    expect(await flagDe(id)).toBe(false)
  })

  it('CAMINHO FELIZ: a RPC grava os três, confirma e destrava o contrato', async () => {
    const id = await leadSemCidade('Lead que confirmou S3')
    const teacher = await createTeacher(sql)
    const contrato = async () => sql`
      insert into contracts
        (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${id}, ${teacher}, 'depois da confirmação', 15000, 4, 24, 90,
              public.business_today())
      returning id`
    await expect(contrato()).rejects.toThrow(/palpite/i)

    const { error } = await admin.rpc('confirm_student_location', {
      p_student: id, p_city: 'Lisboa', p_country: 'PT', p_iana_tz: 'Europe/Lisbon',
    })
    expect(error).toBeNull()

    const [row] = await sql<{ city: string; country: string; iana_tz: string; tz_confirmed: boolean }[]>`
      select city, country, iana_tz, tz_confirmed from students where id = ${id}`
    expect(row).toMatchObject({
      city: 'Lisboa', country: 'PT', iana_tz: 'Europe/Lisbon', tz_confirmed: true,
    })
    const [feito] = await contrato()
    expect(feito.id).toBeTruthy()

    // Lei 8: o ato ficou registrado com o antes e o depois
    const [audit] = await sql<{ diff: Record<string, Record<string, unknown>> }[]>`
      select diff from audit_log
       where action = 'confirm_student_location' and entity_id = ${id}
       order by id desc limit 1`
    expect(audit.diff.de.tz_confirmed).toBe(false)
    expect(audit.diff.para.iana_tz).toBe('Europe/Lisbon')
  })

  it('DESLIGAR continua livre (é assim que se marca um cadastro para revisão)', async () => {
    const id = await createStudent(sql)
    await sql`update students set tz_confirmed = false where id = ${id}`
    expect(await flagDe(id)).toBe(false)
  })

  it('a RPC é da admin (o aluno não confirma o próprio fuso)', async () => {
    const id = await createStudent(sql)
    const alunoId = await createAuthUser(sql, 'student', 'Aluno curioso S3')
    const aluno = await clientAs(alunoId, 'student')
    const { error } = await aluno.rpc('confirm_student_location', {
      p_student: id, p_city: 'Cuiabá', p_country: 'BR', p_iana_tz: 'America/Cuiaba',
    })
    expect(error?.message).toMatch(/restrita à admin/i)
  })
})

/* ========================================================================== */
/* S4 — cadeia de remarcação com ciclo                                         */
/* ========================================================================== */

describe('S4 · class_instance_tz falha nomeada em vez de girar para sempre', () => {
  it('ciclo fabricado (A→B→A) devolve erro limpo; cadeia honesta segue lendo', async () => {
    const c = await createPrivateContract(sql, { tz: 'America/Sao_Paulo' })
    const base = DateTime.utc().plus({ days: 30 }).startOf('hour')
    const cria = async (dias: number) => {
      const [i] = await sql<{ id: string }[]>`
        insert into class_instances
          (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
        values (${c.contractId}, ${c.teacherId}, ${base.plus({ days: dias }).toISO()},
                ${base.plus({ days: dias, minutes: 45 }).toISO()}, 'S4')
        returning id`
      return i.id
    }
    const a = await cria(0)
    const b = await cria(1)

    // cadeia honesta primeiro: B veio de A
    await sql`update class_instances set reschedule_of = ${a} where id = ${b}`
    const [{ tz }] = await sql<{ tz: string }[]>`select public.class_instance_tz(${b}) as tz`
    expect(tz, 'sem slot, a zona vem do aluno').toBe('America/Sao_Paulo')

    // agora o ciclo (escrita privilegiada — é o estado corrompido que se teme)
    await sql`update class_instances set reschedule_of = ${b} where id = ${a}`
    await expect(
      sql`select public.class_instance_tz(${a}) as tz`,
    ).rejects.toThrow(/cadeia de remarcação corrompida/i)
  })

  it('a detecção é por CYCLE, não por teto mágico', async () => {
    const [f] = await sql<{ src: string }[]>`
      select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'class_instance_tz'`
    expect(f.src.replace(/\s+/g, ' ')).toContain('cycle id set eh_ciclo using caminho')
    expect(f.src).not.toMatch(/passo\s*<\s*\d+/)
  })
})

/* ========================================================================== */
/* S5 — a ocupação, provada por comportamento                                  */
/* ========================================================================== */

describe('S5 · só o contrato PAUSADO é expandido a partir de recurring_slots', () => {
  it('o ativo entra pelas instâncias; o pausado, pela expansão — e cada um só uma vez', async () => {
    const ativo = await contratoCom('America/Cuiaba', 'Cuiabá do ativo S5')
    const criar = await admin.rpc('create_slot', {
      p_contract: ativo.contractId,
      p_weekday: 1,
      p_local_time: '19:00',
      p_duration_min: 45,
    })
    expect(criar.error).toBeNull()

    // pausado na MESMA professora, em outro dia (para não disputar horário)
    const pausado = await contratoCom('America/Cuiaba', 'Cuiabá do pausado S5', ativo.teacherId)
    const criarP = await admin.rpc('create_slot', {
      p_contract: pausado.contractId,
      p_weekday: 5,
      p_local_time: '19:00',
      p_duration_min: 45,
    })
    expect(criarP.error).toBeNull()
    await pausaLonga(pausado.contractId)

    const agora = DateTime.now()
    const contratos = [ativo.contractId, pausado.contractId]

    // a leitura de `recurring_slots` traz SÓ o pausado
    const expandidos = await lerSlotsPausados(admin, agora.toISODate() ?? '1970-01-01', contratos)
    expect(expandidos.map((s) => s.contract_id)).toEqual([pausado.contractId])
    expect(expandidos[0].weekday).toBe(5)

    // e a agenda materializada traz SÓ o ativo (o pausado não tem instância)
    const aulas = await lerAulasDaAgenda(admin, agora, fimDaAntecipacao(agora), contratos)
    expect(aulas.length, 'o ativo tem aulas materializadas').toBeGreaterThan(4)
    expect(
      aulas.every((a) => a.contract_id === ativo.contractId),
      'nenhuma aula do contrato pausado',
    ).toBe(true)
  })
})
