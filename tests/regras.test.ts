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

test("Fator escolhido no pedido: custo × fator, terminando em ,99", () => {
  const r = calcularPreco(2.73, "brinco", pol, { fatorPedido: 10 });
  assert.equal(r.fator, 10);
  assert.equal(r.origemFator, "fator do pedido");
  assert.equal(r.preco, 27.99);
  assert.deepEqual(r.alertas.filter((a) => a.startsWith("Fator")), []);
});

test("Pedido em branco usa o fator padrão da loja (10)", () => {
  const r = calcularPreco(5, "colar", pol);
  assert.equal(r.fator, 10);
  assert.equal(r.preco, 50.99);
});

test("Fator da peça vence o do pedido; preço manual vence tudo", () => {
  assert.equal(calcularPreco(10, "brinco", pol, { fatorManual: 12, fatorPedido: 10 }).preco, 120.99);
  assert.equal(calcularPreco(10, "brinco", pol, { fatorPedido: 10, precoManual: 149.9 }).preco, 149.9);
});

test("Fator abaixo do mínimo (10) gera alerta; exemplo do UP: custo 2,75 × 8,36 = R$ 22,99", () => {
  const r = calcularPreco(2.75, "brinco", pol, { fatorPedido: 8.36 });
  assert.equal(r.preco, 22.99);
  assert.equal(r.lucroPct, 736);
  assert.ok(r.alertas.some((a) => a.includes("abaixo do mínimo")));
});

test("Faixas monotônicas (quando ativadas): peça mais cara nunca sai mais barata", () => {
  const comFaixas = { ...pol, usar_faixas: true };
  let anterior = 0;
  for (let c = 1; c <= 120; c += 0.25) {
    const p = calcularPreco(c, null, comFaixas).preco;
    assert.ok(p >= anterior, `custo ${c} gerou ${p} < ${anterior}`);
    anterior = p;
  }
});

test("Somente mercadoria: custo = preço × cotação", () => {
  const zerado = Object.fromEntries(componentes.map((c) => [c.id, 0]));
  const m = calcularCustos([{ id: "a", precoOrigem: 3.5, quantidade: 10 }], { cotacao: 0.785, custos: zerado }, componentes);
  assert.equal(m.get("a")!.custoTotalBrl, 2.75);
});

test("Frete da loja: frete ÷ mercadoria × valor da peça (China)", () => {
  // Mercadoria: 100 peças × ¥10 × 1,00 = R$ 1.000; frete R$ 200 → 20% sobre cada peça.
  const itens = [
    { id: "a", precoOrigem: 10, quantidade: 60 },
    { id: "b", precoOrigem: 10, quantidade: 40 },
    { id: "c", precoOrigem: 25, quantidade: 0 },
  ];
  const zerado = Object.fromEntries(componentes.map((c) => [c.id, 0]));
  const m = calcularCustos(itens, { cotacao: 1, custos: { ...zerado, frete_internacional: 200 }, rateio: "valor" }, componentes);
  assert.equal(m.get("a")!.custoProdutoBrl, 10);
  assert.equal(m.get("a")!.custoAdicionalBrl, 2);
  assert.equal(m.get("a")!.custoTotalBrl, 12);
  assert.equal(m.get("c")!.custoTotalBrl, 30);
  // Pedido de exemplo: ¥8.225,90 × 0,7745 = R$ 6.370,96; frete R$ 850 → +13,34% por peça.
  const ex = calcularCustos([{ id: "x", precoOrigem: 3.5, quantidade: 858 }], { cotacao: 0.7745, custos: { ...zerado, frete_internacional: 3.5 * 0.7745 * 858 * 0.1334 } }, componentes);
  assert.equal(ex.get("x")!.custoTotalBrl, Math.round(3.5 * 0.7745 * 1.1334 * 100) / 100);
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
