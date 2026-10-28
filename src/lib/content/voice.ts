import type { SupabaseClient } from '@supabase/supabase-js'

// Leitura ÚNICA da voz da marca ativa (`brand_voice_docs`, ADR-021 §5).
// Antes do M2 esta query estava copiada em dois lugares (o núcleo das rotas
// /api/content/* e a página do Estúdio) e o gerador in-app seria o terceiro.
// A tabela é append-only com índice único parcial: no máximo UMA ativa.
//
// Contrato deliberado: `null` significa "não há voz publicada" (estado legítimo,
// e o gerador RECUSA gerar sem voz); erro de banco LANÇA, para não virar
// "gerou sem voz" silencioso — a distinção é o que o M2 precisa.

export interface BrandVoice {
  version: number
  content_md: string
  created_at: string
}

export async function getActiveBrandVoice(db: SupabaseClient): Promise<BrandVoice | null> {
  const { data, error } = await db
    .from('brand_voice_docs')
    .select('version, content_md, created_at')
    .eq('active', true)
    .maybeSingle()
  if (error) throw new Error(`falha ao ler a voz da marca: ${error.message}`)
  return (data as BrandVoice | null) ?? null
}
