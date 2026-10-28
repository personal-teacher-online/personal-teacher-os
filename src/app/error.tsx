'use client'

import { useEffect } from 'react'
import { reportClientError } from '@/lib/telemetry/report'

// Boundary de erro inesperado: sem ele, uma exceção não tratada mostrava a
// tela genérica do Next, sem marca e em inglês. Erros CONHECIDOS continuam
// voltando via searchParams nas actions — aqui só chega o imprevisto.
//
// Lote 26/07: o imprevisto também é REPORTADO (POST /api/client-error). Antes,
// um erro que a dona via às 22h só chegava até mim se ela mandasse print.
export default function Error({
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
    <main className="flex min-h-dvh w-full flex-col items-center justify-center bg-paper-50 px-4">
      <div className="w-full max-w-sm rounded-card border border-line-soft bg-paper-0 p-8 text-center shadow-(--shadow-card)">
        <h1 className="font-display text-3xl font-extralight text-ink-900">Algo deu errado</h1>
        <p className="mt-2 text-sm text-ink-600">
          Não foi possível carregar esta tela. Tente de novo — se continuar, fale com a gente no
          WhatsApp de sempre.
        </p>
        <button type="button" onClick={reset} className="btn-ink mt-6 w-full">
          Tentar de novo
        </button>
      </div>
    </main>
  )
}
