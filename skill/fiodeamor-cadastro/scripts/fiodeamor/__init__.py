"""Núcleo de cálculo da Fio de Amor Semijoias, portado do app Next.js para a skill do Claude.

Módulos:
    config    — carrega as regras da loja (JSON em ``referencias/``): precificação, fiscal, taxonomia, sistema.
    precos    — custos e preços (porta fiel de ``src/lib/precos.ts``).
    calculo   — aplica custos e preços a um ``cadastro.json`` e monta o resumo do pedido.
    extracao  — leitura heurística das linhas e do cabeçalho do pedido (``src/lib/extracao.ts``).
    pdf       — extração do PDF do pedido com PyMuPDF (``src/lib/pdf-cliente.ts``).
    cambio    — cotação PTAX do Banco Central (``src/lib/cambio.ts``).

Os nomes dos campos dos dicionários seguem o app (camelCase), para não haver tradução no meio do caminho.
"""

__all__ = ["config", "precos", "calculo", "extracao", "cambio"]
