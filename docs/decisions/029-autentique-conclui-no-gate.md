# ADR-029 — A integração Autentique conclui no gate 🔑, com a superfície desligada até lá

**Data:** 27/07/2026 · **Status:** aceito · **Origem:** rodadas 4–6 do Sol na
Onda 1 (os graves convergiram TODOS para o fluxo de assinatura).

## Contexto

O motor de assinatura (reserva atômica, webhook idempotente, atos humanos
auditados) foi endurecido nos lotes c14/c15 e está muito melhor do que nasceu.
Mas a cauda de achados da rodada 6 (r6 nº 1, 4, 5, 6) é de OUTRA natureza:
reconciliação de estado com um serviço externo cujo comportamento real —
formato de IDs, semântica exata de erros GraphQL, ordem de webhooks — **não
pode ser verificado sem o `AUTENTIQUE_TOKEN`**, que é gate externo pendente
(🔑/👩‍🎓). A Fase 3 já havia decidido: "spec de handoff do Autentique;
implementação fica para fase futura". Continuar iterando às cegas é polir
contra uma API imaginada.

## Decisão

1. **A superfície de assinatura fica DESLIGADA até o gate**: sem
   `AUTENTIQUE_TOKEN` no ambiente, a seção Assinatura do detalhe do contrato
   mostra apenas o aviso honesto ("assinatura digital chega com a chave do
   Autentique") e nenhum painel de envio/anexo/cancelamento é alcançável. O
   motor (RPCs, webhook, inbox) permanece no banco, testado no nível de dados.
2. **Achados r6 nº 1, 4, 5 e 6 ficam REGISTRADOS para a fase do gate**, junto
   com: chave de idempotência no cliente (pendência já anotada no client),
   validação do formato real de ID, prova do ciclo com a API verdadeira e a
   consulta de preflight de duplicatas no rito de deploy que ligar o índice.
3. **r6 nº 3 (semântica de casal: `signature.accepted` de UM signatário não
   encerra o documento) é corrigido AGORA** — é correção da matriz de eventos
   do nosso lado, independente do gate — junto com os leves (aceite morto,
   maxLength UTF-16, teto do motivo na RPC, diagnóstico do webhook, rótulo
   "vinculado em").

## Consequência

A Onda 1 deixa de ficar refém de uma integração que não roda em produção; o
Sol volta a julgar o que o site DE FATO entrega. Quando o dono destravar o
gate 🔑, a fase Autentique reabre com: os 4 achados registrados, uma rodada de
integração contra a API real e o religamento da superfície.
