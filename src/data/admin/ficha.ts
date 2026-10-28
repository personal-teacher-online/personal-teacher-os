import 'server-only'

// CAMADA DE DADOS DA FICHA DO ALUNO (Onda 1 · M3-2) — a leitura única da tela
// `/admin/alunos/[id]`.
//
// Mesma convenção de `home.ts` e `alunos.ts`:
// · UMA função por leitura de tela; a página NÃO faz query inline;
// · o que vem do banco passa por Zod (`FichaDiretorioSchema`) — diretório que
//   mudou de forma estoura AQUI, não pinta `undefined` na ficha da dona;
// · FALHA NUNCA VIRA ESTADO VAZIO: `exigir` confere o `error` e estoura, para o
//   boundary de erro acender em vez de a tela afirmar "nenhum contrato";
// · `server-only` — chave e query não viajam para o navegador;
// · zero regra de negócio (Lei 3): saldo (`makeup_balance`), fila de créditos
//   vivos (`_makeup_remaining_credits`), expiração e situação de contrato vêm
//   calculados do Postgres. Aqui só se lê, valida e formata.
//
// FUSO (Lei 1): tudo que é hora chega à tela como TEXTO pronto, calculado aqui
// com Luxon na zona certa — as aulas no fuso do NEGÓCIO (é a agenda da dona),
// com a hora do aluno junto como leitura auxiliar (`Instante.titulo`), e a hora
// local do aluno na coluna de identidade. Nenhum componente formata data.
//
// A ficha velha (887 linhas) fazia doze leituras inline no meio do JSX. São as
// MESMAS doze aqui — nada de RPC nova, nada de regra nova. O que mudou é o
// lugar.

import { DateTime } from 'luxon'

import type { Instante } from '@/components/kit/instant'
import { BUSINESS_TZ } from '@/lib/brand/constants'
import type { BriefingAnswers } from '@/components/BriefingFields'
import { KOLB_STYLE_LABEL, type VersaoBriefing } from '@/lib/briefing/schema'
import { fmtBRL, fmtCivilDate, tzLabel } from '@/lib/format'
import { slotLine } from '@/lib/slot-line'
import { createClient } from '@/lib/supabase/server'
import { atualizacaoDeBriefingPendente } from '@/lib/portal/data'
import { one } from '@/lib/embed'
import { SITUACAO_ROTULO, situacaoDoAluno, type Acesso, type Situacao } from './alunos-grupos'
import {
  COLUNAS_DO_CONTRATO,
  contarCreditosReservados,
  lerContratosEncerrados,
} from './ficha-consultas'
import {
  ExtrasDoAlunoSchema,
  FichaDiretorioSchema,
  SITUACAO_DO_CONTRATO,
  TIPO_DE_ALUNO,
  type ContratoDaFicha,
} from './ficha-gramatica'

function exigir<T>(leitura: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Ficha do aluno: falha ao ler ${leitura}: ${r.error.message}`)
  return r.data
}

/* ========================================================================== */
/* O que a tela recebe                                                         */
/* ========================================================================== */

/** Espelha os tons "de estado" da `Pill` do kit. `ac2` saiu junto com o tom de
 *  mesmo nome (M3-c1 · C2): ninguém o produzia — a única etiqueta turquesa era
 *  a de nível, que agora tem escala própria (`tone="nivel"`). */
export type Tom = 'ok' | 'warn' | 'danger' | 'neutral' | 'muted' | 'ac'

export interface ProfessoraDaFicha {
  id: string | null
  nome: string | null
  /** índice de cor da professora (a bolinha) — mesma ordem da agenda */
  idx: number
}

export interface HorarioFixo {
  id: string
  /** "terça · 20:30–21:15" no fuso do ALUNO */
  aluno: string
  /** a mesma hora no relógio da professora, só quando diverge */
  professora: string | null
}

export interface PausaDoContrato {
  de: string
  ate: string | null
  aberta: boolean
}

export interface ContratoNaFicha {
  id: string
  tipo: 'private_1on1' | 'mentorship'
  produto: string
  plano: string
  situacao: string
  situacaoRotulo: string
  situacaoTom: Tom
  professora: ProfessoraDaFicha
  turma: string | null
  experimental: boolean
  /** já em reais (Lei 9: centavos no banco, `fmtBRL` na tela) */
  valorHora: string | null
  vigencia: { inicio: string | null; fim: string | null }
  politica: { remarcacoes: number | null; avisoHoras: number | null; validadeDias: number | null }
  horarios: HorarioFixo[]
  pausas: PausaDoContrato[]
  /** saldo de crédito do contrato (só particular) */
  saldo: number | null
  proximaValidade: string | null
  /** onde este contrato se gere hoje (a tela de contratos nasce no M4) */
  gerirEm: string
}

export interface CreditoVivo {
  ledgerId: number
  contratoId: string
  plano: string
  validade: string
  validadeIso: string
  duracaoMin: number | null
  /**
   * `congelado` entrou no A6/lote 3 (prova independente L3): com a pausa, a
   * validade PARA de correr — e a ficha estava chamando de "vencido", em tom
   * `danger`, o mesmo crédito que o portal do aluno mostra como "contagem
   * parada". Duas telas contando histórias opostas sobre o mesmo crédito.
   */
  situacao: 'ok' | 'vencendo' | 'vencido' | 'congelado'
  /** S1 da revisão nº 6: só crédito VIVO e com prazo se estende. Vencido fica
   *  na lista como registro, sem ação — reativar é outra operação, que não
   *  existe (o banco recusa; isto aqui só evita oferecer o gesto). */
  extensivel: boolean
  /** primeira data que o banco aceita como validade nova (atual + 1 dia) */
  minimaNovaValidadeIso: string
  /** a mesma data, já legível (Lei 1: quem formata é o servidor) */
  minimaNovaValidade: string
}

export interface LancamentoDeCredito {
  id: number
  /** "+1" / "−1" — o sinal é o dado, então vai separado do texto */
  sinal: string
  positivo: boolean
  texto: string
  quando: string
  situacao: { rotulo: string; tom: Tom } | null
}

export interface CreditosNaFicha {
  /** o que dá para agendar hoje (`makeup_balance`, somado dos contratos) */
  disponiveis: number
  /** créditos já gastos numa reposição FUTURA e ainda agendada */
  agendados: number
  total: number
  proximaValidade: string | null
  tomDaValidade: Tom
  /**
   * A validade mais próxima está CONGELADA (contrato pausado) — A6/lote 3.
   * As duas telas que mostram essa data decidiam a palavra pelo tom
   * (`danger` = "venceu", senão "vale até"), e nenhuma das duas serve para um
   * prazo parado: quem lê "vale até 12/08" acha que o crédito morre naquele
   * dia. A palavra é a do portal — "valia até … — contagem parada".
   */
  validadeCongelada: boolean
  vivos: CreditoVivo[]
  extrato: LancamentoDeCredito[]
  /** S4: o extrato bateu no teto e há lançamento mais antigo fora da tela */
  extratoTruncado: boolean
}

export interface AulaNaFicha {
  id: string
  instante: Instante
  /** a MESMA aula no relógio do aluno — só quando o fuso dele diverge */
  horaDoAluno: string | null
  situacao: string
  situacaoRotulo: string
  situacaoTom: Tom
  professora: ProfessoraDaFicha
  /** o que foi trabalhado (apontamento D2), quando houver */
  apontamento: string | null
  /** aula que já passou e continua "agendada" — a pendência de desfecho */
  semDesfecho: boolean
  /** para o painel de desfecho, que fala em nome de alguém */
  quem: string
  /**
   * Aula de contrato de GRUPO (casal/turma) — A6, prova independente L2.
   *
   * A ficha é de UM aluno, mas as próximas aulas dela incluem as do contrato de
   * grupo em que ele entra. O diálogo de cancelamento decide as caixas de aviso
   * pela entregabilidade DAQUELE cadastro, e num grupo o enfileiramento é POR
   * MEMBRO (`_enqueue_class_cancelled` percorre `student_group_members`): um par
   * de caixas não espelha N cadastros. Com esta marca, o painel passa
   * `null/null` — o "não sei" que a matriz já tratava na Agenda.
   */
  ehGrupo: boolean
}

export interface CobrancaNaFicha {
  id: string
  competencia: string
  valor: string
  vencimento: string
  situacao: string
  tom: Tom
}

export interface PagadorNaFicha {
  id: string
  nome: string
  email: string | null
  cpfCnpj: string | null
  noAsaas: boolean
  /**
   * F3 (Onda Financeiro): "self" = o pagador É o próprio aluno — a condição
   * que libera o botão da fatura no portal (guarda dentro da view). Promoção
   * é ato manual auditado; o webhook só cria vínculo como terceiro.
   */
  self: boolean
}

/** Uma resposta que mudou numa correção (`briefing_revisions.changes`). */
export interface MudancaDoBriefing {
  /** "historia.cidade_vida" — é a chave do jsonb, e serve de `key` na lista */
  campo: string
  secao: string
  chave: string
  /** valores CRUS: quem sabe virar texto é a leitura (`textoDaResposta`) */
  de: unknown
  para: unknown
}

export interface RevisaoDoBriefing {
  id: string
  /** "28/07/2026 às 14:32", no fuso do NEGÓCIO (Lei 1: quem formata é o servidor) */
  quando: string
  /** o nome de quem corrigiu; cai para o id quando não há perfil com nome */
  quem: string
  motivo: string
  mudancas: MudancaDoBriefing[]
}

export interface BriefingNaFicha {
  enviado: boolean
  rascunho: boolean
  estilo: { chave: string; nome: string; leitura: string } | null
  pontuacoes: { sigla: string; valor: number }[]
  enviadoEm: string | null
  respostas: BriefingAnswers
  /**
   * A versão do questionário SOB A QUAL esta linha foi coletada
   * (`briefings.schema_version`). É ela que escolhe o enunciado de cada chave na
   * leitura e as telas do preenchimento por telefone — rascunho começado no v1
   * termina no v1. Sem linha nenhuma, é a versão que uma linha nova nasceria.
   */
  versao: VersaoBriefing
  /** as letras já respondidas no Kolb (q1..q12) — pré-carga do painel */
  kolb: Record<string, string>
  /** correções pós-envio, da mais recente para a mais antiga */
  revisoes: RevisaoDoBriefing[]
  /**
   * RE-BRIEFING SEMESTRAL pendente (sub-lote 5): o semestre que o aluno ainda
   * não atualizou, ou `null` quando não há nada a atualizar. É a MESMA pergunta
   * que decide o card do Início do aluno (`atualizacaoDeBriefingPendente`) —
   * oferecer "lembrar de atualizar" a quem não veria o convite mandaria a pessoa
   * para uma tela que diz "nada para atualizar agora".
   */
  atualizacaoPendente: { semestre: number } | null
  /**
   * As atualizações semestrais JÁ ENVIADAS, da mais recente para a mais antiga.
   * Elas não corrigem o base — substituem objetivos e interesses NAQUELE ciclo
   * (é o que `briefing_effective` devolve ao plano de estudos). Sem esta lista a
   * ficha mostrava o base como se fosse a resposta atual do aluno.
   */
  atualizacoes: AtualizacaoEnviada[]
}

export interface AtualizacaoEnviada {
  id: string
  semestre: number
  /** "enviada em 28/07/2026", já formatado no servidor (Lei 1) */
  quando: string | null
  /** só objetivos e/ou interesses — é o que a tabela aceita */
  respostas: BriefingAnswers
}

export interface ItemDoPlano {
  id: string
  posicao: number
  titulo: string
  tema: string | null
  href: string | null
  aplicado: boolean
}

export interface PlanoNaFicha {
  id: string
  semestre: number
  nivel: string | null
  aplicados: number
  total: number
  itens: ItemDoPlano[]
}

/**
 * A nota interna da equipe (M3-c5 · D1). `null` = não há nota — a ausência é
 * estado de verdade (a linha nem existe no banco), não string vazia.
 */
export interface NotaInterna {
  texto: string
  /** "atualizada em 27/07/2026", já formatado no servidor (Lei 1) */
  quando: string
}

export interface FichaDoAluno {
  id: string
  nome: string
  nivel: string | null
  /** criança ou adulto (M3-c5 · D1) — o banco fala inglês, a ficha não */
  tipo: 'child' | 'adult'
  tipoRotulo: string
  /** nascimento legível; `null` quando não foi informado (é sempre opcional) */
  nascimento: string | null
  /** o mesmo dado em ISO, que é o que o formulário recarrega */
  nascimentoIso: string | null
  comoConheceu: string | null
  /** visível só para a equipe — NUNCA para o aluno (tabela `student_notes`) */
  notaInterna: NotaInterna | null
  /** SITUAÇÃO no ciclo de vida, DERIVADA — a mesma da badge do hub */
  situacao: Situacao
  situacaoRotulo: string
  arquivado: boolean
  /**
   * O `students.status` ARMAZENADO é `lead` — e não a situação derivada.
   * A diferença importa nas AÇÕES: "lead perdido" só existe para quem o banco
   * conhece como lead (`admin_lose_lead` recusa o resto), enquanto a situação
   * derivada "experimental" também alcança quem nasceu de uma aula
   * experimental já como cadastro ativo.
   */
  ehLead: boolean
  /** "Cuiabá, BR" pronto para leitura (cai para o rótulo do fuso) */
  cidade: string
  /** cidade e país CRUS — é o que o CityPicker recarrega no formulário */
  cidadeCanonica: string | null
  pais: string | null
  /** hora local do aluno, JÁ formatada no servidor (Lei 1) */
  horaLocal: string
  tzRotulo: string
  ianaTz: string
  /**
   * P6 da revisão nº 8 — o fuso ainda é um PALPITE (o cadastro nasceu sem
   * cidade e herdou o da escola). Enquanto for `true`, o banco recusa contrato e
   * horário fixo não-experimentais: a ficha diz isso ANTES, e manda completar o
   * cadastro em vez de oferecer um gesto que só pode falhar.
   */
  fusoAConfirmar: boolean
  acesso: Acesso
  email: string | null
  emailDevolvido: boolean
  whatsapp: string | null
  cienciaDoCanal: string | null
  convidadoEm: string | null
  ultimoAcesso: string | null
  temLogin: boolean
  /** S1: a ficha foi desidentificada e o LOGIN continua vivo */
  bloqueioDeLoginPendente: boolean
  temMentoria: boolean
  contratos: ContratoNaFicha[]
  encerrados: ContratoNaFicha[]
  creditos: CreditosNaFicha
  aulas: { proximas: AulaNaFicha[]; passadas: AulaNaFicha[] }
  cobrancas: CobrancaNaFicha[]
  pagadores: PagadorNaFicha[]
  /** universo para o painel "vincular pagador" */
  pagadoresDisponiveis: { id: string; nome: string }[]
  briefing: BriefingNaFicha | null
  plano: PlanoNaFicha | null
  /** contrato particular ativo — quem recebe "gerar plano do semestre" */
  contratoParaPlano: string | null
  /**
   * B6 · item 4 — AGORA no fuso do NEGÓCIO, no formato de `datetime-local`
   * (`yyyy-MM-ddTHH:mm`). É o teto do campo "quando avisou" do cancelamento:
   * aviso no futuro não existe. Calculado aqui (Lei 1: quem faz conta de fuso é
   * o servidor); o campo só o veste como `max`.
   */
  agoraNoNegocio: string
}

/* ========================================================================== */
/* Vocabulário de desfecho e de pagamento (o mesmo da agenda)                  */
/* ========================================================================== */

const DESFECHO: Record<string, { rotulo: string; tom: Tom }> = {
  scheduled: { rotulo: 'agendada', tom: 'neutral' },
  completed: { rotulo: 'realizada', tom: 'ok' },
  cancelled: { rotulo: 'cancelada', tom: 'muted' },
  rescheduled: { rotulo: 'remarcada', tom: 'muted' },
  no_show_student: { rotulo: 'aluno faltou', tom: 'danger' },
  no_show_teacher: { rotulo: 'professora faltou', tom: 'danger' },
}

const PAGO = new Set(['received', 'confirmed', 'received_in_cash'])

/** S4 — teto do extrato de créditos. O ledger é append-only e cresce para
 *  sempre; a ficha mostra os mais recentes e DIZ quando cortou (nada de tela
 *  que afirma um extrato completo que não é). Nenhum número derivado depende
 *  deste corte: saldo vem do banco, "agendados" tem consulta própria, e o
 *  débito que consome um crédito é sempre MAIS NOVO que ele — logo, se o
 *  crédito está na janela, o consumo dele também está. */
const LIMITE_DO_EXTRATO = 100

const TEMA_AVULSO: Record<string, string> = {
  revisao: 'revisão',
  prova: 'prova',
  extra: 'conteúdo extra',
  conversacao: 'conversação',
  outro: 'outro',
}

/* ========================================================================== */
/* Linhas cruas (o que cada select promete)                                    */
/* ========================================================================== */

interface LinhaDeSlot {
  id: string
  contract_id: string
  weekday: number
  local_time: string
  iana_tz: string
  duration_min: number
  active_to: string | null
}

interface LinhaDeAula {
  id: string
  starts_at_utc: string
  state: string
  teacher_id: string
  contract_id: string
}

interface LinhaDeContrato {
  id: string
  hourly_rate_cents: number | null
  started_on: string | null
  ended_on: string | null
  is_trial: boolean | null
  contract_type: string
  plan_name: string | null
  teacher_id: string | null
  status: string
  /** não-nulo = contrato de GRUPO (casal/turma) — ver `COLUNAS_DO_CONTRATO` */
  student_group_id: string | null
}

interface LinhaDoLedger {
  id: number
  contract_id: string
  delta: number
  reason: string
  class_instance_id: string | null
  expires_on: string | null
  duration_min: number | null
  consumes_ledger_id: number | null
  note: string | null
  created_at: string
}

/* ========================================================================== */
/* A leitura                                                                   */
/* ========================================================================== */

/**
 * N3 — a ficha inteira em UMA função. Devolve `null` quando o id não é de aluno
 * nenhum: quem transforma isso em 404 é a página (a camada de dados não navega).
 */
export async function getStudentFile(id: string): Promise<FichaDoAluno | null> {
  const supabase = await createClient()

  // S2-16b: o diretório omite encerrados — o HISTÓRICO vem direto da tabela
  // (arquivado ≠ inexistente). S3 da revisão nº 6: esta leitura SUBIU para
  // antes do lote grande porque os ids dos contratos encerrados precisam entrar
  // no `in(...)` das leituras de histórico.
  // E4 da revisão nº 7: a busca é pela UNIÃO (vínculo direto ∪ participação em
  // grupo) — o contrato de casal encerrado sumia da ficha dos dois alunos, e
  // levava junto aula, cobrança e extrato dele. A consulta mora em
  // `ficha-consultas.ts` para poder ser provada contra o banco no Vitest.
  const [dirRes, encerradosRes] = await Promise.all([
    supabase.rpc('admin_student_directory', { p_student: id }),
    lerContratosEncerrados(supabase, id),
  ])
  const bruto = FichaDiretorioSchema.parse(exigir('o diretório do aluno', dirRes) ?? [])
  const aluno = bruto[0]
  if (!aluno) return null
  const encerrados = (exigir('os contratos encerrados', encerradosRes) ?? []) as LinhaDeContrato[]

  const contratos = aluno.contracts
  // DOIS conjuntos, de propósito (S3):
  // · `idsAtivos` — o que o diretório devolve (não-encerrados). É o universo do
  //   que se OPERA hoje: saldo, horários fixos, ações.
  // · `ids` — ativos ∪ encerrados. É o universo do HISTÓRICO: aula, cobrança,
  //   lançamento de crédito, pausa e plano de um contrato encerrado continuam
  //   sendo fatos da vida do aluno. Antes eles sumiam da ficha inteira junto
  //   com o contrato.
  const idsAtivos = contratos.map((c) => c.contract_id)
  const ids = Array.from(new Set([...idsAtivos, ...encerrados.map((c) => c.id)]))
  const particulares = contratos.filter((c) => c.contract_type === 'private_1on1')
  const particularesEncerrados = encerrados.filter((c) => c.contract_type === 'private_1on1')
  const idsEncerrados = new Set(encerrados.map((c) => c.id))
  const vazio = { data: [] as never[], error: null }

  const [
    professorasRes,
    slotsRes,
    aulasRes,
    pagamentosRes,
    detalheRes,
    pausasRes,
    ledgerRes,
    briefingRes,
    revisoesRes,
    planosRes,
    vinculosRes,
    todosPagadoresRes,
    cadastroRes,
    notaRes,
    atualizacaoRes,
    atualizacoesEnviadasRes,
  ] = await Promise.all([
    // A ORDEM define a cor da bolinha (dona primeiro, depois alfabética) — a
    // mesma da agenda, do Início e do hub.
    supabase
      .from('teachers')
      .select('id, display_name, is_owner, iana_tz')
      .is('archived_at', null)
      .order('is_owner', { ascending: false })
      .order('display_name'),
    // Horário fixo é OPERAÇÃO (a agenda da semana): só dos contratos vivos.
    idsAtivos.length
      ? supabase
          .from('recurring_slots')
          .select('id, contract_id, weekday, local_time, iana_tz, duration_min, active_to')
          .in('contract_id', idsAtivos)
      : vazio,
    ids.length
      ? supabase
          .from('class_instances')
          .select('id, starts_at_utc, state, teacher_id, contract_id')
          .in('contract_id', ids)
          .order('starts_at_utc', { ascending: false })
          .limit(60)
      : vazio,
    ids.length
      ? supabase
          .from('payments')
          .select('id, contract_id, amount_cents, status, due_date, reference_ym, paid_at')
          .in('contract_id', ids)
          .order('due_date', { ascending: false })
          .limit(12)
      : vazio,
    // Valor e vigência não vêm no jsonb do diretório — vêm da tabela. Só dos
    // vivos: a linha completa dos encerrados já veio na leitura de cima.
    idsAtivos.length
      ? supabase.from('contracts').select(COLUNAS_DO_CONTRATO).in('id', idsAtivos)
      : vazio,
    ids.length
      ? supabase
          .from('contract_pauses')
          .select('contract_id, paused_on, resumed_on')
          .in('contract_id', ids)
          .order('paused_on', { ascending: false })
      : vazio,
    ids.length
      ? supabase
          .from('makeup_ledger')
          .select(
            'id, contract_id, delta, reason, class_instance_id, expires_on, duration_min, consumes_ledger_id, note, created_at',
          )
          .in('contract_id', ids)
          .order('created_at', { ascending: false })
          // +1 para SABER que cortou (o teto de exibição é LIMITE_DO_EXTRATO)
          .limit(LIMITE_DO_EXTRATO + 1)
      : vazio,
    // `schema_version` e `kolb_answers` entraram no briefing v2 (28/07): a
    // versão escolhe o ENUNCIADO de cada chave na leitura (e as telas do
    // preenchimento por telefone), e as letras do Kolb são a pré-carga daquele
    // painel — antes ele abria com `kolb={{}}` e apagava o que já havia.
    supabase
      .from('briefings')
      .select('status, kolb_style, kolb_scores, answers, submitted_at, schema_version, kolb_answers')
      .eq('student_id', id)
      .maybeSingle(),
    // A trilha de correção pós-envio (append-only; RLS só para a admin).
    supabase
      .from('briefing_revisions')
      .select('id, actor, reason, changes, created_at')
      .eq('student_id', id)
      .order('created_at', { ascending: false }),
    ids.length
      ? supabase
          .from('study_plans')
          .select('id, contract_id, semester_no, level_snapshot')
          .in('contract_id', ids)
          .order('semester_no', { ascending: false })
      : vazio,
    supabase
      .from('student_payers')
      .select('payer_id, relationship, payers(id, name, email, cpf_cnpj, asaas_customer_id)')
      .eq('student_id', id),
    supabase.from('payers').select('id, name').order('name'),
    // O que o diretório NÃO devolve: os campos de cadastro do M3-c5 · D1 e a
    // pendência de bloqueio de login. Uma leitura só (era só a pendência).
    supabase
      .from('students')
      .select('student_type, birth_date, referral_source, auth_cleanup_profile_id, tz_confirmed')
      .eq('id', id)
      .maybeSingle(),
    // A NOTA INTERNA mora em tabela própria porque o portal lê a linha de
    // `students` do próprio aluno e RLS não filtra coluna. Aqui a leitura é da
    // admin; a professora lê a dela pelas policies (`student_notes_teacher`).
    supabase
      .from('student_notes')
      .select('note, updated_at')
      .eq('student_id', id)
      .maybeSingle(),
    // O re-briefing semestral pendente — a MESMA função (e a mesma RPC) que
    // decide o card do Início do aluno, com o aluno dito por fora: aqui a sessão
    // é da admin, que enxerga todo mundo.
    atualizacaoDeBriefingPendente(supabase, { studentId: id }),
    // As atualizações semestrais JÁ ENVIADAS (revisão de integração, achado 6):
    // sem elas a aba de briefing mostrava só o base, e a dona lia "quer inglês
    // para trabalho" enquanto o plano do semestre era montado sobre "imigração".
    supabase
      .from('briefing_updates')
      .select('id, semester_no, submitted_at, answers')
      .eq('student_id', id)
      .eq('status', 'submitted')
      .order('semester_no', { ascending: false }),
  ])

  const professoras = (exigir('as professoras', professorasRes) ?? []) as {
    id: string
    display_name: string
    iana_tz: string | null
  }[]
  const idxDaProfessora = new Map(professoras.map((t, i) => [t.id, i]))
  const nomeDaProfessora = new Map(professoras.map((t) => [t.id, t.display_name]))
  const tzDaProfessora = new Map(professoras.map((t) => [t.id, t.iana_tz]))
  const professoraDe = (teacherId: string | null): ProfessoraDaFicha => ({
    id: teacherId,
    nome: teacherId ? (nomeDaProfessora.get(teacherId) ?? null) : null,
    idx: teacherId ? (idxDaProfessora.get(teacherId) ?? 0) : 0,
  })

  const slots = (exigir('os horários fixos', slotsRes) ?? []) as LinhaDeSlot[]
  const aulas = (exigir('as aulas', aulasRes) ?? []) as LinhaDeAula[]
  const pagamentos = (exigir('as cobranças', pagamentosRes) ?? []) as {
    id: string
    amount_cents: number | null
    status: string | null
    due_date: string | null
    reference_ym: string | null
    paid_at: string | null
  }[]
  const detalhe = (exigir('os contratos', detalheRes) ?? []) as LinhaDeContrato[]
  const pausas = (exigir('as pausas', pausasRes) ?? []) as {
    contract_id: string
    paused_on: string
    resumed_on: string | null
  }[]
  const ledgerBruto = (exigir('o extrato de créditos', ledgerRes) ?? []) as LinhaDoLedger[]
  const extratoTruncado = ledgerBruto.length > LIMITE_DO_EXTRATO
  const ledger = ledgerBruto.slice(0, LIMITE_DO_EXTRATO)
  const briefingRow = exigir('o briefing', briefingRes) as {
    status: string | null
    kolb_style: string | null
    kolb_scores: Record<string, number> | null
    answers: BriefingAnswers | null
    submitted_at: string | null
    schema_version: number | null
    kolb_answers: Record<string, string> | null
  } | null
  const revisoesBrutas = (exigir('as correções do briefing', revisoesRes) ?? []) as {
    id: string
    actor: string
    reason: string
    changes: Record<string, { de?: unknown; para?: unknown }> | null
    created_at: string
  }[]
  const planos = (exigir('os planos de estudo', planosRes) ?? []) as {
    id: string
    contract_id: string
    semester_no: number
    level_snapshot: string | null
  }[]
  const vinculos = (exigir('os pagadores do aluno', vinculosRes) ?? []) as {
    payers: unknown
  }[]
  const todosPagadores = (exigir('a lista de pagadores', todosPagadoresRes) ?? []) as {
    id: string
    name: string
  }[]
  const cadastroBruto = exigir('os campos de cadastro do aluno', cadastroRes)
  const cadastro = cadastroBruto ? ExtrasDoAlunoSchema.parse(cadastroBruto) : null
  const notaRow = exigir('a nota interna', notaRes) as {
    note: string
    updated_at: string
  } | null

  // Relógio por request é intencional (Server Component).
  const agora = DateTime.now()
  const agoraMs = agora.toMillis()
  const localDoAluno = agora.setZone(aluno.iana_tz)
  const hoje = agora.setZone(BUSINESS_TZ).toFormat('yyyy-LL-dd')
  const daquiA30 = agora.setZone(BUSINESS_TZ).plus({ days: 30 }).toFormat('yyyy-LL-dd')

  /* ---------------------------------------------------------------- contratos */

  const detalhePorId = new Map(detalhe.map((c) => [c.id, c]))
  const pausasPorContrato = new Map<string, PausaDoContrato[]>()
  for (const p of pausas) {
    const lista = pausasPorContrato.get(p.contract_id) ?? []
    lista.push({
      de: fmtCivilDate(p.paused_on),
      ate: p.resumed_on ? fmtCivilDate(p.resumed_on) : null,
      aberta: !p.resumed_on,
    })
    pausasPorContrato.set(p.contract_id, lista)
  }

  /**
   * A PAUSA ABERTA de cada contrato, em data civil crua (A6/lote 3 · prova
   * independente L3).
   *
   * É o mesmo dado que `student_credit_statement` lê para decidir o congelado
   * (`contract_pauses` com `resumed_on is null`, `order by paused_on limit 1`),
   * e o desempate é o MESMO — a pausa aberta mais ANTIGA. Duas telas que falam
   * do mesmo crédito não podem escolher pausas diferentes.
   */
  const pausaAbertaEm = new Map<string, string>()
  for (const p of pausas) {
    if (p.resumed_on) continue
    const atual = pausaAbertaEm.get(p.contract_id)
    if (!atual || p.paused_on < atual) pausaAbertaEm.set(p.contract_id, p.paused_on)
  }

  const horariosDoContrato = (contratoId: string, teacherId: string | null): HorarioFixo[] =>
    slots
      .filter((s) => s.contract_id === contratoId && !s.active_to)
      .map((s) => {
        const linha = slotLine(s, teacherId ? tzDaProfessora.get(teacherId) : null)
        return { id: s.id, aluno: linha.aluno, professora: linha.prof }
      })

  const montarContrato = (
    base: {
      id: string
      tipo: 'private_1on1' | 'mentorship'
      plano: string
      situacao: string
      teacherId: string | null
      turma: string | null
      saldo: number | null
      proximaValidade: string | null
      politica: ContratoNaFicha['politica']
    },
    linha: LinhaDeContrato | undefined,
  ): ContratoNaFicha => ({
    id: base.id,
    tipo: base.tipo,
    produto: base.tipo === 'mentorship' ? 'Personal Travel' : 'Aulas particulares',
    plano: base.plano,
    situacao: base.situacao,
    situacaoRotulo: SITUACAO_DO_CONTRATO[base.situacao] ?? base.situacao,
    situacaoTom: base.situacao === 'active' ? 'ok' : base.situacao === 'paused' ? 'warn' : 'muted',
    professora: professoraDe(base.teacherId),
    turma: base.turma,
    experimental: Boolean(linha?.is_trial),
    valorHora: linha?.hourly_rate_cents != null ? fmtBRL(linha.hourly_rate_cents) : null,
    vigencia: {
      inicio: linha?.started_on ? fmtCivilDate(linha.started_on) : null,
      fim: linha?.ended_on ? fmtCivilDate(linha.ended_on) : null,
    },
    politica: base.politica,
    horarios: horariosDoContrato(base.id, base.teacherId),
    pausas: pausasPorContrato.get(base.id) ?? [],
    saldo: base.saldo,
    proximaValidade: base.proximaValidade ? fmtCivilDate(base.proximaValidade) : null,
    // M4-2: o particular passa a ter DETALHE próprio, então "Gerir em Contratos"
    // abre o contrato certo em vez de despejar a dona na lista inteira. A
    // mentoria continua na tela dela, que é onde o Personal Travel se gere.
    gerirEm: base.tipo === 'mentorship' ? '/admin/mentoria' : `/admin/contratos/${base.id}`,
  })

  const doDiretorio = (c: ContratoDaFicha): ContratoNaFicha =>
    montarContrato(
      {
        id: c.contract_id,
        tipo: c.contract_type,
        plano: c.plan_name ?? 'Contrato',
        situacao: c.status,
        teacherId: c.teacher_id,
        turma: c.group_label,
        saldo: c.contract_type === 'private_1on1' ? (c.balance ?? 0) : null,
        proximaValidade: c.next_expiry ?? null,
        politica: {
          remarcacoes: c.monthly_reschedule_allowance ?? null,
          avisoHoras: c.min_notice_hours ?? null,
          validadeDias: c.makeup_credit_expiry_days ?? null,
        },
      },
      detalhePorId.get(c.contract_id),
    )

  const daTabela = (c: LinhaDeContrato): ContratoNaFicha =>
    montarContrato(
      {
        id: c.id,
        tipo: c.contract_type === 'mentorship' ? 'mentorship' : 'private_1on1',
        plano: c.plan_name ?? 'Contrato',
        situacao: c.status,
        teacherId: c.teacher_id,
        turma: null,
        saldo: null,
        proximaValidade: null,
        politica: { remarcacoes: null, avisoHoras: null, validadeDias: null },
      },
      c,
    )

  /* ---------------------------------------------------------------- créditos */

  const aulaPorId = new Map(aulas.map((a) => [a.id, a]))

  // Fila VIVA do FIFO, por contrato: é ela que dá identidade a cada crédito
  // (`ledger_id`) — e é o `ledger_id` que a extensão de validade precisa.
  // S4 da revisão nº 6: era um `await` por contrato DENTRO do laço (N+1 em
  // série). São 1–3 contratos por aluno, então `Promise.all` já resolve com
  // diff mínimo. Se um dia virar dezenas, o certo é UMA RPC consolidada no
  // banco devolvendo a fila de vários contratos — anotado, não construído
  // (sem gold-plating: a escala-alvo é 50 alunos).
  const contratosComCredito = [
    ...particulares.map((c) => ({
      id: c.contract_id,
      plano: c.plan_name ?? 'Contrato',
      ativo: true,
      // E2 da revisão nº 7: o crédito de contrato PAUSADO está congelado
      // (F3-D10) e quem estende a validade dele é a RETOMADA, pelos dias
      // parados. A RPC recusa a extensão manual; a ficha esconde o lápis, para
      // a tela não oferecer um gesto que só pode falhar.
      podeEstender: c.status === 'active',
      // …e desde o A6/lote 3 o congelamento é COMPLETO (a retomada estende todo
      // crédito parado). A ficha precisa do estado para não chamar de "vencido"
      // o que o portal chama de "contagem parada" — ver `situacaoDoCredito`.
      pausado: c.status === 'paused',
      pausaEm: pausaAbertaEm.get(c.contract_id) ?? null,
    })),
    // Contrato ENCERRADO entra só para o extrato saber rotular a linha (S3):
    // crédito de contrato morto não é saldo nem se estende.
    ...particularesEncerrados.map((c) => ({
      id: c.id,
      plano: c.plan_name ?? 'Contrato',
      ativo: false,
      podeEstender: false,
      pausado: false,
      pausaEm: null,
    })),
  ]

  const [filas, agendadosRes] = await Promise.all([
    Promise.all(
      contratosComCredito.map(async (c) => ({
        c,
        r: await supabase.rpc('_makeup_remaining_credits', { p_contract: c.id }),
      })),
    ),
    // AGENDADOS: crédito já GASTO numa reposição que ainda vai acontecer. Não é
    // regra de negócio nova (o saldo continua vindo do banco) — é a leitura que
    // o cartão Make-Up do TutorBird faz: Total = disponíveis + reservados.
    // E5 da revisão nº 7 + P3 da nº 8: a conta é feita DENTRO do banco, por
    // TODOS os ids de contrato e SEGUINDO a cadeia de remarcação (o débito fica
    // na aula original, que vira `rescheduled`).
    contarCreditosReservados(supabase, ids),
  ])

  const vivos: CreditoVivo[] = []
  /** todo crédito ainda NÃO consumido (vivo ou vencido, de contrato vivo ou
   *  encerrado) — é o que o extrato usa para não chamar de "substituído" o que
   *  está de pé. */
  const naFila = new Set<number>()
  for (const { c, r } of filas) {
    const linhas = (exigir('a fila de créditos', r) ?? []) as {
      ledger_id: number
      expires_on: string
      duration_min: number | null
    }[]
    for (const l of linhas) {
      naFila.add(Number(l.ledger_id))
      if (!c.ativo) continue
      // 'infinity' é crédito sem validade (não é data para mostrar nem estender)
      const infinito = String(l.expires_on).startsWith('infinity')
      const minimaIso = infinito
        ? ''
        : DateTime.fromISO(l.expires_on).plus({ days: 1 }).toFormat('yyyy-LL-dd')
      // A6/lote 3 · prova independente L3: contrato PAUSADO congela a validade.
      // A régua é, item por item, a de `student_credit_statement` (o banco):
      // contrato 'paused' COM pausa aberta registrada, crédito COM prazo, e
      // crédito ainda vivo no início da pausa — quem já tinha morrido antes da
      // pausa não foi congelado, foi enterrado.
      const congelado =
        c.pausado && c.pausaEm !== null && !infinito && l.expires_on >= c.pausaEm
      const situacao: CreditoVivo['situacao'] = congelado
        ? 'congelado'
        : infinito
          ? 'ok'
          : l.expires_on < hoje
            ? 'vencido'
            : l.expires_on <= daquiA30
              ? 'vencendo'
              : 'ok'
      vivos.push({
        ledgerId: Number(l.ledger_id),
        contratoId: c.id,
        plano: c.plano,
        validade: infinito ? 'sem prazo' : fmtCivilDate(l.expires_on),
        validadeIso: infinito ? '' : l.expires_on,
        duracaoMin: l.duration_min,
        situacao,
        // `podeEstender` já é falso em contrato pausado (a RPC recusa), então o
        // congelado nunca oferece o lápis — a extensão dele é a RETOMADA.
        extensivel: c.podeEstender && !infinito && situacao !== 'vencido',
        minimaNovaValidadeIso: minimaIso,
        minimaNovaValidade: minimaIso ? fmtCivilDate(minimaIso) : '',
      })
    }
  }
  vivos.sort((a, b) => a.validadeIso.localeCompare(b.validadeIso))

  const disponiveis = particulares.reduce((s, c) => s + (c.balance ?? 0), 0)

  const agendados = exigir('os créditos já reservados', agendadosRes) ?? 0

  const proximoVivo = vivos.find((v) => v.validadeIso)
  const tomDaValidade: Tom = !proximoVivo
    ? 'muted'
    : // A6/lote 3: crédito congelado não é alarme nenhum — a contagem está
      // parada, e o tom neutro é o que combina com o que o portal mostra ao
      // aluno. `vencido` continua vermelho para quem de fato venceu.
      proximoVivo.situacao === 'congelado'
      ? 'muted'
      : proximoVivo.situacao === 'vencido'
        ? 'danger'
        : proximoVivo.situacao === 'vencendo'
          ? 'warn'
          : 'ok'

  const consumidos = new Set(
    ledger.filter((r) => r.delta < 0 && r.consumes_ledger_id != null).map((r) => Number(r.consumes_ledger_id)),
  )

  const instanteDaAula = (utc: string): Instante => ({
    texto: DateTime.fromISO(utc).setZone(BUSINESS_TZ).setLocale('pt-BR').toFormat("ccc dd/LL 'às' HH:mm"),
    iso: utc,
    titulo:
      aluno.iana_tz === BUSINESS_TZ
        ? undefined
        : `${DateTime.fromISO(utc).setZone(aluno.iana_tz).setLocale('pt-BR').toFormat('HH:mm')} para o aluno (${tzLabel(aluno.iana_tz)})`,
  })

  const textoDoLancamento = (r: LinhaDoLedger): string => {
    const aula = r.class_instance_id ? aulaPorId.get(r.class_instance_id) : undefined
    const daAula = aula ? ` — aula de ${instanteDaAula(aula.starts_at_utc).texto}` : ''
    if (r.delta > 0) {
      if (r.reason === 'refund') return `Crédito devolvido${daAula}`
      // A5/L5 (Sol · rodada 2, grave): dizia "por cancelamento da escola" para
      // TODO `earn_cancellation`, e o motivo tem três nascentes diferentes —
      // `_cancel_class_core` com `p_cancelled_by='teacher'`, `_mark_no_show` com
      // `p_who='teacher'` (falta da professora, que não é cancelamento nenhum) e
      // os lançamentos HISTÓRICOS anteriores à ADR-018, em que o cancelamento do
      // ALUNO com aviso também creditava. A frase acusava a escola de uma falha
      // que às vezes foi decisão do aluno, e escondia a falta da professora.
      //
      // Esta leitura não tem o AUTOR: o ledger não o guarda, e quem o expõe é
      // `student_credit_statement.origem_autor` (a RPC do portal, que lê o audit
      // da aula). Sem autor demonstrável, a regra da casa é a MESMA do histórico
      // da agenda — conta o FATO e não nomeia ninguém. Trazer o autor para cá é
      // consulta nova, anotada como dívida.
      if (r.reason === 'earn_cancellation') return `Crédito por aula perdida${daAula}`
      if (r.reason === 'initial_backlog') return 'Crédito inicial (saldo trazido)'
      return r.note ? `Crédito lançado pela escola — ${r.note}` : 'Crédito lançado pela escola'
    }
    if (r.reason === 'spend_reschedule') return `Crédito usado numa reposição${daAula}`
    if (r.reason === 'expire') return 'Crédito vencido sem uso'
    return r.note ? `Ajuste da escola — ${r.note}` : 'Ajuste da escola'
  }

  const extrato: LancamentoDeCredito[] = ledger.map((r) => ({
    id: r.id,
    sinal: r.delta > 0 ? `+${r.delta}` : `−${-r.delta}`,
    positivo: r.delta > 0,
    texto: textoDoLancamento(r),
    quando: DateTime.fromISO(r.created_at).setZone(BUSINESS_TZ).setLocale('pt-BR').toFormat('dd/LL/yyyy'),
    situacao:
      r.delta < 0
        ? null
        : naFila.has(r.id)
          ? idsEncerrados.has(r.contract_id)
            ? // S3: o crédito nunca foi gasto, mas o contrato dele morreu —
              // dizer "vale até" seria prometer um saldo que não existe.
              { rotulo: 'contrato encerrado', tom: 'muted' as Tom }
            : { rotulo: `vale até ${r.expires_on ? fmtCivilDate(r.expires_on) : 'sem prazo'}`, tom: 'ok' as Tom }
          : consumidos.has(r.id)
            ? { rotulo: 'usado', tom: 'muted' }
            : r.expires_on && r.expires_on < hoje
              ? { rotulo: 'venceu sem uso', tom: 'danger' }
              : { rotulo: 'substituído', tom: 'muted' },
  }))

  /* ------------------------------------------------------------------- aulas */

  const apontamentoIds = aulas.map((a) => a.id)
  const apontamentosRes = apontamentoIds.length
    ? await supabase
        .from('class_content_reports')
        .select('class_instance_id, plan_item_id, off_track_kind, off_track_note')
        .in('class_instance_id', apontamentoIds)
    : vazio
  const apontamentos = (exigir('os apontamentos de aula', apontamentosRes) ?? []) as {
    class_instance_id: string
    plan_item_id: string | null
    off_track_kind: string | null
    off_track_note: string | null
  }[]

  /* ------------------------------------------------------ plano de estudos */

  // S3: os planos agora chegam de TODOS os contratos (histórico). O que a aba
  // desenha continua sendo o do contrato VIVO — só cai para o do encerrado
  // quando não há contrato vivo com plano (aluno que parou: é o único plano
  // que ele tem, e escondê-lo era a cegueira que o achado descreve).
  const planoAtual = planos.find((p) => !idsEncerrados.has(p.contract_id)) ?? planos[0] ?? null
  const itensRes = planoAtual
    ? await supabase
        .from('study_plan_items')
        .select('id, position, title, theme, flexge_lesson_href')
        .eq('plan_id', planoAtual.id)
        .order('position')
    : vazio
  const itens = (exigir('os itens do plano', itensRes) ?? []) as {
    id: string
    position: number
    title: string
    theme: string | null
    flexge_lesson_href: string | null
  }[]
  const aplicados = new Set(apontamentos.map((a) => a.plan_item_id).filter(Boolean) as string[])
  // O apontamento pode citar um item de plano de OUTRO semestre; a cobertura só
  // conta o que está no plano em exibição.
  const tituloDoItem = new Map(itens.map((i) => [i.id, i.title]))

  const apontamentoPorAula = new Map(
    apontamentos.map((a) => [
      a.class_instance_id,
      a.plan_item_id
        ? (tituloDoItem.get(a.plan_item_id) ?? 'módulo do plano')
        : [TEMA_AVULSO[a.off_track_kind ?? ''] ?? a.off_track_kind, a.off_track_note]
            .filter(Boolean)
            .join(' — '),
    ]),
  )

  // A6 (prova independente L2): os contratos de GRUPO deste aluno, por id — a
  // união do que veio da tabela (vivos) com o que veio do histórico
  // (encerrados). Sem N+1: a coluna entrou nas duas consultas que já existiam.
  const contratosDeGrupo = new Set(
    [...detalhe, ...encerrados]
      .filter((c) => c.student_group_id != null)
      .map((c) => c.id),
  )

  const montarAula = (a: LinhaDeAula): AulaNaFicha => {
    const passou = DateTime.fromISO(a.starts_at_utc).toMillis() < agoraMs
    const semDesfecho = passou && a.state === 'scheduled'
    const d = DESFECHO[a.state] ?? { rotulo: a.state, tom: 'muted' as Tom }
    return {
      id: a.id,
      instante: instanteDaAula(a.starts_at_utc),
      // A ficha velha mostrava isto ao lado da hora, não num `title`: com aluno
      // em Orlando ou Lisboa, "que horas são para ELE" é dado de trabalho.
      horaDoAluno:
        aluno.iana_tz === BUSINESS_TZ
          ? null
          : DateTime.fromISO(a.starts_at_utc).setZone(aluno.iana_tz).toFormat('HH:mm'),
      situacao: a.state,
      situacaoRotulo: semDesfecho ? 'sem registro' : d.rotulo,
      situacaoTom: semDesfecho ? 'warn' : d.tom,
      professora: professoraDe(a.teacher_id),
      apontamento: apontamentoPorAula.get(a.id) ?? null,
      semDesfecho,
      quem: aluno.display_name,
      ehGrupo: contratosDeGrupo.has(a.contract_id),
    }
  }

  const proximas = aulas
    .filter((a) => a.state === 'scheduled' && DateTime.fromISO(a.starts_at_utc).toMillis() >= agoraMs)
    .sort((x, y) => x.starts_at_utc.localeCompare(y.starts_at_utc))
    .slice(0, 8)
    .map(montarAula)
  const passadas = aulas
    .filter((a) => DateTime.fromISO(a.starts_at_utc).toMillis() < agoraMs)
    .slice(0, 12)
    .map(montarAula)

  /* -------------------------------------------------------------- pagadores */

  const pagadores: PagadorNaFicha[] = vinculos
    .map((v) => ({
      p: one(v.payers) as {
        id: string
        name: string
        email: string | null
        cpf_cnpj: string | null
        asaas_customer_id: string | null
      } | null,
      // F3: quem decide o botão da fatura é este vínculo (self × terceiro)
      self: (v as { relationship?: string }).relationship === 'self',
    }))
    .filter((x): x is typeof x & { p: NonNullable<(typeof x)['p']> } => Boolean(x.p))
    .map(({ p, self }) => ({
      id: p.id,
      nome: p.name,
      email: p.email,
      cpfCnpj: p.cpf_cnpj,
      noAsaas: Boolean(p.asaas_customer_id),
      self,
    }))

  /* --------------------------------------------------------------- briefing */

  // Quem corrigiu: o `actor` é o `auth.uid()` da admin, e o nome mora em
  // `profiles`. Leitura só quando há correção (é o caso raro) — e sem nome, a
  // linha mostra o id em vez de esconder o autor.
  const atores = Array.from(new Set(revisoesBrutas.map((r) => r.actor)))
  const perfisRes = atores.length
    ? await supabase.from('profiles').select('id, full_name').in('id', atores)
    : vazio
  const nomeDoAtor = new Map(
    ((exigir('os autores das correções', perfisRes) ?? []) as { id: string; full_name: string }[]).map(
      (p) => [p.id, p.full_name],
    ),
  )

  const revisoes: RevisaoDoBriefing[] = revisoesBrutas.map((r) => ({
    id: r.id,
    quando: DateTime.fromISO(r.created_at)
      .setZone(BUSINESS_TZ)
      .setLocale('pt-BR')
      .toFormat("dd/LL/yyyy 'às' HH:mm"),
    quem: nomeDoAtor.get(r.actor) ?? r.actor,
    motivo: r.reason,
    mudancas: Object.entries(r.changes ?? {}).map(([campo, valor]) => {
      const corte = campo.indexOf('.')
      return {
        campo,
        secao: corte > 0 ? campo.slice(0, corte) : campo,
        chave: corte > 0 ? campo.slice(corte + 1) : campo,
        de: valor?.de ?? null,
        para: valor?.para ?? null,
      }
    }),
  }))

  // Leitura que falhou NÃO vira "não há atualização pendente": esconder o botão
  // por causa de um PostgREST fora do ar é a mesma classe de erro que o resto
  // desta função trata com `exigir` — a ficha grita, ninguém decide no escuro.
  if (atualizacaoRes.erro) {
    throw new Error('Ficha do aluno: falha ao ler a atualização de briefing pendente')
  }
  const atualizacaoPendente = atualizacaoRes.pendente
    ? { semestre: atualizacaoRes.pendente.semesterNo }
    : null

  const atualizacoes: AtualizacaoEnviada[] = (
    (exigir('as atualizações do briefing', atualizacoesEnviadasRes) ?? []) as {
      id: string
      semester_no: number
      submitted_at: string | null
      answers: BriefingAnswers | null
    }[]
  ).map((u) => ({
    id: u.id,
    semestre: u.semester_no,
    quando: u.submitted_at ? fmtCivilDate(String(u.submitted_at).slice(0, 10)) : null,
    respostas: (u.answers ?? {}) as BriefingAnswers,
  }))

  const kolb = briefingRow?.kolb_style ? KOLB_STYLE_LABEL[briefingRow.kolb_style] : undefined
  const briefing: BriefingNaFicha | null = briefingRow
    ? {
        enviado: briefingRow.status === 'submitted',
        rascunho: briefingRow.status !== 'submitted',
        estilo:
          briefingRow.kolb_style && kolb
            ? { chave: briefingRow.kolb_style, nome: kolb.nome, leitura: kolb.leitura }
            : briefingRow.kolb_style
              ? { chave: briefingRow.kolb_style, nome: briefingRow.kolb_style, leitura: '' }
              : null,
        pontuacoes: Object.entries(briefingRow.kolb_scores ?? {}).map(([sigla, valor]) => ({
          sigla,
          valor: Number(valor),
        })),
        enviadoEm: briefingRow.submitted_at
          ? fmtCivilDate(String(briefingRow.submitted_at).slice(0, 10))
          : null,
        respostas: (briefingRow.answers ?? {}) as BriefingAnswers,
        // Linha antiga (anterior à coluna) e linha nova nascem em réguas
        // diferentes: só o 1 explícito manda para o v1.
        versao: briefingRow.schema_version === 1 ? 1 : 2,
        kolb: briefingRow.kolb_answers ?? {},
        revisoes,
        atualizacaoPendente,
        atualizacoes,
      }
    : null

  const acesso: Acesso = !aluno.profile_id ? 'sem_convite' : aluno.email_confirmed ? 'ativo' : 'pendente'

  // `aluno.contracts` é o jsonb do diretório (só os não-encerrados, com
  // `is_trial`) — exatamente o insumo que a derivação do hub recebe.
  const situacaoDaFicha: Situacao = situacaoDoAluno({
    status: aluno.status,
    contratos: aluno.contracts,
  })

  const tipo = cadastro?.student_type ?? 'adult'
  const nascimentoIso = cadastro?.birth_date ? String(cadastro.birth_date).slice(0, 10) : null

  // B6 · item 2 — o painel de pagador oferece só quem NÃO está vinculado.
  // Oferecer alguém que já está na lista é convidar para um erro que o banco
  // recusa (a chave de `student_payers` é o par aluno+pagador).
  const jaVinculados = new Set(pagadores.map((p) => p.id))

  return {
    id: aluno.id,
    nome: aluno.display_name,
    nivel: aluno.level,
    tipo,
    tipoRotulo: TIPO_DE_ALUNO[tipo],
    nascimento: nascimentoIso ? fmtCivilDate(nascimentoIso) : null,
    nascimentoIso,
    comoConheceu: cadastro?.referral_source ?? null,
    notaInterna: notaRow
      ? {
          texto: notaRow.note,
          quando: fmtCivilDate(String(notaRow.updated_at).slice(0, 10)),
        }
      : null,
    // Ciclo de vida (fase 1): a MESMA derivação do hub, com os MESMOS contratos
    // — a ficha não pode chamar de "ativo" quem a lista chama de "experimental".
    situacao: situacaoDaFicha,
    situacaoRotulo: SITUACAO_ROTULO[situacaoDaFicha],
    arquivado: aluno.status === 'archived',
    ehLead: aluno.status === 'lead',
    cidade: [aluno.city, aluno.country].filter(Boolean).join(', ') || tzLabel(aluno.iana_tz),
    cidadeCanonica: aluno.city,
    pais: aluno.country,
    horaLocal: localDoAluno.isValid ? localDoAluno.toFormat('HH:mm') : '—',
    tzRotulo: tzLabel(aluno.iana_tz),
    ianaTz: aluno.iana_tz,
    fusoAConfirmar: cadastro ? !cadastro.tz_confirmed : false,
    acesso,
    email: aluno.email,
    emailDevolvido: Boolean(aluno.email_bounced_at),
    whatsapp: aluno.whatsapp_e164,
    cienciaDoCanal: aluno.whatsapp_channel_ack_at
      ? fmtCivilDate(String(aluno.whatsapp_channel_ack_at).slice(0, 10))
      : null,
    convidadoEm: aluno.invited_at ? fmtCivilDate(String(aluno.invited_at).slice(0, 10)) : null,
    ultimoAcesso: aluno.last_sign_in_at
      ? fmtCivilDate(String(aluno.last_sign_in_at).slice(0, 10))
      : null,
    temLogin: Boolean(aluno.profile_id),
    bloqueioDeLoginPendente: Boolean(cadastro?.auth_cleanup_profile_id),
    temMentoria: contratos.some((c) => c.contract_type === 'mentorship'),
    contratos: contratos.map(doDiretorio),
    encerrados: encerrados.map(daTabela),
    creditos: {
      disponiveis,
      agendados,
      total: disponiveis + agendados,
      proximaValidade: proximoVivo?.validade ?? null,
      tomDaValidade,
      validadeCongelada: proximoVivo?.situacao === 'congelado',
      vivos,
      extrato,
      extratoTruncado,
    },
    aulas: { proximas, passadas },
    cobrancas: pagamentos.map((p) => {
      const paga = Boolean(p.paid_at) || PAGO.has((p.status ?? '').toLowerCase())
      const vencida = !paga && !!p.due_date && p.due_date < hoje
      return {
        id: p.id,
        competencia: p.reference_ym ?? '—',
        valor: p.amount_cents != null ? fmtBRL(p.amount_cents) : '—',
        vencimento: p.due_date ? fmtCivilDate(p.due_date) : '—',
        situacao: paga ? 'paga' : vencida ? 'vencida' : 'em aberto',
        tom: (paga ? 'ok' : vencida ? 'danger' : 'neutral') as Tom,
      }
    }),
    pagadores,
    pagadoresDisponiveis: todosPagadores
      .filter((p) => !jaVinculados.has(p.id))
      .map((p) => ({ id: p.id, nome: p.name })),
    briefing,
    plano: planoAtual
      ? {
          id: planoAtual.id,
          semestre: planoAtual.semester_no,
          nivel: planoAtual.level_snapshot,
          aplicados: itens.filter((i) => aplicados.has(i.id)).length,
          total: itens.length,
          itens: itens.map((i) => ({
            id: i.id,
            posicao: i.position,
            titulo: i.title,
            tema: i.theme,
            href: i.flexge_lesson_href,
            aplicado: aplicados.has(i.id),
          })),
        }
      : null,
    contratoParaPlano: particulares.find((c) => c.status === 'active')?.contract_id ?? null,
    agoraNoNegocio: agora.setZone(BUSINESS_TZ).toFormat("yyyy-LL-dd'T'HH:mm"),
  }
}
