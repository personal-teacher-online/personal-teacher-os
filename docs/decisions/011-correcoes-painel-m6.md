# ADR-011 — Correções do painel de revisão final (M6)

**Contexto.** O painel do M6 (3 revisores: Leis, lacunas Fases 2–5, fidelidade aos blueprints) encontrou 1 bug de dinheiro, 2 cumprimentos parciais de Lei e decisões não registradas. Corrigido antes do gate final. As migrations foram editadas em vez de acrescidas: **nenhum ambiente compartilhado existe ainda** (Lei 7 preservada); a partir do primeiro deploy, qualquer mudança = nova migration.

**Decisões (aplicadas):**

1. **`makeup_balance()` reescrita com FIFO CRONOLÓGICO.** A fórmula agregada do ADR-009 assumia que todo gasto consumiu créditos que viriam a expirar — um crédito que expirava SEM uso "ressuscitava" para absorver gasto posterior (reproduzido: earn expirado nunca usado + earn válido + spend deixava saldo 1 em vez de 0, e um 2º spend era aceito). Agora a função reproduz a linha do tempo do ledger: cada gasto consome, FIFO por expiração, um crédito ainda válido na data (negócio) do gasto. Testes de regressão nos dois sentidos. O ADR-009 item 1 fica **superado por este**.
2. **Contrato não-`active` não movimenta valor:** `spend_makeup`, `reschedule_class` bloqueiam com exceção; `mentorship_can_book` retorna false. `earn_makeup` continua livre (ajuste administrativo de histórico). O `status` deixou de ser só-informativo sem ninguém ter decidido isso.
3. **`reschedule_class` rejeita nova data/hora no passado** (estado incoerente que furava o guard do materializador).
4. **Lei 8 completada:** `students`, `teachers`, `recurring_slots` e `teacher_statements` adicionados ao trigger de auditoria (14 tabelas cobertas).
5. **EXECUTE "negar por padrão" de verdade:** helpers de RLS e funções de leitura com `REVOKE ... FROM PUBLIC` + `GRANT` explícito a `authenticated` (o revoke anterior de `anon` era inócuo — o grant residual era de PUBLIC).
6. **`mentorship_sessions` ganhou `google_event_id`/`gmeet_url`** (paridade com `class_instances`; a UI da Fase 5 exibirá o link do Meet).
7. **Aviso mínimo dentro da função, não em trigger** (a Lei 3 diz "por trigger"): decisão registrada — a única via de remarcação é a RPC `reschedule_class` (EXECUTE revogado de clientes; escrita direta é privilégio de admin/owner e fica integralmente auditada pelo trigger de audit). Se a Fase 2 abrir outra via de escrita em `class_instances`, um trigger de transição de estado deve nascer junto.
8. **Assinatura de `book_mentorship_session`:** o `student_id` do goal M2 foi absorvido — deriva-se de `contracts.student_id` (mentoria é individual por CHECK; parâmetro externo seria vetor de inconsistência). Não é esquecimento.

**Decisões registradas para as próximas fases (sem migration agora):**

9. **Estorno de crédito de mentoria (cancelamento de sessão) — pendência da Fase 5, a resolver ANTES da primeira reserva real.** Hoje `manual_adjust` existe no enum mas nenhuma função o considera, e dois invariantes intencionais (UNIQUE parcial da etapa; `mentorship_ledger_no_accrual`) restringem o desenho do estorno. A modelagem sugerida (a validar): `refund_of` referenciando a entrada estornada + funções de etapa considerando gastos líquidos. Mudança é aditiva (enum/índice/função) — não exige retrofit de dados se decidida antes de o ledger ter reservas reais.
10. **Fase 2 (webhook Asaas):** `payments` ganhará `contract_id` (FK) e competência (`reference_ym`) na mesma migration do endpoint, preenchidos via `externalReference` do Asaas. `webhook_inbox` nasce lá também (ver ADR-007).
    **Nota corretiva (11/07/2026, painel pré-Fase 2):** o `externalReference` de assinatura é ESTÁTICO no Asaas — serve para o `contract_id`, mas NÃO para a competência. `reference_ym` é derivado do `dueDate` da cobrança (D4 do goal da Fase 2).

**Consequência.** Leis 2 e 8 passam de "parcial" a "cumprida"; suíte 55/55. Pendências de fase futura têm dono e prazo (antes do 1º booking real / junto com o 1º webhook).

---

## Adendo (13/07/2026 — núcleo das Fases 4/5): item 9 RESOLVIDO

A pendência do item 9 (estorno de crédito de mentoria, "resolver ANTES da
primeira reserva real") foi resolvida na migration `20260714000400`, antes de
qualquer reserva real (goal `nucleo-fases-4-5.md`, aprovado com C1–C5):

- **Modelagem confirmada:** `refund_of` com FK composta apontando o gasto +
  funções de etapa em **gastos líquidos** (detalhes no adendo do ADR-008);
  `credit_reason` ganhou o valor `refund` (migration própria — 55P04).
- **RPCs:** `refund_mentorship_booking` (avulso, admin-only, sem régua de tempo
  no v1 — C1; sessão `done` estornável — C4; devolve a vaga: decrementa
  `booked_count` e reverte `full`→`open`) e `cancel_mentorship_session`
  (estorno em massa de TODOS os ativos na MESMA transação, status `cancelled`
  setado por último — C2).
- **REVOKE INSERT em `mentorship_credit_ledger` de anon, authenticated E
  service_role** (paridade completa com `teacher_statements`): com o cinto da
  etapa derrubado, escrita no ledger SÓ via RPCs SECURITY DEFINER do owner, sob
  o protocolo de lock do adendo ADR-009. **Consequência:** futuros
  `manual_adjust` de mentoria exigirão RPC admin própria (Fase 5) ou SQL como
  owner — a policy `admin_all` não basta mais para INSERT (privilégio revogado).

**Compensações do painel do gate N1 (13/07/2026, aplicadas antes de qualquer
deploy):** o painel adversarial do SQL confirmou que o vetor fechado no ledger
(REVOKE + escrita só por RPC) ficava aberto nas duas tabelas que o estorno
tornou money-bearing. Aplicado na própria `20260714000400`: (i) **REVOKE total
de DML em `mentorship_bookings`** — `cancelled_at` é o único gate contra duplo
estorno; reserva nasce e morre SÓ pelas RPCs; (ii) **`mentorship_sessions`:
UPDATE por coluna SEM `booked_count`** (o contador é exclusivo das RPCs; o
admin segue criando/editando sessões — bridge manual até a Fase 5) + **trigger
que proíbe a transição direta para `cancelled` com reservas ativas** (o estado
"cancelada sem estorno" que a C2 proíbe fica impossível; a RPC passa porque
seta o status por último, com zero ativas); (iii) `ai_prompts`: REVOKE de
TRUNCATE herdado por default privilege (tabelas novas nascem com TRUNCATE para
os papéis do PostgREST — todo mecanismo "sem grant de escrita" deve incluir
esse revoke); (iv) `apply_module_progress`: audit/retorno derivados do valor
EFETIVO (RETURNING) no upsert do primeiro sync — o perdedor da corrida não
audita mais "applied" de um pct que não aplicou (Lei 8).
