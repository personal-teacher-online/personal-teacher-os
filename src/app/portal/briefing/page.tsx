// M0b do cronograma (19/07/2026) — BRIEFING do aluno no portal, BLOQUEANTE
// após a ciência (decisão do mantenedor): 6 etapas com salvamento parcial (RPC
// save_briefing_draft) e envio final que valida e calcula o Kolb NO BANCO.
// M0c: os CAMPOS moram em src/components/BriefingFields.tsx (compartilhados
// com a retaguarda da dona na ficha do aluno).
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { btnBrand, btnPaperSm, Card, Pill } from '@/components/ui'
import {
  BRIEFING_ETAPAS,
  BRIEFING_INTRO,
  KOLB_STYLE_LABEL,
  chavesObrigatorias,
  respondido,
  type SecaoBriefing,
  type TipoAluno,
  type VersaoBriefing,
} from '@/lib/briefing/schema'
import {
  EtapaFechar,
  EtapaHistoria,
  EtapaHistoriaV2,
  EtapaInteresses,
  EtapaInteressesV2,
  EtapaKolb,
  EtapaObjetivos,
  EtapaObjetivosV2,
  EtapaRotina,
  type BriefingAnswers,
} from '@/components/BriefingFields'
import { ResgateDoEnvio } from '@/components/kit/ResgateDoEnvio'
import { saveBriefingStepAction, submitBriefingAction } from '../actions'

export const metadata = { title: 'Seu briefing — Personal Teacher Academy' }

function Etapa({
  n,
  versao,
  children,
}: {
  n: number
  versao: VersaoBriefing
  children: React.ReactNode
}) {
  return (
    <form action={saveBriefingStepAction} className="flex flex-col gap-4">
      <input type="hidden" name="etapa" value={n} />
      {/* A VERSÃO SOB A QUAL esta tela foi desenhada. A action a confere contra
          a versão real da linha e recusa se divergirem: um formulário v1 aberto
          e enviado depois de a linha virar v2 (ou o contrário) seria parseado
          com régua diferente da que a pessoa viu — campos calados, respostas
          gravadas sob chave errada. */}
      <input type="hidden" name="versao" value={versao} />
      {children}
      <button type="submit" className={`${btnBrand} w-full`}>
        Salvar e continuar
      </button>
      {/* K2: sem isto, a recusa do servidor nesta etapa some — este formulário
          não desenha contador nenhum, e é justamente onde o commit perdido não
          tem quem o force (ver `ResgateDoEnvio`). */}
      <ResgateDoEnvio />
    </form>
  )
}

export default async function BriefingPage({
  searchParams,
}: {
  searchParams: Promise<{ etapa?: string }>
}) {
  const { etapa: etapaRaw } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: rows, error: erroBriefing }, { data: eu, error: erroAluno }] = await Promise.all([
    supabase
      .from('briefings')
      .select('answers, kolb_answers, kolb_style, kolb_scores, status, schema_version')
      .limit(1),
    supabase.from('students').select('student_type').limit(1),
  ])
  // Leitura que falha NÃO vira "briefing em branco, ramo adulto, versão 2"
  // (revisão de integração, médio 3): seria a régua ERRADA desenhada em cima das
  // respostas de alguém — criança recebendo o formulário de adulto, rascunho v1
  // reaberto como v2. Erro é erro; o caminho é recarregar.
  if (erroBriefing || erroAluno)
    return (
      <main className="flex flex-col gap-5">
        <Card className="flex flex-col gap-3 p-6">
          <h1 className="font-display text-2xl font-bold text-ink-900">Não deu para carregar</h1>
          <p className="text-sm leading-relaxed text-ink-600">
            Tivemos um problema para abrir o seu briefing. Recarregue a página em instantes — nada
            do que você já respondeu se perdeu.
          </p>
          <Link href="/portal/briefing" className={`${btnBrand} w-full text-center`}>
            Tentar de novo
          </Link>
        </Card>
      </main>
    )
  const b = rows?.[0] ?? null
  const a = (b?.answers ?? {}) as BriefingAnswers
  const kolbFeito = (b?.kolb_answers ?? {}) as Record<string, string>
  // A régua é a da LINHA: rascunho começado nas telas v1 termina no v1. Quem
  // ainda não tem linha vê o v2 — é o que o default da coluna vai carimbar no
  // primeiro `save_briefing_draft` (migration 20260728000200).
  const versao: VersaoBriefing = b?.schema_version === 1 ? 1 : 2
  const tipo: TipoAluno = eu?.[0]?.student_type === 'child' ? 'child' : 'adult'

  // enviado → tela de "tudo certo" com o estilo (o bloqueio da home já liberou)
  if (b?.status === 'submitted') {
    const st = KOLB_STYLE_LABEL[b.kolb_style ?? ''] ?? null
    return (
      <main className="flex flex-col gap-5">
        <header>
          <h1 className="font-display text-2xl font-bold text-ink-900">Seu briefing</h1>
        </header>
        <Card className="flex flex-col gap-3 p-6">
          <Pill tone="ok">enviado ✓</Pill>
          {st && (
            <p className="text-sm leading-relaxed text-ink-900">
              Seu estilo de aprendizagem: <strong>{st.nome}</strong> — {st.leitura}
            </p>
          )}
          <p className="text-sm text-ink-600">
            Suas respostas já estão com a sua professora — elas guiam o planejamento das suas
            aulas. Precisando corrigir algo, fale com a gente.
          </p>
          <Link href="/portal" className={`${btnBrand} w-full text-center`}>
            Ir para o início
          </Link>
        </Card>
      </main>
    )
  }

  const etapa = Math.min(6, Math.max(1, Number(etapaRaw ?? 1) || 1))
  // No v1 a etapa conta como feita quando tem qualquer resposta salva (era o que
  // o envio cobrava: seção não-vazia). No v2 quem manda são as obrigatórias do
  // ramo — as mesmas que o banco cobra no envio, lidas do dicionário.
  const done = (slug: string) => {
    if (slug === 'kolb') return Object.keys(kolbFeito).length >= 12
    const secao = (a[slug] ?? {}) as Record<string, unknown>
    if (versao === 1 || slug === 'livre') return Object.keys(secao).length > 0
    const exigidas = chavesObrigatorias(slug as SecaoBriefing, tipo)
    return exigidas.length > 0 && exigidas.every((c) => respondido(secao[c]))
  }

  return (
    <main className="flex flex-col gap-5">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink-900">
          Antes da sua primeira aula 👋
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-600">{BRIEFING_INTRO}</p>
      </header>

      {/* trilha das etapas — feitas ficam marcadas; navegação livre entre elas */}
      <nav className="flex flex-wrap gap-1.5" aria-label="Etapas do briefing">
        {BRIEFING_ETAPAS.map((e) => (
          <Link
            key={e.n}
            href={`/portal/briefing?etapa=${e.n}`}
            className={`inline-flex min-h-9 items-center gap-1 rounded-pill border px-3 text-xs whitespace-nowrap transition-colors ${
              e.n === etapa
                ? 'border-brand-700 bg-brand-700 font-semibold text-white'
                : 'border-line bg-paper-0 text-ink-600 hover:border-ink-600'
            }`}
          >
            {done(e.slug) && <span className={e.n === etapa ? 'text-white' : 'text-ok-700'}>✓</span>}
            {e.n}. {e.titulo}
          </Link>
        ))}
      </nav>

      <Card className="p-6">
        {etapa === 1 && (
          <Etapa n={1} versao={versao}>
            {versao === 1 ? <EtapaHistoria a={a} /> : <EtapaHistoriaV2 a={a} />}
          </Etapa>
        )}
        {etapa === 2 && (
          <Etapa n={2} versao={versao}>
            {versao === 1 ? <EtapaObjetivos a={a} /> : <EtapaObjetivosV2 a={a} tipo={tipo} />}
          </Etapa>
        )}
        {etapa === 3 && (
          <Etapa n={3} versao={versao}>
            {versao === 1 ? <EtapaInteresses a={a} /> : <EtapaInteressesV2 a={a} />}
          </Etapa>
        )}
        {etapa === 4 && (
          <Etapa n={4} versao={versao}>
            <EtapaRotina a={a} />
          </Etapa>
        )}
        {etapa === 5 && (
          <Etapa n={5} versao={versao}>
            <EtapaKolb kolb={kolbFeito} notaResponsavel={versao >= 2 && tipo === 'child'} />
          </Etapa>
        )}
        {etapa === 6 && (
          <form action={submitBriefingAction} className="flex flex-col gap-4">
            <input type="hidden" name="versao" value={versao} />
            <EtapaFechar a={a} versao={versao} />
            <p className="text-xs text-ink-400">
              Ao enviar, suas respostas vão para a sua professora e não podem mais ser editadas
              por aqui — qualquer ajuste, é só falar com a gente.
            </p>
            <button type="submit" className={`${btnBrand} w-full`}>
              Enviar briefing
            </button>
            <ResgateDoEnvio />
            <Link href={`/portal/briefing?etapa=5`} className={`${btnPaperSm} text-center`}>
              ← voltar
            </Link>
          </form>
        )}
      </Card>
    </main>
  )
}
