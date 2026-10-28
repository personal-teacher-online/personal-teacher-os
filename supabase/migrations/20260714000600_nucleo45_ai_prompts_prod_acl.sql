-- Núcleo 4/5 — correção de ACL da ai_prompts descoberta NO DEPLOY (13/07/2026).
--
-- Em produção (Supabase self-hosted, PG 15.8) os default privileges do owner
-- concedem INSERT/UPDATE/DELETE a anon/authenticated/service_role em toda
-- tabela nova — diferente do CLI local (PG 17), onde a ai_prompts nasceu só com
-- SELECT(+TRUNCATE, já revogado na 20260714000300). O smoke pós-migration do
-- runbook §L mostrou relacl `arwdxt` para os três papéis.
--
-- O mecanismo declarado da ai_prompts (N45-D2 / ADR-012/D10) é "NENHUM grant de
-- escrita — escrita só pela RPC publish_ai_prompt". RLS já nega anon/
-- authenticated (nenhuma policy de escrita) e o trigger append-only segura
-- UPDATE/DELETE, mas service_role BYPASSA RLS e ficaria com INSERT direto por
-- fora do versionamento/auditoria da RPC. Este revoke fecha o buraco.
--
-- Lei 7: a 20260714000300 já foi aplicada em produção → correção em migration
-- NOVA (esta). Lição para tabelas futuras: revogar INSERT/UPDATE/DELETE/TRUNCATE
-- explicitamente SEMPRE — não confiar no default do ambiente.

revoke insert, update, delete on ai_prompts from anon, authenticated, service_role;
