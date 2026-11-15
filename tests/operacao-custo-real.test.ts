import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cenarioComImposto,
  comparativoCotacao,
  cotacaoEfetiva,
  custosComEfetiva,
  custosNaTrocaDeCenario,
  custosSemEfetiva,
  estadoEfetiva,
  lerPercentual,
  lerValorPago,
  lerValorPorPeca,
} from "../src/lib/custo-real";
import { calcularCustos, detalharCustos, valoresDoCenario, type ComponenteCusto } from "../src/lib/precos";
import fiscal from "../src/config/fiscal.json";

const componentes = fiscal.custo_aquisicao.componentes as unknown as ComponenteCusto[];

test("Cotação efetiva = R$ pagos ÷ (total na moeda − créditos abatidos)", () => {
  assert.equal(cotacaoEfetiva({ moeda: "CNY", valorPagoBrl: 6300, totalMoeda: 8000 }), 0.7875);
  assert.equal(cotacaoEfetiva({ moeda: "CNY", valorPagoBrl: 6300, totalMoeda: 8000, abatidosMoeda: 125 }), 0.8);
  assert.equal(cotacaoEfetiva({ moeda: "BRL", valorPagoBrl: 6300, totalMoeda: 8000 }), null); // compra nacional
  assert.equal(cotacaoEfetiva({ moeda: "CNY", valorPagoBrl: null, totalMoeda: 8000 }), null);
  assert.equal(cotacaoEfetiva({ moeda: "CNY", valorPagoBrl: 6300, totalMoeda: 100, abatidosMoeda: 100 }), null);
  // Com a efetiva aplicada, a mercadoria do pedido em R$ = valor pago (sem créditos).
  const efetiva = cotacaoEfetiva({ moeda: "CNY", valorPagoBrl: 6543.21, totalMoeda: 8225.9 })!;
  const d = detalharCustos([{ id: "a", precoOrigem: 8225.9, quantidade: 1 }], { cotacao: efetiva, custos: valoresDoCenario(componentes, { valores: Object.fromEntries(componentes.map((c) => [c.id, 0])) }) }, componentes);
  assert.ok(Math.abs(d.mercadoriaBrl - 6543.21) < 0.01);
});

test("PTAX × efetiva: diferença em % e em R$", () => {
  assert.deepEqual(comparativoCotacao({ ptax: 0.75, efetiva: 0.8, baseMoeda: 8000 }), { diferencaPct: 6.67, diferencaBrl: 400 });
  assert.deepEqual(comparativoCotacao({ ptax: null, efetiva: 0.8, baseMoeda: 8000 }), { diferencaPct: null, diferencaBrl: null });
});

test("Estado da cotação efetiva", () => {
  assert.equal(estadoEfetiva({ moeda: "BRL", cotacao: 1, cotacaoPtax: null }, null), "compra_em_reais");
  assert.equal(estadoEfetiva({ moeda: "CNY", cotacao: 0.75, cotacaoPtax: null }, null), "sem_pagamento");
  assert.equal(estadoEfetiva({ moeda: "CNY", cotacao: 0.75, cotacaoPtax: null }, 0.8), "nao_aplicada");
  assert.equal(estadoEfetiva({ moeda: "CNY", cotacao: 0.8, cotacaoPtax: 0.75 }, 0.8), "aplicada");
  assert.equal(estadoEfetiva({ moeda: "CNY", cotacao: 0.8, cotacaoPtax: 0.75 }, 0.81), "desatualizada");
  assert.equal(estadoEfetiva({ moeda: "CNY", cotacao: 0.8, cotacaoPtax: 0.75 }, null), "desatualizada");
});

test("Custos ao aplicar a efetiva e ao voltar para a PTAX", () => {
  assert.deepEqual(custosComEfetiva({ frete_internacional: 850 }), { frete_internacional: 850, spread_cambio: 0, iof_cambio: 0 });
  assert.deepEqual(custosComEfetiva(null), { spread_cambio: 0, iof_cambio: 0 });
  assert.deepEqual(custosSemEfetiva({ frete_internacional: 850, spread_cambio: 0, iof_cambio: 0 }), { frete_internacional: 850 });
  assert.deepEqual(custosSemEfetiva({ spread_cambio: 2, iof_cambio: 0 }), { spread_cambio: 2 }); // valor digitado fica
  assert.equal(custosSemEfetiva({ spread_cambio: 0, iof_cambio: 0 }), null);
});

test("Pagou imposto na chegada: troca o cenário mantendo frete, perdas e embalagem", () => {
  const emVigor = { frete_internacional: 850, perdas_defeitos: 2, embalagem_etiqueta: 0.4, taxa_agente: 8 };
  assert.deepEqual(custosNaTrocaDeCenario({ frete_internacional: 850 }, emVigor, false), { frete_internacional: 850, perdas_defeitos: 2, embalagem_etiqueta: 0.4 });
  // Frete que não foi digitado (padrão do cenário) não vira frete do pedido.
  assert.deepEqual(custosNaTrocaDeCenario(null, { frete_internacional: 1000, perdas_defeitos: 0, embalagem_etiqueta: 0 }, false), { perdas_defeitos: 0, embalagem_etiqueta: 0 });
  // Com a efetiva: spread e IOF zerados no cenário novo.
  assert.deepEqual(custosNaTrocaDeCenario({ frete_internacional: 500 }, emVigor, true), { frete_internacional: 500, perdas_defeitos: 2, embalagem_etiqueta: 0.4, spread_cambio: 0, iof_cambio: 0 });
  const rts = (fiscal.custo_aquisicao.cenarios_importacao as Record<string, { valores: Record<string, number> }>).rts_courier_cnpj;
  assert.ok(cenarioComImposto(rts));
  assert.ok(!cenarioComImposto({ valores: Object.fromEntries(componentes.map((c) => [c.id, 0])) }));
  // Com imposto, o custo da peça sobe; perdas e embalagem continuam as do pedido.
  const custosRts = { ...valoresDoCenario(componentes, rts), ...custosNaTrocaDeCenario({ frete_internacional: 850 }, emVigor, true) };
  const itens = [{ id: "a", precoOrigem: 10, quantidade: 100 }];
  const semImposto = calcularCustos(itens, { cotacao: 0.8, custos: { ...valoresDoCenario(componentes, { valores: Object.fromEntries(componentes.map((c) => [c.id, 0])) }), frete_internacional: 850 } }, componentes).get("a")!;
  const comImposto = calcularCustos(itens, { cotacao: 0.8, custos: custosRts }, componentes).get("a")!;
  assert.ok(comImposto.custoTotalBrl > semImposto.custoTotalBrl * 1.5);
  assert.equal(custosRts.spread_cambio, 0);
  assert.equal(custosRts.perdas_defeitos, 2);
});

test("Valores digitados no quadro", () => {
  assert.equal(lerValorPago("6.543,21"), 6543.21);
  assert.equal(lerValorPago("6543.21"), 6543.21);
  assert.equal(lerValorPago(""), null);
  assert.equal(lerValorPago("0"), undefined);
  assert.equal(lerValorPago("-10"), undefined);
  assert.equal(lerPercentual("2,5"), 2.5);
  assert.equal(lerPercentual("0"), 0);
  assert.equal(lerPercentual("150"), undefined);
  assert.equal(lerPercentual(""), null);
  assert.equal(lerValorPorPeca("0,40"), 0.4);
  assert.equal(lerValorPorPeca("abc"), undefined);
});
