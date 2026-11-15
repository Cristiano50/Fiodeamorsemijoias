import { test } from "node:test";
import assert from "node:assert/strict";
import {
  copiasEtiqueta,
  dataBr,
  dataLocal,
  dataValida,
  divergencia,
  especificacaoDaLinha,
  novaConferencia,
  relatorioFornecedor,
  resumoConferencia,
  situacaoValida,
  temProblema,
  tudoCerto,
  type LinhaParaRelatorio,
} from "../src/lib/recebimento";

test("Situação do recebimento e datas", () => {
  assert.equal(situacaoValida("recebido"), "recebido");
  assert.equal(situacaoValida("conferido"), "conferido");
  assert.equal(situacaoValida("chegou"), null);
  assert.equal(situacaoValida(null), null);
  assert.equal(dataValida("2026-11-15"), "2026-11-15");
  assert.equal(dataValida("2026-02-30"), null);
  assert.equal(dataValida("15/11/2026"), null);
  assert.equal(dataValida("1999-12-31"), null);
  assert.equal(dataValida(20261115), null);
  assert.equal(dataLocal(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(dataBr("2026-11-15"), "15/11/2026");
  assert.equal(dataBr("2026-11-15T13:00:00.000Z"), "15/11/2026");
  assert.equal(dataBr(null), "");
});

test("Divergência da linha: falta, defeito e sobra", () => {
  // Ainda não conferida: entra a quantidade pedida, nada a cobrar.
  assert.deepEqual(divergencia({ quantidade: 13 }), { conferida: false, pedida: 13, recebida: null, defeito: 0, entram: 13, falta: 0, sobra: 0, aCreditar: 0 });
  // Veio 11 de 13, 1 com defeito: entram 10; cobra falta 2 + defeito 1.
  const d = divergencia({ quantidade: 13, quantidadeRecebida: 11, quantidadeDefeito: 1 });
  assert.equal(d.entram, 10);
  assert.equal(d.falta, 2);
  assert.equal(d.defeito, 1);
  assert.equal(d.aCreditar, 3);
  assert.ok(temProblema(d));
  // Veio 14 de 13 com 1 defeito: a sobra cobre o defeito.
  const s = divergencia({ quantidade: 13, quantidadeRecebida: 14, quantidadeDefeito: 1 });
  assert.equal(s.sobra, 1);
  assert.equal(s.entram, 13);
  assert.equal(s.aCreditar, 0);
  // Defeito maior que o recebido não deixa o estoque negativo.
  const x = divergencia({ quantidade: 5, quantidadeRecebida: 2, quantidadeDefeito: 9 });
  assert.equal(x.defeito, 2);
  assert.equal(x.entram, 0);
  assert.equal(x.aCreditar, 5);
  // Tudo certo.
  assert.ok(!temProblema(divergencia({ quantidade: 6, quantidadeRecebida: 6, quantidadeDefeito: 0 })));
});

test("Conferência digitada: validação e regras", () => {
  const base = { quantidade: 13, quantidadeRecebida: null, quantidadeDefeito: 0, defeitoObs: null };
  // Recebida digitada no jeito brasileiro.
  assert.deepEqual(novaConferencia(base, { quantidadeRecebida: "12" }), { ok: true, valor: { ...base, quantidadeRecebida: 12 } });
  // Marcar defeito numa linha ainda não conferida = recebeu a quantidade pedida.
  const r = novaConferencia(base, { quantidadeDefeito: 2 });
  assert.ok(r.ok && r.valor.quantidadeRecebida === 13 && r.valor.quantidadeDefeito === 2);
  // Defeito limitado ao recebido.
  const lim = novaConferencia({ ...base, quantidadeRecebida: 3 }, { quantidadeDefeito: 7 });
  assert.ok(lim.ok && lim.valor.quantidadeDefeito === 3);
  // Desfazer a conferência zera o defeito.
  const desf = novaConferencia({ ...base, quantidadeRecebida: 10, quantidadeDefeito: 2 }, { quantidadeRecebida: null });
  assert.ok(desf.ok && desf.valor.quantidadeRecebida === null && desf.valor.quantidadeDefeito === 0);
  // Observação aparada e limitada; vazia vira null.
  const obs = novaConferencia(base, { defeitoObs: "  banho manchado  " });
  assert.ok(obs.ok && obs.valor.defeitoObs === "banho manchado");
  const semObs = novaConferencia({ ...base, defeitoObs: "x" }, { defeitoObs: "   " });
  assert.ok(semObs.ok && semObs.valor.defeitoObs === null);
  const longa = novaConferencia(base, { defeitoObs: "a".repeat(900) });
  assert.ok(longa.ok && longa.valor.defeitoObs?.length === 500);
  // Inválidos.
  assert.equal(novaConferencia(base, { quantidadeRecebida: -1 }).ok, false);
  assert.equal(novaConferencia(base, { quantidadeRecebida: 2.5 }).ok, false);
  assert.equal(novaConferencia(base, { quantidadeRecebida: "abc" }).ok, false);
  assert.equal(novaConferencia(base, { quantidadeRecebida: 1_000_001 }).ok, false);
  assert.equal(novaConferencia(base, { quantidadeDefeito: "dois" }).ok, false);
  // Campos não enviados não mudam.
  const nada = novaConferencia({ ...base, quantidadeRecebida: 9, quantidadeDefeito: 1, defeitoObs: "fecho" }, {});
  assert.ok(nada.ok && nada.valor.quantidadeRecebida === 9 && nada.valor.quantidadeDefeito === 1 && nada.valor.defeitoObs === "fecho");
  assert.deepEqual(tudoCerto({ quantidade: 13 }), { quantidadeRecebida: 13, quantidadeDefeito: 0 });
});

test("Resumo da conferência do pedido", () => {
  const r = resumoConferencia([
    { quantidade: 13, quantidadeRecebida: 11, quantidadeDefeito: 1, precoOrigem: 5 },
    { quantidade: 6, quantidadeRecebida: 6, quantidadeDefeito: 0, precoOrigem: 87.5 },
    { quantidade: 10, quantidadeRecebida: null, quantidadeDefeito: 0, precoOrigem: 3 },
    { quantidade: 2, quantidadeRecebida: 3, quantidadeDefeito: 0, precoOrigem: 10 },
  ]);
  assert.equal(r.linhas, 4);
  assert.equal(r.conferidas, 3);
  assert.equal(r.pendentes, 1);
  assert.equal(r.pedidas, 31);
  assert.equal(r.recebidas, 20);
  assert.equal(r.entram, 10 + 6 + 10 + 3);
  assert.equal(r.faltas, 2);
  assert.equal(r.sobras, 1);
  assert.equal(r.defeito, 1);
  assert.equal(r.comProblema, 2);
  assert.equal(r.pecasACreditar, 3);
  assert.equal(r.valorACreditar, 15);
});

test("Relatório para o fornecedor: só faltas e defeitos, com valor na moeda", () => {
  const linha = (over: Partial<LinhaParaRelatorio>): LinhaParaRelatorio => ({
    id: "x",
    linha: 1,
    codigoFornecedor: "ABC123A",
    especificacao: "G",
    nome: "BRINCO TESTE",
    imagemId: null,
    defeitoImagemId: null,
    defeitoObs: null,
    precoOrigem: 4.5,
    quantidade: 13,
    quantidadeRecebida: 13,
    quantidadeDefeito: 0,
    ...over,
  });
  const r = relatorioFornecedor([
    linha({ id: "b", linha: 7, codigoFornecedor: "XYZ900B", quantidadeRecebida: 10, quantidadeDefeito: 1, defeitoImagemId: "img1", defeitoObs: "pedra solta" }),
    linha({ id: "a", linha: 2 }), // tudo certo
    linha({ id: "c", linha: 3, quantidadeRecebida: null }), // não conferida
    linha({ id: "d", linha: 4, quantidade: 6, quantidadeRecebida: 7, quantidadeDefeito: 1 }), // sobra cobre o defeito
    linha({ id: "e", linha: 1, codigoFornecedor: "QWE321C", precoOrigem: null, quantidade: 4, quantidadeRecebida: 0 }),
  ]);
  assert.deepEqual(
    r.itens.map((i) => [i.id, i.falta, i.defeito, i.aCreditar, i.valor]),
    [
      ["e", 4, 0, 4, 0],
      ["b", 3, 1, 4, 18],
    ],
  );
  assert.equal(r.itens[1].obs, "pedra solta");
  assert.equal(r.itens[1].defeitoImagemId, "img1");
  assert.equal(r.pecas, 8);
  assert.equal(r.total, 18);
});

test("Especificação do fornecedor da linha", () => {
  assert.equal(especificacaoDaLinha({ especificacao: "MR" }), "MR");
  assert.equal(especificacaoDaLinha({ especificacao: null, textoOriginal: "1 | ABC123A | 耳钉 | G | 10 | 12 | 120" }), "G");
  assert.equal(especificacaoDaLinha({ especificacao: null, textoOriginal: null, variacao: " 16 " }), "16");
  assert.equal(especificacaoDaLinha({}), "");
});

test("Etiquetas pela quantidade que entrou", () => {
  assert.equal(copiasEtiqueta({ quantidade: 13 }, "quantidade"), 13);
  assert.equal(copiasEtiqueta({ quantidade: 0 }, "quantidade"), 1); // sem conferência: pelo menos uma
  assert.equal(copiasEtiqueta({ quantidade: 13, quantidadeRecebida: 11, quantidadeDefeito: 2 }, "quantidade"), 9);
  assert.equal(copiasEtiqueta({ quantidade: 13, quantidadeRecebida: 0, quantidadeDefeito: 0 }, "quantidade"), 0);
  assert.equal(copiasEtiqueta({ quantidade: 13, quantidadeRecebida: 2, quantidadeDefeito: 2 }, "uma"), 0);
  assert.equal(copiasEtiqueta({ quantidade: 13, quantidadeRecebida: 5, quantidadeDefeito: 0 }, "uma"), 1);
});
