# Fotos — economia, direção de arte e conferência

Referência do `SKILL.md` §3. Motor: `scripts/images/comum.ts` (`rodada`),
`scripts/images/conferencia.ts` (a régua), `scripts/images/cenas.ts` (cena),
`scripts/images/vocab.ts` (card). Provedor: Gemini / Nano Banana 2 — decidido e medido em
`docs/decisions/023-imagens-das-aulas-no-sistema.md`.

---

## A economia da rodada

**O desenho antigo gerava 4–6 candidatas por endereço ANTES de alguém olhar qualquer uma** —
pagava-se 6 para usar 1, inclusive quando a primeira servia (4 de 13 fotos eram aprovadas na
primeira candidata). O desenho atual:

> gera **1** → **conferência automática olha** → só o que ela REPROVA custa uma geração nova,
> até um teto por endereço (`TENTATIVAS_POR_ENDERECO = 4`).

Corte de ~70% no custo. Estourado o teto, o endereço entra na lista de falhas — nunca entrega
foto ruim em silêncio.

**Números que valem levar:**

- **`LOTE=6` é o teto real.** Não é limite medido da API: é decisão de vizinhança (a chave é
  compartilhada; estourar a cota derruba as duas rodadas). `LOTE=10` vira chuva de 500.
  Medido: 2 → ~24 s/imagem, 4 → ~12 s/imagem, 6 → ~8 s/imagem, sem 429 e sem timeout.
- **O que destrava a concorrência é o ESCALONAMENTO, não o número.** Ondas síncronas de 6
  partidas no mesmo milissegundo estouravam o teto de 60s por chamada; o pool global de vagas
  mantém 6 em voo com as partidas naturalmente defasadas.
- **Custo real ~R$ 0,42 por geração — o dobro do preço de tabela.** É esta a conta que decide
  se vale regerar um endereço ou aceitar a foto banal e correta.
- **As chamadas de conferência disputam as mesmas vagas** do pool: mesma chave, mesmo 429.
  Contá-las fora seria dizer "concorrência 6" e mandar 12.

**Classificação de erro** (`classifica` em `comum.ts`) — três destinos, e a ordem importa:

| Classe | O que é | O que a rodada faz |
|---|---|---|
| `sem-credito` | saldo esgotado (chega como 429!) | **aborta** a rodada, depois de confirmar 5s depois |
| `pico` | 429, 500 `Internal error encountered.`, 503, timeout, overloaded | recua (exponencial + jitter) e insiste; o freio é COMPARTILHADO por toda a rodada |
| `defeito` | recusa de conteúdo, chave errada, prompt malformado | desiste na hora — repetir é receber a mesma resposta |

Saldo esgotado é consultado ANTES de pico porque as duas coisas chegam como 429, e tratar
saldo como pico deixa a rodada em ciclo de retentativa, calada, até alguém desconfiar.

## Direção de arte

- **Clima por PARTE do curso, não por módulo.** Fonte de verdade:
  `src/lib/slides/climate.ts` (campo `photo`); a tradução para prompt está em
  `CLIMA_DA_PARTE` (`cenas.ts`). Cada bloco de clima fecha com a lista do que aquela parte
  **não é** — sem a negativa explícita o modelo puxa toda cena de rua para o pôr do sol
  dourado, que é o clima de UMA parte só. Parte sem clima é ERRO, nunca fallback silencioso:
  cena com o clima errado passa na conferência e destoa no deck.
- **Ponto de vista da aluna.** A viajante aparece de costas, em silhueta, pelas mãos, ou não
  aparece. Manter um rosto coerente por dezenas de fotos é aposta que o modelo perde — e põe
  a aluna assistindo à viagem de outra pessoa em vez de fazer a dela.
- **A marca mora no slide, não na foto:** luz natural, cores reais, nunca forçar a paleta
  dentro da imagem.
- **Consistência de "cast" e de lente por módulo** (mesma família de enquadramento e
  temperatura) — é o que faz o módulo parecer uma sessão fotográfica única.

## As três posições da régua de placas

Blocos prontos em `comum.ts`, ratificados um a um:

1. **`PLACAS_AO_FUNDO`** — placa fora do plano de foco, letras dissolvidas. Placa **em
   branco** foi testada e REPROVADA pelo dono ("fica forçada, não fica natural"): sinalização
   real de cidade, desfocada, é o que uma foto real mostra.
2. **`PLACAS_EM_FOCO`** — a aula ensina a ler placa de rua: uma ou duas palavras reais em
   caixa alta (CENTRE, STATION, OLD TOWN). Nunca frase.
3. **`painelQueEnsina(linhas)`** — o painel É a aula (`DELAYED`, `BOARDING`, `GATE`). Quem
   chama **dita as linhas exatas**; nada é deixado à imaginação do modelo.

A régua por trás das três (`docs/decisions/025-texto-de-ia-em-foto-de-aula.md`): **o modelo
erra o que inventa e acerta a palavra curta que se manda escrever.** Continua proibido sem
exceção: nome de país, brasão, bandeira, logo de empresa real, texto longo e garrancho. A
conferência automática guarda a régua `marca`; **a grafia é responsabilidade do olho**.

## A zona da facecam (capas)

A câmera da professora entra por cima da foto **na gravação**. Na capa o template **não
desenha a caixa** — então no PNG a foto aparece inteira e a colisão é invisível. Foi assim
que uma viajante de costas foi parar exatamente atrás do rosto da professora.

- A zona sai de `ZONA_FACECAM` (`comum.ts`), derivada de `FACECAM_V2` e dilatada pela margem
  da própria câmera: mudar o tamanho da câmera corrige o prompt, a régua da conferência e o
  retângulo do QA de uma vez.
- Fiscalização: `node scripts/images/facecam-qa.ts <aula>.json` desenha a caixa e a zona por
  cima do slide renderizado.
- Na composição, o assunto vai para o lado OPOSTO ao da câmera. A regra antiga mandava o
  assunto para "a metade de cima, um pouco à direita" — direto para debaixo do rosto dela.

## A fatia central do card de vocabulário

No card, a foto entra numa moldura de **3.34:1** com `sizing: 'cover'`. De uma foto 3:2 sobra
a **faixa horizontal do meio, ~45% da altura** (`FAIXA_DO_CARD_PCT`, medido, não estimado).
Assunto encostado no alto ou no pé **não aparece no slide** — e isso não se vê olhando a foto
sozinha, só no deck.

⚠️ **A conferência automática não pega este defeito.** A régua `faixa` existe, tem prompt
dedicado (com passo de raciocínio obrigatório) e **não disparou uma única vez em 194
conferências**, enquanto o olho achou casos reais (`vocab/crew.jpg`: a comissária aparece
decapitada no card). Quem segura é o prompt de geração (`CARD_DE_VOCABULARIO`: assunto grande,
no meio do quadro, longe das bordas) e o olho na folha de contato. Não confie na régua.

## O que a conferência é e o que ela não é

`conferencia.ts`, duas propriedades desenhadas de propósito:

1. **A régua é objetiva e grave** — lista fechada: `marca`, `anatomia`, `emenda`, `facecam`
   (só capa), `faixa` (só card). **Gosto não entra:** foto banal mas correta PASSA. Uma
   conferência com opinião estética reprova foto boa, e cada reprovação errada é uma geração
   inteira jogada fora.
2. **O veredito é calculado no código**, a partir dos ACHADOS — o modelo nunca devolve
   "aprovada". Sem defeito na lista = aprovada, e ponto. Resposta malformada vira ERRO, nunca
   aprovação.

Toda candidata, aprovada ou reprovada, fica gravada em `out/<gerador>/<endereço>/` com o
veredito e o prompt ao lado. É esse material que valida a régua na próxima vez que alguém
desconfiar dela — e a desconfiança é saudável: veja o caso da `faixa` acima.
