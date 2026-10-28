# ADR-034 — Dedup temática na captura: pgvector + embeddings do Gemini

**Data:** 02/08/2026 · **Status:** aceito (plano Estúdio v2 aprovado em 02/08) ·
**Autoria:** Fable (sessão de planejamento)

## Contexto

A dedup atual é por FONTE (link/`source_key`), não por TEMA. Resultado medido no
acervo de 02/08: "substituir o WHAT?" ~4× · "pedir café" ~4× · "rotina corrida/15
minutos" ~5× — o mesmo assunto entrando por fontes diferentes, muitas vezes em
línguas diferentes (PT/EN). A decisão de produto §2.9 manda: antes de inserir,
comparar título/tese/transcrição com trends **ativas E descartadas**; colisão vira
**variação anexada à trend-mãe**, e o descarte da dona vale para as variações do
tema.

## Decisões

1. **Mecanismo: pgvector + embeddings do Gemini.** Extensão `vector` habilitada no
   Supabase self-hosted; embeddings pela API do Gemini (`GEMINI_API_KEY` já existe no
   pipeline — zero dependência nova). Texto embedado: título + tese + resumo da
   transcrição (quando houver). Comparação por cosseno contra o conjunto ativo E
   descartado. **Rejeitada** normalização lexical (LCS/keywords): as duplicatas
   reais são CROSS-LANGUAGE ("pedir café" × "ordering coffee") — léxico não pega.
   **Alternativa registrada** (não adotada, vira fallback se o pgvector mostrar
   atrito no self-hosted): comparação em lote via Claude (1 chamada por varredura,
   candidatos × lista compacta de temas existentes).

2. **Armazenamento: tabela lateral `content_embeddings`** (`escopo`, `ref_id`,
   `embedding vector`, `modelo`, `criado_em`, `unique(escopo, ref_id)`), escrita pelo
   worker (service_role). Serve as DUAS eras: ideias (Leva 0.4) e trends (Leva 2+),
   sem alterar `content_posts` nem duplicar mecanismo.

3. **Threshold decidido com CASO DE TESTE, não por palpite.** As famílias reais de
   duplicata do acervo de 02/08 viram FIXTURES obrigatórias; o threshold é o que
   separa essas famílias sem colar temas distintos do mesmo acervo (falso-positivo
   testado junto). Registrar no teste o valor escolhido e a medição que o sustenta.

4. **Colisão → variação, nunca descarte silencioso.**
   - **Era das trends (Leva 2+):** a candidata nasce com `variacao_de = <trend-mãe>`
     (FK do ADR-032); descarte da mãe cascateia por regra no banco.
   - **Ponte na era das ideias (Leva 0.4):** a candidata NÃO cria post novo — é
     anexada ao jsonb `idea.variacoes[]` da mãe ({titulo, source_key, de_onde_veio}),
     e o descarte da mãe naturalmente cobre as variações. Mesmo mecanismo de
     comparação, destino adaptado ao schema atual (zero migration em
     `content_posts`).

5. **Fail-open declarado:** erro de embedding LOGA e insere sem dedup — a captura
   NUNCA trava por causa da dedup. O relatório da corrida imprime quantas comparações
   falharam.

## Consequências

- Migration da extensão + `content_embeddings` entra na Leva 0.4 (guards vermelhos
  primeiro; Sol pré-apply).
- Backfill: embeddings das ideias/trends já existentes na primeira corrida com o
  mecanismo ligado (custo ~zero; Gemini embeddings).
- O painel de descarte ganha semântica nova: "descartei este TEMA" — o que exige a
  vista de auditoria mostrar variações penduradas na mãe (Leva 3).
