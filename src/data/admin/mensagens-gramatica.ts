// GRAMÁTICA DA TELA MENSAGENS (Onda Agenda e Mensagens · M3-3a/M3-3b) — o que é
// PURO: vocabulário da URL, nome em português de cada template, frase de
// contexto e tradução do motivo da falha. Mora fora de `mensagens.ts` (que é
// `server-only` e lê o banco) pelo mesmo motivo de `contratos-gramatica.ts`: o
// teste importa daqui sem banco nem Next.
//
// A SITUAÇÃO NÃO SE CALCULA AQUI. Desde o M3-3b a régua é única e vive no banco:
// a coluna `situacao` da view `outbox_admin` (migration da #42) decide, e a
// consulta filtra por ela. Esta gramática só dá nome e cor a cada situação.

import { DateTime } from 'luxon'

export const POR_PAGINA = 50

/** Dia do negócio — é nele que a dona lê "criada 12/10 às 14:00". */
const FUSO_DA_ESCOLA = 'America/Cuiaba'

export type SituacaoDaMensagem = 'preso' | 'pendente' | 'enviado' | 'entregue' | 'resolvido'
export type AbaDasMensagens = 'todos' | SituacaoDaMensagem
export type PeriodoDasMensagens = '7' | '30' | 'tudo'

/** As abas na ordem da tela; a chave é a mesma `?st=` da tela velha. */
export const ABAS_DAS_MENSAGENS: ReadonlyArray<{ aba: AbaDasMensagens; rotulo: string }> = [
  { aba: 'todos', rotulo: 'Todos' },
  { aba: 'preso', rotulo: 'Presos' },
  { aba: 'pendente', rotulo: 'Aguardando' },
  { aba: 'enviado', rotulo: 'Enviados' },
  { aba: 'entregue', rotulo: 'Entregues' },
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
  entregue: { frase: 'entregue', tom: 'ok' },
  resolvido: { frase: 'resolvido', tom: 'muted' },
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

/**
 * Motivo da falha da Meta em português, pelo CÓDIGO que o `error` carrega
 * ("… (código 131026)" no recibo, "… HTTP 400, código 131026 …" no envio). O
 * painel mostra o texto cru por desenho; a lista mostra esta frase. Sem código
 * no texto (erro do driver, "aluno sem login"…), não há o que traduzir: null.
 */
const FRASE_DO_CODIGO_DA_META: Record<string, string> = {
  '131026': 'a Meta não conseguiu entregar',
  '131049': 'a Meta não entregou para proteger a qualidade do número',
  '131048': 'a Meta limitou os envios por suspeita de spam',
  '131056': 'muitas mensagens seguidas para o mesmo número',
  '131042': 'problema de pagamento na conta da Meta',
  '132001': 'o modelo de mensagem não existe na Meta',
}

export function motivoDaFalhaNaLista(erro: string | null): string | null {
  // Só erro que veio da Meta: o recibo ("falhou depois do envio: …") ou o envio
  // (que nomeia a Meta). "código N" solto em outro texto não é da Meta.
  if (!erro || !/^falhou depois do envio:|\bMeta\b/.test(erro)) return null
  const codigo = erro.match(/c[óo]digo (\d+)/i)?.[1]
  if (!codigo) return null
  // Código fora da tabela: não se adivinha a causa (pode ser instabilidade, não recusa).
  return `${FRASE_DO_CODIGO_DA_META[codigo] ?? 'a Meta devolveu um erro'} (${codigo})`
}

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
