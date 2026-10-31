'use client'

// "RESOLVER SEM ENVIAR" NO PAINEL DA MENSAGEM (F6/M8-5 → M3-3a). Quem decide e
// audita é a RPC `admin_resolve_outbox` (Lei 3); aqui só se leva o motivo e se
// conta o que voltou — toast do kit, sem recado na URL. Deu certo: o painel
// fecha e a lista volta já com a linha resolvida (a action revalida a rota).

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { CAMPO, Campo } from '@/components/admin/alunos/ficha/pecas'
import { FormValidado } from '@/components/kit/form-validado'
import { resolverMensagemAction } from '@/app/admin/avisos/actions'

export function ResolverMensagem({
  id,
  voltarPara,
  jaSaiu = false,
}: {
  id: string
  voltarPara: string
  /** a mensagem chegou a sair e falhou depois: resolver é "sem reenviar" */
  jaSaiu?: boolean
}) {
  const router = useRouter()
  const [enviando, iniciar] = useTransition()

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const dados = new FormData(evento.currentTarget)
    iniciar(async () => {
      const r = await resolverMensagemAction(dados)
      if (r.ok) {
        toast.success(r.mensagem)
        router.push(voltarPara)
      } else {
        toast.error(r.mensagem)
      }
    })
  }

  return (
    <FormValidado onSubmit={enviar} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="ja_saiu" value={jaSaiu ? '1' : '0'} />
      <Campo
        rotulo="Motivo"
        apoio={`Fica registrado na mensagem e na trilha de auditoria. ${jaSaiu ? 'Nada será reenviado.' : 'A mensagem não será enviada.'}`}
        exigencia="Escreva o motivo para resolver sem enviar"
      >
        <input name="note" required placeholder="ex.: já avisei pelo WhatsApp" className={CAMPO} />
      </Campo>
      <div>
        <button type="submit" className="btn-ac btn-ac-lg" data-pending={enviando ? '' : undefined}>
          {jaSaiu ? 'Resolver sem reenviar' : 'Resolver sem enviar'}
        </button>
      </div>
    </FormValidado>
  )
}
