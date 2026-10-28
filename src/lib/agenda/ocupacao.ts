// AGENDA JÁ OCUPADA DA PROFESSORA (M3-c4 · B5) — a parte PURA.
//
// A queixa do dono: *"não posso criar contrato com horários já preenchidos"*.
// O fato é o contrário — o banco JÁ recusa (Lei 3: `class_instances_teacher_
// no_overlap_excl`, exclusão GiST sobre `tstzrange` por professora). O que
// faltava era a TELA antecipar, em vez de deixar a pessoa preencher tudo para
// levar um "Falha: conflicting key value…" no fim.
//
// LEI 1 MORA NA FRONTEIRA DESTE ARQUIVO. Os horários fixos das outras alunas
// estão gravados como (weekday + hora local + zona IANA) da zona DELAS — que
// pode não ser a do aluno novo. Comparar "10:00 com 10:00" entre fusos
// diferentes seria aritmética manual de horas entre zonas, proibida. Então a
// conversão acontece no SERVIDOR, com Luxon, no offset do dia específico
// (`paraOFusoDoAluno`, em src/data/admin/alunos.ts), e o que chega aqui já está
// TODO no mesmo relógio: o do aluno novo. Daqui para baixo é só aritmética de
// minutos dentro de um único fuso — que é o que uma função pura pode fazer sem
// mentir.
//
// A janela que atravessa a meia-noite (acontece de verdade: 23:00 em Cuiabá é
// outro dia civil em Lisboa) entra PARTIDA em dois pedaços, um por dia da
// semana. É por isso que o tipo carrega `weekday` em cada pedaço.

export interface JanelaOcupada {
  /** professora dona da janela */
  professoraId: string
  /** dia da semana (0=domingo) NO FUSO DO ALUNO NOVO */
  weekday: number
  /** minutos desde a meia-noite local do aluno novo — início (inclusivo) */
  inicio: number
  /** minutos desde a meia-noite local do aluno novo — fim (exclusivo) */
  fim: number
  /** de quem é a aula que ocupa ("Ana Souza") */
  quem: string
  /** "09:00–09:45" pronto para a tela, já no fuso do aluno novo */
  texto: string
  /**
   * O horário fixo que gerou esta janela — `null`/ausente quando ela vem de uma
   * aula avulsa ou remarcada (M4-2).
   *
   * Existe por causa da TROCA de horário: `close_and_create_slot` fecha o slot
   * antigo e CANCELA as aulas futuras dele antes de materializar as novas, então
   * o horário que está sendo substituído não disputa nada com o substituto —
   * empurrar a aula de terça 20:30 para terça 20:45 é legal no banco. Sem esta
   * identidade, a tela acusaria conflito da aula consigo mesma e travaria um
   * gesto que o Postgres aceita (antecipação que mente é pior que nenhuma).
   */
  slotId?: string | null
}

/** "09:30" → 570. Devolve `null` para o que ainda não é hora (o campo em branco
 *  ou meio digitado — que não é erro, é ausência). */
export function minutosDeHhmm(hhmm: string | null | undefined): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec((hhmm ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** 570 → "09:30" (com a volta pela meia-noite, para a janela que atravessa). */
export function hhmmDeMinutos(minutos: number): string {
  const m = ((minutos % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Os pedaços que uma aula ocupa, partindo na meia-noite quando ela atravessa. */
export function pedacosDaAula(
  weekday: number,
  inicio: number,
  duracao: number,
): { weekday: number; inicio: number; fim: number }[] {
  const fim = inicio + duracao
  if (fim <= 1440) return [{ weekday, inicio, fim }]
  return [
    { weekday, inicio, fim: 1440 },
    { weekday: (weekday + 1) % 7, inicio: 0, fim: fim - 1440 },
  ]
}

/** As janelas de UMA professora num dia — é o que a tela lista ao lado do campo. */
export function janelasDoDia(
  janelas: JanelaOcupada[],
  professoraId: string,
  weekday: number,
): JanelaOcupada[] {
  return janelas
    .filter((j) => j.professoraId === professoraId && j.weekday === weekday)
    .sort((a, b) => a.inicio - b.inicio)
}

/**
 * A primeira janela que a aula pretendida atropela — `null` quando cabe.
 *
 * Sobreposição de verdade (`inicio < fimDaOutra && fim > inicioDaOutra`), não
 * igualdade de início: aula de 45 min às 09:30 conflita com uma de 60 min às
 * 09:00, e o índice de igualdade do banco sozinho não pegaria isso (é para
 * isso que existe a constraint de EXCLUSÃO ao lado dele).
 */
export function conflitoDe(
  janelas: JanelaOcupada[],
  professoraId: string,
  weekday: number,
  inicio: number,
  duracao: number,
): JanelaOcupada | null {
  if (duracao <= 0) return null
  const minhas = janelas.filter((j) => j.professoraId === professoraId)
  for (const pedaco of pedacosDaAula(weekday, inicio, duracao)) {
    const bate = minhas.find(
      (j) => j.weekday === pedaco.weekday && pedaco.inicio < j.fim && pedaco.fim > j.inicio,
    )
    if (bate) return bate
  }
  return null
}
