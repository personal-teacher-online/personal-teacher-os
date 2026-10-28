-- =============================================================================
-- F4 · Onda Financeiro — a porta de escrita dos SCRIPTS de pagador.
--
-- O plano dizia "F4 sem migration"; a rodada do Sol derrubou isso com um fato
-- medido: `service_role` NÃO tem privilégio SQL em payers/student_payers (nem
-- SELECT — negado de propósito desde a Fase 2; só RPCs SECURITY DEFINER
-- enxergam essas tabelas). Os scripts de semeadura e enriquecimento (F4)
-- escreviam direto via PostgREST e falhariam DEPOIS de já ter alterado a
-- assinatura no Asaas — estado parcial não-retomável. Desvio registrado no
-- goal `onda-financeiro.md` (§F4).
--
-- Desenho (mesma disciplina do espelhar_pagamento do F3):
-- · UMA RPC transacional `asaas_bootstrap_pagador`: upsert do pagador pela
--   chave natural (asaas_customer_id), enriquecimento SÓ se o cadastro for
--   stub (name = asaas_customer_id — cadastro enriquecido/manual NUNCA é
--   sobrescrito), vínculo TERCEIRO opcional (só contrato individual — regra
--   do F3; promoção a self segue sendo ato manual da admin), audit_log dentro
--   da transação. Falha ⇒ nada gravado.
-- · `asaas_pagadores_stub`: leitura dos stubs pendentes para o lote de
--   enriquecimento (o script não tem SELECT em payers — e não deve ter).
-- · grant SÓ service_role; revoke nominal (função nova nasce aberta ao PUBLIC
--   em produção — armadilha medida; vigia: tests/acl-higiene.test.ts).
-- =============================================================================

create or replace function public.asaas_bootstrap_pagador(
  p_asaas_customer_id text,
  p_name text,
  p_email text,
  p_cpf_cnpj text,
  p_student_id uuid default null,
  p_contexto jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payer uuid;
  v_nome_atual text;
  v_acao text;
  v_vinculo boolean := false;
begin
  if coalesce(btrim(p_asaas_customer_id), '') = '' then
    raise exception 'asaas_bootstrap_pagador exige asaas_customer_id';
  end if;

  select id, name into v_payer, v_nome_atual
    from payers where asaas_customer_id = p_asaas_customer_id;

  if v_payer is null then
    insert into payers (name, email, cpf_cnpj, asaas_customer_id)
    values (
      coalesce(nullif(btrim(p_name), ''), p_asaas_customer_id),
      p_email, p_cpf_cnpj, p_asaas_customer_id
    )
    returning id into v_payer;
    v_acao := 'criado';
  elsif v_nome_atual = p_asaas_customer_id then
    -- stub do webhook — enriquecer (campo ausente no Asaas preserva o local)
    update payers
       set name     = coalesce(nullif(btrim(p_name), ''), name),
           email    = coalesce(p_email, email),
           cpf_cnpj = coalesce(p_cpf_cnpj, cpf_cnpj)
     where id = v_payer;
    v_acao := 'enriquecido';
  else
    v_acao := 'preservado';
  end if;

  if p_student_id is not null then
    if not exists (select 1 from students s where s.id = p_student_id) then
      raise exception 'asaas_bootstrap_pagador: aluno % não existe', p_student_id;
    end if;
    insert into student_payers (student_id, payer_id, relationship)
    values (p_student_id, v_payer, 'terceiro')
    on conflict (student_id, payer_id) do nothing;
    v_vinculo := found;
  end if;

  perform public.log_audit(
    null, 'asaas.bootstrap_pagador', 'payers', v_payer::text,
    p_contexto || jsonb_build_object(
      'asaas_customer_id', p_asaas_customer_id,
      'acao', v_acao,
      'vinculo_terceiro_criado', v_vinculo,
      'student_id', p_student_id
    )
  );

  return v_payer;
end;
$$;

comment on function public.asaas_bootstrap_pagador(text, text, text, text, uuid, jsonb) is
  'F4 (Onda Financeiro): porta ÚNICA de escrita dos scripts de pagador '
  '(semeadura + enriquecimento). Upsert pela chave natural do Asaas; enriquece '
  'SÓ stub (name = asaas_customer_id); vínculo opcional sempre TERCEIRO; '
  'audit_log na mesma transação. service_role-only.';

create or replace function public.asaas_pagadores_stub()
returns table (payer_id uuid, asaas_customer_id text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id, asaas_customer_id
    from payers
   where asaas_customer_id is not null
     and name = asaas_customer_id
$$;

comment on function public.asaas_pagadores_stub() is
  'F4: stubs de pagador pendentes de enriquecimento, para o lote '
  '(scripts/asaas-enriquecer-pagadores.ts). service_role-only.';

revoke execute on function public.asaas_bootstrap_pagador(text, text, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.asaas_bootstrap_pagador(text, text, text, text, uuid, jsonb)
  to service_role;

revoke execute on function public.asaas_pagadores_stub()
  from public, anon, authenticated;
grant execute on function public.asaas_pagadores_stub()
  to service_role;
