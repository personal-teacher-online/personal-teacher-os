'use client'

// STEPPER DE HORAS (Onda da Agenda · A8) — o controle da antecedência mínima.
//
// POR QUE UM STEPPER, e não um `<input type=number>` seco (padrão TutorBird, o
// que o A8 pede): a pergunta que a dona faz aqui é "quero mais ou menos
// antecedência?", não "qual é o número?". Com [−]/[+] ela responde a pergunta
// dela com um toque; o campo continua existindo para quem sabe o número e
// prefere digitá-lo (24 é um toque, não vinte e quatro).
//
// QUATRO REGRAS QUE ESTE ARQUIVO CARREGA:
//
// 1. NADA INVISÍVEL CONTINUA CLICÁVEL (a invariante que a onda escreveu no A3,
//    depois da terceira aparição do "botão invisível"). No limite da faixa o
//    botão fica `disabled` — VISÍVEL, apagado e inerte —, nunca escondido por
//    opacidade ou por um `<span>` fantasma por cima. Quem vê, alcança; quem não
//    alcança, não vê.
// 2. CAMPO VAZIO É ESTADO VAZIO, NUNCA ZERO (Sol · rodada 1 do A8, médio 5).
//    A primeira versão guardava o valor num `useState<number>` e fazia
//    `setValor(Number(e.target.value))` — e `Number('')` é **0**. Como zero é um
//    valor VÁLIDO que DESLIGA a antecedência mínima, apagar o campo no celular
//    para redigitar (e ser interrompida antes de digitar) transformava o campo
//    em "0" na tela e, se ela salvasse, em "dá para marcar até a hora de
//    começar" no banco — uma regra de dinheiro trocada sem ninguém pedir. Agora
//    o estado é o TEXTO do campo: vazio é vazio, aparece vazio, a consequência
//    escrita vira a frase do estado vazio e o `required` recusa o envio. Zero
//    continua sendo escolha possível — mas digitada.
// 3. A FAIXA ESTOURADA DIZ O QUE ESTÁ ERRADO (Sol · rodada 1 do A8, médio 6).
//    Antes, digitar 169 bloqueava o envio, pintava a borda de vermelho e não
//    dizia nada: nem na tela (o stepper não estava dentro de um
//    `data-slot="campo"`, então o `FormValidado` não tinha onde escrever) nem
//    para o leitor de tela (`aria-invalid` sem `aria-describedby`). A dona
//    concluía que "Salvar" não funciona. Agora o campo mora num
//    `data-slot="campo"` com o parágrafo de erro pronto e `hidden`, e a frase da
//    faixa entra por `setCustomValidity` — que é a causa de maior precedência em
//    `mensagemDoCampo`, então ela ganha da frase genérica.
// 4. A FRASE MUDA JUNTO. O número sozinho não diz o que ele faz: ao lado dele
//    fica a consequência escrita ("Precisa marcar com pelo menos 24 horas (1
//    dia) de antecedência"), recalculada a cada toque pela MESMA função pura que
//    o servidor usou para desenhar a primeira versão — sem JavaScript a frase
//    inicial continua correta, ela só deixa de acompanhar o campo.
//
// A FAIXA AQUI É ANTECIPAÇÃO, NÃO REGRA (Lei 3): `min`/`max`, os botões apagados
// e a frase de erro existem para a dona não perder tempo; quem recusa 10000
// horas é `admin_set_teacher_policy`, dentro do banco.
//
// O valor viaja no PRÓPRIO `<input name>`: nada de campo espelho escondido —
// dois lugares guardando o mesmo número é como eles divergem.

import { Minus, Plus, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import {
  ANTECEDENCIA_FORA_DA_FAIXA,
  ANTECEDENCIA_MAX,
  ANTECEDENCIA_MIN,
  ANTECEDENCIA_PASSO,
  ANTECEDENCIA_VAZIA,
  fraseDaAntecedencia,
} from '@/data/admin/ajustes-gramatica'

const BOTAO =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-input border border-line bg-paper-0 text-ink-900 transition-colors duration-(--duration-hover) ease-(--ease-in-out) hover:bg-paper-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ac-vivid disabled:cursor-not-allowed disabled:border-line-soft disabled:text-ink-400 disabled:hover:bg-paper-0'

/**
 * O número que o texto do campo representa — ou `null` quando não há número
 * nenhum (vazio, só espaço, "12abc"). É esta função que impede `''` de virar 0.
 */
function numeroDe(texto: string): number | null {
  const cru = texto.trim()
  if (cru === '') return null
  const n = Number(cru)
  return Number.isInteger(n) ? n : null
}

export function PassoDeHoras({
  name,
  valorInicial,
  rotulo,
}: {
  name: string
  valorInicial: number
  /** o nome acessível do campo (o rótulo visível mora na linha, fora daqui) */
  rotulo: string
}) {
  const [texto, setTexto] = useState(String(valorInicial))
  const campo = useRef<HTMLInputElement>(null)
  const id = useId()

  const valor = numeroDe(texto)
  const foraDaFaixa = valor !== null && (valor < ANTECEDENCIA_MIN || valor > ANTECEDENCIA_MAX)

  // A FRASE DA FAIXA, pela porta de maior precedência. `setCustomValidity` vence
  // `rangeOverflow` em `mensagemDoCampo`, e o `required` continua respondendo
  // pelo vazio com a exigência escrita no parágrafo abaixo. Roda também na
  // montagem: uma professora com valor legado fora da faixa abre já explicada,
  // em vez de só travar no "Salvar".
  useEffect(() => {
    campo.current?.setCustomValidity(foraDaFaixa ? ANTECEDENCIA_FORA_DA_FAIXA : '')
  }, [foraDaFaixa])

  /** O [−]/[+] anda a partir do número; com o campo vazio ele não tem de onde
   *  partir, e por isso nasce desabilitado (visível e inerte — regra 1). */
  const anda = (delta: number) =>
    setTexto((t) => {
      const n = numeroDe(t)
      if (n === null) return t
      return String(Math.min(ANTECEDENCIA_MAX, Math.max(ANTECEDENCIA_MIN, n + delta)))
    })

  return (
    // O `data-slot="campo"` é o que dá ao `FormValidado` um lugar para acender o
    // erro — sem ele o campo ficava `aria-invalid` e mudo (médio 6).
    <div data-slot="campo" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={BOTAO}
          onClick={() => anda(-ANTECEDENCIA_PASSO)}
          disabled={valor === null || valor <= ANTECEDENCIA_MIN}
          aria-label={`Diminuir ${rotulo}`}
        >
          <Minus aria-hidden className="h-4 w-4" />
        </button>
        <input
          ref={campo}
          id={id}
          name={name}
          type="number"
          inputMode="numeric"
          min={ANTECEDENCIA_MIN}
          max={ANTECEDENCIA_MAX}
          step={ANTECEDENCIA_PASSO}
          required
          aria-label={rotulo}
          value={texto}
          // O estado é o TEXTO, não o número: `Number('')` é 0, e zero aqui
          // DESLIGA a antecedência mínima (médio 5). Ver a regra 2 no cabeçalho.
          onChange={(e) => setTexto(e.target.value)}
          className="h-11 w-20 rounded-input border border-line bg-paper-0 px-3 text-center text-sm font-medium tabular-nums text-ink-900 outline-none transition-colors duration-(--duration-hover) ease-(--ease-in-out) focus:border-ac-vivid focus:outline-2 focus:outline-offset-1 focus:outline-ac-vivid data-[erro=sim]:border-danger-700"
        />
        <button
          type="button"
          className={BOTAO}
          onClick={() => anda(ANTECEDENCIA_PASSO)}
          disabled={valor === null || valor >= ANTECEDENCIA_MAX}
          aria-label={`Aumentar ${rotulo}`}
        >
          <Plus aria-hidden className="h-4 w-4" />
        </button>
        <span className="text-sm text-ink-600">horas</span>
      </div>

      {/* A consequência é DADO derivado, não enfeite: piso de leitura. Com o
          campo vazio — ou com um número fora da faixa — ela NÃO afirma nada
          sobre a regra: não existe regra para descrever ainda. */}
      <p aria-live="polite" className="text-sm font-medium text-ink-900">
        {foraDaFaixa ? ANTECEDENCIA_FORA_DA_FAIXA : fraseDaAntecedencia(valor)}
      </p>

      {/* O parágrafo do erro nasce escrito e `hidden`: quem o acende e o liga ao
          campo por `aria-describedby` é o `FormValidado` do kit. */}
      <p
        data-slot="campo-erro"
        data-exigencia={ANTECEDENCIA_VAZIA}
        role="alert"
        hidden
        className="flex items-start gap-1.5 text-sm leading-relaxed text-danger-700"
      >
        <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        <span data-slot="campo-erro-texto">{ANTECEDENCIA_VAZIA}</span>
      </p>
    </div>
  )
}
