// OS QUATRO BLOCOS DE /admin/ajustes (Onda da Agenda · A8).
//
// Eles moram fora da página por duas razões, nesta ordem:
//   1. a página fica com o que é dela — ler a URL, escolher a aba, buscar os
//      dados — e cada bloco fica com o desenho dele;
//   2. bloco exportado é bloco TESTÁVEL. Server Component assíncrono dentro de
//      uma página não é alcançável pela varredura da árvore (a função nunca é
//      chamada); exportado, o teste do A8 o invoca direto e confere a estrutura
//      real — qual form aponta para qual action, que campos viajam escondidos,
//      qual link leva a qual endereço.
//
// Server-safe: o único pedaço de cliente aqui é o `PassoDeHoras` (o [−]/[+] da
// antecedência), e ele é importado, não implementado.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { DateTime } from 'luxon'
import { ArrowUpRight, CalendarRange, Mail, MessageCircle, TriangleAlert } from 'lucide-react'

import { EmptyState } from '@/components/kit/empty-state'
import { FormValidado } from '@/components/kit/form-validado'
import { Pill } from '@/components/kit/pill'
import { PassoDeHoras } from '@/components/admin/ajustes/PassoDeHoras'
import { setTeacherPolicyAction } from '@/app/admin/ajustes/actions'
import { lerRascunho } from '@/lib/admin/rascunho-do-formulario'
import type {
  BlocoDeIntegracoes,
  ContratoForaDoPadrao,
  DadosDosAjustes,
  Integracao,
  PoliticaDaProfessora,
} from '@/data/admin/ajustes'
import {
  PADRAO_DA_ESCOLA,
  POLITICAS_DE_FERIADO,
  avisoDePoliticaDesconhecida,
  chaveDaPolitica,
  ehPoliticaDeFeriado,
} from '@/data/admin/ajustes-gramatica'
import { catalogoDeMensagens, SEM_TEMPLATE_NA_META } from '@/data/admin/ajustes-mensagens'

/* ========================================================================== */
/* O PISO DE DADO (Sol · rodada 1 do A8, médio 8)                              */
/* ========================================================================== */

/**
 * Tudo o que RESPONDE À PERGUNTA da tela é DADO, e DADO tem piso de leitura.
 *
 * A primeira versão punha as pílulas de estado ("funcionando", "não
 * verificado", "não ligada", "pausado") em `text-xs` — o tamanho do rótulo
 * decorativo. Só que a pergunta que se faz ao abrir Integrações é exatamente
 * "isto está funcionando?", e a resposta não pode ser o menor texto da tela. O
 * mesmo vale para o fuso da professora, o plano do contrato e a data do último
 * sinal: os três respondem perguntas, os três estavam em corpo de apoio.
 *
 * A `Pill` do kit nasce `text-xs` (é o certo para o uso dela em tabela densa);
 * aqui ela é vestida por fora, sem tocar no kit.
 */
const PILULA_DADO = 'text-sm'

/* ========================================================================== */
/* Peça comum: a linha explicada                                               */
/* ========================================================================== */

/**
 * A anatomia do TutorBird para configuração: NOME do ajuste + a frase que diz o
 * que ele faz, à esquerda; o controle, à direita. É o oposto do formulário cru
 * (rótulo de duas palavras + campo), e é o que permite mudar uma regra de
 * negócio sem abrir a documentação.
 */
export function LinhaDeAjuste({
  titulo,
  explicacao,
  children,
}: {
  titulo: string
  explicacao: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-line-soft py-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="flex max-w-md flex-col gap-1">
        <p className="text-sm font-semibold text-ink-900">{titulo}</p>
        <p className="text-sm leading-relaxed text-ink-600">{explicacao}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/* ========================================================================== */
/* 1 · Política de remarcação                                                  */
/* ========================================================================== */

export function BlocoDaPolitica({ dados }: { dados: DadosDosAjustes }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h3 className="title-section text-ink-900">Política de remarcação</h3>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-600">
          Estas duas regras valem por professora e mudam o que o sistema aceita a partir de agora —
          aulas e créditos que já existem não são tocados.
        </p>
      </div>

      {dados.professoras.length === 0 ? (
        <EmptyState
          title="Nenhuma professora cadastrada."
          hint="A política é de cada professora. Cadastre uma em Professoras e ela aparece aqui."
          cta="Ir para Professoras"
          href="/admin/professoras"
        />
      ) : (
        <div className="flex flex-col gap-4">
          {dados.professoras.map((p) => (
            <PoliticaDaProfessoraCard key={p.id} professora={p} />
          ))}
        </div>
      )}

      <ContratosForaDoPadrao
        contratos={dados.contratosForaDoPadrao}
        conferidos={dados.contratosConferidos}
      />
    </div>
  )
}

/** O cartão editável de UMA professora. */
export async function PoliticaDaProfessoraCard({
  professora,
}: {
  professora: PoliticaDaProfessora
}) {
  // O que ela escolheu antes de o banco recusar (cookie de vida curta, chave
  // POR PROFESSORA — ver `chaveDaPolitica`). Vazio no caminho normal.
  const rascunho = await lerRascunho(chaveDaPolitica(professora.id))
  const horasCruas = Number(rascunho.lead_hours)
  // Rascunho ausente ou ilegível ("12abc", que o próprio erro recusou) reabre com
  // o valor do BANCO — nunca com um número inventado. O campo vazio de verdade
  // vive no cliente (`PassoDeHoras`), que é onde ela o esvazia.
  const horas = Number.isInteger(horasCruas) ? horasCruas : professora.antecedenciaHoras
  // A política DESCONHECIDA (baixo 10) chega `null` e não é adivinhada: nenhum
  // rádio nasce marcado, e o `required` deles impede salvar sem escolha.
  const feriado = ehPoliticaDeFeriado(rascunho.holiday_policy)
    ? rascunho.holiday_policy
    : professora.feriado

  return (
    <section className="rounded-card border border-line bg-paper-0 p-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line pb-4">
        <h4 className="text-sm font-semibold text-ink-900">{professora.nome}</h4>
        {professora.ehDona && <Pill tone="ac" className={PILULA_DADO}>dona</Pill>}
        {/* fuso é DADO: é ele que decide a que horas a regra vale */}
        <span className="text-sm font-medium text-ink-900">fuso de {professora.cidade}</span>
      </header>

      <FormValidado action={setTeacherPolicyAction} className="flex flex-col">
        <input type="hidden" name="teacher_id" value={professora.id} />
        <input type="hidden" name="back" value="/admin/ajustes" />
        <input type="hidden" name="back_erro" value="/admin/ajustes" />
        <input type="hidden" name="manter" value="lead_hours,holiday_policy" />
        <input type="hidden" name="rascunho" value={chaveDaPolitica(professora.id)} />

        <div className="flex flex-col pt-4">
          <LinhaDeAjuste
            titulo="Antecedência mínima para marcar"
            explicacao="Quanto tempo antes da aula o aluno ainda consegue remarcar ou usar um crédito para marcar um horário novo com esta professora."
          >
            <PassoDeHoras
              name="lead_hours"
              valorInicial={horas}
              rotulo={`antecedência mínima de ${professora.nome}`}
            />
          </LinhaDeAjuste>

          <LinhaDeAjuste
            titulo="Aulas em feriado"
            explicacao="O que o sistema propõe quando um feriado brasileiro cai em cima das aulas dela."
          >
            {/* `data-slot="campo"` para o `FormValidado` ter onde acender o erro
                — sem ele o rádio ficaria `aria-invalid` sem frase (médio 6). */}
            <div data-slot="campo" className="flex flex-col gap-1.5">
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Aulas em feriado — {professora.nome}</legend>
                {feriado === null && (
                  // BAIXO 10: o banco guarda uma política que esta tela não
                  // conhece. Ela não é adivinhada nem sobrescrita em silêncio —
                  // a tela diz o que está lá e pede uma escolha.
                  <p
                    role="status"
                    className="max-w-md rounded-input border border-warn-700/40 bg-warn-wash p-3 text-sm leading-relaxed font-medium text-warn-700"
                  >
                    {avisoDePoliticaDesconhecida(professora.feriadoCru)}
                  </p>
                )}
                {POLITICAS_DE_FERIADO.map((op) => (
                  <label
                    key={op.valor}
                    className="flex min-h-11 max-w-md cursor-pointer items-start gap-3 rounded-input border border-line px-3 py-2.5 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-paper-100 has-checked:border-ac-deep has-checked:bg-ac-wash"
                  >
                    <input
                      type="radio"
                      name="holiday_policy"
                      value={op.valor}
                      required
                      defaultChecked={feriado === op.valor}
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--ac-deep)]"
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-ink-900">{op.rotulo}</span>
                      <span className="text-sm leading-relaxed text-ink-600">
                        {op.consequencia}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <p
                data-slot="campo-erro"
                data-exigencia="Escolha o que fazer com as aulas em feriado."
                role="alert"
                hidden
                className="flex items-start gap-1.5 text-sm leading-relaxed text-danger-700"
              >
                <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <span data-slot="campo-erro-texto">
                  Escolha o que fazer com as aulas em feriado.
                </span>
              </p>
            </div>
          </LinhaDeAjuste>
        </div>

        <div className="flex justify-end border-t border-line-soft pt-4">
          <button type="submit" className="btn-ink">
            Salvar política
          </button>
        </div>
      </FormValidado>
    </section>
  )
}

/**
 * O ÍNDICE, em leitura, dos contratos que fogem do padrão da escola.
 *
 * Ele não edita nada de propósito: as três regras são de CONTRATO e já têm um
 * editor — o painel "Regras" da ficha do contrato, que é transacional, auditado
 * e sabe recusar o que o banco recusa. Um segundo editor aqui seria a segunda
 * fonte de verdade que esta tela inteira existe para não criar.
 */
export function ContratosForaDoPadrao({
  contratos,
  conferidos,
}: {
  contratos: ContratoForaDoPadrao[]
  conferidos: number
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6">
      <div className="flex flex-col gap-1">
        <h3 className="title-section text-ink-900">Contratos fora do padrão</h3>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-600">
          O padrão da escola é {PADRAO_DA_ESCOLA.alcada} remarcações por mês, aviso mínimo de{' '}
          {PADRAO_DA_ESCOLA.avisoHoras} horas e crédito válido por {PADRAO_DA_ESCOLA.validadeDias}{' '}
          dias. Quem foge dele aparece abaixo. Estas regras são de cada contrato: quem as muda é a
          ficha do contrato, não esta tela.
        </p>
      </div>

      {contratos.length === 0 ? (
        <p className="text-sm font-medium text-ink-900">
          {conferidos === 0
            ? 'Nenhum contrato vivo para conferir.'
            : `Os ${conferidos} contratos vivos seguem o padrão da escola.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {contratos.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-3 rounded-card border border-line bg-paper-0 p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-ink-900">{c.quem}</span>
                  {/* o plano é DADO (é ele que identifica o contrato) */}
                  <span className="text-sm font-medium text-ink-900">{c.plano}</span>
                  {c.pausado && (
                    <Pill tone="warn" className={PILULA_DADO}>
                      pausado
                    </Pill>
                  )}
                </div>
                <ul className="flex flex-col gap-1">
                  {c.desvios.map((d) => (
                    <li key={d.rotulo} className="text-sm text-ink-600">
                      {d.rotulo}: <span className="font-medium text-ink-900">{d.valor}</span>{' '}
                      <span className="text-ink-600">(padrão: {d.padrao})</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Link href={`/admin/contratos/${c.id}`} className="btn-paper self-start">
                Abrir o contrato
                <ArrowUpRight aria-hidden className="h-4 w-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ========================================================================== */
/* 2 · Janelas                                                                 */
/* ========================================================================== */

/**
 * PONTE, não editor (decisão registrada no goal). A camada de disponibilidade
 * nasceu no A3 dentro da Agenda, ancorada na semana que ela pinta; o painel de
 * lá exige a professora filtrada, e é exatamente esse endereço que os links
 * abaixo montam — um por professora, já com o filtro e o painel abertos.
 */
export function BlocoDasJanelas({ professoras }: { professoras: PoliticaDaProfessora[] }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="title-section text-ink-900">Janelas de horário</h3>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-600">
          As janelas semanais e os bloqueios de cada professora moram na Agenda, junto da semana que
          eles pintam — é lá que se cria, se muda e se remove. Esta tela não tem um segundo editor
          de propósito: duas telas para a mesma semana é como elas passam a discordar.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-ink-900">Abrir as janelas de:</p>
        {professoras.length === 0 ? (
          <p className="text-sm text-ink-600">Nenhuma professora cadastrada ainda.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {professoras.map((p) => (
              <li key={p.id}>
                <Link href={`/admin/agenda?prof=${p.id}&novo=disponibilidade`} className="btn-paper">
                  <CalendarRange aria-hidden className="h-4 w-4" />
                  {p.nome}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ========================================================================== */
/* 3 · Templates de mensagem                                                   */
/* ========================================================================== */

export function BlocoDasMensagens({ agora }: { agora: DateTime }) {
  // O relógio ENTRA pela prop (Lei 1: quem formata é a função da mensagem, no
  // fuso do destinatário; a tela só diz que horas são). O teste passa um
  // instante fixo e cobra as datas do exemplo.
  const blocos = catalogoDeMensagens(agora)

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h3 className="title-section text-ink-900">Mensagens que a escola envia</h3>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-600">
          Tudo o que sai automaticamente para o aluno, com o motivo que faz cada uma sair. Os
          exemplos usam uma aluna fictícia e datas dos próximos dias; no WhatsApp, os valores são os
          exemplos que vão para a Meta junto com cada template. Mudar um texto continua sendo
          tarefa de programação — aqui é só para conferir o que está sendo dito.
        </p>
      </div>

      {blocos.map((grupo) => (
        <section key={grupo.titulo} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold text-ink-900">{grupo.titulo}</h4>
            <p className="max-w-2xl text-sm leading-relaxed text-ink-600">{grupo.explicacao}</p>
          </div>

          <ul className="flex flex-col gap-3">
            {grupo.mensagens.map((m) => (
              <li key={m.nome} className="rounded-card border border-line bg-paper-0 p-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-ink-900">{m.nome}</span>
                  {m.canais.map((canal) => (
                    <Pill key={canal} tone="neutral">
                      {canal === 'E-mail' ? (
                        <Mail aria-hidden className="mr-1 h-3 w-3" />
                      ) : (
                        <MessageCircle aria-hidden className="mr-1 h-3 w-3" />
                      )}
                      {canal}
                    </Pill>
                  ))}
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{m.gatilho}</p>

                {m.assunto && (
                  <p className="mt-3 text-sm text-ink-600">
                    Assunto: <span className="font-medium text-ink-900">{m.assunto}</span>
                  </p>
                )}
                {m.corpoEmail && <CorpoDaMensagem titulo="E-mail" texto={m.corpoEmail} />}
                {m.semTemplateNaMeta && (
                  <p className="mt-3 text-sm text-ink-600">
                    WhatsApp:{' '}
                    <span className="font-medium text-ink-900">{SEM_TEMPLATE_NA_META}</span>
                  </p>
                )}
                {m.whatsapp.map((v) => (
                  <CorpoDaMensagem
                    key={v.nomeNaMeta ?? 'sem-template'}
                    titulo={v.rotulo ? `WhatsApp · ${v.rotulo}` : 'WhatsApp'}
                    texto={v.corpo}
                    nomeNaMeta={v.nomeNaMeta}
                  />
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** O corpo da mensagem como a pessoa lê — texto puro, quebras preservadas. No
 *  WhatsApp, com o nome do template na Meta (#41): é por ele que a dona acha o
 *  texto no painel da Meta. */
export function CorpoDaMensagem({
  titulo,
  texto,
  nomeNaMeta = null,
}: {
  titulo: string
  texto: string
  nomeNaMeta?: string | null
}) {
  return (
    <div className="mt-3">
      <p className="text-xs font-bold tracking-wide text-ink-400 uppercase">{titulo}</p>
      {nomeNaMeta && (
        <p className="mt-1 text-sm text-ink-600">
          Nome na Meta: <span className="text-sm font-medium text-ink-900">{nomeNaMeta}</span>
        </p>
      )}
      <p className="mt-1 max-w-2xl text-sm leading-relaxed whitespace-pre-line text-ink-900">
        {texto}
      </p>
    </div>
  )
}

/* ========================================================================== */
/* 4 · Integrações                                                             */
/* ========================================================================== */

/**
 * O TOM DE CADA SITUAÇÃO.
 *
 * "Não verificado" NÃO é verde e NÃO é vermelho: verde seria a mentira que o A8
 * proíbe, e vermelho gritaria defeito onde só há ignorância. Fica neutro, com a
 * frase dizendo por quê.
 *
 * "Falhando" nasceu na correção da rodada 1 (grave 2) e é o único VERMELHO da
 * lista: é o estado em que o app SABE que deu errado — o último aviso do
 * parceiro não pôde ser processado, ou a última sincronização falhou. Antes ele
 * não existia, e o defeito conhecido tinha de escolher entre se disfarçar de
 * "funcionando" ou de "não verificado". Nenhum dos dois é verdade.
 */
const TOM_DA_SITUACAO = {
  ligada: { tom: 'ok' as const, rotulo: 'funcionando' },
  falhando: { tom: 'danger' as const, rotulo: 'com falha' },
  nao_verificada: { tom: 'neutral' as const, rotulo: 'não verificado' },
  desligada: { tom: 'muted' as const, rotulo: 'não ligada' },
}

export function BlocoDasIntegracoes({ bloco }: { bloco: BlocoDeIntegracoes }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="title-section text-ink-900">Integrações</h3>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-600">
          Os serviços de fora com que o sistema conversa. “Funcionando” só aparece quando o
          aplicativo viu o serviço TRABALHAR — um aviso que chegou e foi processado, uma
          sincronização que rodou — e só se isso foi recente; quando ele não tem como saber, diz que
          não sabe em vez de dar por certo. Nenhuma senha ou chave é mostrada aqui.
        </p>
      </div>

      {!bloco.ok ? (
        /* A FALHA DE LEITURA FICA CONTIDA AQUI (médio 7): ela não derruba as
           outras três abas, e não se disfarça de "não verificado" — dizer "não
           sei" quando o que houve foi um erro seria a mentira que este bloco
           existe para não contar. */
        <p
          role="alert"
          className="rounded-card border border-danger-700/40 bg-danger-wash p-4 text-sm leading-relaxed font-medium text-danger-700"
        >
          {bloco.motivo}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {bloco.lista.map((i) => (
            <CartaoDaIntegracao key={i.nome} integracao={i} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function CartaoDaIntegracao({ integracao: i }: { integracao: Integracao }) {
  const { tom, rotulo } = TOM_DA_SITUACAO[i.situacao]
  return (
    <li className="rounded-card border border-line bg-paper-0 p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-ink-900">{i.nome}</span>
        {/* a pílula É a resposta da tela: piso de DADO, nunca text-xs (médio 8) */}
        <Pill tone={tom} className={PILULA_DADO}>
          {rotulo}
        </Pill>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-ink-600">{i.paraQue}</p>
      <p className="mt-2 text-sm font-medium text-ink-900">{i.frase}</p>
      {/* a data do último sinal é DADO: é ela que deixa a dona discordar da régua */}
      {i.evidencia && <p className="mt-1 text-sm font-medium text-ink-900">{i.evidencia}</p>}
      {i.alerta && <p className="mt-2 text-sm font-medium text-danger-700">{i.alerta}</p>}
    </li>
  )
}
