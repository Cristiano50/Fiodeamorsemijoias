#!/usr/bin/env python3
"""Gera as saídas do cadastro: planilhas do UP Vendas (XLSX e CSV), pacote para o app e resumo.

Uso:
    python3 scripts/gerar_saidas.py cadastro.json [--saida PASTA] [--sem-fotos]

Saídas (na PASTA, padrão = pasta do cadastro.json), as mesmas planilhas do app (src/lib/upvendas-planilha.ts):
    planilha-up-novos-<pedido>.xlsx / .csv       PRODUTOS NOVOS: cadastro completo (tela "Cadastro de Produtos
                                                 Simplificado" do UP); só as peças que ainda não existem no UP
    planilha-up-recompras-<pedido>.xlsx / .csv   RECOMPRAS: entrada de estoque de produtos que JÁ existem no UP
                                                 (código de barras do UP + quantidade; linhas com o mesmo código somam
                                                 a quantidade e o custo é a média ponderada; quantidade 0 fica de fora)
    cadastro-<pedido>.json                       pacote para o app (fotos embutidas), formato referencias/formato-cadastro.md
    resumo-<pedido>.md                           conferência rápida (linhas, peças, totais, alertas)
Cada planilha só é gerada quando tem linhas (mandar recompra no cadastro duplicaria o produto no UP).

Regras do código de barras (padrão da loja): peça nova vai SEM código (o UP Vendas cria no cadastro);
só vai preenchido o código criado pelo UP que já existe (recompra).

Recompra a confirmar (``recompraCandidatas`` sem ``recompraDe``): vai no pacote e no resumo, mas fica FORA das duas
planilhas do UP — a skill não decide; a pessoa confirma no app e baixa a planilha do UP pelo app.

Células da planilha (CSV e XLSX) com o mesmo cuidado do app (src/lib/csv.ts): texto que começa com = + - @, tab
ou enter ganha um apóstrofo na frente (não vira fórmula no Excel); números continuam números.
Quantidade 0 continua 0 no estoque (com aviso); sem quantidade conta 1, como no app.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fiodeamor.calculo import avisos_de_quantidade, aviso_fator_minimo, moeda_do_pedido, numero, quantidade  # noqa: E402
from fiodeamor.planilha import celula_csv, celula_planilha  # noqa: E402
from fiodeamor.precos import round_js  # noqa: E402

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

# Planilha de recompras (entrada de estoque): código de barras e quantidade primeiro; o resto é para conferir.
COLUNAS_RECOMPRAS = [
    ("codigoBarras", "Cód. Barras", 18),
    ("quantidade", "Quantidade", 11),
    ("referencia", "Referência", 14),
    ("nome", "Nome do produto", 46),
    ("custoUnitario", "Custo unitário", 13),
]
MOEDA_RECOMPRAS = {"custoUnitario"}
ABA_NOVOS = "Produtos novos (cadastro)"
ABA_RECOMPRAS = "Recompras (entrada de estoque)"


def carregar_json(nome: str, contexto: dict | None = None) -> dict:
    """Regras: do contexto do app (se a skill consultou o app) ou da cópia em referencias/."""
    if contexto and nome in (contexto.get("regras") or {}):
        return contexto["regras"][nome]
    caminho = REFS / f"{nome}.json"
    return json.loads(caminho.read_text(encoding="utf-8")) if caminho.exists() else {}


def r2(v) -> float:
    """``Math.round(v * 100) / 100``, como a planilha do app (src/lib/upvendas-planilha.ts)."""
    return round_js((numero(v) or 0.0) * 100) / 100


def _num(v) -> float:
    """Número de um campo do cadastro (aceita texto como "10,5"); vazio → 0."""
    return numero(v) or 0.0


def achar(lista: list, id_: str | None) -> dict | None:
    return next((x for x in lista or [] if x.get("id") == id_), None)


def codigo_para_up(it: dict, sistema: dict) -> str:
    """``codigoParaUp`` do app: o código criado pelo UP vai igual (o UP acha o produto); sem código do UP vai em branco
    (o UP gera no cadastro); só no modo "app" (Configurações → Códigos) vai o EAN interno (Code128: 8 dígitos)."""
    codigo = str(it.get("codigoBarras") or "")
    if not codigo:
        return ""
    if it.get("codigoBarrasOrigem") == "up":
        return codigo
    if sistema.get("origemCodigoBarras", "upvendas") != "app":
        return ""
    return re.sub(r"^9100", "", codigo)[:-1] if sistema.get("codigoNoUp") == "code128" else codigo


def estoque_entrada(it: dict) -> int:
    """``estoqueEntrada`` do app: conferida = recebida − com defeito; sem conferência, a quantidade pedida.

    Quantidade 0 continua 0; sem quantidade conta 1 (como na importação do app).
    """
    recebida = it.get("quantidadeRecebida")
    if recebida is None:
        return max(0, math.floor(quantidade(it.get("quantidade"))))
    defeito = math.floor(numero(it.get("quantidadeDefeito")) or 0)
    return max(0, math.floor(numero(recebida) or 0) - max(0, defeito))


def eh_recompra_up(it: dict) -> bool:
    """Recompra = o mesmo produto de um pedido anterior (mesma referência e código no UP): vai na planilha de recompras."""
    return bool(it.get("recompraDe"))


def linha_up(it: dict, tax: dict, pol: dict, sistema: dict) -> dict:
    """Porta de linhaUp() de src/lib/upvendas-planilha.ts (uma linha da planilha de produtos novos)."""
    tipo = achar(tax.get("tipos"), it.get("tipo"))
    material = achar(tax.get("materiais"), it.get("material"))
    banho = achar(tax.get("banhos"), it.get("banho"))
    custo = _num(it.get("custoTotalBrl"))
    tabelas = pol.get("tabelas_preco") or []
    base = achar(tabelas, pol.get("tabela_base"))
    segunda = next((t for t in tabelas if t.get("tabela_up_vendas") and t.get("id") != pol.get("tabela_base")), None)
    precos = it.get("precos") or {}
    valor2 = _num(precos.get(segunda["id"])) if segunda else 0.0
    preco = _num(it.get("precoVenda"))

    grade = (material or {}).get("descricao_grade") or str((material or {}).get("nome") or "SEMIJOIA").upper()
    if banho and banho.get("id") != "sem_banho" and not re.search(r"BANHAD|FOLHEAD", grade):
        grade += f" BANHADA A {str(banho.get('nome', '')).upper()}"
    if it.get("variacao"):
        grade += f" - {str(it['variacao']).upper()}"

    # Só o código criado pelo UP (recompra). No modo "app" (Configurações do app), o EAN interno também vai.
    codigo = codigo_para_up(it, sistema)

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
        "custoCompraBruto": r2(it.get("custoProdutoBrl")),
        "custoInsumo": r2(it.get("custoAdicionalBrl")),
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
        "estoque": estoque_entrada(it),  # 0 continua 0; sem quantidade conta 1 (como no app)
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


# Célula do CSV: a mesma do app (celulaCsv). O nome antigo continua valendo.
texto_csv = celula_csv


def linhas_recompra_up(itens: list[dict], sistema: dict) -> tuple[list[dict], int, int]:
    """Porta de ``linhasRecompraUp``: uma linha por código de barras do UP (linhas com o mesmo código somam a quantidade;
    o custo é a média ponderada). Peça sem nenhuma unidade que entrou fica de fora. Sem o código do UP, a linha vai sem
    código (pela referência), uma por peça.

    :return: ``(linhas, sem_codigo, sem_entrada)``
    """
    por_chave: dict[str, dict] = {}
    sem_codigo = sem_entrada = 0
    for k, it in enumerate(itens):
        qtd = estoque_entrada(it)
        if qtd <= 0:
            sem_entrada += 1
            continue
        codigo = codigo_para_up(it, sistema)
        if not codigo:
            sem_codigo += 1
        chave = f"c:{codigo}" if codigo else f"r:{it.get('referencia') or k}:{k}"
        atual = por_chave.get(chave) or {
            "codigoBarras": codigo,
            "quantidade": 0,
            "referencia": it.get("referencia") or "",
            "nome": str(it.get("nome") or "").upper(),
            "custoUnitario": 0,
            "custoTotal": 0.0,
        }
        atual["quantidade"] += qtd
        atual["custoTotal"] += _num(it.get("custoTotalBrl")) * qtd
        atual["custoUnitario"] = r2(atual["custoTotal"] / atual["quantidade"]) if atual["quantidade"] > 0 else 0
        por_chave[chave] = atual
    linhas = [{c[0]: l[c[0]] for c in COLUNAS_RECOMPRAS} for l in por_chave.values()]
    return linhas, sem_codigo, sem_entrada


def montar_csv(linhas: list[dict], colunas: list = COLUNAS) -> str:
    """CSV com ";" e cabeçalho, linhas separadas por CRLF; cada célula passa por ``celula_csv`` (como o app)."""
    return "\r\n".join(
        [";".join(celula_csv(c[1]) for c in colunas)] + [";".join(celula_csv(l[c[0]]) for c in colunas) for l in linhas]
    )


def gravar_csv(linhas: list[dict], destino: Path, colunas: list = COLUNAS) -> None:
    # BOM no início: o Excel abre o CSV com os acentos certos.
    destino.write_bytes(("\ufeff" + montar_csv(linhas, colunas)).encode("utf-8"))


def gravar_xlsx(
    linhas: list[dict], destino: Path, colunas: list = COLUNAS, aba: str = ABA_NOVOS, moeda: set = MOEDA_COLUNAS
) -> bool:
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
    except ImportError:
        print("Aviso: openpyxl não instalado (pip install openpyxl); só o CSV foi gerado.", file=sys.stderr)
        return False
    wb = Workbook()
    ws = wb.active
    ws.title = aba
    ws.append([c[1] for c in colunas])
    for l in linhas:
        # Sim/Não, números como números e texto protegido contra fórmula (o openpyxl grava "=…" como fórmula).
        ws.append([celula_planilha(l[c[0]]) for c in colunas])
    for i, (chave, _, largura) in enumerate(colunas, start=1):
        letra = get_column_letter(i)
        ws.column_dimensions[letra].width = largura
        for cel in ws[letra][1:]:
            if chave in moeda:
                cel.number_format = '"R$" #,##0.00'
            if chave == "codigoBarras":
                cel.number_format = "@"
    for cel in ws[1]:
        cel.font = Font(bold=True, color="FFFFFF")
        cel.fill = PatternFill("solid", fgColor="B07A90")
        cel.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(colunas))}1"
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


def aguardando_recompra(it: dict) -> bool:
    """Recompra a confirmar: há originais possíveis e ninguém decidiu ainda (``aguardandoRecompra`` do app)."""
    return not it.get("recompraDe") and bool(it.get("recompraCandidatas"))


def _br(v: float) -> str:
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def avisos_do_cadastro(cad: dict, itens: list[dict] | None = None, pol: dict | None = None) -> list[str]:
    """Avisos para a conferência: moeda, cotação/preços pendentes, quantidades (0, vazia…), recompras a confirmar e
    fator/preço manual abaixo do mínimo (``pol``: no app só valem se a gestora importar)."""
    p = cad.get("pedido") or {}
    itens = (cad.get("itens") or []) if itens is None else itens
    moeda = moeda_do_pedido(p)
    out: list[str] = []
    if not moeda:
        out.append("Moeda do pedido não identificada no documento: confirme com a pessoa (o app assume CNY e pede para conferir).")
    if moeda != "BRL" and not ((numero(p.get("cotacao"), milhar=False) or 0) > 0):
        out.append("Sem cotação: os preços estão pendentes. Rode scripts/ptax.py e scripts/calcular.py antes de importar no UP.")
    out += avisos_de_quantidade(itens)
    n = sum(1 for i in itens if aguardando_recompra(i))
    if n:
        out.append(
            f"{n} peça(s) com recompra a confirmar ficaram fora das planilhas do UP: importe o cadastro no app, escolha o "
            "original (ou \"Não é recompra\") no pedido e baixe a planilha do UP pelo app."
        )
    if pol and (aviso := aviso_fator_minimo({**cad, "itens": itens}, pol)):
        out.append(aviso)
    return out


def avisos_das_planilhas(sem_codigo: int, sem_entrada: int) -> list[str]:
    """Avisos da planilha de recompras (entrada de estoque)."""
    out = []
    if sem_codigo:
        out.append(
            f"{sem_codigo} recompra(s) sem o código de barras do UP: na planilha de recompras a linha vai sem código "
            "(pela referência). Traga os códigos no app (UP Vendas → Códigos de barras do UP) antes de dar a entrada."
        )
    if sem_entrada:
        out.append(f"{sem_entrada} recompra(s) com quantidade 0 ficaram fora da planilha de recompras (não há entrada de estoque).")
    return out


def resumo_md(
    cad: dict,
    linhas_up: list[dict],
    itens: list[dict] | None = None,
    avisos: list[str] | None = None,
    planilhas: dict | None = None,
) -> str:
    """Resumo para conferência. ``itens`` na mesma ordem de ``linhas_up`` (padrão: os itens do cadastro);
    ``avisos`` (padrão: :func:`avisos_do_cadastro`); ``planilhas``: ``{"novos": n, "recompras": n}`` linhas de cada."""
    p = cad.get("pedido", {})
    itens = cad.get("itens", []) if itens is None else itens
    qtds = [quantidade(i.get("quantidade")) for i in itens]
    pecas = sum(qtds)
    total_origem = sum(_num(i.get("precoOrigem")) * q for i, q in zip(itens, qtds))
    custo = sum(_num(i.get("custoTotalBrl")) * q for i, q in zip(itens, qtds))
    venda = sum(_num(i.get("precoVenda")) * q for i, q in zip(itens, qtds))
    recompras = [i for i in itens if i.get("recompraDe")]
    a_confirmar = [i for i in itens if aguardando_recompra(i)]
    sem_nome = [i for i in itens if not i.get("nome")]
    sem_tipo = [i for i in itens if not i.get("tipo")]
    alertas = [(i.get("linha"), a) for i in itens for a in (i.get("alertas") or [])]
    avisos = avisos_do_cadastro(cad, itens) if avisos is None else avisos
    frete = numero(p.get("frete"))
    total_doc = numero(p.get("totalDocumento"))
    out = [
        f"# Cadastro do pedido {p.get('numero') or '(sem número)'}",
        "",
        f"- Fornecedor: {p.get('fornecedor') or '—'}",
        f"- Data da compra: {p.get('dataCompra') or '—'} · moeda {moeda_do_pedido(p) or 'não identificada'} · cotação {p.get('cotacao') or 'pendente'} ({p.get('cotacaoFonte') or 'sem fonte'})",
        f"- Linhas: {len(itens)} · peças: {pecas} · total na moeda: {total_origem:,.2f}"
        + (f" (documento: {total_doc:,.2f})" if total_doc else ""),
        f"- Frete: {_br(frete) if frete else 'não informado'} · fator do pedido: {p.get('fator') or 'padrão da loja'}",
        f"- Custo total: {_br(custo)} · venda potencial: {_br(venda)}" + (f" · markup médio ×{venda / custo:.2f}" if custo else ""),
        f"- Recompras: {len(recompras)} · a confirmar: {len(a_confirmar)} · sem nome: {len(sem_nome)} · sem tipo: {len(sem_tipo)}",
    ]
    if planilhas is not None:
        out.append(
            f"- Planilhas do UP: produtos novos {planilhas.get('novos', 0)} linha(s) · recompras (entrada de estoque) "
            f"{planilhas.get('recompras', 0)} linha(s)"
        )
    if avisos:
        out += ["", "## Avisos", ""] + [f"- {a}" for a in avisos]
    out += [
        "",
        "| Linha | Referência | Nome | Qtd | Custo | Preço | Código de barras |",
        "| --- | --- | --- | ---: | ---: | ---: | --- |",
    ]
    for it, l in zip(itens, linhas_up):
        if l["codigoBarras"]:
            cod = l["codigoBarras"]
        elif it.get("recompraDe"):
            cod = "(recompra: falta o código do UP)"
        elif aguardando_recompra(it):
            cod = "(recompra a confirmar no app; fora das planilhas)"
        else:
            cod = "(o UP gera)"
        out.append(
            f"| {it.get('linha')} | {l['referencia'] or '—'} | {l['nome'] or '—'} | {l['estoque']} | {_br(l['custoTotal'])} | {_br(l['valorTabela'])} | {cod} |"
        )
    if a_confirmar:
        out += ["", "## Recompra a confirmar (a skill não decide; o app mostra \"Recompra a confirmar\")", ""]
        out += [f"- Linha {i.get('linha')} ({i.get('codigoFornecedor') or 'sem código'}): pode ser {', '.join(i['recompraCandidatas'])}" for i in a_confirmar]
    if alertas:
        out += ["", "## Alertas", ""] + [f"- Linha {ln}: {a}" for ln, a in alertas]
    return "\n".join(out) + "\n"


# Campos numéricos do pacote: o texto ("10,5", "R$ 1.234") vai como número, lido como o lerNumeroBr do app
# (milhar=False em cotação e fator: "0.775" é 0,775). Assim o app e a skill leem o mesmo valor.
CAMPOS_NUMERO_PEDIDO = {"cotacao": False, "fator": False, "frete": True, "totalDocumento": True}
CAMPOS_NUMERO_ITEM = {"precoOrigem": True, "precoManual": True, "fator": False}


def normalizar_numeros(pacote: dict) -> None:
    """Troca no pacote os números escritos como texto por números (``lerNumeroBr``); a quantidade vira inteiro."""
    pedido = pacote.get("pedido") or {}
    for campo, milhar in CAMPOS_NUMERO_PEDIDO.items():
        if isinstance(pedido.get(campo), str):
            pedido[campo] = numero(pedido[campo], milhar)
    for it in pacote.get("itens") or []:
        for campo, milhar in CAMPOS_NUMERO_ITEM.items():
            if isinstance(it.get(campo), str):
                it[campo] = numero(it[campo], milhar)
        q = it.get("quantidade")
        if q is not None and not isinstance(q, bool) and not (isinstance(q, int)):
            n = numero(q)
            it["quantidade"] = None if n is None else max(0, int(round_js(n)))


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
    # Como no app: produtos novos (cadastro) × recompras (entrada de estoque). Recompra a confirmar: nenhuma das duas.
    novos = [l for i, l in zip(itens, linhas) if not eh_recompra_up(i) and not aguardando_recompra(i)]
    recompras, sem_codigo, sem_entrada = linhas_recompra_up([i for i in itens if eh_recompra_up(i)], sistema)
    avisos = avisos_do_cadastro(cad, itens, pol) + avisos_das_planilhas(sem_codigo, sem_entrada)
    for aviso in avisos:
        print(f"Aviso: {aviso}", file=sys.stderr)
    nome = nome_arquivo(cad.get("pedido", {}).get("numero"))

    planilhas: dict[str, str | None] = {}
    for tipo, lista, colunas, aba, moeda in (
        ("novos", novos, COLUNAS, ABA_NOVOS, MOEDA_COLUNAS),
        ("recompras", recompras, COLUNAS_RECOMPRAS, ABA_RECOMPRAS, MOEDA_RECOMPRAS),
    ):
        csv_path = pasta / f"planilha-up-{tipo}-{nome}.csv"
        xlsx_path = pasta / f"planilha-up-{tipo}-{nome}.xlsx"
        if not lista:  # nada desse tipo: não gera (e apaga a de uma rodada anterior)
            for velho in (csv_path, xlsx_path):
                velho.unlink(missing_ok=True)
            planilhas[tipo + "Csv"] = planilhas[tipo + "Xlsx"] = None
            continue
        gravar_csv(lista, csv_path, colunas)
        planilhas[tipo + "Csv"] = str(csv_path)
        planilhas[tipo + "Xlsx"] = str(xlsx_path) if gravar_xlsx(lista, xlsx_path, colunas, aba, moeda) else None

    # Pacote para o app: o mesmo cadastro com as fotos embutidas.
    cad.setdefault("formato", "fiodeamor-cadastro")
    cad.setdefault("versao", 1)
    cad.setdefault("id", str(uuid.uuid4()))
    cad["geradoEm"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    cad.setdefault("geradoPor", "skill fiodeamor-cadastro")
    caminho.write_text(json.dumps(cad, ensure_ascii=False, indent=1), encoding="utf-8")  # guarda o id
    pacote = json.loads(json.dumps(cad))
    normalizar_numeros(pacote)
    for it in pacote["itens"]:
        foto = it.pop("foto", None)
        if foto and not a.sem_fotos:
            it["fotoBase64"] = foto_base64((caminho.parent / foto).resolve())
    pacote_path = pasta / f"cadastro-{nome}.json"
    pacote_path.write_text(json.dumps(pacote, ensure_ascii=False), encoding="utf-8")

    resumo_path = pasta / f"resumo-{nome}.md"
    resumo_path.write_text(
        resumo_md(cad, linhas, itens, avisos, {"novos": len(novos), "recompras": len(recompras)}), encoding="utf-8"
    )

    print(json.dumps({
        "planilhaNovosXlsx": planilhas["novosXlsx"],
        "planilhaNovosCsv": planilhas["novosCsv"],
        "planilhaRecomprasXlsx": planilhas["recomprasXlsx"],
        "planilhaRecomprasCsv": planilhas["recomprasCsv"],
        "pacote": str(pacote_path),
        "pacoteMB": round(pacote_path.stat().st_size / 1_000_000, 2),
        "resumo": str(resumo_path),
        "itens": len(linhas),
        "linhasNovos": len(novos),
        "linhasRecompras": len(recompras),
        "recomprasSemCodigo": sem_codigo,
        "recomprasSemEntrada": sem_entrada,
        "recomprasAConfirmar": sum(1 for i in itens if aguardando_recompra(i)),
        "avisos": avisos,
    }, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
