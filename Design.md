# Personal Teacher Academy — Design System "Papel & Tinta"

> Fonte de verdade do design (reescrita na rodada "reconstrução do zero",
> 17/07/2026, branch redesign/zero). Os tokens vivem em `src/app/globals.css`;
> o vocabulário de componentes em `src/components/ui.tsx`. Nunca hardcode hex
> fora do globals.css (exceção: templates de e-mail, que exigem cores inline).

## Direção estética

**Duas superfícies, um app:**

- **Capa noturna (públicas)** — login, recuperar/definir senha: fundo escuro
  `#0a0a0f` com o fog assinatura (campos gaussianos periwinkle/ciano — o shader
  FogGL do login é INTOCÁVEL), painel de vidro, CTA em gradiente
  roxo→turquesa. É a identidade "wow" da marca na porta de entrada.
- **Páginas de papel (internas)** — admin, professora, portal do aluno:
  superfície clara para leitura densa (agenda, listas, fichas), referência
  Google Agenda. A identidade noturna sobrevive na MOLDURA: trilho/faixa de
  navegação em tinta escura (`--ink-900`), logo branco, ecoando a capa.

O que costura as duas: a mesma tipografia, os acentos da marca e os
raios/sombras.

> **PONTE DE COR (Lote 6 · G2, 26/07/2026).** Os tokens `--brand-700` e
> `--brand-600` continuam com o mesmo NOME e o mesmo papel, mas mudaram de
> VALOR: saíram do roxo herdado (`#7E36A3` / `#9333C9`) para a família
> periwinkle martelada em D10 — `--brand-700 = #4A50B5` (o `TEMA.deep`) e
> `--brand-600 = #5A5FC4` (o `CLONE.railBg`). Motivo: as telas ainda não
> reconstruídas só falam `brand-*` e vestiam roxo ao lado do shell novo, que é
> periwinkle. Onde se lê "roxo" abaixo, leia "o acento da marca sobre papel".
> A `PALETA_OFICIAL` não mudou: o roxo `#B35BD9` segue sendo fato da marca na
> CAPA NOTURNA, no fio-assinatura e nos e-mails — o que morreu foi roxo
> vestindo superfície de PAPEL. Sombras (`--shadow-card`/`--shadow-pop`) e
> `--glow-brand` foram retintados junto. Conferido em
> `tests/onda1-fundacoes.test.ts` (§ponte de cor).

**Régua da marca nas internas** (revisada em 19/07/2026 —
item 18 do veredito do e2e, martelo do mantenedor: piloto aprovado, variante B):

- **Fio-assinatura** (`.brand-thread`): o degradê roxo→turquesa que assina o
  topo dos e-mails ecoa na moldura de TODAS as páginas internas — sob a faixa
  de tinta (portal/professora) ou fixo no topo (admin, trilho lateral).
- **Navegação principal ativa = marca**: pill ativa do portal, item ativo do
  trilho do admin e abas da professora em `--brand-700` (`chipBrandOn`).
  Filtros e segmentos utilitários continuam em tinta (`chipOn`).
- **Botões (variante B, régua unificada 23/07)**: **no máximo UM `.btn-brand`
  VISÍVEL por estado de tela = a AÇÃO-MARQUEE** (a que move o trabalho adiante
  quando a tela tem uma; telas com passos/estados alternados — briefing, fábrica
  de slides — podem ter um marquee POR ESTADO, nunca dois simultâneos). No PORTAL, é o CTA-chave do ALUNO (entrar na aula, confirmar presença,
  agendar/remarcar/reservar, e o aceite de boas-vindas — 1ª tela da jornada,
  hallmark audit 19/07). No ADMIN/professora, é a ação-marquee da tela quando
  existe (ex.: "Gerar deck" na fábrica de slides); telas de puro trabalho ficam
  sem `.btn-brand`. As DEMAIS ações são `.btn-ink` (utilitários: criar, salvar,
  publicar) ou `.btn-paper` (secundárias/contorno). (Antes esta régua dizia
  "`.btn-brand` só nos CTAs do aluno; `.btn-ink` no admin" — contradizia as
  telas de slides, que legitimamente usam `.btn-brand` como ação-marquee do
  admin; harmonizado por C4.)
- **Eyebrows do portal** em `--brand-700`; no admin permanecem `--ink-400`
  (superfície densa fica sóbria).
- **Degradê**: nunca em fundo de área de leitura; permitido no fio-assinatura,
  em empty-states/ilustrações e micro-momentos de celebração; a capa noturna
  segue intocada.

## Cores (tokens em globals.css)

### Papel & tinta (internas)
| Token | Hex | Uso |
| --- | --- | --- |
| `--paper-0` | #ffffff | cartões e superfícies de leitura |
| `--paper-50` | #f7f7fb | fundo de página (papel frio, 1 gota de periwinkle) |
| `--paper-100` | #efeff6 | lavagens: hover, inset, célula neutra |
| `--ink-900` | #17141f | texto primário + moldura de navegação (preto arroxeado) |
| `--ink-600` | #4c4859 | texto secundário |
| `--ink-400` | #6d6878 | rótulos/terciário (AA sobre papel) |
| `--line` / `--line-soft` | rgb(23 20 31 / .12 / .06) | hairlines |
| `--brand-700` | #4a50b5 | roxo de link/ação/texto de marca |
| `--brand-600` | #5a5fc4 | roxo de realce (foco, barras de progresso) |
| `--teal-700/600` | #0b7a70 / #0f9488 | turquesa funcional (positivo) |
| `--ok-700` | #16702f | confirmações (pago, realizada, enviado) |
| `--warn-700` | #b8483f | atenção (pendente, vencendo, rascunho) — coral, **nunca âmbar** |
| `--danger-700` | #b32441 | perda/erro (falta, vencido, preso, agora-line) |
| `--ok-wash` / `--warn-wash` / `--danger-wash` | #edf5ef / #faefee / #faedf0 | lavagem das pílulas de ESTADO |

**Régua da lavagem de estado (F1 do c7 + Q1 do c7b).** Onde texto de estado
senta sobre lavagem da MESMA família, a lavagem é hex sólido — nunca alpha.
Com alpha o fundo real é a mistura com a superfície de baixo, então o mesmo par
tem três contrastes: o warn media 4,54:1 sobre `--paper-0`, 4,27:1 sobre
`--paper-50` e 3,98:1 sobre `--paper-100` (dois reprovavam AA, e o teste só
media o primeiro). Sólido, o par medido é o par que se vê: ok 5,57:1 ·
warn 4,62:1 · danger 5,68:1. Alpha segue legítimo em BORDA e em cartão de
aviso com texto de tinta (`bg-warn-700/5 text-ink-900`) — ali o par é outro.

### Cor por professora (matiz BEM separado; índice = dona primeiro, depois alfabético)
| Índice | fill (bloco sólido, texto branco) | tint (fundo suave) |
| --- | --- | --- |
| 0 — a dona | `--t0-fill` #7c3aa8 (roxo) | #f3e9fa |
| 1 — a professora | `--t1-fill` #0b7a70 (verde-água) | #e4f4f2 |
| 2 | #4756ca (índigo) | #eaecfb |
| 3 | #a21caf (fúcsia) | #f9e8fb |
| 4 | #2050c8 (azul) | #e8eefb |

### Cor por NÍVEL (M3-c1 · C2) — a escala sobe com o aluno
Etiqueta de nível não é estado: é ESCALA. Quanto mais avançado, mais evidente.
Uma família por banda do CEFR; os `+` da Flexge herdam a banda do prefixo
(A1+ é A1, A2+ é A2…). Tokens `--nivel-<banda>-bg` / `--nivel-<banda>-fg`.

| Banda | fundo | texto | família / porquê | AA |
| --- | --- | --- | --- | --- |
| sem nível | `--paper-100` | `--ink-600` | ausência de dado, não degrau | 7,71 |
| Pre A1 · A1 (+) | #e6f4f9 | #137695 | azul-céu (o `--fog-cyan` da marca): calma, começo | 4,61 |
| A2 (+) | #ceecf4 | #10647f | mesma família, um degrau mais fundo | 5,37 |
| B1 (+) | `--ac2-tint` | `--ac2-deep` | turquesa (2º acento): progresso, clareza | 4,65 |
| B2 (+) | #c7f2f1 | `--ac2-deep-hover` | idem, um degrau mais fundo | 5,53 |
| C1 | `--ac-tint` | `--ac-deep` | periwinkle: a voz do sistema | 5,86 |
| C2 | #7e36a3 | branco | roxo da marca, **SÓLIDO** — o único da escala: maestria | 7,13 |

Regra: aula agendada = bloco SÓLIDO na cor da professora com texto branco
(estilo Google Agenda); realizada = tint + ✓; janela de remarcação = borda
tracejada na cor + tint; falta/sem registro = lavagem `danger`.

**Marcadores de tempo:** círculo de "hoje" = tinta (`--ink-900`); linha do
"agora" = `--danger-700` (convenção Google). NUNCA turquesa (colidiria com a
cor da professora).

**Regra geral (S2-5, e2e 19/07; refinada 23/07):** matizes FUNCIONAIS — âmbar
(warn), rosa-vinho (danger), verde (ok) — são EXCLUSIVOS de estado; a paleta de
professoras nunca os usa (o âmbar do índice 2 confundia professora com
pendência). Brand (roxo) é diferente: além de estado, também identifica AÇÃO,
NAVEGAÇÃO e FOCO — somente `--glow-brand` permanece exclusivo de estado (ver
§Realce de interação). Exceções herdadas e conscientes na paleta de professoras:
t0 roxo (a dona É a marca) e t1 verde-água (regra do marcador acima protege).

### Glow por estado (S2-4, e2e 19/07)

Tokens `--glow-brand` / `--glow-warn` / `--glow-danger` (globals.css). Glow
NUNCA é decoração — é ESTADO, com intensidade fixa nos tokens (nada ad-hoc;
o brilho mora na sombra, nunca no texto):

- `--glow-warn` / `--glow-danger`: pendência que pede ação — KPIs com
  contagem > 0 (aviso NÃO ENVIADO = danger), chip "Pendências · N" da agenda,
  crédito vencendo em <15 dias (card da home do portal).
- `--glow-brand`: o destaque VIVO da tela — máximo 1 por tela ("A seguir" no
  admin/professora, "Sua próxima aula" no portal). `.btn-brand:hover` usa o
  realce de interação, nunca `--glow-brand`; a classe do botão, sozinha, não
  constitui estado (ver §Realce de interação).
- Neutro: cartão comum fica hairline + sombra tintada, como sempre.

### Realce de interação (D1 — emenda de 23/07/2026)

O dono decidiu dar VIDA às internas: hover de card, trilho de navegação vivo,
micro-transições. Para isso conviver com o glow de estado sem apagar a semântica
de alerta, o realce é um canal SEPARADO e COMPOSÁVEL — um cartão pode mostrar os
dois ao mesmo tempo (alerta + resposta ao toque) sem um engolir o outro.

**Dois canais, um cartão:**

- **Glow de ESTADO** (§acima, intocado): `--glow-warn` / `--glow-danger` /
  `--glow-brand` via `box-shadow` semântico, intensidade fixa, nunca decorativo.
  Diz O QUE o cartão é (pendência, perda, destaque vivo).
- **Realce de INTERAÇÃO** (novo): só em elementos ACIONÁVEIS (card clicável,
  linha com ação, botão, aba) e só no hover/focus. Canal visual DISTINTO do
  box-shadow semântico — **elevação NÃO SEMÂNTICA, tintada de marca**
  (`--shadow-pop`, a mesma sombra dos pop-ups) **+ borda/anel na cor da marca**
  (`--brand-600`). Diz "isto responde ao toque", não um estado. NÃO usa os tokens
  `--glow-*` — por isso a lei "glow é estado, nunca decoração" continua de pé.

**Regras (invioláveis):**

- **O canal de interação nunca ACRESCENTA warn/danger — mas não REMOVE estado
  preexistente.** Hover/focus jamais introduz matiz âmbar (warn) ou rosa-vinho
  (danger): esses são exclusivos de estado (regra S2-5 refinada). O realce usa
  elevação + marca. E o estado que já estava lá permanece durante o hover (ver
  regra seguinte).
- **O estado sobrevive ao hover, sem substituição.** Um card com `--glow-danger`
  sob o cursor mostra os DOIS: o anel danger (alerta) E a elevação não semântica
  + anel `--brand-600` (realce). Estado e elevação devem ser CONCATENADOS numa
  única lista de `box-shadow` OU separados por pseudo-elemento — o estado NUNCA
  pode ser sobrescrito. Aceite: o `box-shadow` COMPUTADO do card danger em hover
  contém as duas camadas.
- **Matriz por categoria (normativa)** — a receita muda conforme o alvo:
  - Card cuja ÁREA INTEIRA é `<a>`/`<button>`: `--shadow-pop` + borda `--brand-600`.
  - Linha clicável: indicador inset (background/barra), SEM elevação.
  - Botão/aba: receita própria de background/borda, SEM `--shadow-pop`.
  - `focus-visible`: outline obrigatório, SEM segundo anel brand.
  - Card que apenas CONTÉM um link isolado NÃO é acionável como superfície (não
    ganha realce de superfície; o realce mora no link).
- **Cartão comum ganha só realce de interação, nunca glow.** Neutro em repouso =
  hairline + `--shadow-card`; neutro ACIONÁVEL no hover = conforme a matriz acima.
- **`focus-visible` mantém o outline de acessibilidade** (`--focus-ring`, =
  `--brand-600`): o anel de foco é a garantia de teclado e NUNCA é substituído por
  sombra, nem duplicado por um segundo anel de marca.
- **Ponteiro e disponibilidade:** hover só sob `@media (hover:hover) and
  (pointer:fine)`; em ponteiro coarse (toque), `:active` usa a pressão global e
  PRESERVA qualquer glow de estado; `:disabled`, `[aria-disabled="true"]` e
  `[data-pending]` NUNCA recebem realce; teclado usa `:focus-visible`. (Sem
  cláusula própria de reduced-motion — a regra universal já congela a animação.)
- **Easings e durações (NOMEADOS):** usar só os easings nomeados — `--ease-out`
  (entrada/hover), `--ease-in-out` (transições simétricas); nunca o `ease` default
  do browser. Durações nomeadas do contrato: `--duration-press: 60ms`,
  `--duration-hover: 150ms`, `--duration-enter: 200ms` (a largura do trilho e o
  delay de revelação do rótulo usam `--duration-hover` — precedente do M-A: o
  rótulo aparece só APÓS a transição de largura, delay atrelado à duração, não a
  número solto). A CRIAÇÃO dessas variáveis CSS é M-EF-b; aqui o contrato só as
  nomeia.
- **Trilho do admin (Lote 6 · G1, 26/07/2026):** o drawer de 265px tem cadência
  PRÓPRIA, em variáveis nomeadas — `--duration-drawer: 300ms`, `--ease-drawer:
  cubic-bezier(0.2, 0, 0, 1)` (desaceleração franca), `--delay-drawer-close:
  180ms` (cortesia: passada de mouse não fecha o drawer) e `--duration-rail-fade:
  110ms`. Duas camadas nunca aparecem juntas: com o drawer aberto os ícones do
  TRILHO apagam (`.rail-icons`), e na volta só reacendem depois de o drawer ter
  saído inteiro (`--delay-rail-back` = cortesia + duração). É opacidade e nada
  mais — os links do trilho seguem clicáveis e focáveis o tempo todo. Sob
  `prefers-reduced-motion` os ATRASOS zeram (a regra universal só zera durações).

#### Barra de progresso de navegação — ciclo de vida (contrato)

`#nav-progress` (globals.css) já anima 0→95% enquanto `html[data-navigating]`
está setado (controlada por `ClickFeedback`). Este contrato fixa QUANDO ela vive,
restrito ao que é OBSERVÁVEL no App Router (não há `router.events`; `push`/`replace`
retornam `void`); a **implementação é o M-EF-b**.

- **Inicia** em: clique de `Link` para rota interna (via `onNavigate`) e navegação
  imperativa — que DEVE passar por um wrapper `useTrackedRouter` (M-EF-b cria); o
  uso direto de `useRouter().push`/`replace` é PROIBIDO (sem o wrapper, a barra
  não enxerga a navegação). Back/forward entram pelo mesmo commit observável.
- **NÃO inicia** em: âncora/hash na mesma página, `target="_blank"`/nova aba,
  download, URL externa, ou navegação cuja URL FINAL é igual à atual — nada disso
  troca o shell.
- **Conclusão OBSERVÁVEL = primeiro commit que altere `pathname`/`search`** (o
  shell da rota nova renderizou), NÃO o fim do streaming/Suspense. A barra some com
  a navegação confirmada, mesmo que o conteúdo ainda esteja carregando por baixo.
- **Navegação supersedente reinicia** a barra para a mais recente (uma nova
  navegação no meio da anterior assume o lugar).
- **Falha sem commit** é limpa por um **watchdog nominal de duração fixa** — a
  barra nunca fica órfã, presa em 95%.

> **Nota (D1, 23/07/2026):** esta emenda é decisão do dono (D1 do lote 23/07) e
> SUPERA, no ponto de dar vida às internas, o congelamento de paleta de
> `qa/auditoria-navegacao-2026-07.md` ("nada de mudança de cor agora"). O realce
> usa canal não semântico+marca, não repinta estado — por isso NAV-6/NAV-10
> (repinturas de estados de navegação existentes) seguem ADIADOS e NÃO são
> reabertos por aqui. **M-EF-b deve atualizar o CSS do `.btn-brand:hover`
> (globals.css) para o realce de interação — o CSS atual (`--glow-brand` no hover)
> implementa o contrato ANTIGO.** O contrato da barra e do realce é CONSUMIDO por
> M-AG (agenda).

### Capa noturna (públicas)
`--bg-900/800/950`, `--fog-periwinkle #8488d9`, `--fog-cyan #48bed9`,
`--accent-purple #b35bd9`, `--accent-turquoise #2bd9d9`, `glass`, `btn-cta`,
`--night-danger #f26d8d` (caixas de ERRO das públicas — a marca nunca veste
erro; antes usavam `accent-purple/10`). Refinos do hallmark audit (19/07/2026):
`btn-cta` com degradê ESTÁTICO (hover = elevação: translate + sombra; nada de
degradê deslizando), glow tintado curto escoltado por sombra escura, e easings
nomeados (`--ease-out`/`--ease-in-out`) — UI interativa nunca usa o `ease`
default do browser. O fog/FogGL segue INTOCÁVEL.

## Tipografia

- **Display:** Bricolage Grotesque (`font-display`) — títulos e NÚMEROS
  grandes. Extremos de peso de propósito: `font-extralight` (200) nos números
  de destaque (KPIs, hora da próxima aula, saldo) × `font-bold` (700/800) nos
  títulos. Saltos de escala ~3× (ex.: 12px rótulo × 36–48px número).
- **Corpo:** Hanken Grotesk (`font-sans`) — 14–15px, `font-semibold` para
  ênfase.
- **Mono:** JetBrains Mono (`font-mono`) — SÓ horários (HH:mm) e valores
  monetários em tabelas (`tabular-nums`). Nunca para texto corrido.
- Rótulos de seção: 10–11px, `font-bold`, `uppercase`, `tracking-wide` — brand-700 no portal, ink-400 no admin/professora.
- Proibido: Inter/Roboto/Arial/system fonts.

## Forma

- Raios PROPOSITALMENTE desiguais: cartão 14px (`rounded-card`), input 10px
  (`rounded-input`), chip/célula 6px (`rounded-chip`), pill 999
  (`rounded-pill`).
- Sombras tintadas de tinta/roxo (`--shadow-card`, `--shadow-pop`) — nunca
  cinza 0.1 chapado. Hairlines fazem a maior parte do trabalho de separação.
- Botões: primário utilitário = `.btn-ink` (tinta sólida, hover roxo);
  ação-marquee da tela (máx. 1) = `.btn-brand` (roxo da marca — régua na
  Direção estética: no portal o CTA do aluno, no admin a ação que move o
  trabalho); secundário = `.btn-paper` (contorno). O gradiente `.btn-cta` é
  da capa noturna.
- Pills de estado (componente `Pill`): ok/warn/danger/brand/neutral/muted.

## Organização em blocos

Quando uma lista passa de ~10 itens HETEROGÊNEOS (formatos, níveis, professoras
e módulos misturados), quebrá-la em blocos por um eixo dominante devolve leitura
sem paginar nem exigir mais filtro. Abaixo disso, lista corrida basta — não
inventar blocos.

- **Um eixo dominante por tela** — o que o olho procura primeiro ali: formato /
  professora / nível / módulo. Contratos agrupam por professora ou nível;
  conteúdo por formato; a grade de slides por módulo.
- **Cabeçalho = `SectionTitle` + CONTAGEM do bloco.** A contagem é metadado, pode
  ser `text-xs`/`text-ink-400`.
- **Bloco vazio não renderiza** (`.filter(g => g.itens.length > 0)`) — nunca
  cabeçalho órfão sobre lista vazia.
- **Buckets residuais SEMPRE POR ÚLTIMO**, rotulados sem culpa: "sem nível",
  "Sem professora", "avulsas" (leitura NULL-tolerante, ADR-024). Ordena-se o eixo
  pela sua ordem natural (alfabética da professora em `pt-BR`, escala
  `FLEXGE_LEVELS` para nível, ordem fixa de formato) e o residual cai no fim via
  chave sentinela (`__sem__`).
- **O cabeçalho usa a IDENTIDADE do eixo**, não texto solto: cor da professora
  (bolinha `TEACHER_FILL` + `TEACHER_TEXT`), `Pill` de nível, rótulo de formato.
  Com o cabeçalho falando o eixo, a coluna/sublinha redundante do mesmo dado sai
  do cartão (M-D removeu "Formato" das linhas).
- **Modos alternativos por querystring.** Quando a mesma lista serve a mais de um
  recorte, os modos são LINKS `?ver=` com chips no padrão `chipHref`/`chipHrefVer`
  (nunca estado de cliente — §Padrões de interação). Os eixos de URL são
  ORTOGONAIS e se preservam mutuamente: situação (`st`) × busca (`q`) × modo
  (`ver`) coexistem; cada chip reescreve só o seu e carrega os demais (o form de
  busca leva `st`/`ver` em `hidden`). O modo padrão ("Lista") não escreve na URL.
- **Agrupar age DEPOIS de filtrar.** Situação e busca já reduziram `rows`; o
  agrupamento só particiona e ordena o que sobrou — nunca reintroduz item
  filtrado dentro de um bloco.

**Réguas de card em lista.**

- **Altura estável com ação condicional:** `min-h` no item (`min-h-14` na home,
  `min-h-11` em chips) para a presença/ausência do botão não pular a linha
  (precedente C1: Tomás com "registrar" × Estevão sem, mesma altura).
- **Ação não é letra miúda:** link/botão de ação no mínimo `text-sm`; `text-xs`
  fica reservado a METADADO (contagem, índice, timestamp) — precedentes C1
  ("ver a semana", rótulo do `Actions`), M-D ("abrir →"), M-E (metadados
  rebaixados; mono só código/hora/dinheiro).

> Proveniência: esta seção nasce do lote 23/07
> (`docs/goals/lote-2026-07-23-organizacao-marca-fabrica.md`, itens C1/C3/M-D/M-E).

## Padrões de interação

- Server-first, CSS-only: popups são `<details data-popup>` (PopupManager
  fecha no clique-fora), visões/filtros são links. Zero estado de cliente fora
  de navegação (usePathname) e máscaras de campo.
- Ações de dinheiro/registro: confirmação em 2 passos (`ConfirmAction`) ou
  passo de revisão em página (remarcar/resgatar/mentoria do aluno); nas
  destrutivas grandes (encerrar contrato, anonimizar), type-to-confirm.
- **Painel lateral (S2-10/S2-14, padrão TutorBird):** ação com FORMULÁRIO ou
  3+ campos abre à direita, nunca inline nem popup denso — `Drawer`
  (`<details>`, para ações por linha) ou `SidePanel` (aberto por estado de
  URL `?painel=…`, fecha por link; usado por criar contrato/aluno/professora,
  convite, pagador, anonimizar, vigência, extrato, encontro, régua, rascunho
  e aula avulsa). Ação de 1 clique continua em popup pequeno (`Actions`).
- Formulários: `Field` com rótulo explícito; flash pós-ação via `?msg=`
  (`FlashMsg` — tom decidido pelo prefixo "Falha").
- Feedback de clique global: pressão tátil, spinner de envio, trava de duplo
  clique, barra de progresso de navegação (ciclo de vida contratado em §Realce
  de interação; implementação em M-EF-b).
- Toque ≥44px no celular (chips `min-h-11 sm:min-h-9`, setas 44→32px).
- `prefers-reduced-motion` congela TODA a animação (regra universal).

## Linguagem

- pt-BR humano, voz da escola: acolhedor, frases curtas, zero jargão técnico.
- **Nunca** na interface: datas ISO, nomes IANA crus ("America/Cuiaba"),
  nomes de template ("class-reminder"), termos internos ("bridge", "outbox").
- Fusos sempre como cidade: `tzLabel()` em `src/lib/format.ts` ("Cuiabá",
  "Nova York"); horas do aluno como "15:30 (horário de Cuiabá)".
- Dinheiro via `fmtBRL` (centavos → R$); datas via `fmtLocal`/`fmtCivilDate`.
- "gerir" não existe (pt-PT) — usar "abrir", "opções", "gerenciar".
- Emojis não são ícones (ícones = lucide-react); emoji só como pontuação
  afetiva rara em mensagens ao aluno.
- **Régua de tom por contexto** (o mantenedor, 18/07/2026 — veredito do e2e,
  itens 9/21/22): erro, segurança e PERDA (convite expirado, senha,
  cancelamento em cima da hora, falhas) = registro FORMAL, zero emoji e zero
  gíria ("já era", "novinho" não existem). Mensagens transacionais positivas
  (lembrete, confirmação, boas-vindas) = no máximo **1 emoji funcional**.
  Toda mensagem se APRESENTA ("Lembrete: …", "Confirmando: …") — o leitor
  entende sem contexto. Mecânica interna nunca vaza: nada de "(no seu
  horário)", "franquia", "remarcação automática", "o mais antigo".
- **Voz do portal**: o app fala COM o aluno — títulos e rótulos em
  "Sua/Seu" ("Suas aulas", "Seu perfil", "Seus créditos"); "Minha/Meu" não
  se usa. Fuso só aparece na EXCEÇÃO (aviso quando o offset do navegador
  diverge do cadastro — componente `TzMismatch`); nas telas do ADMIN os
  rótulos de fuso PERMANECEM (ferramenta de operação da dona).

## Navegação

- **Admin:** desktop = trilho lateral de tinta (grupos: principal + Gestão;
  rodapé: painel de professora + sair); celular = barra superior compacta +
  barra inferior de polegar (Início/Agenda/Alunos/Avisos/Mais).
- **Professora:** faixa de tinta no topo + abas (Agenda/Aulas/Alunos/Extratos/Conta).
- **Portal:** faixa de tinta no topo + abas (Início/Aulas/[Mentoria]/Pagamentos).
- Janelas de remarcação moram DENTRO da agenda do admin (camada "Horários
  abertos", ligada por padrão; publicar via clique na meia-hora vazia ou chip).

## E-mails e WhatsApp

Mesma voz e mesmas datas humanas da interface (Luxon pt-BR no fuso do
DESTINATÁRIO — aluno no fuso dele, professora no dela). Templates em
`src/lib/email/`; cores inline derivadas da marca (limitação dos clientes).
