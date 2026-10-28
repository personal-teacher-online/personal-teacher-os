import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fonteDeImagens } from '../src/lib/images/fonte.ts'
import type { GoogleClients } from '../src/lib/google/slides.ts'

/** monta um Supabase falso que devolve `data` no fim da cadeia
 *  .eq().eq()...order().limit().maybeSingle() (M-H2: cabeça por max version). */
function supabaseQueDevolve(data: { drive_file_id: string | null } | null): SupabaseClient {
  const maybeSingle = vi.fn().mockResolvedValue({ data })
  const chain: Record<string, unknown> = { maybeSingle }
  chain.eq = () => chain
  chain.order = () => chain
  chain.limit = () => chain
  const from = vi.fn().mockReturnValue({ select: () => chain })
  return { from } as unknown as SupabaseClient
}

// downloadDriveFile faz Buffer.from(res.data as ArrayBuffer); o ArrayBuffer tem
// de ter o tamanho EXATO dos bytes (buf.buffer traz a folga do pool do Node).
const driveComBytes = (texto: string): GoogleClients => {
  const bytes = new TextEncoder().encode(texto)
  return {
    drive: { files: { get: vi.fn().mockResolvedValue({ data: bytes.buffer }) } },
  } as unknown as GoogleClients
}

describe('fonte de imagens (banco + Drive)', () => {
  it('devolve o driveFileId de uma imagem APROVADA', async () => {
    const supabase = supabaseQueDevolve({ drive_file_id: 'drive-xyz' })
    const fonte = fonteDeImagens({ supabase, clients: driveComBytes(""), })
    expect(await fonte.aprovada('m9', 'mercado')).toEqual({ driveFileId: 'drive-xyz' })
  })

  it('consulta pelo endereço exato, SÓ aprovada, e escolhe a CABEÇA (max version)', async () => {
    const eqSpy = vi.fn()
    const orderSpy = vi.fn()
    const limitSpy = vi.fn()
    // cadeia que observa .eq/.order/.limit antes de resolver
    const chain: Record<string, unknown> = {
      maybeSingle: async () => ({ data: { drive_file_id: 'd' } }),
    }
    chain.eq = (col: string, val: string) => {
      eqSpy(col, val)
      return chain
    }
    chain.order = (col: string, opts: unknown) => {
      orderSpy(col, opts)
      return chain
    }
    chain.limit = (n: number) => {
      limitSpy(n)
      return chain
    }
    const supabase = { from: () => ({ select: () => chain }) } as unknown as SupabaseClient
    const fonte = fonteDeImagens({ supabase, clients: driveComBytes(''), course: 'personal-travel' })
    await fonte.aprovada('m9', 'mercado')
    expect(eqSpy).toHaveBeenCalledWith('course', 'personal-travel')
    expect(eqSpy).toHaveBeenCalledWith('folder', 'm9')
    expect(eqSpy).toHaveBeenCalledWith('name', 'mercado')
    expect(eqSpy).toHaveBeenCalledWith('status', 'aprovada')
    // M-H2: a cabeça é a aprovada de MAIOR version (endereços de versão única
    // devolvem a mesma linha de sempre)
    expect(orderSpy).toHaveBeenCalledWith('version', { ascending: false })
    expect(limitSpy).toHaveBeenCalledWith(1)
  })

  it('sem imagem aprovada devolve null (não quebra o resolvedor)', async () => {
    const supabase = supabaseQueDevolve(null)
    const fonte = fonteDeImagens({ supabase, clients: driveComBytes("") })
    expect(await fonte.aprovada('m9', 'inexistente')).toBeNull()
  })

  it('linha existe mas sem drive_file_id ainda é null — nada para baixar', async () => {
    const supabase = supabaseQueDevolve({ drive_file_id: null })
    const fonte = fonteDeImagens({ supabase, clients: driveComBytes("") })
    expect(await fonte.aprovada('m9', 'mercado')).toBeNull()
  })

  it('baixar traz os bytes do Drive pelo helper compartilhado', async () => {
    const clients = driveComBytes('conteudo-da-foto')
    const fonte = fonteDeImagens({ supabase: supabaseQueDevolve(null), clients })
    const buf = await fonte.baixar('drive-xyz')
    expect(buf.toString()).toBe('conteudo-da-foto')
    expect(clients.drive.files.get).toHaveBeenCalledWith(
      { fileId: 'drive-xyz', alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    )
  })
})
