// A LEITURA DO WIZARD DE CONTRATO (Onda 1 · M4-3) — tudo que a tela precisa
// para deixar alguém montar um contrato sem sair dela.
//
// Mora fora de `contratos.ts` pelo mesmo motivo de `contrato-detalhe.ts` e de
// `ocupacao-consulta.ts`: aquele arquivo é `server-only` e monta o cliente
// Supabase a partir dos cookies do request — não dá para chamá-lo no Vitest sem
// inventar harness. Aqui o cliente e o relógio entram por parâmetro, então o
// teste executa ESTA função contra o banco local e prova o resultado, em vez de
// provar por grep.
//
// Zero regra de negócio (Lei 3): a situação de cada aluno vem DERIVADA por
// `situacaoDoAluno` sobre o que `admin_student_directory()` já devolve (a mesma
// pílula do hub), e a agenda ocupada vem das instâncias materializadas pelo
// Postgres.
//
// FUSO (Lei 1): a ocupação é lida UMA VEZ POR ZONA DISTINTA dos alunos
// elegíveis, porque a comparação de conflito é em minutos DENTRO de um relógio
// só e o relógio só se sabe quando alguém escolhe o aluno — no cliente. Na
// escola real são dois ou três baldes (Cuiabá, Lisboa, Orlando); ler a agenda
// dessas zonas de uma vez é mais barato (e muito mais simples) do que uma ida ao
// servidor a cada troca de seleção.

import { DateTime } from 'luxon'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { JanelaOcupada } from '@/lib/agenda/ocupacao'
import { BUSINESS_TZ } from '@/lib/brand/constants'
import { tzLabel } from '@/lib/format'
import { planosDoSeletor } from './admissao'
import {
  DiretorioSchema,
  SITUACAO_ROTULO,
  situacaoDoAluno,
} from './alunos-grupos'
import type { AlunoDoSeletor, ContextoDoNovoContrato } from './contrato-novo'
import { lerOcupacao } from './ocupacao-consulta'

function exigir<T>(leitura: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Novo contrato: falha ao ler ${leitura}: ${r.error.message}`)
  return r.data
}

/** Linhas pedidas por ida ao banco: o teto `max_rows` do PostgREST (`config.toml`). */
export const LINHAS_POR_PAGINA = 1000

type RespostaDePagina = { data: unknown[] | null; error: { message: string } | null }

/**
 * Lê uma tabela ou RPC INTEIRA, página a página.
 *
 * O PostgREST corta qualquer resposta em `max_rows` sem avisar: com a escola
 * passando de mil fichas, quem ficava depois da milésima sumia do seletor (ou
 * aparecia como "fuso não confirmado") e o contrato não podia nascer para ele.
 * Uma ida a mais por página cheia, não uma por aluno. O ponto de partida da
 * próxima página é o que VOLTOU (não o que se pediu) e a leitura só termina numa
 * página vazia: se o servidor de produção tiver um teto menor que o pedido, a
 * lista não é truncada em silêncio.
 *
 * A consulta recebida PRECISA ter ordem total (desempate por `id`). Paginar por
 * posição numa tabela viva ainda tem uma folga: ficha inserida antes da posição
 * lida repete uma linha (quem chama tira os repetidos) e ficha apagada ou
 * renomeada para antes dela pode pular uma — raro, numa tela de uma só pessoa, e
 * a próxima abertura do wizard já lê certo.
 */
export async function lerTudoPaginado<T>(
  leitura: string,
  pagina: (de: number, ate: number) => PromiseLike<RespostaDePagina>,
): Promise<T[]> {
  const todas: T[] = []
  for (;;) {
    const de = todas.length
    const linhas = (exigir(leitura, await pagina(de, de + LINHAS_POR_PAGINA - 1)) ?? []) as T[]
    if (linhas.length === 0) return todas
    for (const l of linhas) todas.push(l)
  }
}

export async function lerContextoDoNovoContrato(
  supabase: SupabaseClient,
  agora: DateTime = DateTime.now(),
): Promise<ContextoDoNovoContrato> {
  const [dirBruto, confirmados, teachersRes, planosRes] = await Promise.all([
    // O diretório também é cortado em 1000 pelo PostgREST: a mesma ordem da RPC
    // (nome) com `id` de desempate, para a paginação não perder nem repetir ficha.
    lerTudoPaginado<unknown>('o diretório de alunos', (de, ate) =>
      supabase.rpc('admin_student_directory').order('display_name').order('id').range(de, ate),
    ),
    // `tz_confirmed` é a única coisa que o diretório não devolve, e é o que
    // decide se o contrato pode nascer (`_require_confirmed_tz`). Leitura rasa
    // de duas colunas, casada por id.
    lerTudoPaginado<{ id: string; tz_confirmed: boolean | null; anonymized_at: string | null }>(
      'a confirmação de fuso',
      (de, ate) =>
        supabase.from('students').select('id, tz_confirmed, anonymized_at').order('id').range(de, ate),
    ),
    // A ORDEM define a cor da bolinha (dona primeiro, depois alfabética) — é a
    // mesma da agenda, do Início e do hub; trocar aqui repintaria a escola.
    supabase
      .from('teachers')
      .select('id, display_name, is_owner')
      .is('archived_at', null)
      .order('is_owner', { ascending: false })
      .order('display_name'),
    // Plano fase 1: os nomes que a escola JÁ usa (inclusive de contrato
    // encerrado — o nome continua sendo o vocabulário da casa). Quem tira os
    // repetidos é `planosDoSeletor`, puro e testado sem banco.
    supabase.from('contracts').select('plan_name'),
  ])

  // Com a base mexendo entre uma página e outra (aluno novo entra antes da
  // posição lida), a mesma ficha pode vir duas vezes: fica a primeira.
  const diretorio = [...new Map(DiretorioSchema.parse(dirBruto).map((a) => [a.id, a])).values()]
  const professorasBrutas = (exigir('as professoras', teachersRes) ?? []) as {
    id: string
    display_name: string | null
  }[]

  const flag = new Map(confirmados.map((s) => [s.id, s]))

  const alunos: AlunoDoSeletor[] = diretorio
    // A ficha ANONIMIZADA é terminal (revisão nº 8 · P5): `_promote_lead`
    // recusa, e oferecê-la aqui seria oferecer um erro. Quem voltou de verdade
    // tem cadastro novo.
    .filter((a) => !flag.get(a.id)?.anonymized_at)
    .map((a) => {
      const situacao = situacaoDoAluno({ status: a.status, contratos: a.contracts })
      return {
        id: a.id,
        nome: a.display_name,
        situacao,
        situacaoRotulo: SITUACAO_ROTULO[situacao],
        iana: a.iana_tz,
        // Lei 1: o rótulo do fuso sai formatado do SERVIDOR
        fuso: tzLabel(a.iana_tz),
        cidade: a.city ?? '',
        pais: a.country ?? '',
        fusoConfirmado: flag.get(a.id)?.tz_confirmed === true,
        temAcesso: Boolean(a.profile_id),
      }
    })

  // Uma leitura de agenda por ZONA distinta (ver o cabeçalho).
  //
  // ESTA é a única leitura da tela que pode falhar sem derrubar a página, e a
  // razão é o que ela é: ANTECIPAÇÃO, não portão. Quem recusa horário
  // sobreposto é a exclusão GiST `class_instances_teacher_no_overlap_excl`
  // (Lei 3) — a agenda aqui existe para a pessoa VER o choque antes de tentar.
  // A leitura varre a agenda inteira da escola no horizonte (o wizard deixa
  // escolher qualquer professora), e `lerOcupacao` já documenta o teto: numa
  // base grande, a lista de ids da segunda consulta estoura o limite de tamanho
  // da URL do PostgREST. Aconteceu na bancada, com milhares de fixtures.
  //
  // Falhou: a zona fica SEM BALDE — que é diferente de balde VAZIO, e a tela
  // sabe a diferença ("ainda não li a agenda dela neste fuso" × "ela não tem
  // nada marcado neste dia"). O erro vai para o log do servidor, e o contrato
  // continua podendo nascer, porque quem decide isso é o banco.
  const zonas = [...new Set(alunos.map((a) => a.iana))]
  const baldes = await Promise.all(
    zonas.map(async (z) => {
      try {
        return await lerOcupacao(supabase, z, agora)
      } catch (err) {
        console.error('[novo contrato] a agenda no relógio de %s não pôde ser lida:', z, err)
        return null
      }
    }),
  )
  const ocupacaoPorFuso: Record<string, JanelaOcupada[]> = {}
  zonas.forEach((z, i) => {
    const balde = baldes[i]
    if (balde) ocupacaoPorFuso[z] = balde
  })

  return {
    alunos,
    professoras: professorasBrutas
      .filter((t) => t.display_name)
      .map((t) => ({ id: t.id, nome: t.display_name as string })),
    planos: planosDoSeletor(
      ((exigir('os planos já usados', planosRes) ?? []) as { plan_name: string | null }[]).map(
        (c) => c.plan_name,
      ),
    ),
    ocupacaoPorFuso,
    // A data civil do NEGÓCIO (Cuiabá), não a do servidor: é ela que o banco
    // chama de hoje (`business_today()`), e é dela que o início da vigência
    // parte.
    hojeIso: agora.setZone(BUSINESS_TZ).toFormat('yyyy-LL-dd'),
  }
}
