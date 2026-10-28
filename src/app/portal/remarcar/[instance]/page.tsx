// REMARCAR (Onda do Portal · P4) — saldo re-exposto ANTES de escolher, grade de
// horários como SLOT-PICKER (lista clicável por dia, nunca arraste) e o efeito
// da remarcação dito com as MESMAS palavras no topo, na escolha e na
// confirmação.
//
// A régua é do banco, ponta a ponta: `preview_reschedule_effect` diz o que
// `reschedule_class_at` faria agora (franquia · crédito · sem saldo · recusa), e
// a reserva continua sendo decidida dentro de `book_reschedule_window` /
// `book_computed_slot` (Lei 3). O que morreu aqui: o `min_notice_hours`
// comparado com `diffNow()` na página, a franquia lida por uma query e o crédito
// por outra — três cópias em TypeScript de uma classificação que decide dinheiro.
//
// A ação passou pela porta NOVA (ADR-025): devolve `ResultadoDaAcao` e quem fala
// é o toast — sem `?msg=&n=` na URL.
import Link from 'next/link'
import { DateTime } from 'luxon'
import { notFound } from 'next/navigation'

import { WHATSAPP_ATENDIMENTO_URL } from '@/lib/contact'
import { fmtCivilDate, fmtLocal, tzSuffix } from '@/lib/format'
import { availableSlots } from '@/lib/portal/computed-slots'
import { aulaDoAluno, fatoDaAula, portalStudent, previewDeRemarcacao } from '@/lib/portal/data'
import {
  estadoDaAula,
  fraseDeRemarcarAgora,
  fraseDoLimite,
  limiteApertado,
  podeRemarcar,
  type EfeitoDeRemarcar,
  type PreviewDeRemarcacao,
} from '@/lib/portal/aulas'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { AvisoDeLeitura } from '@/components/portal/AvisoDeLeitura'
import { BotaoDeAcao } from '@/components/portal/BotaoDeAcao'
import { remarcarAulaAction } from '../../actions'

export const metadata = { title: 'Remarcar aula — Personal Teacher' }

/** O saldo RE-EXPOSTO antes de escolher (a IA: "saldo re-exposto antes de
 *  gastar"). É DADO — nunca `text-xs` nem tinta apagada. */
function Saldo({ p }: { p: PreviewDeRemarcacao }) {
  const remarcacoes =
    p.franquiaRestante === 1 ? '1 remarcação' : `${p.franquiaRestante} remarcações`
  const reposicoes = p.saldoCreditos === 1 ? '1 reposição' : `${p.saldoCreditos} reposições`
  return (
    <p className="text-base font-semibold text-ink-900 tabular-nums">
      Você tem {remarcacoes} neste mês · {reposicoes}
    </p>
  )
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-col gap-5">
      {/* O recado da última ação vem da MOLDURA do portal (`RecadoDoPortal`,
          no layout) — inclusive quando a remarcação joga o aluno num gate. */}
      <header>
        <Link href="/portal/aulas" className="text-sm font-semibold text-ac-deep hover:underline">
          ← Suas aulas
        </Link>
        <h1 className="mt-1 title-page text-ink-900">Remarcar aula</h1>
      </header>
      {children}
    </main>
  )
}

export default async function RemarcarPage({
  params,
  searchParams,
}: {
  params: Promise<{ instance: string }>
  searchParams: Promise<{ escolha?: string }>
}) {
  const { instance } = await params
  const { escolha } = await searchParams
  const supabase = await createClient()

  const [aluno, aula, preview] = await Promise.all([
    portalStudent(supabase),
    aulaDoAluno(supabase, instance),
    previewDeRemarcacao(supabase, instance),
  ])
  if (!aula.erro && aula.dado === null) notFound()

  const tz = aluno.dado?.ianaTz ?? 'America/Cuiaba'
  const dados = aula.dado

  if (aula.erro || preview.erro || !dados || !preview.dado) {
    return (
      <Moldura>
        <AvisoDeLeitura oQue="esta remarcação" />
      </Moldura>
    )
  }

  // Aula que JÁ saiu de 'scheduled': o estado dito como gente, sem 404 e sem
  // grade de horários que não levaria a nada.
  if (dados.estado !== 'scheduled') {
    const fato = await fatoDaAula(supabase, instance)
    const estado = estadoDaAula(fato.dado ?? { estado: dados.estado })
    return (
      <Moldura>
        <section className="card-ac flex flex-col items-center gap-4 p-8 text-center">
          <p className="text-base font-semibold text-ink-900 first-letter:uppercase">{estado.frase}</p>
          <p className="max-w-md text-sm text-ink-600">
            Confira seus horários atualizados — e se algo não estiver como você esperava, fale com a gente.
          </p>
          <Link href="/portal/aulas" className="btn-ac btn-ac-lg">
            Ver suas aulas
          </Link>
        </section>
      </Moldura>
    )
  }

  const p: PreviewDeRemarcacao = {
    efeito: preview.dado.efeito as EfeitoDeRemarcar,
    franquiaRestante: preview.dado.franquiaRestante,
    saldoCreditos: preview.dado.saldoCreditos,
    minNoticeHours: preview.dado.minNoticeHours,
    validadeFormatada: preview.dado.validadeDoCredito ? fmtCivilDate(preview.dado.validadeDoCredito) : null,
  }
  const efeito = fraseDeRemarcarAgora(p)

  // A RESPOSTA TEM PRAZO (P4 · E2). Aritmética de ÉPOCA — nenhuma data civil sai
  // daqui; quem decide a fronteira é o banco (`limite_ts`) e quem a formata é o
  // Luxon, no fuso do aluno.
  // eslint-disable-next-line react-hooks/purity
  const agoraMs = Date.now()
  const limite = limiteApertado(preview.dado.limiteTs, agoraMs)
    ? DateTime.fromISO(preview.dado.limiteTs!).setZone(tz).toFormat('HH:mm')
    : null

  // Sem caminho: a recusa é do BANCO, dita antes de qualquer escolha.
  if (!podeRemarcar(p)) {
    return (
      <Moldura>
        <section className="card-ac flex flex-col items-center gap-4 p-8 text-center">
          <p className="max-w-md text-base font-semibold text-ink-900">{efeito}</p>
          {WHATSAPP_ATENDIMENTO_URL && (
            <a href={WHATSAPP_ATENDIMENTO_URL} target="_blank" rel="noreferrer" className="btn-ac btn-ac-lg">
              Falar com a gente no WhatsApp
            </a>
          )}
          {/* AÇÃO PARECE AÇÃO (P4 · E7c): era link de texto, alvo fino demais
              para o polegar; como botão do kit herda os 44px em ponteiro grosso. */}
          <Link href={`/portal/aula/${instance}`} className="btn-ac-ghost">
            ← voltar para a aula
          </Link>
        </section>
      </Moldura>
    )
  }

  // F1 (M1-5): a remarcação herda a duração REAL da aula movida — o filtro de
  // horários só oferece onde essa duração cabe. O INTERVALO EXATO vai para o
  // filtro (S5 da varredura final: arredondar para minutos oferecia um vão onde
  // a aula não cabe); os minutos ficam só para o texto da tela.
  const duracaoMs = Math.max(
    15 * 60_000,
    Date.parse(dados.endsAtUtc) - Date.parse(dados.startsAtUtc),
  )
  const duracaoMin = Math.round(duracaoMs / 60_000)
  const grade = await availableSlots(supabase, createAdminClient(), dados.teacherId, {
    durationMs: duracaoMs,
  })
  // S4: a leitura da agenda que falha é DITA, no aviso de leitura do portal —
  // uma grade vazia inventada mandaria o aluno embora dizendo que a professora
  // não tem horário, e uma grade com o horário ocupado dentro o levaria a uma
  // reserva que o banco recusa.
  if (grade.erro || !grade.dado) {
    return (
      <Moldura>
        <AvisoDeLeitura oQue="os horários livres" />
      </Moldura>
    )
  }
  const { slots, googleDegraded } = grade.dado
  const escolhida = escolha ? slots.find((w) => w.key === escolha) : undefined

  // SLOT-PICKER: um bloco por DIA (na zona do aluno), horários como botões. É a
  // grade que a IA pediu — clicável no polegar, sem arraste, sem calendário.
  const dias = [...new Set(slots.map((s) => DateTime.fromISO(s.startsAtUtc).setZone(tz).toFormat('yyyy-LL-dd')))]

  return (
    <Moldura>
      <section className="card-ac flex flex-col gap-2 p-5">
        <span className="text-sm font-medium text-ink-600">Aula de agora</span>
        <p className="text-base font-semibold text-ink-900 first-letter:uppercase">
          {fmtLocal(dados.startsAtUtc, tz)}
        </p>
        <p className="text-sm text-ink-600">
          {dados.teacherName} · {duracaoMin} min · {tzSuffix(tz)}
        </p>
        <Saldo p={p} />
        <p className="text-sm font-medium text-ink-900">{efeito}</p>
      </section>

      {escolhida ? (
        /* Passo de revisão: o clique no horário só ESCOLHE; franquia/crédito são
           consumidos apenas na confirmação — e a consequência aparece de novo,
           com as MESMAS palavras, ao lado do botão que gasta. */
        <section className="card-ac flex flex-col gap-4 p-5">
          <h2 className="title-section text-ink-900">Confira antes de confirmar</h2>
          <div className="flex flex-col gap-1">
            <p className="text-sm text-ink-600">
              De: <span className="font-medium text-ink-900 first-letter:uppercase">{fmtLocal(dados.startsAtUtc, tz)}</span>
            </p>
            <p className="text-sm text-ink-600">
              Para:{' '}
              <span className="font-semibold text-ink-900 first-letter:uppercase">
                {fmtLocal(escolhida.startsAtUtc, tz)}
              </span>{' '}
              ({tzSuffix(tz)})
            </p>
          </div>
          <p className="text-sm font-medium text-ink-900">{efeito}</p>
          {/* O PRAZO DA RESPOSTA, ao lado do botão que a executa (P4 · E2): a
              classificação acima vale até a fronteira do aviso mínimo, e quem
              está a minutos dela merece saber antes de confirmar. */}
          {limite && <p className="text-sm font-semibold text-warn-700">{fraseDoLimite(limite)}</p>}
          <BotaoDeAcao
            acao={remarcarAulaAction}
            campos={
              escolhida.windowId
                ? { window_id: escolhida.windowId, instance_id: dados.id }
                : {
                    // F5: horário computado — o banco materializa a janela e
                    // consome na MESMA transação.
                    teacher_id: dados.teacherId,
                    starts_at_utc: escolhida.startsAtUtc,
                    instance_id: dados.id,
                    ...(googleDegraded ? { google_degraded: '1' } : {}),
                  }
            }
            rotulo="Confirmar remarcação"
            rotuloEnviando="Confirmando…"
          />
          {/* AÇÃO PARECE AÇÃO (P4 · E7c): botão do kit, com os 44px de alvo. */}
          <Link href={`/portal/remarcar/${dados.id}`} className="btn-ac-ghost self-center">
            ← escolher outro horário
          </Link>
        </section>
      ) : slots.length === 0 ? (
        <section className="card-ac flex flex-col items-center gap-4 p-8 text-center">
          <p className="max-w-md text-base font-semibold text-ink-900">
            Sua professora ainda não tem horários livres depois dessa aula nas próximas 2 semanas.
          </p>
          {WHATSAPP_ATENDIMENTO_URL && (
            <a href={WHATSAPP_ATENDIMENTO_URL} target="_blank" rel="noreferrer" className="btn-ac btn-ac-lg">
              Falar com a gente no WhatsApp
            </a>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="title-section text-ink-900">Escolha o novo horário</h2>
          {googleDegraded && (
            <p className="text-sm text-ink-600">
              A agenda pessoal da professora está momentaneamente indisponível — o horário é confirmado na
              reserva.
            </p>
          )}
          {dias.map((dia) => (
            <div key={dia} className="card-ac flex flex-col gap-3 p-4">
              <p className="text-sm font-medium text-ink-900 first-letter:uppercase">
                {DateTime.fromISO(dia).setLocale('pt-BR').toFormat("cccc, dd 'de' LLLL")}
              </p>
              <ul className="flex flex-wrap gap-2">
                {slots
                  .filter((s) => DateTime.fromISO(s.startsAtUtc).setZone(tz).toFormat('yyyy-LL-dd') === dia)
                  .map((s) => (
                    <li key={s.key}>
                      <Link
                        href={`/portal/remarcar/${dados.id}?escolha=${encodeURIComponent(s.key)}`}
                        className="btn-ac-soft btn-ac-lg tabular-nums"
                      >
                        {DateTime.fromISO(s.startsAtUtc).setZone(tz).toFormat('HH:mm')}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          {/* AÇÃO PARECE AÇÃO (P4 · E7c): o link estava dentro do parágrafo,
              indistinguível de prosa e fino demais para o polegar. */}
          {WHATSAPP_ATENDIMENTO_URL && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-ink-600">Nenhum horário serve?</p>
              <a
                href={WHATSAPP_ATENDIMENTO_URL}
                target="_blank"
                rel="noreferrer"
                className="btn-ac-soft"
              >
                Falar com a gente
              </a>
            </div>
          )}
        </section>
      )}
    </Moldura>
  )
}
