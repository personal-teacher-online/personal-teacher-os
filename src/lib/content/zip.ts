// ZIP "store" (sem compressão) escrito à mão — deliberadamente SEM dependência
// nova: o package.json é compartilhado com o projeto de slides e imagens PNG já
// vêm comprimidas (deflate pouparia ~0%). Formato: local file headers + central
// directory + EOCD (PKZIP appnote §4.3), CRC-32 tabelado.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  /** nome do arquivo dentro do zip (ASCII simples — sem acento, o painel gera) */
  name: string
  data: Uint8Array
}

/** Monta um .zip válido (método store) a partir das entradas, em memória. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBytes = new TextEncoder().encode(name)
    const crc = crc32(data)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true) // local file header
    local.setUint16(4, 20, true) // versão mínima
    local.setUint16(6, 0, true) // flags
    local.setUint16(8, 0, true) // método 0 = store
    local.setUint16(10, 0, true) // hora (não usada)
    local.setUint16(12, 0, true) // data (não usada)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true) // comprimido = original (store)
    local.setUint32(22, data.length, true)
    local.setUint16(26, nameBytes.length, true)
    local.setUint16(28, 0, true) // extra
    chunks.push(new Uint8Array(local.buffer), nameBytes, data)

    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true) // central directory header
    cen.setUint16(4, 20, true)
    cen.setUint16(6, 20, true)
    cen.setUint16(8, 0, true)
    cen.setUint16(10, 0, true)
    cen.setUint16(12, 0, true)
    cen.setUint16(14, 0, true)
    cen.setUint32(16, crc, true)
    cen.setUint32(20, data.length, true)
    cen.setUint32(24, data.length, true)
    cen.setUint16(28, nameBytes.length, true)
    cen.setUint32(42, offset, true) // offset do local header
    central.push(new Uint8Array(cen.buffer), nameBytes)

    offset += 30 + nameBytes.length + data.length
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0)
  const eocd = new DataView(new ArrayBuffer(22))
  eocd.setUint32(0, 0x06054b50, true) // end of central directory
  eocd.setUint16(8, entries.length, true)
  eocd.setUint16(10, entries.length, true)
  eocd.setUint32(12, centralSize, true)
  eocd.setUint32(16, offset, true)
  chunks.push(...central, new Uint8Array(eocd.buffer))

  const total = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}
