// Cronograma M3-UI (20/07/2026) — o PLANO DO ALUNO no painel da professora:
// briefing resumido (estilo Kolb + interesses), módulos da trilha com a
// personalização dela, sugestões da IA para aceitar/editar, e a aula da
// Flexge de cada módulo. RLS entrega só contratos DELA; posse re-validada
// nas RPCs (D10).
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { one } from '@/lib/embed'
import { createClient } from '@/lib/supabase/server'
import { KOLB_STYLE_LABEL } from '@/lib/briefing/schema'
import { resumoDoBriefing } from '@/lib/briefing/leitura'
import { FlexgeLessonPicker } from '@/components/FlexgeLessonPicker'
import { btnBrandSm, btnInkSm, inputSm, Card, Drawer, EmptyState, Field, Pill, SectionTitle } from '@/components/ui'
import { generateStudyPlanAction, suggestPlanAction, updatePlanItemAction } from '../../actions'

export const metadata = { title: 'Plano do aluno — Personal Teacher' }

const areaSm = `${inputSm} min-h-20 w-full`

export default async function PlanoDoAlunoPage({
  params,
}: {
  params: Promise<{ contract: string }>
}) {
  const { contract } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: c } = await supabase
    .from('contracts')
    .select('id, status, students!contracts_student_id_fkey(id, display_name, level)')
    .eq('id', contract)
    .maybeSingle()
  if (!c) notFound()
  const student = one(c.students)

  const [{ data: briefingRows }, { data: plans }] = await Promise.all([
    student
      ? supabase
          .from('briefings')
          .select('status, kolb_style, answers')
          .eq('student_id', student.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('study_plans')
      .select('id, semester_no, starts_on, ends_on, level_snapshot')
      .eq('contract_id', contract)
      .order('semester_no', { ascending: false })
      .limit(1),
  ])
  const briefing = briefingRows
  const plan = plans?.[0] ?? null

  const { data: itens } = plan
    ? await supabase
        .from('study_plan_items')
        .select('id, position, title, theme, approach, flexge_lesson_id, flexge_lesson_href, suggested_theme, suggested_approach')
        .eq('plan_id', plan.id)
        .order('position')
    : { data: null }

  // cobertura: módulos já apontados em alguma aula
  const apontados = new Set<string>()
  if (itens?.length) {
    const { data: reps } = await supabase
      .from('class_content_reports')
      .select('plan_item_id')
      .in('plan_item_id', itens.map((i) => i.id))
    for (const r of reps ?? []) if (r.plan_item_id) apontados.add(r.plan_item_id)
  }

  const kolb = briefing?.kolb_style ? KOLB_STYLE_LABEL[briefing.kolb_style] : null

  // O BRIEFING QUE VALE NESTE CICLO, não o de sempre (revisão de integração,
  // achado 6). A professora lia o base enquanto a IA sugeria o plano em cima do
  // EFETIVO — o aluno tinha atualizado "quer inglês para trabalho" para
  // "imigração" e só a máquina sabia. Agora as duas leem a mesma coisa:
  // `briefing_effective` do (contrato, semestre) do plano que esta tela mostra.
  // Sem plano não há ciclo, e o base é o que vale.
  //
  // Falha na RPC não vira base silenciosamente: o resumo cai para o base e a
  // tela DIZ que caiu — a professora precisa saber que está lendo o original.
  let answersDoCiclo: unknown = briefing?.answers ?? null
  let efetivoDegradado = false
  if (student && plan) {
    const { data: efetivo, error: erroEfetivo } = await supabase.rpc('briefing_effective', {
      p_student: student.id,
      p_contract: contract,
      p_semester: plan.semester_no,
    })
    if (erroEfetivo) efetivoDegradado = true
    else answersDoCiclo = efetivo ?? briefing?.answers ?? null
  }
  // Briefing v2 (28/07): a leitura aqui citava as chaves literais e a FORMA
  // delas — `a.objetivos.finalidades` só desenhava quando era string, e no v2 é
  // lista (ou, no ramo criança, é `para_que_ingles`). `resumoDoBriefing` lê as
  // duas versões pelo mesmo caminho; a página dela não mudou de desenho.
  const resumo = resumoDoBriefing(answersDoCiclo)

  return (
    <main className="flex flex-col gap-5">
      <header>
        <Link href="/teacher?aba=alunos" className="text-xs font-semibold text-brand-700 hover:underline">
          ← seus alunos
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          <h1 className="font-display text-2xl font-bold text-ink-900">{student?.display_name ?? '—'}</h1>
          {student?.level && <Pill tone="brand">{student.level}</Pill>}
          {c.status !== 'active' && <Pill tone="muted">{c.status}</Pill>}
        </div>
      </header>

      {/* Briefing resumido — a leitura pré-primeira-aula */}
      <Card className="flex flex-col gap-2 p-5">
        <SectionTitle>Briefing do aluno</SectionTitle>
        {briefing?.status === 'submitted' ? (
          <>
            {efetivoDegradado && (
              <p className="text-sm text-warn-700">
                Não deu para carregar a atualização deste semestre — o que está abaixo é o briefing
                original. Recarregue a página para tentar de novo.
              </p>
            )}
            {kolb && (
              <p className="text-sm text-ink-900">
                Estilo de aprendizagem: <strong>{kolb.nome}</strong>{' '}
                <span className="text-ink-600">— {kolb.leitura}</span>
              </p>
            )}
            {resumo.hobbies.length > 0 && (
              <p className="text-sm text-ink-600">
                Gosta de: {resumo.hobbies.join(' · ')}
              </p>
            )}
            {resumo.finalidades && (
              <p className="text-sm text-ink-600">
                Quer o inglês para: {resumo.finalidades}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-warn-700">
            Briefing ainda não respondido — o aluno o preenche no primeiro acesso ao portal.
          </p>
        )}
      </Card>

      {!plan ? (
        <EmptyState
          title="Este aluno ainda não tem plano de estudos."
          hint={
            student?.level
              ? `Gerar cria o plano do semestre atual copiando a trilha do nível ${student.level} — depois você personaliza módulo a módulo.`
              : 'Peça à administração para definir o NÍVEL do aluno na ficha — sem nível não há trilha.'
          }
        />
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>
              Plano — semestre {plan.semester_no} · {plan.level_snapshot}
            </SectionTitle>
            <form action={suggestPlanAction}>
              <input type="hidden" name="contract_id" value={contract} />
              <input type="hidden" name="plan_id" value={plan.id} />
              <button type="submit" className={btnBrandSm} title="A IA propõe tema e abordagem por módulo, a partir do briefing — você decide.">
                ✨ Sugerir temas com IA
              </button>
            </form>
          </div>

          <ul className="flex flex-col gap-3">
            {(itens ?? []).map((i) => (
              <li key={i.id}>
                <Card className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink-900">
                      <span className="mr-1.5 font-mono text-xs text-ink-400">{i.position}.</span>
                      {i.title}
                      {apontados.has(i.id) && <span className="ml-2 text-xs font-bold text-ok-700">aplicado em aula ✓</span>}
                    </p>
                    <Drawer label="personalizar" title={`Módulo ${i.position} — ${i.title}`}>
                      <form action={updatePlanItemAction} className="flex flex-col gap-3">
                        <input type="hidden" name="contract_id" value={contract} />
                        <input type="hidden" name="item_id" value={i.id} />
                        <Field label="Tema para este aluno" hint="o conteúdo vestido no interesse dele">
                          <textarea name="theme" defaultValue={i.theme ?? i.suggested_theme ?? ''} className={areaSm} />
                        </Field>
                        <Field label="Como aplicar" hint="casada ao estilo de aprendizagem do briefing">
                          <textarea name="approach" defaultValue={i.approach ?? i.suggested_approach ?? ''} className={areaSm} />
                        </Field>
                        <Field label="Aula pronta da Flexge (opcional)">
                          <FlexgeLessonPicker
                            idName="flexge_lesson_id"
                            hrefName="flexge_lesson_href"
                            level={plan.level_snapshot}
                            defaultId={i.flexge_lesson_id}
                            defaultTitle={i.flexge_lesson_id ? 'aula já escolhida (buscar para trocar)' : null}
                          />
                        </Field>
                        <button type="submit" className={btnInkSm}>
                          Salvar módulo
                        </button>
                      </form>
                    </Drawer>
                  </div>

                  {(i.theme || i.approach) && (
                    <div className="text-sm text-ink-600">
                      {i.theme && <p><span className="font-semibold text-ink-900">Tema:</span> {i.theme}</p>}
                      {i.approach && <p><span className="font-semibold text-ink-900">Como:</span> {i.approach}</p>}
                    </div>
                  )}

                  {!i.theme && i.suggested_theme && (
                    <div className="rounded-input border border-brand-700/25 bg-brand-700/4 p-3 text-sm">
                      <p className="text-[10px] font-bold tracking-wide text-brand-700 uppercase">Sugestão da IA</p>
                      <p className="mt-1 text-ink-900">{i.suggested_theme}</p>
                      {i.suggested_approach && <p className="mt-0.5 text-ink-600">{i.suggested_approach}</p>}
                      <form action={updatePlanItemAction} className="mt-2">
                        <input type="hidden" name="contract_id" value={contract} />
                        <input type="hidden" name="item_id" value={i.id} />
                        <input type="hidden" name="theme" value={i.suggested_theme} />
                        <input type="hidden" name="approach" value={i.suggested_approach ?? ''} />
                        <input type="hidden" name="flexge_lesson_id" value={i.flexge_lesson_id ?? ''} />
                        <input type="hidden" name="flexge_lesson_href" value={i.flexge_lesson_href ?? ''} />
                        <button type="submit" className="text-xs font-semibold text-brand-700 hover:underline">
                          usar esta sugestão ✓
                        </button>
                      </form>
                    </div>
                  )}

                  {i.flexge_lesson_href && (
                    <a
                      href={`https://app.flexge.com${i.flexge_lesson_href}`}
                      target="_blank"
                      rel="noreferrer"
                      className="self-start text-xs font-semibold text-teal-700 hover:underline"
                    >
                      Abrir a aula no Flexge →
                    </a>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!plan && student?.level && (
        <form action={generateStudyPlanAction}>
          <input type="hidden" name="contract_id" value={contract} />
          <button type="submit" className={btnBrandSm}>
            Gerar plano do semestre
          </button>
        </form>
      )}
    </main>
  )
}
