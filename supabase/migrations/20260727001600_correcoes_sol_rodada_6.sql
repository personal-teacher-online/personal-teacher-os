-- ###########################################################################
-- LOTE c16 · AS CORREÇÕES DE BANCO DA RODADA 6 DO SOL (ADR-029)
-- ###########################################################################
--
-- Migration NOVA (Lei 7): nada aqui edita a `20260727001500` nem nenhuma outra.
-- Os dois `create or replace` mantêm a assinatura, então os grants sobrevivem.
--
-- O ESCOPO DESTE ARQUIVO é o que a ADR-029 mandou corrigir AGORA — o resto da
-- cauda de assinatura (r6 nº 1, 4, 5 e 6) é reconciliação com a API real do
-- Autentique e só se fecha quando o gate 🔑 abrir; até lá a superfície da tela
-- fica desligada (ADR-029 §1) e o motor continua provado no nível de dados.
--
--  1 · r6 nº 3 (GRAVE) — `signature.accepted` de UM signatário NÃO encerra o
--      documento. Contrato de casal tem dois signatários; o evento de aceite é
--      POR ASSINATURA, e a matriz mandava o espelho direto para `signed`, que é
--      TERMINAL. Resultado: o primeiro a assinar fazia o app declarar o
--      contrato assinado — e, como terminal não regride, o `document.finished`
--      que viria depois (ou a RECUSA do segundo signatário!) já não mudava
--      nada. O documento ficava "assinado" com uma assinatura faltando, e a
--      tela parava de oferecer a consulta que descobriria isso.
--
--  2 · r6 nº 13 — o teto do motivo do cancelamento de reserva DESCE PARA A RPC
--      (Lei 3). Ele existia só como `maxLength={200}` num input, isto é: valia
--      para quem digita e não valia para o POST montado à mão. E `maxLength`
--      conta unidades UTF-16, então o mesmo campo recusava 101 emojis e aceitava
--      200 letras — duas réguas para um teto só. Aqui a conta é `char_length`
--      (code points), a mesma do CHECK do nome do plano (c14 · Sol 7.1).
--
-- Leis tocadas: 3 (a régua do motivo passa a morar no Postgres), 6 (a matriz de
-- eventos do webhook fica coerente com o que o provedor de fato diz), 7
-- (migration nova), 8 (o `audit_log` do cancelamento continua com ator e
-- motivo). Nada de fuso (Lei 1), nada de dinheiro (Lei 9).


-- ###########################################################################
-- 1 · UM SIGNATÁRIO QUE ASSINA NÃO ENCERRA O DOCUMENTO (r6 nº 3)
-- ###########################################################################
--
-- A MATRIZ, corrigida:
--
--   signature.viewed    → viewed     (alguém abriu)
--   signature.accepted  → viewed     (alguém ASSINOU — o documento andou, e
--                                     ainda não acabou)
--   signature.rejected  → refused    (TERMINAL: uma recusa mata o documento
--                                     inteiro, não importa quantos faltavam)
--   document.finished   → signed     (TERMINAL: o provedor diz que ACABOU —
--                                     é o único evento que fala do DOCUMENTO
--                                     como um todo)
--   document.deleted    → cancelled  (TERMINAL)
--
-- POR QUE `viewed` E NÃO UM ESTADO NOVO. O espelho local não guarda signatário
-- nenhum — ele tem UMA linha por documento (`contract_signatures`), e por isso
-- não sabe dizer "1 de 2 assinaram". Inventar um status novo aqui seria fingir
-- uma informação que a tabela não tem. `viewed` é o degrau intermediário que a
-- matriz já tinha (`sent`=1 → `viewed`=2 → terminais=3): ele diz "o documento
-- andou e ainda pode mudar", que é exatamente o que sabemos. A tela passa a
-- chamar esse degrau de "assinatura em andamento" em vez de "visualizada",
-- porque agora ele cobre as duas coisas.
--
-- E É COERENTE COM A CONSULTA MANUAL, que já estava certa e discordava daqui:
-- `getDocumentSignatures` (src/lib/autentique/client.ts) só devolve
-- `signed: true` quando `signatures.every(s => s.signed)`. Antes, o webhook
-- dizia "assinado" com um signatário e a consulta dizia "nada mudou" — duas
-- respostas para a mesma pergunta, e a errada era a que escrevia no banco.
--
-- O GÊMEO EM TS (`EVENT_STATUS`, src/lib/webhooks/autentique.ts) muda no mesmo
-- lote e é conferido tipo a tipo pelo aceite do c16 — as duas cópias existem
-- porque a reaplicação de eventos presos acontece dentro da transação do anexo.
create or replace function public.autentique_status_do_evento(p_type text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case p_type
    when 'signature.viewed'   then 'viewed'
    -- r6 nº 3: o aceite de UM signatário é andamento, não desfecho.
    when 'signature.accepted' then 'viewed'
    when 'signature.rejected' then 'refused'
    when 'document.finished'  then 'signed'
    when 'document.deleted'   then 'cancelled'
    else null
  end;
$fn$;

comment on function public.autentique_status_do_evento(text) is
  'c15 · Sol 4 + c16 · r6 nº 3: evento do Autentique → status alvo. Espelho SQL '
  'da matriz de `src/lib/webhooks/autentique.ts`, para a reaplicação de eventos '
  'presos acontecer dentro da transação do anexo. `signature.accepted` é de UM '
  'signatário e vale `viewed` (andamento); só `document.finished` (todos '
  'assinaram), a recusa e a exclusão são terminais.';


-- ###########################################################################
-- 2 · O TETO DO MOTIVO DO CANCELAMENTO É DO BANCO (r6 nº 13)
-- ###########################################################################
--
-- Corpo copiado da `20260727001500` com UMA adição: a conferência do tamanho
-- do motivo, em CODE POINTS, com a frase que a pessoa lê. O input perdeu o
-- `maxLength` no mesmo lote (ele mentia por medir UTF-16); quem antecipa agora
-- é a tela em code points, e quem decide é isto aqui.
create or replace function public.admin_cancel_signature(
  p_signature uuid,
  p_confirm text,
  p_reason text,
  p_actor uuid default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor uuid;
  v_sig contract_signatures%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_cancel_signature é restrita à admin';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  if not public._confirmacao_bate(
       p_confirm, 'confira antes no painel do Autentique se o documento existe') then
    raise exception
      'confirmação não confere — para cancelar a reserva, digite: confira antes no painel do Autentique se o documento existe';
  end if;
  if v_motivo is null then
    raise exception
      'diga o motivo do cancelamento — é ele que explica, seis meses depois, por que esta reserva morreu sem documento';
  end if;
  -- c16 · r6 nº 13: `char_length` conta CARACTERES (code points), como o CHECK
  -- do nome do plano. O número aparece na frase porque teto sem número obriga a
  -- pessoa a adivinhar quanto cortar.
  if char_length(v_motivo) > 200 then
    raise exception
      'o motivo do cancelamento cabe em 200 caracteres (você escreveu %) — diga o essencial: o que você conferiu no painel do Autentique',
      char_length(v_motivo);
  end if;

  select * into v_sig from contract_signatures where id = p_signature for update;
  if not found then
    raise exception 'reserva de assinatura % não existe', p_signature;
  end if;
  if v_sig.status <> 'pending' then
    raise exception
      'esta reserva não está aberta (%) — só a reserva sem documento se cancela por aqui; documento que existe no Autentique muda de estado pela consulta',
      v_sig.status;
  end if;

  update contract_signatures
     set status = 'failed',
         last_event = jsonb_build_object(
           'source', 'cancelamento_humano', 'at', now(),
           'ator', v_actor, 'motivo', v_motivo)
   where id = p_signature;

  perform public.log_audit(v_actor, 'cancel_signature', 'contract_signatures',
    p_signature::text,
    jsonb_build_object('contract_id', v_sig.contract_id, 'from', 'pending',
                       'to', 'failed', 'motivo', v_motivo,
                       'reservada_em', v_sig.reserved_at));
  return 'failed';
end;
$fn$;

comment on function public.admin_cancel_signature(uuid, text, text, uuid) is
  'c15 · decisão B + c16 · r6 nº 13: ato HUMANO que mata uma reserva de '
  'assinatura aberta — com frase de confirmação (que manda conferir o Autentique '
  'antes), motivo escrito de no máximo 200 CARACTERES (char_length, conferido '
  'aqui) e os dois no `audit_log`.';
