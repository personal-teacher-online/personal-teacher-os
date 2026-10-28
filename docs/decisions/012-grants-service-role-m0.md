# ADR-012 — Grants mínimos de service_role no M0 (desvio: migration fora do M1)

**Contexto.** O plano aprovado do M0 previa "sem migrations novas" (migrations seriam o
M1). Na implementação, o probe via PostgREST revelou que `service_role` não tem NENHUM
privilégio no schema public: o Supabase CLI atual não concede default privileges amplos,
e a migration de RLS da Fase 1 concedeu só a `anon`/`authenticated` (o comentário dela já
registrava a mudança do CLI). A suíte da Fase 1 nunca sentiu porque testa via SQL direto
como owner. Sem grants, o provisionamento D6 (servidor Next com service key) é impossível.

**Decisão.** Migration nova `20260711100000_m0_service_role_grants.sql` (Lei 7: arquivo
novo, nada editado) com grants CIRÚRGICOS por fluxo — `students` (select + update SÓ da
coluna `profile_id`), `profiles` (select/insert/update — update p/ upsert idempotente do
bootstrap), `audit_log` (insert/select) — em vez de
`GRANT ALL ON ALL TABLES`. Os revokes da Fase 1 sobre ledgers/audit_log permanecem.

**Consequências.**
- Cada fase concede explicitamente o que seus fluxos server-side precisam (M1: webhooks →
  payments/webhook_inbox etc.). O erro 42501 aponta o esquecimento na hora.
- A migration precisa ir a PRODUÇÃO junto com o deploy do app do M0 (runbook §G).
- Precedente: service_role NUNCA recebe grant amplo — mantém Lei 2/Lei 8 protegidas
  também em nível de privilégio contra bugs do próprio servidor.
