'use client'

// A LISTA DA PAUTA (frente de conteúdo · M4) — a tabela do kit vestida com as
// colunas dos criadores de referência.
//
// EIXO DOMINANTE: MERCADO (Design.md §organização em blocos). O que a curadoria
// persegue é o equilíbrio entre a referência brasileira e a de fora, então é por
// ele que a lista se parte. Bloco vazio não renderiza. Plataforma vira pílula na
// linha, não um segundo eixo — dois cortes cruzados numa lista de ~20 nomes só
// dariam trabalho de leitura.
//
// ⚠️ DEGRADAÇÃO A 390px, o critério que o loop do M3 ensinou: oito colunas não
// cabem no celular. Tudo além de Criador some abaixo de `sm` e vira pílula sob
// o nome (a linha inteira continua clicável e o dado continua no painel).
// Print com corte ou rolagem horizontal REPROVA o loop.
//
// Régua de legibilidade (AGENTS.md): nome, @, métrica e data são DADO — piso
// `text-sm font-medium text-ink-900`, nunca `text-xs` nem `ink-400`. O que é
// apoio de verdade (a contagem do bloco) pode ser pequeno.
//
// Cliente porque a `DataTable` é cliente (paginação, kebab): as colunas são
// funções e não atravessam a fronteira. Nada aqui FORMATA data — as strings
// chegam prontas de `src/data/admin/pauta.ts` (Lei 1 e régua da casa).

import { Pill, SectionTitle } from '@/components/ui'
import { DataTable, type ColunaDeTabela } from '@/components/kit/data-table'
import {
  PAIS_ROTULO,
  PLATAFORMA_ROTULO,
  TIER_ROTULO,
  TIPO_ROTULO,
  enderecoDoPainel,
} from '@/data/admin/pauta-gramatica'
import type { CriadorDaPauta, GrupoDaPauta } from '@/data/admin/pauta'

const COLUNAS: ColunaDeTabela<CriadorDaPauta>[] = [
  {
    id: 'criador',
    cabecalho: 'Criador',
    celula: (c) => (
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ink-900">{c.nome}</span>
        {/* `break-all`: handle longo (@speakenglishwithvanessa) empurrava a
            tabela inteira e cortava a última coluna a 390px. */}
        <span className="text-sm break-all text-ink-600">@{c.handle}</span>
        {/* No celular as colunas viram PÍLULAS SOB O NOME — a anatomia que a
            `DataTable` já declara para a célula de identidade. É isto, e não
            "esconder e torcer", que faz a linha caber a 390px sem perder dado. */}
        <span className="mt-1 flex flex-wrap gap-1.5 sm:hidden">
          <Pill tone="neutral">{PLATAFORMA_ROTULO[c.plataforma]}</Pill>
          {/* No celular só o DESVIO vira pílula: "Criador" em toda linha seria
              ruído; empresa e tier definido são a informação (Leva 1). */}
          {c.tipo === 'empresa' && <Pill tone="neutral">{TIPO_ROTULO.empresa}</Pill>}
          {c.tier && <Pill tone="neutral">{TIER_ROTULO[c.tier]}</Pill>}
          {c.ativo ? <Pill tone="ok">Ativo</Pill> : <Pill tone="neutral">Desativado</Pill>}
        </span>
      </span>
    ),
  },
  {
    id: 'plataforma',
    cabecalho: 'Plataforma',
    ocultarAte: 'sm',
    celula: (c) => <Pill tone="neutral">{PLATAFORMA_ROTULO[c.plataforma]}</Pill>,
  },
  {
    id: 'tipo',
    cabecalho: 'Tipo',
    ocultarAte: 'sm',
    celula: (c) => <Pill tone="neutral">{TIPO_ROTULO[c.tipo]}</Pill>,
  },
  {
    id: 'tier',
    cabecalho: 'Tier',
    ocultarAte: 'sm',
    // Sem classificação é ESTADO, não dado faltando: o travessão diz isso e o
    // painel de edição é onde se classifica (dado real ≥ text-sm font-medium).
    celula: (c) =>
      c.tier ? (
        <span className="text-sm font-medium text-ink-900">{TIER_ROTULO[c.tier]}</span>
      ) : (
        <span className="text-sm text-ink-600">—</span>
      ),
  },
  {
    id: 'metricas',
    cabecalho: 'Métricas',
    ocultarAte: 'sm',
    celula: (c) => (
      <span className="text-sm font-medium text-ink-900">{c.resumoDaMedicao ?? '—'}</span>
    ),
  },
  {
    id: 'medido',
    cabecalho: 'Medido em',
    ocultarAte: 'sm',
    celula: (c) => (
      <span className="text-sm font-medium text-ink-900">{c.medidoEmFrase ?? '—'}</span>
    ),
  },
  {
    id: 'situacao',
    cabecalho: 'Situação',
    ocultarAte: 'sm',
    // Desativado é ESCOLHA da curadoria, não alerta: pílula neutra, nunca `warn`.
    celula: (c) =>
      c.ativo ? <Pill tone="ok">Ativo</Pill> : <Pill tone="neutral">Desativado</Pill>,
  },
]

export function ListaDaPauta({ grupos }: { grupos: GrupoDaPauta[] }) {
  return (
    <div className="flex flex-col gap-6">
      {grupos
        .filter((g) => g.criadores.length > 0)
        .map((g) => (
          <section key={g.pais} className="flex flex-col gap-2">
            <SectionTitle>
              {PAIS_ROTULO[g.pais]}{' '}
              <span className="text-xs font-normal text-ink-400">
                {g.criadores.length} {g.criadores.length === 1 ? 'criador' : 'criadores'}
              </span>
            </SectionTitle>
            <DataTable
              linhas={g.criadores}
              colunas={COLUNAS}
              chaveDaLinha={(c) => c.id}
              hrefDaLinha={(c) => enderecoDoPainel('editar', c.id)}
              rotuloDaLinha={(c) => `Editar ${c.nome}`}
              legenda={`Criadores de referência — ${PAIS_ROTULO[g.pais]}`}
            />
          </section>
        ))}
    </div>
  )
}
