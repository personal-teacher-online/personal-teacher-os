// N4 — ABA CONVITES (Onda 1 · M3-3). A visão de ACESSO: quem entra no portal,
// quem foi convidado e ainda não entrou, e quem nunca recebeu convite.
//
// ANATOMIA (clonagem TutorBird):
//
//   card-contêiner  ← abas Alunos | Convites | Contratos
//     contadores    ← "1 Active" deles, em três recortes clicáveis
//     tabela K1     ← Aluno · E-mail · Situação de acesso · Ação
//
// POR QUE É UMA ROTA e não um `?aba=` do hub: o hub já guarda estado na URL
// (`?ver=`, `?q=`, `?novo=1&s=…`), e empilhar mais uma dimensão faria a busca
// de uma aba vazar na outra e o link salvo virar loteria. Como rota, cada aba
// tem endereço curto, título próprio na barra do shell (que deriva do trilho —
// tudo sob `/admin/alunos` continua sendo "Alunos") e um estado só.
//
// O QUE MORREU AQUI: o painel `?convidar=1` do M3-1 — um Sheet que listava
// nomes para escolher quem convidar. Ele respondia à mesma pergunta desta aba
// com menos informação (sem e-mail, sem situação, sem reenvio) e sem endereço
// próprio. O endereço velho redireciona para cá.
//
// Zero query nesta página: quem lê é `src/data/admin/alunos.ts`. As MUTAÇÕES
// são as de sempre (`resendInviteAction` e o painel `?painel=convidar` da
// ficha) — nada de convite foi reescrito.

import Link from 'next/link'

import { AvisoLegado } from '@/components/kit/aviso-legado'
import { ListaDeConvites } from '@/components/admin/alunos/ListaDeConvites'
import { CardPanel, CardPanelTabs } from '@/components/kit/card-panel'
import { EmptyState } from '@/components/kit/empty-state'
import { getInvitesOverview } from '@/data/admin/alunos'
import { ACESSOS, ehAcesso, type Acesso } from '@/data/admin/alunos-grupos'
import { cn } from '@/lib/cn'
import { resendInviteAction } from '../actions'

export const metadata = { title: 'Convites — Admin' }

/** O rótulo de cada recorte na barra de contadores (a voz da tela, não a da
 *  pílula: aqui o texto nomeia um GRUPO de gente). */
const RECORTE_ROTULO: Record<Acesso, string> = {
  ativo: 'Com acesso',
  pendente: 'Convite pendente',
  sem_convite: 'Sem convite',
}

/** Estado vazio de cada recorte — vazio nunca é a mesma frase para todos. */
const VAZIO: Record<Acesso, { titulo: string; frase: string }> = {
  ativo: {
    titulo: 'Ninguém entrou no portal ainda.',
    frase:
      'Assim que um aluno criar a senha pelo link do convite, ele aparece aqui. Enquanto isso, ele fica em “convite pendente”.',
  },
  pendente: {
    titulo: 'Nenhum convite esperando.',
    frase: 'Todo convite enviado já virou acesso — ninguém ficou com o e-mail parado na caixa.',
  },
  sem_convite: {
    titulo: 'Todo mundo já foi convidado.',
    frase: 'Nenhum aluno da lista está sem convite. Cadastrou alguém novo? Ele aparece aqui.',
  },
}

function enderecoDoRecorte(recorte: Acesso | null): string {
  return recorte ? `/admin/alunos/convites?f=${recorte}` : '/admin/alunos/convites'
}

export default async function ConvitesPage({
  searchParams,
}: {
  searchParams: Promise<{
    f?: string
    // recado das actions velhas (convivência do M3-1): vira toast
    msg?: string
    n?: string
  }>
}) {
  const sp = await searchParams
  const recorte: Acesso | null = ehAcesso(sp.f) ? sp.f : null
  const visao = await getInvitesOverview(recorte)

  const abas = [
    { label: 'Alunos', href: '/admin/alunos', count: visao.total },
    {
      label: 'Convites',
      href: '/admin/alunos/convites',
      active: true,
      // A MESMA conta da aba no hub: a pendência, não o total de gente.
      count: visao.contagens.pendente + visao.contagens.sem_convite,
    },
    // M4-1: a aba passou a apontar para a rota IRMÃ (`/admin/alunos/contratos`).
    { label: 'Contratos', href: '/admin/alunos/contratos' },
  ]

  const recortes: { valor: Acesso | null; rotulo: string; total: number }[] = [
    { valor: null, rotulo: 'Todos', total: visao.total },
    ...ACESSOS.map((a) => ({ valor: a, rotulo: RECORTE_ROTULO[a], total: visao.contagens[a] })),
  ]

  return (
    <main className="view-enter flex flex-col gap-6">
      <AvisoLegado mensagem={sp.msg ?? ''} chave={sp.n} />

      <CardPanel>
        <CardPanelTabs tabs={abas} />

        {/* CONTADORES: são o "1 Active" deles — e recortam a lista, que é o
            gesto que a dona faz em seguida ("quem falta convidar?"). O número
            é DADO, e aqui ele é o dado PRINCIPAL da caixa: vem primeiro e
            grande, com o rótulo embaixo.

            M3-c3 · A3 — eram quatro links de texto encostados numa fileira; o
            dono pediu a ELEVAÇÃO do TutorBird nos cartões de conteúdo, e estes
            quatro são exatamente isso: caixas de coisa, clicáveis, dentro do
            card-contêiner. Vestem a receita da casa (`.card-kpi` +
            `.card-kpi-interactive`), a mesma dos KPIs do Início.

            O ATIVO se anuncia por ANEL DE ACENTO e tinta de acento, não por
            fundo: `.card-kpi` é unlayered e fixa `background: var(--paper-0)`,
            então um `bg-ac-wash` de utility seria decoração morta (é a mesma
            armadilha anotada no `.card-ac` do globals). O anel é `outline`, que
            nenhuma das duas regras disputa. */}
        <nav
          aria-label="Recortar por situação de acesso"
          className="grid grid-cols-2 gap-3 border-b border-line p-4 lg:grid-cols-4"
        >
          {recortes.map((r) => {
            const ativo = r.valor === recorte
            return (
              <Link
                key={r.rotulo}
                href={enderecoDoRecorte(r.valor)}
                aria-current={ativo ? 'page' : undefined}
                className={cn(
                  'card-kpi card-kpi-interactive flex flex-col gap-0.5 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ac-vivid',
                  ativo && 'outline-2 -outline-offset-2 outline-ac-deep',
                )}
              >
                <span
                  className={cn(
                    'text-3xl font-semibold tabular-nums',
                    ativo ? 'text-ac-deep' : 'text-ink-900',
                  )}
                >
                  {r.total}
                </span>
                <span className={cn('text-sm', ativo ? 'font-semibold text-ac-deep' : 'text-ink-600')}>
                  {r.rotulo}
                </span>
              </Link>
            )
          })}
        </nav>

        <ListaDeConvites
          alunos={visao.alunos}
          voltarPara={enderecoDoRecorte(recorte)}
          reenviarConvite={resendInviteAction}
          vazio={
            visao.total === 0 ? (
              <EmptyState
                illustration="/illustrations/aula-online.svg"
                title="Nenhum aluno cadastrado ainda."
                hint="O convite é o último passo do cadastro: primeiro existe o aluno, depois o acesso dele ao portal."
                cta="Cadastrar o primeiro aluno"
                href="/admin/alunos?novo=1"
              />
            ) : (
              <EmptyState
                illustration="/illustrations/agenda-vazia.svg"
                title={recorte ? VAZIO[recorte].titulo : 'Ninguém nesta lista.'}
                hint={
                  recorte
                    ? VAZIO[recorte].frase
                    : 'A lista de acesso está vazia, o que não deveria acontecer com alunos cadastrados — recarregue a página.'
                }
                cta="Ver todos"
                href="/admin/alunos/convites"
              />
            )
          }
        />
      </CardPanel>
    </main>
  )
}
