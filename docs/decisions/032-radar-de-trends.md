# ADR-032 — Radar de trends: `content_trends`, estados e o fim do Portão 1

**Data:** 02/08/2026 · **Status:** aceito (plano Estúdio v2 aprovado pelo dono em
02/08, com ajustes incorporados) · **Autoria:** Fable (sessão de planejamento)

## Contexto

O Estúdio opera como esteira de ideias interpretadas: a pesquisa é invisível, o Claude
propõe ideias e a dona aprova no Portão 1 antes de qualquer roteiro. As decisões de
produto de 02/08 invertem a curadoria: a **trend capturada vira objeto de primeira
classe** (post real: link, autor, views, velocidade, transcrição, dissecação), a dona
navega e puxa — **escolher a trend É a aprovação** — e o Portão 1 deixa de existir.
Estado atual completo: `docs/goals/ESTADO_ATUAL_ESTUDIO.md`. Goal da onda:
`docs/goals/estudio-v2-radar.md`.

## Decisões

1. **Tabela NOVA `content_trends` — a camada de CURADORIA.** `content_research`
   (migration 103) segue INTACTA como camada de MEDIÇÃO. **Rejeitado** evoluir
   `content_research`: o guard dela só permite `superseded_by null→uuid` — um objeto
   de curadoria é mutável por natureza (status, score ajustado, motivo de descarte) e
   contradiria o desenho de log imutável; além disso a migration 103 é imutável
   (Lei 7). Cada trend deriva de uma linha de research (FK `research_id`) e NÃO
   duplica transcript/dissecação — lê pela FK.

2. **Colunas de `content_trends`:** `plataforma` · `url` · `autor` · `views` ·
   `velocidade` (views/dia ÷ **mediana** da conta cadastrada — ratificado pelo dono;
   sem conta cadastrada = views/dia puro com flag `velocidade_sem_conta`) ·
   `capturada_em` · `semana` (a RODADA = semana ISO, mesma janela do cache da
   pesquisa — **sem tabela de corridas**) · `travel_score` + `travel_score_ajustado`
   (ADR-033) · `status` · `discard_reason` · `tema_cluster` · `variacao_de` (FK
   auto-referente — variação anexada à trend-mãe, ADR-034) · carimbos de ator.
   Guard próprio no banco (Lei 3), `audit_row_change`, RLS admin negar-por-padrão.

3. **Estados da trend:** `nova → roteirizada | descartada`. Descarte exige motivo
   (shape constraint) e **cascateia às variações por regra no banco**. "Pular" no
   cartão de triagem NÃO muda estado — é navegação. `roteirizada` é carimbada
   transacionalmente pela RPC de geração (decisão 5).

4. **Escrita em duas mãos, no molde do M4 (grant por coluna):** o worker
   (service_role) INSERE a captura (plataforma, url, autor, views, velocidade,
   semana, travel_score, research_id); a admin (a dona/o mantenedor) atualiza SÓ a
   curadoria (status, discard_reason, travel_score_ajustado, tema_cluster). Colunas
   disjuntas, conferíveis em `information_schema.column_privileges`.

5. **Fim do Portão 1 SEM reescrever o guard de `content_posts`.** "Gerar roteiro" no
   cartão = RPC `gerar_roteiro_da_trend(trend_id, contexto)` que, NUMA transação:
   INSERT do post como `ideia` → transição para `ideia_aprovada` com carimbo
   `idea_approved_by/at` da dona → carimba a trend como `roteirizada`. Compatível
   com `gate1_shape`, auditoria natural, zero mudança na máquina existente.
   **Rejeitado** alterar o guard para nascer `ideia_aprovada`: mexeria numa função em
   produção para ganhar nada — a mesma semântica sai por composição.

6. **Relação trend→roteiro:** `content_posts.trend_id uuid` (nullable — roteiro
   avulso não tem trend) + `contexto` (`geral` | `travel`). 1 trend → N posts (um por
   contexto/geração); as tentativas continuam DENTRO do post (`generation_attempts`,
   mecanismo do M2 intacto).

7. **Formatos: SÓ REEL nesta onda** (reconfirmado pelo dono após questionamento
   explícito). Nenhum caminho de geração para carrossel/story; os `kind` continuam no
   schema apenas como legado parqueado em `ciclo_futuro`.

8. **Estados novos em `content_posts` por migration ADITIVA:** `ciclo_futuro` e
   `arquivado` (terminais, imutáveis como `descartado`), para a limpeza do acervo
   legado (Leva 0.2): carrosséis/stories → `ciclo_futuro`; reels pré-esteira →
   `arquivado` com motivo. Transição permitida a partir de qualquer estado
   não-terminal, só por admin, auditada.

9. **Permissões/visões:** A dona e o mantenedor são ambos `admin` — NENHUMA mudança de
   RLS. A separação radar (dela) × auditoria (dele) é de UI: cartões de triagem +
   vista "Todos" + Criadores + painéis.

## Consequências

- Migrations novas (Leva 0.2: estados; Leva 2: `content_trends` + colunas em
  `content_posts`), todas com guards vermelhos primeiro (regra 7 do fluxo da frente)
  e UM ataque do Sol ANTES do apply (artefato irreversível — precedente M5).
- `content_posts` vira a camada de ROTEIRO (rascunho → Portão 2 → aprovado →
  publicado); `ideia`/`ideia_aprovada` sobrevivem como estados internos de passagem
  (nascem e morrem dentro da RPC ou da fila de retry) e para o roteiro avulso.
- O fluxo novo fica: `capturada → [a dona escolhe] → roteirizada (rascunho) →
  Portão 2 → aprovada (congelada) → publicada`, mais `descartada (com motivo)`.
- A cadeia fonte→conteúdo fica auditável ponta a ponta:
  `content_research` (medição) → `content_trends` (curadoria) → `content_posts`
  (roteiro), cada elo por FK.
