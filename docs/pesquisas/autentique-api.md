# Pesquisa: API do Autentique para a assinatura de contrato

Ticket: issue 173. Data da leitura das fontes: 16/11/2026. Código lido no commit `743424c` da `main`.

## A pergunta

O que a API do Autentique (GraphQL, versão 2) permite de verdade nos pontos que o ADR-029 deixou para
conferir com a API real?

1. `createDocument` aceita chave idempotente ou identificador externo, e dá para buscar um documento por ele?
2. Qual é o formato real do id do documento?
3. Qual é a semântica dos erros: o que é definitivo e o que é transitório?
4. Como consultar os signatários de um documento, para provar que ele é mesmo daquele contrato?
5. Quais webhooks existem e como se autenticam?
6. Quais são as diferenças entre sandbox e produção?

## Como ler este arquivo

- **Fonte primária** aqui é a documentação oficial em `docs.autentique.com.br/api` (as páginas têm versão
  Markdown: basta acrescentar `.md` à URL; o índice é
  [llms.txt](https://docs.autentique.com.br/api/llms.txt)).
- O **schema completo** (todos os argumentos e tipos) só aparece na aba Docs do Altair da casa
  (`altair.autentique.com.br`), que exige chave de API
  ([Using Altair](https://docs.autentique.com.br/api/integration-basics/altair)). Esta pesquisa foi feita
  **sem chave**: tudo o que depende do schema está na seção "O que não deu para confirmar".
- Uma única chamada foi feita à API real, sem credencial nenhuma (introspecção recusada): devolveu
  `HTTP 401` com corpo `{"message":"unauthorized"}`. Está marcada como "observado" onde é usada.
- "A doc não diz" significa exatamente isso: ausência na documentação pública, não prova de ausência na API.

## O que o projeto assume hoje

| # | Suposição | Onde |
|---|---|---|
| A1 | Endpoint `POST https://api.autentique.com.br/v2/graphql`, `Authorization: Bearer <token>` | `src/lib/autentique/client.ts:3`, `:23`, `:137` |
| A2 | `createDocument` é multipart (`operations`, `map`, `file`), com `sandbox` como argumento da mutation | `src/lib/autentique/client.ts:4-8`, `:25-36`, `:117-128` |
| A3 | O documento vai só com `name`; signatários só com `email` e `action: 'SIGN'` | `src/lib/autentique/client.ts:119-123`; `src/app/admin/contratos/actions.ts:409-414` |
| A4 | Id do documento é "string hex longa (não UUID)"; a guarda do banco aceita `^[A-Za-z0-9_-]{8,128}$` | `src/lib/autentique/client.ts:9`; `supabase/migrations/20260727001500_correcoes_sol_rodada_5.sql:530` |
| A5 | Não existe chave de idempotência documentada; por isso a reserva local nasce antes da chamada e falha ambígua só se resolve por ato humano | `src/lib/autentique/client.ts:90-109`; `src/app/admin/contratos/actions.ts:376-404`, `:432-439` |
| A6 | `errors[]` sem id e com HTTP < 500 = "não criou"; 4xx = "não criou"; rede, timeout, 5xx, corpo ilegível e 200 sem id = "ambíguo" | `src/lib/autentique/client.ts:170-204` |
| A7 | O link de assinatura vem em `signatures[0].link.short_link` | `src/lib/autentique/client.ts:207` |
| A8 | Consulta de estado: `document(id: $id)` com `$id: UUID!`, lendo `viewed`, `signed`, `rejected` de cada assinatura; só confere `res.ok`; "assinado" = todas as assinaturas com `signed` | `src/lib/autentique/client.ts:212-234` |
| A9 | Webhook autenticado por HMAC-SHA256 do corpo cru, em hex, no cabeçalho `x-autentique-signature`, com UM segredo (`AUTENTIQUE_WEBHOOK_SECRET`) | `src/lib/webhooks/autentique.ts:31-46`; `src/app/api/webhooks/autentique/route.ts:8-12` |
| A10 | Payload do webhook: `{ id, event: { id, type, data: { object } } }`, com o documento em `data.object.id` (eventos `document.*`) ou em `data.object.document.id` (eventos `signature.*`) | `src/lib/webhooks/autentique.ts:17-24`, `:188-192`; `supabase/migrations/20260727001500_correcoes_sol_rodada_5.sql:735-736`; fixture em `tests/ct-webhook-autentique-evolution.test.ts:40` |
| A11 | Eventos tratados: `signature.viewed`, `signature.accepted` (andamento), `signature.rejected`, `document.finished`, `document.deleted`; o resto é ignorado | `src/lib/webhooks/autentique.ts:71-77`; `supabase/migrations/20260727001600_correcoes_sol_rodada_6.sql:69-84` |
| A12 | Reenvio do provedor: 3 tentativas extras (60/120/300 s); dedupe por `event.id` na inbox | `src/lib/webhooks/autentique.ts:10-11`, `:96-104` |
| A13 | "A autenticação HMAC do webhook é do plano Pro"; por isso hoje o estado é consultado sob demanda e o segredo não é cadastrado | `src/app/admin/contratos/actions.ts:541-545`; `.env.example:106-107` |
| A14 | PDF de até 8 MB | `src/app/admin/contratos/actions.ts:355` |
| A15 | Sem `AUTENTIQUE_TOKEN` a superfície de assinatura fica desligada | `src/lib/autentique/gate.ts:25-27`; ADR-029 §1 |

O que o ADR-029 deixou para a fase do token (`docs/decisions/029-autentique-conclui-no-gate.md:10-13` e
`:25-28`): formato real dos ids, semântica exata dos erros GraphQL, ordem dos webhooks, chave de idempotência
no cliente, prova do ciclo com a API verdadeira e a consulta de duplicatas antes de ligar o índice.

## Fatos achados, ponto a ponto

### 1. Idempotência e identificador externo

- **A doc não descreve chave de idempotência nem identificador externo em `createDocument`.** Os argumentos
  documentados da mutation são `document`, `signers`, `file`, `sandbox`, `organization_id` e `folder_id`. Os
  campos documentados de `DocumentInput` são `name`, `message`, `reminder`, `whatsapp_template`, `sortable`,
  `footer`, `footer_type`, `refusable`, `qualified`, `scrolling_required`, `stop_on_rejected`,
  `new_signature_style`, `show_audit_page`, `ignore_cpf`, `ignore_birthdate`, `email_template_id`,
  `deadline_at`, `watchers`, `cc`, `expiration`, `configs` e `locale`. Nenhum é um id do integrador.
  Fonte: [Creating a document](https://docs.autentique.com.br/api/mutations/criando-um-documento).
- **Nenhum cabeçalho de idempotência é citado** na introdução, na página de criação nem na de erros.
  Fontes: [Introduction](https://docs.autentique.com.br/api/master),
  [Error messages](https://docs.autentique.com.br/api/integration-basics/mensagens-de-erro).
- **Busca documentada:** `document(id:)` (só pelo id do provedor), `documents(limit, page)` com as flags
  `showSandbox` e `onlySandbox`, e `documentsByFolder(folder_id, limit, page)`. Não há argumento de busca por
  nome ou por campo do integrador na doc.
  Fontes: [Retrieving documents](https://docs.autentique.com.br/api/queries/resgatando-documentos),
  [Sandbox/tests](https://docs.autentique.com.br/api/integration-basics/sandbox-testes).
- **O que a doc permite como correlação indireta** (fatos, não desenho): o `name` do documento é texto livre
  escolhido por quem cria, volta em `document`, em `documents` e no payload dos webhooks de documento
  (`event.data.name`); `folder_id` pode ser passado na criação e a listagem por pasta existe; cada assinatura
  devolve o `email` do signatário. Fontes: as duas páginas acima e
  [Webhooks](https://docs.autentique.com.br/api/integration-basics/webhooks).
- **Custo de listar para conferir:** "Retrieve document data" é cobrado por documento devolvido
  (US$ 0,0002 cada), não por consulta. Fonte: [API pricing](https://docs.autentique.com.br/api/api-pricing).
- **Indício do próprio fornecedor de que não há retry idempotente:** no conector MCP deles, a orientação para
  "documento não pôde ser criado" é preparar um upload novo e tentar de novo de propósito, sem reaproveitar o
  identificador do upload que falhou.
  Fonte: [MCP troubleshooting](https://docs.autentique.com.br/api/autentique-mcp/troubleshooting).

Resposta: (a) chave idempotente ou `external_id`: **não documentado**; (b) achar documento pelo id da reserva:
**não há consulta nativa**; só por correlação indireta (nome, pasta, e-mail do signatário, data).

### 2. Formato do id do documento

- **Não é UUID com hífens.** Os três exemplos de id de documento na doc de webhooks são sequências longas de
  minúsculas e dígitos, sem separador, de 49, 50 e 52 caracteres (por exemplo `acf7d351a966…803d`, 52). Um
  deles tem a letra `s` (não é hexadecimal puro) e, dentro de um mesmo exemplo, o id aparece com 52 e com 49
  caracteres: os exemplos foram editados à mão e **não servem para fixar comprimento**.
  Fonte: [Webhooks](https://docs.autentique.com.br/api/integration-basics/webhooks).
- **O tipo GraphQL se chama `UUID`** mesmo assim: `updateDocument($id: UUID!)`, `createSigner($document_id:
  UUID!)`, e as páginas de remoção descrevem o id como "String (UUID!)".
  Fontes: [Editing a document](https://docs.autentique.com.br/api/mutations/editing-a-document),
  [Adding a signer](https://docs.autentique.com.br/api/mutations/adding-a-signer),
  [Removing a document](https://docs.autentique.com.br/api/mutations/removing-a-document).
- **O id aparece na URL do painel**: os links de arquivo têm a forma
  `https://painel.autentique.com.br/documentos/<id>/assinado.pdf`. Fonte: página de Webhooks.
- **Outros ids, para não confundir:** a assinatura se identifica por `public_id` (UUID com hífens nos exemplos
  de webhook; 32 hex sem hífen no exemplo de `createSigner`); o evento do webhook tem `event.id` em UUID; o
  `id` de topo do webhook é base64 de `<número>|<event.id>`; o id de usuário em `me` tem 40 hex; no webhook
  antigo (descontinuado) o documento vinha em `documento.uuid` com 32 hex.
  Fontes: página de Webhooks, [Adding a signer](https://docs.autentique.com.br/api/mutations/adding-a-signer),
  [Fetch current user](https://docs.autentique.com.br/api/queries/fetch-current-user),
  [Webhooks (deprecated)](https://docs.autentique.com.br/api/integration-basics/webhooks-1).

### 3. Semântica dos erros

O que a doc afirma:

- **Formato:** a resposta é `{ "errors": ..., "data": ... }`, e `errors` só vem quando houve exceção. Três
  famílias, todas em `errors[]`: (1) consulta GraphQL inválida (só `message` e `locations`, sem `data`);
  (2) erro de negócio com `path` e o campo em `data` nulo (exemplo: "Folder not found", `data.folder: null`);
  (3) validação, com `message: "validation"`, `extensions.category: "validation"` e
  `extensions.validation` mapeando campo para chaves como `field_required`.
  Fonte: [Error messages](https://docs.autentique.com.br/api/integration-basics/mensagens-de-erro).
- **Chaves de erro listadas:** `unauthorized`, `document_not_found`, `folder_not_found`, `document_signed`,
  `not_your_turn`, `must_be_a_string`, `must_be_an_array`, `not_a_valid_date`,
  `must_be_a_valid_email_address`, `must_be_a_file`, `failed_to_upload`, `could_not_upload_file`,
  `field_required`, `unavailable_credits`, `unavailable_verifications_credits`, `may_not_be_greater_than`,
  `must_be_at_least`, `format_is_invalid`, `invalid_date`, `without_permission`, `must_be_a_valid_file`,
  `not_a_member_of_organization`. Outras aparecem em páginas específicas:
  `sms_delivery_not_allowed_on_foreign_documents` (criação) e `too_many_resent_emails` (reenvio).
  Fontes: página de erros, [Creating a document](https://docs.autentique.com.br/api/mutations/criando-um-documento),
  [Resend signatures](https://docs.autentique.com.br/api/mutations/resend-signatures).
- **Erro de GraphQL vem com HTTP 200.** A doc de OAuth diz isso com todas as letras e distingue dois casos de
  autorização: `HTTP 401` com `{"message":"unauthorized"}` (token ausente, inválido, expirado ou revogado) e
  `HTTP 200` com `errors[].message = "Unauthorized"` (token aceito, permissão faltando).
  Fonte: [OAuth errors and security](https://docs.autentique.com.br/api/integration-basics/oauth2/oauth-errors-and-security).
  Observado em 16/11/2026: requisição sem token devolveu exatamente `401` + `{"message":"unauthorized"}`
  (corpo fora do formato `errors[]`).
- **Limite de requisições:** `HTTP 429` com `{"message": "Too Many Attempts."}`. O teto é por token e por
  plano: 10/min no gratuito, 60/min no profissional, 200/min no corporativo.
  Fontes: página de erros, [API pricing](https://docs.autentique.com.br/api/api-pricing).
- **Cota:** o plano gratuito cria até 10 documentos por mês pela API; o erro correspondente é
  `unavailable_credits`. Fontes: as duas páginas acima.
- **Tamanho do arquivo:** 5 MB no plano gratuito, 20 MB no profissional.
  Fonte: [Creating a document](https://docs.autentique.com.br/api/mutations/criando-um-documento).

O que a doc **não** afirma: ela não classifica erro como definitivo ou transitório, não cita 5xx nem tempo
limite, e não diz se `createDocument` é atômica (se um `errors[]` garante que nenhum documento nasceu). A
leitura abaixo é **derivada**, não citada:

| Resposta | Leitura derivada | Documento existe? |
|---|---|---|
| `401` + `{"message":"unauthorized"}` | Definitivo até trocar a credencial | Não (recusa antes de executar) |
| `429` + "Too Many Attempts." | Transitório (janela de 1 minuto) | Não |
| `200` + `errors[]` de consulta inválida (sem `data`) | Definitivo (defeito do cliente) | Não |
| `200` + `errors[]` de validação, `data.createDocument: null` | Definitivo até mudar a entrada | Provavelmente não; a doc não garante |
| `200` + `unavailable_credits`, `without_permission`, `must_be_a_valid_file` | Definitivo até mudar plano, permissão ou arquivo | Provavelmente não; a doc não garante |
| `200` + `failed_to_upload` ou `could_not_upload_file` | Indeterminado (pode ser falha passageira de armazenamento) | Não documentado |
| 5xx, timeout, conexão caída | Não documentado | Não documentado |

### 4. Consulta de documento e signatários

- **`document(id: "...")`** devolve, entre outros: `id`, `name`, `refusable`, `sortable`, `created_at`,
  `files { original signed pades }` e `signatures`. Cada assinatura tem `public_id`, `name`, `email`,
  `created_at`, `action { name }`, `link { short_link }`, `user { id name email phone }`,
  `user_data { name email phone }`, `email_events { sent opened delivered refused reason }` e os eventos
  `viewed`, `signed`, `rejected`, `signed_unapproved`, `biometric_approved`, `biometric_rejected` (cada um com
  `ip`, `port`, `reason`, `created_at`, `geolocation`).
  Fonte: [Retrieving documents](https://docs.autentique.com.br/api/queries/resgatando-documentos).
- **Dá para consultar vários documentos numa chamada** com apelidos (`a: document(id: ...) { ... }`).
  Mesma fonte.
- **Para provar que o documento é do contrato**, a doc oferece: `name` (escolhido na criação), `created_at`,
  e o `email` de cada assinatura. Não há campo do integrador (ver ponto 1).
- **`link { short_link }` só vem para signatário adicionado por `name`**; para signatário por e-mail o
  exemplo oficial de resposta traz `"link": null`. Link para signatário por e-mail se gera com
  `createLinkToSignature(public_id)`.
  Fontes: página acima (comentário na query), [Adding a signer](https://docs.autentique.com.br/api/mutations/adding-a-signer),
  [Create signature link](https://docs.autentique.com.br/api/mutations/create-signature-link).
- **O fornecedor pede para não consultar com frequência** ("webhooks são o caminho") e cobra por documento
  devolvido. Fontes: [Retrieving documents](https://docs.autentique.com.br/api/queries/resgatando-documentos),
  [API pricing](https://docs.autentique.com.br/api/api-pricing).
- **Documento inexistente** é erro de negócio (`document_not_found`) e, pelo padrão da página de erros, vem
  com HTTP 200 e `data.document: null`.
  Fonte: [Error messages](https://docs.autentique.com.br/api/integration-basics/mensagens-de-erro).
- **Excluir não bloqueia:** `deleteDocument(id)` em documento já assinado por alguém só o move para a lixeira
  de quem pediu; para impedir novas assinaturas a doc recomenda `updateDocument` com `deadline_at` igual a
  agora. Fonte: [Removing a document](https://docs.autentique.com.br/api/mutations/removing-a-document).

### 5. Webhooks

- **Cadastro:** endpoints são cadastrados no painel, escolhendo os eventos. Entrega por HTTPS, `POST`, corpo
  JSON com um objeto de evento. O formato antigo (um URL de callback, corpo `x-www-form-urlencoded`) não
  aceita cadastro novo. Fontes: [Webhooks](https://docs.autentique.com.br/api/integration-basics/webhooks),
  [Webhooks (deprecated)](https://docs.autentique.com.br/api/integration-basics/webhooks-1).
- **Autenticação:** HMAC-SHA256 em hexadecimal, no cabeçalho `x-autentique-signature`, calculado com o
  segredo do endpoint. Os exemplos em PHP e Node assinam o corpo cru; os de Python e Ruby reserializam o JSON
  em forma compacta antes de calcular. No passo a passo a verificação aparece como opcional ("se desejar");
  nas boas práticas, como "crucial". **Não há carimbo de tempo nem proteção contra repetição** no esquema
  documentado. Fonte: página de Webhooks.
- **De onde vem o segredo:** a página de Webhooks não diz. A única menção está na API do plano corporativo:
  a mutation `createEndpoint` devolve `secret` junto do endpoint criado.
  Fonte: [Criando endpoint para receber webhooks](https://docs.autentique.com.br/api/corporate/mutations/gestao-de-endpoints-de-webhooks/criando-endpoint-para-receber-webhooks).
- **Endpoint tem tipo e formato** (na API corporativa): `type` é `DOCUMENT`, `SIGNATURE` ou `MEMBER`, e "o
  tipo selecionado define quais eventos serão vinculados"; `format` é `JSON` ou `URLENCODED`. Os exemplos de
  payload da página de Webhooks vêm de endpoints com nomes distintos por tipo. Mesma fonte e página de
  Webhooks.
- **Eventos:**
  - documento: `document.created`, `document.updated`, `document.deleted` ("excluído permanentemente"),
    `document.finished` ("todas as assinaturas ou etapas concluídas");
  - assinatura: `signature.created`, `signature.updated`, `signature.deleted`, `signature.viewed`,
    `signature.accepted` (aquele signatário concluiu), `signature.rejected`, `signature.biometric_approved`,
    `signature.biometric_unapproved`, `signature.biometric_reset`, `signature.biometric_rejected`,
    `signature.delivery_failed` (erro ao enviar o e-mail ao signatário);
  - membro: `member.created`, `member.deleted`.
  O enum da API corporativa lista também `SIGNATURE_BIOMETRIC_FAILED` e não lista `delivery_failed`.
  Fontes: as duas páginas acima.
- **Formato do payload** (exemplos JSON da página): topo com `id`, `object: "webhook"`, `name`, `format`,
  `url` e `event`; `event` com `id`, `object: "event"`, `organization`, `type`, `data`, `previous_attributes`
  (em `*.updated`) e `created_at`. Nos exemplos JSON, **`event.data` é o próprio recurso**: em evento de
  documento, `event.data.id` é o id do documento e `event.data.object` é a string `"document"`; em evento de
  assinatura, `event.data.public_id` identifica a assinatura, `event.data.object` é a string `"signature"` e
  **`event.data.document` é o id do documento como string**. O documento traz `name`, `sandbox`,
  `signatures_count`, `signed_count`, `rejected_count`, `deleted_at`, `deadline_at` e a lista de assinaturas.
- **A própria doc se contradiz sobre o payload:** os trechos de código da mesma página (PHP, Go, Java, Node,
  Python, Ruby) leem o recurso em `event.data.object`, como se `object` fosse o recurso inteiro.
- **Ordem não garantida:** a doc diz que os eventos não chegam na ordem em que foram gerados e manda usar a
  API para buscar o que faltar.
- **Duplicata:** o mesmo evento pode chegar mais de uma vez; a doc manda guardar os ids de evento já
  processados e, para o caso de "dois webhooks do mesmo evento", usar o id do objeto em `event.data` junto com
  `event.type`.
- **Falha e reenvio:** resposta não 2xx entra na lista de falhas do painel e sofre até 3 novas tentativas,
  após 60, 120 e 300 segundos; depois disso o evento fica na lista por até 14 dias e pode ser reenviado à mão.
  A doc pede resposta 2xx rápida, antes de qualquer lógica pesada. **Não há menção a desativar o endpoint que
  falha.** Fontes: página de Webhooks, [API pricing](https://docs.autentique.com.br/api/api-pricing).
- **Custo:** cada entrega de webhook é cobrada (US$ 0,00004); a entrega que falha também é cobrada, o reenvio
  não. Fonte: [API pricing](https://docs.autentique.com.br/api/api-pricing).
- **Plano:** a doc não condiciona webhooks nem HMAC a plano algum. O que ela diz sobre planos é que o uso da
  API segue os mesmos planos da aplicação web e que o gratuito não tem taxa e fica em 10 documentos por mês.
  Mesma fonte.

### 6. Sandbox e produção

- **Mesmo endpoint, mesma chave.** O que muda é o argumento `sandbox: true` em `createDocument`; não existe
  host nem token separado de teste.
  Fonte: [Sandbox/tests](https://docs.autentique.com.br/api/integration-basics/sandbox-testes).
- **Documento de sandbox não consome crédito nem é cobrado, e é apagado "depois de alguns dias"** (a doc não
  diz quantos). Fontes: página acima, [API pricing](https://docs.autentique.com.br/api/api-pricing).
- **Não tem valor de prova:** documento de sandbox "não gera trilha de auditoria e não pode ser usado para
  verificar assinatura ou autenticar documento"; a doc proíbe usar documento real em sandbox.
  Fonte: [API pricing](https://docs.autentique.com.br/api/api-pricing).
- **Fica escondido por padrão:** `documents` não devolve sandbox sem `showSandbox: true` (ou
  `onlySandbox: true`), e o painel só os mostra com uma opção ligada na página de chaves de API.
  Fonte: página de Sandbox.
- **Dá para reconhecer depois:** o objeto documento tem o campo `sandbox` (no webhook e em
  `documentsByFolder`). Fontes: página de Webhooks,
  [Retrieving documents](https://docs.autentique.com.br/api/queries/resgatando-documentos).
- **Limite de requisições e de tamanho de arquivo são descritos por plano**, e a doc não abre exceção para
  sandbox. Fontes: [API pricing](https://docs.autentique.com.br/api/api-pricing),
  [Creating a document](https://docs.autentique.com.br/api/mutations/criando-um-documento).

## Onde a documentação contradiz o código

| # | O código | A documentação | Efeito prático |
|---|---|---|---|
| C1 | Em evento `signature.*`, lê o documento em `data.object.document.id` (`src/lib/webhooks/autentique.ts:22`, `:190-191`; SQL em `supabase/migrations/20260727001500_correcoes_sol_rodada_5.sql:735-736`) | Nos exemplos, o documento de uma assinatura é **string** (`document: "<id>"`), e a assinatura não tem `id`, só `public_id` | Nas duas leituras possíveis do payload, `signature.viewed`, `signature.accepted` e `signature.rejected` terminam em "evento sem id de documento": marcados como processados, sem mexer no contrato. A recusa do signatário não chegaria ao espelho |
| C2 | Lê o recurso em `event.data.object` (`src/lib/webhooks/autentique.ts:190`) | Os exemplos JSON põem o recurso direto em `event.data` (`object` é só a etiqueta `"document"`); os trechos de código da mesma página leem `event.data.object` | Se valer o JSON, também `document.finished` e `document.deleted` ficam sem id de documento. A fixture dos testes (`tests/ct-webhook-autentique-evolution.test.ts:40`) segue o formato do código, não o do JSON |
| C3 | `signLink` vem de `signatures[0].link.short_link` (`src/lib/autentique/client.ts:207`) | `link` só é preenchido para signatário criado por `name`; por e-mail vem `null` | Como o projeto só cria signatário por e-mail (A3), `signLink` será sempre nulo. Link por e-mail exige `createLinkToSignature` |
| C4 | `getDocumentSignatures` só confere `res.ok` e trata ausência de assinaturas como "sem movimento" (`src/lib/autentique/client.ts:224-233`; `src/app/admin/contratos/actions.ts:564-567`) | `document_not_found` e falta de permissão chegam com **HTTP 200** e `errors[]`, com `data.document: null` | Documento apagado, id errado ou token sem permissão viram "Ainda sem movimento nesta assinatura" em vez de erro |
| C5 | Limite local de 8 MB (`src/app/admin/contratos/actions.ts:355`) | 5 MB no plano gratuito, 20 MB no profissional | No gratuito, PDF entre 5 e 8 MB passa pela tela e é recusado pelo provedor |
| C6 | "HMAC do webhook é do plano Pro" (`src/app/admin/contratos/actions.ts:541`; `.env.example:106`) | Nenhuma página condiciona webhook ou HMAC a plano | Não é contradição provada: é afirmação sem fonte na doc. Conferir no painel |
| C7 | Um segredo, uma rota (`src/app/api/webhooks/autentique/route.ts:12`) | Endpoint tem tipo (`DOCUMENT`, `SIGNATURE`, `MEMBER`) e o tipo define os eventos; cada criação devolve um `secret` | Se o painel também separar por tipo, receber `document.*` e `signature.*` pede dois endpoints, possivelmente com dois segredos |

O que a doc **confirma** no código: endpoint e cabeçalho (A1); multipart e `sandbox` como argumento (A2); id
longo sem hífen, aceito pela guarda do banco (A4); ausência de chave de idempotência documentada (A5); HMAC
SHA-256 em hex do corpo cru em `x-autentique-signature` (A9); `signature.accepted` é de um signatário e só
`document.finished` fala do documento inteiro (A11); 3 reenvios em 60/120/300 s e dedupe por `event.id` (A12);
ordem não garantida, que o "evento preso" da inbox já cobre; `$id: UUID!` como tipo do id (A8). A
classificação de falhas (A6) é compatível com tudo o que a doc afirma: `401` e `429` são recusas sem execução
e 5xx não é documentado.

## O que não deu para confirmar só pela documentação

Cada item pede uma chave de API e documentos em sandbox.

1. **Schema real**: argumentos de `createDocument`, campos de `DocumentInput` e argumentos de `documents`, pela
   aba Docs do Altair. É onde se descobre se existe campo ou filtro não documentado. Indício de baixa
   confiança: um cliente comunitário ([pacote npm `n8n-nodes-autentique`](https://www.npmjs.com/package/n8n-nodes-autentique))
   chama `documents(search:, status:, folder_id:, order_by:, order_direction:)`; o mesmo pacote usa tipos que
   divergem da doc oficial, então vale só como pista.
2. **Forma real do payload do webhook** (C1 e C2): `event.data` é o recurso ou `event.data.object` é? Em
   evento de assinatura, `document` é string ou objeto? Capturar um payload real de cada evento tratado.
3. **O que o HMAC assina**: o corpo cru byte a byte ou o JSON reserializado; e se existe cabeçalho de tempo
   (o pacote comunitário acima cita `x-autentique-timestamp`, que a doc oficial não menciona).
4. **Segredo e plano** (C6 e C7): onde o painel mostra o segredo, se webhook ou HMAC exigem plano pago, e se
   um endpoint recebe eventos de documento e de assinatura ao mesmo tempo.
5. **Formato exato do id do documento**: comprimento e alfabeto reais (os exemplos da doc divergem entre si).
6. **Atomicidade de `createDocument`**: se `errors[]` (em especial `failed_to_upload`,
   `could_not_upload_file` e `unavailable_credits`) garante que nenhum documento foi criado e nenhum e-mail
   saiu; e como a API responde a 5xx e a timeout.
7. **Corpo e status de token inválido** (não ausente) e de token sem permissão numa chamada real.
8. **Autor na lista de assinaturas**: se quem cria o documento entra em `signatures` sem ser signatário. A doc
   só diz que `signature.viewed` dispara na criação "se o autor for signatário". Importa para
   `signatures[0]` (A7) e para a regra "todas assinaram" (A8).
9. **Padrões de `refusable` e `stop_on_rejected`** quando o documento vai só com `name` (A3): se o signatário
   consegue recusar e o que acontece com o outro signatário do contrato de casal depois de uma recusa.
10. **Sandbox**: se envia e-mail de verdade ao signatário, se dispara webhooks, em quantos dias apaga, e se a
    limpeza automática emite `document.deleted` (que o projeto mapeia para "cancelado").
11. **`document.deleted`**: se dispara ao mover para a lixeira ou só na exclusão permanente, e se um documento
    já assinado por alguém chega a emitir o evento.
12. **Eventos repetidos com `event.id` diferente** para o mesmo fato (a doc sugere deduplicar também por
    objeto mais tipo).
13. **Pedido público de "identificador no webhook"** no quadro de sugestões do fornecedor: a página existe mas
    recusou leitura automatizada (HTTP 403); não foi possível ver a resposta oficial.

## Fontes

- [Índice da documentação](https://docs.autentique.com.br/api/llms.txt)
- [Introduction](https://docs.autentique.com.br/api/master)
- [Using Altair](https://docs.autentique.com.br/api/integration-basics/altair)
- [Sandbox/tests](https://docs.autentique.com.br/api/integration-basics/sandbox-testes)
- [Webhooks](https://docs.autentique.com.br/api/integration-basics/webhooks)
- [Webhooks (deprecated)](https://docs.autentique.com.br/api/integration-basics/webhooks-1)
- [Error messages](https://docs.autentique.com.br/api/integration-basics/mensagens-de-erro)
- [OAuth errors and security](https://docs.autentique.com.br/api/integration-basics/oauth2/oauth-errors-and-security)
- [Retrieving documents](https://docs.autentique.com.br/api/queries/resgatando-documentos)
- [Fetch current user](https://docs.autentique.com.br/api/queries/fetch-current-user)
- [Creating a document](https://docs.autentique.com.br/api/mutations/criando-um-documento)
- [Editing a document](https://docs.autentique.com.br/api/mutations/editing-a-document)
- [Removing a document](https://docs.autentique.com.br/api/mutations/removing-a-document)
- [Adding a signer](https://docs.autentique.com.br/api/mutations/adding-a-signer)
- [Create signature link](https://docs.autentique.com.br/api/mutations/create-signature-link)
- [Resend signatures](https://docs.autentique.com.br/api/mutations/resend-signatures)
- [API pricing](https://docs.autentique.com.br/api/api-pricing)
- [MCP troubleshooting](https://docs.autentique.com.br/api/autentique-mcp/troubleshooting)
- [Criando endpoint para receber webhooks (API corporativa)](https://docs.autentique.com.br/api/corporate/mutations/gestao-de-endpoints-de-webhooks/criando-endpoint-para-receber-webhooks)
