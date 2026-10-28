# QA — teste, olho e adversário

Referência do `SKILL.md` §4. A tríade não é redundância: cada perna pega uma classe de
defeito que as outras duas não veem.

| Perna | Pega | É cega para |
|---|---|---|
| Teste | colisão de caixas, transbordo, regressão de layout, robustez do maquinário | tudo que é semântico e tudo que só aparece na tela |
| Olho | foto errada no slide certo, recorte, repetição, monotonia, grafia | robustez, casos que não estão no lote olhado |
| Adversário | conteúdo frouxo, gabarito errado, referência quebrada, premissa não checada | o que não estiver no artefato que ele recebeu |

---

## 1. Teste

```bash
npm test                      # suíte inteira
npx vitest run tests/slides-v2-layout.test.ts
```

Os invariantes que travam o visual (`tests/slides-v2-layout.test.ts`):

- **Invariante 0** — nenhuma caixa desenhada intersecta outra. Modela **ordem de desenho**:
  não basta as caixas não se cruzarem no papel, o que é desenhado depois cobre o de antes.
- **Invariante 0-bis** — nenhum TEXTO excede o shape que o contém (a 0 mede caixa contra
  caixa; o texto pode transbordar dentro de uma caixa que não colide com nada).
- **Invariante 0-ter** — nenhuma marca/decoração intersecta a caixa do título. Comprado com
  o defeito real do fio-gradiente riscando a 2ª linha de títulos de duas linhas: **51 slides
  em 33 dos 65 decks** (`qa/varredura/ANOTACOES.md` §S1).
- **Agrupamento 2,5×** — o vão ENTRE passos tem de ser pelo menos 2,5× o vão DENTRO do passo,
  medido no desenho, nunca estimado. Sem isso os passos numerados leem como uma lista só.

Regra: **teste vermelho é informação.** Se um teste revela bug, o bug é o problema — nunca
afrouxe o teste.

## 2. Olho — a folha de contato

O caminho que a varredura dos 65 decks usou (`qa/varredura/`):

```bash
# 1. pptx -> pdf
soffice --headless --convert-to pdf --outdir /tmp/varr/pdf "out/slides/M3A1 — ….pptx"
#    (macOS: /Applications/LibreOffice.app/Contents/MacOS/soffice)

# 2. pdf -> png, um por slide
pdftoppm -r 60 -png /tmp/varr/pdf/M3A1.pdf /tmp/varr/png/M3A1

# 3. folha de contato anotada (slide, tipo, endereço da foto)
python3 qa/varredura/manifest.py      # lê os JSONs: slide -> tipo + endereços
python3 qa/varredura/sheet.py 'M3A*'  # monta qa/varredura/sheets/M3A*.png
```

- **60 dpi** basta para varrer (slide de 13,33" → ~800px). **150–170 dpi** para CONFIRMAR um
  defeito suspeito antes de reportá-lo.
- A folha traz o número do slide e o endereço da foto em cada célula — é o que permite
  acusar "foto X no slide Y" sem voltar ao código.
- Ferramentas de apoio no mesmo diretório: `fio.py` (detector de pixel do fio riscando o
  título — validado 7/7 contra casos conferidos a olho), `dupes.py` (dHash), `capas.py`
  (todas as capas com a caixa da facecam desenhada por cima).

**Facecam, uma aula por vez:**

```bash
node scripts/images/facecam-qa.ts content/personal-travel-v2/m2a1.json --slide 1
```

**Leia `qa/varredura/ANOTACOES.md` antes de varrer.** É o catálogo do que procurar, e quase
todo item é invisível para máquina:

- foto de outro contexto no slide certo (cama de hotel numa cabine de avião) com **0
  endereços quebrados**;
- capa cujo assunto o recorte joga fora (foto retrato numa página 16:9 ancorada no alto);
- facecam pousada em cima do assunto;
- endereço que promete o que a foto não tem (`insurance-card-phone` sem cartão nem celular);
- monotonia: aulas vizinhas com "a mesma foto sem ser a mesma foto" (dHash não acusa);
- cobertura curta de biblioteca (7 fotos para 5 decks → repetição gritante).

## 3. Adversário

- Roda em **`codex exec`**, com o artefato + schema + checklist — **nunca o repo inteiro**
  (é o que segura o custo, ~6k tokens por aula).
- Modelo de manifesto: `qa/rodada-adversarial-LEIA-PRIMEIRO.md`. O que copiar dele:
  - **regra anti-ancoragem** — as análises de quem implementou são parte do RÉU, não do
    tribunal; para cada item, tente DERRUBAR a proposta antes de aceitar. Concordância sem
    evidência citada = falha do revisor;
  - **produto único e estruturado** — por item: veredito (ACEITAR / ALTERAR / REJEITAR /
    ADIAR), prioridade, tamanho, **evidência citada** (arquivo:linha);
  - afirmação que só o ambiente vivo confirmaria vira "verificação pendente", nunca suposição.
- Teto de rodadas: **5**; esperado 1–2. Quem implementa **não se auto-aprova** — a
  verificação externa é do adversário.
- ⚠️ Ler o parecer inteiro, do TOPO. Ver `armadilhas.md` (o `tail` que produziu um falso
  "zero críticos").

## A regra de ouro

> **Toda garantia visual dada sem ter convertido para PNG e olhado é uma garantia falsa.**

Neste projeto isso aconteceu três vezes, sempre com a suíte verde. Um deck que renderiza,
passa nos invariantes e tem 0 endereços quebrados ainda pode estar com a foto errada, o
título riscado e o assunto da capa fora do quadro.
