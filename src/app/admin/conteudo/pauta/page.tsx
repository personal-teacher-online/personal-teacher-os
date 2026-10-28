// PAUTA — os criadores de referência (frente de conteúdo · M4).
//
// Rota IRMÃ do Estúdio, não aba dele (mesma decisão de `/admin/alunos/convites`
// e `/admin/alunos/contratos`): o Estúdio é a fila de posts, esta tela é o
// cadastro de quem a pesquisa acompanha. O trilho continua acendendo "Estúdio" —
// as duas são a mesma seção.
//
// Zero query nesta página: quem lê é `src/data/admin/pauta.ts`, e é lá que a
// data é formatada (nenhum componente cliente formata data nesta casa).
//
// O DESFECHO NÃO VEM DA URL (padrão do A8, não a ponte legada `?msg=`): a action
// grava a frase num cookie de vida curta com DESTINO nesta tela, e o
// `AvisoLegado` a entrega — toast com JavaScript, faixa `<noscript>` sem ele. A
// URL desta tela carrega só a geometria: `?painel=` e `?alvo=`.
//
// ENDEREÇO QUE SÓ PODE FALHAR NÃO VIRA FORMULÁRIO: `?painel=editar` com alvo
// inexistente (link velho, id digitado à mão) devolve para a lista em vez de
// desenhar um formulário condenado.

import { redirect } from 'next/navigation'
import Link from 'next/link'

import { AvisoLegado } from '@/components/kit/aviso-legado'
import { EmptyState, toolbarLink } from '@/components/ui'
import { ListaDaPauta } from '@/components/admin/pauta/lista'
import { PaineisDaPauta } from '@/components/admin/pauta/paineis'
import { getCriadorDaPauta, getPautaDeCriadores } from '@/data/admin/pauta'
import {
  CASA_DA_PAUTA,
  chaveDoCriador,
  ehPainelDaPauta,
  enderecoDoPainel,
} from '@/data/admin/pauta-gramatica'
import { lerRascunho } from '@/lib/admin/rascunho-do-formulario'
import { lerRecado } from '@/lib/kit/recado'

export const metadata = { title: 'Pauta — Admin' }

type ValorDaQuery = string | string[] | undefined
function primeiro(v: ValorDaQuery): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function PautaPage({
  searchParams,
}: {
  searchParams: Promise<{ painel?: ValorDaQuery; alvo?: ValorDaQuery }>
}) {
  const sp = await searchParams
  const painelCru = primeiro(sp.painel)
  const painel = ehPainelDaPauta(painelCru) ? painelCru : null
  const alvo = (primeiro(sp.alvo) ?? '').trim()

  const [recado, pauta] = await Promise.all([
    lerRecado('conteudo', CASA_DA_PAUTA),
    getPautaDeCriadores(),
  ])

  const criador = painel === 'editar' ? await getCriadorDaPauta(alvo) : null
  if (painel === 'editar' && !criador) redirect(CASA_DA_PAUTA)

  const rascunho = painel
    ? await lerRascunho(chaveDoCriador(painel === 'editar' ? alvo : 'novo'))
    : {}

  return (
    <main className="flex flex-col gap-4">
      {recado && <AvisoLegado mensagem={recado.mensagem} chave={recado.id} />}

      <header>
        <h2 className="font-display text-2xl font-bold text-ink-900">
          Pauta{' '}
          <span className="font-sans text-base font-normal text-ink-400">
            criadores de referência
          </span>
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          De quem a pesquisa aprende. O robô só olha para quem está aqui e ativo — e é ele quem
          preenche os números; aqui ninguém digita audiência.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={enderecoDoPainel('novo')} className={toolbarLink}>
          ＋ Novo criador
        </Link>
        <Link href="/admin/conteudo" className={toolbarLink}>
          ← Estúdio
        </Link>
      </div>

      {pauta.total === 0 ? (
        <EmptyState
          title="Nenhum criador na pauta ainda."
          hint="Cadastre os aprovados da lista de candidatos: a pesquisa só acompanha quem estiver aqui e ativo."
          cta="Adicionar o primeiro"
          href={enderecoDoPainel('novo')}
        />
      ) : (
        <ListaDaPauta grupos={pauta.grupos} />
      )}

      {painel && (
        <PaineisDaPauta painel={painel} criador={criador ?? undefined} rascunho={rascunho} />
      )}
    </main>
  )
}
