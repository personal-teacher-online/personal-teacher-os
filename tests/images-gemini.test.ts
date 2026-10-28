import { afterEach, describe, expect, it, vi } from 'vitest'
import { geminiConfigFromEnv, geminiProvider } from '../src/lib/images/gemini.ts'
import { ficouPendente, veioPronta } from '../src/lib/images/provider.ts'

const cfg = { apiKey: 'chave-de-teste' }

/** parte de imagem no formato que a API devolve de verdade */
const parteImagem = (mimeType: string | undefined, texto = 'bytes') => ({
  inlineData: { mimeType, data: Buffer.from(texto).toString('base64') },
})

function respondeCom(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body })
}

const comImagens = (...partes: unknown[]) =>
  respondeCom(200, { candidates: [{ content: { parts: partes } }] })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('driver Gemini (Nano Banana 2)', () => {
  it('sem credencial falha EXPLICITAMENTE, nunca em silêncio', async () => {
    const p = geminiProvider(null)
    expect(await p.start({ prompt: 'x', framing: 'paisagem' })).toEqual({
      error: 'GEMINI_API_KEY ausente no ambiente',
    })
  })

  it('lê GEMINI_API_KEY do ambiente', () => {
    vi.stubEnv('GEMINI_API_KEY', 'abc')
    expect(geminiConfigFromEnv()).toEqual({ apiKey: 'abc' })
    vi.stubEnv('GEMINI_API_KEY', '')
    expect(geminiConfigFromEnv()).toBeNull()
  })

  it('fala o contrato medido: modelo Nano Banana 2, prompt em contents.parts', async () => {
    const fetchMock = comImagens(parteImagem('image/jpeg'))
    vi.stubGlobal('fetch', fetchMock)
    await geminiProvider(cfg).start({ prompt: 'uma cena', framing: 'paisagem' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/models/gemini-3.1-flash-image:generateContent')
    expect(url).toContain('key=chave-de-teste')
    const body = JSON.parse(init.body)
    expect(body.contents[0].parts[0].text).toBe('uma cena')
  })

  it('traduz o enquadramento do template para a proporção do provedor', async () => {
    for (const [framing, esperado] of [
      ['paisagem', '3:2'],
      ['retrato', '2:3'],
      ['quadrado', '1:1'],
    ] as const) {
      const fetchMock = comImagens(parteImagem('image/jpeg'))
      vi.stubGlobal('fetch', fetchMock)
      await geminiProvider(cfg).start({ prompt: 'x', framing })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.generationConfig.imageConfig.aspectRatio).toBe(esperado)
    }
  })

  it('é SÍNCRONO: devolve os bytes na hora, sem handle', async () => {
    vi.stubGlobal('fetch', comImagens(parteImagem('image/jpeg', 'foto')))
    const r = await geminiProvider(cfg).start({ prompt: 'x', framing: 'paisagem' })
    expect(veioPronta(r)).toBe(true)
    expect(ficouPendente(r)).toBe(false)
    if (!veioPronta(r)) throw new Error('esperava pronta')
    expect(Buffer.from(r.ready[0].data).toString()).toBe('foto')
  })

  // O erro que eu cometi no teste de 22/07: salvei JPEG com nome .png. Em
  // produção isso vira arquivo mentindo sobre o conteúdo para o Drive e para o
  // renderer, e ninguém descobre até o slide sair quebrado.
  it('devolve o mimeType REAL do provedor — a extensão nunca é chute', async () => {
    vi.stubGlobal('fetch', comImagens(parteImagem('image/jpeg')))
    const r = await geminiProvider(cfg).start({ prompt: 'x', framing: 'paisagem' })
    if (!veioPronta(r)) throw new Error('esperava pronta')
    expect(r.ready[0].mimeType).toBe('image/jpeg')
    expect(r.ready[0].mimeType).not.toBe('image/png')
  })

  it('imagem SEM mimeType é descartada — sem ele não dá para nomear o arquivo', async () => {
    vi.stubGlobal('fetch', comImagens(parteImagem(undefined)))
    const r = await geminiProvider(cfg).start({ prompt: 'x', framing: 'paisagem' })
    expect(r).toEqual({ error: 'o provedor não devolveu imagem' })
  })

  it('saldo esgotado chega com a mensagem do provedor, inteira', async () => {
    vi.stubGlobal(
      'fetch',
      respondeCom(429, {
        error: { message: 'Your prepayment credits are depleted.', status: 'RESOURCE_EXHAUSTED' },
      }),
    )
    expect(await geminiProvider(cfg).start({ prompt: 'x', framing: 'paisagem' })).toEqual({
      error: 'Your prepayment credits are depleted.',
    })
  })

  it('resposta sem imagem carrega o motivo do provedor', async () => {
    vi.stubGlobal('fetch', respondeCom(200, { candidates: [{ finishReason: 'SAFETY' }] }))
    expect(await geminiProvider(cfg).start({ prompt: 'x', framing: 'paisagem' })).toEqual({
      error: 'o provedor não devolveu imagem (SAFETY)',
    })
  })

  it('corpo de erro NÃO-JSON não vira exceção genérica', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('Unexpected token <')
        },
      }),
    )
    expect(await geminiProvider(cfg).start({ prompt: 'x', framing: 'paisagem' })).toEqual({
      error: 'HTTP 502',
    })
  })

  it('a chamada leva prazo — server action não fica pendurada na rede', async () => {
    const fetchMock = comImagens(parteImagem('image/jpeg'))
    vi.stubGlobal('fetch', fetchMock)
    await geminiProvider(cfg).start({ prompt: 'x', framing: 'paisagem' })
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('check() falha EXPLÍCITO — provedor síncrono não tem handle para consultar', async () => {
    const r = await geminiProvider(cfg).check('qualquer-coisa')
    expect(r.status).toBe('falhou')
    expect(r).toHaveProperty('error')
  })
})
