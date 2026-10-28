# Pipeline — detalhe de cada etapa

Referência do `SKILL.md` §1. Comandos são do repo `personal-teacher-os` (worktree
`slides/v2`); em outro repo, o que transporta é a ORDEM e os motivos.

---

## 1. Escrever o JSON da aula

**Contrato:** `src/lib/slides/lesson-schema.ts` (`lessonSchemaFor(course)` — o curso escolhe
o contrato E o template). **Nunca deduza o schema do exemplo:** abra o arquivo.

Antes de escrever, leia **inteira** a aula mais revisada que existir (aqui:
`content/personal-travel-v2/m4a1.json`, que passou por duas rodadas adversariais e um
verificador independente). Ela é o padrão de estrutura, de densidade de notas e de nível do
inglês — não um resumo dela.

Erros de schema que mais aparecem, na ordem:

| Erro | Regra |
|---|---|
| `videoUrl` omitido | tem de EXISTIR como `null` (`z.url().nullable()`) — o bloco de listening reserva o espaço para a curadoria humana |
| `dialogue` longo | no máximo **8 falas** |
| `vocab` cheio | no máximo **8 cards** |
| `module.number: 0` | só válido no v2 (GET READY); no v1 o mínimo é 1 |
| título/subtítulo longos | têm teto de comprimento; se o render reclamar, encurte |
| `[ROTEIRO]`/`[KOLB]`/`[GABARITO]` escritos na nota | o renderizador já põe o rótulo — escrever de novo duplica |

**Notas de roteiro são o produto principal**, não um apêndice: quem grava lê aquilo. Escreva
como quem dirige a professora — o gancho antes de mostrar o slide, o que apontar, a pergunta
que abre a conversa, o erro a esperar e como corrigir na hora.

**Nunca invente URL de vídeo.** Placeholder + instrução para quem cura.

## 2. Renderizar

```bash
npm run slides:render -- content/personal-travel-v2/m3a1.json personal-travel-v2
```

- 2º argumento = curso; sem ele, cai no contrato/template v1.
- Saída: `out/slides/M<mod>A<aula> — <título> — v2.pptx`.
- `✓ … (N slides, incl. gabaritos automáticos)` = schema válido.
- Avisos de encaixe vêm do `fit-check.ts` no mesmo canal de quem escreve:
  `✗ estouro` (não cabe), `⚠ aperto`, `↳ paginação`. Não bloqueiam — informam o preço.
  Estouro se resolve **cortando conteúdo ou criando slide**, nunca diminuindo fonte à mão.

Render é portão de SCHEMA. Ele não diz nada sobre a aula estar boa nem sobre o slide estar
bonito — para isso, §4 do SKILL.

## 3. Declarar os endereços de foto — ANTES de gerar

A ordem é o que evita pagar duas vezes: a foto é gerada **para** um endereço que o conteúdo
já pede. Gerar antes produz foto órfã e endereço quebrado.

- Cena (capa, warm up, tip, divisória): `"image": { "file": "m3/departure-board.jpg" }`
- Card de vocabulário: `"image": "vocab/gate.jpg"`
- Nomes em inglês, minúsculo, hífen: `key-card.jpg`, `luggage-storage.jpg`.
- **Reaproveite** o que já existe em `brand/slides/library/` antes de inventar nome novo.
  ⚠️ Reaproveitar é decisão SEMÂNTICA: `vocab/pillow.jpg` serve o módulo de hotel e não
  serve o de avião (`ANOTACOES.md` §S8 — cama de hotel num slide de cabine).
- **Tudo-ou-nada por slide de vocabulário:** foto no card 1, ausente no 2, de volta no 3 fica
  visualmente quebrado. Na prática: slide de objeto concreto (`towel`, `receipt`, `gate`)
  leva foto em todos; slide de frase inteira ou de palavra abstrata (`What`, `nationality`)
  não leva em nenhum — e fica coerente assim.

## 4. Gerar as fotos

```bash
node scripts/images/cenas.ts m3            # o módulo inteiro
node scripts/images/cenas.ts m3 m3/gate.jpg  # um endereço, ou vários
node scripts/images/cenas.ts m3 --prompts  # só imprime; não gasta
node scripts/images/cenas.ts m3 --refazer  # regera e SOBRESCREVE a biblioteca
node scripts/images/vocab.ts m3            # o mesmo, para cards
```

Endereço que já está na biblioteca **não é regerado** (é isso que torna o comando
reexecutável de graça). Falha não vira placeholder: o endereço entra na lista de falhas do
relatório. Códigos de saída: `0` tudo entregue, `1` alguma falha, `3` saldo esgotado.

Regras de arte, economia e conferência: `fotos.md`.

## 5–7. QA, adversário, entrega

- QA visual e a tríade: `qa-visual.md`.
- Armadilhas que aparecem justamente aqui: `armadilhas.md`.
- Entrega: `.pptx` de `out/slides/` → Drive (a conversão para Google Slides é automática ao
  abrir) → portão humano. O portão humano é de AMOSTRA quando o template está travado: 1–2
  decks por lote, mais toda capa nova.

---

## Paralelismo — o padrão de N autores

1. **Briefing comum** versionado (`docs/slides/BRIEFING-AUTORES.md`) + **aula-modelo revisada** para
   copiar. Sem os dois, N autores produzem N estilos.
2. **Escopo fechado por autor:** um módulo, `content/<curso>/m<N>*.json`, e nada de tocar
   `src/`, `tests/`, `scripts/` ou o módulo de outro autor.
3. Cada autor **roda o render** e entrega verde de schema.
4. **Revisor por grupo** de módulos, com o checklist das 6 regras (§2 do SKILL).
5. **Conferência CRUZADA no fim** — a etapa que ninguém lembra e que sempre acha coisa:
   - a mesma cena/chunk formulada de dois jeitos (régua: prevalece quem ENSINA; a revisão
     ANUNCIA a equivalência em vez de trocar em silêncio);
   - `cue` divergente entre módulos (tonicidade da mesma palavra);
   - foto repetida entre aulas vizinhas e capa repetida entre decks vizinhos;
   - referência cruzada quebrada por conserto tardio (R6).

   Nada disso sai em teste nem em revisão por módulo — é varredura do curso inteiro, por
   dimensão, depois do último conserto.
