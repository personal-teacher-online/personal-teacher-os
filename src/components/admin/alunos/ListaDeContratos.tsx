'use client'

// A LISTA DE CONTRATOS (Onda 1 · M4-1) — a tabela do kit vestida com as colunas
// do índice, mais a busca que a filtra AO VIVO. Irmã de `ListaDeAlunos`: mesma
// anatomia (toolbar bipartida, contagem viva anunciada, tabela do kit), outro
// assunto.
//
// Por que a busca mora aqui e não numa `<form>` que recarrega a página: a lista
// inteira já veio no primeiro request (são ~15 contratos, não 15 mil), e o item
// 7 das fundações pede contagem REAGINDO enquanto se digita.
//
// "VER POR" É CARTÃO (portão visual do dono, 27/07/2026 — ordem direta, olhando
// a bancada, e desvio consciente da spec do M4-1, que pedia uma pilha de seções
// com tabela). Com `?ver=` diferente de "lista", quem desenha o conteúdo é a
// PÁGINA, que passa os cartões de acesso como `children` — os mesmos do hub de
// Alunos, com a identidade do eixo e a contagem grande. Este componente só
// decide QUANDO mostrá-los: com busca escrita, os cartões somem e volta a
// tabela dos resultados, porque quem digitou um nome procura UM contrato (é o
// mesmo precedente, letra por letra, de `ListaDeAlunos`).
//
// SEM EDIÇÃO NA LISTAGEM (spec): a linha é uma ÂNCORA para gerir o contrato — e,
// desde o M4-2, ela leva ao DETALHE dele (`/admin/contratos/[id]`), onde moram
// as ações. A âncora provisória para a lista velha filtrada por nome morreu.
//
// Lei 1: nenhuma data é formatada aqui. Toda hora (`horarios`), validade e valor
// chegam prontos do servidor.

import { useId, useState, type ReactNode } from 'react'

import { DataTable, type AcaoDeLinha, type ColunaDeTabela } from '@/components/kit/data-table'
import { EmptyState } from '@/components/kit/empty-state'
import { Pill, type PillTone } from '@/components/kit/pill'
import { TEACHER_FILL } from '@/components/ui'
import {
  SITUACAO_DE_CONTRATO_COMO_ALUNO,
  casaComBuscaDeContrato,
  enderecoDoContrato,
  type ContratoDaLista,
} from '@/data/admin/contratos-gramatica'

const ASSINATURA_TOM: Record<string, PillTone> = {
  signed: 'ok',
  refused: 'danger',
  cancelled: 'muted',
  expired: 'muted',
  // c15 · Sol 14: os dois estados que PEDEM DECISÃO não são neutros. `pending` é
  // uma reserva aberta esperando alguém conferir o Autentique (desde o c15 não
  // há mais relógio que a resolva sozinha) e `failed` é um envio que não
  // aconteceu — os dois significam "este contrato ainda não está assinado e
  // alguém precisa agir". Em cinza neutro eles se perdiam no meio das pílulas
  // informativas da coluna Situação.
  pending: 'warn',
  failed: 'warn',
}

/** Bolinha de cor + nome — a mesma identidade de professora da agenda e do hub. */
function Professora({ nome, idx }: { nome: string | null; idx: number }) {
  if (!nome) return <span className="text-sm text-ink-600">sem professora</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap text-ink-900">
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${TEACHER_FILL[idx % TEACHER_FILL.length]}`} />
      {nome}
    </span>
  )
}

export function ListaDeContratos({
  contratos,
  acoes,
  controles,
  children,
  vazio,
  legenda,
  buscaInicial = '',
  placeholder = 'Buscar contrato…',
}: {
  contratos: ContratoDaLista[]
  /** slot esquerdo da toolbar: criar/agir */
  acoes?: ReactNode
  /** slot direito da toolbar, antes da busca: ver por… */
  controles?: ReactNode
  /** conteúdo alternativo enquanto a busca está vazia (os cartões de acesso) */
  children?: ReactNode
  /** estado vazio da lista (quando não há contrato nenhum no recorte) */
  vazio: ReactNode
  legenda: string
  /** `?q=` da tela velha: link salvo continua abrindo com a busca escrita */
  buscaInicial?: string
  placeholder?: string
}) {
  const [termo, setTermo] = useState(buscaInicial)
  const campo = useId()

  const buscando = termo.trim().length > 0
  const linhas = buscando ? contratos.filter((c) => casaComBuscaDeContrato(c, termo)) : contratos

  const colunas: ColunaDeTabela<ContratoDaLista>[] = [
    {
      id: 'contrato',
      cabecalho: 'Contrato',
      celula: (c) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold whitespace-nowrap text-ink-900">{c.quem}</span>
          <span className="text-sm text-ink-600">{c.plano}</span>
        </span>
      ),
    },
    {
      id: 'professora',
      cabecalho: 'Professora',
      ocultarAte: 'md',
      celula: (c) => <Professora nome={c.professora} idx={c.professoraIdx} />,
    },
    {
      id: 'nivel',
      cabecalho: 'Nível',
      ocultarAte: 'lg',
      celula: (c) =>
        c.nivel ? (
          <Pill tone="nivel" nivel={c.nivel}>
            {c.nivel}
          </Pill>
        ) : (
          <span className="text-sm text-ink-600">—</span>
        ),
    },
    {
      id: 'horarios',
      cabecalho: 'Horários',
      ocultarAte: 'lg',
      celula: (c) =>
        c.horarios.length === 0 ? (
          <span className="text-sm text-ink-600">—</span>
        ) : (
          <span className="flex flex-col gap-0.5">
            {c.horarios.map((h) => (
              <span key={h.id} className="whitespace-nowrap">
                <span className="text-sm font-medium text-ink-900 first-letter:uppercase">{h.aluno}</span>
                {/* A hora da PROFESSORA só aparece quando os dois relógios
                    divergem — e é dado (14px em cinza legível), porque é ela
                    que diz se o horário cabe na agenda de quem dá a aula. */}
                {h.professora && (
                  <span className="text-sm text-ink-600">
                    {' '}
                    · {h.professora} para {c.professora ?? 'a professora'}
                  </span>
                )}
              </span>
            ))}
          </span>
        ),
    },
    {
      id: 'valor',
      cabecalho: 'Valor/h',
      numerica: true,
      ocultarAte: 'sm',
      celula: (c) =>
        c.valorHora ? (
          <span className="text-sm font-medium text-ink-900">{c.valorHora}</span>
        ) : (
          <span className="text-sm text-ink-600">—</span>
        ),
    },
    {
      id: 'creditos',
      cabecalho: 'Créditos',
      numerica: true,
      ocultarAte: 'sm',
      celula: (c) => (
        <span className="flex flex-col items-end gap-0.5">
          {/* Zero é informação urgente (régua do dono): saldo vazio se lê com o
              mesmo peso do saldo cheio. */}
          <span className="text-sm font-semibold text-ink-900">{c.saldo}</span>
          {c.proximaValidade && (
            <span className="text-sm whitespace-nowrap text-ink-600">vence {c.proximaValidade}</span>
          )}
        </span>
      ),
    },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      celula: (c) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Pill tone="situacao" situacao={SITUACAO_DE_CONTRATO_COMO_ALUNO[c.situacao]}>
            {c.situacaoRotulo}
          </Pill>
          {c.semHorarioFixo && (
            <Pill tone="warn" title="Contrato ativo sem nenhum horário fixo vigente">
              sem horário fixo
            </Pill>
          )}
          {c.semAulasFuturas && (
            <Pill tone="warn" title="Nenhuma aula futura agendada para este contrato">
              sem aulas futuras
            </Pill>
          )}
          {c.assinatura && (
            <Pill
              tone={ASSINATURA_TOM[c.assinatura.status] ?? 'neutral'}
              title="Assinatura digital do contrato"
            >
              {c.assinatura.rotulo}
            </Pill>
          )}
        </span>
      ),
    },
  ]

  const acoesDaLinha = (c: ContratoDaLista): AcaoDeLinha[] => {
    const itens: AcaoDeLinha[] = [{ rotulo: 'Gerir contrato', href: enderecoDoContrato(c.id) }]
    // Contrato de GRUPO não tem ficha: a ficha é de uma pessoa, e o casal são
    // duas. Quem quer a pessoa entra pelo hub de alunos.
    if (c.alunoId) itens.push({ rotulo: 'Ver ficha do aluno', href: `/admin/alunos/${c.alunoId}` })
    return itens
  }

  const tabela = (linhasDaVez: ContratoDaLista[], legendaDaVez: string) => (
    <DataTable
      linhas={linhasDaVez}
      colunas={colunas}
      chaveDaLinha={(c) => c.id}
      hrefDaLinha={(c) => enderecoDoContrato(c.id)}
      rotuloDaLinha={(c) => `${c.quem} — ${c.plano}`}
      acoesDaLinha={acoesDaLinha}
      legenda={legendaDaVez}
      vazio={
        buscando ? (
          <EmptyState
            illustration="/illustrations/agenda-vazia.svg"
            title="Nenhum contrato com esse nome."
            hint={`Nada casa com “${termo.trim()}” — a busca olha o nome do aluno (ou do grupo) e o plano. Confira a grafia ou limpe a busca para ver a lista inteira.`}
            action={
              <button type="button" onClick={() => setTermo('')} className="btn-ac">
                Limpar a busca
              </button>
            }
          />
        ) : (
          vazio
        )
      }
    />
  )

  return (
    <div className="flex flex-col">
      {/* TOOLBAR BIPARTIDA (§2 do plano): criar/agir à esquerda, ver/buscar à
          direita, dentro do contêiner. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">{acoes}</div>
        <div className="flex flex-wrap items-center gap-3">
          {controles}
          <label htmlFor={campo} className="sr-only">
            {placeholder}
          </label>
          <input
            id={campo}
            type="search"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder={placeholder}
            className="min-h-9 w-56 max-w-full rounded-input border border-line bg-paper-0 px-3 py-1.5 text-sm text-ink-900 transition-colors duration-(--duration-hover) ease-(--ease-in-out) outline-none placeholder:text-ink-400 hover:border-ink-400 focus-visible:border-ac-vivid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ac-vivid"
          />
        </div>
      </div>

      {/* CONTAGEM VIVA: muda a cada tecla e é ANUNCIADA (item 7 das fundações).
          Fora da busca ela é o tamanho da lista, que também é dado. */}
      <p
        aria-live="polite"
        className="border-b border-line-soft px-4 py-2 text-sm font-medium tabular-nums text-ink-900"
      >
        {buscando
          ? `${linhas.length} ${linhas.length === 1 ? 'contrato encontrado' : 'contratos encontrados'} para “${termo.trim()}”`
          : `${contratos.length} ${contratos.length === 1 ? 'contrato' : 'contratos'}`}
      </p>

      {/* Os cartões de acesso do "ver por" (quando a página os manda) ou a
          tabela. Busca escrita SEMPRE devolve a tabela dos resultados. */}
      {!buscando && children ? children : tabela(linhas, legenda)}
    </div>
  )
}
