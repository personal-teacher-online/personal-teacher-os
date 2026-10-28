/**
 * TRIAGEM DE CANDIDATOS À PAUTA (M4) — o filtro de REALIDADE antes do gate.
 *
 * A proposta dos ~20 candidatos não pode ser um palpite bem escrito: o spike
 * M2.0 já mostrou o custo disso ao descobrir, só depois de coletar, que Speak
 * English With Vanessa não tinha UM Short ≤90s em 100 uploads. Handle errado ou
 * canal sem Shorts não é detalhe — é um criador que entra na pauta e não
 * alimenta nada.
 *
 * Este script pergunta ao YouTube o que é verdade sobre cada candidato:
 *   · o handle RESOLVE? (senão o worker do M5 não acha o canal)
 *   · quantos inscritos?
 *   · quantos vídeos ≤90s nos últimos N dias? (o insumo real de reel)
 *
 * Ele NÃO julga mérito editorial — isso é do dono e da Teacher Vicky, no gate. Ele só
 * separa "existe e publica curto" de "não existe" e "só publica longo".
 *
 * Uso: node --env-file=.env.local scripts/spike-pauta/triagem-candidatos.ts
 * Quota: ~3 unidades por candidato (o teto diário é 10.000).
 */

interface Candidato {
  handle: string
  mercado: 'BR' | 'INT'
  /** o que a pauta esperaria aprender com ele — hipótese a confirmar no gate */
  aprender: string
}

/**
 * Os candidatos. Os quatro primeiros vieram do spike M2.0 (escolha do dono) e
 * já têm medição; o resto é proposta desta sessão. Handle que não resolver sai
 * da lista com o motivo escrito — não se cadastra palpite.
 */
const CANDIDATOS: Candidato[] = [
  // ── BR ──────────────────────────────────────────────────────────────────
  { handle: 'carinafragozo', mercado: 'BR', aprender: 'erro comum explicado antes da forma certa; cartelas curtas o vídeo inteiro' },
  { handle: 'mairovergara', mercado: 'BR', aprender: 'método e repetição espaçada; fala direto para quem estuda sozinho' },
  { handle: 'SmallAdvantages', mercado: 'BR', aprender: 'gringo que fala português: contraste de cultura como gancho' },
  { handle: 'inglesnapontadalingua', mercado: 'BR', aprender: 'expressão do dia em formato curtíssimo' },
  { handle: 'englishwithnab', mercado: 'BR', aprender: 'erro de brasileiro em situação real' },
  { handle: 'ingles200horas', mercado: 'BR', aprender: 'meta de estudo como narrativa' },
  { handle: 'inglesdozeroatafluencia', mercado: 'BR', aprender: 'jornada do iniciante' },
  { handle: 'gavinroy', mercado: 'BR', aprender: 'americano corrigindo brasileiro — contraste como formato' },
  { handle: 'teacherlucasborges', mercado: 'BR', aprender: 'aula curta de estrutura' },
  { handle: 'profacarolina', mercado: 'BR', aprender: 'tom de sala de aula em vídeo curto' },
  { handle: 'englishinbrazilcarina', mercado: 'BR', aprender: 'variação de handle a conferir' },
  { handle: 'AmericanoNoBrasil', mercado: 'BR', aprender: 'choque cultural como gancho' },
  // ── INT ─────────────────────────────────────────────────────────────────
  { handle: 'englishwithlucy', mercado: 'INT', aprender: 'dicção clara e uma palavra ocupando a tela inteira' },
  { handle: 'askjackie', mercado: 'INT', aprender: 'pergunta do seguidor como título — a dúvida é o gancho' },
  { handle: 'speakenglishwithvanessa', mercado: 'INT', aprender: 'conversa longa e natural (formato, não reel)' },
  { handle: 'rachelsenglish', mercado: 'INT', aprender: 'fonética visual: boca em close e câmera lenta' },
  { handle: 'mmmenglish', mercado: 'INT', aprender: 'estrutura de aula em 60s, com um ponto só' },
  { handle: 'engvid', mercado: 'INT', aprender: 'quadro branco e didática de professor' },
  { handle: 'bbclearningenglish', mercado: 'INT', aprender: 'produção editorial e séries curtas com identidade' },
  { handle: 'eatsleepdreamenglish', mercado: 'INT', aprender: 'gíria britânica com energia alta' },
  { handle: 'linguamarina', mercado: 'INT', aprender: 'vida real + inglês; gancho pessoal' },
  { handle: 'accentsway', mercado: 'INT', aprender: 'sotaque como identidade, não como defeito' },
  { handle: 'papateachme', mercado: 'INT', aprender: 'humor e personagem para fixar estrutura' },
  { handle: 'SpeakEnglishWithTiffani', mercado: 'INT', aprender: 'ritmo de coach; promessa clara no primeiro segundo' },
  { handle: 'InteractiveEnglish', mercado: 'INT', aprender: 'jogo e interação como formato de reel' },
  { handle: 'LearnEnglishWithTVSeries', mercado: 'INT', aprender: 'clipe de série como matéria-prima da aula' },
]

/** Janela em que "publica curto" ainda quer dizer alguma coisa. */
const DIAS = 90
/** Uploads recentes varridos por canal (o spike usou 100). */
const UPLOADS = 50

const chave = process.env.YOUTUBE_API_KEY
if (!chave) throw new Error('YOUTUBE_API_KEY ausente — rode com --env-file=.env.local')
const base = 'https://www.googleapis.com/youtube/v3'

async function json(url: string, oque: string): Promise<Record<string, unknown>> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${oque}: HTTP ${r.status} — ${(await r.text()).slice(0, 200)}`)
  return (await r.json()) as Record<string, unknown>
}

/** "PT1M23S" → 83 */
function segundos(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso)
  if (!m) return 0
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

interface Linha extends Candidato {
  existe: boolean
  motivo?: string
  inscritos?: number
  curtosRecentes?: number
  ultimoCurto?: string
}

const corte = Date.now() - DIAS * 86_400_000
const linhas: Linha[] = []
let quota = 0

for (const c of CANDIDATOS) {
  process.stdout.write(`▸ @${c.handle} … `)
  try {
    const canal = await json(
      `${base}/channels?part=contentDetails,statistics&forHandle=${c.handle}&key=${chave}`,
      `canal @${c.handle}`,
    )
    quota += 1
    const itens = canal.items as
      | Array<{
          contentDetails: { relatedPlaylists: { uploads: string } }
          statistics: { subscriberCount?: string }
        }>
      | undefined
    if (!itens?.length) {
      console.log('handle NÃO resolve')
      linhas.push({ ...c, existe: false, motivo: 'handle não resolve no YouTube' })
      continue
    }
    const inscritos = Number(itens[0].statistics.subscriberCount ?? 0)
    const playlist = itens[0].contentDetails.relatedPlaylists.uploads

    const ids: string[] = []
    let pagina: string | undefined
    while (ids.length < UPLOADS) {
      const q = new URLSearchParams({
        part: 'contentDetails',
        playlistId: playlist,
        maxResults: '50',
        key: chave,
      })
      if (pagina) q.set('pageToken', pagina)
      const r = await json(`${base}/playlistItems?${q}`, `uploads de @${c.handle}`)
      quota += 1
      const lote = (r.items as Array<{ contentDetails: { videoId: string } }>) ?? []
      ids.push(...lote.map((i) => i.contentDetails.videoId))
      pagina = r.nextPageToken as string | undefined
      if (!pagina || lote.length === 0) break
    }

    let curtos = 0
    let ultimo = ''
    for (let i = 0; i < ids.length; i += 50) {
      const r = await json(
        `${base}/videos?part=contentDetails,snippet&id=${ids.slice(i, i + 50).join(',')}&key=${chave}`,
        `detalhes de @${c.handle}`,
      )
      quota += 1
      for (const v of (r.items as Array<{
        contentDetails: { duration: string }
        snippet: { publishedAt: string }
      }>) ?? []) {
        const dur = segundos(v.contentDetails.duration)
        const quando = Date.parse(v.snippet.publishedAt)
        if (dur > 0 && dur <= 90 && quando >= corte) {
          curtos += 1
          if (!ultimo || quando > Date.parse(ultimo)) ultimo = v.snippet.publishedAt
        }
      }
    }
    console.log(`${inscritos.toLocaleString('pt-BR')} inscritos · ${curtos} curtos/${DIAS}d`)
    linhas.push({
      ...c,
      existe: true,
      inscritos,
      curtosRecentes: curtos,
      ultimoCurto: ultimo ? ultimo.slice(0, 10) : undefined,
    })
  } catch (e) {
    console.log(`ERRO — ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`)
    linhas.push({ ...c, existe: false, motivo: 'erro na consulta' })
  }
}

console.log(`\n=== RESULTADO (quota gasta: ~${quota} de 10.000/dia) ===\n`)
console.log(JSON.stringify(linhas, null, 2))

export {}
