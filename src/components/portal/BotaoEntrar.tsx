'use client'

// D1 — O BOTÃO DE ENTRAR NA AULA, com contagem viva (Onda do Portal · P3).
//
// É client component por UMA razão: o rótulo muda sozinho enquanto a página
// fica aberta ("Entrar em 12 min" → "Entrar em 11 min" → botão aceso). Fora
// isso ele não decide nada — quem diz de que aula se trata, qual é o link do
// Meet e como se escreve a hora de começo é o servidor.
//
// LEI 1, e por que ela não é violada aqui: este arquivo só faz aritmética de
// ÉPOCA (`Date.now()` e subtração de milissegundos), que é igual em qualquer
// fuso; a única string com hora ("Entrar às 20:00") chega pronta por prop,
// formatada com Luxon na zona IANA do aluno. Nenhum `new Date(…)`, nenhum
// `toLocale*`, nenhum import de biblioteca de data — a regra de lint
// `ptos/no-client-timezone` continua satisfeita sem exceção assinada.
//
// HIDRATAÇÃO: o primeiro desenho usa o relógio do SERVIDOR (`agoraNoServidorMs`),
// que é o mesmo número no HTML e na hidratação — sem isso, servidor e navegador
// escreveriam minutos diferentes e o React acusaria divergência.
//
// O RELÓGIO QUE MANDA É O DO SERVIDOR (revisão adversarial do P3). Depois de
// montado, o componente precisa de um relógio que ANDE — e o único que anda no
// navegador é o do aparelho, que pode estar horas errado (celular com data
// manual, tablet velho, relógio parado). Usá-lo cru abria e fechava a porta da
// aula fora da hora: adiantado, o botão sumia com a professora ainda na sala;
// atrasado, ficava aceso muito antes. Na montagem o componente mede o DESVIO
// (`servidor − aparelho`) e soma esse desvio em todos os ticks: o relógio que
// anda é o do aparelho, mas a hora que ele marca é a do servidor.
//
// COM UM PISO (revisão adversarial 2 · D4): a medida do desvio inclui o tempo
// de viagem da página, então desvio PEQUENO é latência, não relógio errado —
// e corrigi-lo desloca a porta da aula pelo tempo que a página demorou a
// chegar. Só acima de `DESVIO_MINIMO_DO_RELOGIO_MS` a correção entra.
//
// `prefers-reduced-motion` não muda nada por aqui: a contagem é troca de TEXTO,
// não animação — não há movimento a reduzir.
import { useEffect, useState } from 'react'

import {
  DESVIO_MINIMO_DO_RELOGIO_MS,
  INTERVALO_DA_CONTAGEM_MS,
  estadoDoBotao,
  minutosParaComecar,
  rotuloDoBotao,
} from '@/lib/portal/entrar'

export function BotaoEntrar({
  startsAtEpochMs,
  endsAtEpochMs,
  agoraNoServidorMs,
  horaDoComeco,
  meetUrl,
}: {
  startsAtEpochMs: number
  endsAtEpochMs: number
  /** relógio do servidor no desenho inicial — evita divergência de hidratação */
  agoraNoServidorMs: number
  /** "20:00", já na zona do aluno (Lei 1: quem formata é o servidor) */
  horaDoComeco: string
  meetUrl: string
}) {
  const [agora, setAgora] = useState(agoraNoServidorMs)

  useEffect(() => {
    // SÓ DESVIO GRANDE É RELÓGIO ERRADO (revisão adversarial 2 · D4). A medida
    // abaixo carrega junto TODO o tempo entre o render do servidor e esta
    // linha — fila, streaming, rede, parse. Aplicá-la crua fazia a latência da
    // página virar correção de relógio: 70 s de página lenta abriam a porta da
    // aula ~100 s depois do fim dela. Abaixo do limiar, o relógio do aparelho
    // manda; acima, ele está errado de verdade e o do servidor assume.
    const medido = agoraNoServidorMs - Date.now()
    const desvio = Math.abs(medido) > DESVIO_MINIMO_DO_RELOGIO_MS ? medido : 0
    const marcar = () => setAgora(Date.now() + desvio)
    marcar()
    const id = setInterval(marcar, INTERVALO_DA_CONTAGEM_MS)
    return () => clearInterval(id)
  }, [agoraNoServidorMs])

  const estado = estadoDoBotao(agora, startsAtEpochMs, endsAtEpochMs)
  // Aula acabada com a página ainda aberta: o botão some, exatamente como o
  // servidor faria num carregamento novo.
  if (estado === 'encerrado') return null

  const rotulo = rotuloDoBotao(estado, minutosParaComecar(agora, startsAtEpochMs), horaDoComeco)

  if (estado === 'aberto') {
    return (
      <a
        href={meetUrl}
        target="_blank"
        rel="noreferrer"
        className="btn-ac btn-ac-lg w-full"
        data-estado="aberto"
      >
        {rotulo}
      </a>
    )
  }

  return (
    <button type="button" disabled className="btn-ac btn-ac-lg w-full" data-estado="cedo">
      {rotulo}
    </button>
  )
}
