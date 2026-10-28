'use client'

// OS CAMPOS DA AULA — uma peça só, usada pelas DUAS portas que criam aula.
//
// ── O DEFEITO QUE ISTO CONSERTA (Sol · rodada 2 do A4, grave 3) ──────────────
// A rodada 1 ensinou o BALÃO da meia-hora a recalcular data e hora para o
// relógio do aluno quando a dona escolhe o contrato (ou a cidade). Os painéis
// `?novo=avulsa` e `?novo=experimental` ficaram como estavam: eles recebiam
// `nd`/`nt` — a data e a hora que a dona tocou NA GRADE, ou seja, em Cuiabá — e
// os despejavam nos campos sem nunca recalcular. Link salvo com
// `nd=2026-08-04&nt=14:00` mais um contrato de São Paulo criava a aula às 14:00
// de São Paulo: 13:00 no ponto que ela tinha tocado. O mesmo defeito de dinheiro
// e de horário, na tela do lado.
//
// A régua da casa para isso é a do `TipoEValorDaAvulsa` (grave 1 da rodada 1):
// quando o mesmo par existe em duas portas, ele vira UMA peça — consertar uma e
// deixar a outra é guardar o defeito por escrito. Aqui a peça é maior (o
// formulário inteiro de cada tipo de aula), mas o motivo é o mesmo.
//
// ── O QUE ESTA PEÇA GARANTE ─────────────────────────────────────────────────
// 1. Escolher o contrato (avulsa) ou a cidade (experimental) RECALCULA data e
//    hora para o equivalente local daquele fuso, a partir do INSTANTE do ponto
//    tocado — que chega pronto do servidor (Lei 1: a conversão civil→instante é
//    de lá; aqui só se lê um instante numa zona explícita).
// 2. Sem ponto tocado (o painel aberto pelo menu, sem `nd`/`nt`), não há o que
//    converter: os campos ficam como a dona os deixou e só o RÓTULO segue a
//    cidade. Mentir horário é pior que não recalcular.
// 3. A peça DECLARA para quem a hospeda em que fuso e com que valores os campos
//    estão (`aoDeclararFuso`) — é assim que o cabeçalho do balão para de
//    afirmar "Cuiabá" e passa a mostrar o que está REALMENTE nos campos
//    (médio 1 da rodada 2).
//
// A conferência de que essa hora EXISTE (uma vez só) no relógio daquela cidade
// não mora aqui: ela é do servidor, na action, porque é lá que nada foi gravado
// ainda e é lá que a recusa é confiável — ver `src/lib/admin/hora-civil.ts`.

import { useEffect, useState } from 'react'

import { CityPicker } from '@/components/CityPicker'
import { DateField } from '@/components/DateField'
import { TimeField } from '@/components/TimeField'
import { Field, input } from '@/components/ui'
import { tzLabel } from '@/lib/format'
import { equivalenteNoFuso } from './equivalente-no-fuso'
import { CampoDeDado, TipoEValorDaAvulsa } from './TipoEValorDaAvulsa'

/** O fuso da grade do admin. Constante de TEXTO, não cálculo de data — a Lei 1
 *  proíbe conversão no cliente, não saber o nome da zona do negócio. */
export const FUSO_DO_NEGOCIO = 'America/Cuiaba'
export const CIDADE_DO_NEGOCIO = 'Cuiabá'

export interface ProfessoraDoSlot {
  id: string
  nome: string
  /** fuso operacional dela (F3-D2) — é nele que o bloqueio conta o dia civil */
  ianaTz: string
  /** o mesmo fuso em cidade ("Cuiabá") — nunca IANA cru na tela */
  cidade: string
}

export interface ContratoDoSlot {
  id: string
  rotulo: string
  /** o fuso em que a action converte data e hora no instante da RPC (A6) */
  ianaTz: string
  cidade: string
}

/**
 * O que a peça conta a quem a hospeda: em que relógio os campos estão E o que
 * está escrito neles AGORA.
 *
 * MÉDIO 1 da rodada 2: o cabeçalho do balão dizia "Nos campos: … às 15:00"
 * recalculando do ponto tocado, e não lendo os campos. A dona corrigia 15:00
 * para 16:00 e o cabeçalho continuava anunciando 15:00 — um resumo que
 * contradiz o formulário logo abaixo dele é pior que resumo nenhum.
 */
export interface FusoDeclarado {
  iana: string
  cidade: string
  /** 'yyyy-LL-dd' — o valor REAL do campo de data */
  data: string
  /** 'HH:mm' — o valor REAL do campo de hora */
  hora: string
}

/** Efeito de declaração: um lugar só, com limpeza ao desmontar. */
function useDeclarar(
  aoDeclarar: ((f: FusoDeclarado | null) => void) | undefined,
  f: FusoDeclarado | null,
) {
  const { iana, cidade, data, hora } = f ?? { iana: '', cidade: '', data: '', hora: '' }
  const tem = f !== null
  useEffect(() => {
    if (!aoDeclarar) return
    aoDeclarar(tem ? { iana, cidade, data, hora } : null)
    return () => aoDeclarar(null)
  }, [aoDeclarar, tem, iana, cidade, data, hora])
}

/** SELETOR DE PROFESSORA — um só, compartilhado pelas intenções que precisam
 *  dele. Com o filtro da barra ligado ele vira campo oculto (a barra já
 *  escolheu); sem filtro, é um `<select>` com rótulo VISÍVEL.
 *
 *  A `avulsa` NÃO o usa de propósito: `admin_create_single_class` não recebe
 *  professora — ela vem do CONTRATO. Oferecer o campo ali seria mentir sobre
 *  quem decide. */
export function SeletorDeProfessora({
  professoras,
  professoraFiltrada,
  valor,
  aoMudar,
  comFuso,
}: {
  professoras: ProfessoraDoSlot[]
  professoraFiltrada: string | null
  valor: string
  aoMudar: (id: string) => void
  /** mostra a cidade da professora junto do nome (o bloqueio conta o dia lá) */
  comFuso?: boolean
}) {
  if (professoraFiltrada)
    return <input type="hidden" name="teacher_id" value={professoraFiltrada} />
  return (
    <Field label="Professora">
      <select
        name="teacher_id"
        required
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        aria-label="Professora do horário"
        className={input}
      >
        <option value="">Escolha…</option>
        {professoras.map((t) => (
          <option key={t.id} value={t.id}>
            {comFuso ? `${t.nome} · ${t.cidade}` : t.nome}
          </option>
        ))}
      </select>
    </Field>
  )
}

/** Frase de ATENÇÃO dentro do formulário: é DADO (muda a decisão), então vai no
 *  piso literal da régua — nunca em `text-xs`/`ink-400`. */
export function Atencao({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-medium text-ink-900">{children}</p>
}

/**
 * O par data+hora dos formulários que gravam noutro fuso.
 *
 * `data`/`hora` são o valor EMPURRADO por quem chama (trocar o contrato ou a
 * cidade reescreve os dois com o equivalente local, e o `DateField`/`TimeField`
 * da casa sincroniza o texto visível quando o `defaultValue` muda). O que a
 * dona DIGITA volta por `aoMudarData`/`aoMudarHora` — e nunca é devolvido como
 * `defaultValue`, senão o reset derivado apagaria a digitação pela metade.
 */
function DataEHora({
  data,
  hora,
  gestoData,
  gestoHora,
  cidade,
  aoMudarData,
  aoMudarHora,
}: {
  data: string
  hora: string
  /** o CONTADOR DE GESTO de cada campo — ver `useCampoEspelhado` */
  gestoData: number
  gestoHora: number
  /** de quem é o relógio destes campos ("São Paulo") */
  cidade: string
  aoMudarData: (v: string) => void
  aoMudarHora: (v: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <CampoDeDado label={`Data (${cidade})`}>
        <DateField
          key={`local_date-${gestoData}`}
          name="local_date"
          required
          defaultValue={data || undefined}
          aoMudar={aoMudarData}
        />
      </CampoDeDado>
      <CampoDeDado label={`Hora (${cidade})`}>
        <TimeField
          key={`local_time-${gestoHora}`}
          name="local_time"
          required
          defaultValue={hora || undefined}
          aoMudar={aoMudarHora}
        />
      </CampoDeDado>
    </div>
  )
}

/**
 * O par "valor empurrado × valor digitado" (médio 1). O primeiro é o que vai
 * como `defaultValue`; o segundo é o que a tela AFIRMA estar nos campos.
 *
 * ── O DEFEITO QUE O `gesto` CONSERTA (revisão independente do A4, bloqueador 2)
 * `DateField`/`TimeField` sincronizam o texto visível quando a PROP muda
 * (`prevDefault !== defaultValue`). Quando a conversão devolve exatamente os
 * mesmos algarismos do último valor empurrado, a prop NÃO muda — e o campo não
 * reseta. Medido: 04/08/2026, toca 14:00 em Cuiabá, corrige a hora à mão para
 * 15:00 e escolhe Orlando, que nessa data está em UTC−4 igual a Cuiabá. A
 * conversão recalcula 14:00, `empurrado` já era 14:00, a prop fica igual: o
 * campo visível e o `<input hidden>` continuam em 15:00, o estado espelhado vira
 * 14:00 e o cabeçalho afirma "Nos campos: 14:00 — hora de Orlando". O banco
 * recebe 15:00. Vale igual para a DATA e para trocar entre dois contratos de
 * equivalente civil idêntico.
 *
 * DECISÃO NOMEADA — **reset por REMONTAGEM, com chave de GESTO**. O reset não
 * pode depender de o VALOR ter mudado (é justamente o caso em que ele não
 * muda): ele depende do GESTO. `gesto` é um contador que sobe a cada
 * `empurrar()` — trocar o contrato ou a cidade —, entra como `key` do campo, e
 * o React remonta a peça, que renasce lendo o `defaultValue` novo. Vale para
 * valor igual e para valor diferente, com um caminho só.
 *
 * Por que não componente CONTROLADO: `DateField`/`TimeField` guardam o texto
 * MASCARADO em digitação (o "04/0" que ainda não é data), e controlar isso de
 * fora obrigaria a subir a máscara para cá — mudança de contrato de dois campos
 * usados em 20 telas, por um defeito que é do reset. O custo da remontagem é o
 * foco, e ele não está no campo: o gesto acontece no `<select>` de contrato ou
 * no seletor de cidade.
 */
function useCampoEspelhado(inicial: string) {
  const [empurrado, setEmpurrado] = useState(inicial)
  const [atual, setAtual] = useState(inicial)
  const [gesto, setGesto] = useState(0)
  const empurrar = (v: string) => {
    setEmpurrado(v)
    setAtual(v)
    setGesto((n) => n + 1)
  }
  return { empurrado, atual, gesto, empurrar, digitou: setAtual }
}

/**
 * Duração: campo comum aos dois formulários de aula.
 *
 * GRAVE 1 da revisão independente: o campo não tinha `required` nem `min`, e as
 * duas actions faziam `Number(x) || 45` — a dona digitava 0 (ou apagava para
 * corrigir) e o banco gravava 45 minutos, que depois conta 45 minutos no
 * extrato da professora. Aqui é ANTECIPAÇÃO (a recusa de verdade é da action,
 * que é o endpoint público); os limites são os mesmos que o banco já impõe ao
 * horário fixo (`recurring_slots_duration_sane`, 15..480).
 */
function Duracao({ valor }: { valor?: string }) {
  return (
    <Field label="Duração (min)">
      <input
        name="duration_min"
        type="number"
        required
        min={15}
        max={480}
        step={1}
        defaultValue={valor ?? 45}
        className={input}
      />
    </Field>
  )
}

/* ========================================================================== */
/* Aula avulsa — para quem JÁ é aluno                                          */
/* ========================================================================== */

export interface PropsDosCampos {
  /** o que a dona digitou e voltou no cookie de rascunho depois de um erro */
  digitado: Record<string, string>
  /** instante UTC do ponto tocado na grade — `null` = painel sem ponto tocado */
  instanteUtc: string | null
  /** 'HH:mm' do ponto tocado, para a frase de conversão ("14:00 em Cuiabá") */
  horaNaGrade: string | null
  /** valores de partida quando não há contrato/cidade escolhidos ainda */
  dataInicial?: string
  horaInicial?: string
  /** o hospedeiro quer saber em que relógio (e com que valores) os campos estão */
  aoDeclararFuso?: (f: FusoDeclarado | null) => void
}

export function CamposDaAvulsa({
  contratos,
  digitado,
  instanteUtc,
  horaNaGrade,
  dataInicial,
  horaInicial,
  aoDeclararFuso,
}: PropsDosCampos & { contratos: ContratoDoSlot[] }) {
  const [contratoId, setContratoId] = useState(digitado.contract_id ?? '')
  const escolhido = contratos.find((c) => c.id === contratoId) ?? null
  const equivalente =
    escolhido && instanteUtc ? equivalenteNoFuso(instanteUtc, escolhido.ianaTz) : null

  // Os campos nascem com o que voltou do rascunho; sem rascunho, com o
  // equivalente do ponto tocado no fuso do contrato já escolhido (ou com o
  // próprio ponto enquanto não há contrato).
  const data = useCampoEspelhado(digitado.local_date ?? equivalente?.data ?? dataInicial ?? '')
  const hora = useCampoEspelhado(digitado.local_time ?? equivalente?.hora ?? horaInicial ?? '')

  useDeclarar(
    aoDeclararFuso,
    escolhido
      ? {
          iana: escolhido.ianaTz,
          cidade: escolhido.cidade,
          data: data.atual,
          hora: hora.atual,
        }
      : null,
  )

  return (
    <>
      <CampoDeDado
        label="Contrato/aluno"
        hint="a cidade ao lado do nome é o fuso em que a aula é gravada"
      >
        <select
          name="contract_id"
          required
          value={contratoId}
          onChange={(e) => {
            const id = e.target.value
            setContratoId(id)
            // RECALCULA os campos para o relógio DAQUELE aluno (grave 3). Sem
            // ponto tocado, ou com zona desconhecida, não mexe em nada.
            const alvo = contratos.find((c) => c.id === id)
            const eq = alvo && instanteUtc ? equivalenteNoFuso(instanteUtc, alvo.ianaTz) : null
            if (eq) {
              data.empurrar(eq.data)
              hora.empurrar(eq.hora)
            }
          }}
          className={input}
        >
          <option value="">Escolha…</option>
          {contratos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.rotulo}
            </option>
          ))}
        </select>
      </CampoDeDado>
      {/* S2-15 com trava de verdade: cortesia DESMONTA o campo Valor (grave 1) */}
      <TipoEValorDaAvulsa tipoInicial={digitado.kind} valorInicial={digitado.price} dado />
      {/* DATA E HORA FICAM VISÍVEIS, e não ocultas com o valor do slot: a RPC
          lê estes campos no fuso do ALUNO, não em Cuiabá. */}
      <DataEHora
        data={data.empurrado}
        hora={hora.empurrado}
        gestoData={data.gesto}
        gestoHora={hora.gesto}
        cidade={escolhido?.cidade ?? CIDADE_DO_NEGOCIO}
        aoMudarData={data.digitou}
        aoMudarHora={hora.digitou}
      />
      <Atencao>
        {escolhido
          ? `Data e hora valem no fuso de ${escolhido.cidade}.${
              instanteUtc && horaNaGrade
                ? ` Já foram convertidas a partir do ponto que você tocou na grade (${horaNaGrade} em ${CIDADE_DO_NEGOCIO}) — confira antes de confirmar.`
                : ' Confira antes de confirmar.'
            }`
          : 'Escolha o contrato: data e hora valem no fuso do ALUNO, e os campos se ajustam sozinhos ao relógio dele.'}
      </Atencao>
      <Duracao valor={digitado.duration_min} />
    </>
  )
}

/* ========================================================================== */
/* Aula experimental — para pessoa NOVA                                        */
/* ========================================================================== */

export function CamposDaExperimental({
  professoras,
  professoraFiltrada,
  digitado,
  instanteUtc,
  horaNaGrade,
  dataInicial,
  horaInicial,
  aoDeclararFuso,
}: PropsDosCampos & {
  professoras: ProfessoraDoSlot[]
  professoraFiltrada: string | null
}) {
  const [tz, setTz] = useState(digitado.iana_tz ?? FUSO_DO_NEGOCIO)
  // `tzLabel` é mapa de STRING (nenhum cálculo de data) e já era importado do
  // cliente pelo próprio `CityPicker` — a cidade nunca aparece como IANA cru.
  const [cidade, setCidade] = useState<string>(() => tzLabel(digitado.iana_tz ?? FUSO_DO_NEGOCIO))
  const inicial = instanteUtc ? equivalenteNoFuso(instanteUtc, tz) : null
  const data = useCampoEspelhado(digitado.local_date ?? inicial?.data ?? dataInicial ?? '')
  const hora = useCampoEspelhado(digitado.local_time ?? inicial?.hora ?? horaInicial ?? '')
  const [professora, setProfessora] = useState(digitado.teacher_id ?? professoraFiltrada ?? '')

  useDeclarar(aoDeclararFuso, { iana: tz, cidade, data: data.atual, hora: hora.atual })

  return (
    <>
      <Field label="Nome da pessoa">
        <input
          name="student_name"
          required
          placeholder="Maria Silva"
          defaultValue={digitado.student_name ?? ''}
          className={input}
        />
      </Field>
      <CampoDeDado label="Cidade da pessoa (define o fuso)">
        {/* `small` NÃO entra aqui (médio 5): a cidade é o dado que evita criar a
            aula no fuso errado — `text-xs` é degrau de apoio. */}
        <CityPicker
          tzName="iana_tz"
          defaultTz={digitado.iana_tz ?? FUSO_DO_NEGOCIO}
          required
          aoEscolher={({ tz: nova, cidade: nome }) => {
            setTz(nova)
            setCidade(nome)
            // TROCAR A CIDADE RECALCULA A HORA (grave 3).
            const eq = instanteUtc ? equivalenteNoFuso(instanteUtc, nova) : null
            if (eq) {
              data.empurrar(eq.data)
              hora.empurrar(eq.hora)
            }
          }}
        />
      </CampoDeDado>
      <SeletorDeProfessora
        professoras={professoras}
        professoraFiltrada={professoraFiltrada}
        valor={professora}
        aoMudar={setProfessora}
      />
      <DataEHora
        data={data.empurrado}
        hora={hora.empurrado}
        gestoData={data.gesto}
        gestoHora={hora.gesto}
        cidade={cidade}
        aoMudarData={data.digitou}
        aoMudarHora={hora.digitou}
      />
      <Atencao>
        Data e hora valem no fuso de {cidade}
        {tz === FUSO_DO_NEGOCIO
          ? ' — o mesmo da grade.'
          : instanteUtc && horaNaGrade
            ? `. Já foram convertidas a partir do ponto que você tocou na grade (${horaNaGrade} em ${CIDADE_DO_NEGOCIO}).`
            : '. Confira antes de confirmar.'}
      </Atencao>
      <div className="grid grid-cols-2 gap-3">
        <Duracao valor={digitado.duration_min} />
        <CampoDeDado label="Valor (R$)" hint="em branco = gratuita">
          <input
            name="price"
            type="number"
            step="0.01"
            defaultValue={digitado.price ?? ''}
            className={input}
          />
        </CampoDeDado>
      </div>
    </>
  )
}
