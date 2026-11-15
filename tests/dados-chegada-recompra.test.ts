import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analisarVendas,
  chaveSku,
  chegadaDe,
  compararEstoqueUp,
  estoqueDoCatalogo,
  faixasDePreco,
  freiosRecompra,
  indexarProdutos,
  leituraAbc,
  ligarVenda,
  limitesFaixas,
  necessidadeRecompra,
  normalizarCodigo,
  produtoNoUp,
  resumoPorFaixa,
  ritmoDeVenda,
  totaisRecompra,
  type ProdutoBase,
  type VendaBase,
} from "../src/lib/vendas-calculo";

/* Códigos e nomes fictícios. */
let seq = 0;
function produto(p: Partial<ProdutoBase> = {}): ProdutoBase {
  seq++;
  return {
    id: `p${seq}`,
    codigoBarras: `78900000${String(seq).padStart(5, "0")}`,
    referencia: `ABC${String(seq).padStart(3, "0")}A`,
    codigoFornecedor: `F${seq}`,
    nome: `PEÇA ${seq}`,
    nomeComercial: null,
    tipo: "brinco",
    quantidade: 10,
    precoVenda: 80,
    custoTotalBrl: 8,
    imagemId: null,
    destaque: false,
    criadoEm: "2026-01-01T00:00:00.000Z",
    recompraDe: null,
    linha: seq,
    fornecedor: "Fornecedor Teste",
    dataPedido: "2026-01-01",
    codigoBarrasOrigem: "up",
    ...p,
  };
}
const venda = (p: ProdutoBase, quantidade: number, data: string, extra: Partial<VendaBase> = {}): VendaBase => ({
  data,
  referencia: null,
  codigoBarras: p.codigoBarras,
  produtoId: null,
  quantidade,
  valorTotal: (p.precoVenda ?? 0) * quantidade,
  revendedora: "Revendedora A",
  ...extra,
});
const HOJE = "2026-11-15";
const PARAMS = { hoje: HOJE, prazoReposicaoDias: 45, diasEstoqueParado: 120 };

/* ------------------------------------------------------------ item 4 */

test("Ligação da venda: código de barras primeiro, depois o produto gravado, depois a referência", () => {
  const a = produto({ referencia: "ABC123A" });
  const b = produto({ referencia: "ABC123B" });
  const idx = indexarProdutos([a, b]);
  // O código manda, mesmo com produtoId e referência de outro produto.
  assert.equal(ligarVenda({ codigoBarras: a.codigoBarras, referencia: "ABC123B", produtoId: b.id }, idx).produto?.id, a.id);
  // Sem código (ou código desconhecido): o produto gravado na importação vence a referência.
  const porId = ligarVenda({ codigoBarras: "0000", referencia: "ABC123A", produtoId: b.id }, idx);
  assert.equal(porId.por, "id");
  assert.equal(porId.produto?.id, b.id);
  // Produto gravado que não existe mais: cai na referência.
  assert.equal(ligarVenda({ codigoBarras: null, referencia: "abc123a", produtoId: "apagado" }, idx).por, "referencia");
});

test("Chave do SKU: sem código, a recompra sobe a cadeia até o original (e soma com ele)", () => {
  const original = produto({ codigoBarras: null, referencia: "ABC200A" });
  const recompra = produto({ codigoBarras: null, referencia: "ABC200A", recompraDe: original.id, criadoEm: "2026-03-01T00:00:00.000Z" });
  const recompra2 = produto({ codigoBarras: null, referencia: "ABC200A", recompraDe: recompra.id, criadoEm: "2026-05-01T00:00:00.000Z" });
  const idx = indexarProdutos([recompra2, recompra, original]);
  assert.equal(chaveSku(recompra2, idx), `id:${original.id}`);
  assert.equal(idx.chaves.get(recompra.id), `id:${original.id}`);
  // Sem código mas com um antecessor que tem: fica com o código dele.
  const comCodigo = produto({ referencia: "ABC201A" });
  const filha = produto({ codigoBarras: null, referencia: "ABC201A", recompraDe: comCodigo.id });
  assert.equal(chaveSku(filha, indexarProdutos([comCodigo, filha])), comCodigo.codigoBarras);
  // Cadeia com ciclo não trava.
  const x = produto({ id: "x", codigoBarras: null, recompraDe: "y" });
  const y = produto({ id: "y", codigoBarras: null, recompraDe: "x" });
  assert.match(chaveSku(x, indexarProdutos([x, y])), /^id:/);

  const a = analisarVendas([original, recompra, recompra2], [{ ...venda(original, 3, "2026-06-01"), codigoBarras: null, referencia: "ABC200A" }], PARAMS);
  assert.equal(a.skus.length, 1);
  assert.equal(a.skus[0].comprado, 30);
  assert.equal(a.skus[0].estoque, 27);
});

/* ------------------------------------------------------- itens 8 e 23 */

test("Chegada: recebido/conferido chegou; em trânsito ou data futura não; sem informação conta como chegado (estimada)", () => {
  const base = { criadoEm: "2026-01-01T00:00:00.000Z", dataPedido: "2026-02-01" };
  assert.deepEqual(chegadaDe({ ...base, recebimento: "conferido", dataChegada: "2026-03-10" }, HOJE), { chegou: true, data: "2026-03-10", estimada: false, prevista: null });
  assert.equal(chegadaDe({ ...base, recebimento: "recebido" }, HOJE).chegou, true);
  assert.equal(chegadaDe({ ...base, recebimento: "recebido" }, HOJE).estimada, true);
  assert.equal(chegadaDe({ ...base, recebimento: "recebido", conferidoEm: "2026-03-20T15:00:00.000Z" }, HOJE).data, "2026-03-20");
  assert.equal(chegadaDe({ ...base, recebimento: "em_transito", dataChegada: "2026-11-01" }, HOJE).chegou, false);
  assert.deepEqual(chegadaDe({ ...base, dataChegada: "2026-12-01" }, HOJE), { chegou: false, data: null, estimada: false, prevista: "2026-12-01" });
  assert.equal(chegadaDe({ ...base, dataChegada: "2026-11-15" }, HOJE).chegou, true);
  assert.deepEqual(chegadaDe(base, HOJE), { chegou: true, data: "2026-02-01", estimada: true, prevista: null });
});

test("Estoque: só pedidos que chegaram, pela entrada conferida (recebida − defeito); o resto fica a caminho", () => {
  const original = produto({ quantidade: 10, quantidadeRecebida: 9, quantidadeDefeito: 1, recebimento: "conferido", dataChegada: "2026-06-01", dataPedido: "2026-05-01" });
  const recompra = produto({ codigoBarras: original.codigoBarras, referencia: original.referencia, recompraDe: original.id, quantidade: 20, recebimento: "em_transito", dataPedido: "2026-11-01" });
  const vendas = [venda(original, 6, "2026-10-01")];
  const a = analisarVendas([original, recompra], vendas, PARAMS);
  const s = a.skus[0];
  assert.equal(s.comprado, 8);
  assert.equal(s.aCaminho, 20);
  assert.equal(s.estoque, 2);
  assert.equal(s.dataEntrada, "2026-06-01"); // giro conta da chegada, não da compra
  assert.equal(s.dataEntradaEstimada, false);
  assert.equal(s.idadeDias, 167);
  assert.deepEqual(a.aCaminho, { skus: 1, pecas: 20 });

  // Pedido novo a caminho, sem venda: nem aparece (não está na loja).
  const caminho = produto({ recebimento: "em_transito" });
  assert.equal(analisarVendas([caminho], [], PARAMS).skus.length, 0);
  // Pedido antigo sem informação: chegou, na data da compra (estimada).
  const antigo = produto({ dataPedido: "2026-02-10" });
  const sAntigo = analisarVendas([antigo], [], PARAMS).skus[0];
  assert.equal(sAntigo.comprado, 10);
  assert.equal(sAntigo.dataEntrada, "2026-02-10");
  assert.equal(sAntigo.dataEntradaEstimada, true);
});

test("Existe no UP: código do UP, enviado, código nos saldos/consignado ou com venda; disponível desconta as revendedoras", () => {
  const codigos = new Set([normalizarCodigo("0007890000012345")]);
  assert.ok(produtoNoUp({ codigoBarras: "1", codigoBarrasOrigem: "up", upStatus: null }, new Set()));
  assert.ok(produtoNoUp({ codigoBarras: "1", codigoBarrasOrigem: "app", upStatus: "enviado" }, new Set()));
  assert.ok(produtoNoUp({ codigoBarras: "7890000012345", codigoBarrasOrigem: "app", upStatus: null }, codigos)); // zeros à esquerda não importam
  assert.ok(produtoNoUp({ codigoBarras: "9100000005029", codigoBarrasOrigem: "app", upStatus: null }, new Set(["502"]))); // Code128 curto
  assert.ok(!produtoNoUp({ codigoBarras: "7890000099999", codigoBarrasOrigem: "app", upStatus: null }, codigos));

  const foraDoUp = produto({ codigoBarrasOrigem: "app" });
  const vendida = produto({ codigoBarrasOrigem: "app" });
  const comMaleta = produto();
  const a = analisarVendas([foraDoUp, vendida, comMaleta], [venda(vendida, 1, "2026-10-01")], { ...PARAMS, comRevendedoras: new Map([[comMaleta.codigoBarras!, 4]]) });
  const por = (p: ProdutoBase) => a.skus.find((s) => s.produtoId === p.id)!;
  assert.equal(por(foraDoUp).noUp, false);
  assert.equal(por(vendida).noUp, true); // apareceu nas vendas do UP
  assert.equal(por(comMaleta).comRevendedoras, 4);
  assert.equal(por(comMaleta).disponivel, 6);
  assert.equal(a.totais.comRevendedoras, 4);
});

/* ------------------------------------------------------------ item 31 */

test("Curva ABC sem as peças novas (menos de diasForaDaCurva dias desde a chegada)", () => {
  const velha = produto({ dataPedido: "2026-03-01" });
  const nova = produto({ recebimento: "recebido", dataChegada: "2026-10-20" });
  const vendas = [venda(velha, 5, "2026-09-01"), venda(nova, 8, "2026-11-01")];
  const a = analisarVendas([velha, nova], vendas, { ...PARAMS, diasForaDaCurva: 60 });
  const sNova = a.skus.find((s) => s.produtoId === nova.id)!;
  const sVelha = a.skus.find((s) => s.produtoId === velha.id)!;
  assert.equal(sNova.curva, null);
  assert.equal(sNova.nova, true);
  assert.equal(sVelha.curva, "A");
  assert.equal(sVelha.participacao, 1); // a curva só divide entre as que entram nela
  assert.deepEqual(a.novas, { skus: 1, receita: 640 });
  assert.equal(a.abc.A.skus, 1);
  assert.equal(sNova.leitura, "nova e vende rápido: recomprar");
  // Sem o parâmetro, todas entram (como antes).
  assert.equal(analisarVendas([velha, nova], vendas, PARAMS).skus.every((s) => s.curva), true);
});

test("Leitura ABC × sell-through: texto curto e a ação", () => {
  assert.equal(ritmoDeVenda({ sellThrough: 0.6, vendido: 6, idadeDias: 30, status: "repor" }), "rapido");
  assert.equal(ritmoDeVenda({ sellThrough: 0.6, vendido: 6, idadeDias: 150, status: "ok" }), "normal");
  assert.equal(ritmoDeVenda({ sellThrough: 0.3, vendido: 3, idadeDias: 200, status: "ok" }), "lento");
  assert.equal(ritmoDeVenda({ sellThrough: 0.1, vendido: 1, idadeDias: 120, status: "ok" }), "encalhado");
  assert.equal(ritmoDeVenda({ sellThrough: 0.5, vendido: 5, idadeDias: 30, status: "parado" }), "encalhado");
  assert.deepEqual(leituraAbc("A", "rapido", 60), { leitura: "A e vende rápido: recomprar", acao: "recomprar" });
  assert.deepEqual(leituraAbc("C", "encalhado", 60), { leitura: "C e encalhada: não recomprar", acao: "nao_recomprar" });
  assert.equal(leituraAbc("B", "normal", 60).acao, "recomprar_pouco");
  assert.equal(leituraAbc(null, "lento", 60).leitura, "nova (menos de 60 dias): avaliar depois");
});

test("Freios: a caminho desconta, leitura segura, teto por modelo e lote do fornecedor arredondando para cima", () => {
  assert.equal(necessidadeRecompra(0.2, 45, 3), 20); // 0,2 × 45 × 2,5 = 22,5 → 23 − 3
  assert.equal(necessidadeRecompra(0.2, 45, 3, 25), 0); // a chegada já cobre
  const base = { necessidade: 20, estoque: 3, aCaminho: 0, acao: "recomprar" as const, leitura: "A e vende rápido: recomprar" };
  assert.deepEqual(freiosRecompra(base), { quantidade: 20, freios: [] });
  assert.deepEqual(freiosRecompra({ ...base, teto: 13 }), { quantidade: 10, freios: ["teto de 13 por modelo"] });
  assert.deepEqual(freiosRecompra({ ...base, teto: 13, lote: 6 }), { quantidade: 12, freios: ["teto de 13 por modelo", "lote de 6 (passa do teto)"] });
  assert.deepEqual(freiosRecompra({ ...base, lote: 6 }), { quantidade: 24, freios: ["lote de 6"] });
  assert.deepEqual(freiosRecompra({ ...base, acao: "nao_recomprar", leitura: "C e vende devagar: não recomprar" }), { quantidade: 0, freios: ["C e vende devagar: não recomprar"] });
  assert.equal(freiosRecompra({ ...base, acao: "recomprar_pouco", leitura: "B e vende no ritmo: recomprar pouco" }).quantidade, 10);
  assert.deepEqual(freiosRecompra({ ...base, necessidade: 0, aCaminho: 5 }), { quantidade: 0, freios: ["5 peças a caminho"] });
  assert.equal(freiosRecompra({ ...base, estoque: 15, teto: 13 }).quantidade, 0); // já está no teto
});

test("Recompra na análise: lote do fornecedor, teto e totais em ¥ e R$ contra o orçamento", () => {
  const giro = produto({ quantidade: 10, dataPedido: "2026-08-17", precoOrigem: 4, moeda: "CNY", custoTotalBrl: 9, fornecedor: "Fornecedor Teste" });
  const outro = produto({ quantidade: 10, dataPedido: "2026-08-17", precoOrigem: 2, moeda: "CNY", custoTotalBrl: 5, fornecedor: "Outro Fornecedor", tipo: "colar" });
  const vendas = [venda(giro, 9, "2026-11-10"), venda(outro, 10, "2026-11-10")];
  const a = analisarVendas([giro, outro], vendas, {
    ...PARAMS,
    recompra: { tetoPorModelo: 13, loteMinimoPadrao: 1, loteDoFornecedor: (f) => (f === "Fornecedor Teste" ? 6 : null) },
  });
  const sGiro = a.skus.find((s) => s.produtoId === giro.id)!;
  const sOutro = a.skus.find((s) => s.produtoId === outro.id)!;
  // 9 vendidas em 90 dias: 0,1/dia × 45 × 2,5 = 11,25 → 12 − 1 = 11; teto 13 − 1 = 12; lote 6 → 12.
  assert.equal(sGiro.status, "repor");
  assert.equal(sGiro.necessidade, 11);
  assert.equal(sGiro.quantidadeSugerida, 12);
  assert.equal(sGiro.lote, 6);
  assert.ok(sGiro.freios.includes("lote de 6"));
  // Esgotada: 10/90 × 45 × 2,5 = 12,5 → 13, no teto (13 − 0).
  assert.equal(sOutro.status, "esgotado");
  assert.equal(sOutro.quantidadeSugerida, 13);
  assert.equal(a.parametros.tetoPorModelo, 13);

  const t = totaisRecompra([sGiro, sOutro], 150);
  assert.equal(t.pecas, 25);
  assert.equal(t.brl, 12 * 9 + 13 * 5);
  assert.deepEqual(t.moeda, { CNY: 12 * 4 + 13 * 2 });
  assert.equal(t.excesso, 12 * 9 + 13 * 5 - 150);
  assert.deepEqual(
    t.porFornecedor.map((f) => [f.chave, f.pecas, f.brl]),
    [
      ["Fornecedor Teste", 12, 108],
      ["Outro Fornecedor", 13, 65],
    ],
  );
  assert.deepEqual(
    t.porTipo.map((x) => x.chave),
    ["brinco", "colar"],
  );
  assert.equal(totaisRecompra([sGiro], 0).excesso, 0); // 0 = sem orçamento

  // Lote do fornecedor (mesmo 1 = sem arredondar) vence o padrão da loja; sem lote próprio, vale o padrão.
  const comPadrao6 = analisarVendas([giro, outro], vendas, {
    ...PARAMS,
    recompra: { tetoPorModelo: 0, loteMinimoPadrao: 6, loteDoFornecedor: (f) => (f === "Fornecedor Teste" ? 1 : null) },
  });
  assert.equal(comPadrao6.skus.find((s) => s.produtoId === giro.id)!.lote, 1);
  assert.equal(comPadrao6.skus.find((s) => s.produtoId === giro.id)!.quantidadeSugerida, 11);
  assert.equal(comPadrao6.skus.find((s) => s.produtoId === outro.id)!.lote, 6);
  assert.equal(comPadrao6.skus.find((s) => s.produtoId === outro.id)!.quantidadeSugerida, 18); // 13 → lote de 6
});

/* ------------------------------------------------------------ item 29 */

test("Faixas de preço: limites da configuração, sell-through, faturamento e margem por faixa", () => {
  assert.deepEqual(limitesFaixas([250, "60", 120, -1, 60]), [60, 120, 250]);
  assert.deepEqual(limitesFaixas(null), [60, 120, 250]);
  assert.deepEqual(
    faixasDePreco([60, 120, 250]).map((f) => f.nome),
    ["até R$ 60", "de R$ 60 a R$ 120", "de R$ 120 a R$ 250", "acima de R$ 250"],
  );
  const barata = produto({ precoVenda: 60, custoTotalBrl: 6 }); // 60 entra em "até R$ 60"
  const media = produto({ precoVenda: 100, custoTotalBrl: 20 });
  const cara = produto({ precoVenda: 300, custoTotalBrl: 30 });
  const semPreco = produto({ precoVenda: null });
  const a = analisarVendas([barata, media, cara, semPreco], [venda(barata, 5, "2026-10-01"), venda(media, 2, "2026-10-01", { valorTotal: 180 })], PARAMS);
  const f = resumoPorFaixa(a.skus, [60, 120, 250]);
  assert.deepEqual(
    f.map((x) => [x.nome, x.skus, x.vendido]),
    [
      ["até R$ 60", 1, 5],
      ["de R$ 60 a R$ 120", 1, 2],
      ["de R$ 120 a R$ 250", 0, 0],
      ["acima de R$ 250", 1, 0],
      ["sem preço", 1, 0],
    ],
  );
  assert.equal(f[0].sellThrough, 0.5);
  assert.equal(f[0].receita, 300);
  assert.equal(f[0].margem, 0.9); // (300 − 5 × 6) ÷ 300
  assert.equal(f[1].margem, 0.7778); // (180 − 2 × 20) ÷ 180
  assert.equal(f[2].margem, null);
});

/* ------------------------------------------------------------ item 25 */

test("Estoque × UP: esperado pelo app × saldo, diferenças das maiores para as menores", () => {
  const a1 = produto({ quantidade: 10 });
  const a2 = produto({ quantidade: 5 });
  const a3 = produto({ quantidade: 3 });
  const a4 = produto({ quantidade: 2 });
  const interno = produto({ codigoBarras: "9100000005029", quantidade: 4 });
  const a = analisarVendas([a1, a2, a3, a4, interno], [venda(a1, 4, "2026-10-01")], PARAMS);
  const c = compararEstoqueUp(a.skus, [
    { codigoBarras: a1.codigoBarras!, saldo: 6 }, // igual (10 − 4)
    { codigoBarras: `00${a2.codigoBarras}`, saldo: 1 }, // −4
    { codigoBarras: a3.codigoBarras!, saldo: 5 }, // +2
    { codigoBarras: "00000502", saldo: 4 }, // curto do EAN interno: igual
    { codigoBarras: "7899999999999", saldo: 7 }, // fora do app
  ]);
  assert.equal(c.comparados, 4);
  assert.equal(c.iguais, 2);
  assert.deepEqual(
    c.itens.map((d) => [d.produtoId, d.esperado, d.saldoUp, d.diferenca]),
    [
      [a2.id, 5, 1, -4],
      [a3.id, 3, 5, 2],
    ],
  );
  assert.equal(c.semSaldo, 1); // a4 não está no arquivo
  assert.equal(c.foraDoApp, 1);

  // Catálogo: saldo do UP vence; sem saldo, entrada − vendidas; recompra divide o mesmo número.
  const idx = indexarProdutos([a1, a4]);
  const e = estoqueDoCatalogo(analisarVendas([a1, a4], [venda(a1, 4, "2026-10-01")], PARAMS).skus, [{ codigoBarras: a1.codigoBarras!, saldo: 5 }], idx);
  assert.deepEqual(e.get(a1.id), { chave: a1.codigoBarras, estoque: 5, fonte: "up" });
  assert.deepEqual(e.get(a4.id), { chave: a4.codigoBarras, estoque: 2, fonte: "app" });
});
