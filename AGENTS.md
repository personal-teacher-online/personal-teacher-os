<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:regras-da-casa (para agentes revisores/executores — sincronizado do CLAUDE.md em 26/07/2026) -->
# Personal Teacher OS — contexto mínimo para agentes

Sistema de gestão de escola de inglês 1:1 (Next.js App Router + Supabase
self-hosted). Fonte completa: `CLAUDE.md` (leis, estado) e `docs/`.

## Invariantes que NENHUM diff pode violar (Leis)
1. Fuso: recorrência = hora local + zona IANA; instância em timestamptz UTC
   calculada por dia; NUNCA offset fixo nem `timestamp without time zone`.
2. Ledgers de crédito: append-only, dupla entrada; saldo SEMPRE derivado;
   nunca UPDATE/DELETE em ledger, nunca coluna de saldo materializada.
3. Regra de negócio vive no Postgres (constraint/função/trigger); mutação
   crítica só via RPC; o app nunca reimplementa regra em TS.
4. RLS negar-por-padrão em toda tabela; papel lido de `app_metadata` (NUNCA
   `user_metadata`); `service_role` jamais em cliente/NEXT_PUBLIC.
5. Migrations imutáveis após aplicadas em ambiente compartilhado.
6. Dinheiro em centavos (`_cents`, int). 7. Webhooks idempotentes
   (UNIQUE event_id). 8. Mutação crítica registra em `audit_log`.

## Régua de legibilidade (do dono, 26/07 — "informação importante estava apagada")

Classifique todo texto por PAPEL antes de estilizar:
- **DADO** (responde à pergunta da tela: número, valor, saldo, vagas, estado,
  horário, nome): NUNCA `text-xs`, `text-ink-400`, `font-light/extralight`.
  Piso `text-sm font-medium text-ink-900` (ou cor semântica); número-destaque
  de cartão ≥ `font-semibold` + `tabular-nums`. "X de Y" (ocupação, saldo,
  capacidade) é DADO — inclusive quando X=0; zero é informação urgente.
- **RÓTULO** (nomeia o dado): piso `text-sm text-ink-600`; caixa alta
  espaçada de 11px não pode ser o único nome de um dado crítico.
- **APOIO** (hint, legenda, timestamp): aí sim `text-xs`/`ink-400` — mas se
  apagar a linha tira decisão do usuário, não era apoio.
- **AÇÃO parece ação**: botão do kit, alvo ≥ 24px, texto ≥ `text-sm`. Link de
  texto puro como ação é proibido em tela nova.
- Exceção: número decorativo (página de erro, login) pode ser display fino.
Contraste AA passar NÃO basta — o defeito aqui é de hierarquia, não de cor.

## Normas de revisão (para o revisor adversarial)
- REPORTE TUDO que encontrar; a triagem de gravidade é do orquestrador.
- Ataque a ABORDAGEM além dos defeitos; caso concreto > opinião.
- Telas novas (Onda 1+): proibido `<details data-popup>`, `?msg=`+nonce,
  cor fora dos tokens `--ac*`/neutros, query inline em página (usar
  `src/data/`), formatação de data crua em componente cliente.
<!-- END:regras-da-casa -->
