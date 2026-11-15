"""Números escritos como texto, do jeito brasileiro ou não — porta de ``src/lib/numeros.ts`` do app.

    ler_numero_br("850,50") → 850.5      ler_numero_br("1.234,56") → 1234.56
    ler_numero_br("850.50") → 850.5      ler_numero_br("1,234.56") → 1234.56
    ler_numero_br("850.5")  → 850.5      ler_numero_br("R$ 1.234") → 1234 (milhar)
    ler_numero_br("0,7745") → 0.7745     ler_numero_br("0.775", milhar=False) → 0.775

Regras (as mesmas do app):
    * vírgula ou ponto podem ser o decimal; com os dois, o último é o decimal ("1.234,56", "1,234.56");
    * ponto sozinho só é milhar no formato 1.234 / 12.345.678 e só com ``milhar=True`` (padrão, para dinheiro);
      "850.5", "850.50", "0.775" e "3.1415" são decimais. Cotação e fator: use ``milhar=False``;
    * "R$", "US$", "¥", "CN¥", "RMB" e espaços são ignorados; parênteses ou "-" na frente = negativo;
    * texto que não é número ("abc", "1,2,3", "1.2.3") → ``None``.

Também aqui: :func:`texto_numero_js`, o ``String(numero)`` do JavaScript (para escrever números como o app).
"""

from __future__ import annotations

import math
import re
from decimal import Decimal
from typing import Any

# Os espaços do \s e do trim() do JavaScript. (O \s do Python inclui \x1c–\x1f e \x85 e não inclui ﻿.)
ESPACOS_JS = (
    "\t\n\v\f\r   " + "".join(map(chr, range(0x2000, 0x200B))) + "    　﻿"
)
RE_ESPACO_JS = re.compile(f"[{ESPACOS_JS}]")

# /R\$|US\$|¥|CN¥|RMB|\s| /gi do app (o "i" do JavaScript só troca maiúscula/minúscula ASCII nestas letras).
_RE_IGNORAR = re.compile(r"[Rr]\$|[Uu][Ss]\$|¥|[Cc][Nn]¥|[Rr][Mm][Bb]|" + f"[{ESPACOS_JS}]")
_RE_SO_NUMERO = re.compile(r"[0-9.,]+")  # \d do JavaScript = só 0–9
_RE_DIGITO = re.compile(r"[0-9]")


def trim_js(s: str) -> str:
    """``String.prototype.trim`` do JavaScript (tira os mesmos espaços do ``\\s`` do JavaScript)."""
    return s.strip(ESPACOS_JS)


def _number_js(s: str) -> float | None:
    """``Number(s)`` para um texto só com dígitos e ponto; ``None`` no lugar de NaN/Infinity."""
    try:
        n = float(s)
    except (ValueError, OverflowError):
        return None
    return n if math.isfinite(n) else None


def ler_numero_br(texto: Any, milhar: bool = True) -> float | None:
    """Lê um número digitado ou impresso (porta fiel de ``lerNumeroBr``). Inválido ou vazio → ``None``.

    :param milhar: ponto sozinho no formato 1.234 / 12.345.678 vale como separador de milhar (dinheiro).
                   Use ``False`` para cotação e fator ("5.432" = 5,432).
    """
    if isinstance(texto, bool):  # no app, true/false não são números
        return None
    if isinstance(texto, (int, float)):
        try:
            n = float(texto)
        except OverflowError:
            return None
        return n if math.isfinite(n) else None
    if texto is None:
        return None
    s = trim_js(_RE_IGNORAR.sub("", str(texto)))
    if not s:
        return None
    negativo = False
    if len(s) >= 2 and s[0] == "(" and s[-1] == ")":
        negativo = True
        s = s[1:-1]
    if s.startswith("-"):
        negativo = not negativo
        s = s[1:]
    if not _RE_SO_NUMERO.fullmatch(s) or not _RE_DIGITO.search(s):
        return None
    tem_virgula, tem_ponto = "," in s, "." in s
    if tem_virgula and tem_ponto:
        # O último separador é o decimal.
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".", 1)
        else:
            s = s.replace(",", "")
    elif tem_virgula:
        if s.count(",") > 1:  # "1,2,3"
            return None
        s = s.replace(",", ".")
    elif tem_ponto:
        partes = s.split(".")
        eh_milhar = (
            milhar and len(partes) >= 2 and partes[0] not in ("0", "") and all(len(p) == 3 for p in partes[1:])
        )
        if eh_milhar:
            s = "".join(partes)
        elif len(partes) > 2:  # "1.2.3"
            return None
    n = _number_js(s)
    if n is None:
        return None
    return -n if negativo else n


def texto_numero_js(v: float | int) -> str:
    """``String(v)`` do JavaScript: ``10.0`` → ``"10"``, ``8.36`` → ``"8.36"``, ``1e21`` → ``"1e+21"``, ``-0`` → ``"0"``."""
    if isinstance(v, bool):
        return "true" if v else "false"
    try:
        x = float(v)
    except OverflowError:
        return "Infinity" if v > 0 else "-Infinity"
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    if x == 0:
        return "0"
    sinal = "-" if x < 0 else ""
    # repr() dá os dígitos mais curtos que voltam ao mesmo número, como o JavaScript.
    _, digitos, expoente = Decimal(repr(abs(x))).normalize().as_tuple()
    d = "".join(str(c) for c in digitos)
    k, n = len(d), expoente + len(d)  # v = 0.d × 10^n
    if k <= n <= 21:
        corpo = d + "0" * (n - k)
    elif 0 < n <= 21:
        corpo = f"{d[:n]}.{d[n:]}"
    elif -6 < n <= 0:
        corpo = "0." + "0" * (-n) + d
    else:
        e = n - 1
        corpo = (d if k == 1 else f"{d[0]}.{d[1:]}") + f"e{'+' if e >= 0 else '-'}{abs(e)}"
    return sinal + corpo
