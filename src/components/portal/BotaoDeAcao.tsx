'use client'

// A PORTA NOVA DAS AÇÕES DO PORTAL (Onda do Portal · P4).
//
// Um formulário que envia para uma Server Action e ponto final. A action grava o
// recado num cookie de uso único e REDIRECIONA (`src/lib/portal/flash.ts`); a
// página de destino lê o cookie e entrega a frase ao `AvisoLegado`, que já sabe
// virar toast com JavaScript e faixa `<noscript>` sem ele.
//
// O QUE MORREU AQUI (revisão adversarial do P4, E6). Este componente interceptava
// o `onSubmit`, chamava a action à mão, lia o `ResultadoDaAcao` devolvido e
// mostrava o toast — e o `<form action>` continuava lá "para o caso de não ter
// JavaScript". Só que nesse caminho o React DESCARTA o valor de retorno: o POST
// acontecia, a página voltava redesenhada e a RECUSA não aparecia em lugar
// nenhum. Quem tentava cancelar sem JavaScript via a tela piscar e a aula
// continuar marcada, sem uma palavra de explicação.
//
// Agora há UM caminho só, e ele é o que já funcionava nos dois mundos: o
// redirect. Com JavaScript o React navega no cliente (o `<Toaster>` do layout
// segue montado e o toast chega na tela de destino); sem ele o navegador segue o
// 303 e recebe a mesma página, com a mesma frase. Sumiu junto o elenco de tipo
// que existia só para enganar o compilador — a action agora É `Promise<void>`,
// porque ela sempre termina em `redirect`.
//
// O `useRouter` também sumiu: quem navega é o redirect do servidor, então não há
// navegação imperativa a instrumentar (a régua do `useTrackedRouter` continua
// valendo para quem ainda navega por código).

// K2: se o Router do Next perder a navegação desta action, o desfecho vem por
// recarga — o porquê e a medição estão no cabeçalho do `ResgateDoEnvio`.
import { useFormStatus } from 'react-dom'

import { ResgateDoEnvio } from '@/components/kit/ResgateDoEnvio'

/** O botão fica DENTRO do form porque `useFormStatus` só enxerga o formulário
 *  que o contém — é assim que ele sabe que o envio está em curso. */
function Botao({
  rotulo,
  rotuloEnviando,
  className,
}: {
  rotulo: string
  rotuloEnviando?: string
  className: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      data-pending={pending ? '' : undefined}
      className={className}
    >
      {pending ? (rotuloEnviando ?? rotulo) : rotulo}
    </button>
  )
}

export function BotaoDeAcao({
  acao,
  campos,
  rotulo,
  rotuloEnviando,
  className = 'btn-ac btn-ac-lg w-full',
  formClassName,
}: {
  /** Server Action que SEMPRE termina em `redirect` (daí o `void`). */
  acao: (formData: FormData) => Promise<void>
  /** os campos escondidos do formulário (id da aula, janela escolhida…) */
  campos: Record<string, string>
  rotulo: string
  rotuloEnviando?: string
  className?: string
  formClassName?: string
}) {
  return (
    <form action={acao} className={formClassName}>
      {Object.entries(campos).map(([nome, valor]) => (
        <input key={nome} type="hidden" name={nome} value={valor} />
      ))}
      <Botao rotulo={rotulo} rotuloEnviando={rotuloEnviando} className={className} />
      <ResgateDoEnvio />
    </form>
  )
}
