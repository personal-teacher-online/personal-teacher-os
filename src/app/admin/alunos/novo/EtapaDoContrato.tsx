'use client'

// ETAPA 2 DO WIZARD — contrato e horários (M3-c4 · B5).
//
// A QUEIXA DO DONO: *"não posso criar contrato com horários já preenchidos"*.
// O fato é o oposto: o banco JÁ recusa (Lei 3 — a exclusão GiST
// `class_instances_teacher_no_overlap_excl` impede duas aulas sobrepostas da
// mesma professora). O que faltava era a TELA antecipar, em vez de deixar
// preencher tudo e devolver um erro de Postgres no fim da etapa. Esta etapa
// virou componente CLIENTE por isso, e só por isso: mostrar a agenda ocupada da
// professora exige reagir a "quem" e "que dia" antes do envio.
//
// O QUE ELA FAZ:
// · lista, ao lado de cada horário, o que a professora escolhida JÁ tem naquele
//   dia da semana — no relógio do aluno novo;
// · trava o envio (frase embaixo do campo, pelo `FormValidado` do kit) quando a
//   hora digitada atropela uma dessas janelas, ou quando os DOIS horários desta
//   mesma tela colidem entre si;
// · continua mandando exatamente os mesmos campos para `wizardContractAction` —
//   nenhuma mutação foi reescrita.
//
// LEI 1, ONDE ELA MORA: este arquivo NÃO faz conta de fuso. As janelas chegam
// prontas de `getAdmissionContext` (servidor, Luxon, offset do dia específico),
// já convertidas para a zona do aluno novo; aqui só se comparam minutos dentro
// de um relógio só. É por isso que não há `DateTime` nem `new Date` nesta tela.
//
// O QUE FICOU PARA DEPOIS (anotado, não escondido): o seletor RICO — grade da
// semana com as faixas livres clicáveis, no lugar de digitar HH:mm. O mínimo
// honesto deste lote é a lista do que está ocupado + o erro antecipado; a grade
// é outro tamanho de trabalho (e reusaria o `CalendarGrid` da Leva 6).

import { useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/kit/select'
import { CampoComTeto } from '@/components/kit/campo-com-teto'
import { FormValidado } from '@/components/kit/form-validado'
import { SheetBody, SheetSection } from '@/components/kit/sheet'
import { DateField } from '@/components/DateField'
import { TimeField } from '@/components/TimeField'
import { CAMPO, Campo, GradeDeCampos } from '@/components/admin/alunos/ficha/pecas'
import {
  HORARIOS_DA_ADMISSAO,
  PLANO_OUTRO,
  PLANO_PADRAO,
  planoInicial,
  type RascunhoDoContrato,
} from '@/data/admin/admissao'
import { TETO_DO_PLANO } from '@/data/admin/contrato-novo'
import {
  conflitoDe,
  janelasDoDia,
  minutosDeHhmm,
  type JanelaOcupada,
} from '@/lib/agenda/ocupacao'
import type { ReactNode } from 'react'

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

interface Horario {
  weekday: number
  hora: string
  duracao: number
}

/** Unidade DENTRO do campo (R$ à esquerda, "min" à direita) — a mesma peça da
 *  etapa 1, repetida aqui porque esta etapa virou cliente. */
function ComUnidade({
  id,
  prefixo,
  sufixo,
  children,
}: {
  id: string
  prefixo?: string
  sufixo?: string
  children: ReactNode
}) {
  return (
    <span className="relative flex items-center">
      {prefixo && (
        <span id={id} className="pointer-events-none absolute left-3 text-sm font-medium text-ink-600">
          {prefixo}
        </span>
      )}
      {children}
      {sufixo && (
        <span id={id} className="pointer-events-none absolute right-3 text-sm font-medium text-ink-600">
          {sufixo}
        </span>
      )}
    </span>
  )
}

/** A agenda que a professora já tem naquele dia — o dado que faltava na tela. */
function JaOcupado({
  janelas,
  professoraEscolhida,
}: {
  janelas: JanelaOcupada[]
  professoraEscolhida: boolean
}) {
  if (!professoraEscolhida) {
    return (
      <p className="text-sm leading-relaxed text-ink-600">
        Escolha a professora acima para ver o que ela já tem marcado neste dia.
      </p>
    )
  }
  if (janelas.length === 0) {
    return <p className="text-sm leading-relaxed text-ink-600">Ela não tem nada marcado neste dia.</p>
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-ink-900">Ela já tem neste dia</p>
      <ul className="flex flex-col gap-0.5">
        {janelas.map((j) => (
          <li key={`${j.inicio}-${j.quem}`} className="text-sm leading-relaxed text-ink-600">
            <span className="font-medium tabular-nums text-ink-900">{j.texto}</span> · {j.quem}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Os horários com que a etapa NASCE quando não há rascunho. */
const HORARIOS_EM_BRANCO: Horario[] = [
  { weekday: 1, hora: '', duracao: 45 },
  { weekday: 2, hora: '', duracao: 45 },
]

export function EtapaDoContrato({
  action,
  alunoId,
  alunoNome,
  fusoDoAluno,
  professoras,
  planos,
  ocupacao,
  rascunho,
  passos,
  rodape,
}: {
  action: (formData: FormData) => void | Promise<void>
  alunoId: string
  alunoNome: string
  /** rótulo do fuso já formatado no servidor (Lei 1: nada de conta aqui) */
  fusoDoAluno: string
  professoras: { id: string; display_name: string }[]
  /** D2: os nomes de plano que a escola já usa (derivados de `contracts`) */
  planos: string[]
  ocupacao: JanelaOcupada[]
  /**
   * c12 · nº 12 — O QUE A PESSOA JÁ TINHA DIGITADO, quando a criação atômica
   * falhou e a etapa voltou. Vem da URL (`?rasc=`), lido no servidor. `null` na
   * primeira vez, que é o caso comum.
   *
   * TODOS os onze campos voltam: professora, plano (inclusive um plano novo
   * digitado à mão), valor, franquia, início e os dois horários com dia, hora e
   * duração. Meia volta seria pior que nenhuma — a pessoa confere o que sobrou
   * em vez de conferir o que errou.
   */
  rascunho?: RascunhoDoContrato | null
  passos: ReactNode
  rodape: ReactNode
}) {
  const [professora, setProfessora] = useState(rascunho?.professora ?? '')
  // Plano da LISTA volta como escolha; plano que não está na lista é o "Outro…"
  // que a pessoa batizou — volta como texto livre, com a sentinela selecionada.
  const [plano, setPlano] = useState(() => {
    const digitado = rascunho?.plano ?? ''
    if (!digitado) return planoInicial(planos)
    return planos.includes(digitado) ? digitado : PLANO_OUTRO
  })
  const planoNovoInicial =
    rascunho?.plano && !planos.includes(rascunho.plano) ? rascunho.plano : ''
  const [horarios, setHorarios] = useState<Horario[]>(() =>
    HORARIOS_EM_BRANCO.map(
      (branco, i) => rascunho?.horarios?.[i] ?? branco,
    ).slice(0, HORARIOS_DA_ADMISSAO),
  )

  function mexer(i: number, mudanca: Partial<Horario>) {
    setHorarios((atual) => atual.map((h, j) => (j === i ? { ...h, ...mudanca } : h)))
  }

  /**
   * O motivo pelo qual a hora `i` não serve — ou `null`.
   *
   * A ordem importa: primeiro a agenda da professora (o conflito que o banco
   * recusaria), depois o outro horário DESTA MESMA tela (que o banco também
   * recusaria, e que nenhuma leitura do servidor poderia ter previsto, porque
   * ele ainda não existe).
   */
  function problemaDe(i: number): string | null {
    const h = horarios[i]
    const inicio = minutosDeHhmm(h.hora)
    if (!professora || inicio === null || h.duracao <= 0) return null

    const bate = conflitoDe(ocupacao, professora, h.weekday, inicio, h.duracao)
    if (bate) return `A professora já tem aula neste horário: ${bate.texto} · ${bate.quem}.`

    const outro = horarios[i === 0 ? 1 : 0]
    const inicioDoOutro = minutosDeHhmm(outro.hora)
    if (inicioDoOutro === null) return null
    const colisao = conflitoDe(
      [
        {
          professoraId: professora,
          weekday: outro.weekday,
          inicio: inicioDoOutro,
          fim: inicioDoOutro + outro.duracao,
          quem: alunoNome,
          texto: '',
        },
      ],
      professora,
      h.weekday,
      inicio,
      h.duracao,
    )
    return colisao ? 'Os dois horários desta tela se sobrepõem — escolha outro.' : null
  }

  return (
    <FormValidado action={action} className="flex min-h-0 flex-1 flex-col">
      <input type="hidden" name="aluno" value={alunoId} />
      <SheetBody>
        {passos}
        <SheetSection
          title="O contrato"
          hint={`É o contrato que define com quem ${alunoNome} estuda, quanto custa a aula e quantas remarcações ele tem por mês. ${alunoNome} já está salvo: se você sair agora, ele aparece na lista como "sem contrato ativo".`}
        >
          <GradeDeCampos>
            <Campo rotulo="Professora" para="professora-do-contrato" exigencia="Escolha a professora">
              {/* `required` aqui só é possível porque o formulário leva
                  `noValidate` (M3-c4 · B3): o `<select>` escondido que o Radix
                  planta continua sendo quem reprova, mas quem mostra o erro e
                  recebe o foco é o gatilho visível. Antes, sem `noValidate`, um
                  controle inválido escondido fazia o Chrome recusar o envio SEM
                  mensagem nenhuma — o botão parecia quebrado. */}
              <Select
                name="teacher_id"
                required
                // nº 12: a professora que a pessoa já tinha escolhido
                defaultValue={rascunho?.professora || undefined}
                onValueChange={setProfessora}
              >
                <SelectTrigger id="professora-do-contrato" className="min-h-11 w-full">
                  <SelectValue placeholder="Escolha…" />
                </SelectTrigger>
                <SelectContent className="z-60">
                  {professoras.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            {/* D2 — o plano deixa de ser texto livre e vira ESCOLHA entre os
                nomes que a escola já usa, com "Outro…" para batizar um novo.
                O campo que a action lê continua sendo UM só (`plan_name`), e a
                mutação não mudou: quando a escolha é da lista, ele viaja como
                hidden; quando é "Outro…", ele É o campo de texto. */}
            <Campo
              rotulo="Plano"
              para="plano-do-contrato"
              apoio="o nome que aparece na ficha e no extrato"
              exigencia="Escolha o plano"
            >
              <Select value={plano} onValueChange={setPlano}>
                <SelectTrigger id="plano-do-contrato" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-60">
                  {planos.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                  <SelectItem value={PLANO_OUTRO}>Outro…</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
            {plano === PLANO_OUTRO ? (
              <Campo
                rotulo="Nome do plano novo"
                apoio="ele passa a aparecer na lista dos próximos contratos"
                exigencia="Informe o nome do plano"
              >
                <CampoComTeto
                  name="plan_name"
                  required
                  // c13 · nº 8: teto de 80. Aqui ele também é economia de
                  // ENDEREÇO: este campo viaja no rascunho da URL quando a
                  // criação atômica falha (nº 12), e é o único de tamanho livre.
                  // c16 · r6 nº 12: medido em CARACTERES (o `maxLength` contava
                  // UTF-16 e travava em 40 emojis) e AVISANDO — antes ele comia
                  // a tecla, e quem colava um nome longo perdia o fim em
                  // silêncio.
                  teto={TETO_DO_PLANO}
                  frase={`O nome do plano cabe em ${TETO_DO_PLANO} caracteres.`}
                  // nº 12: o plano novo que a pessoa batizou volta escrito
                  defaultValue={planoNovoInicial || (planos.length === 0 ? PLANO_PADRAO : '')}
                  placeholder="ex.: Aulas do casal"
                  className={CAMPO}
                />
              </Campo>
            ) : (
              <input type="hidden" name="plan_name" value={plano} />
            )}
            {/* nº 11: `min="0"` já estava certo — zero É cortesia, e agora a
                action concorda (ela reprovava o 0 junto com o vazio). */}
            <Campo
              rotulo="Valor da aula"
              apoio="0 é cortesia — aula de graça é caso legítimo, e o contrato nasce igual"
              exigencia="Informe o valor da aula"
            >
              <ComUnidade id="unidade-do-valor" prefixo="R$">
                <input
                  name="hourly_rate"
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={rascunho?.valor ?? ''}
                  placeholder="ex.: 150,00"
                  aria-describedby="unidade-do-valor"
                  className={`${CAMPO} pl-10`}
                />
              </ComUnidade>
            </Campo>
            {/* B6 · item 3: o teto é 10 no BANCO (`contracts` tem
                `monthly_reschedule_allowance between 0 and 10`). Sem o `max`, a
                tela aceitava 40 e o contrato inteiro morria na hora do insert,
                com erro de constraint. */}
            <Campo
              rotulo="Remarcações por mês"
              apoio="quantas vezes o aluno pode remarcar sem perder a aula — de 0 a 10"
              exigencia="Informe quantas remarcações o aluno tem por mês (de 0 a 10)"
            >
              <input
                name="allowance"
                type="number"
                min="0"
                max="10"
                required
                defaultValue={rascunho?.remarcacoes || 4}
                className={CAMPO}
              />
            </Campo>
            <Campo
              rotulo="Início da vigência"
              apoio="a partir daqui contam as aulas e as cobranças"
              exigencia="Informe a data de início da vigência"
            >
              <DateField
                name="started_on"
                required
                defaultValue={rascunho?.inicio || undefined}
                className={CAMPO}
              />
            </Campo>
          </GradeDeCampos>
        </SheetSection>

        <SheetSection
          title="Política da escola"
          hint="Fixa para todos os contratos, e por isso não é campo: aviso mínimo de 24h · crédito de reposição vale 90 dias · quando a falha é da escola, 180 dias."
        />

        <SheetSection
          title="Horários fixos"
          hint={`Hora no fuso do aluno (${fusoDoAluno}) — e a agenda da professora ao lado também. Deixe em branco para definir depois: o contrato nasce igual, só sem aula marcada.`}
        >
          {horarios.map((h, i) => (
            // Os dois horários são BLOCOS, cada um com o seu nome: sem isso a
            // grade repete "Dia da semana" duas vezes e a pessoa perde de vista
            // qual linha está preenchendo.
            <div key={i} className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold text-ink-900">
                {i === 0 ? 'Primeiro horário' : 'Segundo horário'}
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Campo rotulo="Dia da semana" para={`dia-${i + 1}`}>
                  <Select
                    name={`w${i + 1}`}
                    defaultValue={String(h.weekday)}
                    onValueChange={(v) => mexer(i, { weekday: Number(v) })}
                  >
                    <SelectTrigger id={`dia-${i + 1}`} className="min-h-11 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-60">
                      {WEEKDAYS.map((d, wi) => (
                        <SelectItem key={wi} value={String(wi)}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
                <Campo rotulo="Hora">
                  <TimeField
                    name={`t${i + 1}`}
                    // nº 12: a hora digitada volta escrita. O `TimeField` deriva
                    // o texto da prop, e ela é ESTÁVEL entre renders (vem do
                    // rascunho, não do estado) — o campo não se reescreve
                    // sozinho enquanto a pessoa digita.
                    defaultValue={rascunho?.horarios?.[i]?.hora}
                    className={CAMPO}
                    problema={problemaDe(i)}
                    aoMudar={(valor) => mexer(i, { hora: valor })}
                  />
                </Campo>
                <Campo rotulo="Duração">
                  <ComUnidade id={`unidade-duracao-${i + 1}`} sufixo="min">
                    {/* c13 · nº 10: `max` = o CHECK do banco (15..480 desde o
                        c12 · nº 3). Sem ele a tela deixava passar 600 e a
                        criação inteira morria em erro de constraint. */}
                    <input
                      name={`d${i + 1}`}
                      type="number"
                      min="15"
                      max="480"
                      step="5"
                      defaultValue={h.duracao}
                      onChange={(e) => mexer(i, { duracao: Number(e.target.value) })}
                      aria-describedby={`unidade-duracao-${i + 1}`}
                      className={`${CAMPO} campo-com-unidade pr-12`}
                    />
                  </ComUnidade>
                </Campo>
              </div>
              <JaOcupado
                professoraEscolhida={Boolean(professora)}
                janelas={professora ? janelasDoDia(ocupacao, professora, h.weekday) : []}
              />
            </div>
          ))}
        </SheetSection>
      </SheetBody>
      {rodape}
    </FormValidado>
  )
}
