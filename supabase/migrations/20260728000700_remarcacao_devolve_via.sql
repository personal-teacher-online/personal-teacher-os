-- Onda do Portal · P4 (rodada de correção) — A REMARCAÇÃO CONTA POR ONDE PASSOU.
--
-- O ACHADO (revisão adversarial do P4, E1). `preview_reschedule_effect` diz
-- "franquia" no instante do render; `reschedule_class_at` re-decide dentro da
-- transação, serializada, e pode sair pelo OUTRO caminho:
--
--     insert into reschedule_usage … on conflict do nothing;
--     update reschedule_usage set used_count = used_count + 1
--      where … and used_count < monthly_reschedule_allowance
--     returning used_count into v_used;
--     if v_used is not null then v_via := 'allowance';
--     else … spend_makeup(…); v_via := 'makeup_credit'; end if;
--
-- Duas abas de um contrato de CASAL, cada uma com o preview dizendo "não custa
-- reposição", e a última franquia do mês some entre o render e o clique: a
-- segunda remarcação acontece, é legítima, e GASTA UM CRÉDITO — com a tela
-- dizendo "não custa reposição" e o toast dizendo só "Aula remarcada!". O aluno
-- descobre o gasto quando abre a página de créditos.
--
-- O QUE ESTE ARQUIVO **NÃO** FAZ. Não mexe na régua. O preview continua
-- consultivo por construção: travar a franquia no render seria segurar dinheiro
-- de terceiro numa aba aberta. A correção é de TRANSPARÊNCIA NO DESFECHO — o
-- portal passa a conseguir dizer, no recado do ato, por onde ele de fato passou.
--
-- POR QUE UMA FUNÇÃO DE LEITURA, E NÃO UM RETORNO NOVO NA RPC (desvio anotado
-- ao orquestrador). A instrução previa trocar `returns void` por `returns
-- text`/jsonb. Só que nenhuma das duas RPCs de remarcação é `void`: as duas são
-- `returns uuid` (o id da instância nova), e `book_reschedule_window` carrega a
-- nota "ASSINATURA INTOCADA — o site VELHO em produção chama esta função"
-- (20260727000700). `create or replace` não muda tipo de retorno; trocá-lo
-- exigiria DROP + CREATE das duas e deixaria a produção — que espera um uuid —
-- quebrada na janela entre a migration e o deploy, com o e-mail de confirmação
-- indo para `[object Object]`. A via, porém, JÁ está gravada: `reschedule_class_at`
-- a escreve no `audit_log` da instância nova (`diff ->> 'via'`), na mesma
-- transação do gasto. Ler essa linha é ler o desfecho REAL, não uma segunda
-- derivação — e o `audit_log` é fechado ao aluno pela RLS, daí o SECURITY
-- DEFINER com porteiro de papel e posse, no padrão do P3/P4.
--
-- Leis: 3 (nenhuma regra nova — leitura do que a escrita decidiu), 4 (REVOKE +
-- papel + posse por `my_contract_ids()`), 7 (migration NOVA; a 000700 de 27/07 é
-- imutável e continua intocada).

create or replace function public.via_da_remarcacao(p_instance uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst class_instances%rowtype;
  v_via text;
begin
  perform public._aulas_do_aluno_permitido();

  -- MESMA frase para "não existe" e "não é sua" (o oráculo de UUID fechado na
  -- migration 20260728000600).
  select * into v_inst from class_instances where id = p_instance;
  if not found
     or (public.app_role() <> 'admin'
         and v_inst.contract_id not in (select public.my_contract_ids())) then
    raise exception 'aula não encontrada';
  end if;

  -- A linha que `reschedule_class_at` escreveu para ESTA instância (a NOVA). Sem
  -- linha — resgate de crédito, aula materializada por outro caminho — devolve
  -- NULL, e o portal cai no recado genérico em vez de inventar uma via.
  select a.diff ->> 'via' into v_via
    from audit_log a
   where a.entity = 'class_instances'
     and a.entity_id = p_instance::text
     and a.action = 'reschedule_class'
   order by a.at desc, a.id desc
   limit 1;

  return v_via;
end;
$$;

comment on function public.via_da_remarcacao(uuid) is
  'Por onde a remarcação que CRIOU esta instância de fato passou (allowance · '
  'makeup_credit · courtesy), lido do audit_log que reschedule_class_at gravou '
  'na mesma transação do gasto. Existe porque o preview é consultivo: entre o '
  'render e o clique a via pode trocar, e o recado do ato tem de contar a '
  'verdade. NULL quando a instância não nasceu de remarcação.';

revoke execute on function public.via_da_remarcacao(uuid) from public, anon;
grant execute on function public.via_da_remarcacao(uuid) to authenticated, service_role;
