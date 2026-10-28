import { afterEach, describe, expect, it, vi } from 'vitest'
import { higgsfieldConfigFromEnv, higgsfieldProvider } from '../src/lib/images/higgsfield.ts'

const cfg = { keyId: 'id', keySecret: 'secret' }

function respondeCom(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('driver Higgsfield', () => {
  it('sem credencial falha EXPLICITAMENTE, nunca em silêncio', async () => {
    const p = higgsfieldProvider(null)
    expect(await p.start({ prompt: 'x', framing: 'paisagem' })).toEqual({
      error: 'HF_CREDENTIALS ausente no ambiente',
    })
    expect(await p.check('abc')).toEqual({
      status: 'falhou',
      error: 'HF_CREDENTIALS ausente no ambiente',
    })
  })

  it('lê HF_CREDENTIALS no formato KEY_ID:KEY_SECRET', () => {
    vi.stubEnv('HF_CREDENTIALS', 'abc:def')
    expect(higgsfieldConfigFromEnv()).toEqual({ keyId: 'abc', keySecret: 'def' })
  })

  it('fala o contrato MEDIDO: POST no modelo /v2, corpo cru, Authorization: Key', async () => {
    const fetchMock = respondeCom(200, { status: 'queued', request_id: 'req-1' })
    vi.stubGlobal('fetch', fetchMock)
    const r = await higgsfieldProvider(cfg).start({ prompt: 'uma cena', framing: 'retrato' })
    expect(r).toEqual({ handle: 'req-1' })

    const [url, init] = fetchMock.mock.calls[0]
    // o caminho é o MODELO — não a superfície legada /v1/text2image/soul, que
    // aceita, DEBITA e nunca processa
    expect(url).toBe('https://platform.higgsfield.ai/higgsfield-ai/soul/v2/standard')
    expect(url).not.toContain('/v1/')
    expect(init.headers.Authorization).toBe('Key id:secret')
    expect(init.headers['hf-api-key']).toBeUndefined()

    const body = JSON.parse(init.body)
    expect(body).toEqual({
      prompt: 'uma cena',
      style_id: '3db34ab5-3439-4317-9e03-08dc30852e69',
      style_strength: 1,
      aspect_ratio: '2:3',
      resolution: '1080p',
    })
    expect(body.params).toBeUndefined()
  })

  it('o modelo é o /v2 — sem ele o job é aceito, cobrado e falha calado', async () => {
    const fetchMock = respondeCom(200, { status: 'queued', request_id: 'r' })
    vi.stubGlobal('fetch', fetchMock)
    await higgsfieldProvider(cfg).start({ prompt: 'x', framing: 'paisagem' })
    expect(fetchMock.mock.calls[0][0]).toContain('/soul/v2/standard')
  })

  it('SEMPRE manda style_id — é o campo cuja falta fingia ser fila travada', async () => {
    const fetchMock = respondeCom(200, { status: 'queued', request_id: 'r' })
    vi.stubGlobal('fetch', fetchMock)
    for (const framing of ['paisagem', 'retrato', 'quadrado'] as const) {
      await higgsfieldProvider(cfg).start({ prompt: 'x', framing })
    }
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(init.body)
      expect(body.style_id).toBeTruthy()
      expect(body.style_strength).toBe(1)
    }
  })

  it('manda User-Agent NOSSO em toda chamada — sem ele a plataforma dá 403', async () => {
    const fetchMock = respondeCom(200, { status: 'queued', request_id: 'r' })
    vi.stubGlobal('fetch', fetchMock)
    await higgsfieldProvider(cfg).start({ prompt: 'x', framing: 'paisagem' })
    await higgsfieldProvider(cfg).check('r')
    expect(fetchMock.mock.calls).toHaveLength(2)
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers['User-Agent']).toBe('personal-teacher-os/1.0')
    }
  })

  it('devolve o erro de saldo como texto do provedor', async () => {
    vi.stubGlobal('fetch', respondeCom(402, { detail: 'Not enough credits' }))
    expect(await higgsfieldProvider(cfg).start({ prompt: 'x', framing: 'paisagem' })).toEqual({
      error: 'Not enough credits',
    })
  })

  it('consulta em /requests/{id}/status — não em /v1/job-sets', async () => {
    const fetchMock = respondeCom(200, { status: 'queued' })
    vi.stubGlobal('fetch', fetchMock)
    await higgsfieldProvider(cfg).check('req-9')
    expect(fetchMock.mock.calls[0][0]).toBe('https://platform.higgsfield.ai/requests/req-9/status')
  })

  it('queued e in_progress são PENDENTE (não erro)', async () => {
    for (const status of ['queued', 'in_progress']) {
      vi.stubGlobal('fetch', respondeCom(200, { status }))
      expect(await higgsfieldProvider(cfg).check('s')).toEqual({ status: 'pendente' })
    }
  })

  it('recusa de conteúdo é desfecho próprio — não vira retentativa', async () => {
    vi.stubGlobal('fetch', respondeCom(200, { status: 'nsfw' }))
    const r = await higgsfieldProvider(cfg).check('s')
    expect(r.status).toBe('recusada')
  })

  it('completado sem imagem é FALHA, não sucesso vazio', async () => {
    vi.stubGlobal('fetch', respondeCom(200, { status: 'completed', images: [] }))
    const r = await higgsfieldProvider(cfg).check('s')
    expect(r).toEqual({ status: 'falhou', error: 'completou sem imagem' })
  })

  it('colhe as URLs quando pronto', async () => {
    vi.stubGlobal(
      'fetch',
      respondeCom(200, {
        status: 'completed',
        images: [{ url: 'https://x/1.png' }, { url: 'https://x/2.png' }],
      }),
    )
    expect(await higgsfieldProvider(cfg).check('s')).toEqual({
      status: 'pronta',
      urls: ['https://x/1.png', 'https://x/2.png'],
    })
  })

  it('corpo de erro NÃO-JSON não vira exceção genérica — o HTTP sobrevive', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('Unexpected token < in JSON')
        },
      }),
    )
    expect(await higgsfieldProvider(cfg).start({ prompt: 'x', framing: 'paisagem' })).toEqual({
      error: 'HTTP 502',
    })
    expect(await higgsfieldProvider(cfg).check('h')).toEqual({ status: 'falhou', error: 'HTTP 502' })
  })

  it('toda chamada leva prazo — server action não fica pendurada na rede', async () => {
    const fetchMock = respondeCom(200, { status: 'queued', request_id: 'r' })
    vi.stubGlobal('fetch', fetchMock)
    await higgsfieldProvider(cfg).start({ prompt: 'x', framing: 'paisagem' })
    await higgsfieldProvider(cfg).check('r')
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.signal).toBeInstanceOf(AbortSignal)
    }
  })
})
