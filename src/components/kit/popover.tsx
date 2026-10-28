'use client'

// Primitivo de POPOVER (Onda da Agenda · A1) — o balão ancorado que hospeda
// CONTEÚDO, não uma lista de comandos.
//
// POR QUE ELE NASCE, tendo `dropdown-menu` no kit: o menu do Radix PRENDE o Tab
// e navega por setas entre itens (está escrito no cabeçalho de lá). Isso é certo
// para um menu de comandos e ERRADO para os dois consumidores desta onda:
//   · o popover do EVENTO (A5) tem dados, um `<form>` de desfecho e um CTA —
//     formulário dentro de menu é teclado quebrado;
//   · o popover de INTENÇÕES do slot vazio (A4) hospeda mini-formulários com
//     data e hora já embutidas.
// Menu continua sendo menu (o `[+ Novo ▾]` da toolbar é `SplitButton`); o que
// tem campo mora aqui.
//
// O QUE ELE SUBSTITUI: `<details data-popup>`, que é como a agenda velha
// desenhava os dois. Um `<details>` é liga/desliga — sem foco preso, sem Esc,
// sem devolução de foco, sem saída animada, e sem semântica de diálogo para
// leitor de tela. O `AGENTS.md` proíbe `<details data-popup>` em tela nova
// exatamente por isso; esta é a peça que torna a proibição cumprível.
//
// Empilhamento: 45 (ver `RODAPE_DO_POLEGAR`) — acima da barra do polegar do
// celular (40), abaixo de diálogo/painel (50). Nasceu em 30, o degrau do menu,
// e isso punha o balão SOB a barra fixa do admin.
//
// Motion: reusa `.kit-menu` do globals (entrada por transição com
// @starting-style, saída por keyframe — o Presence do Radix só segura o nó
// enquanto houver `animation`). `transform-origin` do Radix é obrigatório: sem
// ele o balão cresce do centro, tell clássico de componente default.

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'

import { cn } from '@/lib/cn'

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

/** Âncora avulsa: quando o gatilho não é o elemento ao qual o balão se prende
 *  (na grade, o gatilho é a meia-hora e a âncora é a célula do dia). */
function PopoverAnchor(props: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

/**
 * A BARRA DO POLEGAR EXISTE (portão de deploy 29/07, achado 5).
 *
 * O rodapé fixo do admin no celular (`AdminThumbBar`) mede 56px + safe-area
 * (até ~34px no iPhone) e vive em `z-40`. Com 8px de colisão em todos os lados
 * e `z-30`, um popover ancorado numa meia-hora perto do pé da grade nascia
 * EMBAIXO da barra: o balão ficava invisível e o toque caía na navegação. A
 * fronteira de colisão passa a reservar essa faixa (o Radix então vira o balão
 * para cima), e o empilhamento sobe para 45 — acima da barra (40) e abaixo dos
 * diálogos e painéis (50), que são modais e têm de continuar por cima.
 *
 * O valor é constante porque `collisionPadding` é número em JS, sem media
 * query: no desktop ele só faz o balão virar um pouco mais cedo perto do fim da
 * janela — barato perto de um balão inalcançável no celular.
 *
 * ⚠️ ELE TAMBÉM É A RÉGUA DO "A ÂNCORA SUMIU" — e essa é a lápide do A9.
 *
 * O Radix monta UM objeto de detecção de transbordo e o entrega tanto às peças
 * de POSIÇÃO (`flip`/`shift`/`size`) quanto à peça que decide se a âncora ainda
 * existe na tela (`hide({ strategy: 'referenceHidden' })`, ligada pelo
 * `hideWhenDetached` abaixo) — `padding: collisionPadding` nas duas
 * (`@radix-ui/react-popper`, `detectOverflowOptions`). E, para o `hide`, padding
 * não quer dizer "reserve esta faixa": quer dizer «âncora a menos de 96px de uma
 * borda de recorte CONTA COMO ESCONDIDA» — o balão então nasce
 * `visibility: hidden` e a dona toca sem que nada aconteça.
 *
 * MEDIDO na 1ª execução real do e2e (30/07, WebKit e Chromium): o balão da
 * ÚLTIMA aula do dia nunca abria — o bloco das 21:15 do casal encosta no pé do
 * contêiner rolável da grade, e 96px de reserva o declaravam invisível em
 * QUALQUER rolagem da página. Quem paga a diferença é a grade, que passou a
 * OFERECER a folga que este número reserva (`pb-24` nos dois contêineres
 * roláveis de `kit/calendario.tsx`). Baixar o número AQUI resolveria pelo outro
 * lado — mas ele é decisão do dono (achado 5 do portão de deploy, pinada em
 * `tests/portao-deploy-agenda.test.ts`), e não coisa a desfazer de passagem no
 * conserto de um harness.
 *
 * A JANELA também é borda de recorte, então âncora deixada nos últimos 96px da
 * TELA seria lida como escondida do mesmo jeito — e o toque num bloco espremido
 * no pé da tela não abriria nada. Quem fecha esse lado é `kit/balao-do-slot.tsx`:
 * ao abrir, ele TIRA a âncora da faixa que este número reserva.
 *
 * ⚠️ QUEM PODE IMPORTAR ESTA CONSTANTE: só módulo CLIENTE (o
 * `balao-do-slot.tsx` é um). Este arquivo é `'use client'`, e constante lida
 * como VALOR dentro de um Server Component chega como referência de cliente, não
 * como número — foi assim que o teto do corpo do balão nasceu morto
 * (`src/lib/kit/balao.ts` conta o caso). A grade (`kit/calendario.tsx`) é Server
 * Component: lá a mesma folga é escrita como classe, e os dois números ficam
 * amarrados por asserção no portão (`tests/portao-deploy-agenda.test.ts` §6).
 */
export const RODAPE_DO_POLEGAR = 96

/**
 * A LARGURA DO BALÃO DE AULA (A5/L4).
 *
 * O balão do evento nasceu em `w-72` (18rem), quando o conteúdo dele era nome,
 * horário e dois links. No A5 ele passou a hospedar a MATRIZ do ADR-018 — cinco
 * linhas de radio, cada uma com a frase da consequência — mais as abas e o CTA:
 * em 18rem a frase de dinheiro virava uma coluna de duas palavras por linha, que
 * é a forma mais eficaz de não ser lida.
 *
 * 24rem é a mesma escada do balão do slot (`w-80`, que o A4 subiu de `w-64` pelo
 * mesmo motivo), um degrau acima. O `max-w-[92vw]` do `PopoverContent` continua
 * segurando o celular — a constante não precisa de media query.
 *
 * Mora AQUI, e não em cada consumidor, porque o balão de aula é montado em dois
 * lugares da grade (a grade de horas e o mês) e duas larguras diferentes para o
 * mesmo balão é o tipo de divergência que ninguém vê no diff.
 */
export const LARGURA_DO_BALAO_DE_AULA = 'w-96'

function PopoverContent({
  className,
  sideOffset = 6,
  align = 'start',
  collisionPadding = { top: 8, right: 8, bottom: RODAPE_DO_POLEGAR, left: 8 },
  container,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  container?: React.ComponentProps<typeof PopoverPrimitive.Portal>['container']
}) {
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        sideOffset={sideOffset}
        align={align}
        // A grade rola nos dois eixos e vive perto das bordas: sem padding de
        // colisão o balão do último dia da semana nasce metade fora da tela.
        collisionPadding={collisionPadding}
        // O balão vive num portal: quando a âncora (meia-hora, bloco de evento)
        // rola para fora da área visível da grade, sem isto o balão ficaria
        // órfão flutuando sobre outra parte da página — some junto com a âncora.
        hideWhenDetached
        className={cn(
          'kit-menu z-[45] w-max max-w-[92vw] rounded-card border border-line bg-paper-0 p-4 shadow-(--shadow-pop) [transform-origin:var(--radix-popover-content-transform-origin)]',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverClose(props: React.ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent, PopoverClose }
