import { test } from "node:test";
import assert from "node:assert/strict";
import { casarCodigosUp, ean13Valido, lerCodigoBarras, lerLinhasCodigos, sugerirMapeamentoCodigos, type ProdutoCodigo } from "../src/lib/codigos-up";
import { codigoParaUp } from "../src/lib/upvendas-codigo";

const prod = (o: Partial<ProdutoCodigo> & { id: string }): ProdutoCodigo => ({
  referencia: null,
  codigoFornecedor: null,
  variacao: null,
  nome: null,
  codigoBarras: null,
  codigoBarrasOrigem: null,
  recompraDe: null,
  ...o,
});

test("Códigos do UP: sugere as colunas pelo cabeçalho", () => {
  const m = sugerirMapeamentoCodigos(["Referência", "Nome", "Cód. Barras", "Código Externo", "Descrição da Grade", "Estoque"]);
  assert.deepEqual(m, { referencia: 0, nome: 1, codigoBarras: 2, codigoExterno: 3, grade: 4 });
});

test("Códigos do UP: lê o código como texto e recusa notação científica do Excel", () => {
  assert.deepEqual(lerCodigoBarras(9000000000017), { codigo: "9000000000017" });
  assert.deepEqual(lerCodigoBarras(" 9000000000017 "), { codigo: "9000000000017" });
  assert.equal(lerCodigoBarras("9,00000000002E+12").codigo, null);
  assert.match(lerCodigoBarras("9,00000000002E+12").erro!, /notação científica/);
  assert.equal(lerCodigoBarras("").codigo, null);
  assert.equal(ean13Valido("9000000000018"), true);
  assert.equal(ean13Valido("9000000000017"), false);
});

test("Códigos do UP: referência única liga direto; o código do app é trocado pelo do UP", () => {
  const produtos = [
    prod({ id: "a", referencia: "BR_2611001", codigoBarras: "9100000000015", codigoBarrasOrigem: "app" }),
    prod({ id: "a2", referencia: "BR_2611001", codigoBarras: "9100000000015", codigoBarrasOrigem: "app", recompraDe: "a" }), // recompra não conta
    prod({ id: "b", referencia: "CL_2611001" }),
  ];
  const { lidas, ignoradas } = lerLinhasCodigos(
    [
      ["BR_2611001", "9000000000017"],
      ["CL_2611001", "9000000000024"],
      ["XX_999", "9000000000031"],
      ["", "9000000000048"],
      ["AN_2611001", ""],
    ],
    { referencia: 0, codigoBarras: 1 },
    2,
  );
  const r = casarCodigosUp(produtos, lidas, ignoradas);
  assert.deepEqual(
    r.atualizar.map((a) => [a.produtoId, a.antes, a.depois]),
    [
      ["a", "9100000000015", "9000000000017"],
      ["b", null, "9000000000024"],
    ],
  );
  assert.equal(r.semPar.length, 1);
  assert.equal(r.semPar[0].referencia, "XX_999");
  assert.deepEqual(
    r.ignoradas.map((i) => i.motivo),
    ["sem referência", "sem código de barras"],
  );
  assert.equal(r.semCodigoDoUp, 0);
});

test("Códigos do UP: variações com a mesma referência desempatam pela grade e pelo código externo", () => {
  const produtos = [
    prod({ id: "v1", referencia: "BR_2611034", codigoFornecedor: "SH5122A", variacao: "Esmalte rosa" }),
    prod({ id: "v2", referencia: "BR_2611034", codigoFornecedor: "SH5122A", variacao: "Esmalte branco" }),
    prod({ id: "v3", referencia: "BR_2611034", codigoFornecedor: "SH5122A", variacao: "Esmalte azul" }),
  ];
  const linhas = [
    { linha: 2, referencia: "BR_2611034", codigoBarras: "9000000000055", codigoExterno: "SH5122A", grade: "SEMIJOIA BANHADA A OURO - ESMALTE BRANCO", nome: null },
    { linha: 3, referencia: "br_2611034", codigoBarras: "9000000000062", codigoExterno: "SH5122A", grade: "SEMIJOIA BANHADA A OURO - ESMALTE ROSA", nome: null },
    { linha: 4, referencia: "BR_2611034", codigoBarras: "9000000000079", codigoExterno: "SH5122A", grade: null, nome: null },
  ];
  const r = casarCodigosUp(produtos, linhas);
  assert.deepEqual(
    r.atualizar.map((a) => [a.produtoId, a.depois]),
    [
      ["v2", "9000000000055"],
      ["v1", "9000000000062"],
    ],
  );
  // Sem grade, não dá para saber qual variação: fica para conferir na ficha da peça.
  assert.equal(r.ambiguas.length, 1);
  assert.equal(r.ambiguas[0].opcoes.length, 3);
  assert.equal(r.semCodigoDoUp, 1);
});

test("Códigos do UP: código de outro produto vira conflito; reimportar não muda nada", () => {
  const produtos = [
    prod({ id: "a", referencia: "BR_1", codigoBarras: "9000000000017", codigoBarrasOrigem: "up" }),
    prod({ id: "b", referencia: "BR_2" }),
  ];
  const linhas = [
    { linha: 2, referencia: "BR_1", codigoBarras: "9000000000017", codigoExterno: null, grade: null, nome: null },
    { linha: 3, referencia: "BR_2", codigoBarras: "9000000000017", codigoExterno: null, grade: null, nome: null },
  ];
  const r = casarCodigosUp(produtos, linhas);
  assert.equal(r.atualizar.length, 0);
  assert.equal(r.iguais, 1);
  assert.equal(r.conflitos.length, 1);
  assert.match(r.conflitos[0].motivo, /outro produto/);
});

test("Planilha do UP: vai o código do UP; sem ele, em branco para o UP gerar; modo app manda o EAN interno", () => {
  const up = { codigoNoUp: "ean13" as const, origemCodigoBarras: "upvendas" as const };
  assert.equal(codigoParaUp({ codigoBarras: "9000000000017", codigoBarrasOrigem: "up" }, up), "9000000000017");
  assert.equal(codigoParaUp({ codigoBarras: "9100000000015", codigoBarrasOrigem: "app" }, up), "");
  assert.equal(codigoParaUp({ codigoBarras: null, codigoBarrasOrigem: null }, up), "");
  assert.equal(codigoParaUp({ codigoBarras: "9100000000015", codigoBarrasOrigem: "app" }, { ...up, origemCodigoBarras: "app" }), "9100000000015");
  assert.equal(codigoParaUp({ codigoBarras: "9100000000015", codigoBarrasOrigem: "app" }, { codigoNoUp: "code128", origemCodigoBarras: "app" }), "00000001");
});
