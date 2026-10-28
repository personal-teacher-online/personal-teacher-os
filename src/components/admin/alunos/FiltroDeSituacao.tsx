// FILEIRA DE BOTÕES DO CICLO DE VIDA — o filtro do funil logo acima da tabela:
// Todos · Lead · Experimental · Ativo · Pausado · Sem contrato · Arquivado,
// cada um com a contagem viva ao lado.
//
// É NAVEGAÇÃO, não estado de componente: cada botão é uma âncora de verdade que
// vira `?situacao=…` na barra de endereço — funciona com o teclado, com o
// meio-clique e com o F5, e o link salvo abre no recorte certo.
//
// A CHAVE É `?situacao=`, e não `?f=` (P10 da revisão nº 8): `?f=` já era o
// vocabulário de ACESSO da aba Convites, e as duas listas têm a palavra
// `ativo` — a mesma URL passaria a querer dizer duas coisas conforme a rota que
// a recebesse. Cada vocabulário com a sua chave; a página de Alunos encaminha
// os links antigos.
//
// BOTÃO DE VERDADE (ordem do dono, 27/07, na primeira passada em produção): a
// versão anterior vestia cada item com a `Pill` da linha e marcava o ativo com
// um anel de outline — ele viu "um círculo ao redor de uma informação" e
// "Todos e Lead com a mesma cor" (verdade literal: `--situacao-lead-*` É o par
// do acento, o mesmo do tom `ac` do "Todos"). Agora o item é o botão da casa:
// inativo = `.btn-ac-soft` (branco com contorno), ativo = `.btn-ac` (sólido) —
// o estado é o PREENCHIMENTO, nunca uma cor de identidade.
//
// O vocabulário de COR da situação não morreu: virou um PONTO à esquerda do
// rótulo, com o `-fg` da mesma dupla de tokens da pílula da linha — a badge que
// filtra e a badge que descreve seguem a mesma paleta, sem competir com o
// estado ativo. No botão sólido o ponto vira branco (qualquer `-fg` escuro
// sumiria sobre o periwinkle).
//
// "Todos" NÃO é a soma dos outros, de propósito: ele é a visão de TRABALHO (o
// dia a dia da escola, sem lead e sem arquivado), que é o que a tela mostra
// quando ninguém pediu recorte. Os outros seis contam o universo inteiro. Ele
// também não ganha ponto: não é uma situação, é a ausência de recorte.

import Link from 'next/link'

import { SITUACAO_FILTRO, SITUACOES, type Situacao } from '@/data/admin/alunos-grupos'
import { cn } from '@/lib/cn'

/** Ponto de cor: o `-fg` da situação (o `-bg` é lavagem clara — invisível num
 *  ponto de 8px). Mapa completo de propósito: situação sem ponto quebraria o
 *  vocabulário em silêncio, e o teste da onda confere as seis chaves. */
const PONTO: Record<Situacao, string> = {
  lead: 'bg-situacao-lead-fg',
  experimental: 'bg-situacao-experimental-fg',
  ativo: 'bg-situacao-ativo-fg',
  pausado: 'bg-situacao-pausado-fg',
  sem_contrato: 'bg-situacao-sem-contrato-fg',
  arquivado: 'bg-situacao-arquivado-fg',
}

export function FiltroDeSituacao({
  contagens,
  recorte,
  total,
  /** endereço-base da lista (o hub) — o filtro só acrescenta `?situacao=` */
  base = '/admin/alunos',
}: {
  contagens: Record<Situacao, number>
  recorte: Situacao | null
  /** tamanho da lista de TRABALHO (o número do "Todos") */
  total: number
  base?: string
}) {
  const itens: { valor: Situacao | null; rotulo: string; quantos: number }[] = [
    { valor: null, rotulo: 'Todos', quantos: total },
    ...SITUACOES.map((s) => ({ valor: s, rotulo: SITUACAO_FILTRO[s], quantos: contagens[s] })),
  ]

  return (
    <nav
      aria-label="Filtrar por situação do aluno"
      className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"
    >
      {itens.map((i) => {
        const ativo = i.valor === recorte
        return (
          <Link
            key={i.rotulo}
            href={i.valor ? `${base}?situacao=${i.valor}` : base}
            aria-current={ativo ? 'page' : undefined}
            className={ativo ? 'btn-ac' : 'btn-ac-soft'}
          >
            {i.valor && (
              <span
                aria-hidden
                className={cn('h-2 w-2 shrink-0 rounded-full', ativo ? 'bg-white' : PONTO[i.valor])}
              />
            )}
            {i.rotulo}
            {/* A contagem é DADO: tabular e na MESMA cor do rótulo (a régua da
                casa proíbe dado em cinza-claro) — o peso 400 contra o 600 do
                rótulo é o que separa o par sem apagar o número. */}
            <span className="font-normal tabular-nums">{i.quantos}</span>
          </Link>
        )
      })}
    </nav>
  )
}
