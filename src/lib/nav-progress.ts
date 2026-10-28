// Ciclo de vida da barra de progresso de navegação (#nav-progress).
// Contrato normativo: Design.md §"Barra de progresso de navegação — ciclo de
// vida" (emenda D1, 23/07/2026). Implementação = M-EF-b.
//
// A barra vive enquanto html[data-navigating] está setado; o CSS anima 0→95%.
// Dois consumidores INICIAM a barra por aqui, para compartilharem UM único
// watchdog e a lógica de supersessão:
//   · ClickFeedback (clique em <a href> interno) — cobre os <Link>.
//   · useTrackedRouter (navegação imperativa push/replace).
// A CONCLUSÃO (apagar a barra) é observada pelo ClickFeedback quando
// pathname/search commitam — não é responsabilidade deste módulo, EXCETO o
// watchdog órfão abaixo.

// Watchdog de DURAÇÃO FIXA: se nenhum commit de rota chegar, a barra nunca fica
// presa em 95%. Alinhado ao teto da animação CSS (8s → 95%): passado esse
// tempo, uma navegação sem commit é considerada falha e a barra é limpa.
const NAV_WATCHDOG_MS = 8000

let watchdog: ReturnType<typeof setTimeout> | undefined

/**
 * Inicia (ou REINICIA, em navegação supersedente) a barra de progresso.
 * Idempotente e seguro no servidor. A supersessão reinicia a animação CSS
 * forçando um reflow entre remover e re-setar o atributo.
 */
export function startNavProgress(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement

  // Supersedente: uma nova navegação no meio de outra assume o lugar. Remover +
  // reflow + re-setar reinicia a animação (setar de novo sem isso não reinicia).
  root.removeAttribute('data-navigating')
  void root.offsetWidth // força reflow p/ a animação recomeçar do zero
  root.setAttribute('data-navigating', '')

  if (watchdog) clearTimeout(watchdog)
  watchdog = setTimeout(() => {
    root.removeAttribute('data-navigating')
    watchdog = undefined
  }, NAV_WATCHDOG_MS)
}

/**
 * Conclui/limpa a barra e cancela o watchdog. Chamado no commit observável
 * (mudança de pathname/search), no bfcache (pageshow) e no unmount.
 */
export function endNavProgress(): void {
  if (typeof document === 'undefined') return
  document.documentElement.removeAttribute('data-navigating')
  if (watchdog) {
    clearTimeout(watchdog)
    watchdog = undefined
  }
}

/**
 * Decide se um href-alvo DEVE iniciar a barra, dado o endereço atual.
 * NÃO inicia quando: href externo/outra origem, âncora/hash na mesma página,
 * ou URL final idêntica à atual (nada disso troca o shell da rota).
 * `current` e `href` são resolvidos contra a origem atual.
 */
export function shouldTrackNavigation(href: string, currentHref: string): boolean {
  if (typeof window === 'undefined') return false
  let target: URL
  let current: URL
  try {
    target = new URL(href, currentHref)
    current = new URL(currentHref)
  } catch {
    return false
  }
  // Outra origem: navegação externa, não troca o shell interno.
  if (target.origin !== current.origin) return false
  // URL final igual à atual (inclui âncora/hash na mesma página): pathname +
  // search idênticos = sem troca de shell. O hash sozinho nunca inicia.
  if (target.pathname === current.pathname && target.search === current.search) return false
  return true
}
