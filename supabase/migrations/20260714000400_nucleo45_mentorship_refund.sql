-- Núcleo 4/5 / N1 — estorno de crédito de mentoria (N45-D3; resolve ADR-011 §9,
-- a pendência "resolver ANTES da primeira reserva real").
-- Goal: docs/goals/nucleo-fases-4-5.md. Confirmações C1/C2/C4 do mantenedor
-- (13/07/2026): sem régua de tempo no v1 (admin caso a caso); cancelar sessão
-- estorna TODOS os ativos; sessão done É estornável (avulso).
--
-- MUDANÇA DE MECANISMO (adendo ADR-008/009/011, obrigatório): o índice
-- mentorship_spend_window_uniq (UNIQUE contract+window WHERE booking_spend) é
-- DERRUBADO — ele impediria RE-reservar uma etapa estornada (o gasto antigo é
-- append-only e FICA). A unicidade passa a ser LÍQUIDA (spend − refund) e
-- serializada pelo advisory lock nomeado 'mentorship_book:'||contract_id, que
-- vira a ÚNICA defesa. Compensações obrigatórias: (1) REVOKE INSERT no ledger
-- (escrita SÓ via RPCs SECURITY DEFINER do owner); (2) assert redundante de
-- gasto líquido 0 DENTRO do lock, no book.
--
-- ORDEM GLOBAL DE LOCKS (vinculante para TODA via que insere/anula
-- booking_spend): SESSÃO (FOR UPDATE) primeiro, DEPOIS advisory do(s)
-- contrato(s) — múltiplos contratos em ordem determinística (ORDER BY
-- contract_id). NÃO inverter (contrato→sessão com coleta prévia tem TOCTOU:
-- reserva nova entre a coleta e o lock da sessão; advisory xact não pode ser
-- liberado para retry).

-- ---------------------------------------------------------------------------
-- 1) Shape do lançamento de estorno no ledger (append-only — Lei 2)
-- ---------------------------------------------------------------------------
alter table mentorship_credit_ledger add column refund_of bigint;
comment on column mentorship_credit_ledger.refund_of is 'Gasto (booking_spend) estornado por esta linha refund. FK COMPOSTA (refund_of, contract_id, session_id) → (id, contract_id, session_id): amarra contrato E sessão por constraint (ADR-008 §9) — FK simples permitiria estorno CRUZADO entre contratos. A linha refund COPIA contract_id/student_id/window_index/session_id do gasto estornado.';

-- FK composta reusa o unique mentorship_ledger_booking_ref_uniq (mentorship.sql).
-- MATCH SIMPLE: a FK é IGNORADA se qualquer coluna for NULL — por isso o CHECK
-- de shape abaixo exige session_id NOT NULL na linha refund (não é cosmético).
alter table mentorship_credit_ledger
  add constraint mentorship_ledger_refund_of_fk
  foreign key (refund_of, contract_id, session_id)
  references mentorship_credit_ledger (id, contract_id, session_id);

-- Um estorno por gasto.
alter table mentorship_credit_ledger
  add constraint mentorship_ledger_refund_of_uniq unique (refund_of);

-- CHECK bidirecional: refund ⇔ refund_of preenchido (a volta impede
-- manual_adjust com refund_of consumindo o slot UNIQUE do estorno legítimo).
alter table mentorship_credit_ledger
  add constraint mentorship_ledger_refund_flag
  check ((reason = 'refund') = (refund_of is not null));

-- Shape do refund: exatamente +1 crédito, com a etapa e a sessão copiadas.
alter table mentorship_credit_ledger
  add constraint mentorship_ledger_refund_shape
  check (reason <> 'refund' or (delta = 1 and window_index is not null and session_id is not null));

-- A FK não checa reason (refund-de-refund passaria e CUNHARIA crédito) nem
-- impede window_index copiado divergente — trigger de alvo cobre os dois.
-- As RPCs validam o mesmo (defesa em profundidade).
create or replace function public.assert_refund_target()
returns trigger
language plpgsql
as $$
declare
  v_target mentorship_credit_ledger%rowtype;
begin
  if new.reason <> 'refund' then
    return new;
  end if;
  select * into v_target from mentorship_credit_ledger where id = new.refund_of;
  if not found then
    raise exception 'refund aponta lançamento inexistente (%)', new.refund_of
      using errcode = '23514';
  end if;
  if v_target.reason <> 'booking_spend' then
    raise exception 'refund deve apontar um booking_spend — lançamento % tem reason %',
      new.refund_of, v_target.reason using errcode = '23514';
  end if;
  if v_target.window_index is distinct from new.window_index then
    raise exception 'window_index do refund (%) difere do gasto estornado (%)',
      new.window_index, v_target.window_index using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger mentorship_ledger_refund_target
  before insert on mentorship_credit_ledger
  for each row execute function public.assert_refund_target();

-- ---------------------------------------------------------------------------
-- 2) Compensação 1: com o índice de unicidade derrubado (item 4), NENHUM papel
--    escreve no ledger por fora do lock. Paridade completa com
--    teacher_statements: até aqui só UPDATE/DELETE/TRUNCATE estavam revogados,
--    e a policy admin_all deixaria um JWT admin dar INSERT de booking_spend via
--    PostgREST por fora do advisory lock. Futuros manual_adjust de mentoria
--    exigirão RPC admin própria (Fase 5) ou SQL como owner (adendo ADR-011).
-- ---------------------------------------------------------------------------
revoke insert on mentorship_credit_ledger from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Reservas: a linha cancelada FICA (Lei 8) — colunas de cancelamento e troca
--    do unique absoluto por unicidade de reserva ATIVA.
-- ---------------------------------------------------------------------------
alter table mentorship_bookings
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references profiles (id);
comment on column mentorship_bookings.cancelled_at is 'Estorno/cancelamento (refund_mentorship_booking ou cancel_mentorship_session): a reserva FICA (Lei 8), o crédito volta via linha refund no ledger apontando ledger_id por refund_of.';

-- O unique absoluto bloquearia PARA SEMPRE o fluxo legítimo "admin estorna por
-- engano → aluno re-reserva a MESMA sessão" (a linha cancelada fica). Nada
-- referencia esta constraint (a FK composta do booking aponta o unique do
-- LEDGER, mentorship_ledger_booking_ref_uniq).
alter table mentorship_bookings
  drop constraint mentorship_bookings_session_id_student_id_key;

create unique index mentorship_bookings_active_uniq
  on mentorship_bookings (session_id, student_id)
  where cancelled_at is null;
comment on index mentorship_bookings_active_uniq is '1 vaga ATIVA por aluno por sessão (N45-D3): linhas canceladas ficam (Lei 8) e não bloqueiam re-reserva; 2ª reserva ATIVA simultânea do mesmo aluno na mesma sessão continua impossível.';

-- ---------------------------------------------------------------------------
-- 4) A constraint de corrida muda de lugar: unicidade de etapa vira LÍQUIDA.
--    Este índice era o "cinto de segurança" citado no comment do próprio book
--    (ADR-008/ADR-009 §2); derrubá-lo torna o protocolo de lock VINCULANTE.
-- ---------------------------------------------------------------------------
drop index mentorship_spend_window_uniq;

-- ---------------------------------------------------------------------------
-- 5) Escada com estorno — semântica LÍQUIDA (N45-D3, substitui count+1):
--    próxima etapa reservável = MENOR window_index N com gasto líquido
--    (spend − refund) = 0, sujeita a N ≤ mentorship_windows_unlocked() e ao
--    threshold da etapa N (threshold NULL/ausente → exceção clara, D2).
--    PROIBIDA a leitura por contagem bruta: com estorno de etapa NÃO-última,
--    count líquido+1 apontaria etapa já gasta e bloquearia PARA SEMPRE o
--    crédito estornado (perda silenciosa de dinheiro, Lei 2). O "gasto em
--    ordem" (ADR-006/D2) é PRESERVADO via preenchimento do buraco.
--    Esta definição vale IDENTICAMENTE em mentorship_next_window,
--    mentorship_can_book e book_mentorship_session (mesma fonte: esta função).
-- ---------------------------------------------------------------------------
create or replace function public.mentorship_next_window(p_contract uuid)
returns int
language sql
stable
as $$
  with spent as (
    -- etapas com gasto LÍQUIDO > 0 (spend − refund por window_index)
    select window_index
    from mentorship_credit_ledger
    where contract_id = p_contract and reason in ('booking_spend', 'refund')
    group by window_index
    having sum(case when reason = 'booking_spend' then 1 else -1 end) > 0
  )
  select min(g)::int
  from generate_series(1, (select count(*) from spent) + 1) g
  where g not in (select window_index from spent);
$$;

-- Recriada com a MESMA lógica de antes (delegando a mentorship_next_window, já
-- líquida) — recreate para atualizar o contrato documentado: fora do advisory
-- lock esta função é UX/antecipação; a decisão REAL é revalidada pelo book
-- DENTRO do lock (can_book e next_window rodam em statements separados sob
-- READ COMMITTED; sem o lock haveria corrida).
create or replace function public.mentorship_can_book(p_contract uuid)
returns boolean
language plpgsql
stable
as $$
declare
  mc mentorship_contracts%rowtype;
  v_next int;
  v_threshold numeric;
  v_rule_found boolean;
  v_pct numeric;
begin
  select * into mc from mentorship_contracts where contract_id = p_contract;
  if not found then
    raise exception 'contrato de mentoria % não existe', p_contract;
  end if;

  -- Contrato pausado/encerrado não reserva (ADR-011).
  if not exists (select 1 from contracts c where c.id = p_contract and c.status = 'active') then
    return false;
  end if;

  -- curso nunca acessado
  if mc.course_start_date is null then
    return false;
  end if;

  -- fora da vigência: créditos remanescentes ficam inertes
  if public.business_today() > public.mentorship_validity_end(p_contract)
     or public.business_today() < mc.course_start_date then
    return false;
  end if;

  -- há crédito destravado para a próxima etapa (MENOR etapa com gasto líquido 0)?
  v_next := public.mentorship_next_window(p_contract);
  if v_next > public.mentorship_windows_unlocked(p_contract) then
    return false;
  end if;

  -- gate de progresso da etapa v_next (D2: NULL/ausente = exceção, nunca
  -- liberação nem false silencioso)
  select r.threshold_pct, true into v_threshold, v_rule_found
  from mentorship_window_rules r
  where r.contract_id = p_contract and r.window_index = v_next;
  if v_rule_found is distinct from true or v_threshold is null then
    raise exception 'regras de progresso não configuradas para a etapa % do contrato %', v_next, p_contract;
  end if;

  select cp.completion_pct into v_pct from course_progress cp where cp.contract_id = p_contract;
  if coalesce(v_pct, 0) < v_threshold then
    return false;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) book_mentorship_session reescrito na ORDEM GLOBAL sessão→contrato
--    (inversão segura AGORA: não há reservas reais em produção). A serialização
--    do gasto por contrato continua no advisory lock nomeado; com o índice de
--    etapa derrubado, ele é a ÚNICA defesa — daí o assert redundante do gasto
--    líquido DENTRO do lock (cinto contra regressão da definição de N).
-- ---------------------------------------------------------------------------
create or replace function public.book_mentorship_session(
  p_session uuid,
  p_contract uuid,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sess mentorship_sessions%rowtype;
  v_student uuid;
  v_window int;
  v_net int;
  v_ledger bigint;
  v_booking uuid;
begin
  -- ORDEM GLOBAL DE LOCKS: sessão (FOR UPDATE) PRIMEIRO...
  select * into v_sess from mentorship_sessions where id = p_session for update;
  if not found then
    raise exception 'sessão % não existe', p_session;
  end if;

  -- ...DEPOIS o advisory do contrato: serializa reservas/estornos do MESMO
  -- contrato (mesmo em sessões diferentes). Única defesa da unicidade líquida.
  perform pg_advisory_xact_lock(hashtextextended('mentorship_book:' || p_contract::text, 0));

  if v_sess.status <> 'open' then
    raise exception 'sessão % não está aberta para reserva (status: %)', p_session, v_sess.status;
  end if;
  if v_sess.booked_count >= v_sess.capacity then
    raise exception 'sessão % lotada (capacidade %)', p_session, v_sess.capacity;
  end if;

  -- Revalida elegibilidade DENTRO da transação, depois dos locks.
  if not public.mentorship_can_book(p_contract) then
    raise exception 'contrato % não elegível para reserva de mentoria', p_contract;
  end if;

  select c.student_id into v_student
  from contracts c
  where c.id = p_contract;

  v_window := public.mentorship_next_window(p_contract);

  -- Assert redundante DENTRO do lock (compensação 2 do drop do índice): a etapa
  -- escolhida DEVE ter gasto líquido 0 — regressão da definição de N estoura
  -- aqui, não cunha gasto duplo.
  select coalesce(sum(case when reason = 'booking_spend' then 1 else -1 end), 0)
    into v_net
  from mentorship_credit_ledger
  where contract_id = p_contract
    and window_index = v_window
    and reason in ('booking_spend', 'refund');
  if v_net <> 0 then
    raise exception 'invariante violada: etapa % do contrato % tem gasto líquido % (esperado 0)',
      v_window, p_contract, v_net;
  end if;

  insert into mentorship_credit_ledger
    (contract_id, student_id, delta, reason, window_index, session_id, created_by)
  values
    (p_contract, v_student, -1, 'booking_spend', v_window, p_session, p_actor)
  returning id into v_ledger;

  update mentorship_sessions
     set booked_count = booked_count + 1,
         status = case when booked_count + 1 >= capacity then 'full' else status end
   where id = p_session;

  insert into mentorship_bookings (session_id, student_id, contract_id, ledger_id)
  values (p_session, v_student, p_contract, v_ledger)
  returning id into v_booking;

  perform public.log_audit(p_actor, 'book_mentorship_session', 'mentorship_bookings', v_booking::text,
    jsonb_build_object(
      'session_id', p_session,
      'contract_id', p_contract,
      'student_id', v_student,
      'window_index', v_window,
      'ledger_id', v_ledger));

  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Núcleo compartilhado do estorno. PRÉ-CONDIÇÃO (não verificável aqui —
--    protocolo vinculante do adendo ADR-009): o chamador JÁ detém o FOR UPDATE
--    da linha da sessão E o advisory lock do contrato da reserva. Interna:
--    EXECUTE revogado de todos; chamada apenas pelas RPCs abaixo.
-- ---------------------------------------------------------------------------
create or replace function public._refund_mentorship_booking_locked(
  p_booking uuid,
  p_actor uuid
) returns bigint
language plpgsql
as $$
declare
  v_b mentorship_bookings%rowtype;
  v_spend mentorship_credit_ledger%rowtype;
  v_refund bigint;
begin
  select * into v_b from mentorship_bookings where id = p_booking for update;
  if not found then
    raise exception 'reserva % não existe', p_booking;
  end if;
  if v_b.cancelled_at is not null then
    raise exception 'reserva % já foi estornada/cancelada em %', p_booking, v_b.cancelled_at;
  end if;

  select * into v_spend from mentorship_credit_ledger where id = v_b.ledger_id;

  -- Linha refund COPIA contrato/aluno/etapa/sessão do gasto e o aponta (N45-D3);
  -- FK composta + trigger de alvo validam por constraint.
  insert into mentorship_credit_ledger
    (contract_id, student_id, delta, reason, window_index, session_id, refund_of, created_by)
  values
    (v_b.contract_id, v_b.student_id, 1, 'refund', v_spend.window_index, v_b.session_id,
     v_b.ledger_id, p_actor)
  returning id into v_refund;

  update mentorship_bookings
     set cancelled_at = now(), cancelled_by = p_actor
   where id = v_b.id;

  -- Vaga volta (pinado): booked_count e a CHECK cap_ok FICAM (Lei 3). O book tem
  -- DOIS gates (status <> 'open' E booked_count >= capacity) e seta 'full' ao
  -- lotar — sem reverter full→open a vaga NÃO volta. Nunca mexer no status se
  -- done/cancelled (done É estornável — C4 — mas continua done).
  update mentorship_sessions
     set booked_count = booked_count - 1,
         status = case when status = 'full' then 'open' else status end
   where id = v_b.session_id;

  perform public.log_audit(p_actor, 'refund_mentorship_booking', 'mentorship_bookings', v_b.id::text,
    jsonb_build_object(
      'session_id', v_b.session_id,
      'contract_id', v_b.contract_id,
      'student_id', v_b.student_id,
      'window_index', v_spend.window_index,
      'spend_ledger_id', v_b.ledger_id,
      'refund_ledger_id', v_refund));

  return v_refund;
end;
$$;

revoke execute on function public._refund_mentorship_booking_locked(uuid, uuid)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8) Estorno avulso (admin-only, D10). SEM régua de tempo no v1 (C1: a admin
--    decide caso a caso; a régua entra na Fase 5, no banco, com o self-service).
-- ---------------------------------------------------------------------------
create or replace function public.refund_mentorship_booking(
  p_booking uuid,
  p_actor uuid default null
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b mentorship_bookings%rowtype;
  v_sess mentorship_sessions%rowtype;
  v_actor uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'refund_mentorship_booking é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- Leitura sem lock só para descobrir a sessão (session_id/contract_id da
  -- reserva são imutáveis); o estado é revalidado sob os locks.
  select * into v_b from mentorship_bookings where id = p_booking;
  if not found then
    raise exception 'reserva % não existe', p_booking;
  end if;

  -- ORDEM GLOBAL: sessão FOR UPDATE → advisory do contrato.
  select * into v_sess from mentorship_sessions where id = v_b.session_id for update;
  perform pg_advisory_xact_lock(hashtextextended('mentorship_book:' || v_b.contract_id::text, 0));

  -- Sessão cancelada não aceita estorno avulso (o cancel já estornou todas as
  -- ativas; repetição também cai no refund_of UNIQUE + reserva já cancelada).
  -- Sessão done É estornável (C4): ex. aluno não conseguiu entrar.
  if v_sess.status = 'cancelled' then
    raise exception 'sessão % está cancelada — estornos já foram feitos pelo cancelamento', v_b.session_id;
  end if;

  return public._refund_mentorship_booking_locked(p_booking, v_actor);
end;
$$;

revoke execute on function public.refund_mentorship_booking(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.refund_mentorship_booking(uuid, uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 9) Cancelamento de sessão com estorno em massa (admin-only, D10; C2: TODOS os
--    participantes ativos, na MESMA transação — NUNCA duas: criaria o estado
--    sessão-cancelada-sem-estorno que a C2 proíbe).
-- ---------------------------------------------------------------------------
create or replace function public.cancel_mentorship_session(
  p_session uuid,
  p_actor uuid default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sess mentorship_sessions%rowtype;
  v_actor uuid;
  v_contract uuid;
  v_booking uuid;
  v_count int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'cancel_mentorship_session é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- ORDEM GLOBAL: sessão FOR UPDATE primeiro — CONGELA o conjunto de reservas
  -- ativas (nenhum book/refund commita sem o lock desta linha)...
  select * into v_sess from mentorship_sessions where id = p_session for update;
  if not found then
    raise exception 'sessão % não existe', p_session;
  end if;
  if v_sess.status = 'cancelled' then
    raise exception 'sessão % já cancelada', p_session;
  end if;
  -- Decisão do executor (registrada para o gate): sessão done não aceita
  -- cancelamento em massa — ela ACONTECEU; reescrever o status apagaria esse
  -- fato. O caminho pós-fato é o estorno avulso por reserva (C4).
  if v_sess.status = 'done' then
    raise exception 'sessão % já aconteceu (done) — use refund_mentorship_booking por reserva (C4)', p_session;
  end if;

  -- ...DEPOIS os advisory locks dos contratos das reservas ativas, em ordem
  -- determinística (ORDER BY contract_id — contra cancel×cancel).
  for v_contract in
    select distinct contract_id
    from mentorship_bookings
    where session_id = p_session and cancelled_at is null
    order by contract_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('mentorship_book:' || v_contract::text, 0));
  end loop;

  for v_booking in
    select id
    from mentorship_bookings
    where session_id = p_session and cancelled_at is null
    order by created_at, id
  loop
    perform public._refund_mentorship_booking_locked(v_booking, v_actor);
    v_count := v_count + 1;
  end loop;

  -- Status POR ÚLTIMO, na mesma transação (C2).
  update mentorship_sessions set status = 'cancelled' where id = p_session;

  perform public.log_audit(v_actor, 'cancel_mentorship_session', 'mentorship_sessions', p_session::text,
    jsonb_build_object('previous_status', v_sess.status, 'refunded_bookings', v_count));

  return v_count;
end;
$$;

revoke execute on function public.cancel_mentorship_session(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.cancel_mentorship_session(uuid, uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 10) COMPENSAÇÕES DO PAINEL DO GATE N1 (adicionadas em 13/07/2026, antes de
--     qualquer aplicação fora do local — Lei 7 preservada). O painel atacou o
--     protocolo de lock e encontrou o mesmo vetor que o §2 fecha no ledger,
--     aberto nas DUAS tabelas que esta migration tornou money-bearing:
--
--     (a) mentorship_bookings.cancelled_at virou o ÚNICO gate contra duplo
--         estorno e o seletor do loop do cancel. Com os grants amplos da F1
--         (rls.sql §grants + policy admin_all), um JWT admin via PostgREST
--         poderia: setar cancelled_at direto (crédito some sem linha refund —
--         perda silenciosa, Lei 2); limpar cancelled_at de reserva estornada
--         (o cancel da sessão passa a abortar no UNIQUE(refund_of) — trava a
--         C2); ou DELETE (gasto órfão irrecuperável). Reserva nasce e morre
--         SÓ pelas RPCs do owner.
--     (b) mentorship_sessions.status/booked_count: as RPCs de estorno assumem
--         que status='cancelled' implica "estornos já feitos" — implicação que
--         só vale se a ÚNICA via para 'cancelled' com reservas ativas for a
--         RPC. booked_count é mantido exclusivamente por book/refund/cancel.
--         O admin PRECISA seguir criando/editando sessões (bridge manual até a
--         UI da Fase 5): INSERT fica; UPDATE volta coluna a coluna SEM
--         booked_count; a transição direta para 'cancelled' com reserva ativa
--         é barrada por trigger (a RPC passa: seta o status POR ÚLTIMO, com
--         zero ativas). DELETE de sessão com reserva já era impossível (FK);
--         sessão errada/vazia se encerra via cancel_mentorship_session.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on mentorship_bookings
  from anon, authenticated, service_role;

revoke update, delete, truncate on mentorship_sessions
  from anon, authenticated, service_role;
grant update (scheduled_at, local_time_snapshot, duration_min, capacity,
              status, google_event_id, gmeet_url)
  on mentorship_sessions to authenticated;

create or replace function public.forbid_uncancelled_session_cancel()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled'
     and exists (
       select 1 from mentorship_bookings b
       where b.session_id = old.id and b.cancelled_at is null
     ) then
    raise exception 'sessão % tem reservas ativas — cancele via cancel_mentorship_session (C2: cancelar sem estornar é proibido)', old.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger mentorship_sessions_cancel_guard
  before update of status on mentorship_sessions
  for each row execute function public.forbid_uncancelled_session_cancel();
