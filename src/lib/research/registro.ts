// PESQUISA DE PAUTA — a porta do banco (M5).
//
// Duas funções e nada mais: LER os runs ativos (a pré-checagem, que é o que faz
// re-corrida custar ~zero) e GRAVAR pela RPC `record_content_research` — o único
// caminho de escrita que existe, porque nenhum role tem DML direto na tabela
// (nem `service_role`; ver a migration 20260801000200).

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import type { Rede } from './config.ts'

export type TipoDaPesquisa = 'analise_reel' | 'trends'

export interface AtivoDaFonte {
  id: string
  run: number
  payload: Record<string, unknown>
}

const AtivoSchema = z.object({
  id: z.string(),
  run: z.number(),
  source_key: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable(),
})

/**
 * O run ATIVO de cada endereço pedido.
 *
 * É a peça que evita pagar Gemini + Claude de novo numa re-corrida: sem ela, o
 * worker transcreveria e analisaria tudo para só então ouvir do banco
 * "`foi_criado=false`, já tinha". Também é daqui que sai a transcrição
 * reaproveitada quando a corrida é `--force`.
 */
export async function ativosPorFonte(
  admin: SupabaseClient,
  chaves: readonly string[],
): Promise<Map<string, AtivoDaFonte>> {
  const mapa = new Map<string, AtivoDaFonte>()
  if (!chaves.length) return mapa

  // Lotes de 100: `in()` vira query string na PostgREST e URL tem teto.
  for (let i = 0; i < chaves.length; i += 100) {
    const { data, error } = await admin
      .from('content_research')
      .select('id, run, source_key, payload')
      .in('source_key', chaves.slice(i, i + 100))
      .is('superseded_by', null)
    if (error) throw new Error(`pesquisa: falha ao ler os runs ativos: ${error.message}`)
    for (const linha of z.array(AtivoSchema).parse(data ?? [])) {
      mapa.set(linha.source_key, {
        id: linha.id,
        run: linha.run,
        payload: linha.payload ?? {},
      })
    }
  }
  return mapa
}

export interface PedidoDeRegistro {
  tipo: TipoDaPesquisa
  plataforma: Rede
  sourceKey: string
  payload: Record<string, unknown>
  metricas?: Record<string, number>
  creatorId?: string | null
  titulo?: string | null
  url?: string | null
  publicadoEm?: string | null
  force?: boolean
}

export interface RespostaDoRegistro {
  id: string
  run: number
  foiCriado: boolean
}

export async function registrar(
  admin: SupabaseClient,
  p: PedidoDeRegistro,
): Promise<RespostaDoRegistro> {
  const { data, error } = await admin.rpc('record_content_research', {
    p_tipo: p.tipo,
    p_plataforma: p.plataforma,
    p_source_key: p.sourceKey,
    p_payload: p.payload,
    p_metricas: p.metricas ?? {},
    p_creator_id: p.creatorId ?? null,
    p_titulo: p.titulo ?? null,
    p_url: p.url ?? null,
    p_publicado_em: p.publicadoEm ?? null,
    p_force: p.force ?? false,
  })
  if (error) throw new Error(`pesquisa: RPC recusou ${p.sourceKey}: ${error.message}`)

  const linha = (data as Array<{ id: string; run: number; foi_criado: boolean }> | null)?.[0]
  if (!linha) throw new Error(`pesquisa: RPC não devolveu linha para ${p.sourceKey}`)
  return { id: linha.id, run: linha.run, foiCriado: linha.foi_criado }
}

/**
 * O snapshot de métricas do criador — a ÚNICA escrita direta do robô no banco,
 * e ela é em `content_creators`, não aqui: o grant por coluna do M4 dá ao
 * `service_role` exatamente `metricas` e `medido_em`, e mais nada.
 */
export async function carimbarMedicao(
  admin: SupabaseClient,
  creatorId: string,
  metricas: Record<string, number>,
): Promise<void> {
  const { error } = await admin
    .from('content_creators')
    .update({ metricas, medido_em: new Date().toISOString() })
    .eq('id', creatorId)
  if (error) throw new Error(`pesquisa: falha ao carimbar medição: ${error.message}`)
}
