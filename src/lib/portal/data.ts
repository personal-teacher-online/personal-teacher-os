import type { SupabaseClient } from '@supabase/supabase-js'
import { one } from '@/lib/embed'
import { MEMORIA_DOS_VENCIDOS_DIAS } from '@/lib/portal/creditos'

// As queries REAIS do portal, com o client injetado: a página usa a sessão do aluno
// (RLS decide as linhas) e os testes de isolamento importam ESTAS funções (gate do M3).
//
// O PADRÃO `{ dado, erro }` (Onda do Portal · P3, dívida c14). Uma leitura que
// falha no PostgREST devolvia `null`/`[]` — indistinguível de "não há nada" —, e
// a tela afirmava ao aluno que ele não tem aula, não tem crédito, não deve nada.
// Agora cada leitura entrega o que leu E se conseguiu ler; quem chama decide, e
// o Início/Créditos avisam na tela em vez de mentir com silêncio.
//
// As duas funções mais antigas do arquivo (`contratoDeMentoriaAtivo`,
// `atualizacaoDeBriefingPendente`) já nasceram assim, com o dado batizado pelo
// domínio (`contrato`, `pendente`); elas ficam como estão até a onda das telas
// que as consomem.

export interface UpcomingClass {
  id: string
  startsAtUtc: string
  endsAtUtc: string
  teacherName: string
  contractId: string
  occurrenceDate: string | null
  /** Link da sala: o da aula quando existe, senão o fixo da professora (F11). */
  meetUrl: string | null
}

export interface LeituraDeAulas {
  dado: UpcomingClass[]
  erro: boolean
}

/**
 * As próximas aulas do aluno — incluindo a que está ACONTECENDO agora.
 *
 * O corte é pelo FIM (`ends_at_utc >= agora`), não pelo começo: com o corte
 * antigo, às 20h01 de uma aula das 20h a aula sumia do portal — e com ela o
 * botão de entrar (D1), que vale justamente até o fim. Quem chega atrasado
 * perdia a porta da própria aula.
 */
export async function upcomingClasses(client: SupabaseClient): Promise<LeituraDeAulas> {
  const { data: rows, error: e1 } = await client
    .from('class_instances')
    .select('id, starts_at_utc, ends_at_utc, teacher_id, contract_id, occurrence_date, meet_url')
    .eq('state', 'scheduled')
    .gte('ends_at_utc', new Date().toISOString())
    .order('starts_at_utc')
    .limit(20)
  if (e1) return { dado: [], erro: true }

  // As professoras DESTAS aulas, nunca a view inteira: `teacher_public` é aberta
  // a todo usuário logado e o PostgREST corta a resposta em `PGRST_DB_MAX_ROWS`
  // — com a view crescendo, a professora da aula podia cair fora da janela e a
  // aula sair com "Professora" genérica e sem link de sala. É a mesma régua que
  // `creditSummary` já usava.
  const teacherIds = [...new Set((rows ?? []).map((r) => r.teacher_id as string))]
  const [{ data: teachers, error: e2 }, { data: paused, error: e3 }] = await Promise.all([
    teacherIds.length
      ? client.from('teacher_public').select('id, display_name, fallback_meet_url').in('id', teacherIds)
      : Promise.resolve({ data: [], error: null }),
    // Painel final F3: contrato PAUSADO não mostra aula futura — a instância
    // 'scheduled' remanescente é cancelada/re-materializada na retomada
    // (resume_contract); exibi-la afirmaria uma aula que a pausa suspendeu.
    // Filtro de EXIBIÇÃO (a verdade vive no banco — mesma regra da teacher_agenda).
    client.from('contracts').select('id').eq('status', 'paused'),
  ])
  // Falhar a leitura das professoras ou das pausas não é detalhe: sem elas a
  // lista sairia com "Professora" genérica ou mostrando aula de contrato pausado.
  if (e2 || e3) return { dado: [], erro: true }

  const names = new Map((teachers ?? []).map((t) => [t.id, t.display_name as string]))
  const fallback = new Map((teachers ?? []).map((t) => [t.id, (t.fallback_meet_url as string) ?? null]))
  const pausedIds = new Set((paused ?? []).map((c) => c.id as string))
  return {
    dado: (rows ?? [])
      .filter((r) => !pausedIds.has(r.contract_id))
      .map((r) => ({
        id: r.id,
        startsAtUtc: r.starts_at_utc,
        endsAtUtc: r.ends_at_utc,
        teacherName: names.get(r.teacher_id) ?? 'Professora',
        contractId: r.contract_id,
        occurrenceDate: r.occurrence_date ?? null,
        meetUrl: r.meet_url ?? fallback.get(r.teacher_id) ?? null,
      })),
    erro: false,
  }
}

/** Uma aula do HISTÓRICO, com o fato que explica o estado dela (P4). Nem toda
 *  linha daqui é passada: aula FUTURA cancelada também sai de 'scheduled' e cai
 *  neste balde — foi o que fez a tela trocar "Passadas" por "Histórico". */
export interface AulaPassada {
  id: string
  startsAtUtc: string
  endsAtUtc: string
  /** `class_state` cru — quem traduz é `estadoDaAula` (lib/portal/aulas.ts) */
  estado: string
  teacherName: string | null
  canceladoPor: string | null
  foraDoAviso: boolean | null
  gerouCredito: boolean | null
}

export interface LeituraDoHistorico {
  dado: { aulas: AulaPassada[]; total: number }
  erro: boolean
}

/** Quantas aulas do histórico cabem numa página (a tela pagina; a lista não
 *  cresce para sempre num celular). O teto de verdade é do banco
 *  (`student_class_history`). */
export const AULAS_POR_PAGINA = 15

interface LinhaDoHistorico {
  /** NULO na linha-sentinela: página fora do intervalo, total verdadeiro. */
  id: string | null
  starts_at_utc: string
  ends_at_utc: string
  state: string
  teacher_name: string | null
  cancelado_por: string | null
  fora_do_aviso: boolean | null
  gerou_credito: boolean | null
  total: number | string
}

/**
 * O HISTÓRICO DE AULAS — paginado, e com o estado já EXPLICADO pelo banco.
 *
 * O que morreu aqui (dívida c14, roteada ao P4): a versão anterior lia
 * `class_instances` direto, DESCARTAVA o `error` do PostgREST e devolvia `[]` —
 * "você não tem aula nenhuma no histórico" e "o banco não respondeu" eram a
 * mesma resposta. E o estado saía como o rótulo de um mapa em TypeScript, sem
 * saber quem cancelou nem se a aula virou crédito: o `audit_log` que guarda esse
 * fato é fechado ao aluno pela RLS.
 *
 * Agora é `student_class_history` (migration 20260728000600) quem entrega cada
 * aula com `cancelado_por`, `fora_do_aviso` e `gerou_credito` — lidos da linha
 * que a própria ação de cancelar escreveu. Este arquivo só desembrulha.
 *
 * A LINHA-SENTINELA (revisão do P4, E8). Página fora do intervalo (`?p=99`)
 * devolve UMA linha com `id` nulo e o total verdadeiro — antes o total viajava
 * só nas linhas de aula, então página vazia significava total zero e a tela
 * afirmava "não há aulas" a quem tem cem. Aqui ela é descartada, e o `total`
 * segue verdadeiro para quem precisa reposicionar a paginação.
 */
export async function historicoDeAulas(
  client: SupabaseClient,
  { pagina = 1 }: { pagina?: number } = {},
): Promise<LeituraDoHistorico> {
  const vazio = { aulas: [], total: 0 }
  const p = Number.isFinite(pagina) && pagina > 0 ? Math.floor(pagina) : 1
  const { data, error } = await client.rpc('student_class_history', {
    p_limit: AULAS_POR_PAGINA,
    p_offset: (p - 1) * AULAS_POR_PAGINA,
  })
  if (error) return { dado: vazio, erro: true }

  const linhas = (data ?? []) as LinhaDoHistorico[]
  return {
    dado: {
      aulas: linhas
        .filter((r) => r.id !== null)
        .map((r) => ({
          id: r.id as string,
          startsAtUtc: r.starts_at_utc,
          endsAtUtc: r.ends_at_utc,
          estado: r.state,
          teacherName: r.teacher_name ?? null,
          canceladoPor: r.cancelado_por ?? null,
          foraDoAviso: r.fora_do_aviso ?? null,
          gerouCredito: r.gerou_credito ?? null,
        })),
      total: Number(linhas[0]?.total ?? 0),
    },
    erro: false,
  }
}

export interface LeituraDePausa {
  /** algum contrato particular do aluno está PAUSADO? */
  dado: boolean
  erro: boolean
}

/**
 * O ALUNO ESTÁ EM PAUSA? (revisão do P4, E4.)
 *
 * A tela de créditos já tinha a seção "Em pausa"; a de aulas não sabia da pausa
 * e mostrava só uma lista de próximas vazia — que é exatamente o que um aluno
 * esquecido vê como "sumiram as minhas aulas". A pausa some da lista por
 * decisão de exibição (`upcomingClasses` filtra contrato pausado); dizer POR QUE
 * é o que faltava.
 *
 * A RLS de `contracts` já limita ao próprio aluno — a mesma leitura que
 * `upcomingClasses` faz para filtrar.
 */
export async function temContratoPausado(client: SupabaseClient): Promise<LeituraDePausa> {
  const { data, error } = await client
    .from('contracts')
    .select('id')
    .eq('contract_type', 'private_1on1')
    .eq('status', 'paused')
    .limit(1)
  if (error) return { dado: false, erro: true }
  return { dado: (data ?? []).length > 0, erro: false }
}

/* -------------------------------------------------------------------------- */
/* A AULA COMO LUGAR (N3) e o EFEITO das duas ações (D4) — P4                 */
/* -------------------------------------------------------------------------- */

export interface DetalheDaAula {
  id: string
  startsAtUtc: string
  endsAtUtc: string
  estado: string
  teacherId: string
  teacherName: string
  /** link da sala: o da aula quando existe, senão o fixo da professora (F11) */
  meetUrl: string | null
  confirmadaEm: string | null
}

export interface LeituraDaAula {
  dado: DetalheDaAula | null
  erro: boolean
}

/**
 * UMA aula do aluno — a página N3.
 *
 * A RLS já limita `class_instances` ao próprio aluno: instância alheia volta
 * como "não existe" (a página responde 404), e isso é diferente de falha de
 * leitura — daí `{ dado: null, erro: false }` para a primeira e `erro: true`
 * para a segunda. Antes as duas eram `null`, e uma queda do PostgREST virava
 * "essa aula não existe" na cara de quem tinha aula em uma hora.
 */
export async function aulaDoAluno(client: SupabaseClient, instanceId: string): Promise<LeituraDaAula> {
  const { data: rows, error } = await client
    .from('class_instances')
    .select('id, starts_at_utc, ends_at_utc, state, teacher_id, confirmed_at, meet_url')
    .eq('id', instanceId)
    .limit(1)
  if (error) return { dado: null, erro: true }
  const inst = one(rows)
  if (!inst) return { dado: null, erro: false }

  const { data: profs, error: eProf } = await client
    .from('teacher_public')
    .select('display_name, fallback_meet_url')
    .eq('id', inst.teacher_id)
    .limit(1)
  // Sem a professora a página sairia com "Professora" genérica e sem sala —
  // mesma régua de `upcomingClasses`: falha de leitura é falha, não default.
  if (eProf) return { dado: null, erro: true }
  const prof = one(profs)

  return {
    dado: {
      id: inst.id,
      startsAtUtc: inst.starts_at_utc,
      endsAtUtc: inst.ends_at_utc,
      estado: inst.state,
      teacherId: inst.teacher_id,
      teacherName: prof?.display_name ?? 'Sua professora',
      meetUrl: inst.meet_url ?? prof?.fallback_meet_url ?? null,
      confirmadaEm: inst.confirmed_at ?? null,
    },
    erro: false,
  }
}

export interface FatoDaAulaDoBanco {
  estado: string
  canceladoPor: string | null
  foraDoAviso: boolean | null
  gerouCredito: boolean | null
}

export interface LeituraDoFatoDaAula {
  dado: FatoDaAulaDoBanco | null
  erro: boolean
}

/** O estado de UMA aula com o fato que o explica — a mesma fonte da lista, para
 *  que a página da aula e o histórico não digam coisas diferentes da mesma aula. */
export async function fatoDaAula(
  client: SupabaseClient,
  instanceId: string,
): Promise<LeituraDoFatoDaAula> {
  const { data, error } = await client.rpc('student_class_state', { p_instance: instanceId })
  if (error) return { dado: null, erro: true }
  const linha = one(data as Record<string, unknown>[] | null)
  if (!linha) return { dado: null, erro: true }
  return {
    dado: {
      estado: String(linha.state),
      canceladoPor: (linha.cancelado_por as string | null) ?? null,
      foraDoAviso: (linha.fora_do_aviso as boolean | null) ?? null,
      gerouCredito: (linha.gerou_credito as boolean | null) ?? null,
    },
    erro: false,
  }
}

export interface PreviewDeRemarcacaoDoBanco {
  efeito: string
  franquiaRestante: number
  saldoCreditos: number
  minNoticeHours: number
  /** data civil crua (o servidor formata antes de chegar aos olhos do aluno) */
  validadeDoCredito: string | null
  /** instante (ISO) em que esta resposta expira — a fronteira do aviso mínimo */
  limiteTs: string | null
}

export interface LeituraDoPreviewDeRemarcacao {
  dado: PreviewDeRemarcacaoDoBanco | null
  erro: boolean
}

/**
 * O QUE ACONTECE SE REMARCAR AGORA — perguntado ao banco (D4).
 *
 * `preview_reschedule_effect` responde com a classificação que
 * `reschedule_class_at` aplicaria: franquia, crédito, sem saldo ou a recusa
 * exata. A tela NÃO refaz a conta — era assim que a página antiga fazia
 * (`min_notice_hours` contra `diffNow()`, franquia por uma query, crédito por
 * outra), e três cópias da mesma régua é como a tela e o banco passam a
 * discordar sobre dinheiro.
 */
export async function previewDeRemarcacao(
  client: SupabaseClient,
  instanceId: string,
): Promise<LeituraDoPreviewDeRemarcacao> {
  const { data, error } = await client.rpc('preview_reschedule_effect', { p_instance: instanceId })
  if (error) return { dado: null, erro: true }
  const linha = one(data as Record<string, unknown>[] | null)
  if (!linha) return { dado: null, erro: true }
  return {
    dado: {
      efeito: String(linha.efeito),
      franquiaRestante: Number(linha.franquia_restante ?? 0),
      saldoCreditos: Number(linha.saldo_creditos ?? 0),
      minNoticeHours: Number(linha.min_notice_hours ?? 0),
      validadeDoCredito: (linha.validade_do_credito as string | null) ?? null,
      limiteTs: (linha.limite_ts as string | null) ?? null,
    },
    erro: false,
  }
}

export interface PreviewDeCancelamentoDoBanco {
  efeito: string
  geraCredito: boolean
  minNoticeHours: number
  dentroDoAviso: boolean
  /** instante (ISO) da próxima fronteira que muda esta resposta */
  limiteTs: string | null
}

export interface LeituraDoPreviewDeCancelamento {
  dado: PreviewDeCancelamentoDoBanco | null
  erro: boolean
}

/** O mesmo para o cancelamento — a matriz D2 consultada, nunca reescrita em TS. */
export async function previewDeCancelamento(
  client: SupabaseClient,
  instanceId: string,
): Promise<LeituraDoPreviewDeCancelamento> {
  const { data, error } = await client.rpc('preview_cancel_effect', { p_instance: instanceId })
  if (error) return { dado: null, erro: true }
  const linha = one(data as Record<string, unknown>[] | null)
  if (!linha) return { dado: null, erro: true }
  return {
    dado: {
      efeito: String(linha.efeito),
      geraCredito: linha.gera_credito === true,
      minNoticeHours: Number(linha.min_notice_hours ?? 0),
      dentroDoAviso: linha.dentro_do_aviso === true,
      limiteTs: (linha.limite_ts as string | null) ?? null,
    },
    erro: false,
  }
}

export interface CreditSummary {
  contractId: string
  planName: string
  /** Nome da professora do contrato — rotula o botão de reposição quando o
   *  aluno tem mais de um contrato (auditoria 16/07, achado F2). */
  teacherName: string | null
  balance: number
  /** Validade do PRÓXIMO crédito a vencer entre os que ainda existem no replay
   *  do FIFO (`null` quando o que sobrou não tem prazo). */
  nextExpiry: string | null
  /** Dias até `nextExpiry`, contados pelo BANCO (`business_today()`). */
  nextExpiryDays: number | null
}

export interface LeituraDeCreditos {
  dado: CreditSummary[]
  erro: boolean
}

interface LinhaDeTotais {
  contract_id: string
  saldo: number
  proxima_validade: string | null
  proxima_validade_dias: number | null
}

/**
 * O saldo por contrato — SOMADO NO BANCO, nunca contando linhas aqui.
 *
 * A versão anterior perguntava a validade às linhas +1 CRUAS do ledger
 * (`makeup_ledger` com `delta > 0`), que é uma fonte diferente do saldo: o
 * crédito que vence dia 10/08 podia já ter sido gasto e o cartão do Início
 * anunciava assim mesmo "vale até 10/08", enquanto o crédito realmente vivo
 * vencia em 10/09. Quem sabe quais créditos ainda existem é o replay do FIFO
 * (Lei 2).
 *
 * A VERSÃO SEGUINTE contava as linhas do extrato aqui — e caiu no teto do
 * PostgREST (revisão adversarial 2 · D2): `max_rows` (supabase/config.toml:16)
 * corta a resposta e a devolve como SUCESSO, então um aluno com muito crédito
 * leria um saldo silenciosamente menor que o verdadeiro. Agora o número vem de
 * `student_credit_totals()`, um agregado: UMA linha por contrato, imune ao
 * corte por construção, e com a MESMA classificação da tela de créditos
 * (vencido/congelado por `business_today()` + replay).
 *
 * ERRO É TUDO OU NADA (revisão adversarial do P3): antes, um contrato que lia e
 * outro que falhava publicavam "1 reposição" JUNTO do aviso de falha — um
 * número que o aluno lê como o saldo dele. Agora falha de leitura devolve lista
 * vazia: a tela mostra o aviso e NENHUM número.
 */
export async function creditSummary(client: SupabaseClient): Promise<LeituraDeCreditos> {
  const [{ data: contracts, error: eContratos }, { data: totais, error: eTotais }] = await Promise.all([
    client
      .from('contracts')
      .select('id, plan_name, teacher_id')
      .eq('contract_type', 'private_1on1')
      // Só contrato ATIVO: `/portal/resgatar` recusa qualquer outro estado, e
      // saldo com botão que não abre é promessa quebrada. Contrato pausado tem
      // seção própria na tela de créditos.
      .eq('status', 'active'),
    client.rpc('student_credit_totals'),
  ])
  if (eContratos || eTotais) return { dado: [], erro: true }

  const teacherIds = [...new Set((contracts ?? []).map((c) => c.teacher_id).filter(Boolean))]
  const { data: teacherRows, error: eProfs } = teacherIds.length
    ? await client.from('teacher_public').select('id, display_name').in('id', teacherIds)
    : { data: [], error: null }
  if (eProfs) return { dado: [], erro: true }

  const teacherName = new Map((teacherRows ?? []).map((t) => [t.id, t.display_name]))
  const porContrato = new Map(
    ((totais ?? []) as LinhaDeTotais[]).map((t) => [t.contract_id, t]),
  )
  return {
    dado: (contracts ?? []).map((c) => {
      const t = porContrato.get(c.id)
      return {
        contractId: c.id,
        planName: c.plan_name,
        teacherName: (c.teacher_id && teacherName.get(c.teacher_id)) || null,
        balance: Number(t?.saldo ?? 0),
        nextExpiry: t?.proxima_validade ?? null,
        nextExpiryDays: t?.proxima_validade_dias ?? null,
      }
    }),
    erro: false,
  }
}

/**
 * O DESFECHO DE UMA COBRANÇA, no vocabulário do BANCO (P5).
 *
 * `payment_situacao` (migration 20260728000800) devolve um destes OITO nomes —
 * a tela traduz nome → frase e não volta a ler o `status` cru do Asaas. Os três
 * do meio (estorno parcial · estorno em andamento · em disputa) nasceram da
 * rodada de correção: sem eles, a matriz do banco tinha de espremer em
 * "estornada" situações em que NADA voltou para o aluno.
 *
 * O `desconhecida` não existe no banco: é o default honesto para o dia em que a
 * view devolver um nome que este código ainda não conhece.
 */
export type SituacaoDaCobranca =
  | 'paga'
  | 'em_aberto'
  | 'em_atraso'
  | 'estornada'
  | 'estorno_parcial'
  | 'estorno_em_andamento'
  | 'em_disputa'
  | 'cancelada'
  | 'desconhecida'

const SITUACOES: readonly SituacaoDaCobranca[] = [
  'paga',
  'em_aberto',
  'em_atraso',
  'estornada',
  'estorno_parcial',
  'estorno_em_andamento',
  'em_disputa',
  'cancelada',
]

export interface PaymentRow {
  id: string
  amountCents: number | null
  status: string | null
  dueDate: string | null
  referenceYm: string | null
  /** Ainda pede algo do pagador? Decidido pelo BANCO (`payment_em_aberto`). */
  emAberto: boolean
  /** Em aberto E vencida na data civil do NEGÓCIO (`business_today()`). */
  emAtraso: boolean
  /**
   * Estornada / com chargeback / cancelada / apagada — dinheiro que NÃO é
   * dívida do aluno nem caixa da escola (`payment_nao_cobravel`, a mesma régua
   * dos KPIs). Sem esta coluna a tela chamava de "paga" o que foi devolvido.
   */
  naoCobravel: boolean
  /**
   * O link da fatura no Asaas — só chega quando o BANCO afirma que o pagador é
   * o próprio aluno (relationship=self) E a origem casa com asaas.com (as duas
   * guardas da view, F3). Null = sem botão; a tela não decide nada.
   */
  invoiceUrl: string | null
  /** O desfecho já nomeado pelo banco (`payment_situacao`). */
  situacao: SituacaoDaCobranca
}

export interface LeituraDePagamentos {
  dado: PaymentRow[]
  erro: boolean
}

// `invoice_url` VOLTOU no F3 (Onda Financeiro): a view agora sabe afirmar que
// o pagador é o PRÓPRIO aluno (relationship = self) e valida a origem — as
// duas guardas vivem DENTRO da view (migration 20260807000300); aqui e na tela
// não se decide nada: url nula = sem botão.
const COLUNAS_DE_COBRANCA =
  'id, amount_cents, status, due_date, reference_ym, em_aberto, em_atraso, nao_cobravel, situacao, invoice_url'

function paraCobranca(r: Record<string, unknown>): PaymentRow {
  const situacao = String(r.situacao ?? '')
  return {
    id: r.id as string,
    amountCents: (r.amount_cents as number | null) ?? null,
    status: (r.status as string | null) ?? null,
    dueDate: (r.due_date as string | null) ?? null,
    referenceYm: (r.reference_ym as string | null) ?? null,
    emAberto: r.em_aberto === true,
    emAtraso: r.em_atraso === true,
    naoCobravel: r.nao_cobravel === true,
    invoiceUrl: (r.invoice_url as string | null) ?? null,
    situacao: (SITUACOES as readonly string[]).includes(situacao)
      ? (situacao as SituacaoDaCobranca)
      : 'desconhecida',
  }
}

export async function payments(client: SupabaseClient): Promise<LeituraDePagamentos> {
  const { data: rows, error } = await client
    .from('payments_student')
    .select(COLUNAS_DE_COBRANCA)
    .order('due_date', { ascending: false })
    .limit(12)
  if (error) return { dado: [], erro: true }
  return { dado: (rows ?? []).map(paraCobranca), erro: false }
}

export interface LeituraDeCobranca {
  dado: PaymentRow | null
  erro: boolean
}

/**
 * A cobrança em aberto MAIS ANTIGA — a do cartão do Início.
 *
 * Consulta PRÓPRIA, e não um filtro sobre a listagem paginada: a listagem corta
 * as 12 últimas por vencimento DESCENDENTE, então a mensalidade esquecida de
 * março ficava fora do corte e o Início dizia, calado, que estava tudo em dia.
 * O filtro de "em aberto" vai no SQL (a coluna que o banco calcula), sem
 * `limit` de página, e a ordenação por vencimento crescente entrega a que
 * atrasou primeiro — que é a que pesa.
 *
 * Cobrança sem vencimento registrado vai para o fim (`nullsFirst: false`): ela
 * existe, mas não é a mais antiga de ninguém.
 */
export async function cobrancaEmAbertoMaisAntiga(client: SupabaseClient): Promise<LeituraDeCobranca> {
  const { data: rows, error } = await client
    .from('payments_student')
    .select(COLUNAS_DE_COBRANCA)
    .eq('em_aberto', true)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(1)
  if (error) return { dado: null, erro: true }
  const r = one(rows)
  return { dado: r ? paraCobranca(r) : null, erro: false }
}

/**
 * O CONTRATO DE MENTORIA ATIVO do aluno — UMA query, um lugar só (P1).
 *
 * Antes esta pergunta era feita em dois lugares com dois critérios: o layout
 * filtrava `status` no SQL e a página de mentoria trazia todos os contratos de
 * mentoria e filtrava em JS. Duas cópias da mesma regra de elegibilidade é
 * exatamente como a aba e a página passam a discordar.
 *
 * RLS já limita `contracts` ao próprio aluno; o filtro de status vai no SQL.
 *
 * O `erro` NÃO é detalhe (revisão adversarial P1 · F4): sem ele, PostgREST fora
 * do ar e "este aluno não é do Personal Travel" viravam a MESMA resposta —
 * `null` —, e a página de mentoria anunciava "Você não faz parte do programa"
 * para um mentorado por causa de uma falha de leitura de dez segundos. Quem
 * chama decide o que fazer: a página se defende (mostra "não deu para carregar")
 * e a navegação, que é conveniência, trata como quem não tem a aba.
 */
export interface MentoriaAtiva {
  contrato: { id: string } | null
  erro: boolean
}

export async function contratoDeMentoriaAtivo(client: SupabaseClient): Promise<MentoriaAtiva> {
  const { data, error } = await client
    .from('contracts')
    .select('id')
    .eq('contract_type', 'mentorship')
    .eq('status', 'active')
    .limit(1)
  if (error) return { contrato: null, erro: true }
  const c = one(data)
  return { contrato: c ? { id: c.id } : null, erro: false }
}

/**
 * UMA RESERVA DE MENTORIA, já com a ETAPA que ela consumiu.
 *
 * A etapa (`window_index`) mora na linha do ledger que a reserva aponta — e é
 * ela, não a contagem de reservas, que diz quais degraus da escada foram usados
 * (com estorno no meio, "as N primeiras" está errado: veja
 * `src/lib/portal/mentoria.ts`).
 *
 * A leitura mora AQUI, e não na tela, por dois motivos: é o lugar de toda
 * leitura do portal, e o varredor de vocabulário do aluno proíbe o nome da
 * tabela nas telas — a tradução do jargão do banco para o domínio ("etapa") é
 * exatamente o trabalho desta camada.
 */
export interface ReservaDeMentoria {
  id: string
  sessionId: string
  /** a etapa da escada consumida; `null` quando a linha não pôde ser lida */
  etapa: number | null
}

export interface LeituraDasReservas {
  dado: ReservaDeMentoria[]
  erro: boolean
}

export async function reservasDeMentoria(
  client: SupabaseClient,
  contractId: string,
): Promise<LeituraDasReservas> {
  const { data, error } = await client
    .from('mentorship_bookings')
    .select('id, session_id, created_at, mentorship_credit_ledger(window_index)')
    .eq('contract_id', contractId)
    .is('cancelled_at', null)
    .order('created_at')
  if (error) return { dado: [], erro: true }
  return {
    dado: (data ?? []).map((b) => {
      const etapa = Number(one(b.mentorship_credit_ledger)?.window_index)
      return {
        id: b.id as string,
        sessionId: b.session_id as string,
        etapa: Number.isInteger(etapa) ? etapa : null,
      }
    }),
    erro: false,
  }
}

/** O mesmo fato, na forma que a NAVEGAÇÃO precisa: mostrar a aba Mentoria?
 *  Falha de leitura = sem aba — a barra do polegar não é lugar de anunciar
 *  incidente, e quem entrar em `/portal/mentoria` mesmo assim lê o aviso lá. */
export async function temMentoriaAtiva(client: SupabaseClient): Promise<boolean> {
  return (await contratoDeMentoriaAtivo(client)).contrato !== null
}

/**
 * O RE-BRIEFING SEMESTRAL pendente deste aluno (sub-lote 4 do briefing v2).
 *
 * Esta função NÃO decide nada: ela pergunta ao banco. Quem decide é a RPC
 * `briefing_update_pendente` (migration 20260728000300), a fonte ÚNICA que o
 * card do Início, a rota /portal/briefing/atualizar, o botão da ficha da admin
 * e o lembrete da dona consultam. Antes esta pergunta era refeita em TypeScript
 * aqui, em SQL no lembrete e mais uma vez nas RPCs de escrita — três derivações
 * que já discordavam entre si (revisão de integração, achados 4 e 5: contrato de
 * grupo aceito num lado e recusado no outro; aluno com dois contratos ativos
 * respondido pela ordem errada).
 *
 * O `erro` é da mesma escola de `contratoDeMentoriaAtivo`: PostgREST fora do ar
 * não pode virar "não tem nada pendente" — quem chama decide (o Início prefere
 * não desenhar o convite a desenhar um convite falso, mas sabe a diferença).
 *
 * O ESCOPO é como a FICHA DA ADMIN pergunta pelo aluno que ela está olhando: no
 * portal quem chama é o próprio aluno e o id sai da sessão (uma leitura de
 * `students`, que a RLS já limita à linha dele); na ficha o id vem de fora. O
 * porteiro de quem pode perguntar por quem é da RPC, não daqui.
 */
export interface AtualizacaoDeBriefing {
  pendente: { studentId: string; contractId: string; semesterNo: number } | null
  erro: boolean
}

/** O aluno sobre quem se pergunta, quando não é o dono da sessão. */
export interface EscopoDaAtualizacao {
  studentId: string
}

export async function atualizacaoDeBriefingPendente(
  client: SupabaseClient,
  escopo?: EscopoDaAtualizacao,
): Promise<AtualizacaoDeBriefing> {
  let studentId = escopo?.studentId ?? null
  if (!studentId) {
    const { data: eu, error } = await client.from('students').select('id').limit(1)
    if (error) return { pendente: null, erro: true }
    const s = one(eu)
    // Sessão sem cadastro de aluno (admin espiando o portal, conta órfã): não há
    // pendência a mostrar, e não é falha de leitura.
    if (!s) return { pendente: null, erro: false }
    studentId = s.id as string
  }

  const { data, error } = await client.rpc('briefing_update_pendente', { p_student: studentId })
  if (error) return { pendente: null, erro: true }
  const linha = one(data as { contract_id: string; semester_no: number }[] | null)
  if (!linha) return { pendente: null, erro: false }

  return {
    pendente: {
      studentId,
      contractId: linha.contract_id,
      semesterNo: linha.semester_no,
    },
    erro: false,
  }
}

/* -------------------------------------------------------------------------- */
/* O EXTRATO DE CRÉDITOS EM LINGUAGEM DE GENTE (D9 · P3)                      */
/* -------------------------------------------------------------------------- */

/**
 * UM crédito do aluno — a unidade que ele conta com o dedo, não a linha do
 * banco: um ajuste de +2 é DOIS créditos, e o replay do FIFO
 * (`_makeup_remaining_credits`, Lei 2) é quem sabe quais ainda existem.
 *
 * `validade` é `null` quando o crédito não tem prazo (o replay devolve
 * `infinity` para as linhas que nasceram sem `expires_on`): a tela diz "sem
 * prazo para usar", nunca a palavra que o Postgres usa.
 */
export interface CreditoDoAluno {
  /** posição no replay do contrato — dois créditos podem vir da mesma linha */
  ord: number
  origemId: number
  contractId: string
  /** 'active' | 'paused' — o crédito de contrato pausado não tem ação */
  contratoStatus: string
  motivo: string
  criadoEmUtc: string | null
  validade: string | null
  /** dias até a validade, contados pelo BANCO (`business_today()`) */
  diasRestantes: number | null
  vencido: boolean
  congelado: boolean
  duracaoMin: number | null
  nota: string | null
  /** começo da aula ligada ao crédito (a que foi desmarcada), quando houver */
  aulaStartsAtUtc: string | null
  /**
   * QUEM desmarcou a aula que gerou o crédito, lido do audit pelo banco.
   * `null` = indeterminável (crédito migrado, ajuste manual, cancelamento por
   * caminho direto) — e aí a frase é neutra, nunca um culpado inventado.
   */
  origemAutor: 'student' | 'teacher' | null
}

/** O teto de linhas que o PostgREST devolve em QUALQUER leitura
 *  (`supabase/config.toml:16` — `max_rows = 1000`). */
const LIMITE_DE_LINHAS_DO_POSTGREST = 1000

export interface LeituraDoExtrato {
  dado: { vivos: CreditoDoAluno[]; congelados: CreditoDoAluno[]; vencidos: CreditoDoAluno[] }
  erro: boolean
}

interface LinhaDoExtrato {
  contract_id: string
  contract_status: string
  ord: number
  ledger_id: number
  expires_on: string | null
  dias_restantes: number | null
  vencido: boolean
  congelado: boolean
  duration_min: number | null
  reason: string | null
  created_at: string | null
  note: string | null
  class_starts_at_utc: string | null
  origem_autor: string | null
}

/**
 * Os créditos do aluno em três baldes — e NENHUM deles decidido aqui.
 *
 * `student_credit_statement` (definida em 20260728000500, REDEFINIDA em
 * 20260730000300) devolve cada crédito do replay do FIFO já classificado pelo
 * banco: vencido pela régua do `business_today()` — a mesma de `makeup_balance`,
 * do e-mail 5 e do painel da admin — e congelado quando o contrato está pausado
 * (F3-D10.2: a retomada devolve os dias parados). Este arquivo só separa em
 * listas e ordena.
 *
 * A6 · LOTE 3 (decisão do dono, 30/07): "congelado" passou a valer para TODO
 * crédito de contrato pausado. Até então a condição excluía o crédito nascido
 * DURANTE a pausa, porque a retomada de fato não o estendia — ele caía em
 * `vivos` com a validade correndo. Agora `resume_contract` estende os dois, e o
 * balde `congelados` conta a história inteira.
 *
 * O QUE MORREU AQUI (revisão adversarial do P3): a classificação vivo/vencido
 * feita em TypeScript com o "hoje" do fuso do ALUNO, que discordava do banco na
 * janela entre as duas viradas de dia; e o `.neq('status','ended')` que jogava
 * crédito de contrato PAUSADO em "Venceram" — dar por perdido o que a retomada
 * vai devolver.
 */
export async function extratoDeCreditos(
  client: SupabaseClient,
  { memoriaDias = MEMORIA_DOS_VENCIDOS_DIAS }: { memoriaDias?: number } = {},
): Promise<LeituraDoExtrato> {
  const vazio = { vivos: [], congelados: [], vencidos: [] }

  const { data, error } = await client.rpc('student_credit_statement', {
    p_memoria_dias: memoriaDias,
  })
  if (error) return { dado: vazio, erro: true }
  // TRUNCAMENTO NÃO É SUCESSO (revisão adversarial 2 · D2): o PostgREST corta
  // toda resposta em `max_rows` (supabase/config.toml:16, hoje 1000) e devolve o
  // corte com 200 — indistinguível de "é isso tudo que existe". Uma resposta NO
  // teto é, por definição, suspeita de estar cortada; a tela prefere o aviso de
  // falha a um extrato pela metade. (O SALDO do Início não depende mais desta
  // leitura: ele vem do agregado `student_credit_totals`, imune ao teto.)
  if (((data ?? []) as unknown[]).length >= LIMITE_DE_LINHAS_DO_POSTGREST)
    return { dado: vazio, erro: true }

  const vivos: CreditoDoAluno[] = []
  const congelados: CreditoDoAluno[] = []
  const vencidos: CreditoDoAluno[] = []

  for (const r of (data ?? []) as LinhaDoExtrato[]) {
    const credito: CreditoDoAluno = {
      ord: Number(r.ord),
      origemId: Number(r.ledger_id),
      contractId: r.contract_id,
      contratoStatus: r.contract_status,
      motivo: r.reason ?? '',
      criadoEmUtc: r.created_at ?? null,
      // `infinity` (crédito sem prazo) já chega como NULL do banco: a palavra
      // que o Postgres usa nunca sai de lá.
      validade: r.expires_on ?? null,
      diasRestantes: r.dias_restantes ?? null,
      vencido: r.vencido === true,
      congelado: r.congelado === true,
      duracaoMin: r.duration_min ?? null,
      nota: r.note ?? null,
      aulaStartsAtUtc: r.class_starts_at_utc ?? null,
      // O banco já filtra para o par conhecido; aqui o `null` é o default
      // honesto para qualquer outra coisa que apareça.
      origemAutor:
        r.origem_autor === 'student' || r.origem_autor === 'teacher' ? r.origem_autor : null,
    }
    if (credito.congelado) congelados.push(credito)
    else if (credito.vencido) vencidos.push(credito)
    else vivos.push(credito)
  }

  // Vivos (e congelados) pelo que vence primeiro, o sem prazo por último;
  // vencidos do mais recente para o mais antigo — é a ordem em que o aluno se
  // lembra deles.
  const porValidade = (a: CreditoDoAluno, b: CreditoDoAluno) =>
    (a.validade ?? '9999-12-31').localeCompare(b.validade ?? '9999-12-31') || a.ord - b.ord
  vivos.sort(porValidade)
  congelados.sort(porValidade)
  vencidos.sort((a, b) => (b.validade ?? '').localeCompare(a.validade ?? '') || a.ord - b.ord)

  return { dado: { vivos, congelados, vencidos }, erro: false }
}

export interface PortalStudent {
  displayName: string
  ianaTz: string
  /** Cidade e país do cadastro — o Perfil os mostra ao lado do fuso (P5 · D8). */
  city: string | null
  country: string | null
}

export interface LeituraDoAluno {
  dado: PortalStudent | null
  erro: boolean
}

export async function portalStudent(client: SupabaseClient): Promise<LeituraDoAluno> {
  const { data, error } = await client
    .from('students')
    .select('display_name, iana_tz, city, country')
    .limit(1)
  if (error) return { dado: null, erro: true }
  const s = one(data)
  return {
    dado: s
      ? {
          displayName: s.display_name,
          ianaTz: s.iana_tz,
          city: s.city ?? null,
          country: s.country ?? null,
        }
      : null,
    erro: false,
  }
}

/* -------------------------------------------------------------------------- */
/* O PERFIL: contato e o combinado aceito (P5 · D8)                            */
/* -------------------------------------------------------------------------- */

export interface ContatoDoAluno {
  whatsappE164: string | null
  /** Quando o aluno deu ciência do canal oficial (`ack_channel_notice`). */
  cienciaEm: string | null
}

export interface LeituraDoContato {
  dado: ContatoDoAluno | null
  erro: boolean
}

/**
 * O contato do aluno, lido da linha DELE em `profiles`.
 *
 * A RLS de `profiles` já limita a `id = auth.uid()`; o filtro por `userId` fica
 * porque a leitura é feita com a sessão dele e um `limit(1)` sem filtro seria
 * confiar na policy para escolher a linha — barato demais para não fazer.
 *
 * `{ dado, erro }` desde o nascimento: falha de leitura NÃO pode virar "você
 * não tem número cadastrado", que é a frase que faz a pessoa digitar de novo o
 * que já estava lá (dívida c14, classe do achado Sol r4-2.2).
 */
export async function contatoDoAluno(
  client: SupabaseClient,
  userId: string,
): Promise<LeituraDoContato> {
  const { data, error } = await client
    .from('profiles')
    .select('whatsapp_e164, whatsapp_channel_ack_at')
    .eq('id', userId)
    .limit(1)
  if (error) return { dado: null, erro: true }
  const p = one(data)
  return {
    dado: p
      ? {
          whatsappE164: p.whatsapp_e164 ?? null,
          cienciaEm: p.whatsapp_channel_ack_at ?? null,
        }
      : null,
    erro: false,
  }
}

export interface AceiteDePolitica {
  /** o tipo do texto (`ciencia-canais`, hoje o único) */
  kind: string
  version: number
  aceitoEm: string
}

export interface LeituraDosAceites {
  dado: AceiteDePolitica[]
  erro: boolean
}

/**
 * O QUE O ALUNO ACEITOU, E QUANDO (P5).
 *
 * `policy_acceptances` guarda o aceite ligado à VERSÃO do texto — é o que dá ao
 * carimbo um significado ("concordou com ISTO", não "clicou no botão"). A RLS
 * (`policy_acceptances_self`) limita às linhas do próprio aluno, e
 * `policy_versions` é legível para o que já está em vigor.
 *
 * Aceite sem versão embutida (leitura parcial do PostgREST) é DESCARTADO em vez
 * de virar "versão ?": um aceite sem texto identificado não prova nada, e a tela
 * prefere mostrar menos a mostrar um registro que não se sustenta.
 */
export async function aceitesDoAluno(client: SupabaseClient): Promise<LeituraDosAceites> {
  const { data, error } = await client
    .from('policy_acceptances')
    .select('accepted_at, policy_versions(kind, version)')
    .order('accepted_at', { ascending: false })
    .limit(20)
  if (error) return { dado: [], erro: true }
  const linhas = (data ?? []) as unknown as {
    accepted_at: string
    policy_versions: { kind: string; version: number } | null
  }[]
  return {
    dado: linhas
      .filter((l) => l.policy_versions != null)
      .map((l) => ({
        kind: l.policy_versions!.kind,
        version: Number(l.policy_versions!.version),
        aceitoEm: l.accepted_at,
      })),
    erro: false,
  }
}

/* -------------------------------------------------------------------------- */
/* O RESGATE DE REPOSIÇÃO (P5) — saldo e validade pela régua do BANCO          */
/* -------------------------------------------------------------------------- */

export interface DadosDoResgate {
  /** reposições vivas neste contrato (`student_credit_totals`) */
  saldo: number
  /** validade do próximo crédito a vencer entre os que AINDA existem */
  proximaValidade: string | null
  /**
   * Duração da aula que o resgate vai criar — a do crédito da vez, e na falta
   * dela a do horário fixo VIGENTE HOJE.
   *
   * `null` quando NENHUMA das duas existe. Não há padrão: era 45 min, e o
   * número saiu (rodada de correção do P5). A RPC `book_reschedule_window`
   * RECUSA o resgate nesse caso — `coalesce(v_credit_dur, v_slot_dur)` nulo
   * levanta "contrato % não tem duração para o resgate". Chutar 45 fazia a tela
   * montar uma grade inteira de horários que o banco ia rejeitar no clique, e
   * pior: se um dia o banco aceitasse, criaria uma aula com uma duração que
   * ninguém combinou. A tela não oferece o que a RPC recusa.
   */
  duracaoMin: number | null
  /** validade do crédito que ESTE resgate consome (o primeiro do FIFO) */
  validadeDoCreditoDaVez: string | null
}

export interface LeituraDoResgate {
  dado: DadosDoResgate | null
  erro: boolean
}

/**
 * O QUE A TELA DE RESGATE PRECISA SABER — e nada decidido aqui.
 *
 * O QUE MORREU (dívida do P3, classe do achado C1). A página perguntava o saldo
 * a `makeup_balance`, a validade a `contract_credit_summary()` e a duração a
 * `_makeup_remaining_credits` filtrado por um "hoje" montado com
 * `new Date().toISOString().slice(0,10)` — três fontes, três réguas:
 *
 *   · `contract_credit_summary()` tira `min()` de TODAS as validades do replay,
 *     incluindo as JÁ VENCIDAS. Um aluno com um crédito vencido em 10/07 e outro
 *     válido até 10/09 lia "vale até 10/07" — a data de um crédito que a tela
 *     não vai gastar (é o mesmo defeito que o P3 corrigiu no Início);
 *   · o "hoje" em UTC decidia vencimento numa virada de dia diferente da do
 *     NEGÓCIO (`business_today()`), que é quem manda no crédito.
 *
 * Agora as duas respostas vêm das funções do P3: `student_credit_totals` (o
 * agregado, imune ao teto de linhas do PostgREST) para saldo e próxima validade,
 * e `student_credit_statement` (o replay do FIFO já classificado pelo banco)
 * para o crédito da VEZ — o primeiro vivo do contrato, que é o que a reserva vai
 * consumir. A RPC que gasta o crédito (`book_reschedule_window`) segue intocada:
 * quem decide o gasto é ela, dentro da transação.
 *
 * A DURAÇÃO CAI NO HORÁRIO FIXO VIGENTE — e a régua do vigente é a da RPC
 * (correção do P5, achado grave). Crédito antigo pode ter nascido sem
 * `duration_min`, e aí quem decide é o horário fixo. Esta função escolhia o slot
 * por `active_to is null` ("o que não terminou"); `book_reschedule_window`
 * escolhe o VIGENTE NO DIA (`active_from <= current_date` e o intervalo aberto
 * ou ainda em vigor — 20260727000700:537). Aluno que troca de horário no fim do
 * mês tem os dois: o de 60min encerrando hoje e o de 30min começando amanhã, com
 * `active_to` nulo. A tela lia o de 30 e oferecia uma grade que a RPC não ia
 * honrar.
 *
 * Agora a leitura chama `contract_active_slot_duration` — a MESMA cláusula, no
 * MESMO relógio do banco (`current_date`). Replicar o WHERE em TypeScript
 * traria um segundo "hoje" e a divergência voltaria por outra porta.
 *
 * Sem crédito com duração E sem slot vigente, `duracaoMin` é `null` e a tela não
 * oferece horário nenhum — é o que a RPC faz (ela levanta exceção).
 */
export async function dadosDoResgate(
  client: SupabaseClient,
  contractId: string,
): Promise<LeituraDoResgate> {
  const [totais, extrato, slot] = await Promise.all([
    creditSummary(client),
    extratoDeCreditos(client),
    client.rpc('contract_active_slot_duration', { p_contract: contractId }),
  ])
  if (totais.erro || extrato.erro || slot.error) return { dado: null, erro: true }

  const doContrato = totais.dado.find((c) => c.contractId === contractId) ?? null
  // Contrato ativo que não aparece no agregado não existe para esta tela — e
  // "não existe" é diferente de "leitura falhou": a página trata como saldo 0 e
  // oferece o caminho de volta, sem aviso de incidente.
  const daVez = extrato.dado.vivos.find((c) => c.contractId === contractId) ?? null
  const duracaoDoSlot = typeof slot.data === 'number' ? slot.data : null

  return {
    dado: {
      saldo: doContrato?.balance ?? 0,
      proximaValidade: doContrato?.nextExpiry ?? null,
      duracaoMin: daVez?.duracaoMin ?? duracaoDoSlot,
      validadeDoCreditoDaVez: daVez?.validade ?? null,
    },
    erro: false,
  }
}
