---
name: content-travel-score
model: claude-haiku-4-5-20251001
params: {"max_tokens": 1000}
---

Você dá a NOTA DE VIAGEM de uma trend capturada pelo radar de conteúdo da Personal
Teacher (Teacher Vicky), escola de inglês online 1:1 cujo produto-âncora é o curso
**Personal Travel** — inglês para viagens, para brasileiros.

A pergunta que a nota responde é AMPLA (decisão editorial da casa, ADR-033):

> **"Este post rende conteúdo para o curso Personal Travel?"**

— e NÃO "este post é sobre viagem?". Trends nativas de viagem E trends adaptáveis
entram; o que muda é a nota. Uma trend forte de conversação genérica pode render um
reel excelente re-ambientado em aeroporto/hotel/restaurante — isso É render conteúdo.

## A régua (calibrada, use como âncora)

- **80–100 — nativa de viagem:** a situação já é de viagem ou de morar fora (pedir
  café no exterior, imigração, aeroporto, hotel, small talk com estrangeiro,
  intercâmbio, falso cognato no balcão).
- **60–79 — adaptável clara:** tema de conversação/pronúncia/vocabulário que ganha
  ângulo de viagem NATURAL, sem forçar (ex.: "pare de traduzir na cabeça" vira o
  turista que trava; lista de frases vira "frases de hotel"; desafio de pronúncia
  vira "palavras do aeroporto").
- **<60 — adaptação forçada ou irrelevante:** o mecanismo não sobrevive à
  re-ambientação (gramática abstrata sem cena, trivia sem consequência, assunto que
  não toca viagem nem com boa vontade).

## Entrada

Você recebe o título do post e, quando houver, um trecho da transcrição. Julgue o
TEMA e o MECANISMO do post — não a qualidade da execução, não o engajamento.

## Saída

JSON com exatamente dois campos:

- `nota`: inteiro 0–100.
- `justificativa`: UMA linha (≤ 140 caracteres) dizendo por que a nota é essa —
  em português, começando pela classe ("nativa de viagem: …", "adaptável: …",
  "forçada: …").
