# Personal Teacher OS

Fonte de verdade operacional da **Personal Teacher Academy** (escola de inglês
1:1, marca "Teacher Vicky"): agenda, alunos, contratos, créditos, financeiro,
mentoria e comunicação. Next.js (App Router) + Supabase self-hosted; regras de
negócio vivem no Postgres.

## Comece por aqui

- `CLAUDE.md` — leis do projeto, stack, disciplina de trabalho, **estado atual** e comandos.
- `docs/ops/runbook-vps.md` — produção: VPS, deploys, religamento de integrações.
- `docs/goals/` — goal de cada fase/onda · `docs/decisions/` — ADRs · `docs/PLANO-INTEGRADO.md` — gates de go-live.
- `AGENTS.md` — regras da casa para agentes · `Design.md` — design system.

## Bancada local

Pré-requisitos: Node 22+, Docker Desktop e um `.env.local` (chaves listadas em
`.env.example`; valores no Bitwarden — segredos nunca entram no repo).

```bash
npm ci && npx playwright install chromium
npx supabase start
npx supabase db reset      # espere ~60 s antes de testar
npm run prompts:publish    # o reset apaga os prompts publicados
npm test                   # uma rodada por reset
npm run dev
```

Produção: https://app.personal-teacher.com

## Direitos

Todos os direitos reservados, Personal Teacher Academy. Este repositório não tem licença: ler não dá
direito de copiar, modificar ou redistribuir.

## Repositório público: regras de dado

Cada push sai na hora e fica visível para qualquer pessoa. Por isso dado real (nome, e-mail pessoal,
telefone, CPF/CNPJ, IP e usuário da VPS, segredo técnico) não entra: dado de teste é sempre sintético, e
o dado real mora no repositório privado. As regras estão em `.claude/rules/dados-de-teste.md`; o scanner
`scripts/vazamento.py` confere no commit, no push e no CI (job `vazamento`).
