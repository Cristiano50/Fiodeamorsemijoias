import { test } from "node:test";
import assert from "node:assert/strict";
import { chaveSequenciaReferencia, lerReferencia } from "../src/lib/codigos";
import { numerarLinhasPacote, quantidadeDoPacote } from "../src/lib/extracao";
import { lerNumeroBr } from "../src/lib/numeros";
import { cenarioPadraoPara, custosIniciais } from "../src/lib/precos";

test("Pacote da skill: números podem vir como texto", () => {
  assert.equal(lerNumeroBr("12,5"), 12.5);
  assert.equal(lerNumeroBr("¥ 8.5"), 8.5);
  assert.equal(lerNumeroBr("R$ 1.234,56"), 1234.56);
  assert.equal(lerNumeroBr("0,7745", { milhar: false }), 0.7745); // cotação
  assert.equal(lerNumeroBr("0.775", { milhar: false }), 0.775);
  assert.equal(lerNumeroBr("8.5", { milhar: false }), 8.5); // fator
  assert.equal(lerNumeroBr("abc"), null);
});

test("Pacote da skill: quantidade 0 continua 0 (com alerta); ausente vira 1 (com alerta)", () => {
  assert.deepEqual(quantidadeDoPacote(0), { quantidade: 0, alerta: "Quantidade 0 no pacote." });
  assert.deepEqual(quantidadeDoPacote("0"), { quantidade: 0, alerta: "Quantidade 0 no pacote." });
  assert.deepEqual(quantidadeDoPacote(12), { quantidade: 12, alerta: null });
  assert.deepEqual(quantidadeDoPacote("12"), { quantidade: 12, alerta: null });
  assert.equal(quantidadeDoPacote(null).quantidade, 1);
  assert.match(quantidadeDoPacote(undefined).alerta!, /ausente/);
});

test("Pacote da skill: linhas válidas ficam; repetidas e ausentes são numeradas em sequência", () => {
  const r = numerarLinhasPacote(
    [
      { linha: 1, marca: "a" },
      { linha: 2, marca: "b" },
      { linha: 2, marca: "c" }, // repetida
      { linha: null, marca: "d" }, // sem número
      { linha: "5", marca: "e" },
    ],
    [],
  );
  assert.deepEqual(r.linhas, [1, 2, 6, 7, 5]);
  assert.deepEqual(r.renumeradas, [
    { de: "2", para: 6 },
    { de: "sem número", para: 7 },
  ]);
  assert.equal(r.reenvios, 0);
});

test("Pacote da skill: reenviar a mesma parte não duplica (nem as linhas renumeradas)", () => {
  const itens = [
    { linha: 1, marca: "a" },
    { linha: 1, marca: "b" },
    { linha: "", marca: "c" },
  ];
  const primeira = numerarLinhasPacote(itens, []);
  assert.deepEqual(primeira.linhas, [1, 2, 3]);
  const gravadas = itens.map((it, i) => ({ linha: primeira.linhas[i]!, marca: it.marca }));
  const reenvio = numerarLinhasPacote(itens, gravadas);
  assert.deepEqual(reenvio.linhas, [null, null, null]);
  assert.equal(reenvio.reenvios, 3);
  assert.equal(reenvio.renumeradas.length, 0);
});

test("Pacote da skill: número de linha já usado por outra peça (outra parte) é renumerado, não descartado", () => {
  const r = numerarLinhasPacote(
    [
      { linha: 3, marca: "outra" },
      { linha: 4, marca: "nova" },
    ],
    [
      { linha: 3, marca: "gravada" },
      { linha: 9, marca: "x" },
    ],
  );
  assert.deepEqual(r.linhas, [10, 4]);
  assert.deepEqual(r.renumeradas, [{ de: "3", para: 10 }]);
});

test("Referência da skill: mês e sequência saem da própria referência (PREFIXO_AAMMSSS)", () => {
  const modelo = "{PREFIXO}_{AA}{MM}{SEQ:3}";
  assert.deepEqual(lerReferencia(modelo, "BR", "BR_2610034"), { sequencia: 34, ano: 2026, mes: 10 });
  assert.deepEqual(lerReferencia(modelo, "BR", "br_2610034"), { sequencia: 34, ano: 2026, mes: 10 });
  assert.equal(lerReferencia(modelo, "CL", "BR_2610034"), null);
  assert.equal(lerReferencia(modelo, "BR", "BR_26X0034"), null);
  assert.deepEqual(lerReferencia("{PREFIXO}_{SEQ:7}", "AN", "AN_0000123"), { sequencia: 123, ano: null, mes: null });
  assert.deepEqual(lerReferencia("{PREFIXO}-{AAAA}{MM}-{SSS}", "BR", "BR-202611-007"), { sequencia: 7, ano: 2026, mes: 11 });
  // O contador do mês da referência (outubro), não o do mês de hoje.
  const lida = lerReferencia(modelo, "BR", "BR_2610034")!;
  assert.equal(chaveSequenciaReferencia(modelo, "BR", new Date(lida.ano!, lida.mes! - 1, 1)), "ref:BR:202610");
});

test("Cenário de custo do pedido: compra em real = importador nacional; senão o padrão da loja", () => {
  const cenarios = { mercadoria_frete: {}, compra_importador_nacional: {} };
  assert.equal(cenarioPadraoPara("BRL", cenarios, "mercadoria_frete"), "compra_importador_nacional");
  assert.equal(cenarioPadraoPara("brl", cenarios, "mercadoria_frete"), "compra_importador_nacional");
  assert.equal(cenarioPadraoPara("CNY", cenarios, "mercadoria_frete"), "mercadoria_frete");
  assert.equal(cenarioPadraoPara("BRL", { mercadoria_frete: {} }, "mercadoria_frete"), "mercadoria_frete");
});

test("Custos iniciais do pedido: frete e padrões da loja (perdas, embalagem) só quando maiores que zero", () => {
  // Padrões em 0 (como hoje): nada muda, o pedido segue o cenário.
  assert.equal(custosIniciais({ frete: null, perdasPct: 0, embalagemPorPeca: 0 }), null);
  assert.deepEqual(custosIniciais({ frete: 850.5, perdasPct: 0, embalagemPorPeca: 0 }), { frete_internacional: 850.5 });
  assert.deepEqual(custosIniciais({ frete: 0, perdasPct: 2, embalagemPorPeca: 0.4 }), { perdas_defeitos: 2, embalagem_etiqueta: 0.4 });
});
