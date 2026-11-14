#!/usr/bin/env python3
"""Gera as saídas do cadastro: planilha do UP Vendas (XLSX e CSV), pacote para o app e resumo.

Uso:
    python3 scripts/gerar_saidas.py cadastro.json [--saida PASTA] [--sem-fotos]

Saídas (na PASTA, padrão = pasta do cadastro.json):
    planilha-up-<pedido>.xlsx / .csv   mesmas colunas e regras do app (tela "Cadastro de Produtos Simplificado")
    cadastro-<pedido>.json             pacote para o app (fotos embutidas), formato referencias/formato-cadastro.md
    resumo-<pedido>.md                 conferência rápida (linhas, peças, totais, alertas)

Regras do código de barras (padrão da loja): peça nova vai SEM código (o UP Vendas cria no cadastro);
só vai preenchido o código criado pelo UP que já existe (recompra).
"""
from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
REFS = BASE / "referencias"

COLUNAS = [
    ("nome", "Nome do produto", 46),
    ("marca", "Marca", 14),
    ("referencia", "Referência", 14),
    ("codigoExterno", "Código Externo", 16),
    ("ncm", "NCM", 11),
    ("unidade", "Un. estoque", 8),
    ("categoriaVitrine", "Categoria Vitrine", 28),
    ("custoCompraBruto", "Custo Compra Bruto", 12),
    ("custoInsumo", "Custo Insumo", 12),
    ("milesimos", "Milésimos", 9),
    ("banhoOuro", "Banho Ouro", 9),
    ("banhoPrata", "Banho Prata", 9),
    ("banhoRodio", "Banho Ródio", 9),
    ("banhoVerniz", "Banho Verniz", 9),
    ("custoTotal", "Custo Total", 11),
    ("tabelaPreco", "Tabela Preço 1", 14),
    ("percentualLucro", "% Lucro Tabela 1", 10),
    ("valorTabela", "Valor Tabela 1", 11),
    ("tabelaPreco2", "Tabela Preço 2", 16),
    ("percentualLucro2", "% Lucro Tabela 2", 10),
    ("valorTabela2", "Valor Tabela 2", 11),
    ("descricaoGrade", "Descrição (grade)", 36),
    ("codigoBarras", "Cód. Barras", 16),
    ("estoque", "Saldo Estoque", 8),
    ("ativo", "Ativo", 6),
    ("acabado", "Acabado", 7),
    ("compartilhar", "Compartilhar", 8),
    ("sincronizarUpVendas", "Sincronizar com a Up vendas?", 10),
    ("tipo", "Tipo", 12),
    ("material", "Material", 14),
    ("banho", "Banho", 14),
    ("corPedra", "Cor da pedra", 16),
    ("tamanho", "Tamanho", 10),
    ("nomeComercial", "Nome comercial", 26),
    ("legenda", "Legenda Instagram", 50),
    ("imagemUrl", "Imagem", 40),
]
MOEDA_COLUNAS = {"custoCompraBruto", "custoInsumo", "custoTotal", "valorTabela", "valorTabela2"}


def carregar_json(nome: str, contexto: dict | None = None) -> dict:
    """Regras: do contexto do app (se a skill consultou o app) ou da cópia em referencias/."""
    if contexto and nome in (contexto.get("regras") or {}):
        return contexto["regras"][nome]
    caminho = REFS / f"{nome}.json"
    return json.loads(caminho.read_text(encoding="utf-8")) if caminho.exists() else {}


def r2(v: float) -> float:
    return round(float(v) + 1e-9, 2)


def achar(lista: list, id_: str | None) -> dict | None:
    return next((x for x in lista or [] if x.get("id") == id_), None)


def linha_up(it: dict, tax: dict, pol: dict, sistema: dict) -> dict:
    """Porta de linhaUp() de src/lib/upvendas.ts (uma linha da planilha do UP)."""
    tipo = achar(tax.get("tipos"), it.get("tipo"))
    material = achar(tax.get("materiais"), it.get("material"))
    banho = achar(tax.get("banhos"), it.get("banho"))
    custo = float(it.get("custoTotalBrl") or 0)
    tabelas = pol.get("tabelas_preco") or []
    base = achar(tabelas, pol.get("tabela_base"))
    segunda = next((t for t in tabelas if t.get("tabela_up_vendas") and t.get("id") != pol.get("tabela_base")), None)
    precos = it.get("precos") or {}
    valor2 = float(precos.get(segunda["id"], 0) or 0) if segunda else 0.0
    preco = float(it.get("precoVenda") or 0)

    grade = (material or {}).get("descricao_grade") or str((material or {}).get("nome") or "SEMIJOIA").upper()
    if banho and banho.get("id") != "sem_banho" and not re.search(r"BANHAD|FOLHEAD", grade):
        grade += f" BANHADA A {str(banho.get('nome', '')).upper()}"
    if it.get("variacao"):
        grade += f" - {str(it['variacao']).upper()}"

    codigo = it.get("codigoBarras") or ""
    # Só o código criado pelo UP (recompra). No modo "app" (Configurações do app), o EAN interno também vai.
    if codigo and it.get("codigoBarrasOrigem", "up") != "up" and sistema.get("origemCodigoBarras", "upvendas") != "app":
        codigo = ""

    cores = []
    for c in it.get("corPedra") or []:
        achada = achar(tax.get("cores_pedra"), c)
        cores.append(achada["nome"] if achada else c)

    return {
        "nome": str(it.get("nome") or "").upper(),
        "marca": sistema.get("marcaUp", "FIO DE AMOR"),
        "referencia": it.get("referencia") or "",
        "codigoExterno": it.get("codigoFornecedor") or "",
        "ncm": it.get("ncm") or sistema.get("ncmPadrao", ""),
        "unidade": sistema.get("unidade", "UN"),
        "categoriaVitrine": " - ".join(x for x in [(tipo or {}).get("categoria_vitrine") or (tipo or {}).get("nome"), it.get("subtipo")] if x),
        "custoCompraBruto": r2(it.get("custoProdutoBrl") or 0),
        "custoInsumo": r2(it.get("custoAdicionalBrl") or 0),
        "milesimos": 0,
        "banhoOuro": 0,
        "banhoPrata": 0,
        "banhoRodio": 0,
        "banhoVerniz": 0,
        "custoTotal": r2(custo),
        "tabelaPreco": (base or {}).get("tabela_up_vendas") or (base or {}).get("nome") or "CONSIGNADO",
        "percentualLucro": r2((preco / custo - 1) * 100) if custo > 0 else 0,
        "valorTabela": preco,
        "tabelaPreco2": (segunda or {}).get("nome", ""),
        "percentualLucro2": r2((valor2 / custo - 1) * 100) if custo > 0 and valor2 else 0,
        "valorTabela2": valor2,
        "descricaoGrade": grade,
        "codigoBarras": codigo,
        "estoque": int(it.get("quantidade") or 1),
        "ativo": True,
        "acabado": True,
        "compartilhar": True,
        "sincronizarUpVendas": True,
        "imagemUrl": "",
        "tipo": (tipo or {}).get("nome") or it.get("tipo") or "",
        "material": (material or {}).get("nome") or it.get("material") or "",
        "banho": (banho or {}).get("nome") or it.get("banho") or "",
        "corPedra": ", ".join(cores),
        "tamanho": it.get("tamanho") or "",
        "nomeComercial": it.get("nomeComercial") or "",
        "legenda": it.get("legenda") or "",
    }


def texto_csv(v) -> str:
    if isinstance(v, bool):
        return "Sim" if v else "Não"
    if isinstance(v, float):
        s = repr(round(v, 10)).rstrip("0").rstrip(".") if v != int(v) else str(int(v))
        return s.replace(".", ",")
    if isinstance(v, int):
        return str(v)
    return str(v or "")


def gravar_csv(linhas: list[dict], destino: Path) -> None:
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    w.writerow([c[1] for c in COLUNAS])
    for l in linhas:
        w.writerow([texto_csv(l[c[0]]) for c in COLUNAS])
    destino.write_text("﻿" + buf.getvalue(), encoding="utf-8")


def gravar_xlsx(linhas: list[dict], destino: Path) -> bool:
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
    except ImportError:
        print("Aviso: openpyxl não instalado (pip install openpyxl); só o CSV foi gerado.", file=sys.stderr)
        return False
    wb = Workbook()
    ws = wb.active
    ws.title = "Produtos UP Vendas"
    ws.append([c[1] for c in COLUNAS])
    for l in linhas:
        ws.append(["Sim" if l[c[0]] is True else "Não" if l[c[0]] is False else l[c[0]] for c in COLUNAS])
    for i, (chave, _, largura) in enumerate(COLUNAS, start=1):
        letra = get_column_letter(i)
        ws.column_dimensions[letra].width = largura
        for cel in ws[letra][1:]:
            if chave in MOEDA_COLUNAS:
                cel.number_format = '"R$" #,##0.00'
            if chave == "codigoBarras":
                cel.number_format = "@"
    for cel in ws[1]:
        cel.font = Font(bold=True, color="FFFFFF")
        cel.fill = PatternFill("solid", fgColor="B07A90")
        cel.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUNAS))}1"
    wb.save(destino)
    return True


def foto_base64(caminho: Path, lado: int = 1000) -> str | None:
    """Foto redimensionada (até 1000 px, JPEG) para o pacote não ficar pesado."""
    if not caminho.exists():
        return None
    try:
        from PIL import Image

        with Image.open(caminho) as im:
            im = im.convert("RGB")
            im.thumbnail((lado, lado))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=84, optimize=True)
            dados = buf.getvalue()
    except Exception:
        dados = caminho.read_bytes()
    return "data:image/jpeg;base64," + base64.b64encode(dados).decode("ascii")


def nome_arquivo(numero: str | None) -> str:
    base = re.sub(r"[^A-Za-z0-9_-]+", "-", numero or "").strip("-")
    return base or datetime.now().strftime("%Y%m%d-%H%M")


def resumo_md(cad: dict, linhas_up: list[dict]) -> str:
    p = cad.get("pedido", {})
    itens = cad.get("itens", [])
    pecas = sum(int(i.get("quantidade") or 0) for i in itens)
    total_origem = sum(float(i.get("precoOrigem") or 0) * int(i.get("quantidade") or 0) for i in itens)
    custo = sum(float(i.get("custoTotalBrl") or 0) * int(i.get("quantidade") or 0) for i in itens)
    venda = sum(float(i.get("precoVenda") or 0) * int(i.get("quantidade") or 0) for i in itens)
    recompras = [i for i in itens if i.get("recompraDe")]
    sem_nome = [i for i in itens if not i.get("nome")]
    sem_tipo = [i for i in itens if not i.get("tipo")]
    alertas = [(i.get("linha"), a) for i in itens for a in (i.get("alertas") or [])]
    br = lambda v: f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    out = [
        f"# Cadastro do pedido {p.get('numero') or '(sem número)'}",
        "",
        f"- Fornecedor: {p.get('fornecedor') or '—'}",
        f"- Data da compra: {p.get('dataCompra') or '—'} · moeda {p.get('moeda') or '—'} · cotação {p.get('cotacao') or '—'} ({p.get('cotacaoFonte') or 'sem fonte'})",
        f"- Linhas: {len(itens)} · peças: {pecas} · total na moeda: {total_origem:,.2f}"
        + (f" (documento: {float(p['totalDocumento']):,.2f})" if p.get("totalDocumento") else ""),
        f"- Frete: {br(float(p['frete'])) if p.get('frete') else 'não informado'} · fator do pedido: {p.get('fator') or 'padrão da loja'}",
        f"- Custo total: {br(custo)} · venda potencial: {br(venda)}" + (f" · markup médio ×{venda / custo:.2f}" if custo else ""),
        f"- Recompras: {len(recompras)} · sem nome: {len(sem_nome)} · sem tipo: {len(sem_tipo)}",
        "",
        "| Linha | Referência | Nome | Qtd | Custo | Preço | Código de barras |",
        "| --- | --- | --- | ---: | ---: | ---: | --- |",
    ]
    for it, l in zip(itens, linhas_up):
        cod = l["codigoBarras"] or ("(o UP gera)" if not it.get("recompraDe") else "(recompra: falta o código do UP)")
        out.append(
            f"| {it.get('linha')} | {l['referencia'] or '—'} | {l['nome'] or '—'} | {l['estoque']} | {br(l['custoTotal'])} | {br(l['valorTabela'])} | {cod} |"
        )
    if alertas:
        out += ["", "## Alertas", ""] + [f"- Linha {ln}: {a}" for ln, a in alertas]
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cadastro")
    ap.add_argument("--saida")
    ap.add_argument("--contexto", help="contexto.json baixado do app (regras atuais)")
    ap.add_argument("--sem-fotos", action="store_true", help="pacote sem as fotos (fica bem menor)")
    a = ap.parse_args()

    caminho = Path(a.cadastro).resolve()
    cad = json.loads(caminho.read_text(encoding="utf-8"))
    pasta = Path(a.saida).resolve() if a.saida else caminho.parent
    pasta.mkdir(parents=True, exist_ok=True)
    contexto = json.loads(Path(a.contexto).read_text(encoding="utf-8")) if a.contexto else None
    tax, pol, sistema = carregar_json("taxonomia", contexto), carregar_json("precificacao", contexto), carregar_json("sistema", contexto)

    itens = sorted(cad.get("itens", []), key=lambda i: int(i.get("linha") or 0))
    faltando = [i.get("linha") for i in itens if i.get("precoVenda") in (None, 0)]
    if faltando:
        print(f"Aviso: {len(faltando)} item(ns) sem preço de venda (rode scripts/calcular.py antes): linhas {faltando[:15]}", file=sys.stderr)
    linhas = [linha_up(i, tax, pol, sistema) for i in itens]
    nome = nome_arquivo(cad.get("pedido", {}).get("numero"))

    csv_path = pasta / f"planilha-up-{nome}.csv"
    gravar_csv(linhas, csv_path)
    xlsx_path = pasta / f"planilha-up-{nome}.xlsx"
    tem_xlsx = gravar_xlsx(linhas, xlsx_path)

    # Pacote para o app: o mesmo cadastro com as fotos embutidas.
    cad.setdefault("formato", "fiodeamor-cadastro")
    cad.setdefault("versao", 1)
    cad.setdefault("id", str(uuid.uuid4()))
    cad["geradoEm"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    cad.setdefault("geradoPor", "skill fiodeamor-cadastro")
    caminho.write_text(json.dumps(cad, ensure_ascii=False, indent=1), encoding="utf-8")  # guarda o id
    pacote = json.loads(json.dumps(cad))
    for it in pacote["itens"]:
        foto = it.pop("foto", None)
        if foto and not a.sem_fotos:
            it["fotoBase64"] = foto_base64((caminho.parent / foto).resolve())
    pacote_path = pasta / f"cadastro-{nome}.json"
    pacote_path.write_text(json.dumps(pacote, ensure_ascii=False), encoding="utf-8")

    resumo_path = pasta / f"resumo-{nome}.md"
    resumo_path.write_text(resumo_md(cad, linhas), encoding="utf-8")

    print(json.dumps({
        "planilhaXlsx": str(xlsx_path) if tem_xlsx else None,
        "planilhaCsv": str(csv_path),
        "pacote": str(pacote_path),
        "pacoteMB": round(pacote_path.stat().st_size / 1_000_000, 2),
        "resumo": str(resumo_path),
        "itens": len(linhas),
        "semCodigoDeBarras": sum(1 for l in linhas if not l["codigoBarras"]),
    }, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
