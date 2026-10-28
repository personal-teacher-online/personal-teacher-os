// Construção total — job de polling AUTORITATIVO handleSyncHotmart (decisão iii
// do handoff-fase5: RPC sync_course_progress SEPARADA, last-write-wins; a de
// EVENTO segue monotônica). Molde de webhook-asaas.test.ts: client service
// injetado + fakes injetados (listProgress) — nenhum fetch real.
//
// Contagens: o job varre TODOS os mentorship_contracts vinculados do banco —
// asserts usam synced exato (só os e-mails do NOSSO Map sincronizam; e-mails
// são únicos por teste) e skipped como >= (fixtures paralelas contam ali).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { handleSyncHotmart } from '../src/lib/jobs/sync-hotmart'
import { serviceClient } from './helpers/auth'
import { connect, createMentorshipContract, type MentorshipContract } from './helpers/db'

const TOKEN = 'sync-hotmart-token-ct'
let sql: Sql
const service = serviceClient()

beforeAll(async () => {
  sql = connect(3)
  // DIVERGÊNCIA REAL (achada nesta construção): NENHUMA migration concede
  // "select on mentorship_contracts" a service_role — localmente o job responde
  // 500 'permission denied'. Em produção funciona só pelos default privileges
  // amplos (lição da 20260714000600). O grant abaixo EMULA produção para testar
  // a LÓGICA do job; a correção canônica é migration nova.
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(4520260716)` // serializa grants entre arquivos paralelos
    await tx.unsafe('grant select on mentorship_contracts to service_role')
  })
})
afterAll(async () => {
  await sql.end()
})

function uniqueEmail() {
  return `sync.hotmart.${crypto.randomUUID().slice(0, 8)}@bancada.dev`
}

async function linkedMentorship(email: string): Promise<MentorshipContract> {
  const m = await createMentorshipContract(sql, { courseStartMonthsAgo: 1 })
  await sql`
    update mentorship_contracts set external_user_ref = ${email}
    where contract_id = ${m.contractId}`
  return m
}

async function call(
  listProgress: (() => Promise<Map<string, number>>) | null,
  token: string | null = TOKEN,
) {
  return handleSyncHotmart(service, { token, expectedToken: TOKEN, listProgress })
}

describe('caso a: token fail-closed', () => {
  it('token errado/ausente/não configurado → 401', async () => {
    for (const bad of [null, 'errado']) {
      const r = await call(async () => new Map(), bad)
      expect(r.status).toBe(401)
    }
    const r = await handleSyncHotmart(service, {
      token: TOKEN,
      expectedToken: undefined,
      listProgress: async () => new Map(),
    })
    expect(r.status).toBe(401)
  })
})

describe('caso b: sem credenciais', () => {
  it('listProgress=null → 200 com detail de credenciais (nada a sincronizar)', async () => {
    const r = await call(null)
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.detail).toContain('credenciais')
    expect(r.body.synced).toBeUndefined()
  })
})

describe('caso c: sync seletivo + last-write-wins autoritativo', () => {
  it('2 contratos vinculados, Map só com UM → synced=1, skipped>=1; regressão APLICA (pino iii)', async () => {
    const emailA = uniqueEmail()
    const emailB = uniqueEmail()
    const a = await linkedMentorship(emailA)
    await linkedMentorship(emailB) // vinculado mas FORA do Map → skipped

    const r1 = await call(async () => new Map([[emailA, 60]]))
    expect(r1.status).toBe(200)
    expect(r1.body.ok).toBe(true)
    expect(r1.body.synced).toBe(1)
    expect(r1.body.skipped).toBeGreaterThanOrEqual(1)
    expect(r1.body.errors).toEqual([])

    const [p1] = await sql`
      select completion_pct from course_progress where contract_id = ${a.contractId}`
    expect(Number(p1.completion_pct)).toBe(60)

    // Segunda rodada REGRIDE (Hotmart recontou páginas): o polling é a fonte
    // AUTORITATIVA — aplica mesmo assim (last-write-wins, decisão iii), ao
    // contrário da RPC de evento (monotônica).
    const r2 = await call(async () => new Map([[emailA, 45]]))
    expect(r2.status).toBe(200)
    expect(r2.body.synced).toBe(1)

    const [p2] = await sql`
      select completion_pct from course_progress where contract_id = ${a.contractId}`
    expect(Number(p2.completion_pct)).toBe(45)

    // Lei 8: a regressão fica explicável na auditoria.
    const audits = await sql`
      select diff from audit_log
      where action = 'sync_course_progress' and entity_id = ${a.contractId}::text
      order by id`
    expect(audits).toHaveLength(2)
    expect(audits[1].diff).toMatchObject({ regressed: true, new_pct: 45 })
  })

  it('caso d: RPC falha para UM contrato (pct 200 inválido) → errors[] dele; os outros seguem', async () => {
    const emailC = uniqueEmail()
    const emailD = uniqueEmail()
    const c = await linkedMentorship(emailC)
    const d = await linkedMentorship(emailD)

    const r = await call(
      async () =>
        new Map([
          [emailC, 200], // fora de 0–100 → sync_course_progress levanta exceção
          [emailD, 50],
        ]),
    )
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(false) // houve erro no lote
    expect(r.body.synced).toBe(1) // o outro contrato NÃO foi derrubado (caso 9)
    expect(r.body.errors).toHaveLength(1)
    expect(r.body.errors![0].contract).toBe(c.contractId)
    expect(r.body.errors![0].error).toMatch(/entre 0 e 100/)

    const [{ count: cRows }] = await sql`
      select count(*)::int as count from course_progress where contract_id = ${c.contractId}`
    expect(cRows).toBe(0) // nada corrompido para o contrato que falhou
    const [pd] = await sql`
      select completion_pct from course_progress where contract_id = ${d.contractId}`
    expect(Number(pd.completion_pct)).toBe(50)
  })
})
