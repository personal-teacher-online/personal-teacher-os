-- =============================================================================
-- F2 · Onda Financeiro (PLAN-APPROVED 07/08/2026) — previsto por MENSALIDADE
--
-- A DECISÃO DO DONO (06/08, verbatim): "Por valor de contrato. O sistema lê o
-- contrato ativo e fala quanto tem no mês pra receber." No gate de 07/08 o
-- dono esclareceu o que "valor de contrato" significa NA VIDA REAL:
--   · a escola cobra VALOR FIXO POR MÊS (mês de 5 semanas não aumenta a conta);
--   · o valor é CADASTRADO por contrato (coluna nova), não derivado de slots;
--   · PAUSA NÃO DESCONTA a mensalidade (compensação é por crédito/reposição);
--   · mentoria fica fora do previsto, mas ganha LINHA DE REFERÊNCIA própria:
--     sessões do mês × alunos reservados × R$ 70 — rotulada como referência,
--     porque o caixa dela é da Hotmart (D12) e já entrou no dia da venda.
-- Isto SUBSTITUI os defaults D2/D3-parcial/D4-pausa do plano (o gate do F2 é
-- exatamente onde D1–D4 são confirmados OU CORRIGIDOS); a versão anterior
-- desta migration (por ocorrência de slot) nunca saiu da bancada local.
--
-- O que restou dos defaults: D1 (mentoria fora do PREVISTO) confirmado, agora
-- com referência ao lado; `ended_on`/fim de contrato confirmados; remarcação
-- e cancelamento seguem sem efeito (mensalidade não olha a agenda vivida).
--
-- MÊS PARCIAL CONTA CHEIO (decisão de rotina, registrada no goal): contrato
-- vigente em QUALQUER dia do mês prevê a mensalidade inteira — o previsto é
-- régua simples de "quanto os contratos de pé valem por mês"; ajuste fino de
-- primeiro/último mês é assunto da COBRANÇA real no Asaas, não desta conta.
--
-- POR QUE `definitions_version: 3` (o plano dizia 2, com dado velho): a v2 já
-- existe desde a retroativa nº 2. Fórmula nova cria versão nova, nunca
-- reescreve; snapshots antigos intactos (append-only); comparação da home
-- exige versões iguais e se recompõe sozinha. SEM backfill.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A mensalidade cadastrada. NULL = ainda não cadastrada — o previsto lê 0 e
--    a query do gate lista os sem-mensalidade (nunca inventar valor: fail-safe
--    para baixo, visível). Mentoria não usa a coluna (o CHECK barra > 0 nela
--    para o campo não virar caderno paralelo de preço de mentoria).
-- -----------------------------------------------------------------------------
alter table contracts add column monthly_value_cents int;

alter table contracts add constraint contracts_monthly_value_ok
  check (monthly_value_cents is null or monthly_value_cents >= 0);
alter table contracts add constraint contracts_monthly_value_private
  check (contract_type = 'private_1on1' or monthly_value_cents is null);

comment on column contracts.monthly_value_cents is
  'Mensalidade FIXA cadastrada (Onda Financeiro · F2, decisão do dono 07/08): '
  'o previsto do mês lê este valor — mês de 5 semanas não aumenta, pausa não '
  'desconta, remarcação não mexe. NULL = não cadastrada (previsto 0 + lista '
  'do gate). Só particulares; mentoria é Hotmart.';

-- -----------------------------------------------------------------------------
-- 2. A conta de UM contrato num mês. Vigente em algum dia do mês ⇒ mensalidade
--    cheia; `ended` ou fora da vigência ⇒ 0; mentoria ⇒ 0.
--    `language sql`, invoker, SEM grant de sessão (mesma decisão do Sol na
--    rodada 1: quem chama é `_admin_kpis_compute` — definer, owner — e o
--    `service_role`; superfície por contrato lê a própria coluna, e wrapper
--    futuro nasce gateado).
-- -----------------------------------------------------------------------------
create or replace function public.contract_previsto_no_mes_cents(
  p_contract uuid,
  p_month date
) returns bigint
language sql
stable
set search_path = public, pg_temp
as $$
  select case
           when c.contract_type <> 'private_1on1' then 0
           -- VIGÊNCIA decide, nunca o status (Sol, rodada 2 do F2):
           -- `admin_renew_contract` marca o contrato velho como `ended` NA HORA,
           -- com `ended_on` na véspera da virada FUTURA — pelo status, um
           -- contrato em pleno vigor sumiria do previsto no dia em que a
           -- renovação fosse agendada. ended_on inclusivo: o mês do fim conta.
           when c.started_on > (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date then 0
           when c.ended_on is not null and c.ended_on < date_trunc('month', p_month)::date then 0
           -- encerrado SEM data é encerrado de fato (defensivo — o fluxo sempre
           -- grava ended_on; sem ela, não há vigência que o sustente)
           when c.status = 'ended' and c.ended_on is null then 0
           -- A VIRADA NÃO CONTA DOBRADO: se o sucessor da renovação já está de
           -- pé dentro do mês, o mês é DELE — o antecessor sai. (Sucessor que
           -- só começa mês que vem deixa o antecessor contar este mês inteiro.)
           when exists (
             select 1 from contracts r
              where r.renewed_from = c.id
                and r.started_on <= (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date
           ) then 0
           else coalesce(c.monthly_value_cents, 0)
         end
    from contracts c
   where c.id = p_contract
$$;

comment on function public.contract_previsto_no_mes_cents(uuid, date) is
  'Previsto do mês de UM contrato particular = mensalidade cadastrada '
  '(monthly_value_cents), decidida pela VIGÊNCIA (started_on/ended_on '
  'inclusivo), nunca pelo status — renovação agendada marca ended com data '
  'futura e o contrato segue valendo. Sucessor de pé no mês ⇒ o antecessor '
  'sai (virada nunca conta dobrado). Pausa NÃO desconta; mês parcial conta '
  'cheio; mentoria = 0; sem mensalidade = 0 (lista do gate). Fórmula da v3.';

revoke execute on function public.contract_previsto_no_mes_cents(uuid, date) from public, anon, authenticated;
grant execute on function public.contract_previsto_no_mes_cents(uuid, date) to service_role;

-- -----------------------------------------------------------------------------
-- 3. A porta de cadastro da mensalidade (Lei 3 + Lei 8): RPC admin, auditada.
--    Aceita NULL explícito (despublicar o valor volta o contrato à lista dos
--    sem-mensalidade — nunca um zero silencioso por engano de digitação).
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_contract_monthly_value(
  p_contract uuid,
  p_cents int,
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old contracts%rowtype;
  v_actor uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_set_contract_monthly_value é restrita à admin';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select * into v_old from contracts where id = p_contract for update;
  if not found then
    raise exception 'contrato % não existe', p_contract;
  end if;
  if v_old.status = 'ended' then
    raise exception 'contrato encerrado não muda de mensalidade';
  end if;
  if v_old.contract_type <> 'private_1on1' then
    raise exception 'mensalidade é de contrato particular (mentoria é Hotmart)';
  end if;
  if p_cents is not null and p_cents < 0 then
    raise exception 'mensalidade não pode ser negativa';
  end if;

  update contracts set monthly_value_cents = p_cents where id = p_contract;

  perform public.log_audit(v_actor, 'set_contract_monthly_value', 'contracts',
    p_contract::text,
    jsonb_build_object('de', v_old.monthly_value_cents, 'para', p_cents));
end;
$$;

comment on function public.admin_set_contract_monthly_value(uuid, int, uuid) is
  'Cadastra/edita a mensalidade fixa do contrato particular (F2). Admin-only, '
  'audit_log com de→para. NULL explícito = despublicar (volta à lista dos '
  'sem-mensalidade do gate).';

revoke execute on function public.admin_set_contract_monthly_value(uuid, int, uuid) from public, anon;
grant execute on function public.admin_set_contract_monthly_value(uuid, int, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. `_admin_kpis_compute` v3 — MESMO corpo da v2 (20260726000300) exceto:
--    · previsto: Σ contract_previsto_no_mes_cents dos particulares não-ended;
--    · previsto_mentoria_cents: deixa de ser 0 fixo e vira REFERÊNCIA —
--      sessões do mês (não canceladas) × alunos reservados × R$ 70/aluno.
--      É régua de leitura, não caixa: o dinheiro entrou na Hotmart na venda.
--    · `definitions_version`: 3; comment atualizado.
-- -----------------------------------------------------------------------------
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
  v_mentoria_ref  bigint;
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

  -- F2 (v3): previsto pela MENSALIDADE cadastrada dos contratos de pé no mês.
  -- Filtro por VIGÊNCIA, não por status (renovação agendada marca `ended` com
  -- data futura); a função re-checa tudo — aqui só se estreita o laço.
  select coalesce(sum(public.contract_previsto_no_mes_cents(c.id, v_month_start)), 0)
    into v_previsto
    from contracts c
   where c.contract_type = 'private_1on1'
     and c.started_on < v_month_end
     and (c.ended_on is null or c.ended_on >= v_month_start)
     and not (c.status = 'ended' and c.ended_on is null);

  -- F2 (v3): a REFERÊNCIA da mentoria — R$ 70/aluno por sessão do mês. Não é
  -- caixa (Hotmart, D12); é a régua de leitura que o dono pediu no gate.
  select coalesce(sum(ms.booked_count), 0) * 7000
    into v_mentoria_ref
    from mentorship_sessions ms
   where ms.status <> 'cancelled'
     and (ms.scheduled_at at time zone v_tz)::date >= v_month_start
     and (ms.scheduled_at at time zone v_tz)::date <  v_month_end;

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
    'definitions_version', 3,
    'generated_at',        v_now,
    'business_date',       v_today,
    'month',               to_char(v_month_start, 'YYYY-MM'),
    'week_start',          v_week_start,
    'recebido_no_mes_cents',      v_recebido,
    'previsto_no_mes_cents',      v_previsto,
    -- v3: REFERÊNCIA (sessões × alunos × R$70), não caixa — o dinheiro da
    -- mentoria é da Hotmart e entrou no dia da venda (D12). A home rotula.
    'previsto_mentoria_cents',    v_mentoria_ref,
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
  'job diário rodar sem sessão. Fórmula v3 (Onda Financeiro · F2): previsto = '
  'mensalidade cadastrada dos contratos particulares de pé '
  '(contract_previsto_no_mes_cents); mentoria vira linha de REFERÊNCIA '
  '(sessões do mês × reservas × R$70 — não é caixa, é régua); entradas/saídas '
  'seguem cortadas em v_today (v2). Rollback: migration v3-bis recolando o '
  'bloco da 20260726000300 (goal da onda, §F2).';
