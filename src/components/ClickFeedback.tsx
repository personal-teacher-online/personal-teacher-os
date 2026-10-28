'use client'

// Feedback de clique GLOBAL (QA 14/07/2026): no e2e, o aluno clicou num horário,
// não viu resposta nenhuma, clicou de novo — e nasceram DUAS remarcações e um
// 404. Este componente (montado uma vez no root layout) fecha as três frentes:
//
// 1. SUBMIT de qualquer form: marca o botão enviado com [data-pending] (spinner
//    via globals.css) e o form com [data-submitting] (pointer-events: none) —
//    o segundo clique, em QUALQUER botão do form, não dispara nada.
// 2. Reenvio do MESMO form: bloqueado de verdade (preventDefault), não só
//    visualmente.
// 3. Navegação por link: barra de progresso fina no topo (#nav-progress) até a
//    rota nova renderizar (o pathname/search mudar).
//
// Zero mudança nas actions/regras — é só percepção + trava de duplo envio.
//
// QUANDO A MARCA TEM DE MORRER NA HORA (P6, 28/07/2026 — defeito LATENTE da
// Onda 1, achado pela rodada adversarial do login e corrigido aqui na raiz):
// este ouvinte é de CAPTURA no `document`, então ele marca ANTES de qualquer
// `onSubmit` de React (que roda no contêiner raiz, na subida). Se o envio for
// CANCELADO depois disso, a marca ficava presa e o `pointer-events: none` do
// `form[data-submitting]` congelava o formulário por até 12s — a pessoa não
// conseguia nem corrigir o campo que ela mesma deixou vazio.
//   · validação NATIVA: nunca foi o caso — o navegador segura o envio e o
//     evento `submit` sequer é disparado (medido também no jsdom);
//   · `FormValidado` (kit): é o caso real. Ele leva `noValidate`, então o
//     evento DISPARA, e é ele quem chama `preventDefault()` ao achar campo
//     inválido. Todo formulário do admin/portal que usa o kit estava exposto.
// O DISCRIMINADOR, checado num microtask (que roda depois do despacho inteiro,
// portanto já com o veredito de todo mundo): o envio foi cancelado E sobrou
// campo inválido no formulário. As duas condições juntas são precisas —
// `defaultPrevented` sozinho não serve, porque o React CANCELA o evento de todo
// `<form action={fn}>` para rodar a action (e nesses o envio de fato aconteceu);
// campo inválido sozinho também não, porque um form com `noValidate` e sem
// `FormValidado` enviaria mesmo inválido. Form válido = nada muda: a marca fica
// até a rota trocar, o `pageshow` ou o cinto de 12s.
import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { endNavProgress, shouldTrackNavigation, startNavProgress } from '@/lib/nav-progress'

/**
 * O cinto de 12s de cada formulário.
 *
 * Guardado para poder ser CANCELADO: sem isto, o watchdog de um envio que foi
 * barrado pela validação continuaria vivo e apagaria, 12s depois, a marca de um
 * envio POSTERIOR e legítimo do mesmo formulário.
 */
const cintos = new WeakMap<HTMLFormElement, ReturnType<typeof setTimeout>>()

function destravar(form: HTMLFormElement) {
  const cinto = cintos.get(form)
  if (cinto !== undefined) {
    clearTimeout(cinto)
    cintos.delete(form)
  }
  form.removeAttribute('data-submitting')
  for (const b of form.querySelectorAll('[data-pending]')) b.removeAttribute('data-pending')
}

/**
 * Sobrou campo inválido no formulário AGORA?
 *
 * Lê `validity` direto em vez de chamar `form.checkValidity()` de propósito: o
 * `checkValidity` dispara evento `invalid` em cada controle reprovado, e isto
 * aqui é uma pergunta, não um ato.
 */
function temCampoInvalido(form: HTMLFormElement): boolean {
  return Array.from(form.elements).some(
    (el) =>
      (el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement) &&
      el.willValidate &&
      !el.validity.valid,
  )
}

export function ClickFeedback() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Rota mudou → CONCLUSÃO OBSERVÁVEL (primeiro commit de pathname/search): apaga
  // a barra, cancela o watchdog e destrava forms (o caso real é a action
  // redirecionar; o DOM novo já vem limpo, isto cobre bfcache e re-render
  // parcial). Ver contrato §"Barra de progresso de navegação".
  useEffect(() => {
    endNavProgress()
    for (const f of document.querySelectorAll('form[data-submitting]')) {
      if (f instanceof HTMLFormElement) destravar(f)
    }
    for (const b of document.querySelectorAll('[data-pending]')) {
      b.removeAttribute('data-pending')
    }
  }, [pathname, searchParams])

  useEffect(() => {
    const onSubmit = (e: Event) => {
      const form = e.target
      if (!(form instanceof HTMLFormElement)) return
      if (form.hasAttribute('data-submitting')) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      form.setAttribute('data-submitting', '')
      // S2-8 (e2e): cinto — se a resposta se perder, a trava expira sozinha.
      cintos.set(
        form,
        setTimeout(() => destravar(form), 12_000),
      )
      const ev = e as SubmitEvent
      // O submitter não é desabilitado (disabled removeria name/value do
      // FormData); o CSS de [data-pending] + o pointer-events do form travam.
      ev.submitter?.setAttribute('data-pending', '')
      // O veredito de todos os ouvintes já saiu quando este microtask roda (o
      // despacho do evento é síncrono). Se o envio foi cancelado E sobrou campo
      // inválido, nada saiu daqui: destrava na hora, sem esperar os 12s.
      queueMicrotask(() => {
        if (e.defaultPrevented && temCampoInvalido(form)) destravar(form)
      })
    }

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]')
      if (!a) return
      // TrackedLink já acende pelo onNavigate (roda DEPOIS do cancelamento do
      // consumidor); este listener em CAPTURA acenderia cedo demais e órfão um
      // link cancelado. Deixa os tracked para o onNavigate deles.
      if (a.hasAttribute('data-tracked-link')) return
      // Nova aba / download nunca trocam o shell desta página.
      if (a.getAttribute('target') === '_blank' || a.hasAttribute('download')) return
      const href = a.getAttribute('href') ?? ''
      if (!href) return
      // Acende SÓ quando a navegação troca o shell: interno, URL final ≠ atual,
      // sem ser só hash na mesma página (shouldTrackNavigation resolve tudo).
      // Navegação supersedente reinicia a barra (startNavProgress).
      if (shouldTrackNavigation(href, window.location.href)) startNavProgress()
    }

    // pageshow do bfcache (voltar do Safari iOS): destrava tudo.
    const onPageShow = () => {
      endNavProgress()
      for (const f of document.querySelectorAll('form[data-submitting]')) {
        if (f instanceof HTMLFormElement) destravar(f)
      }
      for (const b of document.querySelectorAll('[data-pending]')) {
        b.removeAttribute('data-pending')
      }
    }

    document.addEventListener('submit', onSubmit, true)
    document.addEventListener('click', onClick, true)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('submit', onSubmit, true)
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  return <div id="nav-progress" aria-hidden="true" />
}
