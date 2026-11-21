// O AVISO DE COMPROMISSO DO GOOGLE, DENTRO DO FORMULÁRIO DE HORÁRIO ABERTO
// (issue #190). Uma peça só para as duas portas que publicam: o painel
// `?novo=horario` (servidor) e o balão do slot (cliente). Sem `'use client'` de
// propósito: não tem estado, e assim serve aos dois lados.
//
// Ela entra NO LUGAR do botão "Publicar horário": nada foi publicado ainda, e as
// duas saídas são as que a issue pede, as duas como envio do MESMO formulário:
//   · "Publicar mesmo assim" leva a FICHA do aviso (de qual professora e de qual
//     instante ele fala); a action só a aceita para o mesmo horário;
//   · "Voltar" vai para outra action, que tira o aviso do rascunho e devolve o
//     formulário editável, com o que a dona tinha escolhido. Um link não
//     serviria: o aviso ficaria guardado e voltaria a aparecer ao reabrir.
//
// `role="group"`, e não `alert`: quem anuncia a parada é o recado da seção; aqui
// ficam a frase e os dois botões, nomeados pela frase.

import { voltarDoAvisoDoGoogleAction } from '@/app/admin/agenda/actions'
import {
  AVISO_DO_GOOGLE_AO_PUBLICAR,
  CAMPO_DO_AVISO_DO_GOOGLE,
  PUBLICAR_MESMO_ASSIM,
} from '@/lib/admin/aviso-google-ao-publicar'

/** As duas ações no piso da régua (texto `text-sm`, alvo de 36px). */
const CONFIRMAR = 'btn-ink !min-h-9 !px-3.5 !py-1.5 !text-sm w-full'
const VOLTAR = 'btn-paper !min-h-9 !px-3.5 !py-1.5 !text-sm w-full'

/** O id da frase, que dá nome ao grupo (um aviso por tela: só um formulário de
 *  horário aberto fica aberto de cada vez). */
const ID_DA_FRASE = 'aviso-do-google-ao-publicar'

export function AvisoDoGoogleAoPublicar({
  ficha,
}: {
  /** a ficha que a action guardou no rascunho ao parar a publicação */
  ficha: string
}) {
  return (
    <div
      role="group"
      aria-labelledby={ID_DA_FRASE}
      data-aviso="google-ao-publicar"
      className="flex flex-col gap-3 rounded-input border border-line border-l-4 border-l-warn-700 bg-paper-0 p-3"
    >
      {/* DADO (muda a decisão): piso literal da régua, nunca texto apagado. */}
      <p id={ID_DA_FRASE} className="text-sm leading-snug font-medium text-ink-900">
        {AVISO_DO_GOOGLE_AO_PUBLICAR}
      </p>
      <div className="flex flex-col gap-2">
        <button
          type="submit"
          name={CAMPO_DO_AVISO_DO_GOOGLE}
          value={ficha}
          className={CONFIRMAR}
        >
          {PUBLICAR_MESMO_ASSIM}
        </button>
        {/* `formNoValidate`: voltar não pode esbarrar em campo obrigatório. */}
        <button
          type="submit"
          formAction={voltarDoAvisoDoGoogleAction}
          formNoValidate
          className={VOLTAR}
        >
          Voltar
        </button>
      </div>
    </div>
  )
}
