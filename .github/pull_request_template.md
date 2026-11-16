## O que mudou

<!-- 3 a 6 linhas em português, sem jargão: o que a dona, a professora, o aluno ou o dono passa a ver ou conseguir fazer. Nada de nome de função, arquivo ou tabela. -->

## Por quê

<!-- Link da issue. -->
Closes #

## Como testar no navegador

<!-- Passos numerados que o dono segue na bancada visual (rito em CLAUDE.md › Armadilhas da bancada: build standalone em http://127.0.0.1:3000; `next dev` não serve), com a URL da tela, o que clicar e o que deve aparecer. Um passo por critério de aceite. Quando não há tela: o comando ou a RPC e o resultado esperado. -->
1.

## Suposições

<!-- O que foi decidido sem perguntar, e por quê. "Nenhuma" se não houve. O que mudou além do pedido (teste, documentação, consolidação de código repetido) entra aqui, uma linha por item. -->

## Migration

<!-- Não. / Sim: supabase/migrations/AAAAMMDDHHMMSS_nome.sql; só acrescenta (coluna, tabela, índice, função) ou mexe em dados (explicar o quê). Migration é caminho protegido: revisão do Codex antes do merge (.claude/rules/mudanca-de-risco.md), e só uma PR com migration aberta por vez. -->

## Conferência

- [ ] CI (tsc + lint + suíte):
- [ ] Testes focados do que tocou:
- [ ] Revisão do código:
- [ ] Revisão do Codex (com risco:* ou caminho protegido):
- [ ] Mudou regra ou estrutura (uma linha em linguagem de negócio, ou "não"):
- [ ] O que não foi conferido:
