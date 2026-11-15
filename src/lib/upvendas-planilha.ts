/**
 * Planilhas do UP Vendas (item 26 da revisão), separadas em duas:
 *  - "Produtos novos": cadastro completo (tela "Cadastro de Produtos Simplificado" do UP);
 *  - "Recompras": entrada de estoque de produtos que JÁ existem no UP (código de barras + quantidade).
 * A quantidade é sempre a que entrou na loja (estoqueEntrada: conferida − defeito; sem conferência, a pedida).
 *
 * Funções puras (sem banco e sem "server-only"): usadas na rota de exportação, no envio pela API e na tela
 * do UP; testadas em tests/operacao-upvendas.test.ts. Todo texto passa por textoSeguroPlanilha/celulaCsv.
 */
import type { Taxonomia, UpVendasConfig } from "./config";
import type { Produto } from "./db/schema";
import type { PoliticaPreco } from "./precos";
import { codigoParaUp } from "./upvendas-codigo";
import { estoqueEntrada } from "./estoque";
import { celulaCsv, textoSeguroPlanilha } from "./csv";

/** Campos do cadastro "Cadastro de Produtos Simplificado" do UP Vendas (mesma ordem da tela). */
export interface LinhaUp {
  nome: string;
  marca: string;
  referencia: string;
  codigoExterno: string;
  ncm: string;
  unidade: string;
  categoriaVitrine: string;
  custoCompraBruto: number;
  custoInsumo: number;
  milesimos: number;
  banhoOuro: number;
  banhoPrata: number;
  banhoRodio: number;
  banhoVerniz: number;
  custoTotal: number;
  tabelaPreco: string;
  percentualLucro: number;
  valorTabela: number;
  tabelaPreco2: string;
  percentualLucro2: number;
  valorTabela2: number;
  descricaoGrade: string;
  codigoBarras: string;
  estoque: number;
  ativo: boolean;
  acabado: boolean;
  compartilhar: boolean;
  sincronizarUpVendas: boolean;
  imagemUrl: string;
  // extras do app
  tipo: string;
  material: string;
  banho: string;
  corPedra: string;
  tamanho: string;
  nomeComercial: string;
  legenda: string;
}

export interface ContextoUp {
  tax: Taxonomia;
  pol: PoliticaPreco;
  up: UpVendasConfig;
  marca: string;
  codigoNoUp: "ean13" | "code128";
  origemCodigoBarras: "upvendas" | "app";
  urlBase: string; // para montar o link público da imagem
  fotos: Record<string, { id: string; publicavel: boolean }>; // foto criada pela IA e aprovada pela loja
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function linhaUp(p: Produto, ctx: ContextoUp): LinhaUp {
  const tipo = ctx.tax.tipos.find((t) => t.id === p.tipo);
  const material = ctx.tax.materiais.find((m) => m.id === p.material);
  const banho = ctx.tax.banhos.find((b) => b.id === p.banho);
  const custo = p.custoTotalBrl ?? 0;
  // Foto aprovada pela loja (fila de aprovação) tem prioridade; senão a foto principal.
  const fotoId = ctx.fotos[p.id]?.publicavel ? ctx.fotos[p.id].id : p.imagemId;
  const base = ctx.pol.tabelas_preco.find((t) => t.id === ctx.pol.tabela_base);
  const segunda = ctx.pol.tabelas_preco.find((t) => t.tabela_up_vendas && t.id !== ctx.pol.tabela_base);
  const valor2 = segunda ? (p.precos?.[segunda.id] ?? 0) : 0;
  let descricaoGrade = material?.descricao_grade ?? `${material?.nome ?? "SEMIJOIA"}`.toUpperCase();
  if (banho && !/BANHAD|FOLHEAD/.test(descricaoGrade) && banho.id !== "sem_banho") descricaoGrade += ` BANHADA A ${banho.nome.toUpperCase()}`;
  if (p.variacao) descricaoGrade += ` - ${p.variacao.toUpperCase()}`;
  return {
    nome: (p.nome ?? "").toUpperCase(),
    marca: ctx.marca,
    referencia: p.referencia ?? "",
    codigoExterno: p.codigoFornecedor ?? "",
    ncm: p.ncm ?? "",
    unidade: p.unidade,
    categoriaVitrine: [tipo?.categoria_vitrine ?? tipo?.nome, p.subtipo].filter(Boolean).join(" - "),
    custoCompraBruto: r2(p.custoProdutoBrl ?? 0),
    custoInsumo: r2(p.custoAdicionalBrl ?? 0),
    milesimos: 0,
    banhoOuro: 0,
    banhoPrata: 0,
    banhoRodio: 0,
    banhoVerniz: 0,
    custoTotal: r2(custo),
    tabelaPreco: base?.tabela_up_vendas ?? base?.nome ?? "CONSIGNADO",
    percentualLucro: custo > 0 ? r2(((p.precoVenda ?? 0) / custo - 1) * 100) : 0,
    valorTabela: p.precoVenda ?? 0,
    tabelaPreco2: segunda?.nome ?? "",
    percentualLucro2: custo > 0 && valor2 ? r2((valor2 / custo - 1) * 100) : 0,
    valorTabela2: valor2,
    descricaoGrade,
    codigoBarras: codigoParaUp(p, ctx),
    estoque: estoqueEntrada(p), // o que entrou na loja (conferência), não o que foi pedido
    ativo: true,
    acabado: true,
    compartilhar: true,
    sincronizarUpVendas: true,
    imagemUrl: fotoId ? `${ctx.urlBase}/api/imagens/${fotoId}` : "",
    tipo: tipo?.nome ?? p.tipo ?? "",
    material: material?.nome ?? p.material ?? "",
    banho: banho?.nome ?? p.banho ?? "",
    corPedra: (p.corPedra ?? []).map((c) => ctx.tax.cores_pedra.find((x) => x.id === c)?.nome ?? c).join(", "),
    tamanho: p.tamanho ?? "",
    nomeComercial: p.nomeComercial ?? "",
    legenda: p.legenda ?? "",
  };
}

/* ------------------------------------------------- produtos novos × recompras */

export type TipoPlanilhaUp = "novos" | "recompras";

/** Recompra = a peça é o mesmo produto de um pedido anterior (mesma referência e código no UP). */
export const ehRecompraUp = (p: { recompraDe?: string | null }) => p.recompraDe != null;

/** Tipo da planilha pedido na URL; sem tipo = produtos novos (mandar recompra no cadastro duplicaria o produto no UP). */
export const tipoPlanilhaUp = (v: string | null | undefined): TipoPlanilhaUp => (v === "recompras" ? "recompras" : "novos");

export function separarParaUp<T extends { recompraDe?: string | null }>(produtos: T[]): { novos: T[]; recompras: T[] } {
  const novos: T[] = [];
  const recompras: T[] = [];
  for (const p of produtos) (ehRecompraUp(p) ? recompras : novos).push(p);
  return { novos, recompras };
}

export interface LinhaRecompraUp {
  codigoBarras: string;
  quantidade: number;
  referencia: string;
  nome: string;
  custoUnitario: number;
}

/**
 * Linhas da planilha de recompras: uma por código de barras (linhas com o mesmo código somam a quantidade;
 * o custo é a média ponderada). Linha sem nenhuma peça que entrou fica de fora (não há entrada a fazer).
 * Sem o código do UP, a linha vai sem código (pela referência) e conta em `semCodigo` para a tela avisar.
 */
export function linhasRecompraUp(produtos: Produto[], ctx: Pick<ContextoUp, "codigoNoUp" | "origemCodigoBarras">) {
  const porChave = new Map<string, LinhaRecompraUp & { custoTotal: number }>();
  let semCodigo = 0;
  let semEntrada = 0;
  for (const p of produtos) {
    const qtd = estoqueEntrada(p);
    if (qtd <= 0) {
      semEntrada++;
      continue;
    }
    const codigo = codigoParaUp(p, ctx);
    if (!codigo) semCodigo++;
    const chave = codigo ? `c:${codigo}` : `r:${p.referencia ?? p.id}:${p.id}`;
    const atual = porChave.get(chave) ?? { codigoBarras: codigo, quantidade: 0, referencia: p.referencia ?? "", nome: (p.nome ?? "").toUpperCase(), custoUnitario: 0, custoTotal: 0 };
    atual.quantidade += qtd;
    atual.custoTotal += (p.custoTotalBrl ?? 0) * qtd;
    atual.custoUnitario = atual.quantidade > 0 ? r2(atual.custoTotal / atual.quantidade) : 0;
    porChave.set(chave, atual);
  }
  const linhas: LinhaRecompraUp[] = [...porChave.values()].map((l) => ({
    codigoBarras: l.codigoBarras,
    quantidade: l.quantidade,
    referencia: l.referencia,
    nome: l.nome,
    custoUnitario: l.custoUnitario,
  }));
  return { linhas, semCodigo, semEntrada };
}

/* -------------------------------------------------------------- colunas */

/** Colunas na ordem da tela "Cadastro de Produtos Simplificado" do UP Vendas + extras. */
export const COLUNAS_NOVOS: [keyof LinhaUp, string, number?][] = [
  ["nome", "Nome do produto", 46],
  ["marca", "Marca", 14],
  ["referencia", "Referência", 14],
  ["codigoExterno", "Código Externo", 16],
  ["ncm", "NCM", 11],
  ["unidade", "Un. estoque", 8],
  ["categoriaVitrine", "Categoria Vitrine", 28],
  ["custoCompraBruto", "Custo Compra Bruto", 12],
  ["custoInsumo", "Custo Insumo", 12],
  ["milesimos", "Milésimos", 9],
  ["banhoOuro", "Banho Ouro", 9],
  ["banhoPrata", "Banho Prata", 9],
  ["banhoRodio", "Banho Ródio", 9],
  ["banhoVerniz", "Banho Verniz", 9],
  ["custoTotal", "Custo Total", 11],
  ["tabelaPreco", "Tabela Preço 1", 14],
  ["percentualLucro", "% Lucro Tabela 1", 10],
  ["valorTabela", "Valor Tabela 1", 11],
  ["tabelaPreco2", "Tabela Preço 2", 16],
  ["percentualLucro2", "% Lucro Tabela 2", 10],
  ["valorTabela2", "Valor Tabela 2", 11],
  ["descricaoGrade", "Descrição (grade)", 36],
  ["codigoBarras", "Cód. Barras", 16],
  ["estoque", "Saldo Estoque", 8],
  ["ativo", "Ativo", 6],
  ["acabado", "Acabado", 7],
  ["compartilhar", "Compartilhar", 8],
  ["sincronizarUpVendas", "Sincronizar com a Up vendas?", 10],
  ["tipo", "Tipo", 12],
  ["material", "Material", 14],
  ["banho", "Banho", 14],
  ["corPedra", "Cor da pedra", 16],
  ["tamanho", "Tamanho", 10],
  ["nomeComercial", "Nome comercial", 26],
  ["legenda", "Legenda Instagram", 50],
  ["imagemUrl", "Imagem", 40],
];

/** Entrada de estoque: código de barras e quantidade primeiro; o resto é para conferir. */
export const COLUNAS_RECOMPRAS: [keyof LinhaRecompraUp, string, number?][] = [
  ["codigoBarras", "Cód. Barras", 18],
  ["quantidade", "Quantidade", 11],
  ["referencia", "Referência", 14],
  ["nome", "Nome do produto", 46],
  ["custoUnitario", "Custo unitário", 13],
];

/** CSV (separador ";", padrão brasileiro) com cabeçalho; cada célula passa por celulaCsv. */
export function montarCsv<T>(colunas: [keyof T, string, number?][], linhas: T[]): string {
  return [colunas.map((c) => celulaCsv(c[1])).join(";"), ...linhas.map((l) => colunas.map(([k]) => celulaCsv(l[k])).join(";"))].join("\r\n");
}

/** Valor de célula para o .xlsx: Sim/Não nos campos lógicos e texto protegido contra fórmula. */
export function valorCelulaXlsx(v: unknown): string | number {
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "number") return Number.isFinite(v) ? v : "";
  return textoSeguroPlanilha(String(v ?? ""));
}

/** Nome do arquivo baixado. */
export const nomeArquivoUp = (tipo: TipoPlanilhaUp, dia: string) => (tipo === "recompras" ? `fiodeamor-recompras-${dia}` : `fiodeamor-produtos-novos-${dia}`);
