-- Fase 3 / M0.7 — F3-D10 (decisão do mantenedor no gate M0, 12/07/2026):
-- "se pausa o contrato, o crédito PAUSA junto — não pode vencer durante a pausa".
-- Consequências pinadas:
--   (1) contrato pausado NÃO recebe e-mail 5 (o filtro status='active' do enqueue
--       é a implementação da decisão, não uma omissão);
--   (2) na RETOMADA, a validade de cada crédito que estava vivo no INÍCIO da pausa
--       é estendida pelo número de dias civis pausados (fuso do negócio);
--   (3) o ledger é append-only (Lei 2): a extensão é feita por lançamentos novos
--       com reason 'manual_adjust' (o shape LIVRE do CHECK makeup_ledger_shape;
--       reason novo violaria a constraint da Fase 1 — Lei 7) — MESMO padrão
--       auditável da extensão do backlog (diário 11/07), nunca UPDATE em
--       expires_on. O vínculo pausa→lançamentos vive no audit_log (Lei 8).

-- ---------------------------------------------------------------------------
-- Registro de pausas: uma pausa ABERTA por contrato; retomada fecha a linha.
-- ---------------------------------------------------------------------------
create table contract_pauses (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts (id),
  paused_on date not null default public.business_today(),
  resumed_on date,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  constraint contract_pauses_order check (resumed_on is null or resumed_on >= paused_on)
);
create unique index contract_pauses_open_uniq
  on contract_pauses (contract_id)
  where resumed_on is null;

alter table contract_pauses enable row level security;
create policy contract_pauses_admin on contract_pauses
  for select to authenticated
  using ((select public.app_role()) = 'admin');
-- Padrão da casa: SELECT concedido; RLS decide as linhas (não-admin lê zero).
grant select on contract_pauses to anon, authenticated;

-- ---------------------------------------------------------------------------
-- pause_contract / resume_contract — admin-only (D10/F2), o caminho ABENÇOADO
-- para mexer em contracts.status (nunca UPDATE direto na UI).
-- ---------------------------------------------------------------------------
create or replace function public.pause_contract(
  p_contract uuid,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract contracts%rowtype;
  v_actor uuid;
  v_id uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'pause_contract é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_contract from contracts where id = p_contract for update;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_contract.status <> 'active' then
    raise exception 'contrato % não está ativo (estado: %)', p_contract, v_contract.status;
  end if;

  update contracts set status = 'paused' where id = p_contract;
  insert into contract_pauses (contract_id, created_by) values (p_contract, v_actor)
  returning id into v_id;

  perform public.log_audit(v_actor, 'pause_contract', 'contracts', p_contract::text,
    jsonb_build_object('pause_id', v_id));
  return v_id;
end;
$$;

-- Retomada: reativa E descongela os créditos (F3-D10.2).
-- Mecânica append-only, na ORDEM que preserva o FIFO:
--   1. créditos vivos no início da pausa E ainda vivos hoje → um débito (-1) por
--      crédito, do MAIS CEDO para o MAIS TARDE (cada débito consome exatamente o
--      crédito da vez: o FIFO pega sempre o mais cedo ainda válido), TODOS os
--      débitos ANTES de qualquer crédito novo — intercalar quebraria a ordem
--      (o -1 do segundo consumiria a extensão do primeiro);
--   2. créditos vivos no início da pausa que EXPIRARAM durante ela → sem débito
--      (para o FIFO já estão mortos; nada a consumir);
--   3. um crédito novo (+1) por item dos grupos 1 e 2, com
--      expires_on = original + dias pausados.
--
-- Painel final F3 (editado in-place — 20260713* não aplicadas; Lei 7 ok), duas
-- responsabilidades NOVAS da retomada (é aqui, não no pause, para a idempotência
-- do materialize não engolir a re-criação — instância cancelada na pausa nunca
-- renasceria pelo ON CONFLICT DO NOTHING):
--   4. VERDADE DA AGENDA: aulas 'scheduled' cuja data civil (fuso do negócio)
--      caiu na janela [paused_on, resumed_on) são canceladas SEM crédito (UPDATE
--      direto, padrão close_and_create_slot — NUNCA via cancel_class/matriz D2,
--      que creditaria o aluno por aula que a pausa suspendeu), com vínculo ao
--      pause_id no audit_log (Lei 8). Aulas após resumed_on ficam intactas.
--      (Extrato protegido também pela régua: _teacher_payable_hours exclui
--      'scheduled' em janela de pausa — 20260713000600.)
--   5. RE-MATERIALIZAÇÃO: pausa maior que o horizonte de 8 semanas deixaria o
--      contrato ativo com agenda VAZIA até o cron de domingo. Materializa por
--      slot vivo (materialize_slot, mesmo padrão transacional de create_slot;
--      NUNCA materialize_instances sob demanda — deadlock, 20260712000500).
create or replace function public.resume_contract(
  p_contract uuid,
  p_actor uuid default null,
  p_today date default public.business_today()
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract contracts%rowtype;
  v_pause contract_pauses%rowtype;
  v_actor uuid;
  v_days int;
  v_exp date;
  v_frozen date[] := array[]::date[];
  v_extended int := 0;
  v_cancelled_ids uuid[] := array[]::uuid[];
  v_slot record;
  v_materialized int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'resume_contract é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_contract from contracts where id = p_contract for update;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_contract.status <> 'paused' then
    raise exception 'contrato % não está pausado (estado: %)', p_contract, v_contract.status;
  end if;

  select * into v_pause
  from contract_pauses
  where contract_id = p_contract and resumed_on is null
  for update;
  if not found then
    raise exception 'contrato % pausado sem registro de pausa aberto — corrigir via manual_adjust', p_contract;
  end if;

  v_days := p_today - v_pause.paused_on;
  if v_days < 0 then
    raise exception 'retomada (%) anterior ao início da pausa (%)', p_today, v_pause.paused_on;
  end if;

  -- Créditos vivos NO INÍCIO da pausa (a régua congela ali). 'infinity' fica de
  -- fora: crédito sem validade não precisa de extensão.
  select coalesce(array_agg(e order by e), array[]::date[]) into v_frozen
  from public.makeup_remaining_expiries(p_contract) e
  where e >= v_pause.paused_on and e <> 'infinity'::date;

  if v_days > 0 then
    -- Passo 1: débitos dos que ainda estão vivos hoje, do mais cedo ao mais tarde.
    foreach v_exp in array v_frozen loop
      if v_exp >= p_today then
        insert into makeup_ledger (contract_id, student_id, delta, reason, created_by)
        values (v_contract.id, v_contract.student_id, -1, 'manual_adjust', v_actor);
      end if;
    end loop;
    -- Passo 2/3: reemissão de TODOS os congelados com a validade estendida.
    foreach v_exp in array v_frozen loop
      insert into makeup_ledger (contract_id, student_id, delta, reason, expires_on, created_by)
      values (v_contract.id, v_contract.student_id, 1, 'manual_adjust', v_exp + v_days, v_actor);
      v_extended := v_extended + 1;
    end loop;
  end if;

  -- Item 4 (painel final): cancela SEM crédito as 'scheduled' da janela da pausa.
  -- Data civil no fuso do negócio — a MESMA régua de _teacher_payable_hours, para
  -- agenda e extrato nunca divergirem sobre a mesma aula.
  select coalesce(array_agg(i.id), array[]::uuid[]) into v_cancelled_ids
  from class_instances i
  where i.contract_id = p_contract
    and i.state = 'scheduled'
    and (i.starts_at_utc at time zone public.business_tz())::date >= v_pause.paused_on
    and (i.starts_at_utc at time zone public.business_tz())::date < p_today;
  if coalesce(array_length(v_cancelled_ids, 1), 0) > 0 then
    update class_instances set state = 'cancelled' where id = any(v_cancelled_ids);
  end if;

  update contracts set status = 'active' where id = p_contract;
  update contract_pauses set resumed_on = p_today where id = v_pause.id;

  -- Item 5 (painel final): re-materializa por slot vivo — DEPOIS do flip para
  -- 'active' (materialize_slot re-checa c.status = 'active'; a ordem importa).
  for v_slot in
    select rs.id from recurring_slots rs
    where rs.contract_id = p_contract
      and (rs.active_to is null or rs.active_to >= p_today)
  loop
    v_materialized := v_materialized + public.materialize_slot(v_slot.id, 8);
  end loop;

  perform public.log_audit(v_actor, 'resume_contract', 'contracts', p_contract::text,
    jsonb_build_object('pause_id', v_pause.id, 'dias_pausados', v_days,
                       'creditos_estendidos', v_extended,
                       -- Lei 8: vínculo pausa → aulas canceladas/re-materializadas.
                       'aulas_canceladas_na_pausa', to_jsonb(v_cancelled_ids),
                       'aulas_materializadas', v_materialized));
  return v_extended;
end;
$$;

-- F3-D9/ADR-010 §2: EXECUTE mínimo — só admin autenticada (validação interna) e
-- service_role (fluxos server-side); nunca anon/public.
revoke execute on function
  public.pause_contract(uuid, uuid),
  public.resume_contract(uuid, uuid, date)
from public, anon, authenticated;
grant execute on function
  public.pause_contract(uuid, uuid),
  public.resume_contract(uuid, uuid, date)
to authenticated, service_role;
