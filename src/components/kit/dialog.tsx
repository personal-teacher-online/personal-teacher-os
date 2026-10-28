'use client'

// Primitivo de MODAL CENTRADO (ADR-025 · Lote 1/M2). Radix Dialog vestido com
// os tokens Papel & Tinta — nenhuma escala nova de raio, sombra ou cor.
//
// O motion mora no globals.css (§OVERLAYS DO KIT): `.kit-overlay` e
// `.kit-dialog`. Entrada 200 ms / saída 150 ms, fade + escala 0,95→1; sob
// prefers-reduced-motion a escala some e sobra o fade.
//
// A11y de graça (Radix): foco preso, Esc fecha, fundo inerte, foco devolvido
// ao gatilho, scroll travado. `aria-labelledby` sai do <DialogTitle> — que é
// OBRIGATÓRIO. Sem <DialogDescription>, passe `aria-describedby={undefined}`
// no Content para calar o aviso do Radix em desenvolvimento.
//
// Empilhamento: 50 — a MESMA camada do Sheet, de propósito (revisão adversarial
// 24/07). A escala da casa é 30 popover · 40 nav flutuante · 50 camada de
// sobreposição (painel · trilho · diálogo) · 60 toast; DENTRO da camada 50 a
// ORDEM DE ABERTURA decide, porque todos portalizam para o <body> e o que abre
// depois entra depois no DOM. Por isso um Dialog aberto DE DENTRO de um Sheet
// pinta por cima sem número novo.
// NÃO usar `container` para portalizar dentro do Sheet: o conteúdo dele é
// `overflow-hidden` e recortaria o diálogo.

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'

import { cn } from '@/lib/cn'

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn('kit-overlay fixed inset-0 z-50 bg-ink-900/25', className)}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  container,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Nó do portal (use para abrir um Dialog DENTRO de um Sheet). */
  container?: React.ComponentProps<typeof DialogPrimitive.Portal>['container']
}) {
  return (
    <DialogPortal container={container}>
      <DialogOverlay />
      {/* Centrado pela propriedade `translate` (Tailwind v4), livrando
          `transform` para a escala da animação — as duas não brigam. */}
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'kit-dialog fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-card border border-line bg-paper-0 p-6 shadow-(--shadow-pop)',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute top-5 right-5 text-xs font-semibold text-ink-400 transition-colors duration-(--duration-hover) ease-(--ease-out) hover:text-ink-900">
          ✕<span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-display text-lg font-bold text-ink-900', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm leading-relaxed text-ink-600', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
