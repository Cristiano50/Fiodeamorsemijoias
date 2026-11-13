"use client";
/**
 * Extração de pedidos/catálogos NO NAVEGADOR (pdf.js):
 *  - Para cada imagem da página, calcula onde ela está (matriz de transformação) e recorta a região
 *    renderizada em alta resolução → foto do item.
 *  - O texto na mesma faixa horizontal da imagem vira a "linha" do item (código, descrição, preço, qtd...).
 *  - Páginas sem tabela (catálogo em foto) e fotos enviadas viram "páginas" para a IA localizar as peças.
 */
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export interface ItemExtraido {
  linha: number;
  pagina: number;
  texto: string;
  imagem: Blob;
  previa: string; // object URL para a tela
}

export interface Extracao {
  itens: ItemExtraido[];
  paginas: Blob[]; // páginas sem tabela, para detecção pela IA
  cabecalho: string;
  colunas: string;
  totalDocumento: number | null;
  textoCompleto: string;
}

type Caixa = { x0: number; y0: number; x1: number; y1: number };

async function carregarPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs;
}

const multiplicar = (m1: number[], m2: number[]) => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

/** Caixas (em coordenadas da tela, escala 1, origem no topo) de todas as imagens desenhadas na página. */
async function caixasDeImagens(page: PDFPageProxy, OPS: Record<string, number>): Promise<Caixa[]> {
  const viewport = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  const pilha: number[][] = [];
  const caixas: Caixa[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) pilha.push(ctm);
    else if (fn === OPS.restore) ctm = pilha.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = multiplicar(ctm, args as number[]);
    else if (fn === OPS.paintFormXObjectBegin) {
      pilha.push(ctm);
      const matriz = args?.[0] as number[] | null;
      if (matriz && matriz.length === 6) ctm = multiplicar(ctm, Array.from(matriz));
    } else if (fn === OPS.paintFormXObjectEnd) ctm = pilha.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) {
      const pts = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const [vx0, vy0] = viewport.convertToViewportPoint(Math.min(...xs), Math.min(...ys)) as number[];
      const [vx1, vy1] = viewport.convertToViewportPoint(Math.max(...xs), Math.max(...ys)) as number[];
      const c = { x0: Math.min(vx0, vx1), y0: Math.min(vy0, vy1), x1: Math.max(vx0, vx1), y1: Math.max(vy0, vy1) };
      // Ignora ícones/logos pequenos e imagens de fundo da página inteira.
      const w = c.x1 - c.x0;
      const h = c.y1 - c.y0;
      if (w >= 20 && h >= 20 && w < viewport.width * 0.95) caixas.push(c);
    }
  }
  return caixas.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

interface Trecho {
  x: number;
  xc: number; // centro horizontal (células de tabela costumam ser centralizadas)
  yTopo: number;
  yBase: number;
  texto: string;
}

async function trechosDeTexto(page: PDFPageProxy): Promise<Trecho[]> {
  const viewport = page.getViewport({ scale: 1 });
  const conteudo = await page.getTextContent();
  const out: Trecho[] = [];
  for (const it of conteudo.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    const [x, yBase] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]) as number[];
    const altura = Math.abs(it.transform[3]) || it.height || 8;
    out.push({ x, xc: x + (it.width || 0) / 2, yTopo: yBase - altura, yBase, texto: it.str.trim() });
  }
  return out;
}

/** Junta trechos em linhas de leitura (mesma altura) e separa colunas com " | ". */
function montarLinhas(trechos: Trecho[]): string[] {
  const ordenados = [...trechos].sort((a, b) => a.yBase - b.yBase || a.x - b.x);
  const linhas: Trecho[][] = [];
  for (const t of ordenados) {
    const ultima = linhas.at(-1);
    if (ultima && Math.abs(ultima[0].yBase - t.yBase) < 3) ultima.push(t);
    else linhas.push([t]);
  }
  return linhas.map((l) =>
    l
      .sort((a, b) => a.x - b.x)
      .map((t) => t.texto)
      .join(" | "),
  );
}

/** Texto de uma linha da tabela: os trechos dentro da faixa vertical da imagem, por coluna (x). */
function textoDaFaixa(trechos: Trecho[], c: Caixa): string {
  const centro = (t: Trecho) => (t.yTopo + t.yBase) / 2;
  const dentro = trechos.filter((t) => centro(t) >= c.y0 - 2 && centro(t) <= c.y1 + 2);
  if (!dentro.length) return "";
  // Agrupa por coluna: trechos com centro próximo (quebras de linha dentro da célula) são unidos.
  const colunas: Trecho[][] = [];
  for (const t of [...dentro].sort((a, b) => a.xc - b.xc || a.yBase - b.yBase)) {
    const col = colunas.find((cl) => Math.abs(cl[0].xc - t.xc) < 18);
    if (col) col.push(t);
    else colunas.push([t]);
  }
  return colunas
    .sort((a, b) => a[0].xc - b[0].xc)
    .map((cl) =>
      cl
        .sort((a, b) => a.yBase - b.yBase)
        .map((t) => t.texto)
        .join(""),
    )
    .join(" | ");
}

async function renderizarRegiao(page: PDFPageProxy, caixa: Caixa, ladoMax = 900): Promise<Blob> {
  // Recua um pouco as bordas para não levar as linhas da tabela do PDF junto com a foto.
  const recuo = Math.max(0.8, Math.min(caixa.x1 - caixa.x0, caixa.y1 - caixa.y0) * 0.02);
  const c = { x0: caixa.x0 + recuo, y0: caixa.y0 + recuo, x1: caixa.x1 - recuo, y1: caixa.y1 - recuo };
  const w = c.x1 - c.x0;
  const h = c.y1 - c.y0;
  const escala = Math.min(20, ladoMax / Math.max(w, h));
  const viewport = page.getViewport({ scale: escala, offsetX: -c.x0 * escala, offsetY: -c.y0 * escala });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * escala);
  canvas.height = Math.round(h * escala);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  return new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.9));
}

async function renderizarPagina(page: PDFPageProxy, larguraMax = 1800): Promise<Blob> {
  const v1 = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: larguraMax / v1.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  return new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.88));
}

function lerTotal(texto: string): number | null {
  const m = texto.match(/(?:应收|应付|Total\s*(?:geral|a pagar)?|TOTAL)\s*[:：]?\s*(?:¥|R\$|US\$)?\s*([\d.,]+)/);
  if (m) return Number(m[1].replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
  const soma = texto.match(/合计[^\n]*/);
  if (soma) {
    const nums = soma[0].match(/\d+(?:\.\d+)?/g);
    if (nums?.length) return Number(nums.at(-1));
  }
  return null;
}

/** Exposto para testes automatizados (scripts/testar-extracao.ts). */
export const _interno = { caixasDeImagens, trechosDeTexto, textoDaFaixa, montarLinhas, lerTotal };

export async function extrairPdf(arquivo: File, progresso?: (msg: string) => void): Promise<Extracao> {
  const pdfjs = await carregarPdfjs();
  const doc: PDFDocumentProxy = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
  const OPS = pdfjs.OPS as unknown as Record<string, number>;
  const itens: ItemExtraido[] = [];
  const paginas: Blob[] = [];
  const textos: string[] = [];
  let cabecalho = "";
  let colunas = "";

  for (let n = 1; n <= doc.numPages; n++) {
    progresso?.(`Lendo página ${n} de ${doc.numPages}…`);
    const page = await doc.getPage(n);
    const [caixas, trechos] = await Promise.all([caixasDeImagens(page, OPS), trechosDeTexto(page)]);
    textos.push(montarLinhas(trechos).join("\n"));

    if (n === 1 && caixas.length) {
      const acima = trechos.filter((t) => t.yBase < caixas[0].y0 - 1);
      const linhas = montarLinhas(acima);
      colunas = linhas.at(-1) ?? "";
      cabecalho = linhas.slice(0, -1).join("\n");
    }

    const comTexto = caixas.map((c) => ({ c, texto: textoDaFaixa(trechos, c) })).filter((x) => x.texto);
    const textoTotal = trechos.reduce((s, t) => s + t.texto.length, 0);

    if (comTexto.length) {
      for (const { c, texto } of comTexto) {
        const imagem = await renderizarRegiao(page, c);
        itens.push({ linha: itens.length + 1, pagina: n, texto, imagem, previa: URL.createObjectURL(imagem) });
      }
    } else if (caixas.length || textoTotal < 40) {
      // Catálogo em foto (sem tabela): a IA localiza as peças na página.
      paginas.push(await renderizarPagina(page));
    }
  }
  const textoCompleto = textos.join("\n");
  if (!cabecalho) cabecalho = textoCompleto.split("\n").slice(0, 6).join("\n");
  return { itens, paginas, cabecalho, colunas, totalDocumento: lerTotal(textoCompleto), textoCompleto };
}

/** Reduz uma foto enviada (JPG/PNG/WebP) para no máximo 2000 px, em JPEG. */
export async function prepararFoto(arquivo: File, ladoMax = 2000): Promise<Blob> {
  const bmp = await createImageBitmap(arquivo);
  const escala = Math.min(1, ladoMax / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * escala);
  canvas.height = Math.round(bmp.height * escala);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.88));
}
