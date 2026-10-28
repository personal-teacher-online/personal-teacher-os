'use client'

// Botão "Gerar agora" (M2, ADR-031). A action é SÍNCRONA — a chamada ao Claude
// leva dezenas de segundos —, então o pending precisa ser explícito: sem ele a
// Teacher Vicky clica de novo achando que não pegou. O clique repetido não gera dois
// rascunhos (o claim condicional do banco recusa o segundo — Lei 3), mas o
// botão desabilitado evita a confusão antes de ela existir.
//
// Sem ResgateDoEnvio aqui, de propósito: a rede do ADR-030 recarrega a página
// depois de 3s se o commit do React se perder, e esta ação legitimamente demora
// muito mais que isso — a recarga abortaria o POST em curso (preço 1 declarado
// no cabeçalho do ResgateDoEnvio). O desfecho chega pelo redirect da action.

import { useFormStatus } from 'react-dom'
import { btnBrandSm } from '@/components/ui'

export function GerarAgoraBotao({ tentativas }: { tentativas: number }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className={btnBrandSm}
      title="Escreve o roteiro com a voz da marca ativa. Leva alguns segundos."
    >
      {pending
        ? 'Gerando o roteiro… (alguns segundos)'
        : tentativas > 0
          ? `Gerar de novo (tentativa ${tentativas + 1})`
          : 'Gerar agora'}
    </button>
  )
}
