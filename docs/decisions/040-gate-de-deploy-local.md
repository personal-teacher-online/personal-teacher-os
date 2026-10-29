# ADR-040 — Gate de deploy local no lugar do `/code-review ultra`

**Data:** 29/10/2026 · **Status:** aceita (decisão do dono, 29/10/2026)

## Contexto

Desde 14/10/2026 o CLAUDE.md exigia o `/code-review ultra` (revisão
multiagente na nuvem, disparada e paga pelo dono) antes de todo deploy que
leva migration ou toca dinheiro, ledger, RLS ou fuso. O dono só o usou
enquanto havia crédito grátis e não usa mais nada cobrado na nuvem. Em 29/10,
o deploy da migration 118 (M2, professora cancela e remarca) parou nesse gate.

A razão é custo. Um detalhe do dia: o ultra só aceita branch ou commit como
alvo, e o repositório público nasceu de um corte (commit inicial `309e58f`)
que já continha a 118, sem o ancestral de produção para formar o diff. O
branch de gate do item 2 resolveria isso também para o ultra; não foi o
impedimento.

## Decisão

1. O gate do dono antes de deploy com migration, dinheiro, ledger, RLS ou
   fuso passa a ser o `/code-review xhigh` **local** (o nível é argumento do
   comando), rodado na sessão de deploy sobre o diff exato que vai subir. O
   dono lê o veredito. Sem veredito, sem deploy (a frase não muda). A PR
   comum segue com o `/code-review` de sempre.
2. O diff é `produção → main`. Quando o SHA de produção não está no
   histórico do repositório (caso de 29/10), a sessão monta um **branch de
   gate** com dois commits, base sem a migration e topo com ela, e revisa o
   topo contra a base: a revisão vê exatamente a migration como diff.
3. O `/code-review ultra` sai do fluxo, e sessões na nuvem também, pela mesma
   razão. Não se propõe de novo sem fato novo (custo coberto pela assinatura,
   por exemplo).
4. O gate Sol (codex, outra família de modelo) segue como está: na PR, para
   `risco:*`, migration, ledger, RLS, materialização e outbox.

## Consequências

- O gate perde a diversidade de agentes do ultra; compensa com o Sol na PR
  (outro fornecedor) e com o effort alto na revisão local.
- Custo zero além da assinatura. Não há mais rodada a contar.
- Textos alterados: CLAUDE.md ("Como o trabalho anda" · Gate do dono), skill
  `gate-sol`, `docs/fluxo-paralelo.md` §§ ferramentas e modelos.
- Primeiro uso previsto: migration 118 (M2), cujo deploy estava parado neste
  gate. O runbook registra a seção do deploy quando ele acontecer.
