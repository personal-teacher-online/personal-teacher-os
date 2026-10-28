-- LOTE c8 — a FAMÍLIA inteira dos achados da revisão nº 9 (a parte de banco).
--
-- Lei 7: nenhuma migration antiga foi tocada. Cada corpo abaixo é o corpo VIVO
-- (lido do banco com `pg_get_functiondef`) reemitido com o MÍNIMO alterado, e a
-- alteração vem comentada no lugar dela.
--
-- ===========================================================================
-- A ORDEM CANÔNICA GLOBAL DE LOCKS (a lei da casa — leia antes de mexer)
-- ===========================================================================
--
-- Deadlock não se conserta caso a caso: conserta-se com uma ORDEM TOTAL sobre
-- os recursos. Toda transação que precisar de mais de um lock DESTA família
-- pede os locks nesta sequência, sempre, mesmo quando parecer desnecessário:
--
--   1. contracts          — FOR UPDATE. Quando for mais de uma linha, TODAS
--                           juntas, `order by id` (uuid) na MESMA consulta.
--   2. class_instances    — FOR UPDATE, `order by id` quando for mais de uma.
--   3. reschedule_windows — FOR UPDATE.
--   4. recurring_slots    — FOR UPDATE, `order by id` quando for mais de uma.
--   5. advisory locks     — `makeup_spend:<contrato>` (em ordem de uuid quando
--                           houver mais de um), `class:<aula>`,
--                           `materialize_slot:<slot>`, `materialize_instances`.
--
-- E, depois de travar: RELER e VALIDAR. O estado sobre o qual a transação
-- decide é o estado DEPOIS dos locks — leitura feita antes serve só para
-- descobrir QUEM travar, nunca para decidir.
--
-- POR QUE ESTA ordem, e não outra: o `contracts` é a porta. Quase toda mutação
-- do motor (remarcar, cancelar, encerrar, renovar, pausar, retomar, gastar
-- crédito, trocar horário) é sobre UM contrato; pôr a linha dele em primeiro
-- lugar faz o resto — instância, janela, slot, advisory — ser disputado por uma
-- transação só de cada vez, e o subgrafo interno deixa de poder fechar ciclo.
-- A única operação que atravessa DOIS contratos (`admin_end_contract` com
-- transferência) trava as duas linhas de uma vez, ordenadas por uuid — ordem
-- total, sem ciclo A×B.
--
-- ISENÇÕES, explícitas:
--   • linha CRIADA pela própria transação (o contrato novo de
--     `admin_renew_contract`, que só existe depois do `insert`) está fora da
--     ordem: ninguém mais a enxerga, então ninguém pode disputá-la;
--   • a família da MENTORIA (`mentorship_sessions` → advisory
--     `mentorship_book:<contrato>`) tem ordem própria, já documentada nas
--     funções dela, e conjunto de recursos DISJUNTO deste — as duas não se
--     cruzam;
--   • lock de linha em tabela satélite de UM contrato (`contract_pauses`,
--     `reschedule_usage`) vem depois da linha do contrato e não entra na
--     ordem: quem a alcança já passou pela porta.
--
-- ===========================================================================
--
-- OS SEIS ACHADOS FECHADOS AQUI
--
-- R1 (graves 1+2) · ORDEM GLOBAL. Dois pares fechavam ciclo de verdade:
--     (a) reserva computada × janela — `book_computed_slot` pegava a linha do
--         contrato e o advisory do gasto e SÓ ENTÃO a janela; `book_reschedule_
--         window` pegava a JANELA primeiro e a linha do contrato depois. Uma
--         segurando C pedindo W, a outra segurando W pedindo C: 40P01 na cara
--         da dona no meio de uma reserva.
--     (b) encerramento × remarcação — `admin_end_contract` segurava a linha do
--         contrato e ia cancelar as instâncias; `reschedule_class_at` segurava
--         a INSTÂNCIA e ia pedir a linha do contrato. Mesmo ciclo, outro par.
--     Reemitidas nesta migration: `_cancel_class_core`, `_mark_no_show`,
--     `reschedule_class_at`, `book_reschedule_window`, `book_computed_slot`,
--     `admin_end_contract`, `admin_renew_contract`, `close_and_create_slot`,
--     `resume_contract`.
--     ASSINATURAS INTOCADAS — `book_reschedule_window` é chamada pelo site
--     VELHO em produção; muda o corpo, nunca o contrato da função.
--
-- R2 (grave 3) · ANONIMIZADO NUNCA GANHA LOGIN. O gatilho
--     `students_lead_sem_login` recusava vincular profile a LEAD; passa a
--     recusar também ARQUIVADO e ANONIMIZADO. É o cinto que fecha o TOCTOU do
--     motor (`provisionStudent` lê o status, e a anonimização pode commitar
--     entre a leitura e o vínculo).
--
-- R3 (grave 4) · PAUSA LONGA CONTINUA DONA DO HORÁRIO. Contrato pausado não
--     tem instância futura materializada (o `materialize_slot` exige contrato
--     ATIVO), então a exclusão GiST da professora não vê nada e uma admissão
--     nova ficava com o horário de quem só está parado. `create_slot` passa a
--     conferir sobreposição também contra os `recurring_slots` VIGENTES de
--     contratos PAUSADOS da mesma professora.
--
-- R4 (médio 5) · RECURSÃO SEM TETO FUNCIONAL. `admin_reserved_credits` parava
--     a cadeia de remarcações no passo 25 — número mágico que, atingido,
--     ESCONDE crédito reservado em silêncio. Vira detecção de ciclo por
--     caminho (cláusula `CYCLE`, Postgres 14+; aqui roda 17.6).
--
-- R5 (médio 6) · `tz_confirmed` SÓ PELO CAMINHO LEGÍTIMO. A confirmação do
--     fuso é EFEITO de gravar cidade/fuso; um `update students set
--     tz_confirmed = true` sozinho fabricava a confirmação sem ninguém ter
--     confirmado nada. O gatilho passa a recusar a transição false→true quando
--     cidade e fuso não mudaram na MESMA escrita.
--
-- Leis tocadas: 1 (fuso — R3 compara ocorrências por instante UTC do dia
-- específico, nunca por hora local solta; R5 defende a confirmação), 2 (ledger
-- — nada aqui muda o que se escreve), 3 (toda regra nova mora no Postgres), 4
-- (REVOKE na função nova), 7 (migration NOVA), 8 (auditoria intocada).


-- ###########################################################################
-- R1 · ORDEM CANÔNICA GLOBAL DE LOCKS
-- ###########################################################################

-- ===========================================================================
-- R1.1 · `_cancel_class_core`: contrato ANTES da instância
-- ===========================================================================
--
-- Era instância → contrato. Passa a ser contrato → instância. A pré-leitura sem
-- lock serve só para descobrir QUAL contrato travar; toda validação continua
-- acontecendo depois dos dois locks, na MESMA ordem de antes (para as mensagens
-- de erro não trocarem de lugar).

CREATE OR REPLACE FUNCTION public._cancel_class_core(p_instance uuid, p_cancelled_by text, p_notified_at timestamp with time zone, p_actor uuid, p_via text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_inst class_instances%rowtype;
  v_contract contracts%rowtype;
  v_contract_id uuid;
  v_credited boolean := false;
  v_expires date;
  v_credit_born boolean;
  v_refund record;
  v_blocked text;
begin
  if p_cancelled_by not in ('student', 'teacher') then
    raise exception 'p_cancelled_by deve ser student ou teacher (recebido: %)', p_cancelled_by;
  end if;
  if p_notified_at > now() then
    raise exception 'notified_at no futuro (%) — o aviso já deve ter acontecido', p_notified_at;
  end if;

  -- ALTERADO (c8 · R1): ordem canônica — 1º a linha do CONTRATO, 2º a da
  -- instância. `contract_id` de uma instância nunca muda, então a pré-leitura
  -- sem lock é só o endereço do lock; o estado que decide é o relido abaixo.
  select ci.contract_id into v_contract_id from class_instances ci where ci.id = p_instance;
  perform 1 from contracts where id = v_contract_id for update;
  select * into v_inst from class_instances where id = p_instance for update;
  if not found then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_inst.state <> 'scheduled' then
    raise exception 'instância % não está agendada (estado: %)', p_instance, v_inst.state;
  end if;
  if now() >= v_inst.starts_at_utc and p_notified_at >= v_inst.starts_at_utc then
    raise exception 'aula % já começou e o aviso não a precedeu — use no_show_student/no_show_teacher', p_instance;
  end if;

  select * into v_contract from contracts where id = v_inst.contract_id;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'cancel_class só se aplica a contratos private_1on1';
  end if;

  update class_instances set state = 'cancelled' where id = p_instance;

  v_credit_born := exists (
    select 1 from makeup_ledger l
    where l.delta < 0 and l.reason = 'spend_reschedule'
      and (l.class_instance_id = p_instance
           or (v_inst.reschedule_of is not null and l.class_instance_id = v_inst.reschedule_of)));

  -- ADR-018 (regra ratificada em 18/07/2026): crédito e estorno automáticos SÓ
  -- quando a ESCOLA falha (cancelled_by = 'teacher'). Cancelamento pelo aluno
  -- nunca credita nem estorna sozinho, em QUALQUER antecedência — o caminho com
  -- aviso é REMARCAR (franquia); caso especial é decisão humana auditada
  -- (admin_makeup_adjust / estorno formal acionado pelo atendimento).
  if p_cancelled_by = 'teacher' then
    if v_credit_born then
      v_refund := public._refund_for_credit_born_class(p_instance, 'school', p_actor);
      v_expires := v_refund.o_expires;
      v_blocked := v_refund.o_blocked;
      v_credited := v_expires is not null;
    else
      v_expires := public._earn_for_lost_class(p_instance, p_actor, 'school');
      v_credited := true;
    end if;
  end if;

  -- P4: cancelamento unitário AVISA (admin e self); cortesia da aula avulsa não
  -- passa por aqui. Encerramento/pausa/troca de horário cancelam por caminho
  -- direto e seguem silenciosos por construção (deliberado).
  perform public._enqueue_class_cancelled(p_instance, v_credited, v_expires);

  perform public.log_audit(p_actor, 'cancel_class', 'class_instances', p_instance::text,
    jsonb_build_object(
      'cancelled_by', p_cancelled_by,
      'notified_at', p_notified_at,
      'starts_at_utc', v_inst.starts_at_utc,
      'min_notice_hours', v_contract.min_notice_hours,
      'credited', v_credited,
      'credit_born', v_credit_born,
      'refund_blocked', v_blocked,
      'expires_on', v_expires,
      'via', p_via));
end;
$function$;


-- ===========================================================================
-- R1.2 · `_mark_no_show`: contrato ANTES da instância
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._mark_no_show(p_instance uuid, p_who text, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_inst class_instances%rowtype;
  v_contract contracts%rowtype;
  v_contract_id uuid;
  v_credited boolean := false;
  v_expires date;
  v_credit_born boolean;
  v_refund record;
  v_blocked text;
begin
  -- ALTERADO (c8 · R1): ordem canônica — contrato, depois instância.
  select ci.contract_id into v_contract_id from class_instances ci where ci.id = p_instance;
  perform 1 from contracts where id = v_contract_id for update;
  select * into v_inst from class_instances where id = p_instance for update;
  if not found then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_inst.state <> 'scheduled' then
    raise exception 'instância % não está agendada (estado: %)', p_instance, v_inst.state;
  end if;
  if now() <= v_inst.starts_at_utc then
    raise exception 'aula % ainda não começou (%) — no-show é retrospectivo', p_instance, v_inst.starts_at_utc;
  end if;

  select * into v_contract from contracts where id = v_inst.contract_id;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'no-show só se aplica a contratos private_1on1';
  end if;

  if p_who = 'student' then
    update class_instances set state = 'no_show_student' where id = p_instance;
  else
    update class_instances set state = 'no_show_teacher' where id = p_instance;
    v_credit_born := exists (
      select 1 from makeup_ledger l
      where l.delta < 0 and l.reason = 'spend_reschedule'
        and (l.class_instance_id = p_instance
             or (v_inst.reschedule_of is not null and l.class_instance_id = v_inst.reschedule_of)));
    if v_credit_born then
      v_refund := public._refund_for_credit_born_class(p_instance, 'school', p_actor);
      v_expires := v_refund.o_expires;
      v_blocked := v_refund.o_blocked;
      v_credited := v_expires is not null;
    else
      v_expires := public._earn_for_lost_class(p_instance, p_actor, 'school');
      v_credited := true;
    end if;
  end if;

  perform public.log_audit(p_actor, 'no_show_' || p_who, 'class_instances', p_instance::text,
    jsonb_build_object('credited', v_credited, 'expires_on', v_expires,
                       'refund_blocked', v_blocked,
                       'starts_at_utc', v_inst.starts_at_utc));
end;
$function$;


-- ===========================================================================
-- R1.3 · `reschedule_class_at`: contrato ANTES da instância
-- ===========================================================================
--
-- Este era o lado do par (b): a remarcação segurava a INSTÂNCIA e pedia a linha
-- do contrato, enquanto o encerramento segurava a linha do contrato e ia
-- cancelar as instâncias. Invertida a entrada, o ciclo some.

CREATE OR REPLACE FUNCTION public.reschedule_class_at(p_instance uuid, p_new_starts_utc timestamp with time zone, p_new_snapshot text, p_actor uuid DEFAULT NULL::uuid, p_courtesy boolean DEFAULT false, p_courtesy_note text DEFAULT NULL::text, p_bypass_lead boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_old class_instances%rowtype;
  v_contract contracts%rowtype;
  v_contract_id uuid;
  v_tz text;
  v_duration interval;
  v_orig_local_date date;
  v_period text;
  v_used int;
  v_via text;
  v_new_id uuid;
  v_lead int;
begin
  -- Cortesia é privilégio (M1-6). O bypass_lead NÃO é checado aqui: esta função
  -- é interna (revogada de clientes) e book_reschedule_window passa true após
  -- checar a antecedência sobre a JANELA — o check de papel do bypass vive nas
  -- superfícies chamáveis.
  if p_courtesy and public.app_role() <> 'admin' then
    raise exception 'cortesia é só da administração (D10)';
  end if;
  if p_courtesy and btrim(coalesce(p_courtesy_note, '')) = '' then
    raise exception 'cortesia exige motivo (M1-6)';
  end if;

  -- ALTERADO (c8 · R1): ordem canônica — contrato, depois instância. Quando
  -- `book_reschedule_window` chama, a linha do contrato JÁ está travada por ela
  -- (mesmo lock, mesma transação: repetir é barato e mantém esta função correta
  -- também quando chamada direto).
  select ci.contract_id into v_contract_id from class_instances ci where ci.id = p_instance;
  perform 1 from contracts where id = v_contract_id for update;
  select * into v_old from class_instances where id = p_instance for update;
  if not found then
    raise exception 'instância % não existe', p_instance;
  end if;
  if v_old.state <> 'scheduled' then
    raise exception 'instância % não está agendada (estado atual: %)', p_instance, v_old.state;
  end if;

  select * into v_contract from contracts where id = v_old.contract_id;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'reschedule_class só se aplica a contratos private_1on1';
  end if;
  if v_contract.status <> 'active' then
    raise exception 'contrato % não está ativo — remarcação bloqueada', v_contract.id;
  end if;

  -- Aviso mínimo sobre a aula ORIGINAL (intocado — o bypass fura SÓ a antecedência).
  if now() > v_old.starts_at_utc - make_interval(hours => v_contract.min_notice_hours) then
    raise exception 'remarcação exige % h de aviso mínimo (aula começa em %)',
      v_contract.min_notice_hours, v_old.starts_at_utc;
  end if;

  if p_new_starts_utc <= now() then
    raise exception 'nova data/hora da remarcação já passou (%)', p_new_starts_utc;
  end if;

  -- M2-1: antecedência mínima no DESTINO, por professora.
  select t.min_booking_lead_hours into v_lead from teachers t where t.id = v_old.teacher_id;
  if not p_bypass_lead
     and p_new_starts_utc < now() + make_interval(hours => coalesce(v_lead, 12)) then
    raise exception 'o novo horário exige % h de antecedência — escolha um horário mais à frente',
      coalesce(v_lead, 12);
  end if;

  v_tz := public.class_instance_tz(p_instance);
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA da remarcação do contrato %', v_contract.id;
  end if;

  v_duration := v_old.ends_at_utc - v_old.starts_at_utc;

  v_orig_local_date := coalesce(v_old.occurrence_date, (v_old.starts_at_utc at time zone v_tz)::date);
  v_period := to_char(v_orig_local_date, 'YYYY-MM');

  if p_courtesy then
    -- M1-6: cortesia NÃO consome franquia nem crédito; o contador mensal é
    -- derivado do audit (via = courtesy), nunca materializado.
    v_via := 'courtesy';
  else
    insert into reschedule_usage (contract_id, period_ym, used_count)
    values (v_contract.id, v_period, 0)
    on conflict (contract_id, period_ym) do nothing;
    update reschedule_usage
       set used_count = used_count + 1
     where contract_id = v_contract.id
       and period_ym = v_period
       and used_count < v_contract.monthly_reschedule_allowance
    returning used_count into v_used;

    if v_used is not null then
      v_via := 'allowance';
    else
      perform public.spend_makeup(v_contract.id, 'spend_reschedule', v_contract.student_id, p_instance, p_actor);
      v_via := 'makeup_credit';
    end if;
  end if;

  update class_instances set state = 'rescheduled' where id = p_instance;

  insert into class_instances
    (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
     local_time_snapshot, state, reschedule_of)
  values
    (v_contract.id, v_old.teacher_id, null, null, p_new_starts_utc, p_new_starts_utc + v_duration,
     p_new_snapshot, 'scheduled', p_instance)
  returning id into v_new_id;

  perform public.log_audit(p_actor, 'reschedule_class', 'class_instances', v_new_id::text,
    jsonb_build_object(
      'rescheduled_from', p_instance,
      'contract_id', v_contract.id,
      'old_starts_at_utc', v_old.starts_at_utc,
      'new_starts_at_utc', p_new_starts_utc,
      'iana_tz', v_tz,
      'via', v_via,
      'courtesy_note', p_courtesy_note,
      'bypass_lead', p_bypass_lead,
      'period_ym', v_period));

  return v_new_id;
end;
$function$;


-- ===========================================================================
-- R1.4 · `book_reschedule_window`: contrato → instância → janela → advisory
-- ===========================================================================
--
-- ASSINATURA INTOCADA (o site VELHO em produção chama esta função). Só o corpo
-- muda: os três locks sobem para o topo, na ordem canônica, e TODAS as
-- validações seguem exatamente na ordem de antes — nenhuma mensagem de erro
-- troca de lugar.

CREATE OR REPLACE FUNCTION public.book_reschedule_window(p_window uuid, p_instance uuid DEFAULT NULL::uuid, p_contract uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid, p_courtesy boolean DEFAULT false, p_courtesy_note text DEFAULT NULL::text, p_bypass_lead boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_win reschedule_windows%rowtype;
  v_contract contracts%rowtype;
  v_contract_id uuid;
  v_inst_teacher uuid;
  v_inst_starts timestamptz;
  v_actor uuid;
  v_credit_dur int;
  v_slot_dur int;
  v_duration_min int;
  v_new_id uuid;
  v_new_starts timestamptz;
  v_lead int;
begin
  if (p_instance is null) = (p_contract is null) then
    raise exception 'informe a aula a remarcar (p_instance) OU o contrato do resgate (p_contract)';
  end if;
  if (p_courtesy or p_bypass_lead) and public.app_role() <> 'admin' then
    raise exception 'cortesia e bypass de antecedência são só da administração (D10)';
  end if;
  if p_courtesy and p_instance is null then
    raise exception 'cortesia é da REMARCAÇÃO — resgate consome crédito por definição';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- ALTERADO (c8 · R1): os TRÊS locks, na ordem canônica, ANTES de qualquer
  -- validação. Antes a JANELA era travada primeiro e a linha do contrato só
  -- depois — o outro lado do ciclo com `book_computed_slot`.
  -- A pré-leitura sem lock só descobre o endereço do contrato (a instância
  -- nunca troca de contrato); o estado que decide é o relido depois dos locks.
  if p_instance is not null then
    select ci.contract_id into v_contract_id from class_instances ci where ci.id = p_instance;
  else
    v_contract_id := p_contract;
  end if;
  perform 1 from contracts where id = v_contract_id for update;
  if p_instance is not null then
    perform 1 from class_instances where id = p_instance for update;
  end if;
  select * into v_win from reschedule_windows where id = p_window for update;

  if v_win.id is null then
    raise exception 'janela % não existe', p_window;
  end if;
  if v_win.state <> 'publicada' then
    raise exception 'janela % não está disponível (estado: %)', p_window, v_win.state;
  end if;
  if v_win.starts_at_utc <= now() then
    raise exception 'janela % já passou', p_window;
  end if;
  if v_win.starts_at_utc > now() + interval '14 days' then
    raise exception 'janela % está a mais de 2 semanas (%)', p_window, v_win.starts_at_utc;
  end if;

  -- M2-1: antecedência mínima da PROFESSORA no destino (remarcação E resgate).
  select t.min_booking_lead_hours into v_lead from teachers t where t.id = v_win.teacher_id;
  if not p_bypass_lead
     and v_win.starts_at_utc < now() + make_interval(hours => coalesce(v_lead, 12)) then
    raise exception 'esse horário exige % h de antecedência — escolha um mais à frente',
      coalesce(v_lead, 12);
  end if;

  if p_instance is not null then
    select ci.contract_id, ci.teacher_id, ci.starts_at_utc
      into v_contract_id, v_inst_teacher, v_inst_starts
      from class_instances ci where ci.id = p_instance;
    if v_contract_id is null then
      raise exception 'instância % não existe', p_instance;
    end if;
  else
    v_contract_id := p_contract;
  end if;

  if public.app_role() <> 'admin'
     and v_contract_id not in (select public.my_contract_ids()) then
    raise exception 'você não tem acesso a este contrato (D10)';
  end if;

  select * into v_contract from contracts where id = v_contract_id;
  if v_contract.id is null then
    raise exception 'contrato % não existe', v_contract_id;
  end if;
  if p_instance is not null then
    if v_inst_teacher <> v_win.teacher_id then
      raise exception 'janela % pertence a outra professora (D1)', p_window;
    end if;
    if v_inst_teacher <> v_contract.teacher_id then
      raise exception 'instância % (professora %) diverge do contrato % (professora %) — corrigir antes de remarcar',
        p_instance, v_inst_teacher, v_contract.id, v_contract.teacher_id;
    end if;
  elsif v_contract.teacher_id <> v_win.teacher_id then
    raise exception 'janela % pertence a outra professora (D1)', p_window;
  end if;

  if p_instance is not null then
    v_new_id := public.reschedule_class_at(
      p_instance, v_win.starts_at_utc, v_win.local_time_snapshot, v_actor,
      p_courtesy, p_courtesy_note, true);  -- lead já checado sobre a janela
  else
    -- ALTERADO (c8 · R1): a linha já está travada lá em cima; aqui é só a
    -- releitura do estado sobre o qual esta transação decide.
    select * into v_contract from contracts where id = v_contract_id;
    if v_contract.contract_type <> 'private_1on1' then
      raise exception 'resgate de crédito só se aplica a contratos private_1on1';
    end if;
    if v_contract.status <> 'active' then
      raise exception 'contrato % não está ativo — resgate bloqueado', v_contract.id;
    end if;

    perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || v_contract.id::text, 0));
    select rc.duration_min into v_credit_dur
    from public._makeup_remaining_credits(v_contract.id) rc
    where rc.expires_on >= public.business_today()
    order by rc.expires_on, rc.ord
    limit 1;

    select rs.duration_min into v_slot_dur
      from recurring_slots rs
     where rs.contract_id = v_contract.id
       and rs.active_from <= current_date
       and (rs.active_to is null or rs.active_to >= current_date)
     order by rs.active_from desc
     limit 1;

    v_duration_min := coalesce(v_credit_dur, v_slot_dur);
    if v_duration_min is null then
      raise exception 'contrato % não tem duração para o resgate (crédito sem duração e sem slot ativo)', v_contract.id;
    end if;

    insert into class_instances
      (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
       local_time_snapshot, state, reschedule_of)
    values
      (v_contract.id, v_win.teacher_id, null, null, v_win.starts_at_utc,
       v_win.starts_at_utc + make_interval(mins => v_duration_min),
       v_win.local_time_snapshot, 'scheduled', null)
    returning id into v_new_id;

    perform public.spend_makeup(v_contract.id, 'spend_reschedule', v_contract.student_id, v_new_id, v_actor);
  end if;

  select starts_at_utc into v_new_starts from class_instances where id = v_new_id;
  if v_new_starts <> v_win.starts_at_utc then
    raise exception 'invariante violado: instância criada em % ≠ janela publicada em %',
      v_new_starts, v_win.starts_at_utc;
  end if;

  update reschedule_windows
     set state = 'consumida', consumed_by_instance_id = v_new_id
   where id = p_window;

  perform public.log_audit(v_actor, 'book_reschedule_window', 'reschedule_windows', p_window::text,
    jsonb_build_object(
      'mode', case when p_instance is not null then 'reschedule' else 'redeem' end,
      'instance', p_instance, 'contract', v_contract_id,
      'new_instance', v_new_id, 'starts_at_utc', v_win.starts_at_utc,
      'duration_min', v_duration_min,
      'courtesy', p_courtesy, 'bypass_lead', p_bypass_lead));

  return v_new_id;
end;
$function$;


-- ===========================================================================
-- R1.5 · `book_computed_slot`: contrato → instância → janela → advisory
-- ===========================================================================
--
-- Era contrato → advisory → janela: o advisory do gasto ficava ANTES do lock da
-- janela, e a `book_reschedule_window` pedia a janela antes do contrato. Agora
-- as duas pedem exatamente a mesma sequência.
--
-- MUDA DE LUGAR, deliberadamente: a conferência de disponibilidade da professora
-- passa a acontecer DEPOIS de a janela ser resolvida. Ela precisa da duração, e
-- a duração do resgate é lida sob o advisory — que, pela ordem canônica, vem
-- depois da janela. Efeito prático nenhum: a janela materializada aqui morre com
-- o `raise` (a transação inteira reverte), e o índice único parcial de janela
-- PUBLICADA continua sendo respeitado pelo reaproveitamento logo acima.

CREATE OR REPLACE FUNCTION public.book_computed_slot(p_teacher uuid, p_starts_at_utc timestamp with time zone, p_instance uuid DEFAULT NULL::uuid, p_contract uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid, p_courtesy boolean DEFAULT false, p_courtesy_note text DEFAULT NULL::text, p_bypass_lead boolean DEFAULT false, p_google_degraded boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid;
  v_tz text;
  v_dur int;
  v_slot_dur int;
  v_contract_id uuid;
  v_win uuid;
  v_local timestamp;
  v_new uuid;
begin
  if (p_instance is null) = (p_contract is null) then
    raise exception 'informe a aula a remarcar (p_instance) OU o contrato do resgate (p_contract)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  select coalesce(t.iana_tz, public.business_tz()) into v_tz from teachers t where t.id = p_teacher;
  if v_tz is null then
    raise exception 'professora % não existe', p_teacher;
  end if;

  -- ALTERADO (c8 · R1): 1º andar (contrato) e 2º andar (instância), sempre —
  -- inclusive no caminho da REMARCAÇÃO, que antes não travava contrato nenhum
  -- aqui e ia direto para a janela.
  if p_instance is not null then
    select ci.contract_id into v_contract_id from class_instances ci where ci.id = p_instance;
    if v_contract_id is null then
      raise exception 'instância % não existe', p_instance;
    end if;
  else
    v_contract_id := p_contract;
  end if;
  perform 1 from contracts where id = v_contract_id for update;
  if not found then
    raise exception 'contrato % não existe', v_contract_id;
  end if;
  if p_instance is not null then
    perform 1 from class_instances where id = p_instance for update;
  end if;

  -- 3º andar: reaproveita janela publicada no MESMO instante (união sem
  -- duplicata); senão materializa uma janela nova, e consome na mesma transação
  select w.id into v_win from reschedule_windows w
  where w.teacher_id = p_teacher and w.starts_at_utc = p_starts_at_utc and w.state = 'publicada'
  for update;
  if v_win is null then
    v_local := p_starts_at_utc at time zone v_tz;
    insert into reschedule_windows
      (teacher_id, local_date, local_time, iana_tz, starts_at_utc, local_time_snapshot, created_by)
    values
      (p_teacher, v_local::date, v_local::time, v_tz, p_starts_at_utc,
       to_char(v_local, 'YYYY-MM-DD HH24:MI') || ' ' || v_tz, v_actor)
    returning id into v_win;
  end if;

  -- 4º andar: o advisory do gasto (só o resgate precisa dele).
  -- duração REAL (F1/M1-5): remarcação herda da aula; resgate usa o crédito da vez
  if p_instance is not null then
    select round(extract(epoch from (ci.ends_at_utc - ci.starts_at_utc)) / 60)::int
      into v_dur
    from class_instances ci where ci.id = p_instance;
  else
    perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || p_contract::text, 0));
    select rc.duration_min into v_dur
    from public._makeup_remaining_credits(p_contract) rc
    where rc.expires_on >= public.business_today()
    order by rc.expires_on, rc.ord limit 1;
    select rs.duration_min into v_slot_dur
      from recurring_slots rs
     where rs.contract_id = p_contract
       and rs.active_from <= current_date
       and (rs.active_to is null or rs.active_to >= current_date)
     order by rs.active_from desc limit 1;
    v_dur := coalesce(v_dur, v_slot_dur, 45);
  end if;

  -- a camada do banco decide a disponibilidade (Google é antecipação do app)
  if not public._teacher_available_for(p_teacher, p_starts_at_utc,
        p_starts_at_utc + make_interval(mins => v_dur)) then
    raise exception 'a professora não está disponível nesse horário — escolha outro';
  end if;

  v_new := public.book_reschedule_window(
    v_win, p_instance, p_contract, v_actor, p_courtesy, p_courtesy_note, p_bypass_lead);

  perform public.log_audit(v_actor, 'book_computed_slot', 'reschedule_windows', v_win::text,
    jsonb_build_object(
      'teacher_id', p_teacher, 'starts_at_utc', p_starts_at_utc,
      'duration_min', v_dur, 'contract', v_contract_id,
      'new_instance', v_new,
      -- marcador da reserva degradada (fail-open do Google — decisão M1-4)
      'google_degraded', p_google_degraded));
  return v_new;
end;
$function$;


-- ===========================================================================
-- R1.6 · `admin_end_contract`: instâncias e horários fixos antes do advisory
-- ===========================================================================
--
-- O c7b já pusera as DUAS linhas de contrato antes do advisory. O que faltava
-- eram os andares 2 e 4: a função cancelava instâncias e fechava horários fixos
-- DEPOIS do advisory — segurando o advisory e pedindo linha de instância,
-- enquanto a remarcação segurava a instância e pedia o advisory pelo mesmo
-- caminho. Agora tudo o que ela vai escrever está travado antes.

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

  -- (c7b · Q2): TODAS as linhas de contrato deste encerramento são travadas
  -- aqui, de uma vez e em ordem determinística por uuid, ANTES de qualquer
  -- advisory. O `order by id` é o que mata o ciclo A×B: o LockRows fica acima do
  -- Sort no plano, então as linhas são travadas na ordem do ORDER BY, e duas
  -- chamadas espelhadas pedem os locks na MESMA sequência.
  -- `in (p_contract, p_dest_contract)` é null-safe: com destino nulo, só a
  -- linha de origem entra (NULL nunca casa com id).
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

  -- ALTERADO (c8 · R1): andares 2 e 4 da ordem canônica, ordenados por uuid, e
  -- ainda ANTES do advisory. É o conjunto exato que esta função vai escrever
  -- adiante; travá-lo aqui tira o lock de linha de depois do advisory.
  perform 1 from class_instances
   where contract_id = p_contract and state = 'scheduled' and starts_at_utc > now()
   order by id
     for update;
  perform 1 from recurring_slots
   where contract_id = p_contract
     and (active_to is null or active_to > public.business_today())
   order by id
     for update;

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


-- ===========================================================================
-- R1.7 · `admin_renew_contract`: instâncias e horários fixos antes do advisory
-- ===========================================================================
--
-- Mesmo defeito de forma do encerramento: o advisory subia primeiro e as linhas
-- de instância/slot vinham depois. O contrato NOVO (criado no meio) fica fora da
-- ordem por construção — ninguém mais o enxerga antes do commit.

CREATE OR REPLACE FUNCTION public.admin_renew_contract(p_old uuid, p_switch_on date, p_plan_name text, p_hourly_rate_cents integer, p_allowance integer, p_min_notice integer, p_expiry_days integer, p_school_fault_days integer, p_actor uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_old contracts%rowtype;
  v_actor uuid;
  v_pending int;
  v_new uuid;
  v_slot record;
  v_slots_copied int := 0;
  v_cancelled uuid[] := array[]::uuid[];
  v_live record;
  v_transferred int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_renew_contract é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_old from contracts where id = p_old for update;
  if not found then
    raise exception 'contrato % não existe', p_old;
  end if;
  if v_old.contract_type <> 'private_1on1' or v_old.status <> 'active' then
    raise exception 'renovação exige contrato particular ATIVO (pausado: retome antes)';
  end if;
  if p_switch_on < public.business_today() then
    raise exception 'a virada (%) não pode ficar no passado', p_switch_on;
  end if;
  -- P13: o limite documentado vira comportamento PROVADO.
  if p_switch_on > public.business_today() + 56 then
    raise exception 'a virada precisa estar a no máximo 8 semanas (recebido %)', p_switch_on;
  end if;
  if p_hourly_rate_cents is null or p_hourly_rate_cents <= 0 then
    raise exception 'valor da aula inválido';
  end if;

  v_pending := public._contract_pending_count(p_old);
  if v_pending > 0 then
    raise exception 'há % aula(s) passada(s) sem desfecho — registre antes de renovar', v_pending;
  end if;

  -- ALTERADO (c8 · R1): andares 2 e 4, ordenados por uuid, antes do advisory —
  -- é o conjunto que os passos (a) e (c) vão escrever.
  perform 1 from class_instances
   where contract_id = p_old and state = 'scheduled'
     and (starts_at_utc at time zone public.business_tz())::date >= p_switch_on
   order by id
     for update;
  perform 1 from recurring_slots
   where contract_id = p_old and (active_to is null or active_to >= p_switch_on)
   order by id
     for update;

  -- (a) cancelar futuras do velho a partir da virada (data civil do negócio,
  -- mesma régua da pausa) — SEM crédito, SEM aviso (P4 deliberado)
  select coalesce(array_agg(ci.id), array[]::uuid[]) into v_cancelled
  from class_instances ci
  where ci.contract_id = p_old and ci.state = 'scheduled'
    and (ci.starts_at_utc at time zone public.business_tz())::date >= p_switch_on;
  if coalesce(array_length(v_cancelled, 1), 0) > 0 then
    update class_instances set state = 'cancelled' where id = any(v_cancelled);
  end if;

  -- (b) criar o novo (antes de fechar os slots, para copiá-los da foto viva)
  insert into contracts
    (contract_type, student_id, student_group_id, teacher_id, plan_name,
     hourly_rate_cents, monthly_reschedule_allowance, min_notice_hours,
     makeup_credit_expiry_days, school_fault_credit_expiry_days,
     started_on, status, renewed_from, group_tz_anchor_student)
  values
    ('private_1on1', v_old.student_id, v_old.student_group_id, v_old.teacher_id,
     p_plan_name, p_hourly_rate_cents, p_allowance, p_min_notice,
     p_expiry_days, p_school_fault_days, p_switch_on, 'active', p_old,
     v_old.group_tz_anchor_student)
  returning id into v_new;

  -- (c) fechar horários do velho na véspera e recriá-los no novo desde a virada
  -- (fuso EXPLÍCITO copiado de cada slot — emenda sem buraco nem duplicata)
  for v_slot in
    select rs.* from recurring_slots rs
    where rs.contract_id = p_old
      and (rs.active_to is null or rs.active_to >= p_switch_on)
  loop
    update recurring_slots set active_to = p_switch_on - 1 where id = v_slot.id;
    perform public.create_slot(
      v_new, v_slot.weekday, v_slot.local_time, v_slot.iana_tz,
      v_slot.duration_min, p_switch_on, v_actor);
    v_slots_copied := v_slots_copied + 1;
  end loop;

  -- (d) encerrar o velho na véspera da virada (greatest: virada no dia do
  -- próprio started_on não viola o CHECK ended>=started)
  update contracts
     set status = 'ended', ended_on = greatest(p_switch_on - 1, v_old.started_on)
   where id = p_old;

  -- ALTERADO (c8 · R1): o advisory do gasto desceu para cá, o último andar da
  -- ordem — ele guarda só o check-then-act dos créditos vivos logo abaixo.
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || p_old::text, 0));

  -- (e) créditos vivos migram preservando validade + duração (M3-4/P6)
  for v_live in
    select rc.ledger_id, rc.expires_on from public._makeup_remaining_credits(p_old) rc
    where rc.expires_on >= public.business_today()
    order by rc.ord
  loop
    perform public._reissue_credit(v_live.ledger_id, v_live.expires_on, v_actor,
      'renovação: crédito transferido', v_new);
    v_transferred := v_transferred + 1;
  end loop;

  perform public.log_audit(v_actor, 'renew_contract', 'contracts', v_new::text,
    jsonb_build_object(
      'renewed_from', p_old, 'switch_on', p_switch_on,
      'cancelled_instances', to_jsonb(v_cancelled),
      'slots_copied', v_slots_copied,
      'credits_transferred', v_transferred,
      'hourly_rate_cents', p_hourly_rate_cents));

  return v_new;
end;
$function$;


-- ===========================================================================
-- R1.8 · `close_and_create_slot`: a linha do CONTRATO primeiro
-- ===========================================================================
--
-- Esta não travava contrato nenhum: entrava pelo `recurring_slots` e ia
-- cancelar instâncias. Contra o encerramento (contrato → instâncias → slots)
-- fechava ciclo pelo par instância×slot. Agora ela também passa pela porta.

CREATE OR REPLACE FUNCTION public.close_and_create_slot(p_slot uuid, p_new_weekday integer, p_new_local_time time without time zone, p_active_to date DEFAULT CURRENT_DATE, p_new_iana_tz text DEFAULT NULL::text, p_new_duration_min integer DEFAULT NULL::integer, p_new_active_from date DEFAULT NULL::date, p_actor uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_slot recurring_slots%rowtype;
  v_contract_id uuid;
  v_group uuid;
  v_cancelled int;
  v_new_id uuid;
  v_actor uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'close_and_create_slot é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- ALTERADO (c8 · R1): contrato (1) → instâncias do slot (2) → o slot (4).
  -- A pré-leitura sem lock só descobre o contrato dono; o estado do slot que
  -- decide é o relido depois dos locks.
  select rs.contract_id into v_contract_id from recurring_slots rs where rs.id = p_slot;
  perform 1 from contracts where id = v_contract_id for update;
  perform 1 from class_instances
   where slot_id = p_slot and state = 'scheduled'
   order by id
     for update;

  select * into v_slot from recurring_slots where id = p_slot for update;
  if not found then
    raise exception 'slot % não existe', p_slot;
  end if;
  if v_slot.active_to is not null and v_slot.active_to <= p_active_to then
    raise exception 'slot % já está fechado em %', p_slot, v_slot.active_to;
  end if;
  if p_active_to < v_slot.active_from then
    raise exception 'active_to (%) anterior ao início do slot (%)', p_active_to, v_slot.active_from;
  end if;

  -- P1: troca de horário de GRUPO exige a âncora explícita (nunca herda calada).
  select c.student_group_id into v_group from contracts c where c.id = v_slot.contract_id;
  if v_group is not null and p_new_iana_tz is null then
    raise exception 'contrato de GRUPO: informe a âncora de fuso do novo horário (P1/M4-1)';
  end if;

  update recurring_slots set active_to = p_active_to where id = p_slot;

  update class_instances
     set state = 'cancelled'
   where slot_id = p_slot
     and state = 'scheduled'
     and occurrence_date > p_active_to;
  get diagnostics v_cancelled = row_count;

  v_new_id := public.create_slot(
    v_slot.contract_id,
    p_new_weekday,
    p_new_local_time,
    coalesce(p_new_iana_tz, v_slot.iana_tz),
    coalesce(p_new_duration_min, v_slot.duration_min),
    coalesce(p_new_active_from, p_active_to + 1),
    v_actor);

  perform public.log_audit(v_actor, 'close_and_create_slot', 'recurring_slots', p_slot::text,
    jsonb_build_object('closed_at', p_active_to, 'cancelled_future_instances', v_cancelled,
                       'new_slot', v_new_id, 'new_iana_tz', p_new_iana_tz));
  return v_new_id;
end;
$function$;


-- ===========================================================================
-- R1.9 · `resume_contract`: instâncias e horários fixos antes dos advisory
-- ===========================================================================
--
-- A retomada estendia créditos (advisory `makeup_spend:`) ANTES de cancelar as
-- instâncias da pausa e de materializar (advisory `materialize_slot:`). Agora os
-- dois andares de linha vêm primeiro; o efeito visível é o mesmo (a ordem das
-- ESCRITAS não muda nada observável: o cancelamento das aulas da pausa e a
-- extensão de crédito são independentes entre si).

CREATE OR REPLACE FUNCTION public.resume_contract(p_contract uuid, p_actor uuid DEFAULT NULL::uuid, p_today date DEFAULT business_today())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_contract contracts%rowtype;
  v_pause contract_pauses%rowtype;
  v_actor uuid;
  v_days int;
  v_row record;
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

  -- ALTERADO (c8 · R1): andares 2 e 4 SUBIRAM para antes de qualquer advisory.
  -- O cancelamento das aulas caídas dentro da pausa era feito depois da extensão
  -- de crédito (que pega o advisory do gasto, lá dentro do `_reissue_credit`) —
  -- isto é, lock de LINHA depois de advisory.
  perform 1 from class_instances
   where contract_id = p_contract and state = 'scheduled'
     and (starts_at_utc at time zone public.business_tz())::date >= v_pause.paused_on
     and (starts_at_utc at time zone public.business_tz())::date < p_today
   order by id
     for update;
  perform 1 from recurring_slots
   where contract_id = p_contract and (active_to is null or active_to >= p_today)
   order by id
     for update;

  select coalesce(array_agg(i.id), array[]::uuid[]) into v_cancelled_ids
  from class_instances i
  where i.contract_id = p_contract
    and i.state = 'scheduled'
    and (i.starts_at_utc at time zone public.business_tz())::date >= v_pause.paused_on
    and (i.starts_at_utc at time zone public.business_tz())::date < p_today;
  if coalesce(array_length(v_cancelled_ids, 1), 0) > 0 then
    update class_instances set state = 'cancelled' where id = any(v_cancelled_ids);
  end if;

  if v_days > 0 then
    for v_row in
      select rc.ledger_id, rc.expires_on, rc.duration_min, ml.class_instance_id, ml.student_id
      from public._makeup_remaining_credits(p_contract) rc
      join makeup_ledger ml on ml.id = rc.ledger_id
      where rc.expires_on >= v_pause.paused_on
        and rc.expires_on <> 'infinity'::date
        and ml.created_at < v_pause.created_at
      order by rc.ord
    loop
      if v_row.expires_on >= p_today then
        perform public._reissue_credit(v_row.ledger_id, v_row.expires_on + v_days,
                                       v_actor, 'pausa: validade estendida (' || v_days || ' dias)',
                                       null, p_today);
      else
        -- expirou durante a pausa: morto para o FIFO (sem débito); renasce com
        -- a validade estendida, preservando duração + origem.
        insert into makeup_ledger
          (contract_id, student_id, delta, reason, class_instance_id, expires_on,
           duration_min, note, created_by)
        values
          (p_contract, v_row.student_id, 1, 'manual_adjust', v_row.class_instance_id,
           v_row.expires_on + v_days, v_row.duration_min,
           'pausa: validade estendida (' || v_days || ' dias)', v_actor);
      end if;
      v_extended := v_extended + 1;
    end loop;
  end if;

  update contracts set status = 'active' where id = p_contract;
  update contract_pauses set resumed_on = p_today where id = v_pause.id;

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
                       'aulas_canceladas_na_pausa', to_jsonb(v_cancelled_ids),
                       'aulas_materializadas', v_materialized));
  return v_extended;
end;
$function$;


-- ###########################################################################
-- R2 · ANONIMIZADO (E ARQUIVADO) NUNCA GANHA LOGIN
-- ###########################################################################
--
-- O motor (`provisionStudent`) lê o status e recusa lead; a leitura e o vínculo
-- são duas idas ao banco, então existe janela: a anonimização pode commitar no
-- meio e o convite vincularia um profile a uma ficha que acabou de virar
-- "Ex-aluno(a)" — login vivo para quem pediu para sumir.
--
-- O gatilho fecha a janela porque roda DENTRO da escrita do vínculo: o estado
-- que ele vê é o estado no instante do UPDATE, não o de uma leitura anterior.
-- O nome do gatilho fica (ele é citado em teste e em migration anterior); o que
-- muda é o alcance — LEAD, ARQUIVADO e ANONIMIZADO, cada um com o seu erro.

CREATE OR REPLACE FUNCTION public.students_lead_sem_login()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.profile_id is not null and old.profile_id is null then
    -- ALTERADO (c8 · R2): a ficha ANONIMIZADA é terminal (P5 da revisão nº 8) —
    -- e a checagem vem antes da de status porque é a mais grave: dar login a ela
    -- é ressuscitar dado que a LGPD mandou apagar.
    if new.anonymized_at is not null then
      raise exception
        'ficha anonimizada em % não recebe acesso ao portal (%): cadastre a pessoa de novo',
        new.anonymized_at, new.display_name;
    end if;
    if new.status = 'lead' then
      raise exception
        'lead não tem portal (%): o cadastro vira aluno quando o contrato nasce — convide depois disso',
        new.display_name;
    end if;
    -- ALTERADO (c8 · R2): arquivado é ex-aluno; reative (contrato novo promove)
    -- antes de convidar.
    if new.status = 'archived' then
      raise exception
        'cadastro arquivado não recebe acesso ao portal (%): reative antes de convidar',
        new.display_name;
    end if;
  end if;
  return new;
end;
$function$;


-- ###########################################################################
-- R3 · PAUSA LONGA CONTINUA DONA DO HORÁRIO
-- ###########################################################################
--
-- `materialize_slot` só cria instância de contrato ATIVO. Contrato PAUSADO,
-- portanto, não tem nenhuma instância futura — e a exclusão GiST da professora
-- (`class_instances_teacher_no_overlap_excl`), que é quem recusa sobreposição,
-- não tem o que ver. Resultado: pausa de 3 meses = horário aparentemente livre,
-- e uma admissão nova ficava com o horário de quem só está parado. Na retomada,
-- a materialização bate no conflito e pula ocorrência a ocorrência (caminho em
-- massa): o aluno pausado volta sem o horário dele.
--
-- A conferência tem de ser por INSTANTE (Lei 1): dois horários fixos podem estar
-- em zonas IANA diferentes, e "10:00 com 10:00" não diz nada. Expandimos as
-- duas ocorrências no horizonte e comparamos `tstzrange` — o mesmo instante que
-- a exclusão GiST compararia se as instâncias existissem.

CREATE OR REPLACE FUNCTION public._paused_slot_conflict(
  p_teacher uuid,
  p_weekday integer,
  p_local_time time without time zone,
  p_iana_tz text,
  p_duration_min integer,
  p_active_from date,
  p_exclude_contract uuid DEFAULT NULL::uuid,
  p_weeks integer DEFAULT 8,
  OUT o_contract uuid,
  OUT o_quem text,
  OUT o_dia date)
 RETURNS record
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_de date;
  v_ate date;
begin
  -- a janela de datas cobre o horizonte do materializador com um dia de folga de
  -- cada lado: o corte por DATA CIVIL não é o mesmo nas duas zonas, e sobrar dia
  -- é inofensivo (quem decide é a sobreposição de instantes, exata).
  v_de := greatest(p_active_from, public.business_today()) - 1;
  v_ate := public.business_today() + (p_weeks * 7) + 1;
  if v_de > v_ate then
    return;
  end if;

  with dias as (
    select g::date as dia
    from generate_series(v_de::timestamp, v_ate::timestamp, interval '1 day') g
  ),
  novo as (
    select tstzrange(
             (d.dia + p_local_time) at time zone p_iana_tz,
             ((d.dia + p_local_time) at time zone p_iana_tz)
               + make_interval(mins => p_duration_min)) as faixa
    from dias d
    where extract(dow from d.dia)::int = p_weekday
      and d.dia >= p_active_from
  ),
  pausado as (
    select rs.contract_id,
           coalesce(s.display_name, 'contrato ' || left(rs.contract_id::text, 8)) as quem,
           d.dia,
           tstzrange(
             (d.dia + rs.local_time) at time zone rs.iana_tz,
             ((d.dia + rs.local_time) at time zone rs.iana_tz)
               + make_interval(mins => rs.duration_min)) as faixa
    from recurring_slots rs
    join contracts c on c.id = rs.contract_id and c.status = 'paused'
    left join students s on s.id = c.student_id
    cross join dias d
    where rs.teacher_id = p_teacher
      and (p_exclude_contract is null or rs.contract_id <> p_exclude_contract)
      and extract(dow from d.dia)::int = rs.weekday
      and d.dia >= rs.active_from
      and (rs.active_to is null or d.dia <= rs.active_to)
  )
  select p.contract_id, p.quem, p.dia
    into o_contract, o_quem, o_dia
  from pausado p
  join novo n on n.faixa && p.faixa
  order by p.dia
  limit 1;
end;
$function$;

revoke execute on function public._paused_slot_conflict(uuid, integer, time without time zone, text, integer, date, uuid, integer)
  from public, anon, authenticated, service_role;


-- `create_slot`: a conferência entra ANTES do insert (fail-fast com nome), e o
-- caminho ESTRITO da materialização segue intocado logo abaixo — ele continua
-- sendo quem recusa conflito com contrato ATIVO.

CREATE OR REPLACE FUNCTION public.create_slot(p_contract uuid, p_weekday integer, p_local_time time without time zone, p_iana_tz text DEFAULT NULL::text, p_duration_min integer DEFAULT 45, p_active_from date DEFAULT business_today(), p_actor uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_contract contracts%rowtype;
  v_tz text;
  v_id uuid;
  v_actor uuid;
  v_conf record;
begin
  if public.app_role() <> 'admin' then
    raise exception 'create_slot é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- ALTERADO (c8 · R1): a linha do contrato é o 1º andar da ordem canônica —
  -- esta função escreve `recurring_slots` (4º) e `class_instances` (2º, via
  -- materialização) do contrato, e entrava sem passar pela porta.
  select * into v_contract from contracts where id = p_contract for update;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_contract.contract_type <> 'private_1on1' then
    raise exception 'slots são de contratos private_1on1';
  end if;

  -- P6 (revisão nº 8): horário fixo de contrato de verdade exige fuso
  -- confirmado. O experimental fica de fora, como no gatilho de contrato.
  if not coalesce(v_contract.is_trial, false) then
    perform public._require_confirmed_tz(v_contract.student_id, v_contract.student_group_id);
  end if;

  -- P1: individual cai no fuso do aluno; GRUPO exige âncora explícita — o
  -- min(iana_tz) alfabético saiu (a UI oferece o fuso do membro-âncora).
  v_tz := coalesce(
    p_iana_tz,
    (select s.iana_tz from students s where s.id = v_contract.student_id));
  if v_tz is null and v_contract.student_group_id is not null then
    raise exception 'contrato de GRUPO exige a âncora de fuso explícita (p_iana_tz) — P1/M4-1';
  end if;
  if v_tz is null then
    raise exception 'não foi possível determinar a zona IANA do slot — informe p_iana_tz';
  end if;

  -- ALTERADO (c8 · R3): contrato PAUSADO não tem instância futura, então a
  -- exclusão GiST não o defende. A conferência é por INSTANTE (Lei 1) contra os
  -- horários fixos VIGENTES dele. O próprio contrato fica de fora: trocar o
  -- horário de um contrato pausado não pode colidir consigo mesmo.
  v_conf := public._paused_slot_conflict(
    v_contract.teacher_id, p_weekday, p_local_time, v_tz, p_duration_min,
    p_active_from, p_contract);
  if v_conf.o_contract is not null then
    raise exception
      'a professora tem este horário reservado por um contrato EM PAUSA (%) — primeiro dia de choque: %. Retome ou encerre aquele contrato antes de usar o horário',
      v_conf.o_quem, to_char(v_conf.o_dia, 'DD/MM/YYYY')
      using errcode = 'exclusion_violation';
  end if;

  insert into recurring_slots
    (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from)
  values
    (p_contract, v_contract.teacher_id, p_weekday, p_local_time, v_tz, p_duration_min, p_active_from)
  returning id into v_id;

  -- E3a: ESTRITO. Este é o caminho interativo (wizard de admissão e ação avulsa
  -- da ficha): conflito de agenda derruba a transação inteira em vez de deixar
  -- um horário fixo com semanas faltando e a tela dizendo "criado ✓".
  perform public.materialize_slot(v_id, 8, true);

  perform public.log_audit(v_actor, 'create_slot', 'recurring_slots', v_id::text,
    jsonb_build_object('contract_id', p_contract, 'weekday', p_weekday,
                       'local_time', p_local_time, 'iana_tz', v_tz,
                       'active_from', p_active_from));
  return v_id;
end;
$function$;


-- ###########################################################################
-- R4 · RECURSÃO SEM TETO FUNCIONAL
-- ###########################################################################
--
-- `passo < 25` era um teto de SEGURANÇA usado como teto de NEGÓCIO: uma cadeia
-- de 26 remarcações (rara, mas possível — remarcar é barato para quem tem
-- franquia) deixava de encontrar a aula viva e o crédito reservado sumia da
-- tela, silenciosamente. Quem protege contra ciclo é a detecção de ciclo, não um
-- número: `CYCLE` (Postgres 14+; aqui 17.6) guarda o caminho de `id` já visitado
-- e para de expandir quando um se repete — sem teto para cadeia HONESTA.
--
-- A linha em que o ciclo é detectado ainda é emitida (é a repetição de um
-- ancestral), e isso é inofensivo: o `distinct ledger_id` a jusante já a
-- descarta.

CREATE OR REPLACE FUNCTION public.admin_reserved_credits(p_contract_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_total int;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_reserved_credits é da administração (D10)';
  end if;
  if p_contract_ids is null or array_length(p_contract_ids, 1) is null then
    return 0;
  end if;

  with recursive debito as (
    select ml.id as ledger_id, (-ml.delta) as creditos, ml.class_instance_id as instancia
      from makeup_ledger ml
     where ml.delta < 0
       and ml.class_instance_id is not null
       and ml.contract_id = any (p_contract_ids)
  ),
  cadeia as (
    select d.ledger_id, d.creditos, ci.id, ci.state, ci.starts_at_utc
      from debito d
      join class_instances ci on ci.id = d.instancia
    union all
    select c.ledger_id, c.creditos, f.id, f.state, f.starts_at_utc
      from cadeia c
      join class_instances f on f.reschedule_of = c.id
  ) cycle id set eh_ciclo using caminho
  select coalesce(sum(q.creditos), 0)::int into v_total
    from (
      select distinct ledger_id, creditos
        from cadeia
       where state = 'scheduled'
         and starts_at_utc >= now()
    ) q;

  return v_total;
end;
$function$;


-- ###########################################################################
-- R5 · `tz_confirmed` SÓ PELO CAMINHO LEGÍTIMO
-- ###########################################################################
--
-- A confirmação do fuso é EFEITO de gravar cidade/fuso (é o CityPicker que manda
-- os três juntos) — nunca um campo que se liga sozinho. Sem esta guarda, um
-- `update students set tz_confirmed = true` (server action nova distraída, script
-- de correção, MCP) fabricava a confirmação sem ninguém ter confirmado nada, e o
-- gate do contrato/horário fixo (P6 da revisão nº 8) passava a proteger o vazio.
--
-- O DEFAULT da coluna continua `true`, de propósito: aluno que já existia nasceu
-- confirmado e o cadastro completo (com cidade) confirma na hora. Quem nasce
-- `false` é só o cadastro mínimo do lead — e a única saída dele é gravar
-- cidade/fuso.

CREATE OR REPLACE FUNCTION public.students_confirm_tz()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_mudou boolean;
begin
  v_mudou := new.iana_tz is distinct from old.iana_tz
             or (new.city is not null and new.city is distinct from old.city);
  if v_mudou then
    new.tz_confirmed := true;
  -- ALTERADO (c8 · R5): sem cidade/fuso novos na MESMA escrita, ligar o flag é
  -- fabricar confirmação. Desligar continua permitido (é como se marca um
  -- cadastro para revisão).
  elsif new.tz_confirmed and not old.tz_confirmed then
    raise exception
      'tz_confirmed não se liga sozinho (%): a confirmação é efeito de gravar a CIDADE ou o fuso — grave os dois juntos',
      new.display_name;
  end if;
  return new;
end;
$function$;
