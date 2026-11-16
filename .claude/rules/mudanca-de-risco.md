# Mudança de risco e caminho protegido

Esta regra carrega em toda sessão, de propósito: risco de dinheiro, ledger, fuso, RLS e envio não se enumera
por pasta.

**Quando vale.** Antes do merge de qualquer mudança que: (a) mexa em dinheiro, ledger, fuso, RLS, migration ou
envio, tenha ou não o label `risco:*`, em qualquer pasta; (b) toque caminho protegido (lista no `CLAUDE.md`,
que inclui `docs/ops/runbook-vps.md` no repositório privado); ou (c) toque o que decide o veredito da CI:
scripts de teste e de lint no `package.json`, `package-lock.json`, `vitest*.config.ts`, `eslint.config.mjs`,
`tools/eslint/**` e `tsconfig*.json` (a lista é esta; outro arquivo que passe a decidir a CI entra nela).

**O que se faz.** O diff inteiro da branch (`origin/main...HEAD`) passa por uma revisão do Codex: outro
fornecedor, pontos cegos diferentes de quem escreveu.

- **Como rodar.** Quando é a sessão a pedir: `git fetch origin`, árvore limpa, e o `codex` CLI lendo do stdin
  um arquivo com o pedido seguido do `git diff origin/main...HEAD`
  (`codex exec -s read-only -o <saída> - < <entrada>`, em segundo plano se o diff for grande): com o
  `-s read-only` o Codex só lê. `<entrada>` e `<saída>` ficam fora da worktree (pasta temporária da sessão). Conferir a árvore limpa de novo depois (`git status --short` vazio): se algo
  mudou durante a revisão, ela não vale. Quando é o dono a pedir pelo plugin
  (`/codex:adversarial-review --base origin/main --wait <foco>`), a sessão entrega a ele o texto do foco
  abaixo para colar no comando; o pedido, a prova e o resto desta regra valem igual. O agente
  `codex:codex-rescue` não serve de revisor: escreve na árvore por padrão e devolve vazio quando falha.
- **O pedido** diz o objetivo da mudança em uma frase e **nunca declara algo como autorizado** ("o dono pediu,
  não reporte"): quem filtra não pode ser a sessão que quer o merge. Leva o foco da casa: as Leis do
  `CLAUDE.md` uma a uma (fuso e DST; ledger e saldo; regra de negócio fora do banco; RLS e permissão; migration
  editada, destrutiva ou fora de ordem; webhook não idempotente e envio em dobro; mutação sem `audit_log`;
  dinheiro fora de centavos), texto em inglês ou erro cru na tela e, em caminho protegido ou no que decide o
  veredito da CI, **regra afrouxada**: permissão de agente ampliada (`allow` novo, `ask` ou `deny` removido),
  lei, trava ou regra removida ou amolecida, CI enfraquecida (job ou passo removido, `continue-on-error`, teste
  pulado, `if` que desvia), mudança em como o `ci.yml` chama o scanner, hook desligado, scanner com regra a
  menos ou exceção nova, script de teste ou de lint que roda menos, `TZ=UTC` tirado da CI ou do container,
  usuário não-root ou cabeçalho de segurança removido. Achado de regra afrouxada é sempre Crítico. Pedir que
  reporte tudo, por gravidade, com `arquivo:linha`, cenário e correção.
- **Depois da resposta.** Conferir cada achado contra o código. Crítico ou Aviso: corrigido (com teste, quando
  há código) ou refutado com o `arquivo:linha` que prova; o que existe mas está fora do pedido vira issue
  `divida`, citada na PR. Não se liga merge com achado em aberto. Correção feita: o Codex relê o diff novo.
- **A prova, na seção "Conferência" da PR:** o motor que rodou, o arquivo da sessão (`~/.codex/sessions/...`;
  pelo plugin, que não grava esse arquivo, o ID e o log do job),
  o head revisado (`git rev-parse HEAD`) e a contagem (N achados, M corrigidos, K refutados). Linha sem isso
  vale como "não rodou". Diff vazio ou saída vazia não é veredito. Push depois da revisão: a linha deixa de
  valer até o Codex ler o diff novo.
- **Codex sem cota ou indisponível.** Em caminho protegido e no que decide o veredito da CI, a PR espera o
  Codex: não há substituto, nem a pedido em chat. Com risco fora desses caminhos, a revisão pode ser de um
  agente novo, sem o contexto da sessão que escreveu, e a linha diz isso ("Codex sem cota em DD/MM; revisão por
  agente novo"), nunca "Revisão do Codex". "Não rodou" nunca se registra como "sem achados".

**Mudou regra ou estrutura.** Mudança em regra, permissão, hook ou passo da CI entra no corpo da PR numa linha
em linguagem de negócio, que é o que o dono lê antes de autorizar o merge.

**Só com o dono.** Scanner (`scripts/vazamento*`), `.githooks/`, `.claude/rules/dados-de-teste.md` e a
configuração do gitleaks só mudam com o label `dono-liberou`, posto pelo dono na interface do GitHub; a sessão
nunca põe o label. O check "scanner protegido" barra a PR sem ele, mas só olha esses arquivos: a PR que muda
como o `ci.yml` chama o scanner passa por ele, e quem a segura é a revisão do Codex acima.

**Migration.** Aplicada em ambiente compartilhado não se edita (Lei 7): mudança é migration nova, com timestamp
posterior ao último. Função nova revoga `EXECUTE` nominalmente (`tests/acl-higiene.test.ts`).
