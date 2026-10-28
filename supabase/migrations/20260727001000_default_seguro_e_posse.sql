-- ###########################################################################
-- LOTE c11 — as três correções da revisão adversarial nº 12
-- ###########################################################################
--
-- U1 · DEFAULT SEGURO. A coluna `students.tz_confirmed` nasceu com `default
--      true` (c7 · P6) por um motivo que era verdadeiro para as LINHAS QUE JÁ
--      EXISTIAM — elas foram cadastradas com cidade de verdade — e falso para o
--      DEFAULT: default só se aplica a linha NOVA. Trocar o default para
--      `false` não toca uma única ficha antiga (`alter column … set default`
--      não reescreve a tabela); só muda o que acontece com quem esquecer de
--      dizer. E o que acontece passa a ser a resposta segura: a ficha nasce
--      "a confirmar" e a guarda `_require_confirmed_tz` segura contrato e
--      horário fixo até alguém completar a cidade.
--
--      As duas actions e `admin_create_lead` já gravam o flag explícito (c10 ·
--      T1). Sobrava `admin_create_trial_class`, que inseria sem a coluna e
--      pegava o default — a única porta que ainda fabricava confirmação. Ela é
--      reemitida aqui com `false` EXPLÍCITO: a RPC recebe a zona, mas não
--      recebe a CIDADE, e é a cidade que sustenta a zona (c10 · T1). Sem
--      cidade não há ato de confirmação a auditar — logo não há confirmação.
--      O contrato experimental é isento da guarda de propósito (c7 · P6), o
--      que mantém o funil andando: experimental primeiro, cadastro completo
--      depois — e a ficha diz "a confirmar" até lá, que é a verdade.
--
-- U2 · POSSE SIMÉTRICA NA PAUSA. O c9/c10 fechou um lado: nenhuma aula NASCE
--      em cima do horário fixo de um contrato em pausa. O outro lado estava
--      aberto: pausar um contrato RESERVA o horário fixo dele para sempre
--      (é o que `_assert_no_paused_overlap` passa a impor), e nada conferia se
--      aquele horário já tinha dono — uma aula avulsa de OUTRO contrato da
--      mesma professora, marcada além do horizonte materializado (onde a
--      exclusão GiST não tem instância a comparar) ou em cima de uma ocorrência
--      que foi cancelada e liberou o espaço. A pausa passava, e a retomada
--      encontrava a agenda dada para duas pessoas.
--      Agora `pause_contract` recusa, sob o MESMO advisory `teacher_agenda`
--      que já segura o outro lado — as duas ordens concorrentes ficam
--      serializadas pelo mesmo recurso, e exatamente uma passa.
--
-- U3 · GARANTIA ESTRUTURAL SLOT × CONTRATO. `class_instances.contract_id` é
--      uma CÓPIA do dono do slot no momento em que a aula nasceu. O c10 · T4
--      protegeu isso com gatilho + releitura; falta a garantia que não depende
--      de gatilho nenhum: `unique (id, contract_id)` em `recurring_slots` mais
--      FK COMPOSTA `(slot_id, contract_id)`. Com ela, o par "aula ↔ horário
--      fixo" só existe se os dois concordarem sobre o contrato — inclusive
--      quando alguém desliga o gatilho pelo nome. Ver a justificativa da
--      escolha (FK × validação no materializador) na seção U3 lá embaixo.
--
-- Leis tocadas: 1 (fuso — U1 impede zona-palpite com selo de fato), 3 (a regra
-- nova mora no Postgres: constraint + função), 7 (migration NOVA), 8 (nada de
-- confirmação sem ato auditado).


-- ###########################################################################
-- U1 · O DEFAULT PASSA A SER A RESPOSTA SEGURA
-- ###########################################################################

alter table students alter column tz_confirmed set default false;

comment on column students.tz_confirmed is
  'O fuso desta ficha é FATO (true) ou PALPITE (false)? Vira true SÓ pelo ato '
  '`confirm_student_location` (ou pelo equivalente atômico dentro de '
  '`admin_create_lead`), sempre com auditoria de mesmo nome; trocar a zona por '
  'fora do ato derruba o flag (c10 · T5). DEFAULT `false` desde o c11 · U1: '
  'quem esquecer de dizer recebe a resposta segura. Contrato e horário fixo '
  'NÃO-experimentais são recusados enquanto for false (`_require_confirmed_tz`).';

-- A pessoa da aula experimental nasce A CONFIRMAR — explícito, não por default.
--
-- Reemissão do corpo VIVO (o de 20260718000400) com uma linha a mais no
-- `insert` de `students`. Nada mais muda: mesma assinatura, mesmos gates, mesma
-- auditoria.
--
-- Por que não confirmar aqui, já que a zona vem no parâmetro: porque confirmar
-- é atestar que alguém CONFERIU de onde a pessoa fala, e o que sustenta a zona
-- é a cidade (c10 · T1). Esta RPC não recebe cidade — a tela manda nome, zona e
-- horário. Se um dia ela passar a receber cidade, o caminho já está escrito em
-- `admin_create_lead`: confirmar só com cidade + zona válida e auditar com o
-- nome `confirm_student_location`, na mesma transação.
create or replace function public.admin_create_trial_class(
  p_student_name text,
  p_iana_tz text,
  p_teacher uuid,
  p_local_date date,
  p_local_time time,
  p_duration_min int,
  p_price_cents int default null,
  p_actor uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor uuid;
  v_student uuid;
  v_contract uuid;
  v_starts timestamptz;
  v_new_id uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_create_trial_class é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);
  if btrim(coalesce(p_student_name, '')) = '' then
    raise exception 'nome da pessoa é obrigatório';
  end if;
  if p_duration_min is null or p_duration_min <= 0 then
    raise exception 'duração inválida (%)', p_duration_min;
  end if;
  if not exists (select 1 from teachers t where t.id = p_teacher and t.archived_at is null) then
    raise exception 'professora % não existe ou está arquivada', p_teacher;
  end if;

  v_starts := (p_local_date + p_local_time) at time zone p_iana_tz;
  if v_starts <= now() then
    raise exception 'a aula experimental precisa ser no futuro (% em %)', v_starts, p_iana_tz;
  end if;

  -- ALTERADO (c11 · U1): `tz_confirmed` EXPLÍCITO. Sem cidade não há
  -- confirmação; a ficha nasce dizendo "a confirmar", e o contrato de verdade
  -- (o não-experimental) só sai depois que alguém completar o cadastro.
  insert into students (display_name, iana_tz, tz_confirmed)
  values (btrim(p_student_name), p_iana_tz, false)
  returning id into v_student;

  insert into contracts
    (contract_type, student_id, teacher_id, plan_name, hourly_rate_cents,
     monthly_reschedule_allowance, min_notice_hours, makeup_credit_expiry_days,
     started_on, is_trial)
  values
    ('private_1on1', v_student, p_teacher, 'Aula experimental',
     coalesce(p_price_cents, 0), 0, 24, 90, p_local_date, true)
  returning id into v_contract;

  begin
    insert into class_instances
      (contract_id, teacher_id, slot_id, occurrence_date, starts_at_utc, ends_at_utc,
       local_time_snapshot, state, single_kind, single_price_cents)
    values
      (v_contract, p_teacher, null, p_local_date, v_starts,
       v_starts + make_interval(mins => p_duration_min),
       to_char(p_local_date, 'YYYY-MM-DD') || ' ' || to_char(p_local_time, 'HH24:MI') || ' ' || p_iana_tz,
       'scheduled', 'trial', p_price_cents)
    returning id into v_new_id;
  exception when exclusion_violation or unique_violation then
    raise exception 'conflito de agenda: a professora já tem compromisso nesse horário';
  end;

  perform public.log_audit(v_actor, 'admin_create_trial_class', 'class_instances', v_new_id::text,
    jsonb_build_object('student_id', v_student, 'contract_id', v_contract,
                       'teacher_id', p_teacher, 'price_cents', p_price_cents,
                       'starts_at_utc', v_starts, 'duration_min', p_duration_min,
                       'iana_tz', p_iana_tz, 'tz_confirmed', false));
  return v_new_id;
end;
$fn$;

comment on function public.admin_create_trial_class(text, text, uuid, date, time, int, int, uuid) is
  'Experimental num ato só: pessoa nova + contrato leve (is_trial) + aula. A '
  'pessoa nasce com `tz_confirmed = false` EXPLÍCITO (c11 · U1) — a RPC recebe '
  'a zona, não a cidade, e é a cidade que sustenta a zona. O contrato '
  'experimental é isento da guarda de fuso de propósito (c7 · P6).';

revoke execute on function public.admin_create_trial_class(text, text, uuid, date, time, int, int, uuid)
  from public, anon;
grant execute on function public.admin_create_trial_class(text, text, uuid, date, time, int, int, uuid)
  to authenticated;


-- ###########################################################################
-- U2 · A PAUSA TAMBÉM PRECISA ENCONTRAR O HORÁRIO LIVRE
-- ###########################################################################
--
-- A matemática é a MESMA da fronteira do horário pausado (`_assert_no_paused_
-- overlap`, modo recorrente): ocorrência a ocorrência, com o offset DAQUELE dia
-- (Lei 1), 12 meses de vigência comum a partir de hoje, comparadas por
-- `tstzrange` — nunca por igualdade de hora local, que erra na semana em que só
-- um dos lados troca de horário de verão.
--
-- O que muda é o lado contrário: em vez de perguntar "este instante novo bate
-- com o horário de alguém em pausa?", pergunta "o horário que esta pausa vai
-- congelar já tem aula de OUTRO contrato desta professora?".
--
-- Só `scheduled` e só FUTURO: aula concluída é passado (não disputa nada), e
-- cancelada/remarcada é justamente o gesto que LIBERA o horário — a mesma régua
-- da exclusão GiST e do gatilho da fronteira.
--
-- Leitura sem lock de linha depois do advisory: é o mesmo que
-- `_assert_no_paused_overlap` já faz (ela varre `recurring_slots`/`contracts`
-- com o advisory na mão). A ordem canônica proíbe pedir LINHA — `for update` —
-- depois do 5º andar; `select` simples não pede nada e não fecha ciclo.

create or replace function public._assert_no_scheduled_overlap(
  p_contract uuid,
  p_teacher uuid
) returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_hit record;
begin
  if p_teacher is null or p_contract is null then
    return;
  end if;

  -- PORTA BARATA: contrato sem horário fixo não congela agenda nenhuma — e esse
  -- é o caso comum (mentoria, contrato só de avulsas).
  if not exists (select 1 from recurring_slots rs where rs.contract_id = p_contract) then
    return;
  end if;

  with slots as (
    select rs.id,
           rs.weekday,
           rs.local_time,
           rs.iana_tz,
           rs.duration_min,
           greatest(rs.active_from, public.business_today()) as de,
           least(coalesce(rs.active_to, 'infinity'::date),
                 greatest(rs.active_from, public.business_today()) + 365) as ate
      from recurring_slots rs
     where rs.contract_id = p_contract
  ),
  ocorrencias as (
    select s.iana_tz,
           tstzrange(
             (g.dia::date + s.local_time) at time zone s.iana_tz,
             ((g.dia::date + s.local_time) at time zone s.iana_tz)
               + make_interval(mins => s.duration_min)) as faixa
      from slots s
      cross join lateral generate_series(s.de::timestamp, s.ate::timestamp, interval '1 day') as g(dia)
     where s.de <= s.ate
       and extract(dow from g.dia)::int = s.weekday
  )
  select ci.starts_at_utc,
         o.iana_tz,
         coalesce(st.display_name, 'contrato ' || left(ci.contract_id::text, 8)) as quem
    into v_hit
    from ocorrencias o
    join class_instances ci
      on ci.teacher_id = p_teacher
     and ci.contract_id <> p_contract
     and ci.state = 'scheduled'
     and ci.starts_at_utc > now()
     and tstzrange(ci.starts_at_utc, ci.ends_at_utc) && o.faixa
    left join contracts c on c.id = ci.contract_id
    left join students st on st.id = c.student_id
   order by ci.starts_at_utc
   limit 1;

  if v_hit.starts_at_utc is not null then
    raise exception
      'este horário fixo já tem aula marcada de outro contrato da mesma professora (% em %) — pausar aqui congelaria um horário que não está livre. Cancele ou remarque aquela aula primeiro',
      v_hit.quem,
      to_char(v_hit.starts_at_utc at time zone v_hit.iana_tz, 'DD/MM/YYYY às HH24:MI')
      using errcode = 'exclusion_violation', hint = 'pausa-em-horario-ocupado';
  end if;
end;
$fn$;

comment on function public._assert_no_scheduled_overlap(uuid, uuid) is
  'O simétrico de `_assert_no_paused_overlap` (c11 · U2): recusa a pausa quando '
  'os horários fixos do contrato colidem com aulas `scheduled` FUTURAS de OUTROS '
  'contratos da mesma professora — as que a exclusão GiST não vê porque estão '
  'além do horizonte materializado. Mesma expansão ocorrência a ocorrência, '
  'mesmo tstzrange.';

revoke execute on function public._assert_no_scheduled_overlap(uuid, uuid)
  from public, anon, authenticated, service_role;

-- `pause_contract`: reemissão do corpo vivo (20260727000900) com a conferência
-- nova entre o advisory e o `update` do status. É esse intervalo que precisa ser
-- indivisível — pausa e aula nova da mesma professora disputam o MESMO recurso,
-- então as duas ordens concorrentes ficam serializadas e exatamente uma passa.
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

  -- c10 · T2: 5º andar. Enquanto esta transação não commitar, nenhuma aula desta
  -- professora nasce sem enxergar a pausa; e se uma inserção chegou primeiro, é
  -- ESTA que espera — e o horário já terá dono quando a pausa voltar a olhar.
  -- Contrato de mentoria pode não ter professora: aí não há agenda a serializar.
  if v_contract.teacher_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('teacher_agenda:' || v_contract.teacher_id::text, 0));
  end if;

  -- NOVO (c11 · U2): sob o advisory, a pergunta do outro lado. "É ESTA que
  -- espera" só vale se, ao voltar a olhar, ela de fato OLHAR.
  perform public._assert_no_scheduled_overlap(p_contract, v_contract.teacher_id);

  update contracts set status = 'paused' where id = p_contract;
  insert into contract_pauses (contract_id, created_by) values (p_contract, v_actor)
  returning id into v_id;

  perform public.log_audit(v_actor, 'pause_contract', 'contracts', p_contract::text,
    jsonb_build_object('pause_id', v_id));
  return v_id;
end;
$function$;

comment on function public.pause_contract(uuid, uuid) is
  'Pausa o contrato (F3-D10). Sob o advisory `teacher_agenda:<professora>`, '
  'confere os DOIS lados da posse do horário (c11 · U2): a pausa congela o '
  'horário fixo, então ela só passa se ele não estiver ocupado por aula futura '
  'de outro contrato da mesma professora.';


-- ###########################################################################
-- U3 · O PAR AULA ↔ HORÁRIO FIXO CONCORDA SOBRE O CONTRATO, POR ESTRUTURA
-- ###########################################################################
--
-- A ESCOLHA (viabilidade conferida antes de escrever): `class_instances` tem
-- `contract_id NOT NULL` e `slot_id` nulo nas avulsas, e as duas colunas estão
-- consistentes em todo o histórico — conferido na bancada com
--
--     select count(*) from class_instances ci
--      where ci.slot_id is not null
--        and ci.contract_id is distinct from
--            (select rs.contract_id from recurring_slots rs where rs.id = ci.slot_id)
--
-- que devolve 0. Logo a FK COMPOSTA é viável, e é ela que entra: `MATCH SIMPLE`
-- (o padrão) deixa passar limpo toda linha com `slot_id` nulo — as avulsas, as
-- remarcadas, a experimental —, e prende todas as outras ao dono declarado.
-- Vantagem sobre a alternativa (validar no materializador): a FK não depende de
-- ninguém chamar nada. Vale para `update`, para `insert` direto por psql e
-- inclusive quando alguém desliga o gatilho `recurring_slots_dono_imutavel`
-- pelo nome — RI é gatilho de sistema, `disable trigger <nome>` não o alcança.
--
-- O QUE A FK NÃO ALCANÇA, e por isso o materializador ganha uma linha: uma
-- escrita com `session_replication_role = replica` desliga TUDO — o gatilho do
-- c10 · T4 e a RI junto. Aí a troca de dono COMMITA e deixa resíduo: as aulas
-- velhas apontando para o contrato antigo. Nesse estado o cinto duplo do T4 não
-- vê nada (slot e contrato relidos concordam entre si) e o materializador
-- seguiria criando aulas para o dono novo em cima de um histórico que é de
-- outro. A conferência abaixo é o detector desse resíduo — uma sonda indexada
-- por chamada, e o único caminho que sobrou fica nomeado em vez de silencioso.
-- (O alcance da recusa difere por modo — a razão está escrita na própria sonda.)

-- Conferência explícita ANTES da constraint: se algum ambiente tiver divergência,
-- a recusa vem com o número e o nome do problema, não com um texto de RI.
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from class_instances ci
   where ci.slot_id is not null
     and ci.contract_id is distinct from
         (select rs.contract_id from recurring_slots rs where rs.id = ci.slot_id);
  if v_n > 0 then
    raise exception
      '% aula(s) apontam para um horário fixo de OUTRO contrato — conserte o vínculo antes de aplicar a FK composta (c11 · U3)', v_n;
  end if;
end;
$$;

alter table recurring_slots
  add constraint recurring_slots_id_contract_uniq unique (id, contract_id);

comment on constraint recurring_slots_id_contract_uniq on recurring_slots is
  'Existe para ser o alvo da FK composta de class_instances (c11 · U3). '
  'Redundante como unicidade (id já é a PK) e obrigatória como referência.';

alter table class_instances
  add constraint class_instances_slot_do_contrato
  foreign key (slot_id, contract_id)
  references recurring_slots (id, contract_id);

comment on constraint class_instances_slot_do_contrato on class_instances is
  'A aula só pende de um horário fixo do PRÓPRIO contrato (c11 · U3). MATCH '
  'SIMPLE: avulsa (slot_id nulo) passa limpo.';

-- `materialize_slot`: reemissão do corpo vivo (20260727000900) com a sonda de
-- resíduo logo depois do cinto duplo do T4 — mesmo lugar, mesma pergunta, um
-- passo adiante: não basta o slot relido concordar com o contrato travado, as
-- aulas JÁ EXISTENTES daquele slot também têm de concordar.
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
  v_orfas int;
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
  -- c10 · T4: o contrato travado tem de ser o dono do slot travado. Se não for,
  -- a decisão desta chamada foi tomada sobre o contrato errado — ABORTA sempre
  -- (inclusive no modo tolerante: aula no contrato errado é pior do que
  -- ocorrência faltando).
  if r.contract_id is distinct from v_contract_id then
    raise exception
      'o horário fixo % trocou de contrato entre a pré-leitura (%) e o lock (%) — nada foi materializado',
      p_slot, v_contract_id, r.contract_id;
  end if;

  -- NOVO (c11 · U3): e as aulas que JÁ existem deste horário fixo também têm de
  -- ser do mesmo dono. A FK composta torna isso impossível por todo caminho que
  -- respeita constraint; o que sobra é a escrita que desliga a RI inteira
  -- (`session_replication_role = replica`) e COMMITA a troca antes desta
  -- chamada. Aí o cinto duplo acima não enxerga nada — slot e contrato relidos
  -- concordam entre si — e só o histórico denuncia.
  --
  -- NENHUMA aula nasce deste horário enquanto a divergência existir. O que muda
  -- com o modo é o ALCANCE da recusa, e aqui a régua NÃO é a do T4 logo acima:
  --   · T4 é um estado TRANSITÓRIO (dois escritores no mesmo instante) — a
  --     chamada seguinte já encontra o mundo consistente, então derrubar tudo
  --     custa uma rodada;
  --   · esta divergência é PERSISTENTE: enquanto ninguém consertar o dado, toda
  --     chamada volta a encontrá-la. Derrubar o lote diário inteiro por causa de
  --     UM horário fixo pararia a agenda da escola toda por tempo indeterminado
  --     — dano maior do que o resíduo. No lote, então, este horário é PULADO com
  --     rastro (a mesma régua que o conflito de agenda já usa 40 linhas abaixo:
  --     `warning` + `audit_log`, Lei 8); no caminho interativo, que é de uma
  --     pessoa só esperando resposta, a recusa é nomeada e a transação reverte.
  select count(*) into v_orfas
    from class_instances ci
   where ci.slot_id = p_slot
     and ci.contract_id is distinct from r.contract_id;
  if v_orfas > 0 then
    if p_strict then
      raise exception
        'o horário fixo % tem % aula(s) presas em outro contrato — o vínculo foi trocado por baixo da FK; nada foi materializado',
        p_slot, v_orfas;
    end if;
    raise warning 'horário fixo % com % aula(s) em outro contrato: pulado', p_slot, v_orfas;
    insert into audit_log (action, entity, entity_id, diff)
    values ('materialize_owner_mismatch', 'recurring_slots', p_slot::text,
            jsonb_build_object('contract_id', r.contract_id, 'aulas_divergentes', v_orfas));
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
  'canônica (contrato → slot → advisory), confere que o contrato travado ainda '
  'é o dono do slot (c10 · T4), que as aulas já existentes do slot são do mesmo '
  'dono (c11 · U3) e RELÊ status/vigência depois dos locks: contrato encerrado '
  'ou horário fechado não geram aula nenhuma — em silêncio no modo tolerante, '
  'com erro no estrito (c9 · S1).';
