// PESQUISA DE PAUTA — a configuração ajustável (M5 do ciclo 1 de conteúdo).
//
// Tudo que é ESCOLHA EDITORIAL vive aqui, em um lugar só: onde procurar, com
// que palavras, quantos itens trazer, quais atores do Apify usar. Mexer em
// pauta não deveria exigir ler o worker — e o M6, que vai medir se a pesquisa
// serve, precisa de um botão para girar.
//
// SEM `import 'server-only'`: quem consome isto é o worker, fora do Next
// (mesma razão de `src/lib/ai/claude.ts`).

/** As 5 redes que a pesquisa cobre — espelha o CHECK `content_research_plataforma`. */
export const REDES = ['youtube', 'instagram', 'tiktok', 'x', 'reddit'] as const
export type Rede = (typeof REDES)[number]

/**
 * Onde existe VÍDEO para transcrever e analisar — espelha o CHECK
 * `content_research_tipo_plataforma`. X e Reddit entram só como trends: o
 * banco recusa `analise_reel` nelas, e o worker nem tenta.
 */
export const REDES_COM_VIDEO = ['youtube', 'instagram', 'tiktok'] as const
export type RedeComVideo = (typeof REDES_COM_VIDEO)[number]

export function temVideo(rede: Rede): rede is RedeComVideo {
  return (REDES_COM_VIDEO as readonly string[]).includes(rede)
}

export const REDE_ROTULO: Record<Rede, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X',
  reddit: 'Reddit',
}

/* ========================================================================== */
/* O recorte da busca                                                          */
/* ========================================================================== */

/** Vídeo curto = até 90s. Acima disso é outro formato e não serve de referência. */
export const MAX_SEGUNDOS = 90

/** Quantos itens cada fonte guarda por corrida, depois do filtro. */
export const TOP_POR_FONTE = 10

/** Quantos reels do TREND viram análise (transcrição + Claude) por rede com vídeo. */
export const REELS_ANALISADOS_POR_TREND = 2

/** Quantos Shorts de cada criador cadastrado viram análise. */
export const REELS_ANALISADOS_POR_CRIADOR = 2

/** Quantos uploads recentes varrer por criador do YouTube antes de filtrar. */
export const UPLOADS_VARRIDOS = 100

/**
 * Quantos itens cada chamada de PERFIL pede ao ator do Apify. A estimativa
 * impressa antes da corrida usa ESTES números (Leva 1.1): era o custo de
 * perfil, fora da conta antiga, que dominava a fatura real — US$ 0,69 dos
 * US$ 1,08 medidos em 02/08. YouTube não entra: perfil lá é API oficial (quota).
 */
export const PERFIL_ITENS = { instagram: 30, tiktok: 30, x: 20 } as const

/** Buscas por rede. São SEMENTES editoriais — girar aqui muda a pauta.
 *
 *  As sementes de VIAGEM entraram em 02/08/2026 (direção editorial da Teacher Vicky:
 *  a pauta aponta para inglês-para-viagem). As genéricas FICAM: a direção
 *  manda re-ambientar trend forte, e para re-ambientar é preciso vê-lo. */
export const BUSCAS: Record<Exclude<Rede, 'reddit'>, readonly string[]> = {
  youtube: ['aprender inglês', 'english tips', 'dicas de inglês', 'inglês para viagem', 'english for travel'],
  instagram: ['aprenderingles', 'englishtips', 'dicasdeingles', 'inglesparaviagem', 'travelenglish'],
  tiktok: ['aprenderingles', 'englishtips', 'inglesparabrasileiros', 'inglesparaviagem', 'travelenglish'],
  x: ['aprender inglês', 'english learning tips', 'inglês para viagem'],
}

/** Os fóruns onde o público fala do problema com as próprias palavras.
 *  r/travel foi CONSIDERADO e RECUSADO (02/08): com 'travel' agora no filtro
 *  de tema, praticamente todo post dele passaria — e viraria pauta de mala e
 *  roteiro, não de inglês. A dor de idioma em viagem já aparece nos três. */
export const SUBREDDITS = ['EnglishLearning', 'languagelearning', 'Idiomas'] as const

/* ========================================================================== */
/* O filtro por CÓDIGO (pré-LLM)                                               */
/* ========================================================================== */

/**
 * Antes de gastar um token com o Claude, o código joga fora o que claramente
 * não é do assunto. Barato, determinístico e auditável — a alternativa seria
 * pagar um modelo para dizer "isto é sobre outra coisa".
 */
export const PALAVRAS_DO_TEMA: readonly string[] = [
  'ingl', 'english', 'speak', 'fluen', 'pronunc', 'idioma', 'language',
  'vocab', 'grammar', 'gramática', 'phrasal', 'listening', 'accent', 'sotaque',
  'aprend', 'learn', 'estud', 'study', 'teacher', 'professor',
  // Direção de viagem (02/08): sem estas, um reel de #inglesparaviagem cuja
  // legenda diz só "5 frases pro aeroporto ✈️" cairia como fora de tema. O
  // risco aceito: um vlog puro de viagem que escape da semente passa o filtro
  // e custa no máximo uma análise (~US$ 0,04) — visível no payload, não
  // silencioso. É por 'travel' estar aqui que r/travel NÃO entra nos SUBREDDITS.
  'viag', 'travel',
]

/**
 * Piso de engajamento por rede — item abaixo disso não representa trend.
 *
 * Reddit é 0 por um motivo MEDIDO, não por descuido: o feed Atom (a única porta
 * que o Reddit ainda abre sem OAuth — ver `reddit.ts`) não expõe upvote nem
 * comentário. Piso sobre número que não existe zeraria a fonte inteira. Lá o
 * filtro é o tema, e o ranking é a própria ordem do "top da semana".
 */
export const ENGAJAMENTO_MINIMO: Record<Rede, number> = {
  youtube: 5_000,
  // Medido: o topo da hashtag tem 320 likes e a mediana é 1 (aba recentes).
  instagram: 100,
  tiktok: 5_000,
  x: 50,
  reddit: 0,
}

/* ========================================================================== */
/* Apify — atores e preço                                                      */
/* ========================================================================== */

/**
 * Os atores são CONFIGURÁVEIS por env: scraping quebra quando a rede muda de
 * casa, e trocar de ator não deveria exigir deploy. O preço unitário é o do
 * anúncio da loja do Apify e serve só para a ESTIMATIVA impressa antes da
 * corrida (ADR-031, adendo 01/08: custo é informação, nunca trava).
 */
export interface AtorApify {
  id: string
  /** US$ por 1.000 resultados, para a estimativa. */
  usdPorMil: number
}

function ator(env: string, padrao: string, usdPorMil: number): AtorApify {
  return { id: process.env[env] ?? padrao, usdPorMil }
}

export const ATORES = {
  // MEDIDO na 1ª corrida real (01/08): o scraper de hashtag devolve a aba
  // RECENTES, não o topo — 60 publicações, ZERO vídeo (30 imagens + 30
  // carrosséis) e mediana de 1 like. Não é trend; é o que acabou de ser
  // postado. Fica como está (é o que a hashtag mostra, e o payload declara
  // isso), com piso baixo — e o caminho FORTE do Instagram é o de perfil.
  instagramBusca: ator('APIFY_ATOR_IG_BUSCA', 'apify~instagram-hashtag-scraper', 2.3),
  // Este devolveu 5/5 com vídeo e views de verdade na sonda. O de perfil
  // genérico (`instagram-profile-scraper`) traz o cabeçalho do perfil, não os
  // reels — e é reel que a pesquisa precisa transcrever.
  instagramPerfil: ator('APIFY_ATOR_IG_PERFIL', 'apify~instagram-reel-scraper', 2.3),
  tiktokBusca: ator('APIFY_ATOR_TIKTOK', 'clockworks~tiktok-scraper', 4),
  tiktokPerfil: ator('APIFY_ATOR_TIKTOK', 'clockworks~tiktok-scraper', 4),
  // MEDIDO na 1ª corrida real (01/08): `apidojo~tweet-scraper` devolve
  // `{noResults:true}` para toda entrada (searchTerms e startUrls), e
  // `apidojo~twitter-scraper-lite` devolve item de demonstração — os dois estão
  // atrás de assinatura. O de baixo respondeu com tweets de verdade, nos campos
  // que o tradutor já esperava.
  xBusca: ator('APIFY_ATOR_X', 'kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest', 0.4),
  xPerfil: ator('APIFY_ATOR_X', 'kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest', 0.4),
} as const

/** Teto de espera de uma corrida do Apify (o run-sync devolve o que já tem). */
export const APIFY_TIMEOUT_S = 240

/* ========================================================================== */
/* Modelos e preços de IA                                                      */
/* ========================================================================== */

/** Transcrição+descrição visual numa passada. O modelo do Claude vem do prompt ativo. */
export const MODELO_GEMINI = process.env.GEMINI_MODELO ?? 'gemini-3.6-flash'

/** US$/milhão de tokens do claude-sonnet-5 (preço introdutório até 31/08/2026). */
export const PRECO_CLAUDE = { entrada: 2, saida: 10 } as const

/** US$/milhão de tokens do claude-haiku-4-5 (a nota de viagem do radar — Leva 2.2). */
export const PRECO_HAIKU = { entrada: 1, saida: 5 } as const

/* ========================================================================== */
/* Onde a mídia fica (ADR-031, adendo de 01/08)                                */
/* ========================================================================== */

/**
 * NADA É APAGADO — decisão do dono, 01/08/2026: dados de terceiros são
 * responsabilidade dele, o pipeline não impõe limitação nem faz limpeza. A
 * mídia baixada para transcrever e o bruto devolvido pelos scrapers ficam em
 * `_rascunhos/` (fora do git), para sempre. No banco vão só os derivados.
 */
export const PASTA_MIDIA = '_rascunhos/research-midia'
export const PASTA_BRUTO = '_rascunhos/research-raw'
