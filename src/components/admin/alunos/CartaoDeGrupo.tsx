// CARTÃO DE GRUPO (Onda 1 · M3 · N1) — o cartão grande que abre a lista de um
// recorte: uma professora, um produto, um nível.
//
// A IDENTIDADE DO EIXO é o que muda de um para o outro (spec do M3): bolinha da
// professora, rótulo do produto, pílula do nível. O resto é igual — contagem
// grande e, quando houver, a pendência do grupo.
//
// Contagem é DADO, e dado grande: número em `font-semibold tabular-nums`, nunca
// o cinza claro de rodapé. A pendência ("2 sem acesso ao portal") só aparece
// quando existe — inventar um "0 pendências" seria enfeite ocupando o lugar de
// informação.
//
// ELEVAÇÃO (M3-c3 · A3): este é um CARTÃO DE COISA clicável — cada um abre a
// lista de um recorte —, então ele veste a receita de elevação da casa
// (`.card-kpi` + `.card-kpi-interactive`, documentada no globals): sombra
// 0 8px 16px, raio 12, sem hairline, subindo 1px no hover. Antes era
// `rounded-card border border-line` com hover de borda, e o dono leu a grade
// como chapada. O anel de 1px continua sendo a linguagem do card-CONTÊINER que
// hospeda esta grade (`.panel-tb`) — os dois papéis seguem diferentes de
// propósito, que foi o aviso dele ("cuidado para não seguir um padrão na página
// toda"). Sombra e hairline nunca convivem: por isso a borda saiu.
//
// ARTE DE PRODUTO (visão do dono no mapeamento §Visão de produtos; artes
// APROVADAS em 27/07): no eixo `produto`, o cartão veste a arte do produto ao
// fundo com uma LAVAGEM de legibilidade — Personal One (particulares, lockup
// aprovado) e Personal Travel (banner enviado pelo dono, corte seguro).
// A lavagem é um gradiente de tinta mais pesado à ESQUERDA, que é onde o texto
// mora; o rótulo/números viram brancos por cima dela (o texto do card é HTML —
// Lei 11: nunca texto dentro da arte; o letreiro do banner do Travel é a
// própria arte do dono). O balde "sem contrato" segue no cartão neutro.
//
// UM CARTÃO, DUAS ABAS (portão visual do dono, 27/07/2026): o índice de
// Contratos passou a desenhar os mesmos cartões no "ver por" — professora,
// nível, produto e situação —, em vez da pilha de seções-com-tabela que a spec
// do M4-1 previa. Para os dois serem o MESMO cartão de verdade (e não dois que
// se parecem hoje e divergem no próximo ajuste), o desenho mora em
// `CartaoDeAcesso`, que recebe o que muda: o endereço, o substantivo contado
// ("aluno"/"contrato"), a identidade do eixo e a frase da pendência.
// `CartaoDeGrupo` continua sendo a porta do hub de alunos, agora como tradutor.
//
// Server-safe (zero client JS): é um `<Link>` e nada mais.
import Link from 'next/link'
import type { ReactNode } from 'react'

import { Pill } from '@/components/kit/pill'
import { TEACHER_FILL } from '@/components/ui'
import type { GrupoDeAlunos, Situacao } from '@/data/admin/alunos-grupos'
import {
  SEM_PROFESSORA,
  SITUACAO_DE_CONTRATO_COMO_ALUNO,
  enderecoDoGrupoDeContratos,
  type EixoDeContratos,
  type SecaoDeContratos,
} from '@/data/admin/contratos-gramatica'

const ARTE_DO_PRODUTO: Record<string, string> = {
  particular: '/brand/produtos/personal-one-card.jpg',
  travel: '/brand/produtos/personal-travel-card.jpg',
}

/**
 * Gradiente de legibilidade sobre a arte: tinta quase cheia onde o texto senta,
 * afinando para a direita para a arte respirar.
 *
 * ═══ OS NÚMEROS, E DE ONDE ELES SAEM (c13 · nº 12) ═══════════════════════════
 *
 * FONTE: `scripts/brand/medir-lavagem.mjs` — rode `node scripts/brand/medir-lavagem.mjs`
 * e o que ele imprime é o que está escrito aqui. O c12 trouxe números medidos
 * por um script que não foi commitado, e dois deles não reproduziam; número que
 * não se refaz é folclore, então a medição virou arquivo (e o teste do lote
 * confere estes números CONTRA ele, em vez de acreditar no comentário).
 *
 * O QUE O MEDIDOR FAZ: compõe ESTE gradiente sobre os JPEGs reais de
 * `public/brand/produtos/`, na geometria do cartão no viewport de 320 (256×132,
 * `bg-cover bg-center`), e varre o contraste WCAG pixel a pixel dentro do `p-4`
 * INTEIRO — não só onde as letras caem hoje, porque um rótulo mais comprido, um
 * número de quatro dígitos ou uma tradução mudam a máscara sem mudar o código.
 * Os dois tons de texto entram na conta, e o `text-white/85` da tinta secundária
 * é sempre o mais apertado dos dois.
 *
 * Com os stops de agora (88% · 74% · 66%), pior caso dentro do `p-4`:
 *   · Personal One    — 8.955:1 no branco · 7.026:1 no `white/85`
 *   · Personal Travel — 6.916:1 no branco · 5.552:1 no `white/85`
 * Os dois passam o mínimo AA de 4.5:1 com folga. O ponto mais apertado do Travel
 * (x=205) é o mesmo que o Sol descreveu na rodada 2: a região clara do avião,
 * onde a lavagem ANTIGA (86% · 62% · 28%) afinava e ele mediu 4.495:1 — abaixo
 * de AA por um triz. É esse número que os stops de hoje existem para matar.
 *
 * O preço é a arte aparecer menos à direita (34% dela, contra 72% antes). É o
 * preço certo: a arte é fundo, e o número de alunos é o dado da tela.
 */
const LAVAGEM =
  'linear-gradient(90deg, color-mix(in srgb, var(--ink-900) 88%, transparent) 0%, color-mix(in srgb, var(--ink-900) 74%, transparent) 55%, color-mix(in srgb, var(--ink-900) 66%, transparent) 100%)'

export interface CartaoDeAcessoProps {
  /** para onde o cartão abre (a lista daquele recorte) */
  href: string
  /** o nome do recorte — vira o texto do cartão quando não há pílula de nível */
  rotulo: string
  /** o número grande: quantos itens o recorte tem */
  total: number
  /** o substantivo contado, nos dois números ("aluno"/"alunos") */
  unidade: { um: string; muitos: string }
  /** identidade do eixo `produto`: a arte que o cartão veste ao fundo */
  arte?: string
  /** identidade do eixo `professora`: a bolinha de cor */
  professoraIdx?: number
  /** identidade do eixo `nivel`: a pílula da escala Flexge */
  nivel?: string | null
  /** identidade do eixo `situacao` (só no índice de contratos): a pílula */
  situacao?: { valor: Situacao; rotulo: string }
  /** a pendência do grupo — o número e a frase; ausente = não desenha nada */
  pendencia?: { total: number; texto: string }
}

/** O cartão em si: uma identidade em cima, o número grande, a pendência. */
export function CartaoDeAcesso({
  href,
  rotulo,
  total,
  unidade,
  arte,
  professoraIdx,
  nivel,
  situacao,
  pendencia,
}: CartaoDeAcessoProps) {
  const tinta = (forte: boolean) =>
    arte ? (forte ? 'text-white' : 'text-white/85') : forte ? 'text-ink-900' : 'text-ink-600'

  let identidade: ReactNode
  if (nivel)
    identidade = (
      <Pill tone="nivel" nivel={nivel}>
        {nivel}
      </Pill>
    )
  else if (situacao)
    identidade = (
      <Pill tone="situacao" situacao={situacao.valor}>
        {situacao.rotulo}
      </Pill>
    )
  else identidade = <span className={`text-sm font-semibold ${tinta(true)}`}>{rotulo}</span>

  return (
    <Link
      href={href}
      className={`card-kpi card-kpi-interactive relative flex flex-col gap-3 overflow-hidden p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ac-vivid ${arte ? 'min-h-32' : ''}`}
    >
      {arte && (
        <>
          <span
            aria-hidden
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${arte})` }}
          />
          <span aria-hidden className="absolute inset-0" style={{ background: LAVAGEM }} />
        </>
      )}

      <span className="relative flex items-center gap-2">
        {professoraIdx !== undefined && (
          <span
            aria-hidden
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${TEACHER_FILL[professoraIdx % TEACHER_FILL.length]}`}
          />
        )}
        {identidade}
      </span>

      <span className="relative flex items-baseline gap-1.5">
        <span className={`text-3xl font-semibold tabular-nums ${tinta(true)}`}>{total}</span>
        <span className={`text-sm ${tinta(false)}`}>
          {total === 1 ? unidade.um : unidade.muitos}
        </span>
      </span>

      {/* INFORMAÇÃO, não alarme (M3-c1 · C3a): a contagem de quem ainda não
          entrou no portal saía em cor de aviso, e o dono leu o cartão como
          problema. Ninguém está atrasado por não ter aceitado o convite — é um
          fato do grupo, e fato se escreve em tinta secundária, com o NÚMERO em
          destaque porque o que se lê aqui é a quantidade. */}
      {pendencia && pendencia.total > 0 && (
        <span className={`relative text-sm ${tinta(false)}`}>
          <span className={`font-semibold ${tinta(true)}`}>{pendencia.total}</span>{' '}
          {pendencia.texto}
        </span>
      )}
    </Link>
  )
}

export function CartaoDeGrupo({ grupo }: { grupo: GrupoDeAlunos }) {
  return (
    <CartaoDeAcesso
      href={`/admin/alunos/grupo/${grupo.eixo}/${encodeURIComponent(grupo.valor)}`}
      rotulo={grupo.rotulo}
      total={grupo.total}
      unidade={{ um: 'aluno', muitos: 'alunos' }}
      arte={grupo.eixo === 'produto' ? ARTE_DO_PRODUTO[grupo.valor] : undefined}
      professoraIdx={grupo.eixo === 'professora' ? grupo.professoraIdx : undefined}
      nivel={grupo.eixo === 'nivel' ? grupo.nivel : undefined}
      pendencia={{ total: grupo.semAcesso, texto: 'sem acesso ao portal' }}
    />
  )
}

/**
 * O mesmo cartão na aba CONTRATOS (portão visual do dono, 27/07/2026): um por
 * grupo do "ver por", contando CONTRATOS e com a pendência que faz clicar
 * (contrato ativo sem nenhum horário fixo).
 *
 * O eixo PRODUTO não veste arte aqui: no índice de contratos, "produto" é o
 * `plan_name` do contrato (texto livre — não existe entidade Produto no banco),
 * enquanto a arte de `public/brand/produtos` responde por `particular`/`travel`,
 * que são os produtos do hub de ALUNOS. Vestir o Personal One em todo plano
 * seria afirmar uma identidade que a linha não tem.
 */
export function CartaoDeContratos({
  eixo,
  secao,
}: {
  eixo: EixoDeContratos
  secao: SecaoDeContratos
}) {
  return (
    <CartaoDeAcesso
      href={enderecoDoGrupoDeContratos(eixo, secao.slug)}
      rotulo={secao.rotulo}
      total={secao.total}
      unidade={{ um: 'contrato', muitos: 'contratos' }}
      // "Sem professora" é um balde, não uma professora: bolinha de cor ali
      // pintaria o grupo com a cor de quem não é dele.
      professoraIdx={
        eixo === 'professora' && secao.chave !== SEM_PROFESSORA ? secao.professoraIdx : undefined
      }
      nivel={eixo === 'nivel' ? secao.nivel : undefined}
      situacao={
        eixo === 'situacao' && secao.situacao
          ? { valor: SITUACAO_DE_CONTRATO_COMO_ALUNO[secao.situacao], rotulo: secao.rotulo }
          : undefined
      }
      pendencia={{ total: secao.semHorarioFixo, texto: 'sem horário fixo' }}
    />
  )
}
