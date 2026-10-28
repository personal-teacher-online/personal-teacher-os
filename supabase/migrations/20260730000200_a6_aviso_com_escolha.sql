-- A6 · LOTE 2 — O AVISO DO CANCELAMENTO PASSA A SER ESCOLHA (99ª migration)
--
-- Lei 7 ao pé da letra: nenhuma migration anterior foi tocada. Esta nasce
-- DEPOIS da `20260730000100` (lote 1) e antes da `20260730000300` (lote 3).
--
-- Cada corpo abaixo é o corpo VIVO (a definição EFETIVA por ordem lexicográfica
-- das migrations) reemitido com o MÍNIMO alterado, e a alteração vem comentada
-- no lugar dela. Onde a ASSINATURA muda — e aqui ela muda nas TRÊS —, é
-- `drop function` da assinatura antiga + `create` + revokes REEMITIDOS:
-- `create or replace` não troca assinatura, ele cria OVERLOAD, e overload nesta
-- família é sorteio (o helper de provas `tests/helpers/definicao-da-funcao.ts`
-- estoura de propósito quando encontra dois).
--
-- ===========================================================================
-- O QUE ESTA MIGRATION FECHA (itens a–c da spec do A6 · §Migration 99)
-- ===========================================================================
--
-- a) A ESCOLHA DE AVISAR ENTRA NA ASSINATURA. `_cancel_class_core` ganha
--    `p_notify_email` / `p_notify_whatsapp` (default TRUE nos dois) e passa a
--    devolver `jsonb` `{credited, refund_blocked, expires_on}` — o desfecho que
--    até aqui só existia dentro do `audit_log`, e que a action tinha de ir
--    reler numa segunda consulta. `_enqueue_class_cancelled` ganha os mesmos
--    dois flags de canal. `cancel_class` (a porta da admin) ganha os dois e
--    repassa. `cancel_my_class` NÃO muda: o ALUNO não escolhe canal de aviso
--    sobre a própria aula, e o default TRUE preserva o comportamento dele
--    exatamente como está hoje.
--
--    Por que a premissa do goal era FALSA e isto não é RPC nova: "cancelar uma
--    aula hoje não avisa ninguém" não se sustenta — `_cancel_class_core`
--    (efetiva em `20260727000700:184`) chama `_enqueue_class_cancelled` FORA de
--    qualquer `if`, e há teste pinando essa incondicionalidade
--    (`tests/onda-agenda-a5.test.ts`). O A6 estende a cadeia que existe; não
--    nasce nenhuma `enqueue_class_cancellation` quase-homônima.
--
-- b) A LINHA ÓRFÃ CONTINUA PODENDO NASCER — decisão de desenho MANTIDA. O
--    comentário de `notification_outbox` é lei nesta casa: "aluno sem login
--    vira erro no DESPACHO, nunca skip silencioso no enqueue". Com
--    `p_notify_email = true` e aluno sem `profile_id`, a linha de e-mail nasce
--    com `recipient_profile_id` NULL, como hoje, e aparece na tela de Mensagens
--    como presa. O que muda é FORA do banco: o diálogo destrutivo mostra a
--    entregabilidade real e o checkbox nasce DESMARCADO quando não há login.
--    Nada aqui esconde linha nenhuma.
--
-- c) CONTAGENS DO TRATAMENTO DE PERÍODO. `admin_period_treatment` lê o retorno
--    novo e devolve `{block, cancelled, credited, refund_blocked, invited}`. A
--    frase generalizante da tela ("canceladas com crédito e aviso" para TODAS)
--    morre com dado, não com adjetivo: a aula que nasceu de crédito antigo sem
--    identidade volta BLOQUEADA de `_refund_for_credit_born_class`, e até aqui
--    ela era contada junto com as que creditaram.
--
-- Leis tocadas: 2 (nenhum ledger é escrito de forma diferente — o que muda é o
-- RELATO do que a transação fez), 3 (a escolha do canal é parâmetro da RPC; a
-- UI só antecipa), 4 (revokes reemitidos em cada assinatura nova), 7 (migration
-- NOVA), 8 (a escolha dos canais entra no `diff` do audit — quem cancelou SEM
-- avisar tem de ficar escrito).
--
-- PRÉ-VOO: nenhum. Esta migration não cria constraint nem toca dado existente —
-- só troca corpo e assinatura de função.


-- ###########################################################################
-- 1 · `_enqueue_class_cancelled` — os dois canais viram escolha
-- ###########################################################################
--
-- Corpo VIVO reemitido de `20260718000900_f7_cadastro_lgpd.sql:334`. Duas
-- mudanças, as duas comentadas no lugar:
--   · o insert do E-MAIL passa a acontecer sob `if p_notify_email then`;
--   · o insert do WHATSAPP ganha `p_notify_whatsapp and` na condição que já
--     existia (`coalesce(v_wa, false)`).
-- Com os dois flags ligados — que é o default — o resultado é BYTE A BYTE o de
-- hoje, inclusive a linha órfã e o `on conflict (dedupe_key) do nothing`.

drop function if exists public._enqueue_class_cancelled(uuid, boolean, date);

create function public._enqueue_class_cancelled(
  p_instance uuid,
  p_credited boolean,
  p_expires date,
  p_notify_email boolean default true,
  p_notify_whatsapp boolean default true
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row record;
  v_inserted int := 0;
  v_rows int;
  v_wa boolean;
begin
  for v_row in
    select ci.id as instance_id, ci.starts_at_utc, ci.local_time_snapshot,
           s.id as student_id, s.profile_id, s.iana_tz,
           t.display_name as teacher_name
    from class_instances ci
    join contracts c on c.id = ci.contract_id
    join teachers t on t.id = ci.teacher_id
    join lateral (
      select st.id, st.profile_id, st.iana_tz
      from students st where st.id = c.student_id
      union
      select st.id, st.profile_id, st.iana_tz
      from student_group_members m
      join students st on st.id = m.student_id
      where m.group_id = c.student_group_id
    ) s on true
    where ci.id = p_instance
  loop
    -- ALTERADO (A6/lote 2): o e-mail era INCONDICIONAL. Continua sendo o
    -- default; o que existe agora é a porta de quem decidiu não avisar.
    -- NÃO se acrescentou aqui nenhuma condição sobre `profile_id`: a linha
    -- órfã é desenho da casa (o comentário de `notification_outbox` manda o
    -- silêncio acontecer no DESPACHO, nunca aqui), e o A6 mexe na ESCOLHA da
    -- dona, não na regra de destinatário.
    if p_notify_email then
      insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
      values (
        'class-cancelled', v_row.profile_id,
        jsonb_build_object(
          'instance_id', v_row.instance_id, 'student_id', v_row.student_id,
          'starts_at_utc', v_row.starts_at_utc,
          'local_time_snapshot', v_row.local_time_snapshot,
          'iana_tz', v_row.iana_tz, 'teacher_name', v_row.teacher_name,
          'credited', p_credited, 'expires_on', p_expires),
        format('class-cancelled:%s:%s', v_row.instance_id, v_row.student_id))
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end if;

    v_wa := false;
    if v_row.profile_id is not null then
      select p.whatsapp_e164 is not null into v_wa
      from profiles p where p.id = v_row.profile_id;
    end if;
    -- ALTERADO (A6/lote 2): a condição do número CONTINUA sendo a mesma — sem
    -- WhatsApp no cadastro não nasce linha de WhatsApp, marcada ou não a caixa.
    -- O flag é um SEGUNDO portão, nunca um jeito de furar o primeiro.
    if p_notify_whatsapp and coalesce(v_wa, false) then
      insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
      values (
        'whatsapp', 'class-cancelled', v_row.profile_id,
        jsonb_build_object(
          'instance_id', v_row.instance_id, 'student_id', v_row.student_id,
          'starts_at_utc', v_row.starts_at_utc,
          'local_time_snapshot', v_row.local_time_snapshot,
          'iana_tz', v_row.iana_tz, 'teacher_name', v_row.teacher_name,
          'credited', p_credited, 'expires_on', p_expires),
        format('class-cancelled:%s:%s:wa', v_row.instance_id, v_row.student_id))
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      v_inserted := v_inserted + v_rows;
    end if;
  end loop;
  return v_inserted;
end;
$fn$;

-- ACL reemitida (a de `20260718000400:127`, agora na assinatura nova).
revoke execute on function public._enqueue_class_cancelled(uuid, boolean, date, boolean, boolean)
from public, anon, authenticated;

comment on function public._enqueue_class_cancelled(uuid, boolean, date, boolean, boolean) is
  'A6/lote 2: enfileira o aviso do cancelamento nos canais ESCOLHIDOS (default: '
  'os dois). E-mail desligado não insere a linha de e-mail; WhatsApp desligado '
  'não insere a de WhatsApp — e o WhatsApp continua exigindo número no cadastro '
  'do perfil, marcada ou não a caixa. Com os dois ligados o comportamento é o '
  'de sempre, inclusive a linha com recipient_profile_id NULL de aluno sem '
  'login: o silêncio dela acontece no DESPACHO, nunca aqui (comentário de '
  'notification_outbox).';


-- ###########################################################################
-- 2 · `_cancel_class_core` — a escolha entra, e o desfecho SAI
-- ###########################################################################
--
-- Corpo VIVO reemitido de `20260727000700_ordem_global_de_locks.sql:112` (a
-- versão da ordem canônica de locks: contrato ANTES da instância). Três
-- mudanças, todas comentadas no lugar:
--   1. `returns void` → `returns jsonb`;
--   2. os dois flags de canal na assinatura, repassados ao enqueue;
--   3. o `return jsonb_build_object(...)` no fim, com os MESMOS três valores
--      que o audit já registrava.
-- Tudo o mais — a ordem dos locks, a ordem das validações, o texto de cada
-- `raise`, o ramo do ADR-018 — é verbatim.
--
-- POR QUE O RETORNO: hoje quem quer saber se o cancelamento gerou crédito
-- precisa ir reler o `audit_log` numa SEGUNDA consulta, depois do commit
-- (`cancelClassAction` e `registrarDesfechoDaAulaAction` fazem exatamente
-- isso, e já tiveram de aprender a não transformar erro de leitura em "sem
-- crédito"). Dentro de `admin_period_treatment` essa releitura nem era
-- possível: o laço cancela N aulas e só sabia CONTAR cancelamentos. O valor
-- volta pela mesma transação que o produziu.

drop function if exists public._cancel_class_core(uuid, text, timestamptz, uuid, text);

create function public._cancel_class_core(
  p_instance uuid,
  p_cancelled_by text,
  p_notified_at timestamptz,
  p_actor uuid,
  p_via text,
  p_notify_email boolean default true,
  p_notify_whatsapp boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
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
  -- ALTERADO (A6/lote 2): a chamada continua FORA de qualquer `if` — o que
  -- muda é que ela carrega a ESCOLHA de canais. Com os defaults (os dois
  -- ligados) o efeito é o de sempre; quem desliga um canal está dizendo isso
  -- explicitamente, e fica no audit logo abaixo.
  perform public._enqueue_class_cancelled(p_instance, v_credited, v_expires, p_notify_email, p_notify_whatsapp);

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
      -- ACRESCENTADO (A6/lote 2 · Lei 8): a decisão de NÃO avisar o aluno é um
      -- ato sobre a relação com ele — daqui a seis meses, "por que ele não
      -- soube?" tem de ter resposta na trilha, e não na memória de alguém.
      'notify_email', p_notify_email,
      'notify_whatsapp', p_notify_whatsapp,
      'via', p_via));

  -- ACRESCENTADO (A6/lote 2): o desfecho volta para quem chamou, na mesma
  -- transação. São EXATAMENTE os três valores que o audit acabou de gravar —
  -- nenhuma conta nova, nenhuma fonte nova.
  return jsonb_build_object(
    'credited', v_credited,
    'refund_blocked', v_blocked,
    'expires_on', v_expires);
end;
$fn$;

-- ACL reemitida (a de `20260719000100:95`, agora na assinatura nova).
revoke execute on function public._cancel_class_core(uuid, text, timestamptz, uuid, text, boolean, boolean)
from public, anon, authenticated;

comment on function public._cancel_class_core(uuid, text, timestamptz, uuid, text, boolean, boolean) is
  'Miolo do cancelamento (ADR-018: quem decide crédito é p_cancelled_by, nunca '
  'a antecedência). A6/lote 2: recebe a escolha de canais do aviso (default: os '
  'dois ligados) e DEVOLVE {credited, refund_blocked, expires_on} — o mesmo '
  'desfecho que grava no audit_log, agora legível na própria transação.';


-- ###########################################################################
-- 3 · `cancel_class` (a porta da admin) repassa a escolha
-- ###########################################################################
--
-- Corpo VIVO reemitido de `20260718000400_f2_acoes_de_aula.sql:224`. A única
-- mudança é a assinatura (dois parâmetros com default) e o repasse.
--
-- `returns void` FICA: quem chama pela admin já lê o desfecho do `audit_log`, e
-- trocar o retorno desta porta obrigaria a mexer em todos os chamadores de uma
-- vez, sem necessidade nenhuma. O lote não amplia o que a spec pediu.
--
-- `cancel_my_class` NÃO é reemitida: a assinatura dela não muda, o corpo dela
-- não muda, e a chamada `perform public._cancel_class_core(p_instance,
-- 'student', now(), auth.uid(), 'self')` continua resolvendo para a função nova
-- pelos DEFAULTS — ou seja, o aluno continua avisando pelos dois canais, que é
-- o comportamento de hoje. Escolha de canal é gesto da ADMIN sobre a aula de
-- outra pessoa; ninguém escolhe não se avisar.

drop function if exists public.cancel_class(uuid, text, timestamptz, uuid);

create function public.cancel_class(
  p_instance uuid,
  p_cancelled_by text,
  p_notified_at timestamptz default now(),
  p_actor uuid default null,
  p_notify_email boolean default true,
  p_notify_whatsapp boolean default true
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if public.app_role() <> 'admin' then
    raise exception 'cancel_class é restrita à admin (D10)';
  end if;
  perform public._cancel_class_core(
    p_instance, p_cancelled_by, p_notified_at, coalesce(auth.uid(), p_actor), 'admin',
    p_notify_email, p_notify_whatsapp);
end;
$fn$;

-- ACL: a de sempre. `cancel_class` NUNCA teve revoke/grant próprio (varrido nas
-- 98 migrations) — o porteiro dela é o `app_role() <> 'admin'` do corpo, e a
-- assinatura nova nasce com o MESMO privilégio default da anterior. Escrever um
-- revoke aqui seria mudar a postura de segurança de carona num lote que não é
-- sobre isso; endurecer a ACL desta família é decisão própria, com medição dos
-- chamadores.

comment on function public.cancel_class(uuid, text, timestamptz, uuid, boolean, boolean) is
  'Superfície da admin para o cancelamento. A6/lote 2: aceita a escolha dos '
  'canais de aviso (default: os dois) e repassa ao miolo. O aluno cancela pela '
  'cancel_my_class, que não escolhe canal.';


-- ###########################################################################
-- 4 · `admin_period_treatment` conta CRÉDITO e BLOQUEIO, não só cancelamento
-- ###########################################################################
--
-- Corpo VIVO reemitido do fim de `20260730000100_a6_travas_de_agenda.sql` (a
-- versão do lote 1, com `add_teacher_block` devolvendo jsonb e a chamada do
-- bloqueio DEPOIS do laço — a ordem canônica de locks depende disso e não se
-- mexe aqui). Assinatura intocada ⇒ `create or replace`, e a ACL de
-- `20260718000700:509-511` continua valendo sem reemissão.
--
-- Mudança única: o laço LÊ o retorno de `_cancel_class_core` em vez de
-- descartá-lo, e o resultado ganha `credited` e `refund_blocked`.
--
-- Por que isso é dinheiro, e não estatística: `v_cancelled` soma QUALQUER
-- cancelamento, inclusive a aula que nasceu de crédito antigo sem identidade —
-- `_refund_for_credit_born_class` volta com `o_blocked` e SEM inserir no
-- ledger. Com uma contagem só, a tela dizia "3 aulas canceladas com crédito"
-- quando duas creditaram e uma não, e ninguém tinha como saber qual aluno ficou
-- sem. Agora a tela conta as duas metades, e os uuids de cada grupo ficam no
-- audit para a dona (ou o mantenedor) achar a aula pelo id.

create or replace function public.admin_period_treatment(
  p_teacher uuid,
  p_from date,
  p_to date,
  p_mode text,
  p_note text default null,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor uuid;
  v_tz text;
  v_block uuid;
  v_row record;
  v_cancelled uuid[] := array[]::uuid[];
  v_invited uuid[] := array[]::uuid[];
  v_rows int;
  -- ACRESCENTADO (A6/lote 2): o desfecho de CADA cancelamento do laço.
  v_desfecho jsonb;
  v_credited uuid[] := array[]::uuid[];
  v_blocked uuid[] := array[]::uuid[];
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_period_treatment é restrita à admin (D10)';
  end if;
  if p_mode not in ('cancel_credit', 'invite_reschedule', 'block_only') then
    raise exception 'modo % inválido (cancel_credit | invite_reschedule | block_only)', p_mode;
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  select coalesce(t.iana_tz, public.business_tz()) into v_tz from teachers t where t.id = p_teacher;
  if v_tz is null then
    raise exception 'professora % não existe', p_teacher;
  end if;

  for v_row in
    select ci.id, ci.starts_at_utc, ci.local_time_snapshot, c.id as contract_id
    from class_instances ci
    join contracts c on c.id = ci.contract_id
    where ci.teacher_id = p_teacher
      and ci.state = 'scheduled'
      and ci.starts_at_utc > now()
      and (ci.starts_at_utc at time zone v_tz)::date between p_from and p_to
    order by ci.starts_at_utc
  loop
    if p_mode = 'cancel_credit' then
      -- culpa da escola: crédito com validade-180 (M3-1), estorno-aware, AVISA (P4)
      -- ALTERADO (A6/lote 2): era `perform`. O desfecho de cada aula é lido —
      -- os canais ficam nos DEFAULTS (avisa pelos dois), porque o tratamento de
      -- período é comunicação em massa: quem trata um período inteiro está
      -- avisando todo mundo, e escolher canal aula a aula não é gesto que a
      -- tela de período ofereça.
      v_desfecho := public._cancel_class_core(v_row.id, 'teacher', now(), v_actor, 'period');
      v_cancelled := v_cancelled || v_row.id;
      if coalesce((v_desfecho ->> 'credited')::boolean, false) then
        v_credited := v_credited || v_row.id;
      end if;
      -- `refund_blocked` é TEXTO (a razão) ou NULL — a presença dele é a
      -- resposta, e o `nullif` mata a string vazia por segurança.
      if nullif(btrim(coalesce(v_desfecho ->> 'refund_blocked', '')), '') is not null then
        v_blocked := v_blocked || v_row.id;
      end if;
    elsif p_mode = 'invite_reschedule' then
      -- P5: comunicação em lote com deep link — a aula PERMANECE; nada de
      -- franquia/crédito tocado; quem age é o aluno pelo fluxo normal.
      insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
      select 'period-reschedule-invite', s.profile_id,
             jsonb_build_object(
               'instance_id', v_row.id, 'student_id', s.id,
               'starts_at_utc', v_row.starts_at_utc,
               'local_time_snapshot', v_row.local_time_snapshot,
               'iana_tz', s.iana_tz,
               'teacher_name', (select t.display_name from teachers t where t.id = p_teacher),
               'note', p_note),
             format('period-invite:%s:%s', v_row.id, s.id)
      from (
        select st.id, st.profile_id, st.iana_tz
        from contracts c2
        left join students st on st.id = c2.student_id
        where c2.id = v_row.contract_id and c2.student_id is not null
        union
        select st.id, st.profile_id, st.iana_tz
        from contracts c2
        join student_group_members m on m.group_id = c2.student_group_id
        join students st on st.id = m.student_id
        where c2.id = v_row.contract_id
      ) s
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        v_invited := v_invited || v_row.id;
      end if;
    end if;
  end loop;

  -- fecha a oferta SEMPRE (o período é indisponível de qualquer modo) — e, desde
  -- o A6/f, isso inclui cancelar as janelas publicadas do período.
  v_block := (public.add_teacher_block(p_teacher, p_from, p_to,
    coalesce(p_note, 'tratamento de período'), v_actor) ->> 'exception_id')::uuid;

  perform public.log_audit(v_actor, 'period_treatment', 'teachers', p_teacher::text,
    jsonb_build_object('from', p_from, 'to', p_to, 'mode', p_mode, 'note', p_note,
                       'block_exception', v_block,
                       'cancelled_instances', to_jsonb(v_cancelled),
                       -- ACRESCENTADO (A6/lote 2): QUAIS creditaram e QUAIS
                       -- voltaram bloqueadas. A contagem serve para a frase da
                       -- tela; os ids servem para achar o aluno que ficou sem.
                       'credited_instances', to_jsonb(v_credited),
                       'refund_blocked_instances', to_jsonb(v_blocked),
                       'invited_instances', to_jsonb(v_invited)));

  return jsonb_build_object('block', v_block,
                            'cancelled', coalesce(array_length(v_cancelled, 1), 0),
                            'credited', coalesce(array_length(v_credited, 1), 0),
                            'refund_blocked', coalesce(array_length(v_blocked, 1), 0),
                            'invited', coalesce(array_length(v_invited, 1), 0));
end;
$fn$;

comment on function public.admin_period_treatment(uuid, date, date, text, text, uuid) is
  'Tratamento de período (F5/M1-4). A6/lote 2: devolve '
  '{block, cancelled, credited, refund_blocked, invited} — `cancelled` é quantas '
  'aulas foram canceladas, `credited` quantas geraram crédito de reposição e '
  '`refund_blocked` quantas voltaram sem devolver (aula nascida de crédito '
  'antigo sem identidade). Os uuids de cada grupo ficam no audit_log.';
