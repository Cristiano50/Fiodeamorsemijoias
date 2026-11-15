import { test } from "node:test";
import assert from "node:assert/strict";
import { analisarVendas, indexarProdutos, type ProdutoBase, type VendaBase } from "../src/lib/vendas-calculo";
import { avisoBackup, indicadoresEstoque, sellThroughPorPedido, vendasDaSemana, vendasDoMes, type VendaResumo } from "../src/lib/painel-calculo";

/* Códigos e nomes fictícios. */
const HOJE = "2026-11-15";

test("Painel: semana e mês contra o período anterior", () => {
  const vendas: VendaResumo[] = [
    { data: "2026-11-15", quantidade: 2, receita: 200 },
    { data: "2026-11-09", quantidade: 1, receita: 100 }, // ainda nesta semana (09 a 15)
    { data: "2026-11-08", quantidade: 1, receita: 150 }, // semana anterior (02 a 08)
    { data: "2026-10-10", quantidade: 4, receita: 400 }, // mês anterior, até o dia 15
    { data: "2026-10-20", quantidade: 9, receita: 900 }, // depois do dia 15: fora da comparação
    { data: null, quantidade: 1, receita: 50 },
  ];
  const s = vendasDaSemana(vendas, HOJE);
  assert.deepEqual(s.atual, { inicio: "2026-11-09", fim: "2026-11-15", receita: 300, pecas: 3 });
  assert.deepEqual(s.anterior, { inicio: "2026-11-02", fim: "2026-11-08", receita: 150, pecas: 1 });
  assert.equal(s.variacao, 1); // +100%
  const m = vendasDoMes(vendas, HOJE);
  assert.deepEqual([m.atual.inicio, m.atual.fim, m.atual.receita], ["2026-11-01", "2026-11-15", 450]);
  assert.deepEqual([m.anterior.inicio, m.anterior.fim, m.anterior.receita], ["2026-10-01", "2026-10-15", 400]);
  assert.equal(m.variacao, 0.125);
  // Mês anterior mais curto: 31/03 compara com 28/02; janeiro compara com dezembro.
  assert.equal(vendasDoMes([], "2026-03-31").anterior.fim, "2026-02-28");
  assert.equal(vendasDoMes([], "2026-01-10").anterior.inicio, "2025-12-01");
  assert.equal(vendasDoMes([], "2026-01-10").variacao, null);
});

let seq = 0;
function produto(p: Partial<ProdutoBase> = {}): ProdutoBase {
  seq++;
  return {
    id: `q${seq}`,
    codigoBarras: `78922222${String(seq).padStart(5, "0")}`,
    referencia: `ABC${String(seq).padStart(3, "0")}P`,
    codigoFornecedor: null,
    nome: null,
    nomeComercial: null,
    tipo: "brinco",
    quantidade: 10,
    precoVenda: 50,
    custoTotalBrl: 5,
    imagemId: null,
    destaque: false,
    criadoEm: "2026-01-01T00:00:00.000Z",
    recompraDe: null,
    fornecedor: "Fornecedor Teste",
    dataPedido: "2026-06-01",
    pedidoId: "P1",
    numeroPedido: "P-001",
    codigoBarrasOrigem: "up",
    ...p,
  };
}
const venda = (p: ProdutoBase, quantidade: number, data: string): VendaBase => ({ data, referencia: null, codigoBarras: p.codigoBarras, produtoId: null, quantidade, valorTotal: quantidade * 50, revendedora: null });

test("Painel: sell-through de cada pedido aos 30/60/90 dias da chegada (a peça mais antiga sai primeiro)", () => {
  const original = produto({ pedidoId: "P1", numeroPedido: "P-001", recebimento: "conferido", dataChegada: "2026-07-01", quantidade: 10 });
  const recompra = produto({
    codigoBarras: original.codigoBarras,
    referencia: original.referencia,
    recompraDe: original.id,
    pedidoId: "P2",
    numeroPedido: "P-002",
    recebimento: "recebido",
    dataChegada: "2026-10-01",
    quantidade: 10,
    criadoEm: "2026-09-01T00:00:00.000Z",
  });
  const aCaminho = produto({ pedidoId: "P3", numeroPedido: "P-003", recebimento: "em_transito" });
  const vendas = [
    venda(original, 4, "2026-07-20"), // P1, dentro dos 30 dias
    venda(original, 4, "2026-08-20"), // P1, aos 60
    venda(original, 4, "2026-10-05"), // 2 acabam o P1, 2 vão para o P2
    venda(original, -1, "2026-10-06"), // devolução desfaz a última saída (P2)
    venda(original, 1, "2026-11-10"), // P2
  ];
  const r = sellThroughPorPedido(indexarProdutos([original, recompra, aCaminho]), vendas, HOJE);
  assert.deepEqual(
    r.map((x) => x.pedidoId),
    ["P2", "P1"],
  ); // o mais recente primeiro; o pedido a caminho não aparece
  const p1 = r.find((x) => x.pedidoId === "P1")!;
  assert.equal(p1.entrou, 10);
  assert.deepEqual(
    p1.marcos.map((m) => [m.dias, m.vendidas, m.sellThrough]),
    [
      [30, 4, 0.4],
      [60, 8, 0.8],
      [90, 8, 0.8], // 90 dias = 29/09: os 2 de outubro ainda não
    ],
  );
  assert.equal(p1.sellThroughAteAgora, 1);
  const p2 = r.find((x) => x.pedidoId === "P2")!;
  assert.equal(p2.vendidasAteAgora, 2); // 2 − 1 devolvida + 1
  assert.deepEqual(
    p2.marcos.map((m) => m.sellThrough),
    [0.1, null, null],
  ); // 45 dias desde a chegada: 60 e 90 ainda não
  assert.equal(p2.chegadaEstimada, false);
  assert.equal(sellThroughPorPedido(indexarProdutos([original, recompra]), vendas, HOJE, { limite: 1 }).length, 1);
});

test("Painel: capital em estoque, % parado e cobertura em dias", () => {
  const parado = produto({ quantidade: 10, custoTotalBrl: 6, dataPedido: "2026-01-10" });
  const gira = produto({ quantidade: 10, custoTotalBrl: 4, dataPedido: "2026-09-01" });
  const vendas = [venda(gira, 6, "2026-10-20"), venda(gira, 3, "2026-11-10"), venda(parado, 1, "2026-02-01")];
  const a = analisarVendas([parado, gira], vendas, { hoje: HOJE, prazoReposicaoDias: 45, diasEstoqueParado: 120 });
  const resumo = vendas.map((v) => ({ data: v.data, quantidade: v.quantidade, receita: v.valorTotal ?? 0 }));
  const e = indicadoresEstoque(a.skus, resumo, "2026-11-10", 90);
  assert.equal(e.pecas, 10); // 9 paradas + 1
  assert.equal(e.capital, 9 * 6 + 1 * 4);
  assert.equal(e.capitalParado, 54);
  assert.equal(e.pctParado, 0.931);
  // Janela de 90 dias até 10/11 (desde 13/08): 9 peças ÷ 90 dias = 0,1/dia → 10 peças = 100 dias.
  assert.equal(e.janelaDias, 90);
  assert.equal(e.vendaMediaDiaria, 0.1);
  assert.equal(e.coberturaDias, 100);
  // Sem vendas: sem cobertura.
  assert.equal(indicadoresEstoque(a.skus, [], null).coberturaDias, null);
});

test("Painel: backup fora do computador avisa com mais de 7 dias ou nunca; Turso não se aplica", () => {
  assert.deepEqual(avisoBackup({ local: false, copiaExterna: { em: null } }, HOJE), { aplica: false, ultimaCopia: null, dias: null, alerta: false, erro: null });
  assert.equal(avisoBackup({ local: true, copiaExterna: { em: null } }, HOJE).alerta, true);
  const recente = avisoBackup({ local: true, copiaExterna: { em: "2026-11-10T13:00:00.000Z" } }, HOJE);
  assert.deepEqual([recente.dias, recente.alerta], [5, false]);
  const velha = avisoBackup({ local: true, copiaExterna: { em: "2026-11-01T13:00:00.000Z", erro: "pasta sem permissão" } }, HOJE);
  assert.deepEqual([velha.dias, velha.alerta, velha.erro], [14, true, "pasta sem permissão"]);
});
