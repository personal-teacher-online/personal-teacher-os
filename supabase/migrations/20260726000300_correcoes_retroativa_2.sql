-- Correções da REVISÃO ADVERSARIAL RETROATIVA Nº 2 (revisor Sol, 26/07/2026)
-- sobre o lote "Fundações de dados" (migrations 20260726000100 / 000200).
--
-- Lei 7: migration aplicada é imutável. Nada ali foi tocado — tudo aqui é
-- CREATE OR REPLACE / ALTER / cron novo, comentado por item.
--
--  B1  corrida publicação × aceite de política  (high)
--  B2  buraco silencioso nos snapshots de KPI   (high)
--  B3  reidentificação pós-anonimização         (high)
--  B4  KPI de entradas/saídas contando o futuro (medium) + bump v1 → v2
--
-- Leis tocadas: 3 (a regra mora no Postgres), 4 (RLS/negar por padrão),
-- 5 (pg_cron, zero infra nova), 8 (auditoria).

-- ===========================================================================
-- B1. CORRIDA PUBLICAÇÃO × ACEITE — serialização por advisory lock
-- ===========================================================================
--
-- O ACHADO: `ack_channel_notice` lia a versão vigente e gravava o aceite sem
-- serialização nenhuma. Em READ COMMITTED cada comando pega um snapshot NOVO,
-- então uma v2 publicada e commitada ENTRE o SELECT da vigente e o INSERT do
-- aceite deixava registrar, com aparência de normalidade, o aceite de uma
-- versão que já não era a vigente no instante da gravação. A tabela existe
-- exatamente para dizer "esta pessoa concordou com ESTE texto": um aceite de
-- versão morta é a única coisa que ela não pode conter.
--
-- A CORREÇÃO: as duas pontas passam a pegar o MESMO advisory lock de
-- transação, por `kind`. Publicar e aceitar a mesma política viram operações
-- mutuamente exclusivas; a que chegar depois enxerga o resultado da primeira.
-- Quando a publicação vence a corrida, o aceite que vinha de uma página velha
-- falha LIMPO ('politica-desatualizada'), que é o comportamento já testado.
--
-- DECISÃO — o caminho direto morre. Hoje não existe tela de publicação: a v1
-- nasceu de um INSERT dentro da migration 000100. Um INSERT direto não pega
-- lock nenhum, então deixá-lo aberto seria manter a corrida viva por um
-- caminho que ninguém lembra de auditar. A partir daqui `policy_versions` só
-- aceita INSERT vindo de `publish_policy_version()` — o trigger confere um
-- sinalizador de transação que só a função levanta. Migration futura que
-- semeie política chama a função (é uma linha a mais e um lock a menos de
-- surpresa).

create or replace function public.policy_versions_via_rpc()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if coalesce(current_setting('ptos.policy_publish', true), '0') <> '1' then
    raise exception 'policy_versions: publique por publish_policy_version() — INSERT direto não serializa com o aceite (retroativa nº 2, B1)';
  end if;
  return new;
end;
$fn$;

comment on function public.policy_versions_via_rpc is
  'Portão de escrita de policy_versions: só passa INSERT levantado por '
  'publish_policy_version(), que é quem pega o advisory lock do kind.';

drop trigger if exists policy_versions_only_via_rpc on policy_versions;
create trigger policy_versions_only_via_rpc
  before insert on policy_versions
  for each row execute function public.policy_versions_via_rpc();

create or replace function public.publish_policy_version(
  p_kind text,
  p_version int,
  p_body_md text,
  p_effective_from date default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_id uuid;
begin
  -- MESMA chave do aceite: publicar e aceitar a mesma política nunca correm
  -- em paralelo. `pg_advisory_xact_lock` solta sozinho no fim da transação
  -- (commit OU rollback), então não existe lock órfão.
  perform pg_advisory_xact_lock(hashtext('policy:' || p_kind));
  perform set_config('ptos.policy_publish', '1', true);
  insert into policy_versions (kind, version, body_md, effective_from)
  values (p_kind, p_version, p_body_md,
          coalesce(p_effective_from, public.business_today()))
  returning id into v_id;
  -- baixa o sinalizador na hora: um INSERT direto mais adiante na MESMA
  -- transação continua barrado.
  perform set_config('ptos.policy_publish', '0', true);
  return v_id;
end;
$fn$;

comment on function public.publish_policy_version is
  'Único caminho de publicação de política. Pega o advisory lock do kind — o '
  'mesmo que o aceite pega — e por isso um aceite nunca sai de uma versão que '
  'deixou de ser a vigente no instante da GRAVAÇÃO (retroativa nº 2, B1).';

-- Publicação é ato de OPERAÇÃO (migration/serviço), não de tela: não há UI de
-- publicação, e enquanto não houver, quem pode é o service_role.
revoke execute on function public.publish_policy_version(text, int, text, date)
  from public, anon, authenticated;
grant execute on function public.publish_policy_version(text, int, text, date) to service_role;

-- O miolo do aceite, genérico por `kind` e revogado de todo mundo: quem chama
-- é a RPC de ciência (e, quando as cláusulas do advogado virarem política
-- própria, a RPC daquela tela). Genérico porque a CORRIDA precisa ser
-- exercitável em teste sem publicar uma v2 de 'ciencia-canais' no banco
-- compartilhado da suíte — o que quebraria os arquivos que rodam em paralelo.
create or replace function public._accept_policy_locked(
  p_kind text,
  p_policy_version_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_vigente uuid;
  v_student uuid;
begin
  if auth.uid() is null then
    raise exception 'sessão necessária';
  end if;

  -- O lock vem ANTES da leitura da vigente: daqui até o commit, ninguém
  -- publica versão nova deste kind. A vigente lida é a vigente gravada.
  perform pg_advisory_xact_lock(hashtext('policy:' || p_kind));

  select v.id into v_vigente from public.policy_vigente(p_kind) v;
  if v_vigente is null then
    raise exception 'nenhuma versão vigente da política %', p_kind;
  end if;
  if p_policy_version_id is null or p_policy_version_id <> v_vigente then
    raise exception 'politica-desatualizada: o texto mudou enquanto esta página estava aberta — recarregue para ler a versão vigente';
  end if;

  -- Só aluno aceita política de aluno; quem não tem ficha (professora testando
  -- o portal, por exemplo) apenas passa pela conferência.
  select s.id into v_student from students s where s.profile_id = auth.uid();
  if v_student is not null then
    insert into policy_acceptances (student_id, policy_version_id, channel)
    values (v_student, v_vigente, 'portal')
    on conflict (student_id, policy_version_id) do nothing;
  end if;

  return v_vigente;
end;
$fn$;

comment on function public._accept_policy_locked is
  'Miolo do aceite versionado: advisory lock do kind, conferência da vigente e '
  'gravação — nesta ordem. Sem portão de papel próprio; quem expõe é a RPC da '
  'tela correspondente.';

revoke execute on function public._accept_policy_locked(text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.ack_channel_notice(p_policy_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_vigente uuid;
begin
  -- Conferência + aceite, já serializados contra a publicação (B1). Se a
  -- versão exibida deixou de ser a vigente, isto ESTOURA e a transação inteira
  -- cai: nem carimbo, nem auditoria, nem aceite.
  v_vigente := public._accept_policy_locked('ciencia-canais', p_policy_version_id);

  update profiles set whatsapp_channel_ack_at = coalesce(whatsapp_channel_ack_at, now())
   where id = auth.uid();
  perform public.log_audit(auth.uid(), 'ack_channel_notice', 'profiles', auth.uid()::text,
    jsonb_build_object('at', now(), 'policy_version_id', v_vigente));
end;
$fn$;

comment on function public.ack_channel_notice is
  'Ciência do canal oficial: confere que a versão exibida ainda é a vigente '
  '(sob advisory lock, retroativa nº 2 B1), carimba o perfil e registra o '
  'aceite VERSIONADO, tudo na mesma transação. Idempotente nos dois lados.';

revoke execute on function public.ack_channel_notice(uuid) from public, anon;
grant execute on function public.ack_channel_notice(uuid) to authenticated;

-- ===========================================================================
-- B2. BURACO SILENCIOSO NOS SNAPSHOTS — três tentativas por dia
-- ===========================================================================
--
-- O ACHADO: o fechamento diário tinha UMA tentativa (07:00 UTC). Banco fora do
-- ar naquele minuto = dia perdido PARA SEMPRE (a tabela é append-only e o
-- cálculo é do instante) e, um mês depois, a comparação daquele dia morre
-- junto — em silêncio, porque "sem os dois pontos, a comparação some" é o
-- comportamento correto e indistinguível da falha.
--
-- A CORREÇÃO (a): mais duas tentativas no MESMO dia. A captura já é idempotente
-- por UNIQUE(captured_on) + ON CONFLICT DO NOTHING — a 2ª e a 3ª tentativas não
-- duplicam nem sobrescrevem; elas só existem para o caso de a 1ª não ter
-- acontecido. 07:20 cobre a indisponibilidade curta (deploy, restart); 09:00
-- cobre a longa. Todas ainda de madrugada em Cuiabá (03:00/04:00 e 05:00), com
-- o dia do negócio virado e o movimento do dia anterior fechado.
--
-- (b) e (c) são do lado do app (src/data/admin/home.ts): a legenda passa a
-- mostrar o horário REAL de cada fechamento (o `generated_at` do snapshot, não
-- um "03:00" fixo que mentia quando a captura era tardia ou manual) e, passado
-- o horário da última tentativa sem snapshot de hoje, o andar Negócio AVISA em
-- vez de simplesmente esconder a comparação.

select cron.schedule(
  'capture-kpi-snapshot-retry-1',
  '20 7 * * *',
  $cron$select public.capture_kpi_snapshot()$cron$
);

select cron.schedule(
  'capture-kpi-snapshot-retry-2',
  '0 9 * * *',
  $cron$select public.capture_kpi_snapshot()$cron$
);

comment on function public.capture_kpi_snapshot is
  'Grava a foto do dia (idempotente pelo UNIQUE(captured_on): a repetição no '
  'mesmo dia devolve false e não toca a linha). Roda pelo pg_cron às 07:00 UTC '
  'e, se aquele minuto tiver pegado o banco fora do ar, de novo às 07:20 e às '
  '09:00 — o histórico de um dia não se reconstrói depois (retroativa nº 2, B2).';

-- ===========================================================================
-- B3. REIDENTIFICAÇÃO PÓS-ANONIMIZAÇÃO — carimbo no perfil + coerção
-- ===========================================================================
--
-- O ACHADO: a RPC zerava o user_id das linhas de telemetria EXISTENTES, mas
-- nada impedia gravações NOVAS identificadas na janela entre o commit e o ban
-- do Auth (que acontece fora da transação, na server action). Uma aba aberta,
-- um beacon atrasado, um erro de cliente — e a pessoa "esquecida" voltava a
-- aparecer na telemetria.
--
-- A CORREÇÃO: o perfil ganha um carimbo, gravado na MESMA transação da
-- anonimização, e as duas RPCs de telemetria coagem o user_id para NULL quando
-- o perfil está carimbado. Coerção SILENCIOSA, nunca erro: telemetria não pode
-- quebrar o cliente de quem quer que seja (o evento continua contando na série
-- histórica, desidentificado — que é a mesma escolha já feita para as linhas
-- antigas).

alter table profiles add column if not exists anonymized_at timestamptz;

comment on column profiles.anonymized_at is
  'Quando o direito ao esquecimento foi exercido (LGPD). Depois disto a '
  'telemetria grava o evento SEM o usuário: record_ui_event e '
  'record_client_error coagem user_id para NULL (retroativa nº 2, B3).';

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
begin
  -- B3: perfil anonimizado nunca volta a ser identificado pela telemetria.
  if v_user is not null and exists (
    select 1 from profiles pr where pr.id = v_user and pr.anonymized_at is not null
  ) then
    v_user := null;
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
begin
  if p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'hash inválido (esperado sha-256 hex)';
  end if;

  -- B3: idem — o erro conta no balde ANÔNIMO daquela assinatura.
  if v_user is not null and exists (
    select 1 from profiles pr where pr.id = v_user and pr.anonymized_at is not null
  ) then
    v_user := null;
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

-- A etapa do Auth (ban + credencial embaralhada) mora na server action e NÃO
-- cabe nesta transação — é HTTP para outro serviço. O que cabe é o registro:
-- quando ela falha, a action reporta erro à admin (fail-CLOSED, nunca "pronto")
-- e chama esta função, para a auditoria guardar que o esquecimento ficou pela
-- metade — dado que a ficha JÁ foi desidentificada e o login ainda não morreu.
create or replace function public.admin_report_anonymize_failure(
  p_student uuid,
  p_detail text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'admin_report_anonymize_failure é restrita à admin';
  end if;
  perform public.log_audit(auth.uid(), 'anonymize_student_auth_failed', 'students',
    p_student::text,
    jsonb_build_object('at', now(), 'detalhe', left(coalesce(p_detail, ''), 500)));
end;
$fn$;

comment on function public.admin_report_anonymize_failure is
  'Registra em audit_log que a destruição do login falhou depois de a ficha já '
  'ter sido anonimizada. Só a admin chama, e só a partir da server action '
  '(retroativa nº 2, B3).';

revoke execute on function public.admin_report_anonymize_failure(uuid, text) from public, anon;
grant execute on function public.admin_report_anonymize_failure(uuid, text) to authenticated;

-- A anonimização, recriada só para o carimbo (o resto do corpo é o mesmo da
-- 000100 — F7/M4-5 + M11-4).
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

  v_profile := v_student.profile_id;
  if v_profile is not null then
    select whatsapp_e164 into v_phone from profiles where id = v_profile;
    -- B3 (retroativa nº 2): o CARIMBO entra na mesma transação que desidentifica
    -- as linhas existentes. Sem ele havia uma janela — daqui até o ban do Auth,
    -- que acontece FORA desta transação — em que uma aba ainda aberta gravava
    -- telemetria NOVA com o user_id da pessoa, reidentificando quem acabara de
    -- ser esquecido. Com o carimbo, record_ui_event e record_client_error
    -- coagem o user_id para NULL a partir do COMMIT desta transação.
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
         profile_id = null
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

  return jsonb_build_object('profile_id', v_profile, 'phone', v_phone,
                            'payers_fiscal', v_fiscal, 'payers_scrubbed', v_scrubbed,
                            'ui_events', v_events, 'client_errors', v_errors);
end;
$$;

-- ===========================================================================
-- B4. KPI CONTANDO O FUTURO — entradas/saídas cortadas em v_today (v1 → v2)
-- ===========================================================================
--
-- O ACHADO: entradas e saídas do mês olhavam só para o MÊS, não para HOJE. Um
-- contrato com `started_on` no futuro já contava como entrada, e um `ended`
-- com `ended_on` no futuro já contava como saída — e isso não é hipótese:
-- `admin_renew_contract` cria a virada com até 8 semanas de antecedência, então
-- em toda renovação o cartão passava a mostrar uma entrada e uma saída que
-- ainda não aconteceram.
--
-- A CORREÇÃO: `<= v_today` dos dois lados. E, porque a FÓRMULA mudou, a versão
-- muda junto: `definitions_version` vai a 2. É o contrato do histórico —
-- refinar a conta cria versão nova, nunca reescreve o passado. A comparação já
-- exige versões iguais nos dois pontos, então ela simplesmente some enquanto os
-- dois lados não forem v2, e volta sozinha (nada a migrar, nada a recalcular).

create or replace function public._admin_kpis_compute()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz            text := public.business_tz();
  v_today         date := public.business_today();
  v_month_start   date := date_trunc('month', v_today)::date;
  v_month_end     date := (date_trunc('month', v_today) + interval '1 month')::date;
  -- isodow: segunda = 1
  v_week_start    date := v_today - (extract(isodow from v_today)::int - 1);
  v_week_end      date := v_today - (extract(isodow from v_today)::int - 1) + 7;
  v_week_from     timestamptz := (v_week_start::timestamp) at time zone v_tz;
  v_week_to       timestamptz := (v_week_end::timestamp) at time zone v_tz;
  v_now           timestamptz := now();

  v_recebido      bigint;
  v_previsto      bigint;
  v_atraso        bigint;
  v_familias      int;
  v_ativos_total  int;
  v_ativos_priv   int;
  v_ativos_ment   int;
  v_aulas_total   int;
  v_aulas_rest    int;
  v_novos         int;
  v_encerrados    int;
  v_ocupacao      jsonb;
  v_niveis        jsonb;
begin
  -- ---------------------------------------------------------------- dinheiro
  select coalesce(sum(p.amount_cents), 0) into v_recebido
    from payments p
   where (p.paid_at is not null
          or lower(coalesce(p.status, '')) in ('received', 'confirmed', 'received_in_cash'))
     and not public.payment_nao_cobravel(p.status)
     and coalesce((p.paid_at at time zone v_tz)::date, p.due_date) >= v_month_start
     and coalesce((p.paid_at at time zone v_tz)::date, p.due_date) <  v_month_end;

  -- Previsto = o que se COBRA no mês (vencimento no mês), pago ou não.
  select coalesce(sum(p.amount_cents), 0) into v_previsto
    from payments p
   where not public.payment_nao_cobravel(p.status)
     and p.due_date >= v_month_start
     and p.due_date <  v_month_end;

  select coalesce(sum(p.amount_cents), 0),
         count(distinct coalesce(p.payer_id::text, p.contract_id::text, p.id::text))
    into v_atraso, v_familias
    from payments p
   where p.due_date < v_today
     and p.paid_at is null
     and not public.payment_nao_cobravel(p.status)
     and lower(coalesce(p.status, '')) not in ('received', 'confirmed', 'received_in_cash');

  -- ------------------------------------------------------------------ alunos
  with ativos as (
    select distinct
           coalesce(c.student_id, m.student_id) as student_id,
           (c.contract_type = 'mentorship')     as mentoria
      from contracts c
      left join student_group_members m on m.group_id = c.student_group_id
     where c.status = 'active'
       and coalesce(c.student_id, m.student_id) is not null
  )
  select count(distinct student_id),
         count(distinct student_id) filter (where not mentoria),
         count(distinct student_id) filter (where mentoria)
    into v_ativos_total, v_ativos_priv, v_ativos_ment
    from ativos;

  -- Níveis: mesmo universo do cartão de alunos ativos, com o balde do vazio.
  with ativos as (
    select distinct coalesce(c.student_id, m.student_id) as student_id
      from contracts c
      left join student_group_members m on m.group_id = c.student_group_id
     where c.status = 'active'
       and coalesce(c.student_id, m.student_id) is not null
  ),
  faixas as (
    select unnest(array['Pre A1', 'A1', 'A1+', 'A2', 'A2+', 'B1', 'B1+',
                        'B2', 'B2+', 'C1', 'C2', 'sem nível']) as nivel,
           generate_series(1, 12) as ord
  )
  select coalesce(jsonb_agg(jsonb_build_object('nivel', f.nivel, 'alunos', n.qtd)
                            order by f.ord), '[]'::jsonb)
    into v_niveis
    from faixas f
    join lateral (
      select count(*)::int as qtd
        from ativos a
        join students s on s.id = a.student_id
       where coalesce(nullif(s.level, ''), 'sem nível') = f.nivel
    ) n on true;

  -- ------------------------------------------------------------------- aulas
  select count(*) filter (where ci.state not in ('cancelled', 'rescheduled')),
         count(*) filter (where ci.state = 'scheduled' and ci.starts_at_utc >= v_now)
    into v_aulas_total, v_aulas_rest
    from class_instances ci
   where ci.starts_at_utc >= v_week_from
     and ci.starts_at_utc <  v_week_to;

  -- ------------------------------------------------------- entradas e saídas
  -- B4 (retroativa nº 2): o corte em v_today é o que impede o FUTURO de contar.
  -- `admin_renew_contract` cria a virada com até 8 semanas de antecedência, e
  -- sem este `<= v_today` o contrato que ainda nem começou já entrava como
  -- ENTRADA do mês — número que a dona vê hoje e não se explica hoje.
  select count(*) into v_novos
    from contracts c
   where c.renewed_from is null
     and c.started_on >= v_month_start
     and c.started_on <= v_today
     and c.started_on <  v_month_end;

  -- Mesma régua do lado da saída: `ended` com ended_on futuro é encerramento
  -- AGENDADO, não saída acontecida.
  select count(*) into v_encerrados
    from contracts c
   where c.status = 'ended'
     and c.ended_on >= v_month_start
     and c.ended_on <= v_today
     and c.ended_on <  v_month_end
     and not exists (select 1 from contracts r where r.renewed_from = c.id);

  -- ---------------------------------------------------------------- ocupação
  select coalesce(jsonb_agg(jsonb_build_object(
           'teacher_id',     t.id,
           'teacher',        t.display_name,
           'horas_janela',   round(w.h::numeric, 2),
           'horas_ocupadas', round(o.h::numeric, 2),
           'ocupacao_pct',   case when w.h > 0
                                  then round((100 * o.h / w.h)::numeric, 1)
                                  else null end)
           order by t.is_owner desc, t.display_name), '[]'::jsonb)
    into v_ocupacao
    from teachers t
    left join lateral (
      select coalesce(sum(extract(epoch from (a.end_local - a.start_local)) / 3600), 0) as h
        from teacher_weekly_availability a
       where a.teacher_id = t.id
    ) w on true
    left join lateral (
      select coalesce(sum(extract(epoch from (ci.ends_at_utc - ci.starts_at_utc)) / 3600), 0) as h
        from class_instances ci
       where ci.teacher_id = t.id
         and ci.state not in ('cancelled', 'rescheduled')
         and ci.starts_at_utc >= v_week_from
         and ci.starts_at_utc <  v_week_to
    ) o on true
   -- display_name nulo = professora sem cadastro concluído (e, na bancada de
   -- testes, fixture); a home já filtra assim desde a reforma de UI.
   where t.archived_at is null
     and t.display_name is not null;

  return jsonb_build_object(
    'definitions_version', 2,
    'generated_at',        v_now,
    'business_date',       v_today,
    'month',               to_char(v_month_start, 'YYYY-MM'),
    'week_start',          v_week_start,
    'recebido_no_mes_cents',      v_recebido,
    'previsto_no_mes_cents',      v_previsto,
    -- Fica no contrato, sempre 0, de propósito: a receita do Personal Travel
    -- é da HOTMART e não passa por payments. Zero explícito é mais honesto do
    -- que a chave ausente (que pareceria esquecimento) e mais honesto do que
    -- somar a agenda de mentoria ao caixa da escola.
    'previsto_mentoria_cents',    0,
    'em_atraso_cents',            v_atraso,
    'familias_em_atraso',         v_familias,
    'alunos_ativos',       jsonb_build_object(
                             'total',         v_ativos_total,
                             'particulares',  v_ativos_priv,
                             'travel',        v_ativos_ment),
    'aulas_da_semana',     jsonb_build_object(
                             'restantes',     v_aulas_rest,
                             'total',         v_aulas_total),
    'entradas_saidas_do_mes', jsonb_build_object(
                             'novos',         v_novos,
                             'encerrados',    v_encerrados),
    'ocupacao_por_professora', v_ocupacao,
    'alunos_por_nivel',        v_niveis
  );
end;
$$;

comment on function public._admin_kpis_compute is
  'Núcleo dos 8 KPIs da home (pesquisa 07), SEM portão de papel — existe para o '
  'job diário rodar sem sessão. Fórmula v2: entradas e saídas do mês só contam '
  'o que JÁ aconteceu (started_on/ended_on <= hoje).';
