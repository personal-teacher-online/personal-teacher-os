# ADR-031 — Gerador in-app de roteiros, prompts de social em `ai_prompts` e política de dados de terceiros

**Data:** 31/07/2026 · **Status:** aceito (decisão 4 revogada pelo adendo de 01/08) · **Autoria:** Fable (recorte do M2, frente de conteúdo)

## Contexto

O ADR-021 previa a esteira de conteúdo alimentada por um pipeline n8n externo
(VPS Hostinger). O pipeline **nunca existiu**: as rotas `/api/content/*` estão
em produção dormentes (fail-closed, `CONTENT_API_TOKEN` não configurada) e a
esteira só tem o caminho manual. Em 30/07 o dono decidiu construir o gerador
DENTRO do app (Claude API + `ai_prompts`), 1º formato = roteiro de reel, com
pesquisa de pauta por scraping (criadores BR + internacionais + trends). Em
31/07 o dono reestruturou as regras editoriais da pauta (registro integral em
`docs/goals/conteudo-ciclo1.md`, seção M2). O **roteiro duplo** (duas versões
lado a lado, trend + voz) foi aprovado em 31/07 e **morto no mesmo dia**, após
a rodada 1 da calibração de roteiros reprovar com diagnóstico unânime de que a
versão voz arrastava todas as entregas: **a entrega é UM roteiro, no registro
trend**; a voz v1 segue intocada como documento e entra no prompt como contexto
(identidade + fatos canônicos), não como régua de reescrita
(`docs/goals/calibracao-m2-roteiros-rodada1.md`).

## Decisões

1. **O gerador é in-app** (`src/lib/content/generate.ts` + action "Gerar
   agora" + rota `/api/jobs/generate-content` com `CONTENT_GENERATE_TOKEN`,
   molde dispatch-outbox). **Revogadas as decisões 1 e 6 do ADR-021** (n8n
   como motor e prompts vivendo nos nós do n8n). As demais decisões do ADR-021
   ficam de pé — máquina de estados, Drive, digest, `brand_voice_docs`, Lei 11,
   v1 sem publicação automática. As rotas `/api/content/*` permanecem como
   estão: dormentes, fail-closed, sem remoção (custo zero, opção futura de
   alimentação externa).
2. **Prompts de social vivem em `ai_prompts`** (a "opção futura" da decisão 6
   do ADR-021 vira regra): repo canônico em `prompts/*.md`, publicação
   idempotente via `scripts/publish-prompts.ts` + RPC `publish_ai_prompt`,
   modelo pinado `claude-sonnet-5`. Nenhum prompt de produção hardcoded fora
   desse ciclo.
3. **Pauta JAMAIS consome dados de alunos** (ratificado 3× pelo dono: 30/07,
   31/07 e neste ADR). Nenhuma tabela de aluno, aula, briefing ou conversa é
   insumo de pesquisa, ideia ou roteiro. Inviolável — junto com "nada
   inventado sobre a vida da dona" (mecanismo: `pergunta_a_vicky` na ideia,
   marcador `[SUA HISTÓRIA AQUI]` no roteiro).
4. **Política de dados de terceiros:** vídeo/áudio bruto de terceiros **nunca
   é baixado nem persistido**; transcrição por URL (Gemini) ou streaming, e
   qualquer bruto intermediário é APAGADO após transcrição/análise. Persistem
   só DERIVADOS: transcrição, análise, métricas públicas agregadas. Aceite
   formal por escrito do dono (incluindo risco de ToS do scraping
   Apify/IG/X) fica no gate do M5, antes da migration `content_research`.
5. **Registro dos riscos editoriais apresentados e aceitos pelo dono
   (31/07):** cópia literal de ideia/formato e texto de terceiro palavra a
   palavra liberados (risco de direito autoral aceito); promessa de resultado
   sobre o produto liberada (risco CDC/propaganda enganosa aceito); trilha
   protegida vira AVISO no roteiro ("⚠️ usar pela biblioteca do app"), não
   bloqueio. A versão trend do roteiro duplo opera sem proibição editorial; a
   versão voz segue a voz v1 (intocada — gate da dona preservado).

## Consequências

- Envs novas: `ANTHROPIC_API_KEY` (runtime do gerador) e
  `CONTENT_GENERATE_TOKEN` (cron). `CONTENT_API_TOKEN` segue não configurada.
- O roteiro vive na coluna `roteiro` (blocos GANCHO/CENA/CTA/LEGENDA, sem
  marcadores de versão), zero migration no M2; contrato do formato em
  `src/lib/content/roteiro.ts` (parser de exibição no M3).
- Custo aprovado ~US$5–25/mês (medido no spike: geração projetada <US$2/mês).
- Se a alimentação externa voltar um dia, ela volta pelas rotas dormentes do
  ADR-021 — este ADR não queima essa ponte, só a deixa sem tráfego.

## Adendo de 01/08/2026 — decisão 4 REVOGADA; dados de terceiros são do dono; TikTok e Apify incondicional

Decisões do dono no gate do M4 e na abertura do M5 (01/08):

1. **A política de retenção da decisão 4 está REVOGADA.** O "bruto nunca é
   baixado nem persistido / transcreve-e-apaga" deixa de valer. Dados de
   terceiros são responsabilidade do DONO, não do app (palavra dele: "eu cuido
   dos dados dos terceiros, não você; não quero nenhum bloqueio nisso; não
   quero que fique apagando nada"). O pipeline não impõe limitação, não apaga
   nada e não tem rotina de limpeza: mídia baixada para transcrição fica
   guardada em `_rascunhos/research-midia/` e o bruto devolvido pelos scrapers
   em `_rascunhos/research-raw/` (ambos fora do git, `.gitignore`). No banco
   persistem os derivados (transcrição, análise, métricas públicas), como
   antes.
2. **O aceite formal previsto na decisão 4 deixa de existir.** O item "aceite
   ToS/retenção registrado" sai do gate do M5. Este adendo é o registro da
   decisão e da assunção de responsabilidade.
3. **TikTok entra na lista do scraping** (junto de IG e X) e o **Apify vira
   incondicional** — cai a condição "só após a 1ª corrida real de custo"
   (decisão do dono no gate do M4, 01/08). Custo segue IMPRESSO em toda
   corrida (estimado antes, real×estimado no fim) — informação, nunca trava.

**O que este adendo NÃO muda:** decisão 3 (pauta jamais consome dados de
alunos; nada inventado sobre a vida da dona) — inviolável e ratificada;
decisões 1, 2 e 5 intactas.
