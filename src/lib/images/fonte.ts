// IM-2/M1 — a implementação concreta da FonteDeImagem que o resolvedor pede.
//
// O resolve.ts define o CONTRATO (aprovada + baixar) e dá precedência ao disco.
// Aqui está o outro lado: para o endereço que NÃO está no disco, procurar a
// imagem aprovada na biblioteca (`slide_images`) e trazer os bytes do Drive.
//
// Sem esta peça o M1 é código morto: o resolvedor sabe perguntar "existe uma
// aprovada para m9/mercado?", mas ninguém sabia responder.
import type { SupabaseClient } from '@supabase/supabase-js'
import { downloadDriveFile, type GoogleClients } from '../google/slides.ts'
import type { FonteDeImagem } from './resolve.ts'

/**
 * Fonte ligada ao banco + Drive. Só a imagem `aprovada` conta — rascunho,
 * reprovada e falhou não entram no deck (é o portão do IM-1 refletido na leitura).
 */
export function fonteDeImagens(opts: {
  supabase: SupabaseClient
  clients: GoogleClients
  course?: string
}): FonteDeImagem {
  const course = opts.course ?? 'personal-travel'
  return {
    async aprovada(folder, name) {
      // M-H2: um endereço pode ter VÁRIAS aprovadas (histórico de supersede). A
      // que vale é a CABEÇA — a de maior version (derivada, nunca materializada).
      // Para os endereços de versão única (cena/legado) isto devolve a mesma
      // linha de sempre.
      const { data } = await opts.supabase
        .from('slide_images')
        .select('drive_file_id')
        .eq('course', course)
        .eq('folder', folder)
        .eq('name', name)
        .eq('status', 'aprovada')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data?.drive_file_id ? { driveFileId: data.drive_file_id } : null
    },
    baixar(driveFileId) {
      return downloadDriveFile(opts.clients, driveFileId)
    },
  }
}
