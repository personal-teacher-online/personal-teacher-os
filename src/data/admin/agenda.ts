import 'server-only'

// CAMADA DE DADOS DA AGENDA (Onda da Agenda · A1) — leitura da seção inteira.
//
// Segue o contrato de `home.ts`:
// · UMA função tipada por leitura de tela; a página não faz query inline.
// · O que vem do banco passa por Zod (é `unknown` até provar o contrário).
// · **FALHA NUNCA VIRA ESTADO VAZIO.** Era a dívida desta seção: cinco pontos
//   descartavam o `error` do PostgREST (`agenda/page.tsx:211`,
//   `periodo/page.tsx:50`, `remarcar/[instance]/page.tsx:36` e dois em
//   `agenda/actions.ts`). Numa agenda isso é pior do que num KPI: um erro de
//   rede desenhava "Nenhuma aula" e a dona lia o dia da escola como VAZIO.
//   Agora estoura e acende `src/app/admin/error.tsx`.
// · `server-only`: importar isto de um componente cliente quebra o build.
// · Zero regra de negócio (Lei 3). Crédito, alçada, aviso mínimo e conflito
//   continuam sendo decididos pelas funções do Postgres; aqui só se lê.
//
// LEI 1 — o cliente não formata data. Tudo que a tela mostra como texto de
// tempo sai daqui pronto, calculado com Luxon no fuso certo: a grade do admin
// exibe em `BUSINESS_TZ`, e a hora do ALUNO viaja como texto auxiliar quando o
// fuso dele difere. O que atravessa para o componente em ISO é só o instante
// UTC, para `datetime=` e para o posicionamento na grade.

import { DateTime } from 'luxon'
import { z } from 'zod'

import { expandirJanelasSemanais } from '@/lib/agenda/janelas-semanais'
import { BUSINESS_TZ } from '@/lib/brand/constants'
import { one } from '@/lib/embed'
import { fmtStudentLocal, tzLabel } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import type { Instante } from '@/components/kit/instant'
import type { SituacaoDaAula } from './home'

/** Igual ao de `home.ts`, com o nome da seção no texto (é ele que chega ao log). */
function exigir<T>(leitura: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Agenda: falha ao ler ${leitura}: ${r.error.message}`)
  return r.data
}

/* ========================================================================== */
/* Vocabulário                                                                 */
/* ========================================================================== */

// O vocabulário de VISÃO mora no módulo puro (`agenda-endereco.ts`) — ver o
// cabeçalho de lá. Aqui ele é só re-exportado para quem já lê a agenda por este
// arquivo não precisar conhecer os dois endereços.
export {
  VISOES,
  VISAO_ROTULO,
  ehVisaoDaGrade,
  type VisaoDaGrade,
  type VisaoDaAgenda,
} from './agenda-endereco'
import type { VisaoDaAgenda } from './agenda-endereco'

export interface ProfessoraDaAgenda {
  id: string
  nome: string
  /** índice estável da cor (EIXO 1: cor é sempre da professora) */
  idx: number
  /** fuso operacional dela (F3-D2); sem registro cai no do negócio */
  tz: string
}

export interface AulaDaAgenda {
  id: string
  inicioUtc: string
  fimUtc: string | null
  situacao: SituacaoDaAula
  teacherId: string
  teacherNome: string | null
  teacherIdx: number
  quem: string
  studentId: string | null
  /** hora local do ALUNO, pronta — só quando o fuso dele difere do negócio */
  horaDoAluno: string | null
  /** F6/M8-3: informativo, nunca trava nada */
  confirmada: boolean
  /**
   * D2 — existe apontamento de conteúdo (`class_content_reports`) para esta
   * aula? É o que decide se ela PODE ser concluída: `complete_class` recusa
   * aula sem apontamento e o lote a PULA.
   *
   * Vem do EMBED da consulta (relação 1:1 — a PK de `class_content_reports` é a
   * FK para `class_instances`), nunca de uma consulta por aula: a fila de
   * pendências chega a dezenas de linhas e N+1 numa tela de agenda é latência
   * que a dona sente.
   */
  temApontamento: boolean
  /**
   * A5/L2 — o contrato desta aula, para o "duplicar" do popover.
   *
   * Vem do EMBED (a projeção de `contracts` cresceu), e não da coluna
   * `class_instances.contract_id`: a coluna é `not null`, mas isso não diz nada
   * sobre a linha ser LEGÍVEL por quem está olhando. `null` aqui significa
   * "não dá para duplicar a partir deste contrato", que é a resposta honesta.
   */
  contractId: string | null
  /**
   * A6/lote 2 — O QUE A TELA SABE SOBRE A ENTREGA DO AVISO DE CANCELAMENTO.
   *
   * `temLogin` = o aluno tem `students.profile_id`; `temWhatsapp` = o PERFIL
   * dele tem `whatsapp_e164`. São exatamente as duas condições que
   * `_enqueue_class_cancelled` usa: sem perfil a linha de e-mail nasce órfã
   * (`recipient_profile_id` NULL) e o WhatsApp nem nasce; com perfil sem
   * número, só o e-mail nasce. É com isto que as caixas do diálogo destrutivo
   * nascem espelhando a realidade, em vez de prometer aviso que não sai.
   *
   * `null` nos dois = AULA DE GRUPO: o enqueue percorre os MEMBROS e decide por
   * membro, e um par de caixas não espelha N cadastros. `null` é "esta tela não
   * sabe", nunca "não tem" (ver `canaisDoAviso`).
   *
   * Vem do MESMO embed que já traz o aluno (`students → profiles`), sem
   * consulta por aula: a fila de pendências tem dezenas de linhas.
   */
  temLogin: boolean | null
  temWhatsapp: boolean | null
  /**
   * F5 — A COBRANÇA DA AULA AVULSA (só `single_kind = 'extra_paid'`; cortesia e
   * experimental não têm seção de cobrança). O balão desenha, nesta ordem:
   * paga (`paidAt`) → cobrança espelhada (`cobranca.situacao`, régua do banco
   * via `payments_admin`) → botão "Cobrar no Asaas" (`pagadorPronto`, régua
   * ÚNICA `avulsa_pagador_pronto` — a action recusa pelo MESMO lugar) → texto
   * de pagador não pronto. A UI só antecipa; quem decide é o banco (Lei 3).
   */
  avulsa: {
    priceCents: number
    paidAt: string | null
    /** `cobravel=false` (cancelada/estornada no Asaas) reabre a emissão (Sol r2). */
    cobranca: { situacao: string; emAtraso: boolean; cobravel: boolean } | null
    pagadorPronto: boolean
    pagadorNome: string | null
  } | null
  instante: Instante
  /** "14:00" no fuso do negócio */
  hora: string
  /** só nas pendências: "hoje" · "ontem" · "há N dias" */
  atraso?: string
  /**
   * A7 — o mesmo atraso em NÚMERO de dias civis (fuso do negócio).
   *
   * Ele existe porque a fila precisa GRITAR proporcionalmente, e a tela não pode
   * decidir isso lendo de volta a frase: `"há 12 dias".match(/\d+/)` é o tipo de
   * parse que sobrevive até alguém trocar a palavra. A conta é uma só, feita
   * aqui, e a frase e o tom saem dela.
   */
  atrasoDias?: number
}

export interface JanelaDaAgenda {
  id: string
  inicioUtc: string
  teacherId: string
  teacherNome: string | null
  teacherIdx: number
  estado: 'publicada' | 'consumida'
  instante: Instante
}

export interface DiaDaLista {
  /** 'yyyy-LL-dd' no fuso do negócio */
  iso: string
  /** "segunda-feira, 27 de julho" */
  titulo: string
  aulas: AulaDaAgenda[]
}

export interface OpcaoDeContrato {
  id: string
  rotulo: string
  /**
   * O FUSO EM QUE `admin_create_single_class` VAI LER A DATA E A HORA — a mesma
   * escada da RPC (20260718000400): slot recorrente ATIVO do contrato primeiro,
   * o cadastro do aluno depois.
   *
   * Por que ele sobe até a tela (Sol · rodada 1 do A4, grave 3): sem isto, a
   * dona tocava 14:00 na grade (Cuiabá), escolhia um aluno de São Paulo e
   * confirmava — a RPC lia "14:00" no fuso DELE e a aula nascia às 13:00 do
   * ponto tocado, em silêncio. Agora escolher o contrato RECALCULA os campos
   * para o equivalente local, e a conversão é do dia específico (Lei 1).
   */
  ianaTz: string
  /** o mesmo fuso em vocabulário de gente ("São Paulo") — nunca IANA cru */
  cidade: string
}

/**
 * A3 — a camada de disponibilidade/bloqueios da professora FILTRADA.
 *
 * As listas (`janelas`/`bloqueios`) servem o painel de edição e vêm em
 * QUALQUER visão; os eventos expandidos (`eventosAvail`/`eventosBloqueio`)
 * só existem nas visões com grade de horas (dia|semana) — o MÊS não recebe
 * camada de fundo (decisão da rodada 2 do Sol no A2, registrada no goal).
 */
export interface DisponibilidadeDaProfessora {
  /** cabeçalho do painel: QUEM está sendo editada, com o fuso dela em CIDADE
   *  (vocabulário da casa — nunca IANA cru; Sol · rodada 1 do A3, item 6) */
  professora: { nome: string; cidade: string }
  /** painel: "segunda · 08:00–12:00" (+ sufixo de fuso quando difere do negócio) */
  janelas: { id: string; rotulo: string }[]
  /** painel: resumo humano do intervalo (nunca ISO cru) + a nota, se houver */
  bloqueios: { id: string; resumo: string; note: string | null }[]
  /** grade dia|semana: ocorrências expandidas na ZONA DA JANELA e depois
   *  RECORTADAS por dia civil de EXIBIÇÃO (BUSINESS_TZ), como os bloqueios —
   *  o motor da grade indexa evento pelo dia do início */
  eventosAvail: { id: string; inicioUtc: string; fimUtc: string }[]
  /** grade dia|semana: pedaços por dia civil de EXIBIÇÃO (BUSINESS_TZ) */
  eventosBloqueio: { id: string; inicioUtc: string; fimUtc: string; titulo: string }[]
}

export interface AgendaDoAdmin {
  visao: VisaoDaAgenda
  /** 'yyyy-LL-dd' da âncora, no fuso do negócio */
  ancora: string
  hojeISO: string
  /** o que a barra de tempo escreve ("julho 2026", "27/07 – 02/08", …) */
  rotulo: string
  /** âncoras do passo anterior/próximo; null nas visões sem passo */
  anterior: string | null
  proximo: string | null
  professoras: ProfessoraDaAgenda[]
  /** aulas dentro do intervalo visível */
  aulas: AulaDaAgenda[]
  janelas: JanelaDaAgenda[]
  /** aulas passadas ainda sem desfecho (olha 60 dias atrás, não só o visível) */
  pendencias: AulaDaAgenda[]
  /** visão lista: próximas agendadas agrupadas por dia */
  porDia: DiaDaLista[]
  /** opções do formulário de aula avulsa */
  contratos: OpcaoDeContrato[]
  /** intervalo visível, em UTC — a grade posiciona por ele */
  intervalo: { inicioUtc: string; fimUtc: string }
  /** A3: null sem filtro de professora (a camada e o painel usam a MESMA chave) */
  disponibilidade: DisponibilidadeDaProfessora | null
}

/* ========================================================================== */
/* Formas do banco                                                             */
/* ========================================================================== */

const ProfessoraSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable(),
  is_owner: z.boolean().nullable(),
  iana_tz: z.string().nullable(),
})

/**
 * O embed de contrato→aluno/grupo.
 *
 * SOL · achado 12: isto era `z.unknown()` com cast depois, e o cabeçalho deste
 * arquivo ainda assim prometia "o que vem do banco passa por Zod". Promessa
 * quebrada tem custo concreto: uma mudança de shape no embed atravessava a
 * validação inteira e só estourava lá na frente, em `r.quem.toLowerCase()`
 * dentro da busca da lista — longe da causa. Agora o formato é declarado.
 *
 * O PostgREST devolve embed como objeto OU array conforme a cardinalidade que
 * ele infere, então os dois são aceitos aqui e normalizados por `one()`.
 */
const AlunoDoEmbedSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable(),
  iana_tz: z.string().nullable(),
  // A6/lote 2: a projeção cresceu para o diálogo destrutivo saber se o aviso
  // TEM para onde ir (ver `temLogin`/`temWhatsapp` em `AulaDaAgenda`). O perfil
  // vem pelo embed do MESMO round-trip; `nullish` porque o PostgREST devolve o
  // embed de um `profile_id` nulo como `null`.
  profile_id: z.string().nullable().optional(),
  profiles: z
    .union([
      z.object({ whatsapp_e164: z.string().nullable() }),
      z.array(z.object({ whatsapp_e164: z.string().nullable() })),
    ])
    .nullable()
    .optional(),
})
const GrupoDoEmbedSchema = z.object({ label: z.string().nullable() })

const umOuMuitos = <T extends z.ZodTypeAny>(s: T) => z.union([s, z.array(s)]).nullable().optional()

const ContratoDoEmbedSchema = z
  .object({
    // A5/L2: a projeção cresceu para carregar o `contractId` da aula (ver o
    // campo em `AulaDaAgenda`). Schema por CONSULTA — este declara a projeção
    // do embed da consulta de AULAS, não a tabela `contracts`.
    id: z.string(),
    plan_name: z.string().nullable().optional(),
    students: umOuMuitos(AlunoDoEmbedSchema),
    student_groups: umOuMuitos(GrupoDoEmbedSchema),
  })
  .nullable()

/** Projeção do embed de apontamento: só a chave — a pergunta é "existe?". */
const ApontamentoDoEmbedSchema = z.object({ class_instance_id: z.string() })

const AulaSchema = z.object({
  id: z.string(),
  starts_at_utc: z.string(),
  ends_at_utc: z.string().nullable(),
  state: z.string(),
  teacher_id: z.string(),
  confirmed_at: z.string().nullable(),
  // F5: o trio da avulsa — decide se o balão mostra a seção de cobrança.
  single_kind: z.string().nullable(),
  single_price_cents: z.number().nullable(),
  single_paid_at: z.string().nullable(),
  contracts: umOuMuitos(ContratoDoEmbedSchema),
  class_content_reports: umOuMuitos(ApontamentoDoEmbedSchema),
})

const JanelaSchema = z.object({
  id: z.string(),
  teacher_id: z.string(),
  starts_at_utc: z.string(),
  state: z.string(),
})

// SOL · rodada 2, item 11 (grave): este schema reusava `AlunoDoEmbedSchema`,
// que exige `id` e `iana_tz` — mas a consulta de opções de contrato seleciona
// SÓ `display_name`. Com qualquer contrato particular ativo (ou seja: sempre,
// em produção), o Zod reprovava e a Agenda INTEIRA estourava ao abrir. O
// schema de cada consulta declara a PROJEÇÃO daquela consulta, não a tabela.
const AlunoDaOpcaoSchema = z.object({
  display_name: z.string().nullable(),
  // A4/grave 3: a projeção cresceu porque a TELA precisa saber em que fuso a
  // RPC vai ler a data e a hora da avulsa. Schema por CONSULTA (lição da rodada
  // 2 do A1): declarado aqui, não herdado de outra projeção.
  iana_tz: z.string().nullable(),
})
/** Slot recorrente do contrato — só o que decide o fuso e a vigência. */
const SlotDaOpcaoSchema = z.object({
  iana_tz: z.string().nullable(),
  active_from: z.string().nullable(),
  active_to: z.string().nullable(),
})
const ContratoSchema = z.object({
  id: z.string(),
  plan_name: z.string().nullable(),
  students: umOuMuitos(AlunoDaOpcaoSchema),
  student_groups: umOuMuitos(GrupoDoEmbedSchema),
  recurring_slots: z.array(SlotDaOpcaoSchema).nullable().optional(),
})

// A3 — as duas projeções da camada de disponibilidade. Schema por CONSULTA,
// nunca reaproveitado de outra projeção (lição da rodada 2 do A1, item 11: o
// schema que exigia campos que a consulta não seleciona estourava a tela toda).
/** A forma que o `time` do Postgres devolve. Linha malformada REPROVA o parse
 *  e a leitura ESTOURA (Sol · rodada 3 do A3): um `"xx"` caía num `continue`
 *  silencioso na expansão, contra a promessa do cabeçalho ("o que vem do
 *  banco passa por Zod") — fail-fast, coerente com "fuso inválido estoura" e
 *  "estado desconhecido estoura". A FRAÇÃO de segundo é opcional e LEGÍTIMA
 *  (Sol · rodada 4): as colunas `start_local`/`end_local` são `time` SEM
 *  precisão declarada (migration 20260718000700) — precisão de microssegundo —
 *  e o PostgREST devolve `"08:00:00.5"` quando o valor tem fração; rejeitá-la
 *  estourava a Agenda inteira por dado 100% válido do banco. */
const HoraLocalSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/)

const JanelaSemanalSchema = z.object({
  id: z.string(),
  /** convenção do BANCO: 0 = domingo (a mesma de `extract(dow)`) */
  weekday: z.number().int().min(0).max(6),
  /** 'HH:MM:SS' — hora LOCAL na zona da PRÓPRIA LINHA */
  start_local: HoraLocalSchema,
  end_local: HoraLocalSchema,
  iana_tz: z.string(),
})
type JanelaSemanal = z.infer<typeof JanelaSemanalSchema>

const BloqueioSchema = z.object({
  id: z.string(),
  starts_at_utc: z.string(),
  ends_at_utc: z.string(),
  /** escrito pela RPC `add_teacher_block`: "2026-08-01 → 2026-08-10 <tz>" */
  local_snapshot: z.string(),
  note: z.string().nullable(),
})
type Bloqueio = z.infer<typeof BloqueioSchema>

type ContratoDoEmbed = z.infer<typeof ContratoDoEmbedSchema>

/** Quem é a aula: aluno individual ou grupo. Já tipado (o embed foi validado). */
function quemDoContrato(contrato: ContratoDoEmbed | ContratoDoEmbed[] | null | undefined): {
  nome: string
  studentId: string | null
  tz: string | null
  contractId: string | null
  temLogin: boolean | null
  temWhatsapp: boolean | null
} {
  const c = one(contrato)
  const aluno = one(c?.students)
  const grupo = one(c?.student_groups)
  // Sem aluno individual no contrato (é grupo, ou o embed não é legível), a
  // resposta honesta é "não sei" — nunca `false`, que a tela leria como "este
  // aluno não tem login" e escreveria uma frase falsa sobre a vida de alguém.
  const perfil = one(aluno?.profiles)
  return {
    nome: aluno?.display_name ?? grupo?.label ?? '—',
    studentId: aluno?.id ?? null,
    tz: aluno?.iana_tz ?? null,
    contractId: c?.id ?? null,
    temLogin: aluno ? Boolean(aluno.profile_id) : null,
    temWhatsapp: aluno ? Boolean(perfil?.whatsapp_e164) : null,
  }
}

/**
 * Os seis estados que a tabela `class_instances` produz. Enumerados de
 * propósito: o `else` que devolvia 'cancelada' para qualquer coisa
 * desconhecida (Sol · achado 12) transformaria um estado NOVO do banco em
 * "cancelada" na tela da dona — degradação silenciosa, que a disciplina do
 * projeto proíbe. Estado que não conhecemos ESTOURA.
 */
const SITUACAO_POR_ESTADO: Record<string, SituacaoDaAula> = {
  scheduled: 'agendada', // sobrescrito abaixo quando a aula já terminou
  completed: 'realizada',
  no_show_student: 'falta_aluno',
  no_show_teacher: 'falta_professora',
  rescheduled: 'remarcada',
  cancelled: 'cancelada',
}

/**
 * `terminou`, não `passou` (Sol · achado 3, grave).
 *
 * Antes, uma aula virava "sem registro" no instante em que COMEÇAVA: às 14:01 a
 * aula das 14:00–14:45 já entrava na fila de pendências e oferecia os botões de
 * desfecho — com a professora ainda dando aula. A dona podia atestar realizada,
 * falta ou cancelamento antes do fim. Agora o corte é o FIM.
 */
function situacaoDe(state: string, terminou: boolean): SituacaoDaAula {
  const base = SITUACAO_POR_ESTADO[state]
  if (!base) throw new Error(`Agenda: estado de aula desconhecido no banco: "${state}"`)
  if (state === 'scheduled' && terminou) return 'sem_registro'
  return base
}

/** Fim da aula. Sem `ends_at_utc` registrado, a casa assume 45 min — a mesma
 *  suposição que a grade usa para desenhar o bloco. */
function fimDaAula(inicioUtc: string, fimUtc: string | null): DateTime {
  return fimUtc ? DateTime.fromISO(fimUtc) : DateTime.fromISO(inicioUtc).plus({ minutes: 45 })
}

/* ========================================================================== */
/* A3 — disponibilidade e bloqueios da professora                              */
/* ========================================================================== */

/** Dias da semana na convenção do BANCO (0 = domingo), pt-BR minúsculo. */
const DIA_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/** 'HH:MM:SS' do Postgres → 'HH:MM' de gente. */
const hhmm = (t: string) => t.slice(0, 5)

/** "segunda · 08:00–12:00", com o fuso dito SÓ quando difere do negócio —
 *  quando difere, a hora escrita NÃO é a hora da grade, e calar isso faria a
 *  dona ler 08:00 de Nova York como 08:00 de Cuiabá. O fuso sai no vocabulário
 *  de CIDADE da casa (`tzLabel`, o mesmo do CityPicker) — IANA cru numa frase
 *  para a dona é defeito, não detalhe (Sol · rodada 1 do A3, item 7). */
function rotuloDaJanela(w: JanelaSemanal): string {
  const fuso = w.iana_tz !== BUSINESS_TZ ? ` (fuso da professora: ${tzLabel(w.iana_tz)})` : ''
  return `${DIA_PT[w.weekday]} · ${hhmm(w.start_local)}–${hhmm(w.end_local)}${fuso}`
}

/**
 * O resumo humano do bloqueio, a partir do `local_snapshot` — que é a FONTE do
 * texto (a RPC gravou ali as datas civis que a admin digitou, na zona da
 * professora). ISO cru numa frase para a dona é defeito, não detalhe (lição do
 * A1); o snapshot é parseado e reescrito em dd/LL/yyyy.
 *
 * EXPORTADA desde a revisão independente do A4 (grave 2): a frase de recusa dos
 * porteiros de bloqueio (`agenda/actions.ts`) precisa NOMEAR o bloqueio sem
 * publicar a `note` — que é onde se escreve "consulta médica" — e duas grafias
 * do mesmo período seriam duas verdades. Por isso o parâmetro é ESTRUTURAL e
 * tolerante: a leitura da action seleciona só o que precisa, e linha sem
 * snapshot nem instantes devolve '' (quem chama omite o parêntese).
 */
export function resumoDoBloqueio(b: {
  local_snapshot?: string | null
  starts_at_utc?: string | null
  ends_at_utc?: string | null
}): string {
  const m = /^(\d{4}-\d{2}-\d{2}) → (\d{4}-\d{2}-\d{2}) (\S+)$/.exec(b.local_snapshot ?? '')
  if (m) {
    const [, de, ate, tz] = m
    const f = (iso: string) => DateTime.fromISO(iso).setLocale('pt-BR').toFormat('dd/LL/yyyy')
    const fuso = tz !== BUSINESS_TZ ? ` (fuso da professora: ${tzLabel(tz)})` : ''
    return de === ate ? `${f(de)}${fuso}` : `${f(de)} → ${f(ate)}${fuso}`
  }
  // Snapshot fora do formato conhecido (bloqueio nascido por outra porta):
  // formata os INSTANTES no fuso do negócio — nunca o ISO cru.
  if (!b.starts_at_utc || !b.ends_at_utc) return ''
  const f = (utc: string) =>
    DateTime.fromISO(utc).setZone(BUSINESS_TZ).setLocale('pt-BR').toFormat("dd/LL/yyyy 'às' HH:mm")
  return `${f(b.starts_at_utc)} → ${f(b.ends_at_utc)}`
}

/**
 * O bloqueio recortado POR DIA CIVIL DE EXIBIÇÃO (00:00–24:00 em BUSINESS_TZ,
 * interseção com o bloco e com o intervalo visível). O recorte é DAQUI, do
 * data layer: o motor da grade particiona evento pelo dia de INÍCIO, e um
 * bloco de férias de 7 dias sumiria de 6 deles se viajasse inteiro.
 */
function pedacosDosBloqueios(
  blocos: Bloqueio[],
  inicio: DateTime,
  fim: DateTime,
): DisponibilidadeDaProfessora['eventosBloqueio'] {
  const saida: DisponibilidadeDaProfessora['eventosBloqueio'] = []
  for (const b of blocos) {
    const comeca = DateTime.fromISO(b.starts_at_utc)
    const termina = DateTime.fromISO(b.ends_at_utc)
    const nota = b.note?.trim()
    const titulo = nota ? `bloqueada — ${nota}` : 'bloqueada'
    for (let dia = inicio; dia < fim; dia = dia.plus({ days: 1 })) {
      const a = DateTime.max(comeca, dia, inicio)
      const z = DateTime.min(termina, dia.plus({ days: 1 }), fim)
      if (a >= z) continue
      saida.push({
        id: `${b.id}:${dia.toISODate()}`,
        inicioUtc: a.toUTC().toISO()!,
        fimUtc: z.toUTC().toISO()!,
        titulo,
      })
    }
  }
  return saida
}

/* ========================================================================== */
/* A leitura                                                                   */
/* ========================================================================== */

export interface ParametrosDaAgenda {
  visao: VisaoDaAgenda
  /** 'yyyy-LL-dd' — inválida ou ausente cai em hoje */
  ancora?: string
  /** filtro de professora */
  professora?: string
  /** mostrar a camada de horários publicados */
  comJanelas: boolean
  /** busca por nome do aluno (visão lista) */
  busca?: string
}

export async function getAgenda(p: ParametrosDaAgenda): Promise<AgendaDoAdmin> {
  const supabase = await createClient()

  // Relógio por request é intencional: a agenda é uma janela MÓVEL sobre o
  // tempo, e a linha do "agora" precisa do instante desta renderização.
  const agora = DateTime.now().setZone(BUSINESS_TZ)
  const hojeISO = agora.toFormat('yyyy-LL-dd')
  // SOL · achado 13: o regex sozinho aceita data civil INEXISTENTE
  // (`2026-02-30`), que vira um DateTime inválido e sai como rótulo
  // "Invalid DateTime" com a grade vazia. O contrato desta função é "âncora
  // ruim cai em hoje" — quem decide isso é o Luxon, não o formato.
  const candidata =
    p.ancora && /^\d{4}-\d{2}-\d{2}$/.test(p.ancora)
      ? DateTime.fromISO(p.ancora, { zone: BUSINESS_TZ })
      : null
  const a = candidata?.isValid ? candidata : DateTime.fromISO(hojeISO, { zone: BUSINESS_TZ })
  const ancora = a.toFormat('yyyy-LL-dd')

  const gradeVisivel = p.visao === 'dia' || p.visao === 'semana' || p.visao === 'mes'

  // A semana começa na SEGUNDA (item 14.2) nas duas visões que a usam.
  //
  // CONVENÇÃO ÚNICA DE BORDA (Sol · achado 7): `fim` é sempre EXCLUSIVO —
  // meia-noite do primeiro dia de FORA. A tela velha misturava três convenções
  // (`plus(7)` exclusivo consultado com `lte`, e `endOf('day')` inclusivo), e a
  // aula de segunda 00:00 aparecia na semana anterior E na correta. Uma
  // convenção só, aplicada na consulta (`lt`) e no filtro.
  const intervalo = (() => {
    if (p.visao === 'mes') {
      const primeiro = a.startOf('month')
      const inicio = primeiro.minus({ days: primeiro.weekday - 1 })
      return { inicio, fim: inicio.plus({ days: 42 }) }
    }
    if (p.visao === 'semana') {
      const inicio = a.startOf('day').minus({ days: a.weekday - 1 })
      return { inicio, fim: inicio.plus({ days: 7 }) }
    }
    if (p.visao === 'dia') return { inicio: a.startOf('day'), fim: a.startOf('day').plus({ days: 1 }) }
    // Lista: "Próximos 14 dias" é o que a tela ESCREVE, então é o que a conta
    // precisa fazer — 14 dias civis a partir de hoje, fim exclusivo. O
    // `endOf('day')` de antes cobria 15 datas (achado 8).
    return { inicio: agora.startOf('day'), fim: agora.startOf('day').plus({ days: 14 }) }
  })()

  // A FILA DE PENDÊNCIAS TEM JANELA PRÓPRIA, fixa (Sol · achado 2, grave).
  // Antes ela herdava o início da grade: na semana atual a dona via "2
  // pendências"; navegando para janeiro, o mesmo contador virava 12; voltando,
  // 2 de novo. Um número que muda conforme para onde você está olhando não
  // serve para operar — e dívidas com mais de 60 dias sumiam do fluxo sem
  // ninguém decidir isso.
  const inicioDasPendencias = agora.minus({ days: 60 }).startOf('day')
  const desde = DateTime.min(intervalo.inicio, inicioDasPendencias).toUTC().toISO()!
  const ate = DateTime.max(intervalo.fim, agora).toUTC().toISO()!

  const [aulasRes, professorasRes, janelasRes, contratosRes, semanaisRes, bloqueiosRes] = await Promise.all([
    supabase
      .from('class_instances')
      .select(
        // `class_content_reports` entra no MESMO round-trip (embed 1:1): a tela
        // de pendências precisa saber, por aula, se há apontamento — sem ele a
        // aula não pode ser concluída e não entra no lote (ver `temApontamento`).
        // A6/lote 2: `profile_id` + `profiles(whatsapp_e164)` entram no MESMO
        // embed — é o que o diálogo destrutivo precisa para as caixas de aviso
        // nascerem espelhando a entrega real. O apelido do FK é obrigatório:
        // `students` tem DUAS chaves para `profiles` (`profile_id` e
        // `auth_cleanup_profile_id`, esta da anonimização retomável), e sem o
        // nome da constraint o PostgREST recusa o embed por ambiguidade — o que
        // derrubaria a Agenda inteira, não só a caixa.
        'id, starts_at_utc, ends_at_utc, state, teacher_id, confirmed_at, single_kind, single_price_cents, single_paid_at, contracts(id, plan_name, students!contracts_student_id_fkey(id, display_name, iana_tz, profile_id, profiles!students_profile_id_fkey(whatsapp_e164)), student_groups(label)), class_content_reports(class_instance_id)',
      )
      .gte('starts_at_utc', desde)
      .lt('starts_at_utc', ate) // fim EXCLUSIVO (convenção única — achado 7)
      .order('starts_at_utc'),
    supabase
      .from('teachers')
      .select('id, display_name, is_owner, iana_tz')
      .is('archived_at', null)
      .order('is_owner', { ascending: false })
      .order('display_name'),
    p.comJanelas && gradeVisivel
      ? supabase
          .from('reschedule_windows')
          .select('id, teacher_id, starts_at_utc, state')
          .gte('starts_at_utc', intervalo.inicio.toUTC().toISO()!)
          .lt('starts_at_utc', intervalo.fim.toUTC().toISO()!)
      : // Camada DESLIGADA (ou visão sem grade): a consulta não acontece, e
        // `[]` aqui significa "não perguntei", não "perguntei e não achei" —
        // por isso não é mentira de leitura (Sol confirmou o ponto).
        Promise.resolve({ data: [], error: null }),
    supabase
      .from('contracts')
      .select(
        'id, plan_name, students!contracts_student_id_fkey(display_name, iana_tz), student_groups(label), recurring_slots(iana_tz, active_from, active_to)',
      )
      .eq('contract_type', 'private_1on1')
      .eq('status', 'active')
      // A VIGÊNCIA É COMPARADA NO BANCO, com o literal `today` do Postgres —
      // ver `escadaDoSlotVigente` logo abaixo do `contratos`.
      .lte('recurring_slots.active_from', 'today')
      .or('active_to.is.null,active_to.gte.today', { referencedTable: 'recurring_slots' })
      .order('started_on', { ascending: false }),
    // A3 — a camada de disponibilidade tem a MESMA chave do painel que a
    // edita: o filtro de professora. Sem filtro, ninguém perguntou (o `[]`
    // significa "não perguntei", como na camada de janelas acima).
    p.professora
      ? supabase
          .from('teacher_weekly_availability')
          .select('id, weekday, start_local, end_local, iana_tz')
          .eq('teacher_id', p.professora)
      : Promise.resolve({ data: [], error: null }),
    // Só `kind='block'` e só o que ainda não terminou. `kind='open'` NÃO é
    // lido: está RESERVADO desde a F5 (o "abrir avulso" continua sendo a
    // janela publicada — comentário da própria migration 20260718000700).
    p.professora
      ? supabase
          .from('teacher_availability_exceptions')
          .select('id, starts_at_utc, ends_at_utc, local_snapshot, note')
          .eq('teacher_id', p.professora)
          .eq('kind', 'block')
          // fim EXCLUSIVO, a convenção única da seção (Sol · rodada 2 do A3):
          // no instante exato de `ends_at_utc` o bloqueio JÁ acabou — `gt`
          .gt('ends_at_utc', agora.toUTC().toISO()!)
          // ordem cronológica DO BANCO (Sol · rodada 1 do A3, item 8), com
          // desempate estável por id (rodada 2): dois bloqueios com o mesmo
          // início não podem trocar de rótulo visível entre leituras
          .order('starts_at_utc')
          .order('id')
      : Promise.resolve({ data: [], error: null }),
  ])

  const professorasCruas = ProfessoraSchema.array().parse(exigir('as professoras', professorasRes))
  const professoras: ProfessoraDaAgenda[] = professorasCruas
    .filter((t): t is typeof t & { display_name: string } => Boolean(t.display_name))
    .map((t, i) => ({ id: t.id, nome: t.display_name, idx: i, tz: t.iana_tz ?? BUSINESS_TZ }))
  const porId = new Map(professoras.map((t) => [t.id, t]))

  const instanteDe = (utc: string, tzDoAluno: string | null): Instante => {
    const t = DateTime.fromISO(utc).setZone(BUSINESS_TZ).setLocale('pt-BR')
    return {
      texto: t.toFormat("ccc, dd/LL 'às' HH:mm"),
      iso: utc,
      titulo:
        tzDoAluno && tzDoAluno !== BUSINESS_TZ
          ? `para o aluno: ${fmtStudentLocal(utc, tzDoAluno)}`
          : undefined,
    }
  }

  const agoraMs = agora.toMillis()
  const todas: AulaDaAgenda[] = AulaSchema.array()
    .parse(exigir('as aulas', aulasRes))
    .filter((i) => !p.professora || i.teacher_id === p.professora)
    .map((i) => {
      const quem = quemDoContrato(i.contracts)
      const prof = porId.get(i.teacher_id)
      // FIM, não início (achado 3): aula em andamento não é dívida.
      const terminou = fimDaAula(i.starts_at_utc, i.ends_at_utc).toMillis() <= agoraMs
      return {
        id: i.id,
        inicioUtc: i.starts_at_utc,
        fimUtc: i.ends_at_utc,
        situacao: situacaoDe(i.state, terminou),
        teacherId: i.teacher_id,
        teacherNome: prof?.nome ?? null,
        teacherIdx: prof?.idx ?? 0,
        quem: quem.nome,
        studentId: quem.studentId,
        horaDoAluno:
          quem.tz && quem.tz !== BUSINESS_TZ ? fmtStudentLocal(i.starts_at_utc, quem.tz) : null,
        confirmada: Boolean(i.confirmed_at),
        temApontamento: Boolean(one(i.class_content_reports)),
        contractId: quem.contractId,
        temLogin: quem.temLogin,
        temWhatsapp: quem.temWhatsapp,
        avulsa:
          i.single_kind === 'extra_paid' && i.single_price_cents != null
            ? {
                priceCents: i.single_price_cents,
                paidAt: i.single_paid_at,
                cobranca: null, // preenchido logo abaixo, em lote
                pagadorPronto: false,
                pagadorNome: null,
              }
            : null,
        instante: instanteDe(i.starts_at_utc, quem.tz),
        hora: DateTime.fromISO(i.starts_at_utc).setZone(BUSINESS_TZ).toFormat('HH:mm'),
      }
    })

  // F5 — a seção de cobrança das avulsas, em DOIS lotes (nunca N+1 sobre o dia
  // inteiro): o espelho sai de UMA consulta à `payments_admin`; o pagador
  // pronto é RPC por aula, mas SÓ para as extras ainda sem espelho e sem
  // quitação — no dia real são zero ou uma.
  const extras = todas.filter((a) => a.avulsa)
  if (extras.length > 0) {
    const { data: espelhos } = await supabase
      .from('payments_admin')
      .select('class_instance_id, situacao, em_atraso, nao_cobravel')
      .in('class_instance_id', extras.map((a) => a.id))
    // Uma aula PODE ter mais de um espelho (cobrança cancelada + a substituta
    // — Sol r2): a escolha é explícita, nunca "a última que o PostgREST
    // devolveu". Preferência: a ATIVA; duas ativas = anomalia ⇒ 'desconhecida'
    // (a pill manda conferir no painel).
    const espelhosPorAula = new Map<string, Array<{ situacao: string; em_atraso: boolean; nao_cobravel: boolean }>>()
    for (const e of espelhos ?? []) {
      const id = e.class_instance_id as string
      espelhosPorAula.set(id, [
        ...(espelhosPorAula.get(id) ?? []),
        {
          situacao: String(e.situacao ?? 'desconhecida'),
          em_atraso: Boolean(e.em_atraso),
          nao_cobravel: Boolean(e.nao_cobravel),
        },
      ])
    }
    await Promise.all(
      extras.map(async (a) => {
        const linhas = espelhosPorAula.get(a.id) ?? []
        const ativas = linhas.filter((e) => !e.nao_cobravel)
        const e = ativas[0] ?? linhas[0]
        if (e) {
          a.avulsa!.cobranca = {
            situacao: ativas.length > 1 ? 'desconhecida' : e.situacao,
            emAtraso: Boolean(e.em_atraso),
            cobravel: ativas.length > 0,
          }
        }
        // O pagador só interessa quando o formulário PODE nascer: sem cobrança
        // ATIVA, aula não paga e não cancelada (a mesma conta do balão).
        const podeEmitir = ativas.length === 0 && !a.avulsa!.paidAt && a.situacao !== 'cancelada'
        if (!podeEmitir) return
        const { data: pagador } = await supabase.rpc('avulsa_pagador_pronto', {
          p_class_instance: a.id,
        })
        const linha = Array.isArray(pagador) ? pagador[0] : null
        if (linha) {
          a.avulsa!.pagadorPronto = true
          a.avulsa!.pagadorNome = String(linha.payer_name ?? '')
        }
      }),
    )
  }

  // Dentro do intervalo VISÍVEL (a consulta trouxe mais do que a tela mostra).
  // Fim EXCLUSIVO, igual à consulta — a mesma convenção nos dois lugares.
  const inicioUtc = intervalo.inicio.toUTC()
  const fimUtc = intervalo.fim.toUTC()
  const aulas = todas.filter((r) => {
    const t = DateTime.fromISO(r.inicioUtc)
    return t >= inicioUtc && t < fimUtc
  })

  // A fila de dívida: a mais antiga grita primeiro. JANELA FIXA (achado 2) —
  // a fila não pode encolher ou crescer conforme o mês que a grade está
  // mostrando; ela responde sempre "o que continua sem desfecho nos últimos
  // 60 dias".
  const pendencias = todas
    .filter((r) => r.situacao === 'sem_registro')
    .filter((r) => DateTime.fromISO(r.inicioUtc) >= inicioDasPendencias)
    .sort((x, y) => x.inicioUtc.localeCompare(y.inicioUtc))
    .map((r) => {
      const t = DateTime.fromISO(r.inicioUtc).setZone(BUSINESS_TZ)
      const dias = Math.round(agora.startOf('day').diff(t.startOf('day'), 'days').days)
      return {
        ...r,
        atraso: dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`,
        atrasoDias: dias,
      }
    })

  const janelas: JanelaDaAgenda[] = JanelaSchema.array()
    .parse(exigir('os horários publicados', janelasRes))
    .filter((w) => !p.professora || w.teacher_id === p.professora)
    .filter((w) => w.state !== 'cancelada')
    .map((w) => {
      const prof = porId.get(w.teacher_id)
      return {
        id: w.id,
        inicioUtc: w.starts_at_utc,
        teacherId: w.teacher_id,
        teacherNome: prof?.nome ?? null,
        teacherIdx: prof?.idx ?? 0,
        estado: w.state === 'publicada' ? ('publicada' as const) : ('consumida' as const),
        instante: instanteDe(w.starts_at_utc, null),
      }
    })

  // A3 — a camada da professora filtrada. Listas em qualquer visão (o painel
  // edita de qualquer lugar); expansão só onde há grade de HORAS (dia|semana —
  // o mês não recebe camada de fundo, decisão da rodada 2 do Sol no A2).
  const expandir = p.visao === 'dia' || p.visao === 'semana'
  const disponibilidade: DisponibilidadeDaProfessora | null = p.professora
    ? (() => {
        const semanais = JanelaSemanalSchema.array().parse(
          exigir('a agenda semanal da professora', semanaisRes),
        )
        const blocos = BloqueioSchema.array().parse(
          exigir('os bloqueios da professora', bloqueiosRes),
        )
        const prof = porId.get(p.professora!)
        return {
          // QUEM está sendo editada (Sol · rodada 1 do A3, item 6): nome + fuso
          // em CIDADE — no celular o painel abria sem nenhum contexto na tela e
          // dava para remover a janela da professora errada.
          professora: {
            nome: prof?.nome ?? '—',
            cidade: tzLabel(prof?.tz ?? BUSINESS_TZ),
          },
          // ordem weekday→hora com a semana da casa começando na SEGUNDA
          // (item 14.2 — domingo, que no banco é 0, fecha a lista)
          janelas: [...semanais]
            .sort(
              (x, y) =>
                ((x.weekday + 6) % 7) - ((y.weekday + 6) % 7) ||
                x.start_local.localeCompare(y.start_local),
            )
            .map((w) => ({ id: w.id, rotulo: rotuloDaJanela(w) })),
          bloqueios: blocos.map((b) => ({ id: b.id, resumo: resumoDoBloqueio(b), note: b.note })),
          eventosAvail: expandir
            ? expandirJanelasSemanais(semanais, intervalo.inicio, intervalo.fim, BUSINESS_TZ)
            : [],
          eventosBloqueio: expandir
            ? pedacosDosBloqueios(blocos, intervalo.inicio, intervalo.fim)
            : [],
        }
      })()
    : null

  const contratos: OpcaoDeContrato[] = ContratoSchema.array()
    .parse(exigir('os contratos particulares', contratosRes))
    .map((c) => {
      const aluno = one(c.students)
      const nome = aluno?.display_name ?? one(c.student_groups)?.label ?? '—'
      // A MESMA ESCADA DA RPC (`admin_create_single_class`, 20260718000400):
      // slot recorrente ATIVO hoje primeiro (o mais recente, quando há mais de
      // um), cadastro do aluno depois. Espelhar a regra do banco na tela é o
      // permitido pela Lei 3 — antecipar para UX; quem decide continua sendo a
      // função, e se ela recusar a frase de erro é dela.
      //
      // …E O "HOJE" DA ESCADA NÃO EXISTE MAIS DO LADO DE CÁ (revisão
      // independente do A4, 29/07 — grave 3). Quem compara
      // `active_from`/`active_to` dentro da RPC é `current_date`, que vale no
      // `TimeZone` DA SESSÃO Postgres. A versão anterior espelhava isso com
      // um "dia do banco" calculado em NODE (o dia UTC do processo), o que só
      // está certo
      // enquanto a sessão do banco estiver em UTC, e divergia em SILÊNCIO se o
      // invariante operacional quebrasse (app resolvendo Lisboa e RPC
      // resolvendo Orlando na mesma confirmação).
      // Agora a comparação inteira acontece NO BANCO: a consulta acima filtra o
      // embed com o literal `today` do Postgres, que É `current_date` por
      // definição (medido: `set timezone` a `Pacific/Kiritimati` e a
      // `Etc/GMT+12` mantém `current_date = 'today'::date`). Mesma fonte da
      // RPC, sem ida a mais ao banco e sem conta de data em Node.
      // Aqui sobra só o DESEMPATE (`order by active_from desc limit 1` da RPC),
      // que não olha relógio nenhum. O dia do NEGÓCIO (`hojeISO`, Cuiabá) segue
      // governando o que é dele: âncora da grade, faixa do "hoje" e pendências.
      const slotAtivo = [...(c.recurring_slots ?? [])]
        .filter((s) => s.iana_tz)
        .sort((a, b) => (b.active_from ?? '').localeCompare(a.active_from ?? ''))[0]
      const ianaTz = slotAtivo?.iana_tz ?? aluno?.iana_tz ?? BUSINESS_TZ
      const cidade = tzLabel(ianaTz)
      return {
        id: c.id,
        // A CIDADE ENTRA NO RÓTULO (Sol · rodada 1 do A4, grave 3): sem ela, a
        // dona não tinha como saber que o horário que ela digita vale noutro
        // relógio — o dado que evita o erro não estava na tela.
        rotulo: `${nome} · ${c.plan_name ?? 'sem plano'} · ${cidade}`,
        ianaTz,
        cidade,
      }
    })

  // Visão LISTA: próximas agendadas, com busca por nome, agrupadas por dia.
  const busca = (p.busca ?? '').trim().toLowerCase()
  const porDia: DiaDaLista[] = []
  if (p.visao === 'lista') {
    const proximas = todas.filter(
      (r) =>
        r.situacao === 'agendada' &&
        DateTime.fromISO(r.inicioUtc).toMillis() >= agoraMs &&
        DateTime.fromISO(r.inicioUtc) < fimUtc &&
        (!busca || r.quem.toLowerCase().includes(busca)),
    )
    const mapa = new Map<string, AulaDaAgenda[]>()
    for (const r of proximas) {
      const chave = DateTime.fromISO(r.inicioUtc).setZone(BUSINESS_TZ).toFormat('yyyy-LL-dd')
      mapa.set(chave, [...(mapa.get(chave) ?? []), r])
    }
    for (const [iso, doDia] of mapa) {
      porDia.push({
        iso,
        titulo: DateTime.fromISO(iso, { zone: BUSINESS_TZ })
          .setLocale('pt-BR')
          .toFormat("cccc, dd 'de' LLLL"),
        aulas: doDia,
      })
    }
  }

  const passo = p.visao === 'mes' ? { months: 1 } : p.visao === 'semana' ? { days: 7 } : p.visao === 'dia' ? { days: 1 } : null

  const rotulo = (() => {
    const loc = a.setLocale('pt-BR')
    if (p.visao === 'mes') return loc.toFormat('LLLL yyyy')
    if (p.visao === 'dia') return loc.toFormat("cccc, dd 'de' LLLL")
    if (p.visao === 'lista') return 'Próximos 14 dias'
    if (p.visao === 'pendencias') return 'Aulas passadas sem desfecho'
    return `${intervalo.inicio.setLocale('pt-BR').toFormat('dd/LL')} – ${intervalo.fim.minus({ days: 1 }).setLocale('pt-BR').toFormat('dd/LL')}`
  })()

  return {
    visao: p.visao,
    ancora,
    hojeISO,
    rotulo,
    anterior: passo ? a.minus(passo).toFormat('yyyy-LL-dd') : null,
    proximo: passo ? a.plus(passo).toFormat('yyyy-LL-dd') : null,
    professoras,
    aulas,
    janelas,
    pendencias,
    porDia,
    contratos,
    intervalo: { inicioUtc: inicioUtc.toISO()!, fimUtc: fimUtc.toISO()! },
    disponibilidade,
  }
}

/* ========================================================================== */
/* A5/L2 — o histórico da aula, lido do `audit_log`                            */
/* ========================================================================== */

/**
 * O que a aba "Histórico" do popover mostra: um ato por linha, com a frase já
 * FORMADA aqui. A tela só pinta (Lei 1 — nenhuma data é formatada no cliente).
 */
export interface EventoDoHistorico {
  /** chave estável de lista: id da trilha + o papel desta aula no ato */
  chave: string
  /** o ato, no vocabulário da casa */
  titulo: string
  /** "29/07/2026 às 20:32" no fuso do NEGÓCIO */
  quando: string
  /** o instante em UTC, para `datetime=` */
  quandoIso: string
  /**
   * De que PORTA veio o ato — nunca de QUEM.
   *
   * `profiles` de terceiros não é legível pelo cliente do admin (existe
   * `profiles_self`; a policy de admin está em `audit_log`, não em `profiles`),
   * e o `actor` da trilha é só um uuid. Inventar nome a partir dele seria pior
   * do que calar: o histórico diz o canal e a hora, e ponto.
   */
  porQuem: string | null
  /** frases prontas, uma por campo da WHITELIST do `diff` */
  detalhes: string[]
}

/**
 * Teto de aulas por consulta.
 *
 * O `or()` do PostgREST repete a lista de ids UMA VEZ POR RAMO dentro da query
 * string de um GET, e a fila de pendências chega a dezenas de linhas: 100 ids
 * viram ~7,5 KB de endereço, acima da linha de requisição que o Kong aceita. Os
 * blocos vão em PARALELO — continua sem N+1 por aula (a régua escrita em
 * `temApontamento`), e nenhum endereço chega perto do teto.
 */
const AULAS_POR_CONSULTA = 40

/**
 * Projeção desta consulta. Schema por CONSULTA, nunca herdado (a lição está no
 * comentário do `AlunoDaOpcaoSchema`: schema herdado de outra projeção derrubou
 * a Agenda inteira).
 *
 * `diff` é objeto ou `null` — é o contrato de todos os escritores da trilha
 * (`jsonb_build_object` ou nada). Um `diff` escalar REPROVA o parse e a leitura
 * estoura, pela mesma régua do `HoraLocalSchema`: linha que não dá para ler não
 * some em silêncio.
 */
const LinhaDoHistoricoSchema = z.object({
  id: z.number().int(),
  action: z.string(),
  entity_id: z.string().nullable(),
  diff: z.record(z.string(), z.unknown()).nullable(),
  at: z.string(),
})

/**
 * A WHITELIST DE AÇÃO. `diff` nunca vai cru para a tela, e a ação nunca vai crua
 * também: vocabulário de banco ("no_show_teacher") não é assunto da dona.
 */
const TITULO_DA_ACAO: Record<string, string> = {
  admin_create_single_class: 'Aula avulsa criada',
  admin_create_trial_class: 'Aula experimental criada',
  confirm_class: 'Presença confirmada pelo aluno',
  complete_class: 'Registrada como realizada',
  no_show_student: 'Registrada como falta do aluno',
  no_show_teacher: 'Registrada como falta da professora',
  cancel_class: 'Aula cancelada',
  // `reschedule_class` não entra aqui: ela tem DUAS leituras, uma para a aula
  // nova e outra para a de origem (ver `eventoDaLinha`).
}

/**
 * AS AÇÕES QUE ESTE MÓDULO SABE NOMEAR — a allowlist da consulta.
 *
 * As de `TITULO_DA_ACAO` mais `reschedule_class`, que tem título por PAPEL (ver
 * `eventoDaLinha`). O que não está aqui não é lido do banco: o histórico de uma
 * aula não pode crescer por conta própria quando alguém adicionar uma RPC que
 * grave na trilha (Sol · rodada 1 do A5, médio 2 — antes era lista NEGRA, e tudo
 * o que não fosse o trigger genérico entrava por omissão).
 *
 * ── O QUE A LISTA NEGRA EXISTIA PARA BARRAR, e continua barrado ─────────────
 * O TRIGGER GENÉRICO (`audit_row_change`, migration 20260711000500) grava
 * `insert`/`update`/`delete` com a LINHA INTEIRA em `diff.new` (e `old`+`new` no
 * update) — só de `insert` em `class_instances` o banco local tem ~1.900
 * registros. Trazer isso pela rede para descartar em Node é banda e memória
 * gastas por nada, e é a superfície mais larga possível para um campo novo da
 * tabela aparecer na tela sem ninguém ter decidido. Ainda: cada uma dessas linhas
 * é a SOMBRA do mesmo ato que a RPC já narra com nome próprio, então incluí-las
 * duplicaria o histórico. Com a allowlist, elas ficam de fora por não estarem
 * nela — e o mesmo vale para a próxima RPC que ninguém previu.
 */
const ACOES_CONHECIDAS: readonly string[] = [...Object.keys(TITULO_DA_ACAO), 'reschedule_class']

/**
 * O canal do ato, quando o `diff` o declara.
 *
 * Só o vocabulário de CANAL entra. A chave `via` carrega DOIS vocabulários
 * diferentes no banco: em `_cancel_class_core` ela é a porta
 * (`admin`/`self`/`period`), e em `reschedule_class_at` ela é o que a remarcação
 * CUSTOU (`allowance`/`courtesy`/`makeup_credit`). Ler as duas como se fossem a
 * mesma coisa escreveria "cancelada pela alçada do mês" na tela — por isso o
 * mapa é fechado, e o custo da remarcação é lido por outro mapa.
 */
const PORTA_DO_VIA: Record<string, string> = {
  admin: 'pela escola',
  self: 'pelo próprio aluno, no portal',
  period: 'pelo tratamento de período da professora',
  teacher: 'pela própria professora, no painel dela',
}

/** O que a remarcação CUSTOU — a outra leitura de `via` (ver acima). `teacher`
 *  é a remarcação pela própria professora (M2, school_move): a escola moveu a
 *  aula e nada saiu do aluno — nem alçada, nem crédito. */
const CUSTO_DA_REMARCACAO: Record<string, string> = {
  allowance: 'consumiu uma remarcação da alçada do mês',
  courtesy: 'cortesia — fora da alçada do mês',
  makeup_credit: 'consumiu um crédito de reposição',
  teacher: 'a escola moveu a aula — nada consumido do aluno',
}

/** Quem pediu o cancelamento — o campo que DECIDE o dinheiro (ADR-018). */
const PEDIDO_POR: Record<string, string> = {
  student: 'quem pediu o cancelamento: o aluno',
  teacher: 'quem pediu o cancelamento: a professora',
}

const texto = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null

/** Instante do banco → "qua, 05/08 às 14:00" no fuso do negócio (Lei 1). */
function momentoDoNegocio(utc: string): string {
  return DateTime.fromISO(utc).setZone(BUSINESS_TZ).setLocale('pt-BR').toFormat("ccc, dd/LL 'às' HH:mm")
}

/** Data CIVIL do banco ('2027-01-28') → "28/01/2027". Sem `setZone`: uma data
 *  civil não tem instante, e deslocá-la de fuso a faria virar o dia. */
function dataCivil(iso: string): string {
  const d = DateTime.fromISO(iso, { zone: 'utc' })
  return d.isValid ? d.toFormat('dd/LL/yyyy') : iso
}

/**
 * A WHITELIST DE CAMPO do `diff`, aplicada AQUI — na camada de dados —, e a
 * tela recebe só texto pronto.
 *
 * Por que a whitelist existe: `reschedule_class` grava `courtesy_note`, que é
 * texto livre sobre a vida de alguém ("mãe internada"), e o trigger genérico
 * despeja a linha inteira. Render por lista negra deixaria o campo novo passar
 * por padrão; por lista branca, campo novo não aparece até alguém decidir.
 *
 * O que fica DE FORA de propósito:
 * · `courtesy_note` — texto livre, nunca na tela da agenda;
 * · `min_notice_hours` — ele está no `diff` como CONTEXTO, não como regra.
 *   `_cancel_class_core` NÃO olha antecedência para decidir crédito (quem decide
 *   é `cancelled_by`, ADR-018): imprimir a antecedência ao lado de "sem crédito"
 *   é exatamente a frase falsa que este lote veio consertar;
 * · uuids (`contract_id`, `confirmed_by`, `student_id`, `teacher_id`, `batch`) —
 *   não dizem nada a quem lê e viram ruído.
 */
function detalhesDoDiff(
  action: string,
  diff: Record<string, unknown> | null,
  papel: 'propria' | 'origem',
): string[] {
  if (!diff) return []
  const out: string[] = []

  const pedido = texto(diff.cancelled_by)
  if (pedido && PEDIDO_POR[pedido]) out.push(PEDIDO_POR[pedido])

  if (action === 'reschedule_class') {
    const antes = texto(diff.old_starts_at_utc)
    const depois = texto(diff.new_starts_at_utc)
    // A frase muda com o LADO: para a aula de origem, o horário novo é o
    // destino; para a aula nova, o antigo é de onde ela veio.
    if (papel === 'origem' && depois) out.push(`novo horário: ${momentoDoNegocio(depois)}`)
    if (papel === 'propria' && antes) out.push(`horário anterior: ${momentoDoNegocio(antes)}`)
    const custo = texto(diff.via)
    if (custo && CUSTO_DA_REMARCACAO[custo]) out.push(CUSTO_DA_REMARCACAO[custo])
  }

  // O DINHEIRO. Lido do `audit_log` e nunca deduzido da situação da aula: a
  // falta da professora pode NÃO ter creditado (quando a aula nasceu de um
  // crédito sem identidade, `_refund_for_credit_born_class` volta bloqueada), e
  // afirmar o crédito por dedução é a segunda frase falsa que este lote conserta.
  if (diff.credited === true) out.push('o aluno ganhou um crédito de reposição')
  if (diff.credited === false) out.push('sem crédito de reposição')
  const expira = texto(diff.expires_on)
  if (expira) out.push(`crédito válido até ${dataCivil(expira)}`)
  if (diff.credit_born === true) out.push('a aula tinha nascido de um crédito de reposição')
  const bloqueio = texto(diff.refund_blocked)
  if (bloqueio) out.push(`crédito não devolvido automaticamente: ${bloqueio}`)

  return out
}

/** Uma linha da trilha → um evento, no papel que ESTA aula tem nela. */
function eventoDaLinha(
  l: z.infer<typeof LinhaDoHistoricoSchema>,
  papel: 'propria' | 'origem',
): EventoDoHistorico {
  const titulo =
    l.action === 'reschedule_class'
      ? papel === 'origem'
        ? 'Remarcada para outro horário'
        : 'Nasceu de uma remarcação'
      : (TITULO_DA_ACAO[l.action] ??
        // Ação que este módulo não conhece não ESTOURA (derrubaria a agenda por
        // causa de uma linha histórica) e também não some em silêncio: o ato
        // fica visível com a hora, sem vocabulário inventado e sem `diff`.
        'Outro registro na trilha de auditoria')
  const conhecida = l.action === 'reschedule_class' || l.action in TITULO_DA_ACAO
  // `via` SÓ É PORTA EM `cancel_class` (Sol · rodada 1 do A5, médio 2). A chave
  // carrega DOIS vocabulários no banco — a porta em `_cancel_class_core`
  // (`admin`/`self`/`period`) e o CUSTO em `reschedule_class_at`
  // (`allowance`/`courtesy`/`makeup_credit`) —, e ler a de qualquer ação como se
  // fosse porta daria "pela escola" de graça a uma RPC futura que gravasse
  // `via:'admin'` com outro sentido. O mapa fechado protegia o vocabulário
  // ERRADO, não a ação errada.
  const via = l.action === 'cancel_class' ? texto(l.diff?.via) : null
  return {
    chave: `${l.id}:${papel}`,
    titulo,
    quando: DateTime.fromISO(l.at)
      .setZone(BUSINESS_TZ)
      .setLocale('pt-BR')
      .toFormat("dd/LL/yyyy 'às' HH:mm"),
    quandoIso: l.at,
    porQuem: via ? (PORTA_DO_VIA[via] ?? null) : null,
    detalhes: conhecida ? detalhesDoDiff(l.action, l.diff, papel) : [],
  }
}

/**
 * O histórico das aulas VISÍVEIS, em uma consulta por bloco de
 * `AULAS_POR_CONSULTA` — nunca uma por aula (a fila de pendências chega a
 * dezenas de linhas, e N+1 numa tela de agenda é latência que a dona sente).
 *
 * A CONSULTA COBRE DOIS RAMOS, e o segundo não é detalhe: o registro da
 * remarcação mora no id **NOVO** (`log_audit(..., v_new_id, {rescheduled_from:
 * p_instance})` em `reschedule_class_at`), então a aula de ORIGEM não tem log
 * nenhum do próprio remanejo. Sem o ramo `diff->>rescheduled_from` a aula
 * remarcada abriria o histórico vazio — medido no Supabase local, onde a linha
 * de origem só aparece por esse ramo.
 *
 * Uma linha de remarcação pode valer para DUAS aulas visíveis (a origem e a
 * nova) e sai como dois eventos, com frases diferentes — é o mesmo ato visto de
 * cada lado, não duplicata.
 *
 * O índice que serve isto é `audit_log_entity_idx (entity, entity_id)`
 * (migration 20260711000200).
 */
export async function historicoDaAula(
  aulaIds: readonly string[],
): Promise<Record<string, EventoDoHistorico[]>> {
  const saida: Record<string, EventoDoHistorico[]> = {}
  const ids = [...new Set(aulaIds)].filter((s) => s.trim() !== '')
  if (ids.length === 0) return saida

  const supabase = await createClient()
  const blocos: string[][] = []
  for (let i = 0; i < ids.length; i += AULAS_POR_CONSULTA)
    blocos.push(ids.slice(i, i + AULAS_POR_CONSULTA))

  const respostas = await Promise.all(
    blocos.map((bloco) => {
      const lista = bloco.join(',')
      return supabase
        .from('audit_log')
        .select('id, action, entity_id, diff, at')
        .eq('entity', 'class_instances')
        // ALLOWLIST, e não "tudo o que não é o trigger genérico" (Sol · rodada 1
        // do A5, médio 2): com a lista negra, uma RPC NOVA que gravasse na trilha
        // aparecia nesta tela sozinha, sem ninguém decidir — no melhor caso como
        // "Outro registro na trilha de auditoria", no pior interpretada pelos
        // mapas de `diff` acima. Agora entra o que este módulo sabe nomear; o
        // resto não sai do banco (ver `ACOES_CONHECIDAS`).
        .in('action', [...ACOES_CONHECIDAS])
        .or(`entity_id.in.(${lista}),diff->>rescheduled_from.in.(${lista})`)
        .order('id')
    }),
  )

  const cruas = respostas.flatMap((r, i) =>
    LinhaDoHistoricoSchema.array().parse(exigir(`o histórico das aulas (bloco ${i + 1})`, r)),
  )
  // DEDUPE POR `audit_log.id` (Sol · rodada 1 do A5, médio 1).
  //
  // Os blocos de 40 são fatias dos IDS VISÍVEIS, não dos registros: uma
  // remarcação cuja aula de ORIGEM caiu no bloco 1 e a NOVA no bloco 2 casa nos
  // dois `or` — a mesma linha da trilha volta duas vezes. Sem dedupe, cada papel
  // era criado em dobro: dois eventos idênticos na aba Histórico e, pior, duas
  // `key` iguais na lista do React (a `chave` é `<id>:<papel>`), que é remoção de
  // nó errado esperando acontecer. A fatia é do id da AULA; a identidade do EVENTO
  // é o id da trilha.
  const porId = new Map<number, z.infer<typeof LinhaDoHistoricoSchema>>()
  for (const l of cruas) porId.set(l.id, l)
  // Ordem única entre os blocos: `id` do `audit_log` é identity, então é a
  // ordem cronológica REAL — e desempata atos da mesma transação, que
  // compartilham o `now()` do `at`.
  const linhas = [...porId.values()].sort((x, y) => x.id - y.id)

  const visivel = new Set(ids)
  for (const l of linhas) {
    if (l.entity_id && visivel.has(l.entity_id)) {
      ;(saida[l.entity_id] ??= []).push(eventoDaLinha(l, 'propria'))
    }
    const origem = texto(l.diff?.rescheduled_from)
    if (origem && visivel.has(origem)) {
      ;(saida[origem] ??= []).push(eventoDaLinha(l, 'origem'))
    }
  }
  return saida
}
