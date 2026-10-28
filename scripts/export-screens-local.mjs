// Screenshots LOCAIS da reforma — headless, login automático com os usuários
// de preview (scripts/preview-logins.ts), mesma convenção de nomes do export
// original. Uso:
//   node scripts/export-screens-local.mjs --role=admin|teacher|portal|publico \
//     [--only=slug1,slug2] [--out=qa/prints/reforma-depois-zero]
// Sem --out, cai na pasta da rodada guiada (compatibilidade). Cada rodada nova
// adapta o mapa PAGES abaixo às suas rotas.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000'
const outArg = (process.argv.find((a) => a.startsWith('--out=')) ?? '').split('=')[1]
const OUT = outArg
  ? path.resolve(outArg)
  : path.resolve('qa/prints/reforma-depois-guiada')
const role = (process.argv.find((a) => a.startsWith('--role=')) ?? '--role=admin').split('=')[1]
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').split('=')[1]?.split(',').filter(Boolean)

const LOGINS = {
  admin: ['teste-senha@local.dev', 'Senha-local-12345'],
  teacher: ['prof-preview@local.dev', 'Preview-12345'],
  portal: ['aluno-preview@local.dev', 'Preview-12345'],
}

/** Onde procurar o link de cada tela de DETALHE ({first:} e {match:}). Sem a
 *  entrada aqui, o slug é pulado com aviso — nunca em silêncio. */
const LISTAS = {
  '/admin/alunos/': '/admin/alunos',
  '/admin/agenda/remarcar/': '/admin/agenda?v=lista',
  '/admin/relatorios/': '/admin/relatorios',
  '/admin/professoras/': '/admin/professoras',
  '/admin/conteudo/': '/admin/conteudo/posts',
  '/admin/conteudo/pauta?painel=editar': '/admin/conteudo/pauta',
  '/portal/remarcar/': '/portal/aulas',
  '/portal/resgatar/': '/portal',
}

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
    ['06-agenda-pendencias', '/admin/agenda?v=pendencias'],
    ['06b-agenda-remarcar', '{first:/admin/agenda/remarcar/}'],
    ['07-alunos', '/admin/alunos'],
    ['08-aluno-ficha', '{first:/admin/alunos/}'],
    ['09-avisos', '/admin/avisos'],
    ['10-contratos', '/admin/alunos/contratos'],
    ['12-mentoria', '/admin/mentoria'],
    ['13-pagamentos', '/admin/pagamentos'],
    ['14-professoras', '/admin/professoras'],
    ['14b-professora-ficha', '{first:/admin/professoras/}'],
    ['15-relatorios', '/admin/relatorios'],
    ['15b-relatorio-detalhe', '{first:/admin/relatorios/}'],
    // 🚦 CUTOVER (Leva 5): `/admin/conteudo` É o radar; a fila de posts desceu
    // para `/admin/conteudo/posts`. Os slugs mantêm os nomes de sempre para as
    // rodadas velhas do loop continuarem comparáveis lado a lado.
    ['16-conteudo', '/admin/conteudo/posts'],
    // `{match:}` e não `{first:}`: o detalhe do reel precisa ser SEMPRE o mesmo
    // post entre rodadas, e "o primeiro link da lista" muda com qualquer post
    // novo (a lista ordena por updated_at). O alvo é o rascunho de bancada,
    // achado pelo texto do link — determinístico.
    ['16b-conteudo-roteiro', '{match:/admin/conteudo/|Roteiro de bancada}'],
    // Caminho ESTÁTICO, e não `{first:/admin/conteudo/}`: aquele prefixo agora
    // casa também com a Pauta (o link novo da toolbar do Estúdio), e "o primeiro
    // link" passaria a ser ela em vez do post. O painel entra como endereço
    // próprio porque painel É endereço nesta casa.
    ['16c-conteudo-pauta', '/admin/conteudo/pauta'],
    ['16d-conteudo-pauta-novo', '/admin/conteudo/pauta?painel=novo'],
    // Leva 1: o painel de EDITAR (tipo/tier). `{match:}` no sentinela da
    // bancada — o alvo é sempre o mesmo criador entre rodadas.
    ['16d2-conteudo-pauta-editar', '{match:/admin/conteudo/pauta?painel=editar|canal.de.bancada}'],
    // M6: a aba onde a etiqueta "pauta" aparece (ideia do robô × ideia da
    // dona) e o painel das métricas com o veredito.
    ['16e-conteudo-pendentes', '/admin/conteudo/posts?st=pendentes'],
    ['16f-conteudo-metricas', '/admin/conteudo/posts?painel=metricas'],
    // Leva 3: o radar de trends. Caminhos ESTÁTICOS de propósito — a triagem
    // abre no 1º cartão do deck (determinístico: a ordem é fixa e o seed crava
    // as velocidades), e o painel de descarte é ENDEREÇO (sem alvo, ele age
    // sobre o cartão corrente). Nada de {first:}/{match:} aqui.
    ['16g-radar-triagem', '/admin/conteudo'],
    ['16g2-radar-descartar', '/admin/conteudo?painel=descartar'],
    ['16g3-radar-todos', '/admin/conteudo?ver=todos'],
    // Leva 4: a aba Personal Travel — a terceira vista do mesmo deck.
    ['16g4-radar-pt', '/admin/conteudo?ver=pt'],
    // Leva 3.3: o painel do roteiro avulso (ex-"Nova ideia") no Estúdio legado.
    ['16h-conteudo-roteiro-avulso', '/admin/conteudo/posts?painel=nova'],
  ],
  teacher: [
    ['01-painel', '/teacher'],
    ['01b-aulas', '/teacher?aba=aulas'],
    ['01c-extratos', '/teacher?aba=extratos'],
    ['01d-conta', '/teacher?aba=conta'],
  ],
  portal: [
    ['01-home', '/portal'],
    ['01b-aulas', '/portal/aulas'],
    ['01d-pagamentos', '/portal/pagamentos'],
    ['02-mentoria', '/portal/mentoria'],
    ['03-remarcar', '{first:/portal/remarcar/}'],
    ['04-resgatar', '{first:/portal/resgatar/}'],
  ],
}

let pages = PAGES[role]
if (!pages) {
  console.error(`role desconhecido: ${role}`)
  process.exit(1)
}
if (only?.length) pages = pages.filter(([slug]) => only.includes(slug))

const VIEWPORTS = [
  ['desktop', { width: 1440, height: 900 }],
  ['celular', { width: 390, height: 844 }],
]

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)
const browser = await chromium.launch()

let state = null
if (role !== 'publico') {
  const [email, password] = LOGINS[role]
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  log(`login ok (${email}) → ${page.url()}`)
  state = await ctx.storageState()
  await ctx.close()
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

    // {match:<prefixo>|<trecho do texto>} — alvo ESTÁVEL entre rodadas: acha o
    // link cujo texto contém o trecho, em vez do "primeiro da lista", que muda
    // sempre que a ordenação muda. Use quando o print precisa ser do MESMO
    // registro toda vez (comparação visual entre voltas do loop).
    const mm = target.match(/^\{match:(.+?)\|(.+)\}$/)
    if (mm) {
      const [, prefix, trecho] = mm
      const listUrl = LISTAS[prefix]
      if (!listUrl) {
        log(`~ ${slug}: prefixo ${prefix} não está no mapa de listas — pulado`)
        continue
      }
      await page.goto(BASE + listUrl, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {})
      const href = await page.evaluate(
        ([p, t]) => {
          const a = [...document.querySelectorAll(`a[href^="${p}"]`)].find(
            (el) => el.getAttribute('href').length > p.length && (el.textContent || '').includes(t),
          )
          return a ? a.getAttribute('href') : null
        },
        [prefix, trecho],
      )
      if (!href) {
        log(`~ ${slug}: nenhum link ${prefix} com "${trecho}" — rode o preview-seed`)
        continue
      }
      url = href
    }

    const m = target.match(/^\{first:(.+)\}$/)
    if (m) {
      const prefix = m[1]
      if (!firstLinks.has(prefix)) {
        const listUrl = LISTAS[prefix]
        await page.goto(BASE + listUrl, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {})
        const href = await page.evaluate((p) => {
          const a = [...document.querySelectorAll(`a[href^="${p}"]`)].find(
            (el) => el.getAttribute('href').length > p.length,
          )
          return a ? a.getAttribute('href') : null
        }, prefix)
        firstLinks.set(prefix, href)
      }
      url = firstLinks.get(prefix)
      if (!url) {
        log(`~ ${slug}: nenhum link ${m[1]} — pulado`)
        continue
      }
    }
    try {
      await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 60_000 })
    } catch {
      log(`~ ${slug}: networkidle estourou, seguindo`)
    }
    await page.waitForTimeout(700)
    const file = path.join(dir, `${slug}.png`)
    try {
      await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide', timeout: 60_000 })
      log(`✓ ${role}/${vpName}/${slug}.png (${page.url()})`)
    } catch (e) {
      log(`✗ ${slug}: ${String(e).split('\n')[0]}`)
    }
  }
  await ctx.close()
}

await browser.close()
log(`FIM — ${role} em ${OUT}/${role}/`)
