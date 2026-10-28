// M-Slides-1 (correções do piloto) — gera os chips de UI dos decks como PNG
// pixel-perfect via Chrome headless: check teal centrado + dígitos 1–9 em
// círculo de tinta. Motivo: glifo de texto dentro de shape descentraliza na
// conversão pptx→Google Slides; imagem não tem esse problema.
// Uso: npm run slides:chips  (roda 1×; PNGs commitados em brand/slides/assets/chips)
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pastaDeMarca } from '../../src/lib/pastas.ts'

const OUT = join(pastaDeMarca(resolve(import.meta.dirname, '../..')), 'slides', 'assets', 'chips')
const WORK = join(tmpdir(), 'pt-chips')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const page = (body: string) => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:256px;height:256px;background:transparent;overflow:hidden}
.c{width:240px;height:240px;margin:8px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.num{font:700 138px/1 "Helvetica Neue",Arial,sans-serif;color:#fff;transform:translateY(-4px)}
</style>${body}`

const CHECK = page(`<div class="c" style="background:#0f9488">
<svg width="128" height="128" viewBox="0 0 128 128"><path d="M26 68 L54 96 L104 40" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`)

const digit = (n: number) => page(`<div class="c" style="background:#17141f"><div class="num">${n}</div></div>`)

async function shoot(html: string, outFile: string): Promise<void> {
  const src = join(WORK, 'chip.html')
  writeFileSync(src, html)
  const proc = spawn(CHROME, [
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--use-mock-keychain',
    '--password-store=basic',
    `--user-data-dir=${join(WORK, 'profile')}`,
    '--window-size=256,256',
    '--hide-scrollbars',
    '--default-background-color=00000000',
    `--screenshot=${outFile}`,
    `file://${src}`,
  ])
  // o Chrome headless às vezes não encerra após gravar — matamos quando o PNG existe
  await new Promise<void>((resolve, reject) => {
    const t0 = Date.now()
    const poll = setInterval(() => {
      if (existsSync(outFile) && statSync(outFile).size > 0) {
        clearInterval(poll)
        setTimeout(() => {
          proc.kill('SIGKILL')
          resolve()
        }, 400)
      } else if (Date.now() - t0 > 30000) {
        clearInterval(poll)
        proc.kill('SIGKILL')
        reject(new Error(`timeout gerando ${outFile}`))
      }
    }, 250)
  })
}

mkdirSync(OUT, { recursive: true })
rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })
await shoot(CHECK, join(OUT, 'chip-check.png'))
console.log('✓ chip-check.png')
for (let n = 1; n <= 9; n++) {
  await shoot(digit(n), join(OUT, `chip-${n}.png`))
  console.log(`✓ chip-${n}.png`)
}
rmSync(WORK, { recursive: true, force: true })
