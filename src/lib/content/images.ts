import { Readable } from 'node:stream'
import type { drive_v3 } from 'googleapis'
import type { ImageSink, RefSource } from './handle'

// Persistência de imagens da fábrica de conteúdo no Google Drive (Lei 10 —
// arquivos vivem no Drive; nada de Supabase Storage). Mesmo alicerce do módulo
// de Slides (src/lib/google/slides.ts): service account via
// GOOGLE_SERVICE_ACCOUNT_JSON, pastas em Drive compartilhado (a SA não tem
// storage próprio — supportsAllDrives SEMPRE true).
//
// Duas pastas, duas envs (criadas pelo dono e compartilhadas com a SA):
//   CONTENT_DRIVE_FOLDER_ID      — imagens geradas dos posts
//   CONTENT_DRIVE_REFS_FOLDER_ID — fotos de referência da Teacher Vicky (privadas)

export function contentFolderFromEnv(): string | null {
  return process.env.CONTENT_DRIVE_FOLDER_ID ?? null
}

export function refsFolderFromEnv(): string | null {
  return process.env.CONTENT_DRIVE_REFS_FOLDER_ID ?? null
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/** Sink real (rota /entrega): grava a imagem na pasta de posts do Drive. */
export function driveImageSink(drive: drive_v3.Drive, folderId: string): ImageSink {
  return {
    async persist({ postId, slide, mime, data }) {
      const ext = EXT_BY_MIME[mime] ?? 'png'
      const name = `post-${postId}-${slide === null ? 'capa' : `slide-${slide}`}.${ext}`
      const res = await drive.files.create({
        requestBody: { name, parents: [folderId] },
        media: { mimeType: mime, body: Readable.from(Buffer.from(data)) },
        fields: 'id',
        supportsAllDrives: true,
      })
      const id = res.data.id
      if (!id) throw new Error('Drive não devolveu id do arquivo')
      return { drive_file_id: id }
    },
    async fetchUrl(url) {
      // Só provedores conhecidos entregam URL (fal.media etc.) — mesmo assim o
      // teto de tamanho é re-checado no handler. Content-type precisa ser imagem.
      const res = await fetch(url)
      if (!res.ok) throw new Error(`download da imagem falhou: HTTP ${res.status}`)
      const mime = res.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
      if (!mime.startsWith('image/')) throw new Error(`content-type inesperado: ${mime || '(vazio)'}`)
      const buf = new Uint8Array(await res.arrayBuffer())
      return { mime, data: buf }
    },
  }
}

/** Fonte real das fotos de referência (rota /refs): até 5, em ordem de nome. */
export function driveRefSource(drive: drive_v3.Drive, refsFolderId: string): RefSource {
  return {
    async list() {
      const listed = await drive.files.list({
        q: `'${refsFolderId}' in parents and trashed = false and mimeType contains 'image/'`,
        orderBy: 'name',
        pageSize: 5,
        fields: 'files(id, mimeType)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: 'allDrives',
      })
      const files = listed.data.files ?? []
      const out: Array<{ mime: string; base64: string }> = []
      for (const f of files) {
        if (!f.id) continue
        const media = await drive.files.get(
          { fileId: f.id, alt: 'media', supportsAllDrives: true },
          { responseType: 'arraybuffer' },
        )
        out.push({
          mime: f.mimeType ?? 'image/jpeg',
          base64: Buffer.from(media.data as ArrayBuffer).toString('base64'),
        })
      }
      return out
    },
  }
}

/** Leitura de um arquivo do Drive para o proxy do painel (admin). */
export async function readDriveImage(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<{ mime: string; data: Buffer }> {
  const meta = await drive.files.get({
    fileId,
    fields: 'mimeType',
    supportsAllDrives: true,
  })
  const media = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  )
  return {
    mime: meta.data.mimeType ?? 'application/octet-stream',
    data: Buffer.from(media.data as ArrayBuffer),
  }
}
