import 'server-only'

// CONTA DA PESSOA LOGADA — o mínimo que a barra superior mostra (nome e
// e-mail). Uma leitura, uma função tipada, `server-only`: a mesma convenção da
// camada de dados do Início.
//
// Esta é a SEGUNDA leitura do app que DEGRADA em vez de estourar (a primeira é
// a saudação): o cluster de conta é cortesia de chrome, não afirmação sobre o
// negócio. Se o perfil não vier, a barra mostra "Minha conta" e a admin segue
// trabalhando — acender o boundary de erro do admin inteiro porque um nome não
// carregou seria trocar um enfeite por uma tela branca.

import { createClient } from '@/lib/supabase/server'

export interface ContaDoAdmin {
  /** primeiro nome, como a barra mostra */
  nome: string
  email: string | null
}

export async function getContaDoAdmin(): Promise<ContaDoAdmin> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { nome: '', email: null }

  const { data } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
  const completo = (data?.full_name ?? '').trim()
  return { nome: completo.split(' ')[0] ?? '', email: user.email ?? null }
}
