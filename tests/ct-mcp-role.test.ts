// Construção total (14/07/2026) — role de leitura do MCP server (migration
// 20260715000700 + handoff-fase4 §5). Exercita o caminho REAL do servidor
// (mcp/server.ts): login dedicado membro de ptos_mcp_ro + `set role ptos_mcp_ro`
// por conexão. Pinos: whitelist de SELECT (profiles fora; payments sem raw),
// negar escrita, grants de função, e o achado do painel 14/07 (6/18/24/34):
// BYPASSRLS NÃO é herdado por membership — sem `set role`, 0 linhas em silêncio.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

// Identificador não parametrizável: só [a-z0-9], gerado aqui — nunca input externo.
const ROLE = 'ptos_mcp_test_' + crypto.randomUUID().replace(/-/g, '').slice(0, 10)

function loginConfig(): pg.ClientConfig {
  const u = new URL(DATABASE_URL)
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    database: u.pathname.slice(1) || 'postgres',
    user: ROLE,
    password: 'x',
  }
}

let admin: pg.Client // superuser local — cria/derruba o role de teste e a fixture
let mcp: pg.Client // conexão do "servidor": login dedicado + set role ptos_mcp_ro
let seededStudentId: string

beforeAll(async () => {
  admin = new pg.Client({ connectionString: DATABASE_URL })
  await admin.connect()
  // Fixture: garante ao menos 1 aluno real — o contraste (a) × (f) precisa de linhas.
  const seeded = await admin.query(
    `insert into students (display_name, iana_tz)
     values ('Aluno MCP CT ${ROLE.slice(-6)}', 'America/Cuiaba') returning id`,
  )
  seededStudentId = seeded.rows[0].id as string
  // Espelho do runbook §N: LOGIN próprio, membro do grupo versionado na migration.
  await admin.query(`create role ${ROLE} login password 'x' in role ptos_mcp_ro`)

  mcp = new pg.Client(loginConfig())
  await mcp.connect()
  await mcp.query('set role ptos_mcp_ro') // exatamente o que mcp/server.ts faz por conexão
})

afterAll(async () => {
  try {
    await mcp?.end()
  } catch {
    // conexão pode já ter caído — o drop abaixo é o que importa
  }
  await admin.query(`drop role if exists ${ROLE}`)
  await admin.end()
})

/** Executa e devolve o SQLSTATE do erro (null = sucesso). '42501' = permission denied. */
async function errCode(client: pg.Client, text: string): Promise<string | null> {
  try {
    await client.query(text)
    return null
  } catch (err) {
    return (err as { code?: string }).code ?? 'sem-código'
  }
}

describe('MCP role ptos_mcp_ro — whitelist de leitura (com set role)', () => {
  it('(a) select count(*) from students funciona (bypassrls do grupo)', async () => {
    const r = await mcp.query('select count(*)::int as n from students')
    expect(r.rows[0].n).toBeGreaterThanOrEqual(1) // a fixture existe e é VISÍVEL
  })

  it('(b) profiles está FORA da whitelist (PII de login) → permission denied', async () => {
    expect(await errCode(mcp, 'select * from profiles limit 1')).toBe('42501')
  })

  it('(c) payments: coluna raw (payload cru do Asaas) negada; colunas whitelisted ok', async () => {
    expect(await errCode(mcp, 'select raw from payments limit 1')).toBe('42501')
    expect(await errCode(mcp, 'select id, status from payments limit 1')).toBeNull()
  })

  it('(d) INSERT em students → permission denied (role é SÓ leitura)', async () => {
    expect(
      await errCode(
        mcp,
        `insert into students (display_name, iana_tz) values ('x','America/Cuiaba')`,
      ),
    ).toBe('42501')
  })

  it('(e) grants de função: makeup_balance executa (0 p/ contrato inexistente); mentorship_can_book NUNCA é permission denied', async () => {
    const r = await mcp.query(`select public.makeup_balance('${NIL_UUID}') as b`)
    expect(r.rows[0].b).toBe(0)

    // mentorship_can_book pode RAISAR por regra de negócio (contrato/threshold
    // ausente) — o pino é o GRANT: o código nunca pode ser '42501'.
    let code: string | null = null
    try {
      await mcp.query(`select public.mentorship_can_book('${NIL_UUID}')`)
    } catch (err) {
      code = (err as { code?: string }).code ?? 'sem-código'
    }
    expect(code).not.toBe('42501')
    // Comportamento real observado no local: P0001 ("contrato ... não existe") —
    // regra de negócio, prova de que a função EXECUTOU com o grant transitivo.
  })
})

describe('MCP role — sem set role (pino do comportamento real)', () => {
  it("(f) mesma conexão nova SEM set role: 0 linhas em silêncio (bypassrls não herdado)", async () => {
    // Painel 14/07 (achados 6/18/24/34): BYPASSRLS é atributo do current_user e
    // NÃO é herdado por membership. Sem `set role ptos_mcp_ro`, o GRANT herdado
    // deixa o SELECT passar (nenhum permission denied), mas o RLS fica ativo e
    // nenhuma policy atende um role SQL sem JWT → 0 linhas em SILÊNCIO. É por
    // isso que mcp/server.ts executa `set role` ao abrir cada conexão (e o
    // runbook §N ainda recomenda bypassrls no login, cinto-e-suspensório).
    const raw = new pg.Client(loginConfig())
    await raw.connect()
    try {
      const some = await raw.query('select id from students limit 5')
      expect(some.rows).toHaveLength(0) // pino: 0 linhas sem set role

      // A MESMA linha-fixture: invisível sem set role, visível com set role.
      const hidden = await raw.query('select id from students where id = $1', [seededStudentId])
      expect(hidden.rows).toHaveLength(0)
      const visible = await mcp.query('select id from students where id = $1', [seededStudentId])
      expect(visible.rows).toHaveLength(1)
    } finally {
      await raw.end()
    }
  })
})
