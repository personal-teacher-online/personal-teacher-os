import { NextResponse, type NextRequest } from 'next/server'
import { readDriveImage } from '@/lib/content/images'
import { roleFromUser } from '@/lib/auth/gate'
import { googleClientsFromEnv } from '@/lib/google/slides'
import { createClient } from '@/lib/supabase/server'

// Proxy das imagens da fábrica (Drive → painel). O proxy do app já barra
// não-admin em /admin/*, mas rota é endpoint público por natureza (D10):
// revalida a sessão admin aqui, como as server actions.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || roleFromUser(user) !== 'admin') {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const clients = googleClientsFromEnv()
  if (!clients) {
    return NextResponse.json(
      { ok: false, detail: 'GOOGLE_SERVICE_ACCOUNT_JSON ausente' },
      { status: 503 },
    )
  }

  const { fileId } = await params
  // Drive file ids são [A-Za-z0-9_-]; qualquer outra coisa é lixo.
  if (!/^[A-Za-z0-9_-]{10,120}$/.test(fileId)) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  try {
    const { mime, data } = await readDriveImage(clients.drive, fileId)
    const download = request.nextUrl.searchParams.get('download') === '1'
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=3600',
        ...(download ? { 'Content-Disposition': `attachment; filename="${fileId}.${mime.split('/')[1] ?? 'png'}"` } : {}),
      },
    })
  } catch (err) {
    return NextResponse.json({ ok: false, detail: (err as Error).message }, { status: 502 })
  }
}
