# AJUSTES — lista de correções para executar em lote

> Como usar: durante o e2e, cada coisa errada vira um item aqui (copie o modelo
> abaixo). Prints vão na pasta `qa/prints/` (crie os arquivos lá e referencie
> pelo nome, ex.: `![print](qa/prints/01-calendario.png)`).
> Quando fechar a rodada, me peça: **"execute o AJUSTES.md"** — eu faço tudo de
> uma vez numa branch, abro o PR (o CI roda tsc, lint e a suíte; o
> `/code-review` passa por cima) e te devolvo o checklist de validação para o
> merge. (Até 10/10/2026 a nota dizia "suíte 2×": rodadas seguidas no mesmo
> reset dão falha falsa — ver Comandos no CLAUDE.md.)
>
> Itens fechados migram para `docs/qa/ajustes-arquivo-AAAA-MM-DD.md` (último
> arquivamento: 05/08/2026 — itens 1 a 4).

Legenda de status: `[ ]` pendente · `[x]` corrigido · `[~]` em discussão

---

## Modelo (copie daqui)

```
## N. Título curto do problema
- **Status:** [ ]
- **Onde:** URL ou tela (ex.: /portal/remarcar, aba lateral do admin)
- **Dispositivo:** celular / desktop
- **O que acontece:** descreva o comportamento errado
- **O que deveria acontecer:** descreva o esperado
- **Print:** ![print](qa/prints/NN-nome.png)
```

---

## Pendência herdada do arquivamento

- [ ] **Conferência visual do item 1 (calendário mobile):** abrir `/admin/agenda`
  no celular ou com a janela abaixo de 640px e confirmar a navegação de mês
  (a correção de 16/07 nunca teve o check visual do dono).

---

_(adicione os próximos itens abaixo)_
