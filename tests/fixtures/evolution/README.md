# Fixtures da Evolution API 2.3.7 (gate M3-0, medido em 26/10/2026)

Consumidas por `tests/m3-entrega.test.ts` (#21, M3-2). Detalhe da medição no
goal `docs/goals/onda-agenda-e-mensagens.md`, seção M3-0.

## De onde vem cada arquivo

A instância `personal-teacher` está DESCONECTADA desde 11/08/2026 (código 401,
aparelho desvinculado), então não houve captura ao vivo nem `--enviar`. Os
payloads saíram do banco da própria Evolution (`evolution-db`, só leitura), que
grava o MESMO objeto que o webhook manda (conferido no código da 2.3.7, linhas
indicadas abaixo).

| Arquivo | Origem | O que é real |
|---|---|---|
| `send-text-resposta.json` | linha da tabela `Message` de um envio pela API (28/07, `source = web`; é uma das 9 com texto de aviso do app, então é API com certeza) | tudo, menos texto, telefone e `instanceId` |
| `messages-update-entrega.json` | linha `MessageUpdate` (DELIVERY_ACK) do MESMO envio + envelope do webhook | mesmos campos do `data`, com valores sensíveis sintetizados; o envelope tem a forma da inbox de produção |
| `messages-update-leitura.json` | linha `MessageUpdate` (READ, `fromMe = true`) | mesmos campos do `data`, valores sintetizados; é de uma mensagem que não saiu pelo Baileys (`keyId` de 20 chars, `source: unknown`; nenhuma das 25 mensagens `3EB0…` foi lida), por isso o `keyId` tem outro formato; o `date_time` não tem relação com o envio |
| `messages-update-sequencia-envio-api.json` | as 7 linhas `MessageUpdate` do envio de 28/07, na ordem do banco | só `data`, sem envelope |

Trocados: telefones e LIDs (`55659000000NN`, `1000000000000NN`), texto da
mensagem, `instanceId`, `sender`. Preenchidos (não existem na tabela):
`date_time` dos envelopes. Sintetizados no MESMO formato (gate Sol): `keyId`/`key.id`, `messageId` e
`messageTimestamp` (deslocado para 2027-01-15T08:00Z, coerente entre os
arquivos). Mantidos: status, `fromMe`, sufixos de aparelho, ordem dos recibos.

## Por que a linha do banco vale como payload do webhook

- Resposta do `POST /message/sendText` (HTTP 201) = `messageRaw` de
  `prepareMessage` — o objeto que vai para `prisma.message.create` e para o
  evento `SEND_MESSAGE` (`whatsapp.baileys.service.ts` ~2425–2557,
  `sendMessage.router.ts` 54–62).
- `messages.update`: o handler monta `message = { keyId, remoteJid, fromMe,
  participant, status, pollUpdates, instanceId, messageId }`, chama
  `sendDataWebhook(MESSAGES_UPDATE, message)` e grava o mesmo objeto em
  `MessageUpdate` (`whatsapp.baileys.service.ts` 1558–1707). `participant` e
  `pollUpdates` chegam `undefined` numa conversa 1:1 sem enquete: o banco grava
  `null`, o JSON do webhook omite a chave (por isso não estão nas fixtures).
- Envelope: `{ event, instance, data, destination, date_time, sender,
  server_url, apikey }` (`webhook.controller.ts` 93–103), a mesma forma dos 347
  `messages.upsert` da inbox de produção.

## Armadilhas que estas fixtures mostram

1. O recibo NÃO tem `data.key`: a chave é `data.keyId`. O handler atual
   (`src/lib/webhooks/evolution.ts`) cai no hash do corpo para o `event_id`.
2. O `remoteJid` do recibo é LID com sufixo de aparelho (`…:46@lid`); o do envio
   é `<número>@s.whatsapp.net`. Casar só por `keyId`, nunca por telefone.
3. Fora de ordem e repetido: DELIVERY_ACK antes de SERVER_ACK; 5 DELIVERY_ACK
   no mesmo envio, alguns por aparelho (`:46`, `:43`, `:42`) e alguns
   IDÊNTICOS (entradas 3 e 4; SERVER_ACK nas 2 e 5). Os dois são replay.
4. `READ` também chega com `fromMe = false` (184 linhas: é o próprio número
   da escola lendo uma mensagem recebida). `fromMe = true` é condição necessária,
   nunca suficiente: mensagem digitada no celular também é `fromMe`. Recibo
   é nosso só quando `keyId` casa com o `provider_message_id` do outbox.
5. O id do envio pela API é `3EB0` + 18 hex (22 chars, `source = web`). O
   WhatsApp Web usa o mesmo formato, então o prefixo NÃO prova que foi a API;
   os ids de 20 chars (`2A…`, `source = unknown`) não saíram do Baileys.
6. Edição e remoção não chegam como `messages.update` (são `messages.edited`
   e `messages.delete`). `messageId` só vem porque o `.env` embutido da imagem
   liga `DATABASE_SAVE_DATA_NEW_MESSAGE`; não dependa dele.

## O que falta capturar ao vivo (depois de reparear a instância)

- Resposta HTTP crua do `sendText` (`--enviar`, com OK do dono). Até lá o
  critério 1 da #19 fica aberto para esse arquivo: é reconstrução do banco.
- Um `messages.update` recebido de fato pelo webhook (exige `--webhook --apply`
  com `MESSAGES_UPDATE`, com OK do dono, e só depois do M3-2 em produção).
- `tests/fixtures/resend/`: o `email.delivered` depende do
  `RESEND_WEBHOOK_SECRET`, ausente na env do app em 26/10/2026.
