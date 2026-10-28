// O PREVIEW BATE COM O EFEITO REAL (Onda do Portal · P4).
//
// A tela promete ao aluno o que vai acontecer se ele remarcar ou cancelar AGORA
// (D4). A promessa só vale se ela vier da mesma régua que a escrita aplica — e é
// isso que este arquivo cobra, cenário por cenário da matriz D1/D2: para cada
// caso, o preview é lido ANTES e o efeito REAL é executado DEPOIS, com o
// `audit_log`/ledger dizendo o que de fato aconteceu.
//
// Vai junto o histórico (`student_class_history`): quem cancelou, se o aviso
// veio fora do prazo e se nasceu reposição — os três fatos que viram frase de
// gente em `estadoDaAula`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { estadoDaAula } from '@/lib/portal/aulas'
import { historicoDeAulas, previewDeCancelamento, previewDeRemarcacao } from '@/lib/portal/data'
import { clientAs, createAuthUser } from './helpers/auth'
import {
  connect,
  createInstance,
  createPrivateContract,
  daysFromToday,
  instanteEm,
} from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin P4'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

async function studentLogin(opts: Parameters<typeof createPrivateContract>[1] = {}) {
  const c = await createPrivateContract(sql, opts)
  const userId = await createAuthUser(sql, 'student', 'Aluno P4')
  await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
  return { ...c, userId, client: await clientAs(userId, 'student') }
}

async function publish(teacherId: string, daysAhead: number, time: string) {
  const { data, error } = await admin.rpc('publish_reschedule_window', {
    p_teacher: teacherId,
    p_starts_at_utc: instanteEm(daysFromToday(daysAhead), time),
  })
  expect(error).toBeNull()
  return data as string
}

/** O `via` que a remarcação REALMENTE usou — escrito por `reschedule_class_at`. */
async function viaDaRemarcacao(instanceId: string): Promise<string | null> {
  const [row] = await sql<{ via: string }[]>`
    select diff ->> 'via' as via
      from audit_log
     where action = 'reschedule_class'
       and diff ->> 'rescheduled_from' = ${instanceId}
     order by id desc
     limit 1`
  return row?.via ?? null
}

/** O que o preview promete → o que a escrita faz. */
const VIA_DO_EFEITO: Record<string, string> = { franquia: 'allowance', credito: 'makeup_credit' }

/** O saldo de reposições do contrato, contado pelo BANCO. */
async function saldo(contractId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select public.makeup_balance(${contractId})::int as n`
  return row.n
}

/** O diff da última linha de audit de um desfecho de aula. */
async function auditDaAula(instanceId: string): Promise<Record<string, unknown> | null> {
  const [row] = await sql<{ diff: Record<string, unknown> }[]>`
    select diff from audit_log
     where entity = 'class_instances' and entity_id = ${instanceId}
       and action in ('cancel_class', 'no_show_student', 'no_show_teacher')
     order by id desc limit 1`
  return row?.diff ?? null
}

/** Quantos lançamentos o ledger do contrato tem (ADR-018: cancelar não move). */
async function lancamentosNoLedger(contractId: string): Promise<number> {
  const [row] = await sql<{ n: string }[]>`
    select count(*)::text as n from makeup_ledger where contract_id = ${contractId}`
  return Number(row.n)
}

describe('preview_reschedule_effect — a promessa e o ato', () => {
  it('dentro do aviso e com franquia: o preview diz "franquia" e a remarcação usa a franquia', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 72 })

    const pv = await previewDeRemarcacao(s.client, inst)
    expect(pv.erro).toBe(false)
    expect(pv.dado?.efeito).toBe('franquia')
    expect(pv.dado?.franquiaRestante).toBe(4)
    expect(pv.dado?.validadeDoCredito).toBeNull()

    const win = await publish(s.teacherId, 6, '10:00')
    const { error } = await s.client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    expect(error).toBeNull()
    expect(await viaDaRemarcacao(inst)).toBe(VIA_DO_EFEITO.franquia)
  })

  it('franquia esgotada e com crédito: o preview diz "credito", com a validade do crédito que sai', async () => {
    const s = await studentLogin({ allowance: 0, minNotice: 24 })
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(45)})`
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(20)})`
    const inst = await createInstance(sql, s, { startsInHours: 72 })

    const pv = await previewDeRemarcacao(s.client, inst)
    expect(pv.dado?.efeito).toBe('credito')
    expect(pv.dado?.franquiaRestante).toBe(0)
    expect(pv.dado?.saldoCreditos).toBe(2)
    // O FIFO gasta o que vence primeiro — é essa a validade anunciada.
    expect(pv.dado?.validadeDoCredito).toBe(daysFromToday(20))

    const win = await publish(s.teacherId, 6, '11:00')
    const { error } = await s.client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    expect(error).toBeNull()
    expect(await viaDaRemarcacao(inst)).toBe(VIA_DO_EFEITO.credito)
    const [saldo] = await sql<{ n: number }[]>`select public.makeup_balance(${s.contractId})::int as n`
    expect(saldo.n).toBe(1)
  })

  it('franquia E crédito disponíveis: a franquia tem precedência e o saldo fica INTACTO', async () => {
    // A ordem das decisões é a da função de escrita. Se o preview trocasse a
    // ordem, ele anunciaria um gasto de crédito que a escrita não faz — ou, pior,
    // o contrário. Aqui os dois recursos existem, e só um pode ser tocado.
    const s = await studentLogin({ allowance: 2, minNotice: 24 })
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    const inst = await createInstance(sql, s, { startsInHours: 72 })

    const pv = await previewDeRemarcacao(s.client, inst)
    expect(pv.dado?.efeito).toBe('franquia')
    expect(pv.dado?.franquiaRestante).toBe(2)
    expect(pv.dado?.saldoCreditos).toBe(1)
    // A validade só é anunciada quando o crédito É o caminho — aqui não é.
    expect(pv.dado?.validadeDoCredito).toBeNull()

    const win = await publish(s.teacherId, 6, '10:30')
    expect((await s.client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })).error).toBeNull()
    expect(await viaDaRemarcacao(inst)).toBe(VIA_DO_EFEITO.franquia)
    expect(await saldo(s.contractId)).toBe(1) // o crédito não foi tocado
  })

  it('aviso vencido vence a franquia E o crédito: quem manda é a ordem da escrita', async () => {
    // Franquia zerada, crédito na mão — mas a aula está dentro do aviso mínimo.
    // A recusa por antecedência vem ANTES de qualquer conta de saldo, nas duas
    // pontas: o preview diz 'fora_do_aviso' (não 'credito'), e a escrita recusa
    // pelo mesmo motivo, sem gastar nada.
    const s = await studentLogin({ allowance: 0, minNotice: 24 })
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog', ${daysFromToday(30)})`
    const inst = await createInstance(sql, s, { startsInHours: 2 })

    const pv = await previewDeRemarcacao(s.client, inst)
    expect(pv.dado?.efeito).toBe('fora_do_aviso')
    expect(pv.dado?.saldoCreditos).toBe(1)

    const win = await publish(s.teacherId, 6, '10:45')
    const { error } = await s.client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    expect(error?.message ?? '').toContain('aviso mínimo')
    expect(await saldo(s.contractId)).toBe(1)
  })

  it('sem franquia e sem crédito: o preview diz "sem_saldo" e o banco RECUSA', async () => {
    const s = await studentLogin({ allowance: 0, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 72 })

    expect((await previewDeRemarcacao(s.client, inst)).dado?.efeito).toBe('sem_saldo')

    const win = await publish(s.teacherId, 6, '12:00')
    const { error } = await s.client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    expect(error?.message ?? '').toContain('saldo')
    const [row] = await sql<{ state: string }[]>`select state from class_instances where id = ${inst}`
    expect(row.state).toBe('scheduled')
  })

  it('fora do aviso mínimo: o preview diz "fora_do_aviso" e o banco RECUSA pelo mesmo motivo', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 2 })

    const pv = await previewDeRemarcacao(s.client, inst)
    expect(pv.dado?.efeito).toBe('fora_do_aviso')
    expect(pv.dado?.minNoticeHours).toBe(24)

    const win = await publish(s.teacherId, 6, '13:00')
    const { error } = await s.client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    expect(error?.message ?? '').toContain('aviso mínimo')
  })

  it('contrato PAUSADO: o preview diz "contrato_inativo" — e a recusa afirma a FRASE', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 72 })
    const win = await publish(s.teacherId, 6, '14:00')
    expect((await admin.rpc('pause_contract', { p_contract: s.contractId })).error).toBeNull()

    expect((await previewDeRemarcacao(s.client, inst)).dado?.efeito).toBe('contrato_inativo')
    const { error } = await s.client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    // "qualquer erro" passaria com um erro de digitação no nome da RPC. A recusa
    // que interessa é a do CONTRATO — e é essa frase que o preview espelha.
    expect(error?.message ?? '').toContain('não está ativo')
  })

  it('contrato que NÃO é particular 1:1: "nao_remarcavel"/"nao_cancelavel" nas duas pontas', async () => {
    // O contrato nasce mentoria (o tipo é IMUTÁVEL por gatilho desde o c15 —
    // nem o dono da tabela troca). O que se prova é que as duas telas do P4
    // classificam a recusa que o banco de fato dá.
    const [aluno] = await sql`insert into students (display_name, iana_tz, tz_confirmed)
                              values ('Mentorado P4', 'America/Cuiaba', true) returning id`
    const [prof] = await sql`insert into teachers (hourly_rate_cents) values (10000) returning id`
    const [c] = await sql`
      insert into contracts (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
                             monthly_reschedule_allowance, min_notice_hours,
                             makeup_credit_expiry_days, started_on)
      values ('mentorship', ${aluno.id}, ${prof.id}, 'mentoria P4', 7000, 2, 24, 90,
              public.business_today())
      returning id`
    const userId = await createAuthUser(sql, 'student', 'Mentorado P4')
    await sql`update students set profile_id = ${userId} where id = ${aluno.id}`
    const cliente = await clientAs(userId, 'student')
    const inst = await createInstance(sql, { contractId: c.id as string, teacherId: prof.id as string }, {
      startsInHours: 72,
    })
    const win = await publish(prof.id as string, 6, '14:15')

    expect((await previewDeRemarcacao(cliente, inst)).dado?.efeito).toBe('nao_remarcavel')
    expect((await previewDeCancelamento(cliente, inst)).dado?.efeito).toBe('nao_cancelavel')
    const { error } = await cliente.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    expect(error?.message ?? '').toContain('private_1on1')
    const cancelou = await cliente.rpc('cancel_my_class', { p_instance: inst })
    expect(cancelou.error?.message ?? '').toContain('private_1on1')
  })

  it('contrato de CASAL (grupo): o membro lê o preview da aula do contrato dele', async () => {
    // Contrato de grupo não tem `student_id` (ADR-002) — a posse vem de
    // `my_contract_ids()` pelos MEMBROS. Se o preview tivesse copiado a régua
    // por `student_id`, o casal inteiro veria "aula não encontrada" na própria
    // aula. E o fuso da instância também sai do grupo (class_instance_tz).
    const [a] = await sql`insert into students (display_name, iana_tz, tz_confirmed)
                          values ('Casal A P4', 'America/Cuiaba', true) returning id`
    const [b] = await sql`insert into students (display_name, iana_tz, tz_confirmed)
                          values ('Casal B P4', 'America/Cuiaba', true) returning id`
    const [g] = await sql`insert into student_groups (label) values ('Casal P4') returning id`
    await sql`insert into student_group_members (group_id, student_id)
              values (${g.id}, ${a.id}), (${g.id}, ${b.id})`
    const [t] = await sql`insert into teachers (hourly_rate_cents) values (10000) returning id`
    const [c] = await sql`
      insert into contracts (contract_type, student_group_id, teacher_id, plan_name,
                             hourly_rate_cents, monthly_reschedule_allowance, min_notice_hours,
                             makeup_credit_expiry_days, started_on)
      values ('private_1on1', ${g.id}, ${t.id}, 'casal P4', 15000, 3, 24, 90, public.business_today())
      returning id`
    const userA = await createAuthUser(sql, 'student', 'Casal A P4')
    await sql`update students set profile_id = ${userA} where id = ${a.id}`
    const clienteA = await clientAs(userA, 'student')
    const inst = await createInstance(sql, { contractId: c.id as string, teacherId: t.id as string }, {
      startsInHours: 72,
    })

    const pv = await previewDeRemarcacao(clienteA, inst)
    expect(pv.erro).toBe(false)
    expect(pv.dado?.efeito).toBe('franquia')
    expect(pv.dado?.franquiaRestante).toBe(3)
    expect((await previewDeCancelamento(clienteA, inst)).dado?.efeito).toBe('sem_reposicao')
  })

  it('aula nascida de RESGATE (sem slot e sem data de ocorrência) é classificada igual', async () => {
    // A instância do resgate não tem `slot_id` nem `occurrence_date`: o período
    // da franquia cai no ramo de fallback (`starts_at_utc` na zona da instância).
    // Se esse ramo estivesse errado, a franquia seria contada no mês errado.
    const s = await studentLogin({ allowance: 2, minNotice: 24 })
    // O crédito precisa de DURAÇÃO: sem ela e sem slot ativo, o resgate é
    // recusado (`contrato … não tem duração para o resgate`).
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog',
                                        ${daysFromToday(60)}, null, null, null, 45)`
    const win = await publish(s.teacherId, 5, '16:00')
    const { data: resgatada, error } = await s.client.rpc('book_reschedule_window', {
      p_window: win,
      p_contract: s.contractId,
    })
    expect(error).toBeNull()

    const [linha] = await sql<{ slot_id: string | null; occurrence_date: string | null }[]>`
      select slot_id, occurrence_date from class_instances where id = ${String(resgatada)}`
    expect(linha.slot_id).toBeNull()
    expect(linha.occurrence_date).toBeNull()

    const pv = await previewDeRemarcacao(s.client, String(resgatada))
    expect(pv.erro).toBe(false)
    expect(pv.dado?.efeito).toBe('franquia')
    expect(pv.dado?.franquiaRestante).toBe(2)
  })

  it('fuso do SLOT diferente do fuso atual do aluno: a franquia conta pelo fuso da AULA', async () => {
    // O aluno mudou de país; a aula continua ancorada no fuso do SLOT em que foi
    // marcada. Lei 1: quem decide a data civil da franquia é o banco
    // (`occurrence_date`, ou a zona da instância) — nunca o relógio de quem está
    // olhando. Se o preview tivesse usado o fuso do aluno, o mês da franquia
    // mudaria de acordo com a viagem dele.
    const s = await studentLogin({ allowance: 3, minNotice: 24, tz: 'America/Cuiaba' })
    const [slot] = await sql`
      insert into recurring_slots (contract_id, teacher_id, weekday, local_time, iana_tz,
                                   duration_min, active_from)
      values (${s.contractId}, ${s.teacherId}, 3, '19:00', 'America/Cuiaba', 45,
              public.business_today())
      returning id`
    const [inst] = await sql<{ id: string; ym: string }[]>`
      insert into class_instances
        (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
         local_time_snapshot)
      values
        (${s.contractId}, ${s.teacherId}, ${slot.id},
         ((now() + interval '72 hours') at time zone 'America/Cuiaba')::date,
         now() + interval '72 hours', now() + interval '72 hours 45 minutes',
         'fixture P4 fuso')
      returning id, to_char(occurrence_date, 'YYYY-MM') as ym`
    // …e SÓ AGORA o aluno muda de país.
    await sql`update students set iana_tz = 'Europe/Lisbon' where id = ${s.studentId}`

    const pv = await previewDeRemarcacao(s.client, inst.id)
    expect(pv.erro).toBe(false)
    expect(pv.dado?.efeito).toBe('franquia')
    expect(pv.dado?.franquiaRestante).toBe(3)

    const win = await publish(s.teacherId, 6, '17:00')
    expect(
      (await s.client.rpc('book_reschedule_window', { p_window: win, p_instance: inst.id })).error,
    ).toBeNull()
    expect(await viaDaRemarcacao(inst.id)).toBe(VIA_DO_EFEITO.franquia)
    // O período debitado é o da OCORRÊNCIA (zona do slot), não o do fuso novo.
    const [uso] = await sql<{ period_ym: string; used_count: number }[]>`
      select period_ym, used_count from reschedule_usage where contract_id = ${s.contractId}`
    expect(uso.used_count).toBe(1)
    expect(uso.period_ym).toBe(inst.ym)
  })

  it('aula que já saiu de agendada: o preview diz "nao_agendada", como a recusa do banco', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 72 })
    expect(
      (await admin.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'teacher' })).error,
    ).toBeNull()

    expect((await previewDeRemarcacao(s.client, inst)).dado?.efeito).toBe('nao_agendada')
    const win = await publish(s.teacherId, 6, '15:00')
    const { error } = await s.client.rpc('book_reschedule_window', { p_window: win, p_instance: inst })
    expect(error?.message ?? '').toContain('não está agendada')
  })
})

/* -------------------------------------------------------------------------- */
/* E1 — a via pode TROCAR entre o preview e a escrita, e o desfecho conta       */
/* -------------------------------------------------------------------------- */

describe('via_da_remarcacao — o desfecho REAL, contado depois do ato', () => {
  it('casal em duas abas: os dois previews dizem "franquia" e a 2ª remarcação sai por CRÉDITO', async () => {
    // A última remarcação do mês e um crédito na mão. Duas telas abertas ao
    // mesmo tempo (o casal, cada um no seu celular) leem "não custa reposição".
    // A primeira confirma e leva a franquia; a segunda confirma e o banco,
    // serializado, gasta o crédito — legitimamente. O que não pode acontecer é o
    // aluno descobrir esse gasto na página de créditos, dias depois.
    const s = await studentLogin({ allowance: 1, minNotice: 24 })
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog',
                                        ${daysFromToday(40)}, null, null, null, 45)`
    // As DUAS aulas na MESMA data de ocorrência: a franquia é mensal, e duas
    // aulas a 72 h e 96 h daqui podem cair em meses diferentes na virada — e aí
    // cada uma teria a própria franquia, que é o oposto do cenário.
    const [{ dia }] = await sql<{ dia: Date }[]>`
      select ((now() + interval '72 hours') at time zone 'America/Cuiaba')::date as dia`
    const criarNoMesmoDia = async (horas: number, marca: string) => {
      const [row] = await sql<{ id: string }[]>`
        insert into class_instances
          (contract_id, teacher_id, occurrence_date, starts_at_utc, ends_at_utc,
           local_time_snapshot)
        values
          (${s.contractId}, ${s.teacherId}, ${dia},
           now() + make_interval(hours => ${horas}),
           now() + make_interval(hours => ${horas}, mins => 45), ${marca})
        returning id`
      return row.id
    }
    const aulaA = await criarNoMesmoDia(72, 'casal aba A')
    const aulaB = await criarNoMesmoDia(74, 'casal aba B')

    // Os DOIS previews são lidos ANTES de qualquer escrita — é essa a corrida.
    const pvA = await previewDeRemarcacao(s.client, aulaA)
    const pvB = await previewDeRemarcacao(s.client, aulaB)
    expect(pvA.dado?.efeito).toBe('franquia')
    expect(pvB.dado?.efeito).toBe('franquia')

    const winA = await publish(s.teacherId, 6, '08:00')
    const winB = await publish(s.teacherId, 7, '08:00')
    const { data: novaA, error: eA } = await s.client.rpc('book_reschedule_window', {
      p_window: winA,
      p_instance: aulaA,
    })
    expect(eA).toBeNull()
    const { data: novaB, error: eB } = await s.client.rpc('book_reschedule_window', {
      p_window: winB,
      p_instance: aulaB,
    })
    expect(eB).toBeNull()

    // A promessa da 1ª se cumpriu; a da 2ª não — e o banco sabe disso.
    expect(await viaDaRemarcacao(aulaA)).toBe('allowance')
    expect(await viaDaRemarcacao(aulaB)).toBe('makeup_credit')
    expect(await saldo(s.contractId)).toBe(0)

    // …e é ISSO que o portal lê para montar o recado — pela sessão do ALUNO,
    // que não enxerga o `audit_log` (a função é DEFINER com porteiro).
    const viaA = await s.client.rpc('via_da_remarcacao', { p_instance: String(novaA) })
    const viaB = await s.client.rpc('via_da_remarcacao', { p_instance: String(novaB) })
    expect(viaA.error).toBeNull()
    expect(viaA.data).toBe('allowance')
    expect(viaB.data).toBe('makeup_credit')
  })

  it('instância que não nasceu de remarcação devolve NULL — sem via inventada', async () => {
    const s = await studentLogin({ allowance: 2, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 72 })
    const { data, error } = await s.client.rpc('via_da_remarcacao', { p_instance: inst })
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('aula de OUTRO aluno não conta a via dela (mesma frase do oráculo fechado)', async () => {
    const a = await studentLogin({ allowance: 2 })
    const b = await studentLogin({ allowance: 2 })
    const inst = await createInstance(sql, a, { startsInHours: 72 })
    const { error } = await b.client.rpc('via_da_remarcacao', { p_instance: inst })
    expect(error?.message ?? '').toContain('aula não encontrada')
  })
})

/* -------------------------------------------------------------------------- */
/* E2 — o empate exato da janela do aviso mínimo                               */
/* -------------------------------------------------------------------------- */

describe('a fronteira do aviso mínimo (limite_ts)', () => {
  it('empate exato: o preview classifica como válido e a escrita, segundos depois, RECUSA com frase clara', async () => {
    // A aula começa daqui a 24h e 12s, com aviso mínimo de 24h: quando o preview
    // roda, sobram ~12 segundos de janela. O preview diz "franquia" — está certo.
    // Quem confirma depois da fronteira recebe a recusa do banco, também certa.
    // Esse é o desencontro que o `limite_ts` existe para ANUNCIAR: a tela
    // consegue dizer "isso vale se você confirmar até HH:MM" em vez de deixar o
    // desfecho trocar em silêncio.
    //
    // POR QUE 12s E NÃO 4 (achado da 2ª revisão do P4). Com 4 segundos, a folga
    // entre criar a linha e ler o preview era do tamanho do próprio teste: numa
    // máquina lenta (ou num CI com o banco carregado) o preview chegava DEPOIS
    // da fronteira e classificava 'fora_do_aviso' — vermelho intermitente, e
    // confuso, porque a falha aparecia numa asserção sobre a REGRA quando o
    // problema era o relógio. Agora a janela é 3× maior que a espera medida, e
    // se ainda assim ela estourar, o teste falha dizendo isso com todas as
    // letras (a asserção logo abaixo do preview).
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const [inst] = await sql<{ id: string }[]>`
      insert into class_instances
        (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot)
      values
        (${s.contractId}, ${s.teacherId},
         now() + interval '24 hours 12 seconds',
         now() + interval '24 hours 49 minutes',
         'empate exato P4')
      returning id`

    const pv = await previewDeRemarcacao(s.client, inst.id)
    const noPreviewMs = Date.now()
    // A fronteira devolvida é o instante em que essa resposta morre.
    expect(pv.dado?.limiteTs).not.toBeNull()
    const faltaMs = Date.parse(pv.dado!.limiteTs!) - noPreviewMs

    // A MEDIDA ANTES DA REGRA: se a máquina engoliu a janela, o motivo do
    // vermelho é este — e não a classificação do banco.
    expect(
      faltaMs,
      `a máquina levou ${(12_000 - faltaMs) / 1000}s entre criar a aula e ler o preview, ` +
        'e a fronteira de 12s já tinha passado quando o preview rodou. ' +
        'Isto não é defeito da regra: é o ambiente lento demais para este cenário. ' +
        'Rode com o banco menos carregado (uma rodada por `supabase db reset`) ou aumente a janela.',
    ).toBeGreaterThan(2_000)
    // …e ela ainda é a fronteira APERTADA que o cenário quer (não uma folga de
    // horas por a aula ter nascido no lugar errado).
    expect(faltaMs).toBeLessThanOrEqual(12_000)
    // Com a janela ainda aberta, a resposta do banco é "cabe na franquia".
    expect(pv.dado?.efeito).toBe('franquia')

    const win = await publish(s.teacherId, 6, '09:00')
    // 15s > os ~12s da fronteira: quando a escrita chega, o prazo venceu com
    // folga em qualquer máquina.
    await new Promise((r) => setTimeout(r, 15_000))
    const { error } = await s.client.rpc('book_reschedule_window', {
      p_window: win,
      p_instance: inst.id,
    })
    expect(error?.message ?? '').toContain('aviso mínimo')
    // A aula continua onde estava, e nada de dinheiro se moveu.
    const [linha] = await sql<{ state: string }[]>`
      select state from class_instances where id = ${inst.id}`
    expect(linha.state).toBe('scheduled')
    expect(await lancamentosNoLedger(s.contractId)).toBe(0)
    // …e o preview relido já classifica pelo outro lado, com a mesma fronteira.
    const depois = await previewDeRemarcacao(s.client, inst.id)
    expect(depois.dado?.efeito).toBe('fora_do_aviso')
    expect(depois.dado?.limiteTs).toBe(pv.dado?.limiteTs)
  }, 40_000)

  it('o cancelamento devolve a fronteira que muda a resposta DELE', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const dentro = await createInstance(sql, s, { startsInHours: 72 })
    const fora = await createInstance(sql, s, { startsInHours: 2 })

    // Dentro do aviso: a fronteira é o fim do prazo (é ela que tira o "quer só
    // mudar o horário?" da tela).
    const pvDentro = await previewDeCancelamento(s.client, dentro)
    expect(pvDentro.dado?.dentroDoAviso).toBe(true)
    const [ldentro] = await sql<{ limite: Date }[]>`
      select (starts_at_utc - make_interval(hours => 24)) as limite
        from class_instances where id = ${dentro}`
    expect(Date.parse(pvDentro.dado!.limiteTs!)).toBe(ldentro.limite.getTime())

    // Fora do aviso: a próxima fronteira é o COMEÇO da aula — passando dela, o
    // banco recusa o cancelamento e manda usar no-show.
    const pvFora = await previewDeCancelamento(s.client, fora)
    expect(pvFora.dado?.dentroDoAviso).toBe(false)
    const [lfora] = await sql<{ starts: Date }[]>`
      select starts_at_utc as starts from class_instances where id = ${fora}`
    expect(Date.parse(pvFora.dado!.limiteTs!)).toBe(lfora.starts.getTime())
  })
})

describe('preview_cancel_effect — a consequência e o ato (matriz D2)', () => {
  it('dentro do aviso: promete SEM reposição, e o ato cumpre nas TRÊS provas', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 72 })

    const pv = await previewDeCancelamento(s.client, inst)
    expect(pv.dado).toMatchObject({ efeito: 'sem_reposicao', geraCredito: false, dentroDoAviso: true })

    expect((await s.client.rpc('cancel_my_class', { p_instance: inst })).error).toBeNull()
    // "saldo continua 0" sozinho passaria mesmo se o cancelamento não tivesse
    // acontecido. As três provas juntas: o ESTADO mudou, o audit REGISTROU que
    // não houve crédito, e o ledger não ganhou linha nenhuma (Lei 2).
    const [linha] = await sql<{ state: string }[]>`
      select state from class_instances where id = ${inst}`
    expect(linha.state).toBe('cancelled')
    expect(await auditDaAula(inst)).toMatchObject({ cancelled_by: 'student', credited: false })
    expect(await lancamentosNoLedger(s.contractId)).toBe(0)
    expect(await saldo(s.contractId)).toBe(0)
  })

  it('em cima da hora: `dentro_do_aviso` false, e o efeito continua sendo perder a aula', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 2 })

    const pv = await previewDeCancelamento(s.client, inst)
    expect(pv.dado).toMatchObject({ efeito: 'sem_reposicao', geraCredito: false, dentroDoAviso: false })

    expect((await s.client.rpc('cancel_my_class', { p_instance: inst })).error).toBeNull()
    const [linha] = await sql<{ state: string }[]>`
      select state from class_instances where id = ${inst}`
    expect(linha.state).toBe('cancelled')
    expect(await auditDaAula(inst)).toMatchObject({ cancelled_by: 'student', credited: false })
    expect(await lancamentosNoLedger(s.contractId)).toBe(0)
    expect(await saldo(s.contractId)).toBe(0)
  })

  it('aula que já começou: o preview diz "ja_comecou" e o banco recusa', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: -1 })

    expect((await previewDeCancelamento(s.client, inst)).dado?.efeito).toBe('ja_comecou')
    const { error } = await s.client.rpc('cancel_my_class', { p_instance: inst })
    expect(error?.message ?? '').toContain('já começou')
  })

  it('aula que já saiu de agendada: "nao_agendada" no preview e a mesma recusa na escrita', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 72 })
    expect((await s.client.rpc('cancel_my_class', { p_instance: inst })).error).toBeNull()

    expect((await previewDeCancelamento(s.client, inst)).dado?.efeito).toBe('nao_agendada')
    const { error } = await s.client.rpc('cancel_my_class', { p_instance: inst })
    expect(error?.message ?? '').toContain('não está agendada')
  })

  it('aula NASCIDA DE CRÉDITO cancelada pelo aluno: o preview promete e o banco NÃO estorna (ADR-018)', async () => {
    // O caso em que o dinheiro dói de verdade: o aluno já gastou um crédito para
    // marcar esta aula. Cancelar por conta própria NÃO devolve o crédito, em
    // antecedência nenhuma — e é isso que o preview tem de dizer ANTES do clique.
    const s = await studentLogin({ allowance: 0, minNotice: 24 })
    await sql`select public.earn_makeup(${s.contractId}, 'initial_backlog',
                                        ${daysFromToday(60)}, null, null, null, 45)`
    expect(await saldo(s.contractId)).toBe(1)

    const win = await publish(s.teacherId, 5, '18:00')
    const { data: nascida, error } = await s.client.rpc('book_reschedule_window', {
      p_window: win,
      p_contract: s.contractId,
    })
    expect(error).toBeNull()
    expect(await saldo(s.contractId)).toBe(0)
    const lancamentosAntes = await lancamentosNoLedger(s.contractId)

    const pv = await previewDeCancelamento(s.client, String(nascida))
    expect(pv.dado).toMatchObject({ efeito: 'sem_reposicao', geraCredito: false, dentroDoAviso: true })

    expect((await s.client.rpc('cancel_my_class', { p_instance: String(nascida) })).error).toBeNull()
    const [linha] = await sql<{ state: string }[]>`
      select state from class_instances where id = ${String(nascida)}`
    expect(linha.state).toBe('cancelled')
    expect(await auditDaAula(String(nascida))).toMatchObject({
      cancelled_by: 'student',
      credited: false,
      // o banco SABE que a aula nasceu de crédito — e mesmo assim não estorna
      credit_born: true,
    })
    // Nenhuma linha nova: nem ganho, nem estorno (Lei 2 — o ledger não recua).
    expect(await lancamentosNoLedger(s.contractId)).toBe(lancamentosAntes)
    expect(await saldo(s.contractId)).toBe(0)
  })
})

describe('student_class_history — o fato que vira frase', () => {
  it('a professora cancelou: o histórico diz quem foi e que nasceu reposição', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 72 })
    expect(
      (await admin.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'teacher' })).error,
    ).toBeNull()

    const h = await historicoDeAulas(s.client)
    expect(h.erro).toBe(false)
    const linha = h.dado.aulas.find((a) => a.id === inst)
    expect(linha).toMatchObject({ estado: 'cancelled', canceladoPor: 'teacher', gerouCredito: true })
    expect(estadoDaAula(linha!).frase).toBe('a professora precisou cancelar — você ganhou uma reposição')
  })

  it('o aluno cancelou DENTRO do aviso: "você cancelou", sem reposição', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 72 })
    expect((await s.client.rpc('cancel_my_class', { p_instance: inst })).error).toBeNull()

    const linha = (await historicoDeAulas(s.client)).dado.aulas.find((a) => a.id === inst)
    expect(linha).toMatchObject({ canceladoPor: 'student', foraDoAviso: false, gerouCredito: false })
    expect(estadoDaAula(linha!).frase).toBe('você cancelou — a aula não foi reposta')
  })

  it('o aluno cancelou EM CIMA DA HORA: a frase muda com o fato', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 2 })
    expect((await s.client.rpc('cancel_my_class', { p_instance: inst })).error).toBeNull()

    const linha = (await historicoDeAulas(s.client)).dado.aulas.find((a) => a.id === inst)
    expect(linha).toMatchObject({ canceladoPor: 'student', foraDoAviso: true, gerouCredito: false })
    expect(estadoDaAula(linha!).frase).toBe('você cancelou em cima da hora — a aula não foi reposta')
  })

  it('falta do aluno e falta da professora chegam com o desfecho certo', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const doAluno = await createInstance(sql, s, { startsInHours: -3 })
    const daProfessora = await createInstance(sql, s, { startsInHours: -5 })
    expect((await admin.rpc('no_show_student', { p_instance: doAluno })).error).toBeNull()
    expect((await admin.rpc('no_show_teacher', { p_instance: daProfessora })).error).toBeNull()

    const aulas = (await historicoDeAulas(s.client)).dado.aulas
    const a = aulas.find((x) => x.id === doAluno)!
    const b = aulas.find((x) => x.id === daProfessora)!
    expect(a.estado).toBe('no_show_student')
    expect(estadoDaAula(a).frase).toBe('você faltou — a aula contou como dada')
    expect(b).toMatchObject({ estado: 'no_show_teacher', gerouCredito: true })
    expect(estadoDaAula(b).frase).toBe('a professora faltou — você ganhou uma reposição')
  })

  it('cancelamento SEM registro nominal (encerramento) fica sem culpado', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 72 })
    // `admin_end_contract` cancela as aulas futuras por caminho direto — sem
    // linha de `cancel_class` no audit, de propósito.
    const [{ nome }] = await sql<{ nome: string }[]>`
      select s.display_name as nome from contracts c join students s on s.id = c.student_id
       where c.id = ${s.contractId}`
    expect(
      (
        await admin.rpc('admin_end_contract', {
          p_contract: s.contractId,
          p_confirm_name: nome,
        })
      ).error,
    ).toBeNull()

    const linha = (await historicoDeAulas(s.client)).dado.aulas.find((a) => a.id === inst)
    expect(linha).toMatchObject({ estado: 'cancelled', canceladoPor: null })
    expect(estadoDaAula(linha!).frase).toBe('cancelada')
  })

  it('a aula ainda sem desfecho e a paginação: total certo, páginas sem sobreposição', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const ids = [
      await createInstance(sql, s, { startsInHours: -10 }),
      await createInstance(sql, s, { startsInHours: -20 }),
      await createInstance(sql, s, { startsInHours: -30 }),
    ]

    const h = await historicoDeAulas(s.client)
    expect(h.dado.total).toBe(3)
    expect(h.dado.aulas.map((a) => a.id)).toEqual(ids) // da mais recente para a mais antiga
    expect(estadoDaAula(h.dado.aulas[0]!).frase).toBe('ainda sem registro')

    // A paginação é do BANCO (limite e deslocamento), não um `slice` na tela.
    const p1 = await s.client.rpc('student_class_history', { p_limit: 2, p_offset: 0 })
    const p2 = await s.client.rpc('student_class_history', { p_limit: 2, p_offset: 2 })
    expect(p1.error).toBeNull()
    expect(p2.error).toBeNull()
    expect((p1.data as { id: string; total: number }[]).map((r) => r.id)).toEqual([ids[0], ids[1]])
    expect((p2.data as { id: string }[]).map((r) => r.id)).toEqual([ids[2]])
    expect(Number((p1.data as { total: number }[])[0]!.total)).toBe(3)
  })
})

/* -------------------------------------------------------------------------- */
/* E3 — de quem foi a desmarcação que gerou o crédito                          */
/* -------------------------------------------------------------------------- */

describe('student_credit_statement.origem_autor — o crédito legado não acusa a escola', () => {
  /** O extrato do aluno, pela sessão dele. */
  async function extrato(cliente: SupabaseClient) {
    const { data, error } = await cliente.rpc('student_credit_statement', { p_memoria_dias: 60 })
    expect(error).toBeNull()
    return (data ?? []) as { ledger_id: number; reason: string; origem_autor: string | null }[]
  }

  it('com audit de CANCELAMENTO DA PROFESSORA, o autor é a professora', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 72 })
    expect(
      (await admin.rpc('cancel_class', { p_instance: inst, p_cancelled_by: 'teacher' })).error,
    ).toBeNull()

    const linhas = await extrato(s.client)
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toMatchObject({ reason: 'earn_cancellation', origem_autor: 'teacher' })
  })

  it('com audit de CANCELAMENTO DO ALUNO, o autor é o aluno (o caso pré-ADR-018)', async () => {
    // O lançamento LEGADO: antes de 18/07/2026 o cancelamento do aluno com aviso
    // também creditava. A aula fica cancelada PELO ALUNO no audit, e o crédito
    // pendurado nela — a forma exata que a tela traduzia como culpa da escola.
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 72 })
    expect((await s.client.rpc('cancel_my_class', { p_instance: inst })).error).toBeNull()
    await sql`select public.earn_makeup(${s.contractId}, 'earn_cancellation',
                                        ${daysFromToday(45)}, null, ${inst})`

    const linhas = await extrato(s.client)
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toMatchObject({ reason: 'earn_cancellation', origem_autor: 'student' })
  })

  it('SEM audit determinável, o autor é NULL — e a tela cai na frase neutra', async () => {
    // Crédito trazido de fora (migração) e crédito ligado a uma aula que nunca
    // teve linha de desfecho: os dois casos em que o banco não sabe quem foi.
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 72 })
    await sql`select public.earn_makeup(${s.contractId}, 'earn_cancellation',
                                        ${daysFromToday(45)}, null, ${inst})`
    await sql`select public.earn_makeup(${s.contractId}, 'earn_cancellation', ${daysFromToday(50)})`

    const linhas = await extrato(s.client)
    expect(linhas).toHaveLength(2)
    for (const l of linhas) expect(l.origem_autor).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* E8 — paginação: página fora do intervalo não é "não há aulas"               */
/* -------------------------------------------------------------------------- */

describe('student_class_history — a página fora do intervalo conta a verdade', () => {
  it('página vazia devolve o TOTAL certo (linha-sentinela), não zero', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    for (const h of [-10, -20, -30]) await createInstance(sql, s, { startsInHours: h })

    // Direto no banco: a página 99 devolve UMA linha, com id nulo e total 3.
    const { data, error } = await s.client.rpc('student_class_history', {
      p_limit: 15,
      p_offset: 15 * 98,
    })
    expect(error).toBeNull()
    const linhas = (data ?? []) as { id: string | null; total: number | string }[]
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.id).toBeNull()
    expect(Number(linhas[0]!.total)).toBe(3)

    // …e quem desembrulha descarta a sentinela sem perder o total — que é o que
    // permite à tela reposicionar em vez de afirmar "você não tem aula nenhuma".
    const fora = await historicoDeAulas(s.client, { pagina: 99 })
    expect(fora.erro).toBe(false)
    expect(fora.dado.aulas).toHaveLength(0)
    expect(fora.dado.total).toBe(3)
  })

  it('aluno SEM histórico nenhum: total 0 e nenhuma aula (a sentinela não vira linha)', async () => {
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const h = await historicoDeAulas(s.client)
    expect(h.erro).toBe(false)
    expect(h.dado.aulas).toHaveLength(0)
    expect(h.dado.total).toBe(0)
  })

  it('aula FUTURA cancelada cai no histórico — é o que fez o balde trocar de nome', async () => {
    // A afirmação de "complementaridade" que a migration trazia estava errada, e
    // o rótulo "Passadas" mentia junto com ela: esta aula é de daqui a três dias.
    const s = await studentLogin({ allowance: 4, minNotice: 24 })
    const inst = await createInstance(sql, s, { startsInHours: 72 })
    expect((await s.client.rpc('cancel_my_class', { p_instance: inst })).error).toBeNull()

    const linha = (await historicoDeAulas(s.client)).dado.aulas.find((a) => a.id === inst)
    expect(linha?.estado).toBe('cancelled')
    expect(Date.parse(linha!.startsAtUtc)).toBeGreaterThan(Date.now())
  })
})

describe('porteiro das leituras novas (Lei 4)', () => {
  it('aluno B não lê o preview NEM o estado da aula de A', async () => {
    const a = await studentLogin({ allowance: 4 })
    const b = await studentLogin({ allowance: 4 })
    const inst = await createInstance(sql, a, { startsInHours: 72 })

    expect((await previewDeRemarcacao(b.client, inst)).erro).toBe(true)
    expect((await previewDeCancelamento(b.client, inst)).erro).toBe(true)
    expect((await b.client.rpc('student_class_state', { p_instance: inst })).error).not.toBeNull()
    // …e a aula de A não aparece no histórico de B.
    const h = await historicoDeAulas(b.client)
    expect(h.dado.aulas.map((x) => x.id)).not.toContain(inst)
  })

  it('"não existe" e "não é sua" dizem a MESMA frase — o oráculo de UUID fechado (E7)', async () => {
    // Com frases diferentes, uma lista de UUIDs vira um teste de existência: a
    // resposta confirma quais aulas a escola tem. As três funções unitárias
    // respondem igual para os dois casos.
    const a = await studentLogin({ allowance: 2 })
    const b = await studentLogin({ allowance: 2 })
    const daOutra = await createInstance(sql, a, { startsInHours: 72 })
    const inexistente = crypto.randomUUID()

    for (const fn of ['student_class_state', 'preview_reschedule_effect', 'preview_cancel_effect']) {
      const alheia = await b.client.rpc(fn, { p_instance: daOutra })
      const fantasma = await b.client.rpc(fn, { p_instance: inexistente })
      expect(alheia.error?.message, fn).toBe('aula não encontrada')
      expect(fantasma.error?.message, fn).toBe(alheia.error?.message)
    }
  })

  it('conta com papel `teacher` não entra pela porta do aluno, mesmo tendo cadastro de aluno', async () => {
    // O caso do P3 (revisão 2 · D5): a professora que também faz aula na escola
    // passa por `my_contract_ids()` — quem a barra é o papel.
    const c = await createPrivateContract(sql)
    // O número vem explícito: quem tem acesso de ALUNO tem número (A6/i), e esta
    // conta é justamente a que ocupa as duas cadeiras.
    const userId = await createAuthUser(sql, 'teacher', 'Professora aluna', {
      whatsapp: '+5565900010031',
    })
    await sql`update students set profile_id = ${userId} where id = ${c.studentId}`
    const inst = await createInstance(sql, c, { startsInHours: 72 })
    const comoProfessora = await clientAs(userId, 'teacher')

    expect((await comoProfessora.rpc('student_class_history', {})).error).not.toBeNull()
    expect((await comoProfessora.rpc('preview_reschedule_effect', { p_instance: inst })).error).not.toBeNull()
    expect((await comoProfessora.rpc('preview_cancel_effect', { p_instance: inst })).error).not.toBeNull()
    expect((await comoProfessora.rpc('student_class_state', { p_instance: inst })).error).not.toBeNull()
  })
})
