# ADR-021 — Fábrica de conteúdo com agentes (pipeline n8n + dois portões)

**Data:** 20/07/2026 · **Status:** aceito

## Contexto

O marketing da Personal Teacher precisa de cadência diária de conteúdo social
(carrosséis, stories, roteiros de reel) sem consumir as horas da dona.
Pesquisa profunda (20/07/2026) validou o padrão de mercado: agentes geram
ideias e rascunhos, humano aprova em dois portões (padrão do template n8n
#8700), voz da marca extraída uma vez e cacheada (template n8n #2648).
O pipeline roda no n8n da VPS Hostinger (a mesma do projeto agendamento-aulas)
— fora deste app — e escreve aqui, onde a dona já trabalha todo dia.

## Decisões

1. **Superfície de escrita do pipeline: rotas `/api/content/*` com token
   próprio (`CONTENT_API_TOKEN`)** — padrão dispatch-outbox/webhooks
   (fail-closed, `safeTokenEqual`, header nunca query). **Rejeitado:** entregar
   a service_role key ao n8n (abriria pagamentos/contratos/LGPD numa VPS de
   terceiros — mesmo espírito da proibição do MCP oficial com service_role) e
   role Postgres dedicada (o Postgres de produção não expõe porta — runbook §G).
   `/api/content` entra no PUBLIC_PATHS como PREFIXO (precedente: /api/webhooks).
2. **Imagens no Google Drive** (Lei 10 mantida — sem Supabase Storage, que nem
   está implantado no stack de produção): a rota `/entrega` recebe base64/URL do
   provedor e o APP persiste via service account (a mesma dos Slides), em duas
   pastas: `CONTENT_DRIVE_FOLDER_ID` (posts) e `CONTENT_DRIVE_REFS_FOLDER_ID`
   (fotos de referência da dona — privadas). Painel serve via proxy admin.
3. **Máquina de estados no banco** (Lei 3): `ideia → ideia_aprovada → gerando →
   rascunho → aprovado → publicado`, com `rejeitado` não-terminal (motivo vira
   feedback aos agentes; "tentar de novo" recarimba o portão 1) e `descartado`
   terminal. Nasce sempre `ideia`; DELETE proibido (Lei 8); pós-aprovado
   congelado por whitelist (molde progress_reports_guard).
4. **Notificação por digest**: trigger `notify_content_review` → outbox,
   no máximo 1 toque por etapa (ideias/rascunhos) por admin por dia civil
   (dedupe com `business_today()`); canal pela régua M4-3 (tem número → WhatsApp).
   Entrega imediata opcional: o n8n pode chamar `dispatch-outbox` ao final.
5. **Voz da marca em `brand_voice_docs`** (espelho do padrão ai_prompts:
   append-only, 1 ativa, publicação só via RPC admin `publish_brand_voice`).
6. **Prompts do pipeline vivem no n8n** (hardcoded nos nós) com cópia canônica
   no repo `personal-teacher-conteudo` — desvio deliberado do "prompts em
   tabela": a tabela `ai_prompts` serve as rotinas Claude DESTE app; o ciclo de
   iteração dos prompts de social é do dono, no editor do n8n. Migração para
   `ai_prompts` fica como opção futura.
7. **Lei 11 reafirmada**: os prompts de imagem do pipeline proíbem texto/
   lettering; o texto dos slides vive em `slides[].texto` e é composto por cima
   (preview do painel hoje; composição Satori na fase "carrossel com um clique").
8. **v1 NÃO publica** nas redes: a dona aprova e posta manualmente (copiar
   legenda + baixar imagens no painel). Instagram Graph API é fase futura.

## Consequências

- Envs novas no app: `CONTENT_API_TOKEN`, `CONTENT_DRIVE_FOLDER_ID`,
  `CONTENT_DRIVE_REFS_FOLDER_ID` (Drive usa a `GOOGLE_SERVICE_ACCOUNT_JSON` já
  prevista no §N). Sem env, as rotas respondem 401/erro honesto — nada quebra.
- Imagens geradas ficam no Drive do Workspace (backup/retenção herdados);
  posts órfãos de imagem só se o n8n abandonar um `gerando` (visível no painel,
  destravável).
- O n8n vira dependência de disponibilidade da ESTEIRA, nunca do app: sem n8n,
  o painel segue funcionando (inclusive criação manual de ideias).
- Migration: `20260720000400_fabrica_conteudo.sql`. Testes: `conteudo-*.test.ts`.
