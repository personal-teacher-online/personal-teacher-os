// RADAR DE TRENDS (Estúdio v2 · Leva 3) — a triagem um-a-um do que a captura
// semanal trouxe: a Teacher Vicky navega cartão a cartão e decide; escolher É a
// aprovação (o Portão 1 morre no cutover, Leva 5).
//
// Rota IRMÃ do Estúdio (mesma decisão da Pauta): o Estúdio segue sendo a fila
// de posts e a página principal até o cutover; o trilho acende "Estúdio" para
// as duas. O NOME desta página é provisório — o batismo é da Leva 7, com a
// Teacher Vicky.
//
// Zero query nesta página: quem lê é `src/data/admin/radar.ts`. Duas leituras
// de propósito — o deck (leve) para contador/navegação, o cartão corrente
// (pesado) com a dissecação.
//
// O DESFECHO NÃO VEM DA URL (padrão do A8): a action grava a frase num cookie
// com DESTINO nesta tela e o `AvisoLegado` a entrega. A URL carrega só
// geometria: `?alvo=` e `?painel=`.
//
// ENDEREÇO QUE SÓ PODE FALHAR NÃO VIRA FORMULÁRIO: `?alvo=` inexistente ou já
// decidido (link velho, corrida com outra aba) devolve para a casa — e a casa
// abre no primeiro cartão do deck.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'

import { AvisoLegado } from '@/components/kit/aviso-legado'
import { EmptyState, chipOff, chipOn, toolbarLink } from '@/components/ui'
import { CartaoDeTriagem } from '@/components/admin/radar/cartao'
import { PainelDescartar, PainelNota } from '@/components/admin/radar/paineis'
import { VistaTodosDoRadar } from '@/components/admin/radar/todos'
import { getCartaoDoRadar, getDeckDoRadar, getFolgaDoTeto, getVistaTodos } from '@/data/admin/radar'
import {
  CASA_DO_RADAR,
  CASA_DOS_POSTS,
  LIMIAR_ABA_PT,
  casaDaVista,
  chaveDaNota,
  chaveDoDescarte,
  ehPainelDoRadar,
  ehPlataformaDoRadar,
  ehRodada,
  ehVistaDeTriagem,
  ehVistaDoRadar,
  enderecoDaVistaTodos,
  enderecoDoCartao,
  type FiltrosDoRadar,
  type VistaDoRadar,
} from '@/data/admin/radar-gramatica'
import { lerRascunho } from '@/lib/admin/rascunho-do-formulario'
import { lerRecado } from '@/lib/kit/recado'

export const metadata = { title: 'Radar — Admin' }

type ValorDaQuery = string | string[] | undefined
function primeiro(v: ValorDaQuery): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function RadarPage({
  searchParams,
}: {
  searchParams: Promise<{
    ver?: ValorDaQuery
    alvo?: ValorDaQuery
    painel?: ValorDaQuery
    plataforma?: ValorDaQuery
    criador?: ValorDaQuery
    rodada?: ValorDaQuery
  }>
}) {
  const sp = await searchParams
  const verCru = primeiro(sp.ver)
  const vista = ehVistaDoRadar(verCru) ? verCru : 'triagem'
  const painelCru = primeiro(sp.painel)
  const painel = ehVistaDeTriagem(vista) && ehPainelDoRadar(painelCru) ? painelCru : null
  const alvoCru = (primeiro(sp.alvo) ?? '').trim()

  if (vista === 'todos') {
    // Filtro inválido não vira query: cai fora aqui e a vista mostra tudo.
    const plataformaCrua = primeiro(sp.plataforma)
    const rodadaCrua = (primeiro(sp.rodada) ?? '').trim()
    const filtros: FiltrosDoRadar = {
      plataforma: ehPlataformaDoRadar(plataformaCrua) ? plataformaCrua : undefined,
      criador: (primeiro(sp.criador) ?? '').trim() || undefined,
      rodada: ehRodada(rodadaCrua) ? rodadaCrua : undefined,
    }
    const [recado, todos] = await Promise.all([
      lerRecado('conteudo', CASA_DO_RADAR),
      getVistaTodos(filtros),
    ])
    return (
      <Moldura recado={recado} vista="todos">
        <VistaTodosDoRadar vista={todos} filtros={filtros} />
      </Moldura>
    )
  }

  const [recado, deck, teto] = await Promise.all([
    lerRecado('conteudo', CASA_DO_RADAR),
    getDeckDoRadar(vista),
    // Antecipação do teto do dia (Leva 5): a frase de apoio do cartão muda
    // quando o próximo roteiro vai para a fila em vez de gerar na hora.
    getFolgaDoTeto(),
  ])

  const ids = deck.cartoes.map((c) => c.id)
  // Alvo que não está no deck (decidido, inexistente, link velho — ou, na aba
  // PT, reclassificado para fora dela) volta para a casa DA VISTA — exceto
  // quando a casa é o endereço atual (aí o deck vazio fala).
  if (alvoCru && !ids.includes(alvoCru)) redirect(casaDaVista(vista))
  const alvoId = alvoCru || ids[0] || null

  const cartao = alvoId ? await getCartaoDoRadar(alvoId) : null
  // Corrida entre as duas leituras (outra aba decidiu no meio): recomeça limpa.
  if (alvoId && !cartao) redirect(casaDaVista(vista))

  const doDeck = deck.cartoes.find((c) => c.id === alvoId)
  const pos = alvoId ? ids.indexOf(alvoId) + 1 : 0
  const proximo = deck.total > 1 && alvoId ? ids[pos % ids.length] : null

  const rascunho =
    painel && alvoId
      ? await lerRascunho(painel === 'nota' ? chaveDaNota(alvoId) : chaveDoDescarte(alvoId))
      : {}

  return (
    <Moldura recado={recado} vista={vista}>
      {vista === 'pt' && deck.semNota > 0 && (
        <p className="flex items-start gap-1.5 rounded-card bg-warn-wash p-3 text-sm font-medium text-warn-700">
          <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {deck.semNota === 1
              ? '1 trend sem nota de viagem fica fora desta aba — ela segue na Triagem.'
              : `${deck.semNota} trends sem nota de viagem ficam fora desta aba — elas seguem na Triagem.`}
          </span>
        </p>
      )}

      {!cartao || !alvoId ? (
        vista === 'pt' ? (
          <EmptyState
            title="Nenhuma trend de viagem para triar."
            hint={`Aqui só entram trends novas com nota de viagem ${LIMIAR_ABA_PT} ou mais — o robô dá a nota na captura. O resto da fila continua na Triagem.`}
          />
        ) : (
          <EmptyState
            title="Nenhuma trend para triar."
            hint="A fila zerou — o que a captura semanal trouxer aparece aqui, já dissecado. O acervo inteiro fica em Todos."
          />
        )
      ) : (
        <div className="mx-auto w-full max-w-3xl">
          <CartaoDeTriagem
            cartao={cartao}
            variacoes={doDeck?.variacoes ?? []}
            variacaoOrfa={doDeck?.variacaoOrfa ?? false}
            pos={pos}
            total={deck.total}
            hrefPular={proximo ? enderecoDoCartao(proximo, vista) : null}
            vista={vista}
            teto={teto}
          />
        </div>
      )}

      {painel === 'descartar' && cartao && alvoId && (
        <PainelDescartar
          alvo={alvoId}
          variacoes={doDeck?.variacoes ?? []}
          back={proximo ? enderecoDoCartao(proximo, vista) : casaDaVista(vista)}
          rascunho={rascunho}
          vista={vista}
        />
      )}

      {painel === 'nota' && cartao && alvoId && (
        <PainelNota
          alvo={alvoId}
          nota={cartao.nota}
          notaAjustada={cartao.notaAjustada}
          notaDoRobo={cartao.notaDoRobo}
          rascunho={rascunho}
          vista={vista}
        />
      )}
    </Moldura>
  )
}

/** A moldura comum das três vistas: recado, cabeçalho, toolbar e os chips. */
function Moldura({
  recado,
  vista,
  children,
}: {
  recado: { mensagem: string; id: string } | null
  vista: VistaDoRadar
  children: React.ReactNode
}) {
  return (
    <main className="flex flex-col gap-4">
      {recado && <AvisoLegado mensagem={recado.mensagem} chave={recado.id} />}

      <header>
        <h2 className="font-display text-2xl font-bold text-ink-900">
          Radar{' '}
          <span className="font-sans text-base font-normal text-ink-400">
            trends da semana, uma a uma
          </span>
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          O que a captura trouxe, com a dissecação de por que performou. Escolher aqui é o que
          aprova — descarte com motivo o que não serve, pule o que quiser ver depois.
        </p>
      </header>

      {/* Cutover da Leva 5: o radar é a CASA, e a fila de posts virou o destino
          de quem já decidiu — o caminho inverso do que era antes. */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={CASA_DOS_POSTS} className={toolbarLink}>
          📝 Roteiros
        </Link>
        <Link href="/admin/conteudo/pauta" className={toolbarLink}>
          🎯 Criadores
        </Link>
        {/* Leva 6.1: a régua passou a medir o funil DAQUI (quanto da varredura
            virou roteiro), então ela também se abre daqui — o painel continua
            morando na fila, que é onde o portão 2 acontece. */}
        <Link href={`${CASA_DOS_POSTS}?painel=metricas`} className={toolbarLink}>
          📈 Como a pauta anda
        </Link>
      </div>

      {/* Vista é ENDEREÇO: os chips navegam, não escondem. O rótulo da aba PT
          é provisório — o batismo das abas é da Leva 7, com a Teacher Vicky. */}
      <div className="flex flex-wrap gap-1.5">
        <Link href={CASA_DO_RADAR} className={vista === 'triagem' ? chipOn : chipOff}>
          Triagem
        </Link>
        <Link href={casaDaVista('pt')} className={vista === 'pt' ? chipOn : chipOff}>
          Personal Travel
        </Link>
        <Link href={enderecoDaVistaTodos()} className={vista === 'todos' ? chipOn : chipOff}>
          Todos
        </Link>
      </div>

      {children}
    </main>
  )
}
