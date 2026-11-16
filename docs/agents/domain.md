# Documentos de domínio

Como as skills de engenharia leem a documentação de domínio deste repositório ao explorar o código.

## Antes de explorar, ler

- **`CLAUDE.md`**: as Leis do projeto, que valem como decisões já tomadas, e as armadilhas medidas da bancada.
- **`AGENTS.md`**: as invariantes em resumo e a régua de legibilidade das telas.
- **`docs/decisions/`**: os ADRs que tocam a área em que se vai trabalhar. Neste repositório os ADRs moram
  aqui, não em `docs/adr/`; ADR novo segue a numeração (`NNN-titulo.md`: contexto, decisão, consequência).
- **`GLOSSARY.md`** na raiz, quando existir.
- **`Design.md`**, quando o trabalho é de tela.

Os blueprints (`docs/research/`), os goals de cada onda (`docs/goals/`) e o runbook (`docs/ops/`) estão no
repositório privado, clonado ao lado da **pasta principal** do repositório (`personal-teacher-os-privado`).
Numa worktree, `../` não chega lá: achar a pasta principal com
`git rev-parse --path-format=absolute --git-common-dir` (o pai do `.git` devolvido).

Se `GLOSSARY.md` ainda não existir, seguir em silêncio. A skill `/domain-modeling` (chamada pela
`/grill-with-docs` e pela `/improve-codebase-architecture`) cria o glossário e os ADRs quando um termo ou uma
decisão é de fato resolvido.

## Estrutura

Contexto único:

```
/
├── CLAUDE.md, AGENTS.md, Design.md
├── GLOSSARY.md            (quando existir)
├── docs/decisions/        (ADRs)
├── supabase/migrations/   (as regras de negócio vivem no Postgres)
└── src/, worker/, tests/
```

## Usar o vocabulário do glossário

Quando a saída nomear um conceito do domínio (título de issue, proposta de refatoração, hipótese, nome de teste),
usar o termo como está no `GLOSSARY.md` e, enquanto ele não existir, como está no `CLAUDE.md`. Se o conceito não
está em nenhum dos dois, ou a linguagem é inventada (repensar), ou há uma lacuna real (anotar para a
`/domain-modeling`).

## Apontar conflito com decisão registrada

Se a saída contradiz um ADR ou uma Lei do `CLAUDE.md`, dizer isso às claras, em vez de passar por cima em
silêncio. Tarefa que pareça exigir violar uma Lei para e pergunta ao dono.
