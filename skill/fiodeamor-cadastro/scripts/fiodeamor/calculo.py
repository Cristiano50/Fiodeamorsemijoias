"""Custos e preços de um ``cadastro.json`` e o resumo do pedido.

Porta de ``recalcularPedido``, ``custosDoPedido`` e ``resumoPedido`` (``src/lib/servicos.ts``), trocando o banco
pelo ``cadastro.json`` (contrato em ``referencias/formato-cadastro.md``).

Campos do pedido usados:
    ``moeda``, ``cotacao`` (R$ por unidade; BRL = 1), ``frete`` (R$ do frete do pedido, ou null),
    ``fator`` (fator do pedido; null = padrão da loja).
Opcionais (como no app, fora do contrato básico):
    ``cenario`` (id do cenário de custo; padrão ``sistema.cenarioCustoPadrao`` = "mercadoria_frete", ou
    "compra_importador_nacional" quando a moeda é BRL), ``custos`` ({componente: valor} por cima do cenário),
    ``rateio`` ("valor" — padrão — ou "peca").
Campos da peça usados: ``precoOrigem``, ``quantidade``, ``tipo``, ``material``, ``ncm``, ``fator``, ``precoManual``,
``alertas``.
Campos da peça gravados: ``custoProdutoBrl``, ``custoAdicionalBrl``, ``custoTotalBrl``, ``fatorAplicado``,
``precoVenda``, ``precos``, ``ncm``, ``alertas``.
"""

from __future__ import annotations

import math
import re
from typing import Any

from . import config
from .precos import (
    PREFIXOS_ALERTA_PRECO,
    calcular_custos,
    calcular_preco,
    detalhar_custos,
    round_js,
    soma,
    valores_do_cenario,
)


class ErroCadastro(ValueError):
    """Cadastro sem algum dado necessário para o cálculo (mensagem em português, pronta para mostrar)."""


def numero(v: Any) -> float | None:
    """Converte número escrito de qualquer jeito (``10``, ``"10,5"``, ``"R$ 1.234,56"``, ``"0.7745"``).

    Vazio ou inválido → ``None``.
    """
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return None if isinstance(v, float) and math.isnan(v) else float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v))
    if not s:
        return None
    if "," in s and "." in s:  # 1.234,56 (padrão brasileiro)
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    elif re.fullmatch(r"-?\d{1,3}(?:\.\d{3})+", s):  # 1.500 = mil e quinhentos (como o campo Frete do app)
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


def _r2_simples(v: float) -> float:
    """``Math.round(v * 100) / 100`` (o resumo do app arredonda assim, sem o EPSILON)."""
    return round_js(v * 100) / 100


def escolher_cenario(pedido: dict, padrao: str, cenarios: dict) -> str:
    """Cenário de custo do pedido: o informado (se existir) → BRL usa "compra_importador_nacional" → padrão."""
    if pedido.get("cenario") in cenarios:
        return pedido["cenario"]
    if (pedido.get("moeda") or "").upper() == "BRL" and "compra_importador_nacional" in cenarios:
        return "compra_importador_nacional"
    return padrao if padrao in cenarios else next(iter(cenarios))


def custos_do_pedido(pedido: dict, componentes: list[dict], padrao: str, cenarios: dict) -> tuple[str, dict]:
    """Valores dos componentes de custo: os do cenário + ``pedido.custos`` + o frete digitado (``pedido.frete``).

    :return: ``(id_do_cenario, {componente: valor})``
    """
    cenario = escolher_cenario(pedido, padrao, cenarios)
    valores = valores_do_cenario(componentes, cenarios.get(cenario))
    valores.update(pedido.get("custos") or {})
    frete = numero(pedido.get("frete"))
    if frete is not None:
        valores["frete_internacional"] = max(frete, 0.0)
    return cenario, valores


def calcular_cadastro(
    cadastro: dict,
    pol: dict | None = None,
    fis: dict | None = None,
    sis: dict | None = None,
    componentes: list[dict] | None = None,
) -> dict:
    """Calcula custo e preço de todas as peças do cadastro (altera ``cadastro`` no lugar) e devolve o resumo.

    Regra da loja (cenário "mercadoria_frete"): custo = preço × cotação × (1 + frete ÷ mercadoria em R$);
    preço = custo × fator, para cima terminando em ,99. Prioridade do fator: preço manual → fator da peça →
    fator do pedido → faixas → tipo → padrão. Alertas que não são de preço são preservados.

    :raises ErroCadastro: quando falta a cotação (moeda diferente de BRL).
    """
    pol = config.precificacao() if pol is None else pol
    fis = config.fiscal() if fis is None else fis
    sis = config.sistema() if sis is None else sis
    componentes = config.componentes_custo(fis, pol) if componentes is None else componentes
    padrao, cenarios = config.cenarios(fis, sis, componentes)

    pedido = cadastro.setdefault("pedido", {})
    itens = cadastro.setdefault("itens", [])
    moeda = (pedido.get("moeda") or "CNY").upper()
    cotacao = numero(pedido.get("cotacao"))
    if moeda == "BRL" and not cotacao:
        cotacao = 1.0
        pedido["cotacao"] = 1
    if not cotacao or cotacao <= 0:
        raise ErroCadastro(
            f"Falta a cotação do pedido ({moeda} → R$). Rode scripts/ptax.py com a data da compra "
            "ou informe a cotação (ex.: calcular.py cadastro.json --cotacao 0,7745)."
        )
    fator_pedido = numero(pedido.get("fator"))
    rateio = pedido.get("rateio") or "valor"
    cenario, valores = custos_do_pedido(pedido, componentes, padrao, cenarios)

    entradas = []
    for k, it in enumerate(itens):
        preco = numero(it.get("precoOrigem"))
        qtd = it.get("quantidade")
        qtd = 1 if qtd is None else int(numero(qtd) or 0)
        entradas.append({"id": k, "precoOrigem": preco, "quantidade": qtd})
    custos = calcular_custos(entradas, {"cotacao": cotacao, "custos": valores, "rateio": rateio}, componentes)

    for k, it in enumerate(itens):
        c = custos[k]
        p = calcular_preco(
            c["custoTotalBrl"],
            it.get("tipo"),
            pol,
            fator_manual=numero(it.get("fator")),
            fator_pedido=fator_pedido,
            preco_manual=numero(it.get("precoManual")),
        )
        it["custoProdutoBrl"] = c["custoProdutoBrl"]
        it["custoAdicionalBrl"] = c["custoAdicionalBrl"]
        it["custoTotalBrl"] = c["custoTotalBrl"]
        it["fatorAplicado"] = p["fator"]
        it["precoVenda"] = p["preco"]
        it["precos"] = p["precos"]
        it["ncm"] = it.get("ncm") or config.ncm_para(fis, it.get("tipo"), it.get("material"), sis.get("ncmPadrao") or "71171900")
        antigos = [a for a in (it.get("alertas") or []) if not str(a).startswith(PREFIXOS_ALERTA_PRECO)]
        it["alertas"] = antigos + p["alertas"]

    return resumo_pedido(cadastro, pol, componentes, cenario, valores, cenarios)


def resumo_pedido(
    cadastro: dict,
    pol: dict,
    componentes: list[dict],
    cenario: str,
    valores: dict,
    cenarios: dict | None = None,
) -> dict:
    """Resumo numérico do pedido (porta de ``resumoPedido``): linhas, peças, mercadoria, frete, custo, venda, markup."""
    pedido = cadastro.get("pedido") or {}
    itens = cadastro.get("itens") or []
    comissao = (pol.get("comissao_consignacao_pct") or 0) / 100
    cotacao = numero(pedido.get("cotacao")) or 0.0

    def qtd(p: dict) -> int:
        q = p.get("quantidade")
        return 1 if q is None else int(numero(q) or 0)

    pecas = 0
    for p in itens:
        pecas += qtd(p)
    total_origem = soma((numero(p.get("precoOrigem")) or 0) * qtd(p) for p in itens)
    custo_total = soma((p.get("custoTotalBrl") or 0) * qtd(p) for p in itens)
    venda = soma((p.get("precoVenda") or 0) * qtd(p) for p in itens)
    detalhe = detalhar_custos(
        [{"id": k, "precoOrigem": numero(p.get("precoOrigem")), "quantidade": qtd(p)} for k, p in enumerate(itens)],
        {"cotacao": cotacao, "custos": valores},
        componentes,
    )
    total_doc = numero(pedido.get("totalDocumento"))
    frete = numero(valores.get("frete_internacional")) or 0.0
    mercadoria = detalhe["mercadoriaBrl"]
    tabela_base = next((t for t in pol.get("tabelas_preco") or [] if t.get("id") == pol.get("tabela_base")), None)
    diferenca = _r2_simples(total_origem - total_doc) if total_doc is not None else None
    return {
        "numero": pedido.get("numero"),
        "fornecedor": pedido.get("fornecedor"),
        "moeda": (pedido.get("moeda") or "CNY").upper(),
        "cotacao": cotacao,
        "cenario": cenario,
        "cenarioNome": ((cenarios or {}).get(cenario) or {}).get("nome"),
        "rateio": pedido.get("rateio") or "valor",
        "linhas": len(itens),
        "pecas": pecas,
        "totalOrigem": _r2_simples(total_origem),
        "totalDocumento": total_doc,
        "diferencaDocumento": diferenca,
        "confereDocumento": None if diferenca is None else abs(diferenca) < 0.05,
        "mercadoriaBrl": mercadoria,
        "freteBrl": frete,
        "fretePct": _r2_simples(frete / mercadoria * 100) if mercadoria > 0 else 0,
        "custosAdicionais": detalhe["linhas"],
        "adicionaisBrl": detalhe["adicionaisBrl"],
        "porPecaBrl": detalhe["porPecaBrl"],
        "fatorCusto": detalhe["fatorCusto"],
        "custoTotal": _r2_simples(custo_total),
        "vendaPotencial": _r2_simples(venda),
        "tabelaBase": (tabela_base or {}).get("nome") or pol.get("tabela_base"),
        "receitaLiquidaPotencial": _r2_simples(venda * (1 - comissao)),
        "margemBrutaPct": (
            _r2_simples(((venda * (1 - comissao) - custo_total) / (venda * (1 - comissao))) * 100) if venda > 0 else 0
        ),
        "fatorMedio": _r2_simples(venda / custo_total) if custo_total > 0 else 0,
        "fatorPedido": numero(pedido.get("fator")),
        "fatorPadrao": pol.get("fator_padrao"),
        "semPreco": sum(1 for p in itens if not numero(p.get("precoOrigem"))),
        "comAlerta": sum(1 for p in itens if p.get("alertas")),
    }
