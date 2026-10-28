import 'server-only'

// CAMADA DE DADOS DO RADAR (Estúdio v2 · Leva 3) — as duas leituras da
// triagem: o DECK (leve, para contador/navegação/variações) e o CARTÃO corrente
// (pesado, com o payload do research de onde sai a dissecação).
//
// Mesma convenção de `pauta.ts`:
// · UMA função por leitura de tela; a página não faz query inline;
// · o que vem do banco passa por Zod — linha com forma inesperada estoura AQUI;
// · FALHA NUNCA VIRA LISTA VAZIA (`exigir`): senão a tela afirmaria "radar
//   vazio" quando o que houve foi o banco recusar a leitura;
// · `server-only`; número e frase formatados AQUI, no servidor.
//
// ── DUAS LEITURAS DE PROPÓSITO ──────────────────────────────────────────────
// O deck busca as trends NOVAS sem payload nenhum; só o cartão corrente carrega
// `content_research.payload` (kilobytes de transcrição por linha). Carregar o
// payload de 12 trends por visita seria peso por nada — o mesmo racional do
// painel de métricas do Estúdio.
//
// ── A DISSECAÇÃO É DO RETRATO, DE PROPÓSITO ─────────────────────────────────
// A trend aponta `research_id` congelado (FK-retrato, guard da 107): o cartão
// mostra a dissecação DA CAPTURA, mesmo que um `--force` posterior tenha
// superado aquela linha de research. Coerente com "proveniência congelada" —
// não "consertar" seguindo `superseded_by`.
//
// ── O SCHEMA DA DISSECAÇÃO MUDOU DE CASA (Leva 5) ───────────────────────────
// Ele nasceu aqui e foi promovido a `src/lib/content/dissecacao.ts`, módulo
// PURO: o gerador passou a precisar do mesmo shape para montar a entrada do
// roteiro, e duas cópias do mesmo schema divergiriam no dia da primeira
// mudança. O racional continua valendo — nada de `AnaliseSchema` do worker
// (arrasta o cliente Gemini), e o `safeParse` é TOLERANTE de propósito: trend
// sem dissecação existe, e payload ilegível vira o estado honesto "sem
// dissecação", nunca uma tela quebrada.

import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { type Dissecacao, lerDissecacao } from '@/lib/content/dissecacao'
import { TETO_DIARIO_DE_ROTEIROS } from '@/lib/content/generate'
import { TIERS, TIPOS } from './pauta-gramatica'
import {
  CRIADOR_FORA_DA_PAUTA,
  PLATAFORMAS_DO_RADAR,
  PLATAFORMA_DO_RADAR_ROTULO,
  RODADA_FORMATO,
  STATUS_DA_TREND,
  ehVariacaoOrfa,
  enderecoDoCartao,
  fraseDaVelocidade,
  fraseDeOndeVeio,
  fraseDeViews,
  idDoYoutube,
  montarDeck,
  notaDaTrend,
  ordenarDeck,
  ordenarDeckPT,
  ordenarGrupoComVariacoes,
  passaNaAbaPT,
  semanaDaRodada,
  type FiltrosDoRadar,
  type PlataformaDoRadar,
  type StatusDaTrend,
  type VistaDeTriagem,
} from './radar-gramatica'

function exigir<T>(leitura: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Radar: falha ao ler ${leitura}: ${r.error.message}`)
  return r.data
}

/* ========================================================================== */
/* Shapes                                                                      */
/* ========================================================================== */

const CriadorSchema = z.object({
  nome: z.string(),
  handle: z.string(),
  tipo: z.enum(TIPOS),
  tier: z.enum(TIERS).nullable(),
})

const TrendNovaSchema = z.object({
  id: z.string(),
  plataforma: z.enum(PLATAFORMAS_DO_RADAR),
  url: z.string().nullable(),
  autor: z.string().nullable(),
  views: z.number().nullable(),
  velocidade: z.number().nullable(),
  velocidade_sem_conta: z.boolean(),
  capturada_em: z.string(),
  semana: z.string().regex(RODADA_FORMATO),
  variacao_de: z.string().nullable(),
  travel_score: z.number().nullable(),
  travel_score_ajustado: z.number().nullable(),
  // A FK é NOT NULL, mas o embed devolve objeto — nullable aqui para o zod
  // estourar com frase nossa em vez de `undefined` na tela.
  research: z
    .object({ id: z.string(), creator: CriadorSchema.nullable() })
    .nullable(),
})
type TrendNova = z.infer<typeof TrendNovaSchema>

/** A variação pendurada no cartão da mãe (o que a decisão dela arrasta). */
export interface VariacaoDoCartao {
  id: string
  plataforma: PlataformaDoRadar
  /** quem publicou, já resolvido (criador cadastrado ou autor da captura) */
  origemFrase: string
  rodada: string
}

/** Uma decisão do deck (raiz ou variação órfã) — o que a navegação precisa. */
export interface CartaoDoDeck {
  id: string
  /** filha de mãe já decidida (só roteirizada é possível — invariante do banco) */
  variacaoOrfa: boolean
  variacoes: VariacaoDoCartao[]
}

export interface DeckDoRadar {
  cartoes: CartaoDoDeck[]
  total: number
  /**
   * Decisões (raízes) cujo `notaDaTrend` é NULL — a aba PT as deixa fora e a
   * página avisa (ADR-033 decisão 5). É `notaDaTrend`, não `travel_score`: raiz
   * sem nota do robô mas COM ajuste da Teacher Vicky entra na aba e sai desta contagem.
   */
  semNota: number
}

/** O cartão corrente, com tudo que a triagem mostra. */
export interface CartaoDoRadar {
  id: string
  plataforma: PlataformaDoRadar
  url: string | null
  youtubeId: string | null
  deOndeVeio: string
  dissecacao: DissecacaoUi | null
  /** a nota que VALE (`notaDaTrend`) — o chip e o corte da aba PT leem esta */
  nota: number | null
  notaAjustada: boolean
  /** a nota crua do robô — contexto do painel de ajuste, nunca o corte */
  notaDoRobo: number | null
}

/** O nome que a tela usa para o shape da dissecação (a fonte é `@/lib/content`). */
export type DissecacaoUi = Dissecacao

/* ========================================================================== */
/* Leituras                                                                    */
/* ========================================================================== */

const CAMPOS_DO_DECK =
  'id, plataforma, url, autor, views, velocidade, velocidade_sem_conta, capturada_em, semana, variacao_de, ' +
  'travel_score, travel_score_ajustado, ' +
  'research:content_research (id, creator:content_creators (nome, handle, tipo, tier))'

function origemCurta(t: TrendNova): string {
  const criador = t.research?.creator
  if (criador) return `${criador.nome} (@${criador.handle})`
  return t.autor ?? 'autor não identificado'
}

/**
 * O deck da triagem: TODAS as trends `nova`, ordenadas (`ordenarDeck`) e
 * montadas em raízes × variações penduradas (`montarDeck`). O contador conta
 * CARTÕES — decisões a tomar —, não linhas.
 *
 * A vista `pt` é o MESMO deck com o recorte da aba Personal Travel (filtro,
 * não bucket): uma query só — a precedência `ajustado ?? score` mora na
 * gramática pura, e o conjunto completo é necessário de qualquer jeito para
 * contar os sem-nota. O recorte é POR RAIZ: variação pendurada segue a mãe
 * (a unidade da aba é a DECISÃO, e a cascata do banco é da mãe); órfã é raiz
 * e filtra pela própria nota.
 */
export async function getDeckDoRadar(vista: VistaDeTriagem = 'triagem'): Promise<DeckDoRadar> {
  const supabase = await createClient()
  const linhas = exigir(
    'o deck do radar',
    await supabase.from('content_trends').select(CAMPOS_DO_DECK).eq('status', 'nova'),
  )
  const novas = z.array(TrendNovaSchema).parse(linhas ?? [])
  // PostgREST corta em 1000 linhas em silêncio; um radar semanal produz
  // unidades. Se um dia chegar perto do corte, o contador mentiria — estourar
  // é o honesto.
  if (novas.length >= 1000) {
    throw new Error('Radar: o deck bateu na janela de 1000 linhas — filtre por rodada antes de crescer')
  }

  const { raizes, variacoesPor } = montarDeck(novas)
  const semNota = raizes.filter((r) => notaDaTrend(r) == null).length
  const daVista = vista === 'pt' ? raizes.filter((r) => passaNaAbaPT(r)) : raizes
  daVista.sort(vista === 'pt' ? ordenarDeckPT : ordenarDeck)

  return {
    cartoes: daVista.map((r) => ({
      id: r.id,
      variacaoOrfa: ehVariacaoOrfa(r),
      variacoes: (variacoesPor.get(r.id) ?? []).map((v) => ({
        id: v.id,
        plataforma: v.plataforma,
        origemFrase: origemCurta(v),
        rodada: v.semana,
      })),
    })),
    total: daVista.length,
    semNota,
  }
}

const CartaoSchema = TrendNovaSchema.extend({
  research: z
    .object({
      id: z.string(),
      payload: z.record(z.string(), z.unknown()).nullable(),
      creator: CriadorSchema.nullable(),
    })
    .nullable(),
})

/**
 * O cartão corrente (leitura pesada, um por visita). `null` = inexistente ou
 * já decidida — a página redireciona para a casa (endereço que só pode falhar
 * não vira formulário).
 */
export async function getCartaoDoRadar(id: string): Promise<CartaoDoRadar | null> {
  if (!id) return null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('content_trends')
    .select(
      'id, plataforma, url, autor, views, velocidade, velocidade_sem_conta, capturada_em, semana, variacao_de, ' +
        'travel_score, travel_score_ajustado, ' +
        'research:content_research (id, payload, creator:content_creators (nome, handle, tipo, tier))',
    )
    .eq('id', id)
    .eq('status', 'nova')
    .maybeSingle()
  if (error) throw new Error(`Radar: falha ao ler o cartão: ${error.message}`)
  if (!data) return null

  const t = CartaoSchema.parse(data)
  return {
    id: t.id,
    plataforma: t.plataforma,
    url: t.url,
    youtubeId: t.plataforma === 'youtube' ? idDoYoutube(t.url) : null,
    deOndeVeio: fraseDeOndeVeio({
      criador: t.research?.creator ?? null,
      autor: t.autor,
      plataforma: t.plataforma,
      semana: t.semana,
      rodadaCorrente: semanaDaRodada(),
      viewsFrase: fraseDeViews(t.views),
      velocidadeFrase: fraseDaVelocidade(t.velocidade, t.velocidade_sem_conta),
    }),
    dissecacao: lerDissecacao(t.research?.payload ?? null),
    nota: notaDaTrend(t),
    notaAjustada: t.travel_score_ajustado != null,
    notaDoRobo: t.travel_score,
  }
}

/* ========================================================================== */
/* A trend virando roteiro (Leva 5.2)                                          */
/* ========================================================================== */

const ParaRoteiroSchema = TrendNovaSchema.extend({
  status: z.enum(STATUS_DA_TREND),
  source_key: z.string(),
  tema_cluster: z.string().nullable(),
  research: z
    .object({
      id: z.string(),
      titulo: z.string().nullable(),
      payload: z.record(z.string(), z.unknown()).nullable(),
      creator: CriadorSchema.nullable(),
    })
    .nullable(),
})

/** O que a RPC precisa para o post nascer com assunto e proveniência. */
export interface TrendParaRoteiro {
  /** o assunto do post — NOT NULL e não-branco no banco */
  tema: string
  /** o gancho falado do ORIGINAL (é ele que o roteiro copia) */
  gancho: string | null
  /** o `idea` jsonb: proveniência congelada + a dissecação que vira prompt */
  idea: Record<string, unknown>
}

/**
 * A trend traduzida para o que o gerador entende.
 *
 * ── POR QUE A COMPOSIÇÃO É AQUI, E NÃO DENTRO DA RPC ────────────────────────
 * A frase "de onde veio" já existe, em UM lugar (`fraseDeOndeVeio`, a mesma que
 * o cartão mostra). Reescrevê-la em PL/pgSQL seria uma segunda gramática da
 * proveniência — e no dia em que uma mudasse, o roteiro e a tela contariam
 * histórias diferentes sobre o mesmo vídeo. A RPC guarda o que é INVARIANTE
 * (transação, estados, carimbos, teto); o texto é da camada que já fala.
 *
 * `null` = trend inexistente ou descartada — a action devolve frase honesta e
 * não chama o banco de novo.
 */
export async function getTrendParaRoteiro(id: string): Promise<TrendParaRoteiro | null> {
  if (!id) return null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('content_trends')
    .select(
      'id, plataforma, url, autor, views, velocidade, velocidade_sem_conta, capturada_em, semana, ' +
        'variacao_de, travel_score, travel_score_ajustado, status, source_key, tema_cluster, ' +
        'research:content_research (id, titulo, payload, creator:content_creators (nome, handle, tipo, tier))',
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`Radar: falha ao ler a trend para roteiro: ${error.message}`)
  if (!data) return null

  const t = ParaRoteiroSchema.parse(data)
  if (t.status === 'descartada') return null

  const dissecacao = lerDissecacao(t.research?.payload ?? null)
  const deOndeVeio = fraseDeOndeVeio({
    criador: t.research?.creator ?? null,
    autor: t.autor,
    plataforma: t.plataforma,
    semana: t.semana,
    rodadaCorrente: semanaDaRodada(),
    viewsFrase: fraseDeViews(t.views),
    velocidadeFrase: fraseDaVelocidade(t.velocidade, t.velocidade_sem_conta),
  })

  // O assunto: o cluster de tema quando a Teacher Vicky o escreveu, senão o título do
  // post original. Sem os dois, uma frase que ao menos DIZ de onde veio — o
  // banco recusa tema em branco, e "sem título" não é assunto.
  const tema =
    t.tema_cluster?.trim() ||
    t.research?.titulo?.trim() ||
    `Trend do ${PLATAFORMA_DO_RADAR_ROTULO[t.plataforma]} — rodada ${t.semana}`

  return {
    tema,
    gancho: dissecacao?.gancho?.texto_falado?.trim() || null,
    idea: {
      de_onde_veio: deOndeVeio,
      trend_id: t.id,
      source_key: t.source_key,
      plataforma: t.plataforma,
      rodada: t.semana,
      ...(t.url ? { url: t.url } : {}),
      ...(t.autor ? { autor: t.autor } : {}),
      // A dissecação viaja CONGELADA dentro do post: o `content_research` pode
      // ser superado por um `--force` amanhã, e o roteiro tem de continuar
      // explicando de onde ele saiu (o mesmo racional da FK-retrato do ADR-037).
      ...(dissecacao ? { dissecacao } : {}),
    },
  }
}

export interface FolgaDoTeto {
  /** quantos roteiros já entraram em geração no dia civil do negócio */
  jaHoje: number
  teto: number
  temFolga: boolean
}

/**
 * A antecipação do teto diário — e SÓ antecipação: quem decide é a RPC, dentro
 * da transação (ADR-035 decisão 3). A tela usa isto para dizer a verdade ANTES
 * do clique ("o próximo entra na fila"), nunca para bloquear o botão: bloquear
 * transformaria um adiamento em parede, e a escolha da trend continua valendo.
 *
 * A CONTAGEM vem do banco (fonte única); o TETO é a constante espelhada, com
 * teste comparando os dois números literalmente.
 */
export async function getFolgaDoTeto(): Promise<FolgaDoTeto> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('roteiros_gerados_hoje')
  if (error) throw new Error(`Radar: falha ao ler o teto do dia: ${error.message}`)
  const jaHoje = Number(data ?? 0)
  return {
    jaHoje,
    teto: TETO_DIARIO_DE_ROTEIROS,
    temFolga: jaHoje < TETO_DIARIO_DE_ROTEIROS,
  }
}

/* ========================================================================== */
/* Vista "Todos" — a auditoria do acervo (Leva 3.2)                            */
/* ========================================================================== */

const LinhaDaVistaSchema = z.object({
  id: z.string(),
  plataforma: z.enum(PLATAFORMAS_DO_RADAR),
  autor: z.string().nullable(),
  velocidade: z.number().nullable(),
  velocidade_sem_conta: z.boolean(),
  capturada_em: z.string(),
  semana: z.string().regex(RODADA_FORMATO),
  status: z.enum(STATUS_DA_TREND),
  discard_reason: z.string().nullable(),
  travel_score: z.number().nullable(),
  travel_score_ajustado: z.number().nullable(),
  variacao_de: z.string().nullable(),
  research: z
    .object({
      titulo: z.string().nullable(),
      creator: CriadorSchema.extend({ id: z.string() }).nullable(),
    })
    .nullable(),
})
type LinhaDaVista = z.infer<typeof LinhaDaVistaSchema>

export interface LinhaDoRadar {
  id: string
  plataforma: PlataformaDoRadar
  /** criador cadastrado ("Nome (@handle)") ou o autor da captura */
  criadorFrase: string
  foraDaPauta: boolean
  titulo: string | null
  rodada: string
  /** `travel_score_ajustado ?? travel_score` — a válvula da Teacher Vicky vence (ADR-033) */
  nota: number | null
  notaAjustada: boolean
  status: StatusDaTrend
  ehVariacao: boolean
  motivoDoDescarte: string | null
  /** endereço da triagem enquanto é nova; decidida é só leitura */
  href: string | null
}

export interface GrupoDaVista {
  rodada: string
  rodadaCorrente: boolean
  linhas: LinhaDoRadar[]
}

export interface VistaTodos {
  grupos: GrupoDaVista[]
  /** o acervo inteiro — estoque acumulado, nomeado como tal (ADR-036) */
  total: number
  /** quantas linhas os filtros deixaram */
  filtrados: number
  opcoes: {
    plataformas: PlataformaDoRadar[]
    criadores: { chave: string; rotulo: string }[]
    rodadas: string[]
  }
}

function linhaDaVista(t: LinhaDaVista): LinhaDoRadar {
  const criador = t.research?.creator
  return {
    id: t.id,
    plataforma: t.plataforma,
    criadorFrase: criador ? `${criador.nome} (@${criador.handle})` : (t.autor ?? '—'),
    foraDaPauta: !criador,
    titulo: t.research?.titulo ?? null,
    rodada: t.semana,
    nota: notaDaTrend(t),
    notaAjustada: t.travel_score_ajustado != null,
    status: t.status,
    ehVariacao: t.variacao_de !== null,
    motivoDoDescarte: t.discard_reason,
    href: t.status === 'nova' ? enderecoDoCartao(t.id) : null,
  }
}

function passaNosFiltros(t: LinhaDaVista, f: FiltrosDoRadar): boolean {
  if (f.plataforma && t.plataforma !== f.plataforma) return false
  if (f.rodada && t.semana !== f.rodada) return false
  if (f.criador === CRIADOR_FORA_DA_PAUTA) return !t.research?.creator
  if (f.criador) return t.research?.creator?.id === f.criador
  return true
}

/**
 * A vista de auditoria: o ACERVO inteiro (é aqui, e só aqui, que o estoque
 * acumulado aparece — nomeado como tal, ADR-036), filtrado pelos três eixos da
 * URL e agrupado por rodada DEPOIS de filtrar (régua do Design.md). As opções
 * de filtro saem do conjunto SEM filtro — filtro não esconde filtro.
 */
export async function getVistaTodos(filtros: FiltrosDoRadar): Promise<VistaTodos> {
  const supabase = await createClient()
  const linhas = exigir(
    'a vista de auditoria do radar',
    await supabase
      .from('content_trends')
      .select(
        'id, plataforma, autor, velocidade, velocidade_sem_conta, capturada_em, semana, status, ' +
          'discard_reason, travel_score, travel_score_ajustado, variacao_de, ' +
          'research:content_research (titulo, creator:content_creators (id, nome, handle, tipo, tier))',
      )
      .limit(2000),
  )
  const todas = z.array(LinhaDaVistaSchema).parse(linhas ?? [])
  if (todas.length >= 2000) {
    throw new Error('Radar: o acervo bateu na janela de 2000 linhas — paginar a vista antes de crescer')
  }

  const criadoresVistos = new Map<string, string>()
  let temForaDaPauta = false
  for (const t of todas) {
    const c = t.research?.creator
    if (c) criadoresVistos.set(c.id, `${c.nome} (@${c.handle})`)
    else temForaDaPauta = true
  }

  const filtradas = todas.filter((t) => passaNosFiltros(t, filtros))
  const rodadas = [...new Set(todas.map((t) => t.semana))].sort().reverse()
  const corrente = semanaDaRodada()

  const grupos = [...new Set(filtradas.map((t) => t.semana))]
    .sort()
    .reverse()
    .map((rodada) => ({
      rodada,
      rodadaCorrente: rodada === corrente,
      linhas: ordenarGrupoComVariacoes(filtradas.filter((t) => t.semana === rodada)).map(
        linhaDaVista,
      ),
    }))

  return {
    grupos,
    total: todas.length,
    filtrados: filtradas.length,
    opcoes: {
      plataformas: PLATAFORMAS_DO_RADAR.filter((p) => todas.some((t) => t.plataforma === p)),
      criadores: [
        ...[...criadoresVistos.entries()]
          .map(([chave, rotulo]) => ({ chave, rotulo }))
          .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
        ...(temForaDaPauta
          ? [{ chave: CRIADOR_FORA_DA_PAUTA, rotulo: 'Fora da pauta de criadores' }]
          : []),
      ],
      rodadas,
    },
  }
}
