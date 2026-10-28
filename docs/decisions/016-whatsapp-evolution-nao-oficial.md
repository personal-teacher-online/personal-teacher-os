# ADR-016 — WhatsApp via Evolution API (não-oficial) em vez da Cloud API da Meta

**Data:** 12/07/2026 · **Decisor:** O mantenedor (revisão do F3-D8 durante o M5)

**Contexto.** O goal da Fase 3 previa WhatsApp via Cloud API oficial/Coexistence —
bloqueado por aprovação e credenciais da Meta (por isso era só spec de handoff). O
mantenedor decidiu usar **API não-oficial** com uma conta WhatsApp Business já
"esquentada", destravando a implementação real nesta fase.

**Decisão.**
1. **Evolution API** (self-hosted, motor Baileys) — o mantenedor JÁ opera uma instância
   em produção no projeto agendamento-aulas; líder da comunidade BR; REST + webhooks;
   deploy via Docker/Coolify.
2. **Instância NOVA no VPS da escola** (recurso próprio no Coolify — decisão 1a):
   nada de acoplar ao servidor do outro negócio.
3. Número pareado: **65 90002-0002**; fallback se não funcionar: **65 90007-7777**.
4. Primeiro uso real: **aviso de crédito vencendo** (o e-mail 5, também por WhatsApp),
   SÓ para aluno com login + `whatsapp_opt_in` + `whatsapp_e164` (consentimento
   re-checado no ENVIO — opt-out tardio nunca recebe).

**Risco aceito (registrado com o mantenedor em 12/07/2026).** API não-oficial viola os
ToS do WhatsApp; o risco real é o BANIMENTO do número. Mitigadores: conta esquentada,
volume baixo e transacional (alunos que já conversam com a escola), opt-in explícito,
nada de disparo em massa. Baileys quebra ocasionalmente quando o WhatsApp muda o
protocolo — manter a imagem do Evolution atualizável pelo Coolify.

**Arquitetura de proteção.** O canal é um DRIVER atrás da interface
`NotificationChannel` (`src/lib/notify/`): se o número cair ou a escola migrar para a
Cloud API oficial, troca-se o driver e NADA mais (outbox, enqueue, despachante e
regras ficam intactos). O envio é fail-closed: sem `EVOLUTION_URL/API_KEY/INSTANCE`
a linha fica pendente com erro visível em /admin/avisos — nunca perda silenciosa.

**Consequências.** CLAUDE.md atualizado (stack); runbook §M com deploy/pareamento;
spec de handoff do WhatsApp vira doc OPERACIONAL + próximos usos (respostas
interativas continuam futuras — exigem webhook de entrada e desenho próprio).
