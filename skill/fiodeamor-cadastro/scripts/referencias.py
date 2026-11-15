#!/usr/bin/env python3
"""Recompra e referências do cadastro (BR_2611001, CL_…), com as mesmas regras do app.

Uso:
    python3 scripts/referencias.py cadastro.json [--contexto contexto.json] [--lista-up produtos-up.xlsx|.csv]
                                                 [--inicio BR=12,CL=3] [--refazer]

O que faz, nesta ordem:
 1. Recompra: a peça que já foi cadastrada antes usa a referência, o nome, a classificação e o código de barras do UP
    da peça original. Chave da recompra = fornecedor (nome original sem espaços, minúsculas) + código do fornecedor
    + especificação/cor, os dois normalizados (largura total → ASCII, maiúsculas, sem espaço, hífen ou ponto).
      - exatamente 1 original possível e ele casa a chave inteira → recompra (recompraDe = referência do original);
      - mais de um possível, ou fornecedor/especificação desconhecidos de um dos lados → "recompra a confirmar":
        recompraCandidatas = [referências possíveis], sem referência e fora da planilha do UP até alguém decidir
        no app. Na dúvida a skill não decide; o app mostra "Recompra a confirmar";
      - pedido sem fornecedor → só candidatas, nunca recompra automática.
    Fonte do histórico:
      - contexto.json do app (scripts/app.py contexto) — o melhor: tem tudo o que já foi cadastrado;
      - ou a lista de produtos exportada do UP (Referência + Código Externo [+ Cód. Barras]); a lista não tem
        fornecedor nem especificação, então o que ela achar fica sempre "a confirmar".
 2. Variações: linhas com o mesmo código do fornecedor (recompras incluídas) viram um grupo e dividem a referência;
    o grupo com recompra usa a referência da original.
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

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fiodeamor.numeros import ESPACOS_JS, ler_numero_br  # noqa: E402
from fiodeamor.precos import texto_numero, to_fixed  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
REFS = BASE / "referencias"

FONTE_LISTA_UP = "lista de produtos do UP"
PREFIXOS_ALERTA_RECOMPRA = ("Recompra de ", "Recompra a confirmar", "Preço do fornecedor ")
_RE_ESPACOS = re.compile(f"[{ESPACOS_JS}]+")
_RE_SEM_CHAVE = re.compile(f"[{ESPACOS_JS}.\\-]+")


def carregar(nome: str, contexto: dict | None) -> dict:
    if contexto and nome in (contexto.get("regras") or {}):
        return contexto["regras"][nome]
    p = REFS / f"{nome}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def normalizar_chave(s) -> str:
    """``normalizarChave`` do app (código e especificação): largura total → ASCII (NFKC), maiúsculas,
    sem espaço, hífen ou ponto. "abc-123 a" = "ＡＢＣ１２３Ａ" = "ABC123A"."""
    return _RE_SEM_CHAVE.sub("", unicodedata.normalize("NFKC", str(s or "")).upper())


def chave_fornecedor(s) -> str:
    """``chaveFornecedor`` do app: o nome original do fornecedor sem espaços e em minúsculas."""
    return _RE_ESPACOS.sub("", str(s or "")).lower()


# Nomes antigos (compatibilidade com quem importava estas funções).
norm_codigo = normalizar_chave
norm_fornecedor = chave_fornecedor


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


def _data_br(iso: str | None) -> str:
    return "/".join(reversed(iso.split("-"))) if iso else ""


def historico_do_contexto(contexto: dict) -> list[dict]:
    """Peças já cadastradas no app (só as originais, com referência), com a chave da recompra.

    Contexto novo: cada peça traz ``fornecedorChave`` e ``especificacao``. Contexto antigo (sem
    ``fornecedorChave``): a chave do fornecedor sai do nome e a especificação igual ao próprio código é ignorada
    (o leitor antigo devolvia o código quando não havia a coluna de especificação).
    """
    out = []
    for p in contexto.get("produtos") or []:
        ref = str(p.get("referencia") or "").strip()
        if not ref or p.get("recompraDe"):
            continue
        novo = "fornecedorChave" in p or "chaveFornecedor" in p
        forn = p.get("fornecedorChave", p.get("chaveFornecedor")) if novo else p.get("fornecedor")
        # O contexto novo já manda o código e a especificação normalizados (a mesma conta do app).
        codigo = p["codigoNormalizado"] if isinstance(p.get("codigoNormalizado"), str) else normalizar_chave(p.get("codigoFornecedor"))
        esp = (
            p["especificacaoNormalizada"]
            if isinstance(p.get("especificacaoNormalizada"), str)
            else normalizar_chave(p.get("especificacao"))
        )
        if not novo and esp == codigo:
            esp = ""
        fonte = f"pedido {p.get('pedido') or '?'}" + (f" de {_data_br(p['dataCompra'])}" if p.get("dataCompra") else "")
        out.append({
            "referencia": ref,
            "codigoFornecedor": codigo,
            "especificacao": esp,
            "especificacaoTexto": str(p.get("especificacao") or "").strip(),
            "fornecedorChave": chave_fornecedor(forn),
            "codigoBarras": p.get("codigoBarras") if p.get("codigoBarrasOrigem") == "up" else None,
            "criadoEm": str(p.get("criadoEm") or ""),
            "dados": p,
            "fonte": fonte,
        })
    return out


def historico_da_lista_up(linhas: list[dict], ja_conhecidas: set[str] | None = None) -> list[dict]:
    """Produtos da lista exportada do UP. Sem fornecedor nem especificação: o que casar fica "a confirmar".

    ``ja_conhecidas``: referências (normalizadas) que já vieram do contexto do app — não entram de novo.
    """
    out = []
    for l in linhas:
        ref = col(l, r"^refer")
        if not ref or (ja_conhecidas and ref.upper() in ja_conhecidas):
            continue
        nome = col(l, r"^nome", r"^descricao$", r"^produto$")
        out.append({
            "referencia": ref,
            "codigoFornecedor": normalizar_chave(col(l, r"externo")),
            "especificacao": "",  # a lista do UP não separa a especificação
            "especificacaoTexto": col(l, r"grade", r"varia"),
            "fornecedorChave": "",
            "codigoBarras": col(l, r"barras", r"^ean", r"gtin") or None,
            "criadoEm": "",
            "dados": {"nome": nome},
            "fonte": FONTE_LISTA_UP,
        })
    return out


def classificar_recompra(codigo, especificacao, fornecedor_chave: str, historico: list[dict]) -> tuple[dict | None, list[dict]]:
    """Porta de ``classificarRecompra`` (src/lib/codigos.ts). Devolve ``(original_automatico, possiveis)``.

    * Original possível: mesmo código; fornecedor igual (ou desconhecido de um dos lados); especificação igual ou
      vazia de um dos lados.
    * Automática só quando há exatamente 1 possível e ele casa a chave inteira (fornecedor conhecido nos dois lados e
      mesma especificação). Senão, com algum possível: recompra a confirmar. Pedido sem fornecedor = só candidatas.
    """
    cod = normalizar_chave(codigo)
    if not cod:
        return None, []
    esp = normalizar_chave(especificacao)
    forn = fornecedor_chave or ""
    possiveis = [
        h for h in historico
        if h["codigoFornecedor"] == cod
        and not (forn and h["fornecedorChave"] and h["fornecedorChave"] != forn)
        and (h["especificacao"] == esp or not h["especificacao"] or not esp)
    ]
    possiveis.sort(key=lambda h: h.get("criadoEm") or "")
    exatos = [h for h in possiveis if forn and h["fornecedorChave"] == forn and h["especificacao"] == esp]
    if len(possiveis) == 1 and len(exatos) == 1:
        return exatos[0], []
    return None, possiveis


def _sem_alertas_de_recompra(it: dict) -> list:
    return [x for x in (it.get("alertas") or []) if not str(x).startswith(PREFIXOS_ALERTA_RECOMPRA)]


def aplicar_recompra(it: dict, h: dict, moeda_pedido: str | None) -> None:
    """A peça vira recompra de ``h``: referência, código de barras do UP, nome e classificação da original."""
    it["recompraDe"] = h["referencia"]
    it["referencia"] = h["referencia"]
    it.pop("recompraCandidatas", None)
    if h.get("codigoBarras"):
        it["codigoBarras"] = h["codigoBarras"]
        it["codigoBarrasOrigem"] = "up"
    d = h.get("dados") or {}
    for campo in ("nome", "nomeComercial", "tipo", "subtipo", "material", "banho", "corPedra", "tamanho"):
        if d.get(campo):
            it[campo] = d[campo]
    alertas = _sem_alertas_de_recompra(it)
    alertas.insert(0, f"Recompra de {h['referencia']} ({h['fonte']}).")
    p_antes, p_agora = ler_numero_br(d.get("precoOrigem")), ler_numero_br(it.get("precoOrigem"))
    moeda_antes = str(d.get("moeda") or "").upper() or None
    mesma_moeda = not moeda_antes or not moeda_pedido or moeda_antes == moeda_pedido
    if p_antes and p_agora and mesma_moeda and abs(p_agora - p_antes) > 0.001:
        pct = (p_agora - p_antes) / p_antes * 100
        alertas.append(
            f"Preço do fornecedor {'subiu' if pct > 0 else 'caiu'} {to_fixed(abs(pct), 0)}% "
            f"({texto_numero(p_antes)} → {texto_numero(p_agora)})."
        )
    it["alertas"] = alertas


def _descrever(h: dict) -> str:
    detalhe = [h.get("especificacaoTexto") or "sem especificação", h["fonte"]]
    nome = (h.get("dados") or {}).get("nome")
    if nome:
        detalhe.insert(0, str(nome))
    return f"{h['referencia']} ({', '.join(detalhe)})"


def marcar_candidatas(it: dict, possiveis: list[dict]) -> list[str]:
    """Recompra a confirmar: guarda as referências possíveis e devolve a descrição de cada original possível.

    Como no app, a peça fica sem referência até alguém decidir no app ("É esta" = a do original; "Não é recompra" =
    referência nova). Sem alerta na peça: o app mostra "Recompra a confirmar" pelo campo ``recompraCandidatas``.
    """
    refs: list[str] = []
    for h in possiveis:
        if h["referencia"] not in refs:
            refs.append(h["referencia"])
    it["recompraCandidatas"] = refs
    it["recompraDe"] = None
    it["referencia"] = None
    if it.get("codigoBarrasOrigem") == "up" and it.get("codigoBarras"):
        it["codigoBarras"] = None  # o código de barras de uma original não vale para a peça a confirmar
        it.pop("codigoBarrasOrigem", None)
    it["alertas"] = _sem_alertas_de_recompra(it)
    return [_descrever(h) for h in possiveis]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cadastro")
    ap.add_argument("--contexto")
    ap.add_argument("--lista-up")
    ap.add_argument("--inicio", help="próximo número por prefixo, ex.: BR=12,CL=3")
    ap.add_argument("--refazer", action="store_true", help="refaz as recompras e as referências que não são recompra")
    a = ap.parse_args()

    caminho = Path(a.cadastro)
    cad = json.loads(caminho.read_text(encoding="utf-8"))
    contexto = json.loads(Path(a.contexto).read_text(encoding="utf-8")) if a.contexto else None
    tax = carregar("taxonomia", contexto)
    sistema = carregar("sistema", contexto)
    modelo = sistema.get("referenciaModelo") or "{PREFIXO}_{AA}{MM}{SEQ:3}"
    agora = datetime.now()
    itens = sorted(cad.get("itens", []), key=lambda i: int(i.get("linha") or 0))
    pedido = cad.get("pedido") or {}
    forn = chave_fornecedor(pedido.get("fornecedor"))
    moeda = str(pedido.get("moeda") or "").upper() or None
    avisos: list[str] = []

    historico: list[dict] = []
    if contexto:
        historico += historico_do_contexto(contexto)
    lista_up = ler_planilha(Path(a.lista_up)) if a.lista_up else []
    if lista_up:
        historico += historico_da_lista_up(lista_up, {h["referencia"].upper() for h in historico})
    por_referencia: dict[str, dict] = {}
    for h in historico:
        por_referencia.setdefault(h["referencia"].upper(), h)

    # 1. Recompra
    recompras = 0
    a_confirmar: list[dict] = []
    for it in itens:
        if it.get("recompraDe") and not a.refazer:
            # Já é recompra (de uma rodada anterior): confere os dados com a original, se ela estiver no histórico.
            h = por_referencia.get(str(it["recompraDe"]).upper())
            if h:
                aplicar_recompra(it, h, moeda)
            else:
                it["referencia"] = it["recompraDe"]
                it.pop("recompraCandidatas", None)
            recompras += 1
            continue
        if a.refazer and it.get("recompraDe"):
            it["recompraDe"] = None
            it["referencia"] = None
            if it.get("codigoBarrasOrigem") == "up":  # o código de barras era o da original
                it["codigoBarras"] = None
                it.pop("codigoBarrasOrigem", None)
        automatico, possiveis = classificar_recompra(it.get("codigoFornecedor"), it.get("especificacao"), forn, historico)
        if automatico:
            aplicar_recompra(it, automatico, moeda)
            recompras += 1
        elif possiveis:
            opcoes = marcar_candidatas(it, possiveis)
            a_confirmar.append({
                "linha": it.get("linha"),
                "codigo": it.get("codigoFornecedor"),
                "especificacao": it.get("especificacao") or None,
                "candidatas": it["recompraCandidatas"],
                "opcoes": opcoes,
            })
        else:
            it.pop("recompraCandidatas", None)
            it["alertas"] = _sem_alertas_de_recompra(it)
    if a_confirmar and not forn:
        avisos.append("O pedido está sem o nome do fornecedor: a recompra nunca é automática (só candidatas).")
    if a_confirmar and lista_up and not contexto:
        avisos.append("A lista do UP não tem fornecedor nem especificação: o que ela achou ficou como 'recompra a confirmar'.")

    # 2. Variações: mesmo código do fornecedor em 2+ linhas = mesmo grupo (recompras incluídas)
    por_codigo: dict[str, list[dict]] = {}
    for it in itens:
        codigo = normalizar_chave(it.get("codigoFornecedor"))
        if codigo:
            por_codigo.setdefault(codigo, []).append(it)
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

    # 4. Referências novas (grupos dividem a mesma; o grupo com recompra usa a da original)
    ref_recompra: dict[str, str] = {}
    por_grupo: dict[str, str] = {}
    for it in itens:
        if it.get("grupo") and it.get("recompraDe") and it.get("referencia"):
            ref_recompra.setdefault(it["grupo"], it["referencia"])
    por_grupo.update(ref_recompra)
    if not a.refazer:
        for it in itens:
            if it.get("grupo") and not it.get("recompraDe") and it.get("referencia"):
                por_grupo.setdefault(it["grupo"], it["referencia"])
    novas = 0
    for it in itens:
        if it.get("recompraDe"):
            continue
        if it.get("recompraCandidatas"):
            it["referencia"] = None  # recompra a confirmar: a referência sai da decisão no app
            continue
        grupo = it.get("grupo")
        if grupo and grupo in ref_recompra:
            it["referencia"] = ref_recompra[grupo]
            continue
        if it.get("referencia") and not a.refazer:
            continue
        if grupo and grupo in por_grupo:
            it["referencia"] = por_grupo[grupo]
            continue
        tipo = next((t for t in tax.get("tipos", []) if t.get("id") == it.get("tipo")), None)
        pfx = (tipo or {}).get("prefixo") or "SJ"
        if not tipo:
            it.setdefault("alertas", []).append("Sem tipo: referência com prefixo SJ. Classifique e rode de novo com --refazer.")
        seq = proxima.get(pfx, 1)
        proxima[pfx] = seq + 1
        it["referencia"] = montar_referencia(modelo, pfx, seq, agora)
        if grupo:
            por_grupo[grupo] = it["referencia"]
        novas += 1

    cad["itens"] = itens
    caminho.write_text(json.dumps(cad, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({
        "recompras": recompras,
        "recomprasAConfirmar": len(a_confirmar),
        "aConfirmar": a_confirmar,
        "referenciasNovas": novas,
        "grupos": sum(1 for v in por_codigo.values() if len(v) > 1),
        "historico": "app" if contexto else ("lista do UP" if lista_up else "nenhum"),
        "proximas": proxima,
        "avisos": avisos,
    }, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
