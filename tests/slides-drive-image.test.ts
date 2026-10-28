import { afterEach, describe, expect, it, vi } from 'vitest'
import type { drive_v3 } from 'googleapis'
import { deleteDriveFile, uploadImage } from '../src/lib/slides/drive.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

function driveMock(overrides: Partial<drive_v3.Drive['files']> = {}) {
  const create = vi.fn().mockResolvedValue({ data: { id: 'file-1', webViewLink: 'https://drive/x' } })
  const del = vi.fn().mockResolvedValue({})
  return {
    files: { create, delete: del, ...overrides },
  } as unknown as drive_v3.Drive
}

describe('uploadImage (IM-2)', () => {
  it('sobe a imagem SEM converter para formato Google — o resolvedor baixa os bytes', async () => {
    vi.stubEnv('PT_SLIDES_FOLDER_ID', 'folder-curso')
    const drive = driveMock()
    const r = await uploadImage({
      drive,
      name: 'M8A3 — cover',
      data: Buffer.from('bytes-jpeg'),
      mimeType: 'image/jpeg',
    })
    expect(r).toEqual({ fileId: 'file-1', url: 'https://drive/x' })

    const arg = (drive.files.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    // o mimeType do requestBody é o da imagem, NÃO application/vnd.google-apps.*
    expect(arg.requestBody.mimeType).toBe('image/jpeg')
    expect(arg.media.mimeType).toBe('image/jpeg')
    expect(arg.requestBody.parents).toEqual(['folder-curso'])
    expect(arg.supportsAllDrives).toBe(true)
  })

  it('sem webViewLink cai para um link de arquivo do Drive', async () => {
    vi.stubEnv('PT_SLIDES_FOLDER_ID', 'folder-curso')
    const drive = driveMock({
      create: vi.fn().mockResolvedValue({ data: { id: 'file-9' } }),
    } as never)
    const r = await uploadImage({ drive, name: 'x', data: Buffer.from(''), mimeType: 'image/png' })
    expect(r.url).toContain('file-9')
  })

  it('Drive sem id devolvido é erro explícito', async () => {
    vi.stubEnv('PT_SLIDES_FOLDER_ID', 'folder-curso')
    const drive = driveMock({ create: vi.fn().mockResolvedValue({ data: {} }) } as never)
    await expect(
      uploadImage({ drive, name: 'x', data: Buffer.from(''), mimeType: 'image/png' }),
    ).rejects.toThrow('não devolveu o id')
  })
})

describe('deleteDriveFile (limpeza best-effort)', () => {
  it('apaga e confirma', async () => {
    const drive = driveMock()
    expect(await deleteDriveFile(drive, 'file-1')).toBe(true)
    expect(drive.files.delete).toHaveBeenCalledWith({ fileId: 'file-1', supportsAllDrives: true })
  })

  it('falha ao apagar NÃO explode — candidata órfã é clutter, não erro', async () => {
    const drive = driveMock({ delete: vi.fn().mockRejectedValue(new Error('404')) } as never)
    expect(await deleteDriveFile(drive, 'sumiu')).toBe(false)
  })
})
