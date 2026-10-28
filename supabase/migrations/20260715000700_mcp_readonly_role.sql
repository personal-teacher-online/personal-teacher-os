-- Construção total (14/07/2026) — role de leitura do MCP server (handoff-fase4 §5).
-- Pinos invioláveis do CLAUDE.md: usuário Postgres DEDICADO de permissão limitada;
-- PROIBIDO SQL arbitrário (isso é do servidor MCP) e PROIBIDO service_role.
--
-- Desenho: `ptos_mcp_ro` é NOLOGIN (grupo de permissões, versionado aqui).
-- O usuário LOGIN é criado NA MÃO (runbook §N) como membro — senha nunca no repo.
--
-- ⚠️ BYPASSRLS NÃO É HERDADO por membership (painel da construção total,
-- achados 6/18/24/34): o atributo vale para o current_user. Por isso o MCP
-- server executa `set role ptos_mcp_ro` ao abrir cada conexão (aí o atributo
-- DESTE role vale) — e o runbook ainda recomenda criar o login com bypassrls
-- por cinto-e-suspensório. Sem uma das duas coisas, o login leria ZERO linhas
-- em silêncio (RLS ligado + nenhuma policy para este role).
-- Justificativa do bypassrls: as policies do schema decidem por papel de JWT;
-- um role SQL direto não tem JWT. O confinamento é o GRANT (whitelist abaixo,
-- só SELECT/EXECUTE).
-- Roles são CLUSTER-wide: guard idempotente (db reset não recria o cluster).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ptos_mcp_ro') then
    create role ptos_mcp_ro nologin;
  end if;
end
$$;

alter role ptos_mcp_ro bypassrls;

grant usage on schema public to ptos_mcp_ro;

-- Whitelist de LEITURA (tools do MCP): operação diária, nada de segredos.
-- Fora da lista de propósito: profiles (PII de login), webhook_inbox (payloads
-- crus de provedores), ai_prompts (ativo do negócio), audit_log (superfície de
-- admin), payers. payments entra SEM as colunas raw/payer_id (achado 32 — o
-- payload cru do Asaas segue o mesmo critério da webhook_inbox).
grant select on
  students,
  teachers,
  teacher_public,
  contracts,
  recurring_slots,
  class_instances,
  reschedule_windows,
  reschedule_usage,
  makeup_ledger,
  notification_outbox,
  teacher_statements,
  mentorship_contracts,
  mentorship_window_rules,
  mentorship_sessions,
  mentorship_bookings,
  mentorship_credit_ledger,
  course_progress,
  progress_reports,
  contract_signatures
to ptos_mcp_ro;

grant select (id, asaas_payment_id, contract_id, reference_ym, amount_cents, status, due_date, paid_at, billing_type, updated_at)
on payments to ptos_mcp_ro;

-- Funções de consulta puras. business_tz e mentorship_validity_end entram como
-- dependências TRANSITIVAS (achados 8/25): as funções sql não-definer executam
-- com os privilégios do CHAMADOR — sem estes grants, 5 das 6 falhariam.
grant execute on function
  public.business_tz(),
  public.business_today(),
  public.makeup_balance(uuid),
  public.makeup_remaining_expiries(uuid),
  public.mentorship_windows_unlocked(uuid),
  public.mentorship_next_window(uuid),
  public.mentorship_can_book(uuid),
  public.mentorship_validity_end(uuid)
to ptos_mcp_ro;
