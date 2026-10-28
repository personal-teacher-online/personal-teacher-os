import { NextResponse, type NextRequest } from 'next/server'
import { safeTokenEqual } from '@/lib/auth/token'
import { createAdminClient } from '@/lib/supabase/admin'
import { TETO_DIARIO_DE_ROTEIROS, generateContentBatch } from '@/lib/content/generate'

// M2/ADR-031 — rota fina da rotina diária de geração de roteiro (Scheduled Task,
// mesmo padrão do dispatch-outbox: token no HEADER, nunca query; fail-closed).
// Núcleo testável em src/lib/content/generate.ts; aqui SÓ header, env e lote.
//
// ── O QUE ESTA ROTINA VIROU NA LEVA 5 (ADR-035 decisão 4) ───────────────────
// Ela é a VASSOURA DE RETRY da fila: o roteiro agora nasce no radar, e o que
// sobra em `ideia_aprovada` é (a) post devolvido por erro de geração e (b) post
// que a Teacher Vicky pediu depois do teto do dia. O teto passou a ser DIÁRIO e SOMADO
// (botão + vassoura), então o lote desta corrida é a FOLGA do dia — não mais 2
// fixos. Quem manda na contagem é o banco (`roteiros_gerados_hoje`).
//
// Teto DUPLO de propósito: o do dia (custo) e 3 tentativas por post (o
// `attempts` do banco) — a fila de revisão da Teacher Vicky é o recurso escasso, não a
// API. Sem ANTHROPIC_API_KEY a rotina responde 200 e não faz nada: a rotina
// estar desligada não é erro de quem chamou.
//
// RESIDUAL NOMEADO (cabeçalho da migration 20260803000400): a folga é lida UMA
// vez por corrida. Se a Teacher Vicky clicar em "Gerar roteiro" no meio da corrida das
// 12:00 UTC, o dia pode fechar com 1 roteiro a mais.
export async function POST(request: NextRequest) {
  const expected = process.env.CONTENT_GENERATE_TOKEN
  const token = request.headers.get('content-generate-token')
  if (!expected || !token || !safeTokenEqual(token, expected)) {
    return NextResponse.json({ ok: false, detail: 'token inválido' }, { status: 401 })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: true, detail: 'geração desligada (ANTHROPIC_API_KEY ausente)' })
  }

  const admin = createAdminClient()
  const { data: hoje, error } = await admin.rpc('roteiros_gerados_hoje')
  // Falha de leitura NÃO vira "gera à vontade": sem saber a folga, a rotina
  // para e diz por quê — o teto é promessa de custo, não sugestão.
  if (error) {
    return NextResponse.json(
      { ok: false, detail: `não consegui ler o teto do dia: ${error.message}` },
      { status: 500 },
    )
  }
  const folga = Math.max(0, TETO_DIARIO_DE_ROTEIROS - Number(hoje ?? 0))
  const tetoDoEnv = Number(process.env.CONTENT_GENERATE_MAX)
  const porCorrida = Number.isFinite(tetoDoEnv) && tetoDoEnv > 0 ? Math.min(tetoDoEnv, 5) : 2
  const limite = Math.min(porCorrida, folga)
  if (limite === 0) {
    return NextResponse.json({
      ok: true,
      detail: 'teto de roteiros do dia já atingido — a fila espera amanhã',
      gerados: 0,
      falhas: 0,
      detalhes: [],
    })
  }

  const report = await generateContentBatch(admin, limite)
  return NextResponse.json({ ok: true, ...report })
}
