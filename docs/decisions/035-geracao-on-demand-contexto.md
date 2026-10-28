# ADR-035 — Geração on-demand a partir da trend, com contexto por aba

**Data:** 02/08/2026 · **Status:** aceito (perguntas 1 decidida pelo dono em 02/08) ·
**Autoria:** Fable (sessão de planejamento Estúdio v2)

## Contexto

No radar, "Gerar roteiro" no cartão da trend É a aprovação (Portão 1 morre —
ADR-032). O disparo a partir da aba Personal Travel deve gerar roteiro com
direcionamento/CTA pro curso; da página geral, roteiro de engajamento geral; a mesma
trend pode gerar os dois (decisão de produto §2.4). O gerador do M2
(`generateReelScript`: pré-voo da voz → claim condicional → validação estrita → erro
devolve à fila; 3 tentativas; rejeição zera e realimenta) fica INTACTO — muda só a
porta de entrada e a composição da entrada.

## Decisões

1. **RPC `gerar_roteiro_da_trend(trend_id, contexto)` + action síncrona** no padrão
   `gerarAgoraAction` (a dona vê o rascunho na volta; duplo clique morre no claim).
   A RPC cria o post (`ideia` → `ideia_aprovada` carimbada → trend `roteirizada`,
   tudo numa transação — ADR-032 decisão 5); a action chama o núcleo de geração na
   sequência.

2. **Contexto composto por CÓDIGO, um prompt só.** O `contexto` da aba de origem
   (`geral` | `travel`) entra como bloco montado em `montaEntrada`:
   `=== CONTEXTO DE DESTINO ===` — travel → direcionamento/CTA pro curso Personal
   Travel; geral → engajamento geral. **Rejeitado** fork do prompt
   (`content-reel-script` continua ÚNICO): dois prompts = duas calibrações e dupla
   manutenção para uma diferença que é um parágrafo de entrada. A mecânica segue o
   padrão da casa (voz e feedback de rejeição já entram assim).

3. **Teto diário = 2, somando cron + botão** (decidido pelo dono — pergunta 1).
   Estourou o teto: o post fica em `ideia_aprovada` na FILA com mensagem honesta na
   UI ("roteiro entra na fila de amanhã — teto diário de 2 atingido"), e o cron pega
   no dia seguinte. A contagem do dia é verificada DENTRO da transação (Lei 3), não
   na UI — a UI só antecipa o aviso.

4. **O cron das 12:00 UTC vira exclusivamente VASSOURA DE RETRY da fila** (confirmado
   pelo dono que continua existindo nesse papel): consome `ideia_aprovada` com
   `attempts < 3` — que agora só contém (a) posts devolvidos por erro de geração e
   (b) posts enfileirados pelo teto. Nenhuma mudança na rota
   `/api/jobs/generate-content` além do que o teto somado exigir.

5. **Roteiro avulso** (decidido — pergunta 3): "+ Nova ideia" vira **"Roteiro
   avulso"** — a dona roteiriza sem trend (`trend_id NULL`), fora das métricas de
   conversão do radar. Mesmo gerador, mesma voz, mesmo Portão 2.

## Consequências

- Colunas `trend_id`/`contexto` em `content_posts` (migration da Leva 2, ADR-032);
  a RPC nasce na Leva 5 com Sol pré-apply.
- `generation_meta` passa a carimbar também o `contexto` — a métrica de reescrita e
  o histórico continuam auditáveis por contexto.
- O botão "Gerar roteiro" aparece nos cartões na Leva 3, mas só LIGA na Leva 5
  (dependência declarada no goal); o cutover do radar como página principal acontece
  depois da Leva 5.
