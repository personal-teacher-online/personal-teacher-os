-- =============================================================================
-- Estúdio v2 — Leva 5, correção medida NA JANELA (04/08/2026): tirar `anon` (e
-- `service_role`, na porta única) da lista de quem pode EXECUTAR as funções da
-- migration 108.
--
-- ── O DEFEITO, E POR QUE ELE PASSOU PELOS TESTES ────────────────────────────
-- A 108 fez `revoke execute … from public` e concedeu a `authenticated`. Isso
-- basta no banco LOCAL — e é exatamente por isso que ninguém viu. Em PRODUÇÃO
-- existe um default privilege do papel `postgres` para FUNÇÕES:
--
--   pg_default_acl (nspname=public, tipo 'f'):
--     postgres=X · anon=X · authenticated=X · service_role=X
--
-- As migrations rodam como `postgres`, então toda função nova nasce com
-- EXECUTE para anon/service_role NOMEADOS — e `revoke … from public` NÃO
-- remove grant de papel nomeado. No banco local o default do `postgres` para
-- funções é só `postgres=X`, então a mesma migration produz ACLs DIFERENTES nos
-- dois lugares. Medido lado a lado na janela:
--
--   local:     anon=f · service_role=f
--   produção:  anon=t · service_role=t   ← o defeito
--
-- 📌 LIÇÃO DA CASA (vale para toda função futura): teste de ACL de FUNÇÃO no
-- banco local é FALSO-VERDE. O que vale é a sonda na janela. Grants de TABELA
-- não têm esse problema porque as migrations da casa já revogam nominalmente
-- (`revoke all … from public, anon, authenticated, service_role`) — a mesma
-- disciplina agora vale para `execute`.
--
-- ── O QUE ISSO ERA, E O QUE NÃO ERA ────────────────────────────────────────
-- NÃO era caminho de escrita: `gerar_roteiro_da_trend` recusa qualquer papel
-- que não seja admin na primeira linha do corpo, e `auth.uid()` de anônimo é
-- nulo. O que existia era superfície exposta contra a Lei 4 (negar por padrão)
-- e contra a intenção ESCRITA no comentário da 108 ("service_role fica de fora
-- de propósito") — comentário que era verdade no local e mentira na produção.
-- Esta migration faz o texto e o banco voltarem a dizer a mesma coisa.
--
-- As duas auxiliares seguem com `service_role`: é com ela que a vassoura das
-- 12:00 UTC lê a folga do dia.
-- =============================================================================

revoke execute on function
  public.gerar_roteiro_da_trend(uuid, text, text, text, jsonb)
  from anon, service_role;

revoke execute on function
  public.teto_diario_de_roteiros(), public.roteiros_gerados_hoje()
  from anon;

comment on function public.gerar_roteiro_da_trend(uuid, text, text, text, jsonb) is
  'Porta única do roteiro (ADR-032 decisão 5 · ADR-035): numa transação, cria o '
  'post (ideia → ideia_aprovada, carimbo da admin), carimba a trend NOVA como '
  'roteirizada e, se o dia tem folga, JÁ REIVINDICA o post (gerando, attempt 1) '
  '— contar e reservar no mesmo lugar é o que faz o teto ser invariante. Trend '
  'já roteirizada gera OUTRO post sem tocá-la (o 2º contexto); descartada é '
  'recusada. gerar_agora=false não é erro: o post fica na fila e a vassoura das '
  '12:00 UTC gera. gerar_agora=true OBRIGA o chamador a gerar (post preso em '
  'gerando volta pelo botão Destravar). security invoker de propósito: mantém '
  'vivo o grant por coluna da 107. EXECUTE só para authenticated — a 108 achava '
  'que já era assim, e o default privilege de produção dizia o contrário '
  '(migration 20260803000500).';

notify pgrst, 'reload schema';
