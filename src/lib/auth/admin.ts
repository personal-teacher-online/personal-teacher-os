import 'server-only'
import { redirect } from 'next/navigation'
import { roleFromUser } from '@/lib/auth/gate'
import { createClient } from '@/lib/supabase/server'

/** D10: server actions são endpoints públicos — SEMPRE revalidam o chamador admin,
 *  independentemente do proxy. Retorna o uid (ator para auditoria). */
export async function requireAdminId(): Promise<string> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || roleFromUser(user) !== 'admin') redirect('/login')
  return user.id
}
