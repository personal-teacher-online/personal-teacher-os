// FS-M3 — transcript de um vídeo do YouTube via yt-dlp (ADR-022: rota
// não-oficial, risco ratificado 20/07; a rota timedtext direta voltou vazia
// por exigência de token de origem). O binário vem do pacote do Alpine na
// imagem do app (Dockerfile) ou de YTDLP_PATH no dev local.
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface Json3Event {
  tStartMs?: number
  segs?: Array<{ utf8: string }>
}

/** Linhas "[mm:ss] texto" da legenda em inglês (manual > automática). */
export async function fetchTranscript(videoId: string): Promise<string[]> {
  const bin = process.env.YTDLP_PATH ?? 'yt-dlp'
  const dir = await mkdtemp(join(tmpdir(), 'ptos-tt-'))
  try {
    await run(bin, [
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      'en',
      '--sub-format',
      'json3',
      '-o',
      join(dir, 'tt'),
      `https://www.youtube.com/watch?v=${videoId}`,
    ])
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json3'))
    // Preferência: legenda manual (tt.en.json3) sobre a automática.
    const pick = files.sort((a, b) => a.length - b.length)[0]
    if (!pick) throw new Error('vídeo sem legenda em inglês (nem automática)')
    const data = JSON.parse(await readFile(join(dir, pick), 'utf8')) as { events?: Json3Event[] }
    const lines: string[] = []
    for (const e of data.events ?? []) {
      if (!e.segs) continue
      const text = e.segs.map((g) => g.utf8).join('').replace(/\n/g, ' ').trim()
      if (!text) continue
      const s = Math.round((e.tStartMs ?? 0) / 1000)
      const mm = String(Math.floor(s / 60)).padStart(2, '0')
      const ss = String(s % 60).padStart(2, '0')
      lines.push(`[${mm}:${ss}] ${text}`)
    }
    if (!lines.length) throw new Error('legenda vazia')
    return lines
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += String(d)
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('yt-dlp excedeu 90s'))
    }, 90_000)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(
        err.message.includes('ENOENT')
          ? new Error('yt-dlp não encontrado — instale-o na imagem ou defina YTDLP_PATH')
          : err,
      )
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolvePromise()
      else reject(new Error(`yt-dlp saiu com código ${code}: ${stderr.slice(-400)}`))
    })
  })
}
