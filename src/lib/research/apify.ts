// PESQUISA DE PAUTA — o motor do Apify (M5).
//
// Instagram, TikTok e X não têm API pública que sirva: o caminho é scraping por
// ator do Apify. Este arquivo é o motor comum — rodar, esperar, guardar o bruto,
// estimar custo — e cada rede tem seu tradutor (`instagram.ts`, `tiktok.ts`,
// `x.ts`), porque a forma do JSON é diferente em cada uma e cada ator pode
// quebrar sozinho.
//
// ── POR QUE O TRADUTOR É TOLERANTE, E NÃO UM SCHEMA RÍGIDO ──────────────────
// Ator de scraping muda de chave sem avisar (é a natureza do ofício: a rede
// muda a casa, o ator corre atrás). Schema rígido transformaria isso em corrida
// morta; schema nenhum gravaria lixo no banco. O meio: exigir o MÍNIMO (um id e
// uma URL utilizáveis) e aceitar sinônimos para o resto (`playCount` ou
// `viewCount` ou `videoPlayCount`). O que não tiver o mínimo é DESCARTADO COM
// LOG — drift aparece no terminal, nunca no banco.
//
// ADR-031 (adendo 01/08): o bruto devolvido pelo ator é guardado em
// `_rascunhos/research-raw/` e não é apagado nunca — é ele que explica um drift
// depois.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { APIFY_TIMEOUT_S, PASTA_BRUTO, type AtorApify } from './config.ts'
import { numero } from './tipos.ts'

export interface CorridaApify {
  /** rótulo da corrida — vira subpasta do bruto */
  corrida: string
  token: string
  /** somatório para o relatório do fim */
  custo: { estimadoUsd: number; itens: number }
}

/** A estimativa IMPRESSA ANTES (informação, nunca trava — decisão do dono). */
export function estimativaUsd(ator: AtorApify, itensPedidos: number): number {
  return (itensPedidos / 1000) * ator.usdPorMil
}

/**
 * Roda um ator e devolve os itens do dataset.
 *
 * `run-sync-get-dataset-items` é o endpoint que espera a corrida terminar e já
 * devolve o resultado — sem ele seriam três chamadas (start, poll, fetch) e um
 * estado a gerenciar. O timeout do lado do Apify devolve o que já colheu, então
 * corrida longa degrada em menos itens, não em erro.
 */
export async function rodarAtor(
  ator: AtorApify,
  entrada: Record<string, unknown>,
  ctx: CorridaApify,
  rotulo: string,
): Promise<unknown[]> {
  const url =
    `https://api.apify.com/v2/acts/${ator.id}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(ctx.token)}&timeout=${APIFY_TIMEOUT_S}`

  let ultimoErro = ''
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    let r: Response
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entrada),
        signal: AbortSignal.timeout((APIFY_TIMEOUT_S + 60) * 1000),
      })
    } catch (e) {
      ultimoErro = (e as Error).message
      await esperar(3000 * tentativa)
      continue
    }

    if (r.ok) {
      const itens = (await r.json().catch(() => [])) as unknown[]
      const lista = Array.isArray(itens) ? itens : []
      guardarBruto(ctx, rotulo, lista)
      ctx.custo.itens += lista.length
      ctx.custo.estimadoUsd += estimativaUsd(ator, lista.length)
      return lista
    }

    ultimoErro = `HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`
    // 4xx que não seja 429 é erro de pedido (ator errado, input inválido):
    // repetir não conserta e só gasta tempo.
    if (r.status < 500 && r.status !== 429) break
    await esperar(3000 * tentativa)
  }
  throw new Error(`Apify ${ator.id} (${rotulo}): ${ultimoErro}`)
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** O bruto fica em disco — nada se apaga (ADR-031, adendo 01/08). */
function guardarBruto(ctx: CorridaApify, rotulo: string, itens: unknown[]): void {
  const dir = join(process.cwd(), PASTA_BRUTO, ctx.corrida)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${rotulo}.json`), JSON.stringify(itens, null, 2))
}

/* ========================================================================== */
/* O tradutor tolerante                                                        */
/* ========================================================================== */

export type Bruto = Record<string, unknown>

/** É objeto? (item de dataset pode vir como string de erro do próprio ator) */
export function ehObjeto(x: unknown): x is Bruto {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** O primeiro caminho que existir — `campo(item, 'playCount', 'videoPlayCount')`. */
export function campo(item: Bruto, ...caminhos: string[]): unknown {
  for (const caminho of caminhos) {
    let atual: unknown = item
    for (const parte of caminho.split('.')) {
      if (!ehObjeto(atual)) {
        atual = undefined
        break
      }
      atual = atual[parte]
    }
    if (atual !== undefined && atual !== null && atual !== '') return atual
  }
  return undefined
}

export function texto(item: Bruto, ...caminhos: string[]): string {
  const v = campo(item, ...caminhos)
  return typeof v === 'string' ? v : ''
}

export function numeroDe(item: Bruto, ...caminhos: string[]): number {
  return numero(campo(item, ...caminhos))
}

/** Data em qualquer formato que os atores usam (ISO, epoch s, epoch ms). */
export function dataDe(item: Bruto, ...caminhos: string[]): string | null {
  const v = campo(item, ...caminhos)
  if (typeof v === 'string') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Epoch em segundos vira milissegundos; o corte de 10^11 separa os dois
    // sem ambiguidade até o ano 5138.
    const ms = v < 1e11 ? v * 1000 : v
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}
