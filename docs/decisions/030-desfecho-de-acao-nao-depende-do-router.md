# ADR-030 — Desfecho de ação no portal não depende do commit do Router do Next

**Data:** 28/07/2026 · **Status:** aceito · **Origem:** achado K2 do harness e2e
da Onda do Portal (P7a), investigado na bancada em ~120 rodadas instrumentadas.
**Versões medidas:** Next **16.2.10** · React **19.2.4** · Chromium do Playwright
(com e sem janela) · `next start` na porta 3100.

## Contexto

Desde o P4 (ADR-025) toda ação do portal termina em `redirect`: a frase do
desfecho vai para um cookie `httpOnly` de 15s (`src/lib/portal/flash.ts`) e a
MOLDURA (`RecadoDoPortal`, montado pelo layout) a repinta na tela de destino.
O desenho é bom — funciona com e sem JavaScript — mas ele depende de UMA coisa
acontecer no cliente quando há JavaScript: **o React comitar a árvore nova que
veio no payload da Server Action**.

O harness e2e do P7a mediu que o toast da recusa chegava ora em ~150 ms, ora em
~29 000 ms, sem meio-termo, e registrou a suspeita certa: o recado ficava
represado até um `setState` alheio forçar o render. A investigação do K2 foi
atrás da raiz e achou coisa pior do que "demora 30 s".

### O que foi medido

Sondas de `render`, `useLayoutEffect` (commit) e `useEffect` dentro do
`AvisoLegado`, mais a linha do tempo de rede:

- Nas rodadas lentas, a árvore nova **renderiza uma vez** (às vezes nem isso) e
  **nunca é comitada**. Não é o toast que atrasa — o `useLayoutEffect` do próprio
  componente também fica esperando. Por isso nada que mexa em QUANDO o toast
  dispara (microtask, `useLayoutEffect`, `requestAnimationFrame`) resolve.
- **O contador do D1 (`BotaoEntrar`) é o SOCORRO, não a causa.** O `setState` do
  tique de 30 s (`INTERVALO_DA_CONTAGEM_MS`) força o React a terminar o trabalho
  parado — daí o recado pintar cravado em ~29 000 ms. Com o intervalo posto em
  999 s na bancada, **5 de 6 rodadas ficaram SEM RECADO até o teto de 45 s**; sem
  o `BotaoEntrar` na página, 6 de 6 pintaram em ~130 ms.
- Nas telas **sem** contador (o briefing) não existe quem force: quando a corrida
  é perdida, o recado não chega nunca. Foi assim que o teste
  `e o recado SOBREVIVE ao redirect do gate` ficou vermelho (timeout de 20 s, com
  retry — duas falhas seguidas) numa passada do rito e verde na seguinte.
- A corrida acontece **também com janela** (1 em 8), então não é artefato do
  headless.

### Tabela da bancada (aula do aluno, 8 rodadas por variante, código real)

| variante | <1 s | 1–10 s | >10 s | perdido |
|---|---|---|---|---|
| como estava | 4 (~150 ms) | 0 | 4 (~29 000 ms) | 0 |
| resposta da action entregue **num pedaço só** (sem streaming) | 8 (~150 ms) | 0 | 0 | 0 |
| **mesma perturbação de tempo (+120 ms), mantendo o streaming** | 4 | 0 | 4 (~29 500 ms) | 0 |
| intervalo do D1 em 999 s (6 rodadas, sem o socorro) | 1 | 0 | 0 | **5** |

A terceira linha existe para matar o confundimento: **não é latência, é a entrega
em pedaços**. A corrida mora entre o parse do payload de Flight da action e o
agendamento do React.

### A corrida só aparece quando o redirect volta para a MESMA url

Medição decisiva, 10 rodadas: a etapa 1 → 2 do briefing (caminho de SUCESSO, em
que `redirect` leva para `?etapa=2`, endereço DIFERENTE do atual) avançou
**10 de 10 em ~130 ms**, sem uma única perda. Os dois casos que travam —
confirmar presença numa aula e a RECUSA da etapa 1 — têm em comum devolver a
pessoa exatamente ao endereço em que ela já está.

Isso fecha três coisas que antes não se explicavam: por que o teste do fluxo do
briefing nunca piscou enquanto o teste da recusa piscava; por que o defeito é
invisível nas telas de sucesso; e por que recarregar `location.href` é o
conserto CERTO e não um paliativo — quando a corrida acontece, o endereço atual
já É o destino que o `redirect` queria.

### Hipóteses derrubadas por medição

Todas continuaram travando: tempestade de prefetch `?_rsc=` (bloqueá-la
**piorou**), `content-encoding: gzip`, `RedirectType.replace` no lugar do push,
as marcas `data-submitting`/`data-pending` do `ClickFeedback`, `<Suspense>` em
volta do `children` no layout do portal, e o relógio impuro (`Date.now()`) na
prop do D1.

### Por que o conserto na origem não entrou

Entregar a resposta da Server Action sem streaming foi a única intervenção que
zerou o defeito (8/8), mas **não existe botão para isso no app**: em
`next.config`, `experimental.serverActions` expõe apenas `bodySizeLimit` e
`allowedOrigins`; o proxy (`src/proxy.ts`) roda ANTES do handler e não alcança o
corpo da resposta; e a única forma real — um servidor Node próprio embrulhando o
handler do Next — vive FORA do `next start` que o rito e2e sobe, ou seja, seria
um conserto que a nossa própria bancada não exercita. Ficou registrado, não
aplicado.

## Decisão

1. **O desfecho deixa de ser refém do commit do Router.** Nasce
   `src/components/kit/ResgateDoEnvio.tsx`: dentro de um `<form action={…}>`, ele
   observa `useFormStatus().pending` e, se em `RESGATE_DO_ENVIO_MS` (3 s) a
   árvore nova não tiver sido comitada, faz `window.location.assign(location.href)`
   — recarga simples. O cookie de flash ainda está vivo (15 s) e o servidor
   entrega o desfecho no HTML novo, pelo mesmo caminho que já funciona sem
   JavaScript nenhum.
2. **Montado onde há ação de portal:** `BotaoDeAcao` (todas as ações do aluno) e
   os quatro formulários de briefing / re-briefing — estes últimos porque são
   telas SEM contador, onde o commit perdido não tem quem o force, e são
   exatamente as que derrubaram o e2e.
3. **O cookie de flash continua morrendo por expiração**, sem ninguém apagá-lo na
   leitura (regra do P4 mantida): é ela que faz a recarga funcionar.
4. **Rejeitado: reduzir o intervalo do `BotaoEntrar`.** Seria mascaramento — o
   commit continuaria perdido, o socorro continuaria acidental e as telas sem
   contador continuariam mudas. O que se entrega aqui é o desfecho, não a
   aparência dele.

### Resultado medido depois

| tela | <1 s | 1–10 s | >10 s | perdido |
|---|---|---|---|---|
| aula do aluno (16 rodadas) | 11 (~150 ms) | **5 (~3 350–3 850 ms)** | 0 | 0 |
| briefing, etapa 1 (10 rodadas) | 6 (~205 ms) | **4 (~3 840 ms)** | 0 | 0 |

Nenhum recado perdido, nenhum acima de 10 s.

## Consequência

- **Revisar quando subir Next ou React.** Se a corrida sumir upstream, o resgate
  vira código morto barato (um `setTimeout` que nunca dispara) e pode sair; se
  mudar de forma, a medição desta ADR é o roteiro para refazer o diagnóstico. O
  script de bancada usado aqui não foi versionado de propósito — o que fica é a
  receita: sondas de render/commit/effect no `AvisoLegado` e contagem de rodadas.
- **O e2e cobre.** O teste do recado no `onda-portal.spec.ts` passa a ter
  ORÇAMENTO DE TEMPO (antes só media e imprimia): o desfecho tem de chegar dentro
  da janela do resgate. Sem o `ResgateDoEnvio`, esse teto fica vermelho nas
  rodadas em que a corrida é perdida.
- **Dois preços aceitos e declarados** (também no cabeçalho do componente):
  1. ação que legitimamente demore mais de 3 s leva recarga no meio — o POST é
     abortado no cliente e a pessoa pode ficar sem a frase daquele ato (o que o
     banco já fez continua feito). Na bancada a action inteira mede ~90 ms, então
     a folga é de mais de uma ordem de grandeza;
  2. se a corrida algum dia pegar uma ação cujo destino é OUTRA tela (remarcar
     bem sucedido devolve ao `/portal`), a recarga deixa a pessoa na tela atual —
     com o recado certo e os dados novos, mas sem a mudança de endereço. Hoje
     isso é teórico: 10 de 10 rodadas com destino diferente passaram em ~130 ms,
     e a corrida só foi observada quando o destino é o endereço atual.
  A alternativa mais precisa (só recarregar depois que o `PerformanceObserver`
  confirmar que o POST da action terminou) foi considerada e adiada: mais código
  e mais modos de falha para cobrir um caso que a folga de 3 s já cobre.
- **Fora do portal:** admin e teacher usam o mesmo padrão de action + redirect e
  não foram instrumentados nesta rodada. Se o mesmo sintoma aparecer lá, o
  `ResgateDoEnvio` é reusável como está — é peça de kit.
