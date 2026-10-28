-- Fase 4 / Construção total (14/07/2026) — relatórios de progresso do aluno.
-- Fronteira do handoff-fase4 §3 fechada: Claude (prompt ativo) gera o RASCUNHO;
-- a dona revisa/edita e APROVA; só aprovado gera Slides e só aprovado pode
-- ser ENVIADO. Via única draft → approved → sent, imposta por trigger TAMBÉM
-- no INSERT (painel: relatório NASCE rascunho — nunca nasce aprovado/enviado).
--
-- PAINEL da construção total: audit_row_change (Lei 8); revoke antes dos grants
-- (default privileges de produção — lição 20260714000600); congelamento
-- pós-aprovação por WHITELIST de colunas (não blacklist). Decisão registrada
-- (achado 27): 'sent' NÃO exige pdf/slides — o envio v1 pode ser manual
-- (WhatsApp da dona); o artefato é opcional por design.

create table progress_reports (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students (id),
  contract_id uuid references contracts (id),
  period_start date not null,
  period_end date not null,
  title text not null default 'Relatório de progresso',
  content_md text not null default '',
  -- Saída estruturada do Claude — shape validado no SERVIDOR antes de gravar.
  highlights jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent')),
  model text,
  slides_file_id text,
  pdf_file_id text,
  created_by uuid references profiles (id),
  approved_by uuid references profiles (id),
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint progress_reports_period_ok check (period_start <= period_end),
  constraint progress_reports_approved_shape
    check (status = 'draft' or (approved_by is not null and approved_at is not null)),
  constraint progress_reports_sent_shape
    check (status <> 'sent' or sent_at is not null)
);
create index progress_reports_student_idx on progress_reports (student_id, period_end desc);

comment on table progress_reports is
  'Relatórios de progresso (Fase 4). Rascunho do Claude → revisão/edição da admin '
  '→ aprovado (conteúdo congela) → Slides → enviado (imutável). Nasce SEMPRE draft; '
  'transições só para frente (trigger progress_reports_guard).';

create or replace function public.progress_reports_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Painel (achados 5/12/14/33): a via única começa no nascimento.
    if new.status <> 'draft' then
      raise exception 'relatório nasce como RASCUNHO — aprovação/envio são transições';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'relatório % não é rascunho — aprovado/enviado não se apaga (Lei 8)', old.id;
    end if;
    return old;
  end if;

  if old.status = 'sent' then
    raise exception 'relatório % já foi ENVIADO — imutável (Lei 8)', old.id;
  end if;
  if old.status = 'draft' and new.status = 'sent' then
    raise exception 'relatório % precisa ser APROVADO antes de enviado', old.id;
  end if;
  if old.status = 'approved' then
    if new.status = 'draft' then
      raise exception 'relatório % aprovado não volta a rascunho — crie outro', old.id;
    end if;
    -- Painel (achado 26): WHITELIST — depois de aprovado, só andam status,
    -- sent_at e os ponteiros de artefato (updated_at é do trigger).
    if to_jsonb(new) - array['status', 'sent_at', 'slides_file_id', 'pdf_file_id', 'updated_at']
       <> to_jsonb(old) - array['status', 'sent_at', 'slides_file_id', 'pdf_file_id', 'updated_at'] then
      raise exception 'relatório % aprovado tem conteúdo congelado — só status/envio/artefatos mudam', old.id;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger progress_reports_guard
  before insert or update or delete on progress_reports
  for each row execute function public.progress_reports_guard();

-- Lei 8: trilha completa (ator/diff) — padrão F1.
create trigger progress_reports_audit
  after insert or update or delete on progress_reports
  for each row execute function public.audit_row_change();

alter table progress_reports enable row level security;

create policy progress_reports_admin_all on progress_reports
  for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

-- Professora LÊ os relatórios dos próprios alunos; aluno recebe o artefato
-- aprovado por fora (v1). Mesmo predicado da policy students_teacher (F1).
create policy progress_reports_teacher_read on progress_reports
  for select to authenticated
  using (
    (select public.app_role()) = 'teacher'
    and student_id in (select public.teacher_student_ids())
  );

-- Lição 20260714000600: revoke explícito antes dos grants cirúrgicos.
revoke insert, update, delete, truncate on progress_reports
from anon, authenticated, service_role;

grant select on progress_reports to anon, authenticated;
grant insert, update, delete on progress_reports to authenticated;
grant select, insert, update on progress_reports to service_role;
