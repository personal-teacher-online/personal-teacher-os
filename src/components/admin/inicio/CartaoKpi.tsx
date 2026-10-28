// CARTÃO DE NÚMERO (clonagem TutorBird — anatomia CENTRALIZADA, captura 41 ·
// 26/07/2026) — a anatomia única dos 8 KPIs do Início e das pendências:
//
//   ┌──────────────────────────┐
//   │          ◯ 80px          │   círculo tint GRANDE, ícone de 32px dentro
//   │        12.480,00         │   fundo branco, radius 12, padding 22
//   │      recebido no mês     │   sombra 0 8px 16px (SEM hairline junto)
//   │   ↗ 8% vs mês anterior   │   tudo centrado, uma coluna só
//   └──────────────────────────┘
//
// A versão anterior punha o ícone pequeno (40px) no canto superior esquerdo com
// tudo alinhado à esquerda, e o dono REPROVOU: "não dá pra entender o que é cada
// caixa". O que separa um cartão do outro é a MARCA VISUAL no topo — por isso o
// círculo cresceu para 80px (64px na versão compacta das pendências) e virou a
// âncora central da coluna. O ícone acompanha (32px / 28px) com traço um pouco
// mais grosso: a 32px, o traço padrão de 2px do lucide fica proporcionalmente
// fino e o desenho "some" dentro do círculo.
//
// Régua de legibilidade (AGENTS.md) aplicada item a item: o NÚMERO é dado
// (`text-3xl font-bold`, nunca `font-extralight` — a versão anterior usava
// display fino e o dono leu como "informação apagada"); o RÓTULO é rótulo
// (`text-sm text-ink-600`, sentence case, nunca caixa alta de 11px); a
// TENDÊNCIA é apoio (`text-xs`) porque some sem tirar decisão.
//
// COR NO NÚMERO, com parcimônia: verde SÓ no dinheiro que entrou (`tom="ok"`),
// vermelho SÓ quando há atraso de verdade (`alerta`). Todo o resto é tinta.
//
// EXCEÇÃO `lista`: os cartões que trazem uma LISTA no lugar do número (ocupação
// por professora, alunos por nível) NÃO viram coluna centrada — uma lista de
// pares nome→número centrada fica ilegível. Eles mantêm o mesmo CABEÇALHO
// centrado (círculo grande + rótulo + a frase explicativa) para nivelar com os
// vizinhos, e só o corpo da lista fica alinhado à esquerda, na largura toda.
import Link from 'next/link'
import type { ComponentType, ReactNode } from 'react'

import type { Comparacao } from '@/data/admin/home'

const SETA: Record<Comparacao['sentido'], string> = { sobe: '↗', desce: '↘', igual: '→' }

export type TomDoNumero = 'ink' | 'ok'

function VsMesAnterior({ c, corte }: { c?: Comparacao; corte?: string }) {
  // Ausência é ausência: sem ponto anterior, a linha simplesmente não existe.
  if (!c) return null
  return (
    <span className="text-xs font-medium text-ac2-deep" title={corte}>
      <span aria-hidden>{SETA[c.sentido]}</span>{' '}
      {c.sentido === 'igual' ? 'igual ao' : `${c.pct}% vs`} mês anterior
    </span>
  )
}

export function CartaoKpi({
  href,
  icone: Icone,
  rotulo,
  valor,
  tom = 'ink',
  detalhe,
  comparacao,
  corte,
  alerta,
  compacto,
  lista,
  children,
}: {
  href: string
  icone: ComponentType<{ className?: string; strokeWidth?: number }>
  rotulo: string
  /** o número/valor em destaque (some quando o cartão traz uma lista) */
  valor?: string
  /** verde é só do dinheiro REALIZADO; o resto é tinta */
  tom?: TomDoNumero
  detalhe?: ReactNode
  comparacao?: Comparacao
  /** texto do `title` que revela QUAIS cortes a comparação usou */
  corte?: string
  /** vermelho + glow: só quando HÁ o estado (dinheiro em atraso) */
  alerta?: boolean
  /** versão menor, usada pelas pendências */
  compacto?: boolean
  /** o corpo é uma LISTA: cabeçalho centrado, corpo alinhado à esquerda */
  lista?: boolean
  children?: ReactNode
}) {
  const corDoNumero = alerta ? 'text-danger-700' : tom === 'ok' ? 'text-ok-700' : 'text-ink-900'
  // O rótulo quebra sozinho em até duas linhas; `text-balance` reparte as duas
  // por igual em vez de deixar uma palavra órfã embaixo.
  const rotuloEl = (
    <span className="text-balance text-sm font-medium text-ink-600">{rotulo}</span>
  )
  const detalheEl = detalhe && <span className="text-balance text-sm text-ink-600">{detalhe}</span>

  return (
    <Link
      href={href}
      className={`card-kpi card-kpi-interactive flex flex-col items-center text-center ${
        compacto ? 'gap-1.5 p-4' : 'gap-2 p-[22px]'
      } ${alerta ? '[--card-state:var(--glow-danger)]' : ''}`}
    >
      <span
        aria-hidden
        className={`mb-1 flex items-center justify-center rounded-full bg-ac-tint ${
          compacto ? 'h-16 w-16' : 'h-20 w-20'
        }`}
      >
        <Icone
          className={`text-ac-deep ${compacto ? 'h-7 w-7' : 'h-8 w-8'}`}
          strokeWidth={compacto ? 2 : 2.25}
        />
      </span>

      {lista ? (
        <>
          {rotuloEl}
          {detalheEl}
          <div className="w-full text-left">{children}</div>
        </>
      ) : (
        <>
          {valor && (
            <span
              className={`font-bold tabular-nums ${compacto ? 'text-2xl' : 'text-3xl'} ${corDoNumero}`}
            >
              {valor}
            </span>
          )}
          {children}
          {rotuloEl}
          {detalheEl}
        </>
      )}
      <VsMesAnterior c={comparacao} corte={corte} />
    </Link>
  )
}
