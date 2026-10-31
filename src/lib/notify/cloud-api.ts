import type { ChannelOutcome, NotificationChannel, OutboundMessage } from './channel'
import { IDIOMA_DOS_TEMPLATES } from './whatsapp-templates'

// Driver WhatsApp pela Cloud API oficial da Meta (ADR-038, opção B · #43), atrás
// de NotificationChannel (ADR-016: trocar o canal = trocar o driver).
//
// Envio: POST https://graph.facebook.com/<versão>/{WHATSAPP_PHONE_NUMBER_ID}/messages
// com `Authorization: Bearer {WHATSAPP_CLOUD_TOKEN}` e corpo de TEMPLATE (fora da
// janela de 24 h a Meta só entrega template aprovado). A resposta traz
// `messages[0].id`, o wamid, que o despachante grava por `outbox_mark_sent`.
// Fonte: developers.facebook.com/documentation/business-messaging/whatsapp/
// messages/send-messages (lida em 30/10/2026) e template-messages (26/10/2026).
//
// Fail-closed, como a Evolution e o Resend: sem as duas envs o canal se declara
// indisponível e devolve erro explícito; a linha fica pendente, nunca perdida.
// O token nunca entra em motivo de erro nem em log.

/**
 * Versão da Graph API usada no envio: a mais recente vigente em 30/10/2026,
 * v26.0, lançada em 29/07/2026. Fim de vida: a Meta ainda não publicou a data
 * (developers.facebook.com/docs/graph-api/changelog/versions, lido em
 * 30/10/2026); pela regra dela de cerca de dois anos por versão, não antes de
 * 2028. O runbook §AN remete a esta constante: trocar a versão é mudar aqui.
 */
export const GRAPH_API_VERSION = 'v26.0'

export interface CloudApiConfig {
  token: string
  phoneNumberId: string
}

/** Motivo da linha quando o ambiente não tem as chaves da Cloud API
 *  (WHATSAPP_CLOUD_TOKEN e WHATSAPP_PHONE_NUMBER_ID): a frase vai para a tela
 *  de Mensagens, então fala da coisa, não do nome da variável. */
export const CHAVES_DA_CLOUD_API_AUSENTES =
  'faltam as chaves da Cloud API do WhatsApp neste ambiente (chaves ausentes)'

export function cloudApiConfigFromEnv(): CloudApiConfig | null {
  const token = process.env.WHATSAPP_CLOUD_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) return null
  return { token, phoneNumberId }
}

/** Corpo do POST: o template com os parâmetros do corpo na ordem. */
export function corpoDoEnvio(message: OutboundMessage & { template: NonNullable<OutboundMessage['template']> }) {
  return {
    messaging_product: 'whatsapp',
    // E.164 sem o "+": o formato de armazenamento é com "+" (profiles.whatsapp_e164)
    to: message.to.replace(/\D/g, ''),
    type: 'template',
    template: {
      name: message.template.name,
      language: { code: IDIOMA_DOS_TEMPLATES },
      components: [
        { type: 'body', parameters: message.template.params.map((text) => ({ type: 'text', text })) },
      ],
    },
    // Volta no recibo de status: é por ele que o recibo acha a linha quando a
    // resposta deste POST se perde (M3-1, outbox_begin_attempt).
    ...(message.attemptId ? { biz_opaque_callback_data: message.attemptId } : {}),
  }
}

/**
 * Falha de rede ANTES de a conexão existir (DNS, rota, recusa, tempo de
 * conectar estourado no undici): o corpo certamente não saiu, e a linha volta
 * para a fila. Fora desta lista (ETIMEDOUT, ECONNRESET, o abort dos 10 s, que
 * pode cair depois do envio) não dá para afirmar: resultado incerto.
 */
const ANTES_DE_CONECTAR = [
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]
function conexaoNuncaAbriu(err: unknown): boolean {
  const causa = (err as { cause?: { code?: unknown } } | null)?.cause
  const codigo = typeof causa?.code === 'string' ? causa.code : ''
  return ANTES_DE_CONECTAR.includes(codigo)
}

export function cloudApiChannel(config: CloudApiConfig | null): NotificationChannel {
  const semToken = (texto: string): string =>
    config ? texto.split(config.token).join('[token]') : texto

  return {
    provider: 'meta',
    indisponivel: config ? null : CHAVES_DA_CLOUD_API_AUSENTES,
    async send(message: OutboundMessage): Promise<ChannelOutcome> {
      if (!config) return { ok: false, error: CHAVES_DA_CLOUD_API_AUSENTES }
      if (!message.template) {
        return { ok: false, error: 'mensagem de WhatsApp sem modelo aprovado (a Meta só entrega modelo aprovado)' }
      }
      const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(config.phoneNumberId)}/messages`

      let res: Response
      try {
        res = await fetch(url, {
          method: 'POST',
          // a Meta sem resposta em 10 s não congela a rodada (mesmo teto da Evolution)
          signal: AbortSignal.timeout(10_000),
          headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(corpoDoEnvio({ ...message, template: message.template })),
        })
      } catch (err) {
        // A exceção crua (nome, código) vai só para o log do servidor; a linha
        // (e a tela de Mensagens) recebe a frase em português.
        const nome = err instanceof Error ? err.name : 'erro'
        const cru = err instanceof Error ? err.message : String(err)
        const causa = (err as { cause?: { code?: unknown } } | null)?.cause?.code
        console.error(semToken(`[whatsapp · meta] envio falhou: ${nome}: ${cru}${causa ? ` (${String(causa)})` : ''}`))
        if (conexaoNuncaAbriu(err)) return { ok: false, error: 'sem conexão com a Meta' }
        const tempo = nome === 'TimeoutError' || nome === 'AbortError'
        // timeout ou conexão caída depois do envio: a Meta pode ter aceitado
        return {
          ok: false,
          error: tempo ? 'a Meta não respondeu em 10 s' : 'a conexão com a Meta caiu durante o envio',
          incerto: true,
        }
      }

      const json = (await res.json().catch(() => null)) as {
        messages?: { id?: unknown }[]
        error?: { message?: unknown; code?: unknown }
      } | null

      if (!res.ok) {
        // A frase da Meta fica (critério 6 da issue: é o que a dona leva ao
        // suporte), precedida do que aconteceu em português.
        const erro = json?.error
        const oQue = res.status >= 500 ? 'a Meta falhou ao responder' : 'a Meta recusou o envio'
        const motivo =
          typeof erro?.message === 'string'
            ? `${oQue} (HTTP ${res.status}, código ${String(erro.code ?? '?')}): ${erro.message}`
            : `${oQue} (HTTP ${res.status}), sem explicar o motivo`
        return {
          ok: false,
          error: semToken(motivo).slice(0, 300),
          // 4xx = recusa (a mensagem não saiu); 5xx = resultado incerto
          ...(res.status >= 500 ? { incerto: true } : {}),
        }
      }

      const wamid = json?.messages?.[0]?.id
      if (typeof wamid !== 'string' || !wamid) {
        return { ok: false, error: `a Meta aceitou (HTTP ${res.status}) sem devolver o id da mensagem`, incerto: true }
      }
      return { ok: true, providerMessageId: wamid }
    },
  }
}
