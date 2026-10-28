/**
 * OS CHUNKS DO PERSONAL TRAVEL — a lista curada, material da Mission 9.
 *
 * REGRA DE OURO desta lista: nada aqui é inglês de viagem genérico. Todo chunk
 * saiu do conteúdo real das 65 aulas de `content/personal-travel-v2/` — cards de
 * vocabulário, glossários de diálogo, `examples` de gramática, falas de
 * `dialogue` e frases de `speaking`. O campo `aulas` é a prova: é o código das
 * aulas em que o chunk aparece. Se ele estiver vazio, o chunk não entra.
 *
 * COMO A LISTA FOI CURADA (a partir de 3.662 candidatos extraídos):
 *   1. só FRASE — chunk não é palavra solta ("next to", "aisle" ficaram fora);
 *   2. só o que ELA DIZ — o que ela só OUVE no balcão ("Anything else?",
 *      "Cash or card?", "Are you ready to order?") não entra numa lista feita
 *      para dizer em voz alta três vezes por dia;
 *   3. um MOLDE por família de variação — `Could I have a blanket?` e
 *      `Could I have a pillow?` são o mesmo chunk com o substantivo trocado, e
 *      o que entra é o molde `Could I have …, please?`;
 *   4. prioridade para o que aparece em mais de um módulo, o que resolve uma
 *      cena inteira sozinho e o que serve em qualquer viagem.
 *
 * TRADUÇÃO FUNCIONAL, não literal: `Could I have…?` é "poderia me trazer/dar…?"
 * — nunca "eu poderia ter…?". Essa correção já foi feita no curso (m3a2/m3a4/
 * m4a2) e esta lista a preserva.
 *
 * AS 5 FAMÍLIAS são as da aula m9a4, na mesma ordem: ask · order · react ·
 * repair · close. Mudar a ordem aqui desalinha o PDF da aula.
 */

/** as cinco gavetas da aula 4 do M9, na ordem em que ela as ensina */
export type Familia = 'ask' | 'order' | 'react' | 'repair' | 'close'

export type Chunk = {
  /** a frase em inglês, do jeito que sai da boca; `…` marca o encaixe do molde */
  en: string
  /** tradução FUNCIONAL em pt-BR (o que a frase FAZ, não o que ela diz) */
  pt: string
  /** onde ela usa — pista curta de cena, para achar na hora */
  onde: string
  /** rastreabilidade: códigos das aulas de content/personal-travel-v2 */
  aulas: string[]
}

export type Grupo = {
  familia: Familia
  /** o que a família faz, nas palavras da aula */
  oQueFaz: string
  chunks: Chunk[]
}

export const GRUPOS: Grupo[] = [
  {
    familia: 'ask',
    oQueFaz: 'pedir informação',
    chunks: [
      { en: 'Excuse me…', pt: 'com licença…', onde: 'qualquer lugar', aulas: ['m8a1', 'm9a4', 'm11a3'] },
      { en: 'Do you speak English?', pt: 'você fala inglês?', onde: 'qualquer lugar', aulas: ['m10a1', 'm10a4'] },
      { en: 'Could you help me, please?', pt: 'pode me ajudar, por favor?', onde: 'qualquer lugar', aulas: ['m3a3', 'm5a4', 'm9a2', 'm11a3', 'm12a3'] },
      { en: 'Is there a … near here?', pt: 'tem um … aqui perto?', onde: 'rua', aulas: ['m9a4'] },
      { en: 'Where is the (nearest) …?', pt: 'onde fica o/a … (mais perto)?', onde: 'rua · loja', aulas: ['m5a2', 'm5a3', 'm7a2', 'm12a3'] },
      { en: 'How do I get to …?', pt: 'como eu chego a…?', onde: 'rua', aulas: ['m5a3', 'm12a4'] },
      { en: 'Is it far from here?', pt: 'é longe daqui?', onde: 'rua', aulas: ['m5a2'] },
      { en: 'How long does it take?', pt: 'quanto tempo leva?', onde: 'rua · balcão', aulas: ['m12a2'] },
      { en: 'What time is the next …?', pt: 'a que horas é o próximo…?', onde: 'estação · aeroporto', aulas: ['m5a1', 'm12a2'] },
      { en: 'Is this the bus to …?', pt: 'este é o ônibus para…?', onde: 'ponto · estação', aulas: ['m1a3'] },
      { en: 'Does it stop at …?', pt: 'ele para em…?', onde: 'ônibus · trem', aulas: ['m1a3'] },
      { en: 'Is this the line for …?', pt: 'esta é a fila para…?', onde: 'aeroporto · fila', aulas: ['m8a1'] },
      { en: 'Is this seat free?', pt: 'este lugar está livre?', onde: 'avião · café', aulas: ['m8a4'] },
      { en: 'Where can I find …?', pt: 'onde eu acho…?', onde: 'loja · mercado', aulas: ['m7a1'] },
      { en: 'How much is it?', pt: 'quanto custa?', onde: 'loja · balcão', aulas: ['m4a1', 'm6a1', 'm9a4', 'm12a2'] },
      { en: 'Do you have …?', pt: 'vocês têm…?', onde: 'loja · restaurante', aulas: ['m3a1', 'm6a1'] },
      { en: 'What do you recommend?', pt: 'o que você recomenda?', onde: 'restaurante · farmácia', aulas: ['m10a1', 'm12a3'] },
      { en: "What's this?", pt: 'o que é isto?', onde: 'restaurante · loja', aulas: ['m6a2'] },
      { en: "What's this called?", pt: 'como se chama isso?', onde: 'qualquer lugar', aulas: ['m1a4'] },
      { en: 'Is … included?', pt: 'o … está incluído?', onde: 'hotel · restaurante', aulas: ['m4a4', 'm6a3', 'm12a1'] },
      { en: 'Can I pay by card?', pt: 'posso pagar no cartão?', onde: 'loja · restaurante', aulas: ['m12a2'] },
      { en: 'Can I try it on?', pt: 'posso experimentar?', onde: 'loja', aulas: ['m7a2', 'm12a2'] },
      { en: 'Can I leave my luggage?', pt: 'posso deixar minha mala?', onde: 'hotel', aulas: ['m4a4'] },
      { en: 'What time is check-out?', pt: 'a que horas é o check-out?', onde: 'hotel', aulas: ['m4a1', 'm4a4'] },
      { en: 'How long is the wait?', pt: 'quanto tempo de espera?', onde: 'clínica · balcão', aulas: ['m10a4'] },
      { en: 'What are my options?', pt: 'quais são as minhas opções?', onde: 'aeroporto · balcão', aulas: ['m11a1', 'm11a4'] },
      { en: 'What should I do?', pt: 'o que eu devo fazer?', onde: 'qualquer problema', aulas: ['m11a2', 'm11a4'] },
      { en: 'Do I have to …?', pt: 'eu preciso…? / é obrigatório…?', onde: 'balcão · seguro', aulas: ['m10a3'] },
      { en: 'Where are you from?', pt: 'de onde você é?', onde: 'conversa', aulas: ['m2a2', 'm8a2', 'm12a3'] },
      { en: 'What do you do?', pt: 'o que você faz? (trabalho)', onde: 'conversa', aulas: ['m8a2', 'm12a3'] },
      { en: 'Is this your first time here?', pt: 'é a sua primeira vez aqui?', onde: 'conversa', aulas: ['m12a3'] },
      { en: 'What do you like doing?', pt: 'do que você gosta de fazer?', onde: 'conversa', aulas: ['m8a3'] },
    ],
  },
  {
    familia: 'order',
    oQueFaz: 'pedir uma coisa ou um serviço',
    chunks: [
      { en: "I'd like …, please.", pt: 'eu queria…, por favor', onde: 'restaurante · balcão', aulas: ['m3a2', 'm6a2', 'm9a4', 'm12a2'] },
      { en: 'Could I have …, please?', pt: 'poderia me trazer/dar…, por favor?', onde: 'avião · restaurante', aulas: ['m3a2', 'm3a4', 'm4a2', 'm12a2'] },
      { en: 'Could we have the bill, please?', pt: 'a conta, por favor', onde: 'restaurante', aulas: ['m6a3', 'm6a4', 'm9a4', 'm12a2'] },
      { en: "I'll have this.", pt: 'vou querer este', onde: 'restaurante', aulas: ['m6a2'] },
      { en: "I'll take it.", pt: 'eu fico com esse', onde: 'loja', aulas: ['m7a4', 'm11a4'] },
      { en: 'Two, please.', pt: 'dois, por favor', onde: 'balcão · café', aulas: ['m6a1', 'm6a4'] },
      { en: 'Just a coffee.', pt: 'só um café', onde: 'café', aulas: ['m6a4'] },
      { en: 'A table for two, please.', pt: 'uma mesa para dois, por favor', onde: 'restaurante', aulas: ['m6a4', 'm12a2'] },
      { en: 'A window seat, please.', pt: 'janela, por favor', onde: 'check-in', aulas: ['m3a1', 'm3a4'] },
      { en: 'One round-trip ticket, please.', pt: 'uma passagem de ida e volta, por favor', onde: 'estação', aulas: ['m5a1', 'm12a2'] },
      { en: 'Yes, please.', pt: 'sim, por favor', onde: 'qualquer lugar', aulas: ['m3a2', 'm6a2', 'm6a4'] },
      { en: 'Yes, under …', pt: 'sim, no nome de… (reserva)', onde: 'hotel · restaurante', aulas: ['m12a1'] },
      { en: 'Do you have a bigger size?', pt: 'tem um tamanho maior?', onde: 'loja', aulas: ['m7a2', 'm7a3', 'm12a2'] },
      { en: 'Do you have a cheaper one?', pt: 'tem um mais barato?', onde: 'loja', aulas: ['m7a2', 'm7a4'] },
      { en: 'Do you have any vegetarian options?', pt: 'vocês têm opção vegetariana?', onde: 'restaurante', aulas: ['m6a1', 'm6a2'] },
      { en: 'Does it have … in it?', pt: 'tem … dentro?', onde: 'restaurante', aulas: ['m6a4'] },
      { en: 'Is it spicy?', pt: 'é apimentado?', onde: 'restaurante', aulas: ['m12a2'] },
      { en: "I'm allergic to …", pt: 'eu sou alérgica a…', onde: 'restaurante · clínica', aulas: ['m6a3', 'm10a1', 'm10a4'] },
      { en: "I'd like to return this.", pt: 'eu queria devolver isto', onde: 'loja', aulas: ['m7a3'] },
      { en: 'Can I have the receipt?', pt: 'pode me dar o recibo?', onde: 'loja', aulas: ['m7a4'] },
      { en: 'Could you send someone, please?', pt: 'poderia mandar alguém, por favor?', onde: 'hotel', aulas: ['m4a2', 'm4a3'] },
      { en: "I'd like to see a doctor, please.", pt: 'eu queria consultar um médico, por favor', onde: 'clínica', aulas: ['m10a4'] },
      { en: 'Ambulance, please.', pt: 'ambulância, por favor', onde: 'emergência', aulas: ['m10a2'] },
    ],
  },
  {
    familia: 'react',
    oQueFaz: 'mostrar que você está na conversa',
    chunks: [
      { en: 'Really?', pt: 'sério?', onde: 'conversa', aulas: ['m8a4', 'm9a2', 'm9a4'] },
      { en: 'Me too!', pt: 'eu também!', onde: 'conversa', aulas: ['m8a3', 'm8a4', 'm9a2', 'm9a4'] },
      { en: 'Me neither.', pt: 'nem eu', onde: 'conversa', aulas: ['m9a4'] },
      { en: 'Sounds good!', pt: 'parece ótimo!', onde: 'conversa', aulas: ['m9a2', 'm9a4'] },
      { en: "That's nice!", pt: 'que legal!', onde: 'conversa', aulas: ['m8a4', 'm9a2', 'm12a3'] },
      { en: 'Oh, I see.', pt: 'ah, entendi', onde: 'conversa', aulas: ['m9a2', 'm9a4'] },
      { en: 'No problem!', pt: 'imagina! / sem problema', onde: 'conversa', aulas: ['m9a4'] },
      { en: 'Of course!', pt: 'claro!', onde: 'qualquer lugar', aulas: ['m9a4', 'm12a1'] },
      { en: "I don't know.", pt: 'não sei', onde: 'qualquer lugar', aulas: ['m9a4'] },
      { en: 'Nice to meet you.', pt: 'prazer!', onde: 'conversa', aulas: ['m8a2', 'm8a4', 'm12a3'] },
      { en: 'And you? / What about you?', pt: 'e você?', onde: 'conversa', aulas: ['m3a2', 'm8a4', 'm9a2', 'm12a3', 'm12a4'] },
      { en: 'Fine, thanks. And you?', pt: 'tudo bem, obrigada. e você?', onde: 'conversa', aulas: ['m8a1'] },
      { en: 'Here you are.', pt: 'aqui está', onde: 'balcão · avião', aulas: ['m1a1', 'm1a3', 'm2a1', 'm4a1', 'm6a4', 'm12a1'] },
      { en: "I'm from …", pt: 'eu sou de…', onde: 'conversa', aulas: ['m2a2', 'm8a2', 'm12a3'] },
      { en: "It's my first time here.", pt: 'é a minha primeira vez aqui', onde: 'conversa', aulas: ['m2a2', 'm9a2'] },
      { en: "I'm here on vacation.", pt: 'estou aqui de férias', onde: 'imigração · conversa', aulas: ['m2a2'] },
      { en: 'Tourism. Ten days.', pt: 'turismo. dez dias.', onde: 'imigração', aulas: ['m2a4', 'm12a1', 'm12a4'] },
      { en: "I'm travelling alone. / I'm travelling with …", pt: 'estou viajando sozinha / com…', onde: 'imigração · conversa', aulas: ['m2a2', 'm2a4'] },
      { en: "I'm staying at …", pt: 'vou ficar no/na…', onde: 'imigração · hotel', aulas: ['m2a2', 'm2a4'] },
      { en: 'I work in …', pt: 'eu trabalho em…', onde: 'conversa', aulas: ['m8a2'] },
      { en: 'This is my husband.', pt: 'este é o meu marido', onde: 'conversa', aulas: ['m8a2'] },
    ],
  },
  {
    familia: 'repair',
    oQueFaz: 'consertar quando trava — na conversa e na viagem',
    chunks: [
      { en: 'Sorry?', pt: 'como?', onde: 'qualquer lugar', aulas: ['m2a3', 'm12a1', 'm12a4'] },
      { en: "Sorry, I don't understand.", pt: 'desculpa, não entendi', onde: 'qualquer lugar', aulas: ['m2a3', 'm9a4'] },
      { en: 'Could you repeat that, please?', pt: 'pode repetir, por favor?', onde: 'qualquer lugar', aulas: ['m2a3', 'm3a3', 'm3a4', 'm8a4', 'm11a4', 'm12a1', 'm12a4'] },
      { en: 'Could you speak more slowly, please?', pt: 'pode falar mais devagar, por favor?', onde: 'qualquer lugar', aulas: ['m2a3', 'm10a2', 'm10a4', 'm12a4'] },
      { en: 'Could you write it down, please?', pt: 'pode escrever, por favor?', onde: 'balcão · clínica', aulas: ['m2a3', 'm10a1', 'm10a4', 'm12a3', 'm12a4'] },
      { en: 'I speak a little English.', pt: 'eu falo um pouco de inglês', onde: 'qualquer lugar', aulas: ['m2a3', 'm12a4'] },
      { en: 'How do you say … in English?', pt: 'como se diz… em inglês?', onde: 'qualquer lugar', aulas: ['m9a1', 'm12a4'] },
      { en: 'How do you spell that?', pt: 'como se escreve?', onde: 'balcão · hotel', aulas: ['m9a3'] },
      { en: 'Thirteen or thirty?', pt: 'treze ou trinta?', onde: 'preço · horário', aulas: ['m9a3'] },
      { en: 'Is that correct?', pt: 'está certo? (confirmando o que entendeu)', onde: 'balcão · rua', aulas: ['m5a3'] },
      { en: 'Well… / Let me see… / Let me think…', pt: 'bom… / deixa eu ver… / deixa eu pensar…', onde: 'conversa', aulas: ['m9a1', 'm12a3', 'm12a4'] },
      { en: 'I mean…', pt: 'quer dizer… (para se corrigir)', onde: 'conversa', aulas: ['m9a1'] },
      { en: "I don't know the word.", pt: 'não sei a palavra', onde: 'qualquer lugar', aulas: ['m1a4'] },
      { en: "It's a thing for …", pt: 'é uma coisa para… (quando falta a palavra)', onde: 'loja · farmácia', aulas: ['m1a4'] },
      { en: "I'm lost.", pt: 'estou perdida', onde: 'rua', aulas: ['m5a4', 'm12a4'] },
      { en: 'I have a problem.', pt: 'eu tenho um problema', onde: 'balcão', aulas: ['m3a3'] },
      { en: "My bag isn't here.", pt: 'minha mala não está aqui', onde: 'aeroporto', aulas: ['m3a3', 'm3a4'] },
      { en: 'I lost my …', pt: 'perdi meu/minha…', onde: 'qualquer lugar', aulas: ['m5a4', 'm11a2', 'm11a4', 'm12a3'] },
      { en: 'I missed the …', pt: 'perdi o/a… (ônibus, voo)', onde: 'estação · aeroporto', aulas: ['m5a4'] },
      { en: 'I took the wrong train.', pt: 'peguei o trem errado', onde: 'estação', aulas: ['m5a4'] },
      { en: 'My phone died.', pt: 'meu celular descarregou', onde: 'rua', aulas: ['m5a4'] },
      { en: 'My flight was cancelled.', pt: 'meu voo foi cancelado', onde: 'aeroporto', aulas: ['m11a1', 'm12a3'] },
      { en: 'I ordered …', pt: 'eu pedi… (veio errado)', onde: 'restaurante', aulas: ['m6a3'] },
      { en: "It's too small.", pt: 'está pequeno demais', onde: 'loja', aulas: ['m7a2', 'm7a3'] },
      { en: "It doesn't fit.", pt: 'não serviu', onde: 'loja', aulas: ['m7a3'] },
      { en: "I don't feel well.", pt: 'não estou me sentindo bem', onde: 'farmácia · clínica', aulas: ['m12a3'] },
      { en: 'I have a …', pt: 'estou com… (dor de cabeça, febre)', onde: 'farmácia · clínica', aulas: ['m10a1', 'm12a3'] },
      { en: 'My … hurts.', pt: 'meu/minha … dói', onde: 'clínica', aulas: ['m10a1', 'm10a4'] },
      { en: 'It hurts here.', pt: 'dói aqui (e você aponta)', onde: 'clínica', aulas: ['m10a1', 'm10a4'] },
      { en: 'It started two days ago.', pt: 'começou há dois dias', onde: 'clínica', aulas: ['m10a1', 'm10a4'] },
      { en: 'I have travel insurance.', pt: 'eu tenho seguro viagem', onde: 'clínica · seguro', aulas: ['m10a3', 'm12a3'] },
      { en: "I'm at …", pt: 'estou em… (endereço)', onde: 'emergência · táxi', aulas: ['m10a2'] },
    ],
  },
  {
    familia: 'close',
    oQueFaz: 'fechar bem — inclusive o que você não quer',
    chunks: [
      { en: 'Thank you so much!', pt: 'muito obrigada!', onde: 'qualquer lugar', aulas: ['m9a4', 'm12a2'] },
      { en: "You're welcome.", pt: 'de nada', onde: 'qualquer lugar', aulas: ['m5a2'] },
      { en: 'Have a nice day!', pt: 'tenha um bom dia!', onde: 'qualquer lugar', aulas: ['m8a1', 'm9a4'] },
      { en: 'Have a good trip!', pt: 'boa viagem!', onde: 'despedida', aulas: ['m4a4'] },
      { en: 'Enjoy your meal!', pt: 'bom apetite!', onde: 'restaurante', aulas: ['m12a2'] },
      { en: 'Nice talking to you!', pt: 'foi bom falar com você', onde: 'despedida', aulas: ['m8a1', 'm8a4'] },
      { en: 'See you tomorrow!', pt: 'até amanhã!', onde: 'despedida', aulas: ['m9a4'] },
      { en: 'Do you want to keep in touch?', pt: 'quer manter contato?', onde: 'despedida', aulas: ['m8a2', 'm8a4'] },
      { en: "I'm just looking.", pt: 'só estou olhando', onde: 'loja', aulas: ['m7a4'] },
      { en: "I'll check and come back.", pt: 'vou verificar e volto', onde: 'loja', aulas: ['m11a3'] },
      { en: 'No, thank you.', pt: 'não, obrigada', onde: 'rua · loja', aulas: ['m11a3', 'm11a4'] },
      { en: "I'm not interested.", pt: 'não tenho interesse', onde: 'rua', aulas: ['m11a3', 'm11a4'] },
      { en: "Sorry, I'm in a hurry.", pt: 'desculpe, estou com pressa', onde: 'rua', aulas: ['m11a3'] },
      { en: "I'm meeting a friend.", pt: 'vou encontrar um amigo', onde: 'rua', aulas: ['m11a3'] },
      { en: 'Please leave me alone.', pt: 'por favor, me deixe em paz', onde: 'rua', aulas: ['m11a3'] },
    ],
  },
]

/** quantos chunks a lista tem de verdade — o PDF e os slides falam este número */
export const TOTAL = GRUPOS.reduce((n, g) => n + g.chunks.length, 0)
