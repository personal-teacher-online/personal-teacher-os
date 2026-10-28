// AS MEDIDAS DO BALÃO — módulo PURO, e é essa a razão de ele existir.
//
// ⚠️ POR QUE NÃO MORA EM `components/kit/popover.tsx`, que é o dono do balão:
// aquele arquivo é `'use client'`. Constante exportada de módulo cliente e lida
// por um Server Component NÃO chega como valor: chega como referência de
// cliente, e interpolá-la numa string produz literalmente
// `function(){throw Error("Attempted to call TETO_DO_CORPO_DO_BALAO() from the
// server…")}` dentro do `class` do elemento. O estilo simplesmente não existe, e
// nada acusa: o build passa, o `tsc` passa, e o jsdom — que importa o módulo
// direto, sem fronteira RSC — passa também. Só o navegador contra o build de
// produção mostra.
//
// É a MESMA lição do `ehIntencaoDoSlot` (1º achado da 1ª execução real do e2e,
// 30/07, lápide em `src/app/admin/agenda/page.tsx`): o que as duas pontas
// compartilham vive num módulo puro; o componente cliente exporta COMPONENTE.

/**
 * O TETO DO CORPO DE UM BALÃO — `70vh`, e NUNCA mais que o espaço medido.
 *
 * O corpo do balão de aula (a matriz do ADR-018) e o do balão de slot (as três
 * intenções) rolam sozinhos, com teto em `70vh`: o popover vive num portal de
 * posição fixa e a página não rola por baixo dele. Só que `70vh` não sabe QUANTO
 * espaço sobrou entre a âncora e a borda da tela — e o Radix sabe, e escreve
 * (`--radix-popover-content-available-height`).
 *
 * MEDIDO no A9 (30/07, 1ª execução real do e2e): na aula das 03:30 — a primeira
 * do dia, colada no topo da grade — o Radix mediu 408px disponíveis e o balão
 * desenhou 664px. Os últimos 160px, com o botão "Registrar como realizada"
 * dentro, ficavam ABAIXO da borda do monitor, e rolar não os trazia: quem rolava
 * era o miolo, dentro de uma caixa cuja borda já estava fora da tela. A dona
 * abria a aula e não conseguia registrá-la.
 *
 * O `-2.25rem` desconta a moldura do próprio balão (o `p-4` de cima e o de
 * baixo, mais as duas bordas): o teto é do CORPO, e a medida do Radix é da
 * CAIXA.
 */
export const TETO_DO_CORPO_DO_BALAO =
  'max-h-[min(70vh,calc(var(--radix-popover-content-available-height,70vh)-2.25rem))] overflow-y-auto'
