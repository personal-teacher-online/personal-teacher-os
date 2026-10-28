'use client'

// TIPO × VALOR DA AULA AVULSA — o par que decide se o aluno vai ser cobrado.
//
// ── O DEFEITO QUE ISTO CONSERTA (Sol · rodada 1 do A4, grave 1) ──────────────
// "Cortesia é gratuita" era mentira do lado do formulário. O campo Valor sumia
// por CSS (`[&:has(select[name=kind] option[value=courtesy]:checked)_[data-price]]:hidden`)
// mas continuava MONTADO e habilitado, então continuava no `FormData`. Caminho
// real, com dinheiro no fim:
//
//   1. a dona digita R$ 150 com "Extra (cobrada à parte)" escolhido;
//   2. o banco recusa por outro motivo (conflito de horário, aula no passado);
//   3. ela volta, troca para "Cortesia" — o campo some da tela, o 15000 fica;
//   4. confirma. `admin_create_single_class` grava
//      `single_kind='courtesy'` COM `single_price_cents=15000`.
//
// A linha nasce contradizendo a frase que ela leu, e o preço fica pendurado num
// registro que a tela chama de gratuito. A RPC não impede: ela só EXIGE valor na
// extra (`p_price_cents > 0`) e nunca proíbe valor na cortesia.
//
// O conserto do lado da tela é DESMONTAR: cortesia não tem campo de valor, logo
// não tem valor no envio — não existe estado da tela em que "cortesia" e um
// preço convivam. E trocar de tipo LIMPA o que estava digitado, para o valor não
// ressuscitar quando ela voltar para "extra".
//
// ✅ O ENDURECIMENTO NO BANCO CHEGOU (A6/b, migration `20260730000100`): existem
// agora o CHECK `class_instances_courtesy_sem_preco` e a recusa com frase dentro
// de `admin_create_single_class`, e a action zera o preço quando o tipo é
// cortesia. Isto aqui deixou de ser a ÚNICA trava — e continua sendo a primeira,
// porque a melhor recusa é a que não deixa o estado inválido existir na tela.
// Um envio forjado com `kind=courtesy&price=150` agora volta como ERRO, não como
// aula gratuita com preço pendurado.
//
// Por que componente compartilhado: o MESMO par existe no balão da meia-hora
// (`IntencoesDoSlot`) e no painel `?novo=avulsa` (`src/app/admin/agenda/page.tsx`).
// Consertar um e deixar o outro seria guardar o mesmo defeito de dinheiro na
// tela do lado.

import { useState } from 'react'

import { Field, input } from '@/components/ui'

/** Rótulo no piso de DADO (Sol · rodada 1 do A4, médio 5): "Valor" sustenta a
 *  decisão de cobrar ou não — `text-xs`/`ink-600` do `Field` é degrau de apoio.
 *  Variante LOCAL de propósito: reformar o `Field` global vale para o site
 *  inteiro e segue como dívida de kit. */
export function CampoDeDado({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-semibold text-ink-900">{label}</span>
      {hint && <span className="text-sm leading-snug text-ink-600">{hint}</span>}
      {children}
    </label>
  )
}

export function TipoEValorDaAvulsa({
  tipoInicial,
  valorInicial,
  dado = false,
}: {
  /** 'extra_paid' | 'courtesy' — o que voltou do rascunho, ou o padrão */
  tipoInicial?: string
  /** o valor que voltou do rascunho (só faz sentido na extra cobrada) */
  valorInicial?: string
  /** rótulos no piso de DADO (o balão) ou no `Field` padrão (o painel) */
  dado?: boolean
}) {
  const inicial = tipoInicial === 'courtesy' ? 'courtesy' : 'extra_paid'
  const [tipo, setTipo] = useState(inicial)
  // O valor é ESTADO, não `defaultValue`: trocar de tipo tem de LIMPAR o que
  // estava lá, senão desmontar/remontar traria o número de volta pelo default.
  const [valor, setValor] = useState(inicial === 'courtesy' ? '' : (valorInicial ?? ''))
  const Campo = dado ? CampoDeDado : Field

  return (
    <>
      <Campo label="Tipo">
        <select
          name="kind"
          value={tipo}
          onChange={(e) => {
            setTipo(e.target.value)
            setValor('')
          }}
          className={input}
        >
          <option value="extra_paid">Extra (cobrada à parte)</option>
          <option value="courtesy">Cortesia</option>
        </select>
      </Campo>
      {tipo === 'courtesy' ? (
        // Nada de campo escondido: a cortesia simplesmente NÃO tem valor.
        <p className="text-sm font-medium text-ink-900">
          Cortesia: o aluno não paga nada por esta aula. A hora continua contando no extrato da
          professora.
        </p>
      ) : (
        <Campo label="Valor (R$)" hint="obrigatório na extra cobrada">
          <input
            name="price"
            type="number"
            step="0.01"
            placeholder="150,00"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className={input}
          />
        </Campo>
      )}
    </>
  )
}
