'use client'

// A LISTA DE RECEBIDAS (issue #113) — o que os alunos escreveram ao número de
// envio, na tabela do kit. Só leitura: a linha não abre painel e nada aqui
// desliga o WhatsApp de ninguém. Quem decide é a admin, pela ficha do aluno
// (painel "Editar WhatsApp"), por isso o nome do aluno é link para ela.
//
// Lei 1: nenhuma data é formatada aqui — `quando` já chega como texto.
// Tudo o que é DECISÃO (quem é, qual aviso respondeu, se pediu para parar) chegou
// pronto de `src/data/admin/recebidas.ts`.

import Link from 'next/link'
import type { ReactNode } from 'react'

import { DataTable, type ColunaDeTabela } from '@/components/kit/data-table'
import { Pill } from '@/components/kit/pill'
import type { RecebidaDaLista } from '@/data/admin/recebidas'

export interface RecebidaNaTela extends Omit<RecebidaDaLista, 'alunos'> {
  /** cada aluno com o endereço da ficha dele, no painel WhatsApp */
  alunos: Array<{ id: string; nome: string; href: string }>
}

const COLUNAS: ColunaDeTabela<RecebidaNaTela>[] = [
  {
    id: 'aluno',
    cabecalho: 'De',
    celula: (r) =>
      r.alunos.length > 0 ? (
        <div className="flex flex-col items-start gap-0.5">
          {r.alunos.map((a) => (
            <Link
              key={a.id}
              href={a.href}
              className="text-sm font-medium text-ac-deep underline underline-offset-2"
            >
              {a.nome}
            </Link>
          ))}
          {r.numero && <span className="text-sm tabular-nums text-ink-600">{r.numero}</span>}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-sm font-medium text-danger-700">Número desconhecido</span>
          {r.numero && <span className="text-sm tabular-nums text-ink-600">{r.numero}</span>}
        </div>
      ),
  },
  {
    id: 'mensagem',
    cabecalho: 'Mensagem',
    celula: (r) => (
      <div className="flex flex-col items-start gap-1">
        {r.texto ? (
          <p className="max-w-prose text-sm break-words whitespace-pre-wrap text-ink-900">{r.texto}</p>
        ) : (
          <p className="text-sm font-medium text-ink-900">{r.tipo}</p>
        )}
        {r.texto && r.tipo !== 'Texto' && <p className="text-sm text-ink-600">{r.tipo}</p>}
        {r.pediuParaParar && <Pill tone="danger">Pediu para parar</Pill>}
      </div>
    ),
  },
  {
    id: 'respondeA',
    cabecalho: 'Respondeu a',
    ocultarAte: 'lg',
    celula: (r) => <span className="text-sm text-ink-600">{r.respondeA ?? '—'}</span>,
  },
  {
    id: 'quando',
    cabecalho: 'Quando',
    celula: (r) => <span className="text-sm font-medium whitespace-nowrap text-ink-900">{r.quando}</span>,
  },
]

export function ListaDeRecebidas({
  linhas,
  legenda,
  vazio,
}: {
  linhas: RecebidaNaTela[]
  legenda: string
  vazio: ReactNode
}) {
  return <DataTable linhas={linhas} colunas={COLUNAS} chaveDaLinha={(r) => r.id} legenda={legenda} vazio={vazio} />
}
