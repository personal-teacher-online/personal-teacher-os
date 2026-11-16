---
paths:
  - "supabase/migrations/**"
  - "supabase/seed.sql"
  - "src/lib/outbox/**"
  - "src/lib/notify/**"
  - "src/lib/webhooks/**"
  - ".github/**"
  - ".claude/**"
  - ".githooks/**"
  - "scripts/vazamento*"
  - "Dockerfile"
  - "next.config.ts"
  - "CLAUDE.md"
  - "AGENTS.md"
  - "Design.md"
---

# Mudança de risco e caminho protegido

- Antes do merge de mudança nestes arquivos, ou de qualquer mudança que mexa em dinheiro, ledger, fuso, RLS,
  migration ou envio (os labels `risco:*`), o diff inteiro da branch passa por uma revisão do Codex (outro
  fornecedor, pontos cegos diferentes): `/codex:adversarial-review`, ou o agente `codex:codex-rescue` quando é
  a própria sessão a pedir. O resultado vai na seção "Conferência" da PR. Codex sem cota: a revisão é de um
  agente novo, sem o contexto da sessão que escreveu; "não rodou" nunca se registra como "sem achados".
- Mudança em regra, permissão, hook ou passo da CI entra no corpo da PR numa linha em linguagem de negócio
  ("Mudou regra ou estrutura"), que é o que o dono lê antes de autorizar o merge.
- Scanner (`scripts/vazamento*`), `.githooks/`, `.claude/rules/dados-de-teste.md` e a configuração do
  gitleaks só mudam com o label `dono-liberou`, posto pelo dono na interface do GitHub. O check "scanner
  protegido" barra a PR sem ele.
- Migration aplicada em ambiente compartilhado não se edita (Lei 7): mudança é migration nova. Função nova
  revoga `EXECUTE` nominalmente (`tests/acl-higiene.test.ts`).
