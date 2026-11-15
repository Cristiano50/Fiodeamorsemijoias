import { test } from "node:test";
import assert from "node:assert/strict";
import { chaveRecompra, classificarRecompra, normalizarChave, type OriginalRecompra } from "../src/lib/codigos";
import { lerLinha } from "../src/lib/extracao";

// Códigos fictícios; "forn-a"/"forn-b" fazem o papel da chave do fornecedor (nome original sem espaços, minúsculas).
const orig = (o: Partial<OriginalRecompra> & { id: string }): OriginalRecompra => ({
  codigo: "ABC123A",
  especificacao: "",
  fornecedorChave: "forn-a",
  criadoEm: "2026-01-01T00:00:00Z",
  ...o,
});

test("Chave da recompra: código e especificação normalizados (largura total, maiúsculas, sem espaço/hífen/ponto)", () => {
  assert.equal(normalizarChave("abc-123 a"), "ABC123A");
  assert.equal(normalizarChave("ＡＢＣ１２３Ａ"), "ABC123A");
  assert.equal(normalizarChave("ABC.123A"), "ABC123A");
  assert.equal(normalizarChave(" mr 白油 "), "MR白油");
  assert.equal(normalizarChave(null), "");
  assert.equal(chaveRecompra("forn-a", "abc-123a", "g"), "forn-a|ABC123A|G");
  assert.equal(chaveRecompra("forn-a", "ＡＢＣ１２３Ａ", " G "), chaveRecompra("forn-a", "ABC123A", "G"));
});

test("Recompra automática: exatamente 1 original com a chave inteira igual", () => {
  const r = classificarRecompra({ codigo: "ABC-123A", especificacao: "g", fornecedorChave: "forn-a" }, [
    orig({ id: "o1", especificacao: "G" }),
    orig({ id: "o2", especificacao: "MR" }), // outra cor: não é possível
    orig({ id: "o3", fornecedorChave: "forn-b", especificacao: "G" }), // outro fornecedor: não é possível
  ]);
  assert.deepEqual(r, { automatico: "o1", candidatas: [] });
});

test("Mais de um original possível (mesmo código e especificação igual em vários): recompra a confirmar", () => {
  const r = classificarRecompra({ codigo: "ABC123A", especificacao: "G", fornecedorChave: "forn-a" }, [
    orig({ id: "novo", especificacao: "G", criadoEm: "2026-05-01T00:00:00Z" }),
    orig({ id: "velho", especificacao: "G", criadoEm: "2026-02-01T00:00:00Z" }),
  ]);
  assert.deepEqual(r, { automatico: null, candidatas: ["velho", "novo"] }); // mais antigo primeiro
});

test("Especificação vazia de um dos lados: só sugestão, nunca automática", () => {
  // A linha nova não trouxe a cor: pode ser qualquer uma das variações antigas.
  const a = classificarRecompra({ codigo: "ABC123A", especificacao: "", fornecedorChave: "forn-a" }, [
    orig({ id: "g", especificacao: "G" }),
    orig({ id: "mr", especificacao: "MR" }),
  ]);
  assert.deepEqual(a, { automatico: null, candidatas: ["g", "mr"] });
  // O original antigo não tinha a cor lida: confirmar.
  const b = classificarRecompra({ codigo: "ABC123A", especificacao: "G", fornecedorChave: "forn-a" }, [orig({ id: "antigo", especificacao: "" })]);
  assert.deepEqual(b, { automatico: null, candidatas: ["antigo"] });
  // Uma igual e uma sem cor: duas possíveis, confirmar.
  const c = classificarRecompra({ codigo: "ABC123A", especificacao: "G", fornecedorChave: "forn-a" }, [orig({ id: "g", especificacao: "G" }), orig({ id: "vazio" })]);
  assert.deepEqual(c, { automatico: null, candidatas: ["g", "vazio"] });
});

test("Pedido sem fornecedor (ou original sem fornecedor): só sugestão", () => {
  const semFornecedor = classificarRecompra({ codigo: "ABC123A", especificacao: "G", fornecedorChave: "" }, [orig({ id: "o1", especificacao: "G" })]);
  assert.deepEqual(semFornecedor, { automatico: null, candidatas: ["o1"] });
  const originalSem = classificarRecompra({ codigo: "ABC123A", especificacao: "G", fornecedorChave: "forn-a" }, [orig({ id: "o1", especificacao: "G", fornecedorChave: "" })]);
  assert.deepEqual(originalSem, { automatico: null, candidatas: ["o1"] });
});

test("Sem recompra: outro código, outro fornecedor ou outra cor", () => {
  const nada = { automatico: null, candidatas: [] };
  assert.deepEqual(classificarRecompra({ codigo: "ABC999Z", especificacao: "G", fornecedorChave: "forn-a" }, [orig({ id: "o1", especificacao: "G" })]), nada);
  assert.deepEqual(classificarRecompra({ codigo: "ABC123A", especificacao: "G", fornecedorChave: "forn-b" }, [orig({ id: "o1", especificacao: "G" })]), nada);
  assert.deepEqual(classificarRecompra({ codigo: "ABC123A", especificacao: "MR", fornecedorChave: "forn-a" }, [orig({ id: "o1", especificacao: "G" })]), nada);
  assert.deepEqual(classificarRecompra({ codigo: "", especificacao: "G", fornecedorChave: "forn-a" }, [orig({ id: "o1", especificacao: "G" })]), nada);
});

test("A especificação lida do documento separa as cores do mesmo código (金色 × 玫瑰金, 16 × 18号)", () => {
  const ouro = lerLinha("4 | ABC126D | 戒指 | 金色 | 6.5 | 12 | 78").especificacao!;
  const rose = lerLinha("5 | ABC126D | 戒指 | 玫瑰金 | 6.5 | 12 | 78").especificacao!;
  const originais = [orig({ id: "ouro", codigo: "ABC126D", especificacao: ouro }), orig({ id: "rose", codigo: "ABC126D", especificacao: rose })];
  assert.equal(classificarRecompra({ codigo: "ABC126D", especificacao: "金色", fornecedorChave: "forn-a" }, originais).automatico, "ouro");
  assert.equal(classificarRecompra({ codigo: "ABC126D", especificacao: "玫瑰金", fornecedorChave: "forn-a" }, originais).automatico, "rose");
  const t16 = lerLinha("6 | ABC127E | 戒指 | 16 | 6.5 | 10 | 65").especificacao!;
  const t18 = lerLinha("7 | ABC127E | 戒指 | 18号 | 6.5 | 10 | 65").especificacao!;
  assert.notEqual(normalizarChave(t16), normalizarChave(t18));
});
