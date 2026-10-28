# ADR-037 — Leva 2: o schema concreto de content_trends e as bordas que os ADRs 032–034 deixaram abertas

**Data:** 03/08/2026 · **Status:** aceito (plano da sessão da Leva 2 aprovado pelo dono)
**Contexto:** ADR-032 nomeou as colunas de `content_trends` sem cravar tipos nem
resolver seis bordas; ADR-033/034 remeteram detalhes à implementação. Este ADR
registra as decisões tomadas ao escrever a migration `20260803000300` — cada uma
com o porquê, para o Sol pré-apply e para quem ler depois.

## Decisões

1. **Trend = 1 linha por `analise_reel` ATIVO da rodada corrente.** A linha de
   análise é a única com transcript/dissecação (ADR-032 dec. 1: "a trend lê pela
   FK") e o volume bate com o "~40/semana" do ADR-033. Consequências assumidas:
   **X e Reddit ficam fora do radar** (não têm reel — "SÓ REEL nesta onda", decisão
   reconfirmada do dono) e **análises de semanas passadas NÃO são backfilladas**
   (ressuscitar o acervo parqueado na 0.2 como trends contradiria aquela limpeza).
   `semana` da trend = semana ISO da própria captura.
2. **`source_key` vira coluna com UNIQUE — e é a ÚNICA chave de idempotência.**
   `--force` superseda a linha de research e criaria trend duplicada se a chave
   fosse `research_id`. Não há UNIQUE em `research_id` de propósito: o 1:1 já é
   consequência de `source_key` UNIQUE + o guard que exige
   `trend.source_key = research.source_key`, e um segundo índice único quebraria
   o upsert `ON CONFLICT (source_key) DO NOTHING` do worker (árbitro não suprime
   conflito de outro índice).
3. **FK `research_id` é RETRATO da captura.** Quando o run é superado
   (`superseded_by`), a trend NÃO re-aponta — a dissecação exibida é a da época
   da captura. Quem quiser o run novo segue a cadeia de supersessão na leitura.
4. **Fim da supressão silenciosa (dívida 1 da 0.4).** Colisão de dedup com tema
   já DESCARTADO não some: nasce linha `descartada` com `variacao_de`, motivo
   prefixado ("tema descartado na mãe: …") e ator HERDADOS — única exceção ao
   "nasce nova", validada pelo guard (exige mãe descartada). Persistente,
   auditada, e a fonte não é re-proposta (o `source_key` já existe).
5. **Variação é linha própria com vetor próprio (dívida 2 da 0.4).**
   `variacao_de` aponta SEMPRE para a raiz (profundidade 1, guard); o embedding
   da variação entra em `content_embeddings` escopo `trend` — a cadeia
   transitiva A~B~C fica coberta pela memória.
6. **`travel_meta jsonb` + cura pelo robô.** O ADR-033 exige justificativa e o
   ADR-032 não deu lugar a ela: vive em `travel_meta` (justificativa +
   proveniência prompt/modelo/avaliado_em). O robô ganha
   `UPDATE (travel_score, travel_meta)` — permitido pelo guard SÓ em `nova` —
   para preencher nota NULL na corrida seguinte (o fail-open do ADR-033 que se
   cura sozinho; espelho do `metricas/medido_em` do M4).
7. **`roteirizada` e `descartada` são terminais DE LINHA.** A 2ª geração da mesma
   trend (outro contexto, ADR-035) cria outro POST — não mexe na trend. Ajuste
   de nota/cluster pós-decisão não existe: decisão encerra a curadoria.
8. **Ponte em `content_posts` congela depois de escrita.** `trend_id`/`contexto`
   nascem nullable (roteiro avulso), aceitam NULL→valor (RPC da Leva 5; script
   2.3), e nunca trocam nem limpam — trocar o vínculo reescreveria a história.
   Pós-aprovado, ficam fora da whitelist (nem NULL→valor).
9. **Posts das 5 ideias `pauta` → `arquivado`** com `archived_reason` citando a
   trend nova + `trend_id` apontando para ela — saem de "Para você" sem perder
   histórico (aceite da 2.3). **Aplicação em produção na janela da Leva 3**
   (decisão do dono, 03/08): até lá as 5 seguem visíveis no Portão 1, porque o
   radar ainda não tem tela.
10. **`worker:ideias` fica intacto até o cutover (Leva 5).** O Portão 1 é a única
    UI da dona até a Leva 3; a dedup de ideias segue no escopo `ideia`. Só o
    payload/versão do embedding é compartilhado (recalibração conjunta — dívidas
    3/4 da 0.4, tratadas no item 2.2 do goal).

## Consequências

- Migration `20260803000300_content_trends.sql` (guards vermelhos em
  `tests/conteudo-trends.test.ts`, commit anterior à migration — regra 7).
- O radar estreia povoado pelas varreduras semanais que rodarem entre o deploy
  da Leva 2 e o flip da Leva 3 (regra "radar nunca estreia vazio").
- Quando a Leva 3 der UI às trends, as listas `STATUS_DA_TREND`/`CONTEXTOS` do
  teste migram para a gramática da tela (dois lados do mesmo contrato).
