import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analisarVendas,
  acharLinhaCabecalho,
  converterLinhas,
  curvaAbc,
  impressaoDigital,
  indexarProdutos,
  lerCsv,
  lerData,
  lerNumero,
  ligarVenda,
  pontoReposicao,
  quantidadeSugerida,
  sellThrough,
  statusReposicao,
  sugerirMapeamento,
  type ProdutoBase,
  type VendaBase,
} from "../src/lib/vendas-calculo";
import { faixaDe, plural, sugerirMaleta, type VendaMaleta } from "../src/lib/maleta-calculo";
import { montarEan13 } from "../src/lib/codigos";

/* ------------------------------------------------------------ fábrica */

let seq = 0;
function produto(p: Partial<ProdutoBase> = {}): ProdutoBase {
  seq++;
  return {
    id: `p${seq}`,
    codigoBarras: `9100000000${String(seq).padStart(3, "0")}`,
    referencia: `BR_2611${String(seq).padStart(3, "0")}`,
    codigoFornecedor: `F${seq}`,
    nome: `PEÇA ${seq}`,
    nomeComercial: null,
    tipo: "brinco",
    quantidade: 10,
    precoVenda: 50,
    custoTotalBrl: 5,
    imagemId: null,
    destaque: false,
    criadoEm: "2026-01-01T00:00:00.000Z",
    recompraDe: null,
    linha: seq,
    fornecedor: "Yiwu",
    dataPedido: "2026-01-01",
    ...p,
  };
}
const venda = (p: ProdutoBase, quantidade: number, data = "2026-03-01", extra: Partial<VendaBase> = {}): VendaBase => ({
  data,
  referencia: null,
  codigoBarras: p.codigoBarras,
  produtoId: null,
  quantidade,
  valorTotal: (p.precoVenda ?? 0) * quantidade,
  revendedora: "Ana",
  ...extra,
});
const PARAMS = { hoje: "2026-04-11", prazoReposicaoDias: 45, diasEstoqueParado: 120 };

/* ------------------------------------------------------- leitura da planilha */

test("Mapeamento sugerido pelo nome da coluna, sem acento e sem maiúsculas", () => {
  const m = sugerirMapeamento(["Data", "Ref.", "Cód. Barras", "Descrição", "Qtd", "Valor Total", "Vendedora", "Tipo"]);
  assert.deepEqual(m, { data: 0, referencia: 1, codigoBarras: 2, descricao: 3, quantidade: 4, valorTotal: 5, revendedora: 6, canal: 7 });
  const m2 = sugerirMapeamento(["EAN", "Produto", "QUANTIDADE", "Preço Unitário", "Total", "Consultora", "DATA DA VENDA"]);
  assert.equal(m2.codigoBarras, 0);
  assert.equal(m2.descricao, 1);
  assert.equal(m2.valorUnitario, 3);
  assert.equal(m2.valorTotal, 4);
  assert.equal(m2.revendedora, 5);
  assert.equal(m2.data, 6);
});

test("Números e datas no formato brasileiro", () => {
  assert.equal(lerNumero("1.234,56"), 1234.56);
  assert.equal(lerNumero("R$ 12,90"), 12.9);
  assert.equal(lerNumero("1234.5"), 1234.5);
  assert.equal(lerNumero("1.234"), 1234);
  assert.equal(lerNumero("0.500"), 0.5);
  assert.equal(lerNumero("(10,00)"), -10);
  assert.equal(lerNumero("abc"), null);
  assert.equal(lerData("14/11/2026"), "2026-11-14");
  assert.equal(lerData("14/11/26 10:30"), "2026-11-14");
  assert.equal(lerData("2026-11-14T13:00:00"), "2026-11-14");
  assert.equal(lerData("31/02/2026"), null);
  assert.equal(lerData(46340), "2026-11-14"); // número de série do Excel
  assert.equal(lerData(new Date(Date.UTC(2026, 10, 14))), "2026-11-14");
});

test("CSV com ';', aspas e título antes do cabeçalho", () => {
  const csv = 'Relatório de vendas;;\n\nData;Referência;Qtd;Valor\n01/03/2026;"BR;01";2;"1.234,50"\n';
  const linhas = lerCsv(csv);
  assert.equal(linhas.length, 4);
  assert.deepEqual(linhas[3], ["01/03/2026", "BR;01", "2", "1.234,50"]);
  assert.equal(acharLinhaCabecalho(linhas), 2);
});

test("Conversão das linhas: motivos das ignoradas e preço unitário × quantidade", () => {
  const mapa = { data: 0, referencia: 1, quantidade: 2, valorUnitario: 3 };
  const { vendas, ignoradas } = converterLinhas(
    [
      ["01/03/2026", "BR_1", "2", "30,00"],
      ["", "BR_2", "1", "10"],
      ["02/03/2026", "", "1", "10"],
      ["", "", "", "Total: 70"],
      ["03/03/2026", "BR_3", "0", "10"],
      [],
    ],
    mapa,
    { primeiraLinha: 2 },
  );
  assert.equal(vendas.length, 1);
  assert.equal(vendas[0].valorTotal, 60);
  assert.deepEqual(
    ignoradas.map((i) => [i.linha, i.motivo]),
    [
      [3, "sem data"],
      [4, "sem referência nem código de barras"],
      [5, "linha de total"],
      [6, "quantidade zero"],
    ],
  );
  const comPadrao = converterLinhas([["", "BR_2", "1", "10"]], mapa, { dataPadrao: "2026-03-31" });
  assert.equal(comPadrao.vendas[0].data, "2026-03-31");
});

test("Ligação: EAN primeiro, depois a referência (primeira variação); recompra usa o EAN do original", () => {
  const a = produto({ referencia: "AN_1", codigoBarras: "9100000000501" });
  const b = produto({ referencia: "AN_1", codigoBarras: montarEan13("91", 502), criadoEm: "2026-01-02T00:00:00.000Z" }); // 9100 + 00000502 + DV
  const recompra = produto({ referencia: "AN_1", codigoBarras: "9100000000501", recompraDe: a.id, criadoEm: "2025-12-01T00:00:00.000Z" });
  const idx = indexarProdutos([recompra, b, a]);
  assert.equal(ligarVenda({ codigoBarras: b.codigoBarras, referencia: null, produtoId: null }, idx).produto?.id, b.id);
  assert.equal(ligarVenda({ codigoBarras: "9100000000501", referencia: null, produtoId: null }, idx).produto?.id, a.id);
  const porRef = ligarVenda({ codigoBarras: "999", referencia: "an_1", produtoId: null }, idx);
  assert.equal(porRef.por, "referencia");
  assert.equal(porRef.produto?.id, a.id);
  // Code128 curto do UP (8 dígitos da sequência)
  assert.equal(ligarVenda({ codigoBarras: "502", referencia: null, produtoId: null }, idx).produto?.id, b.id);
});

test("Impressão digital ignora diferenças de maiúsculas e espaços na revendedora", () => {
  const base = { data: "2026-03-01", referencia: "br_1", codigoBarras: null, quantidade: 1, valorTotal: 10 };
  assert.equal(impressaoDigital({ ...base, revendedora: "Maria  Silva" }), impressaoDigital({ ...base, referencia: "BR_1", revendedora: "MARIA SILVA" }));
});

/* ------------------------------------------------------------ regras */

test("Sell-through = vendido ÷ comprado, limitado a 100%", () => {
  assert.equal(sellThrough(3, 10), 0.3);
  assert.equal(sellThrough(12, 10), 1);
  assert.equal(sellThrough(0, 0), 0);
  assert.equal(sellThrough(2, 0), 1);
});

test("Ponto de reposição = média diária × prazo × 1,5 e quantidade sugerida", () => {
  assert.equal(pontoReposicao(0.2, 45), 13.5);
  // alvo = 0,2 × 45 × 2,5 = 22,5 → 23 − estoque 3 = 20
  assert.equal(quantidadeSugerida(0.2, 45, 3), 20);
  assert.equal(quantidadeSugerida(0.001, 45, 5), 1); // mínimo 1
});

test("Status de reposição: esgotado, parado (vence o repor), repor e ok", () => {
  const st = (s: { comprado: number; vendido: number; estoque: number; ponto: number; diasSemVenda: number }) => statusReposicao(s, 120);
  assert.equal(st({ comprado: 10, vendido: 10, estoque: 0, ponto: 5, diasSemVenda: 3 }), "esgotado");
  assert.equal(st({ comprado: 10, vendido: 8, estoque: 2, ponto: 5, diasSemVenda: 3 }), "repor");
  assert.equal(st({ comprado: 10, vendido: 8, estoque: 2, ponto: 5, diasSemVenda: 200 }), "parado");
  assert.equal(st({ comprado: 10, vendido: 0, estoque: 10, ponto: 0, diasSemVenda: 121 }), "parado");
  assert.equal(st({ comprado: 10, vendido: 0, estoque: 10, ponto: 0, diasSemVenda: 30 }), "ok");
  assert.equal(st({ comprado: 10, vendido: 1, estoque: 9, ponto: 1, diasSemVenda: 10 }), "ok");
});

test("Curva ABC: A até 80% da receita acumulada, B até 95%, C o resto", () => {
  const r = curvaAbc([
    { id: "c", receita: 10 },
    { id: "a", receita: 50 },
    { id: "e", receita: 5 },
    { id: "b", receita: 30 },
    { id: "d", receita: 5 },
    { id: "z", receita: 0 },
  ]);
  assert.deepEqual(
    r.map((x) => [x.id, x.curva]),
    [
      ["a", "A"],
      ["b", "A"],
      ["c", "B"],
      ["e", "B"],
      ["d", "C"],
      ["z", "C"],
    ],
  );
  assert.equal(r[1].acumulado, 0.8);
  // Uma peça sozinha com 90% da receita continua A.
  assert.deepEqual(
    curvaAbc([
      { receita: 90 },
      { receita: 10 },
    ]).map((x) => x.curva),
    ["A", "B"],
  );
});

test("Análise por SKU: recompra soma no comprado do mesmo EAN; status e período", () => {
  const giro = produto({ quantidade: 10, dataPedido: "2026-01-11" }); // 90 dias até 11/04
  const recompra = produto({ codigoBarras: giro.codigoBarras, referencia: giro.referencia, quantidade: 5, recompraDe: giro.id, dataPedido: "2026-03-01" });
  const parado = produto({ quantidade: 6, dataPedido: "2025-10-01", tipo: "colar", fornecedor: "Guangzhou" });
  const novo = produto({ quantidade: 4, dataPedido: "2026-04-01" });
  const vendas: VendaBase[] = [venda(giro, 9, "2026-02-01"), venda(giro, 4, "2026-04-05", { revendedora: "Bia" }), { ...venda(parado, 1, "2025-10-10"), codigoBarras: null, referencia: parado.referencia }];
  const a = analisarVendas([giro, recompra, parado, novo], vendas, PARAMS);

  const sGiro = a.skus.find((s) => s.chave === giro.codigoBarras)!;
  assert.equal(sGiro.produtoId, giro.id);
  assert.equal(sGiro.comprado, 15);
  assert.equal(sGiro.vendido, 13);
  assert.equal(sGiro.estoque, 2);
  assert.equal(sGiro.sellThrough, 0.8667);
  assert.equal(sGiro.mediaDiaria, 0.1444); // 13 ÷ 90 dias
  assert.equal(sGiro.status, "repor");
  assert.ok(sGiro.quantidadeSugerida > 0);
  assert.equal(sGiro.curva, "A");

  const sParado = a.skus.find((s) => s.chave === parado.codigoBarras)!;
  assert.equal(sParado.status, "parado");
  assert.equal(sParado.estoque, 5);
  assert.equal(a.skus.find((s) => s.chave === novo.codigoBarras)!.status, "ok");

  assert.equal(a.totais.pecas, 14);
  assert.equal(a.totais.repor, 1);
  assert.equal(a.totais.parados, 1);
  assert.equal(a.revendedoras[0].nome, "Ana");
  assert.equal(a.porTipo[0].chave, "brinco");
  assert.equal(a.porFornecedor.find((f) => f.chave === "Guangzhou")?.parados, 1);

  // Período: só abril conta na receita, mas o estoque usa todas as vendas até o fim.
  const abril = analisarVendas([giro, recompra, parado, novo], vendas, { ...PARAMS, inicio: "2026-04-01", fim: "2026-04-30" });
  const sAbril = abril.skus.find((s) => s.chave === giro.codigoBarras)!;
  assert.equal(sAbril.vendidoPeriodo, 4);
  assert.equal(sAbril.estoque, 2);
  assert.equal(abril.totais.receita, 200);
  assert.deepEqual(abril.revendedoras.map((r) => r.nome), ["Bia"]);
});

test("Vendas sem produto no app ficam em 'não ligadas'", () => {
  const p = produto();
  const a = analisarVendas([p], [{ data: "2026-03-01", referencia: "XX_9", codigoBarras: "7890000000000", produtoId: null, quantidade: 2, valorTotal: 80, revendedora: null, descricao: "Brinco antigo" }], PARAMS);
  assert.equal(a.naoLigadas.linhas, 1);
  assert.equal(a.naoLigadas.receita, 80);
  assert.equal(a.totais.receita, 80);
  assert.equal(a.totais.linhasLigadas, 0);
});

/* ------------------------------------------------------------ maleta */

test("Plural e faixas de preço", () => {
  assert.equal(plural("Brinco"), "brincos");
  assert.equal(plural("Colar"), "colares");
  assert.equal(plural("Anel"), "anéis");
  assert.equal(plural("Óculos"), "óculos");
  assert.equal(faixaDe(59.99), 0);
  assert.equal(faixaDe(60.01), 1);
});

function cenarioMaleta() {
  const brincos = Array.from({ length: 30 }, (_, i) => produto({ tipo: "brinco", precoVenda: 40 + (i % 3) * 10, quantidade: 5, dataPedido: "2026-01-01" }));
  const colares = Array.from({ length: 30 }, () => produto({ tipo: "colar", precoVenda: 100, quantidade: 5, dataPedido: "2026-01-01" }));
  const aneis = Array.from({ length: 10 }, () => produto({ tipo: "anel", precoVenda: 50, quantidade: 5, dataPedido: "2026-01-01" }));
  const produtos = [...brincos, ...colares, ...aneis];
  const vendas: VendaBase[] = [
    // Ana: 75% da receita em brincos (até R$ 60), 25% em colares
    ...brincos.slice(0, 6).map((p) => venda(p, 3, "2026-03-01", { revendedora: "Ana", valorTotal: 150 })),
    ...colares.slice(0, 3).map((p) => venda(p, 1, "2026-03-01", { revendedora: "Ana", valorTotal: 100 })),
    // Loja (outra revendedora): só colares
    ...colares.slice(3, 13).map((p) => venda(p, 2, "2026-03-01", { revendedora: "Carla", valorTotal: 200 })),
  ];
  const a = analisarVendas(produtos, vendas, PARAMS);
  const ligadas: VendaMaleta[] = vendas.map((v) => ({ chave: v.codigoBarras, revendedora: v.revendedora, quantidade: v.quantidade, valorTotal: v.valorTotal }));
  return { a, ligadas };
}

test("Maleta: divide o valor-alvo pelos tipos na proporção das vendas da revendedora", () => {
  const { a, ligadas } = cenarioMaleta();
  const r = sugerirMaleta(a.skus, ligadas, { revendedora: "ana", valorAlvo: 1000, pecasAlvo: 40 }, { hoje: PARAMS.hoje, nomesTipo: { brinco: "Brinco", colar: "Colar", anel: "Anel" } });
  assert.equal(r.base, "revendedora");
  assert.equal(r.confianca, 1); // 21 peças ≥ 20
  const brinco = r.distribuicao.find((d) => d.tipo === "brinco")!;
  const colar = r.distribuicao.find((d) => d.tipo === "colar")!;
  assert.equal(brinco.peso, 0.75);
  assert.equal(colar.peso, 0.25);
  // Cada tipo fica a no máximo uma peça do seu alvo (colar custa R$ 100, brinco até R$ 60).
  assert.ok(Math.abs(brinco.valor - 750) <= 60, `brincos ${brinco.valor}`);
  assert.ok(Math.abs(colar.valor - 250) <= 100, `colares ${colar.valor}`);
  assert.ok(r.totais.valor <= 1000 * 1.05);
  assert.ok(r.totais.pecas <= 40);
  // No máximo 1 por SKU; 2 só para as campeãs; nunca acima do estoque.
  for (const i of r.itens) {
    assert.ok(i.quantidade <= (i.campea ? 2 : 1));
    assert.ok(i.quantidade <= i.estoque);
  }
  assert.ok(r.itens.some((i) => i.motivo.includes("campeã da revendedora em brincos até R$ 60")));
  assert.ok(!r.itens.some((i) => i.tipo === "anel")); // ela não vende anel e houve estoque nos outros tipos
});

test("Maleta: nova revendedora usa as vendas gerais; tipos excluídos ficam de fora", () => {
  const { a, ligadas } = cenarioMaleta();
  const r = sugerirMaleta(a.skus, ligadas, { revendedora: "Nova", valorAlvo: 1000, pecasAlvo: 40, tiposExcluidos: ["brinco"] }, { hoje: PARAMS.hoje });
  assert.equal(r.base, "geral");
  assert.ok(r.avisos.some((x) => x.includes("Sem histórico")));
  assert.ok(r.itens.length > 0);
  assert.ok(r.itens.every((i) => i.tipo !== "brinco"));
  assert.equal(r.distribuicao[0].tipo, "colar");
});

test("Maleta sem histórico de vendas: destaques e novidades primeiro", () => {
  const velho = produto({ dataPedido: "2025-06-01", criadoEm: "2025-06-01T00:00:00.000Z" });
  const destaque = produto({ dataPedido: "2025-06-01", criadoEm: "2025-06-01T00:00:00.000Z", destaque: true });
  const novo = produto({ dataPedido: "2026-04-01", criadoEm: "2026-04-01T00:00:00.000Z" });
  const a = analisarVendas([velho, destaque, novo], [], PARAMS);
  const r = sugerirMaleta(a.skus, [], { valorAlvo: 100, pecasAlvo: 2 }, { hoje: PARAMS.hoje });
  assert.equal(r.base, "estoque");
  assert.equal(r.itens.length, 2);
  assert.deepEqual(new Set(r.itens.map((i) => i.produtoId)), new Set([destaque.id, novo.id]));
  assert.ok(r.itens.every((i) => /novidade|destaque/.test(i.motivo)));
  assert.ok(r.avisos[0].includes("Ainda não há vendas"));
});
