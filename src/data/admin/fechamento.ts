// FECHAMENTO DIÁRIO DE KPI — o que a home precisa saber sobre o job (B2 da
// revisão adversarial retroativa nº 2). Função PURA, sem banco e sem
// `server-only`, para a suíte exercitá-la direto.
//
// Por que existe: "não há comparação" e "o fechamento de hoje não aconteceu"
// eram a MESMA tela — a comparação sumia calada nos dois casos. Antes do
// horário do job, sumir é o comportamento certo (o ponto ainda não existe);
// DEPOIS dele, sumir é esconder uma falha de captura que ninguém vai descobrir
// sozinho, e cada dia perdido é um buraco permanente no histórico append-only.

import { DateTime } from 'luxon'

/**
 * As tentativas do `pg_cron`, em MINUTOS UTC do dia — espelho exato da
 * migration 20260726000300 (`0 7`, `20 7`, `0 9`). A suíte confronta esta
 * lista com o que está em `cron.job`: se alguém mudar o agendamento sem mudar
 * aqui, o aviso da tela passaria a disparar na hora errada.
 */
export const TENTATIVAS_DE_FECHAMENTO_UTC = [7 * 60, 7 * 60 + 20, 9 * 60] as const

/** Folga depois da ÚLTIMA tentativa antes de chamar o dia de atrasado. */
export const FOLGA_DE_FECHAMENTO_MIN = 60

/**
 * Já passou da hora de o fechamento de hoje existir?
 *
 * @param businessDate data civil do negócio (`YYYY-MM-DD`, vinda da RPC)
 * @param agoraIso     instante atual em ISO (UTC ou com offset — Luxon resolve)
 */
export function passouDaHoraDoFechamento(businessDate: string, agoraIso: string): boolean {
  const dia = DateTime.fromISO(businessDate, { zone: 'utc' })
  const agora = DateTime.fromISO(agoraIso)
  if (!dia.isValid || !agora.isValid) return false
  const ultima = TENTATIVAS_DE_FECHAMENTO_UTC[TENTATIVAS_DE_FECHAMENTO_UTC.length - 1]
  return agora.toUTC() > dia.startOf('day').plus({ minutes: ultima + FOLGA_DE_FECHAMENTO_MIN })
}
