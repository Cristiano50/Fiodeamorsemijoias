import { test } from "node:test";
import assert from "node:assert/strict";
import {
  casarCodigosUp,
  ean13Valido,
  lerCodigoBarras,
  lerLinhasCodigos,
  lerSaldo,
  saldosDaPlanilha,
  sugerirMapeamentoCodigos,
  type LinhaCodigoUp,
  type ProdutoCodigo,
} from "../src/lib/codigos-up";
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

test("Códigos do UP: sugere as colunas pelo cabeçalho (o estoque vira a coluna de saldo)", () => {
  const m = sugerirMapeamentoCodigos(["Referência", "Nome", "Cód. Barras", "Código Externo", "Descrição da Grade", "Estoque"]);
  // Antes não havia a coluna de saldo: { referencia: 0, nome: 1, codigoBarras: 2, codigoExterno: 3, grade: 4 }.
  assert.deepEqual(m, { referencia: 0, nome: 1, codigoBarras: 2, codigoExterno: 3, grade: 4, saldo: 5 });
  assert.equal(sugerirMapeamentoCodigos(["Referencia", "Codigo de barras", "Saldo atual"]).saldo, 2);
  assert.equal(sugerirMapeamentoCodigos(["Referencia", "Codigo de barras"]).saldo, undefined);
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

const linha = (o: Partial<LinhaCodigoUp> & { linha: number; referencia: string; codigoBarras: string }): LinhaCodigoUp => ({
  codigoExterno: null,
  grade: null,
  nome: null,
  ...o,
});

test("Códigos do UP: mais linhas no UP que variações no app — só liga com grade/variação; o resto fica em dúvida", () => {
  const produtos = [prod({ id: "p1", referencia: "BR_1", codigoFornecedor: "ABC123A", variacao: "Esmalte rosa" })];
  const r = casarCodigosUp(produtos, [
    linha({ linha: 2, referencia: "BR_1", codigoBarras: "9000000000017", codigoExterno: "ABC123A", grade: "SEMIJOIA - ESMALTE AZUL" }),
    linha({ linha: 3, referencia: "BR_1", codigoBarras: "9000000000024", codigoExterno: "ABC123A", grade: "SEMIJOIA - ESMALTE ROSA" }),
    linha({ linha: 4, referencia: "BR_1", codigoBarras: "9000000000031", codigoExterno: "ABC123A" }),
  ]);
  assert.deepEqual(
    r.atualizar.map((a) => [a.produtoId, a.depois]),
    [["p1", "9000000000024"]],
  );
  assert.deepEqual(
    r.ambiguas.map((a) => a.linha),
    [2, 4],
  );
  assert.equal(r.pendentes.length, 0); // a peça do app ficou com o código certo
});

test("Códigos do UP: uma peça no app e duas grades no UP sem como distinguir — não liga nenhuma (pendente para bipar)", () => {
  const produtos = [prod({ id: "p1", referencia: "BR_2", codigoFornecedor: "ABC124B" })];
  const r = casarCodigosUp(produtos, [
    linha({ linha: 2, referencia: "BR_2", codigoBarras: "9000000000017", codigoExterno: "ABC124B" }),
    linha({ linha: 3, referencia: "BR_2", codigoBarras: "9000000000024", codigoExterno: "ABC124B" }),
  ]);
  assert.equal(r.atualizar.length, 0); // antes: a 1ª linha ia para a peça, fosse qual fosse a grade
  assert.equal(r.ambiguas.length, 2);
  assert.deepEqual(
    r.pendentes.map((p) => p.id),
    ["p1"],
  );
});

test("Códigos do UP: duas variações no app e duas linhas no UP iguais — pendentes, nada liga errado", () => {
  const produtos = [
    prod({ id: "g", referencia: "BR_3", codigoFornecedor: "ABC125C", especificacao: "G" }),
    prod({ id: "mr", referencia: "BR_3", codigoFornecedor: "ABC125C", especificacao: "MR" }),
  ];
  const semGrade = casarCodigosUp(produtos, [
    linha({ linha: 2, referencia: "BR_3", codigoBarras: "9000000000017", codigoExterno: "ABC125C" }),
    linha({ linha: 3, referencia: "BR_3", codigoBarras: "9000000000024", codigoExterno: "ABC125C" }),
  ]);
  assert.equal(semGrade.atualizar.length, 0);
  assert.deepEqual(semGrade.pendentes.map((p) => p.id).sort(), ["g", "mr"]);
  // Com a especificação do fornecedor na grade do UP, cada código vai para a variação certa; a 3ª grade fica em dúvida.
  const comGrade = casarCodigosUp(produtos, [
    linha({ linha: 2, referencia: "BR_3", codigoBarras: "9000000000017", grade: "SEMIJOIA BANHADA A OURO - MR" }),
    linha({ linha: 3, referencia: "BR_3", codigoBarras: "9000000000024", grade: "SEMIJOIA BANHADA A OURO - G" }),
    linha({ linha: 4, referencia: "BR_3", codigoBarras: "9000000000031", grade: "SEMIJOIA BANHADA A OURO - P" }),
  ]);
  assert.deepEqual(
    comGrade.atualizar.map((a) => [a.produtoId, a.depois]),
    [
      ["mr", "9000000000017"],
      ["g", "9000000000024"],
    ],
  );
  assert.deepEqual(
    comGrade.ambiguas.map((a) => a.linha),
    [4],
  );
});

test("Códigos do UP: um código que já veio do UP nunca é trocado em silêncio — vira troca para a gestora confirmar", () => {
  const produtos = [prod({ id: "a", referencia: "BR_4", codigoBarras: "9000000000017", codigoBarrasOrigem: "up" })];
  const r = casarCodigosUp(produtos, [linha({ linha: 2, referencia: "BR_4", codigoBarras: "9000000000024" })]);
  assert.equal(r.atualizar.length, 0);
  assert.equal(r.conflitos.length, 1);
  assert.deepEqual(r.conflitos[0].troca, { produtoId: "a", referencia: "BR_4", nome: null, variacao: null, atual: "9000000000017", novo: "9000000000024" });
  // O código do app (EAN interno) continua sendo trocado direto pelo do UP.
  const app = casarCodigosUp([prod({ id: "b", referencia: "BR_5", codigoBarras: "9100000000015", codigoBarrasOrigem: "app" })], [linha({ linha: 2, referencia: "BR_5", codigoBarras: "9000000000031" })]);
  assert.equal(app.atualizar.length, 1);
  assert.equal(app.conflitos.length, 0);
});

test("Códigos do UP: coluna opcional de saldo (estoque) por código de barras", () => {
  assert.equal(lerSaldo("12"), 12);
  assert.equal(lerSaldo("12,000"), 12);
  assert.equal(lerSaldo(-3), -3);
  assert.equal(lerSaldo(""), null);
  assert.equal(lerSaldo("abc"), null);
  const { lidas } = lerLinhasCodigos(
    [
      ["BR_1", "9000000000017", "5"],
      ["BR_2", "9000000000024", ""],
      ["BR_3", "9000000000031", "0"],
    ],
    { referencia: 0, codigoBarras: 1, saldo: 2 },
    2,
  );
  assert.deepEqual(saldosDaPlanilha(lidas), [
    { codigoBarras: "9000000000017", saldo: 5 },
    { codigoBarras: "9000000000031", saldo: 0 },
  ]);
  // Sem a coluna escolhida, nada de saldo.
  const sem = lerLinhasCodigos([["BR_1", "9000000000017", "5"]], { referencia: 0, codigoBarras: 1 }, 2);
  assert.deepEqual(saldosDaPlanilha(sem.lidas), []);
});
