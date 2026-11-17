# ADR-045 — O aviso do cancelamento pela admin sai depois da resposta da tela, sem esperar a rodada

**Data:** 17/11/2026 · **Status:** proposta na PR #197 (o dono pediu o registro em 17/11/2026 e julga o conteúdo na PR)

## Contexto

No teste completo em produção de 02/11/2026 (achado 11, issue #191), a dona
cancelou uma aula às 16:38 e o aviso ficou parado até a rodada de envio das
17:10. Aula cancelada 35 minutos antes podia ser avisada depois do horário
dela. Em 16/11/2026 o dono decidiu que isso trava o convite dos alunos reais
(#179): cancelamento feito pela admin envia o aviso na hora.

O cancelamento já grava o aviso na fila de avisos do banco, na mesma
transação. O que faltava era alguém processar essa linha antes da rodada
horária (ADR-015). As outras telas que fazem isso (portal, painel da
professora, tratamento de período) chamam a rodada de dentro da própria ação
e esperam por ela antes de responder. Na revisão desta mudança, dois problemas
desse molde apareceram:

- a rodada sem filtro pega as 500 linhas mais antigas da fila: com fila cheia,
  o aviso recém-criado fica de fora, e o clique da dona manda avisos que não
  têm relação com a aula;
- a tela espera o login e os provedores de e-mail e de WhatsApp. Com um deles
  travado, a dona ficaria até cerca de 30 segundos sem o recado de uma aula
  que já está cancelada.

## Decisão

1. Depois de o banco confirmar o cancelamento, as duas telas de cancelamento
   da admin (Agenda e ficha do aluno) **agendam o envio dos avisos daquela
   aula para logo depois da resposta**, com o `after()` do Next. A tela
   responde na hora; o envio roda em seguida, dentro do processo do app.
2. **Só os avisos daquela aula**: o da aluna (e-mail e WhatsApp, conforme as
   caixas marcadas) e o da professora. O resto da fila segue para a rodada
   normal.
3. **A garantia de entrega continua sendo a fila do banco e a rodada
   horária.** O `after()` só adianta a rodada para aquela aula. Não há fila
   nova, serviço novo nem dependência nova.

### Isto é desvio da Lei 5?

A Lei 5 fixa o mecanismo de trabalho em segundo plano (`pg_cron`, `pgmq`,
`pg_net` e um worker Node) e proíbe acrescentar Redis, BullMQ, Trigger.dev,
Inngest, Kafka ou similar. Aqui não entra nenhum deles, e nada passa a
depender do `after()` para ser entregue: a linha já está na fila antes de ele
rodar, e a rodada horária a entrega se ele não rodar.

O que é novo é haver trabalho que roda dentro do processo do app depois da
resposta, coisa que a lista da Lei 5 não menciona. O projeto já faz algo da
mesma natureza no espelho do Google Agenda, que a ação dispara sem esperar. A
leitura deste ADR é que se trata de **uso dentro da Lei 5, não de desvio**: a
lei protege a durabilidade (nada de fila fora do Postgres), e ela não mudou.
Se o dono ler de outro modo, este ADR passa a ser o desvio registrado, com o
mesmo conteúdo.

## Consequência

- **Se o trabalho agendado não rodar** (falha ao agendar, processo que cai
  antes de começar): o aviso sai na rodada horária seguinte, como era antes da
  #191. Ninguém vê erro; fica uma linha no log do servidor quando a falha é
  do agendamento.
- **Se o processo for cortado no meio do envio** (reinício ou deploy): linha
  só reservada volta para a fila em 10 minutos e sai na rodada. Linha com
  envio já iniciado no provedor fica fora da fila e, depois de 10 minutos,
  aparece em Mensagens como "resultado incerto", para a dona conferir. É a
  mesma regra de qualquer rodada interrompida. No desligamento normal o Next
  espera o trabalho terminar, dentro do prazo de parada do container; esse
  prazo é configuração do deploy e não foi conferido aqui.
- **O aviso sai em segundos.** Antes havia, por acidente, até uma hora para
  resolver em Mensagens, sem enviar, o aviso de uma aula cancelada por engano.
  O controle que fica são as caixas de canal na confirmação do cancelamento.
- **O app passou a conhecer o formato da chave** com que o banco grava os
  avisos de cancelamento, para filtrar por aula. Se uma migration mudar esse
  formato, o envio na hora deixa de achar as linhas e o aviso volta a esperar
  a rodada, sem erro. Quem acusa é o teste
  `tests/cancelamento-admin-avisa-na-hora.test.ts`, que lê as linhas pelo
  conteúdo delas e fica vermelho.
- **Nenhum teste automático roda o `after()` de verdade** (nos testes ele é
  dublê). A prova de que ele roda no servidor é manual: cancelar uma aula e
  ver, em Mensagens, o aviso processado sem esperar a rodada. Foi feita na
  bancada visual em 17/11/2026 (registro na PR #197) e cabe repetir no
  primeiro deploy que levar esta mudança.
- **As outras telas que enviam na hora continuam no molde antigo**: esperam o
  envio antes de responder e rodam a fila sem filtro. Estão na #196.
- **Quando reavaliar:** ao tratar a #196 (o molde daqui passa a ser o de
  todas, ou volta-se atrás aqui); quando o worker da fila previsto na Lei 5
  assumir o envio (ADR-015), caso em que o `after()` pode sair; e se um
  deploy mostrar avisos presos como "resultado incerto" por reinício.
