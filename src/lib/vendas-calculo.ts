/**
 * Retorno de vendas do UP Vendas: leitura da planilha exportada, ligação com os produtos do app
 * e análise de giro (sell-through, venda média, ponto de reposição, curva ABC), recompra com freio,
 * faixas de preço e estoque × UP.
 *
 * Funções puras (sem banco e sem "server-only"), testadas em tests/vendas.test.ts e tests/dados-*.test.ts.
 */
import { estoqueEntrada } from "./estoque";
import { loteMinimoEfetivo } from "./conta-fornecedor";

/* ------------------------------------------------------------- utilidades */

export const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Minúsculas, sem acento e só letras/números separados por um espaço ("Cód. Barras" → "cod barras"). */
export const normalizarTexto = (s: string) =>
  semAcento(String(s ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Chave para agrupar nomes de revendedora escritos de jeitos diferentes ("MARIA  Silva" = "Maria Silva"). */
export const chaveNome = (s: string | null | undefined) => normalizarTexto(s ?? "");

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Dias de a até b (datas AAAA-MM-DD). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function somarDias(data: string, dias: number): string {
  return new Date(Date.parse(`${data}T00:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);
}

/* --------------------------------------------------- campos da planilha */

export const CAMPOS_VENDA = [
  { id: "data", nome: "Data da venda" },
  { id: "referencia", nome: "Referência" },
  { id: "codigoBarras", nome: "Código de barras (EAN)" },
  { id: "descricao", nome: "Descrição do produto" },
  { id: "quantidade", nome: "Quantidade" },
  { id: "valorTotal", nome: "Valor total da linha" },
  { id: "valorUnitario", nome: "Preço unitário" },
  { id: "revendedora", nome: "Revendedora" },
  { id: "canal", nome: "Canal / tipo de venda" },
] as const;

export type CampoVenda = (typeof CAMPOS_VENDA)[number]["id"];
/** Campo do app → índice da coluna na planilha (0 = primeira coluna). */
export type Mapeamento = Partial<Record<CampoVenda, number>>;

/**
 * Regra de detecção de um campo pelo nome da coluna (já normalizado: sem acento, minúsculo).
 * `exceto`: se o nome casar, a coluna não serve para o campo (ex.: "Data da devolução" não é quantidade).
 */
export interface RegraCabecalho<C extends string> {
  campo: C;
  testes: [RegExp, number][];
  exceto?: RegExp;
}

/** Pontos de cada campo para um nome de coluna (só os que passam de 3). */
export function pontuarCabecalho<C extends string>(regras: RegraCabecalho<C>[], cabecalho: string): { campo: C; pontos: number }[] {
  const h = normalizarTexto(cabecalho);
  if (!h) return [];
  const out: { campo: C; pontos: number }[] = [];
  for (const r of regras) {
    if (r.exceto?.test(h)) continue;
    const pontos = Math.max(0, ...r.testes.filter(([re]) => re.test(h)).map(([, p]) => p));
    if (pontos >= 3) out.push({ campo: r.campo, pontos });
  }
  return out;
}

/** Mapeamento pelos nomes das colunas: pontuação maior vence; cada coluna vai para um campo só e cada campo recebe uma coluna só. */
export function sugerirMapeamentoPor<C extends string>(regras: RegraCabecalho<C>[], cabecalhos: string[]): Partial<Record<C, number>> {
  const pares: { coluna: number; campo: C; pontos: number }[] = [];
  cabecalhos.forEach((c, coluna) => pontuarCabecalho(regras, c).forEach((p) => pares.push({ coluna, ...p })));
  pares.sort((a, b) => b.pontos - a.pontos || a.coluna - b.coluna);
  const mapa: Partial<Record<C, number>> = {};
  const usadas = new Set<number>();
  for (const p of pares) {
    if (usadas.has(p.coluna) || mapa[p.campo] !== undefined) continue;
    mapa[p.campo] = p.coluna;
    usadas.add(p.coluna);
  }
  return mapa;
}

/**
 * Regras de detecção pelo nome da coluna (já normalizado: sem acento, minúsculo).
 * Pontuação maior vence; cada coluna vai para um campo só e cada campo recebe uma coluna só.
 */
const REGRAS: RegraCabecalho<CampoVenda>[] = [
  {
    campo: "codigoBarras",
    testes: [
      [/\b(cod|codigo|cd)\s*(de\s*)?barras?\b/, 10],
      [/\bean\b|\bean13\b|\bgtin\b|\bbarcode\b/, 10],
      [/\bbarras?\b/, 6],
    ],
  },
  {
    campo: "referencia",
    testes: [
      [/^(ref|referencia)$/, 10],
      [/\bref\b|\breferencia\b/, 8],
      [/\bsku\b/, 7],
      [/\bcod(igo)?\s*(do\s*)?produto\b/, 6],
      [/^(cod|codigo)$/, 4],
    ],
  },
  {
    campo: "data",
    testes: [
      [/^(data|dt)$/, 10],
      [/\bdata\b|\bdt\b/, 8],
      [/\bemissao\b|^dia$/, 6],
    ],
  },
  {
    campo: "quantidade",
    testes: [
      [/\btotal\s*(de\s*)?(pecas|itens|qtd|qtde)\b/, 11],
      [/^(qtd|qtde|quant|quantidade|qt)$/, 10],
      [/\bqtd|\bqtde\b|\bquantidade\b|\bquant\b|\bqt\b/, 8],
      [/\bpecas?\b|\bunidades\b/, 5],
    ],
  },
  {
    campo: "valorUnitario",
    testes: [
      [/\b(valor|preco|vlr|vl)\b.*\bunit|\bunit.*\b(valor|preco)\b/, 10],
      [/\bunitario\b|\bunit\b/, 7],
    ],
  },
  {
    campo: "valorTotal",
    testes: [
      [/\b(valor|vlr|vl)\s*total\b|\btotal\b/, 10],
      [/^(valor|vlr|vl|preco|preco venda|valor venda)$/, 8],
      [/\bvalor\b|\bpreco\b|\bvlr\b|\breceita\b|\bfaturamento\b|\bliquido\b/, 6],
    ],
  },
  {
    campo: "revendedora",
    testes: [
      [/\brevendedor(a|es|as)?\b/, 10],
      [/\bvendedor(a)?\b|\bconsultor(a)?\b|\brepresentante\b/, 9],
      [/\bcliente\b/, 3],
    ],
  },
  {
    campo: "canal",
    testes: [
      [/\bcanal\b/, 10],
      [/\btipo\s*(de\s*)?venda\b|\bmodalidade\b/, 9],
      [/^tipo$/, 7],
      [/\borigem\b/, 5],
    ],
  },
  {
    campo: "descricao",
    testes: [
      [/\bdescri/, 9],
      [/^(produto|nome|item)$/, 8],
      [/\bproduto\b|\bnome\b|\bitem\b/, 5],
    ],
  },
];

/** Maior pontuação de um nome de coluna entre os campos de venda (usada para achar a linha do cabeçalho). */
export const pontuarColunaVenda = (cabecalho: string) => Math.max(0, ...pontuarCabecalho(REGRAS, cabecalho).map((p) => p.pontos));

/** Sugere o mapeamento pelos nomes das colunas (sem acento e sem maiúsculas). */
export function sugerirMapeamento(cabecalhos: string[]): Mapeamento {
  return sugerirMapeamentoPor(REGRAS, cabecalhos);
}

/* ------------------------------------------------------- células e tipos */

/** Desembrulha os objetos de célula do exceljs (fórmula, rich text, hyperlink, erro). */
export function valorCelula(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
  if ("result" in o) return valorCelula(o.result);
  if ("text" in o) return valorCelula(o.text);
  if ("error" in o) return null;
  return null;
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/** Texto da célula, para exibição (datas em dd/mm/aaaa). */
export function textoCelula(v: unknown): string {
  const x = valorCelula(v);
  if (x == null) return "";
  if (x instanceof Date) return Number.isNaN(x.getTime()) ? "" : dataBr(x.toISOString().slice(0, 10));
  if (typeof x === "number") return Number.isInteger(x) ? String(x) : String(x).replace(".", ",");
  return String(x).replace(/\s+/g, " ").trim();
}

const textoOuNulo = (v: unknown) => textoCelula(v) || null;

/** Número no formato brasileiro ("1.234,56", "R$ 12,90") ou internacional ("1234.56"). */
export function lerNumero(v: unknown): number | null {
  const x = valorCelula(v);
  if (x == null || x === "") return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "boolean" || x instanceof Date) return null;
  let s = String(x).replace(/R\$|\s| /gi, "");
  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (/^[\d.,]+-$/.test(s)) {
    negativo = true;
    s = s.slice(0, -1);
  }
  if (!/^[+-]?[\d.,]*\d[\d.,]*$/.test(s)) return null;
  const virgula = s.lastIndexOf(",");
  const ponto = s.lastIndexOf(".");
  if (virgula >= 0 && ponto >= 0) s = virgula > ponto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (virgula >= 0) s = (s.match(/,/g) ?? []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (/^[+-]?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // "1.234" = mil duzentos e trinta e quatro
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

function montarData(ano: number, mes: number, dia: number): string | null {
  if (ano < 100) ano += 2000;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  if (ano < 2000 || ano > 2100) return null;
  return d.toISOString().slice(0, 10);
}

/** Número de série do Excel (dias desde 30/12/1899) → AAAA-MM-DD. */
export function dataDeSerieExcel(n: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
}

/** Data em "dd/mm/aaaa", "dd/mm/aa", ISO "aaaa-mm-dd" (com ou sem hora), Date do Excel ou número de série. */
export function lerData(v: unknown): string | null {
  const x = valorCelula(v);
  if (x == null || x === "") return null;
  if (x instanceof Date) return Number.isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10);
  if (typeof x === "number") return x > 20000 && x < 80000 ? dataDeSerieExcel(x) : null;
  const s = String(x).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/);
  if (m) return montarData(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:$|\s|,)/);
  if (m) return montarData(+m[3], +m[2], +m[1]);
  if (/^\d{5}$/.test(s)) return lerData(Number(s));
  return null;
}

/** Código de barras como texto (o Excel costuma guardar como número; tira o apóstrofo de texto). */
export function limparCodigo(v: unknown): string | null {
  const x = valorCelula(v);
  if (x == null) return null;
  if (typeof x === "number") return Number.isFinite(x) && x > 0 ? x.toFixed(0) : null;
  const s = String(x).trim().replace(/^'/, "").replace(/\s+/g, "");
  if (!s) return null;
  return /^[\d.-]+$/.test(s) ? s.replace(/\D/g, "") || null : s;
}

/* ---------------------------------------------------------------- CSV */

function contarForaDeAspas(linha: string, sep: string): number {
  let n = 0;
  let aspas = false;
  for (const ch of linha) {
    if (ch === '"') aspas = !aspas;
    else if (ch === sep && !aspas) n++;
  }
  return n;
}

/** Separador mais provável nas primeiras linhas: ";" (Excel em português), "," ou tabulação. */
export function detectarSeparador(texto: string): string {
  const linhas = texto
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim())
    .slice(0, 10);
  let melhor = ";";
  let max = 0;
  for (const sep of [";", "\t", ","]) {
    const n = linhas.reduce((s, l) => s + contarForaDeAspas(l, sep), 0);
    if (n > max) {
      max = n;
      melhor = sep;
    }
  }
  return melhor;
}

/** Lê CSV com aspas (RFC 4180). Mantém linhas vazias para a numeração bater com a planilha. */
export function lerCsv(texto: string, separador?: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const sep = separador ?? detectarSeparador(t);
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += ch;
    } else if (ch === '"' && campo.trim() === "") {
      campo = "";
      aspas = true;
    } else if (ch === sep) {
      linha.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += ch;
  }
  if (campo !== "" || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  while (linhas.length && linhas[linhas.length - 1].every((c) => !c.trim())) linhas.pop();
  return linhas;
}

export const linhaVazia = (l: unknown[] | undefined) => !l || l.every((c) => textoCelula(c) === "");

/**
 * Linha do cabeçalho: relatórios do UP costumam ter título e filtros antes da tabela.
 * Escolhe, entre as 30 primeiras, a linha com mais nomes de coluna reconhecidos;
 * sem nenhuma reconhecida, a primeira linha "cheia". `pontuarColuna`: regras de outro relatório (ex.: consignado).
 */
export function acharLinhaCabecalho(linhas: unknown[][], pontuarColuna: (cabecalho: string) => number = pontuarColunaVenda): number {
  const primeiras = linhas.slice(0, 30);
  let melhor = -1;
  let melhorAcertos = 1;
  primeiras.forEach((l, i) => {
    const acertos = (l ?? []).filter((c) => typeof valorCelula(c) === "string" && pontuarColuna(textoCelula(c)) >= 6).length;
    if (acertos > melhorAcertos) {
      melhorAcertos = acertos;
      melhor = i;
    }
  });
  if (melhor >= 0) return melhor;
  const cheios = primeiras.map((l) => (l ?? []).filter((c) => textoCelula(c) !== "").length);
  const max = Math.max(0, ...cheios);
  if (!max) return -1;
  return cheios.findIndex((n) => n >= Math.max(2, Math.ceil(max * 0.6)));
}

/* ------------------------------------------------------ linhas de venda */

export interface LinhaVenda {
  linha: number; // número da linha na planilha (1 = primeira linha do arquivo)
  data: string;
  referencia: string | null;
  codigoBarras: string | null;
  descricao: string | null;
  quantidade: number;
  valorTotal: number | null;
  revendedora: string | null;
  canal: string | null;
}

export interface LinhaIgnorada {
  linha: number;
  motivo: string;
}

/**
 * Converte as linhas da planilha (após o cabeçalho) pelo mapeamento escolhido.
 * Linhas vazias são puladas; as demais com problema voltam em "ignoradas" com o motivo.
 * Quantidade negativa (devolução) é aceita e desconta da venda.
 */
export function converterLinhas(
  linhas: unknown[][],
  mapa: Mapeamento,
  opcoes: { primeiraLinha?: number; dataPadrao?: string | null } = {},
): { vendas: LinhaVenda[]; ignoradas: LinhaIgnorada[] } {
  const primeira = opcoes.primeiraLinha ?? 2;
  const dataPadrao = opcoes.dataPadrao && lerData(opcoes.dataPadrao);
  const vendas: LinhaVenda[] = [];
  const ignoradas: LinhaIgnorada[] = [];
  const temColuna = (c: CampoVenda) => mapa[c] != null && mapa[c]! >= 0;

  linhas.forEach((l, i) => {
    const linha = primeira + i;
    if (linhaVazia(l)) return;
    const cel = (c: CampoVenda) => (temColuna(c) ? l[mapa[c]!] : undefined);
    const ignorar = (motivo: string) => ignoradas.push({ linha, motivo });

    const referencia = textoOuNulo(cel("referencia"));
    const codigoBarras = limparCodigo(cel("codigoBarras"));
    if (!referencia && !codigoBarras) {
      const texto = normalizarTexto(l.map((c) => textoCelula(c)).join(" "));
      return ignorar(/\b(sub)?total/.test(texto) ? "linha de total" : "sem referência nem código de barras");
    }

    let data: string | null = null;
    if (temColuna("data")) {
      const bruto = textoCelula(cel("data"));
      data = lerData(cel("data"));
      if (!data && bruto && !dataPadrao) return ignorar(`data inválida ("${bruto}")`);
    }
    data ??= dataPadrao || null;
    if (!data) return ignorar("sem data");

    let quantidade = 1;
    if (temColuna("quantidade")) {
      const q = lerNumero(cel("quantidade"));
      if (q == null) return ignorar(textoCelula(cel("quantidade")) ? `quantidade inválida ("${textoCelula(cel("quantidade"))}")` : "sem quantidade");
      if (q === 0) return ignorar("quantidade zero");
      quantidade = q;
    }

    let valorTotal: number | null = null;
    if (temColuna("valorTotal")) valorTotal = lerNumero(cel("valorTotal"));
    if (valorTotal == null && temColuna("valorUnitario")) {
      const unit = lerNumero(cel("valorUnitario"));
      if (unit != null) valorTotal = unit * quantidade;
    }

    vendas.push({
      linha,
      data,
      referencia,
      codigoBarras,
      descricao: textoOuNulo(cel("descricao")),
      quantidade,
      valorTotal: valorTotal == null ? null : r2(valorTotal),
      revendedora: textoOuNulo(cel("revendedora")),
      canal: textoOuNulo(cel("canal"))?.toLowerCase() ?? null,
    });
  });
  return { vendas, ignoradas };
}

/** Identifica uma linha para não importar duas vezes a mesma venda (reimportação ou períodos sobrepostos). */
export function impressaoDigital(v: {
  data: string | null;
  referencia: string | null;
  codigoBarras: string | null;
  quantidade: number;
  valorTotal: number | null;
  revendedora: string | null;
}): string {
  return [v.data ?? "", (v.referencia ?? "").toUpperCase(), v.codigoBarras ?? "", r2(v.quantidade), v.valorTotal == null ? "" : r2(v.valorTotal).toFixed(2), chaveNome(v.revendedora)].join("|");
}

/* ------------------------------------------------ ligação com produtos */

export interface ProdutoBase {
  id: string;
  codigoBarras: string | null;
  referencia: string | null;
  codigoFornecedor: string | null;
  nome: string | null;
  nomeComercial: string | null;
  tipo: string | null;
  quantidade: number; // quantidade pedida
  precoVenda: number | null;
  custoTotalBrl: number | null;
  imagemId: string | null;
  destaque: boolean;
  criadoEm: string;
  recompraDe: string | null;
  linha?: number | null;
  fornecedor: string | null; // do pedido
  dataPedido: string | null; // data de compra do pedido (AAAA-MM-DD)
  /* Chegada e conferência (do pedido). Tudo vazio = pedido antigo: conta como chegado, na data da compra. */
  pedidoId?: string | null;
  numeroPedido?: string | null;
  dataChegada?: string | null; // AAAA-MM-DD
  recebimento?: string | null; // em_transito | recebido | conferido
  conferidoEm?: string | null;
  quantidadeRecebida?: number | null;
  quantidadeDefeito?: number | null;
  /* Presença no UP. */
  codigoBarrasOrigem?: string | null; // "up" = código criado pelo UP
  upStatus?: string | null; // "enviado" = já mandado ao UP
  /* Valor da recompra na moeda do fornecedor. */
  precoOrigem?: number | null;
  moeda?: string | null;
}

export interface VendaBase {
  data: string | null;
  referencia: string | null;
  codigoBarras: string | null;
  produtoId: string | null;
  descricao?: string | null;
  quantidade: number;
  valorTotal: number | null;
  revendedora: string | null;
  canal?: string | null;
}

export interface IndiceProdutos {
  porEan: Map<string, ProdutoBase>;
  porCurto: Map<string, ProdutoBase>;
  porRef: Map<string, ProdutoBase>;
  porId: Map<string, ProdutoBase>;
  /** Produtos na ordem do índice: original antes da recompra, depois a ordem de cadastro. */
  ordenados: ProdutoBase[];
  /** Chave do SKU de cada produto (id → chave). */
  chaves: Map<string, string>;
}

const dataIso = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

/** Os 8 dígitos da sequência do EAN interno "9100…" (o Code128 curto que pode estar no UP). */
const codigoCurto = (ean: string | null | undefined) => (ean && /^9100\d{9}$/.test(ean) ? ean.slice(4, 12) : null);

/** Código para comparar: só dígitos sem zeros à esquerda (o Excel some com eles) ou o texto em maiúsculas. */
export const normalizarCodigo = (c: string | null | undefined) => {
  const s = String(c ?? "").trim();
  if (!s) return "";
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s.toUpperCase();
};

/**
 * Chave do SKU: o código de barras (a recompra reaproveita o código do original).
 * Sem código, sobe a cadeia de recompra (recompraDe) até achar um código ou chegar ao original,
 * para a recompra somar com o original.
 */
export function chaveSku(p: Pick<ProdutoBase, "id" | "codigoBarras"> & { recompraDe?: string | null }, idx?: Pick<IndiceProdutos, "porId">): string {
  if (p.codigoBarras) return p.codigoBarras;
  let atual: Pick<ProdutoBase, "id" | "codigoBarras"> & { recompraDe?: string | null } = p;
  const vistos = new Set<string>([p.id]);
  while (atual.recompraDe && idx) {
    const pai = idx.porId.get(atual.recompraDe);
    if (!pai || vistos.has(pai.id)) break;
    vistos.add(pai.id);
    atual = pai;
    if (atual.codigoBarras) return atual.codigoBarras;
  }
  return `id:${atual.id}`;
}

export function indexarProdutos(produtos: ProdutoBase[]): IndiceProdutos {
  // Original antes da recompra; depois a ordem de cadastro (primeira variação primeiro).
  const ordenados = [...produtos].sort(
    (a, b) =>
      (a.recompraDe ? 1 : 0) - (b.recompraDe ? 1 : 0) ||
      a.criadoEm.localeCompare(b.criadoEm) ||
      (a.linha ?? 0) - (b.linha ?? 0) ||
      a.id.localeCompare(b.id),
  );
  const idx: IndiceProdutos = { porEan: new Map(), porCurto: new Map(), porRef: new Map(), porId: new Map(), ordenados, chaves: new Map() };
  for (const p of ordenados) {
    idx.porId.set(p.id, p);
    if (p.codigoBarras) {
      if (!idx.porEan.has(p.codigoBarras)) idx.porEan.set(p.codigoBarras, p);
      // No UP pode estar o Code128 curto (os 8 dígitos da sequência do EAN "9100…").
      const curto = codigoCurto(p.codigoBarras);
      if (curto && !idx.porCurto.has(curto)) idx.porCurto.set(curto, p);
    }
    const ref = p.referencia?.trim().toUpperCase();
    if (ref && !idx.porRef.has(ref)) idx.porRef.set(ref, p);
  }
  for (const p of ordenados) idx.chaves.set(p.id, chaveSku(p, idx));
  return idx;
}

/** Chave do SKU de um produto do índice. */
export const chaveDoProduto = (p: ProdutoBase, idx: IndiceProdutos) => idx.chaves.get(p.id) ?? chaveSku(p, idx);

/**
 * Liga a venda (ou a linha do consignado) ao produto: pelo código de barras; sem ele, pelo produto já gravado
 * na importação; por último pela referência (com várias variações na mesma referência, fica a primeira).
 */
export function ligarVenda(
  v: Pick<VendaBase, "codigoBarras" | "referencia" | "produtoId">,
  idx: IndiceProdutos,
): { produto: ProdutoBase | null; por: "ean" | "referencia" | "id" | null } {
  const cod = v.codigoBarras?.trim();
  if (cod) {
    const digitos = cod.replace(/\D/g, "");
    const p = idx.porEan.get(cod) ?? (digitos ? idx.porEan.get(digitos) : undefined) ?? (digitos && digitos.length <= 8 ? idx.porCurto.get(digitos.padStart(8, "0")) : undefined);
    if (p) return { produto: p, por: "ean" };
  }
  if (v.produtoId) {
    const p = idx.porId.get(v.produtoId);
    if (p) return { produto: p, por: "id" };
  }
  const ref = v.referencia?.trim().toUpperCase();
  if (ref) {
    const p = idx.porRef.get(ref);
    if (p) return { produto: p, por: "referencia" };
  }
  return { produto: null, por: null };
}

/* ------------------------------------------------ chegada da mercadoria */

export interface Chegada {
  chegou: boolean;
  /** Entrada na loja (AAAA-MM-DD): a data de chegada; sem ela, a da conferência ou a da compra (estimada). Nula se não chegou. */
  data: string | null;
  estimada: boolean;
  /** Pedido a caminho: a data de chegada informada (prevista), se houver. */
  prevista: string | null;
}

/**
 * A linha já chegou na loja?
 *  - recebimento "recebido" ou "conferido": sim; "em_transito": não;
 *  - sem recebimento: pela data de chegada (passada = chegou, futura = a caminho);
 *  - sem nenhuma informação (pedidos antigos): conta como chegado, na data da compra (estimada).
 */
export function chegadaDe(p: Pick<ProdutoBase, "criadoEm" | "dataPedido" | "dataChegada" | "recebimento" | "conferidoEm">, hoje: string): Chegada {
  const rec = p.recebimento ?? "";
  const dc = dataIso(p.dataChegada);
  let chegou: boolean;
  if (rec === "recebido" || rec === "conferido") chegou = true;
  else if (rec === "em_transito") chegou = false;
  else if (dc) chegou = dc <= hoje;
  else chegou = true;
  if (!chegou) return { chegou, data: null, estimada: false, prevista: dc };
  if (dc && dc <= hoje) return { chegou, data: dc, estimada: false, prevista: null };
  const data = dataIso(p.conferidoEm?.slice(0, 10)) ?? dataIso(p.dataPedido) ?? p.criadoEm.slice(0, 10);
  return { chegou, data, estimada: true, prevista: null };
}

/**
 * Quantidade que entrou na loja na linha do pedido: conferida = recebida − defeito; senão a pedida.
 * (A mesma regra de src/lib/estoque.ts.)
 */
export function entradaDaLinha(p: Pick<ProdutoBase, "quantidade" | "quantidadeRecebida" | "quantidadeDefeito">): number {
  return estoqueEntrada({ quantidade: p.quantidade, quantidadeRecebida: p.quantidadeRecebida ?? null, quantidadeDefeito: p.quantidadeDefeito ?? 0 });
}

/** O UP já conhece a peça? Código criado pelo UP, enviada ao UP, ou o código aparece no que veio do UP (saldos, consignado). */
export function produtoNoUp(p: Pick<ProdutoBase, "codigoBarras" | "codigoBarrasOrigem" | "upStatus">, codigosUp: Set<string>): boolean {
  if (p.codigoBarrasOrigem === "up" || p.upStatus === "enviado") return true;
  if (!p.codigoBarras || !codigosUp.size) return false;
  if (codigosUp.has(normalizarCodigo(p.codigoBarras))) return true;
  const curto = codigoCurto(p.codigoBarras);
  return !!curto && codigosUp.has(normalizarCodigo(curto));
}

/* ----------------------------------------------------- regras de giro */

export type StatusSku = "repor" | "parado" | "ok" | "esgotado";
export type Curva = "A" | "B" | "C";

export const LIMITE_A = 0.8;
export const LIMITE_B = 0.95;
export const MARGEM_SEGURANCA = 1.5;

/** Sell-through: vendido ÷ comprado (0 a 1). */
export function sellThrough(vendido: number, comprado: number): number {
  if (comprado <= 0) return vendido > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, vendido / comprado));
}

/** Ponto de reposição = venda média diária × prazo de reposição × 1,5. */
export function pontoReposicao(mediaDiaria: number, prazoDias: number): number {
  return mediaDiaria * prazoDias * MARGEM_SEGURANCA;
}

/**
 * Quantidade sugerida na recompra: cobre o prazo de chegada com a margem (o ponto de reposição)
 * e mais um prazo de vendas, descontando o estoque. Mínimo 1.
 */
export function quantidadeSugerida(mediaDiaria: number, prazoDias: number, estoque: number): number {
  const alvo = pontoReposicao(mediaDiaria, prazoDias) + mediaDiaria * prazoDias;
  return Math.max(1, Math.ceil(alvo - Math.max(0, estoque) - 1e-9));
}

/** Como quantidadeSugerida, descontando também o que já está a caminho (pode dar 0: a chegada já cobre). */
export function necessidadeRecompra(mediaDiaria: number, prazoDias: number, estoque: number, aCaminho = 0): number {
  const alvo = pontoReposicao(mediaDiaria, prazoDias) + mediaDiaria * prazoDias;
  return Math.max(0, Math.ceil(alvo - Math.max(0, estoque) - Math.max(0, aCaminho) - 1e-9));
}

/**
 * Status do SKU:
 *  - esgotado: estoque estimado zerado;
 *  - parado: tem estoque e não vende há mais de "diasParado" dias (vence o "repor": não se recompra o que parou);
 *  - repor: vendeu algo e o estoque está no ponto de reposição ou abaixo;
 *  - ok: o resto.
 */
export function statusReposicao(
  s: { comprado: number; vendido: number; estoque: number; ponto: number; diasSemVenda: number },
  diasParado: number,
): StatusSku {
  if (s.estoque <= 0 && (s.comprado > 0 || s.vendido > 0)) return "esgotado";
  if (s.estoque > 0 && s.diasSemVenda > diasParado) return "parado";
  if (s.vendido > 0 && s.estoque <= s.ponto) return "repor";
  return "ok";
}

/** Curva ABC pela receita: A até 80% da receita acumulada, B até 95%, C o resto. Devolve ordenado. */
export function curvaAbc<T extends { receita: number }>(itens: T[]): (T & { curva: Curva; participacao: number; acumulado: number })[] {
  const total = itens.reduce((s, i) => s + Math.max(0, i.receita), 0);
  let acumulado = 0;
  return [...itens]
    .sort((a, b) => b.receita - a.receita)
    .map((i) => {
      const r = Math.max(0, i.receita);
      const antes = total > 0 ? acumulado / total : 1;
      acumulado += r;
      const curva: Curva = r <= 0 ? "C" : antes < LIMITE_A - 1e-9 ? "A" : antes < LIMITE_B - 1e-9 ? "B" : "C";
      return { ...i, curva, participacao: total ? r4(r / total) : 0, acumulado: total ? r4(acumulado / total) : 0 };
    });
}

/* ------------------------------------------ leitura ABC × sell-through */

export type Ritmo = "rapido" | "normal" | "lento" | "encalhado";
export type AcaoRecompra = "recomprar" | "recomprar_pouco" | "aguardar" | "nao_recomprar";

/**
 * Ritmo de venda pela fração do estoque vendida por mês desde a chegada (sell-through ÷ meses, mínimo 1 mês):
 * rápido ≥ 25% ao mês (esgota em até 4 meses), normal ≥ 10%, encalhado = parado ou menos de 20% vendido em 90 dias, lento o resto.
 */
export function ritmoDeVenda(s: { sellThrough: number; vendido: number; idadeDias: number; status: StatusSku }): Ritmo {
  if (s.status === "parado") return "encalhado";
  const porMes = s.vendido > 0 ? s.sellThrough / Math.max(1, s.idadeDias / 30) : 0;
  if (porMes >= 0.25) return "rapido";
  if (porMes >= 0.1) return "normal";
  if (s.idadeDias >= 90 && s.sellThrough < 0.2) return "encalhado";
  return "lento";
}

const LEITURAS: Record<Curva, Record<Ritmo, [string, AcaoRecompra]>> = {
  A: {
    rapido: ["A e vende rápido: recomprar", "recomprar"],
    normal: ["A e vende bem: recomprar", "recomprar"],
    lento: ["A, mas gira devagar: recomprar pouco", "recomprar_pouco"],
    encalhado: ["A, mas está parada: esperar o estoque baixar", "aguardar"],
  },
  B: {
    rapido: ["B e vende rápido: recomprar", "recomprar"],
    normal: ["B e vende no ritmo: recomprar pouco", "recomprar_pouco"],
    lento: ["B e vende devagar: esperar", "aguardar"],
    encalhado: ["B e encalhada: não recomprar", "nao_recomprar"],
  },
  C: {
    rapido: ["C, mas vende rápido: recompra pequena para testar", "recomprar_pouco"],
    normal: ["C e vende pouco: não recomprar", "nao_recomprar"],
    lento: ["C e vende devagar: não recomprar", "nao_recomprar"],
    encalhado: ["C e encalhada: não recomprar", "nao_recomprar"],
  },
};

/** Leitura curta da curva ABC com o ritmo de venda. `curva` nula = peça nova (fora da curva). */
export function leituraAbc(curva: Curva | null, ritmo: Ritmo, diasForaDaCurva: number): { leitura: string; acao: AcaoRecompra } {
  if (!curva) {
    return ritmo === "rapido"
      ? { leitura: "nova e vende rápido: recomprar", acao: "recomprar" }
      : { leitura: `nova (menos de ${diasForaDaCurva} dias): avaliar depois`, acao: "aguardar" };
  }
  const [leitura, acao] = LEITURAS[curva][ritmo];
  return { leitura, acao };
}

/**
 * Freios da recompra, nesta ordem:
 *  1. leitura ABC: "esperar"/"não recomprar" zeram; "recomprar pouco" leva metade;
 *  2. teto por modelo (maletas ativas + reserva da vitrine): estoque + a caminho + recompra não passa dele;
 *  3. lote do fornecedor: arredonda para cima no múltiplo que ele aceita.
 */
export function freiosRecompra(x: {
  necessidade: number;
  estoque: number;
  aCaminho: number;
  acao: AcaoRecompra;
  leitura: string;
  teto?: number | null;
  lote?: number | null;
}): { quantidade: number; freios: string[] } {
  const freios: string[] = [];
  let q = Math.max(0, Math.ceil(x.necessidade));
  if (x.aCaminho > 0) freios.push(`${pecasTexto(x.aCaminho)} a caminho`);
  if (q > 0 && (x.acao === "aguardar" || x.acao === "nao_recomprar")) {
    q = 0;
    freios.push(x.leitura);
  } else if (q > 0 && x.acao === "recomprar_pouco") {
    const metade = Math.ceil(q / 2);
    if (metade < q) freios.push(`metade (${x.leitura.split(":")[0]})`);
    q = metade;
  }
  const teto = x.teto && x.teto > 0 ? Math.floor(x.teto) : 0;
  if (q > 0 && teto) {
    const espaco = Math.max(0, teto - Math.max(0, x.estoque) - Math.max(0, x.aCaminho));
    if (q > espaco) {
      q = espaco;
      freios.push(`teto de ${teto} por modelo`);
    }
  }
  const lote = x.lote && x.lote > 1 ? Math.floor(x.lote) : 1;
  if (q > 0 && lote > 1) {
    const arredondada = Math.ceil(q / lote) * lote;
    if (arredondada !== q) {
      const passa = teto > 0 && arredondada + Math.max(0, x.estoque) + Math.max(0, x.aCaminho) > teto;
      freios.push(`lote de ${lote}${passa ? " (passa do teto)" : ""}`);
    }
    q = arredondada;
  }
  return { quantidade: q, freios };
}

const pecasTexto = (n: number) => `${r2(n).toLocaleString("pt-BR")} ${Math.abs(n) === 1 ? "peça" : "peças"}`;

/* ------------------------------------------------------------ análise */

export interface ParametrosAnalise {
  hoje: string; // AAAA-MM-DD
  inicio?: string | null;
  fim?: string | null;
  prazoReposicaoDias: number;
  diasEstoqueParado: number;
  /** Peças com menos dias desde a chegada ficam fora da curva ABC ("novas"). 0 ou vazio = todas entram. */
  diasForaDaCurva?: number;
  /** Códigos de barras que o UP conhece (saldos e consignado importados do UP). */
  codigosUp?: Iterable<string>;
  /** Peças com as revendedoras (consignado do UP), por chave do SKU. */
  comRevendedoras?: Map<string, number>;
  /** Freios da recompra. */
  recompra?: {
    tetoPorModelo?: number | null; // maletas ativas + reserva da vitrine (0 = sem teto)
    loteMinimoPadrao?: number | null;
    /** Lote mínimo do próprio fornecedor (Fornecedores → lote mínimo); vazio = vale o padrão da loja. */
    loteDoFornecedor?: (fornecedor: string | null) => number | null | undefined;
  };
}

export interface SkuAnalise {
  chave: string;
  produtoId: string;
  produtoIds: string[];
  codigoBarras: string | null;
  referencia: string | null;
  codigoFornecedor: string | null;
  nome: string;
  tipo: string | null;
  fornecedor: string | null;
  /** Apelido do fornecedor dado pela loja (só exibição; preenchido pelo servidor). */
  fornecedorApelido?: string | null;
  imagemId: string | null;
  destaque: boolean;
  precoVenda: number | null;
  custo: number | null;
  /** Custo da linha mais recente (a recompra sai pelo preço atual). */
  custoRecompra: number | null;
  /** Preço unitário na moeda do fornecedor (linha mais recente) e a moeda. */
  precoOrigem: number | null;
  moeda: string | null;
  /** Entrada na loja: a chegada mais antiga; sem data de chegada, a data da compra (estimada). */
  dataEntrada: string;
  dataEntradaEstimada: boolean;
  /** Dias desde a entrada até o fim do período. */
  idadeDias: number;
  comprado: number; // peças que entraram (recebidas − defeito ou a pedida), só de pedidos que já chegaram
  aCaminho: number; // peças de pedidos que ainda não chegaram
  vendido: number; // até o fim do período (base do estoque e do sell-through)
  vendidoPeriodo: number;
  receita: number; // no período
  sellThrough: number;
  mediaDiaria: number;
  estoque: number;
  /** Peças com as revendedoras (consignado do UP). */
  comRevendedoras: number;
  /** Disponível para a maleta: estoque − com as revendedoras. */
  disponivel: number;
  /** O UP conhece a peça (código do UP, enviada, ou apareceu nas vendas/saldos/consignado do UP). */
  noUp: boolean;
  divergente: boolean; // vendeu mais do que o app registra como comprado
  pontoReposicao: number;
  /** Quantidade pelo giro, antes dos freios. */
  necessidade: number;
  /** Quantidade da recompra depois dos freios (leitura ABC, teto por modelo, lote do fornecedor). */
  quantidadeSugerida: number;
  freios: string[];
  lote: number;
  primeiraVenda: string | null;
  ultimaVenda: string | null;
  diasSemVenda: number;
  status: StatusSku;
  /** Nula = peça nova (menos de diasForaDaCurva dias desde a chegada): fica fora da curva ABC. */
  curva: Curva | null;
  nova: boolean;
  participacao: number;
  acumulado: number;
  ritmo: Ritmo;
  leitura: string;
  acao: AcaoRecompra;
}

export interface ResumoGrupo {
  chave: string;
  skus: number;
  comprado: number;
  vendido: number;
  vendidoPeriodo: number;
  receita: number;
  participacao: number;
  sellThrough: number;
  estoque: number;
  valorEstoque: number;
  repor: number;
  parados: number;
}

export interface ResumoRevendedora {
  posicao: number;
  chave: string;
  nome: string;
  pecas: number;
  receita: number;
  linhas: number;
  skus: number;
  ticketMedio: number; // receita por peça
  tipoFavorito: string | null;
  primeiraVenda: string | null;
  ultimaVenda: string | null;
}

export interface AnaliseVendas {
  temVendas: boolean;
  periodo: { inicio: string | null; fim: string; primeiraVenda: string | null; ultimaVenda: string | null };
  parametros: { prazoReposicaoDias: number; diasEstoqueParado: number; diasForaDaCurva: number; tetoPorModelo: number | null; loteMinimoPadrao: number };
  totais: {
    receita: number;
    pecas: number;
    linhas: number;
    linhasLigadas: number;
    skusVendidos: number;
    comprado: number;
    vendido: number;
    sellThrough: number;
    repor: number;
    esgotados: number;
    parados: number;
    valorParado: number;
    comRevendedoras: number;
  };
  naoLigadas: { linhas: number; pecas: number; receita: number; exemplos: { codigo: string; descricao: string | null; pecas: number; receita: number }[] };
  /** Curva ABC sem as peças novas. */
  abc: Record<Curva, { skus: number; receita: number; participacao: number }>;
  /** Peças novas (fora da curva). */
  novas: { skus: number; receita: number };
  /** Peças de pedidos que ainda não chegaram (fora do estoque e da maleta). */
  aCaminho: { skus: number; pecas: number };
  skus: SkuAnalise[];
  porTipo: ResumoGrupo[];
  porFornecedor: ResumoGrupo[];
  revendedoras: ResumoRevendedora[];
}

function resumir(skus: SkuAnalise[], chaveDe: (s: SkuAnalise) => string): ResumoGrupo[] {
  const grupos = new Map<string, ResumoGrupo>();
  const total = skus.reduce((s, x) => s + x.receita, 0);
  for (const s of skus) {
    const k = chaveDe(s);
    let g = grupos.get(k);
    if (!g) {
      g = { chave: k, skus: 0, comprado: 0, vendido: 0, vendidoPeriodo: 0, receita: 0, participacao: 0, sellThrough: 0, estoque: 0, valorEstoque: 0, repor: 0, parados: 0 };
      grupos.set(k, g);
    }
    g.skus++;
    g.comprado += s.comprado;
    g.vendido += s.vendido;
    g.vendidoPeriodo += s.vendidoPeriodo;
    g.receita += s.receita;
    g.estoque += s.estoque;
    g.valorEstoque += s.estoque * (s.precoVenda ?? 0);
    if (s.status === "repor" || s.status === "esgotado") g.repor++;
    if (s.status === "parado") g.parados++;
  }
  return [...grupos.values()]
    .map((g) => ({
      ...g,
      vendido: r2(g.vendido),
      vendidoPeriodo: r2(g.vendidoPeriodo),
      receita: r2(g.receita),
      estoque: r2(g.estoque),
      valorEstoque: r2(g.valorEstoque),
      participacao: total ? r4(g.receita / total) : 0,
      sellThrough: r4(sellThrough(g.vendido, g.comprado)),
    }))
    .sort((a, b) => b.receita - a.receita || b.vendido - a.vendido);
}

/**
 * Análise por SKU (agrupado pelo código de barras; sem código, pela cadeia de recompra). O estoque estimado e o
 * sell-through usam todas as vendas até o fim do período; receita, peças, curva ABC e rankings, só as do período.
 * Só entram no estoque as linhas de pedidos que já chegaram; giro, "parado", "novidade" e curva contam da chegada.
 */
export function analisarVendas(produtos: ProdutoBase[], vendas: VendaBase[], p: ParametrosAnalise): AnaliseVendas {
  const ate = p.fim || p.hoje;
  const inicio = p.inicio || null;
  const idx = indexarProdutos(produtos);
  const diasCurva = Math.max(0, Math.floor(Number(p.diasForaDaCurva) || 0));
  const codigosUp = new Set<string>();
  for (const c of p.codigosUp ?? []) {
    const k = normalizarCodigo(c);
    if (k) codigosUp.add(k);
  }
  const teto = Math.max(0, Math.floor(Number(p.recompra?.tetoPorModelo) || 0));
  const lotePadrao = Math.max(1, Math.floor(Number(p.recompra?.loteMinimoPadrao) || 1));

  type Grupo = {
    rep: ProdutoBase;
    produtos: ProdutoBase[];
    vendido: number;
    vendidoPeriodo: number;
    receita: number;
    linhasVenda: number;
    primeiraVenda: string | null;
    ultimaVenda: string | null;
    descricao: string | null;
  };
  const grupos = new Map<string, Grupo>();
  for (const prod of idx.ordenados) {
    const chave = chaveDoProduto(prod, idx);
    let g = grupos.get(chave);
    if (!g) {
      g = { rep: prod, produtos: [], vendido: 0, vendidoPeriodo: 0, receita: 0, linhasVenda: 0, primeiraVenda: null, ultimaVenda: null, descricao: null };
      grupos.set(chave, g);
    }
    g.produtos.push(prod);
  }

  type Rev = { chave: string; grafias: Map<string, number>; pecas: number; receita: number; linhas: number; skus: Set<string>; tipos: Map<string, number>; primeiraVenda: string | null; ultimaVenda: string | null };
  const revendedoras = new Map<string, Rev>();
  const naoLigadas = new Map<string, { codigo: string; descricao: string | null; pecas: number; receita: number }>();
  const totais = { receita: 0, pecas: 0, linhas: 0, linhasLigadas: 0 };
  const nl = { linhas: 0, pecas: 0, receita: 0 };
  let primeiraVenda: string | null = null;
  let ultimaVenda: string | null = null;

  for (const v of vendas) {
    if (!v.data || v.data > ate) continue;
    const noPeriodo = !inicio || v.data >= inicio;
    const { produto } = ligarVenda(v, idx);
    const chaveProduto = produto ? chaveDoProduto(produto, idx) : null;
    const g = chaveProduto ? grupos.get(chaveProduto) : undefined;
    const receita = v.valorTotal ?? (produto?.precoVenda ?? 0) * v.quantidade;
    if (g) {
      g.vendido += v.quantidade;
      g.linhasVenda++;
      if (v.quantidade > 0) {
        if (!g.ultimaVenda || v.data > g.ultimaVenda) g.ultimaVenda = v.data;
        if (!g.primeiraVenda || v.data < g.primeiraVenda) g.primeiraVenda = v.data;
      }
      g.descricao ??= v.descricao ?? null;
      if (noPeriodo) {
        g.vendidoPeriodo += v.quantidade;
        g.receita += receita;
      }
    }
    if (!noPeriodo) continue;

    totais.receita += receita;
    totais.pecas += v.quantidade;
    totais.linhas++;
    if (g) totais.linhasLigadas++;
    if (v.quantidade > 0) {
      if (!primeiraVenda || v.data < primeiraVenda) primeiraVenda = v.data;
      if (!ultimaVenda || v.data > ultimaVenda) ultimaVenda = v.data;
    }

    if (!g) {
      nl.linhas++;
      nl.pecas += v.quantidade;
      nl.receita += receita;
      const codigo = v.codigoBarras || v.referencia || v.descricao || "?";
      const x = naoLigadas.get(codigo) ?? { codigo, descricao: v.descricao ?? null, pecas: 0, receita: 0 };
      x.pecas += v.quantidade;
      x.receita += receita;
      naoLigadas.set(codigo, x);
    }

    const chaveRev = chaveNome(v.revendedora);
    let r = revendedoras.get(chaveRev);
    if (!r) {
      r = { chave: chaveRev, grafias: new Map(), pecas: 0, receita: 0, linhas: 0, skus: new Set(), tipos: new Map(), primeiraVenda: null, ultimaVenda: null };
      revendedoras.set(chaveRev, r);
    }
    const grafia = v.revendedora?.replace(/\s+/g, " ").trim() || "";
    r.grafias.set(grafia, (r.grafias.get(grafia) ?? 0) + 1);
    r.pecas += v.quantidade;
    r.receita += receita;
    r.linhas++;
    if (produto && chaveProduto) {
      r.skus.add(chaveProduto);
      if (produto.tipo) r.tipos.set(produto.tipo, (r.tipos.get(produto.tipo) ?? 0) + v.quantidade);
    }
    if (v.quantidade > 0) {
      if (!r.primeiraVenda || v.data < r.primeiraVenda) r.primeiraVenda = v.data;
      if (!r.ultimaVenda || v.data > r.ultimaVenda) r.ultimaVenda = v.data;
    }
  }

  type Base = Omit<SkuAnalise, "curva" | "participacao" | "acumulado" | "ritmo" | "leitura" | "acao" | "quantidadeSugerida" | "freios">;
  const base: Base[] = [];
  const caminho = { skus: 0, pecas: 0 };
  for (const [chave, g] of grupos) {
    const linhas = g.produtos.map((x) => ({ x, ch: chegadaDe(x, p.hoje) }));
    const aCaminho = linhas.filter((l) => !l.ch.chegou).reduce((s, l) => s + entradaDaLinha(l.x), 0);
    if (aCaminho > 0) {
      caminho.skus++;
      caminho.pecas += aCaminho;
    }
    const entraram = linhas.filter((l) => l.ch.chegou && l.ch.data! <= ate);
    if (!entraram.length && !g.vendido) continue; // ainda não estava na loja no fim do período
    const comprado = entraram.reduce((s, l) => s + entradaDaLinha(l.x), 0);

    // Entrada: a chegada mais antiga (sem chegada informada, a data da compra: estimada).
    let entrada: { data: string; estimada: boolean };
    if (entraram.length) {
      const primeira = [...entraram].sort((a, b) => a.ch.data!.localeCompare(b.ch.data!) || Number(a.ch.estimada) - Number(b.ch.estimada))[0];
      entrada = { data: primeira.ch.data!, estimada: primeira.ch.estimada };
    } else {
      const datas = linhas.map((l) => l.ch.data ?? l.ch.prevista ?? dataIso(l.x.dataPedido) ?? l.x.criadoEm.slice(0, 10)).sort();
      entrada = { data: datas[0], estimada: true };
    }
    if (g.primeiraVenda && g.primeiraVenda < entrada.data) entrada = { data: g.primeiraVenda, estimada: true };

    const vendido = r2(g.vendido);
    const idadeDias = Math.max(0, diasEntre(entrada.data, ate));
    const mediaDiaria = Math.max(0, vendido) / Math.max(1, idadeDias);
    const estoqueBruto = comprado - vendido;
    const estoque = Math.max(0, r2(estoqueBruto));
    const comRev = Math.max(0, r2(p.comRevendedoras?.get(chave) ?? 0));
    const ponto = pontoReposicao(mediaDiaria, p.prazoReposicaoDias);
    const diasSemVenda = Math.max(0, diasEntre(g.ultimaVenda ?? entrada.data, ate));
    const status = statusReposicao({ comprado, vendido, estoque, ponto, diasSemVenda }, p.diasEstoqueParado);
    const rep = g.rep;
    // A recompra sai pelo preço da linha mais recente.
    const recente = [...g.produtos].sort((a, b) => (b.dataPedido || b.criadoEm).localeCompare(a.dataPedido || a.criadoEm) || b.criadoEm.localeCompare(a.criadoEm))[0];
    const comCusto = [recente, ...g.produtos].find((x) => x.custoTotalBrl != null);
    const comPreco = [recente, ...g.produtos].find((x) => x.precoOrigem != null);
    const loteFornecedor = p.recompra?.loteDoFornecedor?.(rep.fornecedor) ?? null;
    base.push({
      chave,
      produtoId: rep.id,
      produtoIds: g.produtos.map((x) => x.id),
      codigoBarras: rep.codigoBarras ?? g.produtos.find((x) => x.codigoBarras)?.codigoBarras ?? null,
      referencia: rep.referencia,
      codigoFornecedor: rep.codigoFornecedor,
      nome: rep.nome || rep.nomeComercial || g.descricao || rep.referencia || "Sem nome",
      tipo: rep.tipo,
      fornecedor: rep.fornecedor,
      imagemId: rep.imagemId ?? g.produtos.find((x) => x.imagemId)?.imagemId ?? null,
      destaque: g.produtos.some((x) => x.destaque),
      precoVenda: rep.precoVenda,
      custo: rep.custoTotalBrl,
      custoRecompra: comCusto?.custoTotalBrl ?? null,
      precoOrigem: comPreco?.precoOrigem ?? null,
      moeda: comPreco?.moeda ?? null,
      dataEntrada: entrada.data,
      dataEntradaEstimada: entrada.estimada,
      idadeDias,
      comprado,
      aCaminho,
      vendido,
      vendidoPeriodo: r2(g.vendidoPeriodo),
      receita: r2(g.receita),
      sellThrough: r4(sellThrough(vendido, comprado)),
      mediaDiaria: r4(mediaDiaria),
      estoque,
      comRevendedoras: comRev,
      disponivel: Math.max(0, r2(estoque - comRev)),
      noUp: g.linhasVenda > 0 || g.produtos.some((x) => produtoNoUp(x, codigosUp)),
      divergente: estoqueBruto < 0,
      pontoReposicao: r2(ponto),
      necessidade: (status === "repor" || status === "esgotado") && vendido > 0 ? necessidadeRecompra(mediaDiaria, p.prazoReposicaoDias, estoque, aCaminho) : 0,
      lote: loteMinimoEfetivo(loteFornecedor, lotePadrao), // o do fornecedor (mesmo 1 = sem arredondar), senão o padrão da loja
      primeiraVenda: g.primeiraVenda,
      ultimaVenda: g.ultimaVenda,
      diasSemVenda,
      status,
      nova: diasCurva > 0 && idadeDias < diasCurva,
    });
  }

  // Curva ABC só com as peças que já passaram do período de avaliação; as novas ficam à parte.
  const totalReceita = base.reduce((s, x) => s + Math.max(0, x.receita), 0);
  const naCurva = curvaAbc(base.filter((s) => !s.nova));
  const novas = base
    .filter((s) => s.nova)
    .sort((a, b) => b.receita - a.receita)
    .map((s) => ({ ...s, curva: null as Curva | null, participacao: totalReceita ? r4(Math.max(0, s.receita) / totalReceita) : 0, acumulado: 0 }));
  const skus: SkuAnalise[] = [...naCurva, ...novas].map((s) => {
    const ritmo = ritmoDeVenda(s);
    const { leitura, acao } = leituraAbc(s.curva, ritmo, diasCurva);
    const { quantidade, freios } = freiosRecompra({ necessidade: s.necessidade, estoque: s.estoque, aCaminho: s.aCaminho, acao, leitura, teto, lote: s.lote });
    return { ...s, ritmo, leitura, acao, quantidadeSugerida: quantidade, freios };
  });

  const abc: AnaliseVendas["abc"] = { A: { skus: 0, receita: 0, participacao: 0 }, B: { skus: 0, receita: 0, participacao: 0 }, C: { skus: 0, receita: 0, participacao: 0 } };
  const resumoNovas = { skus: 0, receita: 0 };
  for (const s of skus) {
    if (!s.curva) {
      resumoNovas.skus++;
      resumoNovas.receita += s.receita;
      continue;
    }
    abc[s.curva].skus++;
    abc[s.curva].receita += s.receita;
    abc[s.curva].participacao += s.participacao;
  }
  for (const c of ["A", "B", "C"] as const) {
    abc[c].receita = r2(abc[c].receita);
    abc[c].participacao = r4(abc[c].participacao);
  }

  const comprado = skus.reduce((s, x) => s + x.comprado, 0);
  const vendido = skus.reduce((s, x) => s + x.vendido, 0);
  const parados = skus.filter((s) => s.status === "parado");

  const ranking: ResumoRevendedora[] = [...revendedoras.values()]
    .map((r) => ({
      posicao: 0,
      chave: r.chave,
      nome: [...r.grafias.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "", // a grafia mais usada
      pecas: r2(r.pecas),
      receita: r2(r.receita),
      linhas: r.linhas,
      skus: r.skus.size,
      ticketMedio: r.pecas > 0 ? r2(r.receita / r.pecas) : 0,
      tipoFavorito: [...r.tipos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      primeiraVenda: r.primeiraVenda,
      ultimaVenda: r.ultimaVenda,
    }))
    .sort((a, b) => b.receita - a.receita || b.pecas - a.pecas)
    .map((r, i) => ({ ...r, posicao: i + 1 }));

  return {
    temVendas: vendas.length > 0,
    periodo: { inicio, fim: ate, primeiraVenda, ultimaVenda },
    parametros: { prazoReposicaoDias: p.prazoReposicaoDias, diasEstoqueParado: p.diasEstoqueParado, diasForaDaCurva: diasCurva, tetoPorModelo: teto || null, loteMinimoPadrao: lotePadrao },
    totais: {
      receita: r2(totais.receita),
      pecas: r2(totais.pecas),
      linhas: totais.linhas,
      linhasLigadas: totais.linhasLigadas,
      skusVendidos: skus.filter((s) => s.vendidoPeriodo > 0).length,
      comprado,
      vendido: r2(vendido),
      sellThrough: r4(sellThrough(vendido, comprado)),
      repor: skus.filter((s) => s.status === "repor").length,
      esgotados: skus.filter((s) => s.status === "esgotado").length,
      parados: parados.length,
      valorParado: r2(parados.reduce((s, x) => s + x.estoque * (x.precoVenda ?? 0), 0)),
      comRevendedoras: r2(skus.reduce((s, x) => s + x.comRevendedoras, 0)),
    },
    naoLigadas: {
      linhas: nl.linhas,
      pecas: r2(nl.pecas),
      receita: r2(nl.receita),
      exemplos: [...naoLigadas.values()]
        .sort((a, b) => b.pecas - a.pecas)
        .slice(0, 15)
        .map((x) => ({ ...x, pecas: r2(x.pecas), receita: r2(x.receita) })),
    },
    abc,
    novas: { skus: resumoNovas.skus, receita: r2(resumoNovas.receita) },
    aCaminho: { skus: caminho.skus, pecas: r2(caminho.pecas) },
    skus,
    porTipo: resumir(skus, (s) => s.tipo ?? ""),
    porFornecedor: resumir(skus, (s) => s.fornecedor?.trim() || ""),
    revendedoras: ranking,
  };
}

/* ------------------------------------------------- recompra: totais */

export interface TotalRecompra {
  chave: string;
  skus: number;
  pecas: number;
  brl: number;
  /** Valor na moeda do fornecedor (ex.: { CNY: 1234.5 }). */
  moeda: Record<string, number>;
}

export interface TotaisRecompra {
  skus: number;
  pecas: number;
  brl: number;
  moeda: Record<string, number>;
  porFornecedor: TotalRecompra[];
  porTipo: TotalRecompra[];
  /** Orçamento mensal da recompra (0 = sem orçamento). */
  orcamento: number;
  /** Quanto passou do orçamento (0 = dentro ou sem orçamento). */
  excesso: number;
  /** Peças sem custo (ficam fora do total em R$). */
  semCusto: number;
}

/** Totais da lista de recompra em R$ (custo da peça) e na moeda do fornecedor, por fornecedor e por tipo, contra o orçamento. */
export function totaisRecompra(itens: SkuAnalise[], orcamento = 0): TotaisRecompra {
  const novo = (chave: string): TotalRecompra => ({ chave, skus: 0, pecas: 0, brl: 0, moeda: {} });
  const somar = (t: TotalRecompra, s: SkuAnalise) => {
    const q = s.quantidadeSugerida;
    t.skus++;
    t.pecas += q;
    t.brl += q * (s.custoRecompra ?? s.custo ?? 0);
    if (s.precoOrigem != null) {
      const m = s.moeda || "CNY";
      t.moeda[m] = (t.moeda[m] ?? 0) + q * s.precoOrigem;
    }
  };
  const total = novo("");
  const fornecedores = new Map<string, TotalRecompra>();
  const tipos = new Map<string, TotalRecompra>();
  let semCusto = 0;
  for (const s of itens) {
    if (s.quantidadeSugerida <= 0) continue;
    if (s.custoRecompra == null && s.custo == null) semCusto++;
    somar(total, s);
    const f = s.fornecedor?.trim() || "";
    const t = s.tipo ?? "";
    if (!fornecedores.has(f)) fornecedores.set(f, novo(f));
    if (!tipos.has(t)) tipos.set(t, novo(t));
    somar(fornecedores.get(f)!, s);
    somar(tipos.get(t)!, s);
  }
  const arred = (t: TotalRecompra): TotalRecompra => ({ ...t, brl: r2(t.brl), moeda: Object.fromEntries(Object.entries(t.moeda).map(([m, v]) => [m, r2(v)])) });
  const orc = Math.max(0, Number(orcamento) || 0);
  return {
    skus: total.skus,
    pecas: total.pecas,
    brl: r2(total.brl),
    moeda: arred(total).moeda,
    porFornecedor: [...fornecedores.values()].map(arred).sort((a, b) => b.brl - a.brl),
    porTipo: [...tipos.values()].map(arred).sort((a, b) => b.brl - a.brl),
    orcamento: orc,
    excesso: orc > 0 ? Math.max(0, r2(total.brl - orc)) : 0,
    semCusto,
  };
}

/* ------------------------------------------------- faixas de preço */

export interface ResumoFaixa {
  chave: string;
  nome: string;
  de: number | null; // acima de (exclusivo)
  ate: number | null; // até (inclusivo); nulo = sem limite
  skus: number;
  comprado: number;
  vendido: number;
  vendidoPeriodo: number;
  receita: number;
  /** Custo das peças vendidas no período. */
  custoVendido: number;
  sellThrough: number;
  /** (receita − custo das vendidas) ÷ receita. Nula sem receita. */
  margem: number | null;
  participacao: number;
  estoque: number;
}

const realInteiro = (v: number) => `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`;

/** Limites das faixas: números positivos, sem repetir, em ordem crescente (padrão 60, 120, 250). */
export function limitesFaixas(limites: unknown): number[] {
  const lista = Array.isArray(limites) ? limites : [];
  const ok = [...new Set(lista.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))].sort((a, b) => a - b);
  return ok.length ? ok : [60, 120, 250];
}

/** Faixas de preço de venda (até R$ 60, de R$ 60 a R$ 120, …, acima do último limite) e "sem preço". */
export function faixasDePreco(limites: number[]): { chave: string; nome: string; de: number | null; ate: number | null }[] {
  const l = limitesFaixas(limites);
  const faixas: { chave: string; nome: string; de: number | null; ate: number | null }[] = l.map((ate, i) => ({
    chave: `ate-${ate}`,
    nome: i === 0 ? `até ${realInteiro(ate)}` : `de ${realInteiro(l[i - 1])} a ${realInteiro(ate)}`,
    de: i === 0 ? null : l[i - 1],
    ate,
  }));
  faixas.push({ chave: `acima-${l[l.length - 1]}`, nome: `acima de ${realInteiro(l[l.length - 1])}`, de: l[l.length - 1], ate: null });
  return faixas;
}

/** Peças, vendidas, faturamento, sell-through e margem por faixa de preço de venda (preço de etiqueta da peça). */
export function resumoPorFaixa(skus: SkuAnalise[], limites: number[]): ResumoFaixa[] {
  const faixas = faixasDePreco(limites);
  const vazio = (f: { chave: string; nome: string; de: number | null; ate: number | null }): ResumoFaixa => ({
    ...f,
    skus: 0,
    comprado: 0,
    vendido: 0,
    vendidoPeriodo: 0,
    receita: 0,
    custoVendido: 0,
    sellThrough: 0,
    margem: null,
    participacao: 0,
    estoque: 0,
  });
  const linhas = faixas.map(vazio);
  const semPreco = vazio({ chave: "sem-preco", nome: "sem preço", de: null, ate: null });
  for (const s of skus) {
    const preco = s.precoVenda ?? 0;
    const alvo = preco > 0 ? (linhas.find((f) => f.ate == null || preco <= f.ate + 1e-9) ?? linhas[linhas.length - 1]) : semPreco;
    alvo.skus++;
    alvo.comprado += s.comprado;
    alvo.vendido += s.vendido;
    alvo.vendidoPeriodo += s.vendidoPeriodo;
    alvo.receita += s.receita;
    alvo.custoVendido += Math.max(0, s.vendidoPeriodo) * (s.custo ?? 0);
    alvo.estoque += s.estoque;
  }
  const todas = semPreco.skus ? [...linhas, semPreco] : linhas;
  const total = todas.reduce((s, f) => s + f.receita, 0);
  return todas.map((f) => ({
    ...f,
    vendido: r2(f.vendido),
    vendidoPeriodo: r2(f.vendidoPeriodo),
    receita: r2(f.receita),
    custoVendido: r2(f.custoVendido),
    estoque: r2(f.estoque),
    sellThrough: r4(sellThrough(f.vendido, f.comprado)),
    margem: f.receita > 0 ? r4((f.receita - f.custoVendido) / f.receita) : null,
    participacao: total ? r4(f.receita / total) : 0,
  }));
}

/* --------------------------------------------------- estoque × UP */

export interface DiferencaUp {
  chave: string;
  produtoId: string;
  codigoBarras: string;
  referencia: string | null;
  nome: string;
  imagemId: string | null;
  /** Esperado pelo app: o que entrou − vendidas. */
  esperado: number;
  saldoUp: number;
  /** Saldo do UP − esperado (positivo = o UP tem mais). */
  diferenca: number;
}

export interface ComparacaoEstoqueUp {
  comparados: number;
  iguais: number;
  itens: DiferencaUp[]; // só as diferenças, das maiores para as menores
  /** Peças do app (com código) que não aparecem no arquivo do UP. */
  semSaldo: number;
  /** Códigos do arquivo do UP que não acharam peça no app. */
  foraDoApp: number;
  somaEsperado: number;
  somaUp: number;
}

/**
 * Compara o estoque esperado pelo app (entrada − vendidas) com o saldo do UP, pelo código de barras
 * (também o Code128 curto e sem zeros à esquerda). Diferenças das maiores para as menores.
 */
export function compararEstoqueUp(skus: SkuAnalise[], saldos: Iterable<{ codigoBarras: string; saldo: number }>): ComparacaoEstoqueUp {
  const porCodigo = new Map<string, number>();
  for (const s of saldos) {
    const k = normalizarCodigo(s.codigoBarras);
    if (k) porCodigo.set(k, (porCodigo.get(k) ?? 0) + (Number(s.saldo) || 0));
  }
  const usados = new Set<string>();
  const itens: DiferencaUp[] = [];
  let comparados = 0;
  let iguais = 0;
  let semSaldo = 0;
  let somaEsperado = 0;
  let somaUp = 0;
  for (const s of skus) {
    if (!s.codigoBarras) continue;
    const k = normalizarCodigo(s.codigoBarras);
    const curto = codigoCurto(s.codigoBarras);
    const kCurto = curto ? normalizarCodigo(curto) : "";
    const achado = porCodigo.has(k) ? k : kCurto && porCodigo.has(kCurto) ? kCurto : null;
    if (!achado) {
      semSaldo++;
      continue;
    }
    if (usados.has(achado)) continue;
    usados.add(achado);
    comparados++;
    const saldoUp = porCodigo.get(achado)!;
    const esperado = s.estoque;
    somaEsperado += esperado;
    somaUp += saldoUp;
    const diferenca = r2(saldoUp - esperado);
    if (Math.abs(diferenca) < 1e-9) {
      iguais++;
      continue;
    }
    itens.push({ chave: s.chave, produtoId: s.produtoId, codigoBarras: s.codigoBarras, referencia: s.referencia, nome: s.nome, imagemId: s.imagemId, esperado, saldoUp, diferenca });
  }
  itens.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca) || a.nome.localeCompare(b.nome, "pt-BR"));
  return { comparados, iguais, itens, semSaldo, foraDoApp: [...porCodigo.keys()].filter((k) => !usados.has(k)).length, somaEsperado: r2(somaEsperado), somaUp: r2(somaUp) };
}

/* ------------------------------------------- estoque para o catálogo */

/**
 * Estoque de cada produto para o catálogo da Meta: o do SKU dele (as linhas da mesma chave dividem o mesmo número).
 * Com saldo do UP para o código, vale o saldo; senão o que entrou (pedidos que já chegaram) − vendidas.
 */
export function estoqueDoCatalogo(
  skus: SkuAnalise[],
  saldos: Iterable<{ codigoBarras: string; saldo: number }>,
  idx: IndiceProdutos,
): Map<string, { chave: string; estoque: number; fonte: "up" | "app" }> {
  const porCodigo = new Map<string, number>();
  for (const s of saldos) {
    const k = normalizarCodigo(s.codigoBarras);
    if (k) porCodigo.set(k, (porCodigo.get(k) ?? 0) + (Number(s.saldo) || 0));
  }
  const porChave = new Map(skus.map((s) => [s.chave, s]));
  const saldoDe = (codigo: string | null) => {
    if (!codigo) return undefined;
    const direto = porCodigo.get(normalizarCodigo(codigo));
    if (direto != null) return direto;
    const curto = codigoCurto(codigo);
    return curto ? porCodigo.get(normalizarCodigo(curto)) : undefined;
  };
  const out = new Map<string, { chave: string; estoque: number; fonte: "up" | "app" }>();
  for (const p of idx.ordenados) {
    const chave = chaveDoProduto(p, idx);
    const sku = porChave.get(chave);
    const saldo = saldoDe(sku?.codigoBarras ?? (chave.startsWith("id:") ? null : chave));
    out.set(p.id, saldo != null ? { chave, estoque: Math.max(0, Math.floor(saldo)), fonte: "up" } : { chave, estoque: Math.max(0, Math.floor(sku?.estoque ?? 0)), fonte: "app" });
  }
  return out;
}

/* ------------------------------------- resposta de /api/vendas/analise */

export type AnaliseCompleta = AnaliseVendas & {
  apelidosFornecedor: Record<string, string>;
  /** Faixas de preço de venda (Configurações → Vendas e recompra). */
  faixas: ResumoFaixa[];
  /** Estoque esperado pelo app × saldo do UP; nulo sem saldos importados. `atual` = falso num período passado. */
  estoqueUp: (ComparacaoEstoqueUp & { arquivo: string | null; atualizadoEm: string | null; atual: boolean }) | null;
  /** Totais da lista de recompra e o orçamento do mês. */
  recompra: TotaisRecompra;
  /** Quando o consignado mais novo foi importado (nulo sem consignado). */
  consignadoEm: string | null;
};
