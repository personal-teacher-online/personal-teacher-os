import type { RegraPorRodada, ResumoPorRodadas } from '@/lib/content/metricas'

// O PAINEL "COMO A PAUTA ANDA" — o funil do RADAR, por rodada (Estúdio v2,
// Leva 6.1 / ADR-036). A régua do M6 media o portão 1, que morreu no cutover;
// esta mede o que existe: quanto da varredura virou roteiro (conversão), o
// PORTÃO 2 e a reescrita — rodada a rodada de varredura.
//
// Server-safe por decisão (sem action, sem hook): dá para renderizar em teste
// e provar o que o screenshot não prova — os TRÊS estados do veredito.
//
// ── A REGRA DE OURO DESTA TELA ──────────────────────────────────────────────
// Número honesto vale mais que número lisonjeiro (lição do A5). Por isso:
//  · a régua só fala das rodadas FECHADAS — e diz quantas há;
//  · o denominador de cada taxa é dito em palavras, embaixo do número;
//  · a reescrita se apresenta como PROXY LEXICAL, não como nota de qualidade;
//  · a conversão aparece com número, mas SEM veredito: ela não tem limiar
//    combinado, e cravar um agora — depois de ver os primeiros números — seria
//    o retro-ajuste que a régua proíbe.

function pct(n: number): string {
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function Numero({ rotulo, valor, base }: { rotulo: string; valor: string; base: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line-soft bg-paper-0 p-4">
      <span className="text-[11px] font-bold tracking-wide text-ink-400 uppercase">{rotulo}</span>
      <span className="font-display text-4xl font-extralight text-ink-900">{valor}</span>
      <span className="text-sm text-ink-600">{base}</span>
    </div>
  )
}

export function MetricasPainel({
  resumo,
  regra,
}: {
  resumo: ResumoPorRodadas
  regra: RegraPorRodada
}) {
  if (resumo.rodadas.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-600">
          Nenhuma varredura mediu nada ainda. Assim que a pesquisa rodar, as trends aparecem no{' '}
          <span className="font-semibold text-ink-900">Radar</span> — e cada semana de varredura
          vira uma RODADA aqui.
        </p>
        <Regua regra={regra} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-600">
        O que cada VARREDURA rendeu: as trends que ela trouxe, quantas viraram roteiro e como
        esses roteiros passaram no portão 2. Roteiro avulso — o que você mesma escreveu, sem
        trend — não entra na conta: ele não mede a esteira.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-bold tracking-wide text-ink-400 uppercase">
              {/* A situação mora DENTRO da coluna da rodada: no celular a
                  tabela rola na horizontal, e "fechada/aberta" na última coluna
                  ficava fora da tela — justo o que se lê primeiro. */}
              <th className="py-2 pr-3">Rodada</th>
              <th className="py-2 pr-3">Trends</th>
              <th className="py-2 pr-3">Radar→roteiro</th>
              <th className="py-2 pr-3">Portão 2</th>
              <th className="py-2">Reescrita pesada</th>
            </tr>
          </thead>
          <tbody>
            {resumo.rodadas.map((r) => (
              <tr key={r.rotulo} className="border-b border-line-soft">
                <td className="py-2 pr-3 align-top whitespace-nowrap">
                  <span className="block font-medium text-ink-900 tabular-nums">{r.rotulo}</span>
                  <span
                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                      r.fechada ? 'bg-ok-wash text-ok-700' : 'bg-paper-100 text-ink-600'
                    }`}
                  >
                    {r.fechada ? 'fechada' : 'aberta'}
                  </span>
                  {!r.fechada && (
                    <span className="block text-xs text-ink-400">
                      {r.pendentes > 0
                        ? `${r.pendentes} roteiro${r.pendentes > 1 ? 's' : ''} sem decisão`
                        : 'aguardando a próxima varredura'}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 align-top font-medium text-ink-900 tabular-nums">
                  {r.trends}
                  {r.naoDecididas > 0 && (
                    <span className="block text-xs font-normal text-ink-400">
                      {r.naoDecididas} sem decisão
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 align-top font-medium text-ink-900 tabular-nums">
                  {r.decididas === 0 ? '—' : `${r.roteirizadas} de ${r.decididas} decididas`}
                </td>
                <td className="py-2 pr-3 align-top font-medium text-ink-900 tabular-nums">
                  {r.aprovadosP2 + r.recusadosP2 === 0
                    ? '—'
                    : `${r.aprovadosP2} de ${r.aprovadosP2 + r.recusadosP2} aprovados`}
                </td>
                <td className="py-2 align-top font-medium text-ink-900 tabular-nums">
                  {r.comOriginalAprovado === 0 ? '—' : `${r.reescritasPesadas} de ${r.comOriginalAprovado}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Numero
          rotulo="Radar→roteiro (rodadas fechadas)"
          valor={resumo.taxaConversao === null ? '—' : pct(resumo.taxaConversao)}
          base={
            resumo.decididasNoRadar === 0
              ? 'nenhuma trend decidida em rodada fechada ainda'
              : `${resumo.roteirizadas} viraram roteiro de ${resumo.decididasNoRadar} decididas`
          }
        />
        <Numero
          rotulo="Aprovação no portão 2 (rodadas fechadas)"
          valor={resumo.taxaAprovacaoP2 === null ? '—' : pct(resumo.taxaAprovacaoP2)}
          base={
            resumo.decididosP2 === 0
              ? 'nenhum roteiro decidido em rodada fechada ainda'
              : `${resumo.aprovadosP2} aprovados de ${resumo.decididosP2} decididos`
          }
        />
        <Numero
          rotulo="Reescrita pesada (rodadas fechadas)"
          valor={resumo.taxaReescritaPesada === null ? '—' : pct(resumo.taxaReescritaPesada)}
          base={
            resumo.comOriginalAprovado === 0
              ? 'nenhum roteiro aprovado com original ainda'
              : `${resumo.reescritasPesadas} de ${resumo.comOriginalAprovado} roteiros aprovados`
          }
        />
      </div>

      <p className="text-sm text-ink-400">
        A conversão é INSUMO, não nota: não existe limiar combinado para ela, e o veredito
        abaixo não a usa. Trend que você pulou sem decidir fica fora da conta — só as decididas
        entram.
      </p>

      <div
        className={`rounded-card border p-4 text-sm ${
          resumo.veredito === 'escala'
            ? 'border-ok-700/30 bg-ok-wash text-ink-900'
            : resumo.veredito === 'congela'
              ? 'border-warn-700/30 bg-warn-wash text-ink-900'
              : 'border-line bg-paper-100 text-ink-600'
        }`}
      >
        {resumo.veredito === null ? (
          <>
            <span className="font-semibold text-ink-900">Ainda sem veredito.</span> A régua só
            fala com {regra.minimoRodadasFechadas} rodadas FECHADAS e roteiro decidido no portão 2
            — há {resumo.rodadasFechadas} fechada{resumo.rodadasFechadas === 1 ? '' : 's'} e{' '}
            {resumo.decididosP2} decidido{resumo.decididosP2 === 1 ? '' : 's'}. Os números acima já
            contam a história, mas sem julgamento.
          </>
        ) : resumo.veredito === 'escala' ? (
          <>
            <span className="font-semibold">A esteira está entregando.</span> Aprovação no portão
            2 acima de {regra.aprovacaoMinima}% e reescrita abaixo de {regra.reescritaMaxima}% nas
            rodadas fechadas: dá para pedir mais por varredura.
          </>
        ) : (
          <>
            <span className="font-semibold">Segura o volume.</span> Um dos dois critérios não
            passou nas rodadas fechadas — antes de pedir mais, vale ajustar o prompt ou a direção
            e medir a próxima rodada.
          </>
        )}
      </div>

      <Regua regra={regra} />
    </div>
  )
}

function Regua({ regra }: { regra: RegraPorRodada }) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line-soft bg-paper-100 p-4">
      <span className="text-[11px] font-bold tracking-wide text-ink-400 uppercase">
        A régua combinada antes dos números
      </span>
      <ul className="flex flex-col gap-1 text-sm text-ink-600">
        <li>
          Escala quando aprovação no portão 2 ≥ {regra.aprovacaoMinima}% E reescrita pesada ≤{' '}
          {regra.reescritaMaxima}%.
        </li>
        <li>Reescrita pesada = mais de {regra.reescritaPesadaAcimaDe}% do texto trocado.</li>
        <li>
          Veredito só com {regra.minimoRodadasFechadas} rodadas de varredura FECHADAS — nunca por
          volume absoluto. Fechada = a varredura seguinte já rodou e nenhum roteiro daquela
          rodada ficou sem decisão.
        </li>
      </ul>
      <p className="text-sm text-ink-400">
        &quot;Texto trocado&quot; é uma medida de PALAVRA, não de qualidade: trocar uma frase por
        outra melhor conta igual. Serve para enxergar tendência, não para julgar um roteiro.
      </p>
    </div>
  )
}
