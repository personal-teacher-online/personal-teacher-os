'use client'

// A LISTA DE MENSAGENS (Onda Agenda e Mensagens · M3-3a/M3-3b) — a tabela do kit
// vestida com as colunas do outbox. Tudo o que é DECISÃO (situação, nome do
// template, destinatário, datas) chegou pronto de `src/data/admin/mensagens.ts`;
// aqui só se veste pill e coluna.
//
// Lei 1: nenhuma data é formatada aqui — `quando` e `contexto` já são texto.
// A linha é âncora de verdade (regra §7 do kit) e abre o painel da mensagem
// pela URL (`?ver=`), onde moram o erro cru e o "resolver sem enviar".
// A paginação é do SERVIDOR (50 por página, no WHERE): a tabela recebe só a
// página atual, abaixo do limiar em que ela paginaria sozinha.

import { Mail, MessageCircle } from 'lucide-react'
import type { ReactNode } from 'react'

import { DataTable, type ColunaDeTabela } from '@/components/kit/data-table'
import { Pill } from '@/components/kit/pill'
import type { MensagemDaLista } from '@/data/admin/mensagens'
import { ROTULO_DA_SITUACAO } from '@/data/admin/mensagens-gramatica'

export interface MensagemNaTela extends MensagemDaLista {
  /** endereço do painel desta mensagem, com os filtros atuais preservados */
  href: string
}

const COLUNAS: ColunaDeTabela<MensagemNaTela>[] = [
  {
    id: 'tipo',
    cabecalho: 'Mensagem',
    celula: (m) => <span className="text-sm font-medium text-ink-900">{m.tipo}</span>,
  },
  {
    id: 'destinatario',
    cabecalho: 'Para',
    celula: (m) => (
      <span
        className={
          m.destinatarioConhecido ? 'text-sm font-medium text-ink-900' : 'text-sm font-medium text-danger-700'
        }
      >
        {m.destinatario}
      </span>
    ),
  },
  {
    id: 'canal',
    cabecalho: 'Canal',
    ocultarAte: 'sm',
    celula: (m) => (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-900">
        {m.canal === 'whatsapp' ? (
          <MessageCircle aria-hidden className="h-4 w-4 shrink-0 text-ok-700" />
        ) : (
          <Mail aria-hidden className="h-4 w-4 shrink-0 text-ink-600" />
        )}
        {m.canal === 'whatsapp' ? 'WhatsApp' : 'E-mail'}
      </span>
    ),
  },
  {
    id: 'contexto',
    cabecalho: 'Sobre',
    ocultarAte: 'lg',
    celula: (m) => <span className="text-sm text-ink-600">{m.contexto ?? '—'}</span>,
  },
  {
    id: 'situacao',
    cabecalho: 'Situação',
    celula: (m) => {
      const r = ROTULO_DA_SITUACAO[m.situacao]
      return (
        <div className="flex flex-col items-start gap-1">
          <Pill tone={r.tom}>{r.frase}</Pill>
          {m.motivo && <span className="text-sm font-medium text-danger-700">{m.motivo}</span>}
        </div>
      )
    },
  },
  {
    id: 'quando',
    cabecalho: 'Quando',
    ocultarAte: 'md',
    celula: (m) => <span className="text-sm font-medium whitespace-nowrap text-ink-900">{m.quando}</span>,
  },
]

export function ListaDeMensagens({
  linhas,
  legenda,
  vazio,
}: {
  linhas: MensagemNaTela[]
  legenda: string
  vazio: ReactNode
}) {
  return (
    <DataTable
      linhas={linhas}
      colunas={COLUNAS}
      chaveDaLinha={(m) => m.id}
      hrefDaLinha={(m) => m.href}
      rotuloDaLinha={(m) => `${m.tipo} para ${m.destinatario}, ${ROTULO_DA_SITUACAO[m.situacao].frase}`}
      legenda={legenda}
      vazio={vazio}
    />
  )
}
