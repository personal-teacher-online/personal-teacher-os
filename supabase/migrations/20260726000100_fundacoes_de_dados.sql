-- Lote "Fundações de dados" (docs/goals/lote-2026-07-26-fundacoes-de-dados.md).
--
-- Quatro coisas que NÃO se reconstroem depois: histórico de KPI, versão de
-- política aceita, uso real da UI e erro de cliente só existem se começarem a
-- ser gravados agora. Nada aqui é UI; tudo é fundação de dado.
--
--  1. admin_kpis() + kpi_snapshots + job diário (contrato dos 8 números da home)
--  2. policy_versions + policy_acceptances (aceite versionado, aditivo à ciência)
--  3. ui_events (telemetria de primeira parte, LGPD-mínima)
--  4. client_errors (erro de navegador, deduplicado por hash)
--  5. admin_anonymize_student passa a desidentificar 3 e 4
--
-- Leis: 3 (regra no Postgres), 4 (RLS negar-por-padrão + app_metadata),
-- 5 (pg_cron, zero infra nova), 8 (auditoria), 9 (centavos).

-- ===========================================================================
-- 1. KPIs COMO CONTRATO NO BANCO
-- ===========================================================================
--
-- Os 8 números vêm da pesquisa 07 (docs/research/07-dashboard-home-por-papel).
-- A fórmula mora AQUI, não na página: a home ainda nem os mostra, mas o
-- snapshot diário começa hoje e um número calculado em dois lugares vira dois
-- números diferentes na primeira divergência.
--
-- DEFINIÇÕES v1 (o campo definitions_version existe para refinar sem destruir
-- histórico — mudança de fórmula = versão nova, nunca reescrita do passado):
--
-- Régua comum às TRÊS contas de dinheiro (revisão adversarial de 26/07): uma
-- cobrança ESTORNADA, com chargeback, cancelada ou apagada não é dinheiro —
-- nem recebido, nem previsto, nem em atraso. Ver payment_nao_cobravel abaixo.
--
-- · recebido_no_mes_cents — cobranças PAGAS cuja quitação cai no mês corrente
--   e cujo status ATUAL ainda é cobrável. "Paga" segue a régua que a UI já usa
--   desde a Fase 2 (src/app/admin/pagamentos): paid_at preenchido OU status em
--   (received, confirmed, received_in_cash). O Asaas manda status em CAIXA
--   ALTA e o espelho grava cru, por isso todo confronto de status é lower().
--   Data da quitação = paid_at na data civil do NEGÓCIO (Lei 1); quando o
--   evento veio sem paymentDate (paid_at nulo mas status pago), cai no
--   due_date — melhor atribuir ao mês do vencimento do que sumir do caixa.
--   O estorno é decidido pelo status ATUAL da linha, não por um evento
--   separado: o espelho do Asaas sobrescreve o status da cobrança, então uma
--   linha REFUNDED some do recebido no mês seguinte à devolução TAMBÉM
--   retroativamente (o caixa do mês passado passa a mostrar o valor devolvido
--   fora dele). É a leitura correta para "quanto entrou e FICOU".
--
-- · previsto_no_mes_cents — soma das COBRANÇAS (espelho do Asaas) com
--   VENCIMENTO no mês corrente, pagas e a pagar, fora as não-cobráveis.
--   ⚠️ Definição trocada na revisão de 26/07. A v0 derivava o previsto da
--   AGENDA (aula não cancelada × hourly_rate_cents), o que contava aula que
--   nunca vira fatura e ignorava cobrança avulsa/parcelada — dois números
--   diferentes para a mesma pergunta. Previsto agora é o que a escola vai
--   COBRAR no mês, que é o que a dona compara com o extrato do Asaas.
--   Não há perna de mentoria: a receita do Personal Travel é vendida na
--   HOTMART e não passa por payments — `previsto_mentoria_cents` fica em 0,
--   explicitamente, para o cartão não sugerir que a conta a inclui.
--
-- · em_atraso_cents / familias_em_atraso — cobrança vencida (due_date < hoje),
--   não paga pela MESMA régua acima e ainda cobrável. Família = pagador
--   (payers); cobrança sem pagador conta pelo contrato.
--
-- · alunos_ativos — alunos distintos com contrato ativo (inclui membro de
--   grupo). Um aluno que faz particular E mentoria conta 1 no total e 1 em
--   cada perna: total <= particulares + travel, de propósito.
--
-- · aulas_da_semana — semana de SEGUNDA a domingo (a agenda do painel abre na
--   segunda), fronteiras convertidas no fuso do negócio. Total ignora
--   cancelada e remarcada (a remarcada vira outra instância — contá-la
--   dobraria a aula); restantes = ainda agendadas daqui para a frente.
--
-- · entradas_saidas_do_mes — contratos que começaram / terminaram no mês.
--   Renovação não é entrada nem saída: contrato com renewed_from não entra,
--   e contrato encerrado que virou outro (alguém aponta renewed_from para ele)
--   não sai. Contagem absoluta, nunca churn % (n=20).
--
-- · ocupacao_por_professora — horas de aula da semana ÷ horas de janela
--   semanal (F3-D6/D7). Exceções pontuais de agenda não entram na v1: a
--   pergunta é "cabe aluno novo?", que se responde pela janela regular.
--
-- · alunos_por_nivel — contagem por nível Flexge entre os alunos ativos,
--   incluindo o balde "sem nível" (que é justamente o que a dona quer ver).

-- Estado NÃO-COBRÁVEL de uma cobrança, em um lugar só. Por padrão de texto e
-- não por lista fechada porque o Asaas tem uma família inteira de status para
-- cada desfecho (REFUNDED, REFUND_REQUESTED, CHARGEBACK_REQUESTED,
-- CHARGEBACK_DISPUTE, AWAITING_CHARGEBACK_REVERSAL, PAYMENT_DELETED,
-- CANCELED/CANCELLED…) e uma lista fechada envelhece calada — o modo de falha
-- de esquecer um status é contar dinheiro que não existe.
-- Conservador de propósito: em disputa de chargeback, o valor sai da conta até
-- o Asaas devolvê-lo a um status cobrável.
create or replace function public.payment_nao_cobravel(p_status text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select lower(coalesce(p_status, '')) ~ '(refund|chargeback|cancel|delet)'
$$;

comment on function public.payment_nao_cobravel is
  'Cobrança estornada / com chargeback / cancelada / apagada não é dinheiro: '
  'fica fora do recebido, do previsto e do em-atraso. Case-insensitive (o '
  'espelho do Asaas grava o status CRU, em caixa alta).';

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
  select count(*) into v_novos
    from contracts c
   where c.renewed_from is null
     and c.started_on >= v_month_start
     and c.started_on <  v_month_end;

  select count(*) into v_encerrados
    from contracts c
   where c.status = 'ended'
     and c.ended_on >= v_month_start
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
    'definitions_version', 1,
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
  'job diário rodar sem sessão. Toda leitura de gente passa por admin_kpis().';

revoke execute on function public._admin_kpis_compute() from public, anon, authenticated;

create or replace function public.admin_kpis()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'admin_kpis é restrita à admin';
  end if;
  return public._admin_kpis_compute();
end;
$$;

comment on function public.admin_kpis is
  'Os 8 números do painel da dona (pesquisa 07), na fórmula versionada v1. '
  'Dinheiro em centavos (Lei 9); datas na data civil do negócio (Lei 1).';

revoke execute on function public.admin_kpis() from public, anon;
grant execute on function public.admin_kpis() to authenticated, service_role;

-- --------------------------------------------------------------- snapshots
create table kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_on date not null default public.business_today(),
  definitions_version int not null check (definitions_version >= 1),
  data jsonb not null,
  created_at timestamptz not null default now(),
  constraint kpi_snapshots_captured_on_uniq unique (captured_on)
);

comment on table kpi_snapshots is
  'Foto diária dos KPIs (append-only). Histórico não se reconstrói: sem isto, '
  '"como estávamos em agosto" é pergunta sem resposta. A fórmula fica gravada '
  'em definitions_version — refinar a conta cria versão nova, não reescreve o '
  'passado.';

create trigger kpi_snapshots_append_only
  before update or delete on kpi_snapshots
  for each row execute function public.forbid_mutation();

create trigger kpi_snapshots_no_truncate
  before truncate on kpi_snapshots
  for each statement execute function public.forbid_mutation();

alter table kpi_snapshots enable row level security;

create policy kpi_snapshots_admin_read on kpi_snapshots
  for select to authenticated
  using ((select public.app_role()) = 'admin');

revoke insert, update, delete, truncate on kpi_snapshots
  from anon, authenticated, service_role;
-- anon também recebe SELECT: a convenção da casa (rls.test.ts) manda o anônimo
-- ver VAZIO, nunca "permission denied" — o erro vaza que a tabela existe.
grant select on kpi_snapshots to anon, authenticated, service_role;

create or replace function public.capture_kpi_snapshot()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_data jsonb := public._admin_kpis_compute();
  v_rows int;
begin
  insert into kpi_snapshots (captured_on, definitions_version, data)
  values (public.business_today(), (v_data ->> 'definitions_version')::int, v_data)
  on conflict (captured_on) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

comment on function public.capture_kpi_snapshot is
  'Grava a foto do dia (idempotente pelo UNIQUE(captured_on)). Roda pelo '
  'pg_cron às 07:00 UTC — 03:00/04:00 em Cuiabá, com o dia do negócio já '
  'virado e o movimento do dia anterior fechado.';

revoke execute on function public.capture_kpi_snapshot() from public, anon, authenticated;
grant execute on function public.capture_kpi_snapshot() to service_role;

select cron.schedule(
  'capture-kpi-snapshot-daily',
  '0 7 * * *',
  $$select public.capture_kpi_snapshot()$$
);

-- ===========================================================================
-- 2. POLÍTICA COM VERSÃO + ACEITE VERSIONADO
-- ===========================================================================
--
-- Hoje o aceite da ciência é um timestamp em profiles: sabe-se QUANDO a pessoa
-- concordou, não COM O QUÊ. Quando o texto mudar (as cláusulas do advogado
-- estão no gate ALUNOS), o carimbo antigo passa a apontar para um texto que
-- ninguém leu. Estas duas tabelas guardam o texto e o aceite juntos.

create table policy_versions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind ~ '^[a-z0-9-]+$'),
  version int not null check (version >= 1),
  body_md text not null check (btrim(body_md) <> ''),
  effective_from date not null default public.business_today(),
  created_at timestamptz not null default now(),
  constraint policy_versions_kind_version_uniq unique (kind, version)
);

comment on table policy_versions is
  'Texto de política, versionado e append-only. Corrigir texto = versão nova '
  '(a antiga é o que alguém já aceitou — reescrevê-la seria falsificar o '
  'aceite).';

create trigger policy_versions_append_only
  before update or delete on policy_versions
  for each row execute function public.forbid_mutation();

create trigger policy_versions_no_truncate
  before truncate on policy_versions
  for each statement execute function public.forbid_mutation();

create trigger policy_versions_audit
  after insert on policy_versions
  for each row execute function public.audit_row_change();

alter table policy_versions enable row level security;

create policy policy_versions_admin on policy_versions
  for select to authenticated
  using ((select public.app_role()) = 'admin');

-- O aluno precisa ler o texto que está aceitando (e reler depois).
create policy policy_versions_read_vigente on policy_versions
  for select to authenticated
  using (effective_from <= public.business_today());

revoke insert, update, delete, truncate on policy_versions
  from anon, authenticated, service_role;
grant select on policy_versions to anon, authenticated, service_role;

create table policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students (id),
  policy_version_id uuid not null references policy_versions (id),
  accepted_at timestamptz not null default now(),
  channel text not null default 'portal' check (channel in ('portal', 'whatsapp', 'papel')),
  constraint policy_acceptances_uma_por_versao unique (student_id, policy_version_id)
);

comment on table policy_acceptances is
  'Quem aceitou qual VERSÃO de qual política, e por onde. Append-only: aceite '
  'não se apaga nem se corrige — a correção é aceitar a versão nova.';

create index policy_acceptances_student_idx on policy_acceptances (student_id, accepted_at desc);

create trigger policy_acceptances_append_only
  before update or delete on policy_acceptances
  for each row execute function public.forbid_mutation();

create trigger policy_acceptances_no_truncate
  before truncate on policy_acceptances
  for each statement execute function public.forbid_mutation();

create trigger policy_acceptances_audit
  after insert on policy_acceptances
  for each row execute function public.audit_row_change();

alter table policy_acceptances enable row level security;

create policy policy_acceptances_admin on policy_acceptances
  for select to authenticated
  using ((select public.app_role()) = 'admin');

create policy policy_acceptances_self on policy_acceptances
  for select to authenticated
  using (student_id in (select public.my_student_ids()));

revoke insert, update, delete, truncate on policy_acceptances
  from anon, authenticated, service_role;
grant select on policy_acceptances to anon, authenticated, service_role;

-- v1 = o texto LITERAL que /portal/ciencia mostra hoje (nada reescrito).
--
-- ⚠️ O `kind` é 'ciencia-canais', não 'remarcacao-cancelamento' como a spec
-- rascunhou: a tela de ciência fala de CANAL DE AVISO, não de remarcação nem
-- de cancelamento. Semear o texto dos canais sob o rótulo de cancelamento
-- faria o histórico dizer que 20 alunos aceitaram a política de cancelamento
-- — exatamente o que esta tabela existe para NÃO deixar acontecer. A política
-- de remarcação/cancelamento (ADR-018 + cláusulas do advogado, gate ALUNOS)
-- entra como um `kind` próprio quando o texto existir.
insert into policy_versions (kind, version, body_md, effective_from) values (
  'ciencia-canais',
  1,
  '## Canais de aviso' || E'\n\n' ||
  'Os avisos da Personal Teacher — lembretes de aula, remarcações, créditos — ' ||
  'chegam por **e-mail** e, quando você tem número cadastrado, por **WhatsApp**. ' ||
  'Esses são os nossos canais oficiais de comunicação.',
  '2026-07-26'
);

-- "Vigente" é regra de negócio, então mora AQUI (Lei 3) e não em cada tela:
-- maior versão do tipo cuja vigência já começou. A página de ciência LÊ o
-- texto por esta função (nada de texto martelado no TSX) e a RPC de aceite
-- confere contra ela — os dois lados leem a mesma definição.
create or replace function public.policy_vigente(p_kind text)
returns table (id uuid, kind text, version int, body_md text, effective_from date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pv.id, pv.kind, pv.version, pv.body_md, pv.effective_from
    from policy_versions pv
   where pv.kind = p_kind
     and pv.effective_from <= public.business_today()
   order by pv.version desc
   limit 1
$$;

comment on function public.policy_vigente is
  'Versão em vigor de uma política (maior version com effective_from já '
  'alcançado). Fonte única do texto exibido E do id conferido no aceite.';

revoke execute on function public.policy_vigente(text) from public, anon;
grant execute on function public.policy_vigente(text) to authenticated, service_role;

-- A ciência passa a registrar o aceite VERSIONADO na mesma transação do
-- carimbo antigo (aditivo — profiles.whatsapp_channel_ack_at continua sendo a
-- fonte do "já viu a tela?"). Uma transação só: não existe estado em que o
-- carimbo existe e o aceite não.
--
-- ⚠️ Assinatura NOVA (revisão adversarial 26/07): a função recebe o
-- `policy_version_id` que a PÁGINA RENDERIZOU e recusa se não for o vigente no
-- momento do INSERT. Sem isso, o aceite provaria apenas "clicou no botão", e
-- numa corrida com a publicação de uma v2 o histórico registraria que o aluno
-- concordou com um texto que nunca esteve na tela dele.
--
-- FORA DESTE LOTE (anotado de propósito): re-perguntar aos alunos ANTIGOS
-- quando uma v2 for publicada. Hoje o portão da tela é
-- profiles.whatsapp_channel_ack_at (carimbo único), então quem já aceitou a v1
-- não reveria a v2. Não há aluno real convidado ainda — quando as cláusulas do
-- advogado virarem v2 (gate ALUNOS), o portão passa a ser "existe aceite da
-- versão vigente?" e vira lote próprio.
drop function if exists public.ack_channel_notice();

create or replace function public.ack_channel_notice(p_policy_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid;
  v_vigente uuid;
begin
  if auth.uid() is null then
    raise exception 'sessão necessária';
  end if;

  select v.id into v_vigente from public.policy_vigente('ciencia-canais') v;
  if v_vigente is null then
    raise exception 'nenhuma versão vigente da política de canais';
  end if;
  if p_policy_version_id is null or p_policy_version_id <> v_vigente then
    raise exception 'politica-desatualizada: o texto mudou enquanto esta página estava aberta — recarregue para ler a versão vigente';
  end if;

  update profiles set whatsapp_channel_ack_at = coalesce(whatsapp_channel_ack_at, now())
   where id = auth.uid();
  perform public.log_audit(auth.uid(), 'ack_channel_notice', 'profiles', auth.uid()::text,
    jsonb_build_object('at', now(), 'policy_version_id', v_vigente));

  -- Só aluno aceita política de aluno; quem não tem ficha (professora testando
  -- o portal, por exemplo) apenas carimba e segue.
  select s.id into v_student from students s where s.profile_id = auth.uid();
  if v_student is null then
    return;
  end if;
  insert into policy_acceptances (student_id, policy_version_id, channel)
  values (v_student, v_vigente, 'portal')
  on conflict (student_id, policy_version_id) do nothing;
end;
$$;

comment on function public.ack_channel_notice is
  'Ciência do canal oficial: confere que a versão exibida ainda é a vigente, '
  'carimba o perfil (como sempre) e registra o aceite VERSIONADO em '
  'policy_acceptances, tudo na mesma transação. Idempotente nos dois lados.';

revoke execute on function public.ack_channel_notice(uuid) from public, anon;
grant execute on function public.ack_channel_notice(uuid) to authenticated;

-- ===========================================================================
-- 3. ui_events — TELEMETRIA DE PRIMEIRA PARTE
-- ===========================================================================
--
-- "Que telas a dona realmente usa?" só se responde com o registro do uso,
-- e registro que não começou não se recupera. LGPD-mínimo: caminho, papel e
-- (quando há sessão) o usuário. SEM IP e SEM user-agent — nada que sirva para
-- fingerprint. Nada de SaaS de telemetria (Lei 5).

create table ui_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_id uuid references profiles (id),
  role text check (role is null or role in ('admin', 'teacher', 'student', 'sales')),
  path text not null check (btrim(path) <> '' and length(path) <= 300),
  event text not null default 'page_view' check (event ~ '^[a-z_]{3,40}$'),
  meta jsonb not null default '{}'::jsonb
);

comment on table ui_events is
  'Uso real da UI (v1: page_view). Sem IP e sem user-agent — de propósito. '
  'Escrita só pelo servidor, via record_ui_event.';

create index ui_events_at_idx on ui_events (at desc);
create index ui_events_user_idx on ui_events (user_id, at desc);

alter table ui_events enable row level security;

create policy ui_events_admin_read on ui_events
  for select to authenticated
  using ((select public.app_role()) = 'admin');

revoke insert, update, delete, truncate on ui_events
  from anon, authenticated, service_role;
grant select on ui_events to anon, authenticated, service_role;

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
as $$
begin
  -- Caps no BANCO também: telemetria nunca derruba nada, nem por payload
  -- gigante vindo de um cliente esquisito.
  insert into ui_events (user_id, role, path, event, meta)
  values (
    p_user,
    nullif(p_role, ''),
    left(coalesce(nullif(btrim(p_path), ''), '/'), 300),
    coalesce(nullif(p_event, ''), 'page_view'),
    case when p_meta is null or jsonb_typeof(p_meta) <> 'object'
         then '{}'::jsonb else p_meta end
  );
end;
$$;

revoke execute on function public.record_ui_event(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_ui_event(uuid, text, text, text, jsonb) to service_role;

-- ===========================================================================
-- 4. client_errors — ERRO QUE ACONTECE NO NAVEGADOR
-- ===========================================================================
--
-- Hoje um erro de cliente morre na tela do usuário: quem não avisa pelo
-- WhatsApp, some. Uma linha por assinatura (hash de tipo + mensagem + caminho
-- normalizados) POR USUÁRIO, com contador — 300 vezes o mesmo erro é UMA linha
-- com count=300, não 300 linhas.
--
-- ⚠️ A chave é (hash, user_id), não hash sozinho (revisão adversarial 26/07).
-- Com o hash global, a PRIMEIRA pessoa a topar com o defeito ficava dona da
-- linha para sempre: o export LGPD de todos os outros saía vazio, a
-- anonimização de um só desidentificava a linha de todo mundo, e não dava para
-- responder "quantas pessoas distintas bateram nisso?". Cada usuário tem o seu
-- balde e o anônimo (user_id null) tem o dele — NULLS NOT DISTINCT para o
-- balde anônimo ser UM, e não uma linha nova por ocorrência.
-- A contagem global de um defeito passa a ser a SOMA dos baldes daquele hash.

create table client_errors (
  id uuid primary key default gen_random_uuid(),
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  count int not null default 1 check (count >= 1),
  message text not null check (btrim(message) <> '' and length(message) <= 500),
  stack text check (length(stack) <= 4000),
  path text check (length(path) <= 300),
  user_id uuid references profiles (id),
  constraint client_errors_hash_user_uniq unique nulls not distinct (hash, user_id)
);

comment on table client_errors is
  'Erros de navegador, deduplicados por (hash, user_id) — hash = sha-256 de '
  'tipo+mensagem+caminho normalizados. Contagem global do defeito = soma dos '
  'baldes do mesmo hash. Escrita só pelo servidor, via record_client_error.';

create index client_errors_last_at_idx on client_errors (last_at desc);
create index client_errors_user_idx on client_errors (user_id);
-- "quantos baldes tem este defeito?" é a pergunta de triagem
create index client_errors_hash_idx on client_errors (hash);

alter table client_errors enable row level security;

create policy client_errors_admin_read on client_errors
  for select to authenticated
  using ((select public.app_role()) = 'admin');

revoke insert, update, delete, truncate on client_errors
  from anon, authenticated, service_role;
grant select on client_errors to anon, authenticated, service_role;

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
as $$
declare
  v_id uuid;
begin
  if p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'hash inválido (esperado sha-256 hex)';
  end if;
  insert into client_errors (hash, message, stack, path, user_id)
  values (
    p_hash,
    left(coalesce(nullif(btrim(p_message), ''), 'erro sem mensagem'), 500),
    left(nullif(btrim(coalesce(p_stack, '')), ''), 4000),
    left(nullif(btrim(coalesce(p_path, '')), ''), 300),
    p_user
  )
  -- Um balde por (assinatura, pessoa): a repetição soma no balde de QUEM
  -- topou com o defeito, e o export/anonimização de cada um alcança só o seu.
  on conflict (hash, user_id) do update
     set last_at = now(),
         count = client_errors.count + 1
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.record_client_error(text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_client_error(text, text, text, text, uuid) to service_role;

-- ===========================================================================
-- 5. ANONIMIZAÇÃO ALCANÇA A TELEMETRIA
-- ===========================================================================
--
-- Recriação de admin_anonymize_student (F7/M4-5 + M11-4) com UM acréscimo: o
-- user_id em ui_events e client_errors é zerado. O evento continua (a série
-- histórica de uso não pode ter buraco), desidentificado.

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
    update profiles
       set full_name = 'Ex-aluno(a)',
           whatsapp_e164 = null,
           email_bounced_at = null,
           email_bounce_reason = null
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
