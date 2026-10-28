// HUB DE ALUNOS — N1 (Onda 1 · M3). A lista velha (chips de estado, tabela +
// cartões duplicados, painéis por `<details>`) morre aqui.
//
// ANATOMIA (clonagem TutorBird, `mapeamento-tutorbird-2.md`):
//
//   card-contêiner  ← abas Alunos | Contratos
//     toolbar       ← [+ Novo aluno ▾] à esquerda · ver por + busca à direita
//     contagem      ← muda ao vivo com a busca (item 7 das fundações)
//     conteúdo      ← cartões de grupo (ver por professora/produto/nível)
//                     OU a tabela do kit (ver por "Todos", e sempre que houver
//                     busca escrita)
//
// O TÍTULO da página não mora aqui: vive na barra branca do shell, que o
// deriva do trilho (clonagem — título persistente em toda seção).
//
// ABAS: três. "Convites" nasceu no M3-3 (a visão de ACESSO, N4) e é uma ROTA
// irmã — `/admin/alunos/convites` —, não um `?aba=` desta página: o hub já
// carrega estado na URL (`?ver=`, `?q=`, `?novo=1`) e misturar os dois faria a
// busca de uma aba vazar na outra. "Contratos" (M4-1) é a terceira, também rota
// irmã — `/admin/alunos/contratos`; a tela velha que ela apontava até o M4-1
// morreu no M4-4 e o endereço dela virou 308 para a aba.
//
// Zero query nesta página: quem lê é `src/data/admin/alunos.ts`.
//
// O PAINEL QUE ESTA PÁGINA HOSPEDA: `?novo=1` → wizard de admissão
// (`AdmissionWizard`), que navega entre as etapas voltando para este endereço —
// por isso ele continua sendo hospedado aqui, e não virou página.
// `/admin/alunos/novo` redireciona para cá desde a Leva 7 e segue intocado.
//
// O `?convidar=1` do M3-1 MORREU no M3-3: aquele painel era uma lista de quem
// convidar dentro de um Sheet, e virou a aba Convites — que mostra a MESMA
// gente com e-mail, situação de acesso e a ação na linha. Duas telas para a
// mesma pergunta é a duplicação que a onda está tirando do caminho; o endereço
// velho continua chegando, por redirect.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { UserPlus } from 'lucide-react'

import { AvisoLegado } from '@/components/kit/aviso-legado'
import { CartaoDeGrupo } from '@/components/admin/alunos/CartaoDeGrupo'
import { FiltroDeSituacao } from '@/components/admin/alunos/FiltroDeSituacao'
import { FormularioDeLead } from '@/components/admin/alunos/FormularioDeLead'
import { ListaDeAlunos } from '@/components/admin/alunos/ListaDeAlunos'
import { PainelDeUrl } from '@/components/kit/painel-de-url'
import { CardPanel, CardPanelTabs } from '@/components/kit/card-panel'
import { EmptyState } from '@/components/kit/empty-state'
import { SplitButton } from '@/components/kit/split-button'
import { getStudentsHub } from '@/data/admin/alunos'
import {
  EIXOS,
  EIXO_ROTULO,
  SITUACAO_FILTRO,
  ehAcesso,
  ehEixo,
  ehSituacao,
  type Eixo,
  type Situacao,
} from '@/data/admin/alunos-grupos'
import { cn } from '@/lib/cn'
import { AdmissionWizard } from './novo/AdmissionWizard'

export const metadata = { title: 'Alunos — Admin' }

/** Eixo de abertura: a escola pensa "quem estuda com quem" antes de qualquer
 *  outra coisa (a bolinha da professora é o primeiro eixo do M3). */
const EIXO_PADRAO: Eixo = 'professora'

function enderecoDoEixo(eixo: Eixo): string {
  return eixo === EIXO_PADRAO ? '/admin/alunos' : `/admin/alunos?ver=${eixo}`
}

/** Estado vazio de cada recorte do funil — vazio nunca é a mesma frase para
 *  todos (mesma régua da aba Convites). */
const VAZIO_DA_SITUACAO: Record<Situacao, { titulo: string; frase: string }> = {
  lead: {
    titulo: 'Nenhum lead na fila.',
    frase:
      'Lead é quem conversou com a escola e ainda não fechou. Cadastre um pelo “+ Novo aluno ▾ → Novo lead”: só o nome já basta.',
  },
  experimental: {
    titulo: 'Nenhuma aula experimental marcada.',
    frase:
      'Assim que uma experimental entrar na agenda, a pessoa aparece aqui — e sai deste recorte no dia em que o contrato de verdade nascer.',
  },
  ativo: {
    titulo: 'Nenhum aluno ativo.',
    frase: 'Ativo é quem tem contrato vivo e sem pausa. Confira os recortes “Pausado” e “Sem contrato”.',
  },
  pausado: {
    titulo: 'Nenhum contrato pausado.',
    frase: 'A pausa é lançada em Contratos; enquanto ela dura, o aluno aparece aqui.',
  },
  sem_contrato: {
    titulo: 'Ninguém sem contrato.',
    frase: 'Todo aluno cadastrado tem contrato vivo — que é como a lista deve ficar.',
  },
  arquivado: {
    titulo: 'Ninguém arquivado.',
    frase: 'Aqui ficam quem saiu da escola e os leads dados como perdidos.',
  },
}

export default async function AlunosHub({
  searchParams,
}: {
  searchParams: Promise<{
    ver?: string
    q?: string
    novo?: string
    lead?: string
    convidar?: string
    s?: string
    aluno?: string
    /** c12 · nº 12: o rascunho da etapa 2, quando ela volta de uma criação que falhou */
    rasc?: string
    /** recorte do CICLO DE VIDA (P10 da revisão nº 8: o funil tem chave própria) */
    situacao?: string
    // recados e recortes da tela VELHA (T3): ninguém perde um link salvo
    msg?: string
    n?: string
    p?: string
    f?: string
  }>
}) {
  const sp = await searchParams

  // T3 — DEEP LINKS DA LISTA VELHA.
  // Os chips de produto viraram grupos de verdade: `?p=…` leva ao grupo
  // equivalente, com REDIRECT (o endereço velho não sobrevive na barra, mas o
  // link salvo continua chegando onde prometia).
  if (sp.p === 'particular') redirect('/admin/alunos/grupo/produto/particular')
  if (sp.p === 'mentoria') redirect('/admin/alunos/grupo/produto/travel')
  // DUAS CHAVES, DOIS VOCABULÁRIOS (P10 da revisão nº 8).
  //
  // A fase 1 do ciclo de vida tinha posto o funil em `?f=`, a MESMA chave que o
  // vocabulário de ACESSO usa desde o M3-3 — e as duas listas têm a palavra
  // `ativo`. O sentido de um link salvo passava a depender de qual rota o
  // recebia: `/admin/alunos?f=ativo` significava "acesso ativo" na segunda-feira
  // e "aluno ativo" na terça. Chave que muda de sentido é ambiguidade, não
  // compatibilidade.
  //
  // Agora: `?f=` é ACESSO (fica como está, e é o que os links antigos falam) e
  // o ciclo de vida ganhou `?situacao=`. Os dois `?f=` que chegarem aqui são
  // encaminhados — o de acesso para a aba Convites, que é a tela dele; o de
  // situação (só existiu no lote anterior) para a chave nova, sem perder o link.
  if (ehAcesso(sp.f)) redirect(`/admin/alunos/convites?f=${sp.f}`)
  if (ehSituacao(sp.f)) redirect(`/admin/alunos?situacao=${sp.f}`)
  // `?convidar=1` (o Sheet do M3-1) virou a aba Convites.
  if (sp.convidar) redirect('/admin/alunos/convites')

  const eixo: Eixo = ehEixo(sp.ver) ? sp.ver : EIXO_PADRAO
  const recorte: Situacao | null = ehSituacao(sp.situacao) ? sp.situacao : null
  const hub = await getStudentsHub(recorte)

  const abas = [
    { label: 'Alunos', href: '/admin/alunos', active: true, count: hub.total },
    // A contagem da aba Convites é a PENDÊNCIA (quem ainda não entra no
    // portal), não o total de gente: é o número que faz alguém clicar.
    { label: 'Convites', href: '/admin/alunos/convites', count: hub.semAcesso },
    // M4-1: a aba passou a apontar para a rota IRMÃ (`/admin/alunos/contratos`),
    // que é o índice novo. A tela velha continua viva por URL direta até o M4-4.
    { label: 'Contratos', href: '/admin/alunos/contratos' },
  ]

  const verPor = (
    <nav aria-label="Ver alunos por" className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-sm text-ink-600">Ver por</span>
      {EIXOS.map((e) => (
        <Link
          key={e}
          href={enderecoDoEixo(e)}
          aria-current={e === eixo ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-9 items-center rounded-input px-3 text-sm transition-colors duration-(--duration-hover) ease-(--ease-in-out)',
            e === eixo
              ? 'bg-ac-wash font-semibold text-ac-deep'
              : 'font-medium text-ink-600 hover:bg-paper-100 hover:text-ink-900',
          )}
        >
          {EIXO_ROTULO[e]}
        </Link>
      ))}
    </nav>
  )

  // Com recorte de situação, o conteúdo é sempre a TABELA: quem clicou em
  // "Lead" quer ver PESSOAS, e devolver cartões de grupo aí responderia outra
  // pergunta (é a mesma decisão que a busca escrita já tomava).
  const grupos = eixo === 'todos' || recorte ? [] : hub.grupos[eixo]

  return (
    <main className="view-enter flex flex-col gap-6">
      <AvisoLegado mensagem={sp.msg ?? ''} chave={sp.n} />

      <CardPanel>
        <CardPanelTabs tabs={abas} />
        {/* CICLO DE VIDA (fase 1): o funil inteiro em badges clicáveis, acima
            da tabela. Elas moram entre as abas e a toolbar porque são a mesma
            família de gesto das abas — recortar o que a tabela mostra. */}
        <FiltroDeSituacao contagens={hub.contagens} recorte={recorte} total={hub.total} />
        <ListaDeAlunos
          alunos={hub.alunos}
          buscaveis={hub.buscaveis}
          buscaInicial={sp.q ?? ''}
          legenda={recorte ? `Alunos — ${SITUACAO_FILTRO[recorte]}` : 'Alunos da escola'}
          acoes={
            <SplitButton
              label="Novo aluno"
              href="/admin/alunos/novo"
              icon={<UserPlus className="h-4 w-4" />}
              options={[
                {
                  label: 'Cadastrar aluno',
                  href: '/admin/alunos/novo',
                  hint: 'dados, contrato e horários em três etapas',
                },
                {
                  // Fase 1 do ciclo de vida: a porta da PROSPECÇÃO. Fica na
                  // seta, não no corpo do botão, porque a ação padrão da escola
                  // continua sendo matricular.
                  label: 'Novo lead',
                  href: '/admin/alunos?lead=1',
                  hint: 'só o nome — sem contrato e sem convite',
                },
                {
                  label: 'Convidar para o portal',
                  href: '/admin/alunos/convites?f=sem_convite',
                  hint: 'para quem já está cadastrado e ainda não tem acesso',
                },
              ]}
            />
          }
          controles={verPor}
          vazio={
            recorte ? (
              <EmptyState
                illustration="/illustrations/agenda-vazia.svg"
                title={VAZIO_DA_SITUACAO[recorte].titulo}
                hint={VAZIO_DA_SITUACAO[recorte].frase}
                cta="Ver todos"
                href="/admin/alunos"
              />
            ) : (
              <EmptyState
                illustration="/illustrations/aula-online.svg"
                title="Nenhum aluno cadastrado ainda."
                hint="O cadastro leva três passos: dados do aluno, contrato com os horários fixos e o convite para o portal."
                cta="Cadastrar o primeiro aluno"
                href="/admin/alunos/novo"
              />
            )
          }
        >
          {eixo === 'todos' || recorte ? undefined : grupos.length === 0 ? (
            <EmptyState
              illustration="/illustrations/aula-online.svg"
              title="Nada para agrupar ainda."
              hint="Assim que houver alunos cadastrados, eles aparecem aqui separados por professora, produto e nível."
              cta="Cadastrar aluno"
              href="/admin/alunos/novo"
            />
          ) : (
            // `pb-6`, e não `p-4` nos quatro lados: os cartões passaram a ter
            // sombra (M3-c3 · A3) e o `CardPanel` que hospeda esta grade é
            // `overflow-hidden` — com 16px embaixo, a sombra da última fileira
            // seria cortada rente à borda do contêiner.
            <div className="grid grid-cols-1 gap-4 p-4 pb-6 sm:grid-cols-2 xl:grid-cols-3">
              {grupos.map((g) => (
                <CartaoDeGrupo key={g.valor} grupo={g} />
              ))}
            </div>
          )}
        </ListaDeAlunos>
      </CardPanel>

      {sp.novo && (
        // `bruto`: o wizard monta o próprio corpo e o RODAPÉ FIXO (o rodapé só
        // é fixo estando fora da área que rola, e o `<form>` precisa envolver
        // os dois para o submit levar os campos).
        <PainelDeUrl
          titulo="Novo aluno"
          descricao="Três etapas — dados, contrato com os horários fixos e o convite. As duas últimas são puláveis."
          voltarPara="/admin/alunos"
          bruto
        >
          <AdmissionWizard s={sp.s} aluno={sp.aluno} rascunho={sp.rasc} />
        </PainelDeUrl>
      )}

      {/* CICLO DE VIDA (fase 1) — `?lead=1`: o cadastro mínimo de quem ainda não
          é aluno. Painel próprio, e não uma quarta etapa do wizard, porque a
          pergunta é outra (prospecção, não admissão) e o wizard pede contrato. */}
      {sp.lead && (
        <PainelDeUrl
          titulo="Novo lead"
          descricao="Quem conversou com a escola e ainda não fechou. Só o nome é obrigatório — sem contrato e sem convite."
          // Fechar sem criar volta para a lista de trabalho (é de onde se veio);
          // quem CRIA é levado para `?situacao=lead`, pela action — lá o que
          // acabou de nascer aparece.
          voltarPara="/admin/alunos"
          bruto
        >
          <FormularioDeLead />
        </PainelDeUrl>
      )}
    </main>
  )
}
