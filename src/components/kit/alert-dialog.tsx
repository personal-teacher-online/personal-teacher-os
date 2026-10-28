'use client'

// Primitivo de CONFIRMAÇÃO DESTRUTIVA (ADR-025 · Lote 1/M2). O M4 acabou
// resolvendo o encerrar com type-to-confirm DENTRO do Sheet (mais exigente que
// um botão de confirmar), então este primitivo ainda NÃO tem consumidor —
// achado do harness M5, decisão do orquestrador (27/07): ele FICA, porque o
// consumidor mapeado dele é a onda AGENDA (o "Delete Event" do TutorBird é um
// modal de confirmação com checkboxes de aviso — mapeamento §3ª passada). Se a
// Agenda escolher outro desenho, aí sim vira código morto e sai.
// Diferença para o `dialog`: o alert-dialog não fecha
// por clique fora, obriga uma escolha explícita e leva o foco para o botão de
// cancelar. Radix já entrega isso; aqui só entra a roupa da casa.
//
// Motion: as MESMAS classes do dialog (`.kit-overlay` / `.kit-dialog`) — o
// contrato de motion não muda por semântica.
//
// A mutação continua saindo de um <form action={serverAction}>: envolva o
// <form> por FORA do rodapé e use `<AlertDialogAction asChild>` num
// `<button type="submit">`, para o fechamento não cortar o envio.
//
// Empilhamento: 50 — a MESMA camada do Sheet (revisão adversarial 24/07). Uma
// confirmação disparada DE DENTRO de um painel abre DEPOIS dele, entra depois
// no <body> e por isso pinta por cima, sem número novo na escala. Ver o
// cabeçalho do `dialog.tsx` para o contrato completo. NÃO usar `container`
// apontando para o Sheet: o conteúdo dele é `overflow-hidden`.

import * as React from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'

import { cn } from '@/lib/cn'

function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger(props: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogPortal(props: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogOverlay({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn('kit-overlay fixed inset-0 z-50 bg-ink-900/25', className)}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  container,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  container?: React.ComponentProps<typeof AlertDialogPrimitive.Portal>['container']
}) {
  return (
    <AlertDialogPortal container={container}>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          'kit-dialog fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-card border border-line bg-paper-0 p-6 shadow-(--shadow-pop)',
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-dialog-header" className={cn('flex flex-col gap-1.5', className)} {...props} />
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('font-display text-base font-bold text-ink-900', className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-sm leading-relaxed text-ink-600', className)}
      {...props}
    />
  )
}

/** Botão que CONFIRMA. Veste `.btn-ink` por padrão — vocabulário que já existe;
 *  o tom de perigo é decidido por quem usa (o `ConfirmAction` de hoje confirma
 *  em texto `linkDanger`), passando `className`. */
function AlertDialogAction({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return <AlertDialogPrimitive.Action data-slot="alert-dialog-action" className={cn('btn-ink', className)} {...props} />
}

function AlertDialogCancel({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel data-slot="alert-dialog-cancel" className={cn('btn-paper', className)} {...props} />
  )
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
