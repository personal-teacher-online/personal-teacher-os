// GRAMÁTICA DA ABA RECEBIDAS (issue #113) — o que é PURO: ler uma mensagem que
// o aluno mandou ao número de envio, do jeito que a #44 a guarda na
// `webhook_inbox` (`{ message, metadata }`, ADR-038 item 3). Mora fora de
// `recebidas.ts` (que é `server-only` e lê o banco) pelo mesmo motivo de
// `mensagens-gramatica.ts`: o teste importa daqui sem banco nem Next.

/** Quantos dias a inbox guarda (`purge_evolution_inbox`, migration 20261030000100). */
export const DIAS_DAS_RECEBIDAS = 90

/** Só o que a tela mostra de uma mensagem recebida. */
export interface MensagemRecebidaLida {
  /** só dígitos, E.164 sem `+`; null = a Meta não trouxe `from` */
  numero: string | null
  /** o `type` da Meta ("text", "audio"…); null = ausente */
  tipoDaMeta: string | null
  /** o tipo em português, para a tela */
  tipo: string
  /** o que o aluno escreveu (texto ou toque em botão); null para mídia */
  texto: string | null
  /** id da mensagem nossa a que ele respondeu (`context.id`); null = mensagem solta */
  respondeAoWamid: string | null
}

/** Tipos que a Cloud API documenta para mensagem recebida. Fora daqui: "Tipo não reconhecido". */
const TIPO_EM_PORTUGUES: Readonly<Record<string, string>> = Object.freeze({
  text: 'Texto',
  button: 'Toque em botão',
  interactive: 'Toque em botão',
  audio: 'Áudio',
  image: 'Imagem',
  sticker: 'Figurinha',
  video: 'Vídeo',
  document: 'Documento',
  location: 'Localização',
  contacts: 'Contato',
  reaction: 'Reação',
})

type Objeto = Record<string, unknown>
const ehObjeto = (v: unknown): v is Objeto => typeof v === 'object' && v !== null && !Array.isArray(v)
const textoNaoVazio = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

/** Só os dígitos: `from` vem sem `+`, `profiles.whatsapp_e164` vem com. */
export function soDigitos(v: string): string {
  return v.replace(/\D+/g, '')
}

/** O número como a dona o lê: `+` na frente. */
export function numeroComMais(digitos: string): string {
  return `+${digitos}`
}

/**
 * Lê o payload da linha `<wamid>:message`. Mídia vem só com ids: a tela mostra o
 * tipo e nada mais (não baixa arquivo, não lê legenda).
 */
export function lerMensagemRecebida(payload: unknown): MensagemRecebidaLida {
  const m = ehObjeto(payload) && ehObjeto(payload.message) ? payload.message : {}
  const from = textoNaoVazio(m.from)
  const digitos = from ? soDigitos(from) : ''
  const tipoDaMeta = textoNaoVazio(m.type)

  let texto: string | null = null
  if (tipoDaMeta === 'text') {
    texto = ehObjeto(m.text) ? textoNaoVazio(m.text.body) : null
  } else if (tipoDaMeta === 'button') {
    texto = ehObjeto(m.button) ? textoNaoVazio(m.button.text) : null
  } else if (tipoDaMeta === 'interactive' && ehObjeto(m.interactive)) {
    const toque = ehObjeto(m.interactive.button_reply)
      ? m.interactive.button_reply
      : ehObjeto(m.interactive.list_reply)
        ? m.interactive.list_reply
        : null
    texto = toque ? textoNaoVazio(toque.title) : null
  }

  return {
    numero: digitos === '' ? null : digitos,
    tipoDaMeta,
    tipo: (tipoDaMeta && TIPO_EM_PORTUGUES[tipoDaMeta]) || 'Tipo não reconhecido',
    texto,
    respondeAoWamid: ehObjeto(m.context) ? textoNaoVazio(m.context.id) : null,
  }
}
