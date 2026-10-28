-- Construção total (14/07/2026) — assinatura de contratos via Autentique.
-- DDL do handoff-autentique aplicada, com fatos CONFERIDOS na doc oficial em
-- 14/07/2026 (docs.autentique.com.br): id do documento = string hex longa;
-- não há campo único de status no provedor (derivamos dos eventos de webhook,
-- autenticados por HMAC-SHA256 no header x-autentique-signature).
--
-- PAINEL da construção total (achados 1/9/15/16/20): transições de status SÓ
-- via RPC apply_autentique_event (matriz no BANCO — Lei 3; terminais não
-- regridem; log_audit em cada mudança — Lei 8); revoke ANTES dos grants (em
-- produção default privileges dão escrita ampla a service_role — lição da
-- 20260714000600); trigger audit_row_change como nas demais tabelas críticas.

create table contract_signatures (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts (id),
  provider text not null default 'autentique',
  provider_document_id text not null,
  status text not null default 'sent'
    check (status in ('sent', 'viewed', 'signed', 'refused', 'expired', 'cancelled')),
  sent_at timestamptz not null default now(),
  signed_at timestamptz,
  -- payload CRU do último evento (o histórico integral vive na webhook_inbox e
  -- no audit_log — Lei 6/Lei 8)
  last_event jsonb,
  created_by uuid references profiles (id),
  unique (provider, provider_document_id),
  -- assinado ⇔ carimbo de quando (coerência mínima no dado)
  constraint contract_signatures_signed_shape
    check (status <> 'signed' or signed_at is not null)
);
create index contract_signatures_contract_idx on contract_signatures (contract_id, sent_at desc);

comment on table contract_signatures is
  'Espelho de assinaturas (Autentique v2). Estado é TABELA-FILHA (re-envios/versões '
  'preservam histórico — Lei 8). INSERT = admin envia (UI); TRANSIÇÕES de status = '
  'exclusivamente apply_autentique_event (service_role, webhook) — a matriz vive no banco.';

-- Lei 8: mesma trilha das demais tabelas críticas (padrão F1).
create trigger contract_signatures_audit
  after insert or update or delete on contract_signatures
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- Matriz de transição NO BANCO (handoff-autentique; achado 1 do painel):
-- sent → viewed → signed|refused|cancelled|expired (terminais). Regressão ou
-- troca entre terminais = no-op relatado (o webhook responde 200 idempotente —
-- Lei 6). Documento sem espelho local devolve NULL (rastro fica na inbox).
-- ---------------------------------------------------------------------------
create or replace function public.apply_autentique_event(
  p_provider_document_id text,
  p_new_status text,
  p_event jsonb default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sig contract_signatures%rowtype;
  v_rank_old int;
  v_rank_new int;
begin
  if p_new_status not in ('viewed', 'signed', 'refused', 'expired', 'cancelled') then
    raise exception 'status % não é uma transição válida de webhook', p_new_status;
  end if;

  select * into v_sig
  from contract_signatures
  where provider = 'autentique' and provider_document_id = p_provider_document_id
  for update;
  if not found then
    return null; -- sem espelho local: quem decide o rastro é o chamador (inbox)
  end if;

  v_rank_old := case v_sig.status when 'sent' then 1 when 'viewed' then 2 else 3 end;
  v_rank_new := case p_new_status when 'viewed' then 2 else 3 end;
  -- Monotônico: nunca regride; terminal não vira outro terminal (out-of-order/replay).
  if v_rank_new <= v_rank_old then
    return v_sig.status;
  end if;

  update contract_signatures
     set status = p_new_status,
         signed_at = case when p_new_status = 'signed' then coalesce(signed_at, now()) else signed_at end,
         last_event = coalesce(p_event, last_event)
   where id = v_sig.id;

  perform public.log_audit(null, 'apply_autentique_event', 'contract_signatures',
    v_sig.id::text,
    jsonb_build_object('from', v_sig.status, 'to', p_new_status,
                       'provider_document_id', p_provider_document_id));
  return p_new_status;
end;
$$;

revoke execute on function public.apply_autentique_event(text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.apply_autentique_event(text, text, jsonb)
to service_role;

alter table contract_signatures enable row level security;

create policy contract_signatures_admin_read on contract_signatures
  for select to authenticated
  using ((select public.app_role()) = 'admin');

-- A admin ENVIA (insert) pela UI; ela NÃO reescreve status na mão.
create policy contract_signatures_admin_insert on contract_signatures
  for insert to authenticated
  with check ((select public.app_role()) = 'admin');

-- Lição 20260714000600 (prod default privileges dão escrita ampla): revoke
-- explícito ANTES dos grants cirúrgicos — vale local E produção.
revoke insert, update, delete, truncate on contract_signatures
from anon, authenticated, service_role;

grant select on contract_signatures to anon, authenticated;
grant insert on contract_signatures to authenticated;
grant select on contract_signatures to service_role; -- escrita SÓ pela RPC (definer)
