// AJUSTES — a seção Q2, que nasce aqui (Onda da Agenda · A8).
//
// ANATOMIA (clonagem TutorBird): card-contêiner com ABAS, uma por bloco. Os
// quatro blocos são o que o dono pediu, na ordem em que ele os pediu:
//
//   Política de remarcação  ← o único que EDITA (por professora) + o índice,
//                             em leitura, dos contratos fora do padrão
//   Janelas                 ← aponta para a camada de disponibilidade da Agenda
//   Mensagens               ← catálogo em leitura do que a escola dispara
//   Integrações             ← estado honesto de cada parceiro
//
// O TÍTULO não mora aqui: vive na barra branca do shell, derivado do trilho
// (`tituloDaRota` — `AJUSTES.href` passou a apontar para esta rota no A8, e
// `/admin/janelas` virou redirect para cá).
//
// POR QUE ABAS, E NÃO QUATRO CARTÕES EMPILHADOS (decisão de rotina, registrada
// no relatório): o catálogo de mensagens sozinho tem 17 mensagens com assunto e
// corpo. Empilhado, o bloco de Integrações — que é o que se abre com pressa,
// quando alguma coisa parou de chegar — ficaria a uma rolagem de celular de
// distância dos outros três. A aba é endereço (`?bloco=`), sobrevive ao F5 e ao
// link colado, e é a mesma peça (`CardPanelTabs`) que o hub de Alunos usa.
//
// O QUE ESTA TELA NÃO DUPLICA, DE PROPÓSITO:
// · editor de janela — ele existe na Agenda (A3) e duas fontes de verdade para
//   a mesma semana é como elas divergem. O bloco 2 é uma ponte, não uma cópia;
// · editor de regra de contrato — ele existe na ficha do contrato. O índice
//   daqui só APONTA o que está fora do padrão, com o link para lá;
// · texto de mensagem — catálogo em leitura (decisão do dono, 28/07).
//
// Zero query nesta página: quem lê é `src/data/admin/ajustes.ts` — e é lá que
// mora o porteiro (`requireAdminId`), porque o bloco de integrações precisa do
// cliente de serviço para ler a caixa de avisos dos parceiros.
//
// O DESFECHO DA AÇÃO NÃO VEM DA URL (Sol · rodada 1 do A8, grave 3). Esta tela
// nasceu usando `?msg=…&n=…`, que é a ponte de convivência das telas VELHAS —
// e, no caminho de falha, publicava o erro cru do Postgres na barra de
// endereços. Agora a action grava a frase num cookie de vida curta
// (`@/lib/kit/recado`, peça do kit desde o A5 — parametrizada por SEÇÃO) e a
// página a entrega ao mesmo `AvisoLegado` do kit, que já faz as duas metades:
// toast com JavaScript, faixa `<noscript>` sem ele. A URL desta tela carrega SÓ
// `?bloco=` — geometria, nunca recado.

import { DateTime } from 'luxon'

import { AvisoLegado } from '@/components/kit/aviso-legado'
import { CardPanel, CardPanelTabs } from '@/components/kit/card-panel'
import {
  BlocoDaPolitica,
  BlocoDasIntegracoes,
  BlocoDasJanelas,
  BlocoDasMensagens,
} from '@/components/admin/ajustes/blocos'
import { getAjustes } from '@/data/admin/ajustes'
import {
  BLOCOS,
  BLOCO_PADRAO,
  BLOCO_ROTULO,
  ehBloco,
  enderecoDoBloco,
  type BlocoDosAjustes,
} from '@/data/admin/ajustes-gramatica'
import { lerRecado } from '@/lib/kit/recado'

export const metadata = { title: 'Ajustes — Admin' }

type ValorDaQuery = string | string[] | undefined
function primeiro(v: ValorDaQuery): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function AjustesPage({
  searchParams,
}: {
  searchParams: Promise<{ bloco?: ValorDaQuery }>
}) {
  const sp = await searchParams
  const cru = primeiro(sp.bloco)
  // Aba desconhecida na URL cai no bloco padrão — endereço digitado à mão nunca
  // desenha uma tela vazia.
  const bloco: BlocoDosAjustes = ehBloco(cru) ? cru : BLOCO_PADRAO

  const [recado, dados] = await Promise.all([lerRecado('ajustes'), getAjustes()])

  return (
    <>
      {recado && <AvisoLegado mensagem={recado.mensagem} chave={recado.id} />}

      <CardPanel>
        <CardPanelTabs
          tabs={BLOCOS.map((b) => ({
            label: BLOCO_ROTULO[b],
            href: enderecoDoBloco(b),
            active: b === bloco,
          }))}
        />
        <div className="p-5">
          {bloco === 'politica' && <BlocoDaPolitica dados={dados} />}
          {bloco === 'janelas' && <BlocoDasJanelas professoras={dados.professoras} />}
          {bloco === 'mensagens' && <BlocoDasMensagens agora={DateTime.now()} />}
          {bloco === 'integracoes' && <BlocoDasIntegracoes bloco={dados.integracoes} />}
        </div>
      </CardPanel>
    </>
  )
}
