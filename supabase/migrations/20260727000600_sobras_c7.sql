-- SOBRAS DO LOTE c7 (micro-lote c7b, 27/07/2026) — a parte de banco.
--
-- Lei 7: nenhuma migration antiga foi tocada. O corpo abaixo é o corpo VIVO
-- (lido do banco com `pg_get_functiondef`, idêntico ao emitido na
-- 20260719000100) reemitido com o MÍNIMO alterado; a alteração vem comentada
-- no lugar dela.
--
-- Q2 — CICLO TEÓRICO em `admin_end_contract`: a função travava a linha do
--      contrato de ORIGEM, pegava o advisory do gasto e SÓ ENTÃO travava a
--      linha do contrato de DESTINO. Duas transferências espelhadas —
--      encerrar A transferindo para B, e encerrar B transferindo para A —
--      fecham ciclo: a primeira segura A e pede B; a segunda segura B e pede
--      A. O detector de deadlock do Postgres mata uma das duas com 40P01, que
--      chega na dona como erro cru no meio de um encerramento de contrato.
--
--      A ordem canônica da casa (a mesma que o P2 do c7 impôs em
--      `book_computed_slot`) é: linha primeiro, advisory depois. Aqui há DUAS
--      linhas, então a regra ganha um segundo andar — as duas linhas são
--      travadas juntas, em ordem determinística por uuid, antes de qualquer
--      advisory. Ordem total sobre um conjunto de recursos é o que impede
--      ciclo: A×B e B×A passam a pedir os mesmos locks na mesma sequência, e
--      a segunda transação apenas ESPERA (e depois falha limpo com "contrato
--      destino inválido", porque o destino dela acabou de virar `ended`).
--
--      O advisory continua sendo só o de p_contract: ele guarda o
--      check-then-act do saldo do contrato que está sendo ENCERRADO (lê os
--      créditos vivos e age sobre eles). No destino a função só INSERE crédito
--      — append-only, saldo derivado (Lei 2) —, e inserção não precisa excluir
--      gasto concorrente. Um advisory a mais ali seria lock sem invariante.
--
-- Leis tocadas: 2 (ledger append-only — nada aqui muda o que se escreve), 3
-- (a regra continua no Postgres), 7 (migration NOVA), 8 (a auditoria do
-- encerramento segue idêntica).

-- ===========================================================================
-- Q2 · `admin_end_contract`: todas as linhas de contrato antes do advisory
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.admin_end_contract(p_contract uuid, p_dest_contract uuid DEFAULT NULL::uuid, p_writeoff_note text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_old contracts%rowtype;
  v_dest contracts%rowtype;
  v_actor uuid;
  v_pending int;
  v_cancelled uuid[] := array[]::uuid[];
  v_slots int := 0;
  v_live record;
  v_transferred int := 0;
  v_writeoff int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_end_contract é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- ALTERADO (c7b · Q2): TODAS as linhas de contrato deste encerramento são
  -- travadas aqui, de uma vez e em ordem determinística por uuid, ANTES de
  -- qualquer advisory. O `order by id` é o que mata o ciclo A×B: o LockRows
  -- fica acima do Sort no plano, então as linhas são travadas na ordem do
  -- ORDER BY, e duas chamadas espelhadas pedem os locks na MESMA sequência.
  -- `in (p_contract, p_dest_contract)` é null-safe: com destino nulo, só a
  -- linha de origem entra (NULL nunca casa com id).
  -- As leituras abaixo já não pedem `for update` — a linha está travada por
  -- esta transação, e um segundo FOR UPDATE só repetiria o mesmo lock. Manter
  -- o `for update` no destino é justamente o que punha um lock de linha DEPOIS
  -- do advisory.
  perform 1 from contracts
   where id in (p_contract, p_dest_contract)
   order by id
     for update;

  select * into v_old from contracts where id = p_contract;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_old.contract_type <> 'private_1on1' then
    raise exception 'encerramento estendido é de contratos particulares';
  end if;
  if v_old.status = 'ended' then
    raise exception 'contrato % já está encerrado', p_contract;
  end if;

  -- GATE DURO (M5-3): pendências exigem desfecho antes (o lote M1-3 é o atalho).
  v_pending := public._contract_pending_count(p_contract);
  if v_pending > 0 then
    raise exception 'há % aula(s) passada(s) sem desfecho neste contrato — registre antes (o botão "todas aconteceram" resolve as positivas)', v_pending;
  end if;

  -- destinação obrigatória quando há saldo vivo (escolha EXPLÍCITA)
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || p_contract::text, 0));
  if exists (
    select 1 from public._makeup_remaining_credits(p_contract) rc
    where rc.expires_on >= public.business_today()
  ) then
    if p_dest_contract is null and btrim(coalesce(p_writeoff_note, '')) = '' then
      raise exception 'este contrato tem créditos vivos — transfira para outro contrato do aluno OU dê baixa com motivo';
    end if;
  end if;
  if p_dest_contract is not null then
    select * into v_dest from contracts where id = p_dest_contract;
    if not found or v_dest.contract_type <> 'private_1on1' or v_dest.status <> 'active' then
      raise exception 'contrato destino inválido (precisa ser particular ATIVO)';
    end if;
    if p_dest_contract = p_contract then
      raise exception 'destino não pode ser o próprio contrato';
    end if;
    if not public._contracts_same_people(v_old, v_dest) then
      raise exception 'o destino precisa ser do MESMO aluno/grupo (M3-4)';
    end if;
  end if;

  -- futuras saem SEM crédito e SEM aviso (P4: deliberado — conversa humana).
  select coalesce(array_agg(ci.id), array[]::uuid[]) into v_cancelled
  from class_instances ci
  where ci.contract_id = p_contract and ci.state = 'scheduled' and ci.starts_at_utc > now();
  if coalesce(array_length(v_cancelled, 1), 0) > 0 then
    update class_instances set state = 'cancelled' where id = any(v_cancelled);
  end if;

  update recurring_slots
     set active_to = greatest(active_from, public.business_today())
   where contract_id = p_contract
     and (active_to is null or active_to > public.business_today());
  get diagnostics v_slots = row_count;

  -- destinação dos créditos vivos (validade e duração PRESERVADAS — M3-4/P6)
  for v_live in
    select rc.ledger_id, rc.expires_on from public._makeup_remaining_credits(p_contract) rc
    where rc.expires_on >= public.business_today()
    order by rc.ord
  loop
    if p_dest_contract is not null then
      perform public._reissue_credit(v_live.ledger_id, v_live.expires_on, v_actor,
        'encerramento: crédito transferido', p_dest_contract);
      v_transferred := v_transferred + 1;
    else
      insert into makeup_ledger
        (contract_id, student_id, delta, reason, consumes_ledger_id, note, created_by)
      values
        (p_contract, v_old.student_id, -1, 'manual_adjust', v_live.ledger_id,
         'encerramento: baixa — ' || p_writeoff_note, v_actor);
      v_writeoff := v_writeoff + 1;
    end if;
  end loop;

  -- greatest: contrato com started_on futuro nunca viola o CHECK ended>=started
  update contracts
     set status = 'ended', ended_on = greatest(public.business_today(), started_on)
   where id = p_contract;

  perform public.log_audit(v_actor, 'end_contract', 'contracts', p_contract::text,
    jsonb_build_object(
      'razao', 'encerramento',
      'cancelled_instances', to_jsonb(v_cancelled),
      'slots_closed', v_slots,
      'credits_transferred', v_transferred,
      'credits_written_off', v_writeoff,
      'dest_contract', p_dest_contract,
      'writeoff_note', p_writeoff_note));

  return jsonb_build_object('cancelled', coalesce(array_length(v_cancelled, 1), 0),
                            'slots_closed', v_slots,
                            'transferred', v_transferred, 'written_off', v_writeoff);
end;
$function$;

-- CREATE OR REPLACE preserva a ACL, mas a casa repete o par explícito: quem
-- lê a migration vê quem pode executar (lição do P1 da revisão nº 8).
revoke execute on function public.admin_end_contract(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.admin_end_contract(uuid, uuid, text, uuid) to authenticated;
