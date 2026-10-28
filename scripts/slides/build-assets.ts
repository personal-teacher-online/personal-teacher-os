// M-Slides-1 — gera os fundos noturnos ("fog" da marca, Design.md §públicas)
// e o fio-gradiente usados pelos decks do Personal Travel, como PNG puro em
// brand/slides/assets/. Sem browser e sem deps: cena determinística → rodar de
// novo reproduz os mesmos arquivos. Uso: npm run slides:assets
import { deflateSync } from 'node:zlib'
import { execSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pastaDeMarca } from '../../src/lib/pastas.ts'

const OUT = join(pastaDeMarca(resolve(import.meta.dirname, '../..')), 'slides', 'assets')

// ---------------------------------------------------------------- PNG (RGBA)
const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}
function crc32(buf: Uint8Array): number {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, crc])
}
function encodePng(w: number, h: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ])
}

// ------------------------------------------------------------------- cenas
type Rgb = readonly [number, number, number]
type Fog = { cx: number; cy: number; r: number; rgb: Rgb; a: number }
const NIGHT: Rgb = [10, 10, 15] // --bg-950 #0a0a0f
const PERIWINKLE: Rgb = [132, 136, 217] // #8488d9
const CYAN: Rgb = [72, 190, 217] // #48bed9
const PURPLE: Rgb = [179, 91, 217] // #b35bd9
const TURQUOISE: Rgb = [43, 217, 217] // #2bd9d9

function renderFog(w: number, h: number, blobs: Fog[], vignette: number): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  let i = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = NIGHT[0]
      let g = NIGHT[1]
      let b = NIGHT[2]
      for (const f of blobs) {
        // raio relativo à LARGURA nos dois eixos → blob circular em pixels
        const dx = (x - f.cx * w) / (f.r * w)
        const dy = (y - f.cy * h) / (f.r * w)
        const a = f.a * Math.exp(-(dx * dx + dy * dy) * 1.8)
        r = r * (1 - a) + f.rgb[0] * a
        g = g * (1 - a) + f.rgb[1] * a
        b = b * (1 - a) + f.rgb[2] * a
      }
      // vinheta: escurece bordas para o texto respirar
      const vx = x / w - 0.5
      const vy = y / h - 0.5
      const d = Math.sqrt(vx * vx + vy * vy)
      const t = Math.min(1, Math.max(0, (d - 0.34) / 0.38))
      const v = vignette * t * t * (3 - 2 * t)
      r = r * (1 - v) + NIGHT[0] * v
      g = g * (1 - v) + NIGHT[1] * v
      b = b * (1 - v) + NIGHT[2] * v
      // dither determinístico anti-banding (~±0.8 nível)
      let hsh = (x * 374761393 + y * 668265263) >>> 0
      hsh = ((hsh ^ (hsh >>> 13)) * 1274126177) >>> 0
      const n = ((hsh & 1023) / 1023 - 0.5) * 1.6
      out[i++] = Math.max(0, Math.min(255, Math.round(r + n)))
      out[i++] = Math.max(0, Math.min(255, Math.round(g + n)))
      out[i++] = Math.max(0, Math.min(255, Math.round(b + n)))
      out[i++] = 255
    }
  }
  return out
}

function renderStrip(w: number, h: number): Uint8Array {
  // fio-assinatura: roxo → periwinkle → azul-fog → turquesa
  const stops: Array<[number, Rgb]> = [
    [0.0, [179, 91, 217]],
    [0.38, [132, 136, 217]],
    [0.72, [72, 190, 217]],
    [1.0, [43, 217, 217]],
  ]
  const out = new Uint8Array(w * h * 4)
  for (let x = 0; x < w; x++) {
    const t = x / (w - 1)
    let k = 0
    while (k < stops.length - 2 && t > stops[k + 1]![0]) k++
    const [t0, c0] = stops[k]!
    const [t1, c1] = stops[k + 1]!
    const f = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)))
    const r = Math.round(c0[0] + (c1[0] - c0[0]) * f)
    const g = Math.round(c0[1] + (c1[1] - c0[1]) * f)
    const b = Math.round(c0[2] + (c1[2] - c0[2]) * f)
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
      out[i + 3] = 255
    }
  }
  return out
}

// capa: periwinkle alto à direita, ciano baixo-esquerda, roxo baixo-direita;
// zona do título (esquerda/centro) fica escura de propósito
const SCENES: Record<string, { blobs: Fog[]; vignette: number }> = {
  'fog-cover': {
    blobs: [
      { cx: 0.88, cy: 0.08, r: 0.4, rgb: PERIWINKLE, a: 0.62 },
      { cx: 0.05, cy: 0.97, r: 0.34, rgb: CYAN, a: 0.42 },
      { cx: 0.74, cy: 1.04, r: 0.26, rgb: PURPLE, a: 0.4 },
      { cx: 0.36, cy: -0.1, r: 0.2, rgb: TURQUOISE, a: 0.16 },
    ],
    vignette: 0.3,
  },
  'fog-section': {
    blobs: [
      { cx: 0.5, cy: 0.0, r: 0.42, rgb: PERIWINKLE, a: 0.52 },
      { cx: 0.03, cy: 0.92, r: 0.27, rgb: CYAN, a: 0.3 },
      { cx: 0.97, cy: 0.9, r: 0.25, rgb: PURPLE, a: 0.28 },
    ],
    vignette: 0.28,
  },
  'fog-closing': {
    blobs: [
      { cx: 0.5, cy: 1.06, r: 0.4, rgb: PURPLE, a: 0.52 },
      { cx: 0.93, cy: 0.04, r: 0.28, rgb: TURQUOISE, a: 0.26 },
      { cx: 0.06, cy: 0.06, r: 0.3, rgb: PERIWINKLE, a: 0.34 },
    ],
    vignette: 0.28,
  },

  // ------------------------------------------------ TEMPLATE V2: clima por PARTE
  // Um fog por PARTE do curso (`src/lib/slides/climate.ts`): é a única variação
  // "de ambiente" do v2, e existe porque variar o contexto ENTRE sessões ajudou
  // retenção (docs/research/05 §3.5). Restrições que valem para os seis:
  //  · família NOTURNA periwinkle/ciano da marca — sem verde, laranja nem roxo
  //    neon (o `PURPLE` #b35bd9 dos fogs do v1 fica FORA daqui de propósito);
  //  · fog é FUNDO, nunca sinal: nenhum destes tons carrega significado
  //    pedagógico — a gramática de cor mora no slide;
  //  · zona de texto (metade de baixo, esquerda e centro) fica ESCURA: os blobs
  //    fortes moram na metade de cima e nas quinas, porque o bloco de título dos
  //    slides noturnos v2 é ancorado embaixo.
  // PARTE 1 · THE PILLARS OF FLUENCY — periwinkle base
  'fog-p1': {
    blobs: [
      { cx: 0.86, cy: 0.06, r: 0.4, rgb: PERIWINKLE, a: 0.6 },
      { cx: 0.06, cy: 0.96, r: 0.32, rgb: CYAN, a: 0.28 },
      { cx: 0.4, cy: -0.12, r: 0.22, rgb: TURQUOISE, a: 0.14 },
    ],
    vignette: 0.3,
  },
  // PARTE 2 · FIRST STEPS — periwinkle → ciano frio (luz de terminal)
  'fog-p2': {
    blobs: [
      { cx: 0.18, cy: 0.02, r: 0.38, rgb: PERIWINKLE, a: 0.5 },
      { cx: 0.92, cy: 0.22, r: 0.34, rgb: CYAN, a: 0.46 },
      { cx: 0.55, cy: 1.08, r: 0.24, rgb: CYAN, a: 0.18 },
    ],
    vignette: 0.32,
  },
  // PARTE 3 · TIME TO TOUR — ciano quente, mais luminoso (cidade no fim do dia)
  'fog-p3': {
    blobs: [
      { cx: 0.62, cy: -0.02, r: 0.44, rgb: CYAN, a: 0.54 },
      { cx: 0.1, cy: 0.1, r: 0.28, rgb: PERIWINKLE, a: 0.4 },
      { cx: 0.97, cy: 0.94, r: 0.22, rgb: TURQUOISE, a: 0.16 },
    ],
    vignette: 0.26,
  },
  // PARTE 4 · FRIENDS & NETWORKING — periwinkle suave, luz difusa
  'fog-p4': {
    blobs: [
      { cx: 0.3, cy: 0.04, r: 0.46, rgb: PERIWINKLE, a: 0.42 },
      { cx: 0.9, cy: 0.3, r: 0.34, rgb: PERIWINKLE, a: 0.3 },
      { cx: 0.04, cy: 1.02, r: 0.26, rgb: CYAN, a: 0.16 },
    ],
    vignette: 0.24,
  },
  // PARTE 5 · EMERGENCIES — ciano neutro, mais escuro. SEM drama: o assunto já
  // é tenso, o fundo não sobe a tensão (contraste alto atrapalharia a leitura).
  'fog-p5': {
    blobs: [
      { cx: 0.9, cy: 0.16, r: 0.36, rgb: CYAN, a: 0.38 },
      { cx: 0.14, cy: 0.02, r: 0.26, rgb: PERIWINKLE, a: 0.2 },
    ],
    vignette: 0.38,
  },
  // PARTE 6 · READY TO GO — periwinkle luminoso (horizonte, otimismo)
  'fog-p6': {
    blobs: [
      { cx: 0.5, cy: -0.06, r: 0.46, rgb: PERIWINKLE, a: 0.64 },
      { cx: 0.92, cy: 0.06, r: 0.26, rgb: TURQUOISE, a: 0.26 },
      { cx: 0.06, cy: 0.92, r: 0.28, rgb: CYAN, a: 0.22 },
    ],
    vignette: 0.22,
  },
}

mkdirSync(OUT, { recursive: true })
for (const [name, scene] of Object.entries(SCENES)) {
  const png = encodePng(1920, 1080, renderFog(1920, 1080, scene.blobs, scene.vignette))
  writeFileSync(join(OUT, `${name}.png`), png)
  // fundos de master não precisam de alfa — JPEG corta ~1.4MB→~150KB por fog
  // (sips: macOS-only, como o build-chips; os .jpg ficam commitados)
  execSync(`sips -s format jpeg -s formatOptions 85 "${join(OUT, `${name}.png`)}" --out "${join(OUT, `${name}.jpg`)}"`)
  rmSync(join(OUT, `${name}.png`))
  console.log(`✓ ${name}.jpg`)
}
const strip = encodePng(1920, 24, renderStrip(1920, 24))
writeFileSync(join(OUT, 'brand-strip.png'), strip)
console.log(`✓ brand-strip.png (${(strip.length / 1024).toFixed(0)} KB)`)
