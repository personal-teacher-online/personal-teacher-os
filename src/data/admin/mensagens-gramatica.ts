// GRAMÁTICA DA TELA MENSAGENS (Onda Agenda e Mensagens · M3-3a) — o que é
// PURO: vocabulário da URL, nome em português de cada template, frase de
// contexto e a tabela situação → condição da consulta. Mora fora de
// `mensagens.ts` (que é `server-only` e lê o banco) pelo mesmo motivo de
// `contratos-gramatica.ts`: o teste importa daqui sem banco nem Next.
//
// A SITUAÇÃO NESTE CORTE: a régua é a mesma da tela velha (`sent_at` + `error`),
// mas vira CONDIÇÃO DA CONSULTA em vez de filtro da página. A régua definitiva,
// calculada no banco pela view `outbox_admin` (com "entregue"), chega no M3-3b,
// junto com a migration M3-1 — aí `CONDICAO_DA_SITUACAO` e `situacaoDaLinha`
// morrem e a coluna da view passa a decidir.

import { DateTime } from 'luxon'

export const POR_PAGINA = 50

/** Dia do negócio — é nele que a dona lê "criada 12/10 às 14:00". */
const FUSO_DA_ESCOLA = 'America/Cuiaba'

export type SituacaoDaMensagem = 'preso' | 'pendente' | 'enviado' | 'resolvido'
export type AbaDasMensagens = 'todos' | SituacaoDaMensagem
export type PeriodoDasMensagens = '7' | '30' | 'tudo'

/** As abas na ordem da tela; a chave é a mesma `?st=` da tela velha. */
export const ABAS_DAS_MENSAGENS: ReadonlyArray<{ aba: AbaDasMensagens; rotulo: string }> = [
  { aba: 'todos', rotulo: 'Todos' },
  { aba: 'preso', rotulo: 'Presos' },
  { aba: 'pendente', rotulo: 'Aguardando' },
  { aba: 'enviado', rotulo: 'Enviados' },
  { aba: 'resolvido', rotulo: 'Resolvidos' },
]

export const PERIODOS_DAS_MENSAGENS: ReadonlyArray<{ periodo: PeriodoDasMensagens; rotulo: string }> = [
  { periodo: '7', rotulo: '7 dias' },
  { periodo: '30', rotulo: '30 dias' },
  { periodo: 'tudo', rotulo: 'Tudo' },
]

export const ROTULO_DA_SITUACAO: Record<
  SituacaoDaMensagem,
  { frase: string; tom: 'danger' | 'neutral' | 'ok' | 'muted' }
> = {
  preso: { frase: 'preso — ação sua', tom: 'danger' },
  pendente: { frase: 'aguardando envio', tom: 'neutral' },
  enviado: { frase: 'enviado', tom: 'ok' },
  resolvido: { frase: 'resolvido sem envio', tom: 'muted' },
}

/**
 * Situação → condição de `sent_at` e `error` NO WHERE. É a mesma régua de
 * `situacaoDaLinha`, escrita como filtro; o teste prova que as duas concordam.
 * O despachante limpa `error` quando o envio dá certo (`dispatch.ts`), então
 * "enviado com erro" não existe: `sent_at` + `error` é sempre resolução manual
 * ou obsolescência.
 */
export const CONDICAO_DA_SITUACAO: Record<
  SituacaoDaMensagem,
  { enviada: boolean; comErro: boolean }
> = {
  preso: { enviada: false, comErro: true },
  pendente: { enviada: false, comErro: false },
  enviado: { enviada: true, comErro: false },
  resolvido: { enviada: true, comErro: true },
}

export function situacaoDaLinha(sentAt: string | null, error: string | null): SituacaoDaMensagem {
  if (!sentAt) return error ? 'preso' : 'pendente'
  return error ? 'resolvido' : 'enviado'
}

/* ---- URL ------------------------------------------------------------------ */

export interface FiltrosDasMensagens {
  aba: AbaDasMensagens
  periodo: PeriodoDasMensagens
  /** id do aluno (`students.id`) — só uuid entra; o resto vira "todos" */
  aluno: string | null
  /** página PEDIDA (≥ 1); quem sabe o total ajusta com `paginaValida` */
  pagina: number
  /** mensagem aberta no painel lateral (`?ver=`) */
  ver: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ehAba = (v: string | undefined): v is AbaDasMensagens =>
  ABAS_DAS_MENSAGENS.some((a) => a.aba === v)
const ehPeriodo = (v: string | undefined): v is PeriodoDasMensagens =>
  PERIODOS_DAS_MENSAGENS.some((p) => p.periodo === v)
const uuidOuNada = (v: string | undefined) => (v && UUID.test(v) ? v.toLowerCase() : null)

/** Lê `?st=&p=&aluno=&pg=&ver=`. Valor desconhecido cai no padrão, nunca estoura. */
export function lerFiltrosDasMensagens(sp: {
  st?: string
  p?: string
  aluno?: string
  pg?: string
  ver?: string
}): FiltrosDasMensagens {
  const pg = /^\d{1,6}$/.test(sp.pg ?? '') ? Number(sp.pg) : 1
  return {
    aba: ehAba(sp.st) ? sp.st : 'todos',
    periodo: ehPeriodo(sp.p) ? sp.p : 'tudo',
    aluno: uuidOuNada(sp.aluno),
    pagina: Math.max(1, pg),
    ver: uuidOuNada(sp.ver),
  }
}

/**
 * Endereço da tela com uma mudança aplicada. Mudar aba, período ou aluno volta
 * para a página 1 (a página 4 de "Todos" não existe em "Presos"); o painel
 * aberto só sobrevive quando a mudança é ELE.
 */
export function enderecoDasMensagens(
  f: FiltrosDasMensagens,
  mudanca: Partial<FiltrosDasMensagens> = {},
): string {
  const recorteMudou =
    ('aba' in mudanca && mudanca.aba !== f.aba) ||
    ('periodo' in mudanca && mudanca.periodo !== f.periodo) ||
    ('aluno' in mudanca && mudanca.aluno !== f.aluno)
  const n: FiltrosDasMensagens = {
    ...f,
    ver: null,
    ...(recorteMudou ? { pagina: 1 } : {}),
    ...mudanca,
  }
  const q = new URLSearchParams()
  if (n.aba !== 'todos') q.set('st', n.aba)
  if (n.periodo !== 'tudo') q.set('p', n.periodo)
  if (n.aluno) q.set('aluno', n.aluno)
  if (n.pagina > 1) q.set('pg', String(n.pagina))
  if (n.ver) q.set('ver', n.ver)
  const s = q.toString()
  return s ? `/admin/avisos?${s}` : '/admin/avisos'
}

/** Página pedida ajustada ao total do recorte (o recorte encolheu → última página). */
export function paginaValida(pedida: number, total: number): { pagina: number; totalDePaginas: number } {
  const totalDePaginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  return { pagina: Math.min(Math.max(1, pedida), totalDePaginas), totalDePaginas }
}

/* ---- texto da linha ------------------------------------------------------- */

/**
 * Nome de cada template em português. Template sem nome aqui aparece CRU —
 * é o aviso de que faltou uma linha (o defeito do A5/L5 com `class-cancelled`).
 */
export const NOME_DO_TEMPLATE: Record<string, string> = {
  'class-reminder': 'Lembrete de aula',
  'reschedule-confirm': 'Confirmação de remarcação',
  'class-cancelled': 'Cancelamento de aula',
  'credit-expiry': 'Crédito vencendo',
  'mentorship-eligible': 'Mentoria liberada',
  'content-review': 'Conteúdo para revisar',
  'student-whatsapp-changed': 'WhatsApp do aluno mudou',
  'class-cancelled-teacher': 'Aula cancelada (aviso à professora)',
  'teacher-class-changed': 'Professora cancelou ou remarcou (aviso interno)',
}

export const nomeDoTemplate = (t: string) => NOME_DO_TEMPLATE[t] ?? t

/** "12/10 às 14:00" no fuso da escola. Instante inválido → null. */
export function instanteDaEscola(iso: string | null): string | null {
  if (!iso) return null
  const d = DateTime.fromISO(iso, { zone: 'utc' })
  return d.isValid ? d.setZone(FUSO_DA_ESCOLA).setLocale('pt-BR').toFormat("dd/LL 'às' HH:mm") : null
}

export interface PayloadDaMensagem {
  starts_at_utc?: unknown
  expires_on?: unknown
  marco?: unknown
  n_credits?: unknown
}

/** "aula 14/10 às 09:00 · crédito vence 20/10" — o que o payload sabe dizer. */
export function contextoDaMensagem(payload: PayloadDaMensagem | null): string | null {
  if (!payload) return null
  const partes: string[] = []
  if (typeof payload.starts_at_utc === 'string') {
    const t = instanteDaEscola(payload.starts_at_utc)
    if (t) partes.push(`aula ${t}`)
  }
  if (typeof payload.expires_on === 'string') {
    // data CIVIL (sem fuso): só se troca a grafia
    const d = DateTime.fromISO(payload.expires_on)
    if (d.isValid) partes.push(`crédito vence ${d.toFormat('dd/LL')}`)
  }
  if (typeof payload.marco === 'number' && payload.marco > 0) partes.push(`aviso de ${payload.marco} dias`)
  if (typeof payload.n_credits === 'number' && payload.n_credits > 0) {
    partes.push(`${payload.n_credits} crédito${payload.n_credits > 1 ? 's' : ''}`)
  }
  return partes.length ? partes.join(' · ') : null
}
