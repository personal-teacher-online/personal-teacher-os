/**
 * Fotos dos CARDS DE VOCABULÁRIO — o terceiro gerador, irmão do `cenas.ts`.
 *
 * O M2 saiu com 8 cards de vocabulário sem foto nenhuma enquanto o M5 tem foto
 * em todos os 8: o módulo novo saiu pior que o antigo. Este script preenche os
 * endereços que faltam em `brand/slides/library/vocab/` — uma foto por endereço,
 * conferida por máquina (ver `conferencia.ts`); os oito do M2 já foram entregues
 * assim, e endereço que já está na biblioteca não é regerado.
 *
 * O que este script tem de diferente do `cenas.ts`:
 *
 *  1. **Não é cena, é o OBJETO.** A foto de cena conta um momento; o card de
 *     vocabulário associa a palavra ao seu referente e nada mais. A régua não é
 *     minha: são as 24 fotos de vocabulário que já estão na biblioteca e que o
 *     dono aprovou (o M5 inteiro). Olhando-as, a família é clara — objeto ou
 *     lugar real, distância normal, luz natural, fundo real e sossegado, ninguém
 *     posando, e o assunto no meio do quadro. Ver `CARD_DE_VOCABULARIO`.
 *  2. **O corte é uma FAIXA, não um retrato.** Ver `ENQUADRAMENTO`.
 *  3. **Sem clima de módulo.** As 24 aprovadas são de rua, de estação e de mesa
 *     de cozinha ao mesmo tempo: o que dá unidade ao card é o tratamento, não o
 *     ambiente. Forçar "luz fria de terminal" nas oito faria o vocabulário do M2
 *     destoar do vocabulário do M5 na mesma tela do curso.
 *
 * Uso:
 *   node scripts/images/vocab.ts m2                        (o módulo inteiro)
 *   node scripts/images/vocab.ts m2 vocab/passport.jpg     (um endereço, ou vários)
 *   node scripts/images/vocab.ts m2 --prompts              (só imprime, não gasta)
 *   node scripts/images/vocab.ts m2 --refazer              (regera mesmo já existindo)
 */
import fs from 'node:fs'
import path from 'node:path'
import { ESTILO } from '../../src/lib/images/prompt.ts'
import type { ImageFraming } from '../../src/lib/images/provider.ts'
import {
  FAIXA_DO_CARD_PCT,
  PLACAS_AO_FUNDO,
  TRIPULACAO_GENERICA,
  painelQueEnsina,
  provedorOuSai,
  rodada,
  saidaDaRodada,
} from './comum.ts'

const raiz = path.resolve(import.meta.dirname, '../..')
const CONTEUDO = path.join(raiz, 'content', 'personal-travel-v2')
const DESTINO = path.join(raiz, 'out', 'vocab')

// ------------------------------------------------------------- enquadramento

/**
 * PAISAGEM (3:2) — a proporção das 24 fotos de vocabulário que já estão na
 * biblioteca (900×603 e 1264×848 no disco, ambas 3:2). Não é escolha estética:
 * é o que faz as oito novas parecerem do mesmo lote das antigas na mesma tela.
 */
const ENQUADRAMENTO: ImageFraming = 'paisagem'

/**
 * A FAIXA, que é a razão de a composição deste script não ser a do `cenas.ts`.
 *
 * A medida mora no `comum.ts` (`FAIXA_DO_CARD_PCT`) desde 25/07 à noite, porque
 * agora ela tem dois leitores: este prompt e a conferência, que reprova a
 * candidata cujo assunto não cai na fatia. O resumo: no card do `template-v2` a
 * foto entra numa moldura de 3.34:1 com `sizing: 'cover'`, então de uma foto 3:2
 * sobra a FAIXA HORIZONTAL DO MEIO — uns 45% da altura. Assunto encostado no
 * alto ou no pé não aparece no slide, e isso não se vê olhando a foto sozinha.
 */
const CARD_DE_VOCABULARIO =
  'Composition: ONE clear subject and nothing competing with it. The subject is photographed from a normal distance, ' +
  'large in the frame and unmistakable even at thumbnail size, and it sits in the MIDDLE horizontal band of the ' +
  'picture — well away from the top and the bottom edges — with calm uncluttered space around it. ' +
  'A real object in a real place, natural daylight, an ordinary quiet background well behind the plane of focus: ' +
  'never a studio shot, never a cut-out on white, nobody posing for the camera. '

/**
 * TEXTO EM DOCUMENTO — quatro dos oito cards são papel impresso, e papel
 * impresso é onde este modelo inventa garrancho.
 *
 * A régua NÃO é "sem texto": a `vocab/ticket.jpg` que já está na biblioteca e
 * foi aprovada traz "TRAIN TICKET / ONE WAY" impresso, nítido e correto, e é uma
 * das melhores do lote. O que reprova é (a) nome de país, inventado ou real, (b)
 * brasão/bandeira/logo, e (c) letra torta. Então: uma ou duas palavras reais em
 * caixa alta, ou nada — e "nada" aqui não é superfície apagada, é a superfície
 * mostrando o próprio padrão de segurança, que é o que uma foto real mostra.
 */
const TEXTO_DE_DOCUMENTO =
  'Lettering: any word visible in this photograph is real, short and correctly spelled letter by letter — at most two ' +
  'plain English words in plain capitals, and nothing else. Never a country name, real or invented; no coat of arms, ' +
  'no emblem, no flag, no crest, no airline or company logo, no barcode, no serial numbers, no lines of small print. ' +
  'If a word cannot be rendered correctly letter by letter, that surface carries no lettering at all and shows only ' +
  'its plain printed pattern — the guilloche, the security tint, the blank ruled boxes of a real document. ' +
  'No close-up of hands.'

/**
 * A LINHA DA CONTA — a variante do bloco acima para os cards que são PAPEL DE
 * TRABALHO: a conta e o recibo do hotel (`bill`, `included`, `extra-charge`,
 * `city-tax`, `late-check-out`, `receipt`), a conta do restaurante (`check`) e a
 * etiqueta de preço da loja (`price-tag`).
 *
 * O `TEXTO_DE_DOCUMENTO` manda "no máximo duas palavras e nada mais", e para um
 * passaporte isso é certo. Para uma conta de hotel é errado: conta sem valor
 * nenhum não é conta, é papel em branco — e papel em branco foi justamente o que
 * o dono reprovou nas placas. A régua ratificada nesta rodada separa as duas
 * coisas: o valor PODE existir, a miudeza ilegível não. E a miudeza se resolve
 * com profundidade de campo, que é o que uma fotografia real faz com ela.
 *
 * Quem chama dita a ÚNICA linha nítida — o mesmo princípio do `painelQueEnsina`
 * do M3: o modelo erra o que inventa e acerta o que se manda escrever.
 */
const LINHA_DE_CONTA = (nitida: string): string =>
  `Lettering: this is a real working printed document, so it does carry print. ${nitida} ` +
  'That is the only sharp lettering in the frame: every other line on the paper lies off the plane of focus and reads ' +
  'as soft grey ruled bars, never as words. No hotel name, no chain name, no company name, no logo, no crest, no coat ' +
  'of arms, no flag, no barcode, no serial number and no dense block of small print anywhere. Every word that is sharp ' +
  'is a real English word in plain capitals, spelled correctly letter by letter, and every amount is a plain, ' +
  'correctly formed number; if a word cannot be rendered correctly, that line is a plain ruled bar instead. ' +
  'No close-up of hands.'

/**
 * O OBJETO SEM MARCA — o bloco mais usado do lote de 104, porque a maior parte
 * dos termos novos é objeto industrial (adaptador, fone, celular, cartão,
 * carrinho de mercado, sapato). É exatamente onde este modelo cola logotipo
 * sozinho: uma das candidatas reprovadas da rodada anterior trouxe `patagonia`
 * legível numa mochila.
 */
const SEM_MARCA_NO_OBJETO =
  'The object is plain and unbranded: no logo, no brand name, no maker’s mark, no model name, no lettering and no ' +
  'screen text anywhere on it. ' + PLACAS_AO_FUNDO

/**
 * A PLACA QUE É O CARD — irmã do `painelQueEnsina` (que é o painel escuro de
 * voo), para o outro tipo de placa que os cards novos pedem: o letreiro
 * suspenso do aeroporto (`arrival`, `departure`, `connection`, `gate`,
 * `lost-and-found`) e a fachada da delegacia (`police-station`).
 *
 * Mesma régua do dono: o modelo erra o que INVENTA e acerta a palavra curta que
 * se MANDA escrever, e a saída honesta para o que ele não sabe escrever é o
 * painel liso — nunca a letra torta.
 */
const placaEmFoco = (palavras: string): string =>
  'The sign is the SUBJECT of this photograph: sharp, evenly lit and perfectly legible, plain capitals on a plain ' +
  `panel, and it carries ${palavras} and nothing else. Every word on it is a real English word spelled correctly ` +
  'letter by letter. No company name, no airline name, no hotel name, no logo, no emblem, no coat of arms, no flag, ' +
  'no country name, no small print and no extra lines. If a word cannot be rendered correctly letter by letter, the ' +
  'panel is left plain and empty instead of being filled with invented letterforms. ' +
  'Every other sign, poster and screen in the frame lies well behind the plane of focus, its lettering dissolved ' +
  'into soft unreadable shapes, and no other surface in the frame carries text or logos. No close-up of hands.'

/**
 * A PRATELEIRA — o M7 se passa dentro de um mercado e de uma loja, e prateleira
 * cheia é uma parede de marcas. Aqui a régua do repo (`PROIBIDO`) vale inteira e
 * em positivo: a embalagem É lisa, não "não tem logo".
 */
const EMBALAGEM_NEUTRA =
  'Every package, box, tin, jar, label and price card in view is plain and unmarked — flat colour and plain paper, ' +
  'with no brand name, no logo, no product name and no lettering of any kind printed on it. ' + PLACAS_AO_FUNDO

/**
 * A CÂMERA DA MESA — a correção comprada olhando o M6 renderizado em PNG, e a
 * única coisa deste lote que precisou de segunda rodada por decisão minha e não
 * da conferência.
 *
 * A primeira versão dizia "on a pale wooden table by a window, photographed from
 * a normal distance and slightly above". O modelo leu isso como CENA DE MESA:
 * câmera à altura do tampo, o prato pequeno e lá no fundo, a janela e o salão
 * ocupando o alto do quadro. A foto isolada é bonita e a conferência aprovou (e
 * aprovou certo — não há defeito grave nela). Só que no card ela morre duas
 * vezes: o assunto cai fora da fatia do meio, e ela DESTOA das nove fotos de
 * comida do M6 que o dono já aprovou, que estão todas na mesma língua — olhar
 * de cima em uns 45°, prato grande, o resto é tampo desfocado. Numa grade de
 * oito cards lado a lado a diferença salta.
 *
 * O erro foi meu, na redação: "distância normal" para um objeto sobre a mesa não
 * é a distância de quem olha a sala, é a de quem vai comer.
 */
/**
 * O OBJETO-HERÓI — a correção comprada olhando a primeira rodada das oito fotos
 * de cidade do M5A2, e o defeito mais interessante do lote.
 *
 * `street`, `avenue` e `sidewalk` são as três cujo assunto é o LUGAR e não uma
 * coisa dentro dele. As três primeiras candidatas vieram tecnicamente corretas —
 * a rua está lá, a calçada está lá — e as três leem errado no card, porque o
 * modelo, obedecendo ao `CARD_DE_VOCABULARIO` ("UM assunto claro no meio do
 * quadro"), pôs no meio do quadro um OBJETO: em duas delas, literalmente a mesma
 * bicicleta encostada. Na fatia do card a aluna vê uma bicicleta, e a palavra
 * embaixo dela diz "rua".
 *
 * A conferência não pega isto e não deveria: não é marca, não é anatomia, não é
 * emenda, e o assunto CAI na fatia. É critério de enquadramento, que é humano.
 *
 * A saída não é proibir bicicleta — é dizer qual é o assunto. Lugar vazio é o que
 * faz o lugar ser o assunto.
 */
const O_LUGAR_E_O_ASSUNTO =
  'The PLACE itself is the subject of this photograph and nothing stands in front of it: there is no bicycle, no ' +
  'motorbike, no bench, no parked car and no single object placed in the middle of the frame for the eye to land ' +
  'on, and no person anywhere near the camera. Nothing at all is lying, standing or left on the ground in the ' +
  'foreground — no cup, no bag, no litter, no bollard, no sign, no plant pot. Whatever else is in the picture is ' +
  'small, far away and softly out of focus, at the sides or at the far end. '

const MESA_DO_M6 =
  'photographed looking down at the table from about forty-five degrees and from close in, so that it is LARGE in ' +
  'the frame and sits squarely in the MIDDLE of it, in soft daylight; behind it there is only the bare table top ' +
  'falling gently out of focus. Never seen from table height across a room, never small and far away, and no window, ' +
  'street or dining room filling the top of the picture. '

// ------------------------------------------------------------------ o catálogo

interface Termo {
  /** endereço na biblioteca, como o card o referencia */
  endereco: string
  /** o que fotografar — entra depois do ESTILO */
  cena: string
  /** bloco final de restrições; sem isto, `PLACAS_AO_FUNDO` */
  restricao?: string
}

/**
 * Os oito termos do M2A1 ("What the officer asks to see").
 *
 * Seis são objetos e se resolvem apontando a câmera. Duas são ABSTRATAS e
 * mereciam decisão em vez de literalidade — o parágrafo de cada uma explica por
 * que aquele objeto e não uma metáfora.
 */
const TERMOS: Record<string, Termo[]> = {
  m2: [
    {
      // O objeto mais direto do lote. O passaporte fechado sobre madeira clara é
      // o mesmo vocabulário visual da `vocab/ticket.jpg` aprovada.
      endereco: 'vocab/passport.jpg',
      cena:
        'A single dark navy blue passport booklet lying closed on a plain pale wooden table by a window, photographed ' +
        'from slightly above and to one side so the light rakes across the cover. Nothing else on the table. ',
      // A ÚNICA palavra admitida é o próprio termo do card, que é genérico e não
      // identifica país. Sem ela a capa fica lisa demais e lê como brinquedo.
      restricao:
        'The cover carries at most the single word PASSPORT in plain capitals, embossed and correctly spelled. ' +
        TEXTO_DE_DOCUMENTO,
    },
    {
      endereco: 'vocab/boarding-pass.jpg',
      cena:
        'A single printed paper boarding pass lying on a plain pale wooden table, its perforated tear-off stub clearly ' +
        'visible, photographed straight from above in soft daylight. Nothing else on the table. ',
      restricao:
        'The card carries at most the words BOARDING PASS in plain capitals; every other printed field on it is a ' +
        'plain empty ruled box. ' + TEXTO_DE_DOCUMENTO,
    },
    {
      // O irmão visual do `ticket.jpg` aprovado — de propósito: são a mesma
      // categoria de objeto, e a aluna precisa ver a diferença na PALAVRA, não
      // num salto de estilo entre os dois cards.
      endereco: 'vocab/return-ticket.jpg',
      cena:
        'A small printed paper travel ticket resting on a plain pale wooden table by a window, photographed close and ' +
        'slightly from above, the paper catching the daylight. Nothing else on the table. ',
      restricao:
        'The ticket carries the words RETURN TICKET in plain capitals and nothing else. ' + TEXTO_DE_DOCUMENTO,
    },
    {
      // Visto é uma PÁGINA, não um objeto solto: a única imagem honesta é o
      // passaporte aberto. Aqui não se admite palavra nenhuma — um visto real é
      // denso de texto e de país, e é justamente o que não pode aparecer.
      endereco: 'vocab/visa.jpg',
      cena:
        'A passport lying open on a plain pale wooden table at a page that carries one full-page printed visa label ' +
        'with a round ink stamp across it, photographed close and at a slight angle in soft window light. ',
      restricao:
        'The printing on the visa label and the ink of the round stamp are seen at a shallow angle and slightly off ' +
        'the plane of focus, so they read as soft grey lines, blocks and a smudge of ink rather than as words: no ' +
        'readable text anywhere. ' + TEXTO_DE_DOCUMENTO,
    },
    {
      // Mesma régua das cenas do M2: autoridade de fronteira sem país. A pessoa
      // precisa ser grande no quadro para o card ler, e ao mesmo tempo não pode
      // ser um retrato — daí a cabeça fora do plano de foco.
      endereco: 'vocab/officer.jpg',
      cena:
        'An anonymous public official standing behind the counter of a plain border control booth in an airport, seen ' +
        'from the traveller’s side of the counter at a normal conversational distance, in plain dark clothing, head ' +
        'turned slightly away and softly out of the plane of focus. ',
      restricao:
        'No insignia, no epaulettes, no patch, no badge, no name tag, no flag and no coat of arms anywhere in the ' +
        'frame — nothing identifies a real country or a real agency, and the booth is plain grey working furniture. ' +
        PLACAS_AO_FUNDO,
    },
    {
      // ABSTRATA. "Alfândega" não é um objeto: é um LUGAR que a aluna atravessa,
      // e ela vai reconhecê-lo pelo corredor verde depois da esteira — que é
      // exatamente o que as notas da aula mandam a professora contar. Metáfora
      // (mala aberta, luva de fiscal) seria mais bonita e menos reconhecível.
      endereco: 'vocab/customs.jpg',
      cena:
        'The customs exit of an airport arrivals hall: an empty green walkthrough channel with its overhead sign board ' +
        'above it, a luggage trolley standing to one side, the hall beyond softly out of focus. ',
      restricao:
        'The overhead sign carries at most the words NOTHING TO DECLARE in plain capitals, correctly spelled; if those ' +
        'words cannot be rendered correctly, the sign is simply a green panel with a plain white arrow symbol and no ' +
        'lettering at all. No other sign, poster or screen in the frame carries readable text: they lie well behind ' +
        'the plane of focus and their lettering dissolves into soft shapes. No close-up of hands.',
    },
    {
      endereco: 'vocab/luggage.jpg',
      cena:
        'Two hard-shell suitcases and a soft travel bag standing together on the polished floor of an airport hall, ' +
        'photographed at luggage height, the terminal falling softly out of focus behind them, nobody standing with them. ',
    },
    {
      // ABSTRATA, e a mais difícil das duas. "Purpose" na imigração é a resposta
      // à pergunta "what's the purpose of your visit?", e a resposta que a aula
      // ensina é TOURISM. Então a foto não é do conceito, é da resposta: as
      // coisas de quem está viajando a passeio, arrumadas sobre a mesa. O mapa
      // entra em branco pela mesma razão de sempre (Lei 11 e a `planning-flatlay`
      // do M5, que já resolveu assim).
      endereco: 'vocab/purpose.jpg',
      cena:
        'The things of a holiday laid out together on a plain pale wooden table in daylight, photographed straight from ' +
        'above: a small compact camera, a pair of sunglasses, a straw sun hat and a folded paper map, arranged close ' +
        'together as one compact group that reads as a single subject. ',
      restricao:
        'The folded map shows only plain coloured shapes and lines, with no place names and no lettering of any kind. ' +
        'No brand, no logo and no text on the camera, the sunglasses or anywhere else in the frame. No close-up of hands.',
    },
  ],

  /**
   * M1A4 — "Pensar em Inglês". Cinco objetos do dia a dia, e o dia a dia É o
   * ponto: a aluna nomeia o que está em volta dela em casa, não o que está na
   * viagem. Daí a mesa de cozinha em vez do aeroporto.
   */
  m1: [
    {
      // A `vocab/coffee.jpg` aprovada já é uma xícara COM café; esta é a xícara
      // vazia, senão os dois cards da mesma aula viram a mesma foto.
      endereco: 'vocab/cup.jpg',
      cena:
        'A single empty white ceramic cup on its saucer, standing on a plain pale wooden table by a window, ' +
        'photographed from a normal distance and slightly above in soft daylight. Nothing else on the table. ',
    },
    {
      endereco: 'vocab/keys.jpg',
      cena:
        'A small bunch of ordinary house keys on a plain metal ring, lying on a plain pale wooden table by a window, ' +
        'photographed from slightly above so the daylight catches the metal. Nothing else on the table. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      // "notebook" aqui é CADERNO, não laptop — a tradução do card resolve para
      // a aluna, mas o modelo entrega um computador se ninguém disser.
      endereco: 'vocab/notebook.jpg',
      cena:
        'A closed paper exercise notebook with a plain cloth-bound cover, a pencil lying across it, on a plain pale ' +
        'wooden table by a window, photographed from slightly above. It is a paper notebook for writing by hand, ' +
        'never a laptop computer. Nothing else on the table. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      // Também é o card do M11 (o celular perdido). Uma foto só: aparelho liso
      // com a tela apagada serve às duas aulas.
      endereco: 'vocab/phone.jpg',
      cena:
        'A single ordinary smartphone lying face up on a plain pale wooden table by a window, its screen switched off ' +
        'and completely black, photographed from slightly above in soft daylight. Nothing else on the table. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/window.jpg',
      cena:
        'A plain white-painted domestic window seen from inside a quiet room, daylight coming through the clear glass ' +
        'and a small potted plant on the sill, photographed square-on from a few steps back so the whole window sits ' +
        'in the middle of the frame with the calm wall of the room around it. ',
    },
  ],

  /**
   * M3 — o módulo do voo: aeroporto (A1), cabine (A2) e o que dá errado (A3).
   *
   * Vinte e dois cards, e a armadilha do módulo é a MONOTONIA: `arrival`,
   * `departure`, `delayed`, `cancelled`, `gate-change` e `connection` querem
   * todos ser o mesmo painel preto. Foram separados de propósito — dois são
   * letreiro suspenso de corredor, três são o painel de voos, e `delay` virou a
   * ESPERA (a sala de embarque vazia), que é o que a palavra significa para
   * quem está lá.
   */
  m3: [
    // ---------------------------------------------------------------- M3A1
    {
      endereco: 'vocab/arrival.jpg',
      cena:
        'The overhead direction sign of an airport concourse, hanging from the ceiling above a wide empty corridor, ' +
        'photographed from several metres back and straight on, so the sign hangs in the MIDDLE of the frame with the ' +
        'ceiling above it and the floor of the hall below it, travellers far away and softly out of focus. ',
      restricao: placaEmFoco('the single word ARRIVALS beside a plain white arrow'),
    },
    {
      endereco: 'vocab/departure.jpg',
      cena:
        'The overhead direction sign of an airport concourse, hanging from the ceiling above a wide bright corridor, ' +
        'photographed from several metres back and straight on, so the sign hangs in the MIDDLE of the frame with the ' +
        'ceiling above it and the floor of the hall below it, travellers far away and softly out of focus. ',
      restricao: placaEmFoco('the single word DEPARTURES beside a plain white arrow'),
    },
    {
      endereco: 'vocab/boarding.jpg',
      cena:
        'A short queue of passengers with cabin bags waiting at the open door of a jet bridge at an airport gate, ' +
        'seen from behind at a normal distance, the gate desk to one side, the terminal windows bright behind them. ' +
        'Nobody is close to the camera and nobody looks at it. ',
    },
    {
      endereco: 'vocab/carry-on.jpg',
      cena:
        'A single small wheeled cabin suitcase standing upright on the polished floor of an airport departure lounge ' +
        'beside a row of seats, photographed at bag height from a normal distance, the lounge falling softly out of ' +
        'focus behind it, nobody standing with it. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/check-in.jpg',
      cena:
        'A row of airport check-in desks with their baggage belts, seen from the queue at a normal distance, the desks ' +
        'plain grey working furniture, a member of staff behind one of them turned towards their work and softly out ' +
        'of the plane of focus. ',
      restricao:
        'Nothing identifies a real airline or a real company: the desks, the belts and the panels above them are plain ' +
        'and carry no name, no logo, no emblem and no flag. ' + PLACAS_AO_FUNDO,
    },
    {
      // ABSTRATA. "Atraso" não é objeto: é a espera. O painel com DELAYED é o
      // card `delayed`; este é o que a palavra significa para quem está lá.
      endereco: 'vocab/delay.jpg',
      cena:
        'A nearly empty airport gate lounge late in the day: one traveller sitting alone among rows of empty seats ' +
        'with a suitcase beside them, seen at full length from a normal distance, the big terminal window behind them ' +
        'going gold. Nobody looks at the camera. ',
    },
    {
      endereco: 'vocab/gate.jpg',
      cena:
        'The boarding gate of an airport: the plain gate desk with the door to the jet bridge beside it and the ' +
        'illuminated gate number panel above, photographed straight on from a few metres back so the panel and the ' +
        'desk together fill the MIDDLE of the frame, the seating area softly out of focus. ',
      restricao: placaEmFoco('the word GATE and the number 12'),
    },
    {
      endereco: 'vocab/security.jpg',
      cena:
        'The security screening lane of an airport: grey plastic trays lined up on the roller table running into the ' +
        'mouth of the X-ray machine, photographed from the side at table height from a normal distance, the lane ' +
        'empty and the hall softly out of focus behind it. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    // ---------------------------------------------------------------- M3A2
    {
      endereco: 'vocab/aisle.jpg',
      cena:
        'The aisle of an airliner cabin seen from standing height at the front, running straight away between the two ' +
        'blocks of empty seats, the overhead lockers closed, soft daylight from the small windows on both sides. ' +
        'Nobody in the aisle. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      // A CABINE, NÃO O HOTEL — o defeito S8 da varredura de 25/07.
      //
      // Os cards `blanket` e `pillow` do M3A2 apontavam para `vocab/blanket.jpg`
      // e `vocab/pillow.jpg`, que são a cama de um QUARTO DE HOTEL (colcha
      // dobrada no pé da cama, dois travesseiros na cabeceira). No M4A2, que é a
      // aula de hospedagem, elas estão certas e continuam onde estão — o que
      // estava errado era o M3A2 pedir um cobertor a bordo e mostrar um quarto.
      //
      // Daí o par `-cabin`: mesma palavra, outro lugar. O que faz a foto ser de
      // avião não é dizer "avião", é o que aparece em volta — a poltrona, o
      // cinto, a janelinha oval, a luz fria da cabine.
      endereco: 'vocab/blanket-cabin.jpg',
      cena:
        'A thin folded travel blanket in plain grey-blue fleece lying across the seat cushion of an empty airliner ' +
        'seat, the lap belt loose on either side of it and the oval cabin window just beyond, photographed from the ' +
        'aisle at seat height from a normal distance in the cool even light of the cabin so the folded blanket fills ' +
        'the MIDDLE of the frame. Nobody in the seat. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      // O bloco da tripulação mora no `comum.ts` porque a cena do serviço a
      // bordo do M3A2 usa o mesmo: pessoa uniformizada é onde este modelo cola
      // marca, brasão e crachá sozinho.
      //
      // ⚠️ SEGUNDA VERSÃO (varredura de 25/07). A primeira dizia "standing in
      // the MIDDLE of the frame" e o modelo entendeu MEIO HORIZONTAL: a
      // comissária saiu de corpo inteiro, de pé, com a cabeça no alto do quadro.
      // Na fatia do card (os ~45% do meio da ALTURA) sobra o tronco e o
      // carrinho, e ela aparece DECAPITADA — confirmado a olho no deck. O
      // conserto não é "centralize", é dizer de que ALTURA se fotografa: da
      // poltrona, olhando para cima, a cabeça dela cai na metade da altura do
      // quadro e não no topo.
      endereco: 'vocab/crew.jpg',
      cena:
        'A cabin crew member leaning in over the drinks trolley in the aisle of an airliner, photographed from the ' +
        'passenger’s seat looking slightly UP at her, from a normal conversational distance, so that she is seen ' +
        'from the waist up and her HEAD and SHOULDERS fall on the middle line of the picture, halfway down the ' +
        'height of the frame — never at the top edge, never cut by it. Above her head there is only the cabin ' +
        'ceiling and the closed overhead lockers; the trolley and her hands are at the bottom of the frame and the ' +
        'rows of seats fall softly out of focus behind her. ',
      restricao: `${TRIPULACAO_GENERICA.trim()} No close-up of hands.`,
    },
    {
      endereco: 'vocab/headphones.jpg',
      cena:
        'A pair of plain over-ear headphones lying on the open tray table of an airliner seat, the cabin window and ' +
        'its soft daylight behind them, photographed from a normal distance and slightly above. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      // O irmão do `blanket-cabin` acima, e pelo mesmo motivo: o travesseiro que
      // a aluna pede a bordo é o retangulinho da poltrona, não os dois
      // travesseiros de hotel da `vocab/pillow.jpg` (que segue certa no M4A2).
      endereco: 'vocab/pillow-cabin.jpg',
      // ⚠️ A primeira candidata devolveu a CAPA DE APOIO DE CABEÇA — um pano
      // liso caído sobre o encosto — e não um travesseiro: no card lia como
      // "pano numa poltrona". O que faz um travesseiro ser travesseiro na
      // fotografia é o VOLUME, e volume se manda desenhar: cheio, macio,
      // estufado, com a costura em volta e o vinco de quem apoiou a cabeça.
      cena:
        'A small plump rectangular pillow — soft, thick and clearly stuffed, with a rounded padded edge and a seam ' +
        'running all the way round it, in a plain grey-blue cotton cover — resting on the seat cushion of an empty ' +
        'airliner seat and propped against the armrest, the oval cabin window just beyond it. Photographed from the ' +
        'aisle at seat height from close in, in the cool even light of the cabin, so the pillow is LARGE and fills ' +
        'the MIDDLE of the frame and its thickness is obvious. It is a real pillow with body and volume, never a ' +
        'flat cloth, never a folded blanket and never a cover draped over the seat back. Nobody in the seat. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/seat-belt.jpg',
      cena:
        'The fastened lap belt of an empty airliner seat, its metal buckle closed in the middle of the seat cushion, ' +
        'photographed straight down from a normal distance in the soft light of the cabin. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/snack.jpg',
      cena:
        'A small in-flight snack on the open tray table of an airliner seat: a bread roll on a plain paper napkin ' +
        'beside a plastic cup of juice, photographed from a normal distance and slightly above, the cabin window soft ' +
        'behind them. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/tray-table.jpg',
      cena:
        'The empty tray table of an airliner seat, folded down from the seat back in front and clean, photographed ' +
        'from the passenger’s seat at a normal distance, the cabin window and its daylight softly out of focus beside ' +
        'it. Nothing on the tray. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    // ---------------------------------------------------------------- M3A3
    {
      endereco: 'vocab/baggage-tag.jpg',
      cena:
        'The printed paper baggage tag looped around the handle of a suitcase standing on an airport floor, the tag ' +
        'hanging in the MIDDLE of the frame and photographed close from the side, the hall softly out of focus behind. ',
      restricao:
        'The tag is seen at a shallow angle and slightly off the plane of focus, so its print reads as soft grey bars ' +
        'and blocks rather than as words: no readable text anywhere on it. ' + TEXTO_DE_DOCUMENTO,
    },
    {
      endereco: 'vocab/cancelled.jpg',
      cena:
        'A large dark flight information board on the wall of an airport hall, photographed square-on from a few ' +
        'metres back so the board fills the MIDDLE of the frame, the hall softly out of focus around it. ',
      restricao: painelQueEnsina(
        'Exactly three rows are filled in, each with a plain city name in the left column and one single word in the ' +
          'right column: LISBON CANCELLED, MADRID CANCELLED, ROME CANCELLED. Every other row on the board is empty.',
      ),
    },
    {
      endereco: 'vocab/connection.jpg',
      cena:
        'The overhead direction sign of an airport transfer corridor, hanging from the ceiling above the walkway, ' +
        'photographed from several metres back and straight on, so the sign hangs in the MIDDLE of the frame with the ' +
        'ceiling above it and the floor below it, a traveller far away and softly out of focus beneath it. ',
      restricao: placaEmFoco('the single word CONNECTIONS beside a plain white arrow'),
    },
    {
      endereco: 'vocab/delayed.jpg',
      cena:
        'A large dark flight information board on the wall of an airport hall, photographed square-on from a few ' +
        'metres back so the board fills the MIDDLE of the frame, the hall softly out of focus around it. ',
      restricao: painelQueEnsina(
        'Exactly three rows are filled in, each with a plain city name in the left column and one single word in the ' +
          'right column: LISBON DELAYED, MADRID DELAYED, ROME DELAYED. Every other row on the board is empty.',
      ),
    },
    {
      endereco: 'vocab/gate-change.jpg',
      cena:
        'A large dark flight information board on the wall of an airport hall, photographed square-on from a few ' +
        'metres back so the board fills the MIDDLE of the frame, the hall softly out of focus around it. ',
      restricao: painelQueEnsina(
        'Exactly two rows are filled in, each with a plain city name in the left column and two words in the right ' +
          'column: LISBON GATE CHANGE and MADRID GATE CHANGE. Every other row on the board is empty.',
      ),
    },
    {
      endereco: 'vocab/help-desk.jpg',
      cena:
        'The information desk of an airport hall: a plain counter with a member of staff behind it in plain dark ' +
        'clothing, head turned towards their work and softly out of the plane of focus, and the lit panel above the ' +
        'counter. Photographed from the traveller’s side at a normal conversational distance, so the counter and the ' +
        'panel together fill the MIDDLE of the frame. ',
      restricao: placaEmFoco('the single word INFORMATION'),
    },
    {
      endereco: 'vocab/lost-and-found.jpg',
      cena:
        'A small airport lost property counter with shelves of unclaimed bags and suitcases behind it, nobody at the ' +
        'counter, the panel above it lit. Photographed straight on from a normal distance so the counter and the ' +
        'panel together fill the MIDDLE of the frame. ',
      restricao: placaEmFoco('the words LOST AND FOUND'),
    },
    {
      // ABSTRATA. "O próximo voo" é o avião que está ali fora esperando: é
      // assim que a passageira o vê da sala de embarque.
      endereco: 'vocab/next-flight.jpg',
      cena:
        'Seen from the seating area of an airport gate: through the tall terminal window a plain white airliner stands ' +
        'parked at its jet bridge in the afternoon light, the gate desk in front of the window, photographed at ' +
        'standing height from a normal distance so the aircraft sits in the MIDDLE of the frame. ',
      restricao:
        'The aircraft is plain white with no airline livery, no name, no logo, no emblem, no flag and no registration ' +
        'lettering anywhere on it. ' + PLACAS_AO_FUNDO,
    },
  ],

  /**
   * M4 — o hotel: check-in (A1), pedidos no quarto (A2), o que quebra (A3) e o
   * check-out (A4). Vinte e nove cards, seis deles PAPEL — e papel é onde o
   * modelo inventa garrancho, daí o `LINHA_DE_CONTA` em todos eles com a única
   * linha nítida ditada por escrito.
   *
   * Quatro endereços deste módulo são compartilhados e moram aqui porque é aqui
   * que a palavra é ensinada primeiro: `blanket` e `pillow` (o M3 os usa na
   * cabine), `hanger` (o M7 usa no provador) e `receipt`/`bill` (M6 e M7).
   */
  m4: [
    // ---------------------------------------------------------------- M4A1
    {
      endereco: 'vocab/city-tax.jpg',
      cena:
        'A single printed hotel bill lying on the pale wooden reception counter of a small hotel, photographed ' +
        'straight from above at a normal distance in soft daylight. Nothing else on the counter. ',
      restricao: LINHA_DE_CONTA('One line on it reads CITY TAX followed by a plain, correctly formed amount.'),
    },
    {
      endereco: 'vocab/deposit.jpg',
      cena:
        'A plain matte payment card standing in the slot of a small card terminal on the pale wooden reception counter ' +
        'of a small hotel, photographed at counter height from the guest’s side at a normal distance. ',
      restricao:
        'The card is plain and blank: no bank name, no company name, no logo, no emblem, no flag, no embossed numbers ' +
        'and no lettering of any kind on it. The terminal’s screen is dark and empty and the terminal itself carries ' +
        'no brand name. ' + PLACAS_AO_FUNDO,
    },
    {
      endereco: 'vocab/front-desk.jpg',
      cena:
        'The reception counter of a small hotel seen from the guest’s side at a normal distance: a pale wooden counter ' +
        'with a small brass desk bell and a lamp on it, the pigeonholes and the calm lobby softly out of focus behind. ' +
        'Nobody behind the counter. ',
    },
    {
      endereco: 'vocab/guest.jpg',
      cena:
        'A traveller standing at a hotel reception counter with a suitcase beside them, seen from a few steps behind ' +
        'and to one side at a normal distance, in plain ordinary clothes, head turned towards the counter and softly ' +
        'out of the plane of focus. Never posing, never looking at the camera. ',
      restricao:
        'Nothing on the person or the counter identifies a real company or a real place: no logo, no brand name, no ' +
        'badge, no name tag, no emblem and no flag anywhere in the frame. ' + PLACAS_AO_FUNDO,
    },
    {
      endereco: 'vocab/key-card.jpg',
      cena:
        'A single plain white plastic hotel key card lying on a pale wooden bedside table beside a small lamp, ' +
        'photographed from slightly above at a normal distance in soft daylight. Nothing else on the table. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      // ABSTRATA. "Diárias" se resolve pela SITUAÇÃO, não por símbolo: o quarto
      // à noite é o que a aluna compra quando reserva três noites.
      //
      // ⚠️ SEGUNDA VERSÃO (varredura de 25/07). A primeira ficou a foto MAIS
      // ESCURA de toda a biblioteca (brilho médio 52 de 255): uma luminária
      // acesa num canto e o resto do quarto no breu. Isolada ela é bonita; no
      // card, que é uma fatia pequena, ela lê como um retângulo preto e a aluna
      // não vê quarto nenhum.
      //
      // O conserto não é "clarear" — é ACENDER O QUARTO na cena: quem escolhe a
      // exposição é o que está ligado. Três fontes acesas e roupa de cama branca
      // dão à foto um meio-tom de verdade e ela continua sendo NOITE, porque o
      // que diz noite é a janela escura, não a falta de luz dentro.
      endereco: 'vocab/nights.jpg',
      cena:
        'A hotel room in the evening with its lights ON, seen from the doorway: a neatly made double bed in crisp ' +
        'white linen filling the MIDDLE of the frame, both bedside lamps lit, the ceiling light on as well and the ' +
        'whole room clearly and evenly visible from wall to wall — an ordinary well-lit room at the end of the day, ' +
        'never a dark room, never a single lamp in the black, never deep shadow across the bed. Through the window ' +
        'behind the bed the night city shows as small distant lights, and that dark window is the only dark thing in ' +
        'the picture. Photographed at standing height from a normal distance. Nobody in the room. ',
    },
    {
      endereco: 'vocab/receipt.jpg',
      cena:
        'A small narrow till receipt curling on the pale wooden counter of a hotel reception, photographed close and ' +
        'straight from above in soft daylight. Nothing else on the counter. ',
      restricao: LINHA_DE_CONTA('One line on it reads TOTAL followed by a plain, correctly formed amount.'),
    },
    {
      endereco: 'vocab/reservation.jpg',
      cena:
        'A large paper reservation book lying open on the pale wooden reception counter of a small hotel, a pen ' +
        'resting across the page, photographed from slightly above at a normal distance in soft daylight. ',
      restricao:
        'The open pages show only plain empty ruled boxes and columns, with no handwriting and no printed words on ' +
        'them at all. ' + TEXTO_DE_DOCUMENTO,
    },
    // ---------------------------------------------------------------- M4A2
    {
      endereco: 'vocab/adapter.jpg',
      cena:
        'A single white travel plug adapter lying on a plain pale wooden table by a window, photographed close and ' +
        'from slightly above in soft daylight, its pins and sockets clearly visible. Nothing else on the table. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/blanket.jpg',
      cena:
        'A thick folded wool blanket lying across the foot of a made hotel bed, photographed from a normal distance ' +
        'and slightly above in soft daylight so the folded blanket fills the MIDDLE of the frame. ',
    },
    {
      endereco: 'vocab/hanger.jpg',
      cena:
        'Three wooden clothes hangers on the rail of an open hotel wardrobe, one of them carrying a plain white shirt, ' +
        'photographed straight on at rail height from a normal distance so the hangers fill the MIDDLE of the frame. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/pillow.jpg',
      cena:
        'Two plump white pillows propped against the headboard of a neatly made hotel bed, photographed straight on ' +
        'from a normal distance in soft morning daylight so the pillows fill the MIDDLE of the frame. ',
    },
    {
      endereco: 'vocab/soap.jpg',
      cena:
        'A small plain bar of soap resting on a folded white flannel beside a white ceramic basin in a hotel bathroom, ' +
        'photographed close and from slightly above in soft daylight. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/towel.jpg',
      cena:
        'A neat stack of folded white towels on a wooden shelf in a hotel bathroom, photographed straight on at shelf ' +
        'height from a normal distance so the towels fill the MIDDLE of the frame. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/wake-up-call.jpg',
      cena:
        'An ordinary corded telephone standing on a pale wooden hotel bedside table beside a lamp, photographed from ' +
        'a normal distance and slightly above in the first light of the morning. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      // ABSTRATA. Senha não é objeto: é o cartãozinho que o hotel deixa na
      // mesa de cabeceira — e a senha em si não pode ser lida.
      endereco: 'vocab/wifi-password.jpg',
      cena:
        'A small printed card propped on a pale wooden hotel bedside table beside a lamp, photographed close and ' +
        'straight on in soft daylight so the card sits in the MIDDLE of the frame. ',
      restricao:
        'The card carries at most the words WI-FI PASSWORD in plain capitals, correctly spelled, and the line under ' +
        'them is a plain empty ruled bar with no characters on it. ' + TEXTO_DE_DOCUMENTO,
    },
    // ---------------------------------------------------------------- M4A3
    {
      endereco: 'vocab/air-conditioning.jpg',
      cena:
        'A wall-mounted split air conditioning unit high on the wall of a plain hotel room, its louvres open, ' +
        'photographed straight on from a normal distance at unit height so the unit sits in the MIDDLE of the frame ' +
        'with plain wall around it. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/broken.jpg',
      cena:
        'The door handle of a hotel room hanging loose and broken from the door, its screws out of the plate, ' +
        'photographed straight on at handle height from a normal distance so the broken handle sits in the MIDDLE of ' +
        'the frame against the plain door. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/dirty.jpg',
      cena:
        'A crumpled, stained white towel lying on the tiled floor of a hotel bathroom beside the bath, the tiles ' +
        'smeared and unclean, photographed from a normal distance and slightly above so the towel fills the MIDDLE of ' +
        'the frame. ',
    },
    {
      endereco: 'vocab/heating.jpg',
      cena:
        'A white panel radiator under the window of a plain hotel room, its thermostat valve at one end, photographed ' +
        'straight on from a normal distance at radiator height so the radiator fills the MIDDLE of the frame. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/hot-water.jpg',
      cena:
        'Steaming hot water running from a chrome tap into a white ceramic basin in a bathroom, the steam rising in ' +
        'the daylight, photographed close and from slightly above so the tap and the running water fill the MIDDLE of ' +
        'the frame. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      // ABSTRATA. Barulho se fotografa pela JANELA: é por ela que ele entra.
      endereco: 'vocab/noisy.jpg',
      cena:
        'The window of a dark hotel room at night, the curtains open onto a busy lit street below with traffic and ' +
        'roadworks, photographed from inside the unlit room at a normal distance so the bright window fills the ' +
        'MIDDLE of the frame. Nobody in the room. ',
    },
    {
      endereco: 'vocab/shower.jpg',
      cena:
        'A chrome shower head running water against plain tiled walls in a bathroom, photographed straight on from a ' +
        'normal distance so the shower head and the falling water sit in the MIDDLE of the frame. Nobody in the ' +
        'shower. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    // ---------------------------------------------------------------- M4A4
    {
      endereco: 'vocab/bill.jpg',
      cena:
        'A single folded sheet of printed hotel bill lying on the pale wooden reception counter of a small hotel, a ' +
        'pen beside it, photographed straight from above at a normal distance in soft daylight. ',
      restricao: LINHA_DE_CONTA('One line on it reads TOTAL followed by a plain, correctly formed amount.'),
    },
    {
      endereco: 'vocab/check-out.jpg',
      cena:
        'A packed suitcase standing upright beside the pale wooden reception counter of a small hotel in the morning, ' +
        'a plain white key card lying on the counter above it, photographed at a normal distance so the suitcase and ' +
        'the counter fill the MIDDLE of the frame. Nobody in the lobby. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/extra-charge.jpg',
      cena:
        'A single printed hotel bill lying on the pale wooden reception counter of a small hotel, photographed ' +
        'straight from above at a normal distance in soft daylight. Nothing else on the counter. ',
      restricao: LINHA_DE_CONTA('One line on it reads EXTRA CHARGE followed by a plain, correctly formed amount.'),
    },
    {
      // ABSTRATA. "Incluído" só existe DENTRO de uma conta — é onde a aluna vai
      // encontrar a palavra e é a única imagem honesta dela.
      endereco: 'vocab/included.jpg',
      cena:
        'A single printed hotel bill lying on the pale wooden reception counter of a small hotel, photographed ' +
        'straight from above at a normal distance in soft daylight. Nothing else on the counter. ',
      restricao: LINHA_DE_CONTA(
        'One line on it reads BREAKFAST and, on the same line where the amount would be, the single word INCLUDED.',
      ),
    },
    {
      endereco: 'vocab/late-check-out.jpg',
      cena:
        'A single printed hotel bill lying on the pale wooden reception counter of a small hotel, photographed ' +
        'straight from above at a normal distance in soft daylight. Nothing else on the counter. ',
      restricao: LINHA_DE_CONTA('One line on it reads LATE CHECK OUT followed by a plain, correctly formed amount.'),
    },
    {
      endereco: 'vocab/luggage-storage.jpg',
      cena:
        'A hotel luggage store room seen through its open door: suitcases and travel bags standing together on plain ' +
        'wooden racks, photographed at a normal distance so the racks and the bags fill the MIDDLE of the frame. ' +
        'Nobody in the room. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
  ],

  /**
   * M5A2 — "Signs & Maps: Understand the City". Dezesseis cards em duas telas, e
   * a primeira delas é a exceção que o dono ratificou por escrito.
   *
   * **A PLACA É O ASSUNTO.** Oito das dezesseis são as palavras que a aluna vai
   * LER na parede — EXIT, PUSH, PULL, OPEN, CLOSED, NO ENTRY, OUT OF ORDER — e
   * uma foto de placa em branco não ensina nada: seria o card dizendo "olhe esta
   * superfície lisa". A régua é a mesma do `painelQueEnsina` do M3, na terceira
   * posição da política de placas: o modelo erra o que INVENTA e acerta a palavra
   * curta que se MANDA escrever, e por isso cada uma delas passa pelo
   * `placaEmFoco`, com a palavra ditada letra a letra.
   *
   * O que muda entre as oito é o LUGAR — instrução literal do dono: cada palavra
   * no contexto em que ela realmente aparece. Não é enfeite: oito retângulos de
   * chapa fotografados igual seriam o defeito do M3A3 (cinco painéis escuros que
   * leem como a mesma foto) de volta, agora com oito.
   *
   * As outras oito são a cidade em si (rua, avenida, praça, esquina, quarteirão,
   * faixa, calçada) mais o mapa de papel. Aqui o risco é o inverso e é o mesmo de
   * sempre: sete fotos de rua europeia viram sete vezes a mesma foto. Cada uma
   * ataca o seu termo por uma GEOMETRIA diferente — o comprimento da rua, a
   * largura da avenida, a abertura da praça, o ângulo da esquina, a fileira do
   * quarteirão, as listras no asfalto, a linha do meio-fio.
   */
  m5: [
    // ------------------------------------------------------- M5A2 s4: as placas
    {
      endereco: 'vocab/sign-exit.jpg',
      cena:
        'The illuminated green exit sign mounted on the wall just above a plain doorway in an ordinary public ' +
        'building, photographed straight on from a few metres back at sign height, so the lit sign and the top of ' +
        'the door frame under it fill the MIDDLE of the frame, the corridor beyond softly out of focus. ',
      restricao: placaEmFoco('the single word EXIT beside a plain white running-figure symbol'),
    },
    {
      endereco: 'vocab/sign-entrance.jpg',
      cena:
        'The sign over the glass entrance doors of an ordinary shop, fixed to the façade just above the doorway, ' +
        'photographed straight on from the pavement a few steps back so the sign sits in the MIDDLE of the frame ' +
        'with the glass doors below it and the plain façade around it, the street softly out of focus. ',
      restricao: placaEmFoco('the single word ENTRANCE'),
    },
    {
      endereco: 'vocab/sign-push.jpg',
      cena:
        'The small brushed metal plate screwed to the glass door of a café at hand height, next to a flat push plate, ' +
        'photographed straight on and close from outside so the little plate sits squarely in the MIDDLE of the ' +
        'frame, the inside of the café softly out of focus through the glass. ',
      restricao: placaEmFoco('the single word PUSH'),
    },
    {
      endereco: 'vocab/sign-pull.jpg',
      cena:
        'The small brushed metal plate screwed to the glass door of a café at hand height, just above a long vertical ' +
        'pull handle, photographed straight on and close from outside so the little plate and the top of the handle ' +
        'sit in the MIDDLE of the frame, the inside of the café softly out of focus through the glass. ',
      restricao: placaEmFoco('the single word PULL'),
    },
    {
      endereco: 'vocab/sign-open.jpg',
      cena:
        'A small hanging card on a cord inside the glass door of a shop, turned to face the street, photographed ' +
        'straight on and close from the pavement so the card hangs in the MIDDLE of the frame; behind the glass the ' +
        'shop is lit and working and falls softly out of focus. ',
      restricao: placaEmFoco('the single word OPEN'),
    },
    {
      endereco: 'vocab/sign-closed.jpg',
      cena:
        'A small hanging card on a cord inside the glass door of a shop, turned to face the street, photographed ' +
        'straight on and close from the pavement so the card hangs in the MIDDLE of the frame; behind the glass the ' +
        'shop is dark and empty and the interior lights are off. ',
      restricao: placaEmFoco('the single word CLOSED'),
    },
    {
      endereco: 'vocab/sign-no-entry.jpg',
      cena:
        'A plain rectangular sign fixed at eye level on a closed service door at the end of a quiet corridor in a ' +
        'public building, photographed straight on from a few steps back so the sign sits in the MIDDLE of the frame ' +
        'against the plain door, the corridor floor and walls falling softly out of focus around it. ',
      restricao: placaEmFoco('the two words NO ENTRY'),
    },
    {
      endereco: 'vocab/sign-out-of-order.jpg',
      cena:
        'A printed paper notice taped at eye level across the front of a ticket machine on a station platform, ' +
        'photographed straight on and close so the taped notice and the dark screen of the machine behind it fill ' +
        'the MIDDLE of the frame, the platform softly out of focus. ',
      restricao: placaEmFoco('the three words OUT OF ORDER'),
    },

    // -------------------------------------------------------- M5A2 s5: a cidade
    {
      // COMPRIMENTO. A rua é estreita e se vê ENFIADA — é o que a separa da
      // avenida, que é larga e se vê ABERTA.
      endereco: 'vocab/street.jpg',
      cena:
        'A narrow ordinary city street seen along its length from the middle of the empty roadway: a strip of ' +
        'cobbles running away between two rows of low painted houses that lean in on both sides, the far end of the ' +
        'street dissolving softly out of focus. The cobbles and the two rows of façades run across the MIDDLE of ' +
        'the frame and fill it from edge to edge. ' +
        O_LUGAR_E_O_ASSUNTO,
    },
    {
      // LARGURA. A dupla fileira de árvores é a única coisa que faz uma avenida
      // ser reconhecível como avenida numa fotografia.
      endereco: 'vocab/avenue.jpg',
      cena:
        'A wide city avenue seen along its length from the middle of its central walkway: a broad open way with a ' +
        'double row of tall trees planted down both sides and a generous pavement beyond them, the far end open and ' +
        'softly out of focus. The two rows of tree trunks and the way running between them fill the MIDDLE of the ' +
        'frame from edge to edge. ' +
        O_LUGAR_E_O_ASSUNTO,
    },
    {
      // ABERTURA. Praça é o vazio no meio — daí a câmera baixa e o chão largo.
      endereco: 'vocab/square.jpg',
      cena:
        'An open paved city square photographed from one of its corners at standing height: a wide expanse of pale ' +
        'paving stones with a plain stone fountain and a few wooden benches in the middle of it, the low façades of ' +
        'the buildings closing the square in behind, a handful of people crossing far away and softly out of focus. ' +
        'The fountain and the benches sit in the MIDDLE of the frame. ',
    },
    {
      // ÂNGULO. O que faz uma esquina ser esquina é o VÉRTICE do prédio — as duas
      // fachadas se encontrando numa aresta vertical no meio do quadro.
      endereco: 'vocab/corner.jpg',
      cena:
        'The corner of a city block photographed from the pavement across the junction: the rounded corner of one ' +
        'building standing in the MIDDLE of the frame with its two façades running away to the left and to the ' +
        'right, a street opening on either side of it and the kerb curving around its foot. ',
      // ⚠️ A primeira candidata trouxe DOIS roundels do metrô de Londres —
      // círculo vermelho com a barra azul — nítidos o bastante para se
      // reconhecer. É emblema de uma agência real, que é o `marca` da régua, e a
      // conferência deixou passar por serem pequenos. Placa de transporte é o
      // logotipo que este modelo cola sozinho numa esquina, então ela é nomeada.
      restricao:
        'No transport roundel, no metro or underground symbol, no bus-stop emblem, no city crest, no flag and no ' +
        'agency badge appears anywhere in the frame: the street furniture is plain painted metal and the signs on ' +
        'the poles are plain blank plates. ' + PLACAS_AO_FUNDO,
    },
    {
      // FILEIRA. Quarteirão é a extensão entre duas esquinas, e só se vê de LADO,
      // de frente para a fachada inteira.
      endereco: 'vocab/block.jpg',
      cena:
        'One whole city block seen square-on from the opposite pavement: an unbroken row of joined four-storey ' +
        'houses running right across the frame from one street corner to the other, the road and the parked cars ' +
        'along its foot, the crossing streets visible at both ends of the row. The row of façades fills the MIDDLE ' +
        'of the frame. ',
    },
    {
      // LISTRAS. A faixa tem de estar DEITADA no quadro, atravessando o meio, e
      // não fugindo para o fundo: é assim que ela sobrevive à fatia do card.
      endereco: 'vocab/crosswalk.jpg',
      cena:
        'A zebra crossing photographed from the kerb looking across the road: the broad white painted stripes lying ' +
        'right across the MIDDLE of the frame from one side to the other on the grey asphalt, the opposite pavement ' +
        'and the buildings beyond it softly out of focus, no traffic and nobody crossing. ',
    },
    {
      // LINHA. Calçada é a faixa entre o meio-fio e a parede — e é a LINHA DO
      // MEIO-FIO que a nomeia.
      endereco: 'vocab/sidewalk.jpg',
      cena:
        'An empty city pavement seen along its length from standing height at its edge: the paving slabs and the ' +
        'raised granite kerb running away side by side through the MIDDLE of the frame, the plain shopfronts along ' +
        'one side and the kerb and the road along the other, the far end of the pavement dissolving softly out of ' +
        'focus. Nothing is parked on the pavement and nobody is walking on it. ' +
        O_LUGAR_E_O_ASSUNTO,
    },
    {
      // O OBJETO. A `vocab/purpose.jpg` já resolveu o mapa de papel do mesmo
      // jeito, e pelo mesmo motivo: nome de lugar dentro da imagem é o defeito
      // mais caro do projeto, e um mapa é feito de nomes de lugar.
      endereco: 'vocab/map.jpg',
      cena:
        'A folded paper city map opened out and pressed flat on a plain pale wooden table, photographed STRAIGHT ' +
        'DOWN from directly overhead and from close in, so that the open sheet is LARGE and fills almost the whole ' +
        'picture from edge to edge with only a little bare table showing around it, its fold creases still marking ' +
        'the paper, in soft even daylight. The camera looks squarely down at the paper — never across the table at ' +
        'a low angle, never with a window, a room or a street behind it. Nothing else on the table. ',
      restricao:
        'The map shows only plain coloured shapes, blocks and lines — the pale blocks of the buildings, the white ' +
        'ribbons of the streets, a blue band of water, a patch of green — with no place names, no street names, no ' +
        'legend, no numbers and no lettering of any kind printed anywhere on it. ' + PLACAS_AO_FUNDO,
    },
  ],

  /**
   * M6 — comer fora: o cardápio (A1), como pedir (A2) e o que dá errado (A3).
   *
   * Vinte e dois cards, e a régua da família já estava escrita: as nove fotos de
   * comida do M6 que o dono aprovou (`soup`, `rice`, `salad`, `bread`…) são
   * todas o prato SOBRE a mesa de madeira clara, luz de janela, distância de
   * quem vai comer. As novas seguem literalmente essa fórmula — é o módulo em
   * que destoar salta mais aos olhos, porque os cards ficam lado a lado.
   */
  m6: [
    // ---------------------------------------------------------------- M6A1
    {
      endereco: 'vocab/beef.jpg',
      cena:
        'A cooked steak of beef on a plain white plate, a knife and fork beside it on the pale wooden table, ' +
        MESA_DO_M6,
    },
    {
      endereco: 'vocab/beer.jpg',
      cena:
        'A tall glass of pale beer with its head of foam on a pale wooden table, ' +
        MESA_DO_M6,
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/fish.jpg',
      cena:
        'A cooked fillet of white fish on a plain white plate with half a lemon and a sprig of herbs, on a pale ' +
        'wooden table, ' +
        MESA_DO_M6,
    },
    {
      endereco: 'vocab/sparkling-water.jpg',
      cena:
        'A glass of sparkling water full of rising bubbles beside a plain green glass bottle on a pale wooden ' +
        'table, ' +
        MESA_DO_M6,
      restricao:
        'The bottle carries no label at all — plain green glass and nothing else — and there is no brand name, no ' +
        'logo and no lettering anywhere in the frame. ' + PLACAS_AO_FUNDO,
    },
    {
      endereco: 'vocab/tea.jpg',
      cena:
        'A cup of black tea on its saucer beside a small ceramic teapot on a pale wooden table, ' +
        MESA_DO_M6,
    },
    // ---------------------------------------------------------------- M6A2
    {
      endereco: 'vocab/bakery.jpg',
      cena:
        'The counter of a small bakery seen from the customer’s side at a normal distance: loaves of bread and ' +
        'pastries arranged in the glass case and in baskets on the counter, the shop warm and softly out of focus ' +
        'behind. ',
      restricao: EMBALAGEM_NEUTRA,
    },
    {
      endereco: 'vocab/buffet.jpg',
      cena:
        'A hotel breakfast buffet counter: open trays and bowls of food in a row with serving tongs beside them, ' +
        'photographed from the guest’s side at counter height from a normal distance, the dining room softly out of ' +
        'focus behind. Nobody at the counter. ',
      restricao: EMBALAGEM_NEUTRA,
    },
    {
      endereco: 'vocab/cafe.jpg',
      cena:
        'The inside of a small café seen from the door at a normal distance: the counter with its coffee machine and ' +
        'a few wooden tables, warm daylight through the window, the room calm and nearly empty. ',
      restricao: EMBALAGEM_NEUTRA,
    },
    {
      endereco: 'vocab/drinks.jpg',
      cena:
        'Four different drinks together on a pale wooden table — a glass of juice, a glass of water, a cup of ' +
        'coffee and a glass of beer — arranged close together as one compact group, ' +
        MESA_DO_M6,
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/food-truck.jpg',
      cena:
        'A street food truck parked at the kerb with its serving hatch open, seen straight on from a few steps back ' +
        'at a normal distance, the street behind it softly out of focus. ',
      restricao:
        'The truck is painted in one plain flat colour and carries no name, no menu board, no logo, no emblem and no ' +
        'lettering of any kind on its bodywork. ' + PLACAS_AO_FUNDO,
    },
    {
      endereco: 'vocab/menu.jpg',
      cena:
        'A printed paper menu lying open on the pale wooden table of a restaurant beside a folded napkin, ' +
        MESA_DO_M6,
      restricao: LINHA_DE_CONTA('The heading at the top of the page reads the single word MENU.'),
    },
    {
      endereco: 'vocab/restaurant.jpg',
      cena:
        'The inside of a small restaurant seen from the door at a normal distance: laid tables with glasses and ' +
        'napkins, wooden chairs, warm evening light, the room calm and nearly empty. ',
      restricao: EMBALAGEM_NEUTRA,
    },
    // ---------------------------------------------------------------- M6A3
    {
      endereco: 'vocab/card-machine.jpg',
      cena:
        'A small handheld card payment terminal lying on the pale wooden table of a restaurant beside the folded ' +
        'paper bill, ' +
        MESA_DO_M6,
      restricao:
        'The terminal’s screen is dark and empty and the terminal carries no brand name, no logo and no lettering; ' +
        'the folded paper beside it shows no readable text. ' + PLACAS_AO_FUNDO,
    },
    {
      endereco: 'vocab/cash.jpg',
      cena:
        'A few folded banknotes and a small pile of coins lying together on the pale wooden table of a café, ' +
        MESA_DO_M6,
      restricao:
        'The banknotes are seen at a shallow angle and slightly off the plane of focus, so their printing reads as ' +
        'soft engraved pattern rather than as words or figures: no country name, no portrait of a real person, no ' +
        'emblem, no coat of arms, no flag and no readable numerals anywhere on them, and the coins are plain ' +
        'unmarked metal. ' + TEXTO_DE_DOCUMENTO,
    },
    {
      endereco: 'vocab/check.jpg',
      cena:
        'The bill of a restaurant presented in an open dark leather folder on a pale wooden table, the printed ' +
        'slip inside it and a pen resting across the folder, ' +
        MESA_DO_M6,
      restricao: LINHA_DE_CONTA('One line on the slip reads TOTAL followed by a plain, correctly formed amount.'),
    },
    {
      endereco: 'vocab/eggs.jpg',
      cena:
        'Half a dozen brown and white eggs in a shallow ceramic bowl on a pale wooden table, one egg cracked open ' +
        'into a small dish beside the bowl, ' +
        MESA_DO_M6,
    },
    {
      endereco: 'vocab/milk.jpg',
      cena:
        'A glass jug of milk beside a full glass of milk on a pale wooden table, ' +
        MESA_DO_M6,
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/nuts.jpg',
      cena:
        'A shallow bowl of mixed nuts — walnuts, almonds and hazelnuts, some still in their shells — on a pale ' +
        'wooden table, a few spilled beside the bowl, ' +
        MESA_DO_M6,
    },
    {
      endereco: 'vocab/peanuts.jpg',
      cena:
        'A small bowl of shelled peanuts on a pale wooden table, a scatter of empty peanut shells beside it, ' +
        MESA_DO_M6,
    },
    {
      endereco: 'vocab/shellfish.jpg',
      cena:
        'A plate of cooked prawns and mussels with half a lemon beside them, on a pale wooden table, ' +
        MESA_DO_M6,
    },
    {
      endereco: 'vocab/tip.jpg',
      cena:
        'A few coins left on top of a folded paper bill on the pale wooden table of a café beside an empty coffee ' +
        'cup, ' +
        MESA_DO_M6,
      restricao:
        'The coins are plain unmarked metal and the folded paper under them shows no readable text: no country name, ' +
        'no emblem, no figures and no words anywhere in the frame. ' + TEXTO_DE_DOCUMENTO,
    },
    {
      endereco: 'vocab/wheat.jpg',
      cena:
        'A small bundle of ripe wheat ears lying on a pale wooden table beside a low heap of flour, ' +
        MESA_DO_M6,
    },
  ],

  /**
   * M7 — mercado (A1) e loja de roupa (A2). Doze cards, e o módulo inteiro é o
   * lugar onde MARCA mora: prateleira de mercado é uma parede de logotipos e
   * roupa de loja é etiqueta atrás de etiqueta. Por isso quase todo card daqui
   * leva `EMBALAGEM_NEUTRA` ou `SEM_MARCA_NO_OBJETO` — o defeito mais caro do
   * projeto (`patagonia` legível numa mochila) nasceu num card deste tipo.
   */
  m7: [
    // ---------------------------------------------------------------- M7A1
    {
      endereco: 'vocab/basket.jpg',
      cena:
        'A red plastic shopping basket with a few groceries in it, standing on the floor of a supermarket aisle, ' +
        'photographed at basket height from a normal distance, the aisle softly out of focus behind it. Nobody with ' +
        'the basket. ',
      restricao: EMBALAGEM_NEUTRA,
    },
    {
      endereco: 'vocab/shelf.jpg',
      cena:
        'A supermarket shelf seen straight on from a normal distance, its rows of plain boxes, tins and jars neatly ' +
        'lined up, the aisle softly out of focus at the edges of the frame. ',
      restricao: EMBALAGEM_NEUTRA,
    },
    {
      endereco: 'vocab/shopping-bag.jpg',
      cena:
        'Two plain brown paper shopping bags full of groceries standing together on a pale wooden kitchen table, ' +
        'photographed from a normal distance and slightly above in soft daylight. ',
      restricao: EMBALAGEM_NEUTRA,
    },
    {
      endereco: 'vocab/shopping-cart.jpg',
      cena:
        'An empty metal supermarket trolley standing alone in a supermarket aisle, photographed straight on at ' +
        'trolley height from a normal distance so the whole trolley sits in the MIDDLE of the frame, the shelves ' +
        'softly out of focus behind it. ',
      restricao: EMBALAGEM_NEUTRA,
    },
    {
      endereco: 'vocab/supermarket-checkout.jpg',
      cena:
        'A supermarket checkout lane seen from the customer’s side at a normal distance: groceries lined up on the ' +
        'moving conveyor belt towards the till, the cashier’s position beyond it softly out of focus. ',
      restricao: EMBALAGEM_NEUTRA,
    },
    // ---------------------------------------------------------------- M7A2
    {
      endereco: 'vocab/fitting-room.jpg',
      cena:
        'A row of fitting room cubicles in a clothes shop, their curtains half drawn and a wooden bench inside the ' +
        'open one, photographed straight on from a normal distance so the cubicle doorways fill the MIDDLE of the ' +
        'frame. Nobody in the frame. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/jacket.jpg',
      cena:
        'A single plain jacket hanging on a wooden hanger on a clothes rail in a shop, photographed straight on at ' +
        'rail height from a normal distance so the jacket fills the MIDDLE of the frame, the shop softly out of ' +
        'focus behind it. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/mirror.jpg',
      cena:
        // A primeira saiu lendo como PORTA: o espelho sem moldura e sem reflexo
        // nítido vira um retângulo claro na parede, e na fatia do card ninguém
        // reconhece um espelho. O que faz um espelho ser espelho na fotografia é
        // o REFLEXO — daí a moldura escura e o que ele devolve, ditos por escrito.
        'A tall full-length mirror in a dark wooden frame leaning against the wall of an empty fitting room, ' +
        'photographed straight on from close in so the framed glass is LARGE and fills the MIDDLE of the frame, ' +
        'clearly reflecting back the plain cubicle in front of it — its wooden bench, its hanging curtain and the ' +
        'lit ceiling — so that it is unmistakably a mirror and not a doorway. Nobody is in the room and no person ' +
        'is reflected in the glass. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/price-tag.jpg',
      cena:
        'A small cardboard price tag hanging on a string from the sleeve of a plain garment in a shop, photographed ' +
        'close and straight on at a normal distance so the tag sits in the MIDDLE of the frame, the garment and the ' +
        'shop softly out of focus behind it. ',
      restricao: LINHA_DE_CONTA('The tag carries one plain, correctly formed amount and nothing else.'),
    },
    {
      endereco: 'vocab/shirt.jpg',
      cena:
        'A plain folded cotton shirt lying on the wooden table of a clothes shop, photographed from a normal distance ' +
        'and slightly above in soft daylight. Nothing else on the table. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/shoes.jpg',
      cena:
        'A pair of plain leather shoes standing side by side on a wooden shop shelf, photographed straight on at ' +
        'shelf height from a normal distance so the shoes fill the MIDDLE of the frame. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/size-tag.jpg',
      cena:
        'The sewn fabric size label inside the collar of a plain folded shirt, the collar turned back on a wooden ' +
        'table so the small label sits in the MIDDLE of the frame, photographed close in soft daylight. ',
      restricao:
        'The label carries at most the single letter M in plain capitals, correctly formed, and nothing else: no ' +
        'brand name, no company name, no logo, no washing symbols and no lines of small print. Every other surface ' +
        'in the frame is plain and unmarked. ' + PLACAS_AO_FUNDO,
    },
    // ---------------------------------------------------------------- M7A4
    //
    // "Paying and finishing" — o único dos quatro slides julgados no lote de
    // 26/07 que FECHOU a régua do tudo-ou-nada. Três dos oito termos já tinham
    // endereço na biblioteca e são reaproveitados no JSON sem gerar nada
    // (`cash`, `credit-card` e `receipt`); os cinco abaixo são o que faltava.
    //
    // O que fez este slide fechar e os outros três não: aqui todo termo tem
    // REFERENTE. `discount` e `sale` não são o conceito de desconto — são a
    // etiqueta remarcada e o cartaz da vitrine, que é onde a aluna vai
    // encontrá-los. `change` é o troco na bandejinha do caixa. Nenhum precisou
    // de metáfora, e é isso que os separa de `refund`, `compensation` ou
    // `store credit`, que não têm o que fotografar.
    {
      // A palavra é a AÇÃO (aproximar), e a foto dela sem mão nenhuma: o cartão
      // pousado na face do leitor, com o símbolo das quatro ondinhas ao lado.
      // Mão fechada em volta de objeto é onde a anatomia quebra (o M9A4 perdeu
      // quatro candidatas assim) e aqui ela não é necessária.
      endereco: 'vocab/contactless.jpg',
      cena:
        'A plain unmarked payment card lying flat on the reader face of a small card terminal standing on a shop ' +
        'counter, photographed close and from slightly above at counter height so the card and the top of the ' +
        'terminal fill the MIDDLE of the frame, the counter and the shop softly out of focus behind. ',
      restricao:
        'The only mark anywhere in the frame is the plain four-arc contactless wave symbol moulded on the reader ' +
        'face beside the card. The card is blank — no bank name, no company name, no logo, no emblem, no embossed ' +
        'numbers and no lettering of any kind on it — and the terminal’s screen is dark and empty and carries no ' +
        'brand name. ' + PLACAS_AO_FUNDO,
    },
    {
      // Troco é o que VOLTA, e o que faz isso ler numa foto é a bandejinha do
      // caixa: moedas soltas numa cuba rasa não são troco, são moedas.
      endereco: 'vocab/change.jpg',
      cena:
        'A small shallow plastic change tray on the counter of a shop with a handful of loose coins and one folded ' +
        'banknote lying in it, photographed close and from slightly above at counter height so the tray and the ' +
        'coins fill the MIDDLE of the frame, the counter softly out of focus around it. ',
      restricao:
        'The banknote is folded and seen at a shallow angle off the plane of focus, so its printing reads as soft ' +
        'coloured pattern rather than as words or figures: no country name, no portrait of a real person, no ' +
        'emblem, no coat of arms, no flag and no readable numerals on it, and the coins are plain worn metal discs ' +
        'with no legible face. ' + PLACAS_AO_FUNDO,
    },
    {
      // Desconto é o preço RISCADO e o preço novo ao lado — os dois números
      // juntos são a palavra inteira. Sem o riscado, é só uma etiqueta de preço
      // (que já existe, na `vocab/price-tag.jpg`).
      endereco: 'vocab/discount.jpg',
      cena:
        'A small cardboard price ticket hanging on a string from the sleeve of a plain garment in a shop, ' +
        'photographed close and straight on at a normal distance so the ticket sits in the MIDDLE of the frame, the ' +
        'garment and the shop softly out of focus behind it. ',
      restricao: LINHA_DE_CONTA(
        'The ticket carries two plain, correctly formed amounts and nothing else: the first one struck through with ' +
          'a single straight line, and the lower one written beside it in red.',
      ),
    },
    {
      // Promoção é o CARTAZ DA VITRINE — a palavra que a aluna vê da calçada. É
      // a mesma régua das oito placas do M5A2: a palavra é o assunto.
      endereco: 'vocab/sale.jpg',
      cena:
        'A large printed poster stuck to the inside of a shop window, seen straight on from the pavement a couple of ' +
        'steps back so the poster fills the MIDDLE of the frame, the clothes on their rails behind the glass softly ' +
        'out of focus and a faint reflection of the street across it. ',
      restricao: placaEmFoco('the single word SALE in large plain capitals'),
    },
    {
      // "Till" é o CAIXA da loja pequena — de propósito outro lugar que a
      // `vocab/supermarket-checkout.jpg` (esteira de mercado) que já existe.
      endereco: 'vocab/till.jpg',
      cena:
        'The pay counter of a small shop seen from the customer’s side at a normal distance: a plain wooden counter ' +
        'with an old metal cash register on it, its drawer closed, a roll of paper bags and a small card terminal ' +
        'beside it, the shelves behind softly out of focus. Nobody behind the counter. ',
      restricao: EMBALAGEM_NEUTRA,
    },
  ],

  /**
   * M8A3 — hobbies e cultura. Oito cards, e todos são VERBOS: cozinhar, dançar,
   * ler, viajar. Verbo não é objeto, e a saída fácil (um ícone, um símbolo) é
   * justamente a que o dono proibiu. A régua aqui é a mesma das palavras
   * abstratas do M2: fotografa-se a SITUAÇÃO em que a pessoa faz aquilo, a uma
   * distância normal — nunca a mão em close, que é onde a anatomia quebra.
   */
  m8: [
    {
      endereco: 'vocab/cooking.jpg',
      cena:
        'A person cooking at a home kitchen counter, chopping vegetables on a wooden board with a pan on the hob ' +
        'beside them, seen from the waist up at a normal distance across the kitchen, head bent towards the work and ' +
        'softly out of the plane of focus. Never posing, never looking at the camera. ',
    },
    {
      endereco: 'vocab/dancing.jpg',
      cena:
        'Two people dancing together in a bright hall with a wooden floor, seen at full length from a normal distance ' +
        'across the room, mid-step and turned towards each other, their faces softly out of the plane of focus. ' +
        'Never posing, never looking at the camera. ',
    },
    {
      endereco: 'vocab/gardening.jpg',
      cena:
        'A person tending potted plants on a sunny balcony, a watering can in the hand and a row of terracotta pots ' +
        'along the rail, seen from the waist up at a normal distance, head bent towards the plants and softly out of ' +
        'the plane of focus. Never posing, never looking at the camera. ',
    },
    {
      // O card é "films / movies". Sala de cinema resolve sem pessoa nenhuma —
      // e sem pessoa não há anatomia para quebrar.
      endereco: 'vocab/movies.jpg',
      cena:
        'The inside of a small cinema seen from the side: rows of empty red seats running across the frame, the ' +
        'screen glowing softly out of focus at the end of the room, photographed at seat height from a normal ' +
        'distance so the rows of seats fill the MIDDLE of the frame. Nobody in the seats. ',
      restricao:
        'The cinema screen is a plain soft glow with no picture, no text and no lettering on it at all. ' +
        PLACAS_AO_FUNDO,
    },
    {
      endereco: 'vocab/music.jpg',
      cena:
        'An acoustic guitar resting against a wooden chair beside a music stand in a quiet living room, soft daylight ' +
        'from the window, photographed from a normal distance so the guitar fills the MIDDLE of the frame. ',
      restricao:
        'The sheet of paper on the music stand shows only plain printed musical notation with no words and no title ' +
        'on it, and the guitar carries no maker’s name, no logo and no lettering. ' + PLACAS_AO_FUNDO,
    },
    {
      endereco: 'vocab/reading.jpg',
      cena:
        'An open paperback book lying face up on a pale wooden table beside a pair of reading glasses and a cup of ' +
        'tea, photographed from a normal distance and slightly above in soft window light. ',
      restricao:
        'The print on the open pages lies off the plane of focus and reads as soft grey lines, never as words, and ' +
        'the cover of the book carries no title, no author name and no logo. ' + TEXTO_DE_DOCUMENTO,
    },
    {
      // Não confundir com a `vocab/luggage.jpg` aprovada, que é a mala fechada
      // no saguão: aqui a mala está ABERTA sobre a cama, que é a viagem antes
      // de ela começar.
      endereco: 'vocab/travelling.jpg',
      cena:
        'An open suitcase lying on a bed, half packed with neatly folded clothes, a sun hat and a small camera resting ' +
        'beside it, photographed from a normal distance and slightly above in soft daylight so the open suitcase ' +
        'fills the MIDDLE of the frame. Nobody in the room. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/walking.jpg',
      cena:
        'A person walking away along a tree-lined park path on a bright morning, seen at full length from behind at a ' +
        'good distance, the path running away into soft focus ahead of them. Never posing, never looking back at the ' +
        'camera. ',
    },
  ],

  /**
   * M11A2 — perder documentos no exterior. Seis cards, e três deles são o lugar
   * onde este projeto mais se queimou: documento e autoridade. `police-station`
   * e `police-report` não podem trazer brasão, bandeira nem nome de país — foi
   * exatamente o defeito da candidata do visto com `UNITED STATES OF AMERICA`.
   */
  m11: [
    {
      endereco: 'vocab/bag.jpg',
      cena:
        'A plain leather shoulder handbag standing on a wooden chair by a window, its strap falling over the side, ' +
        'photographed from a normal distance and slightly above in soft daylight. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
    {
      endereco: 'vocab/credit-card.jpg',
      cena:
        'A single plain matte bank card lying on a plain pale wooden table by a window, its small metal chip catching ' +
        'the light, photographed close and from slightly above. Nothing else on the table. ',
      restricao:
        'The card is blank apart from its chip: no bank name, no company name, no logo, no emblem, no flag, no ' +
        'embossed numbers, no signature strip and no lettering of any kind on it. ' + PLACAS_AO_FUNDO,
    },
    {
      endereco: 'vocab/documents.jpg',
      cena:
        'A small stack of travel papers laid out together on a plain pale wooden table in daylight, photographed ' +
        'straight from above: a closed dark passport booklet, a folded printed ticket and a plain paper form, ' +
        'arranged close together as one compact group that reads as a single subject. ',
      restricao:
        'The passport cover carries at most the single word PASSPORT in plain capitals, embossed and correctly ' +
        'spelled; the ticket and the form show only plain empty ruled boxes with no words on them. ' +
        TEXTO_DE_DOCUMENTO,
    },
    {
      endereco: 'vocab/police-report.jpg',
      cena:
        'A single printed paper form lying on a plain grey desk under a desk lamp, a pen resting across it, ' +
        'photographed straight from above at a normal distance. ',
      restricao:
        'The form carries at most the words POLICE REPORT in plain capitals at the top, correctly spelled; every ' +
        'other line on it is a plain empty ruled box with nothing written in it. No crest, no coat of arms, no ' +
        'emblem, no flag, no country name and no city name anywhere in the frame. ' + TEXTO_DE_DOCUMENTO,
    },
    {
      endereco: 'vocab/police-station.jpg',
      cena:
        'The entrance of a small town police station seen from the pavement across the street at a normal distance: ' +
        'a plain doorway under a lit sign, photographed straight on so the door and the sign together fill the ' +
        'MIDDLE of the frame, the street softly out of focus. ',
      restricao: placaEmFoco('the single word POLICE'),
    },
    {
      endereco: 'vocab/wallet.jpg',
      cena:
        'A brown leather wallet lying closed on a plain pale wooden table by a window, photographed close and from ' +
        'slightly above in soft daylight. Nothing else on the table. ',
      restricao: SEM_MARCA_NO_OBJETO,
    },
  ],
}

// ------------------------------------------------------- conteúdo → endereços

interface UsoDoTermo {
  /** o termo em inglês, como está no card — só para o log da curadoria */
  termo: string
  /** a tradução, que é o que desambigua o termo */
  pt: string
  /** de que aula veio */
  rotulo: string
}

/**
 * Onde cada endereço `vocab/…` é USADO, lido dos JSONs das aulas do módulo.
 *
 * Mesmo princípio do `cenas.ts`: quem sabe que um card pede foto é o conteúdo,
 * não este catálogo. Endereço no catálogo que nenhum card usa é ERRO — foto
 * órfã é dinheiro gasto numa imagem que nunca vai aparecer.
 */
function enderecosDoModulo(prefixo: string): Map<string, UsoDoTermo> {
  // ⚠️ O casamento é pelo MÓDULO INTEIRO, não por prefixo de string. Com
  // `startsWith` (como estava até o lote de 104), `m1` casava também com
  // `m10a1.json`, `m11a2.json` e `m12a1.json`: o catálogo do M1 passava a ser
  // cobrado pelos endereços de três módulos que não são dele, e o aviso "sem
  // termo escrito" saía com quarenta linhas de ruído que escondem o aviso real.
  // Os arquivos do curso são `m<n>-mission.json` e `m<n>a<k>.json`, então o que
  // separa um módulo do outro é o caractere seguinte ao número.
  const doModulo = new RegExp(`^${prefixo}(?:-|a\\d)`)
  const mapa = new Map<string, UsoDoTermo>()
  for (const arquivo of fs.readdirSync(CONTEUDO).sort()) {
    if (!doModulo.test(arquivo) || !arquivo.endsWith('.json')) continue
    const doc = JSON.parse(fs.readFileSync(path.join(CONTEUDO, arquivo), 'utf8'))
    const rotulo = `M${doc.module?.number}A${doc.lesson?.number} — ${doc.lesson?.title}`
    for (const slide of doc.slides ?? []) {
      if (slide?.type !== 'vocab') continue
      for (const card of slide.cards ?? []) {
        const img: unknown = card?.image
        if (typeof img !== 'string' || !img.startsWith('vocab/')) continue
        mapa.set(img, { termo: card.term, pt: card.pt, rotulo })
      }
    }
  }
  return mapa
}

/** prompt final: estilo + o objeto + a composição do card + restrições */
function promptDoTermo(t: Termo): string {
  return `${ESTILO} ${t.cena}${CARD_DE_VOCABULARIO}${t.restricao ?? PLACAS_AO_FUNDO}`
}

/**
 * A RÉGUA DA CONFERÊNCIA do card: além de marca, anatomia e emenda, o assunto
 * TEM de cair na fatia horizontal do meio que o card mostra (ver
 * `FAIXA_DO_CARD_PCT`, medido no `template-v2`). Foi o recorte que matou 4
 * candidatas seguidas do `customs` — e é um defeito que não se vê olhando a foto
 * sozinha, só no deck.
 */
const REGRA = { tipo: 'card', faixaPct: FAIXA_DO_CARD_PCT } as const

async function main(): Promise<void> {
  const [prefixo, ...resto] = process.argv.slice(2)
  const soPrompts = resto.includes('--prompts')
  const refazer = resto.includes('--refazer')
  const filtro = resto.filter((a) => a !== '--prompts' && a !== '--refazer')

  const catalogo = prefixo ? TERMOS[prefixo] : undefined
  if (!catalogo) {
    console.error('Uso: node scripts/images/vocab.ts <módulo> [endereço…] [--prompts]')
    console.error(`Módulos com termos escritos: ${Object.keys(TERMOS).join(', ')}`)
    process.exit(2)
  }

  const usos = enderecosDoModulo(prefixo)
  const orfas = catalogo.filter((t) => !usos.has(t.endereco)).map((t) => t.endereco)
  if (orfas.length) {
    console.error(`Endereço que nenhum card usa: ${orfas.join(', ')}. Corrija o termo ou o conteúdo.`)
    process.exit(2)
  }
  const faltando = [...usos.keys()].filter((e) => !catalogo.some((t) => t.endereco === e))
  if (faltando.length) console.warn(`⚠ sem termo escrito (não serão gerados): ${faltando.join(', ')}\n`)

  const escolhidos = filtro.length ? catalogo.filter((t) => filtro.includes(t.endereco)) : catalogo
  if (!escolhidos.length) {
    console.error(`Nenhum endereço bate com ${filtro.join(', ')}.`)
    process.exit(2)
  }

  const alvos = escolhidos.map((t) => {
    const uso = usos.get(t.endereco)!
    return {
      endereco: t.endereco,
      rotulo: `${uso.rotulo} · ${uso.termo} (${uso.pt})`,
      prompt: promptDoTermo(t),
      framing: ENQUADRAMENTO,
      regra: REGRA,
    }
  })

  if (soPrompts) {
    for (const a of alvos) console.log(`\n▸ ${a.endereco}  (${a.rotulo}, ${a.framing})\n${a.prompt}`)
    return
  }

  console.log(
    `${alvos.length} termo(s) de ${prefixo} — candidatas em ${path.relative(raiz, DESTINO)}/${prefixo}/\n`,
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
