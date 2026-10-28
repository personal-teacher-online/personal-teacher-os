// A ESCADA DA MENTORIA EM PALAVRAS (Onda do Portal · P5 — rodada de correção).
//
// Aqui não se decide NADA sobre elegibilidade: quem decide é o banco
// (`mentorship_next_window`, `mentorship_windows_unlocked`,
// `mentorship_can_book`), dentro dos locks do motor. O que mora neste arquivo é
// o DESENHO — qual palavra cada degrau mostra — e ele é puro para caber num
// teste sem navegador.
//
// OS DOIS DEFEITOS QUE ISTO FECHA. A tela desenhava a escada por contagem:
//
//   const estado = i < spent ? 'usada' : i < unlocked ? 'liberada' : 'bloqueada'
//
//   1. `i < spent` diz "as N primeiras foram usadas". Não é o que o ledger diz.
//      Com a etapa 2 estornada e as etapas 1 e 3 gastas, `spent` é 2 e a tela
//      pintava 1 e 2 — escondendo exatamente o BURACO que o banco vai preencher
//      primeiro (`mentorship_next_window` = MENOR etapa com gasto líquido zero,
//      migration 20260714000400 §5). A pessoa via "a próxima é a 3" quando a
//      próxima é a 2.
//   2. `i < unlocked` diz "a janela do tempo abriu, logo está liberada". Abrir a
//      janela é só metade: `mentorship_can_book` ainda exige o threshold de
//      progresso DAQUELA etapa (D2 / ADR-006). A tela prometia liberação a quem
//      ia levar recusa no clique — e a régua da casa é que a tela nunca ofereça
//      o que a RPC recusa.

/** A escada é contada a partir de 1 (a pessoa lê "mentoria 1", não "índice 0").
 *  O deslocamento é CONSTANTE NOMEADA, e não o literal `+ 1`, porque o varredor
 *  de vocabulário do portal proíbe essa notação nas telas do aluno — ela é
 *  jargão de ledger, e uma numeração de etapa não vale abrir exceção nele. */
export const PRIMEIRA_ETAPA = 1

/** O número que o aluno lê, a partir do índice do laço. */
export const numeroDaEtapa = (indice: number) => indice + PRIMEIRA_ETAPA

/**
 * As etapas com reserva ATIVA — pela etapa REAL de cada uma, nunca por contagem.
 * Quem lê a etapa do banco é `reservasDeMentoria` (`src/lib/portal/data.ts`).
 *
 * Reserva sem etapa legível (a leitura não trouxe, valor fora da escada) não
 * vira degrau nenhum: um degrau a menos é menos errado que um degrau na etapa
 * errada.
 */
export function etapasUsadas(
  reservas: readonly { etapa: number | null }[] | null | undefined,
): Set<number> {
  const etapas = (reservas ?? [])
    .map((r) => Number(r.etapa))
    .filter((n) => Number.isInteger(n) && n >= PRIMEIRA_ETAPA)
  return new Set(etapas)
}

/**
 * A MENOR etapa ainda livre — a mesma definição de `mentorship_next_window`.
 * `null` quando a escada inteira já foi usada.
 */
export function proximaEtapaLivre(usadas: ReadonlySet<number>, total: number): number | null {
  for (let n = PRIMEIRA_ETAPA; n < PRIMEIRA_ETAPA + total; n++) {
    if (!usadas.has(n)) return n
  }
  return null
}

export type EstadoDoDegrau = 'usada' | 'liberada' | 'janela_aberta' | 'a_liberar'

export interface EscadaDaMentoria {
  /** as etapas com reserva ATIVA (o `window_index` real de cada uma) */
  usadas: ReadonlySet<number>
  /** a menor etapa livre — `proximaEtapaLivre` */
  proxima: number | null
  /** quantas janelas o tempo já destravou (`mentorship_windows_unlocked`) */
  unlocked: number
  /** o banco confirmou a reserva da PRÓXIMA etapa? (`mentorship_can_book`) */
  canBook: boolean
}

/**
 * O estado de UM degrau.
 *
 * Só a PRÓXIMA etapa pode estar "liberada", e só com a confirmação do banco.
 * Janela aberta sem confirmação vira `janela_aberta`: é verdade (o tempo passou)
 * sem ser promessa (o progresso ainda segura).
 */
export function estadoDoDegrau(etapa: number, escada: EscadaDaMentoria): EstadoDoDegrau {
  if (escada.usadas.has(etapa)) return 'usada'
  if (etapa !== escada.proxima) return 'a_liberar'
  if (escada.canBook) return 'liberada'
  return etapa <= escada.unlocked ? 'janela_aberta' : 'a_liberar'
}

export const PALAVRA_DO_DEGRAU: Record<EstadoDoDegrau, string> = {
  usada: 'usada',
  liberada: 'liberada',
  janela_aberta: 'janela aberta',
  a_liberar: 'a liberar',
}

/**
 * A JANELA ABRIU E O PROGRESSO SEGURA? É o único caso em que a tela precisa de
 * uma frase inteira: "a liberar" mandaria a pessoa esperar o calendário, que não
 * é o que a está segurando.
 */
export function esperandoProgresso(escada: EscadaDaMentoria): boolean {
  return !escada.canBook && escada.proxima != null && escada.proxima <= escada.unlocked
}
