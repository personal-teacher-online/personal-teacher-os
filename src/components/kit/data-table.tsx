'use client'

// TABELA DE TRABALHO (Onda 1 · M3 · K1) — a lista do TutorBird, medida na 3ª
// passada e clonada aqui como peça de kit: nasce para o hub de Alunos e serve
// Contratos (M4), Agenda e portal sem virar framework.
//
// ANATOMIA MEDIDA
// · cabeçalho com FUNDO cinza claro (`--paper-100`), célula `text-sm
//   font-semibold` em cinza legível, hairline embaixo;
// · linha com hover suave e hairline entre linhas;
// · primeira célula = identidade (avatar + nome + pill sob o nome);
// · números à direita, `tabular-nums`;
// · kebab (⋮) por linha, com o MESMO menu do split-button (itens 14px na voz
//   da navegação, 32px de altura);
// · rodapé de paginação "Itens por página 25/50 · X–Y de Z · ‹ 1 ›".
//
// REGRA §7 DO PLANO DE CLONAGEM — A LINHA É ÂNCORA DE VERDADE.
// Nada de `onClick` em `<tr>`: uma linha clicável por JS não abre em nova aba,
// não aparece no menu de contexto, não recebe foco e não diz para onde vai. O
// que existe aqui é um `<a>` REAL na célula de identidade, ampliado por
// `::after` até as bordas da linha. Teclado, ctrl+clique e "copiar endereço"
// funcionam porque é um link — e a área de acerto é a linha inteira porque o
// pseudo-elemento é grande.
// A célula do kebab sobe (`relative z-10`) para ficar ACIMA da capa do link;
// sem isso o menu seria inalcançável.
//
// ⚠️ QUEM SEGURA A CAPA É `.linha-ancora` (hotfix de 28/07/2026), não o
// `relative` da linha: `position: relative` em `<tr>` é INDEFINIDO na CSS 2.1
// §9.4.3 e o Safari (iOS) não o honra — sem a classe, no iPhone toda capa se
// mede pelo painel e o ÚLTIMO link da página engole o toque de TODAS as linhas
// (era esse o defeito em produção). O mecanismo e o porquê da escolha estão em
// `globals.css` (§LINHA-ÂNCORA).
//
// SEM caixas de seleção e SEM ação em massa neste v1 (a lista deles tem;
// nós não temos nada para fazer com uma seleção ainda). Quando houver, o
// contrato do §2 já reserva o lugar: controle dependente de seleção nasce
// desabilitado na toolbar.

import Link from 'next/link'
import { MoreVertical } from 'lucide-react'
import * as React from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/kit/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/kit/select'
import { cn } from '@/lib/cn'

export interface ColunaDeTabela<T> {
  /** identificador estável da coluna (chave de render) */
  id: string
  /** rótulo do cabeçalho; vazio só é aceito com `cabecalhoOculto` */
  cabecalho: string
  /** conteúdo da célula */
  celula: (linha: T) => React.ReactNode
  /** número: alinha à direita e liga `tabular-nums` */
  numerica?: boolean
  /** some abaixo deste ponto de corte (a linha inteira continua clicável) */
  ocultarAte?: 'sm' | 'md' | 'lg'
  /** cabeçalho existe para leitor de tela, mas não é desenhado */
  cabecalhoOculto?: boolean
}

/** Item do kebab. É NAVEGAÇÃO — ação que muda dado mora em botão, não aqui. */
export interface AcaoDeLinha {
  rotulo: string
  href: string
}

const ESCONDER: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
}

/** Acima disto a lista pagina; abaixo, mostra tudo (padrão medido). */
export const LIMIAR_DE_PAGINACAO = 50
const TAMANHOS_DE_PAGINA = [25, 50] as const

export function DataTable<T>({
  linhas,
  colunas,
  chaveDaLinha,
  hrefDaLinha,
  rotuloDaLinha,
  acoesDaLinha,
  legenda,
  vazio,
  className,
}: {
  linhas: T[]
  colunas: ColunaDeTabela<T>[]
  chaveDaLinha: (linha: T) => string
  /** destino da âncora ampliada; sem ele a linha é só leitura */
  hrefDaLinha?: (linha: T) => string
  /** nome acessível do link da linha (o `<a>` embrulha a 1ª célula) */
  rotuloDaLinha?: (linha: T) => string
  acoesDaLinha?: (linha: T) => AcaoDeLinha[]
  /** `<caption>` — some da tela, existe para leitor de tela */
  legenda: string
  /** o que desenhar quando não há linha nenhuma */
  vazio?: React.ReactNode
  className?: string
}) {
  const [porPagina, setPorPagina] = React.useState<number>(TAMANHOS_DE_PAGINA[0])
  const [paginaPedida, setPaginaPedida] = React.useState(1)

  const total = linhas.length
  const pagina = total > LIMIAR_DE_PAGINACAO
  const totalDePaginas = pagina ? Math.max(1, Math.ceil(total / porPagina)) : 1
  // Clamp no RENDER, não em efeito: quando a busca encolhe a lista, a página 3
  // deixa de existir e o efeito pintaria uma tela vazia antes de corrigir.
  const paginaAtual = Math.min(paginaPedida, totalDePaginas)
  const primeiro = pagina ? (paginaAtual - 1) * porPagina : 0
  const visiveis = pagina ? linhas.slice(primeiro, primeiro + porPagina) : linhas

  if (total === 0 && vazio) return <>{vazio}</>

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{legenda}</caption>
          <thead>
            <tr className="border-b border-line bg-paper-100">
              {colunas.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={cn(
                    // Cabeçalho é RÓTULO: 14px em cinza legível — nunca a caixa
                    // alta de 11px em ink-400 que a régua do dono reprovou.
                    'px-4 py-2.5 text-sm font-semibold whitespace-nowrap text-ink-600',
                    c.numerica && 'text-right',
                    c.ocultarAte && ESCONDER[c.ocultarAte],
                  )}
                >
                  {c.cabecalhoOculto ? <span className="sr-only">{c.cabecalho}</span> : c.cabecalho}
                </th>
              ))}
              {acoesDaLinha && (
                <th scope="col" className="w-12 px-2 py-2.5">
                  <span className="sr-only">Ações</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {visiveis.map((linha) => {
              const href = hrefDaLinha?.(linha)
              const acoes = acoesDaLinha?.(linha) ?? []
              return (
                <tr
                  key={chaveDaLinha(linha)}
                  className={cn(
                    'relative transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-paper-100/60',
                    // Só a linha que TEM capa vira bloco contido: linha sem link
                    // não precisa e não ganha contexto de empilhamento à toa.
                    href && 'linha-ancora',
                  )}
                >
                  {colunas.map((c, i) => (
                    <td
                      key={c.id}
                      className={cn(
                        'px-4 py-2.5 align-middle text-sm text-ink-900',
                        c.numerica && 'text-right tabular-nums',
                        c.ocultarAte && ESCONDER[c.ocultarAte],
                      )}
                    >
                      {i === 0 && href ? (
                        <Link
                          href={href}
                          aria-label={rotuloDaLinha?.(linha)}
                          // A capa (`after`) cobre a linha inteira; o foco
                          // visível fica no anel do próprio link, que continua
                          // do tamanho do conteúdo — o alvo cresce, o foco não
                          // vira uma faixa gigante atravessando a tela.
                          className="rounded-input outline-offset-2 after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-ac-vivid"
                        >
                          {c.celula(linha)}
                        </Link>
                      ) : (
                        c.celula(linha)
                      )}
                    </td>
                  ))}
                  {acoesDaLinha && (
                    <td className="relative z-10 w-12 px-2 py-2.5 text-right">
                      {acoes.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={
                              rotuloDaLinha ? `Ações de ${rotuloDaLinha(linha)}` : 'Ações desta linha'
                            }
                            className="inline-flex h-9 w-9 items-center justify-center rounded-input text-ink-600 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-paper-100 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ac-vivid"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56 gap-0.5 p-1.5">
                            {acoes.map((a) => (
                              <DropdownMenuItem key={a.href + a.rotulo} asChild>
                                <Link href={a.href} className="nav-tb-item min-h-8 text-ink-900">
                                  {a.rotulo}
                                </Link>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {pagina && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line px-4 py-3">
          {/* Não é `<label>` de propósito: o gatilho do Radix já carrega o
              `aria-label`, e um rótulo embrulhando o disparador faz o clique no
              texto abrir e fechar o menu no mesmo gesto. */}
          <span className="flex items-center gap-2 text-sm text-ink-600">
            Itens por página
            <Select
              value={String(porPagina)}
              onValueChange={(v) => {
                setPorPagina(Number(v))
                setPaginaPedida(1)
              }}
            >
              <SelectTrigger className="min-h-8 py-1" aria-label="Itens por página">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAMANHOS_DE_PAGINA.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>

          {/* Quantos e de quantos é DADO (a dona conta alunos por aqui): 14px,
              tinta cheia, tabular. */}
          <p className="text-sm font-medium tabular-nums text-ink-900">
            {primeiro + 1}–{Math.min(primeiro + porPagina, total)} de {total}
          </p>

          <nav aria-label="Paginação" className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPaginaPedida(Math.max(1, paginaAtual - 1))}
              disabled={paginaAtual === 1}
              aria-label="Página anterior"
              className="inline-flex h-9 w-9 items-center justify-center rounded-input text-ink-600 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-paper-100 hover:text-ink-900 disabled:pointer-events-none disabled:opacity-40"
            >
              ‹
            </button>
            <span className="min-w-16 text-center text-sm font-medium tabular-nums text-ink-900">
              {paginaAtual} de {totalDePaginas}
            </span>
            <button
              type="button"
              onClick={() => setPaginaPedida(Math.min(totalDePaginas, paginaAtual + 1))}
              disabled={paginaAtual === totalDePaginas}
              aria-label="Próxima página"
              className="inline-flex h-9 w-9 items-center justify-center rounded-input text-ink-600 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-paper-100 hover:text-ink-900 disabled:pointer-events-none disabled:opacity-40"
            >
              ›
            </button>
          </nav>
        </div>
      )}
    </div>
  )
}
