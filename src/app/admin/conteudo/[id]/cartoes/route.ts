import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { NextResponse, type NextRequest } from 'next/server'
import { capaCard, cardSize, cenaCard, textoCard, type Slide } from '@/lib/content/compose'
import { readDriveImage } from '@/lib/content/images'
import { buildZip, type ZipEntry } from '@/lib/content/zip'
import { roleFromUser } from '@/lib/auth/gate'
import { googleClientsFromEnv } from '@/lib/google/slides'
import { createClient } from '@/lib/supabase/server'

// "Carrossel com um clique" (ADR-021/Lei 11): compõe os cartões finais — CADA
// slide sobre a SUA cena, com o texto por cima — e entrega um ZIP pronto para
// postar. Rota de sessão admin (padrão da rota de imagem).

type Img = { slide: number | null; variante?: number; drive_file_id: string }

/** A imagem que vale para o slide N é a PRIMEIRA registrada com aquele número
 *  (alternar variante = reordenar o array). A capa aceita slide 1 ou null,
 *  porque posts antigos gravaram a foto da capa sem número. */
function imagemDoSlide(images: Img[], ordem: number, capa: boolean): Img | undefined {
  return (
    images.find((i) => i.slide === ordem) ?? (capa ? images.find((i) => i.slide === null) : undefined)
  )
}

async function lerMarca(): Promise<string | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), 'public', 'brand', 'simbolo-branco.png'))
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return null // sem símbolo o selo cai para as iniciais — não bloqueia o ZIP
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || roleFromUser(user) !== 'admin') {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const { id } = await params
  const { data: post } = await supabase
    .from('content_posts')
    .select('id, kind, status, tema, gancho, slides, images')
    .eq('id', id)
    .maybeSingle()
  if (!post) return NextResponse.json({ ok: false, detail: 'post não existe' }, { status: 404 })

  const slides = ((post.slides ?? []) as Slide[]).slice().sort((a, b) => a.ordem - b.ordem)
  if (post.kind === 'roteiro_reel' || slides.length === 0) {
    return NextResponse.json(
      { ok: false, detail: 'este formato não tem cartões — use a legenda/roteiro' },
      { status: 400 },
    )
  }

  const images = (post.images ?? []) as Img[]
  const marcaDataUrl = await lerMarca()

  // Baixa as cenas do Drive em paralelo; a que falhar vira null e aquele slide
  // cai para o cartão de texto, em vez de derrubar o ZIP inteiro.
  let cenas: Array<string | null> = slides.map(() => null)
  if (images.length > 0) {
    const clients = googleClientsFromEnv()
    if (!clients) {
      return NextResponse.json(
        { ok: false, detail: 'GOOGLE_SERVICE_ACCOUNT_JSON ausente — configure o Drive (§N)' },
        { status: 503 },
      )
    }
    cenas = await Promise.all(
      slides.map(async (slide, i) => {
        const img = imagemDoSlide(images, slide.ordem, i === 0)
        if (!img) return null
        try {
          const { mime, data } = await readDriveImage(clients.drive, img.drive_file_id)
          return `data:${mime};base64,${data.toString('base64')}`
        } catch {
          return null
        }
      }),
    )
  }

  const { width, height } = cardSize(post.kind)
  const total = slides.length
  const entries: ZipEntry[] = []
  for (const [i, slide] of slides.entries()) {
    const cenaDataUrl = cenas[i]
    const cta = i === slides.length - 1
    let jsx
    if (i === 0) {
      jsx = capaCard({
        fotoDataUrl: cenaDataUrl,
        gancho: slide.texto || post.gancho || post.tema,
        kind: post.kind,
        marcaDataUrl,
      })
    } else if (cenaDataUrl) {
      jsx = cenaCard({ slide, total, kind: post.kind, cenaDataUrl, marcaDataUrl, cta })
    } else {
      jsx = textoCard({ slide, total, kind: post.kind, cta, marcaDataUrl })
    }
    const png = await new ImageResponse(jsx, { width, height }).arrayBuffer()
    entries.push({
      name: `slide-${String(i + 1).padStart(2, '0')}.png`,
      data: new Uint8Array(png),
    })
  }

  const zip = buildZip(entries)
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="carrossel-${post.id.slice(0, 8)}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
