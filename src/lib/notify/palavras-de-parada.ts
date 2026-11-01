// PALAVRAS DE PARADA (issues #113 e #127, ADR-038 item 4). Nada é desligado
// por este detector: o canal é contratual e quem decide é a admin, pela ficha
// do aluno (painel "Editar WhatsApp"). Ele tem DOIS NÍVEIS:
//
//   · `pedeParaParar` (LARGO) — destaca a linha na aba Recebidas da tela
//     Mensagens (#113). Falso positivo custa uma linha com selo a mais; falso
//     negativo custa um pedido de parada que ninguém viu.
//   · `pedeParaPararInequivoco` (ESTRITO) — dispara o e-mail interno às admins
//     (#127), que leva a admin a falar com o aluno ou a apagar o número dele no
//     mesmo dia. Aqui o falso positivo custa caro: um "Cancelar" respondendo ao
//     lembrete de aula não é pedido de parar de receber mensagens. Fica só a
//     mensagem inteira inequívoca (`PALAVRAS_INEQUIVOCAS`: "PARAR", "pare",
//     "STOP", "SAIR", "unsubscribe"…) e as frases com objeto de mensagem
//     (regras 2 a 4 abaixo). Ficam de fora "cancelar", "pode parar", "quero
//     sair", "chega" e "não quero mais" sem objeto: só destacam.
//
// MÓDULO COMPARTILHADO: quem precisa saber se um texto pede para parar importa
// daqui (as assinaturas `(texto: string | null | undefined) => boolean` não
// mudam), e o texto de uma mensagem recebida sai de `textoDaMensagemRecebida`.
// Não existe segunda lista em lugar nenhum.
//
// COMO LÊ: o texto é normalizado (minúsculas, sem acento, pontuação e emoji
// viram espaço, espaços repetidos viram um). Depois valem quatro regras:
//
//   1. MENSAGEM INTEIRA — o texto todo é uma destas palavras ou frases curtas
//      (`PALAVRAS_DE_PARADA`), com cortesia ou cumprimento ao redor ("por favor",
//      "pf", "please", "obrigada", "oi", "bom dia"…) e aceitando a palavra repetida ("parar parar").
//      "PARAR", "Stop.", "cancelar", "pode parar", "quero sair", "sair por
//      favor". Fora disso essas palavras NÃO contam: "cancelar a aula de
//      amanhã", "sair mais cedo hoje" e "pode parar na página 12?" não pedem
//      para parar de receber.
//   2. FRASE — a frase contém uma destas expressões inteiras, em qualquer
//      lugar (`FRASES_DE_PARADA`): "não quero receber", "parar de receber",
//      "não me mande mais", "tira da lista", "stop sending"…
//   3. VERBO DE ENVIO — "parar/pare/para de mandar/enviar" conta, a menos que
//      venha uma preposição logo depois: "pode parar de mandar no grupo?" fica
//      sem selo, "para de mandar mensagem" e "pare de enviar" levam.
//   4. "NÃO QUERO MAIS" — sozinho (regra 1) ou seguido, na MESMA frase, de um
//      objeto de mensagem (`OBJETOS_DE_NAO_QUERO_MAIS`): "não quero mais
//      receber", "não quero mais os lembretes". "Não quero mais faltar" não.
//
// Frase é a unidade para as regras 2 a 4: o texto é cortado em ". ! ? ; e
// quebra de linha" antes de normalizar.
//
// ACRESCENTAR palavra aqui é decisão de negócio visível na tela da dona: entra
// com teste em `tests/m3-recebidas.test.ts` (nível largo) e em
// `tests/palavras-de-parada.test.ts` (nível estrito).

/** Mensagem inteira igual a uma destas (já normalizada). */
export const PALAVRAS_DE_PARADA: readonly string[] = Object.freeze([
  'parar',
  'pare',
  'parem',
  'para',
  'chega',
  'sair',
  'stop',
  'cancelar',
  'pode parar',
  'quero sair',
  'nao quero mais',
  'descadastrar',
  'descadastre',
  'cancelar mensagens',
  'unsubscribe',
])

/**
 * Mensagem inteira que pede, sem dúvida, o fim das mensagens: o nível estrito
 * (o e-mail às admins). Subconjunto de `PALAVRAS_DE_PARADA`.
 */
export const PALAVRAS_INEQUIVOCAS: readonly string[] = Object.freeze([
  'parar',
  'pare',
  'parem',
  'sair',
  'stop',
  'descadastrar',
  'descadastre',
  'cancelar mensagens',
  'unsubscribe',
])

/** Frases que, contidas na frase, já bastam, em qualquer lugar (já normalizadas). */
export const FRASES_DE_PARADA: readonly string[] = Object.freeze([
  'nao quero receber',
  'parar de receber',
  'pare de receber',
  'parem de receber',
  'parar de me enviar',
  'parar de me mandar',
  'pare de me enviar',
  'pare de me mandar',
  'para de me enviar',
  'para de me mandar',
  'parem de me enviar',
  'parem de me mandar',
  'nao me mande mais',
  'nao mande mais',
  'nao me envie mais',
  'nao envie mais',
  'sair da lista',
  'remover da lista',
  'remove da lista',
  'remova da lista',
  'tirar da lista',
  'tira da lista',
  'tire da lista',
  'tirar meu numero',
  'tire meu numero',
  'remover meu numero',
  'remova meu numero',
  'please stop',
  'stop sending',
])

/** Depois de "não quero mais", uma destas palavras na mesma frase faz dela um pedido. */
export const OBJETOS_DE_NAO_QUERO_MAIS: readonly string[] = Object.freeze([
  'mensagem',
  'mensagens',
  'aviso',
  'avisos',
  'lembrete',
  'lembretes',
  'receber',
  'whatsapp',
  'zap',
])

/** Depois de "parar de mandar/enviar", uma destas palavras diz que o assunto é outro ("…no grupo"). */
const PREPOSICOES_DE_OUTRO_ASSUNTO: readonly string[] = Object.freeze([
  'no',
  'na',
  'nos',
  'nas',
  'em',
  'pra',
  'para',
  'ao',
  'aos',
  'a',
  'as',
  'o',
  'os',
  'la',
])

/** Formas de "parar" que, seguidas de "de mandar/enviar", pedem o fim das mensagens. */
const VERBOS_DE_PARAR: readonly string[] = Object.freeze(['parar', 'pare', 'para', 'parem'])

/** Cortesias e cumprimentos aceitos ao redor da mensagem inteira (as mais longas antes das curtas). */
const CORTESIAS: readonly string[] = Object.freeze([
  'bom dia',
  'boa tarde',
  'boa noite',
  'ola',
  'oi',
  'por favor',
  'por gentileza',
  'thank you',
  'thanks',
  'please',
  'pls',
  'pfvr',
  'pfv',
  'pf',
  'favor',
  'obrigado',
  'obrigada',
  'obg',
])

/** Minúsculas, sem acento, tudo que não é letra ou número vira um espaço só. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** A mensagem inteira, sem cortesia e sem palavra repetida em seguida, é uma das palavras da lista? */
function ehMensagemInteiraDe(limpo: string, lista: readonly string[]): boolean {
  let sobra = ` ${limpo} `
  for (const c of CORTESIAS) sobra = sobra.split(` ${c} `).join('  ')
  const palavras = sobra.trim().split(/\s+/)
  const semRepeticao = palavras.filter((p, i) => p !== palavras[i - 1])
  return lista.includes(semRepeticao.join(' '))
}

/** A frase (normalizada) pede para parar pelas regras 2 a 4? */
function fraseDeParada(frase: string): boolean {
  const t = ` ${frase} `
  if (FRASES_DE_PARADA.some((f) => t.includes(` ${f} `))) return true
  const palavras = frase.split(' ')
  for (let i = 0; i < palavras.length; i++) {
    // regra 3: parar de mandar/enviar, a menos que o assunto seja outro
    if (
      VERBOS_DE_PARAR.includes(palavras[i]) &&
      palavras[i + 1] === 'de' &&
      (palavras[i + 2] === 'mandar' || palavras[i + 2] === 'enviar')
    ) {
      const seguinte = palavras[i + 3]
      if (seguinte === undefined || !PREPOSICOES_DE_OUTRO_ASSUNTO.includes(seguinte)) return true
    }
    // regra 4: não quero mais + objeto de mensagem na mesma frase
    if (palavras[i] === 'nao' && palavras[i + 1] === 'quero' && palavras[i + 2] === 'mais') {
      if (palavras.slice(i + 3).some((p) => OBJETOS_DE_NAO_QUERO_MAIS.includes(p))) return true
    }
  }
  return false
}

/** A mensagem inteira (pela lista dada) ou alguma frase dela (regras 2 a 4) pede para parar? */
function pedeParaPararPela(texto: string | null | undefined, inteiras: readonly string[]): boolean {
  if (!texto) return false
  const limpo = normalizarTexto(texto)
  if (limpo === '') return false
  if (ehMensagemInteiraDe(limpo, inteiras)) return true
  return texto
    .split(/[.!?;\n]+/)
    .map(normalizarTexto)
    .filter((f) => f !== '')
    .some(fraseDeParada)
}

/** Nível LARGO: a mensagem pode estar pedindo para parar? Só destaca na aba Recebidas. */
export function pedeParaParar(texto: string | null | undefined): boolean {
  return pedeParaPararPela(texto, PALAVRAS_DE_PARADA)
}

/** Nível ESTRITO: a mensagem pede, sem dúvida, para parar de receber? Dispara o e-mail às admins. */
export function pedeParaPararInequivoco(texto: string | null | undefined): boolean {
  return pedeParaPararPela(texto, PALAVRAS_INEQUIVOCAS)
}

type Objeto = Record<string, unknown>
const ehObjeto = (v: unknown): v is Objeto => typeof v === 'object' && v !== null && !Array.isArray(v)
const textoNaoVazio = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

/**
 * O que o aluno escreveu numa mensagem recebida da Meta (o objeto
 * `messages[i]`): o texto, ou o rótulo do botão que ele tocou (`button`,
 * `interactive.button_reply`, `interactive.list_reply`). Mídia não tem texto:
 * null. Usado pela aba Recebidas e pelo webhook, para os dois lerem igual.
 */
export function textoDaMensagemRecebida(message: unknown): string | null {
  if (!ehObjeto(message)) return null
  const tipo = textoNaoVazio(message.type)
  if (tipo === 'text') return ehObjeto(message.text) ? textoNaoVazio(message.text.body) : null
  if (tipo === 'button') return ehObjeto(message.button) ? textoNaoVazio(message.button.text) : null
  if (tipo === 'interactive' && ehObjeto(message.interactive)) {
    const toque = ehObjeto(message.interactive.button_reply)
      ? message.interactive.button_reply
      : ehObjeto(message.interactive.list_reply)
        ? message.interactive.list_reply
        : null
    return toque ? textoNaoVazio(toque.title) : null
  }
  return null
}
