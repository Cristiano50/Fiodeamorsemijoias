import { test } from "node:test";
import assert from "node:assert/strict";
import { lerNumeroBr, numeroParaCampo } from "../src/lib/numeros";
import { celulaCsv, textoSeguroPlanilha } from "../src/lib/csv";
import { estoqueEntrada } from "../src/lib/estoque";

test("Números digitados: vírgula, ponto, milhar e moeda", () => {
  assert.equal(lerNumeroBr("850,50"), 850.5);
  assert.equal(lerNumeroBr("850.50"), 850.5);
  assert.equal(lerNumeroBr("850.5"), 850.5);
  assert.equal(lerNumeroBr("1.234,56"), 1234.56);
  assert.equal(lerNumeroBr("1,234.56"), 1234.56);
  assert.equal(lerNumeroBr("R$ 1.234"), 1234);
  assert.equal(lerNumeroBr("12.345.678"), 12345678);
  assert.equal(lerNumeroBr("0,7745"), 0.7745);
  assert.equal(lerNumeroBr("0.775"), 0.775);
  assert.equal(lerNumeroBr("5.432", { milhar: false }), 5.432);
  assert.equal(lerNumeroBr("5.432"), 5432);
  assert.equal(lerNumeroBr("10"), 10);
  assert.equal(lerNumeroBr("-3,5"), -3.5);
  assert.equal(lerNumeroBr(""), null);
  assert.equal(lerNumeroBr("abc"), null);
  assert.equal(lerNumeroBr("1,2,3"), null);
  assert.equal(lerNumeroBr(12.5), 12.5);
  // O bug do frete: o campo mostrava "850.5" e, ao sair de novo, gravava 8505.
  assert.equal(lerNumeroBr(numeroParaCampo(850.5)), 850.5);
  assert.equal(numeroParaCampo(850.5), "850,50");
  assert.equal(numeroParaCampo(850), "850");
  assert.equal(numeroParaCampo(0.7745, 4), "0,7745");
  assert.equal(numeroParaCampo(null), "");
});

test("CSV seguro: texto com cara de fórmula não vira fórmula no Excel", () => {
  assert.equal(textoSeguroPlanilha("=HYPERLINK(\"x\")"), "'=HYPERLINK(\"x\")");
  assert.equal(textoSeguroPlanilha("+55 11"), "'+55 11");
  assert.equal(textoSeguroPlanilha("BRINCO (SJ)"), "BRINCO (SJ)");
  assert.equal(celulaCsv(-5), "-5");
  assert.equal(celulaCsv(77.99), "77,99");
  assert.equal(celulaCsv("a;b"), '"a;b"');
  assert.equal(celulaCsv('diz "oi"'), '"diz ""oi"""');
  assert.equal(celulaCsv(true), "Sim");
  assert.equal(celulaCsv(null), "");
});

test("Estoque que entrou: conferido = recebido − defeito; sem conferência = pedido", () => {
  assert.equal(estoqueEntrada({ quantidade: 12 }), 12);
  assert.equal(estoqueEntrada({ quantidade: 12, quantidadeRecebida: null, quantidadeDefeito: 0 }), 12);
  assert.equal(estoqueEntrada({ quantidade: 12, quantidadeRecebida: 11, quantidadeDefeito: 2 }), 9);
  assert.equal(estoqueEntrada({ quantidade: 12, quantidadeRecebida: 0, quantidadeDefeito: 0 }), 0);
  assert.equal(estoqueEntrada({ quantidade: 12, quantidadeRecebida: 1, quantidadeDefeito: 3 }), 0);
});
