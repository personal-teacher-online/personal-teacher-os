-- LOTE c9 — o fechamento ESTRUTURAL dos achados da revisão nº 10 (parte de banco).
--
-- Lei 7: nenhuma migration antiga foi tocada. Cada corpo abaixo é o corpo VIVO
-- (lido do banco com `pg_get_functiondef`) reemitido com o MÍNIMO alterado, e a
-- alteração vem comentada no lugar dela.
--
-- ===========================================================================
-- A ORDEM CANÔNICA GLOBAL DE LOCKS — a lista consolidada (leia antes de mexer)
-- ===========================================================================
--
-- A ordem TOTAL sobre os recursos, definida no c8 e agora observada TAMBÉM pelo
-- materializador (era a última função da família que entrava por fora):
--
--   1. contracts          — FOR UPDATE (todas as linhas juntas, `order by id`).
--   2. class_instances    — FOR UPDATE, `order by id` quando for mais de uma.
--   3. reschedule_windows — FOR UPDATE.
--   4. recurring_slots    — FOR UPDATE, `order by id` quando for mais de uma.
--   5. advisory locks     — `makeup_spend:<contrato>`, `class:<aula>`,
--                           `materialize_slot:<slot>`.
--
-- E, depois de travar: RELER e VALIDAR. Leitura feita ANTES dos locks serve só
-- para descobrir QUEM travar — nunca para decidir.
--
-- AS FUNÇÕES QUE PEDEM MAIS DE UM LOCK DESTA FAMÍLIA, e por onde entram:
--
--   `_cancel_class_core`      1 → 2 → 5(class)
--   `_mark_no_show`           1 → 2
--   `reschedule_class_at`     1 → 2 → 5(makeup_spend)
--   `book_reschedule_window`  1 → 2 → 3 → 5(makeup_spend)
--   `book_computed_slot`      1 → 3 → 5(makeup_spend)
--   `admin_end_contract`      1 (duas linhas, por uuid) → 2 → 5(makeup_spend)
--   `admin_renew_contract`    1 → 2 → 5(makeup_spend)
--   `close_and_create_slot`   1 → 2 → 4 → (create_slot)
--   `create_slot`             1 → (materialize_slot)
--   `resume_contract`         1 → 2 → 4 → 5(makeup_spend) → (materialize_slot)
--   `materialize_slot`        1 → 4 → 5(materialize_slot:<slot>)   ← NOVO (S1)
--   `materialize_instances`   0 → (materialize_slot por slot, contratos por uuid)
--
-- O "0" de `materialize_instances` é o único lock fora da escada, e é uma
-- ISENÇÃO explícita: o advisory global `materialize_instances` é pedido de MÃOS
-- VAZIAS (nenhum lock desta família na mão) e por um único chamador. Um recurso
-- que só é pedido por quem não segura nada não pode fechar ciclo com ninguém —
-- ele é, na prática, o topo da ordem. Já as isenções do c8 (linha criada pela
-- própria transação, família da mentoria, satélites de um contrato) valem tal
-- como escritas lá.
--
-- ===========================================================================
--
-- OS CINCO ACHADOS FECHADOS AQUI
--
-- S1 · MATERIALIZADOR NA ORDEM CANÔNICA. `materialize_slot` pegava o advisory
--      (5º andar) ANTES de qualquer linha e decidia sobre uma leitura sem lock
--      (`join contracts on status = 'active'`): entre essa leitura e o `insert`,
--      um `admin_end_contract`/`pause_contract` podia commitar e a materialização
--      seguia criando aula `scheduled` para contrato encerrado. Passa a entrar
--      pela porta (contrato → slot → advisory) e a RELER status/vigência DEPOIS
--      dos locks. `materialize_instances` deixa de ter loop próprio e delega
--      slot a slot — uma implementação só, e os contratos travados por uuid.
--
-- S2 · POSSE DO HORÁRIO PAUSADO NA FRONTEIRA COMUM. A conferência do c8 (R3)
--      morava em `create_slot`: cobria a porta da frente e deixava abertas a
--      reserva computada, a janela publicada, a avulsa e o próprio materializador.
--      Vira GATILHO `before insert` em `class_instances` (só `scheduled`) —
--      a fronteira por onde TODAS as portas passam — mais uma varredura
--      recorrente de 12 meses no `create_slot`, que é a única porta capaz de
--      criar horário SEM nascer instância nenhuma. Uma implementação
--      (`_assert_no_paused_overlap`), dois chamadores; `_paused_slot_conflict`
--      morre.
--
-- S3 · CONFIRMAÇÃO DE FUSO ATÔMICA. O gatilho do c8 (R5) ligava `tz_confirmed`
--      como EFEITO de gravar cidade OU fuso — então gravar só a cidade (com o
--      fuso ainda do palpite) confirmava, e gravar só o fuso (sem cidade)
--      também. Confirmar vira ATO: a RPC `confirm_student_location` grava os
--      três campos + o flag numa transação só, valida a zona contra
--      `pg_timezone_names` e audita. O gatilho passa a RECUSAR qualquer
--      transição false→true fora dela (sinalizador de transação, o mesmo padrão
--      de `publish_policy_version`).
--
-- S4 · `class_instance_tz` COM DETECÇÃO DE CICLO. Mesma classe do R4 do c8: a
--      recursiva não tinha teto nenhum e uma cadeia de remarcação corrompida
--      (A→B→A, escrita privilegiada ou bug futuro) rodava para sempre. Vira
--      `CYCLE` + erro nomeado.
--
-- S5 · (sem banco) teste comportamental de `lerSlotsPausados`/`lerOcupacao`.
--
-- Leis tocadas: 1 (fuso — S2 compara INSTANTES do dia específico; S3 defende a
-- confirmação da zona), 3 (toda regra nova mora no Postgres: gatilho + RPC), 4
-- (REVOKE/GRANT explícitos nas funções novas), 7 (migration NOVA), 8 (a RPC do
-- S3 audita; o materializador segue auditando conflito pulado).


-- ###########################################################################
-- S2 · A FRONTEIRA COMUM DO HORÁRIO PAUSADO
-- ###########################################################################
--
-- Contrato PAUSADO não tem instância futura (o materializador só cria de
-- contrato ATIVO), então a exclusão GiST da professora
-- (`class_instances_teacher_no_overlap_excl`) não tem o que ver e o horário de
-- quem só está parado aparece livre. O c8 fechou isso no `create_slot`; esta
-- migration move a guarda para onde TODAS as portas passam.
--
-- DOIS MODOS, uma implementação:
--
--   • INSTANTE (`p_starts`/`p_ends` informados) — usado pelo gatilho. Compara a
--     faixa da instância que está nascendo com as ocorrências do horário
--     pausado nos dias vizinhos (±1 dia cobre qualquer offset do planeta, que
--     vai de −12h a +14h). É EXATO e nunca recusa demais: cada aula é julgada
--     pelo próprio instante.
--
--   • RECORRENTE (`p_starts` nulo) — usado pelo `create_slot`. Expande o
--     horário fixo novo ocorrência a ocorrência por 12 MESES de vigência comum
--     e compara com as ocorrências do pausado no mesmo período.
--     POR QUE 12 MESES: dois horários fixos em zonas diferentes podem não
--     colidir hoje e colidir em outubro — cada zona muda de offset no seu
--     próprio calendário (Lisboa vira no último domingo de outubro; Cuiabá não
--     vira nunca), e 10:00 em Lisboa é 06:00 em Cuiabá no verão europeu e 07:00
--     depois da virada. Uma janela de 12 meses contém TODAS as viradas
--     sazonais possíveis das duas zonas (cada uma tem no máximo duas por ano),
--     então o que não colide em 12 meses não colide nunca — enquanto os dois
--     horários forem os mesmos. É caro? É uma varredura por criação de horário
--     fixo (dezenas de linhas), no caminho interativo. Cabe.
--
-- POR QUE O GATILHO NÃO USA O MODO RECORRENTE: se cada instância nascida de um
-- slot carregasse a pergunta "este horário colide ALGUM dia nos próximos 12
-- meses?", uma colisão de outubro apagaria também as aulas de agosto — a
-- retomada de um contrato materializaria ZERO aula por causa de um choque
-- distante. O gatilho julga o instante; a varredura de 12 meses é do
-- `create_slot`, que é onde a resposta certa é "não crie este horário".
--
-- EXCLUSÃO PELO PRÓPRIO SLOT, não pelo contrato: o c8 excluía o contrato
-- inteiro, e por isso um SEGUNDO horário fixo sobreposto ao primeiro, no mesmo
-- contrato pausado, passava batido. Fora o próprio slot de origem, todo o resto
-- disputa — inclusive o irmão do mesmo contrato.

CREATE OR REPLACE FUNCTION public._assert_no_paused_overlap(
  p_teacher uuid,
  p_slot uuid DEFAULT NULL::uuid,
  p_starts timestamptz DEFAULT NULL::timestamptz,
  p_ends timestamptz DEFAULT NULL::timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_origem recurring_slots%rowtype;
  v_de date;
  v_ate date;
  v_hit record;
begin
  if p_teacher is null then
    return;
  end if;

  -- PORTA BARATA: sem contrato pausado com horário fixo NESTA professora não há
  -- o que comparar — e esse é o caso comum (a varredura nem começa).
  if not exists (
    select 1
      from recurring_slots rs
      join contracts c on c.id = rs.contract_id and c.status = 'paused'
     where rs.teacher_id = p_teacher
       and (p_slot is null or rs.id <> p_slot)
  ) then
    return;
  end if;

  if p_slot is not null and p_starts is null then
    select * into v_origem from recurring_slots where id = p_slot;
  end if;

  if v_origem.id is null then
    -- MODO INSTANTE: só os dias vizinhos ao instante que está nascendo.
    if p_starts is null or p_ends is null then
      return;
    end if;
    v_de := (p_starts at time zone 'UTC')::date - 1;
    v_ate := (p_ends at time zone 'UTC')::date + 1;
  else
    -- MODO RECORRENTE: 12 meses de vigência comum, a partir de hoje (ou do
    -- início do horário novo, quando ele começa mais adiante).
    v_de := greatest(v_origem.active_from, public.business_today());
    v_ate := least(coalesce(v_origem.active_to, 'infinity'::date), v_de + 365);
  end if;
  if v_de > v_ate then
    return;
  end if;

  with dias as (
    select g::date as dia
    from generate_series(v_de::timestamp, v_ate::timestamp, interval '1 day') g
  ),
  novo as (
    -- a instância avulsa: a própria faixa, sem expansão nenhuma
    select tstzrange(p_starts, p_ends) as faixa
     where v_origem.id is null
    union all
    -- o horário fixo novo: ocorrência a ocorrência, com o offset DAQUELE dia
    select tstzrange(
             (d.dia + v_origem.local_time) at time zone v_origem.iana_tz,
             ((d.dia + v_origem.local_time) at time zone v_origem.iana_tz)
               + make_interval(mins => v_origem.duration_min))
    from dias d
    where v_origem.id is not null
      and extract(dow from d.dia)::int = v_origem.weekday
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
      and (p_slot is null or rs.id <> p_slot)
      and extract(dow from d.dia)::int = rs.weekday
      and d.dia >= rs.active_from
      and (rs.active_to is null or d.dia <= rs.active_to)
  )
  select p.contract_id, p.quem, p.dia into v_hit
  from pausado p
  join novo n on n.faixa && p.faixa
  order by p.dia
  limit 1;

  if v_hit.contract_id is not null then
    -- O HINT é a etiqueta que o materializador lê para distinguir ESTE choque
    -- (contrato em pausa, mensagem própria) do choque com aula já materializada
    -- (a exclusão GiST). O errcode continua sendo `exclusion_violation`: é a
    -- mesma natureza de recusa, e é o que o PostgREST traduz em 409.
    raise exception
      'a professora tem este horário reservado por um contrato EM PAUSA (%) — primeiro dia de choque: %. Retome ou encerre aquele contrato antes de usar o horário',
      v_hit.quem, to_char(v_hit.dia, 'DD/MM/YYYY')
      using errcode = 'exclusion_violation', hint = 'horario-em-pausa';
  end if;
end;
$function$;

comment on function public._assert_no_paused_overlap(uuid, uuid, timestamptz, timestamptz) is
  'Recusa horário que pertence a um contrato PAUSADO da mesma professora — a '
  'única sobreposição que a exclusão GiST não enxerga (contrato pausado não tem '
  'instância). Modo INSTANTE (gatilho de class_instances) e modo RECORRENTE, 12 '
  'meses (create_slot). Levanta hint = horario-em-pausa (c9 · S2).';

revoke execute on function public._assert_no_paused_overlap(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;


-- O GATILHO — a fronteira comum. Toda instância `scheduled` passa por aqui,
-- venha ela do materializador, da reserva computada, da janela publicada, da
-- remarcação, da avulsa ou de um `insert` direto de correção.

-- SECURITY DEFINER de propósito: `_assert_no_paused_overlap` tem EXECUTE
-- revogado de todo mundo (é helper, não RPC), e gatilho comum roda com o papel
-- de quem escreveu — `authenticated` esbarraria em permissão negada no meio de
-- um insert legítimo. Aqui o definidor só LÊ e recusa; não escreve nada.
CREATE OR REPLACE FUNCTION public.class_instances_horario_em_pausa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Aula cancelada/concluída não disputa horário nenhum (é a mesma régua da
  -- exclusão GiST, que só olha scheduled/completed — e `completed` é passado).
  if new.state <> 'scheduled' then
    return new;
  end if;
  perform public._assert_no_paused_overlap(
    new.teacher_id, new.slot_id, new.starts_at_utc, new.ends_at_utc);
  return new;
end;
$function$;

drop trigger if exists class_instances_horario_em_pausa on class_instances;
create trigger class_instances_horario_em_pausa
  before insert on class_instances
  for each row execute function public.class_instances_horario_em_pausa();

comment on function public.class_instances_horario_em_pausa is
  'Fronteira comum do horário pausado (c9 · S2): nenhuma aula nasce em cima do '
  'horário fixo de um contrato em pausa, por porta nenhuma.';


-- ###########################################################################
-- S1 · O MATERIALIZADOR ENTRA PELA PORTA
-- ###########################################################################
--
-- `materialize_slot` fazia, nesta ordem: advisory → leitura sem lock do slot com
-- `join contracts on c.status = 'active'` → laço de `insert`. Duas coisas
-- erradas de uma vez:
--
--   (a) ORDEM — o advisory (5º andar) vinha antes de tudo, e o contrato (1º) e o
--       slot (4º) não eram travados nunca. Quem chamasse o materializador
--       segurando uma linha e quem chamasse segurando o advisory podiam fechar
--       ciclo;
--   (b) TOCTOU — a decisão "o contrato está ativo" era tomada sobre uma leitura
--       SEM lock. Entre ela e o `insert`, um `admin_end_contract` ou um
--       `pause_contract` commitava e o laço seguia criando aula `scheduled` para
--       contrato encerrado. Aula que ninguém vai dar, na agenda da professora,
--       cobrada no extrato.
--
-- Agora: pré-leitura sem lock só para descobrir o contrato dono → contrato FOR
-- UPDATE → slot FOR UPDATE → advisory → RELEITURA do que vale (status do
-- contrato, vigência do slot) → laço.
--
-- ENCERRADO vs PAUSADO no modo estrito: contrato encerrado (e horário fixo já
-- fechado) é ERRO no caminho interativo — quem pediu o horário precisa saber
-- que ele não existe. PAUSA não é erro: o contrato volta, e criar/ajustar o
-- horário fixo de um contrato parado é gesto legítimo (ele materializa na
-- retomada). Pausa segue em silêncio, como sempre foi.

CREATE OR REPLACE FUNCTION public.materialize_slot(p_slot uuid, p_weeks integer DEFAULT 8, p_strict boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r recurring_slots%rowtype;
  v_contract contracts%rowtype;
  v_contract_id uuid;
  v_hoje date;
  v_date date;
  v_end_date date;
  v_starts timestamptz;
  v_created int := 0;
  v_hint text;
begin
  -- (0) PRÉ-LEITURA SEM LOCK: descobre QUEM travar. Nada aqui decide.
  select rs.contract_id into v_contract_id from recurring_slots rs where rs.id = p_slot;
  if not found then
    if p_strict then
      raise exception 'horário fixo % não existe', p_slot;
    end if;
    return 0;
  end if;

  -- (1) contrato · (4) horário fixo · (5) advisory — a ordem canônica.
  select * into v_contract from contracts where id = v_contract_id for update;
  if not found then
    if p_strict then
      raise exception 'contrato % não existe', v_contract_id;
    end if;
    return 0;
  end if;
  select * into r from recurring_slots where id = p_slot for update;
  if not found then
    -- apagado entre a pré-leitura e o lock
    if p_strict then
      raise exception 'horário fixo % não existe', p_slot;
    end if;
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('materialize_slot:' || p_slot::text, 0));

  -- RELEITURA DEPOIS DOS LOCKS — é ESTE estado que decide.
  if v_contract.status <> 'active' then
    if p_strict and v_contract.status = 'ended' then
      raise exception
        'o contrato foi encerrado — nenhuma aula foi criada para este horário fixo';
    end if;
    return 0;
  end if;

  v_hoje := (now() at time zone r.iana_tz)::date;
  if r.active_to is not null and r.active_to < v_hoje then
    if p_strict then
      raise exception
        'o horário fixo foi fechado em % — nenhuma aula foi criada',
        to_char(r.active_to, 'DD/MM/YYYY');
    end if;
    return 0;
  end if;

  v_date := v_hoje;
  v_end_date := v_date + (p_weeks * 7);
  v_date := v_date + ((r.weekday - extract(dow from v_date)::int + 7) % 7);

  while v_date <= v_end_date loop
    if v_date >= r.active_from and (r.active_to is null or v_date <= r.active_to) then
      v_starts := (v_date + r.local_time) at time zone r.iana_tz;
      if v_starts > now() then
        begin
          insert into class_instances
            (contract_id, teacher_id, slot_id, occurrence_date,
             starts_at_utc, ends_at_utc, local_time_snapshot)
          values
            (r.contract_id, r.teacher_id, r.id, v_date,
             v_starts, v_starts + make_interval(mins => r.duration_min),
             to_char(v_date, 'YYYY-MM-DD') || ' ' || to_char(r.local_time, 'HH24:MI') || ' ' || r.iana_tz)
          on conflict (slot_id, occurrence_date) where slot_id is not null
          do nothing;
          if found then
            v_created := v_created + 1;
          end if;
        exception
          when exclusion_violation or unique_violation then
            -- S2: o choque com contrato EM PAUSA tem mensagem própria, e no
            -- caminho interativo é ELA que a dona precisa ler — `raise` sem
            -- argumento reemite a exceção original, intacta.
            get stacked diagnostics v_hint = pg_exception_hint;
            if p_strict and v_hint = 'horario-em-pausa' then
              raise;
            end if;
            -- E3a: no caminho INTERATIVO o conflito é fatal e nomeado — quem
            -- pediu o horário precisa saber que ele não existe, e a transação
            -- inteira reverte (nada de slot criado com semanas faltando).
            if p_strict then
              raise exception
                'a professora já tem aula em % às % (%) — o horário fixo NÃO foi criado',
                to_char(v_date, 'DD/MM/YYYY'), to_char(r.local_time, 'HH24:MI'), r.iana_tz
                using errcode = 'exclusion_violation';
            end if;
            -- Caminho em MASSA (cron, retomada de pausa, backfill): pula ESTA
            -- ocorrência, segue o lote, e deixa o problema visível (Lei 8).
            raise warning 'conflito de agenda ao materializar slot % em %: %', r.id, v_date, sqlerrm;
            insert into audit_log (action, entity, entity_id, diff)
            values ('materialize_conflict', 'recurring_slots', r.id::text,
                    jsonb_build_object('occurrence_date', v_date, 'error', sqlerrm));
        end;
      end if;
    end if;
    v_date := v_date + 7;
  end loop;

  return v_created;
end;
$function$;

comment on function public.materialize_slot(uuid, integer, boolean) is
  'Materializa as próximas semanas de UM horário fixo. Entra pela ordem '
  'canônica (contrato → slot → advisory) e RELÊ status/vigência depois dos '
  'locks: contrato encerrado ou horário fechado não geram aula nenhuma — em '
  'silêncio no modo tolerante, com erro no estrito (c9 · S1).';


-- `materialize_instances`: o laço próprio morre. A regra de materializar um
-- horário fixo passa a existir num lugar só (`materialize_slot`), e com ela vem
-- de graça a ordem canônica e a releitura pós-lock.
--
-- CONTRATOS POR UUID: a única outra função que trava DUAS linhas de `contracts`
-- (`admin_end_contract` com transferência) as pede `order by id`. O lote aqui
-- trava N linhas, então ordena pelo mesmo critério — ordem total, sem ciclo.
--
-- O PREÇO, dito na cara: o lote acumula `FOR UPDATE` das linhas dos contratos
-- ativos até o fim da transação, e enquanto ele roda uma RPC que toque o mesmo
-- contrato espera. Na escala-alvo (50 contratos × 8 semanas) isso é dezenas de
-- milissegundos, uma vez por dia, e é o preço honesto de não materializar sobre
-- estado que outra transação já mudou.

CREATE OR REPLACE FUNCTION public.materialize_instances(p_weeks integer DEFAULT 8)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  v_created int := 0;
begin
  -- Uma materialização por vez (liberado no fim da transação). Pedido de MÃOS
  -- VAZIAS — ver a isenção documentada no topo desta migration.
  perform pg_advisory_xact_lock(hashtextextended('materialize_instances', 0));

  for r in
    select rs.id
    from recurring_slots rs
    join contracts c on c.id = rs.contract_id
    where c.status = 'active'
    order by c.id, rs.id
  loop
    v_created := v_created + public.materialize_slot(r.id, p_weeks, false);
  end loop;

  return v_created;
end;
$function$;

comment on function public.materialize_instances(integer) is
  'O lote diário: delega slot a slot para materialize_slot (uma implementação '
  'só) travando os contratos em ordem de uuid (c9 · S1).';


-- `create_slot`: a conferência do horário pausado passa a ser a MESMA do
-- gatilho — modo recorrente, 12 meses. Ela continua vindo antes da
-- materialização por um motivo prático: esta é a única porta capaz de criar
-- horário fixo SEM nascer instância nenhuma (contrato pausado, vigência que só
-- começa mês que vem, oito semanas todas no passado). Sem ela, o gatilho não
-- teria em que pegar.

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
begin
  if public.app_role() <> 'admin' then
    raise exception 'create_slot é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- c8 · R1: a linha do contrato é o 1º andar da ordem canônica.
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

  insert into recurring_slots
    (contract_id, teacher_id, weekday, local_time, iana_tz, duration_min, active_from)
  values
    (p_contract, v_contract.teacher_id, p_weekday, p_local_time, v_tz, p_duration_min, p_active_from)
  returning id into v_id;

  -- ALTERADO (c9 · S2): a guarda do horário pausado é a do gatilho, em modo
  -- RECORRENTE (12 meses) e excluindo só o slot recém-criado — o irmão do mesmo
  -- contrato pausado disputa como qualquer outro. A transação inteira reverte,
  -- então o `insert` acima não deixa rastro.
  perform public._assert_no_paused_overlap(v_contract.teacher_id, v_id);

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


-- A função do c8 morre: quem faz a conferência agora é `_assert_no_paused_overlap`,
-- com um chamador a mais e nenhuma regra duplicada.
drop function if exists public._paused_slot_conflict(uuid, integer, time without time zone, text, integer, date, uuid, integer);


-- `resume_contract`: o conjunto de horários fixos travado (4º andar) passa a ser
-- LITERALMENTE o mesmo que a materialização percorre — antes eram duas consultas
-- com o mesmo filtro, e bastava alguém mexer numa delas para o materializador
-- pedir, lá dentro, um lock de linha que a transação ainda não tinha (isto é:
-- lock de 4º andar depois do advisory de 5º que a extensão de crédito já pegou).
-- Com a lista fixada em array, o `materialize_slot` só reencontra locks que esta
-- transação já segura.

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
  v_slot_ids uuid[] := array[]::uuid[];
  v_slot uuid;
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

  -- c8 · R1: andares 2 e 4 ANTES de qualquer advisory (o da extensão de crédito
  -- mora dentro de `_reissue_credit`; o da materialização, dentro de
  -- `materialize_slot`).
  perform 1 from class_instances
   where contract_id = p_contract and state = 'scheduled'
     and (starts_at_utc at time zone public.business_tz())::date >= v_pause.paused_on
     and (starts_at_utc at time zone public.business_tz())::date < p_today
   order by id
     for update;
  -- ALTERADO (c9 · S1): trava e GUARDA a lista — a materialização lá embaixo
  -- percorre exatamente estes ids.
  select coalesce(array_agg(id order by id), array[]::uuid[]) into v_slot_ids
  from (
    select id from recurring_slots
     where contract_id = p_contract and (active_to is null or active_to >= p_today)
     order by id
       for update
  ) travados;

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

  foreach v_slot in array v_slot_ids loop
    v_materialized := v_materialized + public.materialize_slot(v_slot, 8);
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
-- S3 · CONFIRMAR O FUSO É UM ATO, NÃO UM EFEITO
-- ###########################################################################
--
-- O gatilho do c8 ligava `tz_confirmed` quando a cidade OU o fuso mudavam na
-- mesma escrita. Duas frestas:
--
--   • gravar SÓ a cidade (o fuso continua o palpite herdado da escola) marcava
--     como confirmado um aluno cujo relógio ninguém olhou;
--   • gravar SÓ o fuso (sem cidade) idem — e a mensagem do gate diz, com todas
--     as letras, "o cadastro nasceu sem cidade".
--
-- Confirmar passa a ser um ATO com nome, gate, validação e auditoria:
-- `confirm_student_location(aluno, cidade, país, zona)` grava os três campos e o
-- flag na MESMA transação. O gatilho vira porteiro: recusa qualquer transição
-- false→true que não venha de lá. O mecanismo é o sinalizador de transação já
-- usado em `publish_policy_version` (`set_config(..., true)` = escopo da
-- transação, baixado logo depois do `update` para que um `update` solto mais
-- adiante na MESMA transação continue barrado).
--
-- DESLIGAR continua livre: é assim que se marca um cadastro para revisão.

CREATE OR REPLACE FUNCTION public.students_confirm_tz()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- ALTERADO (c9 · S3): o gatilho NUNCA liga o flag — só recusa quem tenta
  -- ligá-lo por fora da RPC. Gravar cidade/fuso por `update` de tabela deixa de
  -- confirmar: escrever o dado e atestar que ele foi conferido são atos
  -- diferentes, e só o segundo destrava contrato e horário fixo.
  if new.tz_confirmed and not old.tz_confirmed
     and coalesce(current_setting('ptos.confirm_tz', true), '0') <> '1' then
    raise exception
      'tz_confirmed não se liga sozinho (%): confirmar o fuso é ato — chame confirm_student_location(aluno, cidade, país, zona), que grava os quatro campos junto',
      new.display_name;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_student_location(
  p_student uuid,
  p_city text,
  p_country text,
  p_iana_tz text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_city    text := nullif(btrim(coalesce(p_city, '')), '');
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  v_tz      text := nullif(btrim(coalesce(p_iana_tz, '')), '');
  v_antes   students%rowtype;
begin
  if public.app_role() <> 'admin' then
    raise exception 'confirm_student_location é restrita à admin (D10)';
  end if;
  if v_city is null then
    raise exception 'a confirmação do fuso exige a CIDADE do aluno — é ela que sustenta a zona';
  end if;
  if v_tz is null then
    raise exception 'a confirmação do fuso exige a zona IANA do aluno';
  end if;
  -- Lei 1: zona inventada nunca vira aula em horário errado. O gatilho
  -- `students_valid_tz` também confere; aqui a recusa vem com nome antes de
  -- qualquer escrita.
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'zona IANA inválida: % — use o nome do banco de fusos (ex.: America/Cuiaba)', v_tz;
  end if;

  select * into v_antes from students where id = p_student for update;
  if not found then
    raise exception 'aluno % não existe', p_student;
  end if;

  perform set_config('ptos.confirm_tz', '1', true);
  update students
     set city = v_city,
         country = coalesce(v_country, country),
         iana_tz = v_tz,
         tz_confirmed = true
   where id = p_student;
  -- baixa o sinalizador na hora: um `update students set tz_confirmed = true`
  -- mais adiante na MESMA transação continua barrado.
  perform set_config('ptos.confirm_tz', '0', true);

  perform public.log_audit(auth.uid(), 'confirm_student_location', 'students', p_student::text,
    jsonb_build_object(
      'de', jsonb_build_object('city', v_antes.city, 'country', v_antes.country,
                               'iana_tz', v_antes.iana_tz, 'tz_confirmed', v_antes.tz_confirmed),
      'para', jsonb_build_object('city', v_city, 'country', coalesce(v_country, v_antes.country),
                                 'iana_tz', v_tz, 'tz_confirmed', true)));
end;
$function$;

comment on function public.confirm_student_location(uuid, text, text, text) is
  'ÚNICO caminho de confirmação do fuso do aluno (c9 · S3): grava cidade, país e '
  'zona IANA + tz_confirmed numa transação só, valida a zona contra '
  'pg_timezone_names e audita. O gatilho students_confirm_tz recusa qualquer '
  'outra ligação do flag.';

revoke execute on function public.confirm_student_location(uuid, text, text, text) from public, anon;
grant execute on function public.confirm_student_location(uuid, text, text, text) to authenticated;


-- ###########################################################################
-- S4 · `class_instance_tz` COM DETECÇÃO DE CICLO
-- ###########################################################################
--
-- Mesma classe do R4 do c8, no outro lado do mesmo grafo: a cadeia de
-- remarcações era percorrida por uma recursiva SEM teto e SEM detecção de
-- ciclo. Cadeia honesta nunca fecha ciclo (`reschedule_of` aponta sempre para
-- uma aula anterior), mas "nunca" aqui é uma promessa de dado, não uma garantia
-- de constraint — e o preço de quebrá-la era o servidor girando até o timeout,
-- dentro de uma função STABLE chamada por tela.
--
-- `CYCLE` (Postgres 14+; aqui 17.6) guarda o caminho de `id` já visitado, para
-- de expandir quando um se repete e devolve a marca — que aqui vira erro
-- nomeado, não silêncio. A função deixa de ser `language sql` por isso: para
-- poder RECUSAR.

CREATE OR REPLACE FUNCTION public.class_instance_tz(p_instance uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ciclo boolean;
  v_do_slot text;
begin
  with recursive chain as (
    select ci.id, ci.slot_id, ci.reschedule_of
      from class_instances ci where ci.id = p_instance
    union all
    select ci.id, ci.slot_id, ci.reschedule_of
      from class_instances ci join chain on chain.reschedule_of = ci.id
  ) cycle id set eh_ciclo using caminho
  select bool_or(ch.eh_ciclo),
         -- `min()` no lugar do `limit 1` de antes: a cadeia tem no máximo um
         -- slot (a aula original), e determinismo é de graça.
         min(rs.iana_tz)
    into v_ciclo, v_do_slot
    from chain ch
    left join recurring_slots rs on rs.id = ch.slot_id;

  if coalesce(v_ciclo, false) then
    raise exception
      'cadeia de remarcação corrompida na aula % — uma remarcação aponta para si mesma (ciclo em reschedule_of); corrija o vínculo antes de ler o fuso',
      p_instance;
  end if;

  return coalesce(
    v_do_slot,
    (select s.iana_tz
       from class_instances i
       join contracts c on c.id = i.contract_id
       join students s on s.id = c.student_id
      where i.id = p_instance),
    -- Contrato de GRUPO (student_id NULL — ADR-002): instância de resgate D12 não tem
    -- slot nem cadeia; a zona vem dos membros (mesmo domicílio; min() = determinístico).
    (select min(s.iana_tz)
       from class_instances i
       join contracts c on c.id = i.contract_id
       join student_group_members m on m.group_id = c.student_group_id
       join students s on s.id = m.student_id
      where i.id = p_instance));
end;
$function$;

comment on function public.class_instance_tz(uuid) is
  'A zona IANA de uma aula: o slot da cadeia de remarcações, senão o aluno, '
  'senão os membros da turma. Cadeia com ciclo falha NOMEADA em vez de girar '
  'até o timeout (c9 · S4).';
