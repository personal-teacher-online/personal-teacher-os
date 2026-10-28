'use server'

import { redirect } from 'next/navigation'
import { resolveNextPath, roleFromUser } from '@/lib/auth/gate'
import { createClient } from '@/lib/supabase/server'

// ADR-014: login diário é por SENHA. O link por e-mail existe só para ativar o
// convite (D6) e para redefinir a senha — nunca como login corrente.
export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  if (!email.includes('@') || password.length === 0) {
    redirect('/login?erro=credenciais')
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  // Resposta NEUTRA (caso 2 do goal): credencial errada e e-mail inexistente são a
  // MESMA mensagem — não revelar quem é cliente. Erros de sistema vão para o log.
  if (error) {
    if (error.code !== 'invalid_credentials') {
      console.error('signInWithPassword falhou:', error.code, error.message)
    }
    redirect('/login?erro=credenciais')
  }

  const role = roleFromUser(data.user)
  if (!role) redirect('/login?erro=credenciais')
  // F0 (M8-3): deep link do aviso — volta aonde a pessoa ia; a matriz de acesso
  // é a allowlist (caminho externo/indevido cai no home do papel).
  redirect(resolveNextPath(role, String(formData.get('next') ?? '') || null))
}

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  if (!email.includes('@')) redirect('/recuperar-senha?estado=email-invalido')

  const supabase = await createClient()
  // O template de recovery (aprovação D5) leva a /auth/confirm?type=recovery, que
  // abre /definir-senha com sessão. E-mail desconhecido: resposta neutra, como acima.
  const { error } = await supabase.auth.resetPasswordForEmail(email)
  if (error && !['user_not_found', 'otp_disabled'].includes(error.code ?? '')) {
    console.error('resetPasswordForEmail falhou:', error.code, error.message)
  }
  redirect('/recuperar-senha?estado=enviado')
}
