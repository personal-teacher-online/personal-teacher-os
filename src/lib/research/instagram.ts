// PESQUISA DE PAUTA — Instagram via Apify (M5).
//
// Duas leituras: os reels de uma hashtag (trends) e o perfil de um criador
// cadastrado (snapshot + reels dele). O tradutor é tolerante por desenho — ver
// o cabeçalho de `apify.ts`.

import { ATORES, PERFIL_ITENS, TOP_POR_FONTE } from './config.ts'
import {
  dataDe,
  ehObjeto,
  numeroDe,
  rodarAtor,
  texto,
  type CorridaApify,
} from './apify.ts'
import { mediana, snapshotDoCriador, type ItemDaPesquisa } from './tipos.ts'

function traduzir(bruto: unknown, avisos: string[]): ItemDaPesquisa | null {
  if (!ehObjeto(bruto)) return null
  const id = texto(bruto, 'shortCode', 'shortcode', 'id')
  if (!id) {
    avisos.push('item do Instagram sem shortCode/id — descartado')
    return null
  }
  const url = texto(bruto, 'url') || `https://www.instagram.com/p/${id}/`
  // O TREND DA HASHTAG NÃO É SÓ REEL — e descartar o resto era mentir sobre o
  // que performa. Medido na 1ª corrida real (01/08): das 60 publicações no topo
  // de #dicasdeingles e vizinhas, a maioria era CARROSSEL, não vídeo. Quem
  // exige vídeo é a etapa de ANÁLISE (só entra item com `midiaUrl`); a coleta
  // registra o que a rede mostra e diz o que cada coisa é.
  const tipo = texto(bruto, 'type', 'productType').toLowerCase()
  const formato = tipo.includes('video') || tipo.includes('clips') || tipo.includes('reel')
    ? 'video'
    : tipo.includes('sidecar') || tipo.includes('carousel')
      ? 'carrossel'
      : tipo
        ? 'imagem'
        : ''
  // `displayUrl` é a CAPA, não o vídeo: usá-la como mídia mandaria uma imagem
  // para o transcritor. Só entra endereço de vídeo de verdade.
  const midia = texto(bruto, 'videoUrl', 'videoUrlNoWatermark')
  return {
    formato: formato || undefined,
    rede: 'instagram',
    id,
    url,
    titulo: texto(bruto, 'caption', 'title').slice(0, 300),
    autor: texto(bruto, 'ownerUsername', 'owner.username'),
    publicadoEm: dataDe(bruto, 'timestamp', 'takenAtTimestamp'),
    duracaoS: numeroDe(bruto, 'videoDuration', 'duration') || null,
    metricas: {
      views: numeroDe(bruto, 'videoPlayCount', 'videoViewCount', 'playCount', 'viewCount'),
      likes: numeroDe(bruto, 'likesCount', 'likeCount'),
      comentarios: numeroDe(bruto, 'commentsCount', 'commentCount'),
    },
    midiaUrl: midia.startsWith('http') ? midia : undefined,
  }
}

export async function trendsDoInstagram(
  hashtags: readonly string[],
  ctx: CorridaApify,
  avisos: string[],
): Promise<ItemDaPesquisa[]> {
  const brutos = await rodarAtor(
    ATORES.instagramBusca,
    { hashtags: [...hashtags], resultsLimit: TOP_POR_FONTE * 2 },
    ctx,
    'instagram-trends',
  )
  return brutos.map((b) => traduzir(b, avisos)).filter((x): x is ItemDaPesquisa => x !== null)
}

export interface PerfilDoInstagram {
  metricas: Record<string, number>
  reels: ItemDaPesquisa[]
}

export async function perfilDoInstagram(
  handle: string,
  ctx: CorridaApify,
  avisos: string[],
): Promise<PerfilDoInstagram> {
  // O ator de REELS devolve uma lista plana de vídeos — não há objeto de
  // perfil, então os números do canal saem dos próprios reels (mesmo desenho
  // do TikTok). Seguidor não vem nesta porta: a ficha mostra o que foi MEDIDO,
  // e inventar um zero de "seguidores" seria afirmação falsa na tela (A5).
  const brutos = await rodarAtor(
    ATORES.instagramPerfil,
    { username: [handle], resultsLimit: PERFIL_ITENS.instagram },
    ctx,
    `instagram-perfil-${handle}`,
  )
  const reels = brutos
    .map((b) => traduzir(b, avisos))
    .filter((x): x is ItemDaPesquisa => x !== null)
    .sort((a, b) => (b.metricas.views ?? 0) - (a.metricas.views ?? 0))

  return {
    // Chaves com espaço e acento porque ELAS SÃO A FRASE da ficha (M4).
    metricas: snapshotDoCriador({
      'reels recentes': reels.length,
      // MEDIANA porque a etiqueta diz mediana (lição do A5: a frase tem de ser
      // verdadeira sobre o número que está do lado dela).
      'views medianas': mediana(reels.map((r) => r.metricas.views ?? 0)),
      'likes medianas': mediana(reels.map((r) => r.metricas.likes ?? 0)),
    }),
    reels,
  }
}
