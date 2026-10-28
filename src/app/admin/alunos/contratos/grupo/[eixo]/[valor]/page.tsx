// N2 — UM GRUPO DE CONTRATOS (portão visual do dono, 27/07/2026): os contratos
// de uma professora, de um nível, de um plano ou de uma situação, na MESMA
// tabela do índice, com busca local.
//
// Rota IRMÃ da de alunos (`/admin/alunos/grupo/[eixo]/[valor]`), de propósito:
// o dono mandou o "ver por" de Contratos virar cartões de acesso "como a aba
// Alunos", e cartão de acesso sem N2 é cartão que não abre nada. Endereço:
//
//   /admin/alunos/contratos/grupo/[eixo]/[valor]
//     eixo ∈ professora · nivel · produto · situacao
//     valor = o slug do grupo (`SecaoDeContratos.slug`) — nível vira `a1-mais`,
//             plano vai como texto escapado, professora vai como id
//
// 404 HONESTO: eixo fora do vocabulário ou valor que não é grupo nenhum dão
// `notFound()`. Grupo vazio não existe aqui (o índice só desenha cartão de
// grupo com contrato dentro), então não há caso de "existe mas está vazio" —
// se a lista esvaziar entre um clique e outro, o estado vazio da tabela fala.
//
// O título da barra do shell continua dizendo "Alunos" (ele deriva do trilho).
// Quem diz de QUE grupo se trata é o cabeçalho daqui, com a trilha de volta
// para o índice JÁ NO EIXO de onde se veio — voltar não pode desfazer a escolha
// de agrupamento de quem clicou.
//
// Zero query nesta página: quem lê é `src/data/admin/contratos.ts`.

import { notFound } from 'next/navigation'
import Link from 'next/link'

import { ListaDeContratos } from '@/components/admin/alunos/ListaDeContratos'
import { CardPanel } from '@/components/kit/card-panel'
import { EmptyState } from '@/components/kit/empty-state'
import { getContractsIndex } from '@/data/admin/contratos'
import {
  VISAO_ROTULO,
  agruparContratos,
  ehEixoDeContratos,
} from '@/data/admin/contratos-gramatica'

export const metadata = { title: 'Grupo de contratos — Admin' }

export default async function GrupoDeContratosPage({
  params,
}: {
  params: Promise<{ eixo: string; valor: string }>
}) {
  const { eixo, valor } = await params
  if (!ehEixoDeContratos(eixo)) notFound()

  // O universo é o dos contratos VIVOS (o mesmo do índice sem recorte): a
  // página do grupo responde "quem está neste recorte", e um `?st=` herdado
  // daria dois endereços para a mesma pergunta.
  const indice = await getContractsIndex('todos')
  // O slug do eixo `produto` é o nome do PLANO, que é texto livre digitado pela
  // admin — e um `%` solto ali faz `decodeURIComponent` ESTOURAR (URIError, 500
  // no lugar da tela). Por isso o casamento tenta as duas leituras do que veio
  // na rota, e nenhuma delas pode derrubar a página.
  let alvo = valor
  try {
    alvo = decodeURIComponent(valor)
  } catch {
    alvo = valor
  }
  const grupo = agruparContratos(indice.contratos, eixo).find(
    (s) => s.slug === alvo || s.slug === valor,
  )
  if (!grupo) notFound()

  return (
    <main className="view-enter flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <nav aria-label="Trilha">
          {/* Voltar é NAVEGAÇÃO, e navegação não vai em 11px cinza-claro:
              14px, tinta legível, alvo de toque de sobra. */}
          <Link
            href={`/admin/alunos/contratos?ver=${eixo}`}
            className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-ink-600 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:text-ac-deep"
          >
            <span aria-hidden>←</span> Contratos
          </Link>
        </nav>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="title-page text-ink-900">{grupo.rotulo}</h2>
          <p className="text-sm text-ink-600">{VISAO_ROTULO[eixo]}</p>
        </div>
      </header>

      <CardPanel>
        <ListaDeContratos
          contratos={grupo.contratos}
          legenda={`Contratos do grupo ${grupo.rotulo}`}
          placeholder="Buscar neste grupo…"
          vazio={
            <EmptyState
              illustration="/illustrations/agenda-vazia.svg"
              title="Nenhum contrato neste grupo."
              hint="Ninguém está aqui agora. O contrato pode ter sido encerrado, ou a classificação mudou desde que a lista foi carregada."
              cta="Voltar para Contratos"
              href={`/admin/alunos/contratos?ver=${eixo}`}
            />
          }
        />
      </CardPanel>
    </main>
  )
}
