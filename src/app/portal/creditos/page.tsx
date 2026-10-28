// SEUS CRÉDITOS — A REGRA RENDERIZADA (Onda do Portal · P3 · D9).
//
// Esta tela era um extrato: uma fila de linhas com "+1"/"−1" e o carimbo de
// cada movimento. O dono fotografou o resultado em 26/07 ("crédito (lançamento
// −1/+1 auditado)") e a IA sentenciou: o aluno não é auditor. Cada crédito
// agora é uma FRASE — de onde veio, até quando vale, e o que fazer com ele —,
// e a política que rege tudo isso (ADR-018) está escrita na mesma tela, em
// português de gente.
//
// PROIBIDO AQUI, e cobrado por teste: vocabulário de contabilidade e data em
// formato de máquina. O que o aluno lê é "vale até 12/09 · faltam 48 dias".
//
// De onde vêm os dados: `extratoDeCreditos` (src/lib/portal/data.ts), que
// consulta o replay do banco (Lei 2 — saldo derivado, nunca materializado). As
// frases vêm de `src/lib/portal/creditos.ts`, puras e testadas motivo a motivo.
import Link from 'next/link'

import { fmtCivilDate, fmtLocal, fmtLocalDate } from '@/lib/format'
import { extratoDeCreditos, portalStudent } from '@/lib/portal/data'
import { fraseDeContagem, fraseDeOrigem } from '@/lib/portal/creditos'
import { mostrarVazioAfirmativo } from '@/lib/portal/vazio'
import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/components/kit/empty-state'
import { AvisoDeLeitura } from '@/components/portal/AvisoDeLeitura'
import { WHATSAPP_ATENDIMENTO_URL } from '@/lib/contact'

export const metadata = { title: 'Seus créditos — Personal Teacher' }

/** Quantos dias antes do fim a validade passa a ser dita em vermelho-âmbar. */
const APERTADO_DIAS = 15

export default async function CreditosPage() {
  const supabase = await createClient()

  const [aluno, extrato] = await Promise.all([portalStudent(supabase), extratoDeCreditos(supabase)])
  // O fuso do aluno formata a HORA da aula que originou o crédito; a decisão de
  // vivo/vencido/congelado é do banco (student_credit_statement).
  const tz = aluno.dado?.ianaTz ?? 'America/Cuiaba'
  const { vivos, congelados, vencidos } = extrato.dado

  return (
    <main className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="title-page text-ink-900">Seus créditos</h1>
        <p className="text-sm text-ink-600">
          Crédito é uma aula que a escola te deve — aqui está de onde veio cada um e até quando vale.
        </p>
      </header>

      {(aluno.erro || extrato.erro) && <AvisoDeLeitura oQue="seus créditos" />}

      {mostrarVazioAfirmativo({
        erro: aluno.erro || extrato.erro,
        itens: vivos.length + congelados.length + vencidos.length,
      }) && (
        <EmptyState
          title="Você não tem crédito nenhum por aqui — e isso é boa notícia."
          hint="Crédito aparece quando a escola desmarca uma aula sua, quando a professora falta, ou quando a gente lança um ajuste no seu extrato. Enquanto isso, suas aulas seguem no lugar de sempre."
          cta="Ver suas aulas"
          href="/portal/aulas"
        />
      )}

      {/* ------------------------------------------------ créditos para usar */}
      {vivos.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="title-section text-ink-900">Para usar</h2>
          {vivos.map((c) => {
            const dias = c.diasRestantes
            const apertado = dias !== null && dias <= APERTADO_DIAS
            return (
              <article
                key={`${c.origemId}-${c.ord}`}
                className={`card-ac flex flex-col gap-3 p-5 ${
                  apertado ? '[--card-edge:transparent] [--card-state:var(--glow-warn)]' : ''
                }`}
              >
                <p className="text-sm font-medium text-ink-900">
                  {fraseDeOrigem(c.motivo, {
                    em: c.criadoEmUtc ? fmtLocalDate(c.criadoEmUtc, tz) : '—',
                    aula: c.aulaStartsAtUtc ? fmtLocal(c.aulaStartsAtUtc, tz) : null,
                    nota: c.nota,
                    autor: c.origemAutor,
                  })}
                </p>
                <p className={`text-sm font-semibold ${apertado ? 'text-warn-700' : 'text-ink-900'}`}>
                  {c.validade ? (
                    <>
                      vale até {fmtCivilDate(c.validade)} · {fraseDeContagem(dias ?? 0)}
                    </>
                  ) : (
                    'sem prazo para usar'
                  )}
                  {c.duracaoMin ? (
                    <span className="font-normal text-ink-600"> · aula de {c.duracaoMin} min</span>
                  ) : null}
                </p>
                {/* CRÉDITO SEM CONTRATO ATIVO NÃO GANHA BOTÃO. Depois do A6
                    (30/07) o crédito de contrato pausado é SEMPRE classificado
                    como congelado pelo banco, então esta seção só recebe
                    contrato não-ativo em estado anômalo (pausado sem linha de
                    pausa aberta — o mesmo que `resume_contract` recusa). Mesmo
                    aí, `/portal/resgatar` recusa contrato não-ativo: oferecer o
                    botão seria uma promessa que a rota quebra. */}
                {c.contratoStatus === 'active' ? (
                  <>
                    <Link href={`/portal/resgatar/${c.contractId}`} className="btn-ac self-start">
                      Agendar reposição
                    </Link>
                    {/* O que o botão FAZ, dito antes de ele ser apertado (revisão
                        adversarial do P3): a rota marca uma aula EXTRA, não muda o
                        dia da aula da semana. */}
                    <p className="text-sm text-ink-600">
                      Isso cria uma aula extra, num horário livre da professora. Para mudar o dia de
                      uma aula que já está marcada, use Remarcar na própria aula.
                    </p>
                  </>
                ) : (
                  /* A FRASE ANTERIOR MORREU COM A DECISÃO DO DONO (30/07, A6 ·
                     lote 3): ela dizia "a validade dele continua correndo",
                     porque o crédito nascido durante a pausa ficava mesmo de
                     fora da compensação da retomada (Sol · rodada 2 do A5).
                     Agora `resume_contract` estende TODO crédito parado, e o
                     banco classifica como congelado todo crédito de contrato
                     pausado — a frase virou falsa do dia para a noite.

                     E ESTE RAMO MUDOU DE SENTIDO junto: "não-ativo e não
                     congelado" deixou de ser o caso comum e virou a BORDA —
                     crédito sem prazo, ou contrato 'paused' SEM linha de pausa
                     aberta (o estado anômalo que `resume_contract` recusa e que
                     o extrato classifica pela régua normal). A promessa do
                     congelamento não cabe aqui: nesses casos ela seria a mesma
                     mentira, só ao contrário. O que cabe é o que é verdade nos
                     dois: não dá para marcar agora, e quem resolve é a escola.
                     A promessa de congelamento vive na seção "Em pausa", que é
                     onde o crédito congelado de fato aparece. */
                  <p className="text-sm text-ink-600">
                    Seu contrato está pausado, então ainda não dá para marcar com este crédito. Fala
                    com a gente antes: a escola confere o seu caso e combina com você a volta das
                    aulas.
                  </p>
                )}
              </article>
            )
          })}
        </section>
      )}

      {/* ------------------------------------------------ contrato em pausa */}
      {/* A PAUSA CONGELA A VALIDADE (F3-D10.2): a retomada devolve a cada
          crédito os dias parados. Antes esta tela lia o crédito de um contrato
          pausado como qualquer outro — e o mandava para "Venceram" no dia
          seguinte à data original, dando por perdido o que o banco vai
          devolver. Sem ação: /portal/resgatar recusa contrato não-ativo.

          A6 · LOTE 3 (decisão do dono, 30/07): o congelamento deixou de ter
          buraco. Antes, só o crédito nascido ANTES da pausa entrava aqui, e o
          concedido DURANTE ela caía em "Para usar" com a validade correndo —
          a frase abaixo era verdade sobre uns e mentira sobre outros. Agora
          `resume_contract` estende os dois (pelos dias parados e pelos dias
          desde a concessão, respectivamente), e a frase vale para a seção
          inteira, sem asterisco. */}
      {congelados.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="title-section text-ink-900">Em pausa</h2>
          <p className="text-sm text-ink-600">
            Seu contrato está pausado — a validade destes créditos fica congelada e volta a contar na
            retomada, com os dias parados devolvidos. Eles não vencem enquanto isso.
          </p>
          {congelados.map((c) => (
            <article key={`${c.origemId}-${c.ord}`} className="card-ac flex flex-col gap-2 bg-paper-50 p-5">
              <p className="text-sm font-medium text-ink-900">
                {fraseDeOrigem(c.motivo, {
                  em: c.criadoEmUtc ? fmtLocalDate(c.criadoEmUtc, tz) : '—',
                  aula: c.aulaStartsAtUtc ? fmtLocal(c.aulaStartsAtUtc, tz) : null,
                  nota: c.nota,
                  autor: c.origemAutor,
                })}
              </p>
              <p className="text-sm font-semibold text-ink-900">
                {c.validade ? `valia até ${fmtCivilDate(c.validade)} — contagem parada` : 'sem prazo para usar'}
                {c.duracaoMin ? (
                  <span className="font-normal text-ink-600"> · aula de {c.duracaoMin} min</span>
                ) : null}
              </p>
            </article>
          ))}
        </section>
      )}

      {/* ---------------------------------------------------- os que venceram */}
      {vencidos.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="title-section text-ink-900">Venceram</h2>
          {vencidos.map((c) => (
            <article key={`${c.origemId}-${c.ord}`} className="card-ac flex flex-col gap-2 bg-paper-50 p-5">
              <p className="text-sm font-medium text-ink-900">
                {fraseDeOrigem(c.motivo, {
                  em: c.criadoEmUtc ? fmtLocalDate(c.criadoEmUtc, tz) : '—',
                  aula: c.aulaStartsAtUtc ? fmtLocal(c.aulaStartsAtUtc, tz) : null,
                  nota: c.nota,
                  autor: c.origemAutor,
                })}
              </p>
              <p className="text-sm font-semibold text-ink-900">
                venceu em {c.validade ? fmtCivilDate(c.validade) : '—'}
              </p>
              <p className="text-sm text-ink-600">
                Ele passou da validade sem virar aula, então não dá mais para agendar com ele. Se você
                achou que ainda tinha esse crédito, fala com a gente — a escola olha caso a caso.
              </p>
            </article>
          ))}
          {/* AÇÃO PARECE AÇÃO (revisão adversarial 2 · D8): isto era um link de
              texto dentro de um parágrafo — alvo fino demais para o polegar e
              indistinguível de prosa. Como botão do kit, ele herda os 44px de
              alvo que a régua da casa exige em ponteiro grosso. */}
          {WHATSAPP_ATENDIMENTO_URL && (
            <a
              href={WHATSAPP_ATENDIMENTO_URL}
              target="_blank"
              rel="noreferrer"
              className="btn-ac-soft self-start"
            >
              Falar com a gente no WhatsApp
            </a>
          )}
        </section>
      )}

      {/* ------------------------------------------------------ como funciona */}
      {/* A POLÍTICA, em língua de aluno (ADR-018). A versão formal é a que a
          admin aplica; esta é a que a pessoa consegue ler no celular às 22h. */}
      <section className="card-ac card-ac-wash flex flex-col gap-2 p-5">
        <h2 className="title-section text-ink-900">Como funciona</h2>
        {/* A5/L5 — DUAS FRASES FALSAS MORRERAM AQUI (Sol · rodada 1 do A5, grave).
            A primeira dizia que crédito "SÓ aparece" por cancelamento da escola;
            a segunda, que a escola desmarcar gera crédito, sem exceção. As duas
            são falsas no banco, e as duas se contradiziam entre si:
            · as ORIGENS são três — cancelamento pela escola
              (`_cancel_class_core` com `p_cancelled_by='teacher'`), falta da
              professora (`_mark_no_show` com `p_who='teacher'`) e ajuste manual
              da administração (`admin_makeup_adjust`);
            · e nem toda perda vira crédito: se a aula perdida NASCEU de um
              crédito antigo sem identidade, `_refund_for_credit_born_class`
              volta sem devolver nada (`consumes_ledger_id is null`) e o acerto
              é manual.
            Vocabulário de aluno: nada de nome de função nem de coluna. */}
        <p className="text-sm text-ink-900">
          Você ganha um crédito quando a escola desmarca uma aula sua, quando a professora falta, ou
          quando a gente lança um ajuste para você.
        </p>
        <p className="text-sm text-ink-900">
          Em casos raros — quando a aula perdida já era, ela mesma, uma reposição antiga — o crédito
          não volta sozinho: a gente confere e acerta o seu extrato à mão. Se o número aqui não fizer
          sentido para você, fala com a gente.
        </p>
        {/* DUAS PERGUNTAS DIFERENTES (Sol · rodada 2 do A5): "como nascem
            créditos novos HOJE" (acima) e "o que pode aparecer no meu extrato"
            (aqui). O ledger tem mais motivos do que as origens de hoje —
            `initial_backlog` (saldo trazido de antes do portal), `refund`
            (devolução de uma reposição que não aconteceu) e o
            `earn_cancellation` HISTÓRICO, de quando o cancelamento do próprio
            aluno com aviso também creditava (anterior à ADR-018; ver
            `src/lib/portal/creditos.ts`). Lista incompleta é a mesma classe de
            "só aparece": cada linha do extrato já diz a origem dela, e esta
            frase impede que a lista de cima seja lida como a lista TOTAL. */}
        <p className="text-sm text-ink-900">
          No seu extrato também podem aparecer créditos de antes do portal, devoluções de uma
          reposição que não aconteceu e créditos antigos de aulas que você mesmo desmarcou, quando a
          regra da escola era outra. Cada linha ali diz de onde ela veio.
        </p>
        <p className="text-sm text-ink-900">
          Se quem precisa mudar o dia é você, o caminho é remarcar — isso usa as remarcações que o seu
          plano dá no mês e não gasta crédito.
        </p>
        <p className="text-sm text-ink-900">
          Cancelar de vez não vira crédito. Se aconteceu alguma coisa séria, fala com a gente que a
          escola avalia caso a caso.
        </p>
        <p className="text-sm text-ink-900">
          Cada crédito vale até a data que aparece nele; depois disso ele não vira mais aula.
        </p>
        {/* O QUE O SISTEMA REALMENTE FAZ (revisão adversarial do P3): o job
            diário (`enqueue-credit-expiry-daily`) enfileira um aviso quando o
            crédito ENTRA na janela dos 30 dias e outro quando entra na dos 15 —
            então um crédito que nasce faltando 10 dias recebe UM aviso só, e o
            WhatsApp só sai para quem deixou o número com a escola. Prometer "30
            e 15 dias antes" é prometer precisão que o sistema não tem. */}
        <p className="text-sm text-ink-900">
          Quando um crédito seu estiver chegando perto de vencer, a gente te avisa por e-mail — e
          também no WhatsApp, se a gente tiver o seu número. Mesmo assim, vale ficar de olho na data
          aqui.
        </p>
      </section>
    </main>
  )
}
