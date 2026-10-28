// Dimensão em PIXELS de um arquivo de imagem, lida do cabeçalho — sem
// dependência nova e sem decodificar a imagem inteira.
//
// Por que isto existe (defeito da capa em retrato, 25/07): o `sizing: {type:
// 'cover'}` do pptxgenjs precisa saber o tamanho NATURAL da imagem para
// calcular o recorte. No navegador ele carrega a imagem e mede; no Node ele
// não tem como, e o código cai em `imgWidth = cx` — ou seja, assume que a
// imagem tem exatamente o tamanho da CAIXA. Com essa premissa o recorte
// calculado é sempre `l=r=t=b=0`: nenhuma foto é recortada, TODA foto é
// ESTICADA até preencher a caixa. É o que a página mostra hoje (`<a:srcRect
// l="0" r="0" t="0" b="0"/><a:stretch/>` em todo deck do lote).
//
// Com a medida real na mão, o renderizador informa o tamanho natural ao
// pptxgenjs e o recorte passa a existir de verdade.
import { closeSync, openSync, readSync } from 'node:fs'

export interface ImageSize {
  w: number
  h: number
}

/** lê `n` bytes a partir de `pos`; devolve menos que `n` só no fim do arquivo */
function ler(fd: number, pos: number, n: number): Buffer {
  const buf = Buffer.alloc(n)
  const lidos = readSync(fd, buf, 0, n, pos)
  return buf.subarray(0, lidos)
}

/** PNG: IHDR é sempre o primeiro chunk, em offset fixo. */
function png(fd: number): ImageSize | null {
  const head = ler(fd, 0, 24)
  if (head.length < 24) return null
  if (head.readUInt32BE(0) !== 0x89504e47) return null
  if (head.toString('latin1', 12, 16) !== 'IHDR') return null
  return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) }
}

/**
 * JPEG: percorre os marcadores até um SOF (Start Of Frame), que é quem carrega
 * altura e largura. SOF0/1/2/3, 5/6/7, 9/10/11, 13/14/15 — os `C4`, `C8` e `CC`
 * do meio da faixa NÃO são SOF (tabela de Huffman, extensão e tabela
 * aritmética) e são pulados.
 */
function jpeg(fd: number): ImageSize | null {
  const soi = ler(fd, 0, 2)
  if (soi.length < 2 || soi[0] !== 0xff || soi[1] !== 0xd8) return null
  let pos = 2
  for (let passos = 0; passos < 4096; passos += 1) {
    const cab = ler(fd, pos, 4)
    if (cab.length < 4) return null
    if (cab[0] !== 0xff) return null
    const marcador = cab[1]
    // marcadores sem carga útil (RSTn, TEM): andam 2 bytes e seguem
    if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd9)) {
      pos += 2
      continue
    }
    const tam = cab.readUInt16BE(2)
    const ehSOF =
      marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc
    if (ehSOF) {
      const corpo = ler(fd, pos + 4, 5)
      if (corpo.length < 5) return null
      return { h: corpo.readUInt16BE(1), w: corpo.readUInt16BE(3) }
    }
    if (tam < 2) return null
    pos += 2 + tam
  }
  return null
}

/**
 * Tamanho natural da imagem, ou `null` quando o arquivo não existe, não é
 * legível ou não é um formato que a biblioteca usa (JPEG/PNG). `null` significa
 * "não sei medir" — quem chama degrada para o comportamento antigo em vez de
 * quebrar o deck.
 */
export function imageSize(path: string): ImageSize | null {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    return null
  }
  try {
    const medida = png(fd) ?? jpeg(fd)
    if (!medida || medida.w <= 0 || medida.h <= 0) return null
    return medida
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}
