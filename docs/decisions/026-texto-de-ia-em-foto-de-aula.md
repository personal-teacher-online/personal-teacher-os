# ADR-026 — Exceção à Lei 11: texto de IA em foto de AULA, quando o texto É o conteúdo

Data: 25/07/2026 · Status: aceito (ratificado pelo mantenedor em sessão, 25/07 — "as placas, você pede
pra IA gerar no contexto certo"; escrita autorizada em 25/07 à noite)

## Contexto

A Lei 11 (CLAUDE.md) proíbe texto gerado por IA dentro de imagem. Ela nasceu para **imagens de
MARCA**: o Soul da Higgsfield inventava texto garranchado, e a solução foi a arquitetura de duas
camadas (IA gera fundo/sujeito; texto/logo entram por Satori/HTML com design tokens).

Na produção das fotos do Personal Travel v2 (25/07), a proibição total colidiu com a pedagogia:

- A aula do M3 ensina a **ler o painel de partidas** — precisa de um painel com `DELAYED`,
  `CANCELLED`, `GATE` legíveis. Sem texto, a aula ensina a ler um painel que a aluna não vê.
- A aula do M5 ensina **placas** — `EXIT`, `PUSH`, `PULL`, `OUT OF ORDER` são o vocabulário.
- Placa em branco foi testada e **reprovada pelo dono**: "ficam forçadas a retirar conteúdo das
  placas, então não fica natural."

Medição que sustenta a exceção: o modelo (Nano Banana 2 / `gemini-3.1-flash-image`) **erra o que
inventa** (nome de país no passaporte, brasão dourado, logo "patagonia") e **acerta a palavra curta
que o prompt manda escrever** — os painéis do M3A3 e M11A1 saíram letra por letra corretos
(`LONDON 16:05 DELAYED / ROME 16:40 CANCELLED`), conferidos a olho.

## Decisão

**Fotos de AULA** (biblioteca `brand/slides/library/`) podem conter texto gerado por IA quando as
três condições valem juntas:

1. **O texto é o conteúdo pedagógico da cena** — placa, painel, etiqueta que a aula ensina a ler.
2. **É curto, genérico e ditado literalmente no prompt** (`placaEmFoco(palavras)` nos geradores).
   O modelo nunca decide o que escrever.
3. **É conferido letra a letra na curadoria** — a conferência automática (`conferencia.ts`)
   reprova pela régua `marca`; a grafia exata é responsabilidade do olho humano.

**Continua proibido, sem exceção:** nome de país, brasão, bandeira, logo ou marca real, texto longo,
e pseudo-texto/garrancho (caso real: lorem ipsum legível em `m9/phrases-on-phone` — reprovado).
Placa **ao fundo** continua saindo naturalmente desfocada (`PLACAS_AO_FUNDO`).

**O escopo original da Lei 11 fica intacto:** imagem de MARCA (posts, capas de curso, materiais
de divulgação) segue com texto 100% determinístico via Satori/HTML. Esta exceção é só para a
biblioteca fotográfica das aulas.

## Consequências

- Conformes por esta ADR: `m3/delayed-board`, `m3/departure-board`, `m11/departure-board-cancelled`,
  `vocab/sign-*.jpg` (8 placas do M5A2), `vocab/price-tag`, `vocab/size-tag`, `vocab/ticket` e afins.
- O guarda mecânico é a régua `marca` da conferência; o guarda de grafia é humano. Risco residual
  conhecido: texto semi-legível que não é marca nem palavra ditada (o caso `phrases-on-phone`) —
  a régua `telaDeNota` admite; fechado localmente, correção do bloco compartilhado pendente.
- A Lei 11 do CLAUDE.md ganha um ponteiro para esta ADR, para ninguém "consertar" a exceção
  achando que é bug.
