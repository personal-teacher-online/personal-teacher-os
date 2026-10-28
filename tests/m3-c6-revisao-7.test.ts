// M3-c6 — os sete achados da revisão adversarial nº 7 (Sol, 27/07/2026).
//
// O que cada bloco prova, e por quê:
//  · E1 — validade NULA não vira crédito eterno. Em SQL, `nova <= atual` com
//    NULL não é falso: é NULL, e `if NULL then` não entra. A guarda de
//    monotonicidade da revisão nº 6 era atravessada por baixo;
//  · E2 — extensão só em contrato ATIVO, e com a mesma ordem de locks do
//    pause/resume (contrato FOR UPDATE → advisory do ledger). Sem isso, uma
//    extensão manual durante a pausa cria crédito que a retomada não alcança;
//  · E3 — criação de horário fixo ATÔMICA (o motor em massa segue tolerante) e
//    antecipação por DATA CIVIL num horizonte de 8 semanas, com as aulas
//    avulsas na conta;
//  · E4 — contrato de GRUPO encerrado volta ao histórico da ficha;
//  · E5 — os créditos reservados são contados no banco, sem passar pelo teto de
//    60 aulas da ficha;
//  · E6 — o select corrigido apaga o erro (estrutural: o DOM real fica para o
//    harness do M5);
//  · E7 — a PRIMEIRA nota interna, gravada por duas pessoas ao mesmo tempo, não
//    perde elo na cadeia old→new da auditoria.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DateTime } from 'luxon'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createPrivateContract,
  createStudent,
  createTeacher,
  daysFromToday,
  julgadaDepois,
} from './helpers/db'
import { fimDaAntecipacao, janelasDaAula } from '@/lib/agenda/ocupacao-fuso'
import { janelasDoDia } from '@/lib/agenda/ocupacao'
import { contarCreditosReservados, lerContratosEncerrados } from '@/data/admin/ficha-consultas'
import { lerAulasDaAgenda } from '@/data/admin/ocupacao-consulta'

const RAIZ = path.resolve(__dirname, '..')
const corpo = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8')
/** Código SEM comentários: comentário conta o que MORREU; o que vale é o código. */
const codigo = (rel: string) =>
  corpo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const CLAIMS_ADMIN = JSON.stringify({ app_metadata: { role: 'admin' } })

let sql: Sql
let admin: SupabaseClient
let adminId: string

beforeAll(async () => {
  sql = connect(4)
  adminId = await createAuthUser(sql, 'admin', 'Admin revisão 7')
  admin = await clientAs(adminId, 'admin')
})
afterAll(async () => {
  await sql.end()
})

async function addCredit(contractId: string, expiresOn: string, dur: number | null = 45) {
  const [r] = await sql`
    insert into makeup_ledger (contract_id, delta, reason, expires_on, duration_min)
    values (${contractId}, 1, 'manual_adjust', ${expiresOn}, ${dur})
    returning id`
  return Number(r.id)
}

/** Chamada de RPC restrita à admin por conexão DIRETA: o `app_role()` lê o JWT
 *  de `request.jwt.claims`, que aqui é injetado LOCAL numa transação. */
async function comoAdmin<T>(fn: (tx: Sql) => Promise<T>, conn: Sql = sql): Promise<T> {
  return conn.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${CLAIMS_ADMIN}, true)`
    return fn(tx as unknown as Sql)
  }) as Promise<T>
}

async function pausar(contractId: string) {
  await comoAdmin((tx) => tx`select public.pause_contract(${contractId}, ${adminId})`)
}

async function linhasDoLedger(contractId: string) {
  const [r] = await sql`
    select count(*)::int as n from makeup_ledger where contract_id = ${contractId}`
  return r.n as number
}

/* ========================================================================== */
/* E1 — NULL não pode virar crédito eterno                                     */
/* ========================================================================== */

describe('E1 · validade nula é recusada (crédito sem prazo é crédito eterno)', () => {
  it('admin_extend_credit com data NULA: erro e ZERO linhas novas no ledger', async () => {
    const c = await createPrivateContract(sql)
    const id = await addCredit(c.contractId, daysFromToday(30))

    const { error } = await admin.rpc('admin_extend_credit', {
      p_ledger: id,
      p_new_expires_on: null,
      p_note: 'em branco por engano',
    })
    expect(error?.message).toContain('nova data de validade')

    // a fixture, e nada mais: o par −1/+1 não nasceu
    expect(await linhasDoLedger(c.contractId)).toBe(1)
    const [row] = await sql`select expires_on::text as e from makeup_ledger where id = ${id}`
    expect(row.e).toBe(daysFromToday(30))
  })

  it('_reissue_credit recusa a validade nula no motor, não só na porta', async () => {
    const c = await createPrivateContract(sql)
    const id = await addCredit(c.contractId, daysFromToday(30))
    await expect(
      sql`select public._reissue_credit(${id}, null::date, ${adminId}, 'direto no motor')`,
    ).rejects.toThrow(/validade nova|sem prazo/i)
    expect(await linhasDoLedger(c.contractId)).toBe(1)
  })

  it('o revival da PAUSA continua intacto (ele passa validade calculada, nunca nula)', async () => {
    const c = await createPrivateContract(sql)
    await addCredit(c.contractId, daysFromToday(30))
    await pausar(c.contractId)
    // retomada 10 dias depois: o crédito é relançado com +10 dias
    const [r] = await comoAdmin(
      (tx) =>
        tx`select public.resume_contract(${c.contractId}, ${adminId}, ${daysFromToday(10)}::date) as n`,
    )
    expect(Number(r.n)).toBe(1)
    const [novo] = await sql`
      select expires_on::text as e from makeup_ledger
      where contract_id = ${c.contractId} and delta = 1 order by id desc limit 1`
    expect(novo.e).toBe(daysFromToday(40))
  })
})

/* ========================================================================== */
/* E2 — extensão só em contrato ATIVO, com ordem de lock correta               */
/* ========================================================================== */

describe('E2 · estender exige contrato ativo', () => {
  it('contrato PAUSADO: recusa nomeando a retomada, e nada entra no ledger', async () => {
    const c = await createPrivateContract(sql)
    const id = await addCredit(c.contractId, daysFromToday(30))
    await pausar(c.contractId)

    const { error } = await admin.rpc('admin_extend_credit', {
      p_ledger: id,
      p_new_expires_on: daysFromToday(60),
      p_note: 'estender durante a pausa',
    })
    expect(error?.message).toContain('contrato pausado')
    expect(error?.message).toContain('RETOMADA')
    expect(await linhasDoLedger(c.contractId)).toBe(1)
  })

  it('contrato ENCERRADO: recusa', async () => {
    const c = await createPrivateContract(sql)
    const id = await addCredit(c.contractId, daysFromToday(30))
    await sql`update contracts set status = 'ended', ended_on = public.business_today()
              where id = ${c.contractId}`

    const { error } = await admin.rpc('admin_extend_credit', {
      p_ledger: id,
      p_new_expires_on: daysFromToday(60),
      p_note: 'estender contrato morto',
    })
    expect(error?.message).toContain('encerrado')
    expect(await linhasDoLedger(c.contractId)).toBe(1)
  })

  it('corrida extensão × pausa: a extensão ESPERA o lock do contrato e então recusa', async () => {
    const c = await createPrivateContract(sql)
    const id = await addCredit(c.contractId, daysFromToday(30))

    const conn1 = connect(1)
    const conn2 = connect(1)
    let soltar: () => void = () => {}
    const solta = new Promise<void>((r) => (soltar = r))
    let pausou: () => void = () => {}
    const jaPausou = new Promise<void>((r) => (pausou = r))

    try {
      // T1: pausa o contrato e SEGURA a transação aberta (linha de contracts
      // travada por FOR UPDATE).
      const t1 = conn1.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${CLAIMS_ADMIN}, true)`
        await tx`select public.pause_contract(${c.contractId}, ${adminId})`
        pausou()
        await solta
      })
      await jaPausou

      // T2: a extensão. Com a ordem de locks certa ela BLOQUEIA aqui — sem o
      // `for update` em contracts ela passaria direto, leria o status antigo
      // ('active') e criaria um crédito fora do congelamento.
      await conn2`select set_config('request.jwt.claims', ${CLAIMS_ADMIN}, false)`
      let terminou = false
      const extensao = julgadaDepois(
        conn2`
        select public.admin_extend_credit(${id}, ${daysFromToday(60)}::date, 'corrida', ${adminId})`.then(
          (r) => {
            terminou = true
            return r
          },
          (e) => {
            terminou = true
            throw e
          },
        ),
      )
      await new Promise((r) => setTimeout(r, 500))
      expect(terminou, 'a extensão passou por cima do lock do contrato').toBe(false)

      soltar()
      await t1
      await expect(extensao).rejects.toThrow(/contrato pausado/)
      // e nada de deadlock: quem esperou, esperou até o fim
      await expect(extensao).rejects.not.toThrow(/deadlock/i)
      expect(await linhasDoLedger(c.contractId)).toBe(1)
    } finally {
      soltar()
      await conn1.end()
      await conn2.end()
    }
  })

  it('a ficha esconde o lápis quando o contrato do crédito não está ativo', () => {
    const dados = codigo('src/data/admin/ficha.ts')
    expect(dados).toContain("podeEstender: c.status === 'active'")
    expect(dados).toContain('extensivel: c.podeEstender')
    // e o painel `?painel=estender` continua fechando a porta pelo mesmo campo
    expect(codigo('src/components/admin/alunos/ficha/paineis.tsx')).toContain(
      '!credito.extensivel',
    )
  })
})

/* ========================================================================== */
/* E3a — criação de horário fixo ATÔMICA                                       */
/* ========================================================================== */

describe('E3a · create_slot é atômico; a materialização em massa segue tolerante', () => {
  async function contratoDaProfessora(teacherId: string, tz = 'America/Cuiaba') {
    const studentId = await createStudent(sql, tz)
    const [c] = await sql`
      insert into contracts
        (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${studentId}, ${teacherId}, 'teste E3', 15000, 4, 24, 90,
              public.business_today())
      returning id`
    return c.id as string
  }

  it('horário conflitante: erro nomeando o dia, e ZERO slot/instância órfã', async () => {
    const teacher = await createTeacher(sql)
    const primeiro = await contratoDaProfessora(teacher)
    const segundo = await contratoDaProfessora(teacher)

    const ok = await admin.rpc('create_slot', {
      p_contract: primeiro,
      p_weekday: 3,
      p_local_time: '09:00',
      p_duration_min: 45,
      p_active_from: daysFromToday(21),
    })
    expect(ok.error).toBeNull()
    const [{ n: criadas }] = await sql`
      select count(*)::int as n from class_instances where slot_id = ${ok.data as string}`
    expect(criadas).toBeGreaterThan(0)

    // mesma professora, mesmo dia, mesma hora: o banco recusa a PRIMEIRA
    // ocorrência e a transação inteira volta.
    const choque = await admin.rpc('create_slot', {
      p_contract: segundo,
      p_weekday: 3,
      p_local_time: '09:00',
      p_duration_min: 45,
      p_active_from: daysFromToday(21),
    })
    expect(choque.error?.message).toContain('já tem aula em')
    expect(choque.error?.message).toContain('NÃO foi criado')

    const [{ n: slots }] = await sql`
      select count(*)::int as n from recurring_slots where contract_id = ${segundo}`
    expect(slots, 'o slot recusado não pode ficar no banco').toBe(0)
    const [{ n: orfas }] = await sql`
      select count(*)::int as n from class_instances where contract_id = ${segundo}`
    expect(orfas, 'instância órfã de um slot que não existe').toBe(0)
  })

  it('o caminho em MASSA (p_strict default) continua pulando o conflito e registrando', async () => {
    const teacher = await createTeacher(sql)
    const primeiro = await contratoDaProfessora(teacher)
    const segundo = await contratoDaProfessora(teacher)

    const ok = await admin.rpc('create_slot', {
      p_contract: primeiro,
      p_weekday: 4,
      p_local_time: '14:00',
      p_duration_min: 45,
      p_active_from: daysFromToday(21),
    })
    expect(ok.error).toBeNull()

    // slot conflitante inserido DIRETO (sem passar por create_slot), como o
    // cron encontraria um resíduo: a materialização em massa não estoura.
    const [s] = await sql`
      insert into recurring_slots
        (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from)
      values (${segundo}, ${teacher}, 4, '14:00', 'America/Cuiaba', 45, ${daysFromToday(21)})
      returning id`
    const [r] = await sql`select public.materialize_slot(${s.id}, 8) as n`
    expect(Number(r.n), 'nenhuma ocorrência cabe — todas colidem').toBe(0)
    const [{ n: registrados }] = await sql`
      select count(*)::int as n from audit_log
      where action = 'materialize_conflict' and entity_id = ${String(s.id)}`
    expect(registrados, 'o conflito em massa tem de ficar visível (Lei 8)').toBeGreaterThan(0)
  })

  it('a action do wizard humaniza o que escapa da antecipação', () => {
    const acoes = codigo('src/app/admin/alunos/novo/actions.ts')
    // ATUALIZADO NO M4-4 (mesma razão do aceite irmão em `m3-c4-formularios`):
    // a admissão não tem mais laço de `create_slot`, e sim UMA chamada de
    // `admin_create_contract`. O erro que se humaniza é o dela.
    expect(acoes).toContain('erroDeHorarioEmGente(error?.message')
  })
})

/* ========================================================================== */
/* E3b — antecipação por DATA CIVIL, 8 semanas, com as avulsas                 */
/* ========================================================================== */

describe('E3b · a aula avulsa vira janela do dia dela (conversão pura)', () => {
  // A EXPANSÃO do horário fixo em Luxon (`janelasDoSlot`) morreu no P9 da
  // revisão nº 8: a antecipação passou a ler as `class_instances` que o banco
  // JÁ materializou, que é a única verdade sobre DST, vigência e horizonte. Os
  // casos exatos de DST (New York 01/11, Lisboa 25/10), a faixa dupla, a hora
  // AMBÍGUA, o limite dos 56 dias e a troca futura de horário estão provados
  // sobre o mecanismo novo em tests/m3-c7-revisao-8.test.ts.
  //
  // O que fica aqui é a peça que sobreviveu inteira: a conversão de UMA aula
  // avulsa para o relógio do aluno novo.
  it('a aula AVULSA vira janela do dia dela, com a data no rótulo', () => {
    const j = janelasDaAula(
      {
        teacher_id: 'dona',
        starts_at_utc: '2026-08-05T13:00:00Z',
        ends_at_utc: '2026-08-05T13:45:00Z',
      },
      'America/Cuiaba',
      'Ana',
    )
    expect(j).toHaveLength(1)
    expect(j[0].weekday).toBe(3) // quarta
    expect(j[0].inicio).toBe(9 * 60) // 13:00Z = 09:00 em Cuiabá
    expect(j[0].texto).toBe('09:00–09:45')
    expect(j[0].quem).toBe('Ana · aula avulsa em 05/08')
  })

  it('a janela que atravessa a meia-noite continua partida em dois dias', () => {
    const j = janelasDaAula(
      {
        teacher_id: 'noturna',
        starts_at_utc: '2026-07-04T03:30:00Z', // 23:30 de sexta em Cuiabá
        ends_at_utc: '2026-07-04T04:30:00Z',
      },
      'America/Cuiaba',
      'Noturno',
    )
    expect(j.map((x) => x.weekday)).toEqual([5, 6])
    expect(j[1].inicio).toBe(0)
    expect(j[1].fim).toBe(30)
  })
})

describe('E3b · a leitura da ocupação alcança a aula avulsa (contra o banco)', () => {
  // A ocupação inteira (`lerOcupacao`) lê a ESCOLA toda — na bancada
  // compartilhada, com centenas de fixtures acumuladas, a URL do PostgREST
  // estoura antes de a asserção começar. O que se prova aqui, então, é a peça
  // determinística: a consulta que traz as avulsas, recortada pelos ids do
  // contrato de teste — o mesmo código que `lerOcupacao` chama.
  it('traz a avulsa futura e ignora a que veio de slot, a passada e a cancelada', async () => {
    const teacher = await createTeacher(sql)
    const studentId = await createStudent(sql, 'America/Cuiaba')
    const [c] = await sql`
      insert into contracts
        (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${studentId}, ${teacher}, 'teste avulsa', 15000, 4, 24, 90,
              public.business_today())
      returning id`
    const contratoId = c.id as string

    const instancia = async (
      horas: number,
      opts: { state?: string; comSlot?: boolean } = {},
    ) => {
      let slotId: string | null = null
      if (opts.comSlot) {
        const [s] = await sql`
          insert into recurring_slots
            (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from)
          values (${contratoId}, ${teacher}, 1, '07:00', 'America/Cuiaba', 45,
                  public.business_today())
          returning id`
        slotId = s.id as string
      }
      const [i] = await sql`
        insert into class_instances
          (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
           local_time_snapshot, state)
        values (${contratoId}, ${teacher}, ${slotId},
                ${slotId ? sql`(now() + make_interval(hours => ${horas}))::date` : null},
                now() + make_interval(hours => ${horas}),
                now() + make_interval(hours => ${horas}, mins => 45),
                'fixture E3b', ${opts.state ?? 'scheduled'}::class_state)
        returning id, starts_at_utc`
      return i
    }

    const avulsaFutura = await instancia(240)
    const comSlot = await instancia(300, { comSlot: true })
    await instancia(-240, { state: 'completed' }) // passada
    await instancia(360, { state: 'cancelled' }) // não vai acontecer
    await instancia(24 * 7 * 20) // fora do horizonte de 8 semanas

    const agora = DateTime.now()
    const achadas = await lerAulasDaAgenda(admin, agora, fimDaAntecipacao(agora), [contratoId])
    // P9 da revisão nº 8: a leitura passou a trazer as DUAS (a avulsa e a que
    // veio de slot) — é ela que substituiu a expansão de `recurring_slots`. O
    // que continua fora é o que não vai acontecer e o que está fora do horizonte.
    expect(achadas.map((a) => a.starts_at_utc).sort()).toHaveLength(2)
    expect(achadas.filter((a) => a.slot_id === null)).toHaveLength(1)
    expect(achadas.every((a) => a.teacher_id === teacher)).toBe(true)
    expect(String(comSlot.id)).toBeTruthy()

    // e a avulsa vira janela do dia/hora certos, no relógio pedido
    const comeco = DateTime.fromJSDate(avulsaFutura.starts_at_utc as Date).setZone('America/Cuiaba')
    const janelas = achadas
      .filter((a) => a.slot_id === null)
      .flatMap((a) => janelasDaAula(a, 'America/Cuiaba', 'Aluna da avulsa'))
    const doDia = janelasDoDia(janelas, teacher, comeco.weekday % 7)
    expect(doDia.map((x) => x.inicio)).toContain(comeco.hour * 60 + comeco.minute)
    expect(doDia[0].quem).toContain('aula avulsa em')
  })

  // O caso que ficava AQUI provava por GREP que a ocupação lê a agenda
  // materializada e que a única expansão de `recurring_slots` é a do contrato
  // pausado — asserção frágil (renomear uma variável a derrubava, e reescrever
  // a consulta com o mesmo defeito a mantinha verde). Substituído no c9 · S5
  // por um caso COMPORTAMENTAL contra o banco (`m3-c9-revisao-10.test.ts`):
  // contrato ativo e contrato pausado na mesma professora, e prova-se que o
  // ativo entra pelas instâncias e só o pausado é expandido.
  it('a agenda lida traz só o que ainda vai acontecer (recorte da consulta)', () => {
    const fonte = codigo('src/data/admin/ocupacao-consulta.ts')
    const aulas = fonte.slice(fonte.indexOf('export async function lerAulasDaAgenda'))
    expect(aulas).toContain("eq('state', 'scheduled')")
    expect(aulas).toContain("gte('starts_at_utc'")
    expect(aulas).toContain("lte('starts_at_utc'")
  })
})

/* ========================================================================== */
/* E4 — grupo encerrado no histórico                                           */
/* ========================================================================== */

describe('E4 · o contrato de GRUPO encerrado volta à ficha dos membros', () => {
  it('encerrado de casal aparece para os dois alunos, com aula, cobrança e ledger', async () => {
    const a = await createStudent(sql, 'America/Sao_Paulo')
    const b = await createStudent(sql, 'America/Cuiaba')
    const teacher = await createTeacher(sql)
    const [g] = await sql`insert into student_groups (label) values ('Casal E4') returning id`
    await sql`insert into student_group_members (group_id, student_id)
              values (${g.id}, ${a}), (${g.id}, ${b})`
    const [c] = await sql`
      insert into contracts
        (contract_type, student_group_id, teacher_id, plan_name, hourly_rate_cents,
         monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days,
         started_on, ended_on, status, group_tz_anchor_student)
      values ('private_1on1', ${g.id}, ${teacher}, 'casal encerrado', 15000, 4, 24, 90,
              public.business_today() - 400, public.business_today() - 10, 'ended', ${a})
      returning id`

    const [aula] = await sql`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot, state)
      values (${c.id}, ${teacher}, now() - interval '30 days',
              now() - interval '30 days' + interval '45 minutes', 'fixture E4', 'completed')
      returning id`
    await sql`
      insert into payments (asaas_payment_id, contract_id, amount_cents, status, due_date, reference_ym)
      values (${'pay_e4_' + crypto.randomUUID().slice(0, 8)}, ${c.id}, 30000, 'paid',
              public.business_today() - 40, '2026-06')`
    await sql`
      insert into makeup_ledger (contract_id, delta, reason, expires_on, duration_min)
      values (${c.id}, 1, 'manual_adjust', public.business_today() - 5, 45)`

    for (const membro of [a, b]) {
      const r = await lerContratosEncerrados(admin, membro)
      expect(r.error, `membro ${membro}: ${r.error?.message ?? ''}`).toBeNull()
      const ids = (r.data ?? []).map((x) => x.id)
      expect(ids, 'o contrato de grupo encerrado sumiu da ficha').toContain(c.id)
    }

    // e o histórico daquele contrato está alcançável pelos ids devolvidos
    const encerrados = (await lerContratosEncerrados(admin, a)).data ?? []
    const ids = encerrados.map((x) => x.id)
    const aulas = await admin.from('class_instances').select('id').in('contract_id', ids)
    expect((aulas.data ?? []).map((x) => x.id)).toContain(aula.id)
    const cobrancas = await admin.from('payments').select('id').in('contract_id', ids)
    expect((cobrancas.data ?? []).length).toBeGreaterThan(0)
    const ledger = await admin.from('makeup_ledger').select('id').in('contract_id', ids)
    expect((ledger.data ?? []).length).toBeGreaterThan(0)
  })

  it('o vínculo DIRETO continua funcionando, e contrato vivo não entra', async () => {
    const c = await createPrivateContract(sql)
    const vivo = await lerContratosEncerrados(admin, c.studentId)
    expect((vivo.data ?? []).map((x) => x.id)).not.toContain(c.contractId)

    await sql`update contracts set status = 'ended', ended_on = public.business_today()
              where id = ${c.contractId}`
    const morto = await lerContratosEncerrados(admin, c.studentId)
    expect((morto.data ?? []).map((x) => x.id)).toContain(c.contractId)
  })
})

/* ========================================================================== */
/* E5 — agendados sem depender do teto                                         */
/* ========================================================================== */

describe('E5 · os créditos reservados são contados no banco', () => {
  it('conta as 65 reposições futuras — a coleção da ficha para em 60', async () => {
    const c = await createPrivateContract(sql)
    const total = 65
    // Em DUAS instruções, e não em 130 idas ao banco: a bancada é compartilhada
    // e a suíte roda em paralelo — arquivo lento é arquivo que atrapalha os
    // vizinhos. As aulas ficam 40 dias à frente (fora da semana corrente, que é
    // o que o KPI `aulas_da_semana` de outro arquivo mede).
    await sql`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      select ${c.contractId}, ${c.teacherId},
             now() + make_interval(hours => 24 * 40 + i * 2),
             now() + make_interval(hours => 24 * 40 + i * 2, mins => 45),
             'fixture E5'
        from generate_series(0, ${total - 1}) as i`
    await sql`
      insert into makeup_ledger (contract_id, delta, reason, class_instance_id)
      select ${c.contractId}, -1, 'spend_reschedule', ci.id
        from class_instances ci
       where ci.contract_id = ${c.contractId}`

    const r = await contarCreditosReservados(admin, [c.contractId])
    expect(r.error).toBeNull()
    expect(r.data, 'a contagem parou no teto da coleção').toBe(total)
  })

  it('aula passada, cancelada ou de outro contrato não conta como reservada', async () => {
    const c = await createPrivateContract(sql)
    const outro = await createPrivateContract(sql)

    const gasto = async (
      contrato: { contractId: string; teacherId: string },
      horas: number,
      state = 'scheduled',
    ) => {
      const [inst] = await sql`
        insert into class_instances
          (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot, state)
        values (${contrato.contractId}, ${contrato.teacherId},
                now() + make_interval(hours => ${horas}),
                now() + make_interval(hours => ${horas}, mins => 45),
                'fixture E5b', ${state}::class_state)
        returning id`
      await sql`
        insert into makeup_ledger (contract_id, delta, reason, class_instance_id)
        values (${contrato.contractId}, -1, 'spend_reschedule', ${inst.id})`
    }

    await gasto(c, 24 * 40) // vale
    await gasto(c, -48, 'completed') // já aconteceu
    await gasto(c, 24 * 41, 'cancelled') // não vai acontecer
    await gasto(outro, 24 * 42) // é de outro contrato

    const r = await contarCreditosReservados(admin, [c.contractId])
    expect(r.data).toBe(1)
    expect((await contarCreditosReservados(admin, [])).data).toBe(0)
  })

  it('a ficha usa a consulta do banco, não a lista de aulas cortada', () => {
    const dados = codigo('src/data/admin/ficha.ts')
    expect(dados).toContain('contarCreditosReservados(supabase, ids')
    expect(dados).not.toContain('futurasAgendadas')
  })
})

/* ========================================================================== */
/* E6 — o select corrigido apaga o erro                                        */
/* ========================================================================== */

describe('E6 · o erro some quando o select é corrigido (estrutura)', () => {
  // O DOM real fica para o harness do M5 (o Vitest roda em `node` e o repo não
  // tem harness de eventos). O que dá para provar sem teatro é que os dois
  // caminhos existem no componente.
  const FONTE = codigo('src/components/kit/form-validado.tsx')

  it('o form escuta `change` além de `input`, com o MESMO tratamento', () => {
    expect(FONTE).toContain('onInput={(e) => corrigiu(e.target)}')
    expect(FONTE).toContain('onChange={(e) => corrigiu(e.target)}')
    expect(FONTE).toContain('function corrigiu(alvo: EventTarget | null)')
  })

  it('ao validar de novo, quem está com erro ACESO é reconferido', () => {
    const submit = FONTE.slice(FONTE.indexOf('onSubmit={'), FONTE.indexOf('onBlur={'))
    expect(submit).toContain("el.getAttribute('data-erro') === 'sim'")
    expect(submit).toContain('conferir(el)')
    // e a reconferência vem ANTES de decidir quem é inválido
    expect(submit.indexOf('conferir(el)')).toBeLessThan(submit.indexOf('const invalidos'))
  })

  it('o gatilho visível do Select continua sendo pintado e despintado', () => {
    expect(FONTE).toContain("noDe(el)?.querySelector(SLOT_GATILHO)?.setAttribute('data-erro', 'sim')")
    expect(FONTE).toContain("noDe(el)?.querySelector(SLOT_GATILHO)?.removeAttribute('data-erro')")
  })
})

/* ========================================================================== */
/* E7 — primeira nota sem perder versão                                        */
/* ========================================================================== */

describe('E7 · duas primeiras gravações concorrentes da nota interna', () => {
  it('a cadeia old→new da auditoria fica íntegra (uma só entrada com old=null)', async () => {
    const studentId = await createStudent(sql)

    const conn1 = connect(1)
    const conn2 = connect(1)
    let soltar: () => void = () => {}
    const solta = new Promise<void>((r) => (soltar = r))
    let gravou: () => void = () => {}
    const jaGravou = new Promise<void>((r) => (gravou = r))

    try {
      const t1 = conn1.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${CLAIMS_ADMIN}, true)`
        await tx`select public.admin_set_student_note(${studentId}, 'primeira')`
        gravou()
        await solta
      })
      await jaGravou

      await conn2`select set_config('request.jwt.claims', ${CLAIMS_ADMIN}, false)`
      let terminou = false
      const segunda = julgadaDepois(
        conn2`select public.admin_set_student_note(${studentId}, 'segunda')`.then(
          (r) => {
            terminou = true
            return r
          },
          (e) => {
            terminou = true
            throw e
          },
        ),
      )
      await new Promise((r) => setTimeout(r, 500))
      expect(terminou, 'a segunda gravação leu a nota sem esperar a primeira').toBe(false)

      soltar()
      await t1
      await segunda

      const auditoria = await sql`
        select diff from audit_log
        where action = 'set_student_note' and entity_id = ${studentId}::text
        order by id`
      expect(auditoria).toHaveLength(2)
      expect(auditoria[0].diff).toEqual({ old: null, new: 'primeira' })
      expect(auditoria[1].diff).toEqual({ old: 'primeira', new: 'segunda' })

      const [nota] = await sql`select note from student_notes where student_id = ${studentId}`
      expect(nota.note).toBe('segunda')
    } finally {
      soltar()
      await conn1.end()
      await conn2.end()
    }
  })

  it('aluno inexistente continua sendo recusado', async () => {
    const { error } = await admin.rpc('admin_set_student_note', {
      p_student: '00000000-0000-0000-0000-000000000000',
      p_note: 'ninguém',
    })
    expect(error?.message).toContain('não existe')
  })
})
