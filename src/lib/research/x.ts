// PESQUISA DE PAUTA — X via Apify (M5).
//
// A rede diferente das outras três do Apify: aqui NÃO há vídeo para transcrever
// — o banco recusa `analise_reel` em `x` (CHECK `tipo_plataforma`) e o worker
// nem tenta. O que o X dá é o assunto em texto: o que está sendo dito sobre
// aprender inglês nesta semana.

import { ATORES, PERFIL_ITENS, TOP_POR_FONTE } from './config.ts'
import {
  dataDe,
  ehObjeto,
  numeroDe,
  rodarAtor,
  texto,
  type CorridaApify,
} from './apify.ts'
import { snapshotDoCriador, type ItemDaPesquisa } from './tipos.ts'

function traduzir(bruto: unknown, avisos: string[]): ItemDaPesquisa | null {
  if (!ehObjeto(bruto)) return null
  const id = texto(bruto, 'id', 'id_str', 'tweetId')
  if (!id) {
    avisos.push('post do X sem id — descartado')
    return null
  }
  const autor = texto(bruto, 'author.userName', 'author.username', 'username')
  return {
    rede: 'x',
    id,
    url:
      texto(bruto, 'url', 'twitterUrl') ||
      (autor ? `https://x.com/${autor}/status/${id}` : `https://x.com/i/status/${id}`),
    titulo: texto(bruto, 'text', 'full_text').slice(0, 300),
    autor,
    publicadoEm: dataDe(bruto, 'createdAt', 'created_at'),
    duracaoS: null,
    metricas: {
      views: numeroDe(bruto, 'viewCount', 'views'),
      likes: numeroDe(bruto, 'likeCount', 'favorite_count'),
      comentarios: numeroDe(bruto, 'replyCount', 'reply_count'),
      repostagens: numeroDe(bruto, 'retweetCount', 'retweet_count'),
    },
  }
}

export async function trendsDoX(
  buscas: readonly string[],
  ctx: CorridaApify,
  avisos: string[],
): Promise<ItemDaPesquisa[]> {
  const brutos = await rodarAtor(
    ATORES.xBusca,
    { searchTerms: [...buscas], maxItems: TOP_POR_FONTE * 2, sort: 'Top' },
    ctx,
    'x-trends',
  )
  return brutos.map((b) => traduzir(b, avisos)).filter((x): x is ItemDaPesquisa => x !== null)
}

export interface PerfilDoX {
  metricas: Record<string, number>
}

/** Só o snapshot: sem vídeo, não há reel para analisar nesta rede. */
export async function perfilDoX(
  handle: string,
  ctx: CorridaApify,
  avisos: string[],
): Promise<PerfilDoX> {
  const brutos = await rodarAtor(
    ATORES.xPerfil,
    { twitterHandles: [handle], maxItems: PERFIL_ITENS.x },
    ctx,
    `x-perfil-${handle}`,
  )
  const posts = brutos
    .map((b) => traduzir(b, avisos))
    .filter((x): x is ItemDaPesquisa => x !== null)
  const primeiro = brutos.find(ehObjeto)
  return {
    metricas: snapshotDoCriador({
      seguidores: primeiro
        ? numeroDe(primeiro, 'author.followers', 'author.followersCount', 'followers')
        : 0,
      'posts recentes': posts.length,
    }),
  }
}
