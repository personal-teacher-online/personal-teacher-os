// PESQUISA DE PAUTA — o vocabulário comum (M5).
//
// O que atravessa todo o pipeline: a forma normalizada de um item vindo de
// QUALQUER rede, os endereços (`source_key`) que o banco usa como identidade, e
// as duas funções de parsing que já erraram antes (duração ISO-8601 e semana).
//
// Módulo PURO: sem rede, sem banco, sem env. É ele que `tests/research-logica`
// prova — e é de propósito que a chave do banco nasça aqui, e não espalhada em
// template string dentro de cada coletor.

import { DateTime } from 'luxon'

import type { Rede } from './config.ts'

/* ========================================================================== */
/* O item normalizado                                                          */
/* ========================================================================== */

/**
 * O que sobra de um post depois que a forma de cada rede é descascada. Cada
 * coletor devolve isto; o filtro, a análise e o registro só conhecem isto.
 *
 * `metricas` é o que foi MEDIDO na plataforma (público) — nunca inferência.
 * A separação é a mesma das duas colunas do banco (lição do A5).
 */
export interface ItemDaPesquisa {
  rede: Rede
  /** id externo, como a rede o chama (vídeo, post, tweet, thread) */
  id: string
  url: string
  titulo: string
  /** @handle ou nome do autor na rede; string vazia quando a fonte não expõe */
  autor: string
  publicadoEm: string | null
  /** só onde existe vídeo; null em texto (X, Reddit) */
  duracaoS: number | null
  metricas: Record<string, number>
  /** o que o post É na rede: 'video' | 'carrossel' | 'imagem' | 'texto' */
  formato?: string
  /** URL direta do arquivo de vídeo, quando o coletor a conhece (IG/TikTok) */
  midiaUrl?: string
}

/** O engajamento comparável entre redes: o maior número público disponível. */
export function engajamento(item: ItemDaPesquisa): number {
  const { views, likes, comentarios, upvotes } = item.metricas
  return Math.max(views ?? 0, upvotes ?? 0, likes ?? 0, comentarios ?? 0)
}

/* ========================================================================== */
/* Endereços (`source_key`) — a identidade no banco                            */
/* ========================================================================== */

/**
 * A SEMANA ISO da corrida, em UTC (`2026-W31`).
 *
 * Por que a semana entra no endereço dos trends: sem ela, `trends:<rede>` seria
 * um endereço eterno e a segunda corrida receberia de volta o resultado da
 * primeira — a pesquisa CONGELAVA e `--force` viraria rotina. Com a janela,
 * semana nova é fonte nova (nasce sozinha) e `--force` volta a significar o que
 * deve: refazer a MESMA janela. (Achado das 3 revisões do plano, 01/08.)
 */
export function semanaIso(quando: DateTime = DateTime.utc()): string {
  const d = quando.setZone('utc')
  return `${d.weekYear}-W${String(d.weekNumber).padStart(2, '0')}`
}

/** O endereço de um reel: a identidade é o próprio vídeo, estável para sempre. */
export function chaveDoReel(rede: Rede, id: string): string {
  return `reel:${rede}:${id}`
}

/** O endereço de um apanhado de trends: rede + janela semanal. */
export function chaveDosTrends(rede: Rede, semana: string = semanaIso()): string {
  return `trends:${rede}:${semana}`
}

/* ========================================================================== */
/* Parsing que já mordeu antes                                                 */
/* ========================================================================== */

/** ISO-8601 de duração do YouTube (`PT1M30S`) → segundos. `NaN` se não casar. */
export function duracaoEmSegundos(iso: string | undefined | null): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '')
  if (!m) return Number.NaN
  const [, d, h, min, s] = m
  const total =
    Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0)
  // `P` sozinho casa no regex e daria 0 — duração 0 não existe em vídeo.
  return total > 0 ? total : Number.NaN
}

/** Número que veio como string, com pontuação ou `undefined`. Sem número → 0. */
export function numero(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const limpo = Number(v.replace(/[^\d.-]/g, ''))
    return Number.isFinite(limpo) ? limpo : 0
  }
  return 0
}

/* ========================================================================== */
/* Métricas de criador (o snapshot do M4)                                      */
/* ========================================================================== */

/**
 * As CHAVES do snapshot são texto de tela.
 *
 * A ficha da Pauta imprime `${chave} ${valor}` sem traduzir nada — decisão
 * medida no M4, quando a "humanização" automática fabricou "views medias",
 * português que ninguém escreveu. Quem escolhe a palavra legível é quem nomeia
 * a métrica, e esse alguém é este arquivo. Por isso as chaves têm espaço e
 * acento: elas são a frase.
 */
export function snapshotDoCriador(
  numeros: Record<string, number | null | undefined>,
): Record<string, number> {
  const limpo: Record<string, number> = {}
  for (const [chave, valor] of Object.entries(numeros)) {
    if (typeof valor === 'number' && Number.isFinite(valor)) limpo[chave] = valor
  }
  return limpo
}

/** A mediana (não a média): um viral solitário não deve descrever o canal. */
export function mediana(valores: readonly number[]): number {
  if (!valores.length) return 0
  const ordenados = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(ordenados.length / 2)
  return ordenados.length % 2
    ? ordenados[meio]
    : Math.round((ordenados[meio - 1] + ordenados[meio]) / 2)
}
