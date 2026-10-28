// O CARTÃO DE TRIAGEM DO RADAR (Estúdio v2 · Leva 3.1) — uma trend por vez:
// o post embutido (ou o cartão-link honesto), o "De onde veio" montado por
// código, a dissecação da captura e as três saídas — Gerar roteiro (ainda
// desligado), Descartar com motivo e Pular.
//
// Server-safe: nenhum hook, nenhuma formatação de data/número aqui — tudo
// chega pronto da camada de dados (`src/data/admin/radar.ts`).
//
// RÉGUAS QUE ESTE ARQUIVO CARREGA:
// · o contador "N de M" é DADO (inclusive com N=0): `font-semibold` +
//   `tabular-nums`, nunca text-xs;
// · rótulo em caixa alta 11px nunca é o único nome de um dado — todo bloco tem
//   o valor em `text-sm text-ink-900` (precedente: proveniência do detalhe do
//   post, que passou pelos gates da onda do Portal);
// · ação parece ação: as três saídas são botões do kit — nada de link de texto
//   puro (régua do AGENTS.md para tela nova);
// · "Pular" é NAVEGAÇÃO, não decisão: não muda estado nenhum (ADR-032).

import Link from 'next/link'

import { gerarRoteiroDaTrendAction } from '@/app/admin/conteudo/actions'
import { FormValidado } from '@/components/kit/form-validado'
import { Pill } from '@/components/kit/pill'
import type { CartaoDoRadar, FolgaDoTeto, VariacaoDoCartao } from '@/data/admin/radar'
import {
  PLATAFORMA_DO_RADAR_ROTULO,
  casaDaVista,
  contextoDaVista,
  enderecoDoCartao,
  enderecoDoPainelDescartar,
  enderecoDoPainelNota,
  type VistaDeTriagem,
} from '@/data/admin/radar-gramatica'

/** Rótulo de bloco — a mesma anatomia da proveniência do detalhe do post. */
function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold tracking-wide text-ink-400 uppercase">{children}</p>
  )
}

/**
 * O vocabulário do worker em português de tela. Valor fora do dicionário sai
 * como veio — a tela traduz, nunca inventa.
 */
const FUNCAO_DA_BATIDA: Record<string, string> = {
  gancho: 'gancho',
  desenvolvimento: 'desenvolvimento',
  demonstracao: 'demonstração',
  virada: 'virada',
  cta: 'CTA',
}

function Midia({ cartao }: { cartao: CartaoDoRadar }) {
  const rede = PLATAFORMA_DO_RADAR_ROTULO[cartao.plataforma]

  if (cartao.youtubeId) {
    return (
      <div className="flex flex-col gap-2">
        <div className="aspect-video w-full overflow-hidden rounded-card border border-line-soft bg-paper-100">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${cartao.youtubeId}`}
            title={`Post original no ${rede}`}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            className="h-full w-full"
          />
        </div>
        {/* Saída honesta para vídeo apagado/privado: o iframe vira um cinza
            mudo, e o link externo continua funcionando. */}
        {cartao.url && (
          <a
            href={cartao.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ac-soft self-start"
          >
            Abrir no {rede} ↗
          </a>
        )}
      </div>
    )
  }

  // Sem embed simples (Instagram/TikTok/X/Reddit exigem script de terceiros) ou
  // URL ilegível: o cartão-link é o estado honesto.
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line-soft bg-paper-50 p-4">
      <span className="flex items-center gap-2">
        <Pill tone="neutral">{rede}</Pill>
        <span className="text-sm font-medium text-ink-900">
          {cartao.url ? 'O post abre na própria rede.' : 'A captura não guardou o link deste post.'}
        </span>
      </span>
      {cartao.url && (
        <a
          href={cartao.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ac-soft self-start"
        >
          Abrir no {rede} ↗
        </a>
      )}
    </div>
  )
}

function Dissecacao({ cartao }: { cartao: CartaoDoRadar }) {
  const d = cartao.dissecacao
  if (!d) {
    return (
      <div className="rounded-card bg-paper-50 p-4">
        <p className="text-sm font-medium text-ink-900">Sem dissecação para esta trend.</p>
        <p className="mt-1 text-sm text-ink-600">
          Ela veio de um apanhado de trends, não de um reel analisado — a dissecação nasce quando
          um reel dela passar pela captura.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {d.gancho && (
        <div className="flex flex-col gap-1">
          <Rotulo>Gancho</Rotulo>
          <p className="text-sm font-medium text-ink-900">“{d.gancho.texto_falado}”</p>
          {(d.gancho.tipo || d.gancho.segundos_ate_o_ponto != null) && (
            <p className="text-sm text-ink-600">
              {[
                d.gancho.tipo,
                d.gancho.segundos_ate_o_ponto != null
                  ? `${d.gancho.segundos_ate_o_ponto}s até o ponto`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>
      )}

      {d.beats && d.beats.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Rotulo>Batidas</Rotulo>
          <ol className="flex flex-col gap-1.5">
            {d.beats.map((b, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="font-semibold text-ink-400 tabular-nums">{i + 1}.</span>
                <span className="min-w-0 text-ink-900">
                  {b.funcao && (
                    <span className="font-semibold">{FUNCAO_DA_BATIDA[b.funcao] ?? b.funcao}: </span>
                  )}
                  {b.resumo}
                  {b.frase_chave && <span className="text-ink-600"> — “{b.frase_chave}”</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {d.texto_na_tela && (d.texto_na_tela.cartelas?.length || d.texto_na_tela.padrao) && (
        <div className="flex flex-col gap-1.5">
          <Rotulo>Texto na tela</Rotulo>
          {d.texto_na_tela.cartelas && d.texto_na_tela.cartelas.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {d.texto_na_tela.cartelas.map((c, i) => (
                <li
                  key={i}
                  className="rounded-input border border-line bg-paper-0 px-2.5 py-1 text-sm font-medium text-ink-900"
                >
                  {c}
                </li>
              ))}
            </ul>
          )}
          {d.texto_na_tela.padrao && <p className="text-sm text-ink-600">{d.texto_na_tela.padrao}</p>}
        </div>
      )}

      {d.por_que_performou && d.por_que_performou.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Rotulo>Por que performou</Rotulo>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {d.por_que_performou.map((p, i) => (
              <li key={i} className="text-sm text-ink-900">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.copia?.como_copiar && (
        <div className="flex flex-col gap-1">
          <Rotulo>Como adaptar</Rotulo>
          <p className="text-sm text-ink-900">{d.copia.como_copiar}</p>
          {d.copia.trilha?.protegida && (
            <p className="text-sm font-medium text-warn-700">
              ⚠ Trilha protegida{d.copia.trilha.qual ? ` (${d.copia.trilha.qual})` : ''} — trocar
              antes de gravar.
            </p>
          )}
        </div>
      )}

      {d.avisos && d.avisos.length > 0 && (
        <div className="flex flex-col gap-1">
          <Rotulo>Avisos da análise</Rotulo>
          <ul className="flex flex-col gap-1">
            {d.avisos.map((a, i) => (
              <li key={i} className="text-sm font-medium text-warn-700">
                ⚠ {a}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function CartaoDeTriagem({
  cartao,
  variacoes,
  variacaoOrfa,
  pos,
  total,
  hrefPular,
  vista,
  teto,
}: {
  cartao: CartaoDoRadar
  /** as variações NOVAS penduradas nesta trend (o que a decisão dela arrasta) */
  variacoes: VariacaoDoCartao[]
  /** variação cuja mãe já foi decidida (roteirizada — invariante do banco) */
  variacaoOrfa: boolean
  pos: number
  total: number
  /** `null` quando o deck tem um cartão só — pular viraria um link para si mesmo */
  hrefPular: string | null
  /** a aba de origem — viaja nos endereços para o round-trip voltar para ela */
  vista: VistaDeTriagem
  /** a antecipação do teto do dia (a decisão mesmo é da RPC — Lei 3) */
  teto: FolgaDoTeto
}) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-line-soft bg-paper-0 p-4 shadow-(--shadow-card) sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        {/* O contador é DADO: é ele que diz o tamanho da fila de decisão. */}
        <p className="text-sm font-semibold text-ink-900 tabular-nums">
          {pos} de {total}
        </p>
        <span className="flex flex-wrap items-center gap-1.5">
          <Pill tone="neutral">{PLATAFORMA_DO_RADAR_ROTULO[cartao.plataforma]}</Pill>
          {/* A nota é DADO de decisão (a mesma língua da vista Todos) — e o
              ajuste é a válvula da Teacher Vicky, ao lado do que ele muda. */}
          {cartao.nota != null ? (
            <Pill tone="neutral">
              nota {cartao.nota}
              {cartao.notaAjustada ? ' (ajustada)' : ''}
            </Pill>
          ) : (
            <Pill tone="muted">sem nota</Pill>
          )}
          {variacaoOrfa && <Pill tone="ac">variação de tema já roteirizado</Pill>}
          <Link href={enderecoDoPainelNota(cartao.id, vista)} className="btn-ac-soft">
            Ajustar nota…
          </Link>
        </span>
      </header>

      <Midia cartao={cartao} />

      <div className="flex flex-col gap-1">
        <Rotulo>De onde veio</Rotulo>
        <p className="text-sm font-medium text-ink-900">{cartao.deOndeVeio}</p>
      </div>

      <Dissecacao cartao={cartao} />

      {variacoes.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-card bg-paper-50 p-4">
          <Rotulo>Variações do mesmo tema</Rotulo>
          <ul className="flex flex-col gap-1">
            {variacoes.map((v) => (
              <li key={v.id} className="text-sm font-medium text-ink-900">
                {v.origemFrase}{' '}
                <span className="font-normal text-ink-600">
                  · {PLATAFORMA_DO_RADAR_ROTULO[v.plataforma]} · rodada {v.rodada}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-600">
            {variacoes.length === 1
              ? 'Ela segue a decisão desta trend: o descarte a descarta junto, herdando o motivo.'
              : `Elas seguem a decisão desta trend: o descarte descarta as ${variacoes.length} junto, herdando o motivo.`}
          </p>
        </div>
      )}

      <footer className="flex flex-col gap-2 border-t border-line-soft pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* O formulário embrulha SÓ o botão de gerar: as outras duas saídas
              são navegação, e link dentro de form vira alvo de Enter. */}
          <FormValidado action={gerarRoteiroDaTrendAction} className="contents">
            <input type="hidden" name="alvo" value={cartao.id} />
            {/* O destino vem da ABA (ADR-035): a Teacher Vicky não responde de novo o
                que o lugar de onde ela clicou já disse. */}
            <input type="hidden" name="contexto" value={contextoDaVista(vista)} />
            <input type="hidden" name="back" value={hrefPular ?? casaDaVista(vista)} />
            <input type="hidden" name="back_erro" value={enderecoDoCartao(cartao.id, vista)} />
            <button type="submit" className="btn-ac btn-ac-lg">
              Gerar roteiro {contextoDaVista(vista) === 'travel' ? 'Personal Travel' : 'geral'}
            </button>
          </FormValidado>
          <Link href={enderecoDoPainelDescartar(cartao.id, vista)} className="btn-ac-soft btn-ac-lg">
            Descartar…
          </Link>
          {hrefPular && (
            <Link href={hrefPular} className="btn-ac-soft btn-ac-lg">
              Pular →
            </Link>
          )}
        </div>
        {/* Apoio VISÍVEL (não `title` — celular não tem hover): a verdade sobre
            o que o clique faz é dita ao lado, sempre. */}
        <p className="text-sm text-ink-600">
          {teto.temFolga
            ? 'Gerar é o que aprova esta trend: ela sai da fila e o rascunho abre em seguida. Descartar pede motivo; pular não decide nada.'
            : `Gerar ainda aprova a trend, mas o roteiro entra na fila: o teto de ${teto.teto} roteiros por dia já foi atingido e a rotina da manhã gera este. Pular não decide nada.`}
        </p>
      </footer>
    </section>
  )
}
