import { NextResponse, type NextRequest } from 'next/server'
import { handleContentRefs, type RefSource } from '@/lib/content/handle'
import { driveRefSource, refsFolderFromEnv } from '@/lib/content/images'
import { googleClientsFromEnv } from '@/lib/google/slides'

// ADR-021: fotos de referência da Teacher Vicky para o provedor de imagem (Nano Banana).
// Chamada 1× por geração (nunca no polling) — as fotos vivem em pasta privada
// do Drive compartilhada só com a service account.
function refsFromEnv(): RefSource {
  const clients = googleClientsFromEnv()
  const folderId = refsFolderFromEnv()
  if (clients && folderId) return driveRefSource(clients.drive, folderId)
  return {
    async list(): Promise<never> {
      throw new Error(
        'Refs da fábrica não configuradas — defina GOOGLE_SERVICE_ACCOUNT_JSON e CONTENT_DRIVE_REFS_FOLDER_ID',
      )
    },
  }
}

export async function GET(request: NextRequest) {
  const { status, body } = await handleContentRefs(
    {
      token: request.headers.get('content-api-token'),
      expectedToken: process.env.CONTENT_API_TOKEN,
    },
    refsFromEnv(),
  )
  return NextResponse.json(body, { status })
}
