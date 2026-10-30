// F3-D8 (revisada 12/07/2026 — ADR-016): adaptador de canal NEUTRO. O outbox
// carrega `channel`; o despachante resolve por este registro. Trocar de provedor
// (Evolution → Cloud API oficial, ou outro) = trocar o driver, nada mais.

export interface OutboundMessage {
  to: string // e-mail OU telefone E.164, conforme o canal
  subject?: string
  html?: string
  text?: string
  idempotencyKey?: string
  /** Cloud API (ADR-038, #43): o template aprovado na Meta, com os parâmetros
   *  do corpo na ordem de `{{1}}`, `{{2}}`, … (catálogo de whatsapp-templates). */
  template?: { name: string; params: string[] }
  /** A tentativa de envio aberta no outbox (`outbox_begin_attempt`). Vai junto
   *  da mensagem e volta no recibo, que acha a linha por ela quando a resposta
   *  do envio se perdeu. */
  attemptId?: string
}

export type ChannelOutcome =
  | { ok: true; providerMessageId?: string }
  | {
      ok: false
      error: string
      /** O provedor PODE ter aceitado (timeout, 5xx, conexão caída depois de
       *  enviar): a linha fica presa e não volta sozinha para a fila. Ausente =
       *  recusa definitiva, a mensagem certamente não saiu. */
      incerto?: boolean
    }

export interface NotificationChannel {
  send(message: OutboundMessage): Promise<ChannelOutcome>
  /** Provedor que devolve o id da mensagem. Presente, o despachante abre a
   *  tentativa antes do envio e fecha por `outbox_mark_sent` (M3-1, #42). */
  provider?: 'meta' | 'resend'
  /** Por que o canal não pode enviar neste ambiente (chaves ausentes). O
   *  despachante deixa a linha pendente com este motivo, sem abrir tentativa. */
  indisponivel?: string | null
}

export type ChannelRegistry = Partial<Record<string, NotificationChannel>>
