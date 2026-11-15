"""Custos e precificação — porta fiel de ``src/lib/precos.ts`` do app.

Funções puras. A política padrão vem de ``referencias/precificacao.json`` (administrador) e
``referencias/fiscal.json`` (contador). Os dicionários de entrada e saída usam os mesmos nomes de campo do app
(``precoOrigem``, ``custoTotalBrl``, ``origemFator``...).

Para dar exatamente os mesmos centavos do app, a aritmética imita o JavaScript:
``Math.round`` arredonda 0,5 para cima (o ``round`` do Python arredonda para o par) e as somas são feitas
uma a uma, da esquerda para a direita (o ``sum`` do Python 3.12+ usa soma compensada).

Correspondência de nomes: detalharCustos → :func:`detalhar_custos`, calcularCustos → :func:`calcular_custos`,
valoresDoCenario → :func:`valores_do_cenario`, arredondar → :func:`arredondar`,
escolherFator → :func:`escolher_fator`, calcularPreco → :func:`calcular_preco`.
"""

from __future__ import annotations

import math
import sys
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Iterable

from .numeros import texto_numero_js

EPSILON = sys.float_info.epsilon  # Number.EPSILON

# Componentes de valor fixo do pedido (podem ser rateados por peça).
FIXOS_CONHECIDOS = ["frete_internacional", "taxa_siscomex", "desembaraco_despachante", "frete_nacional"]
FORMULA_CONHECIDA = {
    "taxa_agente", "frete_internacional", "seguro_internacional", "spread_cambio", "iof_cambio", "imposto_importacao",
    "ipi_importacao", "pis_importacao", "cofins_importacao", "taxa_siscomex", "desembaraco_despachante",
    "icms_importacao", "frete_nacional", "perdas_defeitos", "embalagem_etiqueta",
}

# Diferença acima da qual a recompra avisa "Custo mudou" (preço calculado × preço vigente do original), em %.
LIMITE_CUSTO_MUDOU_PCT = 10

# Prefixos dos alertas criados pelo cálculo de preço (os demais alertas da peça são preservados no recálculo).
# (mesma lista do app: src/lib/precos.ts)
PREFIXOS_ALERTA_PRECO = ("Margem", "Tabela", "Sem custo", "Fator ×", "Preço manual abaixo", "Custo mudou", "Sem cotação")


# ------------------------------------------------------------------ aritmética no estilo JavaScript


def round_js(x: float) -> float:
    """``Math.round`` do JavaScript: o mais próximo; empate (x,5) vai para +∞."""
    if math.isnan(x) or math.isinf(x):
        return x
    f = math.floor(x)
    return float(f + 1 if x - f >= 0.5 else f)


def r2(v: float) -> float:
    """Arredonda para centavos como o app: ``Math.round((v + Number.EPSILON) * 100) / 100``."""
    return round_js((v + EPSILON) * 100) / 100


def soma(valores: Iterable[float]) -> float:
    """Soma da esquerda para a direita, como ``reduce`` do JavaScript (sem soma compensada)."""
    s = 0.0
    for v in valores:
        s += v
    return s


def numero_js(v: Any) -> float:
    """``Number(v) || 0``: converte para número; vazio, inválido ou NaN viram 0."""
    if v is None or isinstance(v, bool) and not v:
        return 0.0
    try:
        x = float(v)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if math.isnan(x) else x


def texto_numero(v: Any) -> str:
    """Escreve um número como o JavaScript num template (``10.0`` → ``"10"``, ``8.36`` → ``"8.36"``)."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return texto_numero_js(v)
    return str(v)


def to_fixed(v: float, casas: int = 0) -> str:
    """``Number.prototype.toFixed`` (empate arredonda para longe do zero, sobre o valor binário exato)."""
    q = Decimal(1).scaleb(-casas)
    return str(Decimal(v).quantize(q, rounding=ROUND_HALF_UP))


def numero_curto_br(v: float) -> str:
    """``v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })``: até 2 casas, sem zeros à direita (``0,13``,
    ``10``, ``1.234,5``). Arredonda a partir do número escrito (1,005 → 1,01), como o JavaScript."""
    d = Decimal(texto_numero_js(abs(float(v)))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    inteiro, _, decimais = f"{d:f}".partition(".")
    decimais = decimais.rstrip("0")
    sinal = "-" if v < 0 else ""
    return f"{sinal}{int(inteiro):,}".replace(",", ".") + (f",{decimais}" if decimais else "")


def brl_js(v: float) -> str:
    """``v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })``: ``R$ 1.234,50`` com espaço que não
    quebra (U+00A0) depois do R$, sempre 2 casas, arredondando a partir do número escrito (como o JavaScript)."""
    d = Decimal(texto_numero_js(abs(float(v)))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    inteiro, _, decimais = f"{d:f}".partition(".")
    return ("-" if v < 0 else "") + "R$\u00a0" + f"{int(inteiro):,}".replace(",", ".") + "," + (decimais or "00")


def _positivo(v: Any) -> bool:
    """Equivale a ``v && v > 0`` do app."""
    try:
        return bool(v) and float(v) > 0
    except (TypeError, ValueError):
        return False


# ------------------------------------------------------------------ custos


def detalhar_custos(itens: list[dict], pedido: dict, componentes: list[dict]) -> dict:
    """Custo de aquisição do pedido (fórmula do contador — docs/especialistas/contador.md).

    * M = Σ preço × cotação × qtd
    * EXT (pago ao exterior) = M + agente + frete internacional + seguro → spread → IOF sobre (EXT + spread)
    * VA (valor aduaneiro) = M + frete + seguro → II, IPI, PIS, COFINS; ICMS "por dentro"
    * fator de custo = (M + adicionais) / M; custo da peça = preço × cotação × fator + custos por peça.

    Componentes fora da fórmula entram pelo tipo (percentual sobre M, fixo do pedido, por peça).

    :param itens: ``[{"id", "precoOrigem", "quantidade"}]``
    :param pedido: ``{"cotacao": float, "custos": {id_componente: valor} | None}``
    :param componentes: componentes de custo (``config.componentes_custo()``)
    :return: ``{mercadoriaBrl, pecas, linhas: [{id, nome, valor}], adicionaisBrl, porPecaBrl, fatorCusto,
              custoTotalPedidoBrl}``
    """
    valores = pedido.get("custos") or {}
    cotacao = numero_js(pedido.get("cotacao"))
    por_id = {}
    for c in componentes:
        por_id.setdefault(c["id"], c)

    def v(id_: str) -> float:
        c = por_id.get(id_)
        if not c:
            return 0.0
        bruto = valores.get(id_)
        if bruto is None:
            bruto = c.get("padrao")
        return numero_js(bruto if bruto is not None else 0)

    def pct(id_: str) -> float:
        return v(id_) / 100

    M = soma((i.get("precoOrigem") or 0) * cotacao * (i.get("quantidade") or 0) for i in itens)
    pecas = 0
    for i in itens:
        pecas += i.get("quantidade") or 0

    agente = M * pct("taxa_agente")
    frete = v("frete_internacional")
    seguro = M * pct("seguro_internacional")
    ext = M + agente + frete + seguro
    spread = ext * pct("spread_cambio")
    iof = (ext + spread) * pct("iof_cambio")
    va = M + frete + seguro
    ii = va * pct("imposto_importacao")
    ipi = (va + ii) * pct("ipi_importacao")
    pis = va * pct("pis_importacao")
    cofins = va * pct("cofins_importacao")
    siscomex = v("taxa_siscomex")
    aliq_icms = pct("icms_importacao")
    icms = ((va + ii + ipi + pis + cofins + siscomex) / (1 - aliq_icms)) * aliq_icms if 0 < aliq_icms < 1 else 0.0
    valores_formula = {
        "taxa_agente": agente,
        "frete_internacional": frete,
        "seguro_internacional": seguro,
        "spread_cambio": spread,
        "iof_cambio": iof,
        "imposto_importacao": ii,
        "ipi_importacao": ipi,
        "pis_importacao": pis,
        "cofins_importacao": cofins,
        "taxa_siscomex": siscomex,
        "desembaraco_despachante": v("desembaraco_despachante"),
        "icms_importacao": icms,
        "frete_nacional": v("frete_nacional"),
        "perdas_defeitos": M * pct("perdas_defeitos"),
    }

    linhas: list[dict] = []
    por_peca = v("embalagem_etiqueta")
    for c in componentes:
        if c["id"] == "embalagem_etiqueta":
            continue
        valor = 0.0
        if c["id"] in FORMULA_CONHECIDA:
            valor = valores_formula.get(c["id"], 0.0)
        elif c.get("tipo") == "percentual":
            valor = M * pct(c["id"])
        elif c.get("tipo") == "valor_fixo_pedido":
            valor = v(c["id"])
        elif c.get("tipo") == "valor_por_peca":
            por_peca += v(c["id"])
            continue
        if valor and not math.isnan(valor):
            linhas.append({"id": c["id"], "nome": c.get("nome", c["id"]), "valor": r2(valor)})
    adicionais = soma(l["valor"] for l in linhas)
    return {
        "mercadoriaBrl": r2(M),
        "pecas": pecas,
        "linhas": linhas,
        "adicionaisBrl": r2(adicionais),
        "porPecaBrl": r2(por_peca),
        "fatorCusto": round_js(((M + adicionais) / M) * 10000) / 10000 if M > 0 else 1,
        "custoTotalPedidoBrl": r2(M + adicionais + por_peca * pecas),
    }


def calcular_custos(itens: list[dict], pedido: dict, componentes: list[dict]) -> dict[Any, dict]:
    """Custo unitário de cada item, rateando os adicionais por valor (recomendado) ou os fixos por peça.

    :param pedido: ``{"cotacao", "custos", "rateio": "valor" | "peca"}``
    :return: ``{id: {custoProdutoBrl, custoAdicionalBrl, custoTotalBrl}}``
    """
    d = detalhar_custos(itens, pedido, componentes)
    tipos = {}
    for c in componentes:
        tipos.setdefault(c["id"], c.get("tipo"))
    fixos = 0.0
    if pedido.get("rateio") == "peca":
        fixos = soma(
            l["valor"] for l in d["linhas"] if l["id"] in FIXOS_CONHECIDOS or tipos.get(l["id"]) == "valor_fixo_pedido"
        )
    proporcional = d["adicionaisBrl"] - fixos
    fator_prop = (d["mercadoriaBrl"] + proporcional) / d["mercadoriaBrl"] if d["mercadoriaBrl"] > 0 else 1
    fixo_por_peca = fixos / d["pecas"] if d["pecas"] > 0 else 0

    cotacao = numero_js(pedido.get("cotacao"))
    saida: dict[Any, dict] = {}
    for i in itens:
        produto = (i.get("precoOrigem") or 0) * cotacao
        total = produto * fator_prop + fixo_por_peca + d["porPecaBrl"]
        saida[i["id"]] = {
            "custoProdutoBrl": r2(produto),
            "custoAdicionalBrl": r2(total - produto),
            "custoTotalBrl": r2(total),
        }
    return saida


def custos_iniciais(frete: float | None = None, perdas_pct: float | None = None, embalagem_por_peca: float | None = None) -> dict:
    """Valores iniciais dos componentes de custo de um pedido novo (porta de ``custosIniciais``): o frete digitado e os
    padrões da loja (perdas e defeitos %, embalagem e etiqueta R$/peça). Só entra o que for maior que zero."""
    c: dict[str, float] = {}
    if frete is not None and frete > 0:
        c["frete_internacional"] = frete
    if perdas_pct is not None and perdas_pct > 0:
        c["perdas_defeitos"] = perdas_pct
    if embalagem_por_peca is not None and embalagem_por_peca > 0:
        c["embalagem_etiqueta"] = embalagem_por_peca
    return c


def valores_do_cenario(componentes: list[dict], cenario: dict | None = None) -> dict[str, float]:
    """Aplica um cenário de importação (valores do contador) sobre os padrões dos componentes."""
    out = {c["id"]: (c.get("padrao") if c.get("padrao") is not None else 0) for c in componentes}
    out.update((cenario or {}).get("valores") or {})
    return out


# ------------------------------------------------------------------ preço


def centavos(v: Any) -> int:
    """Valor em centavos inteiros, arredondado como o ``r2`` do app (para comparar preços sem erro de ponto flutuante)."""
    return int(round_js((numero_js(v) + EPSILON) * 100))


def pontos_da_escada(regra: dict, ate: float = 1000.0) -> list[float]:
    """Preços possíveis da escada até ``ate`` (para mostrar e conferir): 4,99 … 19,99, 24,99 … 49,99, 59,99 …"""
    limite = centavos(ate)
    recuo = _recuo_da_escada(regra)
    out: list[float] = []
    for k_min, k_max, passo in _degraus_em_centavos(regra, recuo):
        k = k_min
        while (p := k * passo - recuo) <= limite and (k_max is None or k <= k_max):
            out.append(p / 100)
            k += 1
        if k_max is None or k_max * passo - recuo >= limite:
            break
    return out


def _recuo_da_escada(regra: dict) -> int:
    """Quanto o ponto fica abaixo do número redondo, em centavos: com ``centavos`` 0,99 → 1 (k × passo − 0,01).

    Como o app: ``centavos`` fora de 0 ≤ c < 1 (ou ausente) vale 0,99.
    """
    c = regra.get("centavos")
    ok = isinstance(c, (int, float)) and not isinstance(c, bool) and math.isfinite(c) and 0 <= c < 1
    return 100 - (int(round_js(c * 100)) if ok else 99)


def _degraus_em_centavos(regra: dict, recuo: int):
    """Para cada degrau válido: ``(k_min, k_max, passo)`` em centavos (``k_max`` None = sem limite)."""
    inicio = 0  # o 1º degrau começa acima de zero; os outros, acima do "ate" do degrau anterior
    for d in regra.get("degraus") or []:
        passo = centavos(d.get("passo"))
        teto = centavos(d["ate"]) if d.get("ate") is not None else None
        if passo > 0 and (teto is None or teto > inicio):
            k_min = (inicio + recuo) // passo + 1  # primeiro ponto acima do degrau anterior
            k_max = None if teto is None else (teto + recuo) // passo  # último ponto até o "ate"
            if k_max is None or k_max >= k_min:
                yield k_min, k_max, passo
        if teto is None:
            break
        inicio = max(inicio, teto)


def _escada(v: int, regra: dict) -> int:
    """Ponto da escada mais próximo de ``v`` (centavos); empate fica com o maior.

    Pontos: para cada degrau, k × passo − 0,01 (k = 1, 2, …) acima do ``ate`` do degrau anterior e até o ``ate``
    deste (``ate`` nulo = sem limite). Tudo em centavos inteiros (porta de ``precoNaEscada``).
    """
    recuo = _recuo_da_escada(regra)
    vizinhos: list[int] = []
    for k_min, k_max, passo in _degraus_em_centavos(regra, recuo):
        baixo = (v + recuo) // passo  # maior ponto <= v
        cima = -(-(v + recuo) // passo)  # menor ponto >= v
        for k in (baixo, cima, k_min, k_max):
            if k is not None and k >= k_min and (k_max is None or k <= k_max):
                vizinhos.append(k * passo - recuo)
    if not vizinhos:
        return v
    return min(vizinhos, key=lambda p: (abs(p - v), -p))


def arredondar(valor: float, regra: dict, aplicar_minimo: bool = True) -> float:
    """Arredonda o preço pela regra da loja e aplica o mínimo (porta de ``arredondar``).

    Modos:
      * ``escada`` (padrão da loja): o preço possível mais próximo do valor bruto — 19,99 (mínimo); de 5 em 5 até
        49,99; de 10 em 10 até 99,99; de 20 em 20 até 199,99; de 50 em 50 até 399,99; de 100 em 100 acima
        (sempre ,99); empate fica com o maior. Com o mínimo: bruto ≤ mínimo → mínimo. Sem o mínimo
        (``aplicar_minimo=False``, tabelas secundárias) usa a mesma escada.
      * ``terminar_em``: para cima terminando nos ``centavos`` (23,10 → 23,99);
      * ``inteiro``: para cima, sem centavos.
    """
    v = r2(valor)
    modo = regra.get("modo")
    minimo = regra.get("minimo")
    if modo == "escada":
        bruto = centavos(v)
        if aplicar_minimo and minimo and bruto <= centavos(minimo):
            return r2(numero_js(minimo))
        v = _escada(bruto, regra) / 100
    elif modo == "terminar_em":
        c = r2(numero_js(regra.get("centavos")))
        v = r2(math.ceil(r2(v - c)) + c)
    elif modo == "inteiro":
        v = float(math.ceil(v))
    if aplicar_minimo and minimo and v < minimo:
        v = minimo
    return r2(v)


def escolher_fator(
    custo_total: float,
    tipo: str | None,
    pol: dict,
    fator_manual: float | None = None,
    fator_pedido: float | None = None,
) -> dict:
    """Fator pela prioridade: da peça → do pedido → faixas (se ativas) → por tipo → padrão.

    (O preço manual, que vence tudo, é tratado em :func:`calcular_preco`.)

    :return: ``{"fator", "origem", "piso"}`` — ``piso`` é o preço bruto mínimo da regra monotônica das faixas.
    """
    if _positivo(fator_manual):
        return {"fator": float(fator_manual), "origem": "fator da peça", "piso": 0}
    if _positivo(fator_pedido):
        return {"fator": float(fator_pedido), "origem": "fator do pedido", "piso": 0}
    faixas = pol.get("faixas_custo") or []
    if pol.get("usar_faixas") and faixas:
        idx = next((k for k, f in enumerate(faixas) if f.get("ate") is None or custo_total <= f["ate"]), -1)
        i = len(faixas) - 1 if idx == -1 else idx
        # Regra monotônica: uma peça mais cara nunca sai mais barata que o teto da faixa anterior.
        anterior = faixas[i - 1] if i > 0 else None
        piso = (
            anterior["ate"] * anterior["fator"]
            if pol.get("faixas_modo") == "degrau_monotonico" and anterior and anterior.get("ate")
            else 0
        )
        ate = faixas[i].get("ate")
        return {"fator": faixas[i]["fator"], "origem": f"faixa até {'∞' if ate is None else texto_numero(ate)}", "piso": piso}
    por_tipo = pol.get("fatores_por_tipo") or {}
    if tipo and por_tipo.get(tipo):
        return {"fator": por_tipo[tipo], "origem": f"tipo {tipo}", "piso": 0}
    return {"fator": pol["fator_padrao"], "origem": "padrão", "piso": 0}


def fator_abaixo_do_minimo(fator: float | None, pol: dict) -> bool:
    """O fator escolhido (antes do arredondamento) está abaixo do mínimo da loja? Arredondar para baixo na escada
    não conta (porta de ``fatorAbaixoDoMinimo``)."""
    minimo = numero_js(pol.get("fator_minimo") or 0)
    return fator is not None and fator > 0 and minimo > 0 and fator < minimo - 1e-9


def preco_manual_abaixo_do_minimo(preco: float | None, custo: float | None, pol: dict) -> dict:
    """Preço manual abaixo do fator mínimo? (porta de ``precoManualAbaixoDoMinimo``)

    Fator efetivo = preço ÷ custo. Para a escada não gerar alerta falso, compara com o preço que o próprio fator mínimo
    daria (custo × mínimo, arredondado na escada, sem o preço mínimo). Sem custo não dá para saber.

    :return: ``{"abaixo", "fatorEfetivo", "precoMinimo"}``
    """
    minimo = numero_js(pol.get("fator_minimo") or 0)
    if not (preco is not None and preco > 0) or not (custo is not None and custo > 0):
        return {"abaixo": False, "fatorEfetivo": None, "precoMinimo": None}
    fator_efetivo = r2(preco / custo)
    if not minimo > 0:
        return {"abaixo": False, "fatorEfetivo": fator_efetivo, "precoMinimo": None}
    preco_minimo = arredondar(custo * minimo, pol["arredondamento"], False)
    return {"abaixo": preco < preco_minimo - 0.004, "fatorEfetivo": fator_efetivo, "precoMinimo": preco_minimo}


def precos_das_tabelas(preco: float, pol: dict) -> dict[str, float]:
    """Preços das tabelas (base e secundárias) a partir do preço da tabela base (porta de ``precosDasTabelas``)."""
    precos: dict[str, float] = {}
    for t in pol.get("tabelas_preco") or []:
        if t["id"] == pol.get("tabela_base"):
            precos[t["id"]] = preco
        else:
            precos[t["id"]] = arredondar(preco * t["multiplicador_sobre_tabela_base"], pol["arredondamento"], False)
    return precos


def calcular_preco(
    custo_total: float,
    tipo: str | None,
    pol: dict,
    fator_manual: float | None = None,
    fator_pedido: float | None = None,
    preco_manual: float | None = None,
    preco_vigente: float | None = None,
) -> dict:
    """Preço de venda de uma peça a partir do custo total (porta de ``calcularPreco``).

    Prioridade: preço manual → fator da peça → fator do pedido → faixas → tipo → padrão.
    Preço = custo × fator, arredondado pela regra da política (:func:`arredondar`: escada de preços ,99 com
    mínimo R$ 19,99); as outras tabelas usam a mesma regra sem o mínimo.
    ``preco_vigente`` (recompra): o preço continua o do original (mesma referência/código no UP = um preço só); o
    preço pelo custo novo é calculado mesmo assim e, se diferir mais de 10%, a peça recebe o alerta "Custo mudou".

    :return: ``{fator, origemFator, precoBruto, preco, precoCalculado, custoMudouPct, precos: {tabela: valor},
              lucroPct, fatorEfetivo, margemPct, alertas}``
    """
    alertas: list[str] = []
    escolha = escolher_fator(custo_total, tipo, pol, fator_manual, fator_pedido)
    fator, origem, piso = escolha["fator"], escolha["origem"], escolha["piso"]
    manual = r2(float(preco_manual)) if _positivo(preco_manual) else None
    vigente = r2(float(preco_vigente)) if _positivo(preco_vigente) else None
    preco_bruto = r2(max(custo_total * fator, piso))
    preco_calculado = manual if manual is not None else arredondar(preco_bruto, pol["arredondamento"])
    preco = vigente if vigente is not None else preco_calculado
    if vigente is None:
        # O fator escolhido é comparado antes do arredondamento (arredondar para baixo na escada não gera alerta).
        if manual is None and fator_abaixo_do_minimo(fator, pol):
            alertas.append(f"Fator ×{texto_numero(fator)} abaixo do mínimo da loja (×{texto_numero(pol.get('fator_minimo'))}).")
        if manual is not None:
            m = preco_manual_abaixo_do_minimo(manual, custo_total, pol)
            if m["abaixo"]:
                alertas.append(
                    f"Preço manual abaixo do fator mínimo (×{numero_curto_br(numero_js(pol.get('fator_minimo')))}): "
                    f"fator efetivo ×{numero_curto_br(m['fatorEfetivo'])}."
                )
    custo_mudou_pct = r2(((preco_calculado - vigente) / vigente) * 100) if vigente is not None and custo_total > 0 else None
    if custo_mudou_pct is not None and abs(custo_mudou_pct) > LIMITE_CUSTO_MUDOU_PCT:
        alertas.append(
            f"Custo mudou: preço vigente {brl_js(vigente)}, pelo custo novo {brl_js(preco_calculado)} "
            f"({'+' if custo_mudou_pct > 0 else ''}{numero_curto_br(custo_mudou_pct)}%)."
        )

    precos = precos_das_tabelas(preco, pol)

    lucro_pct = r2((preco / custo_total - 1) * 100) if custo_total > 0 else 0
    liquido = preco * (1 - (pol.get("comissao_consignacao_pct") or 0) / 100)
    margem_pct = r2(((liquido - custo_total) / liquido) * 100) if liquido > 0 else 0

    if custo_total <= 0:
        alertas.append("Sem custo: confira preço de origem e cotação.")
    margem_minima = pol.get("margem_minima_pct")
    if margem_minima is not None and margem_pct < margem_minima:
        alertas.append(f"Margem de {to_fixed(margem_pct, 0)}% após comissão (mínimo {texto_numero(margem_minima)}%).")
    for t in pol.get("tabelas_preco") or []:
        if t["id"] != pol.get("tabela_base") and precos[t["id"]] <= custo_total * 1.2:
            alertas.append(f"Tabela {t['nome']}: preço muito próximo do custo.")

    return {
        "fator": fator,
        "origemFator": origem,
        "precoBruto": preco_bruto,
        "preco": preco,
        "precoCalculado": preco_calculado,
        "custoMudouPct": custo_mudou_pct,
        "precos": precos,
        "lucroPct": lucro_pct,
        "fatorEfetivo": r2(preco / custo_total) if custo_total > 0 else 0,
        "margemPct": margem_pct,
        "alertas": alertas,
    }


def numero_br(v: float | None, casas: int = 2) -> str:
    """Número no padrão brasileiro: ``64138.42`` → ``64.138,42`` (``—`` quando vazio)."""
    if v is None:
        return "—"
    sinal = "-" if v < 0 else ""
    inteiro, _, decimais = f"{abs(v):,.{casas}f}".partition(".")
    return f"{sinal}{inteiro.replace(',', '.')}{',' + decimais if decimais else ''}"


SIMBOLO_MOEDA = {"BRL": "R$", "CNY": "¥", "USD": "US$"}


def brl(v: float | None) -> str:
    """Formata em reais no padrão brasileiro: ``R$ 64.138,42`` (``—`` quando vazio)."""
    return "—" if v is None else f"R$ {numero_br(v)}"


def dinheiro(v: float | None, moeda: str | None = "BRL") -> str:
    """Valor com o símbolo da moeda do pedido: ``¥ 8.225,90``, ``R$ 6.370,97``, ``US$ 10,00``."""
    simbolo = SIMBOLO_MOEDA.get((moeda or "").upper(), (moeda or "").upper())
    return "—" if v is None else f"{simbolo} {numero_br(v)}".strip()
