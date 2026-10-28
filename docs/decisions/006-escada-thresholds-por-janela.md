# ADR-006 — Escada de progresso por janela em tabela (`mentorship_window_rules`)

**Contexto.** O doc 04 previa `progress_threshold_pct` único por contrato. A decisão D2 da dona substitui por escada: a reserva nº N exige o threshold da etapa N; os percentuais ainda serão definidos.

**Decisão.** Tabela `mentorship_window_rules (contract_id, window_index ≥ 1, threshold_pct numeric NULL, PK (contract_id, window_index))` — em vez de jsonb, por ser verificável por constraint e consultável por SQL simples. Etapa **sem linha OU com `threshold_pct NULL` = não configurada** → `mentorship_can_book()` (M2) lança exceção explícita ("regras de progresso não configuradas"); nunca libera silenciosamente.

**Consequência.** Os percentuais da dona entram por INSERT/UPDATE, **sem migration** (critério de aceite da sessão). Se a regra real vier como "módulo X concluído", ela se converte no % correspondente. Gasto em ordem: o `window_index` sequencial fica registrado no ledger a cada `booking_spend`.
