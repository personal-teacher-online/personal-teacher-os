// O AVISO DE COMPROMISSO DO GOOGLE, DENTRO DO FORMULÁRIO DE HORÁRIO ABERTO
// (issue #190). Uma peça só para as duas portas que publicam: o painel
// `?novo=horario` (servidor) e o balão do slot (cliente). Sem `'use client'` de
// propósito: não tem estado, e assim serve aos dois lados.
//
// Ela entra NO LUGAR do botão "Publicar horário": nada foi publicado ainda, e as
// duas saídas são as que a issue pede. O botão leva a FICHA do aviso (de qual
// professora e de qual instante ele fala); a action só a aceita para o mesmo
// horário, então trocar a data depois do aviso faz o Google ser conferido de
// novo em vez de publicar no escuro.

import Link from 'next/link'

import {
  AVISO_DO_GOOGLE_AO_PUBLICAR,
  CAMPO_DO_AVISO_DO_GOOGLE,
  PUBLICAR_MESMO_ASSIM,
} from '@/lib/admin/aviso-google-ao-publicar'

/** As duas ações no piso da régua (texto `text-sm`, alvo de 36px). */
const CONFIRMAR = 'btn-ink !min-h-9 !px-3.5 !py-1.5 !text-sm w-full'
const VOLTAR = 'btn-paper !min-h-9 !px-3.5 !py-1.5 !text-sm w-full'

export function AvisoDoGoogleAoPublicar({
  ficha,
  voltarPara,
}: {
  /** a ficha que a action guardou no rascunho ao parar a publicação */
  ficha: string
  /** a agenda sem o formulário aberto: "voltar" não publica nada */
  voltarPara: string
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-input border border-line border-l-4 border-l-warn-700 bg-paper-0 p-3"
    >
      {/* DADO (muda a decisão): piso literal da régua, nunca texto apagado. */}
      <p className="text-sm leading-snug font-medium text-ink-900">{AVISO_DO_GOOGLE_AO_PUBLICAR}</p>
      <div className="flex flex-col gap-2">
        <button
          type="submit"
          name={CAMPO_DO_AVISO_DO_GOOGLE}
          value={ficha}
          className={CONFIRMAR}
        >
          {PUBLICAR_MESMO_ASSIM}
        </button>
        <Link href={voltarPara} className={VOLTAR}>
          Voltar
        </Link>
      </div>
    </div>
  )
}
