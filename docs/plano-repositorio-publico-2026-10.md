# Tornar o repositório público sem expor dado nenhum (Fase 2 do fluxo orquestrado)

Decisão do dono em 14/10/2026 (plano aprovado em 15/10/2026, PR #26): o repositório vira público para ter GitHub Actions ilimitado
(os 3.000 min/mês do plano Pro são da conta inteira e acabaram em 15/10; a CI parou até um
orçamento provisório ser aberto). Público não quer dizer código aberto: não há licença; o
README passa a dizer "todos os direitos reservados, Personal Teacher Online". Publicar o
sistema da escola é decisão da dona do negócio, registrada pelo dono.

Molde: o plano da dashboard (`nova-dashboard-lotufo`, 13/10/2026), adaptado ao que este
projeto tem de diferente: produção numa VPS puxada por Deploy Key, seed com alunos reais que
é pino da suíte, migrations imutáveis (Lei 7) com nomes dentro, marca pública e material de
terceiro no repositório.

## O princípio: repositório NOVO, histórico novo, dentro de uma organização

O repositório privado atual **nunca** vira público. O histórico (586 commits, 464 MB de
pacote) tem 23 capturas de tela do cliente SSH já apagadas, um `.tar.gz` de análise, nomes,
telefones e o IP da VPS em todos os commits antigos; o GitHub mantém todo commit já enviado
acessível pelo SHA e pelos `refs/pull/N/head`, que o dono não consegue apagar. Reescrever o
histórico seria a receita para deixar passar algo.

Então: o conteúdo limpo nasce num repositório novo, com **um único commit inicial**, dentro da
organização **`personal-teacher-online`** (nome livre em 14/10/2026). Motivo da organização:
a **fila de merge** do GitHub (merge queue) só existe em repositório público de organização,
e ela é a resposta profissional ao problema do `strict` com várias PRs em paralelo: cada PR é
testada sobre a `main` real antes de entrar, sem ninguém atualizar branch. O privado fica
arquivado (somente leitura) como registro histórico; o `git blame` público começa do zero.

## O que sai, o que fica, o que muda (inventário de 14/10/2026, decidido pelo dono)

### 1. Nomes de pessoas → papel no lugar do nome; docs e prints saem

Equipe: dona (252 arquivos), professora (42), vendas (7), mantenedor (123), com
sobrenomes em dois documentos e no nome da pasta de logos. Alunos: 15 nomes completos em
`supabase/seed.sql` ("seeds reais"), espalhados por 28 arquivos de teste, 3 de `src/` e 3
migrations; capturas de tela em `qa/prints/` mostram alunos e a agenda da dona.

- **Código, testes, seed, prompts, ADRs, `CLAUDE.md`, `AGENTS.md`, `Design.md`:** um script
  único (`scripts/anonimizar.ts`, roda uma vez e é apagado) aplica um **mapa consistente**
  nome → papel ou nome fictício: "dona", "professora", "vendas", "mantenedor"; alunos viram
  nomes inventados estáveis (o mesmo nome real sempre vira o mesmo fictício, porque os testes
  citam nomes em asserções). Fusos, horários e créditos do seed FICAM: são o que os testes de
  DST e de saldo conferem, e não identificam ninguém sozinhos.
- **Três migrations já aplicadas** têm nomes literais: `20260712000400` (grava `'Teacher
  Vicky'` e `'S********'`), `20260713000100` (`ilike 's********%'`) e `20260727001400`
  (`'E**** F******'`). A Lei 7 proíbe editar migration aplicada. Decisão do dono (14/10):
  **ADR curto autorizando editar SÓ o literal** nesses três arquivos; produção já as aplicou
  (nada muda lá), o `db reset` local e o CI passam a produzir o nome fictício. O ADR registra
  os três arquivos e as linhas.
- **Valor padrão com o primeiro nome da dona** em `src/data/admin/home.ts` e `HANDLE = '@vickypteacher'` em
  `src/lib/content/compose.tsx`: viram leitura de configuração (`SCHOOL_OWNER_NAME`,
  `CONTENT_HANDLE`) com padrão neutro; produção recebe os valores reais por env.
- **`docs/goals/`, `docs/ops/`, handoffs, `qa/`:** saem inteiros para o repositório privado
  (seção 4). Os ADRs (`docs/decisions/`) ficam, anonimizados pelo mesmo mapa.

### 2. Marca e domínio → ficam; e-mails e telefones pessoais → saem

- "Teacher Vicky", "Personal Teacher Online", `app.personal-teacher.com`, logos em
  `public/brand/` e os modelos de e-mail **ficam**: é a identidade pública do negócio e o
  endereço do app. "Teacher Vicky" entra como exceção nominal do scanner.
- E-mails pessoais (gmail, hotmail, o da professora) e os dois de terceiros em
  `docs/design-research.md` **saem** com os docs ou viram `@exemplo.com`.
  `contato@personal-teacher.com` fica (institucional).
- Telefones reais (4 números, em `.env.example`, `src/lib/contact.ts` como padrão fixo, o
  placeholder do `CountryPhoneField`, 4 testes e docs): no código o padrão fixo vira env sem
  valor (`WHATSAPP_ATENDIMENTO_E164` só no `.env.example`, vazio) e os testes usam
  `+5565900000000`-ish fictícios; nos docs, saem.

### 3. Infra → sai inteira

IP da VPS (9 ocorrências), `leo@`, conta Hetzner e CNPJ, nome do container, IP do n8n, DPA
assinado em PDF: tudo em `docs/ops/`, `docs/goals/` e três handoffs. Saem com essas pastas.
O `CLAUDE.md` fica com "VPS (Hetzner, Alemanha, via Coolify)" sem IP nem usuário; o
`Dockerfile` cita "CX33" num comentário (fica: tamanho de máquina não abre porta).

### 4. Pastas que saem para `personal-teacher-os-privado` (repositório privado novo)

| Pasta | Tamanho | Por quê sai | O que o código precisa |
|---|---|---|---|
| `brand/` | 461 arq., 272 MB (fotos de aula geradas, vídeos, logos, 2 prints do Instagram com rosto) | tamanho + imagens de pessoa | o motor de slides por CLI lê a pasta por `PT_BRAND_DIR` (padrão: `../personal-teacher-os-privado/brand`); `src/lib/slides/template.ts` e `scripts/chunks/build-pdf.ts` passam a usar a variável |
| `qa/` | 318 arq., 92 MB (prints com alunos, relatórios, varredura com caminho pessoal) | dado real em imagem | nada: `AJUSTES.md` passa a apontar prints por caminho no privado |
| `content/` | 71 aulas JSON do curso pago | produto vendido na Hotmart | o motor de slides lê `PT_CONTENT_DIR` (mesmo padrão) |
| `docs/ops/`, `docs/goals/`, `docs/research/` (inclui `flexge/`, material raspado de terceiro), `docs/pesquisa*` | 11 MB | infra, história com nomes, terceiro | nada; o `CLAUDE.md` passa a citar o privado para runbook e goals |
| `public/flexge/lesson-library.json` | 393 títulos e links de lições da Flexge (terceiro) | terceiro | **o app LÊ em tempo de execução** (`FlexgeLessonPicker` faz `fetch('/flexge/lesson-library.json')`, e o `proxy.ts` libera o caminho). **Decidido pelo dono em 15/10/2026: fica público** (são títulos e links de um catálogo que a escola assina; sem dado pessoal), com a origem citada num comentário no `FlexgeLessonPicker`. A alternativa (sair para o privado e ler de uma URL configurável) foi descartada |
| `supabase/seed.sql` | — | **não sai**: vira seed fictício (seção 1) | — |

Clone do privado na máquina do dono ao lado do público; `.env.example` documenta as duas
variáveis. Alternativa descartada: submódulo privado dentro do público (cada worktree de
agente precisaria de credencial, e o clone público quebraria).

### 5. Segredos → nada ativo; histórico tratado pelo corte

Varredura de 14/10: nenhum segredo na árvore atual (só JWTs de demonstração do Supabase
local e senhas de bancada `Senha-local-12345`/`Preview-12345`). A rota `/dev-entrar` já
responde 404 em produção (medido em 01/09). O histórico é resolvido pelo repositório novo.

### 6. Issues e PRs → numeração preservada

PRs #1 a #16 (e as que vierem até o corte) e as issues criadas na etapa f: transferir de
privado para público o GitHub não permite, então um script recria. Para `#N` em docs, goals
e mensagens de commit continuar válido, os números usados por PRs e issues fechadas viram
issues-stub fechadas ("número reservado: usado por PR/issue no repositório de origem");
as abertas são recriadas na ordem, com labels e comentários.

### 7. Configuração do repositório público

- Organização `personal-teacher-online` (plano Free); o dono é owner; nenhum outro membro.
- Repositório `personal-teacher-os` na organização. Issues ligadas; Wiki, Projects e
  Discussions desligados. README com "todos os direitos reservados" e sem licença.
- Actions: "Require approval for all outside collaborators"; `GITHUB_TOKEN` somente leitura.
- Ruleset da `main`: só por PR; checks obrigatórios `tsc + lint + suíte` e `vazamento`;
  **fila de merge ligada** (squash; 1 PR por grupo no começo; "só mescla PR sem check
  falhando"; timeout 60 min); sem force push; sem apagar; sem bypass para ninguém.
- Secret scanning + push protection ligados (gratuitos em público); Dependabot alerts.
- Deploy: a **mesma Deploy Key** do Coolify é cadastrada no repositório novo (Settings →
  Deploy keys) e o source do app no Coolify passa a apontar para
  `personal-teacher-online/personal-teacher-os`; um redeploy de prova confirma que o
  container nasceu do commit novo. Sem este passo, o Coolify seguiria o redirecionamento do
  GitHub e puxaria o repositório arquivado em silêncio.

### 8. Guardas permanentes (cada push passa a ser público na hora)

- `scripts/vazamento.py` (adaptado do da dashboard, só biblioteca padrão): CPF/CNPJ com
  dígito válido fora da lista de exceções; e-mail fora de `@exemplo.com`, `@x.com`,
  `@local.dev`, `@bancada.dev` e `contato@personal-teacher.com`; telefone brasileiro real
  (padrão `+55 DD 9XXXX-XXXX` fora das faixas fictícias `9000x`/`99999`); o IP da VPS, o
  usuário SSH e o nome do container (vindos de um secret `PT_INFRA_TERMOS`, nunca do
  código); nomes da lista local `scripts/vazamento-nomes.txt` (não versionada); binário fora
  da lista permitida. Saída mascarada: o log da CI é público.
- Job `vazamento` no `ci.yml` (árvore + cada commit da PR), `gitleaks` fixado por commit, e
  o passo "script, lista de exceções e hooks só mudam com merge do dono".
- `.githooks/pre-commit` chama a varredura em `--staged`; `.githooks/pre-push` novo varre
  commit a commit o que o push envia. O hook de início de sessão já liga `core.hooksPath`.
- `.claude/rules/dados-de-teste.md` (paths: `tests/**`, `supabase/seed.sql`, `docs/**`,
  `prompts/**`): dado de teste é sintético; nunca nome, e-mail, telefone ou documento real;
  dado real mora no privado; achou dado real fora do recorte, registra em Suposições.
- `CLAUDE.md`: regra "repositório público" nas Leis ou na seção "Como o trabalho anda".
- Merge queue exige `merge_group` ao lado de `pull_request` no `ci.yml`.

## Sequência de corte (cada passo é uma PR no privado, pelo fluxo normal)

1. **Preparação no privado:**
   a. `PT_BRAND_DIR`/`PT_CONTENT_DIR` no motor de slides; `SCHOOL_OWNER_NAME`/`CONTENT_HANDLE`;
      telefone de atendimento só por env; `.env.example` atualizado.
   b. ADR do literal nas três migrations + `scripts/anonimizar.ts` com o mapa; aplicado a seed,
      testes, `src/`, prompts, ADRs e regras; suíte no CI como prova; script apagado no fim.
   c. `scripts/vazamento.py`, lista de exceções, job `vazamento` + gitleaks + guarda no
      `ci.yml`, `pre-commit`/`pre-push`, `.claude/rules/dados-de-teste.md`, README.
   d. `merge_group` no `ci.yml` (inofensivo no privado).
2. **Repositório privado novo** `personal-teacher-os-privado`: `git filter-repo` das pastas
   que saem (histórico delas vai junto; é privado) + clone na máquina do dono.
3. **Auditoria final da árvore:** `vazamento.py` em todos os arquivos, `gitleaks detect
   --no-git`, e leitura humana de: `supabase/seed.sql`, `tests/fixtures/`, `.env.example`,
   `scripts/`, `.claude/`, `prompts/`, `docs/decisions/`, `public/`.
4. **Organização** `personal-teacher-online` criada pelo dono (é cadastro em conta: dele).
5. **Renomear** o privado para `personal-teacher-os-arquivo` (fica na conta pessoal) e
   **criar** `personal-teacher-online/personal-teacher-os`, público.
6. **Commit inicial:** branch órfã a partir da árvore limpa (`git checkout --orphan`), um
   commit, push como `main`.
7. Labels, issues (script da seção 6), configurações da seção 7, Deploy Key + source do
   Coolify + redeploy de prova.
8. **Remotes locais:** pasta principal troca `origin` para o público e reaponta `main`
   (`git fetch` + `git checkout -B main origin/main`); worktrees abertas são fechadas antes.
   Mac e Windows do escritório: re-clonar.
9. **Arquivar** o privado. Não apagar. Orçamento provisório do Actions pode voltar a zero.

## Riscos aceitos

- Algo pode escapar da anonimização. Mitigação: varredura automática + leitura humana antes
  do push; depois do push, considerar copiado o que vazou. Se vazar depois, o conserto é
  `filter-repo` + force push + pedido ao suporte do GitHub para purgar; por isso a push
  protection e os hooks existem.
- O desenho do produto, as regras da escola e o processo de aulas ficam visíveis. Decisão de
  14/10, do dono, com a dona.
- O histórico público começa em 2026-10; o anterior fica no privado arquivado.
- A `main` passa um intervalo sem CI (entre o corte e o primeiro push): mitigado fazendo o
  corte com as PRs em dia e nenhuma trabalhadora rodando.

## Pronto quando

- Público no ar, CI verde no commit inicial com `vazamento` passando.
- Coolify redeployado do repositório novo e `app.personal-teacher.com` respondendo.
- `git grep` por nome de pessoa, IP e telefone real na árvore pública: vazio.
- Fila de merge ligada e uma PR de teste passando por ela.
- Privado arquivado; `personal-teacher-os-privado` com `brand/`, `qa/`, `content/` e docs.
