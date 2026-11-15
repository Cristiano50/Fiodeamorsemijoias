"""Células seguras para CSV e planilha — porta de ``src/lib/csv.ts`` do app.

Texto que começa com ``=``, ``+``, ``-``, ``@``, tab ou enter (``\\r``) vira fórmula ao abrir no Excel/Planilhas:
ganha um apóstrofo na frente. Números continuam números; verdadeiro/falso viram "Sim"/"Não".
"""

from __future__ import annotations

import math
import re
from typing import Any

from .numeros import texto_numero_js

_RE_FORMULA = re.compile(r"[=+\-@\t\r]")
_RE_ASPAS_OU_LINHA = re.compile(r'["\r\n]')


def texto_seguro_planilha(v: str) -> str:
    """``textoSeguroPlanilha``: prefixa com apóstrofo o texto com cara de fórmula (``=HYPERLINK(...)`` → ``'=HYPERLINK(...)``)."""
    return f"'{v}" if _RE_FORMULA.match(v) else v


def celula_csv(v: Any, sep: str = ";") -> str:
    """``celulaCsv``: célula CSV separada por ``;`` (padrão brasileiro do app).

    Número com vírgula (``77.99`` → ``77,99``), Sim/Não, texto seguro e aspas quando precisa.
    """
    if isinstance(v, bool):
        s = "Sim" if v else "Não"
    elif isinstance(v, (int, float)):
        s = texto_numero_js(v).replace(".", ",", 1) if math.isfinite(v) else ""
    else:
        s = texto_seguro_planilha("" if v is None else str(v))
    if sep in s or _RE_ASPAS_OU_LINHA.search(s):
        return '"' + s.replace('"', '""') + '"'
    return s


def celula_planilha(v: Any) -> Any:
    """``valorCelulaXlsx`` do app: número fica número, Sim/Não nos campos lógicos e texto protegido contra fórmula."""
    if isinstance(v, bool):
        return "Sim" if v else "Não"
    if isinstance(v, (int, float)):
        return v if math.isfinite(v) else ""
    return texto_seguro_planilha("" if v is None else str(v))
