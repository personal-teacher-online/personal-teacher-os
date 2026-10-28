// Comparação "vs mês anterior" (Onda 1 · M2) — funções PURAS, sem banco e sem
// `server-only`, para a suíte poder exercitá-las direto.
//
// Régua da pesquisa 07: a comparação é DISCRETA e mora no próprio numeral. E a
// regra dura da onda: ou ela tem número, ou ela não existe — nunca "—%".
//
// F3 (revisão adversarial nº 4): a MONTAGEM inteira mora aqui, não só os
// predicados. Antes, o `safeParse` dos dois fechamentos, o teste de versão e o
// preenchimento dos campos viviam dentro de `lerComparacao` (em `home.ts`,
// `server-only`) — e o único teste que os cobria era um grep de duas strings no
// fonte. Grep passa verde com o condicional comentado. Agora a regra é uma
// função com entrada e saída, provada por COMPORTAMENTO, e `home.ts` só faz o
// que é dele: ler o banco e chamar isto.

import { DateTime } from 'luxon'

import { BUSINESS_TZ } from '@/lib/brand/constants'
import { AdminKpisSchema, type AdminKpis } from './kpis'

export interface Comparacao {
  /** variação percentual absoluta, arredondada */
  pct: number
  sentido: 'sobe' | 'desce' | 'igual'
}

/**
 * A comparação só existe entre pontos da MESMA fórmula — e os TRÊS pontos
 * contam: os dois fechamentos E o número AO VIVO ao lado do qual o delta é
 * lido (revisão adversarial nº 3, S3).
 *
 * Antes disto a regra só exigia igualdade ENTRE os dois snapshots. No dia
 * seguinte a um deploy que refina uma conta (`definitions_version` v1 → v2), o
 * fechamento de hoje ainda é o da madrugada — v1 — e o do mês passado também:
 * iguais entre si, e a tela mostrava "recebido −8%" (delta v1) grudado num
 * cartão calculado em v2. Duas réguas diferentes na mesma linha, sem aviso.
 *
 * Divergiu? A comparação simplesmente some — omissão SILENCIOSA e correta (e
 * NÃO é caso de "fechamento atrasado": o job rodou, a fórmula é que é outra).
 * Nada a migrar e nada a recalcular: ela volta sozinha quando os dois
 * fechamentos seguintes nascerem na versão nova.
 */
export function versoesComparaveis(
  aoVivo: number,
  fechamentoDeHoje: number,
  fechamentoBase: number,
): boolean {
  return aoVivo === fechamentoDeHoje && aoVivo === fechamentoBase
}

export function compararComMesAnterior(atual: number, anterior: number): Comparacao | undefined {
  // Sem base > 0 não existe percentual honesto (dividir por zero "cresceu
  // infinito" é ruído, não informação).
  if (!Number.isFinite(atual) || !Number.isFinite(anterior) || anterior <= 0) return undefined
  const pct = Math.round(((atual - anterior) / anterior) * 100)
  return { pct: Math.abs(pct), sentido: pct > 0 ? 'sobe' : pct < 0 ? 'desce' : 'igual' }
}

/**
 * Comparação do mês, por número — cada campo some quando não há base.
 *
 * Os dois lados são SNAPSHOTS (C5): o fechamento de hoje contra o do mesmo dia
 * do mês passado.
 */
export interface ComparacaoDoMes {
  /** captured_on do fechamento de HOJE (o corte de cá) */
  hoje: string
  /** captured_on do fechamento do mesmo dia do mês anterior */
  base: string
  /**
   * Hora REAL em que cada fechamento foi calculado (`generated_at` do próprio
   * snapshot), no fuso do negócio. B2 da retroativa nº 2: a legenda afirmava
   * "03:00" fixo, o que era mentira sempre que a captura tinha sido tardia (2ª
   * ou 3ª tentativa do cron) ou manual — e a hora do corte é justamente o que
   * torna o delta comparável.
   */
  horaHoje: string | null
  horaBase: string | null
  recebido?: Comparacao
  previsto?: Comparacao
  atraso?: Comparacao
  alunos?: Comparacao
}

/**
 * Um `data` de `kpi_snapshots` é um fechamento LEGÍVEL? É o que separa "o job
 * não rodou" (nada a ler) de "não há comparação" — o aviso de fechamento
 * atrasado depende só disto, e não da comparação existir.
 */
export function fechamentoValido(snapshot: unknown): boolean {
  return AdminKpisSchema.safeParse(snapshot).success
}

/**
 * Monta a comparação a partir dos DOIS `data` crus de `kpi_snapshots` (jsonb,
 * portanto `unknown` até prova em contrário) e do KPI AO VIVO.
 *
 * Devolve `null` — e a comparação simplesmente some da tela, nunca "—%" —
 * quando:
 *  · falta um dos fechamentos, ou algum deles não passa no schema (forma velha
 *    ou corrompida: comparar com o que não se entende é pior que não comparar);
 *  · as fórmulas divergem. E os TRÊS pontos contam: os dois fechamentos E o
 *    número AO VIVO ao lado do qual o delta é lido (S3, `versoesComparaveis`).
 *
 * Sumir aqui é SILENCIOSO de propósito: não há job atrasado neste caso, há
 * fórmula nova. Reclamar de atraso mandaria a dona procurar um problema que
 * não existe.
 */
export function montarComparacao(
  kpisVivos: AdminKpis,
  snapDeHoje: unknown,
  snapDaBase: unknown,
): ComparacaoDoMes | null {
  const hoje = kpisVivos.business_date
  const base = dataDaBase(hoje)
  if (!base) return null

  const deHoje = AdminKpisSchema.safeParse(snapDeHoje)
  const deBase = AdminKpisSchema.safeParse(snapDaBase)
  if (!deHoje.success || !deBase.success) return null

  if (
    !versoesComparaveis(
      kpisVivos.definitions_version,
      deHoje.data.definitions_version,
      deBase.data.definitions_version,
    )
  )
    return null

  const a = deHoje.data
  const b = deBase.data
  return {
    hoje,
    base,
    horaHoje: horaDoFechamento(a.generated_at),
    horaBase: horaDoFechamento(b.generated_at),
    recebido: compararComMesAnterior(a.recebido_no_mes_cents, b.recebido_no_mes_cents),
    previsto: compararComMesAnterior(a.previsto_no_mes_cents, b.previsto_no_mes_cents),
    atraso: compararComMesAnterior(a.em_atraso_cents, b.em_atraso_cents),
    alunos: compararComMesAnterior(a.alunos_ativos.total, b.alunos_ativos.total),
  }
}

/** A data do fechamento do mês passado que serve de base para `hoje`. */
export function dataDaBase(hoje: string): string | null {
  return DateTime.fromISO(hoje).minus({ months: 1 }).toISODate()
}

/** "14:07" no fuso do NEGÓCIO — o instante em que aquele fechamento foi feito. */
function horaDoFechamento(geradoEm: string): string | null {
  const t = DateTime.fromISO(geradoEm).setZone(BUSINESS_TZ)
  return t.isValid ? t.toFormat('HH:mm') : null
}
