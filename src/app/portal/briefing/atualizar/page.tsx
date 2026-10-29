// RE-BRIEFING SEMESTRAL (briefing v2 · sub-lote 4 da onda do Portal, 28/07/2026).
//
// Duas etapas — objetivos e interesses —, as MESMAS peças da coleta v2
// (EtapaObjetivosV2/EtapaInteressesV2, que leem o dicionário), pré-preenchidas
// com o briefing EFETIVO do semestre anterior. O aluno confirma o que continua
// valendo e reescreve o que mudou; a seção enviada substitui a anterior INTEIRA
// (é assim que `briefing_effective` a devolve para o plano de estudos).
//
// NÃO é bloqueante: quem chega aqui sem nada pendente lê "nada para atualizar
// agora" e volta — nunca um erro.
//
// Aluno de briefing v1 NÃO chega aqui: `briefing_update_pendente` (a RPC que
// decide o card do Início, esta rota, o botão da ficha e o lembrete — regra
// ÚNICA) não devolve pendência para base v1 nem para base em rascunho, e as
// RPCs de escrita recusam com a frase inteira. O pré-preenchimento passa pelo
// dicionário (`paresConhecidos`) de qualquer jeito: chave que nenhuma versão do
// dicionário conhece fica de fora, e o campo nasce em branco em vez de mostrar
// resposta velha sob pergunta nova.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { btnBrand, btnPaperSm, Card } from '@/components/ui'
import { one } from '@/lib/embed'
import { secaoDoBriefing } from '@/lib/briefing/leitura'
import { paresConhecidos, type SecaoBriefing, type TipoAluno } from '@/lib/briefing/schema'
import { EtapaInteressesV2, EtapaObjetivosV2, type BriefingAnswers } from '@/components/BriefingFields'
import { ResgateDoEnvio } from '@/components/kit/ResgateDoEnvio'
import { atualizacaoDeBriefingPendente } from '@/lib/portal/data'
import { saveBriefingUpdateStepAction, submitBriefingUpdateAction } from '../../actions'

export const metadata = { title: 'Atualizar seu briefing — Personal Teacher Academy' }

const ETAPAS = [
  { n: 1, titulo: 'Seus objetivos' },
  { n: 2, titulo: 'Seus interesses' },
] as const

/** Tela de saída (sem pendência, ou leitura que falhou) — as duas terminam com
 *  o caminho de volta, nunca num beco. */
function Recado({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <main className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3 p-6">
        <h1 className="font-display text-2xl font-bold text-ink-900">{titulo}</h1>
        <p className="text-sm leading-relaxed text-ink-600">{texto}</p>
        <Link href="/portal" className={`${btnBrand} w-full text-center`}>
          Ir para o início
        </Link>
      </Card>
    </main>
  )
}

export default async function AtualizarBriefingPage({
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

  const pendencia = await atualizacaoDeBriefingPendente(supabase)
  if (pendencia.erro)
    return (
      <Recado
        titulo="Não deu para carregar agora"
        texto="Tivemos um problema para abrir a sua atualização. Tente de novo em instantes — nada do que você já respondeu se perdeu."
      />
    )
  if (!pendencia.pendente)
    return (
      <Recado
        titulo="Nada para atualizar agora"
        texto="Quando o seu próximo semestre estiver chegando, a gente te chama por aqui para contar o que mudou nos seus objetivos."
      />
    )

  const { studentId, contractId, semesterNo } = pendencia.pendente
  const [{ data: rascunhos, error: erroRascunho }, { data: anterior, error: erroAnterior }, { data: eu, error: erroAluno }] =
    await Promise.all([
      supabase
        .from('briefing_updates')
        .select('answers')
        .eq('contract_id', contractId)
        .eq('semester_no', semesterNo)
        .limit(1),
      // o efetivo do ciclo ANTERIOR: o base do aluno já com a atualização daquele
      // semestre aplicada, se houve uma (é o que ele confirmou por último)
      supabase.rpc('briefing_effective', {
        p_student: studentId,
        p_contract: contractId,
        p_semester: semesterNo - 1,
      }),
      supabase.from('students').select('student_type').limit(1),
    ])
  if (erroRascunho || erroAnterior || erroAluno)
    return (
      <Recado
        titulo="Não deu para carregar agora"
        texto="Tivemos um problema para abrir as suas respostas anteriores. Tente de novo em instantes — nada do que você já respondeu se perdeu."
      />
    )

  const rascunho = one(rascunhos)?.answers as unknown
  const tipo: TipoAluno = one(eu)?.student_type === 'child' ? 'child' : 'adult'

  // O rascunho desta atualização manda; sem ele, o efetivo anterior (filtrado
  // pelo dicionário v2 — ver o cabeçalho).
  const prefill = (secao: SecaoBriefing): Record<string, unknown> => {
    const doRascunho = secaoDoBriefing(rascunho, secao)
    if (Object.keys(doRascunho).length > 0) return doRascunho
    return paresConhecidos(secao, secaoDoBriefing(anterior, secao), 2)
  }
  const a: BriefingAnswers = { objetivos: prefill('objetivos'), interesses: prefill('interesses') }

  const etapa = Math.min(2, Math.max(1, Number(etapaRaw ?? 1) || 1))

  return (
    <main className="flex flex-col gap-5">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink-900">
          Semestre {semesterNo}: o que mudou? 🎯
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-600">
          Suas respostas de antes já estão aqui embaixo. Confirme o que continua valendo, mude o que
          mudou — é isso que a sua professora usa para montar o plano deste semestre.
        </p>
      </header>

      <nav className="flex flex-wrap gap-1.5" aria-label="Etapas da atualização">
        {ETAPAS.map((e) => (
          <Link
            key={e.n}
            href={`/portal/briefing/atualizar?etapa=${e.n}`}
            className={`inline-flex min-h-9 items-center gap-1 rounded-pill border px-3 text-xs whitespace-nowrap transition-colors ${
              e.n === etapa
                ? 'border-brand-700 bg-brand-700 font-semibold text-white'
                : 'border-line bg-paper-0 text-ink-600 hover:border-ink-600'
            }`}
          >
            {e.n}. {e.titulo}
          </Link>
        ))}
      </nav>

      <Card className="p-6">
        {etapa === 1 ? (
          <form action={saveBriefingUpdateStepAction} className="flex flex-col gap-4">
            <EtapaObjetivosV2 a={a} tipo={tipo} />
            <button type="submit" className={`${btnBrand} w-full`}>
              Salvar e continuar
            </button>
            {/* K2 — mesma rede de segurança do briefing original. */}
            <ResgateDoEnvio />
          </form>
        ) : (
          <form action={submitBriefingUpdateAction} className="flex flex-col gap-4">
            <EtapaInteressesV2 a={a} />
            <p className="text-xs text-ink-400">
              Ao enviar, esta atualização passa a valer no lugar das respostas anteriores destas duas
              etapas — o seu briefing original continua guardado.
            </p>
            <button type="submit" className={`${btnBrand} w-full`}>
              Enviar atualização
            </button>
            <ResgateDoEnvio />
            <Link href="/portal/briefing/atualizar?etapa=1" className={`${btnPaperSm} text-center`}>
              ← voltar
            </Link>
          </form>
        )}
      </Card>
    </main>
  )
}
