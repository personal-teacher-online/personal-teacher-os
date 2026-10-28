# ADR-017 — Google Agenda da professora: OAuth pessoal, duas vias assimétricas

**Data:** 14/07/2026 · **Status:** aceito (decisão do mantenedor na sessão de QA)

## Contexto

O blueprint (docs/research/02) previa apenas `class_instances.google_event_id` +
`gmeet_url`, sem definir o mecanismo. O mantenedor pediu: qualquer professora
(atuais e futuras) conecta a própria conta Google; a plataforma mostra os
afazeres dela como "ocupado" para dar segurança na gestão de janelas; aulas e
janelas publicadas aparecem no Google Agenda dela. Runbook §N.5 deixava em
aberto service account × OAuth.

## Decisão

1. **OAuth por professora** (não service account): o fluxo precisa LER a agenda
   pessoal dela, o que SA não alcança sem Workspace/domain-wide delegation.
   Escopo único sensível `calendar.events` (conferido na doc oficial em
   14/07/2026: cobre events.list/insert/patch/delete na agenda principal; a
   leitura de afazeres usa `events.list`, dispensando `calendar.readonly` e
   `freebusy.query`) + `openid email` para exibir a conta conectada.
2. **Duas vias ASSIMÉTRICAS — "o app manda, o Google informa"**:
   - app → Google: aulas agendadas e janelas publicadas viram eventos na agenda
     principal dela (janela com `transparency: transparent` — não ocupa);
   - Google → app: afazeres entram só como blocos ocupado (horários; título
     nunca sai da conta dela). Checagem ao publicar janela + camada nas grades.
   - Editar/apagar NO Google **não** move aula/janela: o sync recoloca. As
     regras (franquia, crédito, aviso mínimo, conflito) seguem no banco (Lei 3).
3. **Sync stateless auto-corretivo**: identidade do evento em
   `extendedProperties.private.ptos_key` (`aula:<id>` / `janela:<id>`); cada
   sync faz diff completo do horizonte de 56 dias e converge (insert/patch/
   delete, dedupe de chave repetida). `class_instances.google_event_id` fica
   **dormente**: estado espelhado no banco dessincroniza; a marca no próprio
   evento, não.
4. **Credencial**: `teacher_google_accounts` (migration 20260715001100) guarda o
   refresh token **cifrado** (AES-256-GCM, chave só em env `GOOGLE_TOKEN_KEY`);
   RLS: professora/admin leem status por grant de coluna (o cipher fica fora);
   escrita só service_role. Conectar/trocar audita (Lei 8); `last_sync_*` fora
   do gatilho para não inundar o audit_log.
5. **Falha do Google não trava o negócio**: checagem de conflito indisponível →
   a ação segue com aviso explícito ("não consegui checar o Google"); sync que
   falha fica em `last_sync_error` e o próximo corrige.

## Consequências

- App OAuth no Google Cloud deve ficar **"In production"** (em "Testing" o
  refresh token expira em 7 dias — doc oficial); sem verificação formal há tela
  "app não verificado" (1 clique extra ao conectar) e teto de 100 usuários —
  aceitável para ≤5 professoras; verificação do Google fica opcional/futura.
- Novas envs: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
  `GOOGLE_OAUTH_REDIRECT_URL` (local/preview), `GOOGLE_TOKEN_KEY` (32 bytes
  base64). Runbook §N ganha o passo M0.
- O evento da aula na agenda dela conta no ocupado/livre do Google dela — e a
  plataforma ignora os PRÓPRIOS eventos ao montar os blocos de afazer (senão
  toda aula viraria "conflito do Google" consigo mesma).
- Quem não conectar continua funcionando como hoje (integração é opcional por
  professora).
