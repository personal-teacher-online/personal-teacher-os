import { timingSafeEqual } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'

// ENTRADA AUTOMÁTICA DE BANCADA (pedido do dono, 26/07/2026) — troca o ritual
// "abrir /login, digitar e-mail e senha de preview" por UM link clicável nos
// avisos de portão visual. NÃO é ausência de auth: a rota faz signInWithPassword
// com os logins de preview (scripts/preview-logins.ts) e cria uma sessão normal;
// RLS e gate por papel seguem intactos.
//
// TRAVA DUPLA — a rota só funciona quando:
//   1. BANCADA_AUTOLOGIN=<segredo aleatório ≥16 chars> — env que vive SÓ no
//      .env.local e cujo VALOR a URL precisa apresentar (?chave=…) (documentada
//      comentada no .env.example; jamais nos envs do Coolify);
//   2. o host do request é localhost/127.0.0.1.
// Fora disso: 404 seco, antes de qualquer efeito. Em produção a env não
// existe, então o endereço simplesmente não existe.
//
// Uso: /dev-entrar?para=/admin            (admin é o padrão)
//      /dev-entrar?como=professora        (cai em /teacher)
//      /dev-entrar?como=aluno&para=/portal/aulas
//      /dev-entrar?como=aluno-briefing   (aluno com o BRIEFING pendente)
//      /dev-entrar?como=aluno-rebriefing (aluno com o RE-BRIEFING semestral pendente)
const CONTAS = {
  admin: { email: 'teste-senha@local.dev', senha: 'Senha-local-12345', casa: '/admin' },
  professora: { email: 'prof-preview@local.dev', senha: 'Preview-12345', casa: '/teacher' },
  aluno: { email: 'aluno-preview@local.dev', senha: 'Preview-12345', casa: '/portal' },
  // O SEGUNDO aluno de bancada (P7): existe porque o `aluno` acima atravessa o
  // gate (ciência dada, briefing enviado) e o portal tem estados que só se veem
  // ANTES dele — o formulário v2 de seis etapas e o recado que precisa
  // sobreviver ao redirect do gate. Quem semeia os dois estados é
  // `scripts/preview-seed.ts` (bloco "portal do aluno").
  'aluno-briefing': { email: 'aluno2-preview@local.dev', senha: 'Preview-12345', casa: '/portal' },
  // O TERCEIRO aluno: contrato individual com 8 meses de estrada, plano do
  // semestre 2 vigente e briefing base v2 enviado — o único estado em que o card
  // "Seu plano do semestre 2 está chegando" aparece no Início. Não dá para
  // reaproveitar os outros dois sem mover o contrato da Sabrina (que é a aluna
  // das dez telas do smoke). Semeado por `scripts/preview-seed.ts` (bloco
  // "3º login com RE-BRIEFING semestral pendente").
  'aluno-rebriefing': { email: 'aluno3-preview@local.dev', senha: 'Preview-12345', casa: '/portal' },
} as const

// Mesma disciplina do /wa: destino restrito por allowlist (nunca open
// redirect) e Location RELATIVO (atrás de proxy, absoluto vazaria host).
const DEST_OK = /^\/(admin|teacher|portal|sales)(\/|$)/

function redirectTo(path: string) {
  return new NextResponse(null, { status: 303, headers: { location: path } })
}

export async function GET(request: NextRequest) {
  // Revisão nº 5 (Sol): hostname vem do Host reconstruído — NÃO prova origem
  // local. As travas precisam ser independentes de verdade: a env deixa de ser
  // um liga/desliga ("1") e vira um SEGREDO aleatório (≥16 chars) que a URL tem
  // que apresentar em `chave`. Env vazada sem o link não abre nada; link vazado
  // sem a env idem. Host segue conferido como cinto extra, não como prova.
  const segredo = process.env.BANCADA_AUTOLOGIN ?? ''
  const chave = request.nextUrl.searchParams.get('chave') ?? ''
  // Host vem do HEADER, não de nextUrl.hostname: no Next 16 em standalone o
  // nextUrl deixou de refletir o host do request (medido em 03/08 — a rota
  // 404-ava na bancada com chave CORRETA). O header continua sendo cinto
  // extra, nunca prova (revisão nº 5 do Sol): a trava real é o segredo.
  const host = (request.headers.get('host') ?? '').split(':')[0]
  const local = host === '127.0.0.1' || host === 'localhost'
  const chaveOk =
    segredo.length >= 16 &&
    chave.length === segredo.length &&
    timingSafeEqual(Buffer.from(chave), Buffer.from(segredo))
  if (!chaveOk || !local) {
    return new NextResponse(null, { status: 404 })
  }

  const como = request.nextUrl.searchParams.get('como') ?? 'admin'
  const conta = CONTAS[como as keyof typeof CONTAS]
  if (!conta) return new NextResponse(null, { status: 404 })

  const para = request.nextUrl.searchParams.get('para') ?? conta.casa
  const dest = DEST_OK.test(para) ? para : conta.casa

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: conta.email,
    password: conta.senha,
  })

  // Login de preview ausente (banco recém-resetado sem preview-logins) não pode
  // virar página morta: cai no /login normal com o destino preservado.
  if (error) return redirectTo(`/login?next=${encodeURIComponent(dest)}`)
  return redirectTo(dest)
}
