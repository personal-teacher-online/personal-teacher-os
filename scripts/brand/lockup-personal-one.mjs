// PERSONAL ONE — lockup determinístico (Lei 11: texto NUNCA por IA).
// Entrada: a arte vencedora (rodada 7, A01 navy meia-noite — gitignorada).
// Saída:   brand/ensaio fotográfico/lockup-personal-one/ (local; só depois do
//          APROVADO do dono as finais vão para public/brand/produtos/).
//
// Uso: node scripts/brand/lockup-personal-one.mjs
//
// ── ATÉ ONDE VAI O "REPRODUZÍVEL" (c12 · nº 21) ──────────────────────────────
// Este script é determinístico e re-rodável NA MÁQUINA DA CASA, e só nela: a
// entrada é uma FOTO da dona, e fotos da dona não entram no git (privacidade
// — `brand/ensaio fotográfico/` é gitignorado). Num clone limpo ele falha na
// primeira linha, por falta do arquivo, e isso é o comportamento correto.
// O que É versionado, de propósito: a RECEITA (este arquivo, com fonte, cor,
// tracking e composição), as fontes OFL em `brand/fonts/` e os PRODUTOS FINAIS
// em `public/brand/produtos/` — que é o que o app serve e o que a revisão
// consegue conferir. Reproduzir a partir do zero exige a foto; conferir o
// resultado, não.
//
// Tipografia: Inter 600 caps com tracking largo — a fonte da casa no site;
// cor champanhe #EBDAB0 (pesquisa premium registrada em docs/goals/personal-one.md).
// Composição: satori (texto → paths SVG) → resvg (SVG → PNG) → sharp (composite).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'

const RAIZ = new URL('../../', import.meta.url).pathname
const ENTRADA = `${RAIZ}brand/ensaio fotográfico/rodada7-IMG_6839-azul-v01-navy-meia-noite.jpg`
const SAIDA = `${RAIZ}brand/ensaio fotográfico/lockup-personal-one`
const CHAMPANHE = '#EBDAB0'

const inter600 = readFileSync(`${RAIZ}brand/fonts/Inter-600.woff`)

/** Letreiro "PERSONAL ONE" como PNG transparente de largura fixa. */
async function letreiro(larguraCanvas, fontSize) {
  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: larguraCanvas,
          height: Math.round(fontSize * 2),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: CHAMPANHE,
          fontFamily: 'Inter',
          fontWeight: 600,
          fontSize,
          letterSpacing: '0.38em',
          // o tracking sobra à direita do último glifo; empurrar metade para
          // dentro devolve o centro ótico
          paddingLeft: `${0.19 * fontSize}px`,
        },
        children: 'PERSONAL ONE',
      },
    },
    {
      width: larguraCanvas,
      height: Math.round(fontSize * 2),
      fonts: [{ name: 'Inter', data: inter600, weight: 600, style: 'normal' }],
    },
  )
  return new Resvg(svg, { fitTo: { mode: 'width', value: larguraCanvas } }).render().asPng()
}

async function compor({ base, nome, marca }) {
  const meta = await base.metadata()
  let img = base
  if (marca) {
    const png = await letreiro(meta.width, marca.fontSize)
    img = img.composite([{ input: png, top: marca.top, left: 0 }])
  }
  const buf = await img.jpeg({ quality: 92 }).toBuffer()
  writeFileSync(`${SAIDA}/${nome}`, buf)
  console.log('✓', nome, `${meta.width}×${meta.height}`)
}

mkdirSync(SAIDA, { recursive: true })

// 1. HERO 4:5 (922×1152) — letreiro no vazio superior de navy.
await compor({
  base: sharp(ENTRADA),
  nome: 'personal-one-hero-4x5.jpg',
  marca: { fontSize: 48, top: 96 },
})

// 2. QUADRADO 1:1 (922×922) — corta por baixo (rosto + feixe ficam inteiros;
//    o vazio que sai é o topo), letreiro no respiro que resta.
await compor({
  base: sharp(ENTRADA).extract({ left: 0, top: 230, width: 922, height: 922 }),
  nome: 'personal-one-quadrado-1x1.jpg',
  marca: { fontSize: 44, top: 48 },
})

// 3. FAIXA LARGA ~2.3:1 (922×400) SEM letreiro — fundo do card de produto do
//    hub: o rótulo do card é HTML por cima da lavagem (nunca texto na arte).
await compor({
  base: sharp(ENTRADA).extract({ left: 0, top: 396, width: 922, height: 400 }),
  nome: 'personal-one-card-fundo-922x400.jpg',
})

console.log('pronto →', SAIDA)
