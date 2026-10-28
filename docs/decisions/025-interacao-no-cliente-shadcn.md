# ADR-025 — Interação no cliente: server-first nos DADOS, cliente na INTERAÇÃO

**Data:** 24/07/2026 · **Decisor:** O mantenedor (insatisfação declarada com UI/UX)

## Contexto

Depois de 7 levas de correção, um hallmark audit e 48+ itens de e2e registrados,
o dono declarou insatisfação **geral** com a UI/UX do site: paleta ("onde está
cada cor"), animações e efeitos, e a disposição dos cards. As levas anteriores
melhoraram dentro de um teto — não moveram o teto.

O diagnóstico de 24/07 localizou o teto **fora** da linguagem visual: ele está na
doutrina escrita em `Design.md` §Padrões de interação — *"Server-first, CSS-only
… Zero estado de cliente fora de navegação e máscaras de campo"* — e ecoada no
cabeçalho de `src/components/ui.tsx` (*"Server-safe, zero client JS"*). O que a
doutrina produz, medido no código de hoje:

- **Toda mutação é PRG**: 16 `actions.ts`, todos terminando em `redirect()`;
  `revalidatePath`/`revalidateTag`: **0 ocorrências**. Nada atualiza no lugar —
  cada ação re-renderiza a rota inteira e reseta scroll, foco e estado de form.
- **Abrir um painel é uma navegação**: `SidePanel` abre por `?painel=…`, então
  abrir um formulário na ficha do aluno re-executa os ~10 `await` da página.
  Filtros e visões também são links, por contrato.
- **Overlays sem semântica de diálogo**: `Drawer`, `Actions` e `ConfirmAction`
  são `<details>`; `SidePanel` é um `div` fixo. Zero `<dialog>`/`showModal`/
  `inert` no repositório — sem focus trap, sem Esc, sem devolução de foco, sem
  scroll-lock, sem animação de entrada/saída (um `<details>` é liga/desliga).
- **Feedback de mutação = 1 string na URL** (`?msg=`, tom por regex do prefixo
  "Falha"), sem erro por campo; o aparato de nonce em ~28 redirects existe para
  esse canal não re-disparar no refresh.
- **Primeiro paint all-or-nothing**: 1 `loading.tsx` global, nenhum por
  segmento, `Suspense` só no root com `fallback={null}`.

As referências que o dono usa como régua (Google Agenda, TutorBird) são
aplicações ricas de cliente. A doutrina atual **proíbe estruturalmente** chegar
nesse comportamento: drag, edição inline, busca instantânea, undo e atualização
otimista não são alcançáveis sem estado de cliente. React 19 e Next 16 já estão
no `package.json` com as ferramentas necessárias (`useOptimistic`,
`useActionState`, `useFormStatus`): **0 usos**.

Um segundo achado: o `CLAUDE.md` declara **shadcn/ui** como stack fixo, mas ele
**nunca foi instalado** — não há Radix, `class-variance-authority`, `clsx`,
`tailwind-merge` nem `components.json` no repositório; `ui.tsx` é um vocabulário
manual de ~15 peças em 282 linhas. Não existem `Table`, `Tabs`, `Toolbar`, `KPI`
nem `FormRow`, e por isso cada página-monólito (ficha 887 linhas, agenda 839,
professora 820, contratos 814) re-desenha tabela, toolbar e card com strings
Tailwind próprias. As réguas do `Design.md` são prosa; nada as força.

## Decisão

1. **Server-first nos DADOS, cliente na INTERAÇÃO.** Leituras continuam em
   Server Components; mutações continuam por Server Actions chamando as funções
   RPC do Postgres. **Nenhuma regra de negócio migra para o cliente** — a Lei 3
   segue intacta, e o cliente nunca decide saldo, capacidade, alçada ou fuso.
   Passa a ser permitido estado de cliente para: overlay, formulário (pendência,
   erro por campo), atualização otimista local e transição.
2. **shadcn/ui (Radix) instalado de verdade** — cumprimento do stack já
   declarado, não mudança de stack. Os tokens **Papel & Tinta são a fonte**: as
   variáveis semânticas do shadcn derivam dos nossos tokens, nunca o contrário, e
   os primitivos copiados são adaptados à nossa escala de raio/sombra/cor (nada
   de escala paralela).
3. **Progressive enhancement onde couber**: formulário continua funcionando sem
   JS (Server Action como `action` do `<form>`); o cliente acrescenta pendência,
   erro por campo e otimismo.
4. **A APLICAÇÃO visual é reaberta** — distribuição de cor, anatomia de card,
   densidade, espaçamento e motion voltam à mesa. Os *valores* dos tokens não são
   descartados por decreto: o instrumento de decisão é o **piloto do portal com
   variantes visuais**, e o martelo é do dono. `Design.md` é **reescrito depois
   do martelo**; até lá vale como histórico e, onde conflitar com este ADR, este
   ADR vence. A regra que motivou isso: o `Design.md` acumulou **regra demais em
   prosa e execução de menos em componente** — a fonte da régua passa a ser o
   código dos primitivos.
5. **Escopo: superfícies INTERNAS** (admin, professora, portal). A capa noturna
   das públicas (login, recuperar/definir senha) e o `FogGL` ficam **fora** deste
   ADR e seguem intocados até decisão específica do dono.
6. **Ordem de conversão** (uma onda por lote, cada uma com portão humano):
   fundação → piloto do portal → resto do portal → professora → admin (agenda por
   último das grandes) → `/admin/slides` por último de todos, porque há sessão
   paralela trabalhando nos motores de slides.

## Consequências

- **A a11y de overlay deixa de ser inexistente**: focus trap, Esc, `inert` no
  fundo, devolução de foco ao gatilho e scroll-lock passam a vir do primitivo, em
  todas as telas de uma vez.
- **O bundle de cliente cresce.** Aceito: as leituras seguem em RSC e o
  crescimento é por ilha, não por página.
- **O aparato de `?msg=` + nonce nos ~28 redirects se dissolve** conforme as
  telas convertem, e a decisão de tom por regex do prefixo "Falha" morre com ele.
- **`PopupManager` permanece** enquanto existir `<details data-popup>` fora das
  peças convertidas (hoje: `AdminNav`, `CalendarGrid`, `CountryPhoneField`,
  `agenda/pieces`). Ele só se aposenta quando o último sair.
- **Risco novo: regressão silenciosa** em tela sem cobertura. Por isso o lote de
  fundação entrega o harness de smoke (Playwright + axe) **antes** de mexer nas
  peças compartilhadas por 42 arquivos.
- **Custo**: ~52 arquivos / 11,5k linhas de front convertidos por ondas. O motor
  não muda: **zero migration** nesta linha de trabalho, e nenhuma Lei é tocada.
- Este ADR cobre a onda inteira — **não** se escreve um ADR por tela. Desvio da
  doutrina aqui fixada (mover regra para o cliente, abandonar progressive
  enhancement num fluxo crítico, introduzir escala paralela de tokens) exige ADR
  próprio.
- O congelamento de paleta de `qa/auditoria-navegacao-2026-07.md` e a emenda D1
  (23/07) ficam **superados no ponto da aplicação visual**: a distribuição de cor
  volta a ser decidível pelo dono no piloto.
