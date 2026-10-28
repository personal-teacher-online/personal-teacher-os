-- Rascunho por IA ASSÍNCRONO com POSSE POR TOKEN — fix estrutural.
--
-- A chamada Claude do rascunho leva MINUTOS; o fetch do navegador (Safari mata
-- em ~60s, incancelável; Cloudflare em 100s) derruba a request síncrona antes
-- da resposta — a action redirecionava, mas o cliente já tinha ido embora: sem
-- toast, sem escrita, campos preservados (medido 23/07 no M5A1; benchmark de
-- VPS: a mesma chamada real levou 67s+). A action agora RESPONDE na hora e o
-- trabalho pesado corre em after() do Next (processo do servidor, sem timeout
-- de plataforma).
--
-- POSSE POR TOKEN (rodada de correção): duas abas podiam reivindicar e disparar
-- DOIS after() cujos desfechos se cruzam (um erro sobrescreve o sucesso do
-- outro, ou ambos abortam). Solução única: cada rascunho nasce com um
-- draft_job_id (uuid); a reivindicação é um UPDATE atômico condicional e TODA
-- escrita de desfecho (sucesso via RPC, erro, limpeza) exige o token — quem
-- perdeu a posse afeta 0 linhas e encerra em silêncio.
alter table slide_lessons
  add column draft_started_at timestamptz,
  add column draft_error text,
  add column draft_job_id uuid;

comment on column slide_lessons.draft_started_at is
  'Instante em que um rascunho por IA (after()) começou; null = ocioso. '
  'Recente (< teto) = em andamento: bloqueia reentrada e desabilita o botão. '
  'Antigo = provável queda do processo antes de concluir; a reivindicação '
  'atômica libera nova tentativa (o after() não tem retomada em v1).';
comment on column slide_lessons.draft_error is
  'Última falha do rascunho por IA (mensagem curta), mostrada na página da '
  'aula; limpa ao reivindicar um novo rascunho e no sucesso.';
comment on column slide_lessons.draft_job_id is
  'Token de POSSE do rascunho em voo. Só o after() que carrega este token pode '
  'gravar o desfecho (RPC slide_lesson_save_draft) ou limpar/aportar erro; um '
  'job antigo cujo token já foi substituído afeta 0 linhas e encerra em '
  'silêncio — impede desfechos cruzados de reivindicações concorrentes.';

-- O guard congela o CONTEÚDO fora de rascunho por diff de to_jsonb (whitelist
-- dos campos que a própria transição escreve). draft_started_at/draft_error/
-- draft_job_id são estado operacional do rascunho, NÃO conteúdo: o caminho de
-- erro do after() pode precisar limpá-los mesmo depois de a aula ter sido
-- aprovada em outra aba — sem a whitelist, esse UPDATE bateria no "conteúdo
-- congelado". Adiciona os três às duas listas (create or replace — Lei 7:
-- função nova, não edita migration antiga).
create or replace function public.slide_lessons_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'rascunho' then
      raise exception 'aula de slides nasce como RASCUNHO — aprovação é transição';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'aula de slides % não se apaga (Lei 8) — use o estado descartada', old.id;
  end if;

  if old.status = 'descartada' then
    raise exception 'aula % está descartada — imutável (Lei 8)', old.id;
  end if;

  if new.status <> old.status then
    if not (
      (old.status = 'rascunho' and new.status in ('aprovada', 'descartada')) or
      (old.status = 'aprovada' and new.status in ('gerada', 'rascunho')) or
      (old.status = 'gerada'   and new.status = 'rascunho')
    ) then
      raise exception 'transição inválida de % para % na aula %', old.status, new.status, old.id;
    end if;
  end if;

  -- Fora de rascunho o CONTEÚDO congela (whitelist: campos de deck, os que a
  -- própria transição escreve, e o estado operacional do rascunho por IA).
  if old.status in ('aprovada', 'gerada') then
    if to_jsonb(new) - array['status', 'approved_by', 'approved_at',
         'deck_generated_at', 'deck_drive_file_id', 'deck_url', 'deck_error',
         'draft_started_at', 'draft_error', 'draft_job_id', 'updated_at']
       <> to_jsonb(old) - array['status', 'approved_by', 'approved_at',
         'deck_generated_at', 'deck_drive_file_id', 'deck_url', 'deck_error',
         'draft_started_at', 'draft_error', 'draft_job_id', 'updated_at'] then
      raise exception 'aula % está % — conteúdo congelado; reabra para editar', old.id, old.status;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Gravação ATÔMICA do rascunho por IA (fecha o TOCTOU entre checar updated_at e
-- gravar): numa transação só, sob FOR UPDATE, exige POSSE (draft_job_id) E que o
-- updated_at ainda bata o baseline capturado na reivindicação; grava o content e
-- LIMPA o estado de trabalho no mesmo UPDATE. Divergência de baseline (edição
-- manual no intervalo) ou perda de posse (job substituído) → exception clara que
-- o after() converte em draft_error visível — nada é sobrescrito. Mesmo modelo
-- de permissão do save normal: security definer + app_role()='admin' (via client
-- do request, que carrega o JWT admin dentro do after()).
create or replace function public.slide_lesson_save_draft(
  p_id uuid,
  p_content jsonb,
  p_title text,
  p_baseline_updated_at timestamptz,
  p_job_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_updated_at timestamptz;
  v_job uuid;
begin
  if (select public.app_role()) <> 'admin' then
    raise exception 'apenas admin edita aulas de slides';
  end if;
  select status, updated_at, draft_job_id
    into v_status, v_updated_at, v_job
    from slide_lessons where id = p_id for update;
  if v_status is null then
    raise exception 'aula % não existe', p_id;
  end if;
  if v_status <> 'rascunho' then
    raise exception 'aula % está % — reabra para editar', p_id, v_status;
  end if;
  if v_job is distinct from p_job_id then
    raise exception 'rascunho sem posse (job % não é o dono atual) — nada gravado', p_job_id;
  end if;
  if v_updated_at is distinct from p_baseline_updated_at then
    raise exception 'a aula mudou durante o rascunho — nada foi gravado';
  end if;
  update slide_lessons
     set content = p_content,
         title = coalesce(p_title, title),
         draft_started_at = null,
         draft_error = null,
         draft_job_id = null
   where id = p_id;
end;
$$;

revoke execute on function
  public.slide_lesson_save_draft(uuid, jsonb, text, timestamptz, uuid)
from public, anon;

grant execute on function
  public.slide_lesson_save_draft(uuid, jsonb, text, timestamptz, uuid)
to authenticated, service_role;
