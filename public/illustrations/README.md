# Ilustrações flat (banda do Início e estados vazios)

Origem: **unDraw** (https://undraw.co) — ilustrações open-source. A licença do
unDraw permite uso comercial e modificação **sem atribuição obrigatória**
(https://undraw.co/license). Este arquivo existe para registrar a procedência,
não porque a licença exija crédito.

Baixadas em 26/07/2026 do CDN oficial e **recoloridas**: o acento padrão do
unDraw (`#6c63ff`) foi trocado, arquivo a arquivo, pelo periwinkle vivo da nossa
paleta (`#8488d9` = `PALETA_OFICIAL.periwinkle`, o mesmo `--ac-vivid` do tema).
Nenhum outro traço foi alterado — os neutros (`#3f3d56`, `#e6e6e6`, `#f2f2f2`) e
os tons de pele originais continuam como vieram.

| arquivo | original | onde é usado |
| --- | --- | --- |
| `aula-online.svg` | `illustrations/online-learning_tgmv.svg` | banda de topo do Início (some abaixo de `lg`) |
| `agenda-vazia.svg` | `illustration/online-calendar_iz1q.svg` | estado vazio "Nenhuma aula hoje" |
| `tudo-em-dia.svg` | `illustrations/complete-task_qgwk.svg` | estado vazio "Nada travado" (pendências zeradas) |

Regra de uso: são **decorativas** (`alt=""`, `aria-hidden` quando acompanham um
texto que já diz tudo) e entram por `next/image` com `unoptimized` — SVG não
passa pelo otimizador do Next.

Não baixamos a ilustração de pagamentos sugerida na rodada: nenhuma tela desta
entrega tem lugar honesto para ela, e asset sem uso é peso morto. Quando a onda
do Financeiro precisar, a régua está aqui.
