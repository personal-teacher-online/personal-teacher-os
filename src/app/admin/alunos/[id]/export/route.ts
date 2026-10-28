import { NextResponse } from 'next/server'
import { buildStudentExport } from '@/lib/lgpd/export'
import { createClient } from '@/lib/supabase/server'

// F7/M4-5 — EXPORTAR DADOS do aluno (LGPD): arquivo legível, sob demanda,
// admin-only. Sem automação (decisão). O conteúdo é montado em
// src/lib/lgpd/export.ts (testável); aqui fica só o portão e o download.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const role = (user?.app_metadata as Record<string, unknown> | undefined)?.role
  if (role !== 'admin') {
    return NextResponse.json({ ok: false, detail: 'admin only' }, { status: 403 })
  }

  // Correção 7 (revisão 26/07): consulta que falha LANÇA lá dentro. Aqui isso
  // vira 500 e NENHUM arquivo — meio arquivo de portabilidade com cara de
  // completo é pior do que download nenhum.
  let result: Awaited<ReturnType<typeof buildStudentExport>>
  try {
    result = await buildStudentExport(supabase, id)
  } catch (err) {
    console.error('[export LGPD]', err)
    return NextResponse.json(
      {
        ok: false,
        detail: 'não foi possível montar o arquivo completo — tente de novo em instantes',
      },
      { status: 500 },
    )
  }
  if (!result.ok) {
    return NextResponse.json({ ok: false, detail: result.detail }, { status: result.status })
  }

  return new NextResponse(JSON.stringify(result.payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="dados-aluno-${id.slice(0, 8)}.json"`,
    },
  })
}
