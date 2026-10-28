// RADAR DE TRENDS (Estúdio v2 — Leva 2.2, ADR-032/033/034/037).
//
// A captura vira CURADORIA: cada linha ATIVA de `analise_reel` da rodada
// corrente vira uma linha em `content_trends` — a camada de medição
// (`content_research`) segue INTACTA; a trend só aponta para ela (FK-retrato).
//
// O que cada trend nova recebe aqui:
//   · `velocidade` — views/dia no momento da MEDIÇÃO ÷ mediana da conta
//     cadastrada; sem conta/mediana, views/dia puro + `velocidade_sem_conta`
//     (ADR-032 decisão 2). Piso de 1 dia por desenho — a MESMA conta do script
//     da 2.3, para os dois números nunca divergirem.
//   · `travel_score` — a nota do Haiku (ADR-033), fail-open: falha = NULL, e a
//     PRÓPRIA corrida seguinte cura (o guard deixa o robô atualizar
//     travel_score/travel_meta enquanto a trend é NOVA).
//   · dedup temática (ADR-034, era das trends): vizinho mais próximo por
//     cosseno contra a memória `content_embeddings` escopo `trend`; colisão →
//     nasce com `variacao_de` = RAIZ do tema; raiz DESCARTADA → nasce
//     `descartada` HERDANDO motivo prefixado e ator (fim da supressão
//     silenciosa — dívida 1 da 0.4); toda variação tem vetor próprio
//     (dívida 2). FAIL-OPEN TOTAL: memória indisponível nunca segura a captura.
//
// IDEMPOTÊNCIA: `source_key` é UNIQUE em `content_trends` e a pré-checagem
// pula fonte que já virou trend ANTES de pagar Gemini/Haiku — re-corrida na
// semana = 0 duplicata, custo ~zero (aceite da Leva 2.2).
//
// Módulo do WORKER (Node puro): imports relativos com `.ts`, sem alias `@/`.

import type { SupabaseClient } from '@supabase/supabase-js'
import { DateTime } from 'luxon'

import type { Rede } from './config.ts'
import { numero, semanaIso } from './tipos.ts'
import {
  LIMIAR_DEDUP,
  cosseno,
  embedarTexto,
  gravarEmbedding,
  lerVetores,
} from './dedup.ts'
import {
  PROMPT_TRAVEL,
  avaliarNotaDeViagem,
  entradaDaNota,
} from './travel.ts'
import { getActivePrompt, type ActivePrompt } from '../ai/claude.ts'

/* ========================================================================== */
/* Puro — provado em research-logica.test.ts                                   */
/* ========================================================================== */

/** Trecho de transcrição que entra no TEXTO embedado (título + trecho — o
 *  "resumo da transcrição" do ADR-034). O mesmo recorte da nota de viagem. */
const EMBED_TRANSCRICAO = 1_500

export function textoDaTrend(t: { titulo: string; transcricao?: string | null }): string {
  const trecho = (t.transcricao ?? '').trim()
  return [t.titulo, trecho.slice(0, EMBED_TRANSCRICAO)].join('\n').trim()
}

export interface VelocidadeCalculada {
  /** views/dia (÷ mediana quando há conta); NULL quando não há como calcular. */
  velocidade: number | null
  /** true quando a velocidade saiu SEM mediana de conta (views/dia puro). */
  semConta: boolean
}

/**
 * A velocidade da trend (ADR-032 decisão 2), com as regras de honestidade:
 *   · sem views ou sem data de publicação → NULL (não há número para inventar);
 *   · publicação DEPOIS da medição = dado inválido → NULL (o script da 2.3
 *     aborta nesse caso; aqui, fail-open com aviso do chamador);
 *   · piso de 1 dia por desenho (item de 6h não extrapola ×4);
 *   · mediana ausente ou ≤ 0 → views/dia puro + flag `semConta`.
 */
export function velocidadeDoItem(p: {
  views: number | null
  publicadoEm: string | null
  medidoEm: string
  medianaDaConta: number | null
}): VelocidadeCalculada {
  if (p.views == null || !p.publicadoEm) return { velocidade: null, semConta: false }
  const pub = Date.parse(p.publicadoEm)
  const medido = Date.parse(p.medidoEm)
  if (!Number.isFinite(pub) || !Number.isFinite(medido) || pub > medido) {
    return { velocidade: null, semConta: false }
  }
  const dias = Math.max(1, (medido - pub) / 86_400_000)
  const viewsDia = p.views / dias
  if (p.medianaDaConta != null && p.medianaDaConta > 0) {
    return { velocidade: Number((viewsDia / p.medianaDaConta).toFixed(4)), semConta: false }
  }
  return { velocidade: Number(viewsDia.toFixed(4)), semConta: true }
}

/* ========================================================================== */
/* Leitura do insumo — as análises ativas da rodada                            */
/* ========================================================================== */

export interface AnaliseParaRadar {
  researchId: string
  sourceKey: string
  plataforma: Rede
  titulo: string
  url: string | null
  autor: string | null
  views: number | null
  publicadoEm: string | null
  coletadoEm: string
  creatorId: string | null
  transcricao: string | null
}

interface LinhaDeResearch {
  id: string
  source_key: string
  plataforma: Rede
  titulo: string | null
  url: string | null
  publicado_em: string | null
  coletado_em: string
  creator_id: string | null
  payload: { transcricao?: { texto?: string }; autor?: string } | null
  metricas: Record<string, unknown> | null
}

function paraRadar(l: LinhaDeResearch): AnaliseParaRadar {
  const views = l.metricas && 'views' in l.metricas ? numero(l.metricas.views) : null
  return {
    researchId: l.id,
    sourceKey: l.source_key,
    plataforma: l.plataforma,
    titulo: l.titulo ?? l.source_key,
    url: l.url,
    autor: l.payload?.autor ?? null,
    views,
    publicadoEm: l.publicado_em,
    coletadoEm: l.coletado_em,
    creatorId: l.creator_id,
    transcricao: l.payload?.transcricao?.texto ?? null,
  }
}

/** As análises ATIVAS cuja captura aconteceu na rodada (semana ISO de
 *  `coletado_em`). Análises de semanas passadas NÃO viram trend (ADR-037
 *  decisão 1 — o acervo parqueado na 0.2 não ressuscita pelo radar). */
export async function lerAnalisesDaRodada(
  db: SupabaseClient,
  semana: string,
): Promise<{ analises: AnaliseParaRadar[]; avisos: string[] }> {
  const avisos: string[] = []
  const { data, error } = await db
    .from('content_research')
    .select('id, source_key, plataforma, titulo, url, publicado_em, coletado_em, creator_id, payload, metricas')
    .eq('tipo', 'analise_reel')
    .is('superseded_by', null)
    .order('coletado_em', { ascending: false })
    .limit(1000)
  if (error) throw new Error(`radar: falha ao ler as análises ativas: ${error.message}`)
  const linhas = (data ?? []) as LinhaDeResearch[]
  if (linhas.length >= 1000) {
    avisos.push('janela de análises cheia (≥1000 linhas) — a rodada pode estar incompleta')
  }
  const daRodada = linhas.filter((l) => {
    const quando = DateTime.fromISO(l.coletado_em, { zone: 'utc' })
    return quando.isValid && semanaIso(quando) === semana
  })
  return { analises: daRodada.map(paraRadar), avisos }
}

/** A mediana de views das contas cadastradas (`metricas['views medianas']` — a
 *  chave é a frase da ficha, com espaço; decisão do M4). */
export async function medianasDosCriadores(
  db: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, number>> {
  const mapa = new Map<string, number>()
  if (!ids.length) return mapa
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db
      .from('content_creators')
      .select('id, metricas')
      .in('id', ids.slice(i, i + 100))
    if (error) throw new Error(`radar: falha ao ler as medianas: ${error.message}`)
    for (const linha of (data ?? []) as Array<{ id: string; metricas: Record<string, unknown> }>) {
      const m = numero(linha.metricas?.['views medianas'])
      if (m > 0) mapa.set(linha.id, m)
    }
  }
  return mapa
}

/* ========================================================================== */
/* A etapa do worker                                                           */
/* ========================================================================== */

export interface RelatorioDoRadar {
  /** source_keys das trends criadas nesta corrida (inclui variações). */
  criadas: string[]
  variacoes: Array<{ sourceKey: string; maeSourceKey: string; similaridade: number }>
  /** Variações de tema DESCARTADO — nasceram descartadas herdando (nada some). */
  herdadas: Array<{ sourceKey: string; maeSourceKey: string; similaridade: number }>
  /** Fontes puladas por já terem trend (idempotência — custo ~zero). */
  puladas: number
  /** Trends que ficaram SEM nota nesta corrida (fail-open do ADR-033). */
  semNota: number
  /** Notas NULL de corridas anteriores preenchidas agora (a cura). */
  curadas: number
  falhas: string[]
  avisos: string[]
  custoUsd: number
}

interface MaeConhecida {
  id: string
  sourceKey: string
  status: string
  variacaoDe: string | null
  discardReason: string | null
  decididaPor: string | null
}

interface TrendInsert {
  research_id: string
  source_key: string
  plataforma: Rede
  url: string | null
  autor: string | null
  views: number | null
  velocidade: number | null
  velocidade_sem_conta: boolean
  semana: string
  travel_score: number | null
  travel_meta: Record<string, unknown>
  status?: string
  discard_reason?: string
  decidida_por?: string
  decidida_em?: string
  variacao_de?: string
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * A etapa inteira: análises da rodada → trends, com velocidade, nota e dedup.
 * Escreve como service_role (INSERT da captura + UPDATE da nota que se cura).
 */
export async function etapaRadar(
  db: SupabaseClient,
  opts: {
    semana?: string
    log?: (linha: string) => void
    deps?: {
      embed?: (texto: string) => Promise<number[]>
      limiar?: number
      agora?: () => string
    }
  } = {},
): Promise<RelatorioDoRadar> {
  const semana = opts.semana ?? semanaIso()
  const log = opts.log ?? (() => {})
  const embed = opts.deps?.embed ?? embedarTexto
  const limiar = opts.deps?.limiar ?? LIMIAR_DEDUP
  const agora = opts.deps?.agora ?? (() => new Date().toISOString())

  const r: RelatorioDoRadar = {
    criadas: [],
    variacoes: [],
    herdadas: [],
    puladas: 0,
    semNota: 0,
    curadas: 0,
    falhas: [],
    avisos: [],
    custoUsd: 0,
  }

  // ── O prompt da nota (uma leitura por corrida; sem ele, TUDO fica sem nota
  // e a corrida seguinte cura — fail-open do ADR-033) ────────────────────────
  let prompt: ActivePrompt | null = null
  try {
    prompt = await getActivePrompt(db, PROMPT_TRAVEL)
  } catch (e) {
    r.avisos.push(`nota de viagem indisponível nesta corrida (${msg(e)}) — scores ficam NULL`)
  }

  // ── Insumo da rodada ───────────────────────────────────────────────────────
  const { analises, avisos } = await lerAnalisesDaRodada(db, semana)
  r.avisos.push(...avisos)

  // ── Pré-checagem de idempotência: fonte que já virou trend é pulada ANTES
  // de pagar qualquer modelo ─────────────────────────────────────────────────
  const existentes = await lerTrendsConhecidas(db, r.avisos)
  const jaExistem = new Set([...existentes.values()].map((m) => m.sourceKey))
  const novas = analises.filter((a) => !jaExistem.has(a.sourceKey))
  r.puladas = analises.length - novas.length
  log(`${analises.length} análises na rodada ${semana} · ${r.puladas} já são trends · ${novas.length} novas`)

  // ── Medianas das contas (denominador da velocidade) ────────────────────────
  const idsDeCriador = [...new Set(novas.map((a) => a.creatorId).filter((v): v is string => !!v))]
  let medianas = new Map<string, number>()
  try {
    medianas = await medianasDosCriadores(db, idsDeCriador)
  } catch (e) {
    r.avisos.push(`medianas indisponíveis (${msg(e)}) — velocidades saem sem conta`)
  }

  // ── Memória da dedup (fail-open TOTAL: sem memória, tudo nasce sem dedup) ──
  let pool: Array<{ refId: string; vetor: number[] }> = []
  let dedupViva = true
  try {
    const memoria = await lerVetores(db, 'trend')
    pool = memoria.vetores
    if (memoria.malformados > 0) {
      r.avisos.push(`${memoria.malformados} vetores malformados IGNORADOS na memória`)
    }
    if (memoria.janelaCheia) {
      r.avisos.push('janela de vetores cheia (≥1000 linhas) — a memória lida pode estar incompleta')
    }
    await backfillDeVetores(db, existentes, pool, embed, r)
  } catch (e) {
    dedupViva = false
    r.falhas.push(`memória da dedup indisponível (${msg(e)}) — corrida segue sem dedup`)
  }

  // ── Uma a uma: dedup → nota → INSERT → vetor ───────────────────────────────
  for (const a of novas) {
    const linha: TrendInsert = {
      research_id: a.researchId,
      source_key: a.sourceKey,
      plataforma: a.plataforma,
      url: a.url,
      autor: a.autor,
      views: a.views,
      velocidade: null,
      velocidade_sem_conta: false,
      semana,
      travel_score: null,
      travel_meta: {},
    }
    const v = velocidadeDoItem({
      views: a.views,
      publicadoEm: a.publicadoEm,
      medidoEm: a.coletadoEm,
      medianaDaConta: a.creatorId ? (medianas.get(a.creatorId) ?? null) : null,
    })
    linha.velocidade = v.velocidade
    linha.velocidade_sem_conta = v.semConta
    if (a.views != null && a.publicadoEm && linha.velocidade == null) {
      r.avisos.push(`${a.sourceKey}: datas inválidas (publicado depois de medido?) — velocidade NULL`)
    }

    // Dedup: vizinho mais próximo → raiz do tema.
    let vetor: number[] | null = null
    let raiz: MaeConhecida | null = null
    let similaridade = 0
    if (dedupViva) {
      try {
        vetor = await embed(textoDaTrend({ titulo: a.titulo, transcricao: a.transcricao }))
        let melhor: { refId: string; sim: number } | null = null
        for (const p of pool) {
          const sim = cosseno(vetor, p.vetor)
          if (!melhor || sim > melhor.sim) melhor = { refId: p.refId, sim }
        }
        if (melhor && melhor.sim >= limiar) {
          similaridade = Number(melhor.sim.toFixed(3))
          const vizinha = existentes.get(melhor.refId)
          if (!vizinha) {
            r.avisos.push(`${a.sourceKey}: vizinho ${melhor.refId} sem trend legível (sim ${similaridade}) — criada sem dedup`)
          } else {
            raiz = vizinha.variacaoDe ? (existentes.get(vizinha.variacaoDe) ?? null) : vizinha
            if (!raiz) {
              r.avisos.push(`${a.sourceKey}: raiz de ${vizinha.sourceKey} fora da janela — criada sem dedup`)
            }
          }
        }
      } catch (e) {
        vetor = null
        r.falhas.push(`${a.sourceKey}: embedding falhou (${msg(e)}) — criada sem dedup`)
      }
    }

    const herdaDescarte = raiz?.status === 'descartada'
    if (raiz) {
      linha.variacao_de = raiz.id
      if (herdaDescarte) {
        // A herança EXATA que o guard exige (ADR-037 decisão 4): motivo
        // prefixado da raiz e o MESMO ator — nada some em silêncio.
        linha.status = 'descartada'
        linha.discard_reason = `tema descartado na mãe: ${raiz.discardReason}`
        linha.decidida_por = raiz.decididaPor ?? undefined
        linha.decidida_em = agora()
      }
    }

    // Nota de viagem só para quem vai ser TRIADO (tema morto não paga Haiku).
    if (prompt && !herdaDescarte) {
      try {
        const { nota, custoUsd } = await avaliarNotaDeViagem(
          prompt,
          entradaDaNota({ titulo: a.titulo, transcricao: a.transcricao }),
        )
        linha.travel_score = nota.nota
        linha.travel_meta = {
          justificativa: nota.justificativa,
          prompt_versao: prompt.version,
          modelo: prompt.model,
          avaliado_em: agora(),
        }
        r.custoUsd += custoUsd
      } catch (e) {
        r.semNota += 1
        r.falhas.push(`${a.sourceKey}: nota de viagem falhou (${msg(e)}) — score NULL, a próxima corrida cura`)
      }
    } else if (!herdaDescarte) {
      r.semNota += 1
    }

    const { data, error } = await db.from('content_trends').insert(linha).select('id').single()
    if (error) {
      r.falhas.push(`${a.sourceKey}: INSERT recusado (${error.message})`)
      continue
    }
    const id = data!.id as string
    r.criadas.push(a.sourceKey)
    if (raiz && herdaDescarte) {
      r.herdadas.push({ sourceKey: a.sourceKey, maeSourceKey: raiz.sourceKey, similaridade })
    } else if (raiz) {
      r.variacoes.push({ sourceKey: a.sourceKey, maeSourceKey: raiz.sourceKey, similaridade })
    }

    // A trend nova entra na memória E no mapa de mães — colisão DENTRO do lote
    // resolve sozinha (a mãe acabou de ganhar id real).
    existentes.set(id, {
      id,
      sourceKey: a.sourceKey,
      status: linha.status ?? 'nova',
      variacaoDe: linha.variacao_de ?? null,
      discardReason: linha.discard_reason ?? null,
      decididaPor: linha.decidida_por ?? null,
    })
    if (vetor) {
      pool.push({ refId: id, vetor })
      try {
        await gravarEmbedding(db, 'trend', id, vetor)
      } catch (e) {
        r.falhas.push(`${a.sourceKey}: vetor não gravado (${msg(e)}) — backfill na próxima corrida`)
      }
    }
  }

  // ── A cura: notas NULL de trends NOVAS (desta ou de corridas passadas) ─────
  if (prompt) {
    await curarNotas(db, prompt, agora, r)
  }

  return r
}

/** Todas as trends conhecidas (id → metadados de mãe). A janela de 1000 do
 *  PostgREST vira aviso — nunca corte silencioso. */
async function lerTrendsConhecidas(
  db: SupabaseClient,
  avisos: string[],
): Promise<Map<string, MaeConhecida>> {
  const { data, error } = await db
    .from('content_trends')
    .select('id, source_key, status, variacao_de, discard_reason, decidida_por')
    .limit(5000)
  if (error) throw new Error(`radar: falha ao ler as trends: ${error.message}`)
  const linhas = (data ?? []) as Array<{
    id: string
    source_key: string
    status: string
    variacao_de: string | null
    discard_reason: string | null
    decidida_por: string | null
  }>
  if (linhas.length >= 1000) {
    avisos.push('janela de trends cheia (≥1000 linhas) — pré-checagem pode estar incompleta')
  }
  const mapa = new Map<string, MaeConhecida>()
  for (const l of linhas) {
    mapa.set(l.id, {
      id: l.id,
      sourceKey: l.source_key,
      status: l.status,
      variacaoDe: l.variacao_de,
      discardReason: l.discard_reason,
      decididaPor: l.decidida_por,
    })
  }
  return mapa
}

/** Backfill preguiçoso: trend sem vetor ganha o dela AQUI (uma vez cada) — é o
 *  que dá memória às 5 migradas da 2.3 sem o script pagar Gemini. */
async function backfillDeVetores(
  db: SupabaseClient,
  trends: Map<string, MaeConhecida>,
  pool: Array<{ refId: string; vetor: number[] }>,
  embed: (texto: string) => Promise<number[]>,
  r: RelatorioDoRadar,
): Promise<void> {
  const comVetor = new Set(pool.map((p) => p.refId))
  const semVetor = [...trends.values()].filter((t) => !comVetor.has(t.id))
  if (!semVetor.length) return
  if (semVetor.length > 100) {
    // Teto por corrida, nunca silencioso (régua da casa): o resto entra nas
    // corridas seguintes — backfill é preguiçoso por desenho.
    r.avisos.push(`backfill: ${semVetor.length - 100} trends sem vetor ficam para a próxima corrida (teto 100)`)
  }

  // O texto vem da linha de research da trend (titulo + transcrição).
  const porId = new Map(semVetor.map((t) => [t.id, t]))
  const { data, error } = await db
    .from('content_trends')
    .select('id, research_id')
    .in('id', [...porId.keys()].slice(0, 100))
  if (error) {
    r.falhas.push(`backfill: falha ao ler research_ids (${error.message})`)
    return
  }
  const refs = (data ?? []) as Array<{ id: string; research_id: string }>
  const researchIds = refs.map((x) => x.research_id)
  const textos = new Map<string, { titulo: string; transcricao: string | null }>()
  for (let i = 0; i < researchIds.length; i += 100) {
    const lote = await db
      .from('content_research')
      .select('id, titulo, source_key, payload')
      .in('id', researchIds.slice(i, i + 100))
    if (lote.error) {
      r.falhas.push(`backfill: falha ao ler research (${lote.error.message})`)
      return
    }
    for (const l of (lote.data ?? []) as Array<{
      id: string
      titulo: string | null
      source_key: string
      payload: { transcricao?: { texto?: string } } | null
    }>) {
      textos.set(l.id, {
        titulo: l.titulo ?? l.source_key,
        transcricao: l.payload?.transcricao?.texto ?? null,
      })
    }
  }
  for (const ref of refs) {
    const texto = textos.get(ref.research_id)
    if (!texto) continue
    try {
      const vetor = await embed(textoDaTrend(texto))
      await gravarEmbedding(db, 'trend', ref.id, vetor)
      pool.push({ refId: ref.id, vetor })
    } catch (e) {
      const t = porId.get(ref.id)
      r.falhas.push(`backfill ${t?.sourceKey ?? ref.id}: ${msg(e)}`)
    }
  }
}

/** Preenche travel_score NULL de trends NOVAS (o fail-open que se cura). */
async function curarNotas(
  db: SupabaseClient,
  prompt: ActivePrompt,
  agora: () => string,
  r: RelatorioDoRadar,
): Promise<void> {
  const { data, error } = await db
    .from('content_trends')
    .select('id, source_key, research_id')
    .eq('status', 'nova')
    .is('travel_score', null)
    .limit(200)
  if (error) {
    r.falhas.push(`cura de notas: leitura falhou (${error.message})`)
    return
  }
  const pendentes = (data ?? []) as Array<{ id: string; source_key: string; research_id: string }>
  if (!pendentes.length) return

  for (const t of pendentes) {
    const research = await db
      .from('content_research')
      .select('titulo, source_key, payload')
      .eq('id', t.research_id)
      .maybeSingle()
    if (research.error || !research.data) {
      r.falhas.push(`cura ${t.source_key}: research ilegível`)
      continue
    }
    const payload = research.data.payload as { transcricao?: { texto?: string } } | null
    try {
      const { nota, custoUsd } = await avaliarNotaDeViagem(
        prompt,
        entradaDaNota({
          titulo: research.data.titulo ?? research.data.source_key,
          transcricao: payload?.transcricao?.texto ?? null,
        }),
      )
      const upd = await db
        .from('content_trends')
        .update({
          travel_score: nota.nota,
          travel_meta: {
            justificativa: nota.justificativa,
            prompt_versao: prompt.version,
            modelo: prompt.model,
            avaliado_em: agora(),
          },
        })
        .eq('id', t.id)
      if (upd.error) {
        r.falhas.push(`cura ${t.source_key}: update recusado (${upd.error.message})`)
        continue
      }
      r.custoUsd += custoUsd
      r.curadas += 1
    } catch (e) {
      r.falhas.push(`cura ${t.source_key}: ${msg(e)}`)
    }
  }
}
