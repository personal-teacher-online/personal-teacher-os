// "Carrossel com um clique" (ADR-021): ZIP artesanal + grifos + render real dos
// cartões via ImageResponse (next/og, fonte default embutida). Sem banco.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageResponse } from 'next/og'
import {
  capaCard,
  cardSize,
  cenaCard,
  extrairTermo,
  semEmoji,
  splitHighlights,
  textoCard,
} from '@/lib/content/compose'
import { buildZip, crc32 } from '@/lib/content/zip'

describe('zip artesanal (método store)', () => {
  it('crc32 bate com o vetor clássico', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('monta um zip válido: assinaturas, contagem e dados intactos', () => {
    const a = new TextEncoder().encode('hello')
    const zip = buildZip([
      { name: 'slide-01.png', data: a },
      { name: 'slide-02.png', data: new Uint8Array([1, 2, 3]) },
    ])
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(dv.getUint32(0, true)).toBe(0x04034b50) // local file header
    expect(dv.getUint32(zip.length - 22, true)).toBe(0x06054b50) // EOCD
    expect(dv.getUint16(zip.length - 22 + 10, true)).toBe(2) // 2 entradas
    // dados do 1º arquivo logo após header(30) + nome(12)
    expect(new TextDecoder().decode(zip.slice(42, 47))).toBe('hello')
  })
})

describe('grifos (MAIÚSCULAS → destaque)', () => {
  it('marca só as palavras em caps, preservando o resto', () => {
    const partes = splitHighlights('Aprenda SET OFF antes da viagem, ok?')
    expect(partes).toEqual([
      { text: 'Aprenda ', hl: false },
      { text: 'SET OFF', hl: true },
      { text: ' antes da viagem, ok?', hl: false },
    ])
  })

  it('texto sem caps não ganha grifo; acentos contam', () => {
    expect(splitHighlights('tudo minúsculo aqui').every((p) => !p.hl)).toBe(true)
    expect(splitHighlights('use SAUDADE à vontade')[1]).toEqual({ text: 'SAUDADE', hl: true })
  })
})

function pngSize(buf: ArrayBuffer): { width: number; height: number } {
  const dv = new DataView(buf)
  // assinatura PNG + IHDR: largura/altura big-endian nos offsets 16/20
  expect(dv.getUint32(0)).toBe(0x89504e47)
  return { width: dv.getUint32(16), height: dv.getUint32(20) }
}

// PNG 1x1 transparente — cena mínima válida para o satori carregar.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('render dos cartões (satori/resvg do next/og)', () => {
  it('cartão de texto sai PNG 1080x1350 (4:5)', async () => {
    const { width, height } = cardSize('carrossel')
    const png = await new ImageResponse(
      textoCard({
        slide: { ordem: 2, titulo: 'Set off', texto: 'Use SET OFF para partir de viagem.' },
        total: 5,
        kind: 'carrossel',
      }),
      { width, height },
    ).arrayBuffer()
    expect(pngSize(png)).toEqual({ width: 1080, height: 1350 })
  })

  it('capa sem foto (fallback de tinta) sai PNG no formato de story (9:16)', async () => {
    const { width, height } = cardSize('story')
    const png = await new ImageResponse(
      capaCard({ fotoDataUrl: null, gancho: 'Já travou no inglês da imigração?', kind: 'story' }),
      { width, height },
    ).arrayBuffer()
    expect(pngSize(png)).toEqual({ width: 1080, height: 1920 })
  })

  it('cartão COM cena de fundo sai PNG 1080x1350', async () => {
    const { width, height } = cardSize('carrossel')
    const png = await new ImageResponse(
      cenaCard({
        slide: { ordem: 3, titulo: 'O Terminal', texto: 'Essa conexão longa é chamada de LAYOVER.' },
        total: 6,
        kind: 'carrossel',
        cenaDataUrl: PIXEL,
      }),
      { width, height },
    ).arrayBuffer()
    expect(pngSize(png)).toEqual({ width: 1080, height: 1350 })
  })

  it('último cartão (cta) e cartão sem cena também renderizam', async () => {
    const { width, height } = cardSize('carrossel')
    const cta = await new ImageResponse(
      cenaCard({
        slide: { ordem: 6, titulo: 'Quer viajar com confiança?', texto: 'Link na bio.' },
        total: 6,
        kind: 'carrossel',
        cenaDataUrl: PIXEL,
        cta: true,
      }),
      { width, height },
    ).arrayBuffer()
    expect(pngSize(cta)).toEqual({ width: 1080, height: 1350 })

    const semCena = await new ImageResponse(
      cenaCard({
        slide: { ordem: 2, texto: 'Sem imagem, ainda assim legível.' },
        total: 6,
        kind: 'carrossel',
        cenaDataUrl: null,
      }),
      { width, height },
    ).arrayBuffer()
    expect(pngSize(semCena)).toEqual({ width: 1080, height: 1350 })
  })
})

describe('emoji fora da capa (regra do mantenedor, 21/07)', () => {
  it('remove pictograma, bandeira e seletor de variação, sem comer o texto', () => {
    expect(semEmoji('Perrengues de aeroporto ✈️🍿')).toBe('Perrengues de aeroporto')
    expect(semEmoji('Inglês 🇺🇸 para viagem')).toBe('Inglês para viagem')
    expect(semEmoji('Sem emoji nenhum aqui')).toBe('Sem emoji nenhum aqui')
  })

  it('não estraga acento nem pontuação', () => {
    expect(semEmoji('Já travou na imigração? 😰')).toBe('Já travou na imigração?')
  })
})

describe('termo-alvo vira o herói do cartão', () => {
  const junta = (ps: Array<{ text: string }>) => ps.map((p) => p.text).join('')

  it('extrai o trecho em caps do FIM do texto, sem a pontuação', () => {
    const a = extrairTermo('Essa conexão longa é chamada de LAYOVER.')
    expect(a.termo).toBe('LAYOVER')
    expect(junta(a.partes)).toBe('Essa conexão longa é chamada de')

    const b = extrairTermo('O termo técnico é LOST BAGGAGE')
    expect(b.termo).toBe('LOST BAGGAGE')
    expect(junta(b.partes)).toBe('O termo técnico é')
  })

  it('não extrai quando o trecho em caps está no MEIO — mas mantém o grifo', () => {
    const r = extrairTermo('Use SET OFF antes da viagem, combinado?')
    expect(r.termo).toBeNull()
    expect(junta(r.partes)).toBe('Use SET OFF antes da viagem, combinado?')
    expect(r.partes.find((p) => p.hl)?.text).toBe('SET OFF')
  })

  it('texto sem caps nenhum não vira faixa', () => {
    expect(extrairTermo('nada em maiúsculas por aqui').termo).toBeNull()
  })

  // Regressão do primeiro post real (22/07): o gerador pôs a expressão-alvo
  // entre aspas no MEIO e terminou com "demonstra total CONFIANÇA" — a v1
  // estampava CONFIANÇA na faixa, que é ênfase, não a lição.
  it('não elege a palavra solta do fim quando há expressão mais longa na frase', () => {
    const r = extrairTermo(
      'Peça assim: "I\'D LIKE A FLAT WHITE, PLEASE". Essa estrutura demonstra total CONFIANÇA.',
    )
    expect(r.termo).not.toBe('CONFIANÇA')
    expect(r.termo).toBeNull()
    expect(r.partes.some((p) => p.hl && p.text.includes('FLAT WHITE'))).toBe(true)
  })

  it('o termo explícito do gerador manda, e some do corpo quando está no fim', () => {
    const r = extrairTermo(
      'Peça assim: "I\'D LIKE A FLAT WHITE, PLEASE". Essa estrutura demonstra total CONFIANÇA.',
      "I'D LIKE A FLAT WHITE, PLEASE",
    )
    expect(r.termo).toBe("I'D LIKE A FLAT WHITE, PLEASE")
    // ficou no meio da frase, então o corpo continua inteiro
    expect(junta(r.partes)).toContain('demonstra total CONFIANÇA')

    const fim = extrairTermo('Essa conexão longa é chamada de LAYOVER.', 'LAYOVER')
    expect(fim.termo).toBe('LAYOVER')
    expect(junta(fim.partes)).toBe('Essa conexão longa é chamada de')
  })
})

describe('rodapé do cartão', () => {
  it('traz o identificador e o nome novo da escola', async () => {
    const { RODAPE, HANDLE } = await import('@/lib/content/compose')
    expect(RODAPE).toBe(`${HANDLE} · Personal Teacher Academy`)
  })
})

describe('identificador assinado no cartão (config)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('sem CONTENT_HANDLE: o padrão neutro @escola', async () => {
    vi.resetModules()
    vi.stubEnv('CONTENT_HANDLE', '')
    const { HANDLE } = await import('@/lib/content/compose')
    expect(HANDLE).toBe('@escola')
  })

  it('com CONTENT_HANDLE: o valor da env', async () => {
    vi.resetModules()
    vi.stubEnv('CONTENT_HANDLE', '@minha_escola')
    const { HANDLE } = await import('@/lib/content/compose')
    expect(HANDLE).toBe('@minha_escola')
  })
})
