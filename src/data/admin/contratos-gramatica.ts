// GRAMÁTICA DO ÍNDICE DE CONTRATOS (Onda 1 · M4-1) — contrato das leituras,
// vocabulário das duas chaves de URL (`?st=` e `?ver=`), montagem da linha,
// seções e casamento da busca.
//
// Módulo PURO de propósito, pelo mesmo motivo de `alunos-grupos.ts`:
// `contratos.ts` é `server-only` (fala com o banco e com o relógio) e este aqui
// é a parte que se prova sem banco — e a única que o componente CLIENTE da
// tabela pode importar (é ele quem filtra ao vivo a lista já carregada).
//
// Zero regra de negócio (Lei 3): saldo, validade e situação do contrato vêm
// prontos do Postgres (`contract_credit_summary()`, `contracts.status`). O que
// este arquivo faz é RECORTAR e NOMEAR: quem cai em qual seção, com que rótulo
// e em que ordem.

import { z } from 'zod'

// `normalizarTermo` vem do hub de alunos, e não de uma cópia: é a MESMA
// normalização de acento e caixa que a busca de gente usa — duas grafias de
// "sem acento" divergiriam no primeiro ajuste.
import { NIVEIS, nivelParaSlug, normalizarTermo, type Situacao } from './alunos-grupos'

/* ========================================================================== */
/* 1. Contrato do que o banco promete                                          */
/* ========================================================================== */

/**
 * Embed do PostgREST: sem tipos gerados, o supabase-js infere relação to-one
 * como array e o runtime entrega objeto. Mesma normalização de `one()` — aqui
 * ela vira pré-processo do schema, para o resto do arquivo só ver o objeto.
 */
function embed<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)), schema.nullable())
}

export const AlunoDoContratoSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  level: z.string().nullable(),
})

export const GrupoDoContratoSchema = z.object({ label: z.string() })

/** Uma linha de `contracts` como o índice a lê (particulares). */
export const ContratoBrutoSchema = z.object({
  id: z.string(),
  contract_type: z.string(),
  plan_name: z.string().nullable(),
  status: z.string(),
  hourly_rate_cents: z.number().nullable(),
  teacher_id: z.string().nullable(),
  student_group_id: z.string().nullable(),
  students: embed(AlunoDoContratoSchema),
  student_groups: embed(GrupoDoContratoSchema),
})

export const ContratosBrutosSchema = z.array(ContratoBrutoSchema)
export type ContratoBruto = z.infer<typeof ContratoBrutoSchema>

/** `recurring_slots` vigente (o índice só lê horário sem fechamento). */
export const SlotBrutoSchema = z.object({
  id: z.string(),
  contract_id: z.string(),
  weekday: z.number(),
  local_time: z.string(),
  iana_tz: z.string(),
  duration_min: z.number(),
})
export const SlotsBrutosSchema = z.array(SlotBrutoSchema)
export type SlotBruto = z.infer<typeof SlotBrutoSchema>

/** `contract_credit_summary()` — saldo derivado + próxima validade, em lote. */
export const ResumoDeCreditoSchema = z.object({
  contract_id: z.string(),
  balance: z.coerce.number().nullable(),
  next_expiry: z.string().nullable(),
})
export const ResumosDeCreditoSchema = z.array(ResumoDeCreditoSchema)

export const ProfessoraDoIndiceSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable(),
  is_owner: z.boolean().nullable(),
  iana_tz: z.string().nullable(),
})
export const ProfessorasDoIndiceSchema = z.array(ProfessoraDoIndiceSchema)

export const AssinaturaBrutaSchema = z.object({
  contract_id: z.string(),
  status: z.string(),
  // c15 · Sol 8: `reserved_at` é quando o PEDIDO começou (toda linha tem, e é
  // ele que ordena o histórico); `sent_at` é quando o DOCUMENTO passou a
  // existir — nulo na reserva aberta e na reserva morta, porque envio não houve.
  reserved_at: z.string(),
  sent_at: z.string().nullable(),
})
export const AssinaturasBrutasSchema = z.array(AssinaturaBrutaSchema)

export const ContratoDeMentoriaBrutoSchema = z.object({
  id: z.string(),
  status: z.string(),
  students: embed(AlunoDoContratoSchema),
  mentorship_contracts: embed(z.object({ course_start_date: z.string().nullable() })),
})
export const ContratosDeMentoriaBrutosSchema = z.array(ContratoDeMentoriaBrutoSchema)

/* ========================================================================== */
/* 2. Vocabulário das duas chaves de URL                                       */
/* ========================================================================== */

/**
 * `?st=` — o recorte de SITUAÇÃO, herdado da tela velha com o mesmo sentido
 * (link salvo continua chegando onde prometia).
 *
 * "Todos" NÃO inclui encerrado, e isso é regra da tela velha, não descuido: o
 * índice é a lista de trabalho da escola, e contrato encerrado é histórico —
 * ele vive na ficha do aluno, na seção "Contratos encerrados".
 */
export const FILTROS_DE_CONTRATO = ['todos', 'active', 'paused'] as const
export type FiltroDeContrato = (typeof FILTROS_DE_CONTRATO)[number]

export function ehFiltroDeContrato(v: string | undefined): v is FiltroDeContrato {
  return !!v && (FILTROS_DE_CONTRATO as readonly string[]).includes(v)
}

/** Como a fileira de botões nomeia cada recorte (maiúscula: nomeia um GRUPO). */
export const FILTRO_ROTULO: Record<FiltroDeContrato, string> = {
  todos: 'Todos',
  active: 'Ativos',
  paused: 'Pausados',
}

/**
 * Os quatro EIXOS de agrupamento — os que viram CARTÕES DE ACESSO no índice e
 * ganham página de grupo (`/admin/alunos/contratos/grupo/[eixo]/[valor]`).
 *
 * Portão visual do dono (27/07/2026): o "ver por" deixou de empilhar seções com
 * tabela e passou a desenhar cartões, como a aba Alunos já fazia. Daí a lista
 * existir separada da `VISOES_DE_CONTRATO`: "lista" é a tabela inteira, e não
 * um recorte que se possa abrir.
 */
export const EIXOS_DE_CONTRATO = ['professora', 'nivel', 'produto', 'situacao'] as const
export type EixoDeContratos = (typeof EIXOS_DE_CONTRATO)[number]

export function ehEixoDeContratos(v: string | undefined): v is EixoDeContratos {
  return !!v && (EIXOS_DE_CONTRATO as readonly string[]).includes(v)
}

/**
 * `?ver=` — como a lista se ORGANIZA. A tela velha tinha três modos (lista,
 * professora, nível); a spec do M4 pede os quatro eixos + a lista.
 */
export const VISOES_DE_CONTRATO = ['lista', ...EIXOS_DE_CONTRATO] as const
export type VisaoDeContratos = (typeof VISOES_DE_CONTRATO)[number]

export function ehVisaoDeContratos(v: string | undefined): v is VisaoDeContratos {
  return !!v && (VISOES_DE_CONTRATO as readonly string[]).includes(v)
}

export const VISAO_ROTULO: Record<VisaoDeContratos, string> = {
  lista: 'Lista',
  professora: 'Professora',
  nivel: 'Nível',
  produto: 'Produto',
  situacao: 'Situação',
}

/* ========================================================================== */
/* 3. A linha da tabela                                                        */
/* ========================================================================== */

export type SituacaoDeContrato = 'active' | 'paused' | 'ended'

/** Como a PÍLULA da linha diz a situação (minúscula: é adjetivo do contrato). */
export const SITUACAO_DE_CONTRATO_ROTULO: Record<SituacaoDeContrato, string> = {
  active: 'ativo',
  paused: 'pausado',
  ended: 'encerrado',
}

/**
 * A situação do CONTRATO na paleta da SITUAÇÃO DO ALUNO (`Pill tone="situacao"`).
 *
 * As palavras são as mesmas do hub ("ativo", "pausado") e as cores também têm de
 * ser: um contrato pausado pintado de outra cor que o aluno pausado faria a
 * mesma palavra significar duas coisas em duas telas irmãs.
 */
export const SITUACAO_DE_CONTRATO_COMO_ALUNO: Record<SituacaoDeContrato, Situacao> = {
  active: 'ativo',
  paused: 'pausado',
  ended: 'arquivado',
}

export function situacaoDoContrato(status: string): SituacaoDeContrato {
  return status === 'active' || status === 'paused' ? status : 'ended'
}

/** Rótulo humano do estado da assinatura digital (o mesmo da tela velha). */
export const ASSINATURA_ROTULO: Record<string, string> = {
  // c14: os dois estados da RESERVA (o espelho que nasce antes do documento).
  // `pending` é o pedido que a admin começou e ainda não virou documento lá
  // fora; `failed` é o pedido que morreu antes disso — nenhum dos dois tem
  // documento para consultar, e é por isso que a tela não oferece "ver status".
  //
  // c15: `pending` deixou de ser "envio em andamento". Desde que o relógio de 30
  // minutos morreu, uma reserva pode ficar aberta por horas esperando alguém
  // conferir o Autentique — e "em andamento" convida a esperar, que é o pior
  // conselho possível. "Reserva aberta" diz o que é: um pedido começado, sem
  // documento, esperando UMA DECISÃO.
  pending: 'reserva aberta',
  failed: 'envio não concluído',
  sent: 'assinatura enviada',
  // c16 · r6 nº 3: `viewed` deixou de ser só "alguém abriu". Desde que o aceite
  // de UM signatário parou de encerrar o documento, este degrau cobre também
  // "alguém já assinou e ainda falta gente" — e o espelho local, que tem uma
  // linha por documento, não sabe dizer qual dos dois é. "Em andamento" é o que
  // sabemos; "visualizada" seria afirmar o que não sabemos.
  viewed: 'assinatura em andamento',
  signed: 'assinado',
  refused: 'assinatura recusada',
  expired: 'assinatura expirada',
  cancelled: 'assinatura cancelada',
}

/**
 * OS ESTADOS DE ASSINATURA QUE NÃO MUDAM MAIS (c15 · Sol 9).
 *
 * A matriz do banco (`apply_autentique_event`, migration 20260715000400) não sai
 * de terminal nenhum: assinado, recusado, expirado e cancelado são fim de linha,
 * e `failed` é a reserva que morreu antes de virar documento. A tela usava uma
 * lista MENOR que a do banco — `expired` e `cancelled` ficavam de fora —, e por
 * isso oferecia "Ver status" num documento cujo estado já não pode mudar: um
 * botão que só sabe responder "nada mudou nesta assinatura", para sempre.
 */
export const ESTADOS_TERMINAIS: ReadonlySet<string> = new Set([
  'signed',
  'refused',
  'expired',
  'cancelled',
  'failed',
])

/** Um horário fixo, com as duas horas JÁ FORMATADAS no servidor (Lei 1). */
export interface HorarioDoContrato {
  id: string
  /** "terça · 20:30–21:15" no fuso do horário (o do aluno / a âncora do grupo) */
  aluno: string
  /** a MESMA hora no relógio da professora — só quando diverge */
  professora: string | null
}

export interface AssinaturaDoContrato {
  status: string
  rotulo: string
}

export interface ContratoDaLista {
  id: string
  /** identidade: o nome do aluno ou o rótulo do grupo */
  quem: string
  /** ficha do aluno; `null` em contrato de grupo (a ficha é de uma pessoa) */
  alunoId: string | null
  grupo: boolean
  plano: string
  nivel: string | null
  professoraId: string | null
  professora: string | null
  /** índice de cor da professora (a bolinha) — mesma ordem da agenda */
  professoraIdx: number
  situacao: SituacaoDeContrato
  situacaoRotulo: string
  horarios: HorarioDoContrato[]
  /** contrato ATIVO sem nenhum horário fixo vigente (aviso da tela velha) */
  semHorarioFixo: boolean
  /** contrato ATIVO sem nenhuma aula futura agendada (aviso da tela velha) */
  semAulasFuturas: boolean
  /** já em reais (Lei 9: centavos no banco, `fmtBRL` na tela) */
  valorHora: string | null
  /** saldo derivado de `contract_credit_summary()` */
  saldo: number
  /** próxima validade, já formatada no servidor */
  proximaValidade: string | null
  assinatura: AssinaturaDoContrato | null
}

/** Nome do plano quando o contrato não tem um — nunca string vazia na tela. */
export const SEM_PLANO = 'Sem plano'

/**
 * Traduz a linha crua do banco na linha da tabela.
 *
 * Tudo que depende de FUSO, de RELÓGIO ou de DINHEIRO chega pronto de fora: as
 * duas primeiras coisas são Lei 1 (calculadas no servidor, com Luxon, na zona
 * daquele dia) e a terceira é Lei 9 (centavos formatados uma vez). O que sobra
 * aqui é escolha de palavra e as duas perguntas que a tela velha respondia com
 * pílula de aviso.
 */
export function montarContrato(
  bruto: ContratoBruto,
  pronto: {
    professora: { id: string | null; nome: string | null; idx: number }
    horarios: HorarioDoContrato[]
    /** há aula `scheduled` no futuro para este contrato? */
    temAulaFutura: boolean
    valorHora: string | null
    saldo: number
    proximaValidade: string | null
    assinatura: AssinaturaDoContrato | null
  },
): ContratoDaLista {
  const situacao = situacaoDoContrato(bruto.status)
  const aluno = bruto.students
  const grupo = bruto.student_groups

  return {
    id: bruto.id,
    quem: aluno?.display_name ?? grupo?.label ?? '—',
    alunoId: aluno?.id ?? null,
    grupo: !aluno && !!grupo,
    plano: bruto.plan_name?.trim() || SEM_PLANO,
    nivel: aluno?.level ?? null,
    professoraId: pronto.professora.id,
    professora: pronto.professora.nome,
    professoraIdx: pronto.professora.idx,
    situacao,
    situacaoRotulo: SITUACAO_DE_CONTRATO_ROTULO[situacao],
    horarios: pronto.horarios,
    // Os dois avisos só existem em contrato ATIVO — num pausado, "sem aulas
    // futuras" é a consequência esperada da pausa, e acender alarme ali seria
    // ruído sobre uma decisão que a escola já tomou.
    semHorarioFixo: situacao === 'active' && pronto.horarios.length === 0,
    semAulasFuturas: situacao === 'active' && !pronto.temAulaFutura,
    valorHora: pronto.valorHora,
    saldo: pronto.saldo,
    proximaValidade: pronto.proximaValidade,
    assinatura: pronto.assinatura,
  }
}

/* ========================================================================== */
/* 4. Grupos do "ver por" (cartões de acesso + a página de cada recorte)        */
/* ========================================================================== */

export const SEM_PROFESSORA = 'sem-professora'
export const SEM_NIVEL = 'sem-nivel'

export interface SecaoDeContratos {
  chave: string
  /** o que vai na URL (`/admin/alunos/contratos/grupo/[eixo]/[valor]`) */
  slug: string
  rotulo: string
  total: number
  /** pendência do grupo: quantos contratos ATIVOS estão sem horário fixo */
  semHorarioFixo: number
  contratos: ContratoDaLista[]
  /** identidade visual da seção `professora` */
  professoraIdx?: number
  /** identidade visual da seção `nivel` */
  nivel?: string | null
  /** identidade visual da seção `situacao` */
  situacao?: SituacaoDeContrato
}

/** Em que seção deste eixo o contrato entra. Sempre UMA (ao contrário do hub de
 *  alunos, onde uma pessoa pode aparecer em dois cartões de produto): contrato
 *  tem uma professora, um nível, um plano e uma situação. */
function chaveDaSecao(
  c: ContratoDaLista,
  visao: Exclude<VisaoDeContratos, 'lista'>,
): { chave: string; rotulo: string } {
  if (visao === 'professora')
    return c.professoraId
      ? { chave: c.professoraId, rotulo: c.professora ?? '—' }
      : { chave: SEM_PROFESSORA, rotulo: 'Sem professora' }
  if (visao === 'nivel')
    return c.nivel ? { chave: c.nivel, rotulo: c.nivel } : { chave: SEM_NIVEL, rotulo: 'Sem nível' }
  // PRODUTO, na fase 1: o produto da escola é o PLANO do contrato
  // (`contracts.plan_name`) — não existe entidade Produto no banco, e ela é
  // onda futura (o mesmo vocabulário que `planosDoSeletor` oferece no cadastro).
  if (visao === 'produto') return { chave: c.plano, rotulo: c.plano }
  return { chave: c.situacao, rotulo: SITUACAO_DE_CONTRATO_ROTULO[c.situacao] }
}

/**
 * O que vai na URL do grupo. Só o NÍVEL precisa de tradução: `A1+` viraria
 * `A1%2B` no endereço, e a mesma função (`nivelParaSlug`) já resolve isso no
 * hub de alunos — duas grafias de "a1-mais" divergiriam no primeiro ajuste.
 * Os outros três eixos vão como estão (id da professora, nome do plano, estado
 * do contrato); quem escapa o que precisa é `enderecoDoGrupoDeContratos`.
 */
function slugDaSecao(visao: EixoDeContratos, chave: string, nivel: string | null): string {
  return visao === 'nivel' ? nivelParaSlug(nivel) : chave
}

/** O endereço do grupo (N2) — o mesmo padrão da rota irmã de alunos. */
export function enderecoDoGrupoDeContratos(eixo: EixoDeContratos, slug: string): string {
  return `/admin/alunos/contratos/grupo/${eixo}/${encodeURIComponent(slug)}`
}

const ORDEM_DA_SITUACAO: Record<SituacaoDeContrato, number> = { active: 0, paused: 1, ended: 2 }

function ordemDaSecao(visao: Exclude<VisaoDeContratos, 'lista'>, s: SecaoDeContratos): number {
  if (visao === 'professora') return s.chave === SEM_PROFESSORA ? 999 : (s.professoraIdx ?? 998)
  if (visao === 'nivel') {
    const i = NIVEIS.indexOf((s.nivel ?? '') as (typeof NIVEIS)[number])
    return i === -1 ? 999 : i
  }
  if (visao === 'produto') return s.chave === SEM_PLANO ? 999 : 0
  return ORDEM_DA_SITUACAO[s.situacao ?? 'ended']
}

/**
 * Parte a lista em grupos, na ordem da casa (dona primeiro nas professoras,
 * escala Flexge nos níveis, ativos antes de pausados). Grupo vazio não existe —
 * cartão com zero contrato é ruído.
 *
 * A ordem DENTRO do grupo é a que chegou (a do banco: contrato mais novo
 * primeiro), porque reordenar aqui esconderia o critério da lista.
 */
export function agruparContratos(
  contratos: ContratoDaLista[],
  visao: VisaoDeContratos,
): SecaoDeContratos[] {
  if (visao === 'lista') return []
  const por = new Map<string, SecaoDeContratos>()
  for (const c of contratos) {
    const { chave, rotulo } = chaveDaSecao(c, visao)
    const secao =
      por.get(chave) ??
      ({
        chave,
        slug: slugDaSecao(visao, chave, c.nivel),
        rotulo,
        total: 0,
        semHorarioFixo: 0,
        contratos: [],
        professoraIdx: visao === 'professora' ? c.professoraIdx : undefined,
        nivel: visao === 'nivel' ? c.nivel : undefined,
        situacao: visao === 'situacao' ? c.situacao : undefined,
      } satisfies SecaoDeContratos)
    secao.total += 1
    // A pendência do cartão — o mesmo aviso que a linha da tabela já dá, somado
    // no grupo: é ele que faz alguém clicar antes dos outros.
    if (c.semHorarioFixo) secao.semHorarioFixo += 1
    secao.contratos.push(c)
    por.set(chave, secao)
  }
  return [...por.values()].sort(
    (a, b) => ordemDaSecao(visao, a) - ordemDaSecao(visao, b) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'),
  )
}

/* ========================================================================== */
/* 5. Busca                                                                    */
/* ========================================================================== */

/**
 * A busca do índice casa por QUEM (aluno ou grupo) e por PLANO — as duas coisas
 * pelas quais a dona chama um contrato. A tela velha só casava por quem; o
 * plano entrou porque ele é o produto, e "quem está no plano do casal?" é
 * pergunta de todo mês.
 */
export function casaComBuscaDeContrato(contrato: ContratoDaLista, termo: string): boolean {
  const t = normalizarTermo(termo)
  if (!t) return true
  return normalizarTermo(contrato.quem).includes(t) || normalizarTermo(contrato.plano).includes(t)
}

/* ========================================================================== */
/* 6. O DETALHE (`/admin/contratos/[id]`, M4-2)                                */
/* ========================================================================== */

/**
 * Os painéis do detalhe, na ordem em que a tela os oferece.
 *
 * Cada um é o MESMO formulário que a tela velha empilhava no Drawer do cartão —
 * mesmos campos, mesma server action, mesma RPC. O que muda é a moldura (Sheet
 * do kit) e o endereço: painel é `?painel=…`, então ele sobrevive ao F5, ao
 * voltar do navegador e ao link colado no WhatsApp.
 *
 * `horario-trocar` é o único que age sobre UMA linha, e por isso recebe
 * `?alvo=<slot>` — a mesma convenção de `?alvo=` da ficha do aluno.
 */
export const PAINEIS_DO_CONTRATO = [
  'regras',
  'renovar',
  'encerrar',
  'pausa',
  'credito',
  'assinatura',
  // c15 · decisão B: os DOIS atos humanos sobre uma reserva aberta (o relógio de
  // 30 minutos do c14 morreu). Cada um é um painel próprio — um formulário, um
  // endereço, um rodapé [Cancelar | ação] —, e os dois recebem `?alvo=<reserva>`.
  'reserva-anexar',
  'reserva-cancelar',
  'horario-novo',
  'horario-trocar',
  // Onda Financeiro · F2: a mensalidade cadastrada (alimenta o previsto v3).
  // Painel próprio, e não campo do "regras": a porta no banco é outra RPC
  // (admin_set_contract_monthly_value), com transação e trilha próprias.
  'mensalidade',
] as const
export type PainelDoContrato = (typeof PAINEIS_DO_CONTRATO)[number]

export function ehPainelDoContrato(v: string | undefined): v is PainelDoContrato {
  return !!v && (PAINEIS_DO_CONTRATO as readonly string[]).includes(v)
}

/** O título do painel — o que o cabeçalho do Sheet anuncia. */
export const PAINEL_DO_CONTRATO_TITULO: Record<PainelDoContrato, string> = {
  regras: 'Editar plano e franquia',
  renovar: 'Renovar contrato',
  encerrar: 'Encerrar contrato',
  pausa: 'Pausa do contrato',
  credito: 'Ajustar créditos',
  assinatura: 'Assinatura do contrato',
  'reserva-anexar': 'Anexar o id do documento',
  'reserva-cancelar': 'Cancelar a reserva',
  'horario-novo': 'Novo horário fixo',
  'horario-trocar': 'Trocar o horário fixo',
  mensalidade: 'Mensalidade do contrato',
}

/**
 * A FRASE QUE O CANCELAMENTO DE RESERVA EXIGE (c15 · decisão B).
 *
 * Ela é a instrução, não a identificação: nas outras destrutivas a pessoa digita
 * o NOME (o risco é apagar a coisa errada), e aqui o risco é apagar SEM TER
 * OLHADO — uma reserva cancelada às cegas libera um segundo envio para um
 * contrato que talvez já tenha documento no Autentique.
 *
 * A cópia canônica está na RPC `admin_cancel_signature` (é ela quem recusa); o
 * aceite do c15 confere que as duas são a mesma frase, letra por letra.
 */
export const FRASE_DE_CANCELAR_RESERVA =
  'confira antes no painel do Autentique se o documento existe'

/**
 * QUANTO CABE NO MOTIVO DO CANCELAMENTO (c16 · r6 nº 13).
 *
 * A REGRA é a RPC `admin_cancel_signature` (`char_length(motivo) > 200` recusa,
 * migration `20260727001600`). Este número é o que a tela usa para ANTECIPAR a
 * recusa em português — e a conta, dos dois lados, é de CARACTERES: `[...s]`
 * aqui, `char_length` lá. O `maxLength={200}` que existia no input morreu porque
 * ele media unidades UTF-16, isto é: recusava 101 emojis e aceitava 200 letras,
 * e não valia nada para um POST montado à mão.
 */
export const TETO_DO_MOTIVO = 200

/**
 * A SUPERFÍCIE DE ASSINATURA VIVE ATRÁS DO GATE 🔑 (ADR-029 §1).
 *
 * Os três painéis que só funcionam com o `AUTENTIQUE_TOKEN` no ambiente: enviar
 * (e consultar) o documento, anexar o id de um documento que se conferiu existir
 * e cancelar a reserva aberta. Sem a chave, nenhum deles é alcançável — nem pelo
 * botão (que não é desenhado) nem pelo endereço colado (que volta para o
 * detalhe, a mesma rede de baixo do contrato encerrado).
 *
 * A lista mora aqui, e não num `if` dentro da tela, porque quem a consome são
 * DOIS arquivos (as seções e os painéis) e um painel novo esquecido de um lado
 * seria uma porta aberta que ninguém procuraria.
 */
export const PAINEIS_DE_ASSINATURA = [
  'assinatura',
  'reserva-anexar',
  'reserva-cancelar',
] as const satisfies readonly PainelDoContrato[]

export function painelPedeAutentique(painel: PainelDoContrato): boolean {
  return (PAINEIS_DE_ASSINATURA as readonly string[]).includes(painel)
}

/**
 * O AVISO HONESTO que a seção Assinatura mostra enquanto o gate 🔑 não abre.
 *
 * Ele diz três coisas, nesta ordem: o que falta (a chave), de quem depende
 * (gate externo, não bug) e o que fazer enquanto isso (resolver a assinatura
 * fora do sistema). O que ele NÃO faz é prometer prazo.
 */
export const AVISO_DA_ASSINATURA_DESLIGADA =
  'A assinatura digital chega com a chave do Autentique — é gate externo pendente (🔑). Até lá o contrato se assina fora do sistema, e esta seção não promete envio nenhum: nada aqui manda documento, e nada aqui registra assinatura.'

/** O endereço do detalhe, com painel (e alvo) quando houver. */
export function enderecoDoContrato(
  id: string,
  opcoes: { painel?: PainelDoContrato; alvo?: string } = {},
): string {
  const q = new URLSearchParams()
  if (opcoes.painel) q.set('painel', opcoes.painel)
  if (opcoes.alvo) q.set('alvo', opcoes.alvo)
  const s = q.toString()
  return s ? `/admin/contratos/${id}?${s}` : `/admin/contratos/${id}`
}

/** Os dias da semana por extenso, na convenção do banco (0 = domingo). */
export const DIAS_DA_SEMANA = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
] as const

/*
 * O TYPE-TO-CONFIRM DO ENCERRAMENTO NÃO MORA MAIS AQUI (c13 · nº 5).
 *
 * `nomeConfirmado(digitado, esperado)` viveu neste arquivo enquanto a comparação
 * era do app. Ela desceu inteira para `admin_end_contract` (`p_confirm_name`,
 * conferido contra a linha travada, DENTRO da transação que encerra) porque
 * comparar no app exigia ler o nome numa consulta e encerrar em outra — e entre
 * as duas cabia um `update students set display_name` (TOCTOU). Deixar aqui uma
 * cópia da régua seria manter viva a versão que perdeu: Lei 3, um lugar só.
 * A régua do banco é a mesma em espírito: `lower(btrim(…))` dos dois lados —
 * caixa não importa, acento importa.
 */

/* -------------------------------------------------------------- os payloads */

/** A linha de `contracts` como o DETALHE a lê (o índice lê menos). */
export const ContratoDoDetalheSchema = z.object({
  id: z.string(),
  contract_type: z.string(),
  plan_name: z.string().nullable(),
  status: z.string(),
  hourly_rate_cents: z.number().nullable(),
  monthly_value_cents: z.number().nullable(),
  monthly_reschedule_allowance: z.number().nullable(),
  min_notice_hours: z.number().nullable(),
  makeup_credit_expiry_days: z.number().nullable(),
  school_fault_credit_expiry_days: z.number().nullable(),
  is_trial: z.boolean().nullable(),
  started_on: z.string(),
  ended_on: z.string().nullable(),
  renewed_from: z.string().nullable(),
  teacher_id: z.string().nullable(),
  student_id: z.string().nullable(),
  student_group_id: z.string().nullable(),
  group_tz_anchor_student: z.string().nullable(),
  students: embed(
    AlunoDoContratoSchema.extend({ iana_tz: z.string(), tz_confirmed: z.boolean().nullable() }),
  ),
  student_groups: embed(GrupoDoContratoSchema),
})
export type ContratoDoDetalhe = z.infer<typeof ContratoDoDetalheSchema>

/**
 * `recurring_slots` do detalhe: aqui entram TAMBÉM os fechados (`active_to`),
 * porque o histórico de horário é dado do contrato — foi ele que decidiu quais
 * aulas existiram.
 */
export const SlotDoDetalheSchema = SlotBrutoSchema.extend({
  active_from: z.string(),
  active_to: z.string().nullable(),
})
export const SlotsDoDetalheSchema = z.array(SlotDoDetalheSchema)
export type SlotDoDetalhe = z.infer<typeof SlotDoDetalheSchema>

export const PausaBrutaSchema = z.object({
  contract_id: z.string(),
  paused_on: z.string(),
  resumed_on: z.string().nullable(),
})
export const PausasBrutasSchema = z.array(PausaBrutaSchema)

/** O detalhe mostra a HISTÓRIA da assinatura (o índice só o último estado). */
export const AssinaturaDoDetalheSchema = AssinaturaBrutaSchema.extend({
  id: z.string(),
  // NULO desde o c14: a reserva (`pending`) e a reserva morta (`failed`) são
  // espelho SEM documento — o id só existe depois que o Autentique cria.
  provider_document_id: z.string().nullable(),
  signed_at: z.string().nullable(),
})
export const AssinaturasDoDetalheSchema = z.array(AssinaturaDoDetalheSchema)

export const MembroDoGrupoSchema = z.object({
  student_id: z.string(),
  students: embed(
    z.object({
      id: z.string(),
      display_name: z.string(),
      iana_tz: z.string(),
      // c12 · nº 5: o membro também diz se a cidade dele é FATO ou palpite. O
      // detalhe de um contrato de TURMA derivava `fusoConfirmado` do aluno
      // direto — que num contrato de grupo é `null` —, então a turma sempre
      // parecia confirmada e a tela oferecia "Novo horário" para um gate que o
      // banco (`_require_confirmed_tz`, que varre os membros) ia recusar.
      tz_confirmed: z.boolean().nullable().optional(),
    }),
  ),
})
export const MembrosDoGrupoSchema = z.array(MembroDoGrupoSchema)

/** Contrato-destino do crédito no encerramento (particular ATIVO do mesmo dono). */
export const ContratoDestinoSchema = z.object({ id: z.string(), plan_name: z.string().nullable() })
export const ContratosDestinoSchema = z.array(ContratoDestinoSchema)
