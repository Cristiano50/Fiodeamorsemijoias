"""Custos e preços de um ``cadastro.json`` e o resumo do pedido.

Porta de ``recalcularPedido``, ``custosDoPedido`` e ``resumoPedido`` (``src/lib/servicos.ts``), trocando o banco
pelo ``cadastro.json`` (contrato em ``referencias/formato-cadastro.md``).

Campos do pedido usados:
    ``moeda`` (CNY | USD | BRL; vazio = não identificada), ``cotacao`` (R$ por unidade; BRL = 1),
    ``frete`` (R$ do frete do pedido, ou null), ``fator`` (fator do pedido; null = padrão da loja).
Opcionais (como no app, fora do contrato básico):
    ``cenario`` (id do cenário de custo; padrão ``sistema.cenarioCustoPadrao`` = "mercadoria_frete", ou
    "compra_importador_nacional" quando a moeda é BRL), ``custos`` ({componente: valor} por cima do cenário),
    ``rateio`` ("valor" — padrão — ou "peca").
Campos da peça usados: ``precoOrigem``, ``quantidade``, ``tipo``, ``material``, ``ncm``, ``fator``, ``precoManual``,
``alertas`` e, na recompra, ``recompraDe`` + ``precoVigente`` (preço atual da original no app, que o referencias.py
guarda do contexto): a recompra fica com o preço vigente e ganha o alerta "Custo mudou" quando o preço pelo custo novo
difere mais de 10% (como no app).
Custos padrão da loja (``sistema.perdasPctPadrao`` e ``sistema.embalagemPorPecaPadrao``, do sistema.json do ZIP ou do
contexto do app): entram como "perdas e defeitos" (%) e "embalagem e etiqueta" (R$/peça) quando o pedido não traz
esses valores em ``custos`` — como o app faz nos pedidos novos.
Campos da peça gravados: ``custoProdutoBrl``, ``custoAdicionalBrl``, ``custoTotalBrl``, ``fatorAplicado``,
``precoVenda``, ``precos``, ``ncm``, ``alertas``.

Números que vêm como texto ("10,5", "R$ 1.234,56", "0,7745") são lidos com :func:`numero` (``lerNumeroBr`` do app):
dinheiro aceita ponto de milhar no formato 1.234; cotação e fator não ("0.775" é 0,775, nunca 775).
Quantidade 0 continua 0 (com aviso); sem quantidade conta 1, como no app (com aviso).
Sem cotação (moeda diferente de BRL) os preços ficam pendentes, com aviso: a cotação nunca vira 1.
"""

from __future__ import annotations

from typing import Any

from . import config
from .numeros import ler_numero_br
from .precos import (
    PREFIXOS_ALERTA_PRECO,
    calcular_custos,
    calcular_preco,
    custos_iniciais,
    detalhar_custos,
    fator_abaixo_do_minimo,
    numero_br,
    numero_curto_br,
    numero_js,
    preco_manual_abaixo_do_minimo,
    round_js,
    soma,
    valores_do_cenario,
)

MOEDAS = ("CNY", "USD", "BRL")
CAMPOS_DE_PRECO = ("custoProdutoBrl", "custoAdicionalBrl", "custoTotalBrl", "fatorAplicado", "precoVenda", "precos")


class ErroCadastro(ValueError):
    """Cadastro sem algum dado necessário para o cálculo (mensagem em português, pronta para mostrar)."""


def numero(v: Any, milhar: bool = True) -> float | None:
    """Converte número escrito de qualquer jeito (``10``, ``"10,5"``, ``"R$ 1.234,56"``, ``"0,7745"``).

    Porta de ``lerNumeroBr``. Vazio ou inválido → ``None``. Use ``milhar=False`` para cotação e fator.
    """
    return ler_numero_br(v, milhar=milhar)


def moeda_do_pedido(pedido: dict) -> str | None:
    """Moeda do pedido em maiúsculas (``CNY``, ``USD``, ``BRL``…) ou ``None`` quando não foi identificada."""
    m = str(pedido.get("moeda") or "").strip().upper()
    return m or None


def ler_quantidade(v: Any) -> tuple[int, str | None]:
    """Quantidade da peça para as contas e o aviso que ela pede (ou ``None``).

    0 continua 0 (aviso); vazia ou ilegível conta 1, como no app (aviso); fracionada arredonda como o app.
    """
    if v is None or (isinstance(v, str) and not v.strip()):
        return 1, "sem quantidade: considerei 1 peça; confira no documento."
    n = ler_numero_br(v)
    if n is None:
        return 1, f"quantidade ilegível ({v}): considerei 1 peça; confira no documento."
    if n < 0:
        return 0, f"quantidade negativa ({numero_br(n, 0)}): considerei 0; confira no documento."
    q = int(round_js(n))
    if q != n:
        return q, f"quantidade {numero_br(n, 3).rstrip('0').rstrip(',')} arredondada para {q}; confira no documento."
    if q == 0:
        return 0, "quantidade 0: a peça fica com estoque 0 (não vira 1); confira no documento."
    return q, None


def quantidade(v: Any) -> int:
    """Quantidade usada nas contas (0 continua 0; vazia conta 1) — a mesma no cálculo, na planilha e no resumo."""
    return ler_quantidade(v)[0]


def avisos_de_quantidade(itens: list[dict]) -> list[str]:
    """Avisos das peças com quantidade 0, vazia, ilegível ou fracionada."""
    out = []
    for k, it in enumerate(itens, start=1):
        _, aviso = ler_quantidade(it.get("quantidade"))
        if aviso:
            out.append(f"Linha {it.get('linha') or k}: {aviso}")
    return out


def _r2_simples(v: float) -> float:
    """``Math.round(v * 100) / 100`` (o resumo do app arredonda assim, sem o EPSILON)."""
    return round_js(v * 100) / 100


def escolher_cenario(pedido: dict, padrao: str, cenarios: dict) -> str:
    """Cenário de custo do pedido: o informado (se existir) → BRL usa "compra_importador_nacional" → padrão."""
    if pedido.get("cenario") in cenarios:
        return pedido["cenario"]
    if moeda_do_pedido(pedido) == "BRL" and "compra_importador_nacional" in cenarios:
        return "compra_importador_nacional"
    return padrao if padrao in cenarios else next(iter(cenarios))


def custos_do_pedido(
    pedido: dict, componentes: list[dict], padrao: str, cenarios: dict, sis: dict | None = None
) -> tuple[str, dict]:
    """Valores dos componentes de custo, na ordem do app (importação + ``custosDoPedido``):

    1. os do cenário de custo;
    2. por cima, os iniciais do pedido (:func:`custos_iniciais`): o frete digitado (``pedido.frete``) e os padrões da
       loja (``sis.perdasPctPadrao`` → perdas e defeitos %, ``sis.embalagemPorPecaPadrao`` → embalagem R$/peça),
       só os maiores que zero;
    3. por cima, ``pedido.custos`` (só componentes que existem e valores ≥ 0).

    :return: ``(id_do_cenario, {componente: valor})``
    """
    sis = sis or {}
    cenario = escolher_cenario(pedido, padrao, cenarios)
    valores = valores_do_cenario(componentes, cenarios.get(cenario))
    valores.update(
        custos_iniciais(
            numero(pedido.get("frete")),
            numero(sis.get("perdasPctPadrao"), milhar=False),
            numero(sis.get("embalagemPorPecaPadrao"), milhar=False),
        )
    )
    existentes = {c["id"] for c in componentes}
    for k, v in (pedido.get("custos") or {}).items():
        n = numero(v)
        if k in existentes and n is not None and n >= 0:
            valores[k] = n
    return cenario, valores


def preco_vigente(it: dict) -> float | None:
    """Preço vigente da original (só na recompra): o ``precoVigente`` guardado pelo referencias.py; senão None."""
    if not it.get("recompraDe"):
        return None
    v = numero(it.get("precoVigente"))
    return v if v and v > 0 else None


def aviso_fator_minimo(cadastro: dict, pol: dict) -> str | None:
    """Fator abaixo do mínimo (do pedido ou da peça) e preço manual abaixo dele: no app, só valem se quem importar for
    a gestora. Enviado pela skill (pela chave) ou importado por uma funcionária, o app usa o fator mínimo e descarta o
    preço manual abaixo dele. Devolve o aviso para o resumo, ou None."""
    minimo = numero_js(pol.get("fator_minimo") or 0)
    if not minimo > 0:
        return None
    pedido = cadastro.get("pedido") or {}
    itens = cadastro.get("itens") or []

    def linhas(cond) -> str:
        nums = [str(it.get("linha") or k) for k, it in enumerate(itens, start=1) if cond(it)]
        return ", ".join(nums[:12]) + ("…" if len(nums) > 12 else "") if nums else ""

    def fator_baixo(v) -> bool:
        f = numero(v, milhar=False)
        return bool(f and f > 0 and fator_abaixo_do_minimo(f, pol))

    def manual_baixo(it: dict) -> bool:
        pm = numero(it.get("precoManual"))
        return bool(
            pm and pm > 0 and not it.get("recompraDe")
            and preco_manual_abaixo_do_minimo(pm, numero(it.get("custoTotalBrl")), pol)["abaixo"]
        )

    partes = []
    if fator_baixo(pedido.get("fator")):
        partes.append(f"fator do pedido ×{numero_curto_br(numero(pedido.get('fator'), milhar=False))}")
    if l := linhas(lambda it: fator_baixo(it.get("fator"))):
        partes.append(f"fator da peça na(s) linha(s) {l}")
    if l := linhas(manual_baixo):
        partes.append(f"preço manual abaixo do mínimo na(s) linha(s) {l}")
    if not partes:
        return None
    m = numero_curto_br(minimo)
    return (
        f"Abaixo do fator mínimo da loja (×{m}): {'; '.join(partes)}. No app isso só vale se a gestora importar o "
        "cadastro logada (Importar pedido → Cadastro feito no Claude). Enviado pela skill (app.py enviar) ou importado "
        f"por uma funcionária, o app usa ×{m} e descarta o preço manual abaixo do mínimo: os preços do app ficam "
        "diferentes da planilha da skill."
    )


def aviso_sem_cotacao(pedido: dict) -> str:
    """Explica o que fazer quando falta a cotação (os preços ficam pendentes)."""
    moeda = moeda_do_pedido(pedido)
    data = pedido.get("dataCompra") or "AAAA-MM-DD"
    if not moeda:
        return (
            "Moeda e cotação pendentes: o documento não mostra a moeda (¥/RMB/元, US$ ou R$). Pergunte à pessoa, "
            "rode calcular.py com --moeda CNY|USD|BRL e a cotação (--ptax ou --cotacao). Preços pendentes."
        )
    return (
        f"Falta a cotação do pedido ({moeda} → R$): preços pendentes (a cotação nunca vira 1). "
        f"Rode scripts/ptax.py {data} --moeda {moeda} e calcular.py com --ptax, ou informe --cotacao (ex.: 0,7745)."
    )


def calcular_cadastro(
    cadastro: dict,
    pol: dict | None = None,
    fis: dict | None = None,
    sis: dict | None = None,
    componentes: list[dict] | None = None,
) -> dict:
    """Calcula custo e preço de todas as peças do cadastro (altera ``cadastro`` no lugar) e devolve o resumo.

    Regra da loja (cenário "mercadoria_frete"): custo = preço × cotação × (1 + frete ÷ mercadoria em R$);
    preço = custo × fator, arredondado na escada de preços (,99; mínimo R$ 19,99). Prioridade do fator:
    preço manual → fator da peça → fator do pedido → faixas → tipo → padrão. Alertas que não são de preço são
    preservados.

    Sem cotação (moeda diferente de BRL, ou moeda não identificada), como no app: custos pendentes (vazios); o preço
    fica pendente (alerta "Sem cotação: preço pendente."), salvo o preço manual, que continua valendo (alerta
    "Sem cotação: custo pendente."). O resumo vem com ``cotacaoPendente: True`` e o aviso do que fazer.
    """
    pol = config.precificacao() if pol is None else pol
    fis = config.fiscal() if fis is None else fis
    sis = config.sistema() if sis is None else sis
    componentes = config.componentes_custo(fis, pol) if componentes is None else componentes
    padrao, cenarios = config.cenarios(fis, sis, componentes)

    pedido = cadastro.setdefault("pedido", {})
    itens = cadastro.setdefault("itens", [])
    moeda = moeda_do_pedido(pedido)
    if moeda == "BRL":
        cotacao: float | None = 1.0
        pedido["cotacao"] = 1
    else:
        cotacao = numero(pedido.get("cotacao"), milhar=False)
    pendente = not cotacao or cotacao <= 0
    avisos = avisos_de_quantidade(itens)
    if not moeda:
        avisos.insert(
            0,
            "Moeda do pedido não identificada no documento (sem ¥/RMB/元, US$ ou R$): confirme com a pessoa e use "
            "calcular.py --moeda CNY|USD|BRL.",
        )
    elif moeda not in MOEDAS:
        avisos.insert(0, f"Moeda {moeda} fora das moedas do app (CNY, USD, BRL): confira.")
    fator_pedido = numero(pedido.get("fator"), milhar=False)
    rateio = pedido.get("rateio") or "valor"
    cenario, valores = custos_do_pedido(pedido, componentes, padrao, cenarios, sis)
    ncm_padrao = sis.get("ncmPadrao") or "71171900"

    if pendente:
        avisos.insert(0, aviso_sem_cotacao(pedido))
        for it in itens:
            outros = [a for a in (it.get("alertas") or []) if not str(a).startswith(PREFIXOS_ALERTA_PRECO)]
            it["ncm"] = it.get("ncm") or config.ncm_para(fis, it.get("tipo"), it.get("material"), ncm_padrao)
            for campo in CAMPOS_DE_PRECO:
                it[campo] = None
            manual = numero(it.get("precoManual"))
            vigente = preco_vigente(it)
            if (manual and manual > 0) or vigente:
                # Preço fixado à mão ou vigente da recompra não depende da cotação: continua valendo (o custo é que
                # fica pendente).
                p = calcular_preco(0, it.get("tipo"), pol, fator_manual=numero(it.get("fator"), milhar=False),
                                   fator_pedido=fator_pedido, preco_manual=manual, preco_vigente=vigente)
                it["fatorAplicado"], it["precoVenda"], it["precos"] = p["fator"], p["preco"], p["precos"]
                it["alertas"] = outros + ["Sem cotação: custo pendente."]
            else:
                it["alertas"] = outros + ["Sem cotação: preço pendente."]
        if aviso := aviso_fator_minimo(cadastro, pol):
            avisos.append(aviso)
        return resumo_pedido(cadastro, pol, componentes, cenario, valores, cenarios, avisos=avisos, pendente=True)

    entradas = [
        {"id": k, "precoOrigem": numero(it.get("precoOrigem")), "quantidade": quantidade(it.get("quantidade"))}
        for k, it in enumerate(itens)
    ]
    custos = calcular_custos(entradas, {"cotacao": cotacao, "custos": valores, "rateio": rateio}, componentes)

    for k, it in enumerate(itens):
        c = custos[k]
        p = calcular_preco(
            c["custoTotalBrl"],
            it.get("tipo"),
            pol,
            fator_manual=numero(it.get("fator"), milhar=False),
            fator_pedido=fator_pedido,
            preco_manual=numero(it.get("precoManual")),
            preco_vigente=preco_vigente(it),  # recompra: fica o preço da original (alerta "Custo mudou" > 10%)
        )
        it["custoProdutoBrl"] = c["custoProdutoBrl"]
        it["custoAdicionalBrl"] = c["custoAdicionalBrl"]
        it["custoTotalBrl"] = c["custoTotalBrl"]
        it["fatorAplicado"] = p["fator"]
        it["precoVenda"] = p["preco"]
        it["precos"] = p["precos"]
        it["ncm"] = it.get("ncm") or config.ncm_para(fis, it.get("tipo"), it.get("material"), ncm_padrao)
        antigos = [a for a in (it.get("alertas") or []) if not str(a).startswith(PREFIXOS_ALERTA_PRECO)]
        it["alertas"] = antigos + p["alertas"]

    if aviso := aviso_fator_minimo(cadastro, pol):
        avisos.append(aviso)
    return resumo_pedido(cadastro, pol, componentes, cenario, valores, cenarios, avisos=avisos)


def resumo_pedido(
    cadastro: dict,
    pol: dict,
    componentes: list[dict],
    cenario: str,
    valores: dict,
    cenarios: dict | None = None,
    avisos: list[str] | None = None,
    pendente: bool = False,
) -> dict:
    """Resumo numérico do pedido (porta de ``resumoPedido``): linhas, peças, mercadoria, frete, custo, venda, markup.

    Mais ``cotacaoPendente`` (preços não calculados por falta de cotação) e ``avisos`` (cotação, moeda e
    quantidades que precisam de conferência).
    """
    pedido = cadastro.get("pedido") or {}
    itens = cadastro.get("itens") or []
    comissao = (pol.get("comissao_consignacao_pct") or 0) / 100
    cotacao = 0.0 if pendente else (numero(pedido.get("cotacao"), milhar=False) or 0.0)

    qtds = [quantidade(p.get("quantidade")) for p in itens]
    pecas = 0
    for q in qtds:
        pecas += q
    total_origem = soma((numero(p.get("precoOrigem")) or 0) * q for p, q in zip(itens, qtds))
    custo_total = soma((p.get("custoTotalBrl") or 0) * q for p, q in zip(itens, qtds))
    venda = soma((p.get("precoVenda") or 0) * q for p, q in zip(itens, qtds))
    detalhe = detalhar_custos(
        [{"id": k, "precoOrigem": numero(p.get("precoOrigem")), "quantidade": q} for k, (p, q) in enumerate(zip(itens, qtds))],
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
        "moeda": moeda_do_pedido(pedido),
        "cotacao": cotacao,
        "cotacaoPendente": pendente,
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
        "fatorPedido": numero(pedido.get("fator"), milhar=False),
        "fatorPadrao": pol.get("fator_padrao"),
        "semPreco": sum(1 for p in itens if not numero(p.get("precoOrigem"))),
        "comAlerta": sum(1 for p in itens if p.get("alertas")),
        "avisos": list(avisos or []),
    }
