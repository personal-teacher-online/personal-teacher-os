// PESQUISA DE PAUTA — a estimativa impressa ANTES da corrida (Leva 1.1).
//
// Informação, nunca trava (decisão do dono). A conta anterior tinha dois
// buracos medidos: um "7" de criadores hardcoded (eram 20) e ZERO menção às
// chamadas de PERFIL do Apify — justamente o custo que cresce com o cadastro
// (na 1ª corrida real, US$ 0,69 dos US$ 1,08 de Apify eram perfis). Aqui a
// estimativa é função PURA do cadastro real e das flags da corrida: o número
// impresso é sobre o que ESTA corrida vai fazer, não sobre uma corrida ideal.

import {
  ATORES,
  BUSCAS,
  PERFIL_ITENS,
  PRECO_HAIKU,
  REDES,
  REDES_COM_VIDEO,
  REDE_ROTULO,
  REELS_ANALISADOS_POR_CRIADOR,
  REELS_ANALISADOS_POR_TREND,
  TOP_POR_FONTE,
  temVideo,
  type AtorApify,
  type Rede,
} from './config.ts'
import { estimativaUsd } from './apify.ts'

/** Tokens de bolso de UMA nota de viagem (prompt + título + trecho → 1 linha). */
const TOKENS_DA_NOTA = { entrada: 1_500, saida: 200 } as const

export interface RecorteDaCorrida {
  /** `--so=criadores|trends` — a etapa que NÃO roda sai da conta. */
  so?: 'criadores' | 'trends'
  /** `--rede=<rede>` — limita os trends a uma rede (criadores não filtram por rede). */
  rede?: Rede
}

export interface EstimativaDaCorrida {
  /** Soma Apify (trends + perfis), em US$. */
  usdApify: number
  /** Teto de reels que viram análise (transcrição + Claude) nesta corrida. */
  reels: number
  /** O quadro por plataforma, pronto para imprimir (uma linha por item). */
  linhas: string[]
}

const usd = (v: number): string => `US$ ${v.toFixed(2)}`

/** As redes onde trend e perfil custam Apify — nas demais a porta é grátis. */
const BUSCA_POR_REDE: Partial<Record<Rede, AtorApify>> = {
  instagram: ATORES.instagramBusca,
  tiktok: ATORES.tiktokBusca,
  x: ATORES.xBusca,
}

const PERFIL_POR_REDE: Partial<Record<Rede, { ator: AtorApify; itens: number }>> = {
  instagram: { ator: ATORES.instagramPerfil, itens: PERFIL_ITENS.instagram },
  tiktok: { ator: ATORES.tiktokPerfil, itens: PERFIL_ITENS.tiktok },
  x: { ator: ATORES.xPerfil, itens: PERFIL_ITENS.x },
}

/**
 * Itens que uma corrida de TRENDS pede numa rede: o teto é POR SEMENTE, e a
 * busca roda uma vez por semente.
 *
 * ── CALIBRAÇÃO DE 04/08/2026 (o número impresso mentia por 63%) ─────────────
 * A conta antiga usava `TOP_POR_FONTE * 2` uma vez por REDE, ignorando que
 * `instagram.ts:67` manda todas as hashtags juntas (`resultsLimit` vale POR
 * hashtag), `x.ts:53` manda todos os termos (`maxItems` por termo) e
 * `tiktok.ts:59` idem (`resultsPerPage`). Medido em produção nas semanas W31 e
 * W32, em `content_research.metricas->>'coletados'`:
 *
 *   | rede      | sementes | previsto antes | medido    |
 *   |-----------|----------|----------------|-----------|
 *   | Instagram | 5        | 20             | 60 e 100  |
 *   | TikTok    | 5        | 20             | 35 e 70   |
 *   | X         | 3        | 20             | 40 e 60   |
 *
 * Com o multiplicador de sementes a estimativa da corrida de 04/08 dá US$ 1,34
 * — exatamente o que a corrida reportou ter gasto. O termo de PERFIL não tinha
 * esse defeito (pede 30, o ator devolveu ~33).
 *
 * Girar as sementes de `BUSCAS` muda o custo, e agora a conta acompanha sozinha.
 */
function itensDaBusca(rede: Rede): number {
  const sementes = rede === 'reddit' ? 0 : (BUSCAS[rede as Exclude<Rede, 'reddit'>]?.length ?? 0)
  return TOP_POR_FONTE * 2 * sementes
}

export function estimativaDaCorrida(
  criadores: readonly { plataforma: Rede }[],
  recorte: RecorteDaCorrida = {},
): EstimativaDaCorrida {
  const linhas: string[] = []
  let usdApify = 0
  let reels = 0

  // ── Trends (custo fixo por corrida, independente do cadastro) ─────────────
  if (recorte.so !== 'criadores') {
    const redesDeBusca = REDES.filter((r) => BUSCA_POR_REDE[r] && (!recorte.rede || r === recorte.rede))
    const usdTrends = redesDeBusca.reduce(
      (soma, r) => soma + estimativaUsd(BUSCA_POR_REDE[r]!, itensDaBusca(r)),
      0,
    )
    const redesComVideo = REDES_COM_VIDEO.filter((r) => !recorte.rede || r === recorte.rede)
    usdApify += usdTrends
    reels += REELS_ANALISADOS_POR_TREND * redesComVideo.length
    const itensDeBusca = redesDeBusca.reduce((n, r) => n + itensDaBusca(r), 0)
    linhas.push(
      `trends: ~${usd(usdTrends)} de Apify — ${itensDeBusca} itens em ` +
        `${redesDeBusca.length} rede(s) de scraping (o teto é por SEMENTE, e são ` +
        `${redesDeBusca.map((r) => `${REDE_ROTULO[r]} ${BUSCAS[r as Exclude<Rede, 'reddit'>].length}`).join(' · ')}); ` +
        'YouTube e Reddit são grátis',
    )
  }

  // ── Criadores (o custo que CRESCE com o cadastro — Leva 1) ────────────────
  if (recorte.so !== 'trends') {
    const porPlataforma = new Map<Rede, number>()
    for (const c of criadores) {
      porPlataforma.set(c.plataforma, (porPlataforma.get(c.plataforma) ?? 0) + 1)
    }
    for (const plataforma of REDES) {
      const n = porPlataforma.get(plataforma)
      if (!n) continue
      const perfil = PERFIL_POR_REDE[plataforma]
      const usdPerfis = perfil ? n * estimativaUsd(perfil.ator, perfil.itens) : 0
      usdApify += usdPerfis
      if (temVideo(plataforma)) reels += REELS_ANALISADOS_POR_CRIADOR * n
      linhas.push(
        `${REDE_ROTULO[plataforma]}: ${n} criador(es) · ` +
          (perfil ? `perfis ~${usd(usdPerfis)} de Apify` : 'API oficial (quota, US$ 0)') +
          (temVideo(plataforma) ? '' : ' · sem reel para analisar'),
      )
    }
    if (porPlataforma.size === 0) linhas.push('criadores: nenhum no recorte desta corrida')
  }

  // ── Radar (Leva 2.2): cada análise nova vira trend com nota de viagem ─────
  if (reels > 0) {
    const usdNotas =
      reels *
      ((TOKENS_DA_NOTA.entrada / 1_000_000) * PRECO_HAIKU.entrada +
        (TOKENS_DA_NOTA.saida / 1_000_000) * PRECO_HAIKU.saida)
    linhas.push(`radar: até ${reels} notas de viagem em Haiku (~${usd(usdNotas)})`)
  }

  return { usdApify, reels, linhas }
}
