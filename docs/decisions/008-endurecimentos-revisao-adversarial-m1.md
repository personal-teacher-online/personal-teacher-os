# ADR-008 — Endurecimentos da revisão adversarial do M1

**Contexto.** O gate do M1 exige revisão adversarial por workflow (dois revisores independentes: invariantes/concorrência e timezone/DST). Dos 22 achados, os defeitos reais foram corrigidos nas migrations antes da aprovação. Consolidados aqui.

**Decisões (todas aplicadas no M1):**

1. **Guarda de TRUNCATE + revoke de `service_role`.** Trigger row-level não dispara em TRUNCATE; adicionados triggers `BEFORE TRUNCATE ... FOR EACH STATEMENT` nos dois ledgers e em `audit_log`, e o REVOKE de UPDATE/DELETE/TRUNCATE estendido a `service_role` (mutações críticas passam por funções `SECURITY DEFINER` no M2 — `service_role` não precisa desses privilégios diretos).
2. **`audit_log` imutável** (mesma guarda dos ledgers) e `actor` com `ON DELETE SET NULL` — excluir um profile não apaga nem trava a trilha (Lei 8).
3. **Identidade da ocorrência = `occurrence_date` (data civil local), não `starts_at_utc`.** O UTC é derivado (data local + hora local + zona + tzdata); se qualquer insumo mudar, a chave antiga deixaria duplicar instâncias. Índice de idempotência do M3: `UNIQUE (slot_id, occurrence_date)`. Complementos: horário de slot com instâncias materializadas é **imutável** por trigger (mudar horário = fechar slot com `active_to` + criar outro); instância de remarcação é avulsa (`CHECK (reschedule_of IS NULL OR slot_id IS NULL)`); `UNIQUE` parcial impede slot ativo duplicado no mesmo contrato.
4. **Sobreposição de agenda do professor por constraint de exclusão** (`EXCLUDE USING gist` sobre `tstzrange`, com `btree_gist`), **além** do índice único parcial nomeado pela Lei 3. O índice pega início idêntico (caso de teste 6); a exclusão pega overlap parcial — que DST torna real (zonas deslocam em datas diferentes; ex.: Joana em Lisboa encosta na Sabrina em Cuiabá após 25/10/2026).
5. **Corrida de duplo gasto da mesma etapa fechada por constraint:** `UNIQUE (contract_id, window_index) WHERE reason='booking_spend'` — dois bookings concorrentes do mesmo contrato em sessões diferentes não consomem a mesma etapa da escada (D2). `booking_spend` exige `delta = -1` exato.
6. **`accrual_window` proibido no ledger de mentoria** (`CHECK`): acúmulo é computado (Lei 2/D3); materializá-lo duplicaria o saldo derivado. Valor mantido no enum só por compatibilidade com o doc 04; `expiry` reservado (expiração v1 é derivada da vigência).
7. **`contract_type` imutável quando há extensão de mentoria ou histórico em ledger** (trigger nos dois sentidos; `FOR KEY SHARE` na linha-pai fecha a corrida do INSERT da extensão). Mentoria é individual: `CHECK (contract_type <> 'mentorship' OR student_id IS NOT NULL)`.
8. **`course_progress` com PK = `contract_id`** (uma linha por contrato; `completion_pct` do gate D2 nunca ambíguo) + `CHECK (completed_pages <= total_pages)`.
9. **Booking amarrado ao ledger por FK composta** `(ledger_id, contract_id, session_id)` — impossível reserva do contrato A consumir gasto do contrato B.
10. **Shape do `makeup_ledger` por CHECK:** ganhos (`earn_cancellation`, `initial_backlog`) positivos e com `expires_on` obrigatório; gastos/expirações negativos; `manual_adjust` livre.
11. **Validação de `iana_tz` endurecida:** além de existir em `pg_timezone_names`, exige `/` no nome e rejeita `posix/`, `right/`, `Etc/` e aliases legados (`Brazil/`, `US/`, `Canada/`, `Chile/`, `Mexico/`) — `'EST'` ou `'Etc/GMT-3'` reintroduziriam offset fixo (Lei 1).
12. **Semânticas de dia/fuso fixadas em comment (implementação no M2):** `expires_on` = último dia válido na data civil do **fuso do negócio** (função `business_tz()` no M2; América/Cuiabá); `period_ym` = mês civil da data **local da instância original** remarcada (zona do slot), não do momento do pedido; `course_start_date` = data civil no fuso do **aluno** ao converter o webhook. `mentorship_sessions` ganhou `local_time_snapshot` (Lei 1). DST: em janela ambígua/inexistente, `starts_at_utc` é sempre o computado pelo Postgres; o TS só formata.
13. **Índices/unicidades:** `class_instances (contract_id, starts_at_utc)` (consulta quente do portal); `students.profile_id` e `teachers.profile_id` únicos (relação 1:1 que o RLS do M5 assume); `contracts.ended_on >= started_on`.

**Consequência.** Invariantes de dinheiro/agenda viram constraints em vez de disciplina de código; os casos de teste 1–26 do goal continuam válidos. Custo: um pouco mais de DDL e a extensão `btree_gist`.

---

## Adendo (13/07/2026 — núcleo das Fases 4/5, migration 20260714000400)

O goal `docs/goals/nucleo-fases-4-5.md` (aprovado com C1–C5) introduziu o
**estorno de crédito de mentoria** e alterou dois mecanismos deste ADR:

- **Item 5 (UNIQUE parcial da etapa) foi DERRUBADO.** `mentorship_spend_window_uniq`
  impediria re-reservar uma etapa estornada (o gasto antigo é append-only e fica).
  A unicidade da etapa passou a ser **LÍQUIDA** (spend − refund por `window_index`)
  e **serializada exclusivamente pelo advisory lock nomeado**
  `'mentorship_book:'||contract_id` — ver adendo do ADR-009 (protocolo de lock
  vinculante) e do ADR-011 (compensações). O "gasto em ordem" (ADR-006/D2) é
  PRESERVADO via preenchimento do buraco: a próxima etapa reservável é a MENOR
  com gasto líquido 0 — pular o buraco é que violaria a ordem (e bloquearia para
  sempre o crédito estornado — perda silenciosa de dinheiro, Lei 2).
- **Item 9 (consistência por FK composta) foi ESTENDIDO ao estorno:** a linha
  `refund` aponta o gasto via `refund_of` com FK composta
  `(refund_of, contract_id, session_id) → (id, contract_id, session_id)`
  (reusa `mentorship_ledger_booking_ref_uniq`) — estorno CRUZADO entre contratos
  é impossível por constraint, mesmo com o índice do item 5 derrubado. Cintos:
  `UNIQUE (refund_of)` (um estorno por gasto), CHECK bidirecional
  `(reason='refund') = (refund_of IS NOT NULL)` + shape (delta=+1, window e
  session obrigatórios — com MATCH SIMPLE a FK é ignorada se session_id for
  NULL), e trigger BEFORE INSERT validando alvo `booking_spend` e mesmo
  `window_index` (a FK não checa reason: refund-de-refund cunharia crédito).
- **Unicidade de reserva virou parcial:** `unique (session_id, student_id)` de
  `mentorship_bookings` → índice único parcial `mentorship_bookings_active_uniq
  (...) WHERE cancelled_at IS NULL` ("1 vaga ATIVA por aluno por sessão") — a
  linha cancelada FICA (Lei 8) e não pode bloquear o fluxo legítimo
  "admin estorna por engano → aluno re-reserva a mesma sessão".
