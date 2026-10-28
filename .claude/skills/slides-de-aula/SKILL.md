---
name: slides-de-aula
description: Produz decks de aula (.pptx) com fotos geradas por IA, do JSON da aula até a entrega — pipeline, regras de escrita, direção fotográfica, QA visual e revisão adversarial. Use ao criar deck de aula, gerar slides de aula com fotos, escrever ou revisar aulas de um curso em slides, gerar imagens de cena ou de card de vocabulário para slides, ou varrer decks prontos atrás de defeito visual.
---

# Slides de aula com fotos

Este repo produziu 65 decks e 381 fotos do curso Personal Travel v2. Esta skill é o que
sobrou de útil: o pipeline na ordem, as regras que a revisão adversarial mais cobra, e as
armadilhas que já custaram horas. **Não reinvente nenhuma das duas primeiras seções — elas
foram compradas com rodadas reprovadas.**

**A lição central, que governa tudo abaixo:** teste verde não prova qualidade visual; olho
não prova robustez. O fluxo precisa dos três — **teste, olho e adversário**. Este projeto
provou isso três vezes, sempre do jeito caro.

---

## 1. O pipeline, na ordem

Nenhuma etapa se pula, e a ordem importa (etapa 3 antes da 4 é o que evita regerar foto).

1. **Escrever o JSON da aula** — contrato: `src/lib/slides/lesson-schema.ts`.
   Erros que mais aparecem: `videoUrl` **tem de existir como `null`** nos blocos de
   listening (omitir quebra o schema); `dialogue` no máximo **8 falas**; `vocab` no máximo
   **8 cards**; `module.number` 0 só é válido no v2 (`lessonSchemaFor('personal-travel-v2')`),
   no v1 o mínimo é 1. Nunca invente URL de vídeo — a curadoria é humana.
2. **Renderizar** — `npm run slides:render -- content/<curso>/<arquivo>.json <curso>`.
   `✓` com contagem de slides = válido. Os avisos de encaixe (`✗ estouro`, `⚠ aperto`,
   `↳ paginação`) vêm do `src/lib/slides/fit-check.ts` e são conteúdo, não estética:
   trate-os antes de seguir.
3. **Declarar o endereço da foto no JSON ANTES de gerar** — a foto é gerada *para* o
   endereço que o conteúdo já pede (`{ "file": "m3/departure-board.jpg" }` na cena,
   `"image": "vocab/gate.jpg"` no card). Reaproveite endereço existente em
   `brand/slides/library/` antes de inventar nome novo.
   **Tudo-ou-nada por slide de vocabulário:** ou todos os cards têm foto, ou nenhum tem.
4. **Gerar as fotos** — `scripts/images/cenas.ts` (cena) e `scripts/images/vocab.ts` (card).
   Ver §3 e `references/fotos.md`.
5. **QA visual** — §4. Converter para PNG e OLHAR. Sem isso não há garantia.
6. **Revisão adversarial** — §4, terceira perna. Modelo de manifesto:
   `qa/rodada-adversarial-LEIA-PRIMEIRO.md`.
7. **Entrega** — deck em `out/slides/`, upload para o Drive, portão humano.

Detalhe de cada etapa (comandos, flags, o que olhar): `references/pipeline.md`.

## 2. Regras de conteúdo

O contrato de escrita é **`docs/slides/BRIEFING-AUTORES.md`**. Leia-o inteiro antes de escrever
uma linha de aula. As seis regras nasceram de 29 achados reais numa rodada de 14 aulas:

- **R1 — Absoluto vira honesto.** Nada de "sempre"/"todo aeroporto": diga "na maioria das
  vezes" e diga a exceção.
- **R2 — A professora não ganha biografia.** Dado de exemplo é de personagem, nunca memória
  dela.
- **R3 — Vergonha nunca é motivador.** O valor do ensaio sem a ameaça.
- **R4 — Política de fornecedor não se afirma, se pergunta.** Ensine a pergunta
  (`How much is the deposit?`), não a política — e evite valor em moeda.
- **R5 — O gabarito só cobra o que a aula ensinou.** Confira cada resposta contra os slides.
- **R6 — Referência cruzada aponta para o alvo certo.** "o slide anterior", "as cinco
  letras": **conte**, sempre no fim, depois do último conserto.

**Coerência entre módulos** (descoberta com N autores em paralelo — não sai em teste nem em
revisão por módulo):

- A mesma cena escrita por dois autores **diverge**. A régua de desempate: **prevalece quem
  ENSINA** aquilo (a aula que apresenta o chunk manda na formulação; as outras se alinham).
- Quando a revisão encontra duas formulações corretas, ela **anuncia a equivalência** no
  conteúdo em vez de substituir uma pela outra em silêncio — a aluna vai ouvir as duas.
- O campo `cue` marca **tonicidade** (`re-SEET`, `AISLE`), não semelhança sonora, e **diverge
  entre módulos**: varra `cue` no curso inteiro no fim, nunca por aula.

## 3. Fotos

- **1 candidata + conferência automática + regera só o que reprovar.** Corte de ~70% no
  custo contra o desenho antigo (4–6 candidatas antes de alguém olhar). Motor:
  `scripts/images/comum.ts` (`rodada`) + `scripts/images/conferencia.ts`.
- **`LOTE=6` é o teto real**, por vizinhança de cota — não é limite medido da API. `LOTE=10`
  vira chuva de 500. Custo real medido: **~R$ 0,42 por geração**, o dobro do preço de tabela
  — a conta que decide se vale regerar.
- **Clima por PARTE do curso**, não por módulo (`src/lib/slides/climate.ts`, campo `photo`,
  traduzido em `CLIMA_DA_PARTE` no `cenas.ts`). Parte sem clima é ERRO, não fallback.
- **Ponto de vista da aluna:** a viajante aparece de costas, em silhueta, pelas mãos, ou não
  aparece. Não se persegue um rosto coerente ao longo de dezenas de fotos.
- **Zona da facecam nas capas:** a câmera da professora pousa no canto e a capa **não desenha
  a caixa** — no PNG a colisão é invisível. A zona sai de `ZONA_FACECAM` (`comum.ts`), que a
  deriva de `FACECAM_V2`; quem a fiscaliza é `scripts/images/facecam-qa.ts`.
- **A fatia central do card de vocabulário (~3.34:1, sobra ~45% da altura):** assunto no alto
  ou no pé some no slide. ⚠️ **A conferência automática NÃO pega isso** — a régua `faixa`
  não disparou uma vez em 194 conferências. Quem segura é o prompt (`CARD_DE_VOCABULARIO`) e
  o olho.
- **Texto dentro da foto:** segue `docs/decisions/025-texto-de-ia-em-foto-de-aula.md` —
  palavra curta **ditada** no prompt quando o texto É o conteúdo da aula, sim; texto que o
  modelo **inventa** (país, marca, brasão, frase longa), nunca. Grafia é conferida a olho.

Direção de arte, prompts e economia da rodada: `references/fotos.md`.

## 4. QA — a tríade

Nenhuma das três substitui as outras.

**Teste** — `npm test`. Os invariantes de layout vivem em `tests/slides-v2-layout.test.ts`:
**0** (nenhuma caixa desenhada intersecta outra, modelando ordem de desenho), **0-bis**
(nenhum texto excede o shape que o contém), **0-ter** (a marca/fio nunca risca a caixa do
título), e o **agrupamento 2,5×** (o vão entre passos maior que o vão dentro do passo).

**Olho** — `.pptx` → LibreOffice → PDF → `pdftoppm` → **OLHAR**, uma folha de contato por
deck. Ferramentas prontas em `qa/varredura/` (`manifest.py`, `sheet.py`, `fio.py`,
`dupes.py`); o que o olho achou nos 65 decks está em `qa/varredura/ANOTACOES.md` — leia antes
de varrer, é o catálogo de defeitos a procurar. Facecam: `node scripts/images/facecam-qa.ts
<aula>.json`, **uma aula por vez**.

**Adversário** — GPT-5.6 Sol via `codex exec`, alimentado só com o artefato + schema +
checklist, nunca o repo inteiro. Manifesto anti-ancoragem: `qa/rodada-adversarial-LEIA-PRIMEIRO.md`.

> **Regra de ouro:** toda garantia visual dada sem ter convertido para PNG e olhado é uma
> garantia falsa. Três vezes neste projeto um deck "verde" tinha defeito grosseiro na tela.

Receitas completas (comandos, dpi, montagem de folha de contato): `references/qa-visual.md`.

## 5. Armadilhas operacionais

Cada uma custou horas. Detalhe e sintoma em `references/armadilhas.md`.

- **`codex exec` em background trava** em `Reading additional input from stdin` — sempre
  `< /dev/null`. Prova de vida é **arquivo novo crescendo em `~/.codex/sessions/`**, nunca
  "o processo existe".
- **NUNCA ler parecer com `tail`.** Os achados críticos ficam no **TOPO**. Um truncamento já
  produziu um falso "zero críticos" — eram 9. Parecer íntegro se recupera do rollout `.jsonl`.
- **`pptxgenjs sizing:cover` é no-op sob Node.** Sem o `coverImage` do repo, toda foto sai
  **esticada**.
- **Medir título por contagem de caracteres é cego à CAIXA ALTA.** Use a tabela de glifos
  (`displayTitleBox`), não `.length`.
- **Endereço declarado ≠ foto certa.** Cama de hotel caiu num slide de avião com **0
  endereços quebrados** (`ANOTACOES.md` §S8). Só o olho pega.

## 6. Paralelismo

O padrão que produziu 9 módulos ao mesmo tempo:

1. **Briefing comum** para todos os autores (`docs/slides/BRIEFING-AUTORES.md`) + **uma aula-modelo já
   revisada** para copiar (estrutura, densidade de notas, nível do inglês).
2. **N autores**, um por módulo, escopo fechado: cada um toca só os arquivos do seu módulo.
3. **Revisor por grupo** de módulos, com o mesmo checklist.
4. **Conferência CRUZADA no fim**, obrigatória: a mesma cena com duas formulações, o `cue`
   divergente e a foto repetida entre aulas vizinhas **não aparecem** em teste nem em revisão
   por módulo. É uma varredura do curso inteiro, por dimensão, no fim.
