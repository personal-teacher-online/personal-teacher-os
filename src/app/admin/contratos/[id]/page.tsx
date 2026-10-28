// O DETALHE DE UM CONTRATO (Onda 1 · M4-2) — a tela que faltava entre a lista e
// as ações. Até aqui, "gerir o contrato do Fulano" era abrir a lista velha,
// achar o cartão e desdobrar um `Drawer` com seis formulários empilhados.
//
// ANATOMIA (a MESMA da ficha do aluno, M3-2):
//
//   ← Contratos                                 ← trilha de volta
//   Nome do aluno (ou do grupo)                 ← título da visão
//   plano · pílulas de situação/produto/nível
//   ┌──────────────────────────────────────────────────────────────┐
//   │ Dados & valores                                    ✎ Editar  │
//   └──────────────────────────────────────────────────────────────┘
//   ┌──────────────────────────────────────────────────────────────┐
//   │ Vigência & pausas                    [Renovar][Pausar][…]    │
//   └──────────────────────────────────────────────────────────────┘
//   ┌── Horários fixos ─────────────────────────── [Novo horário] ─┐
//   ┌── Créditos ────────────────────────────────────── ✎ Ajustar ─┐
//   ┌── Assinatura ───────────────────── [Enviar para assinatura] ─┐
//
// UMA CAIXA POR SEÇÃO (portão visual do dono, 27/07/2026): elas moravam num
// cartão único separadas por hairline e viraram cartões-contêiner com respiro
// entre eles. É desenho, não regra: as ações, os gates e os painéis são os
// mesmos.
//
// A ÚLTIMA SEÇÃO É CONDICIONAL (ADR-029 §1): sem `AUTENTIQUE_TOKEN` no
// ambiente, "Assinatura" mostra só o aviso honesto — nenhum botão, nenhuma
// lista, nenhum painel alcançável (nem pelo endereço colado). A env é lida uma
// vez aqui e desce como propriedade; nenhum componente lê `process.env`.
//
// Cada lápis abre um painel em `?painel=…` (Sheet do kit) — endereço de
// verdade, que sobrevive ao F5 e ao voltar do navegador.
//
// Zero query nesta página: quem lê é `getContractFile` (`src/data/admin/`).
//
// FEEDBACK: as actions desta tela ainda são as de `/admin/contratos/actions.ts`,
// que voltam por `?msg=…&n=…` — agora para CÁ, por causa do `back` dos
// formulários. O `AvisoLegado` transforma o recado em toast. A tela nova não
// PRODUZ `?msg=` nenhum; ela só sabe ler o que a action manda.
//
// MENTORIA NÃO SE GERE AQUI: o contrato do Personal Travel tem janela de
// crédito, progresso e sessão em grupo — outra tela, que já existe. O endereço
// digitado à mão para um contrato de mentoria vai para lá, e não para uma tela
// que não fala do assunto dele.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'

import { AvisoLegado } from '@/components/kit/aviso-legado'
import { PaineisDoContrato } from '@/components/admin/contratos/paineis'
import { SecoesDoContrato } from '@/components/admin/contratos/detalhe'
import { Pill } from '@/components/kit/pill'
import { getContractFile } from '@/data/admin/contratos'
import {
  SITUACAO_DE_CONTRATO_COMO_ALUNO,
  ehPainelDoContrato,
} from '@/data/admin/contratos-gramatica'
import { assinaturaLigada } from '@/lib/autentique/gate'

export const metadata = { title: 'Contrato — Admin' }

export default async function DetalheDoContratoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    painel?: string
    alvo?: string
    // recado das actions de contrato (a mesma convivência do M3)
    msg?: string
    n?: string
  }>
}) {
  const { id } = await params
  const sp = await searchParams

  const contrato = await getContractFile(id)
  if (!contrato) notFound()
  if (contrato.tipo === 'mentorship') redirect('/admin/mentoria')

  const painel = ehPainelDoContrato(sp.painel) ? sp.painel : null
  /**
   * ADR-029 §1: a superfície de assinatura só existe com a chave no ambiente.
   *
   * A env é lida AQUI, uma vez, e desce como propriedade para as duas peças (as
   * seções e os painéis) — nenhum componente lê `process.env`, e por isso o
   * aceite consegue desenhar os dois modos sem subir servidor.
   */
  const assinatura = assinaturaLigada()

  return (
    <main className="view-enter flex flex-col gap-6">
      <AvisoLegado mensagem={sp.msg ?? ''} chave={sp.n} />

      <header className="flex flex-col gap-2">
        <nav aria-label="Trilha">
          {/* Voltar é NAVEGAÇÃO: 14px, tinta legível, alvo de toque de sobra. */}
          <Link
            href="/admin/alunos/contratos"
            className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-ink-600 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:text-ac-deep"
          >
            <span aria-hidden>←</span> Contratos
          </Link>
        </nav>
        <h2 className="title-page text-ink-900">{contrato.quem}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink-900">{contrato.plano}</span>
          <Pill tone="situacao" situacao={SITUACAO_DE_CONTRATO_COMO_ALUNO[contrato.situacao]}>
            {contrato.situacaoRotulo}
          </Pill>
          <Pill tone="neutral">{contrato.produto}</Pill>
          {contrato.nivel && (
            <Pill tone="nivel" nivel={contrato.nivel}>
              {contrato.nivel}
            </Pill>
          )}
          {contrato.grupo && <Pill tone="neutral">turma {contrato.grupo.label}</Pill>}
          {contrato.experimental && <Pill tone="warn">aula experimental</Pill>}
          {/* Ação parece ação (régua da casa): botão do kit, nunca link-texto. */}
          {contrato.alunoId && (
            <Link href={`/admin/alunos/${contrato.alunoId}`} className="btn-ac-soft">
              Ver ficha do aluno
            </Link>
          )}
        </div>
      </header>

      {/* Uma CAIXA por seção, com respiro entre elas (portão visual do dono,
          27/07/2026). Quem veste a moldura é cada seção (`SecaoEmCaixa`, em
          `detalhe.tsx`); aqui só sobra a pilha e o espaço entre os cartões. */}
      <div className="flex flex-col gap-4">
        <SecoesDoContrato contrato={contrato} assinaturaLigada={assinatura} />
      </div>

      {painel && (
        <PaineisDoContrato
          contrato={contrato}
          painel={painel}
          alvo={sp.alvo}
          assinaturaLigada={assinatura}
        />
      )}
    </main>
  )
}
