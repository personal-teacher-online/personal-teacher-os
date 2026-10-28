# ADR-022 — Curadoria de vídeos do YouTube para os decks (transcript não-oficial aceito)

Data: 20/07/2026 · Status: aceito (ratificado pelo mantenedor)

## Contexto

Os slides de listening do Personal Travel usam vídeos curtos do YouTube. O
mantenedor quer automatizar: buscar candidatos → a dona escolhe → vídeo entra no
slide → perguntas/gabarito gerados a partir do vídeo. Verificação (20/07):

- **Busca**: YouTube Data API v3 `search.list` — oficial, API key simples,
  100 unidades/busca de 10.000/dia; filtros `videoCaption=closedCaption`,
  `videoDuration=short`, `relevanceLanguage=en`, `videoEmbeddable=true`.
- **Inserção no deck**: Slides API `CreateVideoRequest` com `source: YOUTUBE`
  — oficial; exige service account com acesso à pasta (motor M13/Fase 4).
- **Transcript de vídeo de terceiros**: NÃO existe rota oficial
  (`captions.download` exige OAuth do dono do vídeo). Rota de mercado:
  endpoint interno *timedtext* (o mesmo do painel de transcrição do
  youtube.com) — não-oficial, zona cinzenta de ToS, pode quebrar sem aviso.

## Decisão

1. **Aceitamos o risco do timedtext** para obter transcripts (mesmo padrão do
   ADR-016/Evolution): volume mínimo (~30 vídeos no curso), busca filtrada
   por `closedCaption` (transcript quase sempre existe), revisão humana da
   dona por cima de todo Q&A gerado, fallback manual se quebrar.
2. **Estágio 0 (agora, no repo)**: `scripts/slides/find-videos.ts` busca 3
   candidatos por aula e grava em `listening.candidates` no JSON; a escolha
   da dona vai por WhatsApp (fluxo humano atual); com a escolha, transcript
   → Q&A no schema → deck regenerado (gabarito progressivo nasce).
   Requer `YOUTUBE_API_KEY` em `.env.local`.
3. **Estágio 1 (Fase 4, no app)**: tabela `course_lessons` + job
   pg_cron→pgmq→worker busca candidatos; página de curadoria (cards com
   preview; coordenar naming com a fábrica de conteúdo do ADR-021); ao
   escolher: worker gera Q&A via Claude (prompt versionado) e insere o player
   com `CreateVideoRequest`; outbox notifica. Regra anti-conflito: vídeo+Q&A
   entram ANTES do fine-tuning manual do deck; depois, só mudança aditiva
   via API (nunca regenerar por cima de edição manual).
4. **Estágio 2**: ranqueamento dos candidatos por transcript (Claude avalia
   adequação ao nível/vocabulário-alvo antes de mostrar à dona).

## Consequências

- Passo 4 do fluxo depende de endpoint não-oficial — monitorar quebras; o
  restante do pipeline (busca, inserção, geração) é oficial e estável.
- `YOUTUBE_API_KEY` entra no rol de envs (gate CHAVES ganha +1 item barato).

## Adendo (20/07/2026, noite) — critérios da dona e trecho recomendado

Decisões do mantenedor após feedback da dona:

1. **Sem filtros numéricos.** Views/idade/duração removidos da busca (ficam
   como dados informativos). Permanecem apenas os técnicos: `videoEmbeddable`
   (precisa tocar dentro do Slides) e `safeSearch`.
2. **Curadoria por conteúdo humano real.** Preferência firme: pessoas reais em
   simulações reais do tópico — nada de animação. Verificação em duas camadas:
   descarte por metadados (canais de IA: 0 views, voz sintética, série
   repetida) e **conferência visual da thumbnail** (`i.ytimg.com/vi/<id>/hqdefault.jpg`
   lida como imagem) — pegou dois falsos positivos ("Easy English" infantil
   animado com 5,4M views e "At the Airport" cartoon).
3. **Trecho recomendado no fluxo de validação.** O Google Slides permite
   limitar início/fim do vídeo (Formatar → Opções de vídeo). O transcript
   (yt-dlp, legenda oficial/auto) vira proposta de trecho `excerpt {start,
   end, why}` gravada no candidato; a dona valida vídeo+trecho juntos, e o
   escolhido leva o excerpt para o slide (chip "▶ mm:ss–mm:ss" + notas).
   Na Fase 4, a inserção via API (`CreateVideoRequest`) pode aplicar
   `videoProperties.start/end` direto — trecho deixa de ser passo manual.

## Adendo FS-M2 (21/07/2026) — fábrica no site, sem fila, e Drive compartilhado

1. **Sem pgmq no v1** (desvio do esboço do Estágio 1): gerar um deck leva ~3s
   e é ação de admin — roda na própria server action (`generateDeckAction`),
   no padrão da casa (ação por rota). Fila só se a escala pedir.
2. **Link estável**: regenerar o deck faz `files.update` (media nova) no MESMO
   arquivo — o link que a dona guardou nunca muda; criação só na primeira vez
   (ou se o arquivo sumiu).
3. **Drive compartilhado obrigatório para os decks**: service account não tem
   cota própria e NÃO pode ser dona de arquivo novo em "Meu Drive"
   (`storageQuotaExceeded`, smoke de 21/07). Os decks da fábrica vivem num
   Drive compartilhado do Workspace (SA como Administrador de conteúdo);
   `resolveCourseFolder` acha o Drive/pasta por nome ou usa
   `PT_SLIDES_FOLDER_ID`. Todas as chamadas com `supportsAllDrives`.

## Adendo (21/07/2026) — transcript morre em IP de datacenter; gabarito é humano

Medido no servidor de produção (Hetzner) com o yt-dlp 2026.07.04 da imagem:
**todos** os `player_client` (default, android, ios, tv_embedded, web_embedded,
mweb) falham com "Sign in to confirm you're not a bot" — o YouTube exige
verificação para IPs de datacenter. Localmente (IP residencial) funciona.

**Decisão (opção A, escolhida pelo mantenedor):** o trecho e o gabarito passam a
ser marcados NA TELA pela professora — ela assiste ao vídeo de qualquer forma
antes de usá-lo. A seção "Trecho e gabarito do listening" traz início/fim
(mm:ss), o que o trecho cobre e as frases com caixa de "aparece no vídeo";
`buildManualProposal` monta o mesmo objeto que a IA montava e reaproveita
`applyVideoToLesson`. Sem cookies de conta no servidor, sem proxy residencial,
sem dependência que expira.

O caminho automático (transcript + IA) continua no código e aparece só onde
`SLIDES_AUTO_EXCERPT=1` (ambiente do mantenedor, IP residencial) — útil para
lotes, nunca no caminho crítico da dona.
