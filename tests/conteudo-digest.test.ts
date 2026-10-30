// Estúdio v2 — Leva 6.2 (ADR-036 decisão 1): o DIGEST DO LOTE. A varredura
// semanal, ao fechar, bate na porta da dona UMA vez por rodada com números —
// "N trends novas nesta varredura, X em destaque" + os rascunhos parados no
// portão 2 — no lugar do toque genérico por evento que morreu com o Portão 1.
//
// 📌 REGRA 7 do fluxo da frente: este arquivo nasceu VERMELHO e foi commitado
// assim, ANTES da migration. Migration aplicada é imutável (Lei 7).
//
// ── POR QUE A SEMANA DE CADA CASO É ÚNICA ───────────────────────────────────
// Régua da casa: arquivos rodam em PARALELO, e o digest fala com TODOS os
// admins do banco (os desta fixture e os que outro arquivo criou). Duas
// defesas, as duas necessárias:
//   · cada caso inventa a SUA rodada (`2019-Wnn` — ano que nenhuma varredura
//     real vai ter), então a contagem de trends daquela semana é determinística;
//   · toda asserção de outbox filtra pelos admins DESTA fixture.
// A contagem de rascunhos é a exceção declarada: ela é GLOBAL por natureza (é a
// fila do portão 2 inteira), então aqui se prova o CONTRATO — o número que sai
// no payload é o mesmo que o banco responde no instante da chamada — e o texto
// da função é pinado para provar de ONDE ele vem.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import type { SupabaseClient } from '@supabase/supabase-js'
import { anonClient, createAuthUser, serviceClient } from './helpers/auth'
import { connect } from './helpers/db'
import { TEMPLATES } from '@/lib/outbox/dispatch'
import { CHAVES_DO_CATALOGO } from '@/data/admin/ajustes-mensagens'
import { contentDigestEmail, contentDigestText } from '@/lib/email/content-digest'

let sql: Sql
let robo: SupabaseClient
/** Admin COM WhatsApp — desde a M3-1 (#42) o toque sai por e-mail mesmo assim. */
let adminZap: string
/** Admin sem número — cai no e-mail. */
let adminMail: string

/** O limiar da aba PT (`LIMIAR_ABA_PT`) é o que a tela usa; aqui ele é
 *  PARÂMETRO, e é isso que garante que o digest e o radar contem igual. */
const LIMIAR = 60

beforeAll(async () => {
  sql = connect(3)
  adminZap = await createAuthUser(sql, 'admin', 'Admin do digest (zap)')
  adminMail = await createAuthUser(sql, 'admin', 'Admin do digest (email)')
  await sql`update profiles set whatsapp_e164 = ${'+55659000' + String(Math.floor(Math.random() * 90000) + 10000)} where id = ${adminZap}`
  await sql`update profiles set whatsapp_e164 = null where id = ${adminMail}`
  robo = serviceClient()
})
afterAll(async () => {
  await sql.end()
})

// O ANO é sorteado por RODADA DE TESTE, não fixo: o banco não é limpo entre
// execuções, e uma segunda rodada com os mesmos rótulos somaria as trends da
// primeira ao lote (medido: 9 onde o caso esperava 3). Ano fora do calendário
// real da varredura + semana sequencial = rodada só desta execução.
const ANO_DA_FIXTURE = String(1000 + Math.floor(Math.random() * 9000))
let semanaSeq = 0
function rodada(): string {
  semanaSeq += 1
  return `${ANO_DA_FIXTURE}-W${String(semanaSeq).padStart(2, '0')}`
}

function chave(): string {
  return `reel:youtube:digest-${crypto.randomUUID().slice(0, 8)}`
}

/** Trend `nova` pela mão certa (o robô), na rodada pedida. */
async function criarTrend(semana: string, over: Record<string, unknown> = {}): Promise<string> {
  const sourceKey = chave()
  const { data: research, error: erroResearch } = await robo.rpc('record_content_research', {
    p_tipo: 'analise_reel',
    p_plataforma: 'youtube',
    p_source_key: sourceKey,
    p_payload: { transcricao: { texto: 'fixture', via: 'teste' }, analise: { gancho: { texto_falado: 'x' } } },
    p_metricas: { views: 1000 },
    p_titulo: 'Fixture do digest',
    p_url: 'https://youtube.com/shorts/fixture',
  })
  expect(erroResearch, `research recusado: ${erroResearch?.message}`).toBeNull()
  const { data, error } = await robo
    .from('content_trends')
    .insert({
      research_id: (research as { id: string }[])[0].id,
      source_key: sourceKey,
      plataforma: 'youtube',
      url: 'https://youtube.com/shorts/fixture',
      autor: 'Canal de fixture',
      views: 1000,
      velocidade: 2.5,
      velocidade_sem_conta: false,
      semana,
      travel_score: 40,
      travel_meta: { justificativa: 'fixture', prompt_versao: 1 },
      ...over,
    })
    .select('id')
    .single()
  expect(error, `INSERT de trend recusado: ${error?.message}`).toBeNull()
  return data!.id as string
}

interface LinhaDoDigest {
  channel: string
  payload: { semana?: string; novas?: number; destaque?: number; rascunhos?: number }
  dedupe_key: string
  sent_at: string | null
}

async function toquesDe(admin: string, semana: string): Promise<LinhaDoDigest[]> {
  return (await sql`
    select channel, payload, dedupe_key, sent_at
      from notification_outbox
     where template = 'content-digest'
       and recipient_profile_id = ${admin}
       and payload ->> 'semana' = ${semana}
     order by created_at`) as unknown as LinhaDoDigest[]
}

async function enfileirar(
  cliente: SupabaseClient,
  semana: string,
  limiar = LIMIAR,
): Promise<{ data: number | null; error: { message: string } | null }> {
  const { data, error } = await cliente.rpc('enqueue_content_digest', {
    p_semana: semana,
    p_limiar: limiar,
  })
  return { data: data as number | null, error }
}

describe('enqueue_content_digest — um toque por admin, por RODADA', () => {
  it('conta as raízes da rodada e as em destaque pelo limiar recebido', async () => {
    const semana = rodada()
    await criarTrend(semana, { travel_score: 82 })
    await criarTrend(semana, { travel_score: 61 })
    await criarTrend(semana, { travel_score: 12 })

    const { data, error } = await enfileirar(robo, semana)
    expect(error, `digest recusado: ${error?.message}`).toBeNull()
    expect(data).toBeGreaterThanOrEqual(2) // os dois admins desta fixture, no mínimo

    for (const admin of [adminZap, adminMail]) {
      const linhas = await toquesDe(admin, semana)
      expect(linhas).toHaveLength(1)
      expect(linhas[0].payload.novas).toBe(3)
      expect(linhas[0].payload.destaque).toBe(2)
      expect(linhas[0].dedupe_key).toBe(`content-digest:${semana}:${admin}`)
    }
  })

  it('a nota da dona vence a do robô no destaque (ajustado ?? score)', async () => {
    const semana = rodada()
    const rebaixada = await criarTrend(semana, { travel_score: 95 })
    const promovida = await criarTrend(semana, { travel_score: 10 })
    await sql`update content_trends set travel_score_ajustado = 20 where id = ${rebaixada}`
    await sql`update content_trends set travel_score_ajustado = 90 where id = ${promovida}`

    await enfileirar(robo, semana)
    const [linha] = await toquesDe(adminZap, semana)
    expect(linha.payload.novas).toBe(2)
    expect(linha.payload.destaque).toBe(1)
  })

  it('variação pendurada em mãe NOVA e trend de outra semana ficam fora da conta', async () => {
    const semana = rodada()
    const outra = rodada()
    const mae = await criarTrend(semana, { travel_score: 80 })
    await criarTrend(semana, { travel_score: 80, variacao_de: mae })
    await criarTrend(outra, { travel_score: 80 })

    await enfileirar(robo, semana)
    const [linha] = await toquesDe(adminZap, semana)
    expect(linha.payload.novas).toBe(1)
    expect(linha.payload.destaque).toBe(1)
  })

  it('variação ÓRFÃ conta: mãe fora do deck faz dela um cartão (achado 2 do Sol)', async () => {
    // A conta tem de ser a do DECK (`montarDeck`): raiz OU órfã. Uma rodada só
    // de órfãs — cartões clicáveis, com nota, esperando decisão — não pode
    // devolver zero e deixar a dona sem aviso.
    const semana = rodada()
    const mae = await criarTrend(semana, { travel_score: 80 })
    const orfa = await criarTrend(semana, { travel_score: 80, variacao_de: mae })
    // A mãe sai do deck do jeito legítimo: virou roteiro.
    await sql`update content_trends
                 set status = 'roteirizada', decidida_por = ${adminZap}, decidida_em = now()
               where id = ${mae}`

    await enfileirar(robo, semana)
    const [linha] = await toquesDe(adminZap, semana)
    expect(linha.payload.novas).toBe(2) // a mãe (decidida, mas do lote) + a órfã
    expect(linha.payload.destaque).toBe(2)
    expect(orfa).toBeTruthy()
  })

  it('rodada SÓ de órfãs avisa — antes devolvia zero e ninguém sabia', async () => {
    const semanaDaMae = rodada()
    const semana = rodada()
    const mae = await criarTrend(semanaDaMae, { travel_score: 80 })
    await sql`update content_trends
                 set status = 'roteirizada', decidida_por = ${adminZap}, decidida_em = now()
               where id = ${mae}`
    await criarTrend(semana, { travel_score: 80, variacao_de: mae })

    const { data } = await enfileirar(robo, semana)
    expect(data).toBeGreaterThan(0)
    const [linha] = await toquesDe(adminZap, semana)
    expect(linha.payload.novas).toBe(1)
  })

  it('trend já decidida continua contando: o lote é o que a VARREDURA trouxe', async () => {
    const semana = rodada()
    const t = await criarTrend(semana, { travel_score: 80 })
    await sql`update content_trends
                 set status = 'descartada', discard_reason = 'fora do tema',
                     decidida_por = ${adminZap}, decidida_em = now()
               where id = ${t}`
    await criarTrend(semana, { travel_score: 80 })

    await enfileirar(robo, semana)
    const [linha] = await toquesDe(adminZap, semana)
    expect(linha.payload.novas).toBe(2)
  })

  it('o canal é sempre e-mail, com ou sem número (M3-1, #42: aviso interno à admin sai só por e-mail)', async () => {
    // Era a régua M4-3 (número → WhatsApp). ADR-038, decisão de 27/10/2026:
    // não há template na Meta para o conteúdo variável do digest.
    const semana = rodada()
    await criarTrend(semana, { travel_score: 80 })
    await enfileirar(robo, semana)

    expect((await toquesDe(adminZap, semana))[0].channel).toBe('email')
    expect((await toquesDe(adminMail, semana))[0].channel).toBe('email')
  })

  it('a pendência do portão 2 é a fila de rascunhos no instante da chamada', async () => {
    const semana = rodada()
    await criarTrend(semana, { travel_score: 80 })
    await enfileirar(robo, semana)

    const [{ n }] = (await sql`
      select count(*)::int as n from content_posts where status = 'rascunho'`) as unknown as { n: number }[]
    const [linha] = await toquesDe(adminZap, semana)
    expect(linha.payload.rascunhos).toBe(n)
  })
})

describe('enqueue_content_digest — dedupe por rodada (não por dia)', () => {
  it('corrida repetida na mesma semana não duplica o toque e ATUALIZA os números', async () => {
    const semana = rodada()
    await criarTrend(semana, { travel_score: 80 })
    await enfileirar(robo, semana)
    expect((await toquesDe(adminZap, semana))[0].payload.novas).toBe(1)

    // `--force` no meio da semana: mais trends entram na MESMA rodada.
    await criarTrend(semana, { travel_score: 80 })
    await enfileirar(robo, semana)

    const linhas = await toquesDe(adminZap, semana)
    expect(linhas).toHaveLength(1) // um toque por rodada, não por corrida
    expect(linhas[0].payload.novas).toBe(2) // com o número de agora, não o velho
  })

  it('toque já ENVIADO não é reescrito — a dona leria um número que nunca recebeu', async () => {
    const semana = rodada()
    await criarTrend(semana, { travel_score: 80 })
    await enfileirar(robo, semana)
    await sql`update notification_outbox set sent_at = now()
               where dedupe_key = ${`content-digest:${semana}:${adminZap}`}`

    await criarTrend(semana, { travel_score: 80 })
    const { data } = await enfileirar(robo, semana)

    const linhas = await toquesDe(adminZap, semana)
    expect(linhas).toHaveLength(1)
    expect(linhas[0].payload.novas).toBe(1) // congelado no que foi enviado

    // E o número devolvido conta as linhas que MEXERAM: este admin ficou de
    // fora, então ele não entra no "N toques na fila" que o worker imprime.
    const [{ n: admins }] = (await sql`
      select count(*)::int as n from profiles where role = 'admin'`) as unknown as { n: number }[]
    expect(data).toBeLessThan(admins)
  })

  it('varredura que não trouxe trend nenhuma NÃO enfileira — silêncio honesto', async () => {
    const semana = rodada()
    const { data, error } = await enfileirar(robo, semana)
    expect(error).toBeNull()
    expect(data).toBe(0)
    expect(await toquesDe(adminZap, semana)).toHaveLength(0)
  })
})

describe('enqueue_content_digest — entrada e porta', () => {
  it('rodada fora do formato AAAA-Wss levanta, sem escrever nada', async () => {
    const { error } = await enfileirar(robo, 'semana-que-vem')
    expect(error?.message).toMatch(/rodada|semana|formato/i)
  })

  it('limiar fora de 0–100 levanta', async () => {
    const { error } = await enfileirar(robo, rodada(), 140)
    expect(error?.message).toMatch(/limiar/i)
  })

  it('a porta é só do robô — e a defesa não é só o GRANT', async () => {
    // A LIÇÃO DA 109: em produção o `postgres` tem default privilege de FUNÇÃO
    // dando EXECUTE a anon, e `revoke ... from public` não tira grant de papel
    // NOMEADO. Testar ACL de função no banco local é FALSO-VERDE. Então aqui se
    // concede a execução ao anônimo DE PROPÓSITO e se prova o que vale nos dois
    // ambientes: a função recusa quem não é o robô, e nada entra na fila.
    const semana = rodada()
    await criarTrend(semana, { travel_score: 80 })
    await sql`grant execute on function public.enqueue_content_digest(text, int) to anon`
    try {
      const { error } = await enfileirar(anonClient(), semana)
      expect(error?.message).toMatch(/robô|robo|service_role|permission denied/i)
      expect(await toquesDe(adminZap, semana)).toHaveLength(0)
    } finally {
      await sql`revoke execute on function public.enqueue_content_digest(text, int) from anon`
    }
  })

  it('o grant nominal está na migration: anon e authenticated não executam', async () => {
    const [acl] = (await sql`
      select has_function_privilege('anon', 'public.enqueue_content_digest(text, int)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.enqueue_content_digest(text, int)', 'execute') as auth,
             has_function_privilege('service_role', 'public.enqueue_content_digest(text, int)', 'execute') as robo
    `) as unknown as { anon: boolean; auth: boolean; robo: boolean }[]
    expect(acl.anon).toBe(false)
    expect(acl.auth).toBe(false)
    expect(acl.robo).toBe(true)
  })

  it('o gatilho também perdeu o EXECUTE de anon/authenticated (achado 16 do Sol)', async () => {
    // `create or replace` preserva a ACL antiga, e em produção toda função nasce
    // com EXECUTE para anon. Gatilho não é chamável como RPC — mas definer que
    // escreve na fila de avisos não fica com a porta encostada.
    const [acl] = (await sql`
      select has_function_privilege('anon', 'public.notify_content_review()', 'execute') as anon,
             has_function_privilege('authenticated', 'public.notify_content_review()', 'execute') as auth
    `) as unknown as { anon: boolean; auth: boolean }[]
    expect(acl.anon).toBe(false)
    expect(acl.auth).toBe(false)
  })

  it('a fila de rascunhos do payload vem de content_posts em rascunho (pino no TEXTO)', async () => {
    const [{ def }] = (await sql`
      select pg_get_functiondef('public.enqueue_content_digest(text, int)'::regprocedure) as def
    `) as unknown as { def: string }[]
    expect(def).toMatch(/status\s*=\s*'rascunho'/)
    expect(def).toMatch(/variacao_de is null/)
    expect(def).toMatch(/coalesce\(t\.travel_score_ajustado, t\.travel_score\)/)
    // A regra do cartão (raiz OU órfã) mora no SQL, não só neste teste.
    expect(def).toMatch(/mae\.status = 'nova'/)
  })
})

describe('notify_content_review — a etapa `ideias` morreu com o Portão 1', () => {
  it('ideia avulsa (sem trend) não avisa mais ninguém', async () => {
    const ref = `avulso:${crypto.randomUUID()}`
    await sql`insert into content_posts (kind, tema, external_ref)
              values ('roteiro_reel', 'Roteiro avulso do teste', ${ref})`
    const [{ n }] = (await sql`
      select count(*)::int as n
        from notification_outbox
       where template = 'content-review'
         and payload ->> 'stage' = 'ideias'
         and recipient_profile_id in (${adminZap}, ${adminMail})`) as unknown as { n: number }[]
    expect(n).toBe(0)
  })

  it('a etapa `rascunhos` continua de pé (o portão 2 não mudou)', async () => {
    const [def] = (await sql`
      select pg_get_functiondef('public.notify_content_review()'::regprocedure) as def
    `) as unknown as { def: string }[]
    // Asserção sobre o que a função FAZ, não sobre a palavra: o comentário
    // dentro do corpo cita a etapa morta, e é bom que cite.
    expect(def.def).toMatch(/'stage',\s*'rascunhos'/)
    expect(def.def).not.toMatch(/'stage',\s*'ideias'/)
    expect(def.def).not.toMatch(/new\.status\s*=\s*'ideia'/)
  })
})

describe('o template content-digest', () => {
  it('está no registro do despachante e respeita o silêncio (quiet)', () => {
    expect(TEMPLATES['content-digest']).toBeDefined()
    expect(TEMPLATES['content-digest'].quiet).toBe(true)
  })

  it('está no catálogo de mensagens — senão a dona vê uma lista que mente', () => {
    expect(CHAVES_DO_CATALOGO).toContain('content-digest')
  })

  it('o texto diz os números do LOTE e leva para o radar', () => {
    const fatos = { semana: '2026-W32', novas: 6, destaque: 2, rascunhos: 3, firstName: 'Helena' }
    const texto = contentDigestText({ ...fatos, appUrl: 'https://x' })
    expect(texto).toContain('6')
    expect(texto).toContain('2')
    expect(texto).toContain('https://x/admin/conteudo')

    const email = contentDigestEmail({ ...fatos, appUrl: 'https://x' })
    expect(email.subject).toMatch(/trend/i)
    expect(email.html).toContain('https://x/admin/conteudo')
  })

  it('sem rascunho parado, a frase do portão 2 não aparece (nada de "0 rascunhos")', () => {
    const texto = contentDigestText({
      semana: '2026-W32',
      novas: 6,
      destaque: 2,
      rascunhos: 0,
      firstName: 'Helena',
      appUrl: 'https://x',
    })
    expect(texto).not.toMatch(/0 rascunho/)
  })
})
