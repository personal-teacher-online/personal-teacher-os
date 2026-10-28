// N3 — FICHA DO ALUNO (Onda 1 · M3-2). A ficha velha (887 linhas de JSX com
// doze queries no meio, seções empilhadas até o rodapé e painéis por `?painel=`
// dentro de um `<aside>` caseiro) morre aqui.
//
// ANATOMIA (clonagem TutorBird, `mapeamento-tutorbird-2.md`, 3ª passada):
//
//   ← Alunos                                    ← trilha de volta
//   Nome do aluno                               ← título da visão
//   ┌───────────────┐ ┌──────────────────────────────────────────┐
//   │ identidade    │ │ [Visão geral][Contrato][Créditos][…]     │  abas
//   │ contrato      │ │                                          │
//   │ créditos      │ │ pares rótulo/valor em grade com hairline │
//   └───────────────┘ └──────────────────────────────────────────┘
//        ESQUERDA                    card-contêiner à direita
//
// O ENDEREÇO é o mesmo de sempre (`/admin/alunos/[id]`): todo link salvo, todo
// e-mail antigo e todo `?painel=…` continuam chegando — o painel agora também
// escolhe a aba por baixo (`abaAtiva`).
//
// Zero query nesta página: quem lê é `src/data/admin/ficha.ts`.
//
// FEEDBACK: as actions desta tela ainda são as VELHAS, que voltam por
// `?msg=…&n=…`. O `AvisoLegado` (M3-1) transforma o recado em toast do kit. A
// tela nova não PRODUZ `?msg=` nenhum — ela só sabe ler o que a action manda.

import { notFound } from 'next/navigation'
import Link from 'next/link'

import { AvisoLegado } from '@/components/kit/aviso-legado'
import { ColunaDeIdentidade } from '@/components/admin/alunos/ficha/ColunaDeIdentidade'
import { PaineisDaFicha } from '@/components/admin/alunos/ficha/paineis'
import {
  AbaBriefing,
  AbaContrato,
  AbaCreditos,
  AbaHistorico,
  AbaVisaoGeral,
} from '@/components/admin/alunos/ficha/abas'
import { CardPanel, CardPanelTabs } from '@/components/kit/card-panel'
import { getStudentFile } from '@/data/admin/ficha'
import {
  ABAS,
  ABA_ROTULO,
  abaAtiva,
  ehPainel,
  enderecoDaFicha,
} from '@/data/admin/ficha-gramatica'
import {
  chaveDoCancelamentoDaFicha,
  lerRascunho,
} from '@/lib/admin/rascunho-do-formulario'

export const metadata = { title: 'Ficha do aluno — Admin' }

export default async function FichaDoAlunoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    aba?: string
    painel?: string
    alvo?: string
    // recado das actions velhas (convivência do M3-1)
    msg?: string
    n?: string
  }>
}) {
  const { id } = await params
  const sp = await searchParams

  const ficha = await getStudentFile(id)
  if (!ficha) notFound()

  const aba = abaAtiva(sp.aba, sp.painel)
  const painel = ehPainel(sp.painel) ? sp.painel : null

  // O RASCUNHO DA VOLTA DE ERRO DO PAINEL "CANCELAR" (revisão independente do
  // A6, M2). Ler cookie é operação de PÁGINA — Server Component não pode
  // escrever cookie durante o render, mas ler pode, e é assim que a Agenda já
  // faz. A chave é DERIVADA da aula que está no endereço (`?alvo=`), a mesma
  // que a action derivou ao gravar: escritor e leitor não têm como divergir.
  // Nenhum outro painel tem gaveta hoje, e pedir a chave errada devolve `{}`.
  const rascunho =
    painel === 'cancelar' && sp.alvo
      ? await lerRascunho(chaveDoCancelamentoDaFicha(sp.alvo))
      : undefined

  const abas = ABAS.map((a) => ({
    label: ABA_ROTULO[a],
    href: enderecoDaFicha(ficha.id, { aba: a }),
    active: a === aba,
    count:
      a === 'contrato'
        ? ficha.contratos.length
        : a === 'creditos'
          ? ficha.creditos.disponiveis
          : undefined,
  }))

  return (
    <main className="view-enter flex flex-col gap-6">
      <AvisoLegado mensagem={sp.msg ?? ''} chave={sp.n} />

      <header className="flex flex-col gap-1">
        <nav aria-label="Trilha">
          {/* Voltar é NAVEGAÇÃO: 14px, tinta legível, alvo de toque de sobra. */}
          <Link
            href="/admin/alunos"
            className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-ink-600 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:text-ac-deep"
          >
            <span aria-hidden>←</span> Alunos
          </Link>
        </nav>
        <h2 className="title-page text-ink-900">{ficha.nome}</h2>
      </header>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <ColunaDeIdentidade ficha={ficha} />

        <CardPanel>
          <CardPanelTabs tabs={abas} />
          {aba === 'visao' && <AbaVisaoGeral ficha={ficha} />}
          {aba === 'contrato' && <AbaContrato ficha={ficha} />}
          {aba === 'creditos' && <AbaCreditos ficha={ficha} />}
          {aba === 'briefing' && <AbaBriefing ficha={ficha} />}
          {aba === 'historico' && <AbaHistorico ficha={ficha} />}
        </CardPanel>
      </div>

      {painel && (
        <PaineisDaFicha ficha={ficha} painel={painel} alvo={sp.alvo} digitado={rascunho} />
      )}
    </main>
  )
}
