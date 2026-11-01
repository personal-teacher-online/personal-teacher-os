// Canal humano da escola (F0/M9-9): número de ATENDIMENTO — o que a dona
// responde — e NÃO o número que dispara os avisos (Evolution, runbook §M).
// O número vem SÓ da env WHATSAPP_ATENDIMENTO_E164 (dado pessoal: o repositório
// não carrega nenhum). Sem a env não há link: quem usa a constante decide não
// desenhar o botão, o convite ou a linha do rodapé. Constante única para todo
// "fale com a gente" do portal e para o rodapé dos textos de WhatsApp (#119:
// nos avisos com template na Meta, o número legível, não o link).

/** E.164: "+", código do país sem zero à esquerda, de 8 a 15 dígitos no total. */
const E164 = /^\+[1-9]\d{7,14}$/

/**
 * O número de atendimento em E.164 (`+5565900090009`), ou `null` sem a env ou
 * com ela fora do formato. Espaço, hífen, ponto e parênteses saem; qualquer
 * outra coisa (ramal, letra, falta do "+") é recusada (gate Sol da PR #126):
 * apagar o que não é dígito grudaria um ramal no número, e sem o "+" o código
 * do país seria adivinhação. Número malformado é o mesmo que número ausente:
 * sem link, sem linha, e o aviso que o pede fica preso com o motivo.
 */
export function e164DeAtendimento(bruto: string | null | undefined): string | null {
  const limpo = (bruto ?? '').replace(/[\s().-]/g, '')
  return E164.test(limpo) ? limpo : null
}

/** `https://wa.me/<número>` (só dígitos), ou `null` sem a env ou com ela fora do E.164. */
export function urlDeAtendimento(e164: string | undefined): string | null {
  const numero = e164DeAtendimento(e164)
  return numero ? `https://wa.me/${numero.slice(1)}` : null
}

export const WHATSAPP_ATENDIMENTO_URL: string | null = urlDeAtendimento(
  process.env.WHATSAPP_ATENDIMENTO_E164,
)

/**
 * O número de atendimento como se lê, para o texto da mensagem (#119: a Meta
 * recusa botão com link para o WhatsApp, então o "fale com a gente" é uma
 * linha com o número, que o WhatsApp torna tocável). Celular do Brasil sai
 * `+55 65 90009-0009`; fixo, `+55 65 9000-0009`; outro país, `+<dígitos>`.
 * Recebe o E.164 (pelo mesmo crivo de `e164DeAtendimento`) ou o link que
 * `urlDeAtendimento` gera (`https://wa.me/<só dígitos>`); `null` sem número
 * ou com ele fora do formato.
 */
export function numeroDeAtendimentoLegivel(numero: string | null | undefined): string | null {
  const doLink = /^https:\/\/wa\.me\/(\d+)$/.exec((numero ?? '').trim())
  const e164 = e164DeAtendimento(doLink ? `+${doLink[1]}` : numero)
  if (!e164) return null
  const brasil = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164)
  return brasil ? `+55 ${brasil[1]} ${brasil[2]}-${brasil[3]}` : e164
}

export const WHATSAPP_ATENDIMENTO_LEGIVEL: string | null = numeroDeAtendimentoLegivel(
  process.env.WHATSAPP_ATENDIMENTO_E164,
)

/**
 * A frase de atendimento dos textos de WhatsApp (#119), terminando no número
 * (`Imprevisto? Fale com a gente: +55 …`); sem o número, com ponto final.
 */
export function comNumeroDeAtendimento(frase: string): string {
  return WHATSAPP_ATENDIMENTO_LEGIVEL ? `${frase}: ${WHATSAPP_ATENDIMENTO_LEGIVEL}` : `${frase}.`
}

/**
 * A linha "Dúvidas? Fale com a gente: <número>" antes da assinatura dos textos
 * de WhatsApp (#119), com o parágrafo em branco que a separa; vazia sem o
 * número (a linha some inteira, como o rodapé `WA_FOOTER`).
 */
export const LINHA_DE_ATENDIMENTO: string = WHATSAPP_ATENDIMENTO_LEGIVEL
  ? `Dúvidas? Fale com a gente: ${WHATSAPP_ATENDIMENTO_LEGIVEL}\n\n`
  : ''

/**
 * A frase "fale com a gente no WhatsApp" só pode ser dita quando há número: sem
 * ele o texto cai para um pedido neutro, que não promete canal nenhum. A
 * versão `_INICIAL` serve para começo de frase.
 */
export const FALE_COM_A_GENTE = WHATSAPP_ATENDIMENTO_URL
  ? 'fale com a gente no WhatsApp'
  : 'fale com a escola'
export const FALE_COM_A_GENTE_INICIAL = `${FALE_COM_A_GENTE.charAt(0).toUpperCase()}${FALE_COM_A_GENTE.slice(1)}`
