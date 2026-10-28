// N2 — UM GRUPO DE ALUNOS (Onda 1 · M3): os alunos de uma professora, de um
// produto ou de um nível, na MESMA tabela do hub, com busca local.
//
// Endereço congelado no contrato de URLs da onda:
//   /admin/alunos/grupo/[eixo]/[valor]   eixo ∈ professora · produto · nivel
//
// 404 HONESTO: eixo fora do vocabulário, nível inventado, produto inventado ou
// id que não é de professora nenhuma dão `notFound()`. O que NÃO dá 404 é grupo
// válido e VAZIO (uma professora sem aluno, um nível sem ninguém): isso é uma
// resposta verdadeira, e tem estado vazio próprio.
//
// O título da barra do shell continua dizendo "Alunos" (ele deriva do trilho).
// Quem diz de QUE grupo se trata é o cabeçalho daqui — com a trilha de volta
// como primeira linha, que é o feedback de mudança de nível do item 7.
//
// Zero query nesta página: quem lê é `src/data/admin/alunos.ts`.

import { notFound } from 'next/navigation'
import Link from 'next/link'

import { ListaDeAlunos } from '@/components/admin/alunos/ListaDeAlunos'
import { CardPanel } from '@/components/kit/card-panel'
import { EmptyState } from '@/components/kit/empty-state'
import { getStudentGroup } from '@/data/admin/alunos'
import { EIXO_ROTULO, ehEixoDeGrupo } from '@/data/admin/alunos-grupos'

export const metadata = { title: 'Grupo de alunos — Admin' }

export default async function GrupoDeAlunosPage({
  params,
}: {
  params: Promise<{ eixo: string; valor: string }>
}) {
  const { eixo, valor } = await params
  if (!ehEixoDeGrupo(eixo)) notFound()

  const grupo = await getStudentGroup(eixo, decodeURIComponent(valor))
  if (!grupo) notFound()

  return (
    <main className="view-enter flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <nav aria-label="Trilha">
          {/* Voltar é NAVEGAÇÃO, e navegação não vai em 11px cinza-claro:
              14px, tinta legível, alvo de toque de sobra. */}
          <Link
            href="/admin/alunos"
            className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-ink-600 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:text-ac-deep"
          >
            <span aria-hidden>←</span> Alunos
          </Link>
        </nav>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="title-page text-ink-900">{grupo.rotulo}</h2>
          <p className="text-sm text-ink-600">{EIXO_ROTULO[grupo.eixo]}</p>
        </div>
      </header>

      <CardPanel>
        <ListaDeAlunos
          alunos={grupo.alunos}
          legenda={`Alunos do grupo ${grupo.rotulo}`}
          placeholder="Buscar neste grupo…"
          vazio={
            <EmptyState
              illustration="/illustrations/aula-online.svg"
              title="Nenhum aluno neste grupo."
              hint="Ninguém está aqui agora. O contrato de um aluno pode ter sido encerrado, ou a classificação ainda não foi feita."
              cta="Voltar para Alunos"
              href="/admin/alunos"
            />
          }
        />
      </CardPanel>
    </main>
  )
}
