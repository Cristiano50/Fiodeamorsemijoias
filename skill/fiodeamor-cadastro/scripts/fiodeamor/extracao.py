"""Leitura heurística do texto do pedido (funciona sem IA nem PyMuPDF).

Porta de ``src/lib/extracao.ts`` (:func:`ler_linha`, :func:`ler_cabecalho`) e das funções de texto de
``src/lib/pdf-cliente.ts`` (:func:`montar_linhas`, :func:`texto_da_faixa`, :func:`ler_total`).

As expressões regulares imitam as do JavaScript: ``\\d`` lá é só 0–9 e ``\\b`` só considera letras/dígitos ASCII,
por isso aqui aparecem ``[0-9]`` e ``(?![A-Za-z0-9_])``.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

# ------------------------------------------------------------------ linha do pedido

_RE_NUMERO = re.compile(r"[0-9]+(?:[.,][0-9]+)?")
_RE_CJK = re.compile(r"[㐀-鿿]")
_RE_COR_CHINES = re.compile(r"[白蓝粉黑红绿金银油达]")
_RE_CODIGO = re.compile(r"[A-Za-z]{1,6}[0-9]{2,6}[A-Za-z]{0,3}(?:/[A-Za-z0-9]+)?")


def eh_numero(s: str) -> bool:
    """Texto é um número simples (``10``, ``4.5``, ``4,5``)."""
    return _RE_NUMERO.fullmatch(s) is not None


def num(s: str) -> float:
    """Número de um texto com vírgula ou ponto decimal (``Number(s.replace(",", "."))``)."""
    return float(s.replace(",", ".", 1))


def tem_cjk(s: str) -> bool:
    """Tem caractere chinês (faixa U+3400–U+9FFF)."""
    return _RE_CJK.search(s) is not None


def _comprimento_js(s: str) -> int:
    """``String.length`` do JavaScript (conta unidades UTF-16)."""
    return len(s.encode("utf-16-le")) // 2


def ler_linha(texto: str) -> dict:
    """Lê uma linha de pedido de fornecedor (colunas separadas por ``|``).

    Ex.: ``"1 | GSH747A | 耳钉-21# | GSH747A | G | 10 | 12 | 120"`` → código GSH747A, descrição 耳钉-21#,
    especificação G, preço 10, quantidade 12, total 120. Os números só são aceitos quando preço × qtd = total.

    :return: dicionário só com as chaves encontradas, entre ``codigo``, ``descricao``, ``especificacao``,
             ``preco``, ``quantidade`` (int) e ``total``.
    """
    partes = [s.strip() for s in texto.split("|")]
    partes = [s for s in partes if s]
    out: dict = {}

    # Preço × quantidade = total (três números seguidos).
    for i in range(len(partes) - 2):
        a, b, c = partes[i : i + 3]
        if eh_numero(a) and eh_numero(b) and eh_numero(c):
            p, q, t = num(a), num(b), num(c)
            if q.is_integer() and q > 0 and abs(p * q - t) <= max(0.02, t * 0.005):
                out["preco"] = p
                out["quantidade"] = int(q)
                out["total"] = t
                antes = partes[i - 1] if i > 0 else None
                if (
                    antes
                    and not eh_numero(antes)
                    and _comprimento_js(antes) <= 12
                    and not tem_cjk(_RE_COR_CHINES.sub("", antes))
                ):
                    out["especificacao"] = antes
                break

    codigo = next((s for s in partes if _RE_CODIGO.fullmatch(s)), None)
    if codigo:
        out["codigo"] = codigo.upper()
    desc = [s for s in partes if tem_cjk(s) and s != out.get("especificacao")]
    if desc:
        out["descricao"] = " ".join(desc)
    return out


_RE_DATA = re.compile(r"(20[0-9]{2})[-/.年]([0-9]{1,2})[-/.月]([0-9]{1,2})")
_RE_PEDIDO = re.compile(r"(?:单号|订单号|No\.?|Pedido|Order)\s*[:：#]?\s*([A-Za-z0-9-]{4,})", re.IGNORECASE)


def ler_cabecalho(texto: str) -> dict:
    """Procura data (AAAA-MM-DD), número do pedido e moeda no cabeçalho do documento.

    :return: dicionário com as chaves encontradas entre ``data``, ``numero`` e ``moeda`` (CNY | BRL | USD).
    """
    out: dict = {}
    d = _RE_DATA.search(texto)
    if d:
        out["data"] = f"{d.group(1)}-{d.group(2).zfill(2)}-{d.group(3).zfill(2)}"
    n = _RE_PEDIDO.search(texto)
    if n:
        out["numero"] = n.group(1)
    if tem_cjk(texto) or re.search(r"¥|RMB|CNY|元", texto):
        out["moeda"] = "CNY"
    elif "R$" in texto:
        out["moeda"] = "BRL"
    elif re.search(r"US\$|USD", texto):
        out["moeda"] = "USD"
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
