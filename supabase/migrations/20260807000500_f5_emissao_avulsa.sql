-- =============================================================================
-- F5 · Onda Financeiro (PLAN-APPROVED 07/08/2026) — emissão de avulsa pelo app
--
-- MATA A ROTINA P21 no que ela tem de manual: cobrar uma aula extra deixava a
-- dona no painel do Asaas digitando o UUID da aula à mão. Agora a emissão sai
-- do app, e o espelho fica verdadeiro NO ATO (sem esperar o webhook religar).
--
-- FATOS DO GATE F0 que sustentam o desenho (tests/fixtures/asaas/):
-- · a API NÃO tem idempotência nativa (2 POSTs = 2 cobranças; Idempotency-Key
--   ignorado) → a defesa é DA APLICAÇÃO: claim por INSERT + GET antes do POST;
-- · GET /payments?externalReference= é read-your-writes (3/3 imediato) → a
--   reconciliação "adota, nunca POST cego" funciona.
--
-- DECISÕES DO PLANO:
-- · trava anti-corrida MÍNIMA: `payment_emissions` — o INSERT é a trava; só
--   quem inseriu (ou tomou uma claim ESTAGNADA, > 5 min sem espelho) faz o
--   POST. Sem máquina de estados, sem colunas de status;
-- · espelho da avulsa ancora na AULA: `payments.class_instance_id` + CHECK
--   XOR com `contract_id` — todo espelho aponta exatamente UMA âncora;
-- · o webhook DEIXA DE dar early-return na avulsa: sempre espelha pela RPC
--   única e, separadamente, quita a aula (mudança no TS, não aqui);
-- · botão só com pagador pronto: condição DERIVADA por consulta
--   (`avulsa_pagador_pronto`), nunca materializada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A âncora da avulsa no espelho.
-- -----------------------------------------------------------------------------
alter table payments add column class_instance_id uuid references class_instances (id);

comment on column payments.class_instance_id is
  'F5: cobrança de AULA AVULSA (externalReference = UUID da aula — P21). XOR '
  'com contract_id: todo espelho aponta exatamente uma âncora.';

alter table payments add constraint payments_ancora_xor
  check (num_nonnulls(contract_id, class_instance_id) = 1);

create index payments_class_instance_idx on payments (class_instance_id);

-- -----------------------------------------------------------------------------
-- 2. A RPC única do espelho aprende a avulsa. Assinatura NOVA (parâmetro a
--    mais) ⇒ DROP do velho primeiro — manter os dois seria sobrecarga ambígua
--    para o PostgREST (chamada por nome de parâmetro casaria com ambas).
-- -----------------------------------------------------------------------------
drop function public.espelhar_pagamento(text, uuid, text, int, text, date, timestamptz, text, text, jsonb);

create function public.espelhar_pagamento(
  p_asaas_payment_id text,
  p_contract_id uuid,
  p_customer text,
  p_amount_cents int,
  p_status text,
  p_due_date date,
  p_paid_at timestamptz,
  p_billing_type text,
  p_reference_ym text,
  p_raw jsonb,
  p_class_instance_id uuid default null,
  p_emissao jsonb default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payer uuid;
  v_student uuid;
begin
  if coalesce(btrim(p_asaas_payment_id), '') = '' then
    raise exception 'espelhar_pagamento exige asaas_payment_id';
  end if;
  if num_nonnulls(p_contract_id, p_class_instance_id) <> 1 then
    raise exception 'espelhar_pagamento exige EXATAMENTE uma âncora (contrato OU aula avulsa)';
  end if;

  -- Stub do pagador pela chave natural do Asaas. name = asaas_customer_id é o
  -- marcador de "cadastro por completar" (lote do F4); o ON CONFLICT preserva
  -- um cadastro já enriquecido.
  if coalesce(btrim(p_customer), '') <> '' then
    insert into payers (name, asaas_customer_id)
    values (p_customer, p_customer)
    on conflict (asaas_customer_id) do nothing;

    select id into v_payer from payers where asaas_customer_id = p_customer;

    -- Auto-vínculo: SÓ contrato individual (grupo não aponta UM aluno), e
    -- SEMPRE terceiro — a direção que nunca vaza fatura. Idempotente. A aula
    -- avulsa chega ao aluno pelo SEU contrato (class_instances.contract_id é
    -- not null) — mesma regra, mesmo destino.
    select c.student_id into v_student
      from contracts c
     where c.id = coalesce(
             p_contract_id,
             (select ci.contract_id from class_instances ci where ci.id = p_class_instance_id));
    if v_student is not null then
      insert into student_payers (student_id, payer_id, relationship)
      values (v_student, v_payer, 'terceiro')
      on conflict (student_id, payer_id) do nothing;
    end if;
  end if;

  -- O espelho. `coalesce(v_payer, payments.payer_id)` no UPDATE: evento sem
  -- customer NUNCA apaga o pagador que um evento anterior gravou.
  insert into payments
    (asaas_payment_id, payer_id, contract_id, class_instance_id, amount_cents,
     status, due_date, paid_at, billing_type, reference_ym, raw, updated_at)
  values
    (p_asaas_payment_id, v_payer, p_contract_id, p_class_instance_id,
     p_amount_cents, p_status, p_due_date, p_paid_at, p_billing_type,
     p_reference_ym, p_raw, now())
  on conflict (asaas_payment_id) do update
     set payer_id          = coalesce(excluded.payer_id, payments.payer_id),
         contract_id       = excluded.contract_id,
         class_instance_id = excluded.class_instance_id,
         amount_cents      = excluded.amount_cents,
         status            = excluded.status,
         due_date          = excluded.due_date,
         paid_at           = excluded.paid_at,
         billing_type      = excluded.billing_type,
         reference_ym      = excluded.reference_ym,
         raw               = excluded.raw,
         updated_at        = now();

  -- F5 (Sol r2 · P1): a QUITAÇÃO da avulsa sai NA MESMA transação do espelho —
  -- vale para o webhook E para a adoção de cobrança já recebida (sem isto, a
  -- adoção com o webhook desligado deixava payment pago × aula aberta para
  -- sempre). Idempotente: nunca sobrescreve uma quitação existente.
  if p_class_instance_id is not null and p_paid_at is not null then
    update class_instances
       set single_paid_at = p_paid_at
     where id = p_class_instance_id and single_paid_at is null;
  end if;

  -- F5 (Sol · P1): a trilha da EMISSÃO sai NA MESMA transação do espelho —
  -- audit que falhava DEPOIS do espelho deixava a cobrança sem desfecho
  -- auditado para sempre (a claim seguinte recusa aula já espelhada).
  if p_emissao is not null then
    perform public.log_audit(
      nullif(p_emissao ->> 'actor', '')::uuid,
      'asaas.emitir_avulsa', 'payments', p_asaas_payment_id,
      p_emissao - 'actor');
  end if;
end;
$$;

comment on function public.espelhar_pagamento(text, uuid, text, int, text, date, timestamptz, text, text, jsonb, uuid, jsonb) is
  'A porta ÚNICA de escrita do espelho de cobranças (F3 + F5): stub do payer '
  'por asaas_customer_id, auto-vínculo terceiro (individual — direto ou via a '
  'aula avulsa), upsert de payments com payer_id que NUNCA regride a null e '
  'âncora XOR contrato/aula — tudo numa transação. Chamadores: webhook Asaas '
  'e a emissão de avulsa (action do F5).';

revoke execute on function public.espelhar_pagamento(text, uuid, text, int, text, date, timestamptz, text, text, jsonb, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.espelhar_pagamento(text, uuid, text, int, text, date, timestamptz, text, text, jsonb, uuid, jsonb)
  to service_role;

-- -----------------------------------------------------------------------------
-- 3. A trava anti-corrida. O INSERT é a trava; a linha é trilha, não estado.
-- -----------------------------------------------------------------------------
create table payment_emissions (
  class_instance_id uuid primary key references class_instances (id),
  created_at timestamptz not null default now(),
  created_by uuid references profiles (id) on delete set null
);

comment on table payment_emissions is
  'F5: claim de emissão de cobrança avulsa — o INSERT (via emitir_avulsa_claim) '
  'é a trava anti-corrida; só quem o venceu faz o POST no Asaas. Claim sem '
  'payment espelhado por > 5 min = ESTAGNADA (o dono morreu antes do POST): a '
  'próxima tentativa a toma atomicamente. Reconciliação (F6) lista claims sem '
  'espelho. Escrita SÓ pela RPC.';

-- RLS sem policy = zero linhas para anon/authenticated (o caso 12 do rls.test
-- exige "vazio", nunca "permission denied" — o SELECT de tabela existe e a RLS
-- filtra, como nas demais tabelas travadas da casa); escrita SÓ pela RPC.
alter table payment_emissions enable row level security;
grant select on payment_emissions to anon, authenticated;
revoke insert, update, delete, truncate on payment_emissions
  from anon, authenticated, service_role;

create function public.emitir_avulsa_claim(
  p_class_instance uuid,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aula record;
  v_claim uuid;
  v_stamp timestamptz;
begin
  if public.app_role() <> 'admin'
     and (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'emitir_avulsa_claim é restrita à admin';
  end if;

  select ci.id, ci.single_kind, ci.single_price_cents, ci.single_paid_at, ci.state
    into v_aula
    from class_instances ci
   where ci.id = p_class_instance;
  if not found then
    raise exception 'aula % não existe', p_class_instance;
  end if;
  if v_aula.single_kind is distinct from 'extra_paid' then
    raise exception 'só aula EXTRA COBRADA À PARTE é emitida pelo app (esta é %)',
      coalesce(v_aula.single_kind, 'aula de contrato');
  end if;
  if coalesce(v_aula.single_price_cents, 0) <= 0 then
    raise exception 'aula extra sem valor — defina o valor antes de cobrar';
  end if;
  if v_aula.single_paid_at is not null then
    raise exception 'esta aula já está paga';
  end if;
  if v_aula.state = 'cancelled' then
    raise exception 'aula cancelada não é cobrada';
  end if;
  -- Só cobrança ATIVA barra a emissão (Sol r2 · P2): espelho de cobrança
  -- cancelada/apagada no Asaas não é dívida viva — a aula pode ser recobrada.
  if exists (select 1 from payments p
              where p.class_instance_id = p_class_instance
                and not public.payment_nao_cobravel(p.status)) then
    raise exception 'esta aula já tem cobrança ativa espelhada — nada a emitir';
  end if;

  -- A trava: INSERT vence; claim EXISTENTE só é tomada se estagnada (> 5 min
  -- e sem espelho — conferido logo acima). O WHERE do ON CONFLICT decide
  -- atomicamente: duas tentativas simultâneas ⇒ uma vence, a outra sai sem
  -- linha (claimed=false).
  insert into payment_emissions as pe (class_instance_id, created_by)
  values (p_class_instance, coalesce(auth.uid(), p_actor))
  on conflict (class_instance_id) do update
     set created_at = now(), created_by = excluded.created_by
   where pe.created_at < now() - interval '5 minutes'
  returning pe.class_instance_id, pe.created_at into v_claim, v_stamp;

  if v_claim is null then
    return jsonb_build_object('claimed', false);
  end if;

  perform public.log_audit(coalesce(auth.uid(), p_actor), 'asaas.emitir_avulsa_claim',
    'class_instances', p_class_instance::text,
    jsonb_build_object('price_cents', v_aula.single_price_cents));

  -- O `stamp` é a CERCA da claim (Sol F5 · P1): quem a ganhou confere, na
  -- véspera do POST, se ela ainda é SUA (emissao_claim_vigente) — uma retomada
  -- por estagnação muda o stamp, e o dono antigo aborta sem POST.
  return jsonb_build_object(
    'claimed', true,
    'price_cents', v_aula.single_price_cents,
    'stamp', v_stamp);
end;
$$;

comment on function public.emitir_avulsa_claim(uuid, uuid) is
  'F5: valida a aula (extra_paid, com valor, não paga, não cancelada, sem '
  'espelho) e disputa a trava de emissão. claimed=true ⇒ o chamador faz o '
  'GET-antes-do-POST no Asaas; claimed=false ⇒ outra emissão está em '
  'andamento. Claim estagnada (> 5 min sem espelho) é tomada atomicamente; o '
  'stamp devolvido cerca o dono antigo (ver emissao_claim_vigente).';

revoke execute on function public.emitir_avulsa_claim(uuid, uuid) from public, anon;
grant execute on function public.emitir_avulsa_claim(uuid, uuid) to authenticated, service_role;

-- A cerca da claim: o POST só sai se o stamp ainda for o do chamador. Junto
-- com o timeout de 60s do transporte (client.ts), fecha a janela em que uma
-- claim retomada por estagnação conviveria com um POST atrasado do dono
-- antigo — tempo decorrido sozinho não prova que o dono morreu (Sol F5 · P1).
create function public.emissao_claim_vigente(
  p_class_instance uuid,
  p_stamp timestamptz
) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.app_role() <> 'admin'
     and (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'emissao_claim_vigente é restrita à admin';
  end if;
  -- Sol r2 · P1: a cerca revalida também a COBRABILIDADE — a aula pode ter
  -- sido cancelada, quitada ou espelhada por outro caminho entre a claim e a
  -- véspera do POST; stamp certo com aula não-cobrável também aborta.
  return exists (
    select 1
      from payment_emissions pe
      join class_instances ci on ci.id = pe.class_instance_id
     where pe.class_instance_id = p_class_instance
       and pe.created_at = p_stamp
       and ci.single_paid_at is null
       and ci.state <> 'cancelled')
    and not exists (
      select 1 from payments p
       where p.class_instance_id = p_class_instance
         and not public.payment_nao_cobravel(p.status));
end;
$$;

comment on function public.emissao_claim_vigente(uuid, timestamptz) is
  'F5: a claim de emissão ainda pertence a quem tem este stamp? Conferida '
  'imediatamente antes do POST — retomada por estagnação muda o stamp e o '
  'dono antigo aborta sem POST.';

revoke execute on function public.emissao_claim_vigente(uuid, timestamptz) from public, anon;
grant execute on function public.emissao_claim_vigente(uuid, timestamptz) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Pagador pronto — condição DERIVADA, régua única para a tela e a action.
--    Linha vazia = "não pronto" (a tela explica; a action recusa).
-- -----------------------------------------------------------------------------
create function public.avulsa_pagador_pronto(p_class_instance uuid)
returns table (payer_id uuid, payer_name text, asaas_customer_id text, student_id uuid, price_cents int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Só contrato INDIVIDUAL: aula de grupo não aponta UM pagador — segue no
  -- painel do Asaas. Preferência: vínculo self; senão, o ÚNICO vínculo com
  -- cadastro Asaas. Dois terceiros sem self = ambíguo = não pronto.
  with aula as (
    select ci.id, ci.single_price_cents, c.student_id
      from class_instances ci
      join contracts c on c.id = ci.contract_id
     where ci.id = p_class_instance
       and ci.single_kind = 'extra_paid'
       -- Aula cancelada não é cobrável (Sol F5 · P2): sem isto a tela
       -- desenhava um botão que a claim só sabe recusar.
       and ci.state <> 'cancelled'
       and c.student_id is not null
       and (public.app_role() = 'admin'
            or (auth.jwt() ->> 'role') is not distinct from 'service_role')
  ),
  vinculos as (
    select p.id, p.name, p.asaas_customer_id, sp.relationship, a.student_id, a.single_price_cents
      from aula a
      join student_payers sp on sp.student_id = a.student_id
      join payers p on p.id = sp.payer_id
     where p.asaas_customer_id is not null
  )
  select v.id, v.name, v.asaas_customer_id, v.student_id, v.single_price_cents
    from vinculos v
   where v.relationship = 'self'
      or (not exists (select 1 from vinculos v2 where v2.relationship = 'self')
          and (select count(*) from vinculos) = 1)
   order by (v.relationship = 'self') desc
   limit 1
$$;

comment on function public.avulsa_pagador_pronto(uuid) is
  'F5: QUEM pode ser cobrado pela aula avulsa — vínculo self do aluno do '
  'contrato individual, ou o único terceiro com cadastro Asaas. Vazio = botão '
  'não aparece e a action recusa (mesma régua nas duas pontas). Admin/service.';

revoke execute on function public.avulsa_pagador_pronto(uuid) from public, anon;
grant execute on function public.avulsa_pagador_pronto(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. A tela Financeiro enxerga a avulsa: pagante via a âncora que existir.
-- -----------------------------------------------------------------------------
create or replace view public.payments_admin
with (security_invoker = true) as
select
  p.id,
  p.asaas_payment_id,
  p.contract_id,
  p.amount_cents,
  p.status,
  p.due_date,
  p.reference_ym,
  p.paid_at,
  p.billing_type,
  public.payment_situacao(p.status, p.paid_at, p.due_date)          as situacao,
  public.payment_em_aberto(p.status, p.paid_at)                     as em_aberto,
  (public.payment_em_aberto(p.status, p.paid_at)
     and p.due_date is not null
     and p.due_date < public.business_today())                      as em_atraso,
  public.payment_nao_cobravel(p.status)                             as nao_cobravel,
  coalesce(s.display_name, g.label, c.plan_name)                    as pagante,
  s.id                                                              as student_id,
  p.class_instance_id
from payments p
left join class_instances ci on ci.id = p.class_instance_id
left join contracts c        on c.id = coalesce(p.contract_id, ci.contract_id)
left join students s         on s.id = c.student_id
left join student_groups g   on g.id = c.student_group_id;

comment on view public.payments_admin is
  'Espelho Asaas com a régua do banco por linha (situacao/em_aberto/em_atraso/'
  'nao_cobravel) + quem paga. F5: a avulsa entra com pagante derivado da AULA '
  '(class_instances.contract_id) e class_instance_id exposto para o balão da '
  'agenda. security_invoker: quem protege é a RLS de payments.';

-- create or replace preserva os grants do F1 (authenticated only) — re-afirmar
-- o estado é barato e à prova de deriva:
revoke all on public.payments_admin from public, anon;
grant select on public.payments_admin to authenticated;

-- -----------------------------------------------------------------------------
-- 6. O ALUNO também enxerga a avulsa (Sol F5 · P2): a posse do portal era só
--    por contract_id — toda cobrança ancorada na aula sumia do histórico do
--    aluno, mesmo com pagador self. A posse agora deriva da âncora que
--    existir (contrato direto, ou o contrato da aula). As DUAS guardas do
--    invoice_url ficam como estão: origem + payer self, por pagador.
-- -----------------------------------------------------------------------------
create or replace view payments_student as
  select p.id, p.contract_id, p.amount_cents, p.status, p.due_date, p.reference_ym,
         public.payment_em_aberto(p.status, p.paid_at) as em_aberto,
         (public.payment_em_aberto(p.status, p.paid_at)
          and p.due_date is not null
          and p.due_date < public.business_today()) as em_atraso,
         public.payment_nao_cobravel(p.status) as nao_cobravel,
         public.payment_situacao(p.status, p.paid_at, p.due_date) as situacao,
         case
           when p.payer_id is not null
                and (p.raw -> 'payment' ->> 'invoiceUrl') ~ '^https://(www\.|sandbox\.)?asaas\.com/'
                and exists (
                  select 1 from student_payers sp
                   where sp.payer_id = p.payer_id
                     and sp.relationship = 'self'
                     and sp.student_id in (select public.my_student_ids())
                )
           then p.raw -> 'payment' ->> 'invoiceUrl'
         end as invoice_url,
         p.class_instance_id
    from payments p
    left join class_instances ci on ci.id = p.class_instance_id
   where coalesce(p.contract_id, ci.contract_id) in (select public.my_contract_ids());

comment on view payments_student is
  'Espelho enxuto por posse do chamador — contrato direto OU o contrato da '
  'aula avulsa (F5). raw/payer_id NUNCA nesta view (minimização, P5). '
  'invoice_url com as duas guardas DENTRO da view (F3): origem '
  '^https://(www.|sandbox.)?asaas.com/ E posse do CHAMADOR com '
  'relationship=self. em_aberto/em_atraso/nao_cobravel/situacao são a régua '
  'do banco.';

grant select on payments_student to authenticated;
