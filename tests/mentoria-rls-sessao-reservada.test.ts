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

import {
  contratoDeMentoriaAtivo,
  encontrosReservados,
  reservasDeMentoria,
  temMentoriaAtiva,
} from '@/lib/portal/data'
import {
  SEM_LINK_DA_SALA,
  datasParaReservar,
  encontroAindaNaoAcabou,
  encontrosDaTela,
  fraseDoCancelamento,
  podeCancelarNaTela,
} from '@/lib/portal/mentoria'
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
    expect(reservas).toContain('encontroAindaNaoAcabou(e.encontro, agoraMs)')
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
    expect(pagina).toContain('const jaReservadas = new Set((encontros ?? []).map((e) => e.sessionId))')
  })
})

describe('#118 · falha de leitura não vira lista falsa (S3)', () => {
  it('a leitura dos encontros que falha devolve erro, não vazio silencioso', async () => {
    const cliente = {
      rpc: async () => ({ data: ['contrato-da-aluna'], error: null }),
      from: () => ({
        select: () => ({
          in: () => ({
            is: () => ({
              order: async () => ({ data: null, error: { message: 'connection refused' } }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    const leitura = await encontrosReservados(cliente)
    expect(leitura.erro).toBe(true)
    expect(leitura.dado).toEqual([])
  })

  it('a leitura dos contratos da aluna que falha também devolve erro', async () => {
    const cliente = {
      rpc: async () => ({ data: null, error: { message: 'connection refused' } }),
    } as unknown as SupabaseClient
    const leitura = await encontrosReservados(cliente)
    expect(leitura.erro).toBe(true)
    expect(leitura.dado).toEqual([])
  })

  it('pino: o aviso é POR SEÇÃO — a lista de reservadas lida com sucesso fica (rodada 2, S2)', () => {
    const pagina = readFileSync(path.resolve(__dirname, '../src/app/portal/mentoria/page.tsx'), 'utf8')
    // nenhuma falha de leitura derruba mais a página inteira
    expect(pagina).not.toMatch(/if \((reservas|encontrosLidos)\.erro[^)]*\) return/)
    expect(pagina).toContain('{ data: sessions, error: erroDasDatas }')
    // escada: só com as reservas do contrato lidas
    expect(pagina).toContain('const escada = reservas.erro ? null : escadaDasReservas(')
    expect(pagina).toMatch(/escada == null \? \(\s*<AvisoDeLeitura oQue="as suas mentorias liberadas"/)
    // datas: com datas, escada e encontros lidos
    expect(pagina).toContain('const datasConfiaveis = escada != null && encontros != null && !erroDasDatas')
    expect(pagina).toMatch(/!datasConfiaveis \? \(\s*<AvisoDeLeitura oQue="as datas disponíveis"/)
    // reservadas: dependem SÓ da leitura dos encontros
    expect(pagina).toContain('const encontros = encontrosLidos.erro ? null : encontrosDaTela(')
    expect(pagina).toMatch(
      /encontros == null \? \(\s*<AvisoDeLeitura oQue="as suas mentorias reservadas"[\s\S]{0,120}\) : \(\s*<SuasReservas /,
    )
  })
})

/* -------------------------------------------------------------------------- */
/* Rodada 2 de correção (revisor R1, gate Sol S1). Sessões ABERTAS de novo:    */
/* provam a tela, não a política.                                              */
/* -------------------------------------------------------------------------- */

/** Encerra o contrato antigo da aluna e, se pedido, abre um novo para ela. */
async function renovar(antigo: { contractId: string; studentId: string }, abrirNovo: boolean) {
  await sql`update contracts set status = 'ended' where id = ${antigo.contractId}`
  if (!abrirNovo) return null
  const [novo] = await sql`
    insert into contracts (contract_type, student_id, plan_name, hourly_rate_cents, started_on)
    values ('mentorship', ${antigo.studentId}, 'Personal Travel', 7000, current_date)
    returning id`
  await sql`insert into mentorship_contracts (contract_id, course_start_date)
            values (${novo.id}, current_date)`
  return novo.id as string
}

describe('#118 · histórico de contrato encerrado não volta (R1)', () => {
  it('reserva passada de contrato encerrado não aparece na tela do contrato novo', async () => {
    const aluna = await mentorada('Mentorada do ano passado')
    const passada = await createSession(sql, { capacity: 4, inDays: 10 })
    await reservar(aluna.client, passada)
    // o encontro aconteceu (começou há 3 h, durou 60 min)
    await sql`update mentorship_sessions
                 set scheduled_at = now() - interval '3 hours', duration_min = 60
               where id = ${passada}`
    try {
      const novo = await renovar(aluna, true)
      const { dado, erro } = await encontrosReservados(aluna.client)
      expect(erro).toBe(false)
      expect(dado.map((r) => r.sessionId)).toContain(passada)

      // na tela do contrato novo, o histórico antigo não entra
      const naTela = encontrosDaTela(dado, novo, Date.now())
      expect(naTela.map((r) => r.sessionId)).not.toContain(passada)
      // na tela do próprio contrato, o histórico segue como na main
      expect(encontrosDaTela(dado, aluna.contractId, Date.now()).map((r) => r.sessionId)).toContain(passada)
    } finally {
      await sql`update mentorship_sessions set status = 'done' where id = ${passada}`
    }
  })

  it('regra pura: contrato ativo mostra tudo; outro contrato, só o que não acabou', () => {
    const agora = Date.now()
    const ha = (min: number) => new Date(agora - min * 60_000).toISOString()
    const r = (id: string, contractId: string, inicio: string | null) => ({
      id,
      contractId,
      encontro: inicio ? { scheduledAt: inicio, durationMin: 60 } : null,
    })
    const lidas = [
      r('ativo-passado', 'ativo', ha(180)),
      r('ativo-futuro', 'ativo', ha(-60)),
      r('antigo-passado', 'antigo', ha(180)),
      r('antigo-andamento', 'antigo', ha(10)),
      r('antigo-futuro', 'antigo', ha(-60)),
      r('antigo-sem-encontro', 'antigo', null),
    ]
    expect(encontrosDaTela(lidas, 'ativo', agora).map((e) => e.id)).toEqual([
      'ativo-passado',
      'ativo-futuro',
      'antigo-andamento',
      'antigo-futuro',
    ])
    // sem contrato ativo: só o que ainda não acabou
    expect(encontrosDaTela(lidas, null, agora).map((e) => e.id)).toEqual([
      'ativo-futuro',
      'antigo-andamento',
      'antigo-futuro',
    ])
  })
})

describe('#118 · contrato terminou, encontro futuro continua visível (S1)', () => {
  it('sem contrato ativo, a reserva futura aparece e a aba Mentoria continua', async () => {
    const aluna = await mentorada('Mentorada contrato encerrado')
    const futura = await createSession(sql, { capacity: 4, inDays: 10 })
    await sql`update mentorship_sessions set gmeet_url = 'https://meet.google.com/abc-defg-hij' where id = ${futura}`
    await reservar(aluna.client, futura)
    await renovar(aluna, false)

    const { dado, erro } = await encontrosReservados(aluna.client)
    expect(erro).toBe(false)
    const porVir = encontrosDaTela(dado, null, Date.now())
    expect(porVir.map((r) => r.sessionId)).toEqual([futura])
    expect(porVir[0].encontro?.meetUrl).toBe('https://meet.google.com/abc-defg-hij')

    expect(await temMentoriaAtiva(aluna.client)).toBe(true)
  })

  it('sem contrato ativo e sem encontro por vir, a aba some como hoje', async () => {
    const aluna = await mentorada('Mentorada sem nada por vir')
    await renovar(aluna, false)
    expect(await temMentoriaAtiva(aluna.client)).toBe(false)
  })

  it('pino: sem contrato, a página lê as reservas antes de dizer "não faz parte"', () => {
    const pagina = readFileSync(path.resolve(__dirname, '../src/app/portal/mentoria/page.tsx'), 'utf8')
    const semContrato = pagina.slice(pagina.indexOf('if (!contract) {'), pagina.indexOf('const [\n    { data: mc },'))
    expect(semContrato).toContain('encontrosReservados(supabase)')
    expect(semContrato).toContain('const porVir = encontrosDaTela(lidos.dado, null, agora.getTime())')
    expect(semContrato.indexOf('porVir.length === 0')).toBeLessThan(semContrato.indexOf('não faz parte'))
    expect(semContrato).toMatch(/<SuasReservas\s+encontros=\{porVir\}/)
    // falha de leitura não vira "você não faz parte"
    expect(semContrato).toMatch(/if \(lidos\.erro\)[\s\S]{0,120}<AvisoDeLeitura /)
  })
})

/* -------------------------------------------------------------------------- */
/* Sessão manual (achados em aberto da rodada 3). Sessões ABERTAS: provam a    */
/* tela, não a política.                                                       */
/* -------------------------------------------------------------------------- */

describe('#118 · cancelar só a reserva do contrato ativo (dinheiro)', () => {
  const agora = Date.now()
  const daqui = (horas: number) => new Date(agora + horas * 3600_000).toISOString()
  const reserva = (contractId: string, inicio: string | null) => ({
    contractId,
    encontro: inicio ? { scheduledAt: inicio } : null,
  })

  it('regra pura: só o contrato ativo, só a mais de 24 h', () => {
    expect(podeCancelarNaTela(reserva('ativo', daqui(48)), 'ativo', agora)).toBe(true)
    // outro contrato da aluna (encerrado, ou o anterior à renovação)
    expect(podeCancelarNaTela(reserva('antigo', daqui(48)), 'ativo', agora)).toBe(false)
    // sem contrato ativo nenhum
    expect(podeCancelarNaTela(reserva('antigo', daqui(48)), null, agora)).toBe(false)
    // dentro das 24 h, ou sem o encontro lido
    expect(podeCancelarNaTela(reserva('ativo', daqui(23)), 'ativo', agora)).toBe(false)
    expect(podeCancelarNaTela(reserva('ativo', null), 'ativo', agora)).toBe(false)
  })

  it('frase do saldo: nenhuma sem contrato; após renovação, diz que é do curso atual', () => {
    const r = (contractId: string, horas: number) => ({
      contractId,
      encontro: { scheduledAt: daqui(horas), durationMin: 60 },
    })
    const sempre = 'Dá para cancelar até 24 horas antes do encontro — a mentoria volta para o seu saldo.'
    // sem contrato ativo, nada promete saldo
    expect(fraseDoCancelamento([r('antigo', 48)], null, agora)).toBeNull()
    // renovou e a única reserva por vir é do contrato antigo: a frase não fala dela
    const doAtual = fraseDoCancelamento([r('antigo', 48)], 'ativo', agora)
    expect(doAtual).not.toBe(sempre)
    expect(doAtual).toMatch(/^As reservas do seu curso atual podem ser canceladas/)
    // só reservas do contrato ativo (ou nenhuma): a frase de sempre
    expect(fraseDoCancelamento([r('ativo', 48)], 'ativo', agora)).toBe(sempre)
    expect(fraseDoCancelamento([], 'ativo', agora)).toBe(sempre)
    // reserva antiga que já acabou não muda a frase
    expect(fraseDoCancelamento([r('antigo', -3)], 'ativo', agora)).toBe(sempre)
  })

  it('dois contratos ativos (renovação em curso): a leitura avisa, e a tela não oferece cancelar', async () => {
    const aluna = await mentorada('Mentorada com dois ativos')
    const sessao = await createSession(sql, { capacity: 4, inDays: 10 })
    await reservar(aluna.client, sessao)
    const [novo] = await sql`
      insert into contracts (contract_type, student_id, plan_name, hourly_rate_cents, started_on)
      values ('mentorship', ${aluna.studentId}, 'Personal Travel', 7000, current_date)
      returning id`
    await sql`insert into mentorship_contracts (contract_id, course_start_date)
              values (${novo.id}, current_date)`

    const { contrato, erro } = await contratoDeMentoriaAtivo(aluna.client)
    expect(erro).toBe(false)
    expect(contrato?.varios).toBe(true)
    // com `varios`, a tela passa null: nenhuma reserva ganha o botão
    const { dado } = await encontrosReservados(aluna.client)
    const reserva = dado.find((r) => r.sessionId === sessao)!
    expect(podeCancelarNaTela(reserva, contrato!.varios ? null : contrato!.id, Date.now())).toBe(false)

    // com um contrato só, o mesmo caminho dá o botão (o teste acima não é vazio)
    await sql`update contracts set status = 'ended' where id = ${novo.id}`
    const umSo = await contratoDeMentoriaAtivo(aluna.client)
    expect(umSo.contrato).toEqual({ id: aluna.contractId, varios: false })
    expect(podeCancelarNaTela(reserva, umSo.contrato!.id, Date.now())).toBe(true)
  })

  it('a reserva do contrato antigo, depois da renovação, não ganha o botão', async () => {
    const aluna = await mentorada('Mentorada renovou e cancela')
    const sessao = await createSession(sql, { capacity: 4, inDays: 10 })
    await reservar(aluna.client, sessao)
    const novo = await renovar(aluna, true)

    const { dado, erro } = await encontrosReservados(aluna.client)
    expect(erro).toBe(false)
    const antiga = dado.find((r) => r.sessionId === sessao)
    expect(antiga).toBeDefined()
    expect(podeCancelarNaTela(antiga!, novo, Date.now())).toBe(false)
    expect(podeCancelarNaTela(antiga!, null, Date.now())).toBe(false)
  })

  it('pino: o botão e a frase do saldo dependem do contrato ativo', () => {
    const pagina = readFileSync(path.resolve(__dirname, '../src/app/portal/mentoria/page.tsx'), 'utf8')
    const lista = pagina.slice(pagina.indexOf('function SuasReservas('))
    // o único botão de cancelar da lista sai da regra do contrato ativo
    expect(lista.match(/cancelMyMentorshipBookingAction/g)).toHaveLength(1)
    expect(lista).toMatch(/podeCancelarNaTela\(e, contratoAtivo, agoraMs\) && \(\s*<BotaoDeAcao\s+acao=\{cancelMyMentorshipBookingAction\}/)
    expect(lista).not.toContain('corteDe24h')
    // a frase do saldo sai da regra pura, que conhece o contrato de cada reserva
    expect(lista).toContain('const frase = fraseDoCancelamento(encontros, contratoAtivo, agoraMs)')
    expect(lista).toContain('{frase && <p className="text-sm text-ink-600">{frase}</p>}')
    expect(lista).not.toContain('Dá para cancelar até 24 horas antes')
    // reserva de outro contrato vai para o atendimento
    expect(lista).toContain('e.contractId !== contratoAtivo && Date.parse(sess.scheduledAt) > agoraMs')
    expect(lista).toContain('Para mudar esta reserva, {FALE_COM_A_GENTE}.')
    // a tela sem contrato ativo passa null; a com contrato, o contrato dela
    expect(pagina).toMatch(/<SuasReservas\s+encontros=\{porVir\}\s+contratoAtivo=\{null\}/)
    expect(pagina).toContain('const contratoDaLista = contract.varios ? null : contract.id')
    expect(pagina).toContain('<SuasReservas encontros={encontros} contratoAtivo={contratoDaLista}')
    // e o canal do atendimento aparece também na tela sem contrato ativo
    const semContrato = pagina.slice(pagina.indexOf('if (!contract) {'), pagina.indexOf('const [\n    { data: mc },'))
    expect(semContrato).toMatch(/contratoAtivo=\{null\}[\s\S]{0,300}<Atendimento \/>/)
  })
})

describe('#118 · a admin no portal não vê as reservas das alunas como suas', () => {
  it('encontrosReservados com o cliente admin não traz a reserva da aluna', async () => {
    const aluna = await mentorada('Mentorada vista pela admin')
    const sessao = await createSession(sql, { capacity: 4, inDays: 10 })
    await reservar(aluna.client, sessao)

    // a admin lê a reserva pela RLS (admin_all)…
    const { data: direto } = await admin.from('mentorship_bookings').select('session_id').eq('session_id', sessao)
    expect(direto?.length).toBe(1)
    // …mas a leitura do portal fica só com as reservas de quem está logada
    const { dado, erro } = await encontrosReservados(admin)
    expect(erro).toBe(false)
    expect(dado.map((r) => r.sessionId)).not.toContain(sessao)

    // e a aluna continua vendo a dela
    const daAluna = await encontrosReservados(aluna.client)
    expect(daAluna.dado.map((r) => r.sessionId)).toContain(sessao)
  })
})
