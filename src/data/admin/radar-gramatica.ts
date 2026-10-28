// GRAMÁTICA DO RADAR (Estúdio v2 · Leva 3) — o módulo PURO.
//
// Aqui mora o vocabulário da tela de trends: as plataformas que uma trend pode
// ter (as 5 do CHECK da migration 107 — NÃO as 4 da pauta de criadores), os
// status, os endereços da triagem e dos painéis, a ordem do deck, a montagem
// mãe×variação e as frases que traduzem uma recusa do banco.
//
// Por que separado da camada de dados: este arquivo não importa `server-only`
// nem o cliente do Supabase, então componentes e TESTES o leem sem arrastar o
// servidor junto. Mesma divisão de `pauta-gramatica.ts` × `pauta.ts`.
//
// 📌 DOIS LADOS DO MESMO CONTRATO: `PLATAFORMAS_DO_RADAR`, `STATUS_DA_TREND` e
// `RODADA_FORMATO` espelham os CHECKs de `content_trends` (migration
// 20260803000300). Quem mexer de um lado sem o outro descobre no vermelho de
// `tests/radar-gramatica.test.ts` / `tests/conteudo-trends.test.ts`.

import { DateTime } from 'luxon'

import type { ContextoDoRoteiro } from '@/lib/content/contexto'
import { LIMIAR_ABA_PT } from '@/lib/content/limiar-pt'
import { TIER_ROTULO, type TierDaPauta, type TipoDaPauta } from './pauta-gramatica'

/* ========================================================================== */
/* Plataformas e status — os enums da migration 107                            */
/* ========================================================================== */

/**
 * As CINCO redes de `content_trends.plataforma`. A lista da pauta tem quatro
 * (não cadastramos criador de Reddit), mas trend de busca chega de lá — reusar
 * a lista da pauta estouraria o zod na primeira trend de Reddit real.
 */
export const PLATAFORMAS_DO_RADAR = ['youtube', 'instagram', 'tiktok', 'x', 'reddit'] as const
export type PlataformaDoRadar = (typeof PLATAFORMAS_DO_RADAR)[number]

export const PLATAFORMA_DO_RADAR_ROTULO: Record<PlataformaDoRadar, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X',
  reddit: 'Reddit',
}

export function ehPlataformaDoRadar(v: string | undefined | null): v is PlataformaDoRadar {
  return typeof v === 'string' && (PLATAFORMAS_DO_RADAR as readonly string[]).includes(v)
}

export const STATUS_DA_TREND = ['nova', 'roteirizada', 'descartada'] as const
export type StatusDaTrend = (typeof STATUS_DA_TREND)[number]

export const STATUS_DA_TREND_ROTULO: Record<StatusDaTrend, string> = {
  nova: 'para triar',
  roteirizada: 'roteirizada',
  descartada: 'descartada',
}

export function ehStatusDaTrend(v: string | undefined | null): v is StatusDaTrend {
  return typeof v === 'string' && (STATUS_DA_TREND as readonly string[]).includes(v)
}

/* ========================================================================== */
/* Rodada (a coluna `semana`, '2026-W32')                                      */
/* ========================================================================== */

/** Espelho do CHECK `content_trends_semana_check` (W01–W53). */
export const RODADA_FORMATO = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/

export function ehRodada(v: string | undefined | null): boolean {
  return typeof v === 'string' && RODADA_FORMATO.test(v)
}

/**
 * A rodada corrente — REIMPLEMENTA `semanaIso()` do worker de propósito:
 * `src/lib/research/tipos.ts` é módulo do worker (imports relativos `.ts`) e
 * não atravessa para a UI. A fórmula tem de ser IDÊNTICA (weekYear+weekNumber
 * em UTC), senão a rodada da tela diverge da do banco — o teste compara as duas
 * em datas-armadilha de virada de ano ISO.
 */
export function semanaDaRodada(quando: DateTime = DateTime.utc()): string {
  const d = quando.setZone('utc')
  return `${d.weekYear}-W${String(d.weekNumber).padStart(2, '0')}`
}

/** "rodada 2026-W32", com a marca de corrente quando é a semana de agora. */
export function rotuloDaRodada(semana: string, corrente: string): string {
  return semana === corrente ? `rodada ${semana} (corrente)` : `rodada ${semana}`
}

/* ========================================================================== */
/* Endereços e painéis                                                         */
/* ========================================================================== */

/**
 * 🚦 CUTOVER (Leva 5): o radar É a casa do Estúdio. Ele nasceu em
 * `/admin/conteudo/radar` como rota irmã e assumiu `/admin/conteudo` quando a
 * geração ligou — escolher a trend virou o começo do fluxo, e a fila de posts
 * (o que sobra depois do roteiro pronto) desceu para `/admin/conteudo/posts`.
 * O endereço velho continua vivo como redirect por uma leva (a Leva 7 apaga).
 */
export const CASA_DO_RADAR = '/admin/conteudo'

/** A fila de posts — o que era o Estúdio antes do cutover. */
export const CASA_DOS_POSTS = '/admin/conteudo/posts'

export const PAINEIS_DO_RADAR = ['descartar', 'nota'] as const
export type PainelDoRadar = (typeof PAINEIS_DO_RADAR)[number]

export function ehPainelDoRadar(v: string | undefined | null): v is PainelDoRadar {
  return typeof v === 'string' && (PAINEIS_DO_RADAR as readonly string[]).includes(v)
}

export const VISTAS_DO_RADAR = ['triagem', 'pt', 'todos'] as const
export type VistaDoRadar = (typeof VISTAS_DO_RADAR)[number]

export function ehVistaDoRadar(v: string | undefined | null): v is VistaDoRadar {
  return typeof v === 'string' && (VISTAS_DO_RADAR as readonly string[]).includes(v)
}

/**
 * As duas vistas de CARTÕES (o fluxo um-a-um). A aba PT é a mesma triagem com
 * outro recorte — filtro, não bucket (ADR-033): a trend de viagem aparece nos
 * dois lugares. `todos` fica de fora: lista de auditoria não tem deck.
 */
export const VISTAS_DE_TRIAGEM = ['triagem', 'pt'] as const
export type VistaDeTriagem = (typeof VISTAS_DE_TRIAGEM)[number]

export function ehVistaDeTriagem(v: string | undefined | null): v is VistaDeTriagem {
  return typeof v === 'string' && (VISTAS_DE_TRIAGEM as readonly string[]).includes(v)
}

/** A casa de cada vista de cartões — a triagem é a default e OMITE `ver`. */
export function casaDaVista(vista: VistaDeTriagem): string {
  return vista === 'pt' ? `${CASA_DO_RADAR}?ver=pt` : CASA_DO_RADAR
}

/**
 * O DESTINO do roteiro é a aba de onde a Teacher Vicky clicou (ADR-035 decisão 2): da
 * Triagem sai roteiro de engajamento geral; da aba Personal Travel sai roteiro
 * com o convite pro programa. Não há terceira pergunta — a aba já respondeu.
 */
export function contextoDaVista(vista: VistaDeTriagem): ContextoDoRoteiro {
  return vista === 'pt' ? 'travel' : 'geral'
}

/**
 * Painel É endereço (régua dos painéis da casa): abrir é navegar, fechar é
 * voltar. A vista viaja no endereço (`?ver=pt`) para o round-trip inteiro —
 * Pular, painel, Cancelar, erro, sucesso — devolver à aba de origem; o default
 * `triagem` OMITE `ver`, então os endereços de hoje ficam byte a byte iguais.
 */
export function enderecoDoCartao(alvo?: string, vista: VistaDeTriagem = 'triagem'): string {
  const ver = vista === 'pt' ? 'ver=pt&' : ''
  return alvo ? `${CASA_DO_RADAR}?${ver}alvo=${encodeURIComponent(alvo)}` : casaDaVista(vista)
}

export function enderecoDoPainelDescartar(alvo: string, vista: VistaDeTriagem = 'triagem'): string {
  return `${enderecoDoCartao(alvo, vista)}&painel=descartar`
}

export function enderecoDoPainelNota(alvo: string, vista: VistaDeTriagem = 'triagem'): string {
  return `${enderecoDoCartao(alvo, vista)}&painel=nota`
}

/** A chave do rascunho do formulário de descarte (o que sobrevive a uma volta de erro). */
export function chaveDoDescarte(alvo: string): string {
  return `radar-descarte:${alvo}`
}

/** A chave do rascunho do ajuste de nota — POR TREND, como a do descarte. */
export function chaveDaNota(alvo: string): string {
  return `radar-nota:${alvo}`
}

/** O valor do filtro de criador que significa "sem ficha na pauta". */
export const CRIADOR_FORA_DA_PAUTA = 'fora'

/** Os três eixos da vista de auditoria — todos na URL, todos ortogonais. */
export interface FiltrosDoRadar {
  plataforma?: PlataformaDoRadar
  /** id do criador cadastrado, ou `CRIADOR_FORA_DA_PAUTA` */
  criador?: string
  rodada?: string
}

export function enderecoDaVistaTodos(f?: FiltrosDoRadar): string {
  const p = new URLSearchParams({ ver: 'todos' })
  if (f?.plataforma) p.set('plataforma', f.plataforma)
  if (f?.criador) p.set('criador', f.criador)
  if (f?.rodada) p.set('rodada', f.rodada)
  return `${CASA_DO_RADAR}?${p.toString()}`
}

/* ========================================================================== */
/* Embed — só o YouTube tem iframe simples; o resto é cartão-link              */
/* ========================================================================== */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/

/**
 * O id do vídeo quando a URL é reconhecível (`watch?v=`, `youtu.be/`,
 * `/shorts/`, `/embed/`) — e `null` para todo o resto. URL ilegível NÃO é
 * adivinhada: vira cartão-link com a URL crua, que é o estado honesto.
 */
export function idDoYoutube(url: string | null | undefined): string | null {
  if (!url) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^(www|m)\./, '')
  if (host === 'youtu.be') {
    const id = u.pathname.split('/').filter(Boolean)[0] ?? ''
    return YOUTUBE_ID.test(id) ? id : null
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const partes = u.pathname.split('/').filter(Boolean)
    if (partes[0] === 'watch') {
      const id = u.searchParams.get('v') ?? ''
      return YOUTUBE_ID.test(id) ? id : null
    }
    if (partes[0] === 'shorts' || partes[0] === 'embed') {
      const id = partes[1] ?? ''
      return YOUTUBE_ID.test(id) ? id : null
    }
  }
  return null
}

/* ========================================================================== */
/* Ordem do deck e montagem mãe×variação                                       */
/* ========================================================================== */

interface LinhaOrdenavel {
  id: string
  semana: string
  velocidade: number | null
  velocidade_sem_conta: boolean
  capturada_em: string
}

/**
 * A ordem da triagem: rodada mais nova primeiro; dentro dela, a velocidade
 * decide (é O número do radar, visível no "De onde veio") com NULL por último
 * (bundle sem views não fura fila); depois a captura mais antiga; e o `id`
 * desempata TUDO — sem desempate total, dois cartões empatados trocariam de
 * posição entre renders e o contador/Pular pulsariam.
 *
 * ⚠️ VELOCIDADE COM E SEM RÉGUA NÃO SE COMPARAM (medido na bancada da Leva 3):
 * a normalizada é "×mediana da conta" (~1–10) e a sem conta é views/dia cru
 * (milhares) — misturá-las faria QUALQUER item sem conta furar a fila inteira.
 * Quem tem régua vem primeiro; os sem régua brigam entre si; NULL por último.
 *
 * `travel_score` NÃO ordena aqui de propósito: a nota ordena a aba PT (Leva 4);
 * ordenar a triagem geral por um número que o cartão ainda não mostra deixaria
 * o deck parecendo embaralhado.
 */
export function ordenarDeck(a: LinhaOrdenavel, b: LinhaOrdenavel): number {
  if (a.semana !== b.semana) return a.semana < b.semana ? 1 : -1
  const faixa = (l: LinhaOrdenavel) => (l.velocidade == null ? 2 : l.velocidade_sem_conta ? 1 : 0)
  if (faixa(a) !== faixa(b)) return faixa(a) - faixa(b)
  if (a.velocidade != null && b.velocidade != null && a.velocidade !== b.velocidade) {
    return b.velocidade - a.velocidade
  }
  if (a.capturada_em !== b.capturada_em) return a.capturada_em < b.capturada_em ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * O deck a partir das trends NOVAS: raiz vira cartão; variação cuja mãe está no
 * deck fica PENDURADA nela (o contador conta decisões, não linhas — descartar a
 * mãe resolve as filhas pela cascata do banco); variação cuja mãe NÃO está no
 * deck vira cartão próprio ("órfã"). Invariante do banco que este código pode
 * afirmar: mãe descartada nunca deixa filha nova viva (guard + cascata da 107),
 * logo TODA órfã tem mãe roteirizada — informação de decisão, não palpite.
 */
export function montarDeck<T extends { id: string; variacao_de: string | null }>(
  novas: readonly T[],
): { raizes: T[]; variacoesPor: Map<string, T[]> } {
  const ids = new Set(novas.map((t) => t.id))
  const raizes: T[] = []
  const variacoesPor = new Map<string, T[]>()
  for (const t of novas) {
    if (t.variacao_de !== null && ids.has(t.variacao_de)) {
      const irmas = variacoesPor.get(t.variacao_de) ?? []
      irmas.push(t)
      variacoesPor.set(t.variacao_de, irmas)
    } else {
      raizes.push(t)
    }
  }
  return { raizes, variacoesPor }
}

/** A órfã do deck (raiz com `variacao_de` preenchido) tem mãe roteirizada — ver `montarDeck`. */
export function ehVariacaoOrfa(t: { variacao_de: string | null }): boolean {
  return t.variacao_de !== null
}

/**
 * A ordem de um GRUPO da vista "Todos": `ordenarDeck` primeiro, e depois cada
 * variação sobe para logo DEPOIS da mãe (pendurada visível — spec 3.2). Variação
 * cuja mãe não está no grupo (decidida, filtrada ou de outra rodada) fica onde a
 * ordem a pôs, com a marca de variação falando por ela.
 */
export function ordenarGrupoComVariacoes<T extends LinhaOrdenavel & { variacao_de: string | null }>(
  linhas: readonly T[],
): T[] {
  const ordenadas = [...linhas].sort(ordenarDeck)
  const ids = new Set(linhas.map((l) => l.id))
  const filhasDe = new Map<string, T[]>()
  for (const l of ordenadas) {
    if (l.variacao_de && ids.has(l.variacao_de)) {
      const arr = filhasDe.get(l.variacao_de) ?? []
      arr.push(l)
      filhasDe.set(l.variacao_de, arr)
    }
  }
  const resultado: T[] = []
  for (const l of ordenadas) {
    if (l.variacao_de && ids.has(l.variacao_de)) continue
    resultado.push(l, ...(filhasDe.get(l.id) ?? []))
  }
  return resultado
}

/* ========================================================================== */
/* Nota de viagem e a aba PT (Leva 4)                                          */
/* ========================================================================== */

/**
 * O corte da aba Personal Travel: nota ≥ limiar entra (ADR-033 decisão 3).
 * Desde a Leva 6.2 ele MORA em `@/lib/content/limiar-pt` e é reexportado aqui:
 * o digest do lote (worker → RPC) precisa do mesmo número para dizer "X em
 * destaque" com a mesma conta da tela, e o worker não resolve o alias `@/`.
 * Quem lê a gramática continua lendo daqui.
 */
export { LIMIAR_ABA_PT }

/**
 * 📌 DOIS LADOS DO MESMO CONTRATO: a faixa da nota espelha os CHECKs
 * `content_trends_travel_score_check` / `content_trends_travel_ajustado_check`
 * da migration 107 (0–100). O formulário e a action antecipam a frase; quem
 * mudar a faixa de um lado sem o outro descobre no vermelho dos guards.
 */
export const NOTA_MINIMA = 0
export const NOTA_MAXIMA = 100

interface ComNota {
  travel_score: number | null
  travel_score_ajustado: number | null
}

/**
 * A nota que VALE: `travel_score_ajustado ?? travel_score` — a válvula da
 * Teacher Vicky vence SEMPRE (ADR-033 decisão 4), e `??` preserva um ajuste de `0`
 * (expulsar da aba é uso legítimo da válvula). Fonte ÚNICA da precedência:
 * deck PT, vista Todos e chip do cartão leem daqui.
 */
export function notaDaTrend(t: ComNota): number | null {
  return t.travel_score_ajustado ?? t.travel_score
}

/**
 * Nota NULL fica FORA da aba PT por construção (ADR-033 decisão 5: falha da
 * chamada é fail-open — a trend segue na Triagem, com aviso, e a corrida
 * seguinte cura). O limiar é injetável para o teste apertar a régua.
 */
export function passaNaAbaPT(t: ComNota, limiar: number = LIMIAR_ABA_PT): boolean {
  const nota = notaDaTrend(t)
  return nota != null && nota >= limiar
}

/**
 * A ordem da aba PT: nota decrescente (a spec da leva — nativas flutuam para o
 * topo), e o EMPATE cai inteiro em `ordenarDeck`, que termina no `id` — a ordem
 * continua TOTAL e o contador/Pular não pulsam. NULL por último é defensivo:
 * `passaNaAbaPT` já barra sem-nota na porta.
 */
export function ordenarDeckPT<T extends LinhaOrdenavel & ComNota>(a: T, b: T): number {
  const na = notaDaTrend(a)
  const nb = notaDaTrend(b)
  if (na == null || nb == null) {
    if (na != null) return -1
    if (nb != null) return 1
  } else if (na !== nb) {
    return nb - na
  }
  return ordenarDeck(a, b)
}

/* ========================================================================== */
/* "De onde veio" — montado por CÓDIGO, nunca pelo modelo                      */
/* ========================================================================== */

/** "128.400 views" — ou `null` quando a captura não trouxe views. */
export function fraseDeViews(views: number | null): string | null {
  if (views == null) return null
  return `${views.toLocaleString('pt-BR')} views`
}

/**
 * A velocidade com a régua dita por extenso: normalizada pela mediana da conta
 * quando há conta ("1,8× a mediana da conta"), views/dia puro com a ressalva
 * quando não há ("5.000 views/dia — sem a régua da conta"). `null` = a captura
 * não teve como calcular (sem views ou sem data de publicação).
 */
export function fraseDaVelocidade(velocidade: number | null, semConta: boolean): string | null {
  if (velocidade == null) return null
  if (semConta) {
    return `${Math.round(velocidade).toLocaleString('pt-BR')} views/dia — sem a régua da conta`
  }
  return `${velocidade.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× a mediana da conta`
}

export interface OrigemDaTrend {
  /** o criador CADASTRADO (via research → content_creators); `null` = veio de busca */
  criador: { nome: string; handle: string; tipo: TipoDaPauta; tier: TierDaPauta | null } | null
  /** o autor como texto da captura — o fallback quando não há criador cadastrado */
  autor: string | null
  plataforma: PlataformaDoRadar
  semana: string
  /** `semanaDaRodada()` de agora — injetada para a função ficar pura */
  rodadaCorrente: string
  viewsFrase: string | null
  velocidadeFrase: string | null
}

/**
 * A frase de proveniência do cartão. Regra do desvio (a mesma da lista da
 * pauta no celular): tipo/tier só aparecem quando carregam informação —
 * "Empresa" e tier definido; "criador sem classificação" em toda linha seria
 * ruído.
 */
export function fraseDeOndeVeio(o: OrigemDaTrend): string {
  const rede = PLATAFORMA_DO_RADAR_ROTULO[o.plataforma]
  const quem = o.criador
    ? `De ${o.criador.nome} (@${o.criador.handle}) no ${rede}`
    : o.autor
      ? `De ${o.autor} no ${rede} — fora da pauta de criadores`
      : `Autor não identificado na captura do ${rede}`

  const desvios: string[] = []
  if (o.criador?.tipo === 'empresa') desvios.push('empresa')
  if (o.criador?.tier) desvios.push(`alcance ${TIER_ROTULO[o.criador.tier].toLowerCase()}`)

  return [quem, ...desvios, rotuloDaRodada(o.semana, o.rodadaCorrente), o.viewsFrase, o.velocidadeFrase]
    .filter(Boolean)
    .join(' · ')
}

/* ========================================================================== */
/* Recusas do banco                                                            */
/* ========================================================================== */

/**
 * As frases de DESFECHO não moram aqui (o varredor de `tests/portal-nav.test.ts`
 * lê a fonte de `radar/actions.ts` — ver a nota em `pauta-gramatica.ts`). Aqui
 * moram só as TRADUÇÕES de recusa do banco, casadas pelas marcas dos `raise`
 * do guard da migration 107.
 */
const RECUSAS_DO_BANCO: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /content_trends_descartada_shape/i,
    'Falha: o descarte precisa de um motivo — escreva por que essa trend sai de cena.',
  ],
  [
    // guard: 'trend % está % — imutável (Lei 8)' (linha já decidida; duplo clique)
    /— imutável \(Lei 8\)/i,
    'Falha: essa trend já foi decidida — a decisão não se desfaz. Recarregue a página.',
  ],
  [
    /transição inválida/i,
    'Falha: essa mudança de estado não existe no radar — recarregue a página.',
  ],
  [
    /content_trends_decidida_shape/i,
    'Falha: não consegui carimbar quem decidiu — saia, entre de novo e tente outra vez.',
  ],
  [
    // guard: 'medição da trend % é retrato da captura — congelada' + grants de coluna
    /retrato da captura — congelada|permission denied/i,
    'Falha: a medição da trend é do robô — esta tela só decide o destino dela.',
  ],
  [
    /não se apaga/i,
    'Falha: trend não se apaga — descartar com motivo é o caminho, e o histórico fica.',
  ],
  // ── Recusas da RPC `gerar_roteiro_da_trend` (migration 108, Leva 5) ────────
  // Vêm ANTES de nada aqui em cima porque nenhuma delas colide com as marcas
  // acima; a ordem só importa entre padrões que possam casar a mesma frase.
  [
    /já foi decidida em outra aba/i,
    'Falha: essa trend acabou de ser decidida em outra aba — recarregue a página.',
  ],
  [
    /tema descartado não vira roteiro|está descartada/i,
    'Falha: essa trend está descartada — tema descartado não vira roteiro.',
  ],
  [
    /não existe/i,
    'Falha: essa trend não existe mais — recarregue a página.',
  ],
  [
    /não decide pauta|exige sessão com ator/i,
    'Falha: sua sessão não tem permissão para gerar roteiro — saia, entre de novo e tente outra vez.',
  ],
  [
    /geral ou travel/i,
    'Falha: não entendi de qual aba veio o pedido — recarregue a página.',
  ],
  [
    /precisa de tema/i,
    'Falha: essa captura não trouxe título nem tema — sem assunto não há roteiro.',
  ],
  [
    /duplicate key|external_ref/i,
    'Falha: esse roteiro já estava sendo criado — recarregue a página.',
  ],
]

export const RECUSA_DESCONHECIDA =
  'Falha: não consegui salvar agora. Nada foi alterado — tente de novo em alguns instantes.'

/** Todas as frases que esta tela pode dizer quando o banco recusa (para teste). */
export const FRASES_DE_RECUSA: readonly string[] = [
  ...RECUSAS_DO_BANCO.map(([, frase]) => frase),
  RECUSA_DESCONHECIDA,
]

export function fraseDaRecusaDoBanco(cru: string | null | undefined): string {
  const texto = (cru ?? '').trim()
  for (const [marca, frase] of RECUSAS_DO_BANCO) if (marca.test(texto)) return frase
  return RECUSA_DESCONHECIDA
}
