-- =============================================================================
-- F3 · Onda Financeiro (PLAN-APPROVED 07/08/2026) — o encanamento do pagador
--
-- AS COLUNAS MORTAS GANHAM ESCRITA. Desde a Fase 2, `payments.payer_id` e
-- `payers.asaas_customer_id` existiam sem NENHUM caminho de escrita — e por
-- isso o botão "Abrir fatura" foi REMOVIDO do portal (P5): o link abre, no
-- Asaas, a fatura DO PAGADOR (nome e documento de quem paga), e o banco não
-- sabia afirmar que o pagador era o próprio aluno. Este milestone constrói a
-- afirmação: quem paga passa a ser gravado (stub via webhook), o vínculo
-- aluno↔pagador ganha a distinção self/terceiro, e o link volta com DUAS
-- guardas DENTRO da view.
--
-- SUSTENTAÇÃO POR PAYLOAD REAL (gate F0, fixtures em tests/fixtures/asaas/):
-- `payment.customer` é string `cus_…` em todos os eventos capturados; o link
-- vive em `payment.invoiceUrl` (no espelho: raw -> 'payment' ->> 'invoiceUrl');
-- o header de entrega é `asaas-access-token`. Nada aqui foi desenhado de
-- memória.
--
-- DECISÕES DO PLANO (revisão consolidada):
-- · stub do pagador: `name = asaas_customer_id` — sem coluna nova, sem DROP
--   NOT NULL; o stub é auto-detectável e o lote do F4 enriquece depois;
-- · RPC transacional ÚNICA `espelhar_pagamento` (tudo-ou-nada) usada pelos
--   DOIS escritores (webhook agora, emissão do F5 depois). Falha ⇒ inbox com
--   `error` e `processed_at` nulo; o replay re-tenta INTEIRA. Lei 6 intacta:
--   zero HTTP aqui dentro;
-- · `payer_id` NUNCA é sobrescrito com null (evento sem customer preserva o
--   que o evento anterior gravou);
-- · auto-vínculo: SÓ contrato individual, SEMPRE `terceiro` (direção segura —
--   terceiro nunca vaza fatura); grupo não auto-vincula; promoção a `self` é
--   ato manual da admin, RPC auditada, nunca inferência.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. self × terceiro — a distinção que faltava para o link ser seguro.
-- -----------------------------------------------------------------------------
alter table student_payers add column relationship text not null default 'terceiro'
  check (relationship in ('self', 'terceiro'));

comment on column student_payers.relationship is
  'F3 (Onda Financeiro): "self" = o pagador É o próprio aluno — a ÚNICA '
  'condição que autoriza o portal a mostrar o link da fatura (a fatura carrega '
  'nome e documento do pagador). Default terceiro; promoção a self é ato '
  'manual auditado (admin_set_payer_relationship), nunca inferência.';

-- Um aluno tem no máximo UM pagador-self (ele mesmo)…
create unique index student_payers_one_self
  on student_payers (student_id)
  where relationship = 'self';

-- …e um PAGADOR é self de no máximo UM aluno (Sol F3 · P1): "self" afirma
-- "este pagador É esta pessoa" — um cadastro não é duas pessoas. Sem este
-- índice, um pagador compartilhado marcado self em dois alunos entregaria a
-- fatura (nome + documento) a quem é, de fato, terceiro.
create unique index student_payers_one_student_per_self_payer
  on student_payers (payer_id)
  where relationship = 'self';

-- -----------------------------------------------------------------------------
-- 2. A RPC única do espelho — os dois escritores passam por aqui.
--    SECURITY DEFINER + grant só a service_role: o webhook (service) e a
--    emissão do F5 (server action com service client) são os únicos chamadores.
-- -----------------------------------------------------------------------------
create or replace function public.espelhar_pagamento(
  p_asaas_payment_id text,
  p_contract_id uuid,
  p_customer text,
  p_amount_cents int,
  p_status text,
  p_due_date date,
  p_paid_at timestamptz,
  p_billing_type text,
  p_reference_ym text,
  p_raw jsonb
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
  if p_contract_id is null then
    raise exception 'espelhar_pagamento exige contract_id (o fallback de aula avulsa é do F5)';
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
    -- SEMPRE terceiro — a direção que nunca vaza fatura. Idempotente.
    select c.student_id into v_student
      from contracts c where c.id = p_contract_id;
    if v_student is not null then
      insert into student_payers (student_id, payer_id, relationship)
      values (v_student, v_payer, 'terceiro')
      on conflict (student_id, payer_id) do nothing;
    end if;
  end if;

  -- O espelho. `coalesce(v_payer, payments.payer_id)` no UPDATE: evento sem
  -- customer NUNCA apaga o pagador que um evento anterior gravou.
  insert into payments
    (asaas_payment_id, payer_id, contract_id, amount_cents, status,
     due_date, paid_at, billing_type, reference_ym, raw, updated_at)
  values
    (p_asaas_payment_id, v_payer, p_contract_id, p_amount_cents, p_status,
     p_due_date, p_paid_at, p_billing_type, p_reference_ym, p_raw, now())
  on conflict (asaas_payment_id) do update
     set payer_id      = coalesce(excluded.payer_id, payments.payer_id),
         contract_id   = excluded.contract_id,
         amount_cents  = excluded.amount_cents,
         status        = excluded.status,
         due_date      = excluded.due_date,
         paid_at       = excluded.paid_at,
         billing_type  = excluded.billing_type,
         reference_ym  = excluded.reference_ym,
         raw           = excluded.raw,
         updated_at    = now();
end;
$$;

comment on function public.espelhar_pagamento(text, uuid, text, int, text, date, timestamptz, text, text, jsonb) is
  'A porta ÚNICA de escrita do espelho de cobranças (F3): stub do payer por '
  'asaas_customer_id (name = customer, marcador do lote de enriquecimento F4), '
  'auto-vínculo terceiro em contrato individual, upsert de payments com '
  'payer_id que NUNCA regride a null — tudo numa transação (falha ⇒ nada '
  'gravado ⇒ replay da inbox re-tenta inteira). Chamadores: webhook Asaas e, '
  'no F5, a emissão de avulsa.';

revoke execute on function public.espelhar_pagamento(text, uuid, text, int, text, date, timestamptz, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.espelhar_pagamento(text, uuid, text, int, text, date, timestamptz, text, text, jsonb)
  to service_role;

-- -----------------------------------------------------------------------------
-- 3. A promoção a self — ato manual da admin, com trilha (Lei 8).
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_payer_relationship(
  p_student uuid,
  p_payer uuid,
  p_relationship text,
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old text;
  v_actor uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_set_payer_relationship é restrita à admin';
  end if;
  if p_relationship not in ('self', 'terceiro') then
    raise exception 'relationship é self ou terceiro';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  select relationship into v_old
    from student_payers
   where student_id = p_student and payer_id = p_payer
   for update;
  if not found then
    raise exception 'vínculo aluno↔pagador não existe';
  end if;

  update student_payers
     set relationship = p_relationship
   where student_id = p_student and payer_id = p_payer;

  perform public.log_audit(v_actor, 'set_payer_relationship', 'student_payers',
    p_student::text || ':' || p_payer::text,
    jsonb_build_object('de', v_old, 'para', p_relationship));
end;
$$;

comment on function public.admin_set_payer_relationship(uuid, uuid, text, uuid) is
  'Promove/rebaixa o vínculo aluno↔pagador (self × terceiro), admin-only, com '
  'audit de→para. "self" autoriza o link da fatura no portal; o índice parcial '
  'garante no máximo UM self por aluno.';

revoke execute on function public.admin_set_payer_relationship(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.admin_set_payer_relationship(uuid, uuid, text, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3b. O desvínculo TAMBÉM é porta auditada (Sol F3 · P2): remover um vínculo
--     self apaga o estado de segurança que autoriza a fatura no portal — DELETE
--     direto da action não deixava trilha nenhuma.
-- -----------------------------------------------------------------------------
create or replace function public.admin_unlink_payer(
  p_student uuid,
  p_payer uuid,
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old text;
  v_actor uuid;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_unlink_payer é restrita à admin';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  delete from student_payers
   where student_id = p_student and payer_id = p_payer
  returning relationship into v_old;
  if v_old is null then
    raise exception 'vínculo aluno↔pagador não existe';
  end if;

  perform public.log_audit(v_actor, 'unlink_payer', 'student_payers',
    p_student::text || ':' || p_payer::text,
    jsonb_build_object('relationship_removido', v_old));
end;
$$;

comment on function public.admin_unlink_payer(uuid, uuid, uuid) is
  'Desvincula aluno↔pagador com trilha (Lei 8) — registra qual relationship '
  'morreu (remover um self desliga o botão da fatura no portal).';

revoke execute on function public.admin_unlink_payer(uuid, uuid, uuid) from public, anon;
grant execute on function public.admin_unlink_payer(uuid, uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. O link volta ao portal — com as DUAS guardas DENTRO da view (nunca em TS):
--    origem asaas.com E posse com relationship = 'self'. Terceiro, origem
--    estranha ou payer não resolvido ⇒ null ⇒ o portal não desenha botão.
--    (`raw`/`payer_id` continuam FORA da view — minimização, P5.)
-- -----------------------------------------------------------------------------
create or replace view payments_student as
  select p.id, p.contract_id, p.amount_cents, p.status, p.due_date, p.reference_ym,
         public.payment_em_aberto(p.status, p.paid_at) as em_aberto,
         (public.payment_em_aberto(p.status, p.paid_at)
          and p.due_date is not null
          and p.due_date < public.business_today()) as em_atraso,
         public.payment_nao_cobravel(p.status) as nao_cobravel,
         public.payment_situacao(p.status, p.paid_at, p.due_date) as situacao,
         -- F3: as duas guardas prometidas na 20260728000800 quando o botão saiu
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
         end as invoice_url
    from payments p
   where p.contract_id in (select public.my_contract_ids());

comment on view payments_student is
  'Espelho enxuto por contrato do chamador (my_contract_ids usa auth.uid()). '
  'raw/payer_id NUNCA nesta view (minimização: raw carrega o cadastro do '
  'pagador). invoice_url VOLTOU no F3 com as duas guardas DENTRO da view: '
  'origem ^https://(www.|sandbox.)?asaas.com/ E posse do CHAMADOR com '
  'relationship=self (a fatura carrega nome e documento do pagador — terceiro '
  'nunca vaza). em_aberto/em_atraso/nao_cobravel/situacao são a régua do banco.';

grant select on payments_student to authenticated;
