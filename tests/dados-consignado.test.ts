import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chaveLinhaConsignado,
  comRevendedorasPorSku,
  consignadoDaRevendedora,
  converterLinhasConsignado,
  lerSituacao,
  pontuarColunaConsignado,
  registrosEfetivos,
  resumoPorRevendedora,
  sugerirMapeamentoConsignado,
  totaisPorSituacao,
  type RegistroConsignado,
} from "../src/lib/consignado-calculo";
import { acharLinhaCabecalho, indexarProdutos, ligarVenda, chaveDoProduto, type ProdutoBase } from "../src/lib/vendas-calculo";

/* Códigos e nomes fictícios. */

test("Consignado: mapeamento flexível pelos nomes das colunas", () => {
  assert.deepEqual(sugerirMapeamentoConsignado(["Data", "Revendedora", "Cód. Barras", "Ref.", "Descrição", "Qtd", "Situação"]), {
    data: 0,
    revendedora: 1,
    codigoBarras: 2,
    referencia: 3,
    descricao: 4,
    quantidade: 5,
    situacao: 6,
  });
  const m = sugerirMapeamentoConsignado(["Data envio", "Data devolução", "Consultora", "EAN", "Qtd enviada", "Vendidas", "Devolvidas", "Em aberto", "Avaria", "Perdas", "Valor vendido"]);
  assert.equal(m.data, 0); // "Data devolução" não é a data da maleta nem quantidade
  assert.equal(m.revendedora, 2);
  assert.equal(m.codigoBarras, 3);
  assert.equal(m.quantidade, 4);
  assert.equal(m.qtdVendida, 5);
  assert.equal(m.qtdDevolvida, 6);
  assert.equal(m.qtdComRevendedora, 7);
  assert.equal(m.qtdAvariada, 8);
  assert.equal(m.qtdPerdida, 9);
  assert.ok(!Object.values(m).includes(10)); // "Valor vendido" não é quantidade
  assert.ok(!Object.values(m).includes(1));
  // A linha do cabeçalho é achada com as regras do consignado, depois do título do relatório.
  assert.equal(acharLinhaCabecalho([["Relatório de maletas"], [], ["Revendedora", "Referência", "Situação", "Qtd"], ["Revendedora A", "ABC123A", "Em aberto", "1"]], pontuarColunaConsignado), 2);
});

test("Consignado: situação escrita do jeito do UP", () => {
  assert.equal(lerSituacao("Em aberto"), "com_revendedora");
  assert.equal(lerSituacao("CONSIGNADO"), "com_revendedora");
  assert.equal(lerSituacao("Devolvido"), "devolvida");
  assert.equal(lerSituacao("Devolução"), "devolvida");
  assert.equal(lerSituacao("Não vendida"), "devolvida");
  assert.equal(lerSituacao("Vendido"), "vendida");
  assert.equal(lerSituacao("Avariada"), "avariada");
  assert.equal(lerSituacao("Peça com defeito"), "avariada");
  assert.equal(lerSituacao("Perdida"), "perdida");
  assert.equal(lerSituacao("Extraviado"), "perdida");
  assert.equal(lerSituacao("???"), null);
  assert.equal(lerSituacao(""), null);
});

test("Consignado: quantidade + situação, revendedora repetida para baixo e motivos das ignoradas", () => {
  const mapa = { data: 0, revendedora: 1, referencia: 2, quantidade: 3, situacao: 4 };
  const { itens, ignoradas } = converterLinhasConsignado(
    [
      ["01/10/2026", "Revendedora A", "ABC123A", "2", "Em aberto"],
      ["01/10/2026", "", "ABC124A", "1", "Vendida"], // revendedora vem da linha de cima
      ["01/10/2026", "Revendedora B", "ABC125A", "1", ""], // situação vazia = com ela
      ["01/10/2026", "Revendedora B", "ABC126A", "1", "Emprestado"],
      ["01/10/2026", "Revendedora B", "", "1", "Vendida"],
      ["", "", "", "", "Total: 5"],
      ["01/10/2026", "Revendedora B", "ABC127A", "0", "Vendida"],
    ],
    mapa,
  );
  assert.deepEqual(
    itens.map((i) => [i.revendedora, i.referencia, i.quantidade, i.situacao, i.data]),
    [
      ["Revendedora A", "ABC123A", 2, "com_revendedora", "2026-10-01"],
      ["Revendedora A", "ABC124A", 1, "vendida", "2026-10-01"],
      ["Revendedora B", "ABC125A", 1, "com_revendedora", "2026-10-01"],
    ],
  );
  assert.deepEqual(
    ignoradas.map((i) => [i.linha, i.motivo]),
    [
      [5, 'situação desconhecida ("Emprestado")'],
      [6, "sem referência nem código de barras"],
      [7, "linha de total"],
      [8, "quantidade zero"],
    ],
  );
  // Relatório agrupado: a linha só com o nome abre o grupo da revendedora.
  const grupo = converterLinhasConsignado(
    [
      ["", "Revendedora D", "", "", ""],
      ["01/10/2026", "", "ABC128A", "1", "Em aberto"],
    ],
    mapa,
  );
  assert.deepEqual(grupo.ignoradas, []);
  assert.deepEqual(
    grupo.itens.map((i) => [i.revendedora, i.referencia]),
    [["Revendedora D", "ABC128A"]],
  );
  // Planilha de uma maleta só: sem coluna da revendedora, vale o nome informado.
  const uma = converterLinhasConsignado([["ABC123A", "1"]], { referencia: 0, quantidade: 1 }, { revendedoraPadrao: "Revendedora C" });
  assert.deepEqual(
    uma.itens.map((i) => [i.revendedora, i.situacao]),
    [["Revendedora C", "com_revendedora"]],
  );
  assert.equal(converterLinhasConsignado([["ABC123A", "1"]], { referencia: 0, quantidade: 1 }).ignoradas[0].motivo, "sem revendedora");
});

test("Consignado: uma coluna por situação; enviada sem “em aberto” deixa o resto com a revendedora", () => {
  const mapa = { revendedora: 0, codigoBarras: 1, quantidade: 2, qtdVendida: 3, qtdDevolvida: 4, qtdAvariada: 5 };
  const { itens, ignoradas } = converterLinhasConsignado(
    [
      ["Revendedora A", "7890000000011", "5", "2", "1", "1"], // 5 − 4 = 1 com ela
      ["Revendedora A", "7890000000028", "2", "0", "2", ""],
      ["Revendedora A", "7890000000035", "", "", "", ""],
    ],
    mapa,
  );
  assert.deepEqual(
    itens.map((i) => [i.codigoBarras, i.situacao, i.quantidade]),
    [
      ["7890000000011", "devolvida", 1],
      ["7890000000011", "vendida", 2],
      ["7890000000011", "avariada", 1],
      ["7890000000011", "com_revendedora", 1],
      ["7890000000028", "devolvida", 2],
    ],
  );
  assert.equal(ignoradas[0].motivo, "sem quantidade em nenhuma situação");
  assert.deepEqual(totaisPorSituacao(itens), { com_revendedora: 1, devolvida: 3, vendida: 2, avariada: 1, perdida: 0 });
});

const reg = (r: Partial<RegistroConsignado>): RegistroConsignado => ({
  loteId: "L1",
  loteEm: "2026-10-01T10:00:00.000Z",
  data: "2026-10-01",
  revendedora: "Revendedora A",
  codigoBarras: "7890000000011",
  referencia: null,
  produtoId: null,
  descricao: null,
  quantidade: 1,
  situacao: "com_revendedora",
  ...r,
});

test("Consignado: para a mesma revendedora, data e peça vale o lote mais novo (desfazer volta o anterior)", () => {
  const antigo = reg({ loteId: "L1", quantidade: 3 });
  const outraPeca = reg({ loteId: "L1", codigoBarras: "7890000000028" });
  const novoVendida = reg({ loteId: "L2", loteEm: "2026-10-20T10:00:00.000Z", situacao: "vendida", quantidade: 2 });
  const novoDevolvida = reg({ loteId: "L2", loteEm: "2026-10-20T10:00:00.000Z", situacao: "devolvida", quantidade: 1, revendedora: "REVENDEDORA  a" });
  assert.equal(chaveLinhaConsignado(antigo), chaveLinhaConsignado(novoDevolvida));
  const efetivos = registrosEfetivos([antigo, outraPeca, novoVendida, novoDevolvida]);
  assert.deepEqual(
    efetivos.map((r) => [r.loteId, r.codigoBarras, r.situacao]),
    [
      ["L1", "7890000000028", "com_revendedora"],
      ["L2", "7890000000011", "vendida"],
      ["L2", "7890000000011", "devolvida"],
    ],
  );
  // Sem o lote novo (desfeito), o antigo volta a valer.
  assert.deepEqual(registrosEfetivos([antigo, outraPeca]).length, 2);
});

test("Consignado: resumo por revendedora e o que a maleta precisa saber", () => {
  const registros = [
    reg({ quantidade: 2 }),
    reg({ codigoBarras: "7890000000028", situacao: "devolvida" }),
    reg({ codigoBarras: "7890000000035", situacao: "devolvida" }),
    reg({ codigoBarras: "7890000000035" }), // voltou e foi de novo: está com ela
    reg({ revendedora: "Revendedora B", situacao: "vendida", quantidade: 3, data: "2026-11-02" }),
    reg({ revendedora: "Revendedora B", codigoBarras: "7890000000042", situacao: "perdida" }),
    reg({ revendedora: "Revendedora B", codigoBarras: "7890000000059", situacao: "avariada" }),
  ];
  const resumo = resumoPorRevendedora(registros);
  assert.deepEqual(
    resumo.map((r) => [r.nome, r.com_revendedora, r.devolvida, r.vendida, r.avariada, r.perdida, r.ultimaData]),
    [
      ["Revendedora A", 3, 2, 0, 0, 0, "2026-10-01"],
      ["Revendedora B", 0, 0, 3, 1, 1, "2026-11-02"],
    ],
  );

  const produtos: ProdutoBase[] = ["7890000000011", "7890000000028", "7890000000035"].map((c, i) => ({
    id: `c${i}`,
    codigoBarras: c,
    referencia: `ABC${i}C`,
    codigoFornecedor: null,
    nome: null,
    nomeComercial: null,
    tipo: "brinco",
    quantidade: 5,
    precoVenda: 50,
    custoTotalBrl: 5,
    imagemId: null,
    destaque: false,
    criadoEm: "2026-01-01T00:00:00.000Z",
    recompraDe: null,
    fornecedor: null,
    dataPedido: "2026-01-01",
  }));
  const idx = indexarProdutos(produtos);
  const chaveDe = (r: RegistroConsignado) => {
    const { produto } = ligarVenda(r, idx);
    return produto ? chaveDoProduto(produto, idx) : null;
  };
  assert.deepEqual([...comRevendedorasPorSku(registros, chaveDe)], [
    ["7890000000011", 2],
    ["7890000000035", 1],
  ]);
  const dela = consignadoDaRevendedora(registros, "revendedora a", chaveDe);
  assert.deepEqual([...dela.comEla].sort(), ["7890000000011", "7890000000035"]);
  assert.deepEqual([...dela.devolvidas], ["7890000000028"]);
  assert.equal(consignadoDaRevendedora(registros, null, chaveDe).comEla.size, 0);
});
