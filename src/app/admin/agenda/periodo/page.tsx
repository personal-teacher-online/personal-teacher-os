// TRATAMENTO DE PERÍODO (férias, viagem, feriado) — Onda da Agenda · A7.
//
// Escolhe professora e intervalo, VÊ as aulas afetadas, e decide o destino em
// lote. Feriados BR aparecem com a política da professora pré-selecionada
// (a dona = cancelar com crédito; default = decidir caso a caso).
//
// ── O QUE MUDOU NO A7 ───────────────────────────────────────────────────────
// · a tela entrou no ESQUELETO da seção: card-contêiner com as três abas
//   (Agenda | Pendências | Período), no lugar do `<main>` solto com `<Card>`s.
//   Ela deixou de parecer uma página de outro sistema alcançada por um link;
// · o recado saiu da `FlashMsg` (`?msg=` na URL) e entrou no cookie da seção,
//   amarrado ao ENDEREÇO — a frase do tratamento aparece uma vez, aqui, e não
//   repinta quando a dona volta para a grade e retorna;
// · `manter` e `rascunho` saíram do formulário: a lista de campos é do servidor
//   (`CAMPOS_DA_PORTA.periodo`) e a chave do rascunho é derivada do destino;
// · a PRÉVIA ganhou o que ela devia ter dito desde sempre — o que o tratamento
//   escolhido fará com as aulas listadas. Ver "a prévia não adivinha", abaixo.
//
// ── A PRÉVIA NÃO ADIVINHA (e é por isso que ela é confiável) ────────────────
// A pergunta que a dona faz antes de apertar é "quais aulas entram nisto?", e é
// essa que a prévia responde: nome, dia e hora, no relógio que DECIDE a inclusão
// (o da professora). A pergunta seguinte — "quantas dessas vão gerar crédito?" —
// a tela NÃO responde, e não por falta de vontade: nenhuma consulta desta casa
// sabe. `_refund_for_credit_born_class` só descobre, DENTRO da transação, se a
// aula perdida nasceu de um gasto com identidade; `preview_cancel_effect`
// responde para o cancelamento PELO ALUNO, que é o ator errado aqui. Inventar
// uma predição a partir do que temos seria a família de frase falsa que o A5
// passou o milestone matando — e num número que a dona repassaria ao aluno.
// O desfecho REAL vem da migration 99 (`credited` × `refund_blocked`) e está na
// frase de saída da action.
import { DateTime } from 'luxon'
import Link from 'next/link'

import { one } from '@/lib/embed'
import { createClient } from '@/lib/supabase/server'
import { intervaloDosDiasCivis } from '@/lib/admin/hora-civil'
import { CHAVE_DO_PERIODO, lerRascunho } from '@/lib/admin/rascunho-do-formulario'
import { enderecoDaTela, geometriaCanonica, type TelaDaAgenda } from '@/lib/admin/transporte-da-agenda'
import { lerRecado } from '@/lib/kit/recado'
import { AvisoLegado } from '@/components/kit/aviso-legado'
import { CardPanel, CardPanelTabs } from '@/components/kit/card-panel'
import { DateField } from '@/components/DateField'
import { btnInk, chipOff, input, EmptyState, Field, Pill, SectionTitle } from '@/components/ui'
import { periodTreatmentAction } from '../actions'

export const metadata = { title: 'Tratamento de período — Admin' }

const BUSINESS_TZ = 'America/Cuiaba'

/** Esta tela, no vocabulário do transporte. */
const TELA: TelaDaAgenda = { tela: 'periodo' }

export default async function PeriodoPage({
  searchParams,
}: {
  // `mode`/`note` voltam depois de um ERRO da action (PORTÃO DE DEPLOY 29/07,
  // bloqueador 4): a volta preservava só professora e datas, o seletor caía na
  // PRIMEIRA opção — "Cancelar com crédito" — e um novo toque em "Aplicar
  // tratamento" executava uma operação DIFERENTE e destrutiva daquela que a
  // dona tinha escolhido.
  //
  // Eles NÃO chegam pela URL (Sol · rodada 1 do A4, grave 5 — LGPD): o motivo é
  // texto livre e é onde se escreve "cirurgia da professora". Vêm do cookie de
  // rascunho, sob a chave desta tela.
  searchParams: Promise<{
    prof?: string
    de?: string
    ate?: string
  }>
}) {
  const sp = await searchParams
  const { prof, de, ate } = sp
  const rascunho = await lerRascunho(CHAVE_DO_PERIODO)
  const mode = rascunho.mode
  const note = rascunho.note

  // O ENDEREÇO CANÔNICO DESTA TELA — a MESMA função que a action usa para montar
  // o destino. É a comparação que faz o recado aparecer aqui e só aqui.
  const enderecoAqui = enderecoDaTela(
    TELA,
    geometriaCanonica(TELA, true, (k) => sp[k as keyof typeof sp]),
  )
  const recado = await lerRecado('agenda', enderecoAqui)

  const supabase = await createClient()

  const now = DateTime.now().setZone(BUSINESS_TZ)

  // SOL · A1 achado 10: só a prévia tinha ganhado tratamento de erro. Estas
  // duas continuavam virando array vazio — e a de `teachers` é a pior, porque
  // além de esvaziar o seletor ela fazia o fuso da professora cair
  // silenciosamente em `BUSINESS_TZ`, calculando o intervalo do tratamento no
  // fuso ERRADO. Falha estoura e acende o `error.tsx`.
  const exigir = <T,>(leitura: string, r: { data: T; error: { message: string } | null }): T => {
    if (r.error) throw new Error(`Tratamento de período: falha ao ler ${leitura}: ${r.error.message}`)
    return r.data
  }
  const [teachersRes, holidaysRes] = await Promise.all([
    supabase
      .from('teachers')
      .select('id, display_name, iana_tz, holiday_policy, is_owner')
      .is('archived_at', null)
      .order('is_owner', { ascending: false }),
    supabase
      .from('br_holidays')
      .select('holiday, label')
      .gte('holiday', now.toFormat('yyyy-LL-dd'))
      .lte('holiday', now.plus({ days: 60 }).toFormat('yyyy-LL-dd'))
      .order('holiday'),
  ])
  const teachers = exigir('as professoras', teachersRes)
  const holidays = exigir('os feriados', holidaysRes)
  const teacherList = (teachers ?? []).filter((t) => t.display_name)

  // Prévia das aulas afetadas (intervalo civil na zona da professora)
  const valid = prof && de && ate && /^\d{4}-\d{2}-\d{2}$/.test(de) && /^\d{4}-\d{2}-\d{2}$/.test(ate)
  let afetadas: { id: string; starts_at_utc: string; who: string }[] = []
  const professora = teacherList.find((t) => t.id === prof)
  const profTz = professora?.iana_tz ?? BUSINESS_TZ
  if (valid) {
    // meia-noite repetida (zona cujo recuo cai às 00:00): a primeira passagem (#40)
    const { fromUtc, toUtc } = intervaloDosDiasCivis(de, ate, profTz)
    const { data, error } = await supabase
      .from('class_instances')
      .select('id, starts_at_utc, contracts(students!contracts_student_id_fkey(display_name), student_groups(label))')
      .eq('teacher_id', prof!)
      .eq('state', 'scheduled')
      .gt('starts_at_utc', now.toUTC().toISO()!)
      .gte('starts_at_utc', fromUtc)
      .lt('starts_at_utc', toUtc)
      .order('starts_at_utc')
    // A1 da onda da Agenda — o `error` era descartado, e esta é a leitura mais
    // perigosa da seção para engolir falha: a prévia diz "0 aulas no período" e
    // logo abaixo há um botão que CANCELA EM LOTE. A dona aplicaria o
    // tratamento acreditando que não havia ninguém para avisar. Falha estoura e
    // acende o `error.tsx`; prévia vazia passa a significar vazio de verdade.
    if (error) throw new Error(`Tratamento de período: falha ao ler as aulas afetadas: ${error.message}`)
    afetadas = (data ?? []).map((i) => {
      const contract = one(i.contracts)
      return {
        id: i.id,
        starts_at_utc: i.starts_at_utc,
        who: one(contract?.students)?.display_name ?? one(contract?.student_groups)?.label ?? '—',
      }
    })
  }

  const quantas = afetadas.length
  const plural = quantas === 1 ? '' : 's'

  const abas = [
    { label: 'Agenda', href: '/admin/agenda' },
    { label: 'Pendências', href: '/admin/agenda?v=pendencias' },
    { label: 'Período', href: '/admin/agenda/periodo', active: true },
  ]

  return (
    <main className="view-enter flex flex-col gap-6">
      {recado && <AvisoLegado mensagem={recado.mensagem} chave={recado.id} />}

      <CardPanel>
        <CardPanelTabs tabs={abas} />

        <section className="flex flex-col gap-5 p-5">
          <p className="max-w-2xl text-sm text-ink-600">
            Férias, viagem ou feriado: bloqueia a oferta no intervalo e trata as aulas afetadas em
            lote. Escolha a professora e o período para ver, antes de decidir, quais aulas entram.
          </p>

          {/* passo 1: escolher professora + intervalo (GET → prévia) */}
          <form method="get" className="flex flex-wrap items-end gap-4">
            <Field label="Professora">
              <select name="prof" defaultValue={prof ?? ''} required className={input}>
                <option value="">Escolha…</option>
                {teacherList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="De">
              <DateField name="de" required defaultValue={de} />
            </Field>
            <Field label="Até">
              <DateField name="ate" required defaultValue={ate} />
            </Field>
            <button type="submit" className={chipOff}>
              Ver aulas afetadas
            </button>
          </form>

          {valid && (
            <div className="flex flex-col gap-4 rounded-card border border-line-soft bg-paper-0 p-4">
              {/* A CONTAGEM É DADO, inclusive quando é zero (régua do AGENTS.md):
                  é ela que diz se há alguém para avisar. */}
              <SectionTitle>
                {quantas} aula{plural} no período
              </SectionTitle>
              {/* Dizer QUAL relógio, porque é ele que decide quem entra no lote. */}
              {profTz !== BUSINESS_TZ && (
                <p className="text-sm text-ink-600">
                  Horários no relógio da professora ({profTz.split('/')[1]?.replace('_', ' ') ?? profTz}) — é
                  esse fuso que define o intervalo tratado.
                </p>
              )}
              {quantas > 0 ? (
                <ul className="max-h-56 divide-y divide-line-soft overflow-y-auto rounded-card border border-line-soft">
                  {afetadas.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                      <span className="font-medium text-ink-900">{a.who}</span>
                      {/* SOL · achado 9: a INCLUSÃO no período é decidida no fuso da
                          PROFESSORA (`profTz`, acima), mas a prévia mostrava tudo em
                          Cuiabá. Tratando 1º de agosto de uma professora em Lisboa,
                          uma aula de 00:30 local aparecia como "31/07" — a lista
                          parecia conter aula fora do intervalo que seria tratado.
                          A data mostrada é a que DECIDE. E é DADO (a régua do
                          AGENTS.md): sai do `text-xs`/`ink-400`. */}
                      <span className="text-sm font-medium text-ink-900 first-letter:uppercase">
                        {DateTime.fromISO(a.starts_at_utc).setZone(profTz).setLocale('pt-BR').toFormat("ccc, dd/LL 'às' HH:mm")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm font-medium text-ink-900">
                  Nenhuma aula agendada da{' '}
                  {professora?.display_name ?? 'professora'} cai nesse período — aplicar o tratamento
                  vai bloquear a oferta e não vai mexer em aula nenhuma.
                </p>
              )}
              <form action={periodTreatmentAction} className="flex flex-col gap-3">
                <input type="hidden" name="teacher_id" value={prof!} />
                <input type="hidden" name="from" value={de!} />
                <input type="hidden" name="to" value={ate!} />
                {/* A7: sem `back`, sem `manter`, sem `rascunho`. O endereço de
                    volta é montado pela action a partir da professora e do
                    intervalo que ELA recebeu; a lista de campos que sobrevivem ao
                    erro é `CAMPOS_DA_PORTA.periodo`; a chave do rascunho é
                    derivada do destino. Nada disso era negociável com o cliente. */}
                <Field label="O que fazer com as aulas do período?">
                  {/* A6 · prova independente L2: o rótulo prometia crédito PARA
                      TODAS. `admin_period_treatment` cancela por
                      `_cancel_class_core`, e ali a aula que nasceu de um crédito
                      antigo sem identidade volta BLOQUEADA — sem inserir nada no
                      ledger. A frase de SAÍDA já conta as duas metades desde a
                      migration 99 (`credited` × `refund_blocked`); a de ENTRADA
                      continuava generalizando, e é ela que a dona lê ANTES de
                      apertar. Agora as duas dizem a mesma coisa. */}
                  <select name="mode" defaultValue={mode ?? 'cancel_credit'} className={input}>
                    <option value="cancel_credit">
                      Cancelar e avisar, com crédito de reposição quando a regra creditar (culpa da
                      escola — validade-180); o desfecho diz quantas creditaram
                    </option>
                    <option value="invite_reschedule">Convidar a remarcar (as aulas continuam marcadas)</option>
                    <option value="block_only">Só bloquear a oferta (decido as aulas depois)</option>
                  </select>
                </Field>
                {/* O QUE O TRATAMENTO ALCANÇA, dito com o número da prévia — e
                    parando exatamente onde o nosso conhecimento para (ver "a
                    prévia não adivinha", no cabeçalho). */}
                {quantas > 0 && (
                  <p className="text-sm font-medium text-ink-900">
                    {/* A REGRA E A EXCEÇÃO NA MESMA FRASE (varredor A5/L5): prometer
                        crédito sem nomear a exceção é a família de frase falsa que o
                        A5 passou o milestone matando — e aqui ela apareceria num
                        número que a dona repassa ao aluno. */}
                    O tratamento escolhido vale para as {quantas} aula{plural} da lista acima, e para
                    mais nenhuma. Quantas delas geram crédito de reposição só se sabe na hora: a
                    regra é aplicada aula a aula dentro da transação, e a exceção conhecida é a aula
                    que já tinha nascido de um crédito antigo sem identidade, que volta sem creditar.
                    A frase do desfecho traz os dois números.
                  </p>
                )}
                <Field label="Motivo (vai no aviso e na auditoria)">
                  <input name="note" defaultValue={note ?? ''} placeholder="ex.: férias da professora" className={input} />
                </Field>
                <button type="submit" className={`${btnInk} self-start`}>
                  Aplicar tratamento
                </button>
              </form>
            </div>
          )}
        </section>
      </CardPanel>

      <section>
        <SectionTitle>Feriados nacionais (próximos 60 dias)</SectionTitle>
        {(holidays ?? []).length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Nenhum feriado no horizonte." hint="A tabela é semeada por ano." />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {(holidays ?? []).map((h) => (
              <li key={h.holiday} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line-soft bg-paper-0 px-4 py-2.5 shadow-(--shadow-card)">
                <span className="text-sm text-ink-900">
                  <strong>{DateTime.fromISO(h.holiday).setLocale('pt-BR').toFormat('dd/LL')}</strong> · {h.label}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {teacherList.map((t) => (
                    <Link
                      key={t.id}
                      href={`/admin/agenda/periodo?prof=${t.id}&de=${h.holiday}&ate=${h.holiday}`}
                      className={chipOff}
                      title={
                        // Mesma correção do rótulo acima: a política CANCELA e
                        // credita quando a regra creditar — não há promessa de
                        // crédito para todas.
                        t.holiday_policy === 'cancel_credit'
                          ? 'Política: cancelar, com crédito quando a regra creditar'
                          : 'Política: decidir caso a caso'
                      }
                    >
                      {t.display_name}
                      {t.holiday_policy === 'cancel_credit' && <Pill tone="warn">cancela</Pill>}
                    </Link>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
