import { test } from "node:test";
import assert from "node:assert/strict";
import { digitoEan13, eanValido, montarEan13, montarReferencia } from "../src/lib/codigos";
import {
  ARREDONDAMENTO_ANTIGO,
  arredondar,
  calcularCustos,
  calcularPreco,
  detalharCustos,
  ehArredondamentoAntigo,
  fatorAbaixoDoMinimo,
  precoManualAbaixoDoMinimo,
  semAlertasDePreco,
  valoresDoCenario,
  type ComponenteCusto,
  type PoliticaPreco,
} from "../src/lib/precos";
import { lerCabecalho, lerLinha } from "../src/lib/extracao";
import precificacao from "../src/config/precificacao.json";
import fiscal from "../src/config/fiscal.json";
import escada from "./vetores/escada.json";
import especificacao from "./vetores/especificacao.json";
import cabecalho from "./vetores/cabecalho.json";

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

test("Arredondamento antigo (terminar em ,99 com mínimo) continua funcionando", () => {
  assert.equal(arredondar(22.99, { modo: "terminar_em", centavos: 0.99 }), 22.99);
  assert.equal(arredondar(23.1, { modo: "terminar_em", centavos: 0.99 }), 23.99);
  assert.equal(arredondar(23.0, { modo: "terminar_em", centavos: 0.99 }), 23.99);
  assert.equal(arredondar(5, { modo: "terminar_em", centavos: 0.99, minimo: 19.99 }), 19.99);
  assert.equal(arredondar(37.2, ARREDONDAMENTO_ANTIGO), 37.99);
});

test("Escada de preços: casos comuns ao app e à skill (tests/vetores/escada.json)", () => {
  const regra = { modo: "escada", centavos: 0.99, minimo: escada.minimo, degraus: escada.degraus };
  for (const c of escada.casos) {
    assert.equal(arredondar(c.bruto, regra), c.preco, `bruto ${c.bruto} (vetor)`);
    assert.equal(arredondar(c.bruto, pol.arredondamento), c.preco, `bruto ${c.bruto} (precificacao.json)`);
  }
});

test("precificacao.json: o arredondamento é exatamente o bloco da escada aprovada", () => {
  assert.deepEqual(pol.arredondamento, {
    modo: "escada",
    minimo: 19.99,
    centavos: 0.99,
    direcao: "cima",
    degraus: [
      { ate: 49.99, passo: 5 },
      { ate: 99.99, passo: 10 },
      { ate: 199.99, passo: 20 },
      { ate: 399.99, passo: 50 },
      { ate: null, passo: 100 },
    ],
    formula:
      "preço possível mais próximo de custo × fator: 19,99 (mínimo); de 5 em 5 até 49,99; de 10 em 10 até 99,99; de 20 em 20 até 199,99; de 50 em 50 até 399,99; de 100 em 100 acima (sempre ,99); empate fica com o maior",
  });
  assert.deepEqual(escada.degraus, pol.arredondamento.degraus);
});

test("Escada: empate fica com o maior; tabelas secundárias usam a escada sem o mínimo", () => {
  const regra = pol.arredondamento;
  assert.equal(arredondar(22.49, regra), 24.99); // 2,50 de cada lado
  assert.equal(arredondar(54.99, regra), 59.99); // 5,00 de cada lado
  assert.equal(arredondar(11.99, regra, false), 9.99); // atacado de uma peça de 19,99 × 0,6
  assert.equal(arredondar(13.99, regra, false), 14.99); // liquidação de 19,99 × 0,7
  assert.equal(arredondar(2, regra, false), 4.99);
  const r = calcularPreco(1.5, "brinco", pol, { fatorPedido: 10 });
  assert.equal(r.preco, 19.99);
  assert.equal(r.precos.atacado_revenda, 9.99);
  assert.equal(r.precos.liquidacao, 14.99);
});

test("Escada nunca faz uma peça mais cara sair mais barata", () => {
  let anterior = 0;
  for (let c = 0; c <= 2000; c += 0.37) {
    const p = arredondar(c, pol.arredondamento);
    assert.ok(p >= anterior, `bruto ${c} gerou ${p} < ${anterior}`);
    anterior = p;
  }
});

test("Configuração salva com o arredondamento antigo (sem personalizar) passa para a escada; personalizada fica", () => {
  assert.ok(ehArredondamentoAntigo({ ...ARREDONDAMENTO_ANTIGO }));
  assert.ok(ehArredondamentoAntigo({ modo: "terminar_em", centavos: 0.99, minimo: 19.99 }));
  assert.ok(!ehArredondamentoAntigo({ ...ARREDONDAMENTO_ANTIGO, centavos: 0.9 }));
  assert.ok(!ehArredondamentoAntigo({ ...ARREDONDAMENTO_ANTIGO, minimo: 24.99 }));
  assert.ok(!ehArredondamentoAntigo({ ...ARREDONDAMENTO_ANTIGO, outra: 1 }));
  assert.ok(!ehArredondamentoAntigo(pol.arredondamento));
  assert.ok(!ehArredondamentoAntigo(null));
});

test("Fator escolhido no pedido: custo × fator, no preço da escada mais próximo", () => {
  const r = calcularPreco(2.73, "brinco", pol, { fatorPedido: 10 });
  assert.equal(r.fator, 10);
  assert.equal(r.origemFator, "fator do pedido");
  assert.equal(r.precoBruto, 27.3);
  assert.equal(r.preco, 24.99); // antes da escada: 27,99
  assert.deepEqual(r.alertas.filter((a) => a.startsWith("Fator")), []);
});

test("Pedido em branco usa o fator padrão da loja (10)", () => {
  const r = calcularPreco(5, "colar", pol);
  assert.equal(r.fator, 10);
  assert.equal(r.preco, 49.99); // antes da escada: 50,99
});

test("Fator da peça vence o do pedido; preço manual vence tudo", () => {
  assert.equal(calcularPreco(10, "brinco", pol, { fatorManual: 12, fatorPedido: 10 }).preco, 119.99); // antes: 120,99
  assert.equal(calcularPreco(10, "brinco", pol, { fatorPedido: 10, precoManual: 149.9 }).preco, 149.9);
});

test("Fator abaixo do mínimo (10) gera alerta; % Lucro do UP: custo 2,75 e preço 22,99 = 736%", () => {
  const r = calcularPreco(2.75, "brinco", pol, { fatorPedido: 8.36 });
  assert.equal(r.precoBruto, 22.99);
  assert.equal(r.preco, 24.99);
  assert.ok(r.alertas.some((a) => a.includes("abaixo do mínimo")));
  assert.equal(calcularPreco(2.75, "brinco", pol, { precoManual: 22.99 }).lucroPct, 736);
  assert.ok(fatorAbaixoDoMinimo(9.99, pol));
  assert.ok(!fatorAbaixoDoMinimo(10, pol));
  assert.ok(!fatorAbaixoDoMinimo(null, pol));
});

test("Arredondar para baixo na escada não gera alerta de fator mínimo (nem no preço manual igual)", () => {
  const r = calcularPreco(4.73, "brinco", pol, { fatorPedido: 10 }); // 47,30 → 44,99 (fator efetivo 9,51)
  assert.equal(r.preco, 44.99);
  assert.deepEqual(r.alertas.filter((a) => a.startsWith("Fator") || a.startsWith("Preço manual")), []);
  assert.equal(precoManualAbaixoDoMinimo(44.99, 4.73, pol).abaixo, false);
  const m = precoManualAbaixoDoMinimo(39.99, 4.73, pol);
  assert.equal(m.abaixo, true);
  assert.equal(m.fatorEfetivo, 8.45);
  assert.ok(calcularPreco(4.73, "brinco", pol, { precoManual: 39.99 }).alertas.some((a) => a.startsWith("Preço manual abaixo do fator mínimo")));
  // Sem custo ainda: não dá para conferir (o recálculo confere quando o custo chegar).
  assert.equal(precoManualAbaixoDoMinimo(9.99, 0, pol).abaixo, false);
  assert.equal(precoManualAbaixoDoMinimo(9.99, null, pol).abaixo, false);
});

test("Recompra: fica com o preço vigente do original; avisa 'Custo mudou' acima de 10%", () => {
  // Custo 7,90 × 10 = 79 → 79,99 pela escada; vigente 59,99 → +33%.
  const r = calcularPreco(7.9, "brinco", pol, { fatorPedido: 10, precoVigente: 59.99 });
  assert.equal(r.preco, 59.99);
  assert.equal(r.precoCalculado, 79.99);
  assert.equal(r.precos.consignado, 59.99);
  assert.ok(r.custoMudouPct! > 10);
  assert.ok(r.alertas.some((a) => a.startsWith("Custo mudou")));
  // Diferença pequena: sem alerta.
  const s = calcularPreco(6.1, "brinco", pol, { fatorPedido: 10, precoVigente: 59.99 });
  assert.equal(s.precoCalculado, 59.99);
  assert.ok(!s.alertas.some((a) => a.startsWith("Custo mudou")));
  // O fator abaixo do mínimo não alerta na recompra (o preço é o do original).
  assert.ok(!calcularPreco(6.1, "brinco", pol, { fatorPedido: 8, precoVigente: 59.99 }).alertas.some((a) => a.startsWith("Fator")));
  // Os alertas de preço são refeitos a cada recálculo; os outros ficam.
  assert.deepEqual(semAlertasDePreco(["Custo mudou: x", "Sem cotação: preço pendente.", "Recompra de BR_1.", "Quantidade 0 no pacote."]), ["Recompra de BR_1.", "Quantidade 0 no pacote."]);
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
  const l = lerLinha("1 | ABC123A | 耳钉-21# | ABC123A | G | 10 | 12 | 120");
  assert.deepEqual([l.codigo, l.descricao, l.especificacao, l.preco, l.quantidade], ["ABC123A", "耳钉-21#", "G", 10, 12]);
  const v = lerLinha("34 | ABC512A | 耳钉-滴油款 | ABC512A | MR粉油 | 4.5 | 13 | 58.5");
  assert.equal(v.especificacao, "MR粉油");
  assert.equal(v.preco, 4.5);
  // Letras e números de largura total viram ASCII.
  assert.equal(lerLinha("2 | ＡＢＣ１２３Ａ | 戒指 | 金色 | 6.5 | 12 | 78").codigo, "ABC123A");
});

test("Especificação/cor do fornecedor: casos comuns ao app e à skill (tests/vetores/especificacao.json)", () => {
  for (const c of especificacao.casos) {
    const l = lerLinha(c.texto);
    assert.equal(l.codigo ?? "", c.codigo, c.texto);
    assert.equal(l.especificacao ?? "", c.especificacao, c.texto);
    assert.equal(l.preco, c.preco, c.texto);
    assert.equal(l.quantidade, c.quantidade, c.texto);
  }
});

test("Especificação: só ideograma chinês conta como chinês (coreano, uso privado e fora do plano básico, não)", () => {
  const coreano = lerLinha("8 | ABC128F | 골드링 | 10 | 12 | 120");
  assert.equal(coreano.especificacao, "골드링"); // texto não chinês curto antes do preço = especificação
  assert.equal(coreano.descricao, undefined);
  assert.equal(lerLinha("9 | ABC129G | 戒指 | \ue000 | 10 | 12 | 120").especificacao, "\ue000"); // uso privado
  assert.equal(lerLinha("10 | ABC130H | 戒指 | 𠀀 | 10 | 12 | 120").especificacao, "𠀀"); // fora do plano básico
  assert.equal(lerLinha("11 | ABC131J | 戒指 | 豈 | 10 | 12 | 120").especificacao, "豈"); // compatibilidade (U+F900) é chinês, com descrição antes
  assert.equal(lerLinha("12 | ABC132K | 豈 | 10 | 12 | 120").especificacao, undefined); // sem descrição antes: é a descrição
});

test("Moeda do documento: casos comuns ao app e à skill (tests/vetores/cabecalho.json)", () => {
  for (const c of cabecalho.casos) assert.equal(lerCabecalho(c.texto).moeda, c.moeda, c.texto);
});

test("Cabeçalho: data e número do pedido; sem marca de moeda não adivinha pelo chinês", () => {
  const c = lerCabecalho("客户:FA\n下单时间2026-09-26 | 单号:X260926017");
  assert.equal(c.data, "2026-09-26");
  assert.equal(c.numero, "X260926017");
  assert.equal(c.moeda, null); // antes: "CNY" (a tela mantém CNY e pede para conferir)
});
