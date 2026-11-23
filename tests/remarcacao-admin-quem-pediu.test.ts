// Issue #192 — a remarcação pela administração diz QUEM PEDIU a mudança.
//
// Decisão do dono (16/11/2026, #179, achado 9 do teste em produção de 02/11):
//   · a ESCOLA pediu → nunca consome a franquia do mês nem crédito do aluno,
//     exige motivo, e o aviso da fila carrega a origem (o despachante escolhe
//     "a mudança partiu da escola");
//   · o ALUNO pediu → como sempre: franquia, depois crédito, salvo cortesia;
//   · a administração SEM dizer quem pediu → o banco recusa (decisão do dono em
//     23/11/2026). No portal, o aluno segue remarcando sem o parâmetro.
//
// A regra de não consumir é do BANCO (Leis 2 e 3) e é provada aqui contra o
// Postgres, pelos DOIS caminhos do admin — horário aberto
// (`book_reschedule_window`) e horário novo (`admin_reschedule_to_new_time`) —,
// com o saldo lido antes e depois. Quem pediu fica no `audit_log` (Lei 8) e no
// aviso (`enqueue_reschedule_confirmation` lê do audit, o app não informa).
//
// Datas RELATIVAS (`daysFromToday` + `instanteEm`): as RPCs consultam `now()`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import {
  connect,
  createInstanceAt,
  createPrivateContract,
  createStudent,
  daysFromToday,
  instanteEm,
  type PrivateContract,
} from './helpers/db'
import { sendRescheduleEmails } from '../src/lib/email/notify'

let sql: Sql
let admin: SupabaseClient
let adminUser: string

beforeAll(async () => {
  sql = connect(3)
  adminUser = await createAuthUser(sql, 'admin', 'Dona quem pediu')
  admin = await clientAs(adminUser, 'admin')
})
afterAll(async () => {
  await sql.end()
})

const MOTIVO = 'a professora tem banca nesse dia'

interface Cenario {
  c: PrivateContract
  /** a aula a remarcar (dia +5, 10:00 de Cuiabá, 45 min) */
  aula: string
  /** o destino (dia +6, 15:00 de Cuiabá) */
  destino: string
  alunoUser: string
  aluno: SupabaseClient
}

/** Aluno com login (e WhatsApp), contrato e uma aula marcada. */
async function cenario(opts: { allowance?: number; creditos?: number } = {}): Promise<Cenario> {
  const studentId = await createStudent(sql)
  const alunoUser = await createAuthUser(sql, 'student', 'Aluno quem pediu')
  await sql`update students set profile_id = ${alunoUser} where id = ${studentId}`
  const c = await createPrivateContract(sql, { studentId, allowance: opts.allowance ?? 2 })
  for (let i = 0; i < (opts.creditos ?? 0); i++)
    await sql`
      insert into makeup_ledger (contract_id, delta, reason, expires_on, duration_min)
      values (${c.contractId}, 1, 'manual_adjust', ${daysFromToday(60)}, 45)`
  const aula = await createInstanceAt(sql, c, instanteEm(daysFromToday(5), '10:00'), 45)
  return {
    c,
    aula,
    destino: instanteEm(daysFromToday(6), '15:00'),
    alunoUser,
    aluno: await clientAs(alunoUser, 'student'),
  }
}

/** O que a remarcação poderia ter consumido: franquia usada e o ledger inteiro. */
async function consumo(contractId: string): Promise<{ franquiaUsada: number; ledger: string }> {
  const [u] = await sql`
    select coalesce(sum(used_count), 0)::int as n from reschedule_usage where contract_id = ${contractId}`
  const linhas = await sql`
    select id, delta, reason from makeup_ledger where contract_id = ${contractId} order by id`
  const [{ saldo }] = await sql`select public.makeup_balance(${contractId}::uuid) as saldo`
  return {
    franquiaUsada: u.n as number,
    // linha por linha (append-only): nenhuma entrada nova, nenhuma alterada
    ledger: JSON.stringify({ saldo: Number(saldo), linhas: linhas.map((l) => [String(l.id), l.delta, l.reason]) }),
  }
}

async function auditoriaDa(action: string, novaId: string): Promise<Record<string, unknown>> {
  const linhas =
    action === 'book_reschedule_window'
      ? await sql`select diff from audit_log where action = ${action} and diff ->> 'new_instance' = ${novaId}`
      : await sql`select diff from audit_log where action = ${action} and entity_id = ${novaId}`
  expect(linhas, `trilha de ${action}`).toHaveLength(1)
  return linhas[0].diff as Record<string, unknown>
}

async function avisoDaFila(cliente: SupabaseClient, novaId: string): Promise<Record<string, unknown>> {
  const r = await cliente.rpc('enqueue_reschedule_confirmation', { p_instance: novaId })
  expect(r.error, `enfileirar recusou: ${r.error?.message}`).toBeNull()
  const linhas = await sql`
    select payload from notification_outbox
     where template = 'reschedule-confirm' and payload ->> 'instance_id' = ${novaId}`
  expect(linhas).toHaveLength(1)
  return linhas[0].payload as Record<string, unknown>
}

async function estado(id: string): Promise<string> {
  const [r] = await sql`select state from class_instances where id = ${id}`
  return r.state as string
}

/**
 * O horário aberto do destino: publica pela porta de produção, ou reaproveita o
 * que uma tentativa RECUSADA deixou publicado (publicar é ato à parte; a recusa
 * da reserva não o desfaz).
 */
async function janelaDoDestino(k: Cenario): Promise<string> {
  const [ja] = await sql`
    select id from reschedule_windows
     where teacher_id = ${k.c.teacherId} and starts_at_utc = ${k.destino} and state = 'publicada'`
  if (ja) return ja.id as string
  const w = await admin.rpc('publish_reschedule_window', {
    p_teacher: k.c.teacherId,
    p_starts_at_utc: k.destino,
  })
  expect(w.error, `publicar recusou: ${w.error?.message}`).toBeNull()
  return w.data as string
}

type Extras = Record<string, unknown>
interface Caminho {
  nome: string
  /** a ação de auditoria que a porta grava */
  porta: 'book_reschedule_window' | 'admin_reschedule_to_new_time'
  remarcar: (cliente: SupabaseClient, k: Cenario, extras: Extras) => Promise<{ data: unknown; error: { message: string } | null }>
}

const CAMINHOS: Caminho[] = [
  {
    nome: 'horário aberto (book_reschedule_window)',
    porta: 'book_reschedule_window',
    remarcar: async (cliente, k, extras) =>
      cliente.rpc('book_reschedule_window', {
        p_window: await janelaDoDestino(k),
        p_instance: k.aula,
        ...extras,
      }),
  },
  {
    nome: 'horário novo (admin_reschedule_to_new_time)',
    porta: 'admin_reschedule_to_new_time',
    remarcar: async (cliente, k, extras) =>
      cliente.rpc('admin_reschedule_to_new_time', {
        p_instance: k.aula,
        p_starts_at_utc: k.destino,
        ...extras,
      }),
  },
]

describe.each(CAMINHOS)('#192 · quem pediu a mudança — $nome', ({ porta, remarcar }) => {
  it('a ESCOLA pediu: franquia e ledger iguais antes e depois; a trilha e o aviso dizem a origem', async () => {
    const k = await cenario({ allowance: 2, creditos: 1 })
    const antes = await consumo(k.c.contractId)

    const r = await remarcar(admin, k, { p_requested_by: 'school', p_courtesy_note: MOTIVO })
    expect(r.error, `remarcar recusou: ${r.error?.message}`).toBeNull()
    const nova = r.data as string

    // a aula mudou de fato…
    expect(await estado(k.aula)).toBe('rescheduled')
    expect(await estado(nova)).toBe('scheduled')
    // …e NADA do aluno foi consumido: nem a franquia do mês, nem uma linha do ledger
    expect(await consumo(k.c.contractId)).toEqual(antes)

    const miolo = await auditoriaDa('reschedule_class', nova)
    expect(miolo.requested_by).toBe('school')
    expect(miolo.school_move).toBe(true)
    expect(miolo.via).toBe('teacher')
    expect(miolo.courtesy_note).toBe(MOTIVO)
    expect((await auditoriaDa(porta, nova)).requested_by).toBe('school')

    // o aviso da fila carrega a origem que o BANCO gravou (o app não informa)
    const aviso = await avisoDaFila(admin, nova)
    expect(aviso.requested_by).toBe('school')
    expect(aviso.moved_by).toBe('admin')
  })

  it('a ESCOLA pediu com a franquia esgotada e sem crédito: passa, e nada é consumido', async () => {
    // O mesmo cenário, pedido pelo aluno, é RECUSADO por falta de saldo (prova de
    // mutação logo abaixo): aqui é a escola que move, e não há o que cobrar.
    const k = await cenario({ allowance: 0, creditos: 0 })
    const antes = await consumo(k.c.contractId)

    const doAluno = await remarcar(admin, k, { p_requested_by: 'student' })
    expect(doAluno.error?.message, 'sem franquia e sem crédito o pedido do aluno deveria ser recusado').toMatch(/saldo|crédito/i)
    expect(await estado(k.aula)).toBe('scheduled')

    const r = await remarcar(admin, k, { p_requested_by: 'school', p_courtesy_note: MOTIVO })
    expect(r.error, `remarcar recusou: ${r.error?.message}`).toBeNull()
    expect(await consumo(k.c.contractId)).toEqual(antes)
  })

  it('a ESCOLA pediu SEM motivo: recusa, e nada muda', async () => {
    const k = await cenario()
    const antes = await consumo(k.c.contractId)
    for (const nota of [undefined, '   ']) {
      const r = await remarcar(admin, k, {
        p_requested_by: 'school',
        ...(nota === undefined ? {} : { p_courtesy_note: nota }),
      })
      expect(r.error?.message).toContain('a remarcação pedida pela escola exige motivo')
    }
    expect(await estado(k.aula)).toBe('scheduled')
    expect(await consumo(k.c.contractId)).toEqual(antes)
    expect(
      await sql`select 1 from class_instances where reschedule_of = ${k.aula}`,
      'a recusa deixou uma aula nova para trás',
    ).toHaveLength(0)
  })

  it('o ALUNO pediu, sem cortesia: consome a franquia do mês', async () => {
    const k = await cenario({ allowance: 2, creditos: 1 })
    const antes = await consumo(k.c.contractId)

    const r = await remarcar(admin, k, { p_requested_by: 'student' })
    expect(r.error, `remarcar recusou: ${r.error?.message}`).toBeNull()
    const nova = r.data as string

    const depois = await consumo(k.c.contractId)
    expect(depois.franquiaUsada).toBe(antes.franquiaUsada + 1)
    expect(depois.ledger, 'a franquia cobria: o crédito não podia ser tocado').toBe(antes.ledger)

    const miolo = await auditoriaDa('reschedule_class', nova)
    expect(miolo.requested_by).toBe('student')
    expect(miolo.via).toBe('allowance')
    expect(miolo.school_move).toBe(false)
    expect((await auditoriaDa(porta, nova)).requested_by).toBe('student')
    expect((await avisoDaFila(admin, nova)).requested_by).toBe('student')
  })

  it('o ALUNO pediu com a franquia esgotada: consome UM crédito', async () => {
    const k = await cenario({ allowance: 0, creditos: 2 })
    const [{ saldo: antes }] = await sql`select public.makeup_balance(${k.c.contractId}::uuid) as saldo`

    const r = await remarcar(admin, k, { p_requested_by: 'student' })
    expect(r.error, `remarcar recusou: ${r.error?.message}`).toBeNull()

    const [{ saldo: depois }] = await sql`select public.makeup_balance(${k.c.contractId}::uuid) as saldo`
    expect(Number(depois)).toBe(Number(antes) - 1)
    const miolo = await auditoriaDa('reschedule_class', r.data as string)
    expect(miolo.via).toBe('makeup_credit')
    expect(miolo.requested_by).toBe('student')
  })

  it('o ALUNO pediu, com cortesia: não consome, e continua sendo pedido do aluno', async () => {
    const k = await cenario({ allowance: 2, creditos: 1 })
    const antes = await consumo(k.c.contractId)

    const r = await remarcar(admin, k, {
      p_requested_by: 'student',
      p_courtesy: true,
      p_courtesy_note: 'primeira vez, perdoado',
    })
    expect(r.error, `remarcar recusou: ${r.error?.message}`).toBeNull()
    const nova = r.data as string

    expect(await consumo(k.c.contractId)).toEqual(antes)
    const miolo = await auditoriaDa('reschedule_class', nova)
    expect(miolo.via).toBe('courtesy')
    // o divisor do AVISO não é a cortesia: quem pediu foi o aluno
    expect(miolo.requested_by).toBe('student')
    expect((await avisoDaFila(admin, nova)).requested_by).toBe('student')
  })

  it('a administração SEM dizer quem pediu é recusada pelo BANCO, e nada muda (a regra não mora só na tela)', async () => {
    // Decisão do dono em 23/11/2026, depois da revisão independente: aba antiga,
    // envio forjado ou app publicado antes desta migration chegam sem a resposta.
    // Tratar a omissão como "o aluno pediu" cobraria dele uma mudança que pode
    // ter sido da escola — então o banco recusa.
    const k = await cenario({ allowance: 2, creditos: 1 })
    const antes = await consumo(k.c.contractId)

    for (const extras of [{}, { p_requested_by: null }, { p_courtesy: true, p_courtesy_note: MOTIVO }]) {
      const r = await remarcar(admin, k, extras)
      expect(r.error?.message, `passou sem a resposta: ${JSON.stringify(extras)}`).toContain(
        'informe quem pediu a mudança',
      )
    }
    expect(await estado(k.aula)).toBe('scheduled')
    expect(await consumo(k.c.contractId)).toEqual(antes)
    expect(await sql`select 1 from class_instances where reschedule_of = ${k.aula}`).toHaveLength(0)
    expect(
      await sql`select 1 from audit_log where action = 'reschedule_class' and diff ->> 'rescheduled_from' = ${k.aula}`,
    ).toHaveLength(0)

    // PROVA DE MUTAÇÃO: com a resposta, a mesma chamada passa
    const ok = await remarcar(admin, k, { p_requested_by: 'student' })
    expect(ok.error, `remarcar recusou: ${ok.error?.message}`).toBeNull()
  })

  it('escola E cortesia marcadas juntas: vale a escola (não conta como cortesia)', async () => {
    const k = await cenario({ allowance: 2 })
    const antes = await consumo(k.c.contractId)

    const r = await remarcar(admin, k, { p_requested_by: 'school', p_courtesy: true, p_courtesy_note: MOTIVO })
    expect(r.error, `remarcar recusou: ${r.error?.message}`).toBeNull()

    expect(await consumo(k.c.contractId)).toEqual(antes)
    const miolo = await auditoriaDa('reschedule_class', r.data as string)
    expect(miolo.via).toBe('teacher')
    expect(miolo.requested_by).toBe('school')
  })

  it('valor que não é aluno nem escola é recusado, e nada muda', async () => {
    const k = await cenario()
    const r = await remarcar(admin, k, { p_requested_by: 'teacher', p_courtesy_note: MOTIVO })
    expect(r.error?.message).toContain('informe quem pediu a mudança')
    expect(await estado(k.aula)).toBe('scheduled')
    // horário novo: a janela criada no caminho morreu com a transação
    if (porta === 'admin_reschedule_to_new_time')
      expect(await sql`select 1 from reschedule_windows where teacher_id = ${k.c.teacherId}`).toHaveLength(0)
  })
})

describe('#192 · só a administração afirma que a escola pediu', () => {
  it('o aluno, no portal, não consegue remarcar "a pedido da escola" (e segue remarcando como sempre)', async () => {
    const k = await cenario({ allowance: 2 })
    const antes = await consumo(k.c.contractId)
    const janela = await janelaDoDestino(k)

    const forjado = await k.aluno.rpc('book_reschedule_window', {
      p_window: janela,
      p_instance: k.aula,
      p_requested_by: 'school',
      p_courtesy_note: 'quero de graça',
    })
    expect(forjado.error?.message).toContain('só a administração registra mudança pedida pela escola')
    expect(await estado(k.aula)).toBe('scheduled')
    expect(await consumo(k.c.contractId)).toEqual(antes)

    // o portal de sempre: sem o parâmetro, o aluno remarca e a franquia é cobrada
    const r = await k.aluno.rpc('book_reschedule_window', { p_window: janela, p_instance: k.aula })
    expect(r.error, `o portal parou de remarcar: ${r.error?.message}`).toBeNull()
    expect((await consumo(k.c.contractId)).franquiaUsada).toBe(antes.franquiaUsada + 1)
    const miolo = await auditoriaDa('reschedule_class', r.data as string)
    expect(miolo.requested_by).toBe('student')
    const aviso = await avisoDaFila(k.aluno, r.data as string)
    expect(aviso.moved_by).toBe('student')
    expect(aviso.requested_by).toBe('student')
  })

  it('a grade calculada do portal (book_computed_slot) não vira atalho: a administração é recusada ali, o aluno não', async () => {
    // `book_computed_slot` não repassa quem pediu. Como administração, a chamada
    // chega à reserva sem a resposta e é recusada; como aluno, é pedido dele.
    const k = await cenario({ allowance: 2 })
    const antes = await consumo(k.c.contractId)
    await sql`
      insert into teacher_availability_exceptions (teacher_id, kind, starts_at_utc, ends_at_utc, local_snapshot)
      values (${k.c.teacherId}, 'open', ${instanteEm(daysFromToday(6), '00:00')},
              ${instanteEm(daysFromToday(6), '23:59')}, 'fixture quem pediu')`
    const args = { p_teacher: k.c.teacherId, p_starts_at_utc: k.destino, p_instance: k.aula }

    const daAdmin = await admin.rpc('book_computed_slot', args)
    expect(daAdmin.error?.message).toContain('informe quem pediu a mudança')
    expect(await estado(k.aula)).toBe('scheduled')
    expect(await consumo(k.c.contractId)).toEqual(antes)
    expect(
      await sql`select 1 from reschedule_windows where teacher_id = ${k.c.teacherId}`,
      'a recusa deixou uma janela para trás',
    ).toHaveLength(0)

    const doAluno = await k.aluno.rpc('book_computed_slot', args)
    expect(doAluno.error, `o portal parou de remarcar pela grade: ${doAluno.error?.message}`).toBeNull()
    expect((await consumo(k.c.contractId)).franquiaUsada).toBe(antes.franquiaUsada + 1)
    expect((await auditoriaDa('reschedule_class', doAluno.data as string)).requested_by).toBe('student')
  })

  it('a professora também não: a porta dela é a do painel (teacher_reschedule_own_class)', async () => {
    const k = await cenario()
    const profUser = await createAuthUser(sql, 'teacher', 'Prof quem pediu')
    await sql`update teachers set profile_id = ${profUser} where id = ${k.c.teacherId}`
    const prof = await clientAs(profUser, 'teacher')
    const janela = await janelaDoDestino(k)

    const r = await prof.rpc('book_reschedule_window', {
      p_window: janela,
      p_instance: k.aula,
      p_requested_by: 'school',
      p_courtesy_note: MOTIVO,
    })
    expect(r.error?.message).toContain('só a administração registra mudança pedida pela escola')
    expect(await estado(k.aula)).toBe('scheduled')
  })

  it('papel "admin" forjado em user_metadata (JWT sem papel de verdade) não afirma que a escola pediu (Lei 4)', async () => {
    const k = await cenario()
    const antes = await consumo(k.c.contractId)
    const janela = await janelaDoDestino(k)
    // o papel só vale em app_metadata; aqui ele está onde o usuário consegue editar
    const semPapel = await clientAs(k.alunoUser, 'admin', { forgeInUserMetadata: true })

    for (const rpc of [
      () =>
        semPapel.rpc('book_reschedule_window', {
          p_window: janela,
          p_instance: k.aula,
          p_requested_by: 'school',
          p_courtesy_note: MOTIVO,
        }),
      () =>
        semPapel.rpc('admin_reschedule_to_new_time', {
          p_instance: k.aula,
          p_starts_at_utc: k.destino,
          p_requested_by: 'school',
          p_courtesy_note: MOTIVO,
        }),
    ]) {
      const r = await rpc()
      expect(r.error?.message, 'a remarcação passou sem papel de administração').toMatch(/administração/)
      expect(await estado(k.aula)).toBe('scheduled')
      expect(await consumo(k.c.contractId)).toEqual(antes)
    }
  })

  it('a chave de servidor (service_role, sem papel de administração) também não afirma que a escola pediu', async () => {
    const k = await cenario()
    const antes = await consumo(k.c.contractId)
    const janela = await janelaDoDestino(k)
    const servidor = serviceClient()

    for (const rpc of [
      () =>
        servidor.rpc('book_reschedule_window', {
          p_window: janela,
          p_instance: k.aula,
          p_requested_by: 'school',
          p_courtesy_note: MOTIVO,
        }),
      () =>
        servidor.rpc('admin_reschedule_to_new_time', {
          p_instance: k.aula,
          p_starts_at_utc: k.destino,
          p_requested_by: 'school',
          p_courtesy_note: MOTIVO,
        }),
    ]) {
      const r = await rpc()
      // recusa pela regra de papel; onde a chave nem tem EXECUTE, pela permissão
      expect(r.error?.message, 'a remarcação passou sem papel de administração').toMatch(
        /administração|permission denied/,
      )
      expect(await estado(k.aula)).toBe('scheduled')
      expect(await consumo(k.c.contractId)).toEqual(antes)
    }
  })

  it('campo da administração VAZIO (null) não é atalho: o aluno não fura a antecedência mínima da professora, por nenhuma porta dele', async () => {
    // Num `if` do banco, null não é verdadeiro nem falso. Antes da correção, o
    // aluno que mandasse `p_bypass_lead: null` pulava a guarda "só a
    // administração" E a conferência da antecedência do destino.
    const k = await cenario({ allowance: 2 })
    const janela = await janelaDoDestino(k)
    await sql`
      insert into teacher_availability_exceptions (teacher_id, kind, starts_at_utc, ends_at_utc, local_snapshot)
      values (${k.c.teacherId}, 'open', ${instanteEm(daysFromToday(6), '00:00')},
              ${instanteEm(daysFromToday(6), '23:59')}, 'fixture quem pediu')`
    // o destino (dia +6) passa a ficar DENTRO da antecedência mínima dela
    await sql`update teachers set min_booking_lead_hours = 400 where id = ${k.c.teacherId}`
    const antes = await consumo(k.c.contractId)
    const grade = { p_teacher: k.c.teacherId, p_starts_at_utc: k.destino, p_instance: k.aula }

    const tentativas: [string, () => PromiseLike<{ error: { message: string } | null }>][] = [
      [
        'horário aberto, bypass vazio',
        () => k.aluno.rpc('book_reschedule_window', { p_window: janela, p_instance: k.aula, p_bypass_lead: null }),
      ],
      [
        'horário aberto, cortesia e bypass vazios',
        () =>
          k.aluno.rpc('book_reschedule_window', {
            p_window: janela,
            p_instance: k.aula,
            p_courtesy: null,
            p_bypass_lead: null,
          }),
      ],
      ['grade calculada, bypass vazio', () => k.aluno.rpc('book_computed_slot', { ...grade, p_bypass_lead: null })],
      [
        'grade calculada, cortesia e bypass vazios',
        () => k.aluno.rpc('book_computed_slot', { ...grade, p_courtesy: null, p_bypass_lead: null }),
      ],
      // a régua: sem o campo, a recusa é a MESMA (vazio vale "não marcado")
      ['horário aberto, sem o campo', () => k.aluno.rpc('book_reschedule_window', { p_window: janela, p_instance: k.aula })],
      // e vale para a administração também: vazio não é "furar a antecedência"
      [
        'administração, bypass vazio',
        () =>
          admin.rpc('book_reschedule_window', {
            p_window: janela,
            p_instance: k.aula,
            p_requested_by: 'student',
            p_bypass_lead: null,
          }),
      ],
    ]
    for (const [nome, tentar] of tentativas) {
      const r = await tentar()
      expect(r.error?.message, `${nome}: a reserva passou dentro da antecedência`).toContain(
        'exige 400 h de antecedência',
      )
      expect(await estado(k.aula), nome).toBe('scheduled')
      expect(await consumo(k.c.contractId), nome).toEqual(antes)
    }
    const [w] = await sql`select state from reschedule_windows where id = ${janela}`
    expect(w.state, 'a recusa consumiu o horário aberto').toBe('publicada')

    // o bypass segue existindo, e segue sendo SÓ da administração: marcado de
    // verdade ele passa; a cortesia vazia não vira cortesia (a franquia é cobrada)
    const comBypass = await admin.rpc('book_reschedule_window', {
      p_window: janela,
      p_instance: k.aula,
      p_requested_by: 'student',
      p_courtesy: null,
      p_bypass_lead: true,
    })
    expect(comBypass.error, `o bypass da administração parou: ${comBypass.error?.message}`).toBeNull()
    expect((await consumo(k.c.contractId)).franquiaUsada).toBe(antes.franquiaUsada + 1)
    const trilha = await auditoriaDa('book_reschedule_window', comBypass.data as string)
    expect(trilha.bypass_lead).toBe(true)
    expect(trilha.courtesy).toBe(false)
    expect((await auditoriaDa('reschedule_class', comBypass.data as string)).via).toBe('allowance')
  })

  it('"a escola pediu" é da REMARCAÇÃO: no resgate de crédito é recusado, e o crédito fica', async () => {
    const k = await cenario({ creditos: 1 })
    const antes = await consumo(k.c.contractId)
    const janela = await janelaDoDestino(k)

    const r = await admin.rpc('book_reschedule_window', {
      p_window: janela,
      p_contract: k.c.contractId,
      p_requested_by: 'school',
      p_courtesy_note: MOTIVO,
    })
    expect(r.error?.message).toContain('pedido da escola é da REMARCAÇÃO')
    expect(await consumo(k.c.contractId)).toEqual(antes)
  })
})

describe('#192 · o e-mail segue quem pediu', () => {
  /** A professora da aula com login, para o e-mail dela ter destino. */
  async function comProfessoraLogada(k: Cenario): Promise<string> {
    const profUser = await createAuthUser(sql, 'teacher', 'Prof e-mail quem pediu')
    await sql`update teachers set profile_id = ${profUser}, display_name = 'Professora Teste' where id = ${k.c.teacherId}`
    return profUser
  }
  async function emailDe(userId: string): Promise<string> {
    const [u] = await sql`select email from auth.users where id = ${userId}`
    return u.email as string
  }
  async function enviados(novaId: string, ator: string) {
    const sent: { to: string; subject: string; html: string }[] = []
    await sendRescheduleEmails(serviceClient(), { newInstanceId: novaId, actorUserId: ator }, async (e) => {
      sent.push(e)
    })
    return sent
  }

  it('a escola pediu: o aluno recebe "a mudança partiu da escola" e a professora, o aviso da administração', async () => {
    const k = await cenario()
    const profUser = await comProfessoraLogada(k)
    const r = await CAMINHOS[1].remarcar(admin, k, { p_requested_by: 'school', p_courtesy_note: MOTIVO })
    expect(r.error, `remarcar recusou: ${r.error?.message}`).toBeNull()

    const sent = await enviados(r.data as string, adminUser)
    expect(sent).toHaveLength(2)
    const paraAluno = sent.find((e) => e.html.includes('Essa mudança partiu da escola'))
    expect(paraAluno, 'o aluno não recebeu o e-mail "a escola moveu"').toBeDefined()
    expect(paraAluno!.to).toBe(await emailDe(k.alunoUser))
    expect(paraAluno!.subject).toContain('Sua aula mudou de horário')
    expect(paraAluno!.html).not.toContain('sua remarcação foi confirmada')
    // o motivo é da administração: não viaja para o aluno
    expect(paraAluno!.html).not.toContain(MOTIVO)

    const paraProfessora = sent.find((e) => e.to !== paraAluno!.to)!
    expect(paraProfessora.to).toBe(await emailDe(profUser))
    expect(paraProfessora.subject).toContain('remarcada pela escola')
    expect(paraProfessora.html).toContain('A administração remarcou a aula')
    expect(paraProfessora.html, 'o e-mail da professora afirma que o aluno remarcou').not.toContain('pelo portal')
    expect(paraProfessora.html).not.toContain(MOTIVO)
  })

  it('a escola pediu e quem remarcou É a professora da aula (a dona): ela não recebe e-mail de si mesma', async () => {
    const k = await cenario()
    // a dona é admin E a professora desta aula
    await sql`update teachers set profile_id = ${adminUser} where id = ${k.c.teacherId}`
    const r = await CAMINHOS[1].remarcar(admin, k, { p_requested_by: 'school', p_courtesy_note: MOTIVO })
    expect(r.error, `remarcar recusou: ${r.error?.message}`).toBeNull()

    const sent = await enviados(r.data as string, adminUser)
    await sql`update teachers set profile_id = null where id = ${k.c.teacherId}`
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe(await emailDe(k.alunoUser))
    expect(sent[0].html).toContain('Essa mudança partiu da escola')
  })

  it('a action perdeu quem agiu (sessão sem usuário depois do commit): vale o ator que o BANCO gravou na trilha', async () => {
    const k = await cenario()
    await sql`update teachers set profile_id = ${adminUser} where id = ${k.c.teacherId}`
    const r = await CAMINHOS[1].remarcar(admin, k, { p_requested_by: 'school', p_courtesy_note: MOTIVO })
    expect(r.error, `remarcar recusou: ${r.error?.message}`).toBeNull()

    // ator vazio, como a action manda quando `auth.getUser()` volta sem usuário
    const sent = await enviados(r.data as string, '')
    await sql`update teachers set profile_id = null where id = ${k.c.teacherId}`
    expect(sent, 'quem remarcou recebeu "a administração remarcou" de si mesma').toHaveLength(1)
    expect(sent[0].to).toBe(await emailDe(k.alunoUser))
  })

  /**
   * O cliente de serviço de verdade, com a leitura do `audit_log` falhando nas
   * primeiras `vezes` tentativas. O resto segue no cliente REAL.
   */
  function comTrilhaFalhando(vezes: number): SupabaseClient {
    const real = serviceClient()
    let falhas = 0
    return new Proxy(real, {
      get(alvo, prop, receptor) {
        if (prop !== 'from') {
          // métodos seguem presos ao cliente REAL (o `this` deles não é o proxy)
          const valor: unknown = Reflect.get(alvo, prop, receptor)
          return typeof valor === 'function' ? valor.bind(alvo) : valor
        }
        return (tabela: string) => {
          if (tabela !== 'audit_log' || falhas >= vezes) return alvo.from(tabela)
          falhas++
          const falha = {
            select: () => falha,
            eq: () => falha,
            limit: async () => ({ data: null, error: { message: 'conexão caiu' } }),
          }
          return falha
        }
      },
    })
  }

  it('trilha da remarcação ilegível: NENHUM e-mail sai (texto trocado contradiria o que o banco cobrou)', async () => {
    const k = await cenario()
    await comProfessoraLogada(k)
    const r = await CAMINHOS[1].remarcar(admin, k, { p_requested_by: 'school', p_courtesy_note: MOTIVO })
    expect(r.error, `remarcar recusou: ${r.error?.message}`).toBeNull()

    const sent: unknown[] = []
    await expect(
      sendRescheduleEmails(
        comTrilhaFalhando(Infinity),
        { newInstanceId: r.data as string, actorUserId: adminUser },
        async (e) => {
          sent.push(e)
        },
      ),
    ).rejects.toThrow(/trilha da remarcação não lida/)
    expect(sent, 'saiu e-mail sem saber quem pediu a mudança').toHaveLength(0)

    // PROVA DE MUTAÇÃO: com a trilha legível, a mesma chamada envia
    expect((await enviados(r.data as string, adminUser)).length).toBeGreaterThan(0)
  })

  it('falha PASSAGEIRA na leitura da trilha: a segunda tentativa lê, e os e-mails saem com o texto certo', async () => {
    const k = await cenario()
    await comProfessoraLogada(k)
    const r = await CAMINHOS[1].remarcar(admin, k, { p_requested_by: 'school', p_courtesy_note: MOTIVO })
    expect(r.error, `remarcar recusou: ${r.error?.message}`).toBeNull()

    const sent: { to: string; html: string }[] = []
    await sendRescheduleEmails(
      comTrilhaFalhando(1),
      { newInstanceId: r.data as string, actorUserId: adminUser },
      async (e) => {
        sent.push(e)
      },
    )
    expect(sent, 'a falha de uma leitura só derrubou os e-mails').toHaveLength(2)
    expect(sent.some((e) => e.html.includes('Essa mudança partiu da escola'))).toBe(true)
    expect(sent.some((e) => e.html.includes('sua remarcação foi confirmada'))).toBe(false)
  })

  it('o aluno pediu (com ou sem cortesia): "sua remarcação foi confirmada", e a professora recebe o e-mail de sempre', async () => {
    for (const extras of [{}, { p_courtesy: true, p_courtesy_note: 'perdoado' }]) {
      const k = await cenario()
      const profUser = await comProfessoraLogada(k)
      const r = await CAMINHOS[1].remarcar(admin, k, { p_requested_by: 'student', ...extras })
      expect(r.error, `remarcar recusou: ${r.error?.message}`).toBeNull()

      const sent = await enviados(r.data as string, adminUser)
      const paraAluno = sent.find((e) => e.html.includes('sua remarcação foi confirmada'))
      expect(paraAluno, 'o aluno não recebeu a confirmação de remarcação').toBeDefined()
      expect(paraAluno!.to).toBe(await emailDe(k.alunoUser))
      expect(sent.some((e) => e.html.includes('Essa mudança partiu da escola'))).toBe(false)
      const paraProfessora = sent.find((e) => e.to !== paraAluno!.to)!
      expect(paraProfessora.to).toBe(await emailDe(profUser))
      expect(paraProfessora.subject).not.toContain('remarcada pela escola')
    }
  })
})

describe('#192 · as funções recriadas não ficam abertas (Lei 4)', () => {
  // ⚠️ ACL de função no banco LOCAL é falso-verde para o default privilege de
  // produção (CLAUDE.md, "Armadilhas da bancada") — quem vigia a porta do anon
  // em todas as funções é `tests/acl-higiene.test.ts`. O que este caso prova é o
  // que a migration ESCREVE: uma assinatura só de cada (sem overload vivo) e os
  // grants nominais.
  it('uma assinatura viva de cada, com o parâmetro novo; anon fora; o miolo fechado para clientes', async () => {
    const fns = (await sql`
      select p.proname::text as nome,
             pg_get_function_identity_arguments(p.oid) as args,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as logado
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('book_reschedule_window', 'admin_reschedule_to_new_time',
                           'reschedule_class_at', 'enqueue_reschedule_confirmation')
       order by 1`) as unknown as Array<{ nome: string; args: string; anon: boolean; logado: boolean }>

    expect(fns.map((f) => f.nome)).toEqual([
      'admin_reschedule_to_new_time',
      'book_reschedule_window',
      'enqueue_reschedule_confirmation',
      'reschedule_class_at',
    ])
    const de = (nome: string) => fns.find((f) => f.nome === nome)!
    expect(de('book_reschedule_window').args).toContain('p_requested_by text')
    expect(de('admin_reschedule_to_new_time').args).toContain('p_requested_by text')
    for (const f of fns) expect(f.anon, `${f.nome} executável por anon`).toBe(false)
    expect(de('book_reschedule_window').logado).toBe(true)
    expect(de('admin_reschedule_to_new_time').logado).toBe(true)
    expect(de('enqueue_reschedule_confirmation').logado).toBe(true)
    // o miolo que decide o consumo é interno: nem o logado o chama direto
    expect(de('reschedule_class_at').logado).toBe(false)
  })

  it('a migration revoga EXECUTE nominalmente em cada função que recria', async () => {
    const { sqlDaMigration } = await import('./helpers/definicao-da-funcao')
    const m = sqlDaMigration('20261123000100_remarcacao_admin_quem_pediu.sql').replace(/\s+/g, ' ')
    for (const assinatura of [
      'public.reschedule_class_at(uuid, timestamptz, text, uuid, boolean, text, boolean, boolean) from public, anon, authenticated',
      'public.book_reschedule_window(uuid, uuid, uuid, uuid, boolean, text, boolean, text) from public, anon',
      'public.admin_reschedule_to_new_time(uuid, timestamptz, text, boolean, text, boolean, text) from public, anon',
      'public.enqueue_reschedule_confirmation(uuid) from public, anon, authenticated',
    ])
      expect(m, assinatura).toContain(`revoke execute on function ${assinatura}`)
  })
})
