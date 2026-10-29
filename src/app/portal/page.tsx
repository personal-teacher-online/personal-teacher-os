// INÍCIO DO PORTAL (Onda do Portal · P3) — três cartões, todos com AÇÃO.
//
// A ordem é a do mockup da IA (`docs/goals/ia-site-2026-07.md` §PORTAL):
//   1. Sua próxima aula  → o botão de entrar (D1), com contagem viva;
//   2. Seus créditos     → só quando há o que usar (ou o que perder), com
//                          validade nos dois formatos (D2) e o caminho de usar;
//   3. O que está pendente → a cobrança em aberto, com o caminho de resolver.
//
// O QUE MORREU AQUI: o cartão de crédito que aparecia SEMPRE (com "Nenhum
// crédito no momento — tudo em dia", que é ruído), o número gigante de saldo
// sem próximo passo e os links de rodapé em `text-xs` fazendo papel de ação.
//
// LEI 1: nenhuma data é formatada no cliente. O `BotaoEntrar` recebe épocas
// (aritmética pura) e a hora de começo já escrita na zona do aluno.
//
// O gate do primeiro acesso (ciência + briefing) e o convite de re-briefing
// continuam exatamente como estavam — a reforma é do miolo.
import { DateTime } from 'luxon'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { fmtBRL, fmtCivilDate, tzSuffix } from '@/lib/format'
import {
  atualizacaoDeBriefingPendente,
  cobrancaEmAbertoMaisAntiga,
  contratoDeMentoriaAtivo,
  creditSummary,
  portalStudent,
  upcomingClasses,
} from '@/lib/portal/data'
import { fraseDeContagem, fraseDeSaldo, mostrarCartaoDeCreditos } from '@/lib/portal/creditos'
import { rescheduleEligibility } from '@/lib/portal/reschedule'
import { createClient } from '@/lib/supabase/server'
import { AvisoDeLeitura } from '@/components/portal/AvisoDeLeitura'
import { BotaoEntrar } from '@/components/portal/BotaoEntrar'
import { WHATSAPP_ATENDIMENTO_URL } from '@/lib/contact'

export const metadata = { title: 'Portal — Personal Teacher Academy' }

/** O cartão da tela nova (`.card-ac`): hairline, sem sombra em repouso.
 *  `estado` acende a lavagem de aviso pelo contrato de `--card-state`. */
function Cartao({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <section className={`card-ac flex flex-col gap-3 p-5 ${className}`}>{children}</section>
}

/** Realce de vencimento/atraso: o mesmo `--card-state` dos KPIs do admin (o
 *  hairline sai quando o glow entra, como o globals.css manda). */
const CARTAO_EM_AVISO = '[--card-edge:transparent] [--card-state:var(--glow-warn)]'

/** Rótulo de seção do cartão: nomeia o dado sem competir com ele. */
function Rotulo({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-medium text-ink-600">{children}</span>
}

const mesHumano = (ym: string | null) =>
  ym ? DateTime.fromISO(`${ym}-01`).setLocale('pt-BR').toFormat('LLLL/yyyy') : null

export default async function PortalPage() {
  const supabase = await createClient()

  // F7/M4-3: ciência do canal oficial no PRIMEIRO acesso (o home é a porta de
  // entrada normal pós-login; deep links raros passam — limitação registrada).
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) {
    const { data: perfil } = await supabase
      .from('profiles')
      .select('whatsapp_channel_ack_at')
      .eq('id', user.id)
      .maybeSingle()
    if (perfil && !perfil.whatsapp_channel_ack_at) redirect('/portal/ciencia')

    // M0b do cronograma (decisão 19/07: BLOQUEANTE): depois da ciência, o hub
    // só abre com o briefing enviado. Páginas de ação (aula/remarcar) seguem
    // acessíveis — bloquear o aluno da própria aula seria atrito no lugar errado.
    const [{ data: meAluno }, { data: meBriefing }] = await Promise.all([
      supabase.from('students').select('id').limit(1),
      supabase.from('briefings').select('status').limit(1),
    ])
    if ((meAluno ?? []).length > 0 && meBriefing?.[0]?.status !== 'submitted')
      redirect('/portal/briefing')
  }

  // A elegibilidade da mentoria sai da MESMA função que decide a aba e a página
  // (P1 · F9): o critério `contract_type='mentorship' + status='active'` mora em
  // `contratoDeMentoriaAtivo`, e não repetido à mão em cada tela.
  const [aluno, aulas, creditos, mentoria, rebriefing, cobranca] = await Promise.all([
    portalStudent(supabase),
    upcomingClasses(supabase),
    creditSummary(supabase),
    contratoDeMentoriaAtivo(supabase),
    atualizacaoDeBriefingPendente(supabase),
    // Consulta PRÓPRIA da pendência (revisão adversarial do P3): a listagem de
    // /portal/pagamentos corta as 12 últimas por vencimento — a mensalidade
    // esquecida de março caía fora do corte e o Início ficava calado.
    cobrancaEmAbertoMaisAntiga(supabase),
  ])
  const tz = aluno.dado?.ianaTz ?? 'America/Cuiaba'
  const proxima = aulas.dado[0] ?? null
  const podeRemarcar = proxima
    ? (await rescheduleEligibility(supabase, proxima.contractId, proxima.startsAtUtc, tz, proxima.occurrenceDate))
        .canReschedule
    : false

  // Status da escada (Lei 2: janelas COMPUTADAS das datas, nunca job).
  const mentoriaId: string | null = mentoria.contrato?.id ?? null
  let mentoriaStatus: { unlocked: number; total: number } | null = null
  if (mentoriaId) {
    const [{ data: mcRow }, { data: u }] = await Promise.all([
      supabase.from('mentorship_contracts').select('total_credits').eq('contract_id', mentoriaId).maybeSingle(),
      supabase.rpc('mentorship_windows_unlocked', { p_contract: mentoriaId }),
    ])
    mentoriaStatus = { unlocked: Number(u ?? 0), total: Number(mcRow?.total_credits ?? 6) }
  }

  const firstName = aluno.dado?.displayName.split(' ')[0] ?? 'aluno'

  /* ---- 1. próxima aula ------------------------------------------------- */
  // eslint-disable-next-line react-hooks/purity
  const agoraMs = Date.now()
  const quando = proxima ? DateTime.fromISO(proxima.startsAtUtc).setZone(tz).setLocale('pt-BR') : null
  const duracaoMin = proxima
    ? Math.round((Date.parse(proxima.endsAtUtc) - Date.parse(proxima.startsAtUtc)) / 60_000)
    : 0

  /* ---- 2. créditos ----------------------------------------------------- */
  // NÚMERO SÓ COM LEITURA INTEIRA (revisão adversarial do P3): falha parcial
  // publicava "1 reposição" ao lado do aviso de que a leitura falhou — um
  // número que o aluno lê como o saldo dele. Sem leitura, sem cartão.
  const comSaldo = creditos.dado.filter((c) => c.balance > 0)
  const saldoTotal = comSaldo.reduce((acc, c) => acc + c.balance, 0)
  // O próximo a vencer entre os créditos que AINDA EXISTEM (replay do FIFO), com
  // a contagem de dias feita pelo banco — nunca pelo relógio de quem olha.
  const proximo = creditos.dado
    .filter((c) => c.nextExpiry !== null)
    .sort((a, b) => a.nextExpiry!.localeCompare(b.nextExpiry!))[0]
  const proximoVencimento = proximo?.nextExpiry ?? null
  const diasParaVencer = proximo?.nextExpiryDays ?? null
  const mostrarCreditos =
    !creditos.erro && mostrarCartaoDeCreditos({ saldo: saldoTotal, dias: diasParaVencer })
  const urgente = diasParaVencer !== null && diasParaVencer <= 15

  /* ---- 3. pagamento pendente ------------------------------------------- */
  // "Em aberto" e "em atraso" vêm do BANCO (payment_em_aberto + business_today):
  // cobrança estornada, com chargeback ou cancelada não é dívida do aluno, e o
  // dia do atraso é o dia civil do negócio.
  const emAberto = cobranca.dado
  const cobrancaVencida = emAberto?.emAtraso === true

  return (
    <main className="flex flex-col gap-5">
      <header>
        <h1 className="title-page text-ink-900">
          Olá, <span className="font-bold">{firstName}</span>!
        </h1>
      </header>

      {/* A PONTE `?msg=` MORREU NO PORTAL (P5). Era esta linha que sobrava: o
          resgate de reposição terminava em `redirect(?msg=&n=)` aqui. Agora
          TODA ação do aluno grava a frase num cookie `httpOnly` e quem a pinta
          é a moldura (`RecadoDoPortal`, no layout) — em toda rota, gate
          incluído. Sem a linha, um link forjado com `?msg=` deixou de conseguir
          fazer o portal afirmar o que não aconteceu. */}

      {(aluno.erro || aulas.erro) && <AvisoDeLeitura oQue="suas aulas" />}
      {creditos.erro && <AvisoDeLeitura oQue="seus créditos" />}
      {cobranca.erro && <AvisoDeLeitura oQue="suas mensalidades" />}

      {/* ---------------------------------------------- 1. sua próxima aula */}
      {proxima && quando && (
        <Cartao>
          <Rotulo>Sua próxima aula</Rotulo>
          <Link
            href={`/portal/aula/${proxima.id}`}
            className="title-section text-ink-900 first-letter:uppercase hover:text-ac-deep hover:underline"
          >
            {quando.toFormat('cccc, dd/LL')} · {quando.toFormat('HH:mm')}
          </Link>
          <p className="text-sm font-medium text-ink-900">
            {proxima.teacherName}
            <span className="font-normal text-ink-600">
              {' '}
              · {duracaoMin} min · {tzSuffix(tz)}
            </span>
          </p>

          {proxima.meetUrl ? (
            <BotaoEntrar
              startsAtEpochMs={Date.parse(proxima.startsAtUtc)}
              endsAtEpochMs={Date.parse(proxima.endsAtUtc)}
              agoraNoServidorMs={agoraMs}
              horaDoComeco={quando.toFormat('HH:mm')}
              meetUrl={proxima.meetUrl}
            />
          ) : (
            <p className="text-sm text-ink-600">
              O link da sala ainda não está publicado — ele aparece aqui antes da aula.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {podeRemarcar && (
              <Link href={`/portal/remarcar/${proxima.id}`} className="btn-ac-soft">
                Remarcar
              </Link>
            )}
            <Link href={`/portal/cancelar/${proxima.id}`} className="btn-ac-ghost">
              Cancelar
            </Link>
          </div>
        </Cartao>
      )}

      {/* -------------------------------------------------- 2. seus créditos */}
      {/* CARTÃO COM MÉRITO (D2): existe só quando há crédito para usar ou
          vencimento à vista — e nunca sem o caminho de usar. Sem isso ele era
          o "venceu em 12/07" sem próximo passo que o dono fotografou. */}
      {mostrarCreditos && (
        <Cartao className={urgente ? CARTAO_EM_AVISO : ''}>
          <Rotulo>Seus créditos</Rotulo>
          <p className="text-base font-semibold text-ink-900 tabular-nums">
            {saldoTotal > 0 ? fraseDeSaldo(saldoTotal) : 'Crédito a vencer'}
            {proximoVencimento && ` · vale até ${fmtCivilDate(proximoVencimento)}`}
          </p>
          {diasParaVencer !== null && (
            <p className={`text-sm font-medium ${urgente ? 'text-warn-700' : 'text-ink-600'}`}>
              {fraseDeContagem(diasParaVencer)} — depois disso ele não vira mais aula.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {comSaldo.map((c) => (
              <Link key={c.contractId} href={`/portal/resgatar/${c.contractId}`} className="btn-ac">
                {comSaldo.length > 1
                  ? `Agendar reposição — ${c.teacherName ?? c.planName}`
                  : 'Agendar reposição'}
              </Link>
            ))}
            <Link href="/portal/creditos" className="btn-ac-soft">
              Como funciona
            </Link>
          </div>
          {/* O RÓTULO PROMETE O QUE A ROTA FAZ (revisão adversarial do P3):
              "usar o crédito" soava como aproveitar o crédito na aula da semana.
              O que a rota faz é marcar uma aula EXTRA num horário livre. */}
          {comSaldo.length > 0 && (
            <p className="text-sm text-ink-600">
              Isso cria uma aula extra, num horário livre da professora. Para mudar o dia de uma aula
              que já está marcada, use Remarcar na própria aula.
            </p>
          )}
        </Cartao>
      )}

      {/* ---------------------------------------------- 3. pagamento pendente */}
      {emAberto && (
        <Cartao className={cobrancaVencida ? CARTAO_EM_AVISO : ''}>
          <Rotulo>{cobrancaVencida ? 'Mensalidade em atraso' : 'Mensalidade em aberto'}</Rotulo>
          <p className="text-base font-semibold text-ink-900 first-letter:uppercase">
            {mesHumano(emAberto.referenceYm) ?? 'Sua mensalidade'}
            {emAberto.amountCents != null && (
              <span className="tabular-nums"> · {fmtBRL(emAberto.amountCents)}</span>
            )}
          </p>
          <p className={`text-sm font-medium ${cobrancaVencida ? 'text-warn-700' : 'text-ink-600'}`}>
            {emAberto.dueDate
              ? `${cobrancaVencida ? 'venceu' : 'vence'} em ${fmtCivilDate(emAberto.dueDate)}`
              : 'sem data de vencimento registrada'}
          </p>
          <Link href="/portal/pagamentos" className="btn-ac-soft self-start">
            Ver a cobrança
          </Link>
        </Cartao>
      )}

      {/* Re-briefing semestral (briefing v2 · sub-lote 4): CONVITE, nunca portão
          — nada no portal depende dele. Some sozinho quando o aluno envia. */}
      {rebriefing.pendente && (
        <Link
          href="/portal/briefing/atualizar"
          className="card-ac card-ac-interactive flex items-center justify-between gap-3 p-5"
        >
          <div>
            <p className="font-semibold text-ink-900">
              Seu plano do semestre {rebriefing.pendente.semesterNo} está chegando
            </p>
            <p className="mt-0.5 text-sm text-ink-600">
              Conte o que mudou nos seus objetivos e interesses — leva 2 minutos.
            </p>
          </div>
          <span className="text-sm font-semibold whitespace-nowrap text-ac-deep">atualizar →</span>
        </Link>
      )}

      {mentoriaStatus && (
        <Link
          href="/portal/mentoria"
          className="card-ac card-ac-interactive flex items-center justify-between gap-3 p-5"
        >
          <div>
            <p className="font-semibold text-ink-900">Mentoria Personal Travel</p>
            <p className="mt-0.5 text-sm font-medium text-ink-900 tabular-nums">
              {mentoriaStatus.unlocked} de {mentoriaStatus.total} mentorias liberadas
            </p>
          </div>
          <span className="text-sm font-semibold whitespace-nowrap text-ac-deep">ver datas →</span>
        </Link>
      )}

      {!proxima && !aulas.erro && (
        <Cartao>
          <p className="font-semibold text-ink-900">Você não tem aula marcada por enquanto.</p>
          <p className="text-sm text-ink-600">
            Se isso for uma surpresa, fale com a gente — a gente resolve rapidinho.
          </p>
          <Link href="/portal/aulas" className="btn-ac-soft self-start">
            Ver suas aulas
          </Link>
        </Cartao>
      )}

      {/* AÇÃO PARECE AÇÃO (revisão adversarial 2 · D8): o link de texto no meio
          da frase virou botão do kit — que em ponteiro grosso tem os 44px de
          alvo da régua da casa. A pergunta continua sendo prosa; o que se
          aperta, não. */}
      {WHATSAPP_ATENDIMENTO_URL && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-ink-600">Precisa de suporte?</p>
          <a href={WHATSAPP_ATENDIMENTO_URL} target="_blank" rel="noreferrer" className="btn-ac-soft">
            Fale com a gente no WhatsApp
          </a>
        </div>
      )}
    </main>
  )
}
