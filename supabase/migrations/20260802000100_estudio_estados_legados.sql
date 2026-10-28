-- =============================================================================
-- Estúdio v2 — Leva 0.2 (ADR-032 decisão 8): estados de PARQUEAMENTO em
-- content_posts.
--
--   ciclo_futuro  carrossel/story saem do caminho SEM virar lixo — o formato
--                 volta num ciclo futuro (decisão de produto §2.13, 02/08).
--   arquivado     reel pré-esteira, com MOTIVO obrigatório (archived_reason).
--
-- Os dois são TERMINAIS e imutáveis como `descartado`. Entram a partir de
-- QUALQUER estado não-terminal (inclusive `aprovado` — a whitelist pós-
-- aprovação ganha `archived_reason` e nada mais). Quem decide O QUE parquear
-- é o script de dados (`scripts/leva-0-2-arquivar-legado.sql`), rodado à
-- parte em produção: esta migration só dá os estados e as regras.
--
-- Notas de ordem (mesma disciplina da 20260801000200):
-- 1. Constraints recriados por DROP+ADD com os nomes REAIS conferidos no
--    banco (pg_constraint): content_posts_status_check e
--    content_posts_gate1_shape. Nenhuma linha existente viola os novos
--    (só AMPLIAM o domínio), então o ADD não revalida nada além do que já
--    vale.
-- 2. gate1_shape: os estados novos entram na lista de ISENTOS do carimbo do
--    portão 1 — post parqueado direto de `ideia` não tem idea_approved_*, e
--    exigir carimbo aqui tornaria o parqueamento de ideia IRREPRESENTÁVEL
--    (a classe de erro que o M4 chamou de bicondicional indevido).
-- 3. O guard é CREATE OR REPLACE da função existente (trigger fica): o mapa
--    de transições é hard-coded nela por desenho (F1), então a mudança de
--    mapa é mudança de função. Guards de teste em
--    tests/conteudo-estados-legados.test.ts nasceram VERMELHOS antes deste
--    arquivo (regra 7).
-- =============================================================================

alter table content_posts add column archived_reason text;

comment on column content_posts.archived_reason is
  'Motivo do arquivamento (obrigatório em status=arquivado; ex.: pré-esteira). '
  'Só se escreve NA transição para arquivado — depois o post é imutável.';

-- ---------------------------------------------------------------------------
-- CHECK de status: +ciclo_futuro, +arquivado.
-- ---------------------------------------------------------------------------
alter table content_posts drop constraint content_posts_status_check;
alter table content_posts add constraint content_posts_status_check check (status in
  ('ideia', 'ideia_aprovada', 'gerando', 'rascunho',
   'aprovado', 'publicado', 'rejeitado', 'descartado',
   'ciclo_futuro', 'arquivado'));

-- gate1_shape: parqueado é isento do carimbo do portão 1 (nota 2 acima).
alter table content_posts drop constraint content_posts_gate1_shape;
alter table content_posts add constraint content_posts_gate1_shape check (
  status in ('ideia', 'rejeitado', 'descartado', 'ciclo_futuro', 'arquivado')
  or (idea_approved_by is not null and idea_approved_at is not null));

-- arquivado exige motivo de verdade — nem branco, nem tab/quebra de linha
-- (achado nº 6 do Sol: btrim sem 2º argumento só tira espaço).
alter table content_posts add constraint content_posts_archived_shape check (
  status <> 'arquivado'
  or (archived_reason is not null and btrim(archived_reason, E' \t\r\n') <> ''));

-- ---------------------------------------------------------------------------
-- Guard: terminais agora são 4; todo não-terminal pode ser parqueado; a
-- whitelist pós-aprovação ganha archived_reason (e SÓ ela — conteúdo segue
-- congelado). O resto da função é o texto da 20260720000400, intacto.
-- ---------------------------------------------------------------------------
create or replace function public.content_posts_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'ideia' then
      raise exception 'post de conteúdo nasce como IDEIA — aprovações são transições';
    end if;
    -- Motivo de arquivamento não nasce com o post (achado nº 5 do Sol): a
    -- coluna só se escreve NA transição para arquivado.
    if new.archived_reason is not null then
      raise exception 'archived_reason só se escreve ao arquivar — post nasce sem motivo';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'post de conteúdo % não se apaga (Lei 8) — use o estado descartado', old.id;
  end if;

  if old.status in ('publicado', 'descartado', 'ciclo_futuro', 'arquivado') then
    raise exception 'post % está % — imutável (Lei 8)', old.id, old.status;
  end if;

  if new.status <> old.status then
    if not (
      (old.status = 'ideia'          and new.status in ('ideia_aprovada', 'rejeitado', 'descartado', 'ciclo_futuro', 'arquivado')) or
      (old.status = 'ideia_aprovada' and new.status in ('gerando', 'descartado', 'ciclo_futuro', 'arquivado')) or
      (old.status = 'gerando'        and new.status in ('rascunho', 'ideia_aprovada', 'descartado', 'ciclo_futuro', 'arquivado')) or
      (old.status = 'rascunho'       and new.status in ('aprovado', 'rejeitado', 'descartado', 'ciclo_futuro', 'arquivado')) or
      (old.status = 'rejeitado'      and new.status in ('ideia_aprovada', 'descartado', 'ciclo_futuro', 'arquivado')) or
      (old.status = 'aprovado'       and new.status in ('publicado', 'ciclo_futuro', 'arquivado'))
    ) then
      raise exception 'transição inválida de % para % no post %', old.status, new.status, old.id;
    end if;
  end if;

  -- archived_reason só muda entrando em arquivado (achado nº 5 do Sol) — em
  -- qualquer outro destino a coluna é imutável, inclusive limpar.
  if new.archived_reason is distinct from old.archived_reason
     and new.status <> 'arquivado' then
    raise exception 'archived_reason só se escreve na transição para arquivado (post %)', old.id;
  end if;

  if old.status = 'aprovado' then
    -- WHITELIST pós-aprovação (achado 26 de progress_reports): só publicação
    -- anda — e, desde a Leva 0.2, o motivo do arquivamento.
    if to_jsonb(new) - array['status', 'post_url', 'published_by', 'published_at', 'scheduled_for', 'archived_reason', 'updated_at']
       <> to_jsonb(old) - array['status', 'post_url', 'published_by', 'published_at', 'scheduled_for', 'archived_reason', 'updated_at'] then
      raise exception 'post % aprovado tem conteúdo congelado — só publicação/agenda/arquivamento mudam', old.id;
    end if;
  end if;

  -- Saída de rejeitado para TERMINAL novo não abre janela de edição (achado
  -- nº 2 do Sol): o registro congelado do portão vai para o arquivo COMO ESTÁ.
  if old.status = 'rejeitado' and new.status in ('ciclo_futuro', 'arquivado') then
    if to_jsonb(new) - array['status', 'archived_reason', 'updated_at']
       <> to_jsonb(old) - array['status', 'archived_reason', 'updated_at'] then
      raise exception 'post % rejeitado vai para % como está — conteúdo congelado', old.id, new.status;
    end if;
  end if;

  -- Conteúdo de post rejeitado fica congelado como registro do portão: o motivo
  -- é o feedback; "tentar de novo" é transição, não edição.
  if old.status = 'rejeitado' and new.status = 'rejeitado' then
    raise exception 'post % rejeitado não se edita — tente de novo ou descarte', old.id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on table content_posts is
  'Posts sociais da fábrica de conteúdo (ADR-021; Estúdio v2 em ADR-032). '
  'Nasce SEMPRE ideia; transições só pelo mapa do content_posts_guard; DELETE '
  'proibido (descartado é estado). Estados terminais: publicado, descartado, '
  'ciclo_futuro (formato parqueado p/ ciclo futuro) e arquivado (pré-esteira, '
  'motivo em archived_reason). Imagens no Drive (Lei 10); texto fora da '
  'imagem (Lei 11).';
