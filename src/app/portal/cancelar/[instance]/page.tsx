// CANCELAR (Onda do Portal · P4) — a consequência EXATA na tela, antes do
// clique (D4), e uma confirmação explícita.
//
// Quem diz o que acontece é `preview_cancel_effect` (migration 20260728000600),
// que lê a matriz D2 com as duas constantes do portal (`cancelled_by =
// 'student'`, aviso = agora). Desde o ADR-018 o cancelamento pelo aluno não gera
// crédito em antecedência nenhuma — mas isso agora é uma RESPOSTA do banco, e
// não uma frase de memória na página: se a matriz mudar, a tela muda junto.
//
// "Quer só mudar o horário?" só aparece quando remarcar REALMENTE funcionaria —
// o preview da remarcação é consultado para isso. Oferecer um caminho que o
// banco recusaria é promessa quebrada em cima de uma decisão delicada.
//
// A ação passou pela porta NOVA (ADR-025): `ResultadoDaAcao` + toast.
import Link from 'next/link'
import { DateTime } from 'luxon'
import { notFound } from 'next/navigation'

import { fmtLocal, tzSuffix } from '@/lib/format'
import { WHATSAPP_ATENDIMENTO_URL } from '@/lib/contact'
import { aulaDoAluno, fatoDaAula, portalStudent, previewDeCancelamento, previewDeRemarcacao } from '@/lib/portal/data'
import {
  estadoDaAula,
  fraseDeCancelarAgora,
  fraseDoLimite,
  limiteApertado,
  podeCancelar,
  podeRemarcar,
  type EfeitoDeCancelar,
  type EfeitoDeRemarcar,
} from '@/lib/portal/aulas'
import { createClient } from '@/lib/supabase/server'
import { AvisoDeLeitura } from '@/components/portal/AvisoDeLeitura'
import { BotaoDeAcao } from '@/components/portal/BotaoDeAcao'
import { cancelarMinhaAulaAction } from '../../actions'

export const metadata = { title: 'Cancelar aula — Personal Teacher Academy' }

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-col gap-5">
      {/* O recado da última ação — a recusa do cancelamento inclusive — é
          pintado pela MOLDURA do portal (`RecadoDoPortal`, no layout), e não
          mais por esta tela. */}
      <header>
        <Link href="/portal/aulas" className="text-sm font-semibold text-ac-deep hover:underline">
          ← Suas aulas
        </Link>
        <h1 className="mt-1 title-page text-ink-900">Cancelar aula</h1>
      </header>
      {children}
    </main>
  )
}

export default async function CancelarPage({ params }: { params: Promise<{ instance: string }> }) {
  const { instance } = await params
  const supabase = await createClient()

  const [aluno, aula, cancelar, remarcar] = await Promise.all([
    portalStudent(supabase),
    aulaDoAluno(supabase, instance),
    previewDeCancelamento(supabase, instance),
    previewDeRemarcacao(supabase, instance),
  ])
  if (!aula.erro && aula.dado === null) notFound()

  const tz = aluno.dado?.ianaTz ?? 'America/Cuiaba'
  const dados = aula.dado

  if (aula.erro || cancelar.erro || !dados || !cancelar.dado) {
    return (
      <Moldura>
        <AvisoDeLeitura oQue="esta aula" />
      </Moldura>
    )
  }

  if (dados.estado !== 'scheduled') {
    const fato = await fatoDaAula(supabase, instance)
    const estado = estadoDaAula(fato.dado ?? { estado: dados.estado })
    return (
      <Moldura>
        <section className="card-ac flex flex-col items-center gap-4 p-8 text-center">
          <p className="text-base font-semibold text-ink-900 first-letter:uppercase">{estado.frase}</p>
          <Link href="/portal/aulas" className="btn-ac btn-ac-lg">
            Ver suas aulas
          </Link>
        </section>
      </Moldura>
    )
  }

  const p = { ...cancelar.dado, efeito: cancelar.dado.efeito as EfeitoDeCancelar }
  const remarcarSeria = remarcar.dado
    ? podeRemarcar({ efeito: remarcar.dado.efeito as EfeitoDeRemarcar })
    : false

  // A RESPOSTA TEM PRAZO (P4 · E2): a próxima fronteira que muda o desfecho —
  // o aviso mínimo enquanto ele existe, o começo da aula depois dele. Conta de
  // ÉPOCA aqui; a HORA sai formatada no fuso do aluno.
  // eslint-disable-next-line react-hooks/purity
  const agoraMs = Date.now()
  const limite = limiteApertado(cancelar.dado.limiteTs, agoraMs)
    ? DateTime.fromISO(cancelar.dado.limiteTs!).setZone(tz).toFormat('HH:mm')
    : null

  return (
    <Moldura>
      <section className="card-ac flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink-600">Aula que você quer cancelar</span>
          <p className="text-base font-semibold text-ink-900 first-letter:uppercase">
            {fmtLocal(dados.startsAtUtc, tz)}
          </p>
          <p className="text-sm text-ink-600">
            {dados.teacherName} · {tzSuffix(tz)}
          </p>
        </div>

        {/* A CONSEQUÊNCIA, dita pelo banco, antes do botão que a executa. */}
        <p className="rounded-card bg-warn-wash p-4 text-sm font-medium text-warn-700">
          {fraseDeCancelarAgora(p)}
        </p>

        {/* …e o PRAZO dela (P4 · E2): esta consequência foi classificada agora e
            muda na fronteira que o banco devolveu. */}
        {limite && <p className="text-sm font-semibold text-warn-700">{fraseDoLimite(limite)}</p>}

        {remarcarSeria && (
          <div className="flex flex-col gap-3 rounded-card bg-ac-wash p-4">
            <p className="text-base font-semibold text-ink-900">Quer só mudar o horário?</p>
            <p className="text-sm text-ink-900">Remarcar mantém a sua aula em outro dia.</p>
            <Link href={`/portal/remarcar/${dados.id}`} className="btn-ac btn-ac-lg self-start">
              Remarcar esta aula
            </Link>
          </div>
        )}

        {podeCancelar(p) && (
          <BotaoDeAcao
            acao={cancelarMinhaAulaAction}
            campos={{ instance_id: dados.id }}
            rotulo="Cancelar mesmo assim"
            rotuloEnviando="Cancelando…"
            className="btn-ac-soft btn-ac-lg w-full text-danger-700"
          />
        )}

        {/* AÇÃO PARECE AÇÃO (P4 · E7c): as duas saídas desta tela eram links de
            texto — alvo fino no polegar, numa tela onde uma delas é a forma de
            DESISTIR do cancelamento. Como botões do kit, herdam os 44px. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3">
          <Link href={`/portal/aula/${dados.id}`} className="btn-ac-ghost">
            ← mudei de ideia
          </Link>
          {WHATSAPP_ATENDIMENTO_URL && (
            <a
              href={WHATSAPP_ATENDIMENTO_URL}
              target="_blank"
              rel="noreferrer"
              className="btn-ac-soft"
            >
              Falar com a gente
            </a>
          )}
        </div>
      </section>

      <p className="text-center text-sm text-ink-600">
        Imprevisto sério (saúde, emergência)? Fale com o atendimento — a escola avalia caso a caso.
      </p>
    </Moldura>
  )
}
