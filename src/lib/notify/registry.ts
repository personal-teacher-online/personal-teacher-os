import { sendEmailWithOutcome } from '@/lib/email/send'
import type { ChannelOutcome, ChannelRegistry, NotificationChannel, OutboundMessage } from './channel'
import { cloudApiChannel, cloudApiConfigFromEnv } from './cloud-api'

/**
 * O registro de canais do despachante, num lugar só (#43). A rota do cron e as
 * actions que despacham a fila na hora usam esta função; trocar o provedor de
 * um canal é mudar esta linha, nada mais (ADR-016).
 *
 * E-mail pelo Resend; WhatsApp pela Cloud API oficial da Meta (ADR-038). O
 * driver da Evolution fica no repositório, sem uso, até a retirada (#45).
 * As envs são lidas a cada chamada: a ausência de chave aparece como motivo na
 * linha do outbox, nunca como perda.
 */
export function canaisDoAmbiente(): ChannelRegistry {
  return {
    email: emailPeloResend(),
    whatsapp: cloudApiChannel(cloudApiConfigFromEnv()),
  }
}

/**
 * O e-mail passa pela tentativa do outbox (gate Sol da PR #105, rodada 2): o
 * portão exclusivo no banco impede duas rodadas de mandarem o mesmo e-mail. O
 * envio em si não muda (`sendEmailWithOutcome`, com a chave de dedupe como
 * Idempotency-Key); o id que o Resend devolve no 200 é o que a linha guarda.
 *
 * Toda falha do e-mail é DEFINITIVA (a linha volta para a fila), inclusive a
 * exceção de rede, o timeout e o 5xx — decisão do dono em 30/10/2026 (PR #105,
 * rodada 3): a repetição sai na rodada seguinte (cron horário), dentro das 24 h
 * da Idempotency-Key, que faz o Resend ignorar o envio repetido; despachante
 * parado mais de um dia é produção quebrada, não regra de envio. "Incerta"
 * deixaria a linha presa sem recibo para conferir. O envio interrompido no
 * meio (tentativa aberta que o cron marca incerta) é a issue #107.
 */
function emailPeloResend(): NotificationChannel {
  return {
    provider: 'resend',
    // o mesmo texto que o envio já devolvia sem a chave (send.ts)
    indisponivel: process.env.RESEND_API_KEY ? null : 'RESEND_API_KEY ausente',
    async send(m: OutboundMessage): Promise<ChannelOutcome> {
      try {
        return await sendEmailWithOutcome({
          to: m.to,
          subject: m.subject ?? '',
          html: m.html ?? '',
          idempotencyKey: m.idempotencyKey,
        })
      } catch (err) {
        console.error(`[email] envio falhou na rede: ${String(err)}`)
        return { ok: false, error: 'o envio do e-mail falhou na rede; a próxima rodada tenta de novo' }
      }
    },
  }
}
