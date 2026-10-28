// MEDIDOR DA LAVAGEM DO CARTÃO DE PRODUTO (c13 · nº 12).
//
// O QUE ELE RESPONDE, e por que precisa existir. `CartaoDeGrupo` põe texto
// BRANCO sobre a arte do produto, com um gradiente de tinta no meio (a
// "lavagem"). Se a lavagem afinar demais, o número de alunos — que é o DADO da
// tela — cai abaixo do mínimo AA (4.5:1) em cima da parte clara da arte. O Sol
// pegou exatamente isso na rodada 2 (4.495:1 no avião do Personal Travel), o
// c12 escureceu os stops, e os números da correção foram parar num comentário
// do componente… medidos por um script que ninguém commitou. Número que não se
// reproduz é folclore: este arquivo é a medição, e o comentário do componente
// passa a CITÁ-LO em vez de afirmar sozinho.
//
// Uso: node scripts/brand/medir-lavagem.mjs
//
// COMO ELE MEDE (e é isto que faz o número valer):
//  · as artes REAIS de `public/brand/produtos/` (versionadas — os insumos de
//    onde elas saem é que ficam fora do git, ver `publicar-produtos.mjs`);
//  · na GEOMETRIA do cartão no viewport estreito: 256×132, `bg-cover bg-center`
//    — a mesma conta que o navegador faz para preencher a caixa;
//  · com o gradiente do componente aplicado pixel a pixel (interpolação linear
//    de alfa entre os stops, que é o que `color-mix(… , transparent)` faz quando
//    a cor dos dois lados é a mesma);
//  · e o pior caso varrido dentro do `p-4` INTEIRO (16 px de recuo), não só onde
//    as letras caem hoje: rótulo mais comprido, número de quatro dígitos ou
//    tradução mudam a máscara sem mudar o código.
//  · Os dois tons de texto do componente entram na varredura: o branco puro dos
//    números e o `text-white/85` da tinta secundária, que é sempre o mais
//    apertado dos dois.
//
// Este módulo não tem efeito nenhum além de LER as artes: o teste do lote o
// importa e confere os números do comentário contra o que ele calcula.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** A geometria do cartão no viewport de 320 (o mais apertado que a casa suporta). */
export const CARTAO = { largura: 256, altura: 132, recuo: 16 }

/** `--ink-900` do `globals.css` — a tinta da lavagem. */
export const INK_900 = { r: 0x17, g: 0x14, b: 0x1f }

/** Os stops do `LAVAGEM` de `CartaoDeGrupo` (posição em %, alfa em %). */
export const STOPS = [
  { pos: 0, alfa: 88 },
  { pos: 55, alfa: 74 },
  { pos: 100, alfa: 66 },
]

/** Os dois tons de texto que o cartão usa por cima da lavagem. */
export const TINTAS = [
  { nome: 'branco', alfa: 1 },
  { nome: 'branco/85', alfa: 0.85 },
]

export const ARTES = [
  { nome: 'Personal One', arquivo: 'public/brand/produtos/personal-one-card.jpg' },
  { nome: 'Personal Travel', arquivo: 'public/brand/produtos/personal-travel-card.jpg' },
]

/** O alfa da lavagem na coluna `x` (interpolação linear entre os stops). */
export function alfaDaLavagem(x, largura = CARTAO.largura) {
  const t = (x / (largura - 1)) * 100
  for (let i = 1; i < STOPS.length; i++) {
    const a = STOPS[i - 1]
    const b = STOPS[i]
    if (t <= b.pos) {
      const k = (t - a.pos) / (b.pos - a.pos)
      return (a.alfa + (b.alfa - a.alfa) * k) / 100
    }
  }
  return STOPS[STOPS.length - 1].alfa / 100
}

/** Luminância relativa do WCAG 2.x (canal em 0..255). */
export function luminancia({ r, g, b }) {
  const linear = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** Razão de contraste do WCAG entre duas cores opacas. */
export function contraste(a, b) {
  const la = luminancia(a)
  const lb = luminancia(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** `frente` com alfa por cima de `fundo`, em sRGB (o que o navegador faz). */
export function compor(frente, fundo, alfa) {
  return {
    r: frente.r * alfa + fundo.r * (1 - alfa),
    g: frente.g * alfa + fundo.g * (1 - alfa),
    b: frente.b * alfa + fundo.b * (1 - alfa),
  }
}

const BRANCO = { r: 255, g: 255, b: 255 }

/**
 * Varre uma arte e devolve o pior contraste de cada tinta dentro do `p-4`.
 *
 * `pixels` é RGB cru (3 canais), já na geometria do cartão.
 */
export function varrer(pixels, largura = CARTAO.largura, altura = CARTAO.altura) {
  const piores = TINTAS.map((t) => ({ ...t, pior: Infinity, onde: null }))
  for (let y = CARTAO.recuo; y < altura - CARTAO.recuo; y++) {
    for (let x = CARTAO.recuo; x < largura - CARTAO.recuo; x++) {
      const i = (y * largura + x) * 3
      const arte = { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] }
      const fundo = compor(INK_900, arte, alfaDaLavagem(x, largura))
      for (const tinta of piores) {
        const texto = tinta.alfa === 1 ? BRANCO : compor(BRANCO, fundo, tinta.alfa)
        const razao = contraste(texto, fundo)
        if (razao < tinta.pior) {
          tinta.pior = razao
          tinta.onde = { x, y }
        }
      }
    }
  }
  return piores
}

/** Mede as duas artes. Devolve `[{ nome, pior, porTinta }]`. */
export async function medirLavagem() {
  const { default: sharp } = await import('sharp')
  const fora = []
  for (const arte of ARTES) {
    const caminho = path.join(RAIZ, arte.arquivo)
    if (!existsSync(caminho)) throw new Error(`arte ausente: ${arte.arquivo}`)
    const { data } = await sharp(caminho)
      .resize(CARTAO.largura, CARTAO.altura, { fit: 'cover', position: 'centre' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const porTinta = varrer(data)
    fora.push({
      nome: arte.nome,
      arquivo: arte.arquivo,
      porTinta,
      pior: Math.min(...porTinta.map((t) => t.pior)),
    })
  }
  return fora
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const medidas = await medirLavagem()
  console.log(
    `lavagem: ${STOPS.map((s) => `${s.alfa}% @ ${s.pos}%`).join(' · ')} de ` +
      `rgb(${INK_900.r},${INK_900.g},${INK_900.b}) — caixa ${CARTAO.largura}×${CARTAO.altura}, ` +
      `recuo ${CARTAO.recuo}px (p-4)`,
  )
  for (const m of medidas) {
    console.log(`\n${m.nome} (${m.arquivo})`)
    for (const t of m.porTinta) {
      console.log(
        `  ${t.nome.padEnd(10)} pior ${t.pior.toFixed(3)}:1  ` +
          `(x=${t.onde.x}, y=${t.onde.y})`,
      )
    }
    console.log(`  PIOR CASO  ${m.pior.toFixed(3)}:1  ${m.pior >= 4.5 ? '✓ AA' : '✗ ABAIXO DE AA'}`)
  }
}
