// PESQUISA DE PAUTA — YouTube Data API (M5).
//
// Duas coisas: (a) o que os CRIADORES cadastrados publicaram de curto — vira
// snapshot de métricas na ficha + candidatos a análise; (b) o que a BUSCA
// devolve de recente e visto — vira o apanhado de trends da semana.
//
// Herda o miolo do spike M2.0 (`scripts/spike-pauta/spike-pauta.ts`), que já
// pagou o preço de descobrir que `forHandle` não resolve handle inventado e que
// varrer uploads é mais confiável que confiar no `search` para um canal.
//
// Custo: chave grátis, cota diária de 10.000 unidades. Um criador custa ~4
// unidades; uma busca custa 100 (o `search.list` é o item caro do YouTube).

import { z } from 'zod'

import { MAX_SEGUNDOS, TOP_POR_FONTE, UPLOADS_VARRIDOS } from './config.ts'
import { duracaoEmSegundos, numero, type ItemDaPesquisa } from './tipos.ts'

const BASE = 'https://www.googleapis.com/youtube/v3'

/** A borda externa passa por Zod: shape inesperado morre AQUI, com log. */
const VideoSchema = z.object({
  id: z.union([z.string(), z.object({ videoId: z.string() })]),
  snippet: z.object({
    title: z.string(),
    publishedAt: z.string().optional(),
    channelTitle: z.string().optional(),
  }),
  contentDetails: z.object({ duration: z.string() }).optional(),
  statistics: z.record(z.string(), z.unknown()).optional(),
})

export interface QuotaGasta {
  unidades: number
}

async function pegar(
  caminho: string,
  chave: string,
  quota: QuotaGasta,
  custo: number,
): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}/${caminho}&key=${chave}`)
  quota.unidades += custo
  const corpo = (await r.json().catch(() => ({}))) as Record<string, unknown>
  if (!r.ok) {
    const erro = (corpo.error as { message?: string } | undefined)?.message ?? `HTTP ${r.status}`
    throw new Error(`YouTube ${caminho.split('?')[0]}: ${erro}`)
  }
  return corpo
}

function idDoVideo(v: z.infer<typeof VideoSchema>): string {
  return typeof v.id === 'string' ? v.id : v.id.videoId
}

/** Descasca a forma do YouTube até o item comum — descarta o que não valida. */
function normalizar(brutos: unknown[], avisos: string[]): ItemDaPesquisa[] {
  const itens: ItemDaPesquisa[] = []
  for (const bruto of brutos) {
    const lido = VideoSchema.safeParse(bruto)
    if (!lido.success) {
      avisos.push(`item do YouTube com forma inesperada: ${lido.error.issues[0]?.message}`)
      continue
    }
    const v = lido.data
    const dur = v.contentDetails ? duracaoEmSegundos(v.contentDetails.duration) : Number.NaN
    const est = v.statistics ?? {}
    itens.push({
      rede: 'youtube',
      id: idDoVideo(v),
      url: `https://www.youtube.com/watch?v=${idDoVideo(v)}`,
      titulo: v.snippet.title,
      autor: v.snippet.channelTitle ?? '',
      publicadoEm: v.snippet.publishedAt ?? null,
      duracaoS: Number.isFinite(dur) ? dur : null,
      metricas: {
        views: numero(est.viewCount),
        likes: numero(est.likeCount),
        comentarios: numero(est.commentCount),
      },
    })
  }
  return itens
}

export interface CanalDoYoutube {
  playlistUploads: string
  inscritos: number
}

export async function canalPorHandle(
  handle: string,
  chave: string,
  quota: QuotaGasta,
): Promise<CanalDoYoutube> {
  const corpo = await pegar(
    `channels?part=contentDetails,statistics&forHandle=${encodeURIComponent(handle)}`,
    chave,
    quota,
    1,
  )
  const itens = corpo.items as
    | Array<{
        contentDetails: { relatedPlaylists: { uploads: string } }
        statistics: { subscriberCount?: string }
      }>
    | undefined
  if (!itens?.length) {
    // A medição do M4 já provou que handle que eu "dava como certo" não existe:
    // 8 de 24 não resolviam. Erro claro, nunca adivinhação.
    throw new Error(`@${handle} não resolve no YouTube — confira o handle no cadastro`)
  }
  return {
    playlistUploads: itens[0].contentDetails.relatedPlaylists.uploads,
    inscritos: numero(itens[0].statistics.subscriberCount),
  }
}

/** Os vídeos CURTOS recentes de um canal, do mais visto para o menos. */
export async function curtosDoCanal(
  playlist: string,
  chave: string,
  quota: QuotaGasta,
  avisos: string[],
): Promise<ItemDaPesquisa[]> {
  const ids: string[] = []
  let pagina: string | undefined
  while (ids.length < UPLOADS_VARRIDOS) {
    const q = new URLSearchParams({
      part: 'contentDetails',
      playlistId: playlist,
      maxResults: '50',
    })
    if (pagina) q.set('pageToken', pagina)
    const r = await pegar(`playlistItems?${q}`, chave, quota, 1)
    const lote = (r.items as Array<{ contentDetails?: { videoId?: string } }>) ?? []
    for (const i of lote) if (i.contentDetails?.videoId) ids.push(i.contentDetails.videoId)
    pagina = r.nextPageToken as string | undefined
    if (!pagina || !lote.length) break
  }

  const brutos: unknown[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const r = await pegar(
      `videos?part=snippet,contentDetails,statistics&id=${ids.slice(i, i + 50).join(',')}`,
      chave,
      quota,
      1,
    )
    brutos.push(...((r.items as unknown[]) ?? []))
  }

  return normalizar(brutos, avisos)
    .filter((v) => v.duracaoS !== null && v.duracaoS <= MAX_SEGUNDOS)
    .sort((a, b) => (b.metricas.views ?? 0) - (a.metricas.views ?? 0))
}

/**
 * A busca de trends. `search.list` devolve só ids; os números vêm de um
 * `videos.list` em cima — sem essa segunda ida, `views` viria vazio e o filtro
 * por engajamento não teria o que morder.
 */
export async function trendsDoYoutube(
  buscas: readonly string[],
  chave: string,
  quota: QuotaGasta,
  avisos: string[],
  dias = 30,
): Promise<ItemDaPesquisa[]> {
  const desde = new Date(Date.now() - dias * 86400_000).toISOString()
  const ids: string[] = []

  for (const termo of buscas) {
    const q = new URLSearchParams({
      part: 'id',
      type: 'video',
      videoDuration: 'short',
      order: 'viewCount',
      publishedAfter: desde,
      maxResults: String(TOP_POR_FONTE),
      q: termo,
    })
    const r = await pegar(`search?${q}`, chave, quota, 100)
    for (const i of ((r.items as Array<{ id?: { videoId?: string } }>) ?? [])) {
      if (i.id?.videoId) ids.push(i.id.videoId)
    }
  }

  if (!ids.length) return []
  const unicos = [...new Set(ids)]
  const brutos: unknown[] = []
  for (let i = 0; i < unicos.length; i += 50) {
    const r = await pegar(
      `videos?part=snippet,contentDetails,statistics&id=${unicos.slice(i, i + 50).join(',')}`,
      chave,
      quota,
      1,
    )
    brutos.push(...((r.items as unknown[]) ?? []))
  }
  return normalizar(brutos, avisos).filter(
    (v) => v.duracaoS !== null && v.duracaoS <= MAX_SEGUNDOS,
  )
}
