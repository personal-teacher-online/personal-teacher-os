// AS AULAS DO ALUNO (Onda do Portal · P4) — dois baldes NOMEADOS e nada mais.
//
// "Próximas" e "Histórico". Cada linha é uma ÂNCORA para a página da aula (N3):
// é lá que a aula vira lugar, com o botão de entrar e as duas ações com a
// consequência explicada (D4). Por isso sumiram daqui os links
// "Remarcar…"/"Cancelar…" em `text-xs` — letra miúda como ação é justamente o
// que a régua da casa proíbe, e cancelar sem ver o efeito é o padrão que o
// portal está desfazendo.
//
// ⚠️ O SEGUNDO BALDE CHAMA-SE HISTÓRICO, NÃO "PASSADAS" (revisão do P4, E5). A
// consulta pega o que já terminou OU o que saiu de 'scheduled' — e uma aula
// FUTURA cancelada satisfaz a segunda metade. Ela caía sob o rótulo "Passadas",
// datada de daqui a três dias, contradizendo o próprio título. O rótulo cedeu
// porque a lista está certa: cada linha traz estado e data em linguagem de
// gente, e o balde só precisava de um nome que coubesse nas duas coisas.
//
// O estado de cada aula vem do BANCO já explicado (quem cancelou, se o aviso
// veio em cima da hora, se nasceu reposição) e é traduzido por `estadoDaAula` —
// nenhum código do Postgres chega aos olhos do aluno.
//
// A dívida c14 desta tela morre aqui: o histórico lia `class_instances`
// descartando o `error` do PostgREST, e "não tem aula nenhuma" era a resposta
// tanto para quem não tem quanto para o banco fora do ar.
import Link from 'next/link'
import { DateTime } from 'luxon'
import { redirect } from 'next/navigation'

import { fmtLocal, tzSuffix } from '@/lib/format'
import {
  AULAS_POR_PAGINA,
  creditSummary,
  historicoDeAulas,
  portalStudent,
  temContratoPausado,
  upcomingClasses,
} from '@/lib/portal/data'
import { estadoDaAula } from '@/lib/portal/aulas'
import { mostrarVazioAfirmativo } from '@/lib/portal/vazio'
import { createClient } from '@/lib/supabase/server'
import { AvisoDeLeitura } from '@/components/portal/AvisoDeLeitura'
import { EmptyState } from '@/components/kit/empty-state'
import { Pill } from '@/components/kit/pill'
import { WHATSAPP_ATENDIMENTO_URL } from '@/lib/contact'

export const metadata = { title: 'Suas aulas — Personal Teacher' }

/** Rótulo de balde: nomeia a lista sem competir com ela. */
function Balde({ children }: { children: React.ReactNode }) {
  return <h2 className="title-section text-ink-900">{children}</h2>
}

const duracaoMin = (inicio: string, fim: string) =>
  Math.round((Date.parse(fim) - Date.parse(inicio)) / 60_000)

/** A página vizinha do histórico. O passo é PARÂMETRO de propósito: o varredor
 *  de vocabulário do portal proíbe a notação "+1/−1" nas telas do aluno (é
 *  jargão de ledger), e uma conta de paginação não vale abrir exceção nele. */
const paginaVizinha = (atual: number, passo: number) => `/portal/aulas?p=${atual + passo}`

export default async function AulasPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const { p } = await searchParams
  const pagina = Math.max(1, Number.parseInt(p ?? '1', 10) || 1)
  const supabase = await createClient()

  const [aluno, proximas, historico, creditos, pausa] = await Promise.all([
    portalStudent(supabase),
    upcomingClasses(supabase),
    historicoDeAulas(supabase, { pagina }),
    creditSummary(supabase),
    temContratoPausado(supabase),
  ])

  const tz = aluno.dado?.ianaTz ?? 'America/Cuiaba'
  const aulas = proximas.dado
  const falhaNasProximas = aluno.erro || proximas.erro
  const comSaldo = creditos.dado.filter((c) => c.balance > 0)
  const saldoTotal = comSaldo.reduce((n, c) => n + c.balance, 0)

  const totalNoHistorico = historico.dado.total
  const paginas = Math.max(1, Math.ceil(totalNoHistorico / AULAS_POR_PAGINA))
  // PÁGINA FORA DO INTERVALO NÃO VIRA "NÃO HÁ AULAS" (revisão do P4, E8): o
  // total agora sobrevive à página vazia (linha-sentinela do banco), então dá
  // para reposicionar em vez de afirmar um vazio que não existe. Só reposiciona
  // quando a LEITURA deu certo — com falha, o aviso é a única coisa verdadeira.
  if (!historico.erro && pagina > paginas) redirect(`/portal/aulas?p=${paginas}`)
  const meses = [
    ...new Set(aulas.map((c) => DateTime.fromISO(c.startsAtUtc).setZone(tz).toFormat('yyyy-LL'))),
  ]

  return (
    <main className="flex flex-col gap-6">
      {/* O recado da última ação não é mais lido aqui: quem o pinta é a moldura
          do portal (`RecadoDoPortal`, no layout) — assim ele aparece também nas
          rotas de gate, que era onde se perdia. */}
      <header>
        <h1 className="title-page text-ink-900">Suas aulas</h1>
        <p className="mt-1 text-sm text-ink-600">Tudo no seu horário — {tzSuffix(tz)}.</p>
      </header>

      {falhaNasProximas && <AvisoDeLeitura oQue="suas próximas aulas" />}
      {creditos.erro && <AvisoDeLeitura oQue="suas reposições" />}

      {/* A PAUSA, DITA ONDE ELA APARECE (revisão do P4, E4). `upcomingClasses`
          esconde a aula de contrato pausado — decisão de exibição certa —, e
          esta tela mostrava o resultado sem a causa: uma lista vazia, que quem
          esqueceu da pausa lê como "sumiram as minhas aulas". A tela de créditos
          já tinha a seção "Em pausa"; agora as duas contam a mesma história. */}
      {pausa.dado && (
        <section className="card-ac card-ac-wash flex flex-col items-start gap-2 p-5">
          <p className="text-base font-semibold text-ink-900">Seu contrato está pausado</p>
          <p className="text-sm text-ink-900">
            As aulas voltam na retomada, e seus créditos ficam congelados até lá — eles não vencem
            enquanto isso.
          </p>
          <Link href="/portal/creditos" className="btn-ac-soft">
            Ver seus créditos
          </Link>
        </section>
      )}

      {/* ------------------------------------------------------------ próximas */}
      <section className="flex flex-col gap-3">
        <Balde>Próximas</Balde>
        {aulas.length === 0
          ? // "Nenhuma aula agendada" é uma AFIRMAÇÃO: só sai quando a leitura deu
            // certo — com falha, o aviso acima é a única coisa verdadeira aqui.
            mostrarVazioAfirmativo({ erro: falhaNasProximas, itens: aulas.length }) && (
              <EmptyState
                title="Nenhuma aula agendada."
                hint="Se isso for uma surpresa, fale com a gente — a gente resolve rapidinho."
              />
            )
          : meses.map((mes) => (
              <div key={mes} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-ink-600 first-letter:uppercase">
                  {DateTime.fromISO(`${mes}-01`).setLocale('pt-BR').toFormat('LLLL')}
                </h3>
                <ul className="flex flex-col gap-2">
                  {aulas
                    .filter((c) => DateTime.fromISO(c.startsAtUtc).setZone(tz).toFormat('yyyy-LL') === mes)
                    .map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/portal/aula/${c.id}`}
                          className="card-ac card-ac-interactive flex items-center justify-between gap-3 p-4"
                        >
                          <span className="min-w-0">
                            <span className="block font-semibold text-ink-900 first-letter:uppercase">
                              {fmtLocal(c.startsAtUtc, tz)}
                            </span>
                            <span className="mt-0.5 block text-sm font-medium text-ink-900">
                              {c.teacherName}
                              <span className="font-normal text-ink-600">
                                {' '}
                                · {duracaoMin(c.startsAtUtc, c.endsAtUtc)} min
                              </span>
                            </span>
                          </span>
                          <span className="text-sm font-semibold whitespace-nowrap text-ac-deep">ver aula →</span>
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
      </section>

      {/* NAV-2 (auditoria 23/07): as reposições são alcançáveis pelo mundo
          "aulas" — o cartão só existe quando há o que agendar. */}
      {saldoTotal > 0 && (
        <section className="card-ac flex flex-col gap-3 p-5">
          <span className="text-sm font-medium text-ink-600">Suas reposições</span>
          <p className="text-base font-semibold text-ink-900 tabular-nums">
            {saldoTotal === 1 ? '1 aula de reposição para agendar' : `${saldoTotal} aulas de reposição para agendar`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {comSaldo.map((c) => (
              <Link key={c.contractId} href={`/portal/resgatar/${c.contractId}`} className="btn-ac">
                {comSaldo.length > 1 ? `Agendar reposição — ${c.teacherName ?? c.planName}` : 'Agendar reposição'}
              </Link>
            ))}
            <Link href="/portal/creditos" className="btn-ac-soft">
              Como funciona
            </Link>
          </div>
          <p className="text-sm text-ink-600">
            Isso cria uma aula extra, num horário livre da professora. Para mudar o dia de uma aula que já
            está marcada, use Remarcar na própria aula.
          </p>
        </section>
      )}

      {/* ----------------------------------------------------------- histórico */}
      <section className="flex flex-col gap-3">
        <Balde>Histórico</Balde>
        {historico.erro && <AvisoDeLeitura oQue="seu histórico de aulas" />}
        {historico.dado.aulas.length === 0
          ? mostrarVazioAfirmativo({ erro: historico.erro, itens: 0 }) && (
              <p className="text-sm text-ink-600">Seu histórico de aulas ainda está vazio.</p>
            )
          : (
              <>
                <ul className="flex flex-col gap-2">
                  {historico.dado.aulas.map((a) => {
                    const estado = estadoDaAula(a)
                    return (
                      <li key={a.id}>
                        <Link
                          href={`/portal/aula/${a.id}`}
                          className="card-ac card-ac-interactive flex flex-wrap items-center justify-between gap-2 p-4"
                        >
                          <span className="min-w-0">
                            <span className="block font-medium text-ink-900 first-letter:uppercase">
                              {fmtLocal(a.startsAtUtc, tz)}
                            </span>
                            {a.teacherName && (
                              <span className="mt-0.5 block text-sm text-ink-600">{a.teacherName}</span>
                            )}
                          </span>
                          <Pill tone={estado.tom}>{estado.frase}</Pill>
                        </Link>
                      </li>
                    )
                  })}
                </ul>

                {paginas > 1 && (
                  <nav
                    aria-label="Páginas do histórico de aulas"
                    className="flex items-center justify-between gap-3 pt-1"
                  >
                    {pagina > 1 ? (
                      <Link href={paginaVizinha(pagina, -1)} className="btn-ac-soft">
                        ← Mais recentes
                      </Link>
                    ) : (
                      <span />
                    )}
                    <span className="text-sm font-medium text-ink-900 tabular-nums">
                      Página {pagina} de {paginas}
                    </span>
                    {pagina < paginas ? (
                      <Link href={paginaVizinha(pagina, 1)} className="btn-ac-soft">
                        Mais antigas →
                      </Link>
                    ) : (
                      <span />
                    )}
                  </nav>
                )}
              </>
            )}
      </section>

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
