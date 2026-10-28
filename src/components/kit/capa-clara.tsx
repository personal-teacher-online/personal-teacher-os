// A CAPA CLARA — a PROPOSTA de porta de entrada na direção do site novo
// (Onda do Portal · P6 · emenda D11 de 26/07/2026).
//
// ISTO ESTÁ EM DISPUTA, E PERDE POR PADRÃO. A capa noturna consolidada
// (`capa-noturna.tsx` + `/login` + `/recuperar-senha`) segue em produção e
// **vence por padrão**: a regra escrita pelo dono é que, em EMPATE OU DÚVIDA,
// fica a consolidada (`docs/goals/ia-site-2026-07.md` §"Capa noturna", e
// `docs/PLANO-CLONAGEM-UX.md` §D11). Este arquivo existe para que a comparação
// aconteça com a direção nova VISÍVEL do lado — que é a exigência da IA do
// site: o receio registrado do dono é o login não combinar mais com o site
// reestruturado, e isso não se decide de memória.
//
// DUPLICAÇÃO É PROPOSITAL. Nada aqui é compartilhado com a consolidada: nem
// componente, nem classe, nem constante. Um dos dois morre depois da decisão, e
// morre INTEIRO — quem for cortado sai por arquivo, sem desmontar peça alheia.
// É por isso que o campo e o rótulo estão escritos aqui em vez de importados da
// ficha do admin (`components/admin/alunos/ficha/pecas.tsx`): uma página pública
// não deve pendurar-se na anatomia da ficha, e o corte tem de ser limpo.
//
// A TESE VISUAL, em uma frase: a porta de entrada passa a ser o MESMO objeto que
// o aluno vê depois de entrar. A moldura do portal (`PortalShell`) é faixa de
// tinta + fio-assinatura sobre papel; aqui ela vira o topo do cartão. Quem abrir
// o portal e o login lado a lado vê o mesmo cabeçalho, a mesma tipografia, o
// mesmo raio de 4/8 e o mesmo periwinkle na ação.
//
// O que NÃO muda em relação à consolidada: a função. Mesmo formulário, mesmos
// campos, mesma server action, mesmos erros — e a MESMA CÓPIA, palavra por
// palavra. A comparação do dono precisa isolar a variável VISUAL; se o texto
// também mudasse, ele estaria escolhendo entre duas coisas ao mesmo tempo.
//
// E a MESMA VALIDAÇÃO (correção do P6, 28/07): a validação é a NATIVA do
// navegador nas duas capas, com os mesmos `required`. A primeira versão desta
// proposta trocava o balão cinza pelo erro inline do `FormValidado` — e isso
// somava uma variável de EXPERIÊNCIA à disputa que era só visual: no envio
// vazio o dono estaria comparando duas coisas ao mesmo tempo, sem saber. O erro
// inline é um bom padrão e continua valendo no admin; se a proposta vencer, ele
// entra em lote próprio, com portão próprio.
import Image from 'next/image'
import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { MARCA } from '@/lib/brand/constants'

/**
 * O esqueleto da proposta.
 *
 * `data-visual="proposta"` é o marcador estável desta direção — é por ele que a
 * suíte distingue as duas capas sem depender de classe de estilo (que muda) nem
 * de cópia (que é a mesma nas duas, de propósito).
 */
export function CapaClara({
  /** título da tela — o `h1` */
  titulo,
  /** a frase de apoio abaixo do título */
  subtitulo,
  children,
}: {
  titulo: string
  subtitulo?: ReactNode
  children: ReactNode
}) {
  return (
    // `data-surface="paper"` não é enfeite: é o que troca o `--focus-ring` do
    // turquesa da noite (#2bd9d9 — 1,75:1 sobre branco: o anel de foco do
    // botão "Entrar" e dos links seria invisível) para o periwinkle
    // `--brand-600` (#5a5fc4 — 5,43:1 sobre `--paper-0` e 5,08:1 sobre
    // `--paper-50`), bem acima dos 3:1 do WCAG 1.4.11. É o mesmo gesto do
    // `/portal`, `/admin`, `/teacher` e `/sales`, que já declaram a superfície
    // na raiz da tela; a capa clara tinha esquecido.
    <main
      data-surface="paper"
      data-visual="proposta"
      className="flex min-h-dvh w-full flex-col items-center justify-center bg-paper-50 px-4 py-10 [color-scheme:light]"
    >
      <div className="w-full max-w-sm">
        {/* `.panel-tb` é o contêiner de trabalho do kit: FLAT, anel de 1px, raio
            8 (Design.md §Organização). `overflow-hidden` para a faixa de tinta e
            o fio-assinatura morrerem exatamente na borda do cartão. */}
        <div className="panel-tb overflow-hidden">
          {/* A MOLDURA DE TINTA, igual à do `PortalShell`: símbolo branco +
              nome da escola em Bricolage. É a citação literal do site novo. */}
          <div className="flex items-center gap-2.5 bg-ink-900 px-6 py-4">
            <Image
              src={MARCA.simboloBranco}
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 opacity-90"
              priority
            />
            <span className="font-display text-[15px] font-bold text-white">{MARCA.escola}</span>
          </div>
          <div className="brand-thread" aria-hidden />

          <div className="flex flex-col gap-5 p-6 sm:p-7">
            <div className="flex flex-col gap-1">
              <h1 className="title-page text-ink-900">{titulo}</h1>
              {subtitulo && <p className="text-sm leading-relaxed text-ink-600">{subtitulo}</p>}
            </div>
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}

/**
 * O campo de texto da capa clara — geometria do kit (raio 4, altura 44 no
 * celular, foco no acento).
 *
 * Cópia deliberada de `CAMPO` (`components/admin/alunos/ficha/pecas.tsx`): ver
 * a nota de duplicação no topo deste arquivo.
 *
 * A BORDA NÃO É `--line` (correção do P6, 28/07), é `--line-strong`. O `--line`
 * é `rgb(23 20 31 / 0.12)`, que sobre o branco do próprio campo (`--paper-0`)
 * compõe #e3e3e4 e mede **1,28:1** — reprovado no contraste NÃO-TEXTUAL de 3:1
 * do WCAG 1.4.11, que é justamente a régua do contorno que diz "aqui é um
 * campo". Dentro das áreas internas o `--line` sobrevive porque o campo vive
 * cercado de rótulo, painel e tabela; numa capa vazia ele é o ÚNICO desenho.
 * `--line-strong` é a mesma tinta numa mistura mais forte — **#8b8a8f ·
 * 3,43:1** sobre `--paper-0` (a conta, não o olho: L≈0,2564 contra L=1 ⇒
 * 1,05/0,3064); a definição e o porquê do hex sólido moram em `globals.css`,
 * que é onde os tokens são decididos.
 * No foco a borda passa a `--ac-vivid` (#8488d9 · 3,23:1), que também passa.
 */
export const campoClaro =
  'min-h-11 w-full rounded-input border border-line-strong bg-paper-0 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-colors duration-(--duration-hover) ease-(--ease-in-out) focus:border-ac-vivid focus:outline-2 focus:outline-offset-1 focus:outline-ac-vivid'

/**
 * Um campo com RÓTULO.
 *
 * SEM parágrafo de erro, e isso é a correção do P6 (28/07): a proposta usa a
 * validação NATIVA do navegador, igual à capa consolidada — a disputa é só
 * visual, e o erro inline do `FormValidado` mudava a EXPERIÊNCIA do envio
 * vazio junto com o visual. Com o `FormValidado` fora, o contrato
 * `data-slot="campo"`/`data-slot="campo-erro"` ficava órfão (ninguém para
 * acender) e saiu junto: marcação morta em página pública é dívida, não
 * preparo.
 */
export function CampoClaro({
  rotulo,
  para,
  children,
}: {
  rotulo: string
  /** `id` do controle — o rótulo aponta por `for` */
  para: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={para} className="text-sm font-semibold text-ink-900">
        {rotulo}
      </label>
      {children}
    </div>
  )
}

/**
 * O RECADO DA CAPA CLARA, nos dois tons.
 *
 * `role="status"` porque é resposta a um ato da pessoa (envio do formulário) e
 * quem usa leitor de tela precisa ouvi-lo sem procurar. A cor sozinha nunca é o
 * sinal: o texto diz o que aconteceu.
 *
 * Lavagem SÓLIDA (`--danger-wash` / `--ok-wash`), nunca alpha: texto de estado
 * sobre lavagem da mesma família mede o contraste do par que se vê
 * (Design.md §Régua da lavagem de estado).
 */
export function AvisoClaro({ tom, children }: { tom: 'ok' | 'erro'; children: ReactNode }) {
  return (
    <p
      role="status"
      className={`flex items-start gap-2 rounded-panel border px-4 py-3 text-sm font-medium leading-relaxed ${
        tom === 'erro'
          ? 'border-danger-700/40 bg-danger-wash text-danger-700'
          : 'border-ok-700/40 bg-ok-wash text-ok-700'
      }`}
    >
      {tom === 'erro' && <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{children}</span>
    </p>
  )
}
