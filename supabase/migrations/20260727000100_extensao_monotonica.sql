-- Extensão de validade MONOTÔNICA e restrita a crédito VIVO
-- (revisão adversarial nº 6 — achados S1 grave e S2, 27/07/2026).
--
-- O QUE ESTAVA ERRADO (S1 — dinheiro): `admin_extend_credit` tinha um ramo
-- "vencido renasce sem débito" (F3/20260718000500). O crédito vencido continua
-- no replay do FIFO (`_makeup_remaining_credits` devolve TODA entrada não
-- consumida, vencida ou não — quem ignora vencimento é o saldo, não o replay),
-- e o ramo inseria um +1 NOVO sem debitar o original. Consequências:
--   · a fila passava a ter DUAS entradas onde havia uma (o vencido, morto para
--     o saldo mas vivo para o replay, e a reemissão);
--   · repetir a ação (dois cliques, um F5, duas admins) somava +1 a cada vez —
--     saldo MULTIPLICADO, sem nenhum limite. Erro de crédito é erro de dinheiro
--     (CLAUDE.md), e o ledger append-only não permite "desfazer" o excedente
--     senão com mais lançamento.
-- O ramo some. Extensão passa a ser o que o nome diz: empurrar para frente a
-- validade de um crédito que AINDA VALE. Reativar um crédito vencido é outra
-- operação (decide se o aluno merece de volta algo que a política já matou) e
-- ela NÃO EXISTE hoje — quem quiser devolver crédito vencido usa o ajuste
-- manual (`admin_makeup_adjust`), que é explícito, exige motivo e audita.
--
-- O QUE ESTAVA FROUXO (S2 — monotonicidade): a única guarda de data era "não
-- pode ser no passado". Dava para "estender" um crédito que vale até dia 30
-- para o dia 20 — encurtar chamando de estender. Agora a validade nova precisa
-- ser ESTRITAMENTE POSTERIOR à atual, e a atual é lida DENTRO da transação,
-- depois do advisory lock do contrato (o mesmo lock do gasto): duas admins
-- clicando junto não decidem sobre o mesmo estado lido antes do lock.
--
-- O que NÃO muda: continua sendo o par −1/+1 do `_reissue_credit` (Lei 2 —
-- dupla entrada, append-only, duração e origem preservadas), continua exigindo
-- motivo, continua restrita à admin (D10), e continua auditada — agora com uma
-- linha PRÓPRIA de `admin_extend_credit` além da do `reissue_credit`, para que
-- a auditoria diga quem usou a AÇÃO da tela, não só que houve relançamento.
--
-- `_makeup_remaining_credits`, `_reissue_credit`, `admin_credit_expiry_overview`
-- e o ramo de revival da retomada de pausa (`resume_contract`, que é outro
-- caso: lá o crédito venceu DURANTE o congelamento, por causa da escola)
-- ficam intactos.

create or replace function public.admin_extend_credit(
  p_ledger bigint,
  p_new_expires_on date,
  p_note text default null,  -- default só para o PostgREST resolver a chamada; a função RECUSA null/vazio
  p_actor uuid default null
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row makeup_ledger%rowtype;
  v_atual date;
  v_new_id bigint;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_extend_credit é restrita à admin (D10)';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'estender validade exige motivo (M3-2)';
  end if;
  select * into v_row from makeup_ledger where id = p_ledger;
  if not found then
    raise exception 'lançamento % não existe', p_ledger;
  end if;
  if not exists (
    select 1 from contracts c
    where c.id = v_row.contract_id and c.contract_type = 'private_1on1'
  ) then
    raise exception 'extensão de validade é de créditos de reposição (particulares)';
  end if;

  -- LOCK ANTES DA LEITURA: a validade atual do alvo é estado sobre o qual esta
  -- transação vai decidir. Mesmo lock do gasto ('makeup_spend:<contrato>'), de
  -- transação — o `_reissue_credit` o repega adiante sem se bloquear.
  perform pg_advisory_xact_lock(hashtextextended('makeup_spend:' || v_row.contract_id::text, 0));

  select rc.expires_on into v_atual
  from public._makeup_remaining_credits(v_row.contract_id) rc
  where rc.ledger_id = p_ledger
  order by rc.ord
  limit 1;

  if v_atual is null then
    raise exception 'crédito % já foi gasto — nada a estender', p_ledger;
  end if;
  if v_atual = 'infinity'::date then
    raise exception 'crédito % não tem prazo de validade — não há o que estender', p_ledger;
  end if;
  if v_atual < public.business_today() then
    raise exception
      'crédito vencido não se estende; reativação é operação distinta e não existe hoje '
      '(crédito %, venceu em %) — para devolver crédito a este aluno, use o ajuste manual',
      p_ledger, v_atual;
  end if;
  if p_new_expires_on <= v_atual then
    raise exception
      'estender só empurra a validade para FRENTE: a nova (%) precisa ser posterior à atual (%)',
      p_new_expires_on, v_atual;
  end if;

  -- crédito VIVO: par −1/+1 dirigido (preserva duração+origem, audita) — P6.
  v_new_id := public._reissue_credit(p_ledger, p_new_expires_on,
                                     coalesce(auth.uid(), p_actor), p_note);
  perform public.log_audit(coalesce(auth.uid(), p_actor), 'admin_extend_credit',
    'makeup_ledger', v_new_id::text,
    jsonb_build_object('from_ledger', p_ledger, 'contract_id', v_row.contract_id,
                       'old_expires_on', v_atual, 'new_expires_on', p_new_expires_on,
                       'note', p_note));
  return v_new_id;
end;
$$;

comment on function public.admin_extend_credit(bigint, date, text, uuid) is
  'Empurra para FRENTE a validade de UM crédito de reposição AINDA VIVO, pelo par '
  '−1/+1 do _reissue_credit. Recusa: alvo gasto, alvo vencido (reativação é outra '
  'operação, inexistente), alvo sem prazo, e data nova <= validade atual (lida sob '
  'o lock do contrato). Motivo obrigatório; auditada (revisão nº 6, S1+S2).';

revoke execute on function public.admin_extend_credit(bigint, date, text, uuid)
from public, anon;
grant execute on function public.admin_extend_credit(bigint, date, text, uuid) to authenticated;
