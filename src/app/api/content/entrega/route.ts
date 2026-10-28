import { NextResponse, type NextRequest } from 'next/server'
import { handleContentEntrega, type ImageSink } from '@/lib/content/handle'
import { contentFolderFromEnv, driveImageSink } from '@/lib/content/images'
import { googleClientsFromEnv } from '@/lib/google/slides'
import { createAdminClient } from '@/lib/supabase/admin'

// ADR-021: entrega do gerador (gerando → rascunho). Imagens persistem no Drive
// (Lei 10) — a service account é a MESMA do módulo de Slides. Sem envs de Drive,
// o sink falha com mensagem honesta APÓS o guard de token (fail-fast, sem vazar
// estado de configuração para chamadas não autenticadas).
function sinkFromEnv(): ImageSink {
  const clients = googleClientsFromEnv()
  const folderId = contentFolderFromEnv()
  if (clients && folderId) return driveImageSink(clients.drive, folderId)
  const err = async (): Promise<never> => {
    throw new Error(
      'Drive da fábrica não configurado — defina GOOGLE_SERVICE_ACCOUNT_JSON e CONTENT_DRIVE_FOLDER_ID',
    )
  }
  return { persist: err, fetchUrl: err }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const { status, body: out } = await handleContentEntrega(
    createAdminClient(),
    {
      token: request.headers.get('content-api-token'),
      expectedToken: process.env.CONTENT_API_TOKEN,
    },
    body,
    sinkFromEnv(),
  )
  return NextResponse.json(out, { status })
}
