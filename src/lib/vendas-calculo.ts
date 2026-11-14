/**
 * Retorno de vendas do UP Vendas: leitura da planilha exportada, ligação com os produtos do app
 * e análise de giro (sell-through, venda média, ponto de reposição, curva ABC).
 *
 * Funções puras (sem banco e sem "server-only"), testadas em tests/vendas.test.ts.
 */

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
 * Regras de detecção pelo nome da coluna (já normalizado: sem acento, minúsculo).
 * Pontuação maior vence; cada coluna vai para um campo só e cada campo recebe uma coluna só.
 */
const REGRAS: { campo: CampoVenda; testes: [RegExp, number][] }[] = [
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

function pontuar(cabecalho: string): { campo: CampoVenda; pontos: number }[] {
  const h = normalizarTexto(cabecalho);
  if (!h) return [];
  const out: { campo: CampoVenda; pontos: number }[] = [];
  for (const r of REGRAS) {
    const pontos = Math.max(0, ...r.testes.filter(([re]) => re.test(h)).map(([, p]) => p));
    if (pontos >= 3) out.push({ campo: r.campo, pontos });
  }
  return out;
}

/** Sugere o mapeamento pelos nomes das colunas (sem acento e sem maiúsculas). */
export function sugerirMapeamento(cabecalhos: string[]): Mapeamento {
  const pares: { coluna: number; campo: CampoVenda; pontos: number }[] = [];
  cabecalhos.forEach((c, coluna) => pontuar(c).forEach((p) => pares.push({ coluna, ...p })));
  pares.sort((a, b) => b.pontos - a.pontos || a.coluna - b.coluna);
  const mapa: Mapeamento = {};
  const usadas = new Set<number>();
  for (const p of pares) {
    if (usadas.has(p.coluna) || mapa[p.campo] !== undefined) continue;
    mapa[p.campo] = p.coluna;
    usadas.add(p.coluna);
  }
  return mapa;
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
 * sem nenhuma reconhecida, a primeira linha "cheia".
 */
export function acharLinhaCabecalho(linhas: unknown[][]): number {
  const primeiras = linhas.slice(0, 30);
  let melhor = -1;
  let melhorAcertos = 1;
  primeiras.forEach((l, i) => {
    const acertos = (l ?? []).filter((c) => typeof valorCelula(c) === "string" && pontuar(textoCelula(c)).some((p) => p.pontos >= 6)).length;
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
  quantidade: number;
  precoVenda: number | null;
  custoTotalBrl: number | null;
  imagemId: string | null;
  destaque: boolean;
  criadoEm: string;
  recompraDe: string | null;
  linha?: number | null;
  fornecedor: string | null; // do pedido
  dataPedido: string | null; // data de compra do pedido (AAAA-MM-DD)
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
}

/** Chave do SKU: o EAN (a recompra reaproveita o EAN do original); sem EAN, o próprio produto. */
export const chaveSku = (p: Pick<ProdutoBase, "id" | "codigoBarras">) => p.codigoBarras || `id:${p.id}`;

export function indexarProdutos(produtos: ProdutoBase[]): IndiceProdutos {
  // Original antes da recompra; depois a ordem de cadastro (primeira variação primeiro).
  const ordenados = [...produtos].sort(
    (a, b) =>
      (a.recompraDe ? 1 : 0) - (b.recompraDe ? 1 : 0) ||
      a.criadoEm.localeCompare(b.criadoEm) ||
      (a.linha ?? 0) - (b.linha ?? 0) ||
      a.id.localeCompare(b.id),
  );
  const idx: IndiceProdutos = { porEan: new Map(), porCurto: new Map(), porRef: new Map(), porId: new Map() };
  for (const p of ordenados) {
    idx.porId.set(p.id, p);
    if (p.codigoBarras) {
      if (!idx.porEan.has(p.codigoBarras)) idx.porEan.set(p.codigoBarras, p);
      // No UP pode estar o Code128 curto (os 8 dígitos da sequência do EAN "9100…").
      if (/^9100\d{9}$/.test(p.codigoBarras)) {
        const curto = p.codigoBarras.slice(4, 12);
        if (!idx.porCurto.has(curto)) idx.porCurto.set(curto, p);
      }
    }
    const ref = p.referencia?.trim().toUpperCase();
    if (ref && !idx.porRef.has(ref)) idx.porRef.set(ref, p);
  }
  return idx;
}

/**
 * Liga a venda ao produto: pelo código de barras e, se não houver, pela referência
 * (com várias variações na mesma referência, fica a primeira). Por último, o produto já gravado.
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
  const ref = v.referencia?.trim().toUpperCase();
  if (ref) {
    const p = idx.porRef.get(ref);
    if (p) return { produto: p, por: "referencia" };
  }
  if (v.produtoId) {
    const p = idx.porId.get(v.produtoId);
    if (p) return { produto: p, por: "id" };
  }
  return { produto: null, por: null };
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

/* ------------------------------------------------------------ análise */

export interface ParametrosAnalise {
  hoje: string; // AAAA-MM-DD
  inicio?: string | null;
  fim?: string | null;
  prazoReposicaoDias: number;
  diasEstoqueParado: number;
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
  imagemId: string | null;
  destaque: boolean;
  precoVenda: number | null;
  custo: number | null;
  dataEntrada: string;
  comprado: number;
  vendido: number; // até o fim do período (base do estoque e do sell-through)
  vendidoPeriodo: number;
  receita: number; // no período
  sellThrough: number;
  mediaDiaria: number;
  estoque: number;
  divergente: boolean; // vendeu mais do que o app registra como comprado
  pontoReposicao: number;
  quantidadeSugerida: number;
  primeiraVenda: string | null;
  ultimaVenda: string | null;
  diasSemVenda: number;
  status: StatusSku;
  curva: Curva;
  participacao: number;
  acumulado: number;
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
  parametros: { prazoReposicaoDias: number; diasEstoqueParado: number };
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
  };
  naoLigadas: { linhas: number; pecas: number; receita: number; exemplos: { codigo: string; descricao: string | null; pecas: number; receita: number }[] };
  abc: Record<Curva, { skus: number; receita: number; participacao: number }>;
  skus: SkuAnalise[];
  porTipo: ResumoGrupo[];
  porFornecedor: ResumoGrupo[];
  revendedoras: ResumoRevendedora[];
}

const dataDoProduto = (p: ProdutoBase) => p.dataPedido || p.criadoEm.slice(0, 10);

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
      receita: r2(g.receita),
      valorEstoque: r2(g.valorEstoque),
      participacao: total ? r4(g.receita / total) : 0,
      sellThrough: r4(sellThrough(g.vendido, g.comprado)),
    }))
    .sort((a, b) => b.receita - a.receita || b.vendido - a.vendido);
}

/**
 * Análise por SKU (agrupado pelo EAN). O estoque estimado e o sell-through usam todas as vendas até o fim
 * do período; receita, peças, curva ABC e rankings usam só as vendas dentro do período.
 */
export function analisarVendas(produtos: ProdutoBase[], vendas: VendaBase[], p: ParametrosAnalise): AnaliseVendas {
  const ate = p.fim || p.hoje;
  const inicio = p.inicio || null;
  const idx = indexarProdutos(produtos);

  type Grupo = { rep: ProdutoBase; produtos: ProdutoBase[]; vendido: number; vendidoPeriodo: number; receita: number; primeiraVenda: string | null; ultimaVenda: string | null; descricao: string | null };
  const grupos = new Map<string, Grupo>();
  for (const prod of produtos) {
    const chave = chaveSku(prod);
    let g = grupos.get(chave);
    if (!g) {
      const rep = (prod.codigoBarras && idx.porEan.get(prod.codigoBarras)) || prod;
      g = { rep, produtos: [], vendido: 0, vendidoPeriodo: 0, receita: 0, primeiraVenda: null, ultimaVenda: null, descricao: null };
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
    const g = produto ? grupos.get(chaveSku(produto)) : undefined;
    const receita = v.valorTotal ?? (produto?.precoVenda ?? 0) * v.quantidade;
    if (g) {
      g.vendido += v.quantidade;
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
    if (produto) {
      r.skus.add(chaveSku(produto));
      if (produto.tipo) r.tipos.set(produto.tipo, (r.tipos.get(produto.tipo) ?? 0) + v.quantidade);
    }
    if (v.quantidade > 0) {
      if (!r.primeiraVenda || v.data < r.primeiraVenda) r.primeiraVenda = v.data;
      if (!r.ultimaVenda || v.data > r.ultimaVenda) r.ultimaVenda = v.data;
    }
  }

  const base: Omit<SkuAnalise, "curva" | "participacao" | "acumulado">[] = [];
  for (const [chave, g] of grupos) {
    const entraram = g.produtos.filter((x) => dataDoProduto(x) <= ate);
    if (!entraram.length && !g.vendido) continue; // ainda não existia no fim do período
    const comprado = entraram.reduce((s, x) => s + (x.quantidade ?? 0), 0);
    let dataEntrada = g.produtos.map(dataDoProduto).sort()[0];
    if (g.primeiraVenda && g.primeiraVenda < dataEntrada) dataEntrada = g.primeiraVenda;
    const vendido = r2(g.vendido);
    const dias = Math.max(1, diasEntre(dataEntrada, ate));
    const mediaDiaria = Math.max(0, vendido) / dias;
    const estoqueBruto = comprado - vendido;
    const estoque = Math.max(0, r2(estoqueBruto));
    const ponto = pontoReposicao(mediaDiaria, p.prazoReposicaoDias);
    const diasSemVenda = Math.max(0, diasEntre(g.ultimaVenda ?? dataEntrada, ate));
    const status = statusReposicao({ comprado, vendido, estoque, ponto, diasSemVenda }, p.diasEstoqueParado);
    const rep = g.rep;
    base.push({
      chave,
      produtoId: rep.id,
      produtoIds: g.produtos.map((x) => x.id),
      codigoBarras: rep.codigoBarras,
      referencia: rep.referencia,
      codigoFornecedor: rep.codigoFornecedor,
      nome: rep.nome || rep.nomeComercial || g.descricao || rep.referencia || "Sem nome",
      tipo: rep.tipo,
      fornecedor: rep.fornecedor,
      imagemId: rep.imagemId ?? g.produtos.find((x) => x.imagemId)?.imagemId ?? null,
      destaque: g.produtos.some((x) => x.destaque),
      precoVenda: rep.precoVenda,
      custo: rep.custoTotalBrl,
      dataEntrada,
      comprado,
      vendido,
      vendidoPeriodo: r2(g.vendidoPeriodo),
      receita: r2(g.receita),
      sellThrough: r4(sellThrough(vendido, comprado)),
      mediaDiaria: r4(mediaDiaria),
      estoque,
      divergente: estoqueBruto < 0,
      pontoReposicao: r2(ponto),
      quantidadeSugerida: status === "repor" || status === "esgotado" ? (vendido > 0 ? quantidadeSugerida(mediaDiaria, p.prazoReposicaoDias, estoque) : 0) : 0,
      primeiraVenda: g.primeiraVenda,
      ultimaVenda: g.ultimaVenda,
      diasSemVenda,
      status,
    });
  }

  const skus = curvaAbc(base);
  const abc: AnaliseVendas["abc"] = { A: { skus: 0, receita: 0, participacao: 0 }, B: { skus: 0, receita: 0, participacao: 0 }, C: { skus: 0, receita: 0, participacao: 0 } };
  for (const s of skus) {
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
    parametros: { prazoReposicaoDias: p.prazoReposicaoDias, diasEstoqueParado: p.diasEstoqueParado },
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
    skus,
    porTipo: resumir(skus, (s) => s.tipo ?? ""),
    porFornecedor: resumir(skus, (s) => s.fornecedor?.trim() || ""),
    revendedoras: ranking,
  };
}
