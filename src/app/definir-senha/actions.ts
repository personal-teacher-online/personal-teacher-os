'use server'

import { redirect } from 'next/navigation'
import { HOME_BY_ROLE, roleFromUser } from '@/lib/auth/gate'
import { validatePasswordPair } from '@/lib/auth/password'
import { createClient } from '@/lib/supabase/server'

export async function setPassword(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  const invalid = validatePasswordPair(password, confirm)
  if (invalid) redirect(`/definir-senha?erro=${invalid}`)

  const supabase = await createClient()
  const { data, error } = await supabase.auth.updateUser({ password })
  if (error) {
    // weak_password / same_password etc. — mensagem única, sem eco do motivo interno.
    console.error('updateUser(password) falhou:', error.code, error.message)
    redirect('/definir-senha?erro=recusada')
  }

  const role = roleFromUser(data.user)
  redirect(role ? HOME_BY_ROLE[role] : '/login')
}
