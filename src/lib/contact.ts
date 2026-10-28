// Canal humano da escola (F0/M9-9): número de ATENDIMENTO — o que a dona
// responde — e NÃO o número que dispara os avisos (Evolution, runbook §M).
// O número vem SÓ da env WHATSAPP_ATENDIMENTO_E164 (dado pessoal: o repositório
// não carrega nenhum). Sem a env não há link: quem usa a constante decide não
// desenhar o botão, o convite ou a linha do rodapé. Constante única para todo
// "fale com a gente" do portal e para o rodapé dos textos de WhatsApp.

/** `https://wa.me/<número>` (só dígitos; um "+" na env é aceito), ou `null` sem a env. */
export function urlDeAtendimento(e164: string | undefined): string | null {
  const digitos = (e164 ?? '').replace(/\D/g, '')
  return digitos ? `https://wa.me/${digitos}` : null
}

export const WHATSAPP_ATENDIMENTO_URL: string | null = urlDeAtendimento(
  process.env.WHATSAPP_ATENDIMENTO_E164,
)

/**
 * A frase "fale com a gente no WhatsApp" só pode ser dita quando há número: sem
 * ele o texto cai para um pedido neutro, que não promete canal nenhum. A
 * versão `_INICIAL` serve para começo de frase.
 */
export const FALE_COM_A_GENTE = WHATSAPP_ATENDIMENTO_URL
  ? 'fale com a gente no WhatsApp'
  : 'fale com a escola'
export const FALE_COM_A_GENTE_INICIAL = `${FALE_COM_A_GENTE.charAt(0).toUpperCase()}${FALE_COM_A_GENTE.slice(1)}`
