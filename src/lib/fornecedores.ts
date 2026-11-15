import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb, schema } from "./db";
import { getConfig } from "./config";
import { chaveFornecedor, descricaoCredito, loteMinimoEfetivo, motivoNaoAbater, planejarCreditos, somaAbatida, textoValorMoeda, totaisCreditos, type TotalCreditos } from "./conta-fornecedor";
import { cotacaoEfetiva, custosSemEfetiva } from "./custo-real";
import { divergencia, especificacaoDaLinha } from "./recebimento";

// Não importe "./servicos" aqui: o servicos.ts importa este arquivo (ciclo). Quem precisa recalcular
// o pedido (recalcularPedido) é a rota, depois de chamar as funções daqui.

/**
 * Fornecedores: o nome original do documento (ex.: 广州某某饰品有限公司) fica guardado nos pedidos e é ele
 * que a recompra usa. A loja pode dar um apelido (ex.: "Fornecedor Guangzhou") só para exibição.
 * Aqui também fica a conta do fornecedor (item 30): lote mínimo, total pago e créditos por falta/defeito.
 */

/** Chave do fornecedor: o nome original sem espaços e em minúsculas (a mesma regra da recompra). */
export { chaveFornecedor };

/** Apelidos de todos os fornecedores: chave → apelido. */
export async function apelidosFornecedores(): Promise<Map<string, string>> {
  const db = await getDb();
  const linhas = await db.select({ chave: schema.fornecedores.chave, apelido: schema.fornecedores.apelido }).from(schema.fornecedores);
  return new Map(linhas.filter((l) => l.apelido).map((l) => [l.chave, l.apelido!]));
}

/** Apelido do fornecedor pelo nome original (null se não tiver). */
export const apelidoDe = (mapa: Map<string, string>, nome: string | null | undefined) => (nome ? (mapa.get(chaveFornecedor(nome)) ?? null) : null);

/** Salva o apelido (vazio = volta a mostrar só o nome original). O nome original não muda. */
export async function salvarApelido(nomeOriginal: string, apelido: string | null | undefined) {
  const original = nomeOriginal.replace(/\s+/g, " ").trim();
  const chave = chaveFornecedor(original);
  if (!chave) throw new Error("O pedido não tem o nome do fornecedor.");
  const valor = (apelido ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
  const db = await getDb();
  await db
    .insert(schema.fornecedores)
    .values({ chave, nomeOriginal: original, apelido: valor })
    .onConflictDoUpdate({ target: schema.fornecedores.chave, set: { apelido: valor, atualizadoEm: new Date().toISOString() } });
  return valor;
}

/** Fornecedores que aparecem nos pedidos, com o apelido e quantos pedidos cada um tem. */
export async function listarFornecedores() {
  const db = await getDb();
  const [linhas, apelidos] = await Promise.all([
    db
      .select({ nome: schema.pedidos.fornecedor, pedidos: sql<number>`count(*)`, ultimo: sql<string>`max(${schema.pedidos.dataCompra})` })
      .from(schema.pedidos)
      .groupBy(schema.pedidos.fornecedor)
      .orderBy(desc(sql`max(${schema.pedidos.dataCompra})`)),
    apelidosFornecedores(),
  ]);
  // Junta grafias que só diferem por espaços ou maiúsculas (a recompra trata como o mesmo fornecedor).
  const porChave = new Map<string, { nome: string; apelido: string | null; pedidos: number; ultimo: string | null }>();
  for (const l of linhas) {
    const chave = chaveFornecedor(l.nome);
    if (!chave) continue;
    const atual = porChave.get(chave);
    if (atual) {
      atual.pedidos += Number(l.pedidos);
      if (l.ultimo && (!atual.ultimo || l.ultimo > atual.ultimo)) atual.ultimo = l.ultimo;
    } else porChave.set(chave, { nome: l.nome!.trim(), apelido: apelidos.get(chave) ?? null, pedidos: Number(l.pedidos), ultimo: l.ultimo });
  }
  return [...porChave.values()];
}

/* ------------------------------------------------------------ lote mínimo */

/** Lote mínimo do fornecedor (vazio = padrão da loja, Configurações). Cria o registro do fornecedor se faltar. */
export async function salvarLoteMinimo(nomeOriginal: string, lote: number | null) {
  const original = nomeOriginal.replace(/\s+/g, " ").trim();
  const chave = chaveFornecedor(original);
  if (!chave) throw new Error("Informe o nome original do fornecedor.");
  const db = await getDb();
  await db
    .insert(schema.fornecedores)
    .values({ chave, nomeOriginal: original, loteMinimo: lote })
    .onConflictDoUpdate({ target: schema.fornecedores.chave, set: { loteMinimo: lote, atualizadoEm: new Date().toISOString() } });
  return lote;
}

/** Lote mínimo de cada fornecedor que tem um (chave → peças). Quem não está no mapa usa sistema.loteMinimoPadrao. */
export async function lotesMinimosFornecedores(): Promise<Map<string, number>> {
  const db = await getDb();
  const linhas = await db.select({ chave: schema.fornecedores.chave, lote: schema.fornecedores.loteMinimo }).from(schema.fornecedores);
  return new Map(linhas.filter((l) => l.lote && l.lote > 0).map((l) => [l.chave, l.lote!]));
}

/* ------------------------------------------------------------ conta (tela) */

export interface ContaFornecedor {
  nome: string;
  apelido: string | null;
  pedidos: number;
  ultimo: string | null;
  chave: string;
  loteMinimo: number | null; // o do fornecedor (vazio = padrão)
  loteMinimoEfetivo: number;
  totalPagoBrl: number;
  pedidosPagos: number;
  listaPedidos: { id: string; numero: string | null; dataCompra: string | null; moeda: string; valorPagoBrl: number | null; recebimento: string | null; dataChegada: string | null }[];
  creditos: { abertos: TotalCreditos[]; abatidos: TotalCreditos[]; cancelados: number };
}

/** Fornecedores com a conta: lote mínimo, total pago e créditos (tela /fornecedores, só gestora). */
export async function listarFornecedoresComConta(): Promise<{ fornecedores: ContaFornecedor[]; loteMinimoPadrao: number }> {
  const db = await getDb();
  const [base, pedidos, creditos, cadastro, sistema] = await Promise.all([
    listarFornecedores(),
    db
      .select({
        id: schema.pedidos.id,
        numero: schema.pedidos.numero,
        fornecedor: schema.pedidos.fornecedor,
        dataCompra: schema.pedidos.dataCompra,
        moeda: schema.pedidos.moeda,
        valorPagoBrl: schema.pedidos.valorPagoBrl,
        recebimento: schema.pedidos.recebimento,
        dataChegada: schema.pedidos.dataChegada,
      })
      .from(schema.pedidos)
      .orderBy(desc(schema.pedidos.dataCompra)),
    db.select().from(schema.creditosFornecedor),
    db.select().from(schema.fornecedores),
    getConfig("sistema"),
  ]);
  const padrao = loteMinimoEfetivo(null, sistema.loteMinimoPadrao);
  const lotes = new Map(cadastro.map((f) => [f.chave, f.loteMinimo]));
  const fornecedores = base.map((f) => {
    const chave = chaveFornecedor(f.nome);
    const dele = pedidos.filter((p) => chaveFornecedor(p.fornecedor) === chave);
    const pagos = dele.filter((p) => (p.valorPagoBrl ?? 0) > 0);
    const lote = lotes.get(chave) ?? null;
    return {
      ...f,
      chave,
      loteMinimo: lote,
      loteMinimoEfetivo: loteMinimoEfetivo(lote, padrao),
      totalPagoBrl: Math.round(pagos.reduce((s, p) => s + (p.valorPagoBrl ?? 0), 0) * 100) / 100,
      pedidosPagos: pagos.length,
      listaPedidos: dele.map((p) => ({ id: p.id, numero: p.numero, dataCompra: p.dataCompra, moeda: p.moeda, valorPagoBrl: p.valorPagoBrl, recebimento: p.recebimento, dataChegada: p.dataChegada })),
      creditos: totaisCreditos(creditos.filter((c) => c.fornecedorChave === chave)),
    };
  });
  return { fornecedores, loteMinimoPadrao: padrao };
}

/* --------------------------------------------------------------- créditos */

type Credito = typeof schema.creditosFornecedor.$inferSelect;

export interface CreditoTela {
  id: string;
  descricao: string;
  quantidade: number;
  valorMoeda: number;
  moeda: string;
  status: string;
  criadoEm: string;
  atualizadoEm: string;
  pedidoId: string | null;
  pedidoNumero: string | null;
  abatidoPedidoId: string | null;
  abatidoPedidoNumero: string | null;
  motivoNaoAbater: string | null; // só nos créditos em aberto, para o pedido da tela
}

type InfoPedido = { numero: string | null; dataCompra: string | null };

async function pedidosDosCreditos(ids: (string | null)[]) {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unicos.length) return new Map<string, InfoPedido>();
  const db = await getDb();
  const linhas = await db
    .select({ id: schema.pedidos.id, numero: schema.pedidos.numero, dataCompra: schema.pedidos.dataCompra })
    .from(schema.pedidos)
    .where(inArray(schema.pedidos.id, unicos));
  return new Map(linhas.map((l) => [l.id, { numero: l.numero, dataCompra: l.dataCompra }]));
}

function paraTela(c: Credito, pedidos: Map<string, InfoPedido>, pedido?: { id: string; moeda: string; fornecedor: string | null; dataCompra: string | null }): CreditoTela {
  const numero = (id: string | null) => (id ? (pedidos.has(id) ? (pedidos.get(id)!.numero ?? "sem número") : "pedido excluído") : null);
  return {
    id: c.id,
    descricao: c.descricao,
    quantidade: c.quantidade,
    valorMoeda: c.valorMoeda,
    moeda: c.moeda,
    status: c.status,
    criadoEm: c.criadoEm,
    atualizadoEm: c.atualizadoEm,
    pedidoId: c.pedidoId,
    pedidoNumero: numero(c.pedidoId),
    abatidoPedidoId: c.abatidoPedidoId,
    abatidoPedidoNumero: numero(c.abatidoPedidoId),
    motivoNaoAbater: pedido && c.status === "aberto" ? motivoNaoAbater(c, pedido, c.pedidoId ? pedidos.get(c.pedidoId) : null) : null,
  };
}

/**
 * Créditos que interessam à tela de um pedido:
 *  - disponíveis: em aberto, do mesmo fornecedor, nascidos em outro pedido (podem ser abatidos aqui);
 *  - abatidos: os que este pedido já abateu (entram na cotação efetiva);
 *  - gerados: os que a conferência deste pedido gerou.
 */
export async function creditosParaPedido(pedidoId: string) {
  const db = await getDb();
  const [pedido] = await db
    .select({ id: schema.pedidos.id, numero: schema.pedidos.numero, moeda: schema.pedidos.moeda, fornecedor: schema.pedidos.fornecedor, dataCompra: schema.pedidos.dataCompra })
    .from(schema.pedidos)
    .where(eq(schema.pedidos.id, pedidoId));
  if (!pedido) return null;
  const chave = chaveFornecedor(pedido.fornecedor);
  const lista = await db
    .select()
    .from(schema.creditosFornecedor)
    .where(
      or(
        eq(schema.creditosFornecedor.pedidoId, pedidoId),
        eq(schema.creditosFornecedor.abatidoPedidoId, pedidoId),
        chave ? and(eq(schema.creditosFornecedor.fornecedorChave, chave), eq(schema.creditosFornecedor.status, "aberto")) : undefined,
      ),
    )
    .orderBy(schema.creditosFornecedor.criadoEm);
  const pedidos = await pedidosDosCreditos(lista.flatMap((c) => [c.pedidoId, c.abatidoPedidoId]));
  const tela = (c: Credito) => paraTela(c, pedidos, pedido);
  // Pedido seguinte: o crédito aparece nos pedidos comprados no mesmo dia ou depois do pedido onde nasceu.
  const posterior = (c: Credito) => {
    const origem = c.pedidoId ? pedidos.get(c.pedidoId)?.dataCompra : null;
    return !origem || !pedido.dataCompra || pedido.dataCompra >= origem;
  };
  return {
    pedido: { ...pedido, chave, fornecedorApelido: apelidoDe(await apelidosFornecedores(), pedido.fornecedor) },
    disponiveis: lista.filter((c) => c.status === "aberto" && !!chave && c.fornecedorChave === chave && c.pedidoId !== pedidoId && posterior(c)).map(tela),
    abatidos: lista.filter((c) => c.status === "abatido" && c.abatidoPedidoId === pedidoId).map(tela),
    gerados: lista.filter((c) => c.pedidoId === pedidoId).map(tela),
    totalAbatido: somaAbatida(lista, pedidoId, pedido.moeda),
  };
}

/** Todos os créditos de um fornecedor (pela chave ou pelo nome original), do mais novo para o mais antigo. */
export async function creditosDoFornecedor(chaveOuNome: string) {
  const chave = chaveFornecedor(chaveOuNome);
  if (!chave) return [];
  const db = await getDb();
  const lista = await db.select().from(schema.creditosFornecedor).where(eq(schema.creditosFornecedor.fornecedorChave, chave)).orderBy(desc(schema.creditosFornecedor.criadoEm));
  const pedidos = await pedidosDosCreditos(lista.flatMap((c) => [c.pedidoId, c.abatidoPedidoId]));
  return lista.map((c) => paraTela(c, pedidos));
}

async function emLote(ops: BatchItem<"sqlite">[]) {
  if (!ops.length) return;
  const db = await getDb();
  await db.batch(ops as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

/**
 * Gera ou atualiza os créditos da conferência de um pedido (falta e defeito × preço na moeda, em aberto),
 * sem duplicar ao conferir de novo: atualiza o crédito da linha; se a falta sumiu, cancela.
 * Sem o nome do fornecedor no pedido não há conta onde lançar: nada é gerado (semFornecedor).
 */
export async function sincronizarCreditosDoPedido(pedidoId: string) {
  const db = await getDb();
  const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, pedidoId));
  if (!pedido) throw new Error("Pedido não encontrado");
  const chave = chaveFornecedor(pedido.fornecedor);
  if (!chave) return { criados: 0, atualizados: 0, cancelados: 0, semFornecedor: true };
  const [itens, existentes] = await Promise.all([
    db.select().from(schema.produtos).where(eq(schema.produtos.pedidoId, pedidoId)),
    db.select().from(schema.creditosFornecedor).where(eq(schema.creditosFornecedor.pedidoId, pedidoId)),
  ]);
  const necessidades = itens.flatMap((p) => {
    const d = divergencia(p);
    if (!d.conferida) return [];
    const descricao = descricaoCredito({ linha: p.linha, codigo: p.codigoFornecedor, especificacao: especificacaoDaLinha(p), nome: p.nome ?? p.traducao, falta: d.falta, defeito: d.defeito, sobra: d.sobra });
    return [{ produtoId: p.id, quantidade: d.aCreditar, preco: p.precoOrigem ?? 0, descricao }];
  });
  const plano = planejarCreditos(necessidades, existentes, pedido.moeda);
  const agora = new Date().toISOString();
  const t = schema.creditosFornecedor;
  await emLote([
    ...plano.criar.map((c) =>
      db.insert(t).values({ id: randomUUID(), fornecedorChave: chave, fornecedor: pedido.fornecedor, pedidoId, produtoId: c.produtoId, descricao: c.descricao, quantidade: c.quantidade, valorMoeda: c.valorMoeda, moeda: pedido.moeda, status: "aberto" }),
    ),
    ...plano.atualizar.map((c) =>
      db
        .update(t)
        .set({ quantidade: c.quantidade, valorMoeda: c.valorMoeda, descricao: c.descricao, moeda: pedido.moeda, status: "aberto", abatidoPedidoId: null, fornecedorChave: chave, fornecedor: pedido.fornecedor, atualizadoEm: agora })
        .where(and(eq(t.id, c.id), inArray(t.status, ["aberto", "cancelado"]))),
    ),
    ...plano.cancelar.map((c) => db.update(t).set({ status: "cancelado", quantidade: 0, valorMoeda: 0, descricao: c.descricao, atualizadoEm: agora }).where(and(eq(t.id, c.id), eq(t.status, "aberto")))),
  ]);
  return { criados: plano.criar.length, atualizados: plano.atualizar.length, cancelados: plano.cancelar.length, semFornecedor: false };
}

export class ErroCredito extends Error {
  constructor(
    mensagem: string,
    readonly status = 400,
  ) {
    super(mensagem);
  }
}

/**
 * Abater (no pedido informado), cancelar ou reabrir um crédito.
 * Devolve os pedidos cuja cotação efetiva pode ter mudado (o crédito abatido entra no cálculo dela).
 */
export async function alterarCredito(id: string, acao: "abater" | "cancelar" | "reabrir", pedidoId?: string | null) {
  const db = await getDb();
  const t = schema.creditosFornecedor;
  const [c] = await db.select().from(t).where(eq(t.id, id));
  if (!c) throw new ErroCredito("Crédito não encontrado.", 404);
  const agora = new Date().toISOString();
  if (acao === "abater") {
    if (!pedidoId) throw new ErroCredito("Informe em qual pedido abater o crédito.");
    const [p] = await db
      .select({ id: schema.pedidos.id, numero: schema.pedidos.numero, moeda: schema.pedidos.moeda, fornecedor: schema.pedidos.fornecedor, dataCompra: schema.pedidos.dataCompra })
      .from(schema.pedidos)
      .where(eq(schema.pedidos.id, pedidoId));
    if (!p) throw new ErroCredito("Pedido não encontrado.", 404);
    const origem = c.pedidoId ? (await pedidosDosCreditos([c.pedidoId])).get(c.pedidoId) : null;
    const motivo = motivoNaoAbater(c, p, origem);
    if (motivo) throw new ErroCredito(motivo);
    await db.update(t).set({ status: "abatido", abatidoPedidoId: p.id, atualizadoEm: agora }).where(and(eq(t.id, id), eq(t.status, "aberto")));
    return { credito: c, pedidosAfetados: [p.id], resumo: `Crédito abatido no pedido ${p.numero ?? p.id.slice(0, 8)}: ${c.descricao} (${textoValorMoeda(c.valorMoeda, c.moeda)})` };
  }
  if (acao === "cancelar") {
    if (c.status === "abatido") throw new ErroCredito("Este crédito já foi abatido em um pedido. Desfaça o abatimento antes de cancelar.");
    if (c.status === "cancelado") throw new ErroCredito("Este crédito já está cancelado.");
    await db.update(t).set({ status: "cancelado", atualizadoEm: agora }).where(and(eq(t.id, id), eq(t.status, "aberto")));
    return { credito: c, pedidosAfetados: [] as string[], resumo: `Crédito cancelado: ${c.descricao} (${textoValorMoeda(c.valorMoeda, c.moeda)})` };
  }
  // Reabrir: desfaz o abatimento ou o cancelamento.
  if (c.status === "aberto") throw new ErroCredito("Este crédito já está em aberto.");
  if (c.status === "cancelado" && !(c.quantidade > 0)) throw new ErroCredito("Este crédito foi zerado na conferência (a falta foi corrigida). Se a peça faltou, corrija a conferência do pedido.");
  await db.update(t).set({ status: "aberto", abatidoPedidoId: null, atualizadoEm: agora }).where(eq(t.id, id));
  return {
    credito: c,
    pedidosAfetados: c.abatidoPedidoId ? [c.abatidoPedidoId] : [],
    resumo: `${c.status === "abatido" ? "Abatimento desfeito" : "Crédito reaberto"}: ${c.descricao} (${textoValorMoeda(c.valorMoeda, c.moeda)})`,
  };
}

/* ------------------------------------------------- pagamento e cotação efetiva */

export const FONTE_EFETIVA = "Cotação efetiva (valor pago ÷ total do pedido)";
export const FONTE_PTAX_GUARDADA = "PTAX guardada (antes da cotação efetiva)";

/** Total do pedido na moeda (Σ preço × quantidade) e créditos abatidos nele (mesma moeda). */
export async function basePagamento(pedidoId: string, moeda: string) {
  const db = await getDb();
  const [[{ total }], abatidos] = await Promise.all([
    db
      .select({ total: sql<number>`coalesce(sum(coalesce(${schema.produtos.precoOrigem}, 0) * ${schema.produtos.quantidade}), 0)` })
      .from(schema.produtos)
      .where(eq(schema.produtos.pedidoId, pedidoId)),
    db
      .select({ status: schema.creditosFornecedor.status, abatidoPedidoId: schema.creditosFornecedor.abatidoPedidoId, moeda: schema.creditosFornecedor.moeda, valorMoeda: schema.creditosFornecedor.valorMoeda })
      .from(schema.creditosFornecedor)
      .where(eq(schema.creditosFornecedor.abatidoPedidoId, pedidoId)),
  ]);
  return { totalMoeda: Math.round(Number(total) * 100) / 100, abatidosMoeda: somaAbatida(abatidos, pedidoId, moeda) };
}

/**
 * Com a cotação efetiva em uso (PTAX guardada e a fonte "Cotação efetiva"), recalcula a efetiva depois de
 * mudar o valor pago, o total ou os créditos abatidos. Sem pagamento, volta para a PTAX.
 * Se a cotação foi trocada depois (botão PTAX, digitada), não mexe. Retorna true se a cotação mudou
 * (aí a rota chama recalcularPedido).
 */
export async function reaplicarCotacaoEfetiva(pedidoId: string): Promise<boolean> {
  const db = await getDb();
  const [p] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, pedidoId));
  if (!p || p.cotacaoPtax == null || p.moeda === "BRL" || p.cotacaoFonte !== FONTE_EFETIVA) return false;
  const { totalMoeda, abatidosMoeda } = await basePagamento(pedidoId, p.moeda);
  const efetiva = cotacaoEfetiva({ moeda: p.moeda, valorPagoBrl: p.valorPagoBrl, totalMoeda, abatidosMoeda });
  if (efetiva == null) {
    await db
      .update(schema.pedidos)
      .set({ cotacao: p.cotacaoPtax, cotacaoPtax: null, cotacaoFonte: FONTE_PTAX_GUARDADA, custos: custosSemEfetiva(p.custos) })
      .where(eq(schema.pedidos.id, pedidoId));
    return true;
  }
  if (Math.abs(efetiva - p.cotacao) <= 1e-6) return false;
  await db
    .update(schema.pedidos)
    .set({ cotacao: efetiva, cotacaoData: p.pagoEm ?? p.cotacaoData })
    .where(eq(schema.pedidos.id, pedidoId));
  return true;
}
