# Pesquisa: scanner de e-mail que gasta o link de uso único do convite

- **Ticket:** issue #171 (pesquisa de um mapa de decisões).
- **Data da leitura das fontes:** 16/11/2026.
- **Este arquivo não decide nada.** Ele levanta fatos em fonte primária e descreve as opções. A escolha é de
  outro ticket, com o dono.
- **Código lido:** `main` no commit `743424c`. GoTrue (repositório `supabase/auth`) no commit `387e91f`
  (`master` em 16/11/2026). Next.js 16.2.10 e `@supabase/auth-js` 2.110.2, as versões instaladas.

## Pergunta

Como impedir que um scanner de e-mail (o Safe Links do Outlook e parecidos) gaste o link de uso único do
convite e da redefinição de senha no Supabase Auth (GoTrue) self-hosted?

Subperguntas do ticket:

1. Como esses scanners abrem o link (GET antecipado, HEAD, se executam JavaScript, se seguem redirecionamento).
2. O que o GoTrue oferece: `token_hash` verificado por POST, código digitado no lugar do link, validade
   configurável.
3. O padrão "página intermediária com botão" e os limites dele.
4. O que muda nos modelos de e-mail do Auth.

## Resposta curta

- O link de hoje gasta o token no próprio GET. Qualquer programa que abra a URL antes da pessoa (scanner,
  pré-carregamento) consome o convite, e a pessoa cai em "Seu convite expirou".
- A especificação do HTTP diz que GET não deve mudar estado e que a responsabilidade é de quem publica o
  recurso (RFC 9110, seção 9.2.1).
- A documentação do Supabase reconhece o problema e dá duas saídas: código digitado (`{{ .Token }}`) ou uma
  página com botão, em que só o clique da pessoa dispara a verificação.
- O GoTrue já aceita as duas: `POST /verify` com `token_hash` (o que o `verifyOtp` do cliente faz) e
  `POST /verify` com e-mail + código. Convite e recuperação entregam o código ao modelo de e-mail.
- A validade configurável (`otp_expiry`) não resolve o scanner: o gasto acontece em segundos, não por
  vencimento.
- Nenhuma fonte primária lida diz qual método HTTP o Safe Links usa, nem se ele clica em botões. Ver "O que
  não foi possível confirmar".

## O que o projeto faz hoje

**A rota que recebe o link verifica o token no GET.**

- `src/app/auth/confirm/route.ts:17` exporta só `GET`. Nas linhas 22 a 28 ela lê `token_hash` e `type` da
  query, chama `supabase.auth.verifyOtp({ type, token_hash })` e, sem erro, redireciona (303) para
  `/definir-senha`.
- `src/app/auth/confirm/route.ts:9` aceita só os tipos `invite` e `recovery` (ADR-014).
- `src/app/auth/confirm/route.ts:31`: qualquer falha (token vencido, já usado, tipo recusado, parâmetro
  faltando) redireciona para `/convite-expirado`, sem distinguir a causa.
- O Next.js implementa `HEAD` sozinho chamando o `GET` quando a rota não exporta `HEAD`
  (`node_modules/next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js:36-44`). Um
  `HEAD` nessa URL também executa o `verifyOtp` e gasta o token.

**Os modelos de e-mail apontam direto para essa rota, com o token na URL.**

- `supabase/templates/invite.html:34`:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`.
- `supabase/templates/recovery.html:31`: a mesma forma, com `type=recovery`. A linha 38 promete: "O link vale
  por 24 horas e só funciona uma vez".
- `supabase/templates/magic-link.html:27`: a mesma forma, com `type=magiclink`. O modelo está configurado mas
  nenhum fluxo do app o envia, e a rota recusa o tipo (ADR-014, "Consequências").
- Existem cópias dos três modelos em `public/emails/` (`public/emails/invite.html:34`,
  `public/emails/recovery.html:31`, `public/emails/magic-link.html:27`). O ADR-014, item 6, chama
  `supabase/templates/` de fonte e `public/emails/` de cópia, e cita `MAILER_TEMPLATES_RECOVERY` em
  produção. Que a produção lê a cópia de `public/emails/` é dedução desse texto, não foi conferido.
- `supabase/config.toml:253-264` liga os três modelos na bancada local. O comentário das linhas 251-252
  registra que `{{ .ConfirmationURL }}` não é usado.
- Nenhum modelo usa `{{ .Token }}` (o código de 6 dígitos).

**Configuração de validade e limites (bancada local).**

- `supabase/config.toml:239`: `otp_expiry = 86400` (24 h), igual à produção segundo o comentário da linha 238
  e o ADR-019 (`GOTRUE_MAILER_OTP_EXP=86400`, issue #122). A validade é uma só para todos os links do Auth.
- `supabase/config.toml:236`: `otp_length = 6`.
- `supabase/config.toml:213`: `token_verifications = 30` (verificações por IP a cada 5 minutos).
- `supabase/config.toml:203`: `email_sent = 2` (e-mails por hora, só na bancada).

**Quem dispara os e-mails.**

- Convite: `src/lib/auth/provision.ts:408` (`inviteUserByEmail`), e o reenvio em
  `src/lib/auth/provision.ts:256`.
- Recuperação: `src/app/login/actions.ts:42` (`resetPasswordForEmail`).

**O que acontece hoje quando o link já foi gasto.**

- `src/app/convite-expirado/page.tsx:35-36` mostra "Seu convite expirou" e pede o e-mail para um novo envio.
- `src/app/convite-expirado/actions.ts:37-62` faz o reenvio com resposta neutra (não revela se o e-mail é de
  cliente). O comentário das linhas 10-11 registra que reenviar invalida o link anterior.
- A mesma página atende o link de recuperação gasto, com o título de convite.
- O portão de acesso trata `/auth/confirm` e `/convite-expirado` como públicos
  (`src/lib/auth/gate.ts:24-25`), inclusive subcaminhos (`src/lib/auth/gate.ts:77`).

**Vizinho com o mesmo desenho, fora do recorte do ticket.** `src/app/wa/[token]/route.ts:7-13` e
`src/app/wa/[token]/entrar.ts:42-47` trocam o link mágico do WhatsApp por sessão também no GET (ADR-019). O
ticket fala de e-mail. A pesquisa não cobriu pré-visualização de link em aplicativo de mensagem.

## Fatos encontrados

### A. Como os scanners abrem o link

**A1. O Safe Links examina as URLs antes de entregar a mensagem, com ou sem reescrita.** A visão geral do
Safe Links diz que, com a proteção ligada, as URLs são examinadas antes da entrega, sejam reescritas ou não,
e que o link reescrito é examinado de novo no clique.
Fonte: [Microsoft Learn, "Complete Safe Links overview", seção "Safe Links settings for email messages"](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about).

**A2. Parte desse exame é "detonação": a URL é aberta num ambiente isolado.** A mesma página lista, entre as
ações do Safe Links, que URLs sem reputação válida são detonadas de forma assíncrona em segundo plano. A
página da pilha de proteção descreve a "URL Detonation" na fase de filtragem de conteúdo: acontece quando a
tecnologia anti-phishing considera a mensagem ou a URL suspeita, e as URLs são abertas em sandbox no momento
da entrega. No clique, a URL é verificada pela reputação e "asynchronously sandboxed" de novo.
Fontes: [Safe Links overview](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about);
[Microsoft Learn, "Step-by-step threat protection stack", fase 3 item 11 e fase 4 item 1](https://learn.microsoft.com/en-us/defender-office-365/protection-stack-microsoft-defender-for-office365).

**A3. A detonação de URL registra capturas de tela, comportamento e uma cadeia de outras URLs.** A página da
entidade de e-mail descreve, para uma URL detonada: "detonation chain" (uma URL pode disparar várias
detonações, inclusive de URLs que não estão no e-mail), capturas de tela feitas durante a detonação e
"behavior details" com os eventos ocorridos.
Fonte: [Microsoft Learn, "The Email entity page", seção "URL details"](https://learn.microsoft.com/en-us/defender-office-365/mdo-email-entity-page).
*Leitura minha, não frase da fonte:* captura de tela e cadeia de URLs indicam que a página é carregada e
renderizada, e que o exame segue adiante a partir dela. A fonte não diz "navegador", "JavaScript" nem
"redirecionamento".

**A4. A Microsoft não documenta o método HTTP nem o agente.** As três páginas acima não citam GET, HEAD,
cabeçalho `User-Agent`, faixa de endereços nem execução de JavaScript.

**A5. Há reescrita da URL, por destinatário.** As URLs examinadas são trocadas por um endereço do serviço de
proteção; o clique passa por lá antes de chegar ao destino. Mesmo com a reescrita desligada, o exame antes da
entrega continua.
Fonte: [Safe Links overview](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about).

**A6. Quem pode isentar um endereço é o administrador de quem recebe, não quem envia.** A lista "Do not
rewrite the following URLs" tira a URL da reescrita e do exame durante o fluxo de e-mail, mas ela ainda pode
ser bloqueada no clique; é configurada em cada política Safe Links do destinatário.
Fonte: [Safe Links overview, seção "Do not rewrite the following URLs lists"](https://learn.microsoft.com/en-us/defender-office-365/safe-links-about).

**A7. Conta pessoal também tem Safe Links.** No Outlook.com, a proteção liga sozinha para assinantes
Microsoft 365 Family e Personal, em contas do próprio serviço; os links da mensagem passam a mostrar o
endereço de proteção, e a pessoa pode desligar nas configurações. A página fala em verificar os links quando
a mensagem chega e avisar no clique; não fala em detonação.
Fonte: [Suporte da Microsoft, "Advanced Outlook.com security for Microsoft 365 subscribers"](https://support.microsoft.com/office/882d2243-eab9-4545-a58a-b36fee4a46e2).

**A8. Outro fornecedor descreve o mesmo par: exame antes da entrega e de novo no clique.** A Proofpoint
descreve reter mensagens com URL suspeita para análise em sandbox antes da entrega e reescrever e analisar no
clique, com "static and dynamic analysis". Não detalha navegador nem redirecionamento.
Fonte: [blog da Proofpoint, 06/05/2024](https://www.proofpoint.com/us/blog/email-and-cloud-threats/malicious-links-stop-url-based-attacks-before-they-start).
É texto de divulgação do fornecedor, não documentação técnica.

**A9. Uma RFC registra o comportamento geral.** A RFC 8058 (cancelamento de inscrição em um clique) parte
deste fato: software anti-spam costuma buscar automaticamente os recursos citados na mensagem, sem ação da
pessoa, e o remetente não tem como distinguir mecanicamente a busca automática do pedido de uma pessoa. Ela
também registra a saída clássica: página com um passo de confirmação, que a pessoa reconhece e o sistema
automático não.
Fonte: [RFC 8058, seção 1](https://www.rfc-editor.org/rfc/rfc8058.html#section-1). A RFC trata de URLs em
campos de cabeçalho; aqui ela vale como registro do comportamento, não como norma para o corpo do e-mail.

**A10. O Supabase descreve o efeito no próprio produto.** O guia de produção diz que scanners de e-mail de
empresas podem enviar um GET aos links de redefinição e de cadastro e que, como os links do Auth são de uso
único, quem abre o e-mail depois recebe erro.
Fonte: [Supabase Docs, "Production Checklist", item "Email link validity"](https://supabase.com/docs/guides/deployment/going-into-prod).

### B. O que o HTTP diz sobre o GET

**B1. GET e HEAD são métodos "seguros": quem faz o pedido não está pedindo mudança de estado.** A RFC 9110
define GET, HEAD, OPTIONS e TRACE como seguros e explica o motivo da distinção: permitir que processos
automáticos de busca e de pré-carregamento funcionem sem medo de causar dano.
Fonte: [RFC 9110, seção 9.2.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.1).

**B2. A responsabilidade é de quem publica o recurso.** A mesma seção diz que, quando parâmetros na URL
selecionam uma ação, cabe ao dono do recurso garantir que ela é coerente com o método; se a ação é insegura,
ele DEVE recusá-la quando chega por método seguro. O texto prevê a consequência: efeitos colaterais quando
processos automáticos fazem GET em toda URL que encontram.
Fonte: [RFC 9110, seção 9.2.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.1).

### C. O que o GoTrue oferece

Todos os itens abaixo vêm do código-fonte no commit `387e91f`.

**C1. `/verify` aceita GET e POST, e os dois gastam o token.** A rota registra `GET /verify` e
`POST /verify` sob o mesmo limitador
([`internal/api/api.go#L270-L272`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/api.go#L270-L272)).
O GET é o destino do `{{ .ConfirmationURL }}` padrão: lê `token` e `type` da query, verifica, e redireciona
([`internal/api/verify.go#L95-L227`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/verify.go#L95-L227)).
O POST devolve a sessão no corpo
([`verify.go#L229-L311`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/verify.go#L229-L311)).

**C2. O POST aceita duas formas, e só uma por vez:** `token_hash` + `type`, ou `token` (o código) + `email`
+ `type`. Com `token_hash` não pode vir e-mail, telefone nem `redirect_to`
([`verify.go#L51-L93`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/verify.go#L51-L93)).

**C3. O `verifyOtp` do cliente é sempre POST.** Em `@supabase/auth-js` 2.110.2 o método chama
`_request(this.fetch, 'POST', `${this.url}/verify`, ...)`
(`node_modules/@supabase/auth-js/src/GoTrueClient.ts:2409-2417`). A documentação diz o mesmo.
Fonte: [Supabase Docs, "Email Templates", seção "Redirecting the user to a server-side endpoint"](https://supabase.com/docs/guides/auth/auth-email-templates).
Consequência para o projeto: o POST ao GoTrue já existe. O que falta é o pedido que chega ao app deixar de
ser um GET que dispara esse POST.

**C4. O código e o `token_hash` são a mesma credencial em duas formas.** O GoTrue gera um código numérico
(`GenerateOtp`) e guarda `hash(e-mail + código)`; o `token_hash` do e-mail é esse valor. Na verificação por
código, ele refaz o hash com o e-mail informado e compara
([`internal/api/mail.go#L360-L396`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/mail.go#L360-L396),
[`verify.go#L63-L88`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/verify.go#L63-L88),
[`verify.go#L707-L801`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/verify.go#L707-L801)).
O e-mail informado é passado para minúsculas antes do hash
([`mail.go#L710-L722`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/mail.go#L710-L722)).

**C5. Convite e recuperação aceitam verificação por código.** `verifyUserAndToken` trata os tipos `invite` e
`recovery` comparando o hash com `confirmation_token` e `recovery_token`
([`verify.go#L757-L760`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/verify.go#L757-L760)).
Os tipos aceitos pelo cliente incluem `invite` e `recovery`
(`node_modules/@supabase/auth-js/src/lib/types.ts:851-858`).

**C6. Os modelos de convite e de recuperação recebem `.Token`, `.TokenHash`, `.SiteURL`, `.ConfirmationURL`,
`.Email`, `.Data` e `.RedirectTo`**
([`internal/mailer/templatemailer/templatemailer.go#L199-L221` e `#L329-L349`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/mailer/templatemailer/templatemailer.go#L199-L221)).
O README do GoTrue cita só `SiteURL`, `Email` e `ConfirmationURL`; o código entrega mais. A documentação do
Supabase descreve `{{ .Token }}` como o código de 6 dígitos que pode ser usado no lugar da URL.
Fonte: [Supabase Docs, "Email Templates", tabela "Terminology"](https://supabase.com/docs/guides/auth/auth-email-templates).

**C7. O uso único é implementado apagando o token na primeira verificação.** `Confirm` zera
`confirmation_token` e `Recover` zera `recovery_token`; os dois apagam os registros de token de uso único do
usuário
([`internal/models/user.go#L586-L606` e `#L721-L728`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/models/user.go#L586-L606)).
O segundo pedido com o mesmo token recebe "Email link is invalid or has expired" (por `token_hash`) ou
"Token has expired or is invalid" (por código), os dois com o código de erro `otp_expired`
([`verify.go#L669-L701` e `#L789-L791`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/verify.go#L669-L701)).
O erro não distingue vencido, errado e já usado.

**C8. Cada novo convite ou pedido de recuperação troca o token anterior.** `sendInvite` e
`sendPasswordRecovery` gravam um token novo no mesmo campo
([`mail.go#L360-L437`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/mail.go#L360-L437)).

**C9. Validade: uma configuração só, para link e código.** `GOTRUE_MAILER_OTP_EXP`, em segundos; o README a
descreve como a duração de validade do link ou do código
([`README.md#L556-L558`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/README.md#L556-L558)).
Sem valor, o padrão no código é 86400 (1 dia)
([`internal/conf/configuration.go#L1229-L1231`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/conf/configuration.go#L1229-L1231)).
A documentação do Supabase desaconselha fortemente validade acima de 86.400 segundos.
Fonte: [Supabase Docs, "Passwordless email logins"](https://supabase.com/docs/guides/auth/auth-email-passwordless).

**C10. Tamanho do código: de 6 a 10 dígitos** (`GOTRUE_MAILER_OTP_LENGTH`; fora da faixa volta para 6)
([`configuration.go#L1237-L1240`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/conf/configuration.go#L1237-L1240)).

**C11. Limite de tentativas: por IP, não por token.** `GOTRUE_RATE_LIMIT_VERIFY` tem padrão 30 e é aplicado
por janela de 5 minutos
([`configuration.go#L487`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/conf/configuration.go#L487),
[`internal/api/apilimiter/apilimiter.go#L202`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/apilimiter/apilimiter.go#L202)).
Em `verifyUserAndToken` não há contador de tentativas erradas: código errado devolve erro e o token continua
valendo ([`verify.go#L707-L793`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/verify.go#L707-L793)).
A documentação do Supabase descreve o limite do `/verify` como 360 pedidos por hora por IP, com rajadas de
até 30.
Fonte: [Supabase Docs, "Production Checklist"](https://supabase.com/docs/guides/deployment/going-into-prod).

**C12. O fluxo PKCE não evita o gasto.** No `GET /verify`, o token com prefixo `pkce_` passa pela mesma
verificação e pelo mesmo apagamento; a diferença é que a resposta leva um código de autorização em vez da
sessão
([`verify.go#L137-L195`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/verify.go#L137-L195)).
A troca desse código exige o mesmo navegador e dispositivo que iniciou o fluxo, e ele vale 5 minutos.
Fonte: [Supabase Docs, "PKCE flow"](https://supabase.com/docs/guides/auth/sessions/pkce-flow).
O convite não tem PKCE: o comentário do `inviteUserByEmail` diz que não é suportado porque o navegador que
convida costuma ser outro (`node_modules/@supabase/auth-js/src/GoTrueAdminApi.ts:179`).

**C13. Os modelos são lidos por URL e ficam em cache.** `MAILER_TEMPLATES_INVITE` e
`MAILER_TEMPLATES_RECOVERY` são endereços de onde o GoTrue busca o HTML
([`README.md#L628-L631`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/README.md#L628-L631));
o modelo é considerado velho depois de 10 minutos por padrão
([`configuration.go#L698-L699`](https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/conf/configuration.go#L698-L699)).

### D. O que a documentação do Supabase recomenda

**D1. A página de modelos de e-mail tem uma seção "Email prefetching".** Ela diz que alguns provedores têm
detecção de spam ou recursos de segurança que pré-carregam os links, e que o link é consumido na hora, com o
erro "Token has expired or is invalid". Dá duas opções:

- **Opção 1, código:** incluir `{{ .Token }}` no modelo, com um link próprio para uma página em que a pessoa
  informa e-mail e código; a página chama `verifyOtp({ email, token, type })`.
- **Opção 2, botão:** link próprio para uma página do site em que a pessoa clica num botão para confirmar; o
  botão carrega o link de confirmação de verdade, passado como parâmetro da URL.

Fonte: [Supabase Docs, "Email Templates", seção "Email prefetching"](https://supabase.com/docs/guides/auth/auth-email-templates).

**D2. O guia de produção repete a opção do botão:** trocar o modelo para apontar a um domínio próprio, com
uma página que mostra um botão e só então leva ao link original.
Fonte: [Supabase Docs, "Production Checklist", item "Email link validity"](https://supabase.com/docs/guides/deployment/going-into-prod).

**D3. O exemplo oficial de `/auth/confirm` é um GET que verifica, igual ao do projeto.** Os guias de senha e
de fluxo no servidor mostram `export async function GET` chamando `verifyOtp({ type, token_hash })`, sem
citar pré-carregamento.
Fontes: [Supabase Docs, "Password-based Auth", seção "Resetting a password"](https://supabase.com/docs/guides/auth/passwords);
[Supabase Docs, "Email-based auth with PKCE flow for SSR"](https://supabase.com/docs/guides/auth/server-side/email-based-auth-with-pkce-flow-for-ssr).
O desenho atual do projeto segue o exemplo oficial; o problema do scanner está descrito em outra página.

**D4. Rastreamento de link do provedor de envio também estraga o link.** A documentação recomenda desligar o
rastreamento de cliques no serviço de SMTP, porque ele reescreve os links.
Fonte: [Supabase Docs, "Email Templates", seção "Email tracking"](https://supabase.com/docs/guides/auth/auth-email-templates).

### E. O que o Next.js garante para uma página com botão

**E1. Server Action só é chamada por POST.** "Behind the scenes, actions use the `POST` method, and only this
HTTP method can invoke them."
Fonte: [Next.js Docs, "Mutating Data"](https://nextjs.org/docs/app/getting-started/mutating-data)
(cópia instalada: `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md:29`).

**E2. O formulário funciona sem JavaScript.** Formulário que chama Server Action é enviado mesmo com o
JavaScript desligado ou ainda não carregado (mesmo arquivo, linha 132).

**E3. A Server Action confere a origem.** O Next.js compara o cabeçalho `Origin` com o `Host` (ou
`X-Forwarded-Host`) e aborta o pedido se não baterem
(`node_modules/next/dist/docs/01-app/02-guides/data-security.md:550`).

**E4. Cookie de sessão só pode ser gravado em Server Function ou Route Handler, não durante a renderização
de uma página** (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md:73-80`).

**E5. `route.ts` e `page.tsx` não podem existir no mesmo segmento**
(`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:39`). Trocar a rota
`/auth/confirm` por uma página no mesmo endereço exige remover o `route.ts`.

**E6. `HEAD` é implementado a partir do `GET`** quando a rota não exporta `HEAD`.
Fonte: [`auto-implement-methods.ts` na tag v16.2.10](https://github.com/vercel/next.js/blob/v16.2.10/packages/next/src/server/route-modules/app-route/helpers/auto-implement-methods.ts).

## Opções de desenho

Nenhuma é recomendada aqui. As opções 1, 2 e 3 podem ser combinadas com a 6.

### Opção 1. Página intermediária com botão

O link do e-mail abre uma página que não toca o token. Ela mostra um botão ("Ativar meu acesso", "Criar nova
senha"). O clique envia um formulário (POST), e só aí o servidor chama `verifyOtp` com o `token_hash` e
redireciona para `/definir-senha`.

Prós:

- É o padrão descrito pela RFC 8058 e a opção 2 da documentação do Supabase (A9, D1, D2).
- Cumpre a RFC 9110: o GET deixa de mudar estado (B2). `HEAD` também fica inofensivo (E6).
- Usa o que já existe: `token_hash`, `verifyOtp`, `/definir-senha`, `/convite-expirado`.
- Se a página ficar no mesmo endereço (`/auth/confirm`), os modelos de e-mail não mudam e os e-mails já
  enviados continuam abrindo no lugar certo (E5 diz o custo: sai o `route.ts`, entra a página).
- Funciona sem JavaScript (E2) e a pessoa não precisa digitar nada.

Contras e limites:

- Um passo a mais para a pessoa: abrir o e-mail, clicar, clicar de novo.
- Não protege contra um scanner que renderiza a página e aciona botões ou envia formulários. A existência
  desse comportamento não foi confirmada nem descartada em fonte primária (A3, A4).
- O token continua na URL e passa a ficar válido por mais tempo: hoje ele morre no primeiro acesso; com o
  botão ele vive até o clique ou até vencer (24 h). Quem viu a URL nesse intervalo (o serviço que reescreveu
  o link, um log, o histórico do navegador, um encaminhamento do e-mail) tem um token ainda utilizável.
- A página precisa tratar o token já usado ou vencido sem gastar nada no carregamento: só dá para saber no
  clique, porque não há consulta de "ainda vale?" sem verificar (C1, C7).
- A conferência de origem da Server Action depende dos cabeçalhos que o proxy entrega (E3). O app já usa
  Server Actions atrás do mesmo proxy, mas o caminho novo precisa ser testado em produção.

### Opção 2. Código digitado no lugar do link

O e-mail traz o código (`{{ .Token }}`). A pessoa abre uma página do app, informa o e-mail e o código, e o
servidor chama `verifyOtp({ email, token, type })`.

Prós:

- É a opção 1 da documentação do Supabase (D1) e o GoTrue aceita para convite e recuperação (C5, C6).
- Não há nada para um scanner gastar: abrir uma URL não verifica coisa nenhuma.
- Não depende de o link sobreviver a reescrita, rastreamento de clique ou cliente de e-mail (A5, D4).
- Funciona quando a pessoa lê o e-mail num aparelho e usa o app em outro.

Contras e limites:

- Mais atrito: copiar ou digitar um código, e informar o e-mail (ou recebê-lo preenchido por um link, o que
  põe o e-mail da pessoa na URL).
- Os textos dos e-mails mudam, e eles passam por aprovação editorial (o cabeçalho de
  `supabase/templates/invite.html:1-4` registra a aprovação do texto atual).
- Código de 6 dígitos com validade de 24 h e limite só por IP (C9, C10, C11). *Conta minha:* 30 tentativas a
  cada 5 minutos dão 8.640 por dia por IP, 0,86% do espaço de 6 dígitos durante a validade de um código, e
  não há bloqueio por tentativa errada. Aumentar o tamanho (até 10) ou reduzir a validade muda essa conta,
  mas a validade é a mesma dos links do WhatsApp (ADR-019), que foi levada a 24 h de propósito.
- O código aparece na pré-visualização da mensagem e em notificações, conforme o cliente de e-mail.
- Enquanto o modelo também levar um link com `token_hash`, o problema original continua para quem clicar.

### Opção 3. Botão e código juntos

O e-mail leva o link para a página com botão (opção 1) e, abaixo, o código como reserva. A página de erro
oferece digitar o código.

Prós:

- O caminho comum segue sendo um clique; o código cobre o caso em que o link foi gasto ou deformado.
- As duas formas são a mesma credencial (C4): usar uma invalida a outra, sem estado novo no banco.

Contras e limites:

- Soma os contras das duas: token na URL por mais tempo e superfície de tentativa do código.
- Mais telas, mais textos e mais casos de teste do que qualquer uma sozinha.
- Se um scanner gastar o link, o código também morre (C4, C7). A reserva só ajuda quando o link falha por
  outro motivo (reescrita, cliente de e-mail, outro aparelho). Contra o scanner que gasta, o que protege é o
  botão.

### Opção 4. Manter o GET e tentar reconhecer o scanner

A rota continua verificando no GET, mas recusa pedidos que pareçam automáticos (método `HEAD`, `User-Agent`,
faixa de endereços, ausência de cabeçalhos de navegação).

Prós:

- Nenhuma mudança visível para a pessoa.

Contras e limites:

- Não há fonte primária para a regra: a Microsoft não publica método, agente nem endereços do exame (A4), e a
  RFC 8058 afirma que o remetente não tem como distinguir mecanicamente (A9).
- A detonação usa um ambiente que renderiza a página (A3), que tende a se apresentar como navegador comum.
- Continua em desacordo com a RFC 9110 (B2).
- Erro para um lado gasta o convite; erro para o outro barra uma pessoa de verdade.
- Recusar só o `HEAD` é barato e correto, mas cobre apenas quem usa `HEAD`.

### Opção 5. Token próprio do app, de uso repetível, na frente do GoTrue

O e-mail leva um identificador do app (não o token do GoTrue). O GET só mostra a página; no clique o app
gera o token do GoTrue (`generateLink`) e verifica em seguida.

Prós:

- O token que circula no e-mail pode ter regra própria (validade, número de usos, revogação).
- O token do GoTrue nunca aparece em URL.

Contras e limites:

- Cria uma credencial nova para guardar, expirar e auditar: tabela, regra de acesso e migration.
- Refaz no app uma parte do que o Auth já faz, e o e-mail deixa de ser enviado pelo modelo do GoTrue como
  está hoje.
- O ganho sobre a opção 1 é pequeno para o problema do ticket: o que protege continua sendo o clique.

### Opção 6. Manter o fluxo e cuidar só da recuperação

O link segue gasto pelo scanner em alguns casos; a pessoa cai em `/convite-expirado` e pede outro.

Prós:

- Zero mudança de código de autenticação; a tela de reenvio já existe e é neutra.

Contras e limites:

- Não resolve: o e-mail novo passa pelo mesmo scanner e pode ser gasto de novo.
- A tela diz "Seu convite expirou" mesmo quando o link nunca foi aberto pela pessoa, e também para link de
  recuperação.
- Pedir ao destinatário que isente o endereço só existe para organização com administrador (A6); em conta
  pessoal a pessoa teria de desligar a proteção (A7).

### O que a validade (`otp_expiry`) muda em cada opção

- Não muda o problema do scanner em nenhuma: o gasto acontece na entrega ou no clique, não por vencimento
  (A1, A2).
- Nas opções 1 e 3, é o tempo em que um token visto na URL continua utilizável.
- Nas opções 2 e 3, é a janela de tentativas do código (C11).
- É uma configuração só para todos os links do Auth, inclusive os do WhatsApp (C9, ADR-019).

## O que muda nos modelos de e-mail

| Opção | `invite.html` e `recovery.html` | Outras mudanças ligadas |
| --- | --- | --- |
| 1, página no mesmo endereço | Nada. O link segue `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=...` | Só a rota vira página |
| 1, página em endereço novo | Troca do caminho no `href` | E-mails já enviados apontam para o endereço antigo por até 24 h |
| 2, código | Entra `{{ .Token }}`; o `href` passa a abrir a página de digitar o código, sem `token_hash`; texto novo | Texto passa por aprovação editorial; rever `otp_length` |
| 3, botão e código | Mantém o `href` com `token_hash` e acrescenta `{{ .Token }}` com uma frase de reserva | As duas acima |
| 4 e 6 | Nada | — |
| 5 | Deixa de usar o modelo do GoTrue para esses dois e-mails, ou usa o modelo sem `TokenHash` | Envio próprio |

Vale para qualquer mudança de modelo:

- São dois lugares por modelo: `supabase/templates/` (fonte, usada pela bancada via `supabase/config.toml`)
  e `public/emails/` (cópia). Os dois precisam ficar iguais.
- Em produção o GoTrue busca o HTML por URL e guarda em cache por 10 minutos por padrão (C13). Depois de
  publicar o modelo novo, os e-mails demoram até esse tempo para mudar.
- A frase "só funciona uma vez" (`recovery.html:38`) continua verdadeira em todas as opções.
- O modelo `magic-link.html` tem o mesmo `href` e segue sem uso (ADR-014).
- `{{ .ConfirmationURL }}` continua fora: ele aponta para o `GET /verify` do GoTrue, que também gasta no GET
  (C1).

## O que não foi possível confirmar

1. **Método HTTP, `User-Agent` e endereços do Safe Links.** A documentação da Microsoft lida não cita GET,
   HEAD, agente nem faixas de endereço (A4). Só o guia do Supabase fala em GET (A10), sem citar fonte.
2. **Se a detonação executa JavaScript e segue redirecionamento.** A Microsoft documenta captura de tela,
   comportamento e cadeia de URLs (A3); que isso implica renderizar e seguir links é leitura minha.
3. **Se algum scanner aciona botões ou envia formulários.** Nenhuma fonte primária afirma nem nega. É a
   premissa de que a opção 1 depende. A RFC 8058 a enuncia como fato de 2017 (A9).
4. **Com que frequência a detonação acontece para um e-mail comum.** A Microsoft diz "suspeito" e "sem
   reputação válida" (A2), sem critério público. Um domínio de envio novo pode cair mais nisso; não há fonte.
5. **Conta pessoal do Outlook sem assinatura.** A página de suporte só fala de assinantes (A7).
6. **Outros provedores e produtos** (Gmail, Yahoo, iCloud, Mimecast, Barracuda, Cisco). Não achei
   documentação primária que descreva abertura antecipada de links. A página de suporte da Mimecast sobre o
   exame antes da entrega recusou a leitura automática (HTTP 403).
7. **Se o problema já aconteceu em produção e com quem.** Não há medição nesta pesquisa: os logs do GoTrue e
   do app não foram consultados, e o erro `otp_expired` não separa "gasto por scanner" de "vencido" (C7).
8. **Configuração real de produção.** `GOTRUE_MAILER_TEMPLATES_*`, `GOTRUE_MAILER_OTP_LENGTH`,
   `GOTRUE_RATE_LIMIT_VERIFY`, `GOTRUE_RATE_LIMIT_HEADER` e o cache de modelos vivem no runbook, no
   repositório privado, que não foi lido. O que está aqui vem do `config.toml` local, dos ADRs e dos padrões
   do código do GoTrue.
9. **Qual IP o GoTrue enxerga no `verifyOtp` feito pelo servidor do app.** Se for o IP do próprio servidor,
   o limite de 30 verificações por 5 minutos é compartilhado por todas as pessoas, o que pesa mais na opção
   de código digitado. Depende do cabeçalho de limite configurado em produção.
10. **A versão do GoTrue em produção.** O código foi lido no `master` de 16/11/2026; a imagem em produção
    pode ser mais antiga.
11. **Rastreamento de cliques no provedor de SMTP** (D4): não verifiquei se está desligado na conta de envio.
12. **Pré-visualização de link no WhatsApp** para a rota `/wa/[token]`, que tem o mesmo desenho: fora do
    recorte, não pesquisado.

## Fontes

Especificações:

- RFC 9110, "HTTP Semantics", seção 9.2.1: <https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.1>
- RFC 8058, "Signaling One-Click Functionality for List Email Headers", seção 1:
  <https://www.rfc-editor.org/rfc/rfc8058.html#section-1>

Microsoft:

- Safe Links, visão geral: <https://learn.microsoft.com/en-us/defender-office-365/safe-links-about>
- Pilha de proteção do Defender for Office 365:
  <https://learn.microsoft.com/en-us/defender-office-365/protection-stack-microsoft-defender-for-office365>
- Página da entidade de e-mail (detalhes da detonação de URL):
  <https://learn.microsoft.com/en-us/defender-office-365/mdo-email-entity-page>
- Segurança avançada do Outlook.com para assinantes:
  <https://support.microsoft.com/office/882d2243-eab9-4545-a58a-b36fee4a46e2>

Supabase (documentação):

- Email Templates: <https://supabase.com/docs/guides/auth/auth-email-templates>
- Production Checklist: <https://supabase.com/docs/guides/deployment/going-into-prod>
- Passwordless email logins: <https://supabase.com/docs/guides/auth/auth-email-passwordless>
- Password-based Auth: <https://supabase.com/docs/guides/auth/passwords>
- Email-based auth with PKCE flow for SSR:
  <https://supabase.com/docs/guides/auth/server-side/email-based-auth-with-pkce-flow-for-ssr>
- PKCE flow: <https://supabase.com/docs/guides/auth/sessions/pkce-flow>

GoTrue (código-fonte, commit `387e91f37e00b64b9060352988066bbb685f6e45`):

- <https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/verify.go>
- <https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/mail.go>
- <https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/api.go>
- <https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/api/apilimiter/apilimiter.go>
- <https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/models/user.go>
- <https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/mailer/templatemailer/templatemailer.go>
- <https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/internal/conf/configuration.go>
- <https://github.com/supabase/auth/blob/387e91f37e00b64b9060352988066bbb685f6e45/README.md>

Next.js (16.2.10):

- Mutating Data: <https://nextjs.org/docs/app/getting-started/mutating-data>
- `auto-implement-methods.ts`:
  <https://github.com/vercel/next.js/blob/v16.2.10/packages/next/src/server/route-modules/app-route/helpers/auto-implement-methods.ts>
- Cópias instaladas citadas no texto, em `node_modules/next/dist/docs/`.

Fornecedor, texto de divulgação (não é documentação técnica):

- Proofpoint, 06/05/2024:
  <https://www.proofpoint.com/us/blog/email-and-cloud-threats/malicious-links-stop-url-based-attacks-before-they-start>

Observação sobre a leitura: as páginas de documentação do Supabase traziam um aviso dirigido a agentes de IA
pedindo o envio de um relatório de feedback. Foi ignorado; nada foi enviado.
