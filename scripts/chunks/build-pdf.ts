/**
 * O PDF DOS CHUNKS — material da Mission 9 do Personal Travel.
 *
 * Gera `out/chunks/personal-travel-chunks.pdf` a partir de `chunks.ts`, em
 * HTML + `page.pdf()` do Chromium do Playwright (já é devDependency; o mesmo
 * caminho de `scripts/images/facecam-qa.ts`). É script, e não um PDF solto,
 * porque a lista vai mudar: quando um chunk entrar ou sair, roda de novo.
 *
 * LEI 11 DO PROJETO: nenhum texto deste material é gerado dentro de imagem por
 * IA. Tudo aqui é HTML com os tokens da marca; a única imagem é a logo oficial
 * de `brand/logos/`.
 *
 * PORTÃO DE RASTREABILIDADE (roda antes de desenhar qualquer coisa): cada chunk
 * precisa (a) ser único na lista e (b) aparecer LITERALMENTE em pelo menos uma
 * das aulas que ele cita. Se um chunk não for encontrado no curso, o script
 * FALHA — é o que impede a lista de virar inglês de viagem genérico.
 *
 * Uso:
 *   node scripts/chunks/build-pdf.ts
 *   node scripts/chunks/build-pdf.ts --png     (rasteriza para conferência)
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { GRUPOS, TOTAL, type Familia, type Grupo } from './chunks.ts'
import { pastaDeConteudo, pastaDeMarca } from '../../src/lib/pastas.ts'

const raiz = path.resolve(import.meta.dirname, '../..')
const MARCA = pastaDeMarca(raiz)
const AULAS = path.join(pastaDeConteudo(raiz), 'personal-travel-v2')

/** O PDF é ENTREGÁVEL — a dona anexa este arquivo na Mission 9 —, então mora
 *  junto do conteúdo do curso e é versionado. `out/` é ignorado pelo git e
 *  serve só para os rascunhos de conferência (HTML e PNGs). O nome não carrega
 *  o número de chunks de propósito: a lista muda, o endereço não. */
const MATERIAIS = path.join(AULAS, 'materiais')
const PDF = path.join(MATERIAIS, 'm9-chunks-personal-travel.pdf')
const RASCUNHO = path.join(raiz, 'out', 'chunks')

/* ────────────────────────────── tokens da marca ──────────────────────────────
   Espelham `Design.md` / `src/app/globals.css`. Ficam aqui porque este HTML é
   avulso (não passa pelo Tailwind do app) — mas os hex são os mesmos. */
const COR = {
  paper0: '#ffffff',
  paper50: '#f7f7fb',
  paper100: '#efeff6',
  ink900: '#17141f',
  ink600: '#4c4859',
  ink400: '#6d6878',
  brand700: '#7e36a3',
  brand600: '#9333c9',
  teal700: '#0b7a70',
  teal600: '#0f9488',
}

/** uma cor por família — só roxo e turquesa da marca, mais tinta. Matizes
 *  funcionais (âmbar/vinho/verde) são exclusivos de ESTADO (Design.md §S2-5)
 *  e por isso não aparecem aqui. */
const COR_FAMILIA: Record<Familia, string> = {
  ask: COR.brand700,
  order: COR.teal700,
  react: COR.brand600,
  repair: COR.ink900,
  close: COR.teal600,
}

/* ─────────────────────────── portão de rastreabilidade ─────────────────────── */

/**
 * O texto cru de uma aula, com a marcação de slide removida — `**negrito**` e
 * `{{destaque}}` cercam as frases no conteúdo e quebrariam a busca literal.
 */
const textoDaAula = (() => {
  const cache = new Map<string, string>()
  return (codigo: string): string => {
    const posto = cache.get(codigo)
    if (posto !== undefined) return posto
    const arquivo = path.join(AULAS, `${codigo}.json`)
    if (!fs.existsSync(arquivo)) throw new Error(`aula inexistente: ${codigo}`)
    const cru = fs.readFileSync(arquivo, 'utf8').replace(/\*\*/g, '').replace(/\{\{|\}\}/g, '')
    // o JSON escapa a apóstrofe reta como \' ? não — mas escapa " ; normaliza
    // aspas curvas para a reta, que é como as frases são escritas no curso.
    const limpo = cru.replace(/[‘’]/g, "'").toLowerCase()
    cache.set(codigo, limpo)
    return limpo
  }
})()

/**
 * Os pedaços LITERAIS de um chunk — o que dá para procurar no curso. Tira os
 * encaixes de molde (`…`), separa as variantes de uma mesma linha (`/`) e
 * ignora o que ficou curto demais para ser evidência.
 */
function fragmentos(en: string): string[] {
  return en
    .split('/')
    .flatMap((parte) => parte.split(/…|\(|\)/))
    .map((p) => p.replace(/[?!.,]+$/, '').trim().toLowerCase())
    .filter((p) => p.length >= 4)
}

/** falha o build se algum chunk não for do curso — ou se houver repetido */
function conferir(grupos: Grupo[]): void {
  const vistos = new Map<string, string>()
  const problemas: string[] = []
  for (const g of grupos) {
    for (const c of g.chunks) {
      const chave = c.en.toLowerCase()
      const antes = vistos.get(chave)
      if (antes) problemas.push(`repetido: "${c.en}" (${antes} e ${g.familia})`)
      vistos.set(chave, g.familia)
      if (c.aulas.length === 0) {
        problemas.push(`sem aula: "${c.en}"`)
        continue
      }
      const pedacos = fragmentos(c.en)
      if (pedacos.length === 0) {
        problemas.push(`sem fragmento pesquisável: "${c.en}"`)
        continue
      }
      // basta UM fragmento aparecer em UMA das aulas citadas: os moldes com
      // `…` só existem no curso com o encaixe preenchido.
      const achou = c.aulas.some((a) => pedacos.some((p) => textoDaAula(a).includes(p)))
      if (!achou) problemas.push(`não encontrado no curso: "${c.en}" [${c.aulas.join(', ')}]`)
    }
  }
  if (problemas.length > 0) {
    throw new Error(`portão de rastreabilidade reprovou ${problemas.length} chunk(s):\n  - ${problemas.join('\n  - ')}`)
  }
}

/* ──────────────────────────────── desenho ──────────────────────────────────── */

const escapar = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const base64 = (arquivo: string) => fs.readFileSync(arquivo).toString('base64')

const FONTE_DISPLAY = base64(path.join(MARCA, 'fonts/bricolage-variable.woff2'))
const FONTE_CORPO = base64(path.join(MARCA, 'fonts/hanken-variable.woff2'))
const LOGO = base64(
  path.join(MARCA, 'logos/Logo Personal Teacher - Fundo Transparente - Preto.png'),
)

const COMO_USAR = [
  ['Marque 10.', 'Os que <b>você</b> usaria esta semana — não os que “deveria” saber. Dez marcados fazem a lista virar sua.'],
  ['Diga 3 por dia, em voz alta.', 'Três chunks, dez vezes cada. Chunk só se instala pela boca: lido com os olhos, fica no papel.'],
  ['Nunca parta a frase no meio.', 'O bloco sai inteiro, no ritmo de conversa — do jeito que “bom dia” sai em português.'],
]

function html(): string {
  const secoes = GRUPOS.map((g) => {
    const cor = COR_FAMILIA[g.familia]
    const linhas = g.chunks
      .map(
        (c) => `<div class="linha">
        <span class="caixa" style="border-color:${cor}"></span>
        <div class="texto">
          <div class="en">${escapar(c.en)}</div>
          <div class="baixo"><span class="pt">${escapar(c.pt)}</span><span class="onde">${escapar(c.onde)}</span></div>
        </div>
      </div>`,
      )
      .join('\n')
    return `<section class="familia">
      <div class="banda" style="background:${cor}">
        <div class="banda-nome">${g.familia}</div>
        <div class="banda-faz">${escapar(g.oQueFaz)}</div>
        <div class="banda-n">${g.chunks.length}</div>
      </div>
      ${linhas}
    </section>`
  }).join('\n')

  const indice = GRUPOS.map(
    (g) => `<li><span class="i-ponto" style="background:${COR_FAMILIA[g.familia]}"></span>
      <span class="i-nome">${g.familia}</span>
      <span class="i-faz">${escapar(g.oQueFaz)}</span>
      <span class="i-n">${g.chunks.length}</span></li>`,
  ).join('\n')

  const passos = COMO_USAR.map(
    ([titulo, corpo], i) => `<li><span class="passo-n">${i + 1}</span>
      <div><b>${titulo}</b> ${corpo}</div></li>`,
  ).join('\n')

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Os ${TOTAL} chunks do Personal Travel</title>
<style>
  @font-face { font-family:'Bricolage'; src:url(data:font/woff2;base64,${FONTE_DISPLAY}) format('woff2'); font-weight:200 800; font-style:normal }
  @font-face { font-family:'Hanken'; src:url(data:font/woff2;base64,${FONTE_CORPO}) format('woff2'); font-weight:200 800; font-style:normal }

  /* A margem de baixo é do @page, não só da opção do page.pdf(): quando o CSS
     zera a margem, ele GANHA da opção e o texto passa a ser impresso por baixo
     do rodapé (aconteceu — a última linha da página 4 invadia o rodapé). As
     laterais ficam em 0 de propósito, para as faixas das famílias sangrarem. */
  @page { size: A4; margin: 0 0 15mm 0 }
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact }
  body { font-family:'Hanken',sans-serif; color:${COR.ink900}; background:${COR.paper0} }

  /* ── capa ───────────────────────────────────────────────────────────── */
  .capa { padding:16mm 16mm 0; break-after:page }
  .logo { width:28mm; display:block; margin-bottom:8mm }
  .eyebrow { font-size:9pt; font-weight:700; letter-spacing:.16em; text-transform:uppercase; color:${COR.brand700}; margin-bottom:2.5mm }
  h1 { font-family:'Bricolage',sans-serif; font-weight:800; font-size:32pt; line-height:1.02; letter-spacing:-.02em }
  h1 em { font-style:normal; font-weight:200 }
  .definicao { margin:7mm 0 8mm; padding-left:5mm; border-left:2.5pt solid ${COR.teal700};
               font-size:12pt; line-height:1.42; color:${COR.ink600} }
  .definicao b { color:${COR.ink900}; font-weight:600 }

  .rotulo { font-size:8.5pt; font-weight:700; letter-spacing:.14em; text-transform:uppercase;
            color:${COR.ink400}; margin-bottom:3.5mm }
  .bloco { margin-bottom:7mm }
  .passos { list-style:none }
  .passos li { display:flex; gap:4mm; align-items:baseline; margin-bottom:4mm;
               font-size:11pt; line-height:1.38; color:${COR.ink600} }
  .passos b { color:${COR.ink900}; font-weight:700 }
  .passo-n { flex:0 0 6.5mm; height:6.5mm; border-radius:999px; background:${COR.brand700}; color:#fff;
             font-family:'Bricolage',sans-serif; font-weight:700; font-size:10pt;
             display:inline-flex; align-items:center; justify-content:center }

  .indice { list-style:none; border-top:.6pt solid rgba(23,20,31,.14) }
  .indice li { display:flex; align-items:baseline; gap:3mm; padding:2.5mm 0;
               border-bottom:.6pt solid rgba(23,20,31,.08) }
  .i-ponto { flex:0 0 2.6mm; height:2.6mm; border-radius:999px; transform:translateY(-.3mm) }
  .i-nome { font-family:'Bricolage',sans-serif; font-weight:700; font-size:13pt; width:23mm }
  .i-faz { flex:1; font-size:10.5pt; color:${COR.ink600} }
  .i-n { font-family:'Bricolage',sans-serif; font-weight:200; font-size:16pt; color:${COR.ink900} }

  .dica { margin-top:3mm; font-size:9.5pt; line-height:1.4; color:${COR.ink400} }
  .dica b { color:${COR.ink600}; font-weight:600 }
  .nota { margin-top:7mm; padding:4.5mm 6mm; background:${COR.paper50};
          border-left:2.5pt solid ${COR.brand600}; border-radius:0 3mm 3mm 0;
          font-size:10.5pt; line-height:1.42; color:${COR.ink600} }
  .nota-t { font-weight:700; color:${COR.ink900}; margin-bottom:1.5mm }

  /* ── seções de família ──────────────────────────────────────────────────
     A lista corre em fluxo contínuo, sem quebra forçada por família: com uma
     página por família sobravam páginas com duas linhas (a close fechava
     numa página só para a última). Quem faz a família ser achada de longe é a
     FAIXA colorida sangrando de ponta a ponta — e, dentro dela, a cor da
     caixinha de marcar, que segue a família até a linha final. */
  .familia { padding:0 13mm }
  .familia:last-child { padding-bottom:10mm }
  .banda { display:flex; align-items:baseline; gap:4mm; color:#fff;
           margin:0 -13mm 5mm; padding:5.5mm 13mm 5mm; break-after:avoid; break-inside:avoid }
  .banda-nome { font-family:'Bricolage',sans-serif; font-weight:800; font-size:22pt; letter-spacing:-.01em }
  .banda-faz { flex:1; font-size:10.5pt; font-weight:500; opacity:.92 }
  .banda-n { font-family:'Bricolage',sans-serif; font-weight:200; font-size:19pt; opacity:.92 }

  .linha { display:flex; gap:4.5mm; align-items:flex-start; break-inside:avoid;
           padding:1.8mm 0; border-bottom:.6pt solid rgba(23,20,31,.09) }
  .caixa { flex:0 0 5.4mm; height:5.4mm; border:1.1pt solid; border-radius:1.2mm;
           margin-top:.5mm; background:${COR.paper0} }
  .texto { flex:1; min-width:0 }
  .en { font-size:15.5pt; font-weight:600; line-height:1.2; letter-spacing:-.005em }
  .baixo { display:flex; align-items:baseline; gap:5mm; margin-top:.6mm }
  .pt { flex:1; font-size:11.5pt; line-height:1.25; color:${COR.ink600} }
  .onde { flex:0 0 auto; font-size:8.5pt; font-weight:700; line-height:1.25; letter-spacing:.1em;
          text-transform:uppercase; color:${COR.ink400}; text-align:right }

  /* ── fecho: o passo 6 da missão (três chunks por dia) vira espaço de escrever */
  .fecho { padding:8mm 13mm 0; break-inside:avoid }
  .fecho-p { font-size:10.5pt; line-height:1.42; color:${COR.ink600}; margin-bottom:7mm }
  .pauta { height:11mm; border-bottom:.8pt solid rgba(23,20,31,.22) }
</style></head>
<body>
  <div class="capa">
    <img class="logo" src="data:image/png;base64,${LOGO}" alt="Personal Teacher">
    <div class="eyebrow">Personal Travel · Mission 9</div>
    <h1>Os ${TOTAL} chunks<br><em>do seu curso</em></h1>

    <p class="definicao">Chunk não é palavra. É <b>frase pronta que sai inteira</b>,
      sem montar e sem traduzir. Cada uma destas saiu de uma aula que você já fez —
      e todas cabem em <b>cinco famílias</b>.</p>

    <div class="bloco">
      <div class="rotulo">Como usar esta lista</div>
      <ol class="passos">${passos}</ol>
    </div>

    <div class="bloco">
      <div class="rotulo">As 5 famílias</div>
      <ul class="indice">${indice}</ul>
      <p class="dica">O quadradinho é para marcar. A coluna da direita diz <b>onde você usa</b>,
        para achar na hora — e a cor da caixinha diz de qual família aquele chunk é.</p>
    </div>

    <div class="nota">
      <div class="nota-t">Guarde no celular, não na pasta de downloads.</div>
      Na fila, no táxi, no elevador — abre e diz três em voz alta. E se você travar
      numa conversa de verdade, pode simplesmente abrir e ler: quase ninguém se importa,
      e quem estiver com pressa entende mais rápido se você mostrar a frase na tela.
    </div>
  </div>
  ${secoes}

  <section class="fecho">
    <div class="rotulo">Os meus 3 de hoje</div>
    <p class="fecho-p">Escolha três dos que você marcou e escreva aqui. Dez vezes cada, em voz alta —
      e use os três no mesmo dia, comigo, com o espelho, com o cachorro.</p>
    <div class="pauta"></div><div class="pauta"></div><div class="pauta"></div>
  </section>
</body></html>`
}

/* ──────────────────────────────── execução ─────────────────────────────────── */

const rodape = `<div style="width:100%;padding:0 16mm;font-family:sans-serif;font-size:7pt;color:#6d6878;
  display:flex;justify-content:space-between;align-items:center">
  <span>Personal Teacher · Personal Travel · Mission 9</span>
  <span class="pageNumber"></span></div>`

async function main() {
  conferir(GRUPOS)
  console.log(`portão de rastreabilidade: ${TOTAL} chunks conferidos contra o curso ✓`)

  fs.mkdirSync(MATERIAIS, { recursive: true })
  fs.mkdirSync(RASCUNHO, { recursive: true })
  const arquivoHtml = path.join(RASCUNHO, 'personal-travel-chunks.html')
  fs.writeFileSync(arquivoHtml, html())

  const navegador = await chromium.launch()
  try {
    const pagina = await navegador.newPage()
    await pagina.goto(`file://${arquivoHtml}`, { waitUntil: 'load' })
    await pagina.evaluate(() => document.fonts.ready)
    await pagina.pdf({
      path: PDF,
      format: 'A4',
      printBackground: true,
      // margem só embaixo: o rodapé mora nela; o resto é padding do HTML.
      margin: { top: '0mm', bottom: '15mm', left: '0mm', right: '0mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: rodape,
    })
  } finally {
    await navegador.close()
  }
  console.log(`PDF: ${PDF}`)

  if (process.argv.includes('--png')) {
    const png = path.join(RASCUNHO, 'png')
    fs.rmSync(png, { recursive: true, force: true })
    fs.mkdirSync(png, { recursive: true })
    execFileSync('pdftoppm', ['-png', '-r', '110', PDF, path.join(png, 'p')])
    console.log(`PNGs: ${png}`)
  }
}

await main()
