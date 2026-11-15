import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { caminhoWindows, normalizarPasta, pastaDados, pastaDoPerfilDoUsuario, problemaDaPastaExterna, rodandoComoLocalService, urlArquivo } from "../src/lib/pastas";

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

test("Windows: caminho com letra de unidade ou de rede; pasta do perfil do usuário (onde o LocalService não grava)", () => {
  assert.ok(caminhoWindows("E:\\Backup Fio de Amor") && caminhoWindows("c:/FioDeAmor-Backup") && caminhoWindows("\\\\servidor\\backup"));
  assert.ok(!caminhoWindows("Backup") && !caminhoWindows("/media/pendrive"));
  assert.ok(pastaDoPerfilDoUsuario("C:\\Users\\Maria\\Google Drive\\Backup"));
  assert.ok(pastaDoPerfilDoUsuario("c:\\users\\maria\\OneDrive"));
  assert.ok(pastaDoPerfilDoUsuario("C:\\Usuários\\Maria\\Documentos"));
  assert.ok(!pastaDoPerfilDoUsuario("C:\\Users\\Public\\Backup"));
  assert.ok(!pastaDoPerfilDoUsuario("C:\\FioDeAmor-Backup"));
  assert.ok(!pastaDoPerfilDoUsuario("D:\\Backup Fio de Amor"));
  assert.ok(rodandoComoLocalService({ USERPROFILE: "C:\\WINDOWS\\ServiceProfiles\\LocalService" }));
  assert.ok(!rodandoComoLocalService({ USERPROFILE: "C:\\Users\\Maria" }));
  assert.ok(!rodandoComoLocalService({}));
});

test("Pasta externa do backup: caminho completo, fora dos dados e fora da pasta do programa", () => {
  const win = { dados: "C:\\FioDeAmor\\dados", programa: "C:\\FioDeAmor\\app" };
  assert.equal(problemaDaPastaExterna("E:\\Backup Fio de Amor", win), null);
  assert.equal(problemaDaPastaExterna("C:\\FioDeAmor-Backup", win), null); // começa igual, mas é outra pasta
  // "Copiar como caminho" do Windows vem entre aspas.
  assert.equal(normalizarPasta(' "E:\\Backup Fio de Amor" '), "E:\\Backup Fio de Amor");
  assert.equal(problemaDaPastaExterna('"E:\\Backup Fio de Amor"', win), null);
  assert.match(problemaDaPastaExterna("", win) ?? "", /Informe a pasta/);
  assert.match(problemaDaPastaExterna("Backup", win) ?? "", /caminho completo/);
  assert.match(problemaDaPastaExterna("c:\\fiodeamor\\DADOS\\backups", win) ?? "", /dentro dos dados do app/);
  assert.match(problemaDaPastaExterna("C:\\FioDeAmor\\dados", win) ?? "", /dentro dos dados do app/);
  assert.match(problemaDaPastaExterna("C:\\FioDeAmor\\app\\copias", win) ?? "", /pasta do programa/);
  if (process.platform !== "win32") {
    const lin = { dados: "/srv/fiodeamor/dados", programa: "/srv/fiodeamor/app" };
    assert.equal(problemaDaPastaExterna("/media/pendrive/backup", lin), null);
    assert.match(problemaDaPastaExterna("/srv/fiodeamor/dados/backups", lin) ?? "", /dentro dos dados do app/);
    assert.equal(problemaDaPastaExterna("/srv/fiodeamor/dados-copia", lin), null);
  }
});
