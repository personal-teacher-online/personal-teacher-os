'use client'

// SELECT ESTILIZADO (Onda 1 · M3 · K2) — a objeção nº 1 salva do dono, virada
// componente: *"dropdown/menu de seleção = o do TutorBird — cartão branco com
// sombra, raio pequeno, itens com rótulo, altura generosa; NUNCA o menu nativo
// do navegador/macOS"* (`mapeamento-tutorbird-2.md`, § objeções salvas).
//
// Por que Radix e não um `<div>` com `useState`: o menu nativo que estamos
// substituindo trazia teclado e ARIA de graça (setas, Home/End, digitar para
// achar, Esc, papel de `combobox`/`listbox`, anúncio do valor). Trocar a pele
// sem devolver isso seria uma regressão de acessibilidade disfarçada de
// clonagem. O `@radix-ui/react-select` devolve tudo — e, quando há `name`,
// ainda planta um `<select>` ESCONDIDO para o valor viajar num `<form>`
// (é ele, e não a nossa tela, quem fala com o formulário).
//
// ⚠️ DEPENDÊNCIA NOVA: `@radix-ui/react-select` entrou no projeto com esta peça
// (o kit do ADR-025 tinha dialog/dropdown/alert-dialog, não select).
//
// Anatomia medida (2ª/3ª passada): gatilho com cara de input da casa (h36,
// raio da casa, hairline, fundo branco); menu = cartão branco, sombra, raio
// pequeno; itens 14px na VOZ DA NAVEGAÇÃO (Roboto, `.nav-tb-item`) com 32px de
// altura e ✓ no selecionado.
//
// Motion e empilhamento: os mesmos do menu de ações (`.kit-menu`, z-30) — é a
// mesma natureza de peça, e duas gramáticas de abertura no mesmo produto é o
// tipo de detalhe que faz a tela parecer montada por dois times.

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/cn'

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup(props: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        // Cara de input da casa: mesma altura dos botões da toolbar (36),
        // mesmo raio dos campos (10), hairline e fundo de papel. O valor é
        // DADO — `text-sm text-ink-900`, nunca cinza apagado (régua do dono).
        'inline-flex min-h-9 items-center justify-between gap-2 rounded-input border border-line bg-paper-0 px-3 py-1.5 text-sm text-ink-900',
        'transition-colors duration-(--duration-hover) ease-(--ease-in-out)',
        'hover:border-ink-400 focus-visible:border-ac-vivid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ac-vivid',
        // M3-c4 · B2: o "Escolha…" é PLACEHOLDER, e placeholder mora em
        // `--ink-400`. Em `--ink-600` (o cinza do rótulo) ele lia como valor
        // escolhido — a mesma confusão do "R$ 150,00" da captura do dono.
        'disabled:pointer-events-none disabled:opacity-50 data-[placeholder]:text-ink-400',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-600" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = 'popper',
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        sideOffset={sideOffset}
        className={cn(
          'kit-menu z-30 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-card border border-line bg-paper-0 shadow-(--shadow-pop)',
          '[transform-origin:var(--radix-select-content-transform-origin)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="kit-scroll flex max-h-72 flex-col gap-0.5 p-1.5">
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn('px-2 py-1.5 text-sm text-ink-600', className)}
      {...props}
    />
  )
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // VOZ DA NAVEGAÇÃO (lote 10): item de menu é peça Material — Roboto
        // 14/400 —, como no split-button. 32px de altura é a medida deles.
        'nav-tb-item flex min-h-8 cursor-pointer items-center justify-between gap-3 rounded-input px-2 py-1 text-ink-900 outline-none select-none',
        'data-[highlighted]:bg-paper-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator asChild>
        <Check className="h-4 w-4 shrink-0 text-ac-deep" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('-mx-1.5 my-1 h-px bg-line-soft', className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
}
