# ADR-023 — Geração de imagens das aulas DENTRO do sistema

**Data:** 22/07/2026
**Status:** aceito (implementação IM-1 pronta; IM-2/IM-3 pendentes)
**Causa raiz da API RESOLVIDA em 22/07 — ver "Adendo 3" no fim. Em uma linha:
faltava `style_id`.**

## Contexto

As fotos das aulas do Personal Travel (M5, M6, M7) nasceram **fora** do sistema:
eu gerava pelo MCP do Higgsfield na minha sessão, auditava numa contact sheet,
reprovava o que violasse a Lei 11 e commitava em `brand/slides/library/`.

Isso funcionou — 23 fotos do M6 e 10 do M7 estão no ar por esse caminho — mas
tem dois defeitos estruturais: **prende a produção de conteúdo a mim** (a
dona não consegue gerar uma foto sozinha) e **exige um deploy por foto**,
porque a biblioteca é um diretório do repo.

Em 22/07 o mantenedor fechou a questão: *"quero tudo pelo sistema agora... Nada
você vai fazer por fora, além da implementação do sistema funcional ou testes.
A consolidação final e dos próximos módulos, ou correções do atual, serão
feitas no site da Personal Teacher."*

## Decisão

A geração, a curadoria e o armazenamento de imagens passam para dentro do app.

1. **Biblioteca no banco** (`slide_images`, migration `20260722000100`), com
   endereço **pasta + nome** — o mesmo do disco (`m6/menu-reading.jpg`). O
   conteúdo da aula continua apontando para o caminho de sempre e as imagens já
   commitadas seguem valendo.
2. **Arquivo no Google Drive** (Lei 10), no mesmo drive compartilhado dos decks.
3. **Driver de provedor NEUTRO** (`src/lib/images/provider.ts`), no molde do
   `notify/channel.ts`. Trocar de provedor é trocar um arquivo. Isto não é
   gold-plating: é a mitigação que o `docs/research/03` §7 prescreveu para o
   risco de a API do Higgsfield ser imatura.
4. **Curadoria continua humana.** O provedor propõe; a professora aprova. Das
   23 imagens do M6 eu reprovei 2 (texto ilegível num cardápio, mão em close
   numa maquininha). Aprovação automática trocaria um problema real por um pior.
5. **O prompt é procedência** e congela quando a imagem existe — senão a
   auditoria passa a mentir sobre o que gerou aquela foto.

### Desvio registrado

O `docs/research/03` §7 recomendava *"MCP + curadoria manual até o volume
justificar"* e *"só escalar para API/webhook quando o volume justificar"*. Com
6 módulos e ~250 imagens pela frente, o mantenedor considerou o volume
justificado. Este ADR é o registro desse desvio.

## Contrato da API do Higgsfield (medido, não suposto)

> ⚠️ O `model_id` abaixo veio da doc pública e **o console do fornecedor lista
> outro** (`higgsfield-ai/soul/v2/standard`). Ver o adendo de 22/07 no fim.

```
POST https://platform.higgsfield.ai/{model_id}        # higgsfield-ai/soul/standard
  header Authorization: Key {key_id}:{key_secret}
  body   { prompt, aspect_ratio, resolution }
  → 200  { status, request_id, status_url, cancel_url }

GET  https://platform.higgsfield.ai/requests/{request_id}/status
  → { status: queued|in_progress|completed|failed|nsfw|cancelled, images: [{url}] }
```

Créditos de API são **carteira separada** da assinatura de consumo (Plus). Os
créditos do plano mensal não valem aqui; compra-se em `cloud.higgsfield.ai`
(16 créditos = US$ 1; medido ~2 créditos/imagem no plano de consumo).

## ⚠️ Erro registrado, e a retratação

A primeira implementação chamava `/v1/text2image/soul` com headers
`hf-api-key`/`hf-secret` e corpo embrulhado em `params`, consultando
`/v1/job-sets/{id}`. **Errado nos quatro eixos.** Essa é uma superfície
**legada** que aceita a requisição, responde 200, **debita crédito e nunca
processa** — custou 4,68 créditos em jobs que ficaram em `queued`
indefinidamente.

> ⚠️ **Matizado em 22/07 — ver o adendo no fim deste documento.**
> O par `hf-api-key`/`hf-secret` é o que o console do fornecedor gera hoje, mas
> **os dois SDKs oficiais usam `Authorization: Key`** — então chamá-lo de
> caminho não-vigente se sustenta. Errados mesmo eram o endpoint, o embrulho em
> `params` e o polling de `job-sets`.

Disso saíram duas afirmações minhas que estavam erradas e precisam constar:

1. **"O SDK oficial mente sobre o próprio contrato."** Falso. O
   `@higgsfield/client` v2 devolve exatamente o `V2Response` que declara,
   quando chamado com um `model_id` válido. Os 404 vieram de nomes de modelo
   que **eu inventei** (`nano-banana-pro/text-to-image`). A acusação chegou a
   ser commitada em `d0232e2` e está retratada em `63c59ec`.
2. **"O provedor está quebrado."** Conclusão tirada de três amostras e de
   inferência, apresentada com confiança indevida. O mantenedor recusou —
   *"para mim é contra-intuitivo uma plataforma tão grande ter um erro desse"*
   — e mandou fazer diagnóstico de verdade. Estava certo.

**Causa raiz do meu erro:** tratei mensagens de erro do servidor como bússola.
Quando `/v1/text2image/soul` respondeu `body.params: Field required`, li como
progresso ("achei o endpoint, falta o corpo") quando era o aviso de que eu
estava na porta errada. Cada erro seguinte — `params`, lista de dimensões,
saldo — deu sensação de avanço e me afastou mais da documentação, que eu nunca
tinha aberto (`docs.higgsfield.ai`, linkada no próprio console).

**Regra que fica:** documentação primeiro; erro de servidor não é bússola. E os
testes do driver agora assertam o caminho do modelo, o header `Authorization` e
a **ausência de `/v1/`** — para o erro não voltar por descuido.

## Consequências

- A dona gera e aprova fotos sem depender de mim nem de deploy.
- Custo por imagem sobe um pouco (crédito de API é mais caro que o do Plus:
  US$ 0,0625 contra US$ 0,039), em troca de autonomia.
- Um provedor ruim deixa de ser risco existencial: o driver é um arquivo.
- **Em aberto:** ainda não vi uma imagem sair pelo contrato correto — o request
  de teste ficou pendente por >15 min. *Aceito não é entregue*, e o IM-2 (a tela
  onde a professora clica "Gerar" e espera) não deve ser construído antes disso
  ficar provado.

---

## Adendo — 22/07/2026, manhã (investigação com o console na mão)

O mantenedor abriu `cloud.higgsfield.ai` e mandou os prints. O que era inferência
virou medição. **A causa raiz continua desconhecida** — este adendo registra o
que ficou provado e o que foi descartado, para o próximo a mexer nisto não
refazer o caminho.

### O que ficou PROVADO

1. **As duas carteiras existem, e a conta de API é onde o prejuízo caiu.**
   App (higgsfield.ai): 864,28 créditos, plano Plus.
   Cloud/API (cloud.higgsfield.ai): **492,32** créditos.
   E `492,32 + 4,68 = 497,00` — os 4,68 do incidente saíram desta carteira.
   Mesma pessoa (o e-mail pessoal do mantenedor), produtos e saldos separados.
   ⚠️ Consequência de método: **extrato do app não serve de prova sobre a API.**
   Eu argumentei "não debitou" lendo o extrato errado, e o argumento não valia.

2. **O id canônico do modelo atual é `higgsfield-ai/soul/v2/standard`** — com
   `/v2`. O console lista como "Text to Image" apenas **Popcorn Auto** e
   **Soul 2**; não existe card de "Soul Standard". O cURL que o próprio
   Playground gera:

   ```
   POST https://platform.higgsfield.ai/higgsfield-ai/soul/v2/standard
     -H 'hf-api-key: …'  -H 'hf-secret: …'
     { batch_size, resolution, aspect_ratio, enhance_prompt, prompt }
   ```

   **`docs.higgsfield.ai` contradiz o console**: a doc pública ainda apresenta
   `higgsfield-ai/soul/standard` com `Authorization: Key` como flagship. Duas
   fontes do fornecedor discordando — foi por seguir a doc que chegamos ao id
   sem `/v2`.

3. **O gateway autoriza por modelo.** `reve/text-to-image` responde
   `model_blocked` **na hora**, sem debitar. Ou seja: ele não é um buraco negro
   que aceita qualquer coisa — o que torna o aceite silencioso do `soul/standard`
   ainda mais estranho, não menos.

4. **Trocar o id NÃO resolveu, e o header também não.** Três requests em 22/07:

   | request_id | modelo | auth | desfecho |
   | --- | --- | --- | --- |
   | `91dd1fd8-f306-43ef-9b7c-209cb23688b1` | `soul/standard` | `Authorization: Key` | `queued` por 600s; ainda `queued` 11 min depois |
   | `40dc1d1e-d553-437f-8397-008fcecbad4e` | `soul/v2/standard` | `Authorization: Key` | `queued` por 240s |
   | `cd579b3d-c13e-4c45-ae7c-0fae51d8020b` | `soul/v2/standard` | `hf-api-key`/`hf-secret` | `queued` por 150s |

   Nenhum debitou crédito. Nenhum falhou. Todos aceitos.

5. **Do lado do console, é como se nada tivesse acontecido.** Usage: Total API
   Calls **0**, Total Spend **$0,00**, Usage by Model "No Usage Data" — filtrado
   pela única chave existente (`Personal Teacher`, `3737af1c…`, criada em
   21/07 22:50). Soul 2 → Requests: "0 total generations". Soul 2 → Analytics
   (21–22/07): Total Requests **0**. E o rodapé diz **"All systems operational"**.
   Ressalva honesta: a tela avisa *"Updates hourly"*, então os requests de hoje
   de manhã podem simplesmente ainda não ter aparecido — mas os de ontem à noite
   já teriam vencido essa janela.

### O que foi DESCARTADO

- Porta errada / superfície legada (o `/v2` é o id do console e reproduziu o mesmo).
- Chave inválida (autentica; e o `model_blocked` prova que ela é reconhecida).
- Header errado (os dois esquemas se comportam igual).
- Falta de crédito (492,32 disponíveis na carteira certa).
- Webhook obrigatório (a doc diz que polling é suportado).
- Fila da plataforma congestionada — enfraquecido: o status oficial é
  "operational" e o app entregou 10 imagens `nano_banana_2` às 02:24 do mesmo dia.

### Próximo passo decisivo (não custa crédito)

Abrir **Soul 2 → Requests** e **Analytics** depois da janela horária e ver se os
três `request_id` acima aparecem. Se aparecerem, o pedido chega e o worker não
roda — é problema do fornecedor, e a conversa é com o suporte, com os ids em mãos
(a régua deles: abrir suporte a partir de 24h em fila). Se **não** aparecerem, o
pedido nunca se vincula à conta, e aí a hipótese passa a ser de provisionamento
da chave — também suporte, com outra pergunta.

### O que fica pendente no código (NÃO mexido)

`src/lib/images/higgsfield.ts` ainda tem `MODELO = 'higgsfield-ai/soul/standard'`
e `tests/images-higgsfield.test.ts` asserta essa URL exata. O id do console é
outro — mas como trocá-lo **não** produziu imagem, mudar agora seria trocar uma
string sem evidência de que ajuda. Fica registrado aqui e decidido depois, junto
com o desfecho do suporte.

### Regra que se soma à de cima

Documentação primeiro **continua valendo** — mas hoje a doc pública estava
desatualizada em relação ao console do mesmo fornecedor. Quando as duas fontes
divergem, **o console autenticado é a autoridade sobre o catálogo de modelos**, e
qualquer conclusão sobre consumo tem de citar **qual carteira** foi lida.

---

## Adendo 4 — 22/07, tarde: o provedor passa a ser o Gemini (Nano Banana 2)

**Decisão do mantenedor, com os quatro conjuntos de imagens na tela.** A premissa
central deste ADR — "Higgsfield como provedor das fotos de aula" — cai.

### O que a medição mostrou

Mesma cena (banca de feira, o pior caso possível — feira é feita de placa de
preço), mesmo prompt, quatro candidatas por rodada:

| motor + prompt | aproveitáveis |
| --- | --- |
| Higgsfield Soul V2, prompt original | **1 de 4** |
| Higgsfield Soul V2, prompt afirmativo | 1 de 4 |
| Gemini Nano Banana 2, prompt original | 3 de 4 |
| **Gemini Nano Banana 2 + as 4 alavancas** | **4 de 4** |

O Soul não erra o mundo: erra a **escrita**. Ele desenha a textura de letra sem
saber escrever, e o resultado é garrancho ("CUREYE", "TIOCIION", palavras
flutuando no ar) — violação direta da Lei 11.

### A descoberta que decidiu

`gemini-3.1-flash-image` chama-se **"Nano Banana 2"** — e é **o mesmo motor** que
o app da Higgsfield expõe como `nano_banana_2`, aquele que produziu as **33 fotos
já aprovadas** nos módulos 5–7. Não é um substituto parecido; é o mesmo modelo.

E a raiz do problema: **a API da Higgsfield não vende esse motor.** O catálogo
dela é a família Soul + Popcorn Auto. O motor bom estava no app (onde só o
mantenedor opera, à mão) e o ruim era o que a dona teria pelo site. A migração
para a API trazia uma regressão de qualidade que ninguém tinha notado.

### As quatro alavancas (agora política em `prompt.ts`, com teste cada uma)

1. **Profundidade de campo rasa** — texto desfocado não é texto. É o que salva a
   `m7/produce-section.jpg`, que já está no curso.
2. **Placas declaradas EM BRANCO**, em afirmativo. Modelo de difusão não tem
   "não": pedir *"no text"* chega a ativar o conceito. Dizer que o cartão está
   vazio dá o que desenhar em vez do que evitar.
3. **Enquadramento fechado** no sujeito; o `warmup` deixou de pedir plano aberto,
   que enchia o quadro de sinalização.
4. **A proibição no fim** do prompt, onde o modelo pesa mais.

Nenhuma combinação zera o risco — por isso a Lei 11 mantém a **aprovação humana**
como portão. O prompt derruba a taxa; a professora elimina a exceção.

### Custo (medido, não estimado)

| | por imagem | ~100 fotos restantes (M8–M12) |
| --- | --- | --- |
| Nano Banana 2 | US$ 0,067 | **~US$ 6,70** |
| Soul V2 | US$ 0,0625 | US$ 6,25 nominal — **~US$ 25 real**, a 4 tentativas por foto usável |

A biblioteca foi contada: 60 fotos cobrem M5–M7 (~20 por módulo), então **~100**
para os cinco módulos que faltam — não os ~250 que este ADR estimava.
**1 candidata por padrão**, com "gerar mais 3" sob demanda: com 4 de 4 saindo
limpas, gerar quatro sempre seria desperdício.

### O que mudou no código

- `src/lib/images/gemini.ts` — driver novo. Contrato medido, com o **`mimeType`
  mandando na extensão**: o Gemini devolve JPEG, e no teste de 22/07 eu salvei
  JPEG com nome `.png`. Em produção isso vira arquivo mentindo sobre o conteúdo.
- `src/lib/images/registry.ts` — o provedor do projeto em um lugar só. Provedor
  sem credencial **não some do mapa**: existe e falha dizendo o que falta, senão
  a tela diria "provedor desconhecido" e mandaria caçar o problema errado.
- `src/lib/images/provider.ts` — a interface passou a admitir provedor
  **SÍNCRONO**. O comentário anterior afirmava que "geração é assíncrona em todo
  provedor sério"; o Gemini devolve a imagem no corpo em ~15s. Fingir assincronia
  custaria um handle inventado e um cache em memória que morre no primeiro
  restart do container.
- `src/lib/images/prompt.ts` — as quatro alavancas.

Proporções medidas contra a API real, pelo driver: `3:2` → 2016×1344 (Soul) e
1264×848 (Gemini); `2:3` → 848×1264; `1:1` → 1024×1024.

### E a Higgsfield, para que fica

Não vira lixo — volta ao lugar que o `docs/research/03-higgsfield-marca.md`
sempre reservou para ela: **marca e vídeo**. Aquele doc, no §5(c), já tinha posto
FLAG DE OVER-ENGINEERING em gerar foto de slide sob demanda. O plano Plus foi
comprado para conteúdo social, não para as aulas.

E a fraqueza fatal do Soul **não existe na marca**: no pipeline de marca nenhum
texto sai da IA (o Satori/HTML compõe por cima, com a fonte e o português
certos), e fundo lifestyle não tem plaquinha para o modelo inventar.

Quatro recursos ficaram priorizados pelo mantenedor para implementação futura:
**Personal Clipper** (as gravações do Meet viram cortes verticais — só material
solo da dona, aluno em vídeo exige consentimento), **Marketing Studio**,
**Cinema Studio/Seedance/Kling** e **Explainer Video**.

⚠️ **Soul ID está reprovado**: o mantenedor testou e as imagens da dona "não
ficaram legais, dá para perceber que são IA". O doc 03 recomenda treiná-lo na
semana 1 como "o recurso mais valioso" — **essa recomendação não sobreviveu ao
teste real** e não deve ser repetida sem fato novo.

### Pendência de ambiente

`GEMINI_API_KEY` está no `.env.local` e **não no servidor**. Sem ela em produção
o botão da dona falha com erro explícito (fail-closed). Entra no rito do
deploy, junto com a decisão de manter ou não `HF_CREDENTIALS` lá.

---

## Adendo 2 — 22/07, tarde: pesquisa externa + o desfecho dos requests

Rodada de pesquisa profunda (104 agentes, verificação adversarial) sobre os SDKs
oficiais, a documentação e relatos públicos, somada ao desfecho dos três pedidos.
**Três conclusões minhas do adendo anterior morrem aqui.**

### O desfecho: `queued` → `failed`, sem nunca passar por `in_progress`

O request `91dd1fd8` (enviado 12:47Z) virou **`failed` às ~14:20Z — 93 minutos
depois**, com corpo `{"status":"failed","error":"Generation failed"}`. Genérico,
sem causa. Os outros dois seguiam `queued` no mesmo instante.

Consequências:

- **Não é buraco negro.** O pedido existe, envelhece e termina. O que ele nunca
  faz é entrar em `in_progress` — some entre o aceite e a esteira.
- **Cai o argumento de "violação de contrato".** A pesquisa apontou o FAQ
  ("*if a request exceeds the timeout, it will be marked as failed*") como prova
  de que ficar preso violava o contrato. Ele **falhou**, como o FAQ prevê. O
  argumento não serve mais para o chamado; o que resta de anômalo é o pedido
  nunca sair da fila e o console contar zero.

### Correções do que eu havia escrito

1. **"Não debitou crédito" NÃO é diagnóstico** — e eu usei isso como pista o dia
   inteiro. A política oficial é cobrar **só na conclusão bem-sucedida**, então
   não debitar é o comportamento esperado de qualquer job que falha. Não
   distingue "fila quebrada" de "job nunca enfileirado". O sinal de anomalia que
   sobra é outro: **Usage = 0 API calls e "0 total generations"** horas depois de
   requests aceitos com `request_id`.
2. **Sobre os headers, eu me excedi na retratação.** É verdade que o console gera
   `hf-api-key`/`hf-secret`; mas **os dois SDKs oficiais** (`higgsfield-js` e
   `higgsfield-client`) autenticam com `Authorization: Key {key_id}:{key_secret}`,
   e o par do console não aparece em nenhum deles. O ADR original não estava
   errado ao tratá-lo como caminho não-vigente — estava errado ao empacotá-lo
   junto com os defeitos reais (endpoint, `params`, `job-sets`).
3. **A implementação é nossa e está certa.** Verificado no código-fonte dos dois
   SDKs oficiais: mesma base `platform.higgsfield.ai`, mesmo `Authorization: Key`,
   mesmo polling em `GET /requests/{id}/status`, e **`webhook` é opcional** —
   `withPolling = true` é o padrão do próprio cliente do fornecedor. **O cliente
   oficial teria travado igual.** Some a hipótese de erro de integração.

### O que a pesquisa NÃO achou (e isso também é resultado)

- **Nenhum relato público** de "queued eterno" na `platform.higgsfield.ai` — nem
  nos issue trackers dos dois SDKs oficiais, nem em fóruns. Não há bug conhecido.
- **Nenhuma etapa de ativação/billing documentada** como pré-requisito: a
  superfície documental pública inteira são 8 páginas e nenhuma fala de top-up,
  método de pagamento, quota ou provisionamento. Isso é **ausência de
  documentação, não prova de ausência da etapa**.

### Onde a investigação para

Restam duas hipóteses, e **nenhuma tem conserto do nosso lado**:

- **(a)** gate de provisionamento/billing não documentado, numa conta de API nova
  (chave de 21/07) e **sem método de pagamento cadastrado**;
- **(b)** bug de roteamento/worker no backend deles.

Nada que eu possa medir daqui separa as duas. Caminho: **chamado ao
suporte do fornecedor** (único canal documentado, sem SLA publicado) com os
três `request_id`, o id da chave, os horários e o contraste com o app de consumo.
Teste barato que o mantenedor pode fazer em paralelo, e que decide a hipótese (a)
sozinho: **cadastrar um método de pagamento** e reenviar um pedido.

---

## Adendo 3 — 22/07, RESOLVIDO: faltava `style_id`

**Saiu imagem.** `queued → in_progress → completed` em **35 segundos**,
PNG 1536×1152. Request `58d3f32a-944b-4239-90a1-098211a29b54`.

### A causa

O modelo Soul exige **`style_id`** — um estilo da lista oficial, obtida em
`GET /v1/text2image/soul-styles/v2` (33 estilos). Sem ele, o pedido é aceito,
vira job, é **cobrado 1,00 crédito**, tentado, **falha** — e o crédito é
**estornado**. O erro devolvido é só `"Generation failed"`, sem dizer o que
faltou; e a fila leva ~90 min para marcar `failed`, o que faz o defeito parecer
travamento.

O A/B é limpo: dois pedidos em `soul/v2/standard` **sem** `style_id` seguiam
`queued` mais de uma hora depois; o mesmo pedido **com**
`style_id=95151de0-e0e5-4e04-bd45-c58c8a4ac023` ("Street photography") entregou
em 35s.

Confirmação independente, no console: o job que falhou ontem trazia
`style_id: 464ea177-8d40-4940-8d9d-b438bab269c7` no payload de Input — e esse id
**não está** na lista de estilos do Soul V2.

```
POST https://platform.higgsfield.ai/higgsfield-ai/soul/v2/standard
  header Authorization: Key {key_id}:{key_secret}
  body   { prompt, style_id, style_strength, batch_size,
           resolution, aspect_ratio, enhance_prompt }
  → 200  { status, request_id, status_url, cancel_url }
GET https://platform.higgsfield.ai/v1/text2image/soul-styles/v2   # 33 estilos
```

Servem ao nosso caso documental: **Street photography**
(`95151de0-e0e5-4e04-bd45-c58c8a4ac023`) e **Editorial street style**
(`3d5584b2-4d15-48d2-8a09-c1073259f4c6`).

### Terceira correção minha, e a pior de método

Escrevi no Adendo 1, com ares de prova: *"492,32 + 4,68 = 497,00 — os créditos
do incidente saíram desta carteira"*. **Era coincidência numérica.** O saldo
subiu sozinho para **499,9** quando os jobs falharam e foram estornados: a conta
começou com **500** e nunca perdeu 4,68 coisa nenhuma. O incidente do ADR
original **não custou crédito** — foi tudo estornado.

Peguei dois números, achei que fechavam, e apresentei aritmética como evidência.
É a mesma família do erro que este ADR já registrava — tratar um sinal
conveniente como bússola —, agora com casas decimais em vez de mensagem de erro.

**Também cai o resto do Adendo 2:** o "0 API calls" era só o atraso horário do
painel (agora mostra **7 chamadas**), e billing sempre funcionou (cobra e
estorna). Nenhuma das duas hipóteses que eu tinha deixado de pé — gate de
billing ou bug de worker — era a certa. A resposta estava num campo do corpo.

⚠️ Achado colateral, sem efeito para nós: o cadastro de cartão **não persiste**
no console (o Stripe confirma, o toast diz "Payment method added successfully!",
e a caixa continua "No payment methods saved"). Como os jobs rodam sem cartão,
não bloqueia nada — mas se um dia o auto top-up for necessário, é um problema
deles a resolver.

### Armadilha 2: HTTP 403 por User-Agent

Ao gerar a comparação de estilos, os pedidos passaram a voltar **403 Forbidden**
— com o mesmo corpo, a mesma chave e o mesmo modelo que segundos antes davam 200.
A diferença era o cliente: `curl` passava, `python-urllib` não. **A proteção
deles barra o User-Agent padrão do urllib** (`Python-urllib/3.x`); com um UA
próprio, volta a funcionar.

Cheguei a atribuir o 403 a limite de concorrência (quatro pedidos em paralelo
falharam juntos) — era correlação, não causa: os quatro eram do mesmo cliente
Python. Um teste isolado com `curl` derrubou a hipótese.

⚠️ Consequência para o driver: **enviar `User-Agent` explícito**. Vale conferir
se o padrão do `fetch` do Node passa; se não passar, o sintoma vai ser um 403
inexplicável em produção, com tudo mais idêntico.

### O que mudou no código (FEITO em 22/07, com o OK do mantenedor)

`src/lib/images/higgsfield.ts`:

1. `MODELO` → `higgsfield-ai/soul/v2/standard`;
2. envia `style_id` + `style_strength` no corpo;
3. envia `User-Agent: personal-teacher-os/1.0`;
4. corrigido o comentário do topo, que afirmava usar o `@higgsfield/client`
   enquanto o código sempre usou `fetch` cru.

**Estilo escolhido: `General` (`3db34ab5-3439-4317-9e03-08dc30852e69`)**, decidido
pelo mantenedor entre quatro candidatos gerados na MESMA cena (General, Nature
light, Street photography, Editorial street style — em `out/estilos/`), com o
critério de parecer irmão das 33 fotos que já estão nos módulos 5–7. Custo do
experimento: 4 créditos.

Medições que viraram constante em vez de suposição:

- `3:2` + `1080p` no v2 → PNG **2016×1344** (folga para slide);
- prova de ponta a ponta pelo **driver real** (fetch do Node, não curl):
  imagem pronta em **26s**, request `891022c4-d6cb-4334-9b86-421c1304dbbe`.
  É o que responde à dúvida da armadilha 2 — com UA nosso, o Node passa.

Testes: `tests/images-higgsfield.test.ts` ganhou três casos que travam o
aprendizado do dia — o `/v2` no caminho, `style_id` presente em TODO pedido
(nos três enquadramentos) e o `User-Agent` em toda chamada. 21/21 verdes nos
testes de unidade de imagem. ⚠️ Os testes com banco (`images-biblioteca`) NÃO
foram executados nesta rodada: o Supabase local não estava no ar.

O estilo é **decisão de marca**, não detalhe técnico: ele governa a aparência de
todas as fotos das aulas. Vale escolher um e congelá-lo com a mesma disciplina
que o prompt (§ "O prompt é procedência"), gravando-o junto da imagem.

---

## Adendo 5 — 23/07, madrugada: a tela (IM-2) construída

O mantenedor confirmou o desenho do M2 e pediu a tela pronta. Construída em código
(NÃO em produção — a migration do IM-1 segue dormente e falta `GEMINI_API_KEY` no
servidor). Suíte 685/685, `tsc` e `next build` limpos.

### Descoberta que definiu o escopo

A IA de rascunho **não escreve endereços de imagem** (`draft.ts` não os gera), e o
editor de slide não expõe campo de imagem. Logo, uma tela que só preenchesse
endereços existentes ficaria **vazia justamente nas aulas novas (M8–M12)** — que
são o alvo. Então a tela gera a foto, **atribui um endereço** e o grava no
conteúdo.

### Convenção de endereço (determinística)

Cena sem foto → `m{módulo}/a{aula}-{tipo}` (ex.: `m8/a3-cover`). Endereço que o
slide já carrega (M5 à mão) é soberano. Colisão de dois slides do mesmo tipo
ganha sufixo de índice. `src/lib/images/slots.ts`, com teste.

### Decisões de desenho

- **Escrita no conteúdo na APROVAÇÃO, não na geração.** O conteúdo só passa a
  referenciar a foto quando ela é aprovada — senão um `reject` deixaria o slide
  apontando para um endereço sem imagem, e o deck estouraria `ImagensFaltando`.
- **Candidatas no Drive (durável).** Vão para o Drive já na geração; o estado
  `pronta` + `candidates` no banco fica consistente através de restart (que já
  aconteceu 2× em deploys). Aprovar promove a escolhida e apaga as outras do
  Drive (best-effort — órfã é clutter, não erro). Rota autenticada
  `/admin/slides/image/[fileId]` transmite os bytes para o `<img>` sem tornar o
  arquivo público.
- **Padrão de 1 candidata**, "4 opções" sob demanda. Geração em **paralelo** (o
  Gemini é síncrono, ~15s; em série, 4 seriam ~60s). Sem polling: clica, espera,
  vê. É a natureza síncrona do provedor.
- **Extensão da candidata vem do `mimeType`** (o Gemini devolve JPEG).

### Escopo v1 e limites conhecidos (para não virarem surpresa)

1. **Só imagens de CENA** (cover/warmup/dialogue/tip/section). Vocabulário
   (palavra→objeto) é outro estilo de prompt — v2.
2. **Aprovação é DEFINITIVA.** `aprovada` é terminal no portão (Lei 8,
   append-only) e o índice único barra uma 2ª foto viva no mesmo endereço. Logo
   **não há "trocar" uma foto já aprovada na v1** — por isso as candidatas
   aparecem ANTES, e a escolha é o momento de decidir. Trocar aprovada exige um
   caminho de *supersede* (migration nova) — follow-up deliberado, não algo para
   eu inventar sozinho.
3. **Gerar sobre endereço já vivo** (pendente/pronta) é barrado com mensagem
   clara ("reprove a atual antes"); sobre `aprovada`, idem via o índice único.
4. **`next build` valida a fiação**, mas o ciclo real (a dona clica → foto sai →
   Drive → aprova → deck usa) só se prova no app publicado, com a chave e a SA.
   É verificação pendente de deploy, não de código.

### Arquivos

`src/lib/images/slots.ts` (slots + endereço + escrita no conteúdo),
`src/lib/slides/drive.ts` (`uploadImage`, `deleteDriveFile`),
`src/app/admin/slides/actions.ts` (`generateImageAction`, `approveImageAction`,
`rejectImageAction`), `src/app/admin/slides/image/[fileId]/route.ts` (stream),
`src/app/admin/slides/[id]/ImagePanel.tsx` + fiação em `[id]/page.tsx`.
