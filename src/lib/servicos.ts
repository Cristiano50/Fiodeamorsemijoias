import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getCenarios, getComponentesCusto, getConfig, ncmPara } from "./config";
import { calcularCustos, calcularPreco, detalharCustos, valoresDoCenario } from "./precos";
import { chaveSequenciaReferencia, montarEan13, montarReferencia } from "./codigos";
import type { ItemAnalisado } from "./ai/claude";
import type { Produto } from "./db/schema";

export const novoId = () => randomUUID();

/* ------------------------------------------------------------- sequências */

export async function proximaSequencia(nome: string): Promise<number> {
  const db = await getDb();
  const [linha] = await db
    .insert(schema.sequencias)
    .values({ nome, valor: 1 })
    .onConflictDoUpdate({ target: schema.sequencias.nome, set: { valor: sql`${schema.sequencias.valor} + 1` } })
    .returning();
  return linha.valor;
}

/* ---------------------------------------------------------------- imagens */

/** Normaliza qualquer imagem recebida para JPEG (máx. 1600px) e grava no banco. */
export async function salvarImagem(opts: {
  dados: Buffer;
  origem: "catalogo" | "pagina" | "arte" | "ia" | "upload" | "referencia";
  produtoId?: string | null;
  pedidoId?: string | null;
  manterPng?: boolean;
  meta?: Record<string, unknown>;
}): Promise<string> {
  const db = await getDb();
  const img = sharp(opts.dados, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const redim = img.resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true });
  const dados = opts.manterPng ? await redim.png().toBuffer() : await redim.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const final = await sharp(dados).metadata();
  const id = novoId();
  await db.insert(schema.imagens).values({
    id,
    produtoId: opts.produtoId ?? null,
    pedidoId: opts.pedidoId ?? null,
    origem: opts.origem,
    mime: opts.manterPng ? "image/png" : "image/jpeg",
    largura: final.width ?? meta.width,
    altura: final.height ?? meta.height,
    dados,
    meta: opts.meta,
  });
  return id;
}

export async function lerImagem(id: string) {
  const db = await getDb();
  const [img] = await db.select().from(schema.imagens).where(eq(schema.imagens.id, id));
  return img ?? null;
}

/** JPEG reduzido em base64, para enviar à IA. */
export async function imagemParaIa(id: string, lado = 768): Promise<string | undefined> {
  const img = await lerImagem(id);
  if (!img) return undefined;
  const buf = await sharp(img.dados).resize({ width: lado, height: lado, fit: "inside" }).jpeg({ quality: 82 }).toBuffer();
  return buf.toString("base64");
}

/** Recorta uma região (coordenadas 0–1000) de uma imagem salva. */
export async function recortarImagem(id: string, caixa: number[]): Promise<Buffer | null> {
  const img = await lerImagem(id);
  if (!img || caixa.length !== 4) return null;
  const { width = 0, height = 0 } = await sharp(img.dados).metadata();
  const [x0, y0, x1, y1] = caixa.map((v) => Math.min(1000, Math.max(0, v)) / 1000);
  const margem = 0.02;
  const left = Math.max(0, Math.floor((Math.min(x0, x1) - margem) * width));
  const top = Math.max(0, Math.floor((Math.min(y0, y1) - margem) * height));
  const w = Math.min(width - left, Math.ceil((Math.abs(x1 - x0) + 2 * margem) * width));
  const h = Math.min(height - top, Math.ceil((Math.abs(y1 - y0) + 2 * margem) * height));
  if (w < 10 || h < 10) return null;
  return sharp(img.dados).extract({ left, top, width: w, height: h }).jpeg({ quality: 90 }).toBuffer();
}

/* ------------------------------------------------- aplicar análise da IA */

export async function aplicarAnalise(produtoId: string, a: ItemAnalisado, sobrescreverNumeros: boolean) {
  const db = await getDb();
  const [atual] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, produtoId));
  if (!atual) return;
  await db
    .update(schema.produtos)
    .set({
      codigoFornecedor: atual.codigoFornecedor || a.codigo_fornecedor || null,
      descricaoOriginal: atual.descricaoOriginal || a.descricao_original || null,
      traducao: a.traducao_pt,
      precoOrigem: sobrescreverNumeros || atual.precoOrigem == null ? (a.preco_unitario ?? atual.precoOrigem) : atual.precoOrigem,
      quantidade: sobrescreverNumeros || !atual.quantidade ? (a.quantidade ?? atual.quantidade) : atual.quantidade,
      tipo: a.tipo,
      subtipo: a.subtipo,
      material: a.material,
      banho: a.banho,
      corPedra: a.cor_pedra,
      tamanho: a.tamanho,
      variacao: a.variacao || null,
      ehConjunto: a.eh_conjunto,
      componentes: a.componentes,
      estilo: a.estilo,
      avaliacao: a.avaliacao,
      nomesSugeridos: a.nomes,
      nome: atual.nome || a.nomes[0] || null,
      nomeComercial: a.nome_comercial,
      legenda: a.legenda,
      hashtags: a.hashtags,
      destaque: a.destaque,
      confianca: a.confianca,
      alertas: a.alertas,
      status: "revisado",
      atualizadoEm: new Date().toISOString(),
    })
    .where(eq(schema.produtos.id, produtoId));
}

/* ------------------------------------------- recalcular custos e preços */

export async function recalcularPedido(pedidoId: string) {
  const db = await getDb();
  const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, pedidoId));
  if (!pedido) throw new Error("Pedido não encontrado");
  const itens = await db.select().from(schema.produtos).where(eq(schema.produtos.pedidoId, pedidoId));
  const [componentes, pol, fiscal, sistema] = await Promise.all([
    getComponentesCusto(),
    getConfig("precificacao"),
    getConfig("fiscal"),
    getConfig("sistema"),
  ]);
  const custos = calcularCustos(
    itens.map((i) => ({ id: i.id, precoOrigem: i.precoOrigem, quantidade: i.quantidade })),
    { ...pedido, custos: await custosDoPedido(pedido) },
    componentes,
  );
  for (const i of itens) {
    const c = custos.get(i.id)!;
    const p = calcularPreco(c.custoTotalBrl, i.tipo, pol, { fatorManual: i.fator, fatorPedido: pedido.fator, precoManual: i.precoManual });
    await db
      .update(schema.produtos)
      .set({
        moeda: pedido.moeda,
        custoProdutoBrl: c.custoProdutoBrl,
        custoAdicionalBrl: c.custoAdicionalBrl,
        custoTotalBrl: c.custoTotalBrl,
        fatorAplicado: p.fator,
        precoVenda: p.preco,
        precos: p.precos,
        ncm: i.ncm || ncmPara(fiscal, i.tipo, i.material, sistema.ncmPadrao),
        alertas: [...(i.alertas ?? []).filter((x) => !x.startsWith("Margem") && !x.startsWith("Tabela") && !x.startsWith("Sem custo") && !x.startsWith("Fator ×")), ...p.alertas],
        atualizadoEm: new Date().toISOString(),
      })
      .where(eq(schema.produtos.id, i.id));
  }
}

/** Valores dos componentes de custo do pedido (salvos, ou os do cenário escolhido). */
export async function custosDoPedido(pedido: { cenario: string | null; custos: Record<string, number> | null }) {
  const componentes = await getComponentesCusto();
  const { padrao, cenarios } = await getCenarios();
  // Base = valores do cenário; por cima, o que foi digitado no pedido (ex.: o frete).
  const base = valoresDoCenario(componentes, cenarios[pedido.cenario ?? padrao] ?? cenarios[padrao]);
  return { ...base, ...(pedido.custos ?? {}) };
}

/** Recalcula um produto (dentro do pedido, recalcula o pedido inteiro por causa do rateio). */
export async function recalcularProduto(produtoId: string) {
  const db = await getDb();
  const [p] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, produtoId));
  if (!p) return;
  if (p.pedidoId) return recalcularPedido(p.pedidoId);
  const pol = await getConfig("precificacao");
  const custo = p.custoTotalBrl ?? 0;
  const r = calcularPreco(custo, p.tipo, pol, { fatorManual: p.fator, precoManual: p.precoManual });
  await db
    .update(schema.produtos)
    .set({ fatorAplicado: r.fator, precoVenda: r.preco, precos: r.precos, atualizadoEm: new Date().toISOString() })
    .where(eq(schema.produtos.id, produtoId));
}

/* ------------------------------------------- referência e código de barras */

export async function gerarCodigos(produtoIds: string[], refazer = false) {
  if (!produtoIds.length) return 0;
  const db = await getDb();
  const [tax, sistema] = await Promise.all([getConfig("taxonomia"), getConfig("sistema")]);
  const itens = await db
    .select()
    .from(schema.produtos)
    .where(inArray(schema.produtos.id, produtoIds))
    .orderBy(asc(schema.produtos.linha));
  // Variações do mesmo modelo (mesmo "grupo") compartilham a referência; cada uma tem seu EAN.
  const refPorGrupo = new Map<string, string>();
  for (const p of itens) if (p.grupo && p.referencia && !refazer) refPorGrupo.set(`${p.pedidoId}:${p.grupo}`, p.referencia);
  let n = 0;
  for (const p of itens) {
    const set: Partial<Produto> = {};
    const chaveGrupo = p.grupo ? `${p.pedidoId}:${p.grupo}` : null;
    if (!p.referencia || refazer) {
      const existente = chaveGrupo ? refPorGrupo.get(chaveGrupo) : undefined;
      if (existente) set.referencia = existente;
      else {
        const prefixo = tax.tipos.find((t) => t.id === p.tipo)?.prefixo ?? "SJ";
        const agora = new Date();
        const seq = await proximaSequencia(chaveSequenciaReferencia(sistema.referenciaModelo, prefixo, agora));
        set.referencia = montarReferencia(sistema.referenciaModelo, { prefixo, sequencia: seq, data: agora });
        if (chaveGrupo) refPorGrupo.set(chaveGrupo, set.referencia);
      }
    }
    if (!p.codigoBarras || refazer) {
      const seq = await proximaSequencia(`ean:${sistema.eanPrefixo}`);
      set.codigoBarras = montarEan13(sistema.eanPrefixo, seq);
    }
    if (Object.keys(set).length) {
      await db.update(schema.produtos).set({ ...set, atualizadoEm: new Date().toISOString() }).where(eq(schema.produtos.id, p.id));
      n++;
    }
  }
  return n;
}

/** Marca como variações do mesmo modelo as linhas do pedido com o mesmo código de fornecedor. */
export async function agruparVariacoesAutomaticas(pedidoId: string) {
  const db = await getDb();
  const itens = await produtosDoPedido(pedidoId);
  const porCodigo = new Map<string, Produto[]>();
  for (const p of itens) {
    if (!p.codigoFornecedor) continue;
    const k = p.codigoFornecedor.toUpperCase();
    porCodigo.set(k, [...(porCodigo.get(k) ?? []), p]);
  }
  for (const [codigo, lista] of porCodigo) {
    if (lista.length < 2) continue;
    for (const p of lista) if (!p.grupo) await db.update(schema.produtos).set({ grupo: codigo }).where(eq(schema.produtos.id, p.id));
  }
}

/* --------------------------------------------------------------- consultas */

export async function produtosDoPedido(pedidoId: string) {
  const db = await getDb();
  return db.select().from(schema.produtos).where(eq(schema.produtos.pedidoId, pedidoId)).orderBy(asc(schema.produtos.linha));
}

export async function produtosSemAnalise(pedidoId: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.produtos)
    .where(and(eq(schema.produtos.pedidoId, pedidoId), isNull(schema.produtos.tipo)))
    .orderBy(asc(schema.produtos.linha));
}

/** Resumo numérico do pedido — usado na tela e no parecer dos especialistas. */
export async function resumoPedido(pedidoId: string) {
  const db = await getDb();
  const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, pedidoId));
  const itens = await produtosDoPedido(pedidoId);
  const pol = await getConfig("precificacao");
  const comissao = (pol.comissao_consignacao_pct ?? 0) / 100;
  const soma = (f: (p: Produto) => number) => itens.reduce((s, p) => s + f(p), 0);
  const pecas = soma((p) => p.quantidade);
  const totalOrigem = soma((p) => (p.precoOrigem ?? 0) * p.quantidade);
  const custoTotal = soma((p) => (p.custoTotalBrl ?? 0) * p.quantidade);
  const vendaPotencial = soma((p) => (p.precoVenda ?? 0) * p.quantidade);
  const porTipo: Record<string, { linhas: number; pecas: number; custo: number; venda: number }> = {};
  for (const p of itens) {
    const k = p.tipo ?? "sem_tipo";
    porTipo[k] ??= { linhas: 0, pecas: 0, custo: 0, venda: 0 };
    porTipo[k].linhas++;
    porTipo[k].pecas += p.quantidade;
    porTipo[k].custo += (p.custoTotalBrl ?? 0) * p.quantidade;
    porTipo[k].venda += (p.precoVenda ?? 0) * p.quantidade;
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const valoresCusto = pedido ? await custosDoPedido(pedido) : {};
  const detalheCustos = pedido
    ? detalharCustos(
        itens.map((i) => ({ id: i.id, precoOrigem: i.precoOrigem, quantidade: i.quantidade })),
        { cotacao: pedido.cotacao, custos: valoresCusto },
        await getComponentesCusto(),
      )
    : null;
  return {
    pedido,
    valoresCusto,
    detalheCustos,
    linhas: itens.length,
    pecas,
    totalOrigem: r2(totalOrigem),
    totalDocumento: pedido?.totalDocumento ?? null,
    diferencaDocumento: pedido?.totalDocumento != null ? r2(totalOrigem - pedido.totalDocumento) : null,
    custoTotal: r2(custoTotal),
    vendaPotencial: r2(vendaPotencial),
    receitaLiquidaPotencial: r2(vendaPotencial * (1 - comissao)),
    margemBrutaPct: vendaPotencial > 0 ? r2(((vendaPotencial * (1 - comissao) - custoTotal) / (vendaPotencial * (1 - comissao))) * 100) : 0,
    fatorMedio: custoTotal > 0 ? r2(vendaPotencial / custoTotal) : 0,
    porTipo,
    semCodigo: itens.filter((p) => !p.referencia || !p.codigoBarras).length,
    semAnalise: itens.filter((p) => !p.tipo).length,
    comAlerta: itens.filter((p) => (p.alertas ?? []).length > 0).length,
  };
}
