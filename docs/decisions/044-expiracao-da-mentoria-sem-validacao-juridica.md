# ADR-044 — A expiração dos créditos de mentoria não espera validação de advogado

**Data:** 16/11/2026 · **Status:** aceita (decisão do dono, 16/11/2026)

## Contexto

O doc 04 §5 classifica a política de expiração dos créditos de mentoria como
"recomendação com ressalva CDC" e manda validar o texto com advogado antes de
publicar o contrato (o item 6 da lista final do mesmo documento repete). O
`CLAUDE.md` carregava a ressalva ("validar com advogado"), e o comentário da
coluna `expiry_grace_days` (migration `20260711000400_mentorship.sql`) também.

Em 16/11/2026, na entrevista do ticket 177 (assinatura pelo Autentique), o
dono informou que não existe advogado no projeto e autorizou tirar a ressalva
do `CLAUDE.md`.

## Decisão

1. **A política de expiração dos créditos de mentoria deixa de esperar
   validação de advogado.** Ela é decisão do dono e fica como está: os
   créditos acumulam e expiram no fim do curso mais a carência
   (`expiry_grace_days`). A regra no banco não muda.
2. **O alcance deste ADR é só esse ponto.** Ele não revoga nenhuma outra
   exigência de consulta jurídica, trabalhista ou contábil registrada em
   outro documento.

## Consequência

- Este ADR é o desvio registrado do doc 04 §5 e do item 6 da lista final do
  mesmo documento. Onde eles e a linha correspondente do goal da Fase 1
  disserem "validar com advogado" sobre a expiração da mentoria, vale o que
  está aqui.
- O comentário da coluna `expiry_grace_days` continua citando a validação: a
  migration já foi aplicada e não se edita (Lei 7). Se o comentário no
  catálogo do banco precisar mudar, é migration nova.
- O risco que o doc 04 §5 descreve continua existindo, com a qualificação da
  própria fonte: a decisão judicial citada trata de crédito de celular
  (telecom, serviço público essencial), e a aplicação à mentoria paga é uma
  analogia "forte mas não idêntica", não uma conclusão direta. O que muda é
  quem avalia esse risco: o dono, sem parecer jurídico. As mitigações que o
  mesmo documento lista (enquadrar como acesso ao serviço por 12 meses,
  carência depois do fim do curso, prazo informado com destaque na compra e
  remarcação em falta justificada) seguem valendo como recomendação.
- **Ficam fora deste ADR** as outras menções a advogado: as cláusulas do
  contrato de aula particular (ADR-018, "insumo jurídico"; o gate "Cláusulas
  com advogado" do plano integrado e a revisão antes do primeiro convite, no
  documento de decisões dos motores) e a consulta trabalhista e contábil
  antes da auditoria de horas (doc 01). Este ADR não muda nenhuma delas: cada
  uma é decisão própria do dono, registrada onde ela mora.
