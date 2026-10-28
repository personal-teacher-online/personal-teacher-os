import 'server-only'

// CAMADA DE DADOS DO ADMIN (Onda 1 · M1, item 1) — leitura do Início.
//
// Contrato da camada:
// · UMA função tipada por leitura de tela. A página NÃO faz query inline.
// · O retorno passa por Zod: o que vem do banco é `unknown` até provar o
//   contrário, e um KPI que mudou de forma tem que estourar AQUI, não pintar
//   `undefined` na tela da dona.
// · FALHA NUNCA VIRA ESTADO VAZIO (revisão adversarial nº 1, C1): toda leitura
//   crítica confere `error` e ESTOURA. Banco indisponível tem que acender o
//   boundary de erro (`src/app/admin/error.tsx`), não desenhar "Nenhuma aula
//   hoje" — que é uma afirmação sobre o dia da escola, não sobre a rede.
//   Única exceção, deliberada: o nome da saudação (degrada para o nome da config).
// · `server-only`: se algum dia isto for importado de um componente cliente, o
//   build quebra (é o que impede a chave e a query de vazarem para o navegador).
// · Zero regra de negócio (Lei 3): as fórmulas dos 8 números moram na
//   `admin_kpis()` e as duas contagens da fila na `admin_home_counts()`; aqui
//   só se lê, valida e formata para a tela.
//
// DOIS ANDARES, DUAS LEITURAS (revisão adversarial nº 1, C3): `getAdminHoje` e
// `getAdminNegocio` são independentes de propósito. Enquanto os dois andares
// esperavam a MESMA promessa, os dois esqueletos caíam juntos e a agenda do dia
// ficava refém do snapshot — o desenho de dois andares virava enfeite.
//
// As demais leituras da onda (`getStudentsHub`, `getStudentGroup`,
// `getStudentFile`, `getContractsIndex`, `getContractDetail`,
// `getInvitesOverview`) nascem junto com as telas delas nos M3/M4 — a
// convenção que elas seguem é esta.

import { DateTime } from 'luxon'
import { z } from 'zod'

import { BUSINESS_TZ } from '@/lib/brand/constants'
import type { Instante } from '@/components/kit/instant'
import { one } from '@/lib/embed'
import { fmtStudentLocal } from '@/lib/format'
import { nomeParaSaudacao, saudacaoPara } from '@/lib/saudacao'
import { createClient } from '@/lib/supabase/server'
import {
  dataDaBase,
  fechamentoValido,
  montarComparacao,
  type Comparacao,
  type ComparacaoDoMes,
} from './comparar'
import { passouDaHoraDoFechamento } from './fechamento'
import { AdminKpisSchema, type AdminKpis } from './kpis'

export type { Comparacao, ComparacaoDoMes, AdminKpis }
export { AdminKpisSchema }

/**
 * Leitura que falhou não pode virar lista vazia. O texto do erro nomeia a
 * leitura porque é ele que chega ao `error.tsx` (e ao log): "falha ao ler a
 * agenda do dia" conserta mais rápido do que "erro".
 */
function exigir<T>(leitura: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Início: falha ao ler ${leitura}: ${r.error.message}`)
  return r.data
}

/** As duas contagens da fila de pendências (RPC `admin_home_counts`, C2). */
const ContagensSchema = z.object({
  convites_pendentes: z.coerce.number(),
  briefings_travados: z.coerce.number(),
})

/* ========================================================================== */
/* HOJE                                                                        */
/* ========================================================================== */

export type SituacaoDaAula =
  | 'agendada'
  | 'sem_registro'
  | 'realizada'
  | 'falta_aluno'
  | 'falta_professora'
  | 'cancelada'
  | 'remarcada'

export interface AulaDeHoje {
  id: string
  /** "14:00" no fuso do NEGÓCIO, já formatado (Lei 1) */
  hora: string
  instante: Instante
  quem: string
  studentId: string | null
  teacherId: string | null
  /** null = professora sem cadastro concluído; a UI então não pinta bolinha */
  teacherNome: string | null
  /** índice da cor da professora (a bolinha) */
  teacherIdx: number
  situacao: SituacaoDaAula
  nivel: string | null
}

export interface Pendencias {
  apontamentos: number
  briefings: number
  convites: number
  total: number
}

/** Andar de cima: o que pede AÇÃO hoje. */
export interface AdminHoje {
  /** data civil do negócio, já por extenso (ex.: "domingo, 26 de julho de 2026") */
  dataPorExtenso: string
  horaDoNegocio: string
  saudacao: string
  saudacaoNome: string
  aulas: AulaDeHoje[]
  pendencias: Pendencias
}

/** Andar de baixo: o que pede LEITURA (os 8 números). */
export interface AdminNegocio {
  kpis: AdminKpis
  comparacao: ComparacaoDoMes | null
  /**
   * Sinal operacional (B2 da retroativa nº 2): já passou o horário da última
   * tentativa do cron (+ folga) e o fechamento de HOJE não existe. Antes do
   * horário, a comparação simplesmente não aparece — isso está certo, o ponto
   * ainda não foi capturado. Depois dele, sumir calada esconderia um dia
   * perdido para sempre (a tabela é append-only e o cálculo é do instante).
   */
  fechamentoAtrasado: boolean
}

function situacaoDe(state: string, passou: boolean): SituacaoDaAula {
  if (state === 'scheduled') return passou ? 'sem_registro' : 'agendada'
  if (state === 'completed') return 'realizada'
  if (state === 'no_show_student') return 'falta_aluno'
  if (state === 'no_show_teacher') return 'falta_professora'
  if (state === 'rescheduled') return 'remarcada'
  return 'cancelada'
}

/**
 * Andar HOJE: agenda do dia + fila de pendências.
 *
 * Independente do andar de baixo — um snapshot lento não pode segurar a agenda.
 */
export async function getAdminHoje(): Promise<AdminHoje> {
  const supabase = await createClient()

  // Relógio por request é intencional (Server Component).
  const agora = DateTime.now().setZone(BUSINESS_TZ)
  const inicioDoDia = agora.startOf('day').toUTC().toISO()!
  const fimDoDia = agora.endOf('day').toUTC().toISO()!

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [aulasRes, teachersRes, pendentesRes, contagensRes, perfilRes] = await Promise.all([
    supabase
      .from('class_instances')
      .select(
        'id, starts_at_utc, state, teacher_id, contracts(students!contracts_student_id_fkey(id, display_name, iana_tz, level), student_groups(label))',
      )
      .gte('starts_at_utc', inicioDoDia)
      .lte('starts_at_utc', fimDoDia)
      .order('starts_at_utc'),
    supabase
      .from('teachers')
      .select('id, display_name, is_owner')
      .is('archived_at', null)
      .order('is_owner', { ascending: false })
      .order('display_name'),
    // apontamento em falta: aula que já passou e continua "agendada".
    supabase
      .from('class_instances')
      .select('id')
      .eq('state', 'scheduled')
      .gte('starts_at_utc', agora.minus({ days: 60 }).toUTC().toISO()!)
      .lt('starts_at_utc', agora.toUTC().toISO()!),
    // C2: as duas contagens vêm prontas do banco — nada de carregar o
    // diretório inteiro (com ledger e dado pessoal) para contar duas coisas.
    supabase.rpc('admin_home_counts'),
    user
      ? supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  const aulasRaw = exigir('a agenda do dia', aulasRes) ?? []
  const teachersRaw = exigir('as professoras', teachersRes) ?? []
  const pendentesRaw = exigir('as aulas sem apontamento', pendentesRes) ?? []
  const contagens = ContagensSchema.parse(exigir('as contagens da fila', contagensRes))
  // ÚNICA leitura que degrada: sem o nome, a saudação usa o padrão da casa.
  // Nada aqui é afirmação sobre o negócio — é cortesia de cabeçalho.
  const perfil = perfilRes.data

  // ---- agenda do dia -------------------------------------------------------
  const professoras = teachersRaw.filter((t) => t.display_name)
  const idxDaProfessora = new Map(professoras.map((t, i) => [t.id, i]))
  const nomeDaProfessora = new Map(professoras.map((t) => [t.id, t.display_name as string]))

  const aulas: AulaDeHoje[] = aulasRaw.map((a) => {
    const contrato = one(a.contracts)
    const aluno = one(contrato?.students)
    const inicio = DateTime.fromISO(a.starts_at_utc)
    const tz = aluno?.iana_tz ?? null
    return {
      id: a.id,
      hora: inicio.setZone(BUSINESS_TZ).toFormat('HH:mm'),
      instante: {
        texto: inicio.setZone(BUSINESS_TZ).setLocale('pt-BR').toFormat("ccc, dd/LL 'às' HH:mm"),
        iso: a.starts_at_utc,
        // a hora do ALUNO já vem pronta: o cliente não converte fuso (Lei 1)
        titulo: tz && tz !== BUSINESS_TZ ? `Para o aluno: ${fmtStudentLocal(a.starts_at_utc, tz)}` : undefined,
      },
      quem: aluno?.display_name ?? one(contrato?.student_groups)?.label ?? '—',
      studentId: aluno?.id ?? null,
      teacherId: a.teacher_id,
      teacherNome: nomeDaProfessora.get(a.teacher_id) ?? null,
      teacherIdx: idxDaProfessora.get(a.teacher_id) ?? 0,
      situacao: situacaoDe(a.state, inicio < agora),
      nivel: aluno?.level ?? null,
    }
  })

  // ---- pendências ----------------------------------------------------------
  const apontamentos = pendentesRaw.length
  const briefings = contagens.briefings_travados
  const convites = contagens.convites_pendentes

  return {
    dataPorExtenso: agora.setLocale('pt-BR').toFormat("cccc, dd 'de' LLLL 'de' yyyy"),
    horaDoNegocio: agora.toFormat('HH:mm'),
    saudacao: saudacaoPara(agora.hour),
    saudacaoNome: nomeParaSaudacao(perfil?.full_name),
    aulas,
    pendencias: {
      apontamentos,
      briefings,
      convites,
      total: apontamentos + briefings + convites,
    },
  }
}

/* ========================================================================== */
/* NEGÓCIO                                                                     */
/* ========================================================================== */

/**
 * Andar NEGÓCIO: os 8 números AO VIVO + a comparação com o mês anterior.
 *
 * Independente do andar de cima (C3).
 */
export async function getAdminNegocio(): Promise<AdminNegocio> {
  const supabase = await createClient()

  const kpisRes = await supabase.rpc('admin_kpis')
  if (kpisRes.error) throw new Error(`Início: falha ao ler os KPIs: ${kpisRes.error.message}`)
  const kpis = AdminKpisSchema.parse(kpisRes.data)

  const { comparacao, temFechamentoDeHoje } = await lerComparacao(supabase, kpis)
  return {
    kpis,
    comparacao,
    fechamentoAtrasado:
      !temFechamentoDeHoje && passouDaHoraDoFechamento(kpis.business_date, kpis.generated_at),
  }
}

/**
 * LEITURA dos dois fechamentos — só isso. A regra (o que compara com o quê, e
 * quando não compara) é `montarComparacao`, em `comparar.ts`: função pura,
 * provada por comportamento (F3 da revisão adversarial nº 4).
 *
 * Comparação com CORTE HONESTO (revisão adversarial nº 1, C5): os números
 * grandes dos cartões são AO VIVO — é o que a dona quer saber agora. O DELTA,
 * não: ele compara dois FECHAMENTOS, o de hoje e o do mesmo dia do mês passado,
 * ambos capturados pelo mesmo job (`capture_kpi_snapshot`, madrugada em
 * Cuiabá). Antes disto, o delta punha o valor AO VIVO (17:00, por exemplo)
 * contra um snapshot das 03:00 do mês anterior: até 14 horas de movimento a
 * mais de um lado. "Recebido caiu 8%" era, em parte, apenas a hora do dia.
 *
 * Devolve também SE o fechamento de hoje existe: é o que separa "ainda não deu
 * a hora" de "o job não rodou e o dia vai se perder" (B2 da retroativa nº 2) —
 * e ele NÃO é o mesmo que "há comparação": fórmula nova apaga o delta com o
 * fechamento de hoje bem no lugar.
 */
async function lerComparacao(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kpis: AdminKpis,
): Promise<{ comparacao: ComparacaoDoMes | null; temFechamentoDeHoje: boolean }> {
  const hoje = kpis.business_date
  const base = dataDaBase(hoje)
  if (!base) return { comparacao: null, temFechamentoDeHoje: false }

  const snapsRes = await supabase
    .from('kpi_snapshots')
    .select('captured_on, data')
    .in('captured_on', [hoje, base])
  const snaps = exigir('os fechamentos de KPI', snapsRes) ?? []

  const por = new Map(snaps.map((s) => [String(s.captured_on), s.data]))
  return {
    comparacao: montarComparacao(kpis, por.get(hoje), por.get(base)),
    temFechamentoDeHoje: fechamentoValido(por.get(hoje)),
  }
}
