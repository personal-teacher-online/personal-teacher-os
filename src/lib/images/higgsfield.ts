import type { ImageJob, ImageJobState, ImageProvider, ImageRequest } from './provider.ts'

// Driver Higgsfield (ADR-023, adendo 3 — "RESOLVIDO: faltava style_id").
//
// Contrato MEDIDO em 22/07/2026, com imagem saindo de verdade (35s):
//   POST https://platform.higgsfield.ai/higgsfield-ai/soul/v2/standard
//     header Authorization: Key {key_id}:{key_secret}
//     header User-Agent: <qualquer um NOSSO>            // ver armadilha 2 abaixo
//     body   { prompt, style_id, style_strength, aspect_ratio, resolution }
//     → 200  { status, request_id, status_url, cancel_url }
//   GET  https://platform.higgsfield.ai/requests/{request_id}/status
//   GET  https://platform.higgsfield.ai/v1/text2image/soul-styles/v2   // 33 estilos
//
// Implementado com `fetch` cru, NÃO com o @higgsfield/client: são quatro
// chamadas contra um contrato que hoje está medido linha a linha, e o SDK
// acrescentaria uma dependência sem tirar nenhuma decisão nossa. (A versão
// anterior deste comentário afirmava usar o SDK enquanto o código usava fetch.)
//
// ⚠️ Armadilha 1 — `style_id` é OBRIGATÓRIO na prática. Sem ele o pedido é
// aceito, vira job, é COBRADO, é tentado e falha com um `"Generation failed"`
// mudo; e a fila leva ~90 min para carimbar `failed`, então o defeito se
// disfarça de travamento. O crédito volta, mas o tempo não.
//
// ⚠️ Armadilha 2 — sem `User-Agent` próprio a plataforma responde 403. O agente
// padrão do `python-urllib` é barrado; o do `fetch` do Node não foi verificado
// contra a proteção deles, então mandamos o nosso e acabou a dúvida.
//
// Lição de método que este arquivo carrega desde o incidente original: erro de
// servidor não é bússola. "body.params: Field required" pareceu progresso
// quando era o aviso de porta errada — e, meses depois, `queued` eterno pareceu
// fila quebrada quando era campo faltando. Doc e console primeiro.
//
// Fail-closed como o driver do Evolution: sem credencial devolve erro
// EXPLÍCITO, nunca silêncio.

/** modelo atual de texto→imagem; o `/v2` NÃO é opcional (ver armadilha 1) */
const MODELO = 'higgsfield-ai/soul/v2/standard'

/**
 * Estilo aplicado a TODA foto de aula — escolhido pelo mantenedor em 22/07 entre
 * quatro candidatos gerados na mesma cena ("General", a base mais neutra), com
 * o critério de parecer irmão das 33 fotos que já estão nos módulos 5–7.
 *
 * É decisão de MARCA, não parâmetro técnico: mudar aqui muda a cara de tudo que
 * for gerado daqui para frente, e não mexe no que já existe. Por isso o estilo
 * de cada imagem é gravado junto dela em `slide_images` (procedência, como o
 * prompt) — senão a auditoria não sabe dizer de onde veio cada foto.
 */
const ESTILO = '3db34ab5-3439-4317-9e03-08dc30852e69'

/** 0..1 — o quanto o estilo puxa a imagem; 1 é o padrão do console */
const FORCA_DO_ESTILO = 1

/** identifica a gente na plataforma e evita o 403 da armadilha 2 */
const USER_AGENT = 'personal-teacher-os/1.0'

/** a API do modelo aceita aspect ratio livre; o template usa estes três */
const PROPORCAO = {
  paisagem: '3:2',
  retrato: '2:3',
  quadrado: '1:1',
} as const

/** medido em 22/07: `3:2` + `1080p` no v2 devolve 2016×1344 — folga para slide */
const RESOLUCAO = '1080p'

export interface HiggsfieldConfig {
  keyId: string
  keySecret: string
}

export function higgsfieldConfigFromEnv(): HiggsfieldConfig | null {
  const cred = process.env.HF_CREDENTIALS
  if (cred?.includes(':')) {
    const [keyId, ...resto] = cred.split(':')
    return { keyId, keySecret: resto.join(':') }
  }
  const keyId = process.env.HF_API_KEY
  const keySecret = process.env.HF_API_SECRET
  if (!keyId || !keySecret) return null
  return { keyId, keySecret }
}

const BASE = 'https://platform.higgsfield.ai'

/**
 * Teto de espera de CADA chamada HTTP. Sem isto uma server action fica pendurada
 * na rede — e esta noite mostrou que jobs deste provedor ficam pendentes por
 * dezenas de minutos. Pendência longa é do JOB (o `check` devolve 'pendente');
 * a chamada em si tem prazo.
 */
const TIMEOUT_MS = 20_000

/** shape documentado da resposta, igual ao `V2Response` do SDK */
interface RequestResponse {
  status?: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'cancelled'
  request_id?: string
  images?: Array<{ url?: string }>
  detail?: string
}

/** o corpo de erro nem sempre é JSON — não deixar isso virar exceção genérica */
async function corpoJson(r: Response): Promise<RequestResponse> {
  try {
    return (await r.json()) as RequestResponse
  } catch {
    return {}
  }
}

export function higgsfieldProvider(config: HiggsfieldConfig | null): ImageProvider {
  const auth = (): Record<string, string> => ({
    Authorization: `Key ${config?.keyId ?? ''}:${config?.keySecret ?? ''}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
  })

  return {
    name: 'higgsfield',

    async start(request: ImageRequest): Promise<ImageJob | { error: string }> {
      if (!config) return { error: 'HF_CREDENTIALS ausente no ambiente' }
      try {
        const r = await fetch(`${BASE}/${MODELO}`, {
          method: 'POST',
          headers: auth(),
          body: JSON.stringify({
            prompt: request.prompt,
            style_id: ESTILO,
            style_strength: FORCA_DO_ESTILO,
            aspect_ratio: PROPORCAO[request.framing],
            resolution: RESOLUCAO,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        const corpo = await corpoJson(r)
        if (!r.ok) {
          // "Not enough credits" chega aqui — erro de saldo, não de sistema.
          return { error: corpo.detail ?? `HTTP ${r.status}` }
        }
        if (!corpo.request_id) return { error: 'resposta sem request_id' }
        return { handle: corpo.request_id }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    },

    async check(handle: string): Promise<ImageJobState> {
      if (!config) return { status: 'falhou', error: 'HF_CREDENTIALS ausente no ambiente' }
      try {
        const r = await fetch(`${BASE}/requests/${handle}/status`, {
          headers: auth(),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        const corpo = await corpoJson(r)
        if (!r.ok) return { status: 'falhou', error: corpo.detail ?? `HTTP ${r.status}` }
        switch (corpo.status) {
          case 'queued':
          case 'in_progress':
            return { status: 'pendente' }
          // recusa de conteúdo é desfecho próprio: não retenta, não é bug nosso
          case 'nsfw':
            return { status: 'recusada', error: 'o provedor recusou o conteúdo do prompt' }
          case 'failed':
          case 'cancelled':
            return { status: 'falhou', error: `o provedor encerrou como ${corpo.status}` }
          case 'completed': {
            const urls = (corpo.images ?? [])
              .map((i) => i.url)
              .filter((u): u is string => Boolean(u))
            if (!urls.length) return { status: 'falhou', error: 'completou sem imagem' }
            return { status: 'pronta', urls }
          }
          default:
            return { status: 'falhou', error: `status desconhecido: ${corpo.status ?? 'ausente'}` }
        }
      } catch (e) {
        return { status: 'falhou', error: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}
