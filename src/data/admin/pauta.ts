import 'server-only'

// CAMADA DE DADOS DA PAUTA (frente de conteúdo · M4) — as duas leituras da tela
// `/admin/conteudo/pauta`: a lista de criadores e a ficha de um deles.
//
// Mesma convenção de `alunos.ts`/`ajustes.ts`:
// · UMA função por leitura de tela; a página não faz query inline;
// · o que vem do banco passa por Zod — linha com forma inesperada estoura AQUI,
//   não pinta `undefined` na tela da dona;
// · FALHA NUNCA VIRA LISTA VAZIA (`exigir`): senão a tela afirmaria "nenhum
//   criador cadastrado" quando o que houve foi o banco recusar a leitura;
// · `server-only` — a chave e a query não viajam para o navegador;
// · data formatada AQUI, no servidor, com Luxon (nenhum componente cliente
//   formata data nesta casa).
//
// ── O RESUMO DA MEDIÇÃO É DEFENSIVO, DE PROPÓSITO ───────────────────────────
// O shape de `metricas` é contrato do M5 (o worker que ainda não existe): esta
// camada não finge conhecê-lo. Ela mostra os números que vierem, quaisquer que
// sejam as chaves, e cai numa frase honesta quando o payload não tem número
// legível. Inventar aqui um formato que o worker não vai respeitar seria criar
// a segunda fonte de verdade antes mesmo da primeira nascer.

import { DateTime } from 'luxon'
import { z } from 'zod'

import { BUSINESS_TZ } from '@/lib/brand/constants'
import { createClient } from '@/lib/supabase/server'
import {
  PAISES,
  PLATAFORMAS,
  TIERS,
  TIPOS,
  type PaisDaPauta,
  type PlataformaDaPauta,
  type TierDaPauta,
  type TipoDaPauta,
} from './pauta-gramatica'

function exigir<T>(leitura: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Pauta: falha ao ler ${leitura}: ${r.error.message}`)
  return r.data
}

const CriadorSchema = z.object({
  id: z.string(),
  plataforma: z.enum(PLATAFORMAS),
  handle: z.string(),
  nome: z.string(),
  pais: z.enum(PAISES),
  notas: z.string().nullable(),
  ativo: z.boolean(),
  tipo: z.enum(TIPOS),
  tier: z.enum(TIERS).nullable(),
  metricas: z.record(z.string(), z.unknown()),
  medido_em: z.string().nullable(),
})

export interface CriadorDaPauta {
  id: string
  plataforma: PlataformaDaPauta
  handle: string
  nome: string
  pais: PaisDaPauta
  notas: string | null
  ativo: boolean
  tipo: TipoDaPauta
  /** faixa de alcance — `null` = sem classificação (estado legítimo) */
  tier: TierDaPauta | null
  /** os números da última corrida, já em texto — `null` = nunca medido */
  resumoDaMedicao: string | null
  /** "28/07/2026" da última corrida — `null` = nunca medido */
  medidoEmFrase: string | null
}

export interface GrupoDaPauta {
  pais: PaisDaPauta
  criadores: CriadorDaPauta[]
}

export interface PautaDeCriadores {
  grupos: GrupoDaPauta[]
  total: number
  ativos: number
}

const CAMPOS = 'id, plataforma, handle, nome, pais, notas, ativo, tipo, tier, metricas, medido_em'

/**
 * O resumo dos números medidos. Aceita qualquer shape: pega os pares de valor
 * numérico (até três), formata em pt-BR e ignora o resto. Payload sem número
 * nenhum — inclusive o `{}` legítimo de "mediu e não achou nada" — vira uma
 * frase, não um objeto cru na tela.
 */
function resumirMedicao(metricas: Record<string, unknown>, medidoEm: string | null): string | null {
  if (!medidoEm) return null
  const numeros = Object.entries(metricas)
    .filter((par): par is [string, number] => typeof par[1] === 'number' && Number.isFinite(par[1]))
    .slice(0, 3)
  if (numeros.length === 0) return 'nada encontrado'
  // A chave sai COMO ELA É, sem trocar `_` por espaço: aquela "humanização"
  // transformava `views_medias` em "views medias" — português errado fabricado
  // pela tela, que ninguém escreveu e ninguém revisou. Quem escolhe palavra
  // legível é quem nomeia a métrica no worker (M5); a tela não inventa idioma.
  return numeros
    .map(([chave, valor]) => `${chave} ${valor.toLocaleString('pt-BR')}`)
    .join(' · ')
}

function montar(linha: z.infer<typeof CriadorSchema>): CriadorDaPauta {
  return {
    id: linha.id,
    plataforma: linha.plataforma,
    handle: linha.handle,
    nome: linha.nome,
    pais: linha.pais,
    notas: linha.notas,
    ativo: linha.ativo,
    tipo: linha.tipo,
    tier: linha.tier,
    resumoDaMedicao: resumirMedicao(linha.metricas, linha.medido_em),
    medidoEmFrase: linha.medido_em
      ? DateTime.fromISO(linha.medido_em).setZone(BUSINESS_TZ).setLocale('pt-BR').toFormat('dd/LL/yyyy')
      : null,
  }
}

/**
 * A lista, agrupada por MERCADO — o eixo dominante da tela (Design.md §blocos):
 * o que a curadoria persegue é o equilíbrio entre a referência brasileira e a de
 * fora, então é por ele que a lista se parte. Dentro do grupo, os ativos vêm
 * primeiro e o desempate é alfabético pelo nome.
 */
export async function getPautaDeCriadores(): Promise<PautaDeCriadores> {
  const supabase = await createClient()
  const linhas = exigir(
    'criadores da pauta',
    await supabase
      .from('content_creators')
      .select(CAMPOS)
      .order('ativo', { ascending: false })
      .order('nome', { ascending: true }),
  )

  const criadores = z.array(CriadorSchema).parse(linhas ?? []).map(montar)

  return {
    grupos: PAISES.map((pais) => ({
      pais,
      criadores: criadores.filter((c) => c.pais === pais),
    })),
    total: criadores.length,
    ativos: criadores.filter((c) => c.ativo).length,
  }
}

/** A ficha de um criador (o painel `?painel=editar`). Inexistente = `null`. */
export async function getCriadorDaPauta(id: string): Promise<CriadorDaPauta | null> {
  if (!id) return null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('content_creators')
    .select(CAMPOS)
    .eq('id', id)
    .maybeSingle()
  // Id inexistente NÃO é falha de leitura: o painel de um alvo que sumiu devolve
  // para a lista (é o que a página faz com o `null`). Falha de verdade estoura.
  if (error) throw new Error(`Pauta: falha ao ler criador: ${error.message}`)
  if (!data) return null
  return montar(CriadorSchema.parse(data))
}
