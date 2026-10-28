# ADR-005 — `contract_type` + extensão 1:1 `mentorship_contracts`, campos de remarcação condicionais

**Contexto.** O doc 04 introduz `contract_type` e recomenda `mentorship_contracts` como extensão 1:1. Faltava definir onde vivem os campos de particulares (`monthly_reschedule_allowance`, `min_notice_hours`, `makeup_credit_expiry_days`).

**Decisão.**
- `contracts.contract_type` (enum `private_1on1 | mentorship`, default `private_1on1`).
- Campos de remarcação ficam em `contracts`, **NULLABLE**, com `CHECK` exigindo-os (e `teacher_id`) NOT NULL quando `contract_type='private_1on1'`. Não criamos uma segunda tabela de extensão para particulares — duas extensões seria complexidade sem ganho na escala alvo.
- `mentorship_contracts` (PK = FK `contract_id`) carrega: `platform`, `external_user_ref`, `external_subdomain`, `course_start_date`, `term_months=12`, `total_credits=6`, `window_months=2`, `expiry_grace_days=90` (carência configurável — doc 04 §5).
- Trigger garante que a extensão só referencia contratos com `contract_type='mentorship'`.

**Consequência.** Um domínio de contrato único (status, vigência, preço em cents compartilhados), sem colunas de mentoria poluindo particulares e vice-versa. `hourly_rate_cents` vale para ambos (mentoria: R$70/h de referência).

**Nota (M6):** os DEFAULTs do blueprint para `min_notice_hours` (24) e `makeup_credit_expiry_days` (90) foram removidos junto com o NOT NULL: com o CHECK condicional por tipo, os valores devem ser explícitos na criação do contrato particular — um default silencioso mascararia esquecimento no caso mentoria.
