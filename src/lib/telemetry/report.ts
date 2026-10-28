// Lado CLIENTE da telemetria (sem node:crypto — o hash é do servidor).
// Regra única: falha em silêncio. Nenhuma dessas funções pode lançar, nem
// devolver promessa rejeitada — telemetria que derruba a página é pior que
// telemetria nenhuma.

/** Envia sem esperar resposta; sendBeacon sobrevive à navegação, fetch é o plano B. */
function post(url: string, body: string): void {
  try {
    // text/plain é tipo "safelisted": não dispara preflight nem exige CORS.
    // O servidor lê o corpo cru com req.text() e faz o JSON.parse.
    const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' })
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon(url, blob)) return
    }
    void fetch(url, { method: 'POST', body: blob, keepalive: true }).catch(() => {})
  } catch {
    /* silêncio proposital */
  }
}

export function reportPageView(path: string): void {
  try {
    post('/api/beacon', JSON.stringify({ path, event: 'page_view' }))
  } catch {
    /* silêncio proposital */
  }
}

/**
 * `name` é o TIPO do erro (TypeError, ChunkLoadError…) e entra na assinatura
 * no servidor: bug de código e bundle velho não podem dividir o mesmo balde.
 */
export function reportClientError(
  message: unknown,
  stack?: unknown,
  path?: string,
  name?: unknown,
): void {
  try {
    const msg = typeof message === 'string' ? message : String(message ?? '')
    if (!msg.trim()) return
    post(
      '/api/client-error',
      JSON.stringify({
        name: typeof name === 'string' && name.trim() ? name.slice(0, 120) : null,
        message: msg.slice(0, 5_000),
        stack: typeof stack === 'string' ? stack.slice(0, 40_000) : null,
        path: path ?? (typeof location !== 'undefined' ? location.pathname : null),
      }),
    )
  } catch {
    /* silêncio proposital */
  }
}
