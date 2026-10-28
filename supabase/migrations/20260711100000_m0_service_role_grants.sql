-- M0 (Fase 2) — grants mínimos para o servidor Next (service_role via PostgREST)
-- provisionar o acesso do aluno (D6). Descoberta: o CLI atual NÃO concede default
-- privileges amplos a service_role; a Fase 1 só concedeu a anon/authenticated
-- (20260711000700_rls.sql §grants) — service_role estava sem NADA no schema public.
-- Desvio do plano do M0 ("sem migrations") registrado em docs/decisions/012.
--
-- Princípio: grant CIRÚRGICO por fluxo (nada de ALL TABLES — Lei 2/Lei 8 ficam
-- protegidas por privilégio). M1+ concede o que os fluxos novos precisarem.

grant usage on schema public to service_role;

-- provisionStudent: lê o aluno e vincula o profile (SÓ a coluna profile_id).
grant select, update (profile_id) on students to service_role;

-- espelho 1:1 de auth.users criado no convite; update p/ upsert idempotente
-- (bootstrap do admin) e futuras correções server-side de perfil.
grant select, insert, update on profiles to service_role;

-- Lei 8: registro explícito com ator (update/delete/truncate seguem revogados na Fase 1).
grant insert, select on audit_log to service_role;
