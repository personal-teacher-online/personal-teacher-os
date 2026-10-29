// REMARCAR A PRÓPRIA AULA (Onda Agenda e Mensagens · M2, 01/09/2026).
//
// Decisão do dono: a professora remarca só para horário livre para os dois
// (a agenda semanal dela − aulas − bloqueios − ocupado do Google), SEM consumir
// a alçada do aluno. Quem DECIDE é o banco (`teacher_reschedule_own_class`,
// Lei 3); esta tela só antecipa, com a mesma grade do portal
// (`availableSlots`) — e sem os horários que ENCOSTAM em reposição publicada
// dela, que a RPC recusa (despublicar antes; migration 20261029000100).
//
// A lista de horários é a mesma que o aluno vê, no relógio DELA (F3-D2), com
// a hora do aluno ao lado quando o snapshot da aula a tem.
import Link from 'next/link'
import { DateTime } from 'luxon'
import { notFound, redirect } from 'next/navigation'

import { fmtLocal, tzSuffix } from '@/lib/format'
import { availableSlots } from '@/lib/portal/computed-slots'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { carregarRemarcacao } from '@/data/teacher/remarcar'
import { btnInk, chipOff, inputSm, Card, Field } from '@/components/ui'
import { rescheduleOwnClassAction } from '../../actions'

export const metadata = { title: 'Remarcar aula — Painel da professora' }

/** "2026-07-28 20:00 Europe/Lisbon" → "20:00 (horário de Lisboa)". */
function humanSnapshot(snapshot: string | null): string | null {
  const m = (snapshot ?? '').match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::\d{2})? (.+)$/)
  if (!m) return null
  return `${m[2]} (${tzSuffix(m[3])})`
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-col gap-4">
      <header>
        <Link href="/teacher?aba=aulas" className="text-sm font-semibold text-brand-700 hover:underline">
          ← Suas aulas
        </Link>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink-900">Remarcar aula</h1>
      </header>
      {children}
    </main>
  )
}

export default async function RemarcarProfessoraPage({
  params,
  searchParams,
}: {
  params: Promise<{ instance: string }>
  searchParams: Promise<{ escolha?: string }>
}) {
  const { instance } = await params
  const { escolha } = await searchParams
  const supabase = await createClient()

  // Leitura em `src/data/teacher/` (A6 do gate Sol): conta sem vínculo, aula
  // inexistente/alheia (404) e FALHA de leitura são três coisas diferentes.
  const carga = await carregarRemarcacao(supabase, instance)
  if (carga.tipo === 'nao_encontrada') notFound()
  if (carga.tipo === 'sem_sessao') redirect('/login')
  if (carga.tipo === 'sem_vinculo') {
    return (
      <Moldura>
        <Card className="p-6">
          <p className="text-base font-semibold text-ink-900">Sua conta não está vinculada a uma professora.</p>
          <p className="mt-1 text-sm text-ink-600">Fale com a administração para vincular o seu acesso.</p>
        </Card>
      </Moldura>
    )
  }
  if (carga.tipo === 'erro') {
    return (
      <Moldura>
        <Card className="p-6">
          <p className="text-base font-semibold text-ink-900">Não consegui abrir esta aula agora.</p>
          <p className="mt-1 text-sm text-ink-600">Tente de novo em instantes. Nada foi alterado.</p>
        </Card>
      </Moldura>
    )
  }
  const { professora: teacher, aula } = carga
  const tz: string = teacher.iana_tz ?? 'America/Cuiaba'

  if (aula.state !== 'scheduled') {
    return (
      <Moldura>
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-base font-semibold text-ink-900">Essa aula já não está agendada.</p>
          <Link href="/teacher?aba=aulas" className={btnInk}>
            Ver suas aulas
          </Link>
        </Card>
      </Moldura>
    )
  }

  // F1 (M1-5): a remarcação herda a duração REAL da aula — o intervalo exato
  // vai para o filtro (S5: minutos arredondados oferecem um vão onde ela não cabe).
  const duracaoMs = Math.max(15 * 60_000, Date.parse(aula.ends_at_utc) - Date.parse(aula.starts_at_utc))
  const duracaoMin = Math.round(duracaoMs / 60_000)

  // As cinco leituras da grade saem pelo service client: a POSSE já foi provada
  // pela view acima, e a sessão da professora não tem SELECT em todas as tabelas
  // que a grade cruza. Nada aqui grava; quem decide continua sendo a RPC.
  const admin = createAdminClient()
  const grade = await availableSlots(admin, admin, teacher.id, { durationMs: duracaoMs })
  if (grade.erro || !grade.dado) {
    return (
      <Moldura>
        <Card className="p-6">
          <p className="text-base font-semibold text-ink-900">Não consegui ler seus horários livres agora.</p>
          <p className="mt-1 text-sm text-ink-600">Tente de novo em instantes. Nada foi alterado.</p>
        </Card>
      </Moldura>
    )
  }
  // Sem os horários que encostam em reposição publicada: a RPC os recusa
  // (despublicar antes). A janela não guarda duração; a RPC a mede com a maior
  // duração que pode consumi-la na agenda dela (maior slot ativo, maior aula
  // futura, nunca menos que esta aula). Aqui a mesma régua, pelo que a tela
  // consegue ler sem mais uma leitura: esta aula e os slots ativos dela. Quem
  // decide segue sendo a RPC — a tela só evita oferecer o que ela recusaria.
  const [{ data: janelas, error: eJanelas }, { data: slotsDela, error: eSlots }] = await Promise.all([
    admin
      .from('reschedule_windows')
      .select('starts_at_utc')
      .eq('teacher_id', teacher.id)
      .eq('state', 'publicada')
      .gt('starts_at_utc', DateTime.utc().minus({ hours: 8 }).toISO()),
    admin
      .from('recurring_slots')
      .select('duration_min')
      .eq('teacher_id', teacher.id)
      .lte('active_from', DateTime.now().setZone(tz).toISODate())
      .or(`active_to.is.null,active_to.gte.${DateTime.now().setZone(tz).toISODate()}`),
  ])
  if (eJanelas || eSlots) {
    return (
      <Moldura>
        <Card className="p-6">
          <p className="text-base font-semibold text-ink-900">Não consegui ler seus horários livres agora.</p>
          <p className="mt-1 text-sm text-ink-600">Tente de novo em instantes. Nada foi alterado.</p>
        </Card>
      </Moldura>
    )
  }
  const medidaDaJanelaMs = Math.max(duracaoMs, ...(slotsDela ?? []).map((r) => Number(r.duration_min) * 60_000))
  const encostaEmJanela = (inicioMs: number): boolean =>
    (janelas ?? []).some((w) => {
      const wMs = Date.parse(w.starts_at_utc)
      return wMs < inicioMs + duracaoMs && wMs + medidaDaJanelaMs > inicioMs
    })
  const slots = grade.dado.slots.filter((s) => s.windowId === null && !encostaEmJanela(Date.parse(s.startsAtUtc)))
  const googleDegraded = grade.dado.googleDegraded
  const escolhida = escolha ? slots.find((s) => s.key === escolha) : undefined
  const dias = [...new Set(slots.map((s) => DateTime.fromISO(s.startsAtUtc).setZone(tz).toFormat('yyyy-LL-dd')))]
  const horaDoAluno = humanSnapshot(aula.local_time_snapshot)

  return (
    <Moldura>
      <Card className="flex flex-col gap-1 p-5">
        <span className="text-sm text-ink-600">Aula de agora</span>
        <p className="text-base font-semibold text-ink-900 first-letter:uppercase">{fmtLocal(aula.starts_at_utc, tz)}</p>
        <p className="text-sm text-ink-900">
          {aula.student_label ?? '—'} · {duracaoMin} min · {tzSuffix(tz)}
          {horaDoAluno && <span className="text-ink-600"> · aluno: {horaDoAluno}</span>}
        </p>
        <p className="mt-2 text-sm font-medium text-ink-900">
          A mudança parte da escola: <strong>nada é descontado do aluno</strong>. Ele é avisado por e-mail e
          WhatsApp, e a administração recebe o seu motivo.
        </p>
      </Card>

      {escolhida ? (
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="font-display text-base font-bold text-ink-900">Confira antes de confirmar</h2>
          <div className="flex flex-col gap-1">
            <p className="text-sm text-ink-600">
              De: <span className="font-medium text-ink-900 first-letter:uppercase">{fmtLocal(aula.starts_at_utc, tz)}</span>
            </p>
            <p className="text-sm text-ink-600">
              Para:{' '}
              <span className="font-semibold text-ink-900 first-letter:uppercase">{fmtLocal(escolhida.startsAtUtc, tz)}</span>{' '}
              ({tzSuffix(tz)})
            </p>
          </div>
          <form action={rescheduleOwnClassAction} className="flex flex-col gap-3">
            <input type="hidden" name="instance_id" value={aula.id} />
            <input type="hidden" name="starts_at_utc" value={escolhida.startsAtUtc} />
            {googleDegraded && <input type="hidden" name="google_degraded" value="1" />}
            <Field label="Motivo (obrigatório — vai para a administração, não para o aluno)">
              <textarea name="reason" required minLength={3} maxLength={500} rows={3} className={inputSm} />
            </Field>
            <button type="submit" className={btnInk}>
              Confirmar remarcação
            </button>
          </form>
          <Link href={`/teacher/remarcar/${aula.id}`} className={`${chipOff} self-center`}>
            ← escolher outro horário
          </Link>
        </Card>
      ) : slots.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="max-w-md text-base font-semibold text-ink-900">
            Nenhum horário livre nas próximas 2 semanas.
          </p>
          <p className="max-w-md text-sm text-ink-600">
            A grade nasce da sua disponibilidade semanal e das aberturas — sem bloqueios, sem aula marcada e sem
            compromisso do Google. Abra um horário na sua agenda e volte aqui.
          </p>
          <Link href="/teacher?painel=janelas" className={btnInk}>
            Ver minha disponibilidade
          </Link>
        </Card>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-base font-bold text-ink-900">Escolha o novo horário</h2>
          {googleDegraded && (
            <p className="text-sm text-ink-600">
              Não consegui ler sua agenda do Google agora — confira lá antes de confirmar.
            </p>
          )}
          {dias.map((dia) => (
            <Card key={dia} className="flex flex-col gap-3 p-4">
              <p className="text-sm font-medium text-ink-900 first-letter:uppercase">
                {DateTime.fromISO(dia).setLocale('pt-BR').toFormat("cccc, dd 'de' LLLL")}
              </p>
              <ul className="flex flex-wrap gap-2">
                {slots
                  .filter((s) => DateTime.fromISO(s.startsAtUtc).setZone(tz).toFormat('yyyy-LL-dd') === dia)
                  .map((s) => (
                    <li key={s.key}>
                      <Link
                        href={`/teacher/remarcar/${aula.id}?escolha=${encodeURIComponent(s.key)}`}
                        className={`${chipOff} tabular-nums`}
                      >
                        {DateTime.fromISO(s.startsAtUtc).setZone(tz).toFormat('HH:mm')}
                      </Link>
                    </li>
                  ))}
              </ul>
            </Card>
          ))}
        </section>
      )}
    </Moldura>
  )
}
