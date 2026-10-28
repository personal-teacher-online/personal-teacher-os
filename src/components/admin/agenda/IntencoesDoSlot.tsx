'use client'

// AS TRÊS INTENÇÕES DO SLOT VAZIO (Onda da Agenda · A4).
//
// O que morreu aqui: o balão da meia-hora vazia oferecia UMA coisa só —
// "Publicar horário" — e só quando o botão "com janelas" estava LIGADO. Tocar
// num vazio é a pergunta mais frequente da agenda ("o que vai acontecer aqui?"),
// e a tela respondia com a menos frequente das três respostas.
//
// Agora o balão oferece as TRÊS INTENÇÕES do horário vazio, cada uma com a
// CONSEQUÊNCIA escrita:
//   1. Aula — dois caminhos: avulsa para quem JÁ é aluno
//      (`admin_create_single_class`) e experimental para pessoa NOVA
//      (`admin_create_trial_class`);
//   2. Horário aberto — janela de remarcação publicada
//      (`publish_reschedule_window`);
//   3. Bloqueio — professora indisponível (`add_teacher_block`).
//
// AS FRASES DE CONSEQUÊNCIA SÃO CONFERIDAS, NUNCA INVENTADAS (ver
// `CONSEQUENCIA`, abaixo): cada uma foi lida na migration da função que ela
// descreve, e o teste `tests/onda-agenda-a4.test.ts` amarra frase × RPC. Frase
// errada aqui é pior que frase nenhuma — a dona decide com base nela e o
// dinheiro segue a decisão.
//
// ── O FUSO É O ASSUNTO CENTRAL DESTE ARQUIVO (Sol · rodada 1 do A4, grave 3) ─
// Duas das quatro intenções gravam data e hora num fuso que NÃO é o da grade:
// `admin_create_single_class` lê no fuso do ALUNO (slot ativo do contrato, senão
// o cadastro dele) e `admin_create_trial_class` no fuso da PESSOA NOVA. A
// primeira versão avisava isso por escrito e deixava os campos com os MESMOS
// ALGARISMOS do slot de Cuiabá — ou seja, avisava do buraco e empurrava para
// dentro dele. Agora escolher o contrato (ou a cidade) RECALCULA data e hora
// para o equivalente local daquele fuso, o seletor mostra a cidade junto do
// nome, e o cabeçalho para de afirmar "Cuiabá" quando os campos estão noutro
// relógio. A conversão é do DIA ESPECÍFICO (Lei 1): o servidor manda o instante
// UTC do slot pronto e `equivalente-no-fuso.ts` o lê na zona escolhida.
//
// POR QUE ESTE ARQUIVO É CLIENTE (e a dívida do A2, que segue ABERTA):
// o A2 declarou "custo multiplicativo dos Popover Roots — dívida para o A4".
// O QUE FOI MEDIDO (`tests/onda-agenda-a4.test.ts` §medição), e só isto: a grade
// monta **224** Popover Roots numa semana cheia (196 do desktop + 28 do dia
// móvel), e o CONTEÚDO servido por slot caiu de um mini-form inteiro (10
// elementos React / 1.469 bytes de HTML por slot, medidos) para 4 props de
// string (~140 bytes) — a lista de contratos e a de professoras existem uma vez
// só, no provedor.
// ⚠️ O QUE **NÃO** FOI MEDIDO (Sol · rodada 2 do A4, menor 1): tempo de
// hidratação, número de listeners e memória dos 224 Roots. Dizer que "Root +
// Trigger são baratos" era CONJECTURA vestida de conclusão — o que se sabe é que
// o custo de CONTEÚDO parou de multiplicar. A dívida de PERFORMANCE dos Roots
// continua ABERTA, e o que a fecha é medição de runtime num celular real (a
// mesma lição do hotfix do iPhone: harness não é aparelho). Os 224 Roots ficam
// por ora porque o gatilho por slot é o que preserva âncora e devolução de foco
// do Radix — trocar isso sem medir seria a mesma conjectura, do outro lado.
//
// Régua de legibilidade (AGENTS.md): o RÓTULO da intenção e a FRASE DE
// CONSEQUÊNCIA são DADO — é a frase que muda a decisão —, então os dois ficam
// no piso literal (`text-sm`, `text-ink-900`); o que os distingue é o PESO
// (semibold × medium), nunca a cor apagada. Os rótulos que carregam FUSO e VALOR
// entram no mesmo piso pelo `CampoDeDado` (médio 5).

import { createContext, useContext, useState, type ReactNode } from 'react'

import {
  addTeacherBlockAction,
  createSingleClassAction,
  createTrialClassAction,
  publishWindowAction,
} from '@/app/admin/agenda/actions'
import { DateField } from '@/components/DateField'
import { TETO_DO_CORPO_DO_BALAO } from '@/lib/kit/balao'
import { Field, input } from '@/components/ui'
// `ehIntencaoDoSlot` saiu do import junto com a re-exportação que morreu (ver a
// lápide logo abaixo): sem consumidor aqui, ele só deixava um aviso de lint.
import { INTENCOES_DO_SLOT, type IntencaoDoSlot } from '@/lib/admin/intencoes-do-slot'
import { diaCivilNoFuso, diaEmBr } from './equivalente-no-fuso'
import { CampoDeDado } from './TipoEValorDaAvulsa'
import {
  Atencao,
  CamposDaAvulsa,
  CamposDaExperimental,
  CIDADE_DO_NEGOCIO,
  FUSO_DO_NEGOCIO,
  SeletorDeProfessora,
  type ContratoDoSlot,
  type FusoDeclarado,
  type ProfessoraDoSlot,
} from './campos-de-aula'

// Os campos das duas aulas moram em `campos-de-aula.tsx`: o painel `?novo=` usa
// a MESMA peça (Sol · rodada 2 do A4, grave 3 — a porta legada criava a aula
// fora do ponto tocado porque não recalculava nada).
export type { ContratoDoSlot, ProfessoraDoSlot }

// O VOCABULÁRIO MORA NUM MÓDULO PURO (A7): `si` virou geometria de URL, e quem
// a valida é o SERVIDOR (`@/lib/admin/transporte-da-agenda`). Importar esta peça
// cliente só para ler quatro strings arrastaria o balão inteiro para o grafo do
// servidor — as duas pontas leem a mesma lista de `intencoes-do-slot.ts`.
// A re-exportação de `ehIntencaoDoSlot` daqui MORREU (1ª execução do e2e,
// 30/07): o servidor a importava por este arquivo 'use client' e estourava em
// runtime. Função compartilhada se importa do módulo puro, nunca do componente.
export type { IntencaoDoSlot }
export const INTENCOES = INTENCOES_DO_SLOT

/** O nome da porta. */
export const ROTULO: Record<IntencaoDoSlot, string> = {
  avulsa: 'Aula avulsa — para quem já é aluno',
  experimental: 'Aula experimental — para pessoa nova',
  horario: 'Horário aberto para remarcação',
  bloqueio: 'Bloqueio — a professora não atende',
}

/**
 * O QUE ACONTECE SE ELA CONFIRMAR — uma frase por porta, cada uma conferida
 * contra o corpo da função do Postgres que a executa. A fonte de cada afirmação:
 *
 * · `avulsa` → `admin_create_single_class` (definição EFETIVA em 20260730000100): exige contrato
 *   `private_1on1` ATIVO; `extra_paid` exige `p_price_cents > 0`; a função NÃO
 *   toca em `makeup_ledger` nem em `reschedule_usage` (nada de crédito, nada de
 *   franquia); a aula nasce
 *   `scheduled` e, por ser `class_instance` da professora, entra em
 *   `_teacher_payable_hours` (20260713000600) — o extrato dela conta a hora
 *   mesmo na cortesia. A data/hora são lidas no fuso do ALUNO (slot ativo do
 *   contrato, senão o do aluno), NUNCA em Cuiabá — daí o recálculo do
 *   formulário.
 *   ✅ "CORTESIA É GRATUITA" VOLTOU A SER GARANTIA DO BANCO (A6/b, migration
 *   `20260730000100`). Histórico, porque a frase mudou duas vezes: até a
 *   migration 97 a função só recusava valor AUSENTE na extra e nunca valor
 *   PRESENTE na cortesia — `single_price_cents` entrava como veio, e quem
 *   impedia o preço de viajar era o `TipoEValorDaAvulsa`, que DESMONTA o campo
 *   (grave 1 da rodada 1 do A4). Um envio forjado gravava cortesia com preço, e
 *   por isso a frase passou a dizer ONDE morava a garantia (Sol · rodada 2 do
 *   A4, grave 5a). Agora existem as DUAS travas: o CHECK
 *   `class_instances_courtesy_sem_preco` e a recusa com frase na RPC — e a
 *   action nem manda preço quando o tipo é cortesia.
 *
 * · `experimental` → `admin_create_trial_class` (definição EFETIVA em
 *   20260730000100): cria a pessoa
 *   com `tz_confirmed = false`, um contrato `is_trial` ("Aula experimental",
 *   franquia 0) e a aula, na mesma transação; não há `recurring_slots`, logo
 *   não há horário fixo nem semanas geradas. O valor vira `hourly_rate_cents`
 *   do contrato leve (em branco = 0). A hora também conta no extrato.
 *
 * · `horario` → `publish_reschedule_window` + o consumo em
 *   `book_reschedule_window` (definições EFETIVAS em 20260730000100): a janela é
 *   da professora e só os alunos DELA a veem; o consumo recusa janela a mais de
 *   14 dias; a janela vira `consumida`.
 *   ⚠️ O CUSTO DEPENDE DE QUAL DAS DUAS PORTAS o aluno usa (Sol · rodada 2 do
 *   A4, grave 5b — a frase antiga só descrevia uma):
 *     · REMARCANDO uma aula (`p_instance`) → `reschedule_class_at` gasta a
 *       franquia do mês (`monthly_reschedule_allowance`) e, quando ela acaba,
 *       um crédito (`spend_makeup`);
 *     · RESGATANDO um crédito (`p_contract`, aluno sem aula para trocar) → a
 *       função chama `spend_makeup` SEMPRE, franquia nenhuma no caminho.
 *   Dizer só "gasta a franquia e depois o crédito" descrevia metade do que a
 *   janela publicada permite.
 *
 * · `bloqueio` → `add_teacher_block` (definição EFETIVA em 20260730000100):
 *   grava a exceção `kind='block'` de `p_from` 00:00 até `p_to + 1` 00:00 no
 *   fuso DA PROFESSORA (dia civil inteiro — a hora do slot não entra na conta),
 *   e `_teacher_available_for` passa a recusar horário novo no período. As aulas
 *   já marcadas NÃO são tocadas pela função.
 *   ✅ E O FECHO DA OFERTA JÁ PUBLICADA CHEGOU (A6/f+e). Histórico: até a
 *   migration 97 o bloqueio NÃO cancelava janela de remarcação já publicada e
 *   `book_reschedule_window` não olhava disponibilidade nenhuma — o aluno com a
 *   tela de confirmação aberta reservava dentro do dia bloqueado, gastando
 *   franquia ou crédito (Sol · rodada 1 do A4, grave 2), e a frase tinha de
 *   ensinar o gesto manual de despublicar. Agora `add_teacher_block` cancela as
 *   janelas PUBLICADAS do período na MESMA transação, e a reserva ganhou o cinto
 *   do bloqueio criado depois da publicação. Continua fora de propósito: janela
 *   `consumida` (já virou aula) e aula marcada (destino é o tratamento de
 *   período).
 */
export const CONSEQUENCIA: Record<IntencaoDoSlot, string> = {
  avulsa:
    'Marca uma aula extra fora do horário fixo do aluno. Não gasta crédito de reposição nem a franquia de remarcação do mês, e a hora conta no extrato da professora. Extra cobrada exige valor. Cortesia é gratuita: esta tela não oferece campo de valor, e o banco recusa cortesia com valor. Data e hora valem no fuso DO ALUNO — escolha o contrato e os campos se ajustam sozinhos.',
  experimental:
    'Cria a pessoa, um contrato experimental leve e a aula num ato só — sem horário fixo e sem gerar as próximas semanas. O fuso dela nasce "a confirmar"; valor em branco = aula gratuita. A hora conta no extrato da professora.',
  horario:
    'Publica este horário para os alunos desta professora remarcarem sozinhos, e o horário sai da oferta quando alguém pegar. Quem estiver REMARCANDO uma aula gasta a franquia do mês — ou, se ela já acabou, um crédito de reposição. Quem estiver RESGATANDO (aluno sem aula para trocar) gasta sempre um crédito, mesmo com franquia sobrando. Só é reservável até 2 semanas à frente.',
  bloqueio:
    'Fecha a oferta de horários NOVOS da professora nos dias escolhidos — dia inteiro, no fuso dela, e não só esta meia-hora. As aulas já marcadas continuam de pé: para tratá-las, use Período ou férias. E o horário de remarcação JÁ PUBLICADO no período sai da oferta na hora, junto com o bloqueio — nenhum aluno consegue reservá-lo.',
}

/** O texto do botão que EXECUTA cada intenção. */
const CONFIRMAR: Record<IntencaoDoSlot, string> = {
  avulsa: 'Criar aula avulsa',
  experimental: 'Criar experimental',
  horario: 'Publicar horário',
  bloqueio: 'Criar bloqueio',
}

/** Botão do balão no piso de AÇÃO da régua (texto ≥ `text-sm`). O `btnInkSm`
 *  do kit força `!text-xs` — abaixo do piso; reformá-lo vale para o site
 *  inteiro e segue como dívida de kit (mesma nota do `btnInkA3` do A3). */
const btnDoBalao = 'btn-ink !min-h-9 !px-3.5 !py-1.5 !text-sm w-full'

export interface DadosDoSlot {
  /** para onde a action volta no SUCESSO (a seção, com o balão fechado) */
  self: string
  professoras: ProfessoraDoSlot[]
  /** filtro da barra: quando existe, as intenções já sabem de quem é o horário */
  professoraFiltrada: string | null
  /** opções da aula avulsa (contrato particular ativo) */
  contratos: ContratoDoSlot[]
  /** o que a dona digitou e voltou no COOKIE de rascunho depois de um erro */
  digitado: Record<string, string>
  /** 'yyyy-LL-ddTHH:mm' do slot que precisa REABRIR depois de um erro */
  slotDoErro: string | null
  /** a intenção que estava aberta quando deu erro */
  intencaoDoErro: IntencaoDoSlot | null
}

const Contexto = createContext<DadosDoSlot | null>(null)

/**
 * O provedor mora UMA vez, em volta da grade — é ele que faz o custo do balão
 * parar de multiplicar por 224 (ver o cabeçalho). O `children` continua sendo
 * árvore de SERVIDOR: componente cliente com filhos do servidor é o padrão RSC
 * de sempre, e o Popover vive num portal do Radix, que preserva o contexto.
 */
export function ProvedorDoSlot({ dados, children }: { dados: DadosDoSlot; children: ReactNode }) {
  return <Contexto.Provider value={dados}>{children}</Contexto.Provider>
}

function useDados(): DadosDoSlot {
  const d = useContext(Contexto)
  if (!d) throw new Error('IntencoesDoSlot fora do ProvedorDoSlot')
  return d
}

/* -------------------------------------------------------------------------- */
/* O contexto DAQUELE balão                                                     */
/* -------------------------------------------------------------------------- */

interface ContextoDoBalao {
  iso: string
  hhmm: string
  /** instante UTC do slot, calculado no SERVIDOR com Luxon (Lei 1) */
  instanteUtc: string
  /**
   * O QUE FOI DIGITADO — e SÓ dentro do slot que falhou (Sol · rodada 1 do A4,
   * grave 4). Antes, só a ABERTURA era condicionada ao slot do erro: os
   * formulários liam `d.digitado` incondicionalmente, então a dona fechava o
   * balão das 14:00 que falhou, tocava 15:00, escolhia "avulsa" — e o
   * formulário nascia com `local_time=14:00`. Ela criava de novo às 14:00
   * achando que criava às 15:00. Qualquer slot que não seja o do erro recebe
   * `{}` aqui.
   */
  digitado: Record<string, string>
  /** avisa o cabeçalho em que fuso — e com que valores — os campos estão */
  declararFuso: (f: FusoDeclarado | null) => void
}

const VAZIO: Record<string, string> = {}
const DoBalao = createContext<ContextoDoBalao | null>(null)
function useBalao(): ContextoDoBalao {
  const b = useContext(DoBalao)
  if (!b) throw new Error('formulário do slot fora do balão')
  return b
}

/** A URL de volta do ERRO: a MESMA tela, com o balão daquele slot reaberto na
 *  intenção que falhou. Ela carrega SÓ geometria de tela — qual meia-hora e
 *  qual intenção. O que a dona digitou viaja no cookie de rascunho (grave 5). */
export function urlDoSlotComErro(
  self: string,
  iso: string,
  hhmm: string,
  qual: IntencaoDoSlot,
): string {
  return `${self}${self.includes('?') ? '&' : '?'}slot=${iso}T${hhmm}&si=${qual}`
}

/** A chave de um slot na URL — 'yyyy-LL-ddTHH:mm' no fuso do NEGÓCIO. */
export function chaveDoSlot(iso: string, hhmm: string): string {
  return `${iso}T${hhmm}`
}

/* ========================================================================== */
/* Peças compartilhadas                                                        */
/* ========================================================================== */

/** O seletor de professora do balão — a peça compartilhada, alimentada pelo
 *  contexto (o painel `?novo=` a usa com as mesmas props, vindas do servidor). */
function SeletorDoBalao(props: {
  valor: string
  aoMudar: (id: string) => void
  comFuso?: boolean
}) {
  const d = useDados()
  return (
    <SeletorDeProfessora
      professoras={d.professoras}
      professoraFiltrada={d.professoraFiltrada}
      {...props}
    />
  )
}

/**
 * Os ocultos que todo formulário do balão carrega: para onde voltar no sucesso e
 * para onde voltar no erro. E SÓ ISSO (A7).
 *
 * O que morreu aqui: `manter` (a lista dos campos que sobrevivem ao erro) e
 * `rascunho` (a identidade sob a qual eles são guardados). Os dois eram dados do
 * CLIENTE numa decisão do servidor — a lista agora é `CAMPOS_DA_PORTA` e a
 * identidade é DERIVADA do próprio `back_erro` (`slot` + `si` → `chaveDoBalao`),
 * em `@/lib/admin/transporte-da-agenda`.
 *
 * A garantia que a derivação compra é a que faltava: escritor e leitor do
 * rascunho não têm como divergir. Antes, `back_erro` e `rascunho` eram duas
 * strings montadas em lugares diferentes e nada obrigava as duas a falarem do
 * mesmo slot — divergir devolvia o balão VAZIO, em silêncio, depois de a dona
 * ter digitado tudo.
 */
function Ocultos({ qual }: { qual: IntencaoDoSlot }) {
  const d = useDados()
  const { iso, hhmm } = useBalao()
  return (
    <>
      <input type="hidden" name="back" value={d.self} />
      <input type="hidden" name="back_erro" value={urlDoSlotComErro(d.self, iso, hhmm, qual)} />
    </>
  )
}

/* ========================================================================== */
/* O balão                                                                     */
/* ========================================================================== */

export function IntencoesDoSlot({
  iso,
  hhmm,
  titulo,
  instanteUtc,
}: {
  /** dia civil do slot, 'yyyy-LL-dd' no fuso do negócio */
  iso: string
  /** 'HH:mm' no fuso do negócio */
  hhmm: string
  /** o dia já ESCRITO pelo servidor ("seg, 04/08") — cliente não formata data */
  titulo: string
  /** o mesmo instante em UTC, calculado no servidor (Lei 1) — é dele que sai o
   *  equivalente local de qualquer outro fuso */
  instanteUtc: string
}) {
  const d = useDados()
  const restaurar = d.slotDoErro === chaveDoSlot(iso, hhmm)
  const [qual, setQual] = useState<IntencaoDoSlot | null>(restaurar ? d.intencaoDoErro : null)
  const [fuso, setFuso] = useState<FusoDeclarado | null>(null)

  const contexto: ContextoDoBalao = {
    iso,
    hhmm,
    instanteUtc,
    // GRAVE 4: o valor restaurado existe SÓ dentro do slot que falhou.
    digitado: restaurar ? d.digitado : VAZIO,
    declararFuso: setFuso,
  }

  // O QUE ESTÁ NOS CAMPOS, quando eles não estão em Cuiabá.
  //
  // MÉDIO 1 (Sol · rodada 2): isto era recalculado do ponto tocado
  // (`equivalenteNoFuso(instanteUtc, …)`), e não lido do formulário. A dona
  // corrigia 15:00 para 16:00 e o cabeçalho continuava anunciando 15:00 —
  // resumo que contradiz o campo logo abaixo é pior que resumo nenhum. Agora
  // quem declara é a própria peça de campos, com o valor REAL.
  const noFusoDoCampo = fuso && fuso.iana !== FUSO_DO_NEGOCIO ? fuso : null

  return (
    // Teto de altura com rolagem PRÓPRIA: o balão vive num portal com posição
    // fixa, então um formulário mais alto que a tela do celular seria
    // inalcançável — a página não rola por baixo dele. E o teto respeita o
    // espaço MEDIDO entre a âncora e a borda da tela, não só `70vh` (A9, 30/07 —
    // lápide em `TETO_DO_CORPO_DO_BALAO`).
    <div className={`flex flex-col gap-3 ${TETO_DO_CORPO_DO_BALAO}`}>
      {/* QUAL horário está sendo decidido: DADO, e o primeiro dado do balão.
          Quando o formulário aberto grava noutro fuso, o cabeçalho PARA de
          afirmar que aquilo é Cuiabá e mostra os dois relógios lado a lado
          (Sol · rodada 1 do A4, grave 3). */}
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold text-ink-900">
          {titulo} às {hhmm}{' '}
          <span className="font-medium text-ink-600">
            {noFusoDoCampo ? `— o ponto tocado na grade (${CIDADE_DO_NEGOCIO})` : `(${CIDADE_DO_NEGOCIO})`}
          </span>
        </p>
        {noFusoDoCampo && (
          <p className="text-sm font-semibold text-ink-900">
            Nos campos: {noFusoDoCampo.data ? diaEmBr(noFusoDoCampo.data) : '—'} às{' '}
            {noFusoDoCampo.hora || '—'} — hora de {noFusoDoCampo.cidade}
          </p>
        )}
      </div>

      <DoBalao.Provider value={contexto}>
        {qual === null ? (
          <>
            <p className="text-sm text-ink-600">O que vai acontecer neste horário?</p>
            <div className="flex flex-col gap-1.5">
              {INTENCOES.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setQual(i)}
                  className="flex min-h-11 flex-col gap-0.5 rounded-input border border-line bg-paper-0 px-3 py-2 text-left transition-colors hover:border-ink-600 hover:bg-paper-100"
                >
                  <span className="text-sm font-semibold text-ink-900">{ROTULO[i]}</span>
                  {/* a consequência é DADO: piso literal da régua */}
                  <span className="text-sm leading-snug font-medium text-ink-900">
                    {CONSEQUENCIA[i]}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setQual(null)}
                className="inline-flex min-h-6 items-center self-start rounded-chip px-2 text-sm font-semibold text-ac-deep hover:bg-paper-100"
              >
                ← Escolher outra coisa
              </button>
              <p className="text-sm font-semibold text-ink-900">{ROTULO[qual]}</p>
              <p className="text-sm leading-snug font-medium text-ink-900">{CONSEQUENCIA[qual]}</p>
            </div>
            {qual === 'avulsa' && <FormAvulsa />}
            {qual === 'experimental' && <FormExperimental />}
            {qual === 'horario' && <FormHorario />}
            {qual === 'bloqueio' && <FormBloqueio />}
          </>
        )}
      </DoBalao.Provider>
    </div>
  )
}

/* ------------------------------------------------------------- 1a. avulsa --- */

function FormAvulsa() {
  const d = useDados()
  const { iso, hhmm, instanteUtc, digitado, declararFuso } = useBalao()
  return (
    <form action={createSingleClassAction} className="flex flex-col gap-3">
      <Ocultos qual="avulsa" />
      {/* A MESMA peça do painel `?novo=avulsa` (grave 3). */}
      <CamposDaAvulsa
        contratos={d.contratos}
        digitado={digitado}
        instanteUtc={instanteUtc}
        horaNaGrade={hhmm}
        dataInicial={iso}
        horaInicial={hhmm}
        aoDeclararFuso={declararFuso}
      />
      <button type="submit" className={btnDoBalao}>
        {CONFIRMAR.avulsa}
      </button>
    </form>
  )
}

/* -------------------------------------------------------- 1b. experimental --- */

function FormExperimental() {
  const d = useDados()
  const { iso, hhmm, instanteUtc, digitado, declararFuso } = useBalao()
  return (
    <form action={createTrialClassAction} className="flex flex-col gap-3">
      <Ocultos qual="experimental" />
      <CamposDaExperimental
        professoras={d.professoras}
        professoraFiltrada={d.professoraFiltrada}
        digitado={digitado}
        instanteUtc={instanteUtc}
        horaNaGrade={hhmm}
        dataInicial={iso}
        horaInicial={hhmm}
        aoDeclararFuso={declararFuso}
      />
      <button type="submit" className={btnDoBalao}>
        {CONFIRMAR.experimental}
      </button>
    </form>
  )
}

/* ------------------------------------------------------------ 2. horário --- */

function FormHorario() {
  const { iso, hhmm, digitado } = useBalao()
  const [professora, setProfessora] = useState(digitado.teacher_id ?? '')
  // Este formulário grava EM CUIABÁ (a action manda `p_iana_tz = America/Cuiaba`),
  // então ele NÃO declara fuso nenhum: o cabeçalho segue dizendo só o ponto
  // tocado, que é exatamente o que vai ser publicado.
  return (
    <form action={publishWindowAction} className="flex flex-col gap-3">
      <Ocultos qual="horario" />
      {/* AQUI os ocultos são honestos: `publishWindowAction` manda
          `p_iana_tz = America/Cuiaba`, que é o fuso da própria grade — o
          horário publicado é EXATAMENTE o que ela tocou. */}
      <input type="hidden" name="local_date" value={iso} />
      <input type="hidden" name="local_time" value={hhmm} />
      <SeletorDoBalao valor={professora} aoMudar={setProfessora} />
      <button type="submit" className={btnDoBalao}>
        {CONFIRMAR.horario}
      </button>
    </form>
  )
}

/* ----------------------------------------------------------- 3. bloqueio --- */

function FormBloqueio() {
  const d = useDados()
  const { iso, instanteUtc, digitado } = useBalao()

  const [professora, setProfessora] = useState(
    digitado.teacher_id ?? d.professoraFiltrada ?? '',
  )
  const dela = d.professoras.find((t) => t.id === professora) ?? null
  // O DIA CIVIL É O DELA, NÃO O DA GRADE (Sol · rodada 1 do A4, médio 1): às
  // 20:30 em Cuiabá já é o dia SEGUINTE em Lisboa. Esconder a HORA está certo
  // (o bloqueio é diário); esconder a CONVERSÃO de data não estava — a dona
  // pediria férias no dia errado.
  const diaDela = dela ? diaCivilNoFuso(instanteUtc, dela.ianaTz) : null
  const [de, setDe] = useState(digitado.from ?? diaDela ?? iso)
  const [ate, setAte] = useState(digitado.to ?? diaDela ?? iso)

  // O bloqueio NÃO declara fuso ao cabeçalho: ele é DIÁRIO (só datas, sem
  // hora), e um "Nos campos: 05/08 às —" seria ruído. Quem conta a virada de
  // dia é a frase de atenção logo abaixo, que nomeia a cidade dela.

  const trocarProfessora = (id: string) => {
    setProfessora(id)
    const alvo = d.professoras.find((t) => t.id === id)
    const dia = alvo ? diaCivilNoFuso(instanteUtc, alvo.ianaTz) : null
    if (dia) {
      setDe(dia)
      setAte(dia)
    }
  }

  return (
    <form action={addTeacherBlockAction} className="flex flex-col gap-3">
      <Ocultos qual="bloqueio" />
      <SeletorDoBalao valor={professora} aoMudar={trocarProfessora} comFuso />
      {/* DIA CIVIL, não meia-hora: `add_teacher_block` recebe DATAS e grava de
          `p_from` 00:00 a `p_to + 1` 00:00 no fuso da professora. */}
      <div className="grid grid-cols-2 gap-3">
        <CampoDeDado label={`De (${dela?.cidade ?? 'fuso da professora'})`}>
          <DateField name="from" required defaultValue={de} />
        </CampoDeDado>
        <CampoDeDado label="Até (inclusive)">
          <DateField name="to" required defaultValue={ate} />
        </CampoDeDado>
      </div>
      {dela && diaDela && diaDela !== iso && (
        <Atencao>
          Em {dela.cidade} este horário já é {diaEmBr(diaDela)} — o bloqueio nasce nesse dia, não no
          da grade.
        </Atencao>
      )}
      {/* a nota é o que distingue um bloqueio do outro na hora de remover
          (lição do A3: dois bloqueios de mesmas datas sem nota são gêmeos) */}
      <Field label="Motivo (opcional)" hint="aparece na grade — ex.: férias">
        <input
          name="note"
          placeholder="férias"
          defaultValue={digitado.note ?? ''}
          className={input}
        />
      </Field>
      <button type="submit" className={btnDoBalao}>
        {CONFIRMAR.bloqueio}
      </button>
    </form>
  )
}
