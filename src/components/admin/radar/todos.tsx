'use client'

// A VISTA "TODOS" DO RADAR (Estúdio v2 · Leva 3.2) — a auditoria do acervo:
// plataforma · criador · rodada · nota de viagem · status, filtros pelos três
// eixos da URL e agrupamento por rodada. É a resposta ao acúmulo ilegível das
// listas antigas — a informação de origem sobe do detalhe para a lista.
//
// ESTOQUE ACUMULADO SÓ AQUI, E NOMEADO (ADR-036): o banner do Estúdio fala do
// lote; esta vista fala do acervo, e diz isso com todas as letras.
//
// FILTRO É URL (eixos ortogonais, Design.md): cada select navega para o
// endereço com o filtro novo — F5, voltar e link colado preservam o recorte.
// Agrupar age DEPOIS de filtrar; as opções saem do conjunto SEM filtro.
//
// ⚠️ DEGRADAÇÃO A 390px (a lição do loop do M3): tudo além de Criador some
// abaixo de `sm` e vira pílula sob o nome. A rodada nem vira pílula — o
// cabeçalho do grupo já a diz.
//
// Cliente porque a `DataTable` e o `Select` do kit são clientes. Nada aqui
// formata data/número — as strings chegam prontas de `src/data/admin/radar.ts`.

import { useRouter } from 'next/navigation'

import { Pill } from '@/components/kit/pill'
import { SectionTitle } from '@/components/ui'
import { DataTable, type ColunaDeTabela } from '@/components/kit/data-table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/kit/select'
import {
  PLATAFORMA_DO_RADAR_ROTULO,
  STATUS_DA_TREND_ROTULO,
  ehPlataformaDoRadar,
  enderecoDaVistaTodos,
  rotuloDaRodada,
  type FiltrosDoRadar,
} from '@/data/admin/radar-gramatica'
import type { LinhaDoRadar, VistaTodos } from '@/data/admin/radar'

const TODAS = 'todas'

function StatusPill({ linha }: { linha: LinhaDoRadar }) {
  if (linha.status === 'nova') return <Pill tone="warn">{STATUS_DA_TREND_ROTULO.nova}</Pill>
  if (linha.status === 'roteirizada')
    return <Pill tone="ok">{STATUS_DA_TREND_ROTULO.roteirizada}</Pill>
  return (
    <Pill tone="muted" title={linha.motivoDoDescarte ?? undefined}>
      {STATUS_DA_TREND_ROTULO.descartada}
    </Pill>
  )
}

function Nota({ linha }: { linha: LinhaDoRadar }) {
  if (linha.nota == null) return <span className="text-sm text-ink-600">sem nota</span>
  return (
    <span className="text-sm font-medium text-ink-900 tabular-nums">
      {linha.nota}
      {linha.notaAjustada && <span className="font-normal text-ink-600"> (ajustada)</span>}
    </span>
  )
}

const COLUNAS: ColunaDeTabela<LinhaDoRadar>[] = [
  {
    id: 'criador',
    cabecalho: 'Criador',
    celula: (l) => (
      <span className="flex flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          {/* A variação é INDENTADA sob a mãe pela marca, não por CSS de árvore:
              a tabela continua tabela e a linha continua clicável. */}
          {l.ehVariacao && <span aria-hidden className="text-ink-400">↳</span>}
          <span className="text-sm font-medium text-ink-900">{l.criadorFrase}</span>
          {l.ehVariacao && <Pill tone="neutral">variação</Pill>}
        </span>
        {l.titulo && <span className="text-sm break-words text-ink-600">{l.titulo}</span>}
        {l.motivoDoDescarte && (
          <span className="text-sm break-words text-ink-600">descartada: {l.motivoDoDescarte}</span>
        )}
        <span className="mt-1 flex flex-wrap gap-1.5 sm:hidden">
          <Pill tone="neutral">{PLATAFORMA_DO_RADAR_ROTULO[l.plataforma]}</Pill>
          {/* A nota é DADO de decisão — não some no celular junto com a coluna. */}
          {l.nota != null && (
            <Pill tone="neutral">
              nota {l.nota}
              {l.notaAjustada ? ' (ajustada)' : ''}
            </Pill>
          )}
          <StatusPill linha={l} />
        </span>
      </span>
    ),
  },
  {
    id: 'plataforma',
    cabecalho: 'Plataforma',
    ocultarAte: 'sm',
    celula: (l) => <Pill tone="neutral">{PLATAFORMA_DO_RADAR_ROTULO[l.plataforma]}</Pill>,
  },
  {
    id: 'rodada',
    cabecalho: 'Rodada',
    ocultarAte: 'md',
    celula: (l) => <span className="text-sm font-medium text-ink-900 tabular-nums">{l.rodada}</span>,
  },
  {
    id: 'nota',
    cabecalho: 'Nota de viagem',
    numerica: true,
    ocultarAte: 'sm',
    celula: (l) => <Nota linha={l} />,
  },
  {
    id: 'status',
    cabecalho: 'Status',
    ocultarAte: 'sm',
    celula: (l) => <StatusPill linha={l} />,
  },
]

function FiltroSelect({
  rotulo,
  valor,
  opcoes,
  aoTrocar,
}: {
  rotulo: string
  valor: string
  opcoes: { chave: string; rotulo: string }[]
  aoTrocar: (v: string) => void
}) {
  return (
    <span className="flex items-center gap-2 text-sm text-ink-600">
      {rotulo}
      <Select value={valor} onValueChange={aoTrocar}>
        <SelectTrigger className="min-h-9" aria-label={`Filtrar por ${rotulo.toLowerCase()}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODAS}>Todas</SelectItem>
          {opcoes.map((o) => (
            <SelectItem key={o.chave} value={o.chave}>
              {o.rotulo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  )
}

export function VistaTodosDoRadar({
  vista,
  filtros,
}: {
  vista: VistaTodos
  filtros: FiltrosDoRadar
}) {
  const router = useRouter()

  const navegar = (novos: FiltrosDoRadar) => router.push(enderecoDaVistaTodos(novos))
  const semFiltro = !filtros.plataforma && !filtros.criador && !filtros.rodada

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FiltroSelect
          rotulo="Plataforma"
          valor={filtros.plataforma ?? TODAS}
          opcoes={vista.opcoes.plataformas.map((p) => ({
            chave: p,
            rotulo: PLATAFORMA_DO_RADAR_ROTULO[p],
          }))}
          aoTrocar={(v) =>
            navegar({ ...filtros, plataforma: ehPlataformaDoRadar(v) ? v : undefined })
          }
        />
        <FiltroSelect
          rotulo="Criador"
          valor={filtros.criador ?? TODAS}
          opcoes={vista.opcoes.criadores}
          aoTrocar={(v) => navegar({ ...filtros, criador: v === TODAS ? undefined : v })}
        />
        <FiltroSelect
          rotulo="Rodada"
          valor={filtros.rodada ?? TODAS}
          opcoes={vista.opcoes.rodadas.map((r) => ({ chave: r, rotulo: r }))}
          aoTrocar={(v) => navegar({ ...filtros, rodada: v === TODAS ? undefined : v })}
        />
      </div>

      {/* O acervo se apresenta como acervo — o lote da semana é assunto do
          banner do Estúdio, nunca desta contagem (ADR-036). */}
      <p className="text-sm font-medium text-ink-900 tabular-nums">
        {semFiltro
          ? `${vista.total} trends no acervo`
          : `${vista.filtrados} de ${vista.total} trends do acervo com estes filtros`}{' '}
        <span className="font-normal text-ink-600">— estoque acumulado, não o lote da semana.</span>
      </p>

      {vista.grupos.length === 0 ? (
        <p className="rounded-card bg-paper-50 p-4 text-sm text-ink-600">
          Nenhuma trend passa por estes filtros — limpe um deles para ver o acervo.
        </p>
      ) : (
        vista.grupos.map((g) => (
          <section key={g.rodada} className="flex flex-col gap-2">
            <SectionTitle
              action={
                <span className="text-xs text-ink-400">
                  {g.linhas.length} {g.linhas.length === 1 ? 'trend' : 'trends'}
                </span>
              }
            >
              {rotuloDaRodada(g.rodada, g.rodadaCorrente ? g.rodada : '')}
            </SectionTitle>
            <div className="rounded-card border border-line-soft bg-paper-0 shadow-(--shadow-card)">
              <DataTable
                linhas={g.linhas}
                colunas={COLUNAS}
                chaveDaLinha={(l) => l.id}
                hrefDaLinha={(l) => l.href ?? ''}
                rotuloDaLinha={(l) => `Triar a trend de ${l.criadorFrase}`}
                legenda={`Trends do radar — rodada ${g.rodada}`}
              />
            </div>
          </section>
        ))
      )}
    </div>
  )
}
