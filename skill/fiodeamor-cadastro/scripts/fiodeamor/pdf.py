"""Extração do PDF do pedido com PyMuPDF — porta de ``src/lib/pdf-cliente.ts`` do app.

* Para cada imagem desenhada na página, calcula onde ela está e recorta a região renderizada em alta resolução
  → foto do item. O app percorre o operator list do pdf.js multiplicando a matriz CTM; aqui o MuPDF faz a mesma
  conta e entrega o retângulo pronto em ``page.get_image_info()`` (inclui imagens dentro de Form XObjects e
  imagens inline).
* O texto na mesma faixa vertical da imagem vira a "linha" do item (código, descrição, preço, qtd...),
  agrupado por coluna (x).
* Páginas sem tabela (catálogo em foto) viram "páginas" para o Claude localizar as peças pela visão.

As coordenadas são as da tela (origem no topo, escala 1, com a rotação da página aplicada), como o viewport
do pdf.js.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from pathlib import Path

try:
    import pymupdf
except ImportError:  # versões antigas do PyMuPDF só têm o nome "fitz"
    import fitz as pymupdf  # type: ignore[no-redef]

from .extracao import Caixa, Trecho, ler_total, montar_linhas, texto_da_faixa

# Texto sem os blocos de imagem (ligaduras + espaços + recorte na página).
_FLAGS_TEXTO = getattr(pymupdf, "TEXTFLAGS_DICT", 1 | 2 | 4 | 64) & ~getattr(pymupdf, "TEXT_PRESERVE_IMAGES", 4)
_ESPACOS = re.compile(r"\s+")


def _jpeg(pix: "pymupdf.Pixmap", qualidade: int) -> bytes:
    """Pixmap → JPEG. Usa o PyMuPDF; em versões antigas (sem ``jpg_quality``), o Pillow."""
    try:
        return pix.tobytes("jpeg", jpg_quality=qualidade)
    except (TypeError, ValueError, RuntimeError):
        from PIL import Image

        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        saida = io.BytesIO()
        img.save(saida, "JPEG", quality=qualidade)
        return saida.getvalue()


@dataclass
class ItemExtraido:
    """Linha da tabela com a foto recortada (JPEG)."""

    linha: int
    pagina: int
    texto: str
    imagem: bytes


@dataclass
class Extracao:
    """Resultado da leitura do PDF (mesmos campos de ``Extracao`` no app)."""

    itens: list[ItemExtraido] = field(default_factory=list)
    paginas: list[bytes] = field(default_factory=list)  # páginas sem tabela (JPEG), para a visão do Claude
    cabecalho: str = ""
    colunas: str = ""
    total_documento: float | None = None
    texto_completo: str = ""


def caixas_de_imagens(page: pymupdf.Page) -> list[Caixa]:
    """Caixas (coordenadas da tela) de todas as imagens desenhadas na página, de cima para baixo.

    Ignora ícones/logos pequenos (< 20 pt) e imagens de fundo da página inteira (≥ 95% da largura).
    """
    rotacao = page.rotation_matrix
    largura_pagina = page.rect.width
    caixas: list[Caixa] = []
    for info in page.get_image_info():
        r = pymupdf.Rect(info["bbox"])
        if r.is_empty or r.is_infinite:
            continue
        r = r * rotacao  # para o espaço da tela (página girada como é exibida)
        c = Caixa(min(r.x0, r.x1), min(r.y0, r.y1), max(r.x0, r.x1), max(r.y0, r.y1))
        if c.largura >= 20 and c.altura >= 20 and c.largura < largura_pagina * 0.95:
            caixas.append(c)
    return sorted(caixas, key=lambda c: (c.y0, c.x0))


def trechos_de_texto(page: pymupdf.Page) -> list[Trecho]:
    """Trechos de texto da página: cada "linha" do MuPDF (texto contínuo de uma célula) vira um trecho.

    ``y_base`` é a linha de base e ``y_topo = y_base − tamanho da fonte``, como no app (pdf.js).
    """
    rotacao = page.rotation_matrix
    out: list[Trecho] = []
    for bloco in page.get_text("dict", flags=_FLAGS_TEXTO)["blocks"]:
        if bloco.get("type", 0) != 0:
            continue
        for linha in bloco.get("lines", []):
            spans = [s for s in linha.get("spans", []) if s.get("text")]
            texto = _ESPACOS.sub(" ", "".join(s["text"] for s in spans)).strip()
            if not texto:
                continue
            r = pymupdf.Rect(linha["bbox"]) * rotacao
            origem = pymupdf.Point(spans[0]["origin"]) * rotacao
            altura = max(abs(s.get("size") or 0) for s in spans) or abs(r.height) or 8
            x = min(r.x0, r.x1)
            out.append(Trecho(x=x, xc=x + abs(r.width) / 2, y_topo=origem.y - altura, y_base=origem.y, texto=texto))
    return out


def renderizar_regiao(page: pymupdf.Page, caixa: Caixa, lado_max: int = 900, qualidade: int = 90) -> bytes:
    """Recorta a região da imagem em JPEG (lado maior ≈ ``lado_max`` px, escala máxima 20×).

    Recua 2% das bordas (mínimo 0,8 pt) para não levar as linhas da tabela do PDF junto com a foto.
    """
    recuo = max(0.8, min(caixa.largura, caixa.altura) * 0.02)
    c = Caixa(caixa.x0 + recuo, caixa.y0 + recuo, caixa.x1 - recuo, caixa.y1 - recuo)
    escala = min(20, lado_max / max(c.largura, c.altura))
    pix = page.get_pixmap(
        matrix=pymupdf.Matrix(escala, escala), clip=pymupdf.Rect(c.x0, c.y0, c.x1, c.y1), alpha=False
    )
    return _jpeg(pix, qualidade)


def renderizar_pagina(page: pymupdf.Page, largura_max: int = 1800, qualidade: int = 88) -> bytes:
    """Página inteira em JPEG com ``largura_max`` px de largura (para o Claude localizar as peças)."""
    escala = largura_max / page.rect.width
    pix = page.get_pixmap(matrix=pymupdf.Matrix(escala, escala), alpha=False)
    return _jpeg(pix, qualidade)


def extrair_pdf(origem: str | Path | bytes, progresso=None) -> Extracao:
    """Lê o PDF do pedido: itens (texto da linha + foto), páginas sem tabela, cabeçalho, colunas e total.

    :param origem: caminho do PDF ou o conteúdo em bytes.
    :param progresso: função opcional chamada com mensagens de andamento.
    """
    doc = pymupdf.open(stream=origem, filetype="pdf") if isinstance(origem, (bytes, bytearray)) else pymupdf.open(origem)
    ex = Extracao()
    textos: list[str] = []
    try:
        for n, page in enumerate(doc, start=1):
            if progresso:
                progresso(f"Lendo página {n} de {doc.page_count}…")
            caixas = caixas_de_imagens(page)
            trechos = trechos_de_texto(page)
            textos.append("\n".join(montar_linhas(trechos)))

            if n == 1 and caixas:
                acima = [t for t in trechos if t.y_base < caixas[0].y0 - 1]
                linhas = montar_linhas(acima)
                ex.colunas = linhas[-1] if linhas else ""
                ex.cabecalho = "\n".join(linhas[:-1])

            com_texto = [(c, texto_da_faixa(trechos, c)) for c in caixas]
            com_texto = [(c, t) for c, t in com_texto if t]
            texto_total = sum(len(t.texto) for t in trechos)

            if com_texto:
                for c, texto in com_texto:
                    ex.itens.append(
                        ItemExtraido(linha=len(ex.itens) + 1, pagina=n, texto=texto, imagem=renderizar_regiao(page, c))
                    )
            elif caixas or texto_total < 40:
                # Catálogo em foto (sem tabela): o Claude localiza as peças na página.
                ex.paginas.append(renderizar_pagina(page))
    finally:
        doc.close()
    ex.texto_completo = "\n".join(textos)
    if not ex.cabecalho:
        ex.cabecalho = "\n".join(ex.texto_completo.split("\n")[:6])
    ex.total_documento = ler_total(ex.texto_completo)
    return ex
