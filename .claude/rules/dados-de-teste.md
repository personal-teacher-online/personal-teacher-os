---
paths:
  - "tests/**"
  - "supabase/seed.sql"
  - "docs/**"
  - "prompts/**"
---

# Dado de teste e repositório público

- **O repositório é público e cada push sai na hora.** O que entra aqui já é conhecido de quem quiser ler;
  não existe "apago depois". Conferir o diff antes de commitar. O scanner `scripts/vazamento.py` roda no
  commit, no push e no CI (job `vazamento`) e barra o que reconhece; ele não substitui o seu olho.
- **Dado de teste é sintético.** Nunca colar nome de pessoa, e-mail, telefone ou documento reais em teste,
  seed, fixture, prompt, doc, issue, PR ou comentário. Use:
  - pessoa pelo papel ("a aluna", "a professora", "a dona") ou nome inventado de pessoa que não existe;
  - e-mail em `@exemplo.com` (também aceitos: `@x.com`, `@local.dev`, `@bancada.dev` e
    `contato@personal-teacher.com`);
  - telefone nas faixas fictícias `+55 65 9000X-XXXX` ou `+55 65 99999-XXXX` (Brasil), `+1 NNN 555-01XX`
    (EUA) e `+351 900 XXX XXX` (Portugal);
  - CPF e CNPJ de gerador público de teste, nunca de pessoa ou empresa real; em docs, placeholder inválido
    (`000.000.000-00`).
- **Infraestrutura também não entra**: IP, usuário SSH e nome de container da VPS ficam em `<servidor>`,
  `<usuario>` etc. nos textos e em variável de ambiente nos scripts.
- **Dado real mora no repositório privado** `personal-teacher-os-privado` (e no Bitwarden, para segredo).
  O público nunca recebe uma cópia "só para conferir".
- Achou dado real já escrito fora do seu recorte? **Não mexa**: registre em `## Suposições` da PR e deixe
  para a issue que cuida da anonimização, que usa o mapa único.
- O scanner barrou dado que é fictício de propósito? Troque por uma forma aceita acima. Só em último caso
  vale entrada em `scripts/vazamento-excecoes.txt`, e essa mudança exige merge do dono.
