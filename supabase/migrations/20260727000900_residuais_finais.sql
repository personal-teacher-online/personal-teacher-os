-- LOTE c10 — os RESIDUAIS da revisão nº 11 (parte de banco). O último lote
-- antes do deploy.
--
-- Lei 7: nenhuma migration antiga foi tocada. Cada corpo abaixo é o corpo VIVO
-- (lido do banco com `pg_get_functiondef`) reemitido com o MÍNIMO alterado, e a
-- alteração vem comentada no lugar dela.
--
-- ===========================================================================
-- ADENDO À ORDEM CANÔNICA GLOBAL DE LOCKS (o cabeçalho da 20260727000700 e o
-- da 20260727000800 continuam valendo; isto é uma linha nova no 5º andar)
-- ===========================================================================
--
-- O 5º andar ganha um recurso: o advisory `teacher_agenda:<professora>`.
--
--   1. contracts          — FOR UPDATE (todas as linhas juntas, `order by id`).
--   2. class_instances    — FOR UPDATE, `order by id` quando for mais de uma.
--   3. reschedule_windows — FOR UPDATE.
--   4. recurring_slots    — FOR UPDATE, `order by id` quando for mais de uma.
--   5. advisory locks     — `makeup_spend:<contrato>`, `class:<aula>`,
--                           `teacher_agenda:<professora>`  ← NOVO (T2),
--                           `materialize_slot:<slot>`.
--
-- A SUB-ORDEM DENTRO DO 5º ANDAR, agora que ele tem quatro recursos:
--
--     makeup_spend → class → teacher_agenda → materialize_slot
--
-- e ela é observada por construção: quem gasta crédito pega `makeup_spend`
-- antes de inserir a aula (e é o `insert` que pede `teacher_agenda`, pelo
-- gatilho); quem materializa pede `materialize_slot:<slot>` antes de inserir, o
-- que inverte o par teacher_agenda/materialize_slot. Essa inversão NÃO fecha
-- ciclo, e o motivo é estrutural: `materialize_slot:<S>` só é pedido por quem
-- (a) acabou de CRIAR o slot S nesta transação — linha invisível para qualquer
-- outra sessão (`create_slot`) — ou (b) já segura a linha de S com FOR UPDATE
-- (`resume_contract`, o lote diário). Nos dois casos não há uma segunda
-- transação capaz de estar do outro lado do par.
--
-- A REGRA QUE SUSTENTA O ANDAR 5 INTEIRO, e que esta migration passa a
-- respeitar também no lote diário:
--
--     NENHUMA transação pede linha de `contracts`/`recurring_slots` DEPOIS de
--     ter na mão um `teacher_agenda`.
--
-- `materialize_instances` era a única que quebrava isso: o laço reiniciava a
-- escada a cada slot (linha do contrato → advisory → `insert` → advisory da
-- professora → próxima linha de contrato). Com uma professora só e dois
-- contratos, o lote das 4h e uma pausa clicada no mesmo instante fechavam ciclo
-- de verdade. Agora o lote trava TODAS as linhas do lote ANTES do laço — o
-- preço já declarado no c9 (`FOR UPDATE` dos contratos ativos até o fim da
-- transação), pago de uma vez e em ordem determinística.
--
-- ===========================================================================
--
-- OS ITENS FECHADOS AQUI
--
-- T1 · CADASTRO NÃO NASCE CONFIRMADO. O `insert` de `students` das actions ia
--      sem `tz_confirmed` e pegava o default `true`: se a RPC de confirmação
--      falhasse na linha seguinte, ficava um aluno CONFIRMADO sem nenhum ato de
--      confirmação auditado. Agora as actions gravam `false` explícito e a
--      confirmação vem só da RPC. `admin_create_lead`, que insere direto (a RPC
--      exige aluno existente), passa a ser o EQUIVALENTE ATÔMICO dela: confirma
--      apenas com cidade + zona válida e audita com o MESMO nome de ação.
--
-- T2 · PAUSA × RESERVA SERIALIZADAS (ver o adendo acima).
--
-- T3 · O GATILHO DO HORÁRIO PAUSADO TAMBÉM EM UPDATE. Ele nascia `before
--      insert`: um `update` que movesse uma aula para cima do horário de um
--      contrato em pausa passava pela fronteira sem ser visto.
--
-- T4 · DONO DO HORÁRIO FIXO É IMUTÁVEL. Trocar `recurring_slots.contract_id`
--      deixaria as aulas já materializadas apontando para o contrato antigo.
--      Gatilho recusa; `materialize_slot` aborta se a releitura vir dono
--      diferente (cinto duplo barato).
--
-- T5 · EDIÇÃO SEM ESTADO INCONSISTENTE. Trocar o fuso por fora da RPC DERRUBA
--      `tz_confirmed`: zona nova sem cidade auditada é palpite de novo.
--
-- T6 · (sem banco) teste comportamental de `lerOcupacao`.
--
-- Leis tocadas: 1 (fuso — T5 protege a confirmação da zona), 3 (regra nova mora
-- no Postgres: gatilhos + advisory), 4 (REVOKE/GRANT explícitos), 7 (migration
-- NOVA), 8 (a confirmação dentro de `admin_create_lead` audita).


-- ###########################################################################
-- T2 · O ADVISORY DA PROFESSORA — pausa e reserva mutuamente serializadas
-- ###########################################################################
--
-- O buraco: `pause_contract` ESCREVE `status = 'paused'` e o gatilho do horário
-- pausado LÊ esse mesmo status. Entre a leitura de uma transação e o commit da
-- outra não havia recurso em comum — a linha do contrato pausado é lida sem
-- lock pelo gatilho (ele varre TODOS os contratos pausados da professora, não
-- um), e a exclusão GiST não vê nada porque contrato pausado não tem instância.
-- Resultado: pausar às 14h00,000 e reservar às 14h00,001 um horário FORA do
-- horizonte materializado passavam os dois, e a pausa voltava para uma agenda
-- que já tinha sido dada a outra pessoa.
--
-- O recurso em comum passa a ser um advisory por PROFESSORA. Ele é grosso de
-- propósito: a pergunta do gatilho não é sobre um contrato, é sobre a agenda
-- inteira daquela professora ("existe algum contrato pausado dela cujo horário
-- bate com este instante?"), então o que precisa ser serializado é a agenda
-- dela. Na escala-alvo (5 professoras) isso é uma fila por professora em
-- operações que já são raras; a alternativa (lock por linha) não cobre o
-- contrato pausado que ainda vai ser pausado.

CREATE OR REPLACE FUNCTION public._assert_no_paused_overlap(
  p_teacher uuid,
  p_slot uuid DEFAULT NULL::uuid,
  p_starts timestamptz DEFAULT NULL::timestamptz,
  p_ends timestamptz DEFAULT NULL::timestamptz)
 RETURNS void
 -- ALTERADO (c10 · T2): era STABLE. A função passa a PEDIR LOCK, e lock é
 -- efeito — declarar VOLATILE é dizer a verdade sobre ela.
 LANGUAGE plpgsql
 VOLATILE
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

  -- NOVO (c10 · T2): 5º andar da ordem canônica, ANTES de qualquer leitura de
  -- status. Daqui até o fim da transação, nenhuma pausa desta professora entra
  -- — e nenhuma aula dela nasce enquanto uma pausa estiver a meio caminho.
  -- Vem antes da PORTA BARATA de propósito: é justamente o "não existe contrato
  -- pausado" que a pausa concorrente está prestes a tornar falso.
  perform pg_advisory_xact_lock(hashtextextended('teacher_agenda:' || p_teacher::text, 0));

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
  'meses (create_slot). Pede o advisory `teacher_agenda:<professora>` antes de '
  'ler status: pausa e reserva ficam mutuamente serializadas (c9 · S2 + c10 · T2).';

revoke execute on function public._assert_no_paused_overlap(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;


-- ###########################################################################
-- T3 · O GATILHO NA FRONTEIRA TAMBÉM VÊ O `UPDATE`
-- ###########################################################################
--
-- `before insert` cobria toda porta que CRIA aula. Faltava a que MOVE: um
-- `update class_instances set starts_at_utc = …` (correção manual, script de
-- ajuste, RPC futura) atravessava a fronteira sem ser visto.
--
-- `UPDATE OF <colunas>` em vez de `UPDATE` seco para não pagar a varredura em
-- toda escrita de coluna irrelevante (`google_event_id`, `confirmed_at`,
-- `content_report_id`): o gatilho só dispara quando o que mudou é POSSE DE
-- HORÁRIO — professora, horário fixo, instante, ou o estado que decide se a
-- aula ocupa a agenda.

CREATE OR REPLACE FUNCTION public.class_instances_horario_em_pausa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Aula cancelada/concluída não disputa horário nenhum (é a mesma régua da
  -- exclusão GiST, que só olha scheduled/completed — e `completed` é passado).
  -- Vale igual no UPDATE: cancelar uma aula em cima de horário pausado é
  -- justamente o gesto que LIBERA o horário.
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
  -- ALTERADO (c10 · T3): era `before insert`.
  before insert or update of teacher_id, slot_id, starts_at_utc, ends_at_utc, state
  on class_instances
  for each row execute function public.class_instances_horario_em_pausa();

comment on function public.class_instances_horario_em_pausa is
  'Fronteira comum do horário pausado (c9 · S2, estendida no c10 · T3): nenhuma '
  'aula NASCE nem SE MOVE para cima do horário fixo de um contrato em pausa, '
  'por porta nenhuma.';


-- ###########################################################################
-- T2 (parte 2) · `pause_contract` entra pelo mesmo recurso
-- ###########################################################################
--
-- O advisory vem DEPOIS da linha do contrato (5º andar, como manda a ordem) e
-- ANTES do `update` que muda o status — é esse intervalo que precisa ser
-- indivisível para quem lê o status do outro lado.

CREATE OR REPLACE FUNCTION public.pause_contract(p_contract uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- NOVO (c10 · T2): 5º andar. Enquanto esta transação não commitar, nenhuma
  -- aula desta professora nasce sem enxergar a pausa; e se uma inserção chegou
  -- primeiro, é ESTA que espera — e o horário já terá dono quando a pausa
  -- voltar a olhar. Contrato de mentoria pode não ter professora: aí não há
  -- agenda a serializar.
  if v_contract.teacher_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('teacher_agenda:' || v_contract.teacher_id::text, 0));
  end if;

  update contracts set status = 'paused' where id = p_contract;
  insert into contract_pauses (contract_id, created_by) values (p_contract, v_actor)
  returning id into v_id;

  perform public.log_audit(v_actor, 'pause_contract', 'contracts', p_contract::text,
    jsonb_build_object('pause_id', v_id));
  return v_id;
end;
$function$;

comment on function public.pause_contract(uuid, uuid) is
  'Pausa o contrato (F3-D10). Pede o advisory `teacher_agenda:<professora>` '
  'antes de escrever o status: a pausa e qualquer aula nova da mesma professora '
  'ficam mutuamente serializadas (c10 · T2).';


-- ###########################################################################
-- T2 (parte 3) · o lote diário trava TUDO antes do laço
-- ###########################################################################
--
-- Ver o adendo do cabeçalho: é isto que sustenta "ninguém pede linha depois de
-- ter `teacher_agenda` na mão". A lista travada é a MESMA que o laço percorre
-- (mesmo padrão do `resume_contract` desde o c9): sem isso, um horário fixo
-- criado e commitado entre as duas consultas entraria no laço sem ter sido
-- travado, e o laço voltaria a pedir linha com advisory na mão.

CREATE OR REPLACE FUNCTION public.materialize_instances(p_weeks integer DEFAULT 8)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_slot_ids uuid[] := array[]::uuid[];
  v_slot uuid;
  v_created int := 0;
begin
  -- Uma materialização por vez (liberado no fim da transação). Pedido de MÃOS
  -- VAZIAS — ver a isenção documentada no topo da 20260727000800.
  perform pg_advisory_xact_lock(hashtextextended('materialize_instances', 0));

  -- ALTERADO (c10 · T2): andares 1 e 4 do lote INTEIRO, numa consulta só, antes
  -- de qualquer advisory de professora. `order by c.id, rs.id` mantém a ordem
  -- total (contrato antes dos horários fixos dele, ambos por uuid) — a mesma
  -- que `admin_end_contract`, `resume_contract` e `close_and_create_slot` usam.
  select coalesce(array_agg(travados.sid), array[]::uuid[]) into v_slot_ids
  from (
    select rs.id as sid
      from recurring_slots rs
      join contracts c on c.id = rs.contract_id
     where c.status = 'active'
     order by c.id, rs.id
       for update of c, rs
  ) travados;

  foreach v_slot in array v_slot_ids loop
    v_created := v_created + public.materialize_slot(v_slot, p_weeks, false);
  end loop;

  return v_created;
end;
$function$;

comment on function public.materialize_instances(integer) is
  'O lote diário: trava contratos ativos e horários fixos deles de uma vez (por '
  'uuid) e delega slot a slot para materialize_slot — nenhuma linha é pedida '
  'depois do primeiro advisory de professora (c9 · S1 + c10 · T2).';


-- ###########################################################################
-- T4 · O DONO DE UM HORÁRIO FIXO NÃO MUDA
-- ###########################################################################
--
-- `recurring_slots.contract_id` é a raiz de tudo o que pende do horário: as
-- `class_instances` já materializadas guardam o `contract_id` COPIADO no
-- momento em que nasceram. Mover o slot para outro contrato deixaria as aulas
-- passadas e futuras apontando para o contrato antigo — extrato, créditos e
-- histórico de um aluno pendurados no contrato de outro. Não existe caminho
-- legítimo para isso: o gesto certo é FECHAR o horário (`active_to`, via
-- `close_and_create_slot`) e criar outro no contrato certo.

create or replace function public.recurring_slots_dono_imutavel()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.contract_id is distinct from old.contract_id then
    raise exception
      'o horário fixo não muda de contrato (% → %): as aulas já materializadas continuariam no contrato antigo. Feche este horário e crie outro no contrato certo',
      old.contract_id, new.contract_id;
  end if;
  return new;
end;
$fn$;

comment on function public.recurring_slots_dono_imutavel is
  'Dono do horário fixo é imutável (c10 · T4): trocar o contrato quebraria o '
  'vínculo das instâncias já materializadas.';

revoke execute on function public.recurring_slots_dono_imutavel()
  from public, anon, authenticated, service_role;

drop trigger if exists recurring_slots_dono_imutavel on recurring_slots;
create trigger recurring_slots_dono_imutavel
  before update of contract_id on recurring_slots
  for each row execute function public.recurring_slots_dono_imutavel();


-- `materialize_slot`: o cinto duplo. O gatilho acima já torna a troca de dono
-- impossível; a releitura aqui custa uma comparação e transforma qualquer
-- caminho futuro que escape do gatilho (escrita privilegiada, `alter table …
-- disable trigger`) em erro nomeado, em vez de aulas nascendo no contrato
-- errado com o `teacher_id` do outro.

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
  -- NOVO (c10 · T4): o contrato travado tem de ser o dono do slot travado. Se
  -- não for, a decisão desta chamada foi tomada sobre o contrato errado —
  -- ABORTA sempre (inclusive no modo tolerante: aula no contrato errado é pior
  -- do que ocorrência faltando).
  if r.contract_id is distinct from v_contract_id then
    raise exception
      'o horário fixo % trocou de contrato entre a pré-leitura (%) e o lock (%) — nada foi materializado',
      p_slot, v_contract_id, r.contract_id;
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
  'canônica (contrato → slot → advisory), confere que o contrato travado ainda '
  'é o dono do slot (c10 · T4) e RELÊ status/vigência depois dos locks: '
  'contrato encerrado ou horário fechado não geram aula nenhuma — em silêncio '
  'no modo tolerante, com erro no estrito (c9 · S1).';


-- ###########################################################################
-- T5 · FUSO NOVO POR FORA DA RPC DERRUBA A CONFIRMAÇÃO
-- ###########################################################################
--
-- O c9 fez `tz_confirmed` só LIGAR pela RPC. Sobrou o outro lado: com o flag já
-- ligado, um `update students set iana_tz = …` (a edição da ficha quando a
-- cidade não veio, um ajuste manual) trocava a zona e DEIXAVA o flag ligado —
-- ou seja, a ficha continuava dizendo "esta zona foi conferida" sobre uma zona
-- que ninguém conferiu. Contrato e horário fixo passavam a ser criados sobre um
-- palpite com selo de fato.
--
-- Agora: zona nova por fora do ato de confirmação = palpite de novo. A ficha
-- volta a exibir "a confirmar" e a guarda `_require_confirmed_tz` volta a
-- segurar contrato/horário até alguém completar a cidade. Não é regressão de
-- UX: é o estado honesto, e o conserto é um clique no CityPicker.
--
-- DENTRO da RPC nada disso vale — lá o sinalizador de transação está de pé, e a
-- zona nova É o ato de confirmação.

CREATE OR REPLACE FUNCTION public.students_confirm_tz()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pela_rpc boolean := coalesce(current_setting('ptos.confirm_tz', true), '0') = '1';
begin
  -- c9 · S3: o gatilho NUNCA liga o flag — só recusa quem tenta ligá-lo por
  -- fora da RPC. Gravar cidade/fuso por `update` de tabela deixa de confirmar:
  -- escrever o dado e atestar que ele foi conferido são atos diferentes, e só o
  -- segundo destrava contrato e horário fixo.
  if new.tz_confirmed and not old.tz_confirmed and not v_pela_rpc then
    raise exception
      'tz_confirmed não se liga sozinho (%): confirmar o fuso é ato — chame confirm_student_location(aluno, cidade, país, zona), que grava os quatro campos junto',
      new.display_name;
  end if;

  -- NOVO (c10 · T5): e o inverso — trocar a ZONA por fora do ato DESFAZ a
  -- confirmação. Zona sem cidade auditada é palpite, tenha ou não sido fato
  -- cinco minutos atrás.
  if new.iana_tz is distinct from old.iana_tz and not v_pela_rpc then
    new.tz_confirmed := false;
  end if;

  return new;
end;
$function$;

comment on function public.students_confirm_tz is
  'Porteiro de `tz_confirmed` (c9 · S3 + c10 · T5): ligar só pela RPC '
  '`confirm_student_location`; trocar a zona por fora dela DERRUBA o flag. '
  'Desligar continua livre (é assim que se marca um cadastro para revisão).';


-- ###########################################################################
-- T1 · O LEAD COM CIDADE: O EQUIVALENTE ATÔMICO DA RPC
-- ###########################################################################
--
-- As actions do app (`createStudentAction`, `wizardStudentAction`) passam a
-- inserir com `tz_confirmed = false` EXPLÍCITO e confirmar na sequência pela
-- RPC — se a RPC falhar, sobra um aluno honestamente não-confirmado (e o
-- contrato fica barrado pela guarda até alguém completar a cidade).
--
-- `admin_create_lead` não pode fazer o mesmo: a RPC exige aluno EXISTENTE, e
-- aqui o aluno está nascendo. Então esta função passa a ser o equivalente
-- atômico dela — mesma exigência (cidade E zona, zona validada contra
-- `pg_timezone_names`) e AUDITORIA PRÓPRIA com o MESMO nome de ação
-- (`confirm_student_location`), na mesma transação do `insert`. Quem auditar
-- "quem confirmou o fuso deste aluno?" encontra o mesmo registro, venha ele da
-- RPC ou do nascimento do lead.
--
-- O QUE MUDOU DE COMPORTAMENTO: antes bastava a ZONA para nascer confirmado
-- (`v_informado is not null`). Cidade sem zona, ou zona sem cidade, agora
-- nascem PALPITE — a mesma régua do c9 · S3, que existe porque é a cidade que
-- sustenta a zona.

create or replace function public.admin_create_lead(
  p_name text,
  p_iana_tz text default null,
  p_city text default null,
  p_country text default null,
  p_referral_source text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_id      uuid;
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_informado text := nullif(btrim(coalesce(p_iana_tz, '')), '');
  v_tz      text := coalesce(v_informado, public.business_tz());
  v_city    text := nullif(btrim(coalesce(p_city, '')), '');
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  v_origem  text := nullif(btrim(coalesce(p_referral_source, '')), '');
  v_confirma boolean;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_create_lead é restrita à admin (D10)';
  end if;
  if v_name is null then
    raise exception 'o nome do lead é obrigatório';
  end if;

  -- ALTERADO (c10 · T1): confirmar exige CIDADE + ZONA, e a zona é validada
  -- aqui com nome próprio (o gatilho `students_valid_tz` também confere, mas
  -- depois — e a mensagem dele não diz que a confirmação é o que está em jogo).
  v_confirma := v_city is not null and v_informado is not null;
  if v_confirma and not exists (select 1 from pg_timezone_names where name = v_informado) then
    raise exception 'zona IANA inválida: % — use o nome do banco de fusos (ex.: America/Cuiaba)', v_informado;
  end if;

  -- O trigger `students_valid_tz` (20260711000200) confere a zona IANA: fuso
  -- inventado recusa aqui, não vira aula em horário errado depois.
  --
  -- P6: quando o fuso veio do CityPicker ele é FATO; quando caiu no fuso do
  -- negócio por falta de cidade é PALPITE, e a ficha passa a dizer isso em vez
  -- de deixá-lo endurecer em horário de aula.
  insert into students (display_name, iana_tz, city, country, referral_source, status,
                        tz_confirmed)
  values (v_name, v_tz, v_city, v_country, v_origem, 'lead',
          v_confirma)
  returning id into v_id;

  perform public.log_audit(auth.uid(), 'admin_create_lead', 'students', v_id::text,
    jsonb_build_object('display_name', v_name, 'iana_tz', v_tz, 'city', v_city,
                       'country', v_country, 'referral_source', v_origem,
                       'status', 'lead', 'tz_confirmed', v_confirma));

  -- NOVO (c10 · T1): o ATO de confirmação, auditado com o mesmo nome da RPC —
  -- é o que torna esta função o equivalente atômico dela (Lei 8).
  if v_confirma then
    perform public.log_audit(auth.uid(), 'confirm_student_location', 'students', v_id::text,
      jsonb_build_object(
        'de', jsonb_build_object('city', null, 'country', null,
                                 'iana_tz', null, 'tz_confirmed', false),
        'para', jsonb_build_object('city', v_city, 'country', v_country,
                                   'iana_tz', v_tz, 'tz_confirmed', true),
        'via', 'admin_create_lead'));
  end if;

  return v_id;
end;
$fn$;

comment on function public.admin_create_lead is
  'Fase 1 do ciclo de vida: cria o cadastro mínimo de um LEAD (status ''lead'', '
  'sem contrato, sem convite). Gate admin + auditoria na transação. Confirma o '
  'fuso (equivalente atômico de confirm_student_location, com auditoria de mesmo '
  'nome) SÓ quando vêm cidade E zona válida; caso contrário o fuso do negócio '
  'entra como PALPITE e trava contrato/horário até alguém completar o cadastro '
  '(revisão nº 8, P6 + c10 · T1).';

revoke execute on function public.admin_create_lead(text, text, text, text, text)
  from public, anon;
grant execute on function public.admin_create_lead(text, text, text, text, text)
  to authenticated;
