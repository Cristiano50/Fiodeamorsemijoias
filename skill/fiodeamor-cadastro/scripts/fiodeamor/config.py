"""Regras da loja lidas dos JSON em ``referencias/`` (porta das partes de ``src/lib/config.ts`` usadas no cálculo).

No app, cada configuração é o JSON de ``src/config`` + o que foi salvo em Configurações. Na skill, a fonte é a
cópia dos JSON em ``skill/fiodeamor-cadastro/referencias/``. A pasta pode ser trocada pela variável de ambiente
``FIODEAMOR_REFERENCIAS`` ou pelo parâmetro ``pasta`` das funções.
"""

from __future__ import annotations

import copy
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

# scripts/fiodeamor/config.py → parents[2] = skill/fiodeamor-cadastro
PASTA_REFERENCIAS = Path(__file__).resolve().parents[2] / "referencias"

# Valores de SISTEMA_PADRAO (src/lib/config.ts) que importam para preço e código.
SISTEMA_PADRAO: dict[str, Any] = {
    "referenciaModelo": "{PREFIXO}_{AA}{MM}{SEQ:3}",
    "unidade": "UN",
    "ncmPadrao": "71171900",
    "cenarioCustoPadrao": "mercadoria_frete",
    "origemCodigoBarras": "upvendas",
    "tipoCotacao": "venda",
}

# Cenário da regra da loja, sempre o primeiro da lista (igual a getCenarios() do app).
CENARIO_LOJA = "mercadoria_frete"


def pasta_referencias(pasta: str | os.PathLike | None = None) -> Path:
    """Pasta dos JSON de regras: parâmetro → variável FIODEAMOR_REFERENCIAS → ``referencias/`` da skill."""
    return Path(pasta or os.environ.get("FIODEAMOR_REFERENCIAS") or PASTA_REFERENCIAS)


@lru_cache(maxsize=32)
def _ler(caminho: str) -> Any:
    with open(caminho, encoding="utf-8") as f:
        return json.load(f)


def carregar_json(nome: str, pasta: str | os.PathLike | None = None) -> Any:
    """Lê ``<pasta>/<nome>.json`` (com cache) e devolve uma cópia que pode ser alterada à vontade."""
    caminho = pasta_referencias(pasta) / f"{nome}.json"
    return copy.deepcopy(_ler(str(caminho)))


def precificacao(pasta=None) -> dict:
    """Política de preço (``precificacao.json``): fator padrão, mínimo, faixas, arredondamento, tabelas."""
    return carregar_json("precificacao", pasta)


def fiscal(pasta=None) -> dict:
    """Regras do contador (``fiscal.json``): NCM, componentes de custo e cenários de importação."""
    return carregar_json("fiscal", pasta)


def taxonomia(pasta=None) -> dict:
    """Tipos, materiais, banhos, cores de pedra e glossário chinês (``taxonomia.json``)."""
    return carregar_json("taxonomia", pasta)


def sistema(pasta=None) -> dict:
    """Regras do sistema: padrão do app + o que estiver em ``sistema.json`` (se existir)."""
    out = dict(SISTEMA_PADRAO)
    caminho = pasta_referencias(pasta) / "sistema.json"
    if caminho.exists():
        salvo = carregar_json("sistema", pasta)
        if isinstance(salvo, dict):
            out.update(salvo)
    return out


def componentes_custo(fis: dict | None = None, pol: dict | None = None) -> list[dict]:
    """Componentes de custo do pedido (frete, câmbio, impostos...) definidos pelo contador.

    Porta de ``getComponentesCusto()``: usa ``fiscal.custo_aquisicao.componentes``; se não houver, um único
    componente percentual com ``precificacao.custo_total.custos_adicionais_pct_padrao`` (padrão 15%).
    """
    fis = fiscal() if fis is None else fis
    comps = (fis.get("custo_aquisicao") or {}).get("componentes")
    if comps:
        return comps
    pol = precificacao() if pol is None else pol
    pct = (pol.get("custo_total") or {}).get("custos_adicionais_pct_padrao")
    return [
        {
            "id": "custos_adicionais_pct",
            "nome": "Custos adicionais (%)",
            "tipo": "percentual",
            "padrao": 15 if pct is None else pct,
        }
    ]


def cenarios(fis: dict | None = None, sis: dict | None = None, componentes: list[dict] | None = None) -> tuple[str, dict]:
    """Cenários de importação do contador, com "mercadoria_frete" (regra da loja) em primeiro.

    Porta de ``getCenarios()``. Devolve ``(padrao, cenarios)``; o padrão vem de ``sistema.cenarioCustoPadrao``,
    senão de ``fiscal.custo_aquisicao.cenario_padrao``, senão o primeiro cenário.
    """
    fis = fiscal() if fis is None else fis
    sis = sistema() if sis is None else sis
    componentes = componentes_custo(fis) if componentes is None else componentes
    zerado = {c["id"]: 0 for c in componentes}
    lista: dict[str, dict] = {
        CENARIO_LOJA: {
            "nome": "Mercadoria + frete (regra da loja)",
            "aplica_quando": (
                "Compras da China: frete ÷ valor da mercadoria em R$ = % do frete; cada peça recebe esse % sobre o "
                "seu valor em R$. Informe o frete no campo Frete do pedido."
            ),
            "valores": zerado,
        }
    }
    aquisicao = fis.get("custo_aquisicao") or {}
    lista.update(aquisicao.get("cenarios_importacao") or {})
    padrao = sis.get("cenarioCustoPadrao") or aquisicao.get("cenario_padrao") or next(iter(lista))
    return padrao, lista


def ncm_para(fis: dict, tipo: str | None = None, material: str | None = None, padrao: str = "71171900") -> str:
    """NCM pela regra mais específica: tipo+material > tipo > material > ``*``/``*`` > padrão (porta de ``ncmPara``)."""
    regras = fis.get("ncm") or []

    def achar(t: str, m: str):
        for r in regras:
            if r.get("tipo") == t and r.get("material") == m:
                return r.get("ncm")
        return None

    return (
        (tipo and material and achar(tipo, material))
        or (tipo and achar(tipo, "*"))
        or (material and achar("*", material))
        or achar("*", "*")
        or padrao
    )
