// ADR-017 — Google Agenda da professora. Núcleo testado SEM rede: cripto do
// refresh token (roundtrip + adulteração), diff idempotente/auto-corretivo,
// montagem dos eventos desejados a partir do banco (aula + janela) e a regra
// de privacidade dos afazeres (só horários; nossos eventos e "disponível" fora).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  desiredEventsForTeacher,
  diffCalendar,
  googleBusyBlocks,
  syncTeacherGoogleCalendar,
  type DesiredEvent,
  type GcalEventLite,
  type GcalPort,
} from '../src/lib/google/calendar'
import { isPublicPath } from '../src/lib/auth/gate'
import { googleWindowClash, handleGcalSync, syncGoogleCalendars } from '../src/lib/google/sync'
import { decryptToken, encryptToken, tokenKeyFromEnv } from '../src/lib/google/token-crypto'
import { clientAs, createAuthUser, serviceClient } from './helpers/auth'
import {
  connect,
  createInstance,
  createPrivateContract,
  createTeacher,
  daysFromToday,
  instanteEm,
} from './helpers/db'

let sql: Sql
let admin: SupabaseClient
let service: SupabaseClient

beforeAll(async () => {
  sql = connect(5)
  admin = await clientAs(await createAuthUser(sql, 'admin', 'Admin gcal'), 'admin')
  service = serviceClient()
  // Envs da integração SÓ deste worker: o orquestrador exige config presente
  // (sem ela é no-op deliberado) — valores fake, a porta é injetada (sem rede).
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client.apps.googleusercontent.com'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret'
  process.env.GOOGLE_TOKEN_KEY = randomBytes(32).toString('base64')
})
afterAll(async () => {
  await sql.end()
})

const RANGE = {
  fromUtcISO: new Date(Date.now() - 60_000).toISOString(),
  toUtcISO: new Date(Date.now() + 56 * 24 * 3600 * 1000).toISOString(),
}

describe('token-crypto (AES-256-GCM)', () => {
  const key = randomBytes(32)

  it('roundtrip devolve o token; blobs de mesma entrada diferem (IV aleatório)', () => {
    const a = encryptToken('1//refresh-token-fake', key)
    const b = encryptToken('1//refresh-token-fake', key)
    expect(a).not.toBe(b)
    expect(decryptToken(a, key)).toBe('1//refresh-token-fake')
    expect(a).not.toContain('refresh-token-fake')
  })

  it('adulteração ou chave errada = exceção (nunca token corrompido em silêncio)', () => {
    const blob = encryptToken('segredo', key)
    const [v, iv, tag, ct] = blob.split('.')
    const flipped = Buffer.from(ct, 'base64')
    flipped[0] ^= 0xff
    expect(() => decryptToken([v, iv, tag, flipped.toString('base64')].join('.'), key)).toThrow()
    expect(() => decryptToken(blob, randomBytes(32))).toThrow()
    expect(() => decryptToken('v0.a.b.c', key)).toThrow('formato')
  })
})

function lite(over: Partial<GcalEventLite>): GcalEventLite {
  return {
    id: 'ev-' + Math.random().toString(36).slice(2, 8),
    key: null,
    startUtc: null,
    endUtc: null,
    summary: null,
    transparent: false,
    ...over,
  }
}

function desired(over: Partial<DesiredEvent>): DesiredEvent {
  return {
    key: 'aula:x',
    startUtc: '2026-08-01T14:00:00.000Z',
    endUtc: '2026-08-01T14:45:00.000Z',
    summary: 'Aula — Teste',
    transparent: false,
    ...over,
  }
}

describe('diffCalendar (puro)', () => {
  it('converge: insere o que falta, corrige o que mudou, remove órfão e duplicado', () => {
    const want = [
      desired({ key: 'aula:1' }),
      desired({ key: 'aula:2', startUtc: '2026-08-02T14:00:00.000Z', endUtc: '2026-08-02T14:45:00.000Z' }),
    ]
    const have = [
      // igual (formato de offset diferente — mesmo instante ⇒ intocado)
      lite({ id: 'ok', key: 'aula:1', startUtc: '2026-08-01T11:00:00-03:00', endUtc: '2026-08-01T11:45:00-03:00', summary: 'Aula — Teste' }),
      // duplicado da mesma chave (corrida de dois syncs) ⇒ some
      lite({ id: 'dup', key: 'aula:1', startUtc: '2026-08-01T14:00:00Z', endUtc: '2026-08-01T14:45:00Z', summary: 'Aula — Teste' }),
      // aula que saiu do banco (remarcada/cancelada) ⇒ some
      lite({ id: 'orfao', key: 'aula:morta', startUtc: '2026-08-03T14:00:00Z', endUtc: '2026-08-03T14:45:00Z' }),
      // marcada como nossa mas sem chave legível ⇒ some
      lite({ id: 'semkey', key: null, startUtc: '2026-08-04T14:00:00Z', endUtc: '2026-08-04T14:45:00Z' }),
    ]
    const diff = diffCalendar(have, want)
    expect(diff.toInsert.map((e) => e.key)).toEqual(['aula:2'])
    expect(diff.toPatch).toEqual([])
    expect(diff.toDelete.sort()).toEqual(['dup', 'orfao', 'semkey'])
  })

  it('mudança de horário, título ou transparência vira patch (não delete+insert)', () => {
    const want = [desired({ key: 'janela:1', transparent: true })]
    const have = [
      lite({ id: 'p1', key: 'janela:1', startUtc: '2026-08-01T13:00:00Z', endUtc: '2026-08-01T13:45:00Z', summary: 'Aula — Teste', transparent: false }),
    ]
    const diff = diffCalendar(have, want)
    expect(diff.toInsert).toEqual([])
    expect(diff.toDelete).toEqual([])
    expect(diff.toPatch).toHaveLength(1)
    expect(diff.toPatch[0].id).toBe('p1')
    expect(diff.toPatch[0].ev.transparent).toBe(true)
  })

  it('estado já convergido = zero operações (idempotência)', () => {
    const want = [desired({ key: 'aula:1' })]
    const have = [
      lite({ id: 'ok', key: 'aula:1', startUtc: '2026-08-01T14:00:00Z', endUtc: '2026-08-01T14:45:00Z', summary: 'Aula — Teste' }),
    ]
    const diff = diffCalendar(have, want)
    expect(diff).toEqual({ toInsert: [], toPatch: [], toDelete: [] })
  })
})

/** Porta em memória: o sync deve deixá-la IGUAL ao desejado, rode quantas vezes for. */
function fakePort(seed: GcalEventLite[] = []) {
  const store = new Map(seed.map((e) => [e.id, e]))
  let nextId = 1
  const port: GcalPort = {
    listOurs: async () => [...store.values()].filter((e) => e.key !== null || e.summary === 'nosso-sem-key'),
    listAll: async () => [...store.values()],
    insert: async (ev) => {
      const id = 'new-' + nextId++
      store.set(id, { id, key: ev.key, startUtc: ev.startUtc, endUtc: ev.endUtc, summary: ev.summary, transparent: ev.transparent })
      // F11: a porta devolve id + Meet (o sync grava na aula)
      return { id, meetUrl: ev.meet ? `https://meet.google.com/fake-${id}` : null }
    },
    patch: async (id, ev) => {
      const cur = store.get(id)
      if (!cur) throw new Error('patch em evento inexistente')
      store.set(id, { ...cur, startUtc: ev.startUtc, endUtc: ev.endUtc, summary: ev.summary, transparent: ev.transparent })
    },
    remove: async (id) => {
      if (!store.delete(id)) throw new Error('delete em evento inexistente')
    },
  }
  return { port, store }
}

describe('syncTeacherGoogleCalendar (porta em memória)', () => {
  it('aplica o diff e uma 2ª rodada é no-op; professora apagou ⇒ recoloca', async () => {
    const { port, store } = fakePort([
      lite({ id: 'velho', key: 'aula:morta', startUtc: '2026-08-01T10:00:00Z', endUtc: '2026-08-01T10:45:00Z' }),
    ])
    const want = [desired({ key: 'aula:viva' })]

    const r1 = await syncTeacherGoogleCalendar(port, want, RANGE)
    expect(r1).toEqual({ inserted: 1, patched: 0, deleted: 1 })
    expect([...store.values()].map((e) => e.key)).toEqual(['aula:viva'])

    const r2 = await syncTeacherGoogleCalendar(port, want, RANGE)
    expect(r2).toEqual({ inserted: 0, patched: 0, deleted: 0 })

    // ela apaga o evento no Google → o sync seguinte recoloca (app manda)
    store.clear()
    const r3 = await syncTeacherGoogleCalendar(port, want, RANGE)
    expect(r3.inserted).toBe(1)
  })
})

describe('googleBusyBlocks (privacidade dos afazeres)', () => {
  it('só horários de eventos DELA: fora os nossos, os transparentes e dia-inteiro', async () => {
    const { port } = fakePort([
      lite({ id: 'afazer', startUtc: '2026-08-01T12:00:00Z', endUtc: '2026-08-01T13:00:00Z', summary: 'Dentista' }),
      lite({ id: 'nosso', key: 'aula:1', startUtc: '2026-08-01T14:00:00Z', endUtc: '2026-08-01T14:45:00Z' }),
      lite({ id: 'livre', startUtc: '2026-08-01T15:00:00Z', endUtc: '2026-08-01T16:00:00Z', transparent: true }),
      lite({ id: 'diainteiro' }), // all-day: sem dateTime
    ])
    const busy = await googleBusyBlocks(port, RANGE)
    expect(busy).toEqual([{ startUtc: '2026-08-01T12:00:00Z', endUtc: '2026-08-01T13:00:00Z' }])
  })
})

describe('RLS/grants: teacher_google_accounts (migration 20260715001100)', () => {
  const STATUS_COLS = 'teacher_id, google_email, connected_at, last_sync_at, last_sync_error'

  it('professora lê SÓ a própria linha; select(*) é recusado (cipher fora do grant); admin vê todas', async () => {
    const [tA, tB] = [await createTeacher(sql), await createTeacher(sql)]
    const userA = await createAuthUser(sql, 'teacher', 'Prof gcal A')
    await sql`update teachers set profile_id = ${userA} where id = ${tA}`
    await sql`insert into teacher_google_accounts (teacher_id, google_email, refresh_token_cipher)
              values (${tA}, 'a@exemplo.com', 'v1.blob.a'), (${tB}, 'b@exemplo.com', 'v1.blob.b')`

    const profA = await clientAs(userA, 'teacher')
    const { data: own, error: ownErr } = await profA
      .from('teacher_google_accounts')
      .select(STATUS_COLS)
    expect(ownErr).toBeNull()
    expect(own?.map((r) => r.google_email)).toEqual(['a@exemplo.com'])

    // Defesa em profundidade: nem a dona lê o blob — coluna sem grant.
    const { error: starErr } = await profA.from('teacher_google_accounts').select('*')
    expect(starErr?.message).toContain('permission denied')
    const { error: cipherErr } = await profA
      .from('teacher_google_accounts')
      .select('refresh_token_cipher')
    expect(cipherErr?.message).toContain('permission denied')

    // Escrita pela sessão dela: nada de INSERT/UPDATE/DELETE (só service_role).
    const { error: insErr } = await profA
      .from('teacher_google_accounts')
      .insert({ teacher_id: tA, google_email: 'x', refresh_token_cipher: 'y' })
    expect(insErr).not.toBeNull()

    const { data: adminSees } = await admin.from('teacher_google_accounts').select(STATUS_COLS)
    const emails = (adminSees ?? []).map((r) => r.google_email)
    expect(emails).toContain('a@exemplo.com')
    expect(emails).toContain('b@exemplo.com')

    // Aluno não enxerga NADA (nenhuma policy o alcança).
    const student = await clientAs(await createAuthUser(sql, 'student', 'Aluno gcal'), 'student')
    const { data: studentSees, error: studentErr } = await student
      .from('teacher_google_accounts')
      .select(STATUS_COLS)
    expect(studentErr).toBeNull()
    expect(studentSees).toEqual([])
  })
})

describe('sync M4: orquestrador + rota (porta injetada, banco real)', () => {
  it('gate: /api/jobs/sync-gcal é público EXATO (token decide dentro da rota)', () => {
    expect(isPublicPath('/api/jobs/sync-gcal')).toBe(true)
    expect(isPublicPath('/api/jobs/sync-gcal-outra')).toBe(false)
  })

  it('handleGcalSync: token nulo / errado / env ausente → 401 fail-closed', async () => {
    const cases: Array<[string | null, string | undefined]> = [
      [null, 'segredo-sync-gcal-de-teste-32-chars'],
      ['errado', 'segredo-sync-gcal-de-teste-32-chars'],
      ['segredo-sync-gcal-de-teste-32-chars', undefined],
    ]
    for (const [token, expectedToken] of cases) {
      const res = await handleGcalSync(service, { token, expectedToken })
      expect(res.status).toBe(401)
      expect(res.body).toEqual({ ok: false, detail: 'token inválido' })
    }
  })

  it('sincroniza a professora conectada; falha de UMA não derruba as outras', async () => {
    const key = tokenKeyFromEnv()!
    const cOk = await createPrivateContract(sql)
    const cBad = await createPrivateContract(sql)
    const aula = await createInstance(sql, cOk, { startsInHours: 100 })
    await sql`insert into teacher_google_accounts (teacher_id, google_email, refresh_token_cipher)
              values (${cOk.teacherId}, 'ok@exemplo.com', ${encryptToken('rt-ok', key)}),
                     (${cBad.teacherId}, 'bad@exemplo.com', ${encryptToken('rt-bad', key)})`

    const { port, store } = fakePort()
    const outcomes = await syncGoogleCalendars(service, {
      portFor: (token) => {
        if (token === 'rt-bad') throw new Error('Google indisponível (simulado)')
        return port
      },
    })

    const byTeacher = new Map(outcomes.map((o) => [o.teacherId, o]))
    expect(byTeacher.get(cOk.teacherId)).toMatchObject({ ok: true, inserted: 1 })
    expect(byTeacher.get(cBad.teacherId)).toMatchObject({ ok: false })
    expect([...store.values()].map((e) => e.key)).toEqual([`aula:${aula}`])

    const [rowOk] = await sql`select last_sync_at, last_sync_error from teacher_google_accounts where teacher_id = ${cOk.teacherId}`
    expect(rowOk.last_sync_at).not.toBeNull()
    expect(rowOk.last_sync_error).toBeNull()
    const [rowBad] = await sql`select last_sync_at, last_sync_error from teacher_google_accounts where teacher_id = ${cBad.teacherId}`
    expect(rowBad.last_sync_error).toContain('simulado')
  })
})

describe('googleWindowClash M5 (checagem ao publicar janela)', () => {
  it('ocupado × livre × desconectada — offset do dia via fuso DELA (Lei 1)', async () => {
    const key = tokenKeyFromEnv()!
    const c = await createPrivateContract(sql)
    await sql`update teachers set iana_tz = 'America/Cuiaba' where id = ${c.teacherId}`
    await sql`insert into teacher_google_accounts (teacher_id, google_email, refresh_token_cipher)
              values (${c.teacherId}, 'clash@exemplo.com', ${encryptToken('rt-clash', key)})`

    const dia = daysFromToday(9)
    // Cuiabá é UTC-4 fixo: 10:00 local = 14:00Z. Afazer 13:30Z–14:30Z sobrepõe.
    const afazer = fakePort([
      lite({ id: 'dentista', startUtc: `${dia}T13:30:00Z`, endUtc: `${dia}T14:30:00Z`, summary: 'Dentista' }),
    ])
    const ocupado = await googleWindowClash(service, c.teacherId, dia, '10:00', () => afazer.port)
    expect(ocupado).toEqual({ status: 'ocupado', clashStartUtc: `${dia}T13:30:00Z` })

    const livre = await googleWindowClash(service, c.teacherId, dia, '16:00', () => afazer.port)
    expect(livre).toEqual({ status: 'livre' })

    const semConta = await createPrivateContract(sql)
    const desconectada = await googleWindowClash(service, semConta.teacherId, dia, '10:00', () => afazer.port)
    expect(desconectada).toEqual({ status: 'desconectada' })
  })
})

describe('desiredEventsForTeacher (banco real)', () => {
  it('aula agendada + janela publicada entram; cancelada/consumida ficam fora', async () => {
    const c = await createPrivateContract(sql)
    const viva = await createInstance(sql, c, { startsInHours: 72 })
    const cancelada = await createInstance(sql, c, { startsInHours: 96 })
    await sql`update class_instances set state = 'cancelled' where id = ${cancelada}`

    const { data: winId, error } = await admin.rpc('publish_reschedule_window', {
      p_teacher: c.teacherId,
      p_starts_at_utc: instanteEm(daysFromToday(10), '09:00'),
    })
    expect(error).toBeNull()

    const events = await desiredEventsForTeacher(service, c.teacherId, RANGE)
    const keys = events.map((e) => e.key)
    expect(keys).toContain(`aula:${viva}`)
    expect(keys).toContain(`janela:${winId}`)
    expect(keys).not.toContain(`aula:${cancelada}`)

    const aula = events.find((e) => e.key === `aula:${viva}`)!
    expect(aula.summary).toMatch(/^Aula — Aluno/)
    expect(aula.transparent).toBe(false)
    expect(Date.parse(aula.endUtc) - Date.parse(aula.startUtc)).toBe(45 * 60_000)

    const janela = events.find((e) => e.key === `janela:${winId}`)!
    expect(janela.transparent).toBe(true)
    expect(janela.summary).toBe('Janela de remarcação (aberta)')

    // professora sem nada no horizonte = lista vazia (não explode)
    const outra = await createPrivateContract(sql)
    expect(await desiredEventsForTeacher(service, outra.teacherId, RANGE)).toEqual([])
  })
})

describe('retomada 01/09 · M1: a primeira sincronização nasce no callback do OAuth', () => {
  it('pino de fonte: o callback dispara syncTeacherCalendarSoon DEPOIS de gravar a credencial', async () => {
    // Medido na abertura da onda Agenda e Mensagens: o callback gravava a
    // credencial com last_sync_at = null e NÃO disparava sync — a agenda da
    // professora ficava vazia até a próxima ação ou o job diário (que não
    // existia em produção). O gancho é fire-and-forget (o mesmo das actions),
    // por isso o pino é de fonte: a chamada existe e vem DEPOIS do upsert.
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/app/teacher/google/callback/route.ts', 'utf8'),
    )
    expect(src).toContain("import { syncTeacherCalendarSoon } from '@/lib/google/sync'")
    const upsert = src.indexOf(".from('teacher_google_accounts').upsert(")
    const sync = src.indexOf('syncTeacherCalendarSoon(admin, teacher.id)')
    expect(upsert).toBeGreaterThan(-1)
    expect(sync).toBeGreaterThan(upsert)
  })
})
