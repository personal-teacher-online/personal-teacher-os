// Pill do kit (Onda 1 · M1). Igual à `Pill` de components/ui.tsx em anatomia,
// diferente em PALETA: aqui o tom de marca é o ACENTO (`--ac-*`), nunca
// `--brand-*` (o tema do admin mora no `:root` do globals.css, D10 martelada).
//
// Tons: ok/warn/danger são ESTADO (só existem quando há estado); `ac` é a voz
// da marca; `nivel` é a ESCALA de proficiência; neutral/muted são o resto.
// Nada de tom novo sem significado novo.
//
// `nivel` é o tom da ETIQUETA DE NÍVEL, e é o único que recebe um VALOR: a cor
// sai do nível do aluno, não de quem chama (M3-c1 · C2). Ele substituiu o tom
// `ac2`, que existia só para essa etiqueta — o 2º acento do duo segue vivo e
// consumido em dois lugares honestos: a tendência dos KPIs (`text-ac2-deep`,
// em CartaoKpi) e a própria banda B1 da escala, que é `--ac2-*` sem hex novo.
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'
import type { Situacao } from '@/data/admin/alunos-grupos'

export type PillTone =
  | 'ok'
  | 'warn'
  | 'danger'
  | 'ac'
  | 'nivel'
  | 'situacao'
  | 'neutral'
  | 'muted'

// F1 do lote c7: o `ok` deixou a lavagem de ALPHA (`bg-ok-700/10`) por um hex
// fixo (`--ok-wash`). Com alpha, o contraste real do par dependia da superfície
// de baixo — 4,43:1 sobre cartão branco, 4,30:1 sobre o fundo de página —, e
// nenhum teste podia provar o que a pessoa vê. Com o wash achatado e o verde um
// degrau mais escuro, o par medido é 5,57:1 e é sempre o mesmo.
//
// Q1 do c7b: `warn` e `danger` seguiram o mesmo caminho — a família inteira de
// ESTADO agora veste lavagem sólida. O warn REPROVAVA (4,27:1 sobre --paper-50,
// 3,98:1 sobre --paper-100); o danger passava com folga, mas por acaso do hex,
// não por desenho. Pares medidos: warn 4,62:1, danger 5,68:1, em qualquer
// superfície. Alpha continua legítimo em BORDA e em fundo de cartão com texto
// de tinta (`bg-warn-700/5 text-ink-900`) — ali o par é outro.
const TONE: Record<Exclude<PillTone, 'nivel' | 'situacao'>, string> = {
  ok: 'bg-ok-wash font-semibold text-ok-700',
  warn: 'bg-warn-wash font-semibold text-warn-700',
  danger: 'bg-danger-wash font-semibold text-danger-700',
  ac: 'bg-ac-deep/10 font-semibold text-ac-deep',
  neutral: 'bg-paper-100 font-medium text-ink-600',
  muted: 'border border-line font-medium text-ink-600',
}

/* ---- escala de nível (C2) -------------------------------------------------
   A cor é DECIDIDA no globals.css (`--nivel-*-bg/-fg`, com a psicologia da
   escala e os contrastes anotados lá). Aqui mora só o mapa nível → banda.

   Onze níveis Flexge, SEIS bandas: o `+` da Flexge é um degrau DENTRO do
   degrau do CEFR ("A1+" é a segunda metade de A1), e inventar uma sétima cor
   para ele quebraria a leitura da escala. Então a banda é a do prefixo CEFR, e
   "Pre A1" mora junto de A1: os dois são o mesmo começo. */
export type BandaDeNivel = 'none' | 'a1' | 'a2' | 'b1' | 'b2' | 'c1' | 'c2'

const NIVEL_BG: Record<BandaDeNivel, string> = {
  none: 'bg-nivel-none-bg font-medium text-nivel-none-fg',
  a1: 'bg-nivel-a1-bg font-semibold text-nivel-a1-fg',
  a2: 'bg-nivel-a2-bg font-semibold text-nivel-a2-fg',
  b1: 'bg-nivel-b1-bg font-semibold text-nivel-b1-fg',
  b2: 'bg-nivel-b2-bg font-semibold text-nivel-b2-fg',
  c1: 'bg-nivel-c1-bg font-semibold text-nivel-c1-fg',
  c2: 'bg-nivel-c2-bg font-semibold text-nivel-c2-fg',
}

/**
 * De que banda de cor é este nível? Função PURA — os testes conferem os onze.
 *
 * Nível desconhecido cai em `none` (a lavagem neutra), nunca numa cor
 * inventada: o vocabulário é o de `nivelValido`, e o que não passa por lá não
 * ganha degrau na escala.
 */
export function bandaDeNivel(nivel: string | null | undefined): BandaDeNivel {
  if (!nivel) return 'none'
  const chave = nivel.toUpperCase().replace(/[\s+]/g, '')
  if (chave === 'PREA1' || chave === 'A1') return 'a1'
  if (chave === 'A2') return 'a2'
  if (chave === 'B1') return 'b1'
  if (chave === 'B2') return 'b2'
  if (chave === 'C1') return 'c1'
  if (chave === 'C2') return 'c2'
  return 'none'
}

/* ---- ciclo de vida (fase 1) -----------------------------------------------
   O SEGUNDO tom que recebe um valor, pela mesma razão do `nivel`: a cor sai da
   SITUAÇÃO do aluno, não de quem chama — assim a badge do filtro, a pílula da
   linha e o cabeçalho da ficha não podem divergir.

   Como na escala de nível, a COR é decidida no globals.css (`--situacao-*-bg/
   -fg`, com a psicologia e os contrastes anotados lá); aqui mora só o mapa
   situação → par. Duas situações são estado (ativo/pausado) e vestem as cores
   de estado da casa; lead e experimental são etapa de funil; sem contrato e
   arquivado são ausência, e recuam no papel. */
const SITUACAO_BG: Record<Situacao, string> = {
  lead: 'bg-situacao-lead-bg font-semibold text-situacao-lead-fg',
  experimental: 'bg-situacao-experimental-bg font-semibold text-situacao-experimental-fg',
  ativo: 'bg-situacao-ativo-bg font-semibold text-situacao-ativo-fg',
  pausado: 'bg-situacao-pausado-bg font-semibold text-situacao-pausado-fg',
  sem_contrato: 'bg-situacao-sem-contrato-bg font-medium text-situacao-sem-contrato-fg',
  arquivado: 'bg-situacao-arquivado-bg font-medium text-situacao-arquivado-fg',
}

export function Pill({
  tone = 'neutral',
  nivel,
  situacao,
  title,
  className,
  children,
}: {
  tone?: PillTone
  /** só para `tone="nivel"`: o nível cru do aluno, que ESCOLHE a cor */
  nivel?: string | null
  /** só para `tone="situacao"`: a situação derivada, que ESCOLHE a cor */
  situacao?: Situacao
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs whitespace-nowrap',
        tone === 'nivel'
          ? NIVEL_BG[bandaDeNivel(nivel)]
          : tone === 'situacao'
            ? SITUACAO_BG[situacao ?? 'sem_contrato']
            : TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
