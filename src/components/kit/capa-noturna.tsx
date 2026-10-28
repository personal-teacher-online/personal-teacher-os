// A CAPA NOTURNA — o esqueleto das telas de FORA do portal (Onda do Portal · P5).
//
// Quatro páginas vivem fora das duas molduras do produto (o `AdminShell` e o
// `PortalShell`): login, recuperar senha, criar senha do convite e convite
// expirado. Elas são a tela âncora da marca (Design.md: fog CSS pleno + vidro +
// Bricolage), e as quatro repetiam o MESMO bloco de layout copiado à mão —
// `<main>` escuro, fundo de névoa, logo centralizada, cartão de vidro.
//
// Este componente é esse bloco, uma vez só. Ele NÃO é uma direção visual nova: o
// que ele faz é dar um lugar único ao que já existia, para que a comparação do
// P6 (D11 — a proposta nova de login ao lado da capa consolidada) mexa em um
// arquivo e não em quatro, e para que a capa consolidada, que vence por padrão,
// continue idêntica enquanto isso.
//
// ESCOPO DESTE LOTE: `/definir-senha` e `/convite-expirado` (as duas telas do
// P5). `/login` e `/recuperar-senha` são do P6 e ficam como estão — migrá-las
// agora mexeria, sem necessidade, justamente na tela que está em disputa.
//
// `FogGL` é OPCIONAL: a névoa em WebGL é um enfeite caro, e as telas de
// interrupção (convite expirado) nunca a tiveram.
import Image from 'next/image'
import type { ReactNode } from 'react'

import { FogBackground } from '@/components/FogBackground'
import { FogGL } from '@/components/FogGL'

export function CapaNoturna({
  /** título da tela — o `h1`, na tipografia da âncora */
  titulo,
  /** a frase de apoio abaixo do título */
  subtitulo,
  /** névoa em WebGL por cima da de CSS (só nas telas âncora) */
  fogGL = false,
  children,
}: {
  titulo: string
  subtitulo?: ReactNode
  fogGL?: boolean
  children: ReactNode
}) {
  return (
    <main className="relative flex min-h-dvh w-full flex-col items-center justify-center bg-bg-900 px-4 py-10 [color-scheme:dark]">
      <FogBackground rich vignette={false} />
      {fogGL && <FogGL />}

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-10 flex justify-center">
          <Image
            src="/brand/logo-branco.png"
            alt="Personal Teacher"
            width={210}
            height={105}
            className="h-auto w-44"
            priority
          />
        </div>

        <div className="glass p-8">
          <h1 className="font-display text-3xl font-extralight text-text-hi">{titulo}</h1>
          {subtitulo && <p className="mt-2 text-sm text-text-mid">{subtitulo}</p>}
          {children}
        </div>
      </div>
    </main>
  )
}

/** O campo de texto da capa — o mesmo par de classes que as quatro telas usam. */
export const campoNoturno =
  'w-full rounded-input border border-hairline bg-wash px-4 py-3 text-text-hi ' +
  'placeholder:text-text-mid outline-none transition-colors focus:border-accent-turquoise'

/**
 * O RECADO DA CAPA, nos dois tons.
 *
 * `role="status"` porque é resposta a um ato da pessoa (envio do formulário) e
 * quem usa leitor de tela precisa ouvi-lo sem procurar. A cor sozinha nunca é o
 * sinal: o texto diz o que aconteceu.
 */
export function AvisoNoturno({ tom, children }: { tom: 'ok' | 'erro'; children: ReactNode }) {
  return (
    <p
      role="status"
      className={`mt-4 rounded-card border p-3 text-sm text-text-hi ${
        tom === 'erro'
          ? 'border-night-danger/35 bg-night-danger/12'
          : 'border-hairline bg-accent-turquoise/10'
      }`}
    >
      {children}
    </p>
  )
}
