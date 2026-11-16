# ADR-044 — Não há advogado: questão de peso jurídico é decisão do dono

**Data:** 16/11/2026 · **Status:** aceita (decisão do dono, 16/11/2026)

## Contexto

Três lugares do projeto deixavam um ponto "a validar com advogado" antes de
valer:

- a política de expiração dos créditos de mentoria: o doc 04 §5 a classifica
  como "recomendação com ressalva CDC" e manda validar com advogado antes de
  publicar o contrato; o `CLAUDE.md` repetia a ressalva, e o comentário da
  coluna `expiry_grace_days` (migration `20260711000400_mentorship.sql`)
  também;
- as cláusulas do contrato de aula particular: o ADR-018 diz que "o advogado
  vai redigir" as cláusulas da regra de cancelamento sem crédito;
- o mapa de decisões (issue 169) guardava "Cláusulas do contrato com o
  advogado" como item em aberto.

Na entrevista do ticket 177 (assinatura pelo Autentique), o dono informou que
não existe advogado no projeto e que isso vale para qualquer ponto em que se
pense em recomendar um. Em seguida autorizou tirar a ressalva do `CLAUDE.md`.

## Decisão

1. **Nenhuma decisão do projeto espera validação de advogado.** Ponto com
   peso jurídico (validade de contrato, cláusula, expiração de crédito,
   guarda de dados) é decisão do dono: a sessão apresenta o efeito prático de
   cada opção e ele decide.
2. **A política de expiração dos créditos de mentoria fica como está**
   (expiram no fim do curso mais a carência; `expiry_grace_days`), sem gate
   de validação. A regra no banco não muda.
3. **As cláusulas do contrato são redigidas pelo dono**, não por advogado.

## Consequência

- Este ADR é o desvio registrado do doc 04 §5 (e do item 6 da lista final do
  mesmo documento) e supera, só neste ponto, o "insumo jurídico" do ADR-018 e
  a linha correspondente do goal da Fase 1. Esses textos ficam como história;
  onde disserem "validar com advogado", vale o que está aqui.
- O comentário da coluna `expiry_grace_days` continua citando a validação: a
  migration já foi aplicada e não se edita (Lei 7). Se o comentário no
  catálogo do banco precisar mudar, é migration nova.
- O risco que o doc 04 §5 descreve (expiração de crédito pré-pago já foi
  considerada abusiva pelo CDC) continua existindo. O que muda é quem o
  avalia: o dono, sem parecer jurídico. As mitigações que o mesmo documento
  lista (enquadrar como acesso ao serviço por 12 meses, carência depois do
  fim do curso, prazo informado com destaque na compra e remarcação em falta
  justificada) seguem valendo como recomendação.
- A sessão não oferece mais "decidir com o advogado" como opção nem adia
  decisão para consulta jurídica.
