-- Fase 2 / M5 — grants de LEITURA do service_role para os fluxos server-side novos
-- (padrão ADR-012: cirúrgico por fluxo; o 42501 apontou exatamente o que faltava).
--
-- Webhook Asaas (M5): valida o externalReference contra contracts.
-- E-mails de remarcação (M4/D14): lê os fatos da remarcação para compor os textos.

grant select on contracts to service_role;             -- webhook (ref) + notify
grant select on class_instances to service_role;       -- notify: instância nova/antiga
grant select on teachers to service_role;              -- notify: nome/login da professora
grant select on student_groups, student_group_members to service_role; -- casal (D3)
grant select on reschedule_usage to service_role;      -- notify: "restam N" da franquia
grant select on makeup_ledger to service_role;         -- notify: saldo via makeup_balance
