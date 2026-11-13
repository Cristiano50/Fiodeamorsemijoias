import { test } from "node:test";
import assert from "node:assert/strict";
import { digitoEan13, eanValido, montarEan13, montarReferencia } from "../src/lib/codigos";
import { arredondar, calcularCustos, calcularPreco, detalharCustos, valoresDoCenario, type ComponenteCusto, type PoliticaPreco } from "../src/lib/precos";
import { lerCabecalho, lerLinha } from "../src/lib/extracao";
import precificacao from "../src/config/precificacao.json";
import fiscal from "../src/config/fiscal.json";

const pol = precificacao as unknown as PoliticaPreco;
const componentes = fiscal.custo_aquisicao.componentes as unknown as ComponenteCusto[];

test("EAN-13: dígito verificador confere com o código gerado pelo UP Vendas", () => {
  assert.equal(digitoEan13("900002301992"), 9);
  assert.ok(eanValido("9000023019929"));
  assert.ok(!eanValido("9000023019928"));
});

test("EAN-13 interno com prefixo 91 (gestor de estoque)", () => {
  const ean = montarEan13("91", 1);
  assert.equal(ean, "9100000000015");
  assert.ok(eanValido(ean));
  assert.throws(() => montarEan13("91", 10_000_000_000));
});

test("Referência no padrão PREFIXO_AAMMSSS", () => {
  const d = new Date(2026, 10, 13);
  assert.equal(montarReferencia("{PREFIXO}_{AA}{MM}{SSS}", { prefixo: "BR", sequencia: 1, data: d }), "BR_2611001");
  assert.equal(montarReferencia("{PREFIXO}_{AA}{MM}{SEQ:3}", { prefixo: "CL", sequencia: 42, data: d }), "CL_2611042");
});

test("Arredondamento terminando em ,99 com mínimo", () => {
  assert.equal(arredondar(22.99, { modo: "terminar_em", centavos: 0.99 }), 22.99);
  assert.equal(arredondar(23.1, { modo: "terminar_em", centavos: 0.99 }), 23.99);
  assert.equal(arredondar(23.0, { modo: "terminar_em", centavos: 0.99 }), 23.99);
  assert.equal(arredondar(5, { modo: "terminar_em", centavos: 0.99, minimo: 19.99 }), 19.99);
});

test("Preço pelo fator: reproduz o exemplo do UP (custo 2,75 → R$ 22,99)", () => {
  const r = calcularPreco(2.75, "brinco", pol);
  assert.equal(r.fator, 8);
  assert.equal(r.preco, 22.99);
  assert.equal(r.lucroPct, 736);
});

test("Faixas monotônicas: peça mais cara nunca sai mais barata", () => {
  let anterior = 0;
  for (let c = 1; c <= 120; c += 0.25) {
    const p = calcularPreco(c, null, pol).preco;
    assert.ok(p >= anterior, `custo ${c} gerou ${p} < ${anterior}`);
    anterior = p;
  }
});

test("Fator manual e preço manual têm prioridade", () => {
  assert.equal(calcularPreco(10, "brinco", pol, { fatorManual: 3 }).preco, 30.99);
  assert.equal(calcularPreco(10, "brinco", pol, { precoManual: 49.9 }).preco, 49.9);
});

test("Somente mercadoria: custo = preço × cotação", () => {
  const zerado = Object.fromEntries(componentes.map((c) => [c.id, 0]));
  const m = calcularCustos([{ id: "a", precoOrigem: 3.5, quantidade: 10 }], { cotacao: 0.785, custos: zerado }, componentes);
  assert.equal(m.get("a")!.custoTotalBrl, 2.75);
});

test("Cenário do contador reproduz o parecer (fator de custo 2,458 no pedido de exemplo)", () => {
  const cen = fiscal.custo_aquisicao.cenarios_importacao.rts_courier_cnpj;
  const valores = valoresDoCenario(componentes, cen);
  const d = detalharCustos([{ id: "pedido", precoOrigem: 8225.9, quantidade: 1 }], { cotacao: 0.78, custos: valores }, componentes);
  assert.ok(Math.abs(d.fatorCusto - 2.458) < 0.01, `fator ${d.fatorCusto}`);
});

test("Leitura de linha de pedido chinês: preço × quantidade = total", () => {
  const l = lerLinha("1 | GSH747A | 耳钉-21# | GSH747A | G | 10 | 12 | 120");
  assert.deepEqual([l.codigo, l.descricao, l.especificacao, l.preco, l.quantidade], ["GSH747A", "耳钉-21#", "G", 10, 12]);
  const v = lerLinha("34 | SH5122A | 耳钉-滴油款 | SH5122A | MR粉油 | 4.5 | 13 | 58.5");
  assert.equal(v.especificacao, "MR粉油");
  assert.equal(v.preco, 4.5);
});

test("Cabeçalho: data e número do pedido", () => {
  const c = lerCabecalho("客户:FA\n下单时间2026-09-26 | 单号:X260926017");
  assert.equal(c.data, "2026-09-26");
  assert.equal(c.numero, "X260926017");
  assert.equal(c.moeda, "CNY");
});
