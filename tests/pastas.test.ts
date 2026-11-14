import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pastaDados, urlArquivo } from "../src/lib/pastas";

test("Windows: URL do banco com barras normais (libSQL)", () => {
  assert.equal(urlArquivo("C:\\FioDeAmor\\dados\\fiodeamor.db"), "file:C:/FioDeAmor/dados/fiodeamor.db");
  assert.equal(urlArquivo("/srv/app/dados/fiodeamor.db"), "file:/srv/app/dados/fiodeamor.db");
});

test("Pasta dos dados: FDA_DADOS (instalador) ou ./dados", () => {
  const antes = process.env.FDA_DADOS;
  try {
    delete process.env.FDA_DADOS;
    assert.equal(pastaDados(), path.resolve(process.cwd(), "dados"));
    process.env.FDA_DADOS = path.join("x", "dados-da-loja");
    assert.equal(pastaDados(), path.resolve("x", "dados-da-loja"));
  } finally {
    if (antes === undefined) delete process.env.FDA_DADOS;
    else process.env.FDA_DADOS = antes;
  }
});
