'use client'

// Primitivo de MENU DE AÇÕES (ADR-025 · Lote 1/M2) — base do `Actions` no M4.
//
// Motion (globals.css §OVERLAYS DO KIT · `.kit-menu`): ~150 ms. A ENTRADA é
// TRANSIÇÃO (@starting-style), não keyframe: onde reabrir rápido é provável, a
// keyframe re-disparada dá snap e a transição interrompe e segue. A saída é
// keyframe porque o Presence do Radix só segura o nó no DOM enquanto houver
// `animation`.
//
// `transform-origin` do Radix é OBRIGATÓRIO — sem ele o menu cresce do centro,
// tell clássico de componente default. Ele vai como utility aqui (e não no
// `.kit-menu`), porque a regra do globals.css é unlayered e venceria a utility.
//
// Abre no PONTEIRO, não no clique: o `DropdownMenuTrigger` do Radix já dispara
// em `onPointerDown` (conferido na versão instalada) — o atraso perceptível
// some de graça, sem código nosso.
//
// Empilhamento: 30 (popup).
//
// ⚠️ Teclado: o menu do Radix PRENDE o Tab (`event.preventDefault()` na tecla
// Tab) e navega por setas entre `DropdownMenuItem`s. Filhos arbitrários
// (links, <form>) NÃO entram na navegação por seta nem por Tab — quem montar o
// `Actions` no M4 precisa decidir isso (envolver cada filho em
// `<DropdownMenuItem asChild>` é o caminho canônico).

import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'

import { cn } from '@/lib/cn'

function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger(props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuPortal(props: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuContent({
  className,
  sideOffset = 6,
  container,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  container?: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>['container']
}) {
  return (
    <DropdownMenuPortal container={container}>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'kit-menu z-30 flex w-max max-w-[88vw] flex-col gap-3 rounded-card border border-line bg-paper-0 p-4 shadow-(--shadow-pop) [transform-origin:var(--radix-dropdown-menu-content-transform-origin)]',
          className,
        )}
        {...props}
      />
    </DropdownMenuPortal>
  )
}

function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-input px-2 py-1.5 text-sm text-ink-900 outline-none select-none data-[highlighted]:bg-paper-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-2 h-px bg-line-soft', className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
}
