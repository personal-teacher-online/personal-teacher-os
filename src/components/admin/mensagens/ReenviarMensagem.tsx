'use client'

// "REENVIAR" NO PAINEL DA MENSAGEM (Onda Agenda e Mensagens · M3-3b). Quem
// decide, recusa e audita é a RPC `admin_resend_outbox` (Lei 3); aqui só se leva
// o id e a situação que a tela mostrava (a RPC recusa se ela mudou) e se conta o
// que voltou — toast do kit, sem recado na URL. Deu certo: o painel fecha e a
// lista volta já com a cópia em Aguardando (a action revalida a rota).

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { reenviarMensagemAction } from '@/app/admin/avisos/actions'

export function ReenviarMensagem({
  id,
  situacao,
  voltarPara,
}: {
  id: string
  situacao: string
  voltarPara: string
}) {
  const router = useRouter()
  const [enviando, iniciar] = useTransition()

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const dados = new FormData(evento.currentTarget)
    iniciar(async () => {
      const r = await reenviarMensagemAction(dados)
      if (r.ok) {
        toast.success(r.mensagem)
        router.push(voltarPara)
      } else {
        toast.error(r.mensagem)
      }
    })
  }

  return (
    <form onSubmit={enviar}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="situacao" value={situacao} />
      <button type="submit" className="btn-ac btn-ac-lg" data-pending={enviando ? '' : undefined}>
        Reenviar
      </button>
    </form>
  )
}
