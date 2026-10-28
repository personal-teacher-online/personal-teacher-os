'use client'

// TOAST da casa (ADR-025 · Lote 1/M2) — sonner vestido com os tokens Papel &
// Tinta. Sem consumidor ainda: quem monta o <Toaster> no layout é o lote do
// piloto; aqui só nasce a peça.
//
// A roupa vai por VARIÁVEL CSS no próprio elemento (inline vence a folha que o
// sonner injeta em runtime). O que não é variável do sonner — tom de erro
// (`--danger-700`) e de sucesso (`--teal-700`), sombra e o z-index da escala —
// está no globals.css §SONNER, com especificidade suficiente para ganhar dele.
//
// Duração: 4000 ms, o padrão do sonner, mantido de propósito.
// ⚠️ Informação crítica ou acionável NUNCA pode viver só no toast — quando o
// toast é a única via, o WCAG 2.2.1 (Timing Adjustable) é alcançado.

import { Toaster as Sonner, type ToasterProps } from 'sonner'

export function Toaster({ style, ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="top-center"
      style={
        {
          // Superfície, hairline e tinta da casa (o sonner lê estas variáveis).
          '--normal-bg': 'var(--paper-0)',
          '--normal-border': 'var(--line)',
          '--normal-text': 'var(--ink-900)',
          '--border-radius': 'var(--radius-card)',
          // Nunca a pilha de fontes de sistema que o sonner traz (Roboto/Arial).
          fontFamily: 'var(--font-pt-body)',
          // Escala de empilhamento da casa: 60 = toast (o sonner viria com
          // 999999999, número fora da fila).
          zIndex: 60,
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  )
}
