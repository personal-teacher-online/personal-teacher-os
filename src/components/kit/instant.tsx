// FUSO NA PORTA NOVA (Onda 1 · M1, item 6 — Lei 1).
//
// O cliente NÃO formata data. A regra de lint (`ptos/no-client-timezone`)
// proíbe `new Date(…)` e `toLocaleString` em arquivo `"use client"`, e esta é a
// peça que sobra: o servidor calcula no fuso certo (Luxon + zona IANA) e manda
// o TEXTO pronto; o componente só o pinta.
//
// Por que isso não é preciosismo: o navegador da dona está em Cuiabá, o da
// aluna em Lisboa e o do servidor em UTC. Qualquer formatação no cliente
// escolhe o fuso do NAVEGADOR — que é justamente o fuso que a Lei 1 diz não
// existir no domínio.
import type { ReactNode } from 'react'

/** O que o servidor manda: texto já formatado + o instante para a máquina. */
export interface Instante {
  /** já formatado no fuso certo, em pt-BR (ex.: "seg, 27/07 às 14:00") */
  texto: string
  /** ISO UTC — vai só para o atributo `datetime`, NUNCA para a tela */
  iso: string
  /** leitura auxiliar (ex.: a hora do aluno), também pronta */
  titulo?: string
}

export function InstanteTexto({
  value,
  className,
  children,
}: {
  value: Instante
  className?: string
  /** substitui o texto (ex.: só a hora), mantendo `datetime` e `title` */
  children?: ReactNode
}) {
  return (
    <time dateTime={value.iso} title={value.titulo} className={className}>
      {children ?? value.texto}
    </time>
  )
}
