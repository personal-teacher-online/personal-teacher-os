// Canal humano da escola (F0/M9-9): número de ATENDIMENTO — o que a dona
// responde — e NÃO o número que dispara os avisos (Evolution, runbook §M).
// O número vem SÓ da env WHATSAPP_ATENDIMENTO_E164 (dado pessoal: o repositório
// não carrega nenhum). Sem a env não há link: quem usa a constante decide não
// desenhar o botão, o convite ou a linha do rodapé. Constante única para todo
// "fale com a gente" do portal e para o rodapé dos textos de WhatsApp (#119:
// nos avisos com template na Meta, o número legível, não o link).

/** `https://wa.me/<número>` (só dígitos; um "+" na env é aceito), ou `null` sem a env. */
export function urlDeAtendimento(e164: string | undefined): string | null {
  const digitos = (e164 ?? '').replace(/\D/g, '')
  return digitos ? `https://wa.me/${digitos}` : null
}

export const WHATSAPP_ATENDIMENTO_URL: string | null = urlDeAtendimento(
  process.env.WHATSAPP_ATENDIMENTO_E164,
)

/**
 * O número de atendimento como se lê, para o texto da mensagem (#119: a Meta
 * recusa botão com link para o WhatsApp, então o "fale com a gente" é uma
 * linha com o número, que o WhatsApp torna tocável). Celular do Brasil sai
 * `+55 65 90009-0009`; fixo, `+55 65 9000-0009`; outro país, `+<dígitos>`.
 * Recebe o E.164 ou o `https://wa.me/<número>` (só os dígitos contam); `null`
 * sem número.
 */
export function numeroDeAtendimentoLegivel(numero: string | null | undefined): string | null {
  const digitos = (numero ?? '').replace(/\D/g, '')
  if (!digitos) return null
  const brasil = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digitos)
  return brasil ? `+55 ${brasil[1]} ${brasil[2]}-${brasil[3]}` : `+${digitos}`
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
