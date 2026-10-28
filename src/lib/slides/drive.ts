// FS-M2 — upload do deck para o Drive via service account (googleapis).
// Regra de link estável: regenerar ATUALIZA o mesmo arquivo (files.update com
// media nova) — o link que a Teacher Vicky guardou nunca muda. A pasta-alvo é a do
// curso (compartilhada com a SA); PT_SLIDES_FOLDER_ID cobre o caso de haver
// mais de uma pasta compartilhada no futuro.
import type { drive_v3 } from 'googleapis'
import { Readable } from 'node:stream'

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const GSLIDES_MIME = 'application/vnd.google-apps.presentation'

// ⚠️ Quota: service account NÃO pode ser dona de arquivos novos em "Meu
// Drive" (storageQuotaExceeded — visto no smoke de 21/07). Os decks vivem num
// DRIVE COMPARTILHADO do Workspace (arquivo pertence à organização); por isso
// todas as chamadas levam supportsAllDrives.
export async function resolveCourseFolder(drive: drive_v3.Drive): Promise<string> {
  const fixed = process.env.PT_SLIDES_FOLDER_ID
  if (fixed) return fixed
  // 1º: um Drive compartilhado do curso…
  const drives = await drive.drives.list({ pageSize: 10 })
  const shared = drives.data.drives?.find((d) => /personal travel|slides/i.test(d.name ?? ''))
  if (shared?.id) return shared.id
  // …senão, uma pasta com o nome do curso acessível à SA.
  const res = await drive.files.list({
    q: "mimeType = 'application/vnd.google-apps.folder' and name contains 'PERSONAL TRAVEL' and trashed = false",
    fields: 'files(id, name)',
    pageSize: 5,
    corpora: 'allDrives',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  })
  const folder = res.data.files?.[0]
  if (!folder?.id) {
    throw new Error(
      'Destino dos decks não encontrado — adicione a service account a um Drive compartilhado do curso ou defina PT_SLIDES_FOLDER_ID.',
    )
  }
  return folder.id
}

export async function uploadDeck(opts: {
  drive: drive_v3.Drive
  name: string
  data: Buffer
  existingFileId?: string | null
}): Promise<{ fileId: string; url: string }> {
  const { drive, name, data, existingFileId } = opts
  const media = { mimeType: PPTX_MIME, body: Readable.from(data) }

  if (existingFileId) {
    try {
      const updated = await drive.files.update({
        fileId: existingFileId,
        media,
        requestBody: { name },
        fields: 'id, webViewLink',
        supportsAllDrives: true,
      })
      if (updated.data.id) {
        return { fileId: updated.data.id, url: updated.data.webViewLink ?? deckUrl(updated.data.id) }
      }
    } catch {
      // Arquivo sumiu (lixeira/apagado): cai para criação de um novo.
    }
  }

  const folderId = await resolveCourseFolder(drive)
  const created = await drive.files.create({
    media,
    requestBody: { name, parents: [folderId], mimeType: GSLIDES_MIME },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  })
  if (!created.data.id) throw new Error('Drive não devolveu o id do deck.')
  return { fileId: created.data.id, url: created.data.webViewLink ?? deckUrl(created.data.id) }
}

function deckUrl(id: string): string {
  return `https://docs.google.com/presentation/d/${id}/edit`
}

// ---------------------------------------------------------------- imagens (IM-2)

/**
 * Sobe UMA imagem para o Drive compartilhado do curso e devolve o id + link.
 *
 * Diferença crucial para o uploadDeck: a imagem NÃO é convertida para formato
 * Google — o mimeType é preservado (`image/jpeg`…). O resolvedor de deck baixa
 * esse arquivo com `alt: media`, e um arquivo convertido viria como Google Doc,
 * não como bytes de imagem.
 */
export async function uploadImage(opts: {
  drive: drive_v3.Drive
  name: string
  data: Buffer
  mimeType: string
}): Promise<{ fileId: string; url: string }> {
  const { drive, name, data, mimeType } = opts
  const folderId = await resolveCourseFolder(drive)
  const created = await drive.files.create({
    media: { mimeType, body: Readable.from(data) },
    requestBody: { name, parents: [folderId], mimeType }, // sem conversão
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  })
  if (!created.data.id) throw new Error('Drive não devolveu o id da imagem.')
  return {
    fileId: created.data.id,
    url: created.data.webViewLink ?? `https://drive.google.com/file/d/${created.data.id}/view`,
  }
}

/**
 * Apaga um arquivo do Drive (limpeza de candidatas não escolhidas).
 *
 * Best-effort: uma candidata órfã no Drive é só clutter, não erro de negócio —
 * uma falha aqui NUNCA deve bloquear a aprovação de uma imagem. Devolve se
 * conseguiu, para quem quiser registrar.
 */
export async function deleteDriveFile(drive: drive_v3.Drive, fileId: string): Promise<boolean> {
  try {
    await drive.files.delete({ fileId, supportsAllDrives: true })
    return true
  } catch {
    return false
  }
}
