"""Cotação do dia da compra (PTAX de fechamento do Banco Central) — porta de ``src/lib/cambio.ts``.

1. Boletim diário de fechamento do BCB (``www4.bcb.gov.br/Download/fechamento/AAAAMMDD.csv``): traz TODAS as
   moedas, inclusive o yuan (CNY). Se a data não tem boletim (fim de semana, feriado ou antes das ~13h), volta
   dia a dia até 10 dias para achar o último dia útil.
2. API Olinda do BCB (USD, EUR e outras 8 moedas; não tem CNY).
3. AwesomeAPI (mercado), se o BCB estiver fora do ar.
4. Se nada responder, o Claude abre o CSV com a ferramenta de web ou a pessoa informa a cotação.

Só biblioteca padrão (``urllib``), sempre com timeout.
"""

from __future__ import annotations

import json
import os
import socket
import ssl
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from typing import Callable

from .numeros import ler_numero_br

URL_BOLETIM = "https://www4.bcb.gov.br/Download/fechamento/{aaaammdd}.csv"
FONTE_BOLETIM = "PTAX Banco Central (boletim de fechamento)"
TIMEOUT_BCB = 12
TIMEOUT_AWESOME = 10

Baixar = Callable[[str, float], bytes]


class ErroFonte(Exception):
    """A fonte respondeu, mas com erro (status HTTP diferente de 200/404, JSON inválido...)."""


class ErroRede(Exception):
    """Não houve resposta: rede bloqueada, proxy recusou, DNS, TLS ou tempo esgotado."""


# ------------------------------------------------------------------ rede


def _contexto_ssl() -> ssl.SSLContext:
    """Contexto TLS padrão + CA extra de proxy corporativo (REQUESTS_CA_BUNDLE, CURL_CA_BUNDLE, SSL_CERT_FILE)."""
    ctx = ssl.create_default_context()
    for var in ("REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "SSL_CERT_FILE"):
        caminho = os.environ.get(var)
        if caminho and os.path.isfile(caminho):
            try:
                ctx.load_verify_locations(caminho)
            except (OSError, ssl.SSLError):
                pass
    return ctx


def baixar(url: str, timeout: float) -> bytes:
    """GET simples. ``urllib.error.HTTPError`` sobe como está; falhas de conexão viram :class:`ErroRede`."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_contexto_ssl()) as resp:
            return resp.read()
    except urllib.error.HTTPError:
        raise
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, ssl.SSLError, OSError) as e:
        motivo = getattr(e, "reason", None) or e
        raise ErroRede(f"sem conexão com {url.split('/')[2]} ({motivo})") from e


def _texto(dados: bytes) -> str:
    try:
        return dados.decode("utf-8")
    except UnicodeDecodeError:
        return dados.decode("latin-1")


# ------------------------------------------------------------------ boletim de fechamento (CSV)


def url_boletim(dia: date | str) -> str:
    """URL do boletim de fechamento PTAX do dia (``https://www4.bcb.gov.br/Download/fechamento/AAAAMMDD.csv``)."""
    if isinstance(dia, str):
        dia = date.fromisoformat(dia)
    return URL_BOLETIM.format(aaaammdd=dia.strftime("%Y%m%d"))


def ler_boletim(texto: str, moeda: str, tipo: str = "venda") -> dict | None:
    """Lê a cotação de uma moeda no CSV do boletim de fechamento.

    Formato de cada linha: ``Data;Cód;Tipo;Moeda;Compra;Venda;Paridade compra;Paridade venda``
    (ex.: ``25/09/2026;795;A;CNY;0,77430000;0,77450000;6,71280000;6,71370000``).

    :return: ``{moeda, cotacao, data (AAAA-MM-DD), fonte, tipo}`` ou ``None`` se a moeda não está no boletim.
    """
    moeda = moeda.strip().upper()
    for linha in texto.splitlines():
        c = linha.split(";")
        if len(c) > 3 and c[3].strip().upper() == moeda:
            bruto = (c[5] if tipo == "venda" else c[4]) if len(c) > 5 else ""
            valor = ler_numero_br(bruto, milhar=False)  # "0,77450000" → 0.7745 (cotação nunca tem milhar)
            if valor is None:
                raise ErroFonte(f"valor inválido no boletim para {moeda}: {bruto!r}")
            dd, mm, aaaa = c[0].strip().split("/")
            return {"moeda": moeda, "cotacao": valor, "data": f"{aaaa}-{mm}-{dd}", "fonte": FONTE_BOLETIM, "tipo": tipo}
    return None


def boletim_bcb(moeda: str, data: str, tipo: str = "venda", baixar_: Baixar = baixar) -> dict | None:
    """Cotação pelo boletim de fechamento, voltando até 10 dias (404 = sem boletim naquele dia)."""
    dia = date.fromisoformat(data)
    for _ in range(10):
        url = url_boletim(dia)
        try:
            dados = baixar_(url, TIMEOUT_BCB)
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise ErroFonte(f"BCB (boletim) respondeu {e.code}") from e
            dia -= timedelta(days=1)
            continue
        return ler_boletim(_texto(dados), moeda, tipo)  # None: a moeda não existe no boletim
    return None


# ------------------------------------------------------------------ fontes alternativas


def _mmddaaaa(d: date) -> str:
    return d.strftime("%m-%d-%Y")


def ptax_olinda(moeda: str, data: str, tipo: str = "venda", baixar_: Baixar = baixar) -> dict | None:
    """PTAX pela API Olinda do BCB (período de 10 dias até a data; prefere o boletim de fechamento)."""
    fim = date.fromisoformat(data)
    ini = fim - timedelta(days=10)
    url = (
        "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/"
        "CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)"
        f"?@moeda=%27{moeda}%27&@dataInicial=%27{_mmddaaaa(ini)}%27&@dataFinalCotacao=%27{_mmddaaaa(fim)}%27"
        "&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao,tipoBoletim"
    )
    try:
        dados = json.loads(_texto(baixar_(url, TIMEOUT_BCB)))
    except urllib.error.HTTPError as e:
        raise ErroFonte(f"BCB respondeu {e.code}") from e
    except json.JSONDecodeError as e:
        raise ErroFonte("BCB respondeu algo que não é JSON") from e
    valores = dados.get("value") or []
    fechamentos = [v for v in valores if str(v.get("tipoBoletim") or "").startswith("Fechamento")]
    lista = fechamentos or valores
    if not lista:
        return None
    ultimo = lista[-1]
    return {
        "moeda": moeda,
        "cotacao": ultimo["cotacaoVenda"] if tipo == "venda" else ultimo["cotacaoCompra"],
        "data": str(ultimo["dataHoraCotacao"])[:10],
        "fonte": f"PTAX Banco Central ({ultimo.get('tipoBoletim')})",
        "tipo": tipo,
    }


def awesome(moeda: str, data: str, baixar_: Baixar = baixar) -> dict | None:
    """Cotação de mercado (venda) pela AwesomeAPI — último recurso, não é a PTAX oficial."""
    fim_d = date.fromisoformat(data)
    ini_d = fim_d - timedelta(days=7)
    url = (
        f"https://economia.awesomeapi.com.br/json/daily/{moeda}-BRL/10"
        f"?start_date={ini_d.strftime('%Y%m%d')}&end_date={fim_d.strftime('%Y%m%d')}"
    )
    try:
        lista = json.loads(_texto(baixar_(url, TIMEOUT_AWESOME)))
    except urllib.error.HTTPError as e:
        raise ErroFonte(f"AwesomeAPI respondeu {e.code}") from e
    except json.JSONDecodeError as e:
        raise ErroFonte("AwesomeAPI respondeu algo que não é JSON") from e
    if not isinstance(lista, list) or not lista:
        return None
    mais_recente = max(lista, key=lambda x: float(x.get("timestamp") or 0))
    quando = datetime.fromtimestamp(float(mais_recente["timestamp"]), tz=timezone.utc)
    return {
        "moeda": moeda,
        "cotacao": float(mais_recente["ask"]),
        "data": quando.strftime("%Y-%m-%d"),
        "fonte": "AwesomeAPI (mercado)",
        "tipo": "venda",
    }


# ------------------------------------------------------------------ busca completa


def buscar_cotacao(moeda: str, data: str, tipo: str = "venda", baixar_: Baixar = baixar) -> tuple[dict | None, list[str], bool]:
    """Busca a cotação nas fontes, na ordem do app.

    :return: ``(cotacao | None, erros, rede_bloqueada)`` — ``cotacao`` = ``{moeda, cotacao, data, fonte, tipo}``.
    """
    moeda = moeda.strip().upper()
    if moeda == "BRL":
        return {"moeda": moeda, "cotacao": 1.0, "data": data, "fonte": "BRL", "tipo": tipo}, [], False
    erros: list[str] = []
    rede_bloqueada = False
    fontes = [
        lambda: boletim_bcb(moeda, data, tipo, baixar_),
        lambda: ptax_olinda(moeda, data, tipo, baixar_),
        lambda: awesome(moeda, data, baixar_),
    ]
    for fonte in fontes:
        try:
            c = fonte()
            if c and c["cotacao"] > 0:
                return c, erros, False
        except ErroRede as e:
            rede_bloqueada = True
            erros.append(str(e))
        except Exception as e:  # noqa: BLE001 — qualquer falha de uma fonte passa para a próxima
            erros.append(str(e))
    return None, erros, rede_bloqueada


def dias_uteis_ate(data: str, n: int = 3) -> list[date]:
    """Os ``n`` últimos dias de semana (seg–sex) até a data, do mais recente para o mais antigo (não sabe feriados)."""
    dia = date.fromisoformat(data)
    out: list[date] = []
    while len(out) < n:
        if dia.weekday() < 5:
            out.append(dia)
        dia -= timedelta(days=1)
    return out
