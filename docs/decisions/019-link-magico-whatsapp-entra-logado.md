# ADR-019 — Link do WhatsApp entra LOGADO (magic link por mensagem)

**Data:** 19/07/2026 · **Decisor:** O mantenedor (e2e do aviso por WhatsApp)

## Contexto

O e2e de 19/07 mediu a jornada real do lembrete: WhatsApp → link da página da
aula → **tela de login** → ação. O passo do login é fricção suficiente para o
aluno não terminar (observação do mantenedor ao completar o próprio fluxo). O
ADR-014 restringia links de autenticação por E-MAIL a convite e redefinição de
senha — nada dizia sobre o canal WhatsApp, que não existia à época.

Foram postas três opções: (a) token de 1 toque só para confirmar presença
(recomendação técnica — menor risco de vazamento); (b) sessão completa via
magic link; (c) manter login. **O mantenedor decidiu pela (b)**: o link do
lembrete loga o aluno de verdade e todas as ações (confirmar, remarcar,
cancelar) ficam à mão.

## Decisão

- O despachante, ao enviar um `class-reminder` por **WhatsApp**, gera um magic
  link do GoTrue (`auth.admin.generateLink({ type: 'magiclink' })`) **por
  mensagem** e embute `https://app…/wa/<token_hash>?ir=/portal/aula/<id>`.
- A rota `/wa/[token]` troca o token por **sessão completa**
  (`verifyOtp({ type: 'magiclink' })`) e redireciona ao destino.
- Salvaguardas: token de **uso único** (GoTrue); destino restrito por
  allowlist `^/portal(/|$)` (sem open redirect); token usado/vencido degrada
  para `/login?erro=link-invalido&next=<destino>` — o fluxo nunca morre, só
  volta a pedir senha; falha na GERAÇÃO do link nunca trava o envio (o texto
  sai com o link normal).
- E-mail permanece como no ADR-014 (links de auth só convite/reset).

## Consequências

- **Risco aceito:** link encaminhado/vazado = sessão de aluno para quem o
  tiver, até expirar o OTP (validade padrão do GoTrue) ou ser usado. Mitigado
  por: canal 1:1 (WhatsApp do próprio aluno, opt-in LGPD), uso único, escopo
  de aluno sob RLS (nunca admin/professora).
- Gerar um magic link novo invalida o anterior do mesmo usuário: quem tocar o
  link do toque de 48h DEPOIS de receber o de 2h cai no login com destino —
  comportamento aceito.
- O texto do WhatsApp não muda de forma visível; só o alvo do link.
