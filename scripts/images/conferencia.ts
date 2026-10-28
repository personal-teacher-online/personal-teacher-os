/**
 * A CONFERÊNCIA — a máquina que olha UMA candidata e diz se ela tem defeito
 * GRAVE. É o que substituiu o "gera 6 e um humano escolhe" (decisão do dono,
 * 25/07 à noite).
 *
 * A conta que motivou a troca: na última rodada 4 das 13 fotos foram aprovadas
 * na PRIMEIRA candidata (~30%), e mesmo assim as 6 candidatas de cada endereço
 * eram geradas ANTES de alguém olhar qualquer uma — pagava-se 6 para usar 1,
 * inclusive quando a primeira já servia. Agora gera-se 1, confere-se por
 * máquina, e só o que a máquina REPROVA custa uma segunda geração.
 *
 * ⚠️ Duas propriedades desenhadas de propósito, porque são o que faz a troca
 * valer a pena:
 *
 *  1. **A régua é objetiva e grave.** Gosto NÃO entra: foto banal mas correta
 *     PASSA. Quem escolhe entre duas fotos corretas é a professora, que troca o
 *     que não gostar. Uma conferência com opinião estética reprova foto boa, e
 *     cada reprovação errada é uma geração inteira jogada fora — o cheque que
 *     esta troca queria justamente cortar.
 *  2. **O veredito é calculado AQUI, não pelo modelo.** O modelo só reporta
 *     ACHADOS de uma lista fechada, cada um com o "onde". Se ele pudesse
 *     devolver `aprovada: true` junto com uma lista de defeitos, alguém teria de
 *     decidir em quem acreditar. Sem defeito na lista = aprovada, e ponto.
 *
 * O modelo é de TEXTO/VISÃO, não o de geração de imagem: uma conferência custa
 * uma fração de uma geração (ordem de ~1.5k tokens de entrada contra uma imagem
 * inteira). Ver `MODELO`.
 */
import type { ImageBytes } from '../../src/lib/images/provider.ts'

/**
 * O MODELO DA CONFERÊNCIA.
 *
 * Escolhido entre os que a chave lista hoje (`GET /v1beta/models`, 25/07): a
 * família `*-flash-lite` é a mais barata que tem visão, e dentro dela a 3.1 é a
 * geração GA mais nova. Não é preciosismo: o trabalho INTEIRO desta chamada é
 * ler letra pequena numa placa e num documento — nome de país, marca, logo — e
 * é exatamente aí que a geração anterior de "lite" erra. Um falso negativo aqui
 * põe marca registrada no slide da aluna.
 *
 * `MODELO_CONFERENCIA=gemini-2.5-flash-lite …` troca para a geração anterior
 * (mais barata) sem editar código, se algum dia o custo pesar mais que o OCR.
 *
 * ⚠️ NÃO se manda `thinkingLevel`/`thinkingConfig` daqui: o nome do parâmetro
 * mudou entre a família 2.5 e a 3.x, e parâmetro desconhecido no Gemini volta
 * 400 — o que quebraria justamente quem trocou o modelo pelo env. Se a conta de
 * saída incomodar, esse é o primeiro lugar a mexer (com a chave com crédito, e
 * medindo).
 */
export const MODELO = process.env.MODELO_CONFERENCIA ?? 'gemini-3.1-flash-lite'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/** teto de UMA conferência — ela responde em segundos; 45s é folga para pico */
const TIMEOUT_MS = 45_000

/**
 * Os defeitos que reprovam. Lista FECHADA e curta de propósito: cada item aqui
 * custou uma candidata reprovada de verdade, e nada entra por precaução.
 *
 *  • `marca`    — o defeito mais caro da rodada de 25/07: um visto com
 *                 `UNITED STATES OF AMERICA` e brasão dourado, uma mochila com
 *                 `patagonia` legível, uma libré de companhia aérea real.
 *  • `anatomia` — mão/corpo deformado, dedo a mais, membro que não fecha.
 *  • `emenda`   — costura visível onde o modelo colou dois pedaços (uma capa com
 *                 banda colada em x≈630; uma foto do M5 com a pessoa amputada).
 *  • `facecam`  — SÓ EM CAPA: assunto/rosto/placa dentro da zona da câmera da
 *                 professora. Em slide que não é capa, não se aplica.
 *  • `faixa`    — SÓ EM VOCABULÁRIO: o card mostra uma fatia horizontal do meio
 *                 da foto; assunto no alto ou no pé some (matou 4 candidatas
 *                 seguidas do `customs`).
 */
export const DEFEITOS = ['marca', 'anatomia', 'emenda', 'facecam', 'faixa'] as const
export type Defeito = (typeof DEFEITOS)[number]

/**
 * Que régua vale para esta foto — e o parâmetro que a régua precisa.
 *
 * Cada variante CARREGA o seu número em vez de este arquivo saber de geometria
 * de slide: a zona da facecam é medida no `comum.ts` (que a deriva de
 * `FACECAM_V2`) e a fatia do card é medida no `vocab.ts` (que mediu o card no
 * `template-v2`). Se a câmera mudar de tamanho ou o card de proporção, o número
 * chega aqui corrigido sozinho — e este arquivo não vira uma segunda fonte de
 * verdade sobre o layout.
 */
export type Regra =
  | { tipo: 'quadro' }
  | { tipo: 'capa'; zonaPct: { largura: number; altura: number } }
  | { tipo: 'card'; faixaPct: number }

/** um defeito encontrado, com o "onde" que obriga o modelo a apontar */
export interface Achado {
  defeito: Defeito
  onde: string
}

export interface Veredito {
  aprovada: boolean
  achados: Achado[]
  modelo: string
}

export type Conferencia = Veredito | { erro: string }

export const reprovou = (c: Conferencia): c is Veredito => 'aprovada' in c && !c.aprovada
export const passou = (c: Conferencia): c is Veredito => 'aprovada' in c && c.aprovada

/** resumo de uma linha, para o log da rodada: `marca (visto: UNITED STATES…)` */
export const resumo = (v: Veredito): string =>
  v.achados.map((a) => `${a.defeito} (${a.onde})`).join('; ') || 'sem defeito'

// ------------------------------------------------------------------- a régua

/**
 * O PAPEL. As duas últimas frases são a parte cara: sem elas o modelo de visão
 * vira crítico de arte e reprova foto correta por "composição fraca" ou "pouco
 * interessante" — e cada reprovação errada é uma geração inteira desperdiçada.
 */
const PAPEL =
  'You are the quality gate of a photograph library for an English course. You decide exactly one thing: does this ' +
  'photograph carry a GRAVE defect from the closed list below? ' +
  'Taste is not your business. A plain, ordinary, even boring photograph with no defect PASSES. You never judge ' +
  'beauty, mood, styling, colour, lighting, originality or how interesting the picture is — the teacher replaces ' +
  'what she does not like. ' +
  'Report a defect ONLY when you can see it and say where it is in the picture. When you are not sure, the ' +
  'photograph passes: a wrong rejection burns a whole new generation for nothing.'

/**
 * MARCA. As duas exceções finais são tão importantes quanto a proibição.
 *
 * Placa com palavra curta, correta e genérica — `DELAYED`, `EXIT`, `NOTHING TO
 * DECLARE`, `BOARDING PASS` — PASSA, e é desejável: é o conteúdo da aula (o
 * dono ratificou isso no lote do M3). E letra miúda que sai borrada porque está
 * fora do plano de foco é o que uma fotografia real faz — reprovar isso seria
 * reprovar a alavanca de prompt que mais funciona no `ESTILO`.
 *
 * As duas cláusulas finais (garrancho só conta quando está NÍTIDO; letra que
 * ninguém deveria ler naquele tamanho não conta) foram compradas olhando duas
 * fotos que o dono APROVOU: a `m5-v2/suitcase-window.jpg`, que tem no alto à
 * esquerda uma placa de loja desfocada cujas letras não formam palavra nenhuma,
 * e a `vocab/visa.jpg`, cujo rótulo de visto tem campos minúsculos ilegíveis em
 * volta das palavras VISA e ENTRY. Sem elas a régua reprovaria foto aprovada — e
 * falso positivo custa uma geração inteira.
 */
const MARCA =
  'marca — a country name, a brand, a company name, a logo, an emblem, a coat of arms, a national flag, or the ' +
  'livery or name of a real airline, hotel chain or bank is LEGIBLE anywhere in the photograph; or lettering that ' +
  'is sharp and meant to be read comes out garbled, misspelled or as invented letterforms. ' +
  'NOT a defect, and actively wanted: one short, correct, ordinary word or phrase on a sign, a board, a ticket or ' +
  'a document — in the spirit of DELAYED, BOARDING, GATE, EXIT, OLD TOWN, MARKET, NOTHING TO DECLARE, BOARDING ' +
  'PASS, PASSPORT, RECEPTION, INVOICE. That is the content of the lesson. A common word of the local European ' +
  'language on a shop or street sign (TABAC, HOTEL, CAFE, CENTRO) is an ordinary word too, not a brand: what is ' +
  'forbidden is the NAME of a real company, chain or country, not the fact that a word is not English. ' +
  'NOT a defect either: small print that is soft and unreadable because it lies out of focus, or a plain document ' +
  'pattern with no words. Blurred, distant or tiny background signage whose letters cannot be read is never this ' +
  'defect, even when the shapes look like broken letters — that is what real signage looks like in a photograph ' +
  'with a shallow depth of field. Nor is the tiny lettering nobody is meant to read at that size: the field labels ' +
  'of a document, the fine print of a ticket, the ink of a rubber stamp. ' +
  'It is only this defect when a name, brand, country or emblem can actually be READ.'

/**
 * ANATOMIA. As duas últimas frases são a correção de 25/07 à noite: na auditoria
 * das 87 fotos aprovadas, as ÚNICAS quatro reprovações foram todas de
 * `anatomia`, todas em mão que segura um objeto (`m2/documents-hand`,
 * `m5/phone-map`, `m5-v2/street-corner`, `m6/wrong-dish`) — e nas quatro os
 * dedos estão certos, só parcialmente escondidos atrás do passaporte, do
 * celular, do próprio corpo. Mão em close é o lugar onde o modelo de visão
 * ALUCINA defeito, exatamente como o modelo de imagem alucina dedo.
 */
const ANATOMIA =
  'anatomia — a person is anatomically wrong: a hand with the wrong number of fingers, fused or melted fingers, ' +
  'a limb that does not connect to the body, an impossible joint, a duplicated body part, a face that melts. ' +
  'NOT a defect: a body part that is simply out of focus, hidden behind something, or outside the frame. ' +
  'Before reporting a hand, count the fingers you can actually SEE and say the count in "onde". Fingers hidden ' +
  'behind the object being held, fingers overlapping each other, or a hand seen at an angle are normal and are ' +
  'not this defect. Report it only when you can point at the specific wrong thing — a sixth finger, a pair fused ' +
  'into one, a thumb on the wrong side — and you are sure of it.'

/**
 * EMENDA. A segunda forma ("um retângulo colado") saiu da candidata 1 do
 * `m2/officer-speaking`: o quarto inferior direito dela é OUTRA fotografia do
 * mesmo saguão, colada num retângulo com aresta dura em x≈630, com outra escala
 * e outra luz. A redação anterior falava só em costura "atravessando o quadro" e
 * deixaria essa passar — e ela é a mais cara das duas, porque só se vê quando a
 * pessoa olha o canto.
 */
const EMENDA =
  'emenda — the picture is not one continuous photograph. Either a hard straight seam runs across the frame with ' +
  'different light, scale or perspective on each side of it; or a rectangular patch of a different picture is ' +
  'pasted inside the frame, its straight edges cutting through the scene while the content does not continue ' +
  'across them (the same place repeated at another scale, another light, another perspective); or a person or ' +
  'object is sliced by a straight line INSIDE the picture. ' +
  'NOT a defect: something cropped by the edge of the frame — that is ordinary framing.'

/** SÓ EM CAPA. A zona chega medida de `ZONA_FACECAM` (ver `comum.ts`). */
const facecam = (pct: { largura: number; altura: number }): string =>
  'facecam — the teacher’s webcam is laid over the top right corner of this slide, so that corner must stay calm ' +
  `background. It is a defect when a face, a head, a body, a piece of luggage, or any legible lettering falls ` +
  `inside the top right region of the photograph: the rightmost ${pct.largura}% of the width, from the top edge ` +
  `down through the top ${pct.altura}% of the height. A plain wall, glass, open sky, an empty stretch of corridor ` +
  'or plain defocused depth in that region is exactly right and is not a defect.'

/**
 * SÓ EM VOCABULÁRIO. A fatia chega medida do card (ver `FAIXA_DO_CARD_PCT`).
 *
 * A última frase foi comprada na `vocab/customs.jpg` que o dono APROVOU: nela a
 * placa NOTHING TO DECLARE fica acima da fatia, e mesmo assim o card funciona,
 * porque o corredor verde inteiro ocupa a fatia e é ele que diz "alfândega". A
 * pergunta certa não é "algo importante foi cortado?", é "o que sobra ainda
 * mostra o assunto?".
 */
const faixa = (pct: number): string => {
  const margem = Math.round((100 - pct) / 2)
  return (
    'faixa — the card does not show this photograph whole. It shows only a horizontal strip cut from the middle ' +
    `of it: the top ${margem}% and the bottom ${margem}% of the picture are cut away and will never be seen, and ` +
    `only the middle ${pct}% of the height survives, at full width. ` +
    'Look at that middle strip ALONE, as if the top and the bottom of the picture were black, and ask: does the ' +
    'subject of the photograph still read there? It is a defect when it does not — when the thing this picture is ' +
    'about (the object, the sign, the place) lies in the cut-away top or the cut-away bottom, so the strip is left ' +
    'with background, an empty floor, a ceiling, or a sliver of the subject. ' +
    'It is NOT a defect when the strip alone still shows the subject clearly, even if part of the subject is cut ' +
    'away by it.'
  )
}

/**
 * A régua completa desta foto. Os defeitos que não se aplicam NÃO entram no
 * texto (nem no schema): descrever a zona da facecam num slide que não é capa é
 * convidar o modelo a inventar um defeito que não existe naquele slide.
 */
export function reguaDe(regra: Regra): { texto: string; aceitos: Defeito[] } {
  const itens = [MARCA, ANATOMIA, EMENDA]
  const aceitos: Defeito[] = ['marca', 'anatomia', 'emenda']
  if (regra.tipo === 'capa') {
    itens.push(facecam(regra.zonaPct))
    aceitos.push('facecam')
  }
  if (regra.tipo === 'card') {
    itens.push(faixa(regra.faixaPct))
    aceitos.push('faixa')
  }
  return { texto: `${PAPEL}\n\nThe closed list of grave defects:\n\n${itens.join('\n\n')}`, aceitos }
}

/**
 * O prompt final. A instrução de saída é redundante com o `responseSchema` de
 * propósito: o schema garante a FORMA, o texto garante o CONTEÚDO ("lista vazia
 * quando não há defeito") — sem ele o modelo tende a preencher a lista com um
 * achado fraco só para não devolver nada.
 */
export function promptDaConferencia(regra: Regra): string {
  const { texto } = reguaDe(regra)
  // A DESCRIÇÃO ANTES DO VEREDITO, e só no card. Medido em 25/07 à noite nas 5
  // candidatas gravadas do `vocab/customs`: perguntado direto "o assunto cai na
  // fatia?", o flash-lite respondeu "sem defeito" para TODAS, inclusive a que
  // tem a placa no topo e só um carrinho na fatia. Obrigado a escrever primeiro
  // o que a fatia mostra, ele passa a errar menos — o campo é preenchido antes
  // dos achados porque o modelo gera na ordem do schema, e o que ele escreveu
  // vira contexto do que ele decide.
  const passo =
    regra.tipo === 'card'
      ? 'First fill "faixaMostra": describe, in one short sentence, what is visible inside the middle strip ' +
        'ALONE — as if the cut-away top and bottom of the picture were black. Then answer with the list of ' +
        'defects you can see'
      : 'Answer with the list of defects you can see'
  return (
    `${texto}\n\n` +
    `${passo}, each with a short "onde" saying where it is in the picture ` +
    '(and, for marca, quoting the text you can read). If the photograph has none of the defects above, answer ' +
    'with an EMPTY list — that is the normal, expected answer for a good photograph.'
  )
}

// -------------------------------------------------------------- a interpretação

interface RespostaGemini {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
    finishReason?: string
  }>
  error?: { message?: string; status?: string }
}

/**
 * O texto útil da resposta. As partes marcadas `thought` são o raciocínio do
 * modelo e NÃO são a resposta — a família 3 devolve as duas coisas na mesma
 * lista, e concatenar tudo faz o `JSON.parse` engasgar num texto perfeitamente
 * válido (o mesmo defeito que já mordeu as rotinas de IA do site em 21/07).
 */
function textoDaResposta(corpo: RespostaGemini): string {
  const partes = corpo.candidates?.[0]?.content?.parts ?? []
  return partes
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim()
}

/** tira cerca de markdown, que aparece mesmo com `responseMimeType: json` */
const semCerca = (s: string): string =>
  s
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

/**
 * JSON do modelo → veredito. PURA e exportada porque é ela que os testes
 * cobrem: é aqui que mora a regra "sem achado = aprovada", o descarte de
 * defeito fora da régua e a recusa de resposta malformada.
 *
 * Achado com defeito que não pertence à régua desta foto é ERRO, não é
 * ignorado em silêncio: significa que o modelo respondeu outra pergunta, e
 * aprovar uma foto com base numa resposta que não se entendeu é exatamente a
 * degradação silenciosa que o projeto proíbe.
 */
export function interpretaVeredito(bruto: string, aceitos: Defeito[], modelo = MODELO): Conferencia {
  let doc: unknown
  try {
    doc = JSON.parse(semCerca(bruto))
  } catch {
    return { erro: `a conferência não devolveu JSON: ${bruto.slice(0, 120)}` }
  }
  if (typeof doc !== 'object' || doc === null || !Array.isArray((doc as { achados?: unknown }).achados)) {
    return { erro: `a conferência devolveu JSON sem a lista "achados": ${bruto.slice(0, 120)}` }
  }
  const achados: Achado[] = []
  for (const item of (doc as { achados: unknown[] }).achados) {
    const d = (item as { defeito?: unknown })?.defeito
    const onde = (item as { onde?: unknown })?.onde
    if (typeof d !== 'string' || !aceitos.includes(d as Defeito)) {
      return { erro: `a conferência devolveu um defeito fora da régua: ${JSON.stringify(d)}` }
    }
    achados.push({ defeito: d as Defeito, onde: typeof onde === 'string' ? onde : '' })
  }
  return { aprovada: achados.length === 0, achados, modelo }
}

// ------------------------------------------------------------------- a chamada

/**
 * O schema da saída, restrito aos defeitos que valem para ESTA foto.
 *
 * `faixaMostra` só existe no card e vem ANTES de `achados` na ordem das
 * propriedades: é o passo de raciocínio que o prompt exige, e o modelo gera na
 * ordem em que o schema declara (`propertyOrdering`). O código ignora o campo —
 * quem decide continua sendo a lista de achados.
 */
const schemaDe = (aceitos: Defeito[]): unknown => {
  const achados = {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        defeito: { type: 'STRING', enum: aceitos },
        onde: { type: 'STRING' },
      },
      required: ['defeito', 'onde'],
      propertyOrdering: ['defeito', 'onde'],
    },
  }
  if (!aceitos.includes('faixa')) {
    return { type: 'OBJECT', properties: { achados }, required: ['achados'], propertyOrdering: ['achados'] }
  }
  return {
    type: 'OBJECT',
    properties: { faixaMostra: { type: 'STRING' }, achados },
    required: ['faixaMostra', 'achados'],
    propertyOrdering: ['faixaMostra', 'achados'],
  }
}

/**
 * Confere UMA candidata. Devolve `{ erro }` em vez de estourar — quem chama
 * precisa distinguir "a conferência não respondeu" (não gasta uma geração) de
 * "a foto tem defeito" (gasta), e exceção não carrega essa diferença de graça.
 */
export async function confere(opts: {
  apiKey: string
  imagem: ImageBytes
  regra: Regra
  modelo?: string
}): Promise<Conferencia> {
  const modelo = opts.modelo ?? MODELO
  const { aceitos } = reguaDe(opts.regra)
  try {
    const r = await fetch(`${BASE}/${modelo}:generateContent?key=${opts.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: promptDaConferencia(opts.regra) },
              {
                inlineData: {
                  mimeType: opts.imagem.mimeType,
                  data: Buffer.from(opts.imagem.data).toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schemaDe(aceitos),
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const corpo: RespostaGemini = await r.json().catch(() => ({}) as RespostaGemini)
    if (!r.ok) return { erro: corpo.error?.message ?? `HTTP ${r.status}` }
    const texto = textoDaResposta(corpo)
    if (!texto) {
      const motivo = corpo.candidates?.[0]?.finishReason
      return { erro: motivo ? `a conferência não respondeu (${motivo})` : 'a conferência não respondeu' }
    }
    return interpretaVeredito(texto, aceitos, modelo)
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) }
  }
}

// Para rodar a conferência em imagens que já estão no disco (é assim que a régua
// se valida contra o material real), ver `auditar.ts` ao lado.
