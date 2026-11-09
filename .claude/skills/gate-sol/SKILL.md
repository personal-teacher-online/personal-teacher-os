---
name: gate-sol
description: Gate Sol, a revisão independente do diff da branch pelo codex CLI (modelo gpt-5.6-sol, outro fornecedor). Obrigatória quando a issue tem label risco:* (dinheiro, ledger, fuso, rls, migration, envio) ou o diff toca migration, ledger, RLS, materialização de horários, outbox ou caminho protegido (ADR-041). Usar depois do revisor-adversarial, antes de ligar o auto-merge.
---

# Gate Sol

Revisão do diff inteiro da branch por um modelo de outra família (GPT-5.6 Sol, pelo `codex` CLI instalado
nesta máquina), para não ter o mesmo ponto cego de quem implementou e de quem revisou. Usa a assinatura
ChatGPT do dono, não API paga. É o gate automático da orquestradora. O gate do dono antes de deploy que leva migration ou toca
dinheiro, ledger, RLS ou fuso é o `/code-review xhigh` local na sessão de deploy (CLAUDE.md,
"Gate do dono"; ADR-040). O `/code-review ultra` na nuvem saiu em 29/10/2026.

## Quando é obrigatório

- A issue tem pelo menos um label `risco:*` (`gh issue view <N> --json labels -q '.labels[].name'`), **ou**
  o diff toca `supabase/migrations/`, funções ou tabelas de ledger (`*credit*`, `*ledger*`), políticas RLS
  (`create policy`, `grant`, `revoke`), materialização de horários (`materialize*`, `AT TIME ZONE`) ou o
  outbox (`notification_outbox`, `src/lib/outbox/`, `src/lib/notify/`, `src/lib/webhooks/`), **ou** o diff
  toca caminho protegido (lista em `CLAUDE.md`, "Travas do auto-merge"; ADR-041) ou o que decide o veredito
  da CI (scripts de teste e lint no `package.json`, `vitest.config*`, `eslint.config*`, `tsconfig*.json`):
  aí o prompt leva também o
  item (11), e qualquer achado dele é Crítico.
- Sem risco: não roda; na PR fica "Gate Sol: não se aplica".
- Dispensa só se o dono escrever na issue ou na PR que dispensa, e nunca quando o diff toca caminho
  protegido (ADR-041; todo agente escreve com a conta do dono); na PR fica "Gate Sol: dispensado pelo
  dono em DD/MM/AAAA".
- `codex` ausente nesta máquina (`command -v codex` vazio) ou comando que falha: o gate **não rodou**. Na PR
  fica "Gate Sol: não rodou (codex indisponível)", a issue ganha `precisa-do-leo` e a PR não entra em
  auto-merge. Nunca registrar "não se aplica" nesse caso.

## Como rodar

Pela ferramenta **Bash** (Git Bash), não pelo PowerShell: o PowerShell 5.1 recodifica o que passa pelo pipe
e estraga os acentos do diff. O codex só lê o texto, não executa nada (o sandbox do codex no Windows não
abre subprocessos, então não pedir para ele rodar testes ou `git`).

**Rodar de dentro da worktree** (o `cd "<worktree>"` do subshell abaixo, nunca solto), que já é um
repositório git: assim o codex não precisa de `--skip-git-repo-check`, e a proteção da worktree recusa o
comando que leva essa opção (medido no lotufo, 30/10/2026). **Nunca usar `--skip-git-repo-check`.** O pedido
e o diff inteiro vão **juntos num único arquivo de entrada**, lido pelo stdin com `-` no lugar do prompt.

Antes: `git fetch origin`; comparar sempre com `origin/main...HEAD`. Quando a orquestradora chama a skill, a
branch está na worktree da trabalhadora, não na pasta atual: entrar na worktree com o `cd` do subshell
abaixo. **Conferir antes que o diff não é vazio**: diff vazio dá "OK" do codex sem ele ter lido nada, e isso
não é veredito (o bloco já confere).

O bloco abaixo vai **inteiro numa única chamada do Bash, dentro de um subshell** `( ... )`: o `cd` fica
dentro do subshell e não muda o diretório da sessão. Isso importa porque, na sessão da orquestradora, o
diretório do Bash persiste de uma chamada para a outra; um `cd` solto a deixaria dentro da worktree da
trabalhadora, e o `git pull` seguinte rodaria na branch errada ou a remoção da worktree falharia.
`<worktree>` é o caminho absoluto que a orquestradora passou. **Numa sessão manual dentro da worktree** (a
sessão do app em `.claude/worktrees/...`), não usar o subshell: a proteção da worktree recusa o bloco
composto ("too complex to verify that it stays inside the worktree"; medido em 09/11/2026, #161). Ali a
pasta atual já é a worktree, então os mesmos passos vão em chamadas separadas e simples, cada uma sem `cd`,
sem `||` e sem `;`: (1) `git diff --quiet origin/main...HEAD` e conferir `rc=1`; (2) escrever o arquivo de
entrada com o pedido pela ferramenta Write; (3) `git diff origin/main...HEAD >> "<entrada>"`; (4) o
`codex exec ... - < "<entrada>" > "<log>" 2>&1` sozinho, em segundo plano.

```bash
(
cd "<worktree>" || exit 1
git diff --quiet origin/main...HEAD; rc=$?; [ "$rc" -eq 1 ] || { echo "diff vazio ou erro no git diff (rc=$rc)"; exit 1; }
ENTRADA="<scratchpad>/gate-sol-<N>-entrada.md"
cat > "$ENTRADA" <<'PEDIDO'
Revise este diff (Next.js App Router + TypeScript estrito no app; Supabase self-hosted com as regras de negócio em PL/pgSQL, RLS e triggers; escola de inglês online 1:1 com alunos em fusos com DST diferentes). Objetivo da issue #<N>: <objetivo em uma frase>. Procure bugs reais, nesta ordem: (1) fuso e DST: offset fixo, timestamp sem zona, aritmética manual de horas, instância calculada sem o offset do dia; (2) ledger de créditos: UPDATE/DELETE em ledger, saldo materializado, saldo conferido no app e não dentro da transação do banco, crédito expirado contado; (3) regra de negócio reimplementada em TypeScript que já vive no Postgres, ou mutação crítica fora de RPC; (4) RLS e permissão: política faltando, papel lido de user_metadata, service_role no cliente, função nova sem revogar EXECUTE do PUBLIC; (5) migration editada depois de aplicada, destrutiva ou fora de ordem; (6) webhook não idempotente ou que não responde 200 rápido; (7) mutação crítica sem audit_log; (8) dinheiro fora de centavos inteiros; (9) envio duplicado no outbox ou fora do silêncio noturno; (10) texto em inglês ou código interno na tela; (11) só se o diff toca caminho protegido: regra afrouxada, isto é, permissão de agente ampliada (allow novo, ask ou deny removido), lei, trava ou gate removido ou amolecido em CLAUDE.md, AGENTS.md, skill ou agente, CI enfraquecida (job ou passo removido, continue-on-error, teste pulado, if que desvia), hook do git desligado, scanner de dado real com regra a menos ou exceção nova, script de teste ou lint que roda menos (package.json, vitest.config, eslint.config, tsconfig), TZ=UTC tirado da CI ou do container, usuário não-root ou cabeçalho de segurança removido; todo achado deste item é Crítico e começa com [regra afrouxada]. Responda em português. Liste os achados por gravidade (Crítico, Aviso, Sugestão), cada um com arquivo:linha, o cenário concreto de falha e a correção. Sem achados, responda OK.

DIFF:
PEDIDO
git diff origin/main...HEAD >> "$ENTRADA" || { echo "git diff falhou"; exit 1; }
rm -f "<scratchpad>/gate-sol-<N>.md"
codex exec -m gpt-5.6-sol -o "<scratchpad>/gate-sol-<N>.md" - < "$ENTRADA" > "<scratchpad>/gate-sol-<N>.log" 2>&1 || { echo "codex falhou:"; tail -n 20 "<scratchpad>/gate-sol-<N>.log"; exit 1; }
)
```

- `<N>` é o número da issue; `<scratchpad>` é a pasta temporária da sessão. O `-o` guarda só a resposta
  final; o `-` manda o codex ler o prompt (pedido + diff) do stdin, que aqui vem do arquivo de entrada.
- A saída do codex (stdout e stderr) vai para `<scratchpad>/gate-sol-<N>.log`, e o `codex falhou:` mostra o
  fim dele: é lá que aparece o "usage limit" (ver "Sem cota", abaixo).
- Depois de rodar, **ler o arquivo do `-o`** (`<scratchpad>/gate-sol-<N>.md`). Ausente, vazio, ou sem "OK"
  nem lista de achados: veredito inválido; rodar de novo uma vez (antes, olhar o `.log`: se for "usage
  limit", é o caso "Sem cota", abaixo, e rodar de novo não adianta).
- Ajustar o foco do prompt ao risco da issue (ex.: `risco:envio` → "mensagem que sai duas vezes, recibo
  aplicado fora de ordem, estado gravado antes de a Evolution aceitar").
- Diff grande demora: rodar com `timeout` de 600000 ms ou em segundo plano.

## Sem cota ("usage limit")

O codex usa a cota da assinatura ChatGPT do dono. Se a saída (o `codex falhou:` do comando, o `.log` ou o
arquivo do `-o`) trouxer "usage limit" (ou "limite de uso"), **não é veredito inválido e rodar de novo no
mesmo dia não adianta**: a cota volta no dia seguinte. Não insistir; registrar em `## Gates` da PR:

```
- [ ] Gate Sol: sem cota em DD/MM
```

E a PR **não mergeia sozinha**: sem auto-merge, `precisa-do-leo` na issue dizendo que falta só o gate Sol.
Quando a cota voltar, o dono pede à orquestradora que rode o gate pela skill (a rodada seguinte não pega
issue com `precisa-do-leo`), e só então se liga o auto-merge. Aqui não vale "o revisor cobre no lugar do
Sol": em caminho protegido o passo 8 da skill `orquestrar` exige Sol rodado de fato (ADR-041); com `risco:*`
a única dispensa é a escrita pelo dono ("Quando é obrigatório", acima), e sem cota não é dispensa.

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
