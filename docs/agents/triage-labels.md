# Labels de triagem

As skills falam em cinco papéis de triagem. Esta tabela diz qual label deste repositório corresponde a cada um.

| Papel nas skills | Label aqui | Significado |
| --- | --- | --- |
| `needs-triage` | `triagem` | Ainda não avaliada |
| `needs-info` | `decisao` | Espera uma decisão ou conferência do dono |
| `ready-for-agent` | `pronta` | Especificada e aprovada pelo dono; um agente pode implementar sozinho |
| `ready-for-human` | `sessao-manual` | Precisa do dono na sessão (produção, VPS, contas externas) |
| `wontfix` | `wontfix` | Não será feita |

Quando uma skill citar um papel ("aplique o label de pronta para agente"), usar o label da coluna do meio.

Fora da triagem:

- `precisa-do-leo` marca PR ou falha que espera o dono olhar. Como `decisao`, bloqueia: issue com um dos dois
  não leva `pronta` e não é pega por agente.
- `risco:*` nomeia a Lei em jogo e é posto na criação da issue (ver `docs/agents/issue-tracker.md`).
- `divida`, `bug` e `ui` classificam o assunto.
- `parar` pausava o fluxo antigo e ficou sem função (ADR-043); não usar.

A triagem lê e comenta issues. PR não entra na triagem (`docs/agents/issue-tracker.md`, "PR como pedido: não").
