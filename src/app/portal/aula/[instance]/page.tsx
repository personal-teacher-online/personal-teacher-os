// A AULA COMO LUGAR (Onda do Portal · P4 — N3 da IA).
//
// Dados (dia e hora no fuso do aluno · professora · duração), o MESMO botão de
// entrar do Início (D1, com contagem viva) e as duas ações — cada uma com a
// CONSEQUÊNCIA de fazê-la agora escrita ao lado (D4, contra o padrão Preply de
// esconder o controle).
//
// A consequência não é calculada aqui. `preview_reschedule_effect` e
// `preview_cancel_effect` (migration 20260728000600) devolvem a classificação
// que `reschedule_class_at` e o miolo da matriz D2 aplicariam se a pessoa
// confirmasse agora — a tela só escolhe as palavras (Lei 3).
//
// Aula que já passou (ou saiu de 'scheduled'): estado em linguagem de gente e
// NENHUMA ação. Prometer botão que o banco recusaria é o oposto do que esta
// tela existe para fazer.
import Link from 'next/link'
import { DateTime } from 'luxon'
import { notFound } from 'next/navigation'

import { fmtCivilDate, tzSuffix } from '@/lib/format'
import {
  aulaDoAluno,
  fatoDaAula,
  portalStudent,
  previewDeCancelamento,
  previewDeRemarcacao,
} from '@/lib/portal/data'
import {
  estadoDaAula,
  fraseDeCancelarAgora,
  fraseDeRemarcarAgora,
  podeCancelar,
  podeRemarcar,
  type EfeitoDeCancelar,
  type EfeitoDeRemarcar,
} from '@/lib/portal/aulas'
import { createClient } from '@/lib/supabase/server'
import { AvisoDeLeitura } from '@/components/portal/AvisoDeLeitura'
import { BotaoDeAcao } from '@/components/portal/BotaoDeAcao'
import { BotaoEntrar } from '@/components/portal/BotaoEntrar'
import { Pill } from '@/components/kit/pill'
import { WHATSAPP_ATENDIMENTO_URL } from '@/lib/contact'
import { confirmarMinhaPresencaAction } from '../../actions'

export const metadata = { title: 'Sua aula — Personal Teacher' }

export default async function AulaPage({ params }: { params: Promise<{ instance: string }> }) {
  const { instance } = await params
  const supabase = await createClient()

  const [aluno, aula, fato, remarcar, cancelar] = await Promise.all([
    portalStudent(supabase),
    aulaDoAluno(supabase, instance),
    fatoDaAula(supabase, instance),
    previewDeRemarcacao(supabase, instance),
    previewDeCancelamento(supabase, instance),
  ])

  // RLS: aula alheia (ou inexistente) chega como "não encontrei" — 404. Falha de
  // LEITURA é outra coisa e não pode virar 404: quem tem aula em uma hora não
  // pode ser informado de que ela não existe por causa de um timeout.
  if (!aula.erro && aula.dado === null) notFound()

  const tz = aluno.dado?.ianaTz ?? 'America/Cuiaba'
  const dados = aula.dado
  const agendada = dados?.estado === 'scheduled'
  const quando = dados ? DateTime.fromISO(dados.startsAtUtc).setZone(tz).setLocale('pt-BR') : null
  const duracaoMin = dados
    ? Math.round((Date.parse(dados.endsAtUtc) - Date.parse(dados.startsAtUtc)) / 60_000)
    : 0
  // Aritmética de ÉPOCA para o botão de entrar (Lei 1: nenhuma data civil sai
  // daqui — quem decide dia civil e regra é o banco).
  // eslint-disable-next-line react-hooks/purity
  const agoraMs = Date.now()

  const previewRemarcar = remarcar.dado
    ? {
        efeito: remarcar.dado.efeito as EfeitoDeRemarcar,
        franquiaRestante: remarcar.dado.franquiaRestante,
        saldoCreditos: remarcar.dado.saldoCreditos,
        minNoticeHours: remarcar.dado.minNoticeHours,
        validadeFormatada: remarcar.dado.validadeDoCredito
          ? fmtCivilDate(remarcar.dado.validadeDoCredito)
          : null,
      }
    : null
  const previewCancelar = cancelar.dado
    ? { ...cancelar.dado, efeito: cancelar.dado.efeito as EfeitoDeCancelar }
    : null

  return (
    <main className="flex flex-col gap-5">
      {/* O recado da última ação (toast com JavaScript, faixa `<noscript>` sem
          ele) vem da MOLDURA do portal — `RecadoDoPortal`, no layout. */}
      <header>
        <Link href="/portal/aulas" className="text-sm font-semibold text-ac-deep hover:underline">
          ← Suas aulas
        </Link>
        <h1 className="mt-1 title-page text-ink-900">Sua aula</h1>
      </header>

      {aula.erro && <AvisoDeLeitura oQue="esta aula" />}

      {dados && quando && (
        <section className="card-ac flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="title-section text-ink-900 first-letter:uppercase">
              {quando.toFormat('cccc, dd/LL')} · {quando.toFormat('HH:mm')}
            </p>
            {agendada ? (
              dados.confirmadaEm ? (
                <Pill tone="ok">presença confirmada</Pill>
              ) : (
                <Pill tone="neutral">agendada</Pill>
              )
            ) : (
              // O mesmo fato da lista, com as mesmas palavras (o banco explica;
              // a tela traduz).
              <Pill tone={estadoDaAula(fato.dado ?? { estado: dados.estado }).tom}>
                {estadoDaAula(fato.dado ?? { estado: dados.estado }).frase}
              </Pill>
            )}
          </div>
          <p className="text-sm font-medium text-ink-900">
            {dados.teacherName}
            <span className="font-normal text-ink-600">
              {' '}
              · {duracaoMin} min · {tzSuffix(tz)}
            </span>
          </p>

          {agendada &&
            (dados.meetUrl ? (
              <BotaoEntrar
                startsAtEpochMs={Date.parse(dados.startsAtUtc)}
                endsAtEpochMs={Date.parse(dados.endsAtUtc)}
                agoraNoServidorMs={agoraMs}
                horaDoComeco={quando.toFormat('HH:mm')}
                meetUrl={dados.meetUrl}
              />
            ) : (
              <p className="text-sm text-ink-600">
                O link da sala ainda não está publicado — ele aparece aqui antes da aula.
              </p>
            ))}

          {agendada && !dados.confirmadaEm && (
            <BotaoDeAcao
              acao={confirmarMinhaPresencaAction}
              campos={{ instance_id: dados.id }}
              rotulo="Confirmar presença"
              rotuloEnviando="Confirmando…"
              className="btn-ac-soft btn-ac-lg w-full"
            />
          )}

          {!agendada && (
            <p className="text-sm text-ink-600">
              Essa aula não está mais agendada — por isso ela não tem ações por aqui. Qualquer dúvida,
              fale com a gente.
            </p>
          )}
        </section>
      )}

      {/* ------------------------------------------------- as duas ações (D4) */}
      {agendada && (
        <section className="flex flex-col gap-3">
          <h2 className="title-section text-ink-900">Precisa mudar alguma coisa?</h2>

          {(remarcar.erro || cancelar.erro) && <AvisoDeLeitura oQue="o efeito de remarcar ou cancelar" />}

          {previewRemarcar && (
            <div className="card-ac flex flex-col gap-3 p-5">
              <p className="text-base font-semibold text-ink-900">Remarcar</p>
              <p className="text-sm font-medium text-ink-900">{fraseDeRemarcarAgora(previewRemarcar)}</p>
              {podeRemarcar(previewRemarcar) && (
                <Link href={`/portal/remarcar/${instance}`} className="btn-ac btn-ac-lg self-start">
                  Escolher outro horário
                </Link>
              )}
            </div>
          )}

          {previewCancelar && (
            <div className="card-ac flex flex-col gap-3 p-5">
              <p className="text-base font-semibold text-ink-900">Cancelar</p>
              <p className="text-sm font-medium text-ink-900">{fraseDeCancelarAgora(previewCancelar)}</p>
              {podeCancelar(previewCancelar) && (
                <Link href={`/portal/cancelar/${instance}`} className="btn-ac-soft btn-ac-lg self-start">
                  Cancelar esta aula
                </Link>
              )}
            </div>
          )}
        </section>
      )}

      {WHATSAPP_ATENDIMENTO_URL && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-ink-600">Imprevisto sério? A escola avalia caso a caso.</p>
          <a href={WHATSAPP_ATENDIMENTO_URL} target="_blank" rel="noreferrer" className="btn-ac-soft">
            Falar com a gente no WhatsApp
          </a>
        </div>
      )}
    </main>
  )
}
