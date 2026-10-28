'use client'

// A LISTA DE COBRANÇAS (Onda Financeiro · F1) — a tabela do kit vestida com as
// colunas do espelho. Tudo o que é DECISÃO (situação, vencida, competência,
// verbo do vencimento) chegou pronto do servidor via `payments_admin` +
// `src/data/admin/financeiro.ts`; aqui só se veste pill e coluna.
//
// Lei 1: nenhuma data é formatada aqui — `vencimento` e `competencia` já são
// texto pronto. Régua de legibilidade: valor e situação são DADO (piso
// text-sm font-medium; valor numérico com tabular-nums pela coluna `numerica`).

import type { ReactNode } from 'react'

import { DataTable, type ColunaDeTabela } from '@/components/kit/data-table'
import { Pill } from '@/components/kit/pill'
import { rotuloAdminDaCobranca } from '@/lib/admin/financeiro-rotulos'
import type { CobrancaDaLista } from '@/data/admin/financeiro'

const COLUNAS: ColunaDeTabela<CobrancaDaLista>[] = [
  {
    id: 'pagante',
    cabecalho: 'Aluno',
    celula: (c) => <span className="text-sm font-medium text-ink-900">{c.pagante}</span>,
  },
  {
    id: 'competencia',
    cabecalho: 'Competência',
    ocultarAte: 'md',
    celula: (c) => (
      <span className="text-sm font-medium text-ink-900 first-letter:uppercase">{c.competencia}</span>
    ),
  },
  {
    id: 'valor',
    cabecalho: 'Valor',
    numerica: true,
    celula: (c) => <span className="text-sm font-semibold text-ink-900">{c.valor}</span>,
  },
  {
    id: 'vencimento',
    cabecalho: 'Vencimento',
    ocultarAte: 'sm',
    celula: (c) => <span className="text-sm font-medium text-ink-900">{c.vencimento}</span>,
  },
  {
    id: 'situacao',
    cabecalho: 'Situação',
    celula: (c) => {
      const r = rotuloAdminDaCobranca(c.situacao)
      return (
        <span className="inline-flex flex-col items-start gap-0.5">
          <Pill tone={r.tom}>{r.frase}</Pill>
          {/* Mesmo piso do portal (P5): a explicação carrega instrução operacional
              (em_disputa manda acompanhar no Asaas) — não é apoio apagável. */}
          {r.explicacao && <span className="text-sm text-ink-600">{r.explicacao}</span>}
        </span>
      )
    },
  },
]

export function ListaDeCobrancas({
  linhas,
  legenda,
  vazio,
}: {
  linhas: CobrancaDaLista[]
  legenda: string
  vazio: ReactNode
}) {
  return (
    <DataTable
      linhas={linhas}
      colunas={COLUNAS}
      chaveDaLinha={(c) => c.id}
      // '' = linha sem capa (o kit só liga a âncora quando o href é truthy);
      // cobrança de grupo não tem UMA ficha para apontar.
      hrefDaLinha={(c) => (c.studentId ? `/admin/alunos/${c.studentId}` : '')}
      rotuloDaLinha={(c) => `Cobrança de ${c.pagante} — ${c.competencia}`}
      legenda={legenda}
      vazio={vazio}
    />
  )
}
