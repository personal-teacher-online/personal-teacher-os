import 'server-only'

// CAMADA DE DADOS DA TELA MENSAGENS (Onda Agenda e Mensagens · M3-3a/M3-3b) — a
// leitura única de `/admin/avisos`. Mesma convenção de `financeiro.ts`:
// · UMA função por leitura de tela; a página NÃO faz query inline;
// · o que vem do banco passa por Zod — payload que mudou de forma estoura AQUI;
// · falha nunca vira lista vazia: `exigir` estoura para o boundary de erro;
// · datas saem daqui como TEXTO pronto (Lei 1: o cliente não formata data).
//
// A SITUAÇÃO É LIDA DA VIEW `outbox_admin` (M3-3b): a régua é única e vive no
// banco (migration da #42, com "entregue"); aqui só se filtra e se lê a coluna.
//
// O RECORTE É DA CONSULTA, NÃO DA TELA. A tela velha lia as 200 mais recentes
// e filtrava situação e período em memória — mensagem 201 não existia para
// ela, e "Presos 0" podia ser mentira. Aqui situação, período e aluno vão no
// WHERE; as contagens das abas são `count` exato com o mesmo recorte; a lista
// pagina com `range` (50 por página, mais recentes primeiro).
//
// O FILTRO DE ALUNO pega as duas formas de uma mensagem ser dele: endereçada
// ao login dele (`recipient_profile_id`) OU com o id dele no payload. Sem a
// segunda, a mensagem PRESA de aluno sem login — a que mais pede a dona —
// sumiria justamente quando ela filtra por ele (o payload carrega `student_id`
// para a resolução tardia; comentário de `notification_outbox`).

import type { SupabaseClient } from '@supabase/supabase-js'
import { DateTime } from 'luxon'
import { z } from 'zod'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  ABAS_DAS_MENSAGENS,
  POR_PAGINA,
  contextoDaMensagem,
  instanteDaEscola,
  motivoDaFalhaNaLista,
  nomeDoTemplate,
  paginaValida,
  type AbaDasMensagens,
  type FiltrosDasMensagens,
  type SituacaoDaMensagem,
} from './mensagens-gramatica'

/** A view que a tela lê (o outbox com a situação calculada no banco). */
const VIEW = 'outbox_admin'

/** As colunas que a tela lê da view (lista e painel). */
export const COLUNAS_DA_MENSAGEM =
  'id, channel, template, recipient_profile_id, payload, sent_at, error, created_at, scheduled_for, delivered_at, read_at, reenviado, situacao'

const MensagemBrutaSchema = z.object({
  id: z.string(),
  channel: z.string(),
  template: z.string(),
  recipient_profile_id: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  sent_at: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  scheduled_for: z.string(),
  delivered_at: z.string().nullable(),
  read_at: z.string().nullable(),
  /** a linha já tem cópia (a dona a reenviou) */
  reenviado: z.boolean(),
  situacao: z.enum(['pendente', 'preso', 'enviado', 'entregue', 'resolvido']),
})
type MensagemBruta = z.infer<typeof MensagemBrutaSchema>

const AlunoBrutoSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable(),
  profile_id: z.string().nullable(),
})

export interface MensagemDaLista {
  id: string
  /** "Lembrete de aula" — nome do template em português */
  tipo: string
  canal: 'email' | 'whatsapp'
  /** nome de quem recebe; aluno sem login aparece pelo nome da ficha */
  destinatario: string
  /** false = nem login nem ficha identificados (a linha órfã) */
  destinatarioConhecido: boolean
  contexto: string | null
  situacao: SituacaoDaMensagem
  /** o motivo da falha da Meta em português (só quando o erro traz o código); senão null */
  motivo: string | null
  /** "enviada 12/10 às 14:00" / "entregue 12/10 às 14:32 · lida 12/10 às 15:00" / "criada …" */
  quando: string
}

export interface MensagemAberta extends MensagemDaLista {
  criadaEm: string
  enviadaEm: string | null
  /** quando o recibo de entrega chegou; null = sem recibo */
  entregueEm: string | null
  /** quando o recibo de leitura chegou; null = sem recibo */
  lidaEm: string | null
  /** o horário em que o despachante pode pegá-la (lembretes nascem para depois) */
  agendadaPara: string
  /** o texto do erro como o banco guardou — o painel mostra cru */
  erro: string | null
  /** resolver sem enviar vale para o que ainda não saiu e para a presa que falhou depois de sair */
  resolvivel: boolean
  /** reenviar vale para tudo menos o que aguarda envio, e não de novo para quem já tem cópia */
  reenviavel: boolean
  /** já reenviada: a dona reenvia a linha nova */
  reenviada: boolean
}

export interface AlunoDoSeletor {
  id: string
  nome: string
}

export interface MensagensDaTela {
  linhas: MensagemDaLista[]
  /** contagens EXATAS por aba, com período e aluno aplicados */
  contagens: Record<AbaDasMensagens, number>
  /** página efetiva (a pedida, ajustada ao total) */
  pagina: number
  totalDePaginas: number
  /** posição da 1ª e da última linha desta página no recorte (1-based) */
  primeira: number
  ultima: number
  alunos: AlunoDoSeletor[]
  /** o aluno do filtro, quando o id da URL existe */
  alunoEscolhido: AlunoDoSeletor | null
  /** `?ver=`: a mensagem aberta; null = nada pedido; 'sumiu' = id que não existe */
  aberta: MensagemAberta | 'sumiu' | null
}

function exigir<T>(leitura: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Mensagens: falha ao ler ${leitura}: ${r.error.message}`)
  return r.data
}

function exigirContagem(
  leitura: string,
  r: { count: number | null; error: { message: string } | null },
): number {
  if (r.error) throw new Error(`Mensagens: falha ao contar ${leitura}: ${r.error.message}`)
  return r.count ?? 0
}

interface Recorte {
  /** instante ISO do corte de período; null = tudo */
  desde: string | null
  aluno: { id: string; profileId: string | null } | null
}

/**
 * A view do outbox com o recorte NO WHERE. Com `opcoes` é só a contagem de uma aba
 * (head); sem, é a lista.
 */
function doRecorte(
  supabase: SupabaseClient,
  recorte: Recorte,
  situacao: SituacaoDaMensagem | null,
  colunas: string,
  opcoes?: { count: 'exact'; head: true },
) {
  let q = supabase.from(VIEW).select(colunas, opcoes)
  if (recorte.desde) q = q.gte('created_at', recorte.desde)
  if (recorte.aluno) {
    // Os dois valores são uuid validados (gramática + leitura de `students`) —
    // nada de texto livre entra na expressão do `or`.
    const doPayload = `payload->>student_id.eq.${recorte.aluno.id}`
    q = recorte.aluno.profileId
      ? q.or(`recipient_profile_id.eq.${recorte.aluno.profileId},${doPayload}`)
      : q.or(doPayload)
  }
  if (situacao) q = q.eq('situacao', situacao)
  return q
}

/** A tela inteira. `supabase` lê com o RLS da admin; `servico` só lê nomes. */
export async function lerMensagens(
  supabase: SupabaseClient,
  servico: SupabaseClient,
  filtros: FiltrosDasMensagens,
  agora: DateTime = DateTime.utc(),
): Promise<MensagensDaTela> {
  // A lista do seletor e o aluno do filtro. O teto de 1000 linhas do PostgREST
  // não alcança a escala da casa (dezenas de alunos); o aluno ESCOLHIDO é lido
  // por id, então nunca cai fora do filtro mesmo que caísse fora da lista.
  const [alunosR, escolhidoR] = await Promise.all([
    // ficha anonimizada não entra no MENU; o histórico dela continua achável
    // (o nome da linha órfã é lido por id em `nomesDosDestinatarios`)
    supabase
      .from('students')
      .select('id, display_name, profile_id')
      .is('anonymized_at', null)
      .order('display_name'),
    filtros.aluno
      ? supabase.from('students').select('id, display_name, profile_id').eq('id', filtros.aluno).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  const alunos = z.array(AlunoBrutoSchema).parse(exigir('alunos', alunosR))
  const escolhido = AlunoBrutoSchema.nullable().parse(exigir('aluno do filtro', escolhidoR))

  const recorte: Recorte = {
    desde:
      filtros.periodo === 'tudo' ? null : agora.minus({ days: Number(filtros.periodo) }).toISO(),
    aluno: escolhido ? { id: escolhido.id, profileId: escolhido.profile_id } : null,
  }
  // Aluno pedido que não existe: a lista é VAZIA, não "todos" — a URL disse um
  // aluno, e mostrar a escola inteira sob o nome de ninguém seria mentir.
  const alunoInexistente = filtros.aluno !== null && escolhido === null

  const contar = (s: SituacaoDaMensagem | null) =>
    doRecorte(supabase, recorte, s, 'id', { count: 'exact', head: true })
  // aluno inexistente nem consulta: as cinco contagens seriam da tabela inteira
  const contagensR = alunoInexistente
    ? []
    : await Promise.all(ABAS_DAS_MENSAGENS.map((a) => contar(a.aba === 'todos' ? null : a.aba)))
  const contagens = Object.fromEntries(
    ABAS_DAS_MENSAGENS.map((a, i) => [
      a.aba,
      alunoInexistente ? 0 : exigirContagem(a.rotulo, contagensR[i]),
    ]),
  ) as Record<AbaDasMensagens, number>

  // A página é ajustada ANTES de ler: pedir um `range` além do fim faz o
  // PostgREST responder erro, e a página 9 de um recorte que encolheu vira a
  // última que existe.
  const total = contagens[filtros.aba]
  const { pagina, totalDePaginas } = paginaValida(filtros.pagina, total)
  const inicio = (pagina - 1) * POR_PAGINA

  const [listaR, abertaR] = await Promise.all([
    total === 0
      ? Promise.resolve({ data: [], error: null })
      : doRecorte(supabase, recorte, filtros.aba === 'todos' ? null : filtros.aba, COLUNAS_DA_MENSAGEM)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(inicio, inicio + POR_PAGINA - 1),
    filtros.ver
      ? supabase.from(VIEW).select(COLUNAS_DA_MENSAGEM).eq('id', filtros.ver).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  const brutas = z.array(MensagemBrutaSchema).parse(exigir('mensagens', listaR))
  const abertaBruta = MensagemBrutaSchema.nullable().parse(exigir('mensagem aberta', abertaR))

  const nomes = await nomesDosDestinatarios(
    supabase,
    servico,
    abertaBruta ? [...brutas, abertaBruta] : brutas,
    alunos,
  )

  const linhas = brutas.map((m) => montarLinha(m, nomes))
  return {
    linhas,
    contagens,
    pagina,
    totalDePaginas,
    primeira: linhas.length ? inicio + 1 : 0,
    ultima: inicio + linhas.length,
    alunos: alunos.map((a) => ({ id: a.id, nome: a.display_name ?? 'Aluno sem nome' })),
    alunoEscolhido: escolhido ? { id: escolhido.id, nome: escolhido.display_name ?? 'Aluno sem nome' } : null,
    aberta: filtros.ver ? (abertaBruta ? montarAberta(abertaBruta, nomes) : 'sumiu') : null,
  }
}

/** Para a página: a sessão da admin + a chave de serviço só para nomes. */
export async function getMensagens(filtros: FiltrosDasMensagens): Promise<MensagensDaTela> {
  return lerMensagens(await createClient(), createAdminClient(), filtros)
}

interface Nomes {
  porPerfil: Map<string, string>
  porAluno: Map<string, string>
}

/**
 * Nome de quem recebe. `profiles` não expõe SELECT à admin (deny-all) — a
 * leitura pontual usa a chave de serviço no servidor, como a tela velha e a
 * ficha. Aluno sem login é achado pelo `student_id` do payload: primeiro na
 * lista que a tela já leu; quem ficou fora dela (teto de linhas do PostgREST)
 * é lido por id — o nome na linha não pode depender do tamanho do cadastro.
 */
async function nomesDosDestinatarios(
  supabase: SupabaseClient,
  servico: SupabaseClient,
  mensagens: MensagemBruta[],
  alunos: z.infer<typeof AlunoBrutoSchema>[],
): Promise<Nomes> {
  const porAluno = new Map(alunos.map((a) => [a.id, a.display_name ?? 'Aluno sem nome']))
  const perfis = [...new Set(mensagens.map((m) => m.recipient_profile_id).filter((x): x is string => Boolean(x)))]
  const faltam = [
    ...new Set(
      mensagens
        .map((m) => (typeof m.payload?.student_id === 'string' ? m.payload.student_id : null))
        .filter((x): x is string => x !== null && !porAluno.has(x)),
    ),
  ]
  const [perfisR, faltamR] = await Promise.all([
    perfis.length
      ? servico.from('profiles').select('id, full_name').in('id', perfis)
      : Promise.resolve({ data: [], error: null }),
    faltam.length
      ? supabase.from('students').select('id, display_name, profile_id').in('id', faltam)
      : Promise.resolve({ data: [], error: null }),
  ])
  const porPerfil = new Map<string, string>()
  for (const p of z
    .array(z.object({ id: z.string(), full_name: z.string().nullable() }))
    .parse(exigir('nomes dos destinatários', perfisR))) {
    porPerfil.set(p.id, p.full_name ?? 'Sem nome no perfil')
  }
  for (const a of z.array(AlunoBrutoSchema).parse(exigir('alunos das mensagens', faltamR))) {
    porAluno.set(a.id, a.display_name ?? 'Aluno sem nome')
  }
  return { porPerfil, porAluno }
}

function montarLinha(m: MensagemBruta, nomes: Nomes): MensagemDaLista {
  const situacao = m.situacao
  const studentId = typeof m.payload?.student_id === 'string' ? m.payload.student_id : null
  const doPerfil = m.recipient_profile_id ? nomes.porPerfil.get(m.recipient_profile_id) : undefined
  const daFicha = studentId ? nomes.porAluno.get(studentId) : undefined
  // Endereçada a um perfil que não voltou na leitura (removido) NÃO é a órfã:
  // houve destinatário, e a frase não pode ser a mesma do aluno sem login.
  const destinatario =
    doPerfil ??
    (m.recipient_profile_id
      ? 'perfil não encontrado'
      : daFicha
        ? `${daFicha} (sem login)`
        : 'sem destinatário definido')
  return {
    id: m.id,
    tipo: nomeDoTemplate(m.template),
    canal: m.channel === 'whatsapp' ? 'whatsapp' : 'email',
    destinatario,
    destinatarioConhecido: Boolean(doPerfil ?? daFicha),
    contexto: contextoDaMensagem(m.payload),
    situacao,
    motivo: situacao === 'preso' ? motivoDaFalhaNaLista(m.error) : null,
    quando: quandoDaLinha(m),
  }
}

/** O instante que a linha conta: entregue/lida, enviada/resolvida ou, antes de sair, criada. */
function quandoDaLinha(m: MensagemBruta): string {
  const em = (iso: string | null) => instanteDaEscola(iso) ?? ''
  if (m.situacao === 'entregue') {
    const entregue = `entregue ${em(m.delivered_at)}`
    return (m.read_at ? `${entregue} · lida ${em(m.read_at)}` : entregue).trim()
  }
  if (m.sent_at) {
    // resolvida na mão, obsoleta ou reenviada: a palavra diz o que de fato aconteceu com a linha
    const verbo = m.situacao !== 'resolvido' ? 'enviada' : m.reenviado ? 'reenviada' : 'resolvida'
    return `${verbo} ${em(m.sent_at)}`.trim()
  }
  return `criada ${em(m.created_at)}`.trim()
}

function montarAberta(m: MensagemBruta, nomes: Nomes): MensagemAberta {
  const linha = montarLinha(m, nomes)
  return {
    ...linha,
    criadaEm: instanteDaEscola(m.created_at) ?? '—',
    enviadaEm: instanteDaEscola(m.sent_at),
    entregueEm: instanteDaEscola(m.delivered_at),
    lidaEm: instanteDaEscola(m.read_at),
    agendadaPara: instanteDaEscola(m.scheduled_for) ?? '—',
    erro: m.error,
    resolvivel: m.sent_at === null || m.situacao === 'preso',
    reenviavel: m.situacao !== 'pendente' && !m.reenviado,
    reenviada: m.reenviado,
  }
}
