# ADR-014 — Login por senha; link por e-mail só para convite e redefinição

**Data:** 12/07/2026 · **Decisor:** O mantenedor (após o deploy da Fase 2)

**Contexto.** A D6/M0 implementou magic link como login corrente (sem senha). No dia
do lançamento, o mantenedor decidiu trocar: o link por e-mail fica restrito ao PRIMEIRO
acesso (ativação do convite) e à redefinição de senha; o login do dia a dia passa a
ser e-mail + senha — para alunos e admins.

**Decisão.**
1. `/login` = e-mail + senha (`signInWithPassword`); mensagem NEUTRA para credencial
   errada (não revela se o e-mail existe — caso 2 do goal preservado).
2. `/recuperar-senha` (pública) dispara `resetPasswordForEmail`; resposta neutra.
3. `/definir-senha` (autenticada, QUALQUER papel — exceção nova no gate): destino
   único de convite E recovery; `updateUser({password})` e segue ao home do papel.
4. `/auth/confirm` aceita SOMENTE `invite` e `recovery` (magiclink removido — o app
   rejeita link de login mesmo que alguém force o endpoint de OTP do GoTrue).
5. Senha mínima 8: `minimum_password_length` local, `GOTRUE_PASSWORD_MIN_LENGTH` em
   produção, `MIN_PASSWORD_LENGTH` (UX) em `src/lib/auth/password.ts` — quem barra de
   verdade é o GoTrue.
6. Template novo `recovery.html` (fonte `supabase/templates/`, cópia `public/emails/`)
   + `MAILER_TEMPLATES_RECOVERY`/`MAILER_SUBJECTS_RECOVERY` em produção.
   ⚠️ Texto no estilo aprovado da D5, mas o e-mail de recovery em si está
   **pendente de OK da dona**.

**O que NÃO mudou.** D6 (invite-only, signup fechado) intacta; provisionamento e
adoção de órfão idênticos; Lei 4 (papel só em app_metadata) intacta; convites já
enviados continuam válidos (type=invite) — agora desaguam em /definir-senha.

**Migração dos usuários existentes.** Quem foi criado antes desta mudança não tem
senha: usa "Esqueci minha senha" uma vez e pronto (o mantenedor e a dona inclusos).

**Bug pego no deploy (12/07, diagnóstico com navegador real).** Server action que
`redirect()`a para uma rota que por sua vez só `redirect()`a (`/admin` →
`/admin/alunos`) TRAVA a resposta no Next 16 — o navegador mostra "This page
couldn't load" após o login com sucesso (a sessão é criada; só a transição morre).
Reproduzido em produção E local (não é Cloudflare/Traefik). Senha errada funcionava
(destino `/login` é página real) — foi a pista. Correção: `HOME_BY_ROLE.admin =
'/admin/alunos'` (regra pinada no gate.ts: home de papel DEVE ser página real,
nunca rota-que-redireciona).

**Consequências.**
- GoTrue continua aceitando `verifyOtp(type=magiclink)` no endpoint dele próprio;
  o bloqueio do login-por-link é no `/auth/confirm` do app. Aceito: exigiria forjar
  requests, o rate limit segue valendo e a superfície é a mesma do recovery.
- O template `magic-link.html` fica configurado mas órfão (nenhum fluxo do app envia
  magic link); remover na próxima faxina de templates se a dona concordar.
- Testes: suíte 146/146 (fluxo convite→senha→login, recovery de ponta a ponta,
  senha fraca barrada pelo GoTrue, gate de /definir-senha e /recuperar-senha).
