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
// Fonte dos códigos: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
// (conferida em 30/10/2026). As frases são LITERAIS: dizem o que a Meta diz,
// sem afirmar uma causa que o código não garante.
const FRASE_DO_CODIGO_DA_META: Record<string, string> = {
  '131026': 'a Meta não conseguiu entregar',
  '131049': 'a Meta segurou para não sobrecarregar o aluno (limite de mensagens por pessoa)',
  '131048': 'a Meta limitou temporariamente o envio',
  '131056': 'muitas mensagens seguidas para o mesmo número',
  '131042': 'problema de pagamento na conta da Meta',
  '132001': 'a Meta não encontrou esse modelo nesse idioma',
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

/**
 * A recusa do "reenviar" (`admin_resend_outbox`) em frase da dona: sem id de
 * mensagem, sem código de erro. A RPC é a autoridade e escreve para o log; a tela
 * traduz as recusas que conhece e cai numa frase genérica para o resto.
 */
export function fraseDaRecusaDoReenvio(mensagem: string, codigo?: string | null): string {
  if (codigo === '42501' || /restrito à admin/.test(mensagem)) {
    return 'Só a administração pode reenviar mensagens.'
  }
  if (/mudou desde que a tela/.test(mensagem)) {
    const agora = mensagem.match(/agora: (\w+)/)?.[1]
    const rotulo = ROTULO_DA_SITUACAO[agora as SituacaoDaMensagem]?.frase
    return `Esta mensagem mudou desde que a tela foi aberta${rotulo ? ` (agora: ${rotulo})` : ''}. Confira e tente de novo.`
  }
  if (/ainda está aguardando envio/.test(mensagem)) return 'Esta mensagem ainda aguarda o envio; não há o que reenviar.'
  if (/já foi reenviad/.test(mensagem)) return 'Esta mensagem já foi reenviada. Reenvie a mensagem nova.'
  if (/está sendo enviad/.test(mensagem)) return 'Esta mensagem está sendo enviada agora. Tente de novo em alguns minutos.'
  if (/original já foi entregue/.test(mensagem)) return 'A mensagem original já foi entregue; não há o que reenviar.'
  if (/não existe/.test(mensagem)) return 'Esta mensagem não existe mais. Volte para a lista.'
  return 'Não deu para reenviar agora. Reabra a mensagem e tente de novo.'
}

/**
 * O que dizer à dona depois que o reenvio despachou: sai da situação REAL da
 * cópia (lida da view `outbox_admin` depois do despacho), nunca de um palpite
 * sobre o que o despachante deve ter feito. A cópia pode ter saído, ficado
 * presa, sido fechada sem envio (aviso que perdeu o sentido) ou ainda esperar.
 */
export function fraseDoReenvioDepoisDoDespacho(
  situacao: string | null,
  erro: string | null,
  seguradaNoSilencio: boolean,
): string {
  const motivo = motivoDaFalhaNaLista(erro) ?? erro ?? 'o motivo não foi informado'
  switch (situacao) {
    case 'enviado':
    case 'entregue':
      return 'Mensagem reenviada e enviada agora.'
    case 'preso':
      return `Mensagem reenviada, mas a cópia ficou presa: ${motivo}. Veja em Presos.`
    case 'resolvido':
      return `Mensagem reenviada, mas a cópia foi fechada sem envio: ${motivo}.`
    case 'pendente':
      return seguradaNoSilencio
        ? 'Mensagem reenviada. A cópia espera o fim do horário de silêncio (21h às 8h) em Aguardando.'
        : 'Mensagem reenviada. A cópia está em Aguardando e sai na próxima rodada de envio.'
    default:
      return 'Mensagem reenviada. Confira a situação da cópia na lista.'
  }
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
