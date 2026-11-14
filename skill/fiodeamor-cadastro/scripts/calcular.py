#!/usr/bin/env python3
"""Calcula custo e preço de todas as peças do ``cadastro.json`` e mostra o resumo do pedido.

Uso:
    python3 calcular.py PASTA/cadastro.json [--cotacao 0,7745] [--frete 850] [--fator 10] [--json]
    python3 ptax.py 2026-09-26 | python3 calcular.py PASTA/cadastro.json --ptax -
    python3 calcular.py PASTA/cadastro.json --contexto PASTA/contexto.json   (regras atuais do app)

Mesmas regras do app (src/lib/precos.ts + recalcularPedido):
    custo da peça = preço × cotação × (1 + frete ÷ valor da mercadoria em R$)   (pedido.frete em R$)
    preço         = custo × fator, para cima terminando em ,99 (mínimo R$ 19,99)
    fator         = preço manual → fator da peça → fator do pedido → faixas → tipo → padrão (10)
Grava de volta em cada peça: custoProdutoBrl, custoAdicionalBrl, custoTotalBrl, fatorAplicado, precoVenda,
precos (todas as tabelas), ncm e alertas (os alertas que não são de preço são mantidos).

As opções --cotacao/--ptax/--frete/--fator gravam o valor no pedido antes de calcular.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fiodeamor.calculo import ErroCadastro, calcular_cadastro, numero  # noqa: E402
from fiodeamor.precos import brl, dinheiro, numero_br  # noqa: E402


def _ler_ptax(origem: str) -> dict:
    """Lê a saída JSON de ptax.py (arquivo ou ``-`` para a entrada padrão)."""
    texto = sys.stdin.read() if origem == "-" else Path(origem).read_text(encoding="utf-8")
    dados = json.loads(texto)
    if not isinstance(dados, dict) or not numero(dados.get("cotacao")):
        raise ErroCadastro("A saída do ptax.py não tem cotação (a busca falhou?). Informe com --cotacao.")
    return dados


def aplicar_opcoes(cadastro: dict, args: argparse.Namespace) -> None:
    """Grava no pedido os valores passados na linha de comando."""
    pedido = cadastro.setdefault("pedido", {})
    if args.ptax:
        c = _ler_ptax(args.ptax)
        if c.get("moeda") and pedido.get("moeda") and c["moeda"].upper() != str(pedido["moeda"]).upper():
            raise ErroCadastro(f"A cotação é de {c['moeda']}, mas o pedido está em {pedido['moeda']}.")
        pedido["cotacao"] = numero(c["cotacao"])
        pedido["cotacaoFonte"] = c.get("fonte")
        pedido["cotacaoData"] = c.get("data")
    if args.cotacao is not None:
        valor = numero(args.cotacao)
        if not valor or valor <= 0:
            raise ErroCadastro(f"Cotação inválida: {args.cotacao!r}")
        pedido["cotacao"] = valor
        pedido["cotacaoFonte"] = "Informada manualmente"
        pedido["cotacaoData"] = pedido.get("cotacaoData") or pedido.get("dataCompra")
    if args.frete is not None:
        valor = numero(args.frete)
        pedido["frete"] = valor if valor and valor > 0 else None
    if args.fator is not None:
        valor = numero(args.fator)
        pedido["fator"] = valor if valor and valor > 0 else None


def imprimir_resumo(r: dict, cadastro: dict) -> None:
    """Resumo do pedido em português (os mesmos números da tela do pedido no app)."""
    cab = " — ".join(str(x) for x in (r["numero"], r["fornecedor"]) if x)
    if cab:
        print(f"Pedido: {cab}")
    print(f"Linhas: {r['linhas']} · Peças: {r['pecas']}")
    total = f"Total do pedido: {dinheiro(r['totalOrigem'], r['moeda'])}"
    if r["totalDocumento"] is not None:
        total += " ✓ confere com o documento" if r["confereDocumento"] else f" ✗ documento: {dinheiro(r['totalDocumento'], r['moeda'])}"
    print(total)
    p = cadastro.get("pedido") or {}
    fonte = ", ".join(str(x) for x in (p.get("cotacaoFonte"), p.get("cotacaoData")) if x)
    print(f"Cotação: {r['moeda']} {numero_br(r['cotacao'], 4)}" + (f" ({fonte})" if fonte else ""))
    print(f"Mercadoria em R$: {brl(r['mercadoriaBrl'])}")
    if r["freteBrl"]:
        print(f"Frete: {brl(r['freteBrl'])} = {numero_br(r['fretePct'])}% sobre o valor de cada peça")
    else:
        print("Frete: não informado (custo = só a mercadoria)")
    outros = [l for l in r["custosAdicionais"] if l["id"] != "frete_internacional"]
    if outros or r["porPecaBrl"]:
        partes = [f"{l['nome']} {brl(l['valor'])}" for l in outros]
        if r["porPecaBrl"]:
            partes.append(f"por peça {brl(r['porPecaBrl'])}")
        print(f"Outros custos ({r['cenarioNome'] or r['cenario']}): " + "; ".join(partes))
    print(f"Custo total: {brl(r['custoTotal'])} (fator de custo {numero_br(r['fatorCusto'], 4)})")
    print(f"Venda potencial: {brl(r['vendaPotencial'])} (tabela {r['tabelaBase']})")
    print(f"Markup médio: × {numero_br(r['fatorMedio'])} (preço ÷ custo)")
    if r["fatorPedido"]:
        print(f"Fator do pedido: × {numero_br(r['fatorPedido'])}")
    else:
        print(f"Fator do pedido: em branco (padrão da loja × {numero_br(r['fatorPadrao'])})")
    if r["semPreco"]:
        print(f"⚠ {r['semPreco']} peça(s) sem preço de origem")
    if r["comAlerta"]:
        print(f"⚠ {r['comAlerta']} peça(s) com alerta:")
        mostrados = 0
        for it in cadastro.get("itens") or []:
            if it.get("alertas") and mostrados < 10:
                rotulo = f"linha {it.get('linha')}" + (f" ({it['codigoFornecedor']})" if it.get("codigoFornecedor") else "")
                print(f"   {rotulo}: {' | '.join(it['alertas'])}")
                mostrados += 1
        if r["comAlerta"] > mostrados:
            print(f"   … e mais {r['comAlerta'] - mostrados}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Calcula custos e preços do cadastro.json e grava de volta.")
    ap.add_argument("cadastro", type=Path, help="caminho do cadastro.json")
    ap.add_argument("--cotacao", help="R$ por 1 unidade da moeda do pedido (ex.: 0,7745)")
    ap.add_argument("--ptax", metavar="ARQUIVO", help="JSON de saída do ptax.py (ou - para ler da entrada padrão)")
    ap.add_argument("--frete", help="frete do pedido em R$ (0 = sem frete)")
    ap.add_argument("--fator", help="fator do pedido (vazio/0 = padrão da loja)")
    ap.add_argument("--json", action="store_true", help="imprime o resumo em JSON")
    ap.add_argument("--contexto", type=Path, help="contexto.json do app (scripts/app.py contexto): usa as regras atuais da loja")
    args = ap.parse_args(argv)
    regras: dict = {}
    if args.contexto:
        try:
            regras = json.loads(args.contexto.read_text(encoding="utf-8")).get("regras") or {}
        except (OSError, json.JSONDecodeError) as e:
            print(f"Aviso: não li o contexto ({e}); usando as regras de referencias/.", file=sys.stderr)

    try:
        cadastro = json.loads(args.cadastro.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"Erro: não encontrei {args.cadastro}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as e:
        print(f"Erro: {args.cadastro} não é um JSON válido ({e})", file=sys.stderr)
        return 1

    try:
        aplicar_opcoes(cadastro, args)
        resumo = calcular_cadastro(cadastro, pol=regras.get("precificacao"), fis=regras.get("fiscal"), sis=regras.get("sistema"))
    except (ErroCadastro, OSError, json.JSONDecodeError) as e:
        print(f"Erro: {e}", file=sys.stderr)
        return 1

    args.cadastro.write_text(json.dumps(cadastro, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.json:
        print(json.dumps(resumo, ensure_ascii=False, indent=2))
    else:
        imprimir_resumo(resumo, cadastro)
    return 0


if __name__ == "__main__":
    sys.exit(main())
