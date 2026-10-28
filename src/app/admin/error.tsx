'use client'

// BOUNDARY DE ERRO DO ADMIN (revisão adversarial nº 1, C1).
//
// Existe por causa de uma decisão da camada de dados: leitura que falha ESTOURA
// (`src/data/admin/home.ts`), em vez de virar lista vazia. Sem esta tela, o
// preço dessa honestidade seria o boundary genérico da raiz, que troca a
// moldura do admin por uma página em branco. Aqui a falha fica dentro do shell:
// o trilho continua no lugar e a dona escolhe entre tentar de novo e ir para
// outra tela.
//
// Tom do Design.md: dizer o que aconteceu sem fingir que está tudo bem, e sem
// despejar stack trace na cara de quem só queria ver a agenda — o detalhe
// técnico fica discreto, mas VISÍVEL (é o que ela me manda por WhatsApp).
import { useEffect } from 'react'

import { reportClientError } from '@/lib/telemetry/report'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // O digest é a única ponte com o log do servidor quando o Next apaga a
    // mensagem original em produção.
    reportClientError(
      error.digest ? `${error.message} [digest ${error.digest}]` : error.message,
      error.stack,
      undefined,
      error.name,
    )
  }, [error])

  return (
    <main className="flex flex-col gap-4">
      <div className="card-ac max-w-xl p-6">
        <span className="text-[11px] font-bold tracking-[0.14em] text-ink-400 uppercase">Falha</span>
        <h2 className="mt-1 font-display text-2xl font-bold text-ink-900">
          Não consegui carregar esta tela
        </h2>
        <p className="mt-2 text-sm text-ink-600">
          Os dados não vieram do banco — então não dá para dizer o que está na agenda nem quanto
          entrou no mês. Prefiro não mostrar nada a mostrar um número errado.
        </p>
        <p className="mt-3 font-mono text-xs break-words text-ink-400">
          {error.message}
          {error.digest && ` · ${error.digest}`}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={reset} className="btn-ac">
            Tentar de novo
          </button>
          <a href="/admin/agenda" className="btn-ac-soft">
            Ir para a agenda
          </a>
        </div>
      </div>
    </main>
  )
}
