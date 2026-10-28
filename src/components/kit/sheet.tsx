'use client'

// PAINEL LATERAL DIREITO (ADR-025 · Lote 1/M2 · vestido na clonagem TutorBird
// de 26/07/2026) — base do formulário das telas novas e do wizard do M3.
// Radix Dialog (não há "sheet" no Radix) com os tokens da casa.
//
// ANATOMIA MEDIDA no painel de criar aluno do TutorBird:
// · largura 800px numa viewport de 1512 (~53%) → aqui `min(800px, 60vw)` no
//   desktop e TELA CHEIA no celular;
// · cabeçalho: título 24px/600 + botão "expandir para tela cheia" + ✕;
// · corpo em SEÇÕES separadas por hairline, cada rótulo com uma frase de apoio
//   (é o `SheetSection`, com `hint`);
// · RODAPÉ FIXO com hairline no topo: [Cancelar] à esquerda, [Voltar] fantasma
//   e [Avançar]/[Salvar] sólido à direita — nunca some no scroll;
// · véu escurecendo o resto da tela.
//
// Motion (globals.css §OVERLAYS DO KIT): entra em 240 ms com `--ease-out`, sai
// em 180 ms. Os 500 ms que o shadcn traz de fábrica estão fora do contrato —
// "a real drag" da NN/g.
//
// O fio-assinatura de degradê que corria no topo do painel saiu junto com o do
// admin: a marca aqui é a cor do botão e do cabeçalho, não um friso.
//
// A11y de graça (Radix): foco preso, Esc fecha, fundo inerte, foco devolvido
// ao gatilho, scroll travado. O <SheetTitle> é OBRIGATÓRIO (é ele que vira o
// `aria-labelledby`); sem <SheetDescription>, passe `aria-describedby={undefined}`.
//
// Empilhamento: 50 (painel lateral, escala da casa).

import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { Maximize2, Minimize2, X } from 'lucide-react'

import { cn } from '@/lib/cn'

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetPortal(props: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn('kit-overlay fixed inset-0 z-50 bg-ink-900/40', className)}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  container,
  expansivel = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  container?: React.ComponentProps<typeof SheetPrimitive.Portal>['container']
  /** o botão de expandir para tela cheia (padrão do TutorBird) */
  expansivel?: boolean
}) {
  const [cheio, setCheio] = React.useState(false)

  return (
    <SheetPortal container={container}>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-cheio={cheio ? '' : undefined}
        className={cn(
          'kit-sheet fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden border-l border-line bg-paper-0 shadow-(--shadow-pop)',
          cheio ? 'md:w-full' : 'md:w-[min(800px,60vw)]',
          className,
        )}
        {...props}
      >
        {children}
        {/* Os controles vêm por ÚLTIMO no DOM de propósito (posicionados no
            canto por CSS): assim o foco de abertura cai no primeiro campo do
            painel, e não num botão de janela. */}
        <div className="absolute top-4 right-5 flex items-center gap-1">
          {expansivel && (
            <button
              type="button"
              onClick={() => setCheio((v) => !v)}
              aria-pressed={cheio}
              title={cheio ? 'Voltar ao painel' : 'Expandir para tela cheia'}
              className="hidden h-8 w-8 items-center justify-center rounded-btn text-ink-400 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-paper-100 hover:text-ink-900 md:inline-flex"
            >
              {cheio ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              <span className="sr-only">{cheio ? 'Voltar ao painel' : 'Expandir para tela cheia'}</span>
            </button>
          )}
          <SheetPrimitive.Close className="inline-flex h-8 w-8 items-center justify-center rounded-btn text-ink-400 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-paper-100 hover:text-ink-900">
            <X className="h-4 w-4" />
            <span className="sr-only">Fechar</span>
          </SheetPrimitive.Close>
        </div>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

/** Cabeçalho fixo do painel (não rola com o corpo). */
function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex shrink-0 flex-col gap-1 border-b border-line px-6 py-4 pr-28', className)}
      {...props}
    />
  )
}

/** Corpo rolável — a rolagem NÃO vaza para a página (overscroll contain). */
function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sheet-body" className={cn('kit-scroll flex-1 px-6 pb-8', className)} {...props} />
}

/**
 * Seção do corpo: título + UMA frase de apoio, separada da anterior por
 * hairline. É a régua do TutorBird ("Public — Visible on the Student Portal…"):
 * cada bloco diz o que faz antes de pedir o dado.
 */
function SheetSection({
  title,
  hint,
  className,
  children,
  ...props
}: React.ComponentProps<'section'> & { title: string; hint?: string }) {
  return (
    <section
      data-slot="sheet-section"
      className={cn('flex flex-col gap-3 border-b border-line-soft py-5 last:border-b-0', className)}
      {...props}
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        {hint && <p className="text-sm leading-relaxed text-ink-600">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * Rodapé FIXO. `cancel` à esquerda; o resto (voltar/avançar/salvar) à direita,
 * na ordem em que chega.
 */
function SheetFooter({
  cancel,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { cancel?: React.ReactNode }) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        'flex shrink-0 items-center justify-between gap-3 border-t border-line bg-paper-0 px-6 py-4',
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2">{cancel}</div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-2xl font-semibold text-ink-900', className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm leading-relaxed text-ink-600', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetPortal,
  SheetClose,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetSection,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
