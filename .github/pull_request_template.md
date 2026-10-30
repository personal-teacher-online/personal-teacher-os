## O que mudou

<!-- 3 a 6 linhas em português, sem jargão: o que a dona, a professora, o aluno ou o dono passa a ver ou conseguir fazer. Nada de nome de função, arquivo ou tabela. -->

## Por quê

<!-- Link da issue. -->
Closes #

## Como testar no navegador

<!-- Passos numerados que o dono segue na bancada visual (rito em CLAUDE.md › Armadilhas da bancada: build standalone em http://127.0.0.1:3000; `next dev` não serve), com a URL da tela, o que clicar e o que deve aparecer. Um passo por critério de aceite. Quando não há tela: o comando ou a RPC e o resultado esperado. -->
1.

## Suposições

<!-- O que foi decidido sem perguntar, e por quê. "Nenhuma" se não houve. O que foi visto fora do recorte entra aqui como "fora do recorte", não no diff. -->

## Migration

<!-- Não. / Sim: supabase/migrations/AAAAMMDDHHMMSS_nome.sql; só acrescenta (coluna, tabela, índice, função) ou mexe em dados (explicar o quê). Migration é caminho protegido: gate reforçado (gate Sol obrigatório; ADR-041), e só uma PR com migration aberta por vez. -->

## Gates

- [ ] CI (tsc + lint + suíte):
- [ ] Testes focados do que tocou:
- [ ] /code-review:
- [ ] revisor-adversarial:
- [ ] Gate Sol (com risco:* ou caminho protegido):
