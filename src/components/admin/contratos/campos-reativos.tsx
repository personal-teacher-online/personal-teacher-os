'use client'

// OS DOIS CAMPOS DO DETALHE QUE DEPENDEM DE OUTRO CAMPO (c12 · nº 18 e nº 19).
//
// POR QUE ESTA ILHA CLIENTE EXISTE. `paineis.tsx` é servidor puro de propósito —
// os oito painéis são formulários que o Postgres valida —, e HTML de servidor
// não sabe dizer "este campo é obrigatório SE aquele outro estiver assim". As
// duas regras que o Sol pegou são exatamente disso:
//
//  · nº 18 — "Motivo da baixa" só é obrigatório quando o destino escolhido é
//    DAR BAIXA (que é o padrão) e existe crédito vivo para baixar. É o mesmo
//    `if` de `admin_end_contract`: *"este contrato tem créditos vivos —
//    transfira para outro contrato do aluno OU dê baixa com motivo"*;
//  · nº 19 — "Validade" só é obrigatória quando o lançamento é POSITIVO. É o
//    mesmo `if` de `admin_makeup_adjust`: *"crédito manual exige expires_on"*.
//    Tirar crédito não tem validade nenhuma a informar.
//
// LEI 3, e ela vale aqui inteira: nenhuma destas linhas DECIDE. Quem recusa é o
// banco, com as frases acima; o que a tela faz é dizer antes, no campo certo,
// em vez de deixar a pessoa preencher o Sheet e ouvir um erro de Postgres no
// fim. Cada `required`/`setCustomValidity` deste arquivo tem uma linha
// correspondente na RPC, e é ela que está citada ao lado.
//
// Lei 1: nada aqui formata data. `validadeSugeridaIso` chega pronto do servidor.

import { useEffect, useRef, useState } from 'react'

import { DateField } from '@/components/DateField'
import { CAMPO, Campo, GradeDeCampos } from '@/components/admin/alunos/ficha/pecas'

/* ========================================================================== */
/* nº 18 · destino dos créditos vivos no encerramento                          */
/* ========================================================================== */

export function DestinoDosCreditos({
  destinos,
  temCreditosVivos,
  contratoPausado,
}: {
  /** contratos ATIVOS do mesmo dono que podem receber os créditos */
  destinos: { id: string; plano: string }[]
  /**
   * Há saldo a destinar? É a MESMA condição de `admin_end_contract` (só exige
   * escolha quando `_makeup_remaining_credits` devolve algo válido). Sem saldo,
   * exigir motivo seria a tela inventando uma regra que o banco não tem.
   *
   * ⚠️ …com UM ponto cego declarado desde o A6/lote 3 (prova independente L3):
   * ele vem do saldo do resumo, e o saldo NÃO enxerga o crédito CONGELADO que
   * já passou da data no papel. `admin_end_contract` passou a medir a validade
   * EFETIVA (papel + dias congelados), então em contrato PAUSADO o banco pode
   * exigir destino onde esta tela afirmava que não havia nada a baixar.
   */
  temCreditosVivos: boolean
  /**
   * O contrato está PAUSADO? Só serve para a tela PARAR DE AFIRMAR o negativo
   * (ver acima) — nada aqui decide: quem confere é `admin_end_contract`, na
   * transação. O conserto estrutural (um resumo que enxergue o congelado) é
   * dívida escrita, não este lote.
   */
  contratoPausado: boolean
}) {
  // `''` é DAR BAIXA — o mesmo valor que a action já lia da tela velha.
  const [destino, setDestino] = useState('')
  const daBaixa = destino === ''

  return (
    <>
      {/* RÁDIO, e não Select: são poucas opções e cada uma tem CONSEQUÊNCIA
          diferente — a escolha precisa estar visível inteira (a régua dos
          radios-de-consequência do TutorBird). */}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Destino dos créditos vivos</legend>
        {destinos.map((d) => (
          <label key={d.id} className="flex items-start gap-2 text-sm text-ink-900">
            <input
              type="radio"
              name="dest_contract"
              value={d.id}
              checked={destino === d.id}
              onChange={() => setDestino(d.id)}
              className="mt-1 h-4 w-4 accent-ac-deep"
            />
            <span>
              <span className="font-medium">Transferir para {d.plano}</span>
              <span className="block text-ink-600">
                outro contrato ativo do mesmo aluno — os créditos seguem valendo lá
              </span>
            </span>
          </label>
        ))}
        <label className="flex items-start gap-2 text-sm text-ink-900">
          <input
            type="radio"
            name="dest_contract"
            value=""
            checked={daBaixa}
            onChange={() => setDestino('')}
            className="mt-1 h-4 w-4 accent-ac-deep"
          />
          <span>
            <span className="font-medium">Dar baixa</span>
            <span className="block text-ink-600">
              {destinos.length === 0
                ? 'não há outro contrato ativo deste aluno para receber os créditos'
                : 'os créditos vivos deixam de existir, com o motivo registrado'}
            </span>
          </span>
        </label>
      </fieldset>

      <Campo
        rotulo="Motivo da baixa"
        largo
        apoio={
          temCreditosVivos
            ? 'obrigatório quando você não transfere — é ele que explica, seis meses depois, por que o saldo sumiu'
            : contratoPausado
              ? // A6/lote 3: em contrato pausado o crédito congelado CONTA para
                // o banco (validade efetiva = papel + dias parados), mesmo o que
                // já passou da data. A tela não sabe quantos são — então ela
                // para de afirmar que não há nada e diz quem confere.
                'o saldo à vista está zerado, mas o crédito congelado da pausa continua contando para o encerramento — quem confere é o banco, na hora de encerrar; escreva o motivo se você for dar baixa'
              : 'este contrato não tem crédito vivo para baixar; o motivo fica opcional'
        }
        exigencia="Informe o motivo da baixa dos créditos"
      >
        <input
          name="writeoff_note"
          // nº 18: o espelho do `if` de `admin_end_contract` — baixa COM saldo
          // exige motivo; transferência e contrato sem saldo, não.
          required={daBaixa && temCreditosVivos}
          placeholder="ex.: aluno mudou-se"
          className={CAMPO}
        />
      </Campo>
    </>
  )
}

/* ========================================================================== */
/* nº 19 · o lançamento de crédito manual                                      */
/* ========================================================================== */

/** Teto de sanidade do banco: `abs(p_delta) > 30` recusa. */
export const MAX_DELTA = 30

export function LancamentoDeCredito({
  validadeSugeridaIso,
  duracaoSugerida,
  validadeDias,
  hojeIso,
}: {
  validadeSugeridaIso: string
  duracaoSugerida: number
  validadeDias: number
  /** hoje no fuso do NEGÓCIO, calculado no servidor (Lei 1) */
  hojeIso: string
}) {
  const [delta, setDelta] = useState('1')
  const campoDoDelta = useRef<HTMLInputElement>(null)
  const n = Number(delta)
  const positivo = Number.isFinite(n) && n > 0

  // nº 19 — `delta ≠ 0` é a única das três regras que o HTML não sabe escrever
  // (`min`/`max` cobrem a faixa, `required` cobre o vazio, mas "qualquer número
  // menos zero" não é um atributo). Vira `setCustomValidity`, que é o mesmo
  // mecanismo do `TimeField`: o `FormValidado` do kit mostra a frase embaixo do
  // campo e trava o envio. A recusa de verdade continua sendo a da RPC
  // (*"p_delta deve ser ±N"*).
  useEffect(() => {
    campoDoDelta.current?.setCustomValidity(
      delta !== '' && n === 0 ? 'Zero não é lançamento: use +N para dar crédito ou −N para tirar.' : '',
    )
  }, [delta, n])

  return (
    <GradeDeCampos>
      <Campo
        rotulo="Créditos (±)"
        apoio={`positivo dá, negativo tira — de −${MAX_DELTA} a +${MAX_DELTA}, nunca zero`}
        exigencia="Informe quantos créditos lançar"
      >
        <input
          ref={campoDoDelta}
          name="delta"
          type="number"
          required
          // o teto de sanidade do banco, antecipado nas duas pontas
          min={-MAX_DELTA}
          max={MAX_DELTA}
          step="1"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          className={CAMPO}
        />
      </Campo>
      {/* c13 · nº 11 — NO LANÇAMENTO NEGATIVO O CAMPO SAI DA TELA.
          Antes ele só deixava de ser `required`: continuava desenhado, com uma
          data sugerida dentro, e continuava sendo ENVIADO. `admin_makeup_adjust`
          ignora `expires_on` no débito (crédito que sai não tem validade), mas o
          `audit_log` registrava a data assim mesmo — um campo que parece decisão
          e não teve efeito nenhum é pior que campo nenhum para quem lê a
          auditoria seis meses depois. Some o campo, some o valor: a action
          também deixou de mandá-lo (rede de baixo para o POST à mão). */}
      {positivo ? (
        <Campo
          rotulo="Validade"
          apoio={`obrigatória para crédito novo — regra deste contrato: ${validadeDias} dias`}
          exigencia="Informe até quando o crédito vale"
        >
          <DateField
            name="expires_on"
            // nº 19: espelho de `admin_makeup_adjust` — só o lançamento POSITIVO
            // exige `expires_on`, e lá ele também recusa data no passado.
            required
            min={hojeIso}
            defaultValue={validadeSugeridaIso}
            className={CAMPO}
          />
        </Campo>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-900">Validade</span>
          <p className="py-2 text-sm text-ink-600">
            crédito que sai não tem validade a informar
          </p>
        </div>
      )}
      <Campo rotulo="Duração (min)" apoio="da aula que este crédito repõe">
        <input
          name="duration_min"
          type="number"
          min="15"
          max="480"
          step="5"
          defaultValue={duracaoSugerida}
          className={CAMPO}
        />
      </Campo>
      <Campo rotulo="Motivo" apoio="fica na auditoria" exigencia="Informe o motivo do ajuste">
        <input
          name="note"
          required
          placeholder="ex.: cortesia; indicação; falha nossa"
          className={CAMPO}
        />
      </Campo>
    </GradeDeCampos>
  )
}
