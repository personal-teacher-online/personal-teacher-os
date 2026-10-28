// F3-D8 (revisada 12/07/2026 — ADR-016): adaptador de canal NEUTRO. O outbox
// carrega `channel`; o despachante resolve por este registro. Trocar de provedor
// (Evolution → Cloud API oficial, ou outro) = trocar o driver, nada mais.

export interface OutboundMessage {
  to: string // e-mail OU telefone E.164, conforme o canal
  subject?: string
  html?: string
  text?: string
  idempotencyKey?: string
}

export type ChannelOutcome = { ok: true } | { ok: false; error: string }

export interface NotificationChannel {
  send(message: OutboundMessage): Promise<ChannelOutcome>
}

export type ChannelRegistry = Partial<Record<string, NotificationChannel>>
