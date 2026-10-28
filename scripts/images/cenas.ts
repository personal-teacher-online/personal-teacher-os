/**
 * Fotos de CENA dos módulos novos do curso v2 — o gerador irmão do `capas-m5.ts`.
 *
 * As 14 aulas de M2/M3/M4 estão escritas e apontam para 42 endereços de foto que
 * não existem no disco. Sem eles o `template-v2` cai na variante sem-foto e o
 * deck sai mais pobre do que foi escrito. Este script gera UMA foto por
 * endereço, a conferência do `conferencia.ts` olha cada uma, e só o que ela
 * reprova custa outra geração; a aprovada vai direto para
 * `brand/slides/library/` e todas as candidatas ficam em `out/` (git-ignored)
 * com o veredito ao lado.
 *
 * O que este script tem de diferente do `capas-m5.ts`:
 *
 *  1. **Ponto de vista da ALUNA, não retrato da professora.** No M5 as cinco
 *     capas são a mesma mulher, e o bloco `PERSONA_E_LUZ` existe para manter o
 *     rosto coerente entre elas. Aqui são 42 fotos: manter um rosto por 42
 *     imagens é uma aposta que o modelo perde, e ainda põe a aluna assistindo à
 *     viagem de outra pessoa. A direção do dono é a inversa — a viajante aparece
 *     de costas, em silhueta, pelas mãos, ou não aparece. Ver `PONTO_DE_VISTA`.
 *  2. **Clima por PARTE do curso, não por módulo.** A unidade de variação de
 *     ambiente é a PARTE (`src/lib/slides/climate.ts`), e M2/M3/M4 são a mesma:
 *     FIRST STEPS, "aeroporto/hotel, luz fria de terminal". Quem escrever as
 *     cenas do M3 e do M4 herda o clima sem redigir nada.
 *  3. **Enquadramento medido no template v2**, não o mapa do v1 (ver `MOLDURA`).
 *
 * Uso:
 *   node scripts/images/cenas.ts m2                     (o módulo inteiro)
 *   node scripts/images/cenas.ts m2 m2/plane-window.jpg (um endereço, ou vários)
 *   node scripts/images/cenas.ts m2 --prompts           (só imprime, não gasta)
 *   node scripts/images/cenas.ts m2 --refazer           (regera mesmo já existindo)
 */
import fs from 'node:fs'
import path from 'node:path'
import { ESTILO } from '../../src/lib/images/prompt.ts'
import type { ImageFraming } from '../../src/lib/images/provider.ts'
import { BODY_BOTTOM, BODY_Y } from '../../src/lib/slides/layout.ts'
import { FACECAM_V2 } from '../../src/lib/slides/template-v2.ts'
import { climateFor, type PartId } from '../../src/lib/slides/climate.ts'
import type { Regra } from './conferencia.ts'
import {
  PAGINA,
  PLACAS_AO_FUNDO,
  PLACAS_AO_FUNDO_BASE,
  TRIPULACAO_GENERICA,
  ZONA_FACECAM_PCT,
  painelQueEnsina,
  provedorOuSai,
  rodada,
  saidaDaRodada,
  semEmenda,
} from './comum.ts'

const raiz = path.resolve(import.meta.dirname, '../..')
const CONTEUDO = path.join(raiz, 'content', 'personal-travel-v2')
const DESTINO = path.join(raiz, 'out', 'cenas')

// ------------------------------------------------------------------- clima

/**
 * O CLIMA de cada PARTE do curso, em inglês e no nível de detalhe que o modelo
 * usa. A fonte da verdade sobre QUAL parte é qual é o `climate.ts` do renderer
 * (é ele que escolhe o fog do slide); o que está aqui é a tradução da linha
 * `photo` daquela tabela para uma direção fotográfica utilizável.
 *
 * As SEIS partes estão escritas (lote de 26/07, 121 cenas de M0/M1/M3/M4/M6–M12).
 * Parte sem clima segue sendo ERRO, não fallback silencioso: uma cena gerada com
 * o clima errado é uma foto que passa na conferência e destoa no deck.
 *
 * Cada bloco fecha com a mesma rede: a lista do que aquela parte NÃO é. É ela
 * que mantém as seis famílias separadas — sem a negativa explícita o modelo puxa
 * toda cena de rua para o pôr do sol dourado, que é o clima de UMA parte só.
 */
const CLIMA_DA_PARTE: Partial<Record<PartId, string>> = {
  // PARTE 1 — THE PILLARS OF FLUENCY (GET READY + M1): "interior de estudo, luz
  // de manhã, quente-neutro". É a única parte que NÃO é viagem: nada de
  // aeroporto, hotel ou rua estrangeira aqui — a aluna ainda está em casa.
  1:
    'The scene happens indoors at home, in an ordinary lived-in Brazilian flat — a study corner, a kitchen table, a ' +
    'desk pushed against a window — in the soft neutral light of the morning coming through that window. Warm-neutral ' +
    'daylight, pale wood, white paper, cream walls and muted greys, with soft open shadows. A real weekday home that ' +
    'someone uses, not a showroom. Never a golden late-afternoon sun, never an orange sunset glow, never long ' +
    'dramatic shadows, never the flat cold light of an airport terminal. ',

  // PARTE 2 — FIRST STEPS (M2 imigração, M3 voo, M4 hotel): "aeroporto/hotel,
  // luz fria de terminal". É o contraste deliberado com a PARTE 3 (M5–M7), que
  // é rua de fim de tarde dourado: luz dourada aqui é motivo de REPROVAÇÃO.
  2:
    'The scene happens inside a big modern international airport: tall glass walls, high ceilings with even overhead ' +
    'light panels, a polished floor with soft reflections, wide open indoor space, greys, blues and brushed steel. ' +
    'The daylight coming through the glass is cool, flat and overcast — never warm golden sunlight, never an orange ' +
    'sunset, never long dramatic shadows. ',

  // PARTE 3 — TIME TO TOUR (M5 transporte, M6 comida, M7 compras): "rua e
  // cidade, fim de tarde dourado". É a ÚNICA parte em que o dourado é certo — as
  // 33 fotos já aprovadas do M5/M6/M7 são a referência, e as poucas que faltam
  // têm de cair na mesma família.
  3:
    'The scene happens outdoors in the streets of an ordinary European city in the late afternoon, in warm golden low ' +
    'sunlight: long soft shadows across the pavement, warm stone and painted façades, amber and honey tones with cool ' +
    'blue shade between the buildings. An ordinary working street, not a postcard. Never the flat cold light of an ' +
    'airport terminal, never the middle of the night, never a grey heavy overcast. ',

  // PARTE 4 — FRIENDS & NETWORKING (M8 small talk, M9 técnica de conversa):
  // "cafés e praças, luz difusa". A diferença para a PARTE 3 é a LUZ, não o
  // lugar: aqui o céu está encoberto e a sombra é aberta — sol baixo dourado
  // nesta parte é o mesmo defeito que luz de terminal na parte 3.
  4:
    'The scene happens in an ordinary European city, in and around cafés, squares, terraces and shared tables, under ' +
    'soft diffuse overcast daylight: even light with no hard shadows, warm-neutral, in creams, warm greys, wood, ' +
    'brick and soft green. The sky is bright and white rather than blue. Never a golden late-afternoon sun, never an ' +
    'orange sunset glow, never long dramatic shadows, never the flat cold light of an airport terminal. ',

  // PARTE 5 — EMERGENCIES (M10 saúde, M11 imprevistos): "clínica/estação, luz
  // clara neutra, SEM DRAMA". A última cláusula é a mais importante da parte
  // inteira: é um módulo que a aluna vai abrir com medo, e a foto não pode
  // assustar antes de a professora falar.
  5:
    'The scene happens in the plain public interiors of an ordinary city — a small pharmacy, a clinic waiting room, a ' +
    'service counter, a station or terminal hall — under clear neutral daylight and even overhead light: white, pale ' +
    'grey, pale green, light wood and brushed steel, everything tidy, quiet and undramatic. Never a golden ' +
    'late-afternoon sun, never an orange sunset glow, never long dramatic shadows, never harsh contrast, never a ' +
    'dark, tense or menacing atmosphere. ',

  // PARTE 6 — READY TO GO (M12 simulação final): "horizonte/viagem, luz clara e
  // otimista". É o fecho do curso: mais luz que todas as outras, ar limpo,
  // horizonte aberto — e ainda assim sem o dourado, que é da parte 3.
  6:
    'The scene happens on the move, in clear bright optimistic daylight with plenty of air and an open horizon: a ' +
    'bright sky, clean light, wide space, in whites, pale blues, pale wood and warm neutrals. The light is even, ' +
    'generous and hopeful. Never a golden late-afternoon sun, never an orange sunset glow, never long dramatic ' +
    'shadows, never a grey heavy overcast. ',
}

/**
 * O HOTEL — o clima do M4, e a razão de ele NÃO estar na tabela acima.
 *
 * A PARTE 2 é "aeroporto/hotel, luz fria de terminal" (`climate.ts`): duas
 * cenografias sob um só nome. O M2 e o M3 se passam inteiros no aeroporto, e o
 * bloco da PARTE está escrito para ele — vidro, teto alto, aço escovado. O M4
 * se passa inteiro no hotel, e mandar "big modern international airport" numa
 * cena de quarto é pedir um saguão com cama dentro.
 *
 * Então o M4 troca o clima alvo a alvo (campo `clima` da `Cena`), que é o
 * mecanismo que já existia para as exceções do M2 (a cozinha, a cabine). O que
 * NÃO muda é o contraste que dá sentido à PARTE: a luz do hotel é mais quente
 * que a do terminal e ainda assim CONTIDA — o dourado de rua de fim de tarde é
 * da PARTE 3 (M5–M7), e aqui continua sendo motivo de reprovação.
 */
const CLIMA_DO_HOTEL =
  'The scene happens inside an ordinary modern city hotel: a reception counter of pale stone and wood, a quiet ' +
  'carpeted corridor, a plain comfortable guest room. The light is indoor hotel light — soft warm lamps mixed with ' +
  'flat daylight through a window — warm but restrained and even, in creams, greys, wood and soft blue-greys. ' +
  'Never a golden late-afternoon sun, never an orange sunset glow, never long dramatic shadows. '

/** o mesmo hotel, do lado de dentro do quarto: janela, cama, banheiro */
const CLIMA_DO_QUARTO =
  'The scene happens inside a plain comfortable hotel guest room: a made bed with white linen, a bedside table with a ' +
  'lamp, a window with daylight coming through it, muted creams, greys and wood. The light is even and restrained — ' +
  'never a golden late-afternoon sun, never an orange sunset glow, never long dramatic shadows. '

/**
 * O ponto de vista, que é a decisão de direção mais importante deste lote.
 *
 * Dois problemas de uma vez: um rosto consistente em 42 fotos é aposta perdida,
 * e a aluna precisa SE VER na cena em vez de assistir outra pessoa viajando.
 * Escrito em positivo — o modelo desenha as costas, a silhueta, as mãos — e só
 * depois a rede contra o sorriso de banco de imagens.
 */
const PONTO_DE_VISTA =
  'The photograph is taken from the traveller’s own point of view, the way she would remember the moment: ' +
  'she is seen from behind, or as a silhouette against the light, or from far away in the crowd, or only her hands ' +
  'and her belongings are in the frame — and in some frames she is not there at all, only the place. ' +
  'Faces are turned away from the camera or lost in the depth of field. Nobody poses, nobody smiles at the lens, ' +
  'there is no eye contact with the camera; the other people are strangers passing through, most of them out of focus. ' +
  'A real ordinary moment, caught rather than staged. '

// ------------------------------------------------------------- composição

/**
 * O CANTO DA CÂMERA — a correção de 25/07 à noite, achada pelo dono na validação.
 *
 * A regra anterior mandava o assunto da capa para "a metade de cima, um pouco à
 * DIREITA do centro". É exatamente onde a facecam da professora pousa
 * (`FACECAM_SIDE = 'right'`), e na capa do M2A1 a viajante de costas ficou atrás
 * do rosto dela. O tamanho da zona não está escrito aqui: sai de `ZONA_FACECAM`
 * no `comum.ts`, que o deriva de `FACECAM_V2` — mudar a câmera de tamanho
 * reescreve esta frase sozinho.
 *
 * Escrito em POSITIVO pelo mesmo motivo da cláusula da emenda: "parede, vidro,
 * céu, corredor vazio" dá ao modelo algo para desenhar; "sem nada aqui" não dá.
 */
const CANTO_DA_CAMERA =
  `The top right corner of the frame is reserved and stays calm background: the rightmost ${ZONA_FACECAM_PCT.largura}% ` +
  `of the width, from the top edge down through the top ${ZONA_FACECAM_PCT.altura}% of the height, is a plain wall, a ` +
  'glass façade, open sky, an empty stretch of corridor or plain defocused depth — and nothing else. No face, no body, ' +
  'no luggage, no sign, screen or board with lettering, nothing sharp and nothing an eye would stop on. '

/**
 * CAPA — no `template-v2` a foto da capa é SANGRADA na página inteira com dois
 * véus escuros por cima, o bloco de título ocupando a metade de baixo (da
 * esquerda até ~80% da largura) e a FACECAM da professora entrando por cima do
 * canto superior direito. Quem manda no que sobra é a geometria: o assunto vive
 * na metade de cima, à ESQUERDA ou no centro; embaixo mora o título; no canto
 * superior direito mora a câmera.
 *
 * ⚠️ Na capa a caixa da facecam NÃO é desenhada (só o `paperSlideV2` chama o
 * `facecamDock`) — no PNG a foto aparece inteira e a colisão fica invisível. Foi
 * assim que este defeito passou pela validação de 25/07. Para VER a zona:
 * `node scripts/images/facecam-qa.ts content/personal-travel-v2/m2a1.json`.
 *
 * A cláusula da emenda vem do `comum.ts` pelo mesmo motivo do M5 — pedir área
 * calma sem ela é o convite para o modelo colar uma faixa de outra foto.
 */
const COMPOSICAO_CAPA =
  'Composition: a wide horizontal photograph. What matters — the subject and the action — sits in the upper half of ' +
  'the frame, on the left side or around the centre, rising towards the upper left. ' +
  CANTO_DA_CAMERA +
  'The lower half of the frame stays visually calm and uncluttered — floor, an empty ' +
  'stretch of the hall, softly defocused space — with no face and no important detail down there; it does not have to ' +
  'be empty, only quiet. ' +
  semEmenda('the traveller’s body')

/**
 * WARM UP e TRAVEL TIP — no `template-v2` as duas põem a foto numa moldura quase
 * quadrada ao lado do texto (3.66×3.08 e 2.85×2.84), o que na projeção dá cerca
 * de 7 cm de largura. Nesse tamanho, cena cheia de gente vira purê: o critério é
 * "lê de relance", e é isso que o bloco pede.
 */
const COMPOSICAO_QUADRO =
  'Composition: a nearly square frame with ONE clear subject that reads instantly at a small size — this photo is ' +
  'printed about seven centimetres wide on a slide, so the subject is close, centred and unmistakable, with calm ' +
  'uncluttered space around it. ' +
  semEmenda('the traveller’s body')

/**
 * CAPA DE MESA — a `COMPOSICAO_CAPA` para quando o assunto é OBJETO sobre uma
 * superfície e não uma pessoa.
 *
 * A regra da capa manda o assunto para a metade de cima "subindo para a
 * esquerda", o que num objeto fotografado de cima não quer dizer nada. Este
 * bloco diz a mesma coisa em termos de mesa: o objeto no alto à esquerda, a
 * superfície correndo vazia para baixo, e o canto da câmera intacto. As duas
 * cópias à mão que já existiam (`m2/passport-and-notebook`,
 * `m3/passport-boarding-pass`) ficaram como estavam de propósito — a do M2 já
 * gerou foto aprovada, e reescrevê-la mudaria um prompt que funcionou.
 */
const composicaoDeMesa = (superficie: string): string =>
  'Composition: a wide horizontal photograph. What the picture is about sits together in the upper left of the ' +
  'frame, shot from just above the surface. ' +
  CANTO_DA_CAMERA +
  `Towards the lower half ${superficie} runs empty and softly out of focus, with no important detail down there; it ` +
  'does not have to be empty, only quiet. ' +
  semEmenda(superficie)

// ------------------------------------------------------------- restrições

/**
 * MÃOS. O `PROIBIDO` do repo e as duas variantes de placa terminam em "No
 * close-up of hands", e o motivo é bom: dedo deformado é o artefato número um
 * deste modelo. Só que três cenas do M2 SÃO a mão da viajante — o passaporte na
 * mão, o carimbo descendo, o ensaio de pé com o documento — e a direção do lote
 * pede justamente o enquadramento pelas mãos.
 *
 * Então a regra não é suspensa, é substituída por uma exigível na curadoria:
 * mão em distância normal, dedos contáveis, pegada natural. Toda candidata com
 * dedo torto é descartada — o que só é possível porque se olha uma a uma.
 */
const MAOS_CORRETAS =
  ' The traveller’s hands are part of this photograph and they are anatomically correct: one or two hands, five ' +
  'fingers each, a natural relaxed grip on the object, seen from a normal distance rather than pressed against the ' +
  'lens, with no interlaced or overlapping fingers.'

/**
 * DOCUMENTOS. Passaporte, cartão de embarque e papel impresso são texto por
 * definição, e texto inventado dentro da imagem é reprovação automática. A saída
 * é fotográfica, não proibitiva: papel em ângulo raso e fora do plano de foco
 * vira linha cinza — é o que uma foto real faz. O passaporte genérico também
 * resolve o outro risco (país identificável) sem placa em branco.
 */
const DOCUMENTOS_GENERICOS =
  ' The passport is a plain generic travel document: a dark blue booklet with no country name, no coat of arms, no ' +
  'emblem and no readable lettering on the cover. Boarding passes, tickets and printed sheets are seen at a shallow ' +
  'angle and slightly off the plane of focus, so their printing reads as soft grey lines and blocks instead of words: ' +
  'no readable text, no invented letterforms and no logos anywhere in the frame.'

/**
 * AUTORIDADE DE FRONTEIRA. Instrução explícita do dono: nada de uniforme
 * identificável de país real, brasão, bandeira ou crachá legível. Guichê
 * genérico, e o oficial atrás do vidro, parcialmente fora de foco — que é
 * também o que o ponto de vista da aluna já pedia.
 */
const GUICHE_GENERICO =
  ' The officer at the booth is an anonymous public official in plain dark clothing: no insignia, no epaulettes, no ' +
  'patch, no badge, no name tag, no flag and no coat of arms anywhere in the frame — nothing identifies a real country ' +
  'or a real agency. The officer stays behind the counter, partly out of focus, seen from the traveller’s side.'

/**
 * PLACA DE HOTEL — a régua de placas por POSIÇÃO aplicada ao M4, na mesma
 * decisão que o dono ratificou no lote do M3: o modelo erra o que INVENTA e
 * acerta a palavra curta que se MANDA escrever.
 *
 * Não é o `painelQueEnsina` (aquele DITA as linhas de um painel que é o assunto
 * da foto). Aqui a placa é mobiliário do hotel: pode estar nítida quando encara
 * a câmera, mas o vocabulário dela é fechado a um punhado de palavras que
 * qualquer hotel do mundo tem na parede. O que segue proibido é o de sempre —
 * nome de rede, logo, brasão, bandeira e letra miúda.
 */
const PLACAS_DE_HOTEL =
  ' The hotel’s own working signs may be sharp and legible when they face the camera, and each carries at most two ' +
  'short real English words in plain capitals — in the spirit of RECEPTION, CHECK-IN, CHECK-OUT, LIFT, EXIT, ' +
  'LUGGAGE, OUT OF ORDER. Never a whole sentence, never a hotel or chain name, never a brand, a logo, a crest, a coat ' +
  'of arms or a flag, and never invented or garbled letterforms: if a word cannot be spelled correctly letter by ' +
  'letter, that sign is plain brushed metal or plain painted board instead. ' +
  'Every other sign, poster, notice and screen lies well behind the plane of focus, its lettering dissolving into ' +
  'soft unreadable shapes, the way real signage looks in a photo with a shallow depth of field. ' +
  'Nothing sharp and close to the camera carries small print. No close-up of hands.'

/**
 * A CONTA DE HOTEL. O dono foi explícito: numa conta os VALORES podem existir —
 * é o que uma conta é. O que reprova é a miudeza ilegível, e a saída dela é
 * fotográfica, não proibitiva: uma linha no plano de foco, o resto caindo fora
 * dele. É a mesma alavanca dos `DOCUMENTOS_GENERICOS`, com o sinal invertido —
 * lá o papel inteiro sai do foco; aqui uma linha fica.
 */
const CONTA_DE_HOTEL =
  ' The printed bill is a real working hotel invoice, and it does carry print. Only its heading and one or two of its ' +
  'lines fall on the plane of focus: the heading is at most the single word INVOICE or BILL in plain capitals, and a ' +
  'sharp line is at most two plain English words in capitals followed by one plain, correctly formed currency amount, ' +
  'widely spaced. Everything else on the sheet lies off the plane of focus and reads as soft grey ruled bars rather ' +
  'than as words. No hotel name, no chain name, no logo, no crest, no coat of arms, no flag, no barcode, no serial ' +
  'number and no dense block of small print anywhere in the frame. If a word cannot be rendered correctly letter by ' +
  'letter, that line is a plain ruled bar instead.'

/**
 * DINHEIRO. Cédula é o passaporte do M2 outra vez: identifica país, traz rosto,
 * brasão e letra miúda, e é onde o modelo inventa. Moeda metálica não tem esse
 * problema; nota tem, e a saída é a mesma — ângulo raso e fora do plano de foco.
 * O cartão fica liso porque bandeira de cartão é logo de empresa real.
 */
const DINHEIRO_GENERICO =
  ' The banknotes are folded and seen edge-on, off the plane of focus, so they read as soft coloured paper: no ' +
  'country, no portrait, no coat of arms, no figure and no lettering legible on them. The coins are plain worn metal ' +
  'discs with no legible face. The bank card is a plain unmarked card — no bank name, no scheme mark, no logo, no ' +
  'hologram and no embossed number.'

/**
 * A CASA — o clima dos módulos de TÉCNICA (M1 e as cenas de ensaio do M9) e das
 * dicas que mandam a aluna praticar antes de viajar.
 *
 * O M1 é PARTE 1 e herda o bloco da parte sem escrever nada. O M9 é PARTE 4
 * (cafés e praças) e tem QUATRO alvos que se passam dentro de casa — a aluna
 * gravando a voz, lendo em voz alta, o caderno de frases. Mandar "cafés e
 * praças" nessas é pedir um café com escrivaninha dentro; mandar o bloco da
 * PARTE 1 (luz de manhã) é trocar a família de luz do módulo. Então este bloco
 * é a casa com a LUZ DA PARTE 4: difusa, encoberta, sombra aberta.
 */
const CLIMA_DA_CASA_DIFUSA =
  'The scene happens indoors at home, in an ordinary lived-in flat — a table by a window, a study corner, a plain ' +
  'room someone actually uses — under soft diffuse daylight from an overcast sky: even light with no hard shadows, ' +
  'warm-neutral, in creams, pale wood, white paper and muted greys. Never a golden late-afternoon sun, never an ' +
  'orange sunset glow, never long dramatic shadows. '

/**
 * TELA DE NOTA — o bloco que resolve os QUINZE alvos "o plano fica numa nota do
 * celular" espalhados por M1, M7, M8, M9, M10, M11 e M12.
 *
 * É a `m4/phone-note` generalizada, e a régua é a que o dono ratificou no lote
 * do M3: o modelo erra o que INVENTA e acerta a palavra curta que se MANDA
 * escrever. Então o TÍTULO da nota é ditado (é ele o conteúdo da dica — a aluna
 * precisa reconhecer "uma nota chamada EMERGENCY") e o corpo cai fora do plano
 * de foco, virando linha cinza. O que sobra proibido é o de sempre: nome de
 * aplicativo, ícone, relógio, bateria, letra miúda.
 */
const telaDeNota = (titulo: string): string =>
  ' The phone screen is sharp and shows a plain white note with a heading and four or five short lines under it. ' +
  `The heading is ${titulo} in plain capitals, spelled correctly letter by letter; the lines below it are so ` +
  'slightly off the plane of focus that they read as soft grey handwritten lines rather than as words. Nothing else ' +
  'is on the screen — no app name, no icon, no logo, no clock, no battery bar, no status bar and no lines of small ' +
  'print. If the heading cannot be rendered correctly letter by letter, it is left plain and empty instead.'

/**
 * CADERNO. Metade das 121 cenas deste lote tem um caderno aberto no quadro — é o
 * objeto do curso inteiro. Letra manuscrita é texto, e texto nítido inventado é
 * reprovação; a saída é a mesma dos `DOCUMENTOS_GENERICOS`: ângulo raso, fora do
 * plano de foco, e a letra vira o que a letra de longe é — linha cinza.
 */
const CADERNO_GENERICO =
  ' The notebook page carries ordinary handwriting seen at a shallow angle and slightly off the plane of focus, so ' +
  'it reads as soft grey handwritten lines rather than as words: no readable text and no invented letterforms. The ' +
  'notebook, the pen and the stationery are plain and unbranded — no maker’s name, no logo and no lettering on the ' +
  'cover.'

/**
 * OBJETOS SEM MARCA. Celular, fone, notebook, caneca, mochila: são os objetos
 * mais fotografados do curso e são justamente onde o modelo cola uma maçã, um
 * logo de três listras ou um nome de fabricante sem ninguém pedir.
 */
const OBJETOS_SEM_MARCA =
  ' Every manufactured object in the frame is plain and unbranded: the phone, the laptop, the headphones, the mug, ' +
  'the bag, the suitcase and the stationery carry no maker’s name, no logo, no emblem and no lettering of any kind.'

/**
 * NADA CLÍNICO — instrução literal do dono para o M10 inteiro.
 *
 * O módulo é de emergência e saúde, e a voz da aula é "isso te devolve o sono",
 * não "olhe o que pode acontecer com você". Uma foto de ferimento na capa
 * desmente a professora antes de ela abrir a boca. O bloco é escrito em positivo
 * primeiro (farmácia, prateleira, recepção, sala de espera arrumada) porque é o
 * que funciona com este modelo.
 */
const NADA_CLINICO =
  ' This is a calm, ordinary, everyday scene: a tidy pharmacy, a plain shelf, a quiet reception, an empty waiting ' +
  'room. There is no blood, no wound, no injury, no bandage, no needle, no drip, no stretcher, no hospital bed, no ' +
  'sick or suffering person, no crying, no pain on anyone’s face and no emergency in progress anywhere in the frame. ' +
  'Nothing in the picture is frightening or distressing.'

/**
 * SEM AMEAÇA — a segunda instrução literal do dono, para o M11.
 *
 * O módulo tem uma aula sobre golpes, e é a aula em que uma foto errada faz um
 * estrago que nenhuma legenda desfaz: qualquer cena com um "suspeito" põe o
 * modelo a escolher um tipo físico, e a escolha dele é sempre a mesma. A saída é
 * não haver suspeito nenhum no quadro — a rua é rua, e quem está nela está de
 * costas e fora de foco.
 */
const SEM_AMEACA =
  ' Nobody in this photograph is threatening, suspicious, confronting or approaching anyone: there is no crime, no ' +
  'violence, no argument, no chase, no pickpocketing and no hand reaching towards anybody. The other people are ' +
  'anonymous passers-by seen from behind or well out of focus, none of them singled out, none of them the subject, ' +
  'and no individual in the frame can be read as a particular kind of person.'

/**
 * LUZ CLARA ≠ FOTO LAVADA — a correção que a varredura de 25/07 comprou nas duas
 * capas do M12.
 *
 * O clima da PARTE 6 pede "muita luz, ar limpo, horizonte aberto", e o modelo leu
 * isso como EXPOSIÇÃO ALTA: sete das catorze fotos mais claras do curso inteiro
 * são do M12. Isoladas elas são bonitas. Na CAPA elas morrem, porque a capa leva
 * dois véus escuros por cima para o título branco ler — e um véu escuro sobre uma
 * foto que já é quase toda branca não escurece um assunto, apaga a foto: sobra um
 * retângulo cinza claro uniforme. A `m12/rooftop-conversation` foi eleita a pior
 * capa do curso por exatamente isso (céu pálido vazio, ninguém identificável).
 *
 * O bloco NÃO pede foto escura — isso trocaria o clima da parte, que é o fecho
 * otimista do curso. Ele pede FAIXA TONAL: que exista preto no quadro. Um assunto
 * com valores escuros próprios sobrevive ao véu; um assunto branco sobre fundo
 * branco, não. Escrito em positivo (o que É escuro na cena) pelo mesmo motivo de
 * sempre — o modelo desenha o que se manda desenhar.
 */
const CONTRASTE_SOB_O_VEU =
  ' The light is bright and clean, but the photograph is NOT washed out: it keeps a full tonal range, with real ' +
  'deep shadow and real dark values in the frame as well as the bright ones, and the subject stands out clearly ' +
  'and darkly against what is behind it. Never a pale, flat, low-contrast, over-exposed or hazy picture, never a ' +
  'blown-out white sky filling the frame, never a light subject lost against a light background.'

// ------------------------------------------------------------ enquadramento

/**
 * A moldura REAL de cada tipo de slide no `template-v2`, em polegadas. O
 * `framingFor` do `src/lib/images/prompt.ts` descreve o template v1, onde a foto
 * do warm up é uma faixa deitada; no v2 as três molduras são outras, e gerar
 * 3:2 para uma moldura quadrada é entregar a foto para o `sizing: cover`
 * recortar 30% da cena.
 *
 * A altura da banda vem do `layout.ts` (fonte única com o renderer); as larguras
 * são os `photoSplit(3.66)` / `photoSplit(2.85)` do `template-v2.ts` e o
 * `cardTop = BODY_Y + 0.24` do slide de dica.
 */
const MOLDURA: Record<string, { w: number; h: number }> = {
  cover: PAGINA, // sangrada na página inteira (16:9), medida do layout do build
  warmup: { w: 3.66, h: BODY_BOTTOM - BODY_Y },
  tip: { w: 2.85, h: BODY_BOTTOM - (BODY_Y + 0.24) },
  // DIVISÓRIA — o `sectionPhotoCol` do `template-v2` dá à foto a coluna da
  // largura da câmera mais a margem dela, da banda inteira do corpo: 3.06 × 3.08,
  // quadrado por acidente de geometria e não por escolha. ⚠️ Há uma variante: a
  // divisória SEM subtítulo sangra a banda inteira (10 × 3.08). Ela existe em UM
  // alvo do lote (`m0/passport-in-drawer`, que também é warm up em M0A2), e a
  // coluna é a forma dominante — gerar quadrado e deixar o `cover` recortar a
  // faixa do meio custa menos que o inverso, que corta as laterais do assunto.
  section: { w: FACECAM_V2.m + FACECAM_V2.w, h: BODY_BOTTOM - BODY_Y },
  // DIÁLOGO — `asideSplit(3.0).aside` ao lado das pastilhas de fala, começando em
  // `dialogueTop` (o único alvo do lote, `m8/cafe-outdoor-table`, tem `context`,
  // então o topo é BODY_Y + 0.38 e não + 0.06).
  dialogue: { w: 3.0, h: BODY_BOTTOM - (BODY_Y + 0.38) },
}

/** as três proporções que o driver do Gemini sabe pedir */
const PROPORCAO: Record<ImageFraming, number> = { paisagem: 3 / 2, retrato: 2 / 3, quadrado: 1 }

/**
 * O enquadramento cuja proporção menos machuca aquela moldura. Escolher pelo
 * nome ("capa é retrato") é o que produz recorte cego; escolher pela razão
 * largura/altura é o que sobrevive a uma mudança de layout.
 */
function enquadramentoPara(tipo: string): ImageFraming {
  const box = MOLDURA[tipo]
  if (!box) throw new RangeError(`sem moldura medida para slide do tipo "${tipo}" no template v2`)
  const alvo = box.w / box.h
  const nomes = Object.keys(PROPORCAO) as ImageFraming[]
  return nomes.reduce((melhor, nome) =>
    Math.abs(Math.log(PROPORCAO[nome] / alvo)) < Math.abs(Math.log(PROPORCAO[melhor] / alvo)) ? nome : melhor,
  )
}

// ------------------------------------------------------------------- cenas

interface Cena {
  /** endereço na biblioteca, como o conteúdo o referencia */
  endereco: string
  /** a cena em si — entra entre o clima e a regra de composição */
  cena: string
  /** clima próprio; sem isto, vale o clima da PARTE do módulo */
  clima?: string
  /** regra de composição própria; sem isto, a do tipo de slide */
  composicao?: string
  /** bloco final de restrições; sem isto, `PLACAS_AO_FUNDO` */
  restricao?: string
}

// ------------------------------------------------------- PRACTICE TIME (48)

/**
 * A DIVISÓRIA DE PRÁTICA, uma por aula — o lote de 25/07 à noite.
 *
 * Até aqui as 48 aulas que têm a tela PRACTICE TIME apontavam TODAS para
 * `shared/practice-time.jpg`: a aluna que faz o curso inteiro via a mesma foto
 * 48 vezes, e era a tela mais repetida do curso. Agora cada aula tem o seu
 * endereço (`m<N>/practice-a<L>.jpg`), e o que muda entre elas é o CLIMA DA
 * PARTE — a mesma regra de todas as outras fotos do curso. A tela continua a
 * mesma tela: mesmo texto, mesmo papel, mesmo papel dramatúrgico; só o fundo
 * acompanha o capítulo.
 *
 * ⚠️ `shared/practice-time.jpg` NÃO é apagado — pode haver outro uso, e apagar
 * arquivo de biblioteca é irreversível.
 *
 * Três réguas herdadas, e a primeira é do dono:
 *
 *  1. **Luz normal, cores normais.** A primeira versão desta tela saiu com uma
 *     escada rolante em roxo/teal neon e foi REPROVADA em julho ("era pra ser
 *     genérica, com cores normais"). Nada de luz colorida, nada de dramático —
 *     é o mesmo motivo pelo qual `prompt.ts` revogou a paleta da marca dentro da
 *     foto. O clima da PARTE já é luz natural em todas as seis.
 *  2. **Pausa e ensaio, nunca ação nem balcão.** A tela significa "pare e
 *     pratique". Cena de guichê, de pedido, de atendimento é o RESTO do curso —
 *     repetir aqui seria trocar uma repetição por outra, agora com o assunto
 *     errado. Ver `PAUSA_PARA_PRATICAR`, que é a rede escrita disso.
 *  3. **Variar DENTRO da parte.** São até 12 aulas por PARTE, e doze mesas
 *     vistas de doze ângulos seriam a repetição de volta com outro nome. Por
 *     isso cada bloco abaixo alterna postura e assunto (sentada de costas,
 *     silhueta, mãos, objetos sem ninguém, parada no meio do fluxo) em vez de
 *     alternar só o ângulo.
 *
 * ENQUADRAMENTO: as 48 são slide `section` COM subtítulo, e aí o `template-v2`
 * dá à foto a coluna da facecam (3.06 × 3.08) — quadrado por acidente de
 * geometria. Então `enquadramentoPara('section')` devolve `quadrado` e a
 * composição é a `COMPOSICAO_QUADRO`: UM assunto claro, que lê de relance a 7 cm.
 * Nada aqui declara isso — quem declara é o JSON da aula, via `enderecosDoModulo`.
 */
const PAUSA_PARA_PRATICAR =
  'Nothing is happening in this photograph except the pause before speaking: no counter is being attended, no order ' +
  'is being placed, no transaction and no conversation is under way. It is the quiet minute before she tries — ' +
  'waiting, getting ready, going over it once more. '

/** o fecho de restrições das divisórias: caderno, objeto sem marca, sem mão em close */
const RESTRICAO_DA_PRATICA =
  PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + OBJETOS_SEM_MARCA + ' No close-up of hands.'

/** o mesmo, para as divisórias em que as MÃOS são o assunto (ver `MAOS_CORRETAS`) */
const RESTRICAO_DA_PRATICA_COM_MAOS =
  PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + OBJETOS_SEM_MARCA + MAOS_CORRETAS

/** o mesmo, para a divisória cujo assunto é a tela de uma nota do celular */
const restricaoDaPraticaComNota = (titulo: string): string =>
  telaDeNota(titulo) + MAOS_CORRETAS + ' ' + PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + OBJETOS_SEM_MARCA

/**
 * Uma divisória. O endereço é DERIVADO do módulo e da aula em vez de escrito à
 * mão 48 vezes: a convenção `m<N>/practice-a<L>.jpg` é a mesma no conteúdo, e
 * um dígito errado aqui viraria endereço órfão (que o `main` reprova) ou, pior,
 * foto na aula errada.
 */
const pratica = (modulo: number, aula: number, cena: string, resto: Omit<Cena, 'endereco' | 'cena'> = {}): Cena => ({
  endereco: `m${modulo}/practice-a${aula}.jpg`,
  cena: cena + PAUSA_PARA_PRATICAR,
  restricao: RESTRICAO_DA_PRATICA,
  ...resto,
})

/** o quarto de hotel do M4 e o de dentro do avião do M3 — climas que a PARTE 2 não cobre */
const CLIMA_DA_CABINE =
  'The scene happens inside the cabin of an airliner in daylight: cool even light coming in through the row of oval ' +
  'windows, the interior in cool grey and blue shadow — no warm golden light, no sunset outside. '

const PRATICA: Record<'m1' | 'm2' | 'm3' | 'm4' | 'm5' | 'm6' | 'm7' | 'm8' | 'm9' | 'm10' | 'm11' | 'm12', Cena[]> = {
  // PARTE 1 — THE PILLARS OF FLUENCY. Casa, luz de manhã, quente-neutro. É a
  // única parte que não é viagem, e as quatro são a mesma casa em quatro
  // lugares diferentes dela: o chão da sala, a mesa, a bancada, o canto da mesa.
  m1: [
    pratica(
      1,
      1,
      'A woman sitting on the floor of her living room with her back against the sofa, seen from behind, an open ' +
        'notebook resting on her knees and a pen in her hand, the morning light from the window falling across the page. ',
    ),
    pratica(
      1,
      2,
      'A pair of plain over-ear headphones lying on a closed notebook on a pale wooden table, a pen and a half-drunk ' +
        'mug of coffee beside them and the chair pushed back from the table; nobody is sitting there. ',
    ),
    pratica(
      1,
      3,
      'A woman standing at her kitchen counter with her back to the camera, her phone propped upright against a glass ' +
        'jar in front of her as if it were the other person, her chin lifted as she says a sentence out loud. ',
    ),
    pratica(
      1,
      4,
      'A woman’s hands over the corner of a table in the morning light, holding a small stack of handwritten index ' +
        'cards and turning the top one over. ',
      { restricao: RESTRICAO_DA_PRATICA_COM_MAOS },
    ),
  ],

  // PARTE 2 (a) — FIRST STEPS no aeroporto. Luz fria de terminal. Doze aulas na
  // parte inteira, então estas quatro já entram alternando: sentada, telefone na
  // mão, silhueta contra o vidro, assento vazio.
  m2: [
    pratica(
      2,
      1,
      'A woman sitting alone in a row of terminal seats with her back to the camera, an open notebook flat on her knee ' +
        'and a pen in her hand, the wide cool hall stretching away in front of her. ',
    ),
    pratica(
      2,
      2,
      'A phone held low in one hand at the traveller’s side, its screen showing a plain note, the tape barrier of a ' +
        'queue and the passengers standing in it falling softly out of focus behind it. ',
      { restricao: restricaoDaPraticaComNota('the two words MY ANSWERS') },
    ),
    pratica(
      2,
      3,
      'A woman standing still at the tall glass wall of the terminal, seen from behind and almost as a silhouette ' +
        'against the flat bright overcast sky outside, her cabin bag on the floor at her feet. ',
    ),
    pratica(
      2,
      4,
      'An empty seat in a terminal waiting row with an open notebook and a pen left lying on it and a small cabin case ' +
        'parked beside it; nobody is sitting there. ',
    ),
  ],

  // PARTE 2 (b) — o voo. Duas no terminal e duas a bordo; a cabine tem clima
  // próprio pelo mesmo motivo do hotel (a PARTE 2 descreve o saguão).
  m3: [
    pratica(
      3,
      1,
      'A woman sitting on her own cabin case at the gate with her back to the camera, plain headphones over her ears ' +
        'and her head tipped slightly down, the empty rows of gate seating around her. ',
    ),
    pratica(
      3,
      2,
      'The open tray table of an airliner seat with a small folded sheet of handwritten notes lying on it and a pair of ' +
        'hands resting quietly on the table on either side of the sheet, the cabin soft and out of focus beyond. ',
      { clima: CLIMA_DA_CABINE, restricao: RESTRICAO_DA_PRATICA_COM_MAOS },
    ),
    pratica(
      3,
      3,
      'A woman leaning on the rail of the terminal mezzanine with her back to the camera, both forearms on the rail, ' +
        'looking down over the check-in hall below her. ',
    ),
    pratica(
      3,
      4,
      'A woman standing still in the middle of the terminal walkway with her back to the camera and her bag on her ' +
        'shoulder, while the other passengers stream past her softly out of focus on both sides. ',
    ),
  ],

  // PARTE 2 (c) — o hotel. Três no quarto e uma no lobby: a PARTE 2 é
  // "aeroporto/hotel", e mandar o bloco do terminal numa cena de quarto é pedir
  // um saguão com cama dentro (ver `CLIMA_DO_HOTEL`).
  m4: [
    pratica(
      4,
      1,
      'An open notebook and a pen lying on the white bedcover of a made hotel bed, the daylight from the window falling ' +
        'across the page; nobody is in the room. ',
      { clima: CLIMA_DO_QUARTO },
    ),
    pratica(
      4,
      2,
      'A woman sitting on the edge of the hotel bed with her back to the camera, her phone propped upright against the ' +
        'lamp on the bedside table in front of her as if it were the other person, her head lifted as she speaks. ',
      { clima: CLIMA_DO_QUARTO },
    ),
    pratica(
      4,
      3,
      'A woman standing at the desk of her hotel room with her back to the camera and both hands flat on the desk, ' +
        'reading the sheet of notes lying in front of her before going downstairs. ',
      { clima: CLIMA_DO_QUARTO },
    ),
    pratica(
      4,
      4,
      'A woman sitting alone in an armchair in a quiet corner of the hotel lobby, seen from behind over the back of the ' +
        'chair, a small notebook open in her lap and the empty lobby in front of her. ',
      { clima: CLIMA_DO_HOTEL },
    ),
  ],

  // PARTE 3 (a) — TIME TO TOUR. Rua e cidade, fim de tarde dourado: a ÚNICA
  // parte em que o dourado é certo. As doze da parte alternam degrau, ponto de
  // parada, mãos, cadeira vazia — e nenhuma delas é balcão.
  m5: [
    pratica(
      5,
      1,
      'A woman sitting on a low stone step at the edge of a square with her back to the camera, an open notebook on her ' +
        'knees, the warm low sun laying a long shadow beside her. ',
    ),
    pratica(
      5,
      2,
      'A woman standing alone at a tram stop with her back to the camera and her hands in her pockets, looking down the ' +
        'empty track while the warm low sun runs along the street behind her. ',
    ),
    pratica(
      5,
      3,
      'A woman’s hands holding a small notebook open against the stone parapet of a viewpoint, the warm low sun across ' +
        'the page and the city falling away softly out of focus below. ',
      { restricao: RESTRICAO_DA_PRATICA_COM_MAOS },
    ),
    pratica(
      5,
      4,
      'An empty café chair pulled out from a pavement table at the edge of a sunlit square, a light jacket over its back ' +
        'and a canvas bag on the seat; nobody is there. ',
    ),
  ],

  // PARTE 3 (b) — a comida. Mesma rua dourada, outros três assuntos: a mesa da
  // esplanada com ela, a mesma mesa sem ninguém, a parede da rua lateral.
  m6: [
    pratica(
      6,
      1,
      'A woman sitting alone at a pavement café table seen from behind and over her shoulder, an open notebook and a ' +
        'glass of water on the marble top in front of her, the golden street beyond falling out of focus. ',
    ),
    pratica(
      6,
      2,
      'A small espresso cup and a closed notebook with a pen laid across it on a marble café table in the last sun of ' +
        'the afternoon; the chair is empty and nobody is at the table. ',
    ),
    pratica(
      6,
      3,
      'A woman leaning back against a sunlit wall in a quiet side street, seen from behind and slightly to the side, ' +
        'plain headphones over her ears and her hands in her pockets. ',
    ),
    pratica(
      6,
      4,
      'A phone held in one hand over a café table in the warm low sun, its screen showing a plain note, the table and ' +
        'the golden street dissolving softly out of focus behind it. ',
      { restricao: restricaoDaPraticaComNota('the two words MY ORDER') },
    ),
  ],

  // PARTE 3 (c) — as compras. As quatro que faltavam para fechar a parte sem
  // repetir postura: encostada no poste, a própria sombra, o alto da escada, o
  // banco da rua.
  m7: [
    pratica(
      7,
      1,
      'A woman leaning against a lamppost at the corner of a shopping street with her back to the camera, her head bent ' +
        'over the small notebook open in her hands, the warm low sun along the shopfronts. ',
    ),
    pratica(
      7,
      2,
      'The long shadow of a woman standing still, cast across the warm stone pavement by the low afternoon sun, her own ' +
        'back and shoulders at the top of the frame and the quiet street out of focus around her. ',
    ),
    pratica(
      7,
      3,
      'A woman standing still at the top of a flight of street steps with her back to the camera and one hand on the ' +
        'handrail, taking a moment before going down into the sunlit shopping street below. ',
    ),
    pratica(
      7,
      4,
      'A woman sitting on a wooden bench in a sunlit shopping street with her back to the camera, two paper bags on the ' +
        'bench beside her and her hands resting in her lap. ',
    ),
  ],

  // PARTE 4 (a) — FRIENDS & NETWORKING. Cafés e praças, luz DIFUSA: o que separa
  // esta parte da 3 é o céu encoberto, não o lugar. Sol baixo dourado aqui é
  // defeito.
  m8: [
    pratica(
      8,
      1,
      'A woman sitting alone at the end of a long shared café table with her back to the camera, an open notebook in ' +
        'front of her, the other people at the table soft and out of focus beyond. ',
    ),
    pratica(
      8,
      2,
      'Two empty chairs facing each other across a small round café table under a white overcast sky, a cup and a closed ' +
        'notebook on the table between them; nobody has sat down yet. ',
    ),
    pratica(
      8,
      3,
      'A woman sitting alone on a park bench with her back to the camera and her elbows on her knees, watching the ' +
        'square in front of her under the even light of an overcast day. ',
    ),
    pratica(
      8,
      4,
      'A phone held in both hands over a café table under soft grey daylight, its screen showing a plain note, the ' +
        'square and the passers-by dissolving out of focus behind it. ',
      { restricao: restricaoDaPraticaComNota('the two words SMALL TALK') },
    ),
  ],

  // PARTE 4 (b) — a técnica de conversa. Duas se passam DENTRO DE CASA (é onde
  // se ensaia voz e ritmo) e por isso levam a casa com a luz da parte 4 —
  // difusa, encoberta, sombra aberta (ver `CLIMA_DA_CASA_DIFUSA`).
  m9: [
    pratica(
      9,
      1,
      'A woman standing at the window of her flat with her back to the camera under soft grey daylight, a small card of ' +
        'handwritten phrases held up in one hand as she says the line out loud. ',
      { clima: CLIMA_DA_CASA_DIFUSA },
    ),
    pratica(
      9,
      2,
      'A pair of plain headphones and an open notebook lying beside a mug on a table by the window, the chair pushed ' +
        'back and nobody in the room, under the flat light of an overcast morning. ',
      { clima: CLIMA_DA_CASA_DIFUSA },
    ),
    pratica(
      9,
      3,
      'A woman sitting on the low wall of a terrace with her back to the camera, plain headphones over her ears and her ' +
        'hands loose in her lap, the pale overcast sky above the rooftops in front of her. ',
    ),
    // ⚠️ Esta era a MÃO em volta da caneca, e o modelo reprovou as quatro
    // candidatas por `anatomia` (dedo a mais, polegar fundido) — o artefato
    // clássico de mão fechada em volta de um objeto cilíndrico. Trocada por uma
    // cena sem mão em close, que é a saída barata: insistir custaria mais quatro
    // gerações pelo mesmo defeito.
    pratica(
      9,
      4,
      'A woman standing under the arcade at the edge of a square with her back to the camera and one shoulder against a ' +
        'stone column, watching the people cross the square under the flat white light of an overcast sky. ',
    ),
  ],

  // PARTE 5 (a) — EMERGENCIES. Interiores públicos comuns, luz clara neutra, SEM
  // DRAMA. É a parte que a aluna abre com medo, e a divisória não pode assustar
  // antes de a professora falar: `NADA_CLINICO` entra nas quatro.
  m10: [
    pratica(
      10,
      1,
      'A woman sitting in a chair in a tidy, empty clinic waiting room with her back to the camera, an open notebook ' +
        'flat on her lap, the plain quiet room around her. ',
      { restricao: RESTRICAO_DA_PRATICA + NADA_CLINICO },
    ),
    pratica(
      10,
      2,
      'A phone held in one hand in the aisle of a small pharmacy, its screen showing a plain note, the plain shelves and ' +
        'the even overhead light dissolving softly out of focus behind it. ',
      { restricao: restricaoDaPraticaComNota('the word SYMPTOMS') + NADA_CLINICO },
    ),
    pratica(
      10,
      3,
      'A pen and a folded sheet of handwritten notes left on the plain seat of an empty waiting-room chair under even ' +
        'overhead light; nobody is sitting there. ',
      { restricao: RESTRICAO_DA_PRATICA + NADA_CLINICO },
    ),
    pratica(
      10,
      4,
      'A woman standing quietly in the middle of a small tidy pharmacy with her back to the camera, waiting for her turn ' +
        'with her hands on the strap of her bag, the plain shelves around her and nobody being served. ',
      { restricao: RESTRICAO_DA_PRATICA + NADA_CLINICO },
    ),
  ],

  // PARTE 5 (b) — os imprevistos. Mesma luz neutra, e a rede do M11: ninguém no
  // quadro pode ser lido como "o suspeito" (`SEM_AMEACA`).
  m11: [
    pratica(
      11,
      1,
      'A woman sitting on a bench in a bright station hall with her back to the camera, plain headphones over her ears ' +
        'and her suitcase parked upright beside her, the tidy hall stretching away in front of her. ',
      { restricao: RESTRICAO_DA_PRATICA + SEM_AMEACA },
    ),
    pratica(
      11,
      2,
      'A woman standing still in the middle of a bright station concourse with her back to the camera and her bag on her ' +
        'shoulder, while the other travellers cross the hall softly out of focus around her. ',
      { restricao: RESTRICAO_DA_PRATICA + SEM_AMEACA },
    ),
    pratica(
      11,
      3,
      'A woman’s hands holding a small notebook open on the plain table of a station waiting area, the pen resting in ' +
        'the fold and the neutral daylight even across the page. ',
      { restricao: RESTRICAO_DA_PRATICA_COM_MAOS + SEM_AMEACA },
    ),
    pratica(
      11,
      4,
      'A woman sitting on the edge of a seat in a quiet service hall with her back to the camera, her elbows on her ' +
        'knees and her phone lowered in one hand, waiting. ',
      { restricao: RESTRICAO_DA_PRATICA + SEM_AMEACA },
    ),
  ],

  // PARTE 6 — READY TO GO. O fecho: mais luz que todas as outras, ar limpo,
  // horizonte aberto — e ainda assim sem o dourado, que é da parte 3.
  m12: [
    pratica(
      12,
      1,
      'A woman sitting by the wide window of a bright departure lounge with her back to the camera, an open notebook on ' +
        'her knee, the clean sky and the open apron beyond the glass. ',
    ),
    pratica(
      12,
      2,
      'A small notebook, a pen and a pair of sunglasses lying together on the bright pale slats of a bench in an open ' +
        'sunlit walkway; nobody is sitting there. ',
    ),
    pratica(
      12,
      3,
      'A woman standing at a high railing with her back to the camera and both hands on the rail, looking out at the ' +
        'bright open horizon in front of her. ',
    ),
    pratica(
      12,
      4,
      'A woman sitting on her own suitcase in a wide, bright, almost empty concourse with her back to the camera, her ' +
        'phone lowered in one hand and the clean daylight all around her. ',
    ),
  ],
}

/**
 * As cenas por módulo. O tipo do slide, a aula e o enquadramento NÃO estão aqui
 * de propósito: saem do JSON da aula (ver `enderecosDoModulo`), que é quem sabe
 * onde a foto entra. Endereço que o conteúdo não usa é erro, não foto órfã.
 */
const CENAS: Record<string, Cena[]> = {
  // M0 — GET READY. As cinco aulas de abertura: quem é a professora, o mapa do
  // curso, o método, o cronograma e a primeira missão. PARTE 1, e a única parte
  // que NÃO é viagem — a aluna ainda está na cozinha dela, e é isso que as sete
  // fotos mostram. Sete endereços para 30 slides: o M0 REUSA cada foto em três
  // ou quatro lugares (ver a precedência em `enderecosDoModulo`), então cada uma
  // tem de servir a mais de uma aula e nenhuma pode ser literal demais.
  m0: [
    // ---- capas
    {
      // Capa da A1 ("Seu Passaporte para a Fluência") e da A3 (o método). É a
      // primeira imagem do curso inteiro: a mesa onde ele vai acontecer, ainda
      // vazia, na hora do dia em que a aluna vai estudar.
      endereco: 'm0/study-desk-morning.jpg',
      cena:
        'An ordinary study corner at home early in the morning: a small wooden table pushed against a window, an open ' +
        'notebook and a pen on it, a mug of coffee beside them and a closed laptop pushed to one side; the chair is ' +
        'drawn back and nobody is sitting there yet. ',
      composicao: composicaoDeMesa('the table top'),
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + OBJETOS_SEM_MARCA + ' No close-up of hands.',
    },
    {
      // Capa da A4 ("Como Estudar Sem Tempo") e da missão ("Mapa da Rotina").
      // As duas aulas são sobre TEMPO, e o relógio ao lado do caderno é a aula
      // inteira num objeto — a semana desenhada à mão e a hora marcada.
      endereco: 'm0/notebook-and-watch.jpg',
      cena:
        'An open notebook lying on a plain table with a week grid drawn across the page by hand — seven columns ruled ' +
        'in pen, most of the boxes still empty — a pen resting in the fold, and a plain wristwatch lying face up on ' +
        'the table beside it. ',
      composicao: composicaoDeMesa('the table top'),
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + OBJETOS_SEM_MARCA + ' No close-up of hands.',
    },
    {
      // Capa da A2 ("A Jornada Personal Teacher") — o mapa das seis partes. A
      // mala aberta e ainda VAZIA é a viagem que não começou: é a promessa do
      // curso, não a chegada dele.
      endereco: 'm0/open-suitcase.jpg',
      cena:
        'An empty suitcase lying open on a made bed at home in the morning, its lining plain and its straps undone, ' +
        'with two folded shirts and a small notebook set inside one half of it and the rest still bare; the window of ' +
        'the room is out of focus behind. ',
      composicao: composicaoDeMesa('the bedspread'),
      restricao: PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA + ' No close-up of hands.',
    },

    // ---- warm ups, dicas e divisórias (moldura quase quadrada)
    {
      // Warm up da A1 ("por que você está aqui?"), dica da A1 ("comece do jeito
      // que você está") e dica da A4. A página em branco é a resposta que ainda
      // não foi escrita — e é o que as três usam.
      endereco: 'm0/open-notebook.jpg',
      cena:
        'A notebook lying open on a plain wooden table at both blank pages, a pen resting across the fold, ' +
        'photographed close from just above; the morning light from the window falls across the paper. ',
      restricao: PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA + ' No close-up of hands.',
    },
    {
      // Divisória "De onde eu venho" (A1), "EMERGENCIES" (A2) e "todo módulo
      // termina com um ensaio" (A3); warm up "onde você quer chegar?" (A2). O
      // passaporte guardado na gaveta é a viagem que existe e ainda não saiu.
      endereco: 'm0/passport-in-drawer.jpg',
      cena:
        'A wooden drawer pulled half open, photographed from just above: a plain dark blue passport lies inside it on ' +
        'top of a folded scarf, next to a bunch of keys and a small tin; the drawer front and the room beyond fall ' +
        'softly out of focus. ',
      restricao: PLACAS_AO_FUNDO_BASE + DOCUMENTOS_GENERICOS + OBJETOS_SEM_MARCA + ' No close-up of hands.',
    },
    {
      // Divisórias "Como nasceu a Personal Teacher" (A1), "FRIENDS &
      // NETWORKING" (A2), "primeiro você entende" (A3), "pouco e sempre" (A4) e
      // a dica da missão. Precisa ser a foto mais NEUTRA das sete: o lugar do
      // estudo, sem nenhum objeto que diga de que aula ela é.
      endereco: 'm0/desk-by-the-window.jpg',
      cena:
        'A small plain desk pushed against a window in an ordinary room, seen from the doorway a few steps away: a ' +
        'chair tucked under it, a lamp switched off at one corner, a notebook and a pen squared up on the surface, ' +
        'and the daylight coming flat through the glass. Nobody in the room. ',
      restricao: PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA + ' No close-up of hands.',
    },
    {
      // Divisórias "por que você pode confiar" (A1), "TIME TO TOUR" (A2),
      // "chunk" (A3), "encaixe no que já existe" (A4) e warm up "quanto tempo
      // você tem?". A caneca ao lado das anotações é o gancho de que a A4 fala:
      // o estudo pendurado no café da manhã.
      endereco: 'm0/coffee-and-notes.jpg',
      cena:
        'A mug of black coffee standing beside an open notebook covered in a few lines of handwriting, on a plain ' +
        'kitchen table, photographed close from just above and slightly to one side; a pen lies across the page and ' +
        'the morning light comes in from the left. ',
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + OBJETOS_SEM_MARCA + ' No close-up of hands.',
    },
  ],

  // M1 — OS PILARES. O módulo de TÉCNICA da PARTE 1: por que a aluna trava, qual
  // é o estilo de aprendizagem dela, WPR e shadowing, e o inglês encaixado na
  // rotina. Instrução do dono, literal: "a aluna ensaiando, caderno, fone,
  // gravando áudio. INTERIOR, NÃO VIAGEM." Nenhuma das 14 sai de casa — o clima
  // da PARTE 1 já é a casa, e nenhum alvo precisa de `clima` próprio.
  m1: [
    // ---- capas
    {
      // A1 abre o módulo ("Eliminando a Mentalidade que te Trava"). A aluna está
      // na cena porque a aula é sobre ELA — de costas, na mesa dela, de manhã.
      endereco: 'm1/morning-study-desk.jpg',
      cena:
        'A woman sitting at her own table by the window early in the morning, seen from behind and over her shoulder, ' +
        'an open notebook and a mug in front of her and her head bent towards the page; the window light falls across ' +
        'the table and the rest of the room stays soft. ',
    },
    {
      // A2 é o teste de estilo de aprendizagem. A capa é o teste em si — papel e
      // caneta sobre a mesa, as caixinhas ainda por marcar.
      endereco: 'm1/quiz-and-pen.jpg',
      cena:
        'A printed questionnaire sheet lying on a plain table, a column of small empty tick boxes running down its ' +
        'left edge and a pen resting diagonally across it, photographed from just above at a slight angle so the ' +
        'paper catches the morning light. ',
      composicao: composicaoDeMesa('the table top'),
      restricao:
        'The printed sheet is seen at a shallow angle and slightly off the plane of focus, so its printing reads as ' +
        'soft grey ruled lines and empty square boxes rather than as words: no readable text, no invented ' +
        'letterforms, no heading, no logo and no numbers anywhere on it. ' +
        PLACAS_AO_FUNDO_BASE +
        OBJETOS_SEM_MARCA +
        ' No close-up of hands.',
    },
    {
      // A3 é WPR e shadowing: as duas técnicas de áudio. A capa são as duas
      // ferramentas delas, e nada mais.
      endereco: 'm1/headphones-and-phone.jpg',
      cena:
        'A pair of plain over-ear headphones lying on a wooden table with a phone face down beside them and the cable ' +
        'coiled loosely between the two, photographed from just above in the flat morning light of the window. ',
      composicao: composicaoDeMesa('the table top'),
      restricao: PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA + ' No close-up of hands.',
    },
    {
      // A4 é "pensar em inglês" — encaixar o idioma na rotina que já existe. A
      // capa é o gancho de que a aula fala: o café da manhã.
      endereco: 'm1/kitchen-morning-coffee.jpg',
      cena:
        'A woman standing at her kitchen counter in the morning pouring coffee into a mug, seen from behind in half ' +
        'silhouette against the window; her phone is propped upright against a jar on the counter beside her, and a ' +
        'folded tea towel hangs from the oven rail. ',
      restricao: PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA + ' No close-up of hands.',
    },
    {
      // Missão do módulo: o estilo, a semana e as duas técnicas rodando juntos.
      // A capa é a mesa com as três coisas em cima — objeto, não pessoa.
      endereco: 'm1/mission-desk-plan.jpg',
      cena:
        'A plain table seen from just above: an open notebook with a week grid drawn on it by hand, a pen lying in ' +
        'the fold, a pair of plain headphones coiled beside the notebook and a phone lying face down next to them. ',
      composicao: composicaoDeMesa('the table top'),
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + OBJETOS_SEM_MARCA + ' No close-up of hands.',
    },

    // ---- warm ups (moldura quase quadrada, ao lado do texto)
    {
      // A1: "o que acontece quando você trava?". O caderno com poucas linhas e o
      // resto em branco é a frase que não saiu.
      endereco: 'm1/open-notebook.jpg',
      cena:
        'An open notebook on a plain table, three or four short handwritten lines at the top of the left page and the ' +
        'rest of both pages blank, a pen lying across the right page, photographed close from just above. ',
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + ' No close-up of hands.',
    },
    {
      // A2: "quantos começos você já teve?". Cadernos velhos empilhados são a
      // pergunta inteira sem uma palavra.
      endereco: 'm1/old-notebooks.jpg',
      cena:
        'A small stack of four worn old notebooks on a plain table, their covers faded and their corners bent, the ' +
        'top one lying half open at a page of handwriting, photographed close from just above and slightly to one ' +
        'side. ',
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + ' No close-up of hands.',
    },
    {
      // A3: "como você memorizou até hoje?". Os cartões espalhados são a técnica
      // antiga — a que a aula vai substituir.
      endereco: 'm1/flashcards-on-table.jpg',
      cena:
        'A dozen small white index cards spread loosely across a wooden table, some face up and some face down, a few ' +
        'overlapping, with a pen lying among them, photographed close from just above. ',
      restricao:
        'Each card carries at most one short handwritten word, and the cards are slightly off the plane of focus so ' +
        'that the writing on them reads as a soft grey mark rather than as a word: no readable text and no invented ' +
        'letterforms anywhere in the frame. ' +
        PLACAS_AO_FUNDO_BASE +
        ' No close-up of hands.',
    },
    {
      // A4: nomear em inglês o que está em volta. O warm up é literalmente uma
      // lista de objetos — então a foto é a lista.
      endereco: 'm1/desk-objects.jpg',
      cena:
        'The everyday objects of a desk laid out on a wooden table and photographed straight down from above: a mug, ' +
        'a bunch of keys, a pair of glasses, a small potted plant, a pen and a closed notebook, spaced apart with ' +
        'plain wood showing between them. ',
      restricao: PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA + ' No close-up of hands.',
    },

    // ---- travel tips (moldura quase quadrada, ao lado do cartão âmbar)
    {
      // A1: o caderno de chunks — uma frase por linha, sem a regra do lado. O
      // que a foto tem de mostrar é a FORMA da página (linhas curtas, uma por
      // linha), não o que está escrito nelas.
      endereco: 'm1/chunk-notebook.jpg',
      cena:
        'An open notebook on a plain table filled with short handwritten lines, one to a line, each only a few words ' +
        'long and none of them reaching the middle of the page, a pen resting beside it, photographed close from just ' +
        'above at a slight angle. ',
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + ' No close-up of hands.',
    },
    {
      // A2: escreva o resultado e os dias no alto da primeira página. A agenda
      // aberta com a semana desenhada é a dica inteira.
      endereco: 'm1/study-planner.jpg',
      cena:
        'A paper planner lying open on a table across two pages, a week ruled out on it as a grid of empty boxes with ' +
        'a few of them marked, a pen resting in the fold, photographed close from just above. ',
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + ' No close-up of hands.',
    },
    {
      // A3: grave a sua voz uma vez por semana. A tela é o gravador — e ele é
      // desenho (onda e botão redondo), não texto, o que o torna o alvo mais
      // seguro do lote.
      endereco: 'm1/voice-note-recording.jpg',
      cena:
        'A phone lying face up on a plain table propped against a closed book, its screen showing a simple voice ' +
        'recorder — a grey sound waveform across the middle and a single round red record button below it — with a ' +
        'pair of plain headphones and an open notebook on the table beside it. ',
      restricao:
        'The phone screen shows only the grey waveform and the round red button on a plain white background: there ' +
        'is no lettering of any kind on the screen, no app name, no icon, no clock, no battery bar and no numbers. ' +
        PLACAS_AO_FUNDO_BASE +
        OBJETOS_SEM_MARCA +
        ' No close-up of hands.',
    },
    {
      // A4: o celular em inglês, o gancho mais barato de todos. É foto de
      // CONTEÚDO — a palavra ENGLISH na tela É a dica, e é curta o bastante para
      // o modelo acertar (mesma régua do painel do M3).
      endereco: 'm1/phone-in-english.jpg',
      cena:
        'A phone lying face up on a plain wooden table beside a mug, its screen showing a simple settings list: a ' +
        'column of plain rows on a white background, photographed close from just above. ',
      restricao:
        'The phone screen is sharp and legible. Exactly one row of the list carries the single word ENGLISH in plain ' +
        'lettering, spelled correctly letter by letter, with a small tick beside it; every other row is so slightly ' +
        'off the plane of focus that it reads as a soft grey bar rather than as words. Nothing else is on the ' +
        'screen — no app name, no icon, no logo, no clock, no battery bar and no lines of small print. If the word ' +
        'cannot be rendered correctly letter by letter, that row is left plain and empty instead. ' +
        PLACAS_AO_FUNDO_BASE +
        OBJETOS_SEM_MARCA +
        ' No close-up of hands.',
    },
    {
      // Missão: guarde tudo no MESMO lugar — a primeira página do caderno. A
      // foto é essa página: o alto escrito, o resto ainda por viver.
      endereco: 'm1/notebook-first-page.jpg',
      cena:
        'A notebook opened at its very first page on a plain table, a heading and four short handwritten lines at the ' +
        'top of the page and the whole rest of it blank, the previous cover folded back underneath and a pen lying ' +
        'alongside, photographed close from just above. ',
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + ' No close-up of hands.',
    },
    ...PRATICA.m1,
  ],

  // M2 — IMIGRAÇÃO E CHEGADA. A aula é a fila, a entrevista e o que vem depois
  // dela. Quatro aulas + missão, 14 endereços.
  m2: [
    // ---- capas (sangradas, título na metade de baixo)
    {
      // A1 abre o módulo: é a foto que apresenta o lugar do medo. Fila ao fundo,
      // sala grande, a aluna dentro dela e não olhando de fora.
      endereco: 'm2/immigration-hall.jpg',
      cena:
        'A wide immigration hall seen from inside the waiting line: a long row of border control booths far ahead, ' +
        'travellers with cabin bags spread across the hall, an expanse of polished floor between the camera and the booths. ',
    },
    {
      // A2 é "aprender a PERGUNTAR". A cena tem de mostrar a aluna tomando a
      // iniciativa — de costas, inclinada para o balcão, no gesto de quem fala.
      endereco: 'm2/questions-desk.jpg',
      cena:
        'The traveller stands at an airport information desk, seen from behind and slightly to one side, leaning in to ask ' +
        'something; the member of staff on the other side of the counter is partly out of focus, listening and pointing off ' +
        'towards one end of the terminal. ',
    },
    {
      // A3 é "e se eu não entender?" — o oficial FALANDO, visto por cima do
      // ombro dela. É a cena de maior risco do lote: autoridade de fronteira.
      endereco: 'm2/officer-speaking.jpg',
      cena:
        'Over the traveller’s shoulder at a border control booth: the officer behind the counter is speaking, ' +
        'mid-sentence, one hand resting on the counter; the traveller is a dark out-of-focus shoulder and hair filling the ' +
        'near edge of the frame. ',
      restricao: PLACAS_AO_FUNDO + GUICHE_GENERICO,
      // histórico ruim esperado (uniforme, brasão, crachá): margem para descartar
    },
    {
      // A4 é o ensaio geral na velocidade real: a fila inteira, o corpo da
      // espera. Ninguém de frente — a aluna é uma das costas.
      endereco: 'm2/immigration-queue.jpg',
      cena:
        'The immigration queue itself: a line of travellers seen from behind between retractable belt barriers, cabin bags ' +
        'at their feet, one of them shifting her weight, the booths a soft distant row at the end of the hall. ',
    },
    {
      // Missão: montar o SEU questionário, com os seus dados. Objeto, não pessoa
      // — e o caderno em branco porque quem escreve nele é a aluna.
      endereco: 'm2/passport-and-notebook.jpg',
      cena:
        'A passport with a boarding pass tucked inside it and a small open notebook with a pen resting on it, lying on a ' +
        'plain table in an airport departure lounge, the notebook page blank and unwritten; behind them, far out of focus, ' +
        'the empty rows of seats and the glass wall of the gate. ',
      // A composição própria existe porque aqui o assunto é OBJETO sobre mesa, e
      // não uma pessoa; o canto da câmera é o mesmo da capa. Na versão de 25/07
      // esta frase dizia "upper RIGHT of the frame" — era a mesma colisão da
      // COMPOSICAO_CAPA, escrita de novo à mão neste alvo.
      composicao:
        'Composition: a wide horizontal photograph. The passport and the notebook sit together in the upper left of the ' +
        'frame, shot from just above the table. ' +
        CANTO_DA_CAMERA +
        'Towards the lower half the table surface runs empty and softly out of focus, ' +
        'with no important detail down there; it does not have to be empty, only quiet. ' +
        semEmenda('the table'),
      restricao: PLACAS_AO_FUNDO_BASE + DOCUMENTOS_GENERICOS,
    },

    // ---- warm ups (moldura quase quadrada, ao lado do texto)
    {
      // A1: "o que você acha que o oficial pergunta?" — o passaporte já sobre o
      // balcão é a pergunta antes de qualquer palavra.
      endereco: 'm2/passport-desk.jpg',
      cena:
        'A passport lying on the counter of a border control booth, seen from the traveller’s side of the counter, ' +
        'close and sharp; behind it the officer’s dark shape and the glass of the booth dissolve out of focus. ',
      restricao: PLACAS_AO_FUNDO_BASE + DOCUMENTOS_GENERICOS + GUICHE_GENERICO,
    },
    {
      // A2: o que ela consegue PERGUNTAR — o saguão de chegada, onde as
      // perguntas acontecem.
      endereco: 'm2/arrival-hall.jpg',
      cena:
        'The arrivals hall just past customs: a traveller seen from behind pulling a suitcase towards the sliding doors, ' +
        'luggage trolleys and a few strangers around her, the hall opening up ahead of her. ',
    },
    {
      // A3: o medo que a aula desarma. TENSÃO, não desespero — sem drama de
      // novela, e por isso o rosto quase não aparece: o corpo conta.
      endereco: 'm2/traveller-worried.jpg',
      cena:
        'A woman waiting in the immigration line, seen from behind and slightly to the side, her shoulders drawn tight and ' +
        'her head turned towards the booths ahead; only a sliver of her profile shows, quiet and alert. An ordinary nervous ' +
        'moment before her turn — not distress, no tears, nothing theatrical. ',
    },
    {
      // A4: o que ela diz sem pensar. O carimbo é o fim da entrevista — o som do
      // módulo inteiro terminando bem.
      endereco: 'm2/passport-stamp.jpg',
      cena:
        'Close on the counter of a border booth at the moment the rubber stamp comes down on the open passport page: the ' +
        'hand and the stamp sharp and close, the booth soft behind them. ',
      restricao: PLACAS_AO_FUNDO_BASE + MAOS_CORRETAS + DOCUMENTOS_GENERICOS + GUICHE_GENERICO,
    },

    // ---- travel tips (moldura quase quadrada, ao lado do cartão âmbar)
    {
      // A1: os três documentos NA MÃO, não na bolsa. A dica é literalmente sobre
      // a mão — é a cena que justifica a regra de mãos.
      endereco: 'm2/documents-hand.jpg',
      cena:
        'A traveller’s hand at waist height holding a passport with a boarding pass tucked inside it, held ready while ' +
        'she waits in line; the terminal dissolves behind her hand. ',
      restricao: PLACAS_AO_FUNDO_BASE + MAOS_CORRETAS + DOCUMENTOS_GENERICOS,
    },
    {
      // A2: dá para perguntar em qualquer balcão — a esteira é o primeiro lugar
      // depois da imigração onde ela vai precisar disso.
      endereco: 'm2/baggage-claim.jpg',
      cena:
        'A baggage claim carousel turning with a few suitcases on it, travellers standing around it seen from behind, one ' +
        'of them reaching down for a bag. ',
    },
    {
      // A3: o papel fala quando a palavra não vem. Papel impresso é o maior
      // risco de texto inventado do lote — daí o ângulo raso.
      endereco: 'm2/printed-documents.jpg',
      cena:
        'A few folded printed sheets tucked inside a passport on a plain table, photographed low and close at a shallow ' +
        'angle so the paper catches the light edge-on, a phone lying face down beside them. ',
      restricao: PLACAS_AO_FUNDO_BASE + DOCUMENTOS_GENERICOS,
    },
    {
      // A4: o ensaio de pé, em casa. É o gesto que o curso inteiro pede — e por
      // isso é a ÚNICA cena do módulo que não se passa no aeroporto.
      endereco: 'm2/standing-rehearsal.jpg',
      clima:
        'The scene happens at home, in an ordinary lived-in kitchen, in the cool grey light of early evening coming through ' +
        'the window — a real weekday kitchen, not a showroom, and no warm golden light. ',
      cena:
        'A woman standing alone in her kitchen rehearsing out loud, her passport held in one hand, seen from behind in half ' +
        'silhouette against the window; a mug and a folded tea towel on the counter beside her. ',
      restricao: PLACAS_AO_FUNDO_BASE + MAOS_CORRETAS + DOCUMENTOS_GENERICOS,
    },
    {
      // Missão: reler o questionário no avião, antes de pousar. Ponto de vista
      // da aluna na forma mais pura — o que ela vê da própria poltrona.
      endereco: 'm2/plane-window.jpg',
      clima:
        'The scene happens inside an aircraft cabin in daylight: cool even light coming in through the window, the interior ' +
        'in shadow, greys and blues — no warm golden sunset outside. ',
      cena:
        'Seen from a passenger seat by the window: the oval aircraft window with the wing and a bright layer of cloud ' +
        'outside, and a folded sheet of paper resting on the open tray table in the shadow of the cabin. ',
      restricao: PLACAS_AO_FUNDO_BASE + DOCUMENTOS_GENERICOS,
    },
    ...PRATICA.m2,
  ],

  // M3 — O VOO. Da fila do check-in ao balcão do imprevisto. Quatro aulas +
  // missão, 14 endereços. Mesma PARTE do M2 (FIRST STEPS): luz fria de terminal
  // e de cabine, vidro, superfície dura. Luz dourada aqui é do M5.
  //
  // A diferença de direção em relação ao M2: QUATRO destes endereços são o
  // conteúdo da aula, não a ilustração dela. O painel de partidas, o painel com
  // atraso, a tela conferida com o cartão na mão e o embarque no celular
  // carregam as palavras que a aula ensina a ler — e por isso usam o
  // `painelQueEnsina` em vez de esconder o texto no desfoque.
  m3: [
    // ---- capas (sangradas, título na metade de baixo, câmera no canto)
    {
      // A1 abre o módulo: o aeroporto TEM uma ordem. A capa é o lugar dessa
      // ordem — o saguão de partidas visto de quem acabou de entrar.
      endereco: 'm3/airport-departures.jpg',
      cena:
        'The departures hall of a big international airport seen from the entrance: a long row of check-in counters ' +
        'stretching away on the left under a high ceiling, travellers pushing luggage trolleys across the hall, a wide ' +
        'expanse of polished floor between the camera and the counters. ',
    },
    {
      // A2 é o avião: pedir as coisas a bordo. A capa é o corredor da cabine
      // visto de uma poltrona — o lugar onde ela vai passar as próximas horas.
      endereco: 'm3/airplane-cabin.jpg',
      clima:
        'The scene happens inside the cabin of an airliner in daylight: cool even light coming in through the row of ' +
        'oval windows, the interior in cool grey and blue shadow — no warm golden light, no sunset outside. ',
      cena:
        'The inside of an airliner cabin seen from a passenger seat towards the front: the aisle running away between two ' +
        'rows of seats, overhead lockers closed above, a few passengers seated with their heads turned away, the daylight ' +
        'from the windows falling across the seat backs. ',
    },
    {
      // A3 é o imprevisto, e a capa É o imprevisto: o painel virando DELAYED.
      // Foto de CONTEÚDO — o painel tem de ser lido, não sugerido.
      endereco: 'm3/delayed-board.jpg',
      cena:
        'A large airport departures information board hanging from the ceiling of the terminal, photographed from below and ' +
        'slightly to the side; a few travellers stand looking up at it, small and dark against the glass wall behind them. ',
      restricao: painelQueEnsina(
        'The board shows the single word DEPARTURES as its header and exactly four short rows underneath, each row a city, ' +
          'a time and a status, in this order: LONDON 16:05 DELAYED, PARIS 16:20 DELAYED, ROME 16:40 CANCELLED, ' +
          'DUBLIN 17:00 ON TIME.',
      ),
      // texto legível é onde este modelo mais erra: margem larga para descartar
    },
    {
      // A4 é a simulação da viagem inteira, e ela termina embarcando. A capa é a
      // fila do portão vista de DENTRO dela — a aluna é uma das costas.
      endereco: 'm3/boarding-queue.jpg',
      cena:
        'The boarding queue at a departure gate seen from inside the line: travellers standing one behind the other with ' +
        'cabin bags, seen from behind, the open door of the jet bridge glowing at the end of the line, the gate desk to one ' +
        'side and rows of empty waiting seats beyond. ',
    },
    {
      // Missão: o roteiro de voo com os dados dela. Objeto sobre mesa, como a
      // `m2/passport-and-notebook` — inclusive na composição própria, porque o
      // assunto não é uma pessoa e o canto da câmera continua valendo.
      endereco: 'm3/passport-boarding-pass.jpg',
      cena:
        'A passport with a printed paper boarding pass tucked into it and a phone lying face down beside them, on a plain ' +
        'table in an airport departure lounge; behind them, far out of focus, the empty rows of seats and the glass wall of ' +
        'the gate with an aircraft tail beyond. ',
      composicao:
        'Composition: a wide horizontal photograph. The passport and the boarding pass sit together in the upper left of the ' +
        'frame, shot from just above the table. ' +
        CANTO_DA_CAMERA +
        'Towards the lower half the table surface runs empty and softly out of focus, ' +
        'with no important detail down there; it does not have to be empty, only quiet. ' +
        semEmenda('the table'),
      restricao: PLACAS_AO_FUNDO_BASE + DOCUMENTOS_GENERICOS,
    },

    // ---- warm ups (moldura quase quadrada, ao lado do texto)
    {
      // A1: "ponha o aeroporto em ordem". O painel é onde essa ordem está
      // escrita — e é a primeira coisa que a aula ensina a ler. Foto de
      // CONTEÚDO: o painel preenche o quadro e cada palavra tem de estar certa.
      endereco: 'm3/departure-board.jpg',
      cena:
        'A departures information board on the wall of an airport terminal, photographed straight on and close enough to ' +
        'fill most of the frame, the terminal falling softly out of focus at the edges. ',
      restricao: painelQueEnsina(
        'The board shows the single word DEPARTURES as its header and exactly four short rows underneath, each row a city, ' +
          'a time, a gate and a status, in this order: LISBON 14:20 GATE 22 ON TIME, LONDON 14:45 GATE 15 BOARDING, ' +
          'MADRID 15:10 GATE 9 DELAYED, PARIS 15:30 GATE 4 ON TIME.',
      ),
    },
    {
      // A2: "você quer água no avião — o que você diz?". A cena é a oferta
      // acontecendo: o carrinho no corredor, visto da poltrona dela.
      endereco: 'm3/cabin-crew-service.jpg',
      clima:
        'The scene happens inside the cabin of an airliner in daylight: cool even light from the oval windows, the interior ' +
        'in cool grey and blue shadow — no warm golden light. ',
      // ⚠️ REESCRITA em 26/07, depois de 4 candidatas reprovadas em sequência —
      // as quatro por `anatomia`, as quatro na MESMA mão: seis dedos, dedos
      // fundidos, três dedos, dedos derretidos. A cena pedia "a tripulante se
      // inclina para ENTREGAR o copo", quer dizer: duas mãos no meio do quadro
      // trocando um objeto pequeno, que é o pior caso conhecido deste modelo (é
      // a mesma razão de o `PROIBIDO` do repo terminar em "no close-up of
      // hands"). O gesto saiu e a aula ficou: o copo já está na mesinha, o
      // carrinho está no corredor, e a tripulante está virada para o trabalho
      // dela. O serviço de bordo continua legível sem nenhuma mão em foco.
      cena:
        'The in-flight service trolley standing in the aisle of an airliner beside the seats, a member of the cabin crew ' +
        'turned away towards the top of the trolley at work over it; in the foreground, on the open tray table of the ' +
        'row in front, a plastic cup of water and a paper napkin have just been set down. Seen from the seat behind ' +
        'and to the side. ',
      restricao:
        'Nobody’s hands are near the camera and no hand is holding, passing or reaching for anything: every hand in ' +
        'the frame is either out of shot, turned away or well behind the plane of focus. ' +
        PLACAS_AO_FUNDO +
        TRIPULACAO_GENERICA,
    },
    {
      // A3: "o que já aconteceu com você?". O balcão de atendimento é onde essas
      // histórias terminam — e a palavra HELP DESK é vocabulário da aula.
      endereco: 'm3/help-desk.jpg',
      cena:
        'An airport service counter with a sign above it, a traveller standing at it seen from behind with her cabin bag ' +
        'beside her, and a member of staff on the other side of the counter, partly out of focus, listening to her. ',
      restricao:
        'The sign above the counter is sharp and legible and carries the two words HELP DESK in plain capitals, correctly ' +
        'spelled, and nothing else — no company name, no logo, no emblem, no small print. If those two words cannot be ' +
        'rendered correctly letter by letter, the sign is a plain blue panel with a white question-mark symbol and no ' +
        'lettering at all. The member of staff wears plain dark clothing with no badge, no name tag and no insignia. ' +
        PLACAS_AO_FUNDO,
    },
    {
      // A4: "o que você já consegue dizer agora?" — e a primeira frase da lista é
      // "I have one bag". O balcão de check-in é onde ela é dita.
      endereco: 'm3/check-in-counter.jpg',
      cena:
        'An airline check-in counter seen from the traveller’s side: a suitcase standing on the baggage belt beside the ' +
        'counter, the traveller in front of it seen from behind, and the agent behind the counter partly out of focus, ' +
        'looking down at the desk. ',
      restricao:
        'Nothing in the frame carries a company name or a logo: the counter, the belt and the screens are plain grey ' +
        'working furniture. ' + PLACAS_AO_FUNDO,
    },

    // ---- travel tips (moldura quase quadrada, ao lado do cartão âmbar)
    {
      // A1: o gesto de conferir a tela. Foto de CONTEÚDO — a tela é a matéria da
      // dica. O cartão de embarque fica na mão baixa e FORA de foco: ele é papel
      // impresso, que é onde o modelo inventa garrancho, e quem precisa ser lido
      // aqui é a tela.
      endereco: 'm3/screen-check.jpg',
      cena:
        'A traveller seen from behind standing in front of a flight information screen mounted on a pillar in the terminal, ' +
        'looking up at it, her printed boarding pass held down at her side in her lowered hand. ',
      restricao:
        painelQueEnsina(
          'The screen shows the single word DEPARTURES as its header and exactly three short rows underneath, each row a ' +
            'city, a time, a gate and a status, in this order: LISBON 14:20 GATE 22 BOARDING, LONDON 14:45 GATE 15 ON TIME, ' +
            'MADRID 15:10 GATE 9 DELAYED.',
        ) +
        ' The boarding pass in her hand is far out of focus and seen edge-on, so its printing reads as soft grey lines with ' +
        'no readable words at all.' +
        MAOS_CORRETAS,
    },
    {
      // A2: "Could I… please" — a dica sai do avião e vale a viagem inteira. A
      // foto é o lugar de onde ela sai: a janelinha, do ponto de vista da
      // poltrona dela. Sem papel na mesinha (isso é a `m2/plane-window`).
      endereco: 'm3/window-seat.jpg',
      clima:
        'The scene happens inside the cabin of an airliner in daylight: cool even light coming in through the window, the ' +
        'interior in cool grey shadow — no warm golden light and no sunset outside. ',
      cena:
        'The window seat of an airliner seen from the seat itself: the oval window with a bright layer of cloud and the tip ' +
        'of the wing outside, the empty seat and armrest in the cool shadow of the cabin, the folded tray table closed. ',
    },
    {
      // A3: fotografe a mala e guarde o número da etiqueta. A etiqueta é papel
      // impresso com código de barras — o que a torna reconhecível é a FORMA (a
      // tira branca em volta da alça), não o que está escrito nela. Por isso ela
      // é nítida no contorno e ilegível na impressão, que é o que uma foto real
      // de perto faz com uma tira de papel enrolada.
      endereco: 'm3/baggage-tag.jpg',
      cena:
        'Close on the handle of a dark suitcase standing at an airport check-in counter, with the printed paper baggage tag ' +
        'looped tightly around the handle and hanging from it, the terminal dissolving softly behind. ',
      restricao:
        'The paper tag is curled around the handle and seen at a shallow angle, so its printing reads as soft grey bars, ' +
        'lines and blocks rather than as words or numbers: no readable text, no invented letterforms, no company name and ' +
        'no logo anywhere in the frame. What identifies the tag is its shape — a narrow white paper strip wrapped through ' +
        'the handle — and not its printing. ' + PLACAS_AO_FUNDO,
    },
    {
      // A4: ensaiar em voz alta na véspera, três minutos no espelho. Única cena
      // do módulo fora do aeroporto — e a mais arriscada, porque espelho é onde
      // o modelo entrega um rosto de frente. A rede está na restrição.
      endereco: 'm3/mirror-rehearsal.jpg',
      clima:
        'The scene happens at home in the evening, in an ordinary lived-in bedroom, in the cool grey light of a bedside lamp ' +
        'and the last daylight at the window — a real weekday bedroom, not a showroom, and no warm golden light. ',
      cena:
        'A woman standing alone in front of a wall mirror in her bedroom, rehearsing out loud, seen from behind over her ' +
        'shoulder; her reflection in the mirror is soft and off the plane of focus, her mouth mid-word. An overnight bag ' +
        'sits half packed on the bed behind her. ',
      restricao:
        'Her reflection is out of focus and her face is never sharp; she looks at her own reflection and never at the ' +
        'camera, and there is no eye contact with the lens anywhere in the frame. The mirror shows only the bedroom and ' +
        'her — no second person and no duplicated body. ' + PLACAS_AO_FUNDO,
    },
    {
      // Missão: o PDF no celular, na mesma pasta do cartão de embarque. Foto de
      // CONTEÚDO — o cartão de embarque no celular é uma das telas que a aula
      // ensina a ler, e é curto o bastante para o modelo acertar.
      endereco: 'm3/phone-boarding.jpg',
      cena:
        'A phone held up in one hand at a departure gate, its screen showing a mobile boarding pass, the gate desk and the ' +
        'rows of waiting seats dissolving softly out of focus behind it. ',
      restricao:
        'The phone screen is sharp and perfectly legible and shows a plain mobile boarding pass on a white background: ' +
        'the two words BOARDING PASS across the top, the single words GATE and SEAT as labels lower down with a short ' +
        'number beside each, and a plain square block of black-and-white code pattern at the bottom. Every one of those ' +
        'words is spelled correctly letter by letter, in plain capitals; there is nothing else on the screen — no airline ' +
        'name, no logo, no emblem, no flag, no country name, no lines of small print. If a word cannot be rendered ' +
        'correctly letter by letter, that part of the screen is left plain and empty. ' +
        PLACAS_AO_FUNDO_BASE +
        MAOS_CORRETAS,
    },
    ...PRATICA.m3,
  ],

  // M4 — CHECK-IN & OUT. Chegar no hotel, pedir o que falta no quarto,
  // reclamar do que não funciona e sair sem susto na conta. Quatro aulas +
  // missão, 14 endereços — os 14 aqui.
  //
  // ⚠️ CONTRADIÇÃO RESOLVIDA (26/07). Este comentário dizia que
  // `m4/passport-and-notebook.jpg` não tinha entrada no catálogo porque seria
  // "REAPROVEITADA do disco" — a mesma fotografia da capa da missão do M2. A
  // premissa não se realizou: o conteúdo aponta para o endereço `m4/…`, e no
  // disco existe só `m2/passport-and-notebook.jpg`, então o M4A5 caía na
  // variante sem-foto. As duas saídas eram copiar o arquivo do M2 para o
  // endereço do M4 ou escrever a cena. Escolhida a segunda, por duas razões: a
  // missão do M4 é a FICHA DE CHECK-IN virando nota, não o questionário de
  // imigração do M2; e a foto do M2 está no clima de terminal, não no do hotel.
  //
  // A diferença de direção em relação ao M2 e ao M3: o interior é HOTEL, não
  // terminal. Mesma PARTE (FIRST STEPS), então a luz continua contida — só que
  // de lâmpada de recepção e de janela de quarto, não de painel de teto sobre
  // vidro. Cada alvo declara o próprio `clima` porque o bloco da PARTE descreve
  // o aeroporto (ver `CLIMA_DO_HOTEL`).
  m4: [
    // ---- capas (sangradas, título na metade de baixo, câmera no canto)
    {
      // A1 abre o módulo: o balcão é o lugar do medo desta aula. A aluna chega —
      // ela é a mala e o ombro na beira do quadro, não um rosto.
      endereco: 'm4/hotel-reception.jpg',
      clima: CLIMA_DO_HOTEL,
      cena:
        'The reception of a small city hotel seen by a guest who has just walked in: the long reception counter runs away ' +
        'towards the upper left of the frame with a receptionist behind it turning towards the arrival, and the wall ' +
        'behind the counter, on the left, carries a single small sign reading RECEPTION. The guest herself is only a ' +
        'dark out-of-focus shoulder and the handle of her suitcase at the near left edge. ',
      restricao: PLACAS_DE_HOTEL,
      // placa legível é onde este modelo mais erra: margem larga para descartar
    },
    {
      // A2 é pedir o que falta no quarto. A capa é o quarto vazio — o palco das
      // quatro aulas seguintes, ainda sem ninguém dentro.
      endereco: 'm4/hotel-room.jpg',
      clima: CLIMA_DO_QUARTO,
      cena:
        'A plain hotel guest room just after check-in, seen from the doorway: the made bed with white linen on the left, ' +
        'a bedside table with a lamp beside it, a suitcase standing unopened on the luggage rack, and the window at the ' +
        'far end letting in flat daylight. Nobody in the room. ',
    },
    {
      // A3 é o problema, e a capa É o problema: o cartão que não abre a porta.
      // A escolha entre os seis problemas da aula é a porta porque ela acontece
      // no CORREDOR — dá cena, e as outras cinco dão objeto.
      endereco: 'm4/hotel-problem.jpg',
      clima:
        'The scene happens in the quiet carpeted corridor of an ordinary city hotel: a row of identical doors, low warm ' +
        'wall lights and flat even light along the ceiling, muted creams, greys and wood. Never a golden late-afternoon ' +
        'sun, never an orange sunset glow, never long dramatic shadows. ',
      cena:
        'A guest standing at her room door in the hotel corridor, seen from behind and slightly to one side, holding her ' +
        'key card flat against the small reader beside the handle; her suitcase waits on the carpet behind her heels and ' +
        'the door stays shut. The corridor runs away out of focus. ',
      restricao: PLACAS_DE_HOTEL,
    },
    {
      // A4 é a última manhã. A capa é a bagagem no saguão — a imagem exata de
      // "já saí do quarto e ainda não fui embora".
      endereco: 'm4/check-out-luggage.jpg',
      clima: CLIMA_DO_HOTEL,
      cena:
        'The last morning in a hotel: two suitcases and a shoulder bag standing together on the lobby floor towards the ' +
        'upper left of the frame, their owner a dark out-of-focus back at the reception counter beyond them, morning ' +
        'daylight coming in through the entrance. ',
    },
    {
      // Capa da MISSÃO: montar a SUA ficha de check-in — os dados que a recepção
      // sempre pede, escritos antes de chegar lá. Objeto sobre mesa, como a capa
      // da missão do M2 e do M3, e pelo mesmo motivo (o assunto não é uma
      // pessoa); o que a separa da do M2 é o balcão de pedra do hotel no lugar
      // da mesa do saguão de embarque.
      endereco: 'm4/passport-and-notebook.jpg',
      clima: CLIMA_DO_HOTEL,
      cena:
        'A plain dark passport with a folded printed sheet tucked inside it and a small open notebook with a pen ' +
        'resting on it, lying together on the pale stone top of a hotel reception counter, the notebook page blank ' +
        'and unwritten; behind them the reception and the lobby fall far out of focus. ',
      composicao: composicaoDeMesa('the stone counter top'),
      restricao: PLACAS_AO_FUNDO_BASE + DOCUMENTOS_GENERICOS + ' No close-up of hands.',
    },

    // ---- warm ups (moldura quase quadrada, ao lado do texto)
    {
      // A1: "o que você acha que a recepção pergunta?" — o balcão de perto, com
      // as três coisas que ele sempre tem. Objeto, não pessoa: o warm up é
      // pequeno na tela e precisa ler de relance.
      endereco: 'm4/front-desk.jpg',
      clima: CLIMA_DO_HOTEL,
      cena:
        'The top of a hotel reception counter photographed close from the guest’s side: a small brass call bell, a card ' +
        'payment terminal on its stand and the back of a computer monitor, the receptionist’s dark shape and the wall ' +
        'behind dissolving out of focus. ',
      restricao: PLACAS_DE_HOTEL,
    },
    {
      // A2: o que sempre acaba faltando no quarto. Toalha e travesseiro juntos
      // porque são os dois primeiros itens do vocabulário da aula.
      endereco: 'm4/towels-and-pillows.jpg',
      clima: CLIMA_DO_QUARTO,
      cena:
        'A stack of folded white towels and two plump white pillows resting together at the foot of a made hotel bed, ' +
        'photographed close from just above, the daylight from the window raking softly across the cotton. ',
    },
    {
      // A3: qual desses já aconteceu com você. O chuveiro frio é o problema que
      // abre a aula — e o que se fotografa é a ÁGUA, não um símbolo.
      endereco: 'm4/cold-shower.jpg',
      clima:
        'The scene happens in a plain tiled hotel bathroom in flat daylight: white tiles, chrome fittings, muted greys ' +
        'and creams. Never a golden late-afternoon sun, never an orange glow, never long dramatic shadows. ',
      cena:
        'A hotel shower head running with a thin cold stream of water into an empty tiled cubicle, photographed close ' +
        'from the side; the water is clear and sharp against the tiles and there is no steam anywhere in the frame, no ' +
        'mist on the chrome and no fog on the glass. Nobody in the bathroom. ',
    },
    {
      // A4: a última manhã começa aqui embaixo. O saguão vazio, com a luz da
      // entrada — o oposto da capa da A1, que é a chegada.
      endereco: 'm4/hotel-lobby.jpg',
      clima: CLIMA_DO_HOTEL,
      cena:
        'The lobby of a small city hotel in the morning: two armchairs and a low table on a rug, a suitcase parked beside ' +
        'one of them, the reception counter soft in the background and daylight falling in from the glass entrance. ',
      restricao: PLACAS_DE_HOTEL,
    },

    // ---- travel tips (moldura quase quadrada, ao lado do cartão âmbar)
    {
      // A1: guarde dinheiro vivo para a taxa turística, e saiba que a caução é
      // bloqueio. Nota é o passaporte do M2 outra vez — daí `DINHEIRO_GENERICO`.
      endereco: 'm4/cash-and-card.jpg',
      clima: CLIMA_DO_HOTEL,
      cena:
        'A few folded banknotes, a small pile of coins and one plain bank card lying together on the pale stone top of a ' +
        'hotel reception counter, photographed close from just above at a shallow angle, the counter running away out of ' +
        'focus behind them. ',
      restricao: PLACAS_AO_FUNDO_BASE + DINHEIRO_GENERICO + ' No close-up of hands.',
    },
    {
      // A2: comece toda ligação com "I'm in room ___". O telefone do quarto é o
      // objeto literal da dica.
      endereco: 'm4/room-phone.jpg',
      clima: CLIMA_DO_QUARTO,
      cena:
        'The telephone on the bedside table of a hotel room, photographed close from just above and to one side, its ' +
        'handset resting in the cradle beside a lamp; the made bed and the window fall softly out of focus behind it. ',
    },
    {
      // A3: reclame na recepção, e de preferência pessoalmente. A cena é a
      // conversa — vista por cima do ombro dela, como manda o ponto de vista.
      endereco: 'm4/reception-talk.jpg',
      clima: CLIMA_DO_HOTEL,
      cena:
        'Over the guest’s shoulder at a hotel reception counter: the receptionist behind the counter is listening, ' +
        'mid-conversation, one hand resting on the counter top; the guest is a dark out-of-focus shoulder and hair ' +
        'filling the near edge of the frame. ',
      restricao: PLACAS_DE_HOTEL,
    },
    {
      // A4: leia a conta linha por linha antes de pagar. Foto de CONTEÚDO — a
      // conta precisa parecer uma conta, com valores, e é a `CONTA_DE_HOTEL` que
      // resolve a miudeza pelo foco em vez de apagar o papel.
      endereco: 'm4/hotel-bill.jpg',
      clima: CLIMA_DO_HOTEL,
      cena:
        'A printed hotel bill lying on the pale stone top of a reception counter with a pen resting across it, ' +
        'photographed close from just above at a slight angle so the paper catches the light. ',
      restricao: PLACAS_AO_FUNDO_BASE + CONTA_DE_HOTEL + ' No close-up of hands.',
    },
    {
      // Missão: a ficha de check-in vira uma NOTA no celular, não um papel. A
      // tela é curta o bastante para o modelo acertar — e é o que a dica manda
      // a aluna reconhecer.
      endereco: 'm4/phone-note.jpg',
      clima: CLIMA_DO_HOTEL,
      cena:
        'A phone lying face up on the pale stone top of a hotel reception counter next to a passport, its screen showing ' +
        'a plain notes app, photographed close from just above; the counter and the reception behind it dissolve out of ' +
        'focus. ',
      restricao:
        'The phone screen is sharp and shows a plain white note with a heading and four short lines under it. The ' +
        'heading is the two words CHECK IN in plain capitals; the four lines below are handwritten-looking plain text so ' +
        'slightly off the plane of focus that they read as soft grey lines rather than as words. Nothing else is on the ' +
        'screen — no app name, no icon, no logo, no time, no battery bar, no lines of small print. If a word cannot be ' +
        'rendered correctly letter by letter, the heading is left plain and empty instead. ' +
        'The passport is a plain generic travel document: a dark navy booklet with no country name, no coat of arms, no ' +
        'emblem and no readable lettering on the cover. ' +
        PLACAS_AO_FUNDO_BASE +
        ' No close-up of hands.',
    },
    ...PRATICA.m4,
  ],

  // M5 — TRANSPORTE. As catorze fotos do módulo vieram da rodada antiga e
  // estão aprovadas; o que este catálogo tem do M5 são só as quatro
  // divisórias de prática (ver `PRATICA`).
  m5: [...PRATICA.m5],

  // M6 — COMIDA. Onze das catorze fotos do módulo já estão na biblioteca e
  // aprovadas (rodada antiga); faltam três. PARTE 3 — rua de fim de tarde
  // dourado, que é a família das onze que já existem: qualquer coisa cinza aqui
  // destoa do módulo inteiro.
  m6: [
    {
      // Capa da missão ("Menu Sem Mistérios"): estudar um cardápio de verdade. O
      // cardápio ao lado do caderno é a missão inteira num objeto.
      endereco: 'm6/menu-and-notebook.jpg',
      cena:
        'A folded restaurant menu card lying open on the marble top of a pavement café table in the late afternoon, a ' +
        'small notebook and a pen beside it and a glass of water at the edge of the table; the street beyond the ' +
        'table falls softly out of focus in the warm low sun. ',
      composicao: composicaoDeMesa('the table top'),
      restricao:
        'The menu is seen at a shallow angle and slightly off the plane of focus, so its printing reads as soft grey ' +
        'lines and blocks rather than as words: no readable text, no invented letterforms, no restaurant name, no ' +
        'logo, no crest and no prices anywhere on it. ' +
        PLACAS_AO_FUNDO_BASE +
        CADERNO_GENERICO +
        ' No close-up of hands.',
    },
    {
      // Dica da missão: pesquisar restaurante e ler uma avaliação em voz alta. A
      // foto é o lugar de onde a escolha sai — a esplanada vista de fora.
      endereco: 'm6/street-cafe-evening.jpg',
      cena:
        'A small pavement café at the end of the afternoon seen from across the narrow street: three round tables ' +
        'with wicker chairs out on the pavement under an awning, two of them taken by people seen from behind, warm ' +
        'low sunlight running along the façade above them. ',
    },
    {
      // Dica da A4: ensaiar a refeição inteira em casa, você de hóspede e o
      // celular de garçom. Única das três que NÃO é rua — clima próprio, e a
      // regra é a mesma do `m3/mirror-rehearsal`: ensaio em casa, à noite.
      endereco: 'm6/table-rehearsal.jpg',
      clima:
        'The scene happens at home in the evening, at an ordinary dining table in a real lived-in flat, in the warm ' +
        'even light of the ceiling lamp above the table — a real weekday kitchen-diner, not a showroom, and no ' +
        'golden sunset light through the window. ',
      cena:
        'A woman sitting alone at her own dining table at home rehearsing out loud, seen from behind and over her ' +
        'shoulder; her phone stands propped upright against a glass on the table in front of her as if it were the ' +
        'other person, a sheet of notes lies beside her plate and her head is lifted as she speaks. ',
      restricao: PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA + ' No close-up of hands.',
    },
    ...PRATICA.m6,
  ],

  // M7 — COMPRAS. Dez fotos já estão na biblioteca; faltam quatro, e três delas
  // são INTERIORES de loja — o clima da PARTE 3 descreve a rua, então elas
  // trazem o seu (o mesmo mecanismo do hotel no M4).
  m7: [
    {
      // Capa da missão ("Guia de Compras Inteligentes"): a vitrine é o lugar
      // onde a compra começa, antes de qualquer palavra.
      endereco: 'm7/store-window.jpg',
      cena:
        'The window of a small city shop seen from the pavement in the late afternoon: goods arranged on a shelf ' +
        'behind the glass, the warm low sun raking along the street, and the traveller present only as a dark ' +
        'shapeless reflection standing in the glass, her face lost in the reflection and never sharp. ',
      restricao:
        'Nothing in the frame carries a shop name, a company name, a logo, an emblem or a price: the window, the ' +
        'awning and the goods behind the glass are plain and unbranded. ' + PLACAS_AO_FUNDO,
    },
    {
      // Dica da missão: o guia de compras vive numa NOTA do celular, não no
      // papel — e cada palavra nova de prateleira entra nela.
      endereco: 'm7/shopping-list-phone.jpg',
      cena:
        'A phone held up in one hand on a shopping street in the late afternoon, its screen showing a plain notes ' +
        'app, the shopfronts and the passers-by dissolving softly out of focus behind it in the warm low sun. ',
      restricao:
        telaDeNota('the two words SHOPPING LIST') + MAOS_CORRETAS + ' ' + PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA,
    },
    {
      // Dica da A1: no caixa automático, a sacola às vezes se paga e a fruta às
      // vezes se pesa. Interior de supermercado — clima próprio.
      endereco: 'm7/self-checkout.jpg',
      clima:
        'The scene happens inside an ordinary city supermarket: even overhead light, pale floor tiles, plain metal ' +
        'and white shelving, muted greys and greens. The light is flat and neutral — never a golden late-afternoon ' +
        'sun, never an orange glow, never long dramatic shadows. ',
      cena:
        'A self-service checkout terminal in a supermarket seen from the customer’s side of it, its screen and its ' +
        'small weighing platform in the foreground, a shopping basket with fruit and vegetables resting on the shelf ' +
        'beside it and the row of other terminals running away out of focus. ',
      restricao:
        'The terminal screen faces slightly away from the camera and is off the plane of focus, so what is on it ' +
        'reads as soft coloured blocks rather than as words or numbers. Nothing in the frame carries a supermarket ' +
        'name, a company name, a logo or a price. ' + PLACAS_AO_FUNDO,
    },
    {
      // Dica da A4: nem toda loja aceita cartão por aproximação, então tenha
      // trocado. Até a varredura de 25/07 esta dica ilustrava-se com a
      // `m6/paying-card.jpg` — a ÚNICA foto de outro módulo em todo o curso, e
      // ainda por cima uma cena de RESTAURANTE numa dica sobre pagar em LOJA.
      // Esta é o balcão da loja, que é onde a dica acontece.
      //
      // ⚠️ Não confundir com a `vocab/card-machine.jpg` do card do M6, que é a
      // maquininha pousada na mesa de madeira do restaurante: aqui a maquininha
      // está no balcão e está sendo USADA.
      endereco: 'm7/card-machine.jpg',
      clima:
        'The scene happens inside an ordinary small city shop: even overhead light, plain wooden counter, painted ' +
        'walls and plain shelving, muted warm neutrals. The light is flat and neutral — never a golden ' +
        'late-afternoon sun, never an orange glow, never long dramatic shadows. ',
      cena:
        'The pay counter of a small shop seen from the customer’s side: a small handheld card terminal held out ' +
        'across the counter towards the camera by the shopkeeper, whose hand and forearm are all that is in the ' +
        'frame of her, the till and the shelves behind her softly out of focus, a paper bag of shopping resting on ' +
        'the counter beside it. ',
      restricao:
        'The terminal’s screen is off the plane of focus and reads as a soft pale rectangle rather than as words or ' +
        'numbers, and the terminal carries no brand name and no logo. Nothing in the frame carries a shop name, a ' +
        'company name, a logo or a price. ' +
        PLACAS_AO_FUNDO_BASE +
        OBJETOS_SEM_MARCA +
        MAOS_CORRETAS,
    },
    {
      // Dica da A3: guarde o recibo e não corte a etiqueta. Os dois objetos
      // juntos são a dica literal — e os dois são papel impresso, que é onde
      // este modelo inventa garrancho.
      endereco: 'm7/receipt-and-tags.jpg',
      clima:
        'The scene happens indoors at a plain wooden table in an ordinary hotel room or flat, in flat neutral ' +
        'daylight from a window — never a golden late-afternoon sun, never an orange glow, never long dramatic ' +
        'shadows. ',
      cena:
        'A long paper till receipt lying curled on a plain table next to a folded garment with its small cardboard ' +
        'swing tag still attached to it by a thread, photographed close from just above at a slight angle so the ' +
        'paper catches the light. ',
      restricao:
        'The receipt and the swing tag are seen at a shallow angle and slightly off the plane of focus, so their ' +
        'printing reads as soft grey lines, bars and blocks rather than as words, numbers or a barcode: no readable ' +
        'text, no invented letterforms, no shop name, no company name, no logo and no price anywhere in the frame. ' +
        'What identifies the receipt is its shape — a long narrow curled strip of thin paper — and not its printing. ' +
        PLACAS_AO_FUNDO,
    },
    ...PRATICA.m7,
  ],

  // M8 — SMALL TALK E CONEXÕES. PARTE 4: cafés e praças, luz DIFUSA. A diferença
  // para a PARTE 3 (M5–M7) é a luz, não o lugar — as duas se passam na cidade, e
  // é o céu encoberto que separa uma da outra. Sol baixo dourado aqui é o mesmo
  // defeito que luz de terminal na parte 3.
  //
  // A direção do módulo tem uma exigência a mais que as outras: aqui há SEMPRE
  // duas pessoas, e nenhuma delas pode encarar a lente. Conversa fotografada de
  // frente vira banco de imagens; vista de trás do ombro, vira a memória da
  // aluna. É o `PONTO_DE_VISTA` levado a sério num módulo inteiro de gente.
  m8: [
    // ---- capas
    {
      // A1 abre o módulo: puxar conversa com um estranho. A fila do museu é o
      // lugar canônico dessa primeira frase ("is this the line for the museum?").
      endereco: 'm8/museum-line.jpg',
      cena:
        'The queue outside the entrance of a city museum seen from inside the line itself: visitors standing one ' +
        'behind the other along the pavement, seen from behind, two of them half turned towards each other in the ' +
        'middle of the line, the stone doorway of the building beyond them. ',
    },
    {
      // A2 é dizer quem você é e sair com o contato de alguém. A mesa comprida
      // do albergue é onde isso acontece de verdade.
      endereco: 'm8/hostel-shared-table.jpg',
      cena:
        'A long shared wooden table in the common room of a hostel, seen from one end over the shoulder of someone ' +
        'sitting at it: four or five travellers spread along the table with mugs, an open laptop and a folded map ' +
        'between them, their heads turned towards each other and away from the camera. ',
      restricao: PLACAS_AO_FUNDO + OBJETOS_SEM_MARCA,
    },
    {
      // A3 é assunto que não acaba: hobbies e gostos. O banco do parque é a
      // conversa sem balcão e sem pressa.
      endereco: 'm8/park-bench-conversation.jpg',
      cena:
        'Two people sitting side by side on a bench in a city park under trees, seen from behind and a few steps ' +
        'away, one of them turned slightly towards the other in the middle of saying something; the path and the ' +
        'grass run away in front of them. ',
    },
    {
      // A4 são os diálogos reais, do oi ao contato. O balcão do café no fim do
      // dia é o cenário da aula — e o clima próprio existe porque a PARTE 4 é
      // luz de dia e este é o interior no fim da tarde. A rede é a de sempre:
      // luz de lâmpada EVEN, nunca bar escuro e nunca dourado.
      endereco: 'm8/bar-counter-evening.jpg',
      clima:
        'The scene happens inside an ordinary neighbourhood café at the end of the day, under soft even indoor ' +
        'light: warm lamps and daylight still coming in from the street, in creams, wood, brass and warm greys, ' +
        'everything clearly visible. Never a dark moody bar, never a golden late-afternoon sun through the window, ' +
        'never an orange sunset glow, never long dramatic shadows. ',
      cena:
        'The counter of a small café at the end of the day seen from behind the shoulder of a customer sitting at ' +
        'it: two people on stools a little further along the counter with glasses in front of them, half turned ' +
        'towards each other, and the person behind the counter working, all of them out of focus. ',
      restricao: PLACAS_AO_FUNDO + OBJETOS_SEM_MARCA,
    },
    {
      // Missão: montar o SEU perfil falado. Objeto sobre mesa — as coisas que a
      // aluna junta para escrever quem ela é.
      endereco: 'm8/notebook-flatlay-postcards.jpg',
      cena:
        'A café table photographed from just above: an open notebook with a few short handwritten lines on it, a pen ' +
        'lying in the fold, four plain picture postcards fanned out beside it and a cup of coffee at the edge of the ' +
        'table. ',
      composicao: composicaoDeMesa('the table top'),
      restricao:
        'The postcards show plain ordinary landscape photographs and carry no lettering, no place name, no stamp and ' +
        'no writing of any kind. ' +
        PLACAS_AO_FUNDO_BASE +
        CADERNO_GENERICO +
        ' No close-up of hands.',
    },

    // ---- warm ups (moldura quase quadrada, ao lado do texto)
    {
      // A1: as seis frases de abertura, e uma delas é "beautiful view, isn't
      // it?". O mirante é literalmente onde ela é dita.
      endereco: 'm8/lookout-viewpoint.jpg',
      cena:
        'A stone parapet at a viewpoint over a city, a traveller leaning on it seen from behind with the roofs and ' +
        'the river spread out beyond her, and another visitor standing a few steps along the same parapet, also ' +
        'turned away towards the view. ',
    },
    {
      // A2: apresentar-se em quatro linhas. O terraço é o lugar onde duas
      // pessoas ficam de pé conversando sem que ninguém tenha marcado nada.
      endereco: 'm8/rooftop-terrace.jpg',
      cena:
        'A small rooftop terrace with a few chairs and a low table, two people standing together at the parapet seen ' +
        'from behind with drinks in their hands, the roofs and the bright white sky of the city opening up in front ' +
        'of them. ',
    },
    {
      // A3: a lista dos gostos ("I cook", "I read", "I travel"). O mercado de
      // rua é o passeio em que esses assuntos aparecem sozinhos.
      endereco: 'm8/street-market-stroll.jpg',
      cena:
        'A street market on an ordinary weekday: stalls of fruit, flowers and second-hand things along both sides of ' +
        'a narrow street, shoppers seen from behind walking slowly between them, one of them stopped at a stall ' +
        'looking down at the goods. ',
    },
    {
      // A4: as frases de entrada e de saída. A cozinha do albergue às sete da
      // manhã é o contexto do diálogo da aula — duas pessoas e uma cafeteira.
      endereco: 'm8/hostel-kitchen.jpg',
      cena:
        'The shared kitchen of a hostel early in the morning: a plain counter with a coffee machine on it, two people ' +
        'standing near it seen from behind and from the side waiting for their cups, open shelves of mismatched mugs ' +
        'and plates above the counter. ',
      restricao: PLACAS_AO_FUNDO + OBJETOS_SEM_MARCA,
    },

    // ---- diálogo (coluna estreita ao lado das pastilhas de fala)
    {
      // A4, o diálogo curto — a conversa de dez segundos que a dica defende. A
      // mesa de fora com uma pessoa só é exatamente isso: o encontro que quase
      // acontece.
      endereco: 'm8/cafe-outdoor-table.jpg',
      cena:
        'A small round café table out on the pavement with two chairs at it, one of them taken by someone seen from ' +
        'behind with a cup of coffee in front of them and the other empty, the street beyond soft and out of focus. ',
    },

    // ---- travel tips (moldura quase quadrada, ao lado do cartão âmbar)
    {
      // A1: escolha UMA frase de abertura e use a mesma a viagem inteira. As
      // duas xícaras são a conversa que a frase abriu — sem ninguém no quadro.
      endereco: 'm8/cafe-two-cups.jpg',
      cena:
        'Two cups of coffee standing on a small café table with two chairs pulled up to it, photographed close from ' +
        'just above; both cups have been drunk from, nobody is sitting there at this moment and the pavement beyond ' +
        'the table is soft. ',
      restricao: PLACAS_AO_FUNDO + OBJETOS_SEM_MARCA,
    },
    {
      // A2: escreva as suas quatro linhas e leia em voz alta até não precisar
      // delas. O caderno na mesa do café, com a rua atrás.
      endereco: 'm8/notebook-cafe-window.jpg',
      cena:
        'An open notebook with a few short handwritten lines on it and a pen resting beside it, on a small table ' +
        'against the window of a café, the street outside soft and bright behind the glass. ',
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + ' No close-up of hands.',
    },
    {
      // A3: prepare três assuntos antes de viajar. O grupo do passeio a pé é
      // onde eles são usados — e ninguém ali é o assunto da foto sozinho.
      endereco: 'm8/walking-tour-group.jpg',
      cena:
        'A small group of eight visitors standing together in a city square listening to someone at the front of the ' +
        'group, all seen from behind and a good distance away, the paving and the façades of the square around them. ',
    },
    {
      // A4: a conversa de dez segundos não é um fracasso. A praça acesa no fim
      // do dia é o consolo da dica — o lugar continua cheio de gente e amanhã
      // tem outra. Clima próprio pelo mesmo motivo do balcão do café.
      endereco: 'm8/square-evening-lights.jpg',
      clima:
        'The scene happens in a city square at the end of the day, in soft even light: strings of small warm bulbs ' +
        'above the tables and the last flat daylight still in the sky, everything clearly visible and gentle. Never a ' +
        'golden late-afternoon sun, never an orange sunset glow, never a dark night scene, never long dramatic ' +
        'shadows. ',
      cena:
        'A city square at the end of the day seen from its edge: café tables spread across the paving under strings ' +
        'of small hanging lights, people sitting at them in soft dark shapes with their backs to the camera, and the ' +
        'façades of the square standing quietly behind them. ',
    },
    {
      // Missão: o perfil vive numa nota do celular e se lê em voz alta uma vez
      // por dia até a viagem.
      endereco: 'm8/phone-note-profile.jpg',
      cena:
        'A phone lying face up on a café table next to a cup of coffee and a closed notebook, its screen showing a ' +
        'plain notes app, photographed close from just above; the table and the terrace behind it fall out of focus. ',
      restricao: telaDeNota('the single word PROFILE') + ' ' + PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA,
    },
    ...PRATICA.m8,
  ],

  // M9 — DIÁLOGOS IMEDIATOS. PARTE 4 como o M8, e o dono deu a mesma instrução
  // que deu para o M1: "módulo de técnica — a aluna ensaiando, caderno, fone,
  // gravando áudio. Interior, não viagem."
  //
  // Só que os OITO endereços do M9 vêm do conteúdo e não são todos de ensaio:
  // três são conversa (`cafe-conversation`, `two-friends-table`,
  // `square-bench-chat`) e cinco são a técnica. A leitura deste lote: a
  // instrução vale para as de técnica, que ganham o `CLIMA_DA_CASA_DIFUSA` — a
  // casa com a LUZ da PARTE 4, para o módulo não se partir em duas famílias — e
  // as três de conversa ficam no clima da parte, porque é o que o conteúdo pede.
  m9: [
    // ---- capas
    {
      // A1 abre o módulo: nunca mais travar. A capa é a conversa em que travar
      // acontece — vista por cima do ombro dela, como manda o ponto de vista.
      endereco: 'm9/cafe-conversation.jpg',
      cena:
        'Two people talking across a small café table, seen over the shoulder of the nearer one: she is a dark ' +
        'out-of-focus shoulder and hair filling the near edge of the frame, and the other person sits opposite with ' +
        'a cup in front of her, listening, her face soft and off the plane of focus. ',
    },
    {
      // A2 são as quatro estruturas que mantêm a conversa viva. Duas pessoas à
      // mesa, vistas de lado e de longe: a conversa acontecendo, não posando.
      endereco: 'm9/two-friends-table.jpg',
      cena:
        'Two people sitting at a small café table, seen from a few steps away and to the side: both heads turned ' +
        'towards each other and away from the camera, two cups and a phone lying face down on the table between ' +
        'them, the terrace around them soft. ',
    },
    {
      // A4 são os 100 chunks. O banco da praça é a conversa mais barata que
      // existe — e a foto que já é warm up da A2 no mesmo módulo.
      endereco: 'm9/square-bench-chat.jpg',
      cena:
        'Two people sitting on a bench in a city square seen from behind, talking, their heads tilted slightly ' +
        'towards each other; pigeons on the paving in front of them and passers-by crossing the square beyond, all ' +
        'out of focus. ',
    },
    {
      // A3 é pronúncia, ritmo e entonação: a aula em que a aluna se ouve. É a
      // primeira das cinco de TÉCNICA — dentro de casa, luz difusa da parte.
      endereco: 'm9/reading-out-loud.jpg',
      clima: CLIMA_DA_CASA_DIFUSA,
      cena:
        'A woman standing alone at the window of her own room reading out loud from a sheet of paper held up in ' +
        'front of her, seen from behind and slightly to one side, her chin lifted and her mouth in the middle of a ' +
        'word; her phone stands propped on the sill beside her. ',
      restricao:
        'The sheet of paper in her hand is seen edge-on and off the plane of focus, so its printing reads as soft ' +
        'grey lines with no readable words at all. ' + PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA + MAOS_CORRETAS,
    },
    {
      // Missão: marcar os chunks e gravar. Também é a dica da A3 — a capa e a
      // dica são o mesmo endereço, e a régua da CAPA é a que vale (ver a
      // precedência em `enderecosDoModulo`).
      endereco: 'm9/voice-note-recording.jpg',
      clima: CLIMA_DA_CASA_DIFUSA,
      cena:
        'A phone lying face up on a plain table propped against a closed book, its screen showing a simple voice ' +
        'recorder — a grey sound waveform across the middle and a single round red record button below it — with a ' +
        'pair of plain headphones coiled beside it and an open notebook alongside. ',
      composicao: composicaoDeMesa('the table top'),
      restricao:
        'The phone screen shows only the grey waveform and the round red button on a plain white background: there ' +
        'is no lettering of any kind on the screen, no app name, no icon, no clock, no battery bar and no numbers. ' +
        PLACAS_AO_FUNDO_BASE +
        OBJETOS_SEM_MARCA +
        ' No close-up of hands.',
    },

    // ---- warm ups (moldura quase quadrada, ao lado do texto)
    {
      // A1 e A3: o que você faz quando falta a palavra. A pausa é o assunto —
      // uma pessoa pensando, e o silêncio ao redor dela.
      endereco: 'm9/pause-to-think.jpg',
      cena:
        'A woman sitting alone at a café table, seen from behind and slightly to the side, stopped in the middle of ' +
        'a thought with her eyes towards the window and her cup untouched in front of her; the person opposite her ' +
        'is only a soft shape at the far edge of the frame. ',
    },

    // ---- travel tips (moldura quase quadrada, ao lado do cartão âmbar)
    {
      // A2, e o motivo de ela existir: até a varredura de 25/07 o tip do M9A1 e
      // o do M9A2 — aulas VIZINHAS, MESMO slot — carregavam a MESMA
      // `m9/notebook-phrases.jpg`. Era o pior caso de repetição do curso fora do
      // M0. A A1 fica com o caderno; a A2 ganha esta.
      //
      // A dica da A2 é "prepare TRÊS respostas antes de viajar", e o "antes de
      // viajar" é o que separa as duas fotos: a do caderno se passa na mesa do
      // café (já na viagem), esta se passa em CASA, na luz difusa da PARTE 4.
      endereco: 'm9/phrases-on-phone.jpg',
      clima: CLIMA_DA_CASA_DIFUSA,
      cena:
        'A phone propped upright against a stack of books on a table by a window, its screen showing a plain notes ' +
        'app, an open notebook and a mug beside it on the table; photographed straight on from a normal distance at ' +
        'table height so the standing phone sits in the middle of the frame. Nobody in the room. ',
      restricao:
        telaDeNota('the two words ABOUT ME') +
        // ⚠️ A primeira candidata trouxe LOREM IPSUM legível sob o título. O
        // `telaDeNota` manda as linhas caírem fora do plano de foco, e o modelo
        // obedeceu à letra do título e desobedeceu ao resto — e a conferência
        // deixou passar com razão: lorem ipsum são palavras reais e bem
        // escritas, então não é o defeito `marca`. É defeito de conteúdo, e a
        // única forma de fechá-lo é nomeá-lo.
        ' The lines under the heading are never lorem ipsum, never Latin, never placeholder or dummy text and never ' +
        'any readable sentence: they are so far off the plane of focus that they are grey strokes on white and no ' +
        'word among them can be made out at all. ' +
        PLACAS_AO_FUNDO_BASE +
        CADERNO_GENERICO +
        OBJETOS_SEM_MARCA,
    },
    {
      // A1: escolha DOIS fillers. A dica é uma lista curta escrita à mão — e é
      // isso que a foto mostra.
      endereco: 'm9/notebook-phrases.jpg',
      cena:
        'An open notebook on a café table with six short handwritten lines on the page, one under the other, none of ' +
        'them longer than a few words, a pen lying across the fold and a cup at the edge of the table, photographed ' +
        'close from just above. ',
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + ' No close-up of hands.',
    },
    {
      // A4 e a missão: o PDF dos chunks fica NO celular, e se abre na fila, no
      // táxi, no elevador.
      endereco: 'm9/phone-note-chunks.jpg',
      clima: CLIMA_DA_CASA_DIFUSA,
      cena:
        'A phone lying face up on a plain table beside an open notebook and a cup, its screen showing a plain notes ' +
        'app, photographed close from just above. ',
      restricao: telaDeNota('the single word CHUNKS') + ' ' + PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA,
    },
    ...PRATICA.m9,
  ],

  // M10 — SAÚDE E EMERGÊNCIAS. PARTE 5: "clínica/estação, luz clara neutra, SEM
  // DRAMA". Instrução literal do dono para o módulo inteiro: nada de sangue,
  // ferimento, sofrimento ou cena clínica dramática — farmácia, prateleira, sala
  // de espera, recepção, celular. É o módulo que a aluna vai abrir com medo, e a
  // foto não pode assustar antes de a professora falar. Daí o `NADA_CLINICO` em
  // TODOS os catorze alvos, inclusive nos que são só um caderno sobre a mesa:
  // custa uma frase e fecha a porta.
  m10: [
    // ---- capas
    {
      // A1 abre o módulo: vocabulário de farmácia e de sintoma. O balcão é o
      // lugar mais banal e mais útil da parte inteira.
      endereco: 'm10/pharmacy-counter.jpg',
      cena:
        'The counter of a small neighbourhood pharmacy seen from the customer’s side: a pale stone counter top with a ' +
        'card terminal on it, rows of plain white drawers and tidy shelves of boxes behind, and the pharmacist a ' +
        'calm out-of-focus figure in plain light clothing standing behind the counter. ',
      restricao:
        'Every box, bottle and package in the frame is plain and unmarked: no medicine name, no brand, no company ' +
        'name, no logo, no cross, no emblem and no readable lettering anywhere. ' +
        PLACAS_AO_FUNDO +
        NADA_CLINICO,
    },
    {
      // A2 é a ligação de emergência: o número certo e as quatro informações. A
      // capa é a CALMA dessa ligação, que é o que a aula ensina.
      endereco: 'm10/calm-phone-call.jpg',
      cena:
        'A woman standing at the window of a quiet room with a phone held to her ear, seen from behind in half ' +
        'silhouette against the flat daylight, a small slip of paper held steady in her other hand at waist height; ' +
        'she stands still and unhurried and the room behind her is tidy and empty. ',
      restricao: PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA + MAOS_CORRETAS + NADA_CLINICO,
    },
    {
      // A3 é acionar o seguro viagem. A capa são as duas coisas que se procura
      // na hora: o cartão da apólice e o telefone.
      //
      // ⚠️ SEGUNDA VERSÃO (varredura de 25/07, achado S7). A primeira PROMETIA
      // no endereço o que a foto não tinha: saiu um balcão branco quase vazio,
      // com o cartão e o celular pequenininhos no canto inferior esquerdo e dois
      // terços de tampo liso. Na capa, com o véu por cima, não sobra assunto
      // nenhum — foi eleita a pior capa do curso junto com a do M12A3.
      //
      // A culpa é da `composicaoDeMesa`, que manda o objeto para o alto à
      // esquerda e o tampo correr vazio para baixo: numa mesa vista de cima isso
      // deixa o assunto minúsculo. Aqui a mão volta a entrar — é a única forma
      // de o cartão e o celular ficarem GRANDES no quadro sem virar close de
      // produto — e vem com a régua das mãos (`MAOS_CORRETAS`), que é exigível
      // na curadoria. A composição passa a ser a da capa comum: assunto na
      // metade de cima, à esquerda, canto da câmera intacto.
      endereco: 'm10/insurance-card-phone.jpg',
      cena:
        'A woman’s two hands held up in front of her at chest height in the calm light of a service hall, seen over ' +
        'her shoulder from behind and to one side: one hand holds a plain unmarked card up where she can read it, ' +
        'the other holds a phone beside it with the dialling keypad on the screen, and the two objects are LARGE ' +
        'and sharp and close together in the upper left of the frame. Her face is not in the picture. The tidy ' +
        'counter and the empty hall fall softly out of focus below and beyond her. ',
      restricao:
        'The card is a plain unmarked card — no company name, no scheme mark, no logo, no hologram, no embossed ' +
        'number and no lettering of any kind on it. The phone screen shows a plain dialling keypad of grey circles ' +
        'with no app name, no icon, no logo, no clock, no status bar and no readable numbers. ' +
        PLACAS_AO_FUNDO_BASE +
        OBJETOS_SEM_MARCA +
        NADA_CLINICO +
        MAOS_CORRETAS,
    },
    {
      // A4 são os diálogos da clínica. A capa é a sala de espera VAZIA e
      // arrumada — o oposto exato da cena clínica que o dono proibiu.
      endereco: 'm10/waiting-room.jpg',
      cena:
        'The waiting room of a small clinic in the middle of the morning: a row of empty upholstered chairs along a ' +
        'pale wall, a low table with a few magazines squared on it, a potted plant by the window and one person ' +
        'seated far down the row seen from behind, reading. ',
      restricao: PLACAS_AO_FUNDO + NADA_CLINICO,
    },
    {
      // Missão: montar a SUA página de emergência. Objeto sobre mesa — a lista
      // que ainda vai ser preenchida.
      endereco: 'm10/notebook-checklist.jpg',
      cena:
        'An open notebook lying on a pale table with a hand-drawn checklist on the page — a column of six small empty ' +
        'square boxes with a short handwritten line beside each — a pen resting in the fold and a phone face down ' +
        'alongside it. ',
      composicao: composicaoDeMesa('the table top'),
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + OBJETOS_SEM_MARCA + NADA_CLINICO + ' No close-up of hands.',
    },

    // ---- warm ups (moldura quase quadrada, ao lado do texto)
    {
      // A1: as seis coisas que você quer saber dizer. A prateleira é o
      // vocabulário inteiro em pé numa parede.
      endereco: 'm10/pharmacy-shelves.jpg',
      cena:
        'The shelves of a pharmacy seen close from the aisle: three tidy rows of plain white and pale-coloured boxes ' +
        'and bottles standing shoulder to shoulder, the row nearest the camera sharp and the aisle beyond falling ' +
        'softly out of focus. ',
      restricao:
        'Every box, bottle and package is plain and unmarked: no medicine name, no brand, no company name, no logo, ' +
        'no cross, no emblem, no symbol and no readable lettering anywhere in the frame. ' +
        PLACAS_AO_FUNDO +
        NADA_CLINICO,
    },
    {
      // A2: os seis números e endereços que você quer ter na mão. Foto de
      // CONTEÚDO — a nota chamada EMERGENCY é o que a aula manda criar.
      endereco: 'm10/phone-emergency-numbers.jpg',
      cena:
        'A phone lying face up on a pale kitchen counter beside a set of keys, its screen showing a plain notes app, ' +
        'photographed close from just above in flat daylight. ',
      restricao:
        telaDeNota('the single word EMERGENCY') + ' ' + PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA + NADA_CLINICO,
    },
    {
      // A3: o que o seu seguro pede. Os documentos juntos sobre a mesa, do jeito
      // que a aluna vai juntá-los na véspera.
      endereco: 'm10/travel-documents-flatlay.jpg',
      cena:
        'A plain dark blue passport, a folded printed sheet, a plain unmarked card and a phone lying face down, ' +
        'arranged loosely together on a pale table top and photographed straight down from above in flat daylight. ',
      restricao:
        PLACAS_AO_FUNDO_BASE + DOCUMENTOS_GENERICOS + OBJETOS_SEM_MARCA + NADA_CLINICO + ' No close-up of hands.',
    },
    {
      // A4: as seis coisas que você diz no balcão da clínica. A recepção vista
      // do lado do paciente — o mesmo enquadramento do balcão do hotel no M4.
      endereco: 'm10/clinic-reception.jpg',
      cena:
        'The reception counter of a small clinic seen from the patient’s side: a pale counter top with a card ' +
        'terminal and the back of a monitor on it, a low partition of frosted glass behind, and the receptionist a ' +
        'calm out-of-focus figure in plain light clothing. ',
      restricao: PLACAS_AO_FUNDO + NADA_CLINICO,
    },

    // ---- travel tips (moldura quase quadrada, ao lado do cartão âmbar)
    {
      // A1: escreva a sua ficha de saúde em inglês e MOSTRE A TELA no balcão.
      endereco: 'm10/phone-health-note.jpg',
      cena:
        'A phone lying face up on a pale table beside a plain unmarked medicine box, its screen showing a plain notes ' +
        'app, photographed close from just above. ',
      restricao:
        telaDeNota('the two words HEALTH NOTE') +
        ' The medicine box is plain and unmarked: no medicine name, no brand, no logo, no cross and no lettering. ' +
        PLACAS_AO_FUNDO_BASE +
        OBJETOS_SEM_MARCA +
        NADA_CLINICO,
    },
    {
      // A2: quatro coisas numa nota só, antes de voar. No papel primeiro, porque
      // é assim que elas aparecem antes de virarem nota.
      endereco: 'm10/notebook-numbers.jpg',
      cena:
        'An open notebook on a pale table with four short handwritten lines on the page, one under the other, and a ' +
        'phone lying face up beside it with its screen dark, photographed close from just above. ',
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + OBJETOS_SEM_MARCA + NADA_CLINICO + ' No close-up of hands.',
    },
    {
      // A3: guarde TODO recibo e fotografe no mesmo dia. A pasta com os papéis
      // dentro é a dica inteira.
      endereco: 'm10/receipts-folder.jpg',
      cena:
        'A plain card folder lying open on a pale table with a small stack of paper till receipts and printed sheets ' +
        'inside it, their edges fanned so the pile can be seen, photographed close from just above at a slight ' +
        'angle. ',
      restricao:
        'The receipts and sheets are seen at a shallow angle and off the plane of focus, so their printing reads as ' +
        'soft grey lines and bars rather than as words, numbers or barcodes: no readable text, no invented ' +
        'letterforms, no company name, no logo and no amount anywhere in the frame. ' +
        PLACAS_AO_FUNDO +
        NADA_CLINICO,
    },
    {
      // A4: ensaie as cinco respostas em casa e deixe-as escritas EM INGLÊS no
      // celular. A alergia é a que não pode faltar.
      endereco: 'm10/phone-allergy-note.jpg',
      cena:
        'A phone held up in one hand in a plain tidy room, its screen showing a plain notes app, the room behind the ' +
        'hand dissolving softly out of focus. ',
      restricao:
        telaDeNota('the single word ALLERGIES') +
        MAOS_CORRETAS +
        ' ' +
        PLACAS_AO_FUNDO_BASE +
        OBJETOS_SEM_MARCA +
        NADA_CLINICO,
    },
    {
      // Missão: o plano inteiro em UMA nota, e uma cópia para alguém em casa.
      endereco: 'm10/phone-safety-plan.jpg',
      cena:
        'A phone lying face up on a pale table next to an open notebook and a pen, its screen showing a plain notes ' +
        'app, photographed close from just above in flat daylight. ',
      restricao:
        telaDeNota('the two words SAFETY PLAN') +
        ' ' +
        PLACAS_AO_FUNDO_BASE +
        CADERNO_GENERICO +
        OBJETOS_SEM_MARCA +
        NADA_CLINICO,
    },
    ...PRATICA.m10,
  ],

  // M11 — IMPREVISTOS. PARTE 5, e o módulo com a instrução mais dura do lote:
  // nada de violência, e a aula sobre GOLPES não pode ter nenhuma cena que
  // sugira tipo físico, etnia ou nacionalidade de golpista. A saída não é
  // suavizar o suspeito — é não haver suspeito no quadro: a rua é rua, e quem
  // está nela está de costas e fora de foco (ver `SEM_AMEACA`).
  m11: [
    // ---- capas
    {
      // A1 abre o módulo, e a capa É o conteúdo: a palavra CANCELLED no painel é
      // o que a aula ensina a ler. Caso legítimo de texto ditado — mesma régua
      // do `painelQueEnsina` que o dono ratificou no M3.
      endereco: 'm11/departure-board-cancelled.jpg',
      clima:
        'The scene happens inside the hall of a big modern airport terminal: tall glass walls, a high ceiling with ' +
        'even overhead light panels, a polished floor and wide open indoor space, in greys, blues and brushed steel. ' +
        'The light is clear, flat and neutral — never a golden late-afternoon sun, never an orange sunset glow, ' +
        'never long dramatic shadows, never a dark or tense atmosphere. ',
      cena:
        'A large airport departures information board hanging from the ceiling of the terminal, photographed from ' +
        'below and slightly to the side; two travellers stand looking up at it, small and dark and seen from behind ' +
        'against the glass wall beyond them. ',
      restricao: painelQueEnsina(
        'The board shows the single word DEPARTURES as its header and exactly four short rows underneath, each row a ' +
          'city, a time and a status, in this order: LISBON 18:10 CANCELLED, LONDON 18:35 DELAYED, ' +
          'MADRID 19:00 ON TIME, PARIS 19:25 ON TIME.',
      ),
      // texto legível é onde este modelo mais erra: margem larga para descartar
    },
    {
      // A2 é perder documentos: o boletim e o consulado. Guichê genérico, pelo
      // mesmo motivo do M2 — uniforme identificável de país real é proibido.
      endereco: 'm11/police-station-desk.jpg',
      cena:
        'A plain public service counter in a quiet office, seen from the visitor’s side: a worn wooden counter top ' +
        'with a pen on a chain and a small stack of blank forms on it, a chair at one side, and the official behind ' +
        'the counter in plain dark clothing, partly out of focus, looking down at the desk. ',
      restricao: PLACAS_AO_FUNDO + GUICHE_GENERICO + SEM_AMEACA,
    },
    {
      // A3 é a aula dos golpes — a foto de maior risco do curso inteiro. A capa
      // é a rua CHEIA e anônima: ninguém é o assunto, e é isso que a torna
      // possível.
      endereco: 'm11/busy-street.jpg',
      cena:
        'A busy city pavement seen from behind a traveller walking along it with her bag held against her side: ' +
        'strangers coming and going all around her in both directions, all of them out of focus and none of them ' +
        'looking towards her, the shopfronts running away on the right. ',
      restricao: PLACAS_AO_FUNDO + SEM_AMEACA,
    },
    {
      // A4 mistura as três situações no ritmo real. O saguão no fim do dia é o
      // lugar onde todas elas acontecem — e o "evening" fica na luz EVEN do
      // terminal, nunca no laranja.
      endereco: 'm11/airport-hall-evening.jpg',
      clima:
        'The scene happens inside the hall of a big modern airport terminal at the end of the day, lit by the even ' +
        'overhead panels of the ceiling with the last flat daylight still in the glass wall: greys, blues and ' +
        'brushed steel, everything clearly visible and calm. Never a golden late-afternoon sun, never an orange ' +
        'sunset glow, never a dark night scene, never long dramatic shadows. ',
      cena:
        'A wide airport hall at the end of the day: rows of empty waiting seats across the middle of the floor, a few ' +
        'travellers sitting or walking far off with their luggage, seen from behind, and the tall glass wall running ' +
        'along one side of the hall. ',
      restricao: PLACAS_AO_FUNDO + SEM_AMEACA,
    },
    {
      // Missão: o cartão de imprevistos — as frases, as perguntas e os números.
      endereco: 'm11/notebook-plan-b.jpg',
      cena:
        'An open notebook lying on a pale table with two short columns of handwriting on the page, a pen resting in ' +
        'the fold, a phone face down beside it and a plain unmarked card tucked under the notebook’s edge, in flat ' +
        'neutral daylight. ',
      composicao: composicaoDeMesa('the table top'),
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + OBJETOS_SEM_MARCA + ' No close-up of hands.',
    },

    // ---- warm ups (moldura quase quadrada, ao lado do texto)
    {
      // A1: qual desses já aconteceu com você. O balcão da companhia é onde as
      // seis respostas terminam.
      endereco: 'm11/airline-counter.jpg',
      cena:
        'An airline service counter in a terminal seen from the traveller’s side: a traveller standing at it from ' +
        'behind with her cabin bag at her heels, and the member of staff on the other side of the counter partly out ' +
        'of focus, looking down at the desk. ',
      restricao:
        'Nothing in the frame carries a company name or a logo: the counter, the screens and the furniture are plain ' +
        'grey working fittings, and the member of staff wears plain dark clothing with no badge, no name tag and no ' +
        'insignia. ' + PLACAS_AO_FUNDO,
    },
    {
      // A2: o que você levaria a pior perder. A bolsa esquecida no encosto da
      // cadeira é a aula sem nenhuma cena de crime.
      endereco: 'm11/bag-on-chair.jpg',
      cena:
        'A shoulder bag hanging from the back of a chair at a café table, photographed close from the side, its strap ' +
        'looped over the wooden back and the table and the floor beyond it soft and out of focus. Nobody in the ' +
        'frame. ',
      restricao: PLACAS_AO_FUNDO + OBJETOS_SEM_MARCA + SEM_AMEACA,
    },
    {
      // A3: o que você faz quando alguém te aborda. A calçada com as lojas é o
      // lugar da aula — e ele está VAZIO de suspeito de propósito.
      endereco: 'm11/sidewalk-shops.jpg',
      cena:
        'A row of small shopfronts along a city pavement seen from across the street: awnings out over the ' +
        'flagstones, goods on a stand by one of the doors, and two or three pedestrians walking past well out of ' +
        'focus, none of them near each other. ',
      restricao: PLACAS_AO_FUNDO + SEM_AMEACA,
    },
    {
      // A4: as seis frases-âncora do módulo, ditas num balcão. Vista por cima do
      // ombro dela, como manda o ponto de vista.
      endereco: 'm11/counter-conversation.jpg',
      cena:
        'Over the traveller’s shoulder at a plain service counter: the member of staff behind it is listening, in the ' +
        'middle of the conversation, one hand resting on the counter top; the traveller is a dark out-of-focus ' +
        'shoulder and hair filling the near edge of the frame. ',
      restricao: PLACAS_AO_FUNDO + GUICHE_GENERICO + SEM_AMEACA,
    },

    // ---- travel tips (moldura quase quadrada, ao lado do cartão âmbar)
    {
      // A1: peça POR ESCRITO antes de sair do balcão, e guarde o print.
      endereco: 'm11/phone-note-plan-b.jpg',
      cena:
        'A phone held up in one hand in an airport hall, its screen showing a plain notes app, the seats and the ' +
        'glass wall behind it dissolving softly out of focus. ',
      restricao: telaDeNota('the two words PLAN B') + MAOS_CORRETAS + ' ' + PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA,
    },
    {
      // A2: dez minutos ANTES da viagem — fotografe os documentos e mande para o
      // seu próprio e-mail.
      endereco: 'm11/documents-photo-phone.jpg',
      cena:
        'A phone held in one hand above a plain dark blue passport lying open on a pale table, photographing it from ' +
        'straight overhead; on the phone screen the same passport page is framed, and the table around it is bare. ',
      restricao: PLACAS_AO_FUNDO_BASE + DOCUMENTOS_GENERICOS + MAOS_CORRETAS + OBJETOS_SEM_MARCA,
    },
    {
      // A3: se algo parecer errado, entre numa loja ou peça ajuda a quem
      // trabalha ali. A recepção do hotel é o lugar mais seguro da rua.
      endereco: 'm11/hotel-reception-help.jpg',
      clima: CLIMA_DO_HOTEL,
      cena:
        'A hotel reception counter seen from the guest’s side of it, the receptionist behind the counter looking up ' +
        'and listening, partly out of focus, one hand resting on the counter top; the lobby beyond is quiet and ' +
        'brightly lit. ',
      restricao: PLACAS_DE_HOTEL + SEM_AMEACA,
    },
    {
      // A4: diga as três frases em voz alta uma vez por semana — no carro, no
      // chuveiro, andando para o trabalho. Dois minutos.
      endereco: 'm11/rehearsal-phone.jpg',
      cena:
        'A woman walking along an ordinary city pavement seen from behind, her phone held loosely in her lowered ' +
        'hand at her side and a pair of thin earphone cables running up to her ears; her head is lifted and she is ' +
        'speaking to herself as she walks. ',
      restricao: PLACAS_AO_FUNDO + OBJETOS_SEM_MARCA + SEM_AMEACA,
    },
    {
      // Missão: o cartão de imprevistos fica numa nota do celular, não no papel
      // — porque o papel fica na bolsa que você acabou de perder.
      endereco: 'm11/phone-checklist.jpg',
      cena:
        'A phone lying face up on a pale table beside a plain dark passport, its screen showing a plain notes app, ' +
        'photographed close from just above in flat neutral daylight. ',
      restricao:
        telaDeNota('the single word CHECKLIST') +
        ' The passport is a plain generic travel document: a dark navy booklet with no country name, no coat of arms, ' +
        'no emblem and no readable lettering on the cover. ' +
        PLACAS_AO_FUNDO_BASE +
        OBJETOS_SEM_MARCA,
    },
    ...PRATICA.m11,
  ],

  // M12 — READY TO GO. PARTE 6, o fecho do curso: "horizonte/viagem, luz clara e
  // otimista". É a parte com MAIS luz de todas — e ainda assim sem o dourado,
  // que é da parte 3. As quatro aulas são simulações que recapitulam o curso
  // inteiro, então os endereços passeiam por todos os cenários anteriores; o que
  // os mantém no M12 e não no módulo de origem é exatamente o clima.
  m12: [
    // ---- capas
    {
      // A1 é a chegada inteira: companhia, imigração e hotel. A capa é a véspera
      // — a mala pronta, ainda em casa, na luz da parte.
      //
      // ⚠️ SEGUNDA VERSÃO (varredura de 25/07): a primeira saiu lavada — mala
      // branca sobre colcha branca contra janela estourada, e sob o véu da capa
      // sobrava um retângulo cinza claro. A cena não muda; o que muda é que a
      // mala agora é ESCURA e a luz vem de lado, para haver preto no quadro.
      // Ver `CONTRASTE_SOB_O_VEU`.
      endereco: 'm12/packed-suitcase.jpg',
      cena:
        'A dark navy hard-shell suitcase lying open on a made bed, its clothes folded in neat stacks inside and a ' +
        'plain dark passport resting on top of them, the deep shadow of the open shell falling across the packing; ' +
        'the daylight comes from a window to one side and the tidy room stays clearly visible behind it. ' +
        'The open case sits HIGH AND TO THE LEFT in the picture: its raised lid reaches up into the top third of ' +
        'the frame and the whole case is finished well above the middle line, while the bare bedspread runs away ' +
        'empty across the entire bottom half of the frame. Nothing of the case is in the lower half. ',
      composicao: composicaoDeMesa('the bedspread'),
      restricao:
        PLACAS_AO_FUNDO_BASE + DOCUMENTOS_GENERICOS + OBJETOS_SEM_MARCA + CONTRASTE_SOB_O_VEU + ' No close-up of hands.',
    },
    {
      // A2 é o dia inteiro na cidade: bilhete, mesa e caixa. A capa é a manhã
      // que abre esse dia.
      endereco: 'm12/city-morning.jpg',
      cena:
        'A city street early in the morning, wide and bright and almost empty: a traveller with a small bag over her ' +
        'shoulder walking away from the camera down the middle of the pavement, shutters still down along the ' +
        'shopfronts, the open sky above the roofline at the end of the street. ',
    },
    {
      // A3 são as três conversas que ninguém marca: socialização, emergência e
      // imprevisto. A capa é a primeira delas, no lugar mais aberto possível.
      //
      // ⚠️ SEGUNDA VERSÃO (varredura de 25/07): a primeira foi eleita a PIOR
      // CAPA DO CURSO. Céu pálido vazio ocupando a metade de cima, as duas
      // pessoas pequenas e claras lá embaixo no meio, um paredão branco à
      // direita — sob o véu não sobrava nem a conversa nem o terraço. Três
      // coisas mudam: as pessoas sobem para a metade de cima e chegam PERTO (é
      // capa, não paisagem), a cidade atrás delas é telhado e pedra em vez de
      // céu, e a cena passa a ter preto (`CONTRASTE_SOB_O_VEU`).
      endereco: 'm12/rooftop-conversation.jpg',
      cena:
        'Two people standing close together at the stone parapet of a rooftop terrace, seen from behind and from ' +
        'slightly BELOW at a normal conversational distance, leaning on the parapet and turned towards each other ' +
        'as they talk, their dark coats clear against the view. They stand on the LEFT of the frame and they are ' +
        'TALL in it: their heads and shoulders reach up into the top third of the picture, well above the middle ' +
        'line, and the warm tiled roofs, chimneys and towers of the city spread out around them at mid-height. Only ' +
        'a narrow band of bright sky shows above the roofline, and the bottom of the frame is the plain paving of ' +
        'the terrace in open shadow. ',
      restricao: PLACAS_AO_FUNDO_BASE + OBJETOS_SEM_MARCA + CONTRASTE_SOB_O_VEU + ' No close-up of hands.',
    },
    {
      // A4 é a avaliação final. A capa é o horizonte da janelinha — o fim do
      // curso visto de onde a viagem acontece.
      endereco: 'm12/window-seat-horizon.jpg',
      clima:
        'The scene happens inside the cabin of an airliner in bright daylight: clear even light coming in through the ' +
        'window, the interior in cool grey shadow, and a wide luminous horizon outside. Never a golden sunset, never ' +
        'an orange glow outside the window, never long dramatic shadows. ',
      cena:
        'Seen from a passenger seat by the window: the oval aircraft window filled with a bright flat layer of cloud ' +
        'and a clean far horizon, the wing tip crossing the lower part of the view, the empty seat and the armrest in ' +
        'the cool shadow of the cabin. ',
    },
    {
      // Missão final: montar o arquivo da viagem dos sonhos. Objeto sobre mesa,
      // fechando o curso com os mesmos dois objetos que o abriram no M0.
      endereco: 'm12/suitcase-and-passport.jpg',
      cena:
        'A plain dark passport and a folded paper map lying on top of a closed suitcase standing flat on the floor, ' +
        'photographed from just above in bright even daylight, the floorboards around the suitcase clean and bare. ',
      composicao: composicaoDeMesa('the suitcase lid and the floor'),
      restricao:
        'The map is folded and seen at a shallow angle and off the plane of focus, so its printing reads as soft ' +
        'coloured lines and blocks rather than as place names or words. ' +
        PLACAS_AO_FUNDO_BASE +
        DOCUMENTOS_GENERICOS +
        OBJETOS_SEM_MARCA +
        ' No close-up of hands.',
    },

    // ---- warm ups (moldura quase quadrada, ao lado do texto)
    {
      // A1: as seis frases da chegada, e a primeira é "I have one bag".
      endereco: 'm12/passport-and-boarding-pass.jpg',
      cena:
        'A plain dark passport with a printed paper boarding pass tucked into it, lying on a pale table in a bright ' +
        'departure lounge, photographed close from just above; the rows of seats and the glass wall behind them fall ' +
        'far out of focus. ',
      restricao: PLACAS_AO_FUNDO_BASE + DOCUMENTOS_GENERICOS + ' No close-up of hands.',
    },
    {
      // A2: as seis frases do dia na cidade, e a primeira é o bilhete de ida e
      // volta. Bilhete e mapa juntos são a parada inteira.
      endereco: 'm12/ticket-and-map.jpg',
      cena:
        'A small paper transport ticket and a folded city map lying together on a café table in bright daylight, a ' +
        'cup of coffee at the edge of the frame, photographed close from just above at a slight angle. ',
      restricao:
        'The ticket and the map are seen at a shallow angle and slightly off the plane of focus, so their printing ' +
        'reads as soft grey and coloured lines rather than as words, place names or numbers: no readable text, no ' +
        'invented letterforms, no company name and no logo anywhere in the frame. ' + PLACAS_AO_FUNDO,
    },
    {
      // A3: as seis frases das conversas que ninguém marca, e uma delas é "I
      // don't feel well". A farmácia vista da calçada, sem ninguém dentro.
      endereco: 'm12/pharmacy-window.jpg',
      cena:
        'The window of a small pharmacy seen from the pavement in bright daylight: plain shelves of white boxes ' +
        'behind the glass, a simple green cross sign mounted above the door, and the door itself standing open on a ' +
        'quiet interior. Nobody in the frame. ',
      restricao:
        'Nothing in the frame carries a shop name, a company name, a chain name, a logo, an emblem or a flag: the ' +
        'sign above the door is a plain green cross and nothing else, and every box behind the glass is plain and ' +
        'unmarked. ' + PLACAS_AO_FUNDO,
    },
    {
      // A4: o que conta como conversa que funcionou. A aluna falando sozinha em
      // voz alta — o gesto que o curso inteiro pediu, na luz do fim dele.
      endereco: 'm12/speaking-out-loud.jpg',
      clima:
        'The scene happens indoors at home in front of a wide bright window, in clear generous daylight: white walls, ' +
        'pale wood and a lot of light. Never a golden late-afternoon sun, never an orange sunset glow, never long ' +
        'dramatic shadows. ',
      cena:
        'A woman standing alone in front of a wide bright window speaking out loud, seen from behind in half ' +
        'silhouette against the light, one hand raised slightly as she talks and a sheet of paper held loosely in ' +
        'the other; the room behind her is plain and open. ',
      restricao: PLACAS_AO_FUNDO_BASE + MAOS_CORRETAS + OBJETOS_SEM_MARCA,
    },

    // ---- travel tips (moldura quase quadrada, ao lado do cartão âmbar)
    {
      // A1: ensaie as três cenas DE PÉ, com os documentos na mão. O portão é
      // onde a chegada começa.
      endereco: 'm12/boarding-gate.jpg',
      cena:
        'A departure gate seen from among the waiting seats: the gate desk on one side, the open door of the jet ' +
        'bridge beyond it, a few travellers standing with their cabin bags seen from behind, and a tall glass wall ' +
        'flooding the whole area with bright daylight. ',
      restricao:
        'Nothing in the frame carries a company name or a logo: the desk, the screens and the seating are plain grey ' +
        'working furniture. ' + PLACAS_AO_FUNDO,
    },
    {
      // A2: leia a conta antes de pagar e carregue um pouco de dinheiro vivo.
      endereco: 'm12/cafe-table.jpg',
      cena:
        'A café table photographed close from just above in bright daylight: an empty coffee cup on its saucer, a ' +
        'small paper bill lying beside it in a folded card holder and a few coins resting on top of the paper. ',
      restricao: PLACAS_AO_FUNDO_BASE + DINHEIRO_GENERICO + CONTA_DE_HOTEL + ' No close-up of hands.',
    },
    {
      // A3: três coisas no celular antes de voar — número de emergência, seguro
      // e o endereço do hotel na língua local.
      endereco: 'm12/phone-notes.jpg',
      cena:
        'A phone lying face up on a pale table beside a plain dark passport in bright even daylight, its screen ' +
        'showing a plain notes app, photographed close from just above. ',
      restricao:
        telaDeNota('the single word TRAVEL') +
        ' The passport is a plain generic travel document: a dark navy booklet with no country name, no coat of ' +
        'arms, no emblem and no readable lettering on the cover. ' +
        PLACAS_AO_FUNDO_BASE +
        OBJETOS_SEM_MARCA,
    },
    {
      // A4: grave, ouça UMA vez e marque as três checagens. As caixinhas
      // marcadas são a avaliação final inteira.
      endereco: 'm12/checklist-notebook.jpg',
      cena:
        'An open notebook on a pale table in bright daylight with three large hand-drawn square boxes down the page, ' +
        'the first two marked with a pen tick and the third still empty, a short handwritten line beside each and a ' +
        'pen resting in the fold. ',
      restricao: PLACAS_AO_FUNDO_BASE + CADERNO_GENERICO + ' No close-up of hands.',
    },
    {
      // Missão final: o arquivo da viagem serve para ABRIR, não para estudar. O
      // saguão de partidas é o último lugar do curso.
      endereco: 'm12/departures-hall.jpg',
      cena:
        'The departures hall of an airport seen from the entrance in bright daylight: a wide expanse of clean floor, ' +
        'a long row of check-in counters running away on one side, travellers with trolleys crossing the hall far ' +
        'off, and a tall glass wall filling the space with light. ',
    },
    ...PRATICA.m12,
  ],
}

// ------------------------------------------------------- conteúdo → endereços

interface UsoDoEndereco {
  /** tipo do slide onde a foto entra — decide a moldura e a composição */
  tipo: string
  /** de que aula veio, para o log da curadoria */
  rotulo: string
}

/**
 * Onde cada endereço `m2/…` é USADO, lido dos JSONs das aulas.
 *
 * O tipo do slide não é declarado no catálogo acima porque o conteúdo já o
 * declara: duplicar seria criar uma segunda fonte de verdade, e a divergência
 * silenciosa (declarar `tip` onde o conteúdo diz `warmup`) sai como foto gerada
 * na proporção errada, que ninguém percebe olhando a foto sozinha.
 */
function enderecosDoModulo(prefixo: string): Map<string, UsoDoEndereco> {
  const mapa = new Map<string, UsoDoEndereco>()
  for (const arquivo of fs.readdirSync(CONTEUDO).sort()) {
    if (!arquivo.endsWith('.json')) continue
    const doc = JSON.parse(fs.readFileSync(path.join(CONTEUDO, arquivo), 'utf8'))
    const rotulo = `M${doc.module?.number}A${doc.lesson?.number} — ${doc.lesson?.title}`
    for (const slide of doc.slides ?? []) {
      const file: unknown = slide?.image?.file
      if (typeof file !== 'string' || !file.startsWith(`${prefixo}/`)) continue
      const antes = mapa.get(file)
      // O MESMO ENDEREÇO EM DOIS SLIDES — descoberto no M0, onde as sete fotos
      // giram entre capa, divisória, warm up e dica (a `m0/study-desk-morning` é
      // capa da A1 e divisória da A3 e da missão), e no M9
      // (`voice-note-recording` é capa da missão e dica da A3).
      //
      // A versão anterior fazia `set` cego e o ÚLTIMO uso lido ganhava — quer
      // dizer: a régua da foto dependia da ordem alfabética dos arquivos do
      // conteúdo. Quando o vencedor não é a capa, a foto é gerada e conferida
      // sem a régua da facecam, e a viajante vai parar atrás do rosto da
      // professora exatamente no slide onde isso importa.
      //
      // A precedência é a régua mais ESTRITA: capa ganha de tudo. Entre os
      // demais o primeiro ganha, porque os três (warm up, dica, divisória) caem
      // na mesma moldura quase quadrada e na mesma régua de `quadro` — a escolha
      // entre eles não muda nada do que sai.
      if (antes && (antes.tipo === 'cover' || slide.type !== 'cover')) continue
      mapa.set(file, { tipo: slide.type, rotulo })
    }
  }
  return mapa
}

/** o número do módulo a partir do prefixo da biblioteca (`m2` → 2) */
function numeroDoModulo(prefixo: string): number {
  const n = Number(prefixo.replace(/^m/, ''))
  if (!Number.isInteger(n)) throw new RangeError(`prefixo de módulo inválido: "${prefixo}" (esperado m2, m3, …)`)
  return n
}

/** prompt final: estilo + clima + ponto de vista + cena + composição + restrições */
function promptDaCena(cena: Cena, uso: UsoDoEndereco, clima: string): string {
  const composicao = cena.composicao ?? (uso.tipo === 'cover' ? COMPOSICAO_CAPA : COMPOSICAO_QUADRO)
  return `${ESTILO} ${cena.clima ?? clima}${PONTO_DE_VISTA}${cena.cena}${composicao} ${cena.restricao ?? PLACAS_AO_FUNDO}`
}

/**
 * A RÉGUA DA CONFERÊNCIA de cada foto. Ela sai do TIPO do slide pelo mesmo
 * motivo que o enquadramento sai: quem sabe onde a foto entra é o conteúdo.
 *
 * A zona da facecam só se cobra na CAPA — é lá que a câmera da professora pousa
 * por cima da foto. Num warm up ou numa dica, onde a foto vive numa moldura ao
 * lado do texto, cobrar a zona seria inventar um defeito que aquele slide não
 * tem.
 */
const regraDoTipo = (tipo: string): Regra =>
  tipo === 'cover' ? { tipo: 'capa', zonaPct: ZONA_FACECAM_PCT } : { tipo: 'quadro' }

async function main(): Promise<void> {
  const [prefixo, ...resto] = process.argv.slice(2)
  const soPrompts = resto.includes('--prompts')
  const refazer = resto.includes('--refazer')
  const filtro = resto.filter((a) => a !== '--prompts' && a !== '--refazer')

  const catalogo = prefixo ? CENAS[prefixo] : undefined
  if (!catalogo) {
    console.error(`Uso: node scripts/images/cenas.ts <módulo> [endereço…] [--prompts] [--refazer]`)
    console.error(`Módulos com cenas escritas: ${Object.keys(CENAS).join(', ')}`)
    process.exit(2)
  }

  const usos = enderecosDoModulo(prefixo)
  const orfas = catalogo.filter((c) => !usos.has(c.endereco)).map((c) => c.endereco)
  if (orfas.length) {
    console.error(`Endereço que nenhuma aula usa: ${orfas.join(', ')}. Corrija a cena ou o conteúdo.`)
    process.exit(2)
  }
  const faltando = [...usos.keys()].filter((e) => !catalogo.some((c) => c.endereco === e))
  if (faltando.length) console.warn(`⚠ sem cena escrita (não serão geradas): ${faltando.join(', ')}\n`)

  const clima = CLIMA_DA_PARTE[climateFor(numeroDoModulo(prefixo)).part]
  if (!clima) {
    console.error(`Sem clima escrito para a PARTE de ${prefixo} — escreva o bloco antes de gerar.`)
    process.exit(2)
  }

  const escolhidas = filtro.length ? catalogo.filter((c) => filtro.includes(c.endereco)) : catalogo
  if (!escolhidas.length) {
    console.error(`Nenhum endereço bate com ${filtro.join(', ')}.`)
    process.exit(2)
  }

  const alvos = escolhidas.map((c) => {
    const uso = usos.get(c.endereco)!
    return {
      endereco: c.endereco,
      rotulo: `${uso.rotulo} · ${uso.tipo}`,
      prompt: promptDaCena(c, uso, clima),
      framing: enquadramentoPara(uso.tipo),
      regra: regraDoTipo(uso.tipo),
    }
  })

  // A PRÉ-LEITURA que a rodada do M5 não teve: prompt errado só aparece depois
  // de gastar, e agora cada endereço custa até 4 gerações para chegar a nada.
  if (soPrompts) {
    for (const a of alvos) console.log(`\n▸ ${a.endereco}  (${a.rotulo}, ${a.framing})\n${a.prompt}`)
    return
  }

  console.log(
    `${alvos.length} cena(s) de ${prefixo} — candidatas em ${path.relative(raiz, DESTINO)}/${prefixo}/\n`,
  )
  saidaDaRodada(
    await rodada({
      provider: provedorOuSai(raiz),
      destino: path.join(DESTINO, prefixo),
      raiz,
      refazer,
      alvos,
    }),
  )
}

main()
