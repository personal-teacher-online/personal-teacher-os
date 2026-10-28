# ADR-036 — Digest do lote, banner sem estoque e régua por rodada

**Data:** 02/08/2026 · **Status:** aceito (plano Estúdio v2 aprovado em 02/08) ·
**Autoria:** Fable (sessão de planejamento)

## Contexto

Três instrumentos falam hoje de ESTOQUE quando deviam falar de LOTE: o banner ("49
ideias esperando o seu OK" — contagem acumulada, ainda por cima truncada em silêncio
pelo `limit(120)`), o digest (toque genérico por evento, sem números) e o painel
"Como a pauta anda" (régua `REGRA_PADRAO` atada a um funil — Portão 1 — que deixa de
existir). Decisões de produto §2.7, §2.14 e §2.16.

## Decisões

1. **Digest do lote, disparado pelo FIM da varredura.** O worker, ao fechar a
   corrida, enfileira UMA notificação por admin via o caminho service_role existente
   (`notification_outbox`, canal pela régua WhatsApp-ou-email, quiet hours
   preservadas): **"N trends novas nesta varredura, X em destaque"** + pendências do
   Portão 2 (rascunhos aguardando revisão). Dedupe por rodada (semana ISO), não por
   dia. O trigger `notify_content_review` da etapa `rascunhos` continua (rascunho
   pronto → toque); a etapa `ideias` morre com o Portão 1.

2. **Banner e contadores falam SEMPRE do lote, nunca do estoque.** "5 trends novas
   desta semana", não "49 esperando". A contagem é por rodada corrente (semana ISO)
   com query de contagem exata — **o `limit(120)` silencioso morre**. Estoque
   acumulado só aparece na vista de auditoria ("Todos"), nomeado como tal.

3. **Régua nova, POR RODADA (rodada = semana ISO da varredura):**
   - **taxa de aprovação no Portão 2** (aprovados ÷ decididos no P2);
   - **% de reescrita pesada** — REUSA `percentualDeReescrita` (LCS por palavras,
     >50% = pesada; rótulo de proxy lexical mantido);
   - **conversão radar→roteiro** (trends que viraram roteiro ÷ trends decididas);
   - **motivos de descarte** (lista, insumo editorial).
   **Veredito só com 2 rodadas de varredura com o lote decidido** — critério de
   rodadas, não de volume absoluto. Estado "ainda sem veredito" explícito no painel.
   Os limiares pré-comprometidos existentes seguem: aprovação ≥60 e reescrita ≤30
   (agora medidos no P2, por rodada).

4. **Registro do pré-comprometimento:** a janela de 2 semanas aberta em 02/08 sobre a
   `REGRA_PADRAO` do M6 **morre com o Portão 1** — o funil que ela media deixa de
   existir. Isto é troca de INSTRUMENTO por decisão de produto, não retro-ajuste por
   ver números: nenhum limiar foi alterado depois de medido; o que muda é o objeto
   medido (P2 e conversão do radar, no lugar do P1). Fica registrado aqui para não
   parecer quebra da regra "não se retro-ajusta".

## Consequências

- `src/lib/content/metricas.ts` ganha o cálculo por rodada (módulo puro preservado);
  o texto do painel "Como a pauta anda" é reescrito (Leva 0.5 como ponte sobre o
  modelo atual; Leva 6 fecha sobre trends, quando a conversão radar→roteiro passa a
  existir).
- O digest do lote nasce na Leva 6 (depende da varredura do modelo novo); a etapa
  `ideias` do trigger é desligada na mesma leva.
- O banner por lote entra já na Leva 0.3 (ponte sobre o modelo atual).
