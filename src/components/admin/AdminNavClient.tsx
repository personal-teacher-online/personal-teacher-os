'use client'

// PEÇAS DE NAVEGAÇÃO DO ADMIN — clonagem TutorBird (26/07/2026).
//
// Client component só pelo `usePathname` (item ativo) — zero fetch, zero regra
// de negócio.
//
// ANATOMIA DO TRILHO — LOTE 8, o mecanismo DEFINITIVO, medido frame a frame de
// um vídeo do TutorBird gravado pelo dono (59 frames; a cinemetria completa está
// em `docs/goals/mapeamento-tutorbird-2.md`, seção "Cinemetria da sidebar").
//
// O que a medição provou, e que derrubou as duas tentativas anteriores:
// · a borda ESQUERDA fica fixa nos 59 frames e o conteúdo está pinado na
//   posição FINAL — nada viaja (morre a v1, que animava `translateX`);
// · os frames intermediários têm teal PLENO e mostram os rótulos INTEIROS,
//   na posição final, sendo CORTADOS pela borda direita — não é fade (morre a
//   v2, reprovada pelo dono: "parece que percorre por cima da página");
// · quem viaja é a borda DIREITA: o mecanismo é REVELAÇÃO DE LARGURA POR CORTE.
// · EMENDA v3 (ordem do dono, 27/07, com a Onda 1 no ar): os rótulos ganham
//   FADE sincronizado com o corte — "a barra vai para a direita enquanto as
//   palavras aparecem; a barra volta e as palavras somem — mais suavizado".
//   A cinemetria pura não tem esse fade; é desvio deliberado por cima da
//   clonagem. A classe é `rail-label` (globals), a cadência é a MESMA da
//   largura (cortesia incluída), e em ponteiro grosso os rótulos ficam
//   opacos fixos junto com o trilho aberto fixo.
//
// Daí a implementação: UM ELEMENTO SÓ. Uma `<nav>` fixa à esquerda com 64px em
// repouso que anima a própria `width` até 265px no `:hover`/`:focus-within`
// (~300ms, desacelerando no fim), `overflow-x: hidden` sempre — o corte É o
// mecanismo. Dentro dela, UM bloco de largura FIXA de 265px: ele não reflui
// durante a animação, só vai sendo descoberto. Cada linha é uma célula de ícone
// de 64px (a largura de repouso — por isso o ícone parece imóvel) mais o rótulo
// `whitespace-nowrap` à direita, que começa exatamente em 64px e por isso está
// 100% escondido quando o trilho está fechado. A logo segue a mesma régua:
// símbolo na célula de 64px, wordmark à direita revelado pelo corte — sem
// sósia; o fade da emenda v3 vale para ele como para os demais rótulos.
//
// A ARQUITETURA DE DUAS CAMADAS MORREU INTEIRA. Não há mais rail-espelho, nem
// duplicatas `aria-hidden`/`tabIndex={-1}`, nem anel de foco espelhado, nem
// malabarismo de `visibility`/`opacity`. Os links são UM conjunto só: sempre no
// DOM, sempre focáveis, com o rótulo visível como nome acessível. Consequências
// de graça: o Tab abre o painel por `:focus-within` nos DOIS sentidos (a
// regressão do Shift+Tab do lote 7 morreu junto) e o anel de foco volta a ser o
// padrão do site, porque não existe mais camada opaca cobrindo o item focado.
//
// · item ATIVO = retângulo escurecido (`--ac-nav-bg`) full-width do bloco de
//   265px. Fechado, o corte o entrega como um quadrado escuro de 64px; aberto,
//   como a linha inteira — é o comportamento medido no TutorBird. Morreram o
//   raio de quadradinho e a barrinha vertical à esquerda, invenção nossa;
// · a cadência e as duas intensidades de SOMBRA (Δlum ≈ 5 fechado × ≈ 26–30
//   aberto, medido) moram no globals, em variáveis nomeadas —
//   `--duration-drawer`, `--ease-drawer`, `--delay-rail-rest`,
//   `--rail-shadow-rest`, `--rail-shadow-open`.
//
// Celular: NÃO mexido nesta rodada — barra superior de tinta + barra inferior
// de polegar, como estavam (Q5).
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, LayoutDashboard, LogOut, MoreHorizontal } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/kit/dropdown-menu'
import { MARCA } from '@/lib/brand/constants'
import type { ContaDoAdmin } from '@/data/admin/conta'
import { AJUSTES, POLEGAR, TRILHO, tituloDaRota, itemAtivo } from './nav'

/** Largura do bloco interno = a largura ABERTA (265px, medida). Ele NÃO reflui
 *  durante a animação: quem muda é o corte da `<nav>` em volta. */
const CONTEUDO = 'w-[265px]'

/** Célula do ícone = a largura do trilho em REPOUSO (64px). É por ela que o
 *  ícone fica centrado no estado fechado E imóvel no aberto, e é ela que empurra
 *  o rótulo para começar EXATAMENTE em 64px — logo, 100% cortado em repouso. */
const CELULA = 'flex w-16 shrink-0 items-center justify-center'

// Altura FIXA do item (44px) e do cabeçalho (24px): a régua vertical do
// TutorBird. Continua pinada — não por simetria entre camadas (não há mais duas
// camadas), mas porque a linha carrega ícone e texto de caixas diferentes e sem
// altura fixa o passo vertical mudaria de item para item.
const ITEM_ALTURA = 'h-11'
const CABECALHO_ALTURA = 'h-6'

// A linha inteira tem os 265px do bloco: é ela que veste o retângulo do ativo e
// do hover. Fechada, o corte entrega os primeiros 64px — o quadrado escuro.
// A VOZ da linha é a da navegação: `.nav-tb` = Roboto 16/400, +0.031em, lh 24
// (lote 10 — medido nos computed styles do TutorBird, cuja sidebar é peça
// Material e por isso NÃO é Inter). O `text-base font-medium` que estava aqui
// era Inter 16/500: mesma altura, desenho e ritmo diferentes.
const ITEM_BASE = `nav-tb flex ${ITEM_ALTURA} ${CONTEUDO} shrink-0 items-center transition-colors duration-(--duration-hover) ease-(--ease-in-out)`
// Ativo: retângulo full-width mais ESCURO (branco por cima = 6,76:1).
const ITEM_ATIVO = 'bg-ac-nav-bg text-ac-nav-fg'
// Inerte: branco cheio; o hover CLAREIA o fundo (relação medida no TutorBird).
const ITEM_INERTE = 'text-white hover:bg-rail-hover'

export function AdminRail() {
  const pathname = usePathname()

  return (
    <>
      {/* ESPAÇADOR em fluxo: a largura que o trilho ocupa em repouso. O trilho
          em si é `fixed` e overlay — ao abrir ele passa POR CIMA do conteúdo e
          da barra superior (z-40 × z-30), e a página não reflui.
          A largura vem de `--rail-w-spacer` (globals.css) porque em ponteiro
          grosso o trilho fica ABERTO FIXO, e aí o espaçador tem de acompanhar —
          um valor solto aqui deixaria o menu por cima do conteúdo para sempre. */}
      <div aria-hidden className="hidden w-(--rail-w-spacer) shrink-0 md:block" />

      {/* UM ELEMENTO SÓ. Largura, corte, cadência e as duas sombras moram no
          `.rail` do globals — aqui não há nenhuma classe de estado, nenhum
          `group-hover`, nenhum transform e nenhuma opacidade: o hover e o foco
          são lidos pelo próprio elemento (`:hover`/`:focus-within`). */}
      <nav
        aria-label="Navegação principal"
        className="rail fixed inset-y-0 left-0 z-40 hidden bg-rail-bg md:block"
      >
        <div className={`flex min-h-full ${CONTEUDO} flex-col pt-4 pb-5`}>
          {/* Marca: identidade, não destino — "Início" já é o primeiro item do
              trilho, e repetir o mesmo href dentro do mesmo landmark seria um
              segundo tab stop para o mesmo lugar. O símbolo mora na célula de
              64px e o wordmark à direita, revelado pelo corte. */}
          <span
            aria-hidden
            className={`mb-6 flex ${CABECALHO_ALTURA} ${CONTEUDO} shrink-0 items-center`}
          >
            <span className={CELULA}>
              <Image src={MARCA.simboloBranco} alt="" width={20} height={20} className="h-5 w-5" />
            </span>
            {/* O wordmark é a ÚNICA peça do trilho com peso próprio: 600 em vez
                de 400 (`.nav-tb-strong`). No TutorBird o topo é a LOGO GRÁFICA,
                então não há peso a copiar — e "Personal Teacher" em 400 ficaria
                indistinguível de mais um item do menu logo abaixo. Saiu o
                `font-bold` (700 em Inter): 600 em Roboto é o degrau que marca a
                marca sem gritar. */}
            <span className="nav-tb nav-tb-strong rail-label whitespace-nowrap text-white">{MARCA.escola}</span>
          </span>

          <div className="flex flex-1 flex-col">
            {TRILHO.map((item) => {
              const Icone = item.icon
              const ativo = itemAtivo(pathname, item)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={ativo ? 'page' : undefined}
                  // O anel é o do site (`a:focus-visible` no globals), só puxado
                  // para DENTRO: o item ocupa os 265px inteiros e a `<nav>` é
                  // `overflow-x: hidden`, então o deslocamento padrão de 2px
                  // seria cortado na borda esquerda.
                  className={`${ITEM_BASE} focus-visible:-outline-offset-2 ${ativo ? ITEM_ATIVO : ITEM_INERTE}`}
                >
                  <span className={CELULA}>
                    <Icone className="h-5 w-5" />
                  </span>
                  {/* O rótulo é o nome acessível do link — está sempre no DOM,
                      só CORTADO (e, pela emenda v3, transparente) quando o
                      trilho está fechado. Opacity não sai da árvore de
                      acessibilidade; nada de `aria-label` duplicando o texto. */}
                  <span className="rail-label whitespace-nowrap">{item.label}</span>
                </Link>
              )
            })}
          </div>

          {/* Pé do trilho: o único destino que não é seção do admin. Ganhou
              ícone nesta rodada — sem ele, ele simplesmente não existiria no
              estado fechado, que é o estado de repouso do trilho. */}
          <Link href="/teacher" className={`${ITEM_BASE} focus-visible:-outline-offset-2 ${ITEM_INERTE}`}>
            <span className={CELULA}>
              <LayoutDashboard className="h-5 w-5" />
            </span>
            <span className="rail-label whitespace-nowrap">Meu painel de professora</span>
          </Link>
        </div>
      </nav>
    </>
  )
}

/**
 * BARRA SUPERIOR BRANCA (desktop) — 56px, sombra sutil, título da página à
 * esquerda e a CONTA à direita. Nada de sino nem de "ajuda": o TutorBird tem os
 * dois, nós não temos o que colocar dentro deles, e ícone que não faz nada é
 * pior que ícone ausente.
 *
 * O que existia (sair, ir para o painel de professora) mudou de lugar: saiu do
 * pé do trilho e virou o menu da conta, que é onde a captura o põe.
 */
export function AdminTopBar({ conta }: { conta?: ContaDoAdmin | null }) {
  const pathname = usePathname()
  const nome = conta?.nome ?? ''
  const inicial = nome.trim().charAt(0).toUpperCase() || 'V'

  return (
    <header className="sticky top-0 z-30 hidden h-14 shrink-0 items-center justify-between gap-4 bg-paper-0 px-6 shadow-(--shadow-topbar) md:flex">
      {/* Título de PÁGINA, na régua medida: Inter 24/600 com tracking −0.8px
          (`.title-page`). Estava em `text-lg font-semibold` = 18/600 com
          tracking normal — dois degraus abaixo do original e sem o aperto que
          dá o desenho "feito de propósito" ao título deles. */}
      <h2 className="title-page truncate text-ink-900">{tituloDaRota(pathname)}</h2>

      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-btn px-2 py-1.5 text-sm text-ink-600 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-paper-100 hover:text-ink-900">
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-full bg-ac-tint text-sm font-bold text-ac-deep"
          >
            {inicial}
          </span>
          <span className="max-w-40 truncate font-medium">{nome || 'Minha conta'}</span>
          <ChevronDown className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60 p-1.5">
          {conta?.email && (
            <p className="px-2 py-1.5 text-xs text-ink-400" title={conta.email}>
              <span className="block truncate">{conta.email}</span>
            </p>
          )}
          {/* "Meu painel de professora" NÃO se repete aqui: ele é destino de
              NAVEGAÇÃO e mora no trilho. Este menu é da conta — quem é você,
              como você configura a escola e como sair.
              M3-c5 · D3: Ajustes desceu do trilho para cá, espelhando o
              TutorBird — configuração é assunto de conta. */}
          <DropdownMenuItem asChild>
            <Link href={AJUSTES.href} className="min-h-9">
              <AJUSTES.icon className="h-4 w-4" />
              {AJUSTES.label}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <form action="/auth/signout" method="post" className="w-full">
              <button type="submit" className="flex min-h-9 w-full items-center gap-2 text-left text-sm">
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}

/** Barra superior compacta do CELULAR (identidade). Intocada nesta rodada. */
export function AdminMobileBar() {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2.5 bg-ink-900 px-4 py-3 md:hidden">
      <Image src={MARCA.simboloBranco} alt="" width={20} height={20} className="h-5 w-5 opacity-90" />
      <span className="text-sm font-bold text-white">{MARCA.escola}</span>
      <span className="text-[11px] font-medium tracking-wide text-white/45">{MARCA.admin}</span>
    </header>
  )
}

export function AdminThumbBar() {
  const pathname = usePathname()

  const noPolegar = TRILHO.filter((i) => POLEGAR.includes(i.href))
  const noMais = TRILHO.filter((i) => !POLEGAR.includes(i.href))
  // O Ajustes conta para acender o "Mais" (D3): ele está DENTRO deste menu no
  // celular, mesmo tendo saído do trilho.
  const maisAtivo = [...noMais, AJUSTES].some((i) => itemAtivo(pathname, i))

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-white/10 bg-ink-900 pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Navegação principal"
    >
      {noPolegar.map((item) => {
        const Icone = item.icon
        const ativo = itemAtivo(pathname, item)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={ativo ? 'page' : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${
              ativo ? 'font-bold text-ac-vivid' : 'font-medium text-white/50'
            }`}
          >
            <Icone className={`h-5 w-5 ${ativo ? '' : 'opacity-80'}`} />
            {item.label}
          </Link>
        )
      })}

      <DropdownMenu>
        <DropdownMenuTrigger
          className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${
            maisAtivo ? 'font-bold text-ac-vivid' : 'font-medium text-white/50'
          }`}
        >
          <MoreHorizontal className="h-5 w-5" />
          Mais
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-56 gap-0.5 p-2">
          {noMais.map((item) => {
            const Icone = item.icon
            const ativo = itemAtivo(pathname, item)
            return (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href} className={`min-h-11 ${ativo ? 'font-semibold text-ac-deep' : ''}`}>
                  <Icone className="h-4 w-4" />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            )
          })}
          {/* D3 — o celular NÃO tem menu de conta (a barra de cima é só
              identidade), então o Ajustes mora aqui, ao lado de "Sair", que já
              vive neste menu pelo mesmo motivo. Sem esta linha, a emenda de
              posição apagaria o acesso móvel a Ajustes. */}
          <DropdownMenuItem asChild>
            <Link
              href={AJUSTES.href}
              className={`min-h-11 ${itemAtivo(pathname, AJUSTES) ? 'font-semibold text-ac-deep' : ''}`}
            >
              <AJUSTES.icon className="h-4 w-4" />
              {AJUSTES.label}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/teacher" className="min-h-11">
              <LayoutDashboard className="h-4 w-4" />
              Meu painel de professora
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <form action="/auth/signout" method="post" className="w-full">
              <button type="submit" className="flex min-h-11 w-full items-center gap-2 text-left text-sm">
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}
