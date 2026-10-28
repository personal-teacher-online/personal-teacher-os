"""Barra dado real no repositorio publico (Fase 2 do corte, passo 1c).

Percorre os arquivos versionados (`git ls-files`) e falha (codigo 1) se achar:
  - CPF ou CNPJ com digito verificador valido fora de `scripts/vazamento-excecoes.txt`;
  - e-mail fora de `@exemplo.com`, `@x.com`, `@local.dev`, `@bancada.dev` e `contato@personal-teacher.com`;
  - telefone brasileiro real (`+55 DD 9XXXX-XXXX`, com ou sem `+`, espacos e hifen; tambem `(DD) 9XXXX-XXXX`)
    fora das faixas ficticias `9000X-XXXX` e `99999-XXXX`;
  - telefone de Portugal (`+351 9XX XXX XXX`) fora da faixa ficticia `+351 900 XXX XXX`;
  - telefone dos EUA (`+1 NNN NNN NNNN`) fora da faixa ficticia `555-01XX`;
  - termo de infraestrutura (IP da VPS, usuario SSH, nome do container) vindo da variavel `PT_INFRA_TERMOS`
    (separados por virgula, ponto e virgula ou quebra de linha; na CI vem de um secret, nos hooks do ambiente do
    dono); sem a variavel a checagem e' pulada com aviso, nunca falha;
  - termo de `scripts/vazamento-nomes.txt` (nomes de pessoas; o arquivo e' local, esta no .gitignore); sem acento,
    sem diferenca de caixa e com `.`, `_`, `-` ou espaco entre as palavras; sem o arquivo a parte e' pulada com aviso;
  - binario fora da lista permitida (`.png`, `.jpg`, `.webp`, `.svg`, `.woff2`, `.ico`, `.pdf` so' em `public/` e
    `brand/`).

A saida traz arquivo, linha e o trecho com o dado MASCARADO (`+55 65 9****-***3`): o log da CI e' publico.

Uso:
  python3 scripts/vazamento.py                   # todos os arquivos de `git ls-files`
  python3 scripts/vazamento.py --staged          # so' os arquivos do commit, lidos do indice (pre-commit)
  python3 scripts/vazamento.py --push < refs     # commits que o push envia, um a um (pre-push le o stdin do git)
  python3 scripts/vazamento.py --base origin/main   # CI da PR: arvore + cada commit da PR

So' biblioteca padrao. Codigos de saida: 0 limpo, 1 achou dado, 2 erro de uso ou de arquivo de lista.
"""
import argparse
import os
import re
import subprocess
import sys
import unicodedata
from functools import cache
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ARQ_EXCECOES = Path(__file__).resolve().parent / "vazamento-excecoes.txt"
ARQ_NOMES = Path(__file__).resolve().parent / "vazamento-nomes.txt"
LIMITE_BYTES = 5_000_000

# `invalid.local`: o login destruido vira `anon-<id>@invalid.local` (src/lib/admin/auth-cleanup.ts).
DOMINIOS_FICTICIOS = frozenset({"exemplo.com", "x.com", "local.dev", "bancada.dev", "invalid.local"})
# JID do WhatsApp (`5565900000001@s.whatsapp.net`) tem forma de e-mail, mas a parte local e' telefone.
# `@lid` fica de fora: RE_EMAIL exige ponto no dominio; LID e' id opaco, e so' o celular BR com 55 e' pego pelo RE_FONE.
# Parte local so' de digitos, com sufixo de aparelho opcional (`5565900000001:12@s.whatsapp.net`).
# Com separador (`-`, `_`, `.`) a forma e' outra (grupo antigo) e cai no tratamento normal de e-mail.
DOMINIOS_JID = frozenset({"s.whatsapp.net", "g.us"})
# O sufixo e' o id de aparelho (1 ou 2 digitos); `%40` e' o `@` de URL; o `+` na frente e a caixa alta valem.
RE_JID = re.compile(r"(?<![\w.+:-])\+?(?P<num>\d+)(?::\d{1,2})?(?:@|%40)(?:s\.whatsapp\.net|g\.us)(?![\w-])",
                    re.IGNORECASE)
RE_PLACEHOLDER_DIGITOS = re.compile(r"<(?P<num>\d+)>$")
RE_PLACEHOLDER = re.compile(r"<[^<>\d]*>$")
# Numero brasileiro de JID: 55 + DDD + assinante de 8 ou 9 digitos (o 9 inicial as vezes falta).
RE_JID_BR = re.compile(r"55\d{2}(9?\d{8})")
# `logo@2x.png` tem a forma de um e-mail: dominio cujo ultimo trecho e' extensao de arquivo nao e' e-mail.
EXTENSOES_DE_ARQUIVO = frozenset({
    "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif", "woff", "woff2", "ttf", "otf", "css", "js", "mjs",
    "cjs", "ts", "tsx", "jsx", "json", "html", "map", "mp4", "webm", "pdf",
})

BINARIOS_PERMITIDOS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".woff2", ".ico"})
# Imagem e PDF so' nestas pastas: print em docs/ ou tests/ pode trazer dado de aluno e entraria no publico.
BINARIOS_SO_EM = ("public/", "brand/", "src/")
PDF_SO_EM = ("public/", "brand/")

SEP = r"[\s. /-]?"
# Nome de migration (`20260727000900`): 14 digitos que comecam por uma data valida. Com digito verificador ao acaso
# (1 em 100) parece CNPJ, e os docs citam migrations o tempo todo.
RE_TIMESTAMP = re.compile(r"20[2-3]\d(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{6}")
RE_CNPJ = re.compile(rf"(?<!\w)\d{{2}}{SEP}\d{{3}}{SEP}\d{{3}}{SEP}\d{{4}}{SEP}\d{{2}}(?!\w)")
# CNPJ alfanumerico (Receita, 2026): so' com a pontuacao completa, para nao confundir com identificador qualquer.
RE_CNPJ_ALFA = re.compile(r"(?<![0-9A-Za-z])[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}/[0-9A-Z]{4}-\d{2}(?!\d)")
# CPF: ponto ou espaco entre os grupos e, antes dos 2 digitos finais, tambem hifen. Hifen e barra entre os grupos
# nao entram: casariam com data e hora, e o digito verificador sozinho deixa passar 1 em cada 100.
# Fora de numero decimal (`0.0001234567890`): sem `.`/`,` colado antes nem `.`/`,` + numero depois.
RE_CPF = re.compile(r"(?<![\w.,])\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s.-]?\d{2}(?!\w|[.,]\d)")
# e-mail, `@dominio` sem nada antes e a forma codificada de URL (`nome%40dominio`)
RE_EMAIL = re.compile(r"([A-Za-z0-9._+-]*)(?:@|%40)([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)")
# Celular brasileiro: com 55 (opcionalmente com `+`), com o DDD entre parenteses ou `DD 9XXXX-XXXX` (com hifen). O 9 inicial do assinante e'
# obrigatorio; os 4 digitos seguintes e os 4 finais podem ter hifen ou espaco no meio.
RE_FONE = re.compile(
    r"(?<![\w+])(?:\+?55[\s.-]?\(?0?(?P<ddd1>\d{2})\)?|\(0?(?P<ddd2>\d{2})\)"
    r"|0?(?P<ddd3>\d{2})(?=\s9\d{4}[\s-]\d{4}))[\s.-]?"
    r"(?P<a>9[ ]?\d{4})[\s.-]?(?P<b>\d{4})(?!\d)"
)
# Celular de Portugal (9 digitos em qualquer agrupamento; a faixa 900 e' ficticia) e dos EUA (+1 NNN NNN NNNN; a faixa 555 e' ficticia): lacuna que o
# fuso de Lisboa e Orlando dos alunos abre.
# Os 9 digitos aceitam separador (espaco, ponto, hifen, parenteses) entre quaisquer dois, e o prefixo e' `+351` ou `00351 ` (com separador obrigatorio depois: senao casa CNPJ e float colados).
RE_FONE_PT = re.compile(r"(?:(?<![\w+])\+351[\s.-]?|(?<![\w+])00351[\s.-])\(?(?P<n>9(?:[\s.()-]{0,2}\d){8})(?!\d)")
RE_FONE_US = re.compile(r"(?<![\w+])\+1[\s.-]?\(?(?P<ac>\d{3})\)?[\s.-]?(?P<ex>\d{3})[\s.-]?(?P<fim>\d{4})(?!\d)")
# Provedores de e-mail genericos: so' neles o dominio aparece no log (o de empresa expõe o empregador).
PROVEDORES = frozenset({"gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.com.br", "icloud.com",
                        "live.com", "uol.com.br", "bol.com.br", "terra.com.br", "proton.me", "protonmail.com"})


def so_digitos(texto: str) -> str:
    return re.sub(r"\D", "", texto)


def normalizar_cnpj(texto: str) -> str:
    return re.sub(r"[^0-9A-Z]", "", texto.upper())


def cnpj_valido(caracteres: str) -> bool:
    """`caracteres` = os 14 sem pontuacao (12 de letras ou numeros + 2 digitos verificadores)."""
    if not re.fullmatch(r"[0-9A-Z]{12}\d{2}", caracteres) or len(set(caracteres)) == 1:
        return False
    nums = [ord(d) - 48 for d in caracteres]
    for tam, pesos in ((12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]), (13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])):
        resto = sum(n * p for n, p in zip(nums[:tam], pesos)) % 11
        if nums[tam] != (0 if resto < 2 else 11 - resto):
            return False
    return True


def cpf_valido(digitos: str) -> bool:
    if len(digitos) != 11 or len(set(digitos)) == 1:
        return False
    nums = [int(d) for d in digitos]
    for tam in (9, 10):
        resto = sum(n * p for n, p in zip(nums[:tam], range(tam + 1, 1, -1))) * 10 % 11
        if nums[tam] != (0 if resto == 10 else resto):
            return False
    return True


def fone_ficticio(a: str) -> bool:
    """Faixas ficticias: `9000X-XXXX` e `99999-XXXX` (a = os 5 primeiros digitos do assinante)."""
    a = so_digitos(a)
    return a.startswith("9000") or a == "99999"


def mascarar(dado: str, mostrar: int = 6) -> str:
    """Mostra so' o comeco (`01.318.***`); nunca o dado inteiro."""
    return dado[:min(mostrar, max(len(dado) - 1, 0))] + "***"


def sem_acento(texto: str) -> str:
    """Tira o acento caractere a caractere, mantendo o tamanho (os indices continuam valendo no texto original)."""
    return "".join(unicodedata.normalize("NFKD", c)[0] for c in texto)


class Excecoes:
    """Valores aceitos. Uma entrada por linha, `#` comenta.

    - CPF e CNPJ (em qualquer formatacao, comparados so' pelos digitos);
    - e-mail inteiro ou `@dominio` aceitam o e-mail / todos do dominio;
    - qualquer outro texto literal (ex.: "Teacher Vicky") vale como termo liberado: o trecho e' ignorado pelo
      scanner de nomes.
    Dado REAL de pessoa nunca entra aqui. Mudar a lista exige merge do dono (o job `vazamento` falha na PR que a
    altera).
    """

    def __init__(self):
        self.documentos = set()
        self.emails = set()
        self.dominios = set(DOMINIOS_FICTICIOS)
        self.termos = []

    @classmethod
    def de_texto(cls, texto: str, origem: str = "vazamento-excecoes.txt") -> "Excecoes":
        exc = cls()
        for n, bruta in enumerate(texto.splitlines(), 1):
            linha = bruta.split("#", 1)[0].strip()
            if not linha:
                continue
            digitos = so_digitos(linha)
            if "@" in linha:
                (exc.dominios if linha.startswith("@") else exc.emails).add(linha.lstrip("@").lower())
            elif len(digitos) in (11, 14) and re.fullmatch(r"[\d./\- ]+", linha):
                exc.documentos.add(digitos)
            elif re.fullmatch(r"[\w .-]+", linha):
                exc.termos.append(sem_acento(linha).lower())
            else:
                raise ValueError(f"{origem}:{n}: entrada nao reconhecida (CPF, CNPJ, e-mail, @dominio ou termo)")
        return exc

    @classmethod
    def ler(cls, caminho: Path) -> "Excecoes":
        if not caminho.exists():
            return cls()
        return cls.de_texto(caminho.read_text(encoding="utf-8"), caminho.name)

    def libera_email(self, email: str, dominio: str) -> bool:
        return email.lower() in self.emails or dominio.lower() in self.dominios

    def trechos_liberados(self, normal: str) -> list:
        """Posicoes (inicio, fim) dos termos liberados numa linha ja' sem acento ("Teacher Vicky")."""
        return [m.span() for termo in self.termos for m in _termo(termo).finditer(normal)]


def caminhos_nomes() -> list:
    """Onde procurar a lista local: ao lado do script e na pasta principal do repositorio. Numa worktree o
    arquivo (gitignorado) so' existe na pasta principal; `--git-common-dir` aponta para o `.git` dela."""
    caminhos = [ARQ_NOMES]
    try:
        comum = _git("rev-parse", "--path-format=absolute", "--git-common-dir").decode().strip()
        caminhos.append(Path(comum).parent / "scripts" / ARQ_NOMES.name)
    except (OSError, subprocess.CalledProcessError):
        pass
    return caminhos


def ler_termos(caminhos, ambiente: str = "") -> list:
    """Lista de nomes de pessoas, um por linha (`#` comenta). Soma os arquivos locais e o texto de
    `PT_NOMES_PROIBIDOS` (mesmo formato; e' como a lista chega na CI). Nada disso existindo devolve vazio."""
    termos = []
    fontes = [c.read_text(encoding="utf-8") for c in caminhos if c.exists()]
    fontes.append(ambiente)
    for texto in fontes:
        for bruta in texto.splitlines():
            termo = bruta.split("#", 1)[0].strip()
            if re.search(r"\w", termo) and termo not in termos:
                termos.append(termo)
    return termos


def termos_de_infra(valor: str) -> list:
    return [t.strip() for t in re.split(r"[,;\n]", valor) if re.search(r"\w", t)]


def _email_proibido(dominio: str) -> bool:
    dominio = dominio.lower().rstrip(".")
    if dominio.startswith("127."):  # `usuario:senha@127.0.0.1`: loopback, nao e' e-mail nem a VPS
        return False
    if dominio.rsplit(".", 1)[-1] in EXTENSOES_DE_ARQUIVO:
        return False
    return dominio not in DOMINIOS_FICTICIOS


@cache
def _termo(termo: str):
    """Palavras do termo unidas por espaco, `.`, `_` ou `-`, sem acento e sem diferenca de caixa."""
    palavras = [p for p in re.split(r"[\s._-]+", sem_acento(termo).strip()) if p]
    return re.compile(r"(?<![A-Za-z0-9])" + r"[\s._-]+".join(map(re.escape, palavras)) + r"(?![A-Za-z0-9])",
                      re.IGNORECASE)


def achar(texto: str, excecoes: Excecoes, termos=(), infra=()) -> list:
    """Achados de UMA linha: lista de (inicio, fim, tipo, mascara), sem sobreposicao.

    O que as excecoes liberam entra com `tipo` None: nao e' relatado, mas o trecho impresso o mascara tambem.
    """
    achados = []

    def aceita(inicio, fim, tipo, mascara):
        achados.append((inicio, fim, tipo, mascara))

    for regex in (RE_CNPJ, RE_CNPJ_ALFA):
        for m in regex.finditer(texto):
            c = normalizar_cnpj(m.group())
            if cnpj_valido(c) and not RE_TIMESTAMP.fullmatch(m.group()):
                liberado = c in excecoes.documentos
                aceita(m.start(), m.end(), None if liberado else "CNPJ valido",
                       mascarar(m.group(), 7 if "." in m.group() else 6))
    for m in RE_CPF.finditer(texto):
        d = so_digitos(m.group())
        if cpf_valido(d):
            liberado = d in excecoes.documentos
            aceita(m.start(), m.end(), None if liberado else "CPF valido", mascarar(m.group(), 3))
    spans_jid = []

    def jid(ini, fim, num, dominio_jid):
        # so' o Brasil tem faixa ficticia: numero de outro pais e' sempre telefone real
        br = RE_JID_BR.fullmatch(num)
        if br and fone_ficticio(("9" + br.group(1))[-9:][:5]):
            aceita(ini, fim, None, texto[ini:fim])
        else:
            aceita(ini, fim, "telefone real", f"***{num[-1]}@{dominio_jid}")

    for m in RE_JID.finditer(texto):
        spans_jid.append(m.span())
        jid(m.start(), m.end(), m.group("num"), m.group().lower().rsplit("@", 1)[-1].rsplit("%40", 1)[-1])
    for m in RE_EMAIL.finditer(texto):
        local, dominio = m.group(1), m.group(2).lower()
        if any(ini <= m.start() < fim for ini, fim in spans_jid):
            continue  # tratado como JID acima
        if dominio in DOMINIOS_JID and not local:
            antes = texto[:m.start()]
            dentro = RE_PLACEHOLDER_DIGITOS.search(antes)
            if dentro:  # numero entre os sinais (`<NNN...>@dominio`)
                jid(dentro.start(), m.end(), dentro.group("num"), dominio)
                continue
            if RE_PLACEHOLDER.search(antes):
                continue  # `<numero>@s.whatsapp.net` em doc: placeholder sem digito
        if _email_proibido(dominio):
            liberado = excecoes.libera_email(f"{local}@{dominio}", dominio)
            # IP no lugar do dominio (`usuario@IP`, SSH): o log e' publico, entao o IP tambem sai mascarado.
            alvo = "***" if dominio.replace(".", "").isdigit() else m.group(2) if dominio in PROVEDORES else "***." + dominio.rsplit(".", 1)[-1]
            aceita(m.start(), m.end(), None if liberado else "e-mail real", local[:2] + "***@" + alvo)
    for m in RE_FONE.finditer(texto):
        if fone_ficticio(m.group("a")):
            continue
        ddd = m.group("ddd1") or m.group("ddd2") or m.group("ddd3")
        aceita(m.start(), m.end(), "telefone real", f"+55 {ddd} 9****-***{m.group('b')[-1]}")
    for m in RE_FONE_PT.finditer(texto):
        if so_digitos(m.group("n")).startswith("900"):
            continue
        aceita(m.start(), m.end(), "telefone real", f"+351 9****-***{so_digitos(m.group('n'))[-1]}")
    for m in RE_FONE_US.finditer(texto):
        if not (m.group("ex") == "555" and m.group("fim").startswith("01")):
            aceita(m.start(), m.end(), "telefone real", f"+1 ***-***-***{m.group('fim')[-1]}")
    if infra or termos:
        normal = sem_acento(texto)
        liberados = excecoes.trechos_liberados(normal)
        for termo in infra:
            for m in _termo(termo).finditer(normal):
                aceita(m.start(), m.end(), "termo de infraestrutura (PT_INFRA_TERMOS)",
                       mascarar(texto[m.start():m.end()], 2))
        for termo in termos:
            for m in _termo(termo).finditer(normal):
                # nome que cai dentro de um termo liberado ("Vicky" em "Teacher Vicky") nao e' relatado
                liberado = any(ini <= m.start() and m.end() <= fim for ini, fim in liberados)
                aceita(m.start(), m.end(), None if liberado else "nome de pessoa da lista local",
                       mascarar(texto[m.start():m.end()], 2))

    # sem sobreposicao: o mais comprido primeiro; em empate, o que sera' relatado antes do silencioso
    achados.sort(key=lambda a: (a[0], -(a[1] - a[0]), a[2] is None))
    limpos, fim_anterior = [], 0
    for a in achados:
        if a[0] >= fim_anterior:
            limpos.append(a)
            fim_anterior = a[1]
    return limpos


def trecho(linha: str, achados: list, i: int, folga: int = 25) -> str:
    """Janela em volta do achado `i`, com TODOS os achados da linha trocados pela mascara."""
    pedacos, pos, inicio_mascarado = [], 0, 0
    for k, (ini, fim, _tipo, mascara) in enumerate(achados):
        pedacos.append(linha[pos:ini])
        if k == i:
            inicio_mascarado = sum(len(p) for p in pedacos)
        pedacos.append(mascara)
        pos = fim
    pedacos.append(linha[pos:])
    mascarada = "".join(pedacos)
    fim_mascarado = inicio_mascarado + len(achados[i][3])
    return mascarada[max(0, inicio_mascarado - folga):fim_mascarado + folga].strip()


def varrer(nome: str, conteudo: str, excecoes: Excecoes, termos=(), infra=()) -> list:
    """Achados de um arquivo: lista de (arquivo, linha, tipo, trecho mascarado)."""
    saida = []
    for numero, linha in enumerate(conteudo.splitlines(), 1):
        achados = achar(linha, excecoes, termos, infra)
        for i, (_ini, _fim, tipo, _mascara) in enumerate(achados):
            if tipo is None:
                continue
            saida.append((nome, numero, tipo, trecho(linha, achados, i)))
    return saida


def conteudos(nome: str, dados: bytes):
    """Textos a varrer de um arquivo: itens (nome, texto, None). Um item (nome, None, motivo) e' arquivo que a
    varredura nao consegue ler e que, por isso, falha em vez de passar em silencio. SVG e' texto: e' varrido."""
    ext = Path(nome).suffix.lower()
    if ext in BINARIOS_PERMITIDOS and nome.startswith(BINARIOS_SO_EM):
        return
    if ext == ".pdf" and nome.startswith(PDF_SO_EM):
        return
    if b"\0" in dados[:8000]:
        yield nome, None, f"binario fora da lista permitida ({ext or 'sem extensao'})"
    elif len(dados) > LIMITE_BYTES:
        yield nome, None, "arquivo grande demais para varrer"
    else:
        yield nome, dados.decode("utf-8", errors="replace"), None


def _git(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=RAIZ, check=True, capture_output=True).stdout


def arquivos_alvo(staged: bool) -> list:
    if staged:
        bruto = _git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    else:
        bruto = _git("ls-files", "-z")
    return [n for n in bruto.decode("utf-8").split("\0") if n]


def ler_bytes(nome: str, staged: bool):
    """Bytes do arquivo (do indice no pre-commit, do disco nos demais); None se sumiu."""
    try:
        return _git("show", ":" + nome) if staged else (RAIZ / nome).read_bytes()
    except (OSError, subprocess.CalledProcessError):
        return None


def excecoes_do_modo(staged: bool) -> Excecoes:
    """No pre-commit a lista vem do indice (o que vai no commit), nao do disco."""
    rel = ARQ_EXCECOES.relative_to(RAIZ).as_posix()
    if staged:
        dados = ler_bytes(rel, True)
        return Excecoes.de_texto(dados.decode("utf-8"), ARQ_EXCECOES.name) if dados is not None else Excecoes()
    return Excecoes.ler(ARQ_EXCECOES)


def excecoes_de_ref(ref: str) -> Excecoes:
    """Lista de excecoes como esta' commitada em `ref` (vazia se nao existe la')."""
    rel = ARQ_EXCECOES.relative_to(RAIZ).as_posix()
    try:
        return Excecoes.de_texto(_git("show", f"{ref}:{rel}").decode("utf-8"), ARQ_EXCECOES.name)
    except subprocess.CalledProcessError:
        return Excecoes()


def revs_do_push(linhas, remoto_nome: str = "") -> list:
    """Do stdin do pre-push (`<ref local> <sha local> <ref remoto> <sha remoto>`) tira, por ref, os argumentos do
    `git rev-list` com os commits que o push envia: so' o que nem o remoto da ref nem nenhum outro remoto ja' tem.
    Ref apagada nao envia nada."""
    revs = []
    for linha in linhas:
        partes = linha.split()
        if len(partes) < 4 or set(partes[1]) == {"0"}:
            continue
        local, remoto = partes[1], partes[3]
        conhecido = set(remoto) != {"0"} and subprocess.run(
            ["git", "cat-file", "-e", remoto + "^{commit}"], cwd=RAIZ, capture_output=True, check=False
        ).returncode == 0
        # Exclui so' o que o remoto de destino ja' tem (`--remotes=NOME`): commit que esta' so' num outro remoto
        # (o repositorio privado, por exemplo) ainda nao e' publico e tem que ser varrido.
        revs.append([local, "--not", *([remoto] if conhecido else []), f"--remotes={remoto_nome}" if remoto_nome
                     else "--remotes"])
    return revs


def achados_dos_commits(revs: list, excecoes: Excecoes, termos, infra) -> list:
    """Varre, commit a commit, os arquivos que cada um tocou, na versao daquele commit: dado que entrou num commit e
    saiu no seguinte continua no historico publicado. Num commit de merge so' entram os arquivos que diferem dos dois
    pais (`--cc`: resolucao de conflito); o resto do merge e' de commits que ja' sao varridos ou ja' estao no remoto."""
    achados = []
    for rev in revs:
        linhas = _git("rev-list", "--parents", "--reverse", *rev).decode().splitlines()
        for linha in linhas:
            sha, *pais = linha.split()
            if len(pais) > 1:
                comando = ["diff-tree", "--cc", "-r", "--no-commit-id", "--name-only", "-z", sha]
            else:
                comando = ["diff-tree", "--root", "-r", "--no-renames", "--no-commit-id", "--diff-filter=ACMRT",
                           "--name-only", "-z", sha]
            nomes = _git(*comando).decode("utf-8").split("\0")
            for nome in (n for n in nomes if n):
                try:
                    dados = _git("show", f"{sha}:{nome}")
                except subprocess.CalledProcessError:
                    continue
                achados += _achados_do_arquivo(f"{nome}@{sha[:8]}", nome, dados, excecoes, termos, infra)
            # Mensagem do commit vai para o historico publico tambem. Autor e committer (nome e e-mail) ficam
            # de fora de proposito (o nome do dono entra na lista de nomes e travaria todo push): antes do corte o dono troca user.name e user.email (docs/ops/fase2/remotes.md).
            meta = _git("log", "-1", "--format=%B", sha).decode("utf-8", errors="replace")
            achados += varrer(f"[mensagem]@{sha[:8]}", meta, excecoes, termos, infra)
    return achados


def _achados_do_arquivo(rotulo: str, nome: str, dados: bytes, excecoes, termos, infra) -> list:
    achados = []
    for sub, texto, motivo in conteudos(nome, dados):
        sub = rotulo + sub[len(nome):]
        if texto is None:
            achados.append((sub, 0, motivo, ""))
        else:
            achados += varrer(sub, texto, excecoes, termos, infra)
    return achados


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--staged", action="store_true", help="so' os arquivos do commit (pre-commit)")
    ap.add_argument("--push", action="store_true",
                    help="le do stdin as refs do pre-push e varre os commits que o push envia")
    ap.add_argument("--remote", metavar="NOME", default="",
                    help="com --push: nome do remoto de destino (o pre-push recebe como primeiro argumento)")
    ap.add_argument("--base", metavar="REF",
                    help="CI da PR: alem da arvore, varre cada commit de REF..HEAD")
    args = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    try:
        excecoes = excecoes_de_ref("HEAD") if args.push else excecoes_do_modo(args.staged)
    except ValueError as erro:
        print(f"vazamento: {erro}", file=sys.stderr)
        return 2
    termos = ler_termos(caminhos_nomes(), os.environ.get("PT_NOMES_PROIBIDOS", ""))
    if not termos:
        print("vazamento: lista de nomes ausente, parte pulada", file=sys.stderr)
    infra = termos_de_infra(os.environ.get("PT_INFRA_TERMOS", ""))
    if not infra:
        print("vazamento: sem PT_INFRA_TERMOS, checagem de IP, usuario e container da VPS pulada", file=sys.stderr)

    achados = []
    try:
        if args.push:
            achados += achados_dos_commits(revs_do_push(sys.stdin, args.remote), excecoes, termos, infra)
        else:
            for nome in arquivos_alvo(args.staged):
                dados = ler_bytes(nome, args.staged)
                if dados is not None:
                    achados += _achados_do_arquivo(nome, nome, dados, excecoes, termos, infra)
            if args.base:
                achados += achados_dos_commits([[f"{args.base}..HEAD"]], excecoes, termos, infra)
    except subprocess.CalledProcessError as erro:
        print(f"vazamento: git falhou ({' '.join(map(str, erro.cmd[:4]))}...)", file=sys.stderr)
        return 2
    for arquivo, linha, tipo, pedaco in achados:
        print(f"{arquivo}:{linha}: {tipo}: ...{pedaco}..." if linha else f"{arquivo}: {tipo}")
    if achados:
        print(f"vazamento: {len(achados)} achado(s). Troque por dado ficticio; se for ficticio de proposito, "
              "ponha na lista scripts/vazamento-excecoes.txt (mudanca na lista exige merge do dono).",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
