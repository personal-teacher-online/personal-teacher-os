# ADR-033 — `travel_score`: relevância pro Personal Travel, na definição AMPLA

**Data:** 02/08/2026 · **Status:** aceito (versão AMPLA reescrita por ajuste do dono
em 02/08) · **Autoria:** Fable (sessão de planejamento Estúdio v2)

## Contexto

A aba "Personal Travel" do radar é um **filtro** sobre a mesma base de trends (não um
bucket separado — decisão de produto §2.2). Cada trend precisa nascer com uma nota de
relevância pro curso. O dono corrigiu a formulação original: a pergunta do score é
**"este post rende conteúdo pro curso Personal Travel (inglês para viagens)?"** — e
NÃO "este post é sobre viagem?". Trends nativas de viagem E trends adaptáveis entram;
o que muda é a nota.

## Decisões

1. **Chamada de modelo na captura, não heurística.** Prompt novo
   `content-travel-score` em `ai_prompts` (estrutura da casa: repo canônico
   `prompts/content-travel-score.md` + publicação idempotente), modelo **Haiku 4.5**
   (`claude-haiku-4-5-20251001`), structured output: nota 0–100 + justificativa de
   uma linha. Roda no worker por trend capturada (~40/semana → custo irrelevante).
   **Rejeitada** heurística de keywords: o material é bilíngue (PT/EN) e "rende pro
   curso" é JULGAMENTO de adaptabilidade, não presença de palavra — "pare de traduzir
   na cabeça" não contém 'viagem' e rende; um vlog de turismo contém e não rende.

2. **Calibração DENTRO do prompt, com exemplos ancorados:**
   - nativas de viagem (pedir café no exterior, imigração, aeroporto) → **80–100**;
   - adaptáveis claras (tema de conversação que ganha ângulo de viagem natural, ex.:
     "pare de traduzir na cabeça") → **60–79**;
   - adaptação forçada ou irrelevante → **<60**.

3. **Aba PT = filtro por threshold + ordenação por nota decrescente.** Threshold
   configurável (default **60**); nativas flutuam pro topo naturalmente, adaptáveis
   abaixo. O threshold e o ajuste manual seguram o inchaço da aba.

4. **`travel_score_ajustado` manual vence SEMPRE.** É a válvula da dona para puxar
   uma trend de nota baixa pra dentro ou expulsar uma classificada errada (mitigação
   do risco "classificação PT errada" do briefing). Ajuste é coluna de curadoria
   (grant da admin, ADR-032 decisão 4), auditado.

5. **Falha da chamada = score NULL = fora da aba PT com aviso visível** — nunca
   bloqueia a captura (mesmo contrato fail-open do ADR-034). Trend sem score continua
   no radar geral; o worker imprime quantas ficaram sem nota.

## Consequências

- Prompt novo versionado (`content-travel-score` v1) publicado antes da Leva 2;
  iteração de calibração é editar prompt + republicar — sem deploy.
- Disparo a partir da aba PT gera roteiro com contexto `travel` (ADR-035); a MESMA
  trend pode gerar também o contexto `geral` — o score não tranca nada, só ordena e
  filtra.
- Custo: ~40 chamadas Haiku/semana com entrada curta (título + tese + resumo da
  transcrição) — centavos/mês, dentro do teto aprovado.
