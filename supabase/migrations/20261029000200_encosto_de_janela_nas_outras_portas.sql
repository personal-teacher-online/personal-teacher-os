-- =============================================================================
-- Onda Agenda e Mensagens · M2, issue #85 (29/10/2026) — a régua do encosto
-- da migration 20261029000100 nas OUTRAS portas da agenda.
--
-- Horário de reposição publicado é oferta real: nenhum ato da agenda pode
-- deixá-lo sem como ser reservado (goal da onda, M2: "despublique antes"; Lei
-- 3). A 20261029000100 fechou isso na porta da professora que remarca a
-- própria aula e criou a medida da janela (`teacher_window_span_min`: maior
-- slot vigente, maior aula futura). O revisor-adversarial e o gate Sol daquela
-- PR apontaram as duas portas que sobravam:
--
-- 1. `publish_reschedule_window` só recusava quando o COMEÇO da janela caía
--    dentro de uma aula. Aula 10:30–11:15 e janela publicada às 10:00 passava,
--    e a reserva de 45 min batia no índice de exclusão. Agora a janela é medida
--    (a mesma medida, nunca menos que a aula que cruza) e qualquer aula
--    `scheduled` dela que cruze o intervalo recusa, nomeando a aula. A ordem
--    inversa (remarcar primeiro, publicar depois) cai na mesma recusa: a
--    publicação lê as aulas sob o advisory `teacher_agenda`, depois de quem
--    remarcou ter commitado. Assinatura INTOCADA (a do A6).
--
-- 2. `book_computed_slot` só reaproveitava janela no MESMO instante; o aluno
--    que remarcava pela grade calculada podia pegar 10:30 ao lado da janela das
--    10:00. Agora o destino que encosta em janela publicada dela (que não seja
--    a do mesmo instante, que ele consome) é recusado, com a mesma medida.
--    A opção de a reserva CONSUMIR a janela vizinha (em vez de recusar) não foi
--    tomada: a issue a condiciona a decisão do dono.
--    De quebra (gate Sol da PR #91), a ordem dentro dela muda:
--      · posse ANTES de travar a agenda e de ler janelas: o aluno que não é do
--        contrato, ou o contrato que não é da professora pedida, é recusado
--        antes de pegar `teacher_agenda` de outra professora e antes de a
--        recusa de encosto revelar o horário de uma janela que ele não enxerga;
--      · a janela NOVA (a materializada) nasce DEPOIS do advisory
--        `teacher_agenda`. Antes ela nascia antes, e o par com a publicação no
--        MESMO instante fechava ciclo: a reserva segurava a chave do índice
--        único `reschedule_windows_teacher_slot_uniq` (linha não commitada) e
--        esperava o advisory; a publicação segurava o advisory e esperava a
--        chave (40P01). Isso existia desde o A6 (20260730000100: o advisory em
--        `book_reschedule_window` e em `publish_reschedule_window`), não nasceu
--        aqui. Com o insert sob o advisory, quem publica e quem materializa
--        a janela no mesmo instante se serializam; a janela que apareceu
--        enquanto a reserva esperava é recusada com frase ("acabou de ser
--        publicado"), porque travar a linha dela DEPOIS do advisory inverteria
--        3º × 5º andar contra `book_reschedule_window`.
--    5º andar na sub-ordem do adendo do c10: `makeup_spend` (agora também na
--    remarcação; é reentrante e `book_reschedule_window` o pede logo depois)
--    ANTES de `teacher_agenda`.
--
-- 3. O "remarcar para horário novo" da administração publicava uma janela e a
--    consumia em seguida, em DUAS chamadas. Com a régua do item 1 ele passaria
--    a se recusar contra a PRÓPRIA aula que está movendo (adiantar 30 min), e
--    o estado entre as duas chamadas era uma oferta publicada que podia ficar
--    órfã. Vira uma RPC só, `admin_reschedule_to_new_time`: valida, cria (ou
--    reaproveita) a janela, move a aula pela porta de sempre
--    (`book_reschedule_window`) e audita, na MESMA transação. A aula movida
--    não conta como encosto, a janela vale a duração dela, e o destino passa
--    pela recusa de encosto em janela do item 2 (é a reserva da grade calculada
--    do admin).
--
-- A medida precisa ser lida também quando quem chama é o ALUNO (item 2), e a
-- porta pública `teacher_window_span_min` recusa aluno (D10). O cálculo vai
-- para `_teacher_window_span_min`, interna e fechada ao logado; a porta
-- pública passa a chamá-la, com a MESMA checagem de quem lê.
--
-- Fora daqui (issues próprias): janela ao lado de OUTRA janela publicada, e os
-- outros escritores de `class_instances` (avulsa, experimental, materialização
-- do horário fixo), que não conferem janela publicada.
--
-- DEPLOY: esta migration sobe ANTES do app e o app logo em seguida. O app novo
-- chama `admin_reschedule_to_new_time`, que só existe depois dela.
--
-- Lei 7: tudo aqui é recriação em arquivo novo. Lei 1: a medida continua lendo
-- a vigência do slot na data civil do fuso dele. Lei 8: o remarcar para
-- horário novo ganha o próprio registro em `audit_log`, além dos de sempre.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A medida da janela, interna (sem checagem de quem chama: só as RPCs a
--    chamam, de dentro de SECURITY DEFINER). Corpo idêntico ao de
--    20261029000100.
-- -----------------------------------------------------------------------------
create or replace function public._teacher_window_span_min(p_teacher uuid) returns int
language plpgsql
stable
set search_path = public, pg_temp
as $fn$
declare
  v_slots int;
  v_aulas int;
begin
  -- Vigência do slot na data CIVIL do fuso dele (Lei 1).
  select max(rs.duration_min) into v_slots
    from recurring_slots rs
   where rs.teacher_id = p_teacher
     and rs.active_from <= (now() at time zone rs.iana_tz)::date
     and (rs.active_to is null or rs.active_to >= (now() at time zone rs.iana_tz)::date);

  select ceil(extract(epoch from max(ci.ends_at_utc - ci.starts_at_utc)) / 60)::int into v_aulas
    from class_instances ci
   where ci.teacher_id = p_teacher
     and ci.state = 'scheduled'
     and ci.starts_at_utc > now();

  return nullif(greatest(coalesce(v_slots, 0), coalesce(v_aulas, 0)), 0);
end;
$fn$;
revoke execute on function public._teacher_window_span_min(uuid) from public, anon, authenticated;
comment on function public._teacher_window_span_min(uuid) is
  'Interna: a medida (min) de um horário de reposição publicado da professora (maior slot vigente '
  'na data civil do fuso do slot; maior aula futura marcada). NULL sem slot nem aula. Sem checagem '
  'de quem chama: lida pelas RPCs da agenda e pela porta pública teacher_window_span_min.';

-- -----------------------------------------------------------------------------
-- 2. A porta pública da medida: a mesma checagem de 20261029000100; o cálculo
--    vem da interna.
-- -----------------------------------------------------------------------------
create or replace function public.teacher_window_span_min(p_teacher uuid) returns int
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if auth.uid() is not null then
    if public.app_role() = 'teacher' then
      if p_teacher is distinct from public.my_teacher_id() then
        raise exception 'só a própria professora ou a administração lê essa medida (D10)';
      end if;
    elsif coalesce(public.app_role(), '') <> 'admin' then
      raise exception 'só a própria professora ou a administração lê essa medida (D10)';
    end if;
  end if;
  -- ALTERADO (issue #85): o cálculo mora na interna, que a reserva do aluno
  -- também lê.
  return public._teacher_window_span_min(p_teacher);
end;
$fn$;
revoke execute on function public.teacher_window_span_min(uuid) from public, anon;
grant execute on function public.teacher_window_span_min(uuid) to authenticated, service_role;
comment on function public.teacher_window_span_min(uuid) is
  'Medida (min) de um horário de reposição publicado da professora: a maior duração que pode '
  'consumi-lo (maior slot vigente na data civil do fuso do slot; maior aula futura marcada). '
  'NULL sem slot nem aula. Lida pelas telas que antecipam as recusas de encosto; as RPCs leem '
  'a interna _teacher_window_span_min.';


-- -----------------------------------------------------------------------------
-- 3. publish_reschedule_window: a janela MEDIDA contra as aulas. Reemissão do
--    corpo vivo (20260730000100_a6_travas_de_agenda.sql), mesma assinatura; o
--    que muda vem marcado ALTERADO/NOVO.
-- -----------------------------------------------------------------------------
create or replace function public.publish_reschedule_window(
  p_teacher uuid,
  p_starts_at_utc timestamptz,
  p_iana_tz text default null,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_role text := public.app_role();
  v_teacher_tz text;
  v_tz text;
  v_starts timestamptz;
  v_local timestamp;
  v_block text;
  v_clash timestamptz;
  v_id uuid;
  v_actor uuid;
  -- NOVO (issue #85)
  v_span interval;
begin
  if v_role = 'teacher' then
    if p_teacher is distinct from public.my_teacher_id() then
      raise exception 'professora só publica janela PARA SI (F3-D6)';
    end if;
    if p_iana_tz is not null then
      raise exception 'fuso da professora vem de teachers.iana_tz — não informe p_iana_tz (F3-D6)';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'publish_reschedule_window é restrita a admin/professora (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  if p_starts_at_utc is null then
    raise exception 'informe o instante do horário a publicar (p_starts_at_utc)';
  end if;

  select t.iana_tz into v_teacher_tz from teachers t where t.id = p_teacher;
  if not found then
    raise exception 'professora % não existe', p_teacher;
  end if;

  v_tz := coalesce(p_iana_tz, v_teacher_tz);
  v_starts := p_starts_at_utc;
  v_local := v_starts at time zone v_tz;
  if v_starts <= now() then
    raise exception 'janela % (%) já passou', v_local, v_tz;
  end if;

  -- O advisory da agenda da professora abre a região crítica (A6): as leituras
  -- abaixo e o `insert` da janela viram um ato só em relação às outras portas
  -- que escrevem na agenda dela. Nenhuma linha dos andares 1–4 é travada aqui.
  perform pg_advisory_xact_lock(
    hashtextextended('teacher_agenda:' || p_teacher::text, 0));

  select e.local_snapshot into v_block
  from teacher_availability_exceptions e
  where e.teacher_id = p_teacher
    and e.kind = 'block'
    and e.starts_at_utc <= v_starts
    and e.ends_at_utc > v_starts
  order by e.starts_at_utc, e.id
  limit 1;
  if v_block is not null then
    raise exception 'esse horário está dentro de um bloqueio da professora (%) — remova o bloqueio antes de publicar', v_block;
  end if;

  -- ALTERADO (issue #85): antes só a aula que CONTINHA o começo da janela
  -- recusava. Agora a janela é um intervalo: [início, início + medida), com a
  -- medida da agenda dela (20261029000100) e nunca menos que a aula que cruza
  -- (a aula em andamento não entra na medida, que só vê aula futura).
  v_span := make_interval(mins => coalesce(public._teacher_window_span_min(p_teacher), 0));
  select ci.starts_at_utc into v_clash
  from class_instances ci
  where ci.teacher_id = p_teacher
    and ci.state = 'scheduled'
    and ci.ends_at_utc > v_starts
    and ci.starts_at_utc < v_starts + greatest(v_span, ci.ends_at_utc - ci.starts_at_utc)
  order by ci.starts_at_utc, ci.id
  limit 1;
  if v_clash is not null then
    raise exception 'esse horário encosta na aula marcada da professora de % — nenhum aluno conseguiria reservar essa janela; escolha outro horário',
      to_char(v_clash at time zone v_tz, 'YYYY-MM-DD HH24:MI') || ' ' || v_tz;
  end if;

  insert into reschedule_windows
    (teacher_id, local_date, local_time, iana_tz, starts_at_utc, local_time_snapshot, created_by)
  values
    (p_teacher, v_local::date, v_local::time, v_tz, v_starts,
     to_char(v_local, 'YYYY-MM-DD HH24:MI') || ' ' || v_tz,
     v_actor)
  returning id into v_id;

  perform public.log_audit(v_actor, 'publish_reschedule_window', 'reschedule_windows', v_id::text,
    jsonb_build_object('teacher_id', p_teacher, 'starts_at_utc', v_starts, 'iana_tz', v_tz));
  return v_id;
end;
$fn$;

comment on function public.publish_reschedule_window(uuid, timestamptz, text, uuid) is
  'A6/a: recebe o INSTANTE; local_date/local_time/local_time_snapshot são derivados da zona de '
  'quem publica (Lei 1). Recusa horário dentro de bloqueio e janela cujo intervalo medido '
  '(_teacher_window_span_min, nunca menos que a aula que cruza) encoste em aula agendada dela '
  '(issue #85).';

revoke execute on function public.publish_reschedule_window(uuid, timestamptz, text, uuid)
from public, anon, authenticated;
grant execute on function public.publish_reschedule_window(uuid, timestamptz, text, uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- 4. book_computed_slot: posse antes da agenda, janela nova sob o advisory, e
--    o destino que encosta em janela publicada. Corpo vivo de
--    20260727000700_ordem_global_de_locks.sql; assinatura intocada.
-- -----------------------------------------------------------------------------
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
  -- NOVO (issue #85)
  v_contract_teacher uuid;
  v_dur_exata interval;
  v_win_dur interval;
  v_win_local text;
begin
  if (p_instance is null) = (p_contract is null) then
    raise exception 'informe a aula a remarcar (p_instance) OU o contrato do resgate (p_contract)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  select coalesce(t.iana_tz, public.business_tz()) into v_tz from teachers t where t.id = p_teacher;
  if v_tz is null then
    raise exception 'professora % não existe', p_teacher;
  end if;

  -- 1º andar (contrato) e 2º andar (instância), sempre.
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

  -- NOVO (gate Sol da PR #91): a posse ANTES de travar a agenda e de ler as
  -- janelas — as MESMAS duas recusas que book_reschedule_window faz adiante
  -- (D10 e D1), com o mesmo texto. Sem isto, o aluno de outra professora
  -- pegava `teacher_agenda` dela e a recusa de encosto lhe mostrava o horário
  -- de uma janela que ele não enxerga.
  if public.app_role() <> 'admin'
     and v_contract_id not in (select public.my_contract_ids()) then
    raise exception 'você não tem acesso a este contrato (D10)';
  end if;
  select c.teacher_id into v_contract_teacher from contracts c where c.id = v_contract_id;
  if v_contract_teacher is distinct from p_teacher then
    raise exception 'o horário pedido é de outra professora (D1)';
  end if;

  -- 3º andar: reaproveita janela publicada no MESMO instante (união sem
  -- duplicata). ALTERADO (gate Sol da PR #91): se não houver, a janela nova só
  -- nasce DEPOIS do advisory da agenda (ver o `insert` abaixo).
  select w.id into v_win from reschedule_windows w
  where w.teacher_id = p_teacher and w.starts_at_utc = p_starts_at_utc and w.state = 'publicada'
  for update;

  -- duração REAL (F1/M1-5): remarcação herda da aula; resgate usa o crédito da vez
  if p_instance is not null then
    select round(extract(epoch from (ci.ends_at_utc - ci.starts_at_utc)) / 60)::int,
           ci.ends_at_utc - ci.starts_at_utc
      into v_dur, v_dur_exata
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
    v_dur_exata := make_interval(mins => v_dur);
  end if;

  -- NOVO (issue #85): 5º andar na sub-ordem do adendo do c10 — `makeup_spend`
  -- do contrato (reentrante: o resgate já o tem, e book_reschedule_window o
  -- pede adiante) ANTES de `teacher_agenda`. Daqui para baixo, publicar e
  -- reservar na agenda dela não se cruzam.
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || v_contract_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('teacher_agenda:' || p_teacher::text, 0));

  -- ALTERADO (gate Sol da PR #91): a janela materializada nasce aqui, sob o
  -- advisory. Se uma janela do mesmo instante foi publicada enquanto esta
  -- reserva esperava, ela é recusada com frase: travar aquela linha agora
  -- (3º andar depois do 5º) fecharia ciclo com book_reschedule_window.
  if v_win is null then
    if exists (select 1 from reschedule_windows w
                where w.teacher_id = p_teacher and w.starts_at_utc = p_starts_at_utc
                  and w.state = 'publicada') then
      raise exception 'esse horário acabou de ser publicado para reposição — escolha de novo na lista';
    end if;
    v_local := p_starts_at_utc at time zone v_tz;
    insert into reschedule_windows
      (teacher_id, local_date, local_time, iana_tz, starts_at_utc, local_time_snapshot, created_by)
    values
      (p_teacher, v_local::date, v_local::time, v_tz, p_starts_at_utc,
       to_char(v_local, 'YYYY-MM-DD HH24:MI') || ' ' || v_tz, v_actor)
    returning id into v_win;
  end if;

  -- NOVO (issue #85): o destino que ENCOSTA em horário de reposição publicado
  -- dela é recusado — reservar ao lado deixaria a janela sem como ser
  -- reservada. A janela é medida como em 20261029000100: a maior duração da
  -- agenda dela, nunca menos que a aula que vai nascer; a do mesmo instante é
  -- a que esta reserva consome (v_win), e janela já passada não gera aula.
  v_win_dur := greatest(v_dur_exata,
                        make_interval(mins => coalesce(public._teacher_window_span_min(p_teacher), 0)));
  select w.local_time_snapshot into v_win_local
    from reschedule_windows w
   where w.teacher_id = p_teacher and w.state = 'publicada'
     and w.id <> v_win
     and w.starts_at_utc > now()
     and w.starts_at_utc < p_starts_at_utc + v_dur_exata
     and w.starts_at_utc > p_starts_at_utc - v_win_dur
   order by w.starts_at_utc
   limit 1;
  if v_win_local is not null then
    raise exception 'esse horário encosta num horário de reposição já publicado pela professora (%) — escolha outro', v_win_local;
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

comment on function public.book_computed_slot(uuid, timestamptz, uuid, uuid, uuid, boolean, text, boolean, boolean) is
  'Reserva um horário calculado (remarcação ou resgate de crédito). Ordem de locks: contrato → '
  'instância → janela do mesmo instante → advisory ''makeup_spend:<contrato>'' → '
  '''teacher_agenda:<professora>'' → janela materializada. Posse conferida antes da agenda. '
  'Issue #85: recusa destino que encoste em outra janela publicada da professora, medida por '
  '_teacher_window_span_min (nunca menos que a aula).';
revoke execute on function
  public.book_computed_slot(uuid, timestamptz, uuid, uuid, uuid, boolean, text, boolean, boolean)
from public, anon;
grant execute on function
  public.book_computed_slot(uuid, timestamptz, uuid, uuid, uuid, boolean, text, boolean, boolean)
to authenticated;

-- -----------------------------------------------------------------------------
-- 5. admin_reschedule_to_new_time: o "remarcar para horário novo" da
--    administração numa transação só (item 3 do cabeçalho). Mesma ordem de
--    locks de book_computed_slot; a aula é movida por book_reschedule_window,
--    que confere antecedência, bloqueio, alçada e audita como sempre.
-- -----------------------------------------------------------------------------
create or replace function public.admin_reschedule_to_new_time(
  p_instance uuid,
  p_starts_at_utc timestamptz,
  p_iana_tz text default null,
  p_courtesy boolean default false,
  p_courtesy_note text default null,
  p_bypass_lead boolean default false
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
    v_win, p_instance, null, auth.uid(), p_courtesy, p_courtesy_note, p_bypass_lead);

  perform public.log_audit(auth.uid(), 'admin_reschedule_to_new_time', 'class_instances', v_new::text,
    jsonb_build_object(
      'rescheduled_from', p_instance, 'teacher_id', v_teacher, 'window', v_win,
      'starts_at_utc', p_starts_at_utc, 'iana_tz', v_tz,
      'courtesy', p_courtesy, 'bypass_lead', p_bypass_lead));
  return v_new;
end;
$fn$;
revoke execute on function public.admin_reschedule_to_new_time(uuid, timestamptz, text, boolean, text, boolean)
from public, anon;
grant execute on function public.admin_reschedule_to_new_time(uuid, timestamptz, text, boolean, text, boolean)
to authenticated;
comment on function public.admin_reschedule_to_new_time(uuid, timestamptz, text, boolean, text, boolean) is
  'Issue #85: o "remarcar para horário novo" da administração numa transação só — cria (ou '
  'reaproveita) a janela do instante, move a aula por book_reschedule_window e audita. A aula '
  'movida não conta como encosto; o destino não pode encostar em outra janela publicada.';
