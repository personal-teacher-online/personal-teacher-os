/**
 * Rodada de CAPAS do Módulo 5 — direção de arte nova, uma foto por endereço.
 *
 * Por que só as capas: são os únicos slides do M5 em tela cheia, e a faixa de
 * título mora no terço de baixo. Nas capas atuais o véu que escurece o slide
 * para o título ler corta o sujeito na altura do peito (cabeça no claro, tronco
 * no escuro) — lê como erro de montagem, não como estilo. O conserto não é no
 * véu: é na FOTO. Daí a regra de composição comum às cinco cenas, que reserva a
 * faixa de baixo para uma área visualmente CALMA.
 *
 * O segundo defeito era de casting: a capa da A4 tinha um homem, e a persona do
 * curso é feminina ("a aluna", no roteiro inteiro). A persona comum resolve.
 *
 * Rodada de 25/07 (A1–A4 refeitas; a A5 `planning-flatlay` já foi aprovada pelo
 * dono e NÃO é tocada). O veredito derrubou duas regras que eram minhas, não do
 * repo — ambas documentadas onde vivem, em PLACAS_* e COMPOSICAO.
 *
 * ⚠️ Os cinco endereços deste script JÁ ESTÃO na biblioteca (as capas aprovadas
 * de 25/07). A rodada pula endereço que já existe, então sem `--refazer` este
 * script hoje não gera nada — é exatamente o que se quer de um catálogo pronto.
 * Com `--refazer` ele SOBRESCREVE as capas aprovadas; é decisão de quem digita.
 *
 * Uso:
 *   node --env-file=.env.local scripts/images/capas-m5.ts
 *   node scripts/images/capas-m5.ts              (lê GEMINI_API_KEY do .env.local)
 *   node scripts/images/capas-m5.ts m5/lost-tourist.jpg   (só um endereço)
 *   node scripts/images/capas-m5.ts --refazer    (regera mesmo já existindo)
 */
import path from 'node:path'
import { ESTILO, PROIBIDO, framingFor } from '../../src/lib/images/prompt.ts'
import {
  PLACAS_AO_FUNDO,
  PLACAS_EM_FOCO,
  provedorOuSai,
  rodada,
  saidaDaRodada,
  semEmenda,
} from './comum.ts'

const raiz = path.resolve(import.meta.dirname, '../..')
const DESTINO = path.join(raiz, 'out', 'capas-m5')

/**
 * Enquadramento: a capa é `retrato` no template (2:3), e as 5 fotos que estão
 * hoje na biblioteca confirmam (738×1100). Sai do mesmo mapa que o site usa —
 * chutar '2:3' aqui criaria uma segunda fonte de verdade.
 */
const ENQUADRAMENTO = framingFor('cover')

/**
 * O bloco que dá COERÊNCIA DE SESSÃO: mesma pessoa, mesma luz, mesma família de
 * enquadramento nas cinco capas. Sem ele, cinco fotos boas viram cinco fotos de
 * cinco cursos diferentes. É a parte que o dono NÃO criticou — a A5 aprovada
 * saiu deste bloco, então ele fica intacto.
 */
const PERSONA_E_LUZ =
  'The same woman appears in every photo of this set: a Latin American woman between 30 and 45 years old, ' +
  'brown hair, simple modern travel clothes, travelling alone. ' +
  'Late afternoon golden hour, warm natural sunlight, open sky, no artificial light. ' +
  'Medium shot on a generic European city street, the background softly out of focus. '

/**
 * REGRA DE COMPOSIÇÃO, reescrita em 25/07.
 *
 * A versão antiga exigia "todo o terço inferior é chão vazio", e a exigência
 * cobrou o preço na A3: para caber uma faixa inteira de calçada limpa, o modelo
 * empurrou as duas mulheres para cima e para trás — figuras pequenas numa rua
 * larga, ~40% do quadro em pedra vazia. O dono reprovou.
 *
 * O objetivo funcional nunca foi chão vazio: era faixa de baixo VISUALMENTE
 * CALMA, para o véu do título ler sem cortar rosto nem detalhe importante.
 * Calçada, degrau, mesa ou chão desfocado entregam isso — e sem empurrar o
 * assunto para longe. Some a métrica ("um terço", "vazio"), entra o critério
 * (calmo) e entra o tamanho do sujeito, que é o que faz plano médio ser plano
 * médio.
 *
 * A cláusula da emenda continua — agora em `comum.ts`, porque o gerador de
 * cenas do M2 precisa dela pelo mesmo motivo: foi ela que matou a faixa colada
 * em ~y=905 das candidatas de 24/07, e é o único pedaço da regra antiga que
 * funcionou.
 */
const COMPOSICAO =
  'Composition: a true medium shot — she fills a generous part of the frame, seen from roughly the knees or the waist up, ' +
  'close enough that her face and her expression read clearly. She is never a small distant figure in a wide street. ' +
  'She occupies the upper two thirds of the frame. ' +
  'The lower part of the image stays visually calm and uncluttered — pavement, a step, a table top or softly defocused ground — ' +
  'with no face and no important detail down there; it does not have to be empty, only quiet. ' +
  semEmenda('her body')

/**
 * A regra acima assume a mulher DE PÉ. Numa cena SENTADA ela é geometricamente
 * impossível: quem senta ocupa o meio do quadro, e "nenhuma parte do corpo no
 * terço inferior" só se cumpre amputando. Foi o que aconteceu nas 4 candidatas
 * da `planning-flatlay` de 24/07 — todas com emenda horizontal dura em ~y=905,
 * a mulher cortada na coxa e uma faixa de calçada de outra perspectiva e outra
 * luz colada embaixo. As 4 foram reprovadas.
 *
 * O conserto tem duas partes, e a segunda é a lição do PROIBIDO: (a) cai a
 * exigência de terço inferior vazio — o objetivo funcional era faixa de baixo
 * VISUALMENTE CALMA para o título ler, e mesa + chão desfocado entregam isso
 * igual; (b) entra a proibição EXPLÍCITA da emenda, escrita em positivo ("uma
 * única fotografia contínua"), dando ao modelo algo para desenhar em vez de só
 * algo para evitar.
 */
const COMPOSICAO_SENTADA =
  'She is seated at an outdoor café table, framed from the waist up, the camera slightly above table height. ' +
  'The open paper map and phone rest on the table across the lower-middle of the frame; ' +
  'below and around the table, the café floor falls softly out of focus. ' +
  semEmenda('her body') +
  ' The lower area of the image stays visually calm and uncluttered.'

/**
 * PLACAS — o bloco de restrições do fim do prompt, reescrito em 25/07 e movido
 * para `comum.ts` em 25/07 à noite, quando o gerador de cenas do M2 passou a
 * precisar exatamente da mesma régua (aeroporto é ainda mais cheio de placa que
 * rua). O texto NÃO mudou na mudança de casa; o porquê de cada palavra está lá.
 *
 * O resumo: a régua é por POSIÇÃO da placa. Ao fundo (A1, A3, A4) ela sai fora
 * de foco, como em fotografia real — placa em BRANCO foi reprovada pelo dono
 * ("estão forçadas a retirar conteúdo das placas, então não fica natural"). Em
 * foco e sendo o ASSUNTO (A2, cuja aula é ler placas) ela carrega uma ou duas
 * palavras curtas e corretas.
 */

interface Capa {
  /** endereço na biblioteca, como o conteúdo o referencia */
  endereco: string
  /** a aula a que esta capa pertence — só para o log */
  aula: string
  /** a cena específica, entre a persona e a regra de composição */
  cena: string
  /** regra de composição própria; sem isto, vale a COMPOSICAO de pé */
  composicao?: string
  /** bloco final de restrições; sem isto, vale o PROIBIDO do repo */
  restricao?: string
}

const CAPAS: Capa[] = [
  // As quatro frases "o chão à frente dela está vazio" saíram junto com a regra
  // do terço vazio: eram a mesma pressão por outra porta, e é ela que empurrava
  // o sujeito para o fundo da rua.
  {
    endereco: 'm5/suitcase-window.jpg',
    aula: 'A1 — Getting Around Without Fear',
    cena:
      'She waits at an urban public transport stop with a small carry-on suitcase standing beside her, ' +
      'looking out at the street with a calm, curious expression. ' +
      'The stop sign and the shopfronts behind her sit far beyond the plane of focus. ',
    restricao: PLACAS_AO_FUNDO,
  },
  {
    endereco: 'm5/street-signs.jpg',
    aula: 'A2 — Signs & Maps',
    // Aqui a placa é o ASSUNTO da aula, e por isso é a única que fica em foco e
    // escrita. Duas placas, não três: menos texto para o modelo errar.
    cena:
      'She stands at a street corner looking up at two enamel street-name plates on a wall or a pole, ' +
      'close above her and clearly inside the frame, reading them to find her way. ',
    restricao: PLACAS_EM_FOCO,
  },
  {
    endereco: 'm5/street-corner.jpg',
    aula: 'A3 — Asking for Directions',
    // Na candidata reprovada de 24/07 o "local person" saiu uma senhora idosa de
    // saia e casaco: lê como "perguntando para a vovó", não como "perguntando
    // para alguém na rua". Qualquer transeunte adulto serve — basta dizer isso.
    cena:
      'She asks the way to a passer-by at a street corner, the two of them standing close together and close to the camera, ' +
      'the passer-by an ordinary adult city pedestrian in everyday clothes, friendly and helpful, ' +
      'pointing off down the street to show her the way. ',
    restricao: PLACAS_AO_FUNDO,
  },
  {
    endereco: 'm5/lost-tourist.jpg',
    aula: 'A4 — When Things Go Wrong',
    cena:
      'She stands alone on a train platform checking her phone, her expression calm and focused, ' +
      'someone solving a small problem rather than panicking — composed, not distressed. ' +
      'The departure boards and platform signs hang far down the platform behind her, deep out of focus. ',
    restricao: PLACAS_AO_FUNDO,
  },
  {
    endereco: 'm5/planning-flatlay.jpg',
    aula: 'Mission — Smart Route',
    // "The table edge and the ground in front of her are empty" saiu junto com a
    // regra de pé: era a mesma pressão de chão vazio por outra porta, e brigaria
    // com a COMPOSICAO_SENTADA logo abaixo. O que a cena ainda precisa dizer é o
    // mapa em branco (Lei 11).
    cena:
      'She sits at an outdoor cafe table planning her day, an open paper map on the table and her phone beside it, ' +
      'the blank map sheet plain and unmarked. ',
    composicao: COMPOSICAO_SENTADA,
  },
]

/** prompt final: ESTILO + a cena (persona + cena + composição) + restrições */
function promptDaCapa(capa: Capa): string {
  return `${ESTILO} ${PERSONA_E_LUZ}${capa.cena}${capa.composicao ?? COMPOSICAO} ${capa.restricao ?? PROIBIDO}`
}

/**
 * A RÉGUA DA CONFERÊNCIA para as capas do M5 — e ela NÃO é a da facecam, apesar
 * de estas serem capas.
 *
 * A zona da facecam é medida em percentuais da PÁGINA (16:9), e estas cinco
 * fotos são geradas em `retrato` (2:3): sangradas na página, o `cover` corta a
 * maior parte da altura, e o canto superior direito do ARQUIVO não é o canto
 * superior direito do SLIDE. Cobrar a zona aqui reprovaria a
 * `m5-v2/street-signs.jpg`, que o dono aprovou — nela as placas OLD TOWN /
 * MARKET ficam justamente no alto à direita do arquivo, e no slide elas nem
 * aparecem.
 *
 * (Que uma capa 2:3 numa página 16:9 perca dois terços da própria altura é um
 * assunto do renderer, não da conferência — anotado, não resolvido aqui.)
 */
const REGRA = { tipo: 'quadro' } as const

async function main(): Promise<void> {
  const provider = provedorOuSai(raiz)

  const argumentos = process.argv.slice(2)
  const refazer = argumentos.includes('--refazer')
  const filtro = argumentos.filter((a) => a !== '--refazer')
  const alvos = filtro.length ? CAPAS.filter((c) => filtro.includes(c.endereco)) : CAPAS
  if (!alvos.length) {
    console.error(`Nenhum endereço bate com ${filtro.join(', ')}. Conhecidos: ${CAPAS.map((c) => c.endereco).join(', ')}`)
    process.exit(2)
  }

  console.log(`${alvos.length} capa(s) — ${ENQUADRAMENTO} — candidatas em ${path.relative(raiz, DESTINO)}/\n`)

  saidaDaRodada(
    await rodada({
      provider,
      destino: DESTINO,
      raiz,
      refazer,
      alvos: alvos.map((c) => ({
        endereco: c.endereco,
        rotulo: c.aula,
        prompt: promptDaCapa(c),
        framing: ENQUADRAMENTO,
        regra: REGRA,
      })),
    }),
  )
}

main()
