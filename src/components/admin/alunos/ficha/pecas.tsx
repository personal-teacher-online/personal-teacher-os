// PEÇAS DA FICHA (Onda 1 · M3-2) — a anatomia medida da ficha do TutorBird,
// em três peças que as cinco abas reusam.
//
// 1. PARES rótulo/valor em GRADE com hairline (3ª passada do mapeamento:
//    "pares rótulo/valor em grade com hairline, '-' para vazio"). O rótulo é
//    rótulo (14/400 cinza legível) e o valor é DADO (14/500 tinta) — a régua
//    de legibilidade proíbe o inverso, que é o que a ficha velha fazia com
//    `text-[10px] uppercase tracking-wide` no rótulo.
//    VAZIO É "—", nunca campo sumido: a ausência do dado é informação.
// 2. SEÇÃO com título e o LÁPIS à direita: cada bloco da aba diz o que é e
//    oferece a edição dele, que abre em Sheet.
// 3. CAMPOS de formulário na grade de 2 colunas com rótulo bold em cima
//    (objeção nº 2 salva do dono, captura 36).
//
// Server-safe: zero client JS. O único componente cliente que estas peças
// tocam é o `Select` do kit (Radix), e ele é importado por quem monta o form.
import Link from 'next/link'
import { Pencil, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

/* ========================================================================== */
/* 1. Pares rótulo/valor                                                       */
/* ========================================================================== */

export interface Par {
  rotulo: string
  /**
   * O rótulo COM MARCAÇÃO, quando ele não é texto puro — a leitura do briefing
   * mostra a chave crua do jsonb em `<code>` quando o dicionário não conhece a
   * pergunta. `rotulo` continua sendo o texto (é ele que identifica a linha).
   */
  rotuloNode?: ReactNode
  /** `null`/vazio vira "—": o campo continua na grade, dizendo que está vazio */
  valor?: ReactNode
  /** ocupa a linha inteira (endereço, observação longa) */
  largo?: boolean
}

export function Pares({ itens, className }: { itens: Par[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-8 sm:grid-cols-2', className)}>
      {itens.map((p) => (
        <div
          key={p.rotulo}
          className={cn(
            'flex flex-col gap-0.5 border-b border-line-soft py-3 last:border-b-0',
            p.largo && 'sm:col-span-2',
          )}
        >
          <dt className="text-sm text-ink-600">{p.rotuloNode ?? p.rotulo}</dt>
          <dd className="text-sm font-medium break-words text-ink-900">
            {p.valor === null || p.valor === undefined || p.valor === '' ? '—' : p.valor}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/* ========================================================================== */
/* 2. Seção de aba                                                             */
/* ========================================================================== */

/** O lápis do TutorBird: ícone + palavra (ação sem rótulo é enigma). */
export function Lapis({ href, rotulo }: { href: string; rotulo: string }) {
  return (
    <Link
      href={href}
      title={rotulo}
      className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-input px-2.5 text-sm font-medium text-ink-600 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-paper-100 hover:text-ac-deep"
    >
      <Pencil aria-hidden className="h-4 w-4" />
      {rotulo}
    </Link>
  )
}

export function Secao({
  titulo,
  apoio,
  acao,
  children,
  className,
}: {
  titulo: string
  apoio?: ReactNode
  acao?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-2 border-b border-line px-5 py-5 last:border-b-0', className)}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="title-section text-ink-900">{titulo}</h3>
        {acao}
      </header>
      {apoio && <p className="max-w-prose text-sm leading-relaxed text-ink-600">{apoio}</p>}
      {children}
    </section>
  )
}

/** Lista em hairline dentro de uma seção (aulas, créditos, cobranças). */
export function Linhas({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul className={cn('flex flex-col divide-y divide-line-soft rounded-input border border-line', className)}>
      {children}
    </ul>
  )
}

export function Linha({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <li className={cn('flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5', className)}>
      {children}
    </li>
  )
}

/* ========================================================================== */
/* 3. Campos de formulário (dentro dos Sheets)                                 */
/* ========================================================================== */

/**
 * O campo de formulário da casa.
 *
 * M3-c4 · B2 — o placeholder mora em `--ink-400`, NUNCA no cinza do rótulo
 * (`--ink-600`). A captura do dono mostrava "Valor da aula — R$ 150,00" e ele
 * leu o campo como PREENCHIDO: o exemplo estava escrito com o mesmo peso de
 * cor do dado. Placeholder é sugestão; dado é `--ink-900`. A régua completa
 * (todo exemplo plausível começa com "ex.: ") está no Design.md.
 */
export const CAMPO =
  'min-h-11 w-full rounded-input border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-colors duration-(--duration-hover) ease-(--ease-in-out) focus:border-ac-vivid focus:outline-2 focus:outline-offset-1 focus:outline-ac-vivid'

/** Grade de DUAS colunas alinhada (objeção nº 2 do dono). */
export function GradeDeCampos({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', className)}>{children}</div>
}

/**
 * Um campo do formulário: rótulo bold em cima, controle, apoio discreto embaixo
 * — e, desde o M3-c4 · B3, o PARÁGRAFO DO ERRO, que nasce escrito e `hidden`.
 *
 * Por que o erro já vem no HTML do servidor: o corpo destes formulários é
 * renderizado no servidor e não volta a renderizar no cliente. O `FormValidado`
 * do kit só acende e apaga o que já está aqui (`data-slot="campo-erro"`), em
 * vez de criar nó por DOM — assim a frase existe mesmo antes do JavaScript
 * chegar, e o leitor de tela acha o `role="alert"` no lugar certo.
 */
export function Campo({
  rotulo,
  apoio,
  largo,
  para,
  exigencia,
  children,
}: {
  rotulo: string
  /** o "Optional"/consequência discreto embaixo do campo */
  apoio?: string
  largo?: boolean
  /**
   * `id` do controle quando ele NÃO é um input nativo (o gatilho do Select do
   * kit é um `<button>`): aí o rótulo aponta por `for` em vez de embrulhar o
   * campo — embrulhar um botão faz o clique no rótulo abrir e fechar o menu.
   */
  para?: string
  /**
   * A frase de erro quando o campo é obrigatório e está vazio — no tom da casa
   * ("Informe o valor da aula"), porque só a tela sabe o nome do dado. Sem ela,
   * o `FormValidado` cai numa frase genérica; com ela, o erro fala português.
   */
  exigencia?: string
  children: ReactNode
}) {
  const classe = cn('flex flex-col gap-1.5', largo && 'sm:col-span-2')
  const apoioEl = apoio && <span className="text-sm leading-relaxed text-ink-600">{apoio}</span>
  const erroEl = (
    <p
      data-slot="campo-erro"
      data-exigencia={exigencia ?? ''}
      role="alert"
      hidden
      className="flex items-start gap-1.5 text-sm leading-relaxed text-danger-700"
    >
      <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <span data-slot="campo-erro-texto">{exigencia ?? ''}</span>
    </p>
  )

  // O erro fica FORA do `<label>` de propósito: texto dentro do rótulo entra no
  // nome acessível do campo, e o nome do campo não é o erro dele.
  return (
    <div data-slot="campo" className={classe}>
      {para ? (
        <>
          <label htmlFor={para} className="text-sm font-semibold text-ink-900">
            {rotulo}
          </label>
          {children}
          {apoioEl}
        </>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-900">{rotulo}</span>
          {children}
          {apoioEl}
        </label>
      )}
      {erroEl}
    </div>
  )
}
