// ANDAR "NEGÓCIO" DO INÍCIO — a metade dos 8 números da pesquisa 07 que fala de
// OPERAÇÃO. A outra metade (dinheiro do mês + tamanho da escola) mora na banda
// de topo, dentro da lavagem de acento: é o retrato do mês, e é o que a dona
// olha primeiro.
//
// Divisão 4+4 mantida como o dono pediu, com o corte por SIGNIFICADO:
//   banda   → recebido · previsto · em atraso · alunos ativos
//   aqui    → aulas da semana · entradas×saídas · ocupação · alunos por nível
//
// Regras que este arquivo obedece, uma a uma:
// · TODO cartão clica para a lista que o explica (convergência de 3+ produtos);
// · anatomia ÚNICA de cartão (`CartaoKpi`): coluna CENTRADA — círculo tint de
//   80px no topo, número bold escuro, rótulo cinza legível — sem eyebrow, sem
//   número em display fino. Os dois cartões que trazem LISTA (ocupação por
//   professora, alunos por nível) pedem `lista`: mesmo cabeçalho centrado dos
//   vizinhos, corpo alinhado à esquerda (par nome→número centrado é ilegível);
// · "+1 · −0" virou PALAVRAS ("1 novo · nenhum encerrado"): a régua do dono é
//   que o resumo se leia em voz alta;
// · dinheiro sempre por `fmtBRL` (Lei 9); nunca churn % (n=20: um aluno é 5 pp);
// · sem gráfico de série: tendência é assunto de relatório, não de home.
import { ArrowLeftRight, CalendarDays, GraduationCap, Gauge } from 'lucide-react'

import { entradasSaidasEmPalavras } from '@/lib/format'
import type { AdminNegocio } from '@/data/admin/home'
import { CartaoKpi } from './CartaoKpi'
import { RESERVA_CARTOES } from './geometria'

export function AndarNegocio({ negocio }: { negocio: AdminNegocio }) {
  const k = negocio.kpis
  const niveis = k.alunos_por_nivel.filter((n) => n.alunos > 0)
  // A escola tem 2 professoras (5 no horizonte). O teto existe para o cartão não
  // virar uma coluna sem fim se a tabela encher de fixture/arquivo — home é
  // resumo; a lista completa está a um clique, em Professoras.
  const TETO = 5
  const ocupacao = k.ocupacao_por_professora.slice(0, TETO)
  const alemDoTeto = k.ocupacao_por_professora.length - ocupacao.length

  return (
    <section aria-labelledby="andar-negocio" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {/* Título de SEÇÃO na régua medida (Inter 20/600, −0.8px); era 18/700. */}
        <h3 id="andar-negocio" className="title-section text-ink-900">
          Como a escola está
        </h3>
        <p className="text-sm text-ink-600">Semana para aulas · mês para dinheiro</p>
      </div>

      {/* PISO de altura (`geometria.ts`): a fileira não pode entrar mais baixa
          que o esqueleto que a antecede — os dois cartões de LISTA esticam o
          conjunto, e sem piso a troca daria um pulo para cima. */}
      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 ${RESERVA_CARTOES}`}>
        <CartaoKpi
          href="/admin/agenda"
          icone={CalendarDays}
          rotulo="Aulas desta semana"
          valor={`${k.aulas_da_semana.restantes} de ${k.aulas_da_semana.total}`}
          detalhe="ainda por acontecer"
        />
        <CartaoKpi
          href="/admin/alunos/contratos"
          icone={ArrowLeftRight}
          rotulo="Entradas e saídas do mês"
          detalhe="contratos que começaram e terminaram no mês"
        >
          <span className="text-xl font-bold text-ink-900">
            {entradasSaidasEmPalavras(
              k.entradas_saidas_do_mes.novos,
              k.entradas_saidas_do_mes.encerrados,
            )}
          </span>
        </CartaoKpi>
        <CartaoKpi
          lista
          href="/admin/professoras"
          icone={Gauge}
          rotulo="Ocupação das janelas"
          detalhe="horas ocupadas ÷ horas de janela"
        >
          {ocupacao.length === 0 ? (
            <span className="text-sm font-medium text-ink-900">
              Nenhuma professora com janela publicada.
            </span>
          ) : (
            <ul className="flex flex-col gap-1">
              {ocupacao.map((o) => (
                <li key={o.teacher_id} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm text-ink-600">{o.teacher ?? '—'}</span>
                  <span className="text-xl font-bold tabular-nums text-ink-900">
                    {o.ocupacao_pct === null ? '—' : `${Math.round(o.ocupacao_pct)}%`}
                  </span>
                </li>
              ))}
              {alemDoTeto > 0 && (
                // M3-c3 · A4: a seta escrita saiu. O cartão INTEIRO já é o link
                // para /admin/professoras — a seta prometia um clique que não
                // existia neste `<li>` e repetia o padrão que o dono baniu.
                <li className="text-sm text-ink-600">e mais {alemDoTeto} professoras</li>
              )}
            </ul>
          )}
        </CartaoKpi>
        <CartaoKpi
          lista
          href="/admin/alunos"
          icone={GraduationCap}
          rotulo="Alunos por nível"
          detalhe="entre os alunos ativos"
        >
          {niveis.length === 0 ? (
            <span className="text-sm font-medium text-ink-900">Nenhum nível informado ainda.</span>
          ) : (
            <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              {niveis.map((n) => (
                <li key={n.nivel} className="flex items-baseline gap-1.5">
                  <span className="text-sm font-medium text-ink-600">{n.nivel}</span>
                  <span className="text-xl font-bold tabular-nums text-ink-900">{n.alunos}</span>
                </li>
              ))}
            </ul>
          )}
        </CartaoKpi>
      </div>
    </section>
  )
}
