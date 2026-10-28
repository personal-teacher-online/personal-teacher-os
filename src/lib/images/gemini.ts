import type { ImageBytes, ImageJobState, ImageProvider, ImageRequest, ImageStarted } from './provider.ts'

// Driver Gemini / Nano Banana 2 — o provedor PADRÃO das fotos de aula
// (ADR-023, adendo de 22/07/2026).
//
// Por que este e não o Higgsfield: `gemini-3.1-flash-image` é o mesmo motor que
// produziu as 33 fotos que já estão nos módulos 5–7 (o app da Higgsfield o expõe
// como `nano_banana_2`), e a API da Higgsfield NÃO o vende — o catálogo dela é a
// família Soul, que inventa texto dentro da imagem. Medição de 22/07, mesma cena
// e mesmo prompt: Soul V2 deu 1 de 4 aproveitáveis, Nano Banana 2 deu 3 de 4, e
// 4 de 4 com as alavancas do prompt.ts.
//
// Contrato MEDIDO:
//   POST https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent?key=…
//     body { contents:[{parts:[{text}]}], generationConfig:{ imageConfig:{ aspectRatio } } }
//     → 200 { candidates:[{ content:{ parts:[{ inlineData:{ mimeType, data(base64) } }] } }] }
//
// SÍNCRONO: a imagem vem no corpo, em ~15s. Não há job, não há polling.
//
// ⚠️ O corpo devolve JPEG, não PNG. A extensão TEM de sair do `mimeType` — no
// teste de 22/07 eu salvei JPEG com nome .png, e em produção isso viraria
// arquivo mentindo sobre o próprio conteúdo para o Drive e para o renderer.

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/** "Nano Banana 2" — o mesmo motor das fotos que já estão no curso */
const MODELO = 'gemini-3.1-flash-image'

/** proporção por enquadramento do template */
const PROPORCAO = {
  paisagem: '3:2',
  retrato: '2:3',
  quadrado: '1:1',
} as const

/**
 * Teto de CADA chamada. A geração leva ~15s; 60s dá folga para pico sem deixar
 * uma server action pendurada na rede.
 */
const TIMEOUT_MS = 60_000

export interface GeminiConfig {
  apiKey: string
}

export function geminiConfigFromEnv(): GeminiConfig | null {
  const apiKey = process.env.GEMINI_API_KEY
  return apiKey ? { apiKey } : null
}

interface RespostaGemini {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }
    finishReason?: string
  }>
  error?: { message?: string; status?: string }
}

/** corpo de erro nem sempre é JSON — não deixar virar exceção genérica */
async function corpoJson(r: Response): Promise<RespostaGemini> {
  try {
    return (await r.json()) as RespostaGemini
  } catch {
    return {}
  }
}

function colheImagens(corpo: RespostaGemini): ImageBytes[] {
  const partes = corpo.candidates?.[0]?.content?.parts ?? []
  const saida: ImageBytes[] = []
  for (const p of partes) {
    const inline = p.inlineData
    if (!inline?.data) continue
    saida.push({
      data: Uint8Array.from(Buffer.from(inline.data, 'base64')),
      // sem mimeType não dá para nomear o arquivo: melhor falhar do que chutar
      mimeType: inline.mimeType ?? '',
    })
  }
  return saida.filter((i) => i.mimeType !== '')
}

export function geminiProvider(config: GeminiConfig | null): ImageProvider {
  return {
    name: 'gemini',

    async start(request: ImageRequest): Promise<ImageStarted> {
      if (!config) return { error: 'GEMINI_API_KEY ausente no ambiente' }
      try {
        const r = await fetch(`${BASE}/${MODELO}:generateContent?key=${config.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: request.prompt }] }],
            generationConfig: { imageConfig: { aspectRatio: PROPORCAO[request.framing] } },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        const corpo = await corpoJson(r)
        if (!r.ok) {
          // saldo esgotado chega como 429 com mensagem clara — repassar inteira,
          // porque quem lê precisa saber que é dinheiro e não sistema
          return { error: corpo.error?.message ?? `HTTP ${r.status}` }
        }
        const imagens = colheImagens(corpo)
        if (!imagens.length) {
          const motivo = corpo.candidates?.[0]?.finishReason
          return {
            error: motivo
              ? `o provedor não devolveu imagem (${motivo})`
              : 'o provedor não devolveu imagem',
          }
        }
        return { ready: imagens }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    },

    async check(): Promise<ImageJobState> {
      return {
        status: 'falhou',
        error: 'o Gemini responde na hora — não existe handle para consultar',
      }
    },
  }
}
