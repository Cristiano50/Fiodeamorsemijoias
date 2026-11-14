#!/usr/bin/env python3
"""Cotação PTAX do Banco Central para a data da compra (R$ por 1 unidade da moeda).

Uso:
    python3 ptax.py AAAA-MM-DD [--moeda CNY] [--tipo venda|compra]
    python3 ptax.py AAAA-MM-DD --moeda CNY --csv boletim.csv      # CSV já baixado (ou - para a entrada padrão)

Fontes, na ordem do app (src/lib/cambio.ts): boletim de fechamento do BCB
(https://www4.bcb.gov.br/Download/fechamento/AAAAMMDD.csv, que tem CNY; volta até 10 dias para achar o
último dia útil) → API Olinda do BCB → AwesomeAPI (mercado).

Saída (stdout, JSON): {"moeda", "cotacao", "data", "fonte", "tipo"}.
Códigos de saída: 0 = ok; 1 = erro nos argumentos ou no CSV; 2 = não consegui a cotação (rede bloqueada ou
fontes fora do ar) — a mensagem em português diz a URL exata do CSV para abrir com a ferramenta de web
ou pedir a cotação à pessoa.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fiodeamor import config  # noqa: E402
from fiodeamor.cambio import buscar_cotacao, dias_uteis_ate, ler_boletim, url_boletim  # noqa: E402


def mensagem_sem_cotacao(moeda: str, data: str, tipo: str, erros: list[str], rede_bloqueada: bool) -> str:
    """Explica o que fazer quando não deu para buscar a cotação (com as URLs exatas do boletim)."""
    urls = [url_boletim(d) for d in dias_uteis_ate(data, 3)]
    coluna = "VENDA (6ª coluna)" if tipo == "venda" else "COMPRA (5ª coluna)"
    motivo = "a rede deste ambiente parece bloqueada" if rede_bloqueada else "as fontes não trouxeram a cotação"
    detalhes = f" — {'; '.join(erros)}" if erros else ""
    return (
        f"Não consegui buscar a cotação PTAX de {moeda} para {data} ({motivo}{detalhes}).\n"
        f"Abra o boletim de fechamento do Banco Central com a ferramenta de busca/web:\n"
        f"  {urls[0]}\n"
        f"Se der 404 (fim de semana, feriado ou boletim ainda não publicado — sai por volta das 13h), "
        f"use o dia útil anterior:\n"
        + "".join(f"  {u}\n" for u in urls[1:])
        + f"Cada linha é Data;Cód;Tipo;Moeda;Compra;Venda;…: pegue a linha de {moeda} e o valor de {coluna}, "
        f"ex.: 25/09/2026;795;A;CNY;0,77430000;0,77450000;… → 0,7745.\n"
        f"Com o conteúdo do CSV salvo num arquivo, rode: python3 ptax.py {data} --moeda {moeda} --csv boletim.csv\n"
        f"Ou peça à pessoa a cotação do dia (R$ por 1 {moeda}) e use calcular.py --cotacao."
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Cotação PTAX (Banco Central) da data da compra.")
    ap.add_argument("data", help="data da compra, AAAA-MM-DD")
    ap.add_argument("--moeda", default="CNY", help="moeda do pedido (padrão: CNY)")
    ap.add_argument("--tipo", choices=["venda", "compra"], default=None, help="PTAX de venda (padrão) ou de compra")
    ap.add_argument("--csv", metavar="ARQUIVO", help="ler um boletim CSV já baixado (ou - para a entrada padrão)")
    args = ap.parse_args(argv)

    try:
        date.fromisoformat(args.data)
    except ValueError:
        print(f"Erro: data inválida {args.data!r}; use AAAA-MM-DD (ex.: 2026-09-26).", file=sys.stderr)
        return 1
    moeda = args.moeda.strip().upper()
    tipo = args.tipo or config.sistema().get("tipoCotacao") or "venda"

    if args.csv:
        try:
            texto = sys.stdin.read() if args.csv == "-" else Path(args.csv).read_text(encoding="utf-8", errors="replace")
            cotacao = ler_boletim(texto, moeda, tipo)
        except Exception as e:  # noqa: BLE001
            print(f"Erro ao ler o CSV: {e}", file=sys.stderr)
            return 1
        if not cotacao:
            print(f"Erro: a moeda {moeda} não aparece neste boletim.", file=sys.stderr)
            return 1
        print(json.dumps(cotacao, ensure_ascii=False))
        return 0

    cotacao, erros, rede_bloqueada = buscar_cotacao(moeda, args.data, tipo)
    if cotacao:
        print(json.dumps(cotacao, ensure_ascii=False))
        return 0

    print(
        json.dumps(
            {
                "moeda": moeda,
                "cotacao": None,
                "data": args.data,
                "fonte": None,
                "tipo": tipo,
                "erro": "rede bloqueada" if rede_bloqueada else "cotação não encontrada",
                "erros": erros,
                "urlsCsv": [url_boletim(d) for d in dias_uteis_ate(args.data, 3)],
            },
            ensure_ascii=False,
        )
    )
    print(mensagem_sem_cotacao(moeda, args.data, tipo, erros, rede_bloqueada), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
