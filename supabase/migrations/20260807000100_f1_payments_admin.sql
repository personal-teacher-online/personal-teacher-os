-- =============================================================================
-- F1 · Onda Financeiro (PLAN-APPROVED 07/08/2026) — payments_admin
--
-- A SEGUNDA RÉGUA MORRE. Desde 28/07 o banco tem o vocabulário fechado de
-- desfechos (`payment_situacao`, migration 20260728000800) e o portal e os
-- KPIs leem dele. A tela do ADMIN ficou para trás: decidia "paga" com uma
-- lista de status em TypeScript (`PAGO = new Set(...)`) e lia o relógio na
-- própria página. A divergência era real e cara: `RECEIVED_IN_CASH_UNDONE`
-- (baixa manual desfeita, `paid_at` ainda preenchido) saía "paga" para a
-- admin e em_aberto/em_atraso para o aluno — a escola cobrando e a tela da
-- dona dizendo que não havia o que cobrar. Esta view é a régua ÚNICA da tela.
--
-- QUEM PAGA (a coluna `pagante`): o nome que a admin reconhece — aluno do
-- contrato individual, rótulo do grupo (casal), ou o plano como último nome.
-- `payer_id` NÃO entra aqui: a coluna ainda é morta (F3 a preenche) e esta
-- view não deve fingir que sabe quem é o pagador antes do encanamento.
--
-- ACL (decisão unânime da revisão do plano):
-- · `security_invoker = true` — a view roda com os DIREITOS DE QUEM CHAMA.
--   A proteção é a RLS que já existe: `payments`/`contracts`/`students` só
--   têm policy de admin (`*_admin_all`, migration 20260711000700). Aluno e
--   professora têm grant de tabela (grant amplo da RLS base) mas nenhuma
--   policy que devolva linha → recebem ZERO linhas, nunca erro. `anon` não
--   tem grant na view → erro de permissão.
-- · Revoke NOMINAL de `anon`: em produção o default privilege do owner pode
--   conceder a papéis nomeados na criação (a lição da higiene ACL vale para
--   objeto novo em geral) — revogar por nome aqui é o que garante o estado
--   independente do default. ⚠️ Teste local de ACL é FALSO-VERDE (armadilha
--   medida): a prova final é a sonda em produção na janela de deploy.
-- · O watchdog `tests/acl-higiene.test.ts` passa a exigir security_invoker
--   em toda view nova (allowlist nominal para as definer-por-desenho).
-- =============================================================================

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
  -- A régua do banco, colada em cada linha. A tela só traduz nome → frase.
  public.payment_situacao(p.status, p.paid_at, p.due_date)          as situacao,
  public.payment_em_aberto(p.status, p.paid_at)                     as em_aberto,
  (public.payment_em_aberto(p.status, p.paid_at)
     and p.due_date is not null
     and p.due_date < public.business_today())                      as em_atraso,
  public.payment_nao_cobravel(p.status)                             as nao_cobravel,
  coalesce(s.display_name, g.label, c.plan_name)                    as pagante,
  s.id                                                              as student_id
from payments p
left join contracts c      on c.id = p.contract_id
left join students s       on s.id = c.student_id
left join student_groups g on g.id = c.student_group_id;

comment on view public.payments_admin is
  'Espelho Asaas com a régua do banco por linha (situacao/em_aberto/em_atraso/'
  'nao_cobravel = payment_situacao e derivadas) + quem paga (aluno/grupo/plano '
  'do CONTRATO — payer_id fica de fora até o F3 preencher). security_invoker: '
  'quem protege é a RLS de payments (policy só de admin) — aluno/professora '
  'leem zero linhas. O badge de vencidas da tela conta NESTA view (count com '
  'filtro em_atraso), nunca na página paginada.';

-- Revoke nominal + grant explícito (view nova não herda o grant amplo da 0700,
-- que foi one-shot sobre as tabelas da época).
--
-- SEM grant a service_role (Sol, rodada 1 do F1): a higiene ACL da 0804 deixou
-- payment_situacao/payment_em_aberto/payment_nao_cobravel executáveis SÓ por
-- authenticated — um SELECT do service_role nesta view (invoker) morreria na
-- função. Grant que não funciona é contrato mentiroso; ninguém do lado
-- servidor lê esta view (o webhook escreve em payments, não lê situação).
revoke all on public.payments_admin from public, anon;
grant select on public.payments_admin to authenticated;
