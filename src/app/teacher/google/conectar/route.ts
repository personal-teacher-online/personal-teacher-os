import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { googleAuthUrl, googleOAuthConfigFromEnv } from '@/lib/google/oauth'
import { tokenKeyFromEnv } from '@/lib/google/token-crypto'
import { createClient } from '@/lib/supabase/server'
import { cookieDoFlash } from '@/lib/portal/flash'

// ADR-017/M3: início do fluxo de conexão — professora logada clica "Conectar
// Google Agenda". A rota vive DENTRO de /teacher de propósito: o gate por
// prefixo já garante papel teacher/admin sem entrada nova em PUBLIC_PATHS.
// CSRF: state aleatório vai na URL do Google E num cookie httpOnly — o
// callback exige os dois iguais (fluxo recomendado na doc oficial OAuth2).

export async function GET(request: Request) {
  const cfg = googleOAuthConfigFromEnv()
  // Base pública p/ o redirect de erro: request.url dentro do container é
  // http://0.0.0.0:3000 (Safari bloqueia). Usamos a origem do redirectUrl.
  const base = cfg
    ? new URL(cfg.redirectUrl).origin
    : process.env.NODE_ENV === 'production'
      ? 'https://app.personal-teacher.com'
      : new URL(request.url).origin
  // O desfecho vai num cookie de flash (nunca na URL: link forjado não afirma nada).
  const back = (msg: string) => {
    const res = NextResponse.redirect(new URL('/teacher', base))
    const { nome, valor, opcoes } = cookieDoFlash(msg)
    res.cookies.set(nome, valor, opcoes)
    return res
  }

  if (!cfg || !tokenKeyFromEnv()) {
    return back('Integração com o Google ainda não está configurada no servidor.')
  }

  // Mesmo pino do painel: "a própria professora" = a do profile logado (a dona
  // é admin e veria todas as linhas de teachers pela policy admin_all).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('profile_id', user?.id ?? '')
    .maybeSingle()
  if (!teacher) return back('Sua conta não está vinculada a uma professora.')

  const state = randomBytes(16).toString('hex')
  const res = NextResponse.redirect(googleAuthUrl(cfg, state))
  res.cookies.set('gcal-oauth-state', state, {
    httpOnly: true,
    sameSite: 'lax', // o retorno do Google é navegação top-level GET — lax envia
    secure: process.env.NODE_ENV === 'production',
    path: '/teacher/google',
    maxAge: 600,
  })
  return res
}
