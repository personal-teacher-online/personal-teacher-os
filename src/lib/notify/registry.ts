import { sendEmailWithOutcome } from '@/lib/email/send'
import type { ChannelRegistry } from './channel'
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
    email: { send: sendEmailWithOutcome },
    whatsapp: cloudApiChannel(cloudApiConfigFromEnv()),
  }
}
