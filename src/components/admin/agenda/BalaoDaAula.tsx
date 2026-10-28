// O BALÃO DO EVENTO (Onda da Agenda · A5/L4) — o padrão medido do TutorBird.
//
// ANATOMIA (`docs/goals/mapeamento-tutorbird-2.md`): barra de ícones no alto ·
// data/hora e quem · a hora do aluno quando o fuso dele difere · abas
// Desfecho | Histórico · o CTA grande embaixo (dentro da aba do desfecho, que é
// de quem ele é).
//
// ── A BARRA TEM TRÊS ÍCONES, E NÃO QUATRO ───────────────────────────────────
// remarcar · duplicar · fechar. **"Excluir" não entra**: não existe delete de
// aula em migration nenhuma (varrido) — o destrutivo desta tela é o
// CANCELAMENTO, que mora dentro da matriz do desfecho, com a consequência
// escrita. Botão sem backend é pior que ausência: ele promete um ato que a tela
// não sabe executar, e a dona descobre isso no meio de uma decisão de dinheiro.
//
// ── O QUE MORREU ────────────────────────────────────────────────────────────
// O `PopupAula` da própria `page.tsx`: dados + um `Remarcar…` de largura cheia +
// o `<details data-popup>` "Cancelar aula…" do `pieces.tsx`, sem histórico e sem
// consequência escrita. As frases de dinheiro que ele mostrava estavam erradas
// em três pontos (medição em `@/lib/admin/desfecho-da-aula`).
//
// ── SERVIDOR, DE PROPÓSITO ──────────────────────────────────────────────────
// Este componente é Server Component: ele recebe dados já formatados da camada
// (Lei 1 — nenhuma data é formatada no cliente) e COMPÕE duas peças cliente (as
// abas e a matriz). É o mesmo padrão RSC do `calendario.tsx` com o Popover.

import Link from 'next/link'
import { DateTime } from 'luxon'
import { ArrowLeftRight, Copy, X } from 'lucide-react'

import { cobrarAvulsaAction } from '@/app/admin/agenda/actions'
import { rotuloAdminDaCobranca, situacaoDaView } from '@/lib/admin/financeiro-rotulos'

import { PopoverClose } from '@/components/kit/popover'
// Módulo PURO de propósito: `kit/popover.tsx` é 'use client', e este arquivo é
// Server Component — constante importada dali chega como REFERÊNCIA e o teto
// vira texto de erro dentro do `class` (medido no A9; ver `lib/kit/balao.ts`).
import { TETO_DO_CORPO_DO_BALAO } from '@/lib/kit/balao'
// Pill do KIT (paleta de acento do admin) e não a de `ui.tsx`: a de lá é fixa em
// `text-xs`, e a SITUAÇÃO da aula é DADO — o piso da régua da casa é
// `text-sm font-medium`. A do kit aceita `className`, e o `cn` (tailwind-merge)
// deixa o `text-sm` vencer o `text-xs` do padrão (Sol · rodada 1 do A5, médio 7).
import { Pill } from '@/components/kit/pill'
import type { AulaDaAgenda, EventoDoHistorico } from '@/data/admin/agenda'
import { AbasDaAula } from './AbasDaAula'
import { DesfechoDaAula } from './DesfechoDaAula'

const SITUACAO_PILL: Record<
  AulaDaAgenda['situacao'],
  { rotulo: string; tom: 'ok' | 'danger' | 'warn' | 'neutral' | 'muted' }
> = {
  agendada: { rotulo: 'agendada', tom: 'neutral' },
  sem_registro: { rotulo: 'sem registro', tom: 'warn' },
  realizada: { rotulo: 'realizada', tom: 'ok' },
  falta_aluno: { rotulo: 'falta do aluno', tom: 'danger' },
  falta_professora: { rotulo: 'falta da professora', tom: 'danger' },
  cancelada: { rotulo: 'cancelada', tom: 'muted' },
  remarcada: { rotulo: 'remarcada', tom: 'muted' },
}

/** Ícone da barra: alvo de 32px (acima do piso de 24 da casa) e nome acessível
 *  próprio — ícone sem `aria-label` é botão anônimo para leitor de tela. */
const ICONE = 'inline-flex h-8 w-8 items-center justify-center rounded-chip text-ink-600 transition-colors hover:bg-paper-100 hover:text-ink-900'

export function BalaoDaAula({
  a,
  back,
  backErro,
  duplicarHref,
  historico,
  digitado,
  agoraNoNegocio,
}: {
  a: AulaDaAgenda
  /** para onde a action volta no SUCESSO */
  back: string
  /** …e no ERRO: a mesma tela com ESTE balão reaberto (`?ev=`) */
  backErro: string
  /** "duplicar": abre o painel da avulsa no mesmo horário, já no contrato desta
   *  aula quando ele é legível (`contractId`) */
  duplicarHref: string
  historico: EventoDoHistorico[]
  /** o que ela digitou e voltou no cookie de rascunho depois de um erro */
  digitado: Record<string, string>
  /** AGORA no fuso do negócio, do servidor — o `max` do campo de aviso */
  agoraNoNegocio: string
}) {
  const pill = SITUACAO_PILL[a.situacao]
  return (
    // Teto de altura com rolagem PRÓPRIA (mesma razão do balão do slot): o
    // popover vive num portal de posição fixa, e a página não rola por baixo
    // dele — sem isto, a matriz de cinco linhas ficaria inalcançável no celular.
    // O teto é `70vh` MAS nunca maior que o espaço que o Radix mediu entre a
    // âncora e a borda da tela: com a aula das 03:30 o balão desenhava 664px
    // onde havia 408px, e o CTA ficava fora do monitor (A9, 30/07 — a lápide
    // longa está em `TETO_DO_CORPO_DO_BALAO`, no kit).
    <div className={`flex flex-col gap-3 text-sm ${TETO_DO_CORPO_DO_BALAO}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1">
          {/* REMARCAR SÓ NO ESTADO QUE A RPC ACEITA (Sol · rodada 1 do A5, médio
              5). `reschedule_class_at` (definição efetiva em 20260727000700) tem
              `if v_old.state <> 'scheduled' then raise`, e as duas situações que
              ainda são `scheduled` são estas — aula que não terminou e aula
              passada sem registro (a segunda remarca com o "furar antecedência"
              da própria tela de remarcar). Em aula realizada, com falta,
              cancelada ou já remarcada o ícone levava a uma tela que declara não
              haver o que remarcar: é a MESMA régua que tirou o "excluir" — botão
              que a tela não sabe executar é pior que ausência. */}
          {(a.situacao === 'agendada' || a.situacao === 'sem_registro') && (
            <Link
              href={`/admin/agenda/remarcar/${a.id}`}
              aria-label={`Remarcar a aula de ${a.quem}`}
              title="Remarcar…"
              className={ICONE}
            >
              <ArrowLeftRight aria-hidden className="h-4 w-4" />
            </Link>
          )}
          <Link
            href={duplicarHref}
            aria-label={`Criar outra aula igual a esta, de ${a.quem}`}
            title="Duplicar — abre uma aula avulsa no mesmo horário"
            className={ICONE}
          >
            <Copy aria-hidden className="h-4 w-4" />
          </Link>
          <PopoverClose aria-label="Fechar" title="Fechar" className={ICONE}>
            <X aria-hidden className="h-4 w-4" />
          </PopoverClose>
        </div>
        <Pill tone={pill.tom} className="text-sm">
          {pill.rotulo}
        </Pill>
      </div>

      {/* Nome, horário, professora, hora do aluno e confirmação de presença são
          DADO (régua do AGENTS.md): respondem à pergunta da tela e sustentam a
          decisão de remarcar ou cancelar. */}
      <div className="flex flex-col gap-0.5 leading-relaxed">
        {a.studentId ? (
          // O nome é a identidade da caixa E um destino: `inline-flex min-h-6`
          // dá a ele o piso de alvo da casa (24px) sem mudar a leitura da linha
          // (Sol · rodada 1 do A5, médio 6 — o teste tinha aberto exceção para
          // "todo link com hover:underline", o que afrouxava a régua para caber
          // o defeito; a exceção morreu junto).
          <Link
            href={`/admin/alunos/${a.studentId}`}
            className="inline-flex min-h-6 items-center self-start text-sm font-semibold text-ink-900 hover:underline"
          >
            {a.quem}
          </Link>
        ) : (
          <span className="text-sm font-semibold text-ink-900">{a.quem}</span>
        )}
        <p className="text-sm font-medium text-ink-900 first-letter:uppercase">
          {a.instante.texto} · {a.teacherNome ?? '—'}
        </p>
        {a.horaDoAluno && (
          <p className="text-sm font-medium text-ink-900">Para o aluno: {a.horaDoAluno}</p>
        )}
        {/* Os DOIS estados são DADO: o negativo é justamente o que dispara a
            cobrança de confirmação ao aluno. */}
        {a.situacao === 'agendada' && (
          <p
            className={
              a.confirmada
                ? 'text-sm font-semibold text-ok-700'
                : 'text-sm font-medium text-ink-900'
            }
          >
            {a.confirmada ? '✓ presença confirmada pelo aluno' : 'presença ainda não confirmada'}
          </p>
        )}
      </div>

      {a.avulsa && (
        <CobrancaDaAvulsa
          aulaId={a.id}
          avulsa={a.avulsa}
          situacao={a.situacao}
          studentId={a.studentId}
          back={back}
          backErro={backErro}
          digitado={digitado}
          agoraNoNegocio={agoraNoNegocio}
        />
      )}

      <AbasDaAula
        quantosNoHistorico={historico.length}
        desfecho={
          <DesfechoDaAula
            aulaId={a.id}
            situacao={a.situacao}
            temApontamento={a.temApontamento}
            back={back}
            backErro={backErro}
            digitado={digitado}
            agoraNoNegocio={agoraNoNegocio}
            // A6/lote 2: a entrega do aviso vem da MESMA linha que monta o
            // balão (o embed de `students → profiles`), não de consulta nova.
            entregabilidade={{ temLogin: a.temLogin, temWhatsapp: a.temWhatsapp }}
            pele="balao"
          />
        }
        historico={<HistoricoDaAula eventos={historico} />}
      />

      {a.studentId && (
        // AÇÃO parece ação (régua do AGENTS.md): chip com alvo de 36px, no padrão
        // do "+N mais" do mês e do "Remover" do painel de disponibilidade — era
        // link de texto puro, abaixo do piso no celular.
        <Link
          href={`/admin/alunos/${a.studentId}`}
          className="inline-flex min-h-9 items-center self-start rounded-chip px-2 text-sm font-semibold text-ac-deep hover:bg-paper-100"
        >
          Abrir ficha do aluno →
        </Link>
      )}
    </div>
  )
}

const fmtBRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * F5 (Onda Financeiro) — A COBRANÇA DA AULA EXTRA, dentro do balão.
 *
 * A ordem das vozes é a da camada de dados (`AulaDaAgenda.avulsa` — a régua é
 * do banco, a tela só desenha):
 *   espelho → a situação da régua única (`payments_admin`), a mesma voz da
 *     tela Financeiro — vence a quitação antiga (Sol F5 · P1: "✓ paga" por
 *     cima de estornada esconderia o que o Financeiro denuncia);
 *   ✓ paga → quitação sem espelho (P21 manual, de antes do religamento);
 *   aula cancelada → voz própria, SEM caminho de cobrança (Sol r2 · P1:
 *     mandar ao painel do Asaas contornaria a recusa da claim);
 *   formulário → pagador pronto E nenhuma cobrança ATIVA (espelho
 *     cancelado/apagado no Asaas permite reemissão — Sol r2 · P2);
 *   sem pagador pronto → o caminho para consertar (ficha do aluno).
 */
function CobrancaDaAvulsa({
  aulaId,
  avulsa,
  situacao,
  studentId,
  back,
  backErro,
  digitado,
  agoraNoNegocio,
}: {
  aulaId: string
  avulsa: NonNullable<AulaDaAgenda['avulsa']>
  situacao: AulaDaAgenda['situacao']
  studentId: string | null
  back: string
  backErro: string
  digitado: Record<string, string>
  agoraNoNegocio: string
}) {
  const cancelada = situacao === 'cancelada'
  const espelho = avulsa.cobranca
  const rotulo = espelho ? rotuloAdminDaCobranca(situacaoDaView(espelho.situacao)) : null
  const mostraForm =
    avulsa.pagadorPronto && !avulsa.paidAt && !cancelada && (!espelho || !espelho.cobravel)

  // Vencimento padrão: uma semana à frente, no fuso do negócio — a dona edita.
  const vencimentoPadrao =
    digitado.due_date ?? DateTime.fromISO(agoraNoNegocio).plus({ days: 7 }).toISODate() ?? ''

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-ink-900">
          Extra cobrada à parte · {fmtBRL(avulsa.priceCents)}
        </span>
        {espelho && rotulo ? (
          <>
            <p
              className={
                espelho.emAtraso
                  ? 'text-sm font-semibold text-danger-700'
                  : 'text-sm font-medium text-ink-900'
              }
            >
              Cobrança no Asaas: {rotulo.frase}
              {espelho.emAtraso && rotulo.frase !== 'vencida' ? ' (vencida)' : ''}
            </p>
            {rotulo.explicacao && <p className="text-sm text-ink-600">{rotulo.explicacao}</p>}
          </>
        ) : avulsa.paidAt ? (
          <p className="text-sm font-semibold text-ok-700">✓ paga</p>
        ) : cancelada ? (
          <p className="text-sm font-medium text-ink-900">Aula cancelada — não há o que cobrar.</p>
        ) : null}
      </div>

      {mostraForm && (
        <form action={cobrarAvulsaAction} className="flex flex-col gap-2">
          <input type="hidden" name="aula_id" value={aulaId} />
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="back_erro" value={backErro} />
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold text-ink-900">Vencimento</span>
            <input
              name="due_date"
              type="date"
              defaultValue={vencimentoPadrao}
              className="h-9 rounded-chip border border-paper-300 bg-paper-0 px-2 text-sm text-ink-900"
            />
          </label>
          <p className="text-sm text-ink-600">
            Boleto no Asaas para {avulsa.pagadorNome ?? 'o pagador do aluno'}, com o número desta
            aula como referência — o espelho entra na hora e a aula quita sozinha quando o dinheiro
            cair.
          </p>
          <button type="submit" className="btn-cta self-start">
            {espelho ? 'Emitir nova cobrança' : 'Cobrar no Asaas'} ({fmtBRL(avulsa.priceCents)})
          </button>
        </form>
      )}

      {!espelho && !avulsa.paidAt && !cancelada && !avulsa.pagadorPronto && (
        <>
          <p className="text-sm font-medium text-ink-900">
            Para cobrar pelo app, o aluno precisa de um pagador com cadastro no Asaas (vínculo
            confirmado na ficha). Até lá, a cobrança sai pelo painel do Asaas com o UUID da aula.
          </p>
          {studentId && (
            <Link
              href={`/admin/alunos/${studentId}`}
              className="inline-flex min-h-9 items-center self-start rounded-chip px-2 text-sm font-semibold text-ac-deep hover:bg-paper-100"
            >
              Conferir o pagador na ficha →
            </Link>
          )}
        </>
      )}
    </div>
  )
}

/**
 * A TRILHA DESTA AULA.
 *
 * Duas regras que o L2 já impôs na camada de dados e que aqui não podem ser
 * afrouxadas:
 *  · NENHUM NOME DE ATOR é inventado — `profiles` de terceiros não é legível
 *    pelo cliente do admin, e o `actor` da trilha é um uuid. O que se mostra é a
 *    PORTA (`pela escola` / `pelo próprio aluno, no portal` / `pelo tratamento
 *    de período`) e a hora;
 *  · o `diff` NUNCA vem cru: as frases chegam prontas, por whitelist de campo —
 *    `courtesy_note` (texto livre sobre a vida de alguém) fica fora.
 */
function HistoricoDaAula({ eventos }: { eventos: EventoDoHistorico[] }) {
  if (eventos.length === 0)
    return (
      <p className="text-sm text-ink-600">
        Nada registrado na trilha desta aula ainda — os atos aparecem aqui na hora em que acontecem.
      </p>
    )
  return (
    <ol className="flex flex-col gap-2.5">
      {eventos.map((e) => (
        <li key={e.chave} className="border-l-2 border-line pl-2.5">
          {/* o ato e a hora são DADO: é por eles que a dona reconstrói o que
              aconteceu com o dinheiro desta aula */}
          <p className="text-sm font-semibold text-ink-900">{e.titulo}</p>
          <p className="text-sm font-medium text-ink-900">
            <time dateTime={e.quandoIso}>{e.quando}</time>
            {e.porQuem && <span className="font-normal text-ink-600"> · {e.porQuem}</span>}
          </p>
          {e.detalhes.length > 0 && (
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {e.detalhes.map((d) => (
                <li key={d} className="text-sm leading-snug font-medium text-ink-900">
                  {d}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}
