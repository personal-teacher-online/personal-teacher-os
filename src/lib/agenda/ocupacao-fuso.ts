// A FRONTEIRA DA LEI 1 DA ANTECIPAÇÃO DE AGENDA (E3b da revisão nº 7, refeita
// no P9 da revisão nº 8).
//
// Aqui, e só aqui, a agenda das professoras é traduzida para o relógio do aluno
// NOVO. `./ocupacao` continua sendo aritmética pura de minutos dentro de um
// fuso só (e por isso continua importável pelo componente cliente, sem Luxon no
// bundle); este arquivo é a camada de cima, que roda no servidor.
//
// O QUE MUDOU NO P9, e por quê. A versão anterior EXPANDIA o horário fixo aqui:
// pegava `recurring_slots` e caminhava 8 ocorrências em Luxon, uma por semana,
// convertendo cada data civil. Três defeitos, todos do mesmo tipo — duas
// verdades sobre o mesmo fato:
//   (a) a expansão em Luxon podia divergir do `(date + local_time) at time zone
//       tz` do banco em hora AMBÍGUA ou INEXISTENTE (o dia em que o relógio
//       local pula ou repete): Luxon escolhe uma das duas leituras, o Postgres
//       escolhe a dele, e a tela passava a falar de um instante que a agenda
//       não tem;
//   (b) o laço de 8 ocorrências não era o horizonte do materializador, que é
//       "todo dia até hoje + 56, INCLUSIVE" — a 9ª ocorrência que o banco cria
//       quando o dia da semana cai bem no limite ficava invisível;
//   (c) a consulta ignorava a VIGÊNCIA do slot (`active_from`/`active_to`), e
//       um horário que só começa mês que vem já pintava a grade de ocupado —
//       enquanto o que fecha semana que vem pintava para sempre.
//
// A CORREÇÃO é parar de expandir. A verdade da agenda são as `class_instances`
// JÁ MATERIALIZADAS: foi o Postgres que as criou, com o offset daquele dia
// (Lei 1), respeitando vigência, e é sobre elas que a exclusão GiST da
// professora decide. Elas também trazem de graça o que a expansão nunca teve —
// aula avulsa, remarcada, e o buraco deixado por uma aula cancelada.
//
// O QUE SE PERDEU — e o que o R3 da revisão nº 9 DEVOLVEU. A perda declarada
// aqui era: "horário fixo sem instância materializada não aparece na grade,
// porque quem julga o conflito é a exclusão GiST, que também só enxerga
// instância". Isso vale para a `active_from` distante — e continua valendo.
// Mas havia um caso em que a mesma frase mentia: o CONTRATO PAUSADO.
// `materialize_slot` só cria instância de contrato ATIVO, então uma pausa de
// três meses apaga o horário da grade inteira — e a admissão nova ficava com o
// horário de quem só está parado, para descobrir na retomada que ele não cabe
// mais. Ali a ausência de instância não é "não é conflito"; é "o banco ainda
// não teve chance de dizer que é". Por isso, e SÓ para contrato pausado, este
// arquivo volta a expandir `recurring_slots` em Luxon
// (`janelasDoSlotPausado`) — não há instância para ler, e a alternativa é
// mentir. Quem recusa de verdade continua sendo o Postgres: `create_slot` agora
// confere a sobreposição contra os slots vigentes de contratos pausados (Lei 3);
// isto aqui é a tela dizendo antes o que o banco diria depois.
//
// E o RECURSO DA FAIXA continua: quando as
// ocorrências do mesmo horário fixo caem em horas locais diferentes ao longo do
// horizonte (DST em zonas com calendários distintos — Cuiabá não muda nunca,
// Nova York volta a EST em 01/11/2026, Lisboa a WET em 25/10), TODAS entram
// como janela ocupada e o rótulo mostra as duas com a nota curta.

import { DateTime } from 'luxon'

import { hhmmDeMinutos, pedacosDaAula, type JanelaOcupada } from './ocupacao'

/** Mesmo horizonte de `materialize_slot(_, 8)`: o que o banco de fato cria. */
export const SEMANAS_DE_ANTECIPACAO = 8

/**
 * Fim do horizonte de leitura, com UM DIA de folga sobre as 8 semanas.
 *
 * O materializador conta em DATA CIVIL na zona do slot ("todo dia até hoje + 56,
 * inclusive"); um corte em UTC de exatamente 56 dias decepa a última ocorrência
 * quando o fuso do slot está à frente do UTC. Ler um dia a mais é conservador —
 * antecipar ocupação a mais atrapalha; a menos, mente.
 */
export function fimDaAntecipacao(agora: DateTime): DateTime {
  return agora.plus({ weeks: SEMANAS_DE_ANTECIPACAO, days: 1 })
}

/** Uma aula que o banco JÁ materializou — o insumo desta camada. */
export interface AulaMaterializada {
  teacher_id: string
  contract_id: string
  /** `null` = avulsa ou remarcada (a remarcação nasce destacada do slot) */
  slot_id: string | null
  starts_at_utc: string
  ends_at_utc: string
}

export interface AulaParaConverter {
  teacher_id: string
  starts_at_utc: string
  ends_at_utc: string
}

/** Uma hora local possível, no relógio do aluno novo. */
interface Variante {
  weekday: number
  inicio: number
}

function faixaDe(v: Variante, duracao: number): string {
  return `${hhmmDeMinutos(v.inicio)}–${hhmmDeMinutos(v.inicio + duracao)}`
}

/** A aula no relógio do aluno: dia da semana, minuto de início e duração. */
function noRelogioDoAluno(
  aula: AulaParaConverter,
  alunoTz: string,
): { weekday: number; inicio: number; duracao: number; comeco: DateTime } | null {
  const comeco = DateTime.fromISO(aula.starts_at_utc, { zone: 'utc' }).setZone(alunoTz)
  const fim = DateTime.fromISO(aula.ends_at_utc, { zone: 'utc' }).setZone(alunoTz)
  if (!comeco.isValid || !fim.isValid) return null
  const duracao = Math.round(fim.diff(comeco, 'minutes').minutes)
  if (duracao <= 0) return null
  // Luxon conta a semana de 1 (segunda) a 7 (domingo); a grade, de 0 (domingo).
  return { weekday: comeco.weekday % 7, inicio: comeco.hour * 60 + comeco.minute, duracao, comeco }
}

/**
 * O HORÁRIO FIXO de outra aluna, dito no relógio do aluno novo — em todas as
 * horas locais que as ocorrências JÁ MATERIALIZADAS assumem no horizonte.
 *
 * Recebe as instâncias de UM slot (é quem chama que agrupa) porque é o conjunto
 * delas que revela a variação de DST: uma só nunca contaria essa história.
 */
export function janelasDoHorarioFixo(
  aulas: AulaMaterializada[],
  alunoTz: string,
  quem: string,
): JanelaOcupada[] {
  if (aulas.length === 0) return []

  // Chave = a hora local resultante. Slot sem DST no meio devolve UMA variante;
  // com DST no meio, duas.
  const variantes = new Map<string, Variante>()
  let duracao = 0
  let professoraId = aulas[0].teacher_id
  for (const aula of aulas) {
    const q = noRelogioDoAluno(aula, alunoTz)
    if (!q) continue
    duracao = Math.max(duracao, q.duracao)
    professoraId = aula.teacher_id
    variantes.set(`${q.weekday}:${q.inicio}`, { weekday: q.weekday, inicio: q.inicio })
  }

  const lista = [...variantes.values()].sort(
    (a, b) => a.weekday - b.weekday || a.inicio - b.inicio,
  )
  if (lista.length === 0 || duracao <= 0) return []
  const texto =
    lista.length === 1
      ? faixaDe(lista[0], duracao)
      : `${lista.map((v) => faixaDe(v, duracao)).join(' ou ')} (muda com o horário de verão)`

  return lista.flatMap((v) =>
    pedacosDaAula(v.weekday, v.inicio, duracao).map((p) => ({
      professoraId,
      weekday: p.weekday,
      inicio: p.inicio,
      fim: p.fim,
      quem,
      texto,
      // M4-2: de qual horário fixo veio esta janela (todas as aulas do grupo são
      // do mesmo slot — é assim que `janelasDaAgenda` as junta).
      slotId: aulas[0].slot_id,
    })),
  )
}

/**
 * Uma aula AVULSA ou REMARCADA (instância sem slot) no relógio do aluno novo.
 *
 * Ela não se repete, mas ocupa a professora naquele dia — e a tela do wizard é
 * uma grade semanal, então ela entra como janela daquele dia da semana com a
 * DATA dita no rótulo, para ninguém confundir com horário fixo. O banco segue
 * sendo o juiz (a exclusão GiST não distingue avulsa de fixa); isto é
 * antecipação melhor, não regra nova.
 */
export function janelasDaAula(
  aula: AulaParaConverter,
  alunoTz: string,
  quem: string,
): JanelaOcupada[] {
  const q = noRelogioDoAluno(aula, alunoTz)
  if (!q) return []

  const texto = `${hhmmDeMinutos(q.inicio)}–${hhmmDeMinutos(q.inicio + q.duracao)}`
  const rotulo = `${quem} · aula avulsa em ${q.comeco.toFormat('dd/LL')}`
  return pedacosDaAula(q.weekday, q.inicio, q.duracao).map((p) => ({
    professoraId: aula.teacher_id,
    weekday: p.weekday,
    inicio: p.inicio,
    fim: p.fim,
    quem: rotulo,
    texto,
    // Aula avulsa/remarcada não pertence a horário fixo nenhum: trocar um slot
    // não a cancela, então ela continua ocupando a professora.
    slotId: null,
  }))
}

/** O rótulo do horário preso a um contrato em pausa (R3 · revisão nº 9). */
export const QUEM_PAUSADO = 'reservado — contrato em pausa'

/** Um horário fixo VIGENTE de contrato PAUSADO — que, por não ter contrato
 *  ativo, não tem nenhuma `class_instance` futura para ser lida. */
export interface SlotPausado {
  id: string
  teacher_id: string
  contract_id: string
  /** 0 = domingo (mesma convenção de `extract(dow)` e de `recurring_slots`) */
  weekday: number
  /** 'HH:MM' ou 'HH:MM:SS' — hora LOCAL na zona do próprio slot */
  local_time: string
  iana_tz: string
  duration_min: number
  active_from: string
  active_to: string | null
}

/**
 * As ocorrências que o materializador CRIARIA se o contrato estivesse ativo.
 *
 * É a mesma varredura de `materialize_slot`: a partir de hoje na zona DO SLOT,
 * de 7 em 7 dias até o fim do horizonte, respeitando a vigência e descartando o
 * que já passou. A conversão de cada dia usa o offset DAQUELE dia
 * (`DateTime.fromObject({ zone })`, Lei 1) — nunca um offset fixo.
 *
 * A ressalva honesta: em hora local AMBÍGUA ou INEXISTENTE, Luxon e Postgres
 * podem escolher leituras diferentes. É a razão de o P9 ter matado a expansão
 * para contrato ATIVO — lá existe a instância do banco, que é a verdade. Aqui
 * não existe instância nenhuma, então a escolha é entre uma antecipação com
 * erro de uma hora em um dia por ano e nenhuma antecipação. Quem decide o
 * conflito continua sendo o banco (`create_slot`).
 */
export function ocorrenciasDoSlotPausado(
  slot: SlotPausado,
  agora: DateTime,
  ate: DateTime,
): AulaMaterializada[] {
  const [hora, minuto] = slot.local_time.split(':').map(Number)
  if (!Number.isFinite(hora) || !Number.isFinite(minuto)) return []

  const hoje = agora.setZone(slot.iana_tz).startOf('day')
  if (!hoje.isValid) return []
  const fim = ate.setZone(slot.iana_tz)
  let dia = hoje.plus({ days: (slot.weekday - (hoje.weekday % 7) + 7) % 7 })

  const saida: AulaMaterializada[] = []
  // TRAVA DE SANIDADE, e ela precisa caber no horizonte de quem chama: desde o
  // c12 · nº 7 o pausado é lido por 365 dias (é a janela que
  // `_assert_no_paused_overlap` compara no banco), o que dá 53 ocorrências
  // semanais. 60 é isso com folga, e continua sendo um teto — nunca a régua.
  for (let i = 0; i < 60 && dia <= fim; i++, dia = dia.plus({ days: 7 })) {
    const data = dia.toISODate()
    if (!data) continue
    if (data < slot.active_from) continue
    if (slot.active_to && data > slot.active_to) continue
    const inicio = dia.set({ hour: hora, minute: minuto, second: 0, millisecond: 0 })
    if (!inicio.isValid || inicio <= agora) continue
    saida.push({
      teacher_id: slot.teacher_id,
      contract_id: slot.contract_id,
      slot_id: slot.id,
      starts_at_utc: inicio.toUTC().toISO()!,
      ends_at_utc: inicio.plus({ minutes: slot.duration_min }).toUTC().toISO()!,
    })
  }
  return saida
}

/** O horário de um contrato PAUSADO como janela ocupada, no relógio do aluno
 *  novo — com a mesma faixa de DST que os horários fixos ativos ganham. */
export function janelasDoSlotPausado(
  slot: SlotPausado,
  alunoTz: string,
  agora: DateTime,
  ate: DateTime,
): JanelaOcupada[] {
  return janelasDoHorarioFixo(ocorrenciasDoSlotPausado(slot, agora, ate), alunoTz, QUEM_PAUSADO)
}

/**
 * A AGENDA INTEIRA no relógio do aluno novo.
 *
 * Aula com `slot_id` é horário fixo e vai agrupada por slot (é o agrupamento que
 * faz a faixa de DST aparecer); aula sem slot é avulsa/remarcada e vale por si,
 * com a data no rótulo.
 */
export function janelasDaAgenda(
  aulas: AulaMaterializada[],
  alunoTz: string,
  quemDe: (contratoId: string) => string,
): JanelaOcupada[] {
  const porSlot = new Map<string, AulaMaterializada[]>()
  const soltas: AulaMaterializada[] = []
  for (const aula of aulas) {
    if (aula.slot_id) {
      const atual = porSlot.get(aula.slot_id)
      if (atual) atual.push(aula)
      else porSlot.set(aula.slot_id, [aula])
    } else {
      soltas.push(aula)
    }
  }

  return [
    ...[...porSlot.values()].flatMap((doSlot) =>
      janelasDoHorarioFixo(doSlot, alunoTz, quemDe(doSlot[0].contract_id)),
    ),
    ...soltas.flatMap((a) => janelasDaAula(a, alunoTz, quemDe(a.contract_id))),
  ]
}
