// BANDA DE TOPO DO INÍCIO (clonagem TutorBird, captura 21 · 26/07/2026).
//
// Faixa em lavagem de acento atravessando a largura de trabalho, com:
//   · a saudação ("Boa tarde, <nome da dona>") em Inter bold escuro + a data/hora do
//     NEGÓCIO (Cuiabá — Lei 1: a hora vem pronta do servidor);
//   · a ilustração flat à direita, que some abaixo de `lg` (é enfeite: some
//     primeiro, nunca empurra conteúdo);
//   · a fileira de 4 cartões-resumo DENTRO da banda — o retrato do mês:
//     dinheiro que entrou, dinheiro previsto, dinheiro em atraso e o tamanho da
//     escola. Os outros 4 números (operação) ficam no andar Negócio, embaixo.
//
// As duas metades chegam de PROMESSAS DIFERENTES (C3): a saudação é do andar
// Hoje, os cartões são do andar Negócio. Cada uma entra atrás da própria
// fronteira de espera — a banda não segura a agenda do dia, e vice-versa.
import Image from 'next/image'
import { Banknote, CalendarClock, TriangleAlert, UsersRound } from 'lucide-react'

import { fmtBRL } from '@/lib/format'
import type { AdminHoje, AdminNegocio, ComparacaoDoMes } from '@/data/admin/home'
import { CartaoKpi } from './CartaoKpi'
import { RESERVA_CARTOES } from './geometria'

/** "2026-07-26" → "26/07". Sem `Date`: é recorte de texto, não conta de fuso. */
function diaMes(iso: string): string {
  const [, m, d] = iso.split('-')
  return d && m ? `${d}/${m}` : iso
}

/**
 * O corte é discreto mas EXPLÍCITO: o delta não compara o agora com o mês
 * passado — compara dois fechamentos de madrugada (C5), cada um na hora em que
 * REALMENTE foi calculado (B2).
 */
export function textoDoCorte(c: ComparacaoDoMes | null): string | undefined {
  if (!c) return undefined
  const hora = (h: string | null) => (h ? ` às ${h}` : '')
  return `Fechamento de ${diaMes(c.hoje)}${hora(c.horaHoje)} × ${diaMes(c.base)}${hora(c.horaBase)}`
}

export function Saudacao({ hoje }: { hoje: AdminHoje }) {
  return (
    <div className="flex flex-col gap-1">
      {/* A saudação NÃO é título de página (esse mora na barra superior): é a
          peça de boas-vindas da banda, e por isso mantém tamanho e peso
          próprios. O que ela herda da régua medida é o TRACKING: −0.8px é o
          valor dos títulos do TutorBird nos dois tamanhos, e sem ele um texto
          de 24–30px em Inter fica visivelmente mais solto que o original. */}
      <h2 className="text-2xl font-bold tracking-title text-ink-900 md:text-3xl">
        {hoje.saudacao}, {hoje.saudacaoNome}
      </h2>
      <p className="text-sm text-ink-600 first-letter:uppercase">
        {hoje.dataPorExtenso} · {hoje.horaDoNegocio} em Cuiabá
      </p>
    </div>
  )
}

/** A ilustração da banda — decorativa, some antes de apertar o conteúdo. */
export function IlustracaoDaBanda() {
  return (
    <Image
      src="/illustrations/aula-online.svg"
      alt=""
      aria-hidden
      width={280}
      height={216}
      unoptimized
      priority
      className="hidden h-auto w-56 shrink-0 lg:block xl:w-64"
    />
  )
}

export function ResumoDoMes({ negocio }: { negocio: AdminNegocio }) {
  const k = negocio.kpis
  const c = negocio.comparacao
  const corte = textoDoCorte(c)

  return (
    <div className="flex flex-col gap-2">
      {/* PISO de altura (`geometria.ts`): mesma fileira, mesmo piso do esqueleto. */}
      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 ${RESERVA_CARTOES}`}>
        <CartaoKpi
          href="/admin/pagamentos?st=pagas"
          icone={Banknote}
          rotulo="Recebido no mês"
          valor={fmtBRL(k.recebido_no_mes_cents)}
          tom="ok"
          comparacao={c?.recebido}
          corte={corte}
        />
        <CartaoKpi
          href="/admin/pagamentos"
          icone={CalendarClock}
          rotulo="Previsto no mês"
          valor={fmtBRL(k.previsto_no_mes_cents)}
          // F2 (v3): a nota muda JUNTO com a fórmula — sem ela, o número novo
          // parece bug (mudança aprovada do plano). A mentoria entra como
          // REFERÊNCIA (sessões × alunos × R$70), nunca somada ao previsto:
          // aquele dinheiro é da Hotmart e entrou no dia da venda (D12).
          // SEMPRE visível, inclusive R$ 0 (Sol F2-r2 + régua da casa: zero é
          // informação urgente — sem ele não se distingue "sem sessões" de
          // "conta ausente"); o valor é DADO e veste o piso de dado.
          detalhe={
            <>
              mensalidades cadastradas (v3) · mentoria{' '}
              <span className="font-medium text-ink-900">{fmtBRL(k.previsto_mentoria_cents)}</span>{' '}
              de referência (Hotmart)
            </>
          }
          comparacao={c?.previsto}
          corte={corte}
        />
        <CartaoKpi
          href="/admin/pagamentos?st=vencidas"
          icone={TriangleAlert}
          rotulo="Em atraso"
          valor={fmtBRL(k.em_atraso_cents)}
          detalhe={k.familias_em_atraso === 1 ? '1 família' : `${k.familias_em_atraso} famílias`}
          comparacao={c?.atraso}
          corte={corte}
          alerta={k.em_atraso_cents > 0}
        />
        <CartaoKpi
          href="/admin/alunos"
          icone={UsersRound}
          rotulo="Alunos ativos"
          valor={String(k.alunos_ativos.total)}
          detalhe={`${k.alunos_ativos.particulares} particulares · ${k.alunos_ativos.travel} Personal Travel`}
          comparacao={c?.alunos}
          corte={corte}
        />
      </div>

      {/* Nota de corte da comparação — e o AVISO de B2: passou a hora do job e o
          fechamento de hoje não veio. Esconder isso sem dizer nada é o modo de
          falha silencioso; o dia perdido não se recupera depois. */}
      {(c || negocio.fechamentoAtrasado) && (
        <p className="text-xs text-ink-600" title={corte}>
          {c && `Comparação entre os fechamentos${c.horaHoje ? ` das ${c.horaHoje}` : ''}.`}
          {negocio.fechamentoAtrasado && ' O fechamento de hoje ainda não foi calculado.'}
        </p>
      )}
    </div>
  )
}
