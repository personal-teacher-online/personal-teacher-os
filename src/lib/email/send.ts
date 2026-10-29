import 'server-only'

// D14: e-mails de remarcação saem pelo servidor via API do Resend, APÓS o commit da
// RPC, best-effort — falha de envio é LOGADA e nunca desfaz a remarcação. Sem chave
// (dev local / F pendente), loga e segue.

export interface Email {
  to: string
  subject: string
  html: string
  /** F3-D4/M3: enviado como Idempotency-Key ao Resend (hardening de uma linha —
   *  estreita a janela de duplicata do at-least-once; os testes NÃO dependem dele). */
  idempotencyKey?: string
}

export type SendOutcome = { ok: true } | { ok: false; error: string }

/** Variante com RESULTADO — o despachante do outbox (M3) precisa saber se enviou
 *  para marcar sent_at/error. Sem chave configurada devolve erro EXPLÍCITO (no
 *  outbox a linha fica pendente e retenta — nunca perda silenciosa). */
export async function sendEmailWithOutcome(email: Email): Promise<SendOutcome> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? 'Personal Teacher Academy <contato@personal-teacher.com>'
  if (!key) {
    return { ok: false, error: 'RESEND_API_KEY ausente' }
  }
  // Timeout (painel final F3): o despachante processa a fila SEQUENCIALMENTE —
  // uma conexão pendurada no provedor congelaria a rodada inteira. A exceção do
  // abort vira { ok: false } no ponto único do despachante (retry natural).
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(email.idempotencyKey ? { 'Idempotency-Key': email.idempotencyKey } : {}),
    },
    body: JSON.stringify({ from, to: email.to, subject: email.subject, html: email.html }),
  })
  if (!res.ok) {
    return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` }
  }
  return { ok: true }
}

export async function sendEmail(email: Email): Promise<void> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? 'Personal Teacher Academy <contato@personal-teacher.com>'
  if (!key) {
    // Em produção isso é INCIDENTE (env perdida num redeploy apaga notificações em
    // silêncio — achado do painel do M6); em dev é o comportamento esperado.
    const log = process.env.NODE_ENV === 'production' ? console.error : console.log
    log(`[email ${process.env.NODE_ENV === 'production' ? 'PERDIDO — RESEND_API_KEY AUSENTE EM PRODUÇÃO' : 'pulado — sem RESEND_API_KEY (dev)'}] para=${email.to} assunto="${email.subject}"`)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: email.to, subject: email.subject, html: email.html }),
  })
  if (!res.ok) {
    console.error(`[email falhou] para=${email.to} status=${res.status} ${await res.text()}`)
  }
}
