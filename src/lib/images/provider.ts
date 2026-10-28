// IM-1 — adaptador NEUTRO de geração de imagem, no mesmo molde do
// notify/channel.ts. Trocar de provedor (Higgsfield → gpt-image → fal.ai) =
// trocar o driver, nada mais.
//
// Por que neutro, e não chamada direta: o doc 03 §7 previu que a API do
// Higgsfield é imatura, e a prova do IM-0 confirmou em três frentes — o SDK
// oficial declara um tipo (`V2Response`) que a API não devolve (ela devolve um
// job set), os endpoints /v1/* exigem o corpo embrulhado em `params` enquanto o
// SDK manda cru, e a dimensão vem de uma lista fechada em vez de aspect ratio
// livre. Nada disso pode vazar para dentro do renderer ou do painel.

/** Enquadramento pedido pelo slide — o driver traduz para o que o provedor aceita. */
export type ImageFraming = 'paisagem' | 'retrato' | 'quadrado'

/**
 * UMA chamada gera UMA imagem. Não há `count` aqui de propósito: a primeira
 * versão desta interface prometia N candidatas e o driver do Higgsfield
 * ignorava o campo em silêncio — quem pedisse 4 receberia 1 sem qualquer
 * aviso, que é exatamente a degradação silenciosa que o projeto proíbe.
 * Quando o IM-2 precisar de várias candidatas para a curadoria comparar, o
 * leque é responsabilidade de quem chama (N pedidos), e o desenho entra com
 * teste — não como campo decorativo na interface.
 */
export interface ImageRequest {
  prompt: string
  framing: ImageFraming
}

/**
 * Devolve um handle e a imagem fica pronta depois; o painel consulta enquanto a
 * professora está ali. É o formato do Higgsfield.
 */
export interface ImageJob {
  /** identificador do lote no provedor — guardado em slide_images */
  handle: string
}

/** bytes crus com o mimeType REAL — a extensão sai daqui, nunca de chute */
export interface ImageBytes {
  data: Uint8Array
  mimeType: string
}

/**
 * Provedor que responde na mesma chamada, com os bytes na mão.
 *
 * A versão anterior deste arquivo afirmava que "geração é assíncrona em todo
 * provedor sério". Era falso: a API de imagem do Gemini devolve a imagem no
 * corpo da resposta, em ~15s. Fingir que é assíncrona custaria um handle
 * inventado e um cache em memória que morre no primeiro restart do container.
 */
export interface ImageReady {
  ready: ImageBytes[]
}

export type ImageStarted = ImageJob | ImageReady | { error: string }

export const veioPronta = (r: ImageStarted): r is ImageReady => 'ready' in r
export const ficouPendente = (r: ImageStarted): r is ImageJob => 'handle' in r

export type ImageJobState =
  | { status: 'pendente' }
  | { status: 'pronta'; urls: string[] }
  | { status: 'falhou'; error: string }
  /** recusa de conteúdo do provedor — não é erro de sistema, não retenta */
  | { status: 'recusada'; error: string }

export interface ImageProvider {
  /** nome curto para auditoria e para a UI ("gemini", "higgsfield") */
  readonly name: string
  start(request: ImageRequest): Promise<ImageStarted>
  /**
   * Só faz sentido para provedor assíncrono. Provedor síncrono devolve erro
   * EXPLÍCITO aqui — melhor estourar do que devolver 'pendente' para sempre a
   * um handle que nunca existiu.
   */
  check(handle: string): Promise<ImageJobState>
}

export type ImageProviderRegistry = Partial<Record<string, ImageProvider>>
