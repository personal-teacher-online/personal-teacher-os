// Palavra de parada numa mensagem de aluno ao número de envio da escola
// (ADR-038, item 4, ajuste de 31/10/2026; issue #44). Detector ÚNICO: o webhook
// da Meta o usa para avisar a admin por e-mail, e a aba Recebidas (#113) o usa
// para destacar a mensagem. Nada é desligado por ele: o aluno não tem opção de
// parar (canal contratual, M4-3); quem decide é a admin, pela ficha.
//
// A régua (maiúsculas, acentos e pontuação ignorados):
//  - "parar", "sair" e "stop" valem quando são a mensagem INTEIRA ("Parar!",
//    " STOP "). Dentro de uma frase não valem: "preciso sair mais cedo" é
//    recado de aula, não pedido de parada, e cada falso positivo é um e-mail
//    à toa para a admin;
//  - "não quero mais" vale em qualquer lugar da mensagem ("não quero mais
//    receber"), porque a frase só aparece nesse sentido.

const PALAVRAS_INTEIRAS: readonly string[] = Object.freeze(['parar', 'sair', 'stop'])
const FRASES: readonly string[] = Object.freeze(['nao quero mais'])

/** Minúsculas, sem acento, sem pontuação, espaços colapsados. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** A mensagem pede para parar? Sem texto (mídia, botão), nunca pede. */
export function pedeParaParar(texto: string | null | undefined): boolean {
  if (typeof texto !== 'string') return false
  const t = normalizar(texto)
  if (!t) return false
  if (PALAVRAS_INTEIRAS.includes(t)) return true
  const comBordas = ` ${t} `
  return FRASES.some((frase) => comBordas.includes(` ${frase} `))
}
