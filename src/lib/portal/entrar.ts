// D1 — A JANELA DO BOTÃO "ENTRAR" (Onda do Portal · P3).
//
// A régua é de RELÓGIO, não de fuso: tudo aqui é aritmética de época (ms), que
// dá o mesmo resultado em Cuiabá, Lisboa ou Orlando. É por isso que o contador
// pode viver no cliente sem ferir a Lei 1 — o TEXTO com hora (o "Entrar às
// 20:00" de quem ainda está longe da aula) é formatado no SERVIDOR, com a zona
// IANA do aluno, e chega pronto por prop.
//
// Três estados, e só três:
//   · `cedo`      — falta mais que a antecedência: botão desligado, com a conta
//                   regressiva no rótulo (ou a hora, quando a espera é longa);
//   · `aberto`    — de 15 min antes até o FIM da aula: o link do Meet, ativo;
//   · `encerrado` — passou do fim: não existe botão (o card não o desenha).
//
// Por que a abertura vale até o FIM e não até o começo: quem entra 10 minutos
// atrasado precisa do mesmo botão — sumir com ele no minuto do começo é
// esconder a porta da aula que está acontecendo.

export type EstadoDeEntrada = 'cedo' | 'aberto' | 'encerrado'

/** Quanto antes do começo o botão acende. */
export const ABERTURA_ANTES_MS = 15 * 60_000

/** De quanto em quanto tempo o cliente refaz a conta (D1: contagem viva). */
export const INTERVALO_DA_CONTAGEM_MS = 30_000

/** Acima disso a espera deixa de ser contagem e vira hora marcada. */
export const LIMITE_DA_CONTAGEM_MIN = 60

export const ROTULO_ABERTO = 'Entrar na aula'

/**
 * A partir de quanto o desvio entre o relógio do SERVIDOR e o do APARELHO é
 * tratado como relógio errado (revisão adversarial 2 · D4).
 *
 * O desvio só pode ser MEDIDO na hidratação, e a medida inclui tudo que passou
 * entre o render do servidor e o `Date.now()` do navegador: fila do servidor,
 * streaming, rede de celular, parse. Numa página que levou 70 s para chegar,
 * corrigir por esse "desvio" jogaria a porta da aula ~100 s além do fim dela —
 * uma latência lida como erro de relógio.
 *
 * O erro que a correção existe para resolver se mede em HORAS (celular com data
 * manual, tablet com a bateria do RTC morta), não em segundos. Abaixo deste
 * limiar o relógio do aparelho manda. O preço, dito na cara: a latência típica
 * de página fica sem correção nenhuma, e o aparelho MUITO errado carrega um
 * resíduo de no máximo 2 minutos — que é menos que a antecedência de 15.
 */
export const DESVIO_MINIMO_DO_RELOGIO_MS = 120_000

export function estadoDoBotao(agoraMs: number, startMs: number, endMs: number): EstadoDeEntrada {
  if (agoraMs >= endMs) return 'encerrado'
  if (agoraMs >= startMs - ABERTURA_ANTES_MS) return 'aberto'
  return 'cedo'
}

/** Minutos que faltam para o começo, arredondados PARA CIMA — "faltam 12 min"
 *  com 11min40s é a leitura honesta; para baixo diria 11 e o aluno se atrasaria. */
export function minutosParaComecar(agoraMs: number, startMs: number): number {
  return Math.max(0, Math.ceil((startMs - agoraMs) / 60_000))
}

/**
 * O rótulo de quem ainda está esperando.
 *
 * `horaDoComeco` já vem formatada pelo servidor na zona do aluno ("20:00") —
 * este módulo NUNCA a calcula.
 */
export function rotuloDeEspera(minutos: number, horaDoComeco: string): string {
  if (minutos > LIMITE_DA_CONTAGEM_MIN) return `Entrar às ${horaDoComeco}`
  return `Entrar em ${minutos} min`
}

/** O rótulo do botão em qualquer estado (o `encerrado` não desenha botão). */
export function rotuloDoBotao(
  estado: EstadoDeEntrada,
  minutos: number,
  horaDoComeco: string,
): string {
  return estado === 'aberto' ? ROTULO_ABERTO : rotuloDeEspera(minutos, horaDoComeco)
}
