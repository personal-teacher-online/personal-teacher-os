// MENTORIA PERSONAL TRAVEL (Onda do Portal · P5) — REFORMA VISUAL, e só.
//
// Decisão do dono (28/07): a integração Hotmart é da Fase 5; aqui a bridge
// continua manual (a admin lança `course_start_date` e `completion_pct`). Este
// arquivo NÃO muda dado, RPC, elegibilidade nem escada — as mesmas sete
// consultas de antes, o mesmo `book_my_mentorship_session`, o mesmo corte de 24h
// para o autocancelamento. O que muda é o esqueleto (cartões do kit, títulos e
// botões da onda) e a ESCADA, que deixou de ser uma fileira de bolinhas sem
// legenda e passou a dizer em palavras o que cada etapa é: usada · liberada ·
// ainda bloqueada.
//
// A RODADA DE CORREÇÃO mexeu na escada de novo — sempre no DESENHO, nunca na
// regra. Dois defeitos de LEITURA:
//
//   1. As etapas usadas vinham de CONTAGEM (`i < spent`). Depois de um estorno
//      da etapa 2, com 1 e 3 gastas, a tela pintava 1 e 2 — escondendo o buraco
//      que o banco vai preencher primeiro (`mentorship_next_window` = MENOR
//      etapa com gasto líquido zero). Agora cada degrau lê o `window_index` REAL
//      das reservas ativas.
//   2. "liberada" queria dizer "a janela do tempo abriu" (`i < unlocked`), mas
//      reservar exige TAMBÉM o threshold de progresso da etapa (D2/ADR-006). A
//      tela prometia o que a RPC ia recusar. Agora só a PRÓXIMA etapa pode ser
//      "liberada", e só quando `mentorship_can_book` confirma; janela aberta sem
//      confirmação tem palavra própria.
//
// A UI só ANTECIPA a elegibilidade (Lei 3) — quem decide é o banco, sob os locks
// do motor — e exibe todo horário no fuso do ALUNO (Lei 1: Luxon só formata).
//
// A ação de reservar e a de cancelar passaram ao cookie de flash (P5): o recado
// é pintado pela moldura do portal, com e sem JavaScript, e esta tela não lê
// mais `msg` da URL.
import Link from 'next/link'
import { one } from '@/lib/embed'
import { fmtLocal } from '@/lib/format'
import {
  contratoDeMentoriaAtivo,
  encontrosReservados,
  reservasDeMentoria,
  type EncontroReservado,
} from '@/lib/portal/data'
import {
  PALAVRA_DO_DEGRAU,
  SEM_LINK_DA_SALA,
  datasParaReservar,
  encontroAindaNaoAcabou,
  encontrosDaTela,
  escadaDasReservas,
  esperandoProgresso,
  estadoDoDegrau,
  fraseDoCancelamento,
  numeroDaEtapa,
  podeCancelarNaTela,
} from '@/lib/portal/mentoria'
import { createClient } from '@/lib/supabase/server'
import { AvisoDeLeitura } from '@/components/portal/AvisoDeLeitura'
import { BotaoDeAcao } from '@/components/portal/BotaoDeAcao'
import { EmptyState } from '@/components/kit/empty-state'
import { Pill } from '@/components/kit/pill'
import { FALE_COM_A_GENTE, WHATSAPP_ATENDIMENTO_URL } from '@/lib/contact'
import { bookMentorshipSessionAction, cancelMyMentorshipBookingAction } from '../actions'

export const metadata = { title: 'Mentoria Personal Travel — Personal Teacher Academy' }

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-col gap-5">
      <header>
        <h1 className="title-page text-ink-900">Personal Travel</h1>
        <p className="mt-1 text-sm text-ink-600">Suas mentorias em grupo.</p>
      </header>
      {children}
    </main>
  )
}

export default async function MentoriaPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ escolha?: string }>
}) {
  const { escolha } = await searchParams
  const supabase = await createClient()

  // UM relógio por request, lido AQUI e não no meio do JSX (revisão adversarial
  // nº 1, C11b): `Date.now()` dentro do map da lista é chamada impura durante o
  // render — o mesmo componente podia decidir diferente em dois pontos do mesmo
  // desenho. É época pura (nenhuma conversão de fuso; o texto da tela continua
  // saindo de `fmtLocal` com a zona do aluno).
  // O corte de 24h do autocancelamento sai do mesmo relógio, em `SuasReservas`.
  const agora = new Date()

  // A MESMA pergunta que decide a aba Mentoria no shell, no MESMO lugar
  // (P1): antes o layout filtrava `status` no SQL e esta página filtrava em
  // JS — duas cópias do critério de elegibilidade. RLS já limita aos contratos
  // do próprio aluno; a defesa abaixo continua, porque deep link existe.
  const { contrato: contract, erro: erroDoContrato } = await contratoDeMentoriaAtivo(supabase)

  // Falha de LEITURA não é ausência de contrato (F4): dizer "você não faz parte
  // do programa" a um mentorado por causa de um erro transitório é a pior das
  // duas mentiras possíveis aqui. O caminho de erro tem tela própria.
  if (erroDoContrato)
    return (
      <Moldura>
        <AvisoDeLeitura oQue="as suas mentorias" />
      </Moldura>
    )

  if (!contract) {
    // O CONTRATO TERMINOU, O ENCONTRO NÃO (#118, rodada 2). A reserva ativa de
    // um encontro que ainda não aconteceu continua sendo dela, com data e link
    // da sala, mesmo sem contrato ativo. Escada e reserva nova continuam
    // exigindo contrato ativo (a RPC de reserva confere de novo).
    const [lidos, { data: meRowsSemContrato }] = await Promise.all([
      encontrosReservados(supabase),
      supabase.from('students').select('iana_tz').limit(1),
    ])
    if (lidos.erro)
      return (
        <Moldura>
          <AvisoDeLeitura oQue="as suas mentorias" />
        </Moldura>
      )
    const porVir = encontrosDaTela(lidos.dado, null, agora.getTime())
    if (porVir.length === 0)
      return (
        <Moldura>
          <EmptyState
            title="Você não faz parte do programa Personal Travel."
            hint={`A mentoria em grupo é exclusiva dos alunos do curso — se acha que isso é um engano, ${FALE_COM_A_GENTE}.`}
            cta="← Voltar ao início"
            href="/portal"
          />
        </Moldura>
      )
    return (
      <Moldura>
        <SuasReservas
          encontros={porVir}
          contratoAtivo={null}
          tz={one(meRowsSemContrato)?.iana_tz ?? 'America/Cuiaba'}
          agoraMs={agora.getTime()}
        />
        {/* a reserva de outro contrato vai para o atendimento: o canal fica na tela */}
        <Atendimento />
      </Moldura>
    )
  }

  const [
    { data: mc },
    { data: unlockedRaw },
    { data: canBookRaw },
    { data: progress },
    { data: meRows },
    { data: sessions, error: erroDasDatas },
    reservas,
    encontrosLidos,
  ] = await Promise.all([
    supabase
      .from('mentorship_contracts')
      .select('total_credits, window_months, course_start_date')
      .eq('contract_id', contract.id)
      .maybeSingle(),
    // Janelas destravadas: função pura computada das datas (Lei 2 — nunca job).
    supabase.rpc('mentorship_windows_unlocked', { p_contract: contract.id }),
    supabase.rpc('mentorship_can_book', { p_contract: contract.id }),
    supabase.from('course_progress').select('completion_pct').eq('contract_id', contract.id).maybeSingle(),
    supabase.from('students').select('iana_tz').limit(1),
    // AS DATAS PARA RESERVAR. A RLS devolve as sessões abertas e também as que
    // o mentorado reservou, mesmo lotadas (#118); a lista fica só com as
    // abertas e não reservadas (`datasParaReservar`). O corte aqui é pelo
    // COMEÇO: data que já começou não é data para reservar. As reservadas têm
    // leitura própria, logo abaixo, sem esse corte.
    supabase
      .from('mentorship_sessions')
      .select('id, scheduled_at, duration_min, capacity, booked_count, gmeet_url, status')
      .gte('scheduled_at', agora.toISOString())
      .order('scheduled_at'),
    // A ETAPA DE CADA RESERVA VEM JUNTO (correção do P5). A escada era desenhada
    // por CONTAGEM, e contagem não sabe QUAL etapa foi usada: depois de um
    // estorno da etapa 2, com as etapas 1 e 3 gastas, a tela pintava 1 e 2 como
    // usadas e escondia justamente o buraco que o banco vai preencher na
    // próxima reserva. Quem lê a etapa é `reservasDeMentoria`.
    reservasDeMentoria(supabase, contract.id),
    // OS ENCONTROS RESERVADOS (#118): de TODOS os contratos do aluno, com data e
    // link da sala, sem corte pelo começo (o encontro que já começou mantém o
    // link). A escada continua lendo só as reservas deste contrato, acima.
    encontrosReservados(supabase),
  ])

  // ESCADA FALSA NÃO SE PUBLICA (rodada 2 da revisão; mesma régua do C6 do P3).
  // Com a leitura das reservas falhando, `dado` vem VAZIO — indistinguível de
  // "nenhuma mentoria usada". A escada desenhada em cima disso mostraria os seis
  // degraus livres e a etapa 1 como a próxima: um SALDO inventado, na tela onde
  // o aluno decide gastar crédito.
  //
  // O AVISO É POR SEÇÃO (#118, rodada 2): a falha de uma leitura troca só a
  // seção que depende dela, e o aviso entra NO LUGAR dela, não embaixo. O link
  // da sala de uma reserva lida com sucesso não some porque a escada falhou.
  //   - escada: depende das reservas deste contrato;
  //   - datas: dependem das datas, da escada (é ali que se gasta crédito) e dos
  //     encontros reservados (sem eles, a lista ofereceria o que a RPC recusa);
  //   - reservadas: dependem só dos encontros reservados.
  const totalCredits = Number(mc?.total_credits ?? 6)
  const unlocked = Number(unlockedRaw ?? 0)
  const canBook = Boolean(canBookRaw)
  const pct = progress?.completion_pct ?? null
  const tz = one(meRows)?.iana_tz ?? 'America/Cuiaba'
  const escada = reservas.erro ? null : escadaDasReservas(reservas.dado, totalCredits, unlocked, canBook)
  const spent = reservas.dado.length
  const faltaProgresso = escada != null && esperandoProgresso(escada)
  const encontros = encontrosLidos.erro ? null : encontrosDaTela(encontrosLidos.dado, contract.id, agora.getTime())
  const datasConfiaveis = escada != null && encontros != null && !erroDasDatas
  // As sessões reservadas por QUALQUER contrato do aluno saem das datas.
  const jaReservadas = new Set((encontros ?? []).map((e) => e.sessionId))
  const disponiveis = datasConfiaveis ? datasParaReservar(sessions, jaReservadas) : []
  const escolhida = escolha ? disponiveis.find((s) => s.id === escolha) : undefined
  // Dois contratos ativos (renovação em curso): nenhum cancelamento pela tela,
  // porque não dá para saber em qual contrato o crédito voltaria.
  const contratoDaLista = contract.varios ? null : contract.id

  return (
    <Moldura>
      {/* ------------------------------------------------------ a escada */}
      {escada == null ? (
        <AvisoDeLeitura oQue="as suas mentorias liberadas" tentarEm="/portal/mentoria" />
      ) : (
      <section className="card-ac flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium text-ink-600">Suas mentorias do curso</span>
          {/* Com a janela aberta e o progresso pendente, "aguarde a próxima
              liberação" manda esperar a coisa errada (o calendário, e não o
              curso). Três estados, três frases. */}
          <Pill tone={canBook ? 'ok' : 'muted'}>
            {canBook
              ? 'você pode reservar'
              : faltaProgresso
                ? 'depende do seu progresso'
                : 'aguarde a próxima liberação'}
          </Pill>
        </div>

        <p className="text-base font-semibold text-ink-900 tabular-nums">
          {unlocked} de {totalCredits} mentorias liberadas · {spent} usada{spent === 1 ? '' : 's'}
        </p>

        {/* A ESCADA COM LEGENDA (P5): um degrau por mentoria, cada um com o
            próprio nome. A fileira de bolinhas sem rótulo obrigava a pessoa a
            adivinhar a cor — e um `title` no conjunto inteiro não existe para
            quem navega no dedo. */}
        <ol className="flex flex-wrap gap-1.5">
          {Array.from({ length: totalCredits }, (_, i) => {
            const etapa = numeroDaEtapa(i)
            const estado = estadoDoDegrau(etapa, escada)
            return (
              <li
                key={etapa}
                className={`flex min-w-0 flex-1 basis-20 flex-col gap-0.5 rounded-input px-2 py-2 text-center ${
                  estado === 'usada'
                    ? 'bg-ink-900 text-white'
                    : estado === 'liberada'
                      ? 'bg-ac-deep/10 text-ac-deep'
                      : 'border border-line text-ink-600'
                }`}
              >
                <span className="text-sm font-semibold tabular-nums">{etapa}</span>
                {/* text-sm, nunca `text-[11px]`/`ink-400`: isto é DADO, e a régua
                    da casa não deixa dado em letra miúda cinza-claro. */}
                <span className="text-sm leading-tight font-medium">
                  {PALAVRA_DO_DEGRAU[estado]}
                </span>
              </li>
            )
          })}
        </ol>

        <p className="text-sm text-ink-600">
          Uma mentoria é liberada a cada {mc?.window_months ?? 2} meses de curso
          {pct != null ? ` · você já concluiu ${pct}% do curso` : ''}.
        </p>

        {/* A frase que o degrau sozinho não cabe: a janela do tempo já abriu, e o
            que falta é progresso no curso. Dizer só "a liberar" mandaria a pessoa
            esperar o calendário — que não é o que a segura. */}
        {faltaProgresso && (
          <p className="text-sm text-ink-600">
            A mentoria {escada.proxima} está com a janela aberta — a liberação depende do seu
            progresso no curso.
          </p>
        )}
      </section>
      )}

      {!datasConfiaveis ? (
        <AvisoDeLeitura oQue="as datas disponíveis" tentarEm="/portal/mentoria" />
      ) : escolhida ? (
        /* --------------------------------------- passo de revisão (gastar) */
        <section className="card-ac flex flex-col gap-4 p-5">
          <h2 className="title-section text-ink-900">Confira antes de confirmar:</h2>
          <p className="text-sm text-ink-600">
            Sua mentoria:{' '}
            <strong className="text-ink-900 first-letter:uppercase">{fmtLocal(escolhida.scheduled_at, tz)}</strong>{' '}
            <span className="text-xs">(seu horário)</span>
          </p>
          <p className="text-sm text-ink-600">Isso usa 1 das suas mentorias liberadas.</p>
          <BotaoDeAcao
            acao={bookMentorshipSessionAction}
            campos={{ session_id: escolhida.id }}
            rotulo="Confirmar reserva"
            rotuloEnviando="Confirmando…"
          />
          <Link
            href="/portal/mentoria"
            className="text-center text-sm font-semibold text-ink-600 hover:text-ink-900"
          >
            ← escolher outra data
          </Link>
        </section>
      ) : (
        /* ------------------------------------------------ datas disponíveis */
        <section className="flex flex-col gap-3">
          <h2 className="title-section text-ink-900">Datas disponíveis</h2>
          {disponiveis.length === 0 ? (
            <EmptyState
              title="Nenhuma data aberta no momento."
              hint="Avisamos você assim que abrir uma nova data."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {disponiveis.map((s) => {
                const vagas = Math.max(0, Number(s.capacity) - Number(s.booked_count))
                return (
                  <li key={s.id}>
                    {vagas === 0 ? (
                      <div className="card-ac flex items-center justify-between gap-3 p-4">
                        <span className="min-w-0">
                          <span className="block font-semibold text-ink-900 first-letter:uppercase">
                            {fmtLocal(s.scheduled_at, tz)}
                          </span>
                          <span className="mt-0.5 block text-sm text-ink-600">{s.duration_min} min</span>
                        </span>
                        <Pill tone="muted">lotada</Pill>
                      </div>
                    ) : (
                      <Link
                        href={`/portal/mentoria?escolha=${s.id}`}
                        className="card-ac card-ac-interactive flex items-center justify-between gap-3 p-4"
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold text-ink-900 first-letter:uppercase">
                            {fmtLocal(s.scheduled_at, tz)}
                          </span>
                          <span className="mt-0.5 block text-sm text-ink-600">
                            {s.duration_min} min · {vagas} vaga{vagas === 1 ? '' : 's'}
                          </span>
                        </span>
                        <span className="text-sm font-semibold whitespace-nowrap text-ac-deep">reservar →</span>
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {/* --------------------------------------------------- suas reservas */}
      {encontros == null ? (
        <AvisoDeLeitura oQue="as suas mentorias reservadas" tentarEm="/portal/mentoria" />
      ) : (
        <SuasReservas encontros={encontros} contratoAtivo={contratoDaLista} tz={tz} agoraMs={agora.getTime()} />
      )}

      <Atendimento />
    </Moldura>
  )
}

function Atendimento() {
  if (!WHATSAPP_ATENDIMENTO_URL) return null
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-sm text-ink-600">Dúvidas sobre as suas mentorias?</p>
      <a href={WHATSAPP_ATENDIMENTO_URL} target="_blank" rel="noreferrer" className="btn-ac-soft">
        Fale com a gente no WhatsApp
      </a>
    </div>
  )
}

/**
 * "Suas mentorias reservadas" (#118): o encontro reservado fica na tela, com o
 * link da sala, até ACABAR. O que já acabou (ou não veio na leitura) cai no
 * texto de histórico de sempre. Serve à tela com contrato e à tela de quem já
 * não tem contrato ativo mas ainda tem encontro por vir.
 *
 * O CANCELAMENTO É SÓ DO CONTRATO ATIVO (`podeCancelarNaTela`): o crédito de
 * uma reserva de outro contrato voltaria para um contrato que não reserva mais.
 * Essa reserva vai para o atendimento, e a frase do saldo (`fraseDoCancelamento`)
 * só aparece para quem tem contrato ativo, dizendo de quais reservas fala.
 */
function SuasReservas({
  encontros,
  contratoAtivo,
  tz,
  agoraMs,
}: {
  encontros: readonly EncontroReservado[]
  contratoAtivo: string | null
  tz: string
  agoraMs: number
}) {
  const frase = fraseDoCancelamento(encontros, contratoAtivo, agoraMs)
  return (
    <section className="flex flex-col gap-3">
      <h2 className="title-section text-ink-900">Suas mentorias reservadas</h2>
      {encontros.length === 0 ? (
        <p className="text-sm text-ink-600">Nenhuma mentoria reservada ainda.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {encontros.map((e) => {
            const sess = e.encontro && encontroAindaNaoAcabou(e.encontro, agoraMs) ? e.encontro : null
            return (
              <li key={e.id} className="card-ac flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="min-w-0">
                  <span className="block font-medium text-ink-900 first-letter:uppercase">
                    {sess ? fmtLocal(sess.scheduledAt, tz) : 'Reserva confirmada — os detalhes chegam pelo WhatsApp'}
                  </span>
                  {sess && !sess.meetUrl && (
                    <span className="mt-0.5 block text-sm text-ink-600">{SEM_LINK_DA_SALA}</span>
                  )}
                  {sess && e.contractId !== contratoAtivo && Date.parse(sess.scheduledAt) > agoraMs && (
                    <span className="mt-0.5 block text-sm text-ink-600">
                      Para mudar esta reserva, {FALE_COM_A_GENTE}.
                    </span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {sess?.meetUrl && (
                    <a href={sess.meetUrl} target="_blank" rel="noreferrer" className="btn-ac-soft">
                      Entrar no Meet
                    </a>
                  )}
                  {/* F10/M6-4: autocancelamento até 24h antes — o crédito volta */}
                  {sess && podeCancelarNaTela(e, contratoAtivo, agoraMs) && (
                    <BotaoDeAcao
                      acao={cancelMyMentorshipBookingAction}
                      campos={{ booking_id: e.id }}
                      rotulo="Cancelar reserva"
                      rotuloEnviando="Cancelando…"
                      className="btn-ac-ghost"
                    />
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {frase && <p className="text-sm text-ink-600">{frase}</p>}
    </section>
  )
}
