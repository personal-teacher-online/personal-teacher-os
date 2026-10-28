'use client'

// O BALÃO DA MEIA-HORA — abertura CONTROLADA, e só na grade que está à vista.
//
// Ele existe por dois defeitos apontados na rodada 1 do Sol no A4, e os dois
// vinham do mesmo lugar: `defaultOpen` do Radix.
//
// ── MÉDIO 3 · a semana montava DOIS balões abertos ──────────────────────────
// Na visão de semana o `Calendario` renderiza DUAS grades — a do dia
// selecionado (`sm:hidden`, para o celular) e a de 7 colunas (`hidden sm:block`).
// O `slotAberto` ia para as duas, "porque o servidor não sabe o tamanho da
// tela". Quando o slot que falhou caía no dia da âncora, o Radix abria os DOIS
// balões: o da grade escondida vira conteúdo órfão no portal, o
// `hideWhenDetached` apenas o ESCONDE (não desmonta) — e um balão invisível,
// montado e aberto, come o primeiro `Esc` e disputa o foco com o visível.
// Conserto: quem decide é o CLIENTE, depois de montar, por media query — a
// mesma `(min-width: 640px)` do `sm` do Tailwind, numa assinatura ÚNICA de
// `matchMedia` para a página inteira (não uma por slot).
//
// ── MÉDIO 4 · `defaultOpen` não é contrato reativo ─────────────────────────
// `defaultOpen` só é lido no PRIMEIRO render de cada Root. Voltar (Back) da URL
// de erro para a URL limpa — ou avançar de novo — não muda um Root já montado:
// o balão continuava aberto depois do Back, e não reabria no Forward. Agora a
// abertura é ESTADO derivado da URL: quando a página re-renderiza com outro
// `slotAberto`, o balão obedece.
//
// ── O A5 REUSA ESTA PEÇA PARA O BALÃO DO EVENTO ────────────────────────────
// O balão da AULA tem exatamente os mesmos dois defeitos a evitar: ele reabre
// por URL (`?ev=<id>` na volta de erro do desfecho) e a semana desenha DUAS
// grades. Duplicar o mecanismo garantiria que o médio 3 ressuscitasse só num dos
// dois. O que mudou aqui para isso: a `chave` deixou de ser só slot (agora é
// "slot OU id de evento") e a largura virou parâmetro — o balão de aula hospeda
// a matriz do ADR-018 e não cabe em `w-80`. O padrão `w-80` mantém o A4 idêntico.
//
// ── O CAMINHO COMUM CONTINUA BARATO ────────────────────────────────────────
// A grade monta 224 destes numa semana cheia. 223 deles não são o slot pedido:
// esses caem no `BalaoSimples`, que não tem estado, nem efeito, nem assinatura
// de media query — é o mesmo Popover não-controlado de antes. Só o slot que a
// URL pede monta o componente com estado.

import * as React from 'react'

import { Popover, PopoverContent, PopoverTrigger, RODAPE_DO_POLEGAR } from './popover'

/** Qual das grades este balão habita (a semana desenha duas — ver o cabeçalho). */
export type VarianteDaGrade = 'unica' | 'movel' | 'desktop'

/** O `sm` do Tailwind: é a mesma fronteira que esconde/mostra as duas grades. */
const CONSULTA_DESKTOP = '(min-width: 640px)'

/* -------------------------------------------------------------------------- */
/* Uma assinatura de media query para a página inteira                          */
/* -------------------------------------------------------------------------- */

let consulta: MediaQueryList | null = null
const ouvintes = new Set<() => void>()

function avisar() {
  for (const cb of ouvintes) cb()
}

function assinar(cb: () => void): () => void {
  ouvintes.add(cb)
  if (!consulta && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    consulta = window.matchMedia(CONSULTA_DESKTOP)
    consulta.addEventListener('change', avisar)
  }
  return () => {
    ouvintes.delete(cb)
  }
}

/**
 * A TELA TEM TRÊS ESTADOS, E O TERCEIRO NÃO É "CELULAR" (Sol · rodada 1 do A5,
 * médio 4).
 *
 * O booleano de antes tinha um buraco: o snapshot do servidor era `false`, e
 * `false` significava "não é desktop" — ou seja, CELULAR. Para a grade móvel
 * (`variante='movel'`) a conta `!desktop` virava `true`, e o balão da grade
 * ESCONDIDA nascia ABERTO num desktop, até o `matchMedia` responder. Nessa
 * janela ele podia receber o autofoco do Radix, que é a família "nada invisível
 * continua clicável" (quarta aparição) — o defeito que o médio 3 do A4 conserta
 * para o outro lado.
 *
 * Agora "ainda não sei" é estado PRÓPRIO, e nele nenhuma das duas grades da
 * semana abre. Custo aceito: no celular o balão da volta de erro aparece um tick
 * depois de montar, em vez de já vir aberto no HTML — e o conteúdo do Popover do
 * Radix não existe sem JavaScript de todo jeito, então nada se perde sem JS.
 */
type Viewport = 'desconhecido' | 'desktop' | 'movel'

function daTela(): Viewport {
  if (!consulta) return 'desconhecido'
  return consulta.matches ? 'desktop' : 'movel'
}

/** No servidor não há tela — e "não sei" não é "celular". */
function noServidor(): Viewport {
  return 'desconhecido'
}

function useViewport(): Viewport {
  return React.useSyncExternalStore(assinar, daTela, noServidor)
}

export interface PropsDoBalao {
  /** identidade do balão: o slot ('yyyy-LL-ddTHH:mm') ou o id do evento */
  chave: string
  /** qual balão a URL manda abrir (undefined = nenhum) */
  aberturaPedida?: string
  variante: VarianteDaGrade
  /** nome acessível do conteúdo */
  rotulo: string
  /** o gatilho já montado (o botão da meia-hora, ou o bloco do evento) */
  gatilho: React.ReactNode
  /** largura do balão. Padrão `w-80`, a do slot (A4); o balão de AULA pede a
   *  própria (`LARGURA_DO_BALAO_DE_AULA`, do kit) porque hospeda a matriz. */
  largura?: string
  children: React.ReactNode
}

export function BalaoDoSlot(props: PropsDoBalao) {
  // Troca de COMPONENTE, não de ramo de `if` dentro do mesmo: o slot pedido
  // monta com estado; os outros 223 seguem sem hook nenhum. Quando a URL muda,
  // o tipo do componente muda e o Radix remonta — que é exatamente o reset de
  // abertura que o médio 4 pede.
  return props.aberturaPedida && props.aberturaPedida === props.chave ? (
    <BalaoQueAbre {...props} />
  ) : (
    <BalaoSimples {...props} />
  )
}

/**
 * A ÂNCORA NÃO PODE FICAR NA FAIXA QUE O PRÓPRIO BALÃO RESERVA (A9, 30/07).
 *
 * O `RODAPE_DO_POLEGAR` é fronteira de colisão E régua do `hide` do Radix ao
 * mesmo tempo (a lápide longa está em `./popover.tsx`): âncora a menos disso de
 * uma borda de recorte — inclusive a borda da JANELA — é declarada ESCONDIDA, e
 * o balão nasce `visibility: hidden`. Medido: tocar num bloco de aula espremido
 * no pé da tela não abria balão nenhum; a dona tocava e não acontecia nada.
 *
 * Quem reserva a faixa também tira a âncora dela. É o gesto que um seletor
 * nativo de celular faz: o conteúdo sobe um pouco para caber o que abriu.
 * Só rola quando PRECISA — âncora já folgada na tela não faz a página pular.
 */
function foraDoAlcance(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  const altura = window.innerHeight || 0
  // acima do topo, ou com o topo dentro da faixa reservada no pé
  return r.bottom <= 0 || r.top >= altura - RODAPE_DO_POLEGAR
}

function trazerParaOAlcance(el: HTMLElement | null): void {
  // `scrollIntoView` não existe no jsdom; a prova desta rolagem é o e2e.
  if (!el || typeof el.scrollIntoView !== 'function') return
  if (!foraDoAlcance(el)) return
  el.scrollIntoView({ block: 'center', inline: 'nearest' })
}

/** O mesmo gatilho, agora com a referência que a rolagem precisa. O `asChild` do
 *  Radix compõe as duas referências (a dele e a do filho), então nada se perde. */
function comAncora(gatilho: React.ReactNode, ref: React.Ref<HTMLElement>): React.ReactNode {
  return React.isValidElement(gatilho)
    ? React.cloneElement(gatilho as React.ReactElement<{ ref?: React.Ref<HTMLElement> }>, { ref })
    : gatilho
}

function Moldura({
  aberto,
  aoMudar,
  rotulo,
  gatilho,
  largura = 'w-80',
  children,
}: {
  aberto?: boolean
  aoMudar?: (v: boolean) => void
  rotulo: string
  gatilho: React.ReactNode
  largura?: string
  children: React.ReactNode
}) {
  const ancora = React.useRef<HTMLElement | null>(null)

  // DOIS CAMINHOS, porque são dois jeitos de abrir:
  //  · o TOQUE (inclusive nos 223 balões sem estado) chega por `onOpenChange`, e
  //    ali a rolagem acontece ANTES de o Radix medir — o balão já nasce no lugar;
  //  · a abertura pelo ENDEREÇO (`?ev=`/`?slot=`) nasce aberta na montagem, e
  //    nenhum evento de mudança dispara: quem a pega é o efeito.
  React.useEffect(() => {
    if (aberto) trazerParaOAlcance(ancora.current)
  }, [aberto])

  function aoAbrir(v: boolean) {
    if (v) trazerParaOAlcance(ancora.current)
    aoMudar?.(v)
  }

  return (
    <Popover open={aberto} onOpenChange={aoAbrir}>
      <PopoverTrigger asChild>{comAncora(gatilho, ancora)}</PopoverTrigger>
      <PopoverContent
        // A4: o balão passou de um mini-form de 3 campos para as três intenções
        // com formulário; 64 (16rem) espremia rótulo e frase de consequência. O
        // `max-w-[92vw]` do kit continua segurando o celular.
        className={largura}
        aria-label={rotulo}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

function BalaoSimples({ rotulo, gatilho, largura, children }: PropsDoBalao) {
  return (
    <Moldura rotulo={rotulo} gatilho={gatilho} largura={largura}>
      {children}
    </Moldura>
  )
}

function BalaoQueAbre({ variante, rotulo, gatilho, largura, children }: PropsDoBalao) {
  const viewport = useViewport()
  // MÉDIO 3 do A4: na semana, só a grade que a media query deixa visível abre.
  // MÉDIO 4 do A5: enquanto a tela é DESCONHECIDA (servidor e primeiro render do
  // cliente, antes da assinatura), NENHUMA das duas abre — `desconhecido` não é
  // celular. `unica` segue abrindo sempre: ali não existe grade gêmea escondida,
  // logo não existe balão invisível para roubar foco.
  const daVez =
    variante === 'unica'
      ? true
      : viewport === 'desconhecido'
        ? false
        : variante === 'desktop'
          ? viewport === 'desktop'
          : viewport === 'movel'

  // Estado DERIVADO de prop, no padrão da casa (`DateField`/`TimeField`): ajuste
  // durante o render em vez de `setState` dentro de efeito (que a regra
  // `react-hooks/set-state-in-effect` proíbe, e com razão — cascata de render
  // em 224 nós). Fechar o balão à mão NÃO o reabre: só a virada de `daVez`
  // mexe nele. A reação à URL (médio 4) não passa por aqui: quando o
  // `slotAberto` muda, o `BalaoDoSlot` troca o TIPO do componente e este
  // remonta já com o estado certo.
  const [antes, setAntes] = React.useState(daVez)
  const [aberto, setAberto] = React.useState(daVez)
  if (antes !== daVez) {
    setAntes(daVez)
    setAberto(daVez)
  }

  return (
    <Moldura
      aberto={aberto}
      aoMudar={setAberto}
      rotulo={rotulo}
      gatilho={gatilho}
      largura={largura}
    >
      {children}
    </Moldura>
  )
}
