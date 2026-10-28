import 'server-only'
import { createClient } from '@supabase/supabase-js'

/** Cliente service-role (Lei 4: SÓ no servidor — a chave nunca chega ao cliente).
 *  Ignora RLS; usar apenas em fluxos administrativos já autorizados (D10). */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes no ambiente')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
