# ADR-045 — O aviso do cancelamento pela admin sai depois da resposta da tela, sem esperar a rodada (desvio da Lei 5)

**Data:** 17/11/2026 · **Status:** aceita com o merge da PR #197 (registro pedido pelo dono em 17/11/2026; este texto só chega à `main` pelo merge que ele autoriza)

## Contexto

No teste completo em produção de 02/11/2026 (achado 11, issue #191), a dona
cancelou uma aula às 16:38 e o aviso ficou parado até a rodada de envio das
17:10. Aula cancelada 35 minutos antes podia ser avisada depois do horário
dela. Em 16/11/2026 o dono decidiu que isso trava o convite dos alunos reais
(#179): cancelamento feito pela admin envia o aviso na hora.

O cancelamento já grava o aviso na fila de avisos do banco, na mesma
transação. O que faltava era alguém processar essa linha antes da rodada de
envio (o agendador é o do ADR-015; a cadência hoje é horária). Outras telas
que avisam na hora (portal, painel da professora, remarcação e tratamento de
período na admin) chamam a rodada de dentro da própria ação e esperam por ela
antes de responder. Na revisão desta mudança, dois problemas desse molde
apareceram:

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

### É desvio da Lei 5, e a fronteira dele

A Lei 5 fixa o mecanismo de trabalho em segundo plano (`pg_cron`, `pgmq`,
`pg_net` e um worker Node consumindo a fila) e proíbe acrescentar Redis,
BullMQ, Trigger.dev, Inngest, Kafka ou similar. Processar linhas da fila
dentro do processo do app, depois da resposta, é trabalho em segundo plano
por um mecanismo que a Lei não lista. Pelo mesmo critério do ADR-015, que
registrou como desvio o agendador externo da rodada, **isto é desvio da Lei
5**, e este ADR é o registro dele.

O que o desvio não faz: não acrescenta nenhum dos itens proibidos, e nada
passa a depender do `after()` para ser entregue. A linha já está na fila
antes de ele rodar, e a rodada a entrega se ele não rodar.

**Fronteira.** Vale só para adiantar o envio dos avisos de uma aula cancelada
pela admin. Não autoriza outro trabalho em `after()`, nem disparo solto dentro
do processo do app, para relatório, sincronização, rotina de IA ou qualquer
outra coisa: cada caso novo é pergunta ao dono e ADR próprio. O espelho do
Google Agenda é decisão do ADR-017; o disparo sem espera dele, na ação, já
existia e não foi analisado à luz da Lei 5 em ADR nenhum (dívida na #198). Ele
não serve de precedente para esta leitura nem é coberto por este registro. O
worker da Lei 5 continua sendo o destino do processamento assíncrono (ADR-015).

## Consequência

- **Se o trabalho agendado não rodar** (falha ao agendar, processo que cai
  antes de começar): o aviso sai na rodada horária seguinte, como era antes da
  #191. Ninguém vê erro; fica uma linha no log do servidor quando a falha é
  do agendamento.
- **Se o processo for cortado no meio do envio** (reinício ou deploy): linha
  só reservada volta para a fila em 10 minutos e sai na rodada. Linha com
  envio já iniciado no provedor fica fora da fila e, depois de 10 a 15
  minutos, aparece em Mensagens como "resultado incerto", para a dona
  conferir (até lá, aparece como aguardando). É a mesma regra de qualquer
  rodada interrompida. No desligamento normal o Next
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
- **As outras telas que avisam na hora continuam no molde antigo.** As que
  rodam a fila inteira e esperam o envio antes de responder estão na #196.
- **Quando reavaliar:** ao tratar a #196 (levar este molde às outras telas
  alarga o desvio e pede decisão própria; a alternativa é voltar atrás aqui);
  quando o worker da fila previsto na Lei 5 assumir o envio (ADR-015), caso
  em que o `after()` sai; e se um deploy mostrar avisos presos como
  "resultado incerto" por reinício.
