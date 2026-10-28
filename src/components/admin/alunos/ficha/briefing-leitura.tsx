// O BRIEFING COMO GENTE LÊ (sub-lote 3 da onda do Portal).
//
// Até aqui a ficha despejava o jsonb cru dentro de um `<details>`: rótulo era a
// chave técnica (`facil_dificil`, `topicos_profissionais`), lista de múltipla
// escolha virava `[object Object]`/`JSON.stringify`, e a grade de rotina — a
// resposta mais útil que existe para montar horário — saía como um bloco de
// JSON. Aqui cada resposta aparece com a PERGUNTA por extenso, vinda do
// dicionário na versão da própria linha (v1 e v2 no mesmo caminho).
//
// Este arquivo é presentation pura: recebe a ficha pronta, não importa server
// action nenhuma e por isso É RENDERIZÁVEL no Vitest (`abas.tsx` não é — ela
// importa as actions, que puxam `server-only`).
import type { ReactNode } from 'react'

import type { AtualizacaoEnviada, BriefingNaFicha, RevisaoDoBriefing } from '@/data/admin/ficha'
import {
  SECOES_DE_RESPOSTA,
  ehObjeto,
  gradeDaRotina,
  paresDaSecao,
  textoDaResposta,
} from '@/lib/briefing/leitura'
import { entradaDaChave, type VersaoBriefing } from '@/lib/briefing/schema'
import { Pares } from './pecas'

/** Chave que o dicionário não conhece (dado legado ou inesperado): ela aparece
 *  como está, com cara de código — esconder resposta de aluno não é opção. */
function ChaveCrua({ chave }: { chave: string }) {
  return (
    <code className="rounded-input bg-paper-100 px-1.5 py-0.5 font-mono text-xs text-ink-600">
      {chave}
    </code>
  )
}

function GradeDeRotina({ valor }: { valor: unknown }) {
  const grade = gradeDaRotina(valor)
  if (!grade) return <span className="text-sm text-ink-600">—</span>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-separate border-spacing-0 text-center text-xs">
        <thead>
          <tr>
            <th className="p-1 text-left font-semibold text-ink-600"> </th>
            {grade.dias.map((d) => (
              <th key={d} className="p-1 font-semibold tracking-wide text-ink-600 uppercase">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grade.linhas.map((l) => (
            <tr key={l.bloco}>
              <td className="p-1 text-left text-sm whitespace-nowrap text-ink-600">{l.bloco}</td>
              {l.marcado.map((m, i) => (
                <td key={grade.dias[i]} className="p-1 text-sm text-ink-900">
                  {m ? <span aria-label={`${l.bloco} de ${grade.dias[i]}`}>✓</span> : <span aria-hidden>·</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BlocoDaSecao({
  titulo,
  secao,
  versao,
}: {
  titulo: ReactNode
  secao: Record<string, unknown>
  versao: VersaoBriefing
}) {
  const pares = paresDaSecao(secao, versao)
  if (pares.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-sm font-semibold text-ink-900">{titulo}</h4>
      <Pares
        itens={pares.map((p) => ({
          rotulo: p.enunciado ?? p.chave,
          rotuloNode: p.enunciado ?? <ChaveCrua chave={p.chave} />,
          // A rotina é GRADE, não frase: dias × blocos, como na coleta.
          valor:
            p.chave === 'blocos' && ehObjeto(p.valor) ? <GradeDeRotina valor={p.valor} /> : p.texto,
          largo: true,
        }))}
      />
    </div>
  )
}

/**
 * Todas as respostas, seção a seção, na ordem em que o aluno respondeu. Seção
 * que o dicionário não conhece (dado de outra época) entra no fim, com o nome
 * cru — a régua é a mesma das chaves: nada some da ficha.
 */
export function RespostasDoBriefing({ briefing }: { briefing: BriefingNaFicha }) {
  const respostas = briefing.respostas ?? {}
  const conhecidas = SECOES_DE_RESPOSTA.map((s) => s.secao) as string[]
  const extras = Object.keys(respostas).filter((s) => !conhecidas.includes(s))
  // O aviso de uma linha (achado 6 da revisão de integração): quem lê "quer
  // inglês para trabalho" aqui precisa saber que o plano do semestre foi montado
  // sobre OUTRA resposta. O número é o do semestre mais recente atualizado.
  const ultima = briefing.atualizacoes[0] ?? null

  return (
    <div className="mt-2 flex flex-col gap-5">
      {ultima && (
        <p className="text-sm leading-relaxed text-warn-700">
          Objetivos e interesses têm atualização do semestre {ultima.semestre} — o plano usa o
          efetivo. As respostas abaixo são as do briefing original.
        </p>
      )}
      {SECOES_DE_RESPOSTA.map((s) => (
        <BlocoDaSecao
          key={s.secao}
          titulo={s.titulo}
          secao={ehObjeto(respostas[s.secao]) ? (respostas[s.secao] as Record<string, unknown>) : {}}
          versao={briefing.versao}
        />
      ))}
      {extras.map((s) => (
        <BlocoDaSecao
          key={s}
          titulo={<ChaveCrua chave={s} />}
          secao={ehObjeto(respostas[s]) ? (respostas[s] as Record<string, unknown>) : {}}
          versao={briefing.versao}
        />
      ))}
    </div>
  )
}

/**
 * As ATUALIZAÇÕES SEMESTRAIS enviadas, da mais recente para a mais antiga.
 *
 * Elas não são correção do base (isso é `HistoricoDeRevisoes`): são a resposta
 * NOVA do aluno para objetivos e interesses num ciclo, e é ela que o plano
 * daquele semestre leu. A leitura passa pelo mesmo dicionário do resto da ficha
 * — e sempre na versão 2, que é a única que a tabela aceita (`schema_version`
 * tem CHECK de 2).
 */
export function AtualizacoesDoBriefing({ atualizacoes }: { atualizacoes: AtualizacaoEnviada[] }) {
  return (
    <div className="flex flex-col gap-5">
      {atualizacoes.map((u) => (
        <div key={u.id} className="flex flex-col gap-3">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-ink-900">Semestre {u.semestre}</span>
            {u.quando && <span className="text-sm text-ink-600">enviada em {u.quando}</span>}
          </p>
          {SECOES_DE_RESPOSTA.filter((s) => s.secao === 'objetivos' || s.secao === 'interesses').map(
            (s) => (
              <BlocoDaSecao
                key={s.secao}
                titulo={s.titulo}
                secao={
                  ehObjeto(u.respostas[s.secao])
                    ? (u.respostas[s.secao] as Record<string, unknown>)
                    : {}
                }
                versao={2}
              />
            ),
          )}
        </div>
      ))}
    </div>
  )
}

/** Valor de um lado do "de → para". Ausência é dita em voz alta. */
function ValorDaMudanca({ valor }: { valor: unknown }) {
  const texto = textoDaResposta(valor)
  return texto ? (
    <span className="text-ink-900">{texto}</span>
  ) : (
    <span className="text-ink-600">(sem resposta)</span>
  )
}

/**
 * A trilha de correção pós-envio (`briefing_revisions`, append-only). Quem, quando,
 * por quê — e o que virou o quê, com a pergunta por extenso. O briefing enviado é
 * imutável no sentido que interessa: todo estado anterior é reconstruível daqui.
 */
export function HistoricoDeRevisoes({
  revisoes,
  versao,
}: {
  revisoes: RevisaoDoBriefing[]
  versao: VersaoBriefing
}) {
  return (
    <ul className="flex flex-col divide-y divide-line-soft rounded-input border border-line">
      {revisoes.map((r) => (
        <li key={r.id} className="flex flex-col gap-1.5 px-4 py-3">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium tabular-nums text-ink-900">{r.quando}</span>
            <span className="text-sm text-ink-600">por {r.quem}</span>
          </p>
          <p className="max-w-prose text-sm leading-relaxed text-ink-900">{r.motivo}</p>
          <ul className="flex flex-col gap-1">
            {r.mudancas.map((m) => {
              const enunciado = entradaDaChave(m.chave, versao)?.enunciado
              return (
                <li key={m.campo} className="text-sm leading-relaxed text-ink-600">
                  <span className="font-medium text-ink-900">
                    {enunciado ?? <ChaveCrua chave={m.campo} />}
                  </span>
                  : <ValorDaMudanca valor={m.de} /> <span aria-hidden>→</span>{' '}
                  <ValorDaMudanca valor={m.para} />
                </li>
              )
            })}
          </ul>
        </li>
      ))}
    </ul>
  )
}
