# ADR-038 — WhatsApp: manter a Evolution, Cloud API direta num número só de envio, ou Coexistence

**Data:** 26/10/2026 · **Status:** ACEITA em 26/10/2026 pelo dono (o mantenedor),
**opção B** (Cloud API direta num número só de envio). Substitui o ADR-016 a
partir desta data; a nota de substituição no ADR-016 e a retirada do código
entram com a issue #45, quando a Cloud API estiver entregando em produção. Registro do que já foi
feito na Meta, das decisões do dono (itens 3 e 4 respondidos em 31/10/2026) e das
travas do token: seções "Decisões do dono" e "Estado na Meta", no fim.

## Contexto

Os avisos por WhatsApp saem pela Evolution API 2.3.7 (não-oficial, motor Baileys,
ADR-016). A instância está desconectada desde 11/08/2026: código 401, "aparelho
desvinculado" (medição da sonda do M3-0, PR #33). A causa provável é operacional:
a dona tirou o chip do número da instância e hoje usa duas contas no mesmo
iPhone. Desde então o e-mail cobre sozinho. Em 26/10 o dono perguntou pelas
novidades do WhatsApp para mensagens automáticas, e a pesquisa apontou o
Coexistence (o mesmo número no app WhatsApp Business e na API oficial).

Um fato do código muda a pergunta: o sistema **já separa dois números**
(`src/lib/contact.ts`). O de **atendimento** (`WHATSAPP_ATENDIMENTO_E164`) é o que
a dona responde, e o rodapé de todo aviso manda o aluno para ele. O de
**disparo** é outro, e só envia. O Coexistence serve para pôr a API no número que
a pessoa usa no app; aqui o número de disparo não precisa de app nenhum.

Produção não tem aluno real (reset de 30/07), então trocar o canal agora não
interrompe ninguém. Fontes: só documentação da Meta, lida em 26/10/2026 (lista no
fim).

## O que a Meta diz (conferido)

**Cloud API direta (número próprio, app próprio da escola)**
- O número precisa receber **SMS ou ligação** para o código de verificação e
  **não pode estar em uso no WhatsApp**: a conta do app nele tem que ser apagada
  antes. Precisa de nome de exibição aprovado e PIN de duas etapas.
- Portfólio novo começa com **250 pessoas distintas por 24 h** fora da janela de
  atendimento e 2 números registrados. Verificar a empresa sobe para 2.000 pessoas.
  Para ~50 alunos, 250 basta.
- Tech Provider e App Review com acesso avançado servem para mexer em conta de
  **outra** empresa ("chamadas em contas que a sua empresa não possui retornam erro
  200" sem o acesso avançado). Para a conta da própria escola, não são exigidos.

**Coexistence (o mesmo número no app da dona e na API)**
- App WhatsApp Business **2.24.17 ou mais novo**, e o número no app *Business*.
- **Só Tech Provider ou Solution Partner faz a ligação.** Tech Provider exige
  verificação da empresa, App Review com dois vídeos e acesso avançado a
  `whatsapp_business_messaging` e `whatsapp_business_management`. A alternativa é
  um parceiro (BSP), com mensalidade própria (não pesquisada: não é fonte da Meta).
- A ligação desvincula os aparelhos vinculados (dá para religar até 4). Celular
  principal parado ~14 dias derruba a ligação (`PARTNER_REMOVED`).
- Fora da API: grupos, chamadas, listas de transmissão, visualização única,
  localização ao vivo, mensagens temporárias, catálogo, etiquetas, respostas
  rápidas. **20 mensagens por segundo** fixas.
- A Meta passa a mandar ao sistema as conversas 1:1 do número (e, se a dona
  autorizar, 180 dias de histórico). Grupos nunca.
- Duas contas no mesmo iPhone: a documentação não trata.

**Custo (tabela oficial em BRL, vigente desde 01/10/2026, por mensagem entregue,
pelo país do número do aluno, sem impostos).** Vale igual para as duas formas de
Cloud API.

| Categoria | Brasil | América do Norte (+1) | Resto da Europa Ocidental (Portugal) |
|---|---|---|---|
| Utility (avisos) | **R$ 0,035** | R$ 0,0175 | R$ 0,088 |
| Marketing | R$ 0,3217 | R$ 0,1287 | R$ 0,3047 |

- **Duas mudanças de 01/10/2026 que corrigem o blueprint (`docs/research/02`
  §5):** o template utility dentro da janela de 24 h **deixou de ser grátis** (o
  tipo de preço passou de `free_customer_service` para `regular`), e a mensagem de
  serviço (texto livre respondendo ao aluno), grátis desde 11/2024, voltou a ser
  cobrada depois de **1.000 grátis por mês por número**. O projeto não manda
  mensagem de serviço.
- Sem cartão no Billing Hub, a Meta não entrega o que é cobrado. Faturamento em
  BRL pela Facebook Brasil.
- A Meta pode reclassificar um template de utility para marketing (9× mais caro):
  texto com promoção, oferta ou conteúdo misto vira marketing.

**Política de IA (Termos da Plataforma, cláusula 4.7, em vigor desde 15/01/2026).**
A proibição vale para provedor de IA cuja IA é a funcionalidade principal, "em vez
de incidental ou auxiliar". Aviso de aula, crédito e remarcação por template fixo
não usa IA: **permitido**. Quem julga o que é "principal" é a Meta.

**Consentimento (Política de Mensagens, 23/09/2026).** Exige número dado pela
pessoa, opt-in para receber mensagens e respeito a qualquer pedido de parar.

## Opções

| | A. Evolution (ADR-016) | **B. Cloud API direta, número só de envio** | C. Coexistence no número de atendimento |
|---|---|---|---|
| Para voltar a enviar | Chip no número, ler o QR | Chip novo (ou apagar a conta do WhatsApp num dos números antigos), SMS, nome de exibição, cartão na Meta, templates aprovados | Tudo de B, mais Tech Provider (App Review) ou BSP pago |
| Risco de banimento | Real (viola os termos) | Nenhum por usar a API | Nenhum por usar a API |
| Quebra por atualização | Baileys quebra quando o WhatsApp muda | Contrato versionado da Meta | Idem, mais a regra dos 14 dias |
| Privacidade | A instância recebe toda conversa do número, grupos inclusive, e manda a `apikey` em todo webhook (achados do M3-0) | Só chega o que alunos mandarem para o número de envio | Chegam as conversas 1:1 da dona |
| Texto da mensagem | Livre, muda no deploy | Template aprovado; mudar o texto é reaprovar | Idem B |
| Custo mensal | R$ 0 de mensagem | ≈ R$ 20 a R$ 36 | ≈ R$ 20 a R$ 36 + BSP, se for o caminho |
| O que ganha sobre B | — | — | Aviso sai do número que o aluno já conhece |

**Conta do custo.** Cada aula gera 2 lembretes por WhatsApp (48 h e 2 h,
`enqueue_class_touches`). Para ~44 alunos particulares a 1,3 aula por semana: ~11
lembretes e ~2 avisos de evento por aluno por mês, ~570 mensagens. Os ~6 de
mentoria recebem ~1 aviso por mês (lembrete de encontro, crédito destravado).
Total ~580 mensagens, **≈ R$ 20** com números do Brasil. No teto (2 aulas por
semana para todos, ~890 mensagens, 10% de números de Portugal): **≈ R$ 36**.

## Recomendação

**Opção B: Cloud API direta num número só de envio, e não religar a Evolution.**
1. É o desenho que o código já tem: o número de disparo nunca foi o de conversa.
   B só troca o motor dele por um oficial.
2. Tira o risco de banimento e os dois achados de privacidade do M3-0 sem trazer
   as conversas da dona para dentro do sistema (o preço de C).
3. Dispensa Tech Provider, App Review e BSP. O trâmite é verificação do número,
   nome de exibição, cartão e aprovação dos templates.
4. Custa ≈ R$ 20 a R$ 36 por mês para ~50 alunos.
5. O momento é barato: nenhum aluno real, e o M3 está montando recibo e reenvio.
   Fazer o M3-2 contra a Evolution e refazer contra a Meta é trabalho dobrado.

C só vale se o dono quiser que o aviso saia do número de atendimento. Fica
registrada como evolução possível, não como passo.

## Consequências (B aceita em 26/10/2026; as issues estão em "Trabalho na fila")

**No código**
- Driver novo atrás de `NotificationChannel` (`src/lib/notify/`). A mensagem muda
  de forma: fora da janela a Meta só aceita **template com nome, idioma e
  parâmetros em ordem**, então o canal ganha campo de template e o resultado passa
  a devolver o id (`wamid`, que a Meta devolve na hora do envio). O registro de
  canais é montado em 8 lugares (despachante e actions de portal, professora,
  alunos e agenda) e o cartão de integração em Ajustes lê o sinal da Evolution:
  tudo isso muda.
- **9 templates a aprovar**, os que de fato saem por WhatsApp ao aluno:
  `class-reminder`, `reschedule-confirm`, `class-cancelled`, `credit-expiry`,
  `meeting-reminder`, `meeting-cancelled`, `mentorship-eligible`,
  `briefing-reminder`, `briefing-update-reminder`. O `period-reschedule-invite`
  tem texto de WhatsApp mas hoje só é enfileirado por e-mail. As partes opcionais
  de hoje (link do Meet só quando existe, variantes 48 h/2 h, com ou sem crédito)
  viram templates separados, porque a Meta recusa parâmetro vazio ou com quebra
  de linha. `mentorship-eligible` é o de maior risco de virar marketing.
- **Uma fonte só para o texto.** Hoje o catálogo de Ajustes mostra o texto do
  código, que é o que sai. Com template, o que sai é o corpo aprovado na Meta.
  O corpo de cada template precisa morar no repositório e alimentar o catálogo e
  a lista de parâmetros, com teste que prenda isso. Os textos passam antes pela
  dona (M3-4, PR #35): cada mudança depois é reaprovação.
- A Evolution (driver, webhook, sonda do M3-0, runbook §M e ~15 testes) sai numa
  PR própria depois que a Cloud API estiver entregando.

**No banco (pede migration, Lei 7, uma PR com migration por vez)**
- **Avisos internos à admin** (`content-digest`, `content-review`): o canal é
  escolhido no SQL, "WhatsApp se o perfil admin tem número", e esses dois
  avisos têm versão WhatsApp de conteúdo variável (lista de trends e rascunhos),
  que não cabe em template. **Decisão (27/10/2026): aviso interno à admin sai
  só por e-mail**; a mudança de SQL vai na migration da #42 e o despachante
  (#43) prende, com motivo explícito, qualquer linha de WhatsApp sem template.
  (A versão anterior deste parágrafo dizia "nada muda": estava errada, achado 1
  da revisão adversarial da PR #46.)
- **LGPD:** `purge_evolution_inbox` e `admin_purge_evolution_by_phone` só apagam
  linhas da Evolution. O recibo da Meta guarda o telefone do aluno, então os dois
  expurgos precisam cobrir a origem nova.
- **M3-1** (ainda plano, não migration) segue neutra nas colunas, com três
  ajustes: o expurgo acima; o `failed` que chega **depois** do envio (cartão
  recusado, por exemplo) precisa deixar a linha presa e reenviável, não
  "enviada com motivo"; e o recibo que chega antes do id gravado fica pendente e
  é aplicado quando o id entra (a regra que a PR #33 já propõe). "Lido sem
  entregue preenche entregue" já está no mapa da #33.

**No webhook (Lei 6, detalhe para o plano do M3-2)**
- Uma linha de `webhook_inbox` por recibo, chave natural `<wamid>:<status>`,
  gravando **o objeto do recibo mais o `metadata` do número**, não o corpo do
  POST inteiro nem `contacts` (exceção à Lei 6 "payload cru persistido",
  registrada como decisão 5 abaixo). Assinatura `X-Hub-Signature-256` conferida
  sobre o corpo cru, antes de tudo. App secret, token e verify token só em env
  do servidor (Lei 4). Sem `META_APP_SECRET` ou sem verify token na env, a rota
  responde fechada (401/403), nunca aberta.
- **Mensagem que um aluno mandar ao número de envio é guardada inteira** (decisão
  3, 31/10/2026: Lei 6 mantida, sem exceção): uma linha por mensagem, chave
  `<wamid>:message`, payload = o objeto `messages[i]` mais o `metadata` do
  número, o mesmo molde do recibo. Nada é acionado por ela (decisão 4); a admin
  a vê na aba Recebidas (#113). A versão anterior deste parágrafo propunha
  descartar: morreu. `account_update` é guardado: é por ele que a Meta avisa
  número caído ou nome recusado, e o sinal de Ajustes passa a ler dele.

**Consentimento.** A tela de ciência do portal já grava aceite versionado e
auditado de "e-mail e WhatsApp são os canais de aviso" (`policy_versions`,
`ciencia-canais`), e o convite diz que o contrato autoriza o WhatsApp. Falta
conferir se o texto vigente nomeia a escola e o WhatsApp (opt-in da Meta). O
"pedido de parar" do aluno não existe por decisão (item 4, 31/10/2026): o canal é
contratual e só a admin tira o WhatsApp da ficha.

**No M4.** O checklist termina em "mensagem entregue". Sem a Evolution, o M4 roda
com e-mail e o WhatsApp entra quando a Cloud API estiver no ar.

## Decisões do dono (26/10/2026, noite)

1. **Opção B**, aceita. A Evolution não volta: em 26/10 ficou provado que o
   pareamento está quebrado pelo lado do WhatsApp (etapa `companion_reg_refresh`,
   Baileys#2737; a imagem remendada `ghcr.io/<conta>/evolution-api:2.3.7-pr2765`
   em produção pareia, mas a conta Agenda exige passkey, que o Baileys não faz,
   Baileys#2672).
   Registro completo na nota do M3-0 (`docs/goals/onda-agenda-e-mensagens.md`,
   PR #33).
2. **Número de envio: o de envio (no Bitwarden)** (o antigo da instância da Evolution).
   A conta do app WhatsApp Business dele foi apagada antes (sem PIN de duas
   etapas), e o número foi registrado na Cloud API: status "Conectado", limite
   de 250 clientes por 24 h.
3. **Mensagem de aluno ao número de envio: DECIDIDA em 31/10/2026 pelo dono.
   Guarda-se inteira, Lei 6 mantida, sem exceção.** Cada mensagem que um aluno
   mandar ao número de envio (`value.messages[i]`) vira uma linha de
   `webhook_inbox`, `source = 'meta'`, `event_id = '<wamid>:message'`, com o
   objeto da mensagem inteiro (texto, tipo, `from`, `timestamp`, `context` que
   aponta para o aviso nosso respondido, toque em botão) mais o `metadata` do
   número: o mesmo molde do recibo (item 5), para o expurgo LGPD por telefone
   (#42) achar a linha pelo mesmo campo. Mídia fica como veio (só ids; nada é
   baixado). A proposta anterior (rastro sem o texto, achado 2 do M3-0) morreu:
   o dono preferiu não abrir exceção à Lei. Consequência aceita: guardar sem
   ninguém ler é meio caminho, então as mensagens recebidas ficam visíveis à
   admin numa aba "Recebidas" da tela Mensagens (#113, depende da #44), com a
   palavra de parada só destacada, nunca acionando nada (item 4). A #44 saiu do
   label `decisao` nesta data.
4. **Pedido de parar: DECIDIDO em 31/10/2026 pelo dono. O aluno não desliga os
   avisos por WhatsApp.** Receber a confirmação de aula pelo WhatsApp faz parte
   da contratação, e o sistema já é assim desde 18/07/2026 (decisão M4-3 do
   plano integrado, migration `20260718000900_f7_cadastro_lgpd.sql`: o
   `whatsapp_opt_in` foi apagado e a regra única é "tem número no cadastro →
   recebe"; o aluno dá ciência do canal no primeiro acesso,
   `whatsapp_channel_ack_at`). Base na LGPD: execução de contrato, não
   consentimento. Quem gerencia é só a admin (a dona e o dono), pelo número de
   WhatsApp na ficha do aluno (painel "Editar WhatsApp", que já existe): sem
   número, nada sai. Nada a construir. Um "PARAR" recebido não é ignorado: a
   linha aparece destacada na aba Recebidas (#113) e a escola decide caso a caso
   (conversar pelo atendimento, corrigir um número trocado, ou apagar o número
   da ficha). A Política de Mensagens da Meta exige respeitar o pedido, não
   exige automatismo; o que não se faz é seguir mandando depois de ver o pedido.
   A proposta anterior (opt-out pelo portal ou automático por palavra,
   `whatsapp_opt_in` + `audit_log`) morreu, e nenhuma Lei do projeto muda: o
   campo que ela citava nem existe mais. Deixa de bloquear convidar aluno real
   com WhatsApp. Pendência: conferir que o texto do contrato (Autentique,
   ADR-029) nomeia o WhatsApp como canal de aviso de aula.
5. **Exceção à Lei 6 (recibo guardado reduzido): ACEITA em 27/10/2026**, pela
   sessão orquestradora do dono. A inbox guarda, por recibo, o objeto
   `statuses[i]` (com `timestamp`, `recipient_id`, `errors`) mais o `metadata`
   do número (`phone_number_id`), e não o envelope inteiro: a assinatura é
   conferida antes de gravar; o envelope repete `contacts` e o id do portfólio
   em todo POST, sem valor para auditoria; e o telefone do aluno fica num campo
   só, o que o expurgo LGPD (#42) precisa.

## Estado na Meta (27/10/2026, 11h40 BRT)

| Item | Valor |
|---|---|
| Portfólio | "Personal Teacher Academy" (renomeado; o nome antigo levava o nome da dona), ID **922384871569034**, empresa **verificada** em 27/10; o limite seguia **250 pessoas por 24 h** (`TIER_250`) às 11h40, e sobe para 2.000 quando a Meta reavaliar (verificação + qualidade) |
| Conta de mensagens (WABA) | "Personal Teacher Academy", ID **1797326834848361**, aprovada |
| Número de envio | o de envio (no Bitwarden), status **Conectado**, Phone number ID **1408839068975328**, PIN de duas etapas **enviado** em 27/10 (resposta `success`, mas `is_pin_enabled` seguiu `false`; **conferir no WhatsApp Manager**, runbook §AN.3); PIN no Bitwarden |
| Nome de exibição | "Personal Teacher Academy", **em análise** |
| App na Meta | "Personal Teacher OS", ID **1493366639299181**, caso de uso "Conectar-se com clientes pelo WhatsApp", **modo desenvolvimento** (precisa ser publicado para receber webhooks reais; runbook §AN); **instalado na conta de mensagens** em 27/10 (tela "Escolha as contas do WhatsApp que o app deverá acessar", opção "apenas as atuais") |
| Usuário do sistema | **"Outbox Worker"**, ID **61596067645415**, papel Funcionário, controle total no app e na **conta de mensagens**; token permanente (nunca expira; `whatsapp_business_messaging` + `whatsapp_business_management`) no Bitwarden = `WHATSAPP_CLOUD_TOKEN` |
| Cartão | cadastrado em 27/10 ("Pagamento adicionado", CNPJ/CPF informado, fins comerciais) |
| Pessoas com acesso total | a dona, a página "Personal Teacher" e o dono; usuários do sistema: **Outbox Worker** (app e conta de mensagens) e **Reporting Server** (app e "Conta do WhatsApp"; sem token válido, a retirar os ativos) |
| Sobras a apagar depois | usuário do sistema "Reporting Server" (ID 61595619704989, tokens anulados, sem uso; ver trava 3 abaixo); conta de mensagens antiga, com o nome antigo (vazia); apps antigos "Robo Agenda a dona" ×2 e "Robo Aulas Teacher Vicky" ×2 |

Ids não são segredo (aparecem em toda URL do painel); o token, o app secret, o
verify token e o PIN são, e ficam só no Bitwarden e na env do app (Lei 4).

**Travas do token permanente (00h30 a 11h35 de 27/10), todas resolvidas.**
Rito que funcionou no runbook §AN.2. Marcado o que foi medido e o que é
suspeita.
1. **Admin novo não cria usuário do sistema Admin por 7 dias (medido).** Depois
   do 2FA e da verificação da empresa, o erro mudou de "nome inválido" para "o
   usuário administrador do sistema deve ter sido criado a mais de 7 dias".
   Papel **Funcionário** passou na hora e basta: recebe os ativos com controle
   total e gera token sem validade.
2. **Nome (suspeita, um caso).** "Avisos Academy" foi recusado como "nome
   inválido" já com 2FA e verificação em dia; "Outbox Worker" passou logo em
   seguida. Talvez a Meta recuse nome parecido com o da empresa; não testado
   além disso. Na dúvida, nome neutro.
3. **Anular tokens (não medido; evitar).** Depois de "Anular tokens" no
   Reporting Server, o que chegou para teste era idêntico ao token anulado
   (erro 190, subcódigo 460), e o dono viu na tela o "mesmo token". Não está
   provado que a Meta devolve a mesma cadeia: o que estava na área de
   transferência pode ter vindo do Bitwarden, e no Outbox Worker o dono também
   achou que "gerou o mesmo" e o token era outro (só os 14 primeiros caracteres
   batiam; todo token começa igual). O Reporting Server foi abandonado por
   prudência. Regra prática: não anular sem motivo; para conferir se o token é
   novo, comparar a cadeia inteira, não o começo.
4. **Atribuir a "Conta do WhatsApp" não deu acesso à API (medido).** Em
   Configurações da empresa há dois objetos com o nome da escola: **Contas do
   WhatsApp** (o contêiner do número; abas "Pessoas", "Linked WhatsApp
   accounts", "Messaging accounts") e **Contas de mensagens** (a WABA, que o
   token usa). O painel mostrava "Reporting Server, acesso total" na primeira e
   a API respondia "objeto não existe ou sem permissão" (erro 100, subcódigo
   33) para a WABA. Atribuir o Outbox Worker em **Contas de mensagens** resolveu
   na hora. Diagnóstico que discrimina: `GET /{waba}/assigned_users?business={portfólio}`
   com um token de usuário (o temporário do painel do app serve) lista quem a
   API reconhece. `me/assigned_whatsapp_business_accounts` **não** serve: veio
   vazio antes e depois da correção.
5. **App instalado na conta de mensagens (feito antes da trava 4; não se sabe
   se era necessário).** Às 11h18, gerar o token temporário abriu "Escolha as
   contas do WhatsApp que o Personal Teacher OS deverá acessar"; aceito com
   "apenas as atuais". Depois disso `GET /{waba}/subscribed_apps` lista o app.
   Como veio antes da correção da trava 4, o rito do AN.2 inclui o passo.

O token temporário do painel (Configuração da API → Gerar token de acesso) é
um token de usuário que já nasce vendo a WABA; serviu para diagnosticar e para
o primeiro envio do PIN (~11h20), antes de o permanente funcionar; o segundo
envio (~11h40) foi com o permanente, mesmo PIN. Vale ~1 h; não é reserva para produção.

**Adendo de 31/10/2026 (medido de dentro do container de produção, pela API).**
- O token de 27/10 estava **inválido** (erro 190, subcódigo 460, "sessão
  invalidada"): em 31/10 o Facebook restringiu a conta pessoal do dono ("pode
  ter sido invadida"); a liberação pediu só troca de senha. Depois disso o
  portfólio passou a exigir **chave de acesso (passkey)** de quem gerencia
  (aviso "Passkey required" em Pessoas): sem ela, a tela de usuários do sistema
  não gera token. Com a passkey criada, token novo no **mesmo** Outbox Worker
  (Funcionário, validade Nunca, os dois escopos); `debug_token` confirma
  `type: SYSTEM_USER`, `is_valid: true`, `expires_at: 0`. **Trava 6:** restrição
  de segurança na conta de um administrador derruba o token do usuário do
  sistema (coincidência medida no mesmo dia; a causa é a provável, não provada;
  a chave do app não foi redefinida). **Trava 7:** passkey obrigatória para gerenciar o portfólio
  (medido). Ao token antigo não se fez nada: já estava morto.
- **PIN de duas etapas: encerrado, sem ação.** A documentação da Meta diz que o
  PIN está sendo descontinuado para números elegíveis da Cloud API: "quando o
  número é elegível, a aba Verificação em duas etapas deixa de aparecer no
  WhatsApp Manager e não há PIN para mudar; se a aba ainda aparece, o número
  ainda não é elegível". A aba não aparece para o número de envio, logo ele é
  elegível; `is_pin_enabled` segue `false` e é esperado. A doc não nomeia o que
  substitui o PIN contra chip reciclado: o chip segue precisando ficar ativo.
  Fonte: developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/two-step-verification/
  (lida em 31/10/2026).
- Leitura da conta: WABA `APPROVED`; número `CONNECTED`, `VERIFIED`, `TIER_250`,
  qualidade `UNKNOWN` (nunca enviou), **nome de exibição `PENDING_REVIEW` desde
  27/10**; 0 templates na conta (a #41 entregou 20 para submeter, as variantes contadas
  uma a uma; os "9" de "No código" eram as famílias); app inscrito na conta; app ainda em modo
  desenvolvimento.
- As cinco envs de AN.1 estão no container (Redeploy pelo Coolify em 31/10).

## Trabalho na fila (issues de 27/10/2026)

| # | O quê | Depende de |
|---|---|---|
| #41 | catálogo dos templates (fonte única + JSON de submissão; inclui a variante "a escola moveu") | nada (a submissão à Meta, AN.6, espera a resposta da dona ao M3-4) |
| #42 | migration M3-1 revisada para a origem `meta` (substitui a #20): colunas, recibo, reenviar, reserva do despacho, aviso interno só e-mail, expurgo | nada; só uma migration aberta por vez; mescla a PR #33 antes (ou copia o mapa do M3-0) |
| #43 | driver `cloud-api` + despachante grava `wamid` + cartão de Ajustes | #41, #42 |
| #44 | webhook `/api/webhooks/meta` idempotente, assinatura conferida; guarda mensagem de aluno inteira | #42 (main em 30/10) e #43 (main em 31/10); itens 3 e 4 respondidos em 31/10/2026, label `decisao` retirado; com a #43, substitui a #21 |
| #113 | aba Recebidas na tela Mensagens (o que o aluno escreveu ao número de envio, palavra de parada destacada) | #44 |
| #45 | retirada da Evolution | #43, #44 em produção entregando (label `decisao` até lá) |
| #47 | recibo `email.delivered` do Resend (parte de e-mail da antiga #21) | #42, #43 |

Produção (dono, `sessao-manual`): runbook §AN. Em 31/10/2026: envs no container
e token novo validado de dentro dele (AN.1 e AN.2 feitos), PIN encerrado sem
ação (descontinuado pela Meta; adendo de 31/10 em "Estado na Meta", acima); faltam webhook (#44, agora na fila),
publicação do app (exige URL de política de privacidade, que o site não tem),
templates (decidir botões antes de submeter) e teste de envio. A #22 (M3-3b) já
está na main (PR #109). A #24 (M3-5) precisa ser reescrita para a Meta quando a #43
e a #44 estiverem na main. As #20 e #21 (versões para a Evolution) **foram fechadas em 29/10/2026**, no
corte do repositório público (o risco de uma segunda migration M3-1 concorrente
da #42 acabou aí). Os textos (M3-4) ainda não foram respondidos pela dona:
a #41 entrega o catálogo com o texto atual, e a submissão à Meta (AN.6) espera
a resposta, porque cada edição depois da aprovação é reaprovação.

## Fontes (Meta, lidas em 26/10/2026)

- Coexistence: developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users
- Números de telefone e registro: developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers
  e …/business-phone-numbers/registration
- Tech Provider (e o erro 200 sem acesso avançado): …/whatsapp/solution-providers/get-started-for-tech-providers
- Limites de mensagem: …/whatsapp/messaging-limits
- Preços e mudanças de 01/10/2026: developers.facebook.com/docs/whatsapp/pricing
  e …/pricing/updates-to-pricing; tabela "Taxas de lista em BRL" anexada na
  página; mapa de DDI na mesma página (Portugal em "Rest of Western Europe", +1 em
  "North America").
- Recibos: …/whatsapp/webhooks/reference/messages/status
- Categorias de template e reclassificação: …/whatsapp/templates/template-categorization
- Termos da Plataforma (cláusula 4.7, IA): facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform
- Política de Mensagens (opt-in e opt-out): whatsappbusiness.com/pt-br/policy
