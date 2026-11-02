// #118 — a aluna de mentoria continua vendo o encontro que ela reservou.
//
// Antes, a política `mentorship_sessions_open_to_mentees` só deixava a
// mentorada ler sessão 'open'. A última vaga reservada vira a sessão para
// 'full' e ela SUMIA justamente para quem tinha reserva nela: a página de
// mentoria perdia data, hora e link da sala e caía em "os detalhes chegam pelo
// WhatsApp". A regra nova (Lei 4): a aluna lê a sessão aberta OU a sessão em
// que tem reserva ATIVA, qualquer que seja o status; nunca a reserva alheia.
//
// Tudo aqui passa pelo PostgREST com o cliente da própria aluna (RLS de
// verdade), lendo as mesmas colunas que `/portal/mentoria` lê.
import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { encontrosReservados, reservasDeMentoria } from '@/lib/portal/data'
import { SEM_LINK_DA_SALA, datasParaReservar, encontroAindaNaoAcabou } from '@/lib/portal/mentoria'
import { anonClient, clientAs, createAuthUser } from './helpers/auth'
import { connect, createMentorshipContract, createSession } from './helpers/db'

let sql: Sql
let admin: SupabaseClient

beforeAll(async () => {
  sql = connect(3)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin sessao reservada'), 'admin')
})
afterAll(async () => {
  await sql.end()
})

/** As colunas que a página de mentoria pede de cada sessão. */
const COLUNAS_DA_PAGINA = 'id, scheduled_at, duration_min, capacity, booked_count, gmeet_url, status'

/** Uma mentorada com contrato ativo, 1ª etapa liberada e cliente logado. */
async function mentorada(rotulo: string) {
  const m = await createMentorshipContract(sql, {
    courseStartMonthsAgo: 1,
    thresholds: { 1: 0 },
    completionPct: 100,
  })
  const userId = await createAuthUser(sql, 'student', rotulo)
  await sql`update students set profile_id = ${userId} where id = ${m.studentId}`
  return { ...m, client: await clientAs(userId, 'student') }
}

async function reservar(client: SupabaseClient, sessionId: string): Promise<string> {
  const { data, error } = await client.rpc('book_my_mentorship_session', { p_session: sessionId })
  expect(error).toBeNull()
  return data as string
}

async function sessoesVistas(client: SupabaseClient, ids: string[]) {
  const { data, error } = await client
    .from('mentorship_sessions')
    .select(COLUNAS_DA_PAGINA)
    .gte('scheduled_at', new Date().toISOString())
    .in('id', ids)
  expect(error).toBeNull()
  return data ?? []
}

/** Duas alunas reservam as duas vagas da mesma sessão: ela lota. */
async function sessaoLotadaPelasDuas(gmeetUrl: string | null) {
  const a = await mentorada('Mentorada A')
  const b = await mentorada('Mentorada B')
  const sessao = await createSession(sql, { capacity: 2, inDays: 10 })
  await sql`update mentorship_sessions set gmeet_url = ${gmeetUrl} where id = ${sessao}`
  const reservaA = await reservar(a.client, sessao)
  const reservaB = await reservar(b.client, sessao)
  return { a, b, sessao, reservaA, reservaB }
}

describe('#118 · a sessão lotada continua visível para quem reservou', () => {
  it('as duas alunas veem a sessão full que reservaram, com o link da sala', async () => {
    const { a, b, sessao } = await sessaoLotadaPelasDuas('https://meet.google.com/abc-defg-hij')

    const [estado] = await sql`select status from mentorship_sessions where id = ${sessao}`
    expect(estado.status).toBe('full')

    for (const aluna of [a, b]) {
      const vistas = await sessoesVistas(aluna.client, [sessao])
      expect(vistas).toHaveLength(1)
      expect(vistas[0].gmeet_url).toBe('https://meet.google.com/abc-defg-hij')
    }
  })

  it('nenhuma vê a reserva da outra', async () => {
    const { a, b, sessao, reservaA, reservaB } = await sessaoLotadaPelasDuas(null)

    const daA = await a.client.from('mentorship_bookings').select('id').eq('session_id', sessao)
    expect(daA.error).toBeNull()
    expect((daA.data ?? []).map((r) => r.id)).toEqual([reservaA])

    const daB = await b.client.from('mentorship_bookings').select('id').eq('session_id', sessao)
    expect(daB.error).toBeNull()
    expect((daB.data ?? []).map((r) => r.id)).toEqual([reservaB])
  })

  it('sessão full em que a aluna NÃO tem reserva continua invisível', async () => {
    const a = await mentorada('Mentorada sem reserva')
    const alheia = await createSession(sql, { capacity: 1, bookedCount: 1, status: 'full', inDays: 10 })
    expect(await sessoesVistas(a.client, [alheia])).toHaveLength(0)
  })

  it('anon não lê nada, nem a sessão lotada', async () => {
    const { sessao } = await sessaoLotadaPelasDuas('https://meet.google.com/abc-defg-hij')
    const { data, error } = await anonClient()
      .from('mentorship_sessions')
      .select('id')
      .eq('id', sessao)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('sessão aberta sem reserva da aluna continua visível para reservar', async () => {
    const a = await mentorada('Mentorada escolhendo')
    const aberta = await createSession(sql, { capacity: 4, inDays: 10 })
    expect(await sessoesVistas(a.client, [aberta])).toHaveLength(1)
  })

  it('sessão cancelada onde a aluna tinha reserva segue invisível, como hoje', async () => {
    const a = await mentorada('Mentorada cancelada')
    const sessao = await createSession(sql, { capacity: 1, inDays: 10 })
    await reservar(a.client, sessao)
    expect(await sessoesVistas(a.client, [sessao])).toHaveLength(1)

    const { error } = await admin.rpc('cancel_mentorship_session', { p_session: sessao })
    expect(error).toBeNull()
    // o aviso de cancelamento que a RPC enfileira é fixture deste teste
    await sql`update notification_outbox set sent_at = now()
               where sent_at is null and template = 'meeting-cancelled'
                 and payload->>'session_id' = ${sessao}::text`

    expect(await sessoesVistas(a.client, [sessao])).toHaveLength(0)
  })
})

describe('#118 · a página de mentoria mostra a sessão reservada', () => {
  const pagina = readFileSync(path.resolve(__dirname, '../src/app/portal/mentoria/page.tsx'), 'utf8')

  it('a leitura das sessões não filtra status (a RLS decide) e mantém o corte do passado', () => {
    const consulta = pagina.slice(pagina.indexOf(".from('mentorship_sessions')"))
    const ateOrder = consulta.slice(0, consulta.indexOf('.order('))
    expect(ateOrder).not.toMatch(/\.(eq|neq|in|not|filter|match)\(\s*'status'/)
    // histórico (sessão passada) segue a regra de hoje: fora da lista de sessões
    expect(ateOrder).toContain(".gte('scheduled_at', agora.toISOString())")
  })

  it('a sessão lotada que a RLS agora devolve nunca vira data para reservar', async () => {
    const { a, sessao } = await sessaoLotadaPelasDuas('https://meet.google.com/abc-defg-hij')
    const aberta = await createSession(sql, { capacity: 4, inDays: 11 })
    const vistas = await sessoesVistas(a.client, [sessao, aberta])
    expect(vistas.map((s) => s.id).sort()).toEqual([sessao, aberta].sort())

    // reservada por ESTE contrato: sai da lista pelas reservas da tela
    expect(datasParaReservar(vistas, new Set([sessao])).map((s) => s.id)).toEqual([aberta])
    // reservada por OUTRO contrato da aluna (fora das reservas desta tela): a
    // sessão lotada continua fora, porque só sessão aberta é data para reservar
    expect(datasParaReservar(vistas, new Set()).map((s) => s.id)).toEqual([aberta])

    expect(pagina).toContain('const disponiveis = datasParaReservar(sessions, jaReservadas)')
    expect(pagina).toContain('const escolhida = escolha ? disponiveis.find((s) => s.id === escolha) : undefined')
  })

  it('sessão reservada com link mostra o botão; sem link, o texto da escola', () => {
    expect(SEM_LINK_DA_SALA).toBe('O link da sala será enviado pela escola.')
    expect(SEM_LINK_DA_SALA).not.toMatch(/WhatsApp/)
    const reservas = pagina.slice(pagina.indexOf('Suas mentorias reservadas'))
    expect(reservas).toMatch(/sess\?\.meetUrl && \(\s*<a href=\{sess\.meetUrl\}/)
    expect(reservas).toMatch(/sess && !sess\.meetUrl && \([\s\S]{0,200}\{SEM_LINK_DA_SALA\}/)
    // a lista de reservadas sai da leitura própria, cortada pelo FIM
    expect(reservas).toContain('encontros.map((e) =>')
    expect(reservas).toContain('encontroAindaNaoAcabou(e.encontro, agora.getTime())')
  })
})

/* -------------------------------------------------------------------------- */
/* Rodada 1 de correção (gate Sol S1-S3, revisor R1). Estes casos usam sessão  */
/* ABERTA, que a aluna já lia antes do #118: provam a tela, não a política.    */
/* -------------------------------------------------------------------------- */

describe('#118 · o encontro que já começou mantém o link (S1)', () => {
  it('entre o início e o fim do encontro, a reserva continua com data e link', async () => {
    const a = await mentorada('Mentorada atrasada')
    const sessao = await createSession(sql, { capacity: 4, inDays: 10 })
    await sql`update mentorship_sessions set gmeet_url = 'https://meet.google.com/abc-defg-hij' where id = ${sessao}`
    await reservar(a.client, sessao)
    // o encontro começou há 10 minutos e dura 60
    await sql`update mentorship_sessions
                 set scheduled_at = now() - interval '10 minutes', duration_min = 60
               where id = ${sessao}`
    try {
      const { dado, erro } = await encontrosReservados(a.client)
      expect(erro).toBe(false)
      const e = dado.find((r) => r.sessionId === sessao)
      expect(e?.encontro?.meetUrl).toBe('https://meet.google.com/abc-defg-hij')
      expect(encontroAindaNaoAcabou(e!.encontro!, Date.now())).toBe(true)

      // a lista de DATAS continua cortando pelo começo: já começou, não se reserva
      const datas = await sessoesVistas(a.client, [sessao])
      expect(datas).toHaveLength(0)
    } finally {
      // fixture deste teste: não deixa sessão aberta no passado na bancada
      await sql`update mentorship_sessions set status = 'done' where id = ${sessao}`
    }
  })

  it('o corte é pelo fim: começou há 10 min e dura 60 fica; acabou, sai', () => {
    const agora = Date.now()
    const ha = (min: number) => new Date(agora - min * 60_000).toISOString()
    expect(encontroAindaNaoAcabou({ scheduledAt: ha(10), durationMin: 60 }, agora)).toBe(true)
    expect(encontroAindaNaoAcabou({ scheduledAt: ha(-60), durationMin: 60 }, agora)).toBe(true)
    expect(encontroAindaNaoAcabou({ scheduledAt: ha(61), durationMin: 60 }, agora)).toBe(false)
    expect(encontroAindaNaoAcabou({ scheduledAt: ha(60), durationMin: 60 }, agora)).toBe(false)
  })
})

describe('#118 · reserva de outro contrato da aluna (S2)', () => {
  it('aparece entre as reservadas e sai das datas, mesmo com vaga sobrando', async () => {
    const antigo = await mentorada('Mentorada renovou')
    const sessao = await createSession(sql, { capacity: 4, inDays: 10 })
    const aberta = await createSession(sql, { capacity: 4, inDays: 11 })
    await sql`select public.book_mentorship_session(${sessao}, ${antigo.contractId})`
    // o contrato antigo encerra e um novo começa para a MESMA aluna
    await sql`update contracts set status = 'ended' where id = ${antigo.contractId}`
    const [novo] = await sql`
      insert into contracts (contract_type, student_id, plan_name, hourly_rate_cents, started_on)
      values ('mentorship', ${antigo.studentId}, 'Personal Travel', 7000, current_date)
      returning id`
    await sql`insert into mentorship_contracts (contract_id, course_start_date)
              values (${novo.id}, current_date)`

    // a escada do contrato novo não tem reserva nenhuma…
    const escada = await reservasDeMentoria(antigo.client, novo.id as string)
    expect(escada.dado).toHaveLength(0)

    // …mas a reserva do contrato antigo continua sendo dela
    const { dado, erro } = await encontrosReservados(antigo.client)
    expect(erro).toBe(false)
    expect(dado.map((r) => r.sessionId)).toContain(sessao)

    // e a sessão, ainda aberta, não é oferecida de novo
    const jaReservadas = new Set(dado.map((r) => r.sessionId))
    const vistas = await sessoesVistas(antigo.client, [sessao, aberta])
    expect(vistas.map((s) => s.id).sort()).toEqual([sessao, aberta].sort())
    expect(datasParaReservar(vistas, jaReservadas).map((s) => s.id)).toEqual([aberta])
  })

  it('pino: as datas saem das reservas de TODOS os contratos, não da escada', () => {
    const pagina = readFileSync(path.resolve(__dirname, '../src/app/portal/mentoria/page.tsx'), 'utf8')
    expect(pagina).toContain('const jaReservadas = new Set(encontros.map((e) => e.sessionId))')
  })
})

describe('#118 · falha de leitura não vira lista falsa (S3)', () => {
  it('a leitura dos encontros que falha devolve erro, não vazio silencioso', async () => {
    const cliente = {
      from: () => ({
        select: () => ({
          is: () => ({
            order: async () => ({ data: null, error: { message: 'connection refused' } }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    const leitura = await encontrosReservados(cliente)
    expect(leitura.erro).toBe(true)
    expect(leitura.dado).toEqual([])
  })

  it('pino: falha nos encontros ou nas datas troca a tela pelo aviso da casa, antes da lista', () => {
    const pagina = readFileSync(path.resolve(__dirname, '../src/app/portal/mentoria/page.tsx'), 'utf8')
    expect(pagina).toContain('{ data: sessions, error: erroDasDatas }')
    expect(pagina).toContain('if (encontrosLidos.erro || erroDasDatas) return <AvisoDeLeituraDaMentoria />')
    expect(pagina).toMatch(/function AvisoDeLeituraDaMentoria\(\)[\s\S]{0,200}<AvisoDeLeitura /)
    const corte = pagina.indexOf('if (encontrosLidos.erro || erroDasDatas)')
    expect(corte).toBeLessThan(pagina.indexOf('const encontros = encontrosLidos.dado'))
    expect(corte).toBeLessThan(pagina.indexOf('datasParaReservar(sessions'))
  })
})
