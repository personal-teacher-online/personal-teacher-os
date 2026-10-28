// REMARCAR (admin) — Onda da Agenda · A7, com a régua do portal (D4).
//
// ══════════════════════════════════════════════════════════════════════════════
// O QUE MUDOU, E POR QUÊ
// ══════════════════════════════════════════════════════════════════════════════
// 1. O SALDO É PERGUNTADO AO BANCO, UMA VEZ. A página fazia três contas em
//    TypeScript para dizer o que ia acontecer com o dinheiro: `used_count` numa
//    query, `makeup_balance` noutra, `allowance - used` no meio. Três cópias de
//    uma classificação que decide crédito é como a tela e o banco passam a
//    discordar — foi exatamente o que o P4 do Portal matou lá.
//    `preview_reschedule_effect` (migration `20260728000600_portal_aulas_do_banco`)
//    responde com a MESMA ordem de decisão de `reschedule_class_at`: estado →
//    tipo/status do contrato → aviso mínimo → franquia do mês → crédito. Quem
//    decide continua sendo a RPC de escrita (Lei 3); isto é leitura.
//
// 2. OS HORÁRIOS VÊM DE `availableSlots`, o mesmo motor do portal: janelas
//    publicadas MAIS a grade computada da agenda semanal, menos aulas, menos
//    bloqueios, menos o ocupado do Google, fatiado na DURAÇÃO REAL desta aula
//    (F1/M1-5). Antes a tela só listava janela publicada — e a dona precisava
//    publicar uma janela à mão para remarcar num horário que já estava livre na
//    agenda dela. O caminho de HORÁRIO NOVO continua existindo, e é o que faz
//    esta tela ser do admin: é por ele que se marca fora da disponibilidade
//    (com "furar antecedência", quando foi combinado).
//
// 3. O SALDO É RE-EXPOSTO ANTES DE GASTAR. Escolher um horário não gasta nada:
//    leva a um passo de revisão onde a consequência aparece de novo, com as
//    MESMAS palavras, ao lado do botão que executa. É a régua do portal, e aqui
//    ela vale por um motivo a mais: a dona remarca a aula de OUTRA pessoa.
//
// ══════════════════════════════════════════════════════════════════════════════
// O QUE NÃO MUDA: A CLASSIFICAÇÃO NÃO É UM PORTÃO PARA O ADMIN
// ══════════════════════════════════════════════════════════════════════════════
// No portal, `sem_saldo`/`fora_do_aviso` FECHAM a tela — o aluno não tem como
// passar. Aqui não fecham nada, e isso é desenho, não descuido: a admin tem
// CORTESIA (não consome franquia nem reposição) e FURAR ANTECEDÊNCIA (combinado
// com a professora), que são exatamente as duas saídas que aquelas recusas
// nomeiam. Esconder o caminho transformaria uma decisão comercial dela numa
// trava de tela. O que a página faz é DIZER o que aconteceria agora, e dizer
// junto qual das duas chaves resolve.
//
// ── O MOTIVO DA CORTESIA NÃO MORA NA URL (Sol · rodada 2 do A4, grave 6) ────
// O bloco de opções era um `<form method="get">`: "Aplicar" escrevia
// `?cortesia=1&furar=1&motivo=cirurgia` na barra de endereços. O motivo é texto
// LIVRE sobre a vida de alguém, e endereço vai para o histórico do navegador, o
// log de acesso, a captura de tela e o link copiado. Os booleanos podem ficar (é
// deles que a página se remonta depois de um F5); o texto passa pelo cookie de
// rascunho, sob a chave DESTA aula.
//
// A7: `manter`, `na_url` e `rascunho` saíram dos formulários. Quem decide o que
// sobrevive ao erro é `CAMPOS_DA_PORTA` (servidor), quem decide o que fica
// visível é a allowlist de geometria da tela `remarcar` (`cortesia`, `furar`,
// `escolha` — três valores sem dado de pessoa), e a chave do rascunho é derivada
// do `instance_id` que a própria action recebe.
import type { ReactNode } from 'react'
import { DateTime } from 'luxon'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { one } from '@/lib/embed'
import { fmtStudentLocal, tzLabel } from '@/lib/format'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { availableSlots } from '@/lib/portal/computed-slots'
import { previewDeRemarcacao } from '@/lib/portal/data'
import { chaveDoRemarcar, lerRascunho } from '@/lib/admin/rascunho-do-formulario'
import { enderecoDaTela, geometriaCanonica, type TelaDaAgenda } from '@/lib/admin/transporte-da-agenda'
import { lerRecado, type Recado } from '@/lib/kit/recado'
import { AvisoLegado } from '@/components/kit/aviso-legado'
import { CardPanel, CardPanelHeader } from '@/components/kit/card-panel'
import { DateField } from '@/components/DateField'
import { TimeField } from '@/components/TimeField'
import { btnInk, Field, input, Pill } from '@/components/ui'
import {
  adminBookWindowAction,
  adminRescheduleNewTimeAction,
  aplicarOpcoesDaRemarcacaoAction,
} from '../../actions'

export const metadata = { title: 'Remarcar aula — Admin' }

const BUSINESS_TZ = 'America/Cuiaba'

/** Botões no piso de AÇÃO da régua (texto ≥ `text-sm`, alvo ≥ 24px). */
const btnA7 = 'btn-ink !min-h-9 !px-3.5 !py-1.5 !text-sm'
const btnPaperA7 = 'btn-paper !min-h-9 !px-3.5 !py-1.5 !text-sm'

function plural(n: number, um: string, muitos: string): string {
  return `${n} ${n === 1 ? um : muitos}`
}

/**
 * O QUE ACONTECERIA SE ELA CONFIRMASSE AGORA — em frase de admin.
 *
 * Cada ramo é a tradução literal de um `v_efeito` de `preview_reschedule_effect`
 * (corpo lido na migration `20260728000600_portal_aulas_do_banco`), e nenhum
 * deles promete o que a função não decide. Em particular:
 *   · remarcar CONSOME reposição, nunca a produz — nenhuma frase daqui fala em
 *     reposição nascendo;
 *   · a cortesia tem ramo PRÓPRIO (ver o chamador) em vez de uma nota de rodapé:
 *     com `p_courtesy`, `reschedule_class_at` não toca franquia nem ledger, e
 *     dizer "sai 1 reposição" ao lado de uma cortesia ligada seria falso.
 */
function fraseDoEfeito(p: {
  efeito: string
  franquiaRestante: number
  saldoCreditos: number
  minNoticeHours: number
  validade: string | null
}): string {
  switch (p.efeito) {
    case 'franquia':
      return `Remarcando agora: entra na franquia do mês — restam ${plural(p.franquiaRestante, 'remarcação', 'remarcações')} depois desta.`
    case 'credito':
      return `Remarcando agora: a franquia do mês acabou, então sai 1 das ${plural(p.saldoCreditos, 'reposição', 'reposições')} do aluno${p.validade ? ` (a que vence primeiro, em ${p.validade})` : ''}.`
    case 'sem_saldo':
      return 'Remarcando agora: o banco RECUSA — a franquia do mês acabou e o aluno não tem reposição. Marque a remarcação como cortesia para não cobrar nada dele.'
    case 'fora_do_aviso':
      return `Remarcando agora: o banco RECUSA — a aula está a menos de ${plural(p.minNoticeHours, 'hora', 'horas')} do começo. Se foi combinado com a professora, ligue "furar antecedência" nas opções.`
    case 'contrato_inativo':
      return 'Remarcando agora: o banco RECUSA — o contrato do aluno não está ativo (pausado ou encerrado). Retome o contrato na ficha dele antes de remarcar.'
    case 'nao_remarcavel':
      return 'Remarcando agora: o banco RECUSA — este contrato não é particular 1:1, e o motor de remarcação só atende esses.'
    case 'nao_agendada':
      return 'Esta aula já não está agendada — não há o que remarcar.'
    default:
      return 'Não deu para conferir o que esta remarcação faria com a franquia e com a reposição do aluno. Quem decide é o banco, na confirmação.'
  }
}

function Moldura({ recado, children }: { recado: Recado | null; children: ReactNode }) {
  return (
    <main className="view-enter mx-auto flex w-full max-w-3xl flex-col gap-6">
      {recado && <AvisoLegado mensagem={recado.mensagem} chave={recado.id} />}
      <div>
        <Link href="/admin/agenda" className="text-sm font-semibold text-ac-deep hover:underline">
          ← Agenda
        </Link>
      </div>
      {children}
    </main>
  )
}

/**
 * O saldo, RE-EXPOSTO — DADO, nunca `text-xs` nem tinta apagada.
 *
 * FUNÇÃO chamada, não componente montado (mesma razão do `escolhasOcultas`): é
 * o número que decide o gasto, e um teste que só enxerga a peça não enxerga o
 * número.
 */
function saldo({ franquia, reposicoes }: { franquia: number | null; reposicoes: number | null }) {
  if (franquia === null || reposicoes === null)
    return (
      <p className="text-sm font-medium text-ink-900">
        Não deu para ler a franquia e a reposição do aluno agora.
      </p>
    )
  return (
    <p className="text-sm font-semibold text-ink-900 tabular-nums">
      Franquia do mês: {franquia} · reposições do aluno: {reposicoes}
    </p>
  )
}

/**
 * Os ocultos das escolhas da administração, iguais nos três formulários.
 *
 * FUNÇÃO chamada, não componente montado (`{escolhasOcultas(...)}` e não
 * `<EscolhasOcultas/>`): como componente, os campos ficariam DENTRO de um
 * elemento que ainda não foi renderizado, e quem lê a árvore do formulário —
 * o navegador na hora do submit é indiferente, mas o harness da casa não — só
 * enxergaria a peça, nunca os `input`. Um teste que não vê o campo não protege
 * o campo, e estes decidem cortesia e franquia.
 */
function escolhasOcultas({
  motivo,
  cortesia,
  furar,
  escolha,
}: {
  motivo: string
  cortesia: boolean
  furar: boolean
  escolha?: string
}) {
  return (
    <>
      {cortesia && <input type="hidden" name="cortesia" value="1" />}
      {/* o motivo viaja SEMPRE (mesmo com a cortesia desligada): é ele que
          sobrevive ao erro pelo cookie, e a RPC só o recebe quando `cortesia`
          está ligada (`bookExtras`) */}
      <input type="hidden" name="motivo" value={motivo} />
      {furar && <input type="hidden" name="furar" value="1" />}
      {escolha && <input type="hidden" name="escolha" value={escolha} />}
    </>
  )
}

export default async function RemarcarAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ instance: string }>
  // `motivo` NÃO é lido daqui (grave 6): ele vem do cookie de rascunho.
  searchParams: Promise<{ cortesia?: string; furar?: string; escolha?: string }>
}) {
  const { instance } = await params
  const sp = await searchParams
  const { cortesia, furar, escolha } = sp
  const isCortesia = cortesia === '1'
  const isFurar = furar === '1'
  const rascunho = await lerRascunho(chaveDoRemarcar(instance))
  const motivo = rascunho.motivo ?? ''

  const tela: TelaDaAgenda = { tela: 'remarcar', instance }
  // O endereço canônico DESTA tela, pela MESMA função que a action usa para
  // montar o destino — é a comparação que impede o recado de repintar noutra
  // tela da seção dentro dos 15 s de vida do cookie.
  const enderecoAqui = enderecoDaTela(
    tela,
    geometriaCanonica(tela, true, (k) => sp[k as keyof typeof sp]),
  )
  const recado = await lerRecado('agenda', enderecoAqui)

  const supabase = await createClient()
  const now = DateTime.now().setZone(BUSINESS_TZ)

  const { data: inst, error: instErr } = await supabase
    .from('class_instances')
    .select(
      'id, starts_at_utc, ends_at_utc, state, teacher_id, contract_id, contracts(students!contracts_student_id_fkey(id, display_name, iana_tz), student_groups(label))',
    )
    .eq('id', instance)
    .maybeSingle()
  // A1 da onda da Agenda — o `error` era descartado e caía no `notFound()`:
  // banco fora do ar virava "esta aula não existe", que é uma afirmação sobre o
  // DADO quando o problema é a rede. 404 agora significa 404.
  if (instErr) throw new Error(`Remarcar: falha ao ler a aula: ${instErr.message}`)
  if (!inst) notFound()

  const contract = one(inst.contracts)
  const student = one(contract?.students)
  const who = student?.display_name ?? one(contract?.student_groups)?.label ?? '—'
  const start = DateTime.fromISO(inst.starts_at_utc).setZone(BUSINESS_TZ).setLocale('pt-BR')

  if (inst.state !== 'scheduled') {
    return (
      <Moldura recado={recado}>
        <CardPanel>
          <CardPanelHeader title="Remarcar aula" meta={`${who} · ${start.toFormat("dd/LL 'às' HH:mm")}`} />
          <div className="p-5">
            {/* A situação é DADO: piso literal da régua. */}
            <p className="text-sm font-medium text-ink-900">
              Esta aula não está mais agendada (situação atual: {inst.state}) — não há o que remarcar.
            </p>
          </div>
        </CardPanel>
      </Moldura>
    )
  }

  // SOL · A1 achado 11: leitura que falha NÃO vira dado vazio — ela alimenta a
  // fotografia com que a dona decide, e "nenhum horário"/"zero cortesias"
  // inventados são afirmações sobre alçada e dinheiro.
  const teacherRes = await supabase
    .from('teacher_public')
    .select('id, display_name')
    .eq('id', inst.teacher_id)
    .maybeSingle()
  if (teacherRes.error)
    throw new Error(`Remarcar: falha ao ler a professora: ${teacherRes.error.message}`)
  const teacher = teacherRes.data

  // F2/M1-6: contador de cortesias do contrato no mês civil (Cuiabá) — DERIVADO
  // do audit_log, nunca materializado. Ele NÃO sai do preview: é informação de
  // administração (quantas isenções este contrato já teve no mês), e o preview
  // responde sobre franquia e reposição.
  const cortesiasRes = await supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'reschedule_class')
    .eq('diff->>via', 'courtesy')
    .eq('diff->>contract_id', inst.contract_id)
    .gte('at', now.startOf('month').toUTC().toISO()!)
  if (cortesiasRes.error)
    throw new Error(`Remarcar: falha ao ler as cortesias do mês: ${cortesiasRes.error.message}`)
  const cortesiasNoMes = cortesiasRes.count

  // A CONSEQUÊNCIA, PERGUNTADA AO BANCO (D4). Falha de leitura não vira "sem
  // custo": a frase admite a dúvida e a decisão continua sendo da RPC.
  const preview = await previewDeRemarcacao(supabase, instance)
  const franquia = preview.dado?.franquiaRestante ?? null
  const reposicoes = preview.dado?.saldoCreditos ?? null
  const efeito = isCortesia
    ? `Remarcando agora: CORTESIA — não consome franquia nem reposição do aluno (cortesias deste contrato no mês: ${cortesiasNoMes ?? 0}).`
    : fraseDoEfeito({
        efeito: preview.dado?.efeito ?? '',
        franquiaRestante: franquia ?? 0,
        saldoCreditos: reposicoes ?? 0,
        minNoticeHours: preview.dado?.minNoticeHours ?? 0,
        validade: preview.dado?.validadeDoCredito
          ? DateTime.fromISO(preview.dado.validadeDoCredito).setLocale('pt-BR').toFormat('dd/LL/yyyy')
          : null,
      })

  // F1 (M1-5): a remarcação herda a duração REAL da aula movida — o filtro de
  // horários só oferece onde essa duração cabe.
  //
  // S5 DA VARREDURA FINAL: o filtro recebe o INTERVALO EXATO, não os minutos
  // arredondados. Uma aula de 30m20s arredondava para 30 e era oferecida num vão
  // de 30 minutos onde ela não cabe — a recusa vinha depois da confirmação, que
  // é o pior lugar para ela aparecer. O piso de 15 minutos continua, contra dado
  // torto (fim antes do começo); os minutos ficam SÓ para o texto da tela.
  const duracaoMs = Math.max(
    15 * 60_000,
    Date.parse(inst.ends_at_utc) - Date.parse(inst.starts_at_utc),
  )
  const duracaoMin = Math.round(duracaoMs / 60_000)
  // S1: o "furar antecedência" atravessa para o slot-picker. Com ele ligado a
  // RPC recebe `p_bypass_lead`, e a grade tem de mostrar o que a RPC aceitaria —
  // senão a janela publicada para amanhã some da lista e a mesma hora digitada à
  // mão passa, que é a tela desmentindo a própria oferta (regressão contra a
  // tela velha, que nunca cortou janela publicada por antecedência).
  const grade = await availableSlots(supabase, createAdminClient(), inst.teacher_id, {
    durationMs: duracaoMs,
    bypassLead: isFurar,
  })
  // S4: leitura falhada NÃO vira lista vazia — a mesma régua do achado 11 do A1,
  // agora para a grade de horários. "Nenhum horário livre" é uma afirmação sobre
  // a agenda da professora; dizer isso porque o banco não respondeu empurra a
  // dona para o caminho do horário novo, por cima de uma aula que ela não viu.
  if (grade.erro || !grade.dado)
    throw new Error('Remarcar: falha ao ler os horários livres da professora.')
  const { slots, googleDegraded } = grade.dado
  const escolhida = escolha ? slots.find((w) => w.key === escolha) : undefined

  /** O endereço desta tela com as escolhas atuais — a base dos links internos. */
  const aqui = (alvo: string | null) => {
    const p = new URLSearchParams()
    if (isCortesia) p.set('cortesia', '1')
    if (isFurar) p.set('furar', '1')
    if (alvo) p.set('escolha', alvo)
    const q = p.toString()
    return `/admin/agenda/remarcar/${instance}${q ? `?${q}` : ''}`
  }

  const dias = [
    ...new Set(
      slots.map((s) => DateTime.fromISO(s.startsAtUtc).setZone(BUSINESS_TZ).toFormat('yyyy-LL-dd')),
    ),
  ]

  /** O instante escolhido em civil de Cuiabá — o formato que a action confere. */
  const civilDaEscolhida = escolhida
    ? DateTime.fromISO(escolhida.startsAtUtc).setZone(BUSINESS_TZ)
    : null

  return (
    <Moldura recado={recado}>
      <CardPanel>
        <CardPanelHeader title="Remarcar aula" actions={<Pill tone="neutral">agendada</Pill>} />
        <div className="flex flex-col gap-2 p-5">
          <p className="text-base font-semibold text-ink-900">{who}</p>
          <p className="text-sm text-ink-600 first-letter:uppercase">
            {start.toFormat("cccc, dd 'de' LLLL 'às' HH:mm")} · {duracaoMin} min{' '}
            <span className="whitespace-nowrap">· {teacher?.display_name ?? '—'}</span>
          </p>
          {student?.iana_tz && student.iana_tz !== BUSINESS_TZ && (
            /* O horário do aluno é DADO — é o que a dona repete para ele. */
            <p className="text-sm font-medium text-ink-900">
              No relógio do aluno ({tzLabel(student.iana_tz)}):{' '}
              {fmtStudentLocal(inst.starts_at_utc, student.iana_tz)}
            </p>
          )}
          {saldo({ franquia, reposicoes })}
          <p className="text-sm font-medium text-ink-900">{efeito}</p>
        </div>
      </CardPanel>

      {/* F2 (M1-6/M2-1): opções da administração — valem para os DOIS caminhos */}
      <CardPanel>
        <CardPanelHeader
          title="Opções da administração"
          meta={`${isCortesia ? 'cortesia ✓' : 'sem cortesia'}${isFurar ? ' · furar antecedência ✓' : ''}`}
        />
        {/* Server Action, e não `method="get"` (grave 6): é ela que manda o
            MOTIVO para o cookie e deixa na URL só a geometria. */}
        <form action={aplicarOpcoesDaRemarcacaoAction} className="flex flex-wrap items-end gap-4 p-5">
          <input type="hidden" name="instance_id" value={inst.id} />
          {/* preserva o horário em revisão ao reaplicar as opções */}
          {escolha && <input type="hidden" name="escolha" value={escolha} />}
          <label className="flex min-h-9 items-center gap-2 text-sm text-ink-900">
            <input type="checkbox" name="cortesia" value="1" defaultChecked={isCortesia} />
            Cortesia (não consome franquia nem reposição)
          </label>
          <Field label="Motivo da cortesia (obrigatório)">
            <input name="motivo" defaultValue={motivo} placeholder="ex.: imprevisto nosso" className={input} />
          </Field>
          <label className="flex min-h-9 items-center gap-2 text-sm text-ink-900">
            <input type="checkbox" name="furar" value="1" defaultChecked={isFurar} />
            Furar antecedência mínima (combinado com a professora)
          </label>
          <button type="submit" className={btnA7}>
            Aplicar
          </button>
        </form>
        {/* A cortesia ligada SEM motivo é recusada pelo banco
            (`cortesia exige motivo (M1-6)`), e o motivo tem vida curta no cookie:
            se ela recarregar a tela muito depois, o campo volta vazio. Melhor
            dizer isso aqui do que deixá-la descobrir no envio. */}
        {isCortesia && !motivo && (
          <p className="px-5 pb-5 text-sm font-medium text-ink-900">
            A cortesia precisa de um motivo — escreva-o acima e toque em Aplicar. Sem ele, o sistema
            recusa a remarcação.
          </p>
        )}
      </CardPanel>

      {escolhida && civilDaEscolhida ? (
        /* PASSO DE REVISÃO: o clique no horário só ESCOLHE; franquia e reposição
           são consumidas apenas na confirmação — e a consequência aparece de
           novo, com as MESMAS palavras, ao lado do botão que gasta. */
        <CardPanel>
          <CardPanelHeader title="Confira antes de confirmar" />
          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-ink-600">
                De:{' '}
                <span className="font-medium text-ink-900 first-letter:uppercase">
                  {start.toFormat("cccc, dd/LL 'às' HH:mm")}
                </span>
              </p>
              <p className="text-sm text-ink-600">
                Para:{' '}
                <span className="font-semibold text-ink-900 first-letter:uppercase">
                  {civilDaEscolhida.setLocale('pt-BR').toFormat("cccc, dd/LL 'às' HH:mm")}
                </span>{' '}
                ({tzLabel(BUSINESS_TZ)})
              </p>
              {student?.iana_tz && student.iana_tz !== BUSINESS_TZ && (
                <p className="text-sm font-medium text-ink-900">
                  No relógio do aluno ({tzLabel(student.iana_tz)}):{' '}
                  {fmtStudentLocal(escolhida.startsAtUtc, student.iana_tz)}
                </p>
              )}
            </div>
            {saldo({ franquia, reposicoes })}
            <p className="text-sm font-medium text-ink-900">{efeito}</p>
            {/* DOIS CAMINHOS, UM BOTÃO. Janela JÁ publicada leva o id e é
                consumida por `book_reschedule_window`; horário COMPUTADO da
                agenda semanal ainda não é janela, então vai pelo caminho que
                publica e consome (`adminRescheduleNewTimeAction`) — com data e
                hora CIVIS de Cuiabá, que é o formato que a action confere
                (`exigirHoraQueExiste`, Lei 1). A conversão instante → civil
                acontece aqui, no servidor, no dia específico. */}
            {escolhida.windowId ? (
              <form action={adminBookWindowAction}>
                <input type="hidden" name="instance_id" value={inst.id} />
                <input type="hidden" name="window_id" value={escolhida.windowId} />
                {escolhasOcultas({ motivo, cortesia: isCortesia, furar: isFurar, escolha })}
                <button type="submit" className={btnInk}>
                  Confirmar remarcação
                </button>
              </form>
            ) : (
              <form action={adminRescheduleNewTimeAction}>
                <input type="hidden" name="instance_id" value={inst.id} />
                <input type="hidden" name="teacher_id" value={inst.teacher_id} />
                <input type="hidden" name="local_date" value={civilDaEscolhida.toFormat('yyyy-LL-dd')} />
                <input type="hidden" name="local_time" value={civilDaEscolhida.toFormat('HH:mm')} />
                {escolhasOcultas({ motivo, cortesia: isCortesia, furar: isFurar, escolha })}
                <button type="submit" className={btnInk}>
                  Confirmar remarcação
                </button>
              </form>
            )}
            <Link href={aqui(null)} className={`${btnPaperA7} self-start`}>
              ← escolher outro horário
            </Link>
          </div>
        </CardPanel>
      ) : (
        <CardPanel>
          <CardPanelHeader
            title="Escolha o novo horário"
            meta={`${slots.length} livre${slots.length === 1 ? '' : 's'} nas próximas 2 semanas`}
          />
          <div className="flex flex-col gap-4 p-5">
            {googleDegraded && (
              <p className="text-sm text-ink-600">
                A agenda pessoal da professora está momentaneamente indisponível — o horário é
                confirmado na reserva.
              </p>
            )}
            {slots.length === 0 ? (
              <p className="text-sm font-medium text-ink-900">
                A agenda da professora não tem nenhum horário livre desta duração nas próximas 2
                semanas. Use o horário novo abaixo — é ele que marca fora da disponibilidade dela.
              </p>
            ) : (
              dias.map((dia) => (
                <div key={dia} className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-ink-900 first-letter:uppercase">
                    {DateTime.fromISO(dia).setLocale('pt-BR').toFormat("cccc, dd 'de' LLLL")}
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {slots
                      .filter(
                        (s) =>
                          DateTime.fromISO(s.startsAtUtc).setZone(BUSINESS_TZ).toFormat('yyyy-LL-dd') ===
                          dia,
                      )
                      .map((s) => (
                        <li key={s.key}>
                          {/* AÇÃO PARECE AÇÃO: botão do kit, alvo ≥ 24px. */}
                          <Link href={aqui(s.key)} className={`${btnPaperA7} tabular-nums`}>
                            {DateTime.fromISO(s.startsAtUtc).setZone(BUSINESS_TZ).toFormat('HH:mm')}
                          </Link>
                        </li>
                      ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </CardPanel>
      )}

      <CardPanel>
        <CardPanelHeader title="Ou marcar um horário novo" />
        <form
          action={adminRescheduleNewTimeAction}
          className="flex flex-col gap-3 p-5 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4"
        >
          <input type="hidden" name="instance_id" value={inst.id} />
          <input type="hidden" name="teacher_id" value={inst.teacher_id} />
          {escolhasOcultas({ motivo, cortesia: isCortesia, furar: isFurar, escolha })}
          <Field label="Nova data" hint="até 2 semanas à frente (antecipar é permitido)">
            <DateField name="local_date" required defaultValue={rascunho.local_date} />
          </Field>
          <Field label="Hora — no fuso de Cuiabá (o seu)">
            <TimeField name="local_time" required defaultValue={rascunho.local_time} />
          </Field>
          <button type="submit" className={`${btnInk} w-full sm:w-auto`}>
            Remarcar
          </button>
        </form>
        {/* A5/L5 (Sol · rodada 2): dizia que o aluno "recebe a confirmação", e
            isso promete ENTREGA. A confirmação é REGISTRADA para envio
            (`enqueue_reschedule_confirmation` insere na outbox); o despacho pode
            ficar pendente por falta de e-mail, de número, de driver ou de rede, e
            quem vê se saiu é a tela de Mensagens (o rótulo do item na barra
            lateral para a rota `/admin/avisos`). */}
        <p className="px-5 pb-5 text-sm text-ink-600">
          Este caminho ignora a disponibilidade: use-o quando o horário foi combinado fora da agenda
          da professora. O aluno vê o horário convertido para o fuso dele automaticamente, e a
          confirmação fica registrada para envio por e-mail (e WhatsApp, quando há número no
          cadastro) — se ela saiu, você confere em Mensagens. Se algo impedir — reposição, prazo,
          conflito — nada muda e o motivo aparece no topo desta página.
        </p>
      </CardPanel>
    </Moldura>
  )
}
