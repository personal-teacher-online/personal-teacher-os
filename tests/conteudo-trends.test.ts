// Estúdio v2 — Leva 2.1 (ADR-032/037): guards de `content_trends`, a camada de
// CURADORIA do radar. A medição (`content_research`) segue intacta; cada trend
// deriva de UMA linha ativa de research (FK + source_key iguais) e é o objeto
// que a dona decide: `nova → roteirizada | descartada`. Duas mãos por grant de
// coluna (molde M4): o robô INSERE a captura e só ATUALIZA a nota de viagem
// (fail-open que se cura); a admin decide (status, motivo, ajuste, cluster).
// Variação de tema é LINHA PRÓPRIA (`variacao_de` → raiz, profundidade 1) — e a
// colisão com tema já descartado nasce `descartada` HERDANDO motivo e ator (a
// supressão silenciosa da era das ideias morre aqui — dívida 1 da 0.4).
//
// 📌 REGRA 7 do fluxo da frente: este arquivo nasceu VERMELHO e foi commitado
// assim, ANTES da migration de `content_trends`. Migration aplicada é imutável
// (Lei 7) — o "teste primeiro" paga exatamente aqui.
//
// Regra da casa: arquivos rodam em paralelo — fixtures próprias (source_key
// único), NUNCA contagem global.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { anonClient, clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect } from './helpers/db'
import { REDES } from '@/lib/research/config'
import { semanaIso } from '@/lib/research/tipos'

let sql: Sql
let admin: SupabaseClient
let adminId: string
let robo: SupabaseClient

/** Os dois lados do contrato: estas listas TS são comparadas literal a literal
 *  com os CHECKs do banco (pg_get_constraintdef). Quando a Leva 3 der UI às
 *  trends, elas migram para a gramática da tela. */
const STATUS_DA_TREND = ['nova', 'roteirizada', 'descartada'] as const
const CONTEXTOS = ['geral', 'travel'] as const

beforeAll(async () => {
  sql = connect(3)
  adminId = await createAuthUser(sql, 'admin', 'Admin trends')
  admin = await clientAs(adminId, 'admin')
  robo = serviceClient()
})
afterAll(async () => {
  await sql.end()
})

function chave(prefixo: string): string {
  return `reel:youtube:trends-${prefixo}-${crypto.randomUUID().slice(0, 8)}`
}

/** Linha de research ATIVA (porta única — a mesma que o worker usa). */
async function criarResearch(sourceKey: string): Promise<string> {
  const { data, error } = await robo.rpc('record_content_research', {
    p_tipo: 'analise_reel',
    p_plataforma: 'youtube',
    p_source_key: sourceKey,
    p_payload: { transcricao: { texto: 'fixture', via: 'teste' } },
    p_metricas: { views: 1000 },
    p_titulo: 'Reel de fixture',
    p_url: 'https://youtube.com/shorts/fixture',
    p_publicado_em: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  })
  expect(error, `research de fixture recusado: ${error?.message}`).toBeNull()
  return (data as { id: string }[])[0].id
}

function linhaDaTrend(researchId: string, sourceKey: string, over: Record<string, unknown> = {}) {
  return {
    research_id: researchId,
    source_key: sourceKey,
    plataforma: 'youtube',
    url: 'https://youtube.com/shorts/fixture',
    autor: 'Canal de fixture',
    views: 1000,
    velocidade: 2.5,
    velocidade_sem_conta: false,
    semana: semanaIso(),
    travel_score: 72,
    travel_meta: { justificativa: 'tema adaptável', prompt_versao: 1 },
    ...over,
  }
}

/** Trend `nova` completa, inserida pela mão certa (o robô). */
async function criarTrend(over: Record<string, unknown> = {}): Promise<string> {
  const sourceKey = chave('t')
  const researchId = await criarResearch(sourceKey)
  const { data, error } = await robo
    .from('content_trends')
    .insert(linhaDaTrend(researchId, sourceKey, over))
    .select('id')
    .single()
  expect(error, `INSERT de trend recusado: ${error?.message}`).toBeNull()
  return data!.id as string
}

async function descartar(id: string, motivo = 'fora do tema'): Promise<void> {
  const { error } = await admin
    .from('content_trends')
    .update({
      status: 'descartada',
      discard_reason: motivo,
      decidida_por: adminId,
      decidida_em: new Date().toISOString(),
    })
    .eq('id', id)
  expect(error, `descarte de fixture recusado: ${error?.message}`).toBeNull()
}

describe('content_trends — nascimento e captura (mão do robô)', () => {
  it('o robô insere a captura completa; nasce NOVA, sem decisão e com carimbo', async () => {
    const id = await criarTrend()
    const [row] = await sql`
      select status, discard_reason, decidida_por, decidida_em, travel_score_ajustado,
             capturada_em, created_at, updated_at
        from content_trends where id = ${id}`
    expect(row.status).toBe('nova')
    expect(row.discard_reason).toBeNull()
    expect(row.decidida_por).toBeNull()
    expect(row.decidida_em).toBeNull()
    expect(row.travel_score_ajustado).toBeNull()
    expect(row.capturada_em).not.toBeNull()
  })

  it('trend não nasce decidida: INSERT roteirizada explode; descartada sem mãe também', async () => {
    const k1 = chave('nasce-rot')
    const r1 = await criarResearch(k1)
    const rot = await robo
      .from('content_trends')
      .insert(linhaDaTrend(r1, k1, { status: 'roteirizada' }))
    expect(rot.error?.message).toMatch(/nasce como NOVA/)

    const k2 = chave('nasce-desc')
    const r2 = await criarResearch(k2)
    const desc = await robo.from('content_trends').insert(
      linhaDaTrend(r2, k2, {
        status: 'descartada',
        discard_reason: 'x',
        decidida_por: adminId,
        decidida_em: new Date().toISOString(),
      }),
    )
    expect(desc.error?.message).toMatch(/nasce como NOVA|mãe/)
  })

  it('a mão HUMANA não insere trend — capturar é do robô', async () => {
    const k = chave('mao-humana')
    const r = await criarResearch(k)
    const { error } = await admin.from('content_trends').insert(linhaDaTrend(r, k))
    expect(error?.message).toMatch(/permission denied/i)
  })

  it('o source_key da trend é o MESMO da linha de research (proveniência sem fresta)', async () => {
    const k = chave('diverge')
    const r = await criarResearch(k)
    const { error } = await robo
      .from('content_trends')
      .insert(linhaDaTrend(r, chave('outro')))
    expect(error?.message).toMatch(/diverge/)
  })

  it('uma trend por fonte: o MESMO source_key não entra duas vezes; upsert ignora sem duplicar', async () => {
    const k = chave('unica')
    const r = await criarResearch(k)
    const primeira = await robo.from('content_trends').insert(linhaDaTrend(r, k))
    expect(primeira.error).toBeNull()

    const segunda = await robo.from('content_trends').insert(linhaDaTrend(r, k))
    expect(segunda.error?.message).toMatch(/duplicate key|source_key/i)

    // O caminho do worker (re-corrida = 0 duplicata, custo ~zero).
    const upsert = await robo
      .from('content_trends')
      .upsert(linhaDaTrend(r, k), { onConflict: 'source_key', ignoreDuplicates: true })
    expect(upsert.error).toBeNull()
    const [{ n }] = await sql`
      select count(*)::int as n from content_trends where source_key = ${k}`
    expect(n).toBe(1)
  })

  it('views/velocidade/notas fora do domínio explodem (CHECKs)', async () => {
    const casos: Array<[Record<string, unknown>, RegExp]> = [
      [{ views: -1 }, /views/],
      [{ velocidade: -0.1 }, /velocidade/],
      [{ travel_score: 101 }, /travel_score/],
      [{ semana: '2026-08-03' }, /semana/],
      [{ plataforma: 'orkut' }, /plataforma/],
    ]
    for (const [over, re] of casos) {
      const k = chave('dominio')
      const r = await criarResearch(k)
      const { error } = await robo.from('content_trends').insert(linhaDaTrend(r, k, over))
      expect(error?.message, `passou: ${JSON.stringify(over)}`).toMatch(re)
    }
  })
})

describe('content_trends — decisão (mão humana) e shapes', () => {
  it('descartar SEM motivo explode; motivo em branco/tab também (descartada_shape)', async () => {
    const id = await criarTrend()
    const semMotivo = await admin
      .from('content_trends')
      .update({ status: 'descartada', decidida_por: adminId, decidida_em: new Date().toISOString() })
      .eq('id', id)
    expect(semMotivo.error?.message).toMatch(/descartada_shape/)

    const emBranco = await admin
      .from('content_trends')
      .update({
        status: 'descartada',
        discard_reason: ' \t\n',
        decidida_por: adminId,
        decidida_em: new Date().toISOString(),
      })
      .eq('id', id)
    expect(emBranco.error?.message).toMatch(/descartada_shape/)
  })

  it('decisão sem carimbo de ator explode (decidida_shape)', async () => {
    const id = await criarTrend()
    const { error } = await admin
      .from('content_trends')
      .update({ status: 'descartada', discard_reason: 'fora do tema' })
      .eq('id', id)
    expect(error?.message).toMatch(/decidida_shape/)
  })

  it('motivo de descarte SÓ existe em descartada; carimbo SÓ fora de nova', async () => {
    const id = await criarTrend()
    const motivoSolto = await admin
      .from('content_trends')
      .update({ discard_reason: 'anotação solta' })
      .eq('id', id)
    expect(motivoSolto.error?.message).toMatch(/descartada_shape/)

    const carimboSolto = await admin
      .from('content_trends')
      .update({ decidida_por: adminId, decidida_em: new Date().toISOString() })
      .eq('id', id)
    expect(carimboSolto.error?.message).toMatch(/decidida_shape/)
  })

  it('descartar com motivo e ator passa; roteirizar com carimbo passa', async () => {
    const d = await criarTrend()
    await descartar(d, 'já gravamos esse tema')
    const [desc] = await sql`
      select status, discard_reason, decidida_por from content_trends where id = ${d}`
    expect(desc.status).toBe('descartada')
    expect(desc.discard_reason).toBe('já gravamos esse tema')
    expect(desc.decidida_por).toBe(adminId)

    const r = await criarTrend()
    const { error } = await admin
      .from('content_trends')
      .update({ status: 'roteirizada', decidida_por: adminId, decidida_em: new Date().toISOString() })
      .eq('id', r)
    expect(error).toBeNull()
  })

  it('a válvula da dona: travel_score_ajustado e tema_cluster são da mão humana', async () => {
    const id = await criarTrend()
    const { error } = await admin
      .from('content_trends')
      .update({ travel_score_ajustado: 95, tema_cluster: 'pedir café' })
      .eq('id', id)
    expect(error).toBeNull()

    for (const mudanca of [{ travel_score_ajustado: 10 }, { tema_cluster: 'x' }]) {
      const { error: negado } = await robo.from('content_trends').update(mudanca).eq('id', id)
      expect(negado?.message, `o robô ESCREVEU ${JSON.stringify(mudanca)}`).toMatch(
        /permission denied/i,
      )
    }
  })

  it('a nota é do robô: admin não escreve travel_score/travel_meta', async () => {
    const id = await criarTrend()
    for (const mudanca of [{ travel_score: 99 }, { travel_meta: { justificativa: 'x' } }]) {
      const { error } = await admin.from('content_trends').update(mudanca).eq('id', id)
      expect(error?.message, `a admin ESCREVEU ${JSON.stringify(mudanca)}`).toMatch(
        /permission denied/i,
      )
    }
  })

  it('o robô se cura: preenche travel_score NULL enquanto a trend é NOVA', async () => {
    const id = await criarTrend({ travel_score: null, travel_meta: {} })
    const { error } = await robo
      .from('content_trends')
      .update({ travel_score: 84, travel_meta: { justificativa: 'nativa de viagem' } })
      .eq('id', id)
    expect(error).toBeNull()
    const [row] = await sql`select travel_score from content_trends where id = ${id}`
    expect(row.travel_score).toBe(84)
  })
})

describe('content_trends — terminais, medição congelada e DELETE', () => {
  it('descartada é terminal: não se edita nem sai', async () => {
    const id = await criarTrend()
    await descartar(id)
    const edita = await admin
      .from('content_trends')
      .update({ tema_cluster: 'outro', decidida_por: adminId, decidida_em: new Date().toISOString() })
      .eq('id', id)
    expect(edita.error?.message).toMatch(/imutável/)
    const sai = await admin
      .from('content_trends')
      .update({ status: 'nova' })
      .eq('id', id)
    expect(sai.error?.message).toMatch(/imutável/)
  })

  it('roteirizada é terminal: nem a nota do robô muda mais', async () => {
    const id = await criarTrend({ travel_score: null, travel_meta: {} })
    const { error } = await admin
      .from('content_trends')
      .update({ status: 'roteirizada', decidida_por: adminId, decidida_em: new Date().toISOString() })
      .eq('id', id)
    expect(error).toBeNull()
    const cura = await robo.from('content_trends').update({ travel_score: 50 }).eq('id', id)
    expect(cura.error?.message).toMatch(/imutável/)
  })

  it('a medição é retrato da captura: nem o OWNER reescreve views/velocidade/semana/FK', async () => {
    const id = await criarTrend()
    // research_id incluído de propósito (achado nº 21 do Sol): o guard congela
    // a FK ANTES de a integridade referencial opinar.
    for (const patch of [
      sql`update content_trends set views = 999999 where id = ${id}`,
      sql`update content_trends set velocidade = 42 where id = ${id}`,
      sql`update content_trends set semana = '2020-W01' where id = ${id}`,
      sql`update content_trends set url = 'https://outro' where id = ${id}`,
      sql`update content_trends set research_id = ${crypto.randomUUID()} where id = ${id}`,
    ]) {
      await expect(patch).rejects.toThrow(/congelada/)
    }
  })

  it('linha de research SUPERADA não vira trend (achado nº 1 do Sol)', async () => {
    const k = chave('superada')
    const run1 = await criarResearch(k)
    // --force cria o run 2 e supera o run 1 na mesma fonte.
    const força = await robo.rpc('record_content_research', {
      p_tipo: 'analise_reel',
      p_plataforma: 'youtube',
      p_source_key: k,
      p_payload: { transcricao: { texto: 'fixture 2', via: 'teste' } },
      p_force: true,
    })
    expect(força.error).toBeNull()
    const run2 = (força.data as { id: string; foi_criado: boolean }[])[0]
    expect(run2.foi_criado).toBe(true)

    const velha = await robo.from('content_trends').insert(linhaDaTrend(run1, k))
    expect(velha.error?.message).toMatch(/ATIVA|superada/)

    const ativa = await robo.from('content_trends').insert(linhaDaTrend(run2.id, k))
    expect(ativa.error).toBeNull()
  })

  it('trend não se apaga — nem pela API, nem pelo owner; TRUNCATE proibido', async () => {
    const id = await criarTrend()
    const pelaApi = await robo.from('content_trends').delete().eq('id', id)
    expect(pelaApi.error?.message).toMatch(/permission denied/i)
    await expect(sql`delete from content_trends where id = ${id}`).rejects.toThrow(/não se apaga/)
    // CASCADE de propósito: o truncate simples já morre na FK de content_posts;
    // o caminho perigoso é o cascade (arrastaria content_posts, que não tem
    // anti-truncate próprio) — e é o trigger que o segura.
    await expect(sql`truncate content_trends cascade`).rejects.toThrow(/TRUNCATE proibido/)
  })
})

describe('content_trends — variações (linha própria, raiz, herança, cascata)', () => {
  async function criarVariacao(maeId: string, over: Record<string, unknown> = {}): Promise<string> {
    const k = chave('var')
    const r = await criarResearch(k)
    const { data, error } = await robo
      .from('content_trends')
      .insert(linhaDaTrend(r, k, { variacao_de: maeId, ...over }))
      .select('id')
      .single()
    expect(error, `variação recusada: ${error?.message}`).toBeNull()
    return data!.id as string
  }

  it('variação nasce NOVA pendurada na mãe; variacao_de é imutável', async () => {
    const mae = await criarTrend()
    const v = await criarVariacao(mae)
    const [row] = await sql`select variacao_de, status from content_trends where id = ${v}`
    expect(row.variacao_de).toBe(mae)
    expect(row.status).toBe('nova')

    await expect(
      sql`update content_trends set variacao_de = null where id = ${v}`,
    ).rejects.toThrow(/congelada/)
  })

  it('variação aponta para a RAIZ: variação de variação explode (profundidade 1)', async () => {
    const mae = await criarTrend()
    const v = await criarVariacao(mae)
    const k = chave('neta')
    const r = await criarResearch(k)
    const { error } = await robo
      .from('content_trends')
      .insert(linhaDaTrend(r, k, { variacao_de: v }))
    expect(error?.message).toMatch(/raiz/i)
  })

  it('descartar a mãe CASCATEIA às variações novas, herdando motivo e ator', async () => {
    const mae = await criarTrend()
    const v1 = await criarVariacao(mae)
    const v2 = await criarVariacao(mae)
    await descartar(mae, 'tema saturado')

    const filhas = await sql`
      select id, status, discard_reason, decidida_por from content_trends
       where id in (${v1}, ${v2}) order by id`
    for (const f of filhas) {
      expect(f.status).toBe('descartada')
      expect(f.discard_reason).toMatch(/tema descartado na mãe/)
      expect(f.discard_reason).toMatch(/tema saturado/)
      expect(f.decidida_por).toBe(adminId)
    }
  })

  it('a cascata não toca variação já decidida', async () => {
    const mae = await criarTrend()
    const v = await criarVariacao(mae)
    const { error } = await admin
      .from('content_trends')
      .update({ status: 'roteirizada', decidida_por: adminId, decidida_em: new Date().toISOString() })
      .eq('id', v)
    expect(error).toBeNull()
    await descartar(mae)
    const [row] = await sql`select status from content_trends where id = ${v}`
    expect(row.status).toBe('roteirizada')
  })

  it('colisão com tema MORTO não some: nasce descartada herdando motivo e ator da mãe (fim da supressão)', async () => {
    const mae = await criarTrend()
    await descartar(mae, 'não é a nossa voz')
    const [dona] = await sql`
      select discard_reason, decidida_por, decidida_em from content_trends where id = ${mae}`

    const v = await criarVariacao(mae, {
      status: 'descartada',
      discard_reason: `tema descartado na mãe: ${dona.discard_reason}`,
      decidida_por: dona.decidida_por,
      decidida_em: dona.decidida_em,
    })
    const [row] = await sql`
      select status, discard_reason, decidida_por from content_trends where id = ${v}`
    expect(row.status).toBe('descartada')
    expect(row.discard_reason).toMatch(/não é a nossa voz/)
    expect(row.decidida_por).toBe(adminId)
  })

  it('nascer descartada exige mãe DESCARTADA — mãe viva não autoriza', async () => {
    const mae = await criarTrend()
    const k = chave('herda-viva')
    const r = await criarResearch(k)
    const { error } = await robo.from('content_trends').insert(
      linhaDaTrend(r, k, {
        variacao_de: mae,
        status: 'descartada',
        discard_reason: 'x',
        decidida_por: adminId,
        decidida_em: new Date().toISOString(),
      }),
    )
    expect(error?.message).toMatch(/mãe/)
  })

  it('mãe descartada não ganha filha NOVA (achado nº 3 do Sol): a cascata já passou', async () => {
    const mae = await criarTrend()
    await descartar(mae)
    const k = chave('nova-orfa')
    const r = await criarResearch(k)
    const { error } = await robo
      .from('content_trends')
      .insert(linhaDaTrend(r, k, { variacao_de: mae }))
    expect(error?.message).toMatch(/já descartado/)
  })

  it('a herança é EXATA (achado nº 4 do Sol): motivo inventado ou sem prefixo explode', async () => {
    const mae = await criarTrend()
    await descartar(mae, 'não é a nossa voz')
    const k = chave('herda-torta')
    const r = await criarResearch(k)
    const { error } = await robo.from('content_trends').insert(
      linhaDaTrend(r, k, {
        variacao_de: mae,
        status: 'descartada',
        discard_reason: 'motivo inventado pelo robô',
        decidida_por: adminId,
        decidida_em: new Date().toISOString(),
      }),
    )
    expect(error?.message).toMatch(/HERDA/)
  })

  it('autorreferência não passa (achado nº 7 do Sol): mãe invisível é recusada', async () => {
    const k = chave('auto')
    const r = await criarResearch(k)
    const id = crypto.randomUUID()
    await expect(sql`
      insert into content_trends (id, research_id, source_key, plataforma, semana, variacao_de)
      values (${id}, ${r}, ${k}, 'youtube', ${semanaIso()}, ${id})
    `).rejects.toThrow(/inexistente ou não confirmada/)
  })
})

describe('content_trends — audit, RLS e o catálogo das duas mãos', () => {
  it('captura e decisão deixam rastro no audit_log — decisão com ATOR real', async () => {
    const id = await criarTrend()
    await descartar(id)
    const linhas = await sql<{ action: string; n: number }[]>`
      select action, count(*)::int as n from audit_log
       where entity = 'content_trends' and entity_id = ${id} group by action`
    const porAcao = Object.fromEntries(linhas.map((l) => [l.action, l.n]))
    expect(porAcao.insert).toBe(1)
    expect(porAcao.update).toBeGreaterThanOrEqual(1)
    expect(porAcao.delete).toBeUndefined()

    // Achado nº 28 do Sol: contagem sem autoria seria audit de fachada. A
    // captura do robô tem actor NULL por semântica da casa (NULL = robô);
    // a DECISÃO é humana e carrega o uid de quem decidiu.
    const [decisao] = await sql`
      select actor from audit_log
       where entity = 'content_trends' and entity_id = ${id} and action = 'update'
       order by at desc limit 1`
    expect(decisao.actor).toBe(adminId)
  })

  it('admin enxerga; anon devolve VAZIO sem erro (negar-por-padrão da Lei 4)', async () => {
    const id = await criarTrend()
    const ve = await admin.from('content_trends').select('id').eq('id', id)
    expect(ve.error).toBeNull()
    expect(ve.data).toHaveLength(1)

    const anon = anonClient()
    const cego = await anon.from('content_trends').select('id').eq('id', id)
    expect(cego.error).toBeNull()
    expect(cego.data).toEqual([])
  })

  it('o catálogo confirma as duas mãos COLUNA A COLUNA (tripwire molde A8)', async () => {
    const colunas = (
      await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'content_trends'`
    ).map((r) => r.column_name)
    expect(colunas.length).toBeGreaterThan(0)

    const privilegio = async (grantee: string, tipo: string) =>
      (
        await sql<{ column_name: string }[]>`
          select column_name from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'content_trends'
             and grantee = ${grantee} and privilege_type = ${tipo}`
      ).map((r) => r.column_name).sort()

    // Mão humana: decide e ajusta — nunca insere, nunca mexe na medição.
    expect(await privilegio('authenticated', 'UPDATE')).toEqual(
      ['status', 'discard_reason', 'travel_score_ajustado', 'tema_cluster',
        'decidida_por', 'decidida_em'].sort(),
    )
    expect(await privilegio('authenticated', 'INSERT')).toEqual([])

    // Mão do robô: insere a captura inteira MENOS as seladas (id, carimbos,
    // curadoria da admin); no UPDATE, só a nota que se cura.
    const SELADAS_NO_INSERT = [
      'id', 'capturada_em', 'created_at', 'updated_at', 'tema_cluster', 'travel_score_ajustado',
    ]
    expect(await privilegio('service_role', 'INSERT')).toEqual(
      colunas.filter((c) => !SELADAS_NO_INSERT.includes(c)).sort(),
    )
    expect(await privilegio('service_role', 'UPDATE')).toEqual(['travel_meta', 'travel_score'])

    // Uma TERCEIRA mão não existe (achado nº 24 do Sol): PUBLIC e anon sem
    // privilégio de coluna algum de escrita — grant a PUBLIC não apareceria
    // nas listas acima e escreveria por herança.
    for (const grantee of ['PUBLIC', 'anon']) {
      for (const tipo of ['UPDATE', 'INSERT']) {
        expect(await privilegio(grantee, tipo), `${grantee} com ${tipo} de coluna`).toEqual([])
      }
    }

    // O privilégio de TABELA continua ausente (lição da 20260729000100) — é ele
    // que tornaria o selo de coluna inútil.
    for (const tipo of ['UPDATE', 'INSERT'] as const) {
      const [priv] = await sql`
        select has_table_privilege('authenticated', 'public.content_trends', ${tipo}) as humano,
               has_table_privilege('service_role', 'public.content_trends', ${tipo}) as robo,
               has_table_privilege('anon', 'public.content_trends', ${tipo}) as anon`
      expect(priv.humano, `authenticated com ${tipo} de tabela`).toBe(false)
      expect(priv.robo, `service_role com ${tipo} de tabela`).toBe(false)
      expect(priv.anon, `anon com ${tipo} de tabela`).toBe(false)
    }
  })

  it('o domínio dos CHECKs é EXATAMENTE o combinado (pg_get_constraintdef)', async () => {
    const defs = await sql<{ conname: string; def: string; convalidated: boolean }[]>`
      select conname, pg_get_constraintdef(oid) as def, convalidated
        from pg_constraint
       where conrelid = 'public.content_trends'::regclass
         and conname in ('content_trends_status_check', 'content_trends_plataforma_check')`
    expect(defs).toHaveLength(2)
    for (const d of defs) expect(d.convalidated, `${d.conname} não validado`).toBe(true)

    const literais = (def: string) => [...def.matchAll(/'([^']*)'/g)].map((m) => m[1]).sort()
    const porNome = Object.fromEntries(defs.map((d) => [d.conname, d.def]))
    expect(literais(porNome.content_trends_status_check)).toEqual([...STATUS_DA_TREND].sort())
    expect(literais(porNome.content_trends_plataforma_check)).toEqual([...REDES].sort())
  })
})

describe('content_posts — trend_id e contexto (a ponte trend → roteiro)', () => {
  function ref(prefixo: string): string {
    return `trends-${prefixo}-${crypto.randomUUID().slice(0, 8)}`
  }

  async function criarPost(over: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await admin
      .from('content_posts')
      .insert({ external_ref: ref('post'), kind: 'roteiro_reel', tema: 'Tema ponte', ...over })
      .select('id')
      .single()
    expect(error, `post de fixture recusado: ${error?.message}`).toBeNull()
    return data!.id as string
  }

  it('post nasce vinculado à trend com contexto (o caminho da RPC da Leva 5)', async () => {
    const trend = await criarTrend()
    const id = await criarPost({ trend_id: trend, contexto: 'travel' })
    const [row] = await sql`select trend_id, contexto from content_posts where id = ${id}`
    expect(row.trend_id).toBe(trend)
    expect(row.contexto).toBe('travel')
  })

  it('contexto fora do domínio explode; o CHECK bate com a lista TS', async () => {
    const trend = await criarTrend()
    const { error } = await admin
      .from('content_posts')
      .insert({
        external_ref: ref('ctx'), kind: 'roteiro_reel', tema: 'x',
        trend_id: trend, contexto: 'carrossel',
      })
    expect(error?.message).toMatch(/contexto/)

    const [def] = await sql<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid = 'public.content_posts'::regclass
         and conname = 'content_posts_contexto_check'`
    const literais = [...def.def.matchAll(/'([^']*)'/g)].map((m) => m[1]).sort()
    expect(literais).toEqual([...CONTEXTOS].sort())
  })

  it('o vínculo entra depois (script da 2.3) mas NÃO se troca nem se apaga', async () => {
    const trendA = await criarTrend()
    const trendB = await criarTrend()
    const id = await criarPost()

    const entra = await admin.from('content_posts').update({ trend_id: trendA }).eq('id', id)
    expect(entra.error).toBeNull()

    const troca = await admin.from('content_posts').update({ trend_id: trendB }).eq('id', id)
    expect(troca.error?.message).toMatch(/não se troca/)
    const apaga = await admin.from('content_posts').update({ trend_id: null }).eq('id', id)
    expect(apaga.error?.message).toMatch(/não se troca/)
  })

  it('contexto definido também congela', async () => {
    const trend = await criarTrend()
    const id = await criarPost({ trend_id: trend, contexto: 'geral' })
    const { error } = await admin.from('content_posts').update({ contexto: 'travel' }).eq('id', id)
    expect(error?.message).toMatch(/não se troca/)
  })

  it('pós-aprovado a ponte fica FORA da whitelist: vincular trend ali é contrabando', async () => {
    const trend = await criarTrend()
    const id = await criarPost()
    for (const patch of [
      {
        status: 'ideia_aprovada',
        idea_approved_by: adminId,
        idea_approved_at: new Date().toISOString(),
      },
      { status: 'gerando', generation_started_at: new Date().toISOString() },
      { status: 'rascunho', legenda: 'Legenda', roteiro: 'GANCHO: x' },
      { status: 'aprovado', approved_by: adminId, approved_at: new Date().toISOString() },
    ]) {
      const { error } = await admin.from('content_posts').update(patch).eq('id', id)
      expect(error).toBeNull()
    }
    const { error } = await admin.from('content_posts').update({ trend_id: trend }).eq('id', id)
    expect(error?.message).toMatch(/congelado/)
  })

  it('a migração da 2.3 em miniatura: ideia ganha trend_id e vai para o arquivo no MESMO update', async () => {
    const trend = await criarTrend()
    const id = await criarPost()
    const { error } = await admin
      .from('content_posts')
      .update({
        trend_id: trend,
        status: 'arquivado',
        archived_reason: `migrada para o radar (trend ${trend})`,
      })
      .eq('id', id)
    expect(error).toBeNull()
    const [row] = await sql`select status, trend_id from content_posts where id = ${id}`
    expect(row.status).toBe('arquivado')
    expect(row.trend_id).toBe(trend)
  })
})
