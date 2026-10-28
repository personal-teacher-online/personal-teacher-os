-- ONDA DA AGENDA · A1 — Sol rodada 3: o lote "✓ Todas aconteceram (N)" passa a
-- operar sobre os IDs EXATOS que a tela confirmou.
--
-- ⚠️ REESCRITA EM PLACE (28/07): esta migration nunca foi aplicada em ambiente
-- compartilhado (produção está na 94ª) — reescrever antes do primeiro apply não
-- fere a Lei 7, que protege migration JÁ aplicada.
--
-- A versão anterior deste arquivo alinhava a SELEÇÃO da RPC com os critérios da
-- fila (fim já passado, piso de 60 dias). Mas critérios iguais avaliados em
-- INSTANTES diferentes não são o mesmo conjunto: a fila congela o "agora" no
-- render, e a RPC recalculava `now()` no submit — aula que TERMINA nesse
-- intervalo entrava no lote sem nunca ter aparecido na tela que a dona
-- confirmou (mutação de extrato maior do que a autorizada). E o "sempre por
-- professora" (S2-7) vivia só na Server Action do Next: a função ainda aceitava
-- `p_teacher NULL` — regra de negócio fora do banco, contra a Lei 3.
--
-- O contrato agora é: a tela manda os IDs que MOSTROU, e a função valida um a
-- um (existe, é da professora, segue 'scheduled', o fim já passou). QUALQUER
-- divergência aborta TUDO com um recado só — a confirmação da dona valia para
-- aquele conjunto exato, então ou o lote inteiro vale ou nada é registrado.
--
-- ⚠️ "ALL-OR-NOTHING" É DA VALIDAÇÃO, NÃO DO APONTAMENTO (correção do portão de
-- deploy, 29/07): o texto anterior desta linha induzia a erro. O que é
-- all-or-nothing é a CONFERÊNCIA do conjunto — um ID divergente derruba o lote
-- inteiro. O pulo D2 continua existindo DEPOIS dela: aula sem linha em
-- `class_content_reports` não é concluída, entra em `skipped` e NÃO estoura,
-- porque aula sem apontamento não pode contar no extrato da professora. Quem
-- responde por não prometer N e fazer menos é a TELA: ela só envia (e só conta
-- no botão) as pendências que JÁ têm apontamento, e diz quantas ficam de fora e
-- por quê. O retorno (`v_done`) é o número REALMENTE concluído — a Server
-- Action compara com o que enviou e, se sobrar diferença (corrida entre render
-- e submit), o recado sai vermelho dizendo quantas ficaram.
--
-- SEM piso de 60 dias: com IDs explícitos o alinhamento com a fila é por
-- CONSTRUÇÃO (os IDs vêm dela). Corrigindo também a afirmação falsa do
-- cabeçalho anterior deste arquivo: a fila TEM o piso de 60 dias
-- (`inicioDasPendencias`, src/data/admin/agenda.ts) — o que continua verdadeiro
-- é que aula mais velha que isso segue tratável UMA A UMA pela grade,
-- navegando até ela; ela só não entra em lote.
--
-- Mantido da versão vigente (20260720000300): pulo D2 (aula sem apontamento em
-- `class_content_reports` vai para `skipped`, não conta e não estoura),
-- `complete_class` por aula, auditoria do lote, retorno = nº de concluídas.
--
-- A assinatura MUDA (ganha `p_instances uuid[]`) ⇒ DROP + CREATE: um CREATE
-- sem DROP criaria um OVERLOAD e a versão antiga — a da corrida — sobreviveria
-- atendendo os chamadores velhos. O DROP derruba os grants da assinatura
-- antiga, então eles são reaplicados no fim (o padrão da original,
-- 20260718000400).

drop function if exists public.admin_complete_past_batch(uuid, uuid);

create function public.admin_complete_past_batch(
  p_teacher uuid,
  p_instances uuid[],
  p_actor uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_actor uuid;
  v_batch uuid := gen_random_uuid();
  v_ids uuid[];
  v_skipped uuid[] := array[]::uuid[];
  v_id uuid;
  v_done int := 0;
begin
  if public.app_role() <> 'admin' then
    raise exception 'admin_complete_past_batch é restrita à admin (D10)';
  end if;
  v_actor := coalesce(auth.uid(), p_actor);

  -- S2-7 virou LEI DO BANCO: o atestado em massa entra no extrato da
  -- professora, então o escopo por professora não pode depender da UI.
  if p_teacher is null then
    raise exception 'o atestado em lote é sempre por professora — escolha a professora antes de confirmar';
  end if;
  if p_instances is null or cardinality(p_instances) = 0 then
    raise exception 'o lote chegou sem nenhuma aula — recarregue as pendências e confirme de novo';
  end if;

  -- Conjunto é CONJUNTO (Sol · rodada 4): a tela nunca manda ID repetido, mas a
  -- função é endpoint. Sem o dedup, a duplicata ora abortava com o recado errado
  -- (a 2ª conclusão estoura dentro de `complete_class`), ora deformava a
  -- auditoria (o mesmo ID duas vezes em instances/skipped).
  -- ORDEM DETERMINÍSTICA (correção do portão de deploy, 29/07): sem `order by`
  -- o `array_agg(distinct …)` devolve a ordem que o agrupamento produzir, e a
  -- ordem é o que decide a sequência dos locks de `complete_class`. Dois lotes
  -- simultâneos com conjuntos que se cruzam podiam pegar as mesmas linhas em
  -- ordens opostas e formar DEADLOCK — o Postgres aborta um dos dois, então não
  -- há registro parcial, mas a dona vê a operação falhar de forma intermitente
  -- e sem motivo visível. Ordenando, dois lotes concorrentes esperam em fila.
  select array_agg(distinct u order by u) into v_ids from unnest(p_instances) u;

  -- Valida TODOS os IDs antes de concluir qualquer um. Aula em andamento ou
  -- futura NUNCA entra (fim já passado, com o mesmo fallback de 45 min que a
  -- grade assume quando não há `ends_at_utc`). Divergência = a fila mudou
  -- entre o render e o submit; o conjunto confirmado já não existe.
  foreach v_id in array v_ids loop
    if not exists (
      select 1 from class_instances ci
      where ci.id = v_id
        and ci.teacher_id = p_teacher
        and ci.state = 'scheduled'
        and coalesce(ci.ends_at_utc, ci.starts_at_utc + interval '45 minutes') <= now()
    ) then
      raise exception 'a fila de pendências mudou desde que a tela foi aberta — nada foi registrado; recarregue as pendências e confirme de novo';
    end if;
  end loop;

  foreach v_id in array v_ids loop
    if exists (select 1 from class_content_reports where class_instance_id = v_id) then
      perform public.complete_class(v_id, v_actor, v_batch);
      v_done := v_done + 1;
    else
      v_skipped := v_skipped || v_id;
    end if;
  end loop;

  perform public.log_audit(v_actor, 'complete_class_batch', 'class_instances', v_batch::text,
    jsonb_build_object('teacher_id', p_teacher, 'count', v_done,
      'instances', to_jsonb(v_ids), 'skipped_sem_apontamento', to_jsonb(v_skipped)));
  return v_done;
end;
$$;

revoke execute on function public.admin_complete_past_batch(uuid, uuid[], uuid)
from public, anon, authenticated;
grant execute on function public.admin_complete_past_batch(uuid, uuid[], uuid) to authenticated;
