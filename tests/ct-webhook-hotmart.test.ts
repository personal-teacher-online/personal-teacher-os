// Construção total — webhook Hotmart (handler TS, molde EXATO de webhook-asaas.test.ts).
// Efeitos (RPCs) já provados em nucleo45-hotmart.test.ts; aqui o alvo é o HANDLER:
// hottok fail-closed, inbox first-write-wins, vínculo por e-mail (lower/trim),
// Lei 1 (creation_date epoch MS → data civil no fuso do ALUNO, dentro da RPC),
// monotonia do evento e reprocesso de evento preso.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { handleHotmartWebhook } from '../src/lib/webhooks/hotmart'
import { serviceClient } from './helpers/auth'
import { connect, createMentorshipContract, type MentorshipContract } from './helpers/db'

const HOTTOK = 'hottok-teste-ct'
let sql: Sql
const service = serviceClient()

beforeAll(async () => {
  sql = connect(3)
  // DIVERGÊNCIA REAL (achada nesta construção): NENHUMA migration concede
  // "select on mentorship_contracts" a service_role — localmente o handler nunca
  // acha o vínculo (PostgREST: permission denied → mcRows null → todo evento cai
  // em 'sem contrato vinculado'). Em produção funciona só pelos default
  // privileges amplos (lição da 20260714000600). O grant abaixo EMULA produção
  // para testar a LÓGICA do handler; a correção canônica é migration nova.
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(4520260716)` // serializa grants entre arquivos paralelos
    await tx.unsafe('grant select on mentorship_contracts to service_role')
  })
})
afterAll(async () => {
  await sql.end()
})

// E-mail ÚNICO por teste (paralelo-safe e rerun-safe: external_user_ref não tem
// UNIQUE e o handler casa por igualdade — e-mail repetido entre execuções
// acharia o contrato da execução anterior).
function uniqueEmail() {
  return `aluno.hotmart.${crypto.randomUUID().slice(0, 8)}@bancada.dev`
}

/** Aluno em Lisboa + contrato mentorship ativo vinculado ao e-mail Hotmart. */
async function linkedMentorship(
  email: string,
  tz = 'Europe/Lisbon',
): Promise<MentorshipContract> {
  const m = await createMentorshipContract(sql, { courseStartMonthsAgo: null, tz })
  await sql`
    update mentorship_contracts set external_user_ref = ${email}
    where contract_id = ${m.contractId}`
  return m
}

// 2026-07-10T23:30:00Z — em Lisboa (verão, UTC+1) já é 11/07 00:30 (pino Lei 1).
const NIGHT_2330Z_MS = Date.UTC(2026, 6, 10, 23, 30, 0)

function firstAccess(email: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'hm_' + crypto.randomUUID().slice(0, 12),
    event: 'CLUB_FIRST_ACCESS',
    creation_date: NIGHT_2330Z_MS, // epoch MS (doc oficial)
    data: { user: { email }, product: { id: 42, name: 'Personal Travel' } },
    ...overrides,
  }
}

function moduleCompleted(email: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'hm_' + crypto.randomUUID().slice(0, 12),
    event: 'CLUB_MODULE_COMPLETED',
    creation_date: Date.UTC(2026, 6, 12, 10, 0, 0),
    data: { user: { email }, module: { id: 'mod-1', name: 'Módulo 1' } },
    ...overrides,
  }
}

async function call(payload: unknown, fetchPct?: (email: string) => Promise<number | null>) {
  return handleHotmartWebhook(service, {
    hottok: HOTTOK,
    expectedHottok: HOTTOK,
    payload,
    fetchPct,
  })
}

describe('caso a: hottok fail-closed', () => {
  it('hottok ausente/errado → 401 e webhook_inbox VAZIA para o event_id', async () => {
    const e = firstAccess(uniqueEmail())
    for (const bad of [null, 'errado']) {
      const r = await handleHotmartWebhook(service, {
        hottok: bad,
        expectedHottok: HOTTOK,
        payload: e,
      })
      expect(r.status).toBe(401)
    }
    // Endpoint sem hottok configurado é fail-closed (rota inoperante).
    const r = await handleHotmartWebhook(service, {
      hottok: HOTTOK,
      expectedHottok: undefined,
      payload: e,
    })
    expect(r.status).toBe(401)

    const [{ count }] = await sql`
      select count(*)::int as count from webhook_inbox
      where source = 'hotmart' and event_id = ${e.id}`
    expect(count).toBe(0)
  })
})

describe('caso b: CLUB_FIRST_ACCESS válido (pino Lei 1)', () => {
  it('evento 23:30Z → inbox com payload e course_start_date = DIA SEGUINTE em Lisboa', async () => {
    const email = uniqueEmail()
    const m = await linkedMentorship(email, 'Europe/Lisbon')
    const e = firstAccess(email)

    const r = await call(e)
    expect(r.status).toBe(200)

    const [inbox] = await sql`
      select payload, processed_at, error from webhook_inbox
      where source = 'hotmart' and event_id = ${e.id}`
    expect(inbox.payload.event).toBe('CLUB_FIRST_ACCESS')
    expect(inbox.payload.data.user.email).toBe(email)
    expect(inbox.processed_at).not.toBeNull()
    expect(inbox.error).toBeNull()

    // 23:30Z de 10/07 = 00:30 de 11/07 em Lisboa: a data civil é a do ALUNO,
    // derivada NA RPC — usar UTC daria 10/07 (dia errado).
    const [mc] = await sql`
      select course_start_date::text from mentorship_contracts
      where contract_id = ${m.contractId}`
    expect(mc.course_start_date).toBe('2026-07-11')
  })

  it('caso c: replay do MESMO id → 200, 1 linha na inbox, course_start_date inalterado', async () => {
    const email = uniqueEmail()
    const m = await linkedMentorship(email)
    const e = firstAccess(email)

    expect((await call(e)).status).toBe(200)
    const replay = await call(e)
    expect(replay.status).toBe(200)
    expect(replay.body.detail).toContain('replay')

    const [{ count }] = await sql`
      select count(*)::int as count from webhook_inbox
      where source = 'hotmart' and event_id = ${e.id}`
    expect(count).toBe(1)
    const [mc] = await sql`
      select course_start_date::text from mentorship_contracts
      where contract_id = ${m.contractId}`
    expect(mc.course_start_date).toBe('2026-07-11')
  })
})

describe('caso d: aluno desconhecido', () => {
  it('e-mail sem contrato vinculado → 200 e inbox.error com o rastro (nunca 500)', async () => {
    const e = firstAccess(uniqueEmail()) // e-mail nunca vinculado a contrato algum
    const r = await call(e)
    expect(r.status).toBe(200)

    const [row] = await sql`
      select error, processed_at from webhook_inbox
      where source = 'hotmart' and event_id = ${e.id}`
    expect(row.error).toContain('sem contrato vinculado')
    expect(row.processed_at).not.toBeNull()
  })
})

describe('casos e/f: CLUB_MODULE_COMPLETED (gatilho de fetch pontual)', () => {
  it('caso e: fetchPct=40 aplica; evento seguinte com fetchPct=25 → pct CONTINUA 40 (monotônica)', async () => {
    const email = uniqueEmail()
    const m = await linkedMentorship(email)

    // Payload com e-mail em CAIXA ALTA + espaços: o handler normaliza (lower/trim)
    // tanto para casar o contrato quanto para chamar o fetch.
    const seen: string[] = []
    const fetch40 = async (e: string) => {
      seen.push(e)
      return 40
    }
    const e1 = moduleCompleted(` ${email.toUpperCase()} `)
    expect((await call(e1, fetch40)).status).toBe(200)
    expect(seen).toEqual([email])

    const [p1] = await sql`
      select completion_pct from course_progress where contract_id = ${m.contractId}`
    expect(Number(p1.completion_pct)).toBe(40)

    // Webhook atrasado: a API devolve 25 — a RPC de EVENTO é monotônica, pct fica.
    // (O audit skipped_regression já é coberto pela suíte nucleo45.)
    const e2 = moduleCompleted(email)
    const r2 = await call(e2, async () => 25)
    expect(r2.status).toBe(200)

    const [p2] = await sql`
      select completion_pct from course_progress where contract_id = ${m.contractId}`
    expect(Number(p2.completion_pct)).toBe(40)
  })

  it('caso f: sem fetchPct (credenciais ausentes) → 200 e inbox.error "polling diário cobre"', async () => {
    const email = uniqueEmail()
    await linkedMentorship(email)
    const e = moduleCompleted(email)

    const r = await call(e) // fetchPct undefined
    expect(r.status).toBe(200)

    const [row] = await sql`
      select error, processed_at from webhook_inbox
      where source = 'hotmart' and event_id = ${e.id}`
    expect(row.error).toContain('polling diário cobre')
    expect(row.processed_at).not.toBeNull()

    const [{ count }] = await sql`
      select count(*)::int as count from course_progress
      where contract_id in (select contract_id from mentorship_contracts
                            where external_user_ref = ${email})`
    expect(count).toBe(0) // nenhum pct inventado sem a API
  })
})

describe('caso g: evento PRESO (crash entre inbox e efeito) — retry reprocessa', () => {
  it('inbox com processed_at NULL: retry com payload FORJADO usa o ORIGINAL e preenche processed_at', async () => {
    const email = uniqueEmail()
    const m = await linkedMentorship(email, 'Europe/Lisbon')
    const e = firstAccess(email) // original: 23:30Z de 10/07 → 11/07 em Lisboa

    // Simula o crash: inbox gravada, processamento nunca aconteceu.
    await sql`
      insert into webhook_inbox (source, event_id, payload)
      values ('hotmart', ${e.id}, ${sql.json(e)})`

    // Retry chega com creation_date FORJADO (05/08 12:00Z → daria 05/08).
    const forged = { ...e, creation_date: Date.UTC(2026, 7, 5, 12, 0, 0) }
    const r = await call(forged)
    expect(r.status).toBe(200)

    // Efeito veio do payload ORIGINAL (first-write-wins), não do forjado.
    const [mc] = await sql`
      select course_start_date::text from mentorship_contracts
      where contract_id = ${m.contractId}`
    expect(mc.course_start_date).toBe('2026-07-11')

    const [inbox] = await sql`
      select processed_at, payload -> 'creation_date' as creation_date from webhook_inbox
      where source = 'hotmart' and event_id = ${e.id}`
    expect(inbox.processed_at).not.toBeNull()
    expect(Number(inbox.creation_date)).toBe(NIGHT_2330Z_MS) // payload original preservado
  })
})
