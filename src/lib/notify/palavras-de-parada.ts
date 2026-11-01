// PALAVRAS DE PARADA (issue #113, ADR-038 item 4) — o detector que SÓ DESTACA a
// linha na aba Recebidas da tela Mensagens. Nada é desligado por ele: o canal é
// contratual e quem decide é a admin, pela ficha do aluno (painel "Editar
// WhatsApp"). Falso positivo custa uma linha com selo a mais; falso negativo
// custa um pedido de parada que ninguém viu. Por isso a lista é curta, legível
// e testada, e não tenta entender frase.
//
// COMO LÊ: o texto é normalizado (minúsculas, sem acento, pontuação e emoji
// viram espaço, espaços repetidos viram um). Depois valem duas regras:
//
//   1. PALAVRA SOLTA — a mensagem inteira é uma destas palavras, com no máximo
//      uma cortesia ao redor ("por favor", "obrigada"): "PARAR", "Stop.",
//      "sair por favor". Palavra solta no meio de uma frase NÃO conta: "posso
//      sair mais cedo?" e "quero parar de remarcar" não pedem para parar de
//      receber.
//   2. FRASE — a mensagem contém uma destas frases inteiras, em qualquer lugar:
//      "não quero mais", "não quero receber", "parar de receber", "sair da
//      lista"… São frases que só se dizem para pedir o fim das mensagens.
//
// "NÃO QUERO MAIS" é de propósito a frase mais larga da lista (a issue a nomeia):
// "não quero mais a aula às 9h" também leva o selo. O custo é uma linha a mais
// para a dona olhar; deixar de fora custaria o pedido que ninguém viu.
//
// ACRESCENTAR palavra aqui é decisão de negócio visível na tela da dona: entra
// com teste em `tests/m3-recebidas.test.ts`.

/** Mensagem inteira igual a uma destas (já normalizada). */
export const PALAVRAS_DE_PARADA: readonly string[] = Object.freeze([
  'parar',
  'pare',
  'parem',
  'para',
  'chega',
  'sair',
  'stop',
  'descadastrar',
  'descadastre',
  'cancelar mensagens',
  'unsubscribe',
])

/** Frases que, contidas na mensagem, já bastam (já normalizadas). */
export const FRASES_DE_PARADA: readonly string[] = Object.freeze([
  'nao quero mais',
  'nao quero receber',
  'parar de receber',
  'pare de receber',
  'parem de receber',
  'pare de me enviar',
  'pare de me mandar',
  'para de me enviar',
  'para de me mandar',
  'parem de me enviar',
  'parem de me mandar',
  'parar de mandar',
  'parar de enviar',
  'pare de mandar',
  'pare de enviar',
  'parem de mandar',
  'parem de enviar',
  'sair da lista',
  'tirar meu numero',
  'tire meu numero',
  'remover meu numero',
  'remova meu numero',
])

/** Cortesias aceitas ao redor de uma palavra solta ("por favor" antes de "favor"). */
const CORTESIAS: readonly string[] = Object.freeze(['por favor', 'pfv', 'favor', 'obrigado', 'obrigada', 'obg'])

/** Minúsculas, sem acento, tudo que não é letra ou número vira um espaço só. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** A mensagem pede para parar de receber? (Só destaca; ver o topo do arquivo.) */
export function pedeParaParar(texto: string | null | undefined): boolean {
  if (!texto) return false
  const limpo = normalizarTexto(texto)
  if (limpo === '') return false
  const t = ` ${limpo} `
  if (FRASES_DE_PARADA.some((f) => t.includes(` ${f} `))) return true
  let sobra = t
  for (const c of CORTESIAS) sobra = sobra.split(` ${c} `).join('  ')
  return PALAVRAS_DE_PARADA.includes(sobra.trim().replace(/\s+/g, ' '))
}
