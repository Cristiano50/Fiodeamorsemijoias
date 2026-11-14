#!/usr/bin/env python3
"""Recompra e referências do cadastro (BR_2611001, CL_…), com as mesmas regras do app.

Uso:
    python3 scripts/referencias.py cadastro.json [--contexto contexto.json] [--lista-up produtos-up.xlsx|.csv]
                                                 [--inicio BR=12,CL=3] [--refazer]

O que faz, nesta ordem:
 1. Recompra: a peça que já foi cadastrada antes (mesmo fornecedor + mesmo código + mesma especificação) usa a
    referência, o nome, a classificação e o código de barras do UP da peça original. Fonte do histórico:
      - contexto.json do app (scripts/app.py contexto) — o melhor: tem tudo o que já foi cadastrado;
      - ou a lista de produtos exportada do UP (Referência + Código Externo [+ Cód. Barras]).
 2. Variações: linhas com o mesmo código do fornecedor viram um grupo e dividem a referência.
 3. Referências novas: prefixo do tipo (taxonomia) + ano/mês + sequência do mês, continuando de onde o app parou
    (contexto) ou da maior referência do mês na lista do UP; sem nenhum dos dois, use --inicio (ou começa em 1, com aviso).

Precisa que cada item já tenha `tipo` (classificação). Grava de volta no cadastro.json.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
REFS = BASE / "referencias"


def carregar(nome: str, contexto: dict | None) -> dict:
    if contexto and nome in (contexto.get("regras") or {}):
        return contexto["regras"][nome]
    p = REFS / f"{nome}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def norm_codigo(s) -> str:
    return re.sub(r"\s+", "", str(s or "")).upper()


def norm_fornecedor(s) -> str:
    return re.sub(r"\s+", "", str(s or "")).lower()


def sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def montar_referencia(modelo: str, prefixo: str, seq: int, data: datetime) -> str:
    """Porta de montarReferencia() de src/lib/codigos.ts."""
    aaaa = str(data.year)
    out = modelo.replace("{PREFIXO}", prefixo).replace("{AAAA}", aaaa).replace("{AA}", aaaa[2:]).replace("{MM}", f"{data.month:02d}")
    out = re.sub(r"\{(S{2,})\}", lambda m: str(seq).zfill(len(m.group(1))), out)
    out = re.sub(r"\{SEQ:(\d+)\}", lambda m: str(seq).zfill(int(m.group(1))), out)
    return out.replace("{SEQ}", str(seq))


def regex_referencia(modelo: str, prefixo: str, data: datetime) -> re.Pattern:
    """Expressão que acha a sequência numa referência do mesmo prefixo e mês."""
    aaaa = str(data.year)
    partes, resto = [], modelo
    while resto:
        m = re.match(r"\{(PREFIXO|AAAA|AA|MM|S{2,}|SEQ:\d+|SEQ)\}", resto)
        if m:
            tok = m.group(1)
            partes.append(
                re.escape(prefixo) if tok == "PREFIXO" else aaaa if tok == "AAAA" else aaaa[2:] if tok == "AA" else f"{data.month:02d}" if tok == "MM" else r"(\d+)"
            )
            resto = resto[m.end():]
        else:
            partes.append(re.escape(resto[0]))
            resto = resto[1:]
    return re.compile("^" + "".join(partes) + "$", re.I)


def ler_planilha(caminho: Path) -> list[dict]:
    """Lista de produtos exportada do UP (CSV com ; ou , ou XLSX). Devolve dicionários pelo cabeçalho."""
    if caminho.suffix.lower() in (".xlsx", ".xlsm"):
        from openpyxl import load_workbook

        ws = load_workbook(caminho, read_only=True, data_only=True).active
        linhas = [["" if c is None else (str(int(c)) if isinstance(c, float) and c.is_integer() else str(c)) for c in r] for r in ws.iter_rows(values_only=True)]
    else:
        bruto = caminho.read_bytes()
        try:
            texto = bruto.decode("utf-8-sig")
        except UnicodeDecodeError:
            texto = bruto.decode("cp1252")
        sep = ";" if texto.count(";") >= texto.count(",") else ","
        linhas = list(csv.reader(io.StringIO(texto), delimiter=sep))
    # cabeçalho = primeira linha (das 30 primeiras) que tem "refer"
    for i, l in enumerate(linhas[:30]):
        if any("refer" in sem_acento(c).lower() for c in l):
            cab = [sem_acento(c).lower().strip() for c in l]
            return [dict(zip(cab, r)) for r in linhas[i + 1:] if any(x.strip() for x in r)]
    raise SystemExit(f"Não achei a coluna Referência em {caminho.name}.")


def col(d: dict, *padroes: str) -> str:
    for k, v in d.items():
        if any(re.search(p, k) for p in padroes):
            return str(v or "").strip()
    return ""


def historico_do_contexto(contexto: dict) -> list[dict]:
    return [
        {
            "referencia": p.get("referencia"),
            "codigoFornecedor": norm_codigo(p.get("codigoFornecedor")),
            "especificacao": norm_codigo(p.get("especificacao")),
            "fornecedor": norm_fornecedor(p.get("fornecedor")),
            "codigoBarras": p.get("codigoBarras") if p.get("codigoBarrasOrigem") == "up" else None,
            "dados": p,
            "fonte": f"pedido {p.get('pedido') or '?'}" + (f" de {'/'.join(reversed(p['dataCompra'].split('-')))}" if p.get("dataCompra") else ""),
        }
        for p in contexto.get("produtos") or []
        if p.get("referencia")
    ]


def historico_da_lista_up(linhas: list[dict]) -> list[dict]:
    out = []
    for l in linhas:
        ref = col(l, r"^refer")
        if not ref:
            continue
        out.append({
            "referencia": ref,
            "codigoFornecedor": norm_codigo(col(l, r"externo")),
            "especificacao": None,  # a lista do UP não separa a especificação; confere pela grade
            "grade": col(l, r"grade", r"varia"),
            "fornecedor": None,
            "codigoBarras": col(l, r"barras", r"^ean", r"gtin") or None,
            "dados": {"nome": col(l, r"^nome", r"^descricao$", r"^produto$")},
            "fonte": "lista de produtos do UP",
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cadastro")
    ap.add_argument("--contexto")
    ap.add_argument("--lista-up")
    ap.add_argument("--inicio", help="próximo número por prefixo, ex.: BR=12,CL=3")
    ap.add_argument("--refazer", action="store_true", help="refaz as referências que não são recompra")
    a = ap.parse_args()

    caminho = Path(a.cadastro)
    cad = json.loads(caminho.read_text(encoding="utf-8"))
    contexto = json.loads(Path(a.contexto).read_text(encoding="utf-8")) if a.contexto else None
    tax = carregar("taxonomia", contexto)
    sistema = carregar("sistema", contexto)
    modelo = sistema.get("referenciaModelo") or "{PREFIXO}_{AA}{MM}{SEQ:3}"
    agora = datetime.now()
    itens = sorted(cad.get("itens", []), key=lambda i: int(i.get("linha") or 0))
    forn = norm_fornecedor(cad.get("pedido", {}).get("fornecedor"))
    avisos: list[str] = []

    historico: list[dict] = []
    if contexto:
        historico += historico_do_contexto(contexto)
    lista_up = ler_planilha(Path(a.lista_up)) if a.lista_up else []
    if lista_up:
        historico += historico_da_lista_up(lista_up)

    # 1. Recompra
    recompras = 0
    for it in itens:
        if it.get("recompraDe") and not a.refazer:
            continue
        cod, esp = norm_codigo(it.get("codigoFornecedor")), norm_codigo(it.get("especificacao"))
        if not cod:
            continue
        candidatos = []
        for h in historico:
            if h["codigoFornecedor"] != cod:
                continue
            if h["fornecedor"] is not None and forn and h["fornecedor"] and h["fornecedor"] != forn:
                continue
            if h["especificacao"] is not None and h["especificacao"] != esp:
                continue
            if h["especificacao"] is None and esp and h.get("grade") and esp not in norm_codigo(h["grade"]) and len(
                [x for x in historico if x["codigoFornecedor"] == cod]
            ) > 1:
                continue
            candidatos.append(h)
        if not candidatos:
            continue
        h = candidatos[0]
        recompras += 1
        it["recompraDe"] = h["referencia"]
        it["referencia"] = h["referencia"]
        if h.get("codigoBarras"):
            it["codigoBarras"] = h["codigoBarras"]
            it["codigoBarrasOrigem"] = "up"
        d = h.get("dados") or {}
        for campo in ("nome", "nomeComercial", "tipo", "subtipo", "material", "banho", "corPedra", "tamanho"):
            if d.get(campo):
                it[campo] = d[campo]
        alertas = [x for x in (it.get("alertas") or []) if not x.startswith("Recompra de ")]
        alertas.insert(0, f"Recompra de {h['referencia']} ({h['fonte']}).")
        p_antes, p_agora = d.get("precoOrigem"), it.get("precoOrigem")
        if p_antes and p_agora and abs(float(p_agora) - float(p_antes)) > 0.001:
            pct = (float(p_agora) - float(p_antes)) / float(p_antes) * 100
            alertas.append(f"Preço do fornecedor {'subiu' if pct > 0 else 'caiu'} {abs(pct):.0f}% ({p_antes} → {p_agora}).")
        if h["fonte"] == "lista de produtos do UP":
            alertas.append("Recompra achada pelo Código Externo na lista do UP: confira se é o mesmo fornecedor.")
        it["alertas"] = alertas

    # 2. Variações: mesmo código do fornecedor em 2+ linhas = mesmo grupo
    por_codigo: dict[str, list[dict]] = {}
    for it in itens:
        if it.get("codigoFornecedor") and not it.get("recompraDe"):
            por_codigo.setdefault(norm_codigo(it["codigoFornecedor"]), []).append(it)
    for codigo, lista in por_codigo.items():
        if len(lista) > 1:
            for it in lista:
                it["grupo"] = it.get("grupo") or codigo

    # 3. Próxima sequência por prefixo
    prefixos = sorted({t.get("prefixo") for t in tax.get("tipos", []) if t.get("prefixo")} | {"SJ"})
    proxima: dict[str, int] = {}
    if contexto and (contexto.get("referencias") or {}).get("mes") == agora.strftime("%Y-%m"):
        proxima.update({k: int(v) for k, v in contexto["referencias"].get("proxima", {}).items()})
    if lista_up:
        refs = [col(l, r"^refer") for l in lista_up]
        for pfx in prefixos:
            rx = regex_referencia(modelo, pfx, agora)
            nums = [int(m.group(1)) for r in refs if (m := rx.match(r or ""))]
            if nums:
                proxima[pfx] = max(proxima.get(pfx, 1), max(nums) + 1)
    if a.inicio:
        for par in a.inicio.split(","):
            k, _, v = par.partition("=")
            if k.strip() and v.strip().isdigit():
                proxima[k.strip().upper()] = int(v)
    # referências já usadas neste cadastro também contam
    for it in itens:
        for pfx in prefixos:
            m = regex_referencia(modelo, pfx, agora).match(it.get("referencia") or "")
            if m and not a.refazer:
                proxima[pfx] = max(proxima.get(pfx, 1), int(m.group(1)) + 1)
    if not contexto and not lista_up and not a.inicio:
        avisos.append(
            "Sem o contexto do app e sem a lista do UP: as referências começaram em 001 neste mês. "
            "Se a loja já cadastrou peças este mês, confira e rode de novo com --inicio BR=…,CL=… ou com a lista do UP."
        )

    # 4. Referências novas (grupos dividem a mesma)
    por_grupo: dict[str, str] = {}
    novas = 0
    for it in itens:
        if it.get("recompraDe"):
            continue
        if it.get("referencia") and not a.refazer:
            if it.get("grupo"):
                por_grupo.setdefault(it["grupo"], it["referencia"])
            continue
        if it.get("grupo") and it["grupo"] in por_grupo:
            it["referencia"] = por_grupo[it["grupo"]]
            continue
        tipo = next((t for t in tax.get("tipos", []) if t.get("id") == it.get("tipo")), None)
        pfx = (tipo or {}).get("prefixo") or "SJ"
        if not tipo:
            it.setdefault("alertas", []).append("Sem tipo: referência com prefixo SJ. Classifique e rode de novo com --refazer.")
        seq = proxima.get(pfx, 1)
        proxima[pfx] = seq + 1
        it["referencia"] = montar_referencia(modelo, pfx, seq, agora)
        if it.get("grupo"):
            por_grupo[it["grupo"]] = it["referencia"]
        novas += 1

    cad["itens"] = itens
    caminho.write_text(json.dumps(cad, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({
        "recompras": recompras,
        "referenciasNovas": novas,
        "grupos": sum(1 for v in por_codigo.values() if len(v) > 1),
        "historico": "app" if contexto else ("lista do UP" if lista_up else "nenhum"),
        "proximas": proxima,
        "avisos": avisos,
    }, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
