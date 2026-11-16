# Pesquisa: Hotmart Club API hoje (progresso, eventos e credenciais)

Ticket: issue 172. Leitura feita em 16/11/2026, só em fonte primária: a documentação oficial de
desenvolvedores da Hotmart (`developers.hotmart.com/docs/pt-BR`) e a central de ajuda oficial
(`help.hotmart.com/pt-br`). Nenhuma chamada real à API foi feita: não há credencial neste ambiente, então
tudo aqui é o que a documentação **diz**, não o que a API **faz**.

## A pergunta

O que a Hotmart Club API garante hoje sobre progresso, eventos e credenciais?

1. `GET /club/api/v1/users`: campos de progresso, paginação, limite de requisições, e se o percentual de um
   aluno pode diminuir (por exemplo, quando o produtor acrescenta módulo).
2. Webhooks `CLUB_FIRST_ACCESS` e `CLUB_MODULE_COMPLETED`, versão 2.0.0: formato do evento, identificador
   único, autenticação por hottok, política de reenvio e de desativação da URL que falha.
3. O que o produtor precisa criar no painel (credenciais, subdomínio da área de membros) e em que ordem.

Pergunta que ficou aberta no desenho da Fase 5: o que fazer quando o progresso lido é menor que o já gravado.

## Resposta curta

- Endpoints, hosts, parâmetros e nomes de campo que o código usa **batem** com a documentação.
- A documentação **não diz** se o percentual pode diminuir, nem como ele é recalculado quando o curso muda.
  Ela só define os três campos: percentual de páginas concluídas, total de páginas e páginas concluídas. A
  frase do projeto "a Hotmart pode legitimamente regredir" é suposição, não fato documentado.
- O mesmo endpoint devolve `total` e `completed` junto do percentual. O código lê só o percentual e joga os
  outros dois fora, embora a tabela e a RPC já tenham onde guardá-los. Sem eles, não há como distinguir depois
  "o curso cresceu" de "o aluno regrediu".
- Reenvio automático de webhook: até cinco vezes. Desativação automática da configuração quando a URL dá
  erro: documentada, **sem** dizer quantos erros bastam nem como reativar.
- O evento de módulo completo não é garantido para quem consome pelo aplicativo móvel (depende da versão do
  app). O polling continua necessário.

## O que o projeto assume hoje

### Cliente (`src/lib/hotmart/client.ts`)

| O que assume | Onde |
|---|---|
| Token por `POST https://api-sec-vlc.hotmart.com/security/oauth/token` com `grant_type=client_credentials`, `client_id` e `client_secret` na query e `Authorization: Basic <terceiro valor da credencial>` | `client.ts:4-7`, `client.ts:31`, `client.ts:39-43` |
| Token dura cerca de 48 h (`expires_in` ~172799 s); fica em memória do processo e é renovado só por tempo (margem de 60 s) | `client.ts:35-53` |
| Resposta diferente de 2xx em qualquer chamada vira exceção; não há novo pedido de token ao receber 401 | `client.ts:44-46`, `client.ts:73`, `client.ts:92` |
| Progresso em `GET https://developers.hotmart.com/club/api/v1/users?subdomain=...` com `Bearer`; lê `items[].email` e `items[].progress.completed_percentage` | `client.ts:8-10`, `client.ts:32`, `client.ts:56-60`, `client.ts:95-96` |
| Paginação por `max_results=100` e `page_token`, seguindo `page_info.next_page_token`; teto de 50 páginas, sem erro se o teto for atingido | `client.ts:87-99` |
| O filtro `email` aceita e-mail parcial, então o código casa o e-mail exato; lê só a primeira página da resposta filtrada | `client.ts:69-79` |
| Limite de 500 requisições por minuto | `client.ts:11-12` |
| `total` e `completed` existem no tipo, mas não saem da função: `listAllProgress` devolve só e-mail → percentual | `client.ts:59`, `client.ts:82`, `client.ts:95-96` |
| Quatro variáveis obrigatórias (`HOTMART_CLIENT_ID`, `HOTMART_CLIENT_SECRET`, `HOTMART_BASIC`, `HOTMART_SUBDOMAIN`); sem qualquer uma, nada é chamado | `client.ts:22-29`, `.env.example:110-113` |
| Hosts de produção fixos no código (não há como apontar para o sandbox sem mudar código) | `client.ts:31-32` |

### Polling (`src/lib/jobs/sync-hotmart.ts`, `src/app/api/jobs/sync-hotmart/route.ts`)

- Roda 1 a 2 vezes por dia e é tratado como a fonte **autoritativa** (`sync-hotmart.ts:4-7`).
- Vínculo aluno ↔ Hotmart é o e-mail guardado em `mentorship_contracts.external_user_ref`
  (`sync-hotmart.ts:42-45`, `sync-hotmart.ts:67-68`).
- Para cada contrato ativo com e-mail encontrado, chama `sync_course_progress` passando só contrato e
  percentual (`sync-hotmart.ts:78-81`). Os parâmetros de páginas da RPC ficam sem uso.
- E-mail do vínculo que não aparece na Hotmart vira `hotmart_divergence` visível (`sync-hotmart.ts:69-76`);
  e-mail da Hotmart sem contrato volta em `hotmart_sem_vinculo` (`sync-hotmart.ts:92-95`).
- API fora do ar: responde 200 com `ok: false`, sem gravar nada (`sync-hotmart.ts:50-55`).

### Webhook (`src/lib/webhooks/hotmart.ts`, `src/app/api/webhooks/hotmart/route.ts`)

| O que assume | Onde |
|---|---|
| Autenticidade pelo cabeçalho `X-HOTMART-HOTTOK`, token fixo da conta, sem HMAC | `hotmart.ts:7`, `route.ts:20-21` |
| Hottok ausente, errado ou variável `HOTMART_HOTTOK` não configurada → **401**, sem gravar nada | `hotmart.ts:44-48` |
| Corpo que não é JSON → **400** | `route.ts:11-16` |
| Formato `{ id, creation_date (epoch em ms), event, data: { user: { email }, module?: { id }, product? } }` | `hotmart.ts:8-9`, `hotmart.ts:17-26` |
| `id` é a chave natural do evento e se repete em reenvios; sem `id`, usa hash de evento + e-mail + data | `hotmart.ts:51-58` |
| "A Hotmart desativa URL que falha (retry 5x)", por isso erro de negócio responde 200; **500** só quando a gravação na inbox falha | `hotmart.ts:10-13`, `hotmart.ts:67-70`, `hotmart.ts:92-98` |
| Aluno identificado só pelo e-mail; `data.product.id` não é conferido | `hotmart.ts:104-124` |
| `CLUB_FIRST_ACCESS` → `apply_course_first_access` com o instante cru; é a única origem automática de `course_start_date` | `hotmart.ts:126-137` |
| `CLUB_MODULE_COMPLETED` não traz percentual; o evento dispara uma busca pontual na API e chama `apply_module_progress` | `hotmart.ts:139-158`, `route.ts:23-24` |

### No banco: o que acontece quando o progresso lido é menor que o gravado

Hoje há **dois comportamentos**, conforme o caminho por onde o número chega:

1. **Pelo polling (`sync_course_progress`): o número menor sobrescreve o maior.** A função grava o que
   recebe, sem comparar (`supabase/migrations/20260715000100_fase5_sync_course_progress.sql:43-51`), e
   registra em `audit_log` o valor anterior, o novo e `regressed: true`
   (`...20260715000100_fase5_sync_course_progress.sql:53-59`). Não avisa ninguém, não marca o contrato e não
   bloqueia nada. O comentário da migration justifica: a fonte "pode legitimamente REGREDIR (recontagem de
   páginas quando o curso muda)" (`...20260715000100_fase5_sync_course_progress.sql:4-5`). Testes que fixam
   isso: `tests/ct-sync-e-ajustes.test.ts:23`, `tests/ct-sync-hotmart-job.test.ts:80`.
2. **Pelo evento (`apply_module_progress`): o número menor é recusado.** O percentual só sobe; o valor
   menor fica na auditoria como `skipped_regression` e só `last_synced_at` avança
   (`supabase/migrations/20260714000500_nucleo45_hotmart_effects.sql:147-156`; mesma regra na primeira
   gravação, `...20260714000500_nucleo45_hotmart_effects.sql:130-144`).

Efeito prático: a reserva de mentoria compara o percentual **atual** com o limite da etapa no momento de
reservar (`supabase/migrations/20260714000400_nucleo45_mentorship_refund.sql:207-210`, chamada em
`supabase/migrations/20260718001200_f10_mentoria.sql:368`). Uma regressão gravada pelo polling pode tirar
de um aluno o direito de fazer a **próxima** reserva. Não há trigger em `course_progress`, então reservas já
feitas não são reavaliadas.

A tabela já tem colunas para o total e para as páginas concluídas
(`supabase/migrations/20260711000400_mentorship.sql:102-103`) e a RPC aceita os dois valores
(`...20260715000100_fase5_sync_course_progress.sql:13-14`), mas nada os preenche.

## Fatos encontrados

### 1. Credenciais e token (OAuth `client_credentials`)

| Fato | Fonte |
|---|---|
| A credencial é criada no painel, em Ferramentas → Credenciais Developers, botão "Criar Credencial", com um nome livre. | [Autenticação](https://developers.hotmart.com/docs/pt-BR/start/app-auth/) |
| Ao criar, escolhe-se o tipo: marcar "sandbox" gera credencial de teste; deixar em branco gera a de produção. O tipo não pode ser mudado depois; para trocar, cria-se outra. | [Autenticação](https://developers.hotmart.com/docs/pt-BR/start/app-auth/) |
| São gerados três valores: `client_id`, `client_secret` e um token do tipo Basic. | [Autenticação](https://developers.hotmart.com/docs/pt-BR/start/app-auth/) |
| As chaves só aparecem no momento da criação; depois não dá para ver de novo. A central de ajuda manda baixar os valores na hora. | [Changelog, 09/02/2023](https://developers.hotmart.com/docs/pt-BR/changelog/); [Central de ajuda: APIs e Developers](https://help.hotmart.com/pt-br/article/4403617024013/como-utilizo-as-apis-da-hotmart-e-o-hotmart-developers-para-integrar-meu-negocio) |
| Credencial pode ser apagada e recriada a qualquer momento. A conta recebe e-mail quando uma credencial é criada ou excluída. | [Autenticação](https://developers.hotmart.com/docs/pt-BR/start/app-auth/); [Changelog, 29/03/2022](https://developers.hotmart.com/docs/pt-BR/changelog/) |
| Token: `POST https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials&client_id=...&client_secret=...`, com `Content-Type: application/json` e `Authorization: Basic <valor Basic>`. | [Autenticação](https://developers.hotmart.com/docs/pt-BR/start/app-auth/) (exemplo de requisição) |
| Resposta de exemplo: `access_token`, `token_type: "bearer"`, `expires_in: 172799`, `scope: "read write"`, `jti`. | [Autenticação](https://developers.hotmart.com/docs/pt-BR/start/app-auth/) (exemplo de resposta) |
| Só o `access_token` expira; os três valores da credencial não. Depois de expirado, a API responde 401, e a recomendação é tratar o 401 e gerar outro token. | [Autenticação](https://developers.hotmart.com/docs/pt-BR/start/app-auth/) |
| A Central de Colaboradores tem uma categoria "Desenvolvedores" que libera a um colaborador o acesso ao Webhook e às credenciais de API. | [Changelog, 09/12/2021](https://developers.hotmart.com/docs/pt-BR/changelog/) |
| Sandbox: base `https://sandbox.hotmart.com`, mesmos caminhos, dados fictícios, credencial própria do tipo sandbox. | [Sandbox](https://developers.hotmart.com/docs/pt-BR/start/sandbox/) |

### 2. `GET /club/api/v1/users`

| Fato | Fonte |
|---|---|
| URL: `GET https://developers.hotmart.com/club/api/v1/users`, com `Authorization: Bearer <access_token>`. | [Obter alunos](https://developers.hotmart.com/docs/pt-BR/v1/club/get-users-club/) (exemplo de requisição) |
| Devolve todos os alunos de um curso da área de membros: quem comprou, quem foi importado e quem entrou por cadastro gratuito. Também vêm dono, administradores, editores e moderadores (campo `role`). | [Obter alunos](https://developers.hotmart.com/docs/pt-BR/v1/club/get-users-club/) |
| Parâmetros de query documentados na página: `subdomain` (string, obrigatório) e `email` (string, opcional; aceita o e-mail completo **ou parte dele**). | [Obter alunos](https://developers.hotmart.com/docs/pt-BR/v1/club/get-users-club/) |
| Sem `subdomain` a resposta é 422 (tabela do sandbox). | [Obter alunos](https://developers.hotmart.com/docs/pt-BR/v1/club/get-users-club/) |
| `progress` é um objeto com três campos: `completed_percentage` (double, percentual de páginas concluídas), `total` (long, total de páginas da área de membros) e `completed` (long, páginas concluídas). | [Obter alunos](https://developers.hotmart.com/docs/pt-BR/v1/club/get-users-club/) |
| No exemplo oficial, um aluno com 5 de 11 páginas aparece com `completed_percentage: 45` (5/11 dá 45,45). | [Obter alunos](https://developers.hotmart.com/docs/pt-BR/v1/club/get-users-club/) (exemplo de resposta) |
| Outros campos por aluno: `user_id` (identificador único no Club), `name`, `email`, `role`, `status` (`ACTIVE`, `BLOCKED`, `BLOCKED_BY_OWNER`, `OVERDUE`), `type` (`BUYER`, `IMPORTED`, `FREE`, `OWNER`, `GUEST`), `first_access_date` e `last_access_date` (long), `purchase_date` (long), `access_count`, `class_id` (turma), `engagement`, `locale`, `plus_access`, `is_deletable`. | [Obter alunos](https://developers.hotmart.com/docs/pt-BR/v1/club/get-users-club/) |
| Paginação por cursor: `page_info` traz `total_results` (pode não vir em todo endpoint), `next_page_token` (ausente na última página), `prev_page_token` (ausente na primeira) e `results_per_page`. Os parâmetros são `max_results` e `page_token`. | [Paginação](https://developers.hotmart.com/docs/pt-BR/start/pagination/); [Obter alunos](https://developers.hotmart.com/docs/pt-BR/v1/club/get-users-club/) |
| Cada endpoint tem um tamanho de página padrão e um máximo; pedir `max_results` acima do máximo devolve só o máximo, sem erro. | [Paginação](https://developers.hotmart.com/docs/pt-BR/start/pagination/) |
| Limite: 500 chamadas por minuto, somando leitura e escrita; acima disso, 429. Cabeçalhos de resposta informam a cota: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `X-RateLimit-Limit-Minute`, `X-RateLimit-Remaining-Minute`. O limite era 100 e passou a 500 em 08/07/2024. | [Rate Limit](https://developers.hotmart.com/docs/pt-BR/start/rate-limit/); [Changelog, 08/07/2024](https://developers.hotmart.com/docs/pt-BR/changelog/) |
| Erros da API: 400 (`page_token` inválido, parâmetro inválido), 401 (`token_expired`, `invalid_token`, `unauthorized`), 403, 404, 429, 500, 502 (a busca passou de 30 segundos) e 503 (API indisponível para todos). | [Códigos de resposta HTTP](https://developers.hotmart.com/docs/pt-BR/start/http-response-codes/) |
| Existe um endpoint de detalhe: `GET /club/api/v1/users/{user_id}/lessons?subdomain=...` lista as páginas do curso para um aluno, com `page_id`, `page_name`, `module_name`, `is_module_extra`, `is_completed` e `completed_date` (só quando concluída). O `user_id` vem do endpoint de alunos. | [Obter o progresso do aluno](https://developers.hotmart.com/docs/pt-BR/v1/club/get-lessons-club/) |
| A área de membros é organizada em módulos, e os módulos em páginas. Há módulos extras (gratuitos ou pagos) e páginas de quatro tipos: `CONTENT`, `ADVERTISEMENT`, `QUIZ`, `WEBINAR`. Páginas podem ter liberação agendada por data ou por dias. | [Introdução](https://developers.hotmart.com/docs/pt-BR/v1/club/about-club/); [Obter módulos](https://developers.hotmart.com/docs/pt-BR/v1/club/get-modules-club/); [Obter páginas](https://developers.hotmart.com/docs/pt-BR/v1/club/get-pages-club/) |
| A própria Hotmart recomenda guardar os dados em base própria e combinar webhook (gatilho) com chamada à API (enriquecimento), em vez de consultar a API de forma recorrente. | [Tutorial: boas práticas](https://developers.hotmart.com/docs/pt-BR/tutorials/learn-good-usage-practices/); [Tutorial: engajamento no Club](https://developers.hotmart.com/docs/pt-BR/tutorials/club-engagement/) |

### 3. Webhooks `CLUB_FIRST_ACCESS` e `CLUB_MODULE_COMPLETED` (versão 2.0.0)

Os dois eventos existem desde 2025: primeiro acesso em 24/02/2025 e módulo completo em 10/03/2025
([Changelog](https://developers.hotmart.com/docs/pt-BR/changelog/)).

Formato (campos e tipos da documentação; valores trocados por marcadores):

```json
{
  "id": "<string, código único do evento>",
  "creation_date": 1632411406874,
  "event": "CLUB_FIRST_ACCESS | CLUB_MODULE_COMPLETED",
  "version": "2.0.0",
  "data": {
    "product": { "id": 0, "name": "<nome do produto>" },
    "user": { "name": "<nome completo>", "email": "aluna@exemplo.com" },
    "module": { "id": "<string>", "name": "<nome atual do módulo>" }
  }
}
```

`data.module` só vem no evento de módulo completo.

| Fato | Fonte |
|---|---|
| `id` (string): código único de identificação do evento recebido. | [Primeiro acesso](https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/club-first-access/); [Módulo completo](https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/club-module-completed/) |
| `creation_date` (long): data de criação do evento, em **milissegundos** desde 1970-01-01 00:00:00 UTC. | idem |
| `version`: escolhida ao criar a configuração no painel; nestes eventos é sempre `2.0.0`. | idem |
| O aluno vem só como `data.user.name` e `data.user.email`. Não há `user_id` do Club no evento. | idem |
| `data.product.id` (inteiro) e `data.product.name` identificam o curso. | idem |
| Não há percentual de progresso no evento de módulo completo. | [Módulo completo](https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/club-module-completed/) |
| Para quem consome pelo aplicativo móvel, a notificação de módulo completo depende da versão do aplicativo instalada. | [Módulo completo](https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/club-module-completed/); [Changelog, 10/03/2025](https://developers.hotmart.com/docs/pt-BR/changelog/) |
| Hottok: cada conta tem um token único, enviado no cabeçalho HTTP `X-HOTMART-HOTTOK` de toda requisição. A recomendação é validar antes de tratar os dados. Para trocar o token é preciso falar com o suporte. | [Primeiro acesso](https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/club-first-access/); [Tutorial: webhook para assinaturas](https://developers.hotmart.com/docs/pt-BR/tutorials/use-webhook-for-subscriptions/) |
| O hottok fica na aba "Autenticação" da ferramenta Webhook, no painel. | [Tutorial: webhook para assinaturas](https://developers.hotmart.com/docs/pt-BR/tutorials/use-webhook-for-subscriptions/); [Tutorial: boas práticas](https://developers.hotmart.com/docs/pt-BR/tutorials/learn-good-usage-practices/) |
| O evento de teste do painel leva o hottok verdadeiro da conta (desde 01/04/2022). | [Changelog, 01/04/2022](https://developers.hotmart.com/docs/pt-BR/changelog/) |
| Formato de envio: JSON. | [Primeiro acesso](https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/club-first-access/) |
| Reenvio: "Os posts com erro são reenviados automaticamente até cinco vezes", ou até uma resposta positiva do servidor. Também dá para reenviar à mão, pela coluna Ações da aba Histórico. | [Central de ajuda: Webhook](https://help.hotmart.com/pt-br/article/360001491352/como-configurar-a-api-do-meu-produto-usando-o-webhook-postback-) |
| Desativação: se a URL cadastrada apresentar erro, a Hotmart desativa a configuração automaticamente. | [Central de ajuda: Webhook](https://help.hotmart.com/pt-br/article/360001491352/como-configurar-a-api-do-meu-produto-usando-o-webhook-postback-) |
| A conta recebe e-mail quando uma configuração de webhook é criada, excluída, inativada ou ativada. | [Changelog, 29/03/2022](https://developers.hotmart.com/docs/pt-BR/changelog/) |
| Histórico: eventos ficam guardados e listados por até 60 dias, com o conteúdo enviado e as respostas que a URL deu. | [Central de ajuda: Webhook](https://help.hotmart.com/pt-br/article/360001491352/como-configurar-a-api-do-meu-produto-usando-o-webhook-postback-); [Usando Webhooks](https://developers.hotmart.com/docs/pt-BR/1.0.0/webhook/using-webhook/) |
| Do lado da Hotmart, resposta 2xx é sucesso. Na tabela de erros aparecem 400, 401 (o serviço está exigindo chave), 404, 408 e 5xx (a aplicação não respondeu no tempo esperado) e -1 (conexão encerrada sem motivo). | [Códigos de resposta do Webhook](https://developers.hotmart.com/docs/pt-BR/1.0.0/webhook/http-response-codes-webhook/) |
| A configuração de webhook pode valer para todos os produtos da conta ou para um produto específico. | [Central de ajuda: Webhook](https://help.hotmart.com/pt-br/article/360001491352/como-configurar-a-api-do-meu-produto-usando-o-webhook-postback-) |
| Eventos do Club disponíveis ao configurar: primeiro acesso e módulo completo. | [Central de ajuda: Webhook](https://help.hotmart.com/pt-br/article/360001491352/como-configurar-a-api-do-meu-produto-usando-o-webhook-postback-) |

### 4. Subdomínio da área de membros

| Fato | Fonte |
|---|---|
| `subdomain` é o nome do subdomínio do produto definido na administração do Club; cada curso tem o seu. | [Obter alunos](https://developers.hotmart.com/docs/pt-BR/v1/club/get-users-club/); [Tutorial: engajamento no Club](https://developers.hotmart.com/docs/pt-BR/tutorials/club-engagement/) |
| Onde achar (tutorial de 2022): página de edição do produto → Gestão do Curso → "Acessar a gestão do curso pela Hotmart" → Configurações → aba Dados → seção "Mapeamento de Host". O ID do produto fica abaixo do título, na página de edição. | [Tutorial: engajamento no Club](https://developers.hotmart.com/docs/pt-BR/tutorials/club-engagement/) |
| A central de ajuda descreve esse mesmo caminho ("Mapeamento de host") como o de **produtos que não estão adicionados a uma área de membros**, e avisa que mudar o subdomínio não tira o `.club.hotmart.com` do endereço. | [Central de ajuda: domínio personalizado](https://help.hotmart.com/pt-br/article/29240121655437/como-configurar-meu-dominio-personalizado-no-hotmart-club-) |
| Hoje uma "Área de Membros" pode reunir vários produtos; ela tem nome e URL próprios (aba Informações gerais das Configurações) e aceita domínio próprio. Um produto não pode estar em duas áreas; ao ser movido de uma para outra, o link do produto muda. | [Central de ajuda: configurar a Área de Membros](https://help.hotmart.com/pt-br/article/20060658355085/hotmart-club-tudo-o-que-voce-precisa-saber-sobre-a-area-de-membros-da-hotmart) |
| A API do Club só devolve dados de conteúdo entregue pela área de membros da própria Hotmart. | [Tutorial: engajamento no Club](https://developers.hotmart.com/docs/pt-BR/tutorials/club-engagement/) |

## Onde a documentação contradiz (ou não sustenta) o que o código assume

Não achei contradição em URL, parâmetro ou nome de campo. Os pontos abaixo são de comportamento.

1. **"A Hotmart pode legitimamente regredir" não está na documentação.** O comentário de
   `20260715000100_fase5_sync_course_progress.sql:4-5` trata a queda do percentual como fato da fonte. A
   documentação só define os campos; não fala em recontagem, nem diz que o percentual nunca cai. A decisão
   de sobrescrever (polling) foi tomada sobre uma suposição.

2. **O código descarta `total` e `completed`, que a documentação garante no mesmo objeto.**
   `client.ts:95-96` guarda só o percentual e `sync-hotmart.ts:78-81` não passa páginas à RPC. Com os três
   números gravados, uma queda de percentual com `total` maior e `completed` igual se explicaria sozinha;
   hoje a auditoria registra apenas "caiu de X para Y".

3. **Os dois caminhos tratam a mesma queda de formas opostas.** Polling sobrescreve; evento recusa. A
   documentação não dá base para preferir um ou outro: o evento não carrega percentual, então o número do
   "caminho de evento" também vem do mesmo `GET /users`, só que lido em outro momento
   (`hotmart.ts:139-158`).

4. **"Retry 5x" e "desativa URL que falha" estão documentados, mas separados.** `hotmart.ts:10` junta os
   dois numa regra só. A central de ajuda diz que posts com erro são reenviados até cinco vezes e, em outro
   trecho, que a configuração é desativada se a URL der erro, sem dizer depois de quantos erros. O código
   devolve resposta que a Hotmart conta como erro em três casos: 401 (`hotmart.ts:46-48`), 400
   (`route.ts:15`) e 500 (`hotmart.ts:67-70`). O mais delicado é o 401 com `HOTMART_HOTTOK` ausente: enquanto
   a variável não estiver configurada, **todo** evento recebe 401, o que pela documentação é motivo de
   desativação.

5. **Token: a documentação recomenda tratar o 401; o código só renova por relógio.** Se um token deixar de
   valer antes do prazo, as chamadas falham até o processo reiniciar ou o prazo em memória vencer
   (`client.ts:38`, `client.ts:73`, `client.ts:92`).

6. **O evento traz `data.product.id` e o código não confere o produto.** O vínculo é só por e-mail
   (`hotmart.ts:104-124`). Se a configuração do webhook valer para todos os produtos da conta, o primeiro
   acesso de um aluno a **outro** curso da mesma conta marcaria `course_start_date` da mentoria. Hoje isso só
   fica protegido por configuração no painel (item 6 da lista abaixo).

7. **`CLUB_FIRST_ACCESS` é a única origem automática da data de início, e o evento pode se perder.** São no
   máximo cinco reenvios automáticos e 60 dias de histórico para reenvio manual. O endpoint de alunos devolve
   `first_access_date`, que o código não lê (`client.ts:56-60`).

8. **A busca por e-mail lê só a primeira página.** O filtro é por parte do e-mail e a resposta é paginada;
   `client.ts:71-76` não segue `next_page_token`. Com poucos alunos é improvável faltar, mas a documentação
   não garante que o e-mail exato venha na primeira página.

9. **O teto de 50 páginas corta em silêncio.** O tamanho máximo de página deste endpoint não está
   documentado, e pedir 100 pode devolver menos (`client.ts:87-99`). Se o teto for atingido, quem ficou de
   fora aparece como "e-mail não encontrado na Hotmart" (`sync-hotmart.ts:69-76`), que é um diagnóstico errado.

O que a documentação **confirma** do que o código assume: host e formato do pedido de token; `expires_in`
de ~48 h; `GET /club/api/v1/users` com `subdomain` e `email` parcial; `items[].progress.completed_percentage`;
`page_token` e `next_page_token`; 500 requisições por minuto; cabeçalho `X-HOTMART-HOTTOK` sem HMAC;
`creation_date` em milissegundos; `id` como código único do evento; ausência de percentual no evento; e a
necessidade do polling (o evento de módulo completo não é garantido no aplicativo móvel).

## O que o produtor precisa criar no painel, em ordem

A documentação não impõe ordem entre os passos 2, 3 e 4. A única dependência que ela deixa clara é a do
passo 5 antes do 6: URL que dá erro tem a configuração desativada.

1. **Confirmar que o curso é entregue pela área de membros da Hotmart.** É pré-requisito da API do Club.
2. **Anotar o subdomínio e o ID do produto.** Produtos → o curso → página de edição (o ID fica abaixo do
   título) → Gestão do Curso → "Acessar a gestão do curso pela Hotmart" → Configurações → aba Dados →
   "Mapeamento de Host". Esse é o valor de `HOTMART_SUBDOMAIN`. Se o curso estiver dentro de uma Área de
   Membros com vários produtos, o caminho pode ser outro (ver "Não foi possível confirmar", item 6).
3. **Criar a credencial de produção.** Ferramentas → Credenciais (Developers) → "Criar Credencial" → dar um
   nome → **não** marcar "sandbox" → Confirmar. Guardar na hora os três valores (`client_id`, `client_secret`
   e Basic): eles não aparecem de novo. São `HOTMART_CLIENT_ID`, `HOTMART_CLIENT_SECRET` e `HOTMART_BASIC`.
   Opcional: uma segunda credencial, do tipo sandbox, só para teste.
4. **Copiar o hottok.** Ferramentas → Webhook → aba "Autenticação". É `HOTMART_HOTTOK`. É um por conta e
   só o suporte troca.
5. **Fora do painel: configurar as variáveis no app e publicar**, para a URL do webhook já responder 2xx
   quando for cadastrada.
6. **Cadastrar o webhook.** Ferramentas → Ver todas → Webhook (API e notificações) → "+ Cadastrar Webhook":
   nome da configuração; **produto específico** (o curso da mentoria, não "todos os produtos"); URL de envio;
   versão **2.0.0**; eventos do Club "primeiro acesso" e "módulo completo"; Salvar.
7. **Enviar um teste e conferir.** Aba "Minhas configurações" → ícone de lista ao lado da configuração →
   teste de envio. Depois, aba "Histórico": ver o conteúdo enviado e a resposta que a URL deu.
8. **Opcional: dar acesso a um colaborador** pela Central de Colaboradores, categoria "Desenvolvedores",
   se quem vai mexer no Webhook e nas credenciais não for o titular da conta.

## O que NÃO foi possível confirmar pela documentação

A documentação pública da Hotmart é incompleta nestes pontos. Nada abaixo foi preenchido por dedução; cada
item só se resolve com teste na conta real, no sandbox ou com o suporte.

**Progresso**

1. **Se `completed_percentage` pode diminuir.** Nenhuma página diz que sim nem que não. Não há descrição do
   que acontece com o percentual quando o produtor acrescenta, remove, despublica ou move módulo ou página.
2. **O que entra em `total`.** Não está dito se contam páginas de módulo extra, páginas não publicadas,
   páginas com liberação agendada ainda fechada, páginas de anúncio ou conteúdo liberado só para outra turma.
   A descrição fala em "páginas da Área de Membros", o que também não esclarece se, numa área com vários
   produtos, o total é do produto ou da área inteira.
3. **Como o percentual é arredondado.** O tipo é double, o exemplo mostra inteiro (45 para 5 de 11). Não há
   regra escrita.
4. **Se `completed` pode diminuir** (aluno desmarcar página como concluída, página concluída ser apagada).
5. **Com que atraso o endpoint reflete uma página recém-concluída** (não há menção a cache neste endpoint).
6. **Qual `subdomain` usar quando o produto está dentro de uma Área de Membros.** O único caminho descrito
   ("Mapeamento de Host") aparece na central de ajuda como o de produtos fora de uma área de membros. Não
   está documentado onde ler o valor no outro caso, nem se ele muda quando o produto é movido de área ou
   quando se configura domínio próprio.
7. **Tamanho de página padrão e máximo de `GET /club/api/v1/users`**, e se `total_results` vem neste
   endpoint em produção (o exemplo mostra, a página de paginação diz que pode não vir).
8. **Unidade de `first_access_date`, `last_access_date` e `purchase_date`.** O tipo é long, sem unidade. Os
   valores de exemplo têm 10 dígitos (parecem segundos), enquanto `creation_date` do webhook e
   `completed_date` das lições têm 13 (milissegundos).
9. **Se alunos bloqueados, com assinatura vencida ou importados continuam na lista**, e com que progresso.
10. **O que a API responde para um `subdomain` que não existe** (só o caso "sem o parâmetro" está descrito).

**Webhook**

11. **Quantos erros levam à desativação automática**, se vale para qualquer código de erro (inclusive 401 e
    400) e como reativar. Só está escrito que a URL com erro tem a configuração desativada.
12. **Intervalo entre as cinco tentativas e tempo máximo de espera pela resposta.** A tabela de erros fala em
    "tempo esperado" sem número.
13. **Se o `id` é o mesmo nas tentativas automáticas e no reenvio manual.** A documentação só diz "código
    único do evento recebido". A idempotência do projeto depende disso (`hotmart.ts:51-58`).
14. **Ordem de entrega e possibilidade de evento duplicado com `id` diferente.**
15. **Quando exatamente `CLUB_FIRST_ACCESS` dispara**: se vale para aluno importado ou gratuito, se dispara
    de novo quando o aluno recebe outro produto, e se há envio retroativo para quem já tinha acessado antes de
    a configuração existir. Também não está dito se o instante do evento é o mesmo de `first_access_date`.
16. **Quando um módulo conta como "completo"** (todas as páginas, só as publicadas, módulos extras) e se o
    evento dispara de novo quando o módulo ganha página nova e o aluno a conclui.
17. **Se os eventos do Club existem na versão 1.0.0.** Só há página deles em 2.0.0, e não existem páginas
    gerais de webhook em 2.0.0 (as gerais estão sob 1.0.0).
18. **O que o evento de teste do painel envia para os eventos do Club** (há nota de 2023 sobre os testes dos
    eventos de compra e assinatura, nada sobre os do Club).

**Credenciais**

19. **Se dá para limitar o que uma credencial pode fazer.** O exemplo de token mostra `scope: "read write"`
    e não há descrição de escopo por API. A mesma documentação lista endpoints de escrita (reembolso de venda,
    cancelamento de assinatura). Não está dito se uma credencial criada para ler progresso também alcança
    esses endpoints, nem como restringir.
20. **Endereço de token para credencial sandbox.** A página de autenticação diz que o processo serve aos
    dois ambientes, mas só mostra o endereço de produção.
21. **Se um token pode ser invalidado antes do prazo** (por exemplo, ao gerar outro token com a mesma
    credencial) e se há limite de tokens simultâneos.

## Como a leitura foi feita

- O site de desenvolvedores monta as páginas no navegador; o texto foi lido dos arquivos de dados que o
  próprio site serve para cada página (conteúdo, exemplos de código e changelog), nas versões em português.
- A central de ajuda foi lida pelo navegador, com as seções recolhidas abertas.
- Páginas lidas sem resposta para as perguntas: a de [gestão de alunos](https://help.hotmart.com/pt-br/article/15584344141197/como-fazer-a-gestao-de-alunos-no-hotmart-club-)
  e a de [Insights](https://help.hotmart.com/pt-br/article/33761521264013) citam "progresso" e
  "porcentagem de conclusão" sem dizer como são calculados.
- Os exemplos de evento e de resposta acima tiveram os valores trocados por marcadores; os nomes e tipos de
  campo são os da documentação.
