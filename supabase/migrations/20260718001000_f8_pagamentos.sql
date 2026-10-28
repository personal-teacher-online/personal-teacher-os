-- F8 — Pagamentos (plano integrado v2, 18/07/2026; decisões M11-2/M11-3 + P21).
-- Fallback do externalReference para AULA avulsa: quando o dinheiro cai, o
-- webhook (service_role) evolui a avulsa para "paga". Grant CIRÚRGICO de
-- coluna (padrão ADR-012) — nada além de single_paid_at é gravável pelo
-- despachante de webhooks.
grant update (single_paid_at) on class_instances to service_role;
