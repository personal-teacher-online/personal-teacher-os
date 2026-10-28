// Exportação de todas as telas em PNG (produção) — desktop + celular.
// Uso: node export-screens.mjs --role=admin|teacher|portal|sales|publico
// O Chrome abre visível; o mantenedor faz o login; o script espera sair de /login
// e fotografa página inteira em 1440px e 390px. Sessão fica em cache local
// (45 min) para re-execuções não pedirem login de novo.
// Captura com reducedMotion (congela o fog — modo suportado pelo app) para a
// fullPage não travar esperando animação assentar.
import { chromium } from 'playwright'
import { mkdirSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://app.personal-teacher.com'
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'qa/prints/site-export-2026-07-16')
const STATE_DIR = process.env.EXPORT_STATE_DIR ?? path.join(os.tmpdir(), 'export-screens')
const role = (process.argv.find((a) => a.startsWith('--role=')) ?? '--role=admin').split('=')[1]

const PAGES = {
  publico: [
    ['01-login', '/login'],
    ['02-recuperar-senha', '/recuperar-senha'],
    ['03-definir-senha', '/definir-senha'],
  ],
  admin: [
    ['01-home', '/admin'],
    ['02-agenda-semana', '/admin/agenda'],
    ['03-agenda-mes', '/admin/agenda?v=mes'],
    ['04-agenda-dia', '/admin/agenda?v=dia'],
    ['05-agenda-lista', '/admin/agenda?v=lista'],
    ['06-agenda-semana-janelas', '/admin/agenda?j=1'],
    ['07-alunos', '/admin/alunos'],
    ['08-aluno-ficha', '{first:/admin/alunos/}'],
    ['09-avisos', '/admin/avisos'],
    ['10-contratos', '/admin/alunos/contratos'],
    ['11-janelas', '/admin/janelas'],
    ['12-mentoria', '/admin/mentoria'],
    ['13-pagamentos', '/admin/pagamentos'],
    ['14-professoras', '/admin/professoras'],
    ['15-relatorios', '/admin/relatorios'],
    ['16-relatorio-aberto', '{first:/admin/relatorios/}'],
  ],
  teacher: [['01-painel', '/teacher']],
  portal: [
    ['01-home', '/portal'],
    ['02-mentoria', '/portal/mentoria'],
    ['03-remarcar', '{first:/portal/remarcar/}'],
    ['04-resgatar', '{first:/portal/resgatar/}'],
  ],
  sales: [['01-leads', '/sales']],
}

const pages = PAGES[role]
if (!pages) {
  console.error(`role desconhecido: ${role}. Use: ${Object.keys(PAGES).join(' | ')}`)
  process.exit(1)
}

const VIEWPORTS = [
  ['desktop', { width: 1440, height: 900 }],
  ['celular', { width: 390, height: 844 }],
]

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: false })

let state = null
const stateFile = path.join(STATE_DIR, `pt-session-${role}.json`)
if (role !== 'publico') {
  const fresh = existsSync(stateFile) && Date.now() - statSync(stateFile).mtimeMs < 45 * 60_000
  if (fresh) {
    state = JSON.parse(readFileSync(stateFile, 'utf8'))
    log(`sessão reaproveitada de ${stateFile}`)
  } else {
    const loginCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const loginPage = await loginCtx.newPage()
    await loginPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    log(`>>> FAÇA O LOGIN na janela do Chrome com a conta do perfil "${role}" (espero até 5 min)…`)
    await loginPage.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 300_000 })
    await loginPage.waitForLoadState('networkidle').catch(() => {})
    log(`login ok — sessão em ${loginPage.url()}`)
    state = await loginCtx.storageState()
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
    writeFileSync(stateFile, JSON.stringify(state))
    await loginCtx.close()
  }
}

const firstLinks = new Map()

for (const [vpName, viewport] of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
    storageState: state ?? undefined,
    ...(vpName === 'celular' ? { isMobile: true, hasTouch: true } : {}),
  })
  const page = await ctx.newPage()
  const dir = path.join(OUT, role, vpName)
  mkdirSync(dir, { recursive: true })

  for (const [slug, target] of pages) {
    let url = target
    const m = target.match(/^\{first:(.+)\}$/)
    if (m) {
      const prefix = m[1]
      if (!firstLinks.has(prefix)) {
        const listUrl = { '/admin/alunos/': '/admin/alunos', '/admin/relatorios/': '/admin/relatorios', '/portal/remarcar/': '/portal', '/portal/resgatar/': '/portal' }[prefix]
        await page.goto(BASE + listUrl, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {})
        const href = await page.evaluate((p) => {
          const a = [...document.querySelectorAll(`a[href^="${p}"]`)].find((el) => el.getAttribute('href').length > p.length)
          return a ? a.getAttribute('href') : null
        }, prefix)
        firstLinks.set(prefix, href)
      }
      url = firstLinks.get(prefix)
      if (!url) {
        log(`~ ${slug}: nenhum link ${m[1]} encontrado — pulado`)
        continue
      }
    }
    try {
      await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 45_000 })
    } catch {
      log(`~ ${slug}: networkidle estourou, seguindo com o que carregou`)
    }
    await page.waitForTimeout(1000)
    const file = path.join(dir, `${slug}.png`)
    try {
      await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide', timeout: 60_000 })
      log(`✓ ${role}/${vpName}/${slug}.png  (${page.url()})`)
    } catch (e) {
      log(`✗ ${slug} FALHOU: ${String(e).split('\n')[0]} — seguindo`)
    }
  }
  await ctx.close()
}

await browser.close()
log(`FIM — ${role} exportado em ${OUT}/${role}/`)
