import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** Cliente Supabase (anon key + cookies da sessão) para Server Components,
 *  Server Actions e Route Handlers. RLS decide o que este cliente enxerga. */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Secure por env EXPLÍCITA (deploy https no Coolify), nunca por NODE_ENV:
      // `next start` local é production e o Safari descarta cookie Secure em http://.
      cookieOptions: { secure: process.env.COOKIE_SECURE === 'true' },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Component não pode gravar cookies — o refresh fica com o proxy.
          }
        },
      },
    },
  )
}
