'use client'

// PAINEL LATERAL ABERTO PELA URL (Onda 1 · M3) — a casca cliente dos painéis
// que uma tela hospeda por query string (o wizard de admissão em `?novo=1`, os
// formulários da ficha, os da agenda).
//
// MUDOU DE CASA na Onda da Agenda (A1): nasceu em `components/admin/alunos/`
// servindo só o hub, mas já era importado por Contratos — e a Agenda seria a
// terceira seção. Peça usada por três seções é peça do KIT; deixá-la na pasta
// de uma delas faz a Agenda importar de "alunos" para desenhar um painel de
// aula. Nada do comportamento mudou nesta mudança, só o endereço.
//
// Por que a URL e não um `useState` local: quem abre estes painéis é um item do
// split-button, que é ÂNCORA de verdade (regra §7 — nada de ação simulada com
// JS). Além disso o wizard velho navega entre etapas por `redirect` para
// `?novo=1&s=2&aluno=…`; painel preso a estado de componente perderia o passo
// a cada volta do servidor.
//
// O CONTEÚDO vem de fora, renderizado no SERVIDOR (o wizard faz queries): esta
// casca não sabe nem quer saber o que carrega. É só o Sheet do kit — foco
// preso, Esc, foco devolvido, véu — mais a volta para a lista ao fechar.

import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'

import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/kit/sheet'

export function PainelDeUrl({
  titulo,
  descricao,
  voltarPara,
  bruto,
  children,
}: {
  titulo: string
  descricao?: string
  /** para onde o ✕ (e o Esc, e o véu) devolvem */
  voltarPara: string
  /**
   * `bruto` entrega o corpo do painel CRU, sem o `SheetBody` em volta.
   *
   * É o que os painéis de formulário da ficha (M3-2) precisam: o rodapé fixo
   * [Cancelar | Salvar] só é fixo se estiver FORA da área que rola, e o
   * `<form>` tem de envolver corpo E rodapé para o submit levar os campos.
   * Quem passa `bruto` monta o próprio `SheetBody`/`SheetFooter` — e ganha a
   * responsabilidade de manter a anatomia medida.
   */
  bruto?: boolean
  children: ReactNode
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(true)

  return (
    <Sheet
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v)
        // A navegação espera a animação de saída (180 ms, o mesmo
        // `--duration-overlay-exit` do kit): fechar e navegar no mesmo quadro
        // corta o painel pela metade.
        if (!v) setTimeout(() => router.push(voltarPara), 180)
      }}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{titulo}</SheetTitle>
          {descricao ? (
            <SheetDescription>{descricao}</SheetDescription>
          ) : (
            // O Radix exige uma descrição OU a renúncia explícita; sem uma das
            // duas ele avisa no console e o painel fica sem `aria-describedby`.
            <SheetDescription className="sr-only">{titulo}</SheetDescription>
          )}
        </SheetHeader>
        {bruto ? children : <SheetBody>{children}</SheetBody>}
      </SheetContent>
    </Sheet>
  )
}
