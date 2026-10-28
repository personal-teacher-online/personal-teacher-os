// PESQUISA DE PAUTA — TikTok via Apify (M5). Mesmo desenho do Instagram:
// trends por hashtag + perfil de criador cadastrado, tradutor tolerante.

import { ATORES, MAX_SEGUNDOS, PERFIL_ITENS, TOP_POR_FONTE } from './config.ts'
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
  const id = texto(bruto, 'id', 'videoId', 'awemeId')
  if (!id) {
    avisos.push('item do TikTok sem id — descartado')
    return null
  }
  const autor = texto(bruto, 'authorMeta.name', 'author.uniqueId', 'authorName')
  const url =
    texto(bruto, 'webVideoUrl', 'url') ||
    (autor ? `https://www.tiktok.com/@${autor}/video/${id}` : `https://www.tiktok.com/video/${id}`)
  const midia = texto(
    bruto,
    'mediaUrls.0',
    'videoMeta.downloadAddr',
    'videoUrl',
    'videoUrlNoWaterMark',
  )
  return {
    rede: 'tiktok',
    id,
    url,
    titulo: texto(bruto, 'text', 'desc', 'title').slice(0, 300),
    autor,
    publicadoEm: dataDe(bruto, 'createTimeISO', 'createTime', 'createdAt'),
    duracaoS: numeroDe(bruto, 'videoMeta.duration', 'duration') || null,
    metricas: {
      views: numeroDe(bruto, 'playCount', 'stats.playCount', 'viewCount'),
      likes: numeroDe(bruto, 'diggCount', 'stats.diggCount', 'likeCount'),
      comentarios: numeroDe(bruto, 'commentCount', 'stats.commentCount'),
    },
    midiaUrl: midia.startsWith('http') ? midia : undefined,
  }
}

export async function trendsDoTiktok(
  hashtags: readonly string[],
  ctx: CorridaApify,
  avisos: string[],
): Promise<ItemDaPesquisa[]> {
  const brutos = await rodarAtor(
    ATORES.tiktokBusca,
    {
      hashtags: [...hashtags],
      resultsPerPage: TOP_POR_FONTE * 2,
      // MEDIDO (01/08): com `false`, `mediaUrls` volta VAZIO e `videoMeta` só
      // traz `coverUrl` — que é imagem. Sem endereço de vídeo não há o que
      // transcrever, e o TikTok ficaria sem análise nenhuma. O Gemini lê URL
      // do YouTube nativamente, mas não a página do TikTok: aqui o arquivo é
      // obrigatório.
      shouldDownloadVideos: true,
      shouldDownloadCovers: false,
    },
    ctx,
    'tiktok-trends',
  )
  return brutos
    .map((b) => traduzir(b, avisos))
    .filter((x): x is ItemDaPesquisa => x !== null)
    // O TikTok já é curto por natureza, mas o ator devolve vídeo longo também.
    .filter((v) => v.duracaoS === null || v.duracaoS <= MAX_SEGUNDOS)
}

export interface PerfilDoTiktok {
  metricas: Record<string, number>
  reels: ItemDaPesquisa[]
}

export async function perfilDoTiktok(
  handle: string,
  ctx: CorridaApify,
  avisos: string[],
): Promise<PerfilDoTiktok> {
  const brutos = await rodarAtor(
    ATORES.tiktokPerfil,
    {
      profiles: [handle],
      resultsPerPage: PERFIL_ITENS.tiktok,
      shouldDownloadVideos: true, // mesmo motivo do trends: sem arquivo, sem transcrição
      shouldDownloadCovers: false,
    },
    ctx,
    `tiktok-perfil-${handle}`,
  )
  const reels = brutos
    .map((b) => traduzir(b, avisos))
    .filter((x): x is ItemDaPesquisa => x !== null)
    .sort((a, b) => (b.metricas.views ?? 0) - (a.metricas.views ?? 0))

  // O ator do TikTok devolve os dados do autor DENTRO de cada vídeo — não há
  // item separado de perfil, então os seguidores saem do primeiro item.
  const primeiro = brutos.find(ehObjeto)
  return {
    metricas: snapshotDoCriador({
      seguidores: primeiro
        ? numeroDe(primeiro, 'authorMeta.fans', 'author.followerCount', 'authorMeta.followers')
        : 0,
      'vídeos recentes': reels.length,
      'views medianas': mediana(reels.map((r) => r.metricas.views ?? 0)),
    }),
    reels,
  }
}
