-- =============================================================================
-- Issue #192 (23/11/2026) — a remarcação pela administração diz QUEM PEDIU a
-- mudança: o aluno ou a escola.
--
-- Decisão do dono (16/11/2026, issue #179, achado 9 do teste de 02/11/2026):
--   · a ESCOLA pediu: a remarcação nunca consome a franquia do mês nem crédito
--     do aluno, exige motivo, e o aviso é o "a mudança partiu da escola";
--   · o ALUNO pediu: segue como sempre (franquia, depois crédito; cortesia
--     continua sendo o perdão da administração), com "sua remarcação está
--     confirmada".
--
-- NADA aqui cria regra nova de dinheiro. `reschedule_class_at` já tem o modo
-- "a escola moveu" (`p_school_move`, M2 — 20260901000100), usado pela
-- professora no painel dela: nada consumido, `via = 'teacher'`. O que nasce é a
-- PORTA da administração para esse mesmo modo, com a origem gravada na trilha
-- (Lei 8) e no aviso da fila.
--
--   1. reschedule_class_at — MESMA assinatura. O audit ganha `requested_by`
--      ('school' | 'student') e a recusa por falta de motivo do modo escola
--      ganha frase própria.
--   2. book_reschedule_window — ganha `p_requested_by` (assinatura nova ⇒
--      DROP + CREATE; quem chama com 7 argumentos por posição segue válido).
--      Fecha também uma brecha antiga, achada na revisão independente: cortesia
--      e bypass de antecedência VAZIOS (null) passam a valer "não marcado" (antes
--      o null pulava a guarda de papel e a antecedência do destino).
--   3. admin_reschedule_to_new_time — ganha `p_requested_by` e o repassa.
--   4. enqueue_reschedule_confirmation — o aviso da fila carrega
--      `requested_by`, LIDO do audit que a própria remarcação gravou.
--
-- `p_requested_by` AUSENTE (null):
--   · da ADMINISTRAÇÃO, numa remarcação: RECUSADO. Decisão do dono em
--     23/11/2026, depois da revisão independente — a resposta é obrigatória no
--     BANCO (Lei 3), não só na tela: sem ela, uma mudança que a escola pediu
--     podia ser cobrada do aluno e ficar na trilha como "o aluno pediu".
--   · do ALUNO, no portal: pedido do aluno (ele remarca a própria aula, é o que
--     o gesto significa), cobrado como sempre.
-- A omissão nunca vira remarcação sem custo.
--
-- ORDEM DE DEPLOY: o app antigo não manda o parâmetro. Se esta migration entrar
-- antes do app novo, a remarcação pela ADMINISTRAÇÃO fica recusada (com frase)
-- até o app subir; o portal do aluno não é afetado. App novo antes da
-- migration: a remarcação pela administração responde "o sistema está
-- terminando uma atualização" até ela entrar.
--
-- `book_computed_slot` (a grade calculada do PORTAL) não muda e não repassa a
-- origem: o aluno segue remarcando por ela; a administração, que remarca pelas
-- duas portas dela, é recusada ali quando informa uma aula (o resgate de
-- crédito por contrato segue igual).
--
-- Cada função abaixo parte da definição VIGENTE, byte a byte; os trechos
-- mudados levam a marca `#192`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. reschedule_class_at — base: 20260901000100. Mesma assinatura.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reschedule_class_at(p_instance uuid, p_new_starts_utc timestamp with time zone, p_new_snapshot text, p_actor uuid DEFAULT NULL::uuid, p_courtesy boolean DEFAULT false, p_courtesy_note text DEFAULT NULL::text, p_bypass_lead boolean DEFAULT false, p_school_move boolean DEFAULT false)
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
  -- ALTERADO (#192): o modo escola recusa com frase PRÓPRIA — a administração
  -- passou a entrar por ele, e "cortesia exige motivo" falaria de uma cortesia
  -- que ela não marcou. A condição é a mesma de antes, partida em duas.
  if p_school_move and btrim(coalesce(p_courtesy_note, '')) = '' then
    raise exception 'a remarcação pedida pela escola exige motivo';
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

  if p_school_move then
    -- M2: a escola moveu — mesma mecânica da cortesia (nada consumido), com a
    -- SUA voz no audit para o extrato e os e-mails distinguirem.
    -- #192: é também o ramo da administração quando quem pediu foi a escola
    -- (book_reschedule_window, p_requested_by = 'school'). Nem `reschedule_usage`
    -- nem `spend_makeup` são tocados aqui: a regra de não consumir é ESTE ramo.
    v_via := 'teacher';
  elsif p_courtesy then
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
      'school_move', p_school_move,
      -- NOVO (#192, Lei 8): quem PEDIU a mudança. É a outra leitura do mesmo
      -- fato que decidiu o consumo acima, gravada na mesma transação.
      'requested_by', case when p_school_move then 'school' else 'student' end,
      'period_ym', v_period));

  return v_new_id;
end;
$function$;
-- Segue INTERNA (revogada de clientes): o papel de quem pode pedir o modo
-- escola é conferido nas portas — teacher_reschedule_own_class (a professora,
-- sobre a própria aula) e book_reschedule_window (só a administração).
revoke execute on function
  public.reschedule_class_at(uuid, timestamptz, text, uuid, boolean, text, boolean, boolean)
from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. book_reschedule_window — base: 20260730000100. Assinatura nova.
-- -----------------------------------------------------------------------------
drop function public.book_reschedule_window(uuid, uuid, uuid, uuid, boolean, text, boolean);
CREATE OR REPLACE FUNCTION public.book_reschedule_window(p_window uuid, p_instance uuid DEFAULT NULL::uuid, p_contract uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid, p_courtesy boolean DEFAULT false, p_courtesy_note text DEFAULT NULL::text, p_bypass_lead boolean DEFAULT false, p_requested_by text DEFAULT NULL::text)
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
  v_block text;
  -- NOVO (passe adversarial do Lote 1): o FIM da aula que vai nascer. O cinto do
  -- bloqueio pergunta pela faixa `[v_win.starts_at_utc, v_ends)`, não pelo ponto.
  v_ends timestamptz;
  -- NOVO (Sol · rodada 2 do Lote 1): a duração EXATA, como intervalo. É ela que
  -- fecha a faixa; `v_duration_min` (arredondado) segue só para o audit.
  v_dur interval;
begin
  -- NOVO (#192, revisão independente de 23/11/2026): VAZIO (null) nos dois
  -- campos da administração vale "não marcado". Num `if`, null não é verdadeiro
  -- nem falso: `(p_courtesy or p_bypass_lead)` e `not p_bypass_lead` viravam
  -- null, a guarda de papel e a da antecedência do destino eram PULADAS, e o
  -- aluno que mandasse `p_bypass_lead = null` reservava dentro da antecedência
  -- mínima da professora (a brecha vinha de 20260730000100). Normalizado AQUI,
  -- antes de qualquer guarda: vale para quem chega direto, por
  -- book_computed_slot ou por admin_reschedule_to_new_time, que repassam os
  -- dois campos como receberam. O miolo (reschedule_class_at) só recebe daqui o
  -- valor já normalizado e o `true` literal do bypass.
  p_courtesy := coalesce(p_courtesy, false);
  p_bypass_lead := coalesce(p_bypass_lead, false);
  if (p_instance is null) = (p_contract is null) then
    raise exception 'informe a aula a remarcar (p_instance) OU o contrato do resgate (p_contract)';
  end if;
  if (p_courtesy or p_bypass_lead) and public.app_role() <> 'admin' then
    raise exception 'cortesia e bypass de antecedência são só da administração (D10)';
  end if;
  if p_courtesy and p_instance is null then
    raise exception 'cortesia é da REMARCAÇÃO — resgate consome crédito por definição';
  end if;
  -- NOVO (#192): quem pediu a mudança. `coalesce` no papel: sem papel no JWT a
  -- recusa é a resposta (fail-closed) — só a administração afirma que a escola
  -- pediu. O que acontece com a AUSÊNCIA está logo abaixo.
  if p_requested_by is not null and p_requested_by not in ('student', 'school') then
    raise exception 'informe quem pediu a mudança: o aluno (student) ou a escola (school)';
  end if;
  if p_requested_by = 'school' and coalesce(public.app_role(), '') <> 'admin' then
    raise exception 'só a administração registra mudança pedida pela escola (D10)';
  end if;
  if p_requested_by = 'school' and p_instance is null then
    raise exception 'pedido da escola é da REMARCAÇÃO — resgate consome crédito por definição';
  end if;
  -- NOVO (#192, decisão do dono em 23/11/2026): a ADMINISTRAÇÃO não remarca sem
  -- dizer quem pediu. A exigência é do banco (Lei 3) — a tela só a antecipa —,
  -- e vale por qualquer caminho que chegue aqui com papel de administração
  -- (direto, por admin_reschedule_to_new_time ou por book_computed_slot, que
  -- não repassa a origem). O aluno, no portal, remarca a PRÓPRIA aula: sem o
  -- parâmetro, o pedido é dele. Recusa antes de qualquer trava: nada foi tocado.
  if p_instance is not null and p_requested_by is null
     and coalesce(public.app_role(), '') = 'admin' then
    raise exception 'informe quem pediu a mudança: o aluno (student) ou a escola (school)';
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

  -- ALTERADO (passe adversarial do Lote 1): 5º andar da ordem canônica, na
  -- sub-ordem do adendo do c10 — `makeup_spend` (do contrato) ANTES de
  -- `teacher_agenda` (da professora). Os dois são reentrantes: `spend_makeup`
  -- pede o primeiro adiante e o `insert` da aula pede o segundo pelo gatilho
  -- `class_instances_horario_em_pausa`.
  -- `v_contract.id` (e não `v_contract_id`) de propósito: é a grafia que o
  -- teste-guarda da ordem canônica lê em `m3-c8-revisao-9.test.ts` — as duas
  -- valem o mesmo uuid (a linha foi lida logo acima), e trocar a grafia cegaria
  -- a prova de que a janela é travada ANTES do advisory.
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || v_contract.id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('teacher_agenda:' || v_win.teacher_id::text, 0));

  -- ALTERADO (passe adversarial do Lote 1): A DURAÇÃO DA AULA QUE VAI NASCER,
  -- derivada UMA vez, aqui, para os dois caminhos — é ela que fecha a faixa que
  -- o cinto do bloqueio examina, e no resgate é a MESMA que o `insert` usa.
  --
  -- ── O INTERVALO É EXATO, E O MINUTO É SÓ PARA O AUDIT (Sol · rodada 2) ────
  -- A primeira versão derivava MINUTOS INTEIROS por `round(epoch/60)` e
  -- reconstruía a faixa com `make_interval(mins => …)`. Só que
  -- `reschedule_class_at` preserva `v_old.ends_at_utc - v_old.starts_at_utc`
  -- EXATO, e a coluna aceita duração com segundos (o CHECK novo desta migration
  -- é de FAIXA — 15..480 min —, não de granularidade). Uma aula de 30m20s às
  -- 23:30 era medida como "30 min", passava pelo cinto e renascia 20 segundos
  -- DENTRO do bloqueio. O cinto voltava a mentir exatamente no caso que ele
  -- existe para pegar. Agora a faixa é fechada pelo intervalo REAL; o inteiro
  -- continua existindo só onde ele é rótulo (o `duration_min` do audit).
  if p_instance is not null then
    -- remarcação: a aula herda a duração da original (é o que
    -- `reschedule_class_at` faz com `v_old.ends_at_utc - v_old.starts_at_utc`).
    select ci.ends_at_utc - ci.starts_at_utc
      into v_dur
      from class_instances ci where ci.id = p_instance;
    v_duration_min := round(extract(epoch from v_dur) / 60)::int;
  else
    -- ALTERADO (c8 · R1): a linha já está travada lá em cima; aqui é só a
    -- releitura do estado sobre o qual esta transação decide.
    -- As validações do resgate SOBEM junto com a leitura da duração porque são
    -- a mesma decisão (qual aula vai nascer), e a ordem RELATIVA entre elas —
    -- tipo → status → duração — é a de antes: nenhuma mensagem de erro do
    -- resgate troca de lugar com outra do resgate.
    select * into v_contract from contracts where id = v_contract_id;
    if v_contract.contract_type <> 'private_1on1' then
      raise exception 'resgate de crédito só se aplica a contratos private_1on1';
    end if;
    if v_contract.status <> 'active' then
      raise exception 'contrato % não está ativo — resgate bloqueado', v_contract.id;
    end if;

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
    -- No resgate a duração NASCE em minutos inteiros (a coluna `duration_min` do
    -- crédito e a do slot), então aqui o intervalo exato É o minuto — e é este
    -- mesmo valor que o `insert` lá embaixo usa, uma conta só.
    v_dur := make_interval(mins => v_duration_min);
  end if;

  -- ALTERADO (A6/e, corrigido no passe adversarial do Lote 1): o bloqueio criado
  -- DEPOIS da publicação fecha o horário — e a pergunta é da AULA INTEIRA, não
  -- do instante da janela. Faixa `[início, fim)` contra faixa `[início, fim)` do
  -- bloqueio: a aula de 60 min que começa às 23:30 da véspera invade o dia
  -- bloqueado e é recusada; a de 30 min que termina 00:00 em ponto, não.
  v_ends := v_win.starts_at_utc + v_dur;
  select e.local_snapshot into v_block
  from teacher_availability_exceptions e
  where e.teacher_id = v_win.teacher_id
    and e.kind = 'block'
    and tstzrange(v_win.starts_at_utc, v_ends) && tstzrange(e.starts_at_utc, e.ends_at_utc)
  order by e.starts_at_utc, e.id
  limit 1;
  if v_block is not null then
    raise exception 'esse horário foi bloqueado pela professora (%) — escolha outro', v_block;
  end if;

  if p_instance is not null then
    v_new_id := public.reschedule_class_at(
      p_instance, v_win.starts_at_utc, v_win.local_time_snapshot, v_actor,
      p_courtesy, p_courtesy_note, true,  -- lead já checado sobre a janela
      -- NOVO (#192): a escola pediu ⇒ modo "a escola moveu" do miolo, que não
      -- toca a franquia nem o ledger e exige motivo, nesta mesma transação.
      coalesce(p_requested_by = 'school', false));
  else
    insert into class_instances
      (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
       local_time_snapshot, state, reschedule_of)
    values
      (v_contract.id, v_win.teacher_id, null, null, v_win.starts_at_utc,
       -- o MESMO fim que o cinto acabou de examinar (uma conta só)
       v_ends,
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
      'courtesy', p_courtesy, 'bypass_lead', p_bypass_lead,
      -- NOVO (#192): quem pediu (só na remarcação; resgate não tem pedido de
      -- mudança). Nulo aqui só chega do ALUNO no portal — a administração foi
      -- recusada lá em cima —, e o pedido é dele.
      'requested_by', case when p_instance is null then null
                           else coalesce(p_requested_by, 'student') end));

  return v_new_id;
end;
$function$;
revoke execute on function
  public.book_reschedule_window(uuid, uuid, uuid, uuid, boolean, text, boolean, text)
from public, anon;
grant execute on function
  public.book_reschedule_window(uuid, uuid, uuid, uuid, boolean, text, boolean, text)
to authenticated;

-- -----------------------------------------------------------------------------
-- 3. admin_reschedule_to_new_time — base: 20261029000200. Assinatura nova.
-- -----------------------------------------------------------------------------
drop function public.admin_reschedule_to_new_time(uuid, timestamptz, text, boolean, text, boolean);
create or replace function public.admin_reschedule_to_new_time(
  p_instance uuid,
  p_starts_at_utc timestamptz,
  p_iana_tz text default null,
  p_courtesy boolean default false,
  p_courtesy_note text default null,
  p_bypass_lead boolean default false,
  p_requested_by text default null  -- #192: 'student' | 'school' (obrigatório: nulo é recusado)
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_contract_id uuid;
  v_teacher uuid;
  v_tz text;
  v_dur interval;
  v_span interval;
  v_win uuid;
  v_local timestamp;
  v_block text;
  v_clash timestamptz;
  v_win_local text;
  v_new uuid;
  v_atual timestamptz;
begin
  if coalesce(public.app_role(), '') <> 'admin' then
    raise exception 'remarcar para horário novo é da administração (D10)';
  end if;
  if p_starts_at_utc is null then
    raise exception 'informe o novo horário';
  end if;

  -- 1º andar (contrato) e 2º (instância). A pré-leitura só descobre o
  -- endereço; o estado que decide é o relido depois das travas.
  select ci.contract_id into v_contract_id from class_instances ci where ci.id = p_instance;
  if v_contract_id is null then
    raise exception 'instância % não existe', p_instance;
  end if;
  perform 1 from contracts where id = v_contract_id for update;
  select ci.teacher_id, ci.ends_at_utc - ci.starts_at_utc, ci.starts_at_utc
    into v_teacher, v_dur, v_atual
    from class_instances ci
   where ci.id = p_instance and ci.state = 'scheduled'
     for update;
  if v_teacher is null then
    -- a recusa chega à dona (a aula mudou com a tela aberta): sem o id cru
    raise exception 'essa aula não está mais agendada — recarregue a página';
  end if;
  -- O próprio horário não é remarcação: passaria (a aula movida não conta
  -- como encosto) e cobraria franquia ou crédito por nada.
  if p_starts_at_utc = v_atual then
    raise exception 'esse já é o horário da aula — escolha outro';
  end if;
  select coalesce(p_iana_tz, t.iana_tz, public.business_tz()) into v_tz from teachers t where t.id = v_teacher;
  if p_starts_at_utc <= now() then
    raise exception 'esse horário já passou';
  end if;

  -- 3º andar: a janela publicada do MESMO instante, se houver, é a que a aula
  -- consome (como na grade calculada).
  select w.id into v_win from reschedule_windows w
   where w.teacher_id = v_teacher and w.starts_at_utc = p_starts_at_utc and w.state = 'publicada'
     for update;

  -- 5º andar: makeup_spend → teacher_agenda (sub-ordem do adendo do c10).
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || v_contract_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('teacher_agenda:' || v_teacher::text, 0));

  select e.local_snapshot into v_block
    from teacher_availability_exceptions e
   where e.teacher_id = v_teacher and e.kind = 'block'
     and tstzrange(p_starts_at_utc, p_starts_at_utc + v_dur) && tstzrange(e.starts_at_utc, e.ends_at_utc)
   order by e.starts_at_utc, e.id
   limit 1;
  if v_block is not null then
    raise exception 'esse horário está dentro de um bloqueio da professora (%) — remova o bloqueio antes ou escolha outro', v_block;
  end if;

  -- A aula que vai nascer contra as OUTRAS aulas dela (a movida não conta):
  -- a exclusão da tabela recusaria de qualquer jeito; aqui a recusa nomeia.
  select ci.starts_at_utc into v_clash
    from class_instances ci
   where ci.teacher_id = v_teacher and ci.state = 'scheduled' and ci.id <> p_instance
     and ci.ends_at_utc > p_starts_at_utc
     and ci.starts_at_utc < p_starts_at_utc + v_dur
   order by ci.starts_at_utc, ci.id
   limit 1;
  if v_clash is not null then
    raise exception 'esse horário encosta na aula marcada da professora de % — escolha outro horário',
      to_char(v_clash at time zone v_tz, 'YYYY-MM-DD HH24:MI') || ' ' || v_tz;
  end if;

  -- A régua de book_computed_slot: o destino não encosta em OUTRA janela
  -- publicada dela, medida pela maior duração da agenda e nunca menos que a aula.
  v_span := make_interval(mins => coalesce(public._teacher_window_span_min(v_teacher), 0));
  select to_char(w.starts_at_utc at time zone v_tz, 'YYYY-MM-DD HH24:MI') || ' ' || v_tz into v_win_local
    from reschedule_windows w
   where w.teacher_id = v_teacher and w.state = 'publicada'
     and w.starts_at_utc <> p_starts_at_utc
     and w.starts_at_utc > now()
     and w.starts_at_utc < p_starts_at_utc + v_dur
     and w.starts_at_utc > p_starts_at_utc - greatest(v_dur, v_span)
   order by w.starts_at_utc
   limit 1;
  if v_win_local is not null then
    raise exception 'esse horário encosta num horário de reposição já publicado pela professora (%) — escolha outro', v_win_local;
  end if;

  -- A janela nasce sob o advisory e morre consumida nesta mesma transação: se
  -- qualquer passo abaixo recusar, ela nunca existiu para ninguém.
  if v_win is null then
    if exists (select 1 from reschedule_windows w
                where w.teacher_id = v_teacher and w.starts_at_utc = p_starts_at_utc
                  and w.state = 'publicada') then
      raise exception 'esse horário acabou de ser publicado para reposição — escolha de novo na lista';
    end if;
    v_local := p_starts_at_utc at time zone v_tz;
    insert into reschedule_windows
      (teacher_id, local_date, local_time, iana_tz, starts_at_utc, local_time_snapshot, created_by)
    values
      (v_teacher, v_local::date, v_local::time, v_tz, p_starts_at_utc,
       to_char(v_local, 'YYYY-MM-DD HH24:MI') || ' ' || v_tz, auth.uid())
    returning id into v_win;
  end if;

  v_new := public.book_reschedule_window(
    v_win, p_instance, null, auth.uid(), p_courtesy, p_courtesy_note, p_bypass_lead,
    p_requested_by);  -- #192: valor, papel e AUSÊNCIA são conferidos lá, a regra é uma só

  perform public.log_audit(auth.uid(), 'admin_reschedule_to_new_time', 'class_instances', v_new::text,
    jsonb_build_object(
      'rescheduled_from', p_instance, 'teacher_id', v_teacher, 'window', v_win,
      'starts_at_utc', p_starts_at_utc, 'iana_tz', v_tz,
      'courtesy', p_courtesy, 'bypass_lead', p_bypass_lead,
      'requested_by', p_requested_by));  -- #192 (nunca nulo: a reserva acima recusaria)
  return v_new;
end;
$fn$;
revoke execute on function public.admin_reschedule_to_new_time(uuid, timestamptz, text, boolean, text, boolean, text)
from public, anon;
grant execute on function public.admin_reschedule_to_new_time(uuid, timestamptz, text, boolean, text, boolean, text)
to authenticated;
comment on function public.admin_reschedule_to_new_time(uuid, timestamptz, text, boolean, text, boolean, text) is
  'Issue #85: o "remarcar para horário novo" da administração numa transação só — cria (ou '
  'reaproveita) a janela do instante, move a aula por book_reschedule_window e audita. A aula '
  'movida não conta como encosto; o destino não pode encostar em outra janela publicada. '
  'Issue #192: p_requested_by diz quem pediu a mudança (''student'' | ''school'') e é obrigatório.';

-- -----------------------------------------------------------------------------
-- 4. enqueue_reschedule_confirmation — base: 20261030000100. Mesma assinatura.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_reschedule_confirmation(p_instance uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_contract uuid;
  v_row record;
  v_inserted int := 0;
  v_rows int;
  v_wa boolean;
  v_moved_by text;
  v_requested_by text;
begin
  select ci.contract_id into v_contract
  from class_instances ci where ci.id = p_instance;
  if v_contract is null then
    raise exception 'instância % não existe', p_instance;
  end if;

  if not ((auth.jwt() ->> 'role') = 'service_role'
          or public.app_role() = 'admin'
          or v_contract in (select public.my_contract_ids())
          -- M2 (01/09/2026): a PROFESSORA da aula também enfileira — é a RPC
          -- teacher_reschedule_own_class que chama, depois de conferir a posse.
          -- Gate Sol (26/10): só com papel de professora e só para aula que É
          -- uma remarcação — numa aula comum o WhatsApp diria "reposição
          -- agendada" sem nada ter mudado.
          or (coalesce(public.app_role(), '') in ('teacher', 'admin')
              and exists (select 1 from class_instances ci2
                           where ci2.id = p_instance
                             and ci2.reschedule_of is not null
                             and ci2.state = 'scheduled'
                             and ci2.starts_at_utc > now()
                             and ci2.teacher_id = public.my_teacher_id()))) then
    raise exception 'você não tem acesso a este contrato (D10)';
  end if;

  -- M3-1 (#42): quem moveu. O papel vem do JWT (app_metadata, Lei 4).
  v_moved_by := case
    when public.app_role() = 'teacher' then 'teacher'
    when public.app_role() = 'admin' or (auth.jwt() ->> 'role') = 'service_role' then 'admin'
    else 'student'
  end;

  -- NOVO (#192): quem PEDIU a mudança — lido da linha que `reschedule_class_at`
  -- gravou para ESTA instância (a nova), na transação que decidiu o consumo. O
  -- app não informa: o aviso não tem como divergir do que o banco cobrou.
  -- Remarcação anterior a esta migration não tem a chave: `school_move` (M2)
  -- responde por ela. Sem linha (resgate de crédito) fica ausente (null).
  select coalesce(a.diff ->> 'requested_by',
                  case when a.diff ->> 'school_move' = 'true' then 'school' else 'student' end)
    into v_requested_by
    from audit_log a
   where a.entity = 'class_instances'
     and a.entity_id = p_instance::text
     and a.action = 'reschedule_class'
   order by a.at desc, a.id desc
   limit 1;

  for v_row in
    select ci.id as instance_id,
           ci.starts_at_utc,
           ci.local_time_snapshot,
           s.id as student_id,
           s.profile_id,
           s.iana_tz,
           t.display_name as teacher_name
    from class_instances ci
    join contracts c on c.id = ci.contract_id
    join teachers t on t.id = ci.teacher_id
    join lateral (
      select st.id, st.profile_id, st.iana_tz
      from students st
      where st.id = c.student_id
      union
      select st.id, st.profile_id, st.iana_tz
      from student_group_members m
      join students st on st.id = m.student_id
      where m.group_id = c.student_group_id
    ) s on true
    where ci.id = p_instance
      and c.status = 'active'
  loop
    -- Só WhatsApp: o e-mail 3 (aprovado) sai pela action do portal.
    v_wa := false;
    if v_row.profile_id is not null then
      select p.whatsapp_e164 is not null into v_wa
      from profiles p where p.id = v_row.profile_id;
    end if;
    if coalesce(v_wa, false) then
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values (
        'whatsapp', 'reschedule-confirm', v_row.profile_id,
        jsonb_build_object(
          'instance_id', v_row.instance_id,
          'student_id', v_row.student_id,
          'starts_at_utc', v_row.starts_at_utc,
          'local_time_snapshot', v_row.local_time_snapshot,
          'iana_tz', v_row.iana_tz,
          'teacher_name', v_row.teacher_name,
          'moved_by', v_moved_by,
          'requested_by', v_requested_by
        ),
        format('reschedule-confirm:%s:%s:wa', v_row.instance_id, v_row.student_id)
      )
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end if;
  end loop;
  return v_inserted;
end;
$function$
;
revoke execute on function public.enqueue_reschedule_confirmation(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_reschedule_confirmation(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
