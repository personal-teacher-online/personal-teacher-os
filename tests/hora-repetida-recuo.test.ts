// Issue #40 — a hora REPETIDA da noite de recuo (fim do horário de verão) não
// pode depender da época do ano em que o servidor faz a conta.
//
// Medido na PR #38 (caso P9 de `m3-c7-revisao-8.test.ts`): o Luxon 3.7.2
// resolve "01:30 em Lisboa" na noite de recuo partindo do offset de AGORA. Com
// o servidor no verão ele lê a PRIMEIRA passagem; no inverno, a SEGUNDA. As
// duas checagens de conflito ao publicar janela (`windowPublishConflict` e
// `googleWindowClash`) herdavam isso: no verão acusavam conflito com o que
// estivesse na primeira passagem, no inverno não.
//
// O publicar da professora já RECUSA hora ambígua (`conferirHoraCivil`, o a4):
// as duas checagens passam a usar a mesma conversão e, quando a hora não tem
// leitura única, não acusam nada — a recusa de DST vem logo depois, na action.
// Cada caso roda com o relógio do Luxon dos DOIS lados do ano e cobra o MESMO
// resultado. A data é a PRÓXIMA noite de recuo de Lisboa, nunca cravada.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { DateTime, Settings } from 'luxon'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { GcalEventLite, GcalPort } from '../src/lib/google/calendar'
import { instanteNaPrimeiraPassagem } from '../src/lib/admin/hora-civil'
import { googleWindowClash } from '../src/lib/google/sync'
import { encryptToken, tokenKeyFromEnv } from '../src/lib/google/token-crypto'
import { windowPublishConflict } from '../src/lib/windows'
import { serviceClient } from './helpers/auth'
import { connect, createInstanceAt, createPrivateContract, proximoRecuo } from './helpers/db'

let sql: Sql
let service: SupabaseClient

beforeAll(async () => {
  sql = connect(2)
  service = serviceClient()
  // Envs da integração SÓ deste worker (padrão de google-calendar.test.ts):
  // valores fake, a porta do Google é injetada (sem rede).
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client.apps.googleusercontent.com'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret'
  process.env.GOOGLE_TOKEN_KEY = randomBytes(32).toString('base64')
})
afterAll(async () => {
  await sql.end()
})

const LISBOA = 'Europe/Lisbon'
const meioDia = { hour: 12, minute: 0 }

/** Roda `f` com o relógio do Luxon parado em `agora` — é dele que o Luxon tira
 *  o palpite de offset da hora repetida (o mecanismo medido no P9). */
async function comRelogioEm<T>(agora: DateTime, f: () => Promise<T>): Promise<T> {
  const original = Settings.now
  Settings.now = () => agora.toMillis()
  try {
    return await f()
  } finally {
    Settings.now = original
  }
}

/** A noite de recuo, a primeira passagem de 01:30 (WEST, UTC+1 = 00:30Z) e os
 *  dois relógios: véspera ao meio-dia (verão) e dia seguinte (inverno). */
function cenarioDoRecuo() {
  const recuo = proximoRecuo(LISBOA)
  const dia = recuo.toISODate()!
  const primeiraPassagem = DateTime.fromISO(`${dia}T00:30:00Z`, { zone: 'utc' })
  const verao = recuo.minus({ days: 1 }).set(meioDia)
  const inverno = recuo.plus({ days: 1 }).set(meioDia)
  expect(verao.isInDST).toBe(true)
  expect(inverno.isInDST).toBe(false)
  return { dia, primeiraPassagem, verao, inverno }
}

describe('#40 · instanteNaPrimeiraPassagem (grade da professora, grade da dona, período)', () => {
  it('01:30 repetida em Lisboa: a primeira passagem com o servidor no verão e no inverno', async () => {
    const { dia, primeiraPassagem, verao, inverno } = cenarioDoRecuo()
    const ler = (agora: DateTime) =>
      comRelogioEm(agora, async () => instanteNaPrimeiraPassagem(dia, '01:30:00', LISBOA).toUTC().toISO())
    expect(await ler(verao)).toBe(primeiraPassagem.toISO())
    expect(await ler(inverno)).toBe(primeiraPassagem.toISO())
  })

  it('hora fora da madrugada repetida não muda: a única leitura, o mesmo instante nos dois relógios', async () => {
    const { dia, verao, inverno } = cenarioDoRecuo()
    const ler = (agora: DateTime) =>
      comRelogioEm(agora, async () => instanteNaPrimeiraPassagem(dia, '10:00', LISBOA).toUTC().toISO())
    // depois do recuo Lisboa está em WET (UTC+0): 10:00 local = 10:00Z
    expect(await ler(verao)).toBe(`${dia}T10:00:00.000Z`)
    expect(await ler(inverno)).toBe(`${dia}T10:00:00.000Z`)
  })
})

describe('#40 · windowPublishConflict na noite de recuo', () => {
  it('01:30 repetida em Lisboa: o mesmo resultado com o servidor no verão e no inverno', async () => {
    const { dia, primeiraPassagem, verao, inverno } = cenarioDoRecuo()
    const c = await createPrivateContract(sql)
    await sql`update teachers set iana_tz = ${LISBOA} where id = ${c.teacherId}`
    // Aula agendada na PRIMEIRA passagem: é o instante que a leitura de verão
    // do Luxon acusava como conflito.
    await createInstanceAt(sql, c, primeiraPassagem.toISO()!)

    const noVerao = await comRelogioEm(verao, () =>
      windowPublishConflict(service, c.teacherId, dia, '01:30'),
    )
    const noInverno = await comRelogioEm(inverno, () =>
      windowPublishConflict(service, c.teacherId, dia, '01:30'),
    )
    expect(noVerao).toBe(noInverno)
    // A hora não tem leitura única: nada a acusar aqui — quem recusa é a
    // conferência da hora civil, na action, logo depois.
    expect(noVerao).toBeNull()
  })
})

describe('#40 · googleWindowClash na noite de recuo', () => {
  it('01:30 repetida em Lisboa: o mesmo resultado com o servidor no verão e no inverno', async () => {
    const { dia, primeiraPassagem, verao, inverno } = cenarioDoRecuo()
    const key = tokenKeyFromEnv()!
    const c = await createPrivateContract(sql)
    await sql`update teachers set iana_tz = ${LISBOA} where id = ${c.teacherId}`
    await sql`insert into teacher_google_accounts (teacher_id, google_email, refresh_token_cipher)
              values (${c.teacherId}, 'recuo@exemplo.com', ${encryptToken('rt-recuo', key)})`
    // Compromisso pessoal na PRIMEIRA passagem: a leitura de verão via
    // "ocupado"; a de inverno, "livre".
    const afazer: GcalEventLite = {
      id: 'afazer-recuo',
      key: null,
      startUtc: primeiraPassagem.toISO({ suppressMilliseconds: true })!,
      endUtc: primeiraPassagem.plus({ minutes: 45 }).toISO({ suppressMilliseconds: true })!,
      summary: 'Compromisso',
      transparent: false,
    }
    const naoGrava = async (): Promise<never> => {
      throw new Error('a checagem não grava')
    }
    const port: GcalPort = {
      listOurs: async () => [],
      listAll: async () => [afazer],
      insert: naoGrava,
      patch: naoGrava,
      remove: naoGrava,
    }

    const noVerao = await comRelogioEm(verao, () =>
      googleWindowClash(service, c.teacherId, dia, '01:30', () => port),
    )
    const noInverno = await comRelogioEm(inverno, () =>
      googleWindowClash(service, c.teacherId, dia, '01:30', () => port),
    )
    expect(noVerao).toEqual(noInverno)
    expect(noVerao).toEqual({ status: 'indisponivel' })
  })
})
