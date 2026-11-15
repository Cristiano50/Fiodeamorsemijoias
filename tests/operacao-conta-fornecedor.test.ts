import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chaveFornecedor,
  descricaoCredito,
  lerLoteMinimo,
  loteMinimoEfetivo,
  motivoNaoAbater,
  planejarCreditos,
  somaAbatida,
  textoValorMoeda,
  totaisCreditos,
  type CreditoGravado,
} from "../src/lib/conta-fornecedor";

const cred = (over: Partial<CreditoGravado>): CreditoGravado => ({
  id: "c1",
  produtoId: "p1",
  status: "aberto",
  quantidade: 2,
  valorMoeda: 9,
  moeda: "CNY",
  descricao: "#1 · ABC123A: falta 2",
  ...over,
});

test("Chave do fornecedor ignora espaços e maiúsculas", () => {
  assert.equal(chaveFornecedor("  Loja  Teste  Bijoux "), "lojatestebijoux");
  assert.equal(chaveFornecedor("测试 饰品"), "测试饰品");
  assert.equal(chaveFornecedor(null), "");
});

test("Créditos da conferência: cria uma vez por linha", () => {
  const plano = planejarCreditos([{ produtoId: "p1", quantidade: 3, preco: 4.5, descricao: "d1" }], [], "CNY");
  assert.deepEqual(plano.criar, [{ produtoId: "p1", quantidade: 3, valorMoeda: 13.5, descricao: "d1" }]);
  assert.equal(plano.atualizar.length + plano.cancelar.length, 0);
});

test("Créditos da conferência: conferir de novo atualiza, não duplica", () => {
  const existentes = [cred({ id: "c1", quantidade: 3, valorMoeda: 13.5, descricao: "d1" })];
  // Mesmo resultado: nada muda.
  const igual = planejarCreditos([{ produtoId: "p1", quantidade: 3, preco: 4.5, descricao: "d1" }], existentes, "CNY");
  assert.deepEqual(igual, { criar: [], atualizar: [], cancelar: [] });
  // Mudou a falta: atualiza o mesmo crédito.
  const mudou = planejarCreditos([{ produtoId: "p1", quantidade: 1, preco: 4.5, descricao: "d2" }], existentes, "CNY");
  assert.deepEqual(mudou.atualizar, [{ id: "c1", quantidade: 1, valorMoeda: 4.5, descricao: "d2" }]);
  assert.equal(mudou.criar.length, 0);
  // A falta sumiu: cancela.
  const sumiu = planejarCreditos([{ produtoId: "p1", quantidade: 0, preco: 4.5, descricao: "d3" }], existentes, "CNY");
  assert.deepEqual(sumiu.cancelar.map((c) => c.id), ["c1"]);
  // A linha foi excluída: cancela o que estava em aberto.
  const excluida = planejarCreditos([], existentes, "CNY");
  assert.deepEqual(excluida.cancelar.map((c) => c.id), ["c1"]);
});

test("Créditos da conferência: abatido fica travado; cancelado pela conferência reabre; pela gestora não", () => {
  // Já abateram 2 em outro pedido; agora a conferência acha 3: fica um crédito novo de 1.
  const travado = planejarCreditos([{ produtoId: "p1", quantidade: 3, preco: 2, descricao: "d" }], [cred({ id: "a1", status: "abatido", quantidade: 2 })], "CNY");
  assert.deepEqual(travado.criar, [{ produtoId: "p1", quantidade: 1, valorMoeda: 2, descricao: "d" }]);
  // Abatido cobre tudo: nada a fazer (e o abatido nunca é cancelado).
  const coberto = planejarCreditos([{ produtoId: "p1", quantidade: 0, preco: 2, descricao: "d" }], [cred({ id: "a1", status: "abatido", quantidade: 2 })], "CNY");
  assert.deepEqual(coberto, { criar: [], atualizar: [], cancelar: [] });
  // Cancelado pela própria conferência (quantidade 0): a falta voltou, reabre o mesmo.
  const reabre = planejarCreditos([{ produtoId: "p1", quantidade: 2, preco: 2, descricao: "d" }], [cred({ id: "x1", status: "cancelado", quantidade: 0, valorMoeda: 0 })], "CNY");
  assert.deepEqual(reabre.atualizar, [{ id: "x1", quantidade: 2, valorMoeda: 4, descricao: "d" }]);
  assert.equal(reabre.criar.length, 0);
  // Cancelado pela gestora (o fornecedor não aceitou): não volta e não ganha outro.
  const gestora = planejarCreditos([{ produtoId: "p1", quantidade: 2, preco: 2, descricao: "d" }], [cred({ id: "g1", status: "cancelado", quantidade: 2 })], "CNY");
  assert.deepEqual(gestora, { criar: [], atualizar: [], cancelar: [] });
  // Crédito lançado à mão (sem produto) nunca é mexido.
  const manual = planejarCreditos([], [cred({ id: "m1", produtoId: null })], "CNY");
  assert.deepEqual(manual, { criar: [], atualizar: [], cancelar: [] });
  // Duplicado em aberto: fica o primeiro.
  const dup = planejarCreditos([{ produtoId: "p1", quantidade: 2, preco: 4.5, descricao: "#1 · ABC123A: falta 2" }], [cred({ id: "d1" }), cred({ id: "d2" })], "CNY");
  assert.deepEqual(dup.cancelar.map((c) => c.id), ["d2"]);
  assert.equal(dup.atualizar.length, 0);
});

test("Valor na moeda do pedido", () => {
  assert.equal(textoValorMoeda(45, "CNY"), "¥ 45,00");
  assert.equal(textoValorMoeda(1234.5, "USD"), "US$ 1.234,50");
  assert.equal(textoValorMoeda(3.5, "BRL"), "R$ 3,50");
  assert.equal(textoValorMoeda(null, "CNY"), "—");
});

test("Descrição do crédito", () => {
  assert.equal(descricaoCredito({ linha: 12, codigo: "ABC123A", especificacao: "G", nome: "BRINCO TESTE", falta: 2, defeito: 1 }), "#12 · ABC123A (G) · BRINCO TESTE: falta 2, defeito 1");
  assert.equal(descricaoCredito({ codigo: "XYZ900B", falta: 0, defeito: 2, sobra: 1 }), "XYZ900B: defeito 2, sobra 1");
  assert.equal(descricaoCredito({ falta: 1, defeito: 0 }), "Peça do pedido: falta 1");
});

test("Abater crédito no pedido: mesmo fornecedor, mesma moeda, outro pedido", () => {
  const c = { status: "aberto", moeda: "CNY", fornecedorChave: chaveFornecedor("Loja Teste"), pedidoId: "ped1" };
  assert.equal(motivoNaoAbater(c, { id: "ped2", moeda: "CNY", fornecedor: "LOJA teste" }), null);
  assert.match(motivoNaoAbater(c, { id: "ped1", moeda: "CNY", fornecedor: "Loja Teste" }) ?? "", /nasceu neste pedido/);
  assert.match(motivoNaoAbater(c, { id: "ped2", moeda: "USD", fornecedor: "Loja Teste" }) ?? "", /CNY/);
  assert.match(motivoNaoAbater(c, { id: "ped2", moeda: "CNY", fornecedor: "Outra Loja" }) ?? "", /outro fornecedor/);
  assert.match(motivoNaoAbater(c, { id: "ped2", moeda: "CNY", fornecedor: null }) ?? "", /nome do fornecedor/);
  assert.match(motivoNaoAbater({ ...c, status: "abatido" }, { id: "ped2", moeda: "CNY", fornecedor: "Loja Teste" }) ?? "", /já foi abatido/);
  assert.match(motivoNaoAbater({ ...c, status: "cancelado" }, { id: "ped2", moeda: "CNY", fornecedor: "Loja Teste" }) ?? "", /cancelado/);
  // Só no pedido seguinte (comprado no mesmo dia ou depois do pedido onde o crédito nasceu).
  assert.equal(motivoNaoAbater(c, { id: "ped2", moeda: "CNY", fornecedor: "Loja Teste", dataCompra: "2026-11-01" }, { dataCompra: "2026-10-01" }), null);
  assert.equal(motivoNaoAbater(c, { id: "ped2", moeda: "CNY", fornecedor: "Loja Teste", dataCompra: "2026-10-01" }, { dataCompra: "2026-10-01" }), null);
  assert.match(motivoNaoAbater(c, { id: "ped0", moeda: "CNY", fornecedor: "Loja Teste", dataCompra: "2026-09-01" }, { dataCompra: "2026-10-01" }) ?? "", /anterior/);
});

test("Soma abatida no pedido e totais da conta", () => {
  const lista = [
    { status: "abatido", abatidoPedidoId: "p2", moeda: "CNY", valorMoeda: 10.1, quantidade: 2 },
    { status: "abatido", abatidoPedidoId: "p2", moeda: "CNY", valorMoeda: 0.2, quantidade: 1 },
    { status: "abatido", abatidoPedidoId: "p2", moeda: "USD", valorMoeda: 5, quantidade: 1 },
    { status: "abatido", abatidoPedidoId: "p3", moeda: "CNY", valorMoeda: 7, quantidade: 1 },
    { status: "aberto", abatidoPedidoId: null, moeda: "CNY", valorMoeda: 4.5, quantidade: 1 },
    { status: "cancelado", abatidoPedidoId: null, moeda: "CNY", valorMoeda: 0, quantidade: 0 },
  ];
  assert.equal(somaAbatida(lista, "p2", "CNY"), 10.3);
  assert.equal(somaAbatida(lista, "p9", "CNY"), 0);
  const t = totaisCreditos(lista);
  assert.deepEqual(t.abertos, [{ moeda: "CNY", valor: 4.5, pecas: 1, creditos: 1 }]);
  assert.deepEqual(t.abatidos, [
    { moeda: "CNY", valor: 17.3, pecas: 4, creditos: 3 },
    { moeda: "USD", valor: 5, pecas: 1, creditos: 1 },
  ]);
  assert.equal(t.cancelados, 1);
});

test("Lote mínimo do fornecedor", () => {
  assert.equal(lerLoteMinimo(""), null);
  assert.equal(lerLoteMinimo(null), null);
  assert.equal(lerLoteMinimo("6"), 6);
  assert.equal(lerLoteMinimo(12), 12);
  assert.equal(lerLoteMinimo("0"), undefined);
  assert.equal(lerLoteMinimo("2,5"), undefined);
  assert.equal(lerLoteMinimo("muitos"), undefined);
  assert.equal(lerLoteMinimo(20000), undefined);
  assert.equal(loteMinimoEfetivo(6, 1), 6);
  assert.equal(loteMinimoEfetivo(null, 3), 3);
  assert.equal(loteMinimoEfetivo(null, 0), 1);
});
