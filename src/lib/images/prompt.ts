// IM-1 — sugestão de prompt a partir do CONTEÚDO do slide. A professora abre o
// painel e já encontra um prompt escrito; edita se quiser. Função pura: nada de
// rede aqui (a chamada ao provedor é do driver).
//
// A política de estilo é a do repo, e ela é lei — não decoração:
//  - NENHUMA imagem força a paleta da marca (revogado em 22/07 depois que o
//    PRACTICE TIME do M5 saiu com escada rolante em roxo/teal neon). A marca
//    está no fundo noturno, no fio e na tipografia; dentro da foto é luz natural.
//  - Sem mãos em close — o dedo deformado é o artefato clássico.
//  - Texto dentro da imagem: proibido gerar por IA (Lei 11).
import type { ImageFraming } from './provider.ts'
import type { SlideSpec } from '../slides/lesson-schema.ts'

/**
 * Cabeçalho comum a toda foto de conteúdo do curso.
 *
 * A profundidade de campo rasa entrou em 22/07 e não é enfeite: **texto
 * desfocado não é texto**. Foi a alavanca que mais pesou na medição — na mesma
 * cena de feira, o prompt sem ela deu 3 de 4 aproveitáveis e com ela deu 4 de 4.
 * É também o que salva a `m7/produce-section.jpg`, que já está no curso: as
 * placas dela estão fora de foco.
 */
export const ESTILO =
  'Documentary photography, natural daylight, realistic colors, no color grading. ' +
  'Shallow depth of field: the subject is sharp and everything behind it falls softly out of focus. ' +
  'Candid, editorial stock photo look.'

/**
 * O que nunca pode aparecer, no FIM do prompt porque os modelos pesam o final.
 *
 * A primeira frase é a que faz trabalho de verdade. Modelos de difusão não têm
 * "não": pedir *"no text"* chega a ativar o conceito de texto. Declarar que as
 * placas **estão em branco** dá ao modelo algo para desenhar, em vez de algo
 * para evitar — e foi assim que os cartões de preço passaram a sair vazios.
 * A proibição explícita fica depois, como rede.
 */
export const PROIBIDO =
  'Every sign, label, price card and screen in view is blank and unmarked. ' +
  'No text, letters, numbers or logos anywhere in the image. No close-up of hands.'

/** enquadramento por tipo de slide, conforme a moldura do template */
const ENQUADRAMENTO: Partial<Record<SlideSpec['type'], ImageFraming>> = {
  cover: 'retrato',
  warmup: 'paisagem',
  dialogue: 'paisagem',
  tip: 'retrato',
  section: 'quadrado',
}

export function framingFor(tipo: SlideSpec['type']): ImageFraming {
  return ENQUADRAMENTO[tipo] ?? 'paisagem'
}

/**
 * Tira marcadores de destaque (**, {{}}, [[]], __) para não virarem prompt.
 * Aceita undefined porque vários campos do contrato são opcionais (o título da
 * capa, entre eles) — e um slide sem título ainda merece foto.
 */
const limpo = (s: string | undefined): string => (s ?? '').replace(/\*\*|\{\{|\}\}|\[\[|\]\]|__/g, '').trim()

/**
 * Descreve a CENA a partir do slide. Devolve null quando o slide não aceita
 * foto — o painel então nem oferece o botão.
 */
export function sceneFor(slide: SlideSpec, moduleTitle?: string): string | null {
  if (!(slide.type in ENQUADRAMENTO)) return null
  const tema = moduleTitle ? ` The lesson topic is "${limpo(moduleTitle)}".` : ''

  switch (slide.type) {
    case 'cover': {
      const assunto = limpo(slide.title) || limpo(slide.subtitle) || limpo(moduleTitle)
      if (!assunto) return null // sem assunto não há cena — melhor não oferecer o botão
      return `A person in a real travel situation related to "${assunto}", framed close on the person, the setting soft behind.${tema}`
    }
    case 'warmup':
      // "wide" saiu em 22/07: plano aberto enche o quadro de placa, e ainda
      // brigava com a profundidade de campo rasa do cabeçalho. Continua sendo
      // um estabelecimento de lugar — só que com o fundo desmanchando.
      return `An establishing scene of the place where this happens: ${limpo(slide.prompt)}.${tema}`
    case 'dialogue':
      return `Two people having the conversation described as "${limpo(slide.title)}", mid-exchange, framed close on the two of them.${tema}`
    case 'tip':
      return `A calm, simple scene that illustrates: ${limpo(slide.text)}.${tema}`
    case 'section':
      // A divisória é a MESMA foto no curso inteiro (shared/practice-time.jpg);
      // se alguém pedir outra, que ao menos siga o mesmo espírito.
      return 'A cheerful person practicing a language at a desk, colorful and bright, energetic mood.'
    default:
      return null
  }
}

/** Prompt completo, pronto para o provedor. */
export function promptFor(slide: SlideSpec, moduleTitle?: string): string | null {
  const cena = sceneFor(slide, moduleTitle)
  if (!cena) return null
  return `${ESTILO} ${cena} ${PROIBIDO}`
}

// ------------------------------------------------------------------ VOCAB (M-H2)
//
// Foto POR TERMO: o card de vocabulário associa a palavra em inglês a uma imagem
// do objeto/cena. É um estilo diferente da foto de CENA — aqui o assunto é o
// próprio referente do termo (train station → uma estação de trem), não uma
// pessoa em situação. O `term` (inglês) é o assunto; o `pt` entra como contexto
// de desambiguação (ex.: "gate" pode ser portão de casa ou portão de embarque —
// o pt "portão de embarque" resolve).

/** enquadramento do card de vocab: a foto ocupa o topo do card, recorte quadrado */
export const VOCAB_FRAMING: ImageFraming = 'quadrado'

/**
 * Prompt de foto por termo. `term` = assunto (inglês); `pt` = contexto para
 * desambiguar. Reusa ESTILO + PROIBIDO (Lei 11: nada de texto na imagem — e
 * placas de estação/aeroporto são um risco alto justamente aqui, daí a rede).
 * Devolve null sem termo — sem assunto não há foto.
 */
export function vocabPromptFor(term: string, pt?: string, moduleTitle?: string): string | null {
  const assunto = limpo(term)
  if (!assunto) return null
  const contexto = limpo(pt) ? ` (in this lesson it means "${limpo(pt)}")` : ''
  const tema = moduleTitle ? ` The lesson topic is "${limpo(moduleTitle)}".` : ''
  const cena =
    `A single clear photo of "${assunto}"${contexto}: the subject centered and unmistakable, ` +
    `real object or place, natural daylight, plain uncluttered background.${tema}`
  return `${ESTILO} ${cena} ${PROIBIDO}`
}
