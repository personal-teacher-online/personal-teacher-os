// A LEITURA DA AGENDA JÁ OCUPADA DA PROFESSORA (M3-c4 · B5, revista no E3b da
// revisão nº 7 e refeita no P9 da nº 8).
//
// Mora fora de `alunos.ts` pelo mesmo motivo de `ficha-consultas.ts`: aquele
// arquivo é `server-only` e monta o cliente Supabase a partir dos cookies do
// request — não dá para chamá-lo no Vitest sem inventar harness. Aqui o cliente
// e o relógio entram por parâmetro, então o teste executa ESTA função contra o
// banco local e prova o resultado, em vez de provar por grep.
//
// Zero regra de negócio (Lei 3): quem recusa horário sobreposto é a exclusão
// GiST `class_instances_teacher_no_overlap_excl`. Isto é antecipação — a tela
// dizendo antes o que o banco diria depois.
//
// P9 — UMA FONTE, e é a do banco: as `class_instances` JÁ MATERIALIZADAS no
// horizonte. Antes eram duas leituras com regras próprias (os `recurring_slots`
// expandidos em Luxon aqui + as avulsas), e a expansão discordava do banco em
// três pontos: hora ambígua/inexistente de DST, o limite exato do horizonte de
// 56 dias e a VIGÊNCIA do slot (`active_from`/`active_to`), que a consulta nem
// olhava — horário que só começa mês que vem já pintava a grade de ocupado.
// A instância materializada resolve os três de graça: foi o Postgres que a
// criou, com o offset daquele dia, dentro da vigência.
//
// R3 (revisão nº 9) — A EXCEÇÃO, e só ela: o CONTRATO PAUSADO. `materialize_slot`
// exige contrato ATIVO, então um contrato em pausa não tem instância futura
// NENHUMA e sumia da grade inteira — a admissão nova ficava com o horário de
// quem só está parado. Ali não há duas verdades disputando (o defeito que o P9
// veio matar): há UMA fonte possível, o `recurring_slots`. Então esta leitura
// volta a expandir — exclusivamente para contrato `status = 'paused'`, com
// rótulo próprio, e nunca para contrato ativo, onde a instância continua sendo
// a verdade.

import { DateTime } from 'luxon'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { JanelaOcupada } from '@/lib/agenda/ocupacao'
import {
  fimDaAntecipacao,
  janelasDaAgenda,
  janelasDoSlotPausado,
  type AulaMaterializada,
  type SlotPausado,
} from '@/lib/agenda/ocupacao-fuso'

function exigir<T>(leitura: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Agenda: falha ao ler ${leitura}: ${r.error.message}`)
  return r.data
}

/**
 * Quanto a antecipação enxerga do horário PAUSADO (c12 · nº 7).
 *
 * As duas leituras desta função tinham o mesmo horizonte — as 8 semanas de
 * `fimDaAntecipacao` —, e para a aula materializada isso é EXATO: 8 semanas é
 * tudo o que o banco criou. Para o pausado, não: o gate do banco
 * (`_assert_no_paused_overlap`, migration 20260727000900) compara DOZE MESES de
 * vigência comum. A tela mostrava a agenda livre para um horário que o
 * `create_slot` ia recusar — e o defeito só aparecia depois de a pessoa
 * preencher o formulário inteiro. Os dois números passam a ser o mesmo.
 *
 * O CUSTO, dito em voz alta: isto é expansão em Luxon, EM MEMÓRIA, e ela cresce
 * com o horizonte. Cada horário fixo pausado vira até 53 ocorrências semanais
 * (eram 9), e cada ocorrência vira uma janela na lista que a tela compara. Na
 * escala-alvo — 5 professoras, e contrato pausado é evento raro (a escola tem
 * zero ou um por vez) — são algumas dezenas de objetos por leitura, contra as
 * centenas de aulas materializadas que a mesma função já carrega. Não há
 * consulta a mais no banco: a leitura de `recurring_slots` é a mesma linha; o
 * que mudou foi quantas datas se calculam a partir dela. Se um dia a escola
 * tiver dezenas de contratos parados ao mesmo tempo, o caminho é agrupar por
 * horário fixo (a janela é a MESMA todo mês) — não encurtar o horizonte, que é
 * o que faria a tela voltar a mentir.
 */
export const DIAS_DE_PAUSA = 365

const AulaOcupadaSchema = z.object({
  contract_id: z.string(),
  teacher_id: z.string(),
  slot_id: z.string().nullable(),
  starts_at_utc: z.string(),
  ends_at_utc: z.string(),
})

/**
 * As aulas que ocupam a agenda das professoras no horizonte.
 *
 * `scheduled` e no futuro: aula cancelada libera a professora (a exclusão GiST
 * do banco só olha `scheduled`/`completed`), e aula que já passou não disputa
 * horário nenhum.
 *
 * `contratoIds` é OPCIONAL e existe para o teste: sem ele a leitura é a escola
 * inteira (que é o que a tela precisa); com ele, o teste recorta o próprio
 * contrato e não depende do tamanho da bancada compartilhada.
 */
export async function lerAulasDaAgenda(
  supabase: SupabaseClient,
  agora: DateTime,
  ate: DateTime,
  contratoIds?: string[],
  professoraId?: string,
): Promise<AulaMaterializada[]> {
  if (contratoIds && contratoIds.length === 0) return []
  let q = supabase
    .from('class_instances')
    .select('contract_id, teacher_id, slot_id, starts_at_utc, ends_at_utc')
    .eq('state', 'scheduled')
    .gte('starts_at_utc', agora.toUTC().toISO())
    .lte('starts_at_utc', ate.toUTC().toISO())
  if (contratoIds) q = q.in('contract_id', contratoIds)
  if (professoraId) q = q.eq('teacher_id', professoraId)
  const r = await q
  return z.array(AulaOcupadaSchema).parse(exigir('as aulas da agenda', r) ?? [])
}

const SlotPausadoSchema = z.object({
  id: z.string(),
  teacher_id: z.string(),
  contract_id: z.string(),
  weekday: z.number(),
  local_time: z.string(),
  iana_tz: z.string(),
  duration_min: z.number(),
  active_from: z.string(),
  active_to: z.string().nullable(),
})

/**
 * Os horários fixos VIGENTES de contratos PAUSADOS (R3 · revisão nº 9).
 *
 * A ÚNICA exceção ao P9 ("a verdade da agenda são as instâncias materializadas"),
 * e ela existe porque o caso é justamente o de NÃO haver instância:
 * `materialize_slot` só cria aula de contrato ATIVO, então um contrato pausado
 * some da grade inteira e a admissão nova fica com o horário de quem só está
 * parado. O motivo original de matar a expansão (duas verdades sobre o mesmo
 * fato) não se aplica onde só existe uma fonte possível.
 *
 * DUAS CONSULTAS RASAS, como o resto do arquivo: primeiro os contratos pausados,
 * depois os slots deles. A vigência é filtrada aqui (`active_to` no futuro ou
 * nulo); o resto — dia, hora e fuso do dia específico — é da camada de cima.
 */
export async function lerSlotsPausados(
  supabase: SupabaseClient,
  hoje: string,
  contratoIds?: string[],
  professoraId?: string,
): Promise<SlotPausado[]> {
  if (contratoIds && contratoIds.length === 0) return []
  let qc = supabase.from('contracts').select('id').eq('status', 'paused')
  if (contratoIds) qc = qc.in('id', contratoIds)
  if (professoraId) qc = qc.eq('teacher_id', professoraId)
  const pausados = (exigir('os contratos pausados', await qc) ?? []) as { id: string }[]
  if (pausados.length === 0) return []

  let rq = supabase
    .from('recurring_slots')
    .select('id, teacher_id, contract_id, weekday, local_time, iana_tz, duration_min, active_from, active_to')
    .in('contract_id', pausados.map((c) => c.id))
    .or(`active_to.is.null,active_to.gte.${hoje}`)
  if (professoraId) rq = rq.eq('teacher_id', professoraId)
  const r = await rq
  return z.array(SlotPausadoSchema).parse(exigir('os horários fixos em pausa', r) ?? [])
}

/**
 * O que as professoras já têm marcado, no relógio do aluno novo.
 *
 * DUAS CONSULTAS RASAS, e não um join aninhado: o nome do aluno está a dois
 * saltos da aula (`class_instances` → `contracts` → `students`), e a mesma
 * tabela também alcança `student_groups`. Pedir isso numa expressão só do
 * PostgREST devolve relação embutida com forma variável (objeto ou lista,
 * conforme a inferência da FK) e ambiguidade na primeira vez que alguém mexer
 * no schema. Nesta escala (dezenas de aulas por semana) leituras curtas e
 * inteiramente tipadas custam menos do que uma consulta frágil.
 *
 * O nome é um RÓTULO, não um filtro: contrato que a leitura de nomes não
 * alcança (mentoria, encerrado com aula remanescente) continua ocupando a
 * professora e aparece como "outro contrato". Ocupação some da grade só quando
 * some da agenda.
 */
export async function lerOcupacao(
  supabase: SupabaseClient,
  alunoTz: string,
  agora: DateTime = DateTime.now(),
  /**
   * M4-2 — recorte por PROFESSORA.
   *
   * O wizard de admissão deixa escolher qualquer professora, então lá a leitura
   * é a escola inteira. O detalhe do contrato, não: ele só pergunta pela
   * professora DAQUELE contrato (é o único `professoraId` que a tela compara).
   * Pedir a escola toda para responder por uma pessoa é ler dezenas de vezes
   * mais linhas do que se usa — e, numa base grande, a lista de ids da segunda
   * consulta chega a estourar o limite de tamanho da URL do PostgREST.
   */
  opcoes: { professoraId?: string } = {},
): Promise<JanelaOcupada[]> {
  const ate = fimDaAntecipacao(agora)
  const aulas = await lerAulasDaAgenda(supabase, agora, ate, undefined, opcoes.professoraId)

  // R3: o horário preso a um contrato em PAUSA não tem instância nenhuma para
  // ser lida — entra pela expansão, e com rótulo próprio (o nome do aluno
  // pausado não é assunto de quem está sendo admitido).
  //
  // c12 · nº 7: e o horizonte DELE é o do banco (365 dias), não o das 8 semanas
  // materializadas — ver `DIAS_DE_PAUSA` no topo do arquivo.
  const atePausa = agora.plus({ days: DIAS_DE_PAUSA })
  const emPausa = (
    await lerSlotsPausados(supabase, agora.toISODate() ?? '1970-01-01', undefined, opcoes.professoraId)
  ).flatMap((s) => janelasDoSlotPausado(s, alunoTz, agora, atePausa))

  if (aulas.length === 0) return emPausa

  const contratosRes = await supabase
    .from('contracts')
    .select('id, student_id')
    .in('id', [...new Set(aulas.map((a) => a.contract_id))])
  const contratos = (exigir('os contratos em agenda', contratosRes) ?? []) as {
    id: string
    student_id: string | null
  }[]

  const alunosRes = await supabase
    .from('students')
    .select('id, display_name')
    .in(
      'id',
      contratos.map((c) => c.student_id).filter((id): id is string => Boolean(id)),
    )
  const nomeDoAluno = new Map(
    ((exigir('os nomes em agenda', alunosRes) ?? []) as { id: string; display_name: string }[]).map(
      (a) => [a.id, a.display_name],
    ),
  )
  const nomeDoContrato = new Map(
    contratos.map((c) => [c.id, (c.student_id && nomeDoAluno.get(c.student_id)) || 'outro contrato']),
  )
  const quemDe = (contratoId: string) => nomeDoContrato.get(contratoId) ?? 'outro contrato'

  return [...janelasDaAgenda(aulas, alunoTz, quemDe), ...emPausa]
}
