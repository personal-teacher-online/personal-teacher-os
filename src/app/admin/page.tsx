// INÍCIO DO ADMIN — dashboard em DOIS ANDARES, na anatomia TutorBird
// (captura 21, clonada em 26/07/2026 com o nosso conteúdo).
//
//   BANDA    lavagem de acento atravessando a largura: saudação + data/hora do
//            negócio, ilustração flat à direita e os 4 cartões do MÊS (dinheiro
//            recebido, previsto, em atraso e o tamanho da escola)
//   HOJE     o que pede ação: a agenda do dia dentro de um card-contêiner e a
//            fila de pendências como cartões clicáveis
//   NEGÓCIO  o que pede leitura: os outros 4 números da pesquisa 07
//
// A separação é física, não decorativa (Jackrabbit: "Key Metrics" × "Alerts" em
// blocos distintos): agir e saber são tarefas diferentes.
//
// O título da página NÃO mora mais aqui: subiu para a barra superior branca do
// shell, que é onde o TutorBird o põe e onde ele fica persistente em toda
// seção. Por isso a `PageBar` saiu desta tela (ela segue no kit, para as telas
// com abas e toolbar do M3).
//
// Zero query aqui — as leituras moram em `src/data/admin/home.ts`. São DUAS
// promessas independentes, criadas sem await: a moldura e a banda pintam na
// hora, cada pedaço entra com o esqueleto dele e, quando o snapshot do negócio
// demora, a agenda do dia já está na tela (revisão adversarial nº 1, C3 — com
// uma promessa só os dois esqueletos caíam juntos e a divisão era teatro).
import { Suspense } from 'react'

import { AndarHoje } from '@/components/admin/inicio/AndarHoje'
import { AndarNegocio } from '@/components/admin/inicio/AndarNegocio'
import { IlustracaoDaBanda, ResumoDoMes, Saudacao } from '@/components/admin/inicio/BandaDeTopo'
import {
  EsqueletoHoje,
  EsqueletoNegocio,
  EsqueletoResumo,
  EsqueletoSaudacao,
} from '@/components/admin/inicio/esqueletos'
import { getAdminHoje, getAdminNegocio, type AdminHoje, type AdminNegocio } from '@/data/admin/home'

export const metadata = { title: 'Início — Admin' }

async function Cumprimento({ promessa }: { promessa: Promise<AdminHoje> }) {
  return <Saudacao hoje={await promessa} />
}

async function Resumo({ promessa }: { promessa: Promise<AdminNegocio> }) {
  return <ResumoDoMes negocio={await promessa} />
}

async function Hoje({ promessa }: { promessa: Promise<AdminHoje> }) {
  return <AndarHoje hoje={await promessa} />
}

async function Negocio({ promessa }: { promessa: Promise<AdminNegocio> }) {
  return <AndarNegocio negocio={await promessa} />
}

export default function AdminInicio() {
  const hoje = getAdminHoje()
  const negocio = getAdminNegocio()

  return (
    // As margens negativas cancelam o respiro do shell: a banda encosta nas
    // duas bordas da coluna de trabalho, como no TutorBird.
    <main className="view-enter -mx-4 -mt-6 flex flex-col md:-mx-6 md:-mt-8">
      {/* DE LATERAL A LATERAL (portão visual do dono, 27/07/2026): o fundo da
          faixa não é mais o `bg-ac-band` desta caixa — que parava no teto de
          1720px da superfície —, é a lavagem de `.faixa-cheia`, que transborda
          para os dois lados e é aparada na borda da área de conteúdo pelo
          `overflow-x-clip` do shell. O CONTEÚDO (saudação, KPIs, ilustração)
          não se mexeu: ele continua nesta caixa, alinhado à coluna. */}
      <section className="faixa-cheia px-4 py-6 md:px-6 md:py-8">
        <div className="flex flex-col gap-6">
          <div className="flex items-start justify-between gap-6">
            <Suspense fallback={<EsqueletoSaudacao />}>
              <Cumprimento promessa={hoje} />
            </Suspense>
            <IlustracaoDaBanda />
          </div>
          <Suspense fallback={<EsqueletoResumo />}>
            <Resumo promessa={negocio} />
          </Suspense>
        </div>
      </section>

      <div className="flex flex-col gap-8 px-4 py-8 md:px-6">
        <Suspense fallback={<EsqueletoHoje />}>
          <Hoje promessa={hoje} />
        </Suspense>
        <Suspense fallback={<EsqueletoNegocio />}>
          <Negocio promessa={negocio} />
        </Suspense>
      </div>
    </main>
  )
}
