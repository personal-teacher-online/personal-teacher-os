-- Correções da REVISÃO ADVERSARIAL Nº 3 (revisor Sol, 26/07/2026) sobre o
-- commit e152dc9 — parte de BANCO.
--
-- Lei 7: migration aplicada é imutável. Nada das anteriores foi tocado — tudo
-- aqui é ALTER / CREATE OR REPLACE, comentado por item.
--
--  S1  anonimização que "destrói o login" sem destruir  (high) — estado durável
--  S2  corrida da telemetria × carimbo de anonimização  (high) — lock explícito
--
-- Leis tocadas: 3 (a regra mora no Postgres), 4 (RLS/negar por padrão),
-- 8 (auditoria).

-- ===========================================================================
-- S1. BAN RETOMÁVEL — o que ficou pendente vira ESTADO, não memória da tela
-- ===========================================================================
--
-- O ACHADO: `admin_anonymize_student` anonimiza a ficha e zera
-- `students.profile_id` na mesma transação, mas a destruição do LOGIN mora
-- fora dela (é HTTP para o Auth, na server action). Quando esse passo falha, a
-- action já não tem mais como reencontrar o usuário: re-submeter o formulário
-- roda a RPC de novo, recebe `profile_id: null`, PULA o ban — e a tela afirma
-- "login destruído" com a credencial da pessoa viva. O fail-closed da rodada
-- anterior (B3) tornou honesta a PRIMEIRA falha; a SEGUNDA tentativa voltava a
-- mentir.
--
-- A CORREÇÃO: o profile_id original não some — ele migra, na MESMA transação,
-- para `students.auth_cleanup_profile_id`, que é a lista de "logins que ainda
-- precisam morrer". A RPC passa a devolver esse alvo mesmo quando o aluno já
-- está anonimizado, a ficha mostra o pendente, e `admin_clear_auth_cleanup`
-- baixa a pendência só DEPOIS de o ban ter dado certo de verdade.

alter table students add column if not exists auth_cleanup_profile_id uuid
  references profiles (id);

comment on column students.auth_cleanup_profile_id is
  'Login que a anonimização ainda precisa destruir (ban + credencial '
  'embaralhada, passo que roda no Auth, fora da transação). Gravado por '
  'admin_anonymize_student junto com a desidentificação; baixado por '
  'admin_clear_auth_cleanup só depois do ban confirmado. NULL = nada pendente '
  '(revisão adversarial nº 3, S1).';

-- Índice parcial: a pergunta útil é "que fichas ficaram com login vivo?" e a
-- resposta é quase sempre vazia — o índice fica do tamanho da pendência.
create index if not exists students_auth_cleanup_pendente
  on students (auth_cleanup_profile_id)
  where auth_cleanup_profile_id is not null;

create or replace function public.admin_clear_auth_cleanup(p_student uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_pending uuid;
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'admin_clear_auth_cleanup é restrita à admin';
  end if;

  select auth_cleanup_profile_id into v_pending
    from students where id = p_student for update;
  if not found then
    raise exception 'aluno % não existe', p_student;
  end if;
  -- Idempotente: chamar de novo (retentativa, duplo clique) não é erro nem
  -- audita duas vezes — só informa que já não havia o que baixar.
  if v_pending is null then
    return false;
  end if;

  update students set auth_cleanup_profile_id = null where id = p_student;

  perform public.log_audit(auth.uid(), 'anonymize_student_auth_done', 'students',
    p_student::text,
    jsonb_build_object('profile_id', v_pending, 'at', now()));
  return true;
end;
$fn$;

comment on function public.admin_clear_auth_cleanup is
  'Baixa a pendência de destruição do login depois de o ban no Auth ter dado '
  'certo. Só a admin chama, e só a partir da server action. Idempotente: sem '
  'pendência devolve false e não audita (revisão adversarial nº 3, S1).';

revoke execute on function public.admin_clear_auth_cleanup(uuid) from public, anon;
grant execute on function public.admin_clear_auth_cleanup(uuid) to authenticated;

-- ===========================================================================
-- S2. CORRIDA DA TELEMETRIA — a leitura do carimbo passa a travar a linha
-- ===========================================================================
--
-- O ACHADO: as duas RPCs de telemetria decidiam por um `exists(... where
-- anonymized_at is not null)` SEM LOCK. Em READ COMMITTED, uma chamada que leu
-- o perfil ainda limpo pode gravar o INSERT depois de a anonimização commitar
-- — e a limpeza (`update ui_events set user_id = null`) já passou. Resultado:
-- linha nova, identificada, de quem acabou de ser esquecido. É exatamente o
-- buraco que o carimbo B3 fechou pela metade.
--
-- A CORREÇÃO: `select ... for share` na linha de `profiles` antes de decidir.
-- O share lock não atrapalha telemetria concorrente (várias podem lê-lo ao
-- mesmo tempo), mas conflita com o `update profiles` da anonimização — as duas
-- ordens possíveis passam a ser seguras:
--   • telemetria primeiro: a anonimização ESPERA o commit dela e, logo em
--     seguida, a limpeza alcança a linha recém-inserida;
--   • anonimização primeiro: a telemetria ESPERA, relê o carimbo já gravado e
--     insere anônima.
-- Continua sendo coerção SILENCIOSA (telemetria nunca derruba cliente algum).
--
-- Do outro lado, a ordem DENTRO da transação da anonimização é o que fecha a
-- primeira metade: o `update profiles` (carimbo) tem de vir ANTES da limpeza
-- das tabelas de telemetria. Já vinha assim desde a 000300 e continua assim na
-- reemissão abaixo — está anotado lá para não se perder num próximo replace.

create or replace function public.record_ui_event(
  p_user uuid,
  p_role text,
  p_path text,
  p_event text default 'page_view',
  p_meta jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid := p_user;
  v_anon timestamptz;
begin
  -- B3 + S1/S2: perfil anonimizado nunca volta a ser identificado pela
  -- telemetria — e a leitura TRAVA a linha (for share) para que a decisão não
  -- seja tomada sobre um estado que a anonimização já mudou.
  if v_user is not null then
    select pr.anonymized_at into v_anon
      from profiles pr where pr.id = v_user for share;
    if v_anon is not null then
      v_user := null;
    end if;
  end if;

  -- Caps no BANCO também: telemetria nunca derruba nada, nem por payload
  -- gigante vindo de um cliente esquisito.
  insert into ui_events (user_id, role, path, event, meta)
  values (
    v_user,
    nullif(p_role, ''),
    left(coalesce(nullif(btrim(p_path), ''), '/'), 300),
    coalesce(nullif(p_event, ''), 'page_view'),
    case when p_meta is null or jsonb_typeof(p_meta) <> 'object'
         then '{}'::jsonb else p_meta end
  );
end;
$fn$;

revoke execute on function public.record_ui_event(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_ui_event(uuid, text, text, text, jsonb) to service_role;

create or replace function public.record_client_error(
  p_hash text,
  p_message text,
  p_stack text default null,
  p_path text default null,
  p_user uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_id uuid;
  v_user uuid := p_user;
  v_anon timestamptz;
begin
  if p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'hash inválido (esperado sha-256 hex)';
  end if;

  -- Idem: o erro conta no balde ANÔNIMO daquela assinatura, e a decisão é
  -- tomada com a linha do perfil travada (for share).
  if v_user is not null then
    select pr.anonymized_at into v_anon
      from profiles pr where pr.id = v_user for share;
    if v_anon is not null then
      v_user := null;
    end if;
  end if;

  insert into client_errors (hash, message, stack, path, user_id)
  values (
    p_hash,
    left(coalesce(nullif(btrim(p_message), ''), 'erro sem mensagem'), 500),
    left(nullif(btrim(coalesce(p_stack, '')), ''), 4000),
    left(nullif(btrim(coalesce(p_path, '')), ''), 300),
    v_user
  )
  -- Um balde por (assinatura, pessoa): a repetição soma no balde de QUEM
  -- topou com o defeito, e o export/anonimização de cada um alcança só o seu.
  on conflict (hash, user_id) do update
     set last_at = now(),
         count = client_errors.count + 1
  returning id into v_id;
  return v_id;
end;
$fn$;

revoke execute on function public.record_client_error(text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_client_error(text, text, text, text, uuid) to service_role;

-- ===========================================================================
-- A anonimização, reemitida (corpo da 000300 + S1)
-- ===========================================================================
--
-- Mudou o MÍNIMO: o alvo do login passa a ser `coalesce(profile_id,
-- auth_cleanup_profile_id)` — ou seja, rodar de novo num aluno já anonimizado
-- devolve o login que ficou pendente em vez de `null` — e o mesmo uuid fica
-- gravado em `auth_cleanup_profile_id` na transação que desvincula a ficha.
create or replace function public.admin_anonymize_student(
  p_student uuid,
  p_confirm text,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student students%rowtype;
  v_actor uuid;
  v_phone text;
  v_profile uuid;
  v_payer record;
  v_fiscal int := 0;
  v_scrubbed int := 0;
  v_events int := 0;
  v_errors int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_anonymize_student é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_student from students where id = p_student for update;
  if not found then
    raise exception 'aluno % não existe', p_student;
  end if;
  -- dupla confirmação: digitar o NOME exato
  if btrim(coalesce(p_confirm, '')) <> v_student.display_name then
    raise exception 'confirmação não confere — digite o nome exato do aluno';
  end if;
  -- só ex-aluno: TODOS os contratos (diretos e de grupo) encerrados
  if exists (
    select 1 from contracts c
    where c.status <> 'ended'
      and (c.student_id = p_student
           or c.student_group_id in (
                select m.group_id from student_group_members m where m.student_id = p_student))
  ) then
    raise exception 'aluno ainda tem contrato não-encerrado — encerre antes de anonimizar';
  end if;

  -- S1: numa REPETIÇÃO (a 1ª tentativa anonimizou mas o ban falhou) o
  -- profile_id já é null — o alvo do login é o que ficou pendente.
  v_profile := coalesce(v_student.profile_id, v_student.auth_cleanup_profile_id);
  if v_profile is not null then
    select whatsapp_e164 into v_phone from profiles where id = v_profile;
    -- B3 (retroativa nº 2): o CARIMBO entra na mesma transação que desidentifica
    -- as linhas existentes, e ANTES da limpeza da telemetria (a ordem importa:
    -- é ela que garante que tudo que passar depois do carimbo já nasce anônimo
    -- e tudo que passou antes é alcançado pela limpeza abaixo). Sem ele havia
    -- uma janela — daqui até o ban do Auth, que acontece FORA desta transação —
    -- em que uma aba ainda aberta gravava telemetria NOVA com o user_id da
    -- pessoa, reidentificando quem acabara de ser esquecido.
    update profiles
       set full_name = 'Ex-aluno(a)',
           whatsapp_e164 = null,
           email_bounced_at = null,
           email_bounce_reason = null,
           anonymized_at = coalesce(anonymized_at, now())
     where id = v_profile;

    -- Telemetria: o EVENTO fica (série histórica sem buraco), a pessoa sai.
    update ui_events set user_id = null where user_id = v_profile;
    get diagnostics v_events = row_count;

    -- client_errors tem UM BALDE POR PESSOA e a chave (hash, user_id) é única
    -- com NULLS NOT DISTINCT: um `set user_id = null` seco violaria a chave
    -- sempre que o mesmo defeito já tivesse balde anônimo. Então o balde da
    -- pessoa é FUNDIDO no anônimo (a contagem do defeito não pode encolher só
    -- porque alguém exerceu o direito ao esquecimento) e, quando não há
    -- anônimo ainda, ele simplesmente vira o anônimo.
    select count(*)::int into v_errors from client_errors where user_id = v_profile;

    update client_errors anonimo
       set count    = anonimo.count + meu.count,
           first_at = least(anonimo.first_at, meu.first_at),
           last_at  = greatest(anonimo.last_at, meu.last_at)
      from client_errors meu
     where meu.user_id = v_profile
       and anonimo.user_id is null
       and anonimo.hash = meu.hash;

    delete from client_errors meu
     where meu.user_id = v_profile
       and exists (select 1 from client_errors a
                    where a.user_id is null and a.hash = meu.hash);

    update client_errors set user_id = null where user_id = v_profile;
  end if;

  -- esqueleto operacional preservado (aulas, ledger, extratos, auditoria);
  -- relatórios ENVIADOS ficam (exceção controlada da decisão M4-5)
  update students
     set display_name = 'Ex-aluno(a) ' || left(p_student::text, 4),
         status = 'archived',  -- S2-13: sai da lista de trabalho (filtro Arquivados)
         city = null,
         country = null,
         level = null,
         profile_id = null,
         -- S1: o login que ainda precisa morrer não some junto com o vínculo.
         auth_cleanup_profile_id = v_profile
   where id = p_student;

  -- M11-4: pagador EXCLUSIVO deste aluno — com cobrança real (Asaas) preserva
  -- 5 anos (obrigação fiscal, expurgo manual futuro registrado); sem, é limpo.
  for v_payer in
    select py.* from payers py
    join student_payers sp on sp.payer_id = py.id and sp.student_id = p_student
    where not exists (
      select 1 from student_payers sp2
      where sp2.payer_id = py.id and sp2.student_id <> p_student)
  loop
    if v_payer.asaas_customer_id is not null then
      v_fiscal := v_fiscal + 1;
    else
      update payers set name = 'Pagador removido', email = null, cpf_cnpj = null
       where id = v_payer.id;
      v_scrubbed := v_scrubbed + 1;
    end if;
  end loop;

  perform public.log_audit(v_actor, 'anonymize_student', 'students', p_student::text,
    jsonb_build_object('profile_id', v_profile, 'payers_fiscal_5anos', v_fiscal,
                       'payers_scrubbed', v_scrubbed,
                       'ui_events_desidentificados', v_events,
                       'client_errors_desidentificados', v_errors));

  -- `profile_id` no retorno = O LOGIN A DESTRUIR (o vínculo da ficha já foi
  -- desfeito). `auth_cleanup_pending` diz se sobrou trabalho fora daqui.
  return jsonb_build_object('profile_id', v_profile, 'phone', v_phone,
                            'payers_fiscal', v_fiscal, 'payers_scrubbed', v_scrubbed,
                            'ui_events', v_events, 'client_errors', v_errors,
                            'auth_cleanup_pending', v_profile is not null);
end;
$$;
