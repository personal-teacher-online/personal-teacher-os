# ADR-024 — Fábrica de Slides serve QUALQUER aula, não só o Personal Travel

**Data:** 23/07/2026
**Status:** aceito (decisão do dono, 23/07) — **DORMENTE**: governa trabalho futuro,
não muda código nem banco neste lote (M-G entrega só este ADR). Revisado após rodada
adversarial (Sol, 23/07): 6 achados incorporados — a Opção A quebrava mais consumidores
do que o primeiro rascunho enxergava, e a correção deles está fixada abaixo.

## Contexto

A Fábrica de Slides nasceu amarrada ao curso Personal Travel (Hotmart). O amarre é
literal e espalhado por seis consumidores:

- **Banco** (`supabase/migrations/20260721000100_fabrica_slides.sql:19-40`):
  `slide_lessons.course` tem `default 'personal-travel'`, `module int not null check
  (module between 1 and 12)`, `lesson int not null check (lesson between 1 and 9)` e
  `unique (course, module, lesson)`. A RPC `slide_lesson_create` (linha 184) exige os três.
- **Seed idempotente** (`scripts/slides/seed-course.ts:121-123`): `insert ... on conflict
  (course, module, lesson) do nothing` — depende da tripla ser a chave única.
- **Schema TS** (`src/lib/slides/lesson-schema.ts:217-231`): `course: z.literal('personal-travel')`
  (linha 218), `module.number` 1–12, `lesson.number` 1–9, e `level: z.enum(['A0','A1','A2'])`.
- **Conteúdo/renderer** (`src/lib/slides/build.ts:20` gera o código `M${módulo}A${aula}`;
  `src/lib/slides/template.ts:221,371` imprimem literalmente `PERSONAL TRAVEL — MODULE …`).
- **Criação/rascunho** (`src/app/admin/slides/actions.ts:29-34` e
  `src/lib/slides/draft.ts:95,112`): ambos hardcodam `course: 'personal-travel'`.
- **Endereço de imagem** (`src/lib/images/slots.ts:56` — `slotsDeImagem(doc)` só recebe o
  `LessonDoc`; `resolve.ts:65` exige `pasta/nome.ext`; `fonte.ts:20-28` aceita `course?` mas
  **cai em 'personal-travel'** por default): derivado `m{módulo}/a{aula}-{tipo}`.

Há ainda uma **deriva de níveis** já viva: `src/app/admin/alunos/actions.ts:13` só aceita
6 níveis (`A1,A2,B1,B2,C1,C2`), enquanto `students.level` já tem os 11 Flexge.

O dono decidiu (não reabrir): a Fábrica deve servir a **qualquer aula da dona**,
inclusive **aula particular avulsa** montada a partir do que o sistema já sabe do aluno
(briefing/Kolb, `study_plans`/`study_plan_items` por contrato —
`supabase/migrations/20260720000300_study_plans_e_apontamento.sql:23-54`). O foco
comercial imediato segue nos decks dos módulos; a **implementação** da generalização é
lote futuro. Este ADR fixa o modelo para que M-E/M-F não cimentem nada que o contradiga.

## Opções consideradas

**(A) Mesma tabela, `course` vira "coleção" + `module`/`lesson` anuláveis + vínculo a contrato.**
`course` já é `text` livre (`check btrim(course) <> ''`) — 'personal-travel' passa a ser
UMA coleção entre outras. `module`/`lesson` deixam de ser NOT NULL; a aula avulsa fica NULL e
sua identidade é o `id` uuid (já PK) + `contract_id` opcional.
- Prós: a aula existente é caso particular do modelo geral — **zero migração de dados** (Lei 7);
  reaproveita o maquinário (gate de status, RLS, pipeline de deck, editor).
- Contras: enfraquece o invariante "toda aula tem módulo/aula" e toca vários consumidores
  (índice único, seed idempotente, união do conteúdo, renderer, resolvedor de imagem). Cada um
  tem correção contida (§Decisão) — não vira reescrita.

**(B) Tabela irmã para aulas avulsas.**
- Prós: constraints rígidas do Personal Travel intactas; separação limpa.
- Contras: **duplica tudo** — gate, RLS, colunas de deck, RPCs, editor, `draft.ts`, slots de
  imagem — e cria um fork de manutenção. Gold-plating para 50 alunos (Lei 5). **Rejeitada.**

**(C) Só generalizar a `unique key`.**
- Prós: menor diff possível.
- Contras: não dá identidade à aula avulsa sem **inventar módulo/aula falsos**, poluindo a
  numeração do Personal Travel e o endereço de imagem. Pior que (A). **Rejeitada.**

## Decisão

Escolhida a **Opção (A)**. Quando a generalização for implementada (lote futuro, migration NOVA):

1. **Identidade e chave.** `course` = slug de COLEÇÃO (sem rename; 'personal-travel' segue o
   default). `module`/`lesson` passam a `NULL`-áveis, com `check ((module is null) = (lesson is
   null))` — nunca uma só das duas. A **tripla `(course, module, lesson)` continua chave única
   SÓ das aulas sequenciadas**, via índice único PARCIAL `where module is not null and lesson is
   not null`; a aula avulsa se identifica pelo `id` uuid. O CHECK de `module` deixa de travar em
   1–12 (`module is null or module >= 1`). Adicionar `contract_id uuid references contracts(id)`
   **nullable**. ⚠️ **Todo `ON CONFLICT` que mira a tripla repete o predicado do índice parcial**
   (`... where module is not null and lesson is not null`) — sem isso o seed
   (`seed-course.ts:121-123`) para de casar; a criação avulsa **não** deduplica por natural key,
   e sim por `id` do chamador (ver ponto 2).
2. **Criação (API esboçada, NÃO implementar).** A migration futura **derruba explicitamente a
   assinatura antiga** da RPC e recria com:
   `slide_lesson_create(p_title text, p_course text default 'personal-travel', p_module int
   default null, p_lesson int default null, p_contract_id uuid default null, p_content jsonb
   default '{}'::jsonb, p_id uuid default null)`.
   A criação avulsa **recebe `p_id` (uuid) do CHAMADOR** e dedupe por `on conflict (id) do
   nothing` — repetir o mesmo `p_id` é idempotente (substitui a natural key que a avulsa não tem).
   As chamadas do Personal Travel omitem `p_id` (o banco gera) e seguem idênticas.
   E `draftLesson(opts)` (`draft.ts`) ganha `contractId?` opcional: quando presente, o servidor
   resolve `students.level`, estilo Kolb + briefing e os `study_plan_items` do contrato como
   INPUT do prompt, em vez de `module`/`lesson` fixos.
3. **Conteúdo — união, não afrouxamento.** `LessonSchema` hoje exige curso/módulo literais
   (`lesson-schema.ts:218`) e o renderer imprime `M{n}A{n}`/"PERSONAL TRAVEL"
   (`build.ts:20`, `template.ts:221,371`) — uma linha com coordenadas NULL seria **impossível de
   aprovar/gerar**. A implementação futura cria uma UNIÃO
   `LessonContent = LegacyPersonalTravelSchema | StandaloneLessonSchema`:
   - **Ramo legado INTOCADO** — mesmo shape, mesmo renderer, mesmo código `M{módulo}A{aula}`.
   - **Ramo avulso** — título obrigatório, coordenadas nulas, código neutro `AV-{id8}` (do uuid).
   - O gate valida **o ramo compatível com a identidade da linha** (módulo presente ⇒ legado;
     ausente ⇒ avulso). Conteúdo aprovado **nunca** é reescrito (Lei 8).
4. **Endereço de imagem — namespaces independentes.** Endereço lógico da cena avulsa:
   `avulsa/{id8}-{tipo}`; a referência persistida em `LessonDoc.image.file` **inclui a extensão
   da candidata aprovada** (`resolve.ts:65` exige `pasta/nome.ext`). `slotsDeImagem` passa a
   receber `{ doc, lessonId, course }` (hoje só `doc` — `slots.ts:56`); a geração passa
   `course: row.course` à fonte (hoje `fonte.ts:20-28` cai em 'personal-travel' por default).
   **Cena-por-aula** (`m{módulo}/a{aula}` legado + `avulsa/{id8}` novo) e **vocabulário-por-
   `anchor_id`** (M-H2, opaco, nunca derivado do texto) são **NAMESPACES INDEPENDENTES**: o M-H2
   **não** implementa o de cena. A resolução dual que o M-H2 já prevê (legado + âncora) acomoda o
   caso avulso sem retrabalho.
5. **Nível — fonte de verdade = `curriculum_tracks.level` (catálogo), NÃO o CHECK.**
   Escolhido o catálogo (`supabase/migrations/20260720000200_curriculum_tracks.sql:10`,
   `level text not null unique`, 11 níveis semeados) em vez do CHECK de `students.level`
   (`20260720000300:16-18`): acrescentar um nível novo com CHECK exige migration dupla; com
   catálogo/FK é 1 insert — e a deriva já existe (`alunos/actions.ts:13` aceita só 6). Na
   generalização, o CHECK de `students.level` **vira FK nullable `students(level) →
   curriculum_tracks(level)`**; UI e M-F **leem do catálogo**; as constantes TS passam a ser
   **espelho/parser** do catálogo e **substituem os conjuntos locais** (o `NIVEIS` de 6 níveis
   sai). São 11 níveis iniciais hoje; a fonte é o catálogo, não um enum recopiado.
6. **Destino no Drive.** Personal Travel segue em `PT_SLIDES_FOLDER_ID`; a coleção avulsa usa
   **uma única** `AVULSA_SLIDES_FOLDER_ID`, no mesmo Drive compartilhado; atualização por
   `deck_drive_file_id` no arquivo existente. `contract_id` é **PROCEDÊNCIA, não autorização** —
   a RLS segue **admin-only** e o gate é o mesmo; acesso de professora/aluno é decisão separada
   e futura.

## Consequências

- Julho segue igual: 35 aulas M6–M12 e o deck do M6A1 em produção não mudam nada (Lei 7);
  o ramo legado do conteúdo, o renderer e o endereço `m{módulo}/a{aula}` ficam idênticos.
- Qualquer migration desta generalização é **nova** (Lei 7); nada aqui edita a `20260721000100`.
- A generalização é um lote atômico: identidade (banco), conteúdo (união), imagem (namespaces) e
  nível (FK ao catálogo) entram JUNTOS — meia-generalização deixa a tabela aceitando NULL que o
  renderer não sabe imprimir.

## O que M-E e M-F (deste lote) NÃO podem cimentar

- **M-E (Fábrica legível):** só torna **leitura/ordenação tolerantes a NULL** — rótulos tipo
  "Módulo N · Aula N" caem para título/coleção quando módulo/aula faltam; a grade não ordena/
  agrupa SÓ por `module`; nenhum texto chama a coleção de "Personal Travel" de forma fixa.
- **M-F (rascunhar com IA parametrizado):** neste lote M-F **só amplia o PARÂMETRO de nível e o
  validador de conteúdo**. Mantém `course='personal-travel'`, módulo/aula obrigatórios e a RPC
  atual; **NÃO** adiciona `contractId`, **NÃO** consulta briefing/plano, **NÃO** cria avulsa
  (a identidade muda atomicamente no lote futuro). O prompt não pode interpolar `module`/`lesson`
  sem fallback (hoje `draft.ts:95,112` os injeta cru); campos novos parametrizados (tema, tópicos,
  estilo, nº de slides, estrutura, Kolb) são agnósticos de curso.
- **Nível em M-F:** o campo de nível (±1) **lê do catálogo `curriculum_tracks`**, não hardcoda
  `A0/A1/A2` nem recopia um enum. Ampliar `LessonSchema.level` para os 11 níveis do catálogo é
  permitido; inventar um conjunto novo, não. ⚠️ `'A0'` NÃO é nível Flexge: é **aceito só na
  entrada legada, via `preprocess`, e normalizado em memória para `'Pre A1'`** — conteúdo vivo
  **não** é reescrito e **nenhum** conteúdo novo persiste `A0`.
