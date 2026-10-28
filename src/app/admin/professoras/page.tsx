import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { CityPicker } from '@/components/CityPicker'
import { tzLabel } from '@/lib/format'
import {
  btnInkSm,
  input,
  Field,
  FlashMsg,
  Pill,
  SidePanel,
  toolbarLink,
  TEACHER_FILL,
} from '@/components/ui'
import { createAndInviteTeacherAction } from './actions'

export const metadata = { title: 'Professoras — Admin' }

// Rodada B: a lista vira porta de entrada para a FICHA da professora (que não
// existia — dor 14/29). Cada cartão mostra o essencial; o resto mora na ficha.

type Estado = 'ativa' | 'pendente' | 'sem_acesso' | 'arquivada'

const ESTADO_PILL: Record<Estado, { label: string; tone: 'ok' | 'warn' | 'neutral' | 'muted' }> = {
  ativa: { label: 'ativa', tone: 'ok' },
  pendente: { label: 'convidada — pendente', tone: 'warn' },
  sem_acesso: { label: 'sem acesso', tone: 'neutral' },
  arquivada: { label: 'arquivada', tone: 'muted' },
}

export default async function ProfessorasPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; arq?: string; painel?: string }>
}) {
  const { msg, arq, painel } = await searchParams
  const showArchived = arq === '1'
  const supabase = await createClient()

  const [{ data: teachers }, { data: contracts }] = await Promise.all([
    supabase
      .from('teachers')
      .select('id, display_name, iana_tz, profile_id, is_owner, archived_at, contract_kind')
      .order('is_owner', { ascending: false })
      .order('display_name'),
    supabase
      .from('contracts')
      .select('id, teacher_id, status, contract_type, students!contracts_student_id_fkey(status)')
      .eq('status', 'active')
      .eq('contract_type', 'private_1on1'),
  ])

  const admin = createAdminClient()
  const linkedIds = (teachers ?? []).map((t) => t.profile_id).filter((id): id is string => !!id)
  const confirmedEntries = await Promise.all(
    linkedIds.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id)
      return [id, Boolean(data?.user?.email_confirmed_at)] as const
    }),
  )
  const confirmedById = new Map(confirmedEntries)

  // Mesmo predicado "vivos" da ficha: contrato ativo E aluno não-arquivado. O
  // backfill da leva 7 arquivou ex-alunos sem encerrar o contrato, então um
  // contrato 'active' pode pertencer a um arquivado — não conta no cartão.
  const alunosPorProfessora = new Map<string, number>()
  for (const c of contracts ?? []) {
    const student = Array.isArray(c.students) ? c.students[0] : c.students
    if (student?.status === 'archived') continue
    if (c.teacher_id) alunosPorProfessora.set(c.teacher_id, (alunosPorProfessora.get(c.teacher_id) ?? 0) + 1)
  }

  const allRows = (teachers ?? [])
    .filter((t) => t.display_name)
    .map((t) => {
      const estado: Estado = t.archived_at
        ? 'arquivada'
        : !t.profile_id
          ? 'sem_acesso'
          : confirmedById.get(t.profile_id)
            ? 'ativa'
            : 'pendente'
      return { ...t, estado }
    })
  const archivedCount = allRows.filter((t) => t.estado === 'arquivada').length
  const rows = allRows.filter((t) => (showArchived ? true : t.estado !== 'arquivada'))
  // cor: mesma convenção da agenda (dona primeiro, depois alfabético; arquivadas fora)
  const colorIdx = new Map(allRows.filter((t) => t.estado !== 'arquivada').map((t, i) => [t.id, i]))

  return (
    <main className="flex flex-col gap-4">
      <FlashMsg msg={msg} />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-bold text-ink-900">
          Professoras <span className="font-sans text-sm font-normal text-ink-400">({rows.length})</span>
        </h2>
        {archivedCount > 0 && (
          <Link
            href={showArchived ? '/admin/professoras' : '/admin/professoras?arq=1'}
            className="text-xs font-semibold text-ink-400 hover:text-brand-700 hover:underline"
          >
            {showArchived ? 'ocultar arquivadas' : `ver arquivadas (${archivedCount})`}
          </Link>
        )}
      </header>

      <ul className="grid gap-3 sm:grid-cols-2">
        {rows.map((t) => {
          const idx = colorIdx.get(t.id)
          const alunos = alunosPorProfessora.get(t.id) ?? 0
          return (
            <li key={t.id}>
              <Link
                href={`/admin/professoras/${t.id}`}
                className="card-interactive flex h-full flex-col gap-2 rounded-card border border-line-soft bg-paper-0 p-4"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    {idx != null && <span className={`h-2.5 w-2.5 rounded-full ${TEACHER_FILL[idx % TEACHER_FILL.length]}`} />}
                    <span className={`font-semibold ${t.estado === 'arquivada' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
                      {t.display_name}
                    </span>
                    {t.is_owner && <Pill tone="brand">dona</Pill>}
                  </span>
                  {t.is_owner && t.estado !== 'ativa' ? (
                    <Pill tone="neutral">acessa como admin</Pill>
                  ) : (
                    <Pill tone={ESTADO_PILL[t.estado].tone}>{ESTADO_PILL[t.estado].label}</Pill>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-600">
                  <span>
                    {alunos} aluno{alunos === 1 ? '' : 's'} de aula particular
                  </span>
                  <span className="text-ink-400">· {tzLabel(t.iana_tz)}</span>
                  {t.contract_kind && <span className="text-ink-400">· {t.contract_kind}</span>}
                </span>
                <span className="text-xs font-semibold text-brand-700">abrir ficha →</span>
              </Link>
            </li>
          )
        })}
        {rows.length === 0 && (
          <li className="col-span-full rounded-card border border-dashed border-line p-6 text-center text-sm text-ink-400">
            Nenhuma professora por aqui ainda.
          </li>
        )}
      </ul>

      <Link href="/admin/professoras?painel=nova" className={toolbarLink}>
        ＋ Cadastrar professora
      </Link>

      {painel === 'nova' && (
        <SidePanel title="Cadastrar professora" closeHref="/admin/professoras">
          <form action={createAndInviteTeacherAction} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 items-end gap-4">
              <Field label="Nome">
                <input name="display_name" required placeholder="Nome da professora" className={input} />
              </Field>
              <Field label="E-mail" hint="para onde vai o convite">
                <input name="email" type="email" required placeholder="professora@exemplo.com" className={input} />
              </Field>
              <Field label="Valor/hora (R$)" hint="0 se não for paga por hora">
                <input name="hourly_rate" required type="number" step="0.01" min="0" placeholder="50,00" className={input} />
              </Field>
              <Field label="CPF (opcional)">
                <input name="cpf" placeholder="000.000.000-00" className={input} />
              </Field>
              <Field label="Tipo de vínculo (opcional)">
                <input name="contract_kind" placeholder="ex.: PJ — paga por hora auditada" className={input} />
              </Field>
              <Field label="Condições de pagamento (opcional)">
                <input name="payment_terms" placeholder="ex.: paga por hora auditada" className={input} />
              </Field>
            </div>
            <div className="max-w-xl">
              <span className="mb-1 block text-xs font-semibold text-ink-600">Fuso da professora</span>
              <CityPicker tzName="iana_tz" defaultTz="America/Cuiaba" required />
            </div>
            <div>
              <button type="submit" className={btnInkSm}>
                Cadastrar e convidar
              </button>
            </div>
          </form>
          <p className="mt-3 max-w-xl text-xs leading-relaxed text-ink-400">
            Ao cadastrar, a professora recebe o e-mail para criar a senha e cai no painel dela. Se o
            e-mail não chegar, use “reenviar convite” na ficha.
          </p>
        </SidePanel>
      )}
    </main>
  )
}
