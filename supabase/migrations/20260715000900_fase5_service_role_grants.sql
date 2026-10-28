-- Construção total (14/07/2026) — grant que faltava, achado pelos TESTES da
-- fiação Hotmart: o webhook (src/lib/webhooks/hotmart.ts) e o polling
-- (src/lib/jobs/sync-hotmart.ts) resolvem o vínculo aluno→contrato lendo
-- mentorship_contracts com o client service via PostgREST — e NENHUMA migration
-- concedia SELECT dessa tabela a service_role. No local (grants canônicos) todo
-- evento caía em "sem contrato vinculado"; em produção só funcionaria pelos
-- default privileges amplos — exatamente a fragilidade documentada na
-- 20260714000600 (nunca depender deles, nem para FUNCIONAR nem para negar).

grant select on mentorship_contracts to service_role;
