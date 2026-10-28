'use client'

// WIZARD DE CONTRATO (Onda 1 · M4-3) — o "Add New …" do TutorBird aplicado ao
// contrato: tipo → aluno(s) → horários → valores → política → revisão.
//
// A DIFERENÇA PARA O WIZARD DE ADMISSÃO, e é ela que manda no desenho: lá cada
// etapa JÁ COMMITA (o aluno nasce antes de a etapa 2 existir), e por isso o
// rodapé não tem "Voltar" — voltar duplicaria. Aqui NADA é escrito até a última
// tela: as seis etapas moram no estado do cliente e viram UMA chamada de
// `admin_create_contract`, que cria turma + membros + contrato + horários numa
// transação só. Como não há nada commitado para desfazer, "Voltar" é verdade —
// e ele existe.
//
// ANATOMIA MEDIDA (mapeamento-tutorbird-2.md, 3ª passada):
// · stepper de círculos numerados no topo (agora peça do kit, compartilhada com
//   a admissão);
// · corpo em SEÇÕES com hairline, cada uma dizendo o que faz antes de pedir o
//   dado; campos em GRADE DE 2 COLUNAS;
// · RADIOS-DE-CONSEQUÊNCIA na escolha do tipo: cada opção com uma frase do que
//   ACONTECE (é a régua deles, e é o que separa "Individual" de "Casal");
// · sufixo/prefixo DENTRO do campo (R$ no valor, "min" na duração);
// · rodapé FIXO: [Fechar] à esquerda, [Voltar] + ação sólida h40 à direita;
// · conclusão com check verde e os próximos passos como CARDS com frase.
//
// LEI 1, ONDE ELA MORA: este arquivo NÃO faz conta de fuso e não formata data.
// As janelas ocupadas chegam prontas do servidor, já convertidas para o relógio
// de cada zona (`ocupacaoPorFuso`), e aqui só se comparam minutos dentro de um
// relógio só. Os rótulos de fuso vêm formatados de lá também.
//
// LEI 3: nenhuma regra é reimplementada. Conflito de agenda, fuso não
// confirmado, âncora do grupo, franquia fora da faixa e promoção de lead são do
// Postgres; o que existe aqui é ANTECIPAÇÃO (dizer antes o que o banco diria
// depois) e a tradução do erro para o toast.

import Link from 'next/link'
import { useState, useTransition, type ReactNode } from 'react'
import { Check, FilePlus2, IdCard, Mail, Route } from 'lucide-react'
import { toast } from 'sonner'

import { CityPicker } from '@/components/CityPicker'
import { DateField } from '@/components/DateField'
import { TimeField } from '@/components/TimeField'
import { CAMPO, Campo, GradeDeCampos, Pares } from '@/components/admin/alunos/ficha/pecas'
import { FormValidado } from '@/components/kit/form-validado'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/kit/select'
import { SheetBody, SheetFooter, SheetSection } from '@/components/kit/sheet'
import { CampoComTeto } from '@/components/kit/campo-com-teto'
import { Stepper } from '@/components/kit/stepper'
import { PLANO_OUTRO, PLANO_PADRAO, planoInicial } from '@/data/admin/admissao'
import { SITUACOES } from '@/data/admin/alunos-grupos'
import {
  MAX_HORARIOS,
  RAMOS_DO_CONTRATO,
  TETO_DO_PLANO,
  RAMO_CONSEQUENCIA,
  RAMO_ROTULO,
  alunosPorSituacao,
  etapasDoRamo,
  temEtapaDeHorarios,
  type ContextoDoNovoContrato,
  type ContratoCriado,
  type RamoDeContrato,
} from '@/data/admin/contrato-novo'
import { DIAS_DA_SEMANA, enderecoDoContrato } from '@/data/admin/contratos-gramatica'
import { enderecoDaFicha } from '@/data/admin/ficha-gramatica'
import { conflitoDe, janelasDoDia, minutosDeHhmm } from '@/lib/agenda/ocupacao'
import { POLICY } from '@/lib/policy'
import { criarContratoAction, confirmarCidadesAction } from './actions'

/**
 * A POLÍTICA da escola, dita em linhas explicadas (item 12: nunca campo).
 *
 * Os NÚMEROS saem de `POLICY` (M4-4: declaração única em `src/lib/policy.ts`) —
 * a tela que promete "24 horas" e a action que grava `min_notice_hours` não
 * podem divergir. As frases são desta tela: elas explicam o número, e explicação
 * não é constante de negócio.
 */
const POLICY_LINHAS = [
  {
    titulo: `Aviso mínimo de ${POLICY.minNotice} horas`,
    frase: 'Remarcar depois disso não é mais possível pelo portal — a aula vira falta.',
  },
  {
    titulo: `Crédito de reposição vale ${POLICY.expiryDays} dias`,
    frase: 'É o prazo para o aluno usar uma reposição antes de ela expirar.',
  },
  {
    titulo: `Falha da escola vale ${POLICY.schoolFaultDays} dias`,
    frase: 'Quando quem faltou fomos nós, o crédito dura o dobro.',
  },
]

interface HorarioEditado {
  weekday: number
  hora: string
  duracao: number
}

const HORARIOS_INICIAIS: HorarioEditado[] = [
  { weekday: 1, hora: '', duracao: 45 },
  { weekday: 3, hora: '', duracao: 45 },
]

/** Unidade DENTRO do campo (R$ à esquerda, "min" à direita), como o "Minutes"
 *  deles — a mesma peça da etapa de contrato da admissão. */
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

export function WizardDeContrato({
  contexto,
  tipoInicial,
}: {
  contexto: ContextoDoNovoContrato
  /** `?tipo=` da URL: quem já sabe o que quer não passa pela etapa 1 às cegas */
  tipoInicial: RamoDeContrato | null
}) {
  const [enviando, iniciar] = useTransition()

  const [ramo, setRamo] = useState<RamoDeContrato>(tipoInicial ?? 'individual')
  const [passo, setPasso] = useState(1)
  const [criado, setCriado] = useState<ContratoCriado | null>(null)

  const [escolhidos, setEscolhidos] = useState<string[]>([''])
  const [ancora, setAncora] = useState('')
  const [rotuloDoGrupo, setRotuloDoGrupo] = useState('')
  const [professora, setProfessora] = useState('')
  const [horarios, setHorarios] = useState<HorarioEditado[]>(HORARIOS_INICIAIS)
  const [plano, setPlano] = useState(() => planoInicial(contexto.planos))
  const [planoNovo, setPlanoNovo] = useState('')
  const [valor, setValor] = useState('')
  const [inicio, setInicio] = useState(contexto.hojeIso)
  const [remarcacoes, setRemarcacoes] = useState(4)
  /**
   * Quem teve a cidade confirmada AQUI, nesta sessão do wizard.
   *
   * O contexto veio do servidor no início; confirmar a cidade muda a ficha no
   * banco, mas não repinta um componente cliente que não desmontou. Em vez de
   * pedir o contexto de novo (o que exigiria um `router.refresh` no meio de um
   * formulário de seis etapas), a confirmação anota AQUI o que ela mesma
   * gravou: zona nova e a cidade escolhida como rótulo. Nada é inventado — os
   * dois valores são os que acabaram de ir para o banco.
   */
  const [confirmados, setConfirmados] = useState<Record<string, { iana: string; fuso: string }>>({})
  /**
   * Quem NÃO passou na última tentativa, e por quê (c12 · nº 13).
   *
   * Par do estado acima: a confirmação é uma RPC por aluno, então uma leva pode
   * gravar dois e recusar um. O aluno gravado sai da lista de pendentes; o
   * recusado fica, e agora fica DIZENDO o motivo no próprio campo, em vez de
   * deixar um toast genérico responder por três pessoas.
   */
  const [errosDeCidade, setErrosDeCidade] = useState<Record<string, string>>({})

  const etapas = etapasDoRamo(ramo)
  const nomeDaEtapa = etapas[passo - 1]
  const alunos = contexto.alunos.map((a) =>
    confirmados[a.id] ? { ...a, ...confirmados[a.id], fusoConfirmado: true } : a,
  )
  const alunoPorId = new Map(alunos.map((a) => [a.id, a]))
  const selecionados = escolhidos.filter(Boolean).map((id) => alunoPorId.get(id)!).filter(Boolean)
  const aConfirmar = selecionados.filter((a) => !a.fusoConfirmado)

  /** De quem é o relógio que rege os horários fixos deste contrato. */
  const donoDoRelogio =
    ramo === 'grupo' ? (ancora ? alunoPorId.get(ancora) : undefined) : selecionados[0]
  const fusoDoContrato = donoDoRelogio?.iana ?? ''
  /** A agenda já lida NESTE relógio (ausente ≠ vazia — ver `JaOcupado`). */
  const agendaConhecida = Boolean(fusoDoContrato) && fusoDoContrato in contexto.ocupacaoPorFuso
  const ocupacao = contexto.ocupacaoPorFuso[fusoDoContrato] ?? []

  const planoFinal = plano === PLANO_OUTRO ? planoNovo.trim() : plano
  /**
   * c13 · nº 6 — CAMPO VAZIO NÃO É CORTESIA, aqui também.
   *
   * `Number('')` é `0`, e desde o c12 o zero é caso legítimo (aula de cortesia):
   * sem este `trim() === ''`, sair da etapa de valores com o campo em branco
   * criaria um contrato de graça em silêncio. O `-1` é o valor que o
   * `NovoContratoSchema` recusa com a frase certa ("informe o valor da aula") —
   * a mesma régua da etapa 2 da admissão e da renovação.
   */
  const centavos =
    valor.trim() === '' ? -1 : Math.round(Number(valor.replace(',', '.')) * 100)

  function trocarRamo(novo: RamoDeContrato) {
    setRamo(novo)
    // Turma nasce com duas vagas de aluno; individual e mentoria, com uma.
    setEscolhidos((atual) => {
      const vivos = atual.filter(Boolean)
      if (novo === 'grupo') return vivos.length >= 2 ? vivos : [vivos[0] ?? '', '']
      return [vivos[0] ?? '']
    })
    if (novo !== 'grupo') setAncora('')
  }

  function mexerNoHorario(i: number, mudanca: Partial<HorarioEditado>) {
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
  function problemaDoHorario(i: number): string | null {
    const h = horarios[i]
    const comeca = minutosDeHhmm(h.hora)
    if (!professora || comeca === null || h.duracao <= 0) return null

    const bate = conflitoDe(ocupacao, professora, h.weekday, comeca, h.duracao)
    if (bate) return `A professora já tem aula neste horário: ${bate.texto} · ${bate.quem}.`

    const outro = horarios[i === 0 ? 1 : 0]
    const comecaOutro = minutosDeHhmm(outro.hora)
    if (comecaOutro === null) return null
    const colisao = conflitoDe(
      [
        {
          professoraId: professora,
          weekday: outro.weekday,
          inicio: comecaOutro,
          fim: comecaOutro + outro.duracao,
          quem: 'este contrato',
          texto: '',
        },
      ],
      professora,
      h.weekday,
      comeca,
      h.duracao,
    )
    return colisao ? 'Os dois horários desta tela se sobrepõem — escolha outro.' : null
  }

  const horariosPreenchidos = horarios
    .filter((h) => minutosDeHhmm(h.hora) !== null)
    .map((h) => ({ weekday: h.weekday, local_time: h.hora, duration_min: h.duracao }))

  function avancar() {
    setPasso((p) => Math.min(p + 1, etapas.length))
  }

  /** A etapa 2 confirma a cidade de quem ainda está no palpite, e só então anda. */
  function submeterAlunos(fd: FormData) {
    if (aConfirmar.length === 0) {
      avancar()
      return
    }
    const entradas = aConfirmar.map((a) => ({
      aluno: a.id,
      cidade: String(fd.get(`cidade_${a.id}`) ?? ''),
      pais: String(fd.get(`pais_${a.id}`) ?? ''),
      iana: String(fd.get(`tz_${a.id}`) ?? ''),
    }))
    iniciar(async () => {
      const r = await confirmarCidadesAction(entradas)
      // c12 · nº 13: o que passou, passou — cada confirmação é uma RPC própria e
      // COMMITA sozinha. Marcar só quem deu certo é a única leitura fiel do que
      // está no banco; antes, um erro no terceiro aluno fazia o wizard esquecer
      // os dois primeiros e a pessoa reconfirmava tudo às cegas.
      const gravados = new Set(r.porAluno.filter((p) => p.ok).map((p) => p.aluno))
      setErrosDeCidade(
        Object.fromEntries(
          r.porAluno.filter((p) => !p.ok).map((p) => [p.aluno, p.erro ?? 'não deu para confirmar']),
        ),
      )
      if (gravados.size > 0) {
        setConfirmados((atual) => ({
          ...atual,
          ...Object.fromEntries(
            entradas
              .filter((e) => gravados.has(e.aluno))
              .map((e) => [e.aluno, { iana: e.iana, fuso: e.cidade || e.iana }]),
          ),
        }))
      }
      if (!r.ok) {
        toast.error(r.mensagem)
        // e não avança: os que faltam continuam no banner, agora sozinhos
        return
      }
      toast.success(r.mensagem)
      avancar()
    })
  }

  function criar() {
    iniciar(async () => {
      const r = await criarContratoAction({
        ramo,
        alunos: escolhidos.filter(Boolean),
        ancora: ramo === 'grupo' ? ancora || null : null,
        rotuloDoGrupo,
        professora: ramo === 'mentoria' ? null : professora || null,
        plano: planoFinal,
        valorCentavos: Number.isFinite(centavos) ? centavos : -1,
        remarcacoes,
        inicio,
        horarios: temEtapaDeHorarios(ramo) ? horariosPreenchidos : [],
      })
      if (!r.ok || !r.criado) {
        toast.error(r.mensagem)
        return
      }
      toast.success(r.mensagem)
      setCriado(r.criado)
    })
  }

  function recomecar() {
    setCriado(null)
    setPasso(1)
    setEscolhidos([''])
    setAncora('')
    setRotuloDoGrupo('')
    setHorarios(HORARIOS_INICIAIS)
    setValor('')
    setPlanoNovo('')
    setInicio(contexto.hojeIso)
  }

  /* ---------------------------------------------------------------- moldura */

  const rodape = (acao: string) => (
    <SheetFooter
      cancel={
        <Link href="/admin/alunos/contratos" className="btn-ac-soft btn-ac-lg">
          Fechar
        </Link>
      }
    >
      {passo > 1 && (
        // Voltar é verdade AQUI (nada foi escrito ainda) — ao contrário do
        // wizard de admissão, onde cada etapa já commitou.
        <button type="button" onClick={() => setPasso((p) => p - 1)} className="btn-ac-soft btn-ac-lg">
          Voltar
        </button>
      )}
      <button type="submit" data-pending={enviando ? '' : undefined} className="btn-ac btn-ac-lg">
        {acao}
      </button>
    </SheetFooter>
  )

  /** Um passo do wizard: form validado (erro inline do kit) + cross-fade. */
  const passoDo = (conteudo: ReactNode, rodapeDo: ReactNode, aoEnviar: (fd: FormData) => void) => (
    <FormValidado
      key={`${ramo}-${passo}`}
      onSubmit={(e) => {
        e.preventDefault()
        aoEnviar(new FormData(e.currentTarget))
      }}
      className="passo-fade flex min-h-0 flex-1 flex-col"
    >
      <SheetBody>
        <Stepper etapas={etapas} atual={passo} aria-label="Etapas do contrato" />
        {conteudo}
      </SheetBody>
      {rodapeDo}
    </FormValidado>
  )

  /* -------------------------------------------------------------- conclusão */

  if (criado) {
    const aluno = criado.alunoId ? alunoPorId.get(criado.alunoId) : undefined
    const proximos = [
      {
        icone: FilePlus2,
        titulo: 'Ver o contrato',
        frase: 'Dados, vigência, horários fixos e créditos — e as ações do dia a dia.',
        href: enderecoDoContrato(criado.contratoId),
      },
      ...(aluno
        ? [
            {
              icone: IdCard,
              titulo: 'Abrir a ficha do aluno',
              frase: 'Contrato, créditos, briefing e histórico da pessoa, num lugar só.',
              href: enderecoDaFicha(aluno.id),
            },
          ]
        : []),
      ...(aluno && !aluno.temAcesso
        ? [
            {
              icone: Mail,
              titulo: 'Convidar para o portal',
              frase: `${aluno.nome} ainda não tem acesso: o e-mail com o link da senha sai daqui.`,
              href: enderecoDaFicha(aluno.id, { painel: 'convidar' }),
            },
          ]
        : []),
      ...(criado.ramo === 'mentoria'
        ? [
            {
              icone: Route,
              titulo: 'Definir o início do curso',
              frase:
                'É a data de acesso à Hotmart que destrava as mentorias — sem ela, nenhum crédito abre.',
              href: '/admin/mentoria',
            },
          ]
        : []),
    ]

    return (
      <div className="passo-fade flex min-h-0 flex-1 flex-col">
        <SheetBody>
          <Stepper etapas={etapas} atual={etapas.length + 1} aria-label="Etapas do contrato" />
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-full bg-ok-wash"
            >
              <Check className="h-6 w-6 text-ok-700" />
            </span>
            <p className="title-section text-ink-900">Contrato criado!</p>
            <p className="max-w-md text-sm leading-relaxed text-ink-600">
              {criado.horarios === 0
                ? 'Ele já aparece na lista de contratos. Nenhum horário fixo foi definido — dá para criar na tela do contrato quando quiser.'
                : `Ele já aparece na lista de contratos, com ${criado.horarios === 1 ? 'um horário fixo' : `${criado.horarios} horários fixos`} e as aulas das próximas semanas na agenda.`}
            </p>
            {criado.promovidos.length > 0 && (
              // A promoção é do banco (gatilho); a tela só CONTA o que aconteceu
              // — quem estava no funil virou aluno da escola.
              <p className="max-w-md text-sm leading-relaxed font-medium text-ink-900">
                {criado.promovidos
                  .map((p) => `${p.nome} ${p.de === 'archived' ? 'voltou a ser' : 'foi promovido a'} Ativo`)
                  .join(' · ')}
                .
              </p>
            )}
          </div>

          <SheetSection title="Próximos passos" hint="Nenhum deles é obrigatório para o contrato valer.">
            <div className="grid grid-cols-1 gap-3">
              {proximos.map(({ icone: Icone, titulo, frase, href }) => (
                <Link
                  key={href}
                  href={href}
                  className="card-kpi card-kpi-interactive flex items-start gap-3 p-4"
                >
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ac-tint"
                  >
                    <Icone className="h-4 w-4 text-ac-deep" />
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-ink-900">{titulo}</span>
                    <span className="text-sm leading-relaxed text-ink-600">{frase}</span>
                  </span>
                </Link>
              ))}
            </div>
          </SheetSection>
        </SheetBody>
        <SheetFooter
          cancel={
            <Link href="/admin/alunos/contratos" className="btn-ac btn-ac-lg">
              Concluir
            </Link>
          }
        >
          <button type="button" onClick={recomecar} className="btn-ac-soft btn-ac-lg">
            Criar outro
          </button>
        </SheetFooter>
      </div>
    )
  }

  /* ------------------------------------------------------------ 1. o tipo  */

  if (nomeDaEtapa === 'Tipo') {
    return passoDo(
      <SheetSection
        title="Que contrato é este"
        hint="A escolha muda o resto do caminho: quem estuda, se há horário fixo e que regras de remarcação valem."
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Tipo de contrato</legend>
          {RAMOS_DO_CONTRATO.map((r) => (
            <label
              key={r}
              className={`flex cursor-pointer gap-3 rounded-card border p-3 transition-colors duration-(--duration-hover) ease-(--ease-out) ${
                ramo === r ? 'border-ac-deep bg-ac-wash' : 'border-line hover:bg-paper-100'
              }`}
            >
              <input
                type="radio"
                name="ramo"
                value={r}
                checked={ramo === r}
                onChange={() => trocarRamo(r)}
                className="mt-1 h-4 w-4 accent-ac-deep"
              />
              <span>
                <span className="block text-sm font-semibold text-ink-900">{RAMO_ROTULO[r]}</span>
                <span className="block text-sm leading-relaxed text-ink-600">
                  {RAMO_CONSEQUENCIA[r]}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </SheetSection>,
      rodape('Continuar'),
      () => avancar(),
    )
  }

  /* ---------------------------------------------------------- 2. o(s) aluno(s) */

  if (nomeDaEtapa === 'Aluno') {
    const grupos = alunosPorSituacao(alunos, SITUACOES)
    const vagas = ramo === 'grupo' ? escolhidos : escolhidos.slice(0, 1)

    const seletor = (i: number) => (
      <Campo
        key={i}
        rotulo={ramo === 'grupo' ? `Aluno ${i + 1}` : 'Aluno'}
        para={`aluno-${i}`}
        exigencia="Escolha o aluno"
        largo={ramo !== 'grupo'}
      >
        <Select
          name={`aluno_${i}`}
          required
          // `defaultValue` (e não `value`): cada etapa REMONTA, então a escolha
          // volta do estado ao voltar — e o Radix não troca de modo controlado
          // no meio do caminho.
          defaultValue={escolhidos[i] || undefined}
          onValueChange={(v) =>
            setEscolhidos((atual) => atual.map((a, j) => (j === i ? v : a)))
          }
        >
          <SelectTrigger id={`aluno-${i}`} className="min-h-11 w-full">
            <SelectValue placeholder="Escolha…" />
          </SelectTrigger>
          <SelectContent className="z-60">
            {grupos.map((g) => (
              <SelectGroup key={g.situacao}>
                {/* Agrupado por SITUAÇÃO: lead, experimental, ativo… é o mesmo
                    vocabulário do hub, e é ele que diz o que a escolha
                    significa (criar contrato para um lead o promove). */}
                <SelectLabel>{g.rotulo}</SelectLabel>
                {g.alunos.map((a) => (
                  <SelectItem
                    key={a.id}
                    value={a.id}
                    // ninguém entra duas vezes na mesma turma
                    disabled={escolhidos.some((e, j) => e === a.id && j !== i)}
                  >
                    {a.nome} · {a.fuso}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </Campo>
    )

    return passoDo(
      <>
        <SheetSection
          title={ramo === 'grupo' ? 'Quem estuda nesta turma' : 'De quem é o contrato'}
          hint={
            ramo === 'grupo'
              ? 'Duas pessoas ou mais dividem a mesma aula e o mesmo contrato. Criar o contrato de um lead o promove a aluno ativo, na mesma transação.'
              : 'Criar o contrato de um lead o promove a aluno ativo, na mesma transação — e quem estava arquivado volta para a lista de trabalho.'
          }
        >
          <GradeDeCampos>
            {vagas.map((_, i) => seletor(i))}
            {ramo === 'grupo' && (
              <Campo
                rotulo="Nome da turma"
                largo
                apoio="é como ela aparece na lista e no extrato"
                exigencia="Informe o nome da turma"
              >
                <input
                  name="rotulo_do_grupo"
                  required
                  value={rotuloDoGrupo}
                  onChange={(e) => setRotuloDoGrupo(e.target.value)}
                  placeholder="ex.: Casal Natália e Yago"
                  className={CAMPO}
                />
              </Campo>
            )}
          </GradeDeCampos>
          {ramo === 'grupo' && escolhidos.length < 4 && (
            <div>
              <button
                type="button"
                onClick={() => setEscolhidos((atual) => [...atual, ''])}
                className="btn-ac-soft"
              >
                Adicionar mais um aluno
              </button>
            </div>
          )}
        </SheetSection>

        {ramo === 'grupo' && (
          <SheetSection
            title="De quem é o relógio"
            hint="Os horários fixos de uma turma são gravados em UM fuso. Escolha de quem — o banco exige essa decisão explícita, e é ela que decide em que instante a aula acontece para todo mundo."
          >
            <Campo
              rotulo="Relógio que rege os horários"
              para="ancora-da-turma"
              exigencia="Escolha de quem é o relógio da turma"
            >
              <fieldset id="ancora-da-turma" className="flex flex-col gap-2">
              {selecionados.length === 0 && (
                <p className="text-sm leading-relaxed text-ink-600">
                  Escolha os alunos acima para dizer de quem é o relógio.
                </p>
              )}
              {selecionados.map((a) => (
                <label key={a.id} className="flex items-start gap-2 text-sm text-ink-900">
                  <input
                    type="radio"
                    name="ancora"
                    value={a.id}
                    required
                    checked={ancora === a.id}
                    onChange={() => setAncora(a.id)}
                    className="mt-1 h-4 w-4 accent-ac-deep"
                  />
                  <span>
                    <span className="font-medium">{a.nome}</span>
                    <span className="block text-ink-600">
                      os horários ficam no relógio de {a.fuso}
                    </span>
                  </span>
                </label>
              ))}
              </fieldset>
            </Campo>
          </SheetSection>
        )}

        {aConfirmar.length > 0 && (
          // O banco recusa contrato de quem tem `tz_confirmed = false` — o fuso
          // ainda é o palpite herdado da escola. Em vez de mandar a pessoa para
          // a ficha e voltar, o ato de confirmação acontece aqui (é a MESMA RPC
          // de sempre, `confirm_student_location`).
          <SheetSection
            title="Falta confirmar de onde essa pessoa fala"
            hint="Sem cidade, o fuso é um palpite herdado da escola — e o banco recusa contrato e horário fixo, porque a aula nasceria no relógio errado. Escolha a cidade e o contrato segue daqui mesmo."
          >
            <GradeDeCampos>
              {aConfirmar.map((a) => (
                <Campo
                  key={a.id}
                  rotulo={`Cidade de ${a.nome}`}
                  largo
                  // c12 · nº 13: quem falhou na tentativa anterior diz O QUÊ,
                  // no próprio campo. Quem passou já saiu desta lista.
                  apoio={
                    errosDeCidade[a.id] ??
                    `hoje a ficha usa ${a.fuso}, sem ninguém ter conferido`
                  }
                  exigencia="Escolha a cidade na lista"
                >
                  <CityPicker
                    tzName={`tz_${a.id}`}
                    cityName={`cidade_${a.id}`}
                    countryName={`pais_${a.id}`}
                    defaultCity={a.cidade || null}
                    defaultCountry={a.pais || null}
                    required
                  />
                </Campo>
              ))}
            </GradeDeCampos>
          </SheetSection>
        )}
      </>,
      rodape(aConfirmar.length > 0 ? 'Confirmar cidade e continuar' : 'Continuar'),
      submeterAlunos,
    )
  }

  /* ------------------------------------------------------------ 3. horários */

  if (nomeDaEtapa === 'Horários') {
    return passoDo(
      <>
        <SheetSection
          title="Com quem o aluno estuda"
          hint="É a professora deste contrato: os horários fixos e o extrato dela dependem desta escolha."
        >
          <GradeDeCampos>
            <Campo rotulo="Professora" para="professora-do-contrato" exigencia="Escolha a professora">
              <Select
                name="teacher_id"
                required
                defaultValue={professora || undefined}
                onValueChange={setProfessora}
              >
                <SelectTrigger id="professora-do-contrato" className="min-h-11 w-full">
                  <SelectValue placeholder="Escolha…" />
                </SelectTrigger>
                <SelectContent className="z-60">
                  {contexto.professoras.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          </GradeDeCampos>
        </SheetSection>

        <SheetSection
          title="Horários fixos"
          hint={`Hora no relógio de ${donoDoRelogio?.fuso ?? 'quem estuda'} — e a agenda da professora ao lado, no mesmo relógio. Deixe em branco para definir depois: o contrato nasce igual, só sem aula marcada.`}
        >
          {horarios.slice(0, MAX_HORARIOS).map((h, i) => (
            <div key={i} className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold text-ink-900">
                {i === 0 ? 'Primeiro horário' : 'Segundo horário'}
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Campo rotulo="Dia da semana" para={`dia-${i + 1}`}>
                  <Select
                    name={`w${i + 1}`}
                    value={String(h.weekday)}
                    onValueChange={(v) => mexerNoHorario(i, { weekday: Number(v) })}
                  >
                    <SelectTrigger id={`dia-${i + 1}`} className="min-h-11 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-60">
                      {DIAS_DA_SEMANA.map((d, wi) => (
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
                    defaultValue={h.hora}
                    className={CAMPO}
                    problema={problemaDoHorario(i)}
                    aoMudar={(v) => mexerNoHorario(i, { hora: v })}
                  />
                </Campo>
                <Campo rotulo="Duração">
                  <ComUnidade id={`unidade-duracao-${i + 1}`} sufixo="min">
                    {/* c13 · nº 10: `max` = o CHECK do banco (15..480 desde o
                        c12 · nº 3) — as duas pontas da faixa dizem o mesmo. */}
                    <input
                      name={`d${i + 1}`}
                      type="number"
                      min="15"
                      max="480"
                      step="5"
                      value={h.duracao}
                      onChange={(e) => mexerNoHorario(i, { duracao: Number(e.target.value) })}
                      aria-describedby={`unidade-duracao-${i + 1}`}
                      className={`${CAMPO} campo-com-unidade pr-12`}
                    />
                  </ComUnidade>
                </Campo>
              </div>
              <JaOcupado
                professoraEscolhida={Boolean(professora)}
                agendaConhecida={agendaConhecida}
                janelas={professora ? janelasDoDia(ocupacao, professora, h.weekday) : []}
              />
            </div>
          ))}
        </SheetSection>
      </>,
      rodape('Continuar'),
      () => avancar(),
    )
  }

  /* ------------------------------------------------------------- 4. valores */

  if (nomeDaEtapa === 'Valores') {
    return passoDo(
      <SheetSection
        title="Quanto custa e desde quando"
        hint="O plano é o nome que aparece na ficha e no extrato. O valor é o da AULA, e é ele que alimenta a cobrança e o extrato da professora."
      >
        <GradeDeCampos>
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
                {contexto.planos.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
                <SelectItem value={PLANO_OUTRO}>Outro…</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          {plano === PLANO_OUTRO && (
            <Campo
              rotulo="Nome do plano novo"
              apoio="ele passa a aparecer na lista dos próximos contratos"
              exigencia="Informe o nome do plano"
            >
              {/* c13 · nº 8: teto de 80 — o nome vai para a lista de planos das
                  próximas telas, e nome colado de PDF a entope.
                  c16 · r6 nº 12: medido em CARACTERES (o `maxLength` contava
                  UTF-16 e travava em 40 emojis, mais apertado que o CHECK do
                  banco). Quem recusa continua sendo o `NovoContratoSchema` e o
                  Postgres; aqui é só o aviso. */}
              <CampoComTeto
                name="plan_name"
                required
                teto={TETO_DO_PLANO}
                frase={`O nome do plano cabe em ${TETO_DO_PLANO} caracteres.`}
                value={planoNovo}
                onChange={(e) => setPlanoNovo(e.target.value)}
                placeholder={contexto.planos.length === 0 ? PLANO_PADRAO : 'ex.: Aulas do casal'}
                className={CAMPO}
              />
            </Campo>
          )}
          <Campo rotulo="Valor da aula" exigencia="Informe o valor da aula">
            <ComUnidade id="unidade-do-valor" prefixo="R$">
              <input
                name="hourly_rate"
                required
                type="number"
                step="0.01"
                min="0"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="ex.: 150,00"
                aria-describedby="unidade-do-valor"
                className={`${CAMPO} pl-10`}
              />
            </ComUnidade>
          </Campo>
          <Campo
            rotulo="Início da vigência"
            apoio="a partir daqui contam as aulas e as cobranças"
            exigencia="Informe a data de início da vigência"
          >
            <DateField
              name="started_on"
              required
              defaultValue={inicio}
              className={CAMPO}
            />
          </Campo>
        </GradeDeCampos>
      </SheetSection>,
      rodape('Continuar'),
      (fd) => {
        // O início vem do hidden do `DateField` (campo mascarado): é o único
        // desta etapa que não vive em estado.
        setInicio(String(fd.get('started_on') ?? contexto.hojeIso))
        avancar()
      },
    )
  }

  /* ------------------------------------------------------------ 5. política */

  if (nomeDaEtapa === 'Política') {
    return passoDo(
      <>
        <SheetSection
          title="Remarcações por mês"
          hint="Quantas vezes este aluno pode remarcar sem perder a aula. É o único número de política que muda de aluno para aluno — de 0 a 10."
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setRemarcacoes((n) => Math.max(0, n - 1))}
              aria-label="Uma remarcação a menos"
              className="btn-ac-soft"
            >
              −
            </button>
            <span
              aria-live="polite"
              className="min-w-16 text-center text-2xl font-semibold tabular-nums text-ink-900"
            >
              {remarcacoes}
            </span>
            <button
              type="button"
              onClick={() => setRemarcacoes((n) => Math.min(10, n + 1))}
              aria-label="Uma remarcação a mais"
              className="btn-ac-soft"
            >
              +
            </button>
            <span className="text-sm leading-relaxed text-ink-600">
              remarcações por mês (o padrão da escola é 4)
            </span>
          </div>
        </SheetSection>

        <SheetSection
          title="O que é fixo para todos"
          hint="Estes três números são da ESCOLA, não deste contrato: mudá-los é decisão global, e por isso eles não são campo aqui."
        >
          <dl className="flex flex-col gap-3">
            {POLICY_LINHAS.map((l) => (
              <div key={l.titulo} className="flex flex-col gap-0.5">
                <dt className="text-sm font-semibold text-ink-900">{l.titulo}</dt>
                <dd className="text-sm leading-relaxed text-ink-600">{l.frase}</dd>
              </div>
            ))}
          </dl>
        </SheetSection>
      </>,
      rodape('Continuar'),
      () => avancar(),
    )
  }

  /* ------------------------------------------------------------- 6. revisão */

  const nomeDaProfessora = contexto.professoras.find((t) => t.id === professora)?.nome ?? '—'
  const linhaDoHorario = (h: HorarioEditado) =>
    `${DIAS_DA_SEMANA[h.weekday]} · ${h.hora} (${h.duracao} min)`

  return passoDo(
    <SheetSection
      title="Confira antes de criar"
      hint="Tudo nasce de uma vez só: turma, contrato e horários fixos. Se algum horário for recusado (conflito na agenda da professora), NADA é criado — você volta e corrige."
    >
      <Pares
        itens={[
          { rotulo: 'Tipo', valor: RAMO_ROTULO[ramo] },
          {
            rotulo: ramo === 'grupo' ? 'Turma' : 'Aluno',
            valor:
              ramo === 'grupo'
                ? `${rotuloDoGrupo || '—'} — ${selecionados.map((a) => a.nome).join(', ')}`
                : (selecionados[0]?.nome ?? '—'),
            largo: true,
          },
          ...(ramo === 'grupo'
            ? [{ rotulo: 'Relógio da turma', valor: donoDoRelogio ? `${donoDoRelogio.nome} · ${donoDoRelogio.fuso}` : '—' }]
            : [{ rotulo: 'Fuso do aluno', valor: donoDoRelogio?.fuso ?? '—' }]),
          ...(ramo === 'mentoria' ? [] : [{ rotulo: 'Professora', valor: nomeDaProfessora }]),
          { rotulo: 'Plano', valor: planoFinal || '—' },
          {
            rotulo: 'Valor da aula',
            valor: Number.isFinite(centavos) && centavos >= 0 ? `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}` : '—',
          },
          { rotulo: 'Início da vigência', valor: inicio },
          ...(temEtapaDeHorarios(ramo)
            ? [
                {
                  rotulo: 'Horários fixos',
                  largo: true,
                  valor:
                    horariosPreenchidos.length === 0
                      ? 'nenhum por enquanto — dá para criar depois, na tela do contrato'
                      : horarios
                          .filter((h) => minutosDeHhmm(h.hora) !== null)
                          .map(linhaDoHorario)
                          .join(' · '),
                },
                { rotulo: 'Remarcações por mês', valor: String(remarcacoes) },
              ]
            : []),
          {
            rotulo: 'Política da escola',
            largo: true,
            valor: `aviso mínimo de ${POLICY.minNotice}h · crédito de reposição ${POLICY.expiryDays} dias · falha da escola ${POLICY.schoolFaultDays} dias`,
          },
        ]}
      />
    </SheetSection>,
    rodape('Criar contrato'),
    () => criar(),
  )
}

/** A agenda que a professora já tem naquele dia — o dado que faltava na tela. */
function JaOcupado({
  janelas,
  professoraEscolhida,
  agendaConhecida,
}: {
  janelas: { inicio: number; quem: string; texto: string }[]
  professoraEscolhida: boolean
  /** a agenda NESTE relógio foi lida? ausente não é o mesmo que vazia */
  agendaConhecida: boolean
}) {
  if (!professoraEscolhida) {
    return (
      <p className="text-sm leading-relaxed text-ink-600">
        Escolha a professora acima para ver o que ela já tem marcado neste dia.
      </p>
    )
  }
  if (!agendaConhecida) {
    return (
      <p className="text-sm leading-relaxed text-ink-600">
        Ainda não li a agenda dela neste fuso — o banco confere o conflito na hora de criar.
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
