#!/usr/bin/env python3
"""Calcula custo e preço de todas as peças do ``cadastro.json`` e mostra o resumo do pedido.

Uso:
    python3 calcular.py PASTA/cadastro.json [--cotacao 0,7745] [--frete 850] [--fator 10] [--moeda CNY] [--json]
    python3 ptax.py 2026-09-26 | python3 calcular.py PASTA/cadastro.json --ptax -
    python3 calcular.py PASTA/cadastro.json --contexto PASTA/contexto.json   (regras atuais do app)

Mesmas regras do app (src/lib/precos.ts + recalcularPedido):
    custo da peça = preço × cotação × (1 + frete ÷ valor da mercadoria em R$)   (pedido.frete em R$)
    preço         = custo × fator, no preço possível mais próximo da escada (sempre ,99; mínimo R$ 19,99):
                    de 5 em 5 até 49,99; de 10 em 10 até 99,99; de 20 em 20 até 199,99; de 50 em 50 até 399,99;
                    de 100 em 100 acima; empate fica com o maior
    fator         = preço manual → fator da peça → fator do pedido → faixas → tipo → padrão (10)
Grava de volta em cada peça: custoProdutoBrl, custoAdicionalBrl, custoTotalBrl, fatorAplicado, precoVenda,
precos (todas as tabelas), ncm e alertas (os alertas que não são de preço são mantidos).

As opções --cotacao/--ptax/--frete/--fator/--moeda gravam o valor no pedido antes de calcular. Números podem vir
do jeito brasileiro ("850,50", "1.500") ou não ("850.50"); cotação e fator nunca têm milhar ("0.775" = 0,775).

Sem cotação (moeda diferente de BRL), a cotação NUNCA vira 1: o script busca a PTAX da data da compra (as mesmas
fontes do ptax.py; --sem-busca desliga) e, se não conseguir, deixa os preços pendentes, com aviso.

Códigos de saída: 0 = ok; 1 = erro (arquivo ou opção inválida); 2 = preços pendentes (falta a cotação ou a moeda).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fiodeamor import config  # noqa: E402
from fiodeamor.calculo import MOEDAS, ErroCadastro, calcular_cadastro, moeda_do_pedido, numero  # noqa: E402
from fiodeamor.cambio import buscar_cotacao  # noqa: E402
from fiodeamor.precos import brl, dinheiro, numero_br  # noqa: E402


def _ler_ptax(origem: str) -> dict:
    """Lê a saída JSON de ptax.py (arquivo ou ``-`` para a entrada padrão)."""
    texto = sys.stdin.read() if origem == "-" else Path(origem).read_text(encoding="utf-8")
    dados = json.loads(texto)
    if not isinstance(dados, dict) or not numero(dados.get("cotacao"), milhar=False):
        raise ErroCadastro("A saída do ptax.py não tem cotação (a busca falhou?). Informe com --cotacao.")
    return dados


def aplicar_opcoes(cadastro: dict, args: argparse.Namespace) -> None:
    """Grava no pedido os valores passados na linha de comando."""
    pedido = cadastro.setdefault("pedido", {})
    if getattr(args, "moeda", None):
        moeda = args.moeda.strip().upper()
        if moeda not in MOEDAS:
            raise ErroCadastro(f"Moeda inválida: {args.moeda!r} (use CNY, USD ou BRL).")
        pedido["moeda"] = moeda
    if args.ptax:
        c = _ler_ptax(args.ptax)
        moeda_ptax = str(c.get("moeda") or "").upper()
        moeda = moeda_do_pedido(pedido)
        if moeda_ptax and moeda and moeda_ptax != moeda:
            raise ErroCadastro(f"A cotação é de {moeda_ptax}, mas o pedido está em {moeda}.")
        if moeda_ptax and not moeda:
            pedido["moeda"] = moeda_ptax  # o documento não mostrava a moeda: vale a da cotação buscada
        pedido["cotacao"] = numero(c["cotacao"], milhar=False)
        pedido["cotacaoFonte"] = c.get("fonte")
        pedido["cotacaoData"] = c.get("data")
    if args.cotacao is not None:
        valor = numero(args.cotacao, milhar=False)
        if not valor or valor <= 0:
            raise ErroCadastro(f"Cotação inválida: {args.cotacao!r}")
        pedido["cotacao"] = valor
        pedido["cotacaoFonte"] = "Informada manualmente"
        pedido["cotacaoData"] = pedido.get("cotacaoData") or pedido.get("dataCompra")
    if args.frete is not None:
        valor = numero(args.frete)
        pedido["frete"] = valor if valor and valor > 0 else None
    if args.fator is not None:
        valor = numero(args.fator, milhar=False)
        pedido["fator"] = valor if valor and valor > 0 else None


def falta_cotacao(pedido: dict) -> bool:
    """O pedido precisa de cotação e não tem (BRL não precisa: é sempre 1)."""
    if moeda_do_pedido(pedido) == "BRL":
        return False
    c = numero(pedido.get("cotacao"), milhar=False)
    return not c or c <= 0


def buscar_ptax(pedido: dict, tipo: str, avisar=print) -> bool:
    """Falta a cotação: busca a PTAX da data da compra (fontes do ptax.py). Grava no pedido e devolve True se achou."""
    moeda, data = moeda_do_pedido(pedido), str(pedido.get("dataCompra") or "")
    if not moeda or moeda == "BRL":
        return False
    try:
        date.fromisoformat(data)
    except ValueError:
        return False
    c, erros, _ = buscar_cotacao(moeda, data, tipo)
    if not c:
        avisar(f"Não consegui buscar a PTAX de {moeda} para {data}" + (f" ({'; '.join(erros)})" if erros else "") + ".")
        return False
    pedido["cotacao"] = c["cotacao"]
    pedido["cotacaoFonte"] = c.get("fonte")
    pedido["cotacaoData"] = c.get("data")
    avisar(f"Cotação buscada: {moeda} {numero_br(c['cotacao'], 4)} ({c.get('fonte')}, {c.get('data')}).")
    return True


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
    if r.get("cotacaoPendente"):
        print("Cotação: PENDENTE — custos e preços não foram calculados.")
    else:
        p = cadastro.get("pedido") or {}
        fonte = ", ".join(str(x) for x in (p.get("cotacaoFonte"), p.get("cotacaoData")) if x)
        print(f"Cotação: {r['moeda'] or 'moeda não informada'} {numero_br(r['cotacao'], 4)}" + (f" ({fonte})" if fonte else ""))
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
    for aviso in r.get("avisos") or []:
        print(f"⚠ {aviso}")
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
    ap.add_argument("--moeda", help="moeda do pedido (CNY, USD ou BRL), quando o documento não mostra")
    ap.add_argument("--sem-busca", action="store_true", help="não busca a PTAX na internet quando falta a cotação")
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
        pedido = cadastro.setdefault("pedido", {})
        if falta_cotacao(pedido) and not args.sem_busca:
            sis = regras.get("sistema") or config.sistema()
            buscar_ptax(pedido, sis.get("tipoCotacao") or "venda", avisar=lambda m: print(m, file=sys.stderr))
        resumo = calcular_cadastro(cadastro, pol=regras.get("precificacao"), fis=regras.get("fiscal"), sis=regras.get("sistema"))
    except (ErroCadastro, OSError, json.JSONDecodeError) as e:
        print(f"Erro: {e}", file=sys.stderr)
        return 1

    args.cadastro.write_text(json.dumps(cadastro, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.json:
        print(json.dumps(resumo, ensure_ascii=False, indent=2))
    else:
        imprimir_resumo(resumo, cadastro)
    if resumo.get("cotacaoPendente"):
        if args.json:  # no modo texto o aviso já saiu no resumo
            print(f"Preços pendentes: {resumo['avisos'][0]}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
