// F11 — Família das chaves (plano integrado v2, 18/07/2026): sync grava id+Meet
// na aula (M13-(b)), e o robô do M15 casa gravações (rota primária por código,
// fallback por horário), descarta mentoria (P20), acende as flags (órfã / sem
// gravação / curta / sem transcript) e aplica a retenção pós-auditoria.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { serviceClient } from './helpers/auth'
import { connect, createPrivateContract } from './helpers/db'
import { auditRecordings, meetCodeFromUrl, type RecordingFile } from '@/lib/jobs/audit-recordings'
import { syncTeacherGoogleCalendar, type DesiredEvent, type GcalEventLite, type GcalPort } from '@/lib/google/calendar'

let sql: Sql

beforeAll(() => {
  sql = connect(4)
})
afterAll(async () => {
  await sql.end()
})

describe('meetCodeFromUrl', () => {
  it('extrai o código do link (e devolve null sem link)', () => {
    expect(meetCodeFromUrl('https://meet.google.com/abc-defg-hij')).toBe('abc-defg-hij')
    expect(meetCodeFromUrl('meet.google.com/XYZ-abcd-efg?authuser=0')).toBe('xyz-abcd-efg')
    expect(meetCodeFromUrl(null)).toBeNull()
    expect(meetCodeFromUrl('https://zoom.us/x')).toBeNull()
  })
})

describe('M13-(b) — sync grava id + Meet na aula (inserts E existentes)', () => {
  it('onAulaEvent recebe o id do evento novo e o do já existente sem id gravado', async () => {
    const recorded: [string, string, string | null][] = []
    const existing: GcalEventLite[] = [
      {
        id: 'ev-velho', key: 'aula:inst-antiga', startUtc: '2026-08-01T12:00:00Z',
        endUtc: '2026-08-01T13:00:00Z', summary: 'Aula — X', transparent: false,
        meetUrl: 'https://meet.google.com/old-code-xyz',
      },
    ]
    const desired: DesiredEvent[] = [
      { key: 'aula:inst-antiga', startUtc: '2026-08-01T12:00:00Z', endUtc: '2026-08-01T13:00:00Z', summary: 'Aula — X', transparent: false, meet: true },
      { key: 'aula:inst-nova', startUtc: '2026-08-02T12:00:00Z', endUtc: '2026-08-02T13:00:00Z', summary: 'Aula — Y', transparent: false, meet: true },
    ]
    const port: GcalPort = {
      listOurs: async () => existing,
      listAll: async () => existing,
      insert: async () => ({ id: 'ev-novo', meetUrl: 'https://meet.google.com/new-code-abc' }),
      patch: async () => undefined,
      remove: async () => undefined,
    }
    await syncTeacherGoogleCalendar(port, desired, { fromUtcISO: '2026-08-01T00:00:00Z', toUtcISO: '2026-08-10T00:00:00Z' },
      async (instanceId, eventId, meetUrl) => {
        recorded.push([instanceId, eventId, meetUrl])
      })
    expect(recorded).toContainEqual(['inst-nova', 'ev-novo', 'https://meet.google.com/new-code-abc'])
    expect(recorded).toContainEqual(['inst-antiga', 'ev-velho', 'https://meet.google.com/old-code-xyz'])
  })
})

describe('M15 — robô de auditoria de gravações', () => {
  it('casa por código e por horário; descarta mentoria (P20); flags órfã/sem-gravação/curta/sem-transcript; retenção', async () => {
    const svc = serviceClient()
    const c = await createPrivateContract(sql)

    const mk = async (hoursAgo: number, durMin: number, meetUrl: string | null) => {
      const minsAgo = Math.round(hoursAgo * 60)
      const [r] = await sql`
        insert into class_instances
          (contract_id, teacher_id, starts_at_utc, ends_at_utc, local_time_snapshot,
           state, meet_url)
        values (${c.contractId}, ${c.teacherId},
                now() - make_interval(mins => ${minsAgo}),
                now() - make_interval(mins => ${minsAgo}) + make_interval(mins => ${durMin}),
                'fixture F11', 'completed', ${meetUrl})
        returning id`
      return r.id as string
    }
    const runCode = 'aaa-' + crypto.randomUUID().slice(0, 8) // código único por rodada
    const aulaCode = await mk(30, 60, `https://meet.google.com/${runCode}`)
    const aulaSem = await mk(50, 60, null) // completed sem gravação → flag
    // fallback por horário exige candidata ÚNICA — minuto aleatório por rodada
    // (rodadas acumuladas no mesmo banco criariam duas aulas no mesmo instante)
    const horaFallback = 90 + (parseInt(crypto.randomUUID().slice(0, 4), 16) % 2000) / 60
    const aulaHora = await mk(horaFallback, 60, null)

    await sql`
      insert into mentorship_sessions (scheduled_at, local_time_snapshot, capacity, status, gmeet_url)
      values (now() - interval '20 hours', 'fixture F11', 6, 'done', 'https://meet.google.com/men-tor-iaa')`

    const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString()
    const recs: RecordingFile[] = [
      { fileId: 'rec-code', name: 'Aula — S. (…)', createdAtUtc: at(30), durationMin: 55, meetCode: runCode, transcriptText: 'transcrição nativa ok' },
      { fileId: 'rec-mentoria', name: 'Mentoria Personal Travel', createdAtUtc: at(20), durationMin: 60, meetCode: 'men-tor-iaa', transcriptText: 'x' },
      { fileId: 'rec-orfa', name: 'Gravação solta', createdAtUtc: at(200), durationMin: 45, meetCode: 'zzz-zzzz-zzz', transcriptText: 'y' },
      // fallback por horário: cai na janela da aulaHora; CURTA (20 < 60/2) e SEM transcript
      { fileId: 'rec-hora', name: 'Meet sem código', createdAtUtc: at(horaFallback), durationMin: 20, meetCode: null, transcriptText: null },
    ]

    const audited: string[] = []
    const deleted: string[] = []
    const report = await auditRecordings(
      svc,
      {
        listRecordings: async () => recs,
        runAudit: async (instanceId) => {
          audited.push(instanceId)
        },
        deleteRecording: async (fileId) => {
          deleted.push(fileId)
        },
      },
      { windowDays: 6, retainDays: 1, teacherId: c.teacherId },
    )

    expect(report.mentoria_descartadas).toEqual(['rec-mentoria'])
    expect(report.orfas).toEqual(['rec-orfa'])
    expect(audited).toContain(aulaCode)
    expect(report.curtas).toEqual(['rec-hora'])
    expect(report.sem_transcricao).toEqual(['rec-hora'])
    expect(report.aulas_sem_gravacao).toContain(aulaSem)
    expect(report.aulas_sem_gravacao).not.toContain(aulaCode)
    // retenção: rec-code auditada e mais velha que 1 dia → apagada
    expect(deleted).toEqual(['rec-code'])
    expect(report.matched).toBe(2)
    expect(aulaHora).toBeTruthy()
  })
})
