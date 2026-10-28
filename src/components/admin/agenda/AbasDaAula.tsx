'use client'

// AS DUAS ABAS DO BALÃO DA AULA (Onda da Agenda · A5/L4): Desfecho | Histórico.
//
// Por que um componente próprio e não o `CardPanelTabs` do kit: aquele navega
// por URL (cada aba é um `<Link>`), e aqui a troca de aba não pode recarregar a
// página — o balão fecharia, e com ele o formulário meio preenchido. Estas abas
// são estado LOCAL, no padrão ARIA de tablist.
//
// OS DOIS PAINÉIS FICAM MONTADOS, e o inativo esconde-se com o atributo
// `hidden`: o painel do Desfecho hospeda um `<form>` com radio, tema e nota, e
// desmontá-lo ao olhar o histórico apagaria o que a dona acabou de escolher.
// `hidden` também tira o conteúdo da árvore de acessibilidade e do Tab — nada
// invisível continua alcançável, que é a mesma invariante da grade.
//
// O CONTEÚDO CHEGA COMO `children` (ReactNode renderizado no SERVIDOR): a lista
// do histórico é dado do banco com datas já formatadas (Lei 1 — cliente não
// formata data), e o formulário do desfecho é a peça cliente própria dele.

import { useId, useState } from 'react'
import type { ReactNode } from 'react'

type Aba = 'desfecho' | 'historico'

export function AbasDaAula({
  desfecho,
  historico,
  quantosNoHistorico,
}: {
  desfecho: ReactNode
  historico: ReactNode
  /** vai no rótulo da aba: "X de Y" e contagem são DADO, inclusive zero */
  quantosNoHistorico: number
}) {
  const [aba, setAba] = useState<Aba>('desfecho')
  const base = useId()
  const idDaAba = (a: Aba) => `${base}-${a}-aba`
  const idDoPainel = (a: Aba) => `${base}-${a}-painel`

  const botao = (a: Aba, rotulo: string) => (
    <button
      type="button"
      role="tab"
      id={idDaAba(a)}
      aria-selected={aba === a}
      aria-controls={idDoPainel(a)}
      // Aba não selecionada sai do Tab (padrão ARIA de tablist): a navegação
      // entre abas é por seta, e o Tab leva ao conteúdo.
      tabIndex={aba === a ? 0 : -1}
      onClick={() => setAba(a)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault()
          const outra: Aba = a === 'desfecho' ? 'historico' : 'desfecho'
          setAba(outra)
          document.getElementById(idDaAba(outra))?.focus()
        }
      }}
      // alvo ≥ 24px e texto no piso de AÇÃO da régua (≥ text-sm)
      className={`-mb-px inline-flex min-h-9 items-center border-b-2 px-2 text-sm font-semibold transition-colors ${
        aba === a
          ? 'border-ac-deep text-ink-900'
          : 'border-transparent text-ink-600 hover:text-ink-900'
      }`}
    >
      {rotulo}
    </button>
  )

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="O que fazer com esta aula" className="flex gap-1 border-b border-line">
        {botao('desfecho', 'Desfecho')}
        {botao('historico', `Histórico (${quantosNoHistorico})`)}
      </div>
      <div
        role="tabpanel"
        id={idDoPainel('desfecho')}
        aria-labelledby={idDaAba('desfecho')}
        hidden={aba !== 'desfecho'}
      >
        {desfecho}
      </div>
      <div
        role="tabpanel"
        id={idDoPainel('historico')}
        aria-labelledby={idDaAba('historico')}
        hidden={aba !== 'historico'}
      >
        {historico}
      </div>
    </div>
  )
}
