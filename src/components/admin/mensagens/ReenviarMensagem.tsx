'use client'

// "REENVIAR" NO PAINEL DA MENSAGEM (Onda Agenda e Mensagens · M3-3b). Quem
// decide, recusa e audita é a RPC `admin_resend_outbox` (Lei 3); aqui só se leva
// o id e a situação que a tela mostrava (a RPC recusa se ela mudou) e se conta o
// que voltou — toast do kit, sem recado na URL. Deu certo: o painel fecha e a
// lista volta já com a cópia em Aguardando (a action revalida a rota).
//
// Dois passos: reenviar manda uma SEGUNDA mensagem igual (na Meta, paga e com
// efeito na nota do número), então o primeiro clique só pede a confirmação.

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
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
  const [confirmando, setConfirmando] = useState(false)

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (enviando) return
    const dados = new FormData(evento.currentTarget)
    iniciar(async () => {
      const r = await reenviarMensagemAction(dados)
      if (r.ok) {
        toast.success(r.mensagem)
        router.push(voltarPara)
      } else {
        toast.error(r.mensagem)
        setConfirmando(false)
        // a recusa quase sempre é "a mensagem mudou": reler o painel, senão a
        // dona repete o clique com a situação velha e toma a mesma recusa
        router.refresh()
      }
    })
  }

  if (!confirmando) {
    return (
      <button type="button" className="btn-ac btn-ac-lg" onClick={() => setConfirmando(true)}>
        Reenviar
      </button>
    )
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="situacao" value={situacao} />
      <p className="text-sm font-medium text-ink-900">
        Vai sair uma segunda mensagem igual para o destinatário. Confirma?
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="btn-ac btn-ac-lg"
          disabled={enviando}
          data-pending={enviando ? '' : undefined}
        >
          Confirmar reenvio
        </button>
        <button
          type="button"
          className="inline-flex min-h-9 items-center rounded-input px-3 text-sm font-medium text-ink-600 hover:bg-paper-100 hover:text-ink-900"
          disabled={enviando}
          onClick={() => setConfirmando(false)}
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
