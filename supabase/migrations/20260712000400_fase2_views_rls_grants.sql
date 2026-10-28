-- Fase 2 / M1.4 — Superfícies de leitura do portal + RLS/grants das tabelas novas.
-- Toda tabela nova nasceu deny-all; este arquivo abre o MÍNIMO (Lei 4).

-- ---------------------------------------------------------------------------
-- Identidade pública da professora (ADR-010 §1): o portal precisa do NOME, nunca de
-- hourly_rate_cents/payment_terms (custo confidencial). RLS é por linha, não por
-- coluna → view do owner com SÓ as colunas públicas.
-- ---------------------------------------------------------------------------
alter table teachers add column display_name text;
comment on column teachers.display_name is 'Nome de exibição no portal (teacher_public). Distinto de profiles.full_name (que só existirá quando a professora for convidada — Fase 3).';

-- Backfill de PRODUÇÃO (idempotente; hoje existem exatamente 2 professoras).
-- No local o seed preenche — em `db reset` esta UPDATE roda sobre tabela vazia.
update teachers
   set display_name = case when is_owner then 'Teacher Vicky' else 'Renata' end
 where display_name is null;

create view teacher_public as
  select id, display_name from teachers;
comment on view teacher_public is 'View do OWNER (bypassa RLS de teachers de propósito): expõe apenas id+nome a qualquer usuário logado. Custos da professora seguem invisíveis (ADR-010 §1).';
grant select on teacher_public to authenticated;

-- ---------------------------------------------------------------------------
-- Espelho de pagamentos para o ALUNO (M1 item 6b): SÓ status/valor/vencimento/
-- competência do PRÓPRIO contrato. raw e payer_id jamais chegam ao cliente.
-- View do owner filtrando pelo helper (avaliado com o JWT do CHAMADOR).
-- ---------------------------------------------------------------------------
create view payments_student as
  select p.id, p.contract_id, p.amount_cents, p.status, p.due_date, p.reference_ym
    from payments p
   where p.contract_id in (select public.my_contract_ids());
comment on view payments_student is 'Espelho enxuto por contrato do chamador (my_contract_ids usa auth.uid()). raw/payer_id NUNCA nesta view (ADR-010 §1).';
grant select on payments_student to authenticated;

-- ---------------------------------------------------------------------------
-- Policies (padrão Fase 1: admin_all + leitura específica por papel)
-- ---------------------------------------------------------------------------
create policy reschedule_windows_admin_all on reschedule_windows
  for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

-- Aluno vê SÓ janelas publicadas e SÓ das professoras dos contratos dele.
-- (O filtro de ≤ 2 semanas é regra de negócio: vive na RPC e na UI; RLS decide QUEM vê.)
create policy reschedule_windows_student_published on reschedule_windows
  for select to authenticated
  using (
    state = 'publicada'
    and teacher_id in (
      select c.teacher_id from contracts c
      where c.id in (select public.my_contract_ids())
    )
  );

create policy webhook_inbox_admin_all on webhook_inbox
  for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

-- ---------------------------------------------------------------------------
-- Grants de tabela (o PostgREST exige privilégio; as POLICIES decidem as linhas).
-- Escrita de reschedule_windows é EXCLUSIVA das RPCs — nenhum DML de cliente.
-- ---------------------------------------------------------------------------
-- Convenção da Fase 1 (ADR-010 §4): anon recebe SELECT em toda tabela — sem policy,
-- vê zero linhas (o teste dinâmico do caso 12 varre pg_tables e depende disso).
grant select on reschedule_windows to anon, authenticated;
grant select on webhook_inbox to anon, authenticated;

-- Servidor (service_role) escreve o espelho financeiro — webhook do M5 (ADR-012:
-- grants cirúrgicos por fluxo; update da inbox restrito às colunas de processamento).
grant select, insert on webhook_inbox to service_role;
grant update (processed_at, error) on webhook_inbox to service_role;
grant usage, select on sequence webhook_inbox_id_seq to service_role;
grant select, insert, update on payments to service_role;

-- ---------------------------------------------------------------------------
-- Auditoria de linha (Lei 8) nas superfícies novas com efeito de dinheiro/agenda.
-- (webhook_inbox já É um registro imutável de entrada — sem trigger.)
-- ---------------------------------------------------------------------------
create trigger reschedule_windows_audit
  after insert or update or delete on reschedule_windows
  for each row execute function public.audit_row_change();
create trigger payments_audit
  after insert or update or delete on payments
  for each row execute function public.audit_row_change();
