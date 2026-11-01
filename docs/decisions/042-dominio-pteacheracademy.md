# ADR-042 — Domínio do app e dos e-mails passa a `pteacheracademy.com`

**Data:** 01/11/2026 · **Status:** aceita (decisão do dono, 01/11/2026)

## Contexto

A marca é "Personal Teacher Academy" (rebrand de 2026), mas o domínio seguia
`personal-teacher.com`: portal em `app.`, API do Supabase em `api.`, e-mails de
`contato@`. O rito da Meta (ADR-038, passo AN.5) exige uma URL pública e
estável de política de privacidade, e a raiz `personal-teacher.com` nem
resolve. Antes de criar essa página, o dono quis decidir o domínio
definitivo. Hoje é a hora mais barata para trocar: produção sem aluna real,
21 templates da Meta ainda em análise, nada publicado.

Nomes conferidos nos registros em 01/11/2026: `personalteacheracademy`
(.com e .com.br livres), `pteacheracademy` (.com, .com.br, .co livres),
`ptacademy` (.com, .app, .online ocupados; "PT" lê-se personal trainer fora
do Brasil), `personalteacher` (.com.br de uma academia de ginástica desde
2006; `.academy`, `.app`, `.school` livres), `teachervicky` (.com de
terceiro; `.com.br` já é do dono desde 06/07/2026).

## Decisão

1. Domínio oficial: **`pteacheracademy.com`** (com `.com.br` de defesa,
   redirecionando). Portal em `app.pteacheracademy.com`; e-mails do
   `contato@` do domínio novo; Meta (webhook, domínio do app, política de
   privacidade) nele.
2. **`personal-teacher.com` fica registrado para sempre como redirecionamento
   permanente (301, caminho e query preservados).** É isso que dispensa a
   reaprovação dos templates de WhatsApp: os botões ficam com a base
   `https://app.personal-teacher.com/{{1}}` e seguem funcionando. Só
   migram quando houver outro motivo de reedição.
3. **A API do Supabase (`api.personal-teacher.com`) não muda nesta etapa.**
   A aluna nunca vê esse endereço (os links dos e-mails passam pelo app) e
   trocá-lo mexe no stack inteiro (Kong, Studio, GoTrue, build-arg do app).
   Fica como dívida documentada aqui; reavaliar quando o domínio antigo
   tiver outro custo além do registro.
4. `teachervicky.com.br` (já do dono) fica para o site de vendas da marca
   pessoal quando ele existir; não entra no app.

## Consequências

- Infra numa sessão manual com o dono (Cloudflare, Coolify, GoTrue, Resend
  com SPF/DKIM, Google OAuth, Meta) e uma PR de código (links montados pelo
  app, remetente padrão, docs e testes), com deploy na mesma janela.
- O scanner de dado real só conhece o `contato@` antigo: o novo endereço entra
  em `scripts/vazamento-excecoes.txt` (caminho protegido, label `dono-liberou`).
- O código ganha um teste que **prende a base antiga nos botões dos
  templates**, para ninguém "corrigir" sem querer e disparar reaprovação.
- Dois domínios para pagar e vigiar (o antigo nunca pode expirar: os links
  enviados dependem dele). Lembrete de renovação no runbook.
- A política de privacidade (AN.5) nasce já no domínio novo.
