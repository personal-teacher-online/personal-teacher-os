// ADR-022 (Estágio 0) — busca candidatos de vídeo no YouTube para os slides
// de listening e grava em `listening.candidates` no JSON da aula.
// A query vem de `listening.videoHint` (trecho entre aspas) ou é passada na
// linha de comando. Filtros: com legenda, <4 min, inglês, embeddable.
// Uso: node --env-file=.env.local scripts/slides/find-videos.ts content/personal-travel/m5a1.json ["query opcional"]
// Requer YOUTUBE_API_KEY (API key simples do console Google Cloud).
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LessonSchema } from '../../src/lib/slides/lesson-schema.ts'

const key = process.env.YOUTUBE_API_KEY
if (!key) {
  console.error('YOUTUBE_API_KEY ausente no ambiente (.env.local).')
  process.exit(1)
}
const input = process.argv[2]
if (!input) {
  console.error('Uso: node --env-file=.env.local scripts/slides/find-videos.ts <aula.json> ["query"]')
  process.exit(1)
}

const path = resolve(input)
const doc = LessonSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
const listening = doc.slides.find((s) => s.type === 'listening')
if (!listening || listening.type !== 'listening') {
  console.error('A aula não tem slide de listening.')
  process.exit(1)
}

const hinted = listening.videoHint?.match(/[“"]([^”"]+)[”"]/)?.[1]
const query = process.argv[3] ?? hinted
if (!query) {
  console.error('Sem query: passe na linha de comando ou deixe uma sugestão entre aspas no videoHint.')
  process.exit(1)
}

// decisão do mantenedor (20/07, noite): SEM filtros de views/idade/duração —
// a curadoria é humana (preferência da Teacher Vicky: pessoas reais, não animação;
// simulações reais do tópico). Mantidos apenas os técnicos: embeddable
// (precisa tocar dentro do Slides) e safeSearch.
const params = new URLSearchParams({
  part: 'snippet',
  q: query,
  type: 'video',
  maxResults: '25',
  videoEmbeddable: 'true',
  relevanceLanguage: 'en',
  safeSearch: 'strict',
  key,
})
const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`)
if (!res.ok) {
  console.error(`YouTube API ${res.status}: ${await res.text()}`)
  process.exit(1)
}
type SearchItem = {
  id: { videoId: string }
  snippet: { title: string; channelTitle: string; publishedAt: string }
}
const data = (await res.json()) as { items: SearchItem[] }
if (!data.items.length) {
  console.error('Nenhum resultado na busca — afrouxe a query.')
  process.exit(1)
}

// views via videos.list (1 unidade) — informativo, não é filtro
const ids = data.items.map((i) => i.id.videoId).join(',')
const statsRes = await fetch(
  `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: 'statistics', id: ids, key })}`
)
if (!statsRes.ok) {
  console.error(`YouTube API (videos) ${statsRes.status}: ${await statsRes.text()}`)
  process.exit(1)
}
const stats = (await statsRes.json()) as { items: Array<{ id: string; statistics: { viewCount: string } }> }
const viewsById = new Map(stats.items.map((v) => [v.id, Number(v.statistics.viewCount ?? 0)]))

const ranked = data.items
  .map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
    views: viewsById.get(item.id.videoId) ?? 0,
  }))
  .sort((a, b) => b.views - a.views)
listening.candidates = ranked.slice(0, 5)
writeFileSync(path, JSON.stringify(doc, null, 2) + '\n')
console.log(`✓ ${listening.candidates.length} candidatos para "${query}":`)
for (const c of listening.candidates) {
  const views = c.views ? `${Math.round(c.views / 1000)}k views` : 'views n/d'
  const year = c.publishedAt?.slice(0, 4) ?? '?'
  console.log(`  - [${views}, ${year}] ${c.title} (${c.channel}) → https://www.youtube.com/watch?v=${c.videoId}`)
}
