import type { ChannelOutcome, NotificationChannel, OutboundMessage } from './channel'

// Driver WhatsApp via Evolution API (self-hosted, NÃO-oficial — ADR-016; risco de
// banimento do número aceito pelo mantenedor em 12/07/2026, mitigado por conta
// esquentada + volume transacional baixo). Evolution v2: POST
// {URL}/message/sendText/{INSTANCE} com header `apikey` e body { number, text }.
// Fail-closed: sem as três envs o canal devolve erro EXPLÍCITO (a linha do outbox
// fica pendente e retenta — nunca perda silenciosa; mesmo padrão do Resend).

export interface EvolutionConfig {
  url: string
  apiKey: string
  instance: string
}

export function evolutionConfigFromEnv(): EvolutionConfig | null {
  const url = process.env.EVOLUTION_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  const instance = process.env.EVOLUTION_INSTANCE
  if (!url || !apiKey || !instance) return null
  return { url: url.replace(/\/$/, ''), apiKey, instance }
}

export function evolutionChannel(config: EvolutionConfig | null): NotificationChannel {
  return {
    async send(message: OutboundMessage): Promise<ChannelOutcome> {
      if (!config) {
        return { ok: false, error: 'EVOLUTION_URL/API_KEY/INSTANCE ausentes' }
      }
      if (!message.text) {
        return { ok: false, error: 'mensagem de WhatsApp sem texto' }
      }
      // Painel final F3:
      //  - timeout: a Evolution é self-hosted sem SLA; conexão pendurada congelaria
      //    a rodada sequencial do despachante (o abort vira retry natural);
      //  - normalização DEFESA-EM-PROFUNDIDADE: o formato canônico de armazenamento
      //    é E.164 COM '+' (profiles.whatsapp_e164); a Evolution espera dígitos com
      //    DDI — o createJid dela remove o '+', mas o comportamento varia por versão,
      //    então o strip aqui elimina a dependência (handoff-whatsapp §Armadilhas).
      const res = await fetch(
        `${config.url}/message/sendText/${encodeURIComponent(config.instance)}`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
          headers: { apikey: config.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            number: message.to.replace(/\D/g, ''),
            text: message.text,
            // Item 22 (veredito): sem preview de link — o banner gigante do
            // wa.me dominava a conversa; suprimir é o caso ESTÁVEL da Evolution.
            linkPreview: false,
          }),
        },
      )
      if (!res.ok) {
        return { ok: false, error: `Evolution ${res.status}: ${(await res.text()).slice(0, 200)}` }
      }
      return { ok: true }
    },
  }
}
