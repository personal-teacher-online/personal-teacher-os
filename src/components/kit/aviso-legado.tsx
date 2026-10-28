'use client'

// PONTE DE FEEDBACK DA CONVIVÊNCIA — enquanto uma ação VELHA terminar com
// `redirect('…?msg=…&n=…')`, é aqui que a frase dela aparece: um toast do kit,
// na hora de chegar.
//
// Nasceu no admin (Onda 1 · M3, para as ações de aluno) e subiu para o kit na
// Onda do Portal · P1, quando as 11 telas do portal passaram a usá-la no lugar
// da faixa `FlashMsg`. O tom sai de `tomDoAviso` (`src/lib/kit/tom-do-aviso.ts`),
// que enumera as frases de ACERTO e trata o resto como erro.
//
// Isto NÃO é a tela nova adotando `?msg=`. Tela nova não PRODUZ `?msg=` nenhum
// — as ações dela gravam a frase num cookie de flash e a MOLDURA a entrega aqui
// (P4/P5). O que este componente faz pelas telas VELHAS é LER um recado que elas
// ainda mandam pela URL, para que matar a faixa antiga não engula
// "Convite enviado! 🎉" nem, pior, "Falha: informe nome e cidade." — a única
// explicação que a dona teria de um wizard que voltou ao passo 1.
//
// O nome envelheceu no P5: o PORTAL inteiro já entra por cookie, e é este
// componente quem pinta os dois caminhos. A ponte da URL sobrevive só no admin;
// quando a onda das telas dele chegar, o `chave`/`?msg=` sai e o que fica é o
// pintor de recado do kit.
//
// O `n=` da URL velha (nonce anti-repetição) entra como chave do efeito: duas
// ações seguidas com a MESMA frase continuam avisando duas vezes.
//
// SEM JAVASCRIPT (revisão adversarial P1 · F1). O toast só existe depois da
// hidratação — e a ação que produziu o recado é um POST de Server Action, que
// chega ao destino com ou sem JS no cliente. Quando ele falta, quem fala é o
// `<noscript>` abaixo: a MESMA faixa do `FlashMsg` legado (`.flash-toast`,
// `role="status"`, e com ela o sumiço por CSS — 5s no acerto, 8s na recusa),
// server-safe, com o tom vindo da mesma função. Com JS o navegador não
// renderiza nada disso e o caminho continua sendo só o toast — nunca os dois ao
// mesmo tempo. A tinta é a da onda (`ok-*`/`danger-*`), não o `teal` do
// FlashMsg: dentro do kit, a paleta velha é aceite reprovado (onda1-aceites).

import { useEffect } from 'react'
import { toast } from 'sonner'

import { tomDoAviso } from '@/lib/kit/tom-do-aviso'

/** O erro do `FlashMsg` ficava 8s na tela; o do toast, 4s. Recusa é o que mais
 *  precisa de tempo de leitura — o sucesso mantém o padrão do Toaster. */
const LEITURA_DO_ERRO_MS = 8000

export function AvisoLegado({ mensagem, chave }: { mensagem: string; chave?: string }) {
  const erro = tomDoAviso(mensagem) === 'erro'

  useEffect(() => {
    if (!mensagem) return
    // A chave mata o toast DUPLICADO: o efeito do Strict Mode roda duas vezes em
    // desenvolvimento, e o `n=` da URL já distingue duas ações com a mesma frase.
    const id = chave ?? mensagem
    if (erro) toast.error(mensagem, { id, duration: LEITURA_DO_ERRO_MS })
    else toast.success(mensagem, { id })
  }, [mensagem, chave, erro])

  if (!mensagem) return null

  return (
    <noscript>
      <p
        role="status"
        className={`flash-toast fixed top-3 left-1/2 z-60 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-card border p-3 text-sm font-medium shadow-(--shadow-pop) ${
          erro
            ? 'flash-toast--error border-danger-700/40 bg-paper-0 text-danger-700'
            : 'border-ok-700/40 bg-paper-0 text-ok-700'
        }`}
      >
        {mensagem}
      </p>
    </noscript>
  )
}
