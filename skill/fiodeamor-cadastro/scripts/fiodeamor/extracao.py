"""Leitura heurística do texto do pedido (funciona sem IA nem PyMuPDF).

Porta de ``src/lib/extracao.ts`` (:func:`ler_linha`, :func:`ler_cabecalho`) e das funções de texto de
``src/lib/pdf-cliente.ts`` (:func:`montar_linhas`, :func:`texto_da_faixa`, :func:`ler_total`).

As expressões regulares imitam as do JavaScript: ``\\d`` lá é só 0–9 e ``\\b`` só considera letras/dígitos ASCII,
por isso aqui aparecem ``[0-9]`` e ``(?![A-Za-z0-9_])``.
"""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass

from .numeros import ESPACOS_JS, ler_numero_br, trim_js

# ------------------------------------------------------------------ linha do pedido

_RE_NUMERO = re.compile(r"[0-9]+(?:[.,][0-9]+)?")
# Ideogramas (U+3400–U+9FFF) e ideogramas de compatibilidade (U+F900–U+FAFF), escritos com escapes
# (o 豈 de compatibilidade, U+F900, é idêntico na tela ao 豈 comum, U+8C48).
_RE_CJK = re.compile("[\u3400-\u9fff\uf900-\ufaff]")
_RE_CODIGO = re.compile(r"[A-Za-z]{1,6}[0-9]{2,6}[A-Za-z]{0,3}(?:/[A-Za-z0-9]+)?")

# Tamanho máximo da especificação: texto latino (G, MR, 14KF, ROSE GOLD…) e texto com chinês (金色, 玫瑰金, MR白油…).
MAX_ESPECIFICACAO_LATINA = 16
MAX_ESPECIFICACAO_CHINES = 12


def eh_numero(s: str) -> bool:
    """Texto é um número simples (``10``, ``4.5``, ``4,5``)."""
    return _RE_NUMERO.fullmatch(s) is not None


def num(s: str) -> float:
    """Número de uma célula da tabela, com vírgula ou ponto decimal (``lerNumeroBr`` sem milhar).

    Para os textos aceitos por :func:`eh_numero` é o mesmo que ``Number(s.replace(",", "."))`` do app.
    """
    n = ler_numero_br(s, milhar=False)
    return math.nan if n is None else n


def tem_cjk(s: str) -> bool:
    """Tem caractere chinês (faixas U+3400–U+9FFF e U+F900–U+FAFF)."""
    return _RE_CJK.search(s) is not None


def _tamanho(s: str) -> int:
    """Quantidade de caracteres, como ``Array.from(s).length`` no app (um caractere chinês = 1)."""
    return len(s)


def _especificacao(partes: list[str], j: int, codigo: str | None) -> str | None:
    """Especificação/cor do fornecedor: a célula ``partes[j]``, logo antes do trio preço × quantidade = total.

    Regra (tests/vetores/especificacao.json, igual ao app):
      * não é especificação se for a 1ª célula (a sequência), o próprio código repetido ou a descrição
        (texto com caractere chinês sem outra célula de texto antes dela);
      * número vale (tamanho: 16, 17.5); texto latino vale até 16 caracteres (G, MR, 14KF);
      * texto com caractere chinês vale até 12 caracteres quando há uma descrição antes (金色, 玫瑰金, 18号, MR白油).
    """
    if j < 1:
        return None
    antes = partes[j]
    if codigo and antes.upper() == codigo:
        return None
    if eh_numero(antes):
        return antes
    if not tem_cjk(antes):
        return antes if _tamanho(antes) <= MAX_ESPECIFICACAO_LATINA else None
    # "Célula de texto" = nem número nem o código: a descrição da peça, quando existe.
    descricao_antes = any(not eh_numero(s) and not (codigo and s.upper() == codigo) for s in partes[:j])
    if not descricao_antes:
        return None  # a célula é a própria descrição
    return antes if _tamanho(antes) <= MAX_ESPECIFICACAO_CHINES else None


def ler_linha(texto: str) -> dict:
    """Lê uma linha de pedido de fornecedor (colunas separadas por ``|``).

    Ex.: ``"1 | GSH747A | 耳钉-21# | GSH747A | G | 10 | 12 | 120"`` → código GSH747A, descrição 耳钉-21#,
    especificação G, preço 10, quantidade 12, total 120. Os números só são aceitos quando preço × qtd = total.
    A especificação segue :func:`_especificacao` (sem especificação, a chave não aparece). Letras e números de
    largura total (ＡＢＣ１２３) viram ASCII antes da leitura (NFKC, como no app).

    :return: dicionário só com as chaves encontradas, entre ``codigo``, ``descricao``, ``especificacao``,
             ``preco``, ``quantidade`` (int) e ``total``.
    """
    partes = [trim_js(s) for s in unicodedata.normalize("NFKC", texto).split("|")]
    partes = [s for s in partes if s]
    out: dict = {}

    codigo = next((s for s in partes if _RE_CODIGO.fullmatch(s)), None)
    codigo = codigo.upper() if codigo else None

    # Preço × quantidade = total (três números seguidos).
    for i in range(len(partes) - 2):
        a, b, c = partes[i : i + 3]
        if eh_numero(a) and eh_numero(b) and eh_numero(c):
            p, q, t = num(a), num(b), num(c)
            if q.is_integer() and q > 0 and abs(p * q - t) <= max(0.02, t * 0.005):
                out["preco"] = p
                out["quantidade"] = int(q)
                out["total"] = t
                esp = _especificacao(partes, i - 1, codigo)
                if esp:
                    out["especificacao"] = esp
                break

    if codigo:
        out["codigo"] = codigo
    desc = [s for s in partes if tem_cjk(s) and s != out.get("especificacao")]
    if desc:
        out["descricao"] = " ".join(desc)
    return out


_RE_DATA = re.compile(r"(20[0-9]{2})[-/.年]([0-9]{1,2})[-/.月]([0-9]{1,2})")
_S = f"[{ESPACOS_JS}]"  # \s do JavaScript
# re.ASCII: o "i" e o \b do JavaScript só olham letras e números ASCII.
_RE_PEDIDO = re.compile(rf"(?:单号|订单号|No\.?|Pedido|Order){_S}*[:：#]?{_S}*([A-Za-z0-9-]{{4,}})", re.I | re.A)

# Marcas de moeda, em ordem de prioridade (tests/vetores/cabecalho.json): dólar > real > yuan.
MARCAS_MOEDA: tuple[tuple[str, re.Pattern], ...] = (
    ("USD", re.compile(r"US\$|\bUSD\b|美元|美金", re.I | re.A)),
    ("BRL", re.compile(r"R\$|\bBRL\b|雷亚尔", re.I | re.A)),
    ("CNY", re.compile(r"[¥￥]|\bRMB\b|\bCNY\b|人民币|元", re.I | re.A)),
)


def ler_moeda(texto: str) -> str | None:
    """Moeda pelas marcas do documento: USD (USD, US$, 美元, 美金) > BRL (R$, BRL, 雷亚尔) >
    CNY (¥/￥, RMB, CNY, 人民币, 元). Sem marca → ``None`` (não adivinha pelo chinês: a skill avisa e pergunta)."""
    return next((moeda for moeda, rx in MARCAS_MOEDA if rx.search(texto)), None)


def ler_cabecalho(texto: str) -> dict:
    """Procura data (AAAA-MM-DD), número do pedido e moeda no cabeçalho do documento (porta de ``lerCabecalho``).

    :return: dicionário com ``moeda`` (CNY | BRL | USD, ou ``None`` sem marca de moeda no texto) e, quando
             encontrados, ``data`` e ``numero``.
    """
    out: dict = {}
    d = _RE_DATA.search(texto)
    if d:
        out["data"] = f"{d.group(1)}-{d.group(2).zfill(2)}-{d.group(3).zfill(2)}"
    n = _RE_PEDIDO.search(texto)
    if n:
        out["numero"] = n.group(1)
    out["moeda"] = ler_moeda(texto)
    return out


# ------------------------------------------------------------------ total do documento

_RE_TOTAL = re.compile(r"(?:应收|应付|Total\s*(?:geral|a pagar)?|TOTAL)\s*[:：]?\s*(?:¥|R\$|US\$)?\s*([0-9.,]+)")
_RE_MILHAR = re.compile(r",(?=[0-9]{3}(?![A-Za-z0-9_]))")


def _numero_ou_none(s: str) -> float | None:
    """``Number(s)`` do JavaScript; ``None`` no lugar de NaN."""
    try:
        v = float(s)
    except ValueError:
        return None
    return None if math.isnan(v) else v


def ler_total(texto: str) -> float | None:
    """Total impresso no documento (应收/应付/Total…, ou o último número da linha 合计)."""
    m = _RE_TOTAL.search(texto)
    if m:
        return _numero_ou_none(_RE_MILHAR.sub("", m.group(1)).replace(",", ".", 1))
    soma = re.search(r"合计[^\n]*", texto)
    if soma:
        nums = re.findall(r"[0-9]+(?:\.[0-9]+)?", soma.group(0))
        if nums:
            return _numero_ou_none(nums[-1])
    return None


# ------------------------------------------------------------------ trechos de texto e faixas


@dataclass
class Trecho:
    """Trecho de texto na página (coordenadas da tela: origem no topo, escala 1)."""

    x: float
    xc: float  # centro horizontal (células de tabela costumam ser centralizadas)
    y_topo: float
    y_base: float
    texto: str


@dataclass
class Caixa:
    """Retângulo na página (coordenadas da tela: origem no topo, escala 1)."""

    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def largura(self) -> float:
        return self.x1 - self.x0

    @property
    def altura(self) -> float:
        return self.y1 - self.y0


def montar_linhas(trechos: list[Trecho]) -> list[str]:
    """Junta trechos em linhas de leitura (mesma altura, tolerância 3) e separa colunas com ``" | "``."""
    ordenados = sorted(trechos, key=lambda t: (t.y_base, t.x))
    linhas: list[list[Trecho]] = []
    for t in ordenados:
        if linhas and abs(linhas[-1][0].y_base - t.y_base) < 3:
            linhas[-1].append(t)
        else:
            linhas.append([t])
    return [" | ".join(t.texto for t in sorted(l, key=lambda t: t.x)) for l in linhas]


def texto_da_faixa(trechos: list[Trecho], c: Caixa) -> str:
    """Texto de uma linha da tabela: os trechos dentro da faixa vertical da imagem, agrupados por coluna (x).

    Trechos com centro horizontal a menos de 18 pt do primeiro da coluna (quebras de linha dentro da célula)
    são unidos de cima para baixo; as colunas são separadas por ``" | "``.
    """

    def centro(t: Trecho) -> float:
        return (t.y_topo + t.y_base) / 2

    dentro = [t for t in trechos if c.y0 - 2 <= centro(t) <= c.y1 + 2]
    if not dentro:
        return ""
    colunas: list[list[Trecho]] = []
    for t in sorted(dentro, key=lambda t: (t.xc, t.y_base)):
        col = next((cl for cl in colunas if abs(cl[0].xc - t.xc) < 18), None)
        if col is not None:
            col.append(t)
        else:
            colunas.append([t])
    return " | ".join(
        "".join(t.texto for t in sorted(cl, key=lambda t: t.y_base)) for cl in sorted(colunas, key=lambda cl: cl[0].xc)
    )
