/**
 * VER A CÂMERA — renderiza um slide e desenha por cima o retângulo da facecam.
 *
 * Existe por causa de um defeito que passou pela validação de 25/07: a capa do
 * M2A1 punha a viajante de costas exatamente atrás do rosto da professora, e o
 * PNG que o dono inspecionou não mostrava isso. O motivo é do template: na CAPA
 * a caixa da facecam NÃO é desenhada — só o `paperSlideV2` chama o
 * `facecamDock`, e a capa é `coverSlide`. Nos slides de papel a moldura aparece;
 * na capa o vídeo entra por cima da foto só na gravação. Ou seja: no PNG a foto
 * aparece inteira e a colisão é invisível.
 *
 * Este script fecha esse buraco sem tocar no renderer: renderiza o deck de
 * verdade (mesmo `buildLesson`/`packDeck` do `render-lesson.ts`), converte o
 * slide pedido para PNG e compõe por cima DOIS retângulos:
 *
 *   • a caixa exata da câmera (`FACECAM`), traço cheio;
 *   • a ZONA que a composição da foto tem de manter calma (`ZONA_FACECAM`, a
 *     caixa dilatada pela margem da própria câmera), traço tracejado.
 *
 * As duas saem de `FACECAM_V2` via `comum.ts` — as mesmas medidas que escrevem
 * a regra do prompt em `cenas.ts`. Nada aqui é percentual escrito à mão, então
 * mudar o tamanho da câmera move o retângulo e a regra juntos.
 *
 * Ferramentas: `soffice` (pptx→pdf) e `pdftoppm` (pdf→png), que é o mesmo
 * caminho que já se usava à mão para olhar os decks; e o Chromium do Playwright
 * (já é devDependency) para compor os retângulos — o repo não tem biblioteca de
 * imagem, e desenhar um retângulo não vale uma dependência nova.
 *
 * Uso:
 *   node scripts/images/facecam-qa.ts content/personal-travel-v2/m2a1.json
 *   node scripts/images/facecam-qa.ts content/personal-travel-v2/*.json --slide 1
 *   node scripts/images/facecam-qa.ts content/personal-travel-v2/m2a1.json --slide 1,4
 *
 * Saída: out/qa-facecam/<CÓDIGO>-s<N>-facecam.png
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { buildLesson, deckCode, packDeck } from '../../src/lib/slides/build.ts'
import { FACECAM } from '../../src/lib/slides/template-v2.ts'
import { loadLesson } from '../slides/render-lesson.ts'
import { PAGINA, ZONA_FACECAM, ZONA_FACECAM_PCT } from './comum.ts'

const raiz = path.resolve(import.meta.dirname, '../..')
const DESTINO = path.join(raiz, 'out', 'qa-facecam')

/** o curso decide o template — este QA só faz sentido no v2, que é quem tem facecam */
const CURSO = 'personal-travel-v2'

/** largura do PNG de saída; 1600 = 16:9 em 1600×900, tamanho de olhar na tela */
const LARGURA_PX = 1600

/** resolução do pdftoppm — folgada, para o texto do slide continuar legível */
const DPI = 160

/** `soffice` do PATH, ou o do bundle do LibreOffice no macOS */
function soffice(): string {
  const bundle = '/Applications/LibreOffice.app/Contents/MacOS/soffice'
  try {
    return execFileSync('which', ['soffice'], { encoding: 'utf8' }).trim()
  } catch {
    if (fs.existsSync(bundle)) return bundle
    console.error('Sem `soffice` no PATH e sem LibreOffice em /Applications — instale um dos dois.')
    process.exit(2)
  }
}

/** caixa em PERCENTUAL da página — é assim que ela entra no CSS e sobrevive à escala */
function pct(box: { x: number; y: number; w: number; h: number }): Record<string, string> {
  return {
    left: `${(box.x / PAGINA.w) * 100}%`,
    top: `${(box.y / PAGINA.h) * 100}%`,
    width: `${(box.w / PAGINA.w) * 100}%`,
    height: `${(box.h / PAGINA.h) * 100}%`,
  }
}

const estilo = (regras: Record<string, string>): string =>
  Object.entries(regras)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')

/**
 * A página que o Chromium fotografa: o PNG do slide com os dois retângulos por
 * cima. O PNG entra como `file://` — nada de rede, nada de base64 gigante.
 */
function paginaHtml(png: string, legenda: string): string {
  const zona = estilo({
    position: 'absolute',
    ...pct(ZONA_FACECAM),
    border: '3px dashed rgba(255,0,128,.95)',
    background: 'rgba(255,0,128,.10)',
    'box-sizing': 'border-box',
  })
  const cam = estilo({
    position: 'absolute',
    ...pct(FACECAM),
    border: '3px solid rgba(255,0,128,1)',
    background: 'rgba(255,0,128,.18)',
    'box-sizing': 'border-box',
  })
  const rotulo =
    'position:absolute;font:600 13px/1.3 -apple-system,Segoe UI,sans-serif;color:#fff;' +
    'background:rgba(255,0,128,.95);padding:2px 6px;white-space:nowrap'
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111">
<div id="palco" style="position:relative;width:${LARGURA_PX}px">
  <img src="file://${png}" style="display:block;width:100%">
  <div style="${zona}"><span style="${rotulo};left:0;bottom:-22px">ZONA CALMA — ${ZONA_FACECAM_PCT.largura}% × ${ZONA_FACECAM_PCT.altura}%</span></div>
  <div style="${cam}"><span style="${rotulo};left:0;top:-22px">FACECAM ${FACECAM.w}×${FACECAM.h}"</span></div>
  <div style="position:absolute;left:0;bottom:0;font:600 13px/1.3 -apple-system,Segoe UI,sans-serif;color:#fff;background:rgba(0,0,0,.75);padding:4px 8px">${legenda}</div>
</div></body>`
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const iSlide = args.indexOf('--slide')
  const slides = (iSlide >= 0 ? (args[iSlide + 1] ?? '1') : '1').split(',').map(Number)
  const aulas = args.filter((a, i) => a.endsWith('.json') && !(iSlide >= 0 && i === iSlide + 1))

  if (!aulas.length || slides.some((n) => !Number.isInteger(n) || n < 1)) {
    console.error('Uso: node scripts/images/facecam-qa.ts <aula.json…> [--slide 1,4]')
    process.exit(2)
  }

  fs.mkdirSync(DESTINO, { recursive: true })
  const bin = soffice()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: LARGURA_PX, height: 900 } })

  for (const aula of aulas) {
    const doc = loadLesson(path.resolve(aula), CURSO)
    const codigo = deckCode(doc)
    const pptx = path.join(DESTINO, `${codigo}.pptx`)
    fs.writeFileSync(pptx, await packDeck(buildLesson(doc, CURSO)))

    // pptx → pdf → png. O LibreOffice não converte pptx para png direto com
    // fidelidade de página; o pdf no meio é o caminho que já se usava à mão.
    execFileSync(bin, ['--headless', '--convert-to', 'pdf', '--outdir', DESTINO, pptx], { stdio: 'ignore' })
    const pdf = path.join(DESTINO, `${codigo}.pdf`)

    for (const n of slides) {
      const prefixo = path.join(DESTINO, `${codigo}-s${n}`)
      execFileSync('pdftoppm', ['-png', '-r', String(DPI), '-f', String(n), '-l', String(n), pdf, prefixo])
      const bruto = fs.readdirSync(DESTINO).find((f) => f.startsWith(`${codigo}-s${n}-`) && f.endsWith('.png'))
      if (!bruto) {
        console.error(`✗ ${codigo}: o pdftoppm não produziu o slide ${n} (o deck tem menos slides?)`)
        process.exit(1)
      }
      const origem = path.join(DESTINO, bruto)
      const saida = `${prefixo}-facecam.png`
      // O HTML vai para DISCO e é aberto por `file://`, não por `setContent`:
      // numa página `about:blank` o Chromium recusa o `<img src="file://…">`
      // por origem, e o palco é fotografado com altura zero (uma tira preta).
      const html = path.join(DESTINO, '_qa.html')
      fs.writeFileSync(html, paginaHtml(origem, `${codigo} · slide ${n} · ${doc.lesson.title}`))
      await page.goto(`file://${html}`)
      await page.waitForFunction(() => {
        const img = document.querySelector('img')
        return Boolean(img?.complete && img.naturalWidth > 0)
      })
      await page.locator('#palco').screenshot({ path: saida })
      fs.rmSync(html)
      fs.rmSync(origem)
      console.log(`✓ ${path.relative(raiz, saida)}`)
    }
  }

  await browser.close()
  console.log(
    `\nZona calma: ${ZONA_FACECAM.w.toFixed(2)}" × ${ZONA_FACECAM.h.toFixed(2)}" no canto superior direito ` +
      `(${ZONA_FACECAM_PCT.largura}% × ${ZONA_FACECAM_PCT.altura}% da página de ${PAGINA.w}×${PAGINA.h}").`,
  )
}

main()
