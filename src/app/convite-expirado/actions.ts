'use server'

import { redirect } from 'next/navigation'
import { provisionStudent } from '@/lib/auth/provision'
import { reenviarConvite } from '@/lib/auth/reenvio'
import { createAdminClient } from '@/lib/supabase/admin'

// F7/M4-2: reenvio NEUTRO — a resposta é a MESMA exista ou não o convite
// (não revelar quem é cliente; mesma postura da recuperação de senha).
// Reenviar INVALIDA o link anterior (comportamento do GoTrue — teste empírico
// no gate de go-live).
//
// P5: a decisão saiu daqui e virou `reenviarConvite` (`src/lib/auth/reenvio.ts`),
// que sabe distinguir "não é cliente" (resposta neutra) de "não deu para
// perguntar ao banco" (aviso honesto) — a dívida c14 desta tela. Esta action é o
// invólucro: monta o client de servidor e traduz o desfecho em rota.
//
// CORREÇÃO 28/07 (rodada do Sol, achado grave 2): este reenvio era o segundo
// contorno da exigência do WhatsApp — quem caía aqui recebia convite (e até
// provisionamento novo) sem número nenhum. Agora o provisionador só roda para
// aluno que JÁ tem perfil COM número; um formulário público não pode coletar
// nem gravar número (o dado é da escola, entra pela ficha).
//
// Rodada 2 do Sol (achado 2): o desfecho `fale-com-a-escola` que a primeira
// rodada criou MORREU. Ele diferia de `enviado` e, portanto, enumerava por
// comportamento: "este e-mail respondeu diferente ⇒ é aluno cadastrado sem
// número". Todos os caminhos que não provisionam — e-mail desconhecido, aluno
// sem perfil, perfil sem número — devolvem o MESMO `enviado`, cuja cópia é
// neutra e SEM promessa ("Pedido recebido… se nada chegar, fale com a gente")
// — rodada 4: "chega em instantes" era falso para cadastrado sem número — e
// já aponta o balcão humano:
// quem precisa de intervenção da escola é atendido por ela, não por um estado
// de tela. A invariante fica intacta — nesses caminhos NADA é provisionado.
// Falha de LEITURA nas duas consultas estoura de propósito: o `reenviarConvite`
// a engole no caminho neutro já existente (log nosso, resposta igual para todo
// mundo).
export async function resendMyInviteAction(formData: FormData) {
  const desfecho = await reenviarConvite(
    createAdminClient(),
    String(formData.get('email') ?? ''),
    async (admin, studentId, email) => {
      const aluno = await admin
        .from('students')
        .select('profile_id')
        .eq('id', studentId)
        .maybeSingle()
      if (aluno.error) throw new Error(aluno.error.message)
      // Sem perfil = nunca foi convidado: provisionar por AQUI criaria o acesso
      // sem número, exatamente o buraco que a invariante proíbe.
      if (!aluno.data?.profile_id) return
      const perfil = await admin
        .from('profiles')
        .select('whatsapp_e164')
        .eq('id', aluno.data.profile_id)
        .maybeSingle()
      if (perfil.error) throw new Error(perfil.error.message)
      if (!perfil.data?.whatsapp_e164) return
      return provisionStudent(admin, studentId, email, null)
    },
  )
  redirect(`/convite-expirado?estado=${desfecho}`)
}
