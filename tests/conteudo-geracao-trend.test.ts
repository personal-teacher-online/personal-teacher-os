// Estúdio v2 — Leva 5.1 (ADR-032 decisão 5 · ADR-035): a RPC
// `gerar_roteiro_da_trend`, que é o FIM DO PORTÃO 1. Escolher a trend no radar
// passa a ser a aprovação: numa transação só, o post nasce `ideia`, vira
// `ideia_aprovada` com o carimbo da dona e a trend vira `roteirizada`.
//
// 📌 REGRA 7 do fluxo da frente: este arquivo nasceu VERMELHO e foi commitado
// assim, ANTES da migration. Migration aplicada é imutável (Lei 7) — o "teste
// primeiro" paga exatamente aqui.
//
// ── POR QUE NÃO EXISTE ASSERÇÃO DE CONTAGEM ABSOLUTA ────────────────────────
// Régua da casa: arquivos rodam em PARALELO. O teto diário é um número GLOBAL
// (some com o que outros arquivos reivindicaram no mesmo dia), então nenhum
// caso aqui afirma "hoje tem 0". O que se afirma é o CONTRATO, que vale em
// qualquer estado do banco:
//   · `gerar_agora = (ja_hoje < teto)` — a decisão é função da contagem;
//   · forçar o teto (reivindicar posts hoje) só faz a contagem SUBIR, então o
//     caso do estouro é determinístico;
//   · a fronteira do dia é conferida no TEXTO da função (o mesmo idioma do
//     `pg_get_constraintdef` que a Leva 2 usou), porque o agregado global não
//     consegue provar que a linha de ontem ficou de fora.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { anonClient, clientAs, createAuthUser, serviceClient } from './helpers/auth'
import { connect } from './helpers/db'
import { TETO_DIARIO_DE_ROTEIROS } from '@/lib/content/generate'
import { semanaIso } from '@/lib/research/tipos'

let sql: Sql
let admin: SupabaseClient
let adminId: string
let robo: SupabaseClient
let professora: SupabaseClient

/** Os dois contextos de destino (ADR-035 decisão 2) — o CHECK da 107 já os fixa
 *  em `content_posts.contexto`; aqui eles são o contrato de entrada da RPC. */
const CONTEXTOS = ['geral', 'travel'] as const

beforeAll(async () => {
  sql = connect(3)
  adminId = await createAuthUser(sql, 'admin', 'Admin geração de trend')
  admin = await clientAs(adminId, 'admin')
  const teacherId = await createAuthUser(sql, 'teacher', 'Professora sem alçada')
  professora = await clientAs(teacherId, 'teacher')
  robo = serviceClient()
})
afterAll(async () => {
  await sql.end()
})

function chave(prefixo: string): string {
  return `reel:youtube:gerar-${prefixo}-${crypto.randomUUID().slice(0, 8)}`
}

/** Linha de research ATIVA (porta única — a mesma que o worker usa). */
async function criarResearch(sourceKey: string): Promise<string> {
  const { data, error } = await robo.rpc('record_content_research', {
    p_tipo: 'analise_reel',
    p_plataforma: 'youtube',
    p_source_key: sourceKey,
    p_payload: {
      transcricao: { texto: 'fixture', via: 'teste' },
      analise: {
        gancho: { texto_falado: 'Você fala isso errado no aeroporto', tipo: 'pergunta' },
        beats: [{ funcao: 'gancho', resumo: 'abre com o erro' }],
        por_que_performou: ['erro comum com vergonha embutida'],
      },
    },
    p_metricas: { views: 1000 },
    p_titulo: 'O erro do aeroporto',
    p_url: 'https://youtube.com/shorts/fixture',
    p_publicado_em: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  })
  expect(error, `research de fixture recusado: ${error?.message}`).toBeNull()
  return (data as { id: string }[])[0].id
}

/** Trend `nova` inserida pela mão certa (o robô). */
async function criarTrend(over: Record<string, unknown> = {}): Promise<string> {
  const sourceKey = chave('t')
  const researchId = await criarResearch(sourceKey)
  const { data, error } = await robo
    .from('content_trends')
    .insert({
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
    })
    .select('id')
    .single()
  expect(error, `INSERT de trend recusado: ${error?.message}`).toBeNull()
  return data!.id as string
}

interface Retorno {
  post_id: string
  gerar_agora: boolean
  ja_hoje: number
  teto: number
}

async function gerar(
  cliente: SupabaseClient,
  trendId: string,
  contexto: string,
  over: Record<string, unknown> = {},
): Promise<{ data: Retorno | null; error: { message: string } | null }> {
  const { data, error } = await cliente.rpc('gerar_roteiro_da_trend', {
    p_trend_id: trendId,
    p_contexto: contexto,
    p_tema: 'O erro do aeroporto',
    p_gancho: 'Você fala isso errado no aeroporto',
    p_idea: { de_onde_veio: 'Cópia de "O erro do aeroporto" no YouTube' },
    ...over,
  })
  const linhas = (data ?? []) as Retorno[]
  return { data: linhas[0] ?? null, error }
}

/** O contrato do teto, verdadeiro em qualquer estado do banco. */
function conferirContratoDoTeto(r: Retorno): void {
  expect(r.teto).toBe(TETO_DIARIO_DE_ROTEIROS)
  expect(r.gerar_agora).toBe(r.ja_hoje < r.teto)
}

/** Reivindica um post HOJE — é isso que consome o teto (a chamada da API). */
async function consumirUmaGeracao(): Promise<string> {
  const [post] = await sql`
    insert into content_posts (kind, tema, external_ref)
    values ('roteiro_reel', ${'Fixture de teto ' + crypto.randomUUID().slice(0, 8)},
            ${'teto:' + crypto.randomUUID()})
    returning id`
  const id = post.id as string
  await sql`
    update content_posts
       set status = 'ideia_aprovada', idea_approved_by = ${adminId}, idea_approved_at = now()
     where id = ${id}`
  await sql`
    update content_posts
       set status = 'gerando', generation_started_at = now(), generation_attempts = 1
     where id = ${id}`
  return id
}

describe('gerar_roteiro_da_trend — a porta única do roteiro (Leva 5.1)', () => {
  it('trend NOVA: cria o post aprovado e carimba a trend, numa transação só', async () => {
    const trend = await criarTrend()
    const { data, error } = await gerar(admin, trend, 'geral')
    expect(error, `RPC recusada: ${error?.message}`).toBeNull()
    expect(data).not.toBeNull()
    conferirContratoDoTeto(data!)

    const [post] = await sql`
      select status, kind, tema, gancho, idea, trend_id, contexto, external_ref,
             idea_approved_by, idea_approved_at, created_by, generation_attempts,
             generation_started_at
        from content_posts where id = ${data!.post_id}`
    // Com folga no dia o post JÁ SAI reivindicado — a reserva da vaga do teto é
    // a própria reivindicação (correção do achado 1 do Sol). Sem folga ele fica
    // na fila. As duas leituras são o MESMO contrato, e é ele que se afirma:
    // o estado do post é função de `gerar_agora`, nunca do acaso do dia.
    expect(post.status).toBe(data!.gerar_agora ? 'gerando' : 'ideia_aprovada')
    expect(post.generation_attempts).toBe(data!.gerar_agora ? 1 : 0)
    expect(post.generation_started_at == null).toBe(!data!.gerar_agora)
    expect(post.kind).toBe('roteiro_reel')
    expect(post.tema).toBe('O erro do aeroporto')
    expect(post.gancho).toBe('Você fala isso errado no aeroporto')
    expect(post.idea.de_onde_veio).toMatch(/O erro do aeroporto/)
    expect(post.trend_id).toBe(trend)
    expect(post.contexto).toBe('geral')
    expect(post.idea_approved_by).toBe(adminId)
    expect(post.idea_approved_at).not.toBeNull()

    const [t] = await sql`
      select status, decidida_por, decidida_em, discard_reason
        from content_trends where id = ${trend}`
    expect(t.status).toBe('roteirizada')
    expect(t.decidida_por).toBe(adminId)
    expect(t.decidida_em).not.toBeNull()
    expect(t.discard_reason).toBeNull()
  })

  it('a mesma trend gera os DOIS contextos: o 2º cria OUTRO post e não toca a trend', async () => {
    const trend = await criarTrend()
    const primeiro = await gerar(admin, trend, 'geral')
    expect(primeiro.error).toBeNull()
    const [antes] = await sql`
      select decidida_em, updated_at from content_trends where id = ${trend}`

    const segundo = await gerar(admin, trend, 'travel')
    expect(segundo.error, `2º contexto recusado: ${segundo.error?.message}`).toBeNull()
    expect(segundo.data!.post_id).not.toBe(primeiro.data!.post_id)

    const [depois] = await sql`
      select status, decidida_em, updated_at from content_trends where id = ${trend}`
    expect(depois.status).toBe('roteirizada')
    // Terminal de linha (nota 3 da migration 107): a 2ª geração NÃO reescreve a
    // trend — nem o carimbo, nem o updated_at.
    expect(depois.decidida_em).toEqual(antes.decidida_em)
    expect(depois.updated_at).toEqual(antes.updated_at)

    const posts = await sql`
      select contexto, external_ref from content_posts
       where trend_id = ${trend} order by created_at`
    expect(posts.map((p) => p.contexto)).toEqual(['geral', 'travel'])
  })

  it('external_ref é sequencial por trend+contexto — regerar não colide', async () => {
    const trend = await criarTrend()
    const um = await gerar(admin, trend, 'geral')
    const dois = await gerar(admin, trend, 'geral')
    expect(um.error).toBeNull()
    expect(dois.error, `regeração recusada: ${dois.error?.message}`).toBeNull()

    const refs = await sql`
      select external_ref from content_posts
       where trend_id = ${trend} and contexto = 'geral' order by created_at`
    expect(refs.map((r) => r.external_ref)).toEqual([
      `trend:${trend}:geral:1`,
      `trend:${trend}:geral:2`,
    ])
  })

  it('contexto fora do par (geral|travel) é recusado', async () => {
    const trend = await criarTrend()
    for (const invalido of ['', 'venda', 'GERAL', 'travel ']) {
      const { error } = await gerar(admin, trend, invalido)
      // A frase inteira, não a palavra "contexto": o nome do parâmetro aparece
      // em qualquer erro de assinatura e daria FALSO VERDE no arquivo vermelho.
      expect(error?.message, `contexto "${invalido}" passou`).toMatch(/geral ou travel/i)
    }
    const [t] = await sql`select status from content_trends where id = ${trend}`
    expect(t.status).toBe('nova')
    expect(CONTEXTOS).toContain('geral')
  })

  it('tema em branco é recusado — o post não nasce sem assunto', async () => {
    const trend = await criarTrend()
    const { error } = await gerar(admin, trend, 'geral', { p_tema: '   ' })
    expect(error?.message).toMatch(/precisa de tema/i)
    const [t] = await sql`select status from content_trends where id = ${trend}`
    expect(t.status).toBe('nova')
  })

  it('trend inexistente e trend DESCARTADA não viram roteiro', async () => {
    const fantasma = await gerar(admin, crypto.randomUUID(), 'geral')
    expect(fantasma.error?.message).toMatch(/não existe|inexistente/i)

    const trend = await criarTrend()
    await admin
      .from('content_trends')
      .update({
        status: 'descartada',
        discard_reason: 'fora do tema',
        decidida_por: adminId,
        decidida_em: new Date().toISOString(),
      })
      .eq('id', trend)
    const { error } = await gerar(admin, trend, 'geral')
    expect(error?.message).toMatch(/descartada/i)
    const nenhum = await sql`select count(*)::int as n from content_posts where trend_id = ${trend}`
    expect(nenhum[0].n).toBe(0)
  })

  it('é uma transação só: a decisão da trend e a aprovação do post são o MESMO instante', async () => {
    const trend = await criarTrend()
    const { data } = await gerar(admin, trend, 'geral')
    const [linha] = await sql`
      select t.decidida_em, p.idea_approved_at, p.created_at
        from content_trends t
        join content_posts p on p.id = ${data!.post_id}
       where t.id = ${trend}`
    // `now()` no Postgres é o instante da TRANSAÇÃO: carimbo idêntico ao
    // microssegundo só acontece se os dois nasceram no mesmo COMMIT. Duas
    // transações separadas divergiriam.
    expect(linha.idea_approved_at).toEqual(linha.decidida_em)
    expect(linha.created_at).toEqual(linha.decidida_em)
  })

  it('validação recusada não deixa rastro: a trend continua NOVA e sem post', async () => {
    const trend = await criarTrend()
    const { error } = await gerar(admin, trend, 'venda')
    expect(error).not.toBeNull()
    const [t] = await sql`select status, decidida_por from content_trends where id = ${trend}`
    expect(t.status).toBe('nova')
    expect(t.decidida_por).toBeNull()
    const [n] = await sql`select count(*)::int as n from content_posts where trend_id = ${trend}`
    expect(n.n).toBe(0)
  })

  it('chave natural ocupada por fora NÃO trava a trend — a sequência pula', async () => {
    // Achado 9 do Sol: `external_ref` é único GLOBAL, e a sequência contada por
    // (trend, contexto) deixaria uma linha usurpadora bloquear a geração para
    // sempre. Com a contagem pelo PREFIXO, a chave seguinte é a livre.
    const trend = await criarTrend()
    await sql`
      insert into content_posts (kind, tema, external_ref)
      values ('roteiro_reel', 'Linha usurpadora', ${`trend:${trend}:geral:1`})`

    const { data, error } = await gerar(admin, trend, 'geral')
    expect(error, `a usurpadora travou a geração: ${error?.message}`).toBeNull()
    const [post] = await sql`select external_ref from content_posts where id = ${data!.post_id}`
    expect(post.external_ref).toBe(`trend:${trend}:geral:2`)
  })

  it('corrida entre abas: a segunda chamada na trend NOVA perde com frase honesta', async () => {
    const trend = await criarTrend()
    const [a, b] = await Promise.all([gerar(admin, trend, 'geral'), gerar(admin, trend, 'travel')])
    const vencedores = [a, b].filter((r) => r.error === null)
    const perdedores = [a, b].filter((r) => r.error !== null)
    // As duas podem passar (a 2ª pega a trend já roteirizada, que é legítimo) —
    // o que NÃO pode é a trend ficar em estado inválido ou o carimbo mudar.
    expect(vencedores.length).toBeGreaterThanOrEqual(1)
    for (const p of perdedores) expect(p.error!.message).toMatch(/decidida|roteirizada|existe/i)
    const [t] = await sql`select status, decidida_por from content_trends where id = ${trend}`
    expect(t.status).toBe('roteirizada')
    expect(t.decidida_por).toBe(adminId)
  })
})

describe('teto diário de roteiros (ADR-035 decisão 3)', () => {
  it('o teto do banco e a constante do TypeScript são o MESMO número', async () => {
    const [row] = await sql`select public.teto_diario_de_roteiros() as teto`
    expect(row.teto).toBe(TETO_DIARIO_DE_ROTEIROS)
  })

  it('a contagem do dia é do dia civil do NEGÓCIO, nunca current_date', async () => {
    const [row] = await sql`
      select pg_get_functiondef('public.roteiros_gerados_hoje()'::regprocedure) as fonte`
    // Sem os comentários: a própria migration EXPLICA a armadilha citando
    // `current_date`, e a explicação não pode disparar o alarme.
    const fonte = (row.fonte as string).replace(/--[^\n]*/g, '')
    expect(fonte).toMatch(/business_today\(\)/)
    expect(fonte).toMatch(/business_tz\(\)/)
    // `current_date` é UTC no servidor (TZ=UTC): das 20h à meia-noite de Cuiabá
    // ele já é o dia seguinte do negócio — a mesma armadilha documentada em
    // tests/helpers/db.ts.
    expect(fonte).not.toMatch(/current_date/)
  })

  it('reivindicar um post HOJE faz a contagem subir', async () => {
    const antes = await sql`select public.roteiros_gerados_hoje() as n`
    await consumirUmaGeracao()
    const depois = await sql`select public.roteiros_gerados_hoje() as n`
    expect(depois[0].n).toBeGreaterThan(antes[0].n)
  })

  it('duas chamadas simultâneas não cabem na mesma vaga do teto', async () => {
    // O achado 1 do Sol: contar sem reservar deixava N chamadas concorrentes se
    // acharem todas dentro do teto. Com o lock consultivo + a reserva (o post
    // sai reivindicado), no MÁXIMO uma passa por vaga.
    //
    // A asserção é de teto, não de piso: outros arquivos rodam em paralelo e só
    // fazem a contagem SUBIR — se o dia já estiver cheio, as duas voltam false,
    // e isso continua sendo obediência ao contrato.
    const [a, b] = await Promise.all([
      criarTrend().then((t) => gerar(admin, t, 'geral')),
      criarTrend().then((t) => gerar(admin, t, 'geral')),
    ])
    const passaram = [a, b].filter((r) => r.data?.gerar_agora)
    const folgaAntes = TETO_DIARIO_DE_ROTEIROS - Math.min(a.data!.ja_hoje, b.data!.ja_hoje)
    expect(passaram.length).toBeLessThanOrEqual(Math.max(0, folgaAntes))

    // E quem passou saiu com a vaga na mão, não com uma promessa.
    for (const r of passaram) {
      const [post] = await sql`
        select status, generation_attempts from content_posts where id = ${r.data!.post_id}`
      expect(post.status).toBe('gerando')
      expect(post.generation_attempts).toBe(1)
    }
  })

  it('teto estourado: o post nasce na FILA (ideia_aprovada), não em erro', async () => {
    // Forçar o teto só faz a contagem SUBIR — determinístico sob paralelismo.
    for (let i = 0; i < TETO_DIARIO_DE_ROTEIROS; i++) await consumirUmaGeracao()

    const trend = await criarTrend()
    const { data, error } = await gerar(admin, trend, 'travel')
    expect(error, `RPC recusada: ${error?.message}`).toBeNull()
    expect(data!.ja_hoje).toBeGreaterThanOrEqual(data!.teto)
    expect(data!.gerar_agora).toBe(false)

    // O post EXISTE e está na fila do cron — o teto não é recusa, é adiamento.
    const [post] = await sql`
      select status, contexto, generation_attempts, generation_error
        from content_posts where id = ${data!.post_id}`
    expect(post.status).toBe('ideia_aprovada')
    expect(post.contexto).toBe('travel')
    expect(post.generation_attempts).toBe(0)
    expect(post.generation_error).toBeNull()
    // E a trend foi decidida do mesmo jeito: a escolha da dona não fica pendurada.
    const [t] = await sql`select status from content_trends where id = ${trend}`
    expect(t.status).toBe('roteirizada')
  })
})

describe('o aviso de "ideias novas" não vale para o radar (achado 7 do Sol)', () => {
  it('o gatilho não avisa mais NENHUMA ideia — nem a do radar, nem a avulsa', async () => {
    // O achado 7 do Sol tinha feito o filtro cirúrgico (`trend_id is null`); a
    // Leva 6.2 foi além e matou a etapa `ideias` inteira, porque o Portão 1 que
    // ela media não existe mais. Sobra o Portão 2, intacto.
    //
    // Por que a prova é no TEXTO da função, e não em `notification_outbox`: a
    // dedupe é por admin e por DIA, e o gatilho avisa TODOS os admins — então
    // qualquer arquivo rodando em paralelo consome a chave do dia do admin
    // desta fixture. Uma contagem aqui seria sorteio.
    const [row] = await sql`
      select pg_get_functiondef('public.notify_content_review()'::regprocedure) as fonte`
    const fonte = (row.fonte as string).replace(/--[^\n]*/g, '')
    expect(fonte).not.toMatch(/tg_op = 'INSERT'/)
    // A etapa `rascunhos` (o Portão 2, que continua vivo) NÃO foi tocada.
    expect(fonte).toMatch(/new\.status = 'rascunho' and old\.status = 'gerando'/)
  })

  it('o post do radar realmente nasce com trend — o filtro tem em quem pegar', async () => {
    const trend = await criarTrend()
    const { data } = await gerar(admin, trend, 'geral')
    const [post] = await sql`select trend_id from content_posts where id = ${data!.post_id}`
    expect(post.trend_id).toBe(trend)
  })
})

describe('quem pode gerar', () => {
  it('mesmo PODENDO executar, o anônimo é recusado pelo papel — a defesa não é o grant', async () => {
    // Medido na janela de deploy (04/08): em PRODUÇÃO existe um default
    // privilege do papel `postgres` para funções que dá EXECUTE a
    // anon/service_role, e `revoke … from public` não tira grant de papel
    // NOMEADO. O banco local não tem esse default — então a ACL local é
    // FALSO-VERDE e este teste seria decoração se apenas conferisse o grant.
    //
    // O que ele prova, então, é a defesa que vale nos dois ambientes: com o
    // privilégio de execução CONCEDIDO de propósito aqui, a função continua
    // recusando quem não é admin, sem tocar em nada. A migration
    // 20260803000500 fecha o grant; esta asserção garante que fechá-lo é
    // profundidade, não a única linha.
    await sql`grant execute on function public.gerar_roteiro_da_trend(uuid, text, text, text, jsonb) to anon`
    try {
      const trend = await criarTrend()
      const { error } = await gerar(anonClient(), trend, 'geral')
      // DUAS camadas, e a que responde muda com o ambiente: no local o anônimo
      // nem consegue avaliar `app_role()` (permission denied na primeira linha
      // do corpo); em produção, onde o default privilege lhe deu execução
      // também nela, ele chega ao raise do papel. Nos dois casos: nada escrito.
      expect(error?.message).toMatch(/não decide pauta|sessão com ator|permission denied/i)
      const [t] = await sql`select status from content_trends where id = ${trend}`
      expect(t.status).toBe('nova')
      const [n] = await sql`select count(*)::int as n from content_posts where trend_id = ${trend}`
      expect(n.n).toBe(0)
    } finally {
      await sql`revoke execute on function public.gerar_roteiro_da_trend(uuid, text, text, text, jsonb) from anon`
    }
  })

  it('professora, aluno anônimo e service_role não geram roteiro de trend', async () => {
    const trend = await criarTrend()

    const daProfessora = await gerar(professora, trend, 'geral')
    expect(daProfessora.error?.message).toMatch(/admin|permission|denied/i)

    const doAnonimo = await gerar(anonClient(), trend, 'geral')
    expect(doAnonimo.error?.message).toMatch(/admin|permission|denied/i)

    // O robô CAPTURA; decidir é da mão humana (as duas mãos da migration 107).
    const doRobo = await gerar(robo, trend, 'geral')
    expect(doRobo.error?.message).toMatch(/admin|permission|denied/i)

    const [t] = await sql`select status from content_trends where id = ${trend}`
    expect(t.status).toBe('nova')
  })

  it('a decisão e a aprovação entram no audit_log com o ator real', async () => {
    const trend = await criarTrend()
    const { data } = await gerar(admin, trend, 'travel')

    const daTrend = await sql`
      select actor, action from audit_log
       where entity = 'content_trends' and entity_id = ${trend} order by at desc limit 1`
    expect(daTrend[0].actor).toBe(adminId)

    const doPost = await sql`
      select actor from audit_log
       where entity = 'content_posts' and entity_id = ${data!.post_id} order by at desc limit 1`
    expect(doPost[0].actor).toBe(adminId)
  })
})
