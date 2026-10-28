import 'server-only'

// CAMADA DE DADOS DO HUB DE ALUNOS (Onda 1 · M3) — as duas leituras das telas
// N1 (`/admin/alunos`) e N2 (`/admin/alunos/grupo/[eixo]/[valor]`).
//
// Mesma convenção de `home.ts`:
// · UMA função por leitura de tela; a página não faz query inline;
// · o que vem do banco passa por Zod (`DiretorioSchema`) — diretório que mudou
//   de forma estoura AQUI, não pinta `undefined` na tela da dona;
// · FALHA NUNCA VIRA LISTA VAZIA: `exigir` confere o `error` e estoura, para o
//   boundary de erro acender em vez de a tela afirmar "nenhum aluno";
// · `server-only` — a chave e a query não podem viajar para o navegador;
// · zero regra de negócio (Lei 3): saldo de crédito, contrato vivo e expiração
//   vêm calculados de `admin_student_directory()`.
//
// FUSO (Lei 1): a hora local de cada aluno é calculada AQUI, no servidor, com
// Luxon e a zona IANA dele — a tabela recebe a string pronta. Nenhum
// componente cliente formata data nesta onda.
//
// As duas leituras compartilham `lerDiretorio()` porque são a MESMA pergunta em
// recortes diferentes; o que não se compartilha é a promessa: cada página faz a
// sua chamada e o Next cacheia por request.

import { DateTime } from 'luxon'
import { z } from 'zod'

import type { JanelaOcupada } from '@/lib/agenda/ocupacao'
import { lerOcupacao } from './ocupacao-consulta'
import { planosDoSeletor } from './admissao'
import { fmtCivilDate, tzLabel } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import {
  DiretorioSchema,
  agrupar,
  alunosDoGrupo,
  contarSituacoes,
  montarAluno,
  noDiaADia,
  rotuloDoGrupo,
  type Acesso,
  type AlunoDaLista,
  type EixoDeGrupo,
  type GrupoDeAlunos,
  type Situacao,
} from './alunos-grupos'

function exigir<T>(leitura: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Alunos: falha ao ler ${leitura}: ${r.error.message}`)
  return r.data
}

export interface HubDeAlunos {
  /**
   * O que a tabela mostra: a lista de TRABALHO (sem leads e sem arquivados) ou,
   * quando há recorte de situação, só a situação pedida.
   */
  alunos: AlunoDaLista[]
  /**
   * Universo da BUSCA: TODO mundo — inclusive leads e arquivados (cada um com
   * a situação dele na pílula). A lista de trabalho não pode virar cemitério de
   * "Ex-aluno(a) …" nem caixa de prospecção, mas ninguém pode ficar
   * inalcançável: digitou o nome, aparece.
   */
  buscaveis: AlunoDaLista[]
  /** tamanho da lista de TRABALHO (não muda com o recorte) */
  total: number
  /** pendência global: quantos ainda não têm acesso ativo ao portal */
  semAcesso: number
  /**
   * CICLO DE VIDA — quantos em cada situação, SEMPRE do universo inteiro: é o
   * número de cada badge, e ele não pode mudar de valor quando o recorte muda
   * (mesma régua dos contadores da aba Convites).
   */
  contagens: Record<Situacao, number>
  /** o recorte em vigor (`?situacao=`), ou `null` na visão de trabalho */
  recorte: Situacao | null
  grupos: Record<EixoDeGrupo, GrupoDeAlunos[]>
}

export interface GrupoAberto {
  eixo: EixoDeGrupo
  valor: string
  rotulo: string
  alunos: AlunoDaLista[]
}

/**
 * O diretório inteiro, já traduzido em linhas de tabela (com hora local e cor
 * de professora resolvidas).
 */
async function lerDiretorio(): Promise<{
  alunos: AlunoDaLista[]
  nomeDaProfessora: (id: string) => string | null
}> {
  const supabase = await createClient()

  const [dirRes, teachersRes] = await Promise.all([
    supabase.rpc('admin_student_directory'),
    // A ORDEM define a cor da bolinha (dona primeiro, depois alfabética) — é a
    // mesma da agenda e do Início; trocar aqui repintaria a escola inteira.
    supabase
      .from('teachers')
      .select('id, display_name, is_owner')
      .is('archived_at', null)
      .order('is_owner', { ascending: false })
      .order('display_name'),
  ])

  const bruto = DiretorioSchema.parse(exigir('o diretório de alunos', dirRes) ?? [])
  const professoras = exigir('as professoras', teachersRes) ?? []

  const idx = new Map(professoras.map((t, i) => [t.id, i]))
  const nomes = new Map(professoras.map((t) => [t.id, t.display_name as string | null]))

  // Relógio por request é intencional (Server Component).
  const agora = DateTime.now()

  const alunos = bruto.map((linha) => {
    const local = agora.setZone(linha.iana_tz)
    return montarAluno(linha, {
      cidade: linha.city || tzLabel(linha.iana_tz),
      horaLocal: local.isValid ? local.toFormat('HH:mm') : '—',
      idxDaProfessora: (id) => (id ? (idx.get(id) ?? 0) : 0),
      // Lei 1: a data do convite também sai formatada daqui (a aba Convites é
      // componente cliente e não formata data nenhuma).
      convidadoEm: linha.invited_at ? fmtCivilDate(String(linha.invited_at).slice(0, 10)) : null,
    })
  })

  return { alunos, nomeDaProfessora: (id) => nomes.get(id) ?? null }
}

/**
 * N1 — o hub: a lista completa (para a visão "Todos" e para a busca) e os três
 * eixos de agrupamento já contados, com a pendência de cada grupo.
 */
/**
 * Tira o CONTATO da linha. A mesma `AlunoDaLista` serve o hub, a página de
 * grupo e a aba Convites, mas só a última desenha e-mail — e as três listas são
 * componentes CLIENTE, isto é, tudo que vai na linha viaja no HTML para o
 * navegador. Dado que a tela não mostra não tem por que viajar: é a mesma razão
 * pela qual a busca do hub casa por nome e cidade, e nunca por e-mail.
 */
function semContato(a: AlunoDaLista): AlunoDaLista {
  return { ...a, email: null, convidadoEm: null }
}

export async function getStudentsHub(recorte?: Situacao | null): Promise<HubDeAlunos> {
  const { alunos } = await lerDiretorio()
  // A lista de trabalho é o dia a dia: sem lead (ainda não é aluno) e sem
  // arquivado (já não é). Os dois têm badge própria para quem os quiser ver.
  const trabalho = alunos.filter(noDiaADia)

  return {
    alunos: (recorte ? alunos.filter((a) => a.situacao === recorte) : trabalho).map(semContato),
    buscaveis: alunos.map(semContato),
    total: trabalho.length,
    semAcesso: trabalho.filter((a) => a.acesso !== 'ativo').length,
    contagens: contarSituacoes(alunos),
    recorte: recorte ?? null,
    // Os cartões de agrupamento seguem falando da lista de TRABALHO: agrupar
    // lead por professora/produto/nível seria seis cartões de "sem…".
    grupos: {
      professora: agrupar(trabalho, 'professora'),
      produto: agrupar(trabalho, 'produto'),
      nivel: agrupar(trabalho, 'nivel'),
    },
  }
}

/**
 * N2 — um grupo. Devolve `null` quando o par eixo/valor não existe no
 * vocabulário (nível inventado, produto inventado, id que não é de professora
 * nenhuma): é o que faz a página dar 404 honesto em vez de desenhar um grupo
 * fantasma com zero aluno.
 *
 * Grupo VÁLIDO e vazio (nível sem ninguém, professora sem aluno) não é 404 — é
 * estado vazio, que é uma resposta diferente e verdadeira.
 */
export async function getStudentGroup(eixo: EixoDeGrupo, valor: string): Promise<GrupoAberto | null> {
  const { alunos, nomeDaProfessora } = await lerDiretorio()
  // Mesmo universo do hub (lead e arquivado fora): a página do grupo tem de
  // devolver exatamente o que o cartão prometeu.
  const trabalho = alunos.filter(noDiaADia)

  const rotulo = rotuloDoGrupo(eixo, valor, trabalho, nomeDaProfessora)
  if (!rotulo) return null

  return {
    eixo,
    valor,
    rotulo,
    alunos: alunosDoGrupo(trabalho, eixo, valor).map(semContato),
  }
}

/* ========================================================================== */
/* N4 — a visão de ACESSO (aba Convites)                                       */
/* ========================================================================== */

export interface VisaoDeConvites {
  /** os alunos não-arquivados, já no recorte pedido */
  alunos: AlunoDaLista[]
  /** quantos existem em cada situação de acesso — SEMPRE do universo inteiro,
   *  para os contadores não mudarem de valor quando o recorte muda */
  contagens: Record<Acesso, number>
  /** o universo (não-arquivados), independente do recorte */
  total: number
}

/**
 * N4 — quem entra no portal, quem foi convidado e ainda não entrou, e quem
 * nunca recebeu convite. Mesma fonte do hub (`admin_student_directory`): a aba
 * Convites é um RECORTE da mesma verdade, não uma segunda contabilidade.
 *
 * Arquivado fica de fora: ex-aluno sem acesso não é pendência de convite, e a
 * lista viraria um cemitério com botão de "Convidar". LEAD também fica de fora,
 * pela mesma razão e mais uma: na fase 1 do ciclo de vida lead NÃO tem portal —
 * contá-lo aqui acenderia uma pendência de convite que ninguém quer resolver
 * (a mesma exclusão que `admin_home_counts` faz no banco).
 */
export async function getInvitesOverview(recorte?: Acesso | null): Promise<VisaoDeConvites> {
  const { alunos } = await lerDiretorio()
  const trabalho = alunos.filter(noDiaADia)

  return {
    alunos: recorte ? trabalho.filter((a) => a.acesso === recorte) : trabalho,
    contagens: {
      ativo: trabalho.filter((a) => a.acesso === 'ativo').length,
      pendente: trabalho.filter((a) => a.acesso === 'pendente').length,
      sem_convite: trabalho.filter((a) => a.acesso === 'sem_convite').length,
    },
    total: trabalho.length,
  }
}

/* ========================================================================== */
/* O que o WIZARD de admissão precisa saber                                    */
/* ========================================================================== */

const ProfessoraDaAdmissaoSchema = z.object({
  id: z.string(),
  display_name: z.string(),
})

const AlunoEmAdmissaoSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  iana_tz: z.string(),
})

export interface ContextoDaAdmissao {
  /** o aluno já criado (etapas 2+); `null` na etapa 1 */
  aluno: z.infer<typeof AlunoEmAdmissaoSchema> | null
  /** as professoras ativas, na ordem da casa (dona primeiro) */
  professoras: z.infer<typeof ProfessoraDaAdmissaoSchema>[]
  /**
   * O que as professoras JÁ têm marcado, convertido para o relógio DO ALUNO
   * NOVO (Lei 1: a conversão é aqui, no servidor, com o offset do dia
   * específico — a tela só compara minutos dentro de um fuso só). Vazio na
   * etapa 1, quando ainda não existe aluno e portanto não existe fuso de
   * referência.
   */
  ocupacao: JanelaOcupada[]
  /**
   * M3-c5 · D2 — os nomes de plano que a escola JÁ usa, para o campo "Plano"
   * ser uma escolha em vez de um texto livre que a cada contrato inventa uma
   * grafia nova. Derivado de `contracts.plan_name` (não há entidade Produto no
   * banco; ela é onda futura — ver `planosDoSeletor`).
   */
  planos: string[]
}

/**
 * As duas leituras do wizard, que antes moravam DENTRO do componente (o
 * `AdmissionWizard` da Leva 7 abria um `createClient()` no meio do JSX). Zero
 * regra aqui: quem valida nome, fuso e nível são as actions e o banco.
 */
export async function getAdmissionContext(alunoId?: string | null): Promise<ContextoDaAdmissao> {
  const supabase = await createClient()
  const [alunoRes, professorasRes, planosRes] = await Promise.all([
    alunoId
      ? supabase.from('students').select('id, display_name, iana_tz').eq('id', alunoId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('teachers')
      .select('id, display_name')
      .is('archived_at', null)
      .order('is_owner', { ascending: false })
      .order('display_name'),
    // D2: os planos já usados. Leitura rasa de UMA coluna, de TODOS os
    // contratos (inclusive encerrados — o nome do plano continua sendo o
    // vocabulário da escola depois que o contrato acaba). Quem tira os
    // repetidos é `planosDoSeletor`, que é puro e testado sem banco: o
    // PostgREST não tem `distinct`, e fingir que tem com `group by` no cliente
    // seria a mesma varredura com mais cerimônia.
    supabase.from('contracts').select('plan_name'),
  ])

  // O aluno some da consulta quando o `?aluno=` da URL é inventado (ou quando o
  // cadastro foi apagado entre duas etapas): `null` faz o wizard voltar ao
  // passo 1, que é a resposta honesta. Erro de leitura, esse sim, estoura.
  const alunoBruto = exigir('o aluno em admissão', alunoRes)
  const aluno = alunoBruto ? AlunoEmAdmissaoSchema.parse(alunoBruto) : null

  return {
    aluno,
    professoras: z
      .array(ProfessoraDaAdmissaoSchema)
      .parse(exigir('as professoras', professorasRes) ?? []),
    ocupacao: aluno ? await lerOcupacao(supabase, aluno.iana_tz) : [],
    planos: planosDoSeletor(
      ((exigir('os planos já usados', planosRes) ?? []) as { plan_name: string | null }[]).map(
        (c) => c.plan_name,
      ),
    ),
  }
}
