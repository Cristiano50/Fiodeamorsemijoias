import "server-only";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { and, desc, eq, gte, inArray, lte, ne, or, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb, schema } from "./db";
import { getConfig } from "./config";
import { celulaCsv } from "./csv";
import { verificarLinhas, verificarTamanho, verificarXlsx } from "./planilha-segura";
import {
  CAMPOS_VENDA,
  acharLinhaCabecalho,
  analisarVendas,
  chaveDoProduto,
  compararEstoqueUp,
  converterLinhas,
  impressaoDigital,
  indexarProdutos,
  lerCsv,
  ligarVenda,
  limitesFaixas,
  linhaVazia,
  resumoPorFaixa,
  sugerirMapeamento,
  textoCelula,
  totaisRecompra,
  type AnaliseCompleta,
  type AnaliseVendas,
  type IndiceProdutos,
  type LinhaIgnorada,
  type Mapeamento,
  type ParametrosAnalise,
  type ProdutoBase,
  type SkuAnalise,
  type VendaBase,
} from "./vendas-calculo";
import { comRevendedorasPorSku, consignadoDaRevendedora, registrosEfetivos, type RegistroConsignado } from "./consignado-calculo";
import { sugerirMaleta, type PedidoMaleta } from "./maleta-calculo";
import { apelidoDe, apelidosFornecedores, chaveFornecedor, lotesMinimosFornecedores } from "./fornecedores";

/**
 * Vendas do UP Vendas (servidor): leitura da planilha exportada, gravação em lotes, análise e maleta.
 * O UP não tem API pública; quando tiver, basta gravar na mesma tabela "vendas" (origem = "api").
 * Pedidos com status "importando" (importação incompleta) ficam fora de tudo daqui.
 */

/** Hoje no fuso da loja (AAAA-MM-DD). */
export const hojeLocal = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export const dataValida = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

/* ------------------------------------------------------------ planilha */

interface Planilha {
  cabecalhos: string[];
  linhas: unknown[][]; // linhas depois do cabeçalho
  linhaCabecalho: number; // número da linha do cabeçalho na planilha (1 = primeira)
}

function decodificarTexto(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf); // Excel antigo salva CSV em Latin-1
  }
}

async function lerXlsx(buf: Buffer): Promise<unknown[][]> {
  verificarXlsx(buf); // zip-bomb, senha, arquivo corrompido: para antes do exceljs
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  for (const f of wb.worksheets) verificarLinhas(f.actualRowCount); // linhas com valor (formatação vazia não conta)
  const folha = [...wb.worksheets].sort((a, b) => b.actualRowCount - a.actualRowCount)[0];
  if (!folha) return [];
  const linhas: unknown[][] = [];
  folha.eachRow({ includeEmpty: true }, (row, n) => {
    const valores: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cel, c) => {
      valores[c - 1] = cel.value;
    });
    linhas[n - 1] = Array.from(valores);
  });
  return Array.from(linhas, (l) => l ?? []);
}

/**
 * Lê a planilha (XLSX ou CSV) e acha o cabeçalho. `pontuarColuna`: regras de outro relatório do UP
 * (padrão: o de vendas). Lança PlanilhaInvalida (mensagem pronta para a tela) quando o arquivo não é seguro.
 */
export async function lerPlanilha(arquivo: File, opcoes: { pontuarColuna?: (cabecalho: string) => number; relatorio?: string } = {}): Promise<Planilha> {
  verificarTamanho(arquivo.size);
  const buf = Buffer.from(await arquivo.arrayBuffer());
  if (!buf.length) throw new Error("O arquivo está vazio.");
  let todas: unknown[][];
  if (buf[0] === 0x50 && buf[1] === 0x4b) todas = await lerXlsx(buf);
  else if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new Error("Planilha .xls (formato antigo do Excel). Abra no Excel e salve como .xlsx ou CSV.");
  else {
    todas = lerCsv(decodificarTexto(buf));
    verificarLinhas(todas.length);
  }
  const h = acharLinhaCabecalho(todas, opcoes.pontuarColuna);
  if (h < 0) throw new Error(`Não encontrei a linha de cabeçalho na planilha. Confira se é a exportação ${opcoes.relatorio ?? "de vendas"} do UP.`);
  const linhas = todas.slice(h + 1);
  let largura = todas[h].length;
  for (const l of linhas) largura = Math.max(largura, l.length);
  const cabecalhos = Array.from({ length: largura }, (_, i) => textoCelula(todas[h][i]) || `Coluna ${i + 1}`);
  return { cabecalhos, linhas, linhaCabecalho: h + 1 };
}

/** Passo 1: cabeçalhos, mapeamento sugerido e 10 linhas de amostra. */
export async function previaVendas(arquivo: File) {
  const p = await lerPlanilha(arquivo);
  const dados = p.linhas.filter((l) => !linhaVazia(l));
  return {
    arquivoNome: arquivo.name,
    cabecalhos: p.cabecalhos,
    mapeamento: sugerirMapeamento(p.cabecalhos),
    amostra: dados.slice(0, 10).map((l) => p.cabecalhos.map((_, i) => textoCelula(l[i]))),
    totalLinhas: dados.length,
    linhaCabecalho: p.linhaCabecalho,
    campos: CAMPOS_VENDA,
  };
}

/* ------------------------------------------------------------ produtos */

/** Produtos com os dados do pedido (fornecedor, compra, chegada, conferência). Sem os de pedidos "importando". */
export async function carregarProdutos(): Promise<ProdutoBase[]> {
  const db = await getDb();
  const p = schema.produtos;
  const pe = schema.pedidos;
  return db
    .select({
      id: p.id,
      codigoBarras: p.codigoBarras,
      referencia: p.referencia,
      codigoFornecedor: p.codigoFornecedor,
      nome: p.nome,
      nomeComercial: p.nomeComercial,
      tipo: p.tipo,
      quantidade: p.quantidade,
      precoVenda: p.precoVenda,
      custoTotalBrl: p.custoTotalBrl,
      imagemId: p.imagemId,
      destaque: p.destaque,
      criadoEm: p.criadoEm,
      recompraDe: p.recompraDe,
      linha: p.linha,
      fornecedor: pe.fornecedor,
      dataPedido: pe.dataCompra,
      pedidoId: p.pedidoId,
      numeroPedido: pe.numero,
      dataChegada: pe.dataChegada,
      recebimento: pe.recebimento,
      conferidoEm: pe.conferidoEm,
      quantidadeRecebida: p.quantidadeRecebida,
      quantidadeDefeito: p.quantidadeDefeito,
      codigoBarrasOrigem: p.codigoBarrasOrigem,
      upStatus: p.upStatus,
      precoOrigem: p.precoOrigem,
      moeda: p.moeda,
    })
    .from(p)
    .leftJoin(pe, eq(p.pedidoId, pe.id))
    .where(or(isNull(pe.status), ne(pe.status, "importando")));
}

export async function carregarVendas(ate?: string | null): Promise<VendaBase[]> {
  const db = await getDb();
  const v = schema.vendas;
  return db
    .select({
      data: v.data,
      referencia: v.referencia,
      codigoBarras: v.codigoBarras,
      produtoId: v.produtoId,
      descricao: v.descricao,
      quantidade: v.quantidade,
      valorTotal: v.valorTotal,
      revendedora: v.revendedora,
      canal: v.canal,
    })
    .from(v)
    .where(ate ? lte(v.data, ate) : undefined);
}

/** Saldos de estoque do UP (lista de produtos importada em UP Vendas → códigos). */
export async function carregarSaldosUp() {
  const db = await getDb();
  const s = schema.saldosUp;
  return db.select({ codigoBarras: s.codigoBarras, saldo: s.saldo, arquivo: s.arquivo, atualizadoEm: s.atualizadoEm }).from(s);
}

/** Consignado do UP: para cada revendedora + data + peça, só o que veio no lote mais novo. */
export async function carregarConsignado(): Promise<(RegistroConsignado & { id: string })[]> {
  const db = await getDb();
  const c = schema.consignado;
  const l = schema.lotesConsignado;
  const linhas = await db
    .select({
      id: c.id,
      loteId: c.loteId,
      loteEm: l.criadoEm,
      data: c.data,
      revendedora: c.revendedora,
      codigoBarras: c.codigoBarras,
      referencia: c.referencia,
      produtoId: c.produtoId,
      descricao: c.descricao,
      quantidade: c.quantidade,
      situacao: c.situacao,
    })
    .from(c)
    .innerJoin(l, eq(c.loteId, l.id));
  return registrosEfetivos(linhas);
}

/* ------------------------------------------------------------ importação */

export interface OpcoesImportacao {
  dataPadrao?: string | null; // para linhas sem data (relatórios agregados por período)
  ignorarDuplicadas?: boolean; // padrão: sim
}

/** Passo 2: grava as vendas com o mapeamento escolhido, em um lote que pode ser desfeito. */
export async function importarVendas(arquivo: File, mapeamento: Mapeamento, opcoes: OpcoesImportacao = {}) {
  const tem = (c: keyof Mapeamento) => mapeamento[c] != null && mapeamento[c]! >= 0;
  if (!tem("referencia") && !tem("codigoBarras")) throw new Error("Indique a coluna da referência ou a do código de barras.");
  const dataPadrao = dataValida(opcoes.dataPadrao);
  if (!tem("data") && !dataPadrao) throw new Error("Indique a coluna da data da venda (ou uma data para as linhas sem data).");

  const p = await lerPlanilha(arquivo);
  const { vendas: lidas, ignoradas } = converterLinhas(p.linhas, mapeamento, { primeiraLinha: p.linhaCabecalho + 1, dataPadrao });
  if (!lidas.length) {
    const motivos = resumirMotivos(ignoradas);
    throw new Error(`Nenhuma linha válida. ${Object.entries(motivos).map(([m, n]) => `${n}× ${m}`).join("; ") || "A planilha não tem dados."}`);
  }

  const db = await getDb();
  const idx = indexarProdutos(await carregarProdutos());
  const datas = lidas.map((v) => v.data).sort();

  // Linhas já gravadas no mesmo período (reimportação ou exportações que se sobrepõem): conta por "impressão digital".
  const jaGravadas = new Map<string, number>();
  if (opcoes.ignorarDuplicadas !== false) {
    const existentes = await db
      .select({ data: schema.vendas.data, referencia: schema.vendas.referencia, codigoBarras: schema.vendas.codigoBarras, quantidade: schema.vendas.quantidade, valorTotal: schema.vendas.valorTotal, revendedora: schema.vendas.revendedora })
      .from(schema.vendas)
      .where(and(gte(schema.vendas.data, datas[0]), lte(schema.vendas.data, datas[datas.length - 1])));
    for (const e of existentes) {
      const k = impressaoDigital(e);
      jaGravadas.set(k, (jaGravadas.get(k) ?? 0) + 1);
    }
  }

  const loteId = randomUUID();
  const registros: (typeof schema.vendas.$inferInsert)[] = [];
  let ligadas = 0;
  for (const v of lidas) {
    const k = impressaoDigital(v);
    const n = jaGravadas.get(k) ?? 0;
    if (n > 0) {
      jaGravadas.set(k, n - 1);
      ignoradas.push({ linha: v.linha, motivo: "já importada antes" });
      continue;
    }
    const { produto } = ligarVenda({ codigoBarras: v.codigoBarras, referencia: v.referencia, produtoId: null }, idx);
    if (produto) ligadas++;
    registros.push({
      id: randomUUID(),
      loteId,
      data: v.data,
      referencia: v.referencia,
      codigoBarras: v.codigoBarras,
      produtoId: produto?.id ?? null,
      descricao: v.descricao,
      quantidade: v.quantidade,
      valorTotal: v.valorTotal,
      revendedora: v.revendedora?.replace(/\s+/g, " ").trim() || null,
      canal: v.canal,
      origem: "planilha",
    });
  }

  ignoradas.sort((a, b) => a.linha - b.linha);
  const resultado = {
    loteId: null as string | null,
    arquivoNome: arquivo.name,
    linhas: registros.length,
    ligadas,
    naoLigadas: registros.length - ligadas,
    periodoInicio: null as string | null,
    periodoFim: null as string | null,
    totalIgnoradas: ignoradas.length,
    motivos: resumirMotivos(ignoradas),
    ignoradas: ignoradas.slice(0, 500),
  };
  if (!registros.length) return resultado;

  const periodo = registros.map((r) => r.data!).sort();
  resultado.loteId = loteId;
  resultado.periodoInicio = periodo[0];
  resultado.periodoFim = periodo[periodo.length - 1];

  // Tudo ou nada: o lote e as vendas vão no mesmo batch. 75 linhas × 13 colunas < 999 variáveis do SQLite.
  const consultas: BatchItem<"sqlite">[] = [
    db.insert(schema.lotesVendas).values({ id: loteId, arquivoNome: arquivo.name, linhas: registros.length, ligadas, periodoInicio: resultado.periodoInicio, periodoFim: resultado.periodoFim }),
  ];
  for (let i = 0; i < registros.length; i += 75) consultas.push(db.insert(schema.vendas).values(registros.slice(i, i + 75)));
  await db.batch(consultas as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return resultado;
}

export function resumirMotivos(ignoradas: LinhaIgnorada[]) {
  const m: Record<string, number> = {};
  for (const i of ignoradas) {
    const chave = i.motivo.replace(/\s*\(".*"\)$/, "");
    m[chave] = (m[chave] ?? 0) + 1;
  }
  return m;
}

/* ------------------------------------------------------------ lotes */

export async function listarLotes() {
  const db = await getDb();
  const l = schema.lotesVendas;
  return db
    .select({
      id: l.id,
      arquivoNome: l.arquivoNome,
      linhas: l.linhas,
      ligadas: l.ligadas,
      periodoInicio: l.periodoInicio,
      periodoFim: l.periodoFim,
      criadoEm: l.criadoEm,
      pecas: sql<number>`(select coalesce(sum(v.quantidade), 0) from vendas v where v.lote_id = lotes_vendas.id)`,
      receita: sql<number>`(select coalesce(sum(v.valor_total), 0) from vendas v where v.lote_id = lotes_vendas.id)`,
    })
    .from(l)
    .orderBy(desc(l.criadoEm));
}

/** Desfaz um lote: apaga as vendas dele e o próprio lote. */
export async function excluirLote(id: string) {
  const db = await getDb();
  const [lote] = await db.select().from(schema.lotesVendas).where(eq(schema.lotesVendas.id, id));
  if (!lote) return null;
  await db.batch([db.delete(schema.vendas).where(eq(schema.vendas.loteId, id)), db.delete(schema.lotesVendas).where(eq(schema.lotesVendas.id, id))]);
  return lote;
}

/* ------------------------------------------------------------ análise */

/** Chave do SKU de uma venda ou linha de consignado (ligação: código de barras → produto gravado → referência). */
export const chaveDaLinha = (idx: IndiceProdutos) => (r: Pick<VendaBase, "codigoBarras" | "referencia" | "produtoId">) => {
  const { produto } = ligarVenda(r, idx);
  return produto ? chaveDoProduto(produto, idx) : null;
};

/** Tudo o que a análise precisa, de uma vez: produtos, vendas, configuração, saldos do UP e consignado. */
export async function contextoAnalise(fim?: string | null) {
  const hoje = hojeLocal();
  const [produtos, vendas, sistema, apelidos, lotes, saldos, consignado] = await Promise.all([
    carregarProdutos(),
    carregarVendas(fim),
    getConfig("sistema"),
    apelidosFornecedores(),
    lotesMinimosFornecedores(),
    carregarSaldosUp(),
    carregarConsignado(),
  ]);
  const idx = indexarProdutos(produtos);
  const chaveDe = chaveDaLinha(idx);
  const comRevendedoras = comRevendedorasPorSku(consignado, chaveDe);
  const codigosUp = [...saldos.map((s) => s.codigoBarras), ...consignado.map((c) => c.codigoBarras ?? "")].filter(Boolean);
  const teto = Math.max(0, Math.floor(Number(sistema.maletasAtivas) || 0)) + Math.max(0, Math.floor(Number(sistema.reservaVitrine) || 0));
  const params: Omit<ParametrosAnalise, "inicio" | "fim"> = {
    hoje,
    prazoReposicaoDias: Number(sistema.prazoReposicaoDias) || 45,
    diasEstoqueParado: Number(sistema.diasEstoqueParado) || 120,
    diasForaDaCurva: Math.max(0, Math.floor(Number(sistema.diasForaDaCurva) || 0)),
    codigosUp,
    comRevendedoras,
    recompra: {
      tetoPorModelo: teto,
      loteMinimoPadrao: Math.max(1, Math.floor(Number(sistema.loteMinimoPadrao) || 1)),
      loteDoFornecedor: (nome) => (nome ? lotes.get(chaveFornecedor(nome)) : undefined),
    },
  };
  return { hoje, produtos, vendas, sistema, apelidos, saldos, consignado, idx, chaveDe, params };
}

export async function analiseVendas(periodo: { inicio?: string | null; fim?: string | null } = {}): Promise<AnaliseCompleta> {
  const inicio = dataValida(periodo.inicio);
  const fim = dataValida(periodo.fim);
  const ctx = await contextoAnalise(fim);
  const analise = analisarVendas(ctx.produtos, ctx.vendas, { ...ctx.params, inicio, fim });
  // Apelido de cada fornecedor (nome original → apelido), só para exibição; a análise agrupa pelo nome original.
  const apelidosFornecedor: Record<string, string> = {};
  for (const p of ctx.produtos) {
    const nome = p.fornecedor?.trim();
    const apelido = apelidoDe(ctx.apelidos, nome);
    if (nome && apelido) apelidosFornecedor[nome] = apelido;
  }
  for (const s of analise.skus) s.fornecedorApelido = s.fornecedor ? (apelidosFornecedor[s.fornecedor.trim()] ?? null) : null;

  let estoqueUp: AnaliseCompleta["estoqueUp"] = null;
  if (ctx.saldos.length) {
    const maisNovo = [...ctx.saldos].sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm))[0];
    estoqueUp = {
      ...compararEstoqueUp(analise.skus, ctx.saldos),
      arquivo: maisNovo.arquivo,
      atualizadoEm: maisNovo.atualizadoEm,
      atual: !fim || fim >= ctx.hoje, // o saldo do UP é de agora: comparar com um período passado não faz sentido
    };
  }
  const consignadoEm = ctx.consignado.reduce<string | null>((m, c) => (!m || c.loteEm > m ? c.loteEm : m), null);
  return {
    ...analise,
    apelidosFornecedor,
    faixas: resumoPorFaixa(analise.skus, limitesFaixas(ctx.sistema.faixasPrecoVenda)),
    estoqueUp,
    recompra: totaisRecompra(itensRecompra(analise), Number(ctx.sistema.orcamentoMensalRecompra) || 0),
    consignadoEm,
  };
}

/* ------------------------------------------------------ lista de recompra */

const COLUNAS_RECOMPRA = [
  { chave: "foto", titulo: "Foto (图片)", largura: 13 },
  { chave: "fornecedor", titulo: "Fornecedor", largura: 18 },
  { chave: "codigoFornecedor", titulo: "Código do fornecedor (货号)", largura: 18 },
  { chave: "referencia", titulo: "Referência", largura: 14 },
  { chave: "codigoBarras", titulo: "EAN", largura: 16 },
  { chave: "nome", titulo: "Descrição", largura: 38 },
  { chave: "vendido", titulo: "Vendido", largura: 9 },
  { chave: "estoque", titulo: "Estoque", largura: 9 },
  { chave: "sugerida", titulo: "Qtd. sugerida (数量)", largura: 13 },
  { chave: "link", titulo: "Link da foto", largura: 22 },
] as const;

const ordemCurva = (c: SkuAnalise["curva"]) => (c ? c : "Z");

/**
 * Itens a recomprar: status "repor" ou "esgotado" com quantidade depois dos freios, agrupados por fornecedor.
 * A coluna "Fornecedor" leva o nome original (em chinês, como ele se reconhece); a aba usa o apelido da loja, se houver.
 */
export function itensRecompra(analise: Pick<AnaliseVendas, "skus">): SkuAnalise[] {
  return analise.skus
    .filter((s) => (s.status === "repor" || s.status === "esgotado") && s.quantidadeSugerida > 0)
    .sort((a, b) => (a.fornecedor ?? "~").localeCompare(b.fornecedor ?? "~", "pt-BR") || ordemCurva(a.curva).localeCompare(ordemCurva(b.curva)) || b.quantidadeSugerida - a.quantidadeSugerida);
}

const nomeFornecedor = (s: SkuAnalise) => s.fornecedor?.trim() || "Sem fornecedor";

export function csvRecompra(itens: SkuAnalise[], origem: string): string {
  const linhas: string[][] = [COLUNAS_RECOMPRA.filter((c) => c.chave !== "foto").map((c) => celulaCsv(c.titulo))];
  for (const s of itens) {
    linhas.push(
      [nomeFornecedor(s), s.codigoFornecedor ?? "", s.referencia ?? "", s.codigoBarras ?? "", s.nome, s.vendido, s.estoque, s.quantidadeSugerida, s.imagemId ? `${origem}/api/imagens/${s.imagemId}` : ""].map((v) =>
        celulaCsv(v),
      ),
    );
  }
  return "﻿" + linhas.map((l) => l.join(";")).join("\r\n");
}

/** XLSX com uma aba por fornecedor e a miniatura da foto na primeira coluna (para mandar à China). */
export async function xlsxRecompra(itens: SkuAnalise[], origem: string, apelidos: Record<string, string> = {}): Promise<Uint8Array<ArrayBuffer>> {
  const db = await getDb();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Fio de Amor Semijoias";
  const idsFoto = [...new Set(itens.map((s) => s.imagemId).filter((x): x is string => !!x))].slice(0, 500);
  const fotos = new Map<string, Buffer>();
  for (let i = 0; i < idsFoto.length; i += 50) {
    const lote = await db.select({ id: schema.imagens.id, dados: schema.imagens.dados }).from(schema.imagens).where(inArray(schema.imagens.id, idsFoto.slice(i, i + 50)));
    for (const f of lote) {
      try {
        fotos.set(f.id, await sharp(f.dados).resize({ width: 160, height: 160, fit: "inside" }).jpeg({ quality: 78 }).toBuffer());
      } catch {
        /* foto ilegível: fica só o link */
      }
    }
  }

  const grupos = new Map<string, SkuAnalise[]>();
  for (const s of itens) grupos.set(nomeFornecedor(s), [...(grupos.get(nomeFornecedor(s)) ?? []), s]);
  if (!grupos.size) grupos.set("Recompra", []);
  const usados = new Set<string>();
  for (const [fornecedor, lista] of grupos) {
    let nomeAba = (apelidos[fornecedor] ?? fornecedor).replace(/[[\]:*?/\\]/g, " ").slice(0, 28).trim() || "Fornecedor";
    for (let n = 2; usados.has(nomeAba.toLowerCase()); n++) nomeAba = `${nomeAba.slice(0, 26)} ${n}`;
    usados.add(nomeAba.toLowerCase());
    const ws = wb.addWorksheet(nomeAba, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = COLUNAS_RECOMPRA.map((c) => ({ header: c.titulo, key: c.chave, width: c.largura }));
    const cab = ws.getRow(1);
    cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB07A90" } };
    cab.alignment = { vertical: "middle", wrapText: true };
    cab.height = 30;
    ws.getColumn("codigoBarras").numFmt = "@";
    for (const s of lista) {
      const url = s.imagemId ? `${origem}/api/imagens/${s.imagemId}` : "";
      const row = ws.addRow({
        fornecedor,
        codigoFornecedor: s.codigoFornecedor ?? "",
        referencia: s.referencia ?? "",
        codigoBarras: s.codigoBarras ?? "",
        nome: s.nome,
        vendido: s.vendido,
        estoque: s.estoque,
        sugerida: s.quantidadeSugerida,
        link: url ? { text: "abrir foto", hyperlink: url } : "",
      });
      row.alignment = { vertical: "middle", wrapText: true };
      row.getCell("sugerida").font = { bold: true };
      const foto = s.imagemId ? fotos.get(s.imagemId) : undefined;
      if (foto) {
        row.height = 64;
        const imagem = wb.addImage({ buffer: foto as unknown as ExcelJS.Image["buffer"], extension: "jpeg" });
        ws.addImage(imagem, { tl: { col: 0.1, row: row.number - 1 + 0.05 }, ext: { width: 80, height: 80 }, editAs: "oneCell" });
      }
    }
    const total = ws.addRow({ nome: "Total", sugerida: lista.reduce((t, s) => t + s.quantidadeSugerida, 0) });
    total.font = { bold: true };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

/* ------------------------------------------------------------ maleta */

/** Revendedoras do histórico (todas as vendas até hoje), da que mais vende para a que menos vende. */
export async function revendedorasDoHistorico() {
  const analise = await analiseVendas();
  return {
    temVendas: analise.temVendas,
    revendedoras: analise.revendedoras.filter((r) => r.chave).map((r) => ({ nome: r.nome, pecas: r.pecas, receita: r.receita, ultimaVenda: r.ultimaVenda, tipoFavorito: r.tipoFavorito })),
  };
}

/**
 * Maleta sugerida: só peças que já chegaram, que o UP conhece e que estão disponíveis
 * (estoque − o que está com as revendedoras); nunca o que ela tem agora ou já devolveu.
 * `valorAlvo` é teto; vazio = sem teto (a maleta fecha pelas peças-alvo).
 */
export async function montarMaleta(pedido: Partial<PedidoMaleta>) {
  const [ctx, tax] = await Promise.all([contextoAnalise(null), getConfig("taxonomia")]);
  const analise = analisarVendas(ctx.produtos, ctx.vendas, ctx.params);
  const ligadas = ctx.vendas.map((v) => ({ chave: ctx.chaveDe(v), revendedora: v.revendedora, quantidade: v.quantidade, valorTotal: v.valorTotal }));
  const teto = Number(pedido.valorAlvo) > 0 ? Number(pedido.valorAlvo) : 0;
  const pecasAlvo = Number(pedido.pecasAlvo) > 0 ? Math.floor(Number(pedido.pecasAlvo)) : Math.floor(Number(ctx.sistema.maletaPecasAlvo)) || 85;
  const consignado = consignadoDaRevendedora(ctx.consignado, pedido.revendedora, ctx.chaveDe);
  const resultado = sugerirMaleta(
    analise.skus,
    ligadas,
    { revendedora: pedido.revendedora ?? null, valorAlvo: teto, pecasAlvo, tiposExcluidos: Array.isArray(pedido.tiposExcluidos) ? pedido.tiposExcluidos.map(String) : [] },
    { hoje: ctx.hoje, nomesTipo: Object.fromEntries(tax.tipos.map((t) => [t.id, t.nome])), consignado },
  );
  if (analise.aCaminho.pecas > 0)
    resultado.avisos.push(`${analise.aCaminho.pecas.toLocaleString("pt-BR")} peça(s) de pedidos que ainda não chegaram ficaram de fora (entram quando o pedido for marcado como recebido).`);
  return {
    ...resultado,
    valorAlvo: teto || null,
    pecasAlvo,
    temVendas: analise.temVendas,
    temConsignado: ctx.consignado.length > 0,
    geradoEm: ctx.hoje,
  };
}
