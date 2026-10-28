'use client'

// A LISTA DE ALUNOS (Onda 1 · M3) — a tabela do kit vestida com as colunas do
// hub, mais a busca que a filtra AO VIVO. Vive nas duas telas: no hub (visão
// "Todos") e na página de um grupo.
//
// Por que a busca mora aqui e não numa `<form>` que recarrega a página: a lista
// inteira já veio no primeiro request (são ~20 alunos, não 20 mil), e o item 7
// das fundações pede contagem REAGINDO enquanto se digita. Ida ao servidor por
// tecla seria latência sem informação nova.
//
// Uma decisão de comportamento que vale registrar: com busca ESCRITA, o
// conteúdo passa a ser sempre a TABELA — mesmo quando a visão escolhida é por
// professora/produto/nível. Quem digita um nome está procurando uma PESSOA, e
// devolver cartões de grupo nessa hora seria responder outra pergunta. Apagou a
// busca, a visão volta ao que estava (o estado dela mora na URL, não aqui).
//
// A busca varre um universo maior que a tabela (`buscaveis`): o hub esconde
// aluno ARQUIVADO da lista de trabalho, mas ninguém pode ficar inalcançável —
// digitou o nome, ele aparece, com a pílula dizendo que está arquivado.
//
// Lei 1: nenhuma data é formatada aqui. `horaLocal` já chega pronta do
// servidor, calculada na zona IANA do aluno.

import { useId, useState, type ReactNode } from 'react'

import { Avatar } from '@/components/kit/avatar'
import { DataTable, type AcaoDeLinha, type ColunaDeTabela } from '@/components/kit/data-table'
import { EmptyState } from '@/components/kit/empty-state'
import { Pill, type PillTone } from '@/components/kit/pill'
import { TEACHER_FILL } from '@/components/ui'
import {
  ACESSO_ROTULO,
  SITUACAO_ROTULO,
  casaComBusca,
  type AlunoDaLista,
} from '@/data/admin/alunos-grupos'

const ACESSO_TOM: Record<AlunoDaLista['acesso'], PillTone> = {
  ativo: 'ok',
  pendente: 'warn',
  sem_convite: 'neutral',
}

/**
 * Avatar + nome + pílula da SITUAÇÃO no ciclo de vida, na anatomia medida da
 * lista deles. Exportada porque a aba Convites (M3-3) desenha a mesma coluna —
 * duas cópias divergiriam no primeiro ajuste.
 *
 * A pílula era o `students.status` cru ("ativo"/"arquivado") e passou a ser a
 * situação DERIVADA (fase 1 do ciclo de vida): é a mesma palavra e a mesma cor
 * das badges de filtro que estão logo acima da tabela — se a linha dissesse
 * outra coisa, o filtro viraria loteria.
 */
export function ColunaIdentidade({ aluno }: { aluno: AlunoDaLista }) {
  return (
    <span className="flex items-center gap-3">
      <Avatar id={aluno.id} nome={aluno.nome} />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold whitespace-nowrap text-ink-900">{aluno.nome}</span>
        {/* A pílula MORA SOB O NOME (anatomia medida na lista deles) — não ao
            lado, onde ela empurra o nome e a coluna respira mal. */}
        <span>
          <Pill tone="situacao" situacao={aluno.situacao}>
            {SITUACAO_ROTULO[aluno.situacao]}
          </Pill>
        </span>
      </span>
    </span>
  )
}

function ColunaVinculo({ aluno }: { aluno: AlunoDaLista }) {
  if (!aluno.mentoria && aluno.particulares.length === 0)
    return <span className="text-sm text-ink-600">sem contrato ativo</span>
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {aluno.mentoria && <Pill tone="ac">Personal Travel</Pill>}
      {aluno.particulares.map((p) => (
        <span
          key={p.contratoId}
          className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap text-ink-600"
        >
          {/* Cor por professora: o mesmo índice da agenda e do Início. Sem
              nome junto, a bolinha seria enigma. */}
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${TEACHER_FILL[p.professoraIdx % TEACHER_FILL.length]}`}
          />
          {p.professora ?? '—'}
          {/* A turma é DADO (é ela que diz em qual grupo o aluno estuda): cinza
              LEGÍVEL, nunca o ink-400 de apoio — varredura do M3-3. */}
          {p.turma && <span className="text-ink-600">({p.turma})</span>}
        </span>
      ))}
    </span>
  )
}

export function ListaDeAlunos({
  alunos,
  buscaveis,
  acoes,
  controles,
  children,
  vazio,
  legenda,
  buscaInicial = '',
  placeholder = 'Buscar aluno…',
}: {
  /** o que a tabela mostra quando não há busca */
  alunos: AlunoDaLista[]
  /** universo que a busca varre (default: os mesmos da tabela) */
  buscaveis?: AlunoDaLista[]
  /** slot esquerdo da toolbar: criar/agir */
  acoes?: ReactNode
  /** slot direito da toolbar, antes da busca: ver por… */
  controles?: ReactNode
  /** conteúdo alternativo enquanto a busca está vazia (os cartões de grupo) */
  children?: ReactNode
  /** estado vazio da tabela */
  vazio: ReactNode
  legenda: string
  /** `?q=` da lista velha: link salvo continua abrindo com a busca escrita */
  buscaInicial?: string
  placeholder?: string
}) {
  const [termo, setTermo] = useState(buscaInicial)
  const campo = useId()

  const universo = buscaveis ?? alunos
  const buscando = termo.trim().length > 0
  const linhas = buscando ? universo.filter((a) => casaComBusca(a, termo)) : alunos

  const colunas: ColunaDeTabela<AlunoDaLista>[] = [
    {
      id: 'aluno',
      cabecalho: 'Aluno',
      celula: (a) => <ColunaIdentidade aluno={a} />,
    },
    {
      id: 'vinculo',
      cabecalho: 'Produto / professora',
      ocultarAte: 'md',
      celula: (a) => <ColunaVinculo aluno={a} />,
    },
    {
      id: 'nivel',
      cabecalho: 'Nível',
      ocultarAte: 'sm',
      celula: (a) =>
        a.nivel ? (
          <Pill tone="nivel" nivel={a.nivel}>
            {a.nivel}
          </Pill>
        ) : (
          <span className="text-sm text-ink-600">—</span>
        ),
    },
    {
      id: 'onde',
      cabecalho: 'Onde vive',
      ocultarAte: 'lg',
      celula: (a) => (
        <span className="flex flex-col gap-0.5 whitespace-nowrap">
          <span className="text-sm text-ink-900">{a.cidade}</span>
          {/* Hora local: DADO (é ela que diz se dá para ligar agora), então
              14px em cinza legível — e calculada no servidor (Lei 1). */}
          <span className="text-sm tabular-nums text-ink-600">{a.horaLocal} agora</span>
        </span>
      ),
    },
    {
      id: 'creditos',
      cabecalho: 'Créditos',
      numerica: true,
      ocultarAte: 'sm',
      celula: (a) =>
        a.creditos === null ? (
          <span className="text-sm text-ink-600">—</span>
        ) : (
          <span className="text-sm font-semibold text-ink-900">{a.creditos}</span>
        ),
    },
    {
      id: 'acesso',
      cabecalho: 'Acesso',
      celula: (a) => (
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone={ACESSO_TOM[a.acesso]}>{ACESSO_ROTULO[a.acesso]}</Pill>
          {a.emailDevolvido && (
            <span
              className="text-sm font-semibold whitespace-nowrap text-danger-700"
              title="O Resend reportou devolução — confira o e-mail na ficha"
            >
              e-mail devolvido
            </span>
          )}
        </span>
      ),
    },
  ]

  const acoesDaLinha = (a: AlunoDaLista): AcaoDeLinha[] => {
    const itens: AcaoDeLinha[] = [{ rotulo: 'Ver ficha', href: `/admin/alunos/${a.id}` }]
    // O convite continua sendo o MESMO fluxo de sempre (o painel da ficha, com
    // e-mail e WhatsApp) — aqui só se chega mais rápido nele. LEAD fica de
    // fora: na fase 1 do ciclo de vida ele não tem portal, e o acesso nasce
    // junto do contrato.
    if (a.acesso === 'sem_convite' && a.situacao !== 'lead')
      itens.push({ rotulo: 'Convidar para o portal', href: `/admin/alunos/${a.id}?painel=convidar` })
    return itens
  }

  return (
    <div className="flex flex-col">
      {/* TOOLBAR BIPARTIDA (§2 do plano): criar/agir à esquerda, ver/buscar à
          direita, dentro do contêiner. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">{acoes}</div>
        <div className="flex flex-wrap items-center gap-3">
          {controles}
          <label htmlFor={campo} className="sr-only">
            {placeholder}
          </label>
          <input
            id={campo}
            type="search"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder={placeholder}
            className="min-h-9 w-56 max-w-full rounded-input border border-line bg-paper-0 px-3 py-1.5 text-sm text-ink-900 transition-colors duration-(--duration-hover) ease-(--ease-in-out) outline-none placeholder:text-ink-400 hover:border-ink-400 focus-visible:border-ac-vivid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ac-vivid"
          />
        </div>
      </div>

      {/* CONTAGEM VIVA: muda a cada tecla e é ANUNCIADA (item 7 das fundações
          — "a contagem visível muda"). Fora da busca ela é só o tamanho da
          lista, que também é dado. */}
      <p
        aria-live="polite"
        className="border-b border-line-soft px-4 py-2 text-sm font-medium tabular-nums text-ink-900"
      >
        {buscando
          ? `${linhas.length} ${linhas.length === 1 ? 'aluno encontrado' : 'alunos encontrados'} para “${termo.trim()}”`
          : `${alunos.length} ${alunos.length === 1 ? 'aluno' : 'alunos'}`}
      </p>

      {!buscando && children ? (
        children
      ) : (
        <DataTable
          linhas={linhas}
          colunas={colunas}
          chaveDaLinha={(a) => a.id}
          hrefDaLinha={(a) => `/admin/alunos/${a.id}`}
          rotuloDaLinha={(a) => a.nome}
          acoesDaLinha={acoesDaLinha}
          legenda={legenda}
          vazio={
            buscando ? (
              <EmptyState
                illustration="/illustrations/agenda-vazia.svg"
                title="Ninguém com esse nome."
                hint={
                  // A frase muda com o ESCOPO real da busca: no hub ela varre
                  // até os arquivados; dentro de um grupo, só o grupo. Dizer
                  // "nem entre os arquivados" onde eles nem foram procurados
                  // seria mentira de rodapé.
                  universo.length > alunos.length
                    ? `Nenhum aluno casa com “${termo.trim()}” — nem entre os arquivados. Confira a grafia ou limpe a busca para ver a lista inteira.`
                    : `Nenhum aluno desta lista casa com “${termo.trim()}”. Confira a grafia, ou limpe a busca para ver o grupo inteiro.`
                }
                action={
                  <button type="button" onClick={() => setTermo('')} className="btn-ac">
                    Limpar a busca
                  </button>
                }
              />
            ) : (
              vazio
            )
          }
        />
      )}
    </div>
  )
}
