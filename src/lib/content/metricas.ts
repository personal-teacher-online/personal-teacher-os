// MÉTRICAS COM DENTES (M6) — o instrumento que decide se o volume de pauta
// escala ou congela.
//
// Três perguntas, e nada além delas (Leva 6.1 — o funil do RADAR):
//   1. Quanto do que a varredura trouxe virou roteiro? (conversão radar→roteiro
//      — insumo editorial, sem limiar: escolher a trend já É a aprovação)
//   2. A Teacher Vicky aprova o roteiro pronto? (taxa de aprovação no PORTÃO 2)
//   3. O roteiro que sai da esteira é utilizável, ou ela reescreve por cima?
//      (reescrita pesada — ponta a ponta: mede trend + gerador JUNTOS)
//
// ── O QUE ESTA MEDIDA É E O QUE ELA NÃO É ───────────────────────────────────
// `percentualDeReescrita` é um PROXY LEXICAL: "% do texto trocado". Não é nota
// de qualidade. Trocar uma frase inteira por outra melhor marca alto; reordenar
// cenas sem mudar palavra marca médio. O painel diz isso com todas as letras —
// número honesto vale mais que número lisonjeiro (lição do A5).
//
// Módulo PURO: sem banco, sem React, sem env. Quem lê o banco é o painel.

import { DateTime } from 'luxon'

/* ========================================================================== */
/* A rodada (Estúdio v2 — Leva 0.3)                                            */
/* ========================================================================== */

/**
 * Início da RODADA corrente: segunda-feira 00:00 da semana ISO, em UTC — a
 * MESMA janela semanal que endereça os trends da pesquisa
 * (`trends:<rede>:<AAAA-Wss>`, src/lib/research/tipos.ts). O banner do
 * Estúdio conta o LOTE desta janela, nunca o estoque (ADR-036): virou a
 * semana sem varredura nova, o banner cala — "Para você" continua listando
 * as pendências. A régua por rodada (Leva 0.5) agrupa pela mesma fronteira.
 */
export function inicioDaRodada(agora: Date = new Date()): string {
  return DateTime.fromJSDate(agora, { zone: 'utc' }).startOf('week').toISO()!
}

/* ========================================================================== */
/* A regra pré-comprometida                                                    */
/* ========================================================================== */

/**
 * A régua POR RODADA (Estúdio v2 — Leva 0.5, ADR-036). Substitui a
 * `REGRA_PADRAO` do M6: o funil que ela media (aprovação no portão 1) morre
 * com o radar — escolher a trend passa a SER a aprovação. A troca é de
 * INSTRUMENTO, registrada no ADR-036 §4: nenhum limiar mudou depois de
 * medido; mudou o objeto medido (portão 2, por rodada de varredura).
 * Os limiares seguem pré-comprometidos — não se retro-ajustam.
 */
export interface RegraPorRodada {
  /** % mínima de aprovação no PORTÃO 2 (sobre decididos das rodadas fechadas). */
  aprovacaoMinima: number
  /** % máxima de roteiros aprovados com reescrita pesada. */
  reescritaMaxima: number
  /** Acima de quanto % de texto trocado um roteiro conta como reescrita pesada. */
  reescritaPesadaAcimaDe: number
  /** Veredito só com este tanto de rodadas FECHADAS (lote decidido, §2.16). */
  minimoRodadasFechadas: number
}

export const REGRA_POR_RODADA: RegraPorRodada = {
  aprovacaoMinima: 60,
  reescritaMaxima: 30,
  reescritaPesadaAcimaDe: 50,
  minimoRodadasFechadas: 2,
}

/* ========================================================================== */
/* O proxy lexical                                                             */
/* ========================================================================== */

/** Linhas que são SÓ estrutura: aparecem iguais dos dois lados e inflariam a
 *  semelhança sem que ninguém tenha escrito nada. */
const LINHA_SO_ESTRUTURA = /^(CENA\s+\d+|CTA|LEGENDA|VARIANTES DE GANCHO:)\s*$/

/** Rótulos que abrem uma linha de CONTEÚDO: o rótulo sai, o conteúdo fica. */
const ROTULOS = [
  'GANCHO:',
  'HASHTAGS:',
  'DURAÇÃO-ALVO:',
  'TRILHA:',
  'NOTA DE PRODUÇÃO:',
  'Fala:',
  'Texto na tela:',
  'Ação:',
]

/**
 * Texto → lista de palavras comparáveis.
 *
 * Tira o que é forma (marcador, rótulo, numeração de variante, pontuação,
 * caixa, espaço repetido) e deixa o que é escolha de quem escreveu.
 */
export function normalizarParaDiff(texto: string): string[] {
  const linhas = (texto ?? '').replace(/\r\n?/g, '\n').split('\n')
  const uteis: string[] = []
  for (const bruta of linhas) {
    const linha = bruta.trim()
    if (!linha || LINHA_SO_ESTRUTURA.test(linha)) continue
    const rotulo = ROTULOS.find((r) => linha.startsWith(r))
    const semRotulo = rotulo ? linha.slice(rotulo.length) : linha
    // "1. variante" → "variante" (a numeração é do serializador, não da autora).
    uteis.push(semRotulo.replace(/^\d+\.\s*/, ''))
  }
  return uteis
    .join(' ')
    .toLowerCase()
    // Pontuação e símbolos fora; letra acentuada e dígito ficam.
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Maior subsequência comum, em número de palavras (linha rolante — o roteiro
 *  cabe em ~1.300 palavras e a matriz cheia seria desperdício). */
function lcsDePalavras(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0
  let anterior = new Array<number>(b.length + 1).fill(0)
  let atual = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      atual[j] = a[i - 1] === b[j - 1] ? anterior[j - 1] + 1 : Math.max(anterior[j], atual[j - 1])
    }
    const troca = anterior
    anterior = atual
    atual = troca
    atual.fill(0)
  }
  return anterior[b.length]
}

/**
 * Quanto do roteiro foi TROCADO, de 0 a 100 (uma casa decimal).
 *
 * Fórmula fechada: `100 × (1 − 2·LCS/(|orig| + |editado|))`. Idêntico → 0;
 * reescrita total → 100. Os dois vazios → 0 (não houve edição).
 */
export function percentualDeReescrita(original: string, atual: string): number {
  const a = normalizarParaDiff(original)
  const b = normalizarParaDiff(atual)
  const total = a.length + b.length
  if (total === 0) return 0
  const comum = lcsDePalavras(a, b)
  const pct = 100 * (1 - (2 * comum) / total)
  return Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10
}

/* ========================================================================== */
/* O resumo da coorte                                                          */
/* ========================================================================== */

export interface PostDaCoorte {
  status: string
  idea_approved_at: string | null
  approved_at: string | null
  roteiro: string | null
  generation_meta: Record<string, unknown> | null
  created_at: string
  /** Motivo registrado nos portões — insumo editorial da rodada (Leva 0.5). */
  rejection_reason?: string | null
  /**
   * A TREND que gerou este roteiro (Leva 6.1). É ela quem dá a rodada: rodada é
   * a VARREDURA (ADR-036), não a semana em que o roteiro foi gerado — trend da
   * W32 roteirizada na W33 continua sendo resultado da varredura da W32.
   * `null` = roteiro avulso, que não mede a esteira e fica fora da coorte.
   */
  trend: { semana: string } | null
}

/** Uma trend da varredura, na conta da conversão radar→roteiro (Leva 6.1). */
export interface TrendDaRodada {
  /** `AAAA-Wss` da captura — a rodada, e o mesmo rótulo do `content_trends.semana`. */
  semana: string
  /** `nova` (ainda sem decisão) · `roteirizada` · `descartada`. */
  status: string
  /** Variação pendurada numa raiz não conta: o deck decide por CARTÃO (raiz). */
  variacao_de: string | null
}

/** Uma rodada (a semana ISO da varredura), na visão da régua nova. */
export interface Rodada {
  /** `AAAA-Wss` — o mesmo rótulo da varredura. */
  rotulo: string
  /** Raízes que a varredura trouxe (variação pendurada não conta). */
  trends: number
  /** Trends decididas no radar: roteirizadas + descartadas. */
  decididas: number
  roteirizadas: number
  /** Ainda `nova` — a Teacher Vicky pulou e não decidiu. Fora do denominador. */
  naoDecididas: number
  /** Conversão radar→roteiro: roteirizadas ÷ decididas. `null` = nada decidido. */
  taxaConversao: number | null
  itens: number
  /** Ainda no caminho: ideia · ideia_aprovada · gerando · rascunho. */
  pendentes: number
  /** Portão 2 (snapshot): aprovado = carimbo `approved_at`. */
  aprovadosP2: number
  /** Recusado no P2 = TEM roteiro gerado (`roteiro_original`) e terminou sem
   *  carimbo — rejeitado/descartado/arquivado. Quem morreu ANTES de gerar
   *  roteiro não entra nesta taxa (o P2 nunca aconteceu para ele). */
  recusadosP2: number
  /** Denominador da reescrita: aprovados com o original guardado. */
  comOriginalAprovado: number
  reescritasPesadas: number
  /** Os `rejection_reason` registrados na rodada — insumo editorial. */
  motivos: string[]
  /**
   * Fechada = a varredura SEGUINTE já rodou e nenhum roteiro desta rodada ficou
   * pendente. Trend que a Teacher Vicky pulou sem decidir NÃO segura a rodada: ela não é
   * obrigada a descartar o que não interessa, e exigir isso deixaria a régua
   * muda para sempre (decisão do dono, 03/08). A não-decisão aparece na tabela.
   */
  fechada: boolean
}

export interface ResumoPorRodadas {
  /** Roteiros na coorte (nascidos de trend). */
  total: number
  /** Raízes capturadas em todas as rodadas — o estoque do radar. */
  totalTrends: number
  /** Mais recente primeiro. */
  rodadas: Rodada[]
  rodadasFechadas: number
  /** Agregados SÓ das rodadas fechadas — é sobre elas que a régua fala. */
  aprovadosP2: number
  decididosP2: number
  taxaAprovacaoP2: number | null
  comOriginalAprovado: number
  reescritasPesadas: number
  taxaReescritaPesada: number | null
  /** Conversão agregada das rodadas fechadas — INSUMO, sem limiar combinado. */
  decididasNoRadar: number
  roteirizadas: number
  taxaConversao: number | null
  /** null = ainda sem veredito (rodadas fechadas de menos, ou P2 sem decisão). */
  veredito: 'escala' | 'congela' | null
}

function original(post: PostDaCoorte): string | null {
  const v = post.generation_meta?.roteiro_original
  return typeof v === 'string' && v.trim() ? v : null
}

const PENDENTE = new Set(['ideia', 'ideia_aprovada', 'gerando', 'rascunho'])
const FECHADO_SEM_CARIMBO = new Set(['rejeitado', 'descartado', 'arquivado', 'ciclo_futuro'])

/**
 * O retrato POR RODADA do funil do radar (Leva 6.1, ADR-036).
 *
 * A coorte é o que o ROBÔ trouxe: roteiro nascido de uma trend. Roteiro avulso
 * (sem trend) fica de fora — ele não mede a esteira. O histórico do Portão 1
 * (`external_ref` com `pauta:`) também sai: aquele funil deixou de existir com
 * o cutover, e a série recomeça no radar (ADR-036 §4 — troca de INSTRUMENTO,
 * nenhum limiar mexido depois de medido).
 *
 * A rodada de um roteiro é a semana da TREND, não a da geração: a pergunta é
 * "o que a varredura da semana X rendeu", e o roteiro pode sair dias depois.
 */
export function resumoPorRodadas(
  posts: readonly PostDaCoorte[],
  trends: readonly TrendDaRodada[] = [],
  regra: RegraPorRodada = REGRA_POR_RODADA,
): ResumoPorRodadas {
  const coorte = posts.filter((p) => p.trend !== null)
  const raizes = trends.filter((t) => t.variacao_de === null)

  const porRodada = new Map<string, PostDaCoorte[]>()
  for (const p of coorte) {
    const r = p.trend!.semana
    porRodada.set(r, [...(porRodada.get(r) ?? []), p])
  }
  const trendsPorRodada = new Map<string, TrendDaRodada[]>()
  for (const t of raizes) {
    trendsPorRodada.set(t.semana, [...(trendsPorRodada.get(t.semana) ?? []), t])
  }

  // União: rodada pode ter trends sem roteiro nenhum (tudo descartado) e — se a
  // janela de leitura do radar for menor que a dos posts — roteiro sem a trend
  // na mão. Nenhum dos dois pode sumir da tabela.
  const rotulos = [...new Set([...porRodada.keys(), ...trendsPorRodada.keys()])].sort((a, b) =>
    a < b ? 1 : -1,
  )
  const maisNova = rotulos[0] ?? ''

  const rodadas: Rodada[] = rotulos
    .map((rotulo) => ({ rotulo, itens: porRodada.get(rotulo) ?? [] }))
    .map(({ rotulo, itens }) => {
      const pendentes = itens.filter((p) => PENDENTE.has(p.status))
      const aprovados = itens.filter((p) => p.approved_at !== null)
      const recusados = itens.filter(
        (p) => p.approved_at === null && original(p) !== null && FECHADO_SEM_CARIMBO.has(p.status),
      )
      const comOriginal = aprovados.filter((p) => original(p) !== null)
      const pesadas = comOriginal.filter(
        (p) => percentualDeReescrita(original(p)!, p.roteiro ?? '') > regra.reescritaPesadaAcimaDe,
      )
      const motivos = itens
        .map((p) => (typeof p.rejection_reason === 'string' ? p.rejection_reason.trim() : ''))
        .filter((m) => m !== '')
      const daRodada = trendsPorRodada.get(rotulo) ?? []
      const roteirizadas = daRodada.filter((t) => t.status === 'roteirizada').length
      const descartadas = daRodada.filter((t) => t.status === 'descartada').length
      const decididas = roteirizadas + descartadas
      return {
        rotulo,
        trends: daRodada.length,
        decididas,
        roteirizadas,
        naoDecididas: daRodada.length - decididas,
        taxaConversao: decididas === 0 ? null : Math.round((roteirizadas / decididas) * 1000) / 10,
        itens: itens.length,
        pendentes: pendentes.length,
        aprovadosP2: aprovados.length,
        recusadosP2: recusados.length,
        comOriginalAprovado: comOriginal.length,
        reescritasPesadas: pesadas.length,
        motivos,
        fechada: rotulo < maisNova && pendentes.length === 0,
      }
    })

  const fechadas = rodadas.filter((r) => r.fechada)
  const aprovadosP2 = fechadas.reduce((s, r) => s + r.aprovadosP2, 0)
  const decididosP2 = aprovadosP2 + fechadas.reduce((s, r) => s + r.recusadosP2, 0)
  const comOriginalAprovado = fechadas.reduce((s, r) => s + r.comOriginalAprovado, 0)
  const reescritasPesadas = fechadas.reduce((s, r) => s + r.reescritasPesadas, 0)

  const taxaAprovacaoP2 =
    decididosP2 === 0 ? null : Math.round((aprovadosP2 / decididosP2) * 1000) / 10
  const taxaReescritaPesada =
    comOriginalAprovado === 0
      ? null
      : Math.round((reescritasPesadas / comOriginalAprovado) * 1000) / 10

  // Conversão radar→roteiro: INSUMO editorial, não critério de veredito. Ela
  // não tem limiar pré-comprometido, e inventar um agora — depois de ver os
  // primeiros números — seria exatamente o retro-ajuste que a régua proíbe.
  const decididasNoRadar = fechadas.reduce((s, r) => s + r.decididas, 0)
  const roteirizadas = fechadas.reduce((s, r) => s + r.roteirizadas, 0)
  const taxaConversao =
    decididasNoRadar === 0 ? null : Math.round((roteirizadas / decididasNoRadar) * 1000) / 10

  // Veredito: 2 rodadas FECHADAS e P2 com decisão. Aprovação reprovada já
  // basta para congelar (0 aprovados dispensa denominador de reescrita);
  // escalar exige as DUAS taxas medidas e dentro da régua.
  let veredito: ResumoPorRodadas['veredito'] = null
  if (fechadas.length >= regra.minimoRodadasFechadas && taxaAprovacaoP2 !== null) {
    if (taxaAprovacaoP2 < regra.aprovacaoMinima) veredito = 'congela'
    else if (taxaReescritaPesada !== null) {
      veredito = taxaReescritaPesada <= regra.reescritaMaxima ? 'escala' : 'congela'
    }
  }

  return {
    total: coorte.length,
    totalTrends: raizes.length,
    rodadas,
    rodadasFechadas: fechadas.length,
    aprovadosP2,
    decididosP2,
    taxaAprovacaoP2,
    comOriginalAprovado,
    reescritasPesadas,
    taxaReescritaPesada,
    decididasNoRadar,
    roteirizadas,
    taxaConversao,
    veredito,
  }
}
