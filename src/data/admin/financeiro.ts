import 'server-only'

// CAMADA DE DADOS DO FINANCEIRO (Onda Financeiro · F1) — a leitura única de
// `/admin/pagamentos`. Mesma convenção de `contratos.ts`/`alunos.ts`:
// · UMA função por leitura de tela; a página NÃO faz query inline;
// · o que vem do banco passa por Zod — payload que mudou de forma estoura
//   AQUI, não pinta `undefined` na tela da dona;
// · falha nunca vira lista vazia: `exigir` estoura para o boundary de erro;
// · zero regra de negócio (Lei 3): situação/vencida/não-cobrável chegam
//   DECIDIDAS pela view `payments_admin` (migration 20260807000100). Este
//   arquivo não olha relógio nem status cru — só repassa filtros à consulta.
//
// O RECORTE É DA CONSULTA, NÃO DA TELA (mudança aprovada do F1): `?st=vencidas`
// vira `em_atraso = true` NO WHERE; as contagens das abas e o badge de
// vencidas saem de `count` na view — imunes ao `limit` da lista.

import { fmtBRL, fmtCivilDate } from '@/lib/format'
import { situacaoDaView, type SituacaoDaCobranca } from '@/lib/admin/financeiro-rotulos'
import { verboDoVencimento } from '@/lib/portal/pagamentos'
import { createClient } from '@/lib/supabase/server'
import { DateTime } from 'luxon'
import { z } from 'zod'

export type AbaDoFinanceiro = 'aberto' | 'pagas' | 'todas'

/** Quantas linhas a tela lista por aba (as contagens NÃO dependem disto). */
const LIMITE_DA_LISTA = 100

const CobrancaBrutaSchema = z.object({
  id: z.string(),
  amount_cents: z.number().int().nullable(),
  due_date: z.string().nullable(),
  reference_ym: z.string().nullable(),
  situacao: z.string().nullable(),
  em_atraso: z.boolean().nullable(),
  pagante: z.string().nullable(),
  student_id: z.string().nullable(),
})
const CobrancasBrutasSchema = z.array(CobrancaBrutaSchema)

export interface CobrancaDaLista {
  id: string
  /** aluno do contrato individual, rótulo do grupo ou o plano — nunca payer (F3) */
  pagante: string
  /** link para a ficha quando o contrato é individual */
  studentId: string | null
  /** "agosto/2026" — competência humanizada (deriva de texto, sem fuso) */
  competencia: string
  valor: string
  /** "vence em 05/08" / "venceu em 05/08" / "venc. 05/08" — verbo decidido pela situação */
  vencimento: string
  situacao: SituacaoDaCobranca
}

export interface FinanceiroDaTela {
  linhas: CobrancaDaLista[]
  /** contagens EXATAS por recorte, contadas na view (imunes ao limit) */
  contagens: { aberto: number; pagas: number; todas: number; vencidas: number }
  /** total do recorte ativo — quando > linhas.length, a tela avisa o corte */
  totalDoRecorte: number
  /** cobranças do Asaas que chegaram e não casaram (badge operacional F8/M11-2) */
  naoConciliadas: number
}

function exigir<T>(leitura: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Financeiro: falha ao ler ${leitura}: ${r.error.message}`)
  return r.data
}

const mesHumano = (ym: string | null) =>
  ym ? DateTime.fromISO(`${ym}-01`).setLocale('pt-BR').toFormat('LLLL/yyyy') : '—'

export async function getFinanceiro(
  aba: AbaDoFinanceiro,
  soVencidas: boolean,
): Promise<FinanceiroDaTela> {
  const supabase = await createClient()

  const base = () =>
    supabase.from('payments_admin').select('id', { count: 'exact', head: true })

  let lista = supabase
    .from('payments_admin')
    .select('id, amount_cents, due_date, reference_ym, situacao, em_atraso, pagante, student_id')
    .limit(LIMITE_DA_LISTA)

  // O recorte NA CONSULTA — a régua é a coluna da view, nunca um if daqui.
  if (soVencidas) {
    lista = lista.eq('em_atraso', true).order('due_date', { ascending: true })
  } else if (aba === 'aberto') {
    lista = lista
      .eq('em_aberto', true)
      .order('em_atraso', { ascending: false })
      .order('due_date', { ascending: true })
  } else if (aba === 'pagas') {
    lista = lista.eq('situacao', 'paga').order('due_date', { ascending: false })
  } else {
    lista = lista.order('due_date', { ascending: false })
  }

  const [linhasR, abertoR, pagasR, todasR, vencidasR, inboxR] = await Promise.all([
    lista,
    base().eq('em_aberto', true),
    base().eq('situacao', 'paga'),
    base(),
    base().eq('em_atraso', true),
    // F6 (PLAN-APPROVED): o badge conta TODO evento com `error` — não só o
    // externalReference desconhecido. É a observabilidade do retry da RPC:
    // falha transitória fica com error preenchido (e processed_at nulo) até o
    // replay convergir. Vem a LINHA (não head-count) porque erro TERMINAL já
    // resolvido — a cobrança daquele evento ganhou espelho por um evento
    // posterior — sai da conta (Sol F6 · P2: senão o badge nunca mais zerava).
    supabase
      .from('webhook_inbox')
      .select('processed_at, payload')
      .eq('source', 'asaas')
      .not('error', 'is', null)
      .limit(500),
  ])

  const brutas = CobrancasBrutasSchema.parse(exigir('cobranças', linhasR))
  const contagens = {
    aberto: exigirContagem('em aberto', abertoR),
    pagas: exigirContagem('pagas', pagasR),
    todas: exigirContagem('todas', todasR),
    vencidas: exigirContagem('vencidas', vencidasR),
  }

  const linhas: CobrancaDaLista[] = brutas.map((p) => {
    const situacao = situacaoDaView(p.situacao)
    return {
      id: p.id,
      pagante: p.pagante ?? '—',
      studentId: p.student_id,
      competencia: mesHumano(p.reference_ym),
      valor: p.amount_cents === null ? '—' : fmtBRL(p.amount_cents),
      vencimento: p.due_date
        ? `${verboDoVencimento(situacao)} ${fmtCivilDate(p.due_date)}`
        : 'sem vencimento',
      situacao,
    }
  })

  return {
    linhas,
    contagens,
    totalDoRecorte: soVencidas
      ? contagens.vencidas
      : contagens[aba === 'aberto' ? 'aberto' : aba === 'pagas' ? 'pagas' : 'todas'],
    naoConciliadas: await eventosComErroSemResolucao(
      supabase,
      exigir('inbox com erro', inboxR) as Array<{ processed_at: string | null; payload: unknown }>,
    ),
  }
}

/** Presos (replay pendente) + terminais cuja cobrança AINDA não tem espelho. */
async function eventosComErroSemResolucao(
  supabase: Awaited<ReturnType<typeof createClient>>,
  linhas: Array<{ processed_at: string | null; payload: unknown }>,
): Promise<number> {
  const payId = (l: { payload: unknown }) =>
    (l.payload as { payment?: { id?: string } } | null)?.payment?.id ?? null
  const presos = linhas.filter((l) => !l.processed_at)
  const terminais = linhas.filter((l) => l.processed_at)
  const ids = [...new Set(terminais.map(payId).filter((x): x is string => Boolean(x)))]
  let resolvidos = new Set<string>()
  if (ids.length > 0) {
    const { data } = await supabase.from('payments').select('asaas_payment_id').in('asaas_payment_id', ids)
    resolvidos = new Set((data ?? []).map((p) => p.asaas_payment_id as string))
  }
  return presos.length + terminais.filter((l) => {
    const id = payId(l)
    return !(id && resolvidos.has(id))
  }).length
}

function exigirContagem(
  leitura: string,
  r: { count: number | null; error: { message: string } | null },
): number {
  if (r.error) throw new Error(`Financeiro: falha ao contar ${leitura}: ${r.error.message}`)
  return r.count ?? 0
}
