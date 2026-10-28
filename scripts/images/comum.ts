/**
 * O que os geradores de foto do curso têm EM COMUM — blocos de prompt e o
 * maquinário da rodada.
 *
 * Este arquivo nasceu do `capas-m5.ts` (rodada de 25/07, cujas capas o dono
 * aprovou) quando o segundo gerador chegou (`cenas.ts`, as fotos de cena do
 * M2/M3/M4). Nada aqui é abstração preventiva: cada bloco abaixo já tem DOIS
 * usuários, e cada um deles é uma correção comprada com uma rodada reprovada.
 * O que é direção de arte de UM módulo (a persona do M5, o clima de terminal do
 * M2) fica no script daquele módulo — aqui só o que os dois assinam embaixo.
 *
 * ⚠️ As strings deste arquivo entram no prompt das capas do M5, que estão
 * APROVADAS. Mexer aqui é mexer nelas. A extração foi verificada comparando os
 * 5 prompts do M5 antes e depois — byte a byte.
 */
import fs from 'node:fs'
import path from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { geminiConfigFromEnv, geminiProvider } from '../../src/lib/images/gemini.ts'
import {
  veioPronta,
  type ImageBytes,
  type ImageFraming,
  type ImageProvider,
  type ImageStarted,
} from '../../src/lib/images/provider.ts'
import { FACECAM, FACECAM_BOTTOM, FACECAM_V2 } from '../../src/lib/slides/template-v2.ts'
import { confere, resumo, type Conferencia, type Regra } from './conferencia.ts'

/**
 * Quantas chamadas simultâneas — ver o pool em `rodada()`.
 *
 * HISTÓRICO, porque o número já foi 2 e a razão do 2 caducou:
 *
 *  • 25/07 de manhã: as 6 candidatas de um alvo saíram em paralelo e 8 das 24
 *    voltaram "aborted due to timeout" (teto de 60s por chamada em `gemini.ts`,
 *    que é do site e não se mexe daqui). Conclusão da época: 2.
 *  • 25/07 à tarde (lote do M3): o 2 custava 40 minutos por 14 fotos. Medido de
 *    novo, com o pool novo e o recuo abaixo: 2 → ~24 s/imagem, 4 → ~12 s/imagem,
 *    6 → ~8 s/imagem, sem um único 429 e sem timeout, com OUTRO agente gerando o
 *    M4 na mesma chave. O que mudou entre as duas medições não foi a API: foi o
 *    ESCALONAMENTO. Antes, 6 chamadas partiam no mesmo milissegundo (as ondas
 *    eram síncronas dentro de um alvo) e disputavam a mesma janela de 60s; o
 *    pool abaixo mantém 6 EM VOO mas cada vaga só é ocupada quando outra vaga
 *    vaga, então as partidas ficam naturalmente defasadas.
 *
 * Fica em 6 e não sobe mais por decisão de vizinhança, não por limite medido: a
 * chave é compartilhada com outra rodada acontecendo ao mesmo tempo, e estourar
 * a cota derruba as duas.
 *
 * As chamadas da CONFERÊNCIA disputam as mesmas vagas: são para a mesma chave e
 * tomam o mesmo 429. Elas são muito mais leves, mas contá-las fora do pool seria
 * dizer "concorrência 6" e mandar 12.
 *
 * `LOTE=N node scripts/images/cenas.ts …` sobrescreve para medir de novo.
 */
const LOTE_PADRAO = 6

export const LOTE = ((): number => {
  const bruto = process.env.LOTE
  if (bruto === undefined || bruto === '') return LOTE_PADRAO
  const n = Number(bruto)
  // valor inválido não pode virar 1 nem NaN em silêncio: quem exportou LOTE=x
  // está MEDINDO, e uma medição com o número errado é pior que nenhuma.
  if (!Number.isInteger(n) || n < 1) {
    console.error(`LOTE inválido: "${bruto}" (esperado inteiro ≥ 1).`)
    process.exit(2)
  }
  return n
})()

/**
 * Quantas vezes UMA chamada é retentada quando o erro é PICO, e o quanto se
 * espera entre as tentativas (com jitter, para as N chamadas em voo não voltarem
 * todas juntas e recriarem o mesmo pico).
 */
const TENTATIVAS_DE_REDE = 4
const RECUO_BASE_MS = 4000

/**
 * O TETO DE GERAÇÕES POR ENDEREÇO — o número que substituiu o `CANDIDATAS = 4`
 * (decisão do dono, 25/07 à noite).
 *
 * Antes: 4 (às vezes 6) candidatas geradas ANTES de alguém olhar qualquer uma —
 * pagava-se 6 para usar 1. Agora: gera 1, a conferência olha, e só o que ela
 * REPROVA custa uma geração nova. O teto existe para o endereço que o modelo não
 * consegue acertar não virar torneira aberta; estourado o teto, o endereço entra
 * na lista de falhas do relatório em vez de entregar foto ruim em silêncio.
 */
const TENTATIVAS_POR_ENDERECO = 4

/**
 * Erro que é PICO, não defeito — e a lista é literal de propósito.
 *
 * O status HTTP não chega até aqui: o `gemini.ts` (que é do site e não se mexe
 * daqui) devolve `{ error: string }` com a mensagem do provedor. Então a
 * classificação é por texto — feia, e a alternativa seria mexer no driver.
 *
 * ⚠️ O 500 entrou depois e custou 16 gerações num minuto: o Gemini devolve
 * `Internal error encountered.` (HTTP 500) sob carga, exatamente como devolve
 * 503, e a lista original não o previa. Sem ele a rodada classificava o pico
 * como `defeito`, desistia do endereço na primeira tentativa e ainda mandava a
 * candidata seguinte na mesma parede — 16 endereços queimados em sequência sem
 * uma única foto entregue. 500 é a mesma família do 503: recua e insiste.
 * As duas formas entram porque as duas chegam: a mensagem do provedor
 * (`Internal error encountered.`) e o `HTTP 500` que o driver monta quando a
 * resposta vem sem `error.message`.
 */
const TRANSITORIO =
  /\b429\b|\b500\b|\b503\b|internal error|rate.?limit|quota|resource[_ ]exhausted|overloaded|unavailable|high demand|timed? ?out|timeout|aborted/i

/**
 * CRÉDITO ESGOTADO ≠ LIMITE DE TAXA — a distinção que o dono pediu depois de
 * 25/07, quando dois agentes ficaram parados sem dizer por quê.
 *
 * As duas coisas chegam como 429, e o `TRANSITORIO` acima trata 429 recuando e
 * insistindo — que é certo para pico e é a pior coisa possível para saldo
 * zerado: a rodada fica em ciclo de retentativa, calada, até alguém desconfiar.
 * Por isso esta régua é consultada ANTES do `TRANSITORIO`.
 *
 * ⚠️ CONTRADIÇÃO REGISTRADA: até 25/07 este arquivo dizia o contrário — que a
 * mensagem "prepayment credits are depleted" MENTE, porque teria chegado numa
 * chave com crédito que voltou a gerar segundos depois. Não desmenti aquela
 * observação; ela é o motivo de a rodada CONFIRMAR o diagnóstico (uma segunda
 * chamada, `CONFIRMA_CREDITO_MS` depois) antes de abortar. Se for pico
 * disfarçado, custa 5 segundos; se for saldo, a rodada morre dizendo o que é.
 */
const SEM_CREDITO = /prepayment credits are depleted|please enable billing|billing account/i
const CONFIRMA_CREDITO_MS = 5000

/** quantos 429/picos a rodada inteira viu — entra no resumo final */
let picos = 0

/**
 * Preenchido com a mensagem do provedor quando o saldo acabou (já confirmado).
 * A partir daí NENHUMA chamada nova parte: as que estão em voo terminam, a
 * rodada imprime o motivo e o script sai com código próprio.
 */
let creditoEsgotado: string | null = null

// ------------------------------------------------------- a zona da FACECAM

/** EMU por polegada — a unidade em que o pptxgenjs guarda o tamanho da página */
const EMU_POR_POLEGADA = 914400

/**
 * A PÁGINA do deck em polegadas, lida do MESMO layout que o `build.ts` manda no
 * pptxgenjs (`pres.layout = 'LAYOUT_16x9'`). Escrever 10 × 5.625 na mão aqui
 * criaria uma segunda fonte de verdade sobre o tamanho da página — e é
 * exatamente sobre a página que a conta da facecam é feita.
 */
function paginaDoDeck(): { w: number; h: number } {
  const pres = new PptxGenJS()
  pres.layout = 'LAYOUT_16x9'
  return { w: pres.presLayout.width / EMU_POR_POLEGADA, h: pres.presLayout.height / EMU_POR_POLEGADA }
}

export const PAGINA = paginaDoDeck()

/**
 * ONDE A CÂMERA POUSA — o defeito mais caro da rodada de 25/07.
 *
 * A regra de composição da capa mandava o assunto para "a metade de cima, um
 * pouco à direita do centro", porque o título mora na faixa de baixo. Só que a
 * facecam da professora fica em cima À DIREITA (`FACECAM_SIDE = 'right'`): a
 * regra mandava o assunto para debaixo do rosto dela. Na capa do M2A1 a
 * viajante andando de costas ficou atrás da professora.
 *
 * Por que ninguém viu: na capa a caixa da câmera NÃO é desenhada (só o
 * `paperSlideV2` chama `facecamDock`) — o vídeo entra por cima da foto ao vivo.
 * No PNG a foto aparece inteira e a colisão é invisível. É para isso que existe
 * o `facecam-qa.ts` ao lado.
 *
 * A zona é a caixa da câmera DILATADA pela própria margem dela (`FACECAM_V2.m`)
 * e estendida até as bordas de cima e da direita — a faixa de margem entre a
 * câmera e a borda também é área que a câmera domina visualmente. Tudo sai de
 * `FACECAM_V2`/`FACECAM`: mudar o tamanho da câmera muda esta zona sozinho, e
 * muda junto o texto do prompt e o retângulo do QA.
 */
export const ZONA_FACECAM = {
  x: FACECAM.x - FACECAM_V2.m,
  y: 0,
  w: PAGINA.w - (FACECAM.x - FACECAM_V2.m),
  h: FACECAM_BOTTOM + FACECAM_V2.m,
} as const

/** a zona em percentuais inteiros da página — é assim que ela entra no prompt */
export const ZONA_FACECAM_PCT = {
  largura: Math.round((ZONA_FACECAM.w / PAGINA.w) * 100),
  altura: Math.round((ZONA_FACECAM.h / PAGINA.h) * 100),
} as const

// ------------------------------------------------- a fatia do card de vocabulário

/**
 * QUANTO DA FOTO O CARD DE VOCABULÁRIO MOSTRA — a régua que matou 4 candidatas
 * seguidas do `vocab/customs` e que a conferência agora cobra sozinha.
 *
 * No card do `template-v2` a foto ocupa 1.975" × 0.592" (medido com
 * `planVocabCard` numa grade de 8 cards) e o desenho usa `sizing: 'cover'`. A
 * foto do vocabulário é gerada em `paisagem` (3:2, ver `vocab.ts`), então ela
 * entra ali cortada: sobra a FAIXA HORIZONTAL DO MEIO. Assunto encostado no alto
 * ou no pé simplesmente não aparece no slide — e isso não se vê olhando a foto
 * sozinha, só no deck.
 *
 * O número está aqui, e não como frase solta no `vocab.ts`, porque agora tem
 * dois leitores: o prompt do card e a conferência.
 */
const CARD_RAZAO = 1.975 / 0.592
const VOCAB_RAZAO = 3 / 2

/** a fatia visível, em percentual inteiro da altura da foto (≈45%) */
export const FAIXA_DO_CARD_PCT = Math.round((VOCAB_RAZAO / CARD_RAZAO) * 100)

/**
 * A CLÁUSULA DA EMENDA — o pedaço mais caro deste arquivo.
 *
 * Nas 4 candidatas da `m5/planning-flatlay` de 24/07 uma regra minha de
 * composição ("todo o terço inferior é chão vazio") fez o modelo AMPUTAR a
 * mulher: emenda horizontal dura em ~y=905, a pessoa cortada na coxa e uma
 * faixa de calçada de outra perspectiva e outra luz colada embaixo. As 4 foram
 * reprovadas. O conserto é escrever em POSITIVO — "uma única fotografia
 * contínua" dá ao modelo algo para desenhar, em vez de só algo para evitar.
 *
 * O sujeito é parâmetro porque nem toda foto do curso tem uma mulher no quadro:
 * nas cenas do M2 a viajante muitas vezes é só um par de mãos ou uma silhueta.
 */
export const semEmenda = (sujeito: string): string =>
  'The whole image is one single continuous photograph: no hard horizontal edge, no seam, no pasted band, ' +
  `and no part of ${sujeito} is cropped by a straight line across the frame.`

/**
 * PLACAS AO FUNDO, sem a última frase.
 *
 * A régua de placas é por POSIÇÃO (rodada de 25/07): placa ao fundo não fica em
 * branco — cai fora do plano de foco, como em qualquer fotografia real com
 * profundidade rasa. Placa em branco foi REPROVADA pelo dono ("fica forçada,
 * não fica natural"), e o `PROIBIDO` do repo, que manda tudo em branco, é mais
 * restrito que a política ratificada do projeto
 * (`docs/goals/slides-personal-travel.md`, "Texto dentro da imagem"): em foto de
 * CONTEÚDO admite-se texto genérico curto e correto, com auditoria sempre.
 *
 * A base está separada do fecho porque "sem mão em close" nem sempre vale: o M2
 * tem cenas em que a mão da viajante é o assunto (o passaporte na mão, o
 * carimbo). Quem quer as mãos usa a base + a sua própria regra de mãos.
 */
export const PLACAS_AO_FUNDO_BASE =
  'Every sign, poster, notice and screen in this photograph belongs to the out-of-focus background: ' +
  'it lies well behind the plane of focus, so its lettering dissolves into soft unreadable shapes, ' +
  'the way real signage looks in a photo with a shallow depth of field. ' +
  'The signs are normal working signs of a real city, never blank, never wiped clean, never empty plates. ' +
  'Nothing sharp and close to the camera carries text, letters, numbers or logos.'

/** a base + o fecho clássico do repo: dedo deformado é o artefato número um */
export const PLACAS_AO_FUNDO = `${PLACAS_AO_FUNDO_BASE} No close-up of hands.`

/**
 * Placa EM FOCO e que É o assunto (a aula que ensina a LER placas): carrega
 * texto curto, simples e correto. Curto e simples é onde este modelo acerta;
 * frase longa é onde ele inventa garrancho. Exemplos concretos no prompt porque
 * nome de rua "plausível" sem amostra costuma voltar como palavra inventada.
 */
export const PLACAS_EM_FOCO =
  'The street-name plates she is reading are sharp, legible and correctly spelled: ' +
  'each plate carries one or two real words in plain capital letters — a plausible European street name or a standard ' +
  'English signage word, in the spirit of CENTRE, STATION, OLD TOWN, MARKET, MUSEUM, HARBOUR. ' +
  'Never a whole phrase, never a sentence, never invented or garbled letterforms: if a word cannot be spelled correctly, ' +
  'that plate is plain metal instead. ' +
  'Every other sign, poster and screen stays in the out-of-focus background, its lettering soft and unreadable, ' +
  'and no other surface in the frame carries text or logos. No close-up of hands.'

/**
 * O PAINEL QUE É A AULA — a terceira posição da régua de placas, ratificada pelo
 * dono no lote do M3 (25/07).
 *
 * As duas posições anteriores eram "placa ao fundo, fora de foco" e "placa de
 * rua em foco, uma ou duas palavras". Falta a que o M3 exige: no módulo do voo,
 * QUATRO fotos são painéis de aeroporto, e a aluna precisa aprender a LER
 * `DELAYED`, `BOARDING`, `GATE`, `ON TIME` neles. Painel desfocado aqui não é
 * fotografia com profundidade rasa: é a aula apagada.
 *
 * A régua do dono, literal: o modelo erra o que INVENTA e acerta a palavra curta
 * que se MANDA escrever. Daí o parâmetro — quem chama dita as linhas exatas, e
 * nada além delas é deixado à imaginação do modelo. O que segue proibido é o que
 * sempre foi: nome de empresa, logo, brasão, bandeira e letra miúda.
 *
 * A cláusula da célula vazia é a mesma do `PLACAS_EM_FOCO` e existe pelo mesmo
 * motivo: dado um jeito de sair sem inventar, o modelo costuma tomá-lo.
 */
export const painelQueEnsina = (linhas: string): string =>
  'The information board is the SUBJECT of this photograph: it is sharp, evenly lit and perfectly legible, ' +
  'plain white sans-serif capitals on a dark panel, the way a real airport board looks. ' +
  `${linhas} ` +
  'Every word on it is a real English word or a real city name, spelled correctly letter by letter. ' +
  'No airline name, no airline logo, no emblem, no flag, no country name, no small print and no extra columns: ' +
  'nothing appears on the board except the lines listed above. ' +
  'If a word cannot be rendered correctly letter by letter, that cell is left plain and empty instead of being filled ' +
  'with invented letterforms. ' +
  'Every other sign, poster and screen in the frame lies well behind the plane of focus, its lettering dissolved into ' +
  'soft unreadable shapes, and no other surface in the frame carries text or logos.'

/**
 * TRIPULAÇÃO SEM COMPANHIA. Mesma família do `GUICHE_GENERICO` das cenas do M2 e
 * pelo mesmo motivo: pessoa uniformizada é o lugar onde este modelo cola marca,
 * brasão e crachá sozinho. Vale para a cena do serviço a bordo (M3A2) e para o
 * card `vocab/crew` — dois scripts, um bloco.
 */
export const TRIPULACAO_GENERICA =
  ' The cabin crew member wears a plain dark uniform with no logo, no badge, no name tag, no wings pin, no scarf ' +
  'pattern and no company colours — nothing identifies a real airline. The trolley, the cups and the cabin surfaces ' +
  'are plain and unbranded. The crew member is seen from the passenger’s seat, at a normal distance, head turned ' +
  'towards their work and softly off the plane of focus, never posing and never looking at the camera.'

// ------------------------------------------------------------------ maquinário

/**
 * `.env.local` é git-ignored e neste worktree é um symlink. Se o script for
 * chamado sem `--env-file`, a chave é lida daqui — mesmo caminho do `probe.ts`.
 */
export function carregaChaveDoArquivo(raiz: string): void {
  if (process.env.GEMINI_API_KEY) return
  const f = path.join(raiz, '.env.local')
  if (!fs.existsSync(f)) return
  const linha = fs
    .readFileSync(f, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('GEMINI_API_KEY='))
  if (!linha) return
  process.env.GEMINI_API_KEY = linha.slice('GEMINI_API_KEY='.length).trim().replace(/^["']|["']$/g, '')
}

/** provedor pronto, ou o processo morre dizendo o que falta */
export function provedorOuSai(raiz: string): ImageProvider {
  carregaChaveDoArquivo(raiz)
  const config = geminiConfigFromEnv()
  if (!config) {
    console.error('Sem GEMINI_API_KEY (nem no ambiente, nem no .env.local).')
    process.exit(2)
  }
  return geminiProvider(config)
}

/** `m5/lost-tourist.jpg` → `m5-lost-tourist` */
export const pasta = (endereco: string): string => endereco.replace(/\.[a-z]+$/i, '').replace(/\//g, '-')

/** a extensão sai do mimeType REAL — nunca de chute (ver `gemini.ts`) */
export function extensao(mimeType: string): string {
  const sub = mimeType.split('/')[1] ?? ''
  return sub === 'jpeg' ? 'jpg' : sub
}

const dorme = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * O FREIO COMPARTILHADO. Recuar só a candidata que tomou 429 não adianta quando
 * há LOTE chamadas em voo: as outras continuam batendo na porta enquanto ela
 * espera, e a cota não se recupera. Um 429 pausa TODA nova partida da rodada
 * pelo tempo do recuo — é o que "recuo exponencial" significa quando o gargalo é
 * a chave e não a chamada.
 */
let freioAte = 0

async function esperaOFreio(): Promise<void> {
  for (let falta = freioAte - Date.now(); falta > 0; falta = freioAte - Date.now()) await dorme(falta)
}

/**
 * UMA chamada ao provedor, com retentativa em PICO — a mesma política para a
 * geração e para a conferência, que é o motivo de ela ser genérica: as duas
 * batem na mesma chave, tomam o mesmo 429 e têm de respeitar o mesmo freio.
 * Duas cópias da política seriam duas chances de elas divergirem.
 *
 * Não é resiliência decorativa: na rodada de 25/07 o Gemini devolveu "high
 * demand" em 1 das 6 e a rodada voltou com 5.
 *
 * O que NÃO se retenta: erro que não casa com `TRANSITORIO` (recusa de conteúdo,
 * prompt malformado, chave errada). Repetir esses é gastar tempo para receber a
 * mesma resposta, e ainda esconde do log qual é o defeito real.
 *
 * O que ABORTA A RODADA: saldo esgotado (ver `SEM_CREDITO`), depois de uma
 * confirmação.
 */
export type Classe = 'ok' | 'sem-credito' | 'pico' | 'defeito'

/**
 * Que espécie de erro é este — a distinção que o dono pediu depois de 25/07.
 *
 *  • `sem-credito` aborta a rodada (dinheiro acabou; insistir é ficar mudo).
 *  • `pico`        recua e insiste (429/500/503/timeout de verdade).
 *  • `defeito`     desiste na hora (recusa de conteúdo, chave errada, prompt
 *                  malformado): repetir é receber a mesma resposta.
 *
 * A ordem das duas primeiras réguas importa e é o bug que esta função conserta:
 * saldo esgotado TAMBÉM chega como 429 e casaria com `TRANSITORIO`.
 */
export function classifica(erro: string | null): Classe {
  if (erro === null) return 'ok'
  if (SEM_CREDITO.test(erro)) return 'sem-credito'
  if (TRANSITORIO.test(erro)) return 'pico'
  return 'defeito'
}

async function insiste<T>(
  rotulo: string,
  chamada: () => Promise<T>,
  erroDe: (r: T) => string | null,
): Promise<T> {
  let ultima: T = await chamada()
  for (let tentativa = 0; ; tentativa++) {
    if (tentativa > 0) ultima = await chamada()
    const erro = erroDe(ultima)
    if (erro === null) return ultima
    const classe = classifica(erro)

    if (classe === 'sem-credito') {
      // a segunda opinião: em 25/07 esta mensagem chegou numa chave que tinha
      // crédito e voltou a gerar segundos depois. Confirmada, a rodada morre.
      if (creditoEsgotado) return ultima
      console.log(`  ⚠ ${rotulo}: "${erro.slice(0, 90)}" — confirmando em ${CONFIRMA_CREDITO_MS / 1000}s`)
      await dorme(CONFIRMA_CREDITO_MS)
      const segunda = await chamada()
      const erroDaSegunda = erroDe(segunda)
      if (erroDaSegunda === null) return segunda
      if (classifica(erroDaSegunda) === 'sem-credito') creditoEsgotado = erroDaSegunda
      return segunda
    }

    if (classe === 'defeito' || tentativa >= TENTATIVAS_DE_REDE - 1) return ultima
    picos++
    // exponencial no número da tentativa + jitter de até 50% do próprio recuo
    const espera = Math.round(RECUO_BASE_MS * 3 ** tentativa * (1 + Math.random() * 0.5))
    freioAte = Math.max(freioAte, Date.now() + espera)
    console.log(`  ↺ pico em ${rotulo} (${erro.slice(0, 90)}) — recuando ${Math.round(espera / 1000)}s`)
    await esperaOFreio()
  }
}

/** o erro de uma geração, ou null quando ela veio com bytes */
function erroDaGeracao(r: ImageStarted): string | null {
  if (veioPronta(r)) return r.ready[0] ? null : 'resposta pronta mas sem bytes'
  return 'error' in r ? r.error : `o provedor devolveu um handle (${r.handle}) — inesperado no Gemini`
}

/** uma candidata */
async function gera(provider: ImageProvider, prompt: string, framing: ImageFraming): Promise<ImageStarted> {
  return insiste('geração', async () => {
    await esperaOFreio()
    return provider.start({ prompt, framing })
  }, erroDaGeracao)
}

/**
 * QUEM OLHA A FOTO. Em produção é sempre o `confere` do `conferencia.ts`; o tipo
 * existe para o teste da rodada poder dizer "reprova as duas primeiras e aprova
 * a terceira" sem rede — é a única forma de verificar o laço de retentativa sem
 * queimar crédito de verdade.
 */
export type Conferente = (imagem: ImageBytes, regra: Regra) => Promise<Conferencia>

/**
 * A conferência da candidata, com a MESMA política de retentativa da geração —
 * e é aqui que ela paga: erro de rede na conferência não pode custar uma
 * geração nova. Só depois de a política desistir é que o endereço falha.
 */
async function confereComRetentativa(
  conferente: Conferente,
  imagem: ImageBytes,
  regra: Regra,
): Promise<Conferencia> {
  return insiste(
    'conferência',
    async () => {
      await esperaOFreio()
      return conferente(imagem, regra)
    },
    (c) => ('erro' in c ? c.erro : null),
  )
}

/**
 * O POOL. A versão anterior disparava as candidatas em ONDAS SÍNCRONAS dentro de
 * um alvo: com LOTE=2 e 6 candidatas eram três ondas, e a onda seguinte só
 * começava quando a mais lenta da anterior voltasse — então a concorrência real
 * era menor que LOTE, e entre um alvo e o outro caía a zero. Isso é metade dos
 * 40 minutos que 14 fotos custaram.
 *
 * Aqui as vagas são globais à rodada e uma vaga que vaga é ocupada na hora, por
 * qualquer alvo. Efeito colateral que a medição mostrou ser o principal ganho:
 * as partidas ficam defasadas em vez de simultâneas, e era a simultaneidade —
 * não o número — que estourava o teto de 60s por chamada.
 */
function poolDe(limite: number): <T>(tarefa: () => Promise<T>) => Promise<T> {
  let ativos = 0
  const fila: Array<() => void> = []
  return async <T>(tarefa: () => Promise<T>): Promise<T> => {
    if (ativos >= limite) await new Promise<void>((libera) => fila.push(libera))
    ativos++
    try {
      return await tarefa()
    } finally {
      ativos--
      fila.shift()?.()
    }
  }
}

/** um endereço da biblioteca a produzir nesta rodada */
export interface Alvo {
  /** endereço na biblioteca, como o conteúdo o referencia */
  endereco: string
  /** de onde ele vem — só para o log */
  rotulo: string
  /** prompt final, já montado por quem chamou */
  prompt: string
  framing: ImageFraming
  /** que régua a conferência aplica nesta foto (ver `conferencia.ts`) */
  regra: Regra
}

/** endereço que a rodada NÃO conseguiu entregar, e por quê */
export interface Falha {
  endereco: string
  motivo: string
}

export interface ResultadoDaRodada {
  /** endereços entregues em `brand/slides/library/` nesta rodada */
  entregues: string[]
  /** endereços que a rodada não gerou porque já existiam ou repetiam */
  pulados: string[]
  falhas: Falha[]
  /** quantas imagens foram geradas — é a conta do dinheiro */
  geracoes: number
  conferencias: number
  /** mensagem do provedor quando a rodada abortou por saldo esgotado */
  semCredito?: string
}

/** o arquivo do endereço dentro da biblioteca */
const naBiblioteca = (raiz: string, endereco: string): string =>
  path.join(raiz, 'brand', 'slides', 'library', endereco)

/**
 * Uma foto por endereço: gera 1, confere, e só regera o que a conferência
 * REPROVAR, até `TENTATIVAS_POR_ENDERECO`.
 *
 * Toda candidata fica gravada em `destino/<pasta>/N.jpg` com o veredito ao
 * lado, inclusive — principalmente — as reprovadas: é o material com que a
 * régua da conferência se valida na próxima vez que alguém desconfiar dela.
 */
async function produz(opts: {
  alvo: Alvo
  dir: string
  raiz: string
  provider: ImageProvider
  conferente: Conferente
  vaga: <T>(t: () => Promise<T>) => Promise<T>
}): Promise<{ entregue: string | null; motivo: string; geracoes: number; conferencias: number; linhas: string[] }> {
  const { alvo, dir, raiz, provider, conferente, vaga } = opts
  const linhas: string[] = []
  let geracoes = 0
  let conferencias = 0

  for (let n = 1; n <= TENTATIVAS_POR_ENDERECO; n++) {
    if (creditoEsgotado) {
      return { entregue: null, motivo: 'rodada abortada: saldo esgotado', geracoes, conferencias, linhas }
    }

    const r = await vaga(() => gera(provider, alvo.prompt, alvo.framing))
    geracoes++
    if (!veioPronta(r) || !r.ready[0]) {
      const erro = erroDaGeracao(r) ?? 'o provedor não devolveu bytes'
      linhas.push(`  ${n}. ✗ ${erro}`)
      // erro de geração não é defeito da foto: insistir de novo é gastar mais
      // uma chamada para receber a mesma recusa (o pico já foi retentado dentro).
      return { entregue: null, motivo: erro, geracoes, conferencias, linhas }
    }
    const img = r.ready[0]

    const arquivo = path.join(dir, `${n}.${extensao(img.mimeType)}`)
    fs.writeFileSync(arquivo, img.data)
    const kb = Math.round(img.data.byteLength / 1024)

    const veredito = await vaga(() => confereComRetentativa(conferente, img, alvo.regra))
    conferencias++
    fs.writeFileSync(path.join(dir, `${n}.veredito.json`), `${JSON.stringify(veredito, null, 2)}\n`)

    if ('erro' in veredito) {
      linhas.push(`  ${n}. ⚠ ${path.relative(raiz, arquivo)} (${kb} KB) — a conferência falhou: ${veredito.erro}`)
      // a foto pode até estar boa, mas ninguém olhou: entregar seria aprovar no
      // escuro, e regerar seria pagar por um defeito que não se sabe se existe.
      return { entregue: null, motivo: `conferência sem resposta: ${veredito.erro}`, geracoes, conferencias, linhas }
    }

    if (!veredito.aprovada) {
      linhas.push(`  ${n}. ✗ ${resumo(veredito)}`)
      continue
    }

    // a extensão do endereço TEM de bater com o mimeType real — salvar JPEG com
    // nome .png é o arquivo mentindo para o Drive e para o renderer (ver gemini.ts)
    const esperada = path.extname(alvo.endereco).slice(1).toLowerCase()
    if (esperada !== extensao(img.mimeType)) {
      const motivo = `o provedor devolveu ${img.mimeType} e o endereço pede .${esperada}`
      linhas.push(`  ${n}. ✗ ${motivo}`)
      return { entregue: null, motivo, geracoes, conferencias, linhas }
    }

    const destinoFinal = naBiblioteca(raiz, alvo.endereco)
    fs.mkdirSync(path.dirname(destinoFinal), { recursive: true })
    fs.writeFileSync(destinoFinal, img.data)
    linhas.push(`  ${n}. ✓ ${path.relative(raiz, destinoFinal)} (${kb} KB, ${img.mimeType})`)
    return { entregue: alvo.endereco, motivo: '', geracoes, conferencias, linhas }
  }

  return {
    entregue: null,
    motivo: `${TENTATIVAS_POR_ENDERECO} tentativas, todas reprovadas na conferência`,
    geracoes,
    conferencias,
    linhas,
  }
}

/**
 * A RODADA — gera 1 candidata por endereço, confere por máquina e só regera o
 * que a conferência reprovar (decisão do dono, 25/07 à noite; o desenho antigo
 * gerava 4–6 por endereço ANTES de alguém olhar qualquer uma).
 *
 * O que ela entrega e onde:
 *  • a foto APROVADA vai para `brand/slides/library/<endereço>` — é o fim da
 *    fase de aprovação de foto. A escolha estética continua sendo da professora,
 *    que troca o que não gostar; o que a máquina garante é que não sai marca,
 *    país, garrancho, dedo a mais nem emenda no slide da aluna.
 *  • TODA candidata, aprovada ou reprovada, e o veredito de cada uma ficam em
 *    `destino/<pasta-do-endereço>/`, com o prompt literal ao lado.
 *
 * O que ela NÃO faz: endereço que já existe na biblioteca não é regerado (o
 * `pillow` do M3 é o `pillow` do M4), e endereço repetido no mesmo lote gera uma
 * vez só. `refazer` derruba a primeira guarda — e SOBRESCREVE o arquivo que já
 * está na biblioteca, então é opção explícita de quem chama, nunca o padrão.
 *
 * Falha não vira placeholder: o endereço entra na lista de falhas do relatório.
 */
export async function rodada(opts: {
  provider: ImageProvider
  destino: string
  raiz: string
  alvos: Alvo[]
  refazer?: boolean
  /** só o teste passa isto; em produção é a conferência de verdade */
  conferente?: Conferente
}): Promise<ResultadoDaRodada> {
  const { provider, destino, raiz, alvos, refazer = false } = opts
  const t0 = Date.now()
  const vaga = poolDe(LOTE)
  picos = 0
  creditoEsgotado = null

  let conferente = opts.conferente
  if (!conferente) {
    carregaChaveDoArquivo(raiz)
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      console.error('Sem GEMINI_API_KEY — a conferência não tem como olhar as fotos.')
      process.exit(2)
    }
    conferente = (imagem, regra) => confere({ apiKey, imagem, regra })
  }

  // ---- as duas deduplicações, ANTES de qualquer chamada
  const pulados: string[] = []
  const vistos = new Set<string>()
  const fila: Alvo[] = []
  for (const alvo of alvos) {
    if (vistos.has(alvo.endereco)) {
      pulados.push(`${alvo.endereco} (repetido neste lote)`)
      continue
    }
    vistos.add(alvo.endereco)
    if (!refazer && fs.existsSync(naBiblioteca(raiz, alvo.endereco))) {
      pulados.push(`${alvo.endereco} (já está na biblioteca)`)
      continue
    }
    fila.push(alvo)
  }
  for (const p of pulados) console.log(`↷ ${p}`)
  if (pulados.length) console.log()

  // TUDO é despachado de uma vez; quem segura a mão é o pool. As promessas ficam
  // guardadas por alvo para o log sair NA ORDEM do catálogo — um log que se
  // embaralha conforme a rede é um log que ninguém consegue ler.
  const emVoo = fila.map((alvo) => {
    const dir = path.join(destino, pasta(alvo.endereco))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'prompt.txt'), `${alvo.prompt}\n`)
    return { alvo, trabalho: produz({ alvo, dir, raiz, provider, conferente, vaga }) }
  })

  const entregues: string[] = []
  const falhas: Falha[] = []
  let geracoes = 0
  let conferencias = 0

  for (const { alvo, trabalho } of emVoo) {
    const r = await trabalho
    geracoes += r.geracoes
    conferencias += r.conferencias
    console.log(`▸ ${alvo.endereco}  (${alvo.rotulo})`)
    for (const l of r.linhas) console.log(l)
    if (r.entregue) entregues.push(r.entregue)
    else falhas.push({ endereco: alvo.endereco, motivo: r.motivo })
    console.log()
  }

  const segundos = (Date.now() - t0) / 1000
  const porFoto = entregues.length ? (geracoes / entregues.length).toFixed(2) : '—'
  console.log(
    `${entregues.length} foto(s) entregue(s) em ${Math.round(segundos)}s — ${geracoes} geração(ões) ` +
      `(${porFoto} por foto entregue), ${conferencias} conferência(s), concorrência ${LOTE}, ${picos} pico(s) com recuo.`,
  )
  if (falhas.length) {
    console.log(`\n${falhas.length} endereço(s) SEM foto — nada foi entregue neles:`)
    for (const f of falhas) console.log(`  ${f.endereco}: ${f.motivo}`)
  }
  if (creditoEsgotado) {
    console.error(
      `\n⛔ SALDO ESGOTADO na chave do Gemini — a rodada parou.\n   ${creditoEsgotado}\n` +
        '   Recarregue em https://ai.studio/projects e rode de novo: o que já foi entregue não é regerado.',
    )
  }
  return {
    entregues,
    pulados,
    falhas,
    geracoes,
    conferencias,
    ...(creditoEsgotado ? { semCredito: creditoEsgotado } : {}),
  }
}

/**
 * O código de saída de quem chamou a rodada — os três scripts fecham igual.
 * `3` para saldo esgotado é o que separa "acabou o dinheiro" de "uma foto não
 * saiu" na hora de ler o resultado de um agente que rodou sozinho.
 */
export function saidaDaRodada(r: ResultadoDaRodada): never {
  process.exit(r.semCredito ? 3 : r.falhas.length ? 1 : 0)
}
