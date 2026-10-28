# Armadilhas operacionais

Referência do `SKILL.md` §5. Cada uma custou horas de trabalho real. Estão em ordem de
quanto tempo custaram.

---

## 1. `codex exec` em background trava esperando stdin

**Sintoma:** o comando não termina, não imprime nada, e o processo continua vivo. A última
linha do log é `Reading additional input from stdin`.

**Causa:** sem stdin fechado, o `codex exec` fica esperando mais entrada — indefinidamente.

**Correção:** sempre redirecionar:

```bash
codex exec "…" < /dev/null > /tmp/parecer.md 2>&1 &
```

**Prova de vida — a parte que engana:** "o processo existe" NÃO prova que o trabalho anda.
Um processo travado em stdin existe. O sinal certo é **um arquivo novo crescendo em
`~/.codex/sessions/`** (rollout `.jsonl` da sessão). Sem arquivo novo, sem trabalho.

## 2. NUNCA ler parecer com `tail`

**Sintoma:** o parecer "não tem achados críticos".

**O que aconteceu:** os achados críticos ficam no **TOPO** do parecer. Um `tail` truncou o
começo e a leitura virou um falso "zero críticos" — eram **9**. A rodada seguiu adiante como
se estivesse aprovada.

**Regra:** parecer se lê **inteiro, do topo**. Se o arquivo estiver truncado ou corrompido, o
parecer íntegro se recupera do **rollout `.jsonl` da sessão** em `~/.codex/sessions/` — a
mensagem completa está lá.

## 3. `pptxgenjs sizing:cover` é no-op sob Node

**Sintoma:** toda foto do deck sai **esticada** (aspecto distorcido), mesmo com
`sizing: { type: 'cover' }` no `addImage`.

**Causa:** a opção não tem efeito no caminho Node da biblioteca.

**Correção:** usar o `coverImage` do repo (`src/lib/slides/template.ts`), que faz o recorte de
verdade calculando o retângulo antes de desenhar. Todo layout que põe foto passa por ele —
`template-v2.ts` importa o mesmo `coverImage`. Se aparecer um `addImage` novo com `sizing`,
é bug.

## 4. Medir título por contagem de caracteres é cego à CAIXA ALTA

**Sintoma:** títulos que "cabem" pelo `.length` estouram a caixa na tela, e só em alguns
slides — os que estão em caixa alta.

**Causa:** `MMMM` e `iiii` têm o mesmo `.length` e larguras completamente diferentes. Título
em caixa alta é sistematicamente mais largo que a contagem sugere.

**Correção:** medir com a **tabela de glifos** — `displayTitleBox(text, boxW, size)` em
`src/lib/slides/layout.ts`, que devolve linhas e altura reais. Nenhuma decisão de encaixe sai
de `.length`.

## 5. Endereço de foto declarado ≠ foto certa

**Sintoma:** nenhum. A pré-varredura automática deu **0 endereços quebrados**, 424
referências de imagem, 351 arquivos distintos — e mesmo assim uma **cama de hotel** estava
num slide de **cabine de avião** (`ANOTACOES.md` §S8: `vocab/blanket.jpg` e
`vocab/pillow.jpg` compartilhados entre o módulo de hospedagem, onde estão certos, e o
módulo de voo, onde não estão).

**Por que nenhuma máquina pega:** o endereço existe, o arquivo existe, o schema valida, o
deck renderiza. O erro é **semântico**.

**Correção:** reaproveitar endereço é decisão de conteúdo, não de economia — e a última
palavra é da folha de contato (`qa-visual.md` §2). **Só o olho pega.**

---

## Armadilhas menores, mesmo espírito

- **`--refazer` SOBRESCREVE a biblioteca.** É opção explícita de quem chama, nunca padrão.
- **Extensão do endereço tem de bater com o mimeType real** — salvar JPEG com nome `.png` é o
  arquivo mentindo para o Drive e para o renderer. A rodada já falha nisso de propósito.
- **`LOTE` inválido mata o processo** em vez de virar 1 ou NaN: quem exportou `LOTE=x` está
  MEDINDO, e uma medição com o número errado é pior que nenhuma.
- **Resposta de modelo da família 3 traz bloco `thinking` ANTES do texto.** Ler o primeiro
  bloco de texto, nunca `content[0]`/`parts[0]` — senão o `JSON.parse` engasga num JSON
  perfeitamente válido. Vale para toda rotina de IA, não só para a conferência.
- **Script utilitário de fiação de fotos não sobrescreve endereço já declarado.**
  `scripts/slides/wire-images.ts` tem um `PRACTICE` cravado do v1; sem a trava, ele trocaria
  as 48 divisórias únicas do v2 pela mesma foto compartilhada **em silêncio**, e o defeito só
  apareceria no deck. Utilitário de fiação PREENCHE o que falta; trocar foto declarada é
  edição de conteúdo.
