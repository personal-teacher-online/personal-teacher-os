---
name: gate-sol
description: Gate Sol, a revisão independente do diff da branch pelo codex CLI (modelo gpt-5.6-sol, outro fornecedor). Obrigatória quando a issue tem label risco:* (dinheiro, ledger, fuso, rls, migration, envio) ou o diff toca migration, ledger, RLS, materialização de horários ou outbox. Usar depois do revisor-adversarial, antes de ligar o auto-merge.
---

# Gate Sol

Revisão do diff inteiro da branch por um modelo de outra família (GPT-5.6 Sol, pelo `codex` CLI instalado
nesta máquina), para não ter o mesmo ponto cego de quem implementou e de quem revisou. Usa a assinatura
ChatGPT do dono, não API paga. É o gate automático da orquestradora; o `/code-review ultra` do CLAUDE.md
continua como gate do dono, bloqueante, antes de deploy que leva migration (ele é disparado e cobrado pelo
dono; a orquestradora não o roda).

## Quando é obrigatório

- A issue tem pelo menos um label `risco:*` (`gh issue view <N> --json labels -q '.labels[].name'`), **ou**
  o diff toca `supabase/migrations/`, funções ou tabelas de ledger (`*credit*`, `*ledger*`), políticas RLS
  (`create policy`, `grant`, `revoke`), materialização de horários (`materialize*`, `AT TIME ZONE`) ou o
  outbox (`notification_outbox`, `src/lib/outbox/`, `src/lib/notify/`, `src/lib/webhooks/`).
- Sem risco: não roda; na PR fica "Gate Sol: não se aplica".
- Dispensa só se o dono escrever na issue ou na PR que dispensa; na PR fica "Gate Sol: dispensado pelo
  dono em DD/MM/AAAA".
- `codex` ausente nesta máquina (`command -v codex` vazio) ou comando que falha: o gate **não rodou**. Na PR
  fica "Gate Sol: não rodou (codex indisponível)", a issue ganha `precisa-do-leo` e a PR não entra em
  auto-merge. Nunca registrar "não se aplica" nesse caso.

## Como rodar

Pela ferramenta **Bash** (Git Bash), não pelo PowerShell: o PowerShell 5.1 recodifica o que passa pelo pipe
e estraga os acentos do diff. O diff vai **inteiro** no stdin; o codex só lê o texto, não executa nada (o
sandbox do codex no Windows não abre subprocessos, então não pedir para ele rodar testes ou `git`).

Antes: `git fetch origin`; comparar sempre com `origin/main...HEAD`. Quando a orquestradora chama a skill, a
branch está na worktree da trabalhadora, não na pasta atual: usar `git -C "<worktree>"` em todo `git`.
**Conferir antes que o diff não é vazio** (`git -C "<worktree>" diff --stat origin/main...HEAD`): diff vazio
dá "OK" do codex sem ele ter lido nada, e isso não é veredito.

```bash
git -C "<worktree>" diff origin/main...HEAD | codex exec -m gpt-5.6-sol --skip-git-repo-check \
  -o "<scratchpad>/gate-sol-<N>.md" \
  "Revise este diff (Next.js App Router + TypeScript estrito no app; Supabase self-hosted com as regras de negócio em PL/pgSQL, RLS e triggers; escola de inglês online 1:1 com alunos em fusos com DST diferentes). Objetivo da issue #<N>: <objetivo em uma frase>. Procure bugs reais, nesta ordem: (1) fuso e DST: offset fixo, timestamp sem zona, aritmética manual de horas, instância calculada sem o offset do dia; (2) ledger de créditos: UPDATE/DELETE em ledger, saldo materializado, saldo conferido no app e não dentro da transação do banco, crédito expirado contado; (3) regra de negócio reimplementada em TypeScript que já vive no Postgres, ou mutação crítica fora de RPC; (4) RLS e permissão: política faltando, papel lido de user_metadata, service_role no cliente, função nova sem revogar EXECUTE do PUBLIC; (5) migration editada depois de aplicada, destrutiva ou fora de ordem; (6) webhook não idempotente ou que não responde 200 rápido; (7) mutação crítica sem audit_log; (8) dinheiro fora de centavos inteiros; (9) envio duplicado no outbox ou fora do silêncio noturno; (10) texto em inglês ou código interno na tela. Responda em português. Liste os achados por gravidade (Crítico, Aviso, Sugestão), cada um com arquivo:linha, o cenário concreto de falha e a correção. Sem achados, responda OK."
```

- `<N>` é o número da issue; `<scratchpad>` é a pasta temporária da sessão. O `-o` guarda só a resposta.
- Ajustar o foco do prompt ao risco da issue (ex.: `risco:envio` → "mensagem que sai duas vezes, recibo
  aplicado fora de ordem, estado gravado antes de a Evolution aceitar").
- Diff grande demora: rodar com `timeout` de 600000 ms ou em segundo plano.

## Depois da resposta: uma rodada de correção

1. Conferir **cada** achado contra o código antes de aceitar (rigor antes de concordância). Três destinos:
   - **corrigido**: o defeito existe; corrigir com teste que falha sem a correção;
   - **refutado**: o defeito não existe; anotar o motivo com `arquivo:linha` que prova (ex.: "saldo negativo
     já é recusado dentro da RPC em `20260711000200_core.sql:412`");
   - **registrado**: existe mas está fora do escopo da issue; vira issue nova (`gh issue create`, label
     `divida`) citada no corpo da PR.
2. Uma rodada só: corrigir, rodar os testes focados, e não rodar o gate de novo, a menos que a correção tenha
   mudado lógica de dinheiro, ledger, fuso ou RLS de forma grande; nesse caso, uma segunda rodada só sobre o
   diff novo (`<sha-antes>..HEAD`).

## Registrar na PR

Na seção `## Gates` do corpo da PR (modelo em `.github/pull_request_template.md`):

```
- [x] Gate Sol: N achados, M corrigidos, K refutados com motivo
  - S1 (Crítico) arquivo:linha — corrigido: ...
  - S2 (Aviso) arquivo:linha — refutado: ...
```

N = M + K + registrados. Se houver registrados, dizer o número da issue criada.
