# ADR-028 — Aceite "AlertDialog dentro de Sheet" adiado para a onda Agenda

**Data:** 27/07/2026 · **Status:** aceito · **Origem:** Sol rodada 2 da Onda 1
(achado nº 15) sobre a spec congelada `onda-1-admin.md` §M5.

## Contexto

A spec do M5 exige, por aceite da revisão anterior do Sol, um e2e de
"AlertDialog aberto DE DENTRO de um Sheet visível e focável". O M4 acabou
resolvendo a única confirmação destrutiva da onda (encerrar contrato) com
**type-to-confirm dentro do próprio Sheet** — desenho MAIS exigente que um
botão de confirmar — e o primitivo `kit/alert-dialog.tsx` ficou sem consumidor.
O harness do M5 constatou o fato e testou, no lugar, o empilhamento real que o
site tem hoje (Select do kit sobre Sheet: z-index, foco, Esc por camada).

## Decisão

1. O aceite literal fica **ADIADO para a onda Agenda**, cujo consumidor mapeado
   existe (o "Delete Event" do TutorBird é modal de confirmação com checkboxes
   de aviso — mapeamento §3ª passada). O e2e do par entra no harness daquela
   onda, junto com a primeira tela que usar o primitivo.
2. `kit/alert-dialog.tsx` **permanece no kit** com anotação de destino no
   cabeçalho. Se a Agenda escolher outro desenho, ele vira código morto e sai.
3. O teste substituto (Select sobre Sheet) permanece: cobre a mecânica de
   camadas que o site DE FATO exercita hoje.

## Consequência

A Onda 1 fecha sem o aceite literal e sem UI fabricada só para o teste passar
(que era a alternativa). A dívida fica visível: este ADR + o comentário no
primitivo + o aceite reescrito no harness da Agenda.
