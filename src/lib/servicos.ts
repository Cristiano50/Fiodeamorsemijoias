import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getCenarios, getComponentesCusto, getConfig, ncmPara } from "./config";
import { LIMITE_CUSTO_MUDOU_PCT, calcularCustos, calcularPreco, detalharCustos, semAlertasDePreco, valoresDoCenario } from "./precos";
import { chaveSequenciaReferencia, classificarRecompra, montarEan13, montarReferencia, normalizarChave, type OriginalRecompra } from "./codigos";
import type { ItemAnalisado } from "./ai/claude";
import { lerLinha } from "./extracao";
import type { Pedido, Produto } from "./db/schema";
import { chaveFornecedor } from "./fornecedores";
import { estoqueEntrada } from "./estoque";
import { ehRecompraUp } from "./upvendas-planilha";

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
  origem: "catalogo" | "pagina" | "arte" | "ia" | "upload" | "referencia" | "defeito"; // defeito = foto de peça com defeito (conferência; não é pública)
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

/** Preço vigente (do original) de cada cadeia de recompra: id do original → preço da tabela base. */
async function precosVigentes(ids: string[]) {
  if (!ids.length) return new Map<string, number | null>();
  const db = await getDb();
  const linhas = await db
    .select({ id: schema.produtos.id, precoVenda: schema.produtos.precoVenda })
    .from(schema.produtos)
    .where(inArray(schema.produtos.id, [...new Set(ids)]));
  return new Map(linhas.map((l) => [l.id, l.precoVenda]));
}

/** Os originais mudaram de preço: as recompras deles (outros pedidos) acompanham — no UP é um preço só por código. */
async function propagarPrecoNaCadeia(mudaram: { id: string; preco: number; precos: Record<string, number> | null }[]) {
  if (!mudaram.length) return;
  const db = await getDb();
  const comRecompra = new Set(
    (
      await db
        .selectDistinct({ id: schema.produtos.recompraDe })
        .from(schema.produtos)
        .where(inArray(schema.produtos.recompraDe, mudaram.map((m) => m.id)))
    ).map((x) => x.id),
  );
  for (const m of mudaram.filter((x) => comRecompra.has(x.id)))
    await db
      .update(schema.produtos)
      .set({ precoVenda: m.preco, precos: m.precos, atualizadoEm: new Date().toISOString() })
      .where(eq(schema.produtos.recompraDe, m.id));
}

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
  // Moeda estrangeira sem cotação (cotação 0): custo e preço ficam pendentes; nunca vira cotação 1.
  const semCotacao = pedido.moeda !== "BRL" && !(pedido.cotacao > 0);
  // Recompra: o preço é o vigente do original (mesma referência/EAN = um preço só no UP).
  const vigentes = await precosVigentes(itens.filter(ehRecompra).map((i) => i.recompraDe!));
  const mudaram: { id: string; preco: number; precos: Record<string, number> }[] = [];
  for (const i of itens) {
    const c = custos.get(i.id)!;
    const vigente = i.recompraDe ? (vigentes.get(i.recompraDe) ?? null) : null;
    const outros = semAlertasDePreco(i.alertas);
    const ncm = i.ncm || ncmPara(fiscal, i.tipo, i.material, sistema.ncmPadrao);
    let set: Partial<Produto>;
    if (semCotacao && !vigente && !(i.precoManual && i.precoManual > 0)) {
      set = {
        moeda: pedido.moeda,
        custoProdutoBrl: null,
        custoAdicionalBrl: null,
        custoTotalBrl: null,
        fatorAplicado: null,
        precoVenda: null,
        precos: null,
        ncm,
        alertas: [...outros, "Sem cotação: preço pendente."],
      };
    } else {
      const p = calcularPreco(semCotacao ? 0 : c.custoTotalBrl, i.tipo, pol, {
        fatorManual: i.fator,
        fatorPedido: pedido.fator,
        precoManual: i.precoManual,
        precoVigente: vigente,
      });
      set = {
        moeda: pedido.moeda,
        custoProdutoBrl: semCotacao ? null : c.custoProdutoBrl,
        custoAdicionalBrl: semCotacao ? null : c.custoAdicionalBrl,
        custoTotalBrl: semCotacao ? null : c.custoTotalBrl,
        fatorAplicado: p.fator,
        precoVenda: p.preco,
        precos: p.precos,
        ncm,
        alertas: [...outros, ...(semCotacao ? ["Sem cotação: custo pendente."] : p.alertas)],
      };
      if (!i.recompraDe && (p.preco !== i.precoVenda || JSON.stringify(p.precos) !== JSON.stringify(i.precos))) mudaram.push({ id: i.id, preco: p.preco, precos: p.precos });
    }
    await db
      .update(schema.produtos)
      .set({ ...set, atualizadoEm: new Date().toISOString() })
      .where(eq(schema.produtos.id, i.id));
  }
  await propagarPrecoNaCadeia(mudaram);
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
  const vigente = p.recompraDe ? ((await precosVigentes([p.recompraDe])).get(p.recompraDe) ?? null) : null;
  const r = calcularPreco(custo, p.tipo, pol, { fatorManual: p.fator, precoManual: p.precoManual, precoVigente: vigente });
  await db
    .update(schema.produtos)
    .set({
      fatorAplicado: r.fator,
      precoVenda: r.preco,
      precos: r.precos,
      alertas: [...semAlertasDePreco(p.alertas), ...r.alertas],
      atualizadoEm: new Date().toISOString(),
    })
    .where(eq(schema.produtos.id, produtoId));
  if (!p.recompraDe && r.preco !== p.precoVenda) await propagarPrecoNaCadeia([{ id: p.id, preco: r.preco, precos: r.precos }]);
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
  // A referência do grupo pode estar numa peça do pedido que não veio nesta lista.
  const refPorGrupo = new Map<string, string>();
  if (!refazer) {
    const pedidosComGrupo = [...new Set(itens.filter((p) => p.grupo && p.pedidoId).map((p) => p.pedidoId!))];
    if (pedidosComGrupo.length) {
      const doGrupo = await db
        .select({ pedidoId: schema.produtos.pedidoId, grupo: schema.produtos.grupo, referencia: schema.produtos.referencia })
        .from(schema.produtos)
        .where(and(inArray(schema.produtos.pedidoId, pedidosComGrupo), isNotNull(schema.produtos.grupo), isNotNull(schema.produtos.referencia)))
        .orderBy(asc(schema.produtos.linha));
      for (const g of doGrupo) if (!refPorGrupo.has(`${g.pedidoId}:${g.grupo}`)) refPorGrupo.set(`${g.pedidoId}:${g.grupo}`, g.referencia!);
    }
  }
  let n = 0;
  for (const p of itens) {
    if (p.recompraDe) continue; // recompra usa a referência e o EAN do produto original
    if (aguardandoRecompra(p)) continue; // recompra a confirmar: a referência sai da decisão ("É esta" ou "Não é recompra")
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
    // Código de barras: por padrão quem cria é o UP Vendas no cadastro (o app importa depois).
    // Só no modo "app" o app gera o EAN interno; um código vindo do UP nunca é trocado.
    if (sistema.origemCodigoBarras === "app" && p.codigoBarrasOrigem !== "up" && (!p.codigoBarras || refazer)) {
      const seq = await proximaSequencia(`ean:${sistema.eanPrefixo}`);
      set.codigoBarras = montarEan13(sistema.eanPrefixo, seq);
      set.codigoBarrasOrigem = "app";
    }
    if (Object.keys(set).length) {
      await db.update(schema.produtos).set({ ...set, atualizadoEm: new Date().toISOString() }).where(eq(schema.produtos.id, p.id));
      n++;
    }
  }
  return n;
}

/* ------------------------------------------------------------- recompra */

/**
 * A peça é recompra (mesma referência e código de barras de um original de pedido anterior)?
 * A mesma regra da planilha do UP (upvendas-planilha.ts → ehRecompraUp: recompraDe preenchido).
 */
export const ehRecompra = ehRecompraUp;

/** Recompra a confirmar: há originais possíveis e ninguém decidiu ainda ("É esta" ou "Não é recompra"). */
export const aguardandoRecompra = (p: { recompraDe: string | null; recompraCandidatas: string[] | null }) =>
  p.recompraDe == null && (p.recompraCandidatas?.length ?? 0) > 0;

/** "Não é recompra" confirmado: lista vazia (nunca mais é detectada como recompra). */
const decididaComoNova = (p: { recompraDe: string | null; recompraCandidatas: string[] | null }) =>
  p.recompraDe == null && Array.isArray(p.recompraCandidatas) && p.recompraCandidatas.length === 0;

/**
 * Especificação do fornecedor (G, MR, 14KF, 金色, 16…): a gravada na importação; nas peças antigas, lida de novo
 * da linha original do documento (estável, a IA não altera). Sem linha original (cadastro avulso), a variação.
 */
export const especificacaoDe = (p: { especificacao?: string | null; textoOriginal: string | null; variacao: string | null }) =>
  (p.especificacao ?? (p.textoOriginal ? (lerLinha(p.textoOriginal).especificacao ?? "") : (p.variacao ?? ""))).trim();

/** O que a recompra herda do original (no UP é o mesmo produto). */
const dadosDoOriginal = (o: Produto, it: Produto): Partial<Produto> => ({
  referencia: o.referencia,
  codigoBarras: o.codigoBarras,
  codigoBarrasOrigem: o.codigoBarrasOrigem,
  nome: o.nome,
  nomeComercial: o.nomeComercial,
  nomesSugeridos: o.nomesSugeridos,
  traducao: it.traducao ?? o.traducao,
  avaliacao: o.avaliacao,
  legenda: o.legenda,
  hashtags: o.hashtags,
  destaque: o.destaque,
  tipo: o.tipo,
  subtipo: o.subtipo,
  material: o.material,
  banho: o.banho,
  corPedra: o.corPedra,
  tamanho: o.tamanho,
  variacao: o.variacao ?? it.variacao,
  ehConjunto: o.ehConjunto,
  componentes: o.componentes,
  estilo: o.estilo,
  ncm: o.ncm,
  status: "revisado",
});

const ehAlertaDeRecompra = (a: string) => a.startsWith("Recompra de") || a.startsWith("Preço do fornecedor");

function alertasDaRecompra(orig: { produto: Produto; numero: string | null; dataCompra: string | null }, it: Produto, moeda: string, confirmada: boolean) {
  const o = orig.produto;
  const alertas = [
    `Recompra de ${o.referencia} (pedido ${orig.numero ?? "?"}${orig.dataCompra ? ` de ${orig.dataCompra.split("-").reverse().join("/")}` : ""})${confirmada ? ", confirmada" : ""}.`,
  ];
  if (o.precoOrigem && it.precoOrigem && o.moeda === moeda && Math.abs(it.precoOrigem - o.precoOrigem) > 0.001) {
    const pct = ((it.precoOrigem - o.precoOrigem) / o.precoOrigem) * 100;
    alertas.push(`Preço do fornecedor ${pct > 0 ? "subiu" : "caiu"} ${Math.abs(pct).toFixed(0)}% (${o.precoOrigem} → ${it.precoOrigem}).`);
  }
  return [...alertas, ...(it.alertas ?? []).filter((a) => !ehAlertaDeRecompra(a))];
}

/**
 * Recompra: a linha cujo fornecedor + código + especificação (chave da recompra, ver classificarRecompra) já foi
 * cadastrado em pedido anterior reaproveita a referência, o EAN e a classificação do original (mesmo SKU no UP) — sem IA.
 *  - Exatamente 1 original (e o pedido tem fornecedor): recompra automática.
 *  - Mais de um original possível, ou pedido/original sem fornecedor: "recompra a confirmar" (recompraCandidatas).
 *  - Decisões já tomadas (recompra, "Não é recompra") nunca são desfeitas por uma nova detecção;
 *    sugestões pendentes só ganham candidatos novos.
 * Roda no finalizar, depois da IA (detectar/analisar) e no "Gerar códigos". Devolve quantas recompras automáticas fez.
 * Regra do gestor de estoque (docs/especialistas/gestor-estoque.md).
 */
export async function detectarRecompras(pedidoId: string) {
  const db = await getDb();
  const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, pedidoId));
  if (!pedido) return 0;
  const itens = await produtosDoPedido(pedidoId);
  const abertas = itens.filter((i) => !i.recompraDe && !decididaComoNova(i) && normalizarChave(i.codigoFornecedor));
  if (!abertas.length) return 0;
  const codigos = new Set(abertas.map((i) => normalizarChave(i.codigoFornecedor)));
  const p = schema.produtos;
  // Originais já cadastrados (com referência; o código do UP pode chegar depois) de outros pedidos, com o mesmo código.
  const comCodigo = await db
    .select({ id: p.id, codigo: p.codigoFornecedor })
    .from(p)
    .where(and(isNull(p.recompraDe), isNotNull(p.referencia), isNotNull(p.codigoFornecedor), or(isNull(p.pedidoId), ne(p.pedidoId, pedidoId))));
  const ids = comCodigo.filter((x) => codigos.has(normalizarChave(x.codigo))).map((x) => x.id);
  const candidatos = ids.length
    ? await db
        .select({ produto: schema.produtos, fornecedor: schema.pedidos.fornecedor, numero: schema.pedidos.numero, dataCompra: schema.pedidos.dataCompra })
        .from(p)
        .leftJoin(schema.pedidos, eq(p.pedidoId, schema.pedidos.id))
        .where(inArray(p.id, ids))
    : [];
  // O nome original do fornecedor (não o apelido) identifica o fornecedor na recompra.
  const originais: OriginalRecompra[] = candidatos.map((c) => ({
    id: c.produto.id,
    codigo: c.produto.codigoFornecedor,
    especificacao: especificacaoDe(c.produto),
    fornecedorChave: chaveFornecedor(c.fornecedor),
    criadoEm: c.produto.criadoEm,
  }));
  const fornecedor = chaveFornecedor(pedido.fornecedor);
  const agora = new Date().toISOString();
  let n = 0;
  for (const it of abertas) {
    const r = classificarRecompra({ codigo: it.codigoFornecedor, especificacao: especificacaoDe(it), fornecedorChave: fornecedor }, originais);
    const pendentes = it.recompraCandidatas ?? [];
    if (pendentes.length) {
      // Já está "a confirmar": não vira automática sozinha; só junta originais novos.
      const uniao = [...new Set([...pendentes, ...(r.automatico ? [r.automatico] : []), ...r.candidatas])];
      if (uniao.length !== pendentes.length) await db.update(p).set({ recompraCandidatas: uniao, atualizadoEm: agora }).where(eq(p.id, it.id));
      continue;
    }
    if (r.automatico) {
      const orig = candidatos.find((c) => c.produto.id === r.automatico)!;
      await db
        .update(p)
        .set({
          recompraDe: orig.produto.id,
          recompraCandidatas: null,
          ...dadosDoOriginal(orig.produto, it),
          alertas: alertasDaRecompra(orig, it, pedido.moeda, false),
          atualizadoEm: agora,
        })
        .where(eq(p.id, it.id));
      n++;
    } else if (r.candidatas.length) {
      await db.update(p).set({ recompraCandidatas: r.candidatas, atualizadoEm: agora }).where(eq(p.id, it.id));
    }
  }
  return n;
}

/**
 * "É esta": a peça vira recompra do original escolhido (referência, EAN, código do UP, classificação e preço vigente).
 * Escolha confirmada não é desfeita por uma nova detecção.
 */
export async function confirmarRecompra(produtoId: string, originalId: string) {
  const db = await getDb();
  const [it] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, produtoId));
  if (!it) throw new Error("Peça não encontrada.");
  const [escolhido] = await db.select({ id: schema.produtos.id, recompraDe: schema.produtos.recompraDe }).from(schema.produtos).where(eq(schema.produtos.id, originalId));
  if (!escolhido) throw new Error("A peça original não existe mais.");
  const raizId = escolhido.recompraDe ?? escolhido.id; // sempre aponta para o original da cadeia
  const [orig] = await db
    .select({ produto: schema.produtos, numero: schema.pedidos.numero, dataCompra: schema.pedidos.dataCompra })
    .from(schema.produtos)
    .leftJoin(schema.pedidos, eq(schema.produtos.pedidoId, schema.pedidos.id))
    .where(eq(schema.produtos.id, raizId));
  if (!orig?.produto.referencia) throw new Error("A peça original ainda não tem referência.");
  if (orig.produto.id === it.id || (it.pedidoId && orig.produto.pedidoId === it.pedidoId)) throw new Error("O original tem que ser de outro pedido.");
  const [pedido] = it.pedidoId ? await db.select({ moeda: schema.pedidos.moeda }).from(schema.pedidos).where(eq(schema.pedidos.id, it.pedidoId)) : [];
  await db
    .update(schema.produtos)
    .set({
      recompraDe: orig.produto.id,
      recompraCandidatas: null,
      ...dadosDoOriginal(orig.produto, it),
      alertas: alertasDaRecompra(orig, it, pedido?.moeda ?? it.moeda, true),
      atualizadoEm: new Date().toISOString(),
    })
    .where(eq(schema.produtos.id, it.id));
  if (it.pedidoId) await recalcularPedido(it.pedidoId);
  else await recalcularProduto(it.id);
  return { referencia: orig.produto.referencia, original: orig.produto.id };
}

/**
 * "Não é recompra": a peça vira produto novo (ganha referência e EAN próprios) e a decisão fica guardada
 * (recompraCandidatas = []), para a próxima detecção não marcar de novo. Só a peça que era recompra perde a
 * referência e o código herdados.
 */
export async function desfazerRecompra(ids: string[]) {
  if (!ids.length) return;
  const db = await getDb();
  const itens = await db.select().from(schema.produtos).where(inArray(schema.produtos.id, ids));
  const agora = new Date().toISOString();
  for (const p of itens) {
    const set: Partial<Produto> = { recompraCandidatas: [], atualizadoEm: agora };
    if (p.recompraDe)
      Object.assign(set, { recompraDe: null, referencia: null, codigoBarras: null, codigoBarrasOrigem: null, alertas: (p.alertas ?? []).filter((a) => !ehAlertaDeRecompra(a)) });
    await db.update(schema.produtos).set(set).where(eq(schema.produtos.id, p.id));
  }
  await gerarCodigos(ids);
  for (const pedidoId of new Set(itens.map((p) => p.pedidoId).filter(Boolean) as string[])) await recalcularPedido(pedidoId);
}

/**
 * "Usar o preço novo para todas" (gestora): o preço calculado pelo custo desta peça passa a valer para todas as peças
 * com a mesma referência (o original, as variações e as recompras — no UP é um preço só). O original guarda o preço
 * novo como preço fixado (o recálculo do pedido antigo não volta ao preço anterior).
 * Devolve a lista para reetiquetar: peças da referência com estoque (saldo do UP quando importado; senão a entrada do pedido).
 */
export async function usarPrecoNovoNaCadeia(produtoId: string) {
  const db = await getDb();
  const [p] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, produtoId));
  if (!p) throw new Error("Peça não encontrada.");
  if (!p.referencia) throw new Error("A peça ainda não tem referência.");
  if (!(p.custoTotalBrl != null && p.custoTotalBrl > 0)) throw new Error("A peça ainda não tem custo: confira a cotação e o preço do fornecedor.");
  const [pedido] = p.pedidoId ? await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, p.pedidoId)) : [];
  const pol = await getConfig("precificacao");
  const novo = calcularPreco(p.custoTotalBrl, p.tipo, pol, { fatorManual: p.fator, fatorPedido: pedido?.fator, precoManual: p.precoManual }).preco;
  const mesmaReferencia = sql`upper(${schema.produtos.referencia}) = ${p.referencia.toUpperCase()}`;
  const cadeia = await db.select().from(schema.produtos).where(mesmaReferencia);
  const originais = cadeia.filter((x) => !x.recompraDe);
  const antes = originais.find((x) => x.id === (p.recompraDe ?? p.id))?.precoVenda ?? p.precoVenda;
  if (originais.length)
    await db
      .update(schema.produtos)
      .set({ precoManual: novo, atualizadoEm: new Date().toISOString() })
      .where(inArray(schema.produtos.id, originais.map((x) => x.id)));
  // Primeiro os pedidos dos originais (o preço novo passa para as recompras), depois os das recompras (alertas).
  for (const o of originais.filter((x) => !x.pedidoId)) await recalcularProduto(o.id);
  const pedidosOriginais = [...new Set(originais.map((x) => x.pedidoId).filter(Boolean) as string[])];
  const pedidosRecompras = [...new Set(cadeia.filter((x) => x.recompraDe && x.pedidoId).map((x) => x.pedidoId!))].filter((x) => !pedidosOriginais.includes(x));
  for (const id of [...pedidosOriginais, ...pedidosRecompras]) await recalcularPedido(id);

  const depois = await db
    .select({ produto: schema.produtos, numero: schema.pedidos.numero })
    .from(schema.produtos)
    .leftJoin(schema.pedidos, eq(schema.produtos.pedidoId, schema.pedidos.id))
    .where(mesmaReferencia)
    .orderBy(asc(schema.produtos.criadoEm));
  const codigos = [...new Set(depois.map((x) => x.produto.codigoBarras).filter(Boolean) as string[])];
  const saldos = codigos.length ? await db.select().from(schema.saldosUp).where(inArray(schema.saldosUp.codigoBarras, codigos)) : [];
  const saldoDoCodigo = new Map(saldos.map((x) => [x.codigoBarras, x.saldo]));
  const contados = new Set<string>();
  const reetiquetar: { id: string; referencia: string | null; nome: string | null; variacao: string | null; pedido: string | null; linha: number | null; pecas: number; fonte: "saldo do UP" | "entrada do pedido" }[] = [];
  for (const { produto: x, numero } of depois) {
    let pecas: number;
    let fonte: "saldo do UP" | "entrada do pedido" = "entrada do pedido";
    if (x.codigoBarras && saldoDoCodigo.has(x.codigoBarras)) {
      // O saldo do UP é do código (a cadeia toda): conta uma vez só.
      pecas = contados.has(x.codigoBarras) ? 0 : Math.max(0, saldoDoCodigo.get(x.codigoBarras)!);
      contados.add(x.codigoBarras);
      fonte = "saldo do UP";
    } else pecas = estoqueEntrada(x);
    if (pecas > 0) reetiquetar.push({ id: x.id, referencia: x.referencia, nome: x.nome, variacao: x.variacao, pedido: numero, linha: x.linha, pecas, fonte });
  }
  return { referencia: p.referencia, antes, novo, pecasNaReferencia: cadeia.length, reetiquetar };
}

/** Peças do pedido com recompra a confirmar, com os originais possíveis (foto, referência, preço vigente). */
export async function recomprasAConfirmar(produtos: Produto[]) {
  const pendentes = produtos.filter(aguardandoRecompra);
  if (!pendentes.length) return [];
  const ids = [...new Set(pendentes.flatMap((p) => p.recompraCandidatas ?? []))];
  const db = await getDb();
  const lista = await db
    .select({ produto: schema.produtos, numero: schema.pedidos.numero, dataCompra: schema.pedidos.dataCompra })
    .from(schema.produtos)
    .leftJoin(schema.pedidos, eq(schema.produtos.pedidoId, schema.pedidos.id))
    .where(inArray(schema.produtos.id, ids));
  const porId = new Map(lista.map((x) => [x.produto.id, x]));
  return pendentes.map((p) => ({
    produtoId: p.id,
    linha: p.linha,
    codigoFornecedor: p.codigoFornecedor,
    especificacao: especificacaoDe(p) || null,
    nome: p.nome ?? p.traducao ?? p.descricaoOriginal,
    imagemId: p.imagemId,
    candidatos: (p.recompraCandidatas ?? [])
      .map((id) => porId.get(id))
      .filter((x): x is NonNullable<typeof x> => !!x && !x.produto.recompraDe)
      .map(({ produto: o, numero, dataCompra }) => ({
        id: o.id,
        referencia: o.referencia,
        nome: o.nome,
        variacao: o.variacao,
        especificacao: especificacaoDe(o) || null,
        imagemId: o.imagemId,
        precoVenda: o.precoVenda,
        codigoBarras: o.codigoBarras,
        codigoBarrasOrigem: o.codigoBarrasOrigem,
        pedidoId: o.pedidoId,
        pedidoNumero: numero,
        dataCompra,
      })),
  }));
}

/** Recompras do pedido cujo preço pelo custo novo difere mais de 10% do preço vigente do original ("Custo mudou"). */
export async function custoMudouDoPedido(pedido: Pedido, produtos: Produto[]) {
  const recompras = produtos.filter(ehRecompra);
  if (!recompras.length) return [];
  const db = await getDb();
  const raizes = await db
    .select({ id: schema.produtos.id, referencia: schema.produtos.referencia, precoVenda: schema.produtos.precoVenda })
    .from(schema.produtos)
    .where(inArray(schema.produtos.id, [...new Set(recompras.map((p) => p.recompraDe!))]));
  const raiz = new Map(raizes.map((r) => [r.id, r]));
  const pol = await getConfig("precificacao");
  const out: { produtoId: string; linha: number | null; referencia: string | null; nome: string | null; imagemId: string | null; originalId: string; vigente: number; calculado: number; diferencaPct: number; custo: number }[] = [];
  for (const p of recompras) {
    const r = raiz.get(p.recompraDe!);
    if (!r?.precoVenda || !(p.custoTotalBrl != null && p.custoTotalBrl > 0)) continue;
    const c = calcularPreco(p.custoTotalBrl, p.tipo, pol, { fatorManual: p.fator, fatorPedido: pedido.fator, precoManual: p.precoManual, precoVigente: r.precoVenda });
    if (c.custoMudouPct != null && Math.abs(c.custoMudouPct) > LIMITE_CUSTO_MUDOU_PCT)
      out.push({ produtoId: p.id, linha: p.linha, referencia: p.referencia, nome: p.nome, imagemId: p.imagemId, originalId: r.id, vigente: r.precoVenda, calculado: c.precoCalculado, diferencaPct: c.custoMudouPct, custo: p.custoTotalBrl });
  }
  return out;
}

/** Saldo de estoque informado pelo UP (lista de produtos exportada), por código de barras. Grava ou atualiza. */
export async function gravarSaldosUp(saldos: { codigoBarras: string; saldo: number }[], arquivo: string | null) {
  if (!saldos.length) return 0;
  const db = await getDb();
  const agora = new Date().toISOString();
  for (let i = 0; i < saldos.length; i += 200) {
    await db
      .insert(schema.saldosUp)
      .values(saldos.slice(i, i + 200).map((s) => ({ codigoBarras: s.codigoBarras, saldo: Math.round(s.saldo), arquivo, atualizadoEm: agora })))
      .onConflictDoUpdate({
        target: schema.saldosUp.codigoBarras,
        set: { saldo: sql`excluded.saldo`, arquivo: sql`excluded.arquivo`, atualizadoEm: sql`excluded.atualizado_em` },
      });
  }
  return saldos.length;
}

/* ------------------------------------------------- código de barras do UP */

export class CodigoEmUso extends Error {}

/**
 * Grava o código de barras de um produto e de toda a cadeia de recompra dele (no UP é o mesmo produto).
 * O código só pode se repetir dentro da cadeia. `codigo` vazio apaga.
 */
export async function definirCodigoBarras(produtoId: string, codigo: string | null, origem: "up" | "app" = "up") {
  const db = await getDb();
  const [p] = await db.select({ id: schema.produtos.id, recompraDe: schema.produtos.recompraDe }).from(schema.produtos).where(eq(schema.produtos.id, produtoId));
  if (!p) throw new Error("Produto não encontrado");
  const raiz = p.recompraDe ?? p.id;
  const valor = codigo?.replace(/\s+/g, "") || null;
  if (valor) {
    const usados = await db
      .select({ id: schema.produtos.id, recompraDe: schema.produtos.recompraDe, referencia: schema.produtos.referencia })
      .from(schema.produtos)
      .where(eq(schema.produtos.codigoBarras, valor));
    const outro = usados.find((u) => (u.recompraDe ?? u.id) !== raiz);
    if (outro) throw new CodigoEmUso(`O código ${valor} já é de outro produto (${outro.referencia ?? "sem referência"}).`);
  }
  const cadeia = await db
    .select({ id: schema.produtos.id })
    .from(schema.produtos)
    .where(or(eq(schema.produtos.id, raiz), eq(schema.produtos.recompraDe, raiz)));
  await db
    .update(schema.produtos)
    .set({ codigoBarras: valor, codigoBarrasOrigem: valor ? origem : null, atualizadoEm: new Date().toISOString() })
    .where(inArray(schema.produtos.id, cadeia.map((c) => c.id)));
  return cadeia.length;
}

/** Marca como variações do mesmo modelo as linhas do pedido com o mesmo código de fornecedor. */
export async function agruparVariacoesAutomaticas(pedidoId: string) {
  const db = await getDb();
  const itens = await produtosDoPedido(pedidoId);
  const porCodigo = new Map<string, Produto[]>();
  for (const p of itens) {
    const k = normalizarChave(p.codigoFornecedor);
    if (!k) continue;
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
    semCodigo: itens.filter((p) => !p.referencia && !aguardandoRecompra(p)).length, // sem referência (o app gera)
    recompraAConfirmar: itens.filter(aguardandoRecompra).length, // a referência espera "É esta" / "Não é recompra"
    semCodigoUp: itens.filter((p) => p.codigoBarrasOrigem !== "up").length, // sem o código de barras criado pelo UP
    semAnalise: itens.filter((p) => !p.tipo).length,
    comAlerta: itens.filter((p) => (p.alertas ?? []).length > 0).length,
  };
}
