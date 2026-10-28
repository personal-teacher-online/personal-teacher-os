'use client'

// A REDE DE SEGURANÇA DO DESFECHO (K2, 28/07/2026) — quando o Router do Next
// perde a navegação de uma Server Action, o desfecho chega por recarga.
//
// ── O DEFEITO QUE ISTO COBRE (medido, não suposto) ───────────────────────────
// Toda ação do portal termina em `redirect` (ADR-025 · `comFlash`): a frase vai
// num cookie de 15s e a MOLDURA a repinta na tela de destino. Esse desenho
// depende de UMA coisa acontecer no cliente: o React comitar a árvore nova que
// veio no payload da action. Na bancada (`next start`, Next 16.2.10 +
// React 19.2.4), medindo com sondas de render/commit/effect, esse commit
// SIMPLESMENTE NÃO ACONTECE em ~50% dos cliques: a árvore nova renderiza uma vez
// (às vezes nem isso) e nunca é comitada. Não é o toast que atrasa — um
// `useLayoutEffect` no `AvisoLegado` também fica esperando.
//
// Nas telas que desenham o `BotaoEntrar`, o `setState` do tique de 30s força o
// React a terminar o trabalho parado, e o recado pinta cravado em ~29 000 ms.
// Nas telas SEM contador (o briefing, por exemplo) não há quem force: o recado
// NÃO CHEGA NUNCA. Foi assim que o teste do gate do e2e ficou vermelho.
//
// Números da bancada, 8 rodadas por variante, código real:
//   como está ....................... 4 em ~150ms · 4 em ~29 000ms
//   entregando a resposta da action
//   num pedaço só (sem streaming) ... 8 em ~150ms
//   mesma perturbação de TEMPO, mas
//   mantendo o streaming ............ 4 em ~150ms · 4 em ~29 000ms
// A terceira linha existe para matar o confundimento: não é latência, é a
// entrega em pedaços. E não há botão de configuração para isso — `serverActions`
// no `next.config` só expõe `bodySizeLimit` e `allowedOrigins`.
//
// ── POR QUE ISTO NÃO É MASCARAR ──────────────────────────────────────────────
// Mascarar seria encurtar o intervalo do `BotaoEntrar` para o recado aparecer
// mais cedo: o commit continuaria perdido, o socorro continuaria acidental e as
// telas sem contador continuariam mudas. Aqui a aposta é outra: se o commit não
// veio, PARA DE DEPENDER DELE — recarrega a página. O cookie de flash ainda está
// vivo (15s) e o servidor entrega o desfecho no HTML novo, pelo mesmo caminho
// que já funciona sem JavaScript nenhum. O que se entrega é o desfecho, não a
// aparência dele.
//
// ── O PREÇO, DECLARADO ───────────────────────────────────────────────────────
// 1. Ação que legitimamente demore mais que `RESGATE_DO_ENVIO_MS` leva recarga
//    no meio: o POST em curso é abortado no cliente (o que o banco já fez, já
//    está feito) e a pessoa pode ficar sem a frase daquele ato. A folga é grande
//    de propósito — na bancada a action inteira leva ~90ms, e mesmo com a VPS na
//    Alemanha e o Cloudflare na frente sobra uma ordem de grandeza.
// 2. Se a corrida algum dia pegar uma ação cujo destino é OUTRA tela (remarcar
//    bem sucedido devolve ao `/portal`), a recarga deixa a pessoa na tela atual.
//    Hoje isso é teórico: a corrida SÓ foi observada quando o `redirect` volta
//    para o endereço em que a pessoa já está — a etapa 1 → 2 do briefing, que
//    leva para `?etapa=2`, passou 10 de 10 em ~130ms. É por isso que recarregar
//    `location.href` é o destino CERTO e não um paliativo: quando a corrida
//    acontece, o endereço atual já é aonde o `redirect` queria chegar.
// Os dois preços são pequenos perto do que se evita: um ato que aconteceu no
// banco e do qual a pessoa nunca fica sabendo.
//
// ── COMO SE USA ──────────────────────────────────────────────────────────────
// Dentro de um `<form action={serverAction}>`, e só lá: `useFormStatus` enxerga
// exclusivamente o formulário que contém o componente. Não desenha nada.

import { useEffect } from 'react'
import { useFormStatus } from 'react-dom'

/**
 * Quanto se espera pela navegação da action antes de recarregar.
 *
 * Não é um número de conforto: na bancada o caminho feliz inteiro (clique →
 * toast) mede ~150ms, e o caminho quebrado nunca chega. Qualquer valor entre os
 * dois serve; 3s deixa ~20x de folga para rede ruim sem transformar a espera
 * numa segunda cara-metade do defeito.
 */
export const RESGATE_DO_ENVIO_MS = 3_000

export function ResgateDoEnvio({ apos = RESGATE_DO_ENVIO_MS }: { apos?: number }) {
  const { pending } = useFormStatus()

  useEffect(() => {
    if (!pending) return
    // `pending` só volta a `false` quando a árvore nova é COMITADA — que é
    // exatamente o que falta acontecer no defeito. Enquanto o caminho feliz
    // roda, este efeito é limpo antes de o relógio bater.
    const id = setTimeout(() => {
      // `assign` do próprio endereço, e não `reload()`: o documento atual veio
      // de um GET, então isto é uma navegação normal — sem reenvio de POST e
      // sem o balão de "confirmar reenvio do formulário".
      window.location.assign(window.location.href)
    }, apos)
    return () => clearTimeout(id)
  }, [pending, apos])

  return null
}
