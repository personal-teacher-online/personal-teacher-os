-- Fase 3 / M0.2 — Outbox de notificações + aviso de crédito vencendo (F3-D4).
-- Quem DECIDE quem recebe é SQL (Lei 3); o ENVIO é do app (rota fina com token,
-- despachada por agendador externo — decisão P3 + ADR do desvio da Lei 5 no M3).

-- ---------------------------------------------------------------------------
-- 1) FIFO compartilhado: multiconjunto de expires_on RESTANTES de um contrato.
--    Extraído de makeup_balance (20260711000500) SEM mudar a semântica: o gasto
--    consome o crédito de expiração mais próxima AINDA VÁLIDO NA DATA DO GASTO;
--    crédito expirado sem uso morre e não absorve gasto posterior. makeup_balance
--    passa a delegar (Lei 7: migration NOVA; a antiga fica intocada).
--    Um replay "ingênuo" aqui geraria AVISO FALSO (caso de teste 17 do goal).
--    ⚠️ NÃO é SECURITY DEFINER — igual ao makeup_balance original: o RLS do
--    CHAMADOR decide quais linhas do ledger existem (aluno só computa o próprio
--    contrato; o enqueue, SECURITY DEFINER, executa como owner e vê tudo).
-- ---------------------------------------------------------------------------
create or replace function public.makeup_remaining_expiries(p_contract uuid)
returns setof date
language plpgsql
stable
as $$
declare
  r record;
  v_expiries date[] := array[]::date[];
  v_spend_date date;
  v_pick int;
  i int;
begin
  for r in
    select delta, expires_on, created_at
    from makeup_ledger
    where contract_id = p_contract
    order by created_at, id
  loop
    if r.delta > 0 then
      for i in 1 .. r.delta loop
        v_expiries := v_expiries || coalesce(r.expires_on, 'infinity'::date);
      end loop;
    else
      v_spend_date := (r.created_at at time zone public.business_tz())::date;
      for i in 1 .. -r.delta loop
        v_pick := null;
        select idx into v_pick
        from unnest(v_expiries) with ordinality as t (exp, idx)
        where t.exp >= v_spend_date
        order by t.exp, t.idx
        limit 1;
        if v_pick is not null then
          v_expiries := v_expiries[1:v_pick - 1] || v_expiries[v_pick + 1:];
        end if;
        -- Sem crédito válido na época (anomalia via manual_adjust): o gasto
        -- excedente cai no vazio — mesma regra de makeup_balance.
      end loop;
    end if;
  end loop;
  return query select e from unnest(v_expiries) e;
end;
$$;

-- makeup_balance delega ao FIFO compartilhado — comportamento byte a byte igual
-- (a suíte da Fase 1/2 é o pino: caso de teste 32 do goal). Continua NÃO-definer,
-- como o original: quem chama só computa o que o próprio RLS deixa ver.
create or replace function public.makeup_balance(p_contract uuid)
returns int
language sql
stable
as $$
  select count(*)::int
  from public.makeup_remaining_expiries(p_contract) e
  where e >= public.business_today()
$$;

-- ---------------------------------------------------------------------------
-- 2) notification_outbox — genérico (serve e-mail 5 hoje; WhatsApp/futuras depois).
--    deny-all: nenhuma policy de escrita; INSERT só pela função de enqueue
--    (SECURITY DEFINER); leitura/UPDATE do despachante via service_role (ADR-012);
--    leitura de monitoramento para a admin (linhas com erro — F3-D4 "aluno sem login").
-- ---------------------------------------------------------------------------
create table notification_outbox (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'email',
  template text not null,
  recipient_profile_id uuid references profiles (id),
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
comment on table notification_outbox is
  'Outbox de notificações (F3-D4). Entrega at-least-once: o despachante seleciona '
  'sent_at IS NULL AND scheduled_for <= now() (com ou sem error) e marca sent_at/error. '
  'recipient_profile_id NULLABLE: aluno sem login vira erro no DESPACHO, nunca skip '
  'silencioso no enqueue (payload carrega student_id para resolução tardia).';

create index notification_outbox_pending_idx
  on notification_outbox (scheduled_for)
  where sent_at is null;

alter table notification_outbox enable row level security;

-- Superfície mínima de monitoramento (padrão admin_all de leitura; escrita NUNCA).
create policy notification_outbox_admin_read on notification_outbox
  for select to authenticated
  using ((select public.app_role()) = 'admin');

-- Padrão da casa (teste-pino do caso 12/F1): toda tabela concede SELECT a
-- anon/authenticated e o RLS decide as LINHAS (anon/não-admin leem zero linhas,
-- sem erro de permissão).
grant select on notification_outbox to anon, authenticated;

-- Despachante server-side (ADR-012: grant cirúrgico; RLS não se aplica a service_role).
grant select on notification_outbox to service_role;
grant update (sent_at, error) on notification_outbox to service_role;

-- ---------------------------------------------------------------------------
-- 3) enqueue_credit_expiry_notices — o e-mail 5 (marcos 30/15) decidido em SQL.
--    Semântica de JANELA auto-recuperável (F3-D4): marco atingido quando
--    expires_on - p_today <= marco (expires_on = ÚLTIMO dia válido, régua do
--    makeup_balance), ainda não avisado (dedupe) e crédito não expirado/gasto (FIFO).
--    P2 (12/07/2026): crédito já dentro dos DOIS marcos → UM e-mail (marco 15);
--    a linha do marco 30 é inserida JÁ COBERTA (sent_at = now()) para o marco 30
--    nunca "renascer" depois do 15 (a condição <= 30 continuaria verdadeira).
--    dedupe_key POR DESTINATÁRIO usa student_id (estável; profile pode ser NULL
--    e mudar): '{template}:{contract}:{student}:{expires_on}:{marco}'.
--    Aritmética de dia SEMPRE por business_today() (pg_cron roda em UTC) — p_today
--    injetável nos testes.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_credit_expiry_notices(
  p_today date default public.business_today()
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract record;
  v_expiry record;
  v_student record;
  v_marco int;
  v_inserted int := 0;
  v_rows int;
  v_wa boolean;
begin
  for v_contract in
    select distinct ml.contract_id, c.student_id, c.student_group_id
    from makeup_ledger ml
    join contracts c on c.id = ml.contract_id
    where c.status = 'active'
  loop
    for v_expiry in
      select e as expires_on, count(*)::int as n_credits
      from public.makeup_remaining_expiries(v_contract.contract_id) e
      -- Comparação por soma (e <= p_today + N), nunca subtração: 'infinity'::date
      -- (crédito sem validade) compara normalmente mas EXPLODE em subtração.
      where e >= p_today                      -- não expirado
        and e <= p_today + 30                 -- dentro do maior marco (exclui infinity)
      group by e
    loop
      -- P2: um e-mail só — o marco efetivo é o mais apertado pendente.
      v_marco := case when v_expiry.expires_on <= p_today + 15 then 15 else 30 end;

      for v_student in
        select s.id as student_id, s.profile_id
        from students s
        where s.id = v_contract.student_id
        union
        select s.id, s.profile_id
        from student_group_members m
        join students s on s.id = m.student_id
        where m.group_id = v_contract.student_group_id
      loop
        -- Marco efetivo: linha real, a enviar.
        insert into notification_outbox (template, recipient_profile_id, payload, dedupe_key)
        values (
          'credit-expiry',
          v_student.profile_id,
          jsonb_build_object(
            'contract_id', v_contract.contract_id,
            'student_id', v_student.student_id,
            'expires_on', v_expiry.expires_on,
            'marco', v_marco,
            'n_credits', v_expiry.n_credits
          ),
          format('credit-expiry:%s:%s:%s:%s',
                 v_contract.contract_id, v_student.student_id, v_expiry.expires_on, v_marco)
        )
        on conflict (dedupe_key) do nothing;
        get diagnostics v_rows = row_count;
        v_inserted := v_inserted + v_rows;

        -- F3-D8/ADR-016 (12/07/2026): aviso TAMBÉM por WhatsApp quando o aluno tem
        -- login + OPT-IN + telefone (consentimento é re-checado no ENVIO). Uma linha
        -- por CANAL por destinatário — dedupe com sufixo ':wa'.
        v_wa := false;
        if v_student.profile_id is not null then
          select p.whatsapp_opt_in and p.whatsapp_e164 is not null into v_wa
          from profiles p where p.id = v_student.profile_id;
        end if;
        if coalesce(v_wa, false) then
          insert into notification_outbox (channel, template, recipient_profile_id, payload, dedupe_key)
          values (
            'whatsapp', 'credit-expiry', v_student.profile_id,
            jsonb_build_object(
              'contract_id', v_contract.contract_id,
              'student_id', v_student.student_id,
              'expires_on', v_expiry.expires_on,
              'marco', v_marco,
              'n_credits', v_expiry.n_credits
            ),
            format('credit-expiry:%s:%s:%s:%s:wa',
                   v_contract.contract_id, v_student.student_id, v_expiry.expires_on, v_marco)
          )
          on conflict (dedupe_key) do nothing;
          get diagnostics v_rows = row_count;
          v_inserted := v_inserted + v_rows;
          if v_marco = 15 then
            insert into notification_outbox
              (channel, template, recipient_profile_id, payload, dedupe_key, sent_at)
            values (
              'whatsapp', 'credit-expiry', v_student.profile_id,
              jsonb_build_object(
                'contract_id', v_contract.contract_id,
                'student_id', v_student.student_id,
                'expires_on', v_expiry.expires_on,
                'marco', 30,
                'covered_by', 15
              ),
              format('credit-expiry:%s:%s:%s:%s:wa',
                     v_contract.contract_id, v_student.student_id, v_expiry.expires_on, 30),
              now()
            )
            on conflict (dedupe_key) do nothing;
          end if;
        end if;

        -- P2: se o marco efetivo é o 15 e o 30 nunca foi avisado, registra o 30
        -- como COBERTO (sent_at preenchido) — idempotente pelo mesmo dedupe.
        if v_marco = 15 then
          insert into notification_outbox
            (template, recipient_profile_id, payload, dedupe_key, sent_at)
          values (
            'credit-expiry',
            v_student.profile_id,
            jsonb_build_object(
              'contract_id', v_contract.contract_id,
              'student_id', v_student.student_id,
              'expires_on', v_expiry.expires_on,
              'marco', 30,
              'covered_by', 15
            ),
            format('credit-expiry:%s:%s:%s:%s',
                   v_contract.contract_id, v_student.student_id, v_expiry.expires_on, 30),
            now()
          )
          on conflict (dedupe_key) do nothing;
        end if;
      end loop;
    end loop;
  end loop;
  return v_inserted;
end;
$$;

-- F3-D9/ADR-010 §2: EXECUTE mínimo. A função de cron NÃO é chamável por cliente.
-- O FIFO compartilhado precisa de grant a authenticated: makeup_balance NÃO é
-- definer, então o EXECUTE do helper é checado no CHAMADOR — e a exposição é a
-- mesma do próprio makeup_balance (não-definer: RLS do chamador decide as linhas).
revoke execute on function
  public.makeup_remaining_expiries(uuid),
  public.enqueue_credit_expiry_notices(date)
from public, anon, authenticated;
grant execute on function public.makeup_remaining_expiries(uuid) to authenticated, service_role;
grant execute on function public.enqueue_credit_expiry_notices(date) to service_role;

-- Job diário às 10:00 UTC = 06:00 Cuiabá (datas UTC e locais coincidem — F3-D4;
-- evitar 00:00–03:59 UTC, onde o off-by-one de data morde).
select cron.schedule(
  'enqueue-credit-expiry-daily',
  '0 10 * * *',
  $$select public.enqueue_credit_expiry_notices()$$
);

-- ---------------------------------------------------------------------------
-- 4) Lugar do opt-in WhatsApp (F3-D8 — decisão do M0, registrada em 12/07/2026):
--    a preferência vive em profiles (por PESSOA, não por contrato — o canal é do
--    destinatário). Default FALSE: ninguém recebe WhatsApp sem consentir (opt-in
--    explícito, exigência da Cloud API). NADA a consome até o M5: o enqueue segue
--    gravando channel='email'; o adaptador do M5 passa a consultar esta coluna
--    ao escolher o canal. Mantém verdadeira a premissa do M5 ("opt-in já tem
--    lugar no schema desde o M0").
-- ---------------------------------------------------------------------------
alter table profiles
  add column whatsapp_opt_in boolean not null default false;

comment on column profiles.whatsapp_opt_in is
  'Opt-in de WhatsApp do destinatário (F3-D8, decidido no M0 da Fase 3). Default '
  'false: sem consentimento explícito, toda notificação sai por e-mail. Consultado '
  'pelo adaptador de canal a partir do M5.';
