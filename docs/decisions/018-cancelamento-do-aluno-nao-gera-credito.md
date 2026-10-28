# ADR-018 — Cancelamento pelo aluno não gera crédito; estorno vira ferramenta do atendimento

**Data:** 19/07/2026 · **Status:** aceito (ratificado pelo mantenedor em
18/07/2026, Leva 0 do veredito adversarial) · **Migration:**
`20260719000100_leva1_regra_cancelamento.sql`

## Contexto

Desde a F1/F2, cancelamento com aviso ≥ `min_notice_hours` gerava crédito de
reposição (90 dias) para o aluno — inclusive no autosserviço — e cancelar uma
reposição agendada com aviso devolvia o crédito por estorno formal. No e2e de
18/07/2026 (produção, aluno fake), o mantenedor vetou a lógica: **o direito do
aluno que avisa é REMARCAR** (franquia mensal de 2–4); crédito de reposição é
para **falha da escola ou caso especial avaliado por humano**. Cancelar-e-
ganhar-crédito criava um caminho paralelo à franquia que estimulava
remarcação em série — dor real das professoras (itens 24/24-b do
`qa/ajustes-e2e-2026-07-18.md`; veredito em `qa/veredito-adversarial-e2e.md`).

## Decisão

1. **`_cancel_class_core`**: crédito (`_earn_for_lost_class`) e estorno
   (`_refund_for_credit_born_class`) automáticos SÓ quando
   `cancelled_by = 'teacher'`. Cancelamento por aluno — self-service ou
   registrado pela admin — nunca credita nem estorna, em qualquer
   antecedência. Origem do earn/refund passa a ser sempre `'school'`.
2. **Válvula humana**: caso especial (saúde, força maior) é decisão do
   atendimento — `admin_makeup_adjust` (+1 auditado) ou o estorno formal
   (`_refund_for_credit_born_class`, par −1/+1 com `refund_of` e validade
   original/piso hoje+7) acionado manualmente. As funções permanecem no
   banco com as regras de validade intactas (testadas por chamada direta).
3. **Superfícies alinhadas**: tela Cancelar do portal reescrita (Remarcar
   como caminho principal; "cancelar de vez = aula não será reposta"; caso
   especial → atendimento; <aviso sem a frase de WhatsApp — item 23);
   `creditLine` dos templates neutro; extrato e empty-state sem a promessa
   "cancelou com aviso → crédito".
4. **31c (mesma migration)**: aula criada a <48h do início recebe o toque
   ACIONÁVEL imediatamente, com guarda para instâncias nascidas de ação do
   próprio aluno (`reschedule_of`/gasto de crédito) — essas já recebem
   confirmação própria.

## Consequências

- Ledger existente intocado (Lei 2) — a regra vale daqui para frente; os 21
  créditos do backlog e os earns por falha da escola seguem como estão.
- Extrato/netting da professora inalterados (o caminho teacher-fault não
  mudou); suíte de statements re-rodada verde.
- **Insumo jurídico**: a regra nova PRECISA constar das cláusulas que o
  advogado vai redigir (gate ALUNOS) — remarcação como direito com franquia;
  cancelamento sem reposição; crédito por falha da escola.
- Validade-90 ("causa aluno") deixa de ter caminho automático; permanece na
  ferramenta manual (coberta por teste de chamada direta).
- **Achado colateral corrigido na mesma migration**: `create_slot` usava
  `CURRENT_DATE` (data UTC — 1 dia à frente do negócio entre 20h e 24h de
  Cuiabá) e conflitava com o fechamento por `business_today()` no
  encerramento (violação de `recurring_slots_check` na janela noturna).
  Default alinhado a `business_today()` + `greatest()` no fechamento.
