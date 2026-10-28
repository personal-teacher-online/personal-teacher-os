// ABA CONTRATOS (Onda 1 · M4-1) — o ÍNDICE dos contratos particulares, terceira
// aba do hub de Alunos.
//
// ANATOMIA (clonagem TutorBird, igual às abas irmãs):
//
//   card-contêiner  ← abas Alunos | Convites | Contratos
//     filtros       ← Todos · Ativos · Pausados, com a contagem viva de cada um
//     toolbar       ← [+ Novo contrato] à esquerda · ver por + busca à direita
//     contagem      ← muda ao vivo com a busca
//     conteúdo      ← a tabela do kit, ou os CARTÕES DE ACESSO quando o "ver
//                     por" não é "Lista"
//   card-contêiner  ← Mentoria: os contratos do outro produto, com a porta para
//                     a tela que os gere
//
// "VER POR" = CARTÕES (portão visual do dono, 27/07/2026, ordem direta olhando
// a bancada — desvio consciente da spec do M4-1, que pedia uma pilha de seções
// com uma tabela cada). São os MESMOS cartões da aba Alunos (`CartaoDeAcesso`),
// com a identidade do eixo (bolinha da professora, pílula do nível, pílula da
// situação, nome do plano), a contagem grande e a pendência do grupo. O clique
// abre o N2 — `/admin/alunos/contratos/grupo/[eixo]/[valor]` —, que é a mesma
// tabela filtrada naquele recorte. A busca do N1 segue viva: com texto escrito,
// os cartões somem e volta a tabela dos resultados (precedente do hub).
//
// POR QUE É UMA ROTA e não um `?aba=` do hub: o mesmo precedente da aba Convites
// (`convites/page.tsx`) — cada aba com endereço curto e um estado só, sem a
// busca de uma vazar na outra. O TÍTULO da barra do shell continua sendo
// "Alunos", derivado do trilho: tudo sob `/admin/alunos` pertence à seção.
//
// A TELA VELHA (`/admin/contratos`) MORREU no M4-4: aquele endereço é hoje um
// 308 para cá (mapa em `data/admin/contratos-legado.ts`). O detalhe é o M4-2
// (`/admin/contratos/[id]`) e CRIAR é o wizard do M4-3
// (`/admin/contratos/novo`), para onde o botão primário aponta.
//
// FEEDBACK DA CONVIVÊNCIA: as ações do detalhe ainda terminam em
// `?msg=…&n=…` (elas nasceram servindo a lista velha). Quando ninguém manda
// `back`, o recado desemboca AQUI pelo redirect — e o `AvisoLegado` o
// transforma em toast do kit, em vez de a frase sumir. Esta tela não PRODUZ
// `?msg=` nenhum (ADR-025); ela só não engole o de quem ainda usa.
//
// Zero query nesta página: quem lê é `src/data/admin/contratos.ts`.

import Link from 'next/link'
import { FilePlus2 } from 'lucide-react'

import { AvisoLegado } from '@/components/kit/aviso-legado'
import { CartaoDeContratos } from '@/components/admin/alunos/CartaoDeGrupo'
import { ListaDeContratos } from '@/components/admin/alunos/ListaDeContratos'
import { CardPanel, CardPanelHeader, CardPanelTabs } from '@/components/kit/card-panel'
import { EmptyState } from '@/components/kit/empty-state'
import { getContractsIndex } from '@/data/admin/contratos'
import { enderecoDoNovoContrato } from '@/data/admin/contrato-novo'
import {
  FILTROS_DE_CONTRATO,
  FILTRO_ROTULO,
  VISOES_DE_CONTRATO,
  VISAO_ROTULO,
  agruparContratos,
  ehFiltroDeContrato,
  ehVisaoDeContratos,
  type EixoDeContratos,
  type FiltroDeContrato,
  type VisaoDeContratos,
} from '@/data/admin/contratos-gramatica'
import { cn } from '@/lib/cn'

export const metadata = { title: 'Contratos — Admin' }

/**
 * O wizard (M4-3): a ÚNICA porta de criar contrato.
 *
 * Até o M4-2 esta constante apontava para a tela velha (`?novo=individual`), que
 * abria um formulário por tipo e escrevia solto — o grupo em três `insert` sem
 * transação. Agora o endereço é o do wizard, e o `?tipo=` continua sendo o
 * atalho de quem já sabe o que quer. O endereço sai da gramática — ele não é
 * literal em duas telas.
 */
const NOVO_CONTRATO = enderecoDoNovoContrato()

/** Estado vazio de cada recorte — vazio nunca é a mesma frase para todos. */
const VAZIO: Record<FiltroDeContrato, { titulo: string; frase: string }> = {
  todos: {
    titulo: 'Nenhum contrato vivo.',
    frase:
      'O contrato liga aluno, professora e plano, e é ele que define as regras de remarcação. Contrato encerrado não aparece aqui: ele fica no histórico da ficha do aluno.',
  },
  active: {
    titulo: 'Nenhum contrato ativo.',
    frase: 'Todo contrato vivo está pausado no momento. Confira o recorte “Pausados”.',
  },
  paused: {
    titulo: 'Nenhum contrato pausado.',
    frase: 'Ninguém está com as aulas suspensas — que é como a lista deve ficar.',
  },
}

/** Endereço deste índice preservando o que o outro controle já tinha escolhido
 *  (e a busca, para o link salvo não perder o termo). */
function endereco(params: { st?: FiltroDeContrato; ver?: VisaoDeContratos; q?: string }): string {
  const p = new URLSearchParams()
  if (params.st && params.st !== 'todos') p.set('st', params.st)
  if (params.ver && params.ver !== 'lista') p.set('ver', params.ver)
  if (params.q) p.set('q', params.q)
  const s = p.toString()
  return s ? `/admin/alunos/contratos?${s}` : '/admin/alunos/contratos'
}

export default async function ContratosDoHub({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; st?: string; ver?: string; msg?: string; n?: string }>
}) {
  const sp = await searchParams
  const recorte: FiltroDeContrato = ehFiltroDeContrato(sp.st) ? sp.st : 'todos'
  const visao: VisaoDeContratos = ehVisaoDeContratos(sp.ver) ? sp.ver : 'lista'
  const q = sp.q ?? ''

  const indice = await getContractsIndex(recorte)

  // O eixo do "ver por" (null = "Lista", a tabela inteira). Os grupos saem do
  // RECORTE em vigor, não do universo: quem está em "Pausados" e agrupa por
  // professora quer ver os pausados de cada uma.
  const eixo: EixoDeContratos | null = visao === 'lista' ? null : visao
  const grupos = eixo ? agruparContratos(indice.contratos, eixo) : []

  const abas = [
    { label: 'Alunos', href: '/admin/alunos' },
    { label: 'Convites', href: '/admin/alunos/convites' },
    {
      label: 'Contratos',
      href: '/admin/alunos/contratos',
      active: true,
      // A conta da aba é a dos contratos VIVOS — não muda com o recorte, senão
      // a aba mentiria sobre o tamanho da seção.
      count: indice.vivos,
    },
  ]

  const filtros = (
    <nav
      aria-label="Filtrar por situação do contrato"
      className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"
    >
      {FILTROS_DE_CONTRATO.map((f) => {
        const ativo = f === recorte
        return (
          <Link
            key={f}
            href={endereco({ st: f, ver: visao, q })}
            aria-current={ativo ? 'page' : undefined}
            className={ativo ? 'btn-ac' : 'btn-ac-soft'}
          >
            {FILTRO_ROTULO[f]}
            {/* A contagem é DADO: tabular e na mesma cor do rótulo. */}
            <span className="font-normal tabular-nums">{indice.contagens[f]}</span>
          </Link>
        )
      })}
    </nav>
  )

  const verPor = (
    <nav aria-label="Ver contratos por" className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-sm text-ink-600">Ver por</span>
      {VISOES_DE_CONTRATO.map((v) => (
        <Link
          key={v}
          href={endereco({ st: recorte, ver: v, q })}
          aria-current={v === visao ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-9 items-center rounded-input px-3 text-sm transition-colors duration-(--duration-hover) ease-(--ease-in-out)',
            v === visao
              ? 'bg-ac-wash font-semibold text-ac-deep'
              : 'font-medium text-ink-600 hover:bg-paper-100 hover:text-ink-900',
          )}
        >
          {VISAO_ROTULO[v]}
        </Link>
      ))}
    </nav>
  )

  return (
    <main className="view-enter flex flex-col gap-6">
      <AvisoLegado mensagem={sp.msg ?? ''} chave={sp.n} />
      <CardPanel>
        <CardPanelTabs tabs={abas} />
        {filtros}
        <ListaDeContratos
          contratos={indice.contratos}
          buscaInicial={q}
          legenda={recorte === 'todos' ? 'Contratos da escola' : `Contratos — ${FILTRO_ROTULO[recorte]}`}
          acoes={
            <Link href={NOVO_CONTRATO} className="btn-ac">
              <FilePlus2 className="h-4 w-4" />
              Novo contrato
            </Link>
          }
          controles={verPor}
          vazio={
            <EmptyState
              illustration={recorte === 'todos' ? '/illustrations/aula-online.svg' : '/illustrations/agenda-vazia.svg'}
              title={VAZIO[recorte].titulo}
              hint={VAZIO[recorte].frase}
              cta={recorte === 'todos' ? 'Criar o primeiro contrato' : 'Ver todos'}
              href={recorte === 'todos' ? NOVO_CONTRATO : '/admin/alunos/contratos'}
            />
          }
        >
          {/* Sem grupo nenhum (o recorte está vazio) a lista devolve o estado
              vazio dela, que fala do RECORTE — uma grade de zero cartões seria
              um branco sem explicação. */}
          {eixo && grupos.length > 0 ? (
            // `pb-6` como no hub de Alunos: os cartões têm sombra e o
            // `CardPanel` é `overflow-hidden` — com 16px embaixo, a sombra da
            // última fileira sairia cortada rente à borda.
            <div className="grid grid-cols-1 gap-4 p-4 pb-6 sm:grid-cols-2 xl:grid-cols-3">
              {grupos.map((g) => (
                <CartaoDeContratos key={g.chave} eixo={eixo} secao={g} />
              ))}
            </div>
          ) : undefined}
        </ListaDeContratos>
      </CardPanel>

      {/* MENTORIA — o outro produto da escola. Ele não entra na tabela de cima
          porque não responde às mesmas perguntas (não tem horário fixo, valor
          por hora nem crédito de reposição: tem janela, progresso e sessão em
          grupo). Aqui ele existe como LISTA CURTA, para o índice não afirmar
          por omissão que a escola só tem particulares — e a porta de gestão
          continua sendo a tela de Mentoria. */}
      <CardPanel>
        <CardPanelHeader
          title="Mentoria"
          meta={`${indice.mentoria.length} ${indice.mentoria.length === 1 ? 'contrato' : 'contratos'} do Personal Travel`}
          actions={
            <Link href="/admin/mentoria" className="btn-ac-soft">
              Abrir Mentoria
            </Link>
          }
        />
        {indice.mentoria.length === 0 ? (
          <EmptyState
            illustration="/illustrations/agenda-vazia.svg"
            title="Nenhum contrato de mentoria."
            hint="O Personal Travel tem contrato próprio, com janelas de crédito e progresso do curso. Ele nasce e se gere na tela de Mentoria."
            cta="Abrir Mentoria"
            href="/admin/mentoria"
          />
        ) : (
          <ul>
            {indice.mentoria.map((m) => (
              <li key={m.id} className="border-b border-line-soft last:border-b-0">
                {/* A linha inteira é o alvo (mesmo gesto da linha da tabela):
                    âncora de verdade, com hover e foco visíveis — nada de texto
                    clicável solto. */}
                <Link
                  href="/admin/mentoria"
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-paper-100/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ac-vivid"
                >
                  <span className="text-sm font-semibold text-ink-900">{m.aluno}</span>
                  <span className="text-sm text-ink-900">
                    {m.inicioDoCurso ? `curso começou em ${m.inicioDoCurso}` : 'início do curso não lançado'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardPanel>
    </main>
  )
}
