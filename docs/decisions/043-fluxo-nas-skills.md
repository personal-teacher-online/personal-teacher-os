# ADR-043 — O fluxo de trabalho sai do CLAUDE.md e passa a morar nas skills

**Data:** 16/11/2026 · **Status:** aceita (decisão do dono, 16/11/2026); o item 6 (merge autorizado pelo dono em chat) foi substituído pelo ADR-046 (17/11/2026), e com ele os trechos das Consequências que contam com o OK do dono antes do merge ou dizem que a sessão não aprova o próprio merge

## Contexto

Desde 14/10/2026 o repositório descrevia um rito próprio: orquestradora, uma
trabalhadora por issue, `/code-review` e revisor adversarial em toda PR, gate
Sol nas de risco e nas de caminho protegido (ADR-041), auto-merge com travas.
O rito estava em quatro skills, três agentes, um bloco longo do `CLAUDE.md` e
`docs/fluxo-paralelo.md`, com modelo por papel, número de rodadas e remendos
acumulados por incidente.

Em 15/11/2026 o dono revisou o mesmo rito no projeto lotufo, contra o guia de
uso do modelo novo e relatos de outros times, e decidiu três coisas, que em
16/11 mandou repetir aqui: (1) regra de modelo, de papéis, de número de agentes
e de passo a passo não fica no `CLAUDE.md` nem na memória, porque o modelo a
segue à risca e ela envelhece; (2) o jeito de trabalhar mora em skills; (3) o
que é proibido de verdade vira trava (permissão, hook, CI), não frase.

## Decisão

1. Saem do repositório as skills `orquestrar`, `abrir-pr`, `gate-sol` e
   `nova-tarefa`, os agentes `trabalhadora`, `revisor-adversarial` e
   `listar-issues`, `docs/fluxo-paralelo.md` e os dois comparativos com o
   lotufo. O histórico do git guarda tudo.
2. O fluxo passa a ser o do plugin `mattpocock-skills` (entrevista,
   especificação, tickets, implementação, revisão), configurado em
   `docs/agents/`: issues no GitHub, labels de triagem ligados aos da casa
   (`triagem`, `decisao`, `pronta`, `sessao-manual`, `wontfix`) e ADRs em
   `docs/decisions/`.
3. O `CLAUDE.md` guarda o que é o produto, as Leis, o que o código não conta
   e onde fica cada coisa. Modelo dos agentes auxiliares é configuração
   (`.claude/settings.json`), não texto.
4. O `CLAUDE.md` passa a declarar a sessão dona e mantenedora de longo prazo
   do código. Com isso sai da Disciplina a frase "o que sair do recorte volta
   para aprovação": o guia do modelo mede que as duas juntas não funcionam.
5. O **gate reforçado** do ADR-041 (gate Sol rodado pela skill e revisor sem
   achado de "regra afrouxada") é substituído por uma regra escrita em
   `.claude/rules/mudanca-de-risco.md`: mudança de risco, em caminho
   protegido ou no que decide o veredito da CI passa por uma revisão do Codex
   antes do merge, registrada na seção "Conferência" da PR. A regra guarda o
   que o gate tinha de substância: o foco da casa no pedido (as Leis e "regra
   afrouxada"), a proibição de declarar algo como autorizado, a prova de que
   rodou (motor, sessão e head) e, em caminho protegido, nenhum substituto
   quando o Codex está sem cota.
6. Todo merge na `main` é autorizado pelo dono em chat, por PR e por commit
   (a regra de 09/11/2026 para a sessão manual passa a valer para tudo; não
   existe mais merge ligado por rodada sem o dono). O que conta como OK, o
   que o anula e como ligar foram da skill `abrir-pr` para
   `docs/agents/issue-tracker.md`, "Como o trabalho fecha". A regra (b) do adendo do
   ADR-041, que devolvia ao clique no GitHub a PR com achado de "regra
   afrouxada", sai junto com o revisor que produzia o achado.
7. As regras de teste da `trabalhadora` (teste que falha sem a mudança,
   regra do banco testada no banco, data nunca cravada em teste que toca o
   banco ou o relógio real, limpeza só do próprio) foram para `.claude/rules/testes.md`. Os plugins
   `mattpocock-skills` e `codex` passam a ser ligados pelo
   `.claude/settings.json` do projeto, para o fluxo existir em qualquer
   máquina que tenha os dois instalados.
8. Ficam como estão: CI obrigatória, fila de merge, o check "scanner
   protegido" com o label `dono-liberou`, as permissões negadas do
   `settings.json`, uma PR com migration aberta por vez, bancada única,
   deploy manual e o gate do dono antes do deploy (ADR-040).

## Consequências

- Regra afrouxada por engano deixa de ser procurada por duas máquinas em toda
  PR de caminho protegido. O que segura passa a ser: a revisão do Codex
  (regra escrita, depende de a sessão obedecer), a linha "Mudou regra ou
  estrutura" no corpo da PR e o OK do dono. O ADR-041 já registrava que o
  clique do dono não é trava; o risco é aceito por ele nesta decisão.
- O `.claude/settings.json` libera sem pergunta `Bash(gh pr *)` (desde o
  corte), que cobre `gh pr merge` com ou sem `--match-head-commit`,
  `gh pr comment` e `gh pr review`; em 30/10/2026 entraram também
  `gh pr merge * --auto --squash`, `git branch -D *` e `git -C *`, porque
  caminho protegido passava pelo gate reforçado das skills. Tudo isso
  continua no `allow` sem esse gate: as regras do OK de merge (SHA por
  extenso, push anula o OK) e "comentário em PR é do dono" são texto, e o
  ruleset da `main` exige CI e fila, não revisão. O que as compensa agora
  é a regra escrita e o OK do dono. Trocar por trava (`gh pr merge *` no
  `ask`, `gh pr comment *` e `gh pr review *` no `deny`) é decisão do dono,
  fora desta mudança.
- Ligar o plugin `codex` pelo projeto traz, em toda máquina que o tenha
  instalado, o que ele carrega: os hooks dele (`SessionStart`, `SessionEnd`
  e `Stop`, este com tempo limite longo) e o agente `codex:codex-rescue`,
  que escreve na árvore. Nesta máquina já era assim pela configuração da
  conta.
- A frase de dono traz menos código repetido e também mudança não pedida
  (testes, documentação e, às vezes, comportamento). Num sistema de ledger e
  dinheiro isso pesa: a conferência da PR lista o que mudou além do pedido, e
  o que o pedido não cobre em dinheiro, ledger, RLS, fuso, migration ou
  caminho protegido para e volta ao dono antes de ser escrito. No
  `CLAUDE.md`, "dono" continua sendo a pessoa: a frase não dá à sessão o
  direito de aprovar o próprio plano nem o próprio merge.
- O ADR-040 continua valendo para o deploy. Onde ele e o ADR-041 citam as
  skills `gate-sol` e `abrir-pr`, o revisor adversarial,
  `docs/fluxo-paralelo.md` ou a seção "Como o trabalho anda", lê-se
  `.claude/rules/mudanca-de-risco.md` e `docs/agents/issue-tracker.md`.
- As issues abertas antes desta data seguem válidas; nenhuma recebeu `pronta`
  em lote. Quem as avalia é a `/triage`.
- O `ci.yml` guarda um comentário que cita a orquestradora; é histórico e não
  muda o que a CI faz.
- Pendência: transformar em trava mecânica a revisão do Codex (o merge só
  liga com a prova da revisão) e a autorização por commit (hoje o
  `--match-head-commit` só confere o SHA na chamada, e a defesa contra push
  posterior é desarmar antes do push), como o padrão "regra crítica vira
  mecanismo" pede. Não entra nesta mudança.
