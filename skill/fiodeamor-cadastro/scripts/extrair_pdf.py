#!/usr/bin/env python3
"""Lê o PDF do pedido do fornecedor e cria a pasta de trabalho do cadastro.

Uso:
    python3 extrair_pdf.py pedido.pdf [--saida PASTA] [--sobrescrever] [--json]
    python3 extrair_pdf.py foto1.jpg foto2.png [--saida PASTA]      # pedido/catálogo em foto

Com PDF (porta de src/lib/pdf-cliente.ts + src/lib/extracao.ts do app):
    * cada imagem da tabela vira uma linha: o texto na mesma faixa vertical (agrupado por coluna) é lido
      (código, especificação, descrição, preço × quantidade = total) e a foto é recortada (recuo de 2%)
      em ``PASTA/fotos/linha-NNN.jpg``;
    * cabeçalho do documento → número do pedido, fornecedor, data, moeda e total impresso; a moeda só vale com marca
      no documento (US$/USD/美元 > R$/BRL > ¥/RMB/元/人民币); sem marca fica vazia, com aviso para perguntar;
    * páginas sem tabela (catálogo em foto) vão para ``PASTA/paginas/`` para o Claude localizar as peças.
Com fotos (JPG/PNG/WebP): só cria o ``cadastro.json`` com o pedido vazio e copia as fotos (reduzidas a 2000 px,
em JPEG) para ``PASTA/paginas/``; o Claude identifica as peças pela visão.

Gera ``PASTA/cadastro.json`` no formato de ``referencias/formato-cadastro.md`` e imprime um resumo
(linhas, peças, total lido × total do documento).
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fiodeamor.extracao import ler_cabecalho, ler_linha  # noqa: E402
from fiodeamor.precos import dinheiro, numero_br, r2, soma  # noqa: E402

EXTENSOES_FOTO = {".jpg", ".jpeg", ".png", ".webp"}


def preparar_foto(origem: Path, lado_max: int = 2000, qualidade: int = 88) -> bytes:
    """Reduz uma foto enviada (JPG/PNG/WebP) para no máximo ``lado_max`` px, em JPEG (``prepararFoto`` do app).

    Respeita a orientação EXIF do celular e põe fundo branco nas transparências. Só precisa do Pillow.
    """
    import io

    from PIL import Image, ImageOps

    with Image.open(origem) as original:
        img = ImageOps.exif_transpose(original)
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            fundo = Image.new("RGB", img.size, "white")
            fundo.paste(img, mask=img.getchannel("A"))
            img = fundo
        else:
            img = img.convert("RGB")
        img.thumbnail((lado_max, lado_max))
        saida = io.BytesIO()
        img.save(saida, "JPEG", quality=qualidade)
        return saida.getvalue()


def _agora_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _pedido_vazio(arquivo_nome: str) -> dict:
    return {
        "numero": None,
        "fornecedor": None,
        "dataCompra": None,
        "moeda": None,
        "cotacao": None,
        "cotacaoFonte": None,
        "cotacaoData": None,
        "frete": None,
        "fator": None,
        "totalDocumento": None,
        "arquivoNome": arquivo_nome,
        "cabecalho": None,
        "colunas": None,
        "observacoes": None,
    }


def _limpar(pasta: Path, padrao: str) -> None:
    """Apaga arquivos antigos gerados por uma extração anterior (só os que seguem o padrão de nome)."""
    if pasta.is_dir():
        for f in pasta.glob(padrao):
            f.unlink()


def gerar_cadastro(arquivos: list[Path], pasta: Path, progresso=None) -> tuple[dict, dict]:
    """Extrai o pedido (PDF e/ou fotos), grava fotos e páginas em ``pasta`` e devolve ``(cadastro, info)``.

    ``info`` traz os números para o resumo: linhas, pecas, totalLido, totalDocumento, confere, paginas, avisos.
    Não grava o ``cadastro.json`` (quem chama decide).
    """
    pdfs = [a for a in arquivos if a.suffix.lower() == ".pdf"]
    fotos = [a for a in arquivos if a.suffix.lower() in EXTENSOES_FOTO]
    outros = [a for a in arquivos if a not in pdfs and a not in fotos]
    if outros:
        raise ValueError(f"Formato não suportado: {', '.join(a.name for a in outros)} (use PDF, JPG, PNG ou WebP).")
    if len(pdfs) > 1:
        raise ValueError("Envie um PDF por vez (um pedido por cadastro).")
    for a in arquivos:
        if not a.is_file():
            raise FileNotFoundError(f"Arquivo não encontrado: {a}")

    pasta_fotos, pasta_paginas = pasta / "fotos", pasta / "paginas"
    _limpar(pasta_fotos, "linha-*.jpg")
    _limpar(pasta_paginas, "pagina-*.jpg")

    pedido = _pedido_vazio(", ".join(a.name for a in arquivos))
    itens: list[dict] = []
    paginas_jpeg: list[bytes] = []
    avisos: list[str] = []
    info: dict = {"totalDocumento": None}

    if pdfs:
        try:
            from fiodeamor.pdf import extrair_pdf  # PyMuPDF só é necessário para PDF
        except ImportError as e:
            raise ValueError(f"Para ler PDF é preciso o PyMuPDF (pip install pymupdf): {e}") from e

        ex = extrair_pdf(pdfs[0], progresso)
        cab = ler_cabecalho(ex.cabecalho + "\n" + ex.texto_completo[:600])
        primeira = next((l for l in ex.cabecalho.split("\n") if len(l.strip()) > 3), None)
        pedido.update(
            {
                "numero": cab.get("numero"),
                "fornecedor": primeira.replace(" | ", " ").strip() if primeira else None,
                "dataCompra": cab.get("data"),
                "moeda": cab.get("moeda"),  # None = o documento não mostra a moeda (a skill pergunta)
                "totalDocumento": ex.total_documento,
                "cabecalho": ex.cabecalho or None,
                "colunas": ex.colunas or None,
            }
        )
        info["totalDocumento"] = ex.total_documento
        if ex.itens:
            pasta_fotos.mkdir(parents=True, exist_ok=True)
        for it in ex.itens:
            lida = ler_linha(it.texto)
            foto = f"fotos/linha-{it.linha:03d}.jpg"
            (pasta / foto).write_bytes(it.imagem)
            itens.append(
                {
                    "linha": it.linha,
                    "textoOriginal": it.texto,
                    "codigoFornecedor": lida.get("codigo"),
                    "especificacao": lida.get("especificacao"),
                    "descricaoOriginal": lida.get("descricao"),
                    "quantidade": lida.get("quantidade", 1),
                    "precoOrigem": lida.get("preco"),
                    "foto": foto,
                }
            )
            if lida.get("preco") is None:
                avisos.append(
                    f"Linha {it.linha} (página {it.pagina}): não achei preço × quantidade = total; ficou quantidade 1 e "
                    f"sem preço — confira no documento: {it.texto}"
                )
        paginas_jpeg.extend(ex.paginas)
        if not pedido["moeda"]:
            avisos.append(
                "Moeda não identificada: o documento não mostra ¥/RMB/元/人民币, US$/USD/美元 nem R$. Pergunte à pessoa "
                "(CNY, USD ou BRL) e preencha pedido.moeda (ou use calcular.py --moeda)."
            )
        if not pedido["dataCompra"]:
            avisos.append("Não achei a data da compra no cabeçalho: informe a data (AAAA-MM-DD) para buscar a cotação.")
        if not ex.itens and not ex.paginas:
            avisos.append("Não encontrei itens neste PDF.")

    if fotos:
        for f in fotos:
            try:
                paginas_jpeg.append(preparar_foto(f))
            except Exception as e:  # noqa: BLE001
                raise ValueError(f"Não consegui abrir a foto {f.name}: {e}") from e

    paginas: list[str] = []
    if paginas_jpeg:
        pasta_paginas.mkdir(parents=True, exist_ok=True)
        for k, dados in enumerate(paginas_jpeg, start=1):
            nome = f"paginas/pagina-{k:03d}.jpg"
            (pasta / nome).write_bytes(dados)
            paginas.append(nome)

    cadastro = {
        "formato": "fiodeamor-cadastro",
        "versao": 1,
        "id": str(uuid.uuid4()),
        "geradoEm": _agora_iso(),
        "geradoPor": "skill fiodeamor-cadastro",
        "pedido": pedido,
        "itens": itens,
    }
    if paginas:
        # Fora do contrato básico: imagens que o Claude ainda precisa olhar para localizar as peças.
        cadastro["paginas"] = paginas

    total_lido = r2(soma((i["precoOrigem"] or 0) * (i["quantidade"] or 0) for i in itens))
    total_doc = info["totalDocumento"]
    info.update(
        {
            "linhas": len(itens),
            "pecas": sum(i["quantidade"] or 0 for i in itens),
            "totalLido": total_lido,
            "confere": None if total_doc is None or not itens else abs(total_lido - total_doc) < 0.05,
            "paginas": paginas,
            "avisos": avisos,
        }
    )
    if info["confere"] is False:
        avisos.append(
            f"Total lido ({numero_br(total_lido)}) diferente do total do documento ({numero_br(total_doc)}): "
            "confira as linhas."
        )
    return cadastro, info


def imprimir_resumo(cadastro: dict, info: dict, pasta: Path) -> None:
    """Resumo em português para o terminal."""
    p = cadastro["pedido"]
    moeda = p.get("moeda")
    cab = " — ".join(str(x) for x in (p.get("numero"), p.get("fornecedor"), p.get("dataCompra"), moeda) if x)
    if cab:
        print(f"Pedido: {cab}")
    if info["linhas"]:
        print(f"Linhas: {info['linhas']} · Peças: {info['pecas']}")
        doc = info["totalDocumento"]
        if doc is None:
            print(f"Total lido: {dinheiro(info['totalLido'], moeda)} (o documento não mostra o total)")
        else:
            marca = "✓ confere com o documento" if info["confere"] else "✗ NÃO confere"
            print(f"Total lido: {dinheiro(info['totalLido'], moeda)} · documento: {dinheiro(doc, moeda)} {marca}")
        print(f"Fotos: {pasta / 'fotos'} ({info['linhas']})")
    if info["paginas"]:
        print(f"Páginas/fotos para localizar as peças pela visão: {len(info['paginas'])} em {pasta / 'paginas'}")
    print(f"Cadastro: {pasta / 'cadastro.json'}")
    for a in info["avisos"]:
        print(f"⚠ {a}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Lê o PDF (ou fotos) do pedido e cria PASTA/cadastro.json + fotos.")
    ap.add_argument("arquivos", nargs="+", type=Path, help="PDF do pedido, ou fotos JPG/PNG/WebP")
    ap.add_argument("--saida", type=Path, default=Path("cadastro"), help="pasta de trabalho (padrão: ./cadastro)")
    ap.add_argument("--sobrescrever", action="store_true", help="substitui um cadastro.json que já exista na pasta")
    ap.add_argument("--json", action="store_true", help="imprime o resumo em JSON")
    args = ap.parse_args(argv)

    pasta: Path = args.saida
    destino = pasta / "cadastro.json"
    if destino.exists() and not args.sobrescrever:
        print(
            f"Já existe {destino}. Para extrair de novo e PERDER o que foi preenchido nele, use --sobrescrever "
            "(ou escolha outra pasta com --saida).",
            file=sys.stderr,
        )
        return 1
    pasta.mkdir(parents=True, exist_ok=True)
    try:
        cadastro, info = gerar_cadastro(
            args.arquivos, pasta, progresso=None if args.json else (lambda m: print(m, file=sys.stderr))
        )
    except (ValueError, FileNotFoundError) as e:
        print(f"Erro: {e}", file=sys.stderr)
        return 1
    destino.write_text(json.dumps(cadastro, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.json:
        print(json.dumps({**info, "cadastro": str(destino), "pedido": cadastro["pedido"]}, ensure_ascii=False, indent=2))
    else:
        imprimir_resumo(cadastro, info, pasta)
    return 0


if __name__ == "__main__":
    sys.exit(main())
