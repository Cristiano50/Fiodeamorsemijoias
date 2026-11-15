"""Núcleo de cálculo da Fio de Amor Semijoias, portado do app Next.js para a skill do Claude.

Módulos:
    config    — carrega as regras da loja (JSON em ``referencias/``): precificação, fiscal, taxonomia, sistema.
    numeros   — números escritos como texto (porta de ``lerNumeroBr``, ``src/lib/numeros.ts``).
    planilha  — células seguras para CSV/XLSX (porta de ``src/lib/csv.ts``).
    precos    — custos e preços, com a escada de preços (porta fiel de ``src/lib/precos.ts``).
    calculo   — aplica custos e preços a um ``cadastro.json`` e monta o resumo do pedido.
    extracao  — leitura heurística das linhas e do cabeçalho do pedido (``src/lib/extracao.ts``).
    pdf       — extração do PDF do pedido com PyMuPDF (``src/lib/pdf-cliente.ts``).
    cambio    — cotação PTAX do Banco Central (``src/lib/cambio.ts``).

Os nomes dos campos dos dicionários seguem o app (camelCase), para não haver tradução no meio do caminho.
"""

__all__ = ["config", "numeros", "planilha", "precos", "calculo", "extracao", "cambio"]
