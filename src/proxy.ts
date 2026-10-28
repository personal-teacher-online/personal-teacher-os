import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { resolveAccess, roleFromUser } from '@/lib/auth/gate'

// Next 16: a convenção middleware.ts virou proxy.ts (runtime Node fixo).
// Duas responsabilidades: refresh da sessão (cookies) e gate por papel.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Secure por env EXPLÍCITA (deploy https no Coolify), nunca por NODE_ENV:
      // `next start` local é production e o Safari descarta cookie Secure em http://.
      cookieOptions: { secure: process.env.COOKIE_SECURE === 'true' },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // getUser() valida o token NO SERVIDOR de Auth. Nunca decidir acesso por
  // getSession() puro (cookie sem verificação) — caso de teste 3 do goal.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const access = resolveAccess(roleFromUser(user), request.nextUrl.pathname)
  if (access.kind === 'redirect') {
    const url = request.nextUrl.clone()
    url.pathname = access.to
    url.search = ''
    // F0 (M8-3): não autenticado indo a página interna → /login?next=<destino>,
    // para o deep link dos avisos devolver a pessoa aonde ela ia. A validação
    // (allowlist pela matriz de acesso) fica na action do login.
    if (access.to === '/login' && request.nextUrl.pathname !== '/') {
      url.searchParams.set('next', request.nextUrl.pathname)
    }
    const redirect = NextResponse.redirect(url)
    // Sem isto, um refresh de token que coincida com redirect (ex.: "/" após 1h)
    // perderia o Set-Cookie rotacionado → reuse detection → logout em todo lugar.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
    return redirect
  }
  return response
}

export const config = {
  matcher: [
    // Tudo, exceto estáticos do Next e assets públicos (emails/ serve os
    // templates em prod; geo/ a base de cidades do CityPicker; flexge/ o
    // catálogo de aulas do FlexgeLessonPicker).
    '/((?!_next/static|_next/image|favicon.ico|emails/|geo/|flexge/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
