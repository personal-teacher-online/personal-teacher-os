// NOVO CONTRATO (Onda 1 · M4-3) — o wizard, num endereço próprio.
//
// POR QUE ROTA, e não um `?novo=` do índice: o wizard tem seis etapas e um
// estado grande; um endereço só para ele é linkável ("manda o link que eu crio o
// contrato"), sobrevive ao F5 e permite ao botão da lista pré-escolher o tipo
// (`?tipo=grupo`). É o mesmo precedente da aba Convites no M3-3 — rota irmã em
// vez de mais uma dimensão de query na tela vizinha.
//
// O ÍNDICE POR BAIXO: a página desenha a lista de contratos e, POR CIMA dela, o
// Sheet aberto. É o gesto do TutorBird (o painel abre sobre a tela de onde se
// veio, e fechá-lo devolve o contexto), e é por isso que o ✕ leva de volta para
// `/admin/alunos/contratos`. Quem chega pelo link direto vê a mesma coisa.
//
// Zero query nesta página: quem lê é `getNewContractContext` (a camada de
// dados). Zero `?msg=`: a criação devolve `ResultadoDaAcao` e quem fala é o
// toast do kit (ADR-025).

import { PainelDeUrl } from '@/components/kit/painel-de-url'
import { getNewContractContext } from '@/data/admin/contratos'
import { ehRamoDeContrato } from '@/data/admin/contrato-novo'
import ContratosDoHub from '../../alunos/contratos/page'
import { WizardDeContrato } from './WizardDeContrato'

export const metadata = { title: 'Novo contrato — Admin' }

export default async function NovoContratoPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string }>
}) {
  const sp = await searchParams
  const tipo = ehRamoDeContrato(sp.tipo) ? sp.tipo : null
  const contexto = await getNewContractContext()

  return (
    <>
      {/* O ÍNDICE, tal e qual — o mesmo componente da rota irmã, com os filtros
          no estado padrão. Renderizar a lista de novo (em vez de recortar um
          pedaço dela para cá) é o que garante que o fundo do painel seja
          exatamente a tela de onde se veio. */}
      <ContratosDoHub searchParams={Promise.resolve({})} />
      <PainelDeUrl
        titulo="Novo contrato"
        descricao="Seis etapas — tipo, aluno, horários, valores, política e revisão. Nada é criado até a última."
        voltarPara="/admin/alunos/contratos"
        // `bruto`: o wizard monta o próprio corpo e o RODAPÉ FIXO (o rodapé só é
        // fixo estando fora da área que rola, e o `<form>` precisa envolver os
        // dois para a validação inline do kit ver os campos).
        bruto
      >
        <WizardDeContrato contexto={contexto} tipoInicial={tipo} />
      </PainelDeUrl>
    </>
  )
}
