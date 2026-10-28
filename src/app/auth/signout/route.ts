import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { esquecerRascunho } from '@/lib/admin/rascunho-do-formulario'
import { esquecerFlash } from '@/lib/portal/flash'

export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // O recado da última ação do portal NÃO atravessa o logout (varredura de onda,
  // V5): o cookie de flash vive 15s e é do NAVEGADOR, não da sessão — sem isto,
  // quem age e sai em seguida deixa "Senha trocada. ✓" na tela de `/login` para
  // a próxima pessoa que usar a máquina. Quem apaga é o escritor, num caminho de
  // mutação (ver `src/lib/portal/flash.ts`).
  await esquecerFlash()
  // …e o RASCUNHO do admin também não atravessa o logout (Sol · rodada 2 do A4,
  // médio 2). O comentário do mecanismo prometia "sucesso e signout" e o signout
  // nunca tinha sido implementado: numa máquina compartilhada, quem sai depois
  // de um erro deixava nome do aluno, preço e o motivo do bloqueio ("cirurgia")
  // vivos por 60s — e um segundo login dentro dessa janela reencontrava tudo no
  // formulário. Mesmo padrão do flash: quem apaga é um caminho de mutação.
  await esquecerRascunho()
  // Location relativo (ver auth/confirm): não vazar host interno atrás do proxy.
  return new NextResponse(null, { status: 303, headers: { location: '/login' } })
}
