// AGENDAR REPOSIÇÃO (Onda do Portal · P5) — o crédito vira aula EXTRA, num
// horário livre da professora. Passo de revisão antes de gastar.
//
// A DÍVIDA DO P3 QUE MORRE AQUI (classe do achado C1). A página perguntava a
// validade a `contract_credit_summary()`, que tira `min()` de TODAS as datas do
// replay — inclusive as JÁ VENCIDAS. Um aluno com um crédito vencido em julho e
// outro válido até setembro lia "válida até julho": a data de um crédito que a
// reserva não vai gastar. Junto vinha um "hoje" montado em UTC
// (`new Date().toISOString()`), que decide vencimento numa virada de dia
// diferente da do NEGÓCIO — e é `business_today()` quem manda no crédito.
//
// Agora saldo e validade vêm das funções do P3 (`student_credit_totals` para o
// agregado, `student_credit_statement` para o crédito da vez, ambos com o replay
// do FIFO e o dia civil do banco), desembrulhadas por `dadosDoResgate`. A RPC
// que GASTA o crédito continua intocada: quem decide a reserva é
// `book_reschedule_window`/`book_computed_slot`, dentro da transação (Lei 3).
//
// A GRADE NUNCA OFERECE O QUE A RPC RECUSA (rodada de correção do P5, dois
// achados graves). A duração da aula vinha do crédito da vez, depois do horário
// fixo escolhido por `active_to is null`, e por fim de um padrão de 45 min. As
// duas últimas etapas mentiam: a RPC escolhe o slot VIGENTE HOJE (a leitura
// agora chama `contract_active_slot_duration`, cópia literal daquele WHERE) e
// RECUSA o resgate quando não há duração nenhuma. O padrão de 45 saiu — sem
// duração determinável, a tela não mostra horário nenhum e manda conversar.
//
// O recado da ação vem da MOLDURA do portal (`RecadoDoPortal`): esta tela era a
// última a ler `?msg=` da URL, e não lê mais.
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { fmtCivilDate, fmtLocal } from '@/lib/format'
import { availableSlots } from '@/lib/portal/computed-slots'
import { dadosDoResgate, portalStudent } from '@/lib/portal/data'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { FALE_COM_A_GENTE, WHATSAPP_ATENDIMENTO_URL } from '@/lib/contact'
import { AvisoDeLeitura } from '@/components/portal/AvisoDeLeitura'
import { BotaoDeAcao } from '@/components/portal/BotaoDeAcao'
import { EmptyState } from '@/components/kit/empty-state'
import { bookWindowAction } from '../../actions'

export const metadata = { title: 'Agendar reposição — Personal Teacher Academy' }

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-col gap-5">
      <header>
        <Link href="/portal/aulas" className="text-sm font-semibold text-ac-deep hover:underline">
          ← Suas aulas
        </Link>
        <h1 className="mt-1 title-page text-ink-900">Agendar reposição</h1>
      </header>
      {children}
    </main>
  )
}

export default async function ResgatarPage({
  params,
  searchParams,
}: {
  params: Promise<{ contract: string }>
  searchParams: Promise<{ escolha?: string }>
}) {
  const { contract } = await params
  const { escolha } = await searchParams
  const supabase = await createClient()

  // RLS: contrato alheio é invisível → notFound. Falha de LEITURA é outra
  // coisa, e não pode virar "esse contrato não existe" na cara de quem tem
  // crédito para gastar.
  const { data: contratos, error: erroDoContrato } = await supabase
    .from('contracts')
    .select('id, teacher_id, status')
    .eq('id', contract)
    .limit(1)
  if (erroDoContrato)
    return (
      <Moldura>
        <AvisoDeLeitura oQue="este contrato" />
      </Moldura>
    )
  const c = contratos?.[0]
  if (!c || c.status !== 'active') notFound()

  const [aluno, credito] = await Promise.all([
    portalStudent(supabase),
    dadosDoResgate(supabase, c.id),
  ])
  // O FUSO ENTRA NA CONTA DE FALHA (e não só o crédito): cada horário desta
  // grade é escrito na zona do aluno, e cair no fuso padrão mostraria a hora
  // ERRADA de uma aula que ele está prestes a marcar. Preferir o aviso.
  if (credito.erro || !credito.dado || aluno.erro)
    return (
      <Moldura>
        <AvisoDeLeitura oQue="as suas reposições" />
      </Moldura>
    )

  const tz = aluno.dado?.ianaTz ?? 'America/Cuiaba'
  const { saldo, proximaValidade, duracaoMin, validadeDoCreditoDaVez } = credito.dado

  // A GRADE SÓ EXISTE COM CRÉDITO **E** COM DURAÇÃO (correção do P5). Sem saldo
  // não há o que escolher; sem duração determinável, a RPC recusa o resgate
  // ("contrato % não tem duração para o resgate") — e uma grade montada num
  // palpite de 45 min ofereceria horários que o banco vai rejeitar no clique. A
  // tela não oferece o que a RPC recusa.
  const semDuracao = duracaoMin == null
  const grade =
    saldo > 0 && duracaoMin != null
      ? await availableSlots(supabase, createAdminClient(), c.teacher_id, {
          // A duração do resgate vem do CONTRATO, já em minutos inteiros — aqui
          // não há arredondamento a perder (S5 vale para quem parte de instantes).
          durationMs: duracaoMin * 60_000,
        })
      : null
  // S4: grade que não pôde ser lida é DITA. `grade === null` continua sendo o
  // caso legítimo de "não há o que oferecer" (sem saldo ou sem duração), e ele
  // segue pelo caminho de sempre, com a frase própria.
  if (grade?.erro)
    return (
      <Moldura>
        <AvisoDeLeitura oQue="os horários livres" />
      </Moldura>
    )
  const slots = grade?.dado?.slots ?? []
  const googleDegraded = grade?.dado?.googleDegraded ?? false

  // Passo de revisão; se a janela sumiu (outro aluno levou), volta à lista.
  const escolhida = escolha ? slots.find((w) => w.key === escolha) : undefined

  return (
    <Moldura>
      {/* O SALDO RE-EXPOSTO ANTES DE GASTAR (a mesma régua de /portal/remarcar).
          A validade é a do próximo crédito que AINDA EXISTE — nunca a de um que
          já venceu ou que já foi usado. */}
      <section className="card-ac flex flex-col gap-2 p-5">
        <span className="text-sm font-medium text-ink-600">Suas reposições</span>
        <p className="text-base font-semibold text-ink-900 tabular-nums">
          {saldo === 1 ? '1 aula de reposição para agendar' : `${saldo} aulas de reposição para agendar`}
          {proximaValidade && ` · vale até ${fmtCivilDate(proximaValidade)}`}
        </p>
        <p className="text-sm text-ink-600">
          Essa aula é extra — seus horários fixos não mudam.
        </p>
      </section>

      {saldo === 0 ? (
        <EmptyState
          title="Você não tem aulas de reposição neste contrato."
          hint="As reposições nascem quando a escola desmarca uma aula sua, quando a professora falta, ou quando a gente lança um ajuste no seu extrato — e no extrato ainda podem aparecer créditos de antes do portal e devoluções."
          cta="Ver seus créditos"
          href="/portal/creditos"
        />
      ) : semDuracao ? (
        /* NADA CLICÁVEL. Não sabemos quanto tempo esta reposição dura — nem o
           crédito nem o horário fixo vigente dizem — e a reserva seria recusada
           pelo banco. A saída honesta é a conversa, não uma grade de chute. */
        <section className="card-ac flex flex-col items-center gap-4 p-8 text-center">
          <p className="max-w-md text-sm text-ink-600">
            Não conseguimos calcular a duração da sua reposição — {FALE_COM_A_GENTE} para marcar
            junto com você.
          </p>
          {WHATSAPP_ATENDIMENTO_URL && (
            <a href={WHATSAPP_ATENDIMENTO_URL} target="_blank" rel="noreferrer" className="btn-ac btn-ac-lg">
              Falar com o atendimento
            </a>
          )}
        </section>
      ) : slots.length === 0 ? (
        <section className="card-ac flex flex-col items-center gap-4 p-8 text-center">
          <p className="max-w-md text-sm text-ink-600">
            Sua professora ainda não publicou horários disponíveis nas próximas 2 semanas.
          </p>
          {WHATSAPP_ATENDIMENTO_URL && (
            <a href={WHATSAPP_ATENDIMENTO_URL} target="_blank" rel="noreferrer" className="btn-ac btn-ac-lg">
              Falar com o atendimento
            </a>
          )}
        </section>
      ) : escolhida ? (
        <section className="card-ac flex flex-col gap-4 p-5">
          <h2 className="title-section text-ink-900">Confira antes de confirmar:</h2>
          <p className="text-sm text-ink-600">
            Sua reposição:{' '}
            <strong className="text-ink-900 first-letter:uppercase">{fmtLocal(escolhida.startsAtUtc, tz)}</strong>{' '}
            <span className="text-xs">(seu horário)</span>
          </p>
          <p className="text-sm text-ink-600">
            Aula de {duracaoMin} min — usa 1 das suas {saldo === 1 ? 'aulas' : `${saldo} aulas`} de
            reposição
            {validadeDoCreditoDaVez ? ` (válida até ${fmtCivilDate(validadeDoCreditoDaVez)})` : ''}.
          </p>
          <BotaoDeAcao
            acao={bookWindowAction}
            campos={
              escolhida.windowId
                ? { window_id: escolhida.windowId, contract_id: c.id }
                : {
                    // F5: horário computado — o banco materializa e consome na
                    // MESMA transação; o marcador de degradação vai junto.
                    teacher_id: c.teacher_id,
                    starts_at_utc: escolhida.startsAtUtc,
                    contract_id: c.id,
                    ...(googleDegraded ? { google_degraded: '1' } : {}),
                  }
            }
            rotulo="Confirmar reposição"
            rotuloEnviando="Confirmando…"
          />
          <Link
            href={`/portal/resgatar/${c.id}`}
            className="text-center text-sm font-semibold text-ink-600 hover:text-ink-900"
          >
            ← escolher outro horário
          </Link>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="title-section text-ink-900">Escolha o horário</h2>
          {googleDegraded && (
            <p className="text-sm text-ink-600">
              A agenda pessoal da professora está momentaneamente indisponível — o horário é
              confirmado na reserva.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {slots.map((w) => (
              <li key={w.key}>
                <Link
                  href={`/portal/resgatar/${c.id}?escolha=${encodeURIComponent(w.key)}`}
                  className="card-ac card-ac-interactive flex items-center justify-between gap-3 p-4"
                >
                  <span className="font-semibold text-ink-900 first-letter:uppercase">
                    {fmtLocal(w.startsAtUtc, tz)}
                  </span>
                  <span className="text-sm font-semibold whitespace-nowrap text-ac-deep">escolher →</span>
                </Link>
              </li>
            ))}
          </ul>
          {WHATSAPP_ATENDIMENTO_URL && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="text-sm text-ink-600">Nenhum horário serve?</p>
              <a href={WHATSAPP_ATENDIMENTO_URL} target="_blank" rel="noreferrer" className="btn-ac-soft">
                Fale com a gente no WhatsApp
              </a>
            </div>
          )}
        </section>
      )}
    </Moldura>
  )
}
