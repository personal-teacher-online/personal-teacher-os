// Esqueletos do Início — FORMA REAL, não barra genérica: a altura da linha da
// agenda e a caixa dos cartões são as mesmas do conteúdo, então nada salta
// quando os dados chegam. O atraso de 200 ms para aparecer mora no
// `.kit-skeleton` (globals.css): resposta rápida não pisca esqueleto.
//
// São QUATRO agora, um por fronteira de espera da página: a banda tem duas
// (saudação e cartões do mês, que vêm de promessas diferentes) e os dois
// andares de baixo têm a sua.
//
// RESERVA DE GEOMETRIA (revisão nº 5 do Sol, A3): forma real não bastava —
// faltava TAMANHO. Cada esqueleto agora desenha a CONTAGEM TÍPICA (4 linhas de
// agenda, 3 cartões de pendência, 4 cartões de KPI) e veste o MESMO piso de
// altura que o andar real veste (`geometria.ts`), então a troca não empurra a
// página. A régua, com a exceção declarada do estado "nada travado", está
// comentada em `geometria.ts` — é lá que os números se explicam.
import { Skeleton, SkeletonRows } from '@/components/kit/skeleton'
import {
  CARTOES_TIPICOS_DE_PENDENCIA,
  LINHAS_TIPICAS_DA_AGENDA,
  RESERVA_AGENDA,
  RESERVA_CARTOES,
  RESERVA_PENDENCIAS,
} from './geometria'

/**
 * A caixa do cartão de KPI na anatomia CENTRADA (captura 41): mesmo padding,
 * mesmo gap, círculo de 80px (64 no compacto) e as linhas de texto na altura
 * REAL de cada papel — número (36/30px), rótulo e detalhe (20px), apoio (16px).
 * Somando, a caixa mede o mesmo que o cartão que vai entrar no lugar dela, e a
 * troca não empurra a página.
 *
 * O contorno NÃO é um bloco cinza: o `<div>` é transparente e só as peças de
 * dentro são `.kit-skeleton` — é o que preserva o atraso de 200 ms (resposta
 * rápida não pisca esqueleto) em vez de pintar um cartão inteiro no primeiro
 * frame.
 */
function EsqueletoCartaoKpi({ compacto, apoio }: { compacto?: boolean; apoio?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center ${compacto ? 'gap-1.5 p-4' : 'gap-2 p-[22px]'}`}
      aria-hidden
    >
      <Skeleton className={`mb-1 rounded-full ${compacto ? 'h-16 w-16' : 'h-20 w-20'}`} />
      <Skeleton className={compacto ? 'h-[30px] w-24' : 'h-9 w-32'} />
      <Skeleton className="h-5 w-36 max-w-full" />
      <Skeleton className="h-5 w-44 max-w-full" />
      {apoio && <Skeleton className="h-4 w-40 max-w-full" />}
    </div>
  )
}

export function EsqueletoSaudacao() {
  return (
    // As alturas espelham a peça real: h2 de 24/30px (lh 36) + a linha de apoio
    // de 14px (lh 20), com o mesmo `gap-1`.
    <div className="flex flex-col gap-1" aria-hidden>
      <Skeleton className="h-9 w-64 max-w-full" />
      <Skeleton className="h-5 w-80 max-w-full" />
    </div>
  )
}

/** Os 4 cartões do mês, dentro da banda — os únicos que trazem a tendência. */
export function EsqueletoResumo() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 ${RESERVA_CARTOES}`}>
        {Array.from({ length: 4 }, (_, i) => (
          <EsqueletoCartaoKpi key={i} apoio />
        ))}
      </div>
      {/* a nota de corte da comparação, que existe no regime (há fechamento) */}
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  )
}

export function EsqueletoHoje() {
  return (
    <section className="flex flex-col gap-5" aria-hidden>
      <div className="panel-tb overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <Skeleton className="h-6 w-48" />
        </div>
        {/* sem borda própria: a moldura já é a do card-contêiner */}
        <div className={RESERVA_AGENDA}>
          <SkeletonRows
            rows={LINHAS_TIPICAS_DA_AGENDA}
            rowClassName="h-16"
            className="rounded-none border-0"
          />
        </div>
      </div>

      {/* o título "Pendências" existe no andar real e faltava aqui — sozinho,
          ele valia um pulo de 26px + gap na troca */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-[26px] w-40" />
        <div className={RESERVA_PENDENCIAS}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: CARTOES_TIPICOS_DE_PENDENCIA }, (_, i) => (
              <EsqueletoCartaoKpi key={i} compacto />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

export function EsqueletoNegocio() {
  return (
    <section className="flex flex-col gap-3" aria-hidden>
      {/* o cabeçalho real é título + a frase do corte, na mesma linha */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Skeleton className="h-[26px] w-52" />
        <Skeleton className="h-5 w-56 max-w-full" />
      </div>
      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 ${RESERVA_CARTOES}`}>
        {/* a quarta linha aqui não é tendência (o andar Negócio não compara): é
            a segunda linha dos dois cartões de LISTA, que é quem estica a
            fileira inteira pelo `stretch` do grid. */}
        {Array.from({ length: 4 }, (_, i) => (
          <EsqueletoCartaoKpi key={i} apoio />
        ))}
      </div>
    </section>
  )
}
