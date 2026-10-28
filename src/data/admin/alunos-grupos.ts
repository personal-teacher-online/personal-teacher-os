// GRAMÁTICA DO HUB DE ALUNOS (Onda 1 · M3) — contrato do diretório, eixos de
// agrupamento e o casamento da busca. Módulo PURO de propósito: `alunos.ts` é
// `server-only` (fala com o banco e com o relógio) e este aqui é a parte que
// pode ser provada sem banco, importada pelo teste e — no caso do matcher da
// busca — pelo componente cliente que filtra a lista já carregada.
//
// Nada aqui decide regra de negócio (Lei 3): saldo, expiração e estado de
// contrato vêm prontos de `admin_student_directory()`. O que este arquivo faz é
// RECORTAR: quem cai em qual grupo, com que rótulo e em que ordem.

import { z } from 'zod'

/* ========================================================================== */
/* 1. Contrato do diretório (o que o banco promete)                            */
/* ========================================================================== */

/** Um contrato NÃO ENCERRADO do aluno, como vem no `contracts` (jsonb). */
export const ContratoDoDiretorioSchema = z.object({
  contract_id: z.string(),
  contract_type: z.enum(['private_1on1', 'mentorship']),
  plan_name: z.string().nullable(),
  status: z.string(),
  teacher_id: z.string().nullable(),
  teacher_name: z.string().nullable(),
  group_label: z.string().nullable(),
  /**
   * CICLO DE VIDA (fase 1) — o contrato leve que nasce junto da AULA
   * EXPERIMENTAL (`contracts.is_trial`, F2). É o marcador que separa
   * "experimental" de "ativo" na situação derivada.
   *
   * `nullish` com queda para `false` em `situacaoDoAluno`: o campo entrou no
   * jsonb na migration 20260727000400 e um payload antigo (cache de request de
   * um deploy em voo) não pode derrubar a lista inteira por um booleano.
   */
  is_trial: z.boolean().nullish(),
  /** só existe em contrato particular (a mentoria tem ledger próprio) */
  balance: z.coerce.number().nullish(),
  next_expiry: z.string().nullish(),
})

export const AlunoDoDiretorioSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  iana_tz: z.string(),
  status: z.string(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  level: z.string().nullable(),
  profile_id: z.string().nullable(),
  whatsapp_e164: z.string().nullable(),
  whatsapp_channel_ack_at: z.string().nullable(),
  email_bounced_at: z.string().nullable(),
  invited_at: z.string().nullable(),
  email: z.string().nullable(),
  email_confirmed: z.boolean().nullable(),
  last_sign_in_at: z.string().nullable(),
  contracts: z.array(ContratoDoDiretorioSchema),
})

export const DiretorioSchema = z.array(AlunoDoDiretorioSchema)

export type AlunoDoDiretorio = z.infer<typeof AlunoDoDiretorioSchema>

/* ========================================================================== */
/* 2. A linha da tabela                                                        */
/* ========================================================================== */

/** Estado de acesso ao portal — as três situações que a coluna "Acesso" conta. */
export type Acesso = 'ativo' | 'pendente' | 'sem_convite'

export const ACESSO_ROTULO: Record<Acesso, string> = {
  ativo: 'ativo',
  pendente: 'convite pendente',
  sem_convite: 'sem convite',
}

/** As três situações são vocabulário FECHADO: é o `?f=` da aba Convites (e o
 *  mesmo `?f=` que a lista velha usava como chip de recorte). */
export const ACESSOS = ['ativo', 'pendente', 'sem_convite'] as const

export function ehAcesso(v: string | undefined): v is Acesso {
  return !!v && (ACESSOS as readonly string[]).includes(v)
}

/* -------------------------------------------------------------------------- */
/* 2b. SITUAÇÃO no ciclo de vida (derivada, nunca coluna)                       */
/* -------------------------------------------------------------------------- */

/**
 * As seis situações que a lista desenha e filtra.
 *
 * ARMAZENADO em `students.status` são só três (`lead` · `active` ·
 * `archived`); as outras três saem do que o aluno TEM — contrato vivo, contrato
 * experimental, contrato em pausa. É o princípio da spec (`derivar > duplicar`)
 * e a razão de esta função ser pura: a badge é uma LEITURA, e leitura não pode
 * ter uma segunda verdade guardada em coluna que envelhece.
 */
export const SITUACOES = [
  'lead',
  'experimental',
  'ativo',
  'pausado',
  'sem_contrato',
  'arquivado',
] as const
export type Situacao = (typeof SITUACOES)[number]

export function ehSituacao(v: string | undefined): v is Situacao {
  return !!v && (SITUACOES as readonly string[]).includes(v)
}

/** Como a PÍLULA diz a situação de UMA pessoa (minúscula: é adjetivo dela). */
export const SITUACAO_ROTULO: Record<Situacao, string> = {
  lead: 'lead',
  experimental: 'experimental',
  ativo: 'ativo',
  pausado: 'pausado',
  sem_contrato: 'sem contrato',
  arquivado: 'arquivado',
}

/** Como a BADGE DE FILTRO diz o recorte (maiúscula: nomeia um grupo de gente). */
export const SITUACAO_FILTRO: Record<Situacao, string> = {
  lead: 'Lead',
  experimental: 'Experimental',
  ativo: 'Ativo',
  pausado: 'Pausado',
  sem_contrato: 'Sem contrato',
  arquivado: 'Arquivado',
}

/** O contrato, no mínimo que a derivação precisa saber dele. */
export interface ContratoParaSituacao {
  status: string
  is_trial?: boolean | null
}

/**
 * Em que ponto do ciclo de vida está esta pessoa.
 *
 * A ordem das perguntas é a da spec, e cada ramo tem um porquê:
 *
 * 1. **arquivado** manda em tudo — quem saiu (ou o lead perdido) não é lead nem
 *    aluno; é histórico.
 * 2. **lead** com aula experimental marcada é **experimental**: a etapa do
 *    funil em que a escola já gastou hora de professora.
 * 3. Pessoa que nasceu DA aula experimental (`admin_create_trial_class` cria
 *    cadastro + contrato leve, e o cadastro nasce `active`) também é
 *    **experimental** enquanto o contrato leve for o único que ela tem: o que
 *    define a etapa é a EXPERIMENTAL, não a coluna de status. Sem este ramo, a
 *    badge chamaria de "ativo" quem ainda não fechou nada — e a lista voltaria
 *    a mentir sobre o funil, que é justamente o que a spec veio consertar.
 * 4. **pausado** é estado do CONTRATO (`contracts.status = 'paused'`, escrito
 *    por `pause_contract`), e só vale quando TODOS os contratos reais estão
 *    pausados: quem pausou um de dois contratos continua tendo aula, e dizer
 *    "pausado" ali seria mentira.
 * 5. **sem contrato** é o balde que já existia: cadastrado, não arquivado, sem
 *    nada vivo.
 */
export function situacaoDoAluno(aluno: {
  /** `students.status` cru */
  status: string
  /** os contratos do aluno (a função ignora sozinha os encerrados) */
  contratos: ContratoParaSituacao[]
}): Situacao {
  if (aluno.status === 'archived') return 'arquivado'

  const vivos = aluno.contratos.filter((c) => c.status !== 'ended')
  const experimental = vivos.some((c) => c.is_trial === true)
  const reais = vivos.filter((c) => c.is_trial !== true)

  if (aluno.status === 'lead') return experimental ? 'experimental' : 'lead'
  if (reais.length === 0) return experimental ? 'experimental' : 'sem_contrato'
  return reais.every((c) => c.status === 'paused') ? 'pausado' : 'ativo'
}

/**
 * A lista de TRABALHO: o dia a dia da escola, sem os dois extremos do funil.
 * Lead ainda não é aluno e arquivado já não é — os dois têm badge própria para
 * quem os quiser ver.
 */
export function noDiaADia(aluno: { situacao: Situacao }): boolean {
  return aluno.situacao !== 'lead' && aluno.situacao !== 'arquivado'
}

/** Quantos em cada situação — a contagem viva de cada badge. */
export function contarSituacoes(alunos: { situacao: Situacao }[]): Record<Situacao, number> {
  const zero = Object.fromEntries(SITUACOES.map((s) => [s, 0])) as Record<Situacao, number>
  for (const a of alunos) zero[a.situacao] += 1
  return zero
}

/** Vínculo de aula particular: com quem o aluno estuda. */
export interface VinculoParticular {
  contratoId: string
  professoraId: string | null
  professora: string | null
  /** índice de cor da professora (a bolinha) — mesma ordem da agenda */
  professoraIdx: number
  /** rótulo da turma, quando o contrato é de grupo */
  turma: string | null
}

export interface AlunoDaLista {
  id: string
  nome: string
  /** nível Flexge; `null` = ainda não classificado */
  nivel: string | null
  /** e-mail do login (só existe depois do convite) — coluna da aba Convites */
  email: string | null
  /** quando o convite saiu, já FORMATADO no servidor (Lei 1); `null` = nunca */
  convidadoEm: string | null
  /**
   * SITUAÇÃO no ciclo de vida — DERIVADA (`situacaoDoAluno`), não é o
   * `students.status` cru: é ela que a pílula da linha desenha e que as badges
   * do hub filtram.
   */
  situacao: Situacao
  arquivado: boolean
  /** cidade humana, já resolvida no servidor (cai para o rótulo do fuso) */
  cidade: string
  /** hora local do aluno, JÁ FORMATADA no servidor (Lei 1) */
  horaLocal: string
  ianaTz: string
  mentoria: boolean
  particulares: VinculoParticular[]
  /** saldo somado dos contratos particulares; `null` quando não há nenhum */
  creditos: number | null
  acesso: Acesso
  emailDevolvido: boolean
}

/* ========================================================================== */
/* 3. Eixos                                                                    */
/* ========================================================================== */

export const EIXOS = ['professora', 'produto', 'nivel', 'todos'] as const
export type Eixo = (typeof EIXOS)[number]

/** Só os eixos que geram PÁGINA DE GRUPO (o "todos" é a tabela do hub). */
export const EIXOS_DE_GRUPO = ['professora', 'produto', 'nivel'] as const
export type EixoDeGrupo = (typeof EIXOS_DE_GRUPO)[number]

export function ehEixo(v: string | undefined): v is Eixo {
  return !!v && (EIXOS as readonly string[]).includes(v)
}

export function ehEixoDeGrupo(v: string | undefined): v is EixoDeGrupo {
  return !!v && (EIXOS_DE_GRUPO as readonly string[]).includes(v)
}

export const EIXO_ROTULO: Record<Eixo, string> = {
  professora: 'Professora',
  produto: 'Produto',
  nivel: 'Nível',
  todos: 'Todos',
}

/** Balde de quem não tem professora / produto / nível — nunca some da conta. */
export const SEM_PROFESSORA = 'sem-professora'
export const SEM_CONTRATO = 'sem-contrato'
export const SEM_NIVEL = 'sem-nivel'

/**
 * Ordem dos níveis Flexge. ESPELHO do `students_level_check` (migration
 * 20260720000300) e de `FLEXGE_LEVELS`; a paridade é conferida por teste.
 * Fica copiada aqui, e não importada de `lib/slides/lesson-schema`, para o
 * matcher da busca poder viajar para o cliente sem arrastar junto o schema de
 * conteúdo das aulas.
 */
export const NIVEIS = [
  'Pre A1',
  'A1',
  'A1+',
  'A2',
  'A2+',
  'B1',
  'B1+',
  'B2',
  'B2+',
  'C1',
  'C2',
] as const

/**
 * O nível é aceito? É a ÚNICA porta do vocabulário (M3-3 · anexo A1).
 *
 * As actions de cadastro (`createStudentAction`, `updateStudentAction`,
 * `wizardStudentAction`) tinham cada uma o seu `new Set([...seis níveis])`
 * copiado à mão, enquanto o banco (`students_level_check`) aceita os ONZE da
 * trilha Flexge e a lista/os grupos desenham os onze. O efeito era perda de
 * dado EM SILÊNCIO: gravar "A1+" pela porta da action virava `null`. Agora há
 * uma lista só, e é esta função que os três lados consultam.
 */
export function nivelValido(v: string | null | undefined): boolean {
  return !!v && (NIVEIS as readonly string[]).includes(v)
}

/** Slug de URL do nível: `A1+` viraria `A1%2B` no endereço; vira `a1-mais`. */
export function nivelParaSlug(nivel: string | null): string {
  if (!nivel) return SEM_NIVEL
  return nivel.toLowerCase().replace(/\+/g, '-mais').replace(/\s+/g, '-')
}

export function slugParaNivel(slug: string): string | null {
  return NIVEIS.find((n) => nivelParaSlug(n) === slug) ?? null
}

export const PRODUTO_ROTULO: Record<string, string> = {
  particular: 'Aulas particulares',
  travel: 'Personal Travel',
  [SEM_CONTRATO]: 'Sem contrato ativo',
}

/* ========================================================================== */
/* 4. Montagem da linha                                                        */
/* ========================================================================== */

/**
 * Traduz uma linha crua do diretório na linha da tabela.
 *
 * `cidade` e `horaLocal` chegam PRONTAS de fora: as duas dependem de fuso e de
 * relógio, e Lei 1 diz que isso se resolve no servidor, uma vez, com Luxon.
 */
export function montarAluno(
  bruto: AlunoDoDiretorio,
  pronto: {
    cidade: string
    horaLocal: string
    idxDaProfessora: (id: string | null) => number
    /** data do convite já formatada — só a aba Convites usa, por isso opcional */
    convidadoEm?: string | null
  },
): AlunoDaLista {
  const acesso: Acesso = !bruto.profile_id ? 'sem_convite' : bruto.email_confirmed ? 'ativo' : 'pendente'
  // O diretório já devolve só contratos não-encerrados; a checagem fica como
  // cinto: se a RPC mudar, um contrato morto não pode ressuscitar na tela.
  const vivos = bruto.contracts.filter((c) => c.status !== 'ended')
  const particulares = vivos.filter((c) => c.contract_type === 'private_1on1')

  return {
    id: bruto.id,
    nome: bruto.display_name,
    nivel: bruto.level,
    email: bruto.email,
    convidadoEm: pronto.convidadoEm ?? null,
    // A situação é DERIVADA aqui, uma vez, do mesmo payload que já veio: nem a
    // tabela nem a ficha refazem a conta (e nenhuma delas lê `status` cru).
    situacao: situacaoDoAluno({ status: bruto.status, contratos: bruto.contracts }),
    arquivado: bruto.status === 'archived',
    cidade: pronto.cidade,
    horaLocal: pronto.horaLocal,
    ianaTz: bruto.iana_tz,
    mentoria: vivos.some((c) => c.contract_type === 'mentorship'),
    particulares: particulares.map((c) => ({
      contratoId: c.contract_id,
      professoraId: c.teacher_id,
      professora: c.teacher_name,
      professoraIdx: pronto.idxDaProfessora(c.teacher_id),
      turma: c.group_label,
    })),
    creditos: particulares.length > 0 ? particulares.reduce((s, c) => s + (c.balance ?? 0), 0) : null,
    acesso,
    emailDevolvido: Boolean(bruto.email_bounced_at),
  }
}

/* ========================================================================== */
/* 5. Grupos                                                                   */
/* ========================================================================== */

export interface GrupoDeAlunos {
  eixo: EixoDeGrupo
  /** o que vai na URL (`/admin/alunos/grupo/[eixo]/[valor]`) */
  valor: string
  rotulo: string
  total: number
  /** pendência do grupo: quantos ainda não têm acesso ao portal */
  semAcesso: number
  /** identidade visual do eixo `professora` */
  professoraIdx?: number
  /** identidade visual do eixo `nivel` */
  nivel?: string | null
  /** identidade visual do eixo `produto` */
  produto?: string
}

/** Em que grupos deste eixo o aluno entra (pode ser mais de um no produto). */
function chavesDoAluno(aluno: AlunoDaLista, eixo: EixoDeGrupo): { valor: string; rotulo: string }[] {
  if (eixo === 'professora') {
    const comProfessora = aluno.particulares.filter((p) => p.professoraId)
    if (comProfessora.length === 0) return [{ valor: SEM_PROFESSORA, rotulo: 'Sem professora' }]
    // `Map` mata a duplicata de quem tem dois contratos com a mesma professora.
    return [
      ...new Map(
        comProfessora.map((p) => [p.professoraId!, { valor: p.professoraId!, rotulo: p.professora ?? '—' }]),
      ).values(),
    ]
  }
  if (eixo === 'produto') {
    const chaves: { valor: string; rotulo: string }[] = []
    if (aluno.particulares.length > 0)
      chaves.push({ valor: 'particular', rotulo: PRODUTO_ROTULO.particular })
    if (aluno.mentoria) chaves.push({ valor: 'travel', rotulo: PRODUTO_ROTULO.travel })
    // Aluno cadastrado e ainda sem contrato existe (acabou de entrar, ou
    // encerrou tudo): sem este balde ele sumia da soma dos grupos.
    if (chaves.length === 0) chaves.push({ valor: SEM_CONTRATO, rotulo: PRODUTO_ROTULO[SEM_CONTRATO] })
    return chaves
  }
  return [{ valor: nivelParaSlug(aluno.nivel), rotulo: aluno.nivel ?? 'Sem nível' }]
}

function ordemDoGrupo(eixo: EixoDeGrupo, g: GrupoDeAlunos): number {
  if (eixo === 'professora') return g.valor === SEM_PROFESSORA ? 999 : (g.professoraIdx ?? 998)
  if (eixo === 'produto')
    return g.valor === 'particular' ? 0 : g.valor === 'travel' ? 1 : 2
  const i = NIVEIS.indexOf((g.nivel ?? '') as (typeof NIVEIS)[number])
  return i === -1 ? 999 : i
}

/**
 * Agrupa a lista de trabalho por um eixo. Grupo vazio não existe — cartão com
 * "0 alunos" é ruído, e a página do grupo já tem estado vazio para o caso de a
 * lista esvaziar entre um clique e outro.
 *
 * ⚠️ Um aluno pode entrar em DOIS grupos do eixo produto (particular + Travel):
 * a soma dos cartões é maior que o total de alunos, de propósito. É o mesmo que
 * a lista velha fazia com os chips, e é a verdade do negócio.
 */
export function agrupar(alunos: AlunoDaLista[], eixo: EixoDeGrupo): GrupoDeAlunos[] {
  const por = new Map<string, GrupoDeAlunos>()
  for (const aluno of alunos) {
    for (const { valor, rotulo } of chavesDoAluno(aluno, eixo)) {
      const atual =
        por.get(valor) ??
        ({
          eixo,
          valor,
          rotulo,
          total: 0,
          semAcesso: 0,
          professoraIdx:
            eixo === 'professora'
              ? aluno.particulares.find((p) => p.professoraId === valor)?.professoraIdx
              : undefined,
          nivel: eixo === 'nivel' ? aluno.nivel : undefined,
          produto: eixo === 'produto' ? valor : undefined,
        } satisfies GrupoDeAlunos)
      atual.total += 1
      if (aluno.acesso !== 'ativo') atual.semAcesso += 1
      por.set(valor, atual)
    }
  }
  return [...por.values()].sort((a, b) => ordemDoGrupo(eixo, a) - ordemDoGrupo(eixo, b) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

/** Os alunos de UM grupo (a página N2). */
export function alunosDoGrupo(alunos: AlunoDaLista[], eixo: EixoDeGrupo, valor: string): AlunoDaLista[] {
  return alunos.filter((a) => chavesDoAluno(a, eixo).some((c) => c.valor === valor))
}

/**
 * Rótulo humano do grupo. Devolve `null` quando o par eixo/valor não existe no
 * vocabulário — é o que faz a página do grupo dar 404 honesto em vez de
 * desenhar "Grupo undefined (0)".
 */
export function rotuloDoGrupo(
  eixo: EixoDeGrupo,
  valor: string,
  alunos: AlunoDaLista[],
  /** nome da professora pelo id — o cadastro sabe mais que a lista (professora
   *  sem aluno nenhum continua sendo um grupo legítimo, só vazio) */
  nomeDaProfessora?: (id: string) => string | null,
): string | null {
  if (eixo === 'nivel') {
    if (valor === SEM_NIVEL) return 'Sem nível'
    const n = slugParaNivel(valor)
    return n && `Nível ${n}`
  }
  if (eixo === 'produto') {
    if (valor === SEM_CONTRATO) return PRODUTO_ROTULO[SEM_CONTRATO]
    return PRODUTO_ROTULO[valor] ?? null
  }
  if (valor === SEM_PROFESSORA) return 'Sem professora'
  // Id de professora não é vocabulário fechado: quem sabe se ele existe é o
  // cadastro. Sem o resolvedor, cai para "alguém estuda com ela" — o id
  // inventado na URL não vira página.
  const doCadastro = nomeDaProfessora?.(valor)
  if (doCadastro) return doCadastro
  const nome = alunos
    .flatMap((a) => a.particulares)
    .find((p) => p.professoraId === valor)?.professora
  return nome ?? null
}

/* ========================================================================== */
/* 6. Busca                                                                    */
/* ========================================================================== */

/** Sem acento e em minúscula — "lucia" acha "Lúcia". */
export function normalizarTermo(termo: string): string {
  return termo
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * A busca do hub casa por NOME e por CIDADE — as duas coisas que a dona
 * lembra de um aluno. Não busca e-mail nem telefone: dado de contato não é
 * chave de navegação, e varrer contato numa lista aberta é convite a
 * vazamento de tela.
 */
export function casaComBusca(aluno: AlunoDaLista, termo: string): boolean {
  const t = normalizarTermo(termo)
  if (!t) return true
  return normalizarTermo(aluno.nome).includes(t) || normalizarTermo(aluno.cidade).includes(t)
}
